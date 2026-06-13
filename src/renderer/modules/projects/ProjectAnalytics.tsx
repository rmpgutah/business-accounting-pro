import React, { useState, useEffect } from 'react';
import {
  TrendingUp, AlertTriangle, DollarSign, BarChart2, Clock, Percent,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Return-shape types (match sw service row shapes exactly) ─────────────────

interface ProfitRow {
  id: string;
  name: string;
  budget: number;
  status: string;
  expenses: number;
  revenue: number;
}

interface BurnRow {
  id: string;
  name: string;
  budget: number;
  spent: number;
  burn_pct: number | null;
}

interface OverBudgetRow {
  id: string;
  name: string;
  budget: number;
  spent: number;
}

interface UnbilledRow {
  id: string;
  project_name: string | null;
  employee_name: string | null;
  hours: number | null;
  date: string | null;
}

// ─── Loading skeleton helper ──────────────────────────────────────────────────

const SectionLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className="block-card p-6 flex items-center justify-center text-text-muted text-sm font-mono" style={{ borderRadius: 'var(--app-radius)' }}>
    {label}
  </div>
);

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <p className="text-xs text-text-muted py-4 text-center">{message}</p>
);

// ─── KPI Strip ───────────────────────────────────────────────────────────────

interface KpiData {
  totalMargin: number;
  totalRevenue: number;
  totalExpenses: number;
  overBudgetCount: number;
  unbilledCount: number;
  burnProjects: number;
}

