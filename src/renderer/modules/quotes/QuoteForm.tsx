import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, FileCheck, Plus, Trash2, ArrowRightCircle } from 'lucide-react';
import api from '../../lib/api';
import { required, validateForm } from '../../lib/validation';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { FieldLabel } from '../../components/FieldLabel';
import { formatCurrency } from '../../lib/format';

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
}

interface Client {
  id: string;
  name: string;
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
  issue_date: new Date().toISOString().split('T')[0],
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
  discount_amount: '0',
  notes: '',
  terms: '',
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
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [convertSuccess, setConvertSuccess] = useState('');

  const isEditing = !!quoteId;

  // ─── Load data ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const [cliData, nextNum] = await Promise.all([
          api.query('clients', { company_id: activeCompany.id }),
          quoteId ? Promise.resolve('') : api.quotesNextNumber(),
        ]);
        if (cancelled) return;

        setClients(Array.isArray(cliData) ? cliData : []);

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
            });

            // Load line items
            const lineData = await api.rawQuery(
              'SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY sort_order',
              [quoteId]
            );
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
  const subtotal = lines.reduce((sum, l) => {
    const q = parseFloat(l.quantity) || 0;
    const p = parseFloat(l.unit_price) || 0;
    return sum + q * p;
  }, 0);

  const taxAmount = lines.reduce((sum, l) => {
    const q = parseFloat(l.quantity) || 0;
    const p = parseFloat(l.unit_price) || 0;
    const t = parseFloat(l.tax_rate) || 0;
    return sum + q * p * (t / 100);
  }, 0);

  const discountAmt = parseFloat(form.discount_amount) || 0;
  const grandTotal = subtotal + taxAmount - discountAmt;

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
      };

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

      // Insert line items
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l.description.trim()) continue;
        const q = parseFloat(l.quantity) || 0;
        const p = parseFloat(l.unit_price) || 0;
        const t = parseFloat(l.tax_rate) || 0;
        const amt = q * p + q * p * (t / 100);
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
    } catch (err) {
      console.error('Failed to save quote:', err);
      alert('Failed to save quote. Please try again.');
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
        // Offer to navigate to the new invoice
        if (window.confirm('Quote converted to invoice. Go to Invoicing now?')) {
          setModule('invoicing');
        }
      }
    } catch (err) {
      console.error('Convert failed:', err);
      alert('Failed to convert quote to invoice.');
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
              {clients.map((c) => (
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
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
              {isConverted && <option value="converted">Converted</option>}
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
            />
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
    </div>
  );
};

export default QuoteForm;
