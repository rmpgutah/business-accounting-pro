import React, { useEffect, useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  description: string;
  parent_account_id: string | null;
  is_active: boolean;
  balance: number;
}

interface AccountFormProps {
  account: Account | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

interface ParentOption {
  id: string;
  code: string;
  name: string;
}

// ─── Subtypes by Type ───────────────────────────────────
const SUBTYPES: Record<AccountType, string[]> = {
  asset: [
    'Cash and Cash Equivalents',
    'Accounts Receivable',
    'Inventory',
    'Prepaid Expenses',
    'Fixed Assets',
    'Other Current Assets',
    'Other Non-Current Assets',
  ],
  liability: [
    'Accounts Payable',
    'Credit Card',
    'Accrued Liabilities',
    'Current Liabilities',
    'Long-Term Liabilities',
    'Payroll Liabilities',
  ],
  equity: [
    "Owner's Equity",
    'Retained Earnings',
    'Common Stock',
    'Additional Paid-In Capital',
    'Distributions',
  ],
  revenue: [
    'Sales Revenue',
    'Service Revenue',
    'Interest Income',
    'Other Income',
  ],
  expense: [
    'Cost of Goods Sold',
    'Operating Expenses',
    'Payroll Expenses',
    'Rent & Utilities',
    'Depreciation',
    'Interest Expense',
    'Taxes',
    'Other Expenses',
  ],
};

// ─── Component ──────────────────────────────────────────
const AccountForm: React.FC<AccountFormProps> = ({
  account,
  onClose,
  onSaved,
}) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const isEdit = account !== null;

  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'asset');
  const [subtype, setSubtype] = useState(account?.subtype ?? '');
  const [description, setDescription] = useState(account?.description ?? '');
  const [parentAccountId, setParentAccountId] = useState<string>(
    account?.parent_account_id ?? ''
  );
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [parentOptions, setParentOptions] = useState<ParentOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load parent account options
  useEffect(() => {
    const loadParents = async () => {
      if (!activeCompany) return;
      try {
        const data = await api.query('accounts', {
          company_id: activeCompany.id,
        });
        if (Array.isArray(data)) {
          const opts = data
            .filter((a: Account) => a.id !== account?.id)
            .map((a: Account) => ({ id: a.id, code: a.code, name: a.name }));
          setParentOptions(opts);
        }
      } catch (err) {
        console.error('Failed to load parent accounts:', err);
      }
    };
    loadParents();
  }, [activeCompany, account]);

  // Reset subtype when type changes (only if creating or type changed from original)
  useEffect(() => {
    if (!isEdit || type !== account?.type) {
      setSubtype('');
    }
  }, [type]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!code.trim()) errs.code = 'Account code is required';
    if (!name.trim()) errs.name = 'Account name is required';
    if (!type) errs.type = 'Account type is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !activeCompany) return;

    setSaving(true);
    try {
      const payload = {
        company_id: activeCompany.id,
        code: code.trim(),
        name: name.trim(),
        type,
        subtype: subtype || null,
        description: description.trim() || null,
        parent_account_id: parentAccountId || null,
        is_active: isActive,
      };

      if (isEdit && account) {
        await api.update('accounts', account.id, payload);
      } else {
        await api.create('accounts', payload);
      }

      onSaved();
    } catch (err: any) {
      console.error('Failed to save account:', err);
      setErrors({ _form: err?.message ?? 'Failed to save account' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
      <div
        className="bg-bg-elevated border border-border-primary w-full max-w-lg shadow-xl"
        style={{ borderRadius: '2px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold text-text-primary">
            {isEdit ? 'Edit Account' : 'New Account'}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {errors._form && (
            <div
              className="bg-accent-expense/10 border border-accent-expense/30 text-accent-expense text-xs px-3 py-2"
              style={{ borderRadius: '2px' }}
            >
              {errors._form}
            </div>
          )}

          {/* Code */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Account Code *
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 1000"
              className={`block-input w-full px-3 py-2 text-sm bg-bg-primary border ${
                errors.code ? 'border-accent-expense' : 'border-border-primary'
              } text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue`}
              style={{ borderRadius: '2px' }}
            />
            {errors.code && (
              <p className="text-[10px] text-accent-expense mt-1">
                {errors.code}
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Account Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cash in Bank"
              className={`block-input w-full px-3 py-2 text-sm bg-bg-primary border ${
                errors.name ? 'border-accent-expense' : 'border-border-primary'
              } text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue`}
              style={{ borderRadius: '2px' }}
            />
            {errors.name && (
              <p className="text-[10px] text-accent-expense mt-1">
                {errors.name}
              </p>
            )}
          </div>

          {/* Type */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Account Type *
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '2px' }}
            >
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="expense">Expense</option>
            </select>
          </div>

          {/* Subtype */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Subtype
            </label>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '2px' }}
            >
              <option value="">Select subtype...</option>
              {SUBTYPES[type].map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional description..."
              className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
              style={{ borderRadius: '2px' }}
            />
          </div>

          {/* Parent Account */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Parent Account
            </label>
            <select
              value={parentAccountId}
              onChange={(e) => setParentAccountId(e.target.value)}
              className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '2px' }}
            >
              <option value="">None (top-level)</option>
              {parentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.code} — {opt.name}
                </option>
              ))}
            </select>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              {isActive ? (
                <div
                  className="w-8 h-4 bg-accent-blue flex items-center justify-end px-0.5"
                  style={{ borderRadius: '2px' }}
                >
                  <div
                    className="w-3 h-3 bg-white"
                    style={{ borderRadius: '1px' }}
                  />
                </div>
              ) : (
                <div
                  className="w-8 h-4 bg-bg-tertiary flex items-center justify-start px-0.5"
                  style={{ borderRadius: '2px' }}
                >
                  <div
                    className="w-3 h-3 bg-text-muted"
                    style={{ borderRadius: '1px' }}
                  />
                </div>
              )}
              Active
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-primary">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-text-secondary bg-bg-tertiary border border-border-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="block-btn-primary flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderRadius: '2px' }}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountForm;
