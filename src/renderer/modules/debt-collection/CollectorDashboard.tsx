import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Gavel, MessageSquare, RefreshCw, Zap } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

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
      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: color + '22', color, minWidth: 24, textAlign: 'center' }}>
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

// ─── Component ──────────────────────────────────────────
const CollectorDashboard: React.FC<CollectorDashboardProps> = ({ onViewDebt }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<any[]>([]);

  const load = async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const result = await api.collectorDashboard(activeCompany.id);
      setData(result);
      api.smartRecommendations(activeCompany.id).then(r => setRecommendations(Array.isArray(r) ? r : [])).catch(() => {});
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeCompany]);

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
        <button className="block-btn flex items-center gap-2 text-xs" onClick={load}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Summary badges */}
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

      {/* Action Cards */}
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

      {/* Smart Recommendations */}
      {recommendations.length > 0 && (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary" style={{ borderLeftWidth: 4, borderLeftColor: '#8b5cf6' }}>
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-purple-400" />
              <span className="text-sm font-semibold text-text-primary">Smart Recommendations</span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#8b5cf622', color: '#8b5cf6' }}>
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
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: color + '22', color, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', marginTop: 2 }}>
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
