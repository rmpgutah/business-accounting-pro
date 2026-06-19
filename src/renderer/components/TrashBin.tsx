import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, RotateCcw, X, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../lib/api';

// 30-day Trash Bin. Reads soft-deleted rows across all soft-delete
// tables (trash:list), shows how many days remain before the nightly
// auto-purge physically removes each one, and offers per-item Restore /
// Delete-Forever plus a bulk Empty Trash. The retention window defaults
// to 30 days (configurable via the trash_retention_days setting).

interface TrashBinProps {
  onClose: () => void;
}

// Friendly labels for the soft-delete tables that can show up in Trash.
const TABLE_LABELS: Record<string, string> = {
  vendors: 'Vendors',
  clients: 'Clients',
  expenses: 'Expenses',
  invoices: 'Invoices',
  bills: 'Bills',
  quotes: 'Quotes',
  loans: 'Loans',
  projects: 'Projects',
  employees: 'Employees',
  products: 'Products',
  purchase_orders: 'Purchase Orders',
  accounts: 'Accounts',
  journal_entries: 'Journal Entries',
  time_entries: 'Time Entries',
  debts: 'Debts',
};
const labelFor = (table: string): string =>
  TABLE_LABELS[table] ||
  table.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Derive a human label for an arbitrary soft-deleted row — tables differ
// wildly, so try the columns most likely to identify a record.
const rowLabel = (row: any): string =>
  row.name || row.description || row.title || row.vendor_name ||
  row.client_name || row.invoice_number || row.number ||
  (row.amount != null ? `$${Number(row.amount).toFixed(2)}` : null) ||
  row.id?.slice(0, 8) || '(record)';

const rowSubLabel = (row: any): string => {
  const bits: string[] = [];
  if (row.amount != null && (row.name || row.description)) bits.push(`$${Number(row.amount).toFixed(2)}`);
  if (row.total != null) bits.push(`$${Number(row.total).toFixed(2)}`);
  if (row.date) bits.push(String(row.date));
  return bits.join(' · ');
};

const TrashBin: React.FC<TrashBinProps> = ({ onClose }) => {
  const [items, setItems] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, retention] = await Promise.all([
        api.trashList(),
        api.getSetting('trash_retention_days').catch(() => null),
      ]);
      if (res?.error) { setError(res.error); return; }
      // Drop empty tables so we only render sections that have items.
      const nonEmpty: Record<string, any[]> = {};
      for (const [table, rows] of Object.entries(res.items || {})) {
        if (Array.isArray(rows) && rows.length > 0) nonEmpty[table] = rows;
      }
      setItems(nonEmpty);
      const parsed = retention ? parseInt(String(retention), 10) : NaN;
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 365) setRetentionDays(parsed);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trash');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Esc to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const daysLeft = (deletedAt: string): number => {
    if (!deletedAt) return retentionDays;
    const deleted = new Date(deletedAt.replace(' ', 'T') + 'Z').getTime();
    if (isNaN(deleted)) return retentionDays;
    const elapsedDays = (Date.now() - deleted) / 86400000;
    return Math.max(0, Math.ceil(retentionDays - elapsedDays));
  };

  const totalCount = Object.values(items).reduce((s, rows) => s + rows.length, 0);

  const handleRestore = async (table: string, id: string) => {
    setBusyId(id);
    try {
      const r = await api.trashRestore(table, id);
      if (r?.error) { setError(r.error); return; }
      await load();
    } finally { setBusyId(null); }
  };

  const handlePurge = async (table: string, id: string, label: string) => {
    if (!window.confirm(`Permanently delete "${label}"? This cannot be undone.`)) return;
    setBusyId(id);
    try {
      const r = await api.trashPurge(table, id);
      if (r?.error) { setError(r.error); return; }
      await load();
    } finally { setBusyId(null); }
  };

  const handleEmpty = async () => {
    if (!window.confirm(`Permanently delete all ${totalCount} item${totalCount === 1 ? '' : 's'} in Trash? This cannot be undone.`)) return;
    setLoading(true);
    try {
      const r = await api.trashEmpty();
      if (r?.error) { setError(r.error); return; }
      await load();
    } finally { setLoading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl"
        style={{
          borderRadius: '10px',
          background: 'rgba(20, 22, 30, 0.92)',
          backdropFilter: 'blur(24px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <div className="flex items-center gap-2">
            <Trash2 size={16} className="text-text-secondary" />
            <span className="text-sm font-semibold text-text-primary">Trash</span>
            <span className="text-[11px] text-text-muted">
              · {totalCount} item{totalCount === 1 ? '' : 's'} · auto-deleted after {retentionDays} days
            </span>
          </div>
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <button
                onClick={handleEmpty}
                className="block-btn-danger px-2.5 py-1 text-xs"
                title="Permanently delete everything in Trash"
              >
                Empty Trash
              </button>
            )}
            <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary" style={{ borderRadius: '6px' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto">
          {error && (
            <div className="m-3 p-2.5 flex items-start gap-2 text-xs" style={{ borderRadius: '6px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)' }}>
              <AlertTriangle size={14} className="text-accent-expense shrink-0 mt-0.5" />
              <span className="text-text-secondary">{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-text-muted text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading trash…
            </div>
          ) : totalCount === 0 ? (
            <div className="py-12 text-center text-text-muted text-sm">
              <Trash2 size={28} className="mx-auto mb-2 opacity-40" />
              Trash is empty. Deleted records appear here for {retentionDays} days before being permanently removed.
            </div>
          ) : (
            Object.entries(items).map(([table, rows]) => (
              <div key={table} className="py-2">
                <div className="px-4 py-1">
                  <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-accent-blue/15 text-accent-blue" style={{ borderRadius: '6px' }}>
                    {labelFor(table)} ({rows.length})
                  </span>
                </div>
                {rows.map((row: any) => {
                  const left = daysLeft(row.deleted_at);
                  const label = rowLabel(row);
                  const sub = rowSubLabel(row);
                  return (
                    <div key={row.id} className="flex items-center gap-3 px-4 py-2 hover:bg-bg-hover transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary truncate">{label}</div>
                        {sub && <div className="text-[11px] text-text-muted truncate">{sub}</div>}
                      </div>
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 shrink-0"
                        style={{
                          borderRadius: '6px',
                          color: left <= 3 ? 'var(--color-accent-expense)' : 'var(--color-text-muted)',
                          background: left <= 3 ? 'rgba(220,38,38,0.12)' : 'rgba(255,255,255,0.04)',
                        }}
                        title={`Deleted ${row.deleted_at || 'recently'}`}
                      >
                        {left === 0 ? 'purging soon' : `${left}d left`}
                      </span>
                      <button
                        onClick={() => handleRestore(table, row.id)}
                        disabled={busyId === row.id}
                        className="block-btn px-2 py-1 text-xs inline-flex items-center gap-1"
                        title="Restore this record"
                      >
                        <RotateCcw size={11} /> Restore
                      </button>
                      <button
                        onClick={() => handlePurge(table, row.id, label)}
                        disabled={busyId === row.id}
                        className="block-btn-danger px-2 py-1 text-xs inline-flex items-center gap-1"
                        title="Delete permanently now"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border-primary text-[11px] text-text-muted">
          <span>Restored records return to their module. Purge is permanent.</span>
          <span><kbd className="px-1 py-0.5 bg-bg-tertiary border border-border-secondary" style={{ borderRadius: '6px' }}>ESC</kbd> to close</span>
        </div>
      </div>
    </div>
  );
};

export default TrashBin;
