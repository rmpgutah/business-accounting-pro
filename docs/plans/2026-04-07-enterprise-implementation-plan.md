# Enterprise Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Elevate Business Accounting Pro to enterprise grade across Payroll, State Taxes, Debt Collections, and a global platform customization layer.

**Architecture:** Depth-first module completion (B) with shared platform infrastructure (A). Phase 1 builds the StateTaxEngine and DeductionsEngine used by all subsequent phases. Each phase ends with a full build + asar repack + codesign deploy.

**Tech Stack:** Electron 41, React 19, TypeScript, SQLite (better-sqlite3), Tailwind CSS, Vite, Lucide icons, Recharts (already installed for analytics).

**No test runner** — verification is always: `npm run build && node_modules/.bin/asar extract "/Applications/Business Accounting Pro.app/Contents/Resources/app.asar" /tmp/bap-asar && cp -R dist/. /tmp/bap-asar/dist/ && node_modules/.bin/asar pack /tmp/bap-asar "/Applications/Business Accounting Pro.app/Contents/Resources/app.asar" --unpack-dir "node_modules/better-sqlite3" && bash scripts/codesign-mac.sh "/Applications/Business Accounting Pro.app" && rm -rf /tmp/bap-asar`

**Key patterns:**
- Migrations → `src/main/database/index.ts` `migrations[]` array
- Child/junction tables (no company_id) → add to `tablesWithoutCompanyId` Set in `src/main/ipc/index.ts:400`
- Tables without updated_at → add to `tablesWithoutUpdatedAt` Set in `src/main/database/index.ts`
- IPC handlers → `src/main/ipc/index.ts`
- API methods → `src/renderer/lib/api.ts` (before the closing `on:` method)
- Module components → `src/renderer/modules/<module>/`
- Shared types → `src/shared/types.ts`

---

# PHASE 1: Enterprise Payroll

---

### Task 1: DB Migrations — Employee Fields + State Tax Brackets + PTO Tables

**Files:**
- Modify: `src/main/database/index.ts` (migrations array, tablesWithoutUpdatedAt)
- Modify: `src/main/ipc/index.ts` (tablesWithoutCompanyId)

**Step 1: Add migrations to `src/main/database/index.ts`**

Inside the `migrations` array (after the last existing entry, before the closing `]`), add:

```typescript
// ─── Enterprise Payroll (2026-04-07) ─────────────────────────────────────
// Employee profile fields
"ALTER TABLE employees ADD COLUMN department TEXT DEFAULT ''",
"ALTER TABLE employees ADD COLUMN job_title TEXT DEFAULT ''",
"ALTER TABLE employees ADD COLUMN cost_center_id TEXT DEFAULT NULL",
"ALTER TABLE employees ADD COLUMN routing_number TEXT DEFAULT ''",
"ALTER TABLE employees ADD COLUMN account_number TEXT DEFAULT ''",
"ALTER TABLE employees ADD COLUMN account_type TEXT DEFAULT 'checking'",
"ALTER TABLE employees ADD COLUMN emergency_contact_name TEXT DEFAULT ''",
"ALTER TABLE employees ADD COLUMN emergency_contact_phone TEXT DEFAULT ''",
// State tax brackets (progressive states)
`CREATE TABLE IF NOT EXISTS state_tax_brackets (
  id TEXT PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  state_code TEXT NOT NULL,
  filing_status TEXT NOT NULL DEFAULT 'single',
  bracket_min REAL NOT NULL,
  bracket_max REAL,
  rate REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tax_year, state_code, filing_status, bracket_min)
)`,
// PTO policies
`CREATE TABLE IF NOT EXISTS pto_policies (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  accrual_rate REAL NOT NULL DEFAULT 0,
  accrual_period TEXT NOT NULL DEFAULT 'pay_period' CHECK(accrual_period IN ('pay_period','monthly','annual')),
  max_balance REAL,
  carryover_limit REAL,
  available_after_days INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
// PTO balances per employee
`CREATE TABLE IF NOT EXISTS pto_balances (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  policy_id TEXT NOT NULL REFERENCES pto_policies(id),
  balance REAL NOT NULL DEFAULT 0,
  accrued_ytd REAL NOT NULL DEFAULT 0,
  used_ytd REAL NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, policy_id)
)`,
// PTO transactions (accruals, usage, adjustments)
`CREATE TABLE IF NOT EXISTS pto_transactions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  policy_id TEXT NOT NULL REFERENCES pto_policies(id),
  type TEXT NOT NULL CHECK(type IN ('accrual','usage','adjustment','payout')),
  hours REAL NOT NULL,
  note TEXT DEFAULT '',
  payroll_run_id TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`,
// Debt collection enterprise (Phase 3 — add now to avoid repeated migrations)
"ALTER TABLE debts ADD COLUMN assigned_collector_id TEXT DEFAULT NULL",
"ALTER TABLE debts ADD COLUMN risk_score INTEGER DEFAULT NULL",
`CREATE TABLE IF NOT EXISTS debt_settlements (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  offered_by TEXT NOT NULL CHECK(offered_by IN ('us','debtor')),
  offer_type TEXT NOT NULL CHECK(offer_type IN ('lump_sum','percentage')),
  offer_amount REAL NOT NULL,
  offer_percentage REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','countered','expired')),
  counter_amount REAL,
  notes TEXT DEFAULT '',
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS debt_payment_plans (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  installment_amount REAL NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('weekly','biweekly','monthly')),
  start_date TEXT NOT NULL,
  total_installments INTEGER NOT NULL,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','breached','cancelled')),
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS debt_plan_installments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES debt_payment_plans(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','partial','missed')),
  paid_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS debt_costs (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('legal_fees','court_filing','agency_commission','skip_trace','postage','other')),
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  vendor TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
// Custom fields (Platform Layer)
`CREATE TABLE IF NOT EXISTS custom_field_defs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('client','employee','invoice','debt','expense','vendor')),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK(field_type IN ('text','number','date','dropdown','checkbox','multiselect','url')),
  options TEXT DEFAULT '[]',
  is_required INTEGER DEFAULT 0,
  placeholder TEXT DEFAULT '',
  display_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, entity_type, field_key)
)`,
`CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT REFERENCES users(id),
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  is_shared INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
```

**Step 2: Add new tables to `tablesWithoutCompanyId` in `src/main/ipc/index.ts`**

Find the `tablesWithoutCompanyId` Set and add:
```typescript
'state_tax_brackets', 'pto_balances', 'pto_transactions',
'debt_settlements', 'debt_plan_installments', 'debt_costs',
'custom_field_defs', 'saved_views',
```

**Step 3: Add new tables to `tablesWithoutUpdatedAt` in `src/main/database/index.ts`**

Find the `tablesWithoutUpdatedAt` Set and add:
```typescript
'state_tax_brackets', 'pto_transactions', 'debt_plan_installments', 'debt_costs', 'custom_field_defs',
```

**Step 4: Build and verify migrations run**
```bash
cd "/Users/rmpgutah/Business Accounting Pro" && npm run build 2>&1 | tail -5
```
Expected: `✓ built` with no TypeScript errors.

**Step 5: Commit**
```bash
git add src/main/database/index.ts src/main/ipc/index.ts
git commit -m "feat: enterprise DB migrations — state tax brackets, PTO tables, debt enterprise, custom fields"
```

---

### Task 2: State Tax Engine Service

**Files:**
- Create: `src/main/services/StateTaxEngine.ts`

**Step 1: Create `src/main/services/` directory and engine file**

```typescript
// src/main/services/StateTaxEngine.ts
/**
 * StateTaxEngine — single source of truth for state income tax rates.
 * Used by PayrollRunner, Tax module, W-2 generation.
 */

export interface StateRate {
  state_code: string;
  state_name: string;
  rate: number;       // flat rate (or max rate for progressive)
  flat_rate: boolean; // true = flat, false = progressive brackets
  no_tax: boolean;    // true = no income tax state
  sui_rate: number;   // state unemployment insurance (employer)
  sui_wage_base: number;
  sdi_rate: number;   // state disability insurance (employee)
}

