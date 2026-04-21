import React, { useEffect, useState, useMemo } from 'react';
import { Plus, Search, FileText, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface JournalEntry {
  id: string;
  entry_number: string;
  date: string;
  description: string;
  total_debit: number;
  total_credit: number;
  is_posted: number;
  created_at: string;
}

interface JournalEntriesProps {
  onNewEntry: () => void;
  onEditEntry: (entry: JournalEntry) => void;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Component ──────────────────────────────────────────
const JournalEntries: React.FC<JournalEntriesProps> = ({
  onNewEntry,
  onEditEntry,
}) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Fetch journal entries
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      try {
        const data = await api.query(
          'journal_entries',
          { company_id: activeCompany.id },
          { field: 'date', dir: 'desc' }
        );
        if (!cancelled && Array.isArray(data)) {
          setEntries(data);
        }
      } catch (err) {
        console.error('Failed to load journal entries:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany]);

  // Filter entries
  const filtered = useMemo(() => {
    let result = entries;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.entry_number.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q)
      );
    }

    if (dateFrom) {
      result = result.filter((e) => e.date >= dateFrom);
    }

    if (dateTo) {
      result = result.filter((e) => e.date <= dateTo);
    }

    return result;
  }, [entries, searchQuery, dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm font-mono">
          Loading journal entries...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries..."
              className="block-input w-full pl-8 pr-3 py-1.5 text-xs bg-bg-primary border border-border-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '6px' }}
            />
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="block-input px-2 py-1.5 text-xs bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '6px' }}
            />
            <span className="text-text-muted text-xs">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="block-input px-2 py-1.5 text-xs bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '6px' }}
            />
          </div>
        </div>

        <button
          onClick={onNewEntry}
          className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
          style={{ borderRadius: '6px' }}
        >
          <Plus size={14} />
          New Entry
        </button>
      </div>

      {/* Table */}
      <div
        className="block-table bg-bg-secondary border border-border-primary overflow-hidden"
        style={{ borderRadius: '6px' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-tertiary border-b border-border-primary">
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Date
              </th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Entry #
              </th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Description
              </th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Total Debit
              </th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Total Credit
              </th>
              <th className="text-center px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider" style={{ width: '50px' }}>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-border-primary hover:bg-bg-hover transition-colors cursor-pointer"
                onClick={() => onEditEntry(entry)}
              >
                <td className="px-4 py-2 text-xs text-text-secondary font-mono">
                  {entry.date}
                </td>
                <td className="px-4 py-2 text-xs text-text-primary font-mono font-medium">
                  {entry.entry_number}
                </td>
                <td className="px-4 py-2 text-xs text-text-primary">
                  {entry.description || '—'}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-text-primary">
                  {fmt.format(entry.total_debit ?? 0)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-text-primary">
                  {fmt.format(entry.total_credit ?? 0)}
                </td>
                <td className="px-4 py-2 text-center">
                  <span
                    className={`inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      entry.is_posted === 1
                        ? 'bg-accent-income/15 text-accent-income'
                        : 'bg-bg-tertiary text-text-muted'
                    }`}
                    style={{ borderRadius: '6px' }}
                  >
                    {entry.is_posted === 1 ? 'Posted' : 'Unposted'}
                  </span>
                </td>
                <td className="px-4 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="block-btn p-1 text-accent-expense hover:bg-accent-expense/10"
                    title="Delete entry"
                    aria-label="Delete entry"
                    onClick={async () => {
                      if (!window.confirm('Delete this journal entry? This cannot be undone.')) return;
                      try {
                        await api.remove('journal_entries', entry.id);
                        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
                      } catch (err) {
                        console.error('Failed to delete journal entry:', err);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-text-muted"
                >
                  <FileText
                    size={24}
                    className="mx-auto mb-2 text-text-muted/50"
                  />
                  {entries.length === 0
                    ? 'No journal entries yet. Create your first entry.'
                    : 'No entries match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default JournalEntries;
