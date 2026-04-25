import React, { useEffect, useState, useMemo } from 'react';
import { Printer } from 'lucide-react';
import { format, startOfYear, endOfMonth } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface CategoryRow {
  category: string;
  amount: number;
}

// ─── Vendor Spend Table ─────────────────────────────────
const VendorSpendTable: React.FC<{ startDate: string; endDate: string }> = ({ startDate, endDate }) => {
  const [vendors, setVendors] = useState<any[]>([]);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (!startDate || !endDate) return;
    setLoadError('');
    api.vendorSpend(startDate, endDate)
      .then(r => setVendors(Array.isArray(r) ? r : []))
      .catch((err: any) => setLoadError(err?.message || 'Failed to load vendor spend'));
  }, [startDate, endDate]);

  if (loadError) return <p className="text-xs text-accent-expense">Error: {loadError}</p>;
  if (vendors.length === 0) return <p className="text-xs text-text-muted">No vendor data for this period.</p>;

  const maxSpend = Math.max(...vendors.map(v => v.total_spend));
  const fmtCurrency = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

  return (
    <div className="space-y-2">
      {vendors.slice(0, 10).map((v: any) => (
        <div key={v.id} className="flex items-center gap-3">
          <span className="text-xs text-text-primary font-medium w-32 truncate">{v.vendor_name}</span>
          <div className="flex-1 h-2 bg-bg-tertiary" style={{ borderRadius: '6px' }}>
            <div className="h-full bg-accent-blue" style={{ width: `${(v.total_spend / maxSpend) * 100}%`, borderRadius: '6px', transition: 'width 0.3s' }} />
          </div>
          <span className="text-xs font-mono text-text-secondary w-24 text-right">{fmtCurrency(v.total_spend)}</span>
          <span className="text-[10px] text-text-muted w-16 text-right">{v.transaction_count} txns</span>
        </div>
      ))}
    </div>
  );
};

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Bar colors ─────────────────────────────────────────
const BAR_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#6366f1',
  '#14b8a6',
  '#e11d48',
];

// ─── Component ──────────────────────────────────────────
const ExpenseByCategory: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [startDate, setStartDate] = useState(() =>
    format(startOfYear(new Date()), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(() =>
    format(endOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);

      try {
        const rows: any[] = await api.rawQuery(
          `SELECT
             COALESCE(a.subtype, 'Uncategorized') AS category,
             ABS(COALESCE(SUM(jel.debit - jel.credit), 0)) AS amount
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE date(je.date) BETWEEN date(?) AND date(?)
             AND je.company_id = ?
             AND a.type = 'expense'
           GROUP BY a.subtype
           ORDER BY amount DESC`,
          [startDate, endDate, activeCompany.id]
        );

        if (cancelled) return;

        setCategories(
          (rows ?? []).map((r: any) => ({
            category: r.category || 'Uncategorized',
            amount: Math.abs(Number(r.amount) || 0),
          }))
        );
      } catch (err) {
        console.error('Failed to load expense by category:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, activeCompany]);

  const totalExpenses = useMemo(
    () => categories.reduce((s, c) => s + c.amount, 0),
    [categories]
  );

  const maxAmount = useMemo(
    () => Math.max(...categories.map((c) => c.amount), 1),
    [categories]
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div
        className="block-card p-4 flex items-center justify-between"
        style={{ borderRadius: '6px' }}
      >
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            From
          </label>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            To
          </label>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print"
          >
            <Printer size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Generating report...
        </div>
      ) : categories.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">
          No expense data found for this period.
        </div>
      ) : (
        <>
          {/* Bar Chart */}
          <div
            className="block-card p-6"
            style={{ borderRadius: '6px' }}
          >
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
              Expense Distribution
            </h3>
            <div className="space-y-3">
              {categories.map((cat, i) => {
                const pct = totalExpenses > 0 ? (cat.amount / totalExpenses) * 100 : 0;
                const barWidth = (cat.amount / maxAmount) * 100;
                const color = BAR_COLORS[i % BAR_COLORS.length];

                return (
                  <div key={cat.category} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-secondary font-medium truncate max-w-[200px]">
                        {cat.category}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-text-muted">
                          {pct.toFixed(1)}%
                        </span>
                        <span className="text-xs font-mono text-text-primary font-semibold w-24 text-right">
                          {fmt.format(cat.amount)}
                        </span>
                      </div>
                    </div>
                    <div
                      className="w-full h-5 bg-bg-tertiary overflow-hidden"
                      style={{ borderRadius: '6px' }}
                    >
                      <div
                        className="h-full transition-all duration-500 ease-out"
                        style={{
                          width: `${barWidth}%`,
                          backgroundColor: color,
                          borderRadius: '6px',
                          minWidth: barWidth > 0 ? '2px' : '0',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Table */}
          <div
            className="block-card overflow-hidden"
            style={{ borderRadius: '6px' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary border-b border-border-primary">
                  <th className="text-left px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Category
                  </th>
                  <th className="text-right px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="text-right px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-28">
                    % of Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat, i) => {
                  const pct =
                    totalExpenses > 0
                      ? (cat.amount / totalExpenses) * 100
                      : 0;
                  return (
                    <tr
                      key={cat.category}
                      className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors"
                    >
                      <td className="px-6 py-2 text-xs text-text-primary font-medium">
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 shrink-0"
                            style={{
                              backgroundColor:
                                BAR_COLORS[i % BAR_COLORS.length],
                              borderRadius: '1px',
                            }}
                          />
                          {cat.category}
                        </span>
                      </td>
                      <td className="px-6 py-2 text-right font-mono text-xs text-text-primary">
                        {fmt.format(cat.amount)}
                      </td>
                      <td className="px-6 py-2 text-right font-mono text-xs text-text-muted">
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                  <td className="px-6 py-2 text-xs font-bold text-text-primary">
                    Total
                  </td>
                  <td className="px-6 py-2 text-right font-mono text-xs font-bold text-accent-expense">
                    {fmt.format(totalExpenses)}
                  </td>
                  <td className="px-6 py-2 text-right font-mono text-xs font-bold text-text-muted">
                    100.0%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* Vendor Spend Section */}
      <div className="block-card p-4 mt-4" style={{ borderRadius: '6px' }}>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Top Vendors by Spend</h3>
        <VendorSpendTable startDate={startDate} endDate={endDate} />
      </div>
    </div>
  );
};

export default ExpenseByCategory;
