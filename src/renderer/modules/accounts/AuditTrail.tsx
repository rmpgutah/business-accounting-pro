import React, { useEffect, useState } from 'react';
import { Shield, FileSearch, Receipt, Users, FileText, Download } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import api from '../../lib/api';

// ─── Compliance Center ───────────────────────────────────────
// Implements features 21–30.

type View = 'audit' | '1099' | 'taxlines' | 'sod' | 'settings' | 'workpapers';

const ComplianceCenter: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';
  const [view, setView] = useState<View>('audit');

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-border-primary">
        {([
          { id: 'audit', label: 'Account audit log', icon: <FileSearch size={12} /> },
          { id: '1099', label: '1099 report', icon: <Receipt size={12} /> },
          { id: 'taxlines', label: 'Tax-line export', icon: <FileText size={12} /> },
          { id: 'sod', label: 'Segregation of duties', icon: <Users size={12} /> },
          { id: 'settings', label: 'Posting rules', icon: <Shield size={12} /> },
          { id: 'workpapers', label: 'Working papers', icon: <Download size={12} /> },
        ] as { id: View; label: string; icon: React.ReactNode }[]).map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px ${view === t.id ? 'border-accent-blue text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {view === 'audit' && <AccountAudit companyId={companyId} />}
      {view === '1099' && <Form1099 companyId={companyId} />}
      {view === 'taxlines' && <TaxLineExport companyId={companyId} />}
      {view === 'sod' && <SoDReport companyId={companyId} />}
      {view === 'settings' && <PostingRules companyId={companyId} />}
      {view === 'workpapers' && <WorkingPapers companyId={companyId} />}
    </div>
  );
};

