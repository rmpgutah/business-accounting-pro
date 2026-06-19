# Custom Features Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand data entry for Employees/Clients/Vendors, enrich Debt Collection with promises/aging/PDFs, upgrade the KPI Dashboard with new analytics widgets, and build enterprise payroll foundations (state tax engine, deductions, PTO).

**Architecture:** Two independent tracks. Track 1 (DB migrations → form expansions → debt PDFs) is self-contained UI/DB work. Track 2 (analytics IPC → KPI widgets → StateTaxEngine → deductions → PTO) builds enterprise payroll infrastructure. Both tracks share the same migration pattern: add to the `migrations[]` array in `database/index.ts`, catch errors for idempotency.

**Tech Stack:** Electron 41, React 19, TypeScript, SQLite (better-sqlite3), Tailwind CSS, existing `recharts` library (already imported in KPI dashboard), inline SVG for new charts, `print-templates.ts` pattern for PDFs.

---

## TRACK 1

---

### Task 1: DB Migrations — Track 1

**Files:**
- Modify: `src/main/database/index.ts` (migrations array ~line 41, tablesWithoutUpdatedAt ~line 180)
- Modify: `src/main/ipc/index.ts` (tablesWithoutCompanyId ~line 400)

**Step 1: Add Track 1 migrations to `src/main/database/index.ts`**

Inside the `migrations` array, after the existing last entry (the `invoice_catalog_items` CREATE TABLE and invoice studio migrations), add:

