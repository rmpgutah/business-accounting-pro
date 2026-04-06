import React, { useEffect, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface StatuteTrackerProps {
  companyId: string;
}

interface DebtWithStatute {
  id: string;
  debtor_name: string;
  balance_due: number;
  jurisdiction: string;
  statute_of_limitations_date: string;
  delinquent_date: string;
  status: string;
}

// ─── Color helpers ──────────────────────────────────────
function daysRemaining(statuteDate: string): number {
  const d = new Date(statuteDate).getTime();
  if (isNaN(d)) return 0;
  return Math.floor((d - Date.now()) / 86_400_000);
}

function urgencyColor(days: number): string {
  if (days <= 0)  return 'text-gray-400';
  if (days < 90)  return 'text-red-400';
  if (days < 180) return 'text-orange-400';
  if (days < 365) return 'text-amber-400';
  return 'text-emerald-400';
}

function urgencyBg(days: number): string {
  if (days <= 0)  return 'bg-gray-500';
  if (days < 90)  return 'bg-red-500';
  if (days < 180) return 'bg-orange-500';
  if (days < 365) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function progressPct(delinquentDate: string | null, statuteDate: string): number {
  if (!delinquentDate) return 0;
  const start = new Date(delinquentDate).getTime();
  const end = new Date(statuteDate).getTime();
  const now = Date.now();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  const total = end - start;
  const elapsed = now - start;
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  return Math.round(pct);
}

// ─── Component ──────────────────────────────────────────
const StatuteTracker: React.FC<StatuteTrackerProps> = ({ companyId }) => {
  const [debts, setDebts] = useState<DebtWithStatute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.rawQuery(
          "SELECT * FROM debts WHERE company_id = ? AND statute_of_limitations_date IS NOT NULL AND status NOT IN ('settled','written_off') ORDER BY statute_of_limitations_date ASC",
          [companyId]
        );
        if (cancelled) return;
        setDebts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load statute data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [companyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-sm">
        Loading statute tracker...
      </div>
    );
  }

  if (debts.length === 0) {
    return (
      <div className="block-card text-center py-12">
        <Clock size={32} className="mx-auto text-text-muted mb-3" />
        <p className="text-text-muted text-sm">
          No debts with statute of limitations configured.
        </p>
      </div>
    );
  }

  return (
    <div className="block-card">
      <h4 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4">
        Statute of Limitations Tracker
      </h4>

      {/* Table header */}
      <div
        className="grid grid-cols-[1fr_100px_120px_100px_1fr] gap-3 px-3 py-2 text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-border-primary"
      >
        <span>Debtor</span>
        <span>Balance</span>
        <span>Jurisdiction</span>
        <span>Days Left</span>
        <span>Progress</span>
      </div>

      {/* Rows */}
      {debts.map((debt) => {
        const days = daysRemaining(debt.statute_of_limitations_date);
        const isExpired = days <= 0;
        const colorClass = urgencyColor(days);
        const bgClass = urgencyBg(days);
        const pct = progressPct(debt.delinquent_date, debt.statute_of_limitations_date);

        return (
          <div key={debt.id}>
            <div
              className="grid grid-cols-[1fr_100px_120px_100px_1fr] gap-3 items-center px-3 py-3 border-b border-border-primary hover:bg-bg-hover transition-colors"
            >
              {/* Debtor */}
              <div>
                <p className="text-sm font-semibold text-text-primary truncate">
                  {debt.debtor_name}
                </p>
                <p className="text-[10px] text-text-muted">
                  Expires {formatDate(debt.statute_of_limitations_date)}
                </p>
              </div>

              {/* Balance */}
              <span className="text-xs font-mono text-text-secondary">
                {formatCurrency(debt.balance_due)}
              </span>

              {/* Jurisdiction */}
              <span className="text-xs text-text-secondary truncate">
                {debt.jurisdiction || '--'}
              </span>

              {/* Days remaining */}
              <div>
                {isExpired ? (
                  <span
                    className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase bg-red-500/20 text-red-400"
                    style={{ borderRadius: '6px' }}
                  >
                    EXPIRED
                  </span>
                ) : (
                  <span className={`text-sm font-bold ${colorClass}`}>
                    {days}d
                  </span>
                )}
              </div>

              {/* Progress bar */}
              <div>
                <div
                  className="w-full h-2 bg-bg-tertiary overflow-hidden"
                  style={{ borderRadius: '6px' }}
                >
                  <div
                    className={`h-full transition-all ${bgClass}`}
                    style={{ width: `${pct}%`, borderRadius: '6px' }}
                  />
                </div>
                <p className="text-[10px] text-text-muted mt-0.5">
                  {pct}% elapsed
                </p>
              </div>
            </div>

            {/* Expired warning */}
            {isExpired && (
              <div
                className="flex items-center gap-2 px-3 py-2 bg-red-500/10 text-red-400 text-xs font-bold"
              >
                <AlertTriangle size={14} />
                EXPIRED -- Consult Legal Counsel
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default StatuteTracker;
