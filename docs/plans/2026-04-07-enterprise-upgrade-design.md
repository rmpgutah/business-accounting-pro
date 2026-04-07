# Enterprise Upgrade Design
**Date:** 2026-04-07
**Approach:** B + A — Depth-first module completion with shared platform infrastructure
**Scope:** Payroll, State Taxes, Debt Collections, Global Customization Layer

---

## Overview

Elevate Business Accounting Pro from functional to enterprise-grade across three core modules and the entire application platform. Each module is completed fully before moving to the next (Approach B), while shared infrastructure (State Tax Engine, Deduction Engine, RBAC) is built as a reusable platform layer (Approach A) that all modules consume.

**Module order:** Payroll → State Taxes → Debt Collections → Global Customization

---

## Module 1: Enterprise Payroll

### 1.1 State Tax Engine
- Replace hardcoded `STATE_TAX_RATE = 0.05` in `PayrollRunner.tsx` with a real calculation engine
- Seed `state_tax_rates` for all 50 states + DC, tax years 2024–2026
- Add `state_tax_brackets` migration table for 9 progressive-bracket states:
  - California (up to 13.3%), New York (up to 10.9%), Minnesota (up to 9.85%), Vermont, Oregon, New Jersey, Hawaii, Maine, Connecticut
- Flat-rate states: CO 4.4%, IL 4.95%, IN 3.15%, KY 4%, MI 4.25%, NC 4.5%, PA 3.07%, UT 4.65%
- Zero-income-tax states (return 0): FL, TX, NV, WA, WY, SD, AK, NH, TN
- State UI allowances from `employees.state_allowances` feed into progressive bracket calculation
- SUI/SUTA wage bases and rates per state
- SDI rates for CA, NJ, NY, HI, RI
- New IPC handlers: `payroll:state-tax-rate`, `payroll:seed-state-taxes`, `payroll:state-tax-summary`

### 1.2 Benefits & Deductions Engine
- Wire `employee_deductions` table fully into `PayrollRunner.tsx` (currently ignored entirely)
- Pre-tax deductions reduce taxable gross before federal/state withholding:
  - Health/Dental/Vision premiums
  - 401(k)/403(b) contributions with employer match tracking
  - HSA/FSA contributions
- Post-tax deductions applied after withholding:
  - Roth 401(k)
  - Garnishments (linked to Debt Collection module)
  - Custom deductions
- New **Deductions Manager** tab in Payroll module: assign, edit, activate/deactivate per employee
- Employer match tracking stored in `employee_deductions` and reported in payroll runs

### 1.3 PTO & Time-Off Accrual
- New DB tables: `pto_policies`, `pto_balances`, `pto_transactions`
- Policies: accrual rate (hours/pay period), cap, carry-over limit, available from date
- Balances update automatically on every processed payroll run
- **PTO Dashboard** sub-tab: per-employee balance, used YTD, accrued YTD, projected end-of-year
- PTO cash-out on termination (employee `end_date` set → calculate payout)
- PTO requests: request → manager approval → balance deducted
- New IPC handlers: `payroll:pto-policies`, `payroll:pto-balance`, `payroll:pto-request`, `payroll:pto-approve`

### 1.4 Tax Forms Generation
- **W-2**: Generated from YTD pay stub aggregates, all boxes populated (1–20 including state sections Box 15–17). Rendered as print-ready PDF via `print-templates.ts`
- **1099-NEC**: For `type = 'contractor'` employees, shows non-employee compensation, generates per contractor
- **Form 941**: Quarterly federal payroll tax summary — employer + employee FICA, federal income tax withheld, deposit schedule
- New **Tax Forms** tab in Payroll module with year/quarter selectors and bulk PDF generation
- New IPC handlers: `payroll:generate-w2`, `payroll:generate-1099`, `payroll:generate-941`

### 1.5 Payroll Journal Entry Automation
- `payroll:process` IPC currently posts no journal entries
- Every processed payroll run auto-posts a compound journal entry:
  - DR Salaries & Wages Expense (gross pay)
  - DR Payroll Tax Expense (employer FICA + FUTA + SUI)
  - CR Federal Withholding Payable
  - CR State Withholding Payable
  - CR Social Security Payable (employee + employer)
  - CR Medicare Payable (employee + employer)
  - CR Health Insurance Payable (employee premiums)
  - CR 401(k) Payable
  - CR Net Payroll Payable (net pay)
- Entry links to the payroll run ID for audit trail

### 1.6 Advanced Employee Profile
- Add to `employees` table: `department`, `job_title`, `cost_center_id`, `routing_number`, `account_number`, `account_type`, `emergency_contact_name`, `emergency_contact_phone`
- Direct deposit info stored (routing + account number) for ACH reference
- Cost center links to `dimensions` table for job costing
- Custom fields panel in `EmployeeForm` using `custom_fields` JSON column
- Department/job title dropdowns driven by company-defined lists in Settings

---

## Module 2: Enterprise State Taxes

