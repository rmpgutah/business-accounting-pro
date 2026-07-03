import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Receipt, DollarSign, Paperclip, X, Plus, Trash2, FileText, AlertTriangle, Sparkles } from 'lucide-react';
import api from '../../lib/api';
import { required, validateForm, minValue } from '../../lib/validation';
import { useCompanyStore } from '../../stores/companyStore';
import { CategoryContext } from '../../components/ContextPanel';
import { FieldLabel } from '../../components/FieldLabel';
import { formatCurrency, roundCents } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';
import ErrorBanner from '../../components/ErrorBanner';
import { generateExpenseReceiptHTML } from '../../lib/print-templates';
import {
  ReceiptZone, MileagePanel, PerDiemPanel, FuelPanel, EntryModeBar, TaxBasisBar,
  CurrencySelector, NotesMemoField, TagsAutocomplete, fuzzyVendorMatches,
  QuickVendorModal, IRS_MILEAGE_RATE_2026, PER_DIEM_RATES,
} from './CaptureFeatures';
import {
  SCHEDULE_C_LINES, IRS_RECEIPT_THRESHOLD, IRS_RECEIPT_RETENTION_YEARS, computeReceiptExpiry,
} from '../../lib/irs-rates';
import {
  CategoryRow, buildCategoryTree, flattenCategoryTree, suggestCategoryForVendor,
  categoryMonthlyUsage, parseJSON, CustomFieldDef,
} from './expense-helpers';
import { useSuggestedCategory } from '../../components/SmartDefaultsHook';
import ItemizationEditor from './ItemizationEditor';

// ─── Types ──────────────────────────────────────────────
interface ExpenseFormData {
  date: string;
  amount: string;
  tax_amount: string;
  description: string;
  category_id: string;
  account_id: string;
  vendor_id: string;
  payment_method: string;
  project_id: string;
  client_id: string;
  is_billable: boolean;
  is_reimbursable: boolean;
  reimbursed: boolean;
  reimbursed_date: string;
  reference: string;
  tags: string;
  status: string;
  approved_by: string;
  approved_date: string;
  rejection_reason: string;
  // ── new tax / categorization / compliance fields ──
  expense_class: string;
  is_tax_deductible: boolean;
  schedule_c_line: string;
  foreign_tax_amount: string;
  tax_year_override: string;
  currency: string;
  lost_receipt_affidavit: string;
  // ── capture features (#4-7, #14, #21, #25) ──
  exchange_rate: string;
  tax_inclusive: boolean;
  tax_rate: string;
  entry_mode: 'standard' | 'mileage' | 'per_diem' | 'fuel';
  odometer_start: string;
  odometer_end: string;
  miles: string;
  mileage_rate: string;
  per_diem_location: string;
  per_diem_days: string;
  per_diem_rate: string;
  // Fuel mode (#.### precision on gallons + price). Stored as string so the
  // user's typed value round-trips without floating-point reformat.
  fuel_gallons: string;
  fuel_price_per_gallon: string;
  fuel_grade: string;
  fuel_vehicle: string;
  fuel_odometer: string;
  fuel_station: string;
  notes: string;
  vat_gst: string;
  // Header-level discount (post-Itemization Wave). Applied AFTER tax — does
  // not reduce taxable base. Both fields are independent: $ + % both subtract.
  discount_amount: string;
  discount_percent: string;
  // Loan Linkage Wave (F1053-F1062) — soft FK to a loan record. When set,
  // this expense is treated as the interest-portion bookkeeping of a loan
  // payment and is surfaced on the Loan Detail page.
  related_loan_id: string;
  // Merchant / location / markup fields — user-facing columns that existed
  // in the DB but had no form input until now.
  merchant_location: string;
  geo_location_name: string;
  markup_pct: string;
  employee_id: string;
  // Shipping & Handling. shipping_scope 'order' applies to the whole expense;
  // 'item' attributes it to the line in shipping_line_ref. shipping_taxable
  // makes the server compute shipping tax at the effective goods rate.
  shipping_amount: string;
  shipping_speed: string;
  shipping_taxable: boolean;
  shipping_scope: 'order' | 'item';
  shipping_line_ref: string;
}

// Shipping speed presets. Free-form not needed — these cover carrier tiers and
// the "no shipping" cases (digital goods / in-store pickup).
const SHIPPING_SPEEDS = [
  'Standard', 'Economy', 'Expedited', 'Two-Day', 'Overnight',
  'Freight / LTL', 'In-Store Pickup', 'Digital / No Shipping',
];

interface DropdownOption {
  id: string;
  name: string;
}

interface ExpenseFormProps {
  expenseId?: string | null;
  onBack: () => void;
  onSaved: () => void;
}

// ─── Expense Line Item ─────────────────────────────────
interface ExpenseLineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  account_id: string;
  tax_rate: number;
  tax_amount: number;
  tax_jurisdictions: Array<{ jurisdiction: string; rate: number; amount: number }>;
  // Itemization Wave (F841-F862) — per-line accounting + flags
  category_id?: string;
  project_id?: string;
  client_id?: string;
  discount_amount?: number;
  discount_percent?: number;
  is_tax_deductible?: boolean;
  is_tax_exempt?: boolean;
  notes?: string;
  item_type?: 'item' | 'service' | 'reimbursement';
  tags?: string[];
  // Per-line billable-to-client. Independent of the header is_billable so a
  // single expense can mix billable and non-billable items. billed_invoice_id
  // is stamped when the line is added to an invoice (suppresses re-billing).
  is_billable?: boolean;
  billed_invoice_id?: string | null;
}

function newLineItem(): ExpenseLineItem {
  return {
    id: crypto.randomUUID(), description: '', quantity: 1, unit_price: 0, amount: 0, account_id: '',
    tax_rate: 0, tax_amount: 0, tax_jurisdictions: [],
    // New per-line defaults: tax-deductible YES (most expenses are), item_type 'item'.
    category_id: '', project_id: '', client_id: '',
    discount_amount: 0, discount_percent: 0,
    is_tax_deductible: true, is_tax_exempt: false,
    notes: '', item_type: 'item', tags: [],
  };
}

// ─── Category-Specific Detail Fields ───────────────────
interface DetailField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'textarea';
  placeholder?: string;
  options?: string[];
}

const CATEGORY_DETAIL_FIELDS: Record<string, DetailField[]> = {
  // Electronics / Technology
  electronics: [
    { key: 'serial_number', label: 'Serial Number', type: 'text', placeholder: 'S/N' },
    { key: 'imei', label: 'IMEI', type: 'text', placeholder: 'IMEI number' },
    { key: 'model', label: 'Model / Product Name', type: 'text', placeholder: 'e.g. MacBook Pro 16"' },
    { key: 'warranty_expiration', label: 'Warranty Expiration', type: 'date' },
    { key: 'condition', label: 'Condition', type: 'select', options: ['new', 'used', 'refurbished'] },
  ],
  technology: [
    { key: 'serial_number', label: 'Serial Number', type: 'text', placeholder: 'S/N' },
    { key: 'imei', label: 'IMEI', type: 'text', placeholder: 'IMEI number' },
    { key: 'model', label: 'Model / Product Name', type: 'text', placeholder: 'e.g. iPhone 16 Pro' },
    { key: 'warranty_expiration', label: 'Warranty Expiration', type: 'date' },
    { key: 'condition', label: 'Condition', type: 'select', options: ['new', 'used', 'refurbished'] },
  ],
  // Food / Meals / Entertainment
  food: [
    { key: 'attendees', label: 'Attendees', type: 'text', placeholder: 'Names of people present' },
    { key: 'business_purpose', label: 'Business Purpose', type: 'text', placeholder: 'e.g. Client dinner, team lunch' },
    { key: 'restaurant', label: 'Restaurant / Venue', type: 'text', placeholder: 'Name of establishment' },
    { key: 'num_guests', label: 'Number of Guests', type: 'number', placeholder: '0' },
  ],
  meals: [
    { key: 'attendees', label: 'Attendees', type: 'text', placeholder: 'Names of people present' },
    { key: 'business_purpose', label: 'Business Purpose', type: 'text', placeholder: 'e.g. Client dinner, team lunch' },
    { key: 'restaurant', label: 'Restaurant / Venue', type: 'text', placeholder: 'Name of establishment' },
    { key: 'num_guests', label: 'Number of Guests', type: 'number', placeholder: '0' },
  ],
  entertainment: [
    { key: 'attendees', label: 'Attendees', type: 'text', placeholder: 'Names of people present' },
    { key: 'business_purpose', label: 'Business Purpose', type: 'text', placeholder: 'Purpose of entertainment' },
    { key: 'restaurant', label: 'Venue', type: 'text', placeholder: 'Name of venue' },
    { key: 'num_guests', label: 'Number of Guests', type: 'number', placeholder: '0' },
  ],
  // Travel / Transportation
  travel: [
    { key: 'destination', label: 'Destination', type: 'text', placeholder: 'City, state or address' },
    { key: 'departure_date', label: 'Departure Date', type: 'date' },
    { key: 'return_date', label: 'Return Date', type: 'date' },
    { key: 'mileage', label: 'Mileage', type: 'number', placeholder: '0' },
    { key: 'trip_purpose', label: 'Trip Purpose', type: 'text', placeholder: 'e.g. Client visit, conference' },
  ],
  transportation: [
    { key: 'destination', label: 'Destination', type: 'text', placeholder: 'City, state or address' },
    { key: 'mileage', label: 'Mileage', type: 'number', placeholder: '0' },
    { key: 'trip_purpose', label: 'Trip Purpose', type: 'text', placeholder: 'Reason for travel' },
  ],
  // Office Supplies / Equipment
  'office supplies': [
    { key: 'item_name', label: 'Item Name', type: 'text', placeholder: 'e.g. Printer paper, toner' },
    { key: 'quantity', label: 'Quantity', type: 'number', placeholder: '1' },
    { key: 'unit_cost', label: 'Unit Cost', type: 'number', placeholder: '0.00' },
    { key: 'supplier', label: 'Supplier / Store', type: 'text', placeholder: 'e.g. Staples, Amazon' },
  ],
  equipment: [
    { key: 'item_name', label: 'Item Name', type: 'text', placeholder: 'Equipment description' },
    { key: 'serial_number', label: 'Serial Number', type: 'text', placeholder: 'S/N' },
    { key: 'warranty_expiration', label: 'Warranty Expiration', type: 'date' },
    { key: 'supplier', label: 'Supplier', type: 'text', placeholder: 'Purchased from' },
  ],
  // Professional Services
  'professional services': [
    { key: 'service_provider', label: 'Service Provider', type: 'text', placeholder: 'Name of provider' },
    { key: 'contract_number', label: 'Contract / Agreement #', type: 'text', placeholder: 'Contract reference' },
    { key: 'service_start', label: 'Service Period Start', type: 'date' },
    { key: 'service_end', label: 'Service Period End', type: 'date' },
    { key: 'scope_of_work', label: 'Scope of Work', type: 'textarea', placeholder: 'Description of services rendered' },
  ],
  services: [
    { key: 'service_provider', label: 'Service Provider', type: 'text', placeholder: 'Name of provider' },
    { key: 'contract_number', label: 'Contract / Agreement #', type: 'text', placeholder: 'Contract reference' },
    { key: 'service_start', label: 'Service Period Start', type: 'date' },
    { key: 'service_end', label: 'Service Period End', type: 'date' },
    { key: 'scope_of_work', label: 'Scope of Work', type: 'textarea', placeholder: 'Description of services rendered' },
  ],
  // Vehicle / Auto
  vehicle: [
    { key: 'license_plate', label: 'License Plate', type: 'text', placeholder: 'Plate number' },
    { key: 'vin', label: 'VIN', type: 'text', placeholder: 'Vehicle identification number' },
    { key: 'odometer', label: 'Odometer Reading', type: 'number', placeholder: '0' },
    { key: 'service_type', label: 'Service Type', type: 'select', options: ['fuel', 'maintenance', 'repair', 'insurance', 'registration'] },
  ],
  auto: [
    { key: 'license_plate', label: 'License Plate', type: 'text', placeholder: 'Plate number' },
    { key: 'vin', label: 'VIN', type: 'text', placeholder: 'Vehicle identification number' },
    { key: 'odometer', label: 'Odometer Reading', type: 'number', placeholder: '0' },
    { key: 'service_type', label: 'Service Type', type: 'select', options: ['fuel', 'maintenance', 'repair', 'insurance', 'registration'] },
  ],
  // Rent / Utilities
  rent: [
    { key: 'property_address', label: 'Property Address', type: 'text', placeholder: 'Address' },
    { key: 'billing_period', label: 'Billing Period', type: 'text', placeholder: 'e.g. March 2026' },
    { key: 'account_number', label: 'Account Number', type: 'text', placeholder: 'Utility account #' },
  ],
  utilities: [
    { key: 'property_address', label: 'Property Address', type: 'text', placeholder: 'Address' },
    { key: 'billing_period', label: 'Billing Period', type: 'text', placeholder: 'e.g. March 2026' },
    { key: 'account_number', label: 'Account Number', type: 'text', placeholder: 'Utility account #' },
    { key: 'meter_reading', label: 'Meter Reading', type: 'number', placeholder: '0' },
  ],
};

