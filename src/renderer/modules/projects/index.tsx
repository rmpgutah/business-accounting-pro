import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, FolderKanban, TrendingUp, Plus, Clock, FileText,
  AlertTriangle, CheckCircle2, Activity, DollarSign, Percent, Briefcase,
} from 'lucide-react';
import ProjectList from './ProjectList';
import ProjectForm from './ProjectForm';
import ProjectDetail from './ProjectDetail';
import { useAppStore } from '../../stores/appStore';
import { useCompanyStore } from '../../stores/companyStore';
import api from '../../lib/api';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';

// ─── View State ─────────────────────────────────────────
type Tab = 'dashboard' | 'projects' | 'profitability';
type View =
  | { type: 'list' }
  | { type: 'form'; projectId?: string }
  | { type: 'detail'; projectId: string };

// ─── Types ──────────────────────────────────────────────
interface ProjectProfitRow {
  id: string;
  name: string;
  client_name: string | null;
  budget: number;
  status: string;
  revenue: number;
  expense_costs: number;
  labor_costs: number;
}

interface RecentTimeEntry {
  id: string;
  project_name: string | null;
  employee_name: string | null;
  duration_minutes: number;
  entry_date: string | null;
  is_billable: number | null;
}

// ─── Dashboard ──────────────────────────────────────────
const ProjectsDashboard: React.FC<{
  onNewProject: () => void;
  onSwitchTab: (tab: Tab) => void;
}> = ({ onNewProject, onSwitchTab }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [profitRows, setProfitRows] = useState<ProjectProfitRow[]>([]);
  const [recentTime, setRecentTime] = useState<RecentTimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        const profitSql = `
          SELECT p.id, p.name, c.name AS client_name, p.budget, p.status,
            COALESCE((SELECT SUM(amount) FROM invoice_line_items WHERE project_id = p.id), 0) AS revenue,
            COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = p.id), 0) AS expense_costs,
            COALESCE((SELECT SUM(duration_minutes * COALESCE(hourly_rate, 0) / 60.0) FROM time_entries WHERE project_id = p.id), 0) AS labor_costs
          FROM projects p
          LEFT JOIN clients c ON p.client_id = c.id
          WHERE p.company_id = ?
          ORDER BY p.created_at DESC
        `;
        const recentTimeSql = `
          SELECT t.id, p.name AS project_name, e.name AS employee_name,
            t.duration_minutes, t.entry_date, t.is_billable
          FROM time_entries t
          LEFT JOIN projects p ON t.project_id = p.id
          LEFT JOIN employees e ON t.employee_id = e.id
          WHERE t.company_id = ?
          ORDER BY t.entry_date DESC, t.created_at DESC
          LIMIT 10
        `;
        const [profit, time] = await Promise.all([
          api.rawQuery(profitSql, [activeCompany.id]).catch(() => []),
          api.rawQuery(recentTimeSql, [activeCompany.id]).catch(() => []),
        ]);
        if (cancelled) return;
        setProfitRows(Array.isArray(profit) ? profit : []);
        setRecentTime(Array.isArray(time) ? time : []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const kpis = useMemo(() => {
    const active = profitRows.filter((p) => p.status === 'active').length;
    const totalRevenue = profitRows.reduce((s, p) => s + (Number(p.revenue) || 0), 0);
    const totalCosts = profitRows.reduce((s, p) => s + (Number(p.expense_costs) || 0) + (Number(p.labor_costs) || 0), 0);
    const totalProfit = totalRevenue - totalCosts;
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const overBudget = profitRows.filter((p) => {
      const cost = (Number(p.expense_costs) || 0) + (Number(p.labor_costs) || 0);
      return Number(p.budget) > 0 && cost > Number(p.budget);
    }).length;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    // Approximate "completed this month" via status; without an updated_at we just count completed
    const completedThisMonth = profitRows.filter((p) => p.status === 'completed').length;
    return { active, totalRevenue, totalCosts, avgMargin, overBudget, completedThisMonth, monthStart };
  }, [profitRows]);

  const topProfitable = useMemo(() => {
    return [...profitRows]
      .map((p) => {
        const costs = (Number(p.expense_costs) || 0) + (Number(p.labor_costs) || 0);
        const revenue = Number(p.revenue) || 0;
        const margin = revenue > 0 ? ((revenue - costs) / revenue) * 100 : 0;
        return { ...p, costs, margin, revenue };
      })
      .sort((a, b) => (b.revenue - b.costs) - (a.revenue - a.costs))
      .slice(0, 5);
  }, [profitRows]);

  const atRisk = useMemo(() => {
    return profitRows
      .map((p) => {
        const costs = (Number(p.expense_costs) || 0) + (Number(p.labor_costs) || 0);
        const budget = Number(p.budget) || 0;
        const usage = budget > 0 ? costs / budget : 0;
        return { ...p, costs, usage };
      })
      .filter((p) => p.usage >= 0.8 && Number(p.budget) > 0)
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 8);
  }, [profitRows]);

  const statusDist = useMemo(() => {
    const counts: Record<string, number> = { active: 0, on_hold: 0, completed: 0, archived: 0 };
    for (const p of profitRows) {
      counts[p.status] = (counts[p.status] || 0) + 1;
    }
    const total = profitRows.length || 1;
    return [
      { key: 'active', label: 'Active', count: counts.active, color: '#22c55e' },
      { key: 'on_hold', label: 'On Hold', count: counts.on_hold, color: '#eab308' },
      { key: 'completed', label: 'Completed', count: counts.completed, color: '#3b82f6' },
      { key: 'archived', label: 'Archived', count: counts.archived, color: '#6b7280' },
    ].map((s) => ({ ...s, pct: (s.count / total) * 100 }));
  }, [profitRows]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {error && (
        <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20" style={{ borderRadius: '6px' }}>
          {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Active Projects', value: String(kpis.active), icon: <Activity size={16} />, color: 'text-accent-blue' },
          { label: 'Total Revenue', value: formatCurrency(kpis.totalRevenue), icon: <DollarSign size={16} />, color: 'text-accent-income' },
          { label: 'Total Costs', value: formatCurrency(kpis.totalCosts), icon: <DollarSign size={16} />, color: 'text-accent-expense' },
          { label: 'Avg Margin', value: `${kpis.avgMargin.toFixed(1)}%`, icon: <Percent size={16} />, color: kpis.avgMargin >= 20 ? 'text-accent-income' : kpis.avgMargin >= 0 ? 'text-accent-warning' : 'text-accent-expense' },
          { label: 'Over-Budget', value: String(kpis.overBudget), icon: <AlertTriangle size={16} />, color: kpis.overBudget > 0 ? 'text-accent-expense' : 'text-text-muted' },
          { label: 'Completed', value: String(kpis.completedThisMonth), icon: <CheckCircle2 size={16} />, color: 'text-accent-blue' },
        ].map((k) => (
          <div key={k.label} className="block-card p-3" style={{ borderRadius: '6px' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className={k.color}>{k.icon}</span>
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{k.label}</span>
            </div>
            <div className="text-lg font-bold text-text-primary font-mono">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="block-card p-3 flex items-center gap-2" style={{ borderRadius: '6px' }}>
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mr-2">Quick Actions:</span>
        <button className="block-btn-primary inline-flex items-center gap-1.5 text-xs" onClick={onNewProject}>
          <Plus size={12} /> New Project
        </button>
        <button className="block-btn inline-flex items-center gap-1.5 text-xs" onClick={() => onSwitchTab('projects')}>
          <Clock size={12} /> Log Time
        </button>
        <button className="block-btn inline-flex items-center gap-1.5 text-xs" onClick={() => onSwitchTab('profitability')}>
          <FileText size={12} /> View Reports
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Profitable */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
            <TrendingUp size={14} className="text-accent-income" /> Top 5 Most Profitable
          </h3>
          {topProfitable.length === 0 ? (
            <p className="text-xs text-text-muted">No project data yet.</p>
          ) : (
            <table className="block-table w-full text-xs">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Client</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Costs</th>
                  <th className="text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {topProfitable.map((p) => (
                  <tr key={p.id}>
                    <td className="text-text-primary font-medium truncate max-w-[140px]">{p.name}</td>
                    <td className="text-text-secondary truncate max-w-[120px]">{p.client_name || '—'}</td>
                    <td className="text-right font-mono text-accent-income">{formatCurrency(p.revenue)}</td>
                    <td className="text-right font-mono text-accent-expense">{formatCurrency(p.costs)}</td>
                    <td className={`text-right font-mono font-bold ${p.margin >= 20 ? 'text-accent-income' : p.margin >= 0 ? 'text-accent-warning' : 'text-accent-expense'}`}>
                      {p.margin.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* At Risk */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-accent-expense" /> At-Risk Projects (&gt; 80% Budget)
          </h3>
          {atRisk.length === 0 ? (
            <p className="text-xs text-text-muted">No at-risk projects.</p>
          ) : (
            <table className="block-table w-full text-xs">
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="text-right">Budget</th>
                  <th className="text-right">Spent</th>
                  <th className="text-right">Used %</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((p) => (
                  <tr key={p.id}>
                    <td className="text-text-primary font-medium truncate max-w-[160px]">{p.name}</td>
                    <td className="text-right font-mono text-text-secondary">{formatCurrency(p.budget)}</td>
                    <td className="text-right font-mono text-text-secondary">{formatCurrency(p.costs)}</td>
                    <td className={`text-right font-mono font-bold ${p.usage >= 1 ? 'text-accent-expense' : 'text-accent-warning'}`}>
                      {(p.usage * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Time Logged */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
            <Clock size={14} className="text-accent-blue" /> Recent Time Logged
          </h3>
          {recentTime.length === 0 ? (
            <p className="text-xs text-text-muted">No time entries yet.</p>
          ) : (
            <div className="space-y-1">
              {recentTime.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-border-primary/40 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-text-primary font-medium truncate">{t.project_name || '—'}</div>
                    <div className="text-text-muted text-[10px] truncate">
                      {t.employee_name || 'Unknown'} · {formatDate(t.entry_date)}
                      {t.is_billable ? ' · Billable' : ''}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-text-primary text-xs whitespace-nowrap">
                    {((t.duration_minutes || 0) / 60).toFixed(1)}h
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status Distribution */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
            <Briefcase size={14} className="text-accent-blue" /> Project Status Distribution
          </h3>
          <div className="space-y-2">
            {statusDist.map((s) => (
              <div key={s.key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text-secondary">{s.label}</span>
                  <span className="font-mono text-text-muted">{s.count} ({s.pct.toFixed(0)}%)</span>
                </div>
                <div className="w-full h-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                  <div className="h-full transition-all" style={{ width: `${s.pct}%`, backgroundColor: s.color, borderRadius: '6px' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Profitability Tab ──────────────────────────────────
const ProfitabilityTab: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [rows, setRows] = useState<ProjectProfitRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      try {
        const sql = `
          SELECT p.id, p.name, c.name AS client_name, p.budget, p.status,
            COALESCE((SELECT SUM(amount) FROM invoice_line_items WHERE project_id = p.id), 0) AS revenue,
            COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = p.id), 0) AS expense_costs,
            COALESCE((SELECT SUM(duration_minutes * COALESCE(hourly_rate, 0) / 60.0) FROM time_entries WHERE project_id = p.id), 0) AS labor_costs
          FROM projects p
          LEFT JOIN clients c ON p.client_id = c.id
          WHERE p.company_id = ?
          ORDER BY p.name
        `;
        const data = await api.rawQuery(sql, [activeCompany.id]).catch(() => []);
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const handlePrint = async () => {
    const totalRevenue = rows.reduce((s, p) => s + (Number(p.revenue) || 0), 0);
    const totalCosts = rows.reduce((s, p) => s + (Number(p.expense_costs) || 0) + (Number(p.labor_costs) || 0), 0);
    const totalProfit = totalRevenue - totalCosts;

    const html = `
      <html><head><title>Project Profitability Report</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 20px; color: #111; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }
        th { background: #f5f5f5; font-weight: 700; text-transform: uppercase; font-size: 10px; }
        td.num, th.num { text-align: right; font-family: ui-monospace, Menlo, monospace; }
        tfoot td { font-weight: 700; border-top: 2px solid #333; }
        .pos { color: #16a34a; }
        .neg { color: #dc2626; }
      </style></head><body>
      <h1>Project Profitability Report</h1>
      <div class="sub">${activeCompany?.name || ''} · Generated ${new Date().toLocaleDateString()}</div>
      <table>
        <thead><tr>
          <th>Project</th><th>Client</th><th>Status</th>
          <th class="num">Budget</th><th class="num">Revenue</th>
          <th class="num">Expense</th><th class="num">Labor</th>
          <th class="num">Profit</th><th class="num">Margin %</th>
        </tr></thead>
        <tbody>
          ${rows.map((p) => {
            const rev = Number(p.revenue) || 0;
            const exp = Number(p.expense_costs) || 0;
            const lab = Number(p.labor_costs) || 0;
            const profit = rev - exp - lab;
            const margin = rev > 0 ? (profit / rev) * 100 : 0;
            return `<tr>
              <td>${p.name}</td>
              <td>${p.client_name || '—'}</td>
              <td>${p.status}</td>
              <td class="num">${formatCurrency(p.budget)}</td>
              <td class="num">${formatCurrency(rev)}</td>
              <td class="num">${formatCurrency(exp)}</td>
              <td class="num">${formatCurrency(lab)}</td>
              <td class="num ${profit >= 0 ? 'pos' : 'neg'}">${formatCurrency(profit)}</td>
              <td class="num ${margin >= 0 ? 'pos' : 'neg'}">${margin.toFixed(1)}%</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="4">Totals</td>
          <td class="num">${formatCurrency(totalRevenue)}</td>
          <td class="num" colspan="2">${formatCurrency(totalCosts)}</td>
          <td class="num ${totalProfit >= 0 ? 'pos' : 'neg'}">${formatCurrency(totalProfit)}</td>
          <td class="num">${totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0.0'}%</td>
        </tr></tfoot>
      </table>
      </body></html>
    `;
    try {
      await api.printPreview(html, 'Project Profitability Report');
    } catch (err) {
      console.error('Print failed:', err);
    }
  };

  if (loading) {
    return <div className="p-6 text-text-muted text-sm font-mono">Loading profitability data...</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Project Profitability</h2>
          <p className="text-xs text-text-muted mt-0.5">Revenue, costs and margins for every project.</p>
        </div>
        <button className="block-btn-primary inline-flex items-center gap-1.5 text-xs" onClick={handlePrint}>
          <FileText size={12} /> Print Report
        </button>
      </div>

      <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
        <table className="block-table w-full text-xs">
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Status</th>
              <th className="text-right">Budget</th>
              <th className="text-right">Revenue</th>
              <th className="text-right">Costs</th>
              <th className="text-right">Profit</th>
              <th className="text-right">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const rev = Number(p.revenue) || 0;
              const costs = (Number(p.expense_costs) || 0) + (Number(p.labor_costs) || 0);
              const profit = rev - costs;
              const margin = rev > 0 ? (profit / rev) * 100 : 0;
              return (
                <tr key={p.id}>
                  <td className="text-text-primary font-medium">{p.name}</td>
                  <td className="text-text-secondary">{p.client_name || '—'}</td>
                  <td><span className={formatStatus(p.status).className}>{formatStatus(p.status).label}</span></td>
                  <td className="text-right font-mono text-text-secondary">{formatCurrency(p.budget)}</td>
                  <td className="text-right font-mono text-accent-income">{formatCurrency(rev)}</td>
                  <td className="text-right font-mono text-accent-expense">{formatCurrency(costs)}</td>
                  <td className={`text-right font-mono font-bold ${profit >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                    {formatCurrency(profit)}
                  </td>
                  <td className={`text-right font-mono font-bold ${margin >= 20 ? 'text-accent-income' : margin >= 0 ? 'text-accent-warning' : 'text-accent-expense'}`}>
                    {margin.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Module Root ────────────────────────────────────────
const ProjectsModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [view, setView] = useState<View>({ type: 'list' });
  const [refreshKey, setRefreshKey] = useState(0);

  // Cross-module deep link consumption.
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('project');
    if (focus) {
      setTab('projects');
      setView({ type: 'detail', projectId: focus.id });
    }
  }, [consumeFocusEntity]);

  const goToList = useCallback(() => {
    setView({ type: 'list' });
    setRefreshKey((k) => k + 1);
  }, []);

  const goToNew = useCallback(() => {
    setTab('projects');
    setView({ type: 'form' });
  }, []);

  const goToEdit = useCallback((projectId: string) => {
    setView({ type: 'form', projectId });
  }, []);

  const goToDetail = useCallback((projectId: string) => {
    setView({ type: 'detail', projectId });
  }, []);

  const handleSaved = useCallback(() => {
    setView({ type: 'list' });
    setRefreshKey((k) => k + 1);
  }, []);

  // ─── Render Detail (full take-over) ──────────────────
  if (tab === 'projects' && view.type === 'detail') {
    return (
      <ProjectDetail
        projectId={view.projectId}
        onBack={goToList}
        onEdit={goToEdit}
      />
    );
  }

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={13} /> },
    { key: 'projects', label: 'Projects', icon: <FolderKanban size={13} /> },
    { key: 'profitability', label: 'Profitability', icon: <TrendingUp size={13} /> },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {/* Tab Bar */}
      <div className="flex border-b border-border-primary px-6 pt-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <ProjectsDashboard onNewProject={goToNew} onSwitchTab={setTab} />}
      {tab === 'profitability' && <ProfitabilityTab />}
      {tab === 'projects' && (
        <>
          <ProjectList
            key={refreshKey}
            onSelectProject={goToDetail}
            onNewProject={goToNew}
          />
          {view.type === 'form' && (
            <ProjectForm
              projectId={view.projectId ?? null}
              onClose={goToList}
              onSaved={handleSaved}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ProjectsModule;
