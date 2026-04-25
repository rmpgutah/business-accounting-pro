import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, formatDate } from '../../lib/format';
import ExpenseComments from './ExpenseComments';

interface QueueRow {
  id: string;
  amount: number;
  description: string;
  vendor_name?: string;
  employee_name?: string;
  approval_status?: string;
  submitted_at?: string;
  step_id?: string;
  step_order?: number;
  step_created?: string;
}

const ExpenseApprovalQueue: React.FC = () => {
  const company = useCompanyStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const [direct, setDirect] = useState<QueueRow[]>([]);
  const [steps, setSteps] = useState<QueueRow[]>([]);
  const [aging, setAging] = useState<any[]>([]);
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!company || !user) return;
    setLoading(true);
    try {
      const q = await api.expenseApprovalQueue(company.id, user.id);
      setDirect(q?.direct || []);
      setSteps(q?.steps || []);
      const sla = await api.expenseApprovalSla(company.id);
      setAging(sla?.rows || []);
    } finally { setLoading(false); }
  }, [company, user]);

  useEffect(() => { load(); }, [load]);

  const decide = async (row: QueueRow, decision: 'approve' | 'reject' | 'needs_info') => {
    if (!user) return;
    setBusy(true);
    try {
      await api.expenseDecide(row.id, user.id, decision, comment, row.step_id);
      setComment('');
      setSelected(null);
      await load();
    } finally { setBusy(false); }
  };

  const allRows = useMemo(() => {
    const merged = [...direct, ...steps];
    const seen = new Set<string>();
    return merged.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  }, [direct, steps]);

  const slaMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of aging) m[r.expense_id] = r.days_waiting || 0;
    return m;
  }, [aging]);

  if (!company || !user) {
    return <div className="text-text-muted text-sm">Sign in and select a company to view the queue.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="module-header">
        <div>
          <h2 className="module-title text-text-primary">Approval Queue</h2>
          <p className="text-xs text-text-muted mt-0.5">{allRows.length} expense{allRows.length !== 1 ? 's' : ''} awaiting your decision</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-text-muted text-sm">Loading…</div>
      ) : allRows.length === 0 ? (
        <div className="block-card p-6 text-center text-text-muted text-sm">No pending approvals — nice work.</div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Description</th>
                <th>Employee</th>
                <th>Vendor</th>
                <th className="text-right">Amount</th>
                <th>SLA</th>
                <th style={{ width: 220 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((r) => {
                const days = slaMap[r.id] ?? 0;
                const stale = days >= 3;
                return (
                  <tr key={(r.step_id || '') + r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <td className="font-mono text-xs text-text-secondary">{formatDate(r.submitted_at || r.step_created || '')}</td>
                    <td className="text-text-primary font-medium">{r.description || '(no description)'}</td>
                    <td className="text-text-secondary">{r.employee_name || '—'}</td>
                    <td className="text-text-secondary">{r.vendor_name || '—'}</td>
                    <td className="text-right font-mono text-accent-expense">{formatCurrency(r.amount)}</td>
                    <td>
                      <span className={`text-xs font-bold ${stale ? 'text-accent-expense' : 'text-text-muted'}`}>
                        <Clock size={10} className="inline mr-1" />{days}d waiting
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <button className="px-2 py-1 text-xs font-bold uppercase border border-accent-income text-accent-income hover:bg-accent-income hover:text-white" disabled={busy}
                          onClick={() => decide(r, 'approve')}>
                          <CheckCircle size={11} className="inline" /> Approve
                        </button>
                        <button className="px-2 py-1 text-xs font-bold uppercase border border-accent-expense text-accent-expense hover:bg-accent-expense hover:text-white" disabled={busy}
                          onClick={() => decide(r, 'reject')}>
                          <XCircle size={11} className="inline" /> Reject
                        </button>
                        <button className="px-2 py-1 text-xs font-bold uppercase border border-border-primary text-text-muted hover:border-accent-blue" disabled={busy}
                          onClick={() => decide(r, 'needs_info')}>
                          <AlertTriangle size={11} className="inline" /> Info
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="block-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase font-bold text-text-muted">Selected</div>
              <div className="text-sm font-bold text-text-primary">{selected.description} — {formatCurrency(selected.amount)}</div>
            </div>
            <button className="text-xs text-text-muted hover:text-text-primary" onClick={() => setSelected(null)}>Close</button>
          </div>
          <textarea
            className="block-input w-full"
            rows={2}
            placeholder="Comment (recorded with decision)…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <ExpenseComments expenseId={selected.id} />
        </div>
      )}
    </div>
  );
};

export default ExpenseApprovalQueue;
