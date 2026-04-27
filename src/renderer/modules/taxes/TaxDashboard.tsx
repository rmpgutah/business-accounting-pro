import React, { useEffect, useState, useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronDown,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface DashboardData {
  ytd_payroll: number;
  ytd_federal: number;
  ytd_state: number;
  ytd_fica: number;
  py_payroll: number;
  filings: Array<{
    form_type: string;
    quarter: number;
    status: string;
    filed_date?: string;
  }>;
  quarters: Array<{
    quarter: number;
    federal: number;
    state: number;
    fica: number;
  }>;
}

interface Deadline {
  form: string;
  label: string;
  quarter?: number;
  dueDate: Date;
  daysUntil: number;
  status: 'filed' | 'not_filed' | 'overdue';
}

// ─── Due date computation ───────────────────────────────
function computeDeadlines(year: number, filings: DashboardData['filings']): Deadline[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const quarterDueDates: { q: number; month: number; day: number; year: number }[] = [
    { q: 1, month: 3, day: 30, year },     // Apr 30
    { q: 2, month: 6, day: 31, year },     // Jul 31
    { q: 3, month: 9, day: 31, year },     // Oct 31
    { q: 4, month: 0, day: 31, year: year + 1 }, // Jan 31 next year
  ];

  const deadlines: Deadline[] = [];

  // 941 / TC-941 / SUI per quarter
  for (const { q, month, day, year: dueYear } of quarterDueDates) {
    const due = new Date(dueYear, month, day);
    const daysUntil = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);

    for (const form of ['941', 'TC-941', 'SUI'] as const) {
      const filing = filings.find((f) => f.form_type === form && f.quarter === q);
      const status: Deadline['status'] =
        filing?.status === 'filed' ? 'filed' : daysUntil < 0 ? 'overdue' : 'not_filed';

      deadlines.push({
        form,
        label: form === '941' ? 'Federal 941' : form === 'TC-941' ? 'Utah TC-941' : 'Utah SUI',
        quarter: q,
        dueDate: due,
        daysUntil,
        status,
      });
    }
  }

  // 940 (FUTA) - Jan 31 of following year
  const futaDue = new Date(year + 1, 0, 31);
  const futaDays = Math.ceil((futaDue.getTime() - today.getTime()) / 86_400_000);
  const futaFiling = filings.find((f) => f.form_type === '940');
  deadlines.push({
    form: '940',
    label: 'FUTA 940',
    dueDate: futaDue,
    daysUntil: futaDays,
    status: futaFiling?.status === 'filed' ? 'filed' : futaDays < 0 ? 'overdue' : 'not_filed',
  });

  // W-2 / W-3 - Jan 31 of following year
  const w2Due = new Date(year + 1, 0, 31);
  const w2Days = Math.ceil((w2Due.getTime() - today.getTime()) / 86_400_000);
  const w2Filing = filings.find((f) => f.form_type === 'W-2');
  const w3Filing = filings.find((f) => f.form_type === 'W-3');
  deadlines.push({
    form: 'W-2',
    label: 'W-2 (Employees)',
    dueDate: w2Due,
    daysUntil: w2Days,
    status: w2Filing?.status === 'filed' ? 'filed' : w2Days < 0 ? 'overdue' : 'not_filed',
  });
  deadlines.push({
    form: 'W-3',
    label: 'W-3 (Transmittal)',
    dueDate: w2Due,
    daysUntil: w2Days,
    status: w3Filing?.status === 'filed' ? 'filed' : w2Days < 0 ? 'overdue' : 'not_filed',
  });

  return deadlines;
}

