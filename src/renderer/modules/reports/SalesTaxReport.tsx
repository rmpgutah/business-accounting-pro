import React, { useEffect, useState, useMemo } from 'react';
import { Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface TaxPeriodRow {
  period: string;
  periodLabel: string;
  taxableSales: number;
  taxCollected: number;
  taxPaid: number;
  netDue: number;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ─── Component ──────────────────────────────────────────
const SalesTaxReport: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<TaxPeriodRow[]>([]);

  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(`${currentYear}-12-31`);

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const load = async () => {
      try {
        // Tax collected from invoices (tax_amount field)
        const taxCollectedRows: any[] = await api.rawQuery(
          `SELECT strftime('%Y-%m', issue_date) as period,
                  COALESCE(SUM(total), 0) as taxable_sales,
                  COALESCE(SUM(tax_amount), 0) as tax_collected
           FROM invoices
           WHERE company_id = ?
             AND issue_date >= ?
             AND issue_date <= ?
           GROUP BY strftime('%Y-%m', issue_date)
           ORDER BY period`,
          [activeCompany.id, startDate, endDate]
        );

        // Tax payments made
        const taxPaidRows: any[] = await api.rawQuery(
          `SELECT strftime('%Y-%m', date) as period,
                  COALESCE(SUM(amount), 0) as tax_paid
           FROM tax_payments
           WHERE company_id = ?
             AND date >= ?
             AND date <= ?
           GROUP BY strftime('%Y-%m', date)
           ORDER BY period`,
          [activeCompany.id, startDate, endDate]
        );

        if (cancelled) return;

        const collectedMap = new Map<string, { taxableSales: number; taxCollected: number }>();
        (taxCollectedRows ?? []).forEach((r: any) => {
          collectedMap.set(r.period, {
            taxableSales: Number(r.taxable_sales) || 0,
            taxCollected: Number(r.tax_collected) || 0,
          });
        });

        const paidMap = new Map<string, number>();
        (taxPaidRows ?? []).forEach((r: any) => {
          paidMap.set(r.period, Number(r.tax_paid) || 0);
        });

        // Build period list from start to end date
        const periods: TaxPeriodRow[] = [];
        const startParts = startDate.split('-');
        const endParts = endDate.split('-');
        let currentMonth = parseInt(startParts[1], 10) - 1;
        let currentYr = parseInt(startParts[0], 10);
        const endMonth = parseInt(endParts[1], 10) - 1;
        const endYr = parseInt(endParts[0], 10);

        while (currentYr < endYr || (currentYr === endYr && currentMonth <= endMonth)) {
          const periodKey = `${currentYr}-${String(currentMonth + 1).padStart(2, '0')}`;
          const collected = collectedMap.get(periodKey) || { taxableSales: 0, taxCollected: 0 };
          const paid = paidMap.get(periodKey) || 0;
          periods.push({
            period: periodKey,
            periodLabel: `${MONTH_NAMES[currentMonth]} ${currentYr}`,
            taxableSales: collected.taxableSales,
            taxCollected: collected.taxCollected,
            taxPaid: paid,
            netDue: collected.taxCollected - paid,
          });
          currentMonth++;
          if (currentMonth > 11) {
            currentMonth = 0;
            currentYr++;
          }
        }

        setData(periods);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load sales tax data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate]);

  const totals = useMemo(() => {
    const totalTaxable = data.reduce((s, r) => s + r.taxableSales, 0);
    const totalCollected = data.reduce((s, r) => s + r.taxCollected, 0);
    const totalPaid = data.reduce((s, r) => s + r.taxPaid, 0);
    const totalNetDue = totalCollected - totalPaid;
    return { totalTaxable, totalCollected, totalPaid, totalNetDue };
  }, [data]);

  const effectiveRate = totals.totalTaxable > 0 ? (totals.totalCollected / totals.totalTaxable) * 100 : 0;

  const handlePrint = () => {
    const rows = data.map((r) => {
      const rate = r.taxableSales > 0 ? ((r.taxCollected / r.taxableSales) * 100).toFixed(2) : '—';
      const nc = r.netDue > 0 ? 'text-red' : r.netDue < 0 ? 'text-green' : '';
      return `<tr>
        <td>${r.periodLabel}</td>
        <td class="text-right font-mono">${formatCurrency(r.taxableSales)}</td>
        <td class="text-right">${rate}${typeof rate === 'string' && rate !== '—' ? '' : '%'}</td>
        <td class="text-right font-mono">${formatCurrency(r.taxCollected)}</td>
        <td class="text-right font-mono">${formatCurrency(r.taxPaid)}</td>
        <td class="text-right font-mono ${nc}">${formatCurrency(r.netDue)}</td>
      </tr>`;
    }).join('');

    const html = `<div class="rpt-page">
      <div class="rpt-hdr"><div><div class="rpt-co">${activeCompany?.name || 'Company'}</div><div class="rpt-co-sub">Sales Tax Report</div></div><div class="rpt-badge">${startDate} to ${endDate}</div></div>
      <div class="rpt-stats">
        <div class="rpt-stat"><div class="rpt-stat-label">Total Taxable Sales</div><div class="rpt-stat-val">${formatCurrency(totals.totalTaxable)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Tax Collected</div><div class="rpt-stat-val">${formatCurrency(totals.totalCollected)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Tax Paid</div><div class="rpt-stat-val">${formatCurrency(totals.totalPaid)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Net Due</div><div class="rpt-stat-val">${formatCurrency(totals.totalNetDue)}</div></div>
      </div>
      <table><thead><tr><th>Period</th><th class="text-right">Taxable Sales</th><th class="text-right">Tax Rate</th><th class="text-right">Tax Collected</th><th class="text-right">Tax Paid</th><th class="text-right">Net Due</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="rpt-total"><td>Total</td><td class="text-right font-mono">${formatCurrency(totals.totalTaxable)}</td><td class="text-right">${effectiveRate.toFixed(2)}%</td><td class="text-right font-mono">${formatCurrency(totals.totalCollected)}</td><td class="text-right font-mono">${formatCurrency(totals.totalPaid)}</td><td class="text-right font-mono">${formatCurrency(totals.totalNetDue)}</td></tr></tfoot></table>
      <div class="rpt-footer"><span>Generated ${new Date().toLocaleDateString()}</span><span>Business Accounting Pro</span></div>
    </div>`;
    api.printPreview(html, 'Sales Tax Report');
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">From</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">To</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button onClick={handlePrint} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" style={{ borderRadius: '6px' }} title="Print">
          <Printer size={15} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Taxable Sales', value: formatCurrency(totals.totalTaxable), accent: 'text-text-primary' },
          { label: 'Tax Collected', value: formatCurrency(totals.totalCollected), accent: 'text-accent-blue' },
          { label: 'Tax Paid', value: formatCurrency(totals.totalPaid), accent: 'text-accent-income' },
          { label: 'Net Due', value: formatCurrency(totals.totalNetDue), accent: totals.totalNetDue > 0 ? 'text-accent-expense' : 'text-accent-income' },
        ].map((card) => (
          <div key={card.label} className="block-card p-4" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{card.label}</div>
            <div className={`text-lg font-bold ${card.accent} mt-1 font-mono`}>{card.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">No sales tax data found for this period.</div>
      ) : (
        <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary border-b border-border-primary">
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Period</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Taxable Sales</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Tax Rate</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Tax Collected</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Tax Paid</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Net Due</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const rate = row.taxableSales > 0 ? ((row.taxCollected / row.taxableSales) * 100) : 0;
                return (
                  <tr key={row.period} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                    <td className="px-4 py-2 text-xs text-text-primary font-medium">{row.periodLabel}</td>
                    <td className="text-right px-4 py-2 text-xs text-text-primary font-mono">{formatCurrency(row.taxableSales)}</td>
                    <td className="text-right px-4 py-2 text-xs text-text-muted">{row.taxableSales > 0 ? `${rate.toFixed(2)}%` : '—'}</td>
                    <td className="text-right px-4 py-2 text-xs text-accent-blue font-mono font-semibold">{formatCurrency(row.taxCollected)}</td>
                    <td className="text-right px-4 py-2 text-xs text-accent-income font-mono">{formatCurrency(row.taxPaid)}</td>
                    <td className={`text-right px-4 py-2 text-xs font-mono font-semibold ${row.netDue > 0 ? 'text-accent-expense' : row.netDue < 0 ? 'text-accent-income' : 'text-text-muted'}`}>
                      {formatCurrency(row.netDue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                <td className="px-4 py-2 text-xs font-bold text-text-primary">Total</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-text-primary font-mono">{formatCurrency(totals.totalTaxable)}</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-text-muted">{effectiveRate.toFixed(2)}%</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-accent-blue font-mono">{formatCurrency(totals.totalCollected)}</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-accent-income font-mono">{formatCurrency(totals.totalPaid)}</td>
                <td className={`text-right px-4 py-2 text-xs font-bold font-mono ${totals.totalNetDue > 0 ? 'text-accent-expense' : 'text-accent-income'}`}>{formatCurrency(totals.totalNetDue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default SalesTaxReport;
