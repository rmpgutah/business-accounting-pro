import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Plus, Edit2, Trash2, ToggleLeft, ToggleRight,
  Play, X, ChevronDown, ChevronUp, AlertCircle,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ───────────────────────────────────────────────
interface BankRule {
  id: string;
  company_id: string;
  name: string;
  match_field: 'description' | 'amount' | 'reference';
  match_type: 'contains' | 'starts_with' | 'ends_with' | 'exact' | 'regex';
  match_value: string;
  amount_min: number | null;
  amount_max: number | null;
  transaction_type: 'any' | 'debit' | 'credit';
  action_account_id: string;
  description_override: string;
  priority: number;
  is_active: boolean;
  applied_count: number;
  created_at: string;
}

interface Account {
  id: string;
  name: string;
  code: string;
  type?: string;
}

// ─── Helpers ─────────────────────────────────────────────
const MATCH_FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  amount: 'Amount',
  reference: 'Reference',
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  contains: 'Contains',
  starts_with: 'Starts With',
  ends_with: 'Ends With',
  exact: 'Exact Match',
  regex: 'Regex',
};

const TXTYPE_LABELS: Record<string, string> = {
  any: 'Any',
  debit: 'Debit',
  credit: 'Credit',
};

const emptyForm = {
  name: '',
  match_field: 'description' as BankRule['match_field'],
  match_type: 'contains' as BankRule['match_type'],
  match_value: '',
  amount_min: '',
  amount_max: '',
  transaction_type: 'any' as BankRule['transaction_type'],
  action_account_id: '',
  description_override: '',
  priority: '10',
  is_active: true,
};

// ─── Toast ───────────────────────────────────────────────
interface Toast { id: number; msg: string; ok: boolean }
let _toastId = 0;

