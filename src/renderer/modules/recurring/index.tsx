import React, { useEffect, useState, useMemo } from 'react';
import {
  RefreshCw, Plus, Search, Filter, X, Play, Pause, Pencil,
  Zap, Clock, History, FileText, Receipt,
} from 'lucide-react';
import { format, parseISO, isToday, isBefore, startOfDay } from 'date-fns';
import api from '../../lib/api';
import { useNavigation } from '../../lib/navigation';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface RecurringTemplate {
  id: string;
  name: string;
  type: 'invoice' | 'expense';
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annually';
  next_date: string;
  end_date?: string;
  is_active: boolean;
  last_generated?: string;
  template_data?: string;
  amount?: number;
  description?: string;
  created_at: string;
}

interface HistoryRecord {
  record_type: 'invoice' | 'expense';
  id: string;
  reference: string;
  amount: number;
  date: string;
  status: string;
  client_name?: string;
  template_name?: string;
}

type TypeFilter = '' | 'invoice' | 'expense';
type StatusFilter = '' | 'active' | 'paused';
type TabView = 'templates' | 'history';

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

// ─── Currency Formatter ─────────────────────────────────
const fmtCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);

// ─── Next Due Color ─────────────────────────────────────
function nextDueColor(nextDate: string): string {
  if (!nextDate) return 'text-text-muted';
  const d = parseISO(nextDate);
  const today = startOfDay(new Date());
  if (isBefore(d, today)) return 'text-accent-expense'; // overdue — red
  if (isToday(d)) return 'text-accent-warning'; // due today — yellow
  return 'text-accent-income'; // future — green
}

function nextDueBg(nextDate: string): string {
  if (!nextDate) return '';
  const d = parseISO(nextDate);
  const today = startOfDay(new Date());
  if (isBefore(d, today)) return 'bg-accent-expense/10';
  if (isToday(d)) return 'bg-accent-warning/10';
  return '';
}

