import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Send, DollarSign, FileText, Calendar, Edit, Download, Eye, Mail, Printer, Copy, Scale, Bell, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { generateInvoiceHTML, InvoiceSettings } from '../../lib/print-templates';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { useNavigation } from '../../lib/navigation';
import PaymentRecorder from './PaymentRecorder';
import { formatCurrency, formatStatus, formatDate } from '../../lib/format';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';
import EntityChip from '../../components/EntityChip';

// ─── Types ──────────────────────────────────────────────
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'partial';

interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  amount_paid: number;
  status: InvoiceStatus;
  terms: string;
  notes: string;
  po_number?: string;
  job_reference?: string;
  internal_notes?: string;
  late_fee_pct?: number;
  late_fee_grace_days?: number;
  discount_pct?: number;
  invoice_type?: string;
  currency?: string;
  shipping_amount?: number;
}

const INVOICE_TYPE_COLORS: Record<string, string> = {
  service:     '#3b82f6',
  product:     '#8b5cf6',
  retainer:    '#d97706',
  credit_note: '#22c55e',
  proforma:    '#6b7280',
};

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_rate: number;
  tax_rate_override?: number;
  discount_pct?: number;
  row_type?: string;
  account_id: string;
}

interface Client {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  date: string;
  payment_method: string;
  reference: string;
}

