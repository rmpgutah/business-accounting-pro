# Debt Collections & Invoice Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two debt-creation bugs, enrich the DebtForm with account context data, expand Invoice customization (PO number, per-line discounts, client defaults), and add full Debt Collection features (payment plans, settlements, FDCPA compliance log, risk scoring, auto-stage progression, and an invoice→debt bridge).

**Architecture:** Two parallel tracks (Invoice customization + Debt enhancements) on top of the existing Electron/React/SQLite stack. Bug fixes come first. All DB changes go into the `migrations[]` array in `database/index.ts`. New child tables must be registered in `tablesWithoutCompanyId` (ipc/index.ts) and `tablesWithoutUpdatedAt` (database/index.ts) or crashes will occur on write.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, Tailwind + glass theme (block-card, block-btn, block-input, block-select, block-table classes; borderRadius: 6px; never bg-white/text-gray-*)

---

## Task 1: Fix debt creation crash + invoice source dropdown

**Files:**
- Modify: `src/renderer/modules/debt-collection/DebtForm.tsx`

### Context

Two bugs in `DebtForm.tsx`:

**Bug A** (line ~369): When creating a new debt, a `debt_pipeline_stages` record is created with `company_id: activeCompany.id`. But `debt_pipeline_stages` has NO `company_id` column (confirmed in schema.sql:1054). The table IS in `tablesWithoutCompanyId`, so the IPC layer passes the payload through verbatim — SQLite throws "table has no column named company_id" → the whole save fails silently.

**Bug B** (line ~597): The invoice source dropdown renders `{item.name}` but invoice objects have `invoice_number` not `name`, so every option shows blank text.

### Step 1: Fix Bug A — remove company_id from debt_pipeline_stages create

Find this block in `DebtForm.tsx` (around line 368):
```typescript
if (newDebt?.id) {
  await api.create('debt_pipeline_stages', {
    debt_id: newDebt.id,
    stage: 'reminder',
    company_id: activeCompany.id,
  });
}
```

Replace with:
```typescript
if (newDebt?.id) {
  await api.create('debt_pipeline_stages', {
    debt_id: newDebt.id,
    stage: 'reminder',
  });
}
```

### Step 2: Fix Bug B — show meaningful labels in invoice/bill dropdowns

In the load useEffect (around line 150), find:
```typescript
setInvoices(Array.isArray(invoiceData) ? invoiceData : []);
setBills(Array.isArray(billData) ? billData : []);
```

Replace with:
```typescript
setInvoices((Array.isArray(invoiceData) ? invoiceData : []).map((inv: any) => ({
  ...inv,
  name: `${inv.invoice_number || inv.id.slice(0, 8)} — $${((inv.total || 0) - (inv.amount_paid || 0)).toFixed(2)} due`,
})));
setBills((Array.isArray(billData) ? billData : []).map((bill: any) => ({
  ...bill,
  name: `${bill.bill_number || bill.id.slice(0, 8)} — $${(bill.amount || 0).toFixed(2)}`,
})));
```

### Step 3: Commit

```bash
git add src/renderer/modules/debt-collection/DebtForm.tsx
git commit -m "fix: debt creation crash (pipeline stages company_id) + invoice dropdown blank labels"
```

---

## Task 2: DebtForm — richer account context when entity is selected

**Files:**
- Modify: `src/renderer/modules/debt-collection/DebtForm.tsx`

### Context

When the user selects a Client, Employee, or Vendor from the dropdown, only basic fields (name, email, phone, address) are auto-filled. The user wants to see more data from the selected entity — e.g. a client's industry, credit limit, and company size; an employee's job title and department; a vendor's W-9 status. This data is read-only context, not saved to the debt.

### Step 1: Extend DropdownOption interface and state

At the top of `DebtForm.tsx`, update `DropdownOption`:
```typescript
interface DropdownOption {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  total?: number;
  amount_paid?: number;
  // Extended context fields
  industry?: string;
  company_size?: string;
  credit_limit?: number;
  preferred_payment_method?: string;
  default_payment_terms?: string;
  job_title?: string;
  department?: string;
  employment_type?: string;
  w9_status?: string;
  is_1099_eligible?: number;
}
```

Add state for selected account info (after the existing state declarations):
```typescript
const [selectedAccountInfo, setSelectedAccountInfo] = useState<DropdownOption | null>(null);
```

### Step 2: Pre-fill employer fields from employee data

In `handleDebtorSelect`, after setting the basic fields, add:
```typescript
setSelectedAccountInfo(selected);

// Pre-fill employment fields when selecting an employee
if (form.debtor_type === 'employee' && selected) {
  setForm((prev) => ({
    ...prev,
    employer_name: (selected as any).employer || activeCompany?.name || prev.employer_name,
    employment_status: 'employed',
  }));
}
```

Also clear it when debtor_type changes — in `handleDebtorTypeChange`, add:
```typescript
setSelectedAccountInfo(null);
```

### Step 3: Add Account Details read-only panel in Section 1

Inside the "Debtor Information" section card, after the closing `</div>` of the grid (after the address field), add:

```tsx
{/* Account Context — shown when a known entity is selected */}
{form.debtor_type !== 'custom' && selectedAccountInfo && (
  <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--color-bg-tertiary)', borderRadius: 6, border: '1px solid var(--color-border-primary)' }}>
    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Account Details</div>
    <div className="grid grid-cols-3 gap-3">
      {form.debtor_type === 'client' && (
        <>
          {selectedAccountInfo.industry && (
            <div><div className="text-xs text-text-muted">Industry</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.industry}</div></div>
          )}
          {selectedAccountInfo.company_size && (
            <div><div className="text-xs text-text-muted">Company Size</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.company_size}</div></div>
          )}
          {selectedAccountInfo.credit_limit != null && selectedAccountInfo.credit_limit > 0 && (
            <div><div className="text-xs text-text-muted">Credit Limit</div><div className="text-xs text-text-primary font-medium">${selectedAccountInfo.credit_limit.toLocaleString()}</div></div>
          )}
          {selectedAccountInfo.preferred_payment_method && (
            <div><div className="text-xs text-text-muted">Preferred Payment</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.preferred_payment_method}</div></div>
          )}
          {selectedAccountInfo.default_payment_terms && (
            <div><div className="text-xs text-text-muted">Default Terms</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.default_payment_terms}</div></div>
          )}
        </>
      )}
      {form.debtor_type === 'employee' && (
        <>
          {selectedAccountInfo.job_title && (
            <div><div className="text-xs text-text-muted">Job Title</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.job_title}</div></div>
          )}
          {selectedAccountInfo.department && (
            <div><div className="text-xs text-text-muted">Department</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.department}</div></div>
          )}
          {selectedAccountInfo.employment_type && (
            <div><div className="text-xs text-text-muted">Employment Type</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.employment_type}</div></div>
          )}
        </>
      )}
      {form.debtor_type === 'vendor' && (
        <>
          {selectedAccountInfo.w9_status && (
            <div><div className="text-xs text-text-muted">W-9 Status</div><div className="text-xs text-text-primary font-medium" style={{ textTransform: 'capitalize' }}>{selectedAccountInfo.w9_status.replace(/_/g, ' ')}</div></div>
          )}
          {selectedAccountInfo.is_1099_eligible ? (
            <div><div className="text-xs text-text-muted">1099 Eligible</div><div className="text-xs font-medium" style={{ color: '#22c55e' }}>Yes</div></div>
          ) : null}
        </>
      )}
    </div>
  </div>
)}
```

