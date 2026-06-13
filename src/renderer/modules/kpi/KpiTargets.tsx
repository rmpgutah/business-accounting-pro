import React, { useEffect, useRef, useState } from 'react';
import { Target, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// ─── Return shape from kpiDashboardRollup ──────────────────────────────────
interface KpiRow {
  id: string;
  key: string;
  name: string;
  description?: string;
  unit?: string;
  direction?: string; // 'higher_better' | 'lower_better' | 'neutral'
  target?: number | null;
  category?: string;
  current_value?: number | null;
  current_severity?: string | null;
  last_snapshot_at?: string | null;
}

// ─── Return shape from kpiDelta ────────────────────────────────────────────
interface DeltaResult {
  current?: number;
  prior?: number;
  delta?: number | null;
  delta_percent?: number | null;
  reason?: string;
  error?: string;
}

function fmtValue(value: number | null | undefined, unit?: string): string {
  if (value == null) return '—';
  if (unit === 'currency' || unit === 'usd') return formatCurrency(value);
  if (unit === 'percent' || unit === '%') return `${value.toFixed(2)}%`;
  if (unit === 'ratio') return `${value.toFixed(2)}x`;
  if (unit === 'days') return `${value.toFixed(1)} d`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDelta(delta: number | null | undefined, unit?: string): string {
  if (delta == null) return '—';
  const prefix = delta > 0 ? '+' : '';
  if (unit === 'currency' || unit === 'usd') return prefix + formatCurrency(delta);
  if (unit === 'percent' || unit === '%') return `${prefix}${delta.toFixed(2)}%`;
  if (unit === 'ratio') return `${prefix}${delta.toFixed(2)}x`;
  if (unit === 'days') return `${prefix}${delta.toFixed(1)} d`;
  return `${prefix}${delta.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function pctToGoal(current: number | null | undefined, target: number | null | undefined): string {
  if (current == null || target == null || target === 0) return '—';
  return `${Math.round((current / target) * 100)}%`;
}

function deltaColor(delta: number | null | undefined, direction?: string): string {
  if (delta == null) return 'var(--color-text-muted)';
  const isHigherBetter = direction !== 'lower_better';
  const isImproving = isHigherBetter ? delta > 0 : delta < 0;
  if (delta === 0) return 'var(--color-text-muted)';
  return isImproving ? 'var(--color-accent-income)' : 'var(--color-accent-expense)';
}

// ─── Inline target editor for one KPI row ─────────────────────────────────
const TargetEditor: React.FC<{
  kpi: KpiRow;
  onSaved: () => void;
}> = ({ kpi, onSaved }) => {
  const [draft, setDraft] = useState<string>(kpi.target != null ? String(kpi.target) : '');
  const [saving, setSaving] = useState(false);

  const handleSet = async () => {
    const val = parseFloat(draft);
    if (isNaN(val)) return;
    setSaving(true);
    try {
      await api.rptKpiSetTarget(kpi.key, val);
      onSaved();
    } catch (err) {
      console.error('KPI set target failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number"
        className="block-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Set target"
        style={{
          width: 100,
          fontSize: 12,
          padding: '2px 6px',
          borderRadius: 'var(--app-radius)',
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSet(); }}
      />
      <button
        className="block-btn"
        onClick={handleSet}
        disabled={saving || draft === ''}
        style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 'var(--app-radius)',
          opacity: saving ? 0.5 : 1,
        }}
      >
        {saving ? '…' : 'Set'}
      </button>
    </div>
  );
};

// ─── Main section component ────────────────────────────────────────────────
const KpiTargets: React.FC = () => {
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [deltas, setDeltas] = useState<Record<string, DeltaResult>>({});
  const [loading, setLoading] = useState(true);
  const [recalcing, setRecalcing] = useState(false);
  const cancelledRef = useRef(false);

  const load = () => {
    cancelledRef.current = false;
    setLoading(true);

    api.rptKpiRollup()
      .then((rows: any) => {
        if (cancelledRef.current) return;
        const list: KpiRow[] = Array.isArray(rows) ? rows : [];
        setKpis(list);
        setLoading(false);

        // Load deltas one-at-a-time to avoid Promise.all
        list.forEach((kpi) => {
          api.rptKpiDelta(kpi.key, 30)
            .then((d: any) => {
              if (cancelledRef.current) return;
              setDeltas((prev) => ({ ...prev, [kpi.key]: d as DeltaResult }));
            })
            .catch(() => {/* non-fatal */});
        });
      })
      .catch((err: any) => {
        console.error('KPI rollup failed:', err);
        if (!cancelledRef.current) setLoading(false);
      });
  };

  useEffect(() => {
    load();
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecalc = async () => {
    setRecalcing(true);
    try {
      await api.rptKpiRecalcBuiltin();
      load();
    } catch (err) {
      console.error('KPI recalc failed:', err);
    } finally {
      setRecalcing(false);
    }
  };

  return (
    <div
      className="block-card p-5"
      style={{ borderRadius: 'var(--app-radius)' }}
    >
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={14} style={{ color: 'var(--color-accent-primary)' }} />
          <h2
            className="text-xs font-semibold text-text-muted"
            style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            KPI Targets
          </h2>
        </div>
        <button
          className="block-btn"
          onClick={handleRecalc}
          disabled={recalcing}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 'var(--app-radius)',
            opacity: recalcing ? 0.5 : 1,
          }}
        >
          <RefreshCw size={11} style={recalcing ? { animation: 'spin 1s linear infinite' } : {}} />
          {recalcing ? 'Recalculating…' : 'Recalculate'}
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <span className="text-text-muted text-sm">Loading KPI targets…</span>
        </div>
      ) : kpis.length === 0 ? (
        <div className="empty-state py-8">
          <p className="text-text-muted text-sm text-center">
            No KPI definitions found. Run <strong>Recalculate</strong> to seed the built-in KPIs.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="block-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', paddingLeft: 12 }}>KPI</th>
                <th style={{ textAlign: 'right' }}>Current</th>
                <th style={{ textAlign: 'right' }}>Target</th>
                <th style={{ textAlign: 'right' }}>% to Goal</th>
                <th style={{ textAlign: 'right' }}>30-day Delta</th>
                <th style={{ textAlign: 'right', paddingRight: 12 }}>Set Target</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((kpi) => {
                const d = deltas[kpi.key];
                const delta = d?.delta;
                const deltaPct = d?.delta_percent;
                const dc = deltaColor(delta, kpi.direction);
                const DeltaIcon =
                  delta == null || delta === 0
                    ? Minus
                    : delta > 0
                      ? TrendingUp
                      : TrendingDown;

                return (
                  <tr key={kpi.key}>
                    {/* KPI name + key */}
                    <td style={{ paddingLeft: 12 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>
                        {kpi.name}
                      </div>
                      {kpi.category && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>
                          {kpi.category}
                        </div>
                      )}
                    </td>

                    {/* Current value */}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {fmtValue(kpi.current_value, kpi.unit)}
                    </td>

                    {/* Target */}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }}>
                      {kpi.target != null ? fmtValue(kpi.target, kpi.unit) : '—'}
                    </td>

                    {/* % to goal */}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {pctToGoal(kpi.current_value, kpi.target)}
                    </td>

                    {/* Delta */}
                    <td style={{ textAlign: 'right' }}>
                      {d == null ? (
                        <span className="text-text-muted" style={{ fontSize: 12 }}>…</span>
                      ) : d.error || d.reason ? (
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>—</span>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: 4,
                            color: dc,
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          <DeltaIcon size={11} />
                          <span>{fmtDelta(delta, kpi.unit)}</span>
                          {deltaPct != null && (
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 400 }}>
                              ({deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%)
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Inline set-target */}
                    <td style={{ textAlign: 'right', paddingRight: 12 }}>
                      <TargetEditor kpi={kpi} onSaved={load} />
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

export default KpiTargets;
