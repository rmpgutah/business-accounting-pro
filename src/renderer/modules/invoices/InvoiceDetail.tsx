import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Send, DollarSign, FileText, Calendar, Edit } from 'lucide-react';
import api from '../../lib/api';
import PaymentRecorder from './PaymentRecorder';

// ─── Types ──────────────────────────────────────────────
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'partial';

interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  amount_paid: number;
  status: InvoiceStatus;
  terms: string;
  notes: string;
  terms_text: string;
}

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_rate: number;
  account_id: string;
}

interface Client {
  id: string;
  name: string;
  email?: string;
  address?: string;
  phone?: string;
}

interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  date: string;
  method: string;
  reference: string;
}

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

// ─── Component ──────────────────────────────────────────
interface InvoiceDetailProps {
  invoiceId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

const InvoiceDetail: React.FC<InvoiceDetailProps> = ({ invoiceId, onBack, onEdit }) => {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [sending, setSending] = useState(false);

  const loadData = async () => {
    try {
      const inv = await api.get('invoices', invoiceId);
      if (!inv) return;
      setInvoice(inv);

      const [clientData, lineData, paymentData] = await Promise.all([
        api.get('clients', inv.client_id),
        api.query('invoice_line_items', { invoice_id: invoiceId }),
        api.query('payments', { invoice_id: invoiceId }),
      ]);

      setClient(clientData ?? null);
      setLines(lineData ?? []);
      setPayments(paymentData ?? []);
    } catch (err) {
      console.error('Failed to load invoice detail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [invoiceId]);

  const balance = useMemo(
    () => (invoice ? invoice.total - invoice.amount_paid : 0),
    [invoice]
  );

  const handleSendInvoice = async () => {
    if (!invoice || invoice.status === 'paid') return;
    setSending(true);
    try {
      await api.update('invoices', invoiceId, { status: 'sent' });
      setInvoice((prev) => (prev ? { ...prev, status: 'sent' } : prev));
    } catch (err) {
      console.error('Failed to send invoice:', err);
    } finally {
      setSending(false);
    }
  };

  const handlePaymentSaved = () => {
    setShowPaymentModal(false);
    // Reload all data to get fresh payment state
    setLoading(true);
    loadData();
  };

  if (loading || !invoice) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-muted text-sm font-mono">Loading invoice...</span>
      </div>
    );
  }

  const badge = STATUS_BADGE[invoice.status] ?? STATUS_BADGE.draft;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="block-btn p-2" title="Back">
            <ArrowLeft size={16} />
          </button>
          <h1 className="module-title text-text-primary">{invoice.invoice_number}</h1>
          <span className={badge.className}>{badge.label}</span>
        </div>
        <div className="module-actions">
          {invoice.status === 'draft' && (
            <button
              className="block-btn flex items-center gap-2"
              onClick={() => onEdit(invoiceId)}
            >
              <Edit size={14} />
              Edit
            </button>
          )}
          {invoice.status !== 'paid' && (
            <>
              <button
                className="block-btn flex items-center gap-2"
                onClick={handleSendInvoice}
                disabled={sending || invoice.status === 'sent'}
              >
                <Send size={14} />
                {sending ? 'Sending...' : 'Send Invoice'}
              </button>
              <button
                className="block-btn-success flex items-center gap-2"
                onClick={() => setShowPaymentModal(true)}
              >
                <DollarSign size={14} />
                Record Payment
              </button>
            </>
          )}
        </div>
      </div>

      {/* Invoice Document Layout */}
      <div className="block-card p-8">
        {/* Top: Invoice meta + Client */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          {/* Left: Invoice info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-text-muted mb-2">
              <FileText size={16} />
              <span className="text-xs font-semibold uppercase tracking-wider">Invoice</span>
            </div>
            <div>
              <span className="text-2xl font-bold font-mono text-text-primary">
                {invoice.invoice_number}
              </span>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-text-muted flex items-center gap-1.5">
                  <Calendar size={12} /> Issue Date
                </span>
                <span className="text-text-primary">{invoice.issue_date}</span>
              </div>
              <div>
                <span className="text-text-muted flex items-center gap-1.5">
                  <Calendar size={12} /> Due Date
                </span>
                <span className="text-text-primary">{invoice.due_date}</span>
              </div>
            </div>
            {invoice.terms && (
              <div className="text-sm">
                <span className="text-text-muted">Terms: </span>
                <span className="text-text-secondary">{invoice.terms}</span>
              </div>
            )}
          </div>

          {/* Right: Client info */}
          <div className="text-right">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
              Bill To
            </span>
            {client ? (
              <div className="space-y-1 text-sm">
                <p className="text-text-primary font-semibold text-base">{client.name}</p>
                {client.email && <p className="text-text-secondary">{client.email}</p>}
                {client.address && (
                  <p className="text-text-muted whitespace-pre-line">{client.address}</p>
                )}
                {client.phone && <p className="text-text-muted">{client.phone}</p>}
              </div>
            ) : (
              <p className="text-text-muted text-sm">Client not found</p>
            )}
          </div>
        </div>

        {/* Line Items Table */}
        <table className="block-table mb-6">
          <thead>
            <tr>
              <th>Description</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Unit Price</th>
              <th className="text-right">Tax %</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="text-text-primary">{line.description}</td>
                <td className="text-right font-mono text-text-secondary">{line.quantity}</td>
                <td className="text-right font-mono text-text-secondary">
                  {fmt.format(line.unit_price)}
                </td>
                <td className="text-right font-mono text-text-secondary">
                  {line.tax_rate > 0 ? `${line.tax_rate}%` : '--'}
                </td>
                <td className="text-right font-mono text-text-primary">
                  {fmt.format(line.quantity * line.unit_price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-72 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Subtotal</span>
              <span className="font-mono text-text-primary">{fmt.format(invoice.subtotal)}</span>
            </div>
            {invoice.tax > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Tax</span>
                <span className="font-mono text-text-primary">{fmt.format(invoice.tax)}</span>
              </div>
            )}
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Discount</span>
                <span className="font-mono text-accent-income">
                  -{fmt.format(invoice.discount)}
                </span>
              </div>
            )}
            <div
              className="flex justify-between text-sm font-bold pt-2"
              style={{ borderTop: '1px solid var(--color-border-primary)' }}
            >
              <span className="text-text-primary">Total</span>
              <span className="font-mono text-text-primary text-lg">
                {fmt.format(invoice.total)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Amount Paid</span>
              <span className="font-mono text-accent-income">
                {fmt.format(invoice.amount_paid)}
              </span>
            </div>
            <div
              className="flex justify-between text-sm font-bold pt-2"
              style={{ borderTop: '1px solid var(--color-border-primary)' }}
            >
              <span className="text-text-primary">Balance Due</span>
              <span
                className={`font-mono text-lg ${
                  balance > 0 ? 'text-accent-warning' : 'text-accent-income'
                }`}
              >
                {fmt.format(balance)}
              </span>
            </div>
          </div>
        </div>

        {/* Notes & Terms */}
        {(invoice.notes || invoice.terms_text) && (
          <div
            className="grid grid-cols-2 gap-6 mt-8 pt-6"
            style={{ borderTop: '1px solid var(--color-border-primary)' }}
          >
            {invoice.notes && (
              <div>
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
                  Notes
                </span>
                <p className="text-sm text-text-secondary whitespace-pre-line">{invoice.notes}</p>
              </div>
            )}
            {invoice.terms_text && (
              <div>
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
                  Terms & Conditions
                </span>
                <p className="text-sm text-text-secondary whitespace-pre-line">
                  {invoice.terms_text}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment History */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Payment History
          </span>
        </div>
        {payments.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-text-muted">No payments recorded yet.</p>
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="text-text-secondary">{p.date}</td>
                  <td className="text-text-secondary capitalize">{p.method}</td>
                  <td className="text-text-muted font-mono">{p.reference || '--'}</td>
                  <td className="text-right font-mono text-accent-income">
                    {fmt.format(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentRecorder
          invoiceId={invoiceId}
          invoiceTotal={invoice.total}
          amountPaid={invoice.amount_paid}
          onClose={() => setShowPaymentModal(false)}
          onSaved={handlePaymentSaved}
        />
      )}
    </div>
  );
};

export default InvoiceDetail;
