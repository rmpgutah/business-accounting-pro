import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Bell, CheckCheck, AlertTriangle, FileText, DollarSign, Clock,
  RefreshCw, BarChart3, Landmark, X, Settings, Trash2,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import api from '../../lib/api';
import { useNavigation } from '../../lib/navigation';
import ErrorBanner from '../../components/ErrorBanner';

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
type CategoryFilter = '' | 'payment' | 'overdue' | 'recurring' | 'report' | 'budget_alert' | 'reconciliation';

// ─── Category Config ────────────────────────────────────
interface CategoryConfig {
  label: string;
  icon: React.FC<{ size?: number; className?: string }>;
  color: string;
  emoji: string;
}

const categoryConfig: Record<string, CategoryConfig> = {
  payment: {
    label: 'Payment Received',
    icon: DollarSign,
    color: 'text-accent-income',
    emoji: '\uD83D\uDCB0',
  },
  overdue: {
    label: 'Invoice Overdue',
    icon: Clock,
    color: 'text-accent-expense',
    emoji: '\u23F0',
  },
  recurring: {
    label: 'Recurring Created',
    icon: RefreshCw,
    color: 'text-accent-blue',
    emoji: '\uD83D\uDCCB',
  },
  report: {
    label: 'Report Ready',
    icon: BarChart3,
    color: 'text-accent-purple',
    emoji: '\uD83D\uDCCA',
  },
  budget_alert: {
    label: 'Budget Threshold',
    icon: AlertTriangle,
    color: 'text-accent-warning',
    emoji: '\u26A0\uFE0F',
  },
  reconciliation: {
    label: 'Reconciliation Needed',
    icon: Landmark,
    color: 'text-accent-blue',
    emoji: '\uD83C\uDFE6',
  },
};

const defaultCategory: CategoryConfig = {
  label: 'Notification',
  icon: Bell,
  color: 'text-text-muted',
  emoji: '',
};