// ─── Component ───────────────────────────────────────────
const BankRules: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [rules, setRules] = useState<BankRule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const showToast = (msg: string, ok = true) => {
    const t = { id: ++_toastId, msg, ok };
    setToast(t);
    setTimeout(() => setToast((c) => (c?.id === t.id ? null : c)), 4000);
  };

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const [ruleRows, acctRows] = await Promise.all([
        api.query('bank_rules', { company_id: activeCompany.id }, { field: 'priority', dir: 'asc' }),
        api.query('accounts', { company_id: activeCompany.id }),
      ]);
      setRules(ruleRows ?? []);
      setAccounts(acctRows ?? []);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
    setShowForm(true);
  };

  const openEdit = (rule: BankRule) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      match_field: rule.match_field,
      match_type: rule.match_type,
      match_value: rule.match_value,
      amount_min: rule.amount_min != null ? String(rule.amount_min) : '',
      amount_max: rule.amount_max != null ? String(rule.amount_max) : '',
      transaction_type: rule.transaction_type,
      action_account_id: rule.action_account_id,
      description_override: rule.description_override ?? '',
      priority: String(rule.priority ?? 10),
      is_active: rule.is_active !== false,
    });
    setFormErrors({});
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
  };

  const setF = (k: string, v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFormErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Rule name is required.';
    if (!form.match_value.trim()) e.match_value = 'Match value is required.';
    if (!form.action_account_id) e.action_account_id = 'Action account is required.';
    if (form.amount_min !== '' && isNaN(parseFloat(form.amount_min))) {
      e.amount_min = 'Must be a valid number.';
    }
    if (form.amount_max !== '' && isNaN(parseFloat(form.amount_max))) {
      e.amount_max = 'Must be a valid number.';
    }
    const priorityInt = parseInt(form.priority, 10);
    if (form.priority.trim() === '' || isNaN(priorityInt) || priorityInt < 1) {
      e.priority = 'Priority must be a positive integer.';
    }
    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (saving) return;
    if (!validate() || !activeCompany) return;
    setSaving(true);
    try {
      const data: Record<string, any> = {
        company_id: activeCompany.id,
        name: form.name.trim(),
        match_field: form.match_field,
        match_type: form.match_type,
        match_value: form.match_value.trim(),
        amount_min: form.amount_min !== '' ? parseFloat(form.amount_min) : null,
        amount_max: form.amount_max !== '' ? parseFloat(form.amount_max) : null,
        transaction_type: form.transaction_type,
        action_account_id: form.action_account_id,
        description_override: form.description_override.trim() || null,
        priority: parseInt(form.priority, 10),
        is_active: form.is_active,
      };
      if (editingId) {
        await api.update('bank_rules', editingId, data);
        showToast('Rule updated.', true);
      } else {
        await api.create('bank_rules', { ...data, applied_count: 0 });
        showToast('Rule created.', true);
      }
      closeForm();
      load();
    } catch {
      showToast('Failed to save rule.', false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rule? This cannot be undone.')) return;
    try {
      await api.remove('bank_rules', id);
      showToast('Rule deleted.', true);
      load();
    } catch {
      showToast('Delete failed.', false);
    }
  };

  const handleToggleActive = async (rule: BankRule) => {
    try {
      await api.update('bank_rules', rule.id, { is_active: !rule.is_active });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: !r.is_active } : r));
    } catch {
      showToast('Failed to update rule.', false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const result = await api.bankRulesApply();
      showToast(`Applied to ${result?.applied ?? 0} transaction(s).`, true);
      load();
    } catch {
      showToast('Failed to apply rules.', false);
    } finally {
      setApplying(false);
    }
  };

  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} — ${a.name}` : id;
  };

  const F = ({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</label>
      {children}
      {error && <p className="text-xs text-accent-expense">{error}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 text-sm font-semibold border ${
            toast.ok ? 'bg-bg-elevated border-accent-income text-accent-income' : 'bg-bg-elevated border-accent-expense text-accent-expense'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {toast.msg}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
            <Shield size={15} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-primary">Bank Rules</h2>
            <p className="text-xs text-text-muted">Auto-categorize imported transactions.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={applying}
            className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Play size={12} className={applying ? 'animate-pulse' : ''} />
            {applying ? 'Applying...' : 'Apply Rules to Pending'}
          </button>
          <button
            onClick={openNew}
            className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Plus size={12} />
            New Rule
          </button>
        </div>
      </div>

      {/* Inline Form */}
      {showForm && (
        <div className="block-card p-5 border-accent-blue" style={{ borderColor: 'var(--color-accent-blue)', borderWidth: '1px' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-text-primary">
              {editingId ? 'Edit Bank Rule' : 'New Bank Rule'}
            </h3>
            <button onClick={closeForm} className="block-btn p-1">
              <X size={14} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <F label="Rule Name" error={formErrors.name}>
              <input
                className="block-input w-full"
                value={form.name}
                onChange={(e) => setF('name', e.target.value)}
                placeholder="e.g. AWS Monthly Bill"
              />
            </F>

            <F label="Match Field">
              <select className="block-select w-full" value={form.match_field} onChange={(e) => setF('match_field', e.target.value)}>
                {/* Alphabetical A→Z */}
                <option value="amount">Amount</option>
                <option value="description">Description</option>
                <option value="reference">Reference</option>
              </select>
            </F>

            <F label="Match Type">
              <select className="block-select w-full" value={form.match_type} onChange={(e) => setF('match_type', e.target.value)}>
                {/* Alphabetical A→Z */}
                <option value="contains">Contains</option>
                <option value="ends_with">Ends With</option>
                <option value="exact">Exact Match</option>
                <option value="regex">Regex</option>
                <option value="starts_with">Starts With</option>
              </select>
            </F>

            <F label="Match Value" error={formErrors.match_value}>
              <input
                className="block-input w-full font-mono text-xs"
                value={form.match_value}
                onChange={(e) => setF('match_value', e.target.value)}
                placeholder={form.match_type === 'regex' ? '^AWS.*' : 'amazon'}
              />
            </F>

            <F label="Amount Min ($)" error={formErrors.amount_min}>
              <input
                type="text"
                className="block-input w-full"
                value={form.amount_min}
                onChange={(e) => setF('amount_min', e.target.value)}
                placeholder="Optional"
              />
            </F>

            <F label="Amount Max ($)" error={formErrors.amount_max}>
              <input
                type="text"
                className="block-input w-full"
                value={form.amount_max}
                onChange={(e) => setF('amount_max', e.target.value)}
                placeholder="Optional"
              />
            </F>

            <F label="Transaction Type">
              <select className="block-select w-full" value={form.transaction_type} onChange={(e) => setF('transaction_type', e.target.value)}>
                {/* Alphabetical A→Z */}
                <option value="any">Any</option>
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
            </F>

            <F label="Action Account" error={formErrors.action_account_id}>
              <select
                className="block-select w-full"
                value={form.action_account_id}
                onChange={(e) => setF('action_account_id', e.target.value)}
              >
                <option value="">-- Select Account --</option>
                {/* Group by account type — alphabetical headers, alphabetical accounts within */}
                {(() => {
                  const TYPE_LABELS: Record<string, string> = {
                    asset: 'Assets', equity: 'Equity', expense: 'Expenses',
                    liability: 'Liabilities', revenue: 'Revenue',
                  };
                  const sorted = [...accounts].sort((a, b) =>
                    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
                  );
                  const groups: Record<string, Account[]> = {};
                  for (const a of sorted) {
                    const k = TYPE_LABELS[a.type ?? ''] ?? 'Other';
                    (groups[k] ||= []).push(a);
                  }
                  return Object.keys(groups)
                    .sort((x, y) => x.localeCompare(y))
                    .map((label) => (
                      <optgroup key={label} label={label}>
                        {groups[label].map((a) => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </optgroup>
                    ));
                })()}
              </select>
            </F>

            <F label="Priority" error={formErrors.priority}>
              <input
                type="text"
                className="block-input w-full"
                value={form.priority}
                onChange={(e) => setF('priority', e.target.value)}
                placeholder="10"
              />
            </F>

            <div className="col-span-2">
              <F label="Description Override (optional)">
                <input
                  className="block-input w-full"
                  value={form.description_override}
                  onChange={(e) => setF('description_override', e.target.value)}
                  placeholder="Leave blank to keep original"
                />
              </F>
            </div>

            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setF('is_active', !form.is_active)}
                  className={`transition-colors ${form.is_active ? 'text-accent-income' : 'text-text-muted'}`}
                >
                  {form.is_active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
                <span className="text-xs font-semibold text-text-secondary">
                  {form.is_active ? 'Active' : 'Inactive'}
                </span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border-primary">
            <button onClick={closeForm} className="block-btn px-4 py-2 text-xs">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="block-btn-primary px-4 py-2 text-xs"
            >
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Rule'}
            </button>
          </div>
        </div>
      )}

      {/* Rules Table */}
      <div className="block-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="empty-state py-14">
            <div className="empty-state-icon"><Shield size={30} /></div>
            <p className="text-text-muted text-sm mt-2">No bank rules configured.</p>
            <p className="text-text-muted text-xs mt-1">Rules auto-categorize transactions when you import bank data.</p>
            <button onClick={openNew} className="block-btn-primary mt-4 px-4 py-2 text-xs flex items-center gap-2 mx-auto">
              <Plus size={13} /> Create First Rule
            </button>
          </div>
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Match Field</th>
                <th>Match Type</th>
                <th>Match Value</th>
                <th>Action</th>
                <th className="text-center">Priority</th>
                <th className="text-center">Applied</th>
                <th className="text-center">Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <React.Fragment key={rule.id}>
                  <tr
                    className={`hover:bg-bg-hover ${!rule.is_active ? 'opacity-50' : ''} transition-colors`}
                  >
                    <td>
                      <button
                        className="text-left flex items-center gap-1.5 text-text-primary font-semibold hover:text-accent-blue transition-colors"
                        onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                      >
                        {expandedId === rule.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {rule.name}
                      </button>
                    </td>
                    <td>
                      <span className="block-badge block-badge-blue">{MATCH_FIELD_LABELS[rule.match_field]}</span>
                    </td>
                    <td className="text-text-secondary text-xs">{MATCH_TYPE_LABELS[rule.match_type]}</td>
                    <td>
                      <code className="text-xs font-mono text-accent-blue bg-bg-tertiary px-1.5 py-0.5" style={{ borderRadius: '6px' }}>
                        {rule.match_value}
                      </code>
                    </td>
                    <td className="text-text-secondary text-xs max-w-[180px] truncate">{accountName(rule.action_account_id)}</td>
                    <td className="text-center">
                      <span className="block-badge">{rule.priority}</span>
                    </td>
                    <td className="text-center">
                      <span className="block-badge block-badge-income">{rule.applied_count ?? 0}</span>
                    </td>
                    <td className="text-center">
                      <button
                        onClick={() => handleToggleActive(rule)}
                        className={`transition-colors ${rule.is_active ? 'text-accent-income' : 'text-text-muted'}`}
                        title={rule.is_active ? 'Disable rule' : 'Enable rule'}
                      >
                        {rule.is_active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                      </button>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(rule)} className="block-btn p-1.5" title="Edit">
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          className="block-btn p-1.5 text-accent-expense"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded details row */}
                  {expandedId === rule.id && (
                    <tr>
                      <td colSpan={9} className="bg-bg-tertiary px-4 py-3">
                        <div className="grid grid-cols-4 gap-4 text-xs">
                          <div>
                            <span className="text-text-muted font-semibold uppercase">Transaction Type</span>
                            <p className="text-text-primary mt-0.5">{TXTYPE_LABELS[rule.transaction_type]}</p>
                          </div>
                          {rule.amount_min != null && (
                            <div>
                              <span className="text-text-muted font-semibold uppercase">Amount Min</span>
                              <p className="text-text-primary mt-0.5">${rule.amount_min}</p>
                            </div>
                          )}
                          {rule.amount_max != null && (
                            <div>
                              <span className="text-text-muted font-semibold uppercase">Amount Max</span>
                              <p className="text-text-primary mt-0.5">${rule.amount_max}</p>
                            </div>
                          )}
                          {rule.description_override && (
                            <div>
                              <span className="text-text-muted font-semibold uppercase">Description Override</span>
                              <p className="text-text-primary mt-0.5 italic">"{rule.description_override}"</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default BankRules;
