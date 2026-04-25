import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Lock, Unlock, CheckCircle2, SkipForward, Calendar, FileText, AlertTriangle, Mail } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import api from '../../lib/api';

// ─── Period Close Workflow ──────────────────────────────────
// Implements features 1–10:
//  1) multi-step workflow  2) persistent checklist  3) period lock
//  4) period unlock w/ comment + audit  5) year-end close  6) closing preview
//  7) period close report  8) audit trail  9) email notify list  10) lock indicators

const STEPS: Array<{ key: string; label: string; description: string }> = [
  { key: 'reconcile_banks', label: 'Reconcile bank accounts', description: 'Confirm all bank reconciliations are complete through period end.' },
  { key: 'review_accruals', label: 'Review accruals', description: 'Review accrued revenue/expense, prepaid amortization, deferred income.' },
  { key: 'review_pending_jes', label: 'Review pending JEs', description: 'Approve/reject all draft journal entries.' },
  { key: 'adjusting_entries', label: 'Post adjusting entries', description: 'Depreciation, amortization, accruals, reclassifications.' },
  { key: 'close_period', label: 'Close period', description: 'Lock the period to prevent further postings.' },
];

interface ChecklistItem { id: string; item_key: string; item_label: string; completed_at: string; completed_by: string; skipped: number; note: string; }

