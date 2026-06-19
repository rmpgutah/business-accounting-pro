import React, { useEffect, useState, useMemo } from 'react';
import { Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface AgingBucket {
  label: string;
  count: number;
  amount: number;
}

interface CollectorRow {
  name: string;
  assigned: number;
  collected: number;
  rate: number;
}

// ─── Component ──────────────────────────────────────────
const DebtCollectionReport: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalPortfolio, setTotalPortfolio] = useState(0);
  const [totalCollected, setTotalCollected] = useState(0);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [agingBuckets, setAgingBuckets] = useState<AgingBucket[]>([]);
  const [collectors, setCollectors] = useState<CollectorRow[]>([]);

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
        // Get all debts. assigned_to is the legacy free-text column; the
        // FK `assigned_collector_id` (added later) joins to users for the
        // collector's display name. Prefer the FK and fall back to text.
        const debts: any[] = await api.rawQuery(
          `SELECT d.id, d.original_amount, d.balance_due, d.status,
                  COALESCE(NULLIF(u.display_name, ''), NULLIF(u.email, ''), NULLIF(d.assigned_to, ''), 'Unassigned') as collector_name,
                  d.due_date, julianday('now') - julianday(d.due_date) as days_past_due
           FROM debts d
           LEFT JOIN users u ON d.assigned_collector_id = u.id
           WHERE d.company_id = ?`,
          [activeCompany.id]
        );

        // Get total payments
        const payments: any[] = await api.rawQuery(
          `SELECT dp.debt_id, COALESCE(SUM(dp.amount), 0) as collected
           FROM debt_payments dp
           JOIN debts d ON dp.debt_id = d.id
           WHERE d.company_id = ?
             AND dp.received_date >= ?
             AND dp.received_date <= ?
           GROUP BY dp.debt_id`,
          [activeCompany.id, startDate, endDate]
        );

        if (cancelled) return;

        const paymentMap = new Map((payments ?? []).map((p: any) => [p.debt_id, Number(p.collected) || 0]));

        const portfolio = (debts ?? []).reduce((s: number, d: any) => s + (Number(d.original_amount) || 0), 0);
        const collected = (payments ?? []).reduce((s: number, p: any) => s + (Number(p.collected) || 0), 0);
        const outstanding = (debts ?? []).reduce((s: number, d: any) => s + (Number(d.balance_due) || 0), 0);

        setTotalPortfolio(portfolio);
        setTotalCollected(collected);
        setTotalOutstanding(outstanding);

        // Aging buckets
        const buckets: Record<string, { count: number; amount: number }> = {
          '0-30 days': { count: 0, amount: 0 },
          '31-60 days': { count: 0, amount: 0 },
          '61-90 days': { count: 0, amount: 0 },
          '90+ days': { count: 0, amount: 0 },
        };

        (debts ?? []).forEach((d: any) => {
          const balance = Number(d.balance_due) || 0;
          if (balance <= 0) return;
          const days = Number(d.days_past_due) || 0;
          let bucket: string;
          if (days <= 30) bucket = '0-30 days';
          else if (days <= 60) bucket = '31-60 days';
          else if (days <= 90) bucket = '61-90 days';
          else bucket = '90+ days';
          buckets[bucket].count++;
          buckets[bucket].amount += balance;
        });

        setAgingBuckets(Object.entries(buckets).map(([label, data]) => ({ label, ...data })));

        // Collector performance
        const collectorMap = new Map<string, { assigned: number; collected: number }>();
        (debts ?? []).forEach((d: any) => {
          const name = d.collector_name || 'Unassigned';
          if (!collectorMap.has(name)) collectorMap.set(name, { assigned: 0, collected: 0 });
          const entry = collectorMap.get(name)!;
          entry.assigned += Number(d.original_amount) || 0;
          entry.collected += paymentMap.get(d.id) || 0;
        });

        const collectorRows: CollectorRow[] = Array.from(collectorMap.entries()).map(([name, data]) => ({
          name,
          assigned: data.assigned,
          collected: data.collected,
          rate: data.assigned > 0 ? (data.collected / data.assigned) * 100 : 0,
        }));
        collectorRows.sort((a, b) => b.collected - a.collected);
        setCollectors(collectorRows);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load debt collection data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate]);

  const recoveryRate = totalPortfolio > 0 ? (totalCollected / totalPortfolio) * 100 : 0;

  const handlePrint = () => {
    const agingRows = agingBuckets.map((b) =>
      `<tr><td>${b.label}</td><td class="text-right">${b.count}</td><td class="text-right font-mono">${formatCurrency(b.amount)}</td></tr>`
    ).join('');

    const collectorRows = collectors.map((c) =>
      `<tr><td>${c.name}</td><td class="text-right font-mono">${formatCurrency(c.assigned)}</td><td class="text-right font-mono">${formatCurrency(c.collected)}</td><td class="text-right">${c.rate.toFixed(1)}%</td></tr>`
    ).join('');

    const html = `<div class="rpt-page">
      <div class="rpt-hdr"><div><div class="rpt-co">${activeCompany?.name || 'Company'}</div><div class="rpt-co-sub">Debt Collection Report</div></div><div class="rpt-badge">${startDate} to ${endDate}</div></div>
      <div class="rpt-stats">
        <div class="rpt-stat"><div class="rpt-stat-label">Total Portfolio</div><div class="rpt-stat-val">${formatCurrency(totalPortfolio)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Collected</div><div class="rpt-stat-val">${formatCurrency(totalCollected)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Outstanding</div><div class="rpt-stat-val">${formatCurrency(totalOutstanding)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Recovery Rate</div><div class="rpt-stat-val">${recoveryRate.toFixed(1)}%</div></div>
      </div>
      <div class="rpt-section">Aging Analysis</div>
      <table><thead><tr><th>Bucket</th><th class="text-right">Count</th><th class="text-right">Amount</th></tr></thead><tbody>${agingRows}</tbody></table>
      <div class="rpt-section" style="margin-top:24px">Collector Performance</div>
      <table><thead><tr><th>Collector</th><th class="text-right">Assigned</th><th class="text-right">Collected</th><th class="text-right">Recovery %</th></tr></thead><tbody>${collectorRows}</tbody></table>
      <div class="rpt-footer"><span>Generated ${new Date().toLocaleDateString()}</span><span>Business Accounting Pro</span></div>
    </div>`;
    api.printPreview(html, 'Debt Collection Report');
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
          { label: 'Total Portfolio', value: formatCurrency(totalPortfolio), accent: 'text-text-primary' },
          { label: 'Collected', value: formatCurrency(totalCollected), accent: 'text-accent-income' },
          { label: 'Outstanding', value: formatCurrency(totalOutstanding), accent: 'text-accent-expense' },
          { label: 'Recovery Rate', value: `${recoveryRate.toFixed(1)}%`, accent: 'text-accent-blue' },
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
          {/* Aging Analysis */}
          <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
            <div className="bg-bg-tertiary px-4 py-2 border-b border-border-primary">
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Aging Analysis</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary/50 border-b border-border-primary">
                  <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Bucket</th>
                  <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Count</th>
                  <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Amount</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-48">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {agingBuckets.map((bucket) => {
                  const pct = totalOutstanding > 0 ? (bucket.amount / totalOutstanding) * 100 : 0;
                  const barColors: Record<string, string> = {
                    '0-30 days': 'bg-accent-income',
                    '31-60 days': 'bg-accent-warning',
                    '61-90 days': 'bg-[#f97316]',
                    '90+ days': 'bg-accent-expense',
                  };
                  return (
                    <tr key={bucket.label} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                      <td className="px-4 py-2 text-xs text-text-primary font-medium">{bucket.label}</td>
                      <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{bucket.count}</td>
                      <td className="text-right px-4 py-2 text-xs text-text-primary font-mono font-semibold">{formatCurrency(bucket.amount)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                            <div className={`h-full transition-all duration-500 ${barColors[bucket.label] || 'bg-accent-blue'}`} style={{ width: `${pct}%`, borderRadius: '6px' }} />
                          </div>
                          <span className="text-xs text-text-muted font-mono w-12 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                  <td className="px-4 py-2 text-xs font-bold text-text-primary">Total</td>
                  <td className="text-right px-4 py-2 text-xs font-bold text-text-primary font-mono">{agingBuckets.reduce((s, b) => s + b.count, 0)}</td>
                  <td className="text-right px-4 py-2 text-xs font-bold text-accent-expense font-mono">{formatCurrency(agingBuckets.reduce((s, b) => s + b.amount, 0))}</td>
                  <td className="px-4 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Collector Performance */}
          {collectors.length > 0 && (
            <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="bg-bg-tertiary px-4 py-2 border-b border-border-primary">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Collector Performance</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-tertiary/50 border-b border-border-primary">
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Collector</th>
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Assigned</th>
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Collected</th>
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Recovery %</th>
                  </tr>
                </thead>
                <tbody>
                  {collectors.map((c) => (
                    <tr key={c.name} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                      <td className="px-4 py-2 text-xs text-text-primary font-medium">{c.name}</td>
                      <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{formatCurrency(c.assigned)}</td>
                      <td className="text-right px-4 py-2 text-xs text-accent-income font-mono font-semibold">{formatCurrency(c.collected)}</td>
                      <td className="text-right px-4 py-2 text-xs">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                            <div className="h-full bg-accent-income transition-all duration-500" style={{ width: `${Math.min(c.rate, 100)}%`, borderRadius: '6px' }} />
                          </div>
                          <span className="text-text-primary font-mono font-semibold">{c.rate.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DebtCollectionReport;
