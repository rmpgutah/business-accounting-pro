import { todayLocal } from '../../../lib/date-helpers';
import {
  IRS_MILEAGE_RATE_2026, PER_DIEM_RATES,
} from '../CaptureFeatures';

// ─── Types ──────────────────────────────────────────────
export interface ExpenseFormData {
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
  // Debt-Collection Expense Wave — soft FK to a debt-collection case.
  // Collection costs (court fees, process servers, skip tracing…) link to
  // the debt they were incurred for; recoverable ones can be rolled into
  // the debtor's balance from the Collection Costs panel on DebtDetail.
  related_debt_id: string;
  collection_cost_type: string;
  is_recoverable: boolean;
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
  vendor_location_id: string;
}

export interface DropdownOption {
  id: string;
  name: string;
}

// ─── Expense Line Item ─────────────────────────────────
export interface ExpenseLineItem {
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
  is_billable?: boolean;
  notes?: string;
  item_type?: 'item' | 'service' | 'reimbursement';
  tags?: string[];
  billed_invoice_id?: string | null;
}

export function newLineItem(): ExpenseLineItem {
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
export interface DetailField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'textarea';
  placeholder?: string;
  options?: string[];
}

export const CATEGORY_DETAIL_FIELDS: Record<string, DetailField[]> = {
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
export const DEFAULT_DETAIL_FIELDS: DetailField[] = [
  { key: 'receipt_items', label: 'Receipt Items', type: 'textarea', placeholder: 'List items from receipt (one per line)' },
  { key: 'detail_notes', label: 'Additional Notes', type: 'textarea', placeholder: 'Any additional details' },
];

export function getDetailFieldsForCategory(categoryName: string): DetailField[] {
  const key = categoryName.toLowerCase().trim();
  // Try exact match first, then partial match
  if (CATEGORY_DETAIL_FIELDS[key]) return CATEGORY_DETAIL_FIELDS[key];
  for (const [k, fields] of Object.entries(CATEGORY_DETAIL_FIELDS)) {
    if (key.includes(k) || k.includes(key)) return fields;
  }
  return DEFAULT_DETAIL_FIELDS;
}

// Save-time receipt nudge lower bound — matches the Review queue threshold.
export const REVIEW_RECEIPT_THRESHOLD = 25;

export const PAYMENT_METHODS = [
  { value: '', label: 'Select method...' },
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'other', label: 'Other' },
];

export const emptyForm: ExpenseFormData = {
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
  related_debt_id: '',
  collection_cost_type: '',
  is_recoverable: false,
  merchant_location: '',
  geo_location_name: '',
  markup_pct: '',
  employee_id: '',
  shipping_amount: '',
  shipping_speed: '',
  shipping_taxable: false,
  shipping_scope: 'order',
  shipping_line_ref: '',
  vendor_location_id: '',
};
