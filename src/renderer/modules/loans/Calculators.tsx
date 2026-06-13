// src/renderer/modules/loans/Calculators.tsx
//
// Financial Calculator Suite — surfaces the lf:* IPC calculator handlers.
// Includes: IDR, PSLF, HELOC, Reverse Mortgage, Lease-vs-Buy, CC Payoff,
//           NPV, IRR, PV, FV, Bridge Loan, MCA, Factoring.

import React, { useState, useRef } from 'react';
import {
  Calculator, ChevronRight, AlertCircle, TrendingUp, CreditCard,
  BarChart2, Home, RefreshCw, Layers, DollarSign, ArrowRightLeft,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toFixed(2) + '%';
}

function num(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return formatCurrency(n);
}

// ── shared UI atoms ───────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  type?: 'text' | 'number' | 'select';
  value: string;
  onChange: (v: string) => void;
  options?: { value: string; label: string }[];
  step?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  hint?: string;
}

function Field({ label, type = 'number', value, onChange, options, step, min, max, placeholder, hint }: FieldProps) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </label>
      {type === 'select' ? (
        <select className="block-select" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%' }}>
          {(options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          className="block-input"
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          step={step || (type === 'number' ? 'any' : undefined)}
          min={min}
          max={max}
          placeholder={placeholder}
          style={{ width: '100%' }}
        />
      )}
      {hint && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

interface ResultRowProps { label: string; value: string; highlight?: boolean; warn?: boolean }
function ResultRow({ label, value, highlight, warn }: ResultRowProps) {
  const color = warn ? 'var(--color-accent-expense)' : highlight ? 'var(--color-accent-income)' : 'var(--color-text-primary)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--hairline)' }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid var(--color-accent-expense)', borderRadius: 6, marginTop: 12, fontSize: 12, color: 'var(--color-accent-expense)' }}>
      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      {msg}
    </div>
  );
}

// ── calculator definitions ────────────────────────────────────────────────────

type CalcId =
  | 'idr' | 'cc_payoff' | 'heloc' | 'reverse'
  | 'lease_vs_buy' | 'npv' | 'irr' | 'pv_fv'
  | 'bridge' | 'mca' | 'factoring';

interface CalcDef {
  id: CalcId;
  label: string;
  description: string;
  icon: React.ReactNode;
  group: string;
}

const CALCS: CalcDef[] = [
  { id: 'idr',         label: 'IDR Payment',        description: 'Income-Driven Repayment monthly payment & forgiveness timeline',   icon: <TrendingUp size={15} />,    group: 'Student Loans' },
  { id: 'cc_payoff',   label: 'CC Payoff',           description: 'Credit card payoff timeline with minimum or extra payments',        icon: <CreditCard size={15} />,    group: 'Consumer' },
  { id: 'heloc',       label: 'HELOC Phases',        description: 'Draw-phase vs repayment-phase payment comparison + shock warning',  icon: <Home size={15} />,          group: 'Mortgage' },
  { id: 'reverse',     label: 'Reverse Mortgage',    description: 'HECM principal limit & payout options (tenure / term / LOC)',      icon: <Home size={15} />,          group: 'Mortgage' },
  { id: 'lease_vs_buy',label: 'Lease vs Buy',        description: 'NPV-based total-cost comparison for leasing vs purchasing',        icon: <ArrowRightLeft size={15} />, group: 'Consumer' },
  { id: 'npv',         label: 'NPV',                 description: 'Net Present Value of an arbitrary cash-flow stream',               icon: <BarChart2 size={15} />,     group: 'Financial Math' },
  { id: 'irr',         label: 'IRR',                 description: 'Internal Rate of Return (Newton-Raphson solver)',                  icon: <BarChart2 size={15} />,     group: 'Financial Math' },
  { id: 'pv_fv',       label: 'PV / FV',             description: 'Single-period Present Value or Future Value',                      icon: <Calculator size={15} />,    group: 'Financial Math' },
  { id: 'bridge',      label: 'Bridge Loan',         description: 'Short-term bridge loan cost with origination + exit fees',         icon: <Layers size={15} />,        group: 'Commercial' },
  { id: 'mca',         label: 'MCA',                 description: 'Merchant Cash Advance cost: factor rate → effective APR',          icon: <DollarSign size={15} />,    group: 'Commercial' },
  { id: 'factoring',   label: 'Factoring',           description: 'Invoice factoring advance, fee, and annualized cost analysis',     icon: <RefreshCw size={15} />,     group: 'Commercial' },
];

const GROUPS = ['Student Loans', 'Consumer', 'Mortgage', 'Financial Math', 'Commercial'];

// ── per-calculator forms ──────────────────────────────────────────────────────

// IDR ─────────────────────────────────────────────────────────────────────────
function IdrCalc() {
  const [plan, setPlan]     = useState('IBR_new');
  const [agi, setAgi]       = useState('60000');
  const [family, setFamily] = useState('1');
  const [state, setState]   = useState('');
  const [res, setRes]       = useState<any>(null);
  const [err, setErr]       = useState('');
  const [busy, setBusy]     = useState(false);
  const mounted             = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const r = await api.lfIdrCalc({ plan: plan as any, agi: +agi, family_size: +family, state: state || undefined });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Plan" type="select" value={plan} onChange={setPlan} options={[
        { value: 'PAYE',    label: 'PAYE (10%, 20yr)' },
        { value: 'REPAYE',  label: 'REPAYE (10%, 20yr)' },
        { value: 'IBR_new', label: 'IBR New (10%, 20yr)' },
        { value: 'IBR_old', label: 'IBR Old (15%, 25yr)' },
        { value: 'ICR',     label: 'ICR (20%, 25yr)' },
      ]} />
      <Field label="Adjusted Gross Income ($)" value={agi} onChange={setAgi} min="0" placeholder="60000" />
      <Field label="Family Size" value={family} onChange={setFamily} min="1" step="1" placeholder="1" />
      <Field label="State (optional — AK/HI for higher poverty line)" type="text" value={state} onChange={setState} placeholder="e.g. AK" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="Monthly Payment"        value={fmt$(res.monthly_payment)}       highlight />
          <ResultRow label="Annual Payment"         value={fmt$(res.annual_payment)} />
          <ResultRow label="Discretionary Income"   value={fmt$(res.discretionary_income)} />
          <ResultRow label="Protected Income"       value={fmt$(res.protected_income)} />
          <ResultRow label="Poverty Line"           value={fmt$(res.poverty_line)} />
          <ResultRow label="Payment %"              value={pct(res.payment_pct * 100)} />
          <ResultRow label="Forgiveness"            value={`${res.forgiveness_years} years (${res.forgiveness_months} payments)`} />
        </div>
      )}
    </div>
  );
}

