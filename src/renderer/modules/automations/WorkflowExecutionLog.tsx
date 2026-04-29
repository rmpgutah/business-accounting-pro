import React, { useEffect, useMemo, useState } from 'react';
import {
  History,
  Activity,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';

interface ExecutionRow {
  id: string;
  workflow_id: string;
  triggered_at: string;
  status: 'success' | 'failed' | 'running' | string;
  duration_ms?: number | null;
  error_message?: string | null;
}

interface WorkflowRow {
  id: string;
  name: string;
}

interface EventLogRow {
  id: string;
  event_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  payload_json?: string | null;
  emitted_at: string;
}

type LogTab = 'executions' | 'events';

const LIMITS = [50, 100, 200];

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  const norm = String(status ?? '').toLowerCase();
  let icon = <Activity size={10} />;
  let cls = 'border-border-secondary text-text-muted';
  if (norm === 'success' || norm === 'succeeded' || norm === 'ok') {
    icon = <CheckCircle size={10} />;
    cls = 'border-accent-income text-accent-income';
  } else if (norm === 'failed' || norm === 'error') {
    icon = <XCircle size={10} />;
    cls = 'border-accent-expense text-accent-expense';
  } else if (norm === 'running' || norm === 'pending') {
    icon = <AlertCircle size={10} />;
    cls = 'border-yellow-400 text-yellow-500';
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${cls}`}
      style={{ borderRadius: '6px' }}
    >
      {icon}
      {status || '—'}
    </span>
  );
}

const WorkflowExecutionLog: React.FC = () => {
  const [tab, setTab] = useState<LogTab>('executions');
  const [limit, setLimit] = useState<number>(100);
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [events, setEvents] = useState<EventLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const workflowNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const w of workflows) map[w.id] = w.name;
    return map;
  }, [workflows]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'executions') {
        const [exec, wfs] = await Promise.all([
          api.workflowExecutions(undefined, limit) as Promise<ExecutionRow[]>,
          api.listWorkflows() as Promise<WorkflowRow[]>,
        ]);
        setExecutions(exec ?? []);
        setWorkflows(wfs ?? []);
      } else {
        const evs = (await api.workflowEventLog(limit)) as EventLogRow[];
        setEvents(evs ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Auto-refresh every 30s.
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, limit]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Log error" onDismiss={() => setError('')} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <History size={16} className="text-text-primary" strokeWidth={2.5} />
          <h2 className="text-sm font-black uppercase tracking-wider text-text-primary">Activity</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Tab toggle */}
          <div className="inline-flex border border-border-secondary" style={{ borderRadius: '6px' }}>
            <button
              type="button"
              className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors ${
                tab === 'executions'
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-muted hover:bg-bg-hover/60'
              }`}
              onClick={() => setTab('executions')}
            >
              Executions
            </button>
            <button
              type="button"
              className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 border-l border-border-secondary transition-colors ${
                tab === 'events'
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-muted hover:bg-bg-hover/60'
              }`}
              onClick={() => setTab('events')}
            >
              Event Log
            </button>
          </div>

          <select
            className="block-select text-xs"
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
            title="Result limit"
          >
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n} rows
              </option>
            ))}
          </select>

          <button
            className="block-btn text-xs px-3 py-1.5"
            onClick={load}
            disabled={loading}
            style={{ borderRadius: '6px' }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <p className="text-[10px] text-text-muted">Auto-refreshes every 30 seconds.</p>

      {tab === 'executions' ? (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          {executions.length === 0 ? (
            <div className="p-4 text-xs text-text-muted italic">
              {loading ? 'Loading executions…' : 'No executions recorded yet.'}
            </div>
          ) : (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Triggered At</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((e) => (
                  <tr key={e.id}>
                    <td className="font-mono text-[11px] text-text-muted whitespace-nowrap">
                      {fmtDateTime(e.triggered_at)}
                    </td>
                    <td className="text-xs text-text-primary">
                      {workflowNameMap[e.workflow_id] ?? (
                        <span className="font-mono text-text-muted">{e.workflow_id}</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="font-mono text-xs text-text-secondary">
                      {e.duration_ms != null ? `${e.duration_ms} ms` : '—'}
                    </td>
                    <td className="text-xs text-accent-expense max-w-[420px] truncate" title={e.error_message ?? ''}>
                      {e.error_message ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          {events.length === 0 ? (
            <div className="p-4 text-xs text-text-muted italic">
              {loading ? 'Loading events…' : 'No events recorded yet.'}
            </div>
          ) : (
            <table className="block-table">
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>Time</th>
                  <th>Event Type</th>
                  <th>Entity Type</th>
                  <th>Entity ID</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const isOpen = !!expanded[ev.id];
                  let parsedPayload: any = null;
                  try {
                    parsedPayload = ev.payload_json ? JSON.parse(ev.payload_json) : null;
                  } catch {
                    parsedPayload = ev.payload_json ?? null;
                  }
                  return (
                    <React.Fragment key={ev.id}>
                      <tr
                        onClick={() => toggleExpand(ev.id)}
                        className="cursor-pointer hover:bg-bg-hover/60"
                      >
                        <td>
                          {isOpen ? (
                            <ChevronDown size={12} className="text-text-muted" />
                          ) : (
                            <ChevronRight size={12} className="text-text-muted" />
                          )}
                        </td>
                        <td className="font-mono text-[11px] text-text-muted whitespace-nowrap">
                          {fmtDateTime(ev.emitted_at)}
                        </td>
                        <td className="font-mono text-xs text-text-primary">{ev.event_type}</td>
                        <td className="text-xs text-text-secondary">{ev.entity_type ?? '—'}</td>
                        <td className="font-mono text-[11px] text-text-muted">{ev.entity_id ?? '—'}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td></td>
                          <td colSpan={4} className="bg-bg-tertiary">
                            <pre
                              className="text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap p-3"
                              style={{ borderRadius: '6px' }}
                            >
                              {parsedPayload == null
                                ? '(no payload)'
                                : typeof parsedPayload === 'string'
                                  ? parsedPayload
                                  : JSON.stringify(parsedPayload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkflowExecutionLog;
