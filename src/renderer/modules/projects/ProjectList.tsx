import React, { useEffect, useState, useMemo } from 'react';
import {
  Plus, Clock, Search, FolderOpen, Trash2, FileText, Activity, DollarSign, Percent, CheckCircle2, TrendingUp,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import EntityChip from '../../components/EntityChip';
import {
  PROJECT_PHASE, PROJECT_PHASE_ORDER, PROJECT_PRIORITY, PROJECT_HEALTH, PROJECT_TYPE, PROJECT_METHODOLOGY,
  ClassificationBadge,
} from '../../lib/classifications';

// ─── Types ──────────────────────────────────────────────
interface Project {
  id: string;
  name: string;
  client_id: string;
  description: string;
  status: 'active' | 'completed' | 'on_hold' | 'archived';
  budget: number;
  budget_type: 'fixed' | 'hourly' | 'none';
  hourly_rate: number;
  start_date: string;
  end_date: string;
  tags: string;
  phase?: string;
  methodology?: string;
  project_type?: string;
  priority?: string;
  health?: string;
}

interface Client {
  id: string;
  name: string;
}

type StatusFilter = 'all' | 'active' | 'completed' | 'on_hold' | 'archived';

interface ProjectListProps {
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'archived', label: 'Archived' },
];

// ─── Budget Progress Bar ────────────────────────────────
const BudgetBar: React.FC<{ spent: number; budget: number }> = ({ spent, budget }) => {
  if (!budget || budget <= 0) {
    return <span className="text-[10px] text-text-muted font-mono">No budget</span>;
  }

  const pct = Math.min((spent / budget) * 100, 100);
  const barColor =
    pct > 90 ? '#ef4444' : pct > 75 ? '#eab308' : '#22c55e';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-text-secondary">{formatCurrency(spent)}</span>
        <span className="text-text-muted">/ {formatCurrency(budget)}</span>
      </div>
      <div
        className="w-full h-1.5 bg-bg-tertiary overflow-hidden"
        style={{ borderRadius: '1px' }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: barColor,
            borderRadius: '1px',
          }}
        />
      </div>
    </div>
  );
};