// CC Payoff ───────────────────────────────────────────────────────────────────
function CcPayoffCalc() {
  const [balance, setBalance] = useState('5000');
  const [apr,     setApr]     = useState('24');
  const [minPct,  setMinPct]  = useState('2');
  const [floor,   setFloor]   = useState('25');
  const [extra,   setExtra]   = useState('0');
  const [res,     setRes]     = useState<any>(null);
  const [err,     setErr]     = useState('');
  const [busy,    setBusy]    = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const r = await api.lfCcPayoff({ balance: +balance, apr_pct: +apr, min_pct: +minPct, min_floor: +floor, extra_payment: +extra });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Balance ($)"               value={balance} onChange={setBalance} min="0" />
      <Field label="APR (%)"                   value={apr}     onChange={setApr}     min="0" step="0.01" />
      <Field label="Minimum Payment % of Balance" value={minPct} onChange={setMinPct} step="0.1" min="0" />
      <Field label="Minimum Floor ($)"         value={floor}   onChange={setFloor}   min="0" />
      <Field label="Extra Monthly Payment ($)" value={extra}   onChange={setExtra}   min="0" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="Payoff Time"          value={`${res.payoff_months} months (${res.payoff_years} yrs)`} highlight />
          <ResultRow label="First Payment"        value={fmt$(res.first_payment)} />
          <ResultRow label="Total Interest Paid"  value={fmt$(res.total_interest_paid)} warn />
          <ResultRow label="Total Paid"           value={fmt$(res.total_paid)} />
        </div>
      )}
    </div>
  );
}