### Step 4: Commit

```bash
git add src/renderer/modules/debt-collection/DebtForm.tsx
git commit -m "feat: show account context panel when client/employee/vendor selected in debt form"
```

---

## Task 3: DB migrations — invoice + client columns

**Files:**
- Modify: `src/main/database/index.ts`

### Step 1: Add migrations

In `database/index.ts`, find the end of the `migrations[]` array (after the `debt_promises` table CREATE, before the closing `];`). Add:

```typescript
// Debt & Invoice Enhancements (2026-04-07)
"ALTER TABLE debts ADD COLUMN assigned_collector_id TEXT DEFAULT NULL",
"ALTER TABLE debts ADD COLUMN auto_advance_enabled INTEGER DEFAULT 0",
"ALTER TABLE invoices ADD COLUMN po_number TEXT DEFAULT ''",
"ALTER TABLE invoices ADD COLUMN job_reference TEXT DEFAULT ''",
"ALTER TABLE invoices ADD COLUMN internal_notes TEXT DEFAULT ''",
"ALTER TABLE invoices ADD COLUMN late_fee_pct REAL DEFAULT 0",
"ALTER TABLE invoices ADD COLUMN late_fee_grace_days INTEGER DEFAULT 0",
"ALTER TABLE invoices ADD COLUMN discount_pct REAL DEFAULT 0",
"ALTER TABLE invoice_line_items ADD COLUMN discount_pct REAL DEFAULT 0",
"ALTER TABLE invoice_line_items ADD COLUMN tax_rate_override REAL DEFAULT -1",
"ALTER TABLE clients ADD COLUMN default_payment_terms TEXT DEFAULT ''",
"ALTER TABLE clients ADD COLUMN default_late_fee_pct REAL DEFAULT 0",
`CREATE TABLE IF NOT EXISTS debt_payment_plans (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  installment_amount REAL NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  start_date TEXT NOT NULL DEFAULT '',
  total_installments INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS debt_plan_installments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES debt_payment_plans(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS debt_settlements (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  offer_amount REAL NOT NULL DEFAULT 0,
  offer_pct REAL NOT NULL DEFAULT 0,
  offered_date TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT 'pending',
  counter_amount REAL DEFAULT 0,
  accepted_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS debt_compliance_log (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS invoice_debt_links (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  debt_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`,
```

### Step 2: Register new child tables (no company_id, no updated_at)

In `tablesWithoutUpdatedAt` set (around line 306), add to the existing list:
```typescript
'debt_payment_plans', 'debt_plan_installments', 'debt_settlements',
'debt_compliance_log', 'invoice_debt_links',
```

In `ipc/index.ts`, find `tablesWithoutCompanyId` (around line 400), add:
```typescript
'debt_payment_plans', 'debt_plan_installments', 'debt_settlements',
'debt_compliance_log', 'invoice_debt_links',
```

### Step 3: Commit

```bash
git add src/main/database/index.ts src/main/ipc/index.ts
git commit -m "feat: db migrations for invoice/debt enhancements + register new child tables"
```

---

## Task 4: InvoiceForm — Settings & References + split notes

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx`

### Context

The existing `InvoiceFormData` interface has `notes` and `terms_text`. We need to add `po_number`, `job_reference`, `internal_notes`, `late_fee_pct`, `late_fee_grace_days`, and `discount_pct`. The Notes field needs to split into "Client Notes" (printed) + "Internal Notes" (never printed).

When a client is selected, auto-fill `terms` from `client.default_payment_terms` and `late_fee_pct` from `client.default_late_fee_pct`.

### Step 1: Update InvoiceFormData interface

Find the `InvoiceFormData` interface and add:
```typescript
interface InvoiceFormData {
  client_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  terms: string;
  discount: number;
  notes: string;
  internal_notes: string;   // NEW
  terms_text: string;
  status: string;
  po_number: string;        // NEW
  job_reference: string;    // NEW
  late_fee_pct: number;     // NEW
  late_fee_grace_days: number; // NEW
  discount_pct: number;     // NEW
}
```

### Step 2: Add to initial/empty form state

Find where the initial form state is set (look for `invoice_number: ''` or similar) and add the new fields with defaults:
```typescript
po_number: '',
job_reference: '',
internal_notes: '',
late_fee_pct: 0,
late_fee_grace_days: 0,
discount_pct: 0,
```

### Step 3: Auto-fill from client defaults on client select

Find the handler where a client is selected (look for `setSelectedClient` or the `client_id` onChange / useEffect that loads client). After setting `client_id`, add:
```typescript
// Auto-fill from client defaults
if (client.default_payment_terms) {
  setForm(prev => ({ ...prev, terms: client.default_payment_terms }));
}
if (client.default_late_fee_pct > 0) {
  setForm(prev => ({ ...prev, late_fee_pct: client.default_late_fee_pct }));
}
```

### Step 4: Load existing invoice data into new fields

Find where an existing invoice's data is loaded (look for `setForm({...existingInvoice...})`). Add the new fields to that mapping:
```typescript
po_number: existing.po_number || '',
job_reference: existing.job_reference || '',
internal_notes: existing.internal_notes || '',
late_fee_pct: existing.late_fee_pct || 0,
late_fee_grace_days: existing.late_fee_grace_days || 0,
discount_pct: existing.discount_pct || 0,
```

### Step 5: Add to save payload

Find the save/submit payload construction and include the new fields:
```typescript
po_number: form.po_number.trim() || null,
job_reference: form.job_reference.trim() || null,
internal_notes: form.internal_notes.trim() || null,
late_fee_pct: form.late_fee_pct || 0,
late_fee_grace_days: form.late_fee_grace_days || 0,
discount_pct: form.discount_pct || 0,
```

### Step 6: Add "Settings & References" section to the form UI

Find the Notes textarea section in the form JSX. BEFORE it (or immediately after the main invoice fields section), add a new card:

```tsx
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
```

### Step 7: Split Notes section into Client Notes + Internal Notes

Find the existing Notes textarea in the form. Replace it with two textareas side-by-side or stacked:

```tsx
{/* Notes */}
<div className="block-card p-5 mb-4">
  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">Notes</h3>
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Client Notes <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, textTransform: 'none' }}>(printed on invoice)</span></label>
      <textarea className="block-input" rows={3} placeholder="Notes visible to your client..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Internal Notes <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, textTransform: 'none' }}>(never printed)</span></label>
      <textarea className="block-input" rows={3} placeholder="Private notes for your team..." value={form.internal_notes} onChange={e => setForm(p => ({ ...p, internal_notes: e.target.value }))} />
    </div>
  </div>
</div>
```

### Step 8: Commit

```bash
git add src/renderer/modules/invoices/InvoiceForm.tsx
git commit -m "feat: invoice settings & references section, split notes, late fee, discount, client defaults"
```

---

## Task 5: InvoiceForm — per-line discount % and tax override

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx`

### Context

`LineItem` already has `line_discount` and `line_discount_type` (from Invoice Studio). We're adding two new per-line fields: `discount_pct` (a simple percentage discount separate from the existing line_discount) and `tax_rate_override` (-1 means use invoice-level rate, any ≥ 0 value overrides it per-line).

### Step 1: Update LineItem interface

Find the `LineItem` interface and add:
```typescript
discount_pct: number;
tax_rate_override: number;   // -1 = use invoice rate
```

### Step 2: Update `newLineItem` factory

Find `const newLineItem = ...` and add the new fields:
```typescript
discount_pct: 0,
tax_rate_override: -1,
```

### Step 3: Update existing invoice line load

Find where existing line items are mapped from the DB (look for `.map((li: any) => ({`)). Add:
```typescript
discount_pct: li.discount_pct || 0,
tax_rate_override: li.tax_rate_override != null ? li.tax_rate_override : -1,
```

### Step 4: Add columns to line item rows

In the line items table/grid, after the existing tax rate input column, add two more small input columns:

```tsx
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
  value={item.discount_pct || ''}
  onChange={e => updateLine(item.id, 'discount_pct', parseFloat(e.target.value) || 0)}
/>
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
  value={item.tax_rate_override >= 0 ? item.tax_rate_override : ''}
  onChange={e => {
    const v = e.target.value === '' ? -1 : parseFloat(e.target.value);
    updateLine(item.id, 'tax_rate_override', v);
  }}
/>
```

### Step 5: Wire discount_pct and tax_rate_override into amount calculation

Find where line item amounts are calculated (look for `quantity * unit_price`). Apply `discount_pct` after the base amount:
```typescript
const baseAmount = item.quantity * item.unit_price;
const discountedAmount = baseAmount * (1 - (item.discount_pct || 0) / 100);
// Use tax_rate_override if >= 0, else fall back to item.tax_rate
const effectiveTaxRate = item.tax_rate_override >= 0 ? item.tax_rate_override : item.tax_rate;
```

### Step 6: Include in save payload for each line

When constructing the line item save payload, include:
```typescript
discount_pct: item.discount_pct || 0,
tax_rate_override: item.tax_rate_override != null ? item.tax_rate_override : -1,
```

### Step 7: Commit

```bash
git add src/renderer/modules/invoices/InvoiceForm.tsx
git commit -m "feat: per-line discount % and tax rate override on invoice line items"
```

---

## Task 6: ClientForm — default invoice settings

**Files:**
- Modify: `src/renderer/modules/clients/ClientForm.tsx`

### Step 1: Add fields to the existing client form

In `ClientForm.tsx`, find the section that has `internal_notes` or tags (the extended fields section added in the previous track). After those fields, add a new subsection:

```tsx
{/* Default Invoice Settings */}
<div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3 pb-2 border-b border-border-primary">
    Default Invoice Settings
  </div>
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Default Payment Terms</label>
      <input
        className="block-input"
        placeholder="e.g. Net 30"
        value={form.default_payment_terms || ''}
        onChange={e => setForm(p => ({ ...p, default_payment_terms: e.target.value }))}
      />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Default Late Fee %</label>
      <input
        type="number"
        min={0}
        step="0.1"
        className="block-input"
        placeholder="e.g. 1.5"
        value={form.default_late_fee_pct || ''}
        onChange={e => setForm(p => ({ ...p, default_late_fee_pct: parseFloat(e.target.value) || 0 }))}
      />
    </div>
  </div>
</div>
```

### Step 2: Ensure these fields are in the form state, initial value, and save payload

In the form state interface, add:
```typescript
default_payment_terms: string;
default_late_fee_pct: number;
```

In the initial/empty form value, add:
```typescript
default_payment_terms: '',
default_late_fee_pct: 0,
```

When loading an existing client, map:
```typescript
default_payment_terms: existing.default_payment_terms || '',
default_late_fee_pct: existing.default_late_fee_pct || 0,
```

In the save payload:
```typescript
default_payment_terms: form.default_payment_terms.trim() || null,
default_late_fee_pct: form.default_late_fee_pct || 0,
```

### Step 3: Commit

```bash
git add src/renderer/modules/clients/ClientForm.tsx
git commit -m "feat: client default invoice settings (terms + late fee %)"
```

---

## Task 7: InvoiceDetail + print-templates — PO number, job reference, discount row, source debt link

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceDetail.tsx`
- Modify: `src/renderer/lib/print-templates.ts`

### Step 1: Add new fields to Invoice interface in InvoiceDetail

Find the `Invoice` interface and add:
```typescript
po_number?: string;
job_reference?: string;
internal_notes?: string;
late_fee_pct?: number;
discount_pct?: number;
```

### Step 2: Show PO number and job reference in the invoice detail header

Find where `invoice_number`, `issue_date`, `due_date` are displayed in the detail header. After those, add:
```tsx
{invoice.po_number && (
  <div style={{ display: 'flex', gap: 8 }}>
    <span className="text-text-muted text-xs">PO#</span>
    <span className="text-text-primary text-xs font-medium">{invoice.po_number}</span>
  </div>
)}
{invoice.job_reference && (
  <div style={{ display: 'flex', gap: 8 }}>
    <span className="text-text-muted text-xs">Project</span>
    <span className="text-text-primary text-xs font-medium">{invoice.job_reference}</span>
  </div>
)}
```

### Step 3: Show late fee notice in invoice detail footer

After the totals/amounts area, add:
```tsx
{invoice.late_fee_pct > 0 && (
  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
    Late fee of {invoice.late_fee_pct}% applies after {invoice.late_fee_grace_days || 0} grace days.
  </div>
)}
```

### Step 4: Update print-templates.ts to include PO, job reference, discount row

In `generateInvoiceHTML()` (or whichever is the primary template function), find where the invoice header block renders `invoice_number` and client info. Add after the invoice number row:

```typescript
${invoice.po_number ? `<div style="font-size:11px;color:#64748b;">PO# ${invoice.po_number}</div>` : ''}
${invoice.job_reference ? `<div style="font-size:11px;color:#64748b;">Project: ${invoice.job_reference}</div>` : ''}
```

Find the subtotals section (where `subtotal`, `tax`, `total` rows are rendered). Before the total row, add an invoice-level discount row (only when `discount_pct > 0`):

```typescript
${(invoice.discount_pct > 0) ? `
  <tr>
    <td colspan="3" style="text-align:right;padding:3px 8px;font-size:12px;color:#64748b;">Discount (${invoice.discount_pct}%)</td>
    <td style="text-align:right;padding:3px 8px;font-size:12px;color:#ef4444;">-${fmt(subtotal * invoice.discount_pct / 100)}</td>
  </tr>` : ''}
```

Add late fee notice in the footer (if `late_fee_pct > 0`):
```typescript
${invoice.late_fee_pct > 0 ? `<p style="font-size:10px;color:#94a3b8;margin-top:8px;">A late fee of ${invoice.late_fee_pct}% per month applies after ${invoice.late_fee_grace_days || 0} days.</p>` : ''}
```

Do NOT include `internal_notes` in the printed output — it's internal only.

### Step 5: Commit

```bash
git add src/renderer/modules/invoices/InvoiceDetail.tsx src/renderer/lib/print-templates.ts
git commit -m "feat: PO number, job reference, discount row, late fee notice in invoice detail and PDF"
```

---

## Task 8: Debt collector assignment

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`
- Modify: `src/renderer/modules/debt-collection/DebtList.tsx`
- Modify: `src/renderer/modules/debt-collection/PipelineView.tsx`

### Step 1: Add IPC handler

In `ipc/index.ts`, add a handler near the debt handlers:
```typescript
ipcMain.handle('debt:assign-collector', (_event, { debtId, collectorId }) => {
  try {
    db.update('debts', debtId, { assigned_collector_id: collectorId || null });
    scheduleAutoBackup();
    return { ok: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('auth:list-users', () => {
  try {
    return db.queryAll('users', {});
  } catch {
    return [];
  }
});
```

(Note: `auth:list-users` may already exist — check first with grep before adding.)

### Step 2: Add API methods

In `api.ts`, add:
```typescript
assignCollector: (debtId: string, collectorId: string | null): Promise<any> =>
  window.electronAPI.invoke('debt:assign-collector', { debtId, collectorId }),
listUsers: (): Promise<any[]> =>
  window.electronAPI.invoke('auth:list-users'),
```

### Step 3: Add collector dropdown to DebtDetail

In `DebtDetail.tsx`, add `users` state:
```typescript
const [users, setUsers] = useState<any[]>([]);
```

Load users in the useEffect alongside other data:
```typescript
api.listUsers().then(setUsers).catch(() => {});
```

In the debt detail header section (where priority badge, aging badge etc. are shown), add:
```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <span className="text-xs text-text-muted">Collector:</span>
  <select
    className="block-select"
    style={{ fontSize: 12, padding: '2px 8px', minWidth: 140 }}
    value={debt.assigned_collector_id || ''}
    onChange={async (e) => {
      await api.assignCollector(debt.id, e.target.value || null);
      onRefresh();
    }}
  >
    <option value="">Unassigned</option>
    {users.map(u => (
      <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
    ))}
  </select>
</div>
```

### Step 4: Add collector filter to DebtList

In `DebtList.tsx`, add a `collectorFilter` state and a filter dropdown in the header bar:
```typescript
const [collectorFilter, setCollectorFilter] = useState('');
const [users, setUsers] = useState<any[]>([]);
```

Load users on mount. In the debt filtering logic, add:
```typescript
.filter(d => !collectorFilter || d.assigned_collector_id === collectorFilter)
```

Add a filter dropdown in the header near the search/filter controls:
```tsx
<select className="block-select" style={{ fontSize: 12 }} value={collectorFilter} onChange={e => setCollectorFilter(e.target.value)}>
  <option value="">All Collectors</option>
  {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
</select>
```

### Step 5: Add collector badge to PipelineView kanban cards

In `PipelineView.tsx`, load users similarly. On each debt card, if `debt.assigned_collector_id` is set, find the user and show a 2-letter avatar badge:
```tsx
{debt.assigned_collector_id && (() => {
  const u = users.find(x => x.id === debt.assigned_collector_id);
  if (!u) return null;
  const initials = (u.display_name || u.email || '?').slice(0, 2).toUpperCase();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', fontSize: 9, fontWeight: 700 }}>
      {initials}
    </span>
  );
})()}
```

### Step 6: Commit

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/debt-collection/DebtDetail.tsx src/renderer/modules/debt-collection/DebtList.tsx src/renderer/modules/debt-collection/PipelineView.tsx
git commit -m "feat: debt collector assignment with dropdown, filter, and pipeline badge"
```

---

## Task 9: PaymentPlanCard component

**Files:**
- Create: `src/renderer/modules/debt-collection/PaymentPlanCard.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`

### Step 1: Add IPC handlers

In `ipc/index.ts`:
```typescript
ipcMain.handle('debt:payment-plan-get', (_event, { debtId }) => {
  try {
    const plan = db.queryAll('debt_payment_plans', { debt_id: debtId })[0] || null;
    if (!plan) return null;
    const installments = db.queryAll('debt_plan_installments', { plan_id: plan.id },
      { field: 'due_date', dir: 'asc' });
    return { ...plan, installments };
  } catch { return null; }
});

ipcMain.handle('debt:payment-plan-save', (_event, data) => {
  try {
    const { debt_id, installment_amount, frequency, start_date, total_installments, notes } = data;
    // Delete existing plan+installments for this debt
    const existing = db.queryAll('debt_payment_plans', { debt_id })[0];
    if (existing) {
      db.getDb().prepare('DELETE FROM debt_plan_installments WHERE plan_id = ?').run(existing.id);
      db.remove('debt_payment_plans', existing.id);
    }
    // Create new plan
    const plan = db.create('debt_payment_plans', { debt_id, installment_amount, frequency, start_date, total_installments: total_installments || 1, notes: notes || '', status: 'active' });
    // Generate installments
    const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
    const days = freqDays[frequency] || 30;
    let d = new Date(start_date + 'T12:00:00');
    for (let i = 0; i < total_installments; i++) {
      db.create('debt_plan_installments', {
        plan_id: plan.id,
        due_date: d.toISOString().slice(0, 10),
        amount: installment_amount,
        paid: 0,
      });
      d.setDate(d.getDate() + days);
    }
    scheduleAutoBackup();
    return db.queryAll('debt_plan_installments', { plan_id: plan.id }, { field: 'due_date', dir: 'asc' });
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('debt:plan-installment-toggle', (_event, { installmentId, paid }) => {
  try {
    db.update('debt_plan_installments', installmentId, {
      paid: paid ? 1 : 0,
      paid_date: paid ? new Date().toISOString().slice(0, 10) : '',
    });
    scheduleAutoBackup();
    return { ok: true };
  } catch (err: any) {
    return { error: err.message };
  }
});
```

### Step 2: Add API methods

```typescript
getPaymentPlan: (debtId: string): Promise<any> =>
  window.electronAPI.invoke('debt:payment-plan-get', { debtId }),
savePaymentPlan: (data: Record<string, any>): Promise<any> =>
  window.electronAPI.invoke('debt:payment-plan-save', data),
togglePlanInstallment: (installmentId: string, paid: boolean): Promise<any> =>
  window.electronAPI.invoke('debt:plan-installment-toggle', { installmentId, paid }),
```

### Step 3: Create PaymentPlanCard.tsx

```tsx
import React, { useEffect, useState } from 'react';
import { CalendarDays, Plus, Check } from 'lucide-react';
import api from '../../lib/api';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

interface Props {
  debtId: string;
  balanceDue: number;
}

const PaymentPlanCard: React.FC<Props> = ({ debtId, balanceDue }) => {
  const [plan, setPlan] = useState<any>(null);
  const [installments, setInstallments] = useState<any[]>([]);
  const [form, setForm] = useState({ installment_amount: '', frequency: 'monthly', start_date: '', total_installments: '12', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const data = await api.getPaymentPlan(debtId);
    if (data) {
      setPlan(data);
      setInstallments(data.installments || []);
    } else {
      setPlan(null);
      setInstallments([]);
    }
  };

  useEffect(() => { load(); }, [debtId]);

  const handleSave = async () => {
    setSaving(true);
    await api.savePaymentPlan({
      debt_id: debtId,
      installment_amount: parseFloat(form.installment_amount) || 0,
      frequency: form.frequency,
      start_date: form.start_date,
      total_installments: parseInt(form.total_installments) || 1,
      notes: form.notes,
    });
    setShowForm(false);
    setSaving(false);
    load();
  };

  const togglePaid = async (inst: any) => {
    await api.togglePlanInstallment(inst.id, !inst.paid);
    load();
  };

  const paidCount = installments.filter(i => i.paid).length;
  const totalCount = installments.length;
  const paidAmount = installments.filter(i => i.paid).reduce((s, i) => s + i.amount, 0);

  return (
    <div className="block-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={15} className="text-accent-blue" />
          <h4 className="text-sm font-semibold text-text-primary">Payment Plan</h4>
        </div>
        <button className="block-btn flex items-center gap-1.5 text-xs py-1 px-3" onClick={() => setShowForm(s => !s)}>
          <Plus size={12} /> {plan ? 'Edit Plan' : 'Set Up Plan'}
        </button>
      </div>

      {showForm && (
        <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-bg-tertiary" style={{ borderRadius: 6 }}>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Installment Amount</label>
            <input type="number" className="block-input" placeholder="0.00" value={form.installment_amount} onChange={e => setForm(p => ({ ...p, installment_amount: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Frequency</label>
            <select className="block-select" value={form.frequency} onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Start Date</label>
            <input type="date" className="block-input" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Total Installments</label>
            <input type="number" min={1} className="block-input" value={form.total_installments} onChange={e => setForm(p => ({ ...p, total_installments: e.target.value }))} />
          </div>
          <div className="col-span-2 flex justify-end gap-2 mt-1">
            <button className="block-btn text-xs py-1 px-3" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="block-btn-primary text-xs py-1 px-3" disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : 'Generate Plan'}</button>
          </div>
        </div>
      )}

      {installments.length > 0 ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            {paidCount}/{totalCount} paid · {fmt.format(paidAmount)} of {fmt.format(installments.reduce((s, i) => s + i.amount, 0))}
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table className="block-table w-full text-xs">
              <thead><tr><th className="text-left">Due Date</th><th className="text-right">Amount</th><th className="text-center">Paid</th></tr></thead>
              <tbody>
                {installments.map(inst => (
                  <tr key={inst.id} style={{ opacity: inst.paid ? 0.6 : 1 }}>
                    <td>{inst.due_date}</td>
                    <td className="text-right font-mono">{fmt.format(inst.amount)}</td>
                    <td className="text-center">
                      <button onClick={() => togglePaid(inst)} style={{ background: inst.paid ? '#22c55e' : 'var(--color-bg-tertiary)', border: '1px solid var(--color-border-primary)', borderRadius: 4, width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        {inst.paid && <Check size={11} color="#fff" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No payment plan set up.</div>
      )}
    </div>
  );
};

export default PaymentPlanCard;
```

### Step 4: Import and render in DebtDetail

In `DebtDetail.tsx`, import `PaymentPlanCard` and add it to the detail layout:
```tsx
import PaymentPlanCard from './PaymentPlanCard';
// ...
<PaymentPlanCard debtId={debtId} balanceDue={debt.balance_due} />
```

### Step 5: Commit

```bash
git add src/renderer/modules/debt-collection/PaymentPlanCard.tsx src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat: payment plan card with installment tracking"
```

---

## Task 10: SettlementCard component

**Files:**
- Create: `src/renderer/modules/debt-collection/SettlementCard.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`

### Step 1: Add IPC handlers

In `ipc/index.ts`:
```typescript
ipcMain.handle('debt:settlements-list', (_event, { debtId }) => {
  try {
    return db.queryAll('debt_settlements', { debt_id: debtId }, { field: 'created_at', dir: 'desc' });
  } catch { return []; }
});

ipcMain.handle('debt:settlement-save', (_event, data) => {
  try {
    const { debt_id, offer_amount, balance_due, offered_date, notes } = data;
    const offer_pct = balance_due > 0 ? (offer_amount / balance_due) * 100 : 0;
    const result = db.create('debt_settlements', { debt_id, offer_amount, offer_pct, offered_date, notes: notes || '', response: 'pending' });
    scheduleAutoBackup();
    return result;
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('debt:settlement-respond', (_event, { settlementId, response, counter_amount }) => {
  try {
    const data: any = { response };
    if (response === 'accepted') data.accepted_date = new Date().toISOString().slice(0, 10);
    if (counter_amount != null) data.counter_amount = counter_amount;
    db.update('debt_settlements', settlementId, data);
    scheduleAutoBackup();
    return { ok: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('debt:settlement-accept', (_event, { debtId, settlementId, offer_amount }) => {
  try {
    db.update('debt_settlements', settlementId, { response: 'accepted', accepted_date: new Date().toISOString().slice(0, 10) });
    db.update('debts', debtId, { status: 'resolved', balance_due: offer_amount });
    scheduleAutoBackup();
    return { ok: true };
  } catch (err: any) {
    return { error: err.message };
  }
});
```

### Step 2: Add API methods

```typescript
listSettlements: (debtId: string): Promise<any[]> =>
  window.electronAPI.invoke('debt:settlements-list', { debtId }),
saveSettlement: (data: Record<string, any>): Promise<any> =>
  window.electronAPI.invoke('debt:settlement-save', data),
respondSettlement: (settlementId: string, response: string, counterAmount?: number): Promise<any> =>
  window.electronAPI.invoke('debt:settlement-respond', { settlementId, response, counter_amount: counterAmount }),
acceptSettlement: (debtId: string, settlementId: string, offerAmount: number): Promise<any> =>
  window.electronAPI.invoke('debt:settlement-accept', { debtId, settlementId, offer_amount: offerAmount }),
```

### Step 3: Create SettlementCard.tsx

```tsx
import React, { useEffect, useState } from 'react';
import { Handshake, Plus } from 'lucide-react';
import api from '../../lib/api';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const RESPONSE_BADGE: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#d97706' },
  accepted: { label: 'Accepted', color: '#22c55e' },
  rejected: { label: 'Rejected', color: '#ef4444' },
  countered: { label: 'Countered', color: '#8b5cf6' },
};

interface Props {
  debtId: string;
  balanceDue: number;
  onRefresh: () => void;
}

const SettlementCard: React.FC<Props> = ({ debtId, balanceDue, onRefresh }) => {
  const [settlements, setSettlements] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ offer_amount: '', offered_date: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const data = await api.listSettlements(debtId);
    setSettlements(Array.isArray(data) ? data : []);
  };

  useEffect(() => { load(); }, [debtId]);

  const handleSave = async () => {
    setSaving(true);
    await api.saveSettlement({ debt_id: debtId, offer_amount: parseFloat(form.offer_amount) || 0, balance_due: balanceDue, offered_date: form.offered_date, notes: form.notes });
    setShowForm(false);
    setSaving(false);
    load();
  };

  const handleAccept = async (s: any) => {
    if (!window.confirm(`Accept settlement of ${fmt.format(s.offer_amount)} and close this debt?`)) return;
    await api.acceptSettlement(debtId, s.id, s.offer_amount);
    onRefresh();
  };

  const handleReject = async (s: any) => {
    await api.respondSettlement(s.id, 'rejected');
    load();
  };

  return (
    <div className="block-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Handshake size={15} className="text-accent-blue" />
          <h4 className="text-sm font-semibold text-text-primary">Settlement Offers</h4>
        </div>
        <button className="block-btn flex items-center gap-1.5 text-xs py-1 px-3" onClick={() => setShowForm(s => !s)}>
          <Plus size={12} /> New Offer
        </button>
      </div>

      {showForm && (
        <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-bg-tertiary" style={{ borderRadius: 6 }}>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Offer Amount</label>
            <input type="number" className="block-input" placeholder="0.00" value={form.offer_amount} onChange={e => setForm(p => ({ ...p, offer_amount: e.target.value }))} />
            {form.offer_amount && balanceDue > 0 && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                {((parseFloat(form.offer_amount) / balanceDue) * 100).toFixed(1)}% of balance
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Offer Date</label>
            <input type="date" className="block-input" value={form.offered_date} onChange={e => setForm(p => ({ ...p, offered_date: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Notes</label>
            <input className="block-input" placeholder="Settlement notes..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button className="block-btn text-xs py-1 px-3" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="block-btn-primary text-xs py-1 px-3" disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : 'Log Offer'}</button>
          </div>
        </div>
      )}

      {settlements.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No settlement offers logged.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {settlements.map(s => {
            const badge = RESPONSE_BADGE[s.response] || RESPONSE_BADGE.pending;
            return (
              <div key={s.id} style={{ padding: '10px 12px', background: 'var(--color-bg-tertiary)', borderRadius: 6, border: '1px solid var(--color-border-primary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{fmt.format(s.offer_amount)}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>({s.offer_pct?.toFixed(1)}% of balance) · {s.offered_date}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: badge.color, padding: '2px 8px', borderRadius: 4, background: badge.color + '20' }}>{badge.label}</span>
                </div>
                {s.notes && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{s.notes}</div>}
                {s.response === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className="block-btn-primary text-xs py-1 px-3" onClick={() => handleAccept(s)}>Accept & Close</button>
                    <button className="block-btn text-xs py-1 px-3" onClick={() => handleReject(s)}>Reject</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SettlementCard;
```

### Step 4: Import and render in DebtDetail

```tsx
import SettlementCard from './SettlementCard';
// ...
<SettlementCard debtId={debtId} balanceDue={debt.balance_due} onRefresh={onRefresh} />
```

### Step 5: Commit

```bash
git add src/renderer/modules/debt-collection/SettlementCard.tsx src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat: settlement offers card with accept/reject workflow"
```

---

## Task 11: ComplianceLog component (FDCPA)

**Files:**
- Create: `src/renderer/modules/debt-collection/ComplianceLog.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`

### Step 1: Add IPC handlers

```typescript
ipcMain.handle('debt:compliance-list', (_event, { debtId }) => {
  try {
    return db.queryAll('debt_compliance_log', { debt_id: debtId }, { field: 'event_date', dir: 'desc' });
  } catch { return []; }
});

ipcMain.handle('debt:compliance-save', (_event, data) => {
  try {
    const result = db.create('debt_compliance_log', data);
    scheduleAutoBackup();
    return result;
  } catch (err: any) {
    return { error: err.message };
  }
});
```

### Step 2: Add API methods

```typescript
listComplianceLog: (debtId: string): Promise<any[]> =>
  window.electronAPI.invoke('debt:compliance-list', { debtId }),
saveComplianceEvent: (data: Record<string, any>): Promise<any> =>
  window.electronAPI.invoke('debt:compliance-save', data),
```

### Step 3: Create ComplianceLog.tsx

```tsx
import React, { useEffect, useState } from 'react';
import { ShieldCheck, Plus, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';

const EVENT_LABELS: Record<string, string> = {
  validation_notice_sent: 'Validation Notice Sent',
  dispute_received: 'Dispute Received',
  cease_desist_received: 'Cease & Desist Received',
  mini_miranda_delivered: 'Mini-Miranda Delivered',
  right_to_cure_sent: 'Right to Cure Sent',
  payment_plan_agreed: 'Payment Plan Agreed',
  other: 'Other',
};

interface Props {
  debtId: string;
}

const ComplianceLog: React.FC<Props> = ({ debtId }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ event_type: 'validation_notice_sent', event_date: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const data = await api.listComplianceLog(debtId);
    setEvents(Array.isArray(data) ? data : []);
  };

  useEffect(() => { load(); }, [debtId]);

  const handleSave = async () => {
    setSaving(true);
    await api.saveComplianceEvent({ debt_id: debtId, ...form });
    setShowForm(false);
    setSaving(false);
    setForm({ event_type: 'validation_notice_sent', event_date: '', notes: '' });
    load();
  };

  const hasCeaseDesist = events.some(e => e.event_type === 'cease_desist_received');

  return (
    <div className="block-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-accent-blue" />
          <h4 className="text-sm font-semibold text-text-primary">FDCPA Compliance Log</h4>
        </div>
        <button className="block-btn flex items-center gap-1.5 text-xs py-1 px-3" onClick={() => setShowForm(s => !s)}>
          <Plus size={12} /> Log Event
        </button>
      </div>

      {hasCeaseDesist && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', borderRadius: 6, marginBottom: 12 }}>
          <AlertTriangle size={14} color="#ef4444" />
          <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>Cease & Desist received — communications restricted</span>
        </div>
      )}

      {showForm && (
        <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-bg-tertiary" style={{ borderRadius: 6 }}>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Event Type</label>
            <select className="block-select" value={form.event_type} onChange={e => setForm(p => ({ ...p, event_type: e.target.value }))}>
              {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Event Date</label>
            <input type="date" className="block-input" value={form.event_date} onChange={e => setForm(p => ({ ...p, event_date: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Notes</label>
            <input className="block-input" placeholder="Additional details..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button className="block-btn text-xs py-1 px-3" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="block-btn-primary text-xs py-1 px-3" disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : 'Log Event'}</button>
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No compliance events logged.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {events.map(ev => (
            <div key={ev.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: 'var(--color-bg-tertiary)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', minWidth: 80 }}>{ev.event_date}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{EVENT_LABELS[ev.event_type] || ev.event_type}</div>
                {ev.notes && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{ev.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ComplianceLog;
```

### Step 4: Import and render in DebtDetail

```tsx
import ComplianceLog from './ComplianceLog';
// ...
<ComplianceLog debtId={debtId} />
```

### Step 5: Commit

```bash
git add src/renderer/modules/debt-collection/ComplianceLog.tsx src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat: FDCPA compliance log with cease-and-desist warning banner"
```

---

## Task 12: Risk scoring badge

**Files:**
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`
- Modify: `src/renderer/modules/debt-collection/DebtList.tsx`

### Step 1: Create risk score calculation helper

Add this function near the top of both `DebtDetail.tsx` and `DebtList.tsx` (or extract to a shared helper file `src/renderer/modules/debt-collection/riskScore.ts`):

```typescript
// src/renderer/modules/debt-collection/riskScore.ts
export function calcRiskScore(debt: any, brokenPromisesCount = 0): number {
  let score = 0;

  // Days delinquent
  const delinquentDate = debt.delinquent_date || debt.due_date;
  const days = delinquentDate
    ? Math.max(0, Math.floor((Date.now() - new Date(delinquentDate).getTime()) / 86400000))
    : 0;
  if (days <= 30) score += 10;
  else if (days <= 90) score += 20;
  else if (days <= 180) score += 30;
  else score += 40;

  // Balance tier
  const bal = debt.balance_due || 0;
  if (bal < 500) score += 5;
  else if (bal < 2000) score += 10;
  else if (bal < 10000) score += 20;
  else score += 30;

  // Stage
  const STAGE_SCORES: Record<string, number> = {
    reminder: 5, warning: 10, final_notice: 15, demand_letter: 20,
    collections_agency: 25, legal_action: 30, judgment: 35, garnishment: 35,
  };
  score += STAGE_SCORES[debt.current_stage] || 5;

  // Broken promises
  score += Math.min(brokenPromisesCount * 5, 20);

  return Math.min(score, 100);
}

export function getRiskBadge(score: number): { label: string; color: string } {
  if (score <= 30) return { label: 'Low', color: '#22c55e' };
  if (score <= 55) return { label: 'Medium', color: '#d97706' };
  if (score <= 80) return { label: 'High', color: '#f97316' };
  return { label: 'Critical', color: '#ef4444' };
}
```

### Step 2: Show risk badge in DebtDetail header

In `DebtDetail.tsx`, import and use:
```typescript
import { calcRiskScore, getRiskBadge } from './riskScore';
```

After loading promises data (use the already-loaded `promises` state to count broken ones):
```typescript
const brokenCount = promises.filter(p => p.kept === 0 && p.promised_date < new Date().toISOString().slice(0, 10)).length;
const riskScore = calcRiskScore(debt, brokenCount);
const riskBadge = getRiskBadge(riskScore);
```

In the header, next to the aging badge, add:
```tsx
<span style={{ fontSize: 11, fontWeight: 700, color: riskBadge.color, background: riskBadge.color + '20', padding: '2px 8px', borderRadius: 4 }}>
  Risk: {riskBadge.label} ({riskScore})
</span>
```

### Step 3: Show risk badge in DebtList

In `DebtList.tsx`, import and use the same helpers. For each debt card/row, compute and display:
```tsx
const score = calcRiskScore(debt);
const badge = getRiskBadge(score);
// ...
<span style={{ fontSize: 10, fontWeight: 700, color: badge.color }}>{badge.label}</span>
```

### Step 4: Commit

```bash
git add src/renderer/modules/debt-collection/riskScore.ts src/renderer/modules/debt-collection/DebtDetail.tsx src/renderer/modules/debt-collection/DebtList.tsx
git commit -m "feat: risk score badge on debt detail and list"
```

---

## Task 13: Auto-stage progression

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/modules/debt-collection/AutomationSettings.tsx`

### Step 1: Add IPC handler

```typescript
ipcMain.handle('debt:check-auto-advance', (_event, { companyId, thresholdDays = 30 }) => {
  try {
    const STAGE_ORDER = ['reminder', 'warning', 'final_notice', 'demand_letter', 'collections_agency', 'legal_action'];
    const debts = db.queryAll('debts', { company_id: companyId, auto_advance_enabled: 1 });
    let advanced = 0;
    const now = new Date();

    for (const debt of debts) {
      const stageIdx = STAGE_ORDER.indexOf(debt.current_stage);
      if (stageIdx < 0 || stageIdx >= STAGE_ORDER.length - 1) continue;

      const lastActivity = new Date(debt.updated_at || debt.created_at);
      const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / 86400000);

      if (daysSince >= thresholdDays) {
        const nextStage = STAGE_ORDER[stageIdx + 1];
        db.update('debts', debt.id, { current_stage: nextStage });
        db.create('debt_pipeline_stages', { debt_id: debt.id, stage: nextStage, auto_advanced: 1, advanced_by: 'system' });
        db.create('debt_communications', {
          debt_id: debt.id,
          type: 'note',
          date: now.toISOString().slice(0, 10),
          notes: `Auto-advanced from ${debt.current_stage} to ${nextStage} after ${daysSince} days of inactivity.`,
          outcome: 'auto_advanced',
        });
        advanced++;
      }
    }

    if (advanced > 0) scheduleAutoBackup();
    return { advanced };
  } catch (err: any) {
    return { error: err.message, advanced: 0 };
  }
});
```

### Step 2: Add API method

```typescript
checkAutoAdvance: (companyId: string, thresholdDays?: number): Promise<{ advanced: number }> =>
  window.electronAPI.invoke('debt:check-auto-advance', { companyId, thresholdDays }),
```

### Step 3: Wire auto-advance on module load

In `AutomationSettings.tsx` (or in `debt-collection/index.tsx`), call `api.checkAutoAdvance` on mount:
```typescript
useEffect(() => {
  if (activeCompany?.id) {
    api.checkAutoAdvance(activeCompany.id, thresholdDays).then(r => {
      if (r.advanced > 0) console.log(`Auto-advanced ${r.advanced} debt(s)`);
    });
  }
}, [activeCompany?.id]);
```

### Step 4: Add threshold setting + auto_advance_enabled toggle to AutomationSettings

In `AutomationSettings.tsx`, find the existing UI and add:
- A number input for "Auto-advance threshold (days)" (stored in component state or localStorage)
- Note: Per-debt `auto_advance_enabled` is toggled in DebtDetail (add a small checkbox in DebtDetail near the priority selector):

In `DebtDetail.tsx`, near the priority/assigned area, add:
```tsx
<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
  <input
    type="checkbox"
    checked={!!debt.auto_advance_enabled}
    onChange={async e => {
      await api.update('debts', debt.id, { auto_advance_enabled: e.target.checked ? 1 : 0 });
      onRefresh();
    }}
    style={{ width: 14, height: 14 }}
  />
  Auto-advance stage
</label>
```

### Step 5: Commit

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/debt-collection/DebtDetail.tsx src/renderer/modules/debt-collection/AutomationSettings.tsx
git commit -m "feat: auto-stage progression on module load + per-debt toggle"
```

---

## Task 14: Invoice → Debt bridge

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/modules/invoices/InvoiceList.tsx`
- Modify: `src/renderer/modules/invoices/InvoiceDetail.tsx`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`

### Step 1: Add IPC handlers

```typescript
ipcMain.handle('invoice:overdue-candidates', (_event, { companyId, thresholdDays = 30 }) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return db.getDb().prepare(`
      SELECT i.*, c.name as client_name
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.company_id = ?
        AND i.status IN ('overdue', 'sent')
        AND i.due_date <= ?
        AND i.id NOT IN (SELECT invoice_id FROM invoice_debt_links)
    `).all(companyId, cutoffStr);
  } catch { return []; }
});

ipcMain.handle('invoice:convert-to-debt', (_event, { invoiceId, companyId }) => {
  try {
    const inv = db.getById('invoices', invoiceId);
    if (!inv) return { error: 'Invoice not found' };
    const client = inv.client_id ? db.getById('clients', inv.client_id) : null;
    const balance = (inv.total || 0) - (inv.amount_paid || 0);

    const debt = db.create('debts', {
      company_id: companyId,
      type: 'receivable',
      debtor_type: client ? 'client' : 'custom',
      debtor_id: inv.client_id || null,
      debtor_name: client?.name || inv.client_name || 'Unknown',
      debtor_email: client?.email || null,
      debtor_phone: client?.phone || null,
      original_amount: balance,
      balance_due: balance,
      due_date: inv.due_date,
      delinquent_date: inv.due_date,
      source_type: 'invoice',
      source_id: invoiceId,
      status: 'active',
      current_stage: 'reminder',
      priority: 'medium',
    });

    db.create('debt_pipeline_stages', { debt_id: debt.id, stage: 'reminder' });
    db.create('invoice_debt_links', { invoice_id: invoiceId, debt_id: debt.id });
    db.update('invoices', invoiceId, { status: 'overdue' });

    scheduleAutoBackup();
    return { debt_id: debt.id };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('invoice:debt-link', (_event, { invoiceId }) => {
  try {
    return db.getDb().prepare('SELECT * FROM invoice_debt_links WHERE invoice_id = ?').get(invoiceId) || null;
  } catch { return null; }
});

ipcMain.handle('debt:invoice-link', (_event, { debtId }) => {
  try {
    return db.getDb().prepare('SELECT * FROM invoice_debt_links WHERE debt_id = ?').get(debtId) || null;
  } catch { return null; }
});
```

### Step 2: Add API methods

```typescript
getOverdueCandidates: (companyId: string, thresholdDays?: number): Promise<any[]> =>
  window.electronAPI.invoke('invoice:overdue-candidates', { companyId, thresholdDays }),
convertInvoiceToDebt: (invoiceId: string, companyId: string): Promise<{ debt_id?: string; error?: string }> =>
  window.electronAPI.invoke('invoice:convert-to-debt', { invoiceId, companyId }),
getInvoiceDebtLink: (invoiceId: string): Promise<any> =>
  window.electronAPI.invoke('invoice:debt-link', { invoiceId }),
getDebtInvoiceLink: (debtId: string): Promise<any> =>
  window.electronAPI.invoke('debt:invoice-link', { debtId }),
```

### Step 3: Add overdue conversion banner to InvoiceList

In `InvoiceList.tsx`, add state for candidates:
```typescript
const [candidates, setCandidates] = useState<any[]>([]);
const [showConvertModal, setShowConvertModal] = useState(false);
const [bannerDismissed, setBannerDismissed] = useState(false);
```

Load candidates on mount:
```typescript
if (activeCompany?.id) {
  api.getOverdueCandidates(activeCompany.id, 30).then(data => {
    setCandidates(Array.isArray(data) ? data : []);
  });
}
```

Add banner just below the module header (before the list):
```tsx
{candidates.length > 0 && !bannerDismissed && (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', borderRadius: 6, marginBottom: 12 }}>
    <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
      {candidates.length} overdue invoice{candidates.length !== 1 ? 's' : ''} eligible for debt collection
    </span>
    <div style={{ display: 'flex', gap: 8 }}>
      <button className="block-btn text-xs py-1 px-3" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={() => setShowConvertModal(true)}>Review</button>
      <button className="text-text-muted" style={{ fontSize: 12 }} onClick={() => setBannerDismissed(true)}>Dismiss</button>
    </div>
  </div>
)}
```

Add conversion modal (simple overlay):
```tsx
{showConvertModal && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div className="block-card p-6" style={{ width: 560, maxHeight: '80vh', overflow: 'auto' }}>
      <h3 className="text-sm font-semibold text-text-primary mb-4">Overdue Invoices — Convert to Debt Collection</h3>
      <table className="block-table w-full text-xs mb-4">
        <thead><tr><th className="text-left">Invoice</th><th className="text-left">Client</th><th className="text-right">Balance</th><th className="text-right">Days Overdue</th><th /></tr></thead>
        <tbody>
          {candidates.map(inv => {
            const days = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
            const balance = (inv.total || 0) - (inv.amount_paid || 0);
            return (
              <tr key={inv.id}>
                <td>{inv.invoice_number}</td>
                <td>{inv.client_name || '—'}</td>
                <td className="text-right font-mono">${balance.toFixed(2)}</td>
                <td className="text-right">{days}d</td>
                <td className="text-right">
                  <button className="block-btn-primary text-xs py-1 px-2" onClick={async () => {
                    await api.convertInvoiceToDebt(inv.id, activeCompany!.id);
                    setCandidates(prev => prev.filter(c => c.id !== inv.id));
                    if (candidates.length <= 1) setShowConvertModal(false);
                  }}>Convert</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex justify-end">
        <button className="block-btn text-xs py-1 px-3" onClick={() => setShowConvertModal(false)}>Close</button>
      </div>
    </div>
  </div>
)}
```

### Step 4: Add "In Collections" badge and debt link in InvoiceDetail

In `InvoiceDetail.tsx`, load the debt link:
```typescript
const [debtLink, setDebtLink] = useState<any>(null);
// in useEffect:
api.getInvoiceDebtLink(invoiceId).then(setDebtLink);
```

Near the invoice status badge, show:
```tsx
{debtLink && (
  <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: 4 }}>In Collections</span>
)}
```

### Step 5: Add source invoice link in DebtDetail

In `DebtDetail.tsx`, load the invoice link:
```typescript
const [invoiceLink, setInvoiceLink] = useState<any>(null);
// in useEffect:
api.getDebtInvoiceLink(debtId).then(setInvoiceLink);
```

Show in the detail (near source type info):
```tsx
{invoiceLink && (
  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
    Source: <span style={{ color: 'var(--color-accent)', cursor: 'pointer' }}>Invoice #{debt.source_id}</span>
  </div>
)}
```

### Step 6: Commit

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/invoices/InvoiceList.tsx src/renderer/modules/invoices/InvoiceDetail.tsx src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat: invoice-to-debt bridge with overdue banner, convert modal, and cross-module links"
```

---

## Verification Checklist

After all tasks:

1. **Task 1 (bug fix)**: Create a new receivable debt manually (debtor_type = custom, fill name/amount/due date, save). Should save without error.
2. **Task 1 (bug fix)**: Set source_type = 'From Invoice' — the dropdown should show invoice numbers, not blank.
3. **Task 2**: Select a Client in the debt form — an "Account Details" panel should appear below with industry, credit limit, etc.
4. **Task 3**: Relaunch app — no crash on startup means migrations ran.
5. **Task 4**: Create a new invoice — see Settings & References section, split notes. Select a client with default_payment_terms set — terms auto-fills.
6. **Task 5**: Add a line item — see Disc% and Tax% columns.
7. **Task 6**: Open client form — see Default Invoice Settings subsection.
8. **Task 7**: Print an invoice with PO number set — it appears in the PDF header.
9. **Task 8**: Open a debt detail — see Assigned To dropdown. Filter DebtList by collector.
10. **Task 9**: Set up a payment plan — installments generate. Mark one paid.
11. **Task 10**: Log a settlement offer. Click Accept & Close — debt resolves.
12. **Task 11**: Log a cease & desist event — red warning banner appears.
13. **Task 12**: Open a debt detail — Risk badge shows (Low/Medium/High/Critical).
14. **Task 13**: Enable auto-advance on a debt — reopen module — stage may advance if inactive long enough.
15. **Task 14**: InvoiceList shows banner if overdue invoices exist. Click Convert — debt is created and cross-links appear.