// ─── Component ──────────────────────────────────────────
const Notifications: React.FC = () => {
  const nav = useNavigation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('');
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [error, setError] = useState('');

  // ─── Load ─────────────────────────────────────────────
  const loadNotifications = useCallback(async () => {
    setError('');
    try {
      const rows = await api.listNotifications(filter === 'unread' ? true : undefined);
      setNotifications(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      console.error('Failed to load notifications:', err);
      setError(err?.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadPreferences = async () => {
    setPrefsLoading(true);
    try {
      const prefs = await api.getNotificationPreferences();
      setPreferences(prefs || {});
    } catch (err: any) {
      console.error('Failed to load preferences:', err);
      setError(err?.message || 'Failed to load preferences');
    } finally {
      setPrefsLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadNotifications();
  }, [filter, loadNotifications]);

  useEffect(() => {
    if (showPreferences) loadPreferences();
  }, [showPreferences]);

  // ─── Stats ────────────────────────────────────────────
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  // ─── Filtered by Category ─────────────────────────────
  const displayed = useMemo(() => {
    let list = filter === 'unread'
      ? notifications.filter((n) => !n.is_read)
      : notifications;
    if (categoryFilter) {
      list = list.filter((n) => n.type === categoryFilter);
    }
    return list;
  }, [notifications, filter, categoryFilter]);

  // ─── Category counts ──────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notifications) {
      counts[n.type] = (counts[n.type] || 0) + 1;
    }
    return counts;
  }, [notifications]);

  // ─── Mark Read ────────────────────────────────────────
  const markAsRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    } catch (err: any) {
      console.error('Failed to mark notification read:', err);
      alert('Failed to mark as read: ' + (err?.message || 'Unknown error'));
    }
  };

  const markAllRead = async () => {
    try {
      // Perf: single bulk IPC + SQL UPDATE replaces an N-call loop that locked
      // the renderer when there were many unread notifications.
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err: any) {
      console.error('Failed to mark all read:', err);
      alert('Failed to mark all read: ' + (err?.message || 'Unknown error'));
    }
  };

  // ─── Dismiss / Clear ─────────────────────────────────
  const dismissNotification = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await api.dismissNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err: any) {
      console.error('Failed to dismiss notification:', err);
      alert('Failed to dismiss: ' + (err?.message || 'Unknown error'));
    }
  };

  const clearAllRead = async () => {
    try {
      await api.clearAllNotifications();
      setNotifications((prev) => prev.filter((n) => !n.is_read));
    } catch (err: any) {
      console.error('Failed to clear notifications:', err);
      alert('Failed to clear: ' + (err?.message || 'Unknown error'));
    }
  };

  // ─── Click-Through Navigation ─────────────────────────
  const handleNotificationClick = (n: Notification) => {
    if (!n.is_read) markAsRead(n.id);
    if (n.entity_type && n.entity_id) {
      nav.goToEntity(n.entity_type, n.entity_id);
    }
  };

  // ─── Save Preferences ────────────────────────────────
  const togglePreference = async (key: string) => {
    const updated = { ...preferences, [key]: !preferences[key] };
    setPreferences(updated);
    try {
      await api.updateNotificationPreferences(updated);
    } catch (err: any) {
      console.error('Failed to update preferences:', err);
      alert('Failed to update preferences: ' + (err?.message || 'Unknown error'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading notifications...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {error && <ErrorBanner message={error} title="Failed to load notifications" onDismiss={() => setError('')} />}
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary relative"
            style={{ borderRadius: '6px' }}
          >
            <Bell size={18} className="text-accent-blue" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[10px] font-bold text-white bg-accent-expense"
                style={{ borderRadius: '6px' }}
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
          <div className="flex items-center border border-border-primary" style={{ borderRadius: '6px' }}>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-bg-elevated text-text-primary'
                  : 'text-text-muted hover:text-text-secondary transition-colors'
              }`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border-primary ${
                filter === 'unread'
                  ? 'bg-bg-elevated text-text-primary'
                  : 'text-text-muted hover:text-text-secondary transition-colors'
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
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={clearAllRead}
            title="Clear all read notifications"
          >
            <Trash2 size={14} />
            Clear Read
          </button>
          <button
            className={`block-btn flex items-center gap-1.5 text-xs ${showPreferences ? 'bg-bg-elevated text-text-primary' : ''}`}
            onClick={() => setShowPreferences(!showPreferences)}
            title="Notification preferences"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Preferences Panel */}
      {showPreferences && (
        <div className="block-card-elevated p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Notification Preferences</h3>
            <button
              className="text-text-muted hover:text-text-primary transition-colors"
              onClick={() => setShowPreferences(false)}
            >
              <X size={16} />
            </button>
          </div>
          {prefsLoading ? (
            <p className="text-xs text-text-muted">Loading preferences...</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(categoryConfig).map(([key, config]) => (
                <label
                  key={key}
                  className="flex items-center gap-3 p-2 border border-border-primary cursor-pointer hover:bg-bg-hover transition-colors"
                  style={{ borderRadius: '6px' }}
                >
                  <div
                    className={`w-10 h-5 flex items-center rounded p-0.5 cursor-pointer transition-colors ${
                      preferences[key] !== false ? 'bg-accent-income' : 'bg-bg-tertiary border border-border-primary'
                    }`}
                    onClick={(e) => { e.preventDefault(); togglePreference(key); }}
                  >
                    <div
                      className={`w-4 h-4 bg-bg-secondary rounded transform transition-transform ${
                        preferences[key] !== false ? 'translate-x-5' : 'translate-x-0'
                      }`}
                      style={{ borderRadius: '6px' }}
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-1">
                    <config.icon size={14} className={config.color} />
                    <span className="text-xs text-text-secondary">{config.label}</span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category Filter Chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className={`px-3 py-1 text-xs font-medium border transition-colors ${
            categoryFilter === ''
              ? 'bg-bg-elevated text-text-primary border-border-primary'
              : 'text-text-muted border-transparent hover:text-text-secondary transition-colors'
          }`}
          style={{ borderRadius: '6px' }}
          onClick={() => setCategoryFilter('')}
        >
          All Types
        </button>
        {Object.entries(categoryConfig).map(([key, config]) => {
          const count = categoryCounts[key] || 0;
          if (count === 0 && categoryFilter !== key) return null;
          return (
            <button
              key={key}
              className={`px-3 py-1 text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                categoryFilter === key
                  ? 'bg-bg-elevated text-text-primary border-border-primary'
                  : 'text-text-muted border-transparent hover:text-text-secondary transition-colors'
              }`}
              style={{ borderRadius: '6px' }}
              onClick={() => setCategoryFilter(categoryFilter === key ? '' : key as CategoryFilter)}
            >
              <config.icon size={12} className={config.color} />
              {config.label}
              {count > 0 && (
                <span className="text-[10px] text-text-muted ml-0.5">({count})</span>
              )}
            </button>
          );
        })}
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
            const config = categoryConfig[n.type] || defaultCategory;
            const IconComponent = config.icon;
            const iconColor = config.color;

            return (
              <div
                key={n.id}
                className={`block-card flex items-start gap-3 cursor-pointer transition-colors hover:bg-bg-hover group ${
                  !n.is_read ? 'border-l-2 border-l-accent-blue' : ''
                }`}
                onClick={() => handleNotificationClick(n)}
              >
                {/* Icon */}
                <div
                  className="w-8 h-8 shrink-0 flex items-center justify-center bg-bg-tertiary border border-border-primary mt-0.5"
                  style={{ borderRadius: '6px' }}
                >
                  <IconComponent size={16} className={iconColor} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted">{config.emoji}</span>
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
                        style={{ borderRadius: '6px' }}
                      />
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{n.message}</p>
                  {n.entity_type && (
                    <span className="text-[10px] text-accent-blue mt-1 inline-block">
                      Click to view {n.entity_type.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                {/* Time + Dismiss */}
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  <span className="text-[11px] text-text-muted whitespace-nowrap">
                    {n.created_at
                      ? formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })
                      : ''}
                  </span>
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-text-muted hover:text-accent-expense"
                    onClick={(e) => dismissNotification(e, n.id)}
                    title="Dismiss"
                  >
                    <X size={12} />
                  </button>
                </div>
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
