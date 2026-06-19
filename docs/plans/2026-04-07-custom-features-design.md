# Custom Features Expansion Design

**Date:** 2026-04-07
**Approach:** C — Two parallel tracks
**Scope:** Data Entry Expansion, Debt Collection Enrichment + PDFs, Analytics Upgrades, Enterprise Foundations

---

## Overview

Two parallel implementation tracks:

**Track 1 (self-contained, high-visibility):**
- Expanded data entry for Employees, Clients, Vendors
- Debt collection enrichment (debtor profile, communication log, promise-to-pay, legal actions, aging badges)
- Debt Portfolio PDF report + formal Demand Letter PDF

**Track 2 (analytics + enterprise foundations):**
- KPI Dashboard upgrade (revenue/expense chart, AR aging donut, cash flow trend, top clients, financial health score)
- State Tax Engine (all 50 states, brackets, SDI)
- Benefits & Deductions Engine (pre-tax/post-tax, employer match)
- PTO & Accrual (policies, balances, transactions)

---

## Track 1

### 1.1 Employee Data Entry Expansion

New fields in `employees` table (via migrations):
```sql
ALTER TABLE employees ADD COLUMN employment_type TEXT DEFAULT 'full-time';
ALTER TABLE employees ADD COLUMN start_date TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN end_date TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN department TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN job_title TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN emergency_contact_name TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN emergency_contact_phone TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN routing_number TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN account_number TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN account_type TEXT DEFAULT 'checking';
ALTER TABLE employees ADD COLUMN notes TEXT DEFAULT '';
```

`EmployeeForm` gains tabbed layout:
- **General** — name, SSN, pay type, rate (existing)
- **HR** — employment type, department, job title, start/end date, notes
- **Emergency & Banking** — emergency contact, direct deposit fields
- **Custom Fields** — collapsible JSON panel using existing `custom_fields` column

### 1.2 Client Data Entry Expansion

New fields in `clients` table:
```sql
ALTER TABLE clients ADD COLUMN industry TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN website TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN company_size TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT 0;
ALTER TABLE clients ADD COLUMN preferred_payment_method TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN assigned_rep_id TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN internal_notes TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN tags TEXT DEFAULT '[]';
```

