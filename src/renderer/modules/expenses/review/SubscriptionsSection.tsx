import React, { useCallback, useEffect, useState } from 'react';
import { Repeat, PlusCircle } from 'lucide-react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Props {
  onCount: (n: number) => void;
}

interface Pattern {
  vendor_id: string | null;
  description: string | null;
  avg_amount: number;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  avg_days_apart: number;
}

function freqFromDays(d: number): string {
  if (d <= 10) return 'weekly';
  if (d <= 20) return 'biweekly';
  if (d <= 45) return 'monthly';
  if (d <= 135) return 'quarterly';
  return 'annually';
}

function patternName(p: Pattern): string {
  return p.description || `Recurring expense (${p.avg_days_apart}d cycle)`;
}

const SubscriptionsSection: React.FC<Props> = ({ onCount }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompany) return;
    Promise.all([
      api.exDetectRecurring().catch(() => []),
      api.query('recurring_templates', { company_id: activeCompany.id, type: 'expense' }).catch(() => []),
    ]).then(([pats, tpls]: any[]) => {
      const existing = new Set(
        (Array.isArray(tpls) ? tpls : [])
          .filter((t: any) => t.is_active)
          .map((t: any) => (t.name || '').toLowerCase())
      );
      const list = (Array.isArray(pats) ? pats : []).filter(
        (p: Pattern) => !existing.has(patternName(p).toLowerCase())
      );
      setPatterns(list);
    });
  }, [activeCompany]);

  useEffect(() => { onCount(patterns.length); }, [patterns.length, onCount]);

  const createTemplate = useCallback(async (p: Pattern) => {
    if (!activeCompany) return;
    const key = `${p.vendor_id}-${p.description}`;
    setBusyKey(key);
    try {
      const last = new Date(p.last_seen + 'T00:00:00');
      last.setDate(last.getDate() + Math.max(1, Math.round(p.avg_days_apart)));
      const nextIso = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
      await api.create('recurring_templates', {
        company_id: activeCompany.id,
        type: 'expense',
        name: patternName(p),
        frequency: freqFromDays(p.avg_days_apart),
        next_date: nextIso,
        is_active: 1,
        template_data: { vendor_id: p.vendor_id, description: p.description, amount: p.avg_amount },
      });
      setPatterns((ps) => ps.filter((x) => `${x.vendor_id}-${x.description}` !== key));
    } finally {
      setBusyKey(null);
    }
  }, [activeCompany]);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <Repeat size={12} /> Detected Subscriptions
        </div>
        <span className="text-xs font-mono font-bold text-text-primary">{patterns.length}</span>
      </div>
      {patterns.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No untracked recurring charges detected.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Description</th><th className="text-right">Avg Amount</th>
              <th className="text-right">Seen</th><th>Cycle</th><th>Last</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p) => {
              const key = `${p.vendor_id}-${p.description}`;
              return (
                <tr key={key}>
                  <td className="text-text-primary text-xs truncate max-w-[240px]">{patternName(p)}</td>
                  <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(p.avg_amount)}</td>
                  <td className="text-right font-mono text-text-secondary text-xs">{p.occurrences}×</td>
                  <td className="text-text-secondary text-xs capitalize">{freqFromDays(p.avg_days_apart)}</td>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(p.last_seen)}</td>
                  <td className="text-right">
                    <button
                      className="block-btn flex items-center gap-1 text-xs ml-auto"
                      disabled={busyKey === key}
                      onClick={() => createTemplate(p)}
                    >
                      <PlusCircle size={12} /> Create template
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default SubscriptionsSection;
