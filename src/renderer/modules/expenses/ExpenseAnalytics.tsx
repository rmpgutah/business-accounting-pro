// ExpenseAnalytics.tsx
// Reporting + analytics tab for expenses: 10 visualizations / stat tiles.
// Charts use recharts (already a dependency). Reads live data on mount.

import React, { useEffect, useMemo, useState } from 'react';
import {
  PieChart, Pie, Cell,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

const COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

interface Row { date: string; amount: number; category_id?: string; category_name?: string; vendor_name?: string; project_id?: string; }
interface CatRow { id: string; name: string; monthly_cap?: number; }
interface ProjRow { id: string; name: string; budget?: number; }

const ymKey = (d: string) => (d || '').slice(0, 7);
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  if (!y || !m) return ym;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};

const ExpenseAnalytics: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expenses, setExpenses] = useState<Row[]>([]);
  const [categories, setCategories] = useState<CatRow[]>([]);
  const [projects, setProjects] = useState<ProjRow[]>([]);
  const [revenueYtd, setRevenueYtd] = useState(0);
  const [taxCats, setTaxCats] = useState<any[]>([]);
  const [projBilled, setProjBilled] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const cid = activeCompany.id;
        const year = new Date().getFullYear();
        const [exps, cats, projs, rev, txCats, projInv] = await Promise.all([
          api.rawQuery(
            `SELECT e.date, e.amount, e.category_id, e.project_id,
                    c.name as category_name, v.name as vendor_name
             FROM expenses e
             LEFT JOIN categories c ON c.id = e.category_id
             LEFT JOIN vendors v ON v.id = e.vendor_id
             WHERE e.company_id = ?`,
            [cid]
          ),
          api.rawQuery(`SELECT id, name FROM categories WHERE company_id = ?`, [cid]),
          api.rawQuery(`SELECT id, name, COALESCE(budget,0) as budget FROM projects WHERE company_id = ?`, [cid]),
          api.rawQuery(
            `SELECT COALESCE(SUM(total),0) as rev FROM invoices
             WHERE company_id = ? AND strftime('%Y', issue_date) = ?`,
            [cid, String(year)]
          ),
          api.rawQuery(`SELECT id, name, is_deductible FROM tax_categories WHERE company_id = ?`, [cid]).catch(() => []),
          api.rawQuery(
            `SELECT ili.project_id as pid, COALESCE(SUM(ili.amount),0) as billed
             FROM invoice_line_items ili
             JOIN invoices i ON i.id = ili.invoice_id
             WHERE i.company_id = ? AND ili.project_id IS NOT NULL AND ili.project_id != ''
             GROUP BY ili.project_id`,
            [cid]
          ).catch(() => []),
        ]);
        if (cancelled) return;
        setExpenses(Array.isArray(exps) ? exps : []);
        // Try to fetch optional monthly_cap column on categories — gracefully ignore if missing
        try {
          const capRows = await api.rawQuery(`SELECT id, monthly_cap FROM categories WHERE company_id = ?`, [cid]);
          const capMap = new Map<string, number>();
          (Array.isArray(capRows) ? capRows : []).forEach((r: any) => capMap.set(r.id, Number(r.monthly_cap) || 0));
          const merged = (Array.isArray(cats) ? cats : []).map((c: any) => ({ ...c, monthly_cap: capMap.get(c.id) || 0 }));
          setCategories(merged);
        } catch {
          setCategories(Array.isArray(cats) ? cats : []);
        }
        setProjects(Array.isArray(projs) ? projs : []);
        const revRow = Array.isArray(rev) ? rev[0] : rev;
        setRevenueYtd(Number(revRow?.rev) || 0);
        setTaxCats(Array.isArray(txCats) ? txCats : []);
        const billedMap: Record<string, number> = {};
        (Array.isArray(projInv) ? projInv : []).forEach((r: any) => { billedMap[r.pid] = Number(r.billed) || 0; });
        setProjBilled(billedMap);
      } catch (err: any) {
        console.error('Analytics load failed:', err);
        if (!cancelled) setError(err?.message || 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ── Feature 1: by category ──
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    expenses.forEach((e) => {
      if (e.date < start) return;
      const k = e.category_name || 'Uncategorized';
      map.set(k, (map.get(k) || 0) + (Number(e.amount) || 0));
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [expenses]);

  // ── Feature 2: top vendors (top 10) ──
  const topVendors = useMemo(() => {
    const map = new Map<string, number>();
    expenses.forEach((e) => {
      const k = e.vendor_name || '(no vendor)';
      map.set(k, (map.get(k) || 0) + (Number(e.amount) || 0));
    });
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [expenses]);

  // ── Feature 3: trend over last 12 months ──
  const trend12 = useMemo(() => {
    const now = new Date();
    const months: { ym: string; label: string; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ ym, label: monthLabel(ym), total: 0 });
    }
    const idx = new Map(months.map((m, i) => [m.ym, i]));
    expenses.forEach((e) => {
      const i = idx.get(ymKey(e.date));
      if (i !== undefined) months[i].total += Number(e.amount) || 0;
    });
    return months;
  }, [expenses]);

  // ── Feature 4: YoY ──
  const yoy = useMemo(() => {
    const now = new Date();
    const thisYear = now.getFullYear();
    const months: any[] = [];
    for (let m = 0; m < 12; m++) {
      const label = new Date(thisYear, m, 1).toLocaleDateString(undefined, { month: 'short' });
      months.push({ month: label, thisYear: 0, lastYear: 0 });
    }
    expenses.forEach((e) => {
      const y = Number((e.date || '').slice(0, 4));
      const m = Number((e.date || '').slice(5, 7)) - 1;
      if (m < 0 || m > 11) return;
      if (y === thisYear) months[m].thisYear += Number(e.amount) || 0;
      else if (y === thisYear - 1) months[m].lastYear += Number(e.amount) || 0;
    });
    return months;
  }, [expenses]);

  // ── Feature 5: budget vs actual ──
  const budgetVsActual = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const totalsByCat = new Map<string, number>();
    expenses.forEach((e) => {
      if (e.date < start) return;
      if (!e.category_id) return;
      totalsByCat.set(e.category_id, (totalsByCat.get(e.category_id) || 0) + (Number(e.amount) || 0));
    });
    return categories
      .filter((c) => (c.monthly_cap || 0) > 0 || (totalsByCat.get(c.id) || 0) > 0)
      .map((c) => ({
        name: c.name,
        budget: Number(c.monthly_cap) || 0,
        actual: totalsByCat.get(c.id) || 0,
        over: (totalsByCat.get(c.id) || 0) > (Number(c.monthly_cap) || 0) && (Number(c.monthly_cap) || 0) > 0,
      }))
      .sort((a, b) => b.actual - a.actual)
      .slice(0, 12);
  }, [expenses, categories]);

  // ── Feature 6: heatmap by month (rows = last 12 months, cols = day-of-week) ──
  const heatmap = useMemo(() => {
    const now = new Date();
    const rows: { ym: string; label: string; cells: number[]; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      rows.push({ ym, label: monthLabel(ym), cells: [0, 0, 0, 0, 0, 0, 0], total: 0 });
    }
    const idx = new Map(rows.map((r, i) => [r.ym, i]));
    expenses.forEach((e) => {
      const i = idx.get(ymKey(e.date));
      if (i === undefined) return;
      const dow = new Date(e.date + 'T00:00:00').getDay();
      const amt = Number(e.amount) || 0;
      rows[i].cells[dow] += amt;
      rows[i].total += amt;
    });
    const max = Math.max(1, ...rows.flatMap((r) => r.cells));
    return { rows, max };
  }, [expenses]);

  // ── Feature 7: forecast (linear extrapolation of last 12 months) ──
  const forecast = useMemo(() => {
    const xs = trend12.map((_, i) => i);
    const ys = trend12.map((m) => m.total);
    const n = ys.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
    const sumX2 = xs.reduce((a, x) => a + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const out: any[] = trend12.map((m, i) => ({ label: m.label, actual: m.total, forecast: null }));
    const now = new Date();
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const idx = n - 1 + i;
      const proj = Math.max(0, intercept + slope * idx);
      out.push({ label: monthLabel(ym), actual: null, forecast: proj });
    }
    return out;
  }, [trend12]);

  // ── Feature 8: P&L impact ──
  const ytdExpenses = useMemo(() => {
    const yr = String(new Date().getFullYear());
    return expenses.filter((e) => (e.date || '').startsWith(yr)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  }, [expenses]);
  const pctOfRevenue = revenueYtd > 0 ? (ytdExpenses / revenueYtd) * 100 : null;

  // ── Feature 9: per-project profitability ──
  const projectProfit = useMemo(() => {
    const billableByProject = new Map<string, number>();
    expenses.forEach((e) => {
      if (!e.project_id) return;
      billableByProject.set(e.project_id, (billableByProject.get(e.project_id) || 0) + (Number(e.amount) || 0));
    });
    return projects.map((p) => {
      const exp = billableByProject.get(p.id) || 0;
      const billed = projBilled[p.id] || 0;
      return { name: p.name, expenses: exp, billed, variance: billed - exp };
    }).filter((r) => r.expenses > 0 || r.billed > 0).sort((a, b) => b.variance - a.variance);
  }, [expenses, projects, projBilled]);

  // ── Feature 10: tax-deductible totals ──
  const taxTotals = useMemo(() => {
    // tax_categories table is independent; we approximate using the category name match,
    // and otherwise treat all expenses as deductible by default.
    const yr = String(new Date().getFullYear());
    const ytdRows = expenses.filter((e) => (e.date || '').startsWith(yr));
    const deductibleNames = new Set(taxCats.filter((c: any) => c.is_deductible).map((c: any) => (c.name || '').toLowerCase()));
    const nonDeductibleNames = new Set(taxCats.filter((c: any) => !c.is_deductible).map((c: any) => (c.name || '').toLowerCase()));
    let deductible = 0;
    let nonDeductible = 0;
    ytdRows.forEach((e) => {
      const k = (e.category_name || '').toLowerCase();
      if (nonDeductibleNames.has(k)) nonDeductible += Number(e.amount) || 0;
      else if (deductibleNames.has(k) || taxCats.length === 0) deductible += Number(e.amount) || 0;
      else deductible += Number(e.amount) || 0;
    });
    return { deductible, nonDeductible };
  }, [expenses, taxCats]);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading analytics...</div>;
  }

  const card: React.CSSProperties = { padding: 16 };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load analytics" onDismiss={() => setError('')} />}

      {/* Stat tiles row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="block-card" style={card}>
          <div className="text-xs uppercase font-bold text-text-muted">Expenses YTD / Revenue YTD</div>
          <div className="text-2xl font-mono font-bold text-text-primary mt-1">
            {pctOfRevenue === null ? '—' : `${pctOfRevenue.toFixed(1)}%`}
          </div>
          <div className="text-xs text-text-muted mt-1">
            {formatCurrency(ytdExpenses)} of {formatCurrency(revenueYtd)}
          </div>
        </div>
        <div className="block-card" style={card}>
          <div className="text-xs uppercase font-bold text-text-muted">Deductible YTD</div>
          <div className="text-2xl font-mono font-bold text-accent-income mt-1">{formatCurrency(taxTotals.deductible)}</div>
          <div className="text-xs text-text-muted mt-1">Non-deductible: {formatCurrency(taxTotals.nonDeductible)}</div>
        </div>
        <div className="block-card" style={card}>
          <div className="text-xs uppercase font-bold text-text-muted">3-Month Forecast</div>
          <div className="text-2xl font-mono font-bold text-text-primary mt-1">
            {formatCurrency(forecast.filter((f: any) => f.forecast).reduce((s: number, f: any) => s + (f.forecast || 0), 0))}
          </div>
          <div className="text-xs text-text-muted mt-1">Linear projection from last 12 months</div>
        </div>
      </div>

      {/* Row: pie + top vendors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="block-card" style={card}>
          <h3 className="text-sm font-bold uppercase text-text-primary mb-2">Expense by Category (this month)</h3>
          {byCategory.length === 0 ? (
            <div className="text-text-muted text-sm py-12 text-center">No expenses this month</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={90} label={(d: any) => d.name}>
                  {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="block-card" style={card}>
          <h3 className="text-sm font-bold uppercase text-text-primary mb-2">Top 10 Vendors by Spend</h3>
          {topVendors.length === 0 ? (
            <div className="text-text-muted text-sm py-12 text-center">No vendor spend yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topVendors} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262a36" />
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                <Bar dataKey="total" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Row: trend + YoY */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="block-card" style={card}>
          <h3 className="text-sm font-bold uppercase text-text-primary mb-2">12-Month Trend</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262a36" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
              <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="block-card" style={card}>
          <h3 className="text-sm font-bold uppercase text-text-primary mb-2">Year-over-Year</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={yoy}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262a36" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
              <Legend />
              <Line type="monotone" dataKey="thisYear" stroke="#3b82f6" strokeWidth={2} dot={false} name="This Year" />
              <Line type="monotone" dataKey="lastYear" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Last Year" strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Budget vs actual */}
      <div className="block-card" style={card}>
        <h3 className="text-sm font-bold uppercase text-text-primary mb-2">Budget vs Actual (this month)</h3>
        {budgetVsActual.length === 0 ? (
          <div className="text-text-muted text-sm py-8 text-center">No budgeted categories yet — set monthly_cap on categories.</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={budgetVsActual}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262a36" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
              <Legend />
              <Bar dataKey="budget" fill="#6b7280" name="Budget" />
              <Bar dataKey="actual" name="Actual">
                {budgetVsActual.map((d, i) => (
                  <Cell key={i} fill={d.over ? '#ef4444' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Forecast */}
      <div className="block-card" style={card}>
        <h3 className="text-sm font-bold uppercase text-text-primary mb-2">Forecast (next 3 months)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={forecast}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262a36" />
            <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <Tooltip formatter={(v: any) => v == null ? '—' : formatCurrency(Number(v))} />
            <Legend />
            <Line type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={2} dot={false} name="Actual" />
            <Line type="monotone" dataKey="forecast" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} name="Forecast" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Heatmap */}
      <div className="block-card" style={card}>
        <h3 className="text-sm font-bold uppercase text-text-primary mb-2">Spend Heatmap (12 mo × day of week)</h3>
        <div className="overflow-x-auto">
          <table className="block-table" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th>Month</th>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <th key={d} className="text-center">{d}</th>)}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {heatmap.rows.map((r) => (
                <tr key={r.ym}>
                  <td className="text-text-secondary text-xs font-mono">{r.label}</td>
                  {r.cells.map((v, i) => {
                    const intensity = v / heatmap.max;
                    const bg = v === 0 ? 'transparent' : `rgba(59,130,246,${0.15 + intensity * 0.7})`;
                    return (
                      <td key={i} className="text-center text-xs font-mono" style={{ background: bg, color: intensity > 0.5 ? '#fff' : undefined }}>
                        {v > 0 ? formatCurrency(v).replace('.00', '') : '—'}
                      </td>
                    );
                  })}
                  <td className="text-right font-mono text-xs text-text-primary">{formatCurrency(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-project profitability */}
      <div className="block-card" style={card}>
        <h3 className="text-sm font-bold uppercase text-text-primary mb-2">Per-Project Profitability</h3>
        {projectProfit.length === 0 ? (
          <div className="text-text-muted text-sm py-8 text-center">No project-linked expenses or invoices yet.</div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Project</th>
                <th className="text-right">Billable Expenses</th>
                <th className="text-right">Billed Amount</th>
                <th className="text-right">Variance</th>
              </tr>
            </thead>
            <tbody>
              {projectProfit.map((p, i) => (
                <tr key={i}>
                  <td className="text-text-primary font-medium">{p.name}</td>
                  <td className="text-right font-mono text-accent-expense">{formatCurrency(p.expenses)}</td>
                  <td className="text-right font-mono text-accent-income">{formatCurrency(p.billed)}</td>
                  <td className="text-right font-mono" style={{ color: p.variance >= 0 ? '#22c55e' : '#ef4444' }}>
                    {formatCurrency(p.variance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ExpenseAnalytics;