// ─── Date Formatter ─────────────────────────────────────
// ─── Component ──────────────────────────────────────────
const ProjectList: React.FC<ProjectListProps> = ({ onSelectProject, onNewProject }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [expenses, setExpenses] = useState<Record<string, number>>({});
  const [timeEntries, setTimeEntries] = useState<Record<string, number>>({});
  const [labor, setLabor] = useState<Record<string, number>>({});
  const [revenue, setRevenue] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [loadError, setLoadError] = useState('');

  // ─── Load Data ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoading(true);
        setLoadError('');
        // Perf: aggregate in SQL instead of pulling every expense/time_entry
        // row into the renderer (was OOM-territory on long-running companies).
        const [projectRows, clientRows, expAggRows, timeAggRows, laborAggRows, revenueAggRows] = await Promise.all([
          api.query('projects', { company_id: activeCompany.id }),
          api.query('clients', { company_id: activeCompany.id }),
          api.rawQuery(
            `SELECT project_id, COALESCE(SUM(amount), 0) AS total
               FROM expenses
              WHERE company_id = ? AND project_id IS NOT NULL
              GROUP BY project_id`,
            [activeCompany.id]
          ).catch(() => []),
          api.rawQuery(
            `SELECT project_id, COALESCE(SUM(duration_minutes), 0) AS total_minutes
               FROM time_entries
              WHERE company_id = ? AND project_id IS NOT NULL
              GROUP BY project_id`,
            [activeCompany.id]
          ).catch(() => []),
          api.rawQuery(
            `SELECT project_id, COALESCE(SUM(duration_minutes * COALESCE(hourly_rate, 0) / 60.0), 0) AS labor_cost
               FROM time_entries
              WHERE company_id = ? AND project_id IS NOT NULL
              GROUP BY project_id`,
            [activeCompany.id]
          ).catch(() => []),
          api.rawQuery(
            `SELECT project_id, COALESCE(SUM(amount), 0) AS total
               FROM invoice_line_items
              WHERE project_id IS NOT NULL
              GROUP BY project_id`,
            []
          ).catch(() => []),
        ]);
        if (cancelled) return;

        setProjects(Array.isArray(projectRows) ? projectRows : []);
        setClients(Array.isArray(clientRows) ? clientRows : []);

        const expMap: Record<string, number> = {};
        if (Array.isArray(expAggRows)) {
          for (const r of expAggRows) expMap[r.project_id] = r.total ?? 0;
        }
        setExpenses(expMap);

        const timeMap: Record<string, number> = {};
        if (Array.isArray(timeAggRows)) {
          for (const r of timeAggRows) timeMap[r.project_id] = (r.total_minutes ?? 0) / 60;
        }
        setTimeEntries(timeMap);

        const laborMap: Record<string, number> = {};
        if (Array.isArray(laborAggRows)) {
          for (const r of laborAggRows) laborMap[r.project_id] = Number(r.labor_cost) || 0;
        }
        setLabor(laborMap);

        const revMap: Record<string, number> = {};
        if (Array.isArray(revenueAggRows)) {
          for (const r of revenueAggRows) revMap[r.project_id] = Number(r.total) || 0;
        }
        setRevenue(revMap);
      } catch (err: any) {
        console.error('Failed to load projects:', err);
        if (!cancelled) {
          setProjects([]);
          setLoadError(err?.message || 'Failed to load projects');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ─── Client lookup ────────────────────────────────────
  const clientMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clients) {
      map[c.id] = c.name;
    }
    return map;
  }, [clients]);

  // ─── Filtered List ────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...projects];

    if (statusFilter !== 'all') {
      list = list.filter((p) => p.status === statusFilter);
    }

    if (clientFilter !== 'all') {
      list = list.filter((p) => p.client_id === clientFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          (clientMap[p.client_id] ?? '').toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.tags?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [projects, statusFilter, clientFilter, searchQuery, clientMap]);

  // ─── KPIs ────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active = projects.filter((p) => p.status === 'active').length;
    const completed = projects.filter((p) => p.status === 'completed').length;
    const totalRevenue = projects.reduce((s, p) => s + (revenue[p.id] || 0), 0);
    const totalCosts = projects.reduce((s, p) => s + (expenses[p.id] || 0) + (labor[p.id] || 0), 0);
    const profit = totalRevenue - totalCosts;
    const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
    const totalHours = projects.reduce((s, p) => s + (timeEntries[p.id] || 0), 0);
    const completionRate = projects.length > 0 ? (completed / projects.length) * 100 : 0;
    return { active, totalRevenue, totalCosts, margin, totalHours, completionRate };
  }, [projects, revenue, expenses, labor, timeEntries]);

  // ─── Print Project Register ───────────────────────────
  const handlePrintRegister = async () => {
    const rows = filtered.map((p) => {
      const rev = revenue[p.id] || 0;
      const exp = expenses[p.id] || 0;
      const lab = labor[p.id] || 0;
      const hours = timeEntries[p.id] || 0;
      const profit = rev - exp - lab;
      const margin = rev > 0 ? (profit / rev) * 100 : 0;
      return { p, rev, exp, lab, hours, profit, margin };
    });
    const totalRev = rows.reduce((s, r) => s + r.rev, 0);
    const totalCost = rows.reduce((s, r) => s + r.exp + r.lab, 0);
    const totalProfit = totalRev - totalCost;
    const html = `
      <html><head><title>Project Register</title>
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
      <h1>Project Register</h1>
      <div class="sub">${activeCompany?.name || ''} · Generated ${new Date().toLocaleDateString()}</div>
      <table>
        <thead><tr>
          <th>Project</th><th>Client</th><th>Status</th>
          <th class="num">Budget</th><th class="num">Hours</th>
          <th class="num">Revenue</th><th class="num">Costs</th>
          <th class="num">Profit</th><th class="num">Margin %</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td>${r.p.name}</td>
            <td>${clientMap[r.p.client_id] || '—'}</td>
            <td>${r.p.status}</td>
            <td class="num">${formatCurrency(r.p.budget)}</td>
            <td class="num">${r.hours.toFixed(1)}</td>
            <td class="num">${formatCurrency(r.rev)}</td>
            <td class="num">${formatCurrency(r.exp + r.lab)}</td>
            <td class="num ${r.profit >= 0 ? 'pos' : 'neg'}">${formatCurrency(r.profit)}</td>
            <td class="num ${r.margin >= 0 ? 'pos' : 'neg'}">${r.margin.toFixed(1)}%</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="5">Totals</td>
          <td class="num">${formatCurrency(totalRev)}</td>
          <td class="num">${formatCurrency(totalCost)}</td>
          <td class="num ${totalProfit >= 0 ? 'pos' : 'neg'}">${formatCurrency(totalProfit)}</td>
          <td class="num">${totalRev > 0 ? ((totalProfit / totalRev) * 100).toFixed(1) : '0.0'}%</td>
        </tr></tfoot>
      </table>
      </body></html>
    `;
    try {
      await api.printPreview(html, 'Project Register');
    } catch (err) {
      console.error('Print failed:', err);
    }
  };

  // ─── Status Tab Counts ────────────────────────────────
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: projects.length };
    for (const p of projects) {
      counts[p.status] = (counts[p.status] ?? 0) + 1;
    }
    return counts;
  }, [projects]);

  // ─── Selection ────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(item => item.id)));
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} project${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBatchDeleting(true);
    try {
      for (const id of selectedIds) {
        await api.remove('projects', id);
      }
      setSelectedIds(new Set());
      setProjects(prev => prev.filter(p => !selectedIds.has(p.id)));
    } catch (err: any) {
      console.error('Failed to batch delete projects:', err);
      alert('Failed to delete projects: ' + (err?.message || 'Unknown error'));
    } finally {
      setBatchDeleting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {loadError && <ErrorBanner message={loadError} title="Failed to load projects" onDismiss={() => setLoadError('')} />}
      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Projects & Job Costing</h1>
        <div className="module-actions flex gap-2">
          <button
            className="block-btn inline-flex items-center gap-1.5"
            onClick={handlePrintRegister}
          >
            <FileText size={14} />
            Print Register
          </button>
          <button
            className="block-btn-primary inline-flex items-center gap-1.5"
            onClick={onNewProject}
          >
            <Plus size={14} />
            New Project
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Active', value: String(kpis.active), icon: <Activity size={14} />, color: 'text-accent-blue' },
          { label: 'Revenue', value: formatCurrency(kpis.totalRevenue), icon: <DollarSign size={14} />, color: 'text-accent-income' },
          { label: 'Costs', value: formatCurrency(kpis.totalCosts), icon: <DollarSign size={14} />, color: 'text-accent-expense' },
          { label: 'Margin', value: `${kpis.margin.toFixed(1)}%`, icon: <Percent size={14} />, color: kpis.margin >= 20 ? 'text-accent-income' : kpis.margin >= 0 ? 'text-accent-warning' : 'text-accent-expense' },
          { label: 'Hours', value: kpis.totalHours.toFixed(1), icon: <Clock size={14} />, color: 'text-text-primary' },
          { label: 'Completion', value: `${kpis.completionRate.toFixed(0)}%`, icon: <CheckCircle2 size={14} />, color: 'text-accent-blue' },
        ].map((k) => (
          <div key={k.label} className="block-card p-3" style={{ borderRadius: '6px' }}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={k.color}>{k.icon}</span>
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{k.label}</span>
            </div>
            <div className="text-base font-bold text-text-primary font-mono">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              statusFilter === tab.key
                ? 'bg-accent-blue text-white'
                : 'bg-bg-secondary text-text-muted hover:text-text-primary transition-colors'
            }`}
            style={{ borderRadius: '6px' }}
          >
            {tab.label}
            <span className="ml-1.5 opacity-60">
              {tabCounts[tab.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Search + Client Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="block-input pl-8 w-full"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="block-select"
          style={{ width: 'auto', minWidth: '180px' }}
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
        >
          <option value="all">All Clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="block-card p-3 flex items-center justify-between" style={{ borderRadius: '6px', borderColor: 'rgba(59,130,246,0.3)' }}>
          <span className="text-xs font-semibold text-text-primary">
            {selectedIds.size} project{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              className="block-btn text-xs"
              onClick={toggleSelectAll}
            >
              {selectedIds.size === filtered.length ? 'Deselect All' : 'Select All'}
            </button>
            <button
              className="block-btn-danger flex items-center gap-1.5 text-xs"
              onClick={handleBatchDelete}
              disabled={batchDeleting}
            >
              <Trash2 size={12} />
              {batchDeleting ? 'Deleting...' : 'Delete Selected'}
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm text-text-muted font-mono">Loading projects...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3">
          <EmptyState
            icon={FolderOpen}
            message={projects.length === 0 ? 'No projects yet' : 'No projects match your search or filter'}
          />
          {projects.length === 0 ? (
            <button
              className="block-btn-primary inline-flex items-center gap-1.5"
              onClick={onNewProject}
            >
              <Plus size={14} />
              Create Project
            </button>
          ) : (
            <button
              className="block-btn text-xs"
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((project) => {
            const spent = expenses[project.id] ?? 0;
            const hours = timeEntries[project.id] ?? 0;
            const labCost = labor[project.id] ?? 0;
            const rev = revenue[project.id] ?? 0;
            const totalCost = spent + labCost;
            const profit = rev - totalCost;
            const margin = rev > 0 ? (profit / rev) * 100 : 0;
            const marginColor = margin >= 20 ? '#22c55e' : margin >= 0 ? '#eab308' : '#ef4444';
            const budgetUsed = project.budget && project.budget > 0 ? (totalCost / project.budget) * 100 : 0;
            const clientName = clientMap[project.client_id] ?? '--';

            return (
              <div
                key={project.id}
                className="block-card p-0 overflow-hidden cursor-pointer hover:bg-bg-hover transition-colors"
                style={{ borderRadius: '6px' }}
                onClick={() => onSelectProject(project.id)}
              >
                {/* Card Header */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(project.id)}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(project.id); }}
                        onClick={(e) => e.stopPropagation()}
                        className="cursor-pointer mt-0.5 flex-shrink-0"
                        style={{ accentColor: '#3b82f6' }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {/* Margin health dot */}
                          <span
                            title={`Margin ${margin.toFixed(1)}%`}
                            style={{
                              display: 'inline-block',
                              width: 8, height: 8,
                              borderRadius: '50%',
                              backgroundColor: marginColor,
                              flexShrink: 0,
                            }}
                          />
                          <h3 className="text-sm font-semibold text-text-primary truncate">
                            {project.name}
                          </h3>
                        </div>
                        <p className="text-xs text-text-muted truncate mt-0.5" onClick={(e) => e.stopPropagation()}>
                          {project.client_id ? <EntityChip type="client" id={project.client_id} label={clientName} variant="inline" /> : clientName}
                        </p>
                      </div>
                    </div>
                    <span className={formatStatus(project.status).className}>
                      {formatStatus(project.status).label}
                    </span>
                  </div>

                  {/* Mini financial row */}
                  <div className="flex items-center justify-between gap-2 mt-2 text-[10px] font-mono">
                    <span className="text-accent-income">Rev {formatCurrency(rev)}</span>
                    <span className="text-accent-expense">Cost {formatCurrency(totalCost)}</span>
                    <span style={{ color: marginColor }} className="font-bold">
                      <TrendingUp size={9} className="inline mr-0.5" />{margin.toFixed(1)}%
                    </span>
                  </div>

                  {/* Budget Progress */}
                  <div className="mt-3">
                    <BudgetBar spent={totalCost} budget={project.budget ?? 0} />
                    {project.budget && project.budget > 0 && (
                      <p className="text-[9px] text-text-muted font-mono mt-0.5 text-right">
                        {budgetUsed.toFixed(0)}% of budget used
                      </p>
                    )}
                  </div>

                  {/* Classification badges */}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {project.priority && <ClassificationBadge def={PROJECT_PRIORITY} value={project.priority} />}
                    {project.health && <ClassificationBadge def={PROJECT_HEALTH} value={project.health} />}
                    {project.project_type && <ClassificationBadge def={PROJECT_TYPE} value={project.project_type} />}
                    {project.methodology && <ClassificationBadge def={PROJECT_METHODOLOGY} value={project.methodology} />}
                    {project.phase && <ClassificationBadge def={PROJECT_PHASE} value={project.phase} />}
                  </div>

                  {/* Phase progress (5 steps) */}
                  {project.phase && (
                    <div className="mt-2 flex gap-0.5">
                      {PROJECT_PHASE_ORDER.map((p, idx) => {
                        const currentIdx = PROJECT_PHASE_ORDER.indexOf(project.phase!);
                        const filled = idx <= currentIdx;
                        return (
                          <div
                            key={p}
                            style={{
                              flex: 1,
                              height: 4,
                              borderRadius: 2,
                              background: filled ? 'var(--color-accent-blue)' : 'rgba(255,255,255,0.08)',
                            }}
                            title={p}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Card Footer */}
                <div
                  className="flex items-center justify-between px-4 py-2.5 border-t border-border-primary"
                  style={{ background: 'rgba(0,0,0,0.15)' }}
                >
                  <div className="flex items-center gap-1 text-[10px] text-text-muted font-mono">
                    <Clock size={11} />
                    <span>{hours.toFixed(1)}h</span>
                  </div>
                  <div className="text-[10px] text-text-muted font-mono">
                    {formatDate(project.start_date)}
                    {project.end_date ? ` - ${formatDate(project.end_date)}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {projects.length} project{projects.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default ProjectList;
