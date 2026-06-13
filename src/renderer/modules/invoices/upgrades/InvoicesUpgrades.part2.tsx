/**
 * InvoicesUpgradesPart2 — "Insights & Analytics" panel for the Invoices module.
 *
 * A single self-contained section that loads real invoice / payment / client /
 * project / user data through the api wrapper and renders ~25 small, working
 * analytics features as a vertical stack of `block-card`s. Every figure is
 * computed from live data scoped to the active company; nothing is hard-coded.
 *
 * No store dependencies beyond companyStore (for the active company id). All
 * heavy lifting is in-memory via useMemo so it re-renders cheaply.
 */

import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate, percentChange, humanizeLabel } from '../../../lib/format';

// ─── Row shapes (only the columns we read) ──────────────
interface InvoiceRow {
  id: string;
  client_id: string;
  status: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  discount_pct: number;
  total: number;
  amount_paid: number;
  invoice_type: string;
  sales_rep_id: string;
  is_recurring: number;
  portal_viewed_count: number;
}
interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: number;
  date: string;
  payment_method: string;
}
interface ClientRow { id: string; name: string }
interface ProjectRow { id: string; name: string }
interface UserRow { id: string; display_name: string }
interface LineItemRow { invoice_id: string; project_id: string | null; amount: number }

const DEAD_STATES = new Set(['cancelled', 'void']);
const DAY_MS = 86_400_000;

// Token palette for charts/legends — token-driven, no raw hex.
const SEGMENT_TOKENS = [
  'var(--color-accent-income)',
  'var(--color-accent-blue)',
  'var(--color-accent-warning)',
  'var(--color-accent-expense)',
  'var(--accent-primary)',
];

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function balanceOf(inv: InvoiceRow): number {
  return Math.max(0, num(inv.total) - num(inv.amount_paid));
}
function daysOverdue(inv: InvoiceRow): number {
  if (!inv.due_date) return 0;
  const due = new Date(inv.due_date + 'T00:00:00').getTime();
  if (!Number.isFinite(due)) return 0;
  return Math.floor((Date.now() - due) / DAY_MS);
}
function monthKey(iso: string | null | undefined): string {
  if (!iso || iso.length < 7) return '';
  return iso.slice(0, 7); // YYYY-MM
}
function isOpen(inv: InvoiceRow): boolean {
  return !DEAD_STATES.has(inv.status) && inv.status !== 'paid' && balanceOf(inv) > 0.005;
}

// ─── Tiny presentational helpers ────────────────────────
function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: tone || 'var(--color-text-primary)' }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{sub}</span>}
    </div>
  );
}

function CardShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="block-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 8, background: 'var(--color-bg-tertiary)', borderRadius: 'var(--app-radius)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color }} />
    </div>
  );
}

// ─── localStorage helpers (snapshot trend) ──────────────
interface AgingSnapshot { month: string; over90: number }
function snapshotKey(companyId: string) { return `bap-iv-aging-trend-${companyId}`; }
function loadSnapshots(companyId: string): AgingSnapshot[] {
  try {
    const raw = localStorage.getItem(snapshotKey(companyId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => s && typeof s.month === 'string') : [];
  } catch { return []; }
}
function saveSnapshot(companyId: string, snap: AgingSnapshot): AgingSnapshot[] {
  const existing = loadSnapshots(companyId).filter((s) => s.month !== snap.month);
  const next = [...existing, snap].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  try { localStorage.setItem(snapshotKey(companyId), JSON.stringify(next)); } catch { /* ignore quota */ }
  return next;
}

// CSV export via Blob+anchor.
function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
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

// Period window options (days). Persisted to localStorage.
const WINDOW_OPTIONS = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '12 months', days: 365 },
];

