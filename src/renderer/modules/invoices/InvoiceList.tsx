import React, { useEffect, useState, useMemo } from 'react';
import { FileText, Plus, Search } from 'lucide-react';
import api from '../../lib/api';
import { useNavigation } from '../../lib/navigation';

// ─── Types ──────────────────────────────────────────────
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

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Status Badge Map ───────────────────────────────────
const STATUS_BADGE: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'block-badge block-badge-blue' },
  sent: { label: 'Sent', className: 'block-badge block-badge-warning' },
  paid: { label: 'Paid', className: 'block-badge block-badge-income' },
  overdue: { label: 'Overdue', className: 'block-badge block-badge-expense' },
  partial: { label: 'Partial', className: 'block-badge block-badge-purple' },
};

// ─── Status Tabs ────────────────────────────────────────
const TABS: { key: StatusTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
];

// ─── Component ──────────────────────────────────────────
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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Fetch data
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [invoiceData, clientData] = await Promise.all([
          api.query('invoices'),
          api.query('clients'),
        ]);
        if (cancelled) return;
        setInvoices(invoiceData ?? []);
        setClients(clientData ?? []);
      } catch (err) {
        console.error('Failed to load invoices:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-muted text-sm font-mono">Loading invoices...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
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
        <div className="empty-state">
          <div className="empty-state-icon">
            <FileText size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-muted">No invoices found.</p>
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
                <th>Invoice #</th>
                <th>Client Name</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th className="text-right">Total</th>
                <th className="text-right">Amount Paid</th>
                <th className="text-right">Balance Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const balance = inv.total - inv.amount_paid;
                const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.draft;
                return (
                  <tr
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => onViewInvoice(inv.id)}
                  >
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
                      {fmt.format(inv.total)}
                    </td>
                    <td className="text-right font-mono text-text-secondary">
                      {fmt.format(inv.amount_paid)}
                    </td>
                    <td className="text-right font-mono text-text-primary">
                      {fmt.format(balance)}
                    </td>
                    <td>
                      <span className={badge.className}>{badge.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default InvoiceList;
