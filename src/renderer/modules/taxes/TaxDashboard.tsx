import React, { useEffect, useState, useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronDown,
  Users,
  Calculator,
  BarChart3,
  Calendar,
  Percent,
  Activity,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, percentChange } from '../../lib/format';
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

interface WageBaseEmployee {
  employee_id: string;
  ytd_gross: number;
}

interface QuickCalcResult {
  federal: number;
  ss: number;
  medicare: number;
  total: number;
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

// ─── Rate Card ──────────────────────────────────────────
const RateCard: React.FC<{
  label: string;
  value: number | null;
  color: string;
}> = ({ label, value, color }) => (
  <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{label}</div>
    <div className={`text-xl font-mono font-bold ${color} mt-1`}>
      {value != null && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—'}
    </div>
  </div>
);

// ─── Progress Bar ───────────────────────────────────────
const WageBaseBar: React.FC<{
  label: string;
  used: number;
  cap: number;
  statusLabel: string;
}> = ({ label, used, cap, statusLabel }) => {
  const pctUsed = cap > 0 ? Math.min((used / cap) * 100, 100) : 0;
  const exhausted = used >= cap;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-primary">{label}</span>
        <span className={`text-[10px] font-semibold ${exhausted ? 'text-accent-income' : 'text-text-muted'}`}>
          {statusLabel}
        </span>
      </div>
      <div className="w-full h-2 bg-bg-tertiary" style={{ borderRadius: '6px' }}>
        <div
          className={exhausted ? 'bg-accent-income' : 'bg-accent-blue'}
          style={{ width: `${pctUsed}%`, height: '100%', borderRadius: '6px', transition: 'width 0.3s' }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span>{formatCurrency(used)} / {formatCurrency(cap)}</span>
        <span>{pctUsed.toFixed(1)}%</span>
      </div>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const TaxDashboard: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  // Additional data states
  const [wageBaseEmployees, setWageBaseEmployees] = useState<WageBaseEmployee[]>([]);
  const [activeEmployeeCount, setActiveEmployeeCount] = useState(0);
  const [pyTaxes, setPyTaxes] = useState(0);
  const [revenue, setRevenue] = useState(0);

  // Quick calculator state
  const [calcGross, setCalcGross] = useState('');
  const [calcFiling, setCalcFiling] = useState('single');
  const [calcResult, setCalcResult] = useState<QuickCalcResult | null>(null);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');

    const companyId = activeCompany.id;
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const pyStart = `${year - 1}-01-01`;
    const pyEnd = `${year - 1}-12-31`;

    Promise.all([
      api.taxDashboardSummary(year),
      // Wage base tracking — per-employee YTD gross
      api.rawQuery(
        `SELECT ps.employee_id, COALESCE(SUM(ps.gross_pay), 0) as ytd_gross
         FROM pay_stubs ps JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
         WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
         GROUP BY ps.employee_id`,
        [companyId, yearStart, yearEnd]
      ).catch(() => []),
      // Active employee count
      api.rawQuery(
        `SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND status = 'active'`,
        [companyId]
      ).catch(() => [{ count: 0 }]),
      // Prior year total taxes
      api.rawQuery(
        `SELECT COALESCE(SUM(ps.federal_tax + ps.state_tax + ps.social_security + ps.medicare), 0) as py_taxes
         FROM pay_stubs ps JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
         WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?`,
        [companyId, pyStart, pyEnd]
      ).catch(() => [{ py_taxes: 0 }]),
      // Revenue (from invoices if available)
      api.rawQuery(
        `SELECT COALESCE(SUM(total), 0) as total_revenue FROM invoices
         WHERE company_id = ? AND issue_date >= ? AND issue_date <= ? AND status != 'void'`,
        [companyId, yearStart, yearEnd]
      ).catch(() => [{ total_revenue: 0 }]),
    ])
      .then(([dashData, wbRows, empRows, pyRows, revRows]) => {
        setData(dashData);
        setWageBaseEmployees(wbRows || []);
        setActiveEmployeeCount((empRows && empRows[0]?.count) || 0);
        setPyTaxes((pyRows && pyRows[0]?.py_taxes) || 0);
        setRevenue((revRows && revRows[0]?.total_revenue) || 0);
      })
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

  // Overdue check for alert banner
  const overdueDeadlines = useMemo(
    () => deadlines.filter((d) => d.status === 'overdue'),
    [deadlines]
  );

  // Next 4 deadlines for calendar
  const nextDeadlines = useMemo(
    () =>
      deadlines
        .filter((d) => d.status !== 'filed')
        .sort((a, b) => a.daysUntil - b.daysUntil)
        .slice(0, 4),
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

  // ─── Computed metrics ───────────────────────────────────
  const ytdPayroll = data?.ytd_payroll ?? 0;
  const ytdFederal = data?.ytd_federal ?? 0;
  const ytdState = data?.ytd_state ?? 0;
  const ytdFica = data?.ytd_fica ?? 0;
  const ytdTotalTax = ytdFederal + ytdState + ytdFica;

  // Rate cards
  const taxBurdenPct = ytdPayroll > 0 ? (ytdTotalTax / ytdPayroll) * 100 : null;
  const fedEffRate = ytdPayroll > 0 ? (ytdFederal / ytdPayroll) * 100 : null;
  const stateEffRate = ytdPayroll > 0 ? (ytdState / ytdPayroll) * 100 : null;
  const ficaRate = ytdPayroll > 0 ? (ytdFica / ytdPayroll) * 100 : null;

  // Forecast: average completed quarters and project
  const forecast = useMemo(() => {
    const qs = data?.quarters ?? [];
    const completed = qs.filter((q) => q.federal + q.state + q.fica > 0);
    if (completed.length === 0) return { fed: 0, state: 0, schedule: 'Monthly' };

    const avgFed = completed.reduce((s, q) => s + q.federal, 0) / completed.length;
    const avgState = completed.reduce((s, q) => s + q.state, 0) / completed.length;
    const avgFica = completed.reduce((s, q) => s + q.fica, 0) / completed.length;

    // Cumulative 941 tax determines deposit schedule: < $50k lookback = Monthly
    const cumulative = completed.reduce((s, q) => s + q.federal + q.fica, 0);
    const schedule = cumulative < 50000 ? 'Monthly' : 'Semi-Weekly';

    return { fed: avgFed, state: avgState, fica: avgFica, schedule };
  }, [data]);

  // Wage base tracking constants (2026)
  const SS_CAP = 182100;
  const MEDICARE_SURTAX_THRESHOLD = 200000;
  const FUTA_CAP = 7000;

  const wageBaseSummary = useMemo(() => {
    const emps = wageBaseEmployees;
    if (emps.length === 0) return { avgGross: 0, ssExhausted: 0, medicareOver: 0, futaExhausted: 0, count: 0 };

    const avgGross = emps.reduce((s, e) => s + e.ytd_gross, 0) / emps.length;
    const ssExhausted = emps.filter((e) => e.ytd_gross >= SS_CAP).length;
    const medicareOver = emps.filter((e) => e.ytd_gross >= MEDICARE_SURTAX_THRESHOLD).length;
    const futaExhausted = emps.filter((e) => e.ytd_gross >= FUTA_CAP).length;

    return { avgGross, ssExhausted, medicareOver, futaExhausted, count: emps.length };
  }, [wageBaseEmployees]);

  // Year-over-year comparison
  const yoyComparison = useMemo(() => {
    const cyTax = ytdTotalTax;
    const pyTax = pyTaxes;
    const changeDollar = cyTax - pyTax;
    const changePct = percentChange(cyTax, pyTax);

    const cyPayroll = ytdPayroll;
    const pyPayrollVal = data?.py_payroll ?? 0;
    const payrollChangeDollar = cyPayroll - pyPayrollVal;
    const payrollChangePct = percentChange(cyPayroll, pyPayrollVal);

    return { cyTax, pyTax, changeDollar, changePct, cyPayroll, pyPayrollVal, payrollChangeDollar, payrollChangePct };
  }, [ytdTotalTax, pyTaxes, ytdPayroll, data]);

  // Employer tax cost: employer pays matching FICA (SS 6.2% + Medicare 1.45%) + FUTA
  const employerTaxCost = useMemo(() => {
    // Approximate employer cost = matching FICA + FUTA
    return ytdFica + wageBaseEmployees.reduce((s, e) => s + Math.min(e.ytd_gross, FUTA_CAP) * 0.006, 0);
  }, [ytdFica, wageBaseEmployees]);

  const avgTaxPerEmployee = activeEmployeeCount > 0 ? ytdTotalTax / activeEmployeeCount : 0;
  const taxAsRevenuePct = revenue > 0 ? (ytdTotalTax / revenue) * 100 : null;

  // Filing compliance score
  const complianceScore = useMemo(() => {
    const allFilings = deadlines.filter((d) => d.daysUntil < 0 || d.status === 'filed');
    if (allFilings.length === 0) return null;
    const filed = allFilings.filter((d) => d.status === 'filed').length;
    return (filed / allFilings.length) * 100;
  }, [deadlines]);

  // Quarterly growth rates
  const quarterlyGrowth = useMemo(() => {
    const qs = data?.quarters ?? [];
    return qs.map((q, i) => {
      if (i === 0) return null;
      const prev = qs[i - 1].federal + qs[i - 1].state + qs[i - 1].fica;
      const curr = q.federal + q.state + q.fica;
      return percentChange(curr, prev);
    });
  }, [data]);

  // Quick calculator
  const handleQuickCalc = async () => {
    const gross = parseFloat(calcGross);
    if (!calcGross.trim() || isNaN(gross) || gross <= 0) return;
    setCalculating(true);
    try {
      const result: QuickCalcResult = await window.electronAPI.invoke('tax:calculate-withholding', {
        grossPay: gross,
        filingStatus: calcFiling,
        allowances: 1,
        year,
        ytdGross: 0,
      });
      setCalcResult(result ?? null);
    } catch {
      setCalcResult(null);
    } finally {
      setCalculating(false);
    }
  };

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

      {/* Overdue Alert Banner */}
      {overdueDeadlines.length > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 bg-accent-expense/10 border border-accent-expense/30 text-accent-expense"
          style={{ borderRadius: '6px' }}
        >
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-semibold">
            {overdueDeadlines.length} overdue filing{overdueDeadlines.length > 1 ? 's' : ''}:
          </span>
          <span className="text-xs">
            {overdueDeadlines.slice(0, 3).map((d) => `${d.label}${d.quarter ? ` Q${d.quarter}` : ''}`).join(', ')}
            {overdueDeadlines.length > 3 ? ` +${overdueDeadlines.length - 3} more` : ''}
          </span>
        </div>
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
          value={ytdPayroll}
          borderColor="border-l-accent-blue"
          subtitle={
            data && data.py_payroll > 0
              ? `vs PY: ${formatCurrency(data.py_payroll)}`
              : undefined
          }
        />
        <KPICard
          label="YTD Federal Tax"
          value={ytdFederal}
          borderColor="border-l-accent-expense"
        />
        <KPICard
          label="YTD State Tax"
          value={ytdState}
          borderColor="border-l-accent-warning"
        />
        <KPICard
          label="YTD FICA"
          value={ytdFica}
          borderColor="border-l-accent-income"
        />
      </div>

      {/* Effective Rate Cards */}
      <div className="grid grid-cols-4 gap-3">
        <RateCard label="Total Tax Burden" value={taxBurdenPct} color="text-accent-expense" />
        <RateCard label="Effective Fed Rate" value={fedEffRate} color="text-accent-expense" />
        <RateCard label="Effective State Rate" value={stateEffRate} color="text-accent-warning" />
        <RateCard label="FICA Rate" value={ficaRate} color="text-accent-blue" />
      </div>

      {/* Summary metric cards row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="block-card p-3" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2">
            <Users size={14} className="text-accent-blue" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active Employees</span>
          </div>
          <div className="text-xl font-mono font-bold text-text-primary mt-1">{activeEmployeeCount}</div>
        </div>
        <div className="block-card p-3" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2">
            <DollarSign size={14} className="text-accent-expense" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Employer Tax Cost</span>
          </div>
          <div className="text-xl font-mono font-bold text-accent-expense mt-1">{formatCurrency(employerTaxCost)}</div>
        </div>
        <div className="block-card p-3" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2">
            <BarChart3 size={14} className="text-accent-warning" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Tax / Employee</span>
          </div>
          <div className="text-xl font-mono font-bold text-text-primary mt-1">{formatCurrency(avgTaxPerEmployee)}</div>
        </div>
        <div className="block-card p-3" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2">
            <Percent size={14} className="text-accent-income" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Tax % of Revenue</span>
          </div>
          <div className="text-xl font-mono font-bold text-text-primary mt-1">
            {taxAsRevenuePct != null ? `${taxAsRevenuePct.toFixed(2)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Tax Liability Forecast */}
      <div className="block-card p-5" style={{ borderRadius: '6px' }}>
        <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Next Quarter Forecast</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-[10px] text-text-muted uppercase tracking-wider">Est. 941 Liability</div>
            <div className="text-xl font-mono font-bold text-accent-expense mt-1">{formatCurrency(forecast.fed + (forecast.fica || 0))}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-text-muted uppercase tracking-wider">Est. TC-941 Liability</div>
            <div className="text-xl font-mono font-bold text-accent-warning mt-1">{formatCurrency(forecast.state)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-text-muted uppercase tracking-wider">Deposit Schedule</div>
            <div className="text-xl font-bold text-accent-blue mt-1">{forecast.schedule}</div>
          </div>
        </div>
      </div>

      {/* Tax Payment Calendar */}
      <div className="block-card p-5" style={{ borderRadius: '6px' }}>
        <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Tax Payment Calendar</h3>
        {nextDeadlines.length > 0 ? (
          <div className="space-y-2">
            {nextDeadlines.map((d, idx) => (
              <div key={`${d.form}-${d.quarter ?? 'annual'}-${idx}`} className="flex items-center gap-3">
                <div className={`w-2 h-2 shrink-0 ${d.daysUntil <= 7 ? 'bg-accent-expense' : d.daysUntil <= 30 ? 'bg-accent-warning' : 'bg-accent-income'}`} style={{ borderRadius: '6px' }} />
                <span className="text-xs font-mono text-text-secondary w-24">{formatDate(d.dueDate.toISOString().slice(0, 10))}</span>
                <span className="text-xs text-text-primary flex-1">{d.label} {d.quarter ? `Q${d.quarter}` : ''}</span>
                <span className={`text-xs font-semibold ${d.daysUntil <= 7 ? 'text-accent-expense' : 'text-text-muted'}`}>
                  {d.daysUntil <= 0 ? 'OVERDUE' : `${d.daysUntil}d`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted">All deadlines are filed or no upcoming deadlines.</p>
        )}
      </div>

      {/* Wage Base Tracking */}
      <div className="block-card p-5" style={{ borderRadius: '6px' }}>
        <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Wage Base Tracking</h3>
        {wageBaseSummary.count > 0 ? (
          <div className="space-y-4">
            <WageBaseBar
              label={`Social Security ($${SS_CAP.toLocaleString()} cap)`}
              used={wageBaseSummary.avgGross}
              cap={SS_CAP}
              statusLabel={`${wageBaseSummary.ssExhausted}/${wageBaseSummary.count} exhausted`}
            />
            <WageBaseBar
              label={`Medicare Surtax ($${MEDICARE_SURTAX_THRESHOLD.toLocaleString()} threshold)`}
              used={wageBaseSummary.avgGross}
              cap={MEDICARE_SURTAX_THRESHOLD}
              statusLabel={`${wageBaseSummary.medicareOver}/${wageBaseSummary.count} above threshold`}
            />
            <WageBaseBar
              label={`FUTA ($${FUTA_CAP.toLocaleString()} cap)`}
              used={Math.min(wageBaseSummary.avgGross, FUTA_CAP)}
              cap={FUTA_CAP}
              statusLabel={`${wageBaseSummary.futaExhausted}/${wageBaseSummary.count} exhausted`}
            />
          </div>
        ) : (
          <p className="text-xs text-text-muted">No payroll data available for wage base tracking.</p>
        )}
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

      {/* Year-Over-Year Comparison */}
      <div className="block-card p-5" style={{ borderRadius: '6px' }}>
        <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Year-Over-Year Comparison</h3>
        <div className="grid grid-cols-2 gap-4">
          {/* Total Taxes */}
          <div className="bg-bg-tertiary border border-border-primary p-3" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Total Taxes</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-text-muted">This Year</div>
                <div className="text-sm font-mono font-bold text-text-primary">{formatCurrency(yoyComparison.cyTax)}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted">Last Year</div>
                <div className="text-sm font-mono text-text-secondary">{formatCurrency(yoyComparison.pyTax)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border-primary">
              {yoyComparison.changePct != null ? (
                <>
                  {yoyComparison.changeDollar >= 0 ? (
                    <TrendingUp size={12} className="text-accent-expense" />
                  ) : (
                    <TrendingDown size={12} className="text-accent-income" />
                  )}
                  <span className={`text-xs font-semibold ${yoyComparison.changeDollar >= 0 ? 'text-accent-expense' : 'text-accent-income'}`}>
                    {yoyComparison.changeDollar >= 0 ? '+' : ''}{formatCurrency(yoyComparison.changeDollar)} ({yoyComparison.changePct.toFixed(1)}%)
                  </span>
                </>
              ) : (
                <span className="text-xs text-text-muted">No prior year data</span>
              )}
            </div>
          </div>

          {/* Payroll */}
          <div className="bg-bg-tertiary border border-border-primary p-3" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Total Payroll</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-text-muted">This Year</div>
                <div className="text-sm font-mono font-bold text-text-primary">{formatCurrency(yoyComparison.cyPayroll)}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted">Last Year</div>
                <div className="text-sm font-mono text-text-secondary">{formatCurrency(yoyComparison.pyPayrollVal)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border-primary">
              {yoyComparison.payrollChangePct != null ? (
                <>
                  {yoyComparison.payrollChangeDollar >= 0 ? (
                    <TrendingUp size={12} className="text-accent-blue" />
                  ) : (
                    <TrendingDown size={12} className="text-accent-warning" />
                  )}
                  <span className={`text-xs font-semibold ${yoyComparison.payrollChangeDollar >= 0 ? 'text-accent-blue' : 'text-accent-warning'}`}>
                    {yoyComparison.payrollChangeDollar >= 0 ? '+' : ''}{formatCurrency(yoyComparison.payrollChangeDollar)} ({yoyComparison.payrollChangePct.toFixed(1)}%)
                  </span>
                </>
              ) : (
                <span className="text-xs text-text-muted">No prior year data</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filing Compliance + Pre-Tax Savings row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Filing Compliance Score */}
        <div className="block-card p-5" style={{ borderRadius: '6px' }}>
          <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Filing Compliance Score</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 36 36" className="w-full h-full">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="var(--color-border-primary)"
                  strokeWidth="3"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke={complianceScore != null && complianceScore >= 80 ? 'var(--color-accent-income)' : complianceScore != null && complianceScore >= 50 ? 'var(--color-accent-warning)' : 'var(--color-accent-expense)'}
                  strokeWidth="3"
                  strokeDasharray={`${complianceScore ?? 0}, 100`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-text-primary">
                  {complianceScore != null ? `${complianceScore.toFixed(0)}%` : '—'}
                </span>
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">
                {complianceScore != null && complianceScore === 100 ? 'All filings on time' :
                  complianceScore != null && complianceScore >= 80 ? 'Good compliance' :
                    complianceScore != null && complianceScore >= 50 ? 'Needs attention' :
                      complianceScore != null ? 'Critical — filings overdue' : 'No data yet'}
              </div>
              <div className="text-[10px] text-text-muted mt-1">
                {deadlines.filter((d) => d.status === 'filed').length} filed / {deadlines.filter((d) => d.daysUntil < 0 || d.status === 'filed').length} due
              </div>
            </div>
          </div>
        </div>

        {/* Tax Savings from Pre-Tax Deductions */}
        <div className="block-card p-5" style={{ borderRadius: '6px' }}>
          <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Tax Savings Potential</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">Pre-Tax 401(k) Savings (est.)</span>
              <span className="text-sm font-mono font-bold text-accent-income">
                {formatCurrency(ytdPayroll * 0.062 * 0.22)}
              </span>
            </div>
            <div className="text-[10px] text-text-muted">
              Based on avg 6.2% contribution rate and 22% marginal bracket
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border-primary">
              <span className="text-xs text-text-secondary">HSA Tax Savings (est.)</span>
              <span className="text-sm font-mono font-bold text-accent-income">
                {formatCurrency(activeEmployeeCount * 4300 * 0.0765)}
              </span>
            </div>
            <div className="text-[10px] text-text-muted">
              Based on {activeEmployeeCount} employees, $4,300 single limit, FICA savings
            </div>
          </div>
        </div>
      </div>

      {/* Quarterly Tax Liability Bar Chart */}
      <div className="grid grid-cols-2 gap-4">
        <div className="block-card p-5" style={{ borderRadius: '6px' }}>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Quarterly Tax Liability
          </h3>
          <div className="flex items-end gap-3 h-48">
            {(data?.quarters ?? []).map((q, qi) => {
              const total = q.federal + q.state + q.fica;
              const pct = total / quarterlyMax;
              const fedPct = total > 0 ? (q.federal / total) * 100 : 0;
              const statePct = total > 0 ? (q.state / total) * 100 : 0;
              const ficaPct = total > 0 ? (q.fica / total) * 100 : 0;
              const growth = quarterlyGrowth[qi];
              return (
                <div key={q.quarter} className="flex-1 flex flex-col items-center gap-2">
                  {/* Growth indicator */}
                  {growth != null && (
                    <div className={`flex items-center gap-0.5 text-[9px] font-semibold ${growth >= 0 ? 'text-accent-expense' : 'text-accent-income'}`}>
                      {growth >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                      {Math.abs(growth).toFixed(0)}%
                    </div>
                  )}
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

      {/* Quick Tax Calculator */}
      <div className="block-card p-5" style={{ borderRadius: '6px' }}>
        <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Quick Tax Estimate</h3>
        <div className="grid grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Gross Pay</label>
            <input
              type="number"
              placeholder="5000.00"
              className="block-input w-full"
              value={calcGross}
              onChange={(e) => setCalcGross(e.target.value)}
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Filing Status</label>
            <select
              className="block-select w-full"
              value={calcFiling}
              onChange={(e) => setCalcFiling(e.target.value)}
            >
              <option value="single">Single</option>
              <option value="married_filing_jointly">Married Filing Jointly</option>
              <option value="married_filing_separately">Married Filing Separately</option>
              <option value="head_of_household">Head of Household</option>
            </select>
          </div>
          <div>
            <button
              onClick={handleQuickCalc}
              disabled={calculating || !calcGross.trim()}
              className="block-btn-primary flex items-center gap-2 px-4 py-2 text-xs w-full justify-center"
            >
              <Calculator size={13} className={calculating ? 'animate-pulse' : ''} />
              {calculating ? 'Calculating...' : 'Calculate'}
            </button>
          </div>
          <div>
            {calcResult ? (
              <div className="bg-bg-tertiary border border-border-primary p-2" style={{ borderRadius: '6px' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted">Total:</span>
                  <span className="text-sm font-mono font-bold text-accent-expense">{formatCurrency(calcResult.total)}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-text-muted">Fed/SS/Med:</span>
                  <span className="text-[10px] font-mono text-text-secondary">
                    {formatCurrency(calcResult.federal)} / {formatCurrency(calcResult.ss)} / {formatCurrency(calcResult.medicare)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-muted text-center py-2">Enter gross pay to estimate</div>
            )}
          </div>
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
