import React, { useEffect, useState } from 'react';
import { Landmark, Plus, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
export interface BankAccount {
  id: string;
  name: string;
  institution: string;
  account_number_last4: string;
  account_id: string;
  account_name?: string;
  current_balance: number;
  last_reconciled?: string;
  created_at?: string;
}

interface BankAccountListProps {
  onAdd: () => void;
  onEdit: (account: BankAccount) => void;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Component ──────────────────────────────────────────
const BankAccountList: React.FC<BankAccountListProps> = ({ onAdd, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const rows: any[] = await api.rawQuery(
        `SELECT
           ba.*,
           a.name AS account_name
         FROM bank_accounts ba
         LEFT JOIN accounts a ON a.id = ba.account_id
         WHERE ba.company_id = ?
         ORDER BY ba.name`,
        [activeCompany.id]
      );
      setAccounts(rows ?? []);
    } catch (err) {
      console.error('Failed to load bank accounts:', err);
      // Fallback: try basic query
      try {
        const data = await api.query('bank_accounts', {
          company_id: activeCompany.id,
        });
        setAccounts(Array.isArray(data) ? data : []);
      } catch {
        setAccounts([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [activeCompany]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading bank accounts...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          {accounts.length} bank account{accounts.length !== 1 ? 's' : ''} linked
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onAdd}
            className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            style={{ borderRadius: '2px' }}
          >
            <Plus size={14} />
            Add Account
          </button>
        </div>
      </div>

      {/* Table */}
      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div
            className="w-12 h-12 flex items-center justify-center bg-bg-tertiary border border-border-primary mb-3"
            style={{ borderRadius: '2px' }}
          >
            <Landmark size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">
            No bank accounts linked
          </p>
          <p className="text-xs text-text-muted mt-1">
            Add a bank account to begin reconciliation.
          </p>
        </div>
      ) : (
        <div
          className="block-card p-0 overflow-hidden"
          style={{ borderRadius: '2px' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary border-b border-border-primary">
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Name
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Institution
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Last 4
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  GL Account
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Balance
                </th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Last Reconciled
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acct) => (
                <tr
                  key={acct.id}
                  className="border-b border-border-primary hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => onEdit(acct)}
                >
                  <td className="px-4 py-2.5 text-xs text-text-primary font-medium">
                    {acct.name}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary">
                    {acct.institution || '--'}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-text-muted">
                    {acct.account_number_last4
                      ? `****${acct.account_number_last4}`
                      : '--'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary">
                    {acct.account_name || '--'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-text-primary">
                    {fmt.format(acct.current_balance ?? 0)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">
                    {acct.last_reconciled || 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default BankAccountList;