### 2.1 State Tax Engine (Platform Layer)
- Singleton `StateTaxEngine` service in `src/main/services/StateTaxEngine.ts`
- Consumed by: Payroll runner, Tax dashboard, Tax reports, W-2 generation
- Methods: `getStateRate(state, grossPay, allowances, year)`, `getStateBrackets(state, year)`, `getSuiRate(state, year)`, `getSdiRate(state, year)`
- Falls back gracefully for unknown states (returns 0, logs warning)

### 2.2 State Tax Compliance Dashboard
- New sub-tab in Taxes module: **State Compliance**
- Per-state liability summary: withheld YTD vs. estimated owed vs. paid
- **Nexus Tracker**: which states you have employees/clients in, which trigger filing obligations
- **Multi-state apportionment**: revenue allocation calculator for businesses selling across states
- Quarterly payment status per state (due dates, amounts, paid/unpaid)

### 2.3 Filing Calendar
- New sub-tab: **Filing Calendar**
- All federal deadlines (941 quarterly, 940 annual, W-2/1099 Jan 31, etc.)
- All state deadlines for active states
- Status per deadline: Upcoming / Due Soon / Filed / Late
- Export calendar as PDF or iCal
- New IPC: `tax:filing-deadlines`, `tax:mark-filed`

### 2.4 State Tax Configuration UI
- New sub-tab in Tax Configuration: **State Rates**
- View all seeded state rates for the selected year
- Override any rate with company-specific negotiated rates
- Add local/city taxes (NYC 3.876%, Philadelphia 3.75%, etc.)
- SUI rate override per state (company experience rate may differ from default)

### 2.5 Tax Form Output
- State quarterly reconciliation reports (format varies by state, generate generic PDF)
- Annual state W-2 reconciliation summary
- Pull from `StateTaxEngine` and YTD pay stub aggregates

---

## Module 3: Enterprise Debt Collections

### 3.1 Settlement & Payment Plan Engine
- New DB tables: `debt_settlements`, `debt_payment_plans`, `debt_plan_installments`
- **Settlement workflow**: Create offer (lump sum or % of balance) → Counter-offer tracking with timestamps → Accept/Decline → Auto-update debt status and balance
- **Payment plan setup**: Define installment count, frequency (weekly/biweekly/monthly), start date → System generates installment schedule
- Automatic reminders on each installment due date (uses existing notification engine)
- **Breach detection**: missed installment → notification + optional auto-escalation to next pipeline stage
- Partial payment allocation: payments applied to fees → interest → principal (FIFO configurable)
- New IPC: `debt:create-settlement`, `debt:respond-settlement`, `debt:create-payment-plan`, `debt:record-plan-payment`, `debt:check-plan-status`

### 3.2 Collector Management
- `debts` table gets `assigned_collector_id` (references `users`)
- **Collector Dashboard** tab in Debt Collection module (visible to Admin/Manager only)
- Per-collector metrics: # assigned debts, total balance, contact attempts, promises to pay, recovery rate, avg days to collect
- Workload view: reassign debts via drag-and-drop or bulk select
- Activity feed per collector: all communications, payments, stage changes logged
- Collector performance report (printable PDF)

### 3.3 Cost Tracking & ROI
- New DB table: `debt_costs` (debt_id, category, description, amount, date, vendor)
- Cost categories: Legal Fees, Court Filing, Agency Commission, Skip Trace, Postage, Other
- Debt Detail shows: Gross Recovery, Total Costs, Net Recovery, ROI %
- Analytics tab gains **Cost vs. Recovery** chart and cost breakdown donut
- New IPC: `debt:add-cost`, `debt:cost-summary`

### 3.4 Cross-Module Garnishment Link
- In Debt Detail, when `current_stage = 'garnishment'`, show **Push to Payroll** button
- Creates `employee_deductions` record (type: garnishment, linked debt_id stored in notes/custom field)
- PayrollRunner displays garnishment source debt name alongside deduction
- Debt record shows real-time garnishment collection progress (amount collected vs. judgment)
- New IPC: `debt:push-garnishment-to-payroll`

### 3.5 Debtor Risk Scoring
- Algorithmic score (0–100) calculated on debt load/update:
  - Days delinquent (0–30 days: -10, 30–90: -25, 90–180: -40, 180+: -60)
  - Payment history (has made payments: +20, payment plan active: +15)
  - Dispute flags (-15 per active dispute)
  - Current stage (reminder: +10, garnishment: -30)
  - Amount vs. company median (>3x median: -10)
- Score stored on `debts` table (new `risk_score` column)
- Color-coded badge in DebtList and DebtDetail
- Portfolio heat map in Analytics: score distribution histogram
- New IPC: `debt:calculate-risk-score`, `debt:portfolio-risk-summary`

---

## Platform Layer A: Enterprise Customization

### A.1 Custom Fields UI Builder
- `custom_field_defs` and `saved_views` tables already in schema
- New **Custom Fields** section in Settings → Define fields for: Clients, Employees, Invoices, Debts, Expenses, Vendors
- Field types: Text, Number, Date, Dropdown (define options), Checkbox, Multi-select, URL
- Required flag, placeholder text, display order
- Fields render in collapsible **Custom Fields Panel** in every relevant form/detail view
- Values stored in existing `custom_fields TEXT DEFAULT '{}'` JSON column
- New IPC: `custom-fields:list`, `custom-fields:save`, `custom-fields:delete`

