import React, { useEffect, useState } from 'react';
import { X, Check, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

interface PaymentMatchReviewProps {
  onClose: () => void;
  onDone: () => void;
}

const PaymentMatchReview: React.FC<PaymentMatchReviewProps> = ({ onClose, onDone }) => {
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.listPendingMatches()
      .then(r => setMatches(Array.isArray(r) ? r : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAccept = async (matchId: string) => {
    setProcessing(p => new Set(p).add(matchId));
    await api.acceptPaymentMatch(matchId);
    setMatches(prev => prev.filter(m => m.id !== matchId));
    setProcessing(p => { const n = new Set(p); n.delete(matchId); return n; });
  };

  const handleReject = async (matchId: string) => {
    setProcessing(p => new Set(p).add(matchId));
    await api.rejectPaymentMatch(matchId);
    setMatches(prev => prev.filter(m => m.id !== matchId));
    setProcessing(p => { const n = new Set(p); n.delete(matchId); return n; });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="block-card-elevated w-full max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
            <h3 className="text-base font-bold text-text-primary">Review Suggested Payment Matches</h3>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="text-text-muted text-sm text-center py-12">Loading matches...</div>
            ) : matches.length === 0 ? (
              <div className="text-text-muted text-sm text-center py-12">No pending matches to review.</div>
            ) : (
              <div className="divide-y divide-border-primary">
                {matches.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-text-muted">
                          {formatDate(m.txn_date, { style: 'short' })}
                        </span>
                        <span className="text-sm font-bold font-mono text-accent-income">
                          {formatCurrency(m.txn_amount)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted truncate">{m.txn_memo || 'No memo'}</p>
                    </div>
                    <div className="text-center px-3">
                      <span className="text-xs text-text-muted">&rarr;</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{m.debtor_name}</p>
                      <p className="text-xs text-text-muted">Balance: {formatCurrency(m.balance_due)}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        className="block-btn-primary flex items-center gap-1 text-xs py-1 px-3"
                        onClick={() => handleAccept(m.id)}
                        disabled={processing.has(m.id)}
                      >
                        <Check size={12} /> Accept
                      </button>
                      <button
                        className="block-btn flex items-center gap-1 text-xs py-1 px-3 text-accent-expense"
                        onClick={() => handleReject(m.id)}
                        disabled={processing.has(m.id)}
                      >
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end px-5 py-3 border-t border-border-primary">
            <button className="block-btn" onClick={() => { onDone(); onClose(); }}>Done</button>
          </div>
        </div>
      </div>
    </>
  );
};

export default PaymentMatchReview;
