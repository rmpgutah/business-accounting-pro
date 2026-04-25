import React, { useEffect, useState, useCallback } from 'react';
import { Scale, Save, ArrowRightLeft, RefreshCw } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import api from '../../lib/api';

// ─── Account Reconciliation (sub-ledger ↔ GL) ─────────────────
// Implements features 11–20.

interface Account { id: string; code: string; name: string; type: string; subtype: string; }

const AccountReconciliation: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [computed, setComputed] = useState<any>(null);
  const [matches, setMatches] = useState<{ matches: any[]; suggestions: any[] }>({ matches: [], suggestions: [] });
  const [history, setHistory] = useState<any[]>([]);
  const [interCo, setInterCo] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

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
  }, [companyId]);

  const compute = useCallback(async () => {
    if (!accountId || !companyId) return;
    setBusy(true);
    const res = await window.electronAPI.invoke('recon:compute', { companyId, accountId, asOfDate });
    setComputed(res);
    const m = await window.electronAPI.invoke('recon:auto-match', { companyId, accountId, asOfDate });
    setMatches(m);
    setBusy(false);
  }, [accountId, asOfDate, companyId]);

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
              {matches.matches.map((m, i) => (
                <div key={`m${i}`} className="py-0.5 border-b border-border-primary">
                  <span className="text-green-400">✓</span> {m.sub.reference} ↔ {m.gl.entry_number} <span className="text-text-muted">({m.reason})</span>
                </div>
              ))}
              {matches.suggestions.map((m, i) => (
                <div key={`s${i}`} className="py-0.5 border-b border-border-primary">
                  <span className="text-yellow-400">?</span> {m.sub.reference || formatCurrency(m.sub.amount || 0)} ↔ {m.gl.entry_number} <span className="text-text-muted">({m.reason})</span>
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