// Fallback detail fields for any category not explicitly mapped
const DEFAULT_DETAIL_FIELDS: DetailField[] = [
  { key: 'receipt_items', label: 'Receipt Items', type: 'textarea', placeholder: 'List items from receipt (one per line)' },
  { key: 'detail_notes', label: 'Additional Notes', type: 'textarea', placeholder: 'Any additional details' },
];

function getDetailFieldsForCategory(categoryName: string): DetailField[] {
  const key = categoryName.toLowerCase().trim();
  // Try exact match first, then partial match
  if (CATEGORY_DETAIL_FIELDS[key]) return CATEGORY_DETAIL_FIELDS[key];
  for (const [k, fields] of Object.entries(CATEGORY_DETAIL_FIELDS)) {
    if (key.includes(k) || k.includes(key)) return fields;
  }
  return DEFAULT_DETAIL_FIELDS;
}

const PAYMENT_METHODS = [
  { value: '', label: 'Select method...' },
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'other', label: 'Other' },
];

const emptyForm: ExpenseFormData = {
  // DATE: Item #2 — local-time today.
  date: todayLocal(),
  amount: '',
  tax_amount: '',
  description: '',
  category_id: '',
  account_id: '',
  vendor_id: '',
  payment_method: '',
  project_id: '',
  client_id: '',
  is_billable: false,
  is_reimbursable: false,
  reimbursed: false,
  reimbursed_date: '',
  reference: '',
  tags: '',
  status: 'pending',
  approved_by: '',
  approved_date: '',
  rejection_reason: '',
  expense_class: '',
  is_tax_deductible: true,
  schedule_c_line: '',
  foreign_tax_amount: '',
  tax_year_override: '',
  currency: 'USD',
  lost_receipt_affidavit: '',
  exchange_rate: '1',
  // FINAL-PRICE: default tax_inclusive=true so the AMOUNT field's value matches
  // what the user actually paid (e.g., $71.03), with tax computed/shown as a
  // breakdown line below. Exclusive mode still available via the radio toggle
  // for users who prefer entering pre-tax + adding tax on top (US sales-tax style).
  tax_inclusive: true,
  tax_rate: '',
  entry_mode: 'standard',
  odometer_start: '',
  odometer_end: '',
  miles: '',
  mileage_rate: String(IRS_MILEAGE_RATE_2026),
  per_diem_location: 'Default (CONUS)',
  per_diem_days: '',
  per_diem_rate: String(PER_DIEM_RATES['Default (CONUS)']),
  fuel_gallons: '',
  fuel_price_per_gallon: '',
  fuel_grade: 'regular',
  fuel_vehicle: '',
  fuel_odometer: '',
  fuel_station: '',
  notes: '',
  vat_gst: '',
  discount_amount: '',
  discount_percent: '',
  related_loan_id: '',
  merchant_location: '',
  geo_location_name: '',
  markup_pct: '',
  employee_id: '',
  shipping_amount: '',
  shipping_speed: '',
  shipping_taxable: false,
  shipping_scope: 'order',
  shipping_line_ref: '',
};

