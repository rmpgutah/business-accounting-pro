import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronRight, Pause, Play } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { formatStatus } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import { calcRiskScore, getRiskBadge } from './riskScore';

// ─── Types ──────────────────────────────────────────────
interface PipelineDebt {
  id: string;
  debtor_name: string;
  balance_due: number;
  original_amount: number;
  delinquent_date: string;
  current_stage: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  hold: number;
  stage_entered_at: string | null;
  assigned_collector_id?: string | null;
  has_plan?: number;
  has_pending_settlement?: number;
  has_broken_promise?: number;
}

interface PipelineViewProps {
  onViewDebt: (id: string) => void;
}

// ─── Constants ──────────────────────────────────────────
const STAGES = [
  'reminder',
  'warning',
  'final_notice',
  'demand_letter',
  'collections_agency',
  'legal_action',
  'judgment',
  'garnishment',
] as const;

const PRIORITY_BORDER: Record<string, string> = {
  low: 'border-l-green-600',
  medium: 'border-l-blue-500',
  high: 'border-l-orange-500',
  critical: 'border-l-red-600',
};

// ─── Helpers ────────────────────────────────────────────
function daysInStage(stageEnteredAt: string | null): number {
  if (!stageEnteredAt) return 0;
  const entered = new Date(stageEnteredAt).getTime();
  if (isNaN(entered)) return 0;
  return Math.max(0, Math.floor((Date.now() - entered) / 86_400_000));
}

// ─── Component ──────────────────────────────────────────
const PipelineView: React.FC<PipelineViewProps> = ({ onViewDebt }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [debts, setDebts] = useState<PipelineDebt[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Load users ──
  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  // ── Load pipeline debts ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      try {
        const data = await api.rawQuery(
          `SELECT d.*,
            dps.entered_at as stage_entered_at,
            (SELECT COUNT(*) FROM debt_payment_plans WHERE debt_id = d.id) as has_plan,
            (SELECT COUNT(*) FROM debt_settlements WHERE debt_id = d.id AND response = 'pending') as has_pending_settlement,
            (SELECT COUNT(*) FROM debt_promises WHERE debt_id = d.id AND kept = 0 AND promised_date < date('now')) as has_broken_promise
           FROM debts d
           LEFT JOIN debt_pipeline_stages dps ON dps.debt_id = d.id AND dps.stage = d.current_stage AND dps.exited_at IS NULL
           WHERE d.company_id = ? AND d.status NOT IN (?, ?)
           ORDER BY d.priority DESC, d.created_at`,
          [activeCompany.id, 'settled', 'written_off']
        );
        if (cancelled) return;
        setDebts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load pipeline debts:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany, refreshKey]);

  // ── Group by stage ──
  const grouped = useMemo(() => {
    const map: Record<string, PipelineDebt[]> = {};
    for (const s of STAGES) map[s] = [];
    for (const d of debts) {
      const stage = d.current_stage;
      if (map[stage]) {
        map[stage].push(d);
      }
    }
    return map;
  }, [debts]);

  // ── Actions ──
  const handleAdvance = useCallback(
    async (e: React.MouseEvent, debtId: string) => {
      e.stopPropagation();
      try {
        await api.debtAdvanceStage(debtId);
        setRefreshKey((k) => k + 1);
      } catch (err) {
        console.error('Failed to advance stage:', err);
      }
    },
    []
  );

  const handleHoldToggle = useCallback(
    async (e: React.MouseEvent, debt: PipelineDebt) => {
      e.stopPropagation();
      try {
        await api.debtHoldToggle(debt.id, debt.hold !== 1);
        setRefreshKey((k) => k + 1);
      } catch (err) {
        console.error('Failed to toggle hold:', err);
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading pipeline...
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {STAGES.map((stage) => {
        const stageDebts = grouped[stage];
        const stageLabel = formatStatus(stage);
        return (
          <div
            key={stage}
            className="block-card min-w-[200px] w-[200px] flex-shrink-0 flex flex-col"
            style={{ maxHeight: 'calc(100vh - 200px)' }}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <span className="uppercase text-xs font-bold text-text-muted truncate">
                {stageLabel.label}
              </span>
              <span
                className="block-badge text-[10px] min-w-[20px] text-center"
                style={{ padding: '1px 6px' }}
              >
                {stageDebts.length}
              </span>
            </div>

            {/* Scrollable card list */}
            <div className="overflow-y-auto flex-1 px-2 pb-2">
              {stageDebts.length === 0 ? (
                <p className="text-text-muted text-xs text-center py-4">No debts</p>
              ) : (
                stageDebts.map((debt) => {
                  const days = daysInStage(debt.stage_entered_at);
                  const borderClass = PRIORITY_BORDER[debt.priority] || 'border-l-gray-500';
                  return (
                    <div
                      key={debt.id}
                      className={`block-card-elevated mb-2 p-3 cursor-pointer hover:bg-bg-hover border-l-4 ${borderClass}`}
                      style={{ borderRadius: '6px' }}
                      onClick={() => onViewDebt(debt.id)}
                    >
                      <p className="text-sm font-bold text-text-primary truncate">
                        {debt.debtor_name}
                      </p>
                      <p className="text-xs font-mono text-text-secondary mt-1">
                        {formatCurrency(debt.balance_due)}
                      </p>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <span className="text-[10px] text-text-muted">{days}d in stage</span>
                        {(() => {
                          const score = calcRiskScore(debt);
                          const risk = getRiskBadge(score);
                          return (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: risk.color + '22', color: risk.color }}>
                              {risk.label}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {!!debt.has_plan && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#2563eb22', color: '#60a5fa' }}>PLAN</span>
                        )}
                        {!!debt.has_pending_settlement && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#0891b222', color: '#06b6d4' }}>OFFER</span>
                        )}
                        {!!debt.has_broken_promise && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#dc262622', color: '#f87171' }}>BROKEN</span>
                        )}
                      </div>

                      {/* Hold badge */}
                      {debt.hold === 1 && (
                        <span
                          className="inline-block mt-1 px-2 py-0.5 text-[10px] font-bold uppercase bg-yellow-600/20 text-yellow-400 border border-yellow-600/40"
                          style={{ borderRadius: '6px' }}
                        >
                          HOLD
                        </span>
                      )}

                      {/* Collector badge */}
                      {debt.assigned_collector_id && (() => {
                        const u = users.find((x: any) => x.id === debt.assigned_collector_id);
                        if (!u) return null;
                        const initials = (u.display_name || u.email || '?').slice(0, 2).toUpperCase();
                        return (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 20, height: 20, borderRadius: '50%',
                            background: 'var(--color-accent)', color: '#fff',
                            fontSize: 9, fontWeight: 700, marginTop: 4
                          }}>
                            {initials}
                          </span>
                        );
                      })()}

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 mt-2">
                        <button
                          className="block-btn p-1"
                          title="Advance Stage"
                          onClick={(e) => handleAdvance(e, debt.id)}
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          className="block-btn p-1"
                          title={debt.hold === 1 ? 'Resume' : 'Hold'}
                          onClick={(e) => handleHoldToggle(e, debt)}
                        >
                          {debt.hold === 1 ? <Play size={14} /> : <Pause size={14} />}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PipelineView;
