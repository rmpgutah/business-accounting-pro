import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Send, DollarSign, FileText, Calendar, Edit, Download, Eye, Mail, Printer, Copy, Scale, Bell, Trash2, Repeat, Activity, TrendingUp, Share2, Eye as EyeIcon } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';
import PortalShareModal from '../../components/PortalShareModal';
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
  // 2026-04 enhancements
  times_sent?: number;
  portal_viewed_count?: number;
  last_viewed_at?: string;
  tags?: string;
}

interface ActivityEntry {
  id: string;
  invoice_id: string;
  activity_type: string;
  description: string;
  user_name: string;
  metadata_json?: string;
  created_at: string;
}

interface PaymentPrediction {
  predicted_date?: string;
  predictedDate?: string;
  avg_days_to_pay?: number;
  confidence?: number;
  [key: string]: any;
}

// PORTAL: privacy preview — returns ONLY the fields the public portal exposes.
// Internal-only fields (internal_notes, created_by, late_fee_pct, etc.) are
// deliberately excluded so the user can audit what the recipient sees before
// they share. Keep this in sync with what the server-side portal renders.
export function getInvoicePortalPreview(
  invoice: { invoice_number: string; issue_date: string; due_date: string; total: number; amount_paid: number; status: string; currency?: string; notes?: string; terms?: string },
  client: { name?: string } | null,
): React.ReactNode {
  return (
    <div className="space-y-1">
      <div><span className="text-text-muted">Invoice:</span> <span className="font-mono">{invoice.invoice_number}</span></div>
      <div><span className="text-text-muted">Bill to:</span> {client?.name ?? '—'}</div>
      <div><span className="text-text-muted">Issued:</span> {invoice.issue_date || '—'}</div>
      <div><span className="text-text-muted">Due:</span> {invoice.due_date || '—'}</div>
      <div><span className="text-text-muted">Status:</span> {invoice.status}</div>
      <div><span className="text-text-muted">Total:</span> {(invoice.currency ?? 'USD')} {invoice.total?.toFixed(2)}</div>
      <div><span className="text-text-muted">Paid:</span> {(invoice.currency ?? 'USD')} {invoice.amount_paid?.toFixed(2)}</div>
      {invoice.terms && <div><span className="text-text-muted">Terms:</span> {invoice.terms}</div>}
      {invoice.notes && <div><span className="text-text-muted">Notes:</span> {invoice.notes}</div>}
      <div className="text-text-muted italic pt-1 border-t border-border-primary mt-2">
        Hidden from recipient: internal notes, created-by, late-fee config.
      </div>
    </div>
  );
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
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [reminders, setReminders] = useState<any[]>([]);
  const [schedulingReminders, setSchedulingReminders] = useState(false);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
  const [paymentSchedule, setPaymentSchedule] = useState<any[]>([]);
  const [debtLink, setDebtLink] = useState<any>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [prediction, setPrediction] = useState<PaymentPrediction | null>(null);
  const [allClientInvoices, setAllClientInvoices] = useState<any[]>([]);
  const [applyingLateFee, setApplyingLateFee] = useState(false);
  const [convertingRecurring, setConvertingRecurring] = useState(false);
  // PORTAL: share modal + cached base URL (resolved from main via `portal:base-url`).
  const [showShareModal, setShowShareModal] = useState(false);
  const [portalBaseUrl, setPortalBaseUrl] = useState<string>('https://accounting.rmpgutah.us');
  useEffect(() => {
    api.portalBaseUrl().then(r => { if (r?.baseUrl) setPortalBaseUrl(r.baseUrl); }).catch(() => {});
  }, []);

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

      // Activity log
      api.rawQuery(
        `SELECT * FROM invoice_activity_log WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 50`,
        [invoiceId]
      ).then((rows: any) => {
        setActivityLog(Array.isArray(rows) ? rows : []);
      }).catch(() => {});

      // Predicted payment (only if unpaid)
      if (inv.status !== 'paid' && (inv.status as string) !== 'void' && (inv.status as string) !== 'cancelled') {
        api.intelPredictPayment(invoiceId).then((r: any) => {
          if (r && !r.error) setPrediction(r);
        }).catch(() => {});
      }

      // All client invoices (for Statement print)
      if (inv.client_id) {
        api.query('invoices', { client_id: inv.client_id }, { field: 'issue_date', dir: 'desc' })
          .then((rows: any) => {
            setAllClientInvoices(Array.isArray(rows) ? rows : []);
          }).catch(() => {});
      }
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
    setActionError('');
    try {
      // Build the SAME HTML the user saw in preview so the attached PDF matches.
      const html = buildHTML();
      const result = await api.sendInvoiceEmail(invoiceId, html || undefined);
      if (result?.error) {
        // VISIBILITY: surface send-invoice errors instead of swallowing
        console.error('Send invoice failed:', result.error);
        setActionError(`Failed to open email: ${result.error}`);
      } else if (result?.success) {
        if (result.newStatus) {
          setInvoice((prev) => (prev ? { ...prev, status: result.newStatus as InvoiceStatus } : prev));
        }
        // Let the user know the PDF is ready for manual attachment
        if (result.pdfPath) {
          console.info('Invoice PDF saved to:', result.pdfPath);
        }
      }
    } catch (err: any) {
      // VISIBILITY: surface send-invoice exceptions instead of swallowing
      console.error('Failed to send invoice:', err);
      setActionError(err?.message ?? String(err));
    } finally {
      setSending(false);
    }
  };

  const handleCopyPortalLink = async () => {
    try {
      const { token } = await api.generateInvoiceToken(invoice!.id);
      // PORTAL: build URL from configured SYNC_SERVER (setting-driven), not a hardcoded host.
      const url = `${portalBaseUrl}/portal/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err: any) {
      console.error('Failed to copy portal link:', err);
      setActionError(`Copy failed: ${err?.message ?? String(err)}`);
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
    } catch (err: any) {
      // VISIBILITY: surface schedule-reminders errors instead of swallowing
      console.error('Failed to schedule reminders:', err);
      setActionError(`Failed to schedule reminders: ${err?.message ?? String(err)}`);
    } finally {
      setSchedulingReminders(false);
    }
  };

  const handleApplyLateFee = async () => {
    if (!invoice) return;
    setApplyingLateFee(true);
    try {
      const result = await api.applyLateFees();
      await api.create('invoice_activity_log', {
        invoice_id: invoice.id,
        activity_type: 'late_fee_applied',
        description: `Late fees evaluated — ${result?.applied || 0} invoice(s) updated`,
      });
      loadData();
    } catch (err: any) {
      console.error('Apply late fee failed:', err);
      setActionError(`Failed to apply late fee: ${err?.message ?? String(err)}`);
    } finally {
      setApplyingLateFee(false);
    }
  };

  const handleConvertToRecurring = async () => {
    if (!invoice) return;
    setConvertingRecurring(true);
    try {
      // Shell: log the intent, then route the user to the Recurring module.
      await api.create('invoice_activity_log', {
        invoice_id: invoice.id,
        activity_type: 'convert_to_recurring',
        description: 'User clicked Convert to Recurring',
      });
      sessionStorage.setItem('nav:source_invoice', invoice.id);
      setModule('recurring');
    } catch (err: any) {
      console.error('Convert to recurring failed:', err);
      setActionError(`Failed to convert: ${err?.message ?? String(err)}`);
    } finally {
      setConvertingRecurring(false);
    }
  };

  const handlePrintStatement = async () => {
    if (!invoice || !client) return;
    const rows = allClientInvoices;
    const totalOutstanding = rows
      .filter((r) => r.status !== 'paid' && r.status !== 'void' && r.status !== 'cancelled')
      .reduce((s: number, r: any) => s + ((r.total || 0) - (r.amount_paid || 0)), 0);
    const html = `
      <html><head><title>Statement — ${client.name}</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 32px; color: #111; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        .sub { color: #555; font-size: 12px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
        th { background: #f4f4f4; }
        .num { text-align: right; font-family: monospace; }
        .total { font-weight: bold; font-size: 14px; margin-top: 16px; text-align: right; }
        .row-current { background: #fff7d6; }
      </style></head><body>
        <h1>Customer Statement</h1>
        <div class="sub">${client.name} — Generated ${new Date().toLocaleDateString()}</div>
        <table>
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Issue Date</th>
              <th>Due Date</th>
              <th>Status</th>
              <th class="num">Total</th>
              <th class="num">Paid</th>
              <th class="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r: any) => {
              const balance = (r.total || 0) - (r.amount_paid || 0);
              const cls = r.id === invoice.id ? 'row-current' : '';
              return `<tr class="${cls}">
                <td>${r.invoice_number || ''}</td>
                <td>${formatDate(r.issue_date)}</td>
                <td>${formatDate(r.due_date)}</td>
                <td>${r.status || ''}</td>
                <td class="num">${formatCurrency(r.total || 0)}</td>
                <td class="num">${formatCurrency(r.amount_paid || 0)}</td>
                <td class="num">${formatCurrency(balance)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div class="total">Total Outstanding: ${formatCurrency(totalOutstanding)}</div>
      </body></html>
    `;
    await api.printPreview(html, `Statement — ${client.name}`);
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
      {actionError && (
        <ErrorBanner
          message={actionError}
          title="Action failed"
          onDismiss={() => setActionError('')}
        />
      )}
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
            className="px-3 py-1.5 border-2 border-border-primary text-xs font-bold uppercase tracking-wider hover:bg-bg-primary hover:text-white transition-colors flex items-center gap-1"
            title="Copy a shareable portal link to the clipboard"
          >
            {copied ? <><span aria-hidden>✓</span> Copied!</> : 'Copy Portal Link'}
          </button>
          {/* A11Y: live region announces the copy action without stealing focus. */}
          <span aria-live="polite" className="sr-only">{copied ? 'Portal link copied to clipboard' : ''}</span>
          <button
            onClick={() => setShowShareModal(true)}
            className="block-btn flex items-center gap-2"
            title="Open share options (regenerate, disable, preview)"
          >
            <Share2 size={14} />
            Share
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
              <th className="text-right">Tax Amount</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              // MATH: Apply per-line discount_pct to base, mirror InvoiceForm/print template
              // so this UI table reconciles with the totals box and the printed PDF.
              // Use tax_rate_override (when set, i.e. >= 0) to match how form computes tax.
              const baseAmount = line.quantity * line.unit_price;
              const discountedAmount = baseAmount * (1 - (line.discount_pct || 0) / 100);
              const effectiveTaxRate = (line.tax_rate_override != null && line.tax_rate_override >= 0)
                ? line.tax_rate_override
                : (line.tax_rate || 0);
              const lineTax = discountedAmount * (effectiveTaxRate / 100);
              const lineTotal = discountedAmount + lineTax;
              return (
                <tr key={line.id}>
                  <td className="text-text-primary">{line.description}</td>
                  <td className="text-right font-mono text-text-secondary">{line.quantity}</td>
                  <td className="text-right font-mono text-text-secondary">
                    {formatCurrency(line.unit_price)}
                  </td>
                  <td className="text-right font-mono text-text-secondary">
                    {effectiveTaxRate > 0 ? `${effectiveTaxRate}%` : '--'}
                  </td>
                  <td className="text-right font-mono text-text-secondary">
                    {effectiveTaxRate > 0 ? formatCurrency(lineTax) : '--'}
                  </td>
                  <td className="text-right font-mono text-text-primary">
                    {formatCurrency(lineTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-72 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Subtotal</span>
              <span className="font-mono text-text-primary">{formatCurrency(invoice.subtotal)}</span>
            </div>
            {(invoice.discount_amount > 0 || invoice.tax_amount > 0) && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Pre-Tax Amount</span>
                <span className="font-mono text-text-primary">{formatCurrency((invoice.subtotal || 0) - (invoice.discount_amount || 0))}</span>
              </div>
            )}
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

      {/* Aging Banner — for unpaid invoices */}
      {invoice.status !== 'paid' && (invoice.status as string) !== 'void' && (invoice.status as string) !== 'cancelled' && (() => {
        const dueDate = new Date(invoice.due_date);
        const days = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        let label = '';
        let color = '#22c55e';
        let bg = 'rgba(34,197,94,0.10)';
        let border = '#22c55e';
        if (days <= 0) {
          label = days === 0 ? 'Due today' : `Due in ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
        } else if (days <= 30) {
          label = `${days} day${days === 1 ? '' : 's'} overdue`;
          color = '#facc15'; bg = 'rgba(250,204,21,0.10)'; border = '#facc15';
        } else if (days <= 60) {
          label = `${days} days overdue`;
          color = '#f97316'; bg = 'rgba(249,115,22,0.10)'; border = '#f97316';
        } else if (days <= 90) {
          label = `${days} days overdue`;
          color = '#ef4444'; bg = 'rgba(239,68,68,0.10)'; border = '#ef4444';
        } else {
          label = `${days} days overdue — critical`;
          color = '#dc2626'; bg = 'rgba(220,38,38,0.15)'; border = '#dc2626';
        }
        return (
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: bg, border: `1px solid ${border}`, borderRadius: 6 }}
          >
            <div className="flex items-center gap-2">
              <Calendar size={16} style={{ color }} />
              <span className="text-sm font-bold" style={{ color }}>
                {label}
              </span>
              <span className="text-xs text-text-muted">
                Balance: {formatCurrency(invoice.total - invoice.amount_paid)}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Predicted Payment + Engagement Metrics */}
      {(invoice.status !== 'paid' && (invoice.status as string) !== 'void' && (invoice.status as string) !== 'cancelled') && (
        <div className="grid grid-cols-2 gap-4">
          <div className="block-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-accent-blue" />
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Predicted Payment
              </span>
            </div>
            {prediction && (prediction.predicted_date || prediction.predictedDate) ? (
              <div className="space-y-2">
                <div>
                  <div className="text-[11px] text-text-muted">Expected Pay Date</div>
                  <div className="text-lg font-bold font-mono text-text-primary">
                    {formatDate(String(prediction.predicted_date || prediction.predictedDate))}
                  </div>
                </div>
                {prediction.avg_days_to_pay != null && (
                  <div>
                    <div className="text-[11px] text-text-muted">Client Avg Days to Pay</div>
                    <div className="text-sm font-mono text-text-secondary">
                      {Number(prediction.avg_days_to_pay).toFixed(1)} days
                    </div>
                  </div>
                )}
                {prediction.confidence != null && (
                  <div>
                    <div className="text-[11px] text-text-muted">Confidence</div>
                    <div className="text-sm font-mono text-text-secondary">
                      {(Number(prediction.confidence) * 100).toFixed(0)}%
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-text-muted">
                Not enough payment history to predict.
              </div>
            )}
          </div>

          <div className="block-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <EyeIcon size={14} className="text-accent-blue" />
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Engagement
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[11px] text-text-muted">Times Sent</div>
                <div className="text-lg font-bold font-mono text-text-primary">
                  {invoice.times_sent ?? 0}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-text-muted">Times Viewed</div>
                <div className="text-lg font-bold font-mono text-text-primary">
                  {invoice.portal_viewed_count ?? 0}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-text-muted">Last Viewed</div>
                <div className="text-sm font-mono text-text-secondary">
                  {invoice.last_viewed_at ? formatDate(invoice.last_viewed_at) : '—'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions Row */}
      <div className="block-card p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Quick Actions
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {invoice.status !== 'paid' && (
              <button
                className="block-btn flex items-center gap-2 text-xs"
                onClick={handleScheduleReminders}
                disabled={schedulingReminders}
              >
                <Bell size={12} />
                {schedulingReminders ? 'Scheduling…' : 'Send Reminder'}
              </button>
            )}
            {invoice.status !== 'paid' && (invoice.late_fee_pct ?? 0) > 0 && (
              <button
                className="block-btn flex items-center gap-2 text-xs"
                onClick={handleApplyLateFee}
                disabled={applyingLateFee}
              >
                <DollarSign size={12} />
                {applyingLateFee ? 'Applying…' : 'Apply Late Fee'}
              </button>
            )}
            <button
              className="block-btn flex items-center gap-2 text-xs"
              onClick={handleConvertToRecurring}
              disabled={convertingRecurring}
            >
              <Repeat size={12} />
              Convert to Recurring
            </button>
            <button
              className="block-btn flex items-center gap-2 text-xs"
              onClick={handleDuplicate}
            >
              <Copy size={12} />
              Duplicate Invoice
            </button>
            <button
              className="block-btn flex items-center gap-2 text-xs"
              onClick={handlePrintStatement}
            >
              <Printer size={12} />
              Print Statement
            </button>
          </div>
        </div>
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

      {/* PORTAL: share modal — token + expiry + regenerate / disable / preview. */}
      {showShareModal && invoice && (
        <PortalShareModal
          title={`Share invoice ${invoice.invoice_number}`}
          buildUrl={(token) => `${portalBaseUrl}/portal/${token}`}
          fetchInfo={() => api.invoiceTokenInfo(invoice.id)}
          generateToken={() => api.generateInvoiceToken(invoice.id)}
          regenerate={() => api.invoiceRegenerateToken(invoice.id)}
          disable={() => api.invoiceDisableToken(invoice.id)}
          previewNode={getInvoicePortalPreview(invoice, client)}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Invoice-specific Activity Timeline */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center gap-2">
          <Activity size={14} className="text-text-muted" />
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Invoice Activity Timeline
          </span>
        </div>
        {activityLog.length === 0 ? (
          <div className="p-6 text-center text-sm text-text-muted">
            No activity logged yet.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {activityLog.map((a) => {
              const ICONS: Record<string, React.ReactNode> = {
                sent: <Send size={12} />,
                viewed: <Eye size={12} />,
                paid: <DollarSign size={12} />,
                payment_recorded: <DollarSign size={12} />,
                reminder_scheduled: <Bell size={12} />,
                reminder_sent: <Bell size={12} />,
                late_fee_applied: <DollarSign size={12} />,
                convert_to_recurring: <Repeat size={12} />,
                duplicate_created: <Copy size={12} />,
              };
              const COLORS: Record<string, string> = {
                sent: '#3b82f6',
                viewed: '#8b5cf6',
                paid: '#22c55e',
                payment_recorded: '#22c55e',
                reminder_scheduled: '#f59e0b',
                reminder_sent: '#f59e0b',
                late_fee_applied: '#ef4444',
                convert_to_recurring: '#3b82f6',
                duplicate_created: '#6b7280',
              };
              const icon = ICONS[a.activity_type] || <Activity size={12} />;
              const color = COLORS[a.activity_type] || '#6b7280';
              return (
                <li
                  key={a.id}
                  style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--color-border-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                      background: `${color}22`, color, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="text-xs text-text-primary font-medium">
                      {a.activity_type.replace(/_/g, ' ')}
                      {a.user_name && (
                        <span className="text-text-muted font-normal"> · {a.user_name}</span>
                      )}
                    </div>
                    {a.description && (
                      <div className="text-[11px] text-text-secondary truncate">{a.description}</div>
                    )}
                  </div>
                  <div className="text-[11px] text-text-muted whitespace-nowrap">
                    {a.created_at ? formatDate(a.created_at) : '—'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Cross-entity panels — related records + activity timeline ── */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="invoice" entityId={invoiceId} hide={['lines', 'payments']} />
        <EntityTimeline entityType="invoices" entityId={invoiceId} />
      </div>
    </div>
  );
};

export default InvoiceDetail;
