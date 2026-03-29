import React, { useEffect, useState } from 'react';
import { ArrowLeft, Receipt, DollarSign } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface ExpenseFormData {
  date: string;
  amount: string;
  tax_amount: string;
  description: string;
  category_id: string;
  account_id: string;
  vendor_id: string;
  payment_method: string;
  project_id: string;
  client_id: string;
  is_billable: boolean;
  reference: string;
  tags: string;
}

interface DropdownOption {
  id: string;
  name: string;
}

interface ExpenseFormProps {
  expenseId?: string | null;
  onBack: () => void;
  onSaved: () => void;
}

const PAYMENT_METHODS = [
  { value: '', label: 'Select method...' },
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
];

const emptyForm: ExpenseFormData = {
  date: new Date().toISOString().split('T')[0],
  amount: '',
  tax_amount: '',
  description: '',
  category_id: '',
  account_id: '',
  vendor_id: '',
  payment_method: '',
  project_id: '',
  client_id: '',
  is_billable: false,
  reference: '',
  tags: '',
};

// ─── Component ──────────────────────────────────────────
const ExpenseForm: React.FC<ExpenseFormProps> = ({ expenseId, onBack, onSaved }) => {
  const [form, setForm] = useState<ExpenseFormData>({ ...emptyForm });
  const [categories, setCategories] = useState<DropdownOption[]>([]);
  const [accounts, setAccounts] = useState<DropdownOption[]>([]);
  const [vendors, setVendors] = useState<DropdownOption[]>([]);
  const [projects, setProjects] = useState<DropdownOption[]>([]);
  const [clients, setClients] = useState<DropdownOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const isEditing = !!expenseId;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [catData, accData, venData, projData, cliData] = await Promise.all([
          api.query('categories'),
          api.query('accounts', { type: 'expense' }),
          api.query('vendors'),
          api.query('projects'),
          api.query('clients'),
        ]);
        if (cancelled) return;

        setCategories(Array.isArray(catData) ? catData : []);
        setAccounts(Array.isArray(accData) ? accData : []);
        setVendors(Array.isArray(venData) ? venData : []);
        setProjects(Array.isArray(projData) ? projData : []);
        setClients(Array.isArray(cliData) ? cliData : []);

        if (expenseId) {
          const existing = await api.get('expenses', expenseId);
          if (existing && !cancelled) {
            setForm({
              date: existing.date || emptyForm.date,
              amount: existing.amount?.toString() || '',
              tax_amount: existing.tax_amount?.toString() || '',
              description: existing.description || '',
              category_id: existing.category_id || '',
              account_id: existing.account_id || '',
              vendor_id: existing.vendor_id || '',
              payment_method: existing.payment_method || '',
              project_id: existing.project_id || '',
              client_id: existing.client_id || '',
              is_billable: !!existing.is_billable,
              reference: existing.reference || '',
              tags: Array.isArray(existing.tags) ? existing.tags.join(', ') : (existing.tags || ''),
            });
          }
        }
      } catch (err) {
        console.error('Failed to load form data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [expenseId]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      const payload: Record<string, any> = {
        date: form.date,
        amount: parseFloat(form.amount) || 0,
        tax_amount: parseFloat(form.tax_amount) || 0,
        description: form.description,
        category_id: form.category_id || null,
        account_id: form.account_id || null,
        vendor_id: form.vendor_id || null,
        payment_method: form.payment_method || null,
        project_id: form.project_id || null,
        client_id: form.client_id || null,
        is_billable: form.is_billable,
        reference: form.reference || null,
        tags: form.tags
          ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
          : [],
      };

      if (isEditing && expenseId) {
        await api.update('expenses', expenseId, payload);
      } else {
        await api.create('expenses', payload);
      }
      onSaved();
    } catch (err) {
      console.error('Failed to save expense:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button
            className="block-btn flex items-center gap-2 px-3 py-2"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex items-center gap-2">
            <Receipt size={18} className="text-accent-blue" />
            <h2 className="module-title text-text-primary">
              {isEditing ? 'Edit Expense' : 'New Expense'}
            </h2>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="block-card p-6">
        <div className="grid grid-cols-3 gap-5">
          {/* Date */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Date <span className="text-accent-expense">*</span>
            </label>
            <input
              type="date"
              name="date"
              className="block-input"
              value={form.date}
              onChange={handleChange}
              required
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Amount <span className="text-accent-expense">*</span>
            </label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="number"
                name="amount"
                step="0.01"
                min="0"
                className="block-input pl-8"
                placeholder="0.00"
                value={form.amount}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          {/* Tax Amount */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Tax Amount
            </label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="number"
                name="tax_amount"
                step="0.01"
                min="0"
                className="block-input pl-8"
                placeholder="0.00"
                value={form.tax_amount}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Description — full width */}
          <div className="col-span-3">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Description
            </label>
            <input
              type="text"
              name="description"
              className="block-input"
              placeholder="What was this expense for?"
              value={form.description}
              onChange={handleChange}
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Category
            </label>
            <select
              name="category_id"
              className="block-select"
              value={form.category_id}
              onChange={handleChange}
            >
              <option value="">Select category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Expense Account */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Expense Account
            </label>
            <select
              name="account_id"
              className="block-select"
              value={form.account_id}
              onChange={handleChange}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Vendor */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Vendor
            </label>
            <select
              name="vendor_id"
              className="block-select"
              value={form.vendor_id}
              onChange={handleChange}
            >
              <option value="">Select vendor...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Payment Method
            </label>
            <select
              name="payment_method"
              className="block-select"
              value={form.payment_method}
              onChange={handleChange}
            >
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm.value} value={pm.value}>{pm.label}</option>
              ))}
            </select>
          </div>

          {/* Project (optional) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Project <span className="text-text-muted text-[10px]">(optional)</span>
            </label>
            <select
              name="project_id"
              className="block-select"
              value={form.project_id}
              onChange={handleChange}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Client (optional) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Client <span className="text-text-muted text-[10px]">(optional)</span>
            </label>
            <select
              name="client_id"
              className="block-select"
              value={form.client_id}
              onChange={handleChange}
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Reference */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Reference / Invoice #
            </label>
            <input
              type="text"
              name="reference"
              className="block-input"
              placeholder="e.g. INV-001"
              value={form.reference}
              onChange={handleChange}
            />
          </div>

          {/* Tags */}
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Tags <span className="text-text-muted text-[10px]">(comma-separated)</span>
            </label>
            <input
              type="text"
              name="tags"
              className="block-input"
              placeholder="e.g. office, supplies, quarterly"
              value={form.tags}
              onChange={handleChange}
            />
          </div>

          {/* Billable Checkbox */}
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                name="is_billable"
                checked={form.is_billable}
                onChange={handleChange}
                className="w-4 h-4 accent-accent-blue"
              />
              <span className="text-sm text-text-secondary">Billable to client</span>
            </label>
          </div>

          {/* Receipt Attachment Placeholder */}
          <div className="col-span-3">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Receipt Attachment
            </label>
            <div
              className="border border-dashed border-border-secondary flex items-center justify-center py-8 text-text-muted text-sm cursor-pointer hover:border-border-focus hover:bg-bg-hover transition-colors"
              style={{ borderRadius: '2px' }}
            >
              <Receipt size={16} className="mr-2" />
              Click or drag to attach receipt (coming soon)
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end mt-6 pt-4 border-t border-border-primary">
          <button
            type="button"
            className="block-btn mr-3"
            onClick={onBack}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="block-btn-primary flex items-center gap-2"
            disabled={saving}
          >
            {saving ? 'Saving...' : isEditing ? 'Update Expense' : 'Save Expense'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ExpenseForm;
