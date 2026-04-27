# Tax System — Full Production Overhaul

**Date**: 2026-04-27
**Scope**: Federal 2026 + Utah 2026 tax calculation, filing, compliance, and reporting

## Design Decisions

- **Database-driven tax engine** — all rates/brackets in DB, admin-editable, hardcoded fallback only
- **2020+ W-4 only** — Steps 2/3/4, no legacy allowances system
- **Utah rate**: 4.55% default, admin-overridable via settings
- **2026 projected values**: SS wage base $182,100, std deduction single $15,400, MFJ $30,800

---

## Section 1: Database Schema

### Employee W-4 Fields (ALTER TABLE employees)

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `w4_filing_status` | TEXT | 'single' | single / married / head_of_household |
| `w4_step2_checkbox` | INTEGER | 0 | Multiple jobs / spouse works |
| `w4_step3_dependent_credit` | REAL | 0 | Annual child/dependent credit |
| `w4_step4a_other_income` | REAL | 0 | Other income estimate |
| `w4_step4b_deductions` | REAL | 0 | Deductions beyond standard |
| `w4_step4c_extra_withholding` | REAL | 0 | Additional withholding per period |
| `ut_exemptions` | INTEGER | 1 | Utah personal exemptions |
| `ut_additional_withholding` | REAL | 0 | Extra UT withholding per period |
| `w4_received_date` | TEXT | NULL | Compliance: date W-4 received |

### tax_config Table (NEW)

```sql
CREATE TABLE IF NOT EXISTS tax_config (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  config_key TEXT NOT NULL,
  config_value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, tax_year, config_key)
);
```

Stores: federal brackets (JSON), FICA rates, standard deductions, Utah flat rate, SUI rate, WC rate, FUTA rates.

### tax_filing_periods Table (NEW)

```sql
CREATE TABLE IF NOT EXISTS tax_filing_periods (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  form_type TEXT NOT NULL,
  status TEXT DEFAULT 'not_filed',
  filed_date TEXT,
  confirmation_number TEXT,
  amount_due REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, tax_year, quarter, form_type)
);
```

### Seed Data

2026 projected values inserted on first access: 7 federal bracket sets (single, married, HoH), FICA rates, Utah 4.55%, SUI 1.20%, FUTA 6.0%/5.4% credit.

---

## Section 2: Tax Calculation Engine

New service: `src/main/services/TaxCalculationEngine.ts`

### Methods

**`calculateFederalWithholding(gross, payFrequency, w4Fields)`**
- IRS Publication 15-T, 2020+ W-4 Percentage Method
- Steps: annualize gross, subtract std deduction (adjusted for Step 4b), apply bracket table, add Step 4a, subtract Step 3 credit, add Step 4c, de-annualize
- Step 2 checkbox halves bracket thresholds

**`calculateUtahWithholding(gross, payFrequency, utExemptions, utAdditional)`**
- TC-40W: `(gross_annualized * flat_rate) - (exemptions * credit_per_exemption)`
- De-annualize, add additional withholding

**`calculateFICA(gross, ytdGross)`**
- SS: 6.2% on wages up to $182,100 (handles mid-year cap crossing)
- Medicare: 1.45% on all wages + 0.9% surtax above $200,000
- Returns employee and employer portions separately
- FUTA: 6.0% - 5.4% credit = 0.6% net on first $7,000 per employee

**`calculateSUI(gross, ytdGross)`**
- Utah SUI rate from DB on wages up to wage base

**`calculateFullPayroll(employee, gross, payFrequency, ytdGross)`**
- Orchestrator: calls all above methods, returns complete tax breakdown object

### Integration

PayrollRunner calls `calculateFullPayroll()` instead of inline tax math. Engine reads all rates from DB via `tax:get-config`, falls back to hardcoded `tax-brackets.ts` if DB empty.

---

## Section 3: Settings UI

### Federal Tax Configuration Card (Settings module)

- Editable: standard deductions, FICA rates/thresholds, tax brackets per filing status
- Inline bracket editor with Add/Remove rows
- "Reset to Defaults" repopulates 2026 projected values
- Persists via `tax:save-config` IPC handler

### Utah State Tax Card (Settings module)

- Flat withholding rate (default 4.55%)
- Personal exemption credit ($393)
- SUI rate + wage base (employer-specific)
- Workers' comp rate + classification code

