import React, { useEffect, useState, useMemo } from 'react';
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
  formatDistanceToNow,
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
  const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 1) return '#ef4444';
  if (daysLeft <= 3) return '#f59e0b';
  return '#22c55e';
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
          {p.dataKey === 'income' ? 'Income' : 'Expenses'}: {fmtCurrency(p.value)}
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

const StatCard: React.FC<StatCardProps & { onClick?: () => void }> = ({ label, value, change, accentClass, onClick }) => {
  const isPositive = change >= 0;
  return (
    <div
      className={`block-card p-4 border-l-2 ${accentClass} ${onClick ? 'cursor-pointer hover:bg-bg-hover transition-colors' : ''}`}
      style={{ borderRadius: '2px' }}
      onClick={onClick}
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
  const setModule = useAppStore((s) => s.setModule);
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
  const [upcomingDue, setUpcomingDue] = useState<UpcomingInvoice[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);

  const { start, end } = useMemo(() => dateRange(period), [period]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [statsData, cashflowData, activityData, dueData, clientsData] = await Promise.all([
          api.dashboardStats(start, end),
          api.dashboardCashflow(start, end),
          api.rawQuery(
            'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 10'
          ),
          api.rawQuery(
            `SELECT i.*, c.name as client_name FROM invoices i
             LEFT JOIN clients c ON i.client_id = c.id
             WHERE i.status IN ('sent','partial') AND i.due_date <= date('now', '+7 days') AND i.due_date >= date('now')
             ORDER BY i.due_date ASC LIMIT 5`
          ),
          api.rawQuery(
            `SELECT c.name, COALESCE(SUM(i.amount_paid), 0) as total_paid
             FROM clients c
             LEFT JOIN invoices i ON i.client_id = c.id AND i.issue_date >= date('now', '-90 days')
             GROUP BY c.id
             HAVING total_paid > 0
             ORDER BY total_paid DESC
             LIMIT 5`
          ),
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
            outstanding: statsData.outstanding ?? 0,
            outstandingChange: statsData.outstandingChange ?? 0,
          });
        }

        if (cashflowData && Array.isArray(cashflowData)) {
          setCashflow(cashflowData);
        }

        if (activityData && Array.isArray(activityData)) {
          setRecentActivity(activityData);
        }

        if (dueData && Array.isArray(dueData)) {
          setUpcomingDue(dueData);
        }

        if (clientsData && Array.isArray(clientsData)) {
          setTopClients(clientsData);
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

  // Top client max for bar scaling
  const maxClientRevenue = topClients.length > 0
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

      {/* Cash Flow Chart */}
      <div
        className="block-card p-5"
        style={{ borderRadius: '2px' }}
      >
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Cash Flow
        </h2>
        <div style={{ width: '100%', height: 256, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height={256}>
            <LineChart data={cashflow}>
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
                dataKey="expenses"
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

      {/* ─── Bottom 2-Column Grid: Activity + Due/Clients ─── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left Column: Recent Activity */}
        <div
          className="block-card p-5"
          style={{ borderRadius: '2px' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-text-muted" />
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Recent Activity
            </h2>
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
                      {entry.action}
                    </span>
                    <span className="text-xs text-text-primary flex-1 truncate">
                      {entry.entity_type}
                      <span className="text-text-muted ml-1">#{entry.entity_id?.slice(0, 8)}</span>
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
          <div
            className="block-card p-5"
            style={{ borderRadius: '2px' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={14} className="text-text-muted" />
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Upcoming Due
              </h2>
            </div>
            {upcomingDue.length === 0 ? (
              <p className="text-xs text-text-muted">No invoices due in the next 7 days</p>
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
          <div
            className="block-card p-5"
            style={{ borderRadius: '2px' }}
          >
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
                  const pct = maxClientRevenue > 0 ? (client.total_paid / maxClientRevenue) * 100 : 0;
                  return (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-primary truncate">{client.name}</span>
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
