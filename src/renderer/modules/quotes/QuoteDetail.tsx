import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Edit,
  Send,
  Printer,
  Eye,
  Mail,
  ArrowRightCircle,
  Copy,
  Trash2,
  Clock,
  Target,
  DollarSign,
  CalendarDays,
  Plus,
  CheckCircle2,
  XCircle,
  FileText,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import { generateInvoiceHTML, InvoiceSettings } from '../../lib/print-templates';

// ─── Types ──────────────────────────────────────────────
interface Quote {
  id: string;
  quote_number: string;
  client_id: string | null;
  status: string;
  issue_date: string;
  valid_until: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  shipping_amount?: number;
  total: number;
  notes: string;
  terms: string;
  po_number?: string;
  job_reference?: string;
  internal_notes?: string;
  currency?: string;
  exchange_rate?: number;
  sales_rep_id?: string | null;
  deal_size_category?: string;
  probability?: number;
  expected_close_date?: string;
  lost_reason?: string;
  won_date?: string;
  sent_date?: string;
  viewed_date?: string;
  follow_up_date?: string;
  tags?: string;
  parent_quote_id?: string | null;
  revision_number?: number;
}

interface LineItem {
  id: string;
  description: string;
  item_code?: string;
  quantity: number;
  unit_price: number;
  unit_label?: string;
  tax_rate: number;
  tax_rate_override?: number;
  tax_amount?: number;
  discount_pct?: number;
  amount: number;
  row_type?: string;
  sort_order: number;
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

interface Activity {
  id: string;
  quote_id: string;
  activity_type: string;
  description: string;
  user_name: string;
  created_at: string;
}

interface QuoteDetailProps {
  quoteId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

// ─── KPI Card ───────────────────────────────────────────
const KpiCard: React.FC<{
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: string;
}> = ({ label, value, hint, icon, accent = '#3b82f6' }) => (
  <div className="block-card p-4" style={{ borderRadius: '6px' }}>
    <div className="flex items-start justify-between mb-2">
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
      {icon && <span style={{ color: accent }}>{icon}</span>}
    </div>
    <div className="text-xl font-bold text-text-primary font-mono">{value}</div>
    {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
  </div>
);

const activityIcon = (t: string): React.ReactNode => {
  switch (t) {
    case 'created':
      return <Plus size={12} className="text-accent-blue" />;
    case 'sent':
      return <Send size={12} className="text-accent-blue" />;
    case 'viewed':
      return <Eye size={12} className="text-accent-info" />;
    case 'accepted':
    case 'converted':
      return <CheckCircle2 size={12} className="text-accent-income" />;
    case 'rejected':
    case 'expired':
      return <XCircle size={12} className="text-accent-expense" />;
    default:
      return <Clock size={12} className="text-text-muted" />;
  }
};

// ─── Main Component ─────────────────────────────────────
const QuoteDetail: React.FC<QuoteDetailProps> = ({ quoteId, onBack, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const setModule = useAppStore((s) => s.setModule);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [salesRepName, setSalesRepName] = useState<string>('');
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Load invoice settings for branding
  useEffect(() => {
    api
      .getInvoiceSettings()
      .then((r: any) => {
        if (r && !r.error) setInvoiceSettings(r);
      })
      .catch(() => {});
  }, []);

  // ─── Load data ────────────────────────────────────────
  const load = useCallback(async () => {
    if (!quoteId) return;
    setLoading(true);
    setError('');
    try {
      const q = (await api.get('quotes', quoteId)) as Quote;
      if (!q) {
        setError('Quote not found');
        setLoading(false);
        return;
      }
      setQuote(q);

      const [lineRows, clientRow, actRows, repRow] = await Promise.all([
        api.rawQuery(
          'SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY sort_order',
          [quoteId]
        ),
        q.client_id ? api.get('clients', q.client_id) : Promise.resolve(null),
        api.rawQuery(
          'SELECT * FROM quote_activity_log WHERE quote_id = ? ORDER BY created_at DESC LIMIT 50',
          [quoteId]
        ),
        q.sales_rep_id
          ? api.rawQuery('SELECT name FROM users WHERE id = ?', [q.sales_rep_id])
          : Promise.resolve([]),
      ]);

      setLines(Array.isArray(lineRows) ? (lineRows as LineItem[]) : []);
      setClient((clientRow as Client) || null);
      setActivity(Array.isArray(actRows) ? (actRows as Activity[]) : []);
      const reps = Array.isArray(repRow) ? repRow : [];
      setSalesRepName(reps[0]?.name || '');
    } catch (err: any) {
      console.error('Failed to load quote detail:', err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    load();
  }, [load]);

  // ─── Build printable HTML ─────────────────────────────
  const buildHTML = useCallback(async (): Promise<string> => {
    if (!quote || !activeCompany) return '';
    const payload = {
      ...quote,
      invoice_type: 'quote',
      document_type: 'quote',
      invoice_number: quote.quote_number,
      amount_paid: 0,
      currency: quote.currency || 'USD',
      due_date: quote.valid_until || quote.issue_date,
    };
    const lineItems = lines.map((l, i) => ({
      id: l.id,
      description: l.description,
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
      amount: Number(l.amount) || 0,
      tax_rate: Number(l.tax_rate) || 0,
      row_type: l.row_type || 'item',
      sort_order: i,
    }));
    return generateInvoiceHTML(
      payload as any,
      activeCompany,
      client,
      lineItems as any,
      invoiceSettings || undefined
    );
  }, [quote, activeCompany, client, lines, invoiceSettings]);

  // ─── Action handlers ──────────────────────────────────
  const logActivity = async (
    activity_type: string,
    description: string
  ): Promise<void> => {
    try {
      await api.create('quote_activity_log', {
        quote_id: quoteId,
        activity_type,
        description,
      });
    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  };

  const handlePrint = async () => {
    const html = await buildHTML();
    if (!html) return;
    await api.print(html);
  };

  const handlePreview = async () => {
    const html = await buildHTML();
    if (!html) return;
    await api.printPreview(html, `Quote ${quote?.quote_number || ''}`);
  };

  const handleEmail = async () => {
    if (!quote) return;
    if (!client?.email) {
      alert('This client has no email on file.');
      return;
    }
    const subject = encodeURIComponent(`Quote ${quote.quote_number}`);
    const body = encodeURIComponent(
      `Hi ${client.name || ''},\n\nPlease find quote ${quote.quote_number} for ${formatCurrency(quote.total)} attached.\n\nBest regards,\n${activeCompany?.name || ''}`
    );
    window.location.href = `mailto:${client.email}?subject=${subject}&body=${body}`;
    await logActivity('emailed', `Email composed to ${client.email}`);
    load();
  };

  const handleSend = async () => {
    if (!quote) return;
    if (busy) return;
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.update('quotes', quote.id, {
        status: 'sent',
        sent_date: today,
      });
      await logActivity('sent', 'Quote marked as sent');
      await load();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConvert = async () => {
    if (!quote) return;
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.quotesConvertToInvoice(quote.id);
      if (result?.invoice_id) {
        await logActivity('converted', 'Converted to invoice');
        if (window.confirm('Quote converted to invoice. Go to Invoicing now?')) {
          setModule('invoicing');
        } else {
          await load();
        }
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async () => {
    if (!quote) return;
    if (busy) return;
    setBusy(true);
    try {
      const nextNum = await api.quotesNextNumber();
      const today = new Date().toISOString().slice(0, 10);
      const dupPayload: Record<string, any> = {
        quote_number: nextNum,
        client_id: quote.client_id,
        status: 'draft',
        issue_date: today,
        valid_until: quote.valid_until,
        subtotal: quote.subtotal,
        tax_amount: quote.tax_amount,
        discount_amount: quote.discount_amount,
        total: quote.total,
        notes: quote.notes,
        terms: quote.terms,
        po_number: quote.po_number,
        job_reference: quote.job_reference,
        internal_notes: quote.internal_notes,
        currency: quote.currency,
        sales_rep_id: quote.sales_rep_id,
        probability: quote.probability,
        deal_size_category: quote.deal_size_category,
        tags: quote.tags,
        parent_quote_id: quote.id,
      };
      const newQ = await api.create('quotes', dupPayload);
      // Duplicate line items
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await api.create('quote_line_items', {
          quote_id: newQ.id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          tax_rate: l.tax_rate,
          amount: l.amount,
          sort_order: i,
          item_code: l.item_code,
          row_type: l.row_type || 'item',
        });
      }
      await api.create('quote_activity_log', {
        quote_id: newQ.id,
        activity_type: 'created',
        description: `Duplicated from ${quote.quote_number}`,
      });
      onEdit(newQ.id);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!quote) return;
    if (!window.confirm(`Delete quote ${quote.quote_number}? This cannot be undone.`))
      return;
    if (busy) return;
    setBusy(true);
    try {
      // Delete line items first
      const items = (await api.rawQuery(
        'SELECT id FROM quote_line_items WHERE quote_id = ?',
        [quote.id]
      )) as Array<{ id: string }>;
      for (const it of items || []) {
        await api.remove('quote_line_items', it.id);
      }
      await api.remove('quotes', quote.id);
      onBack();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  // ─── Derived ──────────────────────────────────────────
  const validityInfo = useMemo(() => {
    if (!quote?.valid_until) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(quote.valid_until);
    exp.setHours(0, 0, 0, 0);
    const diffDays = Math.round((exp.getTime() - today.getTime()) / 86400000);
    return { diffDays, expDate: quote.valid_until };
  }, [quote?.valid_until]);

  const statusBadge = useMemo(() => {
    if (!quote) return null;
    return formatStatus(quote.status);
  }, [quote]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading quote...
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="space-y-4">
        <button className="block-btn flex items-center gap-2" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div
          style={{
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            padding: '12px 16px',
            color: '#ef4444',
            fontSize: '13px',
          }}
        >
          {error || 'Quote not available'}
        </div>
      </div>
    );
  }

  const validityValue =
    validityInfo === null
      ? '—'
      : validityInfo.diffDays >= 0
      ? `${validityInfo.diffDays} days`
      : `${Math.abs(validityInfo.diffDays)} days ago`;
  const validityHint =
    validityInfo === null
      ? 'No expiry'
      : validityInfo.diffDays >= 0
      ? `Expires ${formatDate(validityInfo.expDate)}`
      : `Expired ${formatDate(validityInfo.expDate)}`;
  const validityAccent =
    validityInfo === null
      ? '#6b7280'
      : validityInfo.diffDays < 0
      ? '#ef4444'
      : validityInfo.diffDays <= 7
      ? '#f59e0b'
      : '#22c55e';

  const isClosed = ['converted', 'rejected', 'expired'].includes(quote.status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-2 px-3 py-2" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-accent-blue" />
            <h2 className="module-title text-text-primary font-mono">
              {quote.quote_number}
            </h2>
            {statusBadge && (
              <span className={statusBadge.className} style={{ borderRadius: '6px' }}>
                {statusBadge.label}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={() => onEdit(quote.id)}
            disabled={busy}
          >
            <Edit size={14} /> Edit
          </button>
          {quote.status === 'draft' && (
            <button
              className="block-btn flex items-center gap-1.5"
              onClick={handleSend}
              disabled={busy}
              title="Mark as sent"
            >
              <Send size={14} /> Send
            </button>
          )}
          <button className="block-btn flex items-center gap-1.5" onClick={handlePreview}>
            <Eye size={14} /> Preview
          </button>
          <button className="block-btn flex items-center gap-1.5" onClick={handlePrint}>
            <Printer size={14} /> Print
          </button>
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={handleEmail}
            disabled={!client?.email}
            title={client?.email ? `Email ${client.email}` : 'No client email'}
          >
            <Mail size={14} /> Email
          </button>
          {!isClosed && (
            <button
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold"
              onClick={handleConvert}
              disabled={busy}
              style={{
                borderRadius: '6px',
                background: 'rgba(59,130,246,0.12)',
                border: '1px solid rgba(59,130,246,0.25)',
                color: '#3b82f6',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              <ArrowRightCircle size={14} /> Convert to Invoice
            </button>
          )}
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={handleDuplicate}
            disabled={busy}
          >
            <Copy size={14} /> Duplicate
          </button>
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={handleDelete}
            disabled={busy}
            style={{ color: '#ef4444' }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard
          label="Total"
          value={formatCurrency(quote.total)}
          hint={(quote.currency || 'USD').toUpperCase()}
          icon={<DollarSign size={14} />}
          accent="#3b82f6"
        />
        <KpiCard
          label="Status"
          value={statusBadge?.label || quote.status}
          hint={quote.sent_date ? `Sent ${formatDate(quote.sent_date)}` : `Issued ${formatDate(quote.issue_date)}`}
          icon={<Target size={14} />}
          accent="#8b5cf6"
        />
        <KpiCard
          label="Probability"
          value={typeof quote.probability === 'number' ? `${quote.probability}%` : '—'}
          hint={
            quote.expected_close_date
              ? `Close ${formatDate(quote.expected_close_date)}`
              : 'No close date'
          }
          icon={<Target size={14} />}
          accent="#22c55e"
        />
        <KpiCard
          label="Validity"
          value={validityValue}
          hint={validityHint}
          icon={<CalendarDays size={14} />}
          accent={validityAccent}
        />
      </div>

      {/* Validity countdown banner */}
      {validityInfo && validityInfo.diffDays >= 0 && validityInfo.diffDays <= 7 && quote.status === 'sent' && (
        <div
          style={{
            background: 'rgba(245,158,11,0.10)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: '6px',
            padding: '10px 14px',
            color: '#f59e0b',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          Expires in {validityInfo.diffDays} day{validityInfo.diffDays === 1 ? '' : 's'} — consider following up.
        </div>
      )}

      {/* Client + Meta */}
      <div className="grid grid-cols-2 gap-3">
        <div className="block-card p-4">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Client
          </span>
          <div className="mt-2 space-y-1 text-sm">
            <div className="text-text-primary font-semibold">
              {client?.name || '— No client —'}
            </div>
            {client?.email && (
              <div className="text-text-secondary text-xs">{client.email}</div>
            )}
            {client?.phone && (
              <div className="text-text-secondary text-xs">{client.phone}</div>
            )}
            {(client?.address_line1 || client?.city) && (
              <div className="text-text-muted text-xs">
                {client?.address_line1}
                {client?.city ? `, ${client.city}` : ''}
                {client?.state ? `, ${client.state}` : ''}{' '}
                {client?.zip || ''}
              </div>
            )}
          </div>
        </div>
        <div className="block-card p-4">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Quote Details
          </span>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Issue Date</span>
              <span className="text-text-secondary font-mono">
                {formatDate(quote.issue_date)}
              </span>
            </div>
            {quote.valid_until && (
              <div className="flex justify-between">
                <span className="text-text-muted">Valid Until</span>
                <span className="text-text-secondary font-mono">
                  {formatDate(quote.valid_until)}
                </span>
              </div>
            )}
            {quote.po_number && (
              <div className="flex justify-between">
                <span className="text-text-muted">PO Number</span>
                <span className="text-text-secondary font-mono">{quote.po_number}</span>
              </div>
            )}
            {quote.job_reference && (
              <div className="flex justify-between">
                <span className="text-text-muted">Job Reference</span>
                <span className="text-text-secondary">{quote.job_reference}</span>
              </div>
            )}
            {salesRepName && (
              <div className="flex justify-between">
                <span className="text-text-muted">Sales Rep</span>
                <span className="text-text-secondary">{salesRepName}</span>
              </div>
            )}
            {quote.deal_size_category && (
              <div className="flex justify-between">
                <span className="text-text-muted">Deal Size</span>
                <span className="text-text-secondary capitalize">
                  {quote.deal_size_category}
                </span>
              </div>
            )}
            {quote.tags && (
              <div className="flex justify-between">
                <span className="text-text-muted">Tags</span>
                <span className="text-text-secondary">{quote.tags}</span>
              </div>
            )}
            {quote.lost_reason && quote.status === 'rejected' && (
              <div className="flex justify-between">
                <span className="text-text-muted">Lost Reason</span>
                <span className="text-accent-expense">{quote.lost_reason}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary">
          <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
            Line Items ({lines.length})
          </span>
        </div>
        <table className="block-table">
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Description</th>
              <th style={{ width: '12%' }}>Item Code</th>
              <th style={{ width: '8%' }} className="text-right">Qty</th>
              <th style={{ width: '12%' }} className="text-right">Unit Price</th>
              <th style={{ width: '8%' }} className="text-right">Disc %</th>
              <th style={{ width: '8%' }} className="text-right">Tax %</th>
              <th style={{ width: '10%' }} className="text-right">Tax Amt</th>
              <th style={{ width: '10%' }} className="text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-text-muted py-6 text-xs">
                  No line items
                </td>
              </tr>
            ) : (
              lines.map((l) => {
                const taxRate =
                  typeof l.tax_rate_override === 'number' && l.tax_rate_override > 0
                    ? l.tax_rate_override
                    : l.tax_rate || 0;
                const base = (l.quantity || 0) * (l.unit_price || 0);
                const taxAmt =
                  typeof l.tax_amount === 'number' && l.tax_amount > 0
                    ? l.tax_amount
                    : base * (taxRate / 100);
                return (
                  <tr key={l.id}>
                    <td className="text-text-primary text-sm">{l.description}</td>
                    <td className="text-text-secondary text-xs font-mono">
                      {l.item_code || '—'}
                    </td>
                    <td className="text-right font-mono text-text-secondary">
                      {l.quantity}
                      {l.unit_label ? ` ${l.unit_label}` : ''}
                    </td>
                    <td className="text-right font-mono text-text-secondary">
                      {formatCurrency(l.unit_price)}
                    </td>
                    <td className="text-right font-mono text-text-muted">
                      {l.discount_pct ? `${l.discount_pct}%` : '—'}
                    </td>
                    <td className="text-right font-mono text-text-muted">{taxRate || 0}%</td>
                    <td className="text-right font-mono text-text-muted">
                      {formatCurrency(taxAmt)}
                    </td>
                    <td className="text-right font-mono text-text-primary font-semibold">
                      {formatCurrency(l.amount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Totals + Notes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="block-card p-4 space-y-3">
          {(quote.notes || quote.terms) && (
            <>
              {quote.notes && (
                <div>
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Notes
                  </span>
                  <p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">
                    {quote.notes}
                  </p>
                </div>
              )}
              {quote.terms && (
                <div>
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Terms
                  </span>
                  <p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">
                    {quote.terms}
                  </p>
                </div>
              )}
            </>
          )}
          {quote.internal_notes && (
            <div>
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Internal Notes
              </span>
              <p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">
                {quote.internal_notes}
              </p>
            </div>
          )}
          {!quote.notes && !quote.terms && !quote.internal_notes && (
            <div className="text-xs text-text-muted">No notes or terms</div>
          )}
        </div>

        <div
          className="block-card p-4 space-y-2"
          style={{ background: 'rgba(18,19,24,0.60)' }}
        >
          <div className="flex justify-between text-sm text-text-secondary">
            <span>Subtotal</span>
            <span className="font-mono">{formatCurrency(quote.subtotal)}</span>
          </div>
          {quote.discount_amount > 0 && (
            <div className="flex justify-between text-sm text-accent-expense">
              <span>Discount</span>
              <span className="font-mono">-{formatCurrency(quote.discount_amount)}</span>
            </div>
          )}
          {(quote.shipping_amount || 0) > 0 && (
            <div className="flex justify-between text-sm text-text-secondary">
              <span>Shipping</span>
              <span className="font-mono">{formatCurrency(quote.shipping_amount || 0)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-text-secondary">
            <span>Pre-tax</span>
            <span className="font-mono">
              {formatCurrency(
                quote.subtotal - (quote.discount_amount || 0) + (quote.shipping_amount || 0)
              )}
            </span>
          </div>
          <div className="flex justify-between text-sm text-text-secondary">
            <span>Tax</span>
            <span className="font-mono">{formatCurrency(quote.tax_amount)}</span>
          </div>
          <div
            className="flex justify-between text-sm font-bold text-text-primary pt-2 mt-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            <span>Total</span>
            <span className="font-mono">{formatCurrency(quote.total)}</span>
          </div>
        </div>
      </div>

      {/* Activity timeline */}
      <div className="block-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
            Activity Timeline
          </span>
          <span className="text-[10px] text-text-muted">{activity.length} entries</span>
        </div>
        {activity.length === 0 ? (
          <div className="text-xs text-text-muted py-4 text-center">No activity yet</div>
        ) : (
          <ul className="space-y-2">
            {activity.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-2 text-xs"
                style={{
                  borderLeft: '2px solid rgba(255,255,255,0.08)',
                  paddingLeft: 8,
                }}
              >
                <span className="mt-0.5">{activityIcon(a.activity_type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-text-secondary">
                    <span className="font-semibold text-text-primary capitalize">
                      {a.activity_type.replace(/_/g, ' ')}
                    </span>
                    {a.description && <span className="ml-2">{a.description}</span>}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {formatDate(a.created_at)}
                    {a.user_name ? ` · ${a.user_name}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default QuoteDetail;
