import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  FileText,
  Receipt,
  Clock,
  Users,
  Activity,
  AlertTriangle,
  BarChart3,
  Zap,
  CalendarCheck,
  Timer,
  Crown,
  Printer,
} from 'lucide-react';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';
import KpiTile from '../../components/KpiTile';
import DataBar from '../../components/DataBar';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Treemap,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  endOfMonth,
  formatDistanceToNow,
  parseISO,
  differenceInCalendarDays,
  startOfDay,
  addMonths,
} from 'date-fns';
import api from '../../lib/api';
import { useAppStore } from '../../stores/appStore';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import { usePersonalizationStore } from '../../stores/personalizationStore';
import { formatCurrency, formatDate, percentChange } from '../../lib/format';
import EntityChip from '../../components/EntityChip';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Types ──────────────────────────────────────────────
interface Stats {
  revenue: number;
  revenueChange: number;
  expenses: number;
  expensesChange: number;
  netIncome: number;
  netIncomeChange: number;
  outstanding: number;
  outstandingChange: number;
}

interface CashflowPoint {
  month: string;
  income: number;
  expenses: number;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes?: string;
}

interface UpcomingInvoice {
  id: string;
  invoice_number: string;
  client_id?: string;
  client_name: string;
  total: number;
  amount_paid: number;
  due_date: string;
  status: string;
}

interface TopClient {
  id?: string;
  name: string;
  total_paid: number;
}

interface ClientRevenue {
  name: string;
  value: number;
}

interface ExpenseCategory {
  name: string;
  size: number;
  fill: string;
}

interface CashForecastPoint {
  month: string;
  projected: number;
  upper: number;
  lower: number;
}

interface QuickMetrics {
  invoicesSentThisMonth: number;
  avgDaysToPayment: number;
  // null when prior month had zero revenue — UI renders "—" instead of a
  // misleading 0% (which masks a "from nothing" gain) or NaN/Infinity.
  revenueGrowthPct: number | null;
  topClientName: string;
  topClientRevenue: number;
}

type Period = 'MTD' | 'QTD' | 'YTD';

const fmtCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return formatCurrency(value);
};

// ─── Period Helpers ─────────────────────────────────────
function dateRange(period: Period): { start: string; end: string } {
  const now = new Date();
  let start: Date;
  switch (period) {
    case 'QTD':
      start = startOfQuarter(now);
      break;
    case 'YTD':
      start = startOfYear(now);
      break;
    default:
      start = startOfMonth(now);
  }
  const end = endOfMonth(now);
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  };
}

// ─── Action Badge Colors ────────────────────────────────
function actionBadgeStyle(action: string): { bg: string; text: string } {
  switch (action) {
    case 'create':
      return { bg: '#16a34a20', text: '#22c55e' };
    case 'update':
      return { bg: '#2563eb20', text: '#3b82f6' };
    case 'delete':
      return { bg: '#dc262620', text: '#ef4444' };
    default:
      return { bg: '#6b6b6b20', text: '#6b6b6b' };
  }
}

// ─── Urgency Color ──────────────────────────────────────
// Use parseISO + calendar-day diff so a 'YYYY-MM-DD' due date isn't
// shifted by the local timezone (new Date('2026-04-23') parses as UTC
// midnight, which becomes the previous day in the Americas).
function urgencyColor(dueDate: string): string {
  if (!dueDate) return '#22c55e';
  const today = startOfDay(new Date());
  const due = startOfDay(parseISO(dueDate));
  const daysLeft = differenceInCalendarDays(due, today);
  if (daysLeft <= 1) return '#ef4444';
  if (daysLeft <= 3) return '#f59e0b';
  return '#22c55e';
}

// ─── Chart Colors ───────────────────────────────────────
const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#6b7280'];
const TREEMAP_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444',
  '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316',
];

// ─── Custom Tooltips ────────────────────────────────────
const AreaTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="text-xs px-3 py-2"
      style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #2e2e2e',
        borderRadius: '6px',
      }}
    >
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-mono">
          {p.dataKey === 'income' ? 'Revenue' : 'Expenses'}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

const PieTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div
      className="text-xs px-3 py-2"
      style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #2e2e2e',
        borderRadius: '6px',
      }}
    >
      <p className="text-text-primary font-semibold">{name}</p>
      <p className="font-mono text-accent-income">{formatCurrency(value)}</p>
    </div>
  );
};

const ForecastTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="text-xs px-3 py-2"
      style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #2e2e2e',
        borderRadius: '6px',
      }}
    >
      <p className="text-text-muted mb-1">{label}</p>
      {payload
        .filter((p: any) => p.dataKey === 'projected')
        .map((p: any) => (
          <p key={p.dataKey} className="font-mono text-accent-blue">
            Projected: {formatCurrency(p.value)}
          </p>
        ))}
    </div>
  );
};

// ─── Treemap Content ────────────────────────────────────
const TreemapContent: React.FC<any> = (props: any) => {
  const { x, y, width, height, name, size, fill } = props;
  if (width < 40 || height < 30) return null;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: fill || '#3b82f6',
          stroke: '#0a0a0a',
          strokeWidth: 2,
        }}
      />
      {width > 60 && height > 40 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 7}
            textAnchor="middle"
            fill="#fff"
            fontSize={11}
            fontWeight={600}
          >
            {name?.length > 14 ? name.slice(0, 12) + '..' : name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 9}
            textAnchor="middle"
            fill="#ffffffaa"
            fontSize={10}
            fontFamily="monospace"
          >
            {fmtCompact(size)}
          </text>
        </>
      )}
    </g>
  );
};

// ─── Stat Card ──────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number;
  change: number;
  accentClass: string;
}

const StatCard: React.FC<StatCardProps & { onClick?: () => void }> = ({
  label,
  value,
  change,
  accentClass,
  onClick,
}) => {
  const isPositive = change >= 0;
  return (
    <div
      className={`block-card py-6 px-5 border-l-4 ${accentClass} ${
        onClick ? 'cursor-pointer hover:bg-bg-hover hover:scale-[1.02] transition-all duration-200' : ''
      }`}
      style={{ borderRadius: '6px' }}
      onClick={onClick}
    >
      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <p className="text-3xl font-mono text-text-primary mt-2">
        {formatCurrency(value)}
      </p>
      <span
        className={`text-xs font-mono mt-1 inline-block ${
          isPositive ? 'text-accent-income' : 'text-accent-expense'
        }`}
      >
        {isPositive ? '+' : ''}
        {change.toFixed(1)}% vs prior period
      </span>
    </div>
  );
};