// HELOC ───────────────────────────────────────────────────────────────────────
function HelocCalc() {
  const [limit,    setLimit]    = useState('200000');
  const [balance,  setBalance]  = useState('80000');
  const [rate,     setRate]     = useState('8.5');
  const [drawMo,   setDrawMo]   = useState('36');
  const [repayMo,  setRepayMo]  = useState('240');
  const [res,      setRes]      = useState<any>(null);
  const [err,      setErr]      = useState('');
  const [busy,     setBusy]     = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const r = await api.lfHelocPhaseCalc({ credit_limit: +limit, current_balance: +balance, rate_pct: +rate, draw_period_remaining_months: +drawMo, repayment_period_months: +repayMo });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Credit Limit ($)"                   value={limit}   onChange={setLimit}   min="0" />
      <Field label="Current Balance ($)"                value={balance} onChange={setBalance} min="0" />
      <Field label="Interest Rate (%)"                  value={rate}    onChange={setRate}    min="0" step="0.01" />
      <Field label="Draw Period Remaining (months)"     value={drawMo}  onChange={setDrawMo}  min="0" step="1" />
      <Field label="Repayment Period (months)"          value={repayMo} onChange={setRepayMo} min="1" step="1" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Draw Phase</div>
          <ResultRow label="Monthly (interest-only)"   value={fmt$(res.draw_phase?.current_monthly)}         highlight />
          <ResultRow label="Total Interest Remaining"  value={fmt$(res.draw_phase?.total_interest_remaining)} />
          <ResultRow label="Available Credit"          value={fmt$(res.draw_phase?.available_credit)} />
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 6px' }}>Repayment Phase</div>
          <ResultRow label="Monthly Payment"           value={fmt$(res.repayment_phase?.monthly_payment)}    highlight />
          <ResultRow label="Projected Balance"         value={fmt$(res.repayment_phase?.projected_balance)} />
          <ResultRow label="Total Interest"            value={fmt$(res.repayment_phase?.total_interest)}     warn />
          <ResultRow label="Payment Shock (increase)"  value={fmt$(res.payment_shock_warning)}               warn />
          {res.shock_multiplier != null && (
            <ResultRow label="Shock Multiplier" value={`${num(res.shock_multiplier)}×`} warn={res.shock_multiplier > 2} />
          )}
        </div>
      )}
    </div>
  );
}

// Reverse Mortgage ────────────────────────────────────────────────────────────
function ReverseCalc() {
  const [homeVal,  setHomeVal]  = useState('500000');
  const [age,      setAge]      = useState('70');
  const [rate,     setRate]     = useState('6.5');
  const [option,   setOption]   = useState('tenure');
  const [termMo,   setTermMo]   = useState('120');
  const [res,      setRes]      = useState<any>(null);
  const [err,      setErr]      = useState('');
  const [busy,     setBusy]     = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const r = await api.lfReverseOptions({ home_value: +homeVal, borrower_age: +age, expected_rate_pct: +rate, payout_option: option as any, term_months: option === 'term' ? +termMo : undefined });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Home Value ($)"         value={homeVal} onChange={setHomeVal} min="0" />
      <Field label="Borrower Age"           value={age}     onChange={setAge}     min="62" step="1" />
      <Field label="Expected Rate (%)"      value={rate}    onChange={setRate}    min="0" step="0.01" />
      <Field label="Payout Option" type="select" value={option} onChange={setOption} options={[
        { value: 'tenure', label: 'Tenure (lifetime monthly)' },
        { value: 'term',   label: 'Term (fixed months)' },
        { value: 'loc',    label: 'Line of Credit' },
      ]} />
      {option === 'term' && (
        <Field label="Term (months)" value={termMo} onChange={setTermMo} min="1" step="1" />
      )}
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="Principal Limit"           value={fmt$(res.principal_limit)} />
          <ResultRow label="Principal Limit Factor"    value={pct(res.principal_limit_factor * 100)} />
          <ResultRow label="Upfront MIP"               value={fmt$(res.upfront_mip)} warn />
          <ResultRow label="Net Available"             value={fmt$(res.net_available)} highlight />
          {res.monthly_payout > 0 && <ResultRow label="Monthly Payout"          value={fmt$(res.monthly_payout)} highlight />}
          {res.line_of_credit_available > 0 && <ResultRow label="LOC Available" value={fmt$(res.line_of_credit_available)} highlight />}
        </div>
      )}
    </div>
  );
}

