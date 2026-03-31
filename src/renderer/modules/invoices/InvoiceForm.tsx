import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { required, validateForm, minValue } from '../../lib/validation';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface Client {
  id: string;
  name: string;
}

interface Account {
  id: string;
  name: string;
  code: string;
}

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  account_id: string;
}

interface InvoiceFormData {
  client_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  terms: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  notes: string;
  terms_text: string;
  status: string;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Helpers ────────────────────────────────────────────
let lineIdCounter = 0;
const newLineItem = (): LineItem => ({
  id: `new-${++lineIdCounter}`,
  description: '',
  quantity: 1,
  unit_price: 0,
  tax_rate: 0,
  account_id: '',
});

// Bug fix #12a: scope invoice number generation to the active company so
// numbers don't collide across companies or reference another company's data.
const fetchNextInvoiceNumber = async (companyId: string): Promise<string> => {
  try {
    const rows = await api.rawQuery(
      'SELECT invoice_number FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 1',
      [companyId]
    );
    if (rows && rows.length > 0) {
      const last = rows[0].invoice_number as string;
      const match = last.match(/(\d+)$/);
      if (match) {
        return `INV-${parseInt(match[1], 10) + 1}`;
      }
    }
  } catch {
    /* fall through to default */
  }
  return 'INV-1001';
};

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const thirtyDaysLater = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};

// ─── Component ──────────────────────────────────────────
interface InvoiceFormProps {
  invoiceId?: string | null;
  onBack: () => void;
  onSaved: (id: string) => void;
}