// All 50 states + DC — 2025 rates
export const STATE_RATES_2025: Record<string, StateRate> = {
  AL: { state_code: 'AL', state_name: 'Alabama', rate: 0.05, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 8000, sdi_rate: 0 },
  AK: { state_code: 'AK', state_name: 'Alaska', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.022, sui_wage_base: 49700, sdi_rate: 0 },
  AZ: { state_code: 'AZ', state_name: 'Arizona', rate: 0.025, flat_rate: true, no_tax: false, sui_rate: 0.02, sui_wage_base: 8000, sdi_rate: 0 },
  AR: { state_code: 'AR', state_name: 'Arkansas', rate: 0.044, flat_rate: false, no_tax: false, sui_rate: 0.026, sui_wage_base: 7000, sdi_rate: 0 },
  CA: { state_code: 'CA', state_name: 'California', rate: 0.133, flat_rate: false, no_tax: false, sui_rate: 0.034, sui_wage_base: 7000, sdi_rate: 0.009 },
  CO: { state_code: 'CO', state_name: 'Colorado', rate: 0.044, flat_rate: true, no_tax: false, sui_rate: 0.017, sui_wage_base: 23800, sdi_rate: 0 },
  CT: { state_code: 'CT', state_name: 'Connecticut', rate: 0.0699, flat_rate: false, no_tax: false, sui_rate: 0.019, sui_wage_base: 25000, sdi_rate: 0 },
  DE: { state_code: 'DE', state_name: 'Delaware', rate: 0.066, flat_rate: false, no_tax: false, sui_rate: 0.018, sui_wage_base: 14500, sdi_rate: 0 },
  FL: { state_code: 'FL', state_name: 'Florida', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.027, sui_wage_base: 7000, sdi_rate: 0 },
  GA: { state_code: 'GA', state_name: 'Georgia', rate: 0.055, flat_rate: true, no_tax: false, sui_rate: 0.027, sui_wage_base: 9500, sdi_rate: 0 },
  HI: { state_code: 'HI', state_name: 'Hawaii', rate: 0.11, flat_rate: false, no_tax: false, sui_rate: 0.024, sui_wage_base: 56700, sdi_rate: 0.005 },
  ID: { state_code: 'ID', state_name: 'Idaho', rate: 0.058, flat_rate: true, no_tax: false, sui_rate: 0.01, sui_wage_base: 53500, sdi_rate: 0 },
  IL: { state_code: 'IL', state_name: 'Illinois', rate: 0.0495, flat_rate: true, no_tax: false, sui_rate: 0.0275, sui_wage_base: 13271, sdi_rate: 0 },
  IN: { state_code: 'IN', state_name: 'Indiana', rate: 0.0305, flat_rate: true, no_tax: false, sui_rate: 0.025, sui_wage_base: 9500, sdi_rate: 0 },
  IA: { state_code: 'IA', state_name: 'Iowa', rate: 0.057, flat_rate: false, no_tax: false, sui_rate: 0.01, sui_wage_base: 38200, sdi_rate: 0 },
  KS: { state_code: 'KS', state_name: 'Kansas', rate: 0.057, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 14000, sdi_rate: 0 },
  KY: { state_code: 'KY', state_name: 'Kentucky', rate: 0.04, flat_rate: true, no_tax: false, sui_rate: 0.027, sui_wage_base: 11400, sdi_rate: 0 },
  LA: { state_code: 'LA', state_name: 'Louisiana', rate: 0.06, flat_rate: false, no_tax: false, sui_rate: 0.0295, sui_wage_base: 7700, sdi_rate: 0 },
  ME: { state_code: 'ME', state_name: 'Maine', rate: 0.0715, flat_rate: false, no_tax: false, sui_rate: 0.022, sui_wage_base: 12000, sdi_rate: 0 },
  MD: { state_code: 'MD', state_name: 'Maryland', rate: 0.0575, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 8500, sdi_rate: 0 },
  MA: { state_code: 'MA', state_name: 'Massachusetts', rate: 0.05, flat_rate: true, no_tax: false, sui_rate: 0.029, sui_wage_base: 15000, sdi_rate: 0 },
  MI: { state_code: 'MI', state_name: 'Michigan', rate: 0.0425, flat_rate: true, no_tax: false, sui_rate: 0.027, sui_wage_base: 9500, sdi_rate: 0 },
  MN: { state_code: 'MN', state_name: 'Minnesota', rate: 0.0985, flat_rate: false, no_tax: false, sui_rate: 0.034, sui_wage_base: 42000, sdi_rate: 0 },
  MS: { state_code: 'MS', state_name: 'Mississippi', rate: 0.047, flat_rate: false, no_tax: false, sui_rate: 0.025, sui_wage_base: 14000, sdi_rate: 0 },
  MO: { state_code: 'MO', state_name: 'Missouri', rate: 0.048, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 10000, sdi_rate: 0 },
  MT: { state_code: 'MT', state_name: 'Montana', rate: 0.059, flat_rate: false, no_tax: false, sui_rate: 0.01, sui_wage_base: 43300, sdi_rate: 0 },
  NE: { state_code: 'NE', state_name: 'Nebraska', rate: 0.0664, flat_rate: false, no_tax: false, sui_rate: 0.019, sui_wage_base: 9000, sdi_rate: 0 },
  NV: { state_code: 'NV', state_name: 'Nevada', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.027, sui_wage_base: 40100, sdi_rate: 0 },
  NH: { state_code: 'NH', state_name: 'New Hampshire', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.027, sui_wage_base: 14000, sdi_rate: 0 },
  NJ: { state_code: 'NJ', state_name: 'New Jersey', rate: 0.1075, flat_rate: false, no_tax: false, sui_rate: 0.034, sui_wage_base: 42300, sdi_rate: 0.009 },
  NM: { state_code: 'NM', state_name: 'New Mexico', rate: 0.059, flat_rate: false, no_tax: false, sui_rate: 0.02, sui_wage_base: 31700, sdi_rate: 0 },
  NY: { state_code: 'NY', state_name: 'New York', rate: 0.109, flat_rate: false, no_tax: false, sui_rate: 0.034, sui_wage_base: 12800, sdi_rate: 0.005 },
  NC: { state_code: 'NC', state_name: 'North Carolina', rate: 0.045, flat_rate: true, no_tax: false, sui_rate: 0.01, sui_wage_base: 31400, sdi_rate: 0 },
  ND: { state_code: 'ND', state_name: 'North Dakota', rate: 0.025, flat_rate: false, no_tax: false, sui_rate: 0.009, sui_wage_base: 42000, sdi_rate: 0 },
  OH: { state_code: 'OH', state_name: 'Ohio', rate: 0.035, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 9000, sdi_rate: 0 },
  OK: { state_code: 'OK', state_name: 'Oklahoma', rate: 0.0475, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 25700, sdi_rate: 0 },
  OR: { state_code: 'OR', state_name: 'Oregon', rate: 0.099, flat_rate: false, no_tax: false, sui_rate: 0.026, sui_wage_base: 52800, sdi_rate: 0 },
  PA: { state_code: 'PA', state_name: 'Pennsylvania', rate: 0.0307, flat_rate: true, no_tax: false, sui_rate: 0.027, sui_wage_base: 10000, sdi_rate: 0 },
  RI: { state_code: 'RI', state_name: 'Rhode Island', rate: 0.0599, flat_rate: false, no_tax: false, sui_rate: 0.039, sui_wage_base: 29200, sdi_rate: 0.013 },
  SC: { state_code: 'SC', state_name: 'South Carolina', rate: 0.064, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 14000, sdi_rate: 0 },
  SD: { state_code: 'SD', state_name: 'South Dakota', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.012, sui_wage_base: 15000, sdi_rate: 0 },
  TN: { state_code: 'TN', state_name: 'Tennessee', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.027, sui_wage_base: 7000, sdi_rate: 0 },
  TX: { state_code: 'TX', state_name: 'Texas', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.027, sui_wage_base: 9000, sdi_rate: 0 },
  UT: { state_code: 'UT', state_name: 'Utah', rate: 0.0465, flat_rate: true, no_tax: false, sui_rate: 0.018, sui_wage_base: 47000, sdi_rate: 0 },
  VT: { state_code: 'VT', state_name: 'Vermont', rate: 0.0875, flat_rate: false, no_tax: false, sui_rate: 0.017, sui_wage_base: 14300, sdi_rate: 0 },
  VA: { state_code: 'VA', state_name: 'Virginia', rate: 0.0575, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 8000, sdi_rate: 0 },
  WA: { state_code: 'WA', state_name: 'Washington', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.01, sui_wage_base: 68500, sdi_rate: 0 },
  WV: { state_code: 'WV', state_name: 'West Virginia', rate: 0.065, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 9000, sdi_rate: 0 },
  WI: { state_code: 'WI', state_name: 'Wisconsin', rate: 0.0765, flat_rate: false, no_tax: false, sui_rate: 0.0265, sui_wage_base: 14000, sdi_rate: 0 },
  WY: { state_code: 'WY', state_name: 'Wyoming', rate: 0, flat_rate: true, no_tax: true, sui_rate: 0.027, sui_wage_base: 30900, sdi_rate: 0 },
  DC: { state_code: 'DC', state_name: 'District of Columbia', rate: 0.1075, flat_rate: false, no_tax: false, sui_rate: 0.027, sui_wage_base: 9000, sdi_rate: 0 },
};

// Progressive bracket data for 9 states — 2025 rates (single filer)
export const PROGRESSIVE_BRACKETS_2025: Record<string, Array<{min: number; max: number | null; rate: number}>> = {
  CA: [
    { min: 0, max: 10099, rate: 0.01 }, { min: 10099, max: 23942, rate: 0.02 },
    { min: 23942, max: 37788, rate: 0.04 }, { min: 37788, max: 52455, rate: 0.06 },
    { min: 52455, max: 66295, rate: 0.08 }, { min: 66295, max: 338639, rate: 0.093 },
    { min: 338639, max: 406364, rate: 0.103 }, { min: 406364, max: 677275, rate: 0.113 },
    { min: 677275, max: null, rate: 0.133 },
  ],
  NY: [
    { min: 0, max: 17150, rate: 0.04 }, { min: 17150, max: 23600, rate: 0.045 },
    { min: 23600, max: 27900, rate: 0.0525 }, { min: 27900, max: 161550, rate: 0.0585 },
    { min: 161550, max: 323200, rate: 0.0625 }, { min: 323200, max: 2155350, rate: 0.0685 },
    { min: 2155350, max: 5000000, rate: 0.0965 }, { min: 5000000, max: 25000000, rate: 0.103 },
    { min: 25000000, max: null, rate: 0.109 },
  ],
  MN: [
    { min: 0, max: 31690, rate: 0.0535 }, { min: 31690, max: 104090, rate: 0.068 },
    { min: 104090, max: 193240, rate: 0.0785 }, { min: 193240, max: null, rate: 0.0985 },
  ],
  OR: [
    { min: 0, max: 4050, rate: 0.0475 }, { min: 4050, max: 10200, rate: 0.0675 },
    { min: 10200, max: 125000, rate: 0.0875 }, { min: 125000, max: null, rate: 0.099 },
  ],
  NJ: [
    { min: 0, max: 20000, rate: 0.014 }, { min: 20000, max: 35000, rate: 0.0175 },
    { min: 35000, max: 40000, rate: 0.035 }, { min: 40000, max: 75000, rate: 0.05525 },
    { min: 75000, max: 500000, rate: 0.0637 }, { min: 500000, max: 1000000, rate: 0.0897 },
    { min: 1000000, max: null, rate: 0.1075 },
  ],
  VT: [
    { min: 0, max: 45400, rate: 0.0335 }, { min: 45400, max: 110050, rate: 0.066 },
    { min: 110050, max: 229550, rate: 0.076 }, { min: 229550, max: null, rate: 0.0875 },
  ],
  HI: [
    { min: 0, max: 2400, rate: 0.014 }, { min: 2400, max: 4800, rate: 0.032 },
    { min: 4800, max: 9600, rate: 0.055 }, { min: 9600, max: 14400, rate: 0.064 },
    { min: 14400, max: 19200, rate: 0.068 }, { min: 19200, max: 24000, rate: 0.072 },
    { min: 24000, max: 36000, rate: 0.076 }, { min: 36000, max: 48000, rate: 0.079 },
    { min: 48000, max: 150000, rate: 0.0825 }, { min: 150000, max: 175000, rate: 0.09 },
    { min: 175000, max: 200000, rate: 0.1 }, { min: 200000, max: null, rate: 0.11 },
  ],
  ME: [
    { min: 0, max: 26050, rate: 0.058 }, { min: 26050, max: 61600, rate: 0.0675 },
    { min: 61600, max: null, rate: 0.0715 },
  ],
  CT: [
    { min: 0, max: 10000, rate: 0.02 }, { min: 10000, max: 50000, rate: 0.045 },
    { min: 50000, max: 100000, rate: 0.055 }, { min: 100000, max: 200000, rate: 0.06 },
    { min: 200000, max: 250000, rate: 0.065 }, { min: 250000, max: 500000, rate: 0.069 },
    { min: 500000, max: null, rate: 0.0699 },
  ],
};

