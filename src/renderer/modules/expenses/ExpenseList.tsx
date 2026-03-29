import React, { useEffect, useState, useMemo } from 'react';
import { Receipt, Plus, Search, Filter, DollarSign } from 'lucide-react';
import api from '../../lib/api';

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
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [expData, catData] = await Promise.all([
          api.query('expenses'),
          api.query('categories'),
        ]);
        if (cancelled) return;
        setExpenses(Array.isArray(expData) ? expData : []);
        setCategories(Array.isArray(catData) ? catData : []);
      } catch (err) {
        console.error('Failed to load expenses:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading expenses...
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
              {filtered.map((exp) => (
                <tr
                  key={exp.id}
                  className="cursor-pointer"
                  onClick={() => onEdit(exp.id)}
                >
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
              ))}
            </tbody>
            <tfoot>
              <tr>
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
    </div>
  );
};

export default ExpenseList;