export default function InvoicesUpgradesPart2() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id ?? '';

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [windowDays, setWindowDays] = useState<number>(() => {
    const stored = Number(typeof localStorage !== 'undefined' ? localStorage.getItem('bap-iv-insights-window') : '');
    return WINDOW_OPTIONS.some((o) => o.days === stored) ? stored : 90;
  });
  const [trend, setTrend] = useState<AgingSnapshot[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [inv, pay, cli, prj, usr, li] = await Promise.all([
          api.query('invoices', { company_id: companyId }, { field: 'issue_date', dir: 'desc' }, 5000),
          api.query('payments', { company_id: companyId }, { field: 'date', dir: 'desc' }, 5000),
          api.query('clients', { company_id: companyId }),
          api.query('projects', { company_id: companyId }),
          api.query('users'),
          api.rawQuery(
            `SELECT li.invoice_id AS invoice_id, li.project_id AS project_id, li.amount AS amount
               FROM invoice_line_items li
               JOIN invoices i ON i.id = li.invoice_id
              WHERE i.company_id = ?`,
            [companyId]
          ),
        ]);
        if (cancelled) return;
        setInvoices(Array.isArray(inv) ? (inv as InvoiceRow[]) : []);
        setPayments(Array.isArray(pay) ? (pay as PaymentRow[]) : []);
        setClients(Array.isArray(cli) ? (cli as ClientRow[]) : []);
        setProjects(Array.isArray(prj) ? (prj as ProjectRow[]) : []);
        setUsers(Array.isArray(usr) ? (usr as UserRow[]) : []);
        setLineItems(Array.isArray(li) ? (li as LineItemRow[]) : []);
        setTrend(loadSnapshots(companyId));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const clientName = useMemo(() => {
    const m = new Map<string, string>();
    clients.forEach((c) => m.set(c.id, c.name || '(no client)'));
    return (id: string) => m.get(id) || '(no client)';
  }, [clients]);

  const userName = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.display_name || '(unknown)'));
    return (id: string) => (id ? m.get(id) || '(unassigned)' : '(unassigned)');
  }, [users]);

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    projects.forEach((p) => m.set(p.id, p.name || '(no project)'));
    return (id: string) => m.get(id) || '(no project)';
  }, [projects]);

  // Period-scoped invoices (by issue_date within windowDays).
  const periodCutoff = useMemo(() => Date.now() - windowDays * DAY_MS, [windowDays]);
  const periodInvoices = useMemo(
    () => invoices.filter((i) => {
      const t = new Date((i.issue_date || '') + 'T00:00:00').getTime();
      return Number.isFinite(t) && t >= periodCutoff && !DEAD_STATES.has(i.status);
    }),
    [invoices, periodCutoff]
  );

  // ── 1. Outstanding balance ──
  const outstanding = useMemo(
    () => invoices.filter(isOpen).reduce((s, i) => s + balanceOf(i), 0),
    [invoices]
  );

  // ── 2. Overdue total + count ──
  const overdue = useMemo(() => {
    const list = invoices.filter((i) => isOpen(i) && daysOverdue(i) > 0);
    return { count: list.length, total: list.reduce((s, i) => s + balanceOf(i), 0) };
  }, [invoices]);

  // ── 3. DSO ──
  const dso = useMemo(() => {
    const arBalance = invoices.filter(isOpen).reduce((s, i) => s + balanceOf(i), 0);
    const billed = periodInvoices.reduce((s, i) => s + num(i.total), 0);
    if (billed <= 0) return null;
    return (arBalance / billed) * windowDays;
  }, [invoices, periodInvoices, windowDays]);

  // ── 4. Average days-to-pay (paid invoices vs their payments) ──
  const avgDaysToPay = useMemo(() => {
    const payByInvoice = new Map<string, PaymentRow[]>();
    payments.forEach((p) => {
      const arr = payByInvoice.get(p.invoice_id) || [];
      arr.push(p);
      payByInvoice.set(p.invoice_id, arr);
    });
    const gaps: number[] = [];
    invoices.forEach((inv) => {
      if (inv.status !== 'paid') return;
      const ps = payByInvoice.get(inv.id);
      if (!ps || ps.length === 0 || !inv.issue_date) return;
      const last = ps.reduce((a, b) => (a.date > b.date ? a : b));
      const issued = new Date(inv.issue_date + 'T00:00:00').getTime();
      const paidT = new Date(last.date + 'T00:00:00').getTime();
      if (Number.isFinite(issued) && Number.isFinite(paidT) && paidT >= issued) {
        gaps.push((paidT - issued) / DAY_MS);
      }
    });
    if (gaps.length === 0) return null;
    return { mean: gaps.reduce((s, g) => s + g, 0) / gaps.length, sample: gaps.length };
  }, [invoices, payments]);

  // ── 5. Collection rate ──
  const collectionRate = useMemo(() => {
    const billed = periodInvoices.reduce((s, i) => s + num(i.total), 0);
    const paid = periodInvoices.reduce((s, i) => s + num(i.amount_paid), 0);
    if (billed <= 0) return null;
    return (paid / billed) * 100;
  }, [periodInvoices]);

  // ── 6. Aging buckets ──
  const aging = useMemo(() => {
    const b = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 };
    invoices.filter(isOpen).forEach((i) => {
      const bal = balanceOf(i);
      const d = daysOverdue(i);
      if (d <= 0) b.current += bal;
      else if (d <= 30) b.b1_30 += bal;
      else if (d <= 60) b.b31_60 += bal;
      else if (d <= 90) b.b61_90 += bal;
      else b.b90plus += bal;
    });
    const total = b.current + b.b1_30 + b.b31_60 + b.b61_90 + b.b90plus;
    return { ...b, total };
  }, [invoices]);

  // ── 7. Monthly billed vs collected (last 6 months) ──
  const monthly = useMemo(() => {
    const billedByMonth = new Map<string, number>();
    invoices.forEach((i) => {
      if (DEAD_STATES.has(i.status)) return;
      const k = monthKey(i.issue_date);
      if (k) billedByMonth.set(k, (billedByMonth.get(k) || 0) + num(i.total));
    });
    const collectedByMonth = new Map<string, number>();
    payments.forEach((p) => {
      const k = monthKey(p.date);
      if (k) collectedByMonth.set(k, (collectedByMonth.get(k) || 0) + num(p.amount));
    });
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months.map((m) => ({
      month: m,
      billed: billedByMonth.get(m) || 0,
      collected: collectedByMonth.get(m) || 0,
    }));
  }, [invoices, payments]);

  // ── 8. Top clients by revenue ──
  const topClients = useMemo(() => {
    const m = new Map<string, number>();
    periodInvoices.forEach((i) => m.set(i.client_id, (m.get(i.client_id) || 0) + num(i.total)));
    return [...m.entries()]
      .map(([id, total]) => ({ id, name: clientName(id), total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [periodInvoices, clientName]);

  // ── 9. Top overdue clients ──
  const topOverdueClients = useMemo(() => {
    const m = new Map<string, { bal: number; maxDays: number }>();
    invoices.filter((i) => isOpen(i) && daysOverdue(i) > 0).forEach((i) => {
      const cur = m.get(i.client_id) || { bal: 0, maxDays: 0 };
      cur.bal += balanceOf(i);
      cur.maxDays = Math.max(cur.maxDays, daysOverdue(i));
      m.set(i.client_id, cur);
    });
    return [...m.entries()]
      .map(([id, v]) => ({ id, name: clientName(id), bal: v.bal, maxDays: v.maxDays }))
      .sort((a, b) => b.bal - a.bal)
      .slice(0, 5);
  }, [invoices, clientName]);

  // ── 10. Revenue by invoice type ──
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    periodInvoices.forEach((i) => {
      const t = i.invoice_type || 'standard';
      m.set(t, (m.get(t) || 0) + num(i.total));
    });
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    return { rows: [...m.entries()].map(([type, val]) => ({ type, val })).sort((a, b) => b.val - a.val), total };
  }, [periodInvoices]);

  // ── 11. Revenue by sales rep ──
  const byRep = useMemo(() => {
    const m = new Map<string, number>();
    periodInvoices.forEach((i) => m.set(i.sales_rep_id || '', (m.get(i.sales_rep_id || '') || 0) + num(i.total)));
    return [...m.entries()]
      .map(([id, val]) => ({ name: userName(id), val }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 5);
  }, [periodInvoices, userName]);

  // ── 12. Revenue by project ──
  const byProject = useMemo(() => {
    const m = new Map<string, number>();
    lineItems.forEach((li) => {
      if (!li.project_id) return;
      m.set(li.project_id, (m.get(li.project_id) || 0) + num(li.amount));
    });
    return [...m.entries()]
      .map(([id, val]) => ({ name: projectName(id), val }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 5);
  }, [lineItems, projectName]);

  // ── 13. Month-over-month revenue delta ──
  const momDelta = useMemo(() => {
    const now = new Date();
    const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    let cur = 0, pre = 0;
    invoices.forEach((i) => {
      if (DEAD_STATES.has(i.status)) return;
      const k = monthKey(i.issue_date);
      if (k === thisKey) cur += num(i.total);
      else if (k === prevKey) pre += num(i.total);
    });
    return { cur, pre, pct: percentChange(cur, pre) };
  }, [invoices]);

  // ── 14. Forecasted collections (next 4 weeks by due_date) ──
  const forecast = useMemo(() => {
    const weeks = [0, 0, 0, 0];
    const now = Date.now();
    invoices.forEach((i) => {
      if (!(i.status === 'sent' || i.status === 'partial')) return;
      const bal = balanceOf(i);
      if (bal <= 0 || !i.due_date) return;
      const due = new Date(i.due_date + 'T00:00:00').getTime();
      if (!Number.isFinite(due)) return;
      const diffDays = Math.floor((due - now) / DAY_MS);
      if (diffDays < 0) { weeks[0] += bal; return; } // already due -> this week bucket
      const w = Math.floor(diffDays / 7);
      if (w < 4) weeks[w] += bal;
    });
    return weeks;
  }, [invoices]);

  // ── 15. Draft pipeline value ──
  const draftPipeline = useMemo(() => {
    const drafts = invoices.filter((i) => i.status === 'draft');
    return { count: drafts.length, total: drafts.reduce((s, i) => s + num(i.total), 0) };
  }, [invoices]);

  // ── 16. Average invoice value + monthly sparkline ──
  const avgInvoice = useMemo(() => {
    const vals = periodInvoices.map((i) => num(i.total));
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { mean, count: vals.length, spark: monthly.map((m) => m.billed) };
  }, [periodInvoices, monthly]);

  // ── 17. Largest open invoices ──
  const largestOpen = useMemo(() => {
    return invoices
      .filter(isOpen)
      .map((i) => ({ id: i.id, name: clientName(i.client_id), bal: balanceOf(i), days: daysOverdue(i) }))
      .sort((a, b) => b.bal - a.bal)
      .slice(0, 10);
  }, [invoices, clientName]);

  // ── 18. Payment-method mix ──
  const methodMix = useMemo(() => {
    const m = new Map<string, number>();
    payments.forEach((p) => {
      const k = p.payment_method || 'unspecified';
      m.set(k, (m.get(k) || 0) + num(p.amount));
    });
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    return { rows: [...m.entries()].map(([method, val]) => ({ method, val })).sort((a, b) => b.val - a.val), total };
  }, [payments]);

  // ── 19. Discount given total ──
  const discountGiven = useMemo(() => {
    return periodInvoices.reduce((s, i) => {
      let d = num(i.discount_amount);
      if (d === 0 && num(i.discount_pct) > 0) d = num(i.subtotal) * (num(i.discount_pct) / 100);
      return s + d;
    }, 0);
  }, [periodInvoices]);

  // ── 20. Tax collected ──
  const taxCollected = useMemo(
    () => periodInvoices.filter((i) => i.status === 'paid' || i.status === 'sent' || i.status === 'partial')
      .reduce((s, i) => s + num(i.tax_amount), 0),
    [periodInvoices]
  );

  // ── 21. Recurring revenue (MRR-style) ──
  const mrr = useMemo(
    () => invoices.filter((i) => num(i.is_recurring) === 1 && !DEAD_STATES.has(i.status))
      .reduce((s, i) => s + num(i.total), 0),
    [invoices]
  );

  // ── 22. Client payment-reliability score (on-time ratio) ──
  const reliability = useMemo(() => {
    const payByInvoice = new Map<string, string>(); // invoice_id -> last payment date
    payments.forEach((p) => {
      const cur = payByInvoice.get(p.invoice_id);
      if (!cur || p.date > cur) payByInvoice.set(p.invoice_id, p.date);
    });
    const perClient = new Map<string, { onTime: number; total: number }>();
    invoices.forEach((inv) => {
      if (inv.status !== 'paid') return;
      const payDate = payByInvoice.get(inv.id);
      if (!payDate || !inv.due_date) return;
      const c = perClient.get(inv.client_id) || { onTime: 0, total: 0 };
      c.total += 1;
      if (payDate <= inv.due_date) c.onTime += 1;
      perClient.set(inv.client_id, c);
    });
    return [...perClient.entries()]
      .filter(([, v]) => v.total >= 1)
      .map(([id, v]) => ({ id, name: clientName(id), ratio: v.onTime / v.total, total: v.total }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 6);
  }, [invoices, payments, clientName]);

  // ── 23. Portal-engagement (viewed but unpaid) ──
  const viewedNotPaid = useMemo(() => {
    return invoices
      .filter((i) => num(i.portal_viewed_count) > 0 && isOpen(i))
      .map((i) => ({ id: i.id, name: clientName(i.client_id), views: num(i.portal_viewed_count), bal: balanceOf(i) }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 8);
  }, [invoices, clientName]);

  // ── 24. Aging trend snapshot (persisted) ──
  const recordSnapshot = () => {
    if (!companyId) return;
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setTrend(saveSnapshot(companyId, { month: m, over90: Math.round(aging.b90plus) }));
  };

  // ── 25. Health header strip values ──
  const health = useMemo(() => ({
    outstanding,
    overdue: overdue.total,
    drafts: draftPipeline.total,
    collectionRate,
  }), [outstanding, overdue.total, draftPipeline.total, collectionRate]);

  const copyHealth = async () => {
    const text = [
      `Outstanding: ${formatCurrency(health.outstanding)}`,
      `Overdue: ${formatCurrency(health.overdue)} (${overdue.count})`,
      `Drafts: ${formatCurrency(health.drafts)} (${draftPipeline.count})`,
      `Collection rate: ${health.collectionRate == null ? 'n/a' : health.collectionRate.toFixed(1) + '%'}`,
    ].join('  •  ');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  // ─── Render guards ───
  if (!companyId) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Insights &amp; Analytics</h2>
        <div className="block-card" style={{ padding: 16, color: 'var(--color-text-secondary)' }}>
          Select a company to view invoice analytics.
        </div>
      </section>
    );
  }
  if (loading) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Insights &amp; Analytics</h2>
        <div className="block-card" style={{ padding: 16, color: 'var(--color-text-muted)' }}>Loading analytics…</div>
      </section>
    );
  }
  if (error) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Insights &amp; Analytics</h2>
        <div className="block-card" style={{ padding: 16, color: 'var(--color-accent-expense)' }}>{error}</div>
      </section>
    );
  }
  if (invoices.length === 0) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Insights &amp; Analytics</h2>
        <div className="block-card" style={{ padding: 16, color: 'var(--color-text-secondary)' }}>
          No invoices yet — analytics will populate as you create and send invoices.
        </div>
      </section>
    );
  }

  const maxMonthly = Math.max(1, ...monthly.map((m) => Math.max(m.billed, m.collected)));
  const maxSpark = Math.max(1, ...avgInvoice.spark);
  const maxTrend = Math.max(1, ...trend.map((t) => t.over90));

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Heading + window selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Insights &amp; Analytics</h2>
        <select
          className="block-select"
          value={windowDays}
          onChange={(e) => {
            const v = Number(e.target.value);
            setWindowDays(v);
            try { localStorage.setItem('bap-iv-insights-window', String(v)); } catch { /* ignore */ }
          }}
          style={{ maxWidth: 160 }}
        >
          {WINDOW_OPTIONS.map((o) => <option key={o.days} value={o.days}>Period: {o.label}</option>)}
        </select>
      </div>

      {/* 25. At-a-glance health strip */}
      <div className="block-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <StatTile label="Outstanding" value={formatCurrency(health.outstanding)} />
        <StatTile label="Overdue" value={formatCurrency(health.overdue)} sub={`${overdue.count} invoice${overdue.count === 1 ? '' : 's'}`} tone="var(--color-accent-expense)" />
        <StatTile label="Drafts" value={formatCurrency(health.drafts)} sub={`${draftPipeline.count} unsent`} />
        <StatTile label="Collection rate" value={health.collectionRate == null ? '—' : `${health.collectionRate.toFixed(1)}%`} tone="var(--color-accent-income)" />
        <button type="button" className="block-btn" style={{ marginLeft: 'auto' }} onClick={copyHealth}>
          {copied ? 'Copied!' : 'Copy summary'}
        </button>
      </div>

      {/* KPI row: 1,2,3,5 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile label="Outstanding balance" value={formatCurrency(outstanding)} sub="Across all open invoices" />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile label="Overdue" value={formatCurrency(overdue.total)} sub={`${overdue.count} past due`} tone="var(--color-accent-expense)" />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile label="DSO" value={dso == null ? '—' : `${Math.round(dso)} days`} sub={`${windowDays}-day window`} />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile
            label="Collection rate"
            value={collectionRate == null ? '—' : `${collectionRate.toFixed(1)}%`}
            sub="Paid ÷ billed, period"
            tone="var(--color-accent-income)"
          />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile
            label="Avg days to pay"
            value={avgDaysToPay == null ? '—' : `${Math.round(avgDaysToPay.mean)} days`}
            sub={avgDaysToPay ? `${avgDaysToPay.sample} paid invoices` : 'No paid history'}
          />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile label="Draft pipeline" value={formatCurrency(draftPipeline.total)} sub={`${draftPipeline.count} draft${draftPipeline.count === 1 ? '' : 's'}`} />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile label="Avg invoice value" value={formatCurrency(avgInvoice.mean)} sub={`${avgInvoice.count} in period`} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 24, marginTop: 8 }}>
            {avgInvoice.spark.map((v, i) => (
              <div key={i} title={formatCurrency(v)} style={{ flex: 1, height: `${(v / maxSpark) * 100}%`, minHeight: 2, background: 'var(--accent-primary)', borderRadius: 2 }} />
            ))}
          </div>
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile
            label="MoM revenue"
            value={momDelta.pct == null ? '—' : `${momDelta.pct >= 0 ? '▲' : '▼'} ${Math.abs(momDelta.pct).toFixed(0)}%`}
            sub={`${formatCurrency(momDelta.cur)} this month`}
            tone={momDelta.pct == null ? undefined : momDelta.pct >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)'}
          />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile label="Recurring (MRR-style)" value={formatCurrency(mrr)} sub="Flagged recurring invoices" />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile label="Discounts given" value={formatCurrency(discountGiven)} sub="Concessions in period" tone="var(--color-accent-warning)" />
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <StatTile label="Tax collected" value={formatCurrency(taxCollected)} sub="Sent/partial/paid, period" />
        </div>
      </div>

      {/* 6. Aging summary bar */}
      <CardShell
        title="AR aging summary"
        action={
          <button
            type="button"
            className="block-btn"
            onClick={() => downloadCsv('ar-aging.csv', [
              { bucket: 'Current', amount: aging.current.toFixed(2) },
              { bucket: '1-30', amount: aging.b1_30.toFixed(2) },
              { bucket: '31-60', amount: aging.b31_60.toFixed(2) },
              { bucket: '61-90', amount: aging.b61_90.toFixed(2) },
              { bucket: '90+', amount: aging.b90plus.toFixed(2) },
            ])}
          >
            Export CSV
          </button>
        }
      >
        {aging.total <= 0 ? (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No outstanding balances.</span>
        ) : (
          <>
            <div style={{ display: 'flex', height: 14, borderRadius: 'var(--app-radius)', overflow: 'hidden' }}>
              {[
                { v: aging.current, c: 'var(--color-accent-income)', l: 'Current' },
                { v: aging.b1_30, c: 'var(--color-accent-warning)', l: '1-30' },
                { v: aging.b31_60, c: 'var(--color-accent-blue)', l: '31-60' },
                { v: aging.b61_90, c: 'var(--color-accent-expense)', l: '61-90' },
                { v: aging.b90plus, c: 'var(--accent-primary)', l: '90+' },
              ].filter((s) => s.v > 0).map((s, i) => (
                <div key={i} title={`${s.l}: ${formatCurrency(s.v)}`} style={{ width: `${(s.v / aging.total) * 100}%`, background: s.c }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-text-secondary)' }}>
              <span>Current {formatCurrency(aging.current)}</span>
              <span>1-30 {formatCurrency(aging.b1_30)}</span>
              <span>31-60 {formatCurrency(aging.b31_60)}</span>
              <span>61-90 {formatCurrency(aging.b61_90)}</span>
              <span>90+ {formatCurrency(aging.b90plus)}</span>
            </div>
          </>
        )}
      </CardShell>

      {/* 7. Monthly billed vs collected */}
      <CardShell title="Billed vs collected (6 months)">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 120 }}>
          {monthly.map((m) => (
            <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 3, width: '100%', justifyContent: 'center' }}>
                <div title={`Billed ${formatCurrency(m.billed)}`} style={{ width: 12, height: `${(m.billed / maxMonthly) * 100}%`, minHeight: 2, background: 'var(--color-accent-blue)', borderRadius: 2 }} />
                <div title={`Collected ${formatCurrency(m.collected)}`} style={{ width: 12, height: `${(m.collected / maxMonthly) * 100}%`, minHeight: 2, background: 'var(--color-accent-income)', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{m.month.slice(5)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--color-text-secondary)' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-accent-blue)', marginRight: 4 }} />Billed</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-accent-income)', marginRight: 4 }} />Collected</span>
        </div>
      </CardShell>

      {/* 8 + 9: top clients / top overdue side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <CardShell title="Top clients by revenue">
          {topClients.length === 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No revenue in period.</span> : topClients.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              <Bar pct={(c.total / (topClients[0]?.total || 1)) * 100} color="var(--color-accent-income)" />
              <span style={{ width: 90, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatCurrency(c.total)}</span>
            </div>
          ))}
        </CardShell>
        <CardShell title="Top overdue clients">
          {topOverdueClients.length === 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Nothing overdue. 🎉</span> : topOverdueClients.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              <Bar pct={(c.bal / (topOverdueClients[0]?.bal || 1)) * 100} color="var(--color-accent-expense)" />
              <span style={{ width: 110, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatCurrency(c.bal)} · {c.maxDays}d</span>
            </div>
          ))}
        </CardShell>
      </div>

      {/* 10. Revenue by invoice type (segments + legend) */}
      <CardShell title="Revenue by invoice type">
        {byType.total <= 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No revenue in period.</span> : (
          <>
            <div style={{ display: 'flex', height: 14, borderRadius: 'var(--app-radius)', overflow: 'hidden' }}>
              {byType.rows.map((r, i) => (
                <div key={r.type} title={`${r.type}: ${formatCurrency(r.val)}`} style={{ width: `${(r.val / byType.total) * 100}%`, background: SEGMENT_TOKENS[i % SEGMENT_TOKENS.length] }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {byType.rows.map((r, i) => (
                <span key={r.type} style={{ textTransform: 'capitalize' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: SEGMENT_TOKENS[i % SEGMENT_TOKENS.length], marginRight: 4 }} />
                  {humanizeLabel(r.type)} {formatCurrency(r.val)}
                </span>
              ))}
            </div>
          </>
        )}
      </CardShell>

      {/* 11 + 12: rep / project breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <CardShell title="Revenue by sales rep">
          {byRep.length === 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No data.</span> : byRep.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <Bar pct={(r.val / (byRep[0]?.val || 1)) * 100} color="var(--accent-primary)" />
              <span style={{ width: 90, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatCurrency(r.val)}</span>
            </div>
          ))}
        </CardShell>
        <CardShell title="Revenue by project">
          {byProject.length === 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No project-tagged line items.</span> : byProject.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <Bar pct={(p.val / (byProject[0]?.val || 1)) * 100} color="var(--color-accent-blue)" />
              <span style={{ width: 90, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatCurrency(p.val)}</span>
            </div>
          ))}
        </CardShell>
      </div>

      {/* 14. Forecasted collections */}
      <CardShell title="Forecasted collections (next 4 weeks)">
        <div style={{ display: 'flex', gap: 12 }}>
          {forecast.map((amt, i) => (
            <div key={i} className="block-card" style={{ flex: 1, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Week {i + 1}</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{formatCurrency(amt)}</div>
            </div>
          ))}
        </div>
      </CardShell>

      {/* 17. Largest open invoices */}
      <CardShell
        title="Largest open invoices"
        action={
          <button
            type="button"
            className="block-btn"
            onClick={() => downloadCsv('largest-open-invoices.csv', largestOpen.map((r) => ({
              client: r.name, balance: r.bal.toFixed(2), days_overdue: r.days > 0 ? r.days : 0,
            })))}
          >
            Export CSV
          </button>
        }
      >
        <table className="block-table">
          <thead>
            <tr><th>Client</th><th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'right' }}>Status</th></tr>
          </thead>
          <tbody>
            {largestOpen.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(r.bal)}</td>
                <td style={{ textAlign: 'right', color: r.days > 0 ? 'var(--color-accent-expense)' : 'var(--color-text-muted)' }}>
                  {r.days > 0 ? `${r.days}d overdue` : 'On time'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardShell>

      {/* 18. Payment-method mix */}
      <CardShell title="Payment-method mix">
        {methodMix.total <= 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No payments recorded.</span> : methodMix.rows.map((r) => (
          <div key={r.method} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 110 }}>{humanizeLabel(r.method)}</span>
            <Bar pct={(r.val / methodMix.total) * 100} color="var(--color-accent-blue)" />
            <span style={{ width: 110, textAlign: 'right', color: 'var(--color-text-secondary)' }}>
              {formatCurrency(r.val)} ({((r.val / methodMix.total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </CardShell>

      {/* 22. Client payment-reliability */}
      <CardShell title="Client payment reliability">
        {reliability.length === 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No paid-invoice history yet.</span> : reliability.map((c) => {
          const band = c.ratio >= 0.85 ? { l: 'Good', cls: 'block-badge-income' } : c.ratio >= 0.5 ? { l: 'Fair', cls: 'block-badge-warning' } : { l: 'Risk', cls: 'block-badge-expense' };
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              <Bar pct={c.ratio * 100} color="var(--color-accent-income)" />
              <span style={{ width: 50, textAlign: 'right' }}>{(c.ratio * 100).toFixed(0)}%</span>
              <span className={`block-badge ${band.cls}`}>{band.l}</span>
            </div>
          );
        })}
      </CardShell>

      {/* 23. Portal engagement (viewed not paid) */}
      <CardShell title="Viewed but unpaid (high-intent follow-ups)">
        {viewedNotPaid.length === 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No viewed-yet-unpaid invoices.</span> : (
          <table className="block-table">
            <thead><tr><th>Client</th><th style={{ textAlign: 'right' }}>Views</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
            <tbody>
              {viewedNotPaid.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td style={{ textAlign: 'right' }}>{r.views}×</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.bal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>

      {/* 24. Aging trend (snapshots) */}
      <CardShell
        title="90+ aging trend"
        action={<button type="button" className="block-btn" onClick={recordSnapshot}>Snapshot this month</button>}
      >
        {trend.length === 0 ? (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
            No snapshots yet. Current 90+ balance: {formatCurrency(aging.b90plus)}. Click "Snapshot this month" to start tracking.
          </span>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
              {trend.map((t) => (
                <div key={t.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
                  <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                    <div title={formatCurrency(t.over90)} style={{ width: '100%', height: `${(t.over90 / maxTrend) * 100}%`, minHeight: 2, background: 'var(--color-accent-expense)', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{t.month.slice(2)}</span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              Latest snapshot: {formatDate((trend[trend.length - 1]?.month || '') + '-01')} · {formatCurrency(trend[trend.length - 1]?.over90 || 0)}
            </span>
          </>
        )}
      </CardShell>
    </section>
  );
}
