import React, { useEffect, useState } from 'react';
import { X, Save, Loader2, Sparkles, Lock, Pin, FileText } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { Barcode39, AccountCommentsPanel } from './AccountAdvancedDialogs';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  description: string;
  parent_id: string | null;
  is_active: boolean;
  balance: number;
  is_1099_eligible?: number | boolean;
  color?: string;
  is_pinned?: number | boolean;
  is_locked?: number | boolean;
  requires_document?: number | boolean;
  custom_fields?: string;
  rename_log?: string;
  monthly_cap?: number;
  currency?: string;
  bank_account_id?: string;
  subledger_type?: string;
  compliance_tags?: string;
}

const COMPLIANCE_OPTIONS = ['PCI', 'HIPAA', 'GDPR', 'SOX'];
const SUBLEDGER_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'ar', label: 'A/R control' },
  { value: 'ap', label: 'A/P control' },
  { value: 'inventory', label: 'Inventory control' },
];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'MXN', 'INR'];

interface AccountFormProps {
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
}

interface ParentOption { id: string; code: string; name: string; }

const SUBTYPES: Record<AccountType, string[]> = {
  asset: ['Accounts Receivable', 'Cash and Cash Equivalents', 'Fixed Assets', 'Inventory', 'Other Current Assets', 'Other Non-Current Assets', 'Prepaid Expenses'],
  liability: ['Accounts Payable', 'Accrued Liabilities', 'Credit Card', 'Current Liabilities', 'Long-Term Liabilities', 'Payroll Liabilities'],
  equity: ['Additional Paid-In Capital', 'Common Stock', 'Distributions', "Owner's Equity", 'Retained Earnings'],
  revenue: ['Interest Income', 'Other Income', 'Sales Revenue', 'Service Revenue'],
  expense: ['Cost of Goods Sold', 'Depreciation', 'Interest Expense', 'Operating Expenses', 'Other Expenses', 'Payroll Expenses', 'Rent & Utilities', 'Taxes'],
};

const RANGE_HINTS: Record<AccountType, string> = {
  asset: '1000-1999', liability: '2000-2999', equity: '3000-3999', revenue: '4000-4999', expense: '5000-9999',
};

const COLOR_PRESETS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(txt: string): { __html: string } {
  const e = escapeHtml(txt);
  const html = e
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
  return { __html: html || '<span style="color:#888">No description</span>' };
}

