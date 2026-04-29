import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  FileText,
  Repeat,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Clock,
  CheckCircle,
  ArrowRight,
  Plus,
  Send,
  Bell,
  Printer,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { formatCurrency, formatDate } from '../../lib/format';
import InvoiceList from './InvoiceList';
import InvoiceForm from './InvoiceForm';
import InvoiceDetail from './InvoiceDetail';
import InvoiceSettings from './InvoiceSettings';
import CatalogManager from './CatalogManager';

// ─── Types ──────────────────────────────────────────────
type Tab = 'dashboard' | 'invoices' | 'recurring' | 'analytics';
type InvoiceView = 'list' | 'detail' | 'form';

type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; invoiceId: string }
  | { type: 'detail'; invoiceId: string }
  | { type: 'settings' }
  | { type: 'catalog' };

interface DashboardStats {
  total_count: number;
  total_invoiced: number;
  total_collected: number;
  outstanding: number;
  overdue: number;
  avg_value: number;
  paid_count: number;
  sent_count: number;
  month_count: number;
  month_total: number;
  avg_days_to_pay: number;
}

interface AgingRow {
  bucket: string;
  count: number;
  amount: number;
}

interface ClientOutstanding {
  client_id: string;
  client_name: string;
  outstanding: number;
  oldest_due: string;
  invoice_count: number;
}

interface ActivityRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  activity_type: string;
  description: string;
  user_name: string;
  created_at: string;
}

interface MonthlyTrend {
  month: string;
  total: number;
  count: number;
}

interface ForecastResult {
  predicted_inflow?: number;
  predicted_outflow?: number;
  net_position?: number;
  confidence_low?: number;
  confidence_high?: number;
  [key: string]: any;
}

interface DuplicateInvoice {
  id: string;
  invoice_number: string;
  client_name?: string;
  total?: number;
  [key: string]: any;
}