// 21. Account audit
const AccountAudit: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (!companyId) return;
    api.query('accounts', { company_id: companyId }, { field: 'code', dir: 'asc' }).then(setAccounts);
  }, [companyId]);
  const load = async (id: string) => {
    setAccountId(id);
    if (!id) { setData(null); return; }
    const r = await window.electronAPI.invoke('compliance:account-audit', { companyId, accountId: id });
    setData(r);
  };
  return (
    <div className="space-y-3">
      <select value={accountId} onChange={(e) => load(e.target.value)} className="w-full px-2 py-1.5 text-xs bg-bg-primary border border-border-primary">
        <option value="">— select an account —</option>
        {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
      </select>
      {data && (
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-border-primary p-2">
            <div className="text-xs font-bold mb-2">Account changes ({data.account_changes?.length || 0})</div>
            <div className="max-h-72 overflow-y-auto text-xs">
              {(data.account_changes || []).map((c: any) => (
                <div key={c.id} className="py-0.5 border-b border-border-primary">
                  <span className="text-text-muted">{c.timestamp}</span> · {c.action} · {c.performed_by}
                </div>
              ))}
            </div>
          </div>
          <div className="border border-border-primary p-2">
            <div className="text-xs font-bold mb-2">Journal entries touching this account ({data.journal_touches?.length || 0})</div>
            <div className="max-h-72 overflow-y-auto text-xs">
              {(data.journal_touches || []).map((j: any) => (
                <div key={j.id} className="py-0.5 border-b border-border-primary">
                  {j.entry_number} · {j.date} · {j.description}
                  {j.posted_by && <span className="text-text-muted"> · posted by {j.posted_by}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 27. 1099
const Form1099: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<any[]>([]);
  const run = async () => {
    const r = await window.electronAPI.invoke('compliance:1099-report', { companyId, year });
    setRows(r || []);
  };
  const exportCsv = () => {
    const csv = ['Vendor,Tax ID,Account,Amount', ...rows.map(r => `"${r.vendor_name}","${r.tax_id || ''}","${r.code} ${r.account_name}",${(r.amount || 0).toFixed(2)}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `1099-${year}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="w-24 px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <button onClick={run} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">Run</button>
        {rows.length > 0 && <button onClick={exportCsv} className="px-3 py-1.5 text-xs font-semibold border border-border-primary">CSV</button>}
      </div>
      <table className="w-full text-xs border border-border-primary">
        <thead className="bg-bg-secondary"><tr><th className="text-left p-1.5">Vendor</th><th>Tax ID</th><th>Account</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {rows.map((r: any, i: number) => (
            <tr key={i} className="border-t border-border-primary">
              <td className="p-1.5">{r.vendor_name}</td>
              <td>{r.tax_id || ''}</td>
              <td>{r.code} {r.account_name}</td>
              <td className="text-right">{formatCurrency(r.amount || 0)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="p-2 text-text-muted text-center">No 1099-eligible payments ≥ $600 found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

// 26. Tax-line export
const TaxLineExport: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [start, setStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<any[]>([]);
  const run = async () => {
    const r = await window.electronAPI.invoke('compliance:tax-line-export', { companyId, periodStart: start, periodEnd: end });
    setRows(r || []);
  };
  const exportCsv = () => {
    const csv = ['Tax Line,Code,Name,Type,Net', ...rows.map(r => `"${r.tax_line}","${r.code}","${r.name}","${r.type}",${(r.net || 0).toFixed(2)}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `tax-lines-${end}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <button onClick={run} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">Run</button>
        {rows.length > 0 && <button onClick={exportCsv} className="px-3 py-1.5 text-xs font-semibold border border-border-primary">CSV</button>}
      </div>
      <table className="w-full text-xs border border-border-primary">
        <thead className="bg-bg-secondary"><tr><th className="text-left p-1.5">Tax line</th><th>Account</th><th>Type</th><th className="text-right">Net</th></tr></thead>
        <tbody>
          {rows.map((r: any, i: number) => (
            <tr key={i} className="border-t border-border-primary">
              <td className="p-1.5">{r.tax_line}</td>
              <td>{r.code} {r.name}</td>
              <td>{r.type}</td>
              <td className="text-right">{formatCurrency(r.net || 0)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="p-2 text-text-muted text-center">Map accounts to tax lines first (see Posting rules).</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

// 29. SOX SoD
const SoDReport: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [start, setStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<any[]>([]);
  const run = async () => {
    const r = await window.electronAPI.invoke('compliance:sod-report', { companyId, periodStart: start, periodEnd: end });
    setRows(r || []);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <button onClick={run} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">Find SoD violations</button>
      </div>
      <table className="w-full text-xs border border-border-primary">
        <thead className="bg-bg-secondary"><tr><th className="text-left p-1.5">JE #</th><th>Date</th><th>Description</th><th>Approver = Poster</th></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} className="border-t border-border-primary bg-red-500/5">
              <td className="p-1.5">{r.entry_number}</td>
              <td>{r.date}</td>
              <td>{r.description}</td>
              <td className="text-red-400">{r.approved_by}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="p-2 text-green-400 text-center">No SoD violations found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

// 22, 23, 26: Posting rules
const PostingRules: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const reload = () => api.query('accounts', { company_id: companyId }, { field: 'code', dir: 'asc' }).then(setAccounts);
  useEffect(() => { if (companyId) reload(); }, [companyId]);
  const update = async (id: string, field: string, value: any) => {
    await api.update('accounts', id, { [field]: value });
    reload();
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border border-border-primary">
        <thead className="bg-bg-secondary">
          <tr>
            <th className="text-left p-1.5">Code</th><th className="text-left">Name</th>
            <th>Direct posting</th><th>1099</th><th>Attachment req.</th>
            <th>Threshold</th><th>Tax line</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a: any) => (
            <tr key={a.id} className="border-t border-border-primary">
              <td className="p-1.5">{a.code}</td>
              <td>{a.name}</td>
              <td className="text-center">
                <input type="checkbox" checked={a.allow_direct_posting !== 0} onChange={(e) => update(a.id, 'allow_direct_posting', e.target.checked ? 1 : 0)} />
              </td>
              <td className="text-center">
                <input type="checkbox" checked={a.is_1099_eligible === 1} onChange={(e) => update(a.id, 'is_1099_eligible', e.target.checked ? 1 : 0)} />
              </td>
              <td className="text-center">
                <input type="checkbox" checked={a.attachment_required === 1} onChange={(e) => update(a.id, 'attachment_required', e.target.checked ? 1 : 0)} />
              </td>
              <td>
                <input type="number" defaultValue={a.attachment_threshold || 0}
                  onBlur={(e) => update(a.id, 'attachment_threshold', Number(e.target.value))}
                  className="w-20 px-1 py-0.5 text-xs bg-bg-primary border border-border-primary" />
              </td>
              <td>
                <input defaultValue={a.tax_line || ''}
                  onBlur={(e) => update(a.id, 'tax_line', e.target.value)}
                  placeholder="e.g. Schedule C 8"
                  className="w-32 px-1 py-0.5 text-xs bg-bg-primary border border-border-primary" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// 30. Working papers export
const WorkingPapers: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [start, setStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    try {
      const [tb, gl, recons, audit] = await Promise.all([
        api.reportTrialBalance(start, end),
        api.reportGeneralLedger(start, end),
        window.electronAPI.invoke('recon:history', { companyId }),
        api.query('audit_log', { company_id: companyId }, { field: 'timestamp', dir: 'desc' }, 500),
      ]);
      const html = `<!DOCTYPE html><html><head><title>Working Papers ${start} to ${end}</title>
        <style>body{font-family:sans-serif;padding:24px;}h1{font-size:18px;}h2{font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:24px;}
        table{border-collapse:collapse;width:100%;font-size:11px;margin-top:8px;}td,th{border:1px solid #ccc;padding:4px;}</style>
        </head><body>
        <h1>Working Papers — Audit Bundle</h1>
        <p>Period: ${start} to ${end}</p>
        <h2>Trial Balance</h2>
        <pre style="font-size:10px;background:#f5f5f5;padding:8px;">${escapeHtml(JSON.stringify(tb, null, 2)).slice(0, 50000)}</pre>
        <h2>General Ledger</h2>
        <pre style="font-size:10px;background:#f5f5f5;padding:8px;">${escapeHtml(JSON.stringify(gl, null, 2)).slice(0, 50000)}</pre>
        <h2>Account Reconciliations (${(recons || []).length})</h2>
        <table><tr><th>Date</th><th>Account</th><th>Sub-ledger</th><th>GL</th><th>Variance</th></tr>
        ${(recons || []).map((r: any) => `<tr><td>${r.as_of_date}</td><td>${r.code} ${r.name}</td><td>${formatCurrency(r.sub_ledger_total)}</td><td>${formatCurrency(r.gl_total)}</td><td>${formatCurrency(r.variance)}</td></tr>`).join('')}
        </table>
        <h2>Audit Log (latest 500)</h2>
        <table><tr><th>Time</th><th>Entity</th><th>Action</th><th>By</th></tr>
        ${(audit || []).map((a: any) => `<tr><td>${a.timestamp}</td><td>${a.entity_type}/${a.entity_id}</td><td>${a.action}</td><td>${a.performed_by}</td></tr>`).join('')}
        </table>
        </body></html>`;
      await api.saveToPDF(html, `working-papers-${end}`, { openAfterSave: true });
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <button disabled={busy} onClick={generate} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">
          <Download size={12} className="inline mr-1" />Generate working papers PDF
        </button>
      </div>
      <div className="text-xs text-text-muted">Bundles trial balance, general ledger, reconciliations, and audit log into a single PDF for external auditors.</div>
    </div>
  );
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!));
}

export default ComplianceCenter;
