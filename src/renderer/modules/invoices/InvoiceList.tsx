import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { FileText, Plus, Search, Send, CheckCircle, Trash2, Download, Scale, Settings, DollarSign, AlertTriangle, Package } from 'lucide-react';
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
  invoice_type?: string;
  currency?: string;
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  standard:    '',
  service:     '#3b82f6',
  product:     '#8b5cf6',
  retainer:    '#d97706',
  credit_note: '#22c55e',
  proforma:    '#6b7280',
};

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
  onSettings?: () => void;
  onCatalog?: () => void;
}

const InvoiceList: React.FC<InvoiceListProps> = ({
  onNewInvoice,
  onViewInvoice,
  onEditInvoice,
  onSettings,
  onCatalog,
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
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);

  // Overdue → debt conversion
  const [candidates, setCandidates] = useState<any[]>([]);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [converting, setConverting] = useState<Set<string>>(new Set());

  // Fetch data
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      try {
        // Load invoices and clients first (critical), summary and candidates are non-blocking
        const [invoiceData, clientData] = await Promise.all([
          api.query('invoices', { company_id: activeCompany.id }),
          api.query('clients', { company_id: activeCompany.id }),
        ]);
        if (cancelled) return;
        setInvoices(Array.isArray(invoiceData) ? invoiceData : []);
        setClients(Array.isArray(clientData) ? clientData : []);

        // Non-critical secondary data — failures don't hide invoices
        api.rawQuery(
          `SELECT
            COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled') THEN total - amount_paid ELSE 0 END), 0) as outstanding,
            COALESCE(SUM(CASE WHEN status = 'overdue' THEN total - amount_paid ELSE 0 END), 0) as overdue,
            COALESCE(SUM(CASE WHEN status = 'paid' AND strftime('%Y-%m', updated_at) = strftime('%Y-%m', 'now') THEN amount_paid ELSE 0 END), 0) as collected_month
          FROM invoices WHERE company_id = ?`,
          [activeCompany.id]
        ).then(r => {
          if (cancelled) return;
          const row = Array.isArray(r) ? r[0] : r;
          setInvoiceSummary(row ?? null);
        }).catch(() => {});
        api.getOverdueCandidates(activeCompany.id, 30).then(r => {
          if (cancelled) return;
          setCandidates(Array.isArray(r) ? r : []);
        }).catch(() => {});
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
    if (!activeCompany) return;
    const invoiceData = await api.query('invoices', { company_id: activeCompany.id });
    setInvoices(invoiceData ?? []);
    setSelectedIds(new Set());
  }, [activeCompany]);

  const handleBatchMarkSent = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('invoices', Array.from(selectedIds), { status: 'sent' });
      await reload();
    } catch (err: any) { console.error('Batch mark sent failed:', err); alert('Failed to mark invoices as sent: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); }
  }, [selectedIds, reload]);

  const handleBatchMarkPaid = useCallback(async () => {
    setBatchLoading(true);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        const inv = invoices.find(i => i.id === id);
        if (inv) {
          await api.update('invoices', id, { status: 'paid', amount_paid: inv.total });
        }
      }
      await reload();
    } catch (err: any) { console.error('Batch mark paid failed:', err); alert('Failed to mark invoices as paid: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); }
  }, [selectedIds, invoices, reload]);

  const handleBatchDelete = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchDelete('invoices', Array.from(selectedIds));
      await reload();
    } catch (err: any) { console.error('Batch delete failed:', err); alert('Failed to delete invoices: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); setShowDeleteConfirm(false); }
  }, [selectedIds, reload]);

  const handleConvertToDebt = useCallback(async (invoiceId: string) => {
    if (!activeCompany) return;
    setConverting(prev => new Set(prev).add(invoiceId));
    try {
      const result = await api.convertInvoiceToDebt(invoiceId, activeCompany.id);
      if (result.error) { console.error('Convert failed:', result.error); return; }
      setCandidates(prev => prev.filter(c => c.id !== invoiceId));
      await reload();
    } catch (err) {
      console.error('Failed to convert invoice to debt:', err);
    } finally {
      setConverting(prev => { const next = new Set(prev); next.delete(invoiceId); return next; });
    }
  }, [activeCompany, reload]);

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
          {onCatalog && (
            <button className="block-btn flex items-center gap-2" onClick={onCatalog} title="Manage catalog items">
              <Package size={16} />
              Catalog
            </button>
          )}
          {onSettings && (
            <button className="block-btn flex items-center gap-2" onClick={onSettings} title="Invoice template settings">
              <Settings size={16} />
              Customize
            </button>
          )}
          <button
            className="block-btn flex items-center gap-2"
            onClick={async () => {
              const result = await api.applyLateFees();
              if (result?.applied > 0) {
                setFeedback({ type: 'success', message: `Applied late fees to ${result.applied} invoice(s)` });
                reload();
              } else {
                setFeedback({ type: 'info', message: 'No invoices eligible for late fees' });
              }
              setTimeout(() => setFeedback(null), 4000);
            }}
          >
            <DollarSign size={14} />
            Apply Late Fees
          </button>
          <button
            className="block-btn flex items-center gap-2"
            onClick={async () => {
              const result = await api.runDunning();
              if (result?.advanced > 0) {
                setFeedback({ type: 'success', message: `Advanced dunning on ${result.advanced} invoice(s)` });
                reload();
              } else {
                setFeedback({ type: 'info', message: 'No invoices need dunning advancement' });
              }
              setTimeout(() => setFeedback(null), 4000);
            }}
          >
            <AlertTriangle size={14} />
            Run Dunning
          </button>
          <button className="block-btn-primary flex items-center gap-2" onClick={onNewInvoice}>
            <Plus size={16} />
            New Invoice
          </button>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`text-xs px-3 py-2 border ${feedback.type === 'success' ? 'text-accent-income bg-accent-income/10 border-accent-income/20' : 'text-accent-blue bg-accent-blue/10 border-accent-blue/20'}`} style={{ borderRadius: '6px' }}>
          {feedback.message}
        </div>
      )}

      {/* Summary Bar */}
      {invoiceSummary && (
        <SummaryBar items={[
          { label: 'Outstanding', value: formatCurrency(invoiceSummary.outstanding), accent: 'orange', tooltip: 'Total unpaid invoices not yet overdue' },
          { label: 'Overdue', value: formatCurrency(invoiceSummary.overdue), accent: 'red', tooltip: 'Invoices past their due date with remaining balance' },
          { label: 'Collected This Month', value: formatCurrency(invoiceSummary.collected_month), accent: 'green', tooltip: 'Payments received in the current calendar month' },
        ]} />
      )}

      {/* Overdue → Collections Banner */}
      {candidates.length > 0 && !bannerDismissed && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: 'rgba(239,68,68,0.08)',
          border: '1px solid #ef4444', borderRadius: 6,
        }}>
          <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
            {candidates.length} overdue invoice{candidates.length !== 1 ? 's' : ''} eligible for debt collection
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="block-btn text-xs py-1 px-3"
              style={{ color: '#ef4444', borderColor: '#ef4444' }}
              onClick={() => setShowConvertModal(true)}
            >
              Review
            </button>
            <button
              style={{ fontSize: 12, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => setBannerDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Convert Modal */}
      {showConvertModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="block-card p-6" style={{ width: 560, maxHeight: '80vh', overflowY: 'auto', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 className="text-sm font-bold text-text-primary">Overdue Invoices — Send to Collections</h3>
              <button className="block-btn text-xs py-1 px-2" onClick={() => setShowConvertModal(false)}>Close</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              These invoices are 30+ days overdue and not yet in debt collection. Converting creates a new receivable debt linked to the invoice.
            </p>
            <table className="block-table w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left">Invoice</th>
                  <th className="text-left">Client</th>
                  <th className="text-right">Balance Due</th>
                  <th className="text-right">Due Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(inv => (
                  <tr key={inv.id}>
                    <td className="font-mono">{inv.invoice_number}</td>
                    <td>{inv.client_name || '—'}</td>
                    <td className="text-right font-mono text-accent-expense">
                      {formatCurrency((inv.total || 0) - (inv.amount_paid || 0))}
                    </td>
                    <td className="text-right text-text-muted">{inv.due_date}</td>
                    <td className="text-right">
                      <button
                        className="block-btn-primary text-xs py-1 px-3"
                        disabled={converting.has(inv.id)}
                        onClick={() => handleConvertToDebt(inv.id)}
                      >
                        {converting.has(inv.id) ? 'Converting...' : 'Convert'}
                      </button>
                    </td>
                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 16 }}>
                      All candidates have been converted.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
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
              style={{ borderRadius: '6px' }}
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
                    <td className="font-mono text-accent-blue">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {inv.invoice_number}
                        {inv.invoice_type && inv.invoice_type !== 'standard' && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase',
                            background: (TYPE_BADGE_COLORS[inv.invoice_type] || '#6b7280') + '22',
                            color: TYPE_BADGE_COLORS[inv.invoice_type] || '#6b7280',
                          }}>
                            {inv.invoice_type.replace('_', ' ')}
                          </span>
                        )}
                      </div>
                    </td>
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={badge.className}>{badge.label}</span>
                        {(inv as any).dunning_stage > 0 && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#d9770622', color: '#f59e0b' }}>
                            {['', 'REMIND', 'FIRM', 'FINAL', 'COLLECT'][(inv as any).dunning_stage] || `D${(inv as any).dunning_stage}`}
                          </span>
                        )}
                        {(inv as any).late_fee_applied === 1 && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#ef444422', color: '#f87171' }}>FEE</span>
                        )}
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {inv.status === 'overdue' && (
                        <button
                          onClick={() => sendToCollections(inv.id)}
                          className="block-btn text-xs"
                          title="Send to Collections"
                          aria-label="Send to Collections"
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
            background: 'rgba(18,20,28,0.80)',
            borderRadius: '6px',
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
            style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontWeight: 600, cursor: 'pointer' }}
          >
            <CheckCircle size={13} />
            Mark as Paid
          </button>

          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={handleExportSelected}
            style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            <Download size={13} />
            Export CSV
          </button>

          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={async () => {
              const ids = Array.from(selectedIds);
              if (ids.length === 0) return;
              const result = await api.batchExportPDF(ids);
              if (result?.cancelled) return;
              if (result?.error) {
                setFeedback({ type: 'error', message: 'PDF export failed: ' + result.error });
              } else {
                setFeedback({ type: 'success', message: `Exported ${result?.count || ids.length} invoices to PDF` });
              }
              setTimeout(() => setFeedback(null), 4000);
            }}
            disabled={batchLoading}
            style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            <FileText size={13} />
            Export PDF
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

export default InvoiceList;