/**
 * Calculate state income tax withholding for a pay period.
 * grossPay = gross pay for this period (annualized internally)
 * annualizedGross = ytd gross + this period gross
 * allowances = state withholding allowances from employee record
 */
export function calculateStateTax(
  stateCode: string,
  grossPay: number,
  annualizedGross: number,
  allowances: number = 0,
  payPeriods: number = 26
): number {
  const stateUpper = stateCode.toUpperCase();
  const stateData = STATE_RATES_2025[stateUpper];

  if (!stateData || stateData.no_tax) return 0;

  // Allowance reduction (assume $4,300 per allowance annualized, same as federal standard)
  const allowanceReduction = allowances * (4300 / payPeriods);
  const taxableGross = Math.max(0, grossPay - allowanceReduction);

  if (stateData.flat_rate) {
    return taxableGross * stateData.rate;
  }

  // Progressive bracket calculation
  const brackets = PROGRESSIVE_BRACKETS_2025[stateUpper];
  if (!brackets) {
    // Fallback to flat top rate for progressive states without bracket data
    return taxableGross * stateData.rate;
  }

  // Annualize, apply brackets, then de-annualize
  const annualTaxable = taxableGross * payPeriods;
  let annualTax = 0;
  for (const bracket of brackets) {
    if (annualTaxable <= bracket.min) break;
    const taxableInBracket = Math.min(annualTaxable, bracket.max ?? Infinity) - bracket.min;
    annualTax += taxableInBracket * bracket.rate;
  }
  return annualTax / payPeriods;
}

export function getStateData(stateCode: string): StateRate | null {
  return STATE_RATES_2025[stateCode.toUpperCase()] ?? null;
}

export function getAllStates(): StateRate[] {
  return Object.values(STATE_RATES_2025).sort((a, b) => a.state_name.localeCompare(b.state_name));
}
```

**Step 2: Build to verify TypeScript compiles**
```bash
cd "/Users/rmpgutah/Business Accounting Pro" && npm run build 2>&1 | grep -E "error|warning|✓"
```
Expected: `✓ built` with no errors.

**Step 3: Commit**
```bash
git add src/main/services/StateTaxEngine.ts
git commit -m "feat: StateTaxEngine — all 50 states + DC, progressive brackets for 9 states, SUI/SDI rates"
```

---

### Task 3: Wire StateTaxEngine into PayrollRunner

**Files:**
- Modify: `src/renderer/modules/payroll/PayrollRunner.tsx`

**Step 1: Replace hardcoded STATE_TAX_RATE**

At the top of `PayrollRunner.tsx`, find and remove:
```typescript
const STATE_TAX_RATE = 0.05;
```

Find the `calculatePayroll` function (or wherever `state_tax` is calculated) and replace the hardcoded calculation:
```typescript
// OLD:
const state_tax = gross_pay * STATE_TAX_RATE;

// NEW — call IPC to get state-specific rate:
const state_tax = await api.calculateStateTax({
  stateCode: employee.state || '',
  grossPay: gross_pay,
  annualizedGross: ytdGross + gross_pay,
  allowances: employee.state_allowances || 0,
  payPeriods: PAY_PERIODS[employee.pay_schedule || 'biweekly'],
});
```

**Step 2: Add PAY_PERIODS map near top of PayrollRunner**
```typescript
const PAY_PERIODS: Record<string, number> = {
  weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12,
};
```

**Step 3: Add `calculateStateTax` IPC handler to `src/main/ipc/index.ts`**

Find the tax handlers section and add:
```typescript
ipcMain.handle('payroll:calculate-state-tax', (_event, {
  stateCode, grossPay, annualizedGross, allowances, payPeriods
}: { stateCode: string; grossPay: number; annualizedGross: number; allowances: number; payPeriods: number }) => {
  const { calculateStateTax } = require('./services/StateTaxEngine');
  return calculateStateTax(stateCode, grossPay, annualizedGross, allowances, payPeriods);
});
```

Wait — since this is Electron main process and StateTaxEngine is at `src/main/services/`, the import path from `src/main/ipc/index.ts` is `../services/StateTaxEngine`. Use proper import at top of ipc/index.ts:
```typescript
import { calculateStateTax, getAllStates, getStateData } from '../services/StateTaxEngine';
```

Then the handler becomes:
```typescript
ipcMain.handle('payroll:calculate-state-tax', (_event, {
  stateCode, grossPay, annualizedGross, allowances, payPeriods
}: { stateCode: string; grossPay: number; annualizedGross: number; allowances: number; payPeriods: number }) => {
  return calculateStateTax(stateCode, grossPay, annualizedGross, allowances, payPeriods);
});

ipcMain.handle('payroll:state-data', (_event, stateCode: string) => {
  return getStateData(stateCode);
});

ipcMain.handle('payroll:all-states', () => {
  return getAllStates();
});
```

**Step 4: Add API methods to `src/renderer/lib/api.ts`**

Before the closing `on:` line:
```typescript
// ─── State Tax Engine ──────────────────────────────
calculateStateTax: (params: { stateCode: string; grossPay: number; annualizedGross: number; allowances: number; payPeriods: number }): Promise<number> =>
  window.electronAPI.invoke('payroll:calculate-state-tax', params),
getStateData: (stateCode: string): Promise<any> =>
  window.electronAPI.invoke('payroll:state-data', stateCode),
getAllStates: (): Promise<any[]> =>
  window.electronAPI.invoke('payroll:all-states'),
```

**Step 5: Update `EmployeeForm.tsx` — replace state text input with state dropdown**

Find the state field in `EmployeeForm.tsx` and replace the plain text input with:
```typescript
// Add state at top of component
const [allStates, setAllStates] = useState<Array<{state_code: string; state_name: string}>>([]);

// In useEffect load:
const states = await api.getAllStates();
setAllStates(states);

// In JSX, replace the state input with:
<select className="block-select" value={form.state} onChange={(e) => setField('state', e.target.value)}>
  <option value="">Select state...</option>
  {allStates.map(s => (
    <option key={s.state_code} value={s.state_code}>
      {s.state_name} ({s.state_code})
    </option>
  ))}
</select>
```

**Step 6: Build and deploy**
```bash
cd "/Users/rmpgutah/Business Accounting Pro" && npm run build 2>&1 | tail -5 && node_modules/.bin/asar extract "/Applications/Business Accounting Pro.app/Contents/Resources/app.asar" /tmp/bap-asar && cp -R dist/. /tmp/bap-asar/dist/ && node_modules/.bin/asar pack /tmp/bap-asar "/Applications/Business Accounting Pro.app/Contents/Resources/app.asar" --unpack-dir "node_modules/better-sqlite3" && bash scripts/codesign-mac.sh "/Applications/Business Accounting Pro.app" && rm -rf /tmp/bap-asar
```

**Step 7: Verify** — Open app → Payroll → New payroll run → Employee in TX should show $0 state tax, employee in CA should show 9.3%+ depending on income.

**Step 8: Commit**
```bash
git add src/main/ipc/index.ts src/main/services/StateTaxEngine.ts src/renderer/lib/api.ts src/renderer/modules/payroll/PayrollRunner.tsx src/renderer/modules/payroll/EmployeeForm.tsx
git commit -m "feat: wire StateTaxEngine into payroll — replace hardcoded 5% with per-state real rates"
```

---

### Task 4: Benefits & Deductions Engine in PayrollRunner

**Files:**
- Create: `src/renderer/modules/payroll/DeductionsManager.tsx`
- Modify: `src/renderer/modules/payroll/PayrollRunner.tsx`
- Modify: `src/renderer/modules/payroll/index.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add IPC handlers for employee deductions**

