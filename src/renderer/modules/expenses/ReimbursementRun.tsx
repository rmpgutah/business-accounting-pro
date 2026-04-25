import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Wallet, Download, Printer, AlertTriangle, FileText, Banknote } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';

interface Employee { id: string; name: string; email?: string; }
interface Balance { employee_id: string; employee_name: string; expense_count: number; balance: number; }
interface ExpenseRow {
  id: string; date: string; amount: number; description: string;
  vendor_name?: string; category_name?: string; receipt_path?: string;
}

const ReimbursementRun: React.FC = () => {
  const company = useCompanyStore((s) => s.activeCompany);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [items, setItems] = useState<ExpenseRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [balances, setBalances] = useState<Balance[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [aging, setAging] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeBatch, setActiveBatch] = useState<any | null>(null);

  // load employees + balances + batches + aging
  const reloadAll = useCallback(async () => {
    if (!company) return;
    const emps = await api.query('employees', { company_id: company.id });
    setEmployees(Array.isArray(emps) ? emps : []);
    const bal = await api.reimbursementBalances(company.id);
    setBalances(bal?.balances || []);
    const bs = await api.reimbursementListBatches(company.id);
    setBatches(bs?.batches || []);
    const ag = await api.reimbursementAging(company.id, 14);
    setAging(ag?.rows || []);
  }, [company]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  const loadItems = useCallback(async () => {
    if (!company || !employeeId) { setItems([]); return; }
    const r = await api.reimbursableForEmployee(company.id, employeeId, periodStart || undefined, periodEnd || undefined);
    setItems(r?.expenses || []);
    setSelected(new Set((r?.expenses || []).map((e: ExpenseRow) => e.id)));
  }, [company, employeeId, periodStart, periodEnd]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const totalSelected = useMemo(
    () => items.filter((i) => selected.has(i.id)).reduce((s, i) => s + (i.amount || 0), 0),
    [items, selected]
  );

  const toggle = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const generateBatch = async () => {
    if (!company || !employeeId || selected.size === 0) return;
    setBusy(true);
    try {
      const res = await api.reimbursementCreateBatch(
        company.id, employeeId, Array.from(selected), periodStart || undefined, periodEnd || undefined
      );
      if (res?.error) { alert('Failed: ' + res.error); return; }
      // Threshold notification
      await api.reimbursementCheckThreshold(company.id, employeeId);
      await reloadAll();
      await loadItems();
      alert(`Batch created: ${formatCurrency(res?.total || 0)} across ${res?.count || 0} expenses.`);
    } finally { setBusy(false); }
  };

  // Feature 14: printable statement
  const printStatement = async (rows: ExpenseRow[], title: string) => {
    const empName = employees.find((e) => e.id === employeeId)?.name || 'Employee';
    const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
    const html = `
      <html><head><title>${title}</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}
      h1{margin:0 0 4px;font-size:22px}h2{margin:0 0 16px;font-size:14px;color:#555;font-weight:500}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px}
      th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left}
      th{background:#f3f4f6;text-transform:uppercase;font-size:10px;letter-spacing:.04em}
      .right{text-align:right}.total{font-weight:bold;border-top:2px solid #111}</style></head><body>
      <h1>Reimbursement Statement</h1>
      <h2>${empName} — ${company?.name || ''} ${periodStart ? '· '+periodStart : ''} ${periodEnd ? 'to '+periodEnd : ''}</h2>
      <table><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Description</th><th>Receipt</th><th class="right">Amount</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.date}</td><td>${r.vendor_name||''}</td><td>${r.category_name||''}</td><td>${r.description||''}</td><td>${r.receipt_path?'Yes':''}</td><td class="right">${formatCurrency(r.amount)}</td></tr>`).join('')}
      <tr class="total"><td colspan="5" class="right">Total</td><td class="right">${formatCurrency(total)}</td></tr></tbody></table>
      </body></html>`;
    await api.printPreview(html, title);
  };

  const openBatch = async (batchId: string) => {
    const res = await api.reimbursementBatchDetail(batchId);
    setActiveBatch(res);
  };

  const exportBatchPdf = async () => {
    if (!activeBatch) return;
    await printStatement(activeBatch.expenses || [], `Reimbursement-${activeBatch.batch?.id || ''}`);
  };

  const exportAch = async () => {
    if (!activeBatch?.batch) return;
    const r = await api.reimbursementAchExport(activeBatch.batch.id);
    if (r?.path) alert('ACH-ready CSV saved to: ' + r.path);
    else if (r?.error) alert('Export failed: ' + r.error);
  };

  const markPaidPayroll = async () => {
    if (!activeBatch?.batch) return;
    const runId = window.prompt('Payroll Run ID to link:');
    if (!runId) return;
    const r = await api.reimbursementMarkPaidPayroll(activeBatch.batch.id, runId);
    if (r?.error) alert(r.error); else { alert('Marked paid via payroll'); await reloadAll(); }
  };

  if (!company) return <div className="text-text-muted text-sm">Select a company.</div>;

  return (
    <div className="space-y-4">
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: 6 }}>
            <Wallet size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Reimbursement Run</h2>
            <p className="text-xs text-text-muted mt-0.5">Generate batches and pay employee reimbursements</p>
          </div>
        </div>
      </div>

      {/* Balances overview */}
      {balances.length > 0 && (
        <div className="block-card p-3">
          <div className="text-xs uppercase font-bold text-text-muted mb-2">Outstanding Balances</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {balances.map((b) => (
              <button key={b.employee_id} onClick={() => setEmployeeId(b.employee_id)}
                className="text-left border border-border-primary p-2 hover:border-accent-blue" style={{ borderRadius: 4 }}>
                <div className="text-xs font-bold text-text-primary truncate">{b.employee_name}</div>
                <div className="text-sm font-mono text-accent-expense">{formatCurrency(b.balance)}</div>
                <div className="text-xs text-text-muted">{b.expense_count} expense{b.expense_count !== 1 ? 's' : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Aging */}
      {aging.length > 0 && (
        <div className="block-card p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-accent-expense" />
            <span className="text-xs uppercase font-bold text-accent-expense">Aging — over 14 days</span>
          </div>
          <div className="space-y-1">
            {aging.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs">
                <span className="text-text-primary">{a.employee_name || '—'} · {a.description}</span>
                <span className="font-mono text-accent-expense">{formatCurrency(a.amount)} · {a.days_waiting}d</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run config */}
      <div className="block-card p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select className="block-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select employee…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input type="date" className="block-input" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} placeholder="From" />
          <input type="date" className="block-input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} placeholder="To" />
          <button className="block-btn-primary flex items-center gap-2" onClick={generateBatch} disabled={busy || selected.size === 0 || !employeeId}>
            <Banknote size={14} /> Generate Batch ({formatCurrency(totalSelected)})
          </button>
        </div>

        {employeeId && (
          items.length === 0 ? (
            <div className="text-xs text-text-muted">No reimbursable approved expenses for this employee in this period.</div>
          ) : (
            <table className="block-table">
              <thead>
                <tr><th style={{ width: 32 }}></th><th>Date</th><th>Description</th><th>Category</th><th>Vendor</th><th className="text-right">Amount</th></tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td className="font-mono text-xs">{formatDate(r.date)}</td>
                    <td>{r.description}</td>
                    <td>{r.category_name || '—'}</td>
                    <td>{r.vendor_name || '—'}</td>
                    <td className="text-right font-mono">{formatCurrency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {employeeId && items.length > 0 && (
          <div className="flex gap-2">
            <button className="px-3 py-2 border border-border-primary text-xs font-bold uppercase flex items-center gap-1 hover:border-accent-blue"
              onClick={() => printStatement(items, 'Reimbursement-Statement')}>
              <Printer size={12} /> Print Statement
            </button>
          </div>
        )}
      </div>

      {/* Batch history */}
      <div className="block-card p-3">
        <div className="text-xs uppercase font-bold text-text-muted mb-2">Recent Batches</div>
        {batches.length === 0 ? (
          <div className="text-xs text-text-muted">No batches yet.</div>
        ) : (
          <table className="block-table">
            <thead><tr><th>Date</th><th>Employee</th><th>Period</th><th className="text-right">Total</th><th>#</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="cursor-pointer" onClick={() => openBatch(b.id)}>
                  <td className="font-mono text-xs">{formatDate(b.created_at)}</td>
                  <td>{b.employee_name || '—'}</td>
                  <td className="text-xs text-text-muted">{b.period_start || '—'} → {b.period_end || '—'}</td>
                  <td className="text-right font-mono">{formatCurrency(b.total_amount)}</td>
                  <td className="text-xs">{b.expense_count}</td>
                  <td className="text-xs uppercase">{b.status}</td>
                  <td className="text-xs text-accent-blue">View</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Batch detail */}
      {activeBatch?.batch && (
        <div className="block-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase font-bold text-text-muted">Batch {activeBatch.batch.id.slice(0, 8)}</div>
              <div className="text-sm font-bold">{activeBatch.batch.employee_name} — {formatCurrency(activeBatch.batch.total_amount)}</div>
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-2 border border-border-primary text-xs font-bold uppercase flex items-center gap-1 hover:border-accent-blue" onClick={exportBatchPdf}>
                <FileText size={12} /> PDF
              </button>
              <button className="px-3 py-2 border border-border-primary text-xs font-bold uppercase flex items-center gap-1 hover:border-accent-blue" onClick={exportAch}>
                <Download size={12} /> ACH-ready CSV
              </button>
              <button className="px-3 py-2 border border-border-primary text-xs font-bold uppercase flex items-center gap-1 hover:border-accent-blue" onClick={markPaidPayroll}>
                Mark Paid via Payroll
              </button>
              <button className="text-xs text-text-muted hover:text-text-primary" onClick={() => setActiveBatch(null)}>Close</button>
            </div>
          </div>
          <table className="block-table">
            <thead><tr><th>Date</th><th>Description</th><th>Vendor</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {(activeBatch.expenses || []).map((e: ExpenseRow) => (
                <tr key={e.id}><td className="font-mono text-xs">{formatDate(e.date)}</td><td>{e.description}</td><td>{e.vendor_name || '—'}</td><td className="text-right font-mono">{formatCurrency(e.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ReimbursementRun;
