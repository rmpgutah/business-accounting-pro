// src/renderer/modules/reports/ClientRiskDashboard.tsx
//
// B7 — Client Risk Scoring dashboard.
//
// Lists every client ranked by risk score (highest first). Each
// entry shows: composite score badge, key DSO trend, outstanding
// balance, oldest unpaid days, and warning bullets explaining the
// score. Click a row to expand component score breakdown.

import React, { useEffect, useState } from 'react';
import { ShieldAlert, ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../lib/api';

interface RiskScore {
  client_id: string;
  client_name: string;
  client_email: string | null;
  risk_score: number;
  risk_band: 'low' | 'moderate' | 'elevated' | 'high';
  risk_color: 'green' | 'yellow' | 'orange' | 'red';
  dso_score: number;
  outstanding_score: number;
  aging_score: number;
  late_pay_score: number;
  volume_score: number;
  avg_dso_days: number;
  avg_dso_recent: number;
  avg_dso_historical: number;
  outstanding_balance: number;
  oldest_unpaid_days: number;
  late_pay_pct: number;
  invoice_count: number;
  invoice_count_ytd: number;
  revenue_ytd: number;
  revenue_prior_year: number;
  volume_change_pct: number;
  warnings: string[];
}

const fmt$ = (n: number): string => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const COLOR_MAP: Record<string, string> = {
  green: '#16a34a',
  yellow: '#d97706',
  orange: '#ea580c',
  red: '#dc2626',
};

const BAND_LABEL: Record<string, string> = {
  low: 'Low Risk',
  moderate: 'Moderate Risk',
  elevated: 'Elevated Risk',
  high: 'High Risk',
};

interface Props { onBack?: () => void }

const ClientRiskDashboard: React.FC<Props> = ({ onBack }) => {
  const [scores, setScores] = useState<RiskScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.clientsRiskScore().then((r) => {
      if (Array.isArray(r)) setScores(r as RiskScore[]);
    }).finally(() => setLoading(false));
  }, []);

  const summary = {
    high: scores.filter((s) => s.risk_band === 'high').length,
    elevated: scores.filter((s) => s.risk_band === 'elevated').length,
    moderate: scores.filter((s) => s.risk_band === 'moderate').length,
    low: scores.filter((s) => s.risk_band === 'low').length,
    total_outstanding: scores.reduce((sum, s) => sum + s.outstanding_balance, 0),
    high_risk_outstanding: scores.filter((s) => s.risk_band === 'high' || s.risk_band === 'elevated').reduce((sum, s) => sum + s.outstanding_balance, 0),
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && (
          <button onClick={onBack} className="block-btn flex items-center gap-1.5 text-xs">
            <ChevronLeft size={12} /> Back
          </button>
        )}
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldAlert size={22} /> Client Risk Scoring
        </h2>
      </div>

      {loading && <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Computing risk scores…</div>}

      {!loading && scores.length === 0 && (
        <div className="block-card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          No client invoice history to analyze yet.
        </div>
      )}

      {!loading && scores.length > 0 && (
        <>
          {/* Summary banner */}
          <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Portfolio Risk Distribution · {scores.length} clients
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
              <BandStat label="High" count={summary.high} color={COLOR_MAP.red} />
              <BandStat label="Elevated" count={summary.elevated} color={COLOR_MAP.orange} />
              <BandStat label="Moderate" count={summary.moderate} color={COLOR_MAP.yellow} />
              <BandStat label="Low" count={summary.low} color={COLOR_MAP.green} />
              <Stat label="Total AR" value={fmt$(summary.total_outstanding)} />
              <Stat label="At-Risk AR" value={fmt$(summary.high_risk_outstanding)} color="#dc2626" highlight />
            </div>
          </div>

          {/* Ranked list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scores.map((s) => {
              const expanded = expandedId === s.client_id;
              return (
                <div key={s.client_id} className="block-card" style={{
                  padding: 0,
                  borderLeft: '3px solid ' + COLOR_MAP[s.risk_color],
                  overflow: 'hidden',
                }}>
                  {/* Header row */}
                  <button
                    onClick={() => setExpandedId(expanded ? null : s.client_id)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      textAlign: 'left',
                    }}
                  >
                    {/* Risk score badge */}
                    <div style={{
                      width: 56,
                      height: 56,
                      borderRadius: 6,
                      background: COLOR_MAP[s.risk_color],
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'column',
                      flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', lineHeight: 1 }}>
                        {s.risk_score}
                      </div>
                      <div style={{ fontSize: 7, fontWeight: 700, marginTop: 2, opacity: 0.85 }}>RISK</div>
                    </div>

                    {/* Client + key metrics */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{s.client_name}</div>
                        <div style={{ fontSize: 10, color: COLOR_MAP[s.risk_color], fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                          {BAND_LABEL[s.risk_band]}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        Avg DSO: <strong>{s.avg_dso_days}d</strong>
                        {' · '}Outstanding: <strong>{fmt$(s.outstanding_balance)}</strong>
                        {s.oldest_unpaid_days > 0 ? ' · Oldest unpaid: ' + s.oldest_unpaid_days + 'd past due' : ''}
                        {s.invoice_count_ytd > 0 ? ' · ' + s.invoice_count_ytd + ' invoices YTD' : ''}
                      </div>
                      {s.warnings.length > 0 && !expanded && (
                        <div style={{ fontSize: 10, color: COLOR_MAP[s.risk_color], marginTop: 4, fontStyle: 'italic' }}>
                          ⚠ {s.warnings[0]}{s.warnings.length > 1 ? ' (+' + (s.warnings.length - 1) + ' more)' : ''}
                        </div>
                      )}
                    </div>

                    <div style={{ color: 'var(--color-text-muted)' }}>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                  </button>

                  {/* Expanded breakdown */}
                  {expanded && (
                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--color-border-primary)' }}>
                      {/* Component scores */}
                      <div style={{ marginTop: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                          Component Scores (weighted)
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                          <ComponentBar label="DSO" value={s.dso_score} weight={25} />
                          <ComponentBar label="Outstanding" value={s.outstanding_score} weight={20} />
                          <ComponentBar label="Aging" value={s.aging_score} weight={25} />
                          <ComponentBar label="Late-pay" value={s.late_pay_score} weight={15} />
                          <ComponentBar label="Volume" value={s.volume_score} weight={15} />
                        </div>
                      </div>

                      {/* All warnings */}
                      {s.warnings.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                            Warnings
                          </div>
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: COLOR_MAP[s.risk_color], lineHeight: 1.6 }}>
                            {s.warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      )}

                      {/* Detailed metrics grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                        <Metric label="Avg DSO (recent 90d)" value={s.avg_dso_recent + 'd'} />
                        <Metric label="Avg DSO (historical)" value={s.avg_dso_historical + 'd'} />
                        <Metric label="Late-pay %" value={s.late_pay_pct + '%'} />
                        <Metric label="Volume Change YoY" value={(s.volume_change_pct >= 0 ? '+' : '') + s.volume_change_pct + '%'} />
                        <Metric label="Total Invoices" value={String(s.invoice_count)} />
                        <Metric label="Invoices YTD" value={String(s.invoice_count_ytd)} />
                        <Metric label="Revenue YTD" value={fmt$(s.revenue_ytd)} />
                        <Metric label="Revenue Prior Yr" value={fmt$(s.revenue_prior_year)} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const BandStat: React.FC<{ label: string; count: number; color: string }> = ({ label, count, color }) => (
  <div>
    <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
    <div style={{
      fontSize: 22,
      fontWeight: 800,
      fontFamily: 'SF Mono, Menlo, monospace',
      color: count > 0 ? color : 'var(--color-text-muted)',
    }}>{count}</div>
  </div>
);

const Stat: React.FC<{ label: string; value: string; color?: string; highlight?: boolean }> = ({ label, value, color, highlight }) => (
  <div>
    <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
    <div style={{
      fontSize: highlight ? 22 : 18,
      fontWeight: 800,
      fontFamily: 'SF Mono, Menlo, monospace',
      color: color || 'var(--color-text-primary)',
    }}>{value}</div>
  </div>
);

const ComponentBar: React.FC<{ label: string; value: number; weight: number }> = ({ label, value, weight }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 2 }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span>{value}/100 · {weight}%</span>
    </div>
    <div style={{ height: 4, background: 'var(--color-bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        width: value + '%',
        height: '100%',
        background: value >= 70 ? '#dc2626' : value >= 50 ? '#ea580c' : value >= 25 ? '#d97706' : '#16a34a',
      }} />
    </div>
  </div>
);

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-muted)' }}>{label}</div>
    <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-primary)' }}>{value}</div>
  </div>
);

export default ClientRiskDashboard;
