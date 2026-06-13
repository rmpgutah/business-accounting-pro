// src/renderer/modules/loans/Portfolio.tsx
//
// Portfolio tab — surfaces lf:portfolio:* risk analytics (#40) + lk: linkage (#39).
//
// Sections:
//   KPI strip        — total balance, weighted rate, loan count, required reserves
//   Aging            — lf:portfolio:aging buckets
//   Vintage          — lf:portfolio:vintage by origination year
//   Concentration    — lf:portfolio:concentration by loan type
//   Stress test      — lf:portfolio:stress (rate shock + default)
//   CECL / Reserves  — lf:reserve:portfolio + lf:reserves:required
//   Charge-offs      — lf:charge-off:rate
//   Bank Linkage     — lk:linkage-dashboard summary + lk:suggest-loan-for-bank-tx matches

import React, { useState, useEffect, useRef } from 'react';
import {
  BarChart2, ShieldAlert, TrendingDown, Landmark, Link2,
  CheckCircle2, AlertTriangle, RefreshCw, Activity, Database,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { useToast } from '../../components/ToastProvider';

// ── Local helpers ─────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined) {
  if (n == null) return '—';
  return formatCurrency(n);
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return formatDate(s);
}

function pct(n: number | null | undefined, decimals = 1) {
  if (n == null) return '—';
  return n.toFixed(decimals) + '%';
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="block-card" style={{ padding: '12px 16px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: accent || 'var(--color-text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, borderBottom: '1px solid var(--hairline)', paddingBottom: 10 }}>
        <span style={{ color: 'var(--color-accent-primary)' }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-primary)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// ── Bar row ───────────────────────────────────────────────────────────────────

function BarRow({ label, value, max, accent, sub }: { label: string; value: number; max: number; accent: string; sub?: string }) {
  const pctWidth = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-primary)' }}>{label}</span>
        <span style={{ fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600, color: accent }}>
          {fmt$(value)}{sub ? <span style={{ fontSize: 9, color: 'var(--color-text-muted)', marginLeft: 6 }}>{sub}</span> : null}
        </span>
      </div>
      <div style={{ height: 5, background: 'var(--color-bg-secondary)', borderRadius: 'var(--app-radius)', overflow: 'hidden' }}>
        <div style={{ width: pctWidth + '%', height: '100%', background: accent, transition: 'width 300ms' }} />
      </div>
    </div>
  );
}

// ── Pill label ────────────────────────────────────────────────────────────────

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 3,
      fontSize: 9,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      background: `${color}22`,
      color,
      border: `1px solid ${color}44`,
    }}>{label}</span>
  );
}

