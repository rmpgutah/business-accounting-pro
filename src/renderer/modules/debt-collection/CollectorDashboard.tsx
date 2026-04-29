import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  AlertTriangle, Clock, Gavel, MessageSquare, RefreshCw, Zap, TrendingUp,
  DollarSign, FileText, Download, BarChart3, Shield, Phone, Mail,
  ArrowUpRight, Activity, Target, Users, Printer
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import { downloadCSVBlob } from '../../lib/csv-export';

// ─── Types ──────────────────────────────────────────────
interface CollectorDashboardProps {
  onViewDebt: (id: string) => void;
}

interface DashboardData {
  brokenPromises: any[];
  overdueInstallments: any[];
  upcomingHearings: any[];
  followUpsDue: any[];
}

interface PortfolioKPIs {
  total_debts: number;
  total_portfolio: number;
  total_collected: number;
  total_outstanding: number;
  active_count: number;
  closed_count: number;
  legal_count: number;
  settled_count: number;
}

interface AgingData {
  age_0_30: number;
  age_31_60: number;
  age_61_90: number;
  age_90_plus: number;
}

interface PriorityItem {
  id: string;
  debtor_name: string;
  original_amount: number;
  amount_paid: number;
  balance: number;
  age_days: number;
}

interface ActivityItem {
  type: string;
  created_at: string;
  comm_type: string;
  notes: string;
  debtor_name: string;
  debt_id: string;
}

interface ComplianceAlert {
  id: string;
  debtor_name: string;
  cease_desist_active: number;
  statute_of_limitations_date: string;
}

interface CollectorPerf {
  collector_id: string;
  collector_name: string;
  total_assigned: number;
  total_collected: number;
  active_count: number;
}

// ─── Action Card ────────────────────────────────────────
const ActionCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  count: number;
  color: string;
  items: any[];
  onView: (debtId: string) => void;
  renderRow: (item: any) => React.ReactNode;
}> = ({ title, icon, count, color, items, onView, renderRow }) => (
  <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
    <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary" style={{ borderLeftWidth: 4, borderLeftColor: color }}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold text-text-primary">{title}</span>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: color + '22', color, minWidth: 24, textAlign: 'center' }}>
        {count}
      </span>
    </div>
    {items.length === 0 ? (
      <div className="px-4 py-6 text-center text-xs text-text-muted">None right now</div>
    ) : (
      <div className="max-h-64 overflow-y-auto">
        {items.map((item, idx) => (
          <div
            key={item.id || idx}
            className="flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover cursor-pointer border-b border-border-primary last:border-b-0 transition-colors"
            onClick={() => onView(item.debt_id || item.id)}
          >
            {renderRow(item)}
          </div>
        ))}
      </div>
    )}
  </div>
);

// ─── KPI Card ───────────────────────────────────────────
const KPICard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: React.ReactNode;
}> = ({ label, value, sub, color, icon }) => (
  <div className="block-card p-4" style={{ borderRadius: '6px' }}>
    <div className="flex items-center justify-between mb-2">
      <div className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
        {icon}
      </div>
      {sub && <span className="text-[10px] font-semibold text-text-muted">{sub}</span>}
    </div>
    <p className="text-xl font-bold font-mono" style={{ color }}>{value}</p>
    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1">{label}</p>
  </div>
);

