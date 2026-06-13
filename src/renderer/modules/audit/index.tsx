import React, { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import {
  Shield, Search, Filter, Clock,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../../lib/api';
import { humanizeLabel } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';

const SoxControls = lazy(() => import('./SoxControls'));
const AuditSampling = lazy(() => import('./AuditSampling'));
const PeriodCloseOrchestration = lazy(() => import('./PeriodCloseOrchestration'));
const DocumentNumbering = lazy(() => import('./DocumentNumbering'));

// ─── Types ──────────────────────────────────────────────
interface AuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  changes: string;
  performed_by: string;
  timestamp?: string;
  created_at?: string;
}

type ActionFilter = '' | 'create' | 'update' | 'delete';
type MainTab = 'trail' | 'sox' | 'sampling' | 'close' | 'numbering';

// ─── Action Badges ──────────────────────────────────────
const actionBadgeClass: Record<string, string> = {
  create: 'block-badge block-badge-income',
  update: 'block-badge block-badge-blue',
  delete: 'block-badge block-badge-expense',
};

// ─── Helpers ────────────────────────────────────────────
const formatChanges = (changes: string | Record<string, unknown>): string => {
  if (!changes) return '-';
  let parsed: Record<string, unknown>;
  if (typeof changes === 'string') {
    try {
      parsed = JSON.parse(changes);
    } catch {
      return changes.length > 80 ? changes.substring(0, 80) + '...' : changes;
    }
  } else {
    parsed = changes;
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const entries = Object.entries(parsed);
    if (entries.length === 0) return '-';
    return entries
      .slice(0, 3)
      .map(([key, val]) => {
        if (typeof val === 'object' && val !== null) {
          const change = val as { from?: unknown; to?: unknown };
          return `${key}: ${change.from ?? '(empty)'} -> ${change.to ?? '(empty)'}`;
        }
        return `${key}: ${val}`;
      })
      .join(', ') + (entries.length > 3 ? ` +${entries.length - 3} more` : '');
  }
  return String(parsed);
};

const getTimestamp = (entry: AuditEntry): string => entry.timestamp || entry.created_at || '';

// ─── Audit Trail ─────────────────────────────────────────
const AuditTrail: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loadError, setLoadError] = useState('');

  // ─── Load ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoadError('');
        // Perf: cap at 1000 most-recent entries; long-running companies can have 100k+ rows
        const rows = await api.query('audit_log', { company_id: activeCompany.id }, { field: 'timestamp', dir: 'desc' }, 1000);
        if (!cancelled) setEntries(Array.isArray(rows) ? rows : []);
      } catch (err: any) {
        console.error('Failed to load audit log:', err);
        if (!cancelled) setLoadError(err?.message || 'Failed to load audit log');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ─── Entity Types ─────────────────────────────────────
  const entityTypes = useMemo(() => {
    const types = new Set<string>();
    entries.forEach((e) => { if (e.entity_type) types.add(e.entity_type); });
    return Array.from(types).sort();
  }, [entries]);

  // ─── Filtered ─────────────────────────────────────────
  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          entry.entity_type?.toLowerCase().includes(q) ||
          entry.entity_id?.toLowerCase().includes(q) ||
          entry.performed_by?.toLowerCase().includes(q) ||
          (typeof entry.changes === 'string' && entry.changes.toLowerCase().includes(q));
        if (!match) return false;
      }
      if (actionFilter && entry.action !== actionFilter) return false;
      if (entityTypeFilter && entry.entity_type !== entityTypeFilter) return false;
      if (dateFrom) {
        const ts = getTimestamp(entry);
        if (ts) {
          const entryDate = ts.split('T')[0];
          if (entryDate < dateFrom) return false;
        }
      }
      if (dateTo) {
        const ts = getTimestamp(entry);
        if (ts) {
          const entryDate = ts.split('T')[0];
          if (entryDate > dateTo) return false;
        }
      }
      return true;
    });
  }, [entries, search, actionFilter, entityTypeFilter, dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading audit log...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {loadError && <ErrorBanner message={loadError} title="Failed to load audit log" onDismiss={() => setLoadError('')} />}

      {/* Filters */}
      <div className="block-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search audit log..."
              className="block-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-text-muted" />
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '140px' }}
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
            >
              <option value="">All Entity Types</option>
              {[...entityTypes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '120px' }}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
          >
            <option value="">All Actions</option>
            <option value="create">Create</option>
            <option value="delete">Delete</option>
            <option value="update">Update</option>
          </select>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="From date"
          />
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="To date"
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Shield size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">
            {entries.length === 0 ? 'No audit entries yet' : 'No audit entries match your filter'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {entries.length === 0
              ? 'Audit entries are created automatically when data changes.'
              : 'Try clearing search or filters.'}
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Entity Type</th>
                <th>Entity ID</th>
                <th>Action</th>
                <th>Changes</th>
                <th>Performed By</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const ts = getTimestamp(entry);
                return (
                  <tr key={entry.id}>
                    <td className="font-mono text-text-secondary text-xs whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-text-muted shrink-0" />
                        {ts ? format(parseISO(ts), 'MMM d, yyyy HH:mm:ss') : '-'}
                      </div>
                    </td>
                    <td>
                      <span className="block-badge block-badge-purple">{humanizeLabel(entry.entity_type)}</span>
                    </td>
                    <td className="font-mono text-text-muted text-xs">
                      {entry.entity_id
                        ? entry.entity_id.length > 12
                          ? entry.entity_id.substring(0, 12) + '...'
                          : entry.entity_id
                        : '-'}
                    </td>
                    <td>
                      <span className={actionBadgeClass[entry.action] || 'block-badge'}>
                        {entry.action}
                      </span>
                    </td>
                    <td
                      className="text-text-secondary text-xs max-w-[300px] truncate"
                      title={typeof entry.changes === 'string' ? entry.changes : JSON.stringify(entry.changes)}
                    >
                      {formatChanges(entry.changes)}
                    </td>
                    <td className="text-text-secondary text-sm">
                      {entry.performed_by || 'System'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      {filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}
        </div>
      )}
    </div>
  );
};

// ─── Main Module ──────────────────────────────────────────
const AuditModule: React.FC = () => {
  const [tab, setTab] = useState<MainTab>('trail');

  const TABS: { id: MainTab; label: string }[] = [
    { id: 'trail', label: 'Audit Trail' },
    { id: 'sox', label: 'Controls (SOX/SOD)' },
    { id: 'sampling', label: 'Audit Sampling' },
    { id: 'close', label: 'Period Close' },
    { id: 'numbering', label: 'Doc Numbering' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Module header */}
      <div className="px-6 pt-6 pb-0 flex-shrink-0">
        <div className="module-header mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
              style={{ borderRadius: 'var(--app-radius)' }}
            >
              <Shield size={18} className="text-accent-blue" />
            </div>
            <div>
              <h2 className="module-title text-text-primary">Audit</h2>
              <p className="text-xs text-text-muted mt-0.5">Trail, controls, sampling &amp; inquiry</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border-primary">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'border-accent-primary text-accent-primary font-medium'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'trail' && <AuditTrail />}
        {tab === 'sox' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading...</div>}>
            <SoxControls />
          </Suspense>
        )}
        {tab === 'sampling' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading...</div>}>
            <AuditSampling />
          </Suspense>
        )}
        {tab === 'close' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading...</div>}>
            <PeriodCloseOrchestration />
          </Suspense>
        )}
        {tab === 'numbering' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading...</div>}>
            <DocumentNumbering />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default AuditModule;
