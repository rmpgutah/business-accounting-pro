import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  FileCheck,
  GitBranch,
  BarChart3,
  Plus,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  AlertTriangle,
  Target,
  Bell,
  Printer,
} from 'lucide-react';
import QuoteList from './QuoteList';
import QuoteForm from './QuoteForm';
import QuoteDetail from './QuoteDetail';
import QuoteAnalytics from './QuoteAnalytics';
import QuoteFollowUp from './QuoteFollowUp';
import api from '../../lib/api';
import { useAppStore } from '../../stores/appStore';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import EntityChip from '../../components/EntityChip';

// ─── Types ──────────────────────────────────────────────
type Tab = 'dashboard' | 'quotes' | 'pipeline' | 'analytics' | 'follow-up';
type QuoteView = 'list' | 'form' | 'detail';

interface DashboardStats {
  total_quotes: number;
  draft_count: number;
  sent_count: number;
  accepted_count: number;
  rejected_count: number;
  converted_count: number;
  expired_count: number;
  pipeline_value: number;
  won_value: number;
  lost_value: number;
  avg_won_value: number;
  avg_quote_value: number;
  expiring_soon: number;
  won_this_month: number;
  lost_this_month: number;
  won_this_month_value: number;
}

interface ActivityRow {
  id: string;
  quote_id: string;
  quote_number: string;
  quote_status: string;
  activity_type: string;
  description: string;
  user_name: string;
  created_at: string;
}

