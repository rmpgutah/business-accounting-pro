import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Receipt, DollarSign, Paperclip, X, Plus, Trash2, FileText } from 'lucide-react';
import api from '../../lib/api';
import { required, validateForm, minValue } from '../../lib/validation';
import { useCompanyStore } from '../../stores/companyStore';
import { CategoryContext } from '../../components/ContextPanel';
import { FieldLabel } from '../../components/FieldLabel';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

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
}

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
}

function newLineItem(): ExpenseLineItem {
  return { id: crypto.randomUUID(), description: '', quantity: 1, unit_price: 0, amount: 0, account_id: '' };
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
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
];

const emptyForm: ExpenseFormData = {
  date: new Date().toISOString().split('T')[0],
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
  const [categories, setCategories] = useState<DropdownOption[]>([]);
  const [accounts, setAccounts] = useState<DropdownOption[]>([]);
  const [vendors, setVendors] = useState<DropdownOption[]>([]);
  const [projects, setProjects] = useState<DropdownOption[]>([]);
  const [clients, setClients] = useState<DropdownOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [receiptPath, setReceiptPath] = useState<string>('');
  const [details, setDetails] = useState<Record<string, string>>({});
  const [useLineItems, setUseLineItems] = useState(false);
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([]);

  const isEditing = !!expenseId;

  // Auto-calculate total from line items
  const lineItemTotal = useMemo(() =>
    lineItems.reduce((sum, li) => sum + (li.quantity * li.unit_price), 0),
    [lineItems]
  );

  useEffect(() => {
    if (useLineItems && lineItems.length > 0) {
      setForm(prev => ({ ...prev, amount: lineItemTotal.toFixed(2) }));
    }
  }, [lineItemTotal, useLineItems]);

  // Line item handlers
  const handleLineChange = (index: number, field: keyof ExpenseLineItem, value: string | number) => {
    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      updated[index].amount = updated[index].quantity * updated[index].unit_price;
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

  const handleDetailChange = (key: string, value: string) => {
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
        const [catData, accData] = await Promise.all([
          api.query('categories', { company_id: cid, type: 'expense' }),
          api.query('accounts', { company_id: cid, type: 'expense' }),
        ]);
        if (cancelled) return;

        setCategories(Array.isArray(catData) ? catData : []);
        setAccounts(Array.isArray(accData) ? accData : []);

        // Non-critical secondary data — failures don't hide primary content
        api.query('vendors', { company_id: cid })
          .then(r => { if (!cancelled) setVendors(Array.isArray(r) ? r : []); })
          .catch(() => {});
        api.query('projects', { company_id: cid })
          .then(r => { if (!cancelled) setProjects(Array.isArray(r) ? r : []); })
          .catch(() => {});
        api.query('clients', { company_id: cid })
          .then(r => { if (!cancelled) setClients(Array.isArray(r) ? r : []); })
          .catch(() => {});

        if (expenseId) {
          const existing = await api.get('expenses', expenseId);
          if (existing && !cancelled) {
            setReceiptPath(existing.receipt_path || '');
            // Restore custom_fields details
            try {
              const cf = typeof existing.custom_fields === 'string' ? JSON.parse(existing.custom_fields) : (existing.custom_fields || {});
              setDetails(cf);
            } catch { setDetails({}); }
            setForm({
              date: existing.date || emptyForm.date,
              amount: existing.amount?.toString() || '',
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
              tags: Array.isArray(existing.tags) ? existing.tags.join(', ') : (existing.tags || ''),
              status: existing.status || 'pending',
              approved_by: existing.approved_by || '',
              approved_date: existing.approved_date || '',
              rejection_reason: existing.rejection_reason || '',
            });
            // Load existing line items
            const existingLines = await api.query('expense_line_items', { expense_id: expenseId }, { field: 'sort_order', dir: 'asc' });
            if (Array.isArray(existingLines) && existingLines.length > 0) {
              setLineItems(existingLines.map((l: any) => ({
                id: l.id,
                description: l.description || '',
                quantity: l.quantity || 1,
                unit_price: l.unit_price || 0,
                amount: l.amount || 0,
                account_id: l.account_id || '',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const checks: Array<string | null> = [
      minValue(parseFloat(form.amount) || 0, 0.01, 'Amount'),
      required(form.date, 'Date'),
      required(form.category_id, 'Category'),
    ];
    // Validate tax doesn't exceed amount
    const amt = parseFloat(form.amount) || 0;
    const tax = parseFloat(form.tax_amount) || 0;
    if (tax > amt) checks.push('Tax amount cannot exceed the expense amount');
    const validationErrors = validateForm(checks);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);

    setSaving(true);

    try {
      const payload: Record<string, any> = {
        date: form.date,
        amount: parseFloat(form.amount) || 0,
        tax_amount: parseFloat(form.tax_amount) || 0,
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
        status: form.status || 'pending',
        approved_by: form.approved_by || '',
        approved_date: form.approved_date || '',
        rejection_reason: form.rejection_reason || '',
        tags: form.tags
          ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
          : [],
        custom_fields: Object.keys(details).length > 0 ? details : {},
      };

      const lineItemsPayload = useLineItems
        ? lineItems.map(li => ({
            description: li.description,
            quantity: li.quantity,
            unit_price: li.unit_price,
            amount: li.quantity * li.unit_price,
            account_id: li.account_id || null,
          }))
        : [];

      const result = await api.saveExpense({
        expenseId: isEditing ? expenseId! : null,
        expenseData: payload,
        lineItems: lineItemsPayload,
        isEdit: isEditing,
      });
      if (result?.error) throw new Error(result.error);
      onSaved();
    } catch (err) {
      console.error('Failed to save expense:', err);
      alert('Failed to save expense. Please try again.');
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
      <form onSubmit={handleSubmit} className="block-card p-6">
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

          {/* Amount */}
          <div>
            <FieldLabel label="Amount" required tooltip={useLineItems ? 'Auto-calculated from line items' : 'Total amount of the expense including any taxes'} />
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="number"
                name="amount"
                step="0.01"
                min="0"
                className={`block-input pl-8 ${useLineItems ? 'bg-bg-tertiary text-text-muted cursor-not-allowed' : ''}`}
                placeholder="0.00"
                value={form.amount}
                onChange={handleChange}
                readOnly={useLineItems}
                required
              />
            </div>
          </div>

          {/* Tax Amount */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Tax Amount
            </label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="number"
                name="tax_amount"
                step="0.01"
                min="0"
                className="block-input pl-8"
                placeholder="0.00"
                value={form.tax_amount}
                onChange={handleChange}
              />
            </div>
          </div>

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
              <div className="border border-border-primary p-4 space-y-2 mb-2" style={{ borderRadius: '6px', background: 'var(--color-bg-tertiary)' }}>
                {/* Header row */}
                <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider px-1">
                  <div className="col-span-1"></div>
                  <div className="col-span-4">Description</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-2 text-right">Unit Price</div>
                  <div className="col-span-2 text-right">Amount</div>
                  <div className="col-span-1"></div>
                </div>

                {/* Line item rows */}
                {lineItems.map((li, idx) => (
                  <div key={li.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-1 flex flex-col items-center gap-0.5">
                      {idx > 0 && (
                        <button type="button" onClick={() => moveLineItem(idx, idx - 1)}
                          className="text-text-muted hover:text-text-primary text-[10px] leading-none transition-colors" title="Move up">&#9650;</button>
                      )}
                      {idx < lineItems.length - 1 && (
                        <button type="button" onClick={() => moveLineItem(idx, idx + 1)}
                          className="text-text-muted hover:text-text-primary text-[10px] leading-none transition-colors" title="Move down">&#9660;</button>
                      )}
                    </div>
                    <div className="col-span-4">
                      <input type="text" className="block-input text-sm" placeholder="Item description"
                        value={li.description}
                        onChange={(e) => handleLineChange(idx, 'description', e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <input type="number" className="block-input text-sm text-right font-mono" step="1" min="0"
                        value={li.quantity}
                        onChange={(e) => handleLineChange(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="col-span-2">
                      <input type="number" className="block-input text-sm text-right font-mono" step="0.01" min="0"
                        placeholder="0.00"
                        value={li.unit_price || ''}
                        onChange={(e) => handleLineChange(idx, 'unit_price', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="col-span-2 text-right font-mono text-sm text-text-secondary">
                      {formatCurrency(li.quantity * li.unit_price)}
                    </div>
                    <div className="col-span-1 text-center">
                      {lineItems.length > 1 && (
                        <button type="button" onClick={() => removeLineItem(idx)}
                          className="text-text-muted hover:text-accent-expense transition-colors p-0.5" title="Remove item">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Add line + total */}
                <div className="flex items-center justify-between pt-3 border-t border-border-primary">
                  <button type="button" onClick={addLineItem}
                    className="block-btn flex items-center gap-1.5 text-xs px-3 py-1.5">
                    <Plus size={12} /> Add Item
                  </button>
                  <div className="text-sm font-bold text-text-primary font-mono">
                    Total: {formatCurrency(lineItemTotal)}
                  </div>
                </div>
              </div>
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
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <CategoryContext categoryId={form.category_id || null} companyId={activeCompany?.id ?? ''} />
          </div>

          {/* Expense Account */}
          <div>
            <FieldLabel label="Expense Account" tooltip="The chart of accounts account this expense is posted to" />
            <select
              name="account_id"
              className="block-select"
              value={form.account_id}
              onChange={handleChange}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Vendor */}
          <div>
            <FieldLabel label="Vendor" tooltip="The supplier or vendor this expense was paid to" />
            <select
              name="vendor_id"
              className="block-select"
              value={form.vendor_id}
              onChange={handleChange}
            >
              <option value="">Select vendor...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

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
              {projects.map((p) => (
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
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
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

          {/* Tags */}
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Tags <span className="text-text-muted text-[10px]">(comma-separated)</span>
            </label>
            <input
              type="text"
              name="tags"
              className="block-input"
              placeholder="e.g. office, supplies, quarterly"
              value={form.tags}
              onChange={handleChange}
            />
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
          {form.is_reimbursable && (
            <div className="col-span-3">
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.reimbursed}
                    onChange={(e) => setForm(p => ({
                      ...p,
                      reimbursed: e.target.checked,
                      reimbursed_date: e.target.checked && !p.reimbursed_date ? new Date().toISOString().split('T')[0] : p.reimbursed_date,
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
                        {field.options?.map((opt) => (
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

          {/* Receipt Attachment */}
          <div className="col-span-3">
            <FieldLabel label="Receipt Attachment" tooltip="Attach a photo or scan of the receipt for audit purposes" />
            {receiptPath ? (
              <div
                className="border border-border-secondary flex items-center justify-between px-4 py-3 bg-bg-tertiary"
                style={{ borderRadius: '6px' }}
              >
                <div className="flex items-center gap-2 text-sm text-text-secondary truncate">
                  <Paperclip size={14} className="text-accent-blue shrink-0" />
                  <span className="truncate">{receiptPath.split(/[/\\]/).pop()}</span>
                </div>
                <button
                  type="button"
                  className="text-text-muted hover:text-accent-expense transition-colors p-1"
                  onClick={() => setReceiptPath('')}
                  title="Remove receipt"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div
                className="border border-dashed border-border-secondary flex items-center justify-center py-8 text-text-muted text-sm cursor-pointer hover:border-border-focus hover:bg-bg-hover transition-colors"
                style={{ borderRadius: '6px' }}
                onClick={async () => {
                  try {
                    const result = await api.openFileDialog({
                      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'pdf'] }],
                    });
                    if (result && result.path) {
                      setReceiptPath(result.path);
                    }
                  } catch (err) {
                    console.error('Failed to open file dialog:', err);
                  }
                }}
              >
                <Receipt size={16} className="mr-2" />
                Click to attach receipt
              </div>
            )}
            {/* Attached Documents */}
            {isEditing && expenseId && (
              <AttachedDocs expenseId={expenseId} />
            )}
          </div>

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
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="paid">Paid</option>
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

        {/* Submit */}
        <div className="flex justify-end mt-6 pt-4 border-t border-border-primary">
          <button
            type="button"
            className="block-btn mr-3"
            onClick={onBack}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="block-btn-primary flex items-center gap-2"
            disabled={saving}
          >
            {saving ? 'Saving...' : isEditing ? 'Update Expense' : 'Save Expense'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ExpenseForm;
