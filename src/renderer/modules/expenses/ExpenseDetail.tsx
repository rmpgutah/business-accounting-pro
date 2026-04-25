// ExpenseDetail.tsx
// Read-only detail page for a single expense.
// Mirrors InvoiceDetail's structure: header → body → RelatedPanel + EntityTimeline.

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Edit, Copy, CheckCircle, XCircle, DollarSign, Receipt as ReceiptIcon } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';
import EntityChip from '../../components/EntityChip';
import ErrorBanner from '../../components/ErrorBanner';

interface Props {
  expenseId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

const ExpenseDetail: React.FC<Props> = ({ expenseId, onBack, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [expense, setExpense] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const reload = async () => {
    if (!activeCompany) return;
    try {
      setLoading(true);
      const rows = await api.rawQuery(
        `SELECT e.*, c.name as category_name, v.name as vendor_name, p.name as project_name
         FROM expenses e
         LEFT JOIN categories c ON c.id = e.category_id
         LEFT JOIN vendors v ON v.id = e.vendor_id
         LEFT JOIN projects p ON p.id = e.project_id
         WHERE e.id = ? AND e.company_id = ?`,
        [expenseId, activeCompany.id]
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      setExpense(row || null);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load expense');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [expenseId, activeCompany]);

  const setStatus = async (status: string) => {
    try {
      await api.update('expenses', expenseId, { status });
      reload();
    } catch (e: any) { alert(e?.message || 'Update failed'); }
  };

  const markReimbursed = async () => {
    try {
      await api.update('expenses', expenseId, { reimbursed: 1, reimbursed_date: new Date().toISOString().slice(0, 10) });
      reload();
    } catch (e: any) { alert(e?.message || 'Update failed'); }
  };

  const duplicate = async () => {
    const r = await api.cloneRecord('expenses', expenseId);
    if (r?.id) onEdit(r.id);
  };

  if (loading) return <div className="text-text-muted text-sm py-12 text-center">Loading expense...</div>;
  if (err) return <ErrorBanner message={err} onDismiss={() => setErr('')} />;
  if (!expense) return <div className="text-text-muted text-sm py-12 text-center">Expense not found.</div>;

  const st = formatStatus(expense.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => onEdit(expenseId)} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <Edit size={13} /> Edit
          </button>
          <button onClick={duplicate} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <Copy size={13} /> Duplicate
          </button>
          {expense.status !== 'approved' && (
            <button onClick={() => setStatus('approved')} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-income text-accent-income">
              <CheckCircle size={13} /> Approve
            </button>
          )}
          {expense.status !== 'pending' && (
            <button onClick={() => setStatus('pending')} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-expense">
              <XCircle size={13} /> Reset
            </button>
          )}
          {expense.is_reimbursable && !expense.reimbursed && (
            <button onClick={markReimbursed} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
              <DollarSign size={13} /> Mark Reimbursed
            </button>
          )}
        </div>
      </div>

      <div className="block-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: 6 }}>
            <ReceiptIcon size={18} className="text-accent-blue" />
          </div>
          <div className="flex-1">
            <h2 className="module-title text-text-primary">{expense.description || '(no description)'}</h2>
            <p className="text-xs text-text-muted mt-0.5">{formatDate(expense.date)} &middot; <span className={st.className}>{st.label}</span></p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase font-bold text-text-muted">Amount</div>
            <div className="text-2xl font-mono font-bold text-accent-expense">{formatCurrency(expense.amount)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <Field label="Vendor">
            {expense.vendor_id
              ? <EntityChip type="vendor" id={expense.vendor_id} label={expense.vendor_name || ''} variant="inline" />
              : <span className="text-text-muted">—</span>}
          </Field>
          <Field label="Category">{expense.category_name || '—'}</Field>
          <Field label="Project">
            {expense.project_id
              ? <EntityChip type="project" id={expense.project_id} label={expense.project_name || ''} variant="inline" />
              : <span className="text-text-muted">—</span>}
          </Field>
          <Field label="Tax Amount">{formatCurrency(expense.tax_amount || 0)}</Field>
          <Field label="Payment Method">{expense.payment_method || '—'}</Field>
          <Field label="Reference">{expense.reference || '—'}</Field>
          <Field label="Billable">{expense.is_billable ? 'Yes' : 'No'}</Field>
          <Field label="Reimbursable">{expense.is_reimbursable ? (expense.reimbursed ? `Reimbursed ${expense.reimbursed_date || ''}` : 'Pending') : 'No'}</Field>
          <Field label="Receipt">
            {expense.receipt_path
              ? <a href={`file://${expense.receipt_path}`} target="_blank" rel="noreferrer" className="text-accent-blue hover:underline text-xs">View receipt</a>
              : <span className="text-text-muted">—</span>}
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RelatedPanel entityType="expense" entityId={expenseId} />
        <EntityTimeline entityType="expense" entityId={expenseId} />
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-xs uppercase font-bold text-text-muted">{label}</div>
    <div className="text-text-primary mt-1">{children}</div>
  </div>
);

export default ExpenseDetail;