// ─── Component ──────────────────────────────────────────
const RecurringTransactions: React.FC = () => {
  const nav = useNavigation();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastProcessed, setLastProcessed] = useState<string | null>(null);
  const [tab, setTab] = useState<TabView>('templates');
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ─── Load ─────────────────────────────────────────────
  const loadTemplates = async () => {
    if (!activeCompany) return;
    try {
      // Bug fix #14: was fetching all companies' templates — scoped to active company.
      const rows = await api.query('recurring_templates', { company_id: activeCompany.id });
      setTemplates(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load recurring templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLastProcessed = async () => {
    try {
      const ts = await api.getLastProcessed();
      setLastProcessed(ts);
    } catch {
      // ignore
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const rows = await api.getRecurringHistory();
      setHistory(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
    loadLastProcessed();
  }, [activeCompany]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab]);

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
      const payload = {
        ...formData,
        is_active: formData.is_active ? 1 : 0,
        end_date: formData.end_date || null,
      };
      if (editingId) {
        await api.update('recurring_templates', editingId, payload);
      } else {
        await api.create('recurring_templates', payload);
      }
      setFormData(emptyForm);
      setEditingId(null);
      setShowForm(false);
      setLoading(true);
      await loadTemplates();
    } catch (err) {
      console.error('Failed to save template:', err);
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

  // ─── Process Now ──────────────────────────────────────
  const handleProcessNow = async () => {
    setProcessing(true);
    try {
      const result = await api.processRecurringNow();
      await loadTemplates();
      await loadLastProcessed();
      if (tab === 'history') await loadHistory();
      if (result.processed > 0) {
        console.log(`Processed ${result.processed} templates: ${result.invoicesCreated} invoices, ${result.expensesCreated} expenses`);
      }
    } catch (err) {
      console.error('Failed to process recurring:', err);
    } finally {
      setProcessing(false);
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
            style={{ borderRadius: '6px' }}
          >
            <RefreshCw size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Recurring Transactions</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} template{filtered.length !== 1 ? 's' : ''} &middot;{' '}
              {templates.filter((t) => t.is_active).length} active
              {lastProcessed && (
                <>
                  {' '}&middot; Last processed:{' '}
                  <span className="text-text-secondary font-mono">
                    {format(parseISO(lastProcessed), 'MMM d, h:mm a')}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="block-btn flex items-center gap-2"
            onClick={handleProcessNow}
            disabled={processing}
          >
            <Zap size={14} className={processing ? 'animate-spin' : ''} />
            {processing ? 'Processing...' : 'Process Now'}
          </button>
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={() => setShowForm(true)}
          >
            <Plus size={16} />
            New Template
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border border-border-primary" style={{ borderRadius: '6px', width: 'fit-content' }}>
        <button
          className={`px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
            tab === 'templates'
              ? 'bg-bg-elevated text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          }`}
          onClick={() => setTab('templates')}
        >
          <Clock size={12} />
          Templates
        </button>
        <button
          className={`px-4 py-1.5 text-xs font-medium transition-colors border-l border-border-primary flex items-center gap-1.5 ${
            tab === 'history'
              ? 'bg-bg-elevated text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          }`}
          onClick={() => setTab('history')}
        >
          <History size={12} />
          History
        </button>
      </div>

      {/* Form */}
      {showForm && tab === 'templates' && (
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
                    className={`w-4 h-4 bg-bg-secondary rounded-sm transform transition-transform ${
                      formData.is_active ? 'translate-x-5' : 'translate-x-0'
                    }`}
                    style={{ borderRadius: '6px' }}
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

      {/* Templates Tab */}
      {tab === 'templates' && (
        <>
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
                    <th>Next Due</th>
                    <th>Last Generated</th>
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
                        <span className={typeBadge[t.type] || 'block-badge capitalize'}>{t.type}</span>
                      </td>
                      <td className="text-text-secondary">
                        {frequencyLabel[t.frequency] || t.frequency}
                      </td>
                      <td>
                        <span
                          className={`font-mono text-xs px-2 py-0.5 ${nextDueColor(t.next_date)} ${nextDueBg(t.next_date)}`}
                          style={{ borderRadius: '6px' }}
                        >
                          {t.next_date ? format(parseISO(t.next_date), 'MMM d, yyyy') : '-'}
                        </span>
                      </td>
                      <td className="font-mono text-text-muted text-xs">
                        {t.last_generated ? format(parseISO(t.last_generated), 'MMM d, yyyy') : 'Never'}
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
                        <button
                          className="p-1 rounded-sm text-text-muted hover:text-accent-blue transition-colors"
                          onClick={() => {
                            setEditingId(t.id);
                            setFormData({
                              name: t.name || '',
                              type: t.type as any || 'invoice',
                              frequency: t.frequency as any || 'monthly',
                              next_date: t.next_date || '',
                              end_date: t.end_date || '',
                              is_active: !!t.is_active,
                            });
                            setShowForm(true);
                          }}
                          title="Edit template"
                        >
                          <Pencil size={14} />
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
        </>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <>
          {historyLoading ? (
            <div className="flex items-center justify-center h-32 text-text-muted text-sm font-mono">
              Loading history...
            </div>
          ) : history.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <History size={24} className="text-text-muted" />
              </div>
              <p className="text-sm text-text-secondary font-medium">No auto-generated records yet</p>
              <p className="text-xs text-text-muted mt-1">
                Records created by recurring templates will appear here.
              </p>
            </div>
          ) : (
            <div className="block-card p-0 overflow-hidden">
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Template</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Client / Vendor</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr
                      key={h.id}
                      className="cursor-pointer hover:bg-bg-hover transition-colors"
                      onClick={() => {
                        if (h.record_type === 'invoice') nav.goToInvoice(h.id);
                        else nav.goToExpense(h.id);
                      }}
                    >
                      <td>
                        <div className="flex items-center gap-1.5">
                          {h.record_type === 'invoice' ? (
                            <FileText size={14} className="text-accent-income" />
                          ) : (
                            <Receipt size={14} className="text-accent-expense" />
                          )}
                          <span className={typeBadge[h.record_type] || 'block-badge'}>
                            {h.record_type}
                          </span>
                        </div>
                      </td>
                      <td className="text-text-primary font-medium font-mono text-xs">{h.reference || '-'}</td>
                      <td className="text-text-secondary text-xs">{h.template_name || '-'}</td>
                      <td className="font-mono text-text-primary text-xs">{fmtCurrency(h.amount)}</td>
                      <td className="font-mono text-text-muted text-xs">
                        {h.date ? format(parseISO(h.date), 'MMM d, yyyy') : '-'}
                      </td>
                      <td>
                        <span className={`block-badge ${
                          h.status === 'paid' || h.status === 'approved' ? 'block-badge-income' :
                          h.status === 'overdue' ? 'block-badge-expense' :
                          'block-badge-warning'
                        }`}>
                          <span className="capitalize">{h.status}</span>
                        </span>
                      </td>
                      <td className="text-text-secondary text-xs">{h.client_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {history.length > 0 && (
            <div className="text-xs text-text-muted">
              Showing {history.length} auto-generated record{history.length !== 1 ? 's' : ''}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RecurringTransactions;
