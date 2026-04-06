import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { FileText, Plus, Search, Send, CheckCircle, Trash2, Download, Scale } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { useNavigation } from '../../lib/navigation';
import { downloadCSVBlob } from '../../lib/csv-export';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { SummaryBar } from '../../components/SummaryBar';
import { formatCurrency, formatStatus } from '../../lib/format';

// ─── Types ─────��────────────���───────────────────────────
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'partial';

interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string;
  issue_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  status: InvoiceStatus;
  notes?: string;
}

interface Client {
  id: string;
  name: string;
}

type StatusTab = 'all' | InvoiceStatus;

// ─── Status Tabs ──────────────��─────────────────────────
const TABS: { key: StatusTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
];

// ─── Component ──────��───────────────────────────────────
interface InvoiceListProps {
  onNewInvoice: () => void;
  onViewInvoice: (id: string) => void;
  onEditInvoice: (id: string) => void;
}

const InvoiceList: React.FC<InvoiceListProps> = ({
  onNewInvoice,
  onViewInvoice,
  onEditInvoice,
}) => {
  const nav = useNavigation();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const setModule = useAppStore((s) => s.setModule);

  const sendToCollections = useCallback((invoiceId: string) => {
    sessionStorage.setItem('nav:source_invoice', invoiceId);
    setModule('debt-collection');
  }, [setModule]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [invoiceSummary, setInvoiceSummary] = useState<any>(null);

  // Fetch data
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      try {
        const [invoiceData, clientData, summaryResult] = await Promise.all([
          api.query('invoices', { company_id: activeCompany.id }),
          api.query('clients', { company_id: activeCompany.id }),
          api.rawQuery(
            `SELECT
              COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled') THEN total - amount_paid ELSE 0 END), 0) as outstanding,
              COALESCE(SUM(CASE WHEN status = 'overdue' THEN total - amount_paid ELSE 0 END), 0) as overdue,
              COALESCE(SUM(CASE WHEN status = 'paid' AND strftime('%Y-%m', paid_date) = strftime('%Y-%m', 'now') THEN amount_paid ELSE 0 END), 0) as collected_month
            FROM invoices WHERE company_id = ?`,
            [activeCompany.id]
          ),
        ]);
        if (cancelled) return;
        setInvoices(invoiceData ?? []);
        setClients(clientData ?? []);
        const summaryRow = Array.isArray(summaryResult) ? summaryResult[0] : summaryResult;
        setInvoiceSummary(summaryRow ?? null);
      } catch (err) {
        console.error('Failed to load invoices:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // Client name lookup
  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [clients]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = invoices;

    if (activeTab !== 'all') {
      list = list.filter((inv) => inv.status === activeTab);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (inv) =>
          inv.invoice_number.toLowerCase().includes(q) ||
          (clientMap.get(inv.client_id) ?? '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [invoices, activeTab, search, clientMap]);

  // ─── Selection Helpers ──────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every(inv => selectedIds.has(inv.id));
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
      setSelectedIds(new Set(filtered.map(inv => inv.id)));
    }
  }, [allSelected, filtered]);

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); }, [activeTab, search]);

  // ─── Batch Actions ──────────────────────────────────────
  const reload = useCallback(async () => {
    const invoiceData = await api.query('invoices');
    setInvoices(invoiceData ?? []);
    setSelectedIds(new Set());
  }, []);

  const handleBatchMarkSent = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('invoices', Array.from(selectedIds), { status: 'sent' });
      await reload();
    } catch (err) { console.error('Batch mark sent failed:', err); }
    finally { setBatchLoading(false); }
  }, [selectedIds, reload]);

  const handleBatchMarkPaid = useCallback(async () => {
    setBatchLoading(true);
    try {
      const ids = Array.from(selectedIds);
      // For "Mark as Paid", set status and amount_paid = total for each
      for (const id of ids) {
        const inv = invoices.find(i => i.id === id);
        if (inv) {
          await api.update('invoices', id, { status: 'paid', amount_paid: inv.total });
        }
      }
      await reload();
    } catch (err) { console.error('Batch mark paid failed:', err); }
    finally { setBatchLoading(false); }
  }, [selectedIds, invoices, reload]);

  const handleBatchDelete = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchDelete('invoices', Array.from(selectedIds));
      await reload();
    } catch (err) { console.error('Batch delete failed:', err); }
    finally { setBatchLoading(false); setShowDeleteConfirm(false); }
  }, [selectedIds, reload]);

  const handleExportSelected = useCallback(() => {
    const selected = filtered.filter(inv => selectedIds.has(inv.id));
    const exportData = selected.map(inv => ({
      invoice_number: inv.invoice_number,
      client: clientMap.get(inv.client_id) ?? '',
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      total: inv.total,
      amount_paid: inv.amount_paid,
      balance_due: inv.total - inv.amount_paid,
      status: inv.status,
    }));
    downloadCSVBlob(exportData, 'invoices-export.csv');
  }, [filtered, selectedIds, clientMap]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-muted text-sm font-mono">Loading invoices...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full" style={{ paddingBottom: someSelected ? '80px' : undefined }}>
      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Invoices</h1>
        <div className="module-actions">
          <button className="block-btn-primary flex items-center gap-2" onClick={onNewInvoice}>
            <Plus size={16} />
            New Invoice
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      {invoiceSummary && (
        <SummaryBar items={[
          { label: 'Outstanding', value: formatCurrency(invoiceSummary.outstanding), accent: 'orange', tooltip: 'Total unpaid invoices not yet overdue' },
          { label: 'Overdue', value: formatCurrency(invoiceSummary.overdue), accent: 'red', tooltip: 'Invoices past their due date with remaining balance' },
          { label: 'Collected This Month', value: formatCurrency(invoiceSummary.collected_month), accent: 'green', tooltip: 'Payments received in the current calendar month' },
        ]} />
      )}

      {/* Tabs + Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'bg-accent-blue text-white'
                  : 'bg-bg-secondary text-text-muted hover:text-text-primary'
              }`}
              style={{ borderRadius: '2px' }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder="Search invoices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block-input pl-8"
            style={{ width: '260px' }}
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3">
          <EmptyState icon={FileText} message="No invoices found" />
          <button
            className="block-btn-primary mt-4 flex items-center gap-2"
            onClick={onNewInvoice}
          >
            <Plus size={16} />
            Create your first invoice
          </button>
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
                <th>Invoice #</th>
                <th>Client Name</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th className="text-right">Total</th>
                <th className="text-right">Amount Paid</th>
                <th className="text-right">Balance Due</th>
                <th>Status</th>
                <th style={{ width: '60px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const balance = inv.total - inv.amount_paid;
                const badge = formatStatus(inv.status);
                const isSelected = selectedIds.has(inv.id);
                return (
                  <tr
                    key={inv.id}
                    className={`cursor-pointer ${isSelected ? 'bg-accent-blue/5' : ''}`}
                    onClick={() => onViewInvoice(inv.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(inv.id)}
                        className="cursor-pointer"
                        style={{ accentColor: '#3b82f6' }}
                      />
                    </td>
                    <td className="font-mono text-accent-blue">{inv.invoice_number}</td>
                    <td>
                      <button
                        className="text-accent-blue hover:underline text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          nav.goToClient(inv.client_id);
                        }}
                      >
                        {clientMap.get(inv.client_id) ?? 'Unknown'}
                      </button>
                    </td>
                    <td className="text-text-secondary">{inv.issue_date}</td>
                    <td className="text-text-secondary">{inv.due_date}</td>
                    <td className="text-right font-mono text-text-primary">
                      {formatCurrency(inv.total)}
                    </td>
                    <td className="text-right font-mono text-text-secondary">
                      {formatCurrency(inv.amount_paid)}
                    </td>
                    <td className="text-right font-mono text-text-primary">
                      {formatCurrency(balance)}
                    </td>
                    <td>
                      <span className={badge.className}>{badge.label}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {inv.status === 'overdue' && (
                        <button
                          onClick={() => sendToCollections(inv.id)}
                          className="block-btn text-xs"
                          title="Send to Collections"
                        >
                          <Scale size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
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
            minWidth: '500px',
          }}
        >
          <span className="text-xs font-semibold text-text-muted mr-2">
            {selectedIds.size} of {filtered.length} selected
          </span>

          <button
            className="block-btn-primary flex items-center gap-1.5 text-xs"
            onClick={handleBatchMarkSent}
            disabled={batchLoading}
          >
            <Send size={13} />
            Mark as Sent
          </button>

          <button
            className="block-btn-success flex items-center gap-1.5 text-xs"
            onClick={handleBatchMarkPaid}
            disabled={batchLoading}
            style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '2px', padding: '6px 12px', fontWeight: 600, cursor: 'pointer' }}
          >
            <CheckCircle size={13} />
            Mark as Paid
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

export default InvoiceList;
