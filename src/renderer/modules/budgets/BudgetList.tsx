import React, { useEffect, useState } from 'react';
import { Wallet, Plus } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface Budget {
  id: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'annual';
  start_date: string;
  end_date: string;
  status: 'draft' | 'active' | 'closed';
}

interface BudgetListProps {
  onNew: () => void;
  onSelect: (id: string) => void;
}

const statusBadge: Record<string, string> = {
  draft: 'block-badge block-badge-warning',
  active: 'block-badge block-badge-income',
  closed: 'block-badge',
};

const periodLabel: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

// ─── Component ──────────────────────────────────────────
const BudgetList: React.FC<BudgetListProps> = ({ onNew, onSelect }) => {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.query('budgets', undefined, { field: 'start_date', dir: 'desc' });
        if (!cancelled) setBudgets(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load budgets:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

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
            style={{ borderRadius: '2px' }}
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

      {/* Table */}
      {budgets.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Wallet size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No budgets created</p>
          <p className="text-xs text-text-muted mt-1">
            Create your first budget to start tracking spending.
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Period</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => (
                <tr
                  key={b.id}
                  className="cursor-pointer"
                  onClick={() => onSelect(b.id)}
                >
                  <td className="text-text-primary font-medium text-sm">{b.name}</td>
                  <td className="text-text-secondary text-sm">
                    {periodLabel[b.period] || b.period}
                  </td>
                  <td className="font-mono text-text-secondary text-xs">{b.start_date}</td>
                  <td className="font-mono text-text-secondary text-xs">{b.end_date}</td>
                  <td className="text-center">
                    <span className={statusBadge[b.status] || 'block-badge'}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default BudgetList;