In `src/main/ipc/index.ts`, add:
```typescript
ipcMain.handle('payroll:list-deductions', (_event, employeeId: string) => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(
    'SELECT * FROM employee_deductions WHERE employee_id = ? AND company_id = ? ORDER BY type, name'
  ).all(employeeId, companyId);
});

ipcMain.handle('payroll:save-deduction', (_event, data: any) => {
  const companyId = db.getCurrentCompanyId();
  if (data.id) {
    db.update('employee_deductions', data.id, data);
    return db.getById('employee_deductions', data.id);
  }
  return db.create('employee_deductions', { ...data, company_id: companyId });
});

ipcMain.handle('payroll:delete-deduction', (_event, id: string) => {
  db.remove('employee_deductions', id);
  return { success: true };
});

ipcMain.handle('payroll:list-deductions-for-run', (_event, employeeIds: string[]) => {
  const companyId = db.getCurrentCompanyId();
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map(() => '?').join(',');
  return db.getDb().prepare(
    `SELECT * FROM employee_deductions WHERE employee_id IN (${placeholders}) AND company_id = ? AND is_active = 1`
  ).all(...employeeIds, companyId);
});
```

**Step 2: Add API methods**
```typescript
listEmployeeDeductions: (employeeId: string): Promise<any[]> =>
  window.electronAPI.invoke('payroll:list-deductions', employeeId),
saveEmployeeDeduction: (data: Record<string, any>): Promise<any> =>
  window.electronAPI.invoke('payroll:save-deduction', data),
deleteEmployeeDeduction: (id: string): Promise<void> =>
  window.electronAPI.invoke('payroll:delete-deduction', id),
listDeductionsForRun: (employeeIds: string[]): Promise<any[]> =>
  window.electronAPI.invoke('payroll:list-deductions-for-run', employeeIds),
```

**Step 3: Create `DeductionsManager.tsx`**

Build a full deductions management component with:
- List of current deductions per employee (type badge, pre/post-tax indicator, amount)
- Add/Edit form: name, type (health/dental/vision/retirement/hsa/garnishment/custom), calculation (fixed/percentage), amount, pre-tax toggle, effective/end dates
- Activate/deactivate toggle
- Employer match field (for 401k type)

Reference the design at `docs/plans/2026-04-07-enterprise-upgrade-design.md` § 1.2 for the full field list.

**Step 4: Wire deductions into `PayrollRunner.tsx` calculation**

In the payroll calculation loop (where each employee's net pay is computed):

```typescript
// Load all active deductions for all employees in this run
const allDeductions = await api.listDeductionsForRun(employees.map(e => e.id));

// Per-employee calculation (inside the loop):
const empDeductions = allDeductions.filter(d => d.employee_id === employee.id);

// Pre-tax deductions reduce taxable gross
const preTaxTotal = empDeductions
  .filter(d => d.is_pretax === 1)
  .reduce((sum, d) => sum + (d.calculation === 'percentage' ? gross_pay * (d.amount / 100) : d.amount), 0);

const taxableGross = Math.max(0, gross_pay - preTaxTotal);

// Recalculate federal and state tax on reduced taxableGross (not gross_pay)
const federal_tax = calculateFederalWithholding(taxableGross, ...);
const state_tax = await api.calculateStateTax({ grossPay: taxableGross, ... });

// Post-tax deductions
const postTaxTotal = empDeductions
  .filter(d => d.is_pretax !== 1)
  .reduce((sum, d) => sum + (d.calculation === 'percentage' ? gross_pay * (d.amount / 100) : d.amount), 0);

const other_deductions = preTaxTotal + postTaxTotal;
const net_pay = taxableGross - federal_tax - state_tax - social_security - medicare - postTaxTotal;
```

**Step 5: Add Deductions tab to `src/renderer/modules/payroll/index.tsx`**

Add `'deductions'` to the `Tab` type and render `<DeductionsManager />` for that tab.

**Step 6: Build, deploy, verify** — Run payroll on an employee with a 401k deduction and verify taxable gross is reduced before withholding.

**Step 7: Commit**
```bash
git add src/renderer/modules/payroll/DeductionsManager.tsx src/renderer/modules/payroll/PayrollRunner.tsx src/renderer/modules/payroll/index.tsx src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat: benefits & deductions engine — pre/post-tax deductions wired into payroll runner"
```

---

### Task 5: PTO Accrual System

**Files:**
- Create: `src/renderer/modules/payroll/PtoDashboard.tsx`
- Create: `src/renderer/modules/payroll/PtoPolicyForm.tsx`
- Modify: `src/renderer/modules/payroll/index.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add PTO IPC handlers to `src/main/ipc/index.ts`**
```typescript
ipcMain.handle('payroll:pto-list-policies', () => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare('SELECT * FROM pto_policies WHERE company_id = ? ORDER BY name').all(companyId);
});

ipcMain.handle('payroll:pto-save-policy', (_event, data: any) => {
  const companyId = db.getCurrentCompanyId();
  if (data.id) { db.update('pto_policies', data.id, data); return db.getById('pto_policies', data.id); }
  return db.create('pto_policies', { ...data, company_id: companyId });
});

ipcMain.handle('payroll:pto-balances', (_event, employeeId?: string) => {
  const companyId = db.getCurrentCompanyId();
  const sql = employeeId
    ? `SELECT pb.*, pp.name as policy_name, pp.accrual_rate, e.name as employee_name
       FROM pto_balances pb JOIN pto_policies pp ON pb.policy_id = pp.id JOIN employees e ON pb.employee_id = e.id
       WHERE pb.company_id = ? AND pb.employee_id = ?`
    : `SELECT pb.*, pp.name as policy_name, pp.accrual_rate, e.name as employee_name
       FROM pto_balances pb JOIN pto_policies pp ON pb.policy_id = pp.id JOIN employees e ON pb.employee_id = e.id
       WHERE pb.company_id = ? ORDER BY e.name, pp.name`;
  return employeeId
    ? db.getDb().prepare(sql).all(companyId, employeeId)
    : db.getDb().prepare(sql).all(companyId);
});

ipcMain.handle('payroll:pto-accrue', (_event, { payrollRunId, employeeIds }: { payrollRunId: string; employeeIds: string[] }) => {
  const companyId = db.getCurrentCompanyId();
  const policies = db.getDb().prepare('SELECT * FROM pto_policies WHERE company_id = ?').all(companyId) as any[];
  const { v4: uuid } = require('uuid');
  for (const policy of policies) {
    for (const employeeId of employeeIds) {
      let balance = db.getDb().prepare('SELECT * FROM pto_balances WHERE employee_id = ? AND policy_id = ?').get(employeeId, policy.id) as any;
      if (!balance) {
        db.create('pto_balances', { employee_id: employeeId, policy_id: policy.id, company_id: companyId, balance: 0, accrued_ytd: 0, used_ytd: 0 });
        balance = db.getDb().prepare('SELECT * FROM pto_balances WHERE employee_id = ? AND policy_id = ?').get(employeeId, policy.id);
      }
      const accrued = policy.accrual_rate;
      const newBalance = policy.max_balance ? Math.min(balance.balance + accrued, policy.max_balance) : balance.balance + accrued;
      db.getDb().prepare('UPDATE pto_balances SET balance = ?, accrued_ytd = accrued_ytd + ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(newBalance, accrued, balance.id);
      db.create('pto_transactions', { employee_id: employeeId, policy_id: policy.id, company_id: companyId, type: 'accrual', hours: accrued, note: 'Payroll run accrual', payroll_run_id: payrollRunId });
    }
  }
  return { success: true };
});
```

**Step 2: Add API methods**
```typescript
ptoPolicies: (): Promise<any[]> => window.electronAPI.invoke('payroll:pto-list-policies'),
savePtoPolicy: (data: Record<string, any>): Promise<any> => window.electronAPI.invoke('payroll:pto-save-policy', data),
ptoBal: (employeeId?: string): Promise<any[]> => window.electronAPI.invoke('payroll:pto-balances', employeeId),
ptoAccrue: (payrollRunId: string, employeeIds: string[]): Promise<void> => window.electronAPI.invoke('payroll:pto-accrue', { payrollRunId, employeeIds }),
```

**Step 3: Build `PtoDashboard.tsx`**

Table view of all employees' PTO balances grouped by policy. Shows: Employee, Policy, Balance (hours), Accrued YTD, Used YTD, Projected EOY. Filter by policy. Admin can manually adjust a balance. Export to CSV.

**Step 4: Build `PtoPolicyForm.tsx`**

Form: name, accrual rate (hours/pay period), max balance cap (optional), carryover limit (optional), available after X days of employment.

**Step 5: Add PTO tab to payroll index and wire accrual into `payroll:process` IPC**

In `payroll:process` handler in `ipc/index.ts`, after saving pay stubs, call the PTO accrual logic for all processed employees.

**Step 6: Build, deploy, verify**

**Step 7: Commit**
```bash
git add src/renderer/modules/payroll/PtoDashboard.tsx src/renderer/modules/payroll/PtoPolicyForm.tsx src/renderer/modules/payroll/index.tsx src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat: PTO accrual system — policies, balances, auto-accrual on payroll runs"
```

---

### Task 6: Tax Forms — W-2, 1099-NEC, Form 941

**Files:**
- Create: `src/renderer/modules/payroll/TaxForms.tsx`
- Modify: `src/renderer/lib/print-templates.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/modules/payroll/index.tsx`

**Step 1: Add IPC handlers for tax form data aggregation**
```typescript
ipcMain.handle('payroll:w2-data', (_event, { year, employeeId }: { year: number; employeeId?: string }) => {
  const companyId = db.getCurrentCompanyId();
  const sql = `
    SELECT e.id, e.name, e.ssn_last4, e.state, e.filing_status,
      e.routing_number, e.account_number,
      COALESCE(SUM(ps.gross_pay), 0) as box1_wages,
      COALESCE(SUM(ps.federal_tax), 0) as box2_federal_withheld,
      COALESCE(SUM(ps.social_security), 0) as box4_ss_withheld,
      COALESCE(SUM(ps.medicare), 0) as box6_medicare_withheld,
      COALESCE(SUM(ps.state_tax), 0) as box17_state_withheld,
      COALESCE(SUM(ps.gross_pay), 0) as box16_state_wages
    FROM employees e
    LEFT JOIN pay_stubs ps ON ps.employee_id = e.id
    LEFT JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE e.company_id = ? AND e.type = 'employee'
      AND (strftime('%Y', pr.pay_date) = ? OR pr.pay_date IS NULL)
      ${employeeId ? 'AND e.id = ?' : ''}
    GROUP BY e.id`;
  const params: any[] = [companyId, String(year)];
  if (employeeId) params.push(employeeId);
  return db.getDb().prepare(sql).all(...params);
});

ipcMain.handle('payroll:1099-data', (_event, year: number) => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(`
    SELECT e.id, e.name, e.ssn_last4, e.state,
      COALESCE(SUM(ps.gross_pay), 0) as nonemployee_compensation
    FROM employees e
    LEFT JOIN pay_stubs ps ON ps.employee_id = e.id
    LEFT JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE e.company_id = ? AND e.type = 'contractor'
      AND strftime('%Y', pr.pay_date) = ?
    GROUP BY e.id
    HAVING nonemployee_compensation > 0
  `).all(companyId, String(year));
});

