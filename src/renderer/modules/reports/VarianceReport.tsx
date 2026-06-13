import React, { useState, useCallback } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
type VarianceMode = 'yoy' | 'qoq' | 'pop' | 'actual-vs-budget' | 'over-budget';

interface PeriodSummary {
  start: string;
  end: string;
  net_income: number;
  revenue: number;
}

interface PoPResult {
  period_a: PeriodSummary;
  period_b: PeriodSummary;
  delta: number;
  delta_pct: number | null;
  error?: string;
}

interface AvbLine {
  id: string;
  name: string;
  type: string;
  actual: number;
  budget: number;
  variance: number;
  variance_pct: number | null;
}

interface AvbResult {
  analysis_id?: string;
  lines?: AvbLine[];
  period_start?: string;
  period_end?: string;
  error?: string;
}

type RunResult = PoPResult | AvbResult | AvbLine[] | null;

// ─── Helpers ────────────────────────────────────────────
const currentYear = new Date().getFullYear();
const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function pctColor(pct: number | null, mode: 'variance' | 'over-budget' = 'variance'): string {
  if (pct === null) return 'var(--color-text-muted)';
  if (mode === 'over-budget') return pct > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)';
  return pct >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)';
}

function pctLabel(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ─── Period-over-Period table ────────────────────────────
const PoPTable: React.FC<{ data: PoPResult }> = ({ data }) => {
  const metrics: { label: string; key: keyof PeriodSummary }[] = [
    { label: 'Revenue', key: 'revenue' },
    { label: 'Net Income', key: 'net_income' },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="block-table w-full text-sm" style={{ borderRadius: 'var(--app-radius)' }}>
        <thead>
          <tr>
            <th className="text-left px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Metric</th>
            <th className="text-right px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">
              Period A<br />
              <span className="text-[10px] font-normal">{data.period_a.start} → {data.period_a.end}</span>
            </th>
            <th className="text-right px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">
              Period B<br />
              <span className="text-[10px] font-normal">{data.period_b.start} → {data.period_b.end}</span>
            </th>
            <th className="text-right px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Delta</th>
            <th className="text-right px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Delta %</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const valA = data.period_a[m.key] as number;
            const valB = data.period_b[m.key] as number;
            const delta = valA - valB;
            const deltaPct = valB === 0 ? null : ((delta / Math.abs(valB)) * 100);
            return (
              <tr key={m.key}>
                <td className="px-4 py-2 text-text-primary font-medium">{m.label}</td>
                <td className="px-4 py-2 text-right font-mono text-text-primary">{formatCurrency(valA)}</td>
                <td className="px-4 py-2 text-right font-mono text-text-primary">{formatCurrency(valB)}</td>
                <td className="px-4 py-2 text-right font-mono" style={{ color: delta >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}>
                  {formatCurrency(delta)}
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: pctColor(deltaPct) }}>
                  {pctLabel(deltaPct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ─── Actual vs Budget / Over-Budget table ────────────────
const AvbTable: React.FC<{ lines: AvbLine[]; isOverBudget?: boolean }> = ({ lines, isOverBudget }) => {
  if (lines.length === 0) {
    return (
      <p className="text-text-muted text-sm text-center py-10">
        {isOverBudget ? 'No accounts exceed the threshold.' : 'No variance data found for this period.'}
      </p>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="block-table w-full text-sm" style={{ borderRadius: 'var(--app-radius)' }}>
        <thead>
          <tr>
            <th className="text-left px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Account</th>
            <th className="text-left px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Type</th>
            <th className="text-right px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Actual</th>
            <th className="text-right px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Budget</th>
            <th className="text-right px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Variance</th>
            <th className="text-right px-4 py-2 text-text-muted font-semibold text-xs uppercase tracking-wider">Variance %</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-2 text-text-primary font-medium">{l.name}</td>
              <td className="px-4 py-2 text-text-secondary capitalize text-xs">{l.type}</td>
              <td className="px-4 py-2 text-right font-mono text-text-primary">{formatCurrency(l.actual)}</td>
              <td className="px-4 py-2 text-right font-mono text-text-secondary">{formatCurrency(l.budget)}</td>
              <td
                className="px-4 py-2 text-right font-mono"
                style={{ color: l.variance >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}
              >
                {formatCurrency(l.variance)}
              </td>
              <td
                className="px-4 py-2 text-right font-mono font-semibold"
                style={{ color: pctColor(l.variance_pct, isOverBudget ? 'over-budget' : 'variance') }}
              >
                {pctLabel(l.variance_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────
const VarianceReport: React.FC = () => {
  const [mode, setMode] = useState<VarianceMode>('yoy');
  const [year, setYear] = useState<number>(currentYear);
  const [quarter, setQuarter] = useState<number>(currentQuarter);
  const [startA, setStartA] = useState<string>(isoMonthStart());
  const [endA, setEndA] = useState<string>(isoToday());
  const [startB, setStartB] = useState<string>(`${currentYear - 1}-${isoMonthStart().slice(5)}`);
  const [endB, setEndB] = useState<string>(`${currentYear - 1}-${isoToday().slice(5)}`);
  const [avbStart, setAvbStart] = useState<string>(`${currentYear}-01-01`);
  const [avbEnd, setAvbEnd] = useState<string>(isoToday());
  const [threshold, setThreshold] = useState<number>(10);

  const [result, setResult] = useState<RunResult>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let res: RunResult = null;
      if (mode === 'yoy') {
        res = await api.rptVarianceYoy(year) as PoPResult;
      } else if (mode === 'qoq') {
        res = await api.rptVarianceQoq(year, quarter) as PoPResult;
      } else if (mode === 'pop') {
        res = await api.rptVariancePop(startA, endA, startB, endB) as PoPResult;
      } else if (mode === 'actual-vs-budget') {
        res = await api.rptVarianceActualVsBudget(avbStart, avbEnd) as AvbResult;
      } else if (mode === 'over-budget') {
        res = await api.rptVarianceOverBudget(threshold, avbStart, avbEnd) as AvbLine[];
      }
      const anyRes = res as any;
      if (anyRes && anyRes.error) {
        setError(anyRes.error);
      } else {
        setResult(res);
      }
    } catch (e: any) {
      setError(e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [mode, year, quarter, startA, endA, startB, endB, avbStart, avbEnd, threshold]);

  // ─── Render result ─────────────────────────────────────
  function renderResult() {
    if (!result) return null;

    // Period-over-period shape (yoy, qoq, pop)
    const pop = result as PoPResult;
    if (pop.period_a && pop.period_b) {
      return <PoPTable data={pop} />;
    }

    // Actual-vs-budget shape
    const avb = result as AvbResult;
    if (avb.lines) {
      return <AvbTable lines={avb.lines} />;
    }

    // Over-budget shape (raw array)
    if (Array.isArray(result)) {
      return <AvbTable lines={result as AvbLine[]} isOverBudget />;
    }

    return (
      <p className="text-text-muted text-sm text-center py-10">No data returned.</p>
    );
  }

  // ─── Period controls per mode ──────────────────────────
  function renderControls() {
    if (mode === 'yoy') {
      return (
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">Year</label>
          <input
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
            className="block-input w-24 text-sm text-right"
            style={{ borderRadius: 'var(--app-radius)' }}
          />
        </div>
      );
    }
    if (mode === 'qoq') {
      return (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">Year</label>
          <input
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
            className="block-input w-24 text-sm text-right"
            style={{ borderRadius: 'var(--app-radius)' }}
          />
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">Quarter</label>
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
            className="block-input w-20 text-sm"
            style={{ borderRadius: 'var(--app-radius)' }}
          >
            <option value={1}>Q1</option>
            <option value={2}>Q2</option>
            <option value={3}>Q3</option>
            <option value={4}>Q4</option>
          </select>
        </div>
      );
    }
    if (mode === 'pop') {
      return (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">Period A</span>
          <input type="date" value={startA} onChange={(e) => setStartA(e.target.value)} className="block-input text-sm" style={{ borderRadius: 'var(--app-radius)' }} />
          <span className="text-xs text-text-muted">to</span>
          <input type="date" value={endA} onChange={(e) => setEndA(e.target.value)} className="block-input text-sm" style={{ borderRadius: 'var(--app-radius)' }} />
          <span className="text-xs text-text-muted font-semibold uppercase tracking-wider ml-2">Period B</span>
          <input type="date" value={startB} onChange={(e) => setStartB(e.target.value)} className="block-input text-sm" style={{ borderRadius: 'var(--app-radius)' }} />
          <span className="text-xs text-text-muted">to</span>
          <input type="date" value={endB} onChange={(e) => setEndB(e.target.value)} className="block-input text-sm" style={{ borderRadius: 'var(--app-radius)' }} />
        </div>
      );
    }
    if (mode === 'actual-vs-budget' || mode === 'over-budget') {
      return (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">Period</label>
          <input type="date" value={avbStart} onChange={(e) => setAvbStart(e.target.value)} className="block-input text-sm" style={{ borderRadius: 'var(--app-radius)' }} />
          <span className="text-xs text-text-muted">to</span>
          <input type="date" value={avbEnd} onChange={(e) => setAvbEnd(e.target.value)} className="block-input text-sm" style={{ borderRadius: 'var(--app-radius)' }} />
          {mode === 'over-budget' && (
            <>
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider ml-2">Threshold %</label>
              <input
                type="number"
                value={threshold}
                min={0}
                max={1000}
                step={5}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="block-input w-20 text-sm text-right"
                style={{ borderRadius: 'var(--app-radius)' }}
              />
            </>
          )}
        </div>
      );
    }
    return null;
  }

  const modeLabels: Record<VarianceMode, string> = {
    'yoy': 'Year-over-Year',
    'qoq': 'Quarter-over-Quarter',
    'pop': 'Period-over-Period',
    'actual-vs-budget': 'Actual vs Budget',
    'over-budget': 'Over-Budget Accounts',
  };

  return (
    <div className="space-y-4">
      {/* Control bar */}
      <div
        className="block-card p-4 flex items-center gap-4 flex-wrap"
        style={{ borderRadius: 'var(--app-radius)' }}
      >
        {/* Mode selector */}
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider whitespace-nowrap">Mode</label>
          <select
            value={mode}
            onChange={(e) => { setMode(e.target.value as VarianceMode); setResult(null); setError(null); }}
            className="block-input text-sm"
            style={{ borderRadius: 'var(--app-radius)' }}
          >
            {(Object.keys(modeLabels) as VarianceMode[]).map((m) => (
              <option key={m} value={m}>{modeLabels[m]}</option>
            ))}
          </select>
        </div>

        {/* Period inputs */}
        {renderControls()}

        {/* Run button */}
        <button
          onClick={run}
          disabled={loading}
          className="block-btn text-sm font-semibold px-5 py-2 shrink-0 ml-auto"
          style={{ borderRadius: 'var(--app-radius)' }}
        >
          {loading ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="block-card p-4 text-sm font-medium"
          style={{ borderRadius: 'var(--app-radius)', color: 'var(--color-accent-expense)', borderColor: 'var(--color-accent-expense)' }}
        >
          Error: {error}
        </div>
      )}

      {/* Results */}
      {!loading && !error && result && (
        <div className="block-card" style={{ borderRadius: 'var(--app-radius)' }}>
          <div className="px-4 py-3 border-b border-border-primary">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              {modeLabels[mode]}
            </span>
          </div>
          <div className="p-4">
            {renderResult()}
          </div>
        </div>
      )}

      {/* Empty — not yet run */}
      {!loading && !error && !result && (
        <div
          className="block-card p-10 text-center text-text-muted text-sm"
          style={{ borderRadius: 'var(--app-radius)' }}
        >
          Select a variance mode, configure the period, and click <strong className="text-text-secondary">Run</strong>.
        </div>
      )}
    </div>
  );
};

export default VarianceReport;
