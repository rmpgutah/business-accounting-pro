import React, { useEffect, useState, useMemo } from 'react';
import { Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface VendorRow {
  name: string;
  txn_count: number;
  total: number;
  last_payment: string | null;
}

// ─── Component ──────────────────────────────────────────
const VendorSpendReport: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<VendorRow[]>([]);

  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(`${currentYear}-12-31`);

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    api.rawQuery(
      `SELECT
         COALESCE(v.name, 'Unassigned') as name,
         COUNT(e.id) as txn_count,
         COALESCE(SUM(e.amount), 0) as total,
         MAX(e.date) as last_payment
       FROM expenses e
       LEFT JOIN vendors v ON e.vendor_id = v.id
       WHERE e.company_id = ?
         AND e.date >= ?
         AND e.date <= ?
       GROUP BY e.vendor_id
       ORDER BY total DESC`,
      [activeCompany.id, startDate, endDate]
    )
      .then((rows: any[]) => {
        if (cancelled) return;
        setData(
          (rows ?? []).map((r: any) => ({
            name: r.name || 'Unassigned',
            txn_count: Number(r.txn_count) || 0,
            total: Number(r.total) || 0,
            last_payment: r.last_payment || null,
          }))
        );
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load vendor spend data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate]);

  const totalSpend = useMemo(() => data.reduce((s, r) => s + r.total, 0), [data]);
  const maxSpend = useMemo(() => Math.max(...data.map((r) => r.total), 1), [data]);
  const uniqueVendors = data.length;
  const avgPerVendor = uniqueVendors > 0 ? totalSpend / uniqueVendors : 0;
  const topVendor = data.length > 0 ? data[0].name : '—';

  const handlePrint = () => {
    const rows = data.map((r, i) => {
      const pct = totalSpend > 0 ? ((r.total / totalSpend) * 100).toFixed(1) : '0.0';
      const avg = r.txn_count > 0 ? formatCurrency(r.total / r.txn_count) : '$0.00';
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${r.name}</td>
        <td class="text-right">${r.txn_count}</td>
        <td class="text-right font-mono">${formatCurrency(r.total)}</td>
        <td class="text-right">${pct}%</td>
        <td class="text-right font-mono">${avg}</td>
        <td>${r.last_payment ? formatDate(r.last_payment) : '—'}</td>
      </tr>`;
    }).join('');

    const html = `<div class="rpt-page">
      <div class="rpt-hdr"><div><div class="rpt-co">${activeCompany?.name || 'Company'}</div><div class="rpt-co-sub">Vendor Spend Analysis</div></div><div class="rpt-badge">${startDate} to ${endDate}</div></div>
      <div class="rpt-stats">
        <div class="rpt-stat"><div class="rpt-stat-label">Total Spend</div><div class="rpt-stat-val">${formatCurrency(totalSpend)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Unique Vendors</div><div class="rpt-stat-val">${uniqueVendors}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Avg Spend/Vendor</div><div class="rpt-stat-val">${formatCurrency(avgPerVendor)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Top Vendor</div><div class="rpt-stat-val" style="font-size:14px">${topVendor}</div></div>
      </div>
      <table><thead><tr><th style="text-align:center">#</th><th>Vendor</th><th class="text-right">Transactions</th><th class="text-right">Total Spent</th><th class="text-right">% Total</th><th class="text-right">Avg Transaction</th><th>Last Payment</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="rpt-total"><td></td><td>Total</td><td class="text-right">${data.reduce((s, r) => s + r.txn_count, 0)}</td><td class="text-right font-mono">${formatCurrency(totalSpend)}</td><td class="text-right">100%</td><td></td><td></td></tr></tfoot></table>
      <div class="rpt-footer"><span>Generated ${new Date().toLocaleDateString()}</span><span>Business Accounting Pro</span></div>
    </div>`;
    api.printPreview(html, 'Vendor Spend Analysis');
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
          { label: 'Total Spend', value: formatCurrency(totalSpend), accent: 'text-accent-expense' },
          { label: 'Unique Vendors', value: String(uniqueVendors), accent: 'text-accent-blue' },
          { label: 'Avg Spend/Vendor', value: formatCurrency(avgPerVendor), accent: 'text-text-primary' },
          { label: 'Top Vendor', value: topVendor, accent: 'text-accent-blue' },
        ].map((card) => (
          <div key={card.label} className="block-card p-4" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{card.label}</div>
            <div className={`text-lg font-bold ${card.accent} mt-1 font-mono truncate`}>{card.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">No vendor spend data found for this period.</div>
      ) : (
        <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary border-b border-border-primary">
                <th className="text-center px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-12">#</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Vendor</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Transactions</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Spent</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-48">% of Total</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Transaction</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Last Payment</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => {
                const pct = totalSpend > 0 ? (row.total / totalSpend) * 100 : 0;
                const barWidth = (row.total / maxSpend) * 100;
                const avgTxn = row.txn_count > 0 ? row.total / row.txn_count : 0;
                return (
                  <tr key={row.name + i} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                    <td className="text-center px-4 py-2 text-xs text-text-muted font-mono">{i + 1}</td>
                    <td className="px-4 py-2 text-xs text-text-primary font-medium">{row.name}</td>
                    <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{row.txn_count}</td>
                    <td className="text-right px-4 py-2 text-xs text-text-primary font-mono font-semibold">{formatCurrency(row.total)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                          <div className="h-full bg-[#f97316] transition-all duration-500" style={{ width: `${barWidth}%`, borderRadius: '6px' }} />
                        </div>
                        <span className="text-xs text-text-muted font-mono w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{formatCurrency(avgTxn)}</td>
                    <td className="px-4 py-2 text-xs text-text-muted">{formatDate(row.last_payment)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2 text-xs font-bold text-text-primary">Total</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-text-primary font-mono">{data.reduce((s, r) => s + r.txn_count, 0)}</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-accent-expense font-mono">{formatCurrency(totalSpend)}</td>
                <td className="px-4 py-2 text-xs font-bold text-text-muted font-mono">100.0%</td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default VendorSpendReport;