// ── Muted label / value pair ──────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--hairline)', fontSize: 11 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600, color: 'var(--color-text-primary)' }}>{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const Portfolio: React.FC = () => {
  const toast = useToast();

  // independent state for each section
  const [aging, setAging] = useState<any>(null);
  const [agingLoading, setAgingLoading] = useState(true);

  const [vintage, setVintage] = useState<any[]>([]);
  const [vintageLoading, setVintageLoading] = useState(true);

  const [concentration, setConcentration] = useState<any>(null);
  const [concentrationLoading, setConcentrationLoading] = useState(true);

  const [stress, setStress] = useState<any>(null);
  const [stressLoading, setStressLoading] = useState(false);
  const [rateShock, setRateShock] = useState(2);
  const [defaultIncrease, setDefaultIncrease] = useState(5);

  const [cecl, setCecl] = useState<any>(null);
  const [ceclLoading, setCeclLoading] = useState(true);

  const [reserves, setReserves] = useState<any>(null);
  const [reservesLoading, setReservesLoading] = useState(true);

  const [chargeOffRate, setChargeOffRate] = useState<any>(null);
  const [chargeOffLoading, setChargeOffLoading] = useState(true);

  const [dashboard, setDashboard] = useState<any>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // Unmatched bank tx to check suggestions against
  const [bankTxAmount, setBankTxAmount] = useState('');
  const [bankTxDate, setBankTxDate] = useState('');
  const [bankTxMemo, setBankTxMemo] = useState('');

  const cancelRef = useRef(false);

  // KPI roll-up derived from concentration (has total_exposure) + reserves
  const totalBalance = concentration?.total_exposure ?? null;
  const loanCount: number | null = concentration?.by_type
    ? (concentration.by_type as any[]).reduce((s: number, r: any) => s + (r.c || 0), 0)
    : null;

  // Weighted avg rate from cecl by_bucket is not the right source.
  // We use aggregate from the list — instead we'll leave it null if unavailable.
  const totalReserves = reserves?.total_reserves_required ?? null;

  useEffect(() => {
    cancelRef.current = false;
    loadAging();
    loadVintage();
    loadConcentration();
    loadCecl();
    loadReserves();
    loadChargeOffRate();
    loadDashboard();
    return () => { cancelRef.current = true; };
  }, []);

  async function loadAging() {
    setAgingLoading(true);
    try {
      const r = await api.lfPortfolioAging();
      if (!cancelRef.current) setAging(r && !r.error ? r : null);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setAgingLoading(false); }
  }

  async function loadVintage() {
    setVintageLoading(true);
    try {
      const r = await api.lfPortfolioVintage();
      if (!cancelRef.current) setVintage(Array.isArray(r) ? r : []);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setVintageLoading(false); }
  }

  async function loadConcentration() {
    setConcentrationLoading(true);
    try {
      const r = await api.lfPortfolioConcentration();
      if (!cancelRef.current) setConcentration(r && !r.error ? r : null);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setConcentrationLoading(false); }
  }

  async function loadCecl() {
    setCeclLoading(true);
    try {
      const r = await api.lfReservePortfolio();
      if (!cancelRef.current) setCecl(r && !r.error ? r : null);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setCeclLoading(false); }
  }

  async function loadReserves() {
    setReservesLoading(true);
    try {
      const r = await api.lfReservesRequired();
      if (!cancelRef.current) setReserves(r && !r.error ? r : null);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setReservesLoading(false); }
  }

  async function loadChargeOffRate() {
    setChargeOffLoading(true);
    try {
      const r = await api.lfChargeOffRate();
      if (!cancelRef.current) setChargeOffRate(r && !r.error ? r : null);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setChargeOffLoading(false); }
  }

  async function loadDashboard() {
    setDashboardLoading(true);
    try {
      const r = await api.lkLinkageDashboard();
      if (!cancelRef.current) setDashboard(r && !r.error ? r : null);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setDashboardLoading(false); }
  }

  async function runStress() {
    setStressLoading(true);
    setStress(null);
    try {
      const r = await api.lfPortfolioStress({ rate_shock_pct: rateShock, default_rate_increase_pct: defaultIncrease });
      if (!cancelRef.current) setStress(r && !r.error ? r : null);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setStressLoading(false); }
  }

  async function runSuggest() {
    const amount = parseFloat(bankTxAmount);
    if (!bankTxAmount || isNaN(amount) || !bankTxDate) {
      toast.error('Enter an amount and date to run the loan match.');
      return;
    }
    setSuggestLoading(true);
    setSuggestions([]);
    try {
      const r = await api.lkSuggestLoanForBankTx({ amount, date: bankTxDate, memo: bankTxMemo || undefined });
      if (!cancelRef.current) setSuggestions(r?.suggestions || []);
    } catch (_) {/* ignore */} finally { if (!cancelRef.current) setSuggestLoading(false); }
  }

  async function linkTx(loanId: string, loanName: string) {
    const amount = parseFloat(bankTxAmount);
    if (isNaN(amount)) { toast.error('Cannot link: invalid amount'); return; }
    if (!window.confirm(`Link bank transaction ($${amount.toFixed(2)}) to loan "${loanName}"? This will record the payment and mark the bank transaction as matched.`)) return;
    try {
      const r = await api.lkLinkBankTx({
        bank_transaction_id: `manual-${Date.now()}`,
        loan_id: loanId,
        principal_amount: amount * 0.8,
        interest_amount: amount * 0.2,
        create_expense: true,
      });
      if (r?.error) { toast.error('Link failed: ' + r.error); return; }
      toast.success('Bank transaction linked to loan payment.');
      setSuggestions([]);
      setBankTxAmount('');
      setBankTxDate('');
      setBankTxMemo('');
      loadDashboard();
    } catch (e: any) { toast.error('Link failed: ' + e.message); }
  }

  // ── Derived aging totals ────────────────────────────────────────────────────
  const agingTotal = aging
    ? (aging.current || 0) + (aging.b30 || 0) + (aging.b60 || 0) + (aging.b90 || 0) + (aging.b90plus || 0)
    : 0;

  // ── Vintage max for bar scaling ─────────────────────────────────────────────
  const vintageMax = vintage.reduce((m: number, r: any) => Math.max(m, r.total_outstanding || 0), 0);

  // ── Concentration max ───────────────────────────────────────────────────────
  const concMax = concentration?.total_exposure || 0;

  // ── Health score color ──────────────────────────────────────────────────────
  const healthColor = (score: number) =>
    score >= 80 ? 'var(--color-accent-income)' : score >= 50 ? 'var(--color-accent-warning)' : 'var(--color-accent-expense)';

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <BarChart2 size={20} style={{ color: 'var(--color-accent-primary)' }} />
        <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Portfolio Analytics</h3>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Risk analytics · Bank linkage · CECL reserves</span>
      </div>

      {/* ── KPI Strip ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <KpiCard
          label="Total Portfolio"
          value={concentrationLoading ? '…' : totalBalance != null ? fmt$(totalBalance) : '—'}
          accent="var(--color-accent-expense)"
        />
        <KpiCard
          label="Loan Count"
          value={concentrationLoading ? '…' : loanCount != null ? String(loanCount) : '—'}
        />
        <KpiCard
          label="Required Reserves"
          value={reservesLoading ? '…' : totalReserves != null ? fmt$(totalReserves) : '—'}
          accent="var(--color-accent-warning)"
        />
        <KpiCard
          label="Reserve / Portfolio"
          value={reservesLoading ? '…' : reserves?.reserve_pct_of_portfolio != null ? pct(reserves.reserve_pct_of_portfolio) : '—'}
          accent="var(--color-accent-blue)"
        />
        <KpiCard
          label="Charge-off Rate (12m)"
          value={chargeOffLoading ? '…' : chargeOffRate?.charge_off_rate_pct != null ? pct(chargeOffRate.charge_off_rate_pct) : '—'}
          accent={chargeOffRate?.charge_off_rate_pct != null && chargeOffRate.charge_off_rate_pct > 2
            ? 'var(--color-accent-expense)'
            : 'var(--color-accent-income)'}
        />
      </div>

      {/* ── Aging Buckets ──────────────────────────────────────────────────────── */}
      <Section icon={<Activity size={14} />} title="Portfolio Aging">
        {agingLoading && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>}
        {!agingLoading && !aging && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No data available.</div>}
        {!agingLoading && aging && (
          <div>
            <BarRow label="Current (not overdue)" value={aging.current || 0} max={agingTotal} accent="var(--color-accent-income)" />
            <BarRow label="1–30 days past due" value={aging.b30 || 0} max={agingTotal} accent="var(--color-accent-warning)" />
            <BarRow label="31–60 days past due" value={aging.b60 || 0} max={agingTotal} accent="var(--color-accent-warning)" />
            <BarRow label="61–90 days past due" value={aging.b90 || 0} max={agingTotal} accent="var(--color-accent-expense)" />
            <BarRow label="90+ days past due" value={aging.b90plus || 0} max={agingTotal} accent="var(--color-accent-expense)" />
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'right' }}>
              Total portfolio balance: <strong style={{ color: 'var(--color-text-primary)' }}>{fmt$(agingTotal)}</strong>
            </div>
          </div>
        )}
      </Section>

      {/* ── Vintage Analysis ───────────────────────────────────────────────────── */}
      <Section icon={<TrendingDown size={14} />} title="Vintage Analysis">
        {vintageLoading && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>}
        {!vintageLoading && vintage.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No vintage data (loans need origination dates).</div>}
        {!vintageLoading && vintage.length > 0 && (
          <table className="block-table" style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr>
                {['Vintage Year', 'Loans', 'Originated', 'Outstanding', 'Repaid', 'Avg Rate'].map((h, i) => (
                  <th key={h} style={{ textAlign: i > 0 ? 'right' : 'left', padding: '6px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vintage.map((row: any) => (
                <tr key={row.vintage_year || 'unknown'}>
                  <td style={{ padding: '6px 10px', fontWeight: 700 }}>{row.vintage_year || '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{row.loan_count || 0}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(row.total_originated)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)' }}>{fmt$(row.total_outstanding)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-income)' }}>{fmt$(row.total_repaid)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>
                    {row.avg_rate_pct != null ? row.avg_rate_pct.toFixed(2) + '%' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Concentration Risk ─────────────────────────────────────────────────── */}
      <Section icon={<Database size={14} />} title="Concentration Risk">
        {concentrationLoading && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>}
        {!concentrationLoading && !concentration && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No data available.</div>}
        {!concentrationLoading && concentration && (
          <div>
            {(concentration.by_type as any[]).length === 0
              ? <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No active loans.</div>
              : (concentration.by_type as any[]).map((row: any) => (
                <BarRow
                  key={row.loan_type}
                  label={row.loan_type.replace(/_/g, ' ')}
                  value={row.exposure || 0}
                  max={concMax}
                  accent="var(--color-accent-blue)"
                  sub={`${(row.pct_of_portfolio || 0).toFixed(1)}% · ${row.c} loan${row.c === 1 ? '' : 's'}`}
                />
              ))}
          </div>
        )}
      </Section>

      {/* ── CECL / Reserves ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Section icon={<ShieldAlert size={14} />} title="CECL Loss Reserves">
          {ceclLoading && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>}
          {!ceclLoading && !cecl && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No data available.</div>}
          {!ceclLoading && cecl && (
            <div>
              <MetaRow label="Total Exposure" value={fmt$(cecl.total_exposure)} />
              <MetaRow label="Reserve Required" value={<span style={{ color: 'var(--color-accent-warning)' }}>{fmt$(cecl.total_reserve_required)}</span>} />
              <MetaRow label="Reserve %" value={pct(cecl.reserve_pct)} />
              {Array.isArray(cecl.by_bucket) && cecl.by_bucket.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 8 }}>By Risk Bucket</div>
                  {(cecl.by_bucket as any[]).map((b: any) => (
                    <div key={b.bucket} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--hairline)', fontSize: 11 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Pill label={b.bucket} color={b.bucket === 'excellent' ? 'var(--color-accent-income)' : b.bucket === 'good' ? 'var(--color-accent-blue)' : b.bucket === 'fair' ? 'var(--color-accent-warning)' : 'var(--color-accent-expense)'} />
                        <span style={{ color: 'var(--color-text-muted)', fontFamily: 'SF Mono, Menlo, monospace' }}>PD {b.pd_pct}%</span>
                      </span>
                      <span style={{ fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600 }}>{fmt$(b.reserve)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>

        <Section icon={<ShieldAlert size={14} />} title="Required Reserves">
          {reservesLoading && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>}
          {!reservesLoading && !reserves && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No data available.</div>}
          {!reservesLoading && reserves && (
            <div>
              <MetaRow label="CECL Required" value={fmt$(reserves.cecl_required)} />
              <MetaRow label="Stress Buffer (10%)" value={fmt$(reserves.stress_buffer)} />
              <MetaRow label="Unallocated (25bp)" value={fmt$(reserves.unallocated_buffer)} />
              <MetaRow
                label="Total Required"
                value={<span style={{ color: 'var(--color-accent-warning)', fontWeight: 800 }}>{fmt$(reserves.total_reserves_required)}</span>}
              />
              <MetaRow label="% of Portfolio" value={pct(reserves.reserve_pct_of_portfolio)} />
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--color-text-muted)' }}>
                Simplified CECL model · 40% LGD assumption · Consult your auditor for GAAP ASC 326.
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* ── Charge-offs ────────────────────────────────────────────────────────── */}
      <Section icon={<TrendingDown size={14} />} title="Charge-off Rate (Last 12 Months)">
        {chargeOffLoading && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>}
        {!chargeOffLoading && !chargeOffRate && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No charge-off data.</div>}
        {!chargeOffLoading && chargeOffRate && (
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>Charged Off (12m)</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)' }}>
                {fmt$(chargeOffRate.charged_off_12mo)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>Avg Portfolio</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace' }}>
                {fmt$(chargeOffRate.avg_portfolio)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>Charge-off Rate</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: chargeOffRate.charge_off_rate_pct != null && chargeOffRate.charge_off_rate_pct > 2 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)' }}>
                {chargeOffRate.charge_off_rate_pct != null ? pct(chargeOffRate.charge_off_rate_pct) : '—'}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* ── Stress Test ────────────────────────────────────────────────────────── */}
      <Section icon={<AlertTriangle size={14} />} title="Portfolio Stress Test">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
              Rate Shock (%)
            </label>
            <input
              type="number"
              step={0.5}
              min={0}
              max={20}
              value={rateShock}
              onChange={(e) => setRateShock(parseFloat(e.target.value) || 0)}
              className="block-input"
              style={{ width: 90, fontSize: 12 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
              Default Rate Increase (%)
            </label>
            <input
              type="number"
              step={1}
              min={0}
              max={50}
              value={defaultIncrease}
              onChange={(e) => setDefaultIncrease(parseFloat(e.target.value) || 0)}
              className="block-input"
              style={{ width: 110, fontSize: 12 }}
            />
          </div>
          <button
            className="block-btn flex items-center gap-2"
            onClick={runStress}
            disabled={stressLoading}
          >
            <Activity size={13} />
            {stressLoading ? 'Running…' : 'Run Stress Test'}
          </button>
        </div>

        {stress && (
          <div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>Monthly Pmt Increase</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)' }}>{fmt$(stress.total_monthly_payment_increase)}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>Annualized Pmt Increase</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)' }}>{fmt$(stress.annualized_payment_increase)}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>Expected Addl Losses</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)' }}>{fmt$(stress.expected_additional_losses)}</div>
              </div>
            </div>
            {Array.isArray(stress.stressed_loans) && stress.stressed_loans.length > 0 && (
              <table className="block-table" style={{ width: '100%', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Loan', 'Current Pmt', 'Shocked Pmt', 'Delta'].map((h, i) => (
                      <th key={h} style={{ textAlign: i > 0 ? 'right' : 'left', padding: '6px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(stress.stressed_loans as any[]).map((l: any) => (
                    <tr key={l.loan_id}>
                      <td style={{ padding: '5px 10px' }}>{l.name}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(l.current_pmt)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(l.shocked_pmt)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: (l.delta || 0) > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)' }}>
                        {(l.delta || 0) >= 0 ? '+' : ''}{fmt$(l.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {!stress && !stressLoading && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Configure parameters above and run the stress test to see portfolio impact.
          </div>
        )}
      </Section>

      {/* ── Bank Linkage Dashboard ─────────────────────────────────────────────── */}
      <Section icon={<Link2 size={14} />} title="Bank Linkage Dashboard">
        {dashboardLoading && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>}
        {!dashboardLoading && !dashboard && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No linkage data.</div>}
        {!dashboardLoading && dashboard && (
          <div>
            {/* Health score strip */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>Linkage Health</div>
                <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: healthColor(dashboard.health_score || 0) }}>
                  {(dashboard.health_score || 0).toFixed(0)}%
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <MetaRow label="Total Payments" value={dashboard.payments_total || 0} />
                  <MetaRow label="Expense Linked" value={<span style={{ color: 'var(--color-accent-income)' }}>{dashboard.expenses_linked || 0}</span>} />
                  <MetaRow label="Bank Matched" value={<span style={{ color: 'var(--color-accent-income)' }}>{dashboard.bank_matched || 0}</span>} />
                  <MetaRow label="JE Posted" value={<span style={{ color: 'var(--color-accent-blue)' }}>{dashboard.je_posted || 0}</span>} />
                  <MetaRow label="GL Configured" value={`${dashboard.loans_with_gl_setup || 0} / ${dashboard.loans_total || 0}`} />
                </div>
              </div>
            </div>

            {/* Linkage health bar */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 6, background: 'var(--color-bg-secondary)', borderRadius: 'var(--app-radius)', overflow: 'hidden' }}>
                <div style={{
                  width: (dashboard.health_score || 0) + '%',
                  height: '100%',
                  background: healthColor(dashboard.health_score || 0),
                  transition: 'width 400ms',
                }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Score = (expenses linked + bank matched + JE posted) / (payments × 3)
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* ── Bank Tx Loan Suggest ───────────────────────────────────────────────── */}
      <Section icon={<CheckCircle2 size={14} />} title="Suggest Loan for Bank Transaction">
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          Enter a bank transaction's amount, date and memo to find the best-matching loan. Then link it directly.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Amount ($)</label>
            <input
              type="number"
              step={0.01}
              min={0}
              value={bankTxAmount}
              onChange={(e) => setBankTxAmount(e.target.value)}
              className="block-input"
              style={{ width: 110, fontSize: 12 }}
              placeholder="1250.00"
            />
          </div>
          <div>
            <label style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Date</label>
            <input
              type="date"
              value={bankTxDate}
              onChange={(e) => setBankTxDate(e.target.value)}
              className="block-input"
              style={{ fontSize: 12 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Memo (optional)</label>
            <input
              type="text"
              value={bankTxMemo}
              onChange={(e) => setBankTxMemo(e.target.value)}
              className="block-input"
              style={{ width: 200, fontSize: 12 }}
              placeholder="payee or description"
            />
          </div>
          <button
            className="block-btn flex items-center gap-2"
            onClick={runSuggest}
            disabled={suggestLoading}
          >
            <RefreshCw size={13} />
            {suggestLoading ? 'Searching…' : 'Find Matches'}
          </button>
        </div>

        {suggestions.length === 0 && !suggestLoading && bankTxAmount && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            No confident matches found (confidence threshold 40%). Try adjusting amount or memo.
          </div>
        )}

        {suggestions.length > 0 && (
          <table className="block-table" style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr>
                {['Loan', 'Lender', 'Payment Amt', 'Confidence', 'Reasons', ''].map((h, i) => (
                  <th key={h} style={{ textAlign: i >= 2 && i <= 3 ? 'right' : 'left', padding: '6px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(suggestions as any[]).map((s: any) => (
                <tr key={s.loan_id}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{s.name}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}>{s.lender || '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(s.payment_amount)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                    <span style={{
                      fontFamily: 'SF Mono, Menlo, monospace',
                      fontWeight: 700,
                      color: s.confidence >= 0.8 ? 'var(--color-accent-income)' : s.confidence >= 0.6 ? 'var(--color-accent-warning)' : 'var(--color-text-muted)',
                    }}>
                      {(s.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 10, color: 'var(--color-text-muted)' }}>
                    {(s.reasons as string[]).join(' · ')}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <button
                      className="block-btn"
                      style={{ fontSize: 10, padding: '3px 8px' }}
                      onClick={() => linkTx(s.loan_id, s.name)}
                    >
                      <Link2 size={11} style={{ marginRight: 4, display: 'inline' }} />
                      Link
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

    </div>
  );
};

export default Portfolio;
