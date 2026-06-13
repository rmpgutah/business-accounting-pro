import React, { useEffect, useState } from 'react';
import { Activity, Layers } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';

// ─── Return-shape types ──────────────────────────────────
interface OperatingMetrics {
  employees: number;
  revenuePerEmployee: number;
  ytdRevenue: number;
}

interface QuickRatios {
  cashRatio: number;
  quickRatio: number;
  currentRatio: number;
  workingCapital: number;
}

interface BurnRate {
  cashOnHand: number;
  monthlyBurn: number;
  runwayMonths: number;
}

interface FinancialSnapshot {
  mtdRevenue: number;
  mtdExpenses: number;
  netIncome: number;
  outstandingAR: number;
  outstandingAP: number;
  cashBalance: number;
  currentRatio: number;
  monthlyBurn: number;
  runwayMonths: number;
}

// ─── Helpers ─────────────────────────────────────────────
const fmtRatio = (v: number, decimals = 2) =>
  isFinite(v) && v > 0 ? v.toFixed(decimals) : '—';

const healthColor = (
  v: number,
  goodThreshold: number,
  cautionThreshold: number,
  inverted = false,
): string => {
  const good = inverted ? v <= goodThreshold : v >= goodThreshold;
  const caution = inverted ? v <= cautionThreshold : v >= cautionThreshold;
  if (good) return 'var(--color-accent-income)';
  if (caution) return 'var(--color-accent-warning)';
  return 'var(--color-accent-expense)';
};

const CROSS_MODULE_KEYS: string[] = [
  'Clients',
  'Invoices',
  'Expenses',
  'Bills',
  'Projects',
  'Employees',
  'Vendors',
  'Loans',
  'Quotes',
  'Fixed Assets',
  'Inventory Items',
  'Time Entries',
  'Documents',
  'Bank Accounts',
];

