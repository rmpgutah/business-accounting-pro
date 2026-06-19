/**
 * ExpensesUpgradesPart2 — "Insights & Analytics" panel for the Expenses module.
 *
 * A self-contained vertical stack of titled `.block-card` widgets, each one a
 * small working feature that reads REAL data through the `api` wrapper and
 * computes a live statistic, chart, export, or bulk action. No chart library —
 * all visuals are hand-rolled SVG. No hard-coded numbers; everything is derived
 * from the loaded expenses / line-items / vendors / categories / projects.
 *
 * Data is company-scoped: `api.query` auto-scopes by the active company; the
 * few `api.rawQuery` JOIN calls filter explicitly on `company_id` (rawQuery does
 * NOT auto-scope). Loading / empty / error states are handled and render never
 * throws.
 */

import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate, percentChange } from '../../../lib/format';

// ─── Row shapes (only the columns we read) ───────────────────────────────
interface ExpenseRow {
  id: string;
  vendor_id: string | null;
  category_id: string | null;
  project_id: string | null;
  client_id: string | null;
  date: string;
  amount: number;
  tax_amount: number;
  status: string;
  is_billable: number;
  is_reimbursable: number;
  reimbursed: number;
  reimbursed_date: string | null;
  is_recurring: number;
  is_tax_deductible: number;
  receipt_path: string | null;
}
interface CategoryRow { id: string; name: string; color: string }
interface VendorRow { id: string; name: string }
interface ProjectRow { id: string; name: string; budget: number }

// Aggregate rows returned by rawQuery JOINs
interface DeductibleSplitRow { deductible: number; total: number }
interface ProjectBurnRow { project_id: string; name: string; budget: number; spent: number }
interface LargestRow { id: string; amount: number; date: string; vendor_name: string | null; category_name: string | null }
interface VendorRecencyRow { vendor_id: string; name: string; last_date: string; cnt: number }
interface DaysToPayRow { vendor_id: string; name: string; avg_days: number; paid_cnt: number }

// ─── Theme color tokens (read at runtime; never hard-coded hex) ──────────
function tokenColors() {
  if (typeof window === 'undefined') {
    // SSR / test path: return CSS var() strings so intent is preserved even
    // when computed styles are unavailable. Chromium SVG honours var() in
    // presentation attributes, so these are safe to pass to fill/stroke/style.
    return {
      income: 'var(--color-accent-income)',
      expense: 'var(--color-accent-expense)',
      blue: 'var(--color-accent-blue)',
      warning: 'var(--color-accent-warning)',
      muted: 'var(--color-text-muted)',
    };
  }
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    income: read('--color-accent-income', 'var(--color-accent-income)'),
    expense: read('--color-accent-expense', 'var(--color-accent-expense)'),
    blue: read('--color-accent-blue', 'var(--color-accent-blue)'),
    warning: read('--color-accent-warning', 'var(--color-accent-warning)'),
    muted: read('--color-text-muted', 'var(--color-text-muted)'),
  };
}

// ─── Small helpers ───────────────────────────────────────────────────────
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const ym = (d: string): string => (d || '').slice(0, 7);
const monthLabel = (key: string): string => {
  const [y, m] = key.split('-');
  if (!y || !m) return key;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};
