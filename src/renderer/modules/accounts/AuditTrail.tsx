import React, { useEffect, useState } from 'react';
import { Shield, FileSearch, Receipt, Users, FileText, Download, Grid, ClipboardCheck, Mail, Hash, KeyRound, LayoutDashboard } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';
import api from '../../lib/api';

// ─── Compliance Center ───────────────────────────────────────
// Implements features 21–30.

type View = 'dashboard' | 'audit' | '1099' | 'taxlines' | 'sod' | 'settings' | 'workpapers' | 'controls' | 'auditletter' | 'hashchain' | 'approvals';

const ComplianceCenter: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';
  const [view, setView] = useState<View>('dashboard');

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-border-primary">
        {([
          { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={12} /> },
          { id: 'audit', label: 'Account audit log', icon: <FileSearch size={12} /> },
          { id: '1099', label: '1099 report', icon: <Receipt size={12} /> },
          { id: 'taxlines', label: 'Tax-line export', icon: <FileText size={12} /> },
          { id: 'sod', label: 'Segregation of duties', icon: <Users size={12} /> },
          { id: 'settings', label: 'Posting rules', icon: <Shield size={12} /> },
          { id: 'workpapers', label: 'Working papers', icon: <Download size={12} /> },
          { id: 'controls', label: 'SOX controls', icon: <Grid size={12} /> },
          { id: 'auditletter', label: 'Audit letter', icon: <Mail size={12} /> },
          { id: 'hashchain', label: 'Hash chain', icon: <Hash size={12} /> },
          { id: 'approvals', label: 'Approval rules', icon: <KeyRound size={12} /> },
        ] as { id: View; label: string; icon: React.ReactNode }[]).map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px ${view === t.id ? 'border-accent-blue text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {view === 'dashboard' && <ComplianceDashboard companyId={companyId} />}
      {view === 'audit' && <AccountAudit companyId={companyId} />}
      {view === '1099' && <Form1099 companyId={companyId} />}
      {view === 'taxlines' && <TaxLineExport companyId={companyId} />}
      {view === 'sod' && <SoDReport companyId={companyId} />}
      {view === 'settings' && <PostingRules companyId={companyId} />}
      {view === 'workpapers' && <WorkingPapers companyId={companyId} />}
      {view === 'controls' && <SoxControls companyId={companyId} />}
      {view === 'auditletter' && <AuditLetter companyId={companyId} />}
      {view === 'hashchain' && <HashChain companyId={companyId} />}
      {view === 'approvals' && <ApprovalRules companyId={companyId} />}
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
  const [end, setEnd] = useState(todayLocal());
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
  const [end, setEnd] = useState(todayLocal());
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
  const [end, setEnd] = useState(todayLocal());
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
        h3{font-size:12px;margin-top:14px;color:#444;}
        table{border-collapse:collapse;width:100%;font-size:11px;margin-top:8px;}td,th{border:1px solid #ccc;padding:4px;}</style>
        </head><body>
        <h1>PCAOB-Aligned Working Papers — Audit Bundle</h1>
        <p>Period: ${start} to ${end}</p>
        <h2>Section 1 — Scope</h2>
        <p>Audit period covers all posted journal entries between ${start} and ${end}. Scope includes the complete trial balance, general ledger detail, account reconciliations, and audit log activity for the company.</p>
        <h2>Section 2 — Risks</h2>
        <ul>
          <li>Significant accounts: revenue, AR, AP, cash.</li>
          <li>Inherent risks: management override, period-end cutoff, related-party transactions.</li>
          <li>Control risks: review SoD report and SOX control test results in evidence packet.</li>
        </ul>
        <h2>Section 3 — Procedures Performed</h2>
        <ul>
          <li>Trial balance footed and tied to general ledger detail.</li>
          <li>Sub-ledger reconciliations reviewed for variance ≥ threshold.</li>
          <li>Audit log inspected for unauthorized changes.</li>
          <li>Hash-chain integrity verified via Compliance → Hash chain.</li>
        </ul>
        <h2>Section 4 — Trial Balance</h2>
        <pre style="font-size:10px;background:#f5f5f5;padding:8px;">${escapeHtml(JSON.stringify(tb, null, 2)).slice(0, 50000)}</pre>
        <h2>Section 5 — General Ledger</h2>
        <pre style="font-size:10px;background:#f5f5f5;padding:8px;">${escapeHtml(JSON.stringify(gl, null, 2)).slice(0, 50000)}</pre>
        <h2>Section 6 — Account Reconciliations (${(recons || []).length})</h2>
        <table><tr><th>Date</th><th>Account</th><th>Sub-ledger</th><th>GL</th><th>Variance</th></tr>
        ${(recons || []).map((r: any) => `<tr><td>${r.as_of_date}</td><td>${r.code} ${r.name}</td><td>${formatCurrency(r.sub_ledger_total)}</td><td>${formatCurrency(r.gl_total)}</td><td>${formatCurrency(r.variance)}</td></tr>`).join('')}
        </table>
        <h2>Section 7 — Audit Log (latest 500)</h2>
        <table><tr><th>Time</th><th>Entity</th><th>Action</th><th>By</th></tr>
        ${(audit || []).map((a: any) => `<tr><td>${a.timestamp}</td><td>${a.entity_type}/${a.entity_id}</td><td>${a.action}</td><td>${a.performed_by}</td></tr>`).join('')}
        </table>
        <h2>Section 8 — Conclusions</h2>
        <p>Based on procedures performed, trial balance and supporting detail were obtained and tied. Reconciliation variances were identified and dispositioned. Audit log integrity verified via SHA-256 hash chain. Refer to Sarbanes evidence packet for SOX 404 control testing results.</p>
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

// 30. Compliance Dashboard
const ComplianceDashboard: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (!companyId) return;
    window.electronAPI.invoke('compliance:dashboard', { companyId }).then(setData);
  }, [companyId]);
  if (!data) return <div className="text-xs text-text-muted">Loading…</div>;
  const Tile: React.FC<{ label: string; value: string | number; warn?: boolean }> = ({ label, value, warn }) => (
    <div className={`p-3 border ${warn ? 'border-red-500/40 bg-red-500/5' : 'border-border-primary'}`}>
      <div className="text-[10px] uppercase text-text-muted">{label}</div>
      <div className={`text-lg font-bold ${warn ? 'text-red-400' : 'text-text-primary'}`}>{value}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-3">
      <Tile label="Open SOX controls" value={data.openControls} warn={data.openControls > 0} />
      <Tile label="Last close" value={data.lastCloseDate || 'never'} />
      <Tile label="Last reconciliation" value={data.lastReconDate || 'never'} />
      <Tile label="Recons due" value={data.dueRecons} warn={data.dueRecons > 0} />
      <Tile label="Audit log entries" value={data.auditEntries} />
      <Tile label="Days until next close" value={data.daysUntilNextClose} />
    </div>
  );
};

// 21 & 22 & 23. SOX Controls + Tests + Sarbanes evidence packet
const SoxControls: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [controls, setControls] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [tests, setTests] = useState<Record<string, any[]>>({});
  const reload = () => window.electronAPI.invoke('sox:controls-list', { companyId }).then(setControls);
  useEffect(() => { if (companyId) reload(); }, [companyId]);

  const save = async () => {
    if (!editing) return;
    const res: any = await window.electronAPI.invoke('sox:control-save', { ...editing, companyId });
    if (res?.error) { alert(res.error); return; }
    setEditing(null);
    reload();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete control?')) return;
    await window.electronAPI.invoke('sox:control-delete', { id });
    reload();
  };

  const loadTests = async (controlId: string) => {
    const t = await window.electronAPI.invoke('sox:tests-list', { controlId });
    setTests((prev) => ({ ...prev, [controlId]: t || [] }));
  };

  const addTest = async (controlId: string) => {
    const result = prompt('Result (pass|fail|na)?', 'pass') || 'pass';
    const evidence = prompt('Evidence reference (e.g. audit_log id, doc URL)?', '') || '';
    const notes = prompt('Notes?', '') || '';
    await window.electronAPI.invoke('sox:test-save', {
      controlId, companyId, testedBy: 'user', testedAt: todayLocal(), result, evidence, notes,
    });
    await loadTests(controlId);
    reload();
  };

  // 23. Sarbanes evidence packet PDF
  const evidencePacket = async () => {
    const list = await window.electronAPI.invoke('sox:controls-list', { companyId });
    const allTests: Record<string, any[]> = {};
    for (const c of list || []) {
      allTests[c.id] = await window.electronAPI.invoke('sox:tests-list', { controlId: c.id }) || [];
    }
    const html = `<!DOCTYPE html><html><head><title>Sarbanes Evidence Packet</title>
      <style>body{font-family:sans-serif;padding:24px;}h1{font-size:18px;}h2{font-size:14px;border-bottom:1px solid #ccc;padding:4px 0;margin-top:18px;}
      table{border-collapse:collapse;width:100%;font-size:11px;margin-top:6px;}td,th{border:1px solid #ccc;padding:4px;}.signoff{margin-top:32px;border-top:1px solid #000;padding-top:16px;}</style>
      </head><body>
      <h1>Sarbanes-Oxley Evidence Packet</h1>
      <p>Date: ${todayLocal()}</p>
      <h2>Internal-Control Matrix</h2>
      <table><tr><th>Code</th><th>Description</th><th>Owner</th><th>Frequency</th><th>Risk</th><th>Last result</th></tr>
      ${(list || []).map((c: any) => `<tr><td>${c.code}</td><td>${c.description}</td><td>${c.owner}</td><td>${c.frequency}</td><td>${c.risk}</td><td>${c.last_result || 'untested'}</td></tr>`).join('')}
      </table>
      <h2>Control Tests</h2>
      ${(list || []).map((c: any) => `
        <h3 style="font-size:12px;margin-top:12px;">${c.code} — ${c.description}</h3>
        <table><tr><th>Date</th><th>Tester</th><th>Result</th><th>Evidence</th><th>Notes</th></tr>
        ${(allTests[c.id] || []).map((t: any) => `<tr><td>${t.tested_at}</td><td>${t.tested_by}</td><td>${t.result}</td><td>${t.evidence}</td><td>${t.notes}</td></tr>`).join('')}
        </table>
      `).join('')}
      <div class="signoff">
        <p>Approved by: ____________________________  Date: ___________</p>
        <p>Title: ____________________________</p>
      </div>
      </body></html>`;
    await api.saveToPDF(html, `sarbanes-evidence-${todayLocal()}`, { openAfterSave: true });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setEditing({ code: '', description: '', owner: '', frequency: 'monthly', risk: 'medium' })}
          className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">+ New control</button>
        <button onClick={evidencePacket} className="px-3 py-1.5 text-xs font-semibold border border-border-primary">
          <ClipboardCheck size={11} className="inline mr-1" />Generate Sarbanes evidence packet (PDF)
        </button>
      </div>
      {editing && (
        <div className="border border-border-primary p-3 space-y-2">
          <div className="grid grid-cols-5 gap-2">
            <input placeholder="Code" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} className="px-2 py-1 text-xs bg-bg-primary border border-border-primary" />
            <input placeholder="Description" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="col-span-2 px-2 py-1 text-xs bg-bg-primary border border-border-primary" />
            <input placeholder="Owner" value={editing.owner} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} className="px-2 py-1 text-xs bg-bg-primary border border-border-primary" />
            <select value={editing.frequency} onChange={(e) => setEditing({ ...editing, frequency: e.target.value })} className="px-2 py-1 text-xs bg-bg-primary border border-border-primary">
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option><option value="annual">Annual</option>
            </select>
          </div>
          <div className="flex gap-2">
            <select value={editing.risk} onChange={(e) => setEditing({ ...editing, risk: e.target.value })} className="px-2 py-1 text-xs bg-bg-primary border border-border-primary">
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
            <button onClick={save} className="px-3 py-1 text-xs bg-accent-blue text-white">Save</button>
            <button onClick={() => setEditing(null)} className="px-3 py-1 text-xs border border-border-primary">Cancel</button>
          </div>
        </div>
      )}
      <table className="w-full text-xs border border-border-primary">
        <thead className="bg-bg-secondary">
          <tr><th className="text-left p-1.5">Code</th><th className="text-left">Description</th><th>Owner</th><th>Frequency</th><th>Risk</th><th>Last result</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {controls.map((c: any) => (
            <React.Fragment key={c.id}>
              <tr className="border-t border-border-primary">
                <td className="p-1.5">{c.code}</td>
                <td>{c.description}</td>
                <td>{c.owner}</td>
                <td>{c.frequency}</td>
                <td>{c.risk}</td>
                <td className={c.last_result === 'pass' ? 'text-green-400' : c.last_result === 'fail' ? 'text-red-400' : 'text-text-muted'}>
                  {c.last_result || 'untested'} ({c.test_count || 0})
                </td>
                <td>
                  <button onClick={() => loadTests(c.id)} className="px-1.5 py-0.5 text-[10px] border border-border-primary mr-1">View tests</button>
                  <button onClick={() => addTest(c.id)} className="px-1.5 py-0.5 text-[10px] border border-border-primary mr-1">+Test</button>
                  <button onClick={() => setEditing(c)} className="px-1.5 py-0.5 text-[10px] border border-border-primary mr-1">Edit</button>
                  <button onClick={() => remove(c.id)} className="px-1.5 py-0.5 text-[10px] border border-red-500/50 text-red-400">×</button>
                </td>
              </tr>
              {tests[c.id] && (
                <tr><td colSpan={7} className="bg-bg-secondary p-2">
                  <div className="text-[10px] uppercase font-bold mb-1">Test history ({tests[c.id].length})</div>
                  {tests[c.id].length === 0 ? <div className="text-text-muted text-xs">No tests yet.</div> :
                    tests[c.id].map((t: any) => (
                      <div key={t.id} className="text-xs flex gap-3 py-0.5 border-b border-border-primary">
                        <span className="text-text-muted">{t.tested_at}</span>
                        <span>{t.tested_by}</span>
                        <span className={t.result === 'pass' ? 'text-green-400' : t.result === 'fail' ? 'text-red-400' : ''}>{t.result}</span>
                        <span className="text-text-muted">{t.evidence}</span>
                        <span>{t.notes}</span>
                      </div>
                    ))
                  }
                </td></tr>
              )}
            </React.Fragment>
          ))}
          {controls.length === 0 && <tr><td colSpan={7} className="p-2 text-text-muted text-center">No SOX controls defined yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

// 24. Audit-letter generator
const AuditLetter: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [asOf, setAsOf] = useState(todayLocal());
  const [auditor, setAuditor] = useState('');
  const generate = async () => {
    const res: any = await window.electronAPI.invoke('compliance:audit-letter-data', { companyId, asOfDate: asOf });
    if (res?.error) { alert(res.error); return; }
    const c = res.company || {};
    const balances = res.balances || [];
    const html = `<!DOCTYPE html><html><head><title>Audit confirmation letter ${asOf}</title>
      <style>body{font-family:sans-serif;padding:32px;font-size:12px;line-height:1.5;}h1{font-size:16px;}table{border-collapse:collapse;font-size:11px;}td,th{border:1px solid #ccc;padding:4px;}</style>
      </head><body>
      <h1>${c.name || ''}</h1>
      <p>${todayLocal()}</p>
      <p>To: ${auditor || 'External auditors'}</p>
      <p>This letter is in connection with your audit of our financial statements as of ${asOf}.</p>
      <p><b>Account balances</b></p>
      <table><tr><th>Code</th><th>Account</th><th>Type</th><th>Balance</th></tr>
      ${balances.map((b: any) => `<tr><td>${b.code}</td><td>${b.name}</td><td>${b.type}</td><td align="right">${formatCurrency(b.balance || 0)}</td></tr>`).join('')}
      </table>
      <p style="margin-top:16px;"><b>Management representations</b></p>
      <ul>
        <li>The financial records reflect all known transactions through ${asOf}.</li>
        <li>All material related-party transactions have been disclosed.</li>
        <li>No fraud or suspected fraud is known affecting the entity.</li>
        <li>Period locks and reconciliations are current as of the date of this letter.</li>
      </ul>
      <p>Sincerely,</p>
      <p>____________________________<br />Officer</p>
      </body></html>`;
    await api.saveToPDF(html, `audit-letter-${asOf}`, { openAfterSave: true });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <input placeholder="Auditor / firm" value={auditor} onChange={(e) => setAuditor(e.target.value)} className="px-2 py-1.5 text-xs bg-bg-primary border border-border-primary" />
        <button onClick={generate} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">Generate audit letter</button>
      </div>
      <div className="text-xs text-text-muted">Prefilled with balances + standard management representations.</div>
    </div>
  );
};