ipcMain.handle('payroll:941-data', (_event, { year, quarter }: { year: number; quarter: number }) => {
  const companyId = db.getCurrentCompanyId();
  const quarterStart = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
  const quarterEnd = `${year}-${String(quarter * 3).padStart(2, '0')}-31`;
  return db.getDb().prepare(`
    SELECT
      COUNT(DISTINCT ps.employee_id) as employee_count,
      COALESCE(SUM(ps.gross_pay), 0) as total_wages,
      COALESCE(SUM(ps.federal_tax), 0) as total_federal_withheld,
      COALESCE(SUM(ps.social_security), 0) as total_ss_employee,
      COALESCE(SUM(ps.medicare), 0) as total_medicare_employee
    FROM pay_stubs ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE pr.company_id = ? AND pr.pay_date BETWEEN ? AND ?
  `).get(companyId, quarterStart, quarterEnd);
});
```

**Step 2: Add `generateW2HTML`, `generate1099HTML`, `generate941HTML` to `src/renderer/lib/print-templates.ts`**

Each function follows the existing `generateInvoiceHTML` pattern: builds a self-contained HTML string with inline CSS styled to match the IRS form layout approximately (not pixel-perfect, but clearly labeled with all required boxes).

W-2 boxes to populate: 1 (Wages), 2 (Federal withheld), 3 (SS wages), 4 (SS withheld), 5 (Medicare wages), 6 (Medicare withheld), 12 (codes: D=401k, W=HSA), 15 (State), 16 (State wages), 17 (State withheld).

**Step 3: Add API methods**
```typescript
getW2Data: (year: number, employeeId?: string): Promise<any[]> =>
  window.electronAPI.invoke('payroll:w2-data', { year, employeeId }),
get1099Data: (year: number): Promise<any[]> =>
  window.electronAPI.invoke('payroll:1099-data', year),
get941Data: (year: number, quarter: number): Promise<any> =>
  window.electronAPI.invoke('payroll:941-data', { year, quarter }),
```

**Step 4: Build `TaxForms.tsx`**

Tab layout with three sub-tabs: W-2, 1099-NEC, 941. Year/quarter selectors. Table of employees with their data. "Generate PDF" button per employee (W-2, 1099) or per quarter (941) using `api.saveToPDF(html, filename)`. Bulk "Generate All W-2s" button.

**Step 5: Add Tax Forms tab to payroll index**

**Step 6: Build, deploy, verify** — Generate a W-2 for a test employee and verify all dollar amounts are correct.

**Step 7: Commit**
```bash
git add src/renderer/modules/payroll/TaxForms.tsx src/renderer/lib/print-templates.ts src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/payroll/index.tsx
git commit -m "feat: tax forms — W-2, 1099-NEC, Form 941 generation with PDF export"
```

---

### Task 7: Payroll Journal Entry Auto-Posting

**Files:**
- Modify: `src/main/ipc/index.ts` (payroll:process handler)

**Step 1: Find `payroll:process` handler in `src/main/ipc/index.ts`**

After the pay stubs INSERT loop, add a compound journal entry inside the same transaction:

```typescript
// Auto-post payroll journal entry
const { v4: uuid } = require('uuid');
const entryId = uuid();
const entryNumber = ...; // use journal:next-number logic
const grossPay = stubs.reduce((s: number, s2: any) => s + s2.grossPay, 0);
const federalTax = stubs.reduce((s: number, s2: any) => s + s2.federalTax, 0);
const stateTax = stubs.reduce((s: number, s2: any) => s + s2.stateTax, 0);
const ss = stubs.reduce((s: number, s2: any) => s + s2.ss, 0);
const medicare = stubs.reduce((s: number, s2: any) => s + s2.medicare, 0);
const netPay = stubs.reduce((s: number, s2: any) => s + s2.netPay, 0);
const employerSS = ss; // Employer matches employee SS
const employerMedicare = medicare; // Employer matches employee Medicare

// Find or fallback account IDs
const salaryAcct = db.getDb().prepare("SELECT id FROM accounts WHERE company_id = ? AND (name LIKE '%Salaries%' OR name LIKE '%Wages%') AND type = 'expense' LIMIT 1").get(companyId) as any;
const taxExpAcct = db.getDb().prepare("SELECT id FROM accounts WHERE company_id = ? AND name LIKE '%Payroll Tax%' AND type = 'expense' LIMIT 1").get(companyId) as any;
const cashAcct = db.getDb().prepare("SELECT id FROM accounts WHERE company_id = ? AND (name LIKE '%Checking%' OR name LIKE '%Cash%') AND type = 'asset' LIMIT 1").get(companyId) as any;

// Only post if we can find core accounts
if (salaryAcct && cashAcct) {
  db.create('journal_entries', {
    company_id: companyId, entry_number: entryNumber,
    date: payDate, description: `Payroll run — ${periodStart} to ${periodEnd}`,
    status: 'posted', reference: runId,
  });
  // DR Salaries Expense
  db.create('journal_entry_lines', { journal_entry_id: entryId, account_id: salaryAcct.id, debit: grossPay, credit: 0, description: 'Gross payroll' });
  // CR Net Payroll Payable (Cash)
  db.create('journal_entry_lines', { journal_entry_id: entryId, account_id: cashAcct.id, debit: 0, credit: netPay, description: 'Net pay disbursed' });
  // CR Tax Liabilities (approximate — combine all withholding)
  if (federalTax + stateTax + ss + medicare > 0) {
    // Use tax liability account if it exists, else cash
    const taxLiabAcct = db.getDb().prepare("SELECT id FROM accounts WHERE company_id = ? AND name LIKE '%Tax%Payable%' AND type = 'liability' LIMIT 1").get(companyId) as any || cashAcct;
    db.create('journal_entry_lines', { journal_entry_id: entryId, account_id: taxLiabAcct.id, debit: 0, credit: federalTax + stateTax + ss + medicare, description: 'Tax withholdings payable' });
  }
}
```

**Step 2: Build, deploy, verify** — Run payroll and check Journal Entries module for the auto-posted entry.

**Step 3: Commit**
```bash
git add src/main/ipc/index.ts
git commit -m "feat: auto-post payroll journal entry on every processed run"
```

---

### Task 8: Advanced Employee Profile UI

**Files:**
- Modify: `src/renderer/modules/payroll/EmployeeForm.tsx`

**Step 1: Add new fields to `EmployeeFormData` interface**
```typescript
department: string;
job_title: string;
routing_number: string;
account_number: string;
account_type: 'checking' | 'savings';
emergency_contact_name: string;
emergency_contact_phone: string;
```

**Step 2: Add new form sections to `EmployeeForm.tsx`**

After the existing tax section, add three collapsible card sections:

**Direct Deposit section:**
```tsx
<div className="block-card">
  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Direct Deposit</h3>
  <div className="grid grid-cols-3 gap-4">
    <div><label>Account Type</label>
      <select className="block-select" value={form.account_type} onChange={e => setField('account_type', e.target.value)}>
        <option value="checking">Checking</option>
        <option value="savings">Savings</option>
      </select>
    </div>
    <div><label>Routing Number</label><input className="block-input" value={form.routing_number} onChange={e => setField('routing_number', e.target.value)} placeholder="9-digit ABA number" /></div>
    <div><label>Account Number</label><input className="block-input" value={form.account_number} onChange={e => setField('account_number', e.target.value)} placeholder="Account number" /></div>
  </div>
</div>
```

**Job Details section:**
```tsx
<div className="block-card">
  <h3>Job Details</h3>
  <div className="grid grid-cols-2 gap-4">
    <div><label>Department</label><input className="block-input" value={form.department} onChange={e => setField('department', e.target.value)} /></div>
    <div><label>Job Title</label><input className="block-input" value={form.job_title} onChange={e => setField('job_title', e.target.value)} /></div>
  </div>
</div>
```

**Emergency Contact section:**
```tsx
<div className="block-card">
  <h3>Emergency Contact</h3>
  <div className="grid grid-cols-2 gap-4">
    <div><label>Name</label><input className="block-input" value={form.emergency_contact_name} onChange={e => setField('emergency_contact_name', e.target.value)} /></div>
    <div><label>Phone</label><input className="block-input" value={form.emergency_contact_phone} onChange={e => setField('emergency_contact_phone', e.target.value)} /></div>
  </div>
