import React, { useEffect, useState, useMemo } from 'react';
import { UserCircle, Plus, Search, Filter, ArrowUpDown } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'active' | 'inactive' | 'prospect';
  payment_terms: number;
  tags: string;
  type: string;
}

type SortField = 'name' | 'email' | 'phone' | 'status' | 'payment_terms';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'active' | 'inactive' | 'prospect';

interface ClientListProps {
  onSelectClient: (id: string) => void;
  onNewClient: () => void;
}

// ─── Status Badge ───────────────────────────────────────
const statusBadgeClass: Record<string, string> = {
  active: 'block-badge block-badge-income',
  inactive: 'block-badge block-badge-expense',
  prospect: 'block-badge block-badge-blue',
};

// ─── Column Header (module-level to avoid re-creation) ──
const SortableHeader: React.FC<{
  field: SortField;
  label: string;
  activeSortField: SortField;
  onSort: (field: SortField) => void;
}> = ({ field, label, activeSortField, onSort }) => (
  <th
    className="cursor-pointer select-none hover:text-text-primary transition-colors"
    onClick={() => onSort(field)}
  >
    <span className="inline-flex items-center gap-1">
      {label}
      <ArrowUpDown
        size={12}
        className={activeSortField === field ? 'text-accent-blue' : 'text-text-muted'}
      />
    </span>
  </th>
);

// ─── Component ──────────────────────────────────────────
const ClientList: React.FC<ClientListProps> = ({ onSelectClient, onNewClient }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ─── Load Data ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const rows = await api.query('clients');
        if (!cancelled) {
          setClients(Array.isArray(rows) ? rows : []);
        }
      } catch (err) {
        console.error('Failed to load clients:', err);
        if (!cancelled) setClients([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // ─── Sort Handler ───────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // ─── Filtered & Sorted List ─────────────────────────
  const filtered = useMemo(() => {
    let list = [...clients];

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((c) => c.status === statusFilter);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q) ||
          c.tags?.toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      const aVal = (a[sortField] ?? '') as string | number;
      const bVal = (b[sortField] ?? '') as string | number;
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [clients, statusFilter, searchQuery, sortField, sortDir]);

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Clients</h1>
        <div className="module-actions">
          <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewClient}>
            <Plus size={14} />
            New Client
          </button>
        </div>
      </div>

      {/* Toolbar: Search + Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="block-input pl-8"
            placeholder="Search clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="relative inline-flex items-center gap-1.5">
          <Filter size={14} className="text-text-muted" />
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '120px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="prospect">Prospect</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm text-text-muted font-mono">Loading clients...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <UserCircle size={28} className="text-text-muted" />
          </div>
          <p className="text-sm font-semibold text-text-secondary mb-1">No clients found</p>
          <p className="text-xs text-text-muted mb-4">
            {clients.length === 0
              ? 'Get started by adding your first client.'
              : 'Try adjusting your search or filters.'}
          </p>
          {clients.length === 0 && (
            <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewClient}>
              <Plus size={14} />
              Add Client
            </button>
          )}
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '2px' }}>
          <table className="block-table">
            <thead>
              <tr>
                <SortableHeader field="name" label="Name" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="email" label="Email" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="phone" label="Phone" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="status" label="Status" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="payment_terms" label="Payment Terms" activeSortField={sortField} onSort={handleSort} />
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr
                  key={client.id}
                  className="cursor-pointer"
                  onClick={() => onSelectClient(client.id)}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <UserCircle size={16} className="text-text-muted shrink-0" />
                      <span className="text-text-primary font-medium">{client.name}</span>
                    </div>
                  </td>
                  <td className="text-text-secondary">{client.email || '--'}</td>
                  <td className="text-text-secondary font-mono text-xs">{client.phone || '--'}</td>
                  <td>
                    <span className={statusBadgeClass[client.status] ?? 'block-badge'}>
                      {client.status}
                    </span>
                  </td>
                  <td className="text-text-secondary font-mono">
                    {client.payment_terms ? `Net ${client.payment_terms}` : '--'}
                  </td>
                  <td>
                    {client.tags ? (
                      <div className="flex flex-wrap gap-1">
                        {client.tags.split(',').map((tag, i) => (
                          <span
                            key={i}
                            className="block-badge block-badge-purple text-[10px]"
                          >
                            {tag.trim()}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-muted">--</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {clients.length} client{clients.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default ClientList;
