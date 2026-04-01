import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Receipt, Plus, Search, Filter, DollarSign, CheckCircle, Trash2, Download } from 'lucide-react';
import api from '../../lib/api';
import { downloadCSVBlob } from '../../lib/csv-export';
import { useCompanyStore } from '../../stores/companyStore';
import { SummaryBar } from '../../components/SummaryBar';

// ─── Types ──────────────────────────────────────────────
interface Expense {
  id: string;
  date: string;
  description: string;
  category_name?: string;
  category_id?: string;
  vendor_name?: string;
  vendor_id?: string;
  amount: number;
  tax_amount?: number;
  status: 'pending' | 'approved' | 'paid';
  is_billable: boolean;
  payment_method?: string;
  reference?: string;
}

interface Category {
  id: string;
  name: string;
}

interface ExpenseListProps {
  onNew: () => void;
  onEdit: (id: string) => void;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const statusBadge: Record<string, string> = {
  pending: 'block-badge block-badge-warning',
  approved: 'block-badge block-badge-blue',
  paid: 'block-badge block-badge-income',
};

// ─── Component ──────────────────────────────────────────
const ExpenseList: React.FC<ExpenseListProps> = ({ onNew, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expenseSummary, setExpenseSummary] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const [expData, catData, expSummaryResult] = await Promise.all([
          api.query('expenses', { company_id: activeCompany.id }),
          api.query('categories', { company_id: activeCompany.id }),
          api.rawQuery(
            `SELECT
              COALESCE(SUM(CASE WHEN strftime('%Y-%m', date) = strftime('%Y-%m', 'now') THEN amount ELSE 0 END), 0) as month_total,
              (SELECT ec.name FROM expense_categories ec JOIN expenses e2 ON e2.category_id = ec.id WHERE e2.company_id = ? GROUP BY e2.category_id ORDER BY SUM(e2.amount) DESC LIMIT 1) as top_category,
              (SELECT COUNT(DISTINCT e2.category_id) FROM expenses e2 JOIN budget_lines bl ON bl.category_id = e2.category_id WHERE e2.company_id = ? AND strftime('%Y-%m', e2.date) = strftime('%Y-%m', 'now') GROUP BY e2.category_id HAVING SUM(e2.amount) > bl.amount) as over_budget_count
            FROM expenses WHERE company_id = ?`,
            [activeCompany.id, activeCompany.id, activeCompany.id]
          ),
        ]);
        if (cancelled) return;
        setExpenses(Array.isArray(expData) ? expData : []);
        setCategories(Array.isArray(catData) ? catData : []);
        const expRow = Array.isArray(expSummaryResult) ? expSummaryResult[0] : expSummaryResult;
        setExpenseSummary(expRow ?? null);
      } catch (err) {
        console.error('Failed to load expenses:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          e.description?.toLowerCase().includes(q) ||
          e.vendor_name?.toLowerCase().includes(q) ||
          e.reference?.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (categoryFilter && e.category_id !== categoryFilter) return false;
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      return true;
    });
  }, [expenses, search, categoryFilter, dateFrom, dateTo]);

  const total = useMemo(
    () => filtered.reduce((sum, e) => sum + (e.amount || 0), 0),
    [filtered]
  );

  // ─── Selection Helpers ──────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(e => e.id)));
    }
  }, [allSelected, filtered]);

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); }, [search, categoryFilter, dateFrom, dateTo]);

  // ─── Batch Actions ──────────────────────────────────────
  const reload = useCallback(async () => {
    const expData = await api.query('expenses');
    setExpenses(Array.isArray(expData) ? expData : []);
    setSelectedIds(new Set());
  }, []);

  const handleBatchApprove = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('expenses', Array.from(selectedIds), { status: 'approved' });
      await reload();
    } catch (err) { console.error('Batch approve failed:', err); }
    finally { setBatchLoading(false); }
  }, [selectedIds, reload]);

  const handleBatchDelete = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchDelete('expenses', Array.from(selectedIds));
      await reload();
    } catch (err) { console.error('Batch delete failed:', err); }
    finally { setBatchLoading(false); setShowDeleteConfirm(false); }
  }, [selectedIds, reload]);

  const handleExportSelected = useCallback(() => {
    const selected = filtered.filter(e => selectedIds.has(e.id));
    const exportData = selected.map(e => ({
      date: e.date,
      description: e.description,
      category: e.category_name || '',
      vendor: e.vendor_name || '',
      amount: e.amount,
      tax_amount: e.tax_amount || 0,
      status: e.status,
      billable: e.is_billable ? 'Yes' : 'No',
      payment_method: e.payment_method || '',
      reference: e.reference || '',
    }));
    downloadCSVBlob(exportData, 'expenses-export.csv');
  }, [filtered, selectedIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading expenses...
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ paddingBottom: someSelected ? '80px' : undefined }}>
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '2px' }}
          >
            <Receipt size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Expenses</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} expense{filtered.length !== 1 ? 's' : ''} &middot; {fmt.format(total)} total
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
          <Plus size={16} />
          New Expense
        </button>
      </div>

      {/* Summary Bar */}
      {expenseSummary && (
        <SummaryBar items={[
          { label: 'This Month', value: `$${Number(expenseSummary.month_total).toFixed(2)}` },
          { label: 'Top Category', value: expenseSummary.top_category ?? '—' },
          ...(Number(expenseSummary.over_budget_count) > 0 ? [{ label: 'Over Budget', value: `${expenseSummary.over_budget_count} categories`, accent: 'red' as const }] : []),
        ]} />
      )}

      {/* Filters */}
      <div className="block-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search expenses..."
              className="block-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-text-muted" />
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '140px' }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
          />
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <DollarSign size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No expenses found</p>
          <p className="text-xs text-text-muted mt-1">
            Create your first expense or adjust the filters above.
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                    style={{ accentColor: '#3b82f6' }}
                  />
                </th>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Vendor</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th className="text-center">Billable</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((exp) => {
                const isSelected = selectedIds.has(exp.id);
                return (
                  <tr
                    key={exp.id}
                    className={`cursor-pointer ${isSelected ? 'bg-accent-blue/5' : ''}`}
                    onClick={() => onEdit(exp.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(exp.id)}
                        className="cursor-pointer"
                        style={{ accentColor: '#3b82f6' }}
                      />
                    </td>
                    <td className="font-mono text-text-secondary text-xs">
                      {exp.date}
                    </td>
                    <td className="text-text-primary font-medium">
                      {exp.description || '(no description)'}
                    </td>
                    <td className="text-text-secondary">
                      {exp.category_name || '-'}
                    </td>
                    <td className="text-text-secondary">
                      {exp.vendor_name || '-'}
                    </td>
                    <td className="text-right font-mono text-accent-expense">
                      {fmt.format(exp.amount)}
                    </td>
                    <td>
                      <span className={statusBadge[exp.status] || 'block-badge'}>
                        {exp.status}
                      </span>
                    </td>
                    <td className="text-center">
                      {exp.is_billable ? (
                        <span className="text-accent-income">&#10003;</span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td
                  colSpan={4}
                  className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider"
                >
                  Total
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {fmt.format(total)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ─── Floating Batch Action Bar ─────────────────────── */}
      {someSelected && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 border border-border-primary shadow-lg"
          style={{
            background: 'var(--bg-secondary, #1e1e2e)',
            borderRadius: '2px',
            minWidth: '420px',
          }}
        >
          <span className="text-xs font-semibold text-text-muted mr-2">
            {selectedIds.size} of {filtered.length} selected
          </span>

          <button
            className="block-btn-primary flex items-center gap-1.5 text-xs"
            onClick={handleBatchApprove}
            disabled={batchLoading}
          >
            <CheckCircle size={13} />
            Approve Selected
          </button>

          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={handleExportSelected}
            style={{ background: 'var(--bg-tertiary, #2a2a3e)', border: '1px solid var(--border-primary, #333)', borderRadius: '2px', padding: '6px 12px', cursor: 'pointer' }}
          >
            <Download size={13} />
            Export CSV
          </button>

          {!showDeleteConfirm ? (
            <button
              className="flex items-center gap-1.5 text-xs font-semibold"
              onClick={() => setShowDeleteConfirm(true)}
              style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '2px', padding: '6px 12px', cursor: 'pointer' }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-accent-expense font-semibold">Confirm?</span>
              <button
                className="text-xs font-semibold"
                onClick={handleBatchDelete}
                disabled={batchLoading}
                style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '2px', padding: '5px 10px', cursor: 'pointer' }}
              >
                Yes, Delete
              </button>
              <button
                className="text-xs font-semibold text-text-muted"
                onClick={() => setShowDeleteConfirm(false)}
                style={{ background: 'transparent', border: '1px solid var(--border-primary, #333)', borderRadius: '2px', padding: '5px 10px', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExpenseList;
