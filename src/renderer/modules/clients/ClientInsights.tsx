import React, { useEffect, useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  DollarSign,
  AlertTriangle,
  Clock,
  FolderKanban,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Zap,
  Printer,
  CheckCircle,
  BarChart3,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface ClientInsightsProps {
  clientId: string;
}

interface InsightsData {
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
  avg_payment_days: number;
  status_breakdown: Array<{ status: string; count: number }>;
  payment_history: Array<{ month: string; total: number }>;
  active_projects: number;
  lifetime_value: number;
}

interface ProfitabilityData {
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
}

interface TimeSummary {
  total_minutes: number;
  billable_minutes: number;
  billed_amount: number;
  effective_rate: number;
}

interface ProjectStats {
  total: number;
  completed: number;
  active: number;
  avg_budget: number;
  on_budget_pct: number;
}

interface ComparativeData {
  revenue_vs_avg: number; // percentage above/below
  payment_days_vs_avg: number;
  outstanding_vs_avg: number;
  avg_client_revenue: number;
  avg_client_days: number;
  avg_client_outstanding: number;
}

interface PaymentMethodEntry {
  method: string;
  total: number;
}

// ─── Status Badge Colors ────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  paid: 'block-badge block-badge-income',
  sent: 'block-badge block-badge-warning',
  draft: 'block-badge block-badge-blue',
  overdue: 'block-badge block-badge-expense',
  partial: 'block-badge block-badge-purple',
  void: 'block-badge',
  cancelled: 'block-badge',
};

// ─── Pie Colors ─────────────────────────────────────────
const PIE_COLORS = [
  'rgba(52, 211, 153, 0.8)',
  'rgba(96, 165, 250, 0.8)',
  'rgba(245, 158, 11, 0.8)',
  'rgba(167, 139, 250, 0.8)',
  'rgba(239, 68, 68, 0.6)',
  'rgba(236, 72, 153, 0.6)',
];

// ─── Custom Tooltip ─────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'rgba(15, 15, 20, 0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '6px',
        padding: '8px 12px',
      }}
    >
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, margin: 0 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? '#34d399', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, margin: '2px 0 0' }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'rgba(15, 15, 20, 0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '6px',
        padding: '8px 12px',
      }}
    >
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, margin: 0, textTransform: 'capitalize' }}>
        {payload[0].name}: {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
};

// ─── Engagement Score Calculator ────────────────────────
function computeEngagementScore(
  daysSinceLastInvoice: number,
  invoicesPerYear: number,
  revenuePercentile: number
): { score: number; label: string; color: string } {
  // Recency: 0-40 points (lower days = higher score)
  const recency = Math.max(0, 40 - Math.min(40, daysSinceLastInvoice / 10));
  // Frequency: 0-30 points
  const frequency = Math.min(30, invoicesPerYear * 2.5);
  // Monetary: 0-30 points
  const monetary = Math.min(30, revenuePercentile * 30);

  const score = Math.round(recency + frequency + monetary);
  if (score >= 70) return { score, label: 'Highly Engaged', color: '#34d399' };
  if (score >= 40) return { score, label: 'Moderately Engaged', color: '#f59e0b' };
  return { score, label: 'Low Engagement', color: '#ef4444' };
}

