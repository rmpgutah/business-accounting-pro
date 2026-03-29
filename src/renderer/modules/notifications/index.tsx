import React, { useEffect, useState, useMemo } from 'react';
import {
  Bell, CheckCheck, AlertTriangle, Info, FileText, DollarSign, Clock,
  Users, Mail,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  entity_type?: string;
  entity_id?: string;
  created_at: string;
}

type ViewFilter = 'all' | 'unread';

// ─── Icon Map ───────────────────────────────────────────
const typeIcons: Record<string, React.FC<{ size?: number; className?: string }>> = {
  invoice: FileText,
  payment: DollarSign,
  expense: DollarSign,
  reminder: Clock,
  alert: AlertTriangle,
  client: Users,
  email: Mail,
  info: Info,
};

const typeColors: Record<string, string> = {
  invoice: 'text-accent-income',
  payment: 'text-accent-income',
  expense: 'text-accent-expense',
  reminder: 'text-accent-warning',
  alert: 'text-accent-expense',
  client: 'text-accent-blue',
  email: 'text-accent-purple',
  info: 'text-accent-blue',
};

// ─── Component ──────────────────────────────────────────
const Notifications: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ViewFilter>('all');

  // ─── Load ─────────────────────────────────────────────
  const loadNotifications = async () => {
    try {
      const rows = await api.listNotifications(filter === 'unread' ? true : undefined);
      setNotifications(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadNotifications();
  }, [filter]);

  // ─── Stats ────────────────────────────────────────────
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  // ─── Mark Read ────────────────────────────────────────
  const markAsRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const markAllRead = async () => {
    try {
      const unread = notifications.filter((n) => !n.is_read);
      await Promise.all(unread.map((n) => api.markNotificationRead(n.id)));
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  // ─── Displayed ────────────────────────────────────────
  const displayed = useMemo(() => {
    if (filter === 'unread') return notifications.filter((n) => !n.is_read);
    return notifications;
  }, [notifications, filter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading notifications...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary relative"
            style={{ borderRadius: '2px' }}
          >
            <Bell size={18} className="text-accent-blue" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[10px] font-bold text-white bg-accent-expense"
                style={{ borderRadius: '2px' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <div>
            <h2 className="module-title text-text-primary">Notifications</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {unreadCount} unread &middot; {notifications.length} total
            </p>
          </div>
        </div>
        <div className="module-actions">
          {/* Filter tabs */}
          <div className="flex items-center border border-border-primary" style={{ borderRadius: '2px' }}>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-bg-elevated text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border-primary ${
                filter === 'unread'
                  ? 'bg-bg-elevated text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => setFilter('unread')}
            >
              Unread
              {unreadCount > 0 && (
                <span className="ml-1.5 text-accent-expense">({unreadCount})</span>
              )}
            </button>
          </div>
          {unreadCount > 0 && (
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={markAllRead}
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Notification List */}
      {displayed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Bell size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {filter === 'unread'
              ? 'All caught up! Switch to "All" to see previous notifications.'
              : 'Notifications will appear here as events occur.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {displayed.map((n) => {
            const IconComponent = typeIcons[n.type] || Info;
            const iconColor = typeColors[n.type] || 'text-text-muted';

            return (
              <div
                key={n.id}
                className={`block-card flex items-start gap-3 cursor-pointer transition-colors hover:bg-bg-hover ${
                  !n.is_read ? 'border-l-2 border-l-accent-blue' : ''
                }`}
                onClick={() => !n.is_read && markAsRead(n.id)}
              >
                {/* Icon */}
                <div
                  className="w-8 h-8 shrink-0 flex items-center justify-center bg-bg-tertiary border border-border-primary mt-0.5"
                  style={{ borderRadius: '2px' }}
                >
                  <IconComponent size={16} className={iconColor} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        n.is_read ? 'text-text-secondary' : 'text-text-primary'
                      }`}
                    >
                      {n.title}
                    </span>
                    {!n.is_read && (
                      <span
                        className="w-2 h-2 bg-accent-blue shrink-0"
                        style={{ borderRadius: '2px' }}
                      />
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{n.message}</p>
                </div>

                {/* Time */}
                <span className="text-[11px] text-text-muted whitespace-nowrap shrink-0 mt-0.5">
                  {n.created_at
                    ? formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })
                    : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {displayed.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {displayed.length} notification{displayed.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default Notifications;
