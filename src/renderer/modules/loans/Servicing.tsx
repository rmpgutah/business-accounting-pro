// src/renderer/modules/loans/Servicing.tsx
//
// Loan Servicing tab — surfaces la:* IPC handlers for 3 feature groups:
//   (#36) Refinance & Modification: refi compare/execute, mod apply, recast
//   (#37) Payoff Accelerators: biweekly impact, lump-principal
//   (#38) Covenants & Risk: covenant list/create/measure/breaches, DSCR/LTV/stress

import React, { useState, useEffect, useRef } from 'react';
import {
  RefreshCw, TrendingDown, Shield, AlertTriangle, CheckCircle,
  Clock, DollarSign, Zap, Activity,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return formatCurrency(n);
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return formatDate(s);
}

function pct(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—';
  return n.toFixed(decimals) + '%';
}

function num(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ── Label + value row ────────────────────────────────────────────────────────

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--hairline)' }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'SF Mono, Menlo, monospace', color: accent || 'var(--color-text-primary)' }}>{value}</span>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span style={{ color: 'var(--accent-primary)' }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-primary)' }}>{title}</span>
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div style={{ padding: 10, background: 'color-mix(in srgb, var(--color-accent-expense) 8%, transparent)', border: '1px solid var(--color-accent-expense)', borderRadius: 6, fontSize: 12, color: 'var(--color-accent-expense)', marginTop: 8 }}>
      <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />{msg}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Section 1 — Refinance & Modification
// ════════════════════════════════════════════════════════════════════════════