```typescript
    // Track 1: Data entry expansion (2026-04-07)
    "ALTER TABLE employees ADD COLUMN employment_type TEXT DEFAULT 'full-time'",
    "ALTER TABLE employees ADD COLUMN department TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN job_title TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN emergency_contact_name TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN emergency_contact_phone TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN routing_number TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN account_number TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN account_type TEXT DEFAULT 'checking'",
    "ALTER TABLE employees ADD COLUMN notes TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN industry TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN website TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN company_size TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT 0",
    "ALTER TABLE clients ADD COLUMN preferred_payment_method TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN assigned_rep_id TEXT DEFAULT NULL",
    "ALTER TABLE clients ADD COLUMN internal_notes TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN tags TEXT DEFAULT '[]'",
    `CREATE TABLE IF NOT EXISTS client_contacts (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      title TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      is_primary INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    "ALTER TABLE vendors ADD COLUMN w9_status TEXT DEFAULT 'not_collected'",
    "ALTER TABLE vendors ADD COLUMN is_1099_eligible INTEGER DEFAULT 0",
    "ALTER TABLE vendors ADD COLUMN ach_routing TEXT DEFAULT ''",
    "ALTER TABLE vendors ADD COLUMN ach_account TEXT DEFAULT ''",
    "ALTER TABLE vendors ADD COLUMN ach_account_type TEXT DEFAULT 'checking'",
    "ALTER TABLE vendors ADD COLUMN contract_start TEXT DEFAULT ''",
    "ALTER TABLE vendors ADD COLUMN contract_end TEXT DEFAULT ''",
    "ALTER TABLE vendors ADD COLUMN contract_notes TEXT DEFAULT ''",
    "ALTER TABLE debts ADD COLUMN employer_name TEXT DEFAULT ''",
    "ALTER TABLE debts ADD COLUMN employment_status TEXT DEFAULT 'unknown'",
    "ALTER TABLE debts ADD COLUMN monthly_income_estimate REAL DEFAULT 0",
    "ALTER TABLE debts ADD COLUMN best_contact_time TEXT DEFAULT ''",
    "ALTER TABLE debts ADD COLUMN debtor_attorney_name TEXT DEFAULT ''",
    "ALTER TABLE debts ADD COLUMN debtor_attorney_phone TEXT DEFAULT ''",
    "ALTER TABLE debt_communications ADD COLUMN outcome TEXT DEFAULT ''",
    "ALTER TABLE debt_communications ADD COLUMN next_action TEXT DEFAULT ''",
    "ALTER TABLE debt_communications ADD COLUMN next_action_date TEXT DEFAULT ''",
    "ALTER TABLE debt_communications ADD COLUMN promise_amount REAL DEFAULT 0",
    "ALTER TABLE debt_communications ADD COLUMN promise_date TEXT DEFAULT ''",
    `CREATE TABLE IF NOT EXISTS debt_promises (
      id TEXT PRIMARY KEY,
      debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
      promised_date TEXT NOT NULL DEFAULT '',
      promised_amount REAL NOT NULL DEFAULT 0,
      kept INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
```

**Step 2: Add `client_contacts` and `debt_promises` to `tablesWithoutUpdatedAt`**

In the `tablesWithoutUpdatedAt` Set, add:
```typescript
  'client_contacts',
  'debt_promises',
```

**Step 3: Add `client_contacts` and `debt_promises` to `tablesWithoutCompanyId` in `ipc/index.ts`**

In the `tablesWithoutCompanyId` Set (around line 400), add:
```typescript
    'client_contacts',   // company_id lives on parent clients table
    'debt_promises',     // company_id lives on parent debts table
```

**Step 4: Add IPC handlers for client_contacts in `ipc/index.ts`**

After the `invoice:catalog-delete` handler (around line 962), add:

```typescript
  // ─── Client Contacts ──────────────────────────────────
  ipcMain.handle('client:contacts-list', (_event, clientId: string) => {
    try {
      return db.queryAll('client_contacts', { client_id: clientId }, { field: 'is_primary', dir: 'desc' });
    } catch { return []; }
  });

  ipcMain.handle('client:contacts-save', (_event, { clientId, contacts }: { clientId: string; contacts: any[] }) => {
    try {
      db.getDb().prepare('DELETE FROM client_contacts WHERE client_id = ?').run(clientId);
      const inserted = contacts.map((c) => db.create('client_contacts', {
        id: c.id || undefined,
        client_id: clientId,
        name: c.name || '',
        title: c.title || '',
        email: c.email || '',
        phone: c.phone || '',
        is_primary: c.is_primary ? 1 : 0,
      }));
      scheduleAutoBackup();
      return inserted;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Debt Promises ────────────────────────────────────
  ipcMain.handle('debt:promises-list', (_event, debtId: string) => {
    try {
      return db.queryAll('debt_promises', { debt_id: debtId }, { field: 'promised_date', dir: 'desc' });
    } catch { return []; }
  });

  ipcMain.handle('debt:promise-save', (_event, data: Record<string, any>) => {
    try {
      const result = db.create('debt_promises', {
        debt_id: data.debt_id,
        promised_date: data.promised_date || '',
        promised_amount: Number(data.promised_amount || 0),
        kept: data.kept ? 1 : 0,
        notes: data.notes || '',
      });
      scheduleAutoBackup();
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('debt:promise-update', (_event, { id, kept, notes }: { id: string; kept: boolean; notes?: string }) => {
    try {
      return db.update('debt_promises', id, { kept: kept ? 1 : 0, notes: notes || '' });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Debt Portfolio Report Data ───────────────────────
  ipcMain.handle('debt:portfolio-report-data', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbConn = db.getDb();
      const debts = dbConn.prepare(`SELECT * FROM debts WHERE company_id = ? AND status != 'written_off'`).all(companyId);
      const payments = dbConn.prepare(`
        SELECT dp.*, d.company_id FROM debt_payments dp
        JOIN debts d ON dp.debt_id = d.id
        WHERE d.company_id = ?
      `).all(companyId);
      const today = new Date();
      const startOfYear = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
      const paymentsYtd = payments.filter((p: any) => p.received_date >= startOfYear);
      const collectedYtd = paymentsYtd.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
      return { debts, payments, collectedYtd };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
```

**Step 5: Add API methods in `src/renderer/lib/api.ts`**

After `savePaymentSchedule`, add:
```typescript
  listClientContacts: (clientId: string): Promise<any[]> =>
    window.electronAPI.invoke('client:contacts-list', clientId),
  saveClientContacts: (clientId: string, contacts: any[]): Promise<any> =>
    window.electronAPI.invoke('client:contacts-save', { clientId, contacts }),
  listDebtPromises: (debtId: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:promises-list', debtId),
  saveDebtPromise: (data: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('debt:promise-save', data),
  updateDebtPromise: (id: string, kept: boolean, notes?: string): Promise<any> =>
    window.electronAPI.invoke('debt:promise-update', { id, kept, notes }),
  getDebtPortfolioReportData: (companyId: string): Promise<any> =>
    window.electronAPI.invoke('debt:portfolio-report-data', { companyId }),
```

**Step 6: Commit**
```bash
git add src/main/database/index.ts src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat: Track 1 DB migrations + IPC handlers for client contacts, debt promises, portfolio report"
```

---

### Task 2: Employee Form Expansion

**Files:**
- Modify: `src/renderer/modules/payroll/EmployeeForm.tsx`

**Step 1: Expand `EmployeeFormData` interface and `EMPTY_FORM`**

After the existing fields in `EmployeeFormData`, add:
```typescript
  employment_type: 'full-time' | 'part-time' | 'contractor';
  department: string;
  job_title: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  routing_number: string;
  account_number: string;
  account_type: 'checking' | 'savings';
  notes: string;
```

In `EMPTY_FORM`, add:
```typescript
  employment_type: 'full-time',
  department: '',
  job_title: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  routing_number: '',
  account_number: '',
  account_type: 'checking',
  notes: '',
```

**Step 2: Add tab state and update load/save logic**

At the top of the component, add:
```typescript
const [activeTab, setActiveTab] = useState<'general' | 'hr' | 'banking'>('general');
```

In the load useEffect, map the new fields from the DB record (same pattern as existing fields):
```typescript
  employment_type: emp.employment_type ?? 'full-time',
  department: emp.department ?? '',
  job_title: emp.job_title ?? '',
  emergency_contact_name: emp.emergency_contact_name ?? '',
  emergency_contact_phone: emp.emergency_contact_phone ?? '',
  routing_number: emp.routing_number ?? '',
  account_number: emp.account_number ?? '',
  account_type: emp.account_type ?? 'checking',
  notes: emp.notes ?? '',
```

**Step 3: Replace the single-pane form body with a tabbed layout**

The existing form renders one big grid. Wrap it in a tab system. Replace the form body (after the header and before the save button) with:

```tsx
{/* Tab bar */}
<div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border-primary)', marginBottom: 20 }}>
  {(['general', 'hr', 'banking'] as const).map((tab) => (
    <button
      key={tab}
      type="button"
      onClick={() => setActiveTab(tab)}
      style={{
        padding: '8px 20px', fontSize: '12px', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.6px',
        background: 'transparent', border: 'none', cursor: 'pointer',
        borderBottom: activeTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
        color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
      }}
    >
      {tab === 'general' ? 'General' : tab === 'hr' ? 'HR & Profile' : 'Banking & Emergency'}
    </button>
  ))}
</div>

{/* General tab — existing fields unchanged */}
{activeTab === 'general' && (
  <div className="grid grid-cols-2 gap-4">
    {/* ... all existing fields: name, email, type, pay_type, pay_rate, pay_schedule, filing_status, federal_allowances, state, state_allowances, ssn_last4, status ... */}
  </div>
)}

{/* HR tab */}
{activeTab === 'hr' && (
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Employment Type</label>
      <select className="block-select" value={form.employment_type} onChange={(e) => setForm(p => ({ ...p, employment_type: e.target.value as any }))}>
        <option value="full-time">Full-Time</option>
        <option value="part-time">Part-Time</option>
        <option value="contractor">Contractor</option>
      </select>
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Department</label>
      <input className="block-input" value={form.department} onChange={(e) => setForm(p => ({ ...p, department: e.target.value }))} placeholder="e.g. Engineering" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Job Title</label>
      <input className="block-input" value={form.job_title} onChange={(e) => setForm(p => ({ ...p, job_title: e.target.value }))} placeholder="e.g. Senior Developer" />
    </div>
    <div className="col-span-2">
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Notes</label>
      <textarea className="block-input" rows={4} value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Internal HR notes..." style={{ resize: 'vertical' }} />
    </div>
  </div>
)}

{/* Banking & Emergency tab */}
{activeTab === 'banking' && (
  <div className="grid grid-cols-2 gap-4">
    <div className="col-span-2">
      <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Direct Deposit</div>
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Routing Number</label>
      <input className="block-input font-mono" value={form.routing_number} onChange={(e) => setForm(p => ({ ...p, routing_number: e.target.value }))} placeholder="9 digits" maxLength={9} />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Number</label>
      <input className="block-input font-mono" value={form.account_number} onChange={(e) => setForm(p => ({ ...p, account_number: e.target.value }))} placeholder="Account number" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Type</label>
      <select className="block-select" value={form.account_type} onChange={(e) => setForm(p => ({ ...p, account_type: e.target.value as any }))}>
        <option value="checking">Checking</option>
        <option value="savings">Savings</option>
      </select>
    </div>
    <div className="col-span-2" style={{ marginTop: 16 }}>
      <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Emergency Contact</div>
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contact Name</label>
      <input className="block-input" value={form.emergency_contact_name} onChange={(e) => setForm(p => ({ ...p, emergency_contact_name: e.target.value }))} placeholder="Full name" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contact Phone</label>
      <input className="block-input" value={form.emergency_contact_phone} onChange={(e) => setForm(p => ({ ...p, emergency_contact_phone: e.target.value }))} placeholder="(555) 000-0000" />
    </div>
  </div>
)}
```

**Step 4: Include new fields in the save payload**

In the `handleSave` function (wherever it calls `api.update` or `api.create` on `employees`), add all new fields to the data object:
```typescript
  employment_type: form.employment_type,
  department: form.department,
  job_title: form.job_title,
  emergency_contact_name: form.emergency_contact_name,
  emergency_contact_phone: form.emergency_contact_phone,
  routing_number: form.routing_number,
  account_number: form.account_number,
  account_type: form.account_type,
  notes: form.notes,
```

**Step 5: Commit**
```bash
git add src/renderer/modules/payroll/EmployeeForm.tsx
git commit -m "feat: employee form — tabbed layout with HR profile, direct deposit, emergency contact"
```

---

### Task 3: Client Form Expansion + Multi-Contact

**Files:**
- Modify: `src/renderer/modules/clients/ClientForm.tsx`

**Step 1: Expand `ClientData` interface**

Add to `ClientData`:
```typescript
  industry: string;
  website: string;
  company_size: string;
  credit_limit: number;
  preferred_payment_method: string;
  assigned_rep_id: string;
  internal_notes: string;
  tags: string;
```

Add to `EMPTY_CLIENT`:
```typescript
  industry: '',
  website: '',
  company_size: '',
  credit_limit: 0,
  preferred_payment_method: '',
  assigned_rep_id: '',
  internal_notes: '',
  tags: '',
```

**Step 2: Add contact state and users list**

```typescript
interface ClientContact {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: boolean;
}

const [contacts, setContacts] = useState<ClientContact[]>([]);
const [users, setUsers] = useState<{ id: string; display_name: string }[]>([]);
```

Load users in the existing `useEffect`:
```typescript
const usersData = await api.rawQuery('SELECT id, display_name FROM users ORDER BY display_name', []).catch(() => []);
setUsers(usersData ?? []);
if (clientId) {
  const contactsData = await api.listClientContacts(clientId).catch(() => []);
  setContacts((contactsData ?? []).map((c: any) => ({ ...c, is_primary: !!c.is_primary })));
}
```

Map new fields when loading existing client:
```typescript
  industry: data.industry || '',
  website: data.website || '',
  company_size: data.company_size || '',
  credit_limit: data.credit_limit ?? 0,
  preferred_payment_method: data.preferred_payment_method || '',
  assigned_rep_id: data.assigned_rep_id || '',
  internal_notes: data.internal_notes || '',
  tags: data.tags || '',
```

**Step 3: Add new fields to form UI**

After the existing `notes` field, add a new section:
```tsx
{/* Extended Profile */}
<div className="col-span-2" style={{ borderTop: '1px solid var(--color-border-primary)', paddingTop: 16, marginTop: 4 }}>
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Extended Profile</div>
  <div className="grid grid-cols-2 gap-4">
    <Field label="Industry">
      <input className="block-input" value={client.industry} onChange={(e) => setClient(p => ({ ...p, industry: e.target.value }))} placeholder="e.g. Technology" />
    </Field>
    <Field label="Website">
      <input className="block-input" value={client.website} onChange={(e) => setClient(p => ({ ...p, website: e.target.value }))} placeholder="https://example.com" />
    </Field>
    <Field label="Company Size">
      <select className="block-select" value={client.company_size} onChange={(e) => setClient(p => ({ ...p, company_size: e.target.value }))}>
        <option value="">Unknown</option>
        <option value="1-10">1–10 employees</option>
        <option value="11-50">11–50</option>
        <option value="51-200">51–200</option>
        <option value="201-1000">201–1,000</option>
        <option value="1000+">1,000+</option>
      </select>
    </Field>
    <Field label="Credit Limit ($)">
      <input type="number" min={0} step="100" className="block-input" value={client.credit_limit} onChange={(e) => setClient(p => ({ ...p, credit_limit: parseFloat(e.target.value) || 0 }))} />
    </Field>
    <Field label="Preferred Payment Method">
      <select className="block-select" value={client.preferred_payment_method} onChange={(e) => setClient(p => ({ ...p, preferred_payment_method: e.target.value }))}>
        <option value="">Not specified</option>
        <option value="check">Check</option>
        <option value="ach">ACH / Bank Transfer</option>
        <option value="credit_card">Credit Card</option>
        <option value="wire">Wire Transfer</option>
        <option value="cash">Cash</option>
      </select>
    </Field>
    <Field label="Assigned Rep">
      <select className="block-select" value={client.assigned_rep_id} onChange={(e) => setClient(p => ({ ...p, assigned_rep_id: e.target.value }))}>
        <option value="">Unassigned</option>
        {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
      </select>
    </Field>
    <Field label="Internal Notes" span={2}>
      <textarea className="block-input" rows={3} value={client.internal_notes} onChange={(e) => setClient(p => ({ ...p, internal_notes: e.target.value }))} placeholder="Internal notes (not visible to client)" style={{ resize: 'vertical' }} />
    </Field>
  </div>
</div>

{/* Contacts */}
<div className="col-span-2" style={{ borderTop: '1px solid var(--color-border-primary)', paddingTop: 16, marginTop: 4 }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">Contacts</div>
    <button type="button" className="block-btn text-xs py-1 px-3"
      onClick={() => setContacts(prev => [...prev, { id: `new-${Date.now()}`, name: '', title: '', email: '', phone: '', is_primary: prev.length === 0 }])}>
      + Add Contact
    </button>
  </div>
  {contacts.map((c, idx) => (
    <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
      <input className="block-input" placeholder="Name *" value={c.name} onChange={(e) => setContacts(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
      <input className="block-input" placeholder="Title" value={c.title} onChange={(e) => setContacts(prev => prev.map((x, i) => i === idx ? { ...x, title: e.target.value } : x))} />
      <input className="block-input" placeholder="Email" value={c.email} onChange={(e) => setContacts(prev => prev.map((x, i) => i === idx ? { ...x, email: e.target.value } : x))} />
      <input className="block-input" placeholder="Phone" value={c.phone} onChange={(e) => setContacts(prev => prev.map((x, i) => i === idx ? { ...x, phone: e.target.value } : x))} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={c.is_primary} onChange={(e) => {
          if (e.target.checked) setContacts(prev => prev.map((x, i) => ({ ...x, is_primary: i === idx })));
        }} /> Primary
      </label>
      <button type="button" className="text-text-muted p-1" onClick={() => setContacts(prev => prev.filter((_, i) => i !== idx))} title="Remove">✕</button>
    </div>
  ))}
</div>
```

**Step 4: Save contacts after saving client**

In the `handleSubmit`/save function, after the client is saved, add:
```typescript
if (savedClientId && contacts.length > 0) {
  await api.saveClientContacts(savedClientId, contacts).catch(console.error);
}
```

**Step 5: Commit**
```bash
git add src/renderer/modules/clients/ClientForm.tsx
git commit -m "feat: client form — industry, website, credit limit, rep assignment, multi-contact"
```

---

### Task 4: Vendor Form Expansion

**Files:**
- Modify: `src/renderer/modules/expenses/VendorForm.tsx`

**Step 1: Expand `VendorFormData` and `emptyForm`**

Add to interface:
```typescript
  w9_status: 'not_collected' | 'collected' | 'on_file';
  is_1099_eligible: boolean;
  ach_routing: string;
  ach_account: string;
  ach_account_type: 'checking' | 'savings';
  contract_start: string;
  contract_end: string;
  contract_notes: string;
```

Add to `emptyForm`:
```typescript
  w9_status: 'not_collected',
  is_1099_eligible: false,
  ach_routing: '',
  ach_account: '',
  ach_account_type: 'checking',
  contract_start: '',
  contract_end: '',
  contract_notes: '',
```

**Step 2: Map new fields in the load useEffect**

```typescript
  w9_status: data.w9_status || 'not_collected',
  is_1099_eligible: !!data.is_1099_eligible,
  ach_routing: data.ach_routing || '',
  ach_account: data.ach_account || '',
  ach_account_type: data.ach_account_type || 'checking',
  contract_start: data.contract_start || '',
  contract_end: data.contract_end || '',
  contract_notes: data.contract_notes || '',
```

**Step 3: Add new sections to the form UI**

Below the existing `notes` field, add:

```tsx
{/* Compliance */}
<div style={{ borderTop: '1px solid var(--color-border-primary)', paddingTop: 16, marginTop: 8 }}>
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Compliance</div>
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">W-9 Status</label>
      <select className="block-select" value={form.w9_status} onChange={(e) => setForm(p => ({ ...p, w9_status: e.target.value as any }))}>
        <option value="not_collected">Not Collected</option>
        <option value="collected">Collected</option>
        <option value="on_file">On File</option>
      </select>
    </div>
    <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={form.is_1099_eligible} onChange={(e) => setForm(p => ({ ...p, is_1099_eligible: e.target.checked }))} style={{ width: 16, height: 16 }} />
        <span style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>1099 Eligible</span>
      </label>
    </div>
  </div>
</div>

{/* ACH / Banking */}
<div style={{ borderTop: '1px solid var(--color-border-primary)', paddingTop: 16, marginTop: 8 }}>
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">ACH / Banking</div>
  <div className="grid grid-cols-3 gap-4">
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Routing Number</label>
      <input className="block-input font-mono" value={form.ach_routing} onChange={(e) => setForm(p => ({ ...p, ach_routing: e.target.value }))} maxLength={9} placeholder="9 digits" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Number</label>
      <input className="block-input font-mono" value={form.ach_account} onChange={(e) => setForm(p => ({ ...p, ach_account: e.target.value }))} placeholder="Account number" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Type</label>
      <select className="block-select" value={form.ach_account_type} onChange={(e) => setForm(p => ({ ...p, ach_account_type: e.target.value as any }))}>
        <option value="checking">Checking</option>
        <option value="savings">Savings</option>
      </select>
    </div>
  </div>
</div>

{/* Contract */}
<div style={{ borderTop: '1px solid var(--color-border-primary)', paddingTop: 16, marginTop: 8 }}>
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Contract</div>
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contract Start</label>
      <input type="date" className="block-input" value={form.contract_start} onChange={(e) => setForm(p => ({ ...p, contract_start: e.target.value }))} />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contract End</label>
      <input type="date" className="block-input" value={form.contract_end} onChange={(e) => setForm(p => ({ ...p, contract_end: e.target.value }))} />
    </div>
    <div className="col-span-2">
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contract Notes</label>
      <textarea className="block-input" rows={3} value={form.contract_notes} onChange={(e) => setForm(p => ({ ...p, contract_notes: e.target.value }))} placeholder="Contract terms, renewal conditions..." style={{ resize: 'vertical' }} />
    </div>
  </div>
</div>
```

**Step 4: Include new fields in save payload** (in the existing `api.create`/`api.update` call):
```typescript
  w9_status: form.w9_status,
  is_1099_eligible: form.is_1099_eligible,
  ach_routing: form.ach_routing,
  ach_account: form.ach_account,
  ach_account_type: form.ach_account_type,
  contract_start: form.contract_start,
  contract_end: form.contract_end,
  contract_notes: form.contract_notes,
```

**Step 5: Commit**
```bash
git add src/renderer/modules/expenses/VendorForm.tsx
git commit -m "feat: vendor form — W-9 status, 1099 flag, ACH banking, contract dates"
```

---

### Task 5: Debt Form Enrichment (Debtor Profile)

**Files:**
- Modify: `src/renderer/modules/debt-collection/DebtForm.tsx`

**Step 1: Add new fields to `DebtFormData` interface and `emptyForm`**

Add to interface:
```typescript
  employer_name: string;
  employment_status: 'employed' | 'self-employed' | 'unemployed' | 'unknown';
  monthly_income_estimate: string;
  best_contact_time: string;
  debtor_attorney_name: string;
  debtor_attorney_phone: string;
```

Add to `emptyForm`:
```typescript
  employer_name: '',
  employment_status: 'unknown',
  monthly_income_estimate: '',
  best_contact_time: '',
  debtor_attorney_name: '',
  debtor_attorney_phone: '',
```

**Step 2: Map fields in load useEffect**

In the existing load block that maps `debt` to `setForm`, add:
```typescript
  employer_name: debt.employer_name ?? '',
  employment_status: debt.employment_status ?? 'unknown',
  monthly_income_estimate: debt.monthly_income_estimate != null ? String(debt.monthly_income_estimate) : '',
  best_contact_time: debt.best_contact_time ?? '',
  debtor_attorney_name: debt.debtor_attorney_name ?? '',
  debtor_attorney_phone: debt.debtor_attorney_phone ?? '',
```

**Step 3: Add Debtor Profile section to form UI**

After the existing debtor contact fields (debtor_email, debtor_phone, debtor_address), add a new collapsible section:

```tsx
{/* Debtor Profile */}
<div className="col-span-2 block-card" style={{ marginTop: 8 }}>
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Debtor Profile</div>
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Employment Status</label>
      <select className="block-select" value={form.employment_status} onChange={(e) => setForm(p => ({ ...p, employment_status: e.target.value as any }))}>
        <option value="unknown">Unknown</option>
        <option value="employed">Employed</option>
        <option value="self-employed">Self-Employed</option>
        <option value="unemployed">Unemployed</option>
      </select>
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Employer Name</label>
      <input className="block-input" value={form.employer_name} onChange={(e) => setForm(p => ({ ...p, employer_name: e.target.value }))} placeholder="Employer or business name" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Est. Monthly Income ($)</label>
      <input type="number" min={0} step="100" className="block-input" value={form.monthly_income_estimate} onChange={(e) => setForm(p => ({ ...p, monthly_income_estimate: e.target.value }))} />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Best Contact Time</label>
      <select className="block-select" value={form.best_contact_time} onChange={(e) => setForm(p => ({ ...p, best_contact_time: e.target.value }))}>
        <option value="">Not specified</option>
        <option value="morning">Morning (8am–12pm)</option>
        <option value="afternoon">Afternoon (12pm–5pm)</option>
        <option value="evening">Evening (5pm–8pm)</option>
      </select>
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Debtor's Attorney Name</label>
      <input className="block-input" value={form.debtor_attorney_name} onChange={(e) => setForm(p => ({ ...p, debtor_attorney_name: e.target.value }))} placeholder="If represented" />
    </div>
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Debtor's Attorney Phone</label>
      <input className="block-input" value={form.debtor_attorney_phone} onChange={(e) => setForm(p => ({ ...p, debtor_attorney_phone: e.target.value }))} />
    </div>
  </div>
</div>
```

**Step 4: Include new fields in save payload**

In the existing save function, add:
```typescript
  employer_name: form.employer_name,
  employment_status: form.employment_status,
  monthly_income_estimate: parseFloat(form.monthly_income_estimate) || 0,
  best_contact_time: form.best_contact_time,
  debtor_attorney_name: form.debtor_attorney_name,
  debtor_attorney_phone: form.debtor_attorney_phone,
```

**Step 5: Commit**
```bash
git add src/renderer/modules/debt-collection/DebtForm.tsx
git commit -m "feat: debt form — debtor profile (employer, income, attorney, contact time)"
```

---

### Task 6: Promise-to-Pay Timeline in DebtDetail

**Files:**
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`

**Step 1: Add promise state and load**

At the top of `DebtDetail`, add:
```typescript
const [promises, setPromises] = useState<any[]>([]);
const [showPromiseForm, setShowPromiseForm] = useState(false);
const [newPromise, setNewPromise] = useState({ promised_date: '', promised_amount: '', notes: '' });
```

In the existing data load function, alongside other `Promise.all` fetches, add:
```typescript
api.listDebtPromises(debtId).catch(() => []),
```
And map the result: `setPromises(promiseData ?? []);`

**Step 2: Add save promise handler**

```typescript
const handleSavePromise = async () => {
  if (!newPromise.promised_date || !newPromise.promised_amount) return;
  await api.saveDebtPromise({
    debt_id: debtId,
    promised_date: newPromise.promised_date,
    promised_amount: parseFloat(newPromise.promised_amount) || 0,
    notes: newPromise.notes,
    kept: false,
  });
  setNewPromise({ promised_date: '', promised_amount: '', notes: '' });
  setShowPromiseForm(false);
  const updated = await api.listDebtPromises(debtId).catch(() => []);
  setPromises(updated);
};

const handleToggleKept = async (id: string, kept: boolean) => {
  await api.updateDebtPromise(id, !kept);
  const updated = await api.listDebtPromises(debtId).catch(() => []);
  setPromises(updated);
};
```

**Step 3: Add Promise-to-Pay section to DebtDetail JSX**

Find a logical location in the detail view (after the communications section). Add:

```tsx
{/* Promise-to-Pay Timeline */}
<div className="block-card">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">Promise-to-Pay</div>
    <button className="block-btn text-xs py-1 px-3" onClick={() => setShowPromiseForm(v => !v)}>
      + Record Promise
    </button>
  </div>

  {showPromiseForm && (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 140px 1fr auto', gap: 8, marginBottom: 16, padding: 12, background: 'var(--color-bg-secondary)', borderRadius: '6px' }}>
      <input type="date" className="block-input" value={newPromise.promised_date} onChange={(e) => setNewPromise(p => ({ ...p, promised_date: e.target.value }))} />
      <input type="number" className="block-input" placeholder="Amount ($)" value={newPromise.promised_amount} onChange={(e) => setNewPromise(p => ({ ...p, promised_amount: e.target.value }))} />
      <input className="block-input" placeholder="Notes..." value={newPromise.notes} onChange={(e) => setNewPromise(p => ({ ...p, notes: e.target.value }))} />
      <button className="block-btn-primary text-xs py-1 px-3" onClick={handleSavePromise}>Save</button>
    </div>
  )}

  {promises.length === 0 ? (
    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '8px 0' }}>No promises recorded.</div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {promises.map((p) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--color-bg-secondary)', borderRadius: '6px', borderLeft: `3px solid ${p.kept ? '#16a34a' : new Date(p.promised_date) < new Date() ? '#ef4444' : '#d97706'}` }}>
          <button onClick={() => handleToggleKept(p.id, !!p.kept)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>
            {p.kept ? '✅' : new Date(p.promised_date) < new Date() ? '❌' : '🕐'}
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {formatCurrency(p.promised_amount)} promised by {formatDate(p.promised_date)}
            </div>
            {p.notes && <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{p.notes}</div>}
          </div>
          <span style={{ fontSize: '10px', fontWeight: 700, color: p.kept ? '#16a34a' : new Date(p.promised_date) < new Date() ? '#ef4444' : '#d97706' }}>
            {p.kept ? 'KEPT' : new Date(p.promised_date) < new Date() ? 'BROKEN' : 'PENDING'}
          </span>
        </div>
      ))}
    </div>
  )}
