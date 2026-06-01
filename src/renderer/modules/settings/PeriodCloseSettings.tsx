// src/renderer/modules/settings/PeriodCloseSettings.tsx
//
// D3 — Period Close + Lockdown UI.
//
// Lists all closed periods (active + reopened-history). Form to
// close a new period. Reopen action with required reason. Audit
// trail rendered inline.

import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Unlock, ShieldCheck, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import { useAuthStore } from '../../stores/authStore';

interface ClosedPeriod {
  id: string;
  period_start: string;
  period_end: string;
  closed_at: string;
  closed_by: string;
  close_reason: string;
  reopened_at: string | null;
  reopened_by: string;
  reopen_reason: string;
  is_active: number;
}

const PeriodCloseSettings: React.FC = () => {
  const toast = useToast();
  const authUser = useAuthStore((s) => s.user);
  const [periods, setPeriods] = useState<ClosedPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  // Form state
  const today = new Date().toISOString().slice(0, 10);
  const lastQuarterEnd = (() => {
    const d = new Date();
    const monthOfQuarter = d.getMonth() % 3;
    d.setMonth(d.getMonth() - monthOfQuarter - 1);
    d.setDate(1);
    d.setMonth(d.getMonth() + 3);
    d.setDate(0); // last day of previous quarter
    return d.toISOString().slice(0, 10);
  })();
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState(lastQuarterEnd);
  const [closeReason, setCloseReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.periodList();
      if (Array.isArray(list)) setPeriods(list as ClosedPeriod[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClose = async () => {
    if (!periodStart || !periodEnd) { toast.error('Both dates are required'); return; }
    if (periodStart > periodEnd) { toast.error('Start must be on or before end'); return; }
    if (!closeReason.trim()) { toast.error('A reason is required for audit trail'); return; }
    if (!confirm('Close period ' + periodStart + ' to ' + periodEnd + '? Records dated within this range will become immutable until you reopen.')) return;

    const r = await api.periodClose({
      period_start: periodStart,
      period_end: periodEnd,
      reason: closeReason.trim(),
      closed_by: authUser?.email || '',
    });
    if (r?.error) { toast.error(r.error); return; }
    toast.success('Period closed · records dated ' + periodStart + ' through ' + periodEnd + ' are now immutable');
    setShowForm(false);
    setPeriodStart(''); setPeriodEnd(lastQuarterEnd); setCloseReason('');
    await load();
  };

  const handleReopen = async (id: string) => {
    const reason = prompt('Reason for reopening this closed period? (Required for audit trail)');
    if (!reason || !reason.trim()) { toast.warning('Cancelled — reason is required'); return; }
    setReopeningId(id);
    try {
      const r = await api.periodReopen({ id, reason: reason.trim(), reopened_by: authUser?.email || '' });
      if (r?.error) { toast.error(r.error); return; }
      toast.success('Period reopened · records can now be edited');
      await load();
    } finally { setReopeningId(null); }
  };

  const active = periods.filter((p) => p.is_active);
  const history = periods.filter((p) => !p.is_active);

  return (
    <div style={{ padding: 24, maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Lock size={22} /> Period Close
        </h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Lock historical accounting periods so previously-reported numbers can't be silently changed. Required for clean audits and tax-return integrity. Reopening leaves a permanent audit trail.
        </p>
      </div>

      {/* Close-period form */}
      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="block-btn-primary flex items-center gap-2" style={{ alignSelf: 'flex-start' }}>
          <Lock size={14} /> Close a Period
        </button>
      ) : (
        <div className="block-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Close Accounting Period
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Field label="Period Start *">
              <input type="date" className="block-input" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </Field>
            <Field label="Period End *">
              <input type="date" className="block-input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} max={today} />
            </Field>
          </div>
          <Field label="Reason / Description *">
            <input className="block-input" value={closeReason} onChange={(e) => setCloseReason(e.target.value)}
              placeholder="Year-end close 2025 · Q1 2026 books finalized · etc." />
          </Field>
          <div style={{
            marginTop: 12, padding: 10, fontSize: 11,
            background: 'rgba(217, 119, 6, 0.08)',
            border: '1px solid rgba(217, 119, 6, 0.3)',
            borderRadius: 6,
            color: 'var(--color-text-primary)',
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <AlertTriangle size={14} style={{ color: 'var(--color-warning, var(--color-accent-warning))', flexShrink: 0, marginTop: 1 }} />
            <span>
              After closing, all <strong>invoices, expenses, journal entries, and payments</strong> dated within this range become immutable. Saves and deletes will fail with a clear error pointing back to this setting.
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
            <button onClick={() => setShowForm(false)} className="block-btn">Cancel</button>
            <button onClick={handleClose} className="block-btn-primary flex items-center gap-2">
              <Lock size={14} /> Close Period
            </button>
          </div>
        </div>
      )}

      {/* Active closed periods */}
      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={12} /> Active Closed Periods ({active.length})
            </span>
          </div>
        </div>
        {loading && <div style={{ padding: 14, color: 'var(--color-text-muted)', fontSize: 11 }}>Loading…</div>}
        {!loading && active.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
            No active closed periods. Records can be edited freely.
          </div>
        )}
        {active.map((p) => (
          <div key={p.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-primary)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Lock size={14} style={{ color: 'var(--color-positive)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', fontFamily: 'SF Mono, Menlo, monospace' }}>
                {p.period_start} → {p.period_end}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {p.close_reason || 'No reason given'} · closed {new Date(p.closed_at).toLocaleDateString()}
                {p.closed_by ? ' by ' + p.closed_by : ''}
              </div>
            </div>
            <button
              onClick={() => handleReopen(p.id)}
              disabled={reopeningId === p.id}
              className="block-btn flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--color-warning, var(--color-accent-warning))', borderColor: 'var(--color-warning, var(--color-accent-warning))' }}
            >
              <Unlock size={12} /> {reopeningId === p.id ? 'Reopening…' : 'Reopen'}
            </button>
          </div>
        ))}
      </div>

      {/* History — reopened periods */}
      {history.length > 0 && (
        <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)' }}>
              Reopen History ({history.length})
            </div>
          </div>
          {history.map((p) => (
            <div key={p.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)', fontSize: 11 }}>
              <div style={{ fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)' }}>
                {p.period_start} → {p.period_end}
              </div>
              <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                Originally closed: {p.close_reason || '(no reason)'} on {new Date(p.closed_at).toLocaleDateString()}
              </div>
              <div style={{ color: 'var(--color-warning, var(--color-accent-warning))', marginTop: 1 }}>
                Reopened: {p.reopen_reason || '(no reason)'} on {p.reopened_at ? new Date(p.reopened_at).toLocaleDateString() : '?'}
                {p.reopened_by ? ' by ' + p.reopened_by : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)' }}>{label}</span>
    {children}
  </div>
);

export default PeriodCloseSettings;
