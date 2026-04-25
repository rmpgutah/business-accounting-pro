import React, { useEffect, useState, useMemo } from 'react';
import { FolderKanban, Plus, Clock, Search, FolderOpen, Trash2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import EntityChip from '../../components/EntityChip';

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
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
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
        const [projectRows, clientRows, expenseRows, timeRows] = await Promise.all([
          api.query('projects', { company_id: activeCompany.id }),
          api.query('clients', { company_id: activeCompany.id }),
          api.query('expenses', { company_id: activeCompany.id }),
          api.query('time_entries', { company_id: activeCompany.id }),
        ]);
        if (cancelled) return;

        setProjects(Array.isArray(projectRows) ? projectRows : []);
        setClients(Array.isArray(clientRows) ? clientRows : []);

        // Aggregate expenses by project
        const expMap: Record<string, number> = {};
        if (Array.isArray(expenseRows)) {
          for (const exp of expenseRows) {
            if (exp.project_id) {
              expMap[exp.project_id] = (expMap[exp.project_id] ?? 0) + (exp.amount ?? 0);
            }
          }
        }
        setExpenses(expMap);

        // Aggregate hours by project (time_entries has duration_minutes, not hours)
        const timeMap: Record<string, number> = {};
        if (Array.isArray(timeRows)) {
          for (const te of timeRows) {
            if (te.project_id) {
              timeMap[te.project_id] = (timeMap[te.project_id] ?? 0) + ((te.duration_minutes ?? 0) / 60);
            }
          }
        }
        setTimeEntries(timeMap);
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
  }, [projects, statusFilter, searchQuery, clientMap]);

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
        <div className="module-actions">
          <button
            className="block-btn-primary inline-flex items-center gap-1.5"
            onClick={onNewProject}
          >
            <Plus size={14} />
            New Project
          </button>
        </div>
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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          className="block-input pl-8"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
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
                        <h3 className="text-sm font-semibold text-text-primary truncate">
                          {project.name}
                        </h3>
                        <p className="text-xs text-text-muted truncate mt-0.5" onClick={(e) => e.stopPropagation()}>
                          {project.client_id ? <EntityChip type="client" id={project.client_id} label={clientName} variant="inline" /> : clientName}
                        </p>
                      </div>
                    </div>
                    <span className={formatStatus(project.status).className}>
                      {formatStatus(project.status).label}
                    </span>
                  </div>

                  {/* Budget Progress */}
                  <div className="mt-3">
                    <BudgetBar spent={spent} budget={project.budget ?? 0} />
                  </div>
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
