import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Lock, Unlock, CheckCircle2, SkipForward, Calendar, FileText, AlertTriangle, Mail,
  FileBarChart, RotateCcw, RefreshCw, Layers, GitBranch, CalendarDays } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import api from '../../lib/api';
import { toLocalDateString, fiscalYearEnd } from '../../lib/date-helpers';

const ADJUSTMENT_CATEGORIES = ['deferral', 'accrual', 'depreciation', 'inventory', 'revaluation', 'correction', 'other'] as const;

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
    // DATE: Item #2/#12 — local-time month-end string. For year-end close, the
    // user can use the "Fiscal Year-End" preset which respects fiscal_year_start.
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return toLocalDateString(lastDay);
  });
  // DATE: Item #12 — convenience setter for fiscal year-end close.
  const setFiscalYearEndPreset = useCallback(() => {
    const fy = activeCompany?.fiscal_year_start || 1;
    const fyEnd = fiscalYearEnd(new Date(), fy);
    const fyEndDate = new Date(`${fyEnd}T12:00:00`);
    const fyStart = new Date(fyEndDate.getFullYear(), fyEndDate.getMonth() - 11, 1);
    setPeriodStart(toLocalDateString(fyStart));
    setPeriodEnd(fyEnd);
  }, [activeCompany?.fiscal_year_start]);
  void setFiscalYearEndPreset; // exposed for future UI button; keeps logic colocated.
  const periodLabel = useMemo(() => `${periodStart}_${periodEnd}`, [periodStart, periodEnd]);

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [locks, setLocks] = useState<any[]>([]);
  const [closeLog, setCloseLog] = useState<any[]>([]);
  const [closingPreview, setClosingPreview] = useState<{ lines: any[]; netIncome: number; retainedEarnings: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email subscriber list (settings-backed)
  const [notifyList, setNotifyList] = useState('');

  // Round 2 state
  const [lockLevel, setLockLevel] = useState<'soft' | 'hard'>('hard');
  const [adjBreakdown, setAdjBreakdown] = useState<any[]>([]);
  const [cycleData, setCycleData] = useState<{ closes: any[]; locks: any[]; checklists: any[] }>({ closes: [], locks: [], checklists: [] });
  const [shortStart, setShortStart] = useState('');
  const [shortEnd, setShortEnd] = useState('');

  const reload = useCallback(async () => {
    if (!companyId) return;
    const [c, l, lg, ns, adj, cycle] = await Promise.all([
      window.electronAPI.invoke('close:checklist-list', { companyId, periodLabel }),
      window.electronAPI.invoke('close:list-locks', { companyId }),
      window.electronAPI.invoke('close:log-list', { companyId }),
      api.getSetting('period_close_notify_emails').catch(() => null),
      window.electronAPI.invoke('close:adjustment-breakdown', { companyId, periodStart, periodEnd }),
      window.electronAPI.invoke('close:cycle-dashboard', { companyId }),
    ]);
    setChecklist(c || []);
    setLocks(l || []);
    setCloseLog(lg || []);
    setNotifyList((ns as any) || '');
    setAdjBreakdown(adj || []);
    setCycleData(cycle || { closes: [], locks: [], checklists: [] });
  }, [companyId, periodLabel, periodStart, periodEnd]);

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
    const reason = prompt(`Reason for ${lockLevel} lock?`) || '';
    if (!reason) return;
    setBusy(true);
    const res = await window.electronAPI.invoke('close:lock-period-v2', {
      companyId, periodStart, periodEnd, lockedBy: 'user', reason, lockLevel,
    });
    if (res?.error) setError(res.error);
    await reload();
    setBusy(false);
  };

  // 2. Pre-close report bundle
  const generatePreCloseBundle = async () => {
    setBusy(true);
    const res: any = await window.electronAPI.invoke('close:pre-close-bundle', { companyId, periodStart, periodEnd });
    if (res?.error) { setError(res.error); setBusy(false); return; }
    const html = `<!DOCTYPE html><html><head><title>Pre-Close Bundle ${periodEnd}</title>
      <style>body{font-family:sans-serif;padding:24px;}h1{font-size:18px;}h2{font-size:13px;border-bottom:1px solid #ccc;margin-top:18px;}
      table{border-collapse:collapse;width:100%;font-size:11px;margin-top:6px;}td,th{border:1px solid #ccc;padding:4px;}</style>
      </head><body>
      <h1>Pre-Close Bundle: ${periodStart} → ${periodEnd}</h1>
      <h2>Trial Balance</h2>
      <table><tr><th>Code</th><th>Name</th><th>Type</th><th>Debit</th><th>Credit</th></tr>
      ${(res.tb || []).map((r: any) => `<tr><td>${r.code}</td><td>${r.name}</td><td>${r.type}</td><td align="right">${formatCurrency(r.debit_sum || 0)}</td><td align="right">${formatCurrency(r.credit_sum || 0)}</td></tr>`).join('')}
      </table>
      <h2>Reconciliations (${(res.recons || []).length})</h2>
      <table><tr><th>Date</th><th>Account</th><th>Variance</th></tr>
      ${(res.recons || []).map((r: any) => `<tr><td>${r.as_of_date}</td><td>${r.code} ${r.name}</td><td>${formatCurrency(r.variance || 0)}</td></tr>`).join('')}
      </table>
      <h2>Open Invoices (${(res.openInvoices || []).length})</h2>
      <table><tr><th>Invoice #</th><th>Date</th><th>Open Amount</th></tr>
      ${(res.openInvoices || []).map((r: any) => `<tr><td>${r.invoice_number}</td><td>${r.date}</td><td>${formatCurrency(r.open_amount || 0)}</td></tr>`).join('')}
      </table>
      <h2>Open Bills (${(res.openBills || []).length})</h2>
      <table><tr><th>Bill #</th><th>Date</th><th>Open Amount</th></tr>
      ${(res.openBills || []).map((r: any) => `<tr><td>${r.bill_number}</td><td>${r.date}</td><td>${formatCurrency(r.open_amount || 0)}</td></tr>`).join('')}
      </table>
      </body></html>`;
    await api.saveToPDF(html, `pre-close-bundle-${periodEnd}`, { openAfterSave: true });
    setBusy(false);
  };

  // 4. Email digest
  const generateDigest = async (logId: string) => {
    const res: any = await window.electronAPI.invoke('close:email-digest', { companyId, logId });
    if (res?.error) { setError(res.error); return; }
    const blob = new Blob([`<html><body>${res.html}</body></html>`], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  // 5. Roll-forward
  const rollForward = async (logId: string) => {
    const res: any = await window.electronAPI.invoke('close:roll-forward', { companyId, logId });
    if (res?.error) setError(res.error);
    else alert(res.alreadyDone ? 'Already rolled forward.' : `Snapshotted ${res.snapshotCount} balances.`);
    await reload();
  };

  // 6. Reopen
  const reopenPeriod = async (logId: string) => {
    const preview: any = await window.electronAPI.invoke('close:reopen-preview', { logId });
    if (preview?.error) { setError(preview.error); return; }
    const msg = `Reopen period ${preview.log.period_start} → ${preview.log.period_end}?\n\nThis will:\n` +
      `- Post a reversing JE for ${preview.closingJe?.entry_number || 'closing entry'} (${formatCurrency(preview.closingJe?.total || 0)})\n` +
      `- Unlock matching period locks\n\nProvide a reason in the next prompt.`;
    if (!confirm(msg)) return;
    const reason = prompt('Reason for reopening?') || '';
    if (!reason) return;
    const res: any = await window.electronAPI.invoke('close:reopen-commit', { logId, reopenedBy: 'user', reason });
    if (res?.error) setError(res.error);
    await reload();
  };

  // 8. Short-period close
  const commitShortPeriod = async () => {
    if (!shortStart || !shortEnd) { setError('Pick stub period dates.'); return; }
    const reason = prompt('Reason for short-period close (e.g. "Fiscal year change")?') || '';
    if (!reason) return;
    const res: any = await window.electronAPI.invoke('close:short-period-commit',
      { companyId, periodStart: shortStart, periodEnd: shortEnd, closedBy: 'user', reason });
    if (res?.error) setError(res.error);
    else alert('Short period locked.');
    await reload();
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
          <div className="flex gap-1 mb-2 text-[11px]">
            <label className="flex items-center gap-1"><input type="radio" checked={lockLevel === 'soft'} onChange={() => setLockLevel('soft')} />Soft (warn)</label>
            <label className="flex items-center gap-1"><input type="radio" checked={lockLevel === 'hard'} onChange={() => setLockLevel('hard')} />Hard (block)</label>
          </div>
          <button disabled={busy || !companyId} onClick={lockPeriod} className="w-full px-2 py-1.5 text-xs font-semibold bg-accent-blue text-white">
            {lockLevel === 'soft' ? 'Soft' : 'Hard'} lock {periodStart} → {periodEnd}
          </button>
          <div className="mt-3 max-h-48 overflow-y-auto text-xs">
            {locks.length === 0 && <div className="text-text-muted">No locks yet.</div>}
            {locks.map((l) => (
              <div key={l.id} className="flex items-center justify-between py-1 border-b border-border-primary">
                <span className={l.unlocked_at ? 'line-through text-text-muted' : 'text-text-primary'}>
                  {l.period_start || '—'} → {l.period_end || l.locked_through_date}
                  <span className={`ml-1 text-[9px] px-1 ${l.lock_level === 'soft' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>{(l.lock_level || 'hard').toUpperCase()}</span>
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
              <div key={e.id} className="flex justify-between items-center py-1 border-b border-border-primary gap-1 flex-wrap">
                <span>
                  {e.period_start} → {e.period_end} · {formatCurrency(e.net_income || 0)} · by {e.closed_by}
                  {e.is_short_period ? <span className="ml-1 text-[9px] px-1 bg-blue-500/20 text-blue-400">SHORT</span> : null}
                  {e.reopened_at ? <span className="ml-1 text-[9px] px-1 bg-yellow-500/20 text-yellow-400">REOPENED</span> : null}
                  {e.roll_forward_done ? <span className="ml-1 text-[9px] px-1 bg-green-500/20 text-green-400">RF</span> : null}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => printCloseReport(e)} className="px-1.5 py-0.5 text-[10px] border border-border-primary">PDF</button>
                  <button onClick={() => generateDigest(e.id)} className="px-1.5 py-0.5 text-[10px] border border-border-primary">Digest</button>
                  <button onClick={() => rollForward(e.id)} className="px-1.5 py-0.5 text-[10px] border border-border-primary">Roll fwd</button>
                  {!e.reopened_at && <button onClick={() => reopenPeriod(e.id)} className="px-1.5 py-0.5 text-[10px] border border-yellow-500/50 text-yellow-400">Reopen</button>}
                </div>
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

      {/* 2. Pre-close report bundle button */}
      <div className="p-3 border border-border-primary flex items-center gap-3">
        <FileBarChart size={14} />
        <div className="flex-1">
          <div className="text-xs font-bold">Pre-close report bundle</div>
          <div className="text-[11px] text-text-muted">Generates TB + reconciliations + open invoices/bills as a single PDF.</div>
        </div>
        <button disabled={busy} onClick={generatePreCloseBundle} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">Generate</button>
      </div>

      {/* 3. Adjustment categorization breakdown */}
      <div className="p-3 border border-border-primary">
        <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><Layers size={12} /> Adjustment categorization (this period)</div>
        {adjBreakdown.length === 0 ? <div className="text-xs text-text-muted">No posted JEs in period.</div> : (
          <table className="w-full text-xs">
            <tbody>
              {adjBreakdown.map((c: any) => (
                <tr key={c.category} className="border-b border-border-primary">
                  <td className="py-0.5 capitalize">{c.category}</td>
                  <td className="text-right">{c.count} JE</td>
                  <td className="text-right">{formatCurrency(c.total_debit || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-[10px] text-text-muted mt-1">Categorize adjusting JEs via journal entry form (deferral/accrual/depreciation/inventory/revaluation/correction/other).</div>
      </div>

      {/* 8. Mid-period (short-period) close */}
      <div className="p-3 border border-border-primary">
        <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><CalendarDays size={12} /> Mid-period (short-period) close</div>
        <div className="flex items-end gap-2">
          <div><label className="block text-[10px] text-text-muted">Stub start</label><input type="date" value={shortStart} onChange={(e) => setShortStart(e.target.value)} className="px-2 py-1 text-xs bg-bg-primary border border-border-primary" /></div>
          <div><label className="block text-[10px] text-text-muted">Stub end</label><input type="date" value={shortEnd} onChange={(e) => setShortEnd(e.target.value)} className="px-2 py-1 text-xs bg-bg-primary border border-border-primary" /></div>
          <button disabled={busy} onClick={commitShortPeriod} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">Close stub period</button>
        </div>
        <div className="text-[10px] text-text-muted mt-1">For non-standard periods (e.g., 14-day stub when changing fiscal year). Locks period without revenue/expense roll.</div>
      </div>

      {/* 9. Close cycle dashboard */}
      <div className="p-3 border border-border-primary">
        <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><Calendar size={12} /> Close cycle dashboard</div>
        <div className="grid grid-cols-12 gap-1">
          {(() => {
            const tiles: React.ReactNode[] = [];
            const now = new Date();
            for (let i = 11; i >= 0; i--) {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              const ym = d.toISOString().slice(0, 7);
              const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
              const close = cycleData.closes.find((c: any) => (c.period_end || '').slice(0, 7) === ym);
              const cl = cycleData.checklists.find((c: any) => (c.period_label || '').includes(ym));
              const inProgress = cl && cl.done > 0 && cl.done < cl.total;
              const status = close ? 'closed' : inProgress ? 'progress' : 'open';
              const bg = status === 'closed' ? 'bg-green-500/30 border-green-500/50' : status === 'progress' ? 'bg-yellow-500/30 border-yellow-500/50' : 'bg-bg-secondary border-border-primary';
              tiles.push(<div key={ym} className={`p-1 border ${bg} text-[10px]`} title={`${ym} · ${status}${close ? ' · ' + (close.closed_at || '').slice(0,10) : ''}`}>{ym.slice(5)}<br /><span className="text-[9px] text-text-muted">{status === 'closed' ? '✓' : status === 'progress' ? '…' : '·'}</span></div>);
              void last;
            }
            return tiles;
          })()}
        </div>
      </div>

      {/* 10. Close-status heat map (24 months) */}
      <div className="p-3 border border-border-primary">
        <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><GitBranch size={12} /> Close timeliness — last 24 months</div>
        <div className="grid grid-cols-12 gap-0.5">
          {(() => {
            const cells: React.ReactNode[] = [];
            const now = new Date();
            for (let i = 23; i >= 0; i--) {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              const ym = d.toISOString().slice(0, 7);
              const close = cycleData.closes.find((c: any) => (c.period_end || '').slice(0, 7) === ym);
              let color = 'bg-bg-secondary';
              if (close && close.closed_at) {
                const periodEnd = new Date(close.period_end);
                const closedAt = new Date(close.closed_at);
                const diff = (closedAt.getTime() - periodEnd.getTime()) / 86400000;
                color = diff <= 5 ? 'bg-green-500' : diff <= 15 ? 'bg-yellow-500' : diff <= 30 ? 'bg-orange-500' : 'bg-red-500';
              }
              cells.push(<div key={ym} title={`${ym}${close ? ' · closed ' + (close.closed_at || '').slice(0,10) : ' · not closed'}`} className={`h-5 ${color}`} />);
            }
            return cells;
          })()}
        </div>
        <div className="text-[10px] text-text-muted mt-1">Green ≤5d · Yellow ≤15d · Orange ≤30d · Red &gt;30d · Grey not closed.</div>
      </div>

      <div className="text-[11px] text-text-muted flex items-center gap-1">
        <AlertTriangle size={11} /> Date inputs throughout the app show a lock icon when the date falls in a closed period (use <code>useDateLock</code> hook). Soft locks warn but allow posting; hard locks block.
      </div>
    </div>
  );
};

export default PeriodCloseWorkflow;
