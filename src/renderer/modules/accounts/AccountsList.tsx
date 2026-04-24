import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  ToggleLeft,
  ToggleRight,
  BookOpen,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { ImportWizard } from '../../components/ImportWizard';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
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
}

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface AccountsListProps {
  onNewAccount: () => void;
  onEditAccount: (account: Account) => void;
}

// ─── Constants ──────────────────────────────────────────
const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
];

const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
};

const TYPE_ACCENT: Record<AccountType, string> = {
  asset: 'text-accent-blue',
  liability: 'text-accent-expense',
  equity: 'text-text-primary',
  revenue: 'text-accent-income',
  expense: 'text-accent-expense',
};

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Component ──────────────────────────────────────────
const AccountsList: React.FC<AccountsListProps> = ({
  onNewAccount,
  onEditAccount,
}) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showInactive, setShowInactive] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');

  // Fetch accounts
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        const data = await api.query('accounts', {
          company_id: activeCompany.id,
        });
        if (!cancelled && Array.isArray(data)) {
          setAccounts(data);
        }
      } catch (err: any) {
        console.error('Failed to load accounts:', err);
        if (!cancelled) setError(err?.message || 'Failed to load accounts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany]);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const data = await api.query('accounts', { company_id: activeCompany.id });
    setAccounts(Array.isArray(data) ? data : []);
  }, [activeCompany]);

  // Group accounts by type
  const grouped = useMemo(() => {
    const filtered = showInactive
      ? accounts
      : accounts.filter((a) => a.is_active);

    const groups: Record<AccountType, Account[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };

    for (const acct of filtered) {
      const type = acct.type as AccountType;
      if (groups[type]) {
        groups[type].push(acct);
      }
    }

    // Sort each group by code
    for (const type of ACCOUNT_TYPE_ORDER) {
      groups[type].sort((a, b) => a.code.localeCompare(b.code));
    }

    return groups;
  }, [accounts, showInactive]);

  // Group totals
  const groupTotal = (type: AccountType) =>
    grouped[type].reduce((sum, a) => sum + (a.balance ?? 0), 0);

  const toggleCollapse = (type: string) => {
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm font-mono">
          Loading accounts...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load accounts" onDismiss={() => setError('')} />}
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            {showInactive ? (
              <ToggleRight size={18} className="text-accent-blue" />
            ) : (
              <ToggleLeft size={18} />
            )}
            Show inactive
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            Import CSV
          </button>
          <button
            onClick={onNewAccount}
            className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            style={{ borderRadius: '6px' }}
          >
            <Plus size={14} />
            New Account
          </button>
        </div>
      </div>

      {/* Table */}
      <div
        className="block-table bg-bg-secondary border border-border-primary overflow-hidden"
        style={{ borderRadius: '6px' }}
      >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-tertiary border-b border-border-primary">
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-8" />
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Code
              </th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Name
              </th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Type
              </th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Subtype
              </th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {ACCOUNT_TYPE_ORDER.map((type) => {
              const items = grouped[type];
              const isCollapsed = collapsed[type] ?? false;
              const total = groupTotal(type);

              return (
                <React.Fragment key={type}>
                  {/* Group header */}
                  <tr
                    className="bg-bg-tertiary/50 border-b border-border-primary cursor-pointer hover:bg-bg-hover transition-colors"
                    onClick={() => toggleCollapse(type)}
                  >
                    <td className="px-4 py-2">
                      {isCollapsed ? (
                        <ChevronRight size={14} className="text-text-muted" />
                      ) : (
                        <ChevronDown size={14} className="text-text-muted" />
                      )}
                    </td>
                    <td
                      colSpan={4}
                      className="px-4 py-2 text-xs font-bold text-text-primary uppercase tracking-wider"
                    >
                      {TYPE_LABELS[type]}{' '}
                      <span className="text-text-muted font-normal ml-1">
                        ({items.length})
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono text-xs font-semibold ${TYPE_ACCENT[type]}`}
                    >
                      {fmt.format(total)}
                    </td>
                  </tr>

                  {/* Account rows */}
                  {!isCollapsed &&
                    items.map((account) => (
                      <tr
                        key={account.id}
                        className={`border-b border-border-primary hover:bg-bg-hover transition-colors cursor-pointer ${
                          !account.is_active ? 'opacity-50' : ''
                        }`}
                        onClick={() => onEditAccount(account)}
                      >
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 font-mono text-xs text-text-secondary">
                          {account.code}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-primary font-medium">
                          {account.name}
                          {!account.is_active && (
                            <span className="ml-2 text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5" style={{ borderRadius: '6px' }}>
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-secondary capitalize">
                          {account.type}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-muted">
                          {account.subtype || '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-text-primary">
                          {fmt.format(account.balance ?? 0)}
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}

            {accounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8">
                  <EmptyState icon={BookOpen} message="No accounts found" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      {showImport && (
        <ImportWizard
          table="accounts"
          requiredFields={['code', 'name', 'type']}
          extraData={{ company_id: activeCompany?.id }}
          onDone={() => { setShowImport(false); reload(); }}
          onCancel={() => setShowImport(false)}
        />
      )}
    </div>
  );
};

export default AccountsList;
