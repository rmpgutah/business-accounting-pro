import React from 'react';
import { Search, Filter } from 'lucide-react';

// Filter bar for the Expense list (search, category, date range, amount range,
// reimbursable toggle). JSX moved verbatim out of ExpenseList.tsx (move-only
// refactor, 2026-06-11) — state refs replaced with props.

export interface ExpenseListFiltersProps {
  search: string; setSearch: (v: string) => void;
  categoryFilter: string; setCategoryFilter: (v: string) => void;
  dateFrom: string; setDateFrom: (v: string) => void;
  dateTo: string; setDateTo: (v: string) => void;
  reimbursableOnly: boolean; setReimbursableOnly: (updater: (v: boolean) => boolean) => void;
  amountMin: string; setAmountMin: (v: string) => void;
  amountMax: string; setAmountMax: (v: string) => void;
  categories: { id: string; name: string }[];
  searchRef: React.RefObject<HTMLInputElement | null>;
}

const ExpenseListFilters: React.FC<ExpenseListFiltersProps> = ({
  search, setSearch,
  categoryFilter, setCategoryFilter,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  reimbursableOnly, setReimbursableOnly,
  amountMin, setAmountMin,
  amountMax, setAmountMax,
  categories,
  searchRef,
}) => {
  return (
    <>
      <div className="relative flex-1 min-w-[200px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search expenses... (press / to focus)"
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
          {[...categories]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map((c) => (
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
      {/* Capture #16: amount range */}
      <input type="number" step="0.01" placeholder="Min $" className="block-input" style={{ width: 100 }}
        value={amountMin} onChange={e => setAmountMin(e.target.value)} />
      <input type="number" step="0.01" placeholder="Max $" className="block-input" style={{ width: 100 }}
        value={amountMax} onChange={e => setAmountMax(e.target.value)} />
      <button
        type="button"
        onClick={() => setReimbursableOnly((v) => !v)}
        className="px-3 py-2 text-xs font-bold uppercase border"
        style={{
          borderColor: reimbursableOnly ? 'var(--color-accent-blue)' : 'var(--color-border-primary)',
          color: reimbursableOnly ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
          borderRadius: 4,
        }}
        title="Show only reimbursable expenses"
      >
        Reimbursable
      </button>
    </>
  );
};

export default ExpenseListFilters;