// ─── Aging Bar ──────────────────────────────────────────
const AgingBar: React.FC<{ aging: AgingData }> = ({ aging }) => {
  const total = (aging.age_0_30 || 0) + (aging.age_31_60 || 0) + (aging.age_61_90 || 0) + (aging.age_90_plus || 0);
  if (total === 0) return <div className="text-xs text-text-muted text-center py-4">No active debts</div>;

  const segments = [
    { label: '0-30d', count: aging.age_0_30 || 0, color: '#22c55e' },
    { label: '31-60d', count: aging.age_31_60 || 0, color: '#eab308' },
    { label: '61-90d', count: aging.age_61_90 || 0, color: '#f59e0b' },
    { label: '90+d', count: aging.age_90_plus || 0, color: '#dc2626' },
  ];

  return (
    <div>
      <div className="flex h-5 overflow-hidden" style={{ borderRadius: '4px' }}>
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.label}
              style={{ width: `${(s.count / total) * 100}%`, background: s.color, minWidth: 2 }}
              title={`${s.label}: ${s.count}`}
            />
          ) : null
        )}
      </div>
      <div className="flex justify-between mt-2">
        {segments.map((s) => (
          <div key={s.label} className="text-center">
            <span className="text-xs font-bold font-mono" style={{ color: s.color }}>{s.count}</span>
            <span className="block text-[9px] text-text-muted uppercase tracking-wider">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const CollectorDashboard: React.FC<CollectorDashboardProps> = ({ onViewDebt }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<any[]>([]);

  // Feature 1-4: Portfolio KPIs
  const [kpis, setKpis] = useState<PortfolioKPIs | null>(null);
  // Feature 5-7: Analytics
  const [aging, setAging] = useState<AgingData | null>(null);
  const [collectionVelocity, setCollectionVelocity] = useState<number | null>(null);
  const [contactRate, setContactRate] = useState<number | null>(null);
  // Feature 8-10: Priority Queue, Activity Feed, Compliance
  const [priorityQueue, setPriorityQueue] = useState<PriorityItem[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [complianceAlerts, setComplianceAlerts] = useState<ComplianceAlert[]>([]);
  // Feature 11-13: Monthly Goal, Collector Perf, Quick Stats
  const [monthlyCollected, setMonthlyCollected] = useState(0);
  const [monthlyTarget, setMonthlyTarget] = useState(0);
  const [collectorPerf, setCollectorPerf] = useState<CollectorPerf[]>([]);
  const [weekStats, setWeekStats] = useState<{ collected: number; calls: number; promises: number }>({ collected: 0, calls: 0, promises: 0 });

  const load = async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const result = await api.collectorDashboard(activeCompany.id);
      setData(result);

      // Smart Recommendations (non-blocking)
      api.smartRecommendations(activeCompany.id).then(r => setRecommendations(Array.isArray(r) ? r : [])).catch(() => {});

      // Feature 1-4: Portfolio KPIs
      try {
        const kpiRows = await api.rawQuery(`
          SELECT
            COUNT(*) as total_debts,
            COALESCE(SUM(original_amount), 0) as total_portfolio,
            COALESCE(SUM(COALESCE(original_amount, 0) - COALESCE(balance_due, 0)), 0) as total_collected,
            COALESCE(SUM(balance_due), 0) as total_outstanding,
            COALESCE(SUM(CASE WHEN status = 'active' OR status = 'in_collection' THEN 1 ELSE 0 END), 0) as active_count,
            COALESCE(SUM(CASE WHEN status = 'closed' OR status = 'written_off' THEN 1 ELSE 0 END), 0) as closed_count,
            COALESCE(SUM(CASE WHEN status = 'legal' THEN 1 ELSE 0 END), 0) as legal_count,
            COALESCE(SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END), 0) as settled_count
          FROM debts WHERE company_id = ?
        `, [activeCompany.id]);
        if (kpiRows?.[0]) setKpis(kpiRows[0]);
      } catch (e) { console.error('KPI load failed:', e); }

      // Feature 5: Aging Distribution
      try {
        const agingRows = await api.rawQuery(`
          SELECT
            COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) <= 30 THEN 1 ELSE 0 END), 0) as age_0_30,
            COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 30 AND julianday('now') - julianday(created_at) <= 60 THEN 1 ELSE 0 END), 0) as age_31_60,
            COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 60 AND julianday('now') - julianday(created_at) <= 90 THEN 1 ELSE 0 END), 0) as age_61_90,
            COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 90 THEN 1 ELSE 0 END), 0) as age_90_plus
          FROM debts WHERE company_id = ? AND status NOT IN ('closed', 'written_off', 'settled')
        `, [activeCompany.id]);
        if (agingRows?.[0]) setAging(agingRows[0]);
      } catch (e) { console.error('Aging load failed:', e); }

      // Feature 6: Collection Velocity (avg days from creation to first payment)
      try {
        const velRows = await api.rawQuery(`
          SELECT AVG(julianday(dp.created_at) - julianday(d.created_at)) as avg_days
          FROM debt_payments dp
          JOIN debts d ON dp.debt_id = d.id
          WHERE d.company_id = ?
            AND dp.id IN (
              SELECT MIN(dp2.id) FROM debt_payments dp2
              JOIN debts d2 ON dp2.debt_id = d2.id
              WHERE d2.company_id = ?
              GROUP BY dp2.debt_id
            )
        `, [activeCompany.id, activeCompany.id]);
        if (velRows?.[0]?.avg_days != null) setCollectionVelocity(Math.round(velRows[0].avg_days));
      } catch (e) { console.error('Velocity load failed:', e); }

      // Feature 7: Contact Success Rate
      try {
        const contactRows = await api.rawQuery(`
          SELECT
            COUNT(*) as total_contacts,
            COALESCE(SUM(CASE WHEN outcome IN ('promise_to_pay', 'payment_received', 'arrangement_made', 'positive', 'settlement_agreed') THEN 1 ELSE 0 END), 0) as positive_contacts
          FROM debt_communications
          WHERE debt_id IN (SELECT id FROM debts WHERE company_id = ?)
        `, [activeCompany.id]);
        if (contactRows?.[0] && contactRows[0].total_contacts > 0) {
          setContactRate(Math.round((contactRows[0].positive_contacts / contactRows[0].total_contacts) * 100));
        }
      } catch (e) { console.error('Contact rate load failed:', e); }

      // Feature 8: Priority Queue
      try {
        const prioRows = await api.rawQuery(`
          SELECT d.id, d.debtor_name, d.original_amount,
            COALESCE(d.original_amount, 0) - COALESCE(d.balance_due, 0) as amount_paid,
            COALESCE(d.balance_due, 0) as balance,
            julianday('now') - julianday(d.created_at) as age_days
          FROM debts d WHERE d.company_id = ? AND d.status IN ('active', 'in_collection')
          ORDER BY COALESCE(d.balance_due, 0) * (julianday('now') - julianday(d.created_at)) DESC
          LIMIT 10
        `, [activeCompany.id]);
        setPriorityQueue(Array.isArray(prioRows) ? prioRows : []);
      } catch (e) { console.error('Priority queue load failed:', e); }

      // Feature 9: Recent Activity Feed
      // SCHEMA: debt_communications has `body` (not `notes`); we surface that
      // field as `notes` in the result set so the UI can render either source.
      try {
        const feedRows = await api.rawQuery(`
          SELECT * FROM (
            SELECT 'communication' as type, dc.logged_at as created_at, dc.type as comm_type, dc.body as notes, d.debtor_name, d.id as debt_id
            FROM debt_communications dc JOIN debts d ON dc.debt_id = d.id
            WHERE d.company_id = ?
            ORDER BY dc.logged_at DESC LIMIT 10
          )
          UNION ALL
          SELECT * FROM (
            SELECT 'payment' as type, dp.created_at, dp.method as comm_type, CAST(dp.amount AS TEXT) as notes, d.debtor_name, d.id as debt_id
            FROM debt_payments dp JOIN debts d ON dp.debt_id = d.id
            WHERE d.company_id = ?
            ORDER BY dp.created_at DESC LIMIT 10
          )
          ORDER BY created_at DESC LIMIT 15
        `, [activeCompany.id, activeCompany.id]);
        setActivityFeed(Array.isArray(feedRows) ? feedRows : []);
      } catch (e) { console.error('Activity feed load failed:', e); }

      // Feature 10: Compliance Alerts
      try {
        const compRows = await api.rawQuery(`
          SELECT id, debtor_name, cease_desist_active, statute_of_limitations_date
          FROM debts WHERE company_id = ? AND status IN ('active', 'in_collection', 'legal') AND (
            cease_desist_active = 1 OR
            (statute_of_limitations_date IS NOT NULL AND julianday(statute_of_limitations_date) - julianday('now') < 90)
          )
        `, [activeCompany.id]);
        setComplianceAlerts(Array.isArray(compRows) ? compRows : []);
      } catch (e) { console.error('Compliance load failed:', e); }

      // Feature 11: Monthly Collection Goal
      // DATE: format from local Y/M/D — toISOString().slice(0,10) shifts the
      // day across the UTC boundary in non-UTC timezones.
      try {
        const monthStart = new Date();
        monthStart.setDate(1);
        const monthStr = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-01`;

        const collectedRows = await api.rawQuery(`
          SELECT COALESCE(SUM(dp.amount), 0) as collected
          FROM debt_payments dp
          JOIN debts d ON dp.debt_id = d.id
          WHERE d.company_id = ? AND dp.created_at >= ?
        `, [activeCompany.id, monthStr]);
        const collected = collectedRows?.[0]?.collected || 0;
        setMonthlyCollected(collected);

        // Target = average of last 3 months collections
        const targetRows = await api.rawQuery(`
          SELECT COALESCE(AVG(monthly_total), 0) as target FROM (
            SELECT SUM(dp.amount) as monthly_total
            FROM debt_payments dp
            JOIN debts d ON dp.debt_id = d.id
            WHERE d.company_id = ? AND dp.created_at >= date('now', '-3 months')
            GROUP BY strftime('%Y-%m', dp.created_at)
          )
        `, [activeCompany.id]);
        setMonthlyTarget(targetRows?.[0]?.target || collected || 1);
      } catch (e) { console.error('Monthly goal load failed:', e); }

      // Feature 12: Collector Performance
      try {
        const perfRows = await api.rawQuery(`
          SELECT
            d.assigned_collector_id as collector_id,
            COALESCE(u.display_name, u.email, 'Unassigned') as collector_name,
            COUNT(*) as total_assigned,
            COALESCE(SUM(d.original_amount - d.balance_due), 0) as total_collected,
            COALESCE(SUM(CASE WHEN d.status IN ('active', 'in_collection') THEN 1 ELSE 0 END), 0) as active_count
          FROM debts d
          LEFT JOIN users u ON d.assigned_collector_id = u.id
          WHERE d.company_id = ? AND d.assigned_collector_id IS NOT NULL AND d.assigned_collector_id != ''
          GROUP BY d.assigned_collector_id
          ORDER BY total_collected DESC
        `, [activeCompany.id]);
        setCollectorPerf(Array.isArray(perfRows) ? perfRows : []);
      } catch (e) { console.error('Collector perf load failed:', e); }

      // Feature 13: This Week Quick Stats
      // DATE: format from local Y/M/D — toISOString() shifts day in non-UTC zones.
      try {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

        const wRows = await api.rawQuery(`
          SELECT COALESCE(SUM(dp.amount), 0) as collected
          FROM debt_payments dp
          JOIN debts d ON dp.debt_id = d.id
          WHERE d.company_id = ? AND dp.created_at >= ?
        `, [activeCompany.id, weekStr]);

        const callRows = await api.rawQuery(`
          SELECT COUNT(*) as calls
          FROM debt_communications dc
          JOIN debts d ON dc.debt_id = d.id
          WHERE d.company_id = ? AND dc.logged_at >= ? AND dc.type = 'phone'
        `, [activeCompany.id, weekStr]);

        const promiseRows = await api.rawQuery(`
          SELECT COUNT(*) as promises
          FROM debt_promises dp2
          JOIN debts d ON dp2.debt_id = d.id
          WHERE d.company_id = ? AND dp2.created_at >= ?
        `, [activeCompany.id, weekStr]);

        setWeekStats({
          collected: wRows?.[0]?.collected || 0,
          calls: callRows?.[0]?.calls || 0,
          promises: promiseRows?.[0]?.promises || 0,
        });
      } catch (e) { console.error('Week stats load failed:', e); }

    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeCompany]);

  // Feature 14: Print Portfolio Summary
  const handlePrintSummary = useCallback(async () => {
    if (!activeCompany || !kpis) return;
    const recoveryRate = kpis.total_portfolio > 0 ? ((kpis.total_collected / kpis.total_portfolio) * 100).toFixed(1) : '0.0';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Portfolio Summary - ${activeCompany.name}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #1a1a2e; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          .sub { font-size: 12px; color: #666; margin-bottom: 24px; }
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
          .card { border: 1px solid #ddd; border-radius: 6px; padding: 16px; }
          .card-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 4px; }
          .card-value { font-size: 20px; font-weight: 700; font-family: monospace; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
          th { background: #f8f8fa; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
          .text-right { text-align: right; }
          .section { margin-top: 24px; margin-bottom: 8px; font-size: 14px; font-weight: 700; }
        </style>
      </head>
      <body>
        <h1>Portfolio Summary</h1>
        <div class="sub">${activeCompany.name} &mdash; Generated ${new Date().toLocaleDateString()}</div>
        <div class="grid">
          <div class="card">
            <div class="card-label">Total Portfolio</div>
            <div class="card-value">${formatCurrency(kpis.total_portfolio)}</div>
          </div>
          <div class="card">
            <div class="card-label">Total Collected</div>
            <div class="card-value" style="color: #16a34a;">${formatCurrency(kpis.total_collected)}</div>
          </div>
          <div class="card">
            <div class="card-label">Outstanding Balance</div>
            <div class="card-value" style="color: #dc2626;">${formatCurrency(kpis.total_outstanding)}</div>
          </div>
          <div class="card">
            <div class="card-label">Recovery Rate</div>
            <div class="card-value">${recoveryRate}%</div>
          </div>
          <div class="card">
            <div class="card-label">Active Accounts</div>
            <div class="card-value">${kpis.active_count}</div>
          </div>
          <div class="card">
            <div class="card-label">Total Debts</div>
            <div class="card-value">${kpis.total_debts}</div>
          </div>
        </div>
        ${aging ? `
        <div class="section">Aging Distribution</div>
        <table>
          <thead><tr><th>Bucket</th><th class="text-right">Count</th></tr></thead>
          <tbody>
            <tr><td>0-30 days</td><td class="text-right">${aging.age_0_30}</td></tr>
            <tr><td>31-60 days</td><td class="text-right">${aging.age_31_60}</td></tr>
            <tr><td>61-90 days</td><td class="text-right">${aging.age_61_90}</td></tr>
            <tr><td>90+ days</td><td class="text-right">${aging.age_90_plus}</td></tr>
          </tbody>
        </table>
        ` : ''}
        ${priorityQueue.length > 0 ? `
        <div class="section">Priority Queue (Top 10)</div>
        <table>
          <thead><tr><th>Debtor</th><th class="text-right">Balance</th><th class="text-right">Age</th></tr></thead>
          <tbody>
            ${priorityQueue.map(p => `<tr><td>${p.debtor_name}</td><td class="text-right">${formatCurrency(p.balance)}</td><td class="text-right">${Math.round(p.age_days)}d</td></tr>`).join('')}
          </tbody>
        </table>
        ` : ''}
        ${complianceAlerts.length > 0 ? `
        <div class="section">Compliance Alerts</div>
        <table>
          <thead><tr><th>Debtor</th><th>Alert</th></tr></thead>
          <tbody>
            ${complianceAlerts.map(c => {
              const alerts: string[] = [];
              if (c.cease_desist_active) alerts.push('Cease & Desist Active');
              if (c.statute_of_limitations_date) {
                const dLeft = Math.ceil((new Date(c.statute_of_limitations_date).getTime() - Date.now()) / 86400000);
                if (dLeft < 90) alerts.push(`SOL expires in ${dLeft} days`);
              }
              return `<tr><td>${c.debtor_name}</td><td>${alerts.join(', ')}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        ` : ''}
      </body>
      </html>
    `;
    await api.printPreview(html, 'Portfolio Summary');
  }, [activeCompany, kpis, aging, priorityQueue, complianceAlerts]);

  // Feature 15: Export Dashboard Data CSV
  const handleExportCSV = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const allDebts = await api.rawQuery(`
        SELECT debtor_name, original_amount, balance_due, status, current_stage, priority, created_at, delinquent_date
        FROM debts WHERE company_id = ? AND status IN ('active', 'in_collection', 'legal', 'disputed')
        ORDER BY balance_due DESC
      `, [activeCompany.id]);
      if (Array.isArray(allDebts) && allDebts.length > 0) {
        downloadCSVBlob(allDebts, `dashboard-active-debts-${new Date().toISOString().slice(0, 10)}.csv`);
      }
    } catch (e) { console.error('Export failed:', e); }
  }, [activeCompany]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading dashboard...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        No dashboard data available.
      </div>
    );
  }

  const totalActions = data.brokenPromises.length + data.overdueInstallments.length + data.upcomingHearings.length + data.followUpsDue.length + recommendations.length;
  const recoveryRate = kpis && kpis.total_portfolio > 0 ? ((kpis.total_collected / kpis.total_portfolio) * 100).toFixed(1) : '0.0';
  const monthlyGoalPct = monthlyTarget > 0 ? Math.min(100, Math.round((monthlyCollected / monthlyTarget) * 100)) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Collector Dashboard</h2>
          <p className="text-xs text-text-muted mt-0.5">
            {totalActions} action{totalActions !== 1 ? 's' : ''} requiring attention
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="block-btn flex items-center gap-2 text-xs" onClick={handlePrintSummary} title="Print Portfolio Summary">
            <Printer size={14} />
            Print Summary
          </button>
          <button className="block-btn flex items-center gap-2 text-xs" onClick={handleExportCSV} title="Export Active Debts CSV">
            <Download size={14} />
            Export Data
          </button>
          <button className="block-btn flex items-center gap-2 text-xs" onClick={load}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Feature 1-4: Portfolio KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-6 gap-3">
          <KPICard
            label="Total Portfolio"
            value={formatCurrency(kpis.total_portfolio)}
            color="#3b82f6"
            icon={<DollarSign size={16} className="text-blue-400" />}
          />
          <KPICard
            label="Total Collected"
            value={formatCurrency(kpis.total_collected)}
            color="#16a34a"
            icon={<TrendingUp size={16} className="text-green-400" />}
          />
          <KPICard
            label="Outstanding"
            value={formatCurrency(kpis.total_outstanding)}
            color="#dc2626"
            icon={<AlertTriangle size={16} className="text-red-400" />}
          />
          <KPICard
            label="Recovery Rate"
            value={`${recoveryRate}%`}
            color="#8b5cf6"
            icon={<Target size={16} className="text-purple-400" />}
          />
          <KPICard
            label="Active Accounts"
            value={String(kpis.active_count)}
            sub={`${kpis.legal_count} legal`}
            color="#f59e0b"
            icon={<Activity size={16} className="text-yellow-400" />}
          />
          <KPICard
            label="Settled / Closed"
            value={`${kpis.settled_count} / ${kpis.closed_count}`}
            color="#06b6d4"
            icon={<Shield size={16} className="text-cyan-400" />}
          />
        </div>
      )}

      {/* Feature 5-7: Analytics Row */}
      <div className="grid grid-cols-3 gap-3">
        {/* Collection Velocity */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-blue-400" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Collection Velocity</span>
          </div>
          <p className="text-2xl font-bold font-mono text-text-primary">
            {collectionVelocity != null ? `${collectionVelocity}d` : '--'}
          </p>
          <p className="text-[10px] text-text-muted mt-1">Avg days to first payment</p>
        </div>

        {/* Aging Distribution */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-yellow-400" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Aging Distribution</span>
          </div>
          {aging ? <AgingBar aging={aging} /> : <p className="text-xs text-text-muted">No data</p>}
        </div>

        {/* Contact Success Rate */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-3">
            <Phone size={14} className="text-green-400" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Contact Success Rate</span>
          </div>
          <p className="text-2xl font-bold font-mono" style={{ color: contactRate != null && contactRate >= 30 ? '#16a34a' : '#f59e0b' }}>
            {contactRate != null ? `${contactRate}%` : '--'}
          </p>
          <p className="text-[10px] text-text-muted mt-1">Positive outcome contacts</p>
        </div>
      </div>

      {/* Feature 11: Monthly Collection Goal + Feature 13: Quick Stats Bar */}
      <div className="grid grid-cols-2 gap-3">
        {/* Monthly Goal Tracker */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target size={14} className="text-purple-400" />
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Monthly Collection Goal</span>
            </div>
            <span className="text-xs font-bold font-mono" style={{ color: monthlyGoalPct >= 100 ? '#16a34a' : monthlyGoalPct >= 50 ? '#f59e0b' : '#dc2626' }}>
              {monthlyGoalPct}%
            </span>
          </div>
          <div className="h-3 bg-bg-tertiary overflow-hidden mb-2" style={{ borderRadius: '4px' }}>
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${monthlyGoalPct}%`,
                background: monthlyGoalPct >= 100 ? '#16a34a' : monthlyGoalPct >= 50 ? '#f59e0b' : '#dc2626',
                borderRadius: '4px',
              }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>Collected: <span className="font-mono font-bold text-text-secondary">{formatCurrency(monthlyCollected)}</span></span>
            <span>Target: <span className="font-mono font-bold text-text-secondary">{formatCurrency(monthlyTarget)}</span></span>
          </div>
        </div>

        {/* Quick Stats Bar (This Week) */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-yellow-400" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">This Week</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-lg font-bold font-mono text-accent-income">{formatCurrency(weekStats.collected)}</p>
              <p className="text-[9px] text-text-muted uppercase tracking-wider">Collected</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold font-mono text-blue-400">{weekStats.calls}</p>
              <p className="text-[9px] text-text-muted uppercase tracking-wider">Calls Made</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold font-mono text-yellow-400">{weekStats.promises}</p>
              <p className="text-[9px] text-text-muted uppercase tracking-wider">Promises</p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary badges (original) */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Broken Promises', count: data.brokenPromises.length, color: '#ef4444' },
          { label: 'Overdue Installments', count: data.overdueInstallments.length, color: '#d97706' },
          { label: 'Upcoming Hearings', count: data.upcomingHearings.length, color: '#8b5cf6' },
          { label: 'Follow-ups Due', count: data.followUpsDue.length, color: '#3b82f6' },
        ].map((s) => (
          <div key={s.label} className="block-card p-4 text-center">
            <p className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.count}</p>
            <p className="text-[10px] uppercase tracking-widest text-text-muted font-bold mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Feature 8: Priority Queue + Feature 10: Compliance Alerts */}
      <div className="grid grid-cols-2 gap-4">
        {/* Priority Queue */}
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary" style={{ borderLeftWidth: 4, borderLeftColor: '#ef4444' }}>
            <div className="flex items-center gap-2">
              <ArrowUpRight size={16} className="text-red-400" />
              <span className="text-sm font-semibold text-text-primary">Priority Queue</span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#ef444422', color: '#ef4444' }}>
              {priorityQueue.length}
            </span>
          </div>
          {priorityQueue.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-text-muted">No active debts</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {priorityQueue.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover cursor-pointer border-b border-border-primary last:border-b-0 transition-colors"
                  onClick={() => onViewDebt(item.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[10px] font-bold font-mono text-text-muted w-5 text-center">#{idx + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary font-medium truncate">{item.debtor_name}</p>
                      <p className="text-[10px] text-text-muted">{Math.round(item.age_days)}d old</p>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold text-accent-expense flex-shrink-0">{formatCurrency(item.balance)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Compliance Alerts */}
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary" style={{ borderLeftWidth: 4, borderLeftColor: '#f97316' }}>
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-orange-400" />
              <span className="text-sm font-semibold text-text-primary">Compliance Alerts</span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#f9731622', color: '#f97316' }}>
              {complianceAlerts.length}
            </span>
          </div>
          {complianceAlerts.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-text-muted">No compliance issues</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {complianceAlerts.map((alert) => {
                const flags: { label: string; color: string }[] = [];
                if (alert.cease_desist_active) flags.push({ label: 'C&D ACTIVE', color: '#dc2626' });
                if (alert.statute_of_limitations_date) {
                  const dLeft = Math.ceil((new Date(alert.statute_of_limitations_date).getTime() - Date.now()) / 86400000);
                  if (dLeft < 90) {
                    const sColor = dLeft < 30 ? '#ef4444' : '#f97316';
                    flags.push({ label: `SOL ${dLeft}d`, color: sColor });
                  }
                }
                return (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover cursor-pointer border-b border-border-primary last:border-b-0 transition-colors"
                    onClick={() => onViewDebt(alert.id)}
                  >
                    <p className="text-sm text-text-primary font-medium truncate">{alert.debtor_name}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {flags.map((f) => (
                        <span key={f.label} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: f.color + '22', color: f.color }}>
                          {f.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Action Cards (original) */}
      <div className="grid grid-cols-2 gap-4">
        <ActionCard
          title="Broken Promises"
          icon={<AlertTriangle size={16} className="text-red-400" />}
          count={data.brokenPromises.length}
          color="#ef4444"
          items={data.brokenPromises}
          onView={onViewDebt}
          renderRow={(item) => (
            <>
              <div className="min-w-0">
                <p className="text-sm text-text-primary font-medium truncate">{item.debtor_name}</p>
                <p className="text-xs text-text-muted">Promised {formatDate(item.promised_date)} · {formatCurrency(item.promised_amount)}</p>
              </div>
              <span className="text-xs font-mono text-accent-expense font-bold flex-shrink-0">{formatCurrency(item.balance_due)}</span>
            </>
          )}
        />

        <ActionCard
          title="Overdue Installments"
          icon={<Clock size={16} className="text-yellow-500" />}
          count={data.overdueInstallments.length}
          color="#d97706"
          items={data.overdueInstallments}
          onView={onViewDebt}
          renderRow={(item) => (
            <>
              <div className="min-w-0">
                <p className="text-sm text-text-primary font-medium truncate">{item.debtor_name}</p>
                <p className="text-xs text-text-muted">Due {formatDate(item.due_date)} · {formatCurrency(item.amount)}</p>
              </div>
              <span className="text-xs font-mono text-accent-expense font-bold flex-shrink-0">{formatCurrency(item.balance_due)}</span>
            </>
          )}
        />

        <ActionCard
          title="Upcoming Hearings"
          icon={<Gavel size={16} className="text-purple-400" />}
          count={data.upcomingHearings.length}
          color="#8b5cf6"
          items={data.upcomingHearings}
          onView={onViewDebt}
          renderRow={(item) => (
            <>
              <div className="min-w-0">
                <p className="text-sm text-text-primary font-medium truncate">{item.debtor_name}</p>
                <p className="text-xs text-text-muted">{formatDate(item.hearing_date)} {item.hearing_time ? `at ${item.hearing_time}` : ''} · {item.court_name || 'Court TBD'}</p>
              </div>
              <span className="text-xs font-mono text-text-secondary flex-shrink-0">{formatCurrency(item.balance_due)}</span>
            </>
          )}
        />

        <ActionCard
          title="Follow-ups Due"
          icon={<MessageSquare size={16} className="text-blue-400" />}
          count={data.followUpsDue.length}
          color="#3b82f6"
          items={data.followUpsDue}
          onView={onViewDebt}
          renderRow={(item) => (
            <>
              <div className="min-w-0">
                <p className="text-sm text-text-primary font-medium truncate">{item.debtor_name}</p>
                <p className="text-xs text-text-muted">{item.next_action || 'Follow up'} · Due {formatDate(item.next_action_date)}</p>
              </div>
              <span className="text-xs font-mono text-text-secondary flex-shrink-0">{formatCurrency(item.balance_due)}</span>
            </>
          )}
        />
      </div>

      {/* Feature 9: Recent Activity Feed */}
      {activityFeed.length > 0 && (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary" style={{ borderLeftWidth: 4, borderLeftColor: '#3b82f6' }}>
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-blue-400" />
              <span className="text-sm font-semibold text-text-primary">Recent Activity</span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#3b82f622', color: '#3b82f6' }}>
              {activityFeed.length}
            </span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {activityFeed.map((item, idx) => {
              const isPayment = item.type === 'payment';
              const icon = isPayment
                ? <DollarSign size={12} className="text-green-400" />
                : item.comm_type === 'phone' || item.comm_type === 'call'
                  ? <Phone size={12} className="text-blue-400" />
                  : item.comm_type === 'email'
                    ? <Mail size={12} className="text-purple-400" />
                    : <MessageSquare size={12} className="text-text-muted" />;
              return (
                <div
                  key={`${item.debt_id}-${idx}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover cursor-pointer border-b border-border-primary last:border-b-0 transition-colors"
                  onClick={() => onViewDebt(item.debt_id)}
                >
                  <div className="w-6 h-6 flex items-center justify-center bg-bg-tertiary border border-border-primary flex-shrink-0" style={{ borderRadius: '6px' }}>
                    {icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-text-primary truncate">{item.debtor_name}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6,
                        background: isPayment ? '#16a34a22' : '#3b82f622',
                        color: isPayment ? '#16a34a' : '#3b82f6',
                        textTransform: 'uppercase',
                      }}>
                        {isPayment ? 'Payment' : item.comm_type || 'Note'}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-muted truncate">
                      {isPayment ? `${formatCurrency(parseFloat(item.notes) || 0)} received` : (item.notes || 'No notes')}
                    </p>
                  </div>
                  <span className="text-[10px] text-text-muted flex-shrink-0 font-mono">{formatDate(item.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Feature 12: Collector Performance Leaderboard */}
      {collectorPerf.length > 0 && (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary" style={{ borderLeftWidth: 4, borderLeftColor: '#06b6d4' }}>
            <div className="flex items-center gap-2">
              <Users size={16} className="text-cyan-400" />
              <span className="text-sm font-semibold text-text-primary">Collector Performance</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="block-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Collector</th>
                  <th className="text-right">Assigned</th>
                  <th className="text-right">Active</th>
                  <th className="text-right">Collected</th>
                </tr>
              </thead>
              <tbody>
                {collectorPerf.map((cp, idx) => (
                  <tr key={cp.collector_id || idx}>
                    <td className="text-text-muted font-mono text-xs">{idx + 1}</td>
                    <td className="text-text-primary font-medium text-sm">{cp.collector_name}</td>
                    <td className="text-right font-mono text-text-secondary">{cp.total_assigned}</td>
                    <td className="text-right font-mono text-text-secondary">{cp.active_count}</td>
                    <td className="text-right font-mono font-bold text-accent-income">{formatCurrency(cp.total_collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Smart Recommendations */}
      {recommendations.length > 0 && (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary" style={{ borderLeftWidth: 4, borderLeftColor: '#8b5cf6' }}>
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-purple-400" />
              <span className="text-sm font-semibold text-text-primary">Smart Recommendations</span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#8b5cf622', color: '#8b5cf6' }}>
              {recommendations.length}
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {recommendations.map((rec: any, idx: number) => {
              const priorityColors: Record<string, string> = { critical: '#ef4444', high: '#d97706', medium: '#3b82f6' };
              const color = priorityColors[rec.priority] || '#6b7280';
              return (
                <div
                  key={rec.debtId + idx}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover cursor-pointer border-b border-border-primary last:border-b-0 transition-colors"
                  onClick={() => onViewDebt(rec.debtId)}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: color + '22', color, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {rec.priority}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary font-medium">{rec.debtorName}</p>
                    <p className="text-xs text-text-secondary font-semibold">{rec.recommendation}</p>
                    <p className="text-xs text-text-muted mt-0.5">{rec.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectorDashboard;