// ─── Attached Documents (for receipt linking) ─────────
const AttachedDocs: React.FC<{ expenseId: string }> = ({ expenseId }) => {
  const [docs, setDocs] = useState<any[]>([]);
  useEffect(() => {
    api.rawQuery("SELECT * FROM documents WHERE entity_type = 'expense' AND entity_id = ?", [expenseId])
      .then(r => setDocs(Array.isArray(r) ? r : []))
      .catch(() => {});
  }, [expenseId]);
  if (docs.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-text-muted font-semibold uppercase tracking-wider">Attached Documents</p>
      {docs.map((d: any) => (
        <div key={d.id} className="flex items-center gap-2 text-xs text-text-secondary">
          <FileText size={12} className="text-accent-blue" />
          <span className="truncate">{d.filename}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const ExpenseForm: React.FC<ExpenseFormProps> = ({ expenseId, onBack, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [form, setForm] = useState<ExpenseFormData>({ ...emptyForm });
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [accounts, setAccounts] = useState<DropdownOption[]>([]);
  // Tracks whether the current account_id was auto-suggested from the category
  // (so re-picking a category re-suggests, but a manual pick is never clobbered).
  const [accountAutoSet, setAccountAutoSet] = useState(false);
  const [vendors, setVendors] = useState<Array<DropdownOption & { is_1099_eligible?: number; w9_status?: string }>>([]);
  const [vendorLocations, setVendorLocations] = useState<Array<{ id: string; name: string; location_type: string; address_line1: string; city: string }>>([]);
  const [projects, setProjects] = useState<DropdownOption[]>([]);
  const [clients, setClients] = useState<DropdownOption[]>([]);
  // Loan Linkage: loans list for the "Linked to Loan" picker. Only active
  // loans are loaded — closed/refinanced loans rarely need new payment links.
  const [loans, setLoans] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [receiptPath, setReceiptPath] = useState<string>('');
  // B5 — OCR scan state
  const [ocrBusy, setOcrBusy] = useState(false);
  // F25 — Auto-fill from attached receipt: holds the parsed suggestions
  // so the panel can show real values + offer an "Apply" button instead
  // of the old placeholder em-dashes. Cleared on receipt change.
  const [ocrSuggestions, setOcrSuggestions] = useState<any | null>(null);
  const [ocrSuggestBusy, setOcrSuggestBusy] = useState(false);
  const [ocrSuggestError, setOcrSuggestError] = useState<string | null>(null);
  // Invalidate suggestions whenever the underlying receipt changes,
  // so the user never sees OCR results from an older file.
  useEffect(() => { setOcrSuggestions(null); setOcrSuggestError(null); }, [receiptPath]);
  const [details, setDetails] = useState<Record<string, any>>({});
  const [useLineItems, setUseLineItems] = useState(false);
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([]);
  // ── new state ──
  const [suggestedCategoryId, setSuggestedCategoryId] = useState<string>('');
  const [categoryUsage, setCategoryUsage] = useState<{ count: number; total: number }>({ count: 0, total: 0 });
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [showAffidavit, setShowAffidavit] = useState(false);
  const [affidavit, setAffidavit] = useState({
    statement: '', signed_name: '', signed_date: todayLocal(),
  });
  // ── capture-feature state ──
  const [extraReceipts, setExtraReceipts] = useState<string[]>([]);
  const [vendorText, setVendorText] = useState('');
  const [showQuickVendor, setShowQuickVendor] = useState(false);
  const [vendorSuggestion, setVendorSuggestion] = useState<DropdownOption | null>(null);
  const [priorExpense, setPriorExpense] = useState<any>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurringFreq, setRecurringFreq] = useState<'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annually'>('monthly');

  const isEditing = !!expenseId;

  // Auto-calculate totals from line items.
  // MATH: expense.amount stores the POST-line-discount PRE-TAX subtotal;
  // expense.tax_amount stores the tax separately (tax is computed on
  // post-line-discount pre-tax per ItemizationEditor's lineEffective formula).
  // We expose four values: gross subtotal (qty × price), line discount total,
  // tax total, grand total (post-discount + tax). All views (form AMOUNT field,
  // ItemizationEditor totals box, list display, detail hero) MUST roll up the
  // same way or you get the bug where the editor shows $26.98 but the form
  // and list show $29.98.
  const lineItemSubtotal = useMemo(() =>
    lineItems.reduce((sum, li) => sum + roundCents(li.quantity * li.unit_price), 0),
    [lineItems]
  );
  // Sum of per-line discounts (flat $ takes priority over % per ItemizationEditor).
  const lineItemDiscountTotal = useMemo(() =>
    lineItems.reduce((sum, li) => {
      const sub = roundCents((li.quantity || 0) * (li.unit_price || 0));
      const flat = Number(li.discount_amount || 0);
      const pct = Number(li.discount_percent || 0);
      const disc = flat > 0 ? roundCents(flat) : pct > 0 ? roundCents(sub * (pct / 100)) : 0;
      return sum + disc;
    }, 0),
    [lineItems]
  );
  const lineItemTaxTotal = useMemo(() =>
    lineItems.reduce((sum, li) => sum + roundCents(li.tax_amount || 0), 0),
    [lineItems]
  );
  // GRAND TOTAL: post-discount subtotal + tax. Equals ItemizationEditor's
  // internal lineEffective.total sum, so the form's AMOUNT field and the
  // editor's totals box always agree.
  const lineItemGrandTotal = useMemo(() =>
    roundCents(lineItemSubtotal - lineItemDiscountTotal + lineItemTaxTotal),
    [lineItemSubtotal, lineItemDiscountTotal, lineItemTaxTotal]
  );
  // Saved as expense.amount — POST-line-discount PRE-TAX subtotal.
  // Display formula then adds back tax and subtracts header discount:
  //   final = expense.amount + expense.tax_amount − header_discount
  const lineItemTotal = useMemo(() =>
    roundCents(lineItemSubtotal - lineItemDiscountTotal),
    [lineItemSubtotal, lineItemDiscountTotal]
  );

  useEffect(() => {
    if (useLineItems && lineItems.length > 0) {
      // FINAL-PRICE: AMOUNT field shows the all-in TOTAL (subtotal + tax) so it
      // matches the receipt the user is looking at. The save path stores
      // expense.amount as the pre-tax subtotal (lineItemTotal in payload).
      setForm(prev => ({
        ...prev,
        amount: lineItemGrandTotal.toFixed(2),
        tax_amount: lineItemTaxTotal.toFixed(2),
      }));
    }
  }, [lineItemSubtotal, lineItemTaxTotal, lineItemGrandTotal, useLineItems]);

  // ── AUTO-COMPUTE TAX AMOUNT in NON-itemized mode ──────────
  // FINAL-PRICE MATH:
  //   - tax_inclusive=true  → form.amount IS the all-in TOTAL the user paid.
  //                           tax = total × rate / (100 + rate)   [extracts tax]
  //                           pre-tax (saved as expense.amount) = total - tax
  //   - tax_inclusive=false → form.amount is PRE-TAX. tax added on top.
  //                           tax = amount × rate / 100
  // Default is tax_inclusive=true so the AMOUNT field matches the receipt total.
  useEffect(() => {
    if (useLineItems) return; // line-items mode handled above
    const amount = parseFloat(form.amount) || 0;
    const rate = parseFloat(form.tax_rate) || 0;
    if (rate <= 0 || amount <= 0) return;
    const computed = form.tax_inclusive
      ? amount * rate / (100 + rate)            // tax-inclusive: extract from total
      : amount * (rate / 100);                  // tax-exclusive: add on top of pre-tax
    const rounded = roundCents(computed).toFixed(2);
    // Only update if different — prevents render loops.
    if (rounded !== form.tax_amount) {
      setForm(prev => ({ ...prev, tax_amount: rounded }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.amount, form.tax_rate, form.tax_inclusive, useLineItems]);

  // Line item handlers
  const handleLineChange = (index: number, field: keyof ExpenseLineItem, value: any) => {
    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      const subtotal = roundCents(updated[index].quantity * updated[index].unit_price);
      updated[index].amount = subtotal;
      // Recompute tax_amount whenever rate or jurisdictions change.
      // NOTE: rates here are now PERCENT (e.g. 7.65), matching the top-level
      // tax_rate input. So we divide by 100 when applying to subtotal.
      const jurisdictions = updated[index].tax_jurisdictions || [];
      if (jurisdictions.length > 0) {
        const jTotal = jurisdictions.reduce((s, j) => s + roundCents(subtotal * ((j.rate || 0) / 100)), 0);
        updated[index].tax_amount = jTotal;
        updated[index].tax_rate = jurisdictions.reduce((s, j) => s + (j.rate || 0), 0);
        updated[index].tax_jurisdictions = jurisdictions.map(j => ({ ...j, amount: roundCents(subtotal * ((j.rate || 0) / 100)) }));
      } else {
        updated[index].tax_amount = roundCents(subtotal * ((updated[index].tax_rate || 0) / 100));
      }
      return updated;
    });
  };
  const addLineItem = () => setLineItems(prev => [...prev, newLineItem()]);
  const removeLineItem = (index: number) => setLineItems(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index));
  const moveLineItem = (from: number, to: number) => {
    setLineItems(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
  };

  // Determine which detail fields to show based on selected category
  const selectedCategory = categories.find(c => c.id === form.category_id);
  const detailFields = selectedCategory ? getDetailFieldsForCategory(selectedCategory.name) : [];

  // Feature 1 — parent-grouped category tree, active-only for dropdown
  const activeCategoryTree = useMemo(() => buildCategoryTree(
    categories.filter(c => c.is_active === undefined || !!c.is_active)
  ), [categories]);
  const flatCategoryOptions = useMemo(() => flattenCategoryTree(activeCategoryTree), [activeCategoryTree]);
  // Feature 9 — keep historical category visible even if inactive
  const renderableCategoryOptions = useMemo(() => {
    if (!form.category_id) return flatCategoryOptions;
    if (flatCategoryOptions.some(c => c.id === form.category_id)) return flatCategoryOptions;
    const hist = categories.find(c => c.id === form.category_id);
    if (!hist) return flatCategoryOptions;
    return [
      { ...hist, children: [], fullPath: `(inactive) ${hist.name}` },
      ...flatCategoryOptions,
    ];
  }, [flatCategoryOptions, categories, form.category_id]);

  // Feature 4 — auto-suggestion based on vendor history
  useEffect(() => {
    if (!form.vendor_id) { setSuggestedCategoryId(''); return; }
    suggestCategoryForVendor(form.vendor_id).then(id => setSuggestedCategoryId(id || ''));
  }, [form.vendor_id]);

  // IntelligenceService smart-default: auto-fill category when vendor changes
  // and no category is yet selected. Uses the IPC-backed pattern store.
  const suggested = useSuggestedCategory(form.vendor_id);
  useEffect(() => {
    if (suggested && !form.category_id) {
      setForm(f => ({ ...f, category_id: suggested }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  // Capture #11: prior expense lookup for "copy from prior" / auto-fill
  useEffect(() => {
    if (!form.vendor_id) { setPriorExpense(null); return; }
    api.rawQuery('SELECT * FROM expenses WHERE vendor_id = ? AND id != ? ORDER BY date DESC LIMIT 1',
      [form.vendor_id, expenseId || '']).then((rows: any[]) => {
        setPriorExpense(Array.isArray(rows) && rows[0] ? rows[0] : null);
      }).catch(() => setPriorExpense(null));
  }, [form.vendor_id, expenseId]);

  // Capture #18: smart vendor matching for free-text input
  useEffect(() => {
    if (form.vendor_id || !vendorText) { setVendorSuggestion(null); return; }
    const matches = fuzzyVendorMatches(vendorText, vendors);
    setVendorSuggestion(matches[0] || null);
  }, [vendorText, vendors, form.vendor_id]);

  // Capture #6/#7: auto-compute amount for mileage / per-diem mode
  useEffect(() => {
    if (form.entry_mode === 'mileage') {
      const start = parseFloat(form.odometer_start) || 0;
      const end = parseFloat(form.odometer_end) || 0;
      const computedMiles = end > start ? end - start : (parseFloat(form.miles) || 0);
      const rate = parseFloat(form.mileage_rate) || 0;
      const amt = roundCents(computedMiles * rate);
      if (amt > 0) setForm(p => ({
        ...p,
        miles: computedMiles ? String(computedMiles) : p.miles,
        amount: amt.toFixed(2),
      }));
    } else if (form.entry_mode === 'per_diem') {
      const days = parseFloat(form.per_diem_days) || 0;
      const rate = parseFloat(form.per_diem_rate) || 0;
      const amt = roundCents(days * rate);
      if (amt > 0) setForm(p => ({ ...p, amount: amt.toFixed(2) }));
    } else if (form.entry_mode === 'fuel') {
      // Fuel: gallons × price-per-gallon, both at 3-decimal precision.
      // Round only at the final cents boundary so 12.347 × 3.459 = 42.69
      // (not 42.690273 then rounded — same result here, but matters near
      // half-cent boundaries on bigger fills).
      const gallons = parseFloat(form.fuel_gallons) || 0;
      const price = parseFloat(form.fuel_price_per_gallon) || 0;
      const amt = roundCents(gallons * price);
      if (amt > 0) setForm(p => ({ ...p, amount: amt.toFixed(2) }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.entry_mode, form.odometer_start, form.odometer_end, form.mileage_rate, form.per_diem_days, form.per_diem_rate, form.fuel_gallons, form.fuel_price_per_gallon]);

  // Feature 8 — usage stats for selected category in current month
  useEffect(() => {
    if (!activeCompany || !form.category_id) { setCategoryUsage({ count: 0, total: 0 }); return; }
    categoryMonthlyUsage(activeCompany.id, form.category_id).then(setCategoryUsage);
  }, [activeCompany, form.category_id]);

  // Feature 5 — suggest the category's default expense account. Re-suggests on
  // every category change UNLESS the user manually picked an account (tracked
  // via accountAutoSet), so changing the category narrows the account for you.
  useEffect(() => {
    if (!selectedCategory) return;
    const def = (selectedCategory as any).default_account_id;
    if (def && (!form.account_id || accountAutoSet)) {
      setForm(p => ({ ...p, account_id: def }));
      setAccountAutoSet(true);
    }
  }, [form.category_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feature 17 / 18 — denormalize vendor 1099 / w9 status when vendor changes
  const selectedVendor = vendors.find(v => v.id === form.vendor_id);

  // Multi-location: load locations whenever the vendor changes
  useEffect(() => {
    if (!form.vendor_id) { setVendorLocations([]); return; }
    api.vendorLocationsList(form.vendor_id).then((rows: any) => {
      setVendorLocations(Array.isArray(rows) ? rows : []);
    }).catch(() => setVendorLocations([]));
  }, [form.vendor_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feature 3 — budget cap warning (>= 80% of monthly_cap)
  const capWarning = useMemo(() => {
    if (!selectedCategory) return null;
    const cap = Number((selectedCategory as any).monthly_cap || 0);
    if (cap <= 0) return null;
    const pct = cap > 0 ? (categoryUsage.total / cap) * 100 : 0;
    if (pct < 80) return null;
    return { cap, pct, total: categoryUsage.total, over: categoryUsage.total > cap };
  }, [selectedCategory, categoryUsage]);

  // Feature 21 — lost-receipt affidavit auto-trigger
  const amountValue = useLineItems ? lineItemTotal : (parseFloat(form.amount) || 0);
  const requiresAffidavit = !receiptPath && amountValue > IRS_RECEIPT_THRESHOLD;
  // Feature 22 — receipt expiry
  const receiptExpiresOn = computeReceiptExpiry(form.date);

  // Feature 24 — required-field policy from category
  const requiredCustomKeys: string[] = useMemo(() => {
    if (!selectedCategory) return [];
    return parseJSON<string[]>((selectedCategory as any).required_fields, []);
  }, [selectedCategory]);

  const handleDetailChange = (key: string, value: any) => {
    setDetails(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        // Bug fix #11: all 5 reference queries were missing company_id —
        // showed cross-company data in dropdowns.
        const cid = activeCompany.id;

        // Critical: categories + accounts needed for form validation
        const [catData, accData, defData] = await Promise.all([
          api.query('categories', { company_id: cid, type: 'expense' }),
          api.query('accounts', { company_id: cid, type: 'expense' }),
          api.query('custom_field_defs', { company_id: cid, entity_type: 'expense' }, { field: 'sort_order', dir: 'asc' }),
        ]);
        if (cancelled) return;

        setCategories(Array.isArray(catData) ? catData : []);
        setAccounts(Array.isArray(accData) ? accData : []);
        setCustomFieldDefs(Array.isArray(defData) ? defData.map((d: any) => ({
          ...d, options: parseJSON<string[]>(d.options, []),
        })) : []);

        // Non-critical secondary data — failures don't hide primary content
        api.rawQuery(`SELECT id, name, is_1099_eligible, w9_status FROM vendors WHERE company_id = ?`, [cid])
          .then((r: any) => { if (!cancelled) setVendors(Array.isArray(r) ? r : []); })
          .catch(() => {});
        api.query('projects', { company_id: cid })
          .then(r => { if (!cancelled) setProjects(Array.isArray(r) ? r : []); })
          .catch(() => {});
        api.query('clients', { company_id: cid })
          .then(r => { if (!cancelled) setClients(Array.isArray(r) ? r : []); })
          .catch(() => {});
        // Loan Linkage: load active loans so users can link a payment expense
        // to a loan. Uses rawQuery (rather than api.loansList) because that
        // helper applies additional filtering and we want everything active.
        api.rawQuery(`SELECT id, name FROM loans WHERE company_id = ? AND status = 'active' AND (deleted_at IS NULL) ORDER BY name`, [cid])
          .then((r: any) => { if (!cancelled) setLoans(Array.isArray(r) ? r : []); })
          .catch(() => {});
        // Tag autocomplete corpus (#22)
        api.rawQuery('SELECT tags FROM expenses WHERE company_id = ? AND tags IS NOT NULL', [cid])
          .then((rows: any[]) => {
            if (cancelled || !Array.isArray(rows)) return;
            const set = new Set<string>();
            for (const r of rows) {
              try {
                const t = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
                if (Array.isArray(t)) t.forEach((x: string) => x && set.add(String(x).trim()));
              } catch { /* */ }
            }
            setAllTags(Array.from(set).sort());
          }).catch(() => {});

        if (expenseId) {
          const existing = await api.get('expenses', expenseId);
          if (existing && !cancelled) {
            setReceiptPath(existing.receipt_path || '');
            // Restore custom_fields details
            try {
              const cf = typeof existing.custom_fields === 'string' ? JSON.parse(existing.custom_fields) : (existing.custom_fields || {});
              setDetails(cf);
            } catch { setDetails({}); }
            // FINAL-PRICE v2: AMOUNT field shows all-in TOTAL = stored amount + tax.
            // The earlier inclusive-guard was for legacy rows where amount=total,
            // but it under-counted new inclusive saves which ALSO store amount=pre-tax.
            // Dropping the guard makes load consistent with our save semantics.
            const storedAmount = Number(existing.amount) || 0;
            const storedTax = Number(existing.tax_amount) || 0;
            const displayTotal = storedAmount + storedTax;
            setForm({
              date: existing.date || emptyForm.date,
              amount: displayTotal ? displayTotal.toFixed(2) : '',
              tax_amount: existing.tax_amount?.toString() || '',
              description: existing.description || '',
              category_id: existing.category_id || '',
              account_id: existing.account_id || '',
              vendor_id: existing.vendor_id || '',
              payment_method: existing.payment_method || '',
              project_id: existing.project_id || '',
              client_id: existing.client_id || '',
              is_billable: !!existing.is_billable,
              is_reimbursable: !!existing.is_reimbursable,
              reimbursed: !!existing.reimbursed,
              reimbursed_date: existing.reimbursed_date || '',
              reference: existing.reference || '',
              // TAGS DOUBLE-ENCODING RECOVERY: prior code stored tags as a JSON
              // string ('[]'), then re-split on comma into ['[]'], then JSON-
              // stringified again ('["[]"]'). Every cycle added a wrap layer.
              // Here we detect JSON-array strings and unwrap them so the form
              // shows the actual tags, and the next save writes clean values.
              tags: (() => {
                const raw = existing.tags;
                if (Array.isArray(raw)) return raw.filter(Boolean).join(', ');
                const s = String(raw || '').trim();
                if (s.startsWith('[')) {
                  try {
                    const parsed = JSON.parse(s);
                    if (Array.isArray(parsed)) {
                      // Recurse one level — if any element is itself a JSON array string,
                      // unwrap that too (recovers from N-level nesting in one pass).
                      const flat = parsed.flatMap((v: any) => {
                        if (typeof v === 'string' && v.trim().startsWith('[')) {
                          try {
                            const inner = JSON.parse(v);
                            if (Array.isArray(inner)) return inner;
                          } catch (_) {}
                        }
                        return [v];
                      });
                      return flat.filter(Boolean).map(String).join(', ');
                    }
                  } catch (_) {}
                }
                return s;
              })(),
              status: existing.status || 'pending',
              approved_by: existing.approved_by || '',
              approved_date: existing.approved_date || '',
              rejection_reason: existing.rejection_reason || '',
              expense_class: existing.expense_class || '',
              is_tax_deductible: existing.is_tax_deductible == null ? true : !!existing.is_tax_deductible,
              schedule_c_line: existing.schedule_c_line || '',
              foreign_tax_amount: existing.foreign_tax_amount?.toString() || '',
              tax_year_override: existing.tax_year_override ? String(existing.tax_year_override) : '',
              currency: existing.currency || 'USD',
              lost_receipt_affidavit: existing.lost_receipt_affidavit || '',
              exchange_rate: (existing.exchange_rate ?? 1).toString(),
              tax_inclusive: !!existing.tax_inclusive,
              tax_rate: existing.tax_rate?.toString() || '',
              // Header-level discount (load — empty string when 0 so input shows placeholder)
              discount_amount: existing.discount_amount ? String(existing.discount_amount) : '',
              discount_percent: existing.discount_percent ? String(existing.discount_percent) : '',
              // Loan Linkage — soft FK
              related_loan_id: existing.related_loan_id || '',
              merchant_location: existing.merchant_location || '',
              geo_location_name: existing.geo_location_name || '',
              markup_pct: existing.markup_pct != null ? String(existing.markup_pct) : '',
              shipping_amount: existing.shipping_amount ? String(existing.shipping_amount) : '',
              shipping_speed: existing.shipping_speed || '',
              shipping_taxable: !!existing.shipping_taxable,
              shipping_scope: existing.shipping_scope === 'item' ? 'item' : 'order',
              shipping_line_ref: existing.shipping_line_ref || '',
              vendor_location_id: existing.vendor_location_id || '',
              employee_id: existing.employee_id || '',
              entry_mode: (existing.entry_mode as any) || 'standard',
              odometer_start: existing.odometer_start?.toString() || '',
              odometer_end: existing.odometer_end?.toString() || '',
              miles: existing.miles?.toString() || '',
              mileage_rate: (existing.mileage_rate || IRS_MILEAGE_RATE_2026).toString(),
              per_diem_location: existing.per_diem_location || 'Default (CONUS)',
              per_diem_days: existing.per_diem_days?.toString() || '',
              per_diem_rate: (existing.per_diem_rate || PER_DIEM_RATES['Default (CONUS)']).toString(),
              fuel_gallons: existing.fuel_gallons?.toString() || '',
              fuel_price_per_gallon: existing.fuel_price_per_gallon?.toString() || '',
              fuel_grade: existing.fuel_grade || 'regular',
              fuel_vehicle: existing.fuel_vehicle || '',
              fuel_odometer: existing.fuel_odometer?.toString() || '',
              fuel_station: existing.fuel_station || '',
              notes: existing.notes || '',
              vat_gst: (() => { try { const cf = typeof existing.custom_fields === 'string' ? JSON.parse(existing.custom_fields) : existing.custom_fields; return cf?.vat_gst || ''; } catch { return ''; } })(),
            });
            try {
              const recj = typeof existing.receipts_json === 'string' ? JSON.parse(existing.receipts_json) : (existing.receipts_json || []);
              setExtraReceipts(Array.isArray(recj) ? recj : []);
            } catch { setExtraReceipts([]); }
            if (existing.lost_receipt_affidavit) {
              try { setAffidavit(JSON.parse(existing.lost_receipt_affidavit)); } catch { /* */ }
            }
            // Load existing line items
            // TAX-RATE UNIT BOUNDARY: DB stores tax_rate as DECIMAL (e.g. 0.0765 for 7.65%).
            // UI works in PERCENT for parity with the top-level tax_rate input. We
            // multiply by 100 on load and divide by 100 on save (see lineItemsPayload).
            // Same conversion applies to each tax_jurisdiction.rate.
            const existingLines = await api.query('expense_line_items', { expense_id: expenseId }, { field: 'sort_order', dir: 'asc' });
            if (Array.isArray(existingLines) && existingLines.length > 0) {
              setLineItems(existingLines.map((l: any) => ({
                id: l.id,
                description: l.description || '',
                quantity: l.quantity || 1,
                unit_price: l.unit_price || 0,
                amount: l.amount || 0,
                account_id: l.account_id || '',
                tax_rate: roundCents((l.tax_rate || 0) * 100),
                tax_amount: l.tax_amount || 0,
                tax_jurisdictions: parseJSON<any[]>(l.tax_jurisdictions, []).map((j: any) => ({
                  ...j,
                  rate: roundCents((j.rate || 0) * 100),
                })),
                // Itemization Wave fields — defaults preserve legacy behavior for rows
                // saved before these columns existed.
                category_id: l.category_id || '',
                project_id: l.project_id || '',
                client_id: l.client_id || '',
                discount_amount: l.discount_amount || 0,
                discount_percent: l.discount_percent || 0,
                is_tax_deductible: l.is_tax_deductible == null ? true : !!l.is_tax_deductible,
                is_tax_exempt: !!l.is_tax_exempt,
                notes: l.notes || '',
                item_type: (l.item_type as any) || 'item',
                tags: parseJSON<string[]>(l.tags, []),
                // Per-line billable + invoice-stamp survives round-trip so the
                // bundler treats already-invoiced lines as such.
                is_billable: !!l.is_billable,
                billed_invoice_id: l.billed_invoice_id || null,
              })));
              setUseLineItems(true);
            }
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
  }, [expenseId, activeCompany]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent, asDraft = false) => {
    e.preventDefault();
    if (saving) return;

    if (asDraft) {
      // Draft path: skip strict validation but persist current state
      setErrors([]);
      setSaving(true);
      try {
        // FINAL-PRICE SAVE SPLIT (draft path): see same logic in non-draft save below.
        const draftEnteredAmount = roundCents(parseFloat(form.amount) || 0);
        const draftEnteredTax = roundCents(parseFloat(form.tax_amount) || 0);
        const draftPersistAmount = useLineItems
          ? lineItemTotal
          : form.tax_inclusive
            ? roundCents(draftEnteredAmount - draftEnteredTax)
            : draftEnteredAmount;
        const draftPayload: Record<string, any> = {
          date: form.date,
          amount: draftPersistAmount,
          tax_amount: useLineItems ? lineItemTaxTotal : draftEnteredTax,
          description: form.description.trim(),
          category_id: form.category_id || null,
          account_id: form.account_id || null,
          vendor_id: form.vendor_id || null,
          payment_method: form.payment_method || null,
          project_id: form.project_id || null,
          client_id: form.client_id || null,
          receipt_path: receiptPath || null,
          receipts_json: extraReceipts,
          notes: form.notes || '',
          status: 'draft',
          currency: form.currency || 'USD',
          exchange_rate: parseFloat(form.exchange_rate) || 1,
          tax_inclusive: form.tax_inclusive ? 1 : 0,
          tax_rate: parseFloat(form.tax_rate) || 0,
          discount_amount: roundCents(parseFloat(form.discount_amount) || 0),
          discount_percent: parseFloat(form.discount_percent) || 0,
          related_loan_id: form.related_loan_id || null,
          merchant_location: form.merchant_location.trim() || null,
          geo_location_name: form.geo_location_name.trim() || null,
          markup_pct: form.markup_pct ? parseFloat(form.markup_pct) : null,
          employee_id: form.employee_id || null,
          shipping_amount: roundCents(parseFloat(form.shipping_amount) || 0),
          shipping_speed: form.shipping_speed || null,
          shipping_taxable: form.shipping_taxable ? 1 : 0,
          shipping_scope: form.shipping_scope,
          shipping_line_ref: form.shipping_scope === 'item' ? (form.shipping_line_ref || null) : null,
          vendor_location_id: form.vendor_id ? (form.vendor_location_id || null) : null,
          entry_mode: form.entry_mode,
          odometer_start: parseFloat(form.odometer_start) || 0,
          odometer_end: parseFloat(form.odometer_end) || 0,
          miles: parseFloat(form.miles) || 0,
          mileage_rate: parseFloat(form.mileage_rate) || 0,
          per_diem_location: form.per_diem_location || '',
          per_diem_days: parseFloat(form.per_diem_days) || 0,
          per_diem_rate: parseFloat(form.per_diem_rate) || 0,
          // Fuel fields preserve full 3-decimal precision in the DB.
          // Only the persisted `amount` is rounded to cents (via the
          // payload above which already runs through roundCents).
          fuel_gallons: parseFloat(form.fuel_gallons) || 0,
          fuel_price_per_gallon: parseFloat(form.fuel_price_per_gallon) || 0,
          fuel_grade: form.fuel_grade || '',
          fuel_vehicle: form.fuel_vehicle || '',
          fuel_odometer: parseFloat(form.fuel_odometer) || 0,
          fuel_station: form.fuel_station || '',
          tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          custom_fields: { ...(details || {}), vat_gst: form.vat_gst || '' },
        };
        const result = await api.saveExpense({
          expenseId: isEditing ? expenseId! : null,
          expenseData: draftPayload,
          lineItems: useLineItems ? lineItems.map(li => ({
            description: li.description, quantity: li.quantity, unit_price: li.unit_price,
            amount: roundCents(li.quantity * li.unit_price), account_id: li.account_id || null,
            tax_rate: li.tax_rate || 0, tax_amount: roundCents(li.tax_amount || 0),
            tax_jurisdictions: JSON.stringify(li.tax_jurisdictions || []),
          })) : [],
          isEdit: isEditing,
        });
        if (result?.error) throw new Error(result.error);
        onSaved();
      } catch (err) {
        console.error('Save draft failed:', err);
        alert('Failed to save draft.');
      } finally { setSaving(false); }
      return;
    }

    const checks: Array<string | null> = [
      required(form.date, 'Date'),
      required(form.category_id, 'Category'),
    ];
    const amt = parseFloat(form.amount) || 0;
    if (!form.amount || isNaN(parseFloat(form.amount)) || amt === 0) {
      checks.push('Amount is required (use a negative value for refunds/credits)');
    }
    // Tax amount may be negative (refund of tax). Sanity-check magnitude only.
    const tax = parseFloat(form.tax_amount) || 0;
    if (Math.abs(tax) > Math.abs(amt) && amt !== 0) {
      checks.push('Tax amount cannot exceed the expense amount in magnitude');
    }
    // Reimbursed date must come after expense date when reimbursed
    if (form.reimbursed && form.reimbursed_date && form.reimbursed_date < form.date) {
      checks.push('Reimbursed date cannot be before the expense date');
    }
    // Approval date must come after expense date
    if (form.approved_date && form.approved_date < form.date) {
      checks.push('Approval date cannot be before the expense date');
    }
    // Itemized expenses must have at least one line with description
    if (useLineItems) {
      const hasLine = lineItems.some((l) => l.description.trim().length > 0);
      if (!hasLine) checks.push('At least one line item with a description is required');
      // Negative quantity/unit_price is allowed for credits, refunds, and adjustments.
    }
    // Rejection requires a reason
    if (form.status === 'rejected' && !form.rejection_reason.trim()) {
      checks.push('Rejection reason is required when status is Rejected');
    }
    // Feature 24 — required-field policy from selected category
    for (const key of requiredCustomKeys) {
      const v = (details as any)[key];
      if (v == null || (typeof v === 'string' && !v.trim())) {
        checks.push(`Required field "${key}" must be filled for this category`);
      }
    }
    // Feature 7 — global custom-field-def required
    for (const def of customFieldDefs) {
      if (!def.is_required) continue;
      const v = (details as any)[def.field_name];
      if (v == null || (typeof v === 'string' && !v.trim())) {
        checks.push(`Custom field "${def.field_label}" is required`);
      }
    }
    // Feature 21 — lost receipt affidavit must be filled when triggered
    if (requiresAffidavit && (!affidavit.statement.trim() || !affidavit.signed_name.trim())) {
      checks.push(`Receipt is missing and amount exceeds $${IRS_RECEIPT_THRESHOLD} — please complete the lost-receipt affidavit`);
    }
    // Vendor classification: block expense from blocked vendor unless override comment in notes
    if (selectedVendor && (selectedVendor as any).approval_status === 'blocked'
        && !/^\s*override:/i.test(form.notes || '')) {
      checks.push('Vendor is BLOCKED — start the Notes field with "Override: <reason>" to proceed.');
    }
    const validationErrors = validateForm(checks);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);

    setSaving(true);

    try {
      // FINAL-PRICE SAVE SPLIT: form.amount holds the all-in TOTAL (matches what
      // the user typed). Internally we still store amount = PRE-TAX and
      // tax_amount = the tax portion, so JE postings + tax reports stay correct.
      // - Itemize ON: lineItemTotal is already pre-tax (sum of line amounts).
      // - Non-itemize + tax_inclusive=true: subtract computed tax from total.
      // - Non-itemize + tax_inclusive=false: legacy exclusive — user typed pre-tax already.
      const enteredAmount = roundCents(parseFloat(form.amount) || 0);
      const enteredTax = roundCents(parseFloat(form.tax_amount) || 0);
      const persistAmount = useLineItems
        ? lineItemTotal
        : form.tax_inclusive
          ? roundCents(enteredAmount - enteredTax)
          : enteredAmount;
      const payload: Record<string, any> = {
        date: form.date,
        amount: persistAmount,
        tax_amount: useLineItems ? lineItemTaxTotal : enteredTax,
        description: form.description.trim(),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
        vendor_id: form.vendor_id || null,
        payment_method: form.payment_method || null,
        project_id: form.project_id || null,
        client_id: form.client_id || null,
        is_billable: form.is_billable ? 1 : 0,
        is_reimbursable: form.is_reimbursable ? 1 : 0,
        reimbursed: form.reimbursed ? 1 : 0,
        reimbursed_date: form.reimbursed_date || '',
        reference: form.reference.trim() || null,
        receipt_path: receiptPath || null,
        receipts_json: extraReceipts,
        // Capture features
        exchange_rate: parseFloat(form.exchange_rate) || 1,
        tax_inclusive: form.tax_inclusive ? 1 : 0,
        tax_rate: parseFloat(form.tax_rate) || 0,
        entry_mode: form.entry_mode,
        odometer_start: parseFloat(form.odometer_start) || 0,
        odometer_end: parseFloat(form.odometer_end) || 0,
        miles: parseFloat(form.miles) || 0,
        mileage_rate: parseFloat(form.mileage_rate) || 0,
        per_diem_location: form.per_diem_location || '',
        per_diem_days: parseFloat(form.per_diem_days) || 0,
        per_diem_rate: parseFloat(form.per_diem_rate) || 0,
        // Fuel fields persist full 3-decimal precision; the rounded
        // amount column already covers the displayed total.
        fuel_gallons: parseFloat(form.fuel_gallons) || 0,
        fuel_price_per_gallon: parseFloat(form.fuel_price_per_gallon) || 0,
        fuel_grade: form.fuel_grade || '',
        fuel_vehicle: form.fuel_vehicle || '',
        fuel_odometer: parseFloat(form.fuel_odometer) || 0,
        fuel_station: form.fuel_station || '',
        notes: form.notes || '',
        status: form.status || 'pending',
        approved_by: form.approved_by || '',
        approved_date: form.approved_date || '',
        rejection_reason: form.rejection_reason || '',
        tags: form.tags
          ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
          : [],
        custom_fields: { ...(details || {}), vat_gst: form.vat_gst || '' },
        // ── new fields ──
        expense_class: form.expense_class || '',
        is_tax_deductible: form.is_tax_deductible ? 1 : 0,
        schedule_c_line: form.schedule_c_line || '',
        foreign_tax_amount: roundCents(parseFloat(form.foreign_tax_amount) || 0),
        tax_year_override: parseInt(form.tax_year_override) || 0,
        currency: form.currency || 'USD',
        vendor_is_1099: selectedVendor?.is_1099_eligible ? 1 : 0,
        vendor_w9_status: selectedVendor?.w9_status || '',
        lost_receipt_affidavit: requiresAffidavit ? JSON.stringify(affidavit) : '',
        // REGRESSION FIX: these rode only in the draft payload, so a real save
        // wiped them. Keep both payloads in sync — see the draft path above.
        merchant_location: form.merchant_location.trim() || null,
        geo_location_name: form.geo_location_name.trim() || null,
        markup_pct: form.markup_pct ? parseFloat(form.markup_pct) : null,
        related_loan_id: form.related_loan_id || null,
        employee_id: form.employee_id || null,
        discount_amount: roundCents(parseFloat(form.discount_amount) || 0),
        discount_percent: parseFloat(form.discount_percent) || 0,
        // Shipping & Handling — order-level amount + optional per-item ref.
        shipping_amount: roundCents(parseFloat(form.shipping_amount) || 0),
        shipping_speed: form.shipping_speed || null,
        shipping_taxable: form.shipping_taxable ? 1 : 0,
        shipping_scope: form.shipping_scope,
        shipping_line_ref: form.shipping_scope === 'item' ? (form.shipping_line_ref || null) : null,
        vendor_location_id: form.vendor_id ? (form.vendor_location_id || null) : null,
      };

      const lineItemsPayload = useLineItems
        ? lineItems.map(li => ({
            description: li.description,
            quantity: li.quantity,
            unit_price: li.unit_price,
            amount: roundCents(li.quantity * li.unit_price),
            account_id: li.account_id || null,
            // TAX-RATE UNIT BOUNDARY: UI works in percent, DB stores decimal.
            // Divide by 100 here so on load × 100 brings it back.
            tax_rate: (li.tax_rate || 0) / 100,
            tax_amount: roundCents(li.tax_amount || 0),
            tax_jurisdictions: JSON.stringify((li.tax_jurisdictions || []).map((j: any) => ({
              ...j,
              rate: (j.rate || 0) / 100,
            }))),
            // Itemization Wave — per-line accounting + flags
            category_id: li.category_id || null,
            project_id: li.project_id || null,
            client_id: li.client_id || null,
            discount_amount: roundCents(li.discount_amount || 0),
            discount_percent: li.discount_percent || 0,
            is_tax_deductible: li.is_tax_deductible === false ? 0 : 1,
            is_tax_exempt: li.is_tax_exempt ? 1 : 0,
            notes: li.notes || null,
            item_type: li.item_type || 'item',
            tags: JSON.stringify(li.tags || []),
            // Per-line billable. Persists the flag and any prior invoice
            // stamp so re-saving doesn't unmark already-billed lines.
            is_billable: li.is_billable ? 1 : 0,
            billed_invoice_id: li.billed_invoice_id || null,
          }))
        : [];

      const result = await api.saveExpense({
        expenseId: isEditing ? expenseId! : null,
        expenseData: payload,
        lineItems: lineItemsPayload,
        isEdit: isEditing,
      });
      if (result?.error) throw new Error(result.error);

      // Capture #14: create recurring template if requested
      if (makeRecurring && !isEditing && activeCompany && result?.id) {
        const today = new Date();
        const nxt = new Date(today);
        if (recurringFreq === 'weekly') nxt.setDate(nxt.getDate() + 7);
        else if (recurringFreq === 'biweekly') nxt.setDate(nxt.getDate() + 14);
        else if (recurringFreq === 'monthly') nxt.setMonth(nxt.getMonth() + 1);
        else if (recurringFreq === 'quarterly') nxt.setMonth(nxt.getMonth() + 3);
        else nxt.setFullYear(nxt.getFullYear() + 1);
        try {
          // DATE: format from local components — toISOString() shifts day in non-UTC zones.
          const nxtIso = `${nxt.getFullYear()}-${String(nxt.getMonth() + 1).padStart(2, '0')}-${String(nxt.getDate()).padStart(2, '0')}`;
          await api.create('recurring_templates', {
            company_id: activeCompany.id, type: 'expense',
            name: form.description || `Recurring expense ${form.date}`,
            frequency: recurringFreq,
            next_date: nxtIso,
            is_active: 1,
            template_data: payload,
          });
        } catch (e) {
          console.error('Recurring template create failed', e);
          // Warn user but don't fail the expense save
          setErrors(prev => [...prev, 'Expense saved but recurring template creation failed.']);
        }
      }

      onSaved();
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      const msg = err?.message || String(err) || 'Unknown error';
      // VISIBILITY: surface the actual underlying error (often SQLite column
      // mismatch, missing FK target, etc.) instead of swallowing into a
      // generic "try again" message that gives the user nothing to act on.
      alert(`Failed to save expense:\n\n${msg}\n\nCheck the DevTools console (Cmd+Option+I) for full details.`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button
            className="block-btn flex items-center gap-2 px-3 py-2"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex items-center gap-2">
            <Receipt size={18} className="text-accent-blue" />
            <h2 className="module-title text-text-primary">
              {isEditing ? 'Edit Expense' : 'New Expense'}
            </h2>
          </div>
        </div>
      </div>

      {/* Validation Errors */}
      {errors.length > 0 && (
        <ErrorBanner
          message={errors.join(' \u2022 ')}
          title="Validation errors"
          onDismiss={() => setErrors([])}
        />
      )}

      {/* Form */}
      <form onSubmit={(e) => handleSubmit(e, false)} className="block-card p-6">
        {/* Capture features top bar (#5, #6, #7) */}
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <EntryModeBar value={form.entry_mode} onChange={m => setForm(p => ({ ...p, entry_mode: m }))} />
          <TaxBasisBar
            taxInclusive={form.tax_inclusive}
            taxRate={parseFloat(form.tax_rate) || 0}
            amount={parseFloat(form.amount) || 0}
            onChange={patch => setForm(p => ({
              ...p,
              ...(patch.tax_inclusive != null ? { tax_inclusive: patch.tax_inclusive } : {}),
              ...(patch.tax_rate != null ? { tax_rate: String(patch.tax_rate) } : {}),
            }))}
          />
          <CurrencySelector
            currency={form.currency}
            exchangeRate={form.exchange_rate}
            amount={parseFloat(form.amount) || 0}
            onChange={patch => setForm(p => ({
              ...p,
              ...(patch.currency != null ? { currency: patch.currency } : {}),
              ...(patch.exchange_rate != null ? { exchange_rate: patch.exchange_rate } : {}),
            }))}
          />
        </div>
        {form.entry_mode === 'mileage' && (
          <MileagePanel
            value={{
              odometer_start: parseFloat(form.odometer_start) || 0,
              odometer_end: parseFloat(form.odometer_end) || 0,
              miles: parseFloat(form.miles) || 0,
              mileage_rate: parseFloat(form.mileage_rate) || IRS_MILEAGE_RATE_2026,
            }}
            onChange={v => setForm(p => ({
              ...p,
              odometer_start: String(v.odometer_start),
              odometer_end: String(v.odometer_end),
              miles: String(v.miles),
              mileage_rate: String(v.mileage_rate),
            }))}
          />
        )}
        {form.entry_mode === 'per_diem' && (
          <PerDiemPanel
            value={{
              per_diem_location: form.per_diem_location,
              per_diem_days: parseFloat(form.per_diem_days) || 0,
              per_diem_rate: parseFloat(form.per_diem_rate) || 0,
            }}
            onChange={v => setForm(p => ({
              ...p,
              per_diem_location: v.per_diem_location,
              per_diem_days: String(v.per_diem_days),
              per_diem_rate: String(v.per_diem_rate),
            }))}
          />
        )}
        {form.entry_mode === 'fuel' && (
          <FuelPanel
            value={{
              fuel_gallons: parseFloat(form.fuel_gallons) || 0,
              fuel_price_per_gallon: parseFloat(form.fuel_price_per_gallon) || 0,
              fuel_grade: form.fuel_grade,
              fuel_vehicle: form.fuel_vehicle,
              fuel_odometer: parseFloat(form.fuel_odometer) || 0,
              fuel_station: form.fuel_station,
            }}
            onChange={v => setForm(p => ({
              ...p,
              // Preserve trailing-zero precision: write the typed values
              // back as their numeric form. The recompute effect rounds
              // the final amount to cents.
              fuel_gallons: String(v.fuel_gallons),
              fuel_price_per_gallon: String(v.fuel_price_per_gallon),
              fuel_grade: v.fuel_grade,
              fuel_vehicle: v.fuel_vehicle,
              fuel_odometer: String(v.fuel_odometer),
              fuel_station: v.fuel_station,
            }))}
          />
        )}
        <div className="grid grid-cols-3 gap-5">
          {/* Date */}
          <div>
            <FieldLabel label="Date" required tooltip="The date the expense was incurred, not necessarily when paid" />
            <input
              type="date"
              name="date"
              className="block-input"
              value={form.date}
              onChange={handleChange}
              required
            />
          </div>

          {/* Amount — shows the all-in TOTAL (matches receipt). Save logic splits
              it into pre-tax + tax behind the scenes. */}
          <div>
            <FieldLabel
              label={form.tax_inclusive ? 'Total Amount (incl. tax)' : 'Pre-tax Amount'}
              required
              tooltip={useLineItems
                ? 'All-in total — auto-calculated from line items (subtotal + tax). The system records the pre-tax portion in the ledger separately.'
                : form.tax_inclusive
                  ? 'Enter the final total you paid (including any tax). The Tax Amount below is extracted from this total using the Tax Rate.'
                  : 'Pre-tax amount of the expense. Tax is added on top using the Tax Rate.'}
            />
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="number"
                name="amount"
                step="0.01"
                /* pl-12 (48px) — bumped from pl-10 because pl-10 still clipped
                   on narrower screens; macOS Electron's number-input spin buttons
                   eat ~16px of right space, so we need extra room on the left
                   for the $ icon. */
                className={`block-input pl-12 ${useLineItems ? 'bg-bg-tertiary text-text-muted cursor-not-allowed' : ''}`}
                placeholder="0.00"
                value={form.amount}
                onChange={handleChange}
                readOnly={useLineItems}
                required
              />
            </div>
            {/* Show the pre-tax breakdown so users see the split is correct. */}
            {form.tax_inclusive && !useLineItems && parseFloat(form.tax_amount || '0') > 0 && (
              <div className="text-[10px] text-text-muted mt-1 font-mono">
                Subtotal: {formatCurrency(Math.max(0, (parseFloat(form.amount) || 0) - (parseFloat(form.tax_amount) || 0)))}
                {' · '}Tax: {formatCurrency(parseFloat(form.tax_amount) || 0)}
              </div>
            )}
          </div>

          {/* Tax Amount + Currency */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Tax Amount {form.currency && form.currency !== 'USD' ? <span className="text-text-muted">({form.currency})</span> : null}
              {useLineItems && <span className="ml-2 text-text-muted normal-case font-normal">(auto-summed from line items)</span>}
            </label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="number"
                name="tax_amount"
                step="0.01"
                /* pl-12 to match the Amount field above — see note there for why
                   we need this much left padding for the $ icon clearance.
                   Read-only when itemized — useEffect overwrites this from
                   lineItemTaxTotal, so allowing edits causes silent data loss. */
                className={`block-input pl-12 ${useLineItems ? 'bg-bg-tertiary text-text-muted cursor-not-allowed' : ''}`}
                placeholder="0.00"
                value={form.tax_amount}
                onChange={handleChange}
                readOnly={useLineItems}
              />
            </div>
          </div>

          {/* Header-level discount (full-width row spanning all 3 cols).
              Math convention: discount is applied AFTER tax — matches the
              invoice form's existing behavior. Both $ and % deduct
              independently if both are set. Tax is computed on pre-discount
              subtotal so this doesn't reduce the taxable base. */}
          <div className="col-span-3">
            <details className="block-card p-2" style={{ borderRadius: 6 }}>
              <summary className="cursor-pointer text-xs font-semibold text-text-muted uppercase tracking-wider select-none">
                Discount
                {(parseFloat(form.discount_amount) > 0 || parseFloat(form.discount_percent) > 0) && (
                  <span className="ml-2 text-accent-blue normal-case font-normal">
                    {parseFloat(form.discount_amount) > 0 ? formatCurrency(parseFloat(form.discount_amount)) : ''}
                    {parseFloat(form.discount_amount) > 0 && parseFloat(form.discount_percent) > 0 ? ' + ' : ''}
                    {parseFloat(form.discount_percent) > 0 ? `${form.discount_percent}%` : ''}
                  </span>
                )}
              </summary>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div>
                  <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Discount (flat $)</label>
                  <div className="relative">
                    <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="block-input pl-12"
                      placeholder="0.00"
                      value={form.discount_amount}
                      onChange={(e) => setForm(p => ({ ...p, discount_amount: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Discount %</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="block-input"
                    placeholder="0"
                    value={form.discount_percent}
                    onChange={(e) => setForm(p => ({ ...p, discount_percent: e.target.value }))}
                  />
                </div>
                <div className="self-end">
                  {/* Live "Final after discount" preview. Shows the full math
                      stack: gross subtotal, line discounts (from itemization),
                      tax, header discount, final. Only renders the rows that
                      are actually non-zero so the panel stays compact. */}
                  {(() => {
                    const gross = useLineItems ? lineItemSubtotal : (parseFloat(form.amount) || 0);
                    const lineDisc = useLineItems ? lineItemDiscountTotal : 0;
                    const tax = useLineItems ? lineItemTaxTotal : (parseFloat(form.tax_amount) || 0);
                    const headerFlat = parseFloat(form.discount_amount) || 0;
                    const headerPct = parseFloat(form.discount_percent) || 0;
                    const postLineDiscount = Math.max(0, gross - lineDisc);
                    // Shipping & Handling preview: estimate shipping tax at the
                    // effective goods rate (matches the server's save-time calc).
                    const shipping = parseFloat(form.shipping_amount) || 0;
                    const effRate = postLineDiscount > 0 ? tax / postLineDiscount : 0;
                    const shippingTax = form.shipping_taxable ? roundCents(shipping * effRate) : 0;
                    const postTax = postLineDiscount + tax + shipping + shippingTax;
                    const headerPctOff = postTax * (headerPct / 100);
                    const finalTotal = Math.max(0, postTax - headerFlat - headerPctOff);
                    const totalDiscount = lineDisc + headerFlat + headerPctOff;
                    if (totalDiscount <= 0 && shipping <= 0) return null;
                    return (
                      <div className="text-[10px] text-text-muted font-mono space-y-0.5">
                        <div className="flex justify-between gap-3"><span>Subtotal</span><span>{formatCurrency(gross)}</span></div>
                        {lineDisc > 0 && (
                          <div className="flex justify-between gap-3 text-accent-blue">
                            <span>Line discounts</span>
                            <span>−{formatCurrency(lineDisc)}</span>
                          </div>
                        )}
                        {tax > 0 && (
                          <div className="flex justify-between gap-3"><span>Tax</span><span>{formatCurrency(tax)}</span></div>
                        )}
                        {shipping > 0 && (
                          <div className="flex justify-between gap-3"><span>Shipping &amp; Handling</span><span>{formatCurrency(shipping)}</span></div>
                        )}
                        {shippingTax > 0 && (
                          <div className="flex justify-between gap-3"><span>Shipping tax</span><span>{formatCurrency(shippingTax)}</span></div>
                        )}
                        {(headerFlat > 0 || headerPctOff > 0) && (
                          <div className="flex justify-between gap-3 text-accent-blue">
                            <span>Header discount</span>
                            <span>−{formatCurrency(headerFlat + headerPctOff)}</span>
                          </div>
                        )}
                        <div className="flex justify-between gap-3 text-text-primary font-bold border-t border-border-primary pt-0.5">
                          <span>Final</span>
                          <span>{formatCurrency(finalTotal)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </details>
          </div>

          {/* Loan Linkage Wave (F1053-F1062) — link this expense to a loan
              (typically interest portion of a loan payment). The Loan Detail
              page surfaces these expenses; reports route interest into the
              right buckets. */}
          {loans.length > 0 && (
            <div className="col-span-3">
              <details className="block-card p-2" style={{ borderRadius: 6 }} open={!!form.related_loan_id}>
                <summary className="cursor-pointer text-xs font-semibold text-text-muted uppercase tracking-wider select-none">
                  Linked to Loan
                  {form.related_loan_id && (
                    <span className="ml-2 text-accent-blue normal-case font-normal">
                      {loans.find(l => l.id === form.related_loan_id)?.name || form.related_loan_id}
                    </span>
                  )}
                </summary>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Loan</label>
                    <select
                      className="block-input"
                      value={form.related_loan_id}
                      onChange={(e) => setForm(p => ({ ...p, related_loan_id: e.target.value }))}
                    >
                      <option value="">— Not linked —</option>
                      {loans.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="text-[10px] text-text-muted self-end pb-1">
                    Use this when the expense is the <strong>interest portion</strong> of a loan payment.
                    Principal is balance-sheet movement (not an expense) and shouldn't be linked here.
                  </div>
                </div>
              </details>
            </div>
          )}

          {/* Line Items Toggle + Editor — full width */}
          <div className="col-span-3">
            <div className="flex items-center gap-3 mb-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useLineItems}
                  onChange={(e) => {
                    setUseLineItems(e.target.checked);
                    if (e.target.checked && lineItems.length === 0) setLineItems([newLineItem()]);
                  }}
                  className="accent-accent-blue"
                />
                Itemize Expense
              </label>
              {useLineItems && (
                <span className="text-[10px] text-text-muted">Break this expense into individual line items</span>
              )}
            </div>

            {useLineItems && (
              /* Itemization Wave (F841-F862): self-contained editor — see
                 ItemizationEditor.tsx. The parent owns lineItems state and
                 the save path; this child renders the UI and calls the
                 setter on every change. */
              <ItemizationEditor
                lineItems={lineItems as any}
                setLineItems={setLineItems as any}
                categories={categories.map(c => ({ id: c.id, name: c.name }))}
                projects={projects.map(p => ({ id: p.id, name: p.name }))}
                clients={clients.map(c => ({ id: c.id, name: c.name }))}
                accounts={accounts.map(a => ({ id: a.id, name: a.name }))}
              />
            )}
          </div>

          {/* Description — full width */}
          <div className="col-span-3">
            <FieldLabel label="Description" tooltip="Brief description for your records — appears in expense reports" />
            <input
              type="text"
              name="description"
              className="block-input"
              placeholder="What was this expense for?"
              value={form.description}
              onChange={handleChange}
            />
          </div>

          {/* Category */}
          <div>
            <FieldLabel label="Category" tooltip="Expense category used for reporting and budget tracking" />
            <select
              name="category_id"
              className="block-select"
              value={form.category_id}
              onChange={handleChange}
            >
              <option value="">Select category...</option>
              {/* Feature 4 — pinned suggestion */}
              {suggestedCategoryId && (() => {
                const s = categories.find(c => c.id === suggestedCategoryId);
                return s ? (
                  <optgroup label="Suggested">
                    <option value={s.id}>{`★ ${s.name}`}</option>
                  </optgroup>
                ) : null;
              })()}
              {renderableCategoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.fullPath}</option>
              ))}
            </select>
            {/* Feature 2 — color dot */}
            {selectedCategory && (
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-text-muted">
                <span className="inline-block w-2 h-2" style={{ background: selectedCategory.color || '#6b7280', borderRadius: '50%' }} />
                <span>{selectedCategory.color || '—'}</span>
                {/* Feature 8 — usage stats */}
                {categoryUsage.count > 0 && (
                  <span className="ml-2">Used {categoryUsage.count} time{categoryUsage.count === 1 ? '' : 's'} this month</span>
                )}
              </div>
            )}
            {/* Feature 3 — budget cap warning */}
            {capWarning && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: capWarning.over ? '#dc2626' : '#d97706' }}>
                <AlertTriangle size={12} />
                <span>
                  {capWarning.over
                    ? `Over monthly cap (${formatCurrency(capWarning.total)} / ${formatCurrency(capWarning.cap)})`
                    : `${capWarning.pct.toFixed(0)}% of monthly cap (${formatCurrency(capWarning.total)} / ${formatCurrency(capWarning.cap)})`}
                </span>
              </div>
            )}
            <CategoryContext categoryId={form.category_id || null} companyId={activeCompany?.id ?? ''} />
          </div>

          {/* Expense Account */}
          <div>
            <FieldLabel label="Expense Account" tooltip="The chart of accounts account this expense is posted to" />
            <select
              name="account_id"
              className="block-select"
              value={form.account_id}
              onChange={(e) => { setAccountAutoSet(false); handleChange(e); }}
            >
              <option value="">Select account...</option>
              {(() => {
                const defId = selectedCategory ? (selectedCategory as any).default_account_id : '';
                const suggested = defId ? accounts.find(a => a.id === defId) : undefined;
                const sorted = [...accounts].sort((a, b) =>
                  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
                return (
                  <>
                    {suggested && (
                      <optgroup label="Suggested for this category">
                        <option value={suggested.id}>{suggested.name}</option>
                      </optgroup>
                    )}
                    <optgroup label="All accounts">
                      {sorted.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </optgroup>
                  </>
                );
              })()}
            </select>
          </div>

          {/* Vendor (#11, #18, #19, #20) */}
          <div>
            <FieldLabel label="Vendor" tooltip="The supplier or vendor this expense was paid to" />
            <select
              name="vendor_id"
              className="block-select"
              value={form.vendor_id}
              onChange={(e) => {
                if (e.target.value === '__new__') { setShowQuickVendor(true); return; }
                const vid = e.target.value;
                setForm(p => ({ ...p, vendor_id: vid, vendor_location_id: '' }));
                setVendorText('');
                if (vid) {
                  api.vendorLocationsList(vid).then((rows: any) => {
                    setVendorLocations(Array.isArray(rows) ? rows : []);
                  }).catch(() => setVendorLocations([]));
                } else {
                  setVendorLocations([]);
                }
              }}
            >
              <option value="">Select vendor...</option>
              {[...vendors]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              <option value="__new__">+ Add new vendor…</option>
            </select>
            {!form.vendor_id && (
              <input type="text" placeholder="Or type vendor name…" className="block-input mt-1 text-xs"
                value={vendorText} onChange={e => setVendorText(e.target.value)} />
            )}
            {vendorSuggestion && (
              <div className="mt-1 text-[11px] text-accent-blue cursor-pointer hover:underline"
                onClick={() => { setForm(p => ({ ...p, vendor_id: vendorSuggestion.id })); setVendorText(''); }}>
                Use existing: {vendorSuggestion.name}
              </div>
            )}
            {!form.vendor_id && vendorText && !vendorSuggestion && (
              <div className="mt-1 text-[11px] text-text-muted cursor-pointer hover:text-accent-blue"
                onClick={() => setShowQuickVendor(true)}>+ Create &quot;{vendorText}&quot;</div>
            )}
            {priorExpense && (
              <div className="mt-1 text-[11px] text-accent-income cursor-pointer hover:underline"
                onClick={() => setForm(p => ({
                  ...p,
                  account_id: p.account_id || priorExpense.account_id || '',
                  category_id: p.category_id || priorExpense.category_id || '',
                  project_id: p.project_id || priorExpense.project_id || '',
                  description: p.description || priorExpense.description || '',
                }))}>
                Copy from prior ({priorExpense.date}, ${priorExpense.amount})
              </div>
            )}
          </div>

          {/* Vendor Location — only shown when the selected vendor has multiple locations */}
          {form.vendor_id && vendorLocations.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Location <span className="text-text-muted text-[10px]">(optional)</span>
              </label>
              <select
                className="block-select"
                value={form.vendor_location_id}
                onChange={(e) => setForm(p => ({ ...p, vendor_location_id: e.target.value }))}
              >
                <option value="">Any / unspecified location</option>
                {vendorLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name || loc.location_type || 'Location'}{loc.city ? ` — ${loc.city}` : ''}{loc.address_line1 ? `, ${loc.address_line1}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Payment Method
            </label>
            <select
              name="payment_method"
              className="block-select"
              value={form.payment_method}
              onChange={handleChange}
            >
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm.value} value={pm.value}>{pm.label}</option>
              ))}
            </select>
          </div>

          {/* Project (optional) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Project <span className="text-text-muted text-[10px]">(optional)</span>
            </label>
            <select
              name="project_id"
              className="block-select"
              value={form.project_id}
              onChange={handleChange}
            >
              <option value="">No project</option>
              {[...projects]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
          </div>

          {/* Client (optional) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Client <span className="text-text-muted text-[10px]">(optional)</span>
            </label>
            <select
              name="client_id"
              className="block-select"
              value={form.client_id}
              onChange={handleChange}
            >
              <option value="">No client</option>
              {[...clients]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>

          {/* Currency (Feature 19 trigger) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Currency
            </label>
            <select className="block-select" value={form.currency}
              onChange={(e) => setForm(p => ({ ...p, currency: e.target.value }))}>
              {['USD','EUR','GBP','CAD','AUD','JPY','CNY','MXN','BRL','INR','CHF'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Reference */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Reference / Invoice #
            </label>
            <input
              type="text"
              name="reference"
              className="block-input"
              placeholder="e.g. INV-001"
              value={form.reference}
              onChange={handleChange}
            />
          </div>

          {/* Merchant Location */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Merchant Location
            </label>
            <input type="text" className="block-input" placeholder="e.g. Salt Lake City, UT"
              value={form.merchant_location} onChange={e => setForm(p => ({ ...p, merchant_location: e.target.value }))} />
          </div>

          {/* Geo Location Name (for GPS-tagged receipts) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              GPS / Location Name
            </label>
            <input type="text" className="block-input" placeholder="e.g. Store #1234, Airport Terminal B"
              value={form.geo_location_name} onChange={e => setForm(p => ({ ...p, geo_location_name: e.target.value }))} />
          </div>

          {/* Markup % (for billable expenses passed to client) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Markup % <span className="text-text-muted text-[10px]">(billable pass-through)</span>
            </label>
            <div className="relative">
              <input type="number" step="0.1" min="0" className="block-input" placeholder="0"
                value={form.markup_pct} onChange={e => setForm(p => ({ ...p, markup_pct: e.target.value }))} style={{ paddingRight: 24 }} />
              <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 11 }}>%</span>
            </div>
          </div>

          {/* ── Shipping & Handling ───────────────────────────── */}
          <div className="col-span-3 border border-border-primary p-3" style={{ borderRadius: 'var(--app-radius)' }}>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Shipping &amp; Handling
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Amount</label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input type="number" step="0.01" min="0" className="block-input pl-8" placeholder="0.00"
                    value={form.shipping_amount}
                    onChange={e => setForm(p => ({ ...p, shipping_amount: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Shipping Speed</label>
                <select className="block-select" value={form.shipping_speed}
                  onChange={e => setForm(p => ({ ...p, shipping_speed: e.target.value }))}>
                  <option value="">— Speed —</option>
                  {SHIPPING_SPEEDS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs cursor-pointer pb-2">
                  <input type="checkbox" checked={form.shipping_taxable}
                    onChange={e => setForm(p => ({ ...p, shipping_taxable: e.target.checked }))}
                    className="accent-accent-blue" />
                  <span className="font-semibold uppercase tracking-wider">Shipping is taxable</span>
                </label>
              </div>
            </div>
            {/* Scope: whole order vs a single line item (only meaningful when itemizing) */}
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Applies to:</span>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="radio" name="shipping_scope" checked={form.shipping_scope === 'order'}
                  onChange={() => setForm(p => ({ ...p, shipping_scope: 'order', shipping_line_ref: '' }))}
                  className="accent-accent-blue" />
                <span>Whole order</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ opacity: useLineItems && lineItems.length > 0 ? 1 : 0.5 }}>
                <input type="radio" name="shipping_scope" disabled={!useLineItems || lineItems.length === 0}
                  checked={form.shipping_scope === 'item'}
                  onChange={() => setForm(p => ({ ...p, shipping_scope: 'item' }))}
                  className="accent-accent-blue" />
                <span>A single item</span>
              </label>
              {form.shipping_scope === 'item' && useLineItems && lineItems.length > 0 && (
                <select className="block-select" style={{ width: 'auto', minWidth: 220 }}
                  value={form.shipping_line_ref}
                  onChange={e => setForm(p => ({ ...p, shipping_line_ref: e.target.value }))}>
                  <option value="">— Choose line item —</option>
                  {lineItems.map((li, i) => (
                    <option key={li.id} value={li.id}>{`#${i + 1} ${li.description || '(untitled)'}`}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Tags with autocomplete (#22) */}
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Tags <span className="text-text-muted text-[10px]">(comma-separated, autocomplete)</span>
            </label>
            <TagsAutocomplete value={form.tags} allTags={allTags} onChange={v => setForm(p => ({ ...p, tags: v }))} />
          </div>

          {/* VAT/GST (#25) */}
          <div>
            <FieldLabel label="VAT / GST" tooltip="Foreign tax — separate from US sales tax" />
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input type="number" step="0.01" className="block-input pl-8" placeholder="0.00"
                value={form.vat_gst} onChange={e => setForm(p => ({ ...p, vat_gst: e.target.value }))} />
            </div>
          </div>

          {/* Recurring template (#14) */}
          <div className="col-span-3 flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={makeRecurring} onChange={e => setMakeRecurring(e.target.checked)} className="accent-accent-blue" />
              <span className="font-semibold uppercase tracking-wider">Make this recurring</span>
            </label>
            {makeRecurring && (
              <select className="block-select" style={{ width: 'auto' }} value={recurringFreq} onChange={e => setRecurringFreq(e.target.value as any)}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            )}
          </div>

          {/* Notes / memo with markdown (#21) */}
          <div className="col-span-3">
            <NotesMemoField value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} />
          </div>

          {/* Billable & Reimbursable Checkboxes */}
          <div className="flex items-end pb-1 gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                name="is_billable"
                checked={form.is_billable}
                onChange={handleChange}
                className="w-4 h-4 accent-accent-blue"
              />
              <span className="text-sm text-text-secondary">Billable to client</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.is_reimbursable}
                onChange={(e) => setForm(p => ({...p, is_reimbursable: e.target.checked}))}
                className="w-4 h-4 accent-accent-blue"
              />
              <span className="font-semibold uppercase tracking-wider">Reimbursable Expense</span>
            </label>
          </div>

          {/* Reimbursement Status — only shown if reimbursable */}
          {!!form.is_reimbursable && (
            <div className="col-span-3">
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.reimbursed}
                    onChange={(e) => setForm(p => ({
                      ...p,
                      reimbursed: e.target.checked,
                      reimbursed_date: e.target.checked && !p.reimbursed_date ? todayLocal() : p.reimbursed_date,
                    }))}
                    className="w-4 h-4 accent-accent-income"
                  />
                  <span className="font-semibold uppercase tracking-wider">Reimbursed</span>
                </label>
                {form.reimbursed && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">Date:</span>
                    <input
                      type="date"
                      className="block-input"
                      style={{ width: 'auto' }}
                      value={form.reimbursed_date}
                      onChange={(e) => setForm(p => ({...p, reimbursed_date: e.target.value}))}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Category-Specific Details ──────────────── */}
          {detailFields.length > 0 && (
            <div className="col-span-3 glass-detail-section">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
                  {selectedCategory?.name || 'Category'} Details
                </span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {detailFields.map((field) => (
                  <div key={field.key} className={field.type === 'textarea' ? 'col-span-2' : ''}>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      {field.label}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        className="block-select"
                        value={details[field.key] || ''}
                        onChange={(e) => handleDetailChange(field.key, e.target.value)}
                      >
                        <option value="">Select...</option>
                        {[...(field.options ?? [])]
                          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
                          .map((opt) => (
                          <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        className="block-input"
                        rows={3}
                        placeholder={field.placeholder || ''}
                        value={details[field.key] || ''}
                        onChange={(e) => handleDetailChange(field.key, e.target.value)}
                      />
                    ) : (
                      <input
                        type={field.type}
                        className="block-input"
                        placeholder={field.placeholder || ''}
                        value={details[field.key] || ''}
                        onChange={(e) => handleDetailChange(field.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Receipt drag-drop zone (#1, #2, #3, #23, #24) */}
          <div className="col-span-3">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <FieldLabel label="Receipts" tooltip="Drag-drop receipt files, click thumbnail to replace, or click + to add more" />
              {/* B5 — Receipt OCR button */}
              <button
                type="button"
                onClick={async () => {
                  setOcrBusy(true);
                  try {
                    const res = await api.ocrScanReceiptPick();
                    if (res.cancelled) return;
                    if (!res.ok || !res.parsed) {
                      alert('OCR failed: ' + (res.error || 'unknown'));
                      return;
                    }
                    const p = res.parsed;
                    // Auto-fill any blank fields with the OCR'd values; never
                    // overwrite values the user has already typed.
                    setForm((f) => ({
                      ...f,
                      date: f.date || p.receipt_date || f.date,
                      amount: f.amount || (p.total ?? f.amount),
                      tax_amount: f.tax_amount || (p.tax ?? f.tax_amount),
                      description: f.description || p.line_items?.map((li: any) => li.description).slice(0, 3).join(', ') || p.vendor_name || f.description,
                    }));
                    if (res.filePath) setReceiptPath(res.filePath);
                    const warns = (p.warnings || []).join(' · ');
                    alert(
                      `OCR complete (confidence ${p.confidence}%)\n\n` +
                      (p.vendor_name ? 'Vendor: ' + p.vendor_name + '\n' : '') +
                      (p.receipt_date ? 'Date: ' + p.receipt_date + '\n' : '') +
                      (p.total != null ? 'Total: ' + p.currency + ' ' + p.total.toFixed(2) + '\n' : '') +
                      (p.tax != null ? 'Tax: ' + p.tax.toFixed(2) + '\n' : '') +
                      (p.line_items?.length ? '\n' + p.line_items.length + ' line items detected\n' : '') +
                      (warns ? '\n⚠ ' + warns : '')
                    );
                  } finally {
                    setOcrBusy(false);
                  }
                }}
                disabled={ocrBusy}
                className="block-btn text-xs flex items-center gap-1.5"
                title="Scan a receipt image — auto-fills date, total, vendor"
                style={{ padding: '4px 10px' }}
              >
                {ocrBusy ? '⌛ Scanning…' : '🔍 Scan Receipt (OCR)'}
              </button>
            </div>
            <ReceiptZone
              primaryPath={receiptPath}
              onSetPrimary={setReceiptPath}
              extras={extraReceipts}
              onSetExtras={setExtraReceipts}
            />
            {isEditing && expenseId && (<AttachedDocs expenseId={expenseId} />)}
          </div>

          {/* ─── Tax & Compliance ───────────────────────── */}
          <div className="col-span-3">
            <div className="flex items-center gap-2 mb-4 mt-2">
              <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">Tax &amp; Compliance</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              {/* Feature 14 — Schedule C line */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Schedule C Line</label>
                <select className="block-select" value={form.schedule_c_line}
                  onChange={(e) => setForm(p => ({ ...p, schedule_c_line: e.target.value }))}>
                  <option value="">— none —</option>
                  {SCHEDULE_C_LINES.map(s => (
                    <option key={s.code} value={s.code}>{s.label} (line {s.code})</option>
                  ))}
                </select>
              </div>
              {/* Feature 6 — Class / department */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Class / Department</label>
                <input className="block-input" placeholder="e.g. Sales, Engineering"
                  value={form.expense_class}
                  onChange={(e) => setForm(p => ({ ...p, expense_class: e.target.value }))} />
              </div>
              {/* Feature 20 — tax-year override */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Tax Year Override</label>
                <input type="number" className="block-input" placeholder="(default)"
                  value={form.tax_year_override}
                  onChange={(e) => setForm(p => ({ ...p, tax_year_override: e.target.value }))} />
              </div>
              {/* Feature 13 — deductible flag */}
              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input type="checkbox" checked={form.is_tax_deductible}
                    onChange={(e) => setForm(p => ({ ...p, is_tax_deductible: e.target.checked }))}
                    className="w-4 h-4 accent-accent-blue" />
                  <span className="font-semibold uppercase tracking-wider text-text-secondary">Tax Deductible</span>
                </label>
              </div>
              {/* Feature 19 — foreign tax (only when currency != USD) */}
              {form.currency && form.currency !== 'USD' && (
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Foreign Tax (VAT/GST)</label>
                  <input type="number" step="0.01" className="block-input"
                    placeholder="0.00" value={form.foreign_tax_amount}
                    onChange={(e) => setForm(p => ({ ...p, foreign_tax_amount: e.target.value }))} />
                </div>
              )}
              {/* Feature 17/18 — vendor 1099 / W9 status */}
              {selectedVendor && (
                <div className="col-span-3 flex items-center gap-3 mt-1">
                  {selectedVendor.is_1099_eligible ? (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--color-accent-blue-bg)', color: 'var(--color-accent-blue)' }}>1099-RELEVANT</span>
                  ) : null}
                  {selectedVendor.is_1099_eligible && selectedVendor.w9_status !== 'collected' && selectedVendor.w9_status !== 'on_file' && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--color-accent-expense-bg)', color: 'var(--color-accent-expense)' }}
                      title="1099-eligible vendor without a W-9 on file — backup withholding may apply">
                      MISSING W-9 — BACKUP WITHHOLDING WARNING
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Feature 22 — receipt expiry badge */}
          {form.date && (
            <div className="col-span-3 text-[11px] text-text-muted">
              Retention until {receiptExpiresOn} (IRS {IRS_RECEIPT_RETENTION_YEARS}-year rule)
            </div>
          )}

          {/* Feature 21 — lost receipt affidavit */}
          {requiresAffidavit && (
            <div className="col-span-3 border border-accent-expense/40 p-4" style={{ borderRadius: '6px', background: 'rgba(220,38,38,0.06)' }}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-accent-expense" />
                <span className="text-xs font-bold uppercase tracking-wider text-accent-expense">Lost Receipt Affidavit Required</span>
              </div>
              <p className="text-xs text-text-muted mb-3">
                Per IRS rules, expenses over ${IRS_RECEIPT_THRESHOLD} require receipt documentation. Provide a sworn statement below.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Statement / Business Purpose</label>
                  <textarea className="block-input" rows={3} placeholder="Describe the expense, vendor, business purpose..."
                    value={affidavit.statement}
                    onChange={(e) => setAffidavit(p => ({ ...p, statement: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Signed Name</label>
                  <input className="block-input" placeholder="Your full legal name"
                    value={affidavit.signed_name}
                    onChange={(e) => setAffidavit(p => ({ ...p, signed_name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Date Signed</label>
                  <input type="date" className="block-input"
                    value={affidavit.signed_date}
                    onChange={(e) => setAffidavit(p => ({ ...p, signed_date: e.target.value }))} />
                </div>
              </div>
              <button type="button"
                className="block-btn flex items-center gap-1 text-xs px-3 py-1.5 mt-3"
                onClick={() => {
                  // Generate PDF affidavit using generateExpenseReceiptHTML with watermark
                  const html = generateExpenseReceiptHTML(
                    {
                      ...form,
                      amount: amountValue,
                      tax_amount: parseFloat(form.tax_amount) || 0,
                      reference: 'LOST RECEIPT — AFFIDAVIT',
                      description: `LOST RECEIPT — AFFIDAVIT\n\nStatement: ${affidavit.statement}\n\nSigned: ${affidavit.signed_name} on ${affidavit.signed_date}`,
                    },
                    activeCompany,
                    selectedVendor,
                    []
                  );
                  // Apply watermark by injecting overlay style + text
                  const watermarked = html.replace(
                    '<body>',
                    `<body><div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font-size:90px;color:rgba(220,38,38,0.10);transform:rotate(-30deg);font-weight:900;letter-spacing:6px;z-index:0;">LOST RECEIPT — AFFIDAVIT</div>`
                  );
                  api.printPreview(watermarked, 'Lost Receipt Affidavit');
                }}>
                <FileText size={12} /> Preview Affidavit PDF
              </button>
            </div>
          )}

          {/* F25 — Auto-fill from attached receipt.
              Two-step UX: (1) "Scan" button reads the already-attached
              receipt and shows suggestions inline, (2) "Apply" button
              fills blank form fields with the OCR'd values. The
              suggestions panel previews values so the user can verify
              OCR accuracy *before* committing them — safer than the
              "Scan Receipt (OCR)" button which immediately applies. */}
          {receiptPath && (
            <div className="col-span-3 border border-border-secondary p-3" style={{ borderRadius: '6px', background: 'var(--color-bg-tertiary)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                  <Sparkles size={12} className="text-accent-blue" />
                  Suggested Values from Receipt
                </span>
                {ocrSuggestions && (
                  <span className="text-[10px] text-text-muted">
                    Confidence: <span className={ocrSuggestions.confidence >= 70 ? 'text-accent-income' : ocrSuggestions.confidence >= 40 ? 'text-accent-warning' : 'text-accent-expense'}>{ocrSuggestions.confidence}%</span>
                  </span>
                )}
              </div>

              {/* Suggestion grid — shows OCR'd values or em-dashes */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-text-muted">Vendor:</span>{' '}
                  <span className={ocrSuggestions?.vendor_name ? 'text-text-primary font-medium' : 'text-text-secondary'}>
                    {ocrSuggestions?.vendor_name || '—'}
                  </span>
                </div>
                <div><span className="text-text-muted">Amount:</span>{' '}
                  <span className={ocrSuggestions?.total != null ? 'text-accent-expense font-mono font-medium' : 'text-text-secondary'}>
                    {ocrSuggestions?.total != null ? `${ocrSuggestions.currency || 'USD'} ${Number(ocrSuggestions.total).toFixed(2)}` : '—'}
                  </span>
                </div>
                <div><span className="text-text-muted">Date:</span>{' '}
                  <span className={ocrSuggestions?.receipt_date ? 'text-text-primary font-medium font-mono' : 'text-text-secondary'}>
                    {ocrSuggestions?.receipt_date || '—'}
                  </span>
                </div>
                {ocrSuggestions?.tax != null && (
                  <div className="col-span-3"><span className="text-text-muted">Tax:</span>{' '}
                    <span className="text-accent-warning font-mono">{ocrSuggestions.currency || 'USD'} {Number(ocrSuggestions.tax).toFixed(2)}</span>
                  </div>
                )}
                {ocrSuggestions?.line_items?.length > 0 && (
                  <div className="col-span-3"><span className="text-text-muted">Line items:</span>{' '}
                    <span className="text-text-secondary">{ocrSuggestions.line_items.length} detected</span>
                  </div>
                )}
                {ocrSuggestions?.warnings?.length > 0 && (
                  <div className="col-span-3 text-accent-warning">⚠ {ocrSuggestions.warnings.join(' · ')}</div>
                )}
                {ocrSuggestError && (
                  <div className="col-span-3 text-accent-expense">⚠ {ocrSuggestError}</div>
                )}
              </div>

              {/* Two-button action row */}
              <div className="flex items-center gap-2 mt-2">
                <button type="button"
                  disabled={ocrSuggestBusy}
                  className="block-btn flex items-center gap-1 text-xs px-3 py-1.5"
                  onClick={async () => {
                    setOcrSuggestBusy(true);
                    setOcrSuggestError(null);
                    try {
                      const r = await api.ocrScanReceiptFile(receiptPath);
                      if (r.ok && r.parsed) setOcrSuggestions(r.parsed);
                      else { setOcrSuggestError(r.error || 'OCR returned no data'); setOcrSuggestions(null); }
                    } catch (e: any) {
                      setOcrSuggestError(e?.message || 'Scan failed');
                    } finally {
                      setOcrSuggestBusy(false);
                    }
                  }}>
                  <Sparkles size={11} /> {ocrSuggestBusy ? 'Scanning…' : (ocrSuggestions ? 'Re-scan' : 'Scan Attached Receipt')}
                </button>
                {ocrSuggestions && (
                  <button type="button"
                    className="block-btn-primary flex items-center gap-1 text-xs px-3 py-1.5"
                    title="Fill blank form fields — never overwrites values you've already entered"
                    onClick={() => {
                      const p = ocrSuggestions;
                      setForm((f) => ({
                        ...f,
                        date: f.date || p.receipt_date || f.date,
                        amount: f.amount || (p.total != null ? p.total : f.amount),
                        tax_amount: (f as any).tax_amount || (p.tax != null ? p.tax : (f as any).tax_amount),
                        description: f.description || p.line_items?.slice(0, 3).map((li: any) => li.description).filter(Boolean).join(', ') || p.vendor_name || f.description,
                      }));
                      // Clear the suggestion panel after apply — signals success
                      // and gives a satisfying "consumed" feel.
                      setOcrSuggestions(null);
                    }}>
                    Apply to Empty Fields
                  </button>
                )}
                {ocrSuggestions && (
                  <button type="button"
                    className="block-btn-ghost text-xs px-2 py-1.5"
                    onClick={() => setOcrSuggestions(null)}
                    title="Dismiss without applying">
                    Dismiss
                  </button>
                )}
              </div>
              <div className="text-[10px] text-text-muted mt-1.5">
                Apply only fills blank fields — values you've already entered are never overwritten.
              </div>
            </div>
          )}

          {/* Feature 7 — admin-defined custom fields */}
          {customFieldDefs.length > 0 && (
            <div className="col-span-3">
              <div className="flex items-center gap-2 mb-3 mt-2">
                <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">Custom Fields</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                {customFieldDefs.map(def => {
                  const val = (details as any)[def.field_name] ?? '';
                  const isReq = !!def.is_required || requiredCustomKeys.includes(def.field_name);
                  return (
                    <div key={def.field_name}>
                      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                        {def.field_label}{isReq ? <span className="text-accent-expense ml-0.5">*</span> : null}
                      </label>
                      {def.field_type === 'select' ? (
                        <select className="block-select" value={val}
                          onChange={(e) => handleDetailChange(def.field_name, e.target.value)}>
                          <option value="">Select...</option>
                          {(def.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : def.field_type === 'boolean' ? (
                        <input type="checkbox" checked={!!val}
                          onChange={(e) => handleDetailChange(def.field_name, e.target.checked as any)} />
                      ) : (
                        <input type={def.field_type === 'date' ? 'date' : def.field_type === 'number' ? 'number' : 'text'}
                          className="block-input" value={val}
                          onChange={(e) => handleDetailChange(def.field_name, e.target.value)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── Status & Approval Workflow ──────────────── */}
          <div className="col-span-3">
            <div className="flex items-center gap-2 mb-4 mt-2">
              <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
                Status & Approval
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Status</label>
                <select name="status" className="block-select" value={form.status} onChange={handleChange}>
                  {/* Sorted alphabetically per app-wide UX directive (originally workflow order: Pending → Approved → Paid) */}
                  <optgroup label="Active">
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                  </optgroup>
                  <optgroup label="Closed">
                    <option value="paid">Paid</option>
                    <option value="rejected">Rejected</option>
                  </optgroup>
                </select>
              </div>
              {(form.status === 'approved' || form.status === 'paid') && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Approved By</label>
                    <input className="block-input" value={form.approved_by} onChange={(e) => setForm(p => ({...p, approved_by: e.target.value}))} placeholder="Approver name" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Approval Date</label>
                    <input type="date" className="block-input" value={form.approved_date} onChange={(e) => setForm(p => ({...p, approved_date: e.target.value}))} />
                  </div>
                </>
              )}
              {form.status === 'rejected' && (
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Rejection Reason</label>
                  <input className="block-input" value={form.rejection_reason} onChange={(e) => setForm(p => ({...p, rejection_reason: e.target.value}))} placeholder="Reason for rejection" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Submit (#15: Save as Draft + Submit) */}
        <div className="flex justify-end mt-6 pt-4 border-t border-border-primary gap-2">
          <button type="button" className="block-btn" onClick={onBack}>Cancel</button>
          <button type="button" className="block-btn"
            onClick={(e) => handleSubmit(e as any, true)} disabled={saving}>
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button type="submit" className="block-btn-primary flex items-center gap-2" disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Update Expense' : 'Submit Expense'}
          </button>
        </div>
      </form>
      {showQuickVendor && activeCompany && (
        <QuickVendorModal
          initialName={vendorText}
          companyId={activeCompany.id}
          onClose={() => setShowQuickVendor(false)}
          onCreated={(v) => {
            setVendors(prev => [...prev, v as any]);
            setForm(p => ({ ...p, vendor_id: v.id }));
            setVendorText('');
            setShowQuickVendor(false);
          }}
        />
      )}
    </div>
  );
};

export default ExpenseForm;
