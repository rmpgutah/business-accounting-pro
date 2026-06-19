import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../lib/api';
import { formatCurrency, formatDate, percentChange } from '../../../lib/format';
import { useCompanyStore } from '../../../stores/companyStore';

// ============================================================================
// ClientsUpgradesPart2 — "Insights & Analytics"
//
// A single self-contained analytics panel for the Clients module. Renders a
// vertical stack of titled `block-card`s, each a small WORKING feature that
// reads REAL data through the api wrapper (rawQuery/query), scoped to the
// active company. No hard-coded numbers, no dead buttons, never throws on
// render. esbuild does not type-check, so this file is written to pass
// `tsc --noEmit` on its own (every identifier declared, no `any` abuse).
// ============================================================================

// ─── Row shapes returned by rawQuery (flat rows) ────────────────────────────
interface ClientRow {
  id: string;
  name: string;
  state: string | null;
  payment_terms: number | null;
  custom_fields: string | null;
  created_at: string | null;
}
interface RevenueRow {
  id: string;
  name: string;
  invoice_count: number;
  revenue: number;
  collected: number;
  outstanding: number;
  avg_invoice: number;
  avg_pay_days: number | null;
  first_invoice: string | null;
  last_invoice: string | null;
  on_time: number;
  late: number;
}
interface MonthBucketRow {
  ym: string;
  total: number;
}
interface StateRow {
  state: string | null;
  revenue: number;
  client_count: number;
}
interface AgingRow {
  bucket: string;
  amount: number;
}
interface ExpenseRecoveryRow {
  client_id: string;
  billable_total: number;
  reimbursed_total: number;
}
interface PaymentMethodRow {
  client_id: string;
  payment_method: string | null;
  total: number;
}
interface ProjectRow {
  client_id: string;
  project_count: number;
  active_count: number;
  active_budget: number;
}

// ─── Aggregated view model built in JS from the raw rows ─────────────────────
interface ClientMetric extends RevenueRow {
  tier: string;
  industry: string;
  paymentTerms: number;
  created_at: string | null;
  health: number;
  daysSinceLast: number | null;
  recoveryRate: number | null;
  topMethod: string;
  projectCount: number;
  activeProjectValue: number;
  qoqDelta: number | null;
}

interface AnalyticsModel {
  clients: ClientMetric[];
  totalRevenue: number;
  totalOutstanding: number;
  trend: MonthBucketRow[]; // company-wide 12 month
  acquisition: Array<{ ym: string; acquired: number; churned: number }>;
  states: StateRow[];
  aging: AgingRow[];
  repeat: number;
  oneTime: number;
}

