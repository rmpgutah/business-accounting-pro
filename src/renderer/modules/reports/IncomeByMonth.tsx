import React, { useEffect, useState, useMemo } from 'react';
import { Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface MonthRow {
  month: string;
  monthLabel: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  marginPct: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── Component ──────────────────────────────────────────
const IncomeByMonth: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<MonthRow[]>([]);
  const [priorData, setPriorData] = useState<MonthRow[]>([]);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const loadYear = async (y: number): Promise<MonthRow[]> => {
      const startDate = `${y}-01-01`;
      const endDate = `${y}-12-31`;

      const [revRows, expRows] = await Promise.all([
        api.rawQuery(
          `SELECT strftime('%m', issue_date) as month, COALESCE(SUM(total), 0) as revenue
           FROM invoices
           WHERE company_id = ? AND status IN ('paid','partial','sent') AND issue_date >= ? AND issue_date <= ?
           GROUP BY strftime('%m', issue_date)
           ORDER BY month`,
          [activeCompany.id, startDate, endDate]
        ),
        api.rawQuery(
          `SELECT strftime('%m', date) as month, COALESCE(SUM(amount), 0) as total
           FROM expenses
           WHERE company_id = ? AND date >= ? AND date <= ?
           GROUP BY strftime('%m', date)
           ORDER BY month`,
          [activeCompany.id, startDate, endDate]
        ),
      ]);

      const revMap = new Map<string, number>((revRows ?? []).map((r: any) => [r.month, Number(r.revenue) || 0]));
      const expMap = new Map<string, number>((expRows ?? []).map((r: any) => [r.month, Number(r.total) || 0]));

      return Array.from({ length: 12 }, (_, i) => {
        const m = String(i + 1).padStart(2, '0');
        const revenue = revMap.get(m) || 0;
        const expenses = expMap.get(m) || 0;
        const netIncome = revenue - expenses;
        return {
          month: m,
          monthLabel: MONTH_NAMES[i],
          revenue,
          expenses,
          netIncome,
          marginPct: revenue > 0 ? (netIncome / revenue) * 100 : 0,
        };
      });
    };

    const load = async () => {
      try {
        const [current, prior] = await Promise.all([loadYear(year), loadYear(year - 1)]);
        if (cancelled) return;
        setData(current);
        setPriorData(prior);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load income by month');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany, year]);

  const totals = useMemo(() => {
    const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
    const totalExpenses = data.reduce((s, r) => s + r.expenses, 0);
    const totalNet = totalRevenue - totalExpenses;
    const totalMargin = totalRevenue > 0 ? (totalNet / totalRevenue) * 100 : 0;
    const priorTotalRevenue = priorData.reduce((s, r) => s + r.revenue, 0);
    return { totalRevenue, totalExpenses, totalNet, totalMargin, priorTotalRevenue };
  }, [data, priorData]);

  const maxRevenue = useMemo(() => Math.max(...data.map((r) => r.revenue), 1), [data]);

  const handlePrint = () => {
    const rows = data.map((r, i) => {
      const prior = priorData[i];
      const yoyChange = prior && prior.revenue > 0 ? ((r.revenue - prior.revenue) / prior.revenue * 100).toFixed(1) : '—';
      const nc = r.netIncome >= 0 ? '' : 'text-red';
      return `<tr>
        <td>${r.monthLabel} ${year}</td>
        <td class="text-right font-mono">${formatCurrency(r.revenue)}</td>
        <td class="text-right font-mono">${formatCurrency(r.expenses)}</td>
        <td class="text-right font-mono ${nc}">${formatCurrency(r.netIncome)}</td>
        <td class="text-right">${r.marginPct.toFixed(1)}%</td>
        <td class="text-right">${typeof yoyChange === 'string' ? yoyChange : yoyChange + '%'}</td>
      </tr>`;
    }).join('');

    const html = `<div class="rpt-page">
      <div class="rpt-hdr"><div><div class="rpt-co">${activeCompany?.name || 'Company'}</div><div class="rpt-co-sub">Income by Month</div></div><div class="rpt-badge">${year}</div></div>
      <div class="rpt-stats">
        <div class="rpt-stat"><div class="rpt-stat-label">Total Revenue</div><div class="rpt-stat-val">${formatCurrency(totals.totalRevenue)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Total Expenses</div><div class="rpt-stat-val">${formatCurrency(totals.totalExpenses)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Net Income</div><div class="rpt-stat-val">${formatCurrency(totals.totalNet)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Margin</div><div class="rpt-stat-val">${totals.totalMargin.toFixed(1)}%</div></div>
      </div>
      <table><thead><tr><th>Month</th><th class="text-right">Revenue</th><th class="text-right">Expenses</th><th class="text-right">Net Income</th><th class="text-right">Margin %</th><th class="text-right">vs Prior Year</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="rpt-total"><td>Total</td><td class="text-right font-mono">${formatCurrency(totals.totalRevenue)}</td><td class="text-right font-mono">${formatCurrency(totals.totalExpenses)}</td><td class="text-right font-mono">${formatCurrency(totals.totalNet)}</td><td class="text-right">${totals.totalMargin.toFixed(1)}%</td><td></td></tr></tfoot></table>
      <div class="rpt-footer"><span>Generated ${new Date().toLocaleDateString()}</span><span>Business Accounting Pro</span></div>
    </div>`;
    api.printPreview(html, 'Income by Month');
  };

  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Year</label>
          <select className="block-select" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto' }}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={handlePrint} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" style={{ borderRadius: '6px' }} title="Print">
          <Printer size={15} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue', value: formatCurrency(totals.totalRevenue), accent: 'text-accent-income' },
          { label: 'Total Expenses', value: formatCurrency(totals.totalExpenses), accent: 'text-accent-expense' },
          { label: 'Net Income', value: formatCurrency(totals.totalNet), accent: totals.totalNet >= 0 ? 'text-accent-income' : 'text-accent-expense' },
          { label: 'Margin', value: `${totals.totalMargin.toFixed(1)}%`, accent: 'text-accent-blue' },
        ].map((card) => (
          <div key={card.label} className="block-card p-4" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{card.label}</div>
            <div className={`text-lg font-bold ${card.accent} mt-1 font-mono`}>{card.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : (
        <>
          {/* Bar chart */}
          <div className="block-card p-6" style={{ borderRadius: '6px' }}>
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-4">Monthly Revenue</h3>
            <div className="flex items-end gap-2 h-40">
              {data.map((row, i) => {
                const barHeight = maxRevenue > 0 ? (row.revenue / maxRevenue) * 100 : 0;
                const priorHeight = maxRevenue > 0 ? ((priorData[i]?.revenue || 0) / maxRevenue) * 100 : 0;
                return (
                  <div key={row.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end justify-center gap-0.5" style={{ height: '120px' }}>
                      <div
                        className="w-[40%] bg-bg-tertiary transition-all duration-500"
                        style={{ height: `${priorHeight}%`, borderRadius: '3px 3px 0 0', minHeight: priorHeight > 0 ? '2px' : '0' }}
                        title={`${year - 1}: ${formatCurrency(priorData[i]?.revenue || 0)}`}
                      />
                      <div
                        className="w-[40%] bg-accent-blue transition-all duration-500"
                        style={{ height: `${barHeight}%`, borderRadius: '3px 3px 0 0', minHeight: barHeight > 0 ? '2px' : '0' }}
                        title={`${year}: ${formatCurrency(row.revenue)}`}
                      />
                    </div>
                    <span className="text-[10px] text-text-muted">{row.monthLabel}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 bg-accent-blue" style={{ borderRadius: '2px' }} />
                <span className="text-[10px] text-text-muted">{year}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 bg-bg-tertiary" style={{ borderRadius: '2px' }} />
                <span className="text-[10px] text-text-muted">{year - 1}</span>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary border-b border-border-primary">
                  <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Month</th>
                  <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Revenue</th>
                  <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Expenses</th>
                  <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Net Income</th>
                  <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Margin %</th>
                  <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">vs Prior Year</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => {
                  const prior = priorData[i];
                  const yoyChange = prior && prior.revenue > 0 ? ((row.revenue - prior.revenue) / prior.revenue * 100) : null;
                  return (
                    <tr key={row.month} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                      <td className="px-4 py-2 text-xs text-text-primary font-medium">{row.monthLabel} {year}</td>
                      <td className="text-right px-4 py-2 text-xs text-text-primary font-mono">{formatCurrency(row.revenue)}</td>
                      <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{formatCurrency(row.expenses)}</td>
                      <td className={`text-right px-4 py-2 text-xs font-mono font-semibold ${row.netIncome >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                        {formatCurrency(row.netIncome)}
                      </td>
                      <td className="text-right px-4 py-2 text-xs text-text-muted">{row.marginPct.toFixed(1)}%</td>
                      <td className="text-right px-4 py-2 text-xs">
                        {yoyChange !== null ? (
                          <span className={yoyChange >= 0 ? 'text-accent-income' : 'text-accent-expense'}>
                            {yoyChange >= 0 ? '+' : ''}{yoyChange.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                  <td className="px-4 py-2 text-xs font-bold text-text-primary">Total</td>
                  <td className="text-right px-4 py-2 text-xs font-bold text-accent-income font-mono">{formatCurrency(totals.totalRevenue)}</td>
                  <td className="text-right px-4 py-2 text-xs font-bold text-accent-expense font-mono">{formatCurrency(totals.totalExpenses)}</td>
                  <td className={`text-right px-4 py-2 text-xs font-bold font-mono ${totals.totalNet >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>{formatCurrency(totals.totalNet)}</td>
                  <td className="text-right px-4 py-2 text-xs font-bold text-text-muted">{totals.totalMargin.toFixed(1)}%</td>
                  <td className="px-4 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default IncomeByMonth;
