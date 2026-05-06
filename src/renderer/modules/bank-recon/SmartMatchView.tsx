// src/renderer/modules/bank-recon/SmartMatchView.tsx
//
// B11 — Smart payment matching UI.
//
// For each unmatched bank transaction (deposits only — credits to a
// bank account that look like customer payments), show the top 3
// candidate open invoices ranked by confidence, with a one-click
// "Apply" that records the payment + marks the invoice paid (or
// partial) and links the bank transaction.

import React, { useEffect, useState, useCallback } from 'react';
import { Wand2, Check, X, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import { useCompanyStore } from '../../stores/companyStore';

interface BankTxn {
  id: string;
  date: string;
  description: string;
  amount: number;
  matched_at: string | null;
}

interface MatchCandidate {
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  client_name: string | null;
  total: number;
  amount_paid: number;
  balance_due: number;
  issue_date: string;
  due_date: string;
  score: number;
  reasons: string[];
}

interface TxnWithMatches extends BankTxn {
  candidates: MatchCandidate[];
}

const fmt$ = (n: number): string => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SmartMatchView: React.FC = () => {
  const toast = useToast();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [items, setItems] = useState<TxnWithMatches[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompany?.id) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      // Pull unmatched bank transactions that are credits (positive amounts
      // i.e. money in — likely invoice payments).
      const txns = await api.rawQuery(
        "SELECT id, date, description, amount " +
        "FROM bank_transactions " +
        "WHERE company_id = ? AND amount > 0 AND matched_entry_id IS NULL " +
        "ORDER BY date DESC LIMIT 100",
        [activeCompany.id]
      );
      const txnList = Array.isArray(txns) ? txns as BankTxn[] : [];
      // Run smart-match for each. Parallelized; suggestMatches is a
      // pure DB query with no external calls.
      const results = await Promise.all(
        txnList.map(async (t) => {
          const candidates = await api.suggestPaymentMatches({
            amount: t.amount,
            date: t.date,
            description: t.description || '',
          });
          return { ...t, candidates: Array.isArray(candidates) ? candidates : [] };
        })
      );
      // Only show transactions that had at least one candidate.
      setItems(results.filter((r) => r.candidates.length > 0));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, activeCompany?.id]);

  const apply = async (txn: TxnWithMatches, candidate: MatchCandidate) => {
    setApplyingId(txn.id);
    try {
      // Record an invoice payment for this match.
      const result = await api.create('invoice_payments', {
        invoice_id: candidate.invoice_id,
        payment_date: txn.date,
        amount: txn.amount,
        method: 'bank_transfer',
        reference: txn.description?.slice(0, 60) || '',
        bank_transaction_id: txn.id,
      });
      if (result?.error) {
        toast.error('Apply failed: ' + result.error);
        return;
      }
      // Update the invoice's amount_paid + status.
      const newPaid = (Number(candidate.amount_paid) || 0) + txn.amount;
      const newStatus = newPaid + 0.005 >= candidate.total ? 'paid' : 'partial';
      await api.update('invoices', candidate.invoice_id, {
        amount_paid: newPaid,
        status: newStatus,
      });
      toast.success('Matched ' + fmt$(txn.amount) + ' to invoice ' + candidate.invoice_number + (newStatus === 'paid' ? ' (now paid in full)' : ' (partial)'));
      // Remove this txn from the list since it's now matched.
      setItems((prev) => prev.filter((i) => i.id !== txn.id));
    } finally { setApplyingId(null); }
  };

  const skip = (txnId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== txnId));
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Wand2 size={22} /> Smart Match
        </h2>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          Suggests open invoices for unmatched bank deposits
        </span>
        <button onClick={load} className="block-btn flex items-center gap-1.5 text-xs" style={{ marginLeft: 'auto' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {loading && <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Scanning…</div>}

      {!loading && items.length === 0 && (
        <div className="block-card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <Wand2 size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>No unmatched deposits with invoice candidates</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            Either all your imported deposits are already matched, or there are no open invoices that look like a candidate.
          </div>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((txn) => (
            <div key={txn.id} className="block-card" style={{ padding: 14 }}>
              {/* Bank transaction header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--color-border-primary)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                    {txn.date} · Bank deposit
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {txn.description || '(no description)'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: '#16a34a' }}>
                    {fmt$(txn.amount)}
                  </div>
                </div>
                <button onClick={() => skip(txn.id)} className="block-btn text-xs" style={{ marginLeft: 8 }} title="Skip — won't be matched">
                  <X size={11} /> Skip
                </button>
              </div>

              {/* Candidate matches */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {txn.candidates.map((c, i) => (
                  <div key={c.invoice_id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    background: i === 0 ? 'rgba(22, 163, 74, 0.06)' : 'transparent',
                    border: '1px solid ' + (i === 0 ? 'rgba(22, 163, 74, 0.3)' : 'var(--color-border-primary)'),
                    borderRadius: 6,
                  }}>
                    {/* Score badge */}
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: 4,
                      background: c.score >= 90 ? '#16a34a' : c.score >= 75 ? '#65a30d' : '#d97706',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: 14,
                      fontWeight: 800,
                      fontFamily: 'SF Mono, Menlo, monospace',
                    }}>
                      {c.score}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                          {c.invoice_number}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {c.client_name || 'Unknown client'}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          · Balance {fmt$(c.balance_due)} of {fmt$(c.total)}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {c.reasons.join(' · ')}
                      </div>
                    </div>
                    <button
                      onClick={() => apply(txn, c)}
                      disabled={applyingId === txn.id}
                      className="block-btn-primary flex items-center gap-1.5 text-xs"
                      style={{ flexShrink: 0 }}
                    >
                      <Check size={12} /> {applyingId === txn.id ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SmartMatchView;