// ─── Tab Button ─────────────────────────────────────────
const TabBtn: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? 'bg-bg-tertiary text-text-primary border-b-2 border-accent-blue'
        : 'text-text-muted hover:text-text-secondary'
    }`}
    style={{ borderRadius: '6px 6px 0 0' }}
  >
    {icon}
    {label}
  </button>
);

// ─── KPI Card ───────────────────────────────────────────
const KpiCard: React.FC<{
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: 'blue' | 'green' | 'red' | 'orange' | 'purple';
}> = ({ label, value, hint, icon, accent = 'blue' }) => {
  const colors: Record<string, string> = {
    blue: '#3b82f6',
    green: '#22c55e',
    red: '#ef4444',
    orange: '#f59e0b',
    purple: '#8b5cf6',
  };
  return (
    <div className="block-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <span style={{ color: colors[accent] }} aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <div className="text-xl font-bold font-mono text-text-primary">{value}</div>
      {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
};

// ─── Module Router ──────────────────────────────────────
const InvoicingModule: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const setModule = useAppStore((s) => s.setModule);
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);

  const [tab, setTab] = useState<Tab>('dashboard');
  const [view, setView] = useState<View>(() => {
    const flag = sessionStorage.getItem('nav:invoiceNew');
    if (flag) {
      sessionStorage.removeItem('nav:invoiceNew');
      return { type: 'new' };
    }
    return { type: 'list' };
  });

  // Cross-module deep-link
  useEffect(() => {
    const focus = consumeFocusEntity('invoice');
    if (focus) {
      setTab('invoices');
      setView({ type: 'detail', invoiceId: focus.id });
    }
  }, [consumeFocusEntity]);

  // ─── Dashboard data ─────────────────────────────────
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [topClients, setTopClients] = useState<ClientOutstanding[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateInvoice[]>([]);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
    if (!activeCompany || tab !== 'dashboard') return;
    setDashboardLoading(true);
    try {
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const monthStart = new Date().toISOString().slice(0, 7) + '-01';

      // Aggregated stats
      const statsP = api.rawQuery(
        `SELECT
          COUNT(*) as total_count,
          COALESCE(SUM(total), 0) as total_invoiced,
          COALESCE(SUM(amount_paid), 0) as total_collected,
          COALESCE(SUM(CASE WHEN status NOT IN ('paid','void','cancelled') THEN (total - amount_paid) ELSE 0 END), 0) as outstanding,
          COALESCE(SUM(CASE WHEN status='overdue' THEN (total - amount_paid) ELSE 0 END), 0) as overdue,
          COALESCE(AVG(total), 0) as avg_value,
          COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END), 0) as paid_count,
          COALESCE(SUM(CASE WHEN status IN ('sent','partial','overdue','paid') THEN 1 ELSE 0 END), 0) as sent_count,
          COALESCE(SUM(CASE WHEN issue_date >= ? THEN 1 ELSE 0 END), 0) as month_count,
          COALESCE(SUM(CASE WHEN issue_date >= ? THEN total ELSE 0 END), 0) as month_total
        FROM invoices WHERE company_id = ? AND issue_date >= ?`,
        [monthStart, monthStart, activeCompany.id, yearStart]
      );

      // Avg days to pay (issue_date → last payment date)
      const daysP = api.rawQuery(
        `SELECT COALESCE(AVG(julianday(p.last_pay) - julianday(i.issue_date)), 0) as avg_days
         FROM invoices i
         JOIN (SELECT invoice_id, MAX(date) as last_pay FROM payments GROUP BY invoice_id) p
           ON p.invoice_id = i.id
         WHERE i.company_id = ? AND i.status = 'paid' AND i.issue_date >= ?`,
        [activeCompany.id, yearStart]
      );

      // Status counts
      const statusP = api.rawQuery(
        `SELECT status, COUNT(*) as c FROM invoices WHERE company_id = ? GROUP BY status`,
        [activeCompany.id]
      );

      // Aging buckets
      const agingP = api.rawQuery(
        `SELECT
          CASE
            WHEN status IN ('paid','void','cancelled') THEN 'paid'
            WHEN julianday('now') < julianday(due_date) THEN 'current'
            WHEN julianday('now') - julianday(due_date) <= 30 THEN '1-30'
            WHEN julianday('now') - julianday(due_date) <= 60 THEN '31-60'
            WHEN julianday('now') - julianday(due_date) <= 90 THEN '61-90'
            ELSE '90+'
          END as bucket,
          COUNT(*) as count,
          COALESCE(SUM(total - amount_paid), 0) as amount
         FROM invoices
         WHERE company_id = ? AND status NOT IN ('paid','void','cancelled')
         GROUP BY bucket`,
        [activeCompany.id]
      );

      // Top 5 outstanding clients
      const topClientsP = api.rawQuery(
        `SELECT
            c.id as client_id,
            c.name as client_name,
            COALESCE(SUM(i.total - i.amount_paid), 0) as outstanding,
            MIN(i.due_date) as oldest_due,
            COUNT(i.id) as invoice_count
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
         WHERE i.company_id = ? AND i.status NOT IN ('paid','void','cancelled')
         GROUP BY c.id, c.name
         HAVING outstanding > 0
         ORDER BY outstanding DESC
         LIMIT 5`,
        [activeCompany.id]
      );

      // Recent activity
      const activityP = api.rawQuery(
        `SELECT ial.*, i.invoice_number
         FROM invoice_activity_log ial
         JOIN invoices i ON ial.invoice_id = i.id
         WHERE i.company_id = ?
         ORDER BY ial.created_at DESC
         LIMIT 10`,
        [activeCompany.id]
      );

      // 12-month trend
      const trendP = api.rawQuery(
        `SELECT strftime('%Y-%m', issue_date) as month,
                COUNT(*) as count,
                COALESCE(SUM(total), 0) as total
         FROM invoices
         WHERE company_id = ?
           AND issue_date >= date('now', '-12 months')
         GROUP BY month
         ORDER BY month ASC`,
        [activeCompany.id]
      );

      const [statsR, daysR, statusR, agingR, topR, actR, trendR] = await Promise.all([
        statsP, daysP, statusP, agingP, topClientsP, activityP, trendP,
      ]);

      const statsRow = (Array.isArray(statsR) && statsR[0]) || ({} as any);
      const daysRow = (Array.isArray(daysR) && daysR[0]) || ({} as any);
      setStats({
        total_count: Number(statsRow.total_count) || 0,
        total_invoiced: Number(statsRow.total_invoiced) || 0,
        total_collected: Number(statsRow.total_collected) || 0,
        outstanding: Number(statsRow.outstanding) || 0,
        overdue: Number(statsRow.overdue) || 0,
        avg_value: Number(statsRow.avg_value) || 0,
        paid_count: Number(statsRow.paid_count) || 0,
        sent_count: Number(statsRow.sent_count) || 0,
        month_count: Number(statsRow.month_count) || 0,
        month_total: Number(statsRow.month_total) || 0,
        avg_days_to_pay: Number(daysRow.avg_days) || 0,
      });

      const counts: Record<string, number> = {};
      (Array.isArray(statusR) ? statusR : []).forEach((r: any) => {
        counts[String(r.status || 'draft')] = Number(r.c) || 0;
      });
      setStatusCounts(counts);

      setAging(
        (Array.isArray(agingR) ? agingR : []).map((r: any) => ({
          bucket: String(r.bucket),
          count: Number(r.count) || 0,
          amount: Number(r.amount) || 0,
        }))
      );

      setTopClients(
        (Array.isArray(topR) ? topR : []).map((r: any) => ({
          client_id: String(r.client_id),
          client_name: String(r.client_name || ''),
          outstanding: Number(r.outstanding) || 0,
          oldest_due: String(r.oldest_due || ''),
          invoice_count: Number(r.invoice_count) || 0,
        }))
      );

      setActivity(
        (Array.isArray(actR) ? actR : []).map((r: any) => ({
          id: String(r.id),
          invoice_id: String(r.invoice_id),
          invoice_number: String(r.invoice_number || ''),
          activity_type: String(r.activity_type || ''),
          description: String(r.description || ''),
          user_name: String(r.user_name || ''),
          created_at: String(r.created_at || ''),
        }))
      );

      setTrend(
        (Array.isArray(trendR) ? trendR : []).map((r: any) => ({
          month: String(r.month || ''),
          total: Number(r.total) || 0,
          count: Number(r.count) || 0,
        }))
      );

      // Predictive: failures don't block the dashboard
      api.intelCashForecast(30).then((r: any) => {
        if (r && !r.error) setForecast(r);
      }).catch(() => {});

      api.intelDuplicateInvoices().then((r: any) => {
        const arr = Array.isArray(r) ? r : Array.isArray(r?.duplicates) ? r.duplicates : [];
        setDuplicates(arr);
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to load invoice dashboard:', err);
    } finally {
      setDashboardLoading(false);
    }
  }, [activeCompany, tab]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // ─── Year-over-year totals for analytics tab ────────
  const yoy = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const thisYear = trend.filter((t) => t.month.startsWith(String(year)))
      .reduce((s, t) => s + t.total, 0);
    const lastYear = trend.filter((t) => t.month.startsWith(String(year - 1)))
      .reduce((s, t) => s + t.total, 0);
    const change = lastYear > 0 ? ((thisYear - lastYear) / lastYear) * 100 : 0;
    return { thisYear, lastYear, change };
  }, [trend]);

  // ─── Status distribution stacked bar ────────────────
  const statusOrder: Array<{ key: string; label: string; color: string }> = [
    { key: 'draft', label: 'Draft', color: '#6b7280' },
    { key: 'sent', label: 'Sent', color: '#3b82f6' },
    { key: 'partial', label: 'Partial', color: '#f59e0b' },
    { key: 'paid', label: 'Paid', color: '#22c55e' },
    { key: 'overdue', label: 'Overdue', color: '#ef4444' },
    { key: 'void', label: 'Void', color: '#374151' },
  ];
  const totalStatus = statusOrder.reduce((s, x) => s + (statusCounts[x.key] || 0), 0);

  // ─── View / tab routing ─────────────────────────────
  const goToList = useCallback(() => setView({ type: 'list' }), []);
  const goToNew = useCallback(() => setView({ type: 'new' }), []);
  const goToEdit = useCallback((id: string) => setView({ type: 'edit', invoiceId: id }), []);
  const goToDetail = useCallback((id: string) => setView({ type: 'detail', invoiceId: id }), []);
  const goToSettings = useCallback(() => setView({ type: 'settings' }), []);
  const goToCatalog = useCallback(() => setView({ type: 'catalog' }), []);

  const handleSaved = useCallback((id: string) => {
    setView({ type: 'detail', invoiceId: id });
  }, []);

  // If we're on a sub-view of the invoices tab (form, detail, settings, catalog),
  // render that view full-screen (matches old UX).
  const renderInvoicesTab = () => {
    switch (view.type) {
      case 'new':
        return <InvoiceForm onBack={goToList} onSaved={handleSaved} />;
      case 'edit':
        return (
          <InvoiceForm
            invoiceId={view.invoiceId}
            onBack={() => goToDetail(view.invoiceId)}
            onSaved={handleSaved}
          />
        );
      case 'detail':
        return (
          <InvoiceDetail
            invoiceId={view.invoiceId}
            onBack={goToList}
            onEdit={goToEdit}
          />
        );
      case 'settings':
        return <InvoiceSettings onBack={goToList} />;
      case 'catalog':
        return <CatalogManager onBack={goToList} />;
      case 'list':
      default:
        return (
          <InvoiceList
            onNewInvoice={goToNew}
            onViewInvoice={goToDetail}
            onEditInvoice={goToEdit}
            onSettings={goToSettings}
            onCatalog={goToCatalog}
          />
        );
    }
  };

  const handlePrintDashboard = async () => {
    if (!stats) return;
    const html = `
      <html><head><title>Invoice Dashboard Summary</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 32px; color: #111; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        .sub { color: #555; font-size: 12px; margin-bottom: 24px; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
        .kpi { border: 1px solid #ccc; padding: 12px; border-radius: 6px; }
        .kpi-label { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: 0.05em; }
        .kpi-value { font-size: 18px; font-weight: 700; margin-top: 4px; }
        h2 { font-size: 14px; margin-top: 24px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
        th { background: #f4f4f4; }
        .num { text-align: right; font-family: monospace; }
      </style></head><body>
        <h1>Invoice Dashboard Summary</h1>
        <div class="sub">${activeCompany?.name || ''} — Generated ${new Date().toLocaleDateString()}</div>
        <div class="grid">
          <div class="kpi"><div class="kpi-label">Total Invoiced YTD</div><div class="kpi-value">${formatCurrency(stats.total_invoiced)}</div></div>
          <div class="kpi"><div class="kpi-label">Total Collected YTD</div><div class="kpi-value">${formatCurrency(stats.total_collected)}</div></div>
          <div class="kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value">${formatCurrency(stats.outstanding)}</div></div>
          <div class="kpi"><div class="kpi-label">Overdue</div><div class="kpi-value">${formatCurrency(stats.overdue)}</div></div>
          <div class="kpi"><div class="kpi-label">Avg Invoice Value</div><div class="kpi-value">${formatCurrency(stats.avg_value)}</div></div>
          <div class="kpi"><div class="kpi-label">Avg Days to Pay</div><div class="kpi-value">${stats.avg_days_to_pay.toFixed(1)} days</div></div>
          <div class="kpi"><div class="kpi-label">Win Rate</div><div class="kpi-value">${stats.sent_count > 0 ? ((stats.paid_count / stats.sent_count) * 100).toFixed(1) : '0.0'}%</div></div>
          <div class="kpi"><div class="kpi-label">This Month</div><div class="kpi-value">${formatCurrency(stats.month_total)}</div></div>
        </div>
        <h2>Top Outstanding Clients</h2>
        <table>
          <thead><tr><th>Client</th><th class="num">Outstanding</th><th>Oldest Due</th></tr></thead>
          <tbody>
            ${topClients.map(c => `<tr><td>${c.client_name}</td><td class="num">${formatCurrency(c.outstanding)}</td><td>${formatDate(c.oldest_due)}</td></tr>`).join('')}
          </tbody>
        </table>
        <h2>Aging Snapshot</h2>
        <table>
          <thead><tr><th>Bucket</th><th class="num">Count</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${aging.map(a => `<tr><td>${a.bucket}</td><td class="num">${a.count}</td><td class="num">${formatCurrency(a.amount)}</td></tr>`).join('')}
          </tbody>
        </table>
      </body></html>
    `;
    await api.printPreview(html, 'Invoice Dashboard Summary');
  };

  // ─── Render dashboard tab content ───────────────────
  const renderDashboard = () => {
    if (!stats) {
      return (
        <div className="flex items-center justify-center py-12">
          <span className="text-text-muted text-sm">
            {dashboardLoading ? 'Loading dashboard…' : 'No data available.'}
          </span>
        </div>
      );
    }
    const winRate = stats.sent_count > 0 ? (stats.paid_count / stats.sent_count) * 100 : 0;
    const maxTrend = Math.max(1, ...trend.map((t) => t.total));

    return (
      <div className="space-y-5">
        {/* Header bar with quick actions + print */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Invoice Dashboard</h2>
            <p className="text-xs text-text-muted">Overview of your invoicing for {new Date().getFullYear()}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="block-btn-primary flex items-center gap-2"
              onClick={() => { setTab('invoices'); goToNew(); }}
            >
              <Plus size={14} /> New Invoice
            </button>
            <button
              className="block-btn flex items-center gap-2"
              onClick={() => { setTab('invoices'); setView({ type: 'list' }); }}
            >
              <DollarSign size={14} /> Record Payment
            </button>
            <button
              className="block-btn flex items-center gap-2"
              onClick={async () => {
                const result = await api.runDunning?.();
                if (result?.advanced > 0) alert(`Sent reminders / advanced dunning on ${result.advanced} invoice(s).`);
                else alert('No invoices need reminders right now.');
              }}
            >
              <Bell size={14} /> Send Reminders
            </button>
            <button
              className="block-btn flex items-center gap-2"
              onClick={() => setTab('analytics')}
            >
              <BarChart3 size={14} /> View Reports
            </button>
            <button
              className="block-btn flex items-center gap-2"
              onClick={handlePrintDashboard}
            >
              <Printer size={14} /> Print
            </button>
          </div>
        </div>

        {/* Duplicate Detection alert */}
        {duplicates.length > 0 && (
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid #ef4444',
              borderRadius: 6,
            }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: '#ef4444' }} />
              <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>
                {duplicates.length} potential duplicate invoice{duplicates.length === 1 ? '' : 's'} detected
              </span>
            </div>
            <button
              className="block-btn text-xs"
              style={{ color: '#ef4444', borderColor: '#ef4444' }}
              onClick={() => { setTab('invoices'); setView({ type: 'list' }); }}
            >
              Review
            </button>
          </div>
        )}

        {/* Row 1 KPIs */}
        <div className="grid grid-cols-4 gap-3">
          <KpiCard
            label="Total Invoiced YTD"
            value={formatCurrency(stats.total_invoiced)}
            hint={`${stats.total_count} invoice${stats.total_count === 1 ? '' : 's'}`}
            icon={<FileText size={14} />}
            accent="blue"
          />
          <KpiCard
            label="Total Collected YTD"
            value={formatCurrency(stats.total_collected)}
            icon={<CheckCircle size={14} />}
            accent="green"
          />
          <KpiCard
            label="Outstanding"
            value={formatCurrency(stats.outstanding)}
            icon={<Clock size={14} />}
            accent="orange"
          />
          <KpiCard
            label="Overdue"
            value={formatCurrency(stats.overdue)}
            icon={<AlertTriangle size={14} />}
            accent="red"
          />
        </div>

        {/* Row 2 KPIs */}
        <div className="grid grid-cols-4 gap-3">
          <KpiCard
            label="Avg Invoice Value"
            value={formatCurrency(stats.avg_value)}
            icon={<DollarSign size={14} />}
            accent="blue"
          />
          <KpiCard
            label="Avg Days to Pay"
            value={`${stats.avg_days_to_pay.toFixed(1)}d`}
            icon={<Clock size={14} />}
            accent="purple"
          />
          <KpiCard
            label="Win Rate"
            value={`${winRate.toFixed(1)}%`}
            hint={`${stats.paid_count}/${stats.sent_count}`}
            icon={<TrendingUp size={14} />}
            accent="green"
          />
          <KpiCard
            label="This Month"
            value={formatCurrency(stats.month_total)}
            hint={`${stats.month_count} invoice${stats.month_count === 1 ? '' : 's'}`}
            icon={<BarChart3 size={14} />}
            accent="purple"
          />
        </div>

        {/* Status distribution */}
        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Status Distribution
            </span>
            <span className="text-[11px] text-text-muted">{totalStatus} total</span>
          </div>
          <div
            style={{
              display: 'flex',
              height: 16,
              width: '100%',
              borderRadius: 6,
              overflow: 'hidden',
              background: 'var(--color-bg-tertiary)',
            }}
          >
            {totalStatus > 0 && statusOrder.map((s) => {
              const c = statusCounts[s.key] || 0;
              const w = (c / totalStatus) * 100;
              if (w === 0) return null;
              return (
                <div
                  key={s.key}
                  style={{ width: `${w}%`, background: s.color }}
                  title={`${s.label}: ${c}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            {statusOrder.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span style={{ width: 10, height: 10, background: s.color, borderRadius: 6 }} />
                <span className="text-[11px] text-text-secondary">
                  {s.label} <span className="text-text-muted">({statusCounts[s.key] || 0})</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Aging + Top clients side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div className="block-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border-primary">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Aging Snapshot
              </span>
            </div>
            <table className="block-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(['current', '1-30', '31-60', '61-90', '90+'] as const).map((b) => {
                  const row = aging.find((a) => a.bucket === b) || { bucket: b, count: 0, amount: 0 };
                  const labelMap: Record<string, string> = {
                    current: 'Current',
                    '1-30': '1-30 days',
                    '31-60': '31-60 days',
                    '61-90': '61-90 days',
                    '90+': '90+ days',
                  };
                  const colorMap: Record<string, string> = {
                    current: '#22c55e',
                    '1-30': '#facc15',
                    '31-60': '#f59e0b',
                    '61-90': '#f97316',
                    '90+': '#ef4444',
                  };
                  return (
                    <tr key={b}>
                      <td>
                        <span className="flex items-center gap-2 text-text-primary">
                          <span style={{ width: 8, height: 8, background: colorMap[b], borderRadius: 6 }} />
                          {labelMap[b]}
                        </span>
                      </td>
                      <td className="text-right font-mono text-text-secondary">{row.count}</td>
                      <td className="text-right font-mono text-text-primary">{formatCurrency(row.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="block-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border-primary">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Top 5 Outstanding Clients
              </span>
            </div>
            {topClients.length === 0 ? (
              <div className="p-6 text-center text-sm text-text-muted">No outstanding balances.</div>
            ) : (
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="text-right">Outstanding</th>
                    <th className="text-right">Oldest Due</th>
                  </tr>
                </thead>
                <tbody>
                  {topClients.map((c) => (
                    <tr
                      key={c.client_id}
                      className="cursor-pointer"
                      onClick={() => { setTab('invoices'); setView({ type: 'list' }); }}
                    >
                      <td className="text-text-primary">{c.client_name}</td>
                      <td className="text-right font-mono text-accent-warning">{formatCurrency(c.outstanding)}</td>
                      <td className="text-right text-text-muted">{c.oldest_due ? formatDate(c.oldest_due) : '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Activity + Cash forecast */}
        <div className="grid grid-cols-2 gap-4">
          <div className="block-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border-primary">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Recent Activity
              </span>
            </div>
            {activity.length === 0 ? (
              <div className="p-6 text-center text-sm text-text-muted">No recent activity yet.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {activity.map((a) => (
                  <li
                    key={a.id}
                    style={{
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--color-border-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="text-xs text-text-primary font-medium">
                        <span className="text-accent-blue font-mono">{a.invoice_number}</span>
                        {' '}— {a.activity_type.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[11px] text-text-muted truncate">
                        {a.description || '—'}
                      </div>
                    </div>
                    <div className="text-[11px] text-text-muted whitespace-nowrap">
                      {a.created_at ? formatDate(a.created_at) : '—'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="block-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-accent-blue" />
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                30-Day Cash Forecast
              </span>
            </div>
            {forecast ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-text-muted">Predicted Inflow</div>
                  <div className="text-xl font-bold font-mono text-accent-income">
                    {formatCurrency(forecast.predicted_inflow ?? 0)}
                  </div>
                </div>
                {(forecast.confidence_low != null && forecast.confidence_high != null) && (
                  <div>
                    <div className="text-[11px] text-text-muted">Confidence Range</div>
                    <div className="text-sm font-mono text-text-secondary">
                      {formatCurrency(forecast.confidence_low)} — {formatCurrency(forecast.confidence_high)}
                    </div>
                  </div>
                )}
                {forecast.net_position != null && (
                  <div>
                    <div className="text-[11px] text-text-muted">Net Position</div>
                    <div className={`text-sm font-mono ${forecast.net_position >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                      {formatCurrency(forecast.net_position)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-text-muted">Forecast not available.</div>
            )}
          </div>
        </div>

        {/* 12-month trend mini-chart */}
        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Last 12 Months
            </span>
          </div>
          {trend.length === 0 ? (
            <div className="text-sm text-text-muted">No data yet.</div>
          ) : (
            <div className="flex items-end gap-1 h-32">
              {trend.map((m) => {
                const h = (m.total / maxTrend) * 100;
                return (
                  <div
                    key={m.month}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`${m.month}: ${formatCurrency(m.total)} (${m.count} invoices)`}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: `${Math.max(h, 2)}%`,
                        background: 'var(--color-accent-blue)',
                        borderRadius: '6px 6px 0 0',
                      }}
                    />
                    <div className="text-[9px] text-text-muted whitespace-nowrap">
                      {m.month.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRecurring = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-text-primary">Recurring Invoices</h2>
      <div className="block-card p-6">
        <div className="flex items-start gap-4">
          <Repeat size={28} className="text-accent-blue flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="text-base font-semibold text-text-primary mb-1">
              Manage recurring invoices in Recurring Transactions
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              Recurring invoices and bills are managed centrally in the Recurring Transactions module.
              You can configure schedules, frequencies, and templates from there.
            </p>
            <button
              className="block-btn-primary flex items-center gap-2"
              onClick={() => setModule('recurring')}
            >
              <ArrowRight size={14} /> Open Recurring Transactions
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAnalytics = () => {
    const maxTrend = Math.max(1, ...trend.map((t) => t.total));
    return (
      <div className="space-y-5">
        <h2 className="text-lg font-bold text-text-primary">Invoice Analytics</h2>

        <div className="grid grid-cols-3 gap-3">
          <KpiCard
            label="This Year"
            value={formatCurrency(yoy.thisYear)}
            accent="blue"
            icon={<BarChart3 size={14} />}
          />
          <KpiCard
            label="Last Year"
            value={formatCurrency(yoy.lastYear)}
            accent="purple"
            icon={<BarChart3 size={14} />}
          />
          <KpiCard
            label="YoY Change"
            value={`${yoy.change >= 0 ? '+' : ''}${yoy.change.toFixed(1)}%`}
            accent={yoy.change >= 0 ? 'green' : 'red'}
            icon={<TrendingUp size={14} />}
          />
        </div>

        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              12-Month Invoice Trend
            </span>
          </div>
          {trend.length === 0 ? (
            <div className="text-sm text-text-muted py-6 text-center">No data yet.</div>
          ) : (
            <div className="flex items-end gap-2 h-48">
              {trend.map((m) => {
                const h = (m.total / maxTrend) * 100;
                return (
                  <div
                    key={m.month}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`${m.month}: ${formatCurrency(m.total)} (${m.count} invoices)`}
                  >
                    <div className="text-[10px] font-mono text-text-muted">
                      {m.total > 0 ? `$${(m.total / 1000).toFixed(0)}k` : ''}
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: `${Math.max(h, 2)}%`,
                        background: 'var(--color-accent-blue)',
                        borderRadius: '6px 6px 0 0',
                      }}
                    />
                    <div className="text-[10px] text-text-muted whitespace-nowrap">
                      {m.month.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="block-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border-primary">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Monthly Breakdown
            </span>
          </div>
          <table className="block-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Count</th>
                <th className="text-right">Total</th>
                <th className="text-right">Avg</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((m) => (
                <tr key={m.month}>
                  <td className="text-text-primary font-mono">{m.month}</td>
                  <td className="text-right font-mono text-text-secondary">{m.count}</td>
                  <td className="text-right font-mono text-text-primary">{formatCurrency(m.total)}</td>
                  <td className="text-right font-mono text-text-muted">
                    {formatCurrency(m.count > 0 ? m.total / m.count : 0)}
                  </td>
                </tr>
              ))}
              {trend.length === 0 && (
                <tr><td colSpan={4} className="text-center text-text-muted py-4">No data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // If user is in a sub-view of the invoices tab, render that full-screen
  if (tab === 'invoices' && view.type !== 'list') {
    return renderInvoicesTab();
  }

  // For the invoices tab list, render with a thin tab strip above the list
  // (which has its own padding/scroll).
  if (tab === 'invoices') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 border-b border-border-primary px-6 pt-4">
          <TabBtn
            active={false}
            icon={<LayoutDashboard size={14} />}
            label="Dashboard"
            onClick={() => setTab('dashboard')}
          />
          <TabBtn
            active={true}
            icon={<FileText size={14} />}
            label="Invoices"
            onClick={() => { setTab('invoices'); setView({ type: 'list' }); }}
          />
          <TabBtn
            active={false}
            icon={<Repeat size={14} />}
            label="Recurring"
            onClick={() => setTab('recurring')}
          />
          <TabBtn
            active={false}
            icon={<BarChart3 size={14} />}
            label="Analytics"
            onClick={() => setTab('analytics')}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {renderInvoicesTab()}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-border-primary">
        <TabBtn
          active={tab === 'dashboard'}
          icon={<LayoutDashboard size={14} />}
          label="Dashboard"
          onClick={() => setTab('dashboard')}
        />
        <TabBtn
          active={false}
          icon={<FileText size={14} />}
          label="Invoices"
          onClick={() => { setTab('invoices'); setView({ type: 'list' }); }}
        />
        <TabBtn
          active={tab === 'recurring'}
          icon={<Repeat size={14} />}
          label="Recurring"
          onClick={() => setTab('recurring')}
        />
        <TabBtn
          active={tab === 'analytics'}
          icon={<BarChart3 size={14} />}
          label="Analytics"
          onClick={() => setTab('analytics')}
        />
      </div>

      {tab === 'dashboard' && renderDashboard()}
      {tab === 'recurring' && renderRecurring()}
      {tab === 'analytics' && renderAnalytics()}
    </div>
  );
};

export default InvoicingModule;