function getChurnRisk(engagementScore: number, daysSinceLastActivity: number): { label: string; color: string; bg: string } {
  if (daysSinceLastActivity > 180 || engagementScore < 25) return { label: 'High', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
  if (daysSinceLastActivity > 90 || engagementScore < 50) return { label: 'Medium', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  return { label: 'Low', color: '#34d399', bg: 'rgba(52,211,153,0.12)' };
}

// ─── Component ──────────────────────────────────────────
const ClientInsights: React.FC<ClientInsightsProps> = ({ clientId }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Feature 43-44: Profitability & Revenue Trend
  const [profitability, setProfitability] = useState<ProfitabilityData>({ revenue: 0, expenses: 0, profit: 0, margin: 0 });
  const [revenueTrend, setRevenueTrend] = useState<any[]>([]);

  // Feature 45: Invoice success rate
  const [invoiceSuccessRate, setInvoiceSuccessRate] = useState(0);
  const [totalInvoiceCount, setTotalInvoiceCount] = useState(0);

  // Feature 46: Payment methods
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodEntry[]>([]);

  // Feature 47-48: Engagement & Churn
  const [engagementInput, setEngagementInput] = useState({ daysSinceLastInvoice: 999, invoicesPerYear: 0, revenuePercentile: 0 });
  const [daysSinceLastActivity, setDaysSinceLastActivity] = useState(999);

  // Feature 49-50: Project & Time
  const [projectStats, setProjectStats] = useState<ProjectStats>({ total: 0, completed: 0, active: 0, avg_budget: 0, on_budget_pct: 0 });
  const [timeSummary, setTimeSummary] = useState<TimeSummary>({ total_minutes: 0, billable_minutes: 0, billed_amount: 0, effective_rate: 0 });

  // Feature 51: Comparative performance
  const [comparative, setComparative] = useState<ComparativeData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const companyId = activeCompany?.id;
    const load = async () => {
      try {
        setLoading(true);
        const result = await api.clientInsights(clientId);
        if (!cancelled) setData(result);

        // Feature 43: Profitability
        try {
          const expRows = await api.rawQuery(
            `SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE client_id = ? AND company_id = ?`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(expRows) && expRows.length > 0) {
            const expenses = (expRows[0] as any).total_expenses ?? 0;
            const revenue = result?.total_invoiced ?? 0;
            const profit = revenue - expenses;
            setProfitability({
              revenue,
              expenses,
              profit,
              margin: revenue > 0 ? (profit / revenue) * 100 : 0,
            });
          }
        } catch { /* ignore */ }

        // Feature 44: Revenue Trend (this year vs last year)
        try {
          const trendRows = await api.rawQuery(
            `SELECT strftime('%m', issue_date) as month_num,
              COALESCE(SUM(CASE WHEN strftime('%Y', issue_date) = strftime('%Y', 'now') THEN total ELSE 0 END), 0) as this_year,
              COALESCE(SUM(CASE WHEN strftime('%Y', issue_date) = CAST(CAST(strftime('%Y', 'now') AS INTEGER) - 1 AS TEXT) THEN total ELSE 0 END), 0) as last_year
            FROM invoices WHERE client_id = ? AND company_id = ?
              AND issue_date >= date('now', '-24 months')
            GROUP BY month_num ORDER BY month_num`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(trendRows)) {
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            setRevenueTrend(trendRows.map((r: any) => ({
              month: months[parseInt(r.month_num, 10) - 1] ?? r.month_num,
              this_year: r.this_year ?? 0,
              last_year: r.last_year ?? 0,
            })));
          }
        } catch { /* ignore */ }

        // Feature 45: Invoice success rate
        try {
          const invCountRows = await api.rawQuery(
            `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count
             FROM invoices WHERE client_id = ? AND company_id = ?`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(invCountRows) && invCountRows.length > 0) {
            const total = (invCountRows[0] as any).total ?? 0;
            const paid = (invCountRows[0] as any).paid_count ?? 0;
            setTotalInvoiceCount(total);
            setInvoiceSuccessRate(total > 0 ? (paid / total) * 100 : 0);
          }
        } catch { /* ignore */ }

        // Feature 46: Payment methods
        try {
          const methodRows = await api.rawQuery(
            `SELECT COALESCE(NULLIF(p.payment_method, ''), 'unspecified') as method, COALESCE(SUM(p.amount), 0) as total
             FROM payments p JOIN invoices i ON p.invoice_id = i.id
             WHERE i.client_id = ? AND i.company_id = ?
             GROUP BY method ORDER BY total DESC`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(methodRows)) setPaymentMethods(methodRows as PaymentMethodEntry[]);
        } catch { /* ignore */ }

        // Feature 47-48: Engagement inputs
        try {
          const engRows = await api.rawQuery(
            `SELECT
              CAST(julianday('now') - julianday(MAX(issue_date)) AS INTEGER) as days_since_last,
              COUNT(*) as total_invoices,
              CAST(julianday(MAX(issue_date)) - julianday(MIN(issue_date)) AS REAL) / 365.0 as span_years
            FROM invoices WHERE client_id = ? AND company_id = ?`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(engRows) && engRows.length > 0) {
            const row = engRows[0] as any;
            const daysSince = row.days_since_last ?? 999;
            const invPerYear = (row.span_years ?? 0) > 0 ? (row.total_invoices ?? 0) / row.span_years : (row.total_invoices ?? 0);
            setEngagementInput({ daysSinceLastInvoice: daysSince, invoicesPerYear: invPerYear, revenuePercentile: 0.5 }); // default percentile
            setDaysSinceLastActivity(daysSince);
          }
        } catch { /* ignore */ }

        // Revenue percentile (compare against other clients)
        try {
          const pctRows = await api.rawQuery(
            `SELECT c.id,
              COALESCE((SELECT SUM(total) FROM invoices WHERE client_id = c.id AND company_id = ?), 0) as rev
            FROM clients c WHERE c.company_id = ? AND c.status = 'active'
            ORDER BY rev`,
            [companyId, companyId]
          );
          if (!cancelled && Array.isArray(pctRows) && pctRows.length > 0) {
            const idx = pctRows.findIndex((r: any) => r.id === clientId);
            const percentile = pctRows.length > 1 ? idx / (pctRows.length - 1) : 0.5;
            setEngagementInput(prev => ({ ...prev, revenuePercentile: percentile }));
          }
        } catch { /* ignore */ }

        // Feature 49: Project performance
        try {
          const projRows = await api.rawQuery(
            `SELECT
              COUNT(*) as total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
              AVG(CASE WHEN budget > 0 THEN budget ELSE NULL END) as avg_budget
            FROM projects WHERE client_id = ? AND company_id = ?`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(projRows) && projRows.length > 0) {
            const r = projRows[0] as any;
            setProjectStats({
              total: r.total ?? 0,
              completed: r.completed ?? 0,
              active: r.active_count ?? 0,
              avg_budget: r.avg_budget ?? 0,
              on_budget_pct: 0, // Would need actual spend vs budget
            });
          }
        } catch { /* ignore */ }

        // Feature 50: Time summary
        try {
          const timeRows = await api.rawQuery(
            `SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes,
              COALESCE(SUM(CASE WHEN is_billable = 1 THEN duration_minutes ELSE 0 END), 0) as billable_minutes,
              COALESCE(SUM(CASE WHEN is_billable = 1 THEN duration_minutes * COALESCE(hourly_rate, 0) / 60.0 ELSE 0 END), 0) as billed_amount
            FROM time_entries WHERE client_id = ?`,
            [clientId]
          );
          if (!cancelled && Array.isArray(timeRows) && timeRows.length > 0) {
            const r = timeRows[0] as any;
            const billableHrs = (r.billable_minutes ?? 0) / 60;
            setTimeSummary({
              total_minutes: r.total_minutes ?? 0,
              billable_minutes: r.billable_minutes ?? 0,
              billed_amount: r.billed_amount ?? 0,
              effective_rate: billableHrs > 0 ? (r.billed_amount ?? 0) / billableHrs : 0,
            });
          }
        } catch { /* ignore */ }

        // Feature 51: Comparative performance
        try {
          const compRows = await api.rawQuery(
            `SELECT
              AVG(client_rev) as avg_rev,
              AVG(client_outstanding) as avg_outstanding,
              AVG(client_days) as avg_days
            FROM (
              SELECT c.id,
                COALESCE((SELECT SUM(total) FROM invoices WHERE client_id = c.id AND company_id = ?), 0) as client_rev,
                COALESCE((SELECT SUM(total - amount_paid) FROM invoices WHERE client_id = c.id AND company_id = ? AND status NOT IN ('paid','void','cancelled')), 0) as client_outstanding,
                COALESCE((SELECT AVG(CAST(julianday(p.date) - julianday(i.issue_date) AS INTEGER))
                  FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.client_id = c.id AND i.company_id = ?), 0) as client_days
              FROM clients c WHERE c.company_id = ? AND c.status = 'active'
            )`,
            [companyId, companyId, companyId, companyId]
          );
          if (!cancelled && Array.isArray(compRows) && compRows.length > 0) {
            const avg = compRows[0] as any;
            const avgRev = avg.avg_rev ?? 0;
            const avgOutstanding = avg.avg_outstanding ?? 0;
            const avgDays = avg.avg_days ?? 0;
            const clientRev = result?.total_invoiced ?? 0;
            const clientOutstanding = result?.outstanding ?? 0;
            const clientDays = result?.avg_payment_days ?? 0;

            setComparative({
              revenue_vs_avg: avgRev > 0 ? ((clientRev - avgRev) / avgRev) * 100 : 0,
              payment_days_vs_avg: avgDays > 0 ? ((clientDays - avgDays) / avgDays) * 100 : 0,
              outstanding_vs_avg: avgOutstanding > 0 ? ((clientOutstanding - avgOutstanding) / avgOutstanding) * 100 : 0,
              avg_client_revenue: avgRev,
              avg_client_days: Math.round(avgDays),
              avg_client_outstanding: avgOutstanding,
            });
          }
        } catch { /* ignore */ }
      } catch (err) {
        console.error('Failed to load client insights:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clientId, activeCompany]);

  // Feature 47: Compute engagement
  const engagement = useMemo(() =>
    computeEngagementScore(engagementInput.daysSinceLastInvoice, engagementInput.invoicesPerYear, engagementInput.revenuePercentile),
    [engagementInput]
  );

  // Feature 48: Churn risk
  const churnRisk = useMemo(() =>
    getChurnRisk(engagement.score, daysSinceLastActivity),
    [engagement.score, daysSinceLastActivity]
  );

  // Feature 52: Print Client Report
  const handlePrintReport = async () => {
    if (!data) return;
    const html = `
      <div style="font-family: 'Inter', system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
        <div style="border-bottom: 3px solid #1a1a2e; padding-bottom: 20px; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 24px; color: #1a1a2e;">Client Analysis Report</h1>
          <p style="margin: 4px 0 0; color: #666; font-size: 14px;">Generated ${new Date().toLocaleDateString()}</p>
        </div>

        <h2 style="font-size: 16px; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #666;">Key Performance Indicators</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 30px;">
          <thead><tr style="border-bottom: 2px solid #e5e7eb;">
            <th style="text-align: left; padding: 8px 4px;">Metric</th>
            <th style="text-align: right; padding: 8px 4px;">Value</th>
          </tr></thead>
          <tbody>
            <tr><td style="padding: 6px 4px;">Lifetime Value</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${(data.lifetime_value ?? 0).toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 4px;">Total Invoiced</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${(data.total_invoiced ?? 0).toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 4px;">Total Paid</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${(data.total_paid ?? 0).toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 4px;">Outstanding</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${(data.outstanding ?? 0).toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 4px;">Avg Payment Days</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">${data.avg_payment_days > 0 ? `${data.avg_payment_days}d` : '--'}</td></tr>
            <tr><td style="padding: 6px 4px;">Active Projects</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">${data.active_projects}</td></tr>
          </tbody>
        </table>

        <h2 style="font-size: 16px; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #666;">Profitability</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 30px;">
          <thead><tr style="border-bottom: 2px solid #e5e7eb;">
            <th style="text-align: left; padding: 8px 4px;">Metric</th>
            <th style="text-align: right; padding: 8px 4px;">Value</th>
          </tr></thead>
          <tbody>
            <tr><td style="padding: 6px 4px;">Revenue</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${profitability.revenue.toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 4px;">Expenses</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${profitability.expenses.toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 4px; font-weight: bold;">Net Profit</td><td style="padding: 6px 4px; text-align: right; font-family: monospace; font-weight: bold;">$${profitability.profit.toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 4px;">Margin</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">${profitability.margin.toFixed(1)}%</td></tr>
          </tbody>
        </table>

        <h2 style="font-size: 16px; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #666;">Engagement & Risk</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 30px;">
          <tbody>
            <tr><td style="padding: 6px 4px;">Engagement Score</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">${engagement.score}/100 (${engagement.label})</td></tr>
            <tr><td style="padding: 6px 4px;">Churn Risk</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">${churnRisk.label}</td></tr>
            <tr><td style="padding: 6px 4px;">Invoice Success Rate</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">${invoiceSuccessRate.toFixed(1)}%</td></tr>
          </tbody>
        </table>

        <h2 style="font-size: 16px; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #666;">Time & Materials</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 30px;">
          <tbody>
            <tr><td style="padding: 6px 4px;">Total Hours</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">${(timeSummary.total_minutes / 60).toFixed(1)}h</td></tr>
            <tr><td style="padding: 6px 4px;">Billable Hours</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">${(timeSummary.billable_minutes / 60).toFixed(1)}h</td></tr>
            <tr><td style="padding: 6px 4px;">Billed Amount</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${timeSummary.billed_amount.toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 4px;">Effective Rate</td><td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${timeSummary.effective_rate.toFixed(2)}/hr</td></tr>
          </tbody>
        </table>

        <h2 style="font-size: 16px; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #666;">Payment History</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 30px;">
          <thead><tr style="border-bottom: 2px solid #e5e7eb;">
            <th style="text-align: left; padding: 8px 4px;">Month</th>
            <th style="text-align: right; padding: 8px 4px;">Amount</th>
          </tr></thead>
          <tbody>${(data.payment_history ?? []).map((p) => `
            <tr><td style="padding: 4px;">${p.month}</td><td style="padding: 4px; text-align: right; font-family: monospace;">$${(p.total ?? 0).toFixed(2)}</td></tr>
          `).join('')}</tbody>
        </table>

        ${comparative ? `
        <h2 style="font-size: 16px; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #666;">Comparative Performance</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 30px;">
          <thead><tr style="border-bottom: 2px solid #e5e7eb;">
            <th style="text-align: left; padding: 8px 4px;">Metric</th>
            <th style="text-align: right; padding: 8px 4px;">Client</th>
            <th style="text-align: right; padding: 8px 4px;">Portfolio Avg</th>
            <th style="text-align: right; padding: 8px 4px;">Diff</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style="padding: 6px 4px;">Revenue</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${(data.total_invoiced ?? 0).toFixed(2)}</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${comparative.avg_client_revenue.toFixed(2)}</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">${comparative.revenue_vs_avg >= 0 ? '+' : ''}${comparative.revenue_vs_avg.toFixed(1)}%</td>
            </tr>
            <tr>
              <td style="padding: 6px 4px;">Payment Days</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">${data.avg_payment_days}d</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">${comparative.avg_client_days}d</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">${comparative.payment_days_vs_avg >= 0 ? '+' : ''}${comparative.payment_days_vs_avg.toFixed(1)}%</td>
            </tr>
            <tr>
              <td style="padding: 6px 4px;">Outstanding</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${(data.outstanding ?? 0).toFixed(2)}</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">$${comparative.avg_client_outstanding.toFixed(2)}</td>
              <td style="padding: 6px 4px; text-align: right; font-family: monospace;">${comparative.outstanding_vs_avg >= 0 ? '+' : ''}${comparative.outstanding_vs_avg.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
        ` : ''}

        <div style="border-top: 2px solid #1a1a2e; padding-top: 16px; text-align: right; font-size: 12px; color: #999;">
          Business Accounting Pro &mdash; Client Analysis
        </div>
      </div>
    `;
    await api.printPreview(html, 'Client Analysis Report');
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-text-muted font-mono">
        Loading insights...
      </div>
    );
  }

  if (!data) return null;

  // Reverse payment history for chronological chart order
  const chartData = [...(data.payment_history || [])].reverse().map((entry) => ({
    month: entry.month,
    total: entry.total,
  }));

  return (
    <div className="space-y-4">
      {/* Section Heading + Print */}
      <div className="flex items-center justify-between">
        <h3
          className="text-xs font-bold text-text-muted uppercase tracking-wider"
          style={{ letterSpacing: '0.08em' }}
        >
          Client Insights
        </h3>
        {/* Feature 52: Print Report */}
        <button className="block-btn text-xs inline-flex items-center gap-1" onClick={handlePrintReport}>
          <Printer size={12} /> Print Report
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card border-l-2 border-l-accent-income" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign size={12} className="text-text-muted" />
            <span className="stat-label">Lifetime Value</span>
          </div>
          <span className="stat-value text-accent-income">{formatCurrency(data.lifetime_value)}</span>
        </div>

        <div className="stat-card border-l-2 border-l-accent-warning" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} className="text-text-muted" />
            <span className="stat-label">Outstanding</span>
          </div>
          <span className="stat-value text-accent-warning">{formatCurrency(data.outstanding)}</span>
        </div>

        <div className="stat-card border-l-2 border-l-accent-blue" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Clock size={12} className="text-text-muted" />
            <span className="stat-label">Avg Payment Days</span>
          </div>
          <span className="stat-value text-text-primary">
            {data.avg_payment_days > 0 ? `${data.avg_payment_days}d` : '--'}
          </span>
        </div>

        <div className="stat-card border-l-2 border-l-accent-purple" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <FolderKanban size={12} className="text-text-muted" />
            <span className="stat-label">Active Projects</span>
          </div>
          <span className="stat-value text-text-primary">{data.active_projects}</span>
        </div>
      </div>

      {/* Feature 43: Profitability Analysis */}
      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <span className="stat-label">Revenue</span>
          <span className="stat-value text-accent-income">{formatCurrency(profitability.revenue)}</span>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <span className="stat-label">Expenses</span>
          <span className="stat-value text-accent-expense">{formatCurrency(profitability.expenses)}</span>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <span className="stat-label">Net Profit</span>
          <span className={`stat-value ${profitability.profit >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
            {formatCurrency(profitability.profit)}
          </span>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <span className="stat-label">Margin</span>
          <span className={`stat-value ${profitability.margin >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
            {profitability.margin.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Feature 47-48: Engagement Score + Churn Risk + Feature 45: Success Rate */}
      <div className="grid grid-cols-3 gap-4">
        {/* Engagement Score */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Zap size={12} className="text-text-muted" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Engagement Score</span>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-mono font-bold" style={{ color: engagement.color }}>{engagement.score}</span>
            <span className="text-xs text-text-muted mb-1">/100</span>
          </div>
          <div className="text-xs font-semibold mt-1" style={{ color: engagement.color }}>{engagement.label}</div>
          {/* Score bar */}
          <div className="mt-2 h-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
            <div className="h-full transition-all" style={{ width: `${engagement.score}%`, background: engagement.color, borderRadius: '6px' }} />
          </div>
        </div>

        {/* Churn Risk */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={12} className="text-text-muted" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Churn Risk</span>
          </div>
          <span
            className="inline-block text-xs font-bold uppercase tracking-wider px-3 py-1 mt-1"
            style={{ color: churnRisk.color, background: churnRisk.bg, borderRadius: '6px' }}
          >
            {churnRisk.label}
          </span>
          <p className="text-xs text-text-muted mt-2">
            {daysSinceLastActivity < 999
              ? `Last activity ${daysSinceLastActivity} days ago`
              : 'No recent activity'
            }
          </p>
        </div>

        {/* Invoice Success Rate */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle size={12} className="text-text-muted" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Invoice Success Rate</span>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-mono font-bold text-text-primary">{invoiceSuccessRate.toFixed(1)}%</span>
          </div>
          <p className="text-xs text-text-muted mt-1">{totalInvoiceCount} total invoices</p>
          {/* Progress bar */}
          <div className="mt-2 h-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
            <div className="h-full transition-all" style={{ width: `${invoiceSuccessRate}%`, background: 'rgba(52,211,153,0.7)', borderRadius: '6px' }} />
          </div>
        </div>
      </div>

      {/* Payment History Chart + Status Breakdown + Feature 46: Payment Methods */}
      <div className="grid grid-cols-3 gap-4">
        {/* Chart */}
        <div
          className="col-span-2 block-card"
          style={{
            borderRadius: '6px',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            Payment History (Last 12 Months)
          </h4>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis
                  dataKey="month"
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={48}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar
                  dataKey="total"
                  name="Payments"
                  fill="rgba(52, 211, 153, 0.7)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-xs text-text-muted font-mono">
              No payment data available
            </div>
          )}
        </div>

        {/* Status Breakdown */}
        <div
          className="block-card"
          style={{
            borderRadius: '6px',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            Invoice Status
          </h4>
          {data.status_breakdown && data.status_breakdown.length > 0 ? (
            <div className="space-y-2">
              {data.status_breakdown.map((entry) => (
                <div key={entry.status} className="flex items-center justify-between">
                  <span className={`${STATUS_BADGE[entry.status] ?? 'block-badge'} capitalize`}>
                    {entry.status}
                  </span>
                  <span className="text-xs font-mono text-text-secondary font-bold">
                    {entry.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-xs text-text-muted font-mono">
              No invoices yet
            </div>
          )}
        </div>
      </div>

      {/* Feature 44: Revenue Trend (YoY) + Feature 46: Payment Method Distribution */}
      <div className="grid grid-cols-2 gap-4">
        {/* Revenue Trend */}
        <div className="block-card p-4" style={{ borderRadius: '6px', background: 'rgba(255,255,255,0.02)' }}>
          <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            Revenue Trend (This Year vs Last Year)
          </h4>
          {revenueTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={revenueTrend} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} width={48} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }} />
                <Line type="monotone" dataKey="this_year" name="This Year" stroke="#34d399" strokeWidth={2} dot={{ fill: '#34d399', r: 3 }} />
                <Line type="monotone" dataKey="last_year" name="Last Year" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeDasharray="4 4" dot={{ fill: 'rgba(255,255,255,0.25)', r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-xs text-text-muted font-mono">No trend data</div>
          )}
        </div>

        {/* Payment Methods Pie */}
        <div className="block-card p-4" style={{ borderRadius: '6px', background: 'rgba(255,255,255,0.02)' }}>
          <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            Payment Methods
          </h4>
          {paymentMethods.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={paymentMethods}
                  dataKey="total"
                  nameKey="method"
                  cx="50%"
                  cy="50%"
                  outerRadius={65}
                  innerRadius={30}
                  paddingAngle={2}
                >
                  {paymentMethods.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} formatter={(value: string) => <span style={{ color: 'rgba(255,255,255,0.5)', textTransform: 'capitalize' }}>{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-xs text-text-muted font-mono">No payment data</div>
          )}
        </div>
      </div>

      {/* Feature 49-50: Project Performance + Time Summary */}
      <div className="grid grid-cols-2 gap-4">
        {/* Project Stats */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-3">
            <FolderKanban size={12} className="text-text-muted" />
            <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider">Project Performance</h4>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total</div>
              <div className="text-lg font-mono font-bold text-text-primary">{projectStats.total}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Completed</div>
              <div className="text-lg font-mono font-bold text-accent-income">{projectStats.completed}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active</div>
              <div className="text-lg font-mono font-bold text-accent-blue">{projectStats.active}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Budget</div>
              <div className="text-lg font-mono font-bold text-text-primary">{projectStats.avg_budget > 0 ? formatCurrency(projectStats.avg_budget) : '--'}</div>
            </div>
          </div>
        </div>

        {/* Time Summary */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-3">
            <Clock size={12} className="text-text-muted" />
            <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider">Time & Materials</h4>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Hours</div>
              <div className="text-lg font-mono font-bold text-text-primary">{(timeSummary.total_minutes / 60).toFixed(1)}h</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Billable Hours</div>
              <div className="text-lg font-mono font-bold text-accent-income">{(timeSummary.billable_minutes / 60).toFixed(1)}h</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Billed Amount</div>
              <div className="text-lg font-mono font-bold text-text-primary">{formatCurrency(timeSummary.billed_amount)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Effective Rate</div>
              <div className="text-lg font-mono font-bold text-accent-blue">{timeSummary.effective_rate > 0 ? `${formatCurrency(timeSummary.effective_rate)}/hr` : '--'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Feature 51: Comparative Performance */}
      {comparative && (
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-3">
            <Target size={12} className="text-text-muted" />
            <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider">Comparative Performance vs Portfolio Average</h4>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <ComparisonCard
              label="Revenue"
              clientValue={formatCurrency(data.total_invoiced)}
              avgValue={formatCurrency(comparative.avg_client_revenue)}
              pctDiff={comparative.revenue_vs_avg}
              higherIsBetter={true}
            />
            <ComparisonCard
              label="Payment Days"
              clientValue={`${data.avg_payment_days}d`}
              avgValue={`${comparative.avg_client_days}d`}
              pctDiff={comparative.payment_days_vs_avg}
              higherIsBetter={false}
            />
            <ComparisonCard
              label="Outstanding"
              clientValue={formatCurrency(data.outstanding)}
              avgValue={formatCurrency(comparative.avg_client_outstanding)}
              pctDiff={comparative.outstanding_vs_avg}
              higherIsBetter={false}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Comparison Card Sub-component ──────────────────────
const ComparisonCard: React.FC<{
  label: string;
  clientValue: string;
  avgValue: string;
  pctDiff: number;
  higherIsBetter: boolean;
}> = ({ label, clientValue, avgValue, pctDiff, higherIsBetter }) => {
  const isPositive = higherIsBetter ? pctDiff >= 0 : pctDiff <= 0;
  const color = isPositive ? 'text-accent-income' : 'text-accent-expense';
  const Icon = pctDiff > 0 ? ArrowUp : pctDiff < 0 ? ArrowDown : Minus;

  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm font-mono font-bold text-text-primary">{clientValue}</div>
      <div className="text-xs text-text-muted mt-1">avg: {avgValue}</div>
      <div className={`flex items-center justify-center gap-1 mt-1 text-xs font-mono font-bold ${color}`}>
        <Icon size={10} />
        {Math.abs(pctDiff).toFixed(1)}%
      </div>
    </div>
  );
};

export default ClientInsights;
