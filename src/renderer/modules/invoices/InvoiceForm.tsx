import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { ArrowLeft, Trash2, Eye, EyeOff, BookOpen, X, Star, GripVertical, ChevronUp, ChevronDown, Bold, Italic } from 'lucide-react';
import api from '../../lib/api';
import { FieldLabel } from '../../components/FieldLabel';
import { required, validateForm, minValue } from '../../lib/validation';
import { useCompanyStore } from '../../stores/companyStore';
import { ClientContext } from '../../components/ContextPanel';
import { generateInvoiceHTML, InvoiceSettings } from '../../lib/print-templates';
import RowTypeToolbar from './RowTypeToolbar';
import PaymentScheduleEditor, { Milestone } from './PaymentScheduleEditor';
import type { LineRowType } from '../../../shared/types';

// ─── Types ──────────────────────────────────────────────
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
  default_payment_terms?: string;
  default_late_fee_pct?: number;
}

interface Account {
  id: string;
  name: string;
  code: string;
}

interface CatalogItem {
  id: string;
  name: string;
  description: string;
  unit_price: number;
  tax_rate: number;
  account_id: string | null;
}

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  account_id: string;
  row_type: LineRowType;
  unit_label: string;
  item_code: string;
  line_discount: number;
  line_discount_type: 'percent' | 'flat';
  discount_pct: number;
  tax_rate_override: number;   // -1 = use invoice rate
  bold: number;
  italic: number;
  highlight_color: string;
}

export type InvoiceType = 'standard' | 'service' | 'product' | 'retainer' | 'credit_note' | 'proforma';

interface InvoiceTypeConfig {
  label: string;
  description: string;
  qtyLabel: string;
  unitPriceLabel: string;
  showItemCode: boolean;
  showUnit: boolean;
  defaultUnitLabel: string;
  numberPrefix: string;
}