### Employee W-4 Section (EmployeeForm.tsx)

- Filing status radio buttons
- Step 2/3/4 fields matching W-4 form
- Utah exemptions + additional withholding
- W-4 received date for compliance

---

## Section 4: Tax Filing & Compliance

### Quarterly Filing Dashboard

- Auto-computes 941 and TC-941 line items from `pay_stubs` data
- Status tracking: Not Filed, In Progress, Filed, Overdue
- "Record Payment" logs confirmation number + amount to `tax_filing_periods`
- Due date engine computes deadlines (last day of month following quarter end)

### Form Preview / Print

- 941 worksheet: matches IRS line items (Lines 1-14), HTML print template
- TC-941 worksheet: Utah-specific line items
- Prominent disclaimer: "WORKSHEET ONLY — File official forms via IRS/Utah"

### Annual Filing (W-2 / W-3)

- W-2 preparation: per-employee annual aggregation from `pay_stubs`
- Box mapping: Box 1 (wages - pretax), Box 2 (fed W/H), Box 3/5 (SS/Med wages), Box 4/6 (SS/Med tax), Box 16/17 (state)
- W-3 auto-sums all W-2s for SSA transmittal
- Print layout matches W-2 Copy B format

### FUTA Tracking

- Quarterly accumulation against $500 deposit threshold
- Annual 940 due January 31 of following year
- Per-employee $7,000 wage base tracking

---

## Section 5: Tax Reporting & Dashboards

### Tax Dashboard (Default landing view)

- 4 KPI cards: YTD Payroll, YTD Federal Tax, YTD State Tax, YTD FICA
- Prior-year comparison when data exists
- Upcoming deadlines list sorted by urgency (color-coded)
- Quarterly tax liability bar chart (CSS-rendered, no library)
- Filing status grid (form x quarter matrix)

### Tax Liability Report (Printable)

- Period selector (quarter range)
- Per-tax-type breakdown: Federal W/H, SS (EE+ER), Medicare (EE+ER), Addl Medicare, Utah W/H, SUI, WC, FUTA
- Current period + YTD columns
- Employee vs employer portion split
- Uses existing `reportHeader()`/`reportFooter()` template system

### Employee Tax Summary Report

- Per-employee breakdown with effective rate calculations
- Expandable detail: W-4 info, SS wage remaining, effective rates
- Filterable by employee, printable

### Tax Module Navigation

Sub-tabs: Dashboard | Filing & Compliance | Reports

---

## Files Modified/Created

### Existing Files (8)

1. `src/main/database/index.ts` — migrations (W-4 cols, tax_config, tax_filing_periods, seed data)
2. `src/main/ipc/index.ts` — 9 new handlers
3. `src/renderer/lib/api.ts` — 9 new methods
4. `src/renderer/modules/settings/index.tsx` — Federal + Utah tax config cards
5. `src/renderer/modules/payroll/EmployeeForm.tsx` — W-4 fields section
6. `src/renderer/modules/payroll/PayrollRunner.tsx` — delegate to TaxCalculationEngine
7. `src/renderer/App.tsx` — add 'tax' module
8. `src/renderer/components/Sidebar.tsx` — add Tax nav item

### New Files (6)

1. `src/main/services/TaxCalculationEngine.ts` — calculation engine
2. `src/renderer/modules/tax/index.tsx` — Tax module with sub-tabs
3. `src/renderer/modules/tax/TaxDashboard.tsx` — KPI + charts + deadlines
4. `src/renderer/modules/tax/TaxFiling.tsx` — quarterly/annual filing
5. `src/renderer/modules/tax/TaxReports.tsx` — liability + employee reports
6. `src/renderer/modules/tax/tax-forms.ts` — 941/TC-941/W-2/W-3 print templates

### IPC Handlers (9)

| Handler | Purpose |
|---------|---------|
| `tax:get-config` | Read tax config for year |
| `tax:save-config` | Upsert batch config |
| `tax:get-filing-summary` | Computed 941/TC-941 from pay_stubs |
| `tax:record-filing` | Log filing date + confirmation |
| `tax:get-w2-data` | Per-employee annual aggregation |
| `tax:get-w3-data` | W-3 transmittal totals |
| `tax:dashboard-summary` | KPI + deadlines + filing grid |
| `tax:liability-report` | Per-tax breakdown for period |
| `tax:employee-tax-summary` | Per-employee with effective rates |
