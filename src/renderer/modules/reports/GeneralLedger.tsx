import React, { useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Printer, Download, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { downloadCSVBlob } from '../../lib/csv-export';
import { formatCurrency, formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';


// ─── Types ──────────────────────────────────────────────
interface GLTransaction {
  line_id: string;
  entry_id: string;
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  type: 'debit' | 'credit';
  amount: number;
  running_balance?: number;
}

interface GLAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  transactions: GLTransaction[];
  opening_balance: number;
  closing_balance: number;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

const NORMAL_SIDE: Record<string, 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
  income: 'credit',
};

// ─── Component ──────────────────────────────────────────
const GeneralLedger: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  // Date range defaults to current year
  const today = new Date();
  const [startDate, setStartDate] = useState(`${today.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'));

  // Load account options for the filter dropdown
  useEffect(() => {
    if (!activeCompany) return;
    api.query('accounts', { company_id: activeCompany.id }).then((rows: any[]) => {
      if (Array.isArray(rows)) {
        setAccountOptions(
          rows.map((r) => ({ id: r.id, code: r.code || '', name: r.name }))
            .sort((a, b) => a.code.localeCompare(b.code))
        );
      }
    });
  }, [activeCompany]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');

      try {
        // Fetch all posted journal entry lines for this company in the date range
        // optionally filtered to a single account
        const accountFilter = selectedAccountId ? 'AND a.id = ?' : '';
        const params: any[] = [activeCompany.id, startDate, endDate];
        if (selectedAccountId) params.push(selectedAccountId);

        const rows: any[] = await api.rawQuery(
          `SELECT
             a.id AS account_id,
             a.code AS account_code,
             a.name AS account_name,
             LOWER(a.type) AS account_type,
             jel.id AS line_id,
             je.id AS entry_id,
             je.entry_number,
             je.date,
             je.description,
             je.reference,
             jel.debit,
             jel.credit
           FROM accounts a
           JOIN journal_entry_lines jel ON jel.account_id = a.id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
             AND je.is_posted = 1
             AND je.date >= ?
             AND je.date <= ?
             AND je.company_id = ?
           WHERE a.company_id = ?
           ${accountFilter}
           ORDER BY a.code ASC, je.date ASC, je.entry_number ASC`,
          [startDate, endDate, activeCompany.id, activeCompany.id, ...(selectedAccountId ? [selectedAccountId] : [])]
        );

        if (cancelled) return;

        // Group by account
        const accountMap = new Map<string, GLAccount>();
        for (const row of (rows ?? [])) {
          if (!accountMap.has(row.account_id)) {
            accountMap.set(row.account_id, {
              account_id: row.account_id,
              account_code: row.account_code || '',
              account_name: row.account_name || 'Unnamed',
              account_type: row.account_type || 'asset',
              transactions: [],
              opening_balance: 0,
              closing_balance: 0,
            });
          }
          // Derive type from whichever column is nonzero (schema uses debit/credit columns, not a type enum)
          const debit = Number(row.debit) || 0;
          const credit = Number(row.credit) || 0;
          accountMap.get(row.account_id)!.transactions.push({
            line_id: row.line_id,
            entry_id: row.entry_id,
            entry_number: row.entry_number || '',
            date: row.date || '',
            description: row.description || '',
            reference: row.reference || '',
            type: debit > 0 ? 'debit' : 'credit',
            amount: debit > 0 ? debit : credit,
          });
        }

        // Compute running balances per account
        const glAccounts: GLAccount[] = [];
        for (const acct of accountMap.values()) {
          const normalSide = NORMAL_SIDE[acct.account_type] ?? 'debit';
          let runningBal = 0;
          for (const txn of acct.transactions) {
            if (normalSide === 'debit') {
              runningBal += txn.type === 'debit' ? txn.amount : -txn.amount;
            } else {
              runningBal += txn.type === 'credit' ? txn.amount : -txn.amount;
            }
            txn.running_balance = runningBal;
          }
          acct.closing_balance = runningBal;
          glAccounts.push(acct);
        }

        setAccounts(glAccounts);

        // Auto-expand if only one account or filter applied
        if (glAccounts.length <= 3 || selectedAccountId) {
          setExpandedAccounts(new Set(glAccounts.map((a) => a.account_id)));
        } else {
          setExpandedAccounts(new Set());
        }
      } catch (err: any) {
        console.error('Failed to load General Ledger:', err);
        if (!cancelled) setError(err?.message || 'Failed to load General Ledger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate, selectedAccountId]);

  const toggleAccount = (id: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedAccounts(new Set(accounts.map((a) => a.account_id)));
  const collapseAll = () => setExpandedAccounts(new Set());

  const totalTransactions = useMemo(() =>
    accounts.reduce((s, a) => s + a.transactions.length, 0), [accounts]
  );

  const handleExport = () => {
    const rows: any[] = [];
    for (const acct of accounts) {
      for (const txn of acct.transactions) {
        rows.push({
          account_code: acct.account_code,
          account_name: acct.account_name,
          date: txn.date,
          entry_number: txn.entry_number,
          description: txn.description,
          reference: txn.reference,
          debit: txn.type === 'debit' ? txn.amount.toFixed(2) : '',
          credit: txn.type === 'credit' ? txn.amount.toFixed(2) : '',
          running_balance: (txn.running_balance ?? 0).toFixed(2),
        });
      }
    }
    downloadCSVBlob(rows, `general-ledger-${startDate}-${endDate}.csv`);
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load General Ledger" onDismiss={() => setError('')} />}
      {/* Controls */}
      <div className="block-card p-4 flex flex-wrap items-center gap-3 justify-between" style={{ borderRadius: '6px' }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">From</label>
            <input
              type="date"
              className="block-input text-xs"
              style={{ width: '140px' }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">To</label>
            <input
              type="date"
              className="block-input text-xs"
              style={{ width: '140px' }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Account</label>
            <select
              className="block-select text-xs"
              style={{ width: '200px' }}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              <option value="">All Accounts</option>
              {accountOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.code} — {opt.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-text-muted hover:text-text-primary px-2 py-1 transition-colors"
            style={{ borderRadius: '6px' }}
            onClick={expandAll}
          >
            Expand All
          </button>
          <button
            className="text-xs text-text-muted hover:text-text-primary px-2 py-1 transition-colors"
            style={{ borderRadius: '6px' }}
            onClick={collapseAll}
          >
            Collapse All
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Export CSV"
            onClick={handleExport}
          >
            <Download size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print"
            onClick={() => window.print()}
          >
            <Printer size={15} />
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {!loading && (
        <div className="flex items-center gap-4 px-1">
          <span className="text-xs text-text-muted">
            <span className="font-semibold text-text-secondary">{accounts.length}</span> accounts,{' '}
            <span className="font-semibold text-text-secondary">{totalTransactions}</span> transactions
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Generating report...
        </div>
      ) : accounts.length === 0 ? (
        <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-sm text-text-secondary font-medium">No posted transactions found</p>
          <p className="text-xs text-text-muted mt-1">Adjust the date range or post journal entries to see the ledger.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acct) => {
            const isExpanded = expandedAccounts.has(acct.account_id);
            const normalSide = NORMAL_SIDE[acct.account_type] ?? 'debit';

            return (
              <div
                key={acct.account_id}
                className="block-card p-0 overflow-hidden"
                style={{ borderRadius: '6px' }}
              >
                {/* Account header row */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left"
                  onClick={() => toggleAccount(acct.account_id)}
                >
                  <span className="text-text-muted">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <span className="font-mono text-xs text-text-muted w-16 shrink-0">{acct.account_code}</span>
                  <span className="font-semibold text-text-primary flex-1">{acct.account_name}</span>
                  <span className="text-[10px] text-text-muted uppercase tracking-wider w-20 text-center">
                    {acct.account_type}
                  </span>
                  <span className="text-xs text-text-muted mr-4">
                    {acct.transactions.length} txn{acct.transactions.length !== 1 ? 's' : ''}
                  </span>
                  <div className="text-right min-w-[120px]">
                    <span className="text-[10px] text-text-muted block">Closing Balance</span>
                    <span className={`font-mono font-bold text-sm ${acct.closing_balance < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                      {formatCurrency(Math.abs(acct.closing_balance))}
                      <span className="text-[10px] text-text-muted ml-1">
                        {normalSide === 'debit' ? (acct.closing_balance >= 0 ? 'Dr' : 'Cr') : (acct.closing_balance >= 0 ? 'Cr' : 'Dr')}
                      </span>
                    </span>
                  </div>
                </button>

                {/* Transaction detail */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <table className="block-table">
                      <thead>
                        <tr>
                          <th style={{ width: '100px' }}>Date</th>
                          <th style={{ width: '120px' }}>Entry #</th>
                          <th>Description</th>
                          <th style={{ width: '100px' }}>Reference</th>
                          <th className="text-right" style={{ width: '120px' }}>Debit</th>
                          <th className="text-right" style={{ width: '120px' }}>Credit</th>
                          <th className="text-right" style={{ width: '140px' }}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acct.transactions.map((txn) => (
                          <tr key={txn.line_id}>
                            <td className="font-mono text-text-secondary text-xs">{formatDate(txn.date)}</td>
                            <td className="font-mono text-accent-blue text-xs">{txn.entry_number}</td>
                            <td className="text-text-secondary text-xs">{txn.description || '—'}</td>
                            <td className="text-text-muted text-xs">{txn.reference || '—'}</td>
                            <td className="text-right font-mono text-xs">
                              {txn.type === 'debit'
                                ? <span className="text-text-primary">{formatCurrency(txn.amount)}</span>
                                : <span className="text-text-muted">—</span>}
                            </td>
                            <td className="text-right font-mono text-xs">
                              {txn.type === 'credit'
                                ? <span className="text-text-primary">{formatCurrency(txn.amount)}</span>
                                : <span className="text-text-muted">—</span>}
                            </td>
                            <td className={`text-right font-mono font-semibold text-xs ${(txn.running_balance ?? 0) < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                              {formatCurrency(Math.abs(txn.running_balance ?? 0))}
                              <span className="text-[10px] text-text-muted ml-1">
                                {normalSide === 'debit'
                                  ? ((txn.running_balance ?? 0) >= 0 ? 'Dr' : 'Cr')
                                  : ((txn.running_balance ?? 0) >= 0 ? 'Cr' : 'Dr')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)' }}>
                          <td colSpan={4} className="py-2 text-right text-xs font-bold text-text-muted uppercase tracking-wider">
                            Period Total
                          </td>
                          <td className="text-right font-mono font-bold text-xs text-text-primary">
                            {formatCurrency(acct.transactions.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0))}
                          </td>
                          <td className="text-right font-mono font-bold text-xs text-text-primary">
                            {formatCurrency(acct.transactions.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0))}
                          </td>
                          <td className={`text-right font-mono font-bold text-xs ${acct.closing_balance < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                            {formatCurrency(Math.abs(acct.closing_balance))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GeneralLedger;
