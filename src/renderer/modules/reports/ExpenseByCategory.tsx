import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download } from 'lucide-react';
import { format, startOfYear, endOfMonth, subMonths, startOfMonth } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { downloadCSVBlob } from '../../lib/csv-export';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';

// ─── Types ──────────────────────────────────────────────
interface CategoryRow {
  category: string;
  amount: number;
  category_id?: string;
}

interface BudgetRow {
  category_id: string;
  budgeted: number;
}

interface PriorMonthRow {
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

  return (
    <div className="space-y-2">
      {vendors.slice(0, 10).map((v: any) => (
        <div key={v.id} className="flex items-center gap-3">
          <span className="text-xs text-text-primary font-medium w-32 truncate">{v.vendor_name}</span>
          <div className="flex-1 h-2 bg-bg-tertiary" style={{ borderRadius: '6px' }}>
            <div className="h-full bg-accent-blue" style={{ width: `${(v.total_spend / maxSpend) * 100}%`, borderRadius: '6px', transition: 'width 0.3s' }} />
          </div>
          <span className="text-xs font-mono text-text-secondary w-24 text-right">{formatCurrency(v.total_spend)}</span>
          <span className="text-[10px] text-text-muted w-16 text-right">{v.transaction_count} txns</span>
        </div>
      ))}
    </div>
  );
};

// ─── Bar colors ─────────────────────────────────────────
const BAR_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#ec4899',
  '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#14b8a6', '#e11d48',
];

