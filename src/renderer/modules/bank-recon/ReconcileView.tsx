import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Zap,
  Check,
  X,
  Save,
  Link2,
  Unlink,
  RefreshCw,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface BankAccount {
  id: string;
  name: string;
}

interface BankTransaction {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
  status: string;
}

interface BookEntry {
  id: string;
  entry_date: string;
  memo: string;
  amount: number;
  journal_entry_id: string;
}

interface MatchedPair {
  bank: BankTransaction;
  book: BookEntry;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Component ──────────────────────────────────────────
const ReconcileView: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [bankTxns, setBankTxns] = useState<BankTransaction[]>([]);
  const [bookEntries, setBookEntries] = useState<BookEntry[]>([]);
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [matchedPairs, setMatchedPairs] = useState<MatchedPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  // Load bank accounts
  useEffect(() => {
    if (!activeCompany) return;
    const load = async () => {
      try {
        const data = await api.query('bank_accounts', {
          company_id: activeCompany.id,
        });
        setBankAccounts(Array.isArray(data) ? data : []);
      } catch {
        setBankAccounts([]);
      }
    };
    load();
  }, [activeCompany]);

  // Load transactions when bank selected
  const loadTransactions = useCallback(async () => {
    if (!selectedBankId || !activeCompany) return;
    setLoading(true);
    setMatchedPairs([]);
    setSelectedBank(null);
    setSelectedBook(null);
    setSaveResult(null);

    try {
      // Load unmatched bank transactions
      const bankData = await api.query('bank_transactions', {
        bank_account_id: selectedBankId,
        status: 'pending',
      });
      setBankTxns(Array.isArray(bankData) ? bankData : []);

      // Load unmatched book entries (journal entry lines for the linked GL account)
      const bankAcct: any = await api.get('bank_accounts', selectedBankId);
      const accountId = bankAcct?.account_id;

      if (accountId) {
        const bookData: any[] = await api.rawQuery(
          `SELECT
             jel.id,
             je.date AS entry_date,
             je.description AS memo,
             (jel.debit - jel.credit) AS amount,
             jel.journal_entry_id
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE jel.account_id = ?
             AND je.company_id = ?
             AND jel.id NOT IN (
               SELECT journal_entry_line_id FROM bank_reconciliation_matches
               WHERE journal_entry_line_id IS NOT NULL
             )
           ORDER BY je.date DESC`,
          [accountId, activeCompany.id]
        );
        setBookEntries(bookData ?? []);
      } else {
        setBookEntries([]);
      }
    } catch (err) {
      console.error('Failed to load reconciliation data:', err);
      setBankTxns([]);
      setBookEntries([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBankId, activeCompany]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // ─── Unmatched lists (exclude already matched) ────────
  const matchedBankIds = useMemo(
    () => new Set(matchedPairs.map((m) => m.bank.id)),
    [matchedPairs]
  );
  const matchedBookIds = useMemo(
    () => new Set(matchedPairs.map((m) => m.book.id)),
    [matchedPairs]
  );

  const unmatchedBank = useMemo(
    () => bankTxns.filter((t) => !matchedBankIds.has(t.id)),
    [bankTxns, matchedBankIds]
  );
  const unmatchedBook = useMemo(
    () => bookEntries.filter((e) => !matchedBookIds.has(e.id)),
    [bookEntries, matchedBookIds]
  );

  // ─── Manual match ─────────────────────────────────────
  useEffect(() => {
    if (selectedBank && selectedBook) {
      const bank = bankTxns.find((t) => t.id === selectedBank);
      const book = bookEntries.find((e) => e.id === selectedBook);
      if (bank && book) {
        setMatchedPairs((prev) => [...prev, { bank, book }]);
      }
      setSelectedBank(null);
      setSelectedBook(null);
    }
  }, [selectedBank, selectedBook, bankTxns, bookEntries]);

  // ─── Auto-match by amount ─────────────────────────────
  const autoMatch = () => {
    const newMatches: MatchedPair[] = [...matchedPairs];
    const usedBank = new Set(newMatches.map((m) => m.bank.id));
    const usedBook = new Set(newMatches.map((m) => m.book.id));

    const availBank = bankTxns.filter((t) => !usedBank.has(t.id));
    const availBook = bookEntries.filter((e) => !usedBook.has(e.id));

    for (const bt of availBank) {
      const match = availBook.find(
        (be) =>
          !usedBook.has(be.id) &&
          Math.abs(Math.abs(bt.amount) - Math.abs(be.amount)) < 0.01
      );
      if (match) {
        newMatches.push({ bank: bt, book: match });
        usedBank.add(bt.id);
        usedBook.add(match.id);
      }
    }

    setMatchedPairs(newMatches);
  };

  // ─── Remove match ─────────────────────────────────────
  const removeMatch = (idx: number) => {
    setMatchedPairs((prev) => prev.filter((_, i) => i !== idx));
  };

  // ─── Save reconciliation ──────────────────────────────
  const handleSave = async () => {
    if (matchedPairs.length === 0) return;
    setSaving(true);
    setSaveResult(null);

    try {
      for (const pair of matchedPairs) {
        // Create reconciliation match record
        await api.create('bank_reconciliation_matches', {
          bank_transaction_id: pair.bank.id,
          journal_entry_line_id: pair.book.id,
          match_type: 'manual',
        });

        // Bug fix #9a: also mark the bank transaction as matched so it
        // doesn't reappear in the unmatched list after reconciliation.
        await api.update('bank_transactions', pair.bank.id, {
          status: 'matched',
          is_matched: 1,
        });
      }

      // Bug fix #9b: schema column is last_reconciled_date, not last_reconciled.
      await api.update('bank_accounts', selectedBankId, {
        last_reconciled_date: new Date().toISOString().split('T')[0],
      });

      setSaveResult(
        `Successfully reconciled ${matchedPairs.length} transaction${matchedPairs.length !== 1 ? 's' : ''}.`
      );
      setMatchedPairs([]);
      loadTransactions();
    } catch (err: any) {
      setSaveResult(`Error: ${err?.message || 'Save failed.'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Bank selector */}
      <div
        className="block-card p-4 flex items-center gap-4"
        style={{ borderRadius: '2px' }}
      >
        <div className="flex-1">
          <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
            Bank Account
          </label>
          <select
            className="block-select w-full"
            value={selectedBankId}
            onChange={(e) => setSelectedBankId(e.target.value)}
          >
            <option value="">-- Select bank account --</option>
            {bankAccounts.map((ba) => (
              <option key={ba.id} value={ba.id}>
                {ba.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <button
            onClick={autoMatch}
            disabled={!selectedBankId || loading}
            className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ borderRadius: '2px' }}
          >
            <Zap size={14} />
            Auto-Match
          </button>
          <button
            onClick={loadTransactions}
            disabled={!selectedBankId}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40"
            style={{ borderRadius: '2px' }}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Save result */}
      {saveResult && (
        <div
          className={`px-4 py-2 text-xs border ${
            saveResult.startsWith('Error')
              ? 'text-accent-expense bg-accent-expense/10 border-accent-expense/20'
              : 'text-accent-income bg-accent-income/10 border-accent-income/20'
          }`}
          style={{ borderRadius: '2px' }}
        >
          {saveResult}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-text-muted text-sm font-mono">
          Loading transactions...
        </div>
      ) : !selectedBankId ? (
        <div className="flex items-center justify-center h-48 text-text-muted text-sm">
          Select a bank account to begin reconciliation.
        </div>
      ) : (
        <>
          {/* Side-by-side panels */}
          <div className="grid grid-cols-2 gap-4">
            {/* LEFT: Bank Transactions */}
            <div
              className="block-card p-0 overflow-hidden"
              style={{ borderRadius: '2px' }}
            >
              <div className="px-4 py-2 bg-bg-tertiary border-b border-border-primary flex items-center justify-between">
                <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Bank Transactions ({unmatchedBank.length})
                </span>
                {selectedBank && (
                  <span className="text-[10px] text-accent-blue font-mono">
                    1 selected
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {unmatchedBank.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-text-muted">
                    No unmatched bank transactions.
                  </div>
                ) : (
                  unmatchedBank.map((txn) => (
                    <div
                      key={txn.id}
                      onClick={() =>
                        setSelectedBank(
                          selectedBank === txn.id ? null : txn.id
                        )
                      }
                      className={`px-4 py-2 border-b border-border-primary/50 cursor-pointer transition-colors ${
                        selectedBank === txn.id
                          ? 'bg-accent-blue/10 border-l-2 border-l-accent-blue'
                          : 'hover:bg-bg-hover border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-primary font-medium truncate max-w-[60%]">
                          {txn.description}
                        </span>
                        <span
                          className={`text-xs font-mono ${
                            txn.amount >= 0
                              ? 'text-accent-income'
                              : 'text-accent-expense'
                          }`}
                        >
                          {fmt.format(txn.amount)}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-muted font-mono">
                        {txn.transaction_date}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* RIGHT: Book Entries */}
            <div
              className="block-card p-0 overflow-hidden"
              style={{ borderRadius: '2px' }}
            >
              <div className="px-4 py-2 bg-bg-tertiary border-b border-border-primary flex items-center justify-between">
                <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Book Entries ({unmatchedBook.length})
                </span>
                {selectedBook && (
                  <span className="text-[10px] text-accent-blue font-mono">
                    1 selected
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {unmatchedBook.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-text-muted">
                    No unmatched book entries.
                  </div>
                ) : (
                  unmatchedBook.map((entry) => (
                    <div
                      key={entry.id}
                      onClick={() =>
                        setSelectedBook(
                          selectedBook === entry.id ? null : entry.id
                        )
                      }
                      className={`px-4 py-2 border-b border-border-primary/50 cursor-pointer transition-colors ${
                        selectedBook === entry.id
                          ? 'bg-accent-blue/10 border-l-2 border-l-accent-blue'
                          : 'hover:bg-bg-hover border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-primary font-medium truncate max-w-[60%]">
                          {entry.memo || '(no memo)'}
                        </span>
                        <span
                          className={`text-xs font-mono ${
                            entry.amount >= 0
                              ? 'text-accent-income'
                              : 'text-accent-expense'
                          }`}
                        >
                          {fmt.format(entry.amount)}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-muted font-mono">
                        {entry.entry_date}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Match hint */}
          {(selectedBank || selectedBook) && (
            <div
              className="text-center py-2 text-xs text-accent-blue bg-accent-blue/5 border border-accent-blue/20"
              style={{ borderRadius: '2px' }}
            >
              <Link2 size={12} className="inline mr-1 -mt-0.5" />
              {selectedBank && !selectedBook
                ? 'Now click a book entry on the right to match.'
                : !selectedBank && selectedBook
                  ? 'Now click a bank transaction on the left to match.'
                  : 'Matching...'}
            </div>
          )}

          {/* Matched pairs */}
          {matchedPairs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Matched Pairs ({matchedPairs.length})
                </h3>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="block-btn-primary flex items-center gap-1.5 px-4 py-2 text-xs font-semibold disabled:opacity-40"
                  style={{ borderRadius: '2px' }}
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save Reconciliation'}
                </button>
              </div>

              <div
                className="block-card p-0 overflow-hidden"
                style={{ borderRadius: '2px' }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-tertiary border-b border-border-primary">
                      <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Bank Transaction
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Bank Amount
                      </th>
                      <th className="text-center px-2 py-2 w-8" />
                      <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Book Entry
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Book Amount
                      </th>
                      <th className="text-center px-2 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {matchedPairs.map((pair, i) => {
                      const diff = Math.abs(
                        Math.abs(pair.bank.amount) -
                          Math.abs(pair.book.amount)
                      );
                      return (
                        <tr
                          key={i}
                          className="border-b border-border-primary/50 hover:bg-bg-hover/30"
                        >
                          <td className="px-4 py-2 text-xs text-text-primary">
                            <div>{pair.bank.description}</div>
                            <div className="text-[10px] text-text-muted font-mono">
                              {pair.bank.transaction_date}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-text-primary">
                            {fmt.format(pair.bank.amount)}
                          </td>
                          <td className="text-center px-2 py-2">
                            <Link2
                              size={12}
                              className={
                                diff < 0.01
                                  ? 'text-accent-income'
                                  : 'text-accent-warning'
                              }
                            />
                          </td>
                          <td className="px-4 py-2 text-xs text-text-primary">
                            <div>{pair.book.memo || '(no memo)'}</div>
                            <div className="text-[10px] text-text-muted font-mono">
                              {pair.book.entry_date}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-text-primary">
                            {fmt.format(pair.book.amount)}
                          </td>
                          <td className="text-center px-2 py-2">
                            <button
                              onClick={() => removeMatch(i)}
                              className="p-1 text-text-muted hover:text-accent-expense transition-colors"
                              title="Remove match"
                            >
                              <X size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ReconcileView;
