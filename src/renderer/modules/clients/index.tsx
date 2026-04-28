import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, UserCircle, PieChart, BarChart3, Plus, TrendingUp, TrendingDown,
  DollarSign, Clock, AlertTriangle, Star, Users, ArrowRight, Printer, Upload,
} from 'lucide-react';
import ClientList from './ClientList';
import ClientDetail from './ClientDetail';
import ClientForm from './ClientForm';
import { useAppStore } from '../../stores/appStore';
import { useCompanyStore } from '../../stores/companyStore';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
type Tab = 'dashboard' | 'clients' | 'segments' | 'analytics';
type SegmentGroupBy = 'tier' | 'industry' | 'segment';

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
        : 'text-text-muted hover:text-text-secondary transition-colors'
    }`}
    style={{ borderRadius: '6px 6px 0 0' }}
  >
    {icon}
    {label}
  </button>
);

// ─── Module Root ────────────────────────────────────────
const ClientsModule: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [tab, setTab] = useState<Tab>('dashboard');

  // Client list/detail/form state
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('client');
    if (focus) {
      setSelectedClientId(focus.id);
      setTab('clients');
    }
  }, [consumeFocusEntity]);
  const [formOpen, setFormOpen] = useState(false);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  // ─── Dashboard State ────────────────────────────────
  const [dashLoading, setDashLoading] = useState(true);
  const [clientStats, setClientStats] = useState<any>(null);
  const [revenueStats, setRevenueStats] = useState<any>(null);
  const [topClients, setTopClients] = useState<any[]>([]);
  const [recentClients, setRecentClients] = useState<any[]>([]);
  const [industryBreakdown, setIndustryBreakdown] = useState<any[]>([]);
  const [riskBreakdown, setRiskBreakdown] = useState<any[]>([]);
  const [paymentStats, setPaymentStats] = useState<any>(null);

  // ─── Segments State ─────────────────────────────────
  const [segGroupBy, setSegGroupBy] = useState<SegmentGroupBy>('tier');
  const [segData, setSegData] = useState<any[]>([]);
  const [segLoading, setSegLoading] = useState(true);

  // ─── Analytics State ────────────────────────────────
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [revenueByMonth, setRevenueByMonth] = useState<any[]>([]);
  const [acquisitionByMonth, setAcquisitionByMonth] = useState<any[]>([]);
  const [concentrationData, setConcentrationData] = useState<{ top20Pct: number; totalClients: number }>({ top20Pct: 0, totalClients: 0 });
  const [paymentTimeliness, setPaymentTimeliness] = useState<any[]>([]);

  // ─── Load Dashboard ─────────────────────────────────
  useEffect(() => {
    if (tab !== 'dashboard' || !activeCompany) return;
    let cancelled = false;
    (async () => {
      setDashLoading(true);
      try {
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        const [statsRow, revRow, top5, recent5, industries, risks, pmtRow] = await Promise.all([
          api.rawQuery(
            `SELECT COUNT(*) as total,
              SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
              SUM(CASE WHEN status='prospect' THEN 1 ELSE 0 END) as prospects,
              SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END) as inactive,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_this_month
            FROM clients WHERE company_id = ?`,
            [monthStart, activeCompany.id]
          ),
          api.rawQuery(
            `SELECT COALESCE(SUM(i.total), 0) as total_revenue,
              COALESCE(SUM(i.total - i.amount_paid), 0) as outstanding,
              COALESCE(SUM(CASE WHEN i.status='overdue' THEN 1 ELSE 0 END), 0) as overdue_count,
              COALESCE(AVG(
                CASE WHEN i.status IN ('paid','closed')
                  THEN julianday(COALESCE(i.updated_at, i.due_date)) - julianday(i.issue_date)
                  ELSE NULL END
              ), 0) as avg_payment_days
            FROM invoices i
            JOIN clients c ON i.client_id = c.id
            WHERE c.company_id = ?`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT c.name, COALESCE(SUM(i.total), 0) as revenue
            FROM clients c LEFT JOIN invoices i ON i.client_id = c.id
            WHERE c.company_id = ? GROUP BY c.id ORDER BY revenue DESC LIMIT 5`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT c.id, c.name, c.email, c.status, COALESCE(SUM(i.total), 0) as total_invoiced
            FROM clients c LEFT JOIN invoices i ON i.client_id = c.id
            WHERE c.company_id = ?
            GROUP BY c.id ORDER BY c.created_at DESC LIMIT 5`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT COALESCE(industry, 'Unspecified') as industry, COUNT(*) as count
            FROM clients WHERE company_id = ?
            GROUP BY industry ORDER BY count DESC LIMIT 8`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT COALESCE(risk_rating, 'unrated') as risk, COUNT(*) as count
            FROM clients WHERE company_id = ?
            GROUP BY risk_rating ORDER BY count DESC`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT
              COUNT(CASE WHEN i.status IN ('paid','closed') THEN 1 END) as paid_count,
              COUNT(CASE WHEN i.status IN ('paid','closed') AND julianday(COALESCE(i.updated_at, i.due_date)) <= julianday(i.due_date) THEN 1 END) as on_time_count
            FROM invoices i
            JOIN clients c ON i.client_id = c.id
            WHERE c.company_id = ?`,
            [activeCompany.id]
          ),
        ]);

        if (cancelled) return;
        setClientStats(Array.isArray(statsRow) ? statsRow[0] : statsRow);
        setRevenueStats(Array.isArray(revRow) ? revRow[0] : revRow);
        setTopClients(Array.isArray(top5) ? top5 : []);
        setRecentClients(Array.isArray(recent5) ? recent5 : []);
        setIndustryBreakdown(Array.isArray(industries) ? industries : []);
        setRiskBreakdown(Array.isArray(risks) ? risks : []);
        setPaymentStats(Array.isArray(pmtRow) ? pmtRow[0] : pmtRow);
      } catch (err) {
        console.error('Client dashboard load failed:', err);
      } finally {
        if (!cancelled) setDashLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, activeCompany]);

  // ─── Load Segments ──────────────────────────────────
  useEffect(() => {
    if (tab !== 'segments' || !activeCompany) return;
    let cancelled = false;
    (async () => {
      setSegLoading(true);
      try {
        const col = segGroupBy;
        const rows = await api.rawQuery(
          `SELECT COALESCE(c.${col}, 'Unspecified') as group_name,
            COUNT(*) as client_count,
            COALESCE(SUM(inv.revenue), 0) as revenue,
            COALESCE(SUM(inv.outstanding), 0) as outstanding,
            COALESCE(AVG(inv.avg_days), 0) as avg_payment_days
          FROM clients c
          LEFT JOIN (
            SELECT client_id,
              SUM(total) as revenue,
              SUM(total - amount_paid) as outstanding,
              AVG(CASE WHEN status IN ('paid','closed') THEN julianday(COALESCE(updated_at, due_date)) - julianday(issue_date) ELSE NULL END) as avg_days
            FROM invoices GROUP BY client_id
          ) inv ON inv.client_id = c.id
          WHERE c.company_id = ?
          GROUP BY c.${col}
          ORDER BY revenue DESC`,
          [activeCompany.id]
        );
        if (!cancelled) setSegData(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error('Segments load failed:', err);
      } finally {
        if (!cancelled) setSegLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, segGroupBy, activeCompany]);

  // ─── Load Analytics ─────────────────────────────────
  useEffect(() => {
    if (tab !== 'analytics' || !activeCompany) return;
    let cancelled = false;
    (async () => {
      setAnalyticsLoading(true);
      try {
        const [revByMonth, acqByMonth, allClientRev, timelinessRows] = await Promise.all([
          api.rawQuery(
            `SELECT strftime('%Y-%m', i.issue_date) as month, COALESCE(SUM(i.total), 0) as revenue
            FROM invoices i JOIN clients c ON i.client_id = c.id
            WHERE c.company_id = ? AND i.issue_date >= date('now', '-12 months')
            GROUP BY month ORDER BY month`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
            FROM clients WHERE company_id = ? AND created_at >= date('now', '-12 months')
            GROUP BY month ORDER BY month`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT c.id, COALESCE(SUM(i.total), 0) as revenue
            FROM clients c LEFT JOIN invoices i ON i.client_id = c.id
            WHERE c.company_id = ?
            GROUP BY c.id ORDER BY revenue DESC`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT
              CASE
                WHEN julianday(COALESCE(i.updated_at, i.due_date)) - julianday(i.due_date) <= 0 THEN 'On Time'
                WHEN julianday(COALESCE(i.updated_at, i.due_date)) - julianday(i.due_date) <= 15 THEN '1-15 Days Late'
                WHEN julianday(COALESCE(i.updated_at, i.due_date)) - julianday(i.due_date) <= 30 THEN '16-30 Days Late'
                ELSE '30+ Days Late'
              END as bucket,
              COUNT(*) as count
            FROM invoices i
            JOIN clients c ON i.client_id = c.id
            WHERE c.company_id = ? AND i.status IN ('paid','closed')
            GROUP BY bucket ORDER BY bucket`,
            [activeCompany.id]
          ),
        ]);

        if (cancelled) return;
        setRevenueByMonth(Array.isArray(revByMonth) ? revByMonth : []);
        setAcquisitionByMonth(Array.isArray(acqByMonth) ? acqByMonth : []);
        setPaymentTimeliness(Array.isArray(timelinessRows) ? timelinessRows : []);

        // Concentration calculation
        const clientRevs = (Array.isArray(allClientRev) ? allClientRev : []).filter((r: any) => r.revenue > 0);
        const totalRev = clientRevs.reduce((s: number, r: any) => s + (r.revenue || 0), 0);
        const top20Count = Math.max(1, Math.ceil(clientRevs.length * 0.2));
        const top20Rev = clientRevs.slice(0, top20Count).reduce((s: number, r: any) => s + (r.revenue || 0), 0);
        setConcentrationData({
          top20Pct: totalRev > 0 ? (top20Rev / totalRev) * 100 : 0,
          totalClients: clientRevs.length,
        });
      } catch (err) {
        console.error('Analytics load failed:', err);
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, activeCompany]);

  // ─── Navigation Handlers ────────────────────────────
  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedClientId(null);
  }, []);

  const handleNewClient = useCallback(() => {
    setEditClientId(null);
    setFormOpen(true);
  }, []);

  const handleEditClient = useCallback((id: string) => {
    setEditClientId(id);
    setFormOpen(true);
  }, []);

  const handleFormClose = useCallback(() => {
    setFormOpen(false);
    setEditClientId(null);
  }, []);

  const handleFormSaved = useCallback(() => {
    setFormOpen(false);
    setEditClientId(null);
    setListKey((k) => k + 1);
  }, []);

  const switchTab = useCallback((t: Tab) => {
    setTab(t);
    if (t === 'clients') {
      setSelectedClientId(null);
    }
  }, []);

  // ─── Print Summary Report ───────────────────────────
  const handlePrintSummary = useCallback(() => {
    const active = clientStats?.active ?? 0;
    const total = clientStats?.total ?? 0;
    const retention = total > 0 ? ((active / total) * 100).toFixed(1) : '0';
    const html = `
      <html><head><title>Client Portfolio Summary</title>
      <style>
        body { font-family: 'Helvetica Neue', sans-serif; color: #1a1a2e; padding: 40px; }
        h1 { font-size: 22px; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
        h2 { font-size: 16px; margin-top: 28px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
        .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 12px; text-align: center; }
        .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
        .kpi-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 12px; }
        th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; background: #f5f5f5; }
        .text-right { text-align: right; }
        .footer { margin-top: 40px; font-size: 10px; color: #999; text-align: center; border-top: 1px solid #ddd; padding-top: 12px; }
      </style></head><body>
      <h1>Client Portfolio Summary</h1>
      <p style="font-size:12px;color:#666;">Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>

      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Total Clients</div><div class="kpi-value">${total}</div></div>
        <div class="kpi"><div class="kpi-label">Active Clients</div><div class="kpi-value">${active}</div></div>
        <div class="kpi"><div class="kpi-label">Total Revenue</div><div class="kpi-value">${formatCurrency(revenueStats?.total_revenue ?? 0)}</div></div>
        <div class="kpi"><div class="kpi-label">Outstanding AR</div><div class="kpi-value">${formatCurrency(revenueStats?.outstanding ?? 0)}</div></div>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Avg Revenue / Client</div><div class="kpi-value">${formatCurrency(active > 0 ? (revenueStats?.total_revenue ?? 0) / active : 0)}</div></div>
        <div class="kpi"><div class="kpi-label">Avg Payment Days</div><div class="kpi-value">${Math.round(revenueStats?.avg_payment_days ?? 0)} days</div></div>
        <div class="kpi"><div class="kpi-label">Retention Rate</div><div class="kpi-value">${retention}%</div></div>
        <div class="kpi"><div class="kpi-label">Overdue Invoices</div><div class="kpi-value">${revenueStats?.overdue_count ?? 0}</div></div>
      </div>

      <h2>Top Clients by Revenue</h2>
      <table>
        <thead><tr><th>#</th><th>Client</th><th class="text-right">Revenue</th></tr></thead>
        <tbody>
          ${topClients.map((c: any, i: number) => `<tr><td>${i + 1}</td><td>${c.name}</td><td class="text-right">${formatCurrency(c.revenue)}</td></tr>`).join('')}
        </tbody>
      </table>

      <h2>Status Distribution</h2>
      <table>
        <thead><tr><th>Status</th><th class="text-right">Count</th><th class="text-right">%</th></tr></thead>
        <tbody>
          <tr><td>Active</td><td class="text-right">${active}</td><td class="text-right">${total > 0 ? ((active / total) * 100).toFixed(1) : 0}%</td></tr>
          <tr><td>Inactive</td><td class="text-right">${clientStats?.inactive ?? 0}</td><td class="text-right">${total > 0 ? (((clientStats?.inactive ?? 0) / total) * 100).toFixed(1) : 0}%</td></tr>
          <tr><td>Prospect</td><td class="text-right">${clientStats?.prospects ?? 0}</td><td class="text-right">${total > 0 ? (((clientStats?.prospects ?? 0) / total) * 100).toFixed(1) : 0}%</td></tr>
        </tbody>
      </table>

      <div class="footer">Business Accounting Pro &mdash; Client Portfolio Report</div>
      </body></html>
    `;
    api.printPreview(html, 'Client Portfolio Summary');
  }, [clientStats, revenueStats, topClients]);

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Tabs */}
      <div className="flex border-b border-border-primary mb-6 cursor-pointer">
        <TabBtn active={tab === 'dashboard'} icon={<LayoutDashboard size={16} />} label="Dashboard" onClick={() => switchTab('dashboard')} />
        <TabBtn active={tab === 'clients'} icon={<UserCircle size={16} />} label="Clients" onClick={() => switchTab('clients')} />
        <TabBtn active={tab === 'segments'} icon={<PieChart size={16} />} label="Segments" onClick={() => switchTab('segments')} />
        <TabBtn active={tab === 'analytics'} icon={<BarChart3 size={16} />} label="Analytics" onClick={() => switchTab('analytics')} />
      </div>

      {/* ─── Dashboard Tab ─── */}
      {tab === 'dashboard' && (
        <div className="space-y-5">
          {dashLoading ? (
            <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading dashboard...</div>
          ) : (
            <>
              {/* KPI Row 1 */}
              <div className="grid grid-cols-4 gap-4">
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Clients</div>
                  <div className="text-xl font-mono font-bold text-text-primary mt-1">{clientStats?.total ?? 0}</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active Clients</div>
                  <div className="text-xl font-mono font-bold text-accent-income mt-1">{clientStats?.active ?? 0}</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Revenue</div>
                  <div className="text-xl font-mono font-bold text-accent-blue mt-1">{formatCurrency(revenueStats?.total_revenue ?? 0)}</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Outstanding AR</div>
                  <div className="text-xl font-mono font-bold text-accent-expense mt-1">{formatCurrency(revenueStats?.outstanding ?? 0)}</div>
                </div>
              </div>

              {/* KPI Row 2 */}
              <div className="grid grid-cols-4 gap-4">
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Revenue / Client</div>
                  <div className="text-xl font-mono font-bold text-text-primary mt-1">
                    {formatCurrency((clientStats?.active ?? 0) > 0 ? (revenueStats?.total_revenue ?? 0) / (clientStats?.active ?? 1) : 0)}
                  </div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Payment Days</div>
                  <div className="text-xl font-mono font-bold text-text-primary mt-1 flex items-center justify-center gap-1.5">
                    <Clock size={16} className="text-text-muted" />
                    {Math.round(revenueStats?.avg_payment_days ?? 0)} days
                  </div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Overdue Invoices</div>
                  <div className="text-xl font-mono font-bold text-accent-expense mt-1 flex items-center justify-center gap-1.5">
                    <AlertTriangle size={16} />
                    {revenueStats?.overdue_count ?? 0}
                  </div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">New This Month</div>
                  <div className="text-xl font-mono font-bold text-accent-income mt-1">{clientStats?.new_this_month ?? 0}</div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-3">
                <button className="block-btn-primary flex items-center gap-2 text-xs" onClick={() => { switchTab('clients'); handleNewClient(); }}>
                  <Plus size={14} /> Add Client
                </button>
                <button
                  className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors"
                  style={{ borderRadius: '6px' }}
                  onClick={() => switchTab('clients')}
                >
                  <Upload size={14} /> Import Clients
                </button>
                <button
                  className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors"
                  style={{ borderRadius: '6px' }}
                  onClick={() => switchTab('analytics')}
                >
                  <BarChart3 size={14} /> View Analytics
                </button>
                <button
                  className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors"
                  style={{ borderRadius: '6px' }}
                  onClick={handlePrintSummary}
                >
                  <Printer size={14} /> Print Summary
                </button>
              </div>

              {/* Middle Row: Top Clients + Status Distribution */}
              <div className="grid grid-cols-2 gap-4">
                {/* Top 5 Clients by Revenue */}
                <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Top Clients by Revenue</div>
                  {topClients.length === 0 ? (
                    <div className="text-xs text-text-muted py-4 text-center">No invoice data yet</div>
                  ) : (
                    <div className="space-y-2.5">
                      {(() => {
                        const maxRev = Math.max(...topClients.map((c: any) => c.revenue || 0), 1);
                        return topClients.map((client: any, i: number) => (
                          <div key={i} className="flex items-center gap-3">
                            <div className="text-xs text-text-secondary w-32 truncate">{client.name}</div>
                            <div className="flex-1 h-4 relative" style={{ background: 'var(--color-bg-tertiary)', borderRadius: '3px' }}>
                              <div
                                style={{
                                  width: `${Math.max(((client.revenue || 0) / maxRev) * 100, 2)}%`,
                                  height: '100%',
                                  background: 'var(--color-accent-blue)',
                                  borderRadius: '3px',
                                  transition: 'width 0.3s ease',
                                }}
                              />
                            </div>
                            <div className="text-xs font-mono font-bold text-text-primary w-24 text-right">{formatCurrency(client.revenue)}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>

                {/* Status Distribution */}
                <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Status Distribution</div>
                  {(() => {
                    const total = clientStats?.total ?? 0;
                    if (total === 0) return <div className="text-xs text-text-muted py-4 text-center">No clients yet</div>;
                    const active = clientStats?.active ?? 0;
                    const inactive = clientStats?.inactive ?? 0;
                    const prospects = clientStats?.prospects ?? 0;
                    const activePct = (active / total) * 100;
                    const inactivePct = (inactive / total) * 100;
                    const prospectPct = (prospects / total) * 100;
                    return (
                      <div className="space-y-4">
                        {/* Stacked bar */}
                        <div className="h-6 flex overflow-hidden" style={{ borderRadius: '3px' }}>
                          {activePct > 0 && (
                            <div style={{ width: `${activePct}%`, background: 'var(--color-accent-income)', minWidth: '2px' }} title={`Active: ${active}`} />
                          )}
                          {inactivePct > 0 && (
                            <div style={{ width: `${inactivePct}%`, background: 'var(--color-accent-expense)', minWidth: '2px' }} title={`Inactive: ${inactive}`} />
                          )}
                          {prospectPct > 0 && (
                            <div style={{ width: `${prospectPct}%`, background: 'var(--color-accent-blue)', minWidth: '2px' }} title={`Prospect: ${prospects}`} />
                          )}
                        </div>
                        {/* Legend */}
                        <div className="flex gap-5">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3" style={{ background: 'var(--color-accent-income)', borderRadius: '2px' }} />
                            <span className="text-xs text-text-secondary">Active ({active})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3" style={{ background: 'var(--color-accent-expense)', borderRadius: '2px' }} />
                            <span className="text-xs text-text-secondary">Inactive ({inactive})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3" style={{ background: 'var(--color-accent-blue)', borderRadius: '2px' }} />
                            <span className="text-xs text-text-secondary">Prospect ({prospects})</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Industry Breakdown + Credit Risk + Payment Behavior + Retention */}
              <div className="grid grid-cols-4 gap-4">
                {/* Retention */}
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Retention Rate</div>
                  <div className="text-xl font-mono font-bold text-accent-income mt-1">
                    {(clientStats?.total ?? 0) > 0 ? (((clientStats?.active ?? 0) / (clientStats?.total ?? 1)) * 100).toFixed(1) : '0'}%
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">Active / Total</div>
                </div>

                {/* Credit Risk Summary */}
                <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Credit Risk</div>
                  {riskBreakdown.length === 0 ? (
                    <div className="text-xs text-text-muted text-center py-2">No data</div>
                  ) : (
                    <div className="space-y-1.5">
                      {riskBreakdown.map((r: any, i: number) => {
                        const colorMap: Record<string, string> = {
                          low: 'var(--color-accent-income)',
                          medium: 'var(--color-accent-blue)',
                          high: '#f59e0b',
                          critical: 'var(--color-accent-expense)',
                        };
                        return (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-text-secondary capitalize">{r.risk}</span>
                            <span className="text-xs font-mono font-bold" style={{ color: colorMap[r.risk] || 'var(--color-text-secondary)' }}>
                              {r.count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Payment Behavior */}
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">On-Time Payments</div>
                  <div className="text-xl font-mono font-bold text-accent-income mt-1">
                    {(paymentStats?.paid_count ?? 0) > 0
                      ? (((paymentStats?.on_time_count ?? 0) / (paymentStats?.paid_count ?? 1)) * 100).toFixed(0)
                      : '0'}%
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {paymentStats?.on_time_count ?? 0} of {paymentStats?.paid_count ?? 0} invoices
                  </div>
                </div>

                {/* Industry Breakdown */}
                <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Industry Breakdown</div>
                  {industryBreakdown.length === 0 ? (
                    <div className="text-xs text-text-muted text-center py-2">No data</div>
                  ) : (
                    <div className="space-y-1.5">
                      {industryBreakdown.slice(0, 5).map((ind: any, i: number) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="text-xs text-text-secondary truncate max-w-[100px]">{ind.industry}</span>
                          <span className="text-xs font-mono font-bold text-text-primary">{ind.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Clients Table */}
              <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
                <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Recent Clients</div>
                  <button
                    className="text-[10px] font-semibold text-accent-blue uppercase tracking-wider flex items-center gap-1 hover:underline"
                    onClick={() => switchTab('clients')}
                  >
                    View All <ArrowRight size={10} />
                  </button>
                </div>
                {recentClients.length === 0 ? (
                  <div className="text-xs text-text-muted py-6 text-center">No clients yet</div>
                ) : (
                  <table className="block-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th className="text-right">Total Invoiced</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentClients.map((c: any) => (
                        <tr key={c.id} className="cursor-pointer" onClick={() => { switchTab('clients'); handleSelectClient(c.id); }}>
                          <td className="text-text-primary font-medium text-xs">{c.name}</td>
                          <td className="text-text-secondary text-xs">{c.email || '--'}</td>
                          <td>
                            <span className={`block-badge ${c.status === 'active' ? 'block-badge-green' : c.status === 'prospect' ? 'block-badge-blue' : 'block-badge-default'}`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="text-right font-mono text-accent-blue text-xs">{formatCurrency(c.total_invoiced)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Clients Tab ─── */}
      {tab === 'clients' && (
        <>
          {selectedClientId ? (
            <ClientDetail
              key={selectedClientId}
              clientId={selectedClientId}
              onBack={handleBackToList}
              onEdit={handleEditClient}
            />
          ) : (
            <ClientList
              key={listKey}
              onSelectClient={handleSelectClient}
              onNewClient={handleNewClient}
            />
          )}
        </>
      )}

      {/* ─── Segments Tab ─── */}
      {tab === 'segments' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text-primary">Client Segments</h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Group By:</span>
              {(['tier', 'industry', 'segment'] as SegmentGroupBy[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setSegGroupBy(g)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    segGroupBy === g
                      ? 'bg-accent-blue text-text-primary'
                      : 'text-text-muted hover:text-text-secondary border border-border-primary'
                  }`}
                  style={{ borderRadius: '6px' }}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {segLoading ? (
            <div className="flex items-center justify-center h-48 text-text-muted text-sm">Loading segments...</div>
          ) : segData.length === 0 ? (
            <div className="text-sm text-text-muted text-center py-12">No segment data available</div>
          ) : (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>{segGroupBy.charAt(0).toUpperCase() + segGroupBy.slice(1)}</th>
                    <th className="text-right">Clients</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Outstanding</th>
                    <th className="text-right">Avg Payment Days</th>
                  </tr>
                </thead>
                <tbody>
                  {segData.map((row: any, i: number) => (
                    <tr key={i}>
                      <td className="text-text-primary font-medium text-xs">{row.group_name}</td>
                      <td className="text-right font-mono text-text-secondary text-xs">{row.client_count}</td>
                      <td className="text-right font-mono text-accent-blue text-xs">{formatCurrency(row.revenue)}</td>
                      <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(row.outstanding)}</td>
                      <td className="text-right font-mono text-text-secondary text-xs">{Math.round(row.avg_payment_days || 0)} days</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Analytics Tab ─── */}
      {tab === 'analytics' && (
        <div className="space-y-5">
          <h2 className="text-lg font-bold text-text-primary">Client Analytics</h2>

          {analyticsLoading ? (
            <div className="flex items-center justify-center h-48 text-text-muted text-sm">Loading analytics...</div>
          ) : (
            <>
              {/* Revenue by Month */}
              <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-4">Revenue by Month (Last 12 Months)</div>
                {revenueByMonth.length === 0 ? (
                  <div className="text-xs text-text-muted py-6 text-center">No invoice data</div>
                ) : (
                  <div className="flex items-end gap-2" style={{ height: '160px' }}>
                    {(() => {
                      const maxRevMonth = Math.max(...revenueByMonth.map((r: any) => r.revenue || 0), 1);
                      return revenueByMonth.map((m: any, i: number) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div className="text-[9px] font-mono text-text-muted">{formatCurrency(m.revenue)}</div>
                          <div
                            className="w-full"
                            style={{
                              height: `${Math.max(((m.revenue || 0) / maxRevMonth) * 120, 4)}px`,
                              background: 'var(--color-accent-blue)',
                              borderRadius: '3px 3px 0 0',
                              transition: 'height 0.3s ease',
                            }}
                          />
                          <div className="text-[9px] text-text-muted">{m.month?.slice(5)}</div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>

              {/* Acquisition + Concentration Row */}
              <div className="grid grid-cols-2 gap-4">
                {/* Client Acquisition Trend */}
                <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-4">Client Acquisition (Last 12 Months)</div>
                  {acquisitionByMonth.length === 0 ? (
                    <div className="text-xs text-text-muted py-6 text-center">No client data</div>
                  ) : (
                    <div className="flex items-end gap-2" style={{ height: '120px' }}>
                      {(() => {
                        const maxAcq = Math.max(...acquisitionByMonth.map((a: any) => a.count || 0), 1);
                        return acquisitionByMonth.map((m: any, i: number) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div className="text-[9px] font-mono text-text-muted">{m.count}</div>
                            <div
                              className="w-full"
                              style={{
                                height: `${Math.max(((m.count || 0) / maxAcq) * 90, 4)}px`,
                                background: 'var(--color-accent-income)',
                                borderRadius: '3px 3px 0 0',
                                transition: 'height 0.3s ease',
                              }}
                            />
                            <div className="text-[9px] text-text-muted">{m.month?.slice(5)}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>

                {/* Revenue Concentration */}
                <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-4">Revenue Concentration</div>
                  <div className="flex flex-col items-center py-4">
                    <div className="text-3xl font-mono font-bold text-accent-blue">{concentrationData.top20Pct.toFixed(1)}%</div>
                    <div className="text-xs text-text-muted mt-2">of revenue from top 20% of clients</div>
                    <div className="text-xs text-text-secondary mt-1">({concentrationData.totalClients} clients with revenue)</div>
                    <div className="w-full mt-4 h-4 relative" style={{ background: 'var(--color-bg-tertiary)', borderRadius: '3px' }}>
                      <div
                        style={{
                          width: `${Math.min(concentrationData.top20Pct, 100)}%`,
                          height: '100%',
                          background: concentrationData.top20Pct > 80 ? 'var(--color-accent-expense)' : 'var(--color-accent-blue)',
                          borderRadius: '3px',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    {concentrationData.top20Pct > 80 && (
                      <div className="flex items-center gap-1.5 mt-3 text-xs text-accent-expense">
                        <AlertTriangle size={12} /> High concentration risk
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Payment Timeliness */}
              <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-4">Payment Timeliness Distribution</div>
                {paymentTimeliness.length === 0 ? (
                  <div className="text-xs text-text-muted py-6 text-center">No payment data</div>
                ) : (
                  <div className="grid grid-cols-4 gap-4">
                    {paymentTimeliness.map((bucket: any, i: number) => {
                      const colorMap: Record<string, string> = {
                        'On Time': 'var(--color-accent-income)',
                        '1-15 Days Late': 'var(--color-accent-blue)',
                        '16-30 Days Late': '#f59e0b',
                        '30+ Days Late': 'var(--color-accent-expense)',
                      };
                      return (
                        <div key={i} className="text-center">
                          <div className="text-2xl font-mono font-bold" style={{ color: colorMap[bucket.bucket] || 'var(--color-text-primary)' }}>
                            {bucket.count}
                          </div>
                          <div className="text-[10px] text-text-muted mt-1">{bucket.bucket}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Client Form Modal */}
      {formOpen && (
        <ClientForm
          clientId={editClientId}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  );
};

export default ClientsModule;