const KpiStrip: React.FC<{ kpi: KpiData }> = ({ kpi }) => {
  const marginColor =
    kpi.totalMargin >= 20
      ? 'text-accent-income'
      : kpi.totalMargin >= 0
      ? 'text-accent-warning'
      : 'text-accent-expense';

  const items = [
    {
      label: 'Total Revenue',
      value: formatCurrency(kpi.totalRevenue),
      icon: <DollarSign size={15} />,
      color: 'text-accent-income',
    },
    {
      label: 'Total Expenses',
      value: formatCurrency(kpi.totalExpenses),
      icon: <DollarSign size={15} />,
      color: 'text-accent-expense',
    },
    {
      label: 'Overall Margin',
      value: `${kpi.totalMargin.toFixed(1)}%`,
      icon: <Percent size={15} />,
      color: marginColor,
    },
    {
      label: 'Over Budget',
      value: String(kpi.overBudgetCount),
      icon: <AlertTriangle size={15} />,
      color: kpi.overBudgetCount > 0 ? 'text-accent-expense' : 'text-text-muted',
    },
    {
      label: 'Burn Tracked',
      value: String(kpi.burnProjects),
      icon: <BarChart2 size={15} />,
      color: 'text-accent-blue',
    },
    {
      label: 'Unbilled Entries',
      value: String(kpi.unbilledCount),
      icon: <Clock size={15} />,
      color: kpi.unbilledCount > 0 ? 'text-accent-warning' : 'text-text-muted',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map((k) => (
        <div key={k.label} className="block-card p-3" style={{ borderRadius: 'var(--app-radius)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={k.color}>{k.icon}</span>
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider leading-tight">
              {k.label}
            </span>
          </div>
          <div className={`text-lg font-bold font-mono ${k.color}`}>{k.value}</div>
        </div>
      ))}
    </div>
  );
};

// ─── Project Profitability Section ────────────────────────────────────────────

const ProfitabilitySection: React.FC = () => {
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.swProjectProfitability();
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load profitability');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <SectionLoading label="Loading profitability..." />;

  return (
    <div className="block-card overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center gap-2">
        <TrendingUp size={14} className="text-accent-income" />
        <h3 className="text-sm font-bold text-text-primary">Project Profitability</h3>
        <span className="ml-auto text-[10px] text-text-muted font-mono">{rows.length} projects</span>
      </div>
      {error && (
        <div className="text-xs text-accent-expense px-4 py-2">{error}</div>
      )}
      {rows.length === 0 && !error ? (
        <div className="px-4 py-4">
          <EmptyState message="No project profitability data found." />
        </div>
      ) : (
        <table className="block-table w-full text-xs">
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th className="text-right">Budget</th>
              <th className="text-right">Revenue</th>
              <th className="text-right">Expenses</th>
              <th className="text-right">Profit</th>
              <th className="text-right">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rev = Number(r.revenue) || 0;
              const exp = Number(r.expenses) || 0;
              const profit = rev - exp;
              const margin = rev > 0 ? (profit / rev) * 100 : 0;
              const isProfit = profit >= 0;
              return (
                <tr key={r.id}>
                  <td className="text-text-primary font-medium">{r.name}</td>
                  <td className="text-text-secondary capitalize">{r.status}</td>
                  <td className="text-right font-mono text-text-secondary">
                    {formatCurrency(r.budget)}
                  </td>
                  <td className="text-right font-mono text-accent-income">
                    {formatCurrency(rev)}
                  </td>
                  <td className="text-right font-mono text-accent-expense">
                    {formatCurrency(exp)}
                  </td>
                  <td
                    className={`text-right font-mono font-bold ${
                      isProfit ? 'text-accent-income' : 'text-accent-expense'
                    }`}
                  >
                    {formatCurrency(profit)}
                  </td>
                  <td
                    className={`text-right font-mono font-bold ${
                      margin >= 20
                        ? 'text-accent-income'
                        : margin >= 0
                        ? 'text-accent-warning'
                        : 'text-accent-expense'
                    }`}
                  >
                    {margin.toFixed(1)}%
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

// ─── Burn vs Budget Section ───────────────────────────────────────────────────

const BurnSection: React.FC = () => {
  const [rows, setRows] = useState<BurnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.swProjectBurn();
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load burn data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <SectionLoading label="Loading burn data..." />;

  return (
    <div className="block-card overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center gap-2">
        <BarChart2 size={14} className="text-accent-warning" />
        <h3 className="text-sm font-bold text-text-primary">Burn vs Budget</h3>
        <span className="ml-auto text-[10px] text-text-muted font-mono">
          {rows.length} projects with budget
        </span>
      </div>
      {error && (
        <div className="text-xs text-accent-expense px-4 py-2">{error}</div>
      )}
      {rows.length === 0 && !error ? (
        <div className="px-4 py-4">
          <EmptyState message="No projects with budgets found." />
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {rows.map((r) => {
            const burnPct = Number(r.burn_pct) || 0;
            const isOver = burnPct >= 100;
            const isWarning = burnPct >= 80 && !isOver;
            const barColor = isOver
              ? 'var(--color-accent-expense)'
              : isWarning
              ? 'var(--color-accent-warning)'
              : 'var(--color-accent-income)';
            const pctLabel = `${Math.min(burnPct, 999).toFixed(1)}%`;

            return (
              <div key={r.id}>
                <div className="flex items-center justify-between text-xs mb-1 gap-2">
                  <span
                    className="text-text-primary font-medium truncate max-w-[240px]"
                    title={r.name}
                  >
                    {r.name}
                  </span>
                  <div className="flex items-center gap-3 shrink-0 font-mono text-text-secondary">
                    <span>{formatCurrency(Number(r.spent) || 0)}</span>
                    <span className="text-text-muted">/</span>
                    <span>{formatCurrency(Number(r.budget) || 0)}</span>
                    <span
                      className={`font-bold w-14 text-right ${
                        isOver
                          ? 'text-accent-expense'
                          : isWarning
                          ? 'text-accent-warning'
                          : 'text-accent-income'
                      }`}
                    >
                      {pctLabel}
                    </span>
                  </div>
                </div>
                <div
                  className="w-full h-2 bg-bg-tertiary overflow-hidden"
                  style={{ borderRadius: 'var(--app-radius)' }}
                >
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.min(burnPct, 100)}%`,
                      backgroundColor: barColor,
                      borderRadius: 'var(--app-radius)',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Over-Budget Worklist ─────────────────────────────────────────────────────

const OverBudgetSection: React.FC = () => {
  const [rows, setRows] = useState<OverBudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.swOverBudgetProjects();
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load over-budget projects');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <SectionLoading label="Loading over-budget projects..." />;

  return (
    <div className="block-card overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center gap-2">
        <AlertTriangle size={14} className="text-accent-expense" />
        <h3 className="text-sm font-bold text-text-primary">Over-Budget Projects</h3>
        {rows.length > 0 && (
          <span
            className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded text-white"
            style={{ backgroundColor: 'var(--color-accent-expense)', borderRadius: 'var(--app-radius)' }}
          >
            {rows.length}
          </span>
        )}
      </div>
      {error && (
        <div className="text-xs text-accent-expense px-4 py-2">{error}</div>
      )}
      {rows.length === 0 && !error ? (
        <div className="px-4 py-4">
          <EmptyState message="No over-budget projects. Great job!" />
        </div>
      ) : (
        <table className="block-table w-full text-xs">
          <thead>
            <tr>
              <th>Project</th>
              <th className="text-right">Budget</th>
              <th className="text-right">Spent</th>
              <th className="text-right">Overage</th>
              <th className="text-right">Over %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const budget = Number(r.budget) || 0;
              const spent = Number(r.spent) || 0;
              const overage = spent - budget;
              const overPct = budget > 0 ? (overage / budget) * 100 : 0;
              return (
                <tr key={r.id}>
                  <td className="text-text-primary font-medium">{r.name}</td>
                  <td className="text-right font-mono text-text-secondary">
                    {formatCurrency(budget)}
                  </td>
                  <td className="text-right font-mono text-accent-expense">
                    {formatCurrency(spent)}
                  </td>
                  <td className="text-right font-mono font-bold text-accent-expense">
                    +{formatCurrency(overage)}
                  </td>
                  <td className="text-right font-mono font-bold text-accent-expense">
                    +{overPct.toFixed(1)}%
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

// ─── Unbilled Time Section ────────────────────────────────────────────────────

const UnbilledTimeSection: React.FC = () => {
  const [rows, setRows] = useState<UnbilledRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.swUnbilledTime();
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load unbilled time');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <SectionLoading label="Loading unbilled time..." />;

  const totalHours = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0);

  return (
    <div className="block-card overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center gap-2">
        <Clock size={14} className="text-accent-warning" />
        <h3 className="text-sm font-bold text-text-primary">Unbilled Time Entries</h3>
        {rows.length > 0 && (
          <span className="ml-auto text-[10px] text-text-muted font-mono">
            {totalHours.toFixed(1)}h across {rows.length} entries
          </span>
        )}
      </div>
      {error && (
        <div className="text-xs text-accent-expense px-4 py-2">{error}</div>
      )}
      {rows.length === 0 && !error ? (
        <div className="px-4 py-4">
          <EmptyState message="No unbilled time entries." />
        </div>
      ) : (
        <table className="block-table w-full text-xs">
          <thead>
            <tr>
              <th>Project</th>
              <th>Employee</th>
              <th>Date</th>
              <th className="text-right">Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="text-text-primary font-medium">{r.project_name || '—'}</td>
                <td className="text-text-secondary">{r.employee_name || '—'}</td>
                <td className="text-text-secondary font-mono">{formatDate(r.date)}</td>
                <td className="text-right font-mono text-accent-warning font-bold">
                  {(Number(r.hours) || 0).toFixed(2)}h
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── Root: ProjectAnalytics ───────────────────────────────────────────────────

const ProjectAnalytics: React.FC = () => {
  // KPI aggregates from profitability + over-budget + burn + unbilled loads
  const [profitRows, setProfitRows] = useState<ProfitRow[]>([]);
  const [overBudgetRows, setOverBudgetRows] = useState<OverBudgetRow[]>([]);
  const [burnRows, setBurnRows] = useState<BurnRow[]>([]);
  const [unbilledRows, setUnbilledRows] = useState<UnbilledRow[]>([]);

  // Silently load all four datasets for KPI strip (each section also loads independently)
  useEffect(() => {
    let cancelled = false;
    const loadProfit = async () => {
      try {
        const d = await api.swProjectProfitability();
        if (!cancelled) setProfitRows(Array.isArray(d) ? d : []);
      } catch { /* swallowed — section shows its own error */ }
    };
    const loadOverBudget = async () => {
      try {
        const d = await api.swOverBudgetProjects();
        if (!cancelled) setOverBudgetRows(Array.isArray(d) ? d : []);
      } catch { /* swallowed */ }
    };
    const loadBurn = async () => {
      try {
        const d = await api.swProjectBurn();
        if (!cancelled) setBurnRows(Array.isArray(d) ? d : []);
      } catch { /* swallowed */ }
    };
    const loadUnbilled = async () => {
      try {
        const d = await api.swUnbilledTime();
        if (!cancelled) setUnbilledRows(Array.isArray(d) ? d : []);
      } catch { /* swallowed */ }
    };
    loadProfit();
    loadOverBudget();
    loadBurn();
    loadUnbilled();
    return () => { cancelled = true; };
  }, []);

  // Derive KPI values from loaded data
  const totalRevenue = profitRows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const totalExpenses = profitRows.reduce((s, r) => s + (Number(r.expenses) || 0), 0);
  const totalMargin = totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0;

  const kpi: KpiData = {
    totalRevenue,
    totalExpenses,
    totalMargin,
    overBudgetCount: overBudgetRows.length,
    burnProjects: burnRows.length,
    unbilledCount: unbilledRows.length,
  };

  return (
    <div className="p-6 space-y-5">
      {/* KPI strip */}
      <KpiStrip kpi={kpi} />

      {/* Profitability table */}
      <ProfitabilitySection />

      {/* Burn vs Budget bar rows */}
      <BurnSection />

      {/* Over-budget worklist */}
      <OverBudgetSection />

      {/* Unbilled time */}
      <UnbilledTimeSection />
    </div>
  );
};

export default ProjectAnalytics;
