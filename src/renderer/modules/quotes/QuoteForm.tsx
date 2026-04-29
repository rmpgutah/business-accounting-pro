import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, FileCheck, Plus, Trash2, ArrowRightCircle, Printer, Download, Eye } from 'lucide-react';
import api from '../../lib/api';
import { required, validateForm } from '../../lib/validation';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { FieldLabel } from '../../components/FieldLabel';
import { formatCurrency, roundCents } from '../../lib/format';
import { todayLocal, toLocalDateString } from '../../lib/date-helpers';
import { generateInvoiceHTML, InvoiceSettings } from '../../lib/print-templates';

// ─── Types ──────────────────────────────────────────────
interface LineItem {
  id: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  amount: number;
  sort_order: number;
}

interface QuoteFormData {
  quote_number: string;
  client_id: string;
  status: string;
  issue_date: string;
  valid_until: string;
  discount_amount: string;
  notes: string;
  terms: string;
  // Metadata
  po_number: string;
  job_reference: string;
  sales_rep_id: string;
  tags: string;
  currency: string;
  internal_notes: string;
  // Pipeline
  probability: string;
  expected_close_date: string;
  deal_size_category: string;
  follow_up_date: string;
  lost_reason: string;
}

interface Client {
  id: string;
  name: string;
}

interface SalesRep {
  id: string;
  name: string;
}

interface ActivityLogRow {
  id: string;
  quote_id: string;
  activity_type: string;
  description: string;
  user_name: string;
  created_at: string;
}

interface QuoteFormProps {
  quoteId?: string | null;
  onBack: () => void;
  onSaved: () => void;
}

// ─── Helpers ────────────────────────────────────────────
let _lineCounter = 0;
function tempId(): string {
  return `_new_${++_lineCounter}_${Date.now()}`;
}

function calcLineAmount(qty: string, price: string, taxRate: string): number {
  const q = parseFloat(qty) || 0;
  const p = parseFloat(price) || 0;
  const t = parseFloat(taxRate) || 0;
  const base = q * p;
  return base + base * (t / 100);
}

const emptyForm: QuoteFormData = {
  quote_number: '',
  client_id: '',
  status: 'draft',
  // DATE: Item #2 — local-time today, not UTC. Late-evening MT users would otherwise pre-fill tomorrow.
  issue_date: todayLocal(),
  valid_until: toLocalDateString(new Date(Date.now() + 30 * 86400000)),
  discount_amount: '0',
  notes: '',
  terms: '',
  // Metadata
  po_number: '',
  job_reference: '',
  sales_rep_id: '',
  tags: '',
  currency: 'USD',
  internal_notes: '',
  // Pipeline
  probability: '50',
  expected_close_date: '',
  deal_size_category: '',
  follow_up_date: '',
  lost_reason: '',
};

function emptyLine(): LineItem {
  return {
    id: tempId(),
    description: '',
    quantity: '1',
    unit_price: '0',
    tax_rate: '0',
    amount: 0,
    sort_order: 0,
  };
}