const PeriodCloseWorkflow: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const today = new Date();
  const [periodStart, setPeriodStart] = useState(() => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`);
  const [periodEnd, setPeriodEnd] = useState(() => {
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return lastDay.toISOString().slice(0, 10);
  });
  const periodLabel = useMemo(() => `${periodStart}_${periodEnd}`, [periodStart, periodEnd]);

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [locks, setLocks] = useState<any[]>([]);
  const [closeLog, setCloseLog] = useState<any[]>([]);
  const [closingPreview, setClosingPreview] = useState<{ lines: any[]; netIncome: number; retainedEarnings: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email subscriber list (settings-backed)
  const [notifyList, setNotifyList] = useState('');

  const reload = useCallback(async () => {
    if (!companyId) return;
    const [c, l, lg, ns] = await Promise.all([
      window.electronAPI.invoke('close:checklist-list', { companyId, periodLabel }),
      window.electronAPI.invoke('close:list-locks', { companyId }),
      window.electronAPI.invoke('close:log-list', { companyId }),
      api.getSetting('period_close_notify_emails').catch(() => null),
    ]);
    setChecklist(c || []);
    setLocks(l || []);
    setCloseLog(lg || []);
    setNotifyList((ns as any) || '');
  }, [companyId, periodLabel]);

  useEffect(() => { reload(); }, [reload]);

  const itemFor = (key: string) => checklist.find(c => c.item_key === key);

  const toggle = async (step: { key: string; label: string }, field: 'completed' | 'skipped') => {
    setBusy(true); setError(null);
    const existing = itemFor(step.key);
    const completed = field === 'completed' ? !existing?.completed_at : !!existing?.completed_at;
    const skipped = field === 'skipped' ? !existing?.skipped : !!existing?.skipped;
    await window.electronAPI.invoke('close:checklist-toggle', {
      companyId, periodLabel, itemKey: step.key, itemLabel: step.label,
      completed, skipped, by: 'user',
    });
    await reload();
    setBusy(false);
  };

  const lockPeriod = async () => {
    if (!companyId) return;
    const reason = prompt('Reason for locking this period?') || '';
    if (!reason) return;
    setBusy(true);
    const res = await window.electronAPI.invoke('close:lock-period', {
      companyId, periodStart, periodEnd, lockedBy: 'user', reason,
    });
    if (res?.error) setError(res.error);
    await reload();
    setBusy(false);
  };

  const unlockPeriod = async (lockId: string, override: boolean) => {
    const reason = prompt(override ? 'Override reason (admin):' : 'Unlock reason:') || '';
    if (!reason) return;
    setBusy(true);
    await window.electronAPI.invoke('close:unlock-period', { lockId, unlockedBy: 'user', reason, override });
    await reload();
    setBusy(false);
  };

  const previewClosing = async () => {
    setBusy(true); setError(null);
    const res = await window.electronAPI.invoke('close:closing-preview', { companyId, periodStart, periodEnd });
    if (res?.error) setError(res.error);
    setClosingPreview(res);
    setBusy(false);
  };

  const commitClosing = async () => {
    if (!confirm('Post year-end closing entries and lock the period?')) return;
    setBusy(true); setError(null);
    const res = await window.electronAPI.invoke('close:closing-commit', { companyId, periodStart, periodEnd, closedBy: 'user' });
    if (res?.error) setError(res.error);
    setClosingPreview(null);
    await reload();
    setBusy(false);
  };

  const saveNotifyList = async () => {
    await api.setSetting('period_close_notify_emails', notifyList);
    alert('Saved.');
  };

  const printCloseReport = async (entry: any) => {
    const html = `<!DOCTYPE html><html><head><title>Period Close Report ${entry.period_end}</title>
      <style>body{font-family:sans-serif;padding:32px;}h1{font-size:18px;}table{border-collapse:collapse;width:100%;font-size:12px;}td,th{border:1px solid #ccc;padding:6px;}</style>
      </head><body>
      <h1>Period Close Report</h1>
      <p><b>Period:</b> ${entry.period_start} — ${entry.period_end}</p>
      <p><b>Closed by:</b> ${entry.closed_by} on ${entry.closed_at}</p>
      <p><b>Net income transferred to RE:</b> ${formatCurrency(entry.net_income || 0)}</p>
      <p><b>Closing JE:</b> ${entry.je_number || entry.closing_je_id}</p>
      </body></html>`;
    await api.saveToPDF(html, `period-close-${entry.period_end}`, { openAfterSave: true });
  };

  const completedCount = checklist.filter(c => c.completed_at).length;

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-end gap-3 p-4 bg-bg-secondary border border-border-primary">
        <div>
          <label className="block text-xs text-text-muted mb-1">Period start</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
            className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Period end</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}
            className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        </div>
        <div className="text-xs text-text-muted ml-auto">
          {completedCount} / {STEPS.length} steps done
        </div>
      </div>

      {error && <div className="p-2 bg-red-500/10 border border-red-500/40 text-xs text-red-400">{error}</div>}

      {/* Steps */}
      <div className="border border-border-primary">
        {STEPS.map((step, idx) => {
          const item = itemFor(step.key);
          const done = !!item?.completed_at;
          const skipped = !!item?.skipped;
          return (
            <div key={step.key} className="p-3 border-b border-border-primary last:border-b-0 flex items-start gap-3">
              <div className={`w-7 h-7 flex items-center justify-center text-xs font-bold border ${done ? 'bg-green-500/20 border-green-500/50 text-green-400' : skipped ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' : 'border-border-primary text-text-muted'}`}>
                {idx + 1}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-text-primary">{step.label}</div>
                <div className="text-xs text-text-muted">{step.description}</div>
                {item?.completed_at && <div className="text-[11px] text-green-400 mt-1">Completed by {item.completed_by} at {item.completed_at}</div>}
                {item?.skipped ? <div className="text-[11px] text-yellow-400 mt-1">Skipped</div> : null}
              </div>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => toggle(step, 'completed')}
                  className={`px-2 py-1 text-[11px] font-semibold border ${done ? 'bg-green-500/20 border-green-500 text-green-400' : 'border-border-primary text-text-secondary hover:bg-bg-secondary'}`}>
                  <CheckCircle2 size={12} className="inline mr-1" />{done ? 'Done' : 'Mark done'}
                </button>
                <button disabled={busy} onClick={() => toggle(step, 'skipped')}
                  className={`px-2 py-1 text-[11px] font-semibold border ${skipped ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400' : 'border-border-primary text-text-secondary hover:bg-bg-secondary'}`}>
                  <SkipForward size={12} className="inline mr-1" />Skip
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lock controls */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 border border-border-primary">
          <div className="text-xs font-bold text-text-primary mb-2 flex items-center gap-1.5"><Lock size={12} /> Period lock</div>
          <button disabled={busy || !companyId} onClick={lockPeriod} className="w-full px-2 py-1.5 text-xs font-semibold bg-accent-blue text-white">
            Lock {periodStart} → {periodEnd}
          </button>
          <div className="mt-3 max-h-48 overflow-y-auto text-xs">
            {locks.length === 0 && <div className="text-text-muted">No locks yet.</div>}
            {locks.map((l) => (
              <div key={l.id} className="flex items-center justify-between py-1 border-b border-border-primary">
                <span className={l.unlocked_at ? 'line-through text-text-muted' : 'text-text-primary'}>
                  {l.period_start || '—'} → {l.period_end || l.locked_through_date}
                  {l.reason && <span className="text-text-muted"> · {l.reason}</span>}
                </span>
                {!l.unlocked_at && (
                  <div className="flex gap-1">
                    <button onClick={() => unlockPeriod(l.id, false)} className="px-1.5 py-0.5 text-[10px] border border-border-primary"><Unlock size={10} className="inline" /> unlock</button>
                    <button onClick={() => unlockPeriod(l.id, true)} className="px-1.5 py-0.5 text-[10px] border border-yellow-500/50 text-yellow-400">override</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Year-end close */}
        <div className="p-3 border border-border-primary">
          <div className="text-xs font-bold text-text-primary mb-2 flex items-center gap-1.5"><Calendar size={12} /> Year-end close</div>
          <div className="flex gap-2 mb-2">
            <button disabled={busy} onClick={previewClosing} className="px-2 py-1.5 text-xs font-semibold border border-border-primary">Preview closing entries</button>
            {closingPreview && closingPreview.lines.length > 0 && (
              <button disabled={busy} onClick={commitClosing} className="px-2 py-1.5 text-xs font-semibold bg-accent-blue text-white">Commit close</button>
            )}
          </div>
          {closingPreview && (
            <div className="text-xs max-h-48 overflow-y-auto">
              <div className="font-semibold mb-1">Net income: {formatCurrency(closingPreview.netIncome)}</div>
              {closingPreview.lines.map((l: any, i: number) => (
                <div key={i} className="grid grid-cols-3 gap-1 py-0.5 border-b border-border-primary">
                  <span>{l.code} {l.name}</span>
                  <span className="text-right">{l.debit ? formatCurrency(l.debit) : ''}</span>
                  <span className="text-right">{l.credit ? formatCurrency(l.credit) : ''}</span>
                </div>
              ))}
              {closingPreview.retainedEarnings && (
                <div className="grid grid-cols-3 gap-1 py-0.5 font-semibold">
                  <span>To {closingPreview.retainedEarnings.name}</span>
                  <span className="text-right">{closingPreview.netIncome < 0 ? formatCurrency(Math.abs(closingPreview.netIncome)) : ''}</span>
                  <span className="text-right">{closingPreview.netIncome > 0 ? formatCurrency(closingPreview.netIncome) : ''}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Audit trail + notifications */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 border border-border-primary">
          <div className="text-xs font-bold text-text-primary mb-2 flex items-center gap-1.5"><FileText size={12} /> Close audit trail</div>
          <div className="max-h-48 overflow-y-auto text-xs">
            {closeLog.length === 0 && <div className="text-text-muted">No closes recorded.</div>}
            {closeLog.map((e: any) => (
              <div key={e.id} className="flex justify-between items-center py-1 border-b border-border-primary">
                <span>{e.period_start} → {e.period_end} · {formatCurrency(e.net_income || 0)} · by {e.closed_by}</span>
                <button onClick={() => printCloseReport(e)} className="px-1.5 py-0.5 text-[10px] border border-border-primary">PDF</button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 border border-border-primary">
          <div className="text-xs font-bold text-text-primary mb-2 flex items-center gap-1.5"><Mail size={12} /> Notify on close</div>
          <textarea value={notifyList} onChange={(e) => setNotifyList(e.target.value)} rows={4}
            placeholder="comma-separated emails"
            className="w-full px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
          <button onClick={saveNotifyList} className="mt-2 px-2 py-1 text-xs border border-border-primary">Save list</button>
        </div>
      </div>

      <div className="text-[11px] text-text-muted flex items-center gap-1">
        <AlertTriangle size={11} /> Date inputs throughout the app show a lock icon when the date falls in a closed period (use <code>useDateLock</code> hook).
      </div>
    </div>
  );
};

export default PeriodCloseWorkflow;
