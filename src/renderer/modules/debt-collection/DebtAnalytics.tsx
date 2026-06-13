import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  FileX,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Return-shape types ──────────────────────────────────

interface PortfolioHealth {
  totalDebts?: number;
  currentBalance?: number;
  totalCollected?: number;
  recoveryRate?: number;
  lossRate?: number;
  complianceIssues?: number;
  healthGrade?: string;
  riskDistribution?: RiskDist;
}

interface Concentration {
  totalDebts?: number;
  totalOutstanding?: number;
  top10PctConcentration?: number;
}

interface RiskDist {
  high: number;
  medium: number;
  low: number;
}

interface RecoveryForecast {
  promisedPayments?: number;
  installmentsDueNext30?: number;
}

interface RecoveryRate {
  totalOriginal?: number;
  totalRecovered?: number;
  totalWrittenOff?: number;
  recoveryRate?: number;
  lossRate?: number;
}

interface AgingBucket {
  label: string;
  count: number;
  total: number;
}

interface CollectorWorkload {
  collector: string;
  debt_count: number;
  total_balance: number;
  avg_age: number | null;
}

interface CollectorPerformance {
  collector: string;
  debts_assigned: number;
  total_outstanding: number;
  total_collected: number;
}

interface SettlementSummary {
  totalSettlements?: number;
  settlementTotal?: number;
  originalTotal?: number;
  avgDiscount?: number;
}

interface AvgSettlementDiscount {
  avg_discount: number | null;
  sample: number;
}

interface PendingSettlement {
  id: string;
  debtor_name: string;
  settlement_amount: number;
  original_balance: number;
  status: string;
  created_at: string;
}

interface FdcpaCheck {
  issues: string[];
  compliant: boolean;
  checkDate: string;
}

interface ContactRestriction {
  id: string;
  debtor_name: string;
  balance_due: number;
  do_not_call: number;
  cease_desist_active: number;
  preferred_contact_method: string;
}

interface StatuteExpiring {
  id: string;
  debtor_name: string;
  balance_due: number;
  statute_of_limitations_date: string;
  days_remaining: number;
}

interface WriteoffCandidate {
  id: string;
  debtor_name: string;
  balance_due: number;
  delinquent_date: string;
  age_days: number;
  current_stage: string;
}

interface SkipTraceNeeded {
  id: string;
  debtor_name: string;
  balance_due: number;
  trace_count: number;
}

interface BrokenPromise {
  id: string;
  debtor_name: string;
  balance_due: number;
  amount: number;
  promise_date: string;
}

// ─── Mini helpers ────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="block-card p-4 flex items-start gap-3">
      <div
        className="w-8 h-8 flex-shrink-0 flex items-center justify-center"
        style={{ color: accent || 'var(--accent-primary)', borderRadius: 'var(--app-radius)' }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted mb-0.5">{label}</p>
        <p className="text-base font-bold text-text-primary leading-tight">{value}</p>
        {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <tr>
      <td colSpan={99} className="py-6 text-center text-sm text-text-muted">
        {message}
      </td>
    </tr>
  );
}

function LoadingRow() {
  return (
    <tr>
      <td colSpan={99} className="py-6 text-center text-sm text-text-muted">
        Loading…
      </td>
    </tr>
  );
}

// ─── Grade badge ─────────────────────────────────────────

function GradeBadge({ grade }: { grade?: string }) {
  const colorMap: Record<string, string> = {
    A: 'var(--color-accent-income)',
    B: 'var(--accent-primary)',
    C: 'var(--color-accent-warning)',
    D: 'var(--color-accent-expense)',
  };
  const color = colorMap[grade || ''] || 'var(--color-accent-blue)';
  return (
    <span
      className="text-2xl font-black leading-none"
      style={{ color }}
    >
      {grade ?? '—'}
    </span>
  );
}

// ─── Section: Portfolio Health ────────────────────────────