</div>
```

**Step 3: Wire new fields into save payload and load**

**Step 4: Build, deploy, commit**
```bash
git add src/renderer/modules/payroll/EmployeeForm.tsx
git commit -m "feat: advanced employee profile — direct deposit, job details, emergency contact"
```

---

# PHASE 2: Enterprise Taxes

---

### Task 9: State Tax Compliance Dashboard

**Files:**
- Create: `src/renderer/modules/taxes/StateCompliance.tsx`
- Modify: `src/renderer/modules/taxes/index.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add state compliance IPC handler**
```typescript
ipcMain.handle('tax:state-compliance-summary', (_event, year: number) => {
  const companyId = db.getCurrentCompanyId();
  // Get all states where we have employees
  const states = db.getDb().prepare(
    `SELECT DISTINCT e.state, COUNT(DISTINCT e.id) as employee_count,
      COALESCE(SUM(ps.state_tax), 0) as total_withheld,
      COALESCE(SUM(ps.gross_pay), 0) as total_wages
    FROM employees e
    LEFT JOIN pay_stubs ps ON ps.employee_id = e.id
    LEFT JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE e.company_id = ? AND e.state != '' AND e.status = 'active'
      AND (pr.pay_date IS NULL OR strftime('%Y', pr.pay_date) = ?)
    GROUP BY e.state`
  ).all(companyId, String(year));
  return states;
});

ipcMain.handle('tax:filing-deadlines', (_event, year: number) => {
  // Return standard federal + state deadlines for the given year
  const deadlines = [];
  // Federal 941 quarterly
  [1,2,3,4].forEach(q => {
    const months = [4, 7, 10, 1];
    const deadlineYear = q === 4 ? year + 1 : year;
    deadlines.push({
      id: `941-q${q}-${year}`, type: 'federal', form: '941',
      label: `Form 941 — Q${q} ${year}`, jurisdiction: 'Federal',
      due_date: `${deadlineYear}-${String(months[q-1]).padStart(2,'0')}-31`,
      quarter: q, year,
    });
  });
  // Federal W-2 / 1099
  deadlines.push({ id: `w2-${year}`, type: 'federal', form: 'W-2', label: `W-2 Filing — ${year}`, jurisdiction: 'Federal', due_date: `${year+1}-01-31`, year });
  deadlines.push({ id: `1099-${year}`, type: 'federal', form: '1099-NEC', label: `1099-NEC — ${year}`, jurisdiction: 'Federal', due_date: `${year+1}-01-31`, year });
  // Federal 940 annual
  deadlines.push({ id: `940-${year}`, type: 'federal', form: '940', label: `Form 940 — ${year}`, jurisdiction: 'Federal', due_date: `${year+1}-01-31`, year });
  return deadlines;
});

ipcMain.handle('tax:mark-deadline-filed', (_event, deadlineId: string) => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(
    `INSERT OR REPLACE INTO settings (id, company_id, key, value) VALUES (?, ?, ?, datetime('now'))`
  ).run(require('uuid').v4(), companyId, `deadline_filed_${deadlineId}`, 'true');
});
```

**Step 2: Add API methods**
```typescript
stateComplianceSummary: (year: number): Promise<any[]> => window.electronAPI.invoke('tax:state-compliance-summary', year),
filingDeadlines: (year: number): Promise<any[]> => window.electronAPI.invoke('tax:filing-deadlines', year),
markDeadlineFiled: (deadlineId: string): Promise<void> => window.electronAPI.invoke('tax:mark-deadline-filed', deadlineId),
```

**Step 3: Build `StateCompliance.tsx`**

Two-section layout:
1. **Active States table** — State name, employees, wages paid, tax withheld, estimated owed (wages × state rate), variance (withheld vs. owed), status badge
2. **Filing Calendar** — Card grid of all deadlines for the year, color-coded (green=filed, amber=upcoming, red=overdue), "Mark Filed" button per deadline

**Step 4: Add State Compliance tab to `src/renderer/modules/taxes/index.tsx`**

**Step 5: Build, deploy, commit**
```bash
git add src/renderer/modules/taxes/StateCompliance.tsx src/renderer/modules/taxes/index.tsx src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat: state tax compliance dashboard — active states, filing calendar, mark-filed tracking"
```

---

### Task 10: State Tax Configuration UI

**Files:**
- Create: `src/renderer/modules/taxes/StateRatesConfig.tsx`
- Modify: `src/renderer/modules/taxes/index.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add IPC handlers**
```typescript
ipcMain.handle('tax:all-state-rates', () => {
  const { getAllStates } = require('../services/StateTaxEngine');
  return getAllStates();
});