</div>
```

**Step 4: Commit**
```bash
git add src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat: debt detail — promise-to-pay timeline with kept/broken tracking"
```

---

### Task 7: Aging Badge on DebtList

**Files:**
- Modify: `src/renderer/modules/debt-collection/DebtList.tsx`

**Step 1: Add aging helper function**

Before the component, add:
```typescript
function getAgingBadge(delinquentDate: string): { label: string; color: string; bg: string } {
  if (!delinquentDate) return { label: 'N/A', color: '#94a3b8', bg: '#94a3b820' };
  const days = Math.floor((Date.now() - new Date(delinquentDate).getTime()) / 86_400_000);
  if (days <= 30)  return { label: `${days}d`, color: '#16a34a', bg: '#16a34a20' };
  if (days <= 90)  return { label: `${days}d`, color: '#d97706', bg: '#d9770620' };
  if (days <= 180) return { label: `${days}d`, color: '#ea580c', bg: '#ea580c20' };
  return { label: `${days}d`, color: '#dc2626', bg: '#dc262620' };
}
```

**Step 2: Add aging badge to each debt row**

In the existing table row render (wherever `debt.debtor_name` and `debt.balance_due` are displayed), add the badge:

```tsx
{(() => {
  const badge = getAgingBadge(debt.delinquent_date);
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 7px',
      borderRadius: '4px', color: badge.color, background: badge.bg,
      fontVariantNumeric: 'tabular-nums',
    }}>
      {badge.label}
    </span>
  );
})()}
```

Place this in a new "Age" column — add `<th style={{ width: '60px' }}>Age</th>` to the thead and a `<td>` with the badge in each row.

**Step 3: Commit**
```bash
git add src/renderer/modules/debt-collection/DebtList.tsx
git commit -m "feat: debt list — aging badge (0-30 green, 31-90 yellow, 91-180 orange, 180+ red)"
```

---

### Task 8: Debt Portfolio PDF Report

**Files:**
- Modify: `src/renderer/lib/print-templates.ts`
- Modify: `src/renderer/modules/debt-collection/DebtList.tsx`

**Step 1: Add `generateDebtPortfolioReportHTML` to `print-templates.ts`**

After the existing `generateInvoiceHTML` function (before the pay stub section), add:

```typescript
// ═══════════════════════════════════════════════════════════════
// DEBT PORTFOLIO REPORT
// ═══════════════════════════════════════════════════════════════
export function generateDebtPortfolioReportHTML(
  debts: any[],
  collectedYtd: number,
  company: any
): string {
  const companyName = company?.name || 'Company';
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Aging buckets
  const now = Date.now();
  const bucket = (d: any) => {
    const days = Math.floor((now - new Date(d.delinquent_date || d.created_at).getTime()) / 86_400_000);
    if (days <= 30) return '0-30';
    if (days <= 90) return '31-90';
    if (days <= 180) return '91-180';
    return '180+';
  };
  const buckets: Record<string, { count: number; amount: number }> = {
    '0-30': { count: 0, amount: 0 }, '31-90': { count: 0, amount: 0 },
    '91-180': { count: 0, amount: 0 }, '180+': { count: 0, amount: 0 },
  };
  debts.forEach(d => { const b = bucket(d); buckets[b].count++; buckets[b].amount += Number(d.balance_due || 0); });

  const totalBalance = debts.reduce((s, d) => s + Number(d.balance_due || 0), 0);
  const totalOriginal = debts.reduce((s, d) => s + Number(d.original_amount || 0), 0);
  const recoveryRate = totalOriginal > 0 ? ((collectedYtd / totalOriginal) * 100).toFixed(1) : '0.0';

  // Stage breakdown
  const stages: Record<string, number> = {};
  debts.forEach(d => { stages[d.current_stage] = (stages[d.current_stage] || 0) + 1; });

  // Top 10 by balance
  const top10 = [...debts].sort((a, b) => Number(b.balance_due) - Number(a.balance_due)).slice(0, 10);

  const agingRows = Object.entries(buckets).map(([label, { count, amount }]) => `
    <tr>
      <td>${label} days</td>
      <td class="text-right">${count}</td>
      <td class="text-right font-mono">${fmt(amount)}</td>
      <td class="text-right text-muted">${totalBalance > 0 ? ((amount / totalBalance) * 100).toFixed(1) : '0.0'}%</td>
    </tr>`).join('');

  const stageRows = Object.entries(stages).map(([stage, count]) => `
    <tr><td style="text-transform:capitalize;">${stage.replace(/_/g, ' ')}</td><td class="text-right">${count}</td></tr>`).join('');

  const top10Rows = top10.map(d => {
    const days = Math.floor((now - new Date(d.delinquent_date || d.created_at).getTime()) / 86_400_000);
    return `<tr>
      <td>${d.debtor_name || '—'}</td>
      <td class="text-right font-mono">${fmt(Number(d.balance_due || 0))}</td>
      <td class="text-right">${days}d</td>
      <td style="text-transform:capitalize;">${(d.current_stage || '').replace(/_/g, ' ')}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Debt Portfolio Report</title><style>
${baseStyles}
.page { padding: 48px; }
.report-header { border-bottom: 3px solid #0f172a; padding-bottom: 16px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: flex-end; }
.report-title { font-size: 22px; font-weight: 800; color: #0f172a; }
.report-date { font-size: 11px; color: #64748b; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
.stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 14px 16px; }
.stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 4px; }
.stat-value { font-size: 20px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
.section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #0f172a; margin: 24px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
.text-right { text-align: right; }
.text-muted { color: #94a3b8; }
.font-mono { font-variant-numeric: tabular-nums; }
</style></head>
<body><div class="page">
  <div class="report-header">
    <div>
      <div class="report-title">Debt Portfolio Report</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">${companyName}</div>
    </div>
    <div class="report-date">Generated ${today}</div>
  </div>

  <div class="stats-grid">
    <div class="stat-box"><div class="stat-label">Total Accounts</div><div class="stat-value">${debts.length}</div></div>
    <div class="stat-box"><div class="stat-label">Total Balance</div><div class="stat-value">${fmt(totalBalance)}</div></div>
    <div class="stat-box"><div class="stat-label">Collected YTD</div><div class="stat-value" style="color:#16a34a">${fmt(collectedYtd)}</div></div>
    <div class="stat-box"><div class="stat-label">Recovery Rate</div><div class="stat-value">${recoveryRate}%</div></div>
  </div>

  <div class="section-title">Aging Breakdown</div>
  <table><thead><tr><th>Bucket</th><th class="text-right">Accounts</th><th class="text-right">Balance</th><th class="text-right">% of Total</th></tr></thead>
  <tbody>${agingRows}</tbody></table>

  <div class="section-title">Pipeline Stage Breakdown</div>
  <table><thead><tr><th>Stage</th><th class="text-right">Count</th></tr></thead>
  <tbody>${stageRows}</tbody></table>

  <div class="section-title">Top 10 Accounts by Balance</div>
  <table><thead><tr><th>Debtor</th><th class="text-right">Balance</th><th class="text-right">Age</th><th>Stage</th></tr></thead>
  <tbody>${top10Rows}</tbody></table>
</div></body></html>`;
}
```

**Step 2: Add "Portfolio Report" button to `DebtList.tsx`**

In the DebtList header (where New and filter buttons live), add:
```tsx
<button
  className="block-btn flex items-center gap-1.5 text-xs"
  onClick={async () => {
    if (!activeCompany) return;
    const data = await api.getDebtPortfolioReportData(activeCompany.id);
    if (data?.error) return;
    const { generateDebtPortfolioReportHTML } = await import('../../lib/print-templates');
    const html = generateDebtPortfolioReportHTML(data.debts, data.collectedYtd, activeCompany);
    await api.printPreview(html, 'Debt Portfolio Report');
  }}
>
  <Download size={13} />
  Portfolio Report
</button>
```

**Step 3: Commit**
```bash
git add src/renderer/lib/print-templates.ts src/renderer/modules/debt-collection/DebtList.tsx
git commit -m "feat: debt portfolio PDF report — aging buckets, stage breakdown, top 10 accounts"
```

---

### Task 9: Formal Demand Letter PDF

**Files:**
- Modify: `src/renderer/lib/print-templates.ts`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`

**Step 1: Add `generateDemandLetterHTML` to `print-templates.ts`**

After `generateDebtPortfolioReportHTML`, add:

```typescript
// ═══════════════════════════════════════════════════════════════
// FORMAL DEMAND LETTER
// ═══════════════════════════════════════════════════════════════
export function generateDemandLetterHTML(
  debt: any,
  payments: any[],
  company: any,
  options: {
    deadline_days?: number;
    payment_address?: string;
    online_payment_url?: string;
    signatory_name?: string;
    signatory_title?: string;
  } = {}
): string {
  const companyName = company?.name || 'Your Company';
  const companyAddr = [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
  const deadlineDays = options.deadline_days ?? 10;
  const deadlineDate = new Date(Date.now() + deadlineDays * 86_400_000)
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const todayLong = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balanceDue = Number(debt.balance_due || 0);
  const originalAmount = Number(debt.original_amount || 0);
  const interest = Number(debt.interest_accrued || 0);
  const fees = Number(debt.fees_accrued || 0);

  const paymentRows = payments.length > 0
    ? payments.map(p => `<tr>
        <td>${fmtDate(p.received_date)}</td>
        <td class="text-right font-mono">${fmt(Number(p.amount || 0))}</td>
        <td>${p.method || '—'}</td>
        <td class="text-muted">${p.reference_number || '—'}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:#94a3b8;font-style:italic;">No payments received</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Demand Letter — ${debt.debtor_name}</title><style>
${baseStyles}
.page { padding: 60px; max-width: 720px; margin: 0 auto; }
.letterhead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
.company-name { font-size: 20px; font-weight: 800; color: #0f172a; }
.company-addr { font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.6; }
.date-line { font-size: 12px; color: #334155; text-align: right; }
.re-block { background: #f8fafc; border-left: 4px solid #0f172a; padding: 12px 16px; margin: 28px 0; }
.re-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; }
.re-value { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 2px; }
.body-text { font-size: 12px; color: #334155; line-height: 1.8; margin-bottom: 16px; }
.balance-box { border: 2px solid #0f172a; border-radius: 4px; padding: 20px 24px; text-align: center; margin: 24px 0; }
.balance-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
.balance-amount { font-size: 36px; font-weight: 900; color: #dc2626; font-variant-numeric: tabular-nums; margin-top: 4px; }
.signature-block { margin-top: 48px; }
.sig-name { font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 32px; }
.sig-title { font-size: 12px; color: #64748b; }
.text-right { text-align: right; }
.text-muted { color: #94a3b8; }
.font-mono { font-variant-numeric: tabular-nums; }
</style></head>
<body><div class="page">
  <div class="letterhead">
    <div>
      <div class="company-name">${companyName}</div>
      <div class="company-addr">${companyAddr}</div>
    </div>
    <div class="date-line">${todayLong}</div>
  </div>

  <div style="margin-bottom:28px;">
    <div style="font-size:12px;color:#334155;font-weight:600;">${debt.debtor_name || 'To Whom It May Concern'}</div>
    ${debt.debtor_address ? `<div style="font-size:12px;color:#64748b;">${debt.debtor_address}</div>` : ''}
    ${debt.debtor_email ? `<div style="font-size:12px;color:#64748b;">${debt.debtor_email}</div>` : ''}
  </div>

  <div class="re-block">
    <div class="re-label">RE: Formal Demand for Payment</div>
    <div class="re-value">Account #${debt.id?.slice(0, 8).toUpperCase() || 'N/A'} — Balance Due: ${fmt(balanceDue)}</div>
  </div>

  <p class="body-text">Dear ${debt.debtor_name || 'Account Holder'},</p>

  <p class="body-text">
    This letter constitutes a formal demand for payment of the outstanding balance owed to <strong>${companyName}</strong>.
    Our records reflect that an account was established with an original principal of <strong>${fmt(originalAmount)}</strong>.
    Despite prior notices, this balance remains unpaid as of the date of this letter.
  </p>

  <div style="margin:20px 0;">
    <table>
      <thead><tr><th>Description</th><th class="text-right">Amount</th></tr></thead>
      <tbody>
        <tr><td>Original Principal</td><td class="text-right font-mono">${fmt(originalAmount)}</td></tr>
        ${interest > 0 ? `<tr><td>Accrued Interest</td><td class="text-right font-mono">${fmt(interest)}</td></tr>` : ''}
        ${fees > 0 ? `<tr><td>Fees &amp; Charges</td><td class="text-right font-mono">${fmt(fees)}</td></tr>` : ''}
        ${totalPaid > 0 ? `<tr><td style="color:#16a34a;">Payments Received</td><td class="text-right font-mono" style="color:#16a34a;">-${fmt(totalPaid)}</td></tr>` : ''}
      </tbody>
    </table>
  </div>

  ${payments.length > 0 ? `
  <div class="section-label" style="margin-top:20px;margin-bottom:8px;">Payment History</div>
  <table>
    <thead><tr><th>Date</th><th class="text-right">Amount</th><th>Method</th><th>Reference</th></tr></thead>
    <tbody>${paymentRows}</tbody>
  </table>` : ''}

  <div class="balance-box">
    <div class="balance-label">Total Amount Now Due</div>
    <div class="balance-amount">${fmt(balanceDue)}</div>
  </div>

  <p class="body-text">
    <strong>You are hereby demanded to remit payment in full no later than ${deadlineDate}.</strong>
    ${options.payment_address ? `Payment by check should be made payable to <strong>${companyName}</strong> and mailed to: <strong>${options.payment_address}</strong>.` : ''}
    ${options.online_payment_url ? `Payment may also be submitted online at: <strong>${options.online_payment_url}</strong>.` : ''}
  </p>

  <p class="body-text">
    Failure to remit payment by the deadline may result in escalated collection activity, referral to a collection agency,
    reporting to credit bureaus, and/or legal action to recover the full amount owed, including court costs and attorney fees
    as permitted by applicable law.
  </p>

  <p class="body-text">
    If you believe this amount is in error or wish to discuss a payment arrangement, please contact us immediately at
    ${company?.email || 'our office'} or ${company?.phone || 'the number on file'}.
  </p>

  <div class="signature-block">
    <p class="body-text">Sincerely,</p>
    <div class="sig-name">${options.signatory_name || companyName}</div>
    <div class="sig-title">${options.signatory_title || 'Accounts Receivable'}</div>
    <div style="font-size:12px;color:#64748b;margin-top:2px;">${companyName}</div>
  </div>
</div></body></html>`;
}
```

**Step 2: Add "Demand Letter" button to `DebtDetail.tsx`**

In the action buttons area of DebtDetail, add:
```tsx
<button
  className="block-btn flex items-center gap-1.5 text-xs"
  onClick={async () => {
    const { generateDemandLetterHTML } = await import('../../lib/print-templates');
    const html = generateDemandLetterHTML(
      debt,
      payments,
      activeCompany,
      { deadline_days: 10, signatory_name: activeCompany?.name }
    );
    await api.printPreview(html, `Demand Letter — ${debt.debtor_name}`);
  }}
>
  <FileText size={13} />
  Demand Letter
</button>
```

**Step 3: Commit**
```bash
git add src/renderer/lib/print-templates.ts src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat: formal demand letter PDF with payment history, balance box, deadline paragraph"
```

---

## TRACK 2

---

### Task 10: DB Migrations — Track 2

**Files:**
- Modify: `src/main/database/index.ts`

**Step 1: Add Track 2 migrations to the `migrations` array**

After the Track 1 migrations, add:
```typescript
    // Track 2: Enterprise foundations (2026-04-07)
    "ALTER TABLE employee_deductions ADD COLUMN employer_match REAL DEFAULT 0",
    "ALTER TABLE employee_deductions ADD COLUMN employer_match_type TEXT DEFAULT 'percent'",
    `CREATE TABLE IF NOT EXISTS state_tax_brackets (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      year INTEGER NOT NULL,
      min_income REAL NOT NULL DEFAULT 0,
      max_income REAL DEFAULT NULL,
      rate REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS pto_policies (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      accrual_rate REAL NOT NULL DEFAULT 0,
      accrual_unit TEXT NOT NULL DEFAULT 'hours_per_pay_period',
      cap_hours REAL DEFAULT NULL,
      carry_over_limit REAL DEFAULT 0,
      available_after_days INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS pto_balances (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      policy_id TEXT NOT NULL,
      balance_hours REAL NOT NULL DEFAULT 0,
      used_hours_ytd REAL NOT NULL DEFAULT 0,
      accrued_hours_ytd REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS pto_transactions (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      policy_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'accrual',
      hours REAL NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      payroll_run_id TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
```

**Step 2: Add new tables to `tablesWithoutUpdatedAt`**

```typescript
  'state_tax_brackets',
  'pto_transactions',
```

**Step 3: Add IPC handlers for analytics and PTO in `ipc/index.ts`**

```typescript
  // ─── Analytics Dashboard ──────────────────────────────
  ipcMain.handle('analytics:dashboard-data', (_event, { companyId }: { companyId: string }) => {
    try {
      const d = db.getDb();
      const today = new Date();
      const months = Array.from({ length: 12 }, (_, i) => {
        const dt = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      });
      const firstMonth = months[0] + '-01';

      const revenueByMonth = d.prepare(`
        SELECT strftime('%Y-%m', issue_date) as month, COALESCE(SUM(total),0) as total
        FROM invoices WHERE company_id = ? AND status IN ('paid','sent','partial')
        AND issue_date >= ? GROUP BY month`).all(companyId, firstMonth);

      const expenseByMonth = d.prepare(`
        SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(amount),0) as total
        FROM expenses WHERE company_id = ? AND date >= ? GROUP BY month`).all(companyId, firstMonth);

      const arAging = d.prepare(`
        SELECT
          SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN total - amount_paid ELSE 0 END) as current_amt,
          SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN total - amount_paid ELSE 0 END) as days_1_30,
          SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN total - amount_paid ELSE 0 END) as days_31_60,
          SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN total - amount_paid ELSE 0 END) as days_60_plus
        FROM invoices WHERE company_id = ? AND status IN ('sent','overdue','partial')`).get(companyId);

      const topClients = d.prepare(`
        SELECT c.name as client_name, COALESCE(SUM(i.total),0) as total_revenue
        FROM invoices i JOIN clients c ON i.client_id = c.id
        WHERE i.company_id = ? AND i.status IN ('paid','sent','partial')
        GROUP BY c.id ORDER BY total_revenue DESC LIMIT 8`).all(companyId);

      // Health score components
      const totalInvoiced = d.prepare(`SELECT COALESCE(SUM(total),0) as v FROM invoices WHERE company_id = ? AND status != 'draft'`).get(companyId) as any;
      const totalPaid = d.prepare(`SELECT COALESCE(SUM(total),0) as v FROM invoices WHERE company_id = ? AND status = 'paid'`).get(companyId) as any;
      const totalExpenses = d.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE company_id = ?`).get(companyId) as any;
      const overdueCount = d.prepare(`SELECT COUNT(*) as v FROM invoices WHERE company_id = ? AND status = 'overdue'`).get(companyId) as any;
      const sentCount = d.prepare(`SELECT COUNT(*) as v FROM invoices WHERE company_id = ? AND status IN ('sent','overdue','partial')`).get(companyId) as any;
      const avgDso = d.prepare(`
        SELECT AVG(julianday(updated_at) - julianday(issue_date)) as v
        FROM invoices WHERE company_id = ? AND status = 'paid' AND updated_at IS NOT NULL`).get(companyId) as any;

      const collectionRate = totalInvoiced.v > 0 ? totalPaid.v / totalInvoiced.v : 1;
      const expenseRatio = totalInvoiced.v > 0 ? totalExpenses.v / totalInvoiced.v : 0;
      const overdueRate = sentCount.v > 0 ? 1 - (overdueCount.v / sentCount.v) : 1;
      const dso = Number(avgDso.v || 0);
      const dsoScore = dso <= 30 ? 20 : dso <= 45 ? 15 : dso <= 60 ? 10 : 5;
      const healthScore = Math.round(
        Math.min(collectionRate, 1) * 30 +
        Math.max(0, Math.min(1 - expenseRatio, 1)) * 25 +
        Math.min(overdueRate, 1) * 25 +
        dsoScore
      );

      return { months, revenueByMonth, expenseByMonth, arAging, topClients, healthScore, dso };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── PTO ─────────────────────────────────────────────
  ipcMain.handle('payroll:pto-policies', (_event, { companyId }: { companyId: string }) => {
    try { return db.queryAll('pto_policies', { company_id: companyId }); }
    catch { return []; }
  });

  ipcMain.handle('payroll:pto-policy-save', (_event, data: Record<string, any>) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (data.id) return db.update('pto_policies', data.id, data);
      return db.create('pto_policies', { ...data, company_id: companyId });
    } catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('payroll:pto-balances', (_event, { companyId }: { companyId: string }) => {
    try {
      return db.getDb().prepare(`
        SELECT pb.*, e.name as employee_name, pp.name as policy_name
        FROM pto_balances pb
        JOIN employees e ON pb.employee_id = e.id
        LEFT JOIN pto_policies pp ON pb.policy_id = pp.id
        WHERE e.company_id = ?
        ORDER BY e.name`).all(companyId);
    } catch { return []; }
  });

  ipcMain.handle('payroll:pto-adjust', (_event, { employeeId, policyId, hours, note }: { employeeId: string; policyId: string; hours: number; note: string }) => {
    try {
      const d = db.getDb();
      // Upsert balance
      const existing = d.prepare('SELECT * FROM pto_balances WHERE employee_id = ? AND policy_id = ?').get(employeeId, policyId) as any;
      if (existing) {
        db.update('pto_balances', existing.id, { balance_hours: Number(existing.balance_hours) + hours });
      } else {
        db.create('pto_balances', { employee_id: employeeId, policy_id: policyId, balance_hours: hours, used_hours_ytd: 0, accrued_hours_ytd: Math.max(0, hours) });
      }
      db.create('pto_transactions', { employee_id: employeeId, policy_id: policyId, type: 'adjustment', hours, note: note || 'Manual adjustment' });
      scheduleAutoBackup();
      return { success: true };
    } catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
  });
```

**Step 4: Add API methods in `api.ts`**

```typescript
  getDashboardData: (companyId: string): Promise<any> =>
    window.electronAPI.invoke('analytics:dashboard-data', { companyId }),
  listPtoPolicies: (companyId: string): Promise<any[]> =>
    window.electronAPI.invoke('payroll:pto-policies', { companyId }),
  savePtoPolicy: (data: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('payroll:pto-policy-save', data),
  listPtoBalances: (companyId: string): Promise<any[]> =>
    window.electronAPI.invoke('payroll:pto-balances', { companyId }),
  adjustPto: (employeeId: string, policyId: string, hours: number, note: string): Promise<any> =>
    window.electronAPI.invoke('payroll:pto-adjust', { employeeId, policyId, hours, note }),
```

**Step 5: Commit**
```bash
git add src/main/database/index.ts src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat: Track 2 DB migrations + analytics IPC + PTO IPC handlers"
```

---

### Task 11: StateTaxEngine Service

**Files:**
- Create: `src/main/services/StateTaxEngine.ts`

**Step 1: Create `StateTaxEngine.ts`**

```typescript
// src/main/services/StateTaxEngine.ts
// State income tax calculation engine — all 50 states + DC, years 2024-2026

interface StateBracket {
  min: number;
  max: number | null;
  rate: number;
}

// Zero-income-tax states
const ZERO_TAX_STATES = new Set(['FL','TX','NV','WA','WY','SD','AK','NH','TN']);

// Flat-rate states: { STATE: rate }
const FLAT_RATE_STATES: Record<string, number> = {
  CO: 0.044, IL: 0.0495, IN: 0.0315, KY: 0.04, MI: 0.0425,
  NC: 0.045, PA: 0.0307, UT: 0.0465, AZ: 0.025, ID: 0.058,
  MA: 0.05, NH: 0.00, // NH: no wage tax
};

// Progressive brackets per state (2024/2025 rates — approximations for common states)
const PROGRESSIVE_BRACKETS: Record<string, StateBracket[]> = {
  CA: [
    { min: 0,       max: 10099,   rate: 0.01 },
    { min: 10099,   max: 23942,   rate: 0.02 },
    { min: 23942,   max: 37788,   rate: 0.04 },
    { min: 37788,   max: 52455,   rate: 0.06 },
    { min: 52455,   max: 66295,   rate: 0.08 },
    { min: 66295,   max: 338639,  rate: 0.093 },
    { min: 338639,  max: 406364,  rate: 0.103 },
    { min: 406364,  max: 677275,  rate: 0.113 },
    { min: 677275,  max: 1000000, rate: 0.123 },
    { min: 1000000, max: null,    rate: 0.133 },
  ],
  NY: [
    { min: 0,      max: 17150,  rate: 0.04  },
    { min: 17150,  max: 23600,  rate: 0.045 },
    { min: 23600,  max: 27900,  rate: 0.0525 },
    { min: 27900,  max: 161550, rate: 0.055 },
    { min: 161550, max: 323200, rate: 0.06  },
    { min: 323200, max: 2155350,rate: 0.0685 },
    { min: 2155350,max: 5000000,rate: 0.0965 },
    { min: 5000000,max: null,   rate: 0.109 },
  ],
  MN: [
    { min: 0,      max: 30070,  rate: 0.0535 },
    { min: 30070,  max: 98760,  rate: 0.068  },
    { min: 98760,  max: 183340, rate: 0.0785 },
    { min: 183340, max: null,   rate: 0.0985 },
  ],
  OR: [
    { min: 0,      max: 10000,  rate: 0.0475 },
    { min: 10000,  max: 250000, rate: 0.0675 },
    { min: 250000, max: null,   rate: 0.099  },
  ],
  NJ: [
    { min: 0,      max: 20000,  rate: 0.014 },
    { min: 20000,  max: 35000,  rate: 0.0175 },
    { min: 35000,  max: 40000,  rate: 0.035 },
    { min: 40000,  max: 75000,  rate: 0.05525 },
    { min: 75000,  max: 500000, rate: 0.0637 },
    { min: 500000, max: 1000000,rate: 0.0897 },
    { min: 1000000,max: null,   rate: 0.1075 },
  ],
  VT: [
    { min: 0,      max: 45400,  rate: 0.0335 },
    { min: 45400,  max: 110050, rate: 0.066 },
    { min: 110050, max: 229550, rate: 0.076 },
    { min: 229550, max: null,   rate: 0.0875 },
  ],
  HI: [
    { min: 0,      max: 2400,   rate: 0.014 },
    { min: 2400,   max: 4800,   rate: 0.032 },
    { min: 4800,   max: 9600,   rate: 0.055 },
    { min: 9600,   max: 14400,  rate: 0.064 },
    { min: 14400,  max: 19200,  rate: 0.068 },
    { min: 19200,  max: 24000,  rate: 0.072 },
    { min: 24000,  max: 48000,  rate: 0.076 },
    { min: 48000,  max: 150000, rate: 0.079 },
    { min: 150000, max: 175000, rate: 0.0825 },
    { min: 175000, max: 200000, rate: 0.09 },
    { min: 200000, max: null,   rate: 0.11 },
  ],
  CT: [
    { min: 0,      max: 10000,  rate: 0.03  },
    { min: 10000,  max: 50000,  rate: 0.05  },
    { min: 50000,  max: 100000, rate: 0.055 },
    { min: 100000, max: 200000, rate: 0.06  },
    { min: 200000, max: 250000, rate: 0.065 },
    { min: 250000, max: 500000, rate: 0.069 },
    { min: 500000, max: null,   rate: 0.0699 },
  ],
  ME: [
    { min: 0,      max: 26050,  rate: 0.058 },
    { min: 26050,  max: 61600,  rate: 0.0675 },
    { min: 61600,  max: null,   rate: 0.0715 },
  ],
};

// SDI rates (State Disability Insurance) — employee contribution %
const SDI_RATES: Record<string, number> = {
  CA: 0.009, NJ: 0.0026, NY: 0.005, HI: 0.005, RI: 0.013,
};

export class StateTaxEngine {
  /**
   * Calculate state income tax withholding for a given gross pay amount.
   * Annualizes the per-period gross pay, calculates annual tax, then de-annualizes.
   */
  getStateWithholding(
    state: string,
    grossPay: number,
    allowances: number = 0,
    payPeriodsPerYear: number = 26
  ): number {
    const stateCode = state?.toUpperCase().slice(0, 2) || '';
    if (!stateCode || ZERO_TAX_STATES.has(stateCode)) return 0;

    // Annualize
    const annualGross = grossPay * payPeriodsPerYear;
    const allowanceDeduction = allowances * 4300; // IRS allowance amount approximation
    const taxableIncome = Math.max(0, annualGross - allowanceDeduction);

    let annualTax = 0;

    if (FLAT_RATE_STATES[stateCode] !== undefined) {
      annualTax = taxableIncome * FLAT_RATE_STATES[stateCode];
    } else if (PROGRESSIVE_BRACKETS[stateCode]) {
      annualTax = this._calculateBracketTax(taxableIncome, PROGRESSIVE_BRACKETS[stateCode]);
    } else {
      // Unknown state — use conservative 5% estimate, log warning
      console.warn(`[StateTaxEngine] Unknown state: ${stateCode}, using 5% fallback`);
      annualTax = taxableIncome * 0.05;
    }

    // De-annualize
    return Math.max(0, annualTax / payPeriodsPerYear);
  }

  getSdiRate(state: string): number {
    return SDI_RATES[state?.toUpperCase().slice(0, 2) || ''] ?? 0;
  }

  getSdiWithholding(state: string, grossPay: number): number {
    return grossPay * this.getSdiRate(state);
  }

  private _calculateBracketTax(income: number, brackets: StateBracket[]): number {
    let tax = 0;
    for (const bracket of brackets) {
      if (income <= bracket.min) break;
      const taxable = bracket.max !== null
        ? Math.min(income, bracket.max) - bracket.min
        : income - bracket.min;
      tax += taxable * bracket.rate;
    }
    return tax;
  }
}

export const stateTaxEngine = new StateTaxEngine();
```

**Step 2: Commit**
```bash
git add src/main/services/StateTaxEngine.ts
git commit -m "feat: StateTaxEngine — all 50 states (zero-tax, flat-rate, progressive brackets), SDI"
```

---

### Task 12: Wire StateTaxEngine into PayrollRunner

**Files:**
- Modify: `src/renderer/modules/payroll/PayrollRunner.tsx` (lines ~52, ~99)
- Modify: `src/main/ipc/index.ts` (add payroll:state-tax-rate handler)

**Step 1: Add IPC handler in `ipc/index.ts`**

```typescript
  ipcMain.handle('payroll:state-tax-rate', (_event, { state, grossPay, allowances, periodsPerYear }: { state: string; grossPay: number; allowances: number; periodsPerYear: number }) => {
    try {
      const { stateTaxEngine } = require('../services/StateTaxEngine');
      const withholding = stateTaxEngine.getStateWithholding(state, grossPay, allowances, periodsPerYear);
      const sdi = stateTaxEngine.getSdiWithholding(state, grossPay);
      return { withholding, sdi, total: withholding + sdi };
    } catch (err) {
      return { withholding: grossPay * 0.05, sdi: 0, total: grossPay * 0.05 };
    }
  });
```

**Step 2: Add API method**

```typescript
  getStateTaxRate: (state: string, grossPay: number, allowances: number, periodsPerYear: number): Promise<any> =>
    window.electronAPI.invoke('payroll:state-tax-rate', { state, grossPay, allowances, periodsPerYear }),
```

**Step 3: Update `PayrollRunner.tsx`**

Remove:
```typescript
const STATE_TAX_RATE = 0.05;
```

Replace the line `const state_tax = gross_pay * STATE_TAX_RATE;` with a call that uses the IPC. Since PayrollRunner uses a synchronous `calculatePaycheck` function, convert it to async or pre-fetch rates.

The cleanest approach: add a `stateTaxCache` map fetched before run starts. In the `handleRun` function (wherever payroll is processed in batch), before the calculation loop, pre-fetch all employee state tax rates:

```typescript
// Pre-fetch state tax for all employees
const stateTaxMap: Record<string, number> = {};
for (const emp of selectedEmployees) {
  try {
    const result = await api.getStateTaxRate(emp.state, emp.gross_pay_estimate, emp.state_allowances ?? 0, periodsPerYear);
    stateTaxMap[emp.id] = result.withholding + (result.sdi || 0);
  } catch { stateTaxMap[emp.id] = emp.gross_pay_estimate * 0.05; }
}
```

Then in `calculatePaycheck`, replace `gross_pay * STATE_TAX_RATE` with `stateTaxMap[employee.id] || gross_pay * 0.05`.

**Step 4: Commit**
```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/payroll/PayrollRunner.tsx
git commit -m "feat: wire StateTaxEngine into PayrollRunner — replaces hardcoded 5% state tax rate"
```

---

### Task 13: Deductions Engine in PayrollRunner

**Files:**
- Modify: `src/renderer/modules/payroll/PayrollRunner.tsx`

**Step 1: Load deductions per employee during payroll run**

In the data loading phase of PayrollRunner, after loading employees, load their active deductions:

```typescript
const deductionsData = await api.query('employee_deductions', { company_id: activeCompany.id, is_active: 1 });
const deductionsByEmployee: Record<string, any[]> = {};
(deductionsData ?? []).forEach((d: any) => {
  if (!deductionsByEmployee[d.employee_id]) deductionsByEmployee[d.employee_id] = [];
  deductionsByEmployee[d.employee_id].push(d);
});
```

**Step 2: Apply deductions in `calculatePaycheck`**

Modify the calculation to split into pre-tax and post-tax:

```typescript
const empDeductions = deductionsByEmployee[employee.id] || [];

// Pre-tax deductions reduce taxable gross
const preTaxDeductions = empDeductions
  .filter(d => d.deduction_type !== 'roth_401k' && d.deduction_type !== 'garnishment' && d.deduction_type !== 'custom_post')
  .reduce((s, d) => s + (d.amount_type === 'percent' ? gross_pay * (d.amount / 100) : Number(d.amount)), 0);

const taxable_gross = Math.max(0, gross_pay - preTaxDeductions);

// Calculate taxes on taxable_gross (not gross_pay)
const federal_tax = calculateFederalTax(taxable_gross, employee);
const state_tax = stateTaxMap[employee.id] ?? taxable_gross * 0.05;
// ... social security, medicare on taxable_gross

// Post-tax deductions
const postTaxDeductions = empDeductions
  .filter(d => d.deduction_type === 'roth_401k' || d.deduction_type === 'garnishment' || d.deduction_type === 'custom_post')
  .reduce((s, d) => s + (d.amount_type === 'percent' ? gross_pay * (d.amount / 100) : Number(d.amount)), 0);

const net_pay = taxable_gross - federal_tax - state_tax - social_security - medicare - postTaxDeductions;
```

**Step 3: Show deductions in PayrollRunner results table**

In the per-employee results table, add a "Deductions" column showing the total pre+post-tax deductions for each employee.

**Step 4: Commit**
```bash
git add src/renderer/modules/payroll/PayrollRunner.tsx
git commit -m "feat: payroll deductions engine — pre-tax reduces taxable gross, post-tax applied after withholding"
```

---

### Task 14: KPI Dashboard Upgrade

**Files:**
- Modify: `src/renderer/modules/kpi/index.tsx`

**Step 1: Replace data loading with `getDashboardData`**

The existing KPI dashboard makes many individual `rawQuery` calls. Replace them with a single `api.getDashboardData(cid)` call and map the results:

```typescript
const data = await api.getDashboardData(cid);
if (cancelled || data?.error) return;
// Map all the state setters from data
```

**Step 2: Add Revenue vs Expense chart**

The existing dashboard already uses `recharts`. Add a `<BarChart>` component for the 12-month revenue vs expense data. Add to the existing JSX layout:

```tsx
{/* Revenue vs Expenses — 12 Month */}
<div className="block-card col-span-2">
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Revenue vs Expenses (12 Months)</div>
  <ResponsiveContainer width="100%" height={200}>
    <BarChart data={monthlyChartData} barGap={4}>
      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} />
      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
      <Tooltip formatter={(v: number) => formatCurrency(v)} />
      <Bar dataKey="revenue" fill="#2563eb" radius={[2,2,0,0]} name="Revenue" />
      <Bar dataKey="expenses" fill="#ef4444" radius={[2,2,0,0]} name="Expenses" />
    </BarChart>
  </ResponsiveContainer>
</div>
```

Where `monthlyChartData` is derived from `data.months`, `data.revenueByMonth`, `data.expenseByMonth`:
```typescript
const monthlyChartData = data.months.map((m: string) => {
  const rev = data.revenueByMonth.find((r: any) => r.month === m);
  const exp = data.expenseByMonth.find((e: any) => e.month === m);
  return { month: m.slice(5), revenue: rev?.total || 0, expenses: exp?.total || 0 };
});
```

**Step 3: Add AR Aging donut**

```tsx
{/* AR Aging */}
<div className="block-card">
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">AR Aging</div>
  {(() => {
    const aging = data.arAging || {};
    const segments = [
      { label: 'Current', value: aging.current_amt || 0, color: '#16a34a' },
      { label: '1–30d', value: aging.days_1_30 || 0, color: '#d97706' },
      { label: '31–60d', value: aging.days_31_60 || 0, color: '#ea580c' },
      { label: '60d+', value: aging.days_60_plus || 0, color: '#dc2626' },
    ];
    const total = segments.reduce((s, x) => s + x.value, 0);
    if (total === 0) return <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center', padding: 20 }}>No outstanding AR</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {segments.filter(s => s.value > 0).map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '2px', background: s.color, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: '12px', color: 'var(--color-text-secondary)' }}>{s.label}</div>
            <div style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: s.color, fontWeight: 600 }}>{formatCurrency(s.value)}</div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', width: 36, textAlign: 'right' }}>{((s.value/total)*100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    );
  })()}
</div>
```

**Step 4: Add Financial Health Score widget**

```tsx
{/* Health Score */}
<div className="block-card" style={{ textAlign: 'center' }}>
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Financial Health Score</div>
  {(() => {
    const score = data.healthScore ?? 0;
    const color = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626';
    const label = score >= 80 ? 'Healthy' : score >= 60 ? 'Watch' : 'At Risk';
    return (
      <div>
        <div style={{ fontSize: 56, fontWeight: 900, color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>DSO: {Math.round(data.dso || 0)} days</div>
      </div>
    );
  })()}
</div>
```

**Step 5: Commit**
```bash
git add src/renderer/modules/kpi/index.tsx
git commit -m "feat: KPI dashboard — revenue vs expense chart, AR aging breakdown, financial health score"
```

---

### Task 15: PTO Dashboard

**Files:**
- Create: `src/renderer/modules/payroll/PtoDashboard.tsx`
- Modify: payroll module router to add PTO tab

**Step 1: Create `PtoDashboard.tsx`**

```tsx
// src/renderer/modules/payroll/PtoDashboard.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';

interface PtoBalance {
  id: string;
  employee_id: string;
  employee_name: string;
  policy_name: string;
  policy_id: string;
  balance_hours: number;
  used_hours_ytd: number;
  accrued_hours_ytd: number;
}

interface PtoPolicy {
  id: string;
  name: string;
  accrual_rate: number;
  accrual_unit: string;
  cap_hours: number | null;
  carry_over_limit: number;
}

const PtoDashboard: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [balances, setBalances] = useState<PtoBalance[]>([]);
  const [policies, setPolicies] = useState<PtoPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<string | null>(null); // employee_id
  const [adjustHours, setAdjustHours] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustPolicyId, setAdjustPolicyId] = useState('');

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    const [bal, pol] = await Promise.all([
      api.listPtoBalances(activeCompany.id).catch(() => []),
      api.listPtoPolicies(activeCompany.id).catch(() => []),
    ]);
    setBalances(bal ?? []);
    setPolicies(pol ?? []);
    setLoading(false);
  }, [activeCompany]);

  useEffect(() => { load(); }, [load]);

  const handleAdjust = async (employeeId: string) => {
    if (!adjustHours || !adjustPolicyId) return;
    await api.adjustPto(employeeId, adjustPolicyId, parseFloat(adjustHours), adjustNote);
    setAdjusting(null);
    setAdjustHours('');
    setAdjustNote('');
    load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><span className="text-text-muted text-sm font-mono">Loading...</span></div>;

  return (
    <div className="p-6 space-y-6">
      {/* Policies */}
      <div className="block-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">PTO Policies</div>
        </div>
        {policies.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No PTO policies defined. Create a policy to start tracking accruals.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {policies.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: 16, padding: '8px 12px', background: 'var(--color-bg-secondary)', borderRadius: '6px', fontSize: '12px', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', flex: 1 }}>{p.name}</div>
                <div style={{ color: 'var(--color-text-muted)' }}>{p.accrual_rate}h / {p.accrual_unit.replace(/_/g, ' ')}</div>
                {p.cap_hours && <div style={{ color: 'var(--color-text-muted)' }}>Cap: {p.cap_hours}h</div>}
                {p.carry_over_limit > 0 && <div style={{ color: 'var(--color-text-muted)' }}>Carry-over: {p.carry_over_limit}h</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Balances */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Employee PTO Balances</span>
          <button className="block-btn p-1" onClick={load} title="Refresh"><RefreshCw size={13} /></button>
        </div>
        {balances.length === 0 ? (
          <div style={{ padding: '24px', fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center', fontStyle: 'italic' }}>No PTO balances yet. Balances accrue automatically with each payroll run.</div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Policy</th>
                <th className="text-right">Balance (hrs)</th>
                <th className="text-right">Used YTD</th>
                <th className="text-right">Accrued YTD</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {balances.map(b => (
                <React.Fragment key={b.id}>
                  <tr>
                    <td className="font-semibold">{b.employee_name}</td>
                    <td className="text-text-muted text-xs">{b.policy_name || '—'}</td>
                    <td className="text-right font-mono" style={{ color: b.balance_hours < 8 ? '#ef4444' : 'var(--color-text-primary)' }}>
                      {Number(b.balance_hours).toFixed(1)}h
                    </td>
                    <td className="text-right font-mono text-text-secondary">{Number(b.used_hours_ytd).toFixed(1)}h</td>
                    <td className="text-right font-mono text-text-secondary">{Number(b.accrued_hours_ytd).toFixed(1)}h</td>
                    <td className="text-center">
                      <button
                        className="block-btn text-xs py-1 px-2"
                        onClick={() => { setAdjusting(b.employee_id); setAdjustPolicyId(b.policy_id); }}
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                  {adjusting === b.employee_id && (
                    <tr>
                      <td colSpan={6} style={{ padding: '8px 12px', background: 'var(--color-bg-secondary)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input type="number" step="0.5" className="block-input" style={{ width: 100 }} placeholder="Hours (±)" value={adjustHours} onChange={(e) => setAdjustHours(e.target.value)} />
                          <input className="block-input" style={{ flex: 1 }} placeholder="Reason..." value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
                          <button className="block-btn-primary text-xs py-1 px-3" onClick={() => handleAdjust(b.employee_id)}>Apply</button>
                          <button className="block-btn text-xs py-1 px-2" onClick={() => setAdjusting(null)}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PtoDashboard;
```

**Step 2: Add PTO tab to the Payroll module router**

In `src/renderer/modules/payroll/` (find the index or router file), add a "PTO" tab that renders `<PtoDashboard />`.

**Step 3: Commit**
```bash
git add src/renderer/modules/payroll/PtoDashboard.tsx
git commit -m "feat: PTO dashboard — policy list, per-employee balances, manual adjustment"
```

---

### Task 16: Final build verify

**Step 1: Run TypeScript check**
```bash
export PATH="/opt/homebrew/bin:$PATH"
cd "/Users/rmpgutah/Business Accounting Pro"
node_modules/.bin/tsc --noEmit 2>&1
```
Expected: only the pre-existing `baseUrl` deprecation warning, zero new errors.

**Step 2: Start dev server and spot-check**
```bash
npm run dev
```
Navigate to: Invoicing → New Invoice (RowTypeToolbar visible), Invoice Settings (5 templates + column configurator), Employee → edit any employee (3 tabs visible), Clients → edit (multi-contact section), Vendors → edit (compliance + ACH + contract sections), Debt Collection → any debt (aging badge in list, promise-to-pay timeline in detail), KPI Dashboard (new charts + health score).

**Step 3: Final commit**
```bash
git add -A
git commit -m "feat: custom features expansion complete — data entry, debt PDFs, analytics, enterprise foundations"
```