function PortfolioHealthSection() {
  const [health, setHealth] = useState<PortfolioHealth | null>(null);
  const [concentration, setConcentration] = useState<Concentration | null>(null);
  const [riskDist, setRiskDist] = useState<RiskDist | null>(null);
  const [forecast, setForecast] = useState<RecoveryForecast | null>(null);
  const [recoveryRate, setRecoveryRate] = useState<RecoveryRate | null>(null);
  const [agingBuckets, setAgingBuckets] = useState<AgingBucket[]>([]);

  useEffect(() => {
    let cancelled = false;

    api.dcPortfolioHealth().then((d: PortfolioHealth) => { if (!cancelled) setHealth(d); }).catch(() => {});
    api.dcConcentration().then((d: Concentration) => { if (!cancelled) setConcentration(d); }).catch(() => {});
    api.dcRiskDistribution().then((d: RiskDist) => { if (!cancelled) setRiskDist(d); }).catch(() => {});
    api.dcRecoveryForecast().then((d: RecoveryForecast) => { if (!cancelled) setForecast(d); }).catch(() => {});
    api.dcRecoveryRate().then((d: RecoveryRate) => { if (!cancelled) setRecoveryRate(d); }).catch(() => {});
    api.dcAgingBuckets().then((d: AgingBucket[]) => { if (!cancelled) setAgingBuckets(d || []); }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  const totalRisk = riskDist ? (riskDist.high + riskDist.medium + riskDist.low) : 0;

  return (
    <div className="space-y-4">
      <SectionHeader title="Portfolio Health" sub="Recovery rate, concentration and risk distribution" />

      {/* Health grade + key stats */}
      <div className="block-card p-4 flex items-start gap-6">
        <div className="flex-shrink-0 text-center">
          <p className="text-xs text-text-muted mb-1">Health Grade</p>
          <GradeBadge grade={health?.healthGrade} />
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 flex-1 text-sm">
          <div>
            <span className="text-text-muted">Recovery Rate: </span>
            <span className="font-semibold" style={{ color: 'var(--color-accent-income)' }}>
              {health?.recoveryRate != null ? `${health.recoveryRate}%` : '—'}
            </span>
          </div>
          <div>
            <span className="text-text-muted">Loss Rate: </span>
            <span className="font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
              {recoveryRate?.lossRate != null ? `${recoveryRate.lossRate}%` : '—'}
            </span>
          </div>
          <div>
            <span className="text-text-muted">Total Recovered: </span>
            <span className="font-semibold text-text-primary">
              {recoveryRate?.totalRecovered != null ? formatCurrency(recoveryRate.totalRecovered) : '—'}
            </span>
          </div>
          <div>
            <span className="text-text-muted">Written Off: </span>
            <span className="font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
              {recoveryRate?.totalWrittenOff != null ? formatCurrency(recoveryRate.totalWrittenOff) : '—'}
            </span>
          </div>
          <div>
            <span className="text-text-muted">Compliance Issues: </span>
            <span
              className="font-semibold"
              style={{ color: (health?.complianceIssues ?? 0) > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)' }}
            >
              {health?.complianceIssues ?? '—'}
            </span>
          </div>
          <div>
            <span className="text-text-muted">Current Balance: </span>
            <span className="font-semibold text-text-primary">
              {health?.currentBalance != null ? formatCurrency(health.currentBalance) : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Concentration */}
        <div className="block-card p-4">
          <p className="text-xs font-semibold text-text-muted uppercase mb-3">Concentration</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Active Accounts</span>
              <span className="font-semibold text-text-primary">{concentration?.totalDebts ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Total Outstanding</span>
              <span className="font-semibold text-text-primary">
                {concentration?.totalOutstanding != null ? formatCurrency(concentration.totalOutstanding) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Top 10% Share</span>
              <span
                className="font-semibold"
                style={{ color: (concentration?.top10PctConcentration ?? 0) > 60 ? 'var(--color-accent-warning)' : 'var(--color-accent-income)' }}
              >
                {concentration?.top10PctConcentration != null ? `${concentration.top10PctConcentration}%` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Risk Distribution */}
        <div className="block-card p-4">
          <p className="text-xs font-semibold text-text-muted uppercase mb-3">Risk Distribution</p>
          {riskDist ? (
            <div className="space-y-2">
              {(['high', 'medium', 'low'] as const).map((level) => {
                const count = riskDist[level];
                const pct = totalRisk > 0 ? Math.round((count / totalRisk) * 100) : 0;
                const color = level === 'high' ? 'var(--color-accent-expense)' : level === 'medium' ? 'var(--color-accent-warning)' : 'var(--color-accent-income)';
                return (
                  <div key={level}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize text-text-muted">{level} risk</span>
                      <span className="font-semibold" style={{ color }}>{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-bg-tertiary" style={{ borderRadius: 'var(--app-radius)' }}>
                      <div className="h-1.5" style={{ width: `${pct}%`, backgroundColor: color, borderRadius: 'var(--app-radius)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-text-muted">Loading…</p>
          )}
        </div>
      </div>

      {/* Recovery Forecast */}
      <div className="block-card p-4">
        <p className="text-xs font-semibold text-text-muted uppercase mb-3">Recovery Forecast (next 30 days)</p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-text-muted mb-1">Promised Payments Pending</p>
            <p className="text-lg font-bold" style={{ color: 'var(--color-accent-income)' }}>
              {forecast?.promisedPayments != null ? formatCurrency(forecast.promisedPayments) : '—'}
            </p>
          </div>
          <div>
            <p className="text-text-muted mb-1">Installments Due (30d)</p>
            <p className="text-lg font-bold" style={{ color: 'var(--color-accent-blue)' }}>
              {forecast?.installmentsDueNext30 != null ? formatCurrency(forecast.installmentsDueNext30) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Aging Buckets */}
      <div className="block-card p-4">
        <p className="text-xs font-semibold text-text-muted uppercase mb-3">Aging Buckets</p>
        {agingBuckets.length === 0 ? (
          <p className="text-xs text-text-muted">No aging data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="block-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Bucket (days)</th>
                  <th className="text-right">Accounts</th>
                  <th className="text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {agingBuckets.map((b) => (
                  <tr key={b.label}>
                    <td className="font-medium text-text-primary">{b.label}</td>
                    <td className="text-right text-text-secondary">{b.count}</td>
                    <td className="text-right font-semibold" style={{ color: b.total > 0 ? 'var(--color-accent-expense)' : 'var(--text-muted)' }}>
                      {formatCurrency(b.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section: Collector Ops & Settlements ─────────────────

function CollectorOpsSection() {
  const [workload, setWorkload] = useState<CollectorWorkload[] | null>(null);
  const [performance, setPerformance] = useState<CollectorPerformance[] | null>(null);
  const [settleSummary, setSettleSummary] = useState<SettlementSummary | null>(null);
  const [avgDiscount, setAvgDiscount] = useState<AvgSettlementDiscount | null>(null);
  const [pendingSettles, setPendingSettles] = useState<PendingSettlement[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.dcCollectorWorkload().then((d: CollectorWorkload[]) => { if (!cancelled) setWorkload(d || []); }).catch(() => {});
    api.dcCollectorPerformance().then((d: CollectorPerformance[]) => { if (!cancelled) setPerformance(d || []); }).catch(() => {});
    api.dcSettlementSummary().then((d: SettlementSummary) => { if (!cancelled) setSettleSummary(d); }).catch(() => {});
    api.dcAvgSettlementDiscount().then((d: AvgSettlementDiscount) => { if (!cancelled) setAvgDiscount(d); }).catch(() => {});
    api.dcPendingSettlements().then((d: PendingSettlement[]) => { if (!cancelled) setPendingSettles(d || []); }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader title="Collector Ops & Settlements" sub="Workload, performance and settlement pipeline" />

      {/* Settlement Summary strip */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          icon={<DollarSign size={16} />}
          label="Total Settlements"
          value={settleSummary?.totalSettlements != null ? String(settleSummary.totalSettlements) : '—'}
        />
        <StatCard
          icon={<TrendingUp size={16} />}
          label="Settlement Volume"
          value={settleSummary?.settlementTotal != null ? formatCurrency(settleSummary.settlementTotal) : '—'}
          accent="var(--color-accent-income)"
        />
        <StatCard
          icon={<Activity size={16} />}
          label="Avg Discount (all)"
          value={settleSummary?.avgDiscount != null ? `${settleSummary.avgDiscount}%` : '—'}
          accent="var(--color-accent-warning)"
        />
        <StatCard
          icon={<Clock size={16} />}
          label="Avg Discount (accepted)"
          value={avgDiscount?.avg_discount != null ? `${avgDiscount.avg_discount}%` : '—'}
          sub={avgDiscount?.sample != null ? `${avgDiscount.sample} accepted` : undefined}
          accent="var(--color-accent-warning)"
        />
      </div>

      {/* Collector Workload table */}
      <div className="block-card p-4">
        <p className="text-xs font-semibold text-text-muted uppercase mb-3">Collector Workload</p>
        <div className="overflow-x-auto">
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Collector</th>
                <th className="text-right">Accounts</th>
                <th className="text-right">Total Balance</th>
                <th className="text-right">Avg Age (days)</th>
              </tr>
            </thead>
            <tbody>
              {workload === null ? (
                <LoadingRow />
              ) : workload.length === 0 ? (
                <EmptyRow message="No active collector assignments." />
              ) : (
                workload.map((row, i) => (
                  <tr key={i}>
                    <td className="font-medium text-text-primary">{row.collector}</td>
                    <td className="text-right text-text-secondary">{row.debt_count}</td>
                    <td className="text-right font-semibold text-text-primary">{formatCurrency(row.total_balance)}</td>
                    <td className="text-right text-text-muted">
                      {row.avg_age != null ? Math.round(row.avg_age) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collector Performance table */}
      <div className="block-card p-4">
        <p className="text-xs font-semibold text-text-muted uppercase mb-3">Collector Performance</p>
        <div className="overflow-x-auto">
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Collector</th>
                <th className="text-right">Assigned</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Collected</th>
              </tr>
            </thead>
            <tbody>
              {performance === null ? (
                <LoadingRow />
              ) : performance.length === 0 ? (
                <EmptyRow message="No collector performance data." />
              ) : (
                performance.map((row, i) => (
                  <tr key={i}>
                    <td className="font-medium text-text-primary">{row.collector}</td>
                    <td className="text-right text-text-secondary">{row.debts_assigned}</td>
                    <td className="text-right text-text-secondary">{formatCurrency(row.total_outstanding)}</td>
                    <td className="text-right font-semibold" style={{ color: 'var(--color-accent-income)' }}>
                      {formatCurrency(row.total_collected)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Settlements table */}
      <div className="block-card p-4">
        <p className="text-xs font-semibold text-text-muted uppercase mb-3">
          Pending Settlements
          {pendingSettles !== null && (
            <span className="ml-2 text-text-muted font-normal">({pendingSettles.length})</span>
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Debtor</th>
                <th className="text-right">Original</th>
                <th className="text-right">Offered</th>
                <th className="text-right">Discount</th>
                <th className="text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {pendingSettles === null ? (
                <LoadingRow />
              ) : pendingSettles.length === 0 ? (
                <EmptyRow message="No pending settlements." />
              ) : (
                pendingSettles.map((s) => {
                  const disc = s.original_balance > 0
                    ? Math.round(((s.original_balance - s.settlement_amount) / s.original_balance) * 100)
                    : 0;
                  return (
                    <tr key={s.id}>
                      <td className="font-medium text-text-primary">{s.debtor_name}</td>
                      <td className="text-right text-text-secondary">{formatCurrency(s.original_balance)}</td>
                      <td className="text-right font-semibold" style={{ color: 'var(--color-accent-income)' }}>
                        {formatCurrency(s.settlement_amount)}
                      </td>
                      <td className="text-right" style={{ color: 'var(--color-accent-warning)' }}>{disc}%</td>
                      <td className="text-right text-text-muted">{formatDate(s.created_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Compliance & Worklists ─────────────────────

function ComplianceSection() {
  const [fdcpa, setFdcpa] = useState<FdcpaCheck | null>(null);
  const [restrictions, setRestrictions] = useState<ContactRestriction[] | null>(null);
  const [statutes, setStatutes] = useState<StatuteExpiring[] | null>(null);
  const [writeoffCandidates, setWriteoffCandidates] = useState<WriteoffCandidate[] | null>(null);
  const [skipTrace, setSkipTrace] = useState<SkipTraceNeeded[] | null>(null);
  const [brokenPromises, setBrokenPromises] = useState<BrokenPromise[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.dcFDCPACheck().then((d: FdcpaCheck) => { if (!cancelled) setFdcpa(d); }).catch(() => {});
    api.dcContactRestrictions().then((d: ContactRestriction[]) => { if (!cancelled) setRestrictions(d || []); }).catch(() => {});
    api.dcStatuteExpiring().then((d: StatuteExpiring[]) => { if (!cancelled) setStatutes(d || []); }).catch(() => {});
    api.dcWriteoffCandidates().then((d: WriteoffCandidate[]) => { if (!cancelled) setWriteoffCandidates(d || []); }).catch(() => {});
    api.dcNeedSkipTrace().then((d: SkipTraceNeeded[]) => { if (!cancelled) setSkipTrace(d || []); }).catch(() => {});
    api.dcBrokenPromises().then((d: BrokenPromise[]) => { if (!cancelled) setBrokenPromises(d || []); }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader title="Compliance & Worklists" sub="FDCPA status, statute radar, skip-trace queue, broken promises" />

      {/* FDCPA Status banner */}
      <div className="block-card p-4 flex items-start gap-4">
        <div className="flex-shrink-0 mt-0.5">
          {fdcpa === null ? (
            <Clock size={20} className="text-text-muted" />
          ) : fdcpa.compliant ? (
            <CheckCircle size={20} style={{ color: 'var(--color-accent-income)' }} />
          ) : (
            <AlertTriangle size={20} style={{ color: 'var(--color-accent-expense)' }} />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">
            FDCPA Compliance Check
            {fdcpa && (
              <span
                className="ml-2 text-xs font-normal"
                style={{ color: fdcpa.compliant ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}
              >
                {fdcpa.compliant ? 'COMPLIANT' : 'ISSUES FOUND'}
              </span>
            )}
          </p>
          {fdcpa === null ? (
            <p className="text-xs text-text-muted mt-1">Loading…</p>
          ) : fdcpa.issues.length === 0 ? (
            <p className="text-xs text-text-muted mt-1">No compliance issues detected as of {formatDate(fdcpa.checkDate)}.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {fdcpa.issues.map((issue, i) => (
                <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--color-accent-expense)' }}>
                  <span className="mt-0.5">•</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Contact Restrictions */}
        <StatCard
          icon={<Shield size={16} />}
          label="Contact Restrictions"
          value={restrictions !== null ? String(restrictions.length) : '—'}
          sub={restrictions && restrictions.length > 0 ? 'Do-not-call or C&D active' : 'No active restrictions'}
          accent={restrictions && restrictions.length > 0 ? 'var(--color-accent-warning)' : 'var(--color-accent-income)'}
        />
        {/* Broken Promises */}
        <StatCard
          icon={<FileX size={16} />}
          label="Broken Promises"
          value={brokenPromises !== null ? String(brokenPromises.length) : '—'}
          sub={brokenPromises && brokenPromises.length > 0 ? 'Require follow-up' : 'No broken promises'}
          accent={brokenPromises && brokenPromises.length > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'}
        />
      </div>

      {/* Statute Expiring */}
      <div className="block-card p-4">
        <p className="text-xs font-semibold text-text-muted uppercase mb-3">
          Statute of Limitations Expiring (next 90 days)
          {statutes !== null && (
            <span className="ml-2 font-normal text-text-muted">({statutes.length})</span>
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Debtor</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Expires</th>
                <th className="text-right">Days Left</th>
              </tr>
            </thead>
            <tbody>
              {statutes === null ? (
                <LoadingRow />
              ) : statutes.length === 0 ? (
                <EmptyRow message="No statutes expiring in the next 90 days." />
              ) : (
                statutes.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium text-text-primary">{s.debtor_name}</td>
                    <td className="text-right text-text-secondary">{formatCurrency(s.balance_due)}</td>
                    <td className="text-right text-text-muted">{formatDate(s.statute_of_limitations_date)}</td>
                    <td
                      className="text-right font-semibold"
                      style={{ color: s.days_remaining <= 30 ? 'var(--color-accent-expense)' : 'var(--color-accent-warning)' }}
                    >
                      {s.days_remaining}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Write-off Candidates */}
      <div className="block-card p-4">
        <p className="text-xs font-semibold text-text-muted uppercase mb-3">
          Write-off Candidates (&gt;365 days delinquent)
          {writeoffCandidates !== null && (
            <span className="ml-2 font-normal text-text-muted">({writeoffCandidates.length})</span>
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Debtor</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Delinquent Since</th>
                <th className="text-right">Age (days)</th>
              </tr>
            </thead>
            <tbody>
              {writeoffCandidates === null ? (
                <LoadingRow />
              ) : writeoffCandidates.length === 0 ? (
                <EmptyRow message="No write-off candidates." />
              ) : (
                writeoffCandidates.slice(0, 20).map((w) => (
                  <tr key={w.id}>
                    <td className="font-medium text-text-primary">{w.debtor_name}</td>
                    <td className="text-right font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
                      {formatCurrency(w.balance_due)}
                    </td>
                    <td className="text-right text-text-muted">{formatDate(w.delinquent_date)}</td>
                    <td className="text-right" style={{ color: 'var(--color-accent-expense)' }}>{w.age_days}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Skip-trace Queue */}
      <div className="block-card p-4">
        <p className="text-xs font-semibold text-text-muted uppercase mb-3">
          Skip-Trace Queue
          {skipTrace !== null && (
            <span className="ml-2 font-normal text-text-muted">({skipTrace.length})</span>
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Debtor</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Prior Traces</th>
              </tr>
            </thead>
            <tbody>
              {skipTrace === null ? (
                <LoadingRow />
              ) : skipTrace.length === 0 ? (
                <EmptyRow message="No debtors need skip tracing." />
              ) : (
                skipTrace.map((s, i) => (
                  <tr key={s.id ?? i}>
                    <td className="font-medium text-text-primary">{s.debtor_name}</td>
                    <td className="text-right font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
                      {formatCurrency(s.balance_due)}
                    </td>
                    <td className="text-right text-text-muted">{s.trace_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Broken Promises table */}
      {brokenPromises !== null && brokenPromises.length > 0 && (
        <div className="block-card p-4">
          <p className="text-xs font-semibold text-text-muted uppercase mb-3">Broken Promises Detail</p>
          <div className="overflow-x-auto">
            <table className="block-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Debtor</th>
                  <th className="text-right">Promise Amount</th>
                  <th className="text-right">Promise Date</th>
                  <th className="text-right">Balance Due</th>
                </tr>
              </thead>
              <tbody>
                {brokenPromises.map((p, i) => (
                  <tr key={p.id ?? i}>
                    <td className="font-medium text-text-primary">{p.debtor_name}</td>
                    <td className="text-right" style={{ color: 'var(--color-accent-warning)' }}>
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="text-right text-text-muted">{formatDate(p.promise_date)}</td>
                    <td className="text-right font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
                      {formatCurrency(p.balance_due)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Contact Restrictions detail — shown when there are restrictions */}
      {restrictions !== null && restrictions.length > 0 && (
        <div className="block-card p-4">
          <p className="text-xs font-semibold text-text-muted uppercase mb-3">Contact Restrictions Detail</p>
          <div className="overflow-x-auto">
            <table className="block-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Debtor</th>
                  <th className="text-right">Balance</th>
                  <th className="text-center">Do Not Call</th>
                  <th className="text-center">C&amp;D Active</th>
                </tr>
              </thead>
              <tbody>
                {restrictions.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-text-primary">{r.debtor_name}</td>
                    <td className="text-right text-text-secondary">{formatCurrency(r.balance_due)}</td>
                    <td className="text-center">
                      {r.do_not_call ? (
                        <span style={{ color: 'var(--color-accent-expense)' }}>Yes</span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {r.cease_desist_active ? (
                        <span style={{ color: 'var(--color-accent-expense)' }}>Yes</span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI Strip ───────────────────────────────────────────

function KpiStrip() {
  const [health, setHealth] = useState<PortfolioHealth | null>(null);
  const [writeoffCandidates, setWriteoffCandidates] = useState<WriteoffCandidate[] | null>(null);
  const [brokenPromises, setBrokenPromises] = useState<BrokenPromise[] | null>(null);
  const [openDisputes, setOpenDisputes] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.dcPortfolioHealth().then((d: PortfolioHealth) => { if (!cancelled) setHealth(d); }).catch(() => {});
    api.dcWriteoffCandidates().then((d: WriteoffCandidate[]) => { if (!cancelled) setWriteoffCandidates(d || []); }).catch(() => {});
    api.dcBrokenPromises().then((d: BrokenPromise[]) => { if (!cancelled) setBrokenPromises(d || []); }).catch(() => {});
    api.dcOpenDisputes().then((d: any[]) => { if (!cancelled) setOpenDisputes((d || []).length); }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      <StatCard
        icon={<DollarSign size={16} />}
        label="Portfolio Balance"
        value={health?.currentBalance != null ? formatCurrency(health.currentBalance) : '—'}
        sub={health?.totalDebts != null ? `${health.totalDebts} accounts` : undefined}
      />
      <StatCard
        icon={<TrendingUp size={16} />}
        label="Recovery Rate"
        value={health?.recoveryRate != null ? `${health.recoveryRate}%` : '—'}
        sub={`Grade: ${health?.healthGrade ?? '—'}`}
        accent="var(--color-accent-income)"
      />
      <StatCard
        icon={<AlertTriangle size={16} />}
        label="Open Disputes"
        value={openDisputes != null ? String(openDisputes) : '—'}
        sub={brokenPromises !== null ? `${brokenPromises.length} broken promises` : undefined}
        accent="var(--color-accent-warning)"
      />
      <StatCard
        icon={<Users size={16} />}
        label="Write-off Candidates"
        value={writeoffCandidates !== null ? String(writeoffCandidates.length) : '—'}
        sub="Over 365 days delinquent"
        accent="var(--color-accent-expense)"
      />
    </div>
  );
}

// ─── Sub-tab types ───────────────────────────────────────

type AnalyticsTab = 'portfolio' | 'ops' | 'compliance';

// ─── Main export ─────────────────────────────────────────

const DebtAnalytics: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('portfolio');

  return (
    <div className="space-y-0">
      <KpiStrip />

      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-border-primary mb-5">
        {(
          [
            { key: 'portfolio', label: 'Portfolio Health' },
            { key: 'ops', label: 'Collector Ops & Settlements' },
            { key: 'compliance', label: 'Compliance & Worklists' },
          ] as { key: AnalyticsTab; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === key
                ? 'text-text-primary border-b-2'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            style={
              activeTab === key
                ? { borderColor: 'var(--accent-primary)', borderRadius: '6px 6px 0 0' }
                : { borderRadius: '6px 6px 0 0' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'portfolio' && <PortfolioHealthSection />}
      {activeTab === 'ops' && <CollectorOpsSection />}
      {activeTab === 'compliance' && <ComplianceSection />}
    </div>
  );
};

export default DebtAnalytics;
