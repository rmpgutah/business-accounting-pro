import React, { useEffect, useState } from 'react';
import { GitBranch, Plus, Pencil, Trash2, Activity } from 'lucide-react';
import api from '../../lib/api';
import { formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';
import { EmptyState } from '../../components/EmptyState';

interface WorkflowListProps {
  onNew: () => void;
  onEdit: (id: string) => void;
}

interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: string;
  trigger_config_json: string | null;
  conditions_json: string | null;
  actions_json: string | null;
  is_active: number;
  rate_limit_per_hour?: number | null;
  requires_approval?: number | null;
  created_at: string;
  updated_at: string;
}

interface ExecutionRow {
  id: string;
  workflow_id: string;
  triggered_at: string;
  status: string;
}

function safeParseArray(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeParseObj(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

const WorkflowList: React.FC<WorkflowListProps> = ({ onNew, onEdit }) => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [lastRunMap, setLastRunMap] = useState<Record<string, string>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = (await api.listWorkflows()) as Workflow[];
      setWorkflows(rows ?? []);

      // Pull recent executions so we can show "last run" per workflow.
      try {
        const execs = (await api.workflowExecutions(undefined, 200)) as ExecutionRow[];
        const map: Record<string, string> = {};
        for (const e of execs ?? []) {
          if (!map[e.workflow_id]) map[e.workflow_id] = e.triggered_at;
        }
        setLastRunMap(map);
      } catch {
        /* swallow — last-run is best-effort */
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const handleToggleActive = async (wf: Workflow) => {
    try {
      await api.saveWorkflow({
        id: wf.id,
        name: wf.name,
        description: wf.description ?? '',
        trigger_type: wf.trigger_type,
        trigger_config: safeParseObj(wf.trigger_config_json),
        conditions: safeParseArray(wf.conditions_json),
        actions: safeParseArray(wf.actions_json),
        is_active: wf.is_active === 1 ? 0 : 1,
        rate_limit_per_hour: wf.rate_limit_per_hour ?? 0,
        requires_approval: wf.requires_approval ?? 0,
      });
      setRefreshTick((t) => t + 1);
    } catch (err: any) {
      setError(`Failed to toggle workflow: ${err?.message ?? String(err)}`);
    }
  };

  const handleDelete = async (wf: Workflow) => {
    if (!confirm(`Delete workflow "${wf.name}"? This cannot be undone.`)) return;
    setDeleting(wf.id);
    try {
      await api.deleteWorkflow(wf.id);
      setRefreshTick((t) => t + 1);
    } catch (err: any) {
      setError(`Failed to delete workflow: ${err?.message ?? String(err)}`);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Workflow error" onDismiss={() => setError('')} />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-text-primary" strokeWidth={2.5} />
          <h2 className="text-sm font-black uppercase tracking-wider text-text-primary">Workflows</h2>
          <span className="text-[10px] text-text-muted ml-2">
            {workflows.length} total
          </span>
        </div>
        <button
          className="block-btn-primary inline-flex items-center gap-1.5 text-xs px-3 py-1.5 font-semibold"
          onClick={onNew}
          style={{ borderRadius: '6px' }}
        >
          <Plus size={12} /> New Workflow
        </button>
      </div>

      {loading ? (
        <div className="block-card p-6 text-xs text-text-muted italic" style={{ borderRadius: '6px' }}>
          Loading workflows…
        </div>
      ) : workflows.length === 0 ? (
        <div className="block-card p-6" style={{ borderRadius: '6px' }}>
          <EmptyState
            icon={GitBranch}
            message="No workflows yet"
            hint="Workflows let you react to events with conditions and actions."
            actionLabel="Create First Workflow"
            onAction={onNew}
          />
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="block-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Trigger Event</th>
                <th>Conditions</th>
                <th>Actions</th>
                <th>Active</th>
                <th>Last Run</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => {
                const cfg = safeParseObj(wf.trigger_config_json);
                const conditions = safeParseArray(wf.conditions_json);
                const actions = safeParseArray(wf.actions_json);
                const eventType = (cfg.event_type as string) ?? wf.trigger_type ?? '—';
                const lastRun = lastRunMap[wf.id];
                return (
                  <tr key={wf.id}>
                    <td>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-text-primary">{wf.name}</span>
                        {wf.description && (
                          <span className="text-[10px] text-text-muted truncate max-w-[260px]">
                            {wf.description}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="inline-block border border-border-secondary text-text-secondary text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 font-mono"
                            style={{ borderRadius: '6px' }}>
                        {eventType}
                      </span>
                    </td>
                    <td className="text-xs text-text-secondary font-mono">{conditions.length}</td>
                    <td className="text-xs text-text-secondary font-mono">{actions.length}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(wf)}
                        className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border transition-colors ${
                          wf.is_active
                            ? 'border-accent-income text-accent-income hover:bg-accent-income/10'
                            : 'border-border-secondary text-text-muted hover:bg-bg-hover'
                        }`}
                        style={{ borderRadius: '6px' }}
                        title={wf.is_active ? 'Click to deactivate' : 'Click to activate'}
                      >
                        {wf.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="text-xs text-text-muted whitespace-nowrap">
                      {lastRun ? formatDate(lastRun, { style: 'relative' }) : 'Never'}
                    </td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          className="block-btn inline-flex items-center gap-1 text-[10px] px-2 py-1"
                          onClick={() => onEdit(wf.id)}
                          style={{ borderRadius: '6px' }}
                          title="Edit workflow"
                        >
                          <Pencil size={10} /> Edit
                        </button>
                        <button
                          className="text-text-muted hover:text-accent-expense p-1 transition-colors"
                          onClick={() => handleDelete(wf)}
                          disabled={deleting === wf.id}
                          title="Delete workflow"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <Activity size={10} />
        Workflows fire when matching events are emitted by the event bus.
      </div>
    </div>
  );
};

export default WorkflowList;
