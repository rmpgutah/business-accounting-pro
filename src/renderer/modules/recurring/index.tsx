import React, { useEffect, useState, useMemo } from 'react';
import {
  RefreshCw, Plus, Search, Filter, X, Play, Pause,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface RecurringTemplate {
  id: string;
  name: string;
  type: 'invoice' | 'expense';
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annually';
  next_date: string;
  end_date?: string;
  is_active: boolean;
  amount?: number;
  description?: string;
  created_at: string;
}

type TypeFilter = '' | 'invoice' | 'expense';
type StatusFilter = '' | 'active' | 'paused';

// ─── Empty Form ─────────────────────────────────────────
const emptyForm = {
  name: '',
  type: 'invoice' as 'invoice' | 'expense',
  frequency: 'monthly' as RecurringTemplate['frequency'],
  next_date: '',
  end_date: '',
  is_active: true,
};

// ─── Badges ─────────────────────────────────────────────
const typeBadge: Record<string, string> = {
  invoice: 'block-badge block-badge-income',
  expense: 'block-badge block-badge-expense',
};

const frequencyLabel: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
};

// ─── Component ──────────────────────────────────────────
const RecurringTransactions: React.FC = () => {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // ─── Load ─────────────────────────────────────────────
  const loadTemplates = async () => {
    try {
      const rows = await api.query('recurring_templates');
      setTemplates(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load recurring templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  // ─── Filtered ─────────────────────────────────────────
  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        if (!t.name?.toLowerCase().includes(q) && !t.description?.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (typeFilter && t.type !== typeFilter) return false;
      if (statusFilter === 'active' && !t.is_active) return false;
      if (statusFilter === 'paused' && t.is_active) return false;
      return true;
    });
  }, [templates, search, typeFilter, statusFilter]);

  // ─── Submit ───────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.next_date) return;
    setSaving(true);
    try {
      await api.create('recurring_templates', {
        ...formData,
        is_active: formData.is_active ? 1 : 0,
        end_date: formData.end_date || null,
      });
      setFormData(emptyForm);
      setShowForm(false);
      setLoading(true);
      await loadTemplates();
    } catch (err) {
      console.error('Failed to create template:', err);
    } finally {
      setSaving(false);
    }
  };

  // ─── Toggle Active ────────────────────────────────────
  const toggleActive = async (template: RecurringTemplate) => {
    try {
      await api.update('recurring_templates', template.id, {
        is_active: template.is_active ? 0 : 1,
      });
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === template.id ? { ...t, is_active: !t.is_active } : t,
        ),
      );
    } catch (err) {
      console.error('Failed to toggle template:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading recurring templates...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '2px' }}
          >
            <RefreshCw size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Recurring Transactions</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} template{filtered.length !== 1 ? 's' : ''} &middot;{' '}
              {templates.filter((t) => t.is_active).length} active
            </p>
          </div>
        </div>
        <button
          className="block-btn-primary flex items-center gap-2"
          onClick={() => setShowForm(true)}
        >
          <Plus size={16} />
          New Template
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="block-card-elevated space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">New Recurring Template</h3>
            <button
              className="text-text-muted hover:text-text-primary"
              onClick={() => { setShowForm(false); setFormData(emptyForm); }}
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Name *</label>
                <input
                  className="block-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Monthly Hosting Invoice"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Type *</label>
                <select
                  className="block-select"
                  value={formData.type}
                  onChange={(e) =>
                    setFormData({ ...formData, type: e.target.value as 'invoice' | 'expense' })
                  }
                >
                  <option value="invoice">Invoice</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Frequency *</label>
                <select
                  className="block-select"
                  value={formData.frequency}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      frequency: e.target.value as RecurringTemplate['frequency'],
                    })
                  }
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Next Date *</label>
                <input
                  type="date"
                  className="block-input"
                  value={formData.next_date}
                  onChange={(e) => setFormData({ ...formData, next_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">End Date (optional)</label>
                <input
                  type="date"
                  className="block-input"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  className={`w-10 h-5 flex items-center rounded-sm p-0.5 cursor-pointer transition-colors ${
                    formData.is_active ? 'bg-accent-income' : 'bg-bg-tertiary border border-border-primary'
                  }`}
                  onClick={() => setFormData({ ...formData, is_active: !formData.is_active })}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-sm transform transition-transform ${
                      formData.is_active ? 'translate-x-5' : 'translate-x-0'
                    }`}
                    style={{ borderRadius: '2px' }}
                  />
                </div>
                <span className="text-sm text-text-secondary">
                  {formData.is_active ? 'Active' : 'Paused'}
                </span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                className="block-btn"
                onClick={() => { setShowForm(false); setFormData(emptyForm); }}
              >
                Cancel
              </button>
              <button type="submit" className="block-btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Create Template'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="block-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search templates..."
              className="block-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-text-muted" />
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '130px' }}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            >
              <option value="">All Types</option>
              <option value="invoice">Invoice</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '130px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <RefreshCw size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No recurring templates found</p>
          <p className="text-xs text-text-muted mt-1">
            Create a template to automate recurring invoices or expenses.
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Frequency</th>
                <th>Next Date</th>
                <th>End Date</th>
                <th>Status</th>
                <th className="text-center">Toggle</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td className="text-text-primary font-medium">{t.name}</td>
                  <td>
                    <span className={typeBadge[t.type] || 'block-badge'}>{t.type}</span>
                  </td>
                  <td className="text-text-secondary">
                    {frequencyLabel[t.frequency] || t.frequency}
                  </td>
                  <td className="font-mono text-text-secondary text-xs">
                    {t.next_date ? format(parseISO(t.next_date), 'MMM d, yyyy') : '-'}
                  </td>
                  <td className="font-mono text-text-muted text-xs">
                    {t.end_date ? format(parseISO(t.end_date), 'MMM d, yyyy') : '-'}
                  </td>
                  <td>
                    {t.is_active ? (
                      <span className="block-badge block-badge-income">active</span>
                    ) : (
                      <span className="block-badge block-badge-warning">paused</span>
                    )}
                  </td>
                  <td className="text-center">
                    <button
                      className={`p-1 rounded-sm transition-colors ${
                        t.is_active
                          ? 'text-accent-warning hover:bg-accent-warning-bg'
                          : 'text-accent-income hover:bg-accent-income-bg'
                      }`}
                      onClick={() => toggleActive(t)}
                      title={t.is_active ? 'Pause' : 'Resume'}
                    >
                      {t.is_active ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      {filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {templates.length} template{templates.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default RecurringTransactions;
