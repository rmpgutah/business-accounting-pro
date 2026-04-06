import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { UserCircle, Plus, Search, Filter, ArrowUpDown, Download, Trash2, CheckCircle, XCircle, Users } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { downloadCSVBlob } from '../../lib/csv-export';
import { useCompanyStore } from '../../stores/companyStore';
import { SummaryBar } from '../../components/SummaryBar';
import { formatCurrency, formatStatus } from '../../lib/format';
import { ImportWizard } from '../../components/ImportWizard';

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
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [clientSummary, setClientSummary] = useState<any>(null);
  const [showImport, setShowImport] = useState(false);

  // ─── Load Data ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoading(true);
        const [rows, clientSummaryResult] = await Promise.all([
          api.query('clients', { company_id: activeCompany.id }),
          api.rawQuery(
            `SELECT
              COALESCE(SUM(total - amount_paid), 0) as total_receivables,
              COUNT(DISTINCT client_id) as overdue_clients
            FROM invoices WHERE company_id = ? AND status = 'overdue'`,
            [activeCompany.id]
          ),
        ]);
        if (!cancelled) {
          setClients(Array.isArray(rows) ? rows : []);
          const clientRow = Array.isArray(clientSummaryResult) ? clientSummaryResult[0] : clientSummaryResult;
          setClientSummary(clientRow ?? null);
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
  }, [activeCompany]);

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

  // ─── Selection Helpers ──────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every(c => selectedIds.has(c.id));
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
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
  }, [allSelected, filtered]);

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); }, [searchQuery, statusFilter]);

  // ─── Batch Actions ──────────────────────────────────
  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const rows = await api.query('clients', { company_id: activeCompany.id });
    setClients(Array.isArray(rows) ? rows : []);
    setSelectedIds(new Set());
  }, [activeCompany]);

  const handleBatchSetActive = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('clients', Array.from(selectedIds), { status: 'active' });
      await reload();
    } catch (err: any) { console.error('Batch set active failed:', err); alert('Failed to set clients as active: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); }
  }, [selectedIds, reload]);

  const handleBatchSetInactive = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('clients', Array.from(selectedIds), { status: 'inactive' });
      await reload();
    } catch (err: any) { console.error('Batch set inactive failed:', err); alert('Failed to set clients as inactive: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); }
  }, [selectedIds, reload]);

  const handleBatchDelete = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchDelete('clients', Array.from(selectedIds));
      await reload();
    } catch (err: any) { console.error('Batch delete failed:', err); alert('Failed to delete clients: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); setShowDeleteConfirm(false); }
  }, [selectedIds, reload]);

  const handleExportSelected = useCallback(() => {
    const selected = filtered.filter(c => selectedIds.has(c.id));
    const exportData = selected.map(c => ({
      name: c.name,
      email: c.email,
      phone: c.phone,
      status: c.status,
      type: c.type,
      payment_terms: c.payment_terms ? `Net ${c.payment_terms}` : '',
      tags: c.tags || '',
    }));
    downloadCSVBlob(exportData, 'clients-export.csv');
  }, [filtered, selectedIds]);

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full" style={{ paddingBottom: someSelected ? '80px' : undefined }}>
      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Clients</h1>
        <div className="module-actions">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            Import CSV
          </button>
          <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewClient}>
            <Plus size={14} />
            New Client
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      {clientSummary && (
        <SummaryBar items={[
          { label: 'Total Receivables', value: formatCurrency(clientSummary.total_receivables), accent: 'orange', tooltip: 'Sum of all outstanding invoice balances across overdue clients' },
          { label: 'Clients Overdue', value: String(clientSummary.overdue_clients ?? 0), accent: Number(clientSummary.overdue_clients) > 0 ? 'red' as const : 'default' as const, tooltip: 'Number of clients with at least one overdue invoice' },
        ]} />
      )}

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
        <div className="flex flex-col items-center gap-3">
          <EmptyState icon={Users} message="No clients found" />
          {clients.length === 0 && (
            <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewClient}>
              <Plus size={14} />
              Add Client
            </button>
          )}
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
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
                <SortableHeader field="name" label="Name" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="email" label="Email" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="phone" label="Phone" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="status" label="Status" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="payment_terms" label="Payment Terms" activeSortField={sortField} onSort={handleSort} />
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => {
                const isSelected = selectedIds.has(client.id);
                return (
                  <tr
                    key={client.id}
                    className={`cursor-pointer ${isSelected ? 'bg-accent-blue/5' : ''}`}
                    onClick={() => onSelectClient(client.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(client.id)}
                        className="cursor-pointer"
                        style={{ accentColor: '#3b82f6' }}
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <UserCircle size={16} className="text-text-muted shrink-0" />
                        <span className="text-text-primary font-medium">{client.name}</span>
                      </div>
                    </td>
                    <td className="text-text-secondary">{client.email || '--'}</td>
                    <td className="text-text-secondary font-mono text-xs">{client.phone || '--'}</td>
                    <td>
                      <span className={formatStatus(client.status).className}>
                        {formatStatus(client.status).label}
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
                );
              })}
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

      {showImport && (
        <ImportWizard
          table="clients"
          requiredFields={['name', 'email', 'phone', 'type']}
          extraData={{ company_id: activeCompany?.id, status: 'active' }}
          onDone={() => { setShowImport(false); reload(); }}
          onCancel={() => setShowImport(false)}
        />
      )}

      {/* ─── Floating Batch Action Bar ─────────────────────── */}
      {someSelected && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 border border-border-primary shadow-lg"
          style={{
            background: 'rgba(18,20,28,0.80)',
            borderRadius: '6px',
            minWidth: '460px',
          }}
        >
          <span className="text-xs font-semibold text-text-muted mr-2">
            {selectedIds.size} of {filtered.length} selected
          </span>

          <button
            className="block-btn-primary flex items-center gap-1.5 text-xs"
            onClick={handleBatchSetActive}
            disabled={batchLoading}
          >
            <CheckCircle size={13} />
            Set Active
          </button>

          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={handleBatchSetInactive}
            disabled={batchLoading}
            style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            <XCircle size={13} />
            Set Inactive
          </button>

          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={handleExportSelected}
            style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            <Download size={13} />
            Export CSV
          </button>

          {!showDeleteConfirm ? (
            <button
              className="flex items-center gap-1.5 text-xs font-semibold"
              onClick={() => setShowDeleteConfirm(true)}
              style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
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
                style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}
              >
                Yes, Delete
              </button>
              <button
                className="text-xs font-semibold text-text-muted"
                onClick={() => setShowDeleteConfirm(false)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}
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

export default ClientList;
