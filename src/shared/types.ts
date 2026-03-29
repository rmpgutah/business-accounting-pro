// ═══════════════════════════════════════════════════════════
// Business Accounting Pro — Shared Types
// ═══════════════════════════════════════════════════════════

// ─── Company ─────────────────────────────────────────────
export interface Company {
  id: string;
  name: string;
  legal_name: string;
  tax_id: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  fiscal_year_start: number;
  industry: string;
  logo_path: string;
  created_at: string;
  updated_at: string;
}

// ─── Chart of Accounts ──────────────────────────────────
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface Account {
  id: string;
  company_id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  description: string;
  is_active: boolean;
  parent_id: string | null;
  balance: number;
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ─── Journal Entries ─────────────────────────────────────
export interface JournalEntry {
  id: string;
  company_id: string;
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  is_adjusting: boolean;
  is_posted: boolean;
  created_by: string;
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string;
  created_at: string;
}

// ─── Client ──────────────────────────────────────────────
export type ClientStatus = 'active' | 'inactive' | 'prospect';

export interface Client {
  id: string;
  company_id: string;
  name: string;
  type: 'individual' | 'company';
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  payment_terms: number;
  tax_id: string;
  status: ClientStatus;
  notes: string;
  tags: string[];
  portal_token: string | null;
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ─── Invoice ─────────────────────────────────────────────
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'partial';

export interface Invoice {
  id: string;
  company_id: string;
  client_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  amount_paid: number;
  notes: string;
  terms: string;
  is_recurring: boolean;
  recurring_template_id: string | null;
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_rate: number;
  account_id: string;
  project_id: string | null;
  time_entry_ids: string[];
  created_at: string;
}

// ─── Expense ─────────────────────────────────────────────
export type ExpenseStatus = 'pending' | 'approved' | 'paid';

export interface Expense {
  id: string;
  company_id: string;
  vendor_id: string | null;
  category_id: string;
  account_id: string;
  date: string;
  amount: number;
  tax_amount: number;
  description: string;
  reference: string;
  is_billable: boolean;
  is_reimbursable: boolean;
  project_id: string | null;
  client_id: string | null;
  receipt_path: string | null;
  status: ExpenseStatus;
  payment_method: string;
  is_recurring: boolean;
  recurring_template_id: string | null;
  tags: string[];
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Vendor {
  id: string;
  company_id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  tax_id: string;
  payment_terms: number;
  notes: string;
  status: 'active' | 'inactive';
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ─── Employee & Payroll ──────────────────────────────────
export interface Employee {
  id: string;
  company_id: string;
  name: string;
  email: string;
  type: 'employee' | 'contractor';
  pay_type: 'salary' | 'hourly';
  pay_rate: number;
  pay_schedule: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  filing_status: string;
  federal_allowances: number;
  state: string;
  state_allowances: number;
  start_date: string;
  end_date: string | null;
  ssn_last4: string;
  status: 'active' | 'inactive';
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface PayrollRun {
  id: string;
  company_id: string;
  pay_period_start: string;
  pay_period_end: string;
  pay_date: string;
  status: 'draft' | 'processed' | 'paid';
  total_gross: number;
  total_net: number;
  total_taxes: number;
  total_deductions: number;
  created_at: string;
  updated_at: string;
}

export interface PayStub {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  hours_regular: number;
  hours_overtime: number;
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  other_deductions: number;
  net_pay: number;
  ytd_gross: number;
  ytd_taxes: number;
  ytd_net: number;
  created_at: string;
}

// ─── Time Tracking ───────────────────────────────────────
export interface TimeEntry {
  id: string;
  company_id: string;
  employee_id: string;
  client_id: string | null;
  project_id: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  description: string;
  is_billable: boolean;
  is_invoiced: boolean;
  invoice_id: string | null;
  hourly_rate: number;
  tags: string[];
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ─── Project ─────────────────────────────────────────────
export type ProjectStatus = 'active' | 'completed' | 'on_hold' | 'archived';

export interface Project {
  id: string;
  company_id: string;
  client_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  budget: number;
  budget_type: 'fixed' | 'hourly' | 'none';
  hourly_rate: number;
  start_date: string;
  end_date: string | null;
  tags: string[];
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ─── Tax ─────────────────────────────────────────────────
export interface TaxCategory {
  id: string;
  company_id: string;
  name: string;
  description: string;
  schedule_c_line: string;
  is_deductible: boolean;
  created_at: string;
}

export interface TaxPayment {
  id: string;
  company_id: string;
  type: string;
  amount: number;
  date: string;
  period: string;
  year: number;
  confirmation_number: string;
  notes: string;
  created_at: string;
}

// ─── Budget ──────────────────────────────────────────────
export interface Budget {
  id: string;
  company_id: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'annual';
  start_date: string;
  end_date: string;
  status: 'active' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  account_id: string;
  category: string;
  amount: number;
  notes: string;
  created_at: string;
}

// ─── Inventory ───────────────────────────────────────────
export interface InventoryItem {
  id: string;
  company_id: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  quantity: number;
  unit_cost: number;
  reorder_point: number;
  is_asset: boolean;
  depreciation_method: string;
  useful_life_years: number;
  salvage_value: number;
  purchase_date: string;
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ─── Bank Reconciliation ─────────────────────────────────
export interface BankAccount {
  id: string;
  company_id: string;
  name: string;
  account_number_last4: string;
  institution: string;
  account_id: string;
  current_balance: number;
  last_reconciled_date: string | null;
  last_reconciled_balance: number;
  created_at: string;
  updated_at: string;
}

export interface BankTransaction {
  id: string;
  bank_account_id: string;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  reference: string;
  is_matched: boolean;
  matched_entry_id: string | null;
  status: 'pending' | 'matched' | 'excluded';
  imported_at: string;
}

// ─── Document ────────────────────────────────────────────
export interface Document {
  id: string;
  company_id: string;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  entity_type: string;
  entity_id: string;
  tags: string[];
  description: string;
  uploaded_at: string;
}

// ─── Recurring Template ──────────────────────────────────
export interface RecurringTemplate {
  id: string;
  company_id: string;
  type: 'invoice' | 'expense';
  name: string;
  frequency: string;
  next_date: string;
  end_date: string | null;
  is_active: boolean;
  template_data: Record<string, any>;
  last_generated: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Audit Log ───────────────────────────────────────────
export interface AuditLog {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  changes: Record<string, { old: any; new: any }>;
  performed_by: string;
  timestamp: string;
}

// ─── Notification ────────────────────────────────────────
export interface AppNotification {
  id: string;
  company_id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

// ─── Stripe ──────────────────────────────────────────────
export interface StripeTransaction {
  id: string;
  company_id: string;
  stripe_id: string;
  type: 'payment' | 'refund' | 'payout' | 'fee';
  amount: number;
  fee: number;
  net: number;
  currency: string;
  description: string;
  customer_id: string | null;
  client_id: string | null;
  invoice_id: string | null;
  status: 'pending' | 'matched' | 'excluded';
  stripe_created: string;
  synced_at: string;
}

// ─── Email Log ───────────────────────────────────────────
export interface EmailLog {
  id: string;
  company_id: string;
  to: string;
  subject: string;
  body_preview: string;
  entity_type: string;
  entity_id: string;
  status: 'sent' | 'failed';
  error: string | null;
  sent_at: string;
}

// ─── Settings ────────────────────────────────────────────
export interface AppSettings {
  id: string;
  company_id: string;
  key: string;
  value: string;
  updated_at: string;
}

// ─── Custom Field Definition ─────────────────────────────
export interface CustomFieldDef {
  id: string;
  company_id: string;
  entity_type: string;
  field_name: string;
  field_label: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  options: string[];
  is_required: boolean;
  sort_order: number;
  created_at: string;
}

// ─── Saved View ──────────────────────────────────────────
export interface SavedView {
  id: string;
  company_id: string;
  module: string;
  name: string;
  filters: Record<string, any>;
  sort: { field: string; direction: 'asc' | 'desc' };
  columns: string[];
  is_default: boolean;
  created_at: string;
}

// ─── Search Result ───────────────────────────────────────
export interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
}
