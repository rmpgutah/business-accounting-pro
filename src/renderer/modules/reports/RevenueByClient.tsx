import React, { useEffect, useState, useMemo } from 'react';
import { Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface ClientRow {
  name: string;
  invoice_count: number;
  revenue: number;
  last_invoice: string | null;
}

// ─── Component ──────────────────────────────────────────
const RevenueByClient: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<ClientRow[]>([]);

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
         COALESCE(c.name, 'Unknown Client') as name,
         COUNT(i.id) as invoice_count,
         COALESCE(SUM(i.total), 0) as revenue,
         MAX(i.issue_date) as last_invoice
       FROM invoices i
       LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.company_id = ?
         AND i.issue_date >= ?
         AND i.issue_date <= ?
       GROUP BY i.client_id
       ORDER BY revenue DESC`,
      [activeCompany.id, startDate, endDate]
    )
      .then((rows: any[]) => {
        if (cancelled) return;
        setData(
          (rows ?? []).map((r: any) => ({
            name: r.name || 'Unknown Client',
            invoice_count: Number(r.invoice_count) || 0,
            revenue: Number(r.revenue) || 0,
            last_invoice: r.last_invoice || null,
          }))
        );
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load revenue by client');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate]);

  const totalRevenue = useMemo(() => data.reduce((s, r) => s + r.revenue, 0), [data]);
  const maxRevenue = useMemo(() => Math.max(...data.map((r) => r.revenue), 1), [data]);
  const uniqueClients = data.length;
  const avgPerClient = uniqueClients > 0 ? totalRevenue / uniqueClients : 0;
  const largestClient = data.length > 0 ? data[0].name : '—';

  const handlePrint = () => {
    const rows = data.map((r, i) => {
      const pct = totalRevenue > 0 ? ((r.revenue / totalRevenue) * 100).toFixed(1) : '0.0';
      const avg = r.invoice_count > 0 ? formatCurrency(r.revenue / r.invoice_count) : '$0.00';
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${r.name}</td>
        <td class="text-right">${r.invoice_count}</td>
        <td class="text-right font-mono">${formatCurrency(r.revenue)}</td>
        <td class="text-right">${pct}%</td>
        <td class="text-right font-mono">${avg}</td>
        <td>${r.last_invoice ? formatDate(r.last_invoice) : '—'}</td>
      </tr>`;
    }).join('');

    const html = `<div class="rpt-page">
      <div class="rpt-hdr"><div><div class="rpt-co">${activeCompany?.name || 'Company'}</div><div class="rpt-co-sub">Revenue by Client</div></div><div class="rpt-badge">${startDate} to ${endDate}</div></div>
      <div class="rpt-stats">
        <div class="rpt-stat"><div class="rpt-stat-label">Total Revenue</div><div class="rpt-stat-val">${formatCurrency(totalRevenue)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Unique Clients</div><div class="rpt-stat-val">${uniqueClients}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Avg Revenue/Client</div><div class="rpt-stat-val">${formatCurrency(avgPerClient)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Largest Client</div><div class="rpt-stat-val" style="font-size:14px">${largestClient}</div></div>
      </div>
      <table><thead><tr><th style="text-align:center">#</th><th>Client</th><th class="text-right">Invoices</th><th class="text-right">Revenue</th><th class="text-right">% Total</th><th class="text-right">Avg Invoice</th><th>Last Invoice</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="rpt-total"><td></td><td>Total</td><td class="text-right">${data.reduce((s, r) => s + r.invoice_count, 0)}</td><td class="text-right font-mono">${formatCurrency(totalRevenue)}</td><td class="text-right">100%</td><td></td><td></td></tr></tfoot></table>
      <div class="rpt-footer"><span>Generated ${new Date().toLocaleDateString()}</span><span>Business Accounting Pro</span></div>
    </div>`;
    api.printPreview(html, 'Revenue by Client');
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
          { label: 'Total Revenue', value: formatCurrency(totalRevenue), accent: 'text-accent-income' },
          { label: 'Unique Clients', value: String(uniqueClients), accent: 'text-accent-blue' },
          { label: 'Avg Revenue/Client', value: formatCurrency(avgPerClient), accent: 'text-text-primary' },
          { label: 'Largest Client', value: largestClient, accent: 'text-accent-blue' },
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
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">No revenue data found for this period.</div>
      ) : (
        <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary border-b border-border-primary">
                <th className="text-center px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-12">#</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Client</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Invoices</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Revenue</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-48">% of Total</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Invoice</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Last Invoice</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => {
                const pct = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0;
                const barWidth = (row.revenue / maxRevenue) * 100;
                const avgInvoice = row.invoice_count > 0 ? row.revenue / row.invoice_count : 0;
                return (
                  <tr key={row.name + i} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                    <td className="text-center px-4 py-2 text-xs text-text-muted font-mono">{i + 1}</td>
                    <td className="px-4 py-2 text-xs text-text-primary font-medium">{row.name}</td>
                    <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{row.invoice_count}</td>
                    <td className="text-right px-4 py-2 text-xs text-text-primary font-mono font-semibold">{formatCurrency(row.revenue)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                          <div className="h-full bg-accent-blue transition-all duration-500" style={{ width: `${barWidth}%`, borderRadius: '6px' }} />
                        </div>
                        <span className="text-xs text-text-muted font-mono w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{formatCurrency(avgInvoice)}</td>
                    <td className="px-4 py-2 text-xs text-text-muted">{formatDate(row.last_invoice)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2 text-xs font-bold text-text-primary">Total</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-text-primary font-mono">{data.reduce((s, r) => s + r.invoice_count, 0)}</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-accent-income font-mono">{formatCurrency(totalRevenue)}</td>
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

export default RevenueByClient;
