import React, { useEffect, useState, useMemo } from 'react';
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  FileText,
  Receipt,
  Clock,
  Users,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  endOfMonth,
} from 'date-fns';
import api from '../../lib/api';
import { useAppStore } from '../../stores/appStore';

// ─── Types ──────────────────────────────────────────────
interface Stats {
  revenue: number;
  revenueChange: number;
  expenses: number;
  expensesChange: number;
  netIncome: number;
  netIncomeChange: number;
  outstandingInvoices: number;
  outstandingChange: number;
}

interface CashflowPoint {
  date: string;
  income: number;
  expense: number;
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

// ─── Custom Tooltip ─────────────────────────────────────
const ChartTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="text-xs px-3 py-2"
      style={{
        backgroundColor: '#252525',
        border: '1px solid #2e2e2e',
        borderRadius: '2px',
      }}
    >
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-mono">
          {p.dataKey === 'income' ? 'Income' : 'Expense'}: {fmtCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

// ─── Stat Card ──────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number;
  change: number;
  accentClass: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, change, accentClass }) => {
  const isPositive = change >= 0;
  return (
    <div
      className={`block-card p-4 border-l-2 ${accentClass}`}
      style={{ borderRadius: '2px' }}
    >
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <p className="text-2xl font-mono text-text-primary mt-1">{fmtCurrency(value)}</p>
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
  const { setModule } = useAppStore();
  const [period, setPeriod] = useState<Period>('MTD');
  const [stats, setStats] = useState<Stats>({
    revenue: 0,
    revenueChange: 0,
    expenses: 0,
    expensesChange: 0,
    netIncome: 0,
    netIncomeChange: 0,
    outstandingInvoices: 0,
    outstandingChange: 0,
  });
  const [cashflow, setCashflow] = useState<CashflowPoint[]>([]);

  const { start, end } = useMemo(() => dateRange(period), [period]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [statsData, cashflowData] = await Promise.all([
          api.dashboardStats(start, end),
          api.dashboardCashflow(start, end),
        ]);
        if (cancelled) return;

        if (statsData) {
          setStats({
            revenue: statsData.revenue ?? 0,
            revenueChange: statsData.revenueChange ?? 0,
            expenses: statsData.expenses ?? 0,
            expensesChange: statsData.expensesChange ?? 0,
            netIncome: statsData.netIncome ?? 0,
            netIncomeChange: statsData.netIncomeChange ?? 0,
            outstandingInvoices: statsData.outstandingInvoices ?? 0,
            outstandingChange: statsData.outstandingChange ?? 0,
          });
        }

        if (cashflowData && Array.isArray(cashflowData)) {
          setCashflow(cashflowData);
        }
      } catch (err) {
        console.error('Dashboard data load failed:', err);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  const periodButtons: Period[] = ['MTD', 'QTD', 'YTD'];

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
        />
        <StatCard
          label="Expenses"
          value={stats.expenses}
          change={stats.expensesChange}
          accentClass="border-l-accent-expense"
        />
        <StatCard
          label="Net Income"
          value={stats.netIncome}
          change={stats.netIncomeChange}
          accentClass="border-l-accent-blue"
        />
        <StatCard
          label="Outstanding Invoices"
          value={stats.outstandingInvoices}
          change={stats.outstandingChange}
          accentClass="border-l-accent-warning"
        />
      </div>

      {/* Cash Flow Chart */}
      <div
        className="block-card p-5"
        style={{ borderRadius: '2px' }}
      >
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Cash Flow
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cashflow}>
              <XAxis
                dataKey="date"
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
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="income"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#22c55e' }}
              />
              <Line
                type="monotone"
                dataKey="expense"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#ef4444' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
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
    </div>
  );
};

export default Dashboard;
