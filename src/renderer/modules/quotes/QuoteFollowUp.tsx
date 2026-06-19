import React, { useEffect, useState, useCallback } from 'react';
import {
  Bell,
  AlertTriangle,
  Clock,
  Eye,
  Mail,
  Phone,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';

interface QuoteRow {
  id: string;
  quote_number: string;
  status: string;
  total: number;
  client_id: string | null;
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  follow_up_date?: string | null;
  valid_until?: string | null;
  viewed_date?: string | null;
  sent_date?: string | null;
  issue_date: string;
}

interface QuoteFollowUpProps {
  onView?: (id: string) => void;
  refreshKey?: number;
}

const daysFromToday = (date: string | null | undefined): number | null => {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
};

const QuoteFollowUp: React.FC<QuoteFollowUpProps> = ({ onView, refreshKey = 0 }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [upcoming, setUpcoming] = useState<QuoteRow[]>([]);
  const [overdue, setOverdue] = useState<QuoteRow[]>([]);
  const [expiring, setExpiring] = useState<QuoteRow[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    try {
      const baseSelect = `q.id, q.quote_number, q.status, q.total, q.client_id,
                          q.follow_up_date, q.valid_until, q.viewed_date,
                          q.sent_date, q.issue_date,
                          c.name as client_name, c.email as client_email,
                          c.phone as client_phone`;
      const baseFrom = `quotes q LEFT JOIN clients c ON c.id = q.client_id`;
      const baseWhere = `q.company_id = ?`;

      const [upRows, overdueRows, expRows, viewedRows] = await Promise.all([
        // Upcoming follow-ups: today through +7 days
        api.rawQuery(
          `SELECT ${baseSelect} FROM ${baseFrom}
           WHERE ${baseWhere}
             AND q.follow_up_date IS NOT NULL
             AND q.follow_up_date >= date('now')
             AND q.follow_up_date <= date('now', '+7 days')
             AND q.status NOT IN ('converted','rejected','expired')
           ORDER BY q.follow_up_date ASC`,
          [activeCompany.id]
        ),
        // Overdue: follow_up_date < today
        api.rawQuery(
          `SELECT ${baseSelect} FROM ${baseFrom}
           WHERE ${baseWhere}
             AND q.follow_up_date IS NOT NULL
             AND q.follow_up_date < date('now')
             AND q.status NOT IN ('converted','rejected','expired')
           ORDER BY q.follow_up_date ASC`,
          [activeCompany.id]
        ),
        // Expiring: valid_until within 7 days, status='sent'
        api.rawQuery(
          `SELECT ${baseSelect} FROM ${baseFrom}
           WHERE ${baseWhere}
             AND q.status = 'sent'
             AND q.valid_until IS NOT NULL
             AND q.valid_until >= date('now')
             AND q.valid_until <= date('now', '+7 days')
           ORDER BY q.valid_until ASC`,
          [activeCompany.id]
        ),
        // Recently viewed: viewed_date in last 7 days
        api.rawQuery(
          `SELECT ${baseSelect} FROM ${baseFrom}
           WHERE ${baseWhere}
             AND q.viewed_date IS NOT NULL
             AND q.viewed_date >= date('now', '-7 days')
             AND q.status NOT IN ('converted','rejected')
           ORDER BY q.viewed_date DESC
           LIMIT 20`,
          [activeCompany.id]
        ),
      ]);

      setUpcoming(Array.isArray(upRows) ? (upRows as QuoteRow[]) : []);
      setOverdue(Array.isArray(overdueRows) ? (overdueRows as QuoteRow[]) : []);
      setExpiring(Array.isArray(expRows) ? (expRows as QuoteRow[]) : []);
      setRecentlyViewed(Array.isArray(viewedRows) ? (viewedRows as QuoteRow[]) : []);
    } catch (err: any) {
      console.error('Failed to load follow-ups:', err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleMarkFollowed = async (q: QuoteRow) => {
    if (busyId) return;
    setBusyId(q.id);
    try {
      await api.update('quotes', q.id, { follow_up_date: null });
      await api.create('quote_activity_log', {
        quote_id: q.id,
        activity_type: 'followed_up',
        description: 'Follow-up cleared',
      });
      await load();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleEmail = async (q: QuoteRow) => {
    if (!q.client_email) {
      alert('No email on file for this client.');
      return;
    }
    const subject = encodeURIComponent(`Following up on quote ${q.quote_number}`);
    const body = encodeURIComponent(
      `Hi ${q.client_name || ''},\n\nJust circling back on quote ${q.quote_number} for ${formatCurrency(q.total)}. Let me know if you have any questions.\n\nThanks!`
    );
    window.location.href = `mailto:${q.client_email}?subject=${subject}&body=${body}`;
    try {
      await api.create('quote_activity_log', {
        quote_id: q.id,
        activity_type: 'emailed',
        description: `Follow-up email composed to ${q.client_email}`,
      });
    } catch {
      /* non-fatal */
    }
  };

  const handleCall = (q: QuoteRow) => {
    if (!q.client_phone) {
      alert('No phone number on file for this client.');
      return;
    }
    window.location.href = `tel:${q.client_phone}`;
  };

  const renderRow = (
    q: QuoteRow,
    info: { label: string; tone: 'warn' | 'danger' | 'ok' | 'neutral' }
  ) => {
    const toneColor =
      info.tone === 'danger'
        ? '#ef4444'
        : info.tone === 'warn'
        ? '#f59e0b'
        : info.tone === 'ok'
        ? '#22c55e'
        : '#6b7280';
    return (
      <tr key={q.id}>
        <td className="font-mono font-semibold text-text-primary">
          <button
            onClick={() => onView?.(q.id)}
            className="hover:text-accent-blue transition-colors"
            style={{ cursor: 'pointer' }}
          >
            {q.quote_number}
          </button>
        </td>
        <td className="text-text-secondary truncate max-w-[200px]">
          {q.client_name || '—'}
        </td>
        <td className="text-right font-mono text-text-primary font-semibold">
          {formatCurrency(q.total)}
        </td>
        <td>
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1"
            style={{
              color: toneColor,
              background: `${toneColor}1a`,
              border: `1px solid ${toneColor}40`,
              borderRadius: '6px',
            }}
          >
            {info.label}
          </span>
        </td>
        <td className="text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              className="block-btn flex items-center gap-1 text-[11px] px-2 py-1"
              onClick={() => handleEmail(q)}
              title={q.client_email ? `Email ${q.client_email}` : 'No email'}
              disabled={!q.client_email}
            >
              <Mail size={12} /> Email
            </button>
            <button
              className="block-btn flex items-center gap-1 text-[11px] px-2 py-1"
              onClick={() => handleCall(q)}
              title={q.client_phone ? `Call ${q.client_phone}` : 'No phone'}
              disabled={!q.client_phone}
            >
              <Phone size={12} /> Call
            </button>
            {q.follow_up_date && (
              <button
                className="block-btn flex items-center gap-1 text-[11px] px-2 py-1"
                onClick={() => handleMarkFollowed(q)}
                disabled={busyId === q.id}
                title="Mark as followed up"
              >
                <CheckCircle2 size={12} /> Done
              </button>
            )}
            {onView && (
              <button
                className="block-btn flex items-center gap-1 text-[11px] px-2 py-1"
                onClick={() => onView(q.id)}
                title="View quote"
              >
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading follow-ups...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid #ef4444',
          borderRadius: '6px',
          padding: '12px 16px',
          color: '#ef4444',
          fontSize: '13px',
        }}
      >
        {error}
      </div>
    );
  }

  const totalCount = upcoming.length + overdue.length + expiring.length;

  return (
    <div className="space-y-4">
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <Bell size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Follow-Ups</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {totalCount} item{totalCount === 1 ? '' : 's'} need{totalCount === 1 ? 's' : ''} attention
            </p>
          </div>
        </div>
      </div>

      {/* Overdue Section */}
      <div className="block-card p-0 overflow-hidden">
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(239,68,68,0.06)',
          }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-accent-expense" />
            <span className="text-xs font-semibold text-accent-expense uppercase tracking-wider">
              Overdue Follow-Ups
            </span>
          </div>
          <span className="text-[10px] text-text-muted">{overdue.length} item{overdue.length === 1 ? '' : 's'}</span>
        </div>
        {overdue.length === 0 ? (
          <div className="text-xs text-text-muted py-6 text-center">
            No overdue follow-ups — nice work.
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Client</th>
                <th className="text-right">Total</th>
                <th>Due</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {overdue.map((q) => {
                const days = daysFromToday(q.follow_up_date);
                return renderRow(q, {
                  label:
                    days !== null
                      ? `${Math.abs(days)}d overdue`
                      : 'Overdue',
                  tone: 'danger',
                });
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Upcoming Section */}
      <div className="block-card p-0 overflow-hidden">
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-accent-blue" />
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Upcoming Follow-Ups (Next 7 Days)
            </span>
          </div>
          <span className="text-[10px] text-text-muted">{upcoming.length} item{upcoming.length === 1 ? '' : 's'}</span>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-xs text-text-muted py-6 text-center">
            Nothing scheduled this week.
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Client</th>
                <th className="text-right">Total</th>
                <th>When</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((q) => {
                const days = daysFromToday(q.follow_up_date);
                const tone = days !== null && days <= 1 ? 'warn' : 'neutral';
                return renderRow(q, {
                  label:
                    days === 0
                      ? 'Today'
                      : days === 1
                      ? 'Tomorrow'
                      : days !== null
                      ? `In ${days}d`
                      : '—',
                  tone,
                });
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Expiring Section */}
      <div className="block-card p-0 overflow-hidden">
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(245,158,11,0.06)',
          }}
        >
          <div className="flex items-center gap-2">
            <Clock size={14} style={{ color: '#f59e0b' }} />
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: '#f59e0b' }}
            >
              Expiring Soon (Sent, Within 7 Days)
            </span>
          </div>
          <span className="text-[10px] text-text-muted">{expiring.length} item{expiring.length === 1 ? '' : 's'}</span>
        </div>
        {expiring.length === 0 ? (
          <div className="text-xs text-text-muted py-6 text-center">
            No quotes expiring this week.
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Client</th>
                <th className="text-right">Total</th>
                <th>Expires</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expiring.map((q) => {
                const days = daysFromToday(q.valid_until);
                return renderRow(q, {
                  label:
                    days === 0
                      ? 'Today'
                      : days !== null
                      ? `In ${days}d`
                      : '—',
                  tone: days !== null && days <= 2 ? 'danger' : 'warn',
                });
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Recently Viewed by Client */}
      <div className="block-card p-0 overflow-hidden">
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-accent-info" />
            <span className="text-xs font-semibold text-accent-info uppercase tracking-wider">
              Recently Viewed by Client (Engagement Signals)
            </span>
          </div>
          <span className="text-[10px] text-text-muted">
            {recentlyViewed.length} item{recentlyViewed.length === 1 ? '' : 's'}
          </span>
        </div>
        {recentlyViewed.length === 0 ? (
          <div className="text-xs text-text-muted py-6 text-center">
            No recent client views tracked.
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Client</th>
                <th className="text-right">Total</th>
                <th>Last Viewed</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentlyViewed.map((q) => {
                const days = daysFromToday(q.viewed_date);
                return renderRow(q, {
                  label:
                    days === 0
                      ? 'Today'
                      : days === -1
                      ? 'Yesterday'
                      : days !== null
                      ? `${Math.abs(days)}d ago`
                      : '—',
                  tone: 'ok',
                });
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default QuoteFollowUp;
