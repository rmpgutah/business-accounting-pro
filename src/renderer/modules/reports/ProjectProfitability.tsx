import React, { useEffect, useState, useMemo } from 'react';
import { Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface ProjectRow {
  name: string;
  client_name: string | null;
  revenue: number;
  costs: number;
  margin: number;
  marginPct: number;
  budget: number;
  budgetUsedPct: number;
}

// ─── Component ──────────────────────────────────────────
const ProjectProfitability: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<ProjectRow[]>([]);

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const load = async () => {
      try {
        // Get projects
        const projects: any[] = await api.rawQuery(
          `SELECT p.id, p.name, c.name as client_name, COALESCE(p.budget, 0) as budget
           FROM projects p
           LEFT JOIN clients c ON p.client_id = c.id
           WHERE p.company_id = ?
           ORDER BY p.name`,
          [activeCompany.id]
        );

        if (cancelled) return;

        // Get revenue per project from invoices
        const revenueRows: any[] = await api.rawQuery(
          `SELECT i.project_id, COALESCE(SUM(i.total), 0) as revenue
           FROM invoices i
           WHERE i.company_id = ? AND i.project_id IS NOT NULL
           GROUP BY i.project_id`,
          [activeCompany.id]
        );

        // Get costs per project from expenses
        const expenseRows: any[] = await api.rawQuery(
          `SELECT e.project_id, COALESCE(SUM(e.amount), 0) as costs
           FROM expenses e
           WHERE e.company_id = ? AND e.project_id IS NOT NULL
           GROUP BY e.project_id`,
          [activeCompany.id]
        );

        // Get labor costs from time entries
        const laborRows: any[] = await api.rawQuery(
          `SELECT te.project_id, COALESCE(SUM(te.duration_minutes * COALESCE(te.hourly_rate, 0) / 60.0), 0) as labor_cost
           FROM time_entries te
           WHERE te.company_id = ? AND te.project_id IS NOT NULL
           GROUP BY te.project_id`,
          [activeCompany.id]
        );

        if (cancelled) return;

        const revenueMap = new Map((revenueRows ?? []).map((r: any) => [r.project_id, Number(r.revenue) || 0]));
        const expenseMap = new Map((expenseRows ?? []).map((r: any) => [r.project_id, Number(r.costs) || 0]));
        const laborMap = new Map((laborRows ?? []).map((r: any) => [r.project_id, Number(r.labor_cost) || 0]));

        const rows: ProjectRow[] = (projects ?? []).map((p: any) => {
          const revenue = revenueMap.get(p.id) || 0;
          const expenseCost = expenseMap.get(p.id) || 0;
          const laborCost = laborMap.get(p.id) || 0;
          const costs = expenseCost + laborCost;
          const margin = revenue - costs;
          const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
          const budget = Number(p.budget) || 0;
          const budgetUsedPct = budget > 0 ? (costs / budget) * 100 : 0;

          return {
            name: p.name || 'Unnamed Project',
            client_name: p.client_name || null,
            revenue,
            costs,
            margin,
            marginPct,
            budget,
            budgetUsedPct,
          };
        });

        // Sort by margin descending
        rows.sort((a, b) => b.margin - a.margin);
        setData(rows);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load project profitability data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const totals = useMemo(() => {
    const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
    const totalCosts = data.reduce((s, r) => s + r.costs, 0);
    const totalMargin = totalRevenue - totalCosts;
    const overallMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;
    return { totalRevenue, totalCosts, totalMargin, overallMarginPct, count: data.length };
  }, [data]);

  const marginColor = (pct: number) => {
    if (pct > 20) return 'text-accent-income';
    if (pct >= 0) return 'text-accent-warning';
    return 'text-accent-expense';
  };

  const handlePrint = () => {
    const rows = data.map((r) => {
      const mc = r.marginPct > 20 ? 'text-green' : r.marginPct >= 0 ? 'text-dark' : 'text-red';
      return `<tr>
        <td>${r.name}</td>
        <td>${r.client_name || '—'}</td>
        <td class="text-right font-mono">${formatCurrency(r.revenue)}</td>
        <td class="text-right font-mono">${formatCurrency(r.costs)}</td>
        <td class="text-right font-mono ${mc}">${formatCurrency(r.margin)}</td>
        <td class="text-right ${mc}">${r.marginPct.toFixed(1)}%</td>
        <td class="text-right font-mono">${r.budget > 0 ? formatCurrency(r.budget) : '—'}</td>
        <td class="text-right">${r.budget > 0 ? r.budgetUsedPct.toFixed(0) + '%' : '—'}</td>
      </tr>`;
    }).join('');

    const html = `<div class="rpt-page">
      <div class="rpt-hdr"><div><div class="rpt-co">${activeCompany?.name || 'Company'}</div><div class="rpt-co-sub">Project Profitability</div></div><div class="rpt-badge">All Time</div></div>
      <div class="rpt-stats">
        <div class="rpt-stat"><div class="rpt-stat-label">Total Revenue</div><div class="rpt-stat-val">${formatCurrency(totals.totalRevenue)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Total Costs</div><div class="rpt-stat-val">${formatCurrency(totals.totalCosts)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Overall Margin</div><div class="rpt-stat-val">${formatCurrency(totals.totalMargin)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Projects</div><div class="rpt-stat-val">${totals.count}</div></div>
      </div>
      <table><thead><tr><th>Project</th><th>Client</th><th class="text-right">Revenue</th><th class="text-right">Costs</th><th class="text-right">Margin</th><th class="text-right">Margin %</th><th class="text-right">Budget</th><th class="text-right">Budget Used</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="rpt-total"><td>Total</td><td></td><td class="text-right font-mono">${formatCurrency(totals.totalRevenue)}</td><td class="text-right font-mono">${formatCurrency(totals.totalCosts)}</td><td class="text-right font-mono">${formatCurrency(totals.totalMargin)}</td><td class="text-right">${totals.overallMarginPct.toFixed(1)}%</td><td></td><td></td></tr></tfoot></table>
      <div class="rpt-footer"><span>Generated ${new Date().toLocaleDateString()}</span><span>Business Accounting Pro</span></div>
    </div>`;
    api.printPreview(html, 'Project Profitability');
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between" style={{ borderRadius: '6px' }}>
        <div className="text-xs text-text-muted">All projects, all time</div>
        <button onClick={handlePrint} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" style={{ borderRadius: '6px' }} title="Print">
          <Printer size={15} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue', value: formatCurrency(totals.totalRevenue), accent: 'text-accent-income' },
          { label: 'Total Costs', value: formatCurrency(totals.totalCosts), accent: 'text-accent-expense' },
          { label: 'Overall Margin', value: `${formatCurrency(totals.totalMargin)} (${totals.overallMarginPct.toFixed(1)}%)`, accent: marginColor(totals.overallMarginPct) },
          { label: 'Projects', value: String(totals.count), accent: 'text-accent-blue' },
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
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">No projects found.</div>
      ) : (
        <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary border-b border-border-primary">
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Project</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Client</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Revenue</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Costs</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Margin</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Margin %</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Budget</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Budget Used</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={row.name + i} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                  <td className="px-4 py-2 text-xs text-text-primary font-medium">{row.name}</td>
                  <td className="px-4 py-2 text-xs text-text-secondary">{row.client_name || '—'}</td>
                  <td className="text-right px-4 py-2 text-xs text-text-primary font-mono">{formatCurrency(row.revenue)}</td>
                  <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{formatCurrency(row.costs)}</td>
                  <td className={`text-right px-4 py-2 text-xs font-mono font-semibold ${marginColor(row.marginPct)}`}>{formatCurrency(row.margin)}</td>
                  <td className={`text-right px-4 py-2 text-xs font-semibold ${marginColor(row.marginPct)}`}>{row.marginPct.toFixed(1)}%</td>
                  <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{row.budget > 0 ? formatCurrency(row.budget) : '—'}</td>
                  <td className="text-right px-4 py-2 text-xs">
                    {row.budget > 0 ? (
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                          <div
                            className={`h-full transition-all duration-500 ${row.budgetUsedPct > 100 ? 'bg-accent-expense' : row.budgetUsedPct > 80 ? 'bg-accent-warning' : 'bg-accent-income'}`}
                            style={{ width: `${Math.min(row.budgetUsedPct, 100)}%`, borderRadius: '6px' }}
                          />
                        </div>
                        <span className="text-text-muted font-mono">{row.budgetUsedPct.toFixed(0)}%</span>
                      </div>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                <td className="px-4 py-2 text-xs font-bold text-text-primary">Total</td>
                <td className="px-4 py-2"></td>
                <td className="text-right px-4 py-2 text-xs font-bold text-accent-income font-mono">{formatCurrency(totals.totalRevenue)}</td>
                <td className="text-right px-4 py-2 text-xs font-bold text-accent-expense font-mono">{formatCurrency(totals.totalCosts)}</td>
                <td className={`text-right px-4 py-2 text-xs font-bold font-mono ${marginColor(totals.overallMarginPct)}`}>{formatCurrency(totals.totalMargin)}</td>
                <td className={`text-right px-4 py-2 text-xs font-bold ${marginColor(totals.overallMarginPct)}`}>{totals.overallMarginPct.toFixed(1)}%</td>
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

export default ProjectProfitability;