// Lease vs Buy ────────────────────────────────────────────────────────────────
function LeaseVsBuyCalc() {
  const [assetPrice,  setAssetPrice]  = useState('30000');
  const [leaseMo,     setLeaseMo]     = useState('450');
  const [leaseTerm,   setLeaseTerm]   = useState('36');
  const [down,        setDown]        = useState('3000');
  const [loanAmt,     setLoanAmt]     = useState('27000');
  const [buyRate,     setBuyRate]     = useState('6.5');
  const [buyTerm,     setBuyTerm]     = useState('60');
  const [residual,    setResidual]    = useState('15000');
  const [discRate,    setDiscRate]    = useState('5');
  const [res,         setRes]         = useState<any>(null);
  const [err,         setErr]         = useState('');
  const [busy,        setBusy]        = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const r = await api.lfLeaseVsBuy({
        asset_price: +assetPrice, lease_monthly: +leaseMo, lease_term_months: +leaseTerm,
        buy_down_payment: +down, buy_loan_amount: +loanAmt, buy_rate_pct: +buyRate,
        buy_term_months: +buyTerm, residual_value: +residual, discount_rate_pct: +discRate,
      });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Asset Price ($)"          value={assetPrice} onChange={setAssetPrice} min="0" />
      <Field label="Lease Monthly ($)"        value={leaseMo}    onChange={setLeaseMo}    min="0" />
      <Field label="Lease Term (months)"      value={leaseTerm}  onChange={setLeaseTerm}  min="1" step="1" />
      <Field label="Buy — Down Payment ($)"   value={down}       onChange={setDown}       min="0" />
      <Field label="Buy — Loan Amount ($)"    value={loanAmt}    onChange={setLoanAmt}    min="0" />
      <Field label="Buy — Rate (%)"           value={buyRate}    onChange={setBuyRate}    min="0" step="0.01" />
      <Field label="Buy — Term (months)"      value={buyTerm}    onChange={setBuyTerm}    min="1" step="1" />
      <Field label="Residual/Resale Value ($)" value={residual}  onChange={setResidual}   min="0" />
      <Field label="Discount Rate (%) for PV" value={discRate}   onChange={setDiscRate}   min="0" step="0.01" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="Lease PV (total cost)"  value={fmt$(res.lease_pv)} />
          <ResultRow label="Lease Monthly"          value={fmt$(res.lease_monthly)} />
          <ResultRow label="Buy PV (total cost)"    value={fmt$(res.buy_pv)} />
          <ResultRow label="Buy Monthly"            value={fmt$(res.buy_monthly)} />
          <ResultRow label="Down Payment"           value={fmt$(res.buy_down_payment)} />
          <ResultRow
            label="Recommendation"
            value={res.recommendation === 'buy' ? 'BUY' : 'LEASE'}
            highlight={res.recommendation === 'buy'}
            warn={res.recommendation === 'lease'}
          />
          <ResultRow label="Savings vs Alternative" value={fmt$(res.savings_by_recommendation)} highlight />
        </div>
      )}
    </div>
  );
}