const AccountForm: React.FC<AccountFormProps> = ({ account, onClose, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const isEdit = account !== null;
  const isLocked = !!(account?.is_locked);

  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'asset');
  const [subtype, setSubtype] = useState(account?.subtype ?? '');
  const [description, setDescription] = useState(account?.description ?? '');
  const [parentAccountId, setParentAccountId] = useState<string>(account?.parent_id ?? '');
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [is1099, setIs1099] = useState<boolean>(!!(account?.is_1099_eligible));
  const [color, setColor] = useState(account?.color ?? '');
  const [isPinned, setIsPinned] = useState<boolean>(!!(account?.is_pinned));
  const [accountIsLocked, setAccountIsLocked] = useState<boolean>(!!(account?.is_locked));
  const [requiresDoc, setRequiresDoc] = useState<boolean>(!!(account?.requires_document));
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>(() => {
    try {
      const cf = account?.custom_fields ? JSON.parse(account.custom_fields) : {};
      return Object.entries(cf).map(([k, v]) => ({ key: k, value: String(v) }));
    } catch { return []; }
  });
  const [parentOptions, setParentOptions] = useState<ParentOption[]>([]);
  const [currency, setCurrency] = useState<string>(account?.currency || 'USD');
  const [bankAccountId, setBankAccountId] = useState<string>(account?.bank_account_id || '');
  const [subledgerType, setSubledgerType] = useState<string>(account?.subledger_type || 'none');
  const [monthlyCap, setMonthlyCap] = useState<string>(String(account?.monthly_cap || 0));
  const [complianceTags, setComplianceTags] = useState<string[]>(() => {
    try { return account?.compliance_tags ? JSON.parse(account.compliance_tags) : []; } catch { return []; }
  });
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!activeCompany) return;
    api.query('bank_accounts', { company_id: activeCompany.id })
      .then((r: any) => { if (Array.isArray(r)) setBankAccounts(r.map((b: any) => ({ id: b.id, name: b.name }))); })
      .catch(() => {});
  }, [activeCompany]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [codeWarning, setCodeWarning] = useState('');
  const [previewMd, setPreviewMd] = useState(false);

  useEffect(() => {
    const loadParents = async () => {
      if (!activeCompany) return;
      try {
        const data = await api.query('accounts', { company_id: activeCompany.id });
        if (Array.isArray(data)) {
          const opts = data
            .filter((a: Account) => a.id !== account?.id)
            .map((a: Account) => ({ id: a.id, code: a.code, name: a.name }))
            .sort((a, b) => a.code.localeCompare(b.code));
          setParentOptions(opts);
        }
      } catch { /* ignore */ }
    };
    loadParents();
  }, [activeCompany, account]);

  useEffect(() => {
    if (!isEdit && activeCompany && !code) {
      api.accountsSuggestCode(activeCompany.id, type).then(r => {
        if (r?.code) setCode(r.code);
      }).catch(() => {});
    }
  }, [type, activeCompany, isEdit]);

  useEffect(() => {
    if (!isEdit || type !== account?.type) setSubtype('');
  }, [type]);

  useEffect(() => {
    if (!code) { setCodeWarning(''); return; }
    const n = parseInt(code, 10);
    if (isNaN(n)) { setCodeWarning(''); return; }
    const ranges: Record<AccountType, [number, number]> = {
      asset: [1000, 1999], liability: [2000, 2999], equity: [3000, 3999], revenue: [4000, 4999], expense: [5000, 9999],
    };
    const [lo, hi] = ranges[type];
    if (n < lo || n > hi) {
      setCodeWarning('Code outside conventional range for ' + type + ' (' + RANGE_HINTS[type] + '). Allowed but unusual.');
    } else {
      setCodeWarning('');
    }
  }, [code, type]);

  const suggestCode = async () => {
    if (!activeCompany) return;
    const r = await api.accountsSuggestCode(activeCompany.id, type);
    if (r?.code) setCode(r.code);
  };

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
    if (isLocked) {
      alert('This account is locked and cannot be edited. Unlock it first if needed.');
      return;
    }
    setSaving(true);
    try {
      const cfObj: Record<string, string> = {};
      for (const { key, value } of customFields) {
        if (key.trim()) cfObj[key.trim()] = value;
      }
      let renameLog: any[] = [];
      try { renameLog = account?.rename_log ? JSON.parse(account.rename_log) : []; } catch {}
      if (isEdit && account && account.name !== name.trim()) {
        renameLog.push({ old_name: account.name, new_name: name.trim(), at: new Date().toISOString(), by: 'user' });
      }

      const payload: Record<string, any> = {
        company_id: activeCompany.id,
        code: code.trim(),
        name: name.trim(),
        type,
        subtype: subtype || '',
        description: description || '',
        parent_id: parentAccountId || null,
        is_active: isActive ? 1 : 0,
        is_1099_eligible: is1099 ? 1 : 0,
        color: color || '',
        is_pinned: isPinned ? 1 : 0,
        is_locked: accountIsLocked ? 1 : 0,
        requires_document: requiresDoc ? 1 : 0,
        custom_fields: JSON.stringify(cfObj),
        rename_log: JSON.stringify(renameLog),
        currency: currency || 'USD',
        bank_account_id: bankAccountId || '',
        subledger_type: subledgerType || 'none',
        monthly_cap: parseFloat(monthlyCap) || 0,
        compliance_tags: JSON.stringify(complianceTags),
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

  let renameHistory: any[] = [];
  try { renameHistory = account?.rename_log ? JSON.parse(account.rename_log) : []; } catch {}

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 bg-black/50">
      <div className="bg-bg-elevated border border-border-primary w-full max-w-2xl shadow-xl" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            {isEdit ? 'Edit Account' : 'New Account'}
            {isLocked && <span className="flex items-center gap-1 text-[10px] text-accent-expense bg-accent-expense/10 px-2 py-0.5" style={{ borderRadius: '6px' }}><Lock size={10} /> Locked</span>}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {errors._form && <div className="bg-accent-expense/10 border border-accent-expense/30 text-accent-expense text-xs px-3 py-2" style={{ borderRadius: '6px' }}>{errors._form}</div>}
          {isLocked && <div className="bg-accent-expense/10 border border-accent-expense/30 text-accent-expense text-xs px-3 py-2" style={{ borderRadius: '6px' }}>This account is locked. Disable the lock toggle to edit.</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Account Code *</label>
              <div className="flex gap-1">
                <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder={RANGE_HINTS[type]}
                  className={`block-input flex-1 px-3 py-2 text-sm bg-bg-primary border ${errors.code ? 'border-accent-expense' : 'border-border-primary'} text-text-primary focus:outline-none focus:border-accent-blue`}
                  style={{ borderRadius: '6px' }} disabled={isLocked} />
                <button type="button" onClick={suggestCode} title="Suggest next available code"
                  className="px-2 border border-border-primary hover:border-accent-blue" style={{ borderRadius: '6px' }} disabled={isLocked}>
                  <Sparkles size={14} className="text-accent-blue" />
                </button>
              </div>
              {errors.code && <p className="text-[10px] text-accent-expense mt-1">{errors.code}</p>}
              {codeWarning && <p className="text-[10px] text-accent-expense/70 mt-1">{codeWarning}</p>}
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Account Type *</label>
              <select value={type} onChange={(e) => setType(e.target.value as AccountType)}
                className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                style={{ borderRadius: '6px' }} disabled={isLocked}>
                <option value="asset">Asset</option>
                <option value="equity">Equity</option>
                <option value="expense">Expense</option>
                <option value="liability">Liability</option>
                <option value="revenue">Revenue</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Account Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cash in Bank"
              className={`block-input w-full px-3 py-2 text-sm bg-bg-primary border ${errors.name ? 'border-accent-expense' : 'border-border-primary'} text-text-primary focus:outline-none focus:border-accent-blue`}
              style={{ borderRadius: '6px' }} disabled={isLocked} />
            {errors.name && <p className="text-[10px] text-accent-expense mt-1">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Subtype</label>
              <select value={subtype} onChange={(e) => setSubtype(e.target.value)}
                className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                style={{ borderRadius: '6px' }} disabled={isLocked}>
                <option value="">Select subtype...</option>
                {SUBTYPES[type].map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Parent Account</label>
              <select value={parentAccountId} onChange={(e) => setParentAccountId(e.target.value)}
                className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                style={{ borderRadius: '6px' }} disabled={isLocked}>
                <option value="">None (top-level)</option>
                {parentOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.code} - {opt.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider">Description (markdown: **bold** *italic*)</label>
              <button type="button" onClick={() => setPreviewMd(!previewMd)} className="text-[10px] text-accent-blue hover:underline">
                {previewMd ? 'Edit' : 'Preview'}
              </button>
            </div>
            {previewMd ? (
              <div className="px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary min-h-[60px]"
                style={{ borderRadius: '6px' }}
                dangerouslySetInnerHTML={renderMarkdown(description)} />
            ) : (
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional description..."
                className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue resize-none"
                style={{ borderRadius: '6px' }} disabled={isLocked} />
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Color</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLOR_PRESETS.map((c, i) => (
                <button key={i} type="button" onClick={() => setColor(c)} disabled={isLocked}
                  className={`w-6 h-6 border ${color === c ? 'border-accent-blue ring-2 ring-accent-blue/30' : 'border-border-primary'}`}
                  style={{ background: c || 'transparent', borderRadius: '6px' }}
                  title={c || 'No color'} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <ToggleRow label="Active" value={isActive} onChange={setIsActive} disabled={isLocked} />
            <ToggleRow label="Pinned (favorite)" value={isPinned} onChange={setIsPinned} icon={<Pin size={11} />} disabled={isLocked} />
            <ToggleRow label="1099-eligible" value={is1099} onChange={setIs1099} disabled={isLocked} />
            <ToggleRow label="Requires document" value={requiresDoc} onChange={setRequiresDoc} icon={<FileText size={11} />} disabled={isLocked} />
            <ToggleRow label="Locked" value={accountIsLocked} onChange={setAccountIsLocked} icon={<Lock size={11} />} />
          </div>

          <div className="border-t border-border-primary pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider">Custom Fields</label>
              <button type="button" onClick={() => setCustomFields([...customFields, { key: '', value: '' }])} disabled={isLocked}
                className="text-[10px] text-accent-blue hover:underline">+ Add field</button>
            </div>
            {customFields.length === 0 && <p className="text-[10px] text-text-muted">No custom fields.</p>}
            {customFields.map((cf, i) => (
              <div key={i} className="flex gap-1 mb-1">
                <input value={cf.key} onChange={(e) => { const nf = [...customFields]; nf[i].key = e.target.value; setCustomFields(nf); }}
                  placeholder="Key" className="block-input flex-1 px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} disabled={isLocked} />
                <input value={cf.value} onChange={(e) => { const nf = [...customFields]; nf[i].value = e.target.value; setCustomFields(nf); }}
                  placeholder="Value" className="block-input flex-1 px-2 py-1 text-xs bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} disabled={isLocked} />
                <button type="button" onClick={() => setCustomFields(customFields.filter((_, j) => j !== i))} disabled={isLocked}
                  className="px-2 text-text-muted hover:text-accent-expense">x</button>
              </div>
            ))}
          </div>

          {/* Round 2: currency / bank / subledger / cap / compliance */}
          <div className="border-t border-border-primary pt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={isLocked}
                className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary" style={{ borderRadius: '6px' }}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Sub-ledger Type</label>
              <select value={subledgerType} onChange={(e) => setSubledgerType(e.target.value)} disabled={isLocked}
                className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary" style={{ borderRadius: '6px' }}>
                {SUBLEDGER_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Bank Account Linkage</label>
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} disabled={isLocked}
                className="block-select w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary" style={{ borderRadius: '6px' }}>
                <option value="">— None —</option>
                {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Monthly Cap (budget)</label>
              <input type="number" step="0.01" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} disabled={isLocked}
                className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Compliance Tags</label>
            <div className="flex gap-1 flex-wrap">
              {COMPLIANCE_OPTIONS.map(t => {
                const on = complianceTags.includes(t);
                return (
                  <button key={t} type="button" disabled={isLocked} onClick={() => {
                    setComplianceTags(on ? complianceTags.filter(x => x !== t) : [...complianceTags, t]);
                  }} className={`px-2 py-1 text-[10px] font-bold border ${on ? 'border-accent-blue text-accent-blue' : 'border-border-primary text-text-secondary'}`} style={{ borderRadius: '6px' }}>{t}</button>
                );
              })}
            </div>
          </div>

          {isEdit && account && (
            <div className="border-t border-border-primary pt-3">
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Code 39 Barcode (printable)</label>
              <Barcode39 value={account.code} />
              <p className="text-[9px] text-text-muted mt-1 font-mono">*{account.code.toUpperCase()}*</p>
            </div>
          )}

          {isEdit && account && <AccountCommentsPanel accountId={account.id} />}

          {renameHistory.length > 0 && (
            <div className="border-t border-border-primary pt-3">
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Rename History</label>
              <ul className="text-[10px] text-text-secondary space-y-0.5 max-h-24 overflow-y-auto">
                {renameHistory.map((r, i) => (
                  <li key={i} className="font-mono">
                    {new Date(r.at).toLocaleDateString()}: <s>{r.old_name}</s> &rarr; <strong>{r.new_name}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-primary">
          <button onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-text-secondary bg-bg-tertiary border border-border-primary hover:bg-bg-hover"
            style={{ borderRadius: '6px' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || isLocked}
            className="block-btn-primary flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderRadius: '6px' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ToggleRow: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode; disabled?: boolean }> = ({ label, value, onChange, icon, disabled }) => (
  <button type="button" onClick={() => !disabled && onChange(!value)} disabled={disabled}
    className="flex items-center gap-2 px-2 py-1.5 border border-border-primary hover:border-accent-blue text-xs text-text-secondary disabled:opacity-50"
    style={{ borderRadius: '6px' }}>
    {value ? <div className="w-7 h-3.5 bg-accent-blue flex items-center justify-end px-0.5" style={{ borderRadius: '6px' }}><div className="w-2.5 h-2.5 bg-white" style={{ borderRadius: '1px' }} /></div>
      : <div className="w-7 h-3.5 bg-bg-tertiary flex items-center justify-start px-0.5" style={{ borderRadius: '6px' }}><div className="w-2.5 h-2.5 bg-text-muted" style={{ borderRadius: '1px' }} /></div>}
    {icon}
    {label}
  </button>
);

export default AccountForm;