interface ClientStat {
  client_id: string;
  client_name: string;
  quote_count: number;
  total_value: number;
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
        : 'text-text-muted hover:text-text-secondary transition-colors'
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
    <div className="block-card p-4" style={{ borderRadius: '6px' }}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          {label}
        </span>
        {icon && <span style={{ color: colors[accent] }}>{icon}</span>}
      </div>
      <div className="text-xl font-bold text-text-primary font-mono">{value}</div>
      {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
};

// ─── Main Module ────────────────────────────────────────
const QuotesModule: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [quoteView, setQuoteView] = useState<QuoteView>('list');
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);
  const [quoteKey, setQuoteKey] = useState(0);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [topClients, setTopClients] = useState<ClientStat[]>([]);
  const [dashLoading, setDashLoading] = useState(false);

  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('quote');
    if (focus) {
      setDetailQuoteId(focus.id);
      setQuoteView('detail');
      setTab('quotes');
    }
  }, [consumeFocusEntity]);

  // ─── Load dashboard ───────────────────────────────────
  const loadDashboard = useCallback(async () => {
    if (!activeCompany) return;
    setDashLoading(true);
    try {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      const [statsRows, activityRows, clientRows] = await Promise.all([
        api.rawQuery(
          `SELECT
            COUNT(*) as total_quotes,
            SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) as draft_count,
            SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent_count,
            SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) as accepted_count,
            SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected_count,
            SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END) as converted_count,
            SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) as expired_count,
            COALESCE(SUM(CASE WHEN status IN ('draft','sent') THEN total ELSE 0 END), 0) as pipeline_value,
            COALESCE(SUM(CASE WHEN status='converted' THEN total ELSE 0 END), 0) as won_value,
            COALESCE(SUM(CASE WHEN status='rejected' THEN total ELSE 0 END), 0) as lost_value,
            COALESCE(AVG(CASE WHEN status='converted' THEN total ELSE NULL END), 0) as avg_won_value,
            COALESCE(AVG(total), 0) as avg_quote_value,
            COALESCE(SUM(CASE WHEN status='sent' AND valid_until <= date('now', '+7 days') AND valid_until >= date('now') THEN 1 ELSE 0 END), 0) as expiring_soon,
            COALESCE(SUM(CASE WHEN status='converted' AND won_date >= ? THEN 1 ELSE 0 END), 0) as won_this_month,
            COALESCE(SUM(CASE WHEN status='rejected' AND created_at >= ? THEN 1 ELSE 0 END), 0) as lost_this_month,
            COALESCE(SUM(CASE WHEN status='converted' AND won_date >= ? THEN total ELSE 0 END), 0) as won_this_month_value
          FROM quotes WHERE company_id = ?`,
          [monthStart, monthStart, monthStart, activeCompany.id]
        ),
        api.rawQuery(
          `SELECT qa.*, q.quote_number, q.status as quote_status
           FROM quote_activity_log qa
           JOIN quotes q ON qa.quote_id = q.id
           WHERE q.company_id = ?
           ORDER BY qa.created_at DESC LIMIT 10`,
          [activeCompany.id]
        ),
        api.rawQuery(
          `SELECT q.client_id, c.name as client_name,
                  COUNT(*) as quote_count,
                  COALESCE(SUM(q.total), 0) as total_value
           FROM quotes q
           LEFT JOIN clients c ON c.id = q.client_id
           WHERE q.company_id = ? AND q.client_id IS NOT NULL
           GROUP BY q.client_id
           ORDER BY total_value DESC LIMIT 5`,
          [activeCompany.id]
        ),
      ]);
      const s = (Array.isArray(statsRows) ? statsRows : [])[0] as DashboardStats | undefined;
      setStats(s || null);
      setActivity(Array.isArray(activityRows) ? activityRows : []);
      setTopClients(Array.isArray(clientRows) ? clientRows : []);
    } catch (err) {
      console.error('Failed to load quotes dashboard:', err);
    } finally {
      setDashLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    if (tab === 'dashboard') loadDashboard();
  }, [tab, loadDashboard, quoteKey]);

  // ─── Quote view handlers ──────────────────────────────
  const handleNewQuote = useCallback(() => {
    setEditingQuoteId(null);
    setQuoteView('form');
    setTab('quotes');
  }, []);

  const handleEditQuote = useCallback((id: string) => {
    setEditingQuoteId(id);
    setQuoteView('form');
    setTab('quotes');
  }, []);

  const handleViewQuote = useCallback((id: string) => {
    setDetailQuoteId(id);
    setQuoteView('detail');
    setTab('quotes');
  }, []);

  const handleQuoteBack = useCallback(() => {
    setQuoteView('list');
    setEditingQuoteId(null);
    setDetailQuoteId(null);
  }, []);

  const handleQuoteSaved = useCallback(() => {
    setQuoteView('list');
    setEditingQuoteId(null);
    setDetailQuoteId(null);
    setQuoteKey((k) => k + 1);
  }, []);

  // ─── Win rate calc ────────────────────────────────────
  const winRate = useMemo(() => {
    if (!stats) return 0;
    const closed = stats.converted_count + stats.rejected_count;
    if (closed === 0) return 0;
    return Math.round((stats.converted_count / closed) * 100);
  }, [stats]);

  // ─── Conversion funnel data ───────────────────────────
  const funnel = useMemo(() => {
    if (!stats) return [];
    const total = stats.total_quotes;
    const sent = stats.sent_count + stats.accepted_count + stats.converted_count + stats.rejected_count + stats.expired_count;
    const accepted = stats.accepted_count + stats.converted_count;
    const converted = stats.converted_count;
    return [
      { label: 'Total Quotes', value: total, color: '#6b7280' },
      { label: 'Sent', value: sent, color: '#3b82f6' },
      { label: 'Accepted', value: accepted, color: '#8b5cf6' },
      { label: 'Converted', value: converted, color: '#22c55e' },
    ];
  }, [stats]);

  // ─── Activity icon ────────────────────────────────────
  const activityIcon = (t: string): React.ReactNode => {
    switch (t) {
      case 'created':
        return <Plus size={12} className="text-accent-blue" />;
      case 'sent':
        return <ArrowRight size={12} className="text-accent-blue" />;
      case 'viewed':
        return <Bell size={12} className="text-accent-info" />;
      case 'accepted':
      case 'converted':
        return <TrendingUp size={12} className="text-accent-income" />;
      case 'rejected':
      case 'expired':
        return <TrendingDown size={12} className="text-accent-expense" />;
      default:
        return <Clock size={12} className="text-text-muted" />;
    }
  };

  // ─── Print pipeline summary ───────────────────────────
  const handlePrintSummary = async () => {
    if (!stats) return;
    const html = `
<html><head><meta charset="utf-8"><title>Pipeline Summary</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px;color:#0f172a}
h1{margin:0 0 8px 0;font-size:22px}
h2{margin:24px 0 8px 0;font-size:16px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px}
.card{border:1px solid #e5e7eb;border-radius:6px;padding:12px}
.label{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.value{font-size:18px;font-weight:700;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
th,td{text-align:left;padding:6px;border-bottom:1px solid #e5e7eb}
th{background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
</style></head><body>
<h1>Quote Pipeline Summary</h1>
<div style="font-size:12px;color:#6b7280">${activeCompany?.name || ''} &middot; ${formatDate(new Date().toISOString())}</div>
<h2>Pipeline KPIs</h2>
<div class="grid">
<div class="card"><div class="label">Total Quotes</div><div class="value">${stats.total_quotes}</div></div>
<div class="card"><div class="label">Pipeline Value</div><div class="value">${formatCurrency(stats.pipeline_value)}</div></div>
<div class="card"><div class="label">Win Rate</div><div class="value">${winRate}%</div></div>
<div class="card"><div class="label">Avg Quote Value</div><div class="value">${formatCurrency(stats.avg_quote_value)}</div></div>
<div class="card"><div class="label">Pending</div><div class="value">${stats.sent_count}</div></div>
<div class="card"><div class="label">Expiring Soon</div><div class="value">${stats.expiring_soon}</div></div>
<div class="card"><div class="label">Won This Month</div><div class="value">${stats.won_this_month}</div></div>
<div class="card"><div class="label">Lost This Month</div><div class="value">${stats.lost_this_month}</div></div>
</div>
<h2>Top Clients by Quote Value</h2>
<table><thead><tr><th>Client</th><th>Quotes</th><th style="text-align:right">Value</th></tr></thead>
<tbody>
${topClients
  .map(
    (c) =>
      `<tr><td>${c.client_name || '-'}</td><td>${c.quote_count}</td><td style="text-align:right">${formatCurrency(c.total_value)}</td></tr>`
  )
  .join('')}
</tbody></table>
</body></html>`;
    await api.printPreview(html, 'Quote Pipeline Summary');
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Tabs */}
      <div className="flex border-b border-border-primary mb-6 cursor-pointer">
        <TabBtn
          active={tab === 'dashboard'}
          icon={<LayoutDashboard size={16} />}
          label="Dashboard"
          onClick={() => setTab('dashboard')}
        />
        <TabBtn
          active={tab === 'quotes'}
          icon={<FileCheck size={16} />}
          label="Quotes"
          onClick={() => setTab('quotes')}
        />
        <TabBtn
          active={tab === 'pipeline'}
          icon={<GitBranch size={16} />}
          label="Pipeline"
          onClick={() => setTab('pipeline')}
        />
        <TabBtn
          active={tab === 'follow-up'}
          icon={<Bell size={16} />}
          label="Follow-Ups"
          onClick={() => setTab('follow-up')}
        />
        <TabBtn
          active={tab === 'analytics'}
          icon={<BarChart3 size={16} />}
          label="Analytics"
          onClick={() => setTab('analytics')}
        />
      </div>

      {/* ─── Dashboard Tab ────────────────────────────── */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          {dashLoading && !stats ? (
            <div className="text-text-muted text-sm">Loading dashboard...</div>
          ) : (
            <>
              {/* Quick Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button className="block-btn-primary flex items-center gap-2" onClick={handleNewQuote}>
                  <Plus size={14} /> New Quote
                </button>
                <button
                  className="block-btn flex items-center gap-2"
                  onClick={() => setTab('pipeline')}
                >
                  <GitBranch size={14} /> View Pipeline
                </button>
                <button
                  className="block-btn flex items-center gap-2"
                  onClick={() => setTab('follow-up')}
                >
                  <Bell size={14} /> Follow-Ups Due
                </button>
                <button
                  className="block-btn flex items-center gap-2"
                  onClick={() => setTab('analytics')}
                >
                  <BarChart3 size={14} /> Analytics
                </button>
                <button
                  className="block-btn flex items-center gap-2"
                  onClick={handlePrintSummary}
                  title="Print pipeline summary"
                >
                  <Printer size={14} /> Print Summary
                </button>
              </div>

              {/* KPI Row 1 */}
              <div className="grid grid-cols-4 gap-3">
                <KpiCard
                  label="Active Quotes"
                  value={String(stats ? stats.draft_count + stats.sent_count : 0)}
                  hint={`${stats?.total_quotes ?? 0} total`}
                  icon={<FileCheck size={14} />}
                />
                <KpiCard
                  label="Pipeline Value"
                  value={formatCurrency(stats?.pipeline_value || 0)}
                  hint="Draft + sent"
                  icon={<DollarSign size={14} />}
                  accent="blue"
                />
                <KpiCard
                  label="Win Rate"
                  value={`${winRate}%`}
                  hint={`${stats?.converted_count ?? 0} won / ${stats?.rejected_count ?? 0} lost`}
                  icon={<Target size={14} />}
                  accent="green"
                />
                <KpiCard
                  label="Avg Quote Value"
                  value={formatCurrency(stats?.avg_quote_value || 0)}
                  hint={`Avg won: ${formatCurrency(stats?.avg_won_value || 0)}`}
                  icon={<DollarSign size={14} />}
                  accent="purple"
                />
              </div>

              {/* KPI Row 2 */}
              <div className="grid grid-cols-4 gap-3">
                <KpiCard
                  label="Pending Response"
                  value={String(stats?.sent_count || 0)}
                  hint="Sent quotes"
                  icon={<Clock size={14} />}
                  accent="orange"
                />
                <KpiCard
                  label="Expiring (7 days)"
                  value={String(stats?.expiring_soon || 0)}
                  hint="Send a follow-up"
                  icon={<AlertTriangle size={14} />}
                  accent="red"
                />
                <KpiCard
                  label="Converted This Month"
                  value={String(stats?.won_this_month || 0)}
                  hint={formatCurrency(stats?.won_this_month_value || 0)}
                  icon={<TrendingUp size={14} />}
                  accent="green"
                />
                <KpiCard
                  label="Lost This Month"
                  value={String(stats?.lost_this_month || 0)}
                  hint="Rejected quotes"
                  icon={<TrendingDown size={14} />}
                  accent="red"
                />
              </div>

              {/* Recent Activity & Top Clients side-by-side */}
              <div className="grid grid-cols-2 gap-3">
                {/* Recent Activity */}
                <div className="block-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
                      Recent Activity
                    </span>
                    <span className="text-[10px] text-text-muted">{activity.length} entries</span>
                  </div>
                  {activity.length === 0 ? (
                    <div className="text-xs text-text-muted py-4 text-center">
                      No activity yet
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {activity.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-start gap-2 text-xs"
                          style={{ borderLeft: '2px solid rgba(255,255,255,0.08)', paddingLeft: 8 }}
                        >
                          <span className="mt-0.5">{activityIcon(a.activity_type)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-text-secondary">
                              <button
                                className="font-mono font-semibold text-text-primary hover:text-accent-blue"
                                onClick={() => handleViewQuote(a.quote_id)}
                                style={{ cursor: 'pointer' }}
                              >
                                {a.quote_number}
                              </button>
                              <span className="ml-2">{a.description || a.activity_type}</span>
                            </div>
                            <div className="text-[10px] text-text-muted mt-0.5">
                              {formatDate(a.created_at)} {a.user_name ? `· ${a.user_name}` : ''}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Top Clients */}
                <div className="block-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
                      Top Clients by Quote Value
                    </span>
                  </div>
                  {topClients.length === 0 ? (
                    <div className="text-xs text-text-muted py-4 text-center">No data yet</div>
                  ) : (
                    <table className="block-table">
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th className="text-right">Quotes</th>
                          <th className="text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topClients.map((c) => (
                          <tr key={c.client_id}>
                            <td className="text-text-secondary truncate max-w-[160px]">
                              {c.client_id ? (
                                <EntityChip
                                  type="client"
                                  id={c.client_id}
                                  label={c.client_name || ''}
                                  variant="inline"
                                />
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="text-right text-text-secondary font-mono text-xs">
                              {c.quote_count}
                            </td>
                            <td className="text-right font-mono text-text-primary font-semibold">
                              {formatCurrency(c.total_value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Status Distribution Stacked Bar */}
              <div className="block-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
                    Status Distribution
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {stats?.total_quotes ?? 0} quotes
                  </span>
                </div>
                {stats && stats.total_quotes > 0 ? (
                  <>
                    <div
                      className="flex w-full overflow-hidden"
                      style={{ height: '24px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      {[
                        { key: 'draft', count: stats.draft_count, color: '#6b7280', label: 'Draft' },
                        { key: 'sent', count: stats.sent_count, color: '#3b82f6', label: 'Sent' },
                        { key: 'accepted', count: stats.accepted_count, color: '#8b5cf6', label: 'Accepted' },
                        { key: 'converted', count: stats.converted_count, color: '#22c55e', label: 'Converted' },
                        { key: 'rejected', count: stats.rejected_count, color: '#ef4444', label: 'Rejected' },
                        { key: 'expired', count: stats.expired_count, color: '#f59e0b', label: 'Expired' },
                      ]
                        .filter((s) => s.count > 0)
                        .map((s) => {
                          const pct = (s.count / stats.total_quotes) * 100;
                          return (
                            <div
                              key={s.key}
                              style={{
                                width: `${pct}%`,
                                background: s.color,
                                color: '#fff',
                                fontSize: '10px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              title={`${s.label}: ${s.count}`}
                            >
                              {pct >= 8 ? `${s.label} ${s.count}` : ''}
                            </div>
                          );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-text-muted">
                      {[
                        { label: 'Draft', count: stats.draft_count, color: '#6b7280' },
                        { label: 'Sent', count: stats.sent_count, color: '#3b82f6' },
                        { label: 'Accepted', count: stats.accepted_count, color: '#8b5cf6' },
                        { label: 'Converted', count: stats.converted_count, color: '#22c55e' },
                        { label: 'Rejected', count: stats.rejected_count, color: '#ef4444' },
                        { label: 'Expired', count: stats.expired_count, color: '#f59e0b' },
                      ].map((l) => (
                        <span key={l.label} className="flex items-center gap-1">
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              background: l.color,
                              borderRadius: '2px',
                              display: 'inline-block',
                            }}
                          />
                          {l.label} ({l.count})
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-text-muted py-4 text-center">No quote data yet</div>
                )}
              </div>

              {/* Conversion Funnel */}
              <div className="block-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
                    Conversion Funnel
                  </span>
                </div>
                {funnel[0] && funnel[0].value > 0 ? (
                  <div className="space-y-2">
                    {funnel.map((stage, idx) => {
                      const max = funnel[0].value || 1;
                      const pct = (stage.value / max) * 100;
                      const prev = idx > 0 ? funnel[idx - 1].value : null;
                      const conv =
                        prev && prev > 0 ? Math.round((stage.value / prev) * 100) : null;
                      return (
                        <div key={stage.label}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-text-secondary">{stage.label}</span>
                            <span className="font-mono text-text-primary">
                              {stage.value}
                              {conv !== null && (
                                <span className="text-text-muted ml-2">({conv}% from prev)</span>
                              )}
                            </span>
                          </div>
                          <div
                            style={{
                              height: '20px',
                              background: 'rgba(255,255,255,0.04)',
                              borderRadius: '6px',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: '100%',
                                background: stage.color,
                                borderRadius: '6px',
                                transition: 'width 200ms ease',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted py-4 text-center">
                    Not enough data for funnel
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Quotes Tab (list / form / detail) ─────────── */}
      {tab === 'quotes' && (
        <>
          {quoteView === 'list' && (
            <QuoteList
              key={quoteKey}
              onNew={handleNewQuote}
              onEdit={handleEditQuote}
              onView={handleViewQuote}
            />
          )}
          {quoteView === 'form' && (
            <QuoteForm
              quoteId={editingQuoteId}
              onBack={handleQuoteBack}
              onSaved={handleQuoteSaved}
            />
          )}
          {quoteView === 'detail' && detailQuoteId && (
            <QuoteDetail
              quoteId={detailQuoteId}
              onBack={handleQuoteBack}
              onEdit={handleEditQuote}
            />
          )}
        </>
      )}

      {/* ─── Pipeline Tab ──────────────────────────────── */}
      {tab === 'pipeline' && (
        <PipelineBoard
          onView={handleViewQuote}
          onNew={handleNewQuote}
          refreshKey={quoteKey}
        />
      )}

      {/* ─── Follow-Ups Tab ────────────────────────────── */}
      {tab === 'follow-up' && (
        <QuoteFollowUp onView={handleViewQuote} refreshKey={quoteKey} />
      )}

      {/* ─── Analytics Tab ─────────────────────────────── */}
      {tab === 'analytics' && <QuoteAnalytics />}
    </div>
  );
};

// ─── Pipeline Board (Kanban) ─────────────────────────────
interface PipelineBoardProps {
  onView: (id: string) => void;
  onNew: () => void;
  refreshKey: number;
}
const PIPELINE_STAGES: Array<{ status: string; label: string; color: string }> = [
  { status: 'draft', label: 'Draft', color: '#6b7280' },
  { status: 'sent', label: 'Sent', color: '#3b82f6' },
  { status: 'accepted', label: 'Accepted', color: '#8b5cf6' },
  { status: 'converted', label: 'Won', color: '#22c55e' },
  { status: 'rejected', label: 'Lost', color: '#ef4444' },
];

const PipelineBoard: React.FC<PipelineBoardProps> = ({ onView, onNew, refreshKey }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const rows = await api.rawQuery(
          `SELECT q.*, c.name as client_name
           FROM quotes q
           LEFT JOIN clients c ON c.id = q.client_id
           WHERE q.company_id = ?
           ORDER BY q.issue_date DESC`,
          [activeCompany.id]
        );
        if (!cancelled) setQuotes(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error('Pipeline load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany, refreshKey]);

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    PIPELINE_STAGES.forEach((s) => (g[s.status] = []));
    for (const q of quotes) {
      if (g[q.status]) g[q.status].push(q);
    }
    return g;
  }, [quotes]);

  if (loading) {
    return <div className="text-text-muted text-sm">Loading pipeline...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <GitBranch size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Sales Pipeline</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {quotes.length} quote{quotes.length !== 1 ? 's' : ''} across{' '}
              {PIPELINE_STAGES.length} stages
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
          <Plus size={14} /> New Quote
        </button>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {PIPELINE_STAGES.map((stage) => {
          const items = grouped[stage.status] || [];
          const total = items.reduce((s, q) => s + (q.total || 0), 0);
          const weighted = items.reduce(
            (s, q) => s + ((q.total || 0) * (q.probability || 0)) / 100,
            0
          );
          return (
            <div key={stage.status} className="block-card p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      background: stage.color,
                      borderRadius: '2px',
                      display: 'inline-block',
                    }}
                  />
                  <span className="text-xs font-semibold text-text-primary uppercase">
                    {stage.label}
                  </span>
                </div>
                <span className="text-[10px] text-text-muted">{items.length}</span>
              </div>
              <div className="text-[10px] text-text-muted mb-2 font-mono">
                {formatCurrency(total)}
                {stage.status === 'sent' && weighted > 0 && (
                  <span className="ml-1 text-accent-blue">
                    (~{formatCurrency(weighted)} wtd)
                  </span>
                )}
              </div>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {items.length === 0 ? (
                  <div className="text-[11px] text-text-muted py-4 text-center">
                    No quotes
                  </div>
                ) : (
                  items.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => onView(q.id)}
                      className="block-card p-2 w-full text-left hover:border-accent-blue transition-colors"
                      style={{ background: 'rgba(18,19,24,0.40)', cursor: 'pointer' }}
                    >
                      <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                        <span className="font-mono font-semibold text-text-secondary">
                          {q.quote_number}
                        </span>
                        {typeof q.probability === 'number' && (
                          <span
                            style={{
                              color:
                                q.probability >= 70
                                  ? '#22c55e'
                                  : q.probability >= 30
                                  ? '#f59e0b'
                                  : '#ef4444',
                            }}
                          >
                            {q.probability}%
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-primary truncate font-medium">
                        {q.client_name || '— No client —'}
                      </div>
                      <div className="text-[11px] text-text-secondary font-mono mt-1">
                        {formatCurrency(q.total || 0)}
                      </div>
                      {q.valid_until && (
                        <div className="text-[10px] text-text-muted mt-0.5">
                          Valid: {formatDate(q.valid_until)}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default QuotesModule;