### A.2 Role-Based Access Control
- `user_companies.role` already exists but not enforced
- Roles and permissions matrix:
  - **Admin**: Full access including Settings, Users, all modules
  - **Manager**: All modules, no user management or Settings destructive actions
  - **Accountant**: Accounting modules (GL, Reports, AR/AP, Bank Recon), read-only Payroll
  - **Collector**: Debt Collection module only + related Clients
  - **Viewer**: Read-only access to all assigned modules
- React-level: `usePermissions()` hook gates component rendering
- IPC-level: permission check middleware on sensitive handlers
- **User & Permissions** panel in Settings: invite users, assign roles, deactivate
- New IPC: `auth:set-role`, `auth:get-permissions`

### A.3 Saved Views & Smart Filters
- `saved_views` table already exists
- Every list view (Invoices, Debts, Expenses, Employees, Clients, etc.) gets **Save View** button
- Persists: active filters, sort field/direction, column visibility, search query
- Saved views appear as quick-access chips above the list
- Personal (user-scoped) vs. Shared (company-scoped) views
- New IPC: `views:save`, `views:list`, `views:delete`

### A.4 Advanced Workflow Automation
- Expand existing `automation_rules` engine with cross-module triggers:
  - **Invoice overdue (N days) → Auto-create debt record**
  - **Payment plan installment missed → Escalate debt stage**
  - **Payroll processed → Post journal entry** (wired to 1.5)
  - **Employee end_date set → Flag open garnishments**
  - **Debt settled → Close linked invoice**
- New trigger types: time-based (X days after event), threshold-based (balance > $X), compound (A AND B)
- Visual automation builder: node-based rule editor replacing current list UI
- New IPC: `automations:available-triggers`, `automations:available-actions`, `automations:test-rule`

### A.5 Global Customization Settings
- Dedicated **Customize** tab in Settings:
  - **Document Numbers**: prefix, padding, starting number per document type (INV-, PO-, BILL-, etc.)
  - **Date & Number Format**: date display preference, currency symbol position, decimal separator
  - **Module Visibility**: toggle modules on/off in sidebar per company (hide unused modules)
  - **Company Branding**: accent color override, logo already handled in Invoice Settings — extend to all PDF outputs
  - **Email Templates**: full template editor with variable tokens (`{{client_name}}`, `{{invoice_number}}`, etc.)
  - **Department & Job Title Lists**: company-defined lists used in Employee dropdowns
- New IPC: `customize:get`, `customize:save`

---

## Database Migrations Required

```sql
-- Payroll
ALTER TABLE employees ADD COLUMN department TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN job_title TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN cost_center_id TEXT DEFAULT NULL;
ALTER TABLE employees ADD COLUMN routing_number TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN account_number TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN account_type TEXT DEFAULT 'checking';
ALTER TABLE employees ADD COLUMN emergency_contact_name TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN emergency_contact_phone TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS state_tax_brackets (...);
CREATE TABLE IF NOT EXISTS pto_policies (...);
CREATE TABLE IF NOT EXISTS pto_balances (...);
CREATE TABLE IF NOT EXISTS pto_transactions (...);

-- Debt Collection
ALTER TABLE debts ADD COLUMN assigned_collector_id TEXT DEFAULT NULL;
ALTER TABLE debts ADD COLUMN risk_score INTEGER DEFAULT NULL;

CREATE TABLE IF NOT EXISTS debt_settlements (...);
CREATE TABLE IF NOT EXISTS debt_payment_plans (...);
CREATE TABLE IF NOT EXISTS debt_plan_installments (...);
CREATE TABLE IF NOT EXISTS debt_costs (...);
```

---

## Implementation Order (Depth-First)

### Phase 1 — Enterprise Payroll
1. DB migrations (employee fields, state_tax_brackets, PTO tables)
2. Seed state_tax_rates + state_tax_brackets (all 50 states, 2024–2026)
3. StateTaxEngine service + IPC handlers
4. Wire deductions engine into PayrollRunner
5. PTO policies, balances, dashboard
6. Tax forms: W-2, 1099-NEC, Form 941
7. Payroll journal entry auto-posting
8. Advanced employee profile UI

### Phase 2 — Enterprise Taxes
1. StateTaxEngine already built in Phase 1 — wire to Tax module
2. State Compliance Dashboard
3. Filing Calendar
4. State Tax Configuration UI (local/city taxes, SUI overrides)
5. Tax form output from Tax module

### Phase 3 — Enterprise Debt Collections
1. DB migrations (settlements, payment plans, costs, collector fields, risk_score)
2. Settlement & payment plan engine + IPC
3. Collector management tab + dashboard
4. Cost tracking UI
5. Cross-module garnishment push
6. Risk scoring engine

### Phase 4 — Platform Layer
1. Custom fields UI builder + rendering in all modules
2. RBAC enforcement (React hooks + IPC middleware)
3. Saved views on all list screens
4. Advanced workflow automation builder
5. Global customization settings tab
