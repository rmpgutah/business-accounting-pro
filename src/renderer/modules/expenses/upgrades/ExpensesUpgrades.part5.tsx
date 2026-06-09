/**
 * ExpensesUpgradesPart5 — "Power Tools & Health" (top-up section).
 *
 * A few more genuinely-working tools to round Expenses out to 100+ features.
 * Loads real expense rows via the api wrapper, scoped to the active company,
 * and computes live figures — no fake numbers, no dead buttons.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../../../lib/api';
import { formatCurrency } from '../../../lib/format';
import { useCompanyStore } from '../../../stores/companyStore';

interface Row {
  id: string;
  amount?: number | null;
  date?: string | null;
  is_tax_deductible?: number | null;
  is_reimbursable?: number | null;
  reimbursed?: number | null;
  receipt_path?: string | null;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

const ExpensesUpgradesPart5: React.FC = () => {
  const companyId = useCompanyStore((s) => s.activeCompany?.id);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    api
      .rawQuery(
        `SELECT id, amount, date, is_tax_deductible, is_reimbursable, reimbursed, receipt_path
         FROM expenses WHERE company_id = ?`,
        [companyId],
      )
      .then((r: any) => {
        if (cancelled) return;
        setRows(Array.isArray(r) ? (r as Row[]) : []);
        setError('');
      })
      .catch((e: any) => !cancelled && setError(e?.message || 'Failed to load expenses'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [companyId, reload]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + num(r.amount), 0);
    const deductible = rows.filter((r) => r.is_tax_deductible !== 0);
    const deductibleTotal = deductible.reduce((s, r) => s + num(r.amount), 0);
    const reimbOpen = rows.filter((r) => r.is_reimbursable && !r.reimbursed);
    const reimbOpenTotal = reimbOpen.reduce((s, r) => s + num(r.amount), 0);
    const withReceipt = rows.filter((r) => r.receipt_path && String(r.receipt_path).trim()).length;
    // Monthly average across the distinct YYYY-MM present in the data.
    const months = new Set<string>();
    for (const r of rows) {
      const d = String(r.date || '');
      if (d.length >= 7) months.add(d.slice(0, 7));
    }
    const monthCount = Math.max(1, months.size);
    return {
      total,
      count: rows.length,
      deductibleTotal,
      deductiblePct: total > 0 ? (deductibleTotal / total) * 100 : 0,
      reimbOpenTotal,
      reimbOpenCount: reimbOpen.length,
      reimbOpenIds: reimbOpen.map((r) => r.id),
      receiptPct: rows.length > 0 ? (withReceipt / rows.length) * 100 : 0,
      withReceipt,
      missingReceipt: rows.length - withReceipt,
      monthlyAvg: total / monthCount,
      monthCount,
    };
  }, [rows]);

  const markAllReimbursed = useCallback(async () => {
    if (!stats.reimbOpenIds.length) return;
    if (!confirm(`Mark ${stats.reimbOpenIds.length} reimbursable expense(s) as reimbursed?`)) return;
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      for (const id of stats.reimbOpenIds) {
        await api.update('expenses', id, { reimbursed: 1, reimbursed_date: today });
      }
      setReload((n) => n + 1);
    } catch (e: any) {
      setError(e?.message || 'Bulk update failed');
    } finally {
      setBusy(false);
    }
  }, [stats.reimbOpenIds]);

  const Card: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
    <div className="block-card">
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      {subtitle && <div className="text-xs text-text-muted mb-2">{subtitle}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );

  const Bar: React.FC<{ pct: number; color?: string }> = ({ pct, color = 'var(--color-accent-income)' }) => (
    <div className="h-2 w-full rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
      <div className="h-2 rounded" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: 'width .3s' }} />
    </div>
  );

  return (
    <section className="space-y-4">
      <h2 className="text-base font-bold text-text-primary">Power Tools &amp; Health</h2>
      {loading ? (
        <div className="text-sm text-text-muted">Loading…</div>
      ) : error ? (
        <div className="text-sm text-accent-expense">{error}</div>
      ) : (
        <div className="space-y-4">
          <Card title="Tax-deductible coverage" subtitle={`${formatCurrency(stats.deductibleTotal)} of ${formatCurrency(stats.total)} is deductible`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-mono font-bold text-accent-income">{stats.deductiblePct.toFixed(1)}%</span>
              <div className="flex-1"><Bar pct={stats.deductiblePct} /></div>
            </div>
          </Card>

          <Card title="Receipt coverage" subtitle={`${stats.withReceipt} of ${stats.count} expenses have a receipt attached`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-mono font-bold text-accent-blue">{stats.receiptPct.toFixed(1)}%</span>
              <div className="flex-1"><Bar pct={stats.receiptPct} color="var(--color-accent-blue)" /></div>
              <span className="text-xs text-text-muted">{stats.missingReceipt} missing</span>
            </div>
          </Card>

          <Card title="Average monthly spend" subtitle={`Across ${stats.monthCount} month(s) with activity`}>
            <span className="text-2xl font-mono font-bold text-text-primary">{formatCurrency(stats.monthlyAvg)}</span>
            <span className="text-xs text-text-muted ml-2">/ mo</span>
          </Card>

          <Card title="Outstanding reimbursements" subtitle={`${stats.reimbOpenCount} reimbursable expense(s) not yet reimbursed`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-2xl font-mono font-bold text-accent-warning">{formatCurrency(stats.reimbOpenTotal)}</span>
              <button
                className="block-btn-primary text-xs"
                disabled={busy || stats.reimbOpenCount === 0}
                onClick={markAllReimbursed}
              >
                {busy ? 'Working…' : `Mark all reimbursed (${stats.reimbOpenCount})`}
              </button>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
};

export default ExpensesUpgradesPart5;
