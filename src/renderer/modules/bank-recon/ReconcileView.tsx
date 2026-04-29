import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Zap,
  X,
  Save,
  Link2,
  RefreshCw,
  Trash2,
  Sparkles,
  Printer,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatDate } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';

// ─── Types ──────────────────────────────────────────────
interface BankAccount {
  id: string;
  name: string;
}

interface BankTransaction {
  id: string;
  date: string;
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
  const [savedMatches, setSavedMatches] = useState<any[]>([]);

  // Quick filters for the bank-transaction list
  const [filterUnmatched, setFilterUnmatched] = useState(false);
  const [filterDeposits, setFilterDeposits] = useState(false);
  const [filterDebits, setFilterDebits] = useState(false);
  const [hideCleared, setHideCleared] = useState(false);

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
      // Perf: cap unmatched txn list at 2000; reconciliation typically deals with recent txns
      const bankData = await api.query('bank_transactions', {
        bank_account_id: selectedBankId,
        status: 'pending',
      }, undefined, 2000);
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
           ORDER BY je.date DESC LIMIT 2000`,
          [accountId, activeCompany.id]
        );
        setBookEntries(bookData ?? []);
      } else {
        setBookEntries([]);
      }

      // Load saved reconciliation matches for this bank account
      try {
        const matches = await api.rawQuery(
          `SELECT brm.id, brm.bank_transaction_id, brm.journal_entry_line_id, brm.match_type,
                  bt.description AS bank_desc, bt.amount AS bank_amount, bt.date AS bank_date,
                  je.description AS book_memo, (jel.debit - jel.credit) AS book_amount, je.date AS book_date
           FROM bank_reconciliation_matches brm
           JOIN bank_transactions bt ON bt.id = brm.bank_transaction_id
           LEFT JOIN journal_entry_lines jel ON jel.id = brm.journal_entry_line_id
           LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE bt.bank_account_id = ?
           ORDER BY bt.date DESC`,
          [selectedBankId]
        );
        setSavedMatches(Array.isArray(matches) ? matches : []);
      } catch {
        setSavedMatches([]);
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

  // Apply quick filter toggles to the bank-side list
  const filteredBank = useMemo(() => {
    let list = unmatchedBank;
    if (filterUnmatched) list = list.filter((t) => t.status !== 'matched');
    if (filterDeposits) list = list.filter((t) => t.amount > 0);
    if (filterDebits) list = list.filter((t) => t.amount < 0);
    if (hideCleared) list = list.filter((t) => t.status !== 'matched');
    return list;
  }, [unmatchedBank, filterUnmatched, filterDeposits, filterDebits, hideCleared]);

  // ─── Smart match suggestions (per unmatched bank txn) ──
  // For each unmatched bank txn, find the best book entry by amount + date proximity.
  // Confidence: amount match (50pts) + date within 7d (40pts) + description token overlap (10pts).
  const suggestions = useMemo(() => {
    const result = new Map<
      string,
      { bookId: string; confidence: number }
    >();
    for (const bt of unmatchedBank) {
      let best: { id: string; conf: number } | null = null;
      const btAmt = Math.abs(bt.amount);
      const btDate = new Date(bt.date).getTime();
      const btDescTokens = (bt.description || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 3);
      for (const be of unmatchedBook) {
        const beAmt = Math.abs(be.amount);
        const amtDiff = Math.abs(btAmt - beAmt);
        if (amtDiff > 1.0) continue; // too different
        let conf = 0;
        if (amtDiff < 0.01) conf += 50;
        else if (amtDiff < 0.5) conf += 35;
        else conf += 20;
        const dateDiffDays =
          Math.abs(btDate - new Date(be.entry_date).getTime()) / 86400000;
        if (dateDiffDays <= 1) conf += 40;
        else if (dateDiffDays <= 7) conf += 30;
        else if (dateDiffDays <= 30) conf += 15;
        const beTokens = (be.memo || '')
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 3);
        const overlap = btDescTokens.filter((t) => beTokens.includes(t)).length;
        if (overlap > 0) conf += Math.min(10, overlap * 5);
        if (!best || conf > best.conf) {
          best = { id: be.id, conf };
        }
      }
      if (best && best.conf > 50) {
        result.set(bt.id, { bookId: best.id, confidence: best.conf });
      }
    }
    return result;
  }, [unmatchedBank, unmatchedBook]);

  // Bulk match: auto-match all bank txns with confidence > 95
  const bulkMatch = useCallback(() => {
    const newMatches: MatchedPair[] = [...matchedPairs];
    const usedBank = new Set(newMatches.map((m) => m.bank.id));
    const usedBook = new Set(newMatches.map((m) => m.book.id));
    let added = 0;
    for (const [bankId, sug] of suggestions.entries()) {
      if (sug.confidence < 95) continue;
      if (usedBank.has(bankId) || usedBook.has(sug.bookId)) continue;
      const bank = bankTxns.find((t) => t.id === bankId);
      const book = bookEntries.find((e) => e.id === sug.bookId);
      if (!bank || !book) continue;
      newMatches.push({ bank, book });
      usedBank.add(bankId);
      usedBook.add(sug.bookId);
      added += 1;
    }
    setMatchedPairs(newMatches);
    setSaveResult(
      added > 0
        ? `Bulk matched ${added} high-confidence pair${added !== 1 ? 's' : ''}.`
        : 'No high-confidence matches found.'
    );
  }, [suggestions, matchedPairs, bankTxns, bookEntries]);

  // Reconciliation progress = matched / total bank txns
  const progressPct = useMemo(() => {
    const total = bankTxns.length;
    if (total === 0) return 0;
    const matched = total - unmatchedBank.length + matchedPairs.length;
    return Math.min(100, Math.max(0, (matched / total) * 100));
  }, [bankTxns, unmatchedBank, matchedPairs]);

  // Print reconciliation report
  const printReport = async () => {
    const acct = bankAccounts.find((b) => b.id === selectedBankId);
    const totalBank = bankTxns.reduce((s, t) => s + t.amount, 0);
    const matchedRows = savedMatches
      .map(
        (m: any) => `<tr>
        <td>${formatDate(m.bank_date)}</td>
        <td>${m.bank_desc || ''}</td>
        <td style="text-align:right">${(m.bank_amount ?? 0).toFixed(2)}</td>
        <td>${m.book_memo || ''}</td>
        <td style="text-align:right">${(m.book_amount ?? 0).toFixed(2)}</td>
      </tr>`
      )
      .join('');
    const unmatchedRows = unmatchedBank
      .map(
        (t) => `<tr>
        <td>${formatDate(t.date)}</td>
        <td>${t.description || ''}</td>
        <td style="text-align:right">${t.amount.toFixed(2)}</td>
        <td>${t.status}</td>
      </tr>`
      )
      .join('');
    const html = `
      <html><head><title>Reconciliation Report</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#222}
        h1{font-size:18px;margin:0 0 4px 0}
        h2{font-size:14px;margin:24px 0 6px 0}
        .sub{font-size:11px;color:#666;margin-bottom:16px}
        table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:18px}
        th,td{border:1px solid #ddd;padding:5px 6px;text-align:left}
        th{background:#f3f4f6;text-transform:uppercase;font-size:10px}
        .meta{font-size:11px;margin-bottom:14px}
        .meta div{margin-bottom:3px}
      </style></head><body>
        <h1>Bank Reconciliation Report</h1>
        <div class="sub">${activeCompany?.name ?? ''} — ${new Date().toLocaleString()}</div>
        <div class="meta">
          <div><strong>Account:</strong> ${acct?.name ?? '—'}</div>
          <div><strong>Bank txn count:</strong> ${bankTxns.length}</div>
          <div><strong>Net per bank:</strong> ${totalBank.toFixed(2)}</div>
          <div><strong>Saved matches:</strong> ${savedMatches.length}</div>
          <div><strong>Unmatched:</strong> ${unmatchedBank.length}</div>
          <div><strong>Progress:</strong> ${progressPct.toFixed(0)}%</div>
        </div>
        <h2>Saved Matches</h2>
        <table><thead><tr>
          <th>Bank Date</th><th>Bank Description</th><th style="text-align:right">Bank Amt</th>
          <th>Book Memo</th><th style="text-align:right">Book Amt</th>
        </tr></thead><tbody>${matchedRows || '<tr><td colspan="5">None</td></tr>'}</tbody></table>
        <h2>Unmatched Bank Transactions</h2>
        <table><thead><tr>
          <th>Date</th><th>Description</th><th style="text-align:right">Amount</th><th>Status</th>
        </tr></thead><tbody>${unmatchedRows || '<tr><td colspan="4">None</td></tr>'}</tbody></table>
      </body></html>`;
    try {
      await api.printPreview(html, 'Reconciliation Report');
    } catch {
      /* ignore */
    }
  };

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
    if (saving) return;
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
        last_reconciled_date: todayLocal(),
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
        style={{ borderRadius: '6px' }}
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
            {/* Alphabetical A→Z */}
            {[...bankAccounts]
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
              .map((ba) => (
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
            style={{ borderRadius: '6px' }}
            title="Auto-match by amount (exact)"
          >
            <Zap size={14} />
            Auto-Match
          </button>
          <button
            onClick={bulkMatch}
            disabled={!selectedBankId || loading || suggestions.size === 0}
            className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ borderRadius: '6px' }}
            title="Bulk match all >95% confidence suggestions"
          >
            <Sparkles size={14} />
            Bulk Match
          </button>
          <button
            onClick={printReport}
            disabled={!selectedBankId || loading}
            className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ borderRadius: '6px' }}
            title="Print reconciliation report"
          >
            <Printer size={14} />
            Print Report
          </button>
          <button
            onClick={loadTransactions}
            disabled={!selectedBankId}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40"
            style={{ borderRadius: '6px' }}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar + quick filters */}
      {selectedBankId && bankTxns.length > 0 && (
        <div className="block-card p-3 space-y-2" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Reconciliation Progress
            </span>
            <span className="text-xs font-mono text-text-primary">
              {progressPct.toFixed(0)}% • {bankTxns.length - unmatchedBank.length + matchedPairs.length} of {bankTxns.length} matched
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: 'var(--color-bg-tertiary)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                background:
                  progressPct >= 90
                    ? '#22c55e'
                    : progressPct >= 50
                      ? '#3b82f6'
                      : '#eab308',
                transition: 'width 0.3s',
              }}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-[10px] text-text-muted uppercase tracking-wider mr-1">
              Filters:
            </span>
            <button
              onClick={() => setFilterUnmatched((v) => !v)}
              className={`px-2 py-1 text-[10px] font-semibold border transition-colors ${
                filterUnmatched
                  ? 'bg-accent-blue text-white border-accent-blue'
                  : 'bg-bg-secondary text-text-muted border-border-primary hover:text-text-primary'
              }`}
              style={{ borderRadius: '6px' }}
            >
              Only Unmatched
            </button>
            <button
              onClick={() => setFilterDeposits((v) => !v)}
              className={`px-2 py-1 text-[10px] font-semibold border transition-colors ${
                filterDeposits
                  ? 'bg-accent-blue text-white border-accent-blue'
                  : 'bg-bg-secondary text-text-muted border-border-primary hover:text-text-primary'
              }`}
              style={{ borderRadius: '6px' }}
            >
              Only Deposits
            </button>
            <button
              onClick={() => setFilterDebits((v) => !v)}
              className={`px-2 py-1 text-[10px] font-semibold border transition-colors ${
                filterDebits
                  ? 'bg-accent-blue text-white border-accent-blue'
                  : 'bg-bg-secondary text-text-muted border-border-primary hover:text-text-primary'
              }`}
              style={{ borderRadius: '6px' }}
            >
              Only Debits
            </button>
            <button
              onClick={() => setHideCleared((v) => !v)}
              className={`px-2 py-1 text-[10px] font-semibold border transition-colors ${
                hideCleared
                  ? 'bg-accent-blue text-white border-accent-blue'
                  : 'bg-bg-secondary text-text-muted border-border-primary hover:text-text-primary'
              }`}
              style={{ borderRadius: '6px' }}
            >
              Hide Cleared
            </button>
            {suggestions.size > 0 && (
              <span className="text-[10px] text-accent-blue ml-auto inline-flex items-center gap-1">
                <Sparkles size={11} />
                {suggestions.size} smart suggestion
                {suggestions.size !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Save result */}
      {saveResult && (
        <div
          className={`px-4 py-2 text-xs border ${
            saveResult.startsWith('Error')
              ? 'text-accent-expense bg-accent-expense/10 border-accent-expense/20'
              : 'text-accent-income bg-accent-income/10 border-accent-income/20'
          }`}
          style={{ borderRadius: '6px' }}
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
              style={{ borderRadius: '6px' }}
            >
              <div className="px-4 py-2 bg-bg-tertiary border-b border-border-primary flex items-center justify-between">
                <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Bank Transactions ({filteredBank.length})
                </span>
                {selectedBank && (
                  <span className="text-[10px] text-accent-blue font-mono">
                    1 selected
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {filteredBank.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-text-muted">
                    No unmatched bank transactions.
                  </div>
                ) : (
                  filteredBank.map((txn) => {
                    const sug = suggestions.get(txn.id);
                    return (
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
                          : 'hover:bg-bg-hover border-l-2 border-l-transparent transition-colors'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-primary font-medium truncate max-w-[55%]">
                          {txn.description}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs font-mono ${
                              txn.amount >= 0
                                ? 'text-accent-income'
                                : 'text-accent-expense'
                            }`}
                          >
                            {fmt.format(txn.amount)}
                          </span>
                          <button
                            className="text-text-muted hover:text-accent-expense transition-colors p-0.5"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm('Delete this bank transaction?')) return;
                              try {
                                await api.remove('bank_transactions', txn.id);
                                setBankTxns((prev) => prev.filter((t) => t.id !== txn.id));
                              } catch (err: any) {
                                alert('Failed to delete: ' + (err?.message || 'Unknown error'));
                              }
                            }}
                            title="Delete transaction"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-text-muted font-mono">
                          {formatDate(txn.date)}
                        </span>
                        {sug && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const book = bookEntries.find(
                                (b) => b.id === sug.bookId
                              );
                              if (book) {
                                setMatchedPairs((prev) => [
                                  ...prev,
                                  { bank: txn, book },
                                ]);
                              }
                            }}
                            className="text-[9px] font-semibold inline-flex items-center gap-1 px-1.5 py-0.5 transition-colors"
                            style={{
                              borderRadius: '4px',
                              border: '1px solid var(--color-accent-blue)',
                              color: 'var(--color-accent-blue)',
                              background: 'rgba(59,130,246,0.08)',
                            }}
                            title={`Suggested match (${sug.confidence}% confidence)`}
                          >
                            <Sparkles size={9} />
                            {sug.confidence}%
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
                )}
              </div>
            </div>

            {/* RIGHT: Book Entries */}
            <div
              className="block-card p-0 overflow-hidden"
              style={{ borderRadius: '6px' }}
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
                          : 'hover:bg-bg-hover border-l-2 border-l-transparent transition-colors'
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
                        {formatDate(entry.entry_date)}
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
              style={{ borderRadius: '6px' }}
            >
              <Link2 size={12} className="inline mr-1 -mt-0.5" />
              {selectedBank && !selectedBook
                ? 'Now click a book entry on the right to match.'
                : !selectedBank && selectedBook
                  ? 'Now click a bank transaction on the left to match.'
                  : 'Matching...'}
            </div>
          )}

          {/* Saved reconciliation matches (with unmatch) */}
          {savedMatches.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Saved Matches ({savedMatches.length})
              </h3>
              <div
                className="block-card p-0 overflow-hidden"
                style={{ borderRadius: '6px' }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-tertiary border-b border-border-primary">
                      <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Bank Transaction
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="text-center px-2 py-2 w-8" />
                      <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Book Entry
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="text-center px-2 py-2 w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {savedMatches.map((m: any) => (
                      <tr
                        key={m.id}
                        className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors"
                      >
                        <td className="px-4 py-2 text-xs text-text-primary">
                          <div>{m.bank_desc}</div>
                          <div className="text-[10px] text-text-muted font-mono">
                            {formatDate(m.bank_date)}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-text-primary">
                          {fmt.format(m.bank_amount ?? 0)}
                        </td>
                        <td className="text-center px-2 py-2">
                          <Link2 size={12} className="text-accent-income" />
                        </td>
                        <td className="px-4 py-2 text-xs text-text-primary">
                          <div>{m.book_memo || '(no memo)'}</div>
                          <div className="text-[10px] text-text-muted font-mono">
                            {formatDate(m.book_date)}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-text-primary">
                          {fmt.format(m.book_amount ?? 0)}
                        </td>
                        <td className="text-center px-2 py-2">
                          <button
                            className="block-btn text-[10px] text-accent-expense px-2 py-1"
                            onClick={async () => {
                              if (!window.confirm('Unmatch this pair? Both the bank transaction and book entry will become unmatched.')) return;
                              try {
                                await api.remove('bank_reconciliation_matches', m.id);
                                await api.update('bank_transactions', m.bank_transaction_id, { status: 'pending', is_matched: 0 });
                                loadTransactions();
                              } catch (err: any) {
                                alert('Failed to unmatch: ' + (err?.message || 'Unknown error'));
                              }
                            }}
                          >
                            Unmatch
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                  style={{ borderRadius: '6px' }}
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save Reconciliation'}
                </button>
              </div>

              <div
                className="block-card p-0 overflow-hidden"
                style={{ borderRadius: '6px' }}
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
                          key={`${pair.bank.id}:${pair.book.id}`}
                          className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors"
                        >
                          <td className="px-4 py-2 text-xs text-text-primary">
                            <div>{pair.bank.description}</div>
                            <div className="text-[10px] text-text-muted font-mono">
                              {formatDate(pair.bank.date)}
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
                              {formatDate(pair.book.entry_date)}
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
