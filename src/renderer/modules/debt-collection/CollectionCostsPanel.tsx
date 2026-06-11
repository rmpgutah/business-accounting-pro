// src/renderer/modules/debt-collection/CollectionCostsPanel.tsx
//
// Collection Costs panel for DebtDetail — every expense linked to this debt
// (related_debt_id), with recoverability roll-ups, recovery tracking, ROI
// (payments collected per dollar of collection spend), and the
// "Apply to Balance" action that rolls recoverable costs into
// debts.fees_accrued / balance_due (idempotent — each cost applies once).

import React, { useCallback, useEffect, useState } from 'react';
import { Receipt, RefreshCw, ArrowUpRight, Scale } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import { useAppStore } from '../../stores/appStore';

const fmt$ = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

const COST_TYPE_LABELS: Record<string, string> = {
  court_fee: 'Court Fee', filing_fee: 'Filing Fee', legal_fee: 'Legal Fee',
  process_server: 'Process Server', skip_tracing: 'Skip Tracing',
  agency_commission: 'Agency Commission', credit_report: 'Credit Report',
  postage: 'Postage', travel: 'Travel', other: 'Other',
};

interface Props {
  debtId: string;
  /** Called after costs are applied to the balance so the parent refreshes. */
  onBalanceChanged?: () => void;
}