// ─── Executive Scorecard ─────────────────────────────────
const ExecutiveScorecard: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  const [opMetrics, setOpMetrics] = useState<OperatingMetrics | null>(null);
  const [quickRatios, setQuickRatios] = useState<QuickRatios | null>(null);
  const [burnRate, setBurnRate] = useState<BurnRate | null>(null);
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [crossModule, setCrossModule] = useState<Record<string, number> | null>(null);

  const [loadingLiquidity, setLoadingLiquidity] = useState(true);
  const [loadingCross, setLoadingCross] = useState(true);

  // ── Load operating metrics, quick ratios, burn rate ──
  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoadingLiquidity(true);

    (async () => {
      try {
        const om = await api.swOperatingMetrics();
        if (!cancelled) setOpMetrics(om as OperatingMetrics);
      } catch (_) { /* non-fatal */ }

      try {
        const qr = await api.swQuickRatios();
        if (!cancelled) setQuickRatios(qr as QuickRatios);
      } catch (_) { /* non-fatal */ }

      try {
        const br = await api.swBurnRate();
        if (!cancelled) setBurnRate(br as BurnRate);
      } catch (_) { /* non-fatal */ }

      if (!cancelled) setLoadingLiquidity(false);
    })();

    return () => { cancelled = true; };
  }, [activeCompany]);

  // ── Load financial snapshot + cross-module summary ──
  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoadingCross(true);

    (async () => {
      try {
        const fs = await api.swFinancialSnapshot();
        if (!cancelled) setSnapshot(fs as FinancialSnapshot);
      } catch (_) { /* non-fatal */ }

      try {
        const cm = await api.swCrossModuleSummary();
        if (!cancelled) setCrossModule(cm as Record<string, number>);
      } catch (_) { /* non-fatal */ }

      if (!cancelled) setLoadingCross(false);
    })();

    return () => { cancelled = true; };
  }, [activeCompany]);

  // ── Derived colors ──
  const quickRatioColor = quickRatios
    ? healthColor(quickRatios.quickRatio, 1, 0.5)
    : 'var(--color-text-muted)';

  const currentRatioColor = quickRatios
    ? healthColor(quickRatios.currentRatio, 2, 1)
    : 'var(--color-text-muted)';

  const cashRatioColor = quickRatios
    ? healthColor(quickRatios.cashRatio, 1, 0.5)
    : 'var(--color-text-muted)';

  const runwayColor = burnRate
    ? healthColor(burnRate.runwayMonths, 12, 6)
    : 'var(--color-text-muted)';

  const workingCapitalColor =
    quickRatios && quickRatios.workingCapital >= 0
      ? 'var(--color-accent-income)'
      : 'var(--color-accent-expense)';

  return (
    <div
      className="block-card p-5 space-y-5"
      style={{ borderRadius: 'var(--app-radius)' }}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-accent-primary" />
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          Executive Scorecard
        </h2>
      </div>

      {/* ── Section A: Liquidity & Operations ── */}
      <div>
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          Liquidity &amp; Operations
        </p>

        {loadingLiquidity ? (
          <p className="text-xs text-text-muted">Loading liquidity data…</p>
        ) : !quickRatios && !burnRate && !opMetrics ? (
          <p className="text-xs text-text-muted">No liquidity data available.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {/* Quick Ratio */}
            {quickRatios && (
              <div
                className="stat-card border-l-2"
                style={{ borderLeftColor: quickRatioColor, borderRadius: 'var(--app-radius)' }}
              >
                <span className="stat-label">Quick Ratio</span>
                <p className="stat-value" style={{ color: quickRatioColor }}>
                  {fmtRatio(quickRatios.quickRatio)}x
                </p>
                <span className="text-xs text-text-muted">
                  {quickRatios.quickRatio >= 1 ? 'Liquid' : quickRatios.quickRatio >= 0.5 ? 'Watch' : 'Tight'}
                </span>
              </div>
            )}

            {/* Current Ratio */}
            {quickRatios && (
              <div
                className="stat-card border-l-2"
                style={{ borderLeftColor: currentRatioColor, borderRadius: 'var(--app-radius)' }}
              >
                <span className="stat-label">Current Ratio</span>
                <p className="stat-value" style={{ color: currentRatioColor }}>
                  {fmtRatio(quickRatios.currentRatio)}x
                </p>
                <span className="text-xs text-text-muted">
                  {quickRatios.currentRatio >= 2 ? 'Healthy' : quickRatios.currentRatio >= 1 ? 'Adequate' : 'At Risk'}
                </span>
              </div>
            )}

            {/* Cash Ratio */}
            {quickRatios && (
              <div
                className="stat-card border-l-2"
                style={{ borderLeftColor: cashRatioColor, borderRadius: 'var(--app-radius)' }}
              >
                <span className="stat-label">Cash Ratio</span>
                <p className="stat-value" style={{ color: cashRatioColor }}>
                  {fmtRatio(quickRatios.cashRatio)}x
                </p>
                <span className="text-xs text-text-muted">Cash / AP</span>
              </div>
            )}

            {/* Working Capital */}
            {quickRatios && (
              <div
                className="stat-card border-l-2"
                style={{ borderLeftColor: workingCapitalColor, borderRadius: 'var(--app-radius)' }}
              >
                <span className="stat-label">Working Capital</span>
                <p className="stat-value" style={{ color: workingCapitalColor }}>
                  {formatCurrency(quickRatios.workingCapital)}
                </p>
                <span className="text-xs text-text-muted">Net liquid assets</span>
              </div>
            )}

            {/* Monthly Burn */}
            {burnRate && (
              <div
                className="stat-card border-l-2"
                style={{
                  borderLeftColor:
                    burnRate.monthlyBurn <= 0
                      ? 'var(--color-accent-income)'
                      : 'var(--color-accent-expense)',
                  borderRadius: 'var(--app-radius)',
                }}
              >
                <span className="stat-label">Monthly Burn</span>
                <p
                  className="stat-value"
                  style={{
                    color:
                      burnRate.monthlyBurn <= 0
                        ? 'var(--color-accent-income)'
                        : 'var(--color-accent-expense)',
                  }}
                >
                  {formatCurrency(burnRate.monthlyBurn)}
                </p>
                <span className="text-xs text-text-muted">6-month avg</span>
              </div>
            )}

            {/* Runway */}
            {burnRate && (
              <div
                className="stat-card border-l-2"
                style={{ borderLeftColor: runwayColor, borderRadius: 'var(--app-radius)' }}
              >
                <span className="stat-label">Runway</span>
                <p className="stat-value" style={{ color: runwayColor }}>
                  {burnRate.runwayMonths >= 999 || burnRate.monthlyBurn <= 0
                    ? 'Infinite'
                    : `${burnRate.runwayMonths.toFixed(1)} mo`}
                </p>
                <span className="text-xs text-text-muted">
                  {formatCurrency(burnRate.cashOnHand)} cash
                </span>
              </div>
            )}

            {/* Revenue / Employee */}
            {opMetrics && (
              <div
                className="stat-card border-l-2"
                style={{
                  borderLeftColor: 'var(--color-accent-blue)',
                  borderRadius: 'var(--app-radius)',
                }}
              >
                <span className="stat-label">Rev / Employee</span>
                <p className="stat-value" style={{ color: 'var(--color-accent-blue)' }}>
                  {formatCurrency(opMetrics.revenuePerEmployee)}
                </p>
                <span className="text-xs text-text-muted">
                  {opMetrics.employees} active employee{opMetrics.employees !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {/* YTD Revenue */}
            {opMetrics && (
              <div
                className="stat-card border-l-2"
                style={{
                  borderLeftColor: 'var(--color-accent-income)',
                  borderRadius: 'var(--app-radius)',
                }}
              >
                <span className="stat-label">YTD Revenue</span>
                <p className="stat-value" style={{ color: 'var(--color-accent-income)' }}>
                  {formatCurrency(opMetrics.ytdRevenue)}
                </p>
                <span className="text-xs text-text-muted">Year-to-date collected</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section B: Cross-Module Snapshot ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Layers size={12} className="text-text-muted" />
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Cross-Module Snapshot
          </p>
        </div>

        {loadingCross ? (
          <p className="text-xs text-text-muted">Loading snapshot…</p>
        ) : (
          <div className="space-y-3">
            {/* Financial summary row */}
            {snapshot && (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}
              >
                {[
                  {
                    label: 'MTD Revenue',
                    value: formatCurrency(snapshot.mtdRevenue),
                    color: 'var(--color-accent-income)',
                  },
                  {
                    label: 'MTD Expenses',
                    value: formatCurrency(snapshot.mtdExpenses),
                    color: 'var(--color-accent-expense)',
                  },
                  {
                    label: 'Net Income',
                    value: formatCurrency(snapshot.netIncome),
                    color:
                      snapshot.netIncome >= 0
                        ? 'var(--color-accent-income)'
                        : 'var(--color-accent-expense)',
                  },
                  {
                    label: 'Outstanding AR',
                    value: formatCurrency(snapshot.outstandingAR),
                    color: 'var(--color-accent-warning)',
                  },
                  {
                    label: 'Outstanding AP',
                    value: formatCurrency(snapshot.outstandingAP),
                    color: 'var(--color-accent-expense)',
                  },
                  {
                    label: 'Cash Balance',
                    value: formatCurrency(snapshot.cashBalance),
                    color: 'var(--color-accent-income)',
                  },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Module count table */}
            {crossModule && Object.keys(crossModule).length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: '6px 12px',
                  paddingTop: snapshot ? '8px' : undefined,
                  borderTop: snapshot
                    ? '1px solid var(--color-border-hairline)'
                    : undefined,
                }}
              >
                {CROSS_MODULE_KEYS.filter((k) => crossModule[k] !== undefined).map((key) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '3px 0',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--color-text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        marginRight: 6,
                      }}
                    >
                      {key}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--color-text-primary)',
                        flexShrink: 0,
                      }}
                    >
                      {(crossModule[key] ?? 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : !loadingCross ? (
              <p className="text-xs text-text-muted">No cross-module data available.</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExecutiveScorecard;
