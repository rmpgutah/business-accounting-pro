import React, { useEffect, useState, useCallback } from 'react';
import { Trash2, RotateCcw, X, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';

/**
 * P1.13 — Trash / Soft-Delete Recovery
 *
 * Lists records the user has deleted within the 30-day retention
 * window. They can RESTORE (undo the delete) or PURGE (delete
 * permanently right now, ahead of the auto-purge cron).
 *
 * Tables shown: invoices, bills, expenses, journal_entries
 * Other tables (clients, vendors, accounts) physically delete
 * because their FK references would orphan dependent rows.
 */

const TABLE_LABELS: Record<string, string> = {
  invoices: 'Invoices',
  bills: 'Bills',
  expenses: 'Expenses',
  journal_entries: 'Journal Entries',
};

const TABLE_ID_FIELDS: Record<string, string[]> = {
  // Display field name preference per table — we try these in order
  invoices: ['invoice_number', 'reference', 'id'],
  bills: ['bill_number', 'reference', 'id'],
  expenses: ['reference', 'description', 'id'],
  journal_entries: ['entry_number', 'reference', 'id'],
};

function pickLabel(table: string, row: any): string {
  const fields = TABLE_ID_FIELDS[table] || ['id'];
  for (const f of fields) {
    if (row[f]) return String(row[f]);
  }
  return row.id;
}

function fmtAge(deletedAt: string): string {
  if (!deletedAt) return '';
  const ts = new Date(deletedAt + (deletedAt.includes('T') ? '' : ' UTC')).getTime();
  if (!Number.isFinite(ts)) return '';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

const TrashSettings: React.FC = () => {
  const [items, setItems] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.trashList();
      setItems(res?.items || {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async (table: string, id: string) => {
    setBusy(`${table}:${id}`);
    try {
      const res = await api.trashRestore(table, id);
      if (res?.error) alert(`Restore failed: ${res.error}`);
      else await load();
    } finally {
      setBusy('');
    }
  };

  const handlePurge = async (table: string, id: string) => {
    if (!confirm('Permanently delete this record? This cannot be undone.')) return;
    setBusy(`${table}:${id}`);
    try {
      const res = await api.trashPurge(table, id);
      if (res?.error) alert(`Purge failed: ${res.error}`);
      else await load();
    } finally {
      setBusy('');
    }
  };

  const handleEmptyTrash = async () => {
    setBusy('empty');
    try {
      const res = await api.trashEmpty();
      if (res?.error) alert(`Empty Trash failed: ${res.error}`);
      else {
        await load();
        if (typeof res?.purged === 'number') {
          alert(`Permanently deleted ${res.purged} record${res.purged === 1 ? '' : 's'}.`);
        }
      }
    } finally {
      setBusy('');
      setShowEmptyConfirm(false);
    }
  };

  const totalCount = Object.values(items).reduce((sum, list) => sum + list.length, 0);

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Loading trash…</div>;
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Trash2 size={22} />
          Trash
        </h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Deleted invoices, bills, expenses, and journal entries are kept here for 30 days. Restore them to undo the delete, or purge to remove permanently before the auto-cleanup.
        </p>
      </div>

      {totalCount === 0 ? (
        <div className="block-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <Trash2 size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Trash is empty</div>
          <div style={{ fontSize: 11 }}>Records you delete from invoices, bills, expenses, or journal entries will appear here.</div>
        </div>
      ) : (
        <>
          {/* Empty Trash button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {!showEmptyConfirm ? (
              <button
                className="block-btn flex items-center gap-2"
                onClick={() => setShowEmptyConfirm(true)}
                style={{ color: 'var(--color-accent-expense)', borderColor: 'var(--color-accent-expense)' }}
              >
                <Trash2 size={13} />
                Empty Trash ({totalCount})
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--color-accent-expense)', fontWeight: 700 }}>
                  Permanently delete all {totalCount} records?
                </span>
                <button
                  className="block-btn-primary text-xs"
                  onClick={handleEmptyTrash}
                  disabled={busy === 'empty'}
                  style={{ background: 'var(--color-accent-expense)', borderColor: 'var(--color-accent-expense)' }}
                >
                  {busy === 'empty' ? 'Purging…' : 'Yes, Empty'}
                </button>
                <button className="block-btn text-xs" onClick={() => setShowEmptyConfirm(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Per-table sections */}
          {Object.entries(items).filter(([, list]) => list.length > 0).map(([table, list]) => (
            <div key={table} className="block-card" style={{ padding: 0 }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-text-muted)' }}>
                  {TABLE_LABELS[table] || table} ({list.length})
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {list.map((row) => {
                  const label = pickLabel(table, row);
                  const age = fmtAge(row.deleted_at);
                  const total = (row.total ?? row.amount);
                  return (
                    <div
                      key={row.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--color-border-primary)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {label}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {Number.isFinite(total) && (
                            <span style={{ fontFamily: 'SF Mono, Menlo, monospace', marginRight: 8 }}>
                              ${Number(total).toFixed(2)}
                            </span>
                          )}
                          {row.status && <span style={{ marginRight: 8 }}>· {row.status}</span>}
                          deleted {age}
                        </div>
                      </div>
                      <button
                        className="block-btn flex items-center gap-1.5 text-xs"
                        onClick={() => handleRestore(table, row.id)}
                        disabled={busy === `${table}:${row.id}`}
                        title="Restore this record"
                      >
                        <RotateCcw size={12} />
                        Restore
                      </button>
                      <button
                        className="block-btn flex items-center gap-1.5 text-xs"
                        onClick={() => handlePurge(table, row.id)}
                        disabled={busy === `${table}:${row.id}`}
                        style={{ color: 'var(--color-accent-expense)', borderColor: 'var(--color-accent-expense)' }}
                        title="Permanently delete this record"
                      >
                        <X size={12} />
                        Purge
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Retention notice */}
          <div style={{
            padding: 12,
            border: '1px dashed var(--color-border-primary)',
            borderRadius: 6,
            background: 'rgba(217, 119, 6, 0.05)',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
          }}>
            <AlertTriangle size={14} style={{ color: 'var(--color-warning, #d97706)', flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>Auto-cleanup:</strong> Records older than 30 days are physically deleted nightly. To change the retention window, set <code>trash_retention_days</code> in Settings → System (range 1–365).
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TrashSettings;