// ─── Component ──────────────────────────────────────────
const ExpenseByCategory: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [startDate, setStartDate] = useState(() => format(startOfYear(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [showMoM, setShowMoM] = useState(false);
  const [priorMonthData, setPriorMonthData] = useState<PriorMonthRow[]>([]);
  const [budgetData, setBudgetData] = useState<BudgetRow[]>([]);

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

        // Change 49: Budget comparison
        try {
          const budgetRows: any[] = await api.rawQuery(
            `SELECT bl.category_id, COALESCE(SUM(bl.amount), 0) as budgeted
             FROM budget_lines bl JOIN budgets b ON bl.budget_id = b.id
             WHERE b.company_id = ? AND b.status = 'active'
             GROUP BY bl.category_id`,
            [activeCompany.id]
          );
          if (!cancelled) setBudgetData((budgetRows ?? []).map((r: any) => ({
            category_id: r.category_id || '',
            budgeted: Number(r.budgeted) || 0,
          })));
        } catch {
          // budget tables may not exist
          if (!cancelled) setBudgetData([]);
        }
      } catch (err) {
        console.error('Failed to load expense by category:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [startDate, endDate, activeCompany]);

  // Change 48: Month-over-month — load prior month data
  useEffect(() => {
    if (!showMoM || !activeCompany) return;
    let cancelled = false;
    const now = new Date();
    const priorStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
    const priorEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');

    api.rawQuery(
      `SELECT COALESCE(a.subtype, 'Uncategorized') AS category,
              ABS(COALESCE(SUM(jel.debit - jel.credit), 0)) AS amount
       FROM journal_entry_lines jel
       JOIN accounts a ON a.id = jel.account_id
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE date(je.date) BETWEEN date(?) AND date(?)
         AND je.company_id = ? AND a.type = 'expense'
       GROUP BY a.subtype ORDER BY amount DESC`,
      [priorStart, priorEnd, activeCompany.id]
    ).then((rows: any[]) => {
      if (!cancelled) setPriorMonthData((rows ?? []).map((r: any) => ({
        category: r.category || 'Uncategorized',
        amount: Math.abs(Number(r.amount) || 0),
      })));
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [showMoM, activeCompany]);

  const totalExpenses = useMemo(() => categories.reduce((s, c) => s + c.amount, 0), [categories]);
  const maxAmount = useMemo(() => Math.max(...categories.map((c) => c.amount), 1), [categories]);
  const categoriesUsed = categories.length;
  const avgPerCategory = categoriesUsed > 0 ? totalExpenses / categoriesUsed : 0;
  const largestCategory = categories.length > 0 ? categories[0] : null;

  // Build prior month lookup
  const priorMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of priorMonthData) m.set(p.category, p.amount);
    return m;
  }, [priorMonthData]);

  // ─── Change 50: CSV Export ─────────────────────────────
  const handleExportCSV = () => {
    downloadCSVBlob(
      categories.map((c, i) => ({
        category: c.category,
        amount: c.amount.toFixed(2),
        pct_of_total: totalExpenses > 0 ? ((c.amount / totalExpenses) * 100).toFixed(1) : '0.0',
      })),
      `expense-by-category-${startDate}-to-${endDate}.csv`
    );
  };

  return (
    <div className="space-y-4">
      <PrintReportHeader title="Expense by Category" periodLabel="period" periodEnd={endDate} />

      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between flex-wrap gap-3" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">From</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">To</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-wider cursor-pointer">
            <input type="checkbox" checked={showMoM} onChange={(e) => setShowMoM(e.target.checked)} className="accent-accent-blue" />
            Month vs Prior
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="block-btn flex items-center gap-2 text-xs"><Printer size={14} /> Print</button>
          <button onClick={handleExportCSV} className="block-btn flex items-center gap-2 text-xs"><Download size={14} /> CSV</button>
        </div>
      </div>

      {/* Change 46-47: KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Expenses', value: formatCurrency(totalExpenses), color: 'text-accent-expense' },
          { label: 'Categories Used', value: String(categoriesUsed), color: 'text-accent-blue' },
          { label: 'Avg Per Category', value: formatCurrency(avgPerCategory), color: 'text-text-primary' },
          { label: 'Largest Category', value: largestCategory ? `${largestCategory.category}` : '--', sub: largestCategory ? formatCurrency(largestCategory.amount) : '', color: 'text-text-primary' },
        ].map(c => (
          <div key={c.label} className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
            <p className={`text-lg font-bold font-mono ${c.color} truncate`}>{c.value}</p>
            {(c as any).sub && <p className="text-xs font-mono text-text-muted">{(c as any).sub}</p>}
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : categories.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">No expense data found for this period.</div>
      ) : (
        <>
          {/* Bar Chart */}
          <div className="block-card p-6" style={{ borderRadius: '6px' }}>
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-4">Expense Distribution</h3>
            <div className="space-y-3">
              {categories.map((cat, i) => {
                const pct = totalExpenses > 0 ? (cat.amount / totalExpenses) * 100 : 0;
                const barWidth = (cat.amount / maxAmount) * 100;
                const color = BAR_COLORS[i % BAR_COLORS.length];
                return (
                  <div key={cat.category} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-secondary font-medium truncate max-w-[200px]">{cat.category}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-text-muted">{pct.toFixed(1)}%</span>
                        <span className="text-xs font-mono text-text-primary font-semibold w-24 text-right">{formatCurrency(cat.amount)}</span>
                      </div>
                    </div>
                    <div className="w-full h-5 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                      <div className="h-full transition-all duration-500 ease-out" style={{ width: `${barWidth}%`, backgroundColor: color, borderRadius: '6px', minWidth: barWidth > 0 ? '2px' : '0' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Change 50: CSS Treemap */}
          {categories.length > 1 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Category Treemap</h3>
              <div className="flex flex-wrap gap-1" style={{ minHeight: 120 }}>
                {categories.map((cat, i) => {
                  const pct = totalExpenses > 0 ? (cat.amount / totalExpenses) * 100 : 0;
                  if (pct < 1) return null;
                  const color = BAR_COLORS[i % BAR_COLORS.length];
                  return (
                    <div
                      key={cat.category}
                      className="flex items-center justify-center p-2 text-center overflow-hidden"
                      style={{
                        backgroundColor: color,
                        borderRadius: '6px',
                        flex: `${Math.max(pct, 3)} 0 0`,
                        minWidth: 60,
                        minHeight: 50,
                        opacity: 0.85,
                      }}
                      title={`${cat.category}: ${formatCurrency(cat.amount)} (${pct.toFixed(1)}%)`}
                    >
                      <div>
                        <p className="text-[10px] font-bold text-bg-primary truncate" style={{ maxWidth: 120 }}>{cat.category}</p>
                        <p className="text-[9px] font-mono text-bg-primary/80">{pct.toFixed(0)}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Table with optional MoM and Budget columns */}
          <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary border-b border-border-primary">
                  <th className="text-left px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Category</th>
                  <th className="text-right px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Amount</th>
                  <th className="text-right px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-28">% of Total</th>
                  {showMoM && (
                    <>
                      <th className="text-right px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Prior Month</th>
                      <th className="text-right px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Change %</th>
                    </>
                  )}
                  {budgetData.length > 0 && (
                    <th className="text-right px-6 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Budget</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {categories.map((cat, i) => {
                  const pct = totalExpenses > 0 ? (cat.amount / totalExpenses) * 100 : 0;
                  const priorAmt = priorMap.get(cat.category) || 0;
                  const changeP = priorAmt > 0 ? ((cat.amount - priorAmt) / priorAmt) * 100 : 0;
                  return (
                    <tr key={cat.category} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                      <td className="px-6 py-2 text-xs text-text-primary font-medium">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 shrink-0" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length], borderRadius: '1px' }} />
                          {cat.category}
                        </span>
                      </td>
                      <td className="px-6 py-2 text-right font-mono text-xs text-text-primary">{formatCurrency(cat.amount)}</td>
                      <td className="px-6 py-2 text-right font-mono text-xs text-text-muted"><span className="common-size-pct">{pct.toFixed(1)}%</span></td>
                      {showMoM && (
                        <>
                          <td className="px-6 py-2 text-right font-mono text-xs text-text-muted">{formatCurrency(priorAmt)}</td>
                          <td className={`px-6 py-2 text-right font-mono text-xs font-semibold ${changeP > 0 ? 'text-accent-expense' : changeP < 0 ? 'text-accent-income' : 'text-text-muted'}`}>
                            {priorAmt > 0 ? `${changeP > 0 ? '+' : ''}${changeP.toFixed(1)}%` : '--'}
                          </td>
                        </>
                      )}
                      {budgetData.length > 0 && (
                        <td className="px-6 py-2 text-right font-mono text-xs text-text-muted">--</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-primary bg-bg-tertiary/50 report-grand-total-row">
                  <td className="px-6 py-2 text-xs font-bold text-text-primary">Total</td>
                  <td className="px-6 py-2 text-right font-mono text-xs font-bold text-accent-expense">{formatCurrency(totalExpenses)}</td>
                  <td className="px-6 py-2 text-right font-mono text-xs font-bold text-text-muted"><span className="common-size-pct">100.0%</span></td>
                  {showMoM && (
                    <>
                      <td className="px-6 py-2 text-right font-mono text-xs font-bold text-text-muted">{formatCurrency(priorMonthData.reduce((s, p) => s + p.amount, 0))}</td>
                      <td className="px-6 py-2" />
                    </>
                  )}
                  {budgetData.length > 0 && <td className="px-6 py-2" />}
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
      <PrintReportFooter />
    </div>
  );
};

export default ExpenseByCategory;
