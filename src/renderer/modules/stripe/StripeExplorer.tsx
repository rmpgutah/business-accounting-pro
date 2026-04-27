// src/renderer/modules/stripe/StripeExplorer.tsx
//
// Visual browser over the full Stripe API surface. Every listed resource
// from the Stripe developer portal is categorized in the left rail; selecting
// one loads it (network-first, cache-fallback) and renders a generic object
// table with live JSON preview + raw-JSON drawer.
//
// Offline behaviour:
//   - If the network fails or the API key is missing, we silently read from
//     local SQLite cache (see stripe_cache). A banner tells the user the data
//     is cached, and a Retry button tries again.
//   - Mutations hit the queue; the badge at the top shows queued count.
//
// The goal is not to provide every Stripe dashboard feature (hopeless) —
// it's to let the user VERIFY the integration is wired and inspect any
// resource they've enabled, including previews.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, WifiOff, Wifi, Database, CheckCircle, AlertCircle,
  Search, ChevronRight, ChevronDown, Copy, Zap,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';

interface ResourceMeta {
  label: string;
  group?: string;
  actions: string[];
  custom: string[];
  preview: boolean;
}

interface SyncState {
  resource: string;
  last_synced_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
}

// A universal Stripe list response: { object: 'list', data: [...], has_more }
// OR a single cached object. We normalize to an array for rendering.
type StripeObject = { id: string; object?: string; [k: string]: unknown };

// Pick sensible columns per Stripe resource shape. Falls back to id + object.
function inferColumns(resource: string, rows: StripeObject[]): string[] {
  if (!rows.length) return ['id'];
  const sample = rows[0];
  // Priority columns if present
  const preferred = [
    'id', 'amount', 'amount_total', 'amount_due', 'currency', 'status',
    'customer', 'email', 'name', 'description', 'subject', 'type',
    'created', 'live_mode', 'livemode',
  ];
  const cols = preferred.filter((c) => c in sample);
  if (cols.length < 3) {
    for (const k of Object.keys(sample)) {
      if (cols.length >= 5) break;
      if (!cols.includes(k) && typeof sample[k] !== 'object') cols.push(k);
    }
  }
  // Make sure id is first
  return Array.from(new Set(['id', ...cols]));
}