const CollectionCostsPanel: React.FC<Props> = ({ debtId, onBalanceChanged }) => {
  const toast = useToast();
  const setModule = useAppStore((s) => s.setModule);
  const [costs, setCosts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.debtCollectionCosts(debtId);
      if (r && !r.error) {
        setCosts(Array.isArray(r.costs) ? r.costs : []);
        setSummary(r.summary || null);
      }
    } finally {
      setLoading(false);
    }
  }, [debtId]);

  useEffect(() => { load(); }, [load]);

  const applyToBalance = async () => {
    if (!summary || summary.pending_apply <= 0) return;
    if (!confirm(`Add ${fmt$(summary.pending_apply)} of recoverable collection costs to the debtor's balance?`)) return;
    setApplying(true);
    try {
      const r = await api.debtApplyRecoverableCosts(debtId);
      if (r?.error) {
        toast.error(`Apply failed: ${r.error}`);
      } else {
        toast.success(`Applied ${fmt$(r.applied || 0)} (${r.count} cost${r.count === 1 ? '' : 's'}) to balance`);
        await load();
        onBalanceChanged?.();
      }
    } finally {
      setApplying(false);
    }
  };

  const setRecovery = async (expenseId: string, status: string, amount: number) => {
    const r = await api.expenseSetRecovery({
      expense_id: expenseId,
      recovery_status: status,
      recovered_amount: status === 'recovered' ? amount : 0,
      recovered_date: status === 'recovered' ? new Date().toISOString().slice(0, 10) : undefined,
    });
    if (r?.error) toast.error(r.error);
    else await load();
  };

  if (loading && costs.length === 0) return null;

  return (
    <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div className="flex items-center gap-2">
          <Scale size={13} className="text-accent-blue" />
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)' }}>
            Collection Costs
          </span>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{costs.length} expense{costs.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="block-btn text-xs flex items-center gap-1" onClick={load} title="Refresh">
            <RefreshCw size={11} />
          </button>
          <button
            className="block-btn text-xs flex items-center gap-1"
            onClick={() => setModule('expenses')}
            title="Log a new collection cost in the Expenses module — link it to this debt via the Collection Cost section"
          >
            <Receipt size={11} /> Log Cost
          </button>
          {summary && summary.pending_apply > 0 && (
            <button
              className="block-btn-primary text-xs flex items-center gap-1"
              disabled={applying}
              onClick={applyToBalance}
              title="Roll recoverable, not-yet-applied costs into the debtor's balance (fees_accrued)"
            >
              <ArrowUpRight size={11} />
              {applying ? 'Applying…' : `Apply ${fmt$(summary.pending_apply)} to Balance`}
            </button>
          )}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3" style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)' }}>
          <Stat
            label="Total Spend"
            value={fmt$(summary.total_costs)}
            color={summary.over_budget ? '#dc2626' : undefined}
            title={summary.over_budget ? `OVER BUDGET — cap is ${fmt$(summary.expense_budget)}` : undefined}
          />
          <Stat label="Recoverable" value={fmt$(summary.recoverable)} color="#16a34a" />
          <Stat label="Applied to Balance" value={fmt$(summary.applied_to_debt)} />
          <Stat label="Recovered" value={fmt$(summary.recovered)} color="#16a34a" />
          <Stat
            label="ROI (collected ÷ spend)"
            value={summary.roi == null ? '—' : `${summary.roi.toFixed(2)}×`}
            color={summary.roi != null && summary.roi < 1 ? '#dc2626' : '#16a34a'}
            title={summary.cost_to_collect_pct != null ? `Cost-to-collect: ${summary.cost_to_collect_pct}% of recovered dollars` : 'No payments collected yet'}
          />
          {/* Spend budget — click to set/change the cap for this case. */}
          <button
            type="button"
            onClick={async () => {
              const raw = prompt('Collection spend budget for this case ($, 0 = no cap):', String(summary.expense_budget || 0));
              if (raw == null) return;
              const r = await api.debtSetExpenseBudget(debtId, parseFloat(raw) || 0);
              if (r?.error) toast.error(r.error); else { toast.success('Budget updated'); load(); }
            }}
            className="text-left"
            title="Click to set the collection-spend cap for this case"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <Stat
              label="Spend Budget"
              value={summary.expense_budget > 0 ? fmt$(summary.expense_budget) : 'Set cap…'}
              color={summary.over_budget ? '#dc2626' : undefined}
            />
          </button>
        </div>
      )}
      {summary?.over_budget && (
        <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, color: '#f87171', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid var(--color-border-primary)' }}>
          ⚠ Collection spend {fmt$(summary.total_costs)} exceeds this case's budget of {fmt$(summary.expense_budget)} — review before incurring further costs.
        </div>
      )}

      {costs.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 11 }}>
          No expenses linked to this debt yet. Use <strong>Log Cost</strong> and set the
          “Collection Cost (Debt Case)” section on the expense.
        </div>
      ) : (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
                {['Date', 'Type', 'Description', 'Amount', 'Recoverable', 'Recovery'].map((h) => (
                  <th key={h} style={{ padding: '6px 8px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => {
                const total = (c.amount || 0) + (c.tax_amount || 0);
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <td style={{ padding: '5px 8px', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{c.date}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(96,165,250,0.12)', color: 'var(--color-accent-blue)' }}>
                        {COST_TYPE_LABELS[c.collection_cost_type] || 'Other'}
                      </span>
                    </td>
                    <td style={{ padding: '5px 8px', fontSize: 10, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>
                      {fmt$(total)}
                      {!!c.added_to_debt && <span style={{ fontSize: 8, color: '#16a34a', marginLeft: 4 }} title="Already applied to the debtor's balance">APPLIED</span>}
                    </td>
                    <td style={{ padding: '5px 8px', fontSize: 10 }}>
                      {c.is_recoverable ? <span style={{ color: '#16a34a', fontWeight: 700 }}>Yes</span> : <span style={{ color: 'var(--color-text-muted)' }}>No</span>}
                    </td>
                    <td style={{ padding: '5px 8px', fontSize: 10 }}>
                      {c.recovery_status === 'recovered' ? (
                        <span style={{ color: '#16a34a' }}>Recovered {fmt$(c.recovered_amount || 0)}</span>
                      ) : c.recovery_status === 'unrecoverable' ? (
                        <span style={{ color: '#dc2626' }}>Unrecoverable</span>
                      ) : c.is_recoverable ? (
                        <span className="flex items-center gap-1">
                          <button className="block-btn text-[9px] px-1.5 py-0.5" onClick={() => setRecovery(c.id, 'recovered', total)} title="Mark fully recovered from debtor">
                            Recovered
                          </button>
                          <button className="block-btn text-[9px] px-1.5 py-0.5" onClick={() => setRecovery(c.id, 'unrecoverable', 0)} title="Mark as not collectible">
                            Write Off
                          </button>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color?: string; title?: string }> = ({ label, value, color, title }) => (
  <div title={title}>
    <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: color || 'var(--color-text-primary)' }}>{value}</div>
  </div>
);

export default CollectionCostsPanel;