// NPV ─────────────────────────────────────────────────────────────────────────
function NpvCalc() {
  const [flows,    setFlows]    = useState('-10000, 3000, 4000, 4000, 5000');
  const [discRate, setDiscRate] = useState('10');
  const [res,      setRes]      = useState<any>(null);
  const [err,      setErr]      = useState('');
  const [busy,     setBusy]     = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const cashFlows = flows.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      if (cashFlows.length < 2) { setErr('Enter at least 2 cash flows separated by commas'); setBusy(false); return; }
      const r = await api.lfNpv(cashFlows, +discRate);
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Cash Flows (comma-separated, t=0 first)" type="text" value={flows} onChange={setFlows}
        hint="Negative = outflow. First value is initial investment (t=0)." />
      <Field label="Discount Rate (% per period)" value={discRate} onChange={setDiscRate} min="0" step="0.01" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate NPV'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="NPV"           value={fmt$(res.npv)} highlight={res.npv >= 0} warn={res.npv < 0} />
          <ResultRow label="Discount Rate" value={pct(res.discount_rate_pct)} />
          <ResultRow label="Periods"       value={String(res.period_count)} />
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
            {res.npv >= 0 ? 'Positive NPV — project adds value at this discount rate.' : 'Negative NPV — project destroys value at this discount rate.'}
          </div>
        </div>
      )}
    </div>
  );
}

// IRR ─────────────────────────────────────────────────────────────────────────
function IrrCalc() {
  const [flows, setFlows] = useState('-10000, 3000, 4000, 4000, 5000');
  const [res,   setRes]   = useState<any>(null);
  const [err,   setErr]   = useState('');
  const [busy,  setBusy]  = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const cashFlows = flows.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      if (cashFlows.length < 2) { setErr('Enter at least 2 cash flows'); setBusy(false); return; }
      const r = await api.lfIrr(cashFlows);
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Cash Flows (comma-separated, t=0 first)" type="text" value={flows} onChange={setFlows}
        hint="Must include at least one sign change (outflow then inflows)." />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate IRR'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="IRR"       value={pct(res.irr_pct)} highlight />
          <ResultRow label="Converged" value={res.converged ? 'Yes' : 'No (hit max iterations)'} warn={!res.converged} />
        </div>
      )}
    </div>
  );
}

// PV / FV ─────────────────────────────────────────────────────────────────────
function PvFvCalc() {
  const [mode,    setMode]    = useState<'pv' | 'fv'>('pv');
  const [amount,  setAmount]  = useState('10000');
  const [rate,    setRate]    = useState('6');
  const [periods, setPeriods] = useState('10');
  const [res,     setRes]     = useState<any>(null);
  const [err,     setErr]     = useState('');
  const [busy,    setBusy]    = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      let r: any;
      if (mode === 'pv') r = await api.lfPv({ future_value: +amount, rate_pct: +rate, periods: +periods });
      else                r = await api.lfFv({ present_value: +amount, rate_pct: +rate, periods: +periods });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['pv', 'fv'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setRes(null); setErr(''); }}
            className={mode === m ? 'block-btn-primary' : 'block-btn'}
            style={{ flex: 1 }}>
            {m === 'pv' ? 'Present Value' : 'Future Value'}
          </button>
        ))}
      </div>
      <Field label={mode === 'pv' ? 'Future Value ($)' : 'Present Value ($)'} value={amount} onChange={setAmount} min="0" />
      <Field label="Rate per Period (%)" value={rate} onChange={setRate} min="0" step="0.01" />
      <Field label="Number of Periods"  value={periods} onChange={setPeriods} min="1" step="1" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : `Calculate ${mode.toUpperCase()}`}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          {res.present_value != null && <ResultRow label="Present Value" value={fmt$(res.present_value)} highlight />}
          {res.future_value  != null && <ResultRow label="Future Value"  value={fmt$(res.future_value)}  highlight />}
        </div>
      )}
    </div>
  );
}