const InvoiceForm: React.FC<InvoiceFormProps> = ({ invoiceId, onBack, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const isEdit = !!invoiceId;

  const [clients, setClients] = useState<Client[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const [form, setForm] = useState<InvoiceFormData>({
    client_id: '',
    invoice_number: '',
    issue_date: todayISO(),
    due_date: thirtyDaysLater(),
    terms: 'Net 30',
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    notes: '',
    terms_text: '',
    status: 'draft',
  });

  const [lines, setLines] = useState<LineItem[]>([newLineItem()]);

  // ─── Fetch reference data + existing invoice ─────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      try {
        // Bug fix #12b: clients and accounts queries were missing company_id.
        const cid = activeCompany.id;
        const [clientData, accountData] = await Promise.all([
          api.query('clients', { company_id: cid }),
          api.query('accounts', { company_id: cid, type: 'revenue' }),
        ]);
        if (cancelled) return;
        setClients(clientData ?? []);
        setAccounts(accountData ?? []);

        if (!invoiceId) {
          const nextNum = await fetchNextInvoiceNumber(cid);
          if (!cancelled) {
            setForm((prev) => ({ ...prev, invoice_number: nextNum }));
          }
        }

        if (invoiceId) {
          const inv = await api.get('invoices', invoiceId);
          if (cancelled || !inv) return;
          setForm({
            client_id: inv.client_id ?? '',
            invoice_number: inv.invoice_number ?? '',
            issue_date: inv.issue_date ?? todayISO(),
            due_date: inv.due_date ?? thirtyDaysLater(),
            terms: inv.terms ?? 'Net 30',
            subtotal: inv.subtotal ?? 0,
            tax: inv.tax_amount ?? 0,
            discount: inv.discount_amount ?? 0,
            total: inv.total ?? 0,
            notes: inv.notes ?? '',
            terms_text: '',
            status: inv.status ?? 'draft',
          });

          const lineData = await api.query('invoice_line_items', { invoice_id: invoiceId });
          if (cancelled) return;
          if (lineData && lineData.length > 0) {
            setLines(
              lineData.map((l: any) => ({
                id: l.id,
                description: l.description ?? '',
                quantity: l.quantity ?? 1,
                unit_price: l.unit_price ?? 0,
                tax_rate: l.tax_rate ?? 0,
                account_id: l.account_id ?? '',
              }))
            );
          }
        }
      } catch (err) {
        console.error('Failed to load form data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [invoiceId, activeCompany]);

  // ─── Line item calculations ──────────────────────────
  const lineAmounts = useMemo(
    () => lines.map((l) => l.quantity * l.unit_price),
    [lines]
  );

  const subtotal = useMemo(() => lineAmounts.reduce((s, a) => s + a, 0), [lineAmounts]);

  const taxTotal = useMemo(
    () =>
      lines.reduce((s, l) => {
        const amt = l.quantity * l.unit_price;
        return s + amt * (l.tax_rate / 100);
      }, 0),
    [lines]
  );

  const total = useMemo(
    () => subtotal + taxTotal - form.discount,
    [subtotal, taxTotal, form.discount]
  );

  // ─── Line item helpers ───────────────────────────────
  const updateLine = useCallback(
    (index: number, field: keyof LineItem, value: string | number) => {
      setLines((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    []
  );

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, newLineItem()]);
  }, []);

  const removeLine = useCallback((index: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  // ─── Form field helpers ──────────────────────────────
  const updateField = useCallback(
    (field: keyof InvoiceFormData, value: string | number) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  // ─── Save ────────────────────────────────────────────
  const handleSave = async (sendAfterSave: boolean) => {
    const checks: Array<string | null> = [
      required(form.client_id, 'Client'),
      lines.every((l) => !l.description && l.unit_price === 0)
        ? 'At least one line item is required'
        : null,
      ...lines
        .filter((l) => l.description || l.unit_price > 0)
        .map((l, i) =>
          minValue(l.quantity * l.unit_price, 0.01, `Line item ${i + 1} amount`)
        ),
    ];
    const validationErrors = validateForm(checks);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);

    setSaving(true);
    try {
      const status = sendAfterSave ? 'sent' : 'draft';
      // Bug fix #12c: do NOT reset amount_paid on edit — this would wipe
      // any recorded partial or full payments against the invoice.
      const invoiceData: Record<string, any> = {
        client_id: form.client_id,
        invoice_number: form.invoice_number,
        issue_date: form.issue_date,
        due_date: form.due_date,
        terms: form.terms,
        subtotal,
        tax_amount: taxTotal,
        discount_amount: form.discount,
        total,
        notes: form.notes,
        status,
      };
      if (!isEdit) {
        invoiceData.amount_paid = 0;
      }

      let savedId: string;

      if (isEdit && invoiceId) {
        await api.update('invoices', invoiceId, invoiceData);
        savedId = invoiceId;

        // Remove old line items then re-create
        const oldLines = await api.query('invoice_line_items', { invoice_id: invoiceId });
        if (oldLines) {
          for (const ol of oldLines) {
            await api.remove('invoice_line_items', ol.id);
          }
        }
      } else {
        const result = await api.create('invoices', invoiceData);
        savedId = result?.id ?? result;
      }

      // Create line items
      for (const line of lines) {
        if (!line.description && line.unit_price === 0) continue;
        await api.create('invoice_line_items', {
          invoice_id: savedId,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          tax_rate: line.tax_rate,
          account_id: line.account_id || null,
          amount: line.quantity * line.unit_price,
        });
      }

      onSaved(savedId);
    } catch (err) {
      console.error('Failed to save invoice:', err);
      alert('Failed to save invoice. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-muted text-sm font-mono">Loading...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="block-btn p-2" title="Back">
            <ArrowLeft size={16} />
          </button>
          <h1 className="module-title text-text-primary">
            {isEdit ? 'Edit Invoice' : 'New Invoice'}
          </h1>
        </div>
        <div className="module-actions">
          <button
            className="block-btn"
            disabled={saving}
            onClick={() => handleSave(false)}
          >
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button
            className="block-btn-primary"
            disabled={saving}
            onClick={() => handleSave(true)}
          >
            {saving ? 'Saving...' : 'Save & Send'}
          </button>
        </div>
      </div>

      {/* Validation Errors */}
      {errors.length > 0 && (
        <div
          style={{
            background: '#2a1215',
            border: '1px solid #ef4444',
            borderRadius: '2px',
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

      {/* Invoice Header Fields */}
      <div className="block-card">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {/* Client */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Client
            </label>
            <select
              className="block-select"
              value={form.client_id}
              onChange={(e) => updateField('client_id', e.target.value)}
            >
              <option value="">Select a client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Invoice Number */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Invoice Number
            </label>
            <input
              type="text"
              className="block-input"
              value={form.invoice_number}
              onChange={(e) => updateField('invoice_number', e.target.value)}
            />
          </div>

          {/* Issue Date */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Issue Date
            </label>
            <input
              type="date"
              className="block-input"
              value={form.issue_date}
              onChange={(e) => updateField('issue_date', e.target.value)}
            />
          </div>

          {/* Due Date */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Due Date
            </label>
            <input
              type="date"
              className="block-input"
              value={form.due_date}
              onChange={(e) => updateField('due_date', e.target.value)}
            />
          </div>

          {/* Terms */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Terms
            </label>
            <select
              className="block-select"
              value={form.terms}
              onChange={(e) => updateField('terms', e.target.value)}
            >
              <option value="Due on receipt">Due on receipt</option>
              <option value="Net 15">Net 15</option>
              <option value="Net 30">Net 30</option>
              <option value="Net 45">Net 45</option>
              <option value="Net 60">Net 60</option>
            </select>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Line Items
          </span>
          <button
            className="block-btn flex items-center gap-1.5 text-xs py-1 px-2"
            onClick={addLine}
          >
            <Plus size={14} />
            Add Line
          </button>
        </div>

        <table className="block-table">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Description</th>
              <th style={{ width: '10%' }}>Qty</th>
              <th style={{ width: '14%' }}>Unit Price</th>
              <th style={{ width: '12%' }} className="text-right">Amount</th>
              <th style={{ width: '10%' }}>Tax %</th>
              <th style={{ width: '18%' }}>Account</th>
              <th style={{ width: '6%' }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const amount = line.quantity * line.unit_price;
              return (
                <tr key={line.id}>
                  <td className="p-1">
                    <input
                      className="block-input"
                      placeholder="Item description"
                      value={line.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={1}
                      className="block-input text-right font-mono"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(idx, 'quantity', Math.max(1, parseFloat(e.target.value) || 1))
                      }
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="block-input text-right font-mono"
                      value={line.unit_price}
                      onChange={(e) =>
                        updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td className="p-1 text-right font-mono text-text-secondary">
                    {fmt.format(amount)}
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="block-input text-right font-mono"
                      value={line.tax_rate}
                      onChange={(e) =>
                        updateLine(idx, 'tax_rate', parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td className="p-1">
                    <select
                      className="block-select text-xs"
                      value={line.account_id}
                      onChange={(e) => updateLine(idx, 'account_id', e.target.value)}
                    >
                      <option value="">Select account</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code ? `${a.code} - ${a.name}` : a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1 text-center">
                    <button
                      className="text-text-muted hover:text-accent-expense transition-colors p-1"
                      onClick={() => removeLine(idx)}
                      title="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Totals */}
      <div className="flex justify-end">
        <div className="block-card w-80 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="font-mono text-text-primary">{fmt.format(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Tax</span>
            <span className="font-mono text-text-primary">{fmt.format(taxTotal)}</span>
          </div>
          <div className="flex justify-between text-sm items-center">
            <span className="text-text-secondary">Discount</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="block-input text-right font-mono w-28"
              value={form.discount}
              onChange={(e) => updateField('discount', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div
            className="flex justify-between text-sm font-bold pt-3"
            style={{ borderTop: '1px solid var(--color-border-primary)' }}
          >
            <span className="text-text-primary">Total</span>
            <span className="font-mono text-text-primary text-lg">{fmt.format(total)}</span>
          </div>
        </div>
      </div>

      {/* Notes & Terms */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
            Notes
          </label>
          <textarea
            className="block-input"
            rows={4}
            placeholder="Notes visible to the client..."
            value={form.notes}
            onChange={(e) => updateField('notes', e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
            Terms & Conditions
          </label>
          <textarea
            className="block-input"
            rows={4}
            placeholder="Payment terms, late fees, etc..."
            value={form.terms_text}
            onChange={(e) => updateField('terms_text', e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>
      </div>
    </div>
  );
};

export default InvoiceForm;
