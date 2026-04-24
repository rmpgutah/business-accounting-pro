import React, { useEffect, useState, useMemo } from 'react';
import { Wallet, Plus, Trash2, Search } from 'lucide-react';
import api from '../../lib/api';
import { formatDate, formatStatus } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface Budget {
  id: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'annual';
  start_date: string;
  end_date: string;
  status: 'active' | 'closed';
}

interface BudgetListProps {
  onNew: () => void;
  onSelect: (id: string) => void;
}

const periodLabel: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

// ─── Component ──────────────────────────────────────────
const BudgetList: React.FC<BudgetListProps> = ({ onNew, onSelect }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  type SortField = 'name' | 'period' | 'start_date' | 'end_date' | 'status';
  type SortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('start_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const loadBudgets = async () => {
    if (!activeCompany) return;
    try {
      const data = await api.query('budgets', { company_id: activeCompany.id }, { field: 'start_date', dir: 'desc' });
      setBudgets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load budgets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBudgets();
  }, [activeCompany]);

  const handleSort = (f: SortField) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc'); } };

  const filtered = useMemo(() => {
    let list = [...budgets];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(b => b.name?.toLowerCase().includes(q) || b.period?.toLowerCase().includes(q) || b.status?.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const aVal = a[sortField] ?? '';
      const bVal = b[sortField] ?? '';
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [budgets, search, sortField, sortDir]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this budget and all its line items?')) return;
    try {
      // Delete budget lines first, then the budget
      const lines = await api.query('budget_lines', { budget_id: id });
      if (Array.isArray(lines)) {
        for (const line of lines) {
          await api.remove('budget_lines', line.id);
        }
      }
      await api.remove('budgets', id);
      await loadBudgets();
      setOpSuccess('Budget deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete budget:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(item => item.id)));
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} budget${selectedIds.size !== 1 ? 's' : ''} and all their line items?`)) return;
    setBatchDeleting(true);
    try {
      for (const id of selectedIds) {
        const lines = await api.query('budget_lines', { budget_id: id });
        if (Array.isArray(lines)) {
          for (const line of lines) {
            await api.remove('budget_lines', line.id);
          }
        }
        await api.remove('budgets', id);
      }
      setSelectedIds(new Set());
      await loadBudgets();
      setOpSuccess(`Deleted ${selectedIds.size} budget${selectedIds.size !== 1 ? 's' : ''}`);
      setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to batch delete budgets:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error'));
      setTimeout(() => setOpError(''), 5000);
    } finally {
      setBatchDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading budgets...
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
            style={{ borderRadius: '6px' }}
          >
            <Wallet size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Budgets</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {budgets.length} budget{budgets.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
          <Plus size={16} />
          New Budget
        </button>
      </div>

      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20" style={{ borderRadius: '6px' }}>{opError}</div>}

      {budgets.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input className="block-input pl-8" placeholder="Search budgets..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="block-card p-3 flex items-center justify-between" style={{ borderRadius: '6px', borderColor: 'rgba(59,130,246,0.3)' }}>
          <span className="text-xs font-semibold text-text-primary">
            {selectedIds.size} budget{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            className="block-btn-danger flex items-center gap-1.5 text-xs"
            onClick={handleBatchDelete}
            disabled={batchDeleting}
          >
            <Trash2 size={12} />
            {batchDeleting ? 'Deleting...' : 'Delete Selected'}
          </button>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Wallet size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No budgets created</p>
          <p className="text-xs text-text-muted mt-1">
            Create your first budget to start tracking spending.
          </p>
          <button className="block-btn-primary mt-3 flex items-center gap-2" onClick={onNew}>
            <Plus size={14} /> Create Budget
          </button>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                    style={{ accentColor: '#3b82f6' }}
                  />
                </th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('name')}><span className="inline-flex items-center gap-1">Name {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('period')}><span className="inline-flex items-center gap-1">Period {sortField === 'period' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('start_date')}><span className="inline-flex items-center gap-1">Start Date {sortField === 'start_date' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('end_date')}><span className="inline-flex items-center gap-1">End Date {sortField === 'end_date' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-center cursor-pointer select-none" onClick={() => handleSort('status')}><span className="inline-flex items-center gap-1">Status {sortField === 'status' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.id}
                  className="cursor-pointer"
                  onClick={() => onSelect(b.id)}
                >
                  <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(b.id)}
                      onChange={() => toggleSelect(b.id)}
                      className="cursor-pointer"
                      style={{ accentColor: '#3b82f6' }}
                    />
                  </td>
                  <td className="text-text-primary font-medium text-sm truncate max-w-[200px]">{b.name}</td>
                  <td className="text-text-secondary text-sm">
                    {periodLabel[b.period] || b.period}
                  </td>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(b.start_date)}</td>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(b.end_date)}</td>
                  <td className="text-center">
                    <span className={formatStatus(b.status).className}>
                      {formatStatus(b.status).label}
                    </span>
                  </td>
                  <td className="text-center">
                    <button
                      className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1 text-accent-expense hover:bg-accent-expense/10 transition-colors"
                      onClick={(e) => handleDelete(e, b.id)}
                      title="Delete budget"
                      aria-label="Delete budget"
                    >
                      <Trash2 size={10} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {budgets.length} budget{budgets.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default BudgetList;
