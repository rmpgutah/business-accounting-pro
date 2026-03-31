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
} from 'lucide-react';
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
} from 'date-fns';
import api from '../../lib/api';
import { useAppStore } from '../../stores/appStore';
import { useCompanyStore } from '../../stores/companyStore';

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
  client_name: string;
  total: number;
  amount_paid: number;
  due_date: string;
  status: string;
}

interface TopClient {
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
  revenueGrowthPct: number;
  topClientName: string;
  topClientRevenue: number;
}

type Period = 'MTD' | 'QTD' | 'YTD';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtCurrency = (value: number) => fmt.format(value);

const fmtCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return fmt.format(value);
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
function urgencyColor(dueDate: string): string {
  const now = new Date();
  const due = new Date(dueDate);
  const daysLeft = Math.ceil(
    (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
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
        borderRadius: '2px',
      }}
    >
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-mono">
          {p.dataKey === 'income' ? 'Revenue' : 'Expenses'}: {fmtCurrency(p.value)}
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
        borderRadius: '2px',
      }}
    >
      <p className="text-text-primary font-semibold">{name}</p>
      <p className="font-mono text-accent-income">{fmtCurrency(value)}</p>
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
        borderRadius: '2px',
      }}
    >
      <p className="text-text-muted mb-1">{label}</p>
      {payload
        .filter((p: any) => p.dataKey === 'projected')
        .map((p: any) => (
          <p key={p.dataKey} className="font-mono text-accent-blue">
            Projected: {fmtCurrency(p.value)}
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
      className={`block-card p-4 border-l-2 ${accentClass} ${
        onClick ? 'cursor-pointer hover:bg-bg-hover transition-colors' : ''
      }`}
      style={{ borderRadius: '2px' }}
      onClick={onClick}
    >
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <p className="text-2xl font-mono text-text-primary mt-1">
        {fmtCurrency(value)}
      </p>
      <span
        className={`text-xs font-mono ${
          isPositive ? 'text-accent-income' : 'text-accent-expense'
        }`}
      >
        {isPositive ? '+' : ''}
        {change.toFixed(1)}%
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

const QuickAction: React.FC<QuickActionProps> = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="block-card flex flex-col items-center justify-center gap-2 p-4 hover:bg-bg-hover transition-colors cursor-pointer"
    style={{ borderRadius: '2px' }}
  >
    <span className="text-text-secondary">{icon}</span>
    <span className="text-xs font-semibold text-text-secondary">{label}</span>
  </button>
);

// ─── Dashboard Component ────────────────────────────────
const Dashboard: React.FC = () => {
  const setModule = useAppStore((s) => s.setModule);
  const activeCompany = useCompanyStore((s) => s.activeCompany);
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
    revenueGrowthPct: 0,
    topClientName: '--',
    topClientRevenue: 0,
  });

  const { start, end } = useMemo(() => dateRange(period), [period]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      const cid = activeCompany.id;
      try {
        const [
          statsData,
          cashflowData,
          activityData,
          dueData,
          clientsData,
          revenueByClientData,
          expenseByCategoryData,
          last12MonthsRevenue,
          last12MonthsExpenses,
          invoicesSentData,
          avgPaymentDaysData,
          thisMonthRevData,
          lastMonthRevData,
          topClientMonthData,
        ] = await Promise.all([
          api.dashboardStats(start, end),
          api.dashboardCashflow(start, end),
          api.dashboardActivity('all', 15),
          api.rawQuery(
            `SELECT i.*, c.name as client_name FROM invoices i
             LEFT JOIN clients c ON i.client_id = c.id
             WHERE i.company_id = ? AND i.status IN ('sent','partial') AND i.due_date <= date('now', '+7 days') AND i.due_date >= date('now')
             ORDER BY i.due_date ASC LIMIT 5`,
            [cid]
          ),
          api.rawQuery(
            `SELECT c.name, COALESCE(SUM(i.amount_paid), 0) as total_paid
             FROM clients c
             LEFT JOIN invoices i ON i.client_id = c.id AND i.issue_date >= date('now', '-90 days')
             WHERE c.company_id = ?
             GROUP BY c.id
             HAVING total_paid > 0
             ORDER BY total_paid DESC
             LIMIT 5`,
            [cid]
          ),
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
          ),
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
          ),
          // Last 12 months revenue for AreaChart
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
          // Last 12 months expenses for AreaChart
          api.rawQuery(
            `SELECT strftime('%Y-%m', date) as month,
                    COALESCE(SUM(amount), 0) as total
             FROM expenses
             WHERE company_id = ? AND date >= date('now', '-12 months')
             GROUP BY month
             ORDER BY month ASC`,
            [cid]
          ),
          // Invoices sent this month
          api.rawQuery(
            `SELECT COUNT(*) as cnt FROM invoices
             WHERE company_id = ? AND status IN ('sent','paid','partial','overdue')
               AND issue_date >= date('now', 'start of month')`,
            [cid]
          ),
          // Avg days to payment
          api.rawQuery(
            `SELECT AVG(julianday(
               CASE WHEN amount_paid >= total THEN updated_at ELSE date('now') END
             ) - julianday(issue_date)) as avg_days
             FROM invoices
             WHERE company_id = ? AND status = 'paid' AND issue_date >= date('now', '-6 months')`,
            [cid]
          ),
          // This month revenue
          api.rawQuery(
            `SELECT COALESCE(SUM(total), 0) as rev FROM invoices
             WHERE company_id = ? AND status IN ('paid','sent','partial')
               AND issue_date >= date('now', 'start of month')`,
            [cid]
          ),
          // Last month revenue
          api.rawQuery(
            `SELECT COALESCE(SUM(total), 0) as rev FROM invoices
             WHERE company_id = ? AND status IN ('paid','sent','partial')
               AND issue_date >= date('now', 'start of month', '-1 month')
               AND issue_date < date('now', 'start of month')`,
            [cid]
          ),
          // Top client this month
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
        ]);

        if (cancelled) return;

        // Stats
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

        if (cashflowData && Array.isArray(cashflowData)) setCashflow(cashflowData);
        if (activityData && Array.isArray(activityData)) setRecentActivity(activityData);
        if (dueData && Array.isArray(dueData)) setUpcomingDue(dueData);
        if (clientsData && Array.isArray(clientsData)) setTopClients(clientsData);

        // Pie chart: top 5 + Other
        if (revenueByClientData && Array.isArray(revenueByClientData)) {
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
        }

        // Treemap: expense categories
        if (expenseByCategoryData && Array.isArray(expenseByCategoryData)) {
          const treemapData: ExpenseCategory[] = expenseByCategoryData.map(
            (r: any, i: number) => ({
              name: r.name || 'Uncategorized',
              size: r.size || 0,
              fill: TREEMAP_COLORS[i % TREEMAP_COLORS.length],
            })
          );
          setExpenseCategories(treemapData);
        }

        // Build Revenue vs Expenses area chart from last 12 months
        // (stored in cashflow state for the area chart)
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
        }

        // Cash flow forecast: use last months to project next 3
        if (last12MonthsRevenue && last12MonthsExpenses) {
          const revArr = (last12MonthsRevenue as any[]).map((r) => r.total || 0);
          const expArr = (last12MonthsExpenses as any[]).map((r) => r.total || 0);
          const netArr = revArr.map((r, i) => r - (expArr[i] || 0));

          // Simple linear regression on net cash
          const n = netArr.length;
          if (n >= 2) {
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for (let i = 0; i < n; i++) {
              sumX += i; sumY += netArr[i]; sumXY += i * netArr[i]; sumX2 += i * i;
            }
            const denom = n * sumX2 - sumX * sumX;
            const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
            const intercept = (sumY - slope * sumX) / n;

            // Variance for confidence band
            const residuals = netArr.map((v, i) => v - (slope * i + intercept));
            const stdDev = Math.sqrt(
              residuals.reduce((s, r) => s + r * r, 0) / Math.max(n - 2, 1)
            );

            // Running cash from current balance
            const currentCash = netArr.reduce((a, b) => a + b, 0);
            const forecast: CashForecastPoint[] = [];
            let runningCash = currentCash;

            for (let i = 1; i <= 3; i++) {
              const d = new Date();
              d.setMonth(d.getMonth() + i);
              const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
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

        // Quick metrics
        const invoicesSent = Array.isArray(invoicesSentData) ? invoicesSentData[0]?.cnt : invoicesSentData?.cnt;
        const avgDays = Array.isArray(avgPaymentDaysData) ? avgPaymentDaysData[0]?.avg_days : avgPaymentDaysData?.avg_days;
        const thisRev = Array.isArray(thisMonthRevData) ? thisMonthRevData[0]?.rev : thisMonthRevData?.rev;
        const lastRev = Array.isArray(lastMonthRevData) ? lastMonthRevData[0]?.rev : lastMonthRevData?.rev;
        const topClient = Array.isArray(topClientMonthData) ? topClientMonthData[0] : topClientMonthData;

        const growthPct =
          lastRev && lastRev > 0 ? ((thisRev - lastRev) / lastRev) * 100 : 0;

        setQuickMetrics({
          invoicesSentThisMonth: invoicesSent || 0,
          avgDaysToPayment: Math.round(avgDays || 0),
          revenueGrowthPct: growthPct,
          topClientName: topClient?.name || '--',
          topClientRevenue: topClient?.total || 0,
        });
      } catch (err) {
        console.error('Dashboard data load failed:', err);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [start, end, activeCompany]);

  // ─── Reload activity when filter changes ──────────────
  useEffect(() => {
    if (activityFilter === 'all') return; // already loaded in main effect
    const loadFiltered = async () => {
      try {
        const data = await api.dashboardActivity(activityFilter, 15);
        if (Array.isArray(data)) setRecentActivity(data);
      } catch (err) {
        console.error('Failed to load filtered activity:', err);
      }
    };
    loadFiltered();
  }, [activityFilter]);

  const periodButtons: Period[] = ['MTD', 'QTD', 'YTD'];

  // Top client max for bar scaling
  const maxClientRevenue =
    topClients.length > 0
      ? Math.max(...topClients.map((c) => c.total_paid))
      : 1;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header & Period Selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text-primary">Dashboard</h1>
        <div className="flex gap-1" style={{ borderRadius: '2px' }}>
          {periodButtons.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-semibold transition-colors ${
                period === p
                  ? 'bg-accent-blue text-white'
                  : 'bg-bg-secondary text-text-muted hover:text-text-primary'
              }`}
              style={{ borderRadius: '2px' }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Revenue"
          value={stats.revenue}
          change={stats.revenueChange}
          accentClass="border-l-accent-income"
          onClick={() => setModule('invoicing')}
        />
        <StatCard
          label="Expenses"
          value={stats.expenses}
          change={stats.expensesChange}
          accentClass="border-l-accent-expense"
          onClick={() => setModule('expenses')}
        />
        <StatCard
          label="Net Income"
          value={stats.netIncome}
          change={stats.netIncomeChange}
          accentClass="border-l-accent-blue"
          onClick={() => setModule('reports')}
        />
        <StatCard
          label="Outstanding Invoices"
          value={stats.outstanding}
          change={stats.outstandingChange}
          accentClass="border-l-accent-warning"
          onClick={() => {
            sessionStorage.setItem('nav:invoiceFilter', 'overdue');
            setModule('invoicing');
          }}
        />
      </div>

      {/* ─── Quick Metrics Row ─── */}
      <div className="grid grid-cols-4 gap-4">
        <div className="block-card p-4" style={{ borderRadius: '2px' }}>
          <div className="flex items-center gap-2 mb-2">
            <CalendarCheck size={14} className="text-accent-blue" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Invoices Sent
            </span>
          </div>
          <p className="text-2xl font-mono text-text-primary">
            <AnimatedCounter value={quickMetrics.invoicesSentThisMonth} />
          </p>
          <span className="text-[10px] text-text-muted">This month</span>
        </div>

        <div className="block-card p-4" style={{ borderRadius: '2px' }}>
          <div className="flex items-center gap-2 mb-2">
            <Timer size={14} className="text-accent-warning" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Avg Days to Payment
            </span>
          </div>
          <p className="text-2xl font-mono text-text-primary">
            <AnimatedCounter value={quickMetrics.avgDaysToPayment} />
            <span className="text-sm text-text-muted ml-1">days</span>
          </p>
          <span className="text-[10px] text-text-muted">Last 6 months</span>
        </div>

        <div className="block-card p-4" style={{ borderRadius: '2px' }}>
          <div className="flex items-center gap-2 mb-2">
            {quickMetrics.revenueGrowthPct >= 0 ? (
              <TrendingUp size={14} className="text-accent-income" />
            ) : (
              <TrendingDown size={14} className="text-accent-expense" />
            )}
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Revenue Growth
            </span>
          </div>
          <p
            className={`text-2xl font-mono ${
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
          <span className="text-[10px] text-text-muted">vs. last month</span>
        </div>

        <div className="block-card p-4" style={{ borderRadius: '2px' }}>
          <div className="flex items-center gap-2 mb-2">
            <Crown size={14} className="text-accent-purple" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Top Client
            </span>
          </div>
          <p className="text-sm font-semibold text-text-primary truncate">
            {quickMetrics.topClientName}
          </p>
          <p className="text-lg font-mono text-accent-purple">
            {fmtCurrency(quickMetrics.topClientRevenue)}
          </p>
          <span className="text-[10px] text-text-muted">This month</span>
        </div>
      </div>

      {/* ─── Revenue vs Expenses AreaChart (12 months) ─── */}
      <div className="block-card p-5" style={{ borderRadius: '2px' }}>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Revenue vs Expenses (Last 12 Months)
        </h2>
        <div style={{ width: '100%', minHeight: 320 }}>
          <ResponsiveContainer width="100%" height={320}>
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

      {/* ─── Income Sources Pie + Cash Flow Forecast ─── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Income Sources PieChart */}
        <div className="block-card p-5" style={{ borderRadius: '2px' }}>
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Income Sources Breakdown
          </h2>
          {clientRevenue.length === 0 ? (
            <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
              <span className="text-xs text-text-muted">No revenue data available</span>
            </div>
          ) : (
            <div style={{ width: '100%', minHeight: 300 }}>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={clientRevenue}
                    cx="40%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={100}
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

        {/* Cash Flow Forecast */}
        <div className="block-card p-5" style={{ borderRadius: '2px' }}>
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Cash Flow Forecast (Next 3 Months)
          </h2>
          {cashForecast.length === 0 ? (
            <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
              <span className="text-xs text-text-muted">
                Insufficient historical data for forecast
              </span>
            </div>
          ) : (
            <div style={{ width: '100%', minHeight: 300 }}>
              <ResponsiveContainer width="100%" height={300}>
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
          )}
        </div>
      </div>

      {/* ─── Expense Category Treemap ─── */}
      <div className="block-card p-5" style={{ borderRadius: '2px' }}>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Expense Breakdown by Category
        </h2>
        {expenseCategories.length === 0 ? (
          <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
            <span className="text-xs text-text-muted">No expense data available</span>
          </div>
        ) : (
          <div style={{ width: '100%', minHeight: 300 }}>
            <ResponsiveContainer width="100%" height={300}>
              <Treemap
                data={expenseCategories}
                dataKey="size"
                nameKey="name"
                stroke="#0a0a0a"
                content={<TreemapContent />}
              />
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <QuickAction
            icon={<FileText size={20} />}
            label="New Invoice"
            onClick={() => setModule('invoicing')}
          />
          <QuickAction
            icon={<Receipt size={20} />}
            label="Record Expense"
            onClick={() => setModule('expenses')}
          />
          <QuickAction
            icon={<Clock size={20} />}
            label="Start Timer"
            onClick={() => setModule('time-tracking')}
          />
          <QuickAction
            icon={<Users size={20} />}
            label="Run Payroll"
            onClick={() => setModule('payroll')}
          />
        </div>
      </div>

      {/* ─── Bottom 2-Column Grid: Activity + Due/Clients ─── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left Column: Recent Activity (Enhanced) */}
        <div className="block-card p-5" style={{ borderRadius: '2px' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-text-muted" />
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Recent Activity
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="block-select text-[10px] py-0.5 px-2"
                style={{ width: 'auto', minWidth: '100px', borderRadius: '2px', height: '24px' }}
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
                        if (details.total) richDescription += ` for ${fmtCurrency(details.total)}`;
                        if (details.client_name) richDescription += ` — ${details.client_name}`;
                      } else if (entry.entity_type === 'expenses' && details.description) {
                        richDescription = details.description;
                        if (details.amount) richDescription += ` — ${fmtCurrency(details.amount)}`;
                        if (details.vendor_name) richDescription += ` (${details.vendor_name})`;
                      } else if (entry.entity_type === 'clients' && details.name) {
                        richDescription = details.name;
                        if (details.email) richDescription += ` (${details.email})`;
                      } else if (entry.entity_type === 'payments' && details.amount) {
                        richDescription = `Payment ${fmtCurrency(details.amount)}`;
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
                    className="flex items-center gap-3 py-2"
                    style={{ borderBottom: '1px solid #2e2e2e' }}
                  >
                    <span
                      className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5"
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.text,
                        borderRadius: '2px',
                        minWidth: 52,
                        textAlign: 'center',
                      }}
                    >
                      {actionLabel}
                    </span>
                    <span className="text-xs text-text-primary flex-1 truncate" title={richDescription}>
                      {richDescription}
                    </span>
                    <span className="text-[10px] text-text-muted font-mono whitespace-nowrap">
                      {relativeTime}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Upcoming Due + Top Clients stacked */}
        <div className="space-y-4">
          {/* Upcoming Due */}
          <div className="block-card p-5" style={{ borderRadius: '2px' }}>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={14} className="text-text-muted" />
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
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
                      className="flex items-center gap-3 py-2"
                      style={{ borderBottom: '1px solid #2e2e2e' }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          backgroundColor: color,
                          borderRadius: '1px',
                          flexShrink: 0,
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-text-primary font-semibold truncate">
                            {inv.invoice_number}
                          </span>
                          <span className="text-xs font-mono text-text-primary ml-2">
                            {fmtCurrency(amountDue)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] text-text-muted truncate">
                            {inv.client_name || 'Unknown'}
                          </span>
                          <span className="text-[10px] text-text-muted font-mono ml-2">
                            {inv.due_date}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top Clients */}
          <div className="block-card p-5" style={{ borderRadius: '2px' }}>
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={14} className="text-text-muted" />
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Top Clients (90 Days)
              </h2>
            </div>
            {topClients.length === 0 ? (
              <p className="text-xs text-text-muted">No client revenue data</p>
            ) : (
              <div className="space-y-3">
                {topClients.map((client, idx) => {
                  const pct =
                    maxClientRevenue > 0
                      ? (client.total_paid / maxClientRevenue) * 100
                      : 0;
                  return (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-primary truncate">
                          {client.name}
                        </span>
                        <span className="text-xs font-mono text-text-muted ml-2">
                          {fmtCurrency(client.total_paid)}
                        </span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: 6,
                          backgroundColor: '#2e2e2e',
                          borderRadius: '1px',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            backgroundColor: '#3b82f6',
                            borderRadius: '1px',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
