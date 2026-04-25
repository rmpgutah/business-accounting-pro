import React, { useEffect, useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import { calcRiskScore, getRiskBadge } from './riskScore';

interface DebtMiniListProps {
  activeDebtId: string | null;
  onSelect: (id: string) => void;
}

interface MiniDebt {
  id: string;
  debtor_name: string;
  balance_due: number;
  status: string;
  current_stage: string;
  type: string;
  priority: string;
  delinquent_date: string;
  has_broken_promise?: number;
}

const DebtMiniList: React.FC<DebtMiniListProps> = ({ activeDebtId, onSelect }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [debts, setDebts] = useState<MiniDebt[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await api.rawQuery(
          `SELECT d.id, d.debtor_name, d.balance_due, d.status, d.current_stage, d.type, d.priority, d.delinquent_date,
            (SELECT COUNT(*) FROM debt_promises dp WHERE dp.debt_id = d.id AND dp.kept = 0 AND dp.promised_date < date('now')) as has_broken_promise
          FROM debts d WHERE d.company_id = ? ORDER BY d.balance_due DESC`,
          [activeCompany.id]
        );
        if (!cancelled) setDebts(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error('Failed to load mini debt list:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const filtered = useMemo(() => {
    let list = debts;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(d => d.debtor_name.toLowerCase().includes(q));
    }
    if (statusFilter) {
      list = list.filter(d => d.status === statusFilter);
    }
    return list;
  }, [debts, search, statusFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-text-muted text-xs">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + Filter */}
      <div className="p-2 space-y-1.5 flex-shrink-0 border-b border-border-primary">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-2 text-text-muted" />
          <input
            className="block-input pl-7 text-xs py-1.5"
            placeholder="Search debts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="block-select text-xs w-full py-1"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <optgroup label="Active">
            <option value="disputed">Disputed</option>
            <option value="in_collection">In Collection</option>
            <option value="legal">Legal</option>
          </optgroup>
          <optgroup label="Closed">
            <option value="settled">Settled</option>
            <option value="written_off">Written Off</option>
          </optgroup>
        </select>
      </div>

      {/* Count */}
      <div className="px-2 py-1 text-[10px] text-text-muted flex-shrink-0">
        {filtered.length} debt{filtered.length !== 1 ? 's' : ''}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-xs">
            {debts.length === 0 ? 'No debts yet.' : 'No matches.'}
          </div>
        ) : (
          filtered.map((d) => {
            const isActive = activeDebtId === d.id;
            const risk = getRiskBadge(calcRiskScore(d, d.has_broken_promise || 0));
            return (
              <div
                key={d.id}
                className={`px-2.5 py-2 cursor-pointer transition-colors border-b border-border-primary/50 ${
                  isActive
                    ? 'bg-accent-blue/10 border-l-2 border-l-accent-blue'
                    : 'hover:bg-bg-hover border-l-2 border-l-transparent transition-colors'
                }`}
                onClick={() => onSelect(d.id)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold text-text-primary truncate flex-1">
                    {d.debtor_name}
                  </span>
                  <span
                    className="flex-shrink-0"
                    style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: risk.color,
                    }}
                    title={`Risk: ${risk.label}`}
                  />
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-text-muted capitalize">{d.type}</span>
                  <span className="text-xs font-mono text-text-secondary">
                    {formatCurrency(d.balance_due)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default DebtMiniList;