// Bridge Loan ─────────────────────────────────────────────────────────────────
function BridgeCalc() {
  const [loanAmt, setLoanAmt] = useState('500000');
  const [rate,    setRate]    = useState('10');
  const [term,    setTerm]    = useState('12');
  const [origFee, setOrigFee] = useState('1');
  const [exitFee, setExitFee] = useState('1');
  const [res,     setRes]     = useState<any>(null);
  const [err,     setErr]     = useState('');
  const [busy,    setBusy]    = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const r = await api.lfBridgeCalc({ loan_amount: +loanAmt, rate_pct: +rate, term_months: +term, origination_fee_pct: +origFee, exit_fee_pct: +exitFee });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Loan Amount ($)"           value={loanAmt} onChange={setLoanAmt} min="0" />
      <Field label="Rate (%)"                  value={rate}    onChange={setRate}    min="0" step="0.01" />
      <Field label="Term (months)"             value={term}    onChange={setTerm}    min="1" step="1" />
      <Field label="Origination Fee (%)"       value={origFee} onChange={setOrigFee} min="0" step="0.01" />
      <Field label="Exit Fee (%)"              value={exitFee} onChange={setExitFee} min="0" step="0.01" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="Monthly Interest-Only"  value={fmt$(res.monthly_interest_only_payment)} highlight />
          <ResultRow label="Balloon Payoff at End"  value={fmt$(res.balloon_payoff_at_end)} />
          <ResultRow label="Total Interest"         value={fmt$(res.total_interest)} warn />
          <ResultRow label="Origination Fee"        value={fmt$(res.origination_fee)} warn />
          <ResultRow label="Exit Fee"               value={fmt$(res.exit_fee)} warn />
          <ResultRow label="Total Cost"             value={fmt$(res.total_cost)} warn />
          <ResultRow label="Net Proceeds"           value={fmt$(res.net_proceeds)} />
          <ResultRow label="Effective APR"          value={pct(res.effective_apr_pct)} warn />
        </div>
      )}
    </div>
  );
}