// ─── Component ──────────────────────────────────────────
interface InvoiceDetailProps {
  invoiceId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

const InvoiceDetail: React.FC<InvoiceDetailProps> = ({ invoiceId, onBack, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const setModule = useAppStore((s) => s.setModule);
  const nav = useNavigation();

  const sendToCollections = (id: string) => {
    sessionStorage.setItem('nav:source_invoice', id);
    setModule('debt-collection');
  };
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reminders, setReminders] = useState<any[]>([]);
  const [schedulingReminders, setSchedulingReminders] = useState(false);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
  const [paymentSchedule, setPaymentSchedule] = useState<any[]>([]);
  const [debtLink, setDebtLink] = useState<any>(null);

  const buildHTML = () => {
    if (!invoice) return '';
    return generateInvoiceHTML(invoice, activeCompany, client, lines, invoiceSettings || undefined, paymentSchedule);
  };

  const handlePreview = async () => {
    const html = buildHTML();
    if (!html) return;
    await api.printPreview(html, `Invoice ${invoice?.invoice_number || ''}`);
  };

  const handlePrint = async () => {
    const html = buildHTML();
    if (!html) return;
    await api.print(html);
  };

  const handleSavePDF = async () => {
    const html = buildHTML();
    if (!html) return;
    await api.saveToPDF(html, `Invoice-${invoice?.invoice_number || ''}`);
  };

  const loadData = async () => {
    try {
      const inv = await api.get('invoices', invoiceId);
      if (!inv) return;
      setInvoice(inv);

      // Critical data: client, lines, payments
      const [clientData, lineData, paymentData] = await Promise.all([
        api.get('clients', inv.client_id),
        api.query('invoice_line_items', { invoice_id: invoiceId }, { field: 'sort_order', dir: 'asc' }),
        api.query('payments', { invoice_id: invoiceId }),
      ]);

      setClient(clientData ?? null);
      setLines(Array.isArray(lineData) ? lineData : []);
      setPayments(Array.isArray(paymentData) ? paymentData : []);

      // Non-critical secondary data — failures don't hide primary content
      api.invoiceListReminders(invoiceId)
        .then(r => { setReminders(Array.isArray(r) ? r : []); })
        .catch(() => {});
      api.getInvoiceSettings()
        .then(r => { if (r && !r.error) setInvoiceSettings(r); })
        .catch(() => {});
      api.listPaymentSchedule(invoiceId)
        .then(r => { setPaymentSchedule(Array.isArray(r) ? r : []); })
        .catch(() => {});
      api.getInvoiceDebtLink(invoiceId).then(setDebtLink).catch(() => {});
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

  const taxByRate = useMemo(() => {
    const map: Record<string, { taxable: number; tax: number }> = {};
    for (const l of lines) {
      if ((l.row_type || 'item') !== 'item') continue;
      const override = l.tax_rate_override;
      const rate = (override != null && override >= 0) ? override : l.tax_rate;
      if (rate <= 0) continue;
      const base = l.quantity * l.unit_price * (1 - (l.discount_pct || 0) / 100);
      const key = rate.toFixed(2);
      if (!map[key]) map[key] = { taxable: 0, tax: 0 };
      map[key].taxable += base;
      map[key].tax += base * (rate / 100);
    }
    return map;
  }, [lines]);

  const sortedTaxRates = useMemo(
    () => Object.keys(taxByRate).sort((a, b) => parseFloat(a) - parseFloat(b)),
    [taxByRate]
  );

  const handleSendInvoice = async () => {
    if (!invoice || invoice.status === 'paid') return;
    setSending(true);
    try {
      // Build the SAME HTML the user saw in preview so the attached PDF matches.
      const html = buildHTML();
      const result = await api.sendInvoiceEmail(invoiceId, html || undefined);
      if (result?.error) {
        console.error('Send invoice failed:', result.error);
        alert('Failed to open email: ' + result.error);
      } else if (result?.success) {
        if (result.newStatus) {
          setInvoice((prev) => (prev ? { ...prev, status: result.newStatus as InvoiceStatus } : prev));
        }
        // Let the user know the PDF is ready for manual attachment
        if (result.pdfPath) {
          console.info('Invoice PDF saved to:', result.pdfPath);
        }
      }
    } catch (err) {
      console.error('Failed to send invoice:', err);
    } finally {
      setSending(false);
    }
  };

  const handleCopyPortalLink = async () => {
    try {
      const { token } = await api.generateInvoiceToken(invoice!.id);
      const url = `https://accounting.rmpgutah.us/portal/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy portal link:', err);
    }
  };

  const handleDuplicate = async () => {
    if (!invoice) return;
    const result = await api.cloneRecord('invoices', invoice.id);
    if (result?.error) {
      console.error('Duplicate invoice failed:', result.error);
      alert('Failed to duplicate invoice: ' + result.error);
      return;
    }
    if (result?.id) {
      onEdit(result.id); // Open the cloned invoice for editing
    } else {
      onBack();
    }
  };

  const handleScheduleReminders = async () => {
    if (!invoice) return;
    setSchedulingReminders(true);
    try {
      await api.invoiceScheduleReminders(invoiceId);
      const updated = await api.invoiceListReminders(invoiceId);
      setReminders(updated ?? []);
    } catch (err) {
      console.error('Failed to schedule reminders:', err);
    } finally {
      setSchedulingReminders(false);
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

  const badge = formatStatus(invoice.status);

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
          {invoice.invoice_type && invoice.invoice_type !== 'standard' && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase',
              background: (INVOICE_TYPE_COLORS[invoice.invoice_type] || '#6b7280') + '22',
              color: INVOICE_TYPE_COLORS[invoice.invoice_type] || '#6b7280',
            }}>
              {invoice.invoice_type.replace('_', ' ')}
            </span>
          )}
          {invoice.currency && invoice.currency !== 'USD' && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', padding: '2px 6px', borderRadius: 6, background: 'var(--color-bg-tertiary)' }}>
              {invoice.currency}
            </span>
          )}
          {debtLink && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: 6 }}>
              In Collections
            </span>
          )}
        </div>
        <div className="module-actions">
          <button
            className="block-btn flex items-center gap-2"
            onClick={handlePreview}
          >
            <Eye size={14} />
            Preview
          </button>
          <button
            className="block-btn flex items-center gap-2"
            onClick={handlePrint}
          >
            <Printer size={14} />
            Print
          </button>
          <button
            className="block-btn flex items-center gap-2"
            onClick={handleSavePDF}
          >
            <Download size={14} />
            Save PDF
          </button>
          <button
            onClick={handleCopyPortalLink}
            className="px-3 py-1.5 border-2 border-border-primary text-xs font-bold uppercase tracking-wider hover:bg-bg-primary hover:text-white transition-colors"
          >
            {copied ? 'Copied!' : 'Copy Portal Link'}
          </button>
          <button
            onClick={handleDuplicate}
            className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors"
          >
            <Copy size={14} /> Duplicate
          </button>
          <button
            className="block-btn flex items-center gap-2"
            onClick={() => onEdit(invoiceId)}
          >
            <Edit size={14} />
            Edit
          </button>
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={handleSendInvoice}
            disabled={sending}
          >
            <Mail size={14} />
            {sending ? 'Sending...' : 'Send Invoice'}
          </button>
          <button
            className="block-btn-success flex items-center gap-2"
            onClick={() => { setEditPaymentId(null); setShowPaymentModal(true); }}
          >
            <DollarSign size={14} />
            Record Payment
          </button>
          {invoice.status === 'overdue' && (
            <button
              onClick={() => sendToCollections(invoice.id)}
              className="block-btn text-xs flex items-center gap-2"
              title="Send to Collections"
            >
              <Scale size={14} />
              Send to Collections
            </button>
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
                <span className="text-text-primary">{formatDate(invoice.issue_date)}</span>
              </div>
              <div>
                <span className="text-text-muted flex items-center gap-1.5">
                  <Calendar size={12} /> Due Date
                </span>
                <span className="text-text-primary">{formatDate(invoice.due_date)}</span>
              </div>
            </div>
            {invoice.terms && (
              <div className="text-sm">
                <span className="text-text-muted">Terms: </span>
                <span className="text-text-secondary">{invoice.terms}</span>
              </div>
            )}
            {invoice.po_number && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="text-text-muted" style={{ fontSize: 11 }}>PO#</span>
                <span className="text-text-primary" style={{ fontSize: 12, fontWeight: 500 }}>{invoice.po_number}</span>
              </div>
            )}
            {invoice.job_reference && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="text-text-muted" style={{ fontSize: 11 }}>Project</span>
                <span className="text-text-primary" style={{ fontSize: 12, fontWeight: 500 }}>{invoice.job_reference}</span>
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
                <p className="text-text-primary font-semibold text-base">
                  <EntityChip type="client" id={client.id} label={client.name} variant="inline" />
                </p>
                {client.email && <p className="text-text-secondary">{client.email}</p>}
                {(() => {
                  const addr = [
                    client.address_line1,
                    client.address_line2,
                    [client.city, client.state, client.zip].filter(Boolean).join(', '),
                    client.country && client.country !== 'US' ? client.country : '',
                  ].filter(Boolean);
                  return addr.length > 0 ? (
                    <p className="text-text-muted whitespace-pre-line">{addr.join('\n')}</p>
                  ) : null;
                })()}
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
                  {formatCurrency(line.unit_price)}
                </td>
                <td className="text-right font-mono text-text-secondary">
                  {line.tax_rate > 0 ? `${line.tax_rate}%` : '--'}
                </td>
                <td className="text-right font-mono text-text-primary">
                  {formatCurrency(line.quantity * line.unit_price)}
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
              <span className="font-mono text-text-primary">{formatCurrency(invoice.subtotal)}</span>
            </div>
            {sortedTaxRates.length > 1 ? (
              sortedTaxRates.map((rate) => (
                <div key={rate} className="flex justify-between text-sm">
                  <span className="text-text-secondary">Tax @ {rate}% on {formatCurrency(taxByRate[rate].taxable)}</span>
                  <span className="font-mono text-text-primary">{formatCurrency(taxByRate[rate].tax)}</span>
                </div>
              ))
            ) : (
              invoice.tax_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Tax</span>
                  <span className="font-mono text-text-primary">{formatCurrency(invoice.tax_amount)}</span>
                </div>
              )
            )}
            {invoice.discount_amount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Discount</span>
                <span className="font-mono text-accent-income">
                  -{formatCurrency(invoice.discount_amount)}
                </span>
              </div>
            )}
            {(invoice.shipping_amount || 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Shipping</span>
                <span className="font-mono text-text-primary">{formatCurrency(invoice.shipping_amount || 0)}</span>
              </div>
            )}
            <div
              className="flex justify-between text-sm font-bold pt-2"
              style={{ borderTop: '1px solid var(--color-border-primary)' }}
            >
              <span className="text-text-primary">
                {invoice.invoice_type === 'credit_note' ? 'Credit Amount' : 'Total'}
              </span>
              <span
                className="font-mono text-lg"
                style={{ color: invoice.invoice_type === 'credit_note' ? '#22c55e' : 'var(--color-text-primary)' }}
              >
                {invoice.invoice_type === 'credit_note'
                  ? `(${formatCurrency(Math.abs(invoice.total))}) CR`
                  : formatCurrency(invoice.total)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Amount Paid</span>
              <span className="font-mono text-accent-income">
                {formatCurrency(invoice.amount_paid)}
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
                {formatCurrency(balance)}
              </span>
            </div>
          </div>
        </div>

        {/* Late Fee Notice */}
        {invoice.late_fee_pct != null && invoice.late_fee_pct > 0 && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Late fee of {invoice.late_fee_pct}% applies after {invoice.late_fee_grace_days || 0} grace days.
          </div>
        )}

        {/* Notes */}
        {invoice.notes && (
          <div
            className="grid grid-cols-2 gap-6 mt-8 pt-6"
            style={{ borderTop: '1px solid var(--color-border-primary)' }}
          >
            <div>
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
                Notes
              </span>
              <p className="text-sm text-text-secondary whitespace-pre-line">{invoice.notes}</p>
            </div>
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
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="text-text-secondary">{formatDate(p.date)}</td>
                  <td className="text-text-secondary capitalize">{p.payment_method}</td>
                  <td className="text-text-muted font-mono">{p.reference || '--'}</td>
                  <td className="text-right font-mono text-accent-income">
                    {formatCurrency(p.amount)}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        className="text-text-muted hover:text-accent-blue transition-colors p-0.5"
                        onClick={() => { setEditPaymentId(p.id); setShowPaymentModal(true); }}
                        title="Edit payment"
                      >
                        <Edit size={12} />
                      </button>
                      <button
                        className="text-text-muted hover:text-accent-expense transition-colors p-0.5"
                        onClick={async () => {
                          if (!window.confirm('Delete this payment? The invoice balance will be recalculated.')) return;
                          try {
                            await api.remove('payments', p.id);
                            const remainingPayments = await api.query('payments', { invoice_id: invoiceId });
                            const newPaid = (remainingPayments || []).reduce((s: number, pay: any) => s + (pay.amount || 0), 0);
                            const newStatus = newPaid >= (invoice?.total || 0) ? 'paid' : newPaid > 0 ? 'partial' : 'sent';
                            await api.update('invoices', invoiceId, { amount_paid: newPaid, status: newStatus });
                            loadData();
                          } catch (err: any) {
                            alert('Failed to delete payment: ' + (err?.message || 'Unknown error'));
                          }
                        }}
                        title="Delete payment"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reminders */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-text-muted" />
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Reminders
            </span>
          </div>
          {invoice.status !== 'paid' && (
            <button
              className="block-btn flex items-center gap-2 text-xs"
              onClick={handleScheduleReminders}
              disabled={schedulingReminders}
            >
              <Bell size={12} />
              {schedulingReminders ? 'Scheduling...' : 'Schedule Reminders'}
            </button>
          )}
        </div>
        {reminders.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-text-muted">No reminders scheduled.</p>
            {invoice.status !== 'paid' && (
              <p className="text-xs text-text-muted mt-1">
                Click "Schedule Reminders" to auto-create reminders based on the due date.
              </p>
            )}
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Scheduled Date</th>
                <th>Status</th>
                <th>Sent At</th>
              </tr>
            </thead>
            <tbody>
              {reminders.map((r: any) => {
                const typeLabels: Record<string, string> = {
                  before_due: '3 Days Before Due',
                  on_due: 'On Due Date',
                  overdue_7: '7 Days Overdue',
                  overdue_14: '14 Days Overdue',
                  overdue_30: '30 Days Overdue',
                  overdue_60: '60 Days Overdue',
                  custom: 'Custom',
                };
                const statusBadge = formatStatus(r.status);
                return (
                  <tr key={r.id}>
                    <td className="text-text-primary text-sm">
                      {typeLabels[r.reminder_type] || r.reminder_type}
                    </td>
                    <td className="text-text-secondary text-sm">
                      {formatDate(r.scheduled_date)}
                    </td>
                    <td>
                      <span className={statusBadge.className}>{statusBadge.label}</span>
                    </td>
                    <td className="text-text-muted text-sm font-mono">
                      {r.sent_at ? formatDate(r.sent_at) : '--'}
                    </td>
                  </tr>
                );
              })}
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
          editPaymentId={editPaymentId}
          onClose={() => { setShowPaymentModal(false); setEditPaymentId(null); }}
          onSaved={handlePaymentSaved}
        />
      )}

      {/* ── Cross-entity panels — related records + activity timeline ── */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="invoice" entityId={invoiceId} hide={['lines', 'payments']} />
        <EntityTimeline entityType="invoices" entityId={invoiceId} />
      </div>
    </div>
  );
};

export default InvoiceDetail;