const compact = (v: number): string =>
  v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`;
const median = (vals: number[]): number => {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const esc = (c: string | number) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Reusable card shell ─────────────────────────────────────────────────
const Card: React.FC<{ title: string; right?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  right,
  children,
}) => (
  <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
    <div className="flex items-center justify-between mb-3 pb-2 border-b border-border-primary/40">
      <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{title}</h3>
      {right}
    </div>
    {children}
  </div>
);

const Empty: React.FC<{ label?: string }> = ({ label = 'No data for this metric yet.' }) => (
  <p className="text-xs text-text-muted py-2">{label}</p>
);

// =========================================================================
//  Main component
// =========================================================================
const ExpensesUpgradesPart2: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id ?? null;

  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  // rawQuery-backed aggregates
  const [dedSplit, setDedSplit] = useState<DeductibleSplitRow | null>(null);
  const [projectBurn, setProjectBurn] = useState<ProjectBurnRow[]>([]);
  const [largest, setLargest] = useState<LargestRow[]>([]);
  const [recency, setRecency] = useState<VendorRecencyRow[]>([]);
  const [daysToPay, setDaysToPay] = useState<DaysToPayRow[]>([]);
  const [catTrend, setCatTrend] = useState<Array<{ name: string; m: Record<string, number> }>>([]);
  const [trendMonths, setTrendMonths] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const colors = useMemo(() => tokenColors(), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [exp, cats, vds, prjs] = await Promise.all([
          api.query('expenses', undefined, { field: 'date', dir: 'desc' }) as Promise<ExpenseRow[]>,
          api.query('categories') as Promise<CategoryRow[]>,
          api.query('vendors') as Promise<VendorRow[]>,
          api.query('projects') as Promise<ProjectRow[]>,
        ]);
        if (cancelled) return;
        const expRows = Array.isArray(exp) ? exp.filter((e) => e && e.id) : [];
        setExpenses(expRows);
        setCategories(Array.isArray(cats) ? cats : []);
        setVendors(Array.isArray(vds) ? vds : []);
        setProjects(Array.isArray(prjs) ? prjs : []);

        if (companyId) {
          // 6. Tax-deductible split (from line items, falling back to expense flag)
          const splitRows = (await api.rawQuery(
            `SELECT
               COALESCE(SUM(CASE WHEN COALESCE(li.is_tax_deductible,1)=1 THEN li.amount ELSE 0 END),0) AS deductible,
               COALESCE(SUM(li.amount),0) AS total
             FROM expense_line_items li
             JOIN expenses e ON e.id = li.expense_id
             WHERE e.company_id = ? AND (e.deleted_at IS NULL OR e.deleted_at = '')`,
            [companyId],
          )) as DeductibleSplitRow[] | { error: string };
          if (!cancelled && Array.isArray(splitRows)) setDedSplit(splitRows[0] ?? null);

          // 9. Project budget burn
          const burn = (await api.rawQuery(
            `SELECT p.id AS project_id, p.name AS name, p.budget AS budget,
                    COALESCE((SELECT SUM(amount) FROM expenses e
                              WHERE e.project_id = p.id
                                AND (e.deleted_at IS NULL OR e.deleted_at='')),0) AS spent
             FROM projects p
             WHERE p.company_id = ? AND p.budget > 0
             ORDER BY spent DESC LIMIT 12`,
            [companyId],
          )) as ProjectBurnRow[] | { error: string };
          if (!cancelled && Array.isArray(burn)) setProjectBurn(burn);

          // 14. Largest expenses with vendor + category names
          const big = (await api.rawQuery(
            `SELECT e.id AS id, e.amount AS amount, e.date AS date,
                    v.name AS vendor_name, c.name AS category_name
             FROM expenses e
             LEFT JOIN vendors v ON v.id = e.vendor_id
             LEFT JOIN categories c ON c.id = e.category_id
             WHERE e.company_id = ? AND (e.deleted_at IS NULL OR e.deleted_at='')
             ORDER BY e.amount DESC LIMIT 8`,
            [companyId],
          )) as LargestRow[] | { error: string };
          if (!cancelled && Array.isArray(big)) setLargest(big);

          // 20. Vendor activity recency
          const rec = (await api.rawQuery(
            `SELECT e.vendor_id AS vendor_id, v.name AS name,
                    MAX(e.date) AS last_date, COUNT(*) AS cnt
             FROM expenses e JOIN vendors v ON v.id = e.vendor_id
             WHERE e.company_id = ? AND e.vendor_id IS NOT NULL
               AND (e.deleted_at IS NULL OR e.deleted_at='')
             GROUP BY e.vendor_id, v.name
             ORDER BY last_date ASC LIMIT 10`,
            [companyId],
          )) as VendorRecencyRow[] | { error: string };
          if (!cancelled && Array.isArray(rec)) setRecency(rec);

          // 22. Average days-to-pay per vendor (expense date → reimbursed_date)
          const dtp = (await api.rawQuery(
            `SELECT e.vendor_id AS vendor_id, v.name AS name,
                    AVG(julianday(e.reimbursed_date) - julianday(e.date)) AS avg_days,
                    COUNT(*) AS paid_cnt
             FROM expenses e JOIN vendors v ON v.id = e.vendor_id
             WHERE e.company_id = ? AND e.vendor_id IS NOT NULL
               AND e.reimbursed_date IS NOT NULL AND e.reimbursed_date <> ''
               AND (e.deleted_at IS NULL OR e.deleted_at='')
             GROUP BY e.vendor_id, v.name
             HAVING paid_cnt > 0
             ORDER BY avg_days DESC LIMIT 8`,
            [companyId],
          )) as DaysToPayRow[] | { error: string };
          if (!cancelled && Array.isArray(dtp)) setDaysToPay(dtp);

          // 13. Category trend across last 3 months
          const now = new Date();
          const months: string[] = [];
          for (let i = 2; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
          }
          if (!cancelled) setTrendMonths(months);
          const ct = (await api.rawQuery(
            `SELECT COALESCE(c.name,'Uncategorized') AS name,
                    strftime('%Y-%m', e.date) AS mo,
                    SUM(e.amount) AS total
             FROM expenses e
             LEFT JOIN categories c ON c.id = e.category_id
             WHERE e.company_id = ? AND (e.deleted_at IS NULL OR e.deleted_at='')
               AND strftime('%Y-%m', e.date) >= ?
             GROUP BY name, mo`,
            [companyId, months[0]],
          )) as Array<{ name: string; mo: string; total: number }> | { error: string };
          if (!cancelled && Array.isArray(ct)) {
            const byCat = new Map<string, Record<string, number>>();
            for (const r of ct) {
              if (!byCat.has(r.name)) byCat.set(r.name, {});
              byCat.get(r.name)![r.mo] = num(r.total);
            }
            const arr = Array.from(byCat.entries())
              .map(([name, m]) => ({ name, m }))
              .sort((a, b) => {
                const sa = months.reduce((s, mo) => s + (a.m[mo] || 0), 0);
                const sb = months.reduce((s, mo) => s + (b.m[mo] || 0), 0);
                return sb - sa;
              })
              .slice(0, 8);
            setCatTrend(arr);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load analytics.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // ── Lookups ──
  const catName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const catColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.color || colors.muted);
    return m;
  }, [categories, colors.muted]);
  const vendorName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendors) m.set(v.id, v.name);
    return m;
  }, [vendors]);

  // active (non-deleted) expenses array for client-side metrics
  const active = expenses;

  // ── 1. Spend-by-category (donut data) ──
  const catTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of active) {
      const k = e.category_id || '';
      m.set(k, (m.get(k) || 0) + num(e.amount));
    }
    return Array.from(m.entries())
      .map(([id, total]) => ({
        id,
        total,
        name: id ? catName.get(id) || 'Uncategorized' : 'Uncategorized',
        color: id ? catColor.get(id) || colors.muted : colors.muted,
      }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [active, catName, catColor, colors.muted]);
  const grandTotal = useMemo(() => catTotals.reduce((s, c) => s + c.total, 0), [catTotals]);

  // ── 2 / 23. Monthly totals (trend + anomaly) ──
  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of active) {
      const k = ym(e.date);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + num(e.amount));
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [active]);

  const anomalies = useMemo(() => {
    if (monthly.length < 3) return [];
    const vals = monthly.map(([, v]) => v);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const sd = Math.sqrt(variance);
    if (sd === 0) return [];
    return monthly
      .filter(([, v]) => Math.abs(v - mean) > 1.5 * sd)
      .map(([k, v]) => ({ key: k, total: v, dir: v > mean ? 'high' : 'low' as 'high' | 'low' }));
  }, [monthly]);

  // ── 3 / 10. Vendor totals (bars + Pareto) ──
  const vendorTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of active) {
      if (!e.vendor_id) continue;
      m.set(e.vendor_id, (m.get(e.vendor_id) || 0) + num(e.amount));
    }
    return Array.from(m.entries())
      .map(([id, total]) => ({ id, total, name: vendorName.get(id) || 'Unknown vendor' }))
      .sort((a, b) => b.total - a.total);
  }, [active, vendorName]);

  const pareto = useMemo(() => {
    const total = vendorTotals.reduce((s, v) => s + v.total, 0);
    if (total === 0) return { count80: 0, totalVendors: 0, points: [] as Array<{ x: number; y: number }> };
    let cum = 0;
    let count80 = 0;
    let reached = false;
    const points: Array<{ x: number; y: number }> = [];
    vendorTotals.forEach((v, i) => {
      cum += v.total;
      const share = cum / total;
      points.push({ x: (i + 1) / vendorTotals.length, y: share });
      if (!reached) {
        count80 = i + 1;
        if (share >= 0.8) reached = true;
      }
    });
    return { count80, totalVendors: vendorTotals.length, points };
  }, [vendorTotals]);

  // ── 4. Month-over-month variance ──
  const mom = useMemo(() => {
    if (monthly.length < 2) return null;
    const cur = monthly[monthly.length - 1];
    const prior = monthly[monthly.length - 2];
    return { curKey: cur[0], cur: cur[1], priorKey: prior[0], prior: prior[1], pct: percentChange(cur[1], prior[1]) };
  }, [monthly]);

  // ── 5. Count / sum / mean / median ──
  const stats = useMemo(() => {
    const vals = active.map((e) => num(e.amount));
    const sum = vals.reduce((s, v) => s + v, 0);
    return { count: vals.length, sum, mean: vals.length ? sum / vals.length : 0, med: median(vals) };
  }, [active]);

  // ── 7. Pending-approval backlog ──
  const pending = useMemo(() => {
    const rows = active.filter((e) => e.status === 'pending');
    return { count: rows.length, sum: rows.reduce((s, e) => s + num(e.amount), 0) };
  }, [active]);

  // ── 8. Reimbursable owed ──
  const reimb = useMemo(() => {
    const rows = active.filter((e) => num(e.is_reimbursable) === 1 && num(e.reimbursed) === 0);
    return { count: rows.length, sum: rows.reduce((s, e) => s + num(e.amount), 0) };
  }, [active]);

  // ── 11. Day-of-week heat strip ──
  const dow = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    for (const e of active) {
      const d = e.date ? new Date(`${e.date.slice(0, 10)}T12:00:00`) : null;
      if (!d || isNaN(d.getTime())) continue;
      buckets[d.getDay()] += num(e.amount);
    }
    return buckets;
  }, [active]);

  // ── 12. Receipt coverage ──
  const receipt = useMemo(() => {
    const withReceipt = active.filter((e) => (e.receipt_path || '').trim().length > 0).length;
    return { withReceipt, total: active.length, pct: active.length ? withReceipt / active.length : 0 };
  }, [active]);

  // ── 15. Billable recovery ──
  const billable = useMemo(() => {
    const bill = active.filter((e) => num(e.is_billable) === 1);
    const billSum = bill.reduce((s, e) => s + num(e.amount), 0);
    const linkedSum = bill.filter((e) => !!e.client_id).reduce((s, e) => s + num(e.amount), 0);
    return { billSum, linkedSum, unbilled: billSum - linkedSum, count: bill.length };
  }, [active]);

  // ── 16. Run-rate forecast (current month) ──
  const forecast = useMemo(() => {
    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const mtd = active
      .filter((e) => ym(e.date) === curKey)
      .reduce((s, e) => s + num(e.amount), 0);
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projected = dayOfMonth > 0 ? (mtd / dayOfMonth) * daysInMonth : 0;
    return { mtd, projected, dayOfMonth, daysInMonth, curKey };
  }, [active]);

  // ── 17. Tax collected (input tax) by month ──
  const taxByMonth = useMemo(() => {
    const m = new Map<string, number>();
    let total = 0;
    for (const e of active) {
      const k = ym(e.date);
      if (!k) continue;
      const t = num(e.tax_amount);
      m.set(k, (m.get(k) || 0) + t);
      total += t;
    }
    return { total, months: Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4) };
  }, [active]);

  // ── 18. Recurring commitment ──
  const recurring = useMemo(() => {
    const rec = active.filter((e) => num(e.is_recurring) === 1);
    const recSum = rec.reduce((s, e) => s + num(e.amount), 0);
    return { count: rec.length, recSum, total: stats.sum, share: stats.sum ? recSum / stats.sum : 0 };
  }, [active, stats.sum]);

  // ── 19. Weekly outflow (ISO-ish week buckets, last 12) ──
  const weekly = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of active) {
      const d = e.date ? new Date(`${e.date.slice(0, 10)}T12:00:00`) : null;
      if (!d || isNaN(d.getTime())) continue;
      // Monday-anchored week start
      const tmp = new Date(d);
      const day = (tmp.getDay() + 6) % 7;
      tmp.setDate(tmp.getDate() - day);
      const key = `${tmp.getFullYear()}-${String(tmp.getMonth() + 1).padStart(2, '0')}-${String(tmp.getDate()).padStart(2, '0')}`;
      m.set(key, (m.get(key) || 0) + num(e.amount));
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  }, [active]);

  // ── 24. Period comparison (this calendar month vs last) ──
  const [drillCat, setDrillCat] = useState<string | null>(null);

  const periodCompare = useMemo(() => {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prev = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
    const acc = new Map<string, { cur: number; prev: number }>();
    for (const e of active) {
      const k = ym(e.date);
      const cid = e.category_id ? catName.get(e.category_id) || 'Uncategorized' : 'Uncategorized';
      if (k !== cur && k !== prev) continue;
      if (!acc.has(cid)) acc.set(cid, { cur: 0, prev: 0 });
      const slot = acc.get(cid)!;
      if (k === cur) slot.cur += num(e.amount);
      else slot.prev += num(e.amount);
    }
    return {
      cur,
      prev,
      rows: Array.from(acc.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.cur + b.prev - (a.cur + a.prev))
        .slice(0, 8),
    };
  }, [active, catName]);

  // ── 21. Category drill-down rows ──
  const drillRows = useMemo(() => {
    if (!drillCat) return [];
    return active
      .filter((e) => (e.category_id || '') === drillCat)
      .slice(0, 25);
  }, [active, drillCat]);

  // ─── render guards ───
  if (loading) {
    return (
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Insights &amp; Analytics</h2>
        <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
          <p className="text-xs text-text-muted">Loading analytics…</p>
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Insights &amp; Analytics</h2>
        <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
          <p className="text-xs" style={{ color: colors.expense }}>{error}</p>
        </div>
      </section>
    );
  }
  if (active.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Insights &amp; Analytics</h2>
        <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
          <p className="text-xs text-text-muted">No expenses recorded yet. Add expenses to unlock insights.</p>
        </div>
      </section>
    );
  }

  // ── donut geometry ──
  const donut = (() => {
    const R = 54, SW = 22, C = 70, circ = 2 * Math.PI * R;
    let offset = 0;
    const segs = catTotals.slice(0, 8).map((c) => {
      const frac = grandTotal ? c.total / grandTotal : 0;
      const seg = { ...c, dash: frac * circ, offset, frac };
      offset += frac * circ;
      return seg;
    });
    return { R, SW, C, circ, segs };
  })();

  const dowMax = Math.max(...dow, 1);
  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // sparkline geometry for monthly trend
  const spark = (() => {
    const W = 560, H = 70, pad = 4;
    const vals = monthly.map(([, v]) => v);
    const max = Math.max(...vals, 1);
    const n = monthly.length;
    const pts = monthly.map(([, v], i) => {
      const x = n > 1 ? pad + (i / (n - 1)) * (W - pad * 2) : W / 2;
      const y = pad + (1 - v / max) * (H - pad * 2);
      return { x, y };
    });
    return { W, H, pts, line: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') };
  })();

  // weekly column geometry
  const weeklyMax = Math.max(...weekly.map(([, v]) => v), 1);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Insights &amp; Analytics</h2>

      {/* 23. Anomaly banner */}
      {anomalies.length > 0 && (
        <div
          className="block-card p-3 flex items-start gap-2"
          style={{ borderRadius: 'var(--app-radius)', borderColor: colors.warning }}
        >
          <span style={{ color: colors.warning }} className="text-sm">⚠</span>
          <p className="text-xs text-text-secondary">
            <span className="font-semibold text-text-primary">Spend anomaly detected.</span>{' '}
            {anomalies
              .map((a) => `${monthLabel(a.key)} (${formatCurrency(a.total)}, ${a.dir})`)
              .join(', ')}{' '}
            deviate more than 1.5σ from the trailing monthly average.
          </p>
        </div>
      )}

      {/* 5. Stat tiles */}
      <Card title="Expense Statistics">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Count', value: String(stats.count) },
            { label: 'Total', value: formatCurrency(stats.sum) },
            { label: 'Average', value: formatCurrency(stats.mean) },
            { label: 'Median', value: formatCurrency(stats.med) },
          ].map((t) => (
            <div key={t.label} className="bg-bg-tertiary rounded p-3" style={{ borderRadius: 'var(--app-radius)' }}>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">{t.label}</div>
              <div className="text-lg font-semibold text-text-primary font-mono mt-1">{t.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* 4. Month-over-month variance */}
      <Card title="Month-over-Month Variance">
        {mom ? (
          <div className="flex items-end gap-6">
            <div>
              <div className="text-[10px] uppercase text-text-muted">{monthLabel(mom.curKey)}</div>
              <div className="text-2xl font-semibold text-text-primary font-mono">{formatCurrency(mom.cur)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-text-muted">vs {monthLabel(mom.priorKey)}</div>
              <div className="text-sm text-text-secondary font-mono">{formatCurrency(mom.prior)}</div>
            </div>
            <div
              className="text-lg font-semibold font-mono ml-auto"
              style={{ color: mom.pct == null ? colors.muted : mom.pct > 0 ? colors.expense : colors.income }}
            >
              {mom.pct == null ? '—' : `${mom.pct > 0 ? '▲' : '▼'} ${Math.abs(mom.pct).toFixed(1)}%`}
            </div>
          </div>
        ) : (
          <Empty label="Need at least two months of data." />
        )}
      </Card>

      {/* 7 / 8. Pending + reimbursable tiles */}
      <Card title="Action Required">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-bg-tertiary p-3" style={{ borderRadius: 'var(--app-radius)' }}>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Pending Approval</div>
            <div className="text-lg font-semibold font-mono mt-1" style={{ color: colors.warning }}>
              {formatCurrency(pending.sum)}
            </div>
            <div className="text-[11px] text-text-muted">{pending.count} expense{pending.count === 1 ? '' : 's'} awaiting approval</div>
          </div>
          <div className="bg-bg-tertiary p-3" style={{ borderRadius: 'var(--app-radius)' }}>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Reimbursements Owed</div>
            <div className="text-lg font-semibold font-mono mt-1" style={{ color: colors.expense }}>
              {formatCurrency(reimb.sum)}
            </div>
            <div className="text-[11px] text-text-muted">{reimb.count} unpaid reimbursable expense{reimb.count === 1 ? '' : 's'}</div>
          </div>
        </div>
      </Card>

      {/* 1 / 21. Spend-by-category donut + drill-down */}
      <Card
        title="Spend by Category"
        right={
          <button
            type="button"
            className="block-btn text-[10px]"
            onClick={() =>
              downloadCsv(
                'spend-by-category.csv',
                [['Category', 'Total', 'Share %'], ...catTotals.map((c) => [c.name, c.total.toFixed(2), grandTotal ? ((c.total / grandTotal) * 100).toFixed(1) : '0'])],
              )
            }
          >
            Export CSV
          </button>
        }
      >
        {catTotals.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <svg width={140} height={140} viewBox="0 0 140 140" className="shrink-0">
              {donut.segs.map((s) => (
                <circle
                  key={s.id || 'uncat'}
                  cx={donut.C}
                  cy={donut.C}
                  r={donut.R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={donut.SW}
                  strokeDasharray={`${s.dash} ${donut.circ - s.dash}`}
                  strokeDashoffset={-s.offset}
                  transform={`rotate(-90 ${donut.C} ${donut.C})`}
                  style={{ cursor: s.id ? 'pointer' : 'default', opacity: drillCat && drillCat !== s.id ? 0.35 : 1 }}
                  onClick={() => s.id && setDrillCat(drillCat === s.id ? null : s.id)}
                >
                  <title>{`${s.name}: ${formatCurrency(s.total)} (${(s.frac * 100).toFixed(1)}%)`}</title>
                </circle>
              ))}
              <text x={donut.C} y={donut.C - 4} textAnchor="middle" fontSize={9} fill={colors.muted}>Total</text>
              <text x={donut.C} y={donut.C + 10} textAnchor="middle" fontSize={11} fontWeight={700} fill={colors.muted}>
                {compact(grandTotal)}
              </text>
            </svg>
            <div className="flex-1 w-full space-y-1">
              {catTotals.slice(0, 8).map((c) => (
                <button
                  key={c.id || 'uncat'}
                  type="button"
                  className="w-full flex items-center gap-2 text-xs py-0.5 text-left hover:bg-bg-tertiary rounded px-1"
                  style={{ opacity: drillCat && drillCat !== c.id ? 0.5 : 1 }}
                  onClick={() => c.id && setDrillCat(drillCat === c.id ? null : c.id)}
                >
                  <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
                  <span className="text-text-secondary truncate flex-1">{c.name}</span>
                  <span className="font-mono text-text-primary">{formatCurrency(c.total)}</span>
                  <span className="font-mono text-text-muted w-12 text-right">
                    {grandTotal ? ((c.total / grandTotal) * 100).toFixed(0) : 0}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {drillCat && (
          <div className="mt-3 pt-3 border-t border-border-primary/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-text-secondary font-semibold">
                {catName.get(drillCat) || 'Category'} · {drillRows.length} expense{drillRows.length === 1 ? '' : 's'}
              </span>
              <button type="button" className="block-btn text-[10px]" onClick={() => setDrillCat(null)}>Close</button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {drillRows.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-[11px] py-0.5">
                  <span className="text-text-muted">{formatDate(e.date, { style: 'short' })}</span>
                  <span className="text-text-secondary truncate px-2 flex-1">
                    {e.vendor_id ? vendorName.get(e.vendor_id) || '—' : '—'}
                  </span>
                  <span className="font-mono text-text-primary">{formatCurrency(e.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 2. Monthly spend trend sparkline */}
      <Card title="Monthly Spend Trend">
        {monthly.length < 2 ? (
          <Empty label="Need at least two months of data." />
        ) : (
          <>
            <svg viewBox={`0 0 ${spark.W} ${spark.H}`} width="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
              <path d={spark.line} fill="none" stroke={colors.blue} strokeWidth={2} />
              {spark.pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={colors.blue} />
              ))}
            </svg>
            <div className="flex justify-between text-[10px] text-text-muted mt-1 font-mono">
              <span>{monthLabel(monthly[0][0])}</span>
              <span>{monthLabel(monthly[monthly.length - 1][0])}</span>
            </div>
          </>
        )}
      </Card>

      {/* 16. Run-rate forecast */}
      <Card title="Month-End Forecast (Run Rate)">
        <div className="flex items-end gap-6">
          <div>
            <div className="text-[10px] uppercase text-text-muted">MTD ({monthLabel(forecast.curKey)})</div>
            <div className="text-xl font-semibold text-text-primary font-mono">{formatCurrency(forecast.mtd)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-text-muted">Projected month-end</div>
            <div className="text-xl font-semibold font-mono" style={{ color: colors.warning }}>
              {formatCurrency(forecast.projected)}
            </div>
          </div>
          <div className="text-[11px] text-text-muted ml-auto">
            Day {forecast.dayOfMonth} of {forecast.daysInMonth}
          </div>
        </div>
      </Card>

      {/* 3. Top-10 vendors */}
      <Card title="Top Vendors">
        {vendorTotals.length === 0 ? (
          <Empty label="No vendor-linked expenses." />
        ) : (
          <div className="space-y-1.5">
            {vendorTotals.slice(0, 10).map((v) => {
              const pct = vendorTotals[0].total ? v.total / vendorTotals[0].total : 0;
              return (
                <div key={v.id} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate text-text-secondary">{v.name}</span>
                  <div className="flex-1 bg-bg-tertiary rounded h-3 overflow-hidden">
                    <div className="h-full" style={{ width: `${Math.max(pct * 100, 2)}%`, background: colors.blue }} />
                  </div>
                  <span className="w-20 text-right font-mono text-text-primary">{formatCurrency(v.total)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 10. Vendor concentration / Pareto */}
      <Card title="Vendor Concentration (Pareto)">
        {pareto.totalVendors === 0 ? (
          <Empty label="No vendor-linked expenses." />
        ) : (
          <>
            <p className="text-xs text-text-secondary mb-2">
              <span className="font-semibold text-text-primary font-mono">{pareto.count80}</span> of{' '}
              <span className="font-mono">{pareto.totalVendors}</span> vendors{' '}
              ({pareto.totalVendors ? ((pareto.count80 / pareto.totalVendors) * 100).toFixed(0) : 0}%) account for ~80% of spend.
            </p>
            <svg viewBox="0 0 200 70" width="100%" preserveAspectRatio="none" style={{ display: 'block', height: 70 }}>
              <line x1={0} y1={70 - 0.8 * 70} x2={200} y2={70 - 0.8 * 70} stroke={colors.muted} strokeWidth={0.5} strokeDasharray="3 3" />
              <path
                d={pareto.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * 200).toFixed(1)},${(70 - p.y * 70).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={colors.warning}
                strokeWidth={1.5}
              />
            </svg>
          </>
        )}
      </Card>

      {/* 6. Tax-deductible split */}
      <Card title="Tax-Deductible Coverage">
        {dedSplit && dedSplit.total > 0 ? (
          (() => {
            const ded = num(dedSplit.deductible);
            const tot = num(dedSplit.total);
            const pct = tot ? ded / tot : 0;
            return (
              <>
                <div className="flex h-5 rounded overflow-hidden bg-bg-tertiary">
                  <div className="h-full flex items-center justify-center text-[9px] text-text-primary" style={{ width: `${pct * 100}%`, background: colors.income }}>
                    {pct > 0.12 ? 'Deductible' : ''}
                  </div>
                  <div className="h-full flex items-center justify-center text-[9px] text-text-primary" style={{ width: `${(1 - pct) * 100}%`, background: colors.expense }}>
                    {1 - pct > 0.12 ? 'Non-ded.' : ''}
                  </div>
                </div>
                <p className="text-[11px] text-text-muted mt-2 font-mono">
                  {formatCurrency(ded)} deductible of {formatCurrency(tot)} ({(pct * 100).toFixed(1)}% coverage)
                </p>
              </>
            );
          })()
        ) : (
          <Empty label="No itemized line items found." />
        )}
      </Card>

      {/* 17. Input tax summary */}
      <Card title="Input Tax (Tax Paid)">
        <div className="text-xl font-semibold text-text-primary font-mono mb-2">{formatCurrency(taxByMonth.total)}</div>
        {taxByMonth.months.length === 0 ? (
          <Empty label="No tax amounts recorded." />
        ) : (
          <div className="space-y-1">
            {taxByMonth.months.map(([k, v]) => (
              <div key={k} className="flex justify-between text-[11px]">
                <span className="text-text-muted">{monthLabel(k)}</span>
                <span className="font-mono text-text-secondary">{formatCurrency(v)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 18. Recurring commitment */}
      <Card title="Recurring Commitments">
        <div className="flex items-end gap-6">
          <div>
            <div className="text-[10px] uppercase text-text-muted">Recurring spend</div>
            <div className="text-xl font-semibold font-mono" style={{ color: colors.blue }}>{formatCurrency(recurring.recSum)}</div>
            <div className="text-[11px] text-text-muted">{recurring.count} recurring expense{recurring.count === 1 ? '' : 's'}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase text-text-muted">Share of total spend</div>
            <div className="text-lg font-semibold text-text-primary font-mono">{(recurring.share * 100).toFixed(1)}%</div>
          </div>
        </div>
      </Card>

      {/* 15. Billable recovery */}
      <Card title="Billable Recovery">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] uppercase text-text-muted">Billable</div>
            <div className="text-base font-semibold text-text-primary font-mono">{formatCurrency(billable.billSum)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-text-muted">Linked to client</div>
            <div className="text-base font-semibold font-mono" style={{ color: colors.income }}>{formatCurrency(billable.linkedSum)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-text-muted">Unbilled gap</div>
            <div className="text-base font-semibold font-mono" style={{ color: colors.expense }}>{formatCurrency(billable.unbilled)}</div>
          </div>
        </div>
      </Card>

      {/* 12. Receipt coverage gauge */}
      <Card title="Receipt Coverage">
        <div className="flex items-center gap-4">
          <svg width={90} height={90} viewBox="0 0 90 90">
            <circle cx={45} cy={45} r={36} fill="none" stroke="var(--color-bg-tertiary, #2a2a2a)" strokeWidth={10} />
            <circle
              cx={45}
              cy={45}
              r={36}
              fill="none"
              stroke={receipt.pct >= 0.8 ? colors.income : receipt.pct >= 0.5 ? colors.warning : colors.expense}
              strokeWidth={10}
              strokeDasharray={`${receipt.pct * 2 * Math.PI * 36} ${2 * Math.PI * 36}`}
              strokeDashoffset={0}
              transform="rotate(-90 45 45)"
              strokeLinecap="round"
            />
            <text x={45} y={49} textAnchor="middle" fontSize={16} fontWeight={700} fill={colors.muted}>
              {(receipt.pct * 100).toFixed(0)}%
            </text>
          </svg>
          <div className="text-xs text-text-secondary">
            <p>
              <span className="font-mono text-text-primary">{receipt.withReceipt}</span> of{' '}
              <span className="font-mono">{receipt.total}</span> expenses have a receipt attached.
            </p>
            {receipt.pct < 0.8 && (
              <p className="mt-1" style={{ color: colors.warning }}>
                {receipt.total - receipt.withReceipt} expense{receipt.total - receipt.withReceipt === 1 ? '' : 's'} missing receipts — possible compliance gap.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* 11. Day-of-week heat strip */}
      <Card title="Spend by Day of Week">
        <div className="flex gap-1">
          {dow.map((v, i) => {
            const intensity = v / dowMax;
            return (
              <div key={i} className="flex-1 text-center">
                <div
                  className="rounded"
                  style={{
                    height: 40,
                    background: colors.blue,
                    opacity: 0.15 + intensity * 0.85,
                  }}
                  title={`${DOW_LABELS[i]}: ${formatCurrency(v)}`}
                />
                <div className="text-[9px] text-text-muted mt-1">{DOW_LABELS[i]}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 19. Weekly outflow columns */}
      <Card title="Weekly Cash Outflow">
        {weekly.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex items-end gap-1.5" style={{ height: 90 }}>
            {weekly.map(([k, v]) => (
              <div key={k} className="flex-1 flex flex-col justify-end items-center" title={`Week of ${formatDate(k, { style: 'short' })}: ${formatCurrency(v)}`}>
                <div className="w-full rounded-t" style={{ height: `${(v / weeklyMax) * 70}px`, background: colors.expense, minHeight: 2 }} />
                <div className="text-[8px] text-text-muted mt-1">{k.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 9. Project budget burn */}
      <Card title="Project Budget Burn">
        {projectBurn.length === 0 ? (
          <Empty label="No projects with a budget." />
        ) : (
          <div className="space-y-2">
            {projectBurn.map((p) => {
              const burn = num(p.budget) ? num(p.spent) / num(p.budget) : 0;
              const over = burn > 1;
              return (
                <div key={p.project_id}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-text-secondary truncate">{p.name}</span>
                    <span className="font-mono" style={{ color: over ? colors.expense : colors.muted }}>
                      {formatCurrency(p.spent)} / {formatCurrency(p.budget)} ({(burn * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <div className="bg-bg-tertiary rounded h-2.5 overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.min(burn * 100, 100)}%`,
                        background: over ? colors.expense : burn > 0.8 ? colors.warning : colors.income,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 13. Category trend mini-table */}
      <Card title="Category Trend (Last 3 Months)">
        {catTrend.length === 0 || trendMonths.length === 0 ? (
          <Empty />
        ) : (
          <table className="block-table w-full text-[11px]">
            <thead>
              <tr>
                <th className="text-left">Category</th>
                {trendMonths.map((m) => (
                  <th key={m} className="text-right">{monthLabel(m)}</th>
                ))}
                <th className="text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {catTrend.map((row) => {
                const first = row.m[trendMonths[0]] || 0;
                const last = row.m[trendMonths[trendMonths.length - 1]] || 0;
                const delta = percentChange(last, first);
                return (
                  <tr key={row.name}>
                    <td className="text-text-secondary truncate">{row.name}</td>
                    {trendMonths.map((m) => (
                      <td key={m} className="text-right font-mono text-text-muted">{compact(row.m[m] || 0)}</td>
                    ))}
                    <td className="text-right font-mono" style={{ color: delta == null ? colors.muted : delta > 0 ? colors.expense : colors.income }}>
                      {delta == null ? '—' : `${delta > 0 ? '▲' : '▼'}${Math.abs(delta).toFixed(0)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* 24. Period comparison */}
      <Card title="Period Comparison by Category">
        {periodCompare.rows.length === 0 ? (
          <Empty label="No spend in the current or prior month." />
        ) : (
          <table className="block-table w-full text-[11px]">
            <thead>
              <tr>
                <th className="text-left">Category</th>
                <th className="text-right">{monthLabel(periodCompare.prev)}</th>
                <th className="text-right">{monthLabel(periodCompare.cur)}</th>
                <th className="text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {periodCompare.rows.map((r) => {
                const d = percentChange(r.cur, r.prev);
                return (
                  <tr key={r.name}>
                    <td className="text-text-secondary truncate">{r.name}</td>
                    <td className="text-right font-mono text-text-muted">{formatCurrency(r.prev)}</td>
                    <td className="text-right font-mono text-text-primary">{formatCurrency(r.cur)}</td>
                    <td className="text-right font-mono" style={{ color: d == null ? colors.muted : d > 0 ? colors.expense : colors.income }}>
                      {d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(0)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* 14. Largest expense leaderboard */}
      <Card
        title="Largest Expenses"
        right={
          <button
            type="button"
            className="block-btn text-[10px]"
            onClick={() => navigator.clipboard?.writeText(
              largest.map((l) => `${formatDate(l.date)}\t${l.vendor_name || '—'}\t${formatCurrency(l.amount)}`).join('\n'),
            )}
          >
            Copy
          </button>
        }
      >
        {largest.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-1">
            {largest.map((l, i) => (
              <div key={l.id} className="flex items-center gap-2 text-[11px]">
                <span className="w-5 text-text-muted font-mono">{i + 1}</span>
                <span className="flex-1 truncate text-text-secondary">{l.vendor_name || 'No vendor'}</span>
                <span className="text-text-muted truncate w-24">{l.category_name || '—'}</span>
                <span className="font-mono text-text-primary w-20 text-right">{formatCurrency(l.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 20. Vendor activity recency */}
      <Card title="Dormant Vendors (Oldest Activity)">
        {recency.length === 0 ? (
          <Empty label="No vendor-linked expenses." />
        ) : (
          <div className="space-y-1">
            {recency.map((r) => (
              <div key={r.vendor_id} className="flex items-center justify-between text-[11px]">
                <span className="text-text-secondary truncate flex-1">{r.name}</span>
                <span className="text-text-muted font-mono">{formatDate(r.last_date, { style: 'relative' })}</span>
                <span className="text-text-muted w-10 text-right font-mono">{r.cnt}×</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 22. Average days-to-pay per vendor */}
      <Card title="Average Days to Reimburse (by Vendor)">
        {daysToPay.length === 0 ? (
          <Empty label="No reimbursed expenses with dates yet." />
        ) : (
          <div className="space-y-1">
            {daysToPay.map((r) => (
              <div key={r.vendor_id} className="flex items-center justify-between text-[11px]">
                <span className="text-text-secondary truncate flex-1">{r.name}</span>
                <span className="font-mono" style={{ color: num(r.avg_days) > 30 ? colors.expense : colors.muted }}>
                  {Math.round(num(r.avg_days))} days
                </span>
                <span className="text-text-muted w-10 text-right font-mono">{r.paid_cnt}×</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
};

export default ExpensesUpgradesPart2;
