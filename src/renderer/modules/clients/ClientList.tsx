import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { UserCircle, Plus, Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, Download, Trash2, CheckCircle, XCircle, Users, Printer, Tag, Shield } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import api from '../../lib/api';
import { downloadCSVBlob } from '../../lib/csv-export';
import { useCompanyStore } from '../../stores/companyStore';
import { SummaryBar } from '../../components/SummaryBar';
import { formatCurrency, formatStatus, formatDate } from '../../lib/format';
import { ImportWizard } from '../../components/ImportWizard';
import {
  CLIENT_TIER, CLIENT_LIFECYCLE, CLIENT_RISK, CLIENT_INDUSTRY, CLIENT_SEGMENT,
  ClassificationBadge,
} from '../../lib/classifications';

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
  tier?: string;
  industry?: string;
  segment?: string;
  lifecycle_stage?: string;
  risk_rating?: string;
}

interface RevenueData {
  client_id: string;
  revenue: number;
  last_invoice: string | null;
  last_activity: string | null;
}

type SortField = 'name' | 'email' | 'phone' | 'status' | 'payment_terms' | 'revenue' | 'lastActivity';
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
  activeSortDir: SortDir;
  onSort: (field: SortField) => void;
}> = ({ field, label, activeSortField, activeSortDir, onSort }) => {
  const isActive = activeSortField === field;
  const Icon = !isActive ? ArrowUpDown : activeSortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className="cursor-pointer select-none hover:text-text-primary transition-colors"
      onClick={() => onSort(field)}
      aria-sort={isActive ? (activeSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon size={12} className={isActive ? 'text-accent-blue' : 'text-text-muted'} />
      </span>
    </th>
  );
};

// ─── Health Indicator ───────────────────────────────────
const HealthDot: React.FC<{ lastInvoice: string | null; outstanding: number }> = ({ lastInvoice, outstanding }) => {
  let color = 'var(--color-text-muted)'; // gray = no data
  let title = 'No activity';

  if (lastInvoice) {
    const daysSince = Math.floor((Date.now() - new Date(lastInvoice).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince <= 30) {
      color = 'var(--color-accent-income)';
      title = `Active (${daysSince}d ago)`;
    } else if (daysSince <= 90) {
      color = '#f59e0b';
      title = `Aging (${daysSince}d ago)`;
    } else {
      color = 'var(--color-accent-expense)';
      title = `Dormant (${daysSince}d ago)`;
    }
  }

  return (
    <div
      className="w-2.5 h-2.5 shrink-0"
      style={{ background: color, borderRadius: '50%' }}
      title={title}
    />
  );
};

// ─── Component ──────────────────────────────────────────
const ClientList: React.FC<ClientListProps> = ({ onSelectClient, onNewClient }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [clientSummary, setClientSummary] = useState<any>(null);
  const [showImport, setShowImport] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [revenueMap, setRevenueMap] = useState<Map<string, RevenueData>>(new Map());
  const [bulkTierOpen, setBulkTierOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTagValue, setBulkTagValue] = useState('');
  const [summaryStats, setSummaryStats] = useState<any>(null);

  // ─── Load Data ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoading(true);
        setLoadError('');
        const [rows, clientSummaryResult, revenueRows, statsRow] = await Promise.all([
          api.query('clients', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' }),
          api.rawQuery(
            `SELECT
              COALESCE(SUM(total - amount_paid), 0) as total_receivables,
              COUNT(DISTINCT client_id) as overdue_clients
            FROM invoices WHERE company_id = ? AND status = 'overdue'`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT client_id,
              COALESCE(SUM(total), 0) as revenue,
              MAX(issue_date) as last_invoice,
              MAX(COALESCE(updated_at, issue_date)) as last_activity
            FROM invoices WHERE company_id = ?
            GROUP BY client_id`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT
              COUNT(*) as total,
              SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
              SUM(CASE WHEN status='prospect' THEN 1 ELSE 0 END) as prospects,
              COALESCE((SELECT SUM(total) FROM invoices WHERE company_id = ?), 0) as total_revenue,
              COALESCE((SELECT SUM(total - amount_paid) FROM invoices WHERE company_id = ?), 0) as outstanding
            FROM clients WHERE company_id = ?`,
            [activeCompany.id, activeCompany.id, activeCompany.id]
          ),
        ]);
        if (!cancelled) {
          setClients(Array.isArray(rows) ? rows : []);
          const clientRow = Array.isArray(clientSummaryResult) ? clientSummaryResult[0] : clientSummaryResult;
          setClientSummary(clientRow ?? null);

          // Build revenue map
          const revArr = Array.isArray(revenueRows) ? revenueRows : [];
          const map = new Map<string, RevenueData>();
          revArr.forEach((r: any) => map.set(r.client_id, r));
          setRevenueMap(map);

          const sRow = Array.isArray(statsRow) ? statsRow[0] : statsRow;
          setSummaryStats(sRow ?? null);
        }
      } catch (err: any) {
        console.error('Failed to load clients:', err);
        if (!cancelled) {
          setClients([]);
          setLoadError(err?.message || 'Failed to load clients');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ─── Unique industries for filter ───────────────────
  const uniqueIndustries = useMemo(() => {
    const set = new Set<string>();
    clients.forEach(c => { if (c.industry) set.add(c.industry); });
    return Array.from(set).sort();
  }, [clients]);

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

    // Tier filter
    if (tierFilter !== 'all') {
      list = list.filter((c) => (c.tier || '') === tierFilter);
    }

    // Industry filter
    if (industryFilter !== 'all') {
      list = list.filter((c) => (c.industry || '') === industryFilter);
    }

    // Risk filter
    if (riskFilter !== 'all') {
      list = list.filter((c) => (c.risk_rating || '') === riskFilter);
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
      let aVal: string | number;
      let bVal: string | number;
      if (sortField === 'revenue') {
        aVal = revenueMap.get(a.id)?.revenue ?? 0;
        bVal = revenueMap.get(b.id)?.revenue ?? 0;
      } else if (sortField === 'lastActivity') {
        aVal = revenueMap.get(a.id)?.last_activity ?? '';
        bVal = revenueMap.get(b.id)?.last_activity ?? '';
      } else {
        aVal = (a[sortField] ?? '') as string | number;
        bVal = (b[sortField] ?? '') as string | number;
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [clients, statusFilter, tierFilter, industryFilter, riskFilter, searchQuery, sortField, sortDir, revenueMap]);

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
  useEffect(() => { setSelectedIds(new Set()); }, [searchQuery, statusFilter, tierFilter, industryFilter, riskFilter]);

  // ─── Batch Actions ──────────────────────────────────
  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const [rows, revenueRows] = await Promise.all([
      api.query('clients', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' }),
      api.rawQuery(
        `SELECT client_id,
          COALESCE(SUM(total), 0) as revenue,
          MAX(issue_date) as last_invoice,
          MAX(COALESCE(updated_at, issue_date)) as last_activity
        FROM invoices WHERE company_id = ?
        GROUP BY client_id`,
        [activeCompany.id]
      ),
    ]);
    setClients(Array.isArray(rows) ? rows : []);
    const revArr = Array.isArray(revenueRows) ? revenueRows : [];
    const map = new Map<string, RevenueData>();
    revArr.forEach((r: any) => map.set(r.client_id, r));
    setRevenueMap(map);
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

  const handleBatchSetProspect = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('clients', Array.from(selectedIds), { status: 'prospect' });
      await reload();
    } catch (err: any) { console.error('Batch set prospect failed:', err); alert('Failed: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); }
  }, [selectedIds, reload]);

  const handleBatchSetTier = useCallback(async (tier: string) => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('clients', Array.from(selectedIds), { tier });
      await reload();
    } catch (err: any) { console.error('Batch set tier failed:', err); alert('Failed: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); setBulkTierOpen(false); }
  }, [selectedIds, reload]);

  const handleBatchAddTag = useCallback(async () => {
    if (!bulkTagValue.trim()) return;
    setBatchLoading(true);
    try {
      const tagToAdd = bulkTagValue.trim();
      const selected = clients.filter(c => selectedIds.has(c.id));
      for (const client of selected) {
        const existing = client.tags ? client.tags.split(',').map(t => t.trim()) : [];
        if (!existing.includes(tagToAdd)) {
          existing.push(tagToAdd);
          await api.update('clients', client.id, { tags: existing.join(', ') });
        }
      }
      await reload();
    } catch (err: any) { console.error('Batch tag failed:', err); alert('Failed: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); setBulkTagOpen(false); setBulkTagValue(''); }
  }, [selectedIds, clients, bulkTagValue, reload]);

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
      tier: c.tier || '',
      industry: c.industry || '',
      risk_rating: c.risk_rating || '',
      payment_terms: c.payment_terms ? `Net ${c.payment_terms}` : '',
      revenue: revenueMap.get(c.id)?.revenue ?? 0,
      tags: c.tags || '',
    }));
    downloadCSVBlob(exportData, 'clients-export.csv');
  }, [filtered, selectedIds, revenueMap]);

  // ─── Print Client Directory ─────────────────────────
  const handlePrintDirectory = useCallback(() => {
    const rows = filtered.map(c => {
      const rev = revenueMap.get(c.id);
      return `<tr>
        <td>${c.name}</td>
        <td>${c.email || '--'}</td>
        <td>${c.phone || '--'}</td>
        <td>${c.status}</td>
        <td>${c.tier || '--'}</td>
        <td style="text-align:right">${formatCurrency(rev?.revenue ?? 0)}</td>
      </tr>`;
    }).join('');

    const html = `
      <html><head><title>Client Directory</title>
      <style>
        body { font-family: 'Helvetica Neue', sans-serif; color: #1a1a2e; padding: 40px; }
        h1 { font-size: 22px; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 12px; }
        th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; background: #f5f5f5; }
        .footer { margin-top: 40px; font-size: 10px; color: #999; text-align: center; border-top: 1px solid #ddd; padding-top: 12px; }
        .count { font-size: 12px; color: #666; margin-top: 8px; }
      </style></head><body>
      <h1>Client Directory</h1>
      <div class="count">${filtered.length} client${filtered.length !== 1 ? 's' : ''} &bull; Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      <table>
        <thead><tr>
          <th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Tier</th><th style="text-align:right">Revenue</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">Business Accounting Pro &mdash; Client Directory</div>
      </body></html>
    `;
    api.printPreview(html, 'Client Directory');
  }, [filtered, revenueMap]);

  // ─── Clear all filters ──────────────────────────────
  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setTierFilter('all');
    setIndustryFilter('all');
    setRiskFilter('all');
  }, []);

  const hasFilters = statusFilter !== 'all' || tierFilter !== 'all' || industryFilter !== 'all' || riskFilter !== 'all' || searchQuery.trim() !== '';

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="space-y-4 overflow-y-auto" style={{ paddingBottom: someSelected ? '80px' : undefined }}>
      {loadError && <ErrorBanner message={loadError} title="Failed to load clients" onDismiss={() => setLoadError('')} />}

      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Clients</h1>
        <div className="module-actions">
          <button onClick={handlePrintDirectory} className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors" style={{ borderRadius: '6px' }}>
            <Printer size={14} />
            Print Directory
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors" style={{ borderRadius: '6px' }}>
            Import CSV
          </button>
          <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewClient}>
            <Plus size={14} />
            New Client
          </button>
        </div>
      </div>

      {/* Inline Summary Stats (6 cards) */}
      {summaryStats && (
        <div className="grid grid-cols-6 gap-3">
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Clients</div>
            <div className="text-lg font-mono font-bold text-text-primary mt-0.5">{summaryStats.total ?? 0}</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active</div>
            <div className="text-lg font-mono font-bold text-accent-income mt-0.5">{summaryStats.active ?? 0}</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Prospects</div>
            <div className="text-lg font-mono font-bold text-accent-blue mt-0.5">{summaryStats.prospects ?? 0}</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Revenue</div>
            <div className="text-lg font-mono font-bold text-accent-blue mt-0.5">{formatCurrency(summaryStats.total_revenue ?? 0)}</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Outstanding AR</div>
            <div className="text-lg font-mono font-bold text-accent-expense mt-0.5">{formatCurrency(summaryStats.outstanding ?? 0)}</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Revenue</div>
            <div className="text-lg font-mono font-bold text-text-primary mt-0.5">
              {formatCurrency((summaryStats.active ?? 0) > 0 ? (summaryStats.total_revenue ?? 0) / (summaryStats.active ?? 1) : 0)}
            </div>
          </div>
        </div>
      )}

      {/* Summary Bar (overdue) */}
      {clientSummary && (
        <SummaryBar items={[
          { label: 'Total Receivables', value: formatCurrency(clientSummary.total_receivables), accent: 'orange', tooltip: 'Sum of all outstanding invoice balances across overdue clients' },
          { label: 'Clients Overdue', value: String(clientSummary.overdue_clients ?? 0), accent: Number(clientSummary.overdue_clients) > 0 ? 'red' as const : 'default' as const, tooltip: 'Number of clients with at least one overdue invoice' },
        ]} />
      )}

      {/* Toolbar: Search + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
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
        <select
          className="block-select"
          style={{ width: 'auto', minWidth: '110px' }}
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
        >
          <option value="all">All Tiers</option>
          <option value="enterprise">Enterprise</option>
          <option value="premium">Premium</option>
          <option value="standard">Standard</option>
          <option value="basic">Basic</option>
        </select>
        {uniqueIndustries.length > 0 && (
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '130px' }}
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
          >
            <option value="all">All Industries</option>
            {uniqueIndustries.map(ind => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        )}
        <select
          className="block-select"
          style={{ width: 'auto', minWidth: '110px' }}
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
        >
          <option value="all">All Risk</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        {hasFilters && (
          <button className="text-[10px] font-semibold text-accent-blue uppercase tracking-wider hover:underline" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm text-text-muted font-mono">Loading clients...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3">
          <EmptyState
            icon={Users}
            message={clients.length === 0 ? 'No clients yet' : 'No clients match your search or filter'}
          />
          {clients.length === 0 ? (
            <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewClient}>
              <Plus size={14} />
              Add Client
            </button>
          ) : (
            <button className="block-btn text-xs" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="overflow-x-auto">
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
                <th style={{ width: '30px' }} title="Client Health" />
                <SortableHeader field="name" label="Name" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="email" label="Email" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="phone" label="Phone" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="status" label="Status" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <th>Tier</th>
                <th>Industry</th>
                <th>Risk</th>
                <SortableHeader field="revenue" label="Revenue" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="lastActivity" label="Last Invoice" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="payment_terms" label="Payment Terms" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => {
                const isSelected = selectedIds.has(client.id);
                const rev = revenueMap.get(client.id);
                return (
                  <tr
                    key={client.id}
                    className={`cursor-pointer ${isSelected ? 'bg-accent-blue/5' : ''}`}
                    onClick={() => onSelectClient(client.id)}
                  >
                    <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(client.id)}
                        className="cursor-pointer"
                        style={{ accentColor: '#3b82f6' }}
                      />
                    </td>
                    <td>
                      <HealthDot lastInvoice={rev?.last_invoice ?? null} outstanding={0} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <UserCircle size={16} className="text-text-muted shrink-0" />
                        <span className="text-text-primary font-medium block truncate max-w-[200px]">{client.name}</span>
                      </div>
                    </td>
                    <td className="text-text-secondary truncate max-w-[200px]">{client.email || '--'}</td>
                    <td className="text-text-secondary font-mono text-xs">{client.phone || '--'}</td>
                    <td>
                      <span className={formatStatus(client.status).className}>
                        {formatStatus(client.status).label}
                      </span>
                    </td>
                    <td><ClassificationBadge def={CLIENT_TIER} value={client.tier} /></td>
                    <td><ClassificationBadge def={CLIENT_INDUSTRY} value={client.industry} /></td>
                    <td><ClassificationBadge def={CLIENT_RISK} value={client.risk_rating} /></td>
                    <td className="text-right font-mono text-accent-blue text-xs">{formatCurrency(rev?.revenue ?? 0)}</td>
                    <td className="text-text-secondary font-mono text-xs">
                      {rev?.last_invoice ? formatDate(rev.last_invoice) : '--'}
                    </td>
                    <td className="text-text-secondary font-mono">
                      {client.payment_terms ? `Net ${client.payment_terms}` : '--'}
                    </td>
                    <td>
                      {client.tags ? (
                        <div className="flex flex-wrap gap-1">
                          {client.tags.split(',').map((tag) => {
                            const t = tag.trim();
                            return (
                              <span
                                key={`${client.id}:${t}`}
                                className="block-badge block-badge-purple text-[10px]"
                              >
                                {t}
                              </span>
                            );
                          })}
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
            Inactive
          </button>

          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={handleBatchSetProspect}
            disabled={batchLoading}
            style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            <Users size={13} />
            Prospect
          </button>

          {/* Bulk Set Tier */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
              onClick={() => { setBulkTierOpen(!bulkTierOpen); setBulkTagOpen(false); }}
              disabled={batchLoading}
              style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
            >
              <Shield size={13} />
              Set Tier
            </button>
            {bulkTierOpen && (
              <div className="absolute bottom-full mb-1 left-0 z-50 border border-border-primary shadow-lg p-1" style={{ background: 'rgba(18,20,28,0.95)', borderRadius: '6px', minWidth: '120px' }}>
                {['enterprise', 'premium', 'standard', 'basic'].map(tier => (
                  <button
                    key={tier}
                    className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary capitalize"
                    onClick={() => handleBatchSetTier(tier)}
                    style={{ borderRadius: '4px' }}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bulk Tag */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
              onClick={() => { setBulkTagOpen(!bulkTagOpen); setBulkTierOpen(false); }}
              disabled={batchLoading}
              style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
            >
              <Tag size={13} />
              Add Tag
            </button>
            {bulkTagOpen && (
              <div className="absolute bottom-full mb-1 left-0 z-50 border border-border-primary shadow-lg p-2 flex items-center gap-2" style={{ background: 'rgba(18,20,28,0.95)', borderRadius: '6px', minWidth: '200px' }}>
                <input
                  className="block-input text-xs flex-1"
                  placeholder="Tag name..."
                  value={bulkTagValue}
                  onChange={(e) => setBulkTagValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleBatchAddTag(); }}
                  autoFocus
                />
                <button className="block-btn-primary text-xs px-2 py-1" onClick={handleBatchAddTag}>Add</button>
              </div>
            )}
          </div>

          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={handleExportSelected}
            style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            <Download size={13} />
            Export
          </button>

          {!showDeleteConfirm ? (
            <button
              className="flex items-center gap-1.5 text-xs font-semibold"
              onClick={() => setShowDeleteConfirm(true)}
              style={{ background: 'transparent', border: '1px solid var(--color-accent-expense)', color: 'var(--color-accent-expense)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
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
                style={{ background: 'var(--color-accent-expense)', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}
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