const INVOICE_TYPE_CONFIG: Record<InvoiceType, InvoiceTypeConfig> = {
  standard:    { label: 'Standard',    description: 'General purpose invoice',            qtyLabel: 'Qty',    unitPriceLabel: 'Unit Price',  showItemCode: false, showUnit: false, defaultUnitLabel: '',    numberPrefix: 'INV' },
  service:     { label: 'Service',     description: 'Labor, consulting & hourly services', qtyLabel: 'Hours',  unitPriceLabel: 'Rate / Hr',   showItemCode: false, showUnit: true,  defaultUnitLabel: 'hrs', numberPrefix: 'SVC' },
  product:     { label: 'Product',     description: 'Physical goods & inventory items',    qtyLabel: 'Qty',    unitPriceLabel: 'Unit Price',  showItemCode: true,  showUnit: true,  defaultUnitLabel: 'ea',  numberPrefix: 'PRD' },
  retainer:    { label: 'Retainer',    description: 'Advance payment or retainer fee',    qtyLabel: 'Qty',    unitPriceLabel: 'Amount',      showItemCode: false, showUnit: false, defaultUnitLabel: '',    numberPrefix: 'RET' },
  credit_note: { label: 'Credit Note', description: 'Credit memo or refund',              qtyLabel: 'Qty',    unitPriceLabel: 'Unit Price',  showItemCode: false, showUnit: false, defaultUnitLabel: '',    numberPrefix: 'CR'  },
  proforma:    { label: 'Proforma',    description: 'Preliminary estimate (not final)',    qtyLabel: 'Qty',    unitPriceLabel: 'Unit Price',  showItemCode: false, showUnit: false, defaultUnitLabel: '',    numberPrefix: 'PRO' },
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN', 'JPY', 'CHF', 'CNY', 'INR'];

// ─── GripCell (hoisted to module scope to prevent remount-on-render) ───
interface GripCellProps {
  idx: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: (idx: number) => void;
  onMoveDown: (idx: number) => void;
  onActivateDrag: (idx: number) => void;
}

const GripCell: React.FC<GripCellProps> = React.memo(({ idx, isFirst, isLast, onMoveUp, onMoveDown, onActivateDrag }) => (
  <td
    className="p-1 text-center"
    style={{ cursor: 'grab', color: 'var(--color-text-muted)', width: 28 }}
    onMouseDown={() => onActivateDrag(idx)}
  >
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <button
        type="button"
        onClick={() => onMoveUp(idx)}
        disabled={isFirst}
        title="Move up"
        aria-label={`Move row ${idx + 1} up`}
        style={{ background: 'none', border: 'none', padding: 0, cursor: isFirst ? 'not-allowed' : 'pointer', opacity: isFirst ? 0.3 : 1 }}
      >
        <ChevronUp size={9} />
      </button>
      <GripVertical size={11} aria-hidden="true" />
      <button
        type="button"
        onClick={() => onMoveDown(idx)}
        disabled={isLast}
        title="Move down"
        aria-label={`Move row ${idx + 1} down`}
        style={{ background: 'none', border: 'none', padding: 0, cursor: isLast ? 'not-allowed' : 'pointer', opacity: isLast ? 0.3 : 1 }}
      >
        <ChevronDown size={9} />
      </button>
    </div>
  </td>
));
GripCell.displayName = 'GripCell';

interface InvoiceFormData {
  client_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  terms: string;
  discount: number;
  notes: string;
  terms_text: string;
  status: string;
  internal_notes: string;
  po_number: string;
  job_reference: string;
  late_fee_pct: number;
  late_fee_grace_days: number;
  discount_pct: number;
  invoice_type: InvoiceType;
  currency: string;
  shipping_amount: number;
  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;
  custom_field_4: string;
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
const newLineItem = (rowType: LineRowType = 'item', defaultUnitLabel = ''): LineItem => ({
  id: `new-${++lineIdCounter}`,
  description: '',
  quantity: 1,
  unit_price: 0,
  tax_rate: 0,
  account_id: '',
  row_type: rowType,
  unit_label: defaultUnitLabel,
  item_code: '',
  line_discount: 0,
  line_discount_type: 'percent',
  discount_pct: 0,
  tax_rate_override: -1,
  bold: 0,
  italic: 0,
  highlight_color: '',
});

const fetchNextInvoiceNumber = async (companyId: string): Promise<string> => {
  try {
    const rows = await api.rawQuery(
      'SELECT invoice_number FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 1',
      [companyId]
    );
    if (rows && rows.length > 0) {
      const last = rows[0].invoice_number as string;
      const match = last.match(/(\d+)$/);
      if (match) return `INV-${parseInt(match[1], 10) + 1}`;
    }
  } catch { /* fall through */ }
  return 'INV-1001';
};

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const TERMS_DAYS: Record<string, number> = {
  'Due on receipt': 0,
  'Net 15': 15,
  'Net 30': 30,
  'Net 45': 45,
  'Net 60': 60,
};

// ─── Catalog Dropdown ────────────────────────────────────
interface CatalogDropdownProps {
  items: CatalogItem[];
  onSelect: (item: CatalogItem) => void;
  onClose: () => void;
}

const CatalogDropdown: React.FC<CatalogDropdownProps> = ({ items, onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 10);
    const q = query.toLowerCase();
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [query, items]);

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        zIndex: 100,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-primary)',
        borderRadius: '6px',
        width: '280px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '8px', borderBottom: '1px solid var(--color-border-primary)', display: 'flex', gap: 6 }}>
        <input
          ref={inputRef}
          className="block-input"
          placeholder="Search catalog..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, fontSize: '12px', padding: '4px 8px' }}
        />
        <button className="block-btn p-1" onClick={onClose} title="Close"><X size={12} /></button>
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: '12px', color: 'var(--color-text-muted)', fontSize: '12px', textAlign: 'center' }}>
          No catalog items found
        </div>
      ) : (
        <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                borderBottom: '1px solid var(--color-border-primary)',
                color: 'var(--color-text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontSize: '12px', fontWeight: 600 }}>{item.name}</div>
              {item.description && (
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {item.description.slice(0, 60)}{item.description.length > 60 ? '…' : ''}
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                {fmt.format(item.unit_price)} · Tax: {item.tax_rate}%
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState<number | null>(null);
  const [savingToCatalog, setSavingToCatalog] = useState<number | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [showSchedule, setShowSchedule] = useState(false);

  const [form, setForm] = useState<InvoiceFormData>({
    client_id: '',
    invoice_number: '',
    issue_date: todayISO(),
    due_date: addDays(todayISO(), 30),
    terms: 'Net 30',
    discount: 0,
    notes: '',
    terms_text: '',
    status: 'draft',
    internal_notes: '',
    po_number: '',
    job_reference: '',
    late_fee_pct: 0,
    late_fee_grace_days: 0,
    discount_pct: 0,
    invoice_type: 'standard',
    currency: 'USD',
    shipping_amount: 0,
    custom_field_1: '',
    custom_field_2: '',
    custom_field_3: '',
    custom_field_4: '',
  });

  const [lines, setLines] = useState<LineItem[]>([newLineItem()]);

  // Drag-and-drop state for line reordering
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [rowDraggable, setRowDraggableState] = useState<Record<number, boolean>>({});
  const [hoveredLineIdx, setHoveredLineIdx] = useState<number | null>(null);

  const setRowDraggable = useCallback((idx: number, value: boolean) => {
    setRowDraggableState((prev) => ({ ...prev, [idx]: value }));
  }, []);

  // ─── Fetch reference data + existing invoice ─────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      try {
        const cid = activeCompany.id;

        // Critical: clients + accounts needed for form
        const [clientData, accountData] = await Promise.all([
          api.query('clients', { company_id: cid }),
          api.query('accounts', { company_id: cid, type: 'revenue' }),
        ]);
        if (cancelled) return;
        setClients(Array.isArray(clientData) ? clientData : []);
        setAccounts(Array.isArray(accountData) ? accountData : []);

        // Non-critical secondary data — failures don't hide primary content
        api.listCatalogItems()
          .then(r => { if (!cancelled) setCatalogItems(Array.isArray(r) ? r : []); })
          .catch(() => {});
        api.getInvoiceSettings()
          .then(r => { if (!cancelled && r && !r.error) setInvoiceSettings(r); })
          .catch(() => {});

        if (!invoiceId) {
          const nextNum = await fetchNextInvoiceNumber(cid);
          if (!cancelled) {
            setForm((prev) => ({ ...prev, invoice_number: nextNum }));
          }

          const prefillRaw = localStorage.getItem('invoiceFormPrefill');
          if (prefillRaw) {
            try {
              const prefill = JSON.parse(prefillRaw);
              localStorage.removeItem('invoiceFormPrefill');
              if (!cancelled) {
                if (prefill.client_id) {
                  setForm((prev) => ({ ...prev, client_id: prefill.client_id }));
                }
                if (Array.isArray(prefill.lines) && prefill.lines.length > 0) {
                  let lineCount = lineIdCounter;
                  setLines(
                    prefill.lines.map((l: any) => ({
                      id: `new-${++lineCount}`,
                      description: l.description ?? '',
                      quantity: Number(l.quantity ?? 1),
                      unit_price: Number(l.unit_price ?? 0),
                      tax_rate: Number(l.tax_rate ?? 0),
                      account_id: l.account_id ?? '',
                    }))
                  );
                  lineIdCounter = lineCount;
                }
              }
            } catch {
              localStorage.removeItem('invoiceFormPrefill');
            }
          }
        }

        if (invoiceId) {
          const inv = await api.get('invoices', invoiceId);
          if (cancelled || !inv) return;
          setForm({
            client_id: inv.client_id ?? '',
            invoice_number: inv.invoice_number ?? '',
            issue_date: inv.issue_date ?? todayISO(),
            due_date: inv.due_date ?? addDays(todayISO(), 30),
            terms: inv.terms ?? 'Net 30',
            discount: inv.discount_amount ?? 0,
            notes: inv.notes ?? '',
            terms_text: inv.terms_text ?? '',
            status: inv.status ?? 'draft',
            po_number: inv.po_number || '',
            job_reference: inv.job_reference || '',
            internal_notes: inv.internal_notes || '',
            late_fee_pct: inv.late_fee_pct || 0,
            late_fee_grace_days: inv.late_fee_grace_days || 0,
            discount_pct: inv.discount_pct || 0,
            invoice_type: (inv.invoice_type as InvoiceType) || 'standard',
            currency: inv.currency || 'USD',
            shipping_amount: inv.shipping_amount || 0,
            custom_field_1: inv.custom_field_1 || '',
            custom_field_2: inv.custom_field_2 || '',
            custom_field_3: inv.custom_field_3 || '',
            custom_field_4: inv.custom_field_4 || '',
          });

          const [lineData, scheduleData] = await Promise.all([
            api.query('invoice_line_items', { invoice_id: invoiceId }, { field: 'sort_order', dir: 'asc' }),
            api.listPaymentSchedule(invoiceId).catch(() => []),
          ]);
          if (cancelled) return;
          if (scheduleData && scheduleData.length > 0) {
            setMilestones(scheduleData.map((m: any) => ({
              id: m.id, milestone_label: m.milestone_label || '',
              due_date: m.due_date || '', amount: Number(m.amount || 0),
              paid: !!m.paid,
            })));
            setShowSchedule(true);
          }
          if (lineData && lineData.length > 0) {
            setLines(
              lineData.map((l: any) => ({
                id: l.id,
                description: l.description ?? '',
                quantity: l.quantity ?? 1,
                unit_price: l.unit_price ?? 0,
                tax_rate: l.tax_rate ?? 0,
                account_id: l.account_id ?? '',
                row_type: l.row_type ?? 'item',
                unit_label: l.unit_label ?? '',
                item_code: l.item_code ?? '',
                line_discount: l.line_discount ?? 0,
                line_discount_type: l.line_discount_type ?? 'percent',
                discount_pct: l.discount_pct || 0,
                tax_rate_override: l.tax_rate_override != null ? l.tax_rate_override : -1,
                bold: l.bold ?? 0,
                italic: l.italic ?? 0,
                highlight_color: l.highlight_color ?? '',
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

  // ─── Line item calculations (item rows only) ─────────
  const subtotal = useMemo(
    () => lines.filter(l => (l.row_type || 'item') === 'item').reduce((s, l) => {
      const baseAmount = l.quantity * l.unit_price;
      const discountedAmount = baseAmount * (1 - (l.discount_pct || 0) / 100);
      return s + discountedAmount;
    }, 0),
    [lines]
  );

  const taxTotal = useMemo(
    () => lines.filter(l => (l.row_type || 'item') === 'item').reduce((s, l) => {
      const baseAmount = l.quantity * l.unit_price;
      const discountedAmount = baseAmount * (1 - (l.discount_pct || 0) / 100);
      const effectiveTaxRate = l.tax_rate_override >= 0 ? l.tax_rate_override : l.tax_rate;
      return s + discountedAmount * (effectiveTaxRate / 100);
    }, 0),
    [lines]
  );

  const taxByRate = useMemo(() => {
    const map: Record<string, { taxable: number; tax: number }> = {};
    for (const l of lines) {
      if ((l.row_type || 'item') !== 'item') continue;
      const rate = l.tax_rate_override >= 0 ? l.tax_rate_override : l.tax_rate;
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

  const shippingTax = useMemo(() => 0, []); // reserved for future shipping tax
  const total = useMemo(() => {
    const raw = subtotal + taxTotal - form.discount + (form.shipping_amount || 0) + shippingTax;
    return form.invoice_type === 'credit_note' ? -Math.abs(raw) : raw;
  }, [subtotal, taxTotal, form.discount, form.shipping_amount, form.invoice_type, shippingTax]);

  // ─── Type config derived from form ──────────────────
  const typeConfig = useMemo(() => INVOICE_TYPE_CONFIG[form.invoice_type] || INVOICE_TYPE_CONFIG.standard, [form.invoice_type]);

  // ─── Currency formatter (switches based on selected currency) ───
  const currencyFmt = useMemo(() => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: form.currency || 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }), [form.currency]);

  // ─── Live preview HTML ───────────────────────────────
  const previewHTML = useMemo(() => {
    if (!showPreview || !activeCompany) return '';
    const client = clients.find((c) => c.id === form.client_id) || null;
    const inv = {
      invoice_number: form.invoice_number || 'PREVIEW',
      issue_date: form.issue_date,
      due_date: form.due_date,
      terms: form.terms,
      status: form.status,
      subtotal,
      tax_amount: taxTotal,
      discount_amount: form.discount,
      total,
      notes: form.notes,
      terms_text: form.terms_text,
      amount_paid: 0,
      invoice_type: form.invoice_type,
      currency: form.currency,
      shipping_amount: form.shipping_amount || 0,
    };
    const lineData = lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      tax_rate: l.tax_rate,
      amount: l.quantity * l.unit_price,
      row_type: l.row_type || 'item',
      unit_label: l.unit_label,
      item_code: l.item_code,
      line_discount: l.line_discount,
      line_discount_type: l.line_discount_type,
      bold: l.bold,
      italic: l.italic,
      highlight_color: l.highlight_color,
    }));
    return generateInvoiceHTML(inv, activeCompany, client, lineData, invoiceSettings || undefined);
  }, [showPreview, form, lines, subtotal, taxTotal, total, activeCompany, clients, invoiceSettings]);

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

  const addLine = useCallback((rowType: LineRowType = 'item') => {
    const cfg = INVOICE_TYPE_CONFIG[form.invoice_type] || INVOICE_TYPE_CONFIG.standard;
    setLines((prev) => [...prev, newLineItem(rowType, rowType === 'item' ? cfg.defaultUnitLabel : '')]);
  }, [form.invoice_type]);

  const removeLine = useCallback(
    (index: number) => setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index))),
    []
  );

  const moveLine = useCallback((from: number, to: number) => {
    setLines((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const moveLineUp = useCallback((idx: number) => {
    if (idx > 0) moveLine(idx, idx - 1);
  }, [moveLine]);

  const moveLineDown = useCallback((idx: number) => {
    setLines((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(idx + 1, 0, item);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((idx: number) => (e: React.DragEvent) => {
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox
    e.dataTransfer.setData('text/plain', String(idx));
  }, []);

  const handleDragOver = useCallback((idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndex !== null && dragIndex !== idx) setOverIndex(idx);
  }, [dragIndex]);

  const handleDragLeave = useCallback(() => {
    setOverIndex(null);
  }, []);

  const handleDrop = useCallback((idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== idx) {
      moveLine(dragIndex, idx);
    }
    setDragIndex(null);
    setOverIndex(null);
  }, [dragIndex, moveLine]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
    setRowDraggableState({});
  }, []);

  const handleActivateDrag = useCallback((i: number) => {
    setRowDraggable(i, true);
  }, [setRowDraggable]);

  // Safety net: if user mousedowns the grip but releases without starting a drag,
  // neither onDragEnd nor a drop fires. Reset rowDraggable on any document mouseup
  // (deferred to next tick so dragstart can fire first and preserve state).
  useEffect(() => {
    const onGlobalMouseUp = () => {
      setTimeout(() => {
        setDragIndex((current) => {
          if (current !== null) return current; // drag in progress — don't touch
          setRowDraggableState({});
          return current;
        });
      }, 0);
    };
    document.addEventListener('mouseup', onGlobalMouseUp);
    return () => document.removeEventListener('mouseup', onGlobalMouseUp);
  }, []);

  const getRowDragProps = useCallback((idx: number) => ({
    draggable: !!rowDraggable[idx],
    onDragStart: handleDragStart(idx),
    onDragOver: handleDragOver(idx),
    onDragLeave: handleDragLeave,
    onDrop: handleDrop(idx),
    onDragEnd: handleDragEnd,
  }), [rowDraggable, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd]);

  const getRowDragStyle = useCallback((idx: number): React.CSSProperties => {
    const style: React.CSSProperties = {};
    if (overIndex === idx && dragIndex !== null && dragIndex !== idx) {
      style.borderTop = '2px solid var(--color-accent-blue)';
    }
    if (dragIndex === idx) {
      style.opacity = 0.4;
    }
    return style;
  }, [overIndex, dragIndex]);

  // ─── Form field helpers ──────────────────────────────
  const updateField = useCallback(
    (field: keyof InvoiceFormData, value: string | number) =>
      setForm((prev) => ({ ...prev, [field]: value })),
    []
  );

  // Smart due date: auto-calculate from terms when user changes terms dropdown
  const handleTermsChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newTerms = e.target.value;
      setForm((prev) => {
        const days = TERMS_DAYS[newTerms] ?? 30;
        return {
          ...prev,
          terms: newTerms,
          due_date: addDays(prev.issue_date || todayISO(), days),
        };
      });
    },
    []
  );

  // Also update due date when issue_date changes (maintain the terms offset)
  const handleIssueDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newDate = e.target.value;
      setForm((prev) => {
        const days = TERMS_DAYS[prev.terms] ?? 30;
        return {
          ...prev,
          issue_date: newDate,
          due_date: newDate ? addDays(newDate, days) : prev.due_date,
        };
      });
    },
    []
  );

  // ─── Catalog: apply item to line ─────────────────────
  const applyCatalogItem = useCallback(
    (lineIndex: number, item: CatalogItem) => {
      setLines((prev) => {
        const next = [...prev];
        next[lineIndex] = {
          ...next[lineIndex],
          description: item.name,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate,
          account_id: item.account_id || next[lineIndex].account_id,
        };
        return next;
      });
      setCatalogOpen(null);
    },
    []
  );

  // Save current line item to catalog
  const saveLineToCatalog = useCallback(
    async (lineIndex: number) => {
      const line = lines[lineIndex];
      if (!line.description.trim()) return;
      setSavingToCatalog(lineIndex);
      try {
        await api.saveCatalogItem({
          name: line.description,
          description: '',
          unit_price: line.unit_price,
          tax_rate: line.tax_rate,
          account_id: line.account_id || null,
        });
        const updated = await api.listCatalogItems().catch(() => null);
        if (updated) setCatalogItems(updated);
      } catch (err) {
        console.error('Failed to save to catalog:', err);
      } finally {
        setSavingToCatalog(null);
      }
    },
    [lines]
  );

  // ─── Save ────────────────────────────────────────────
  const handleSave = async (sendAfterSave: boolean) => {
    const activeLines = lines.filter((l) => (l.row_type || 'item') === 'item' && (l.description.trim() || l.unit_price > 0));

    const lineItemErrors: string[] = [];
    activeLines.forEach((l, i) => {
      const num = i + 1;
      if (!l.description.trim()) lineItemErrors.push(`Line item ${num}: description cannot be empty.`);
      if (isNaN(l.quantity) || l.quantity < 0) lineItemErrors.push(`Line item ${num}: quantity must be a non-negative number.`);
      if (isNaN(l.unit_price) || l.unit_price < 0) lineItemErrors.push(`Line item ${num}: unit price must be a non-negative number.`);
    });

    const checks: Array<string | null> = [
      required(form.client_id, 'Client'),
      lines.every((l) => (l.row_type || 'item') !== 'item' || (!l.description.trim() && l.unit_price === 0))
        ? 'At least one line item is required'
        : null,
    ];
    const validationErrors = [...validateForm(checks), ...lineItemErrors];
    if (form.issue_date && form.due_date && form.due_date < form.issue_date) {
      validationErrors.push('Due date must be on or after issue date');
    }
    if (form.discount && subtotal > 0 && form.discount > subtotal) {
      validationErrors.push('Discount cannot exceed subtotal');
    }
    if (form.discount && form.discount < 0) {
      validationErrors.push('Discount cannot be negative');
    }
    if (form.invoice_type !== 'credit_note' && total <= 0) {
      validationErrors.push('Invoice total must be greater than zero');
    }
    activeLines.forEach((l, i) => {
      const num = i + 1;
      if (l.quantity === 0 && l.unit_price === 0) {
        // skip empty-ish rows silently
      } else if (l.quantity <= 0) {
        validationErrors.push(`Line item ${num}: quantity must be greater than zero.`);
      }
    });
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    setSaving(true);

    try {
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
        terms_text: form.terms_text,
        status: sendAfterSave ? 'sent' : 'draft',
        po_number: form.po_number.trim() || null,
        job_reference: form.job_reference.trim() || null,
        internal_notes: form.internal_notes.trim() || null,
        late_fee_pct: form.late_fee_pct || 0,
        late_fee_grace_days: form.late_fee_grace_days || 0,
        discount_pct: form.discount_pct || 0,
        invoice_type: form.invoice_type || 'standard',
        currency: form.currency || 'USD',
        shipping_amount: form.shipping_amount || 0,
        custom_field_1: form.custom_field_1.trim() || null,
        custom_field_2: form.custom_field_2.trim() || null,
        custom_field_3: form.custom_field_3.trim() || null,
        custom_field_4: form.custom_field_4.trim() || null,
      };
      if (!isEdit) invoiceData.amount_paid = 0;

      const lineItems = lines.map((l, idx) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        tax_rate: l.tax_rate,
        account_id: l.account_id || null,
        amount: (l.row_type || 'item') === 'item' ? l.quantity * l.unit_price : 0,
        sort_order: idx,
        row_type: l.row_type || 'item',
        unit_label: l.unit_label || '',
        item_code: l.item_code || '',
        line_discount: l.line_discount || 0,
        line_discount_type: l.line_discount_type || 'percent',
        discount_pct: l.discount_pct || 0,
        tax_rate_override: l.tax_rate_override != null ? l.tax_rate_override : -1,
        bold: l.bold || 0,
        italic: l.italic || 0,
        highlight_color: l.highlight_color || '',
      }));

      const result = await api.saveInvoice({ invoiceId: isEdit ? invoiceId : null, invoiceData, lineItems, isEdit });
      if (result?.error) throw new Error(result.error);
      // Save payment schedule if active
      if (showSchedule && milestones.length > 0) {
        await api.savePaymentSchedule(result.id!, milestones).catch(console.error);
      }
      onSaved(result.id!);
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

  // ─── Form content (shared between single-pane and split-pane) ───
  const formContent = (
    <div className="p-6 space-y-6">
      {/* Validation Errors */}
      {errors.length > 0 && (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid #ef4444', borderRadius: '6px', padding: '12px 16px' }}>
          <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
            {errors.map((err, i) => (
              <li key={i} style={{ color: '#ef4444', fontSize: '13px', lineHeight: '1.6' }}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Invoice Type Selector */}
      <div className="block-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">Invoice Type</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{typeConfig.description}</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider mr-1">Currency</label>
            <select
              className="block-select"
              style={{ width: 80, fontSize: 12 }}
              value={form.currency}
              onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(Object.keys(INVOICE_TYPE_CONFIG) as InvoiceType[]).map(type => {
            const cfg = INVOICE_TYPE_CONFIG[type];
            const isActive = form.invoice_type === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setForm(p => ({ ...p, invoice_type: type }))}
                style={{
                  padding: '5px 14px',
                  borderRadius: 6,
                  border: `1px solid ${isActive ? 'var(--color-accent)' : 'var(--color-border-primary)'}`,
                  background: isActive ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                  color: isActive ? '#fff' : 'var(--color-text-secondary)',
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
        {form.invoice_type === 'credit_note' && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', borderRadius: 6, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
            Credit Note — total will be displayed as a negative amount (credit to client)
          </div>
        )}
        {form.invoice_type === 'proforma' && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(234,179,8,0.08)', border: '1px solid #d97706', borderRadius: 6, fontSize: 12, color: '#d97706', fontWeight: 600 }}>
            Proforma — this invoice is preliminary and not a final billing document
          </div>
        )}
      </div>

      {/* Invoice Header Fields */}
      <div className="block-card">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {/* Client */}
          <div>
            <FieldLabel label="Client" tooltip="The client this invoice will be billed to" required />
            <select className="block-select" value={form.client_id} onChange={(e) => {
              const newClientId = e.target.value;
              const client = clients.find(c => c.id === newClientId);
              setForm(prev => ({
                ...prev,
                client_id: newClientId,
                ...(client?.default_payment_terms
                  ? {
                      terms: client.default_payment_terms,
                      due_date: addDays(prev.issue_date || todayISO(), TERMS_DAYS[client.default_payment_terms] ?? 30),
                    }
                  : {}),
                ...(client?.default_late_fee_pct && client.default_late_fee_pct > 0
                  ? { late_fee_pct: client.default_late_fee_pct }
                  : {}),
              }));
            }}>
              <option value="">Select a client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ClientContext clientId={form.client_id || null} companyId={activeCompany?.id ?? ''} />
          </div>

          {/* Invoice Number */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Invoice Number</label>
            <input type="text" className="block-input" value={form.invoice_number} onChange={(e) => updateField('invoice_number', e.target.value)} />
          </div>

          {/* Issue Date */}
          <div>
            <FieldLabel label="Issue Date" tooltip="Date the invoice is issued" required />
            <input type="date" className="block-input" value={form.issue_date} onChange={handleIssueDateChange} />
          </div>

          {/* Due Date */}
          <div>
            <FieldLabel label="Due Date" tooltip="Auto-set from Terms · can be overridden manually" required />
            <input type="date" className="block-input" value={form.due_date} onChange={(e) => updateField('due_date', e.target.value)} />
          </div>

          {/* Terms */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Terms
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>
                (auto-updates due date)
              </span>
            </label>
            <select className="block-select" value={form.terms} onChange={handleTermsChange}>
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
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Line Items</span>
          {catalogItems.length > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
              <BookOpen size={11} style={{ display: 'inline', marginRight: 4 }} />
              {catalogItems.length} catalog item{catalogItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <table className="block-table">
          <thead>
            <tr>
              <th style={{ width: '2%' }}></th>
              {typeConfig.showItemCode && <th style={{ width: '9%' }}>SKU / Code</th>}
              <th style={{ width: typeConfig.showItemCode ? '24%' : '30%' }}>Description</th>
              {typeConfig.showUnit && <th style={{ width: '6%' }}>Unit</th>}
              <th style={{ width: '8%' }}>{typeConfig.qtyLabel}</th>
              <th style={{ width: '12%' }}>{typeConfig.unitPriceLabel}</th>
              <th style={{ width: '8%' }} className="text-right">Base</th>
              <th style={{ width: '8%' }}>Tax %</th>
              <th style={{ width: '5%' }}>Disc%</th>
              <th style={{ width: '5%' }}>Tax Ovr%</th>
              <th style={{ width: '8%' }} className="text-right">Tax</th>
              <th style={{ width: '9%' }} className="text-right">Total</th>
              <th style={{ width: '10%' }}>Account</th>
              <th style={{ width: '7%' }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const rowType = line.row_type || 'item';
              const isItem = rowType === 'item';
              const baseAmount = line.quantity * line.unit_price;
              const amount = baseAmount * (1 - (line.discount_pct || 0) / 100);
              const effectiveTaxRate = line.tax_rate_override >= 0 ? line.tax_rate_override : line.tax_rate;
              const lineTax = isItem ? amount * (effectiveTaxRate / 100) : 0;
              const lineTotal = amount + lineTax;

              if (rowType === 'spacer') {
                return (
                  <tr
                    key={line.id}
                    {...getRowDragProps(idx)}
                    style={{
                      background: 'var(--color-bg-tertiary)',
                      opacity: 0.5,
                      ...getRowDragStyle(idx),
                    }}
                  >
                    <GripCell
                      idx={idx}
                      isFirst={idx === 0}
                      isLast={idx === lines.length - 1}
                      onMoveUp={moveLineUp}
                      onMoveDown={moveLineDown}
                      onActivateDrag={handleActivateDrag}
                    />
                    <td className="p-1 text-center" colSpan={11}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>spacer</span>
                        <button className="text-text-muted p-1" onClick={() => removeLine(idx)} title="Remove"><Trash2 size={11} /></button>
                      </div>
                    </td>
                  </tr>
                );
              }

              if (rowType === 'section') {
                return (
                  <tr
                    key={line.id}
                    {...getRowDragProps(idx)}
                    style={{
                      background: 'rgba(100,116,139,0.08)',
                      ...getRowDragStyle(idx),
                    }}
                  >
                    <GripCell
                      idx={idx}
                      isFirst={idx === 0}
                      isLast={idx === lines.length - 1}
                      onMoveUp={moveLineUp}
                      onMoveDown={moveLineDown}
                      onActivateDrag={handleActivateDrag}
                    />
                    <td colSpan={10} className="p-1">
                      <input
                        className="block-input font-bold"
                        placeholder="Section heading..."
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        style={{ width: '100%', fontSize: '13px', fontWeight: 700 }}
                      />
                    </td>
                    <td className="p-1 text-center">
                      <button className="text-text-muted p-1" onClick={() => removeLine(idx)} title="Remove"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              }

              if (rowType === 'note') {
                return (
                  <tr
                    key={line.id}
                    {...getRowDragProps(idx)}
                    style={{
                      background: 'var(--color-bg-secondary)',
                      ...getRowDragStyle(idx),
                    }}
                  >
                    <GripCell
                      idx={idx}
                      isFirst={idx === 0}
                      isLast={idx === lines.length - 1}
                      onMoveUp={moveLineUp}
                      onMoveDown={moveLineDown}
                      onActivateDrag={handleActivateDrag}
                    />
                    <td colSpan={10} className="p-1">
                      <input
                        className="block-input"
                        placeholder="Note (italic in PDF)..."
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        style={{ width: '100%', fontStyle: 'italic', color: 'var(--color-text-muted)' }}
                      />
                    </td>
                    <td className="p-1 text-center">
                      <button className="text-text-muted p-1" onClick={() => removeLine(idx)} title="Remove"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              }

              if (rowType === 'subtotal') {
                const subtotalAmt = lines
                  .slice(0, idx)
                  .filter(r => (r.row_type || 'item') === 'item')
                  .reduce((s, r) => s + r.quantity * r.unit_price * (1 - (r.discount_pct || 0) / 100), 0);
                return (
                  <tr
                    key={line.id}
                    {...getRowDragProps(idx)}
                    style={{
                      borderTop: '1px solid var(--color-border-primary)',
                      background: 'var(--color-bg-tertiary)',
                      ...getRowDragStyle(idx),
                    }}
                  >
                    <GripCell
                      idx={idx}
                      isFirst={idx === 0}
                      isLast={idx === lines.length - 1}
                      onMoveUp={moveLineUp}
                      onMoveDown={moveLineDown}
                      onActivateDrag={handleActivateDrag}
                    />
                    <td colSpan={9} className="p-1">
                      <input
                        className="block-input font-bold"
                        placeholder="Subtotal label..."
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td className="p-1 text-right font-mono font-bold text-text-primary">{currencyFmt.format(subtotalAmt)}</td>
                    <td className="p-1 text-center">
                      <button className="text-text-muted p-1" onClick={() => removeLine(idx)} title="Remove"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              }

              if (rowType === 'image') {
                return (
                  <tr
                    key={line.id}
                    {...getRowDragProps(idx)}
                    style={getRowDragStyle(idx)}
                  >
                    <GripCell
                      idx={idx}
                      isFirst={idx === 0}
                      isLast={idx === lines.length - 1}
                      onMoveUp={moveLineUp}
                      onMoveDown={moveLineDown}
                      onActivateDrag={handleActivateDrag}
                    />
                    <td colSpan={9} className="p-1">
                      <input
                        className="block-input"
                        placeholder="Image URL or base64..."
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        style={{ width: '100%' }}
                      />
                      <input
                        className="block-input mt-1"
                        placeholder="Caption (optional)..."
                        value={line.unit_label}
                        onChange={(e) => updateLine(idx, 'unit_label', e.target.value)}
                        style={{ width: '100%', fontSize: '11px' }}
                      />
                    </td>
                    <td></td>
                    <td className="p-1 text-center">
                      <button className="text-text-muted p-1" onClick={() => removeLine(idx)} title="Remove"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              }

              // Standard item row
              return (
                <tr
                  key={line.id}
                  {...getRowDragProps(idx)}
                  onMouseEnter={() => setHoveredLineIdx(idx)}
                  onMouseLeave={() => setHoveredLineIdx(null)}
                  style={getRowDragStyle(idx)}
                >
                  <GripCell
                    idx={idx}
                    isFirst={idx === 0}
                    isLast={idx === lines.length - 1}
                    onMoveUp={moveLineUp}
                    onMoveDown={moveLineDown}
                    onActivateDrag={handleActivateDrag}
                  />
                  {typeConfig.showItemCode && (
                    <td className="p-1">
                      <input
                        className="block-input font-mono"
                        style={{ fontSize: 11 }}
                        placeholder="SKU"
                        value={line.item_code}
                        onChange={e => updateLine(idx, 'item_code', e.target.value)}
                      />
                    </td>
                  )}
                  <td className="p-1" style={{ position: 'relative' }}>
                    {hoveredLineIdx === idx && dragIndex === null && (
                      <div
                        onMouseEnter={() => setHoveredLineIdx(idx)}
                        onMouseLeave={() => setHoveredLineIdx(null)}
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 'calc(100% + 2px)',
                          zIndex: 20,
                          display: 'flex',
                          gap: 2,
                          padding: '3px 4px',
                          background: 'var(--color-bg-elevated)',
                          border: '1px solid var(--color-border-primary)',
                          borderRadius: 4,
                        }}>
                        <button
                          type="button"
                          title="Bold"
                          onClick={() => updateLine(idx, 'bold', line.bold ? 0 : 1)}
                          style={{
                            background: line.bold ? 'var(--color-accent-blue)' : 'transparent',
                            color: line.bold ? '#fff' : 'var(--color-text-muted)',
                            border: 'none', padding: '2px 4px', cursor: 'pointer', borderRadius: 2,
                          }}
                        >
                          <Bold size={10} />
                        </button>
                        <button
                          type="button"
                          title="Italic"
                          onClick={() => updateLine(idx, 'italic', line.italic ? 0 : 1)}
                          style={{
                            background: line.italic ? 'var(--color-accent-blue)' : 'transparent',
                            color: line.italic ? '#fff' : 'var(--color-text-muted)',
                            border: 'none', padding: '2px 4px', cursor: 'pointer', borderRadius: 2,
                          }}
                        >
                          <Italic size={10} />
                        </button>
                        <div style={{ width: 1, background: 'var(--color-border-primary)', margin: '0 2px' }} />
                        {['', '#fef9c3', '#dbeafe', '#fecaca', '#dcfce7'].map((color) => (
                          <button
                            key={color || 'none'}
                            type="button"
                            title={color ? `Highlight ${color}` : 'No highlight'}
                            onClick={() => updateLine(idx, 'highlight_color', color)}
                            style={{
                              background: color || 'transparent',
                              border: line.highlight_color === color
                                ? '2px solid var(--color-accent-blue)'
                                : '1px solid var(--color-border-primary)',
                              width: 14, height: 14, cursor: 'pointer', borderRadius: 2,
                              backgroundImage: color ? 'none' : 'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)',
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        className="block-input"
                        placeholder="Item description"
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        style={{
                          flex: 1,
                          fontWeight: line.bold ? 700 : undefined,
                          fontStyle: line.italic ? 'italic' : undefined,
                          background: line.highlight_color || undefined,
                        }}
                      />
                      <button
                        className="block-btn p-1"
                        style={{ flexShrink: 0 }}
                        onClick={() => setCatalogOpen(catalogOpen === idx ? null : idx)}
                        title="Pick from catalog"
                      >
                        <BookOpen size={13} />
                      </button>
                    </div>
                    {catalogOpen === idx && (
                      <CatalogDropdown
                        items={catalogItems}
                        onSelect={(item) => applyCatalogItem(idx, item)}
                        onClose={() => setCatalogOpen(null)}
                      />
                    )}
                  </td>
                  {typeConfig.showUnit && (
                    <td className="p-1">
                      <input
                        className="block-input"
                        style={{ fontSize: 11 }}
                        placeholder={typeConfig.defaultUnitLabel || 'unit'}
                        value={line.unit_label}
                        onChange={e => updateLine(idx, 'unit_label', e.target.value)}
                      />
                    </td>
                  )}
                  <td className="p-1">
                    <input
                      type="number"
                      min={0}
                      className="block-input text-right font-mono"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', Math.max(0, parseFloat(e.target.value) || 0))}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="block-input text-right font-mono"
                      value={line.unit_price}
                      onChange={(e) => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="p-1 text-right font-mono text-text-secondary">{currencyFmt.format(amount)}</td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="block-input text-right font-mono"
                      value={line.tax_rate}
                      onChange={(e) => updateLine(idx, 'tax_rate', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="p-1">
                    {/* Per-line discount % */}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      className="block-input text-right font-mono"
                      style={{ width: 70 }}
                      placeholder="Disc%"
                      title="Line discount %"
                      value={line.discount_pct || ''}
                      onChange={e => updateLine(idx, 'discount_pct', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="p-1">
                    {/* Per-line tax override */}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className="block-input text-right font-mono"
                      style={{ width: 70 }}
                      placeholder="Tax%"
                      title="Tax rate override (blank = invoice rate)"
                      value={line.tax_rate_override >= 0 ? line.tax_rate_override : ''}
                      onChange={e => {
                        const parsed = parseFloat(e.target.value);
                        const v = e.target.value === '' ? -1 : (isNaN(parsed) ? -1 : parsed);
                        updateLine(idx, 'tax_rate_override', v);
                      }}
                    />
                  </td>
                  <td className="p-1 text-right font-mono" style={{ color: 'var(--color-accent-revenue)', fontSize: 12 }}>
                    {isItem && lineTax > 0 ? `+${currencyFmt.format(lineTax)}` : '—'}
                  </td>
                  <td className="p-1 text-right font-mono font-semibold text-text-primary">
                    {isItem ? currencyFmt.format(lineTotal) : ''}
                  </td>
                  <td className="p-1">
                    <select
                      className="block-select text-xs"
                      value={line.account_id}
                      onChange={(e) => updateLine(idx, 'account_id', e.target.value)}
                    >
                      <option value="">Select account</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.code ? `${a.code} - ${a.name}` : a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1 text-center">
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      <button
                        className="text-text-muted hover:text-accent-expense transition-colors p-1"
                        onClick={() => removeLine(idx)}
                        title="Remove line"
                      >
                        <Trash2 size={13} />
                      </button>
                      {isItem && line.description.trim() && (
                        <button
                          className="text-text-muted hover:text-accent-revenue transition-colors p-1"
                          onClick={() => saveLineToCatalog(idx)}
                          title="Save to catalog"
                          disabled={savingToCatalog === idx}
                        >
                          <Star size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="px-4 py-3 border-t border-border-primary">
          <RowTypeToolbar onAdd={addLine} />
        </div>
      </div>

      {/* Footer Totals */}
      <div className="flex justify-end">
        <div className="block-card w-96 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="font-mono text-text-primary">{currencyFmt.format(subtotal)}</span>
          </div>
          {sortedTaxRates.length > 1 ? (
            sortedTaxRates.map((rate) => (
              <div key={rate} className="flex justify-between text-sm">
                <span className="text-text-secondary">Tax @ {rate}% on {currencyFmt.format(taxByRate[rate].taxable)}</span>
                <span className="font-mono text-text-primary">{currencyFmt.format(taxByRate[rate].tax)}</span>
              </div>
            ))
          ) : (
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Tax</span>
              <span className="font-mono text-text-primary">{currencyFmt.format(taxTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm items-center">
            <span className="text-text-secondary">Discount (flat)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="block-input text-right font-mono w-28"
              value={form.discount}
              onChange={(e) => updateField('discount', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="flex justify-between text-sm items-center">
            <span className="text-text-secondary">Shipping</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="block-input text-right font-mono w-28"
              value={form.shipping_amount || ''}
              placeholder="0.00"
              onChange={(e) => setForm(p => ({ ...p, shipping_amount: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div
            className="flex justify-between text-sm font-bold pt-3"
            style={{ borderTop: '1px solid var(--color-border-primary)' }}
          >
            <span className="text-text-primary">
              {form.invoice_type === 'credit_note' ? 'Credit Amount' : 'Total'}
              {form.currency !== 'USD' && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 6, color: 'var(--color-text-muted)' }}>{form.currency}</span>}
            </span>
            <span
              className="font-mono text-lg"
              style={{ color: form.invoice_type === 'credit_note' ? '#22c55e' : 'var(--color-text-primary)' }}
            >
              {form.invoice_type === 'credit_note' ? `(${currencyFmt.format(Math.abs(total))}) CR` : currencyFmt.format(total)}
            </span>
          </div>
        </div>
      </div>

      {/* Payment Schedule */}
      <div className="block-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showSchedule ? 16 : 0 }}>
          <div>
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">Payment Schedule</div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 2 }}>Split this invoice into milestone payments</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={showSchedule} onChange={(e) => setShowSchedule(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Enable</span>
          </label>
        </div>
        {showSchedule && (
          <PaymentScheduleEditor
            milestones={milestones}
            onChange={setMilestones}
            totalAmount={total}
          />
        )}
      </div>

      {/* Settings & References */}
      <div className="block-card p-5 mb-4">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
          Settings & References
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">PO Number</label>
            <input className="block-input" placeholder="Client's purchase order #" value={form.po_number} onChange={e => setForm(p => ({ ...p, po_number: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Job / Project Reference</label>
            <input className="block-input" placeholder="Internal job or project name" value={form.job_reference} onChange={e => setForm(p => ({ ...p, job_reference: e.target.value }))} />
          </div>
          {[1, 2, 3, 4].map((n) => {
            const label = (invoiceSettings as any)?.[`custom_field_${n}_label`];
            if (!label) return null;
            const key = `custom_field_${n}` as keyof InvoiceFormData;
            return (
              <div key={n}>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  {label}
                </label>
                <input
                  className="block-input"
                  value={(form[key] as string) || ''}
                  onChange={(e) => updateField(key, e.target.value)}
                />
              </div>
            );
          })}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Invoice Discount %</label>
            <input type="number" min={0} max={100} step="0.1" className="block-input" placeholder="0" value={form.discount_pct || ''} onChange={e => setForm(p => ({ ...p, discount_pct: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Late Fee %</label>
              <input type="number" min={0} step="0.1" className="block-input" placeholder="e.g. 1.5" value={form.late_fee_pct || ''} onChange={e => setForm(p => ({ ...p, late_fee_pct: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Grace Days</label>
              <input type="number" min={0} step={1} className="block-input" placeholder="0" value={form.late_fee_grace_days || ''} onChange={e => setForm(p => ({ ...p, late_fee_grace_days: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="block-card p-5 mb-4">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">Notes</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Client Notes <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, textTransform: 'none', fontSize: 11 }}>(printed on invoice)</span>
            </label>
            <textarea className="block-input" rows={3} placeholder="Notes visible to your client..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Internal Notes <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, textTransform: 'none', fontSize: 11 }}>(never printed)</span>
            </label>
            <textarea className="block-input" rows={3} placeholder="Private notes for your team..." value={form.internal_notes} onChange={e => setForm(p => ({ ...p, internal_notes: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* Terms & Conditions */}
      <div>
        <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
          Terms &amp; Conditions
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
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        className="module-header"
        style={{ flexShrink: 0, padding: '0 24px', borderBottom: '1px solid var(--color-border-primary)' }}
      >
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="block-btn p-2" title="Back">
            <ArrowLeft size={16} />
          </button>
          <h1 className="module-title text-text-primary">
            {isEdit ? 'Edit' : 'New'} {typeConfig.label} Invoice
          </h1>
        </div>
        <div className="module-actions">
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={() => setShowPreview((v) => !v)}
            title={showPreview ? 'Hide preview' : 'Show live preview'}
          >
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>
          <button className="block-btn" disabled={saving} onClick={() => handleSave(false)}>
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button className="block-btn-primary" disabled={saving} onClick={() => handleSave(true)}>
            {saving ? 'Saving...' : 'Save & Send'}
          </button>
        </div>
      </div>

      {/* Body: single-pane or split-pane */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Form pane */}
        <div
          style={{
            width: showPreview ? '540px' : '100%',
            flexShrink: 0,
            overflowY: 'auto',
            borderRight: showPreview ? '1px solid var(--color-border-primary)' : 'none',
          }}
        >
          {formContent}
        </div>

        {/* Preview pane */}
        {showPreview && (
          <div style={{ flex: 1, overflow: 'hidden', background: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 12px', fontSize: '11px', color: '#64748b', fontWeight: 600, background: '#e2e8f0', borderBottom: '1px solid #cbd5e1', flexShrink: 0 }}>
              LIVE PREVIEW
            </div>
            <iframe
              srcDoc={previewHTML}
              title="Invoice Preview"
              style={{ flex: 1, border: 'none', width: '100%', background: '#fff' }}
              sandbox="allow-same-origin"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceForm;