// MCA ─────────────────────────────────────────────────────────────────────────
function McaCalc() {
  const [advance,  setAdvance]  = useState('50000');
  const [factor,   setFactor]   = useState('1.35');
  const [holdback, setHoldback] = useState('10');
  const [dailyRev, setDailyRev] = useState('5000');
  const [res,      setRes]      = useState<any>(null);
  const [err,      setErr]      = useState('');
  const [busy,     setBusy]     = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const r = await api.lfMca({ advance_amount: +advance, factor_rate: +factor, holdback_pct: +holdback, estimated_daily_revenue: +dailyRev });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Advance Amount ($)"         value={advance}  onChange={setAdvance}  min="0" />
      <Field label="Factor Rate (e.g. 1.35)"    value={factor}   onChange={setFactor}   min="1" step="0.01" hint="Total payback = advance × factor rate" />
      <Field label="Holdback % of Daily Revenue" value={holdback} onChange={setHoldback} min="0" step="0.1" />
      <Field label="Estimated Daily Revenue ($)" value={dailyRev} onChange={setDailyRev} min="0" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="Total Payback"        value={fmt$(res.total_payback)} />
          <ResultRow label="Daily Payment"        value={fmt$(res.daily_payment)} />
          <ResultRow label="Months to Repay"      value={num(res.months_to_repay, 1)} />
          <ResultRow label="Annualized APR"       value={pct(res.annualized_apr_pct)} warn={res.annualized_apr_pct > 50} />
          {res.warning && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(220,38,38,0.08)', border: '1px solid var(--color-accent-expense)', borderRadius: 6, fontSize: 11, color: 'var(--color-accent-expense)' }}>
              {res.warning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Factoring ───────────────────────────────────────────────────────────────────
function FactoringCalc() {
  const [invoice,     setInvoice]     = useState('100000');
  const [advanceRate, setAdvanceRate] = useState('80');
  const [factorFee,   setFactorFee]   = useState('3');
  const [days,        setDays]        = useState('45');
  const [res,         setRes]         = useState<any>(null);
  const [err,         setErr]         = useState('');
  const [busy,        setBusy]        = useState(false);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function calc() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const r = await api.lfFactoring({ invoice_amount: +invoice, advance_rate_pct: +advanceRate, factor_fee_pct: +factorFee, days_outstanding: +days });
      if (!mounted.current) return;
      if (r?.error) setErr(r.error); else setRes(r);
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div>
      <Field label="Invoice Amount ($)"           value={invoice}     onChange={setInvoice}     min="0" />
      <Field label="Advance Rate (%)"             value={advanceRate} onChange={setAdvanceRate} min="0" max="100" step="0.1" />
      <Field label="Factor Fee (% of invoice)"    value={factorFee}   onChange={setFactorFee}   min="0" step="0.01" />
      <Field label="Days Outstanding (avg collect)" value={days}      onChange={setDays}        min="1" step="1" />
      <button className="block-btn-primary" onClick={calc} disabled={busy} style={{ width: '100%', marginTop: 4 }}>
        {busy ? 'Calculating…' : 'Calculate'}
      </button>
      {err && <ErrorBox msg={err} />}
      {res && (
        <div style={{ marginTop: 16 }}>
          <ResultRow label="Advance Today"        value={fmt$(res.advance_today)} highlight />
          <ResultRow label="Factor Fee"           value={fmt$(res.factor_fee)} warn />
          <ResultRow label="Reserve Held"         value={fmt$(res.reserve_held)} />
          <ResultRow label="Net After Collection" value={fmt$(res.net_after_collection)} />
          <ResultRow label="Annualized Cost"      value={pct(res.annualized_cost_pct)} warn />
        </div>
      )}
    </div>
  );
}

// ── component map ─────────────────────────────────────────────────────────────

const CALC_COMPONENTS: Record<CalcId, React.FC> = {
  idr:          IdrCalc,
  cc_payoff:    CcPayoffCalc,
  heloc:        HelocCalc,
  reverse:      ReverseCalc,
  lease_vs_buy: LeaseVsBuyCalc,
  npv:          NpvCalc,
  irr:          IrrCalc,
  pv_fv:        PvFvCalc,
  bridge:       BridgeCalc,
  mca:          McaCalc,
  factoring:    FactoringCalc,
};

// ── main export ───────────────────────────────────────────────────────────────

export default function Calculators() {
  const [selected, setSelected] = useState<CalcId>('idr');
  const ActiveCalc = CALC_COMPONENTS[selected];
  const activeDef  = CALCS.find(c => c.id === selected)!;

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 0 }}>
      {/* sidebar picker */}
      <div style={{ width: 210, flexShrink: 0, borderRight: '1px solid var(--structure)', overflowY: 'auto', padding: '16px 0' }}>
        {GROUPS.map(group => {
          const items = CALCS.filter(c => c.group === group);
          return (
            <div key={group} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', padding: '0 14px', marginBottom: 4 }}>
                {group}
              </div>
              {items.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '8px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: selected === c.id ? 'var(--color-bg-secondary)' : 'transparent',
                    borderLeft: selected === c.id ? '3px solid var(--accent-primary)' : '3px solid transparent',
                    color: selected === c.id ? 'var(--accent-primary)' : 'var(--color-text-primary)',
                    fontWeight: selected === c.id ? 700 : 400,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: selected === c.id ? 'var(--accent-primary)' : 'var(--color-text-muted)', flexShrink: 0 }}>
                    {c.icon}
                  </span>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {selected === c.id && <ChevronRight size={12} style={{ flexShrink: 0 }} />}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* form + results panel */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: 'var(--accent-primary)' }}>{activeDef.icon}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{activeDef.label}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{activeDef.description}</div>
        </div>
        <div className="block-card" style={{ padding: 20, maxWidth: 520 }}>
          <ActiveCalc />
        </div>
      </div>
    </div>
  );
}