function formatCell(resource: string, col: string, value: unknown): string {
  if (value == null) return '—';
  if (col === 'created' && typeof value === 'number') {
    return new Date(value * 1000).toLocaleString();
  }
  if (col === 'amount' || col === 'amount_total' || col === 'amount_due') {
    // Stripe amounts are integer minor units
    if (typeof value === 'number') return (value / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 60) + '…';
  return String(value);
}

const StripeExplorer: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [groups, setGroups] = useState<Record<string, Array<{ key: string; label: string; preview: boolean }>> | null>(null);
  const [resources, setResources] = useState<Record<string, ResourceMeta>>({});
  const [resource, setResource] = useState<string>('charges');
  const [rows, setRows] = useState<StripeObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'network' | 'cache' | 'queued' | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StripeObject | null>(null);
  const [syncState, setSyncState] = useState<SyncState[]>([]);
  const [queueCount, setQueueCount] = useState<{ pending: number; failed: number }>({ pending: 0, failed: 0 });
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ Core: true });
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'ok' | 'no-key' | 'bad-key'>('unknown');

  const pollRef = useRef<number | null>(null);

  // ── Load resource catalog once ────────────────────────────────────
  useEffect(() => {
    api.stripe.resources().then(({ byGroup, all }) => {
      setGroups(byGroup);
      setResources(all as Record<string, ResourceMeta>);
    });
  }, []);

  // ── Watch online state ────────────────────────────────────────────
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // ── Background: pull sync state + queue counts every 30s ─────────
  const refreshMeta = useCallback(async () => {
    if (!activeCompany) return;
    const [ss, qs] = await Promise.all([
      api.stripe.syncState(activeCompany.id),
      api.stripe.queueStatus(activeCompany.id),
    ]);
    setSyncState(ss ?? []);
    const pending = qs.find((q) => q.status === 'pending')?.count ?? 0;
    const failed  = qs.find((q) => q.status === 'failed')?.count ?? 0;
    setQueueCount({ pending, failed });
  }, [activeCompany]);

  useEffect(() => {
    refreshMeta();
    pollRef.current = window.setInterval(refreshMeta, 30000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [refreshMeta]);

  // ── Test connection once per company change ──────────────────────
  useEffect(() => {
    if (!activeCompany) return;
    api.stripe.testConnection(activeCompany.id).then((r) => {
      if (r?.ok) setConnectionStatus('ok');
      else if (/No API key/i.test(r?.error ?? '')) setConnectionStatus('no-key');
      else setConnectionStatus('bad-key');
    }).catch((err) => {
      console.error('Stripe testConnection failed:', err);
      setConnectionStatus('bad-key');
    });
  }, [activeCompany]);

  // ── Load a resource (network-first) ──────────────────────────────
  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    setWarning('');
    setSelected(null);
    try {
      const spec = resources[resource];
      // Not all resources support list (e.g. balance, confirmation_tokens).
      // Try 'list'; fall back to 'retrieve' without id to read cache.
      if (spec?.actions.includes('list')) {
        const r = await api.stripe.call({ resource, action: 'list', params: { limit: 50 }, companyId: activeCompany.id });
        setSource(r.source);
        if (r.warning) setWarning(r.warning);
        if (!r.ok) { setError(r.error ?? 'Stripe error'); setRows([]); return; }
        const payload = r.data;
        if (payload?.object === 'list') setRows(payload.data ?? []);
        else if (Array.isArray(payload?.data)) setRows(payload.data);
        else if (Array.isArray(payload)) setRows(payload);
        else setRows([]);
      } else {
        const cached = await api.stripe.listCached(resource, activeCompany.id, 50);
        setRows(cached);
        setSource('cache');
        setWarning(spec?.actions.includes('retrieve')
          ? 'This resource does not support listing — showing previously retrieved cached objects.'
          : 'This resource is action-only (no list/retrieve). Use the Actions panel.');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }, [activeCompany, resource, resources]);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const r = await api.stripe.sync(resource, activeCompany.id);
      setWarning(`Synced ${r.count} ${resource} object${r.count === 1 ? '' : 's'}. Queue drained: ${r.drained}.`);
      await refreshMeta();
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'Sync failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  const currentMeta = resources[resource];
  const lastSynced = useMemo(() => syncState.find((s) => s.resource === resource), [syncState, resource]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const needle = search.toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
  }, [rows, search]);

  const columns = useMemo(() => inferColumns(resource, rows), [resource, rows]);

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── Resource rail ─────────────────────────────────────── */}
      <aside
        className="w-64 shrink-0 border-r border-border-primary overflow-y-auto"
        style={{ background: 'rgba(14,15,20,0.55)' }}
      >
        <div className="p-3 border-b border-border-primary">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Stripe Resources</h3>
          <p className="text-[10px] text-text-muted mt-1">{Object.keys(resources).length} endpoints</p>
        </div>
        {groups && Object.keys(groups).sort().map((g) => (
          <div key={g} className="border-b border-border-primary/50">
            <button
              onClick={() => setExpandedGroups((prev) => ({ ...prev, [g]: !prev[g] }))}
              className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-bold text-text-secondary hover:bg-bg-hover uppercase tracking-wider transition-colors"
            >
              <span className="flex items-center gap-1">
                {expandedGroups[g] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {g}
              </span>
              <span className="text-text-muted text-[10px]">{groups[g].length}</span>
            </button>
            {expandedGroups[g] && groups[g].map((r) => (
              <button
                key={r.key}
                onClick={() => setResource(r.key)}
                className={`block w-full text-left px-6 py-1.5 text-xs transition-colors ${
                  resource === r.key
                    ? 'bg-accent-blue/15 text-accent-blue font-semibold'
                    : 'text-text-secondary hover:bg-bg-hover transition-colors'
                }`}
              >
                <span className="flex items-center justify-between">
                  <span className="truncate">{r.label}</span>
                  {r.preview && (
                    <span className="text-[9px] px-1 py-0.5 bg-accent-warning/15 text-accent-warning rounded shrink-0" title="Requires preview enrollment on your Stripe account">
                      preview
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* ── Main pane ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary bg-bg-secondary">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-text-primary">{currentMeta?.label ?? resource}</h1>
              {currentMeta?.preview && (
                <span className="text-[10px] px-1.5 py-0.5 bg-accent-warning/15 text-accent-warning uppercase font-bold tracking-wider">Preview</span>
              )}
            </div>
            <p className="text-[11px] text-text-muted mt-0.5 font-mono">
              {currentMeta?.actions.join(' · ') ?? ''}
              {currentMeta?.custom?.length ? ` · custom: ${currentMeta.custom.join(', ')}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Connection/offline indicators */}
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted px-2 py-1 bg-bg-tertiary">
              {online ? <Wifi size={12} className="text-accent-income" /> : <WifiOff size={12} className="text-accent-expense" />}
              {online ? 'Online' : 'Offline'}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted px-2 py-1 bg-bg-tertiary">
              {connectionStatus === 'ok' ? <CheckCircle size={12} className="text-accent-income" />
                : connectionStatus === 'no-key' ? <AlertCircle size={12} className="text-accent-warning" />
                : connectionStatus === 'bad-key' ? <AlertCircle size={12} className="text-accent-expense" />
                : <Zap size={12} className="text-text-muted" />}
              {connectionStatus === 'ok' ? 'API Connected'
                : connectionStatus === 'no-key' ? 'No API Key'
                : connectionStatus === 'bad-key' ? 'Key Invalid'
                : 'Testing…'}
            </div>
            {(queueCount.pending > 0 || queueCount.failed > 0) && (
              <div className="flex items-center gap-1.5 text-[11px] px-2 py-1 bg-accent-warning/15 text-accent-warning" title="Mutations that ran offline and will retry when online.">
                <Database size={12} />
                {queueCount.pending} queued{queueCount.failed ? `, ${queueCount.failed} failed` : ''}
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={loading || !currentMeta?.actions.includes('list')}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-accent-blue text-white disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Sync
            </button>
          </div>
        </div>

        {/* Status strip */}
        {(source || lastSynced) && (
          <div className="px-5 py-1.5 text-[10px] text-text-muted border-b border-border-primary bg-bg-primary flex items-center justify-between">
            <span>
              Source: <span className="font-semibold">{source ?? 'n/a'}</span>
              {lastSynced?.last_ok_at && <> · Last sync: {new Date(lastSynced.last_ok_at).toLocaleString()}</>}
              {lastSynced?.last_error && <> · <span className="text-accent-expense">Last error: {lastSynced.last_error}</span></>}
            </span>
            <span>{filteredRows.length} shown / {rows.length} cached</span>
          </div>
        )}

        {error && <div className="px-5 pt-3"><ErrorBanner title="Stripe error" message={error} onDismiss={() => setError('')} /></div>}
        {warning && (
          <div className="px-5 py-2 border-b border-border-primary bg-accent-warning/10 text-accent-warning text-[11px] flex items-center gap-2">
            <AlertCircle size={12} /> {warning}
          </div>
        )}

        {/* Search */}
        <div className="px-5 py-2 border-b border-border-primary flex items-center gap-2">
          <Search size={12} className="text-text-muted" />
          <input
            className="block-input flex-1 text-xs"
            placeholder="Filter by any field…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Content split: table + detail */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto">
            {loading && <div className="p-6 text-center text-xs text-text-muted font-mono">Loading…</div>}
            {!loading && filteredRows.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm text-text-secondary">No {currentMeta?.label ?? resource} in cache.</p>
                <p className="text-xs text-text-muted mt-1">
                  {online ? 'Click Sync to pull from Stripe.' : 'You are offline — connect to populate.'}
                </p>
              </div>
            )}
            {!loading && filteredRows.length > 0 && (
              <table className="block-table text-xs w-full">
                <thead>
                  <tr>
                    {columns.map((c) => <th key={c} className="text-left">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelected(row)}
                      className={`cursor-pointer ${selected?.id === row.id ? 'bg-accent-blue/10' : ''}`}
                    >
                      {columns.map((c) => (
                        <td key={c} className={c === 'id' ? 'font-mono text-text-secondary' : ''}>
                          {formatCell(resource, c, row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Detail drawer */}
          {selected && (
            <aside className="w-[420px] border-l border-border-primary bg-bg-secondary overflow-auto">
              <div className="flex items-center justify-between p-3 border-b border-border-primary">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">{selected.object ?? resource}</h3>
                  <p className="font-mono text-[10px] text-text-muted mt-0.5">{selected.id}</p>
                </div>
                <button
                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(selected, null, 2))}
                  className="p-1 text-text-muted hover:text-text-primary transition-colors"
                  title="Copy JSON"
                >
                  <Copy size={12} />
                </button>
              </div>
              <pre className="text-[10px] font-mono p-3 whitespace-pre-wrap break-all text-text-secondary">
                {JSON.stringify(selected, null, 2)}
              </pre>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};

export default StripeExplorer;
