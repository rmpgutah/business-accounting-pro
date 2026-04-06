import React, { useEffect, useState } from 'react';
import { Save, X } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import type { BankAccount } from './BankAccountList';

// ─── Types ──────────────────────────────────────────────
interface GLAccount {
  id: string;
  code: string;
  name: string;
}

interface BankAccountFormProps {
  account?: BankAccount | null;
  onSave: () => void;
  onCancel: () => void;
}

// ─── Component ──────────────────────────────────────────
const BankAccountForm: React.FC<BankAccountFormProps> = ({
  account,
  onSave,
  onCancel,
}) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const isEditing = !!account;

  const [name, setName] = useState(account?.name ?? '');
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [last4, setLast4] = useState(account?.account_number_last4 ?? '');
  const [accountId, setAccountId] = useState(account?.account_id ?? '');
  const [balance, setBalance] = useState(
    account?.current_balance?.toString() ?? '0.00'
  );
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadGL = async () => {
      if (!activeCompany) return;
      try {
        const data = await api.query('accounts', {
          company_id: activeCompany.id,
          type: 'asset',
        });
        setGlAccounts(
          (Array.isArray(data) ? data : []).filter(
            (a: any) =>
              a.subtype?.toLowerCase().includes('bank') ||
              a.subtype?.toLowerCase().includes('cash') ||
              a.subtype?.toLowerCase().includes('checking') ||
              a.subtype?.toLowerCase().includes('savings') ||
              a.name?.toLowerCase().includes('bank') ||
              a.name?.toLowerCase().includes('cash')
          )
        );
      } catch {
        // If filtered list is empty, load all asset accounts
        try {
          const data = await api.query('accounts', {
            company_id: activeCompany.id,
            type: 'asset',
          });
          setGlAccounts(Array.isArray(data) ? data : []);
        } catch {
          setGlAccounts([]);
        }
      }
    };
    loadGL();
  }, [activeCompany]);

  // If we got no bank-specific accounts, reload all assets
  useEffect(() => {
    if (glAccounts.length === 0 && activeCompany) {
      const loadAll = async () => {
        try {
          const data = await api.query('accounts', {
            company_id: activeCompany.id,
            type: 'asset',
          });
          setGlAccounts(Array.isArray(data) ? data : []);
        } catch {
          setGlAccounts([]);
        }
      };
      loadAll();
    }
  }, [glAccounts.length, activeCompany]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;

    if (!name.trim()) {
      setError('Account name is required.');
      return;
    }

    const parsedBalance = parseFloat(balance);
    if (balance.trim() !== '' && isNaN(parsedBalance)) {
      setError('Opening balance must be a valid number.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        name: name.trim(),
        institution: institution.trim(),
        account_number_last4: last4.trim(),
        account_id: accountId || null,
        current_balance: isNaN(parsedBalance) ? 0 : parsedBalance,
        company_id: activeCompany.id,
      };

      if (isEditing && account) {
        await api.update('bank_accounts', account.id, payload);
      } else {
        await api.create('bank_accounts', payload);
      }

      onSave();
    } catch (err: any) {
      setError(err?.message || 'Failed to save bank account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div
          className="block-card p-5 space-y-4"
          style={{ borderRadius: '6px' }}
        >
          <h3 className="text-sm font-bold text-text-primary">
            {isEditing ? 'Edit Bank Account' : 'Add Bank Account'}
          </h3>

          {error && (
            <div
              className="px-3 py-2 text-xs text-accent-expense bg-accent-expense/10 border border-accent-expense/20"
              style={{ borderRadius: '6px' }}
            >
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
              Account Name *
            </label>
            <input
              type="text"
              className="block-input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Business Checking"
            />
          </div>

          {/* Institution */}
          <div>
            <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
              Institution
            </label>
            <input
              type="text"
              className="block-input w-full"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="e.g. Chase, Bank of America"
            />
          </div>

          {/* Last 4 */}
          <div>
            <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
              Account Number (Last 4)
            </label>
            <input
              type="text"
              className="block-input w-full"
              value={last4}
              onChange={(e) =>
                setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))
              }
              placeholder="1234"
              maxLength={4}
            />
          </div>

          {/* GL Account */}
          <div>
            <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
              Linked GL Account
            </label>
            <select
              className="block-select w-full"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">-- Select GL Account --</option>
              {glAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Balance */}
          <div>
            <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
              Current Balance
            </label>
            <input
              type="number"
              step="0.01"
              className="block-input w-full"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="block-btn-primary flex items-center gap-1.5 px-4 py-2 text-xs font-semibold"
            style={{ borderRadius: '6px' }}
          >
            <Save size={14} />
            {saving ? 'Saving...' : isEditing ? 'Update Account' : 'Add Account'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-text-muted hover:text-text-primary bg-bg-tertiary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
          >
            <X size={14} />
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default BankAccountForm;