// ─── Small helpers ──────────────────────────────────────────────────────────
function parseCustom(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(from: string | null, to: Date): number | null {
  if (!from) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T12:00:00` : from);
  if (isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / 86_400_000);
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const ACCENT_INCOME = 'var(--color-accent-income)';
const ACCENT_EXPENSE = 'var(--color-accent-expense)';
const ACCENT_BLUE = 'var(--color-accent-blue)';
const ACCENT_WARNING = 'var(--color-accent-warning)';

// ─── Inline SVG sparkline (no external chart dep) ───────────────────────────
function Sparkline({ values, color = ACCENT_INCOME, width = 180, height = 36 }: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}): React.ReactElement {
  if (!values.length) return <span className="text-text-muted text-xs">no data</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── A simple titled stacked bar (used for aging + tiers) ───────────────────
function StackedBar({ segments }: { segments: Array<{ label: string; value: number; color: string }> }): React.ReactElement {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <div className="text-text-muted text-sm">No data</div>;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded" style={{ borderRadius: 'var(--app-radius)' }}>
        {segments.map((s, i) =>
          s.value > 0 ? (
            <div key={i} title={`${s.label}: ${formatCurrency(s.value)}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
          ) : null
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {segments.map((s, i) => (
          <span key={i} className="flex items-center gap-1 text-text-secondary">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}: {formatCurrency(s.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════════
function ClientsUpgradesPart2(): React.ReactElement {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id ?? '';

  const [model, setModel] = useState<AnalyticsModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // User-tunable controls (some persisted to localStorage = working settings)
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'revenue' | 'outstanding' | 'avg_invoice' | 'health' | 'avg_pay_days'>(
    'revenue'
  );
  const [showInactive, setShowInactive] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bap-clients-analytics-showZero') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('bap-clients-analytics-showZero', showInactive ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }, [showInactive]);

  useEffect(() => {
    let cancelled = false;
    if (!companyId) {
      setLoading(false);
      setModel(null);
      return;
    }
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const now = new Date();
        const todayIso = now.toISOString().slice(0, 10);
        // Quarter boundaries for QoQ delta (feature 22)
        const q = Math.floor(now.getMonth() / 3);
        const curQStart = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
        const prevQStartDate = new Date(now.getFullYear(), q * 3 - 3, 1);
        const prevQStart = prevQStartDate.toISOString().slice(0, 10);

        // 1 query: per-client core metrics (revenue, collected, outstanding,
        // avg invoice, avg pay-days, on-time vs late, first/last invoice).
        const clientsP = api.rawQuery(
          `SELECT id, name, state, payment_terms, custom_fields, created_at
             FROM clients WHERE company_id = ?`,
          [companyId]
        ) as Promise<ClientRow[]>;

        const revenueP = api.rawQuery(
          `SELECT
              c.id AS id,
              c.name AS name,
              COUNT(DISTINCT i.id) AS invoice_count,
              COALESCE(SUM(i.total), 0) AS revenue,
              COALESCE(SUM(i.amount_paid), 0) AS collected,
              COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','cancelled') THEN i.total - i.amount_paid ELSE 0 END), 0) AS outstanding,
              COALESCE(AVG(i.total), 0) AS avg_invoice,
              MIN(i.issue_date) AS first_invoice,
              MAX(i.issue_date) AS last_invoice
            FROM clients c
            LEFT JOIN invoices i ON i.client_id = c.id AND i.company_id = c.company_id
            WHERE c.company_id = ?
            GROUP BY c.id, c.name`,
          [companyId]
        ) as Promise<Array<Omit<RevenueRow, 'avg_pay_days' | 'on_time' | 'late'>>>;

        // avg days-to-pay + on-time/late counts (payments vs due/issue date)
        const payP = api.rawQuery(
          `SELECT
              i.client_id AS id,
              AVG(julianday(p.date) - julianday(i.issue_date)) AS avg_pay_days,
              SUM(CASE WHEN julianday(p.date) <= julianday(i.due_date) THEN 1 ELSE 0 END) AS on_time,
              SUM(CASE WHEN julianday(p.date) > julianday(i.due_date) THEN 1 ELSE 0 END) AS late
            FROM payments p
            JOIN invoices i ON i.id = p.invoice_id
            WHERE i.company_id = ?
            GROUP BY i.client_id`,
          [companyId]
        ) as Promise<Array<{ id: string; avg_pay_days: number | null; on_time: number; late: number }>>;

        // 12-month company-wide revenue trend (feature 4)
        const trendP = api.rawQuery(
          `SELECT strftime('%Y-%m', issue_date) AS ym, COALESCE(SUM(total), 0) AS total
             FROM invoices
             WHERE company_id = ? AND issue_date >= date('now','-12 months')
             GROUP BY ym ORDER BY ym`,
          [companyId]
        ) as Promise<MonthBucketRow[]>;

        // company-wide AR aging buckets (feature 3)
        const agingP = api.rawQuery(
          `SELECT
              CASE
                WHEN julianday('now') - julianday(due_date) <= 30 THEN '0-30'
                WHEN julianday('now') - julianday(due_date) <= 60 THEN '31-60'
                WHEN julianday('now') - julianday(due_date) <= 90 THEN '61-90'
                ELSE '90+'
              END AS bucket,
              COALESCE(SUM(total - amount_paid), 0) AS amount
            FROM invoices
            WHERE company_id = ? AND status NOT IN ('paid','cancelled') AND (total - amount_paid) > 0
            GROUP BY bucket`,
          [companyId]
        ) as Promise<AgingRow[]>;

        // geographic revenue (feature 14)
        const stateP = api.rawQuery(
          `SELECT c.state AS state,
              COALESCE(SUM(i.total), 0) AS revenue,
              COUNT(DISTINCT c.id) AS client_count
            FROM clients c
            LEFT JOIN invoices i ON i.client_id = c.id AND i.company_id = c.company_id
            WHERE c.company_id = ?
            GROUP BY c.state ORDER BY revenue DESC`,
          [companyId]
        ) as Promise<StateRow[]>;

        // acquisition vs churn by month (feature 6)
        const acqP = api.rawQuery(
          `SELECT strftime('%Y-%m', created_at) AS ym, COUNT(*) AS acquired
             FROM clients WHERE company_id = ? AND created_at >= date('now','-12 months')
             GROUP BY ym ORDER BY ym`,
          [companyId]
        ) as Promise<Array<{ ym: string; acquired: number }>>;

        // churn proxy: last invoice month for clients whose last invoice is >12mo old
        const churnP = api.rawQuery(
          `SELECT strftime('%Y-%m', last_inv) AS ym, COUNT(*) AS churned FROM (
              SELECT client_id, MAX(issue_date) AS last_inv
                FROM invoices WHERE company_id = ? GROUP BY client_id
            ) WHERE last_inv < date('now','-12 months')
            GROUP BY ym ORDER BY ym`,
          [companyId]
        ) as Promise<Array<{ ym: string; churned: number }>>;

        // billable-expense recovery (feature 21)
        const recoverP = api.rawQuery(
          `SELECT client_id,
              COALESCE(SUM(CASE WHEN is_billable = 1 THEN amount ELSE 0 END), 0) AS billable_total,
              COALESCE(SUM(CASE WHEN is_billable = 1 AND reimbursed = 1 THEN amount ELSE 0 END), 0) AS reimbursed_total
            FROM expenses
            WHERE company_id = ? AND client_id IS NOT NULL AND client_id != ''
            GROUP BY client_id`,
          [companyId]
        ) as Promise<ExpenseRecoveryRow[]>;

        // payment-method breakdown (feature 10) — per client+method totals
        const methodP = api.rawQuery(
          `SELECT i.client_id AS client_id, p.payment_method AS payment_method, COALESCE(SUM(p.amount), 0) AS total
             FROM payments p JOIN invoices i ON i.id = p.invoice_id
             WHERE i.company_id = ?
             GROUP BY i.client_id, p.payment_method`,
          [companyId]
        ) as Promise<PaymentMethodRow[]>;

        // projects per client (feature 13)
        const projP = api.rawQuery(
          `SELECT client_id,
              COUNT(*) AS project_count,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
              COALESCE(SUM(CASE WHEN status = 'active' THEN budget ELSE 0 END), 0) AS active_budget
            FROM projects
            WHERE company_id = ? AND client_id IS NOT NULL AND client_id != ''
            GROUP BY client_id`,
          [companyId]
        ) as Promise<ProjectRow[]>;

        // QoQ revenue per client (feature 22)
        const qoqP = api.rawQuery(
          `SELECT client_id,
              COALESCE(SUM(CASE WHEN issue_date >= ? THEN total ELSE 0 END), 0) AS cur_q,
              COALESCE(SUM(CASE WHEN issue_date >= ? AND issue_date < ? THEN total ELSE 0 END), 0) AS prev_q
            FROM invoices
            WHERE company_id = ? AND issue_date >= ?
            GROUP BY client_id`,
          [curQStart, prevQStart, curQStart, companyId, prevQStart]
        ) as Promise<Array<{ client_id: string; cur_q: number; prev_q: number }>>;

        const [
          clientRows,
          revRows,
          payRows,
          trendRows,
          agingRows,
          stateRows,
          acqRows,
          churnRows,
          recoverRows,
          methodRows,
          projRows,
          qoqRows,
        ] = await Promise.all([
          clientsP,
          revenueP,
          payP,
          trendP,
          agingP,
          stateP,
          acqP,
          churnP,
          recoverP,
          methodP,
          projP,
          qoqP,
        ]);

        if (cancelled) return;

        // Build lookup maps
        const payMap = new Map(payRows.map((r) => [r.id, r]));
        const recoverMap = new Map(recoverRows.map((r) => [r.client_id, r]));
        const projMap = new Map(projRows.map((r) => [r.client_id, r]));
        const qoqMap = new Map(qoqRows.map((r) => [r.client_id, r]));
        const clientMetaMap = new Map(clientRows.map((r) => [r.id, r]));

        // top payment method per client
        const methodTop = new Map<string, { method: string; total: number }>();
        for (const m of methodRows) {
          const cur = methodTop.get(m.client_id);
          const t = num(m.total);
          if (!cur || t > cur.total) methodTop.set(m.client_id, { method: m.payment_method || 'Unspecified', total: t });
        }

        let totalRevenue = 0;
        let totalOutstanding = 0;
        let repeat = 0;
        let oneTime = 0;

        const clients: ClientMetric[] = revRows.map((r) => {
          const meta = clientMetaMap.get(r.id);
          const custom = parseCustom(meta?.custom_fields ?? null);
          const tier = String((custom.tier as string) || 'standard').toLowerCase();
          const industry = String((custom.industry as string) || 'Uncategorized');
          const paymentTerms = num(meta?.payment_terms) || 30;
          const pay = payMap.get(r.id);
          const avgPay = pay?.avg_pay_days ?? null;
          const onTime = num(pay?.on_time);
          const late = num(pay?.late);
          const revenue = num(r.revenue);
          const outstanding = num(r.outstanding);
          const invCount = num(r.invoice_count);
          const daysSinceLast = daysBetween(r.last_invoice, now);

          totalRevenue += revenue;
          totalOutstanding += outstanding;
          if (invCount >= 2) repeat += 1;
          else if (invCount === 1) oneTime += 1;

          // Composite health score 0-100 (feature 12): recency, timeliness,
          // balance pressure, invoice volume.
          let recencyScore = 30;
          if (daysSinceLast == null) recencyScore = 0;
          else if (daysSinceLast <= 30) recencyScore = 30;
          else if (daysSinceLast <= 90) recencyScore = 20;
          else if (daysSinceLast <= 180) recencyScore = 10;
          else recencyScore = 0;
          const paidCount = onTime + late;
          const timelinessScore = paidCount > 0 ? Math.round((onTime / paidCount) * 30) : 15;
          const balanceScore = revenue > 0 ? Math.round(Math.max(0, 1 - outstanding / revenue) * 20) : 10;
          const volumeScore = Math.min(20, invCount * 4);
          const health = Math.max(0, Math.min(100, recencyScore + timelinessScore + balanceScore + volumeScore));

          const rec = recoverMap.get(r.id);
          const recoveryRate = rec && rec.billable_total > 0 ? (num(rec.reimbursed_total) / num(rec.billable_total)) * 100 : null;

          const proj = projMap.get(r.id);
          const qoq = qoqMap.get(r.id);
          const qoqDelta = qoq ? percentChange(num(qoq.cur_q), num(qoq.prev_q)) : null;

          return {
            ...r,
            revenue,
            collected: num(r.collected),
            outstanding,
            avg_invoice: num(r.avg_invoice),
            invoice_count: invCount,
            avg_pay_days: avgPay,
            on_time: onTime,
            late,
            tier,
            industry,
            paymentTerms,
            created_at: meta?.created_at ?? null,
            health,
            daysSinceLast,
            recoveryRate,
            topMethod: methodTop.get(r.id)?.method ?? '—',
            projectCount: num(proj?.project_count),
            activeProjectValue: num(proj?.active_budget),
            qoqDelta,
          };
        });

        // merge acquisition + churn series
        const months = new Map<string, { ym: string; acquired: number; churned: number }>();
        for (const a of acqRows) months.set(a.ym, { ym: a.ym, acquired: num(a.acquired), churned: 0 });
        for (const c of churnRows) {
          const cur = months.get(c.ym) ?? { ym: c.ym, acquired: 0, churned: 0 };
          cur.churned = num(c.churned);
          months.set(c.ym, cur);
        }
        const acquisition = Array.from(months.values()).sort((a, b) => a.ym.localeCompare(b.ym));

        setModel({
          clients,
          totalRevenue,
          totalOutstanding,
          trend: trendRows.map((t) => ({ ym: t.ym, total: num(t.total) })),
          acquisition,
          states: stateRows.map((s) => ({ state: s.state, revenue: num(s.revenue), client_count: num(s.client_count) })),
          aging: agingRows.map((a) => ({ bucket: a.bucket, amount: num(a.amount) })),
          repeat,
          oneTime,
        });
        // mark todayIso as referenced (kept for potential future relative calcs)
        void todayIso;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // ─── Derived / filtered views ──────────────────────────────────────────────
  const filteredSorted = useMemo<ClientMetric[]>(() => {
    if (!model) return [];
    const q = search.trim().toLowerCase();
    let list = model.clients.filter((c) => (showInactive ? true : c.revenue > 0 || c.invoice_count > 0));
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    const dir = sortKey === 'avg_pay_days' ? 1 : -1; // pay-days ascending (faster=better)
    return [...list].sort((a, b) => {
      const av = sortKey === 'avg_pay_days' ? a.avg_pay_days ?? Infinity : (a[sortKey] as number);
      const bv = sortKey === 'avg_pay_days' ? b.avg_pay_days ?? Infinity : (b[sortKey] as number);
      return (av - bv) * dir;
    });
  }, [model, search, sortKey, showInactive]);

  // concentration (HHI) — feature 5
  const concentration = useMemo(() => {
    if (!model || model.totalRevenue <= 0) return null;
    const shares = model.clients.map((c) => c.revenue / model.totalRevenue).filter((s) => s > 0);
    const hhi = shares.reduce((s, x) => s + x * x, 0) * 10000;
    const top = [...model.clients].sort((a, b) => b.revenue - a.revenue)[0];
    const topShare = top ? (top.revenue / model.totalRevenue) * 100 : 0;
    return { hhi: Math.round(hhi), topName: top?.name ?? '—', topShare };
  }, [model]);

  // tier distribution — feature 16
  const tiers = useMemo(() => {
    if (!model) return [];
    const map = new Map<string, { count: number; revenue: number }>();
    for (const c of model.clients) {
      const cur = map.get(c.tier) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += c.revenue;
      map.set(c.tier, cur);
    }
    return Array.from(map.entries()).map(([tier, v]) => ({ tier, ...v })).sort((a, b) => b.revenue - a.revenue);
  }, [model]);

  // industry breakdown — feature 15
  const industries = useMemo(() => {
    if (!model) return [];
    const map = new Map<string, { count: number; revenue: number }>();
    for (const c of model.clients) {
      const cur = map.get(c.industry) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += c.revenue;
      map.set(c.industry, cur);
    }
    return Array.from(map.entries()).map(([industry, v]) => ({ industry, ...v })).sort((a, b) => b.revenue - a.revenue);
  }, [model]);

  // cohort retention grid — feature 23
  const cohorts = useMemo(() => {
    if (!model) return [];
    const map = new Map<string, { month: string; total: number; active: number }>();
    for (const c of model.clients) {
      const cohortMonth = c.created_at ? c.created_at.slice(0, 7) : 'unknown';
      const cur = map.get(cohortMonth) ?? { month: cohortMonth, total: 0, active: 0 };
      cur.total += 1;
      // "active" = has invoiced in last 12 months
      if (c.daysSinceLast != null && c.daysSinceLast <= 365) cur.active += 1;
      map.set(cohortMonth, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 8);
  }, [model]);

  // outstanding leaderboard with cumulative % — feature 18
  const leaderboard = useMemo(() => {
    if (!model) return [];
    const sorted = [...model.clients].filter((c) => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
    const total = sorted.reduce((s, c) => s + c.outstanding, 0) || 1;
    let run = 0;
    return sorted.slice(0, 10).map((c) => {
      run += c.outstanding;
      return { name: c.name, outstanding: c.outstanding, cumPct: (run / total) * 100 };
    });
  }, [model]);

  // terms-vs-actual gap — feature 24
  const termGaps = useMemo(() => {
    if (!model) return [];
    return model.clients
      .filter((c) => c.avg_pay_days != null && c.invoice_count > 0)
      .map((c) => {
        const terms = c.paymentTerms;
        const actual = Math.round(c.avg_pay_days as number);
        return { name: c.name, terms, actual, gap: actual - terms };
      })
      .filter((c) => c.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 8);
  }, [model]);

  // ─── Loading / empty / error ───────────────────────────────────────────────
  if (!companyId) {
    return (
      <div className="block-card p-6">
        <p className="text-text-muted">Select a company to view client analytics.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="block-card p-6">
        <p className="text-text-secondary">Loading client analytics…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="block-card p-6">
        <p className="text-text-secondary mb-1">Could not load analytics.</p>
        <p className="text-text-muted text-sm">{error}</p>
      </div>
    );
  }
  if (!model || model.clients.length === 0) {
    return (
      <div className="block-card p-6">
        <p className="text-text-muted">No clients yet. Add clients and invoices to populate analytics.</p>
      </div>
    );
  }

  const m = model;
  const repeatPct = m.repeat + m.oneTime > 0 ? (m.repeat / (m.repeat + m.oneTime)) * 100 : 0;
  const avgInvoiceAll = m.clients.length ? m.clients.reduce((s, c) => s + c.avg_invoice, 0) / m.clients.length : 0;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Insights &amp; Analytics</h2>

      {/* ─── Feature 1/9/25: portfolio summary stat row ─────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Portfolio summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Lifetime revenue" value={formatCurrency(m.totalRevenue)} accent={ACCENT_INCOME} />
          <Stat label="Outstanding AR" value={formatCurrency(m.totalOutstanding)} accent={ACCENT_EXPENSE} />
          <Stat label="Clients invoiced" value={String(m.clients.filter((c) => c.invoice_count > 0).length)} accent={ACCENT_BLUE} />
          <Stat label="Avg invoice value" value={formatCurrency(avgInvoiceAll)} accent={ACCENT_WARNING} />
        </div>
      </div>

      {/* ─── Feature 4: 12-month revenue trend sparkline ────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-2">12-month revenue trend</h3>
        {m.trend.length ? (
          <>
            <Sparkline values={m.trend.map((t) => t.total)} width={320} height={48} />
            <div className="mt-2 flex justify-between text-xs text-text-muted">
              <span>{m.trend[0]?.ym}</span>
              <span>{m.trend[m.trend.length - 1]?.ym}</span>
            </div>
          </>
        ) : (
          <p className="text-text-muted text-sm">No invoices in the last 12 months.</p>
        )}
      </div>

      {/* ─── Feature 3: AR aging buckets stacked bar ────────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Outstanding aging buckets</h3>
        <StackedBar
          segments={[
            { label: '0-30', value: aging(m, '0-30'), color: ACCENT_INCOME },
            { label: '31-60', value: aging(m, '31-60'), color: ACCENT_WARNING },
            { label: '61-90', value: aging(m, '61-90'), color: ACCENT_BLUE },
            { label: '90+', value: aging(m, '90+'), color: ACCENT_EXPENSE },
          ]}
        />
      </div>

      {/* ─── Feature 5: revenue concentration (HHI) ─────────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Revenue concentration (HHI)</h3>
        {concentration ? (
          <div className="space-y-1 text-sm">
            <p className="text-text-secondary">
              Herfindahl index: <span className="text-text-primary font-semibold">{concentration.hhi}</span>{' '}
              <span className="text-text-muted">(0=diversified, 10000=single client)</span>
            </p>
            <p className="text-text-secondary">
              Top client <span className="text-text-primary font-semibold">{concentration.topName}</span> ={' '}
              {concentration.topShare.toFixed(1)}% of revenue
            </p>
            {concentration.topShare > 30 && (
              <p className="mt-1 rounded px-2 py-1 text-xs" style={{ background: 'rgba(245,158,11,0.12)', color: ACCENT_WARNING }}>
                ⚠ Concentration risk: one client exceeds 30% of total revenue.
              </p>
            )}
          </div>
        ) : (
          <p className="text-text-muted text-sm">Not enough revenue to compute.</p>
        )}
      </div>

      {/* ─── Feature 6: acquisition vs churn by month ───────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-2">New vs churned clients (12 mo)</h3>
        {m.acquisition.length ? (
          <div className="flex items-end gap-2" style={{ height: 80 }}>
            {m.acquisition.map((a) => {
              const max = Math.max(...m.acquisition.flatMap((x) => [x.acquired, x.churned]), 1);
              return (
                <div key={a.ym} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${a.ym}: +${a.acquired} / -${a.churned}`}>
                  <div className="w-full" style={{ height: `${(a.acquired / max) * 50}px`, background: ACCENT_INCOME, borderRadius: 'var(--app-radius)' }} />
                  <div className="w-full" style={{ height: `${(a.churned / max) * 50}px`, background: ACCENT_EXPENSE, borderRadius: 'var(--app-radius)' }} />
                  <span className="text-[9px] text-text-muted">{a.ym.slice(5)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-text-muted text-sm">No acquisition data in the last 12 months.</p>
        )}
        <p className="mt-2 text-xs text-text-muted">
          <span style={{ color: ACCENT_INCOME }}>■</span> acquired &nbsp;
          <span style={{ color: ACCENT_EXPENSE }}>■</span> churned (no invoice 12mo+)
        </p>
      </div>

      {/* ─── Feature 8: repeat vs one-time mix ──────────────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Repeat vs one-time clients</h3>
        <StackedBar
          segments={[
            { label: `Repeat (2+) · ${m.repeat}`, value: m.repeat, color: ACCENT_INCOME },
            { label: `One-time · ${m.oneTime}`, value: m.oneTime, color: ACCENT_BLUE },
          ]}
        />
        <p className="mt-2 text-sm text-text-secondary">
          Retention: <span className="text-text-primary font-semibold">{repeatPct.toFixed(0)}%</span> of invoiced clients are repeat.
        </p>
      </div>

      {/* ─── Feature 16: tier distribution ──────────────────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Tier distribution &amp; revenue</h3>
        <table className="block-table w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Tier</th>
              <th className="text-right">Clients</th>
              <th className="text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.tier}>
                <td className="capitalize">{t.tier}</td>
                <td className="text-right">{t.count}</td>
                <td className="text-right">{formatCurrency(t.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Feature 15: industry breakdown ─────────────────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Industry breakdown</h3>
        <table className="block-table w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Industry</th>
              <th className="text-right">Clients</th>
              <th className="text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {industries.slice(0, 8).map((t) => (
              <tr key={t.industry}>
                <td>{t.industry}</td>
                <td className="text-right">{t.count}</td>
                <td className="text-right">{formatCurrency(t.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Feature 14: geographic revenue heat table ──────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Revenue by state</h3>
        {m.states.filter((s) => s.revenue > 0).length ? (
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">State</th>
                <th className="text-right">Clients</th>
                <th className="text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {m.states.filter((s) => s.revenue > 0).slice(0, 10).map((s, i) => (
                <tr key={i}>
                  <td>{s.state || '—'}</td>
                  <td className="text-right">{s.client_count}</td>
                  <td className="text-right">{formatCurrency(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-text-muted text-sm">No state-tagged revenue.</p>
        )}
      </div>

      {/* ─── Feature 18: outstanding leaderboard w/ cumulative % ────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Outstanding-balance leaderboard</h3>
        {leaderboard.length ? (
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Client</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Cumulative %</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td className="text-right" style={{ color: ACCENT_EXPENSE }}>{formatCurrency(r.outstanding)}</td>
                  <td className="text-right text-text-muted">{r.cumPct.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-text-muted text-sm">No outstanding balances. 🎉</p>
        )}
      </div>

      {/* ─── Feature 23: cohort retention grid ──────────────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Cohort retention (by signup month)</h3>
        {cohorts.length ? (
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Cohort</th>
                <th className="text-right">Clients</th>
                <th className="text-right">Still active</th>
                <th className="text-right">Retention</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => {
                const ret = c.total > 0 ? (c.active / c.total) * 100 : 0;
                return (
                  <tr key={c.month}>
                    <td>{c.month}</td>
                    <td className="text-right">{c.total}</td>
                    <td className="text-right">{c.active}</td>
                    <td className="text-right" style={{ color: ret >= 50 ? ACCENT_INCOME : ACCENT_EXPENSE }}>
                      {ret.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-text-muted text-sm">No cohort data.</p>
        )}
      </div>

      {/* ─── Feature 24: terms vs actual-paid gap ───────────────────────────── */}
      <div className="block-card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Clients exceeding payment terms</h3>
        {termGaps.length ? (
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Client</th>
                <th className="text-right">Terms (d)</th>
                <th className="text-right">Actual (d)</th>
                <th className="text-right">Over by</th>
              </tr>
            </thead>
            <tbody>
              {termGaps.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td className="text-right">{c.terms}</td>
                  <td className="text-right">{c.actual}</td>
                  <td className="text-right" style={{ color: ACCENT_EXPENSE }}>+{c.gap}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-text-muted text-sm">All clients pay within their terms.</p>
        )}
      </div>

      {/* ─── Per-client explorer: search, sort, export + many inline features ── */}
      <div className="block-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Per-client analytics</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="block-input text-sm"
              placeholder="Search clients…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 160 }}
            />
            <select
              className="block-select text-sm"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            >
              <option value="revenue">Sort: revenue</option>
              <option value="outstanding">Sort: outstanding</option>
              <option value="avg_invoice">Sort: avg invoice</option>
              <option value="health">Sort: health score</option>
              <option value="avg_pay_days">Sort: days-to-pay</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              show zero-revenue
            </label>
            <button
              type="button"
              className="block-btn block-btn-primary text-sm"
              onClick={() =>
                downloadCsv(
                  `client-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
                  [
                    'Client',
                    'Invoices',
                    'Revenue',
                    'Collected',
                    'Outstanding',
                    'Avg invoice',
                    'Avg pay days',
                    'On-time',
                    'Late',
                    'Health',
                    'Days since last',
                    'Top method',
                    'Projects',
                    'Active project value',
                    'Recovery %',
                    'QoQ %',
                    'Tier',
                    'Industry',
                  ],
                  filteredSorted.map((c) => [
                    c.name,
                    c.invoice_count,
                    c.revenue.toFixed(2),
                    c.collected.toFixed(2),
                    c.outstanding.toFixed(2),
                    c.avg_invoice.toFixed(2),
                    c.avg_pay_days != null ? c.avg_pay_days.toFixed(1) : '',
                    c.on_time,
                    c.late,
                    c.health,
                    c.daysSinceLast ?? '',
                    c.topMethod,
                    c.projectCount,
                    c.activeProjectValue.toFixed(2),
                    c.recoveryRate != null ? c.recoveryRate.toFixed(0) : '',
                    c.qoqDelta != null ? c.qoqDelta.toFixed(0) : '',
                    c.tier,
                    c.industry,
                  ])
                )
              }
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="block-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Client</th>
                <th className="text-right">LTV</th>
                <th className="text-right">Invoices</th>
                <th className="text-right">Avg inv</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Pay days</th>
                <th className="text-center">On-time</th>
                <th className="text-center">Health</th>
                <th className="text-center">Recency</th>
                <th className="text-right">Recovery</th>
                <th className="text-center">QoQ</th>
                <th className="text-left">Pays via</th>
                <th className="text-right">Projects</th>
                <th className="text-center">Copy</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.length === 0 && (
                <tr>
                  <td colSpan={14} className="text-center text-text-muted py-3">
                    No clients match.
                  </td>
                </tr>
              )}
              {filteredSorted.map((c) => {
                const paidCount = c.on_time + c.late;
                const onTimePct = paidCount > 0 ? (c.on_time / paidCount) * 100 : null;
                const stale =
                  c.daysSinceLast == null
                    ? ACCENT_EXPENSE
                    : c.daysSinceLast <= 30
                    ? ACCENT_INCOME
                    : c.daysSinceLast <= 90
                    ? ACCENT_WARNING
                    : ACCENT_EXPENSE;
                return (
                  <tr key={c.id}>
                    <td className="text-text-primary">{c.name}</td>
                    {/* Feature 1: lifetime value */}
                    <td className="text-right" style={{ color: ACCENT_INCOME }}>{formatCurrency(c.revenue)}</td>
                    {/* Feature 19: tenure tooltip via first/last invoice */}
                    <td className="text-right" title={`${formatDate(c.first_invoice)} → ${formatDate(c.last_invoice)}`}>
                      {c.invoice_count}
                    </td>
                    {/* Feature 9: avg invoice */}
                    <td className="text-right">{formatCurrency(c.avg_invoice)}</td>
                    {/* Feature 25 mini P&L: outstanding */}
                    <td className="text-right" style={{ color: c.outstanding > 0 ? ACCENT_EXPENSE : undefined }}>
                      {formatCurrency(c.outstanding)}
                    </td>
                    {/* Feature 2: avg days-to-pay badge */}
                    <td className="text-right">
                      {c.avg_pay_days != null ? (
                        <span
                          className="block-badge"
                          style={{ color: c.avg_pay_days <= 30 ? ACCENT_INCOME : c.avg_pay_days <= 60 ? ACCENT_WARNING : ACCENT_EXPENSE }}
                        >
                          {c.avg_pay_days.toFixed(0)}d
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    {/* Feature 17: on-time ratio progress */}
                    <td className="text-center">
                      {onTimePct != null ? (
                        <div className="inline-block w-14 align-middle">
                          <div className="h-1.5 w-full rounded" style={{ background: 'var(--hairline)' }}>
                            <div className="h-1.5 rounded" style={{ width: `${onTimePct}%`, background: ACCENT_INCOME }} />
                          </div>
                          <span className="text-[10px] text-text-muted">{onTimePct.toFixed(0)}%</span>
                        </div>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    {/* Feature 12: health gauge */}
                    <td className="text-center">
                      <span
                        className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold"
                        style={{
                          background: c.health >= 70 ? 'rgba(52,211,153,0.15)' : c.health >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                          color: c.health >= 70 ? ACCENT_INCOME : c.health >= 40 ? ACCENT_WARNING : ACCENT_EXPENSE,
                        }}
                      >
                        {c.health}
                      </span>
                    </td>
                    {/* Feature 11: days-since-last staleness dot */}
                    <td className="text-center" title={c.last_invoice ? `Last invoice ${formatDate(c.last_invoice, { style: 'relative' })}` : 'Never invoiced'}>
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: stale }} />
                      <span className="ml-1 text-[10px] text-text-muted">{c.daysSinceLast != null ? `${c.daysSinceLast}d` : '—'}</span>
                    </td>
                    {/* Feature 21: recovery rate */}
                    <td className="text-right">
                      {c.recoveryRate != null ? (
                        <span style={{ color: c.recoveryRate >= 80 ? ACCENT_INCOME : ACCENT_WARNING }}>{c.recoveryRate.toFixed(0)}%</span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    {/* Feature 22: QoQ delta */}
                    <td className="text-center">
                      {c.qoqDelta != null ? (
                        <span style={{ color: c.qoqDelta >= 0 ? ACCENT_INCOME : ACCENT_EXPENSE }}>
                          {c.qoqDelta >= 0 ? '▲' : '▼'} {Math.abs(c.qoqDelta).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    {/* Feature 10: top payment method */}
                    <td className="capitalize">{c.topMethod}</td>
                    {/* Feature 13: project count + active value */}
                    <td className="text-right" title={`Active project value ${formatCurrency(c.activeProjectValue)}`}>
                      {c.projectCount}
                    </td>
                    {/* Copy-to-clipboard mini P&L (feature 25) */}
                    <td className="text-center">
                      <button
                        type="button"
                        className="block-btn text-xs"
                        title="Copy P&L summary"
                        onClick={() => {
                          const text =
                            `${c.name} — Revenue ${formatCurrency(c.revenue)}, ` +
                            `Collected ${formatCurrency(c.collected)}, ` +
                            `Outstanding ${formatCurrency(c.outstanding)}, ` +
                            `Invoices ${c.invoice_count}, Health ${c.health}`;
                          void navigator.clipboard?.writeText(text);
                        }}
                      >
                        ⧉
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Showing {filteredSorted.length} of {m.clients.length} clients. Avg invoice = AVG(invoices.total); pay-days = mean
          of payment date minus issue date; recovery = reimbursed ÷ billable expenses; health blends recency, on-time ratio,
          balance pressure and invoice volume.
        </p>
      </div>
    </div>
  );
}

// ─── Small presentational helpers ───────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent: string }): React.ReactElement {
  return (
    <div className="rounded p-3" style={{ background: 'var(--bg-tertiary, rgba(255,255,255,0.02))', borderRadius: 'var(--app-radius)' }}>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function aging(m: AnalyticsModel, bucket: string): number {
  return m.aging.find((a) => a.bucket === bucket)?.amount ?? 0;
}

export default ClientsUpgradesPart2;