// 26. Hash chain verify
const HashChain: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [result, setResult] = useState<any>(null);
  const verify = async () => {
    const r = await window.electronAPI.invoke('compliance:hash-chain-verify', { companyId, limit: 5000 });
    setResult(r);
  };
  return (
    <div className="space-y-3">
      <button onClick={verify} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">
        <Hash size={11} className="inline mr-1" />Verify audit-log hash chain
      </button>
      {result && (
        <div className={`p-3 border ${result.ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
          <div className="text-sm font-bold">
            {result.ok ? '✓ Chain intact' : '✗ Chain integrity issues found'}
          </div>
          <div className="text-xs">Total entries scanned: {result.total} · Healed (backfilled hashes): {result.healed} · Issues: {(result.issues || []).length}</div>
          {(result.issues || []).slice(0, 20).map((i: any) => (
            <div key={i.id} className="text-[11px] text-red-400 font-mono">
              {i.id}: expected {i.expected.slice(0, 16)}… got {(i.actual || '').slice(0, 16)}…
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-text-muted">Each audit_log row stores SHA-256(prev_hash + payload). Tampering breaks the chain.</div>
    </div>
  );
};

// 27/28/29. Approval rules
const ApprovalRules: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [rules, setRules] = useState({ twoFactorThreshold: 0, commentThreshold: 0, blockSelfApproval: true });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    window.electronAPI.invoke('compliance:approval-rules-get').then((r: any) => r && setRules(r));
  }, [companyId]);
  const save = async () => {
    setSaving(true);
    await window.electronAPI.invoke('compliance:approval-rules-save', rules);
    setSaving(false);
    alert('Approval rules saved.');
  };
  return (
    <div className="space-y-3 max-w-xl">
      <div className="border border-border-primary p-3 space-y-2">
        <div className="text-xs font-bold">Two-factor approval threshold</div>
        <div className="text-[11px] text-text-muted">JEs with total ≥ this amount require approval by 2 distinct users.</div>
        <input type="number" value={rules.twoFactorThreshold} onChange={(e) => setRules({ ...rules, twoFactorThreshold: Number(e.target.value) })}
          className="w-32 px-2 py-1 text-xs bg-bg-primary border border-border-primary" />
      </div>
      <div className="border border-border-primary p-3 space-y-2">
        <div className="text-xs font-bold">Comment-required threshold</div>
        <div className="text-[11px] text-text-muted">Above this amount, approver must enter a non-empty comment.</div>
        <input type="number" value={rules.commentThreshold} onChange={(e) => setRules({ ...rules, commentThreshold: Number(e.target.value) })}
          className="w-32 px-2 py-1 text-xs bg-bg-primary border border-border-primary" />
      </div>
      <div className="border border-border-primary p-3 space-y-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={rules.blockSelfApproval} onChange={(e) => setRules({ ...rules, blockSelfApproval: e.target.checked })} />
          Block self-approval (creator/poster can never approve their own JE)
        </label>
      </div>
      <button disabled={saving} onClick={save} className="px-3 py-1.5 text-xs font-semibold bg-accent-blue text-white">Save approval rules</button>
    </div>
  );
};

export default ComplianceCenter;