function RefiSection({ loanId }: { loanId: string }) {
  // Refi compare state
  const [newRate, setNewRate] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [closingCosts, setClosingCosts] = useState('');
  const [cashout, setCashout] = useState('');
  const [compareResult, setCompareResult] = useState<any>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareErr, setCompareErr] = useState('');

  // Execute refi state
  const [execLoading, setExecLoading] = useState(false);
  const [execResult, setExecResult] = useState<any>(null);
  const [execErr, setExecErr] = useState('');

  // Modification state
  const [modType, setModType] = useState<'rate_reduction' | 'term_extension' | 'forbearance' | 'principal_reduction'>('rate_reduction');
  const [modRate, setModRate] = useState('');
  const [modTerm, setModTerm] = useState('');
  const [modForbearance, setModForbearance] = useState('');
  const [modPrincipalRed, setModPrincipalRed] = useState('');
  const [modReason, setModReason] = useState('');
  const [modLoading, setModLoading] = useState(false);
  const [modResult, setModResult] = useState<any>(null);
  const [modErr, setModErr] = useState('');

  // Recast state
  const [recastLoading, setRecastLoading] = useState(false);
  const [recastResult, setRecastResult] = useState<any>(null);
  const [recastErr, setRecastErr] = useState('');

  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    setCompareResult(null);
    setCompareErr('');
    setExecResult(null);
    setExecErr('');
    setModResult(null);
    setModErr('');
    setRecastResult(null);
    setRecastErr('');
    return () => { cancelRef.current = true; };
  }, [loanId]);

  async function handleCompare() {
    if (!newRate || !newTerm) { setCompareErr('New rate and term are required.'); return; }
    setCompareLoading(true);
    setCompareErr('');
    setCompareResult(null);
    try {
      const r = await api.laRefiCompare({
        loan_id: loanId,
        new_rate: parseFloat(newRate),
        new_term_months: parseInt(newTerm, 10),
        closing_costs: closingCosts ? parseFloat(closingCosts) : undefined,
        cashout_amount: cashout ? parseFloat(cashout) : undefined,
      });
      if (cancelRef.current) return;
      if (r && (r as any).error) { setCompareErr((r as any).error); return; }
      setCompareResult(r);
    } catch (e: any) {
      if (!cancelRef.current) setCompareErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setCompareLoading(false);
    }
  }

  async function handleExecuteRefi() {
    if (!compareResult) { setExecErr('Run a comparison first.'); return; }
    if (!window.confirm('Execute refinance? This closes the current loan and creates a new one. This action cannot be undone.')) return;
    setExecLoading(true);
    setExecErr('');
    setExecResult(null);
    try {
      const r = await api.laRefiExecute({
        loan_id: loanId,
        new_rate: parseFloat(newRate),
        new_term_months: parseInt(newTerm, 10),
        closing_costs: closingCosts ? parseFloat(closingCosts) : undefined,
        cashout_amount: cashout ? parseFloat(cashout) : undefined,
      });
      if (cancelRef.current) return;
      if (r && (r as any).error) { setExecErr((r as any).error); return; }
      setExecResult(r);
    } catch (e: any) {
      if (!cancelRef.current) setExecErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setExecLoading(false);
    }
  }

  async function handleMod() {
    if (!modReason.trim()) { setModErr('Reason is required.'); return; }
    if (!window.confirm(`Apply ${modType.replace(/_/g, ' ')} modification to this loan?`)) return;
    setModLoading(true);
    setModErr('');
    setModResult(null);
    try {
      const r = await api.laModApply({
        loan_id: loanId,
        modification_type: modType,
        new_rate: modRate ? parseFloat(modRate) : undefined,
        new_term_months: modTerm ? parseInt(modTerm, 10) : undefined,
        forbearance_months: modForbearance ? parseInt(modForbearance, 10) : undefined,
        principal_reduction_amount: modPrincipalRed ? parseFloat(modPrincipalRed) : undefined,
        reason: modReason,
      });
      if (cancelRef.current) return;
      if (r && (r as any).error) { setModErr((r as any).error); return; }
      setModResult(r);
    } catch (e: any) {
      if (!cancelRef.current) setModErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setModLoading(false);
    }
  }

  async function handleRecast() {
    if (!window.confirm('Recast amortization schedule? This deletes all pending schedule rows and regenerates them based on current balance and rate.')) return;
    setRecastLoading(true);
    setRecastErr('');
    setRecastResult(null);
    try {
      const r = await api.laRecast(loanId);
      if (cancelRef.current) return;
      if (r && (r as any).error) { setRecastErr((r as any).error); return; }
      setRecastResult(r);
    } catch (e: any) {
      if (!cancelRef.current) setRecastErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setRecastLoading(false);
    }
  }

  const verdict = compareResult?.analysis?.verdict;
  const verdictColor = verdict === 'recommended' ? 'var(--color-accent-income)'
    : verdict === 'marginal' ? 'var(--color-accent-warning)'
    : 'var(--color-accent-expense)';

  return (
    <div className="block-card" style={{ padding: 20, marginBottom: 16 }}>
      <SectionHeader icon={<RefreshCw size={15} />} title="Refinance & Modification" />

      {/* Refi Compare Form */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Refinance Scenario
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>New Rate (%)</div>
            <input className="block-input" type="number" step="0.001" min="0" placeholder="e.g. 5.5"
              value={newRate} onChange={e => setNewRate(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Term (months)</div>
            <input className="block-input" type="number" step="1" min="1" placeholder="e.g. 360"
              value={newTerm} onChange={e => setNewTerm(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Closing Costs ($)</div>
            <input className="block-input" type="number" step="0.01" min="0" placeholder="optional"
              value={closingCosts} onChange={e => setClosingCosts(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Cash-out ($)</div>
            <input className="block-input" type="number" step="0.01" min="0" placeholder="optional"
              value={cashout} onChange={e => setCashout(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="block-btn" onClick={handleCompare} disabled={compareLoading}>
            {compareLoading ? 'Comparing…' : 'Compare'}
          </button>
          {compareResult && !execResult && (
            <button className="block-btn" onClick={handleExecuteRefi} disabled={execLoading}
              style={{ borderColor: 'var(--color-accent-expense)', color: 'var(--color-accent-expense)' }}>
              {execLoading ? 'Executing…' : 'Execute Refi'}
            </button>
          )}
        </div>
        {compareErr && <ErrBox msg={compareErr} />}
        {execErr && <ErrBox msg={execErr} />}

        {execResult && !execResult.error && (
          <div style={{ marginTop: 10, padding: 10, background: 'color-mix(in srgb, var(--color-accent-income) 8%, transparent)', border: '1px solid var(--color-accent-income)', borderRadius: 6, fontSize: 12 }}>
            <CheckCircle size={12} style={{ display: 'inline', marginRight: 4, color: 'var(--color-accent-income)' }} />
            Refinance executed. New loan ID: <span style={{ fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>{execResult.new_loan_id}</span>. Effective: {fmtDate(execResult.effective_date)}.
          </div>
        )}

        {compareResult && !compareResult.error && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 6 }}>Current Loan</div>
              <Row label="Balance" value={fmt$(compareResult.current.balance)} />
              <Row label="Rate" value={pct(compareResult.current.rate_pct)} />
              <Row label="Monthly Payment" value={fmt$(compareResult.current.monthly_payment)} />
              <Row label="Remaining Payments" value={compareResult.current.remaining_payments} />
              <Row label="Total Remaining" value={fmt$(compareResult.current.remaining_total)} />
              <Row label="Remaining Interest" value={fmt$(compareResult.current.remaining_interest)} accent="var(--color-accent-expense)" />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 6 }}>Refinanced</div>
              <Row label="New Principal" value={fmt$(compareResult.refinanced.new_principal)} />
              <Row label="New Rate" value={pct(compareResult.refinanced.new_rate_pct)} />
              <Row label="New Monthly" value={fmt$(compareResult.refinanced.new_monthly)} />
              <Row label="New Term" value={compareResult.refinanced.new_term_months + ' mo'} />
              <Row label="Total Cost" value={fmt$(compareResult.refinanced.total_cost)} />
              <Row label="Total Interest" value={fmt$(compareResult.refinanced.total_interest)} accent="var(--color-accent-expense)" />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 6 }}>Analysis</div>
              <Row label="Monthly Savings" value={fmt$(compareResult.analysis.monthly_savings)} accent="var(--color-accent-income)" />
              <Row label="Total Savings" value={fmt$(compareResult.analysis.total_savings)} accent="var(--color-accent-income)" />
              <Row label="Break-even" value={compareResult.analysis.break_even_months != null ? compareResult.analysis.break_even_months + ' mo' : 'N/A'} />
              <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 4, background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: verdictColor }}>
                  {verdict?.replace(/_/g, ' ') || '—'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Loan Modification */}
      <div style={{ borderTop: '1px solid var(--structure)', paddingTop: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Loan Modification
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Modification Type</div>
            <select className="block-input" value={modType} onChange={e => setModType(e.target.value as any)} style={{ width: '100%' }}>
              <option value="rate_reduction">Rate Reduction</option>
              <option value="term_extension">Term Extension</option>
              <option value="forbearance">Forbearance</option>
              <option value="principal_reduction">Principal Reduction</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Reason (required)</div>
            <input className="block-input" type="text" placeholder="Hardship, refinance prep, etc."
              value={modReason} onChange={e => setModReason(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        {modType === 'rate_reduction' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>New Rate (%)</div>
            <input className="block-input" type="number" step="0.001" min="0" placeholder="e.g. 4.5"
              value={modRate} onChange={e => setModRate(e.target.value)} style={{ width: 180 }} />
          </div>
        )}
        {modType === 'term_extension' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>New Term (months)</div>
            <input className="block-input" type="number" step="1" min="1" placeholder="e.g. 480"
              value={modTerm} onChange={e => setModTerm(e.target.value)} style={{ width: 180 }} />
          </div>
        )}
        {modType === 'forbearance' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Forbearance Months</div>
            <input className="block-input" type="number" step="1" min="1" placeholder="e.g. 3"
              value={modForbearance} onChange={e => setModForbearance(e.target.value)} style={{ width: 180 }} />
          </div>
        )}
        {modType === 'principal_reduction' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Reduction Amount ($)</div>
            <input className="block-input" type="number" step="0.01" min="0" placeholder="e.g. 5000"
              value={modPrincipalRed} onChange={e => setModPrincipalRed(e.target.value)} style={{ width: 180 }} />
          </div>
        )}
        <button className="block-btn" onClick={handleMod} disabled={modLoading}>
          {modLoading ? 'Applying…' : 'Apply Modification'}
        </button>
        {modErr && <ErrBox msg={modErr} />}
        {modResult && !modResult.error && (
          <div style={{ marginTop: 8, padding: 10, background: 'color-mix(in srgb, var(--color-accent-income) 8%, transparent)', border: '1px solid var(--color-accent-income)', borderRadius: 6, fontSize: 12 }}>
            <CheckCircle size={12} style={{ display: 'inline', marginRight: 4, color: 'var(--color-accent-income)' }} />
            Modification applied. Effective: {fmtDate(modResult.effective_date)}.
          </div>
        )}
      </div>

      {/* Recast */}
      <div style={{ borderTop: '1px solid var(--structure)', paddingTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Recast Schedule
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
          Rebuilds the amortization schedule from current balance and rate. Use after a rate change or extra principal payment.
        </div>
        <button className="block-btn" onClick={handleRecast} disabled={recastLoading}>
          {recastLoading ? 'Recasting…' : 'Recast Schedule'}
        </button>
        {recastErr && <ErrBox msg={recastErr} />}
        {recastResult && !recastResult.error && (
          <div style={{ marginTop: 8, padding: 10, background: 'color-mix(in srgb, var(--color-accent-income) 8%, transparent)', border: '1px solid var(--color-accent-income)', borderRadius: 6, fontSize: 12 }}>
            <CheckCircle size={12} style={{ display: 'inline', marginRight: 4, color: 'var(--color-accent-income)' }} />
            Schedule recast. New monthly payment: <strong>{fmt$(recastResult.new_payment)}</strong> over {recastResult.remaining_payments} payments.
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Section 2 — Payoff Accelerators
// ════════════════════════════════════════════════════════════════════════════

function AcceleratorsSection({ loanId }: { loanId: string }) {
  // Biweekly impact
  const [biweeklyData, setBiweeklyData] = useState<any>(null);
  const [biweeklyLoading, setBiweeklyLoading] = useState(false);
  const [biweeklyErr, setBiweeklyErr] = useState('');

  // Lump principal
  const [lumpAmount, setLumpAmount] = useState('');
  const [lumpDate, setLumpDate] = useState('');
  const [lumpNotes, setLumpNotes] = useState('');
  const [lumpLoading, setLumpLoading] = useState(false);
  const [lumpResult, setLumpResult] = useState<any>(null);
  const [lumpErr, setLumpErr] = useState('');

  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    setBiweeklyData(null);
    setBiweeklyErr('');
    setLumpResult(null);
    setLumpErr('');
    return () => { cancelRef.current = true; };
  }, [loanId]);

  async function loadBiweekly() {
    setBiweeklyLoading(true);
    setBiweeklyErr('');
    setBiweeklyData(null);
    try {
      const r = await api.laBiweeklyImpact(loanId);
      if (cancelRef.current) return;
      if (r && (r as any).error) { setBiweeklyErr((r as any).error); return; }
      setBiweeklyData(r);
    } catch (e: any) {
      if (!cancelRef.current) setBiweeklyErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setBiweeklyLoading(false);
    }
  }

  async function handleLumpPrincipal() {
    if (!lumpAmount || parseFloat(lumpAmount) <= 0) { setLumpErr('Enter a positive amount.'); return; }
    if (!window.confirm(`Apply a $${parseFloat(lumpAmount).toLocaleString()} lump-sum principal payment to this loan?`)) return;
    setLumpLoading(true);
    setLumpErr('');
    setLumpResult(null);
    try {
      const r = await api.laLumpPrincipal({
        loan_id: loanId,
        amount: parseFloat(lumpAmount),
        payment_date: lumpDate || undefined,
        notes: lumpNotes || undefined,
      });
      if (cancelRef.current) return;
      if (r && (r as any).error) { setLumpErr((r as any).error); return; }
      setLumpResult(r);
    } catch (e: any) {
      if (!cancelRef.current) setLumpErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setLumpLoading(false);
    }
  }

  return (
    <div className="block-card" style={{ padding: 20, marginBottom: 16 }}>
      <SectionHeader icon={<Zap size={15} />} title="Payoff Accelerators" />

      {/* Biweekly Impact */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Biweekly Conversion Impact
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
          Switching to biweekly payments results in one extra full payment per year, reducing total interest and payoff time.
        </div>
        <button className="block-btn" onClick={loadBiweekly} disabled={biweeklyLoading}>
          {biweeklyLoading ? 'Calculating…' : 'Calculate Biweekly Impact'}
        </button>
        {biweeklyErr && <ErrBox msg={biweeklyErr} />}
        {biweeklyData && !biweeklyData.error && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 6 }}>Schedule</div>
              <Row label="Current Monthly Payment" value={fmt$(biweeklyData.monthly_payment)} />
              <Row label="Biweekly Payment" value={fmt$(biweeklyData.biweekly_payment)} />
              <Row label="Extra Per Year" value={fmt$(biweeklyData.extra_per_year)} accent="var(--color-accent-income)" />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 6 }}>Savings</div>
              <Row label="Current Payoff" value={biweeklyData.original_payoff_months + ' mo'} />
              <Row label="Biweekly Payoff" value={biweeklyData.biweekly_payoff_months + ' mo'} />
              <Row label="Months Saved" value={biweeklyData.months_saved + ' mo'} accent="var(--color-accent-income)" />
              <Row label="Interest Saved" value={fmt$(biweeklyData.interest_savings)} accent="var(--color-accent-income)" />
            </div>
          </div>
        )}
      </div>

      {/* Lump-Sum Principal */}
      <div style={{ borderTop: '1px solid var(--structure)', paddingTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Lump-Sum Principal Payment
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Amount ($)</div>
            <input className="block-input" type="number" step="0.01" min="0" placeholder="e.g. 10000"
              value={lumpAmount} onChange={e => setLumpAmount(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Payment Date</div>
            <input className="block-input" type="date"
              value={lumpDate} onChange={e => setLumpDate(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Notes</div>
            <input className="block-input" type="text" placeholder="optional"
              value={lumpNotes} onChange={e => setLumpNotes(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        <button className="block-btn" onClick={handleLumpPrincipal} disabled={lumpLoading}>
          {lumpLoading ? 'Applying…' : 'Apply Lump Payment'}
        </button>
        {lumpErr && <ErrBox msg={lumpErr} />}
        {lumpResult && !lumpResult.error && (
          <div style={{ marginTop: 8, padding: 10, background: 'color-mix(in srgb, var(--color-accent-income) 8%, transparent)', border: '1px solid var(--color-accent-income)', borderRadius: 6, fontSize: 12 }}>
            <CheckCircle size={12} style={{ display: 'inline', marginRight: 4, color: 'var(--color-accent-income)' }} />
            Payment recorded. New balance: <strong>{fmt$(lumpResult.new_balance)}</strong>.
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Section 3 — Covenants & Risk
// ════════════════════════════════════════════════════════════════════════════

function CovenantRiskSection({ loanId }: { loanId: string }) {
  // Breaches + upcoming (company-wide)
  const [breaches, setBreaches] = useState<any[] | null>(null);
  const [upcoming, setUpcoming] = useState<any[] | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskErr, setRiskErr] = useState('');

  // DSCR
  const [dscrData, setDscrData] = useState<any>(null);
  const [dscrLoading, setDscrLoading] = useState(false);
  const [dscrErr, setDscrErr] = useState('');

  // LTV
  const [ltvData, setLtvData] = useState<any>(null);
  const [ltvLoading, setLtvLoading] = useState(false);
  const [ltvErr, setLtvErr] = useState('');

  // Stress
  const [shockPct, setShockPct] = useState('2');
  const [stressData, setStressData] = useState<any>(null);
  const [stressLoading, setStressLoading] = useState(false);
  const [stressErr, setStressErr] = useState('');

  // Create covenant
  const [covName, setCovName] = useState('');
  const [covMetric, setCovMetric] = useState<'dscr' | 'current_ratio' | 'debt_to_equity' | 'quick_ratio' | 'interest_coverage'>('dscr');
  const [covOp, setCovOp] = useState<'>=' | '<=' | '='>('>=');
  const [covThreshold, setCovThreshold] = useState('');
  const [covFreq, setCovFreq] = useState<'monthly' | 'quarterly' | 'annual'>('quarterly');
  const [covNotes, setCovNotes] = useState('');
  const [covLoading, setCovLoading] = useState(false);
  const [covResult, setCovResult] = useState<any>(null);
  const [covErr, setCovErr] = useState('');

  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    setBreaches(null);
    setUpcoming(null);
    setRiskErr('');
    setDscrData(null);
    setDscrErr('');
    setLtvData(null);
    setLtvErr('');
    setStressData(null);
    setStressErr('');
    setCovResult(null);
    setCovErr('');
    return () => { cancelRef.current = true; };
  }, [loanId]);

  async function loadRisk() {
    setRiskLoading(true);
    setRiskErr('');
    try {
      const b = await api.laCovenantBreaches();
      if (cancelRef.current) return;
      setBreaches(Array.isArray(b) ? b : []);

      const u = await api.laCovenantUpcoming(30);
      if (cancelRef.current) return;
      setUpcoming(Array.isArray(u) ? u : []);
    } catch (e: any) {
      if (!cancelRef.current) setRiskErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setRiskLoading(false);
    }
  }

  async function loadDscr() {
    setDscrLoading(true);
    setDscrErr('');
    setDscrData(null);
    try {
      const r = await api.laDscr();
      if (cancelRef.current) return;
      if (r && (r as any).error) { setDscrErr((r as any).error); return; }
      setDscrData(r);
    } catch (e: any) {
      if (!cancelRef.current) setDscrErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setDscrLoading(false);
    }
  }

  async function loadLtv() {
    setLtvLoading(true);
    setLtvErr('');
    setLtvData(null);
    try {
      const r = await api.laLtv(loanId);
      if (cancelRef.current) return;
      if (r && (r as any).error) { setLtvErr((r as any).error); return; }
      setLtvData(r);
    } catch (e: any) {
      if (!cancelRef.current) setLtvErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setLtvLoading(false);
    }
  }

  async function loadStress() {
    const shock = parseFloat(shockPct);
    if (isNaN(shock) || shock <= 0) { setStressErr('Enter a positive shock percentage.'); return; }
    setStressLoading(true);
    setStressErr('');
    setStressData(null);
    try {
      const r = await api.laStressRateShock(loanId, shock);
      if (cancelRef.current) return;
      if (r && (r as any).error) { setStressErr((r as any).error); return; }
      setStressData(r);
    } catch (e: any) {
      if (!cancelRef.current) setStressErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setStressLoading(false);
    }
  }

  async function handleCreateCovenant() {
    if (!covName.trim()) { setCovErr('Covenant name is required.'); return; }
    if (!covThreshold || isNaN(parseFloat(covThreshold))) { setCovErr('Threshold value is required.'); return; }
    setCovLoading(true);
    setCovErr('');
    setCovResult(null);
    try {
      const r = await api.laCovenantCreate({
        loan_id: loanId,
        covenant_name: covName,
        metric: covMetric,
        operator: covOp,
        threshold_value: parseFloat(covThreshold),
        measurement_frequency: covFreq,
        notes: covNotes || undefined,
      });
      if (cancelRef.current) return;
      if (r && (r as any).error) { setCovErr((r as any).error); return; }
      setCovResult(r);
      // Refresh breach/upcoming list
      loadRisk();
    } catch (e: any) {
      if (!cancelRef.current) setCovErr(e.message || 'Error');
    } finally {
      if (!cancelRef.current) setCovLoading(false);
    }
  }

  const dscrBandColor = (band: string) =>
    band === 'strong' ? 'var(--color-accent-income)'
      : band === 'adequate' ? 'var(--color-accent-warning)'
      : 'var(--color-accent-expense)';

  const ltvBandColor = (band: string) =>
    band === 'low_risk' ? 'var(--color-accent-income)'
      : band === 'standard' ? 'var(--color-accent-warning)'
      : 'var(--color-accent-expense)';

  return (
    <div className="block-card" style={{ padding: 20, marginBottom: 16 }}>
      <SectionHeader icon={<Shield size={15} />} title="Covenants & Risk" />

      {/* DSCR / LTV / Stress row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* DSCR */}
        <div style={{ padding: 12, background: 'var(--color-bg-secondary)', borderRadius: 6, border: '1px solid var(--hairline)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            DSCR (Debt Service Coverage)
          </div>
          <button className="block-btn" style={{ fontSize: 11, marginBottom: 8 }} onClick={loadDscr} disabled={dscrLoading}>
            {dscrLoading ? 'Loading…' : 'Compute DSCR'}
          </button>
          {dscrErr && <ErrBox msg={dscrErr} />}
          {dscrData && !dscrData.error && (
            <>
              {dscrData.dscr != null ? (
                <>
                  <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'SF Mono, Menlo, monospace', color: dscrBandColor(dscrData.band) }}>
                    {num(dscrData.dscr, 2)}x
                  </div>
                  <div style={{ fontSize: 10, color: dscrBandColor(dscrData.band), fontWeight: 700, marginBottom: 6 }}>
                    {dscrData.band?.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <Row label="NOI" value={fmt$(dscrData.noi)} />
                  <Row label="Annual Debt Service" value={fmt$(dscrData.debt_service)} />
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{dscrData.reason || 'N/A'}</div>
              )}
            </>
          )}
        </div>

        {/* LTV */}
        <div style={{ padding: 12, background: 'var(--color-bg-secondary)', borderRadius: 6, border: '1px solid var(--hairline)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            LTV (Loan-to-Value)
          </div>
          <button className="block-btn" style={{ fontSize: 11, marginBottom: 8 }} onClick={loadLtv} disabled={ltvLoading}>
            {ltvLoading ? 'Loading…' : 'Compute LTV'}
          </button>
          {ltvErr && <ErrBox msg={ltvErr} />}
          {ltvData && !ltvData.error && (
            <>
              {ltvData.ltv != null ? (
                <>
                  <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'SF Mono, Menlo, monospace', color: ltvBandColor(ltvData.band) }}>
                    {pct(ltvData.ltv, 1)}
                  </div>
                  <div style={{ fontSize: 10, color: ltvBandColor(ltvData.band), fontWeight: 700, marginBottom: 6 }}>
                    {ltvData.band?.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <Row label="Balance" value={fmt$(ltvData.current_balance)} />
                  <Row label="Collateral Value" value={fmt$(ltvData.collateral_value)} />
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{ltvData.reason || 'No collateral'}</div>
              )}
            </>
          )}
        </div>

        {/* Rate Shock Stress */}
        <div style={{ padding: 12, background: 'var(--color-bg-secondary)', borderRadius: 6, border: '1px solid var(--hairline)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Rate Shock Stress Test
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <input className="block-input" type="number" step="0.5" min="0.5" placeholder="e.g. 2"
              value={shockPct} onChange={e => setShockPct(e.target.value)} style={{ width: 70 }} />
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>% shock</span>
            <button className="block-btn" style={{ fontSize: 11 }} onClick={loadStress} disabled={stressLoading}>
              {stressLoading ? '…' : 'Test'}
            </button>
          </div>
          {stressErr && <ErrBox msg={stressErr} />}
          {stressData && !stressData.error && (
            <>
              <Row label="Current Rate" value={pct(stressData.current_rate_pct)} />
              <Row label="Shocked Rate" value={pct(stressData.shocked_rate_pct)} accent="var(--color-accent-expense)" />
              <Row label="Current Monthly" value={fmt$(stressData.current_monthly)} />
              <Row label="Shocked Monthly" value={fmt$(stressData.shocked_monthly)} accent="var(--color-accent-expense)" />
              <Row label="Monthly Delta" value={fmt$(stressData.monthly_delta)} accent="var(--color-accent-expense)" />
              <Row label="Annual Impact" value={fmt$(stressData.annual_impact)} accent="var(--color-accent-expense)" />
            </>
          )}
        </div>
      </div>

      {/* Covenant Breaches + Upcoming */}
      <div style={{ borderTop: '1px solid var(--structure)', paddingTop: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Covenant Monitoring
          </div>
          <button className="block-btn" style={{ fontSize: 11 }} onClick={loadRisk} disabled={riskLoading}>
            {riskLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {riskErr && <ErrBox msg={riskErr} />}

        {breaches !== null && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6, fontWeight: 700 }}>
              Active Breaches ({breaches.length})
            </div>
            {breaches.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={13} style={{ color: 'var(--color-accent-income)' }} /> No covenant breaches
              </div>
            ) : (
              <table className="block-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    {['Covenant', 'Loan', 'Metric', 'Threshold', 'Last Value', 'Measured'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {breaches.map((b: any) => (
                    <tr key={b.id}>
                      <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600 }}>{b.covenant_name}</td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>{b.loan_name || '—'}</td>
                      <td style={{ padding: '6px 10px', fontSize: 11 }}>{b.metric}</td>
                      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace' }}>{b.operator} {b.threshold_value}</td>
                      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)', fontWeight: 700 }}>
                        {b.last_measured_value != null ? num(b.last_measured_value) : '—'}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>{fmtDate(b.last_measured_at?.slice(0, 10))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {upcoming !== null && upcoming.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6, fontWeight: 700 }}>
              Due in Next 30 Days ({upcoming.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {upcoming.map((u: any) => (
                <div key={u.id} style={{
                  padding: '4px 10px', fontSize: 10, background: 'var(--color-bg-primary)',
                  border: '1px solid var(--color-accent-warning)', borderRadius: 4, color: 'var(--color-accent-warning)',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <Clock size={10} /> {u.covenant_name} · {fmtDate(u.next_measurement_date)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create Covenant */}
      <div style={{ borderTop: '1px solid var(--structure)', paddingTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Add Covenant
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Covenant Name</div>
            <input className="block-input" type="text" placeholder="e.g. Min DSCR"
              value={covName} onChange={e => setCovName(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Metric</div>
            <select className="block-input" value={covMetric} onChange={e => setCovMetric(e.target.value as any)} style={{ width: '100%' }}>
              <option value="dscr">DSCR</option>
              <option value="current_ratio">Current Ratio</option>
              <option value="debt_to_equity">Debt/Equity</option>
              <option value="quick_ratio">Quick Ratio</option>
              <option value="interest_coverage">Interest Coverage</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Operator</div>
            <select className="block-input" value={covOp} onChange={e => setCovOp(e.target.value as any)} style={{ width: '100%' }}>
              <option value=">=">≥ (min)</option>
              <option value="<=">≤ (max)</option>
              <option value="=">=</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Threshold</div>
            <input className="block-input" type="number" step="0.01" placeholder="e.g. 1.25"
              value={covThreshold} onChange={e => setCovThreshold(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Frequency</div>
            <select className="block-input" value={covFreq} onChange={e => setCovFreq(e.target.value as any)} style={{ width: '100%' }}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3 }}>Notes</div>
          <input className="block-input" type="text" placeholder="optional"
            value={covNotes} onChange={e => setCovNotes(e.target.value)} style={{ width: '100%', maxWidth: 500 }} />
        </div>
        <button className="block-btn" onClick={handleCreateCovenant} disabled={covLoading}>
          {covLoading ? 'Creating…' : 'Create Covenant'}
        </button>
        {covErr && <ErrBox msg={covErr} />}
        {covResult && !covResult.error && (
          <div style={{ marginTop: 8, padding: 10, background: 'color-mix(in srgb, var(--color-accent-income) 8%, transparent)', border: '1px solid var(--color-accent-income)', borderRadius: 6, fontSize: 12 }}>
            <CheckCircle size={12} style={{ display: 'inline', marginRight: 4, color: 'var(--color-accent-income)' }} />
            Covenant created.
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Root Servicing component — loan picker + 3 sections
// ════════════════════════════════════════════════════════════════════════════

const Servicing: React.FC = () => {
  const [loans, setLoans] = useState<any[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [loansErr, setLoansErr] = useState('');
  const [selectedLoanId, setSelectedLoanId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoansLoading(true);
    api.loansList()
      .then(r => {
        if (cancelled) return;
        if (Array.isArray(r)) {
          setLoans(r.filter((l: any) => !l.deleted_at && l.status !== 'refinanced'));
        } else {
          setLoansErr((r as any).error || 'Failed to load loans');
        }
      })
      .catch(e => { if (!cancelled) setLoansErr(e.message || 'Error'); })
      .finally(() => { if (!cancelled) setLoansLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Auto-select first loan
  useEffect(() => {
    if (loans.length > 0 && !selectedLoanId) {
      setSelectedLoanId(loans[0].id);
    }
  }, [loans, selectedLoanId]);

  if (loansLoading) {
    return <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 13 }}>Loading loans…</div>;
  }
  if (loansErr) {
    return <div style={{ padding: 24 }}><ErrBox msg={loansErr} /></div>;
  }
  if (loans.length === 0) {
    return (
      <div className="block-card" style={{ padding: 32, textAlign: 'center', margin: 24 }}>
        <Activity size={28} style={{ margin: '0 auto 8px', opacity: 0.4, color: 'var(--color-text-muted)' }} />
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No active loans</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Add a loan first to use servicing tools.</div>
      </div>
    );
  }

  const selectedLoan = loans.find(l => l.id === selectedLoanId);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Loan picker */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Loan</span>
        <select
          className="block-input"
          value={selectedLoanId}
          onChange={e => setSelectedLoanId(e.target.value)}
          style={{ minWidth: 300 }}
        >
          {loans.map(l => (
            <option key={l.id} value={l.id}>
              {l.name}{l.lender_name ? ` — ${l.lender_name}` : ''}{l.current_balance ? ` · ${formatCurrency(l.current_balance)} bal` : ''}
            </option>
          ))}
        </select>
        {selectedLoan && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'SF Mono, Menlo, monospace' }}>
            {((selectedLoan.interest_rate || 0) * 100).toFixed(3)}% · {selectedLoan.term_months} mo · {selectedLoan.loan_type?.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {selectedLoanId && (
        <>
          <RefiSection key={`refi-${selectedLoanId}`} loanId={selectedLoanId} />
          <AcceleratorsSection key={`acc-${selectedLoanId}`} loanId={selectedLoanId} />
          <CovenantRiskSection key={`cov-${selectedLoanId}`} loanId={selectedLoanId} />
        </>
      )}
    </div>
  );
};

export default Servicing;
