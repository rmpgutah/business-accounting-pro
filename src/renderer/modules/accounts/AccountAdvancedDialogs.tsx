/**
 * Chart of Accounts — Round 2 advanced feature dialogs.
 * One file groups the 25 round-2 features so AccountsList stays readable.
 *
 * Features covered here: 1 (groups), 2 (permissions), 3 (watchlist),
 * 4 (aliases), 6 (FX revalue), 7 (budget ribbon), 10 (comments),
 * 11 (IIF import), 12 (Xero CSV), 13 (TXF), 14 (Code 39 barcode),
 * 15 (merge preview), 16 (split), 17 (renumber), 19 (TB import),
 * 24 (classify rules), 25 (snapshot).
 */
import React, { useEffect, useState } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

interface AccountLite {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype?: string;
  monthly_cap?: number;
  net_dr?: number;
  currency?: string;
  compliance_tags?: string;
}

const dialogShell = (title: string, children: React.ReactNode, onClose: () => void, max: string = 'max-w-lg') => (
  <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
    <div className={`bg-bg-elevated border border-border-primary w-full ${max}`} style={{ borderRadius: '6px' }}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
        <h2 className="text-sm font-bold">{title}</h2>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
      </div>
      <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">{children}</div>
    </div>
  </div>
);

// ─── F1: Groups Dialog ──────────────────────────────────────
export const GroupsDialog: React.FC<{ companyId: string; accounts: AccountLite[]; onClose: () => void }> = ({ companyId, accounts, onClose }) => {
  const [groups, setGroups] = useState<any[]>([]);
  const [members, setMembers] = useState<Record<string, Set<string>>>({});
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');

  const load = async () => {
    const gs = await api.query('account_groups', { company_id: companyId });
    setGroups(Array.isArray(gs) ? gs : []);
    const mems = await api.rawQuery('SELECT * FROM account_group_members', []);
    const map: Record<string, Set<string>> = {};
    if (Array.isArray(mems)) for (const m of mems) {
      if (!map[m.group_id]) map[m.group_id] = new Set();
      map[m.group_id].add(m.account_id);
    }
    setMembers(map);
  };
  useEffect(() => { load(); }, [companyId]);

  const create = async () => {
    if (!newName.trim()) return;
    await api.create('account_groups', { company_id: companyId, name: newName.trim(), color: newColor });
    setNewName(''); load();
  };
  const remove = async (id: string) => { if (confirm('Delete group?')) { await api.remove('account_groups', id); load(); } };
  const toggleMember = async (groupId: string, accountId: string) => {
    const set = members[groupId] || new Set();
    if (set.has(accountId)) {
      const rows = await api.query('account_group_members', { group_id: groupId, account_id: accountId });
      if (Array.isArray(rows) && rows[0]) await api.remove('account_group_members', rows[0].id);
    } else {
      await api.create('account_group_members', { group_id: groupId, account_id: accountId });
    }
    load();
  };

  return dialogShell('Account Groups', (
    <>
      <div className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New group name (e.g. Tax-Sensitive)"
          className="block-input flex-1 px-3 py-1.5 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
        <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-10 h-8 border border-border-primary" style={{ borderRadius: '6px' }} />
        <button onClick={create} className="block-btn-primary px-3 py-1.5 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Add</button>
      </div>
      {groups.length === 0 && <p className="text-xs text-text-muted">No groups yet.</p>}
      {groups.map(g => (
        <div key={g.id} className="border border-border-primary p-2" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-3 h-3" style={{ background: g.color || '#888', borderRadius: '50%' }} />
            <strong className="text-xs">{g.name}</strong>
            <span className="text-[10px] text-text-muted">({(members[g.id] || new Set()).size} members)</span>
            <button onClick={() => remove(g.id)} className="ml-auto text-[10px] text-accent-expense">Delete</button>
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {accounts.map(a => (
              <label key={a.id} className="flex items-center gap-1 text-[10px]">
                <input type="checkbox" checked={(members[g.id] || new Set()).has(a.id)} onChange={() => toggleMember(g.id, a.id)} />
                <span className="font-mono">{a.code}</span> {a.name}
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  ), onClose);
};

// ─── F2: Permissions Dialog ─────────────────────────────────
export const PermissionsDialog: React.FC<{ companyId: string; account: AccountLite; onClose: () => void }> = ({ companyId, account, onClose }) => {
  const [perms, setPerms] = useState<any[]>([]);
  const [role, setRole] = useState('viewer');
  const [canPost, setCanPost] = useState(false);
  const [canView, setCanView] = useState(true);

  const load = async () => {
    const r = await api.query('account_permissions', { company_id: companyId, account_id: account.id });
    setPerms(Array.isArray(r) ? r : []);
  };
  useEffect(() => { load(); }, [account.id]);

  const add = async () => {
    if (!role.trim()) return;
    await api.create('account_permissions', {
      company_id: companyId, account_id: account.id, role: role.trim(),
      can_post: canPost ? 1 : 0, can_view: canView ? 1 : 0,
    });
    load();
  };
  const del = async (id: string) => { await api.remove('account_permissions', id); load(); };

  return dialogShell(`Permissions: ${account.code} ${account.name}`, (
    <>
      <div className="flex gap-2 items-center">
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. accountant)"
          className="block-input flex-1 px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
        <label className="text-[10px] flex items-center gap-1"><input type="checkbox" checked={canView} onChange={(e) => setCanView(e.target.checked)} /> View</label>
        <label className="text-[10px] flex items-center gap-1"><input type="checkbox" checked={canPost} onChange={(e) => setCanPost(e.target.checked)} /> Post</label>
        <button onClick={add} className="block-btn-primary px-3 py-1 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Add</button>
      </div>
      <p className="text-[10px] text-text-muted">No rule = unrestricted. Rules are checked when JE is posted.</p>
      {perms.map(p => (
        <div key={p.id} className="flex items-center gap-2 border border-border-primary px-2 py-1" style={{ borderRadius: '6px' }}>
          <strong className="text-xs">{p.role}</strong>
          <span className="text-[10px]">view: {p.can_view ? 'yes' : 'no'}</span>
          <span className="text-[10px]">post: {p.can_post ? 'yes' : 'no'}</span>
          <button onClick={() => del(p.id)} className="ml-auto text-[10px] text-accent-expense">Remove</button>
        </div>
      ))}
    </>
  ), onClose);
};

// ─── F3: Watchlist Dialog ───────────────────────────────────
export const WatchlistDialog: React.FC<{ companyId: string; account: AccountLite; onClose: () => void }> = ({ companyId, account, onClose }) => {
  const [watches, setWatches] = useState<any[]>([]);
  const [threshold, setThreshold] = useState('1000');
  const [email, setEmail] = useState('');

  const load = async () => {
    const r = await api.query('account_watches', { account_id: account.id });
    setWatches(Array.isArray(r) ? r : []);
  };
  useEffect(() => { load(); }, [account.id]);

  const add = async () => {
    await api.create('account_watches', {
      account_id: account.id, threshold_amount: parseFloat(threshold) || 0,
      notify_email: email, user_id: '',
    });
    load();
  };
  const del = async (id: string) => { await api.remove('account_watches', id); load(); };
  const checkNow = async () => {
    const r = await api.accountsWatchlistCheck(companyId);
    alert(`Watchlist check ran. ${r.triggered || 0} alert(s) triggered.`);
  };

  return dialogShell(`Watchlist: ${account.code} ${account.name}`, (
    <>
      <div className="flex gap-2 items-center">
        <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Threshold $"
          className="block-input w-24 px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Notify email (optional)"
          className="block-input flex-1 px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
        <button onClick={add} className="block-btn-primary px-3 py-1 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Add</button>
      </div>
      <button onClick={checkNow} className="px-3 py-1 text-xs border border-border-primary" style={{ borderRadius: '6px' }}>Run Check Now</button>
      {watches.map(w => (
        <div key={w.id} className="flex items-center gap-2 border border-border-primary px-2 py-1" style={{ borderRadius: '6px' }}>
          <span className="text-xs">Threshold: ${Number(w.threshold_amount).toFixed(2)}</span>
          {w.notify_email && <span className="text-[10px] text-text-muted">→ {w.notify_email}</span>}
          <button onClick={() => del(w.id)} className="ml-auto text-[10px] text-accent-expense">Remove</button>
        </div>
      ))}
    </>
  ), onClose);
};

// ─── F4: Aliases Dialog ─────────────────────────────────────
export const AliasesDialog: React.FC<{ account: AccountLite; onClose: () => void }> = ({ account, onClose }) => {
  const [aliases, setAliases] = useState<any[]>([]);
  const [v, setV] = useState('');
  const load = async () => {
    const r = await api.query('account_aliases', { account_id: account.id });
    setAliases(Array.isArray(r) ? r : []);
  };
  useEffect(() => { load(); }, [account.id]);
  const add = async () => { if (!v.trim()) return; await api.create('account_aliases', { account_id: account.id, alias: v.trim() }); setV(''); load(); };
  const del = async (id: string) => { await api.remove('account_aliases', id); load(); };

  return dialogShell(`Aliases: ${account.code} ${account.name}`, (
    <>
      <div className="flex gap-2">
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Alternate name"
          className="block-input flex-1 px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
        <button onClick={add} className="block-btn-primary px-3 py-1 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Add</button>
      </div>
      {aliases.map(a => (
        <div key={a.id} className="flex items-center gap-2 border border-border-primary px-2 py-1" style={{ borderRadius: '6px' }}>
          <span className="text-xs">{a.alias}</span>
          <button onClick={() => del(a.id)} className="ml-auto text-[10px] text-accent-expense">Remove</button>
        </div>
      ))}
    </>
  ), onClose);
};

// ─── F6: FX Revaluation Dialog ──────────────────────────────
export const FxRevalueDialog: React.FC<{ companyId: string; onClose: () => void; onDone: () => void }> = ({ companyId, onClose, onDone }) => {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ratesText, setRatesText] = useState('EUR=1.08\nGBP=1.27\nCAD=0.74');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const rates: Record<string, number> = {};
    for (const ln of ratesText.split('\n')) {
      const [k, v] = ln.split('=').map(s => s?.trim());
      if (k && v) rates[k.toUpperCase()] = parseFloat(v) || 1;
    }
    setBusy(true);
    const r = await api.fxRevalue(companyId, date, rates);
    setBusy(false);
    if (r?.error) { alert(r.error); return; }
    alert(`Revalued ${r.accounts_revalued || 0} foreign-currency accounts.`);
    onDone();
  };
  return dialogShell('FX Revaluation', (
    <>
      <div>
        <label className="block text-[10px] uppercase font-bold mb-1">As-of Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
      </div>
      <div>
        <label className="block text-[10px] uppercase font-bold mb-1">Rates (one per line, CCY=rate)</label>
        <textarea value={ratesText} onChange={(e) => setRatesText(e.target.value)} rows={5}
          className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary font-mono" style={{ borderRadius: '6px' }} />
      </div>
      <button onClick={submit} disabled={busy} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>{busy ? 'Working...' : 'Post Revaluation JE'}</button>
    </>
  ), onClose);
};

// ─── F7: Budget Ribbon ──────────────────────────────────────
export const BudgetRibbon: React.FC<{ account: AccountLite }> = ({ account }) => {
  const cap = Number(account.monthly_cap) || 0;
  if (cap <= 0) return null;
  const actual = Math.abs(Number(account.net_dr) || 0);
  const pct = Math.min(100, (actual / cap) * 100);
  const color = pct >= 100 ? 'bg-accent-expense' : pct >= 75 ? 'bg-yellow-500' : 'bg-accent-blue';
  return (
    <div className="px-4 pb-1">
      <div className="flex items-center gap-2 text-[9px] text-text-muted">
        <span>{formatCurrency(actual)} / {formatCurrency(cap)}</span>
        <div className="flex-1 h-1.5 bg-bg-tertiary" style={{ borderRadius: '2px' }}>
          <div className={color} style={{ width: `${pct}%`, height: '100%', borderRadius: '2px' }} />
        </div>
        <span className="font-mono">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
};

// ─── F10: Comments Panel ────────────────────────────────────
export const AccountCommentsPanel: React.FC<{ accountId: string }> = ({ accountId }) => {
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState('');
  const load = async () => {
    const r = await api.query('account_comments', { account_id: accountId });
    setComments(Array.isArray(r) ? r.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')) : []);
  };
  useEffect(() => { if (accountId) load(); }, [accountId]);
  const add = async () => { if (!text.trim()) return; await api.create('account_comments', { account_id: accountId, body: text.trim(), user_id: 'user' }); setText(''); load(); };
  const del = async (id: string) => { await api.remove('account_comments', id); load(); };
  return (
    <div className="border-t border-border-primary pt-3">
      <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Comments</label>
      <div className="flex gap-2 mb-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment..."
          className="block-input flex-1 px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
        <button onClick={add} className="block-btn-primary px-3 py-1 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Post</button>
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {comments.map(c => (
          <div key={c.id} className="flex items-start gap-2 text-[11px] border border-border-primary px-2 py-1" style={{ borderRadius: '6px' }}>
            <div className="flex-1">
              <div className="text-text-secondary">{c.body}</div>
              <div className="text-[9px] text-text-muted">{c.created_at}</div>
            </div>
            <button onClick={() => del(c.id)} className="text-[10px] text-accent-expense">x</button>
          </div>
        ))}
        {comments.length === 0 && <p className="text-[10px] text-text-muted">No comments yet.</p>}
      </div>
    </div>
  );
};

// ─── F11: IIF Import Dialog ─────────────────────────────────
export const IIFImportDialog: React.FC<{ companyId: string; onClose: () => void; onDone: () => void }> = ({ companyId, onClose, onDone }) => {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<any[]>([]);
  const parse = async () => {
    const r = await api.accountsParseIIF(text);
    if (r.error) { alert(r.error); return; }
    setPreview(r.accounts || []);
  };
  const commit = async () => {
    if (preview.length === 0) return;
    // Auto-assign codes by type
    const ranges: Record<string, [number, number]> = { asset: [1500, 1999], liability: [2500, 2999], equity: [3500, 3999], revenue: [4500, 4999], expense: [5500, 9999] };
    const counters: Record<string, number> = {};
    const withCodes = preview.map(a => {
      const r = ranges[a.type] || [9000, 9999];
      counters[a.type] = (counters[a.type] || r[0]) + 10;
      return { ...a, code: String(counters[a.type]) };
    });
    const r = await api.accountsBulkCreate(companyId, withCodes);
    if (r?.error) { alert(r.error); return; }
    alert(`Imported ${r.created} accounts (${r.skipped} skipped).`);
    onDone();
  };
  return dialogShell('Import QuickBooks IIF', (
    <>
      <p className="text-[10px] text-text-muted">Paste the contents of a .iif file. Only !ACCNT lines are parsed.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="!HDR..."
        className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary font-mono" style={{ borderRadius: '6px' }} />
      <div className="flex gap-2">
        <button onClick={parse} className="px-3 py-1 text-xs border border-border-primary" style={{ borderRadius: '6px' }}>Parse</button>
        {preview.length > 0 && <button onClick={commit} className="block-btn-primary px-3 py-1 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Import {preview.length}</button>}
      </div>
      {preview.length > 0 && (
        <ul className="text-[11px] max-h-40 overflow-y-auto">
          {preview.slice(0, 50).map((p, i) => <li key={i}><span className="font-mono text-text-muted">[{p.type}]</span> {p.name}</li>)}
        </ul>
      )}
    </>
  ), onClose);
};

// ─── F12: Xero CoA CSV Import ───────────────────────────────
export const XeroImportDialog: React.FC<{ companyId: string; onClose: () => void; onDone: () => void }> = ({ companyId, onClose, onDone }) => {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<any[]>([]);
  const parse = () => {
    // Xero columns: *Code,*Name,*Type,*Tax Code,Description,Dashboard,Expense Claims,Enable Payments
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) { alert('No rows'); return; }
    const headers = lines[0].split(',').map(h => h.replace(/^[*"]|"$/g, '').trim().toLowerCase());
    const idx = (k: string) => headers.findIndex(h => h.includes(k));
    const codeI = idx('code'), nameI = idx('name'), typeI = idx('type'), descI = idx('description');
    const xeroTypeMap: Record<string, string> = {
      bank: 'asset', current: 'asset', currliability: 'liability', currentliab: 'liability',
      equity: 'equity', expense: 'expense', directcosts: 'expense', overheads: 'expense',
      revenue: 'revenue', sales: 'revenue', otherincome: 'revenue', fixed: 'asset',
      depreciatn: 'asset', termliab: 'liability', liability: 'liability',
    };
    const rows = lines.slice(1).map(ln => {
      // naive CSV split
      const cells = ln.match(/("([^"]|"")*"|[^,]*)/g)?.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
      const xt = (cells[typeI] || '').toLowerCase().replace(/\s+/g, '');
      return {
        code: cells[codeI] || '', name: cells[nameI] || '',
        type: xeroTypeMap[xt] || 'asset',
        description: cells[descI] || '',
      };
    }).filter(r => r.code && r.name);
    setPreview(rows);
  };
  const commit = async () => {
    const r = await api.accountsBulkCreate(companyId, preview);
    if (r?.error) { alert(r.error); return; }
    alert(`Imported ${r.created} accounts (${r.skipped} skipped).`);
    onDone();
  };
  return dialogShell('Import Xero CoA (CSV)', (
    <>
      <p className="text-[10px] text-text-muted">Paste a Xero Chart of Accounts CSV export. Columns: *Code, *Name, *Type, Description.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
        className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary font-mono" style={{ borderRadius: '6px' }} />
      <div className="flex gap-2">
        <button onClick={parse} className="px-3 py-1 text-xs border border-border-primary" style={{ borderRadius: '6px' }}>Parse</button>
        {preview.length > 0 && <button onClick={commit} className="block-btn-primary px-3 py-1 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Import {preview.length}</button>}
      </div>
      {preview.length > 0 && (
        <ul className="text-[11px] max-h-40 overflow-y-auto">
          {preview.slice(0, 50).map((p, i) => <li key={i}><span className="font-mono">{p.code}</span> [{p.type}] {p.name}</li>)}
        </ul>
      )}
    </>
  ), onClose);
};

// ─── F13: TXF Export Dialog ─────────────────────────────────
export const TxfExportDialog: React.FC<{ companyId: string; onClose: () => void }> = ({ companyId, onClose }) => {
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const exec = async () => {
    const r = await api.accountsExportTxf(companyId, year);
    if (r?.error) { alert(r.error); return; }
    if (!r.txf) { alert('No accounts had tax_line set'); return; }
    const blob = new Blob([r.txf], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `taxes-${year}.txf`; a.click();
    URL.revokeObjectURL(url);
    onClose();
  };
  return dialogShell('Export TurboTax TXF', (
    <>
      <p className="text-[10px] text-text-muted">Generates a .txf file using the tax_line field on revenue/expense accounts.</p>
      <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}
        className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
      <button onClick={exec} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Generate .txf</button>
    </>
  ), onClose);
};

// ─── F14: Code 39 Barcode (CSS-grid pattern, no library) ────
// Simple: encodes characters as black/white bar widths. We render a stylized
// grid representation suitable for printing alongside the QR label.
const CODE39_PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', '*': 'nnwnwnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', '-': 'nnnnwwnnw', ' ': 'nwnnwnnnw',
};
export const Barcode39: React.FC<{ value: string; height?: number }> = ({ value, height = 32 }) => {
  const v = `*${value.toUpperCase().replace(/[^0-9A-Z\- ]/g, '')}*`;
  const bars: Array<{ w: number; black: boolean }> = [];
  for (let i = 0; i < v.length; i++) {
    const p = CODE39_PATTERNS[v[i]] || CODE39_PATTERNS['*'];
    for (let j = 0; j < p.length; j++) {
      bars.push({ w: p[j] === 'w' ? 2 : 1, black: j % 2 === 0 });
    }
    if (i < v.length - 1) bars.push({ w: 1, black: false }); // inter-character gap
  }
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height, background: '#fff' }}>
      {bars.map((b, i) => (
        <div key={i} style={{ width: `${b.w * 2}px`, background: b.black ? '#000' : '#fff' }} />
      ))}
    </div>
  );
};

// ─── F15: Merge Preview ─────────────────────────────────────
export const MergePreview: React.FC<{ source: AccountLite; target: AccountLite }> = ({ source, target }) => {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { api.accountsMergePreview(source.id).then(setData); }, [source.id]);
  if (!data) return <p className="text-[10px] text-text-muted">Loading impact...</p>;
  return (
    <div className="border border-accent-blue/30 bg-accent-blue/5 p-2 text-[11px]" style={{ borderRadius: '6px' }}>
      <div className="font-bold mb-1">Merge impact preview</div>
      <ul className="space-y-0.5">
        <li>{data.journal_lines || 0} journal lines</li>
        <li>{data.invoice_lines || 0} invoice lines</li>
        <li>{data.bills || 0} bills</li>
        <li>{data.expenses || 0} expenses</li>
        {(data.children || 0) > 0 && <li className="text-accent-expense">{data.children} child accounts will reparent</li>}
      </ul>
      <div className="mt-1 text-text-muted">Will move from <strong>{source.code}</strong> → <strong>{target.code}</strong></div>
    </div>
  );
};

// ─── F16: Split Dialog ──────────────────────────────────────
export const SplitDialog: React.FC<{ companyId: string; accounts: AccountLite[]; onClose: () => void; onDone: () => void }> = ({ companyId, accounts, onClose, onDone }) => {
  const [src, setSrc] = useState(accounts[0]?.id || '');
  const [tgt, setTgt] = useState(accounts[1]?.id || '');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [pat, setPat] = useState('.*');
  const [busy, setBusy] = useState(false);
  const exec = async () => {
    if (src === tgt) { alert('Pick different accounts'); return; }
    setBusy(true);
    const r = await api.accountsSplit(companyId, src, tgt, from, to, pat);
    setBusy(false);
    if (r?.error) { alert(r.error); return; }
    alert(`Moved ${r.moved} lines.`);
    onDone();
  };
  return dialogShell('Split Account', (
    <>
      <p className="text-[10px] text-text-muted">Move JE lines matching the description regex from a source account to a target account within a date range.</p>
      <label className="block text-[10px] uppercase font-bold">Source</label>
      <select value={src} onChange={(e) => setSrc(e.target.value)} className="block-select w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
      </select>
      <label className="block text-[10px] uppercase font-bold">Target</label>
      <select value={tgt} onChange={(e) => setTgt(e.target.value)} className="block-select w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block-input px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block-input px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
      </div>
      <input value={pat} onChange={(e) => setPat(e.target.value)} placeholder="Description regex (.* = all)"
        className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary font-mono" style={{ borderRadius: '6px' }} />
      <button onClick={exec} disabled={busy} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>{busy ? 'Working...' : 'Move Matching Lines'}</button>
    </>
  ), onClose);
};

// ─── F17: Renumber Dialog ───────────────────────────────────
export const RenumberDialog: React.FC<{ companyId: string; account: AccountLite; onClose: () => void; onDone: () => void }> = ({ companyId, account, onClose, onDone }) => {
  const [code, setCode] = useState(account.code);
  const [busy, setBusy] = useState(false);
  const exec = async () => {
    setBusy(true);
    const r = await api.accountsRenumber(companyId, account.id, code);
    setBusy(false);
    if (r?.error) { alert(r.error); return; }
    onDone();
  };
  return dialogShell(`Renumber ${account.code}`, (
    <>
      <p className="text-[10px] text-text-muted">Change the code on this account. All references use the internal id, so links remain intact. An audit-log entry is created.</p>
      <input value={code} onChange={(e) => setCode(e.target.value)}
        className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary font-mono" style={{ borderRadius: '6px' }} />
      <button onClick={exec} disabled={busy} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>{busy ? 'Working...' : 'Apply'}</button>
    </>
  ), onClose);
};

// ─── F19: Opening TB Import ─────────────────────────────────
export const OpeningTbImportDialog: React.FC<{ companyId: string; onClose: () => void; onDone: () => void }> = ({ companyId, onClose, onDone }) => {
  const [date, setDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [text, setText] = useState('1010,5000\n1100,12000\n2000,-3500');
  const [busy, setBusy] = useState(false);
  const exec = async () => {
    const rows = text.split(/\r?\n/).map(l => {
      const [code, bal] = l.split(',').map(s => s?.trim());
      return { code: code || '', balance: parseFloat(bal || '0') || 0 };
    }).filter(r => r.code);
    setBusy(true);
    const r = await api.accountsImportOpeningTb(companyId, date, rows);
    setBusy(false);
    if (r?.error) { alert(r.error); return; }
    alert(`Applied ${r.applied}, skipped ${r.skipped}.`);
    onDone();
  };
  return dialogShell('Import Opening Trial Balance', (
    <>
      <p className="text-[10px] text-text-muted">Paste rows of <code>account_code,balance</code>. One JE will be posted with offsetting Opening Balance Equity.</p>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
        className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary font-mono" style={{ borderRadius: '6px' }} />
      <button onClick={exec} disabled={busy} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>{busy ? 'Working...' : 'Post Opening JE'}</button>
    </>
  ), onClose);
};

// ─── F24: Auto-classify Rules ───────────────────────────────
export const ClassifyRulesDialog: React.FC<{ companyId: string; accounts: AccountLite[]; onClose: () => void }> = ({ companyId, accounts, onClose }) => {
  const [rules, setRules] = useState<any[]>([]);
  const [pat, setPat] = useState('');
  const [acc, setAcc] = useState(accounts[0]?.id || '');
  const load = async () => {
    const r = await api.query('account_classify_rules', { company_id: companyId });
    setRules(Array.isArray(r) ? r : []);
  };
  useEffect(() => { load(); }, [companyId]);
  const add = async () => { if (!pat.trim() || !acc) return; await api.create('account_classify_rules', { company_id: companyId, pattern: pat.trim(), account_id: acc }); setPat(''); load(); };
  const del = async (id: string) => { await api.remove('account_classify_rules', id); load(); };
  return dialogShell('Auto-Categorize Rules', (
    <>
      <p className="text-[10px] text-text-muted">When an expense or bank txn description matches a regex, the linked account is suggested.</p>
      <div className="flex gap-2">
        <input value={pat} onChange={(e) => setPat(e.target.value)} placeholder="Regex (e.g. starbucks|coffee)"
          className="block-input flex-1 px-2 py-1 text-xs bg-bg-primary border border-border-primary font-mono" style={{ borderRadius: '6px' }} />
        <select value={acc} onChange={(e) => setAcc(e.target.value)}
          className="block-select px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
        </select>
        <button onClick={add} className="block-btn-primary px-3 py-1 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>Add</button>
      </div>
      {rules.map(r => {
        const a = accounts.find(x => x.id === r.account_id);
        return (
          <div key={r.id} className="flex items-center gap-2 border border-border-primary px-2 py-1" style={{ borderRadius: '6px' }}>
            <code className="text-[11px]">{r.pattern}</code>
            <span className="text-[10px] text-text-muted">→ {a ? `${a.code} ${a.name}` : r.account_id}</span>
            <button onClick={() => del(r.id)} className="ml-auto text-[10px] text-accent-expense">Remove</button>
          </div>
        );
      })}
    </>
  ), onClose);
};

// ─── F25: Snapshot trigger ──────────────────────────────────
export const SnapshotDialog: React.FC<{ companyId: string; onClose: () => void }> = ({ companyId, onClose }) => {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const exec = async () => {
    setBusy(true);
    const r = await api.accountsSnapshotBalances(companyId, date);
    setBusy(false);
    if (r?.error) { alert(r.error); return; }
    alert(`Snapshotted ${r.count} accounts for ${r.date}.`);
    onClose();
  };
  return dialogShell('Snapshot Daily Balances', (
    <>
      <p className="text-[10px] text-text-muted">Records ending balances into account_balance_history for trend charts.</p>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
      <button onClick={exec} disabled={busy} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>{busy ? 'Snapshotting...' : 'Snapshot Now'}</button>
    </>
  ), onClose);
};

// ─── Compliance Tag Badges ──────────────────────────────────
export const ComplianceBadges: React.FC<{ tagsJson?: string }> = ({ tagsJson }) => {
  let tags: string[] = [];
  try { tags = tagsJson ? JSON.parse(tagsJson) : []; } catch {}
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const colors: Record<string, string> = {
    PCI: 'bg-red-500/20 text-red-400',
    HIPAA: 'bg-purple-500/20 text-purple-400',
    GDPR: 'bg-blue-500/20 text-blue-400',
    SOX: 'bg-amber-500/20 text-amber-400',
  };
  return (
    <span className="inline-flex gap-1">
      {tags.map(t => (
        <span key={t} className={`text-[8px] px-1 py-0.5 font-bold ${colors[t] || 'bg-gray-500/20 text-gray-400'}`} style={{ borderRadius: '3px' }}>{t}</span>
      ))}
    </span>
  );
};