ipcMain.handle('tax:save-state-override', (_event, { stateCode, rate, suiRate }: any) => {
  const companyId = db.getCurrentCompanyId();
  // Store overrides in settings as JSON
  const key = `state_tax_overrides`;
  const existing = db.getDb().prepare('SELECT value FROM settings WHERE company_id = ? AND key = ?').get(companyId, key) as any;
  const overrides = existing ? JSON.parse(existing.value) : {};
  overrides[stateCode] = { rate, suiRate };
  db.getDb().prepare(`INSERT OR REPLACE INTO settings (id, company_id, key, value, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(require('uuid').v4(), companyId, key, JSON.stringify(overrides));
  return { success: true };
});
```

**Step 2: Build `StateRatesConfig.tsx`**

Searchable table of all 50 states + DC showing: state name, income tax type (none/flat/progressive), rate, SUI rate, SUI wage base, SDI rate. Each row has an "Override" button that opens an inline edit for company-specific rate. Override indicator shown on overridden rows. Local/city tax input per state (stored in settings JSON).

**Step 3: Wire overrides into `calculateStateTax` IPC handler**

Before returning the calculated rate, check settings for a company override and use it instead.

**Step 4: Add State Rates tab, build, deploy, commit**
```bash
git add src/renderer/modules/taxes/StateRatesConfig.tsx src/renderer/modules/taxes/index.tsx src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat: state tax config UI — all 50 states, SUI/SDI rates, company rate overrides"
```

---

# PHASE 3: Enterprise Debt Collections

---

### Task 11: Settlement & Payment Plan Engine

**Files:**
- Create: `src/renderer/modules/debt-collection/SettlementForm.tsx`
- Create: `src/renderer/modules/debt-collection/PaymentPlanForm.tsx`
- Create: `src/renderer/modules/debt-collection/PaymentPlanDetail.tsx`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add settlement IPC handlers**
```typescript
ipcMain.handle('debt:create-settlement', (_event, data: any) => {
  return db.create('debt_settlements', data);
});

ipcMain.handle('debt:respond-settlement', (_event, { settlementId, response, counterAmount, notes }: any) => {
  const update: any = { status: response, notes, updated_at: "datetime('now')" };
  if (response === 'countered') update.counter_amount = counterAmount;
  if (response === 'accepted') {
    const settlement = db.getById('debt_settlements', settlementId) as any;
    if (settlement) {
      db.update('debts', settlement.debt_id, { status: 'settled', balance_due: 0 });
    }
  }
  return db.update('debt_settlements', settlementId, update);
});

ipcMain.handle('debt:list-settlements', (_event, debtId: string) => {
  return db.getDb().prepare('SELECT * FROM debt_settlements WHERE debt_id = ? ORDER BY created_at DESC').all(debtId);
});

ipcMain.handle('debt:create-payment-plan', (_event, { debtId, installmentAmount, frequency, startDate, totalInstallments, notes }: any) => {
  const planId = db.create('debt_payment_plans', { debt_id: debtId, installment_amount: installmentAmount, frequency, start_date: startDate, total_installments: totalInstallments, notes });
  // Generate installment schedule
  const { v4: uuid } = require('uuid');
  const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
  const days = freqDays[frequency] || 30;
  let currentDate = new Date(startDate);
  for (let i = 0; i < totalInstallments; i++) {
    db.create('debt_plan_installments', { plan_id: planId.id, due_date: currentDate.toISOString().slice(0, 10), amount: installmentAmount });
    currentDate.setDate(currentDate.getDate() + days);
  }
  return planId;
});

ipcMain.handle('debt:record-plan-payment', (_event, { installmentId, paidAmount, paidDate }: any) => {
  const installment = db.getById('debt_plan_installments', installmentId) as any;
  if (!installment) return { error: 'Not found' };
  const newPaid = (installment.paid_amount || 0) + paidAmount;
  const status = newPaid >= installment.amount ? 'paid' : 'partial';
  db.update('debt_plan_installments', installmentId, { paid_amount: newPaid, status, paid_date: paidDate });
  // Update plan paid count
  const plan = db.getById('debt_payment_plans', installment.plan_id) as any;
  const paidCount = db.getDb().prepare("SELECT COUNT(*) as c FROM debt_plan_installments WHERE plan_id = ? AND status = 'paid'").get(installment.plan_id) as any;
  if (paidCount.c >= plan.total_installments) {
    db.update('debt_payment_plans', installment.plan_id, { status: 'completed' });
  }
  return { success: true, status };
});
```

**Step 2: Build `SettlementForm.tsx`** — Offer form: type (lump sum / percentage), amount, expiry date, notes. Shows existing settlement history with counter-offer capability.

**Step 3: Build `PaymentPlanForm.tsx`** — Installment amount, frequency, start date, total installments (auto-calculates total). Preview of generated schedule.

**Step 4: Build `PaymentPlanDetail.tsx`** — Shows installment table with status badges. "Record Payment" button per installment.

**Step 5: Add Settlement and Payment Plan sections to `DebtDetail.tsx`** as collapsible panels below the pipeline stage section.

**Step 6: Add API methods, build, deploy, commit**
```bash
git commit -m "feat: settlement & payment plan engine — offer workflow, installment scheduling, breach detection"
```

---

### Task 12: Collector Management

**Files:**
- Create: `src/renderer/modules/debt-collection/CollectorDashboard.tsx`
- Modify: `src/renderer/modules/debt-collection/DebtList.tsx`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`
- Modify: `src/renderer/modules/debt-collection/index.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add collector IPC handlers**
```typescript
ipcMain.handle('debt:collector-summary', () => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(`
    SELECT u.id, u.display_name, u.email,
      COUNT(d.id) as debt_count,
      COALESCE(SUM(d.balance_due), 0) as total_balance,
      COALESCE(SUM(dp.amount), 0) as total_collected,
      COUNT(DISTINCT CASE WHEN d.status = 'settled' THEN d.id END) as settled_count
    FROM users u
    LEFT JOIN debts d ON d.assigned_collector_id = u.id AND d.company_id = ?
    LEFT JOIN debt_payments dp ON dp.debt_id = d.id
    GROUP BY u.id ORDER BY total_balance DESC
  `).all(companyId);
});

ipcMain.handle('debt:assign-collector', (_event, { debtId, collectorId }: any) => {
  return db.update('debts', debtId, { assigned_collector_id: collectorId });
});

ipcMain.handle('debt:bulk-assign-collector', (_event, { debtIds, collectorId }: any) => {
  const stmt = db.getDb().prepare('UPDATE debts SET assigned_collector_id = ? WHERE id = ?');
  db.getDb().transaction(() => { debtIds.forEach((id: string) => stmt.run(collectorId, id)); })();
  return { success: true };
});
```

**Step 2: Build `CollectorDashboard.tsx`**

Cards per collector: name/email, # debts assigned, total balance, total collected, collection rate %, settled count. Clicking a collector filters DebtList to their assignments. Bulk reassign: select multiple debts → assign to collector.

**Step 3: Add "Assigned To" column to `DebtList.tsx`** — shows collector name (or "Unassigned"). Filter by collector.

**Step 4: Add "Assign Collector" section to `DebtDetail.tsx`** — dropdown of system users, assign button.

**Step 5: Add Collector Dashboard tab, build, deploy, commit**
```bash
git commit -m "feat: collector management — assignment, dashboard KPIs, bulk reassign"
```

---

### Task 13: Cost Tracking & Risk Scoring

**Files:**
- Create: `src/renderer/modules/debt-collection/CostTracker.tsx`
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`
- Modify: `src/renderer/modules/debt-collection/AnalyticsView.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add cost + risk IPC handlers**
```typescript
ipcMain.handle('debt:add-cost', (_event, data: any) => db.create('debt_costs', data));

ipcMain.handle('debt:cost-summary', (_event, debtId: string) => {
  const costs = db.getDb().prepare('SELECT * FROM debt_costs WHERE debt_id = ? ORDER BY date DESC').all(debtId) as any[];
  const payments = db.getDb().prepare('SELECT COALESCE(SUM(amount), 0) as total FROM debt_payments WHERE debt_id = ?').get(debtId) as any;
  const totalCost = costs.reduce((s: number, c: any) => s + c.amount, 0);
  const grossRecovery = payments.total;
  return { costs, totalCost, grossRecovery, netRecovery: grossRecovery - totalCost, roi: totalCost > 0 ? ((grossRecovery - totalCost) / totalCost) * 100 : 0 };
});

ipcMain.handle('debt:calculate-risk-score', (_event, debtId: string) => {
  const debt = db.getById('debts', debtId) as any;
  if (!debt) return 50;
  let score = 50;
  // Days delinquent
  const daysSince = Math.floor((Date.now() - new Date(debt.delinquent_date || debt.created_at).getTime()) / 86400000);
  if (daysSince < 30) score += 10;
  else if (daysSince < 90) score -= 10;
  else if (daysSince < 180) score -= 25;
  else score -= 40;
  // Payment history
  const payments = db.getDb().prepare('SELECT COUNT(*) as c FROM debt_payments WHERE debt_id = ?').get(debtId) as any;
  if (payments.c > 0) score += 20;
  // Active payment plan
  const plan = db.getDb().prepare("SELECT id FROM debt_payment_plans WHERE debt_id = ? AND status = 'active'").get(debtId);
  if (plan) score += 15;
  // Stage penalties
  const stagePenalties: Record<string, number> = { reminder: 0, warning: -5, final_notice: -10, demand_letter: -15, collections_agency: -20, legal_action: -25, judgment: -30, garnishment: -10 };
  score += stagePenalties[debt.current_stage] || 0;
  const finalScore = Math.max(0, Math.min(100, score));
  db.update('debts', debtId, { risk_score: finalScore });
  return finalScore;
});
```

**Step 2: Build `CostTracker.tsx`** — Form to add costs (category dropdown, description, amount, date, vendor). Table of existing costs. ROI summary card showing gross recovery, total costs, net recovery, ROI %.

**Step 3: Add cost tracker panel and risk score badge to `DebtDetail.tsx`**

**Step 4: Add Cost vs. Recovery chart to `AnalyticsView.tsx`** using Recharts BarChart.

**Step 5: Build, deploy, commit**
```bash
git commit -m "feat: debt cost tracking, ROI analysis, algorithmic risk scoring"
```

---

### Task 14: Cross-Module Garnishment Link

**Files:**
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add garnishment push IPC handler**
```typescript
ipcMain.handle('debt:push-garnishment-to-payroll', (_event, { debtId, employeeId, amount, frequency }: any) => {
  const companyId = db.getCurrentCompanyId();
  const debt = db.getById('debts', debtId) as any;
  return db.create('employee_deductions', {
    company_id: companyId,
    employee_id: employeeId,
    name: `Garnishment — ${debt?.debtor_name || debtId}`,
    type: 'garnishment',
    calculation: 'fixed',
    amount,
    is_pretax: 0,
    is_active: 1,
    effective_date: new Date().toISOString().slice(0, 10),
    end_date: null,
  });
});

ipcMain.handle('debt:garnishment-progress', (_event, debtId: string) => {
  const companyId = db.getCurrentCompanyId();
  // Find linked deductions by name matching
  const debt = db.getById('debts', debtId) as any;
  const payments = db.getDb().prepare("SELECT COALESCE(SUM(amount), 0) as total FROM debt_payments WHERE debt_id = ? AND method = 'garnishment'").get(debtId) as any;
  return { totalCollected: payments.total, balance: debt?.balance_due || 0 };
});
```

**Step 2: Add "Push to Payroll" button in `DebtDetail.tsx`**

When `current_stage === 'garnishment'`, show a panel: employee search dropdown (from active employees), withholding amount field, frequency, "Create Payroll Garnishment" button. Shows existing garnishment progress bar.

**Step 3: Build, deploy, commit**
```bash
git commit -m "feat: cross-module garnishment — push debt garnishment to payroll deduction automatically"
```

---

# PHASE 4: Platform Layer — Enterprise Customization

---

### Task 15: Custom Fields UI Builder

**Files:**
- Create: `src/renderer/modules/settings/CustomFields.tsx`
- Create: `src/renderer/components/CustomFieldsPanel.tsx`
- Modify: `src/renderer/modules/settings/index.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add custom fields IPC handlers**
```typescript
ipcMain.handle('custom-fields:list', (_event, entityType?: string) => {
  const companyId = db.getCurrentCompanyId();
  const sql = entityType
    ? 'SELECT * FROM custom_field_defs WHERE company_id = ? AND entity_type = ? ORDER BY display_order, label'
    : 'SELECT * FROM custom_field_defs WHERE company_id = ? ORDER BY entity_type, display_order, label';
  return entityType
    ? db.getDb().prepare(sql).all(companyId, entityType)
    : db.getDb().prepare(sql).all(companyId);
});

ipcMain.handle('custom-fields:save', (_event, data: any) => {
  const companyId = db.getCurrentCompanyId();
  if (data.id) { db.update('custom_field_defs', data.id, data); return db.getById('custom_field_defs', data.id); }
  return db.create('custom_field_defs', { ...data, company_id: companyId });
});

ipcMain.handle('custom-fields:delete', (_event, id: string) => {
  db.remove('custom_field_defs', id);
  return { success: true };
});
```

**Step 2: Build `CustomFields.tsx` (Settings section)**

Entity type tabs (Client, Employee, Invoice, Debt, Expense, Vendor). Field list per entity with: label, key, type badge, required indicator, reorder arrows. "Add Field" opens inline form: label, key (auto-generated from label), type (text/number/date/dropdown/checkbox/multiselect/url), options (for dropdown/multiselect), required toggle, placeholder. Delete button.

**Step 3: Build shared `CustomFieldsPanel.tsx` component**

Used in every form/detail view. Props: `entityType`, `values` (current JSON), `onChange` (callback). Loads field definitions, renders appropriate input per field type. Returns updated JSON on change. Collapsible panel with "Custom Fields" header.

```typescript
interface CustomFieldsPanelProps {
  entityType: 'client' | 'employee' | 'invoice' | 'debt' | 'expense' | 'vendor';
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
  readOnly?: boolean;
}
```

**Step 4: Add `CustomFieldsPanel` to key forms**

Add to: `src/renderer/modules/clients/ClientDetail.tsx`, `src/renderer/modules/payroll/EmployeeForm.tsx`, `src/renderer/modules/invoices/InvoiceForm.tsx`, `src/renderer/modules/debt-collection/DebtForm.tsx`.

**Step 5: Add Custom Fields tab to Settings, build, deploy, commit**
```bash
git commit -m "feat: custom fields UI builder — define fields per entity, renders in all major forms"
```

---

### Task 16: Role-Based Access Control

**Files:**
- Create: `src/renderer/lib/permissions.ts`
- Modify: `src/renderer/modules/settings/index.tsx`
- Modify: `src/renderer/App.tsx` (or equivalent router)
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Create `src/renderer/lib/permissions.ts`**
```typescript
export type Role = 'admin' | 'manager' | 'accountant' | 'collector' | 'viewer';

export const MODULE_PERMISSIONS: Record<Role, string[]> = {
  admin: ['*'],
  manager: ['dashboard', 'invoices', 'expenses', 'clients', 'accounts', 'payroll', 'taxes', 'debt-collection', 'reports', 'bank-recon', 'bills', 'purchase-orders', 'quotes', 'projects', 'inventory', 'fixed-assets', 'recurring', 'time', 'budgets', 'forecasting'],
  accountant: ['dashboard', 'accounts', 'expenses', 'invoices', 'clients', 'reports', 'bank-recon', 'bills', 'purchase-orders', 'taxes', 'recurring', 'budgets'],
  collector: ['dashboard', 'debt-collection', 'clients'],
  viewer: ['dashboard', 'reports'],
};

export function canAccess(role: Role, module: string): boolean {
  const perms = MODULE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(module);
}

export function usePermissions() {
  // Read role from authStore user record + user_companies
  // Returns { role, canAccess: (module) => boolean, isAdmin: bool }
}
```

**Step 2: Add role enforcement in app module router**

Wrap each module render in `canAccess(userRole, moduleName)` check. Show "Access Denied" panel for unauthorized modules.

**Step 3: Add User & Permissions panel to Settings**

List all users linked to company (from `user_companies`). Role dropdown per user. "Update Role" button. Show current user's role prominently.

**Step 4: Add IPC handler**
```typescript
ipcMain.handle('auth:set-role', (_event, { userId, role }: { userId: string; role: string }) => {
  const companyId = db.getCurrentCompanyId();
  db.getDb().prepare('UPDATE user_companies SET role = ? WHERE user_id = ? AND company_id = ?').run(role, userId, companyId);
  return { success: true };
});

ipcMain.handle('auth:get-permissions', (_event, userId: string) => {
  const companyId = db.getCurrentCompanyId();
  const link = db.getDb().prepare('SELECT role FROM user_companies WHERE user_id = ? AND company_id = ?').get(userId, companyId) as any;
  return { role: link?.role || 'viewer' };
});
```

**Step 5: Build, deploy, commit**
```bash
git commit -m "feat: role-based access control — admin/manager/accountant/collector/viewer permission matrix"
```

---

### Task 17: Saved Views on All List Screens

**Files:**
- Create: `src/renderer/components/SavedViewsBar.tsx`
- Modify: List screens (InvoiceList, DebtList, ExpenseList, etc.)
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add saved views IPC handlers**
```typescript
ipcMain.handle('views:list', (_event, entityType: string) => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(
    'SELECT * FROM saved_views WHERE company_id = ? AND entity_type = ? ORDER BY name'
  ).all(companyId, entityType);
});

ipcMain.handle('views:save', (_event, data: any) => {
  const companyId = db.getCurrentCompanyId();
  return db.create('saved_views', { ...data, company_id: companyId });
});

ipcMain.handle('views:delete', (_event, id: string) => {
  db.remove('saved_views', id);
  return { success: true };
});
```

**Step 2: Build shared `SavedViewsBar.tsx`**
```typescript
interface SavedViewsBarProps {
  entityType: string;
  currentConfig: Record<string, any>;
  onApply: (config: Record<string, any>) => void;
}
```

Renders as a horizontal strip of view chips above a list. "Save Current View" button → modal for name + shared toggle. Click a chip to apply its config (filters, sort, search). X button to delete.

**Step 3: Add `SavedViewsBar` to `InvoiceList.tsx`, `DebtList.tsx`, `src/renderer/modules/expenses/ExpenseList.tsx`**

**Step 4: Build, deploy, commit**
```bash
git commit -m "feat: saved views — persistent filter/sort/search configs on all major list screens"
```

---

### Task 18: Advanced Automation Builder

**Files:**
- Create: `src/renderer/modules/automations/AutomationBuilder.tsx`
- Modify: `src/renderer/modules/automations/` (existing automation list/edit)
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add cross-module trigger IPC handlers**
```typescript
// New trigger: invoice:overdue → create debt
ipcMain.handle('automations:available-triggers', () => [
  { value: 'invoice_overdue', label: 'Invoice becomes overdue', params: ['days_overdue'] },
  { value: 'payment_plan_missed', label: 'Payment plan installment missed', params: [] },
  { value: 'payroll_processed', label: 'Payroll run processed', params: [] },
  { value: 'employee_terminated', label: 'Employee end_date set', params: [] },
  { value: 'debt_settled', label: 'Debt marked settled', params: [] },
  { value: 'debt_stage_changed', label: 'Debt stage changes to', params: ['target_stage'] },
  { value: 'balance_threshold', label: 'Balance exceeds threshold', params: ['entity_type', 'threshold'] },
]);

ipcMain.handle('automations:available-actions', () => [
  { value: 'create_debt', label: 'Create debt record from invoice', params: [] },
  { value: 'send_notification', label: 'Send notification', params: ['message'] },
  { value: 'advance_debt_stage', label: 'Advance debt to next stage', params: [] },
  { value: 'post_journal_entry', label: 'Post journal entry', params: ['description'] },
  { value: 'flag_for_review', label: 'Flag for manager review', params: [] },
  { value: 'update_field', label: 'Update a field value', params: ['field', 'value'] },
]);
```

**Step 2: Add cross-module automation execution**

In the `invoice:overdue` check handler, add: if an automation rule exists with trigger `invoice_overdue` and action `create_debt`, auto-create a debt from the overdue invoice data.

In `debt:record-plan-payment`, after marking an installment as missed, check for `payment_plan_missed` automation rules and execute.

**Step 3: Build visual `AutomationBuilder.tsx`**

Card-based rule editor: Trigger section (dropdown + param inputs) → Conditions section (optional: AND/OR compound conditions) → Actions section (one or more action cards). Preview of rule in plain English ("When invoice is overdue by 30 days, create a debt record"). Test/dry-run button.

**Step 4: Build, deploy, commit**
```bash
git commit -m "feat: advanced automation builder — cross-module triggers, visual rule editor, compound conditions"
```

---

### Task 19: Global Customization Settings Tab

**Files:**
- Create: `src/renderer/modules/settings/Customize.tsx`
- Modify: `src/renderer/modules/settings/index.tsx`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add IPC handlers**
```typescript
ipcMain.handle('customize:get', () => {
  const companyId = db.getCurrentCompanyId();
  const row = db.getDb().prepare("SELECT value FROM settings WHERE company_id = ? AND key = 'customization'").get(companyId) as any;
  return row ? JSON.parse(row.value) : {};
});

ipcMain.handle('customize:save', (_event, config: Record<string, any>) => {
  const companyId = db.getCurrentCompanyId();
  const existing = db.getDb().prepare("SELECT id FROM settings WHERE company_id = ? AND key = 'customization'").get(companyId) as any;
  const { v4: uuid } = require('uuid');
  if (existing) {
    db.getDb().prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(config), existing.id);
  } else {
    db.getDb().prepare("INSERT INTO settings (id, company_id, key, value) VALUES (?, ?, 'customization', ?)").run(uuid(), companyId, JSON.stringify(config));
  }
  return { success: true };
});
```

**Step 2: Build `Customize.tsx`** with sections:

- **Document Numbers**: per document type prefix + starting number (INV-1001, PO-001, BILL-001, etc.)
- **Date & Format**: date display (MM/DD/YYYY vs DD/MM/YYYY vs YYYY-MM-DD), currency position, decimal separator
- **Module Visibility**: checkbox list of all modules, unchecked modules hidden in sidebar
- **Email Templates**: textarea with variable token chips ({{client_name}}, {{invoice_number}}, {{due_date}}, {{company_name}}) for Invoice Email, Reminder, Debt Demand Letter
- **Departments & Job Titles**: tag input for company-defined lists used in Employee form dropdowns
- **Accent Color**: company-wide accent color (already exists for invoices — extend to all PDF exports)

**Step 3: Wire module visibility into App sidebar**

Read the customization setting on app load and filter the module list.

**Step 4: Add Customize tab to Settings, build, deploy, commit**
```bash
git commit -m "feat: global customization — document numbering, module visibility, email templates, date formats"
```

---

### Task 20: Final Integration Deploy

**Step 1: Full build**
```bash
cd "/Users/rmpgutah/Business Accounting Pro" && npm run build 2>&1 | tail -10
```

**Step 2: Full asar repack and codesign**
```bash
node_modules/.bin/asar extract "/Applications/Business Accounting Pro.app/Contents/Resources/app.asar" /tmp/bap-asar && cp -R dist/. /tmp/bap-asar/dist/ && node_modules/.bin/asar pack /tmp/bap-asar "/Applications/Business Accounting Pro.app/Contents/Resources/app.asar" --unpack-dir "node_modules/better-sqlite3" && bash scripts/codesign-mac.sh "/Applications/Business Accounting Pro.app" && rm -rf /tmp/bap-asar
```

**Step 3: Smoke test checklist**
- [ ] Payroll run on CA employee shows correct progressive bracket state tax (not 5%)
- [ ] Payroll run on TX employee shows $0 state tax
- [ ] 401k deduction reduces taxable gross before federal/state withholding
- [ ] PTO balance increases after a payroll run
- [ ] W-2 generates with correct Box 1 wages
- [ ] State Compliance dashboard shows active states
- [ ] Filing Calendar shows Q2 941 deadline
- [ ] Settlement offer creates a record with counter-offer capability
- [ ] Payment plan generates correct installment schedule
- [ ] Push garnishment creates a payroll deduction
- [ ] Custom field defined in Settings appears in Employee form
- [ ] Role change to "Collector" hides accounting modules
- [ ] Save View persists filter configuration

**Step 4: Final commit**
```bash
git add -A && git commit -m "feat: enterprise upgrade complete — payroll, taxes, debt collections, platform layer"
```

**Step 5: Update memory**

Save project memory noting enterprise upgrade is complete with 20 tasks across 4 phases.
