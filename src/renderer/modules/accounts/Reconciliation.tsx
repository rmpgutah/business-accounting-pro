import React, { useEffect, useState, useCallback } from 'react';
import { Scale, Save, ArrowRightLeft, RefreshCw, Star, Upload, Download, Bell, Layers, History, ListChecks } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';
import api from '../../lib/api';

// Star confidence indicator (1–5)
const Stars: React.FC<{ n: number }> = ({ n }) => (
  <span className="inline-flex">{[1,2,3,4,5].map(i => <Star key={i} size={10} className={i <= n ? 'text-yellow-400 fill-current' : 'text-text-muted'} />)}</span>
);

// ─── Account Reconciliation (sub-ledger ↔ GL) ─────────────────
// Implements features 11–20.

interface Account { id: string; code: string; name: string; type: string; subtype: string; }

const AccountReconciliation: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [asOfDate, setAsOfDate] = useState(() => todayLocal());
  const [computed, setComputed] = useState<any>(null);
  const [matches, setMatches] = useState<{ matches: any[]; suggestions: any[] }>({ matches: [], suggestions: [] });
  const [history, setHistory] = useState<any[]>([]);
  const [interCo, setInterCo] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Round 2 state
  const [items, setItems] = useState<any[]>([]);
  const [prior, setPrior] = useState<{ prior: any; uncleared: any[] }>({ prior: null, uncleared: [] });
  const [multi, setMulti] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [autoApprove, setAutoApprove] = useState<{ autoApprove: boolean; threshold: number }>({ autoApprove: false, threshold: 0 });
  const [statementFile, setStatementFile] = useState<File | null>(null);

  useEffect(() => {
    if (!companyId) return;
    api.query('accounts', { company_id: companyId }, { field: 'code', dir: 'asc' }).then((res: any[]) => {
      // Filter to control / sub-ledger accounts
      const filtered = res.filter((a: any) => {
        const n = (a.name || '').toLowerCase();
        return n.includes('receivable') || n.includes('payable') || n.includes('inventory') ||
               n.includes('due to') || n.includes('due from') || n.includes('intercompany');
      });
      setAccounts(filtered);
    });
    window.electronAPI.invoke('recon:history', { companyId }).then(setHistory);
    window.electronAPI.invoke('recon:intercompany').then(setInterCo);
    window.electronAPI.invoke('recon:schedule-list', { companyId }).then(setSchedules);
  }, [companyId]);

  const compute = useCallback(async () => {
    if (!accountId || !companyId) return;
    setBusy(true);
    const res = await window.electronAPI.invoke('recon:compute', { companyId, accountId, asOfDate });
    setComputed(res);
    // Use v2 with confidence/delta
    const m = await window.electronAPI.invoke('recon:auto-match-v2', { companyId, accountId, asOfDate });
    setMatches(m);
    const it = await window.electronAPI.invoke('recon:items-list', { companyId, accountId, asOfDate });
    setItems(it || []);
    const pp = await window.electronAPI.invoke('recon:prior-period', { companyId, accountId, asOfDate });
    setPrior(pp || { prior: null, uncleared: [] });
    const imp = await window.electronAPI.invoke('recon:imports-list', { companyId, accountId });
    setImports(imp || []);
    if (res && !res.error) {
      const aa = await window.electronAPI.invoke('recon:auto-approve-check', { companyId, accountId, variance: res.variance });
      setAutoApprove(aa || { autoApprove: false, threshold: 0 });
    }
    setBusy(false);
  }, [accountId, asOfDate, companyId]);

  // 14. Export reconciled items CSV
  const exportItemsCsv = () => {
    const rows = [
      ['Type', 'Reference', 'Date', 'Sub Amount', 'GL Amount', 'Delta', 'Confidence', 'Status', 'Note'],
      ...matches.matches.map((m: any) => ['matched', m.sub.reference || '', m.sub.date || '', (m.sub.amount || 0).toFixed(2),
        (((m.gl.debit || 0) - (m.gl.credit || 0)) || 0).toFixed(2), (m.delta || 0).toFixed(2), m.confidence || 0, 'matched', '']),
      ...matches.suggestions.map((m: any) => ['suggested', m.sub.reference || '', m.sub.date || '', (m.sub.amount || 0).toFixed(2),
        (((m.gl.debit || 0) - (m.gl.credit || 0)) || 0).toFixed(2), (m.delta || 0).toFixed(2), m.confidence || 0, 'suggested', '']),
      ...items.map((it: any) => ['unmatched', it.reference || '', '', (it.amount || 0).toFixed(2), '', '', it.confidence || 0, it.status || 'open', it.note || '']),
    ];
    const csv = rows.map(r => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `recon-${asOfDate}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // 11. Save item note
  const saveItemNote = async (transactionId: string, reference: string, amount: number, note: string, status: string) => {
    await window.electronAPI.invoke('recon:item-save', {
      companyId, accountId, asOfDate, transactionId, reference, amount, note, status,
    });
    const it = await window.electronAPI.invoke('recon:items-list', { companyId, accountId, asOfDate });
    setItems(it || []);
  };

  // 13. Import bank-style CSV
  const importStatement = async () => {
    if (!statementFile) return;
    const text = await statementFile.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const rows = lines.slice(1).map((l) => {
      const cols = l.split(',').map((c) => c.replace(/^"|"$/g, ''));
      return { date: cols[0] || '', reference: cols[1] || '', amount: Number(cols[2] || 0), description: cols[3] || '' };
    });
    const statementBalance = rows.reduce((s, r) => s + (r.amount || 0), 0);
    await window.electronAPI.invoke('recon:import-statement', {
      companyId, accountId, asOfDate, statementBalance, rows, importedBy: 'user',
    });
    const imp = await window.electronAPI.invoke('recon:imports-list', { companyId, accountId });
    setImports(imp || []);
    alert(`Imported ${rows.length} statement rows. Statement balance: ${formatCurrency(statementBalance)}`);
  };

  // 15. Multi-account recon
  const computeMulti = async () => {
    const res = await window.electronAPI.invoke('recon:multi-compute', { companyId, asOfDate });
    setMulti(res || []);
  };

  // 16. Schedule add
  const addSchedule = async () => {
    if (!accountId) { alert('Select an account first.'); return; }
    const freq = prompt('Frequency (weekly|monthly|quarterly)?', 'monthly') || 'monthly';
    const threshold = Number(prompt('Variance auto-approve threshold ($)?', '5') || 0);
    await window.electronAPI.invoke('recon:schedule-save', { companyId, accountId, frequency: freq, threshold });
    const list = await window.electronAPI.invoke('recon:schedule-list', { companyId });
    setSchedules(list || []);
  };

  const deleteSchedule = async (id: string) => {
    await window.electronAPI.invoke('recon:schedule-delete', { id });
    const list = await window.electronAPI.invoke('recon:schedule-list', { companyId });
    setSchedules(list || []);
  };

  // 19. Carry forward uncleared into current
  const carryForward = async () => {
    if (!prior.uncleared.length) return;
    for (const u of prior.uncleared) {
      await window.electronAPI.invoke('recon:item-save', {
        companyId, accountId, asOfDate,
        transactionId: u.transaction_id, reference: u.reference, amount: u.amount,
        note: u.note, status: 'open', rolledFromId: u.id,
      });
    }
    const it = await window.electronAPI.invoke('recon:items-list', { companyId, accountId, asOfDate });
    setItems(it || []);
    alert(`Carried forward ${prior.uncleared.length} uncleared items.`);
  };

  const save = async () => {
    if (!computed) return;
    setBusy(true);
    await window.electronAPI.invoke('recon:save', {
      companyId, accountId, asOfDate,
      subLedgerTotal: computed.sub_ledger_total,
      glTotal: computed.gl_total,
      variance: computed.variance,
      notes,
      reconciledBy: 'user',
      matches: matches.matches.map(m => ({ subId: m.sub.id, glId: m.gl.id, reason: m.reason })),
    });
    const fresh = await window.electronAPI.invoke('recon:history', { companyId });
    setHistory(fresh);
    setNotes('');
    setBusy(false);
    alert('Reconciliation saved.');
  };

  const exportReport = async () => {
    if (!computed) return;
    const html = `<!DOCTYPE html><html><head><title>Reconciliation ${computed.account?.code}</title>
      <style>body{font-family:sans-serif;padding:24px;}table{border-collapse:collapse;width:100%;font-size:12px;}td,th{border:1px solid #ccc;padding:6px;}h1{font-size:16px;}</style>
      </head><body>
      <h1>Account Reconciliation: ${computed.account?.code} ${computed.account?.name}</h1>
      <p>As of ${asOfDate}</p>
      <table><tr><td>Sub-ledger total</td><td align="right">${formatCurrency(computed.sub_ledger_total)}</td></tr>
      <tr><td>GL balance</td><td align="right">${formatCurrency(computed.gl_total)}</td></tr>
      <tr><td><b>Variance</b></td><td align="right"><b>${formatCurrency(computed.variance)}</b></td></tr></table>
      <h2 style="font-size:13px;">Matched (${matches.matches.length})</h2>
      <table><tr><th>Sub ref</th><th>Amount</th><th>GL #</th><th>Reason</th></tr>
      ${matches.matches.map(m => `<tr><td>${m.sub.reference || ''}</td><td>${formatCurrency(m.sub.amount || 0)}</td><td>${m.gl.entry_number || ''}</td><td>${m.reason}</td></tr>`).join('')}
      </table>
      <h2 style="font-size:13px;">Suggestions (${matches.suggestions.length})</h2>
      <table><tr><th>Sub ref</th><th>Amount</th><th>GL #</th><th>Reason</th></tr>
      ${matches.suggestions.map(m => `<tr><td>${m.sub.reference || ''}</td><td>${formatCurrency(m.sub.amount || 0)}</td><td>${m.gl.entry_number || ''}</td><td>${m.reason}</td></tr>`).join('')}
      </table>
      </body></html>`;
    await api.saveToPDF(html, `recon-${computed.account?.code}-${asOfDate}`, { openAfterSave: true });
  };

  const account = accounts.find(a => a.id === accountId);

  return (
    <div className="space-y-4">
      {/* Selector */}
      <div className="flex items-end gap-3 p-4 bg-bg-secondary border border-border-primary">
        <div className="flex-1">
          <label className="block text-xs text-text-muted mb-1">Control account</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="w-full px-2 py-1.5 text-xs bg-bg-primary border border-border-primary">
            <option value="">— select —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">As of</label>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
            className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        </div>
        <button onClick={compute} disabled={!accountId || busy}
          className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">
          <RefreshCw size={12} className="inline mr-1" />Compute
        </button>
      </div>

      {/* Variance */}
      {computed && !computed.error && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Sub-ledger" value={formatCurrency(computed.sub_ledger_total)} />
          <Stat label="GL balance" value={formatCurrency(computed.gl_total)} />
          <Stat label="Variance" value={formatCurrency(computed.variance)} accent={Math.abs(computed.variance) < 0.01 ? 'green' : 'red'} />
        </div>
      )}

      {/* Side-by-side variance investigation */}
      {computed && !computed.error && (
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-border-primary p-2">
            <div className="text-xs font-bold mb-2">Sub-ledger items ({computed.sub_ledger_items?.length || 0})</div>
            <div className="max-h-72 overflow-y-auto text-xs">
              {(computed.sub_ledger_items || []).map((it: any) => (
                <div key={it.id} className="flex justify-between py-0.5 border-b border-border-primary">
                  <span>{it.reference} · {it.date}</span>
                  <span>{formatCurrency(it.amount || 0)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border border-border-primary p-2">
            <div className="text-xs font-bold mb-2 flex items-center gap-1.5">
              <ArrowRightLeft size={12} /> Auto-matches ({matches.matches.length}) · Suggestions ({matches.suggestions.length})
            </div>
            <div className="max-h-72 overflow-y-auto text-xs">
              {matches.matches.map((m: any, i: number) => (
                <div key={`m${i}`} className="py-0.5 border-b border-border-primary flex items-center gap-2 flex-wrap">
                  <span className="text-green-400">✓</span> {m.sub.reference} ↔ {m.gl.entry_number}
                  <Stars n={m.confidence || 0} />
                  {Math.abs(m.delta || 0) > 0.01 && <span className="text-red-400 font-bold">Δ {formatCurrency(m.delta)}</span>}
                  <span className="text-text-muted text-[10px]">({m.reason})</span>
                </div>
              ))}
              {matches.suggestions.map((m: any, i: number) => (
                <div key={`s${i}`} className="py-0.5 border-b border-border-primary flex items-center gap-2 flex-wrap">
                  <span className="text-yellow-400">?</span> {m.sub.reference || formatCurrency(m.sub.amount || 0)} ↔ {m.gl.entry_number}
                  <Stars n={m.confidence || 0} />
                  {Math.abs(m.delta || 0) > 0.01 && <span className="text-red-400 font-bold">Δ {formatCurrency(m.delta)}</span>}
                  <span className="text-text-muted text-[10px]">({m.reason})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Save + report */}
      {computed && !computed.error && (
        <div className="flex items-center gap-2">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reconciliation notes"
            className="flex-1 px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
          <button onClick={save} disabled={busy} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">
            <Save size={12} className="inline mr-1" />Save
          </button>
          <button onClick={exportReport} className="px-3 py-1.5 text-xs font-semibold border border-border-primary">PDF</button>
        </div>
      )}

      {/* Inter-company */}
      <div className="border border-border-primary p-3">
        <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><Scale size={12} /> Inter-company balances</div>
        {interCo.length === 0 && <div className="text-xs text-text-muted">No inter-company accounts found.</div>}
        <table className="w-full text-xs">
          <tbody>
            {interCo.map((r: any, i: number) => (
              <tr key={i} className="border-b border-border-primary">
                <td className="py-1">{r.company_name}</td>
                <td>{r.code} {r.name}</td>
                <td className="text-right">{formatCurrency(r.balance || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* History */}
      <div className="border border-border-primary p-3">
        <div className="text-xs font-bold mb-2">Reconciliation history</div>
        {history.length === 0 && <div className="text-xs text-text-muted">No prior reconciliations.</div>}
        <table className="w-full text-xs">
          <tbody>
            {history.map((h: any) => (
              <tr key={h.id} className="border-b border-border-primary">
                <td className="py-1">{h.as_of_date}</td>
                <td>{h.code} {h.name}</td>
                <td className="text-right">{formatCurrency(h.sub_ledger_total)}</td>
                <td className="text-right">{formatCurrency(h.gl_total)}</td>
                <td className={`text-right ${Math.abs(h.variance) < 0.01 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(h.variance)}</td>
                <td className="text-text-muted">{h.reconciled_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 17. Auto-approve banner */}
      {computed && autoApprove.threshold > 0 && (
        <div className={`p-2 text-xs border ${autoApprove.autoApprove ? 'bg-green-500/10 border-green-500/40 text-green-400' : 'bg-bg-secondary border-border-primary'}`}>
          Threshold: {formatCurrency(autoApprove.threshold)} · {autoApprove.autoApprove ? 'Auto-approval eligible (variance within threshold).' : 'Variance exceeds threshold; manual review required.'}
        </div>
      )}

      {/* 11. Recon notes per item (unmatched + saved items) */}
      {computed && (
        <div className="border border-border-primary p-3">
          <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><ListChecks size={12} /> Item-level notes</div>
          {(computed.sub_ledger_items || []).filter((it: any) => !matches.matches.find((m: any) => m.sub.id === it.id)).slice(0, 30).map((it: any) => {
            const saved = items.find(s => s.transaction_id === it.id);
            return (
              <div key={it.id} className="flex items-center gap-2 py-1 border-b border-border-primary text-xs">
                <span className="w-32 truncate">{it.reference}</span>
                <span className="w-20 text-right">{formatCurrency(it.amount || 0)}</span>
                <input defaultValue={saved?.note || ''} placeholder="note"
                  onBlur={(e) => saveItemNote(it.id, it.reference, it.amount, e.target.value, saved?.status || 'open')}
                  className="flex-1 px-1.5 py-0.5 text-xs bg-bg-primary border border-border-primary" />
                <select defaultValue={saved?.status || 'open'}
                  onChange={(e) => saveItemNote(it.id, it.reference, it.amount, saved?.note || '', e.target.value)}
                  className="px-1 py-0.5 text-[10px] bg-bg-primary border border-border-primary">
                  <option value="open">Open</option>
                  <option value="cleared">Cleared</option>
                  <option value="disputed">Disputed</option>
                  <option value="written_off">Written off</option>
                </select>
              </div>
            );
          })}
          {!computed.sub_ledger_items?.length && <div className="text-text-muted text-xs">No sub-ledger items.</div>}
        </div>
      )}

      {/* 14. Export reconciled items + 13. Import statement */}
      {computed && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportItemsCsv} className="px-3 py-1.5 text-xs font-semibold border border-border-primary"><Download size={11} className="inline mr-1" />Export items CSV</button>
          <input type="file" accept=".csv" onChange={(e) => setStatementFile(e.target.files?.[0] || null)} className="text-xs" />
          <button disabled={!statementFile} onClick={importStatement} className="px-3 py-1.5 text-xs font-semibold border border-border-primary"><Upload size={11} className="inline mr-1" />Import statement CSV</button>
          {imports.length > 0 && <span className="text-[11px] text-text-muted">{imports.length} import{imports.length > 1 ? 's' : ''} on file</span>}
        </div>
      )}

      {/* 18 & 19. Prior-period link + rollover items */}
      {prior.prior && (
        <div className="border border-border-primary p-3">
          <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><History size={12} /> Prior reconciliation: {prior.prior.as_of_date}</div>
          <div className="text-xs">Variance then: <span className={Math.abs(prior.prior.variance) < 0.01 ? 'text-green-400' : 'text-red-400'}>{formatCurrency(prior.prior.variance)}</span></div>
          {prior.uncleared.length > 0 && (
            <>
              <div className="text-xs font-semibold mt-2">Uncleared items rolling forward ({prior.uncleared.length})</div>
              <div className="max-h-32 overflow-y-auto text-xs">
                {prior.uncleared.map((u: any) => (
                  <div key={u.id} className="py-0.5 border-b border-border-primary flex justify-between">
                    <span>{u.reference} · {formatCurrency(u.amount || 0)}</span>
                    <span className="text-text-muted">{u.note}</span>
                  </div>
                ))}
              </div>
              <button onClick={carryForward} className="mt-2 px-2 py-1 text-xs border border-border-primary">Carry forward into current period</button>
            </>
          )}
        </div>
      )}

      {/* 15. Multi-account recon */}
      <div className="border border-border-primary p-3">
        <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><Layers size={12} /> Multi-account reconciliation</div>
        <button onClick={computeMulti} className="px-2 py-1 text-xs border border-border-primary mb-2">Run for all control accounts</button>
        {multi.length > 0 && (
          <table className="w-full text-xs">
            <thead><tr><th className="text-left py-1">Account</th><th className="text-right">Sub-ledger</th><th className="text-right">GL</th><th className="text-right">Variance</th></tr></thead>
            <tbody>
              {multi.map((r: any) => (
                <tr key={r.account_id} className="border-b border-border-primary">
                  <td>{r.code} {r.name}</td>
                  <td className="text-right">{formatCurrency(r.sub)}</td>
                  <td className="text-right">{formatCurrency(r.gl)}</td>
                  <td className={`text-right ${Math.abs(r.variance) < 0.01 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(r.variance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 16. Scheduled recon reminders */}
      <div className="border border-border-primary p-3">
        <div className="text-xs font-bold mb-2 flex items-center gap-1.5"><Bell size={12} /> Recon schedule</div>
        <button onClick={addSchedule} className="px-2 py-1 text-xs border border-border-primary mb-2">+ Schedule for selected account</button>
        {schedules.length === 0 && <div className="text-xs text-text-muted">No schedules set.</div>}
        {schedules.map((s: any) => {
          const overdue = s.next_due && s.next_due <= todayLocal();
          return (
            <div key={s.id} className={`flex justify-between py-1 border-b border-border-primary text-xs ${overdue ? 'text-red-400' : ''}`}>
              <span>{s.code} {s.name} · {s.frequency} · threshold {formatCurrency(s.threshold || 0)}</span>
              <span>Next: {s.next_due || '—'} {overdue && <span className="ml-1 px-1 bg-red-500/20">DUE</span>}</span>
              <button onClick={() => deleteSchedule(s.id)} className="text-text-muted hover:text-red-400">×</button>
            </div>
          );
        })}
      </div>

      {account && <div className="text-[11px] text-text-muted">Account type: {account.type} / {account.subtype}</div>}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; accent?: 'green' | 'red' }> = ({ label, value, accent }) => (
  <div className={`p-3 border ${accent === 'green' ? 'border-green-500/40 bg-green-500/5' : accent === 'red' ? 'border-red-500/40 bg-red-500/5' : 'border-border-primary'}`}>
    <div className="text-[11px] uppercase text-text-muted">{label}</div>
    <div className="text-base font-bold text-text-primary">{value}</div>
  </div>
);

export default AccountReconciliation;