// ─── Animated Counter ───────────────────────────────────
const AnimatedCounter: React.FC<{
  value: number;
  format?: (v: number) => string;
  duration?: number;
}> = ({ value, format: formatFn, duration = 1200 }) => {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const from = display;
    const to = value;

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <>{formatFn ? formatFn(display) : Math.round(display)}</>;
};

// ─── Quick Action Button ────────────────────────────────
interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

interface QuickActionExtendedProps extends QuickActionProps {
  description?: string;
  accentClass?: string;
}

const QuickAction: React.FC<QuickActionExtendedProps> = ({ icon, label, description, accentClass, onClick }) => (
  <button
    onClick={onClick}
    className={`block-card flex flex-col items-start gap-3 p-5 hover:bg-bg-hover hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left ${accentClass ? `border-l-4 ${accentClass}` : ''}`}
    style={{ borderRadius: '6px' }}
  >
    <span className="text-text-secondary">{icon}</span>
    <div>
      <span className="text-sm font-semibold text-text-primary block">{label}</span>
      {description && (
        <span className="text-[11px] text-text-muted mt-0.5 block">{description}</span>
      )}
    </div>
  </button>
);

// ─── Dashboard Component ────────────────────────────────
const Dashboard: React.FC = () => {
  const setModule = useAppStore((s) => s.setModule);
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const authUser = useAuthStore((s) => s.user);
  // Personalization: dashboard tabs / widget visibility / order
  const dashboardTabs = usePersonalizationStore((s) => s.dashboardTabs);
  const activeTabId = usePersonalizationStore((s) => s.activeTabId);
  const setActiveTab = usePersonalizationStore((s) => s.setActiveTab);
  const resetDashboard = usePersonalizationStore((s) => s.resetDashboard);
  const activeTab = dashboardTabs.find((t) => t.id === activeTabId) ?? dashboardTabs[0];
  const widgetMap = new Map(activeTab.widgets.map((w) => [w.id, w]));
  const isOn = (id: string) => {
    const w = widgetMap.get(id);
    return !w || w.visible;
  };
  const isMini = (id: string) => widgetMap.get(id)?.mini === true;
  const [period, setPeriod] = useState<Period>('MTD');
  const [stats, setStats] = useState<Stats>({
    revenue: 0,
    revenueChange: 0,
    expenses: 0,
    expensesChange: 0,
    netIncome: 0,
    netIncomeChange: 0,
    outstanding: 0,
    outstandingChange: 0,
  });
  const [cashflow, setCashflow] = useState<CashflowPoint[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>('all');
  const [upcomingDue, setUpcomingDue] = useState<UpcomingInvoice[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [clientRevenue, setClientRevenue] = useState<ClientRevenue[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [cashForecast, setCashForecast] = useState<CashForecastPoint[]>([]);
  const [quickMetrics, setQuickMetrics] = useState<QuickMetrics>({
    invoicesSentThisMonth: 0,
    avgDaysToPayment: 0,
    revenueGrowthPct: null,
    topClientName: '--',
    topClientRevenue: 0,
  });
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [rulesActivity, setRulesActivity] = useState<{ pricing_today: number; approvals_pending: number; alerts_week: number } | null>(null);
  const [debtStats, setDebtStats] = useState<{ count: number; total: number } | null>(null);
  const [billsStats, setBillsStats] = useState<{ unpaid_total: number; overdue_count: number } | null>(null);
  const [payrollStats, setPayrollStats] = useState<{ active_count: number; last_payroll_date?: string; ytd_payroll?: number } | null>(null);

  const { start, end } = useMemo(() => dateRange(period), [period]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      const cid = activeCompany.id;

      // Dashboard is ALL optional data — each query loads independently
      // so a single failure doesn't blank the entire dashboard.

      api.dashboardStats(start, end).then(statsData => {
        if (cancelled) return;
        if (statsData) {
          setStats({
            revenue: statsData.revenue ?? 0,
            revenueChange: statsData.revenueChange ?? 0,
            expenses: statsData.expenses ?? 0,
            expensesChange: statsData.expensesChange ?? 0,
            netIncome: statsData.netIncome ?? 0,
            netIncomeChange: statsData.netIncomeChange ?? 0,
            outstanding: statsData.outstanding ?? 0,
            outstandingChange: statsData.outstandingChange ?? 0,
          });
        }
      }).catch(() => {});

      api.dashboardCashflow(start, end).then(r => {
        if (!cancelled && Array.isArray(r)) setCashflow(r);
      }).catch(() => {});

      api.dashboardActivity('all', 15).then(r => {
        if (!cancelled && Array.isArray(r)) setRecentActivity(r);
      }).catch(() => {});

      api.rawQuery(
        `SELECT i.*, c.name as client_name FROM invoices i
         LEFT JOIN clients c ON i.client_id = c.id
         WHERE i.company_id = ? AND i.status IN ('sent','partial') AND i.due_date <= date('now', '+7 days') AND i.due_date >= date('now')
         ORDER BY i.due_date ASC LIMIT 5`,
        [cid]
      ).then(r => {
        if (!cancelled && Array.isArray(r)) setUpcomingDue(r);
      }).catch(() => {});

      api.rawQuery(
        `SELECT c.id, c.name, COALESCE(SUM(i.amount_paid), 0) as total_paid
         FROM clients c
         LEFT JOIN invoices i ON i.client_id = c.id AND i.issue_date >= date('now', '-90 days')
         WHERE c.company_id = ?
         GROUP BY c.id
         HAVING total_paid > 0
         ORDER BY total_paid DESC
         LIMIT 5`,
        [cid]
      ).then(r => {
        if (!cancelled && Array.isArray(r)) setTopClients(r);
      }).catch(() => {});

      // Revenue by client (top 5 + Other) for PieChart
      api.rawQuery(
        `SELECT c.name, COALESCE(SUM(i.total), 0) as value
         FROM invoices i
         JOIN clients c ON i.client_id = c.id
         WHERE i.company_id = ? AND i.status IN ('paid', 'sent', 'partial')
           AND i.issue_date >= date('now', '-12 months')
         GROUP BY c.id
         ORDER BY value DESC`,
        [cid]
      ).then(revenueByClientData => {
        if (cancelled || !Array.isArray(revenueByClientData)) return;
        const top5 = revenueByClientData.slice(0, 5);
        const otherTotal = revenueByClientData
          .slice(5)
          .reduce((sum: number, r: any) => sum + (r.value || 0), 0);
        const pieData: ClientRevenue[] = top5.map((r: any) => ({
          name: r.name || 'Unknown',
          value: r.value || 0,
        }));
        if (otherTotal > 0) pieData.push({ name: 'Other', value: otherTotal });
        setClientRevenue(pieData);
      }).catch(() => {});

      // Expenses by category for Treemap
      api.rawQuery(
        `SELECT
           CASE WHEN cat.name IS NOT NULL AND cat.name != '' THEN cat.name
                WHEN e.category_id != '' THEN e.category_id
                ELSE 'Uncategorized' END as name,
           COALESCE(SUM(e.amount), 0) as size
         FROM expenses e
         LEFT JOIN categories cat ON e.category_id = cat.id
         WHERE e.company_id = ? AND e.date >= date('now', '-12 months')
         GROUP BY name
         HAVING size > 0
         ORDER BY size DESC`,
        [cid]
      ).then(expenseByCategoryData => {
        if (cancelled || !Array.isArray(expenseByCategoryData)) return;
        const treemapData: ExpenseCategory[] = expenseByCategoryData.map(
          (r: any, i: number) => ({
            name: r.name || 'Uncategorized',
            size: r.size || 0,
            fill: TREEMAP_COLORS[i % TREEMAP_COLORS.length],
          })
        );
        setExpenseCategories(treemapData);
      }).catch(() => {});

      // Last 12 months revenue + expenses for AreaChart and forecast
      Promise.all([
        api.rawQuery(
          `SELECT strftime('%Y-%m', issue_date) as month,
                  COALESCE(SUM(total), 0) as total
           FROM invoices
           WHERE company_id = ? AND status IN ('paid', 'sent', 'partial')
             AND issue_date >= date('now', '-12 months')
           GROUP BY month
           ORDER BY month ASC`,
          [cid]
        ),
        api.rawQuery(
          `SELECT strftime('%Y-%m', date) as month,
                  COALESCE(SUM(amount), 0) as total
           FROM expenses
           WHERE company_id = ? AND date >= date('now', '-12 months')
           GROUP BY month
           ORDER BY month ASC`,
          [cid]
        ),
      ]).then(([last12MonthsRevenue, last12MonthsExpenses]) => {
        if (cancelled) return;

        if (last12MonthsRevenue && last12MonthsExpenses) {
          const revMap = new Map<string, number>();
          const expMap = new Map<string, number>();
          (last12MonthsRevenue as any[]).forEach((r) => revMap.set(r.month, r.total));
          (last12MonthsExpenses as any[]).forEach((r) => expMap.set(r.month, r.total));
          const allMonths = new Set([...revMap.keys(), ...expMap.keys()]);
          const sorted = Array.from(allMonths).sort();
          const areaData: CashflowPoint[] = sorted.map((m) => ({
            month: m,
            income: revMap.get(m) || 0,
            expenses: expMap.get(m) || 0,
          }));
          setCashflow(areaData);

          // Cash flow forecast: use last months to project next 3
          const revArr = (last12MonthsRevenue as any[]).map((r) => r.total || 0);
          const expArr = (last12MonthsExpenses as any[]).map((r) => r.total || 0);
          const netArr = revArr.map((r, i) => r - (expArr[i] || 0));

          const n = netArr.length;
          if (n >= 2) {
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for (let i = 0; i < n; i++) {
              sumX += i; sumY += netArr[i]; sumXY += i * netArr[i]; sumX2 += i * i;
            }
            const denom = n * sumX2 - sumX * sumX;
            const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
            const intercept = (sumY - slope * sumX) / n;

            const residuals = netArr.map((v, i) => v - (slope * i + intercept));
            const stdDev = Math.sqrt(
              residuals.reduce((s, r) => s + r * r, 0) / Math.max(n - 2, 1)
            );

            const currentCash = netArr.reduce((a, b) => a + b, 0);
            const forecast: CashForecastPoint[] = [];
            let runningCash = currentCash;

            for (let i = 1; i <= 3; i++) {
              // addMonths handles end-of-month clamping (Jan 31 + 1mo → Feb 28),
              // unlike setMonth which can roll into the wrong month.
              const d = addMonths(new Date(), i);
              const label = formatDate(d.toISOString());
              const projected = slope * (n + i - 1) + intercept;
              runningCash += projected;
              forecast.push({
                month: label,
                projected: Math.max(runningCash, 0),
                upper: Math.max(runningCash + stdDev * 1.5, 0),
                lower: Math.max(runningCash - stdDev * 1.5, 0),
              });
            }
            setCashForecast(forecast);
          }
        }
      }).catch(() => {});

      // Quick metrics
      Promise.all([
        api.rawQuery(
          `SELECT COUNT(*) as cnt FROM invoices
           WHERE company_id = ? AND status IN ('sent','paid','partial','overdue')
             AND issue_date >= date('now', 'start of month')`,
          [cid]
        ),
        api.rawQuery(
          `SELECT AVG(julianday(
             CASE WHEN amount_paid >= total THEN updated_at ELSE date('now') END
           ) - julianday(issue_date)) as avg_days
           FROM invoices
           WHERE company_id = ? AND status = 'paid' AND issue_date >= date('now', '-6 months')`,
          [cid]
        ),
        api.rawQuery(
          `SELECT COALESCE(SUM(total), 0) as rev FROM invoices
           WHERE company_id = ? AND status IN ('paid','sent','partial')
             AND issue_date >= date('now', 'start of month')`,
          [cid]
        ),
        api.rawQuery(
          `SELECT COALESCE(SUM(total), 0) as rev FROM invoices
           WHERE company_id = ? AND status IN ('paid','sent','partial')
             AND issue_date >= date('now', 'start of month', '-1 month')
             AND issue_date < date('now', 'start of month')`,
          [cid]
        ),
        api.rawQuery(
          `SELECT c.name, COALESCE(SUM(i.total), 0) as total
           FROM invoices i
           JOIN clients c ON i.client_id = c.id
           WHERE i.company_id = ? AND i.status IN ('paid','sent','partial')
             AND i.issue_date >= date('now', 'start of month')
           GROUP BY c.id
           ORDER BY total DESC
           LIMIT 1`,
          [cid]
        ),
      ]).then(([invoicesSentData, avgPaymentDaysData, thisMonthRevData, lastMonthRevData, topClientMonthData]) => {
        if (cancelled) return;
        const invoicesSent = Array.isArray(invoicesSentData) ? invoicesSentData[0]?.cnt : (invoicesSentData as any)?.cnt;
        const avgDays = Array.isArray(avgPaymentDaysData) ? avgPaymentDaysData[0]?.avg_days : (avgPaymentDaysData as any)?.avg_days;
        const thisRev = Array.isArray(thisMonthRevData) ? thisMonthRevData[0]?.rev : (thisMonthRevData as any)?.rev;
        const lastRev = Array.isArray(lastMonthRevData) ? lastMonthRevData[0]?.rev : (lastMonthRevData as any)?.rev;
        const topClient = Array.isArray(topClientMonthData) ? topClientMonthData[0] : topClientMonthData;

        // Use percentChange helper so zero-prior returns null → UI renders "—"
        // instead of misleading 0% (which would mask a "from nothing" gain).
        const thisN = Number(thisRev) || 0;
        const lastN = Number(lastRev) || 0;
        const growthPct = percentChange(thisN, lastN);

        setQuickMetrics({
          invoicesSentThisMonth: invoicesSent || 0,
          avgDaysToPayment: Math.round(avgDays || 0),
          revenueGrowthPct: growthPct,
          topClientName: (topClient as any)?.name || '--',
          topClientRevenue: (topClient as any)?.total || 0,
        });
      }).catch(() => {});

      // Anomalies
      api.listAnomalies().then(r => {
        if (!cancelled) setAnomalies(r || []);
      }).catch(() => {});

      // Debt collection summary
      api.rawQuery(
        'SELECT COUNT(*) as count, COALESCE(SUM(balance_due),0) as total FROM debts WHERE company_id = ? AND status NOT IN ("settled","written_off")',
        [cid]
      ).then(r => {
        if (!cancelled) {
          const row = Array.isArray(r) ? r[0] : r;
          setDebtStats(row ? { count: row.count ?? 0, total: row.total ?? 0 } : null);
        }
      }).catch(() => {});

      // Bills / AP summary
      api.rawQuery(
        `SELECT
          COALESCE(SUM(CASE WHEN status NOT IN ('paid') THEN total - amount_paid ELSE 0 END), 0) as unpaid_total,
          COUNT(CASE WHEN status = 'overdue' OR (status NOT IN ('paid','draft') AND due_date < date('now')) THEN 1 END) as overdue_count
         FROM bills WHERE company_id = ?`,
        [cid]
      ).then(r => {
        if (!cancelled) {
          const row = Array.isArray(r) ? r[0] : r;
          setBillsStats(row ? { unpaid_total: row.unpaid_total ?? 0, overdue_count: row.overdue_count ?? 0 } : null);
        }
      }).catch(() => {});

      // Payroll summary
      api.rawQuery(
        `SELECT COUNT(*) as active_count,
          (SELECT MAX(pr.pay_date) FROM payroll_runs pr WHERE pr.company_id = ?) as last_payroll_date,
          (SELECT COALESCE(SUM(pr.total_gross), 0) FROM payroll_runs pr WHERE pr.company_id = ? AND pr.pay_date >= ?) as ytd_payroll
         FROM employees WHERE company_id = ? AND status = 'active'`,
        [cid, cid, new Date().getFullYear() + '-01-01', cid]
      ).then(r => {
        if (!cancelled) {
          const row = Array.isArray(r) ? r[0] : r;
          setPayrollStats(row ? {
            active_count: row.active_count ?? 0,
            last_payroll_date: row.last_payroll_date ?? undefined,
            ytd_payroll: row.ytd_payroll ?? 0,
          } : null);
        }
      }).catch(() => {});

      // Rules activity & approvals
      Promise.all([
        api.pendingApprovalCount(activeCompany.id),
        api.rawQuery(
          `SELECT
            (SELECT COUNT(*) FROM rules WHERE company_id = ? AND category='pricing' AND date(last_run_at)=date('now')) as pricing_today,
            (SELECT COUNT(*) FROM approval_queue WHERE company_id = ? AND status='pending') as approvals_pending,
            (SELECT COUNT(*) FROM rules WHERE company_id = ? AND category='alert' AND date(last_run_at)>=date('now','-7 days')) as alerts_week`,
          [activeCompany.id, activeCompany.id, activeCompany.id]
        ),
      ]).then(([approvalCount, activityRow]) => {
        if (cancelled) return;
        setPendingApprovals(approvalCount ?? 0);
        const rowData = Array.isArray(activityRow) ? activityRow[0] : activityRow;
        setRulesActivity(rowData ?? null);
      }).catch(() => {});
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [start, end, activeCompany]);

  // ─── Reload activity when filter changes ──────────────
  useEffect(() => {
    if (activityFilter === 'all') return; // already loaded in main effect
    let cancelled = false;
    const loadFiltered = async () => {
      try {
        const data = await api.dashboardActivity(activityFilter, 15);
        if (!cancelled && Array.isArray(data)) setRecentActivity(data);
      } catch {
        // Silent — dashboard widgets are best-effort.
      }
    };
    loadFiltered();
    return () => {
      cancelled = true;
    };
  }, [activityFilter]);

  const periodButtons: Period[] = ['MTD', 'QTD', 'YTD'];

  // Top client max for bar scaling — memoized so we don't rescan + rebuild
  // a Math.max array on every parent render.
  const maxClientRevenue = useMemo(
    () => (topClients.length > 0 ? Math.max(...topClients.map((c) => c.total_paid)) : 1),
    [topClients]
  );

  // ─── Print handler — toggles landscape page class so wide charts fit ─
  const handlePrint = () => {
    document.body.classList.add('dashboard-print');
    const cleanup = () => {
      document.body.classList.remove('dashboard-print');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Fallback in case afterprint doesn't fire (some platforms)
    setTimeout(cleanup, 60000);
    window.print();
  };

  return (
    <div className="p-8 space-y-8 overflow-y-auto h-full">
      {/* Print-only corporate header */}
      <PrintReportHeader title="Dashboard" periodEnd={new Date()} />
      <div className="max-w-[1400px] mx-auto space-y-8">

      {/* Dashboard Tab Strip (custom tabs feature #16) */}
      {dashboardTabs.length > 1 && (
        <div className="flex items-center gap-2 no-print">
          {dashboardTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTabId === t.id ? 'bg-accent-blue text-white' : 'bg-bg-secondary text-text-muted hover:text-text-primary'
              }`}
              style={{ borderRadius: 'var(--app-radius, 6px)' }}
            >
              {t.name}
            </button>
          ))}
          <button
            onClick={resetDashboard}
            className="ml-auto text-[11px] text-text-muted hover:text-text-primary"
            title="Reset to default layout"
          >
            Reset Layout
          </button>
        </div>
      )}

      {/* Header & Period Selector */}
      <div className="flex items-end justify-between py-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {getGreeting()}{authUser?.display_name ? `, ${authUser.display_name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-lg font-semibold text-text-secondary mt-1">
            {activeCompany?.name || 'Dashboard'}
          </p>
          <p className="text-sm text-text-muted mt-0.5">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
        <div className="flex gap-2 items-center" style={{ borderRadius: '6px' }}>
          <button
            onClick={handlePrint}
            className="no-print flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-bg-secondary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print this dashboard"
          >
            <Printer size={13} />
            Print
          </button>
          {periodButtons.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 text-xs font-semibold transition-colors ${
                period === p
                  ? 'bg-accent-blue text-white'
                  : 'bg-bg-secondary text-text-muted hover:text-text-primary transition-colors'
              }`}
              style={{ borderRadius: '6px' }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Rules Activity Strip */}
      {rulesActivity && (rulesActivity.pricing_today > 0 || rulesActivity.approvals_pending > 0 || rulesActivity.alerts_week > 0) && (
        <div className="glass-subtle px-4 py-2.5 flex gap-6 text-xs font-bold text-accent-blue flex-wrap" style={{ borderRadius: '8px' }}>
          {rulesActivity.pricing_today > 0 && (
            <span>{rulesActivity.pricing_today} pricing rule{rulesActivity.pricing_today !== 1 ? 's' : ''} applied today</span>
          )}
          {rulesActivity.approvals_pending > 0 && (
            <span className="text-accent-warning">{rulesActivity.approvals_pending} approval{rulesActivity.approvals_pending !== 1 ? 's' : ''} pending</span>
          )}
          {rulesActivity.alerts_week > 0 && (
            <span>{rulesActivity.alerts_week} alert{rulesActivity.alerts_week !== 1 ? 's' : ''} fired this week</span>
          )}
        </div>
      )}

      {/* Stat Cards — refactored to <KpiTile> (feature 13 demo) so they
          collapse to inline summary text in print via .report-summary-tiles.
          Visibility controlled by user dashboard prefs. */}
      {isOn('kpis') && (
      <div className={`grid ${isMini('kpis') ? 'grid-cols-8' : 'grid-cols-4'} gap-5 report-summary-tiles`}>
        <KpiTile
          label="Revenue"
          value={stats.revenue}
          trendPct={stats.revenueChange}
          accentClass="border-l-accent-income"
          subtext="vs prior period"
          onClick={() => setModule('invoicing')}
        />
        <KpiTile
          label="Expenses"
          value={stats.expenses}
          trendPct={stats.expensesChange}
          accentClass="border-l-accent-expense"
          subtext="vs prior period"
          onClick={() => setModule('expenses')}
        />
        <KpiTile
          label="Net Income"
          value={stats.netIncome}
          trendPct={stats.netIncomeChange}
          accentClass="border-l-accent-blue"
          subtext="vs prior period"
          onClick={() => setModule('reports')}
        />
        <KpiTile
          label="Outstanding Invoices"
          value={stats.outstanding}
          trendPct={stats.outstandingChange}
          accentClass="border-l-accent-warning"
          subtext="vs prior period"
          onClick={() => {
            sessionStorage.setItem('nav:invoiceFilter', 'overdue');
            setModule('invoicing');
          }}
        />
      </div>
      )}

      {/* ─── Quick Metrics Row ─── */}
      {isOn('quick-metrics') && (
      <div className="grid grid-cols-4 gap-5">
        <div className="block-card py-5 px-5" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-3">
            <CalendarCheck size={16} className="text-accent-blue" />
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Invoices Sent
            </span>
          </div>
          <p className="text-3xl font-mono text-text-primary">
            <AnimatedCounter value={quickMetrics.invoicesSentThisMonth} />
          </p>
          <span className="text-[11px] text-text-muted mt-1 block">This month</span>
        </div>

        <div className="block-card py-5 px-5" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-3">
            <Timer size={16} className="text-accent-warning" />
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Avg Days to Payment
            </span>
          </div>
          <p className="text-3xl font-mono text-text-primary">
            <AnimatedCounter value={quickMetrics.avgDaysToPayment} />
            <span className="text-base text-text-muted ml-1">days</span>
          </p>
          <span className="text-[11px] text-text-muted mt-1 block">Last 6 months</span>
        </div>

        <div className="block-card py-5 px-5" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-3">
            {quickMetrics.revenueGrowthPct == null ? (
              <TrendingUp size={16} className="text-text-muted" />
            ) : quickMetrics.revenueGrowthPct >= 0 ? (
              <TrendingUp size={16} className="text-accent-income" />
            ) : (
              <TrendingDown size={16} className="text-accent-expense" />
            )}
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Revenue Growth
            </span>
          </div>
          {quickMetrics.revenueGrowthPct == null ? (
            <p className="text-3xl font-mono text-text-muted">—</p>
          ) : (
            <p
              className={`text-3xl font-mono ${
                quickMetrics.revenueGrowthPct >= 0
                  ? 'text-accent-income'
                  : 'text-accent-expense'
              }`}
            >
              <AnimatedCounter
                value={quickMetrics.revenueGrowthPct}
                format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
              />
            </p>
          )}
          <span className="text-[11px] text-text-muted mt-1 block">
            {quickMetrics.revenueGrowthPct == null ? 'no prior-month revenue' : 'vs. last month'}
          </span>
        </div>

        <div className="block-card py-5 px-5" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-3">
            <Crown size={16} className="text-accent-purple" />
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Top Client
            </span>
          </div>
          <p className="text-sm font-semibold text-text-primary truncate">
            {quickMetrics.topClientName}
          </p>
          <p className="text-xl font-mono text-accent-purple mt-1">
            {formatCurrency(quickMetrics.topClientRevenue)}
          </p>
          <span className="text-[11px] text-text-muted mt-1 block">This month</span>
        </div>
      </div>
      )}

      {/* ─── Cross-Module Summary Cards ─── */}
      {isOn('cross-module') && (
      <div className="grid grid-cols-3 gap-5">
        {/* Debt Collection */}
        <div
          className="block-card py-6 px-5 border-l-4 border-l-accent-expense cursor-pointer hover:bg-bg-hover hover:scale-[1.02] transition-all duration-200"
          style={{ borderRadius: '6px' }}
          onClick={() => setModule('debt-collection')}
        >
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            Debt Collection
          </span>
          <p className="text-3xl font-mono text-text-primary mt-2">
            {debtStats ? formatCurrency(debtStats.total) : '$0.00'}
          </p>
          <span className="text-xs text-text-muted mt-1 block">
            {debtStats?.count ?? 0} outstanding debt{(debtStats?.count ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Bills / AP */}
        <div
          className="block-card py-6 px-5 border-l-4 border-l-accent-warning cursor-pointer hover:bg-bg-hover hover:scale-[1.02] transition-all duration-200"
          style={{ borderRadius: '6px' }}
          onClick={() => setModule('bills')}
        >
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            Bills / AP
          </span>
          <p className="text-3xl font-mono text-text-primary mt-2">
            {billsStats ? formatCurrency(billsStats.unpaid_total) : '$0.00'}
          </p>
          <span className="text-xs text-text-muted mt-1 block">
            {billsStats?.overdue_count ?? 0} overdue bill{(billsStats?.overdue_count ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Payroll */}
        <div
          className="block-card py-6 px-5 border-l-4 border-l-accent-purple cursor-pointer hover:bg-bg-hover hover:scale-[1.02] transition-all duration-200"
          style={{ borderRadius: '6px' }}
          onClick={() => setModule('payroll')}
        >
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            Payroll
          </span>
          <p className="text-3xl font-mono text-text-primary mt-2">
            {payrollStats?.active_count ?? 0}
          </p>
          <span className="text-xs text-text-muted mt-1 block">
            active employee{(payrollStats?.active_count ?? 0) !== 1 ? 's' : ''}
          </span>
          {payrollStats?.last_payroll_date && (
            <p className="text-[11px] text-text-muted mt-0.5">Last run: {formatDate(payrollStats.last_payroll_date)}</p>
          )}
          {(payrollStats?.ytd_payroll ?? 0) > 0 && (
            <p className="text-[11px] text-text-secondary font-mono mt-0.5">YTD: {formatCurrency(payrollStats!.ytd_payroll!)}</p>
          )}
        </div>
      </div>
      )}

      {/* ─── Revenue vs Expenses AreaChart (12 months) ─── */}
      {isOn('revenue-trend') && (
      <div className="block-card p-6" style={{ borderRadius: '6px' }}>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">
          Revenue vs Expenses
        </h2>
        <p className="text-[11px] text-text-muted mb-5">Trailing 12-month overview</p>
        {/* Print-fallback table — hidden on screen, shown in PDF */}
        {cashflow.length > 0 && (
          <table className="chart-print-fallback" style={{ width: '100%', fontSize: '9pt', marginBottom: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Month</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Expenses</th>
                <th style={{ textAlign: 'right' }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {cashflow.map((p) => (
                <tr key={p.month}>
                  <td>{p.month}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(p.income)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(p.expenses)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(p.income - p.expenses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="chart-screen-only" style={{ width: '100%', minHeight: 360 }}>
          <ResponsiveContainer width="100%" height={360}>
            <AreaChart data={cashflow}>
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="month"
                tick={{ fill: '#6b6b6b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#6b6b6b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<AreaTooltip />} />
              <Area
                type="monotone"
                dataKey="income"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#gradRevenue)"
                activeDot={{ r: 4, fill: '#22c55e' }}
              />
              <Area
                type="monotone"
                dataKey="expenses"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#gradExpenses)"
                activeDot={{ r: 4, fill: '#ef4444' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      )}

      {/* ─── Income Sources Pie + Cash Flow Forecast ─── */}
      {(isOn('income-pie') || isOn('cash-forecast')) && (
      <div className="grid grid-cols-2 gap-6">
        {/* Income Sources PieChart */}
        {isOn('income-pie') && (
        <div className="block-card p-6" style={{ borderRadius: '6px' }}>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">
            Income Sources
          </h2>
          <p className="text-[11px] text-text-muted mb-5">Revenue breakdown by client</p>
          {clientRevenue.length === 0 ? (
            <div className="flex items-center justify-center" style={{ minHeight: 340 }}>
              <span className="text-xs text-text-muted">No revenue data available</span>
            </div>
          ) : (
            <div style={{ width: '100%', minHeight: 340 }}>
              <ResponsiveContainer width="100%" height={340}>
                <PieChart>
                  <Pie
                    data={clientRevenue}
                    cx="40%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={110}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    stroke="none"
                  >
                    {clientRevenue.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend
                    layout="vertical"
                    verticalAlign="middle"
                    align="right"
                    iconType="square"
                    iconSize={10}
                    formatter={(value: string) => (
                      <span className="text-xs text-text-secondary">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        )}

        {/* Cash Flow Forecast */}
        {isOn('cash-forecast') && (
        <div className="block-card p-6" style={{ borderRadius: '6px' }}>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">
            Cash Flow Forecast
          </h2>
          <p className="text-[11px] text-text-muted mb-5">Projected next 3 months with confidence band</p>
          {cashForecast.length === 0 ? (
            <div className="flex items-center justify-center" style={{ minHeight: 340 }}>
              <span className="text-xs text-text-muted">
                Insufficient historical data for forecast
              </span>
            </div>
          ) : (
            <>
              {/* Print-fallback inline summary (feature 20) */}
              {cashflow.length > 0 && (() => {
                const last12 = cashflow.slice(-12);
                const avgRev = last12.reduce((s, p) => s + p.income, 0) / Math.max(last12.length, 1);
                const first = last12[0];
                const last = last12[last12.length - 1];
                const trendPct =
                  first && first.income > 0
                    ? ((last.income - first.income) / first.income) * 100
                    : 0;
                const proj = cashForecast[0]?.projected ?? 0;
                return (
                  <div className="chart-print-fallback" style={{ fontSize: '10pt', lineHeight: 1.5 }}>
                    <div><strong>Last 12 months avg:</strong> {formatCurrency(avgRev)}</div>
                    <div><strong>Trend:</strong> {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%</div>
                    <div><strong>Projected next month:</strong> {formatCurrency(proj)}</div>
                  </div>
                );
              })()}
              <div className="chart-screen-only" style={{ width: '100%', minHeight: 340 }}>
              <ResponsiveContainer width="100%" height={340}>
                <AreaChart data={cashForecast}>
                  <defs>
                    <linearGradient id="gradConfidence" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="month"
                    tick={{ fill: '#6b6b6b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#6b6b6b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => fmtCompact(v)}
                  />
                  <Tooltip content={<ForecastTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="upper"
                    stroke="none"
                    fill="url(#gradConfidence)"
                    fillOpacity={1}
                  />
                  <Area
                    type="monotone"
                    dataKey="lower"
                    stroke="none"
                    fill="#0a0a0a"
                    fillOpacity={1}
                  />
                  <Line
                    type="monotone"
                    dataKey="projected"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#3b82f6', stroke: '#0a0a0a', strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: '#3b82f6' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
        )}
      </div>
      )}

      {/* ─── Expense Category Treemap ─── */}
      {isOn('expense-treemap') && (
      <div className="block-card p-6" style={{ borderRadius: '6px' }}>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">
          Expense Breakdown
        </h2>
        <p className="text-[11px] text-text-muted mb-5">Spending by category (12 months)</p>
        {expenseCategories.length === 0 ? (
          <div className="flex items-center justify-center" style={{ minHeight: 340 }}>
            <span className="text-xs text-text-muted">No expense data available</span>
          </div>
        ) : (
          <>
            {/* Print fallback: ranked list with DataBars (feature 19/23) */}
            <div className="chart-print-fallback" style={{ fontSize: '10pt' }}>
              {(() => {
                const totalExp = expenseCategories.reduce((s, c) => s + c.size, 0);
                return expenseCategories.map((c, i) => (
                  <div key={c.name} style={{ marginBottom: 6 }}>
                    <DataBar
                      value={c.size}
                      total={totalExp || 1}
                      color={c.fill}
                      thickness={5}
                      label={`${i + 1}. ${c.name}`}
                      rightText={formatCurrency(c.size)}
                    />
                  </div>
                ));
              })()}
            </div>
            <div className="chart-screen-only" style={{ width: '100%', minHeight: 340 }}>
              <ResponsiveContainer width="100%" height={340}>
                <Treemap
                  data={expenseCategories as any[]}
                  dataKey="size"
                  nameKey="name"
                  stroke="#0a0a0a"
                  content={<TreemapContent />}
                />
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
      )}

      {/* Quick Actions — interactive only */}
      {isOn('quick-actions') && (
      <div className="no-print">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">
          Quick Actions
        </h2>
        <p className="text-[11px] text-text-muted mb-4">Jump into common workflows</p>
        <div className="grid grid-cols-4 gap-5">
          <QuickAction
            icon={<FileText size={22} />}
            label="New Invoice"
            description="Create and send an invoice"
            accentClass="border-l-accent-income"
            onClick={() => setModule('invoicing')}
          />
          <QuickAction
            icon={<Receipt size={22} />}
            label="Record Expense"
            description="Log a new business expense"
            accentClass="border-l-accent-expense"
            onClick={() => setModule('expenses')}
          />
          <QuickAction
            icon={<Clock size={22} />}
            label="Start Timer"
            description="Track billable hours"
            accentClass="border-l-accent-blue"
            onClick={() => setModule('time-tracking')}
          />
          <QuickAction
            icon={<Users size={22} />}
            label="Run Payroll"
            description="Process employee payroll"
            accentClass="border-l-accent-purple"
            onClick={() => setModule('payroll')}
          />
        </div>
      </div>
      )}

      {/* ─── Bottom 2-Column Grid: Activity + Due/Clients ─── */}
      {(isOn('activity') || isOn('upcoming-due') || isOn('top-clients')) && (
      <div className="grid grid-cols-2 gap-6">
        {/* Left Column: Recent Activity (Enhanced) */}
        {isOn('activity') && (
        <div className="block-card p-6" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-text-muted" />
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                Recent Activity
              </h2>
            </div>
            <div className="flex items-center gap-2 no-print">
              <select
                className="block-select text-[10px] py-0.5 px-2"
                style={{ width: 'auto', minWidth: '100px', borderRadius: '6px', height: '24px' }}
                value={activityFilter}
                onChange={(e) => setActivityFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="invoices">Invoices</option>
                <option value="expenses">Expenses</option>
                <option value="clients">Clients</option>
                <option value="payments">Payments</option>
                <option value="projects">Projects</option>
              </select>
              <button
                className="text-[10px] text-accent-blue hover:underline font-medium"
                onClick={() => setModule('audit')}
              >
                View All
              </button>
            </div>
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-xs text-text-muted">No recent activity</p>
          ) : (
            <div className="space-y-0">
              {recentActivity.map((entry) => {
                const badge = actionBadgeStyle(entry.action);
                let relativeTime = '';
                try {
                  relativeTime = formatDistanceToNow(new Date(entry.timestamp), {
                    addSuffix: true,
                  });
                } catch {
                  relativeTime = entry.timestamp;
                }

                // Build rich description from entity_details
                let richDescription = `${entry.entity_type} #${entry.entity_id?.slice(0, 8)}`;
                try {
                  if ((entry as any).entity_details) {
                    const details = typeof (entry as any).entity_details === 'string'
                      ? JSON.parse((entry as any).entity_details)
                      : (entry as any).entity_details;
                    if (details) {
                      if (entry.entity_type === 'invoices' && details.invoice_number) {
                        richDescription = `Invoice ${details.invoice_number}`;
                        if (details.total) richDescription += ` for ${formatCurrency(details.total)}`;
                        if (details.client_name) richDescription += ` — ${details.client_name}`;
                      } else if (entry.entity_type === 'expenses' && details.description) {
                        richDescription = details.description;
                        if (details.amount) richDescription += ` — ${formatCurrency(details.amount)}`;
                        if (details.vendor_name) richDescription += ` (${details.vendor_name})`;
                      } else if (entry.entity_type === 'clients' && details.name) {
                        richDescription = details.name;
                        if (details.email) richDescription += ` (${details.email})`;
                      } else if (entry.entity_type === 'payments' && details.amount) {
                        richDescription = `Payment ${formatCurrency(details.amount)}`;
                        if (details.invoice_number) richDescription += ` on ${details.invoice_number}`;
                      }
                    }
                  }
                } catch {
                  // fallback to default
                }

                const actionLabel = entry.action === 'create' ? 'Created' :
                  entry.action === 'update' ? 'Updated' :
                  entry.action === 'delete' ? 'Deleted' : entry.action;

                return (
                  <div
                    key={entry.id}
                    className="activity-feed-row flex items-center gap-3 py-3"
                    style={{ borderBottom: '1px solid #2e2e2e' }}
                  >
                    <span
                      className="text-[10px] font-mono font-semibold uppercase px-2 py-1"
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.text,
                        borderRadius: '6px',
                        minWidth: 56,
                        textAlign: 'center',
                      }}
                    >
                      {actionLabel}
                    </span>
                    <span className="text-sm text-text-primary flex-1 truncate" title={richDescription}>
                      {richDescription}
                    </span>
                    <span className="text-[11px] text-text-muted font-mono whitespace-nowrap">
                      {relativeTime}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Right Column: Upcoming Due + Top Clients stacked */}
        {(isOn('upcoming-due') || isOn('top-clients')) && (
        <div className="space-y-6">
          {/* Upcoming Due */}
          {isOn('upcoming-due') && (
          <div className="block-card p-6" style={{ borderRadius: '6px' }}>
            <div className="flex items-center gap-2 mb-5">
              <AlertTriangle size={16} className="text-text-muted" />
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                Upcoming Due
              </h2>
            </div>
            {upcomingDue.length === 0 ? (
              <p className="text-xs text-text-muted">
                No invoices due in the next 7 days
              </p>
            ) : (
              <div className="space-y-0">
                {upcomingDue.map((inv) => {
                  const color = urgencyColor(inv.due_date);
                  const amountDue = (inv.total || 0) - (inv.amount_paid || 0);
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center gap-3 py-3"
                      style={{ borderBottom: '1px solid #2e2e2e' }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          backgroundColor: color,
                          borderRadius: '2px',
                          flexShrink: 0,
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-primary font-semibold truncate">
                            <EntityChip type="invoice" id={inv.id} label={inv.invoice_number} variant="inline" />
                          </span>
                          <span className="text-sm font-mono font-semibold text-text-primary ml-2">
                            {formatCurrency(amountDue)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[11px] text-text-muted truncate">
                            {(inv as any).client_id ? <EntityChip type="client" id={(inv as any).client_id} label={inv.client_name || 'Unknown'} variant="inline" /> : (inv.client_name || 'Unknown')}
                          </span>
                          <span className="text-[11px] text-text-muted font-mono ml-2">
                            {formatDate(inv.due_date)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* Top Clients */}
          {isOn('top-clients') && (
          <div className="block-card p-6" style={{ borderRadius: '6px' }}>
            <div className="flex items-center gap-2 mb-5">
              <BarChart3 size={16} className="text-text-muted" />
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                Top Clients (90 Days)
              </h2>
            </div>
            {topClients.length === 0 ? (
              <p className="text-xs text-text-muted">No client revenue data</p>
            ) : (
              <div className="space-y-4">
                {topClients.map((client, idx) => (
                  <div key={idx}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-text-primary truncate">
                        <span className="text-text-muted font-mono mr-2">{idx + 1}.</span>
                        {client.id ? (
                          <EntityChip type="client" id={client.id} label={client.name} variant="inline" />
                        ) : (
                          client.name
                        )}
                      </span>
                      <span className="text-sm font-mono font-semibold text-text-secondary ml-2">
                        {formatCurrency(client.total_paid)}
                      </span>
                    </div>
                    <DataBar
                      value={client.total_paid}
                      total={maxClientRevenue}
                      color="#3b82f6"
                      thickness={6}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </div>
        )}
      </div>
      )}

      {/* ─── Intelligence Alerts ─── */}
      {anomalies.length > 0 && (
        <div className="col-span-full border-2 border-orange-500 bg-accent-warning-bg p-6" style={{ borderRadius: '6px' }}>
          <h2 className="text-sm font-black uppercase tracking-wider text-accent-warning mb-4">
            Intelligence Alerts
          </h2>
          <div className="space-y-2">
            {anomalies.map((a: any) => (
              <div key={a.id} className="flex items-start justify-between gap-4 bg-bg-secondary border border-accent-warning p-3">
                <div>
                  <p className="text-sm font-bold text-text-primary">{a.anomaly_type?.replace(/_/g, ' ').toUpperCase()}</p>
                  <p className="text-sm text-text-secondary mt-0.5">{a.description}</p>
                </div>
                <button
                  onClick={async () => {
                    await api.dismissAnomaly(a.id);
                    setAnomalies(prev => prev.filter(x => x.id !== a.id));
                  }}
                  className="flex-shrink-0 text-xs font-black text-text-muted hover:text-text-primary border border-border-secondary px-2 py-1 hover:border-border-primary transition-colors"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>{/* end max-w-[1400px] wrapper */}
      <PrintReportFooter />
    </div>
  );
};

export default Dashboard;