// ─── Component ──────────────────────────────────────────
const QuoteForm: React.FC<QuoteFormProps> = ({ quoteId, onBack, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const setModule = useAppStore((s) => s.setModule);
  const [form, setForm] = useState<QuoteFormData>({ ...emptyForm });
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [clients, setClients] = useState<Client[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogRow[]>([]);
  const [originalStatus, setOriginalStatus] = useState<string>('draft');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [convertSuccess, setConvertSuccess] = useState('');
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);

  // Load invoice settings (logo, accent color, column config) so the quote
  // PDF picks up the same branding as invoices.
  useEffect(() => {
    api.getInvoiceSettings()
      .then((r: any) => { if (r && !r.error) setInvoiceSettings(r); })
      .catch(() => {});
  }, []);

  const isEditing = !!quoteId;

  // ─── Load data ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const [cliData, repData, nextNum] = await Promise.all([
          api.query('clients', { company_id: activeCompany.id }),
          api
            .rawQuery(
              `SELECT id, name FROM users WHERE company_id = ? OR company_id IS NULL ORDER BY name`,
              [activeCompany.id]
            )
            .catch(() => []),
          quoteId ? Promise.resolve('') : api.quotesNextNumber(),
        ]);
        if (cancelled) return;

        setClients(Array.isArray(cliData) ? cliData : []);
        setSalesReps(Array.isArray(repData) ? (repData as SalesRep[]) : []);

        if (quoteId) {
          const existing = await api.get('quotes', quoteId);
          if (existing && !cancelled) {
            setForm({
              quote_number: existing.quote_number || '',
              client_id: existing.client_id || '',
              status: existing.status || 'draft',
              issue_date: existing.issue_date || emptyForm.issue_date,
              valid_until: existing.valid_until || '',
              discount_amount: String(existing.discount_amount ?? 0),
              notes: existing.notes || '',
              terms: existing.terms || '',
              po_number: existing.po_number || '',
              job_reference: existing.job_reference || '',
              sales_rep_id: existing.sales_rep_id || '',
              tags: existing.tags || '',
              currency: existing.currency || 'USD',
              internal_notes: existing.internal_notes || '',
              probability:
                existing.probability !== undefined && existing.probability !== null
                  ? String(existing.probability)
                  : '50',
              expected_close_date: existing.expected_close_date || '',
              deal_size_category: existing.deal_size_category || '',
              follow_up_date: existing.follow_up_date || '',
              lost_reason: existing.lost_reason || '',
            });
            setOriginalStatus(existing.status || 'draft');

            // Load line items + activity log
            const [lineData, actData] = await Promise.all([
              api.rawQuery(
                'SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY sort_order',
                [quoteId]
              ),
              api
                .rawQuery(
                  'SELECT * FROM quote_activity_log WHERE quote_id = ? ORDER BY created_at DESC LIMIT 5',
                  [quoteId]
                )
                .catch(() => []),
            ]);
            if (Array.isArray(lineData) && lineData.length > 0) {
              setLines(
                lineData.map((l: any) => ({
                  id: l.id,
                  description: l.description || '',
                  quantity: String(l.quantity ?? 1),
                  unit_price: String(l.unit_price ?? 0),
                  tax_rate: String(l.tax_rate ?? 0),
                  amount: l.amount || 0,
                  sort_order: l.sort_order || 0,
                }))
              );
            }
            setActivityLog(Array.isArray(actData) ? (actData as ActivityLogRow[]) : []);
          }
        } else {
          setForm((prev) => ({ ...prev, quote_number: nextNum || '' }));
        }
      } catch (err) {
        console.error('Failed to load quote form data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [quoteId, activeCompany]);

  // ─── Line item handlers ───────────────────────────────
  const updateLine = useCallback((index: number, field: keyof LineItem, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[index], [field]: value };
      line.amount = calcLineAmount(line.quantity, line.unit_price, line.tax_rate);
      next[index] = line;
      return next;
    });
  }, []);

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, { ...emptyLine(), sort_order: prev.length }]);
  }, []);

  const removeLine = useCallback((index: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  // ─── Totals ───────────────────────────────────────────
  // Per-line rounded then summed so the totals match the printed line amounts
  // exactly. Same convention as InvoiceForm — quote→invoice conversion will
  // round-trip without 1¢ drift.
  const subtotal = lines.reduce((sum, l) => {
    const q = parseFloat(l.quantity) || 0;
    const p = parseFloat(l.unit_price) || 0;
    return sum + roundCents(q * p);
  }, 0);

  const taxAmount = lines.reduce((sum, l) => {
    const q = parseFloat(l.quantity) || 0;
    const p = parseFloat(l.unit_price) || 0;
    const t = parseFloat(l.tax_rate) || 0;
    return sum + roundCents(q * p * (t / 100));
  }, 0);

  const discountAmt = roundCents(parseFloat(form.discount_amount) || 0);
  const grandTotal = roundCents(subtotal + taxAmount - discountAmt);

  // ─── Form change ──────────────────────────────────────
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // ─── Submit ───────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const checks: Array<string | null> = [
      required(form.quote_number, 'Quote number'),
      required(form.issue_date, 'Issue date'),
      required(form.client_id, 'Client'),
    ];
    // Date order validation
    if (form.valid_until && form.issue_date && form.valid_until < form.issue_date) {
      checks.push('Valid until date must be on or after the issue date');
    }
    // Ensure at least one line has a description
    const hasLine = lines.some((l) => l.description.trim().length > 0);
    if (!hasLine) checks.push('At least one line item with a description is required');
    // Tax rate sanity
    for (const l of lines) {
      const t = parseFloat(l.tax_rate) || 0;
      if (t < 0 || t > 100) {
        checks.push('Tax rate must be between 0 and 100');
        break;
      }
      if ((parseFloat(l.quantity) || 0) < 0) {
        checks.push('Quantity cannot be negative');
        break;
      }
      if ((parseFloat(l.unit_price) || 0) < 0) {
        checks.push('Unit price cannot be negative');
        break;
      }
    }
    // Discount cannot exceed subtotal+tax
    const discountVal = parseFloat(form.discount_amount) || 0;
    if (discountVal < 0) checks.push('Discount cannot be negative');
    if (discountVal > subtotal + taxAmount) {
      checks.push('Discount cannot exceed subtotal plus tax');
    }

    const validationErrors = validateForm(checks);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    setSaving(true);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const quotePayload: Record<string, any> = {
        quote_number: form.quote_number.trim(),
        client_id: form.client_id || null,
        status: form.status,
        issue_date: form.issue_date,
        valid_until: form.valid_until || null,
        subtotal,
        tax_amount: taxAmount,
        discount_amount: discountAmt,
        total: grandTotal,
        notes: form.notes.trim(),
        terms: form.terms.trim(),
        // Metadata
        po_number: form.po_number.trim() || null,
        job_reference: form.job_reference.trim() || null,
        sales_rep_id: form.sales_rep_id || null,
        tags: form.tags.trim() || null,
        currency: form.currency || 'USD',
        internal_notes: form.internal_notes.trim() || null,
        // Pipeline
        probability:
          form.probability === '' ? null : Math.max(0, Math.min(100, parseFloat(form.probability) || 0)),
        expected_close_date: form.expected_close_date || null,
        deal_size_category: form.deal_size_category || null,
        follow_up_date: form.follow_up_date || null,
        lost_reason: form.status === 'rejected' ? form.lost_reason.trim() || null : null,
      };

      // Stamp status-transition timestamps
      if (form.status === 'sent' && originalStatus !== 'sent') {
        quotePayload.sent_date = today;
      }
      if (
        (form.status === 'accepted' || form.status === 'converted') &&
        originalStatus !== 'accepted' &&
        originalStatus !== 'converted'
      ) {
        quotePayload.won_date = today;
      }

      let savedQuoteId = quoteId;

      if (isEditing && quoteId) {
        await api.update('quotes', quoteId, quotePayload);

        // Delete old line items and re-insert
        const oldLines = await api.rawQuery(
          'SELECT id FROM quote_line_items WHERE quote_id = ?',
          [quoteId]
        );
        if (Array.isArray(oldLines)) {
          for (const ol of oldLines) {
            await api.remove('quote_line_items', ol.id);
          }
        }
      } else {
        const record = await api.create('quotes', quotePayload);
        savedQuoteId = record.id;
      }

      // Log activity
      try {
        if (!isEditing) {
          await api.create('quote_activity_log', {
            quote_id: savedQuoteId,
            activity_type: 'created',
            description: `Quote ${form.quote_number} created`,
          });
        } else if (form.status !== originalStatus) {
          let actType = 'updated';
          let desc = `Status changed: ${originalStatus} → ${form.status}`;
          if (form.status === 'sent') {
            actType = 'sent';
            desc = 'Quote sent to client';
          } else if (form.status === 'accepted') {
            actType = 'accepted';
            desc = 'Quote accepted';
          } else if (form.status === 'rejected') {
            actType = 'rejected';
            desc = form.lost_reason
              ? `Quote rejected: ${form.lost_reason}`
              : 'Quote rejected';
          }
          await api.create('quote_activity_log', {
            quote_id: savedQuoteId,
            activity_type: actType,
            description: desc,
          });
        } else {
          await api.create('quote_activity_log', {
            quote_id: savedQuoteId,
            activity_type: 'updated',
            description: 'Quote updated',
          });
        }
      } catch (logErr) {
        console.warn('Activity log write failed:', logErr);
      }

      // Insert line items
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l.description.trim()) continue;
        const q = parseFloat(l.quantity) || 0;
        const p = parseFloat(l.unit_price) || 0;
        const t = parseFloat(l.tax_rate) || 0;
        // Persist subtotal+tax for the line, rounded once
        const amt = roundCents(q * p + q * p * (t / 100));
        await api.create('quote_line_items', {
          quote_id: savedQuoteId,
          description: l.description.trim(),
          quantity: q,
          unit_price: p,
          tax_rate: t,
          amount: amt,
          sort_order: i,
        });
      }

      onSaved();
    } catch (err: any) {
      // VISIBILITY: surface save-quote errors instead of swallowing
      console.error('Failed to save quote:', err);
      setErrors([err?.message ?? String(err)]);
    } finally {
      setSaving(false);
    }
  };

  // ─── Convert to Invoice ───────────────────────────────
  const handleConvert = async () => {
    if (!quoteId) return;
    try {
      const result = await api.quotesConvertToInvoice(quoteId);
      if (result?.invoice_id) {
        setConvertSuccess('Converted to invoice successfully.');
        setForm((prev) => ({ ...prev, status: 'converted' }));
        try {
          await api.create('quote_activity_log', {
            quote_id: quoteId,
            activity_type: 'converted',
            description: 'Converted to Invoice',
          });
        } catch {
          /* non-fatal */
        }
        // Offer to navigate to the new invoice
        if (window.confirm('Quote converted to invoice. Go to Invoicing now?')) {
          setModule('invoicing');
        }
      }
    } catch (err: any) {
      // VISIBILITY: surface convert-quote errors instead of swallowing
      console.error('Convert failed:', err);
      setErrors([`Failed to convert quote to invoice: ${err?.message ?? String(err)}`]);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  const isConverted = form.status === 'converted';

  // Build the printable HTML payload — reuses the customer-facing PDF
  // template (generateInvoiceHTML) and switches its branch via
  // invoice_type:'quote' so we get the quote-specific signature block,
  // validity callout, and "QUOTE" doc-type label.
  const buildQuoteHTML = async (): Promise<string> => {
    if (!activeCompany) return '';
    const client = form.client_id ? await api.get('clients', form.client_id) : null;
    // Compute totals from lines so the totals card / multi-rate tax breakdown
    // are accurate (the form stores raw strings; the template needs numbers).
    const subtotal = lines.reduce((s, l) => {
      const q = Number(l.quantity) || 0;
      const p = Number(l.unit_price) || 0;
      return s + q * p;
    }, 0);
    const taxAmount = lines.reduce((s, l) => {
      const q = Number(l.quantity) || 0;
      const p = Number(l.unit_price) || 0;
      const t = Number(l.tax_rate) || 0;
      return s + (q * p) * (t / 100);
    }, 0);
    const discountAmount = Number(form.discount_amount) || 0;
    const total = roundCents(subtotal + taxAmount - discountAmount);
    const quotePayload = {
      ...form,
      invoice_type: 'quote',
      document_type: 'quote',
      invoice_number: form.quote_number, // template falls back to invoice_number
      subtotal,
      tax_amount: taxAmount,
      discount_amount: discountAmount,
      total,
      amount_paid: 0,
      currency: 'USD',
      // Template reads invoice.valid_until directly — already on form
      // Map quote.expiry_date → due_date so the template's "Valid until"
      // logic picks it up without requiring schema changes.
      due_date: (form as any).expiry_date || (form as any).valid_until || form.issue_date,
    };
    const lineItems = lines.map((l, i) => ({
      id: l.id,
      description: l.description,
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
      amount: Number(l.amount) || 0,
      tax_rate: Number(l.tax_rate) || 0,
      row_type: 'item',
      sort_order: i,
    }));
    return generateInvoiceHTML(
      quotePayload as any,
      activeCompany,
      client ?? null,
      lineItems as any,
      invoiceSettings || undefined,
    );
  };

  const handlePreview = async () => {
    const html = await buildQuoteHTML();
    if (!html) return;
    await (api as any).printPreview(html, `Quote ${form.quote_number || ''}`);
  };
  const handlePrint = async () => {
    const html = await buildQuoteHTML();
    if (!html) return;
    await (api as any).print(html);
  };
  const handleSavePDF = async () => {
    const html = await buildQuoteHTML();
    if (!html) return;
    await (api as any).saveToPDF(html, `Quote-${form.quote_number || 'draft'}`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-2 px-3 py-2" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex items-center gap-2">
            <FileCheck size={18} className="text-accent-blue" />
            <h2 className="module-title text-text-primary">
              {isEditing ? 'Edit Quote' : 'New Quote'}
            </h2>
          </div>
        </div>
        {isEditing && (
          <div className="flex items-center gap-2 mr-2">
            <button type="button" onClick={handlePreview} className="block-btn flex items-center gap-1.5" title="Preview">
              <Eye size={14} /> Preview
            </button>
            <button type="button" onClick={handlePrint} className="block-btn flex items-center gap-1.5" title="Print">
              <Printer size={14} /> Print
            </button>
            <button type="button" onClick={handleSavePDF} className="block-btn flex items-center gap-1.5" title="Save as PDF">
              <Download size={14} /> PDF
            </button>
          </div>
        )}
        {isEditing && !isConverted && (form.status === 'accepted' || form.status === 'sent' || form.status === 'draft') && (
          <button
            type="button"
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold"
            onClick={handleConvert}
            style={{
              borderRadius: '6px',
              background: 'rgba(59,130,246,0.12)',
              border: '1px solid rgba(59,130,246,0.25)',
              color: '#3b82f6',
              cursor: 'pointer',
            }}
          >
            <ArrowRightCircle size={16} />
            Convert to Invoice
          </button>
        )}
      </div>

      {/* Convert success notice */}
      {convertSuccess && (
        <div
          style={{
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid #22c55e',
            borderRadius: '6px',
            padding: '12px 16px',
            color: '#22c55e',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          {convertSuccess}
        </div>
      )}

      {/* Validation Errors */}
      {errors.length > 0 && (
        <div
          style={{
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            padding: '12px 16px',
          }}
        >
          <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
            {errors.map((err, i) => (
              <li key={i} style={{ color: '#ef4444', fontSize: '13px', lineHeight: '1.6' }}>
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="block-card p-6">
        <div className="grid grid-cols-3 gap-5">
          {/* Quote Number */}
          <div>
            <FieldLabel label="Quote Number" required tooltip="Unique identifier for this quote" />
            <input
              type="text"
              name="quote_number"
              className="block-input"
              value={form.quote_number}
              onChange={handleChange}
              required
            />
          </div>

          {/* Client */}
          <div>
            <FieldLabel label="Client" tooltip="Select the client this quote is for" />
            <select
              name="client_id"
              className="block-select"
              value={form.client_id}
              onChange={handleChange}
            >
              <option value="">Select client...</option>
              {[...clients]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <FieldLabel label="Status" tooltip="Current status of this quote" />
            <select
              name="status"
              className="block-select"
              value={form.status}
              onChange={handleChange}
              disabled={isConverted}
            >
              {/* Sorted alphabetically per app-wide UX directive (originally workflow order: Draft → Sent → Accepted → Converted) */}
              <optgroup label="Active">
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
              </optgroup>
              <optgroup label="Closed">
                <option value="accepted">Accepted</option>
                {isConverted && <option value="converted">Converted</option>}
                <option value="expired">Expired</option>
                <option value="rejected">Rejected</option>
              </optgroup>
            </select>
          </div>

          {/* Issue Date */}
          <div>
            <FieldLabel label="Issue Date" required tooltip="Date this quote was created" />
            <input
              type="date"
              name="issue_date"
              className="block-input"
              value={form.issue_date}
              onChange={handleChange}
              required
            />
          </div>

          {/* Valid Until */}
          <div>
            <FieldLabel label="Valid Until" tooltip="Expiration date for this quote" />
            <input
              type="date"
              name="valid_until"
              className="block-input"
              value={form.valid_until}
              onChange={handleChange}
              // DATE: Item #3 — prevent picking expiry before issue date.
              min={form.issue_date || undefined}
            />
            {/* Validity quick-pick buttons */}
            <div className="flex gap-1 mt-2">
              {[7, 14, 30, 60, 90].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => {
                    const base = form.issue_date
                      ? new Date(form.issue_date)
                      : new Date();
                    const newDate = new Date(base.getTime() + days * 86400000);
                    setForm((prev) => ({
                      ...prev,
                      valid_until: toLocalDateString(newDate),
                    }));
                  }}
                  className="text-[10px] font-semibold px-2 py-1 text-text-secondary hover:text-text-primary"
                  style={{
                    background: 'rgba(59,130,246,0.08)',
                    border: '1px solid rgba(59,130,246,0.20)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                  title={`Set valid_until to ${days} days from issue`}
                >
                  +{days}d
                </button>
              ))}
            </div>
          </div>

          {/* Discount */}
          <div>
            <FieldLabel label="Discount Amount" tooltip="Flat discount subtracted from the total" />
            <input
              type="number"
              name="discount_amount"
              step="0.01"
              min="0"
              className="block-input"
              placeholder="0.00"
              value={form.discount_amount}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* ─── Quote Metadata Card ─────────────────────────── */}
        <div
          className="mt-6 p-4"
          style={{
            background: 'rgba(18,19,24,0.40)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '6px',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Quote Metadata
            </span>
          </div>
          <div className="grid grid-cols-3 gap-5">
            <div>
              <FieldLabel label="PO Number" tooltip="Client purchase order reference" />
              <input
                type="text"
                name="po_number"
                className="block-input"
                value={form.po_number}
                onChange={handleChange}
                placeholder="e.g. PO-2024-001"
              />
            </div>
            <div>
              <FieldLabel label="Job Reference" tooltip="Internal job code or project reference" />
              <input
                type="text"
                name="job_reference"
                className="block-input"
                value={form.job_reference}
                onChange={handleChange}
                placeholder="e.g. JOB-456"
              />
            </div>
            <div>
              <FieldLabel label="Sales Rep" tooltip="User responsible for this opportunity" />
              <select
                name="sales_rep_id"
                className="block-select"
                value={form.sales_rep_id}
                onChange={handleChange}
              >
                <option value="">Unassigned</option>
                {salesReps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel label="Tags" tooltip="Comma-separated tags for filtering" />
              <input
                type="text"
                name="tags"
                className="block-input"
                value={form.tags}
                onChange={handleChange}
                placeholder="hot, q4, retainer"
              />
            </div>
            <div>
              <FieldLabel label="Currency" tooltip="Currency code for this quote" />
              <select
                name="currency"
                className="block-select"
                value={form.currency}
                onChange={handleChange}
              >
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="CAD">CAD — Canadian Dollar</option>
                <option value="AUD">AUD — Australian Dollar</option>
                <option value="ZAR">ZAR — South African Rand</option>
                <option value="JPY">JPY — Japanese Yen</option>
              </select>
            </div>
            <div>
              <FieldLabel label="Internal Notes" tooltip="Notes hidden from the client" />
              <textarea
                name="internal_notes"
                className="block-input"
                rows={1}
                value={form.internal_notes}
                onChange={handleChange}
                placeholder="Internal-only context..."
              />
            </div>
          </div>
        </div>

        {/* ─── Sales Pipeline Card ─────────────────────────── */}
        <div
          className="mt-4 p-4"
          style={{
            background: 'rgba(18,19,24,0.40)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '6px',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Sales Pipeline
            </span>
          </div>
          <div className="grid grid-cols-3 gap-5">
            <div>
              <FieldLabel
                label={`Probability (${form.probability || 0}%)`}
                tooltip="Likelihood this quote will close"
              />
              <input
                type="range"
                name="probability"
                min="0"
                max="100"
                step="5"
                value={form.probability}
                onChange={handleChange}
                className="w-full"
                style={{ accentColor: '#3b82f6' }}
              />
              <div className="flex justify-between text-[9px] text-text-muted mt-1">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
            <div>
              <FieldLabel label="Expected Close Date" tooltip="When you expect this quote to close" />
              <input
                type="date"
                name="expected_close_date"
                className="block-input"
                value={form.expected_close_date}
                onChange={handleChange}
              />
            </div>
            <div>
              <FieldLabel label="Deal Size" tooltip="Categorize by deal size for analytics" />
              <select
                name="deal_size_category"
                className="block-select"
                value={form.deal_size_category}
                onChange={handleChange}
              >
                <option value="">— Select —</option>
                <option value="small">Small (under $5k)</option>
                <option value="medium">Medium ($5k-25k)</option>
                <option value="large">Large ($25k-100k)</option>
                <option value="enterprise">Enterprise ($100k+)</option>
              </select>
            </div>
            <div>
              <FieldLabel
                label="Follow-Up Date"
                tooltip="Reminder to circle back with the client"
              />
              <input
                type="date"
                name="follow_up_date"
                className="block-input"
                value={form.follow_up_date}
                onChange={handleChange}
              />
            </div>
            {form.status === 'rejected' && (
              <div className="col-span-2">
                <FieldLabel label="Lost Reason" tooltip="Why was this quote rejected?" />
                <input
                  type="text"
                  name="lost_reason"
                  className="block-input"
                  value={form.lost_reason}
                  onChange={handleChange}
                  placeholder="e.g. Price, Timing, Competitor"
                />
              </div>
            )}
          </div>
        </div>

        {/* ─── Line Items Section ──────────────────────────── */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Line Items
            </span>
            <button
              type="button"
              className="block-btn flex items-center gap-1 text-xs"
              onClick={addLine}
            >
              <Plus size={14} />
              Add Line
            </button>
          </div>

          <div className="block-card p-0 overflow-hidden" style={{ background: 'rgba(14,15,20,0.40)' }}>
            <table className="block-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Description</th>
                  <th style={{ width: '12%' }}>Qty</th>
                  <th style={{ width: '15%' }}>Unit Price</th>
                  <th style={{ width: '12%' }}>Tax %</th>
                  <th style={{ width: '15%' }} className="text-right">
                    Amount
                  </th>
                  <th style={{ width: '6%' }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.id}>
                    <td>
                      <input
                        type="text"
                        className="block-input"
                        placeholder="Item description"
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="block-input text-right"
                        step="0.01"
                        min="0"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="block-input text-right"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={line.unit_price}
                        onChange={(e) => updateLine(idx, 'unit_price', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="block-input text-right"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={line.tax_rate}
                        onChange={(e) => updateLine(idx, 'tax_rate', e.target.value)}
                      />
                    </td>
                    <td className="text-right font-mono text-text-primary text-sm">
                      {formatCurrency(calcLineAmount(line.quantity, line.unit_price, line.tax_rate))}
                    </td>
                    <td className="text-center">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="p-1 text-text-muted hover:text-accent-expense transition-colors"
                          title="Remove line"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end mt-4">
            <div
              className="w-72 space-y-2 p-4"
              style={{
                background: 'rgba(18,19,24,0.60)',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div className="flex justify-between text-sm text-text-secondary">
                <span>Subtotal</span>
                <span className="font-mono">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-text-secondary">
                <span>Tax</span>
                <span className="font-mono">{formatCurrency(taxAmount)}</span>
              </div>
              {discountAmt > 0 && (
                <div className="flex justify-between text-sm text-accent-expense">
                  <span>Discount</span>
                  <span className="font-mono">-{formatCurrency(discountAmt)}</span>
                </div>
              )}
              <div
                className="flex justify-between text-sm font-bold text-text-primary pt-2 mt-2"
                style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span>Total</span>
                <span className="font-mono">{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes & Terms */}
        <div className="grid grid-cols-2 gap-5 mt-6">
          <div>
            <FieldLabel label="Notes" tooltip="Internal notes or client-facing remarks" />
            <textarea
              name="notes"
              className="block-input"
              rows={3}
              placeholder="Notes to the client..."
              value={form.notes}
              onChange={handleChange}
            />
          </div>
          <div>
            <FieldLabel label="Terms & Conditions" tooltip="Payment terms, warranty info, etc." />
            <textarea
              name="terms"
              className="block-input"
              rows={3}
              placeholder="Terms and conditions..."
              value={form.terms}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end mt-6 pt-4 border-t border-border-primary">
          <button type="button" className="block-btn mr-3" onClick={onBack}>
            Cancel
          </button>
          <button
            type="submit"
            className="block-btn-primary flex items-center gap-2"
            disabled={saving || isConverted}
          >
            {saving ? 'Saving...' : isEditing ? 'Update Quote' : 'Save Quote'}
          </button>
        </div>
      </form>

      {/* ─── Activity Log (last 5) ───────────────────────── */}
      {isEditing && (
        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Recent Activity
            </span>
            <span className="text-[10px] text-text-muted">
              Last {activityLog.length} entr{activityLog.length === 1 ? 'y' : 'ies'}
            </span>
          </div>
          {activityLog.length === 0 ? (
            <div className="text-xs text-text-muted py-4 text-center">No activity yet</div>
          ) : (
            <ul className="space-y-2">
              {activityLog.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-2 text-xs"
                  style={{
                    borderLeft: '2px solid rgba(255,255,255,0.08)',
                    paddingLeft: 8,
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-text-secondary">
                      <span className="font-semibold text-text-primary capitalize">
                        {a.activity_type.replace(/_/g, ' ')}
                      </span>
                      {a.description && <span className="ml-2">{a.description}</span>}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {new Date(a.created_at).toLocaleString()}
                      {a.user_name ? ` · ${a.user_name}` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default QuoteForm;