New `client_contacts` table (multiple contacts per client):
```sql
CREATE TABLE IF NOT EXISTS client_contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  title TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  is_primary INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

`ClientForm` / `ClientDetail` gains:
- Profile section: industry, website, company size, credit limit, preferred payment, assigned rep
- **Contacts** sub-section: add/edit/remove multiple contacts, mark one as primary
- Internal notes + tags (comma-separated chips)
- Custom Fields panel

### 1.3 Vendor Data Entry Expansion

New fields in `vendors` table:
```sql
ALTER TABLE vendors ADD COLUMN w9_status TEXT DEFAULT 'not_collected';
ALTER TABLE vendors ADD COLUMN is_1099_eligible INTEGER DEFAULT 0;
ALTER TABLE vendors ADD COLUMN ach_routing TEXT DEFAULT '';
ALTER TABLE vendors ADD COLUMN ach_account TEXT DEFAULT '';
ALTER TABLE vendors ADD COLUMN ach_account_type TEXT DEFAULT 'checking';
ALTER TABLE vendors ADD COLUMN contract_start TEXT DEFAULT '';
ALTER TABLE vendors ADD COLUMN contract_end TEXT DEFAULT '';
ALTER TABLE vendors ADD COLUMN contract_notes TEXT DEFAULT '';
```

`VendorForm` gains:
- **Compliance** — W-9 status dropdown (not_collected/collected/on_file), 1099 eligible toggle, tax ID (existing)
- **Banking** — ACH routing, account, account type
- **Contract** — contract start/end dates, contract notes
- Custom Fields panel

### 1.4 Debt Collection Enrichment

New fields on `debts` table:
```sql
ALTER TABLE debts ADD COLUMN employer_name TEXT DEFAULT '';
ALTER TABLE debts ADD COLUMN employment_status TEXT DEFAULT 'unknown';
ALTER TABLE debts ADD COLUMN monthly_income_estimate REAL DEFAULT 0;
ALTER TABLE debts ADD COLUMN best_contact_time TEXT DEFAULT '';
ALTER TABLE debts ADD COLUMN debtor_attorney_name TEXT DEFAULT '';
ALTER TABLE debts ADD COLUMN debtor_attorney_phone TEXT DEFAULT '';
```

New fields on `debt_communications` table:
```sql
ALTER TABLE debt_communications ADD COLUMN outcome TEXT DEFAULT '';
ALTER TABLE debt_communications ADD COLUMN next_action TEXT DEFAULT '';
ALTER TABLE debt_communications ADD COLUMN next_action_date TEXT DEFAULT '';
ALTER TABLE debt_communications ADD COLUMN promise_amount REAL DEFAULT 0;
ALTER TABLE debt_communications ADD COLUMN promise_date TEXT DEFAULT '';
```

New `debt_promises` table:
```sql
CREATE TABLE IF NOT EXISTS debt_promises (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  promised_date TEXT NOT NULL DEFAULT '',
  promised_amount REAL NOT NULL DEFAULT 0,
  kept INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

UI changes:
- **DebtForm** gains Debtor Profile section (employer, employment status, income estimate, best contact time, debtor attorney)
- **Communication log** form adds outcome dropdown + next action + promise fields
- **Promise-to-Pay timeline** in DebtDetail: chronological list with kept/broken badges
- **Aging badge** on DebtList cards and DebtDetail header: 0–30 (green), 31–90 (yellow), 91–180 (orange), 180+ (red) — calculated from `date_of_delinquency`

### 1.5 Debt Collection PDFs

Two new functions in `print-templates.ts`:

**`generateDebtPortfolioReportHTML(debts, payments, company)`**
- Company letterhead header with generation date
- Summary stats: total accounts, total balance, total collected YTD, recovery rate
- Aging buckets table: 0–30 / 31–90 / 91–180 / 180+ — count and dollar value
- Pipeline stage breakdown table
- Top 10 largest debts table (debtor, balance, days delinquent, stage, assigned collector)
- Collector performance table (debts assigned, collected YTD, rate)

**`generateDemandLetterHTML(debt, payments, company, options)`**
- options: `{ deadline_days: number, payment_address: string, online_payment_url: string, signatory_name: string, signatory_title: string }`
- Formal letterhead: company logo, address, date
- RE line: "Account #DEBT-001 — Balance Due: $X,XXX.XX"
- Account summary paragraph (original amount, opened date, current balance)
- Payment history table (date, amount, method, reference)
- Outstanding balance box (bold, large font)
- Formal demand paragraph with deadline date
- Payment instructions block
- Consequences paragraph
- Signature block

Both accessible via buttons in DebtDetail. Portfolio report via button in DebtList header.

IPC handlers: `debt:portfolio-report-data`, `debt:demand-letter-data`

---

## Track 2

### 2.1 Analytics Dashboard Upgrades

All charts rendered as inline SVG — no external dependencies.

**New widgets added to KPI Dashboard:**

| Widget | Data source | Chart type |
|---|---|---|
| Revenue vs Expenses | `invoices` + `expenses` grouped by month | SVG grouped bar (12mo rolling) |
| AR Aging | `invoices` WHERE status IN (sent/overdue/partial) | SVG donut |
| Cash Flow Trend | Revenue minus expenses per month | SVG line chart |
| Top Clients by Revenue | `invoices` grouped by client_id | Horizontal bar list |
| Financial Health Score | Composite calculation | Large score badge |
| Outstanding Summary | Unpaid invoices count + amount | Stat cards |

**Financial Health Score formula:**
- AR Collection Rate: (paid invoices / total invoiced) × 30 pts
- Expense Ratio: (1 - expenses/revenue) × 25 pts, capped
- Overdue Rate: (1 - overdue count / total sent) × 25 pts
- DSO: scored on Days Sales Outstanding (< 30 days = full 20 pts)
- Total: 0–100. 80+ = Healthy (green), 60–79 = Watch (yellow), < 60 = At Risk (red)

New IPC handlers: `analytics:dashboard-data` — returns all chart data in one query batch.

SVG chart helpers extracted to `src/renderer/lib/charts.ts`:
- `barChart(data, options)` → SVG string
- `donutChart(segments, options)` → SVG string
- `lineChart(points, options)` → SVG string

### 2.2 State Tax Engine

New file: `src/main/services/StateTaxEngine.ts`

```typescript
class StateTaxEngine {
  getStateRate(state: string, grossPay: number, allowances: number, year: number): number
  getStateBrackets(state: string, year: number): StateTaxBracket[]
  getSuiRate(state: string, year: number): number
  getSdiRate(state: string, year: number): number
}
```

State categories:
- **Zero-tax states** (FL, TX, NV, WA, WY, SD, AK, NH, TN): return 0
- **Flat-rate states** (CO 4.4%, IL 4.95%, IN 3.15%, KY 4%, MI 4.25%, NC 4.5%, PA 3.07%, UT 4.65%): simple lookup
- **Progressive-bracket states** (CA, NY, MN, VT, OR, NJ, HI, ME, CT): bracket calc from `state_tax_brackets` table
- All others: fallback to 0 with warning log

New DB table:
```sql
CREATE TABLE IF NOT EXISTS state_tax_brackets (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  year INTEGER NOT NULL,
  min_income REAL NOT NULL,
  max_income REAL,
  rate REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

Seeded at app startup via `seedStateTaxData()` (idempotent).

Replaces `STATE_TAX_RATE = 0.05` in `PayrollRunner.tsx`.

New IPC: `payroll:state-tax-rate`, `payroll:seed-state-taxes`

### 2.3 Benefits & Deductions Engine

Fully wires `employee_deductions` table (already in schema) into `PayrollRunner.tsx`:

**Pre-tax deductions** (reduce taxable gross before federal/state withholding):
- Health/Dental/Vision premiums
- 401(k) / 403(b) contributions
- HSA / FSA contributions

**Post-tax deductions** (applied after withholding):
- Roth 401(k)
- Garnishments (linked to debt collection)
- Custom deductions

New **Deductions Manager** tab in Payroll module:
- List all deductions per employee
- Add/edit: type, amount or %, pre/post-tax, active toggle, employer match %
- Employer match tracked separately in `employee_deductions.employer_match`

New field on `employee_deductions`:
```sql
ALTER TABLE employee_deductions ADD COLUMN employer_match REAL DEFAULT 0;
ALTER TABLE employee_deductions ADD COLUMN employer_match_type TEXT DEFAULT 'percent';
```

### 2.4 PTO & Accrual

New DB tables:
```sql
CREATE TABLE IF NOT EXISTS pto_policies (
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
);

CREATE TABLE IF NOT EXISTS pto_balances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL REFERENCES pto_policies(id),
  balance_hours REAL NOT NULL DEFAULT 0,
  used_hours_ytd REAL NOT NULL DEFAULT 0,
  accrued_hours_ytd REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pto_transactions (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'accrual',
  hours REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  payroll_run_id TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**PTO Dashboard** sub-tab in Payroll:
- Per-employee table: name, policy, balance, used YTD, accrued YTD, projected year-end
- Manual adjustment button (manager override)
- PTO cash-out on termination: when `end_date` set → calculate payout at hourly rate

Balances auto-update on every `payroll:process` call.

New IPC: `payroll:pto-policies`, `payroll:pto-balance`, `payroll:pto-adjust`

---

## Database Migrations Summary

```sql
-- Track 1: Data entry
ALTER TABLE employees ADD COLUMN employment_type TEXT DEFAULT 'full-time';
ALTER TABLE employees ADD COLUMN start_date TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN end_date TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN department TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN job_title TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN emergency_contact_name TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN emergency_contact_phone TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN routing_number TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN account_number TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN account_type TEXT DEFAULT 'checking';
ALTER TABLE employees ADD COLUMN notes TEXT DEFAULT '';

ALTER TABLE clients ADD COLUMN industry TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN website TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN company_size TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT 0;
ALTER TABLE clients ADD COLUMN preferred_payment_method TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN assigned_rep_id TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN internal_notes TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN tags TEXT DEFAULT '[]';

CREATE TABLE IF NOT EXISTS client_contacts (...);

ALTER TABLE vendors ADD COLUMN w9_status TEXT DEFAULT 'not_collected';
ALTER TABLE vendors ADD COLUMN is_1099_eligible INTEGER DEFAULT 0;
ALTER TABLE vendors ADD COLUMN ach_routing TEXT DEFAULT '';
ALTER TABLE vendors ADD COLUMN ach_account TEXT DEFAULT '';
ALTER TABLE vendors ADD COLUMN ach_account_type TEXT DEFAULT 'checking';
ALTER TABLE vendors ADD COLUMN contract_start TEXT DEFAULT '';
ALTER TABLE vendors ADD COLUMN contract_end TEXT DEFAULT '';
ALTER TABLE vendors ADD COLUMN contract_notes TEXT DEFAULT '';

ALTER TABLE debts ADD COLUMN employer_name TEXT DEFAULT '';
ALTER TABLE debts ADD COLUMN employment_status TEXT DEFAULT 'unknown';
ALTER TABLE debts ADD COLUMN monthly_income_estimate REAL DEFAULT 0;
ALTER TABLE debts ADD COLUMN best_contact_time TEXT DEFAULT '';
ALTER TABLE debts ADD COLUMN debtor_attorney_name TEXT DEFAULT '';
ALTER TABLE debts ADD COLUMN debtor_attorney_phone TEXT DEFAULT '';

ALTER TABLE debt_communications ADD COLUMN outcome TEXT DEFAULT '';
ALTER TABLE debt_communications ADD COLUMN next_action TEXT DEFAULT '';
ALTER TABLE debt_communications ADD COLUMN next_action_date TEXT DEFAULT '';
ALTER TABLE debt_communications ADD COLUMN promise_amount REAL DEFAULT 0;
ALTER TABLE debt_communications ADD COLUMN promise_date TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS debt_promises (...);

-- Track 2: Enterprise
ALTER TABLE employee_deductions ADD COLUMN employer_match REAL DEFAULT 0;
ALTER TABLE employee_deductions ADD COLUMN employer_match_type TEXT DEFAULT 'percent';

CREATE TABLE IF NOT EXISTS state_tax_brackets (...);
CREATE TABLE IF NOT EXISTS pto_policies (...);
CREATE TABLE IF NOT EXISTS pto_balances (...);
CREATE TABLE IF NOT EXISTS pto_transactions (...);
```

---

## Files to Create / Modify

### New Files
- `src/main/services/StateTaxEngine.ts`
- `src/renderer/lib/charts.ts` — SVG chart helpers
- `src/renderer/modules/employees/EmployeeForm.tsx` (tabbed, if not already split)
- `src/renderer/modules/clients/ClientContacts.tsx` — multi-contact sub-component
- `src/renderer/modules/payroll/DeductionsManager.tsx`
- `src/renderer/modules/payroll/PtoDashboard.tsx`

### Modified Files
- `src/main/database/index.ts` — all migrations above
- `src/main/ipc/index.ts` — new IPC handlers (analytics, debt PDFs, state tax, PTO)
- `src/renderer/lib/api.ts` — new API methods
- `src/renderer/lib/print-templates.ts` — portfolio report + demand letter
- `src/renderer/modules/employees/EmployeeForm.tsx` — expanded fields
- `src/renderer/modules/clients/ClientForm.tsx` + `ClientDetail.tsx`
- `src/renderer/modules/vendors/VendorForm.tsx`
- `src/renderer/modules/debt-collection/DebtForm.tsx` + `DebtDetail.tsx` + `DebtList.tsx`
- `src/renderer/modules/kpi/KpiDashboard.tsx` — full analytics upgrade
- `src/main/services/PayrollRunner.tsx` — wire StateTaxEngine + deductions + PTO

---

## Implementation Order

### Track 1
1. DB migrations (all Track 1 tables/columns)
2. `tablesWithoutUpdatedAt` / `tablesWithoutCompanyId` set updates
3. Employee form expansion (tabbed layout, new fields)
4. Client form expansion (new fields + `ClientContacts` sub-component + IPC)
5. Vendor form expansion (new fields)
6. Debt enrichment fields (debtor profile, communication outcome, promise-to-pay)
7. `debt_promises` table + Promise-to-Pay timeline in DebtDetail
8. Aging badge on DebtList + DebtDetail
9. `generateDebtPortfolioReportHTML` in print-templates + IPC + UI button
10. `generateDemandLetterHTML` in print-templates + IPC + UI button in DebtDetail

### Track 2
1. DB migrations (state_tax_brackets, pto tables, employee_deductions additions)
2. `StateTaxEngine.ts` + seed data for all 50 states
3. Wire StateTaxEngine into PayrollRunner
4. Deductions engine: pre-tax/post-tax wired into PayrollRunner
5. `DeductionsManager.tsx` tab in Payroll module
6. PTO tables + `PtoDashboard.tsx` + auto-accrue on payroll:process
7. `src/renderer/lib/charts.ts` SVG helpers
8. `analytics:dashboard-data` IPC handler
9. KPI Dashboard full upgrade with all new widgets