// ─── KPI Card ───────────────────────────────────────────
const KPICard: React.FC<{
  label: string;
  value: number;
  subtitle?: string;
  borderColor: string;
}> = ({ label, value, subtitle, borderColor }) => (
  <div
    className={`block-card p-4 border-l-2 ${borderColor}`}
    style={{ borderRadius: '6px' }}
  >
    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
      {label}
    </span>
    <p className="text-2xl font-mono text-text-primary mt-1">{formatCurrency(value)}</p>
    {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
  </div>
);

// ─── Component ──────────────────────────────────────────
const TaxDashboard: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  useEffect(() => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    api
      .taxDashboardSummary(year)
      .then((d) => setData(d))
      .catch((err) => {
        console.error('Failed to load tax dashboard:', err);
        setError(err?.message || 'Failed to load tax dashboard data');
      })
      .finally(() => setLoading(false));
  }, [activeCompany, year]);

  // Upcoming deadlines
  const deadlines = useMemo(() => {
    if (!data) return [];
    return computeDeadlines(year, data.filings);
  }, [data, year]);

  // Filter to unfiled/overdue and sort by most urgent
  const upcomingDeadlines = useMemo(
    () =>
      deadlines
        .filter((d) => d.status !== 'filed')
        .sort((a, b) => a.daysUntil - b.daysUntil)
        .slice(0, 8),
    [deadlines]
  );

  // Quarterly chart data
  const quarterlyMax = useMemo(() => {
    if (!data?.quarters) return 1;
    return Math.max(
      ...data.quarters.map((q) => q.federal + q.state + q.fica),
      1
    );
  }, [data]);

  // Filing status grid forms
  const FORM_TYPES = ['941', 'TC-941', 'SUI', '940', 'W-2', 'W-3'];
  const QUARTERS = [1, 2, 3, 4];

  const getFilingStatus = (form: string, quarter: number): string => {
    if (!data?.filings) return 'not_filed';
    const filing = data.filings.find(
      (f) => f.form_type === form && f.quarter === quarter
    );
    return filing?.status || 'not_filed';
  };

  const yearRange = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(y);
    return years;
  }, [currentYear]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading tax dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <ErrorBanner message={error} title="Dashboard Error" onDismiss={() => setError('')} />
      )}

      {/* Year selector */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Tax Year
        </span>
        <div className="relative">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="block-select text-sm pr-8"
            style={{ borderRadius: '6px' }}
          >
            {yearRange.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          label="YTD Payroll"
          value={data?.ytd_payroll ?? 0}
          borderColor="border-l-accent-blue"
          subtitle={
            data && data.py_payroll > 0
              ? `vs PY: ${formatCurrency(data.py_payroll)}`
              : undefined
          }
        />
        <KPICard
          label="YTD Federal Tax"
          value={data?.ytd_federal ?? 0}
          borderColor="border-l-accent-expense"
        />
        <KPICard
          label="YTD State Tax"
          value={data?.ytd_state ?? 0}
          borderColor="border-l-accent-warning"
        />
        <KPICard
          label="YTD FICA"
          value={data?.ytd_fica ?? 0}
          borderColor="border-l-accent-income"
        />
      </div>

      {/* Upcoming Deadlines */}
      {upcomingDeadlines.length > 0 && (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="px-5 py-4 border-b border-border-primary">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Upcoming Deadlines
            </h3>
          </div>
          <div className="divide-y divide-border-primary">
            {upcomingDeadlines.map((d, i) => {
              const urgent = d.daysUntil <= 7;
              const warning = d.daysUntil > 7 && d.daysUntil <= 30;
              const colorClass = d.status === 'overdue'
                ? 'text-accent-expense'
                : urgent
                  ? 'text-accent-expense'
                  : warning
                    ? 'text-accent-warning'
                    : 'text-text-muted';

              return (
                <div key={`${d.form}-${d.quarter ?? 'annual'}-${i}`} className="px-5 py-3 flex items-center gap-4">
                  <div className="flex-1">
                    <span className="text-sm font-medium text-text-primary">{d.label}</span>
                    {d.quarter && (
                      <span className="text-xs text-text-muted ml-2">Q{d.quarter}</span>
                    )}
                  </div>
                  <span className="text-xs font-mono text-text-secondary">
                    {formatDate(d.dueDate.toISOString().slice(0, 10))}
                  </span>
                  <span className={`text-xs font-semibold ${colorClass} min-w-[80px] text-right`}>
                    {d.status === 'overdue' ? (
                      <span className="inline-flex items-center gap-1">
                        <AlertTriangle size={12} /> Overdue
                      </span>
                    ) : (
                      `${d.daysUntil}d remaining`
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quarterly Tax Liability Bar Chart */}
      <div className="grid grid-cols-2 gap-4">
        <div className="block-card p-5" style={{ borderRadius: '6px' }}>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Quarterly Tax Liability
          </h3>
          <div className="flex items-end gap-3 h-48">
            {(data?.quarters ?? []).map((q) => {
              const total = q.federal + q.state + q.fica;
              const pct = total / quarterlyMax;
              const fedPct = total > 0 ? (q.federal / total) * 100 : 0;
              const statePct = total > 0 ? (q.state / total) * 100 : 0;
              const ficaPct = total > 0 ? (q.fica / total) * 100 : 0;
              return (
                <div key={q.quarter} className="flex-1 flex flex-col items-center gap-2">
                  <div
                    className="w-full flex flex-col justify-end overflow-hidden"
                    style={{
                      height: `${Math.max(pct * 100, 4)}%`,
                      borderRadius: '4px 4px 0 0',
                      minHeight: '8px',
                    }}
                  >
                    <div
                      style={{
                        height: `${ficaPct}%`,
                        background: 'var(--color-accent-income)',
                        minHeight: ficaPct > 0 ? '3px' : 0,
                      }}
                    />
                    <div
                      style={{
                        height: `${statePct}%`,
                        background: 'var(--color-accent-warning)',
                        minHeight: statePct > 0 ? '3px' : 0,
                      }}
                    />
                    <div
                      style={{
                        height: `${fedPct}%`,
                        background: 'var(--color-accent-expense)',
                        minHeight: fedPct > 0 ? '3px' : 0,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-text-muted">
                    Q{q.quarter}
                  </span>
                  <span className="text-[10px] font-mono text-text-secondary">
                    {formatCurrency(total)}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border-primary">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3" style={{ background: 'var(--color-accent-expense)', borderRadius: '6px' }} />
              <span className="text-[10px] text-text-muted">Federal</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3" style={{ background: 'var(--color-accent-warning)', borderRadius: '6px' }} />
              <span className="text-[10px] text-text-muted">State</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3" style={{ background: 'var(--color-accent-income)', borderRadius: '6px' }} />
              <span className="text-[10px] text-text-muted">FICA</span>
            </div>
          </div>
        </div>

        {/* Filing Status Grid */}
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="px-5 py-4 border-b border-border-primary">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Filing Status
            </h3>
          </div>
          <table className="block-table">
            <thead>
              <tr>
                <th>Form</th>
                {QUARTERS.map((q) => (
                  <th key={q} className="text-center">
                    Q{q}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FORM_TYPES.map((form) => {
                const isAnnual = ['940', 'W-2', 'W-3'].includes(form);
                return (
                  <tr key={form}>
                    <td className="text-sm font-medium text-text-primary">{form}</td>
                    {QUARTERS.map((q) => {
                      if (isAnnual && q < 4) {
                        return (
                          <td key={q} className="text-center">
                            <span className="text-[10px] text-text-muted">--</span>
                          </td>
                        );
                      }
                      if (isAnnual && q === 4) {
                        const status = getFilingStatus(form, 0);
                        return (
                          <td key={q} className="text-center">
                            <FilingBadge status={status} />
                          </td>
                        );
                      }
                      const status = getFilingStatus(form, q);
                      return (
                        <td key={q} className="text-center">
                          <FilingBadge status={status} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Filing Status Badge ────────────────────────────────
const FilingBadge: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'filed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-income">
        <CheckCircle size={11} /> Filed
      </span>
    );
  }
  if (status === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-expense">
        <AlertTriangle size={11} /> Overdue
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted">
      <Clock size={11} /> Pending
    </span>
  );
};

export default TaxDashboard;
