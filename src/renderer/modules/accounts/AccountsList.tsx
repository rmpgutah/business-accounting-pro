import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  ToggleLeft,
  ToggleRight,
  BookOpen,
  RefreshCw,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { ImportWizard } from '../../components/ImportWizard';
import ErrorBanner from '../../components/ErrorBanner';
import EntityChip from '../../components/EntityChip';

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
  const [cashBasis, setCashBasis] = useState<{ cash_revenue: number; cash_expenses: number } | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState('');

  // Fetch accounts WITH computed balances from journal entries
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        // Get accounts with computed balances from GL
        const data = await api.rawQuery(
          `SELECT a.*,
            COALESCE((
              SELECT SUM(jel.debit - jel.credit)
              FROM journal_entry_lines jel
              JOIN journal_entries je ON jel.journal_entry_id = je.id
              WHERE jel.account_id = a.id AND je.company_id = ?
            ), 0) as gl_balance,
            COALESCE((
              SELECT SUM(jel.debit) FROM journal_entry_lines jel
              JOIN journal_entries je ON jel.journal_entry_id = je.id
              WHERE jel.account_id = a.id AND je.company_id = ?
            ), 0) as total_debits,
            COALESCE((
              SELECT SUM(jel.credit) FROM journal_entry_lines jel
              JOIN journal_entries je ON jel.journal_entry_id = je.id
              WHERE jel.account_id = a.id AND je.company_id = ?
            ), 0) as total_credits
          FROM accounts a
          WHERE a.company_id = ?
          ORDER BY a.code`,
          [activeCompany.id, activeCompany.id, activeCompany.id, activeCompany.id]
        );
        if (!cancelled && Array.isArray(data)) {
          // Compute effective balance: for asset/expense accounts, debit-credit is positive
          // For liability/equity/revenue, credit-debit is positive
          const enriched = data.map((a: any) => ({
            ...a,
            balance: ['asset', 'expense'].includes(a.type)
              ? (a.total_debits || 0) - (a.total_credits || 0)
              : (a.total_credits || 0) - (a.total_debits || 0),
          }));
          setAccounts(enriched);
        }

        // Also load cash-basis totals from invoices + expenses for summary
        api.rawQuery(
          `SELECT
            COALESCE((SELECT SUM(amount_paid) FROM invoices WHERE company_id = ? AND status IN ('paid','partial')), 0) as cash_revenue,
            COALESCE((SELECT SUM(amount) FROM expenses WHERE company_id = ? AND status IN ('approved','paid')), 0) as cash_expenses
          `,
          [activeCompany.id, activeCompany.id]
        ).then(r => {
          if (!cancelled && Array.isArray(r) && r[0]) {
            setCashBasis(r[0]);
          }
        }).catch(() => {});
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
    const data = await api.rawQuery(
      `SELECT a.*,
        COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel JOIN journal_entries je ON jel.journal_entry_id = je.id WHERE jel.account_id = a.id AND je.company_id = ?), 0) as gl_balance
      FROM accounts a WHERE a.company_id = ? ORDER BY a.code`,
      [activeCompany.id, activeCompany.id]
    );
    if (Array.isArray(data)) {
      const enriched = data.map((a: any) => ({
        ...a,
        balance: ['asset', 'expense'].includes(a.type)
          ? (a.gl_balance || 0)
          : -(a.gl_balance || 0),
      }));
      setAccounts(enriched);
    }
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
      {rebuildMessage && (
        <div
          className="flex items-center justify-between px-4 py-2.5 text-xs text-accent-income bg-accent-income/10 border border-accent-income/20"
          style={{ borderRadius: '6px' }}
        >
          <span>{rebuildMessage}</span>
          <button onClick={() => setRebuildMessage('')} className="text-accent-income/60 hover:text-accent-income text-xs font-bold">Dismiss</button>
        </div>
      )}
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
          <button
            onClick={async () => {
              setRebuilding(true);
              setRebuildMessage('');
              setError('');
              try {
                const result = await api.rebuildGL();
                if (result?.error) {
                  setError(result.error);
                } else {
                  setRebuildMessage(result?.message || `Posted ${result?.posted || 0} journal entries.`);
                  // Reload accounts to reflect new balances
                  reload();
                }
              } catch (err: any) {
                setError(err?.message || 'Failed to rebuild GL');
              } finally {
                setRebuilding(false);
              }
            }}
            disabled={rebuilding}
            className="flex items-center gap-1.5 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue transition-colors"
            title="Post missing journal entries for all invoices, expenses, and payments"
            style={{ opacity: rebuilding ? 0.6 : 1 }}
          >
            <RefreshCw size={12} className={rebuilding ? 'animate-spin' : ''} />
            {rebuilding ? 'Rebuilding...' : 'Rebuild GL'}
          </button>
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
      {/* Cash-Basis Activity Summary */}
      {cashBasis && (cashBasis.cash_revenue > 0 || cashBasis.cash_expenses > 0) && (
        <div className="grid grid-cols-3 gap-4 mb-2">
          <div className="block-card p-4 border-l-4 border-l-accent-income" style={{ borderRadius: '6px' }}>
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-1">Revenue (Cash Basis)</p>
            <p className="text-xl font-bold font-mono text-accent-income">{formatCurrency(cashBasis.cash_revenue)}</p>
            <p className="text-[10px] text-text-muted mt-0.5">From paid/partial invoices</p>
          </div>
          <div className="block-card p-4 border-l-4 border-l-accent-expense" style={{ borderRadius: '6px' }}>
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-1">Expenses (Cash Basis)</p>
            <p className="text-xl font-bold font-mono text-accent-expense">{formatCurrency(cashBasis.cash_expenses)}</p>
            <p className="text-[10px] text-text-muted mt-0.5">Approved + paid expenses</p>
          </div>
          <div className="block-card p-4 border-l-4 border-l-accent-blue" style={{ borderRadius: '6px' }}>
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-1">Net Income (Cash Basis)</p>
            <p className={`text-xl font-bold font-mono ${cashBasis.cash_revenue - cashBasis.cash_expenses >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
              {formatCurrency(cashBasis.cash_revenue - cashBasis.cash_expenses)}
            </p>
            <p className="text-[10px] text-text-muted mt-0.5">Revenue minus expenses</p>
          </div>
        </div>
      )}

      {/* GL Account Balances Note */}
      {accounts.every(a => (a.balance ?? 0) === 0) && (cashBasis?.cash_revenue ?? 0) > 0 && (
        <div className="text-xs text-text-muted bg-bg-tertiary border border-border-primary px-4 py-2 mb-2" style={{ borderRadius: '6px' }}>
          GL account balances are zero because journal entries haven't been posted yet. The cash-basis summary above shows activity from invoices and expenses. Post journal entries to populate account balances.
        </div>
      )}

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
                      {formatCurrency(total)}
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
                        <td className="px-4 py-2 font-mono text-xs text-text-secondary" onClick={(e) => e.stopPropagation()}>
                          <EntityChip type="account" id={account.id} label={account.code} variant="mono" />
                        </td>
                        <td className="px-4 py-2 text-xs text-text-primary font-medium truncate max-w-[200px]">
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
                          {formatCurrency(account.balance ?? 0)}
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
