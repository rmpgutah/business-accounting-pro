# Tax System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully operational tax system with database-driven calculation engine, W-4 support, Utah/Federal withholding, filing compliance (941/TC-941/W-2/W-3), and reporting dashboards.

**Architecture:** Database-driven tax engine (`TaxCalculationEngine` service in main process) reads all rates from `federal_payroll_constants` + new `utah_withholding_config` + `tax_filing_periods` tables. PayrollRunner delegates to engine. New Tax module with 3 sub-tabs (Dashboard, Filing, Reports). Settings gains Federal/Utah config cards. EmployeeForm gains W-4 fields.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, Tailwind CSS, Lucide icons

**Design Doc:** `docs/plans/2026-04-27-tax-system-design.md`

---

## Task 1: Database Migrations — Employee W-4 Fields

**Files:**
- Modify: `src/main/database/index.ts` (migrations array, ~line 51+)

**Step 1: Add W-4 column migrations to the migrations array**

Add these lines to the `migrations` array (after the last existing migration):

```typescript
// Tax System (2026-04-27) — Employee W-4 fields for 2020+ W-4
"ALTER TABLE employees ADD COLUMN w4_filing_status TEXT DEFAULT 'single'",
"ALTER TABLE employees ADD COLUMN w4_step2_checkbox INTEGER DEFAULT 0",
"ALTER TABLE employees ADD COLUMN w4_step3_dependent_credit REAL DEFAULT 0",
"ALTER TABLE employees ADD COLUMN w4_step4a_other_income REAL DEFAULT 0",
"ALTER TABLE employees ADD COLUMN w4_step4b_deductions REAL DEFAULT 0",
"ALTER TABLE employees ADD COLUMN w4_step4c_extra_withholding REAL DEFAULT 0",
"ALTER TABLE employees ADD COLUMN ut_exemptions INTEGER DEFAULT 1",
"ALTER TABLE employees ADD COLUMN ut_additional_withholding REAL DEFAULT 0",
"ALTER TABLE employees ADD COLUMN w4_received_date TEXT DEFAULT ''",
```

**Step 2: Verify by running `npx tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: No new errors related to database/index.ts

**Step 3: Commit**

```bash
git add src/main/database/index.ts
git commit -m "feat(tax): add employee W-4 column migrations for 2020+ form"
```

---

## Task 2: Database Migrations — Utah Config & Filing Tables

**Files:**
- Modify: `src/main/database/index.ts` (migrations array)
- Modify: `src/main/database/index.ts` (`tablesWithoutUpdatedAt` set, ~line 1322)

**Step 1: Add CREATE TABLE statements to migrations array**

```typescript
// Tax System (2026-04-27) — Utah withholding config
`CREATE TABLE IF NOT EXISTS utah_withholding_config (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  flat_rate REAL NOT NULL DEFAULT 0.0455,
  personal_exemption_credit REAL NOT NULL DEFAULT 393,
  sui_rate REAL NOT NULL DEFAULT 0.012,
  sui_wage_base REAL NOT NULL DEFAULT 44800,
  wc_rate REAL NOT NULL DEFAULT 0.008,
  wc_class_code TEXT DEFAULT '8810',
  wc_carrier TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, tax_year)
)`,
// Tax System (2026-04-27) — Tax filing period tracking
`CREATE TABLE IF NOT EXISTS tax_filing_periods (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  form_type TEXT NOT NULL,
  status TEXT DEFAULT 'not_filed',
  filed_date TEXT DEFAULT '',
  confirmation_number TEXT DEFAULT '',
  amount_due REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  payment_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, tax_year, quarter, form_type)
)`,
```

**Step 2: Add `tax_filing_periods` to `tablesWithoutCompanyId` in `src/main/ipc/index.ts`**

This table HAS company_id in its schema, so do NOT add it. But it IS created via custom handlers, not generic CRUD, so this is fine as-is.

**Step 3: Verify**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/main/database/index.ts
git commit -m "feat(tax): add utah_withholding_config and tax_filing_periods tables"
```

---

## Task 3: Tax Calculation Engine — Core Service

**Files:**
- Create: `src/main/services/TaxCalculationEngine.ts`

**Step 1: Create the TaxCalculationEngine service**

This file lives alongside existing services (`pdf-generator.ts`, `email-sender.ts`, etc.) at `src/main/services/TaxCalculationEngine.ts`.

```typescript
import * as db from '../database';
import { roundCents } from '../database';

// ─── Types ──────────────────────────────────────────────
export interface W4Fields {
  w4_filing_status: 'single' | 'married' | 'head_of_household';
  w4_step2_checkbox: boolean;
  w4_step3_dependent_credit: number;
  w4_step4a_other_income: number;
  w4_step4b_deductions: number;
  w4_step4c_extra_withholding: number;
}

export interface UtahFields {
  ut_exemptions: number;
  ut_additional_withholding: number;
}

export interface FICAResult {
  ss_employee: number;
  ss_employer: number;
  medicare_employee: number;
  medicare_employer: number;
  additional_medicare: number;
  futa: number;
}

export interface FullTaxResult {
  federal_withholding: number;
  utah_withholding: number;
  ss_employee: number;
  ss_employer: number;
  medicare_employee: number;
  medicare_employer: number;
  additional_medicare: number;
  futa: number;
  sui: number;
  total_employee_tax: number;
  total_employer_tax: number;
}

interface Bracket {
  bracket_min: number;
  bracket_max: number | null;
  rate: number;
}

interface FedConstants {
  ss_wage_base: number;
  ss_rate: number;
  medicare_rate: number;
  medicare_additional_rate: number;
  medicare_additional_threshold_single: number;
  medicare_additional_threshold_married: number;
  futa_rate: number;
  futa_wage_base: number;
  standard_deduction_single: number;
  standard_deduction_married: number;
  standard_deduction_hoh: number;
}

// ─── Fallback Constants (2026 projected) ────────────────
const FALLBACK_2026: FedConstants = {
  ss_wage_base: 182100,
  ss_rate: 0.062,
  medicare_rate: 0.0145,
  medicare_additional_rate: 0.009,
  medicare_additional_threshold_single: 200000,
  medicare_additional_threshold_married: 250000,
  futa_rate: 0.006,
  futa_wage_base: 7000,
  standard_deduction_single: 15400,
  standard_deduction_married: 30800,
  standard_deduction_hoh: 23100,
};

const PAY_PERIODS_MAP: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

// ─── Helpers ────────────────────────────────────────────
function getConstants(year: number): FedConstants {
  try {
    const dbInstance = db.getDb();
    const row = dbInstance.prepare(
      'SELECT * FROM federal_payroll_constants WHERE tax_year = ?'
    ).get(year) as any;
    if (row) return row as FedConstants;
  } catch (_) {}
  return FALLBACK_2026;
}

function getBrackets(year: number, filingStatus: string): Bracket[] {
  try {
    const dbInstance = db.getDb();
    // Map W-4 filing status to DB filing status
    const dbStatus = filingStatus === 'married' ? 'married_jointly' : filingStatus;
    const rows = dbInstance.prepare(
      'SELECT bracket_min, bracket_max, rate FROM federal_tax_brackets WHERE tax_year = ? AND filing_status = ? ORDER BY bracket_min'
    ).all(year, dbStatus) as Bracket[];
    if (rows.length > 0) return rows;
  } catch (_) {}
  // Fallback: 2026 projected single brackets
  return [
    { bracket_min: 0, bracket_max: 12250, rate: 0.10 },
    { bracket_min: 12250, bracket_max: 49800, rate: 0.12 },
    { bracket_min: 49800, bracket_max: 106200, rate: 0.22 },
    { bracket_min: 106200, bracket_max: 202750, rate: 0.24 },
    { bracket_min: 202750, bracket_max: 257500, rate: 0.32 },
    { bracket_min: 257500, bracket_max: 643750, rate: 0.35 },
    { bracket_min: 643750, bracket_max: null, rate: 0.37 },
  ];
}

function getUtahConfig(companyId: string, year: number): {
  flat_rate: number;
  personal_exemption_credit: number;
  sui_rate: number;
  sui_wage_base: number;
} {
  try {
    const dbInstance = db.getDb();
    const row = dbInstance.prepare(
      'SELECT * FROM utah_withholding_config WHERE company_id = ? AND tax_year = ?'
    ).get(companyId, year) as any;
    if (row) return row;
  } catch (_) {}
  return { flat_rate: 0.0455, personal_exemption_credit: 393, sui_rate: 0.012, sui_wage_base: 44800 };
}

// ─── Engine ─────────────────────────────────────────────

/**
 * IRS Publication 15-T (2020+ W-4) Percentage Method.
 *
 * 1. Annualize the per-period gross.
 * 2. Subtract the standard deduction (adjusted for Step 4b).
 * 3. Add Step 4a (other income).
 * 4. Apply bracket table.
 * 5. Subtract Step 3 (dependent credit).
 * 6. Add Step 4c (extra withholding).
 * 7. De-annualize back to per-period.
 *
 * Step 2 checkbox: If checked, use the "Higher Withholding Rate
 * Schedule" (effectively halved bracket thresholds). We approximate
 * this by doubling the annualized taxable income for bracket lookup,
 * then halving the result — equivalent to the IRS Step 2 adjustment.
 */
export function calculateFederalWithholding(
  grossPerPeriod: number,
  payFrequency: string,
  w4: W4Fields,
  year: number = 2026,
): number {
  const periods = PAY_PERIODS_MAP[payFrequency] ?? 26;
  const constants = getConstants(year);
  const brackets = getBrackets(year, w4.w4_filing_status);

  // Step 1: Annualize
  const annualGross = grossPerPeriod * periods;

  // Step 2: Adjusted annual wage
  const stdDeduction = w4.w4_filing_status === 'married'
    ? constants.standard_deduction_married
    : w4.w4_filing_status === 'head_of_household'
      ? constants.standard_deduction_hoh
      : constants.standard_deduction_single;

  // Step 4b reduces the standard deduction effect
  const effectiveDeduction = Math.max(0, stdDeduction - w4.w4_step4b_deductions);
  let adjustedAnnualWage = annualGross - effectiveDeduction + w4.w4_step4a_other_income;
  adjustedAnnualWage = Math.max(0, adjustedAnnualWage);

  // Step 2 checkbox: double the wage for bracket lookup, halve result
  const step2Multiplier = w4.w4_step2_checkbox ? 2 : 1;
  const lookupWage = adjustedAnnualWage * (w4.w4_step2_checkbox ? 1 : 1); // No doubling needed for percentage method
  // Actually for 2020+ percentage method, Step 2 checkbox uses Table 1a vs 1b
  // We approximate by halving bracket thresholds (same effect)
  const bracketDivisor = w4.w4_step2_checkbox ? 2 : 1;

  // Apply brackets
  let annualTax = 0;
  for (const bracket of brackets) {
    const adjMin = bracket.bracket_min / bracketDivisor;
    const adjMax = bracket.bracket_max !== null ? bracket.bracket_max / bracketDivisor : Infinity;
    if (adjustedAnnualWage <= adjMin) break;
    const taxable = Math.min(adjustedAnnualWage, adjMax) - adjMin;
    annualTax += taxable * bracket.rate;
  }

  // If Step 2 checkbox used bracket-halving, we don't need further adjustment

  // Subtract Step 3 dependent credit
  annualTax = Math.max(0, annualTax - w4.w4_step3_dependent_credit);

  // De-annualize
  let perPeriodTax = annualTax / periods;

  // Add Step 4c extra withholding
  perPeriodTax += w4.w4_step4c_extra_withholding;

  return roundCents(Math.max(0, perPeriodTax));
}

/**
 * Utah TC-40W Withholding.
 * Utah uses a flat rate on gross wages minus a personal exemption credit.
 * Formula: (annualized_gross × flat_rate) − (exemptions × credit) → de-annualize
 */
export function calculateUtahWithholding(
  grossPerPeriod: number,
  payFrequency: string,
  utahFields: UtahFields,
  companyId: string,
  year: number = 2026,
): number {
  const periods = PAY_PERIODS_MAP[payFrequency] ?? 26;
  const config = getUtahConfig(companyId, year);

  const annualGross = grossPerPeriod * periods;
  const annualTax = annualGross * config.flat_rate;
  const exemptionCredit = utahFields.ut_exemptions * config.personal_exemption_credit;
  const annualNet = Math.max(0, annualTax - exemptionCredit);
  let perPeriod = annualNet / periods;

  // Add additional withholding
  perPeriod += utahFields.ut_additional_withholding;

  return roundCents(Math.max(0, perPeriod));
}

/**
 * FICA: Social Security + Medicare + Additional Medicare + FUTA.
 * Handles mid-year SS wage base cap crossing.
 */
export function calculateFICA(
  grossPerPeriod: number,
  ytdGross: number,
  year: number = 2026,
): FICAResult {
  const constants = getConstants(year);

  // Social Security: 6.2% up to wage base
  const ssRemaining = Math.max(0, constants.ss_wage_base - ytdGross);
  const ssTaxable = Math.min(grossPerPeriod, ssRemaining);
  const ss_employee = roundCents(ssTaxable * constants.ss_rate);
  const ss_employer = roundCents(ssTaxable * constants.ss_rate);

  // Medicare: 1.45% on all wages
  const medicare_employee = roundCents(grossPerPeriod * constants.medicare_rate);
  const medicare_employer = roundCents(grossPerPeriod * constants.medicare_rate);

  // Additional Medicare: 0.9% on wages above $200k YTD
  // Employer does NOT match additional Medicare (IRC §3101(b)(2))
  const threshold = constants.medicare_additional_threshold_single;
  const overThreshold = Math.max(0, (ytdGross + grossPerPeriod) - threshold);
  const surtaxBase = Math.min(grossPerPeriod, overThreshold);
  const additional_medicare = roundCents(surtaxBase * constants.medicare_additional_rate);

  // FUTA: employer-only, first $7,000 per employee per year
  const futaRemaining = Math.max(0, constants.futa_wage_base - ytdGross);
  const futaTaxable = Math.min(grossPerPeriod, futaRemaining);
  const futa = roundCents(futaTaxable * constants.futa_rate);

  return { ss_employee, ss_employer, medicare_employee, medicare_employer, additional_medicare, futa };
}

/**
 * SUI: Utah State Unemployment Insurance (employer-only).
 */
export function calculateSUI(
  grossPerPeriod: number,
  ytdGross: number,
  companyId: string,
  year: number = 2026,
): number {
  const config = getUtahConfig(companyId, year);
  const suiRemaining = Math.max(0, config.sui_wage_base - ytdGross);
  const suiTaxable = Math.min(grossPerPeriod, suiRemaining);
  return roundCents(suiTaxable * config.sui_rate);
}

/**
 * Full payroll tax calculation — orchestrator.
 * Returns complete breakdown for one employee for one pay period.
 */
export function calculateFullPayroll(
  grossPerPeriod: number,
  payFrequency: string,
  w4: W4Fields,
  utahFields: UtahFields,
  ytdGross: number,
  companyId: string,
  year: number = 2026,
): FullTaxResult {
  const federal_withholding = calculateFederalWithholding(grossPerPeriod, payFrequency, w4, year);
  const utah_withholding = calculateUtahWithholding(grossPerPeriod, payFrequency, utahFields, companyId, year);
  const fica = calculateFICA(grossPerPeriod, ytdGross, year);
  const sui = calculateSUI(grossPerPeriod, ytdGross, companyId, year);

  const total_employee_tax = roundCents(
    federal_withholding + utah_withholding +
    fica.ss_employee + fica.medicare_employee + fica.additional_medicare
  );

  const total_employer_tax = roundCents(
    fica.ss_employer + fica.medicare_employer + fica.futa + sui
  );

  return {
    federal_withholding,
    utah_withholding,
    ss_employee: fica.ss_employee,
    ss_employer: fica.ss_employer,
    medicare_employee: fica.medicare_employee,
    medicare_employer: fica.medicare_employer,
    additional_medicare: fica.additional_medicare,
    futa: fica.futa,
    sui,
    total_employee_tax,
    total_employer_tax,
  };
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/main/services/TaxCalculationEngine.ts
git commit -m "feat(tax): add TaxCalculationEngine service with Pub 15-T and TC-40W"
```

---

## Task 4: IPC Handlers — Tax Config & Filing

**Files:**
- Modify: `src/main/ipc/index.ts` (add new handlers after existing `tax:auto-seed-current-year` handler, ~line 3766)

**Step 1: Add tax config get/save handlers**

Insert these handlers after the existing `tax:auto-seed-current-year` handler:

```typescript
// ─── Tax System: Config & Filing (2026-04-27) ──────────

// Get Utah withholding config for a year
ipcMain.handle('tax:get-utah-config', (_event, { year }: { year: number }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return null;
  const dbInstance = db.getDb();
  return dbInstance.prepare(
    'SELECT * FROM utah_withholding_config WHERE company_id = ? AND tax_year = ?'
  ).get(companyId, year) ?? null;
});

// Save Utah withholding config (upsert)
ipcMain.handle('tax:save-utah-config', (_event, { year, config }: { year: number; config: Record<string, any> }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return { error: 'No active company' };
  const dbInstance = db.getDb();
  const existing = dbInstance.prepare(
    'SELECT id FROM utah_withholding_config WHERE company_id = ? AND tax_year = ?'
  ).get(companyId, year) as any;
  if (existing) {
    dbInstance.prepare(`UPDATE utah_withholding_config SET
      flat_rate = ?, personal_exemption_credit = ?, sui_rate = ?, sui_wage_base = ?,
      wc_rate = ?, wc_class_code = ?, wc_carrier = ?, updated_at = datetime('now')
      WHERE id = ?`).run(
      config.flat_rate ?? 0.0455, config.personal_exemption_credit ?? 393,
      config.sui_rate ?? 0.012, config.sui_wage_base ?? 44800,
      config.wc_rate ?? 0.008, config.wc_class_code ?? '8810', config.wc_carrier ?? '',
      existing.id
    );
    return { success: true, id: existing.id };
  } else {
    const id = uuid();
    dbInstance.prepare(`INSERT INTO utah_withholding_config
      (id, company_id, tax_year, flat_rate, personal_exemption_credit, sui_rate, sui_wage_base, wc_rate, wc_class_code, wc_carrier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, companyId, year,
      config.flat_rate ?? 0.0455, config.personal_exemption_credit ?? 393,
      config.sui_rate ?? 0.012, config.sui_wage_base ?? 44800,
      config.wc_rate ?? 0.008, config.wc_class_code ?? '8810', config.wc_carrier ?? ''
    );
    return { success: true, id };
  }
  scheduleAutoBackup();
});

// Get filing summary for a quarter — auto-computes from pay_stubs
ipcMain.handle('tax:get-filing-summary', (_event, { year, quarter }: { year: number; quarter?: number }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return null;
  const dbInstance = db.getDb();

  // Quarter date ranges
  const quarters = [
    { q: 1, start: `${year}-01-01`, end: `${year}-03-31` },
    { q: 2, start: `${year}-04-01`, end: `${year}-06-30` },
    { q: 3, start: `${year}-07-01`, end: `${year}-09-30` },
    { q: 4, start: `${year}-10-01`, end: `${year}-12-31` },
  ];

  const targetQuarters = quarter ? quarters.filter(q => q.q === quarter) : quarters;

  const results = targetQuarters.map(qr => {
    // Aggregate pay stubs for the quarter
    const agg = dbInstance.prepare(`
      SELECT
        COUNT(DISTINCT ps.employee_id) as employee_count,
        COALESCE(SUM(ps.gross_pay), 0) as total_wages,
        COALESCE(SUM(ps.federal_tax), 0) as federal_withholding,
        COALESCE(SUM(ps.state_tax), 0) as state_withholding,
        COALESCE(SUM(ps.social_security), 0) as ss_employee,
        COALESCE(SUM(ps.medicare), 0) as medicare_employee
      FROM pay_stubs ps
      JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `).get(companyId, qr.start, qr.end) as any;

    // Filing status from tax_filing_periods
    const filingStatuses = dbInstance.prepare(
      'SELECT * FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? AND quarter = ?'
    ).all(companyId, year, qr.q) as any[];

    const filing941 = filingStatuses.find(f => f.form_type === '941') ?? null;
    const filingTC941 = filingStatuses.find(f => f.form_type === 'tc-941') ?? null;

    // 941 total = fed W/H + SS (ee+er) + Medicare (ee+er)
    const ssEmployer = agg.ss_employee; // employer matches employee portion
    const medicareEmployer = agg.medicare_employee;
    const total941 = db.roundCents(
      agg.federal_withholding + agg.ss_employee + ssEmployer + agg.medicare_employee + medicareEmployer
    );

    return {
      quarter: qr.q,
      start: qr.start,
      end: qr.end,
      employee_count: agg.employee_count,
      total_wages: db.roundCents(agg.total_wages),
      federal_withholding: db.roundCents(agg.federal_withholding),
      state_withholding: db.roundCents(agg.state_withholding),
      ss_employee: db.roundCents(agg.ss_employee),
      ss_employer: db.roundCents(ssEmployer),
      medicare_employee: db.roundCents(agg.medicare_employee),
      medicare_employer: db.roundCents(medicareEmployer),
      total_941_liability: total941,
      filing_941: filing941,
      filing_tc941: filingTC941,
    };
  });

  return results;
});

// Record a filing event (mark as filed, record payment)
ipcMain.handle('tax:record-filing', (_event, { form_type, year, quarter, filed_date, confirmation_number, amount_paid, payment_date, notes }: any) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return { error: 'No active company' };
  const dbInstance = db.getDb();

  const existing = dbInstance.prepare(
    'SELECT id FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? AND quarter = ? AND form_type = ?'
  ).get(companyId, year, quarter, form_type) as any;

  if (existing) {
    dbInstance.prepare(`UPDATE tax_filing_periods SET
      status = 'filed', filed_date = ?, confirmation_number = ?,
      amount_paid = COALESCE(amount_paid, 0) + ?, payment_date = ?,
      notes = ?, updated_at = datetime('now')
      WHERE id = ?`).run(
      filed_date || '', confirmation_number || '',
      amount_paid || 0, payment_date || '', notes || '',
      existing.id
    );
    return { success: true, id: existing.id };
  } else {
    const id = uuid();
    dbInstance.prepare(`INSERT INTO tax_filing_periods
      (id, company_id, tax_year, quarter, form_type, status, filed_date, confirmation_number, amount_due, amount_paid, payment_date, notes)
      VALUES (?, ?, ?, ?, ?, 'filed', ?, ?, 0, ?, ?, ?)`).run(
      id, companyId, year, quarter, form_type,
      filed_date || '', confirmation_number || '',
      amount_paid || 0, payment_date || '', notes || ''
    );
    return { success: true, id };
  }
  scheduleAutoBackup();
});

// W-2 data: per-employee annual aggregation
ipcMain.handle('tax:get-w2-data', (_event, { year, employee_id }: { year: number; employee_id?: string }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return [];
  const dbInstance = db.getDb();

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  let sql = `
    SELECT
      ps.employee_id,
      e.name as employee_name,
      e.ssn, e.address_line1, e.address_line2, e.city, e.state, e.zip,
      COALESCE(SUM(ps.gross_pay), 0) as box1_wages,
      COALESCE(SUM(ps.federal_tax), 0) as box2_federal_wh,
      COALESCE(SUM(ps.gross_pay), 0) as box3_ss_wages,
      COALESCE(SUM(ps.social_security), 0) as box4_ss_tax,
      COALESCE(SUM(ps.gross_pay), 0) as box5_medicare_wages,
      COALESCE(SUM(ps.medicare), 0) as box6_medicare_tax,
      COALESCE(SUM(ps.gross_pay), 0) as box16_state_wages,
      COALESCE(SUM(ps.state_tax), 0) as box17_state_tax
    FROM pay_stubs ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    JOIN employees e ON e.id = ps.employee_id
    WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
  `;
  const params: any[] = [companyId, yearStart, yearEnd];

  if (employee_id) {
    sql += ' AND ps.employee_id = ?';
    params.push(employee_id);
  }

  sql += ' GROUP BY ps.employee_id ORDER BY e.name';
  return dbInstance.prepare(sql).all(...params);
});

// W-3 data: sums all W-2s
ipcMain.handle('tax:get-w3-data', (_event, { year }: { year: number }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return null;
  const dbInstance = db.getDb();

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  return dbInstance.prepare(`
    SELECT
      COUNT(DISTINCT ps.employee_id) as employee_count,
      COALESCE(SUM(ps.gross_pay), 0) as total_wages,
      COALESCE(SUM(ps.federal_tax), 0) as total_federal_wh,
      COALESCE(SUM(ps.gross_pay), 0) as total_ss_wages,
      COALESCE(SUM(ps.social_security), 0) as total_ss_tax,
      COALESCE(SUM(ps.gross_pay), 0) as total_medicare_wages,
      COALESCE(SUM(ps.medicare), 0) as total_medicare_tax,
      COALESCE(SUM(ps.gross_pay), 0) as total_state_wages,
      COALESCE(SUM(ps.state_tax), 0) as total_state_tax
    FROM pay_stubs ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
  `).get(companyId, yearStart, yearEnd);
});

// Dashboard summary: KPIs + deadlines + filing grid
ipcMain.handle('tax:dashboard-summary', (_event, { year }: { year: number }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return null;
  const dbInstance = db.getDb();

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // YTD totals
  const ytd = dbInstance.prepare(`
    SELECT
      COALESCE(SUM(ps.gross_pay), 0) as ytd_payroll,
      COALESCE(SUM(ps.federal_tax), 0) as ytd_federal,
      COALESCE(SUM(ps.state_tax), 0) as ytd_state,
      COALESCE(SUM(ps.social_security), 0) as ytd_ss,
      COALESCE(SUM(ps.medicare), 0) as ytd_medicare
    FROM pay_stubs ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
  `).get(companyId, yearStart, yearEnd) as any;

  // Prior year for comparison
  const pyStart = `${year - 1}-01-01`;
  const pyEnd = `${year - 1}-12-31`;
  const py = dbInstance.prepare(`
    SELECT COALESCE(SUM(ps.gross_pay), 0) as ytd_payroll
    FROM pay_stubs ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
  `).get(companyId, pyStart, pyEnd) as any;

  // Filing statuses
  const filings = dbInstance.prepare(
    'SELECT * FROM tax_filing_periods WHERE company_id = ? AND tax_year = ?'
  ).all(companyId, year);

  // Quarterly breakdowns (reuse filing summary logic)
  const quarters = [1, 2, 3, 4].map(q => {
    const qStart = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
    const qEndMonth = q * 3;
    const qEndDay = [0, 31, 30, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][qEndMonth];
    const qEnd = `${year}-${String(qEndMonth).padStart(2, '0')}-${qEndDay}`;

    const agg = dbInstance.prepare(`
      SELECT
        COALESCE(SUM(ps.federal_tax), 0) as federal,
        COALESCE(SUM(ps.state_tax), 0) as state,
        COALESCE(SUM(ps.social_security), 0) as fica_ss,
        COALESCE(SUM(ps.medicare), 0) as fica_med
      FROM pay_stubs ps
      JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `).get(companyId, qStart, qEnd) as any;

    return {
      quarter: q,
      federal: db.roundCents(agg?.federal || 0),
      state: db.roundCents(agg?.state || 0),
      fica: db.roundCents((agg?.fica_ss || 0) * 2 + (agg?.fica_med || 0) * 2), // ee + er
    };
  });

  return {
    ytd_payroll: db.roundCents(ytd?.ytd_payroll || 0),
    ytd_federal: db.roundCents(ytd?.ytd_federal || 0),
    ytd_state: db.roundCents(ytd?.ytd_state || 0),
    ytd_fica: db.roundCents((ytd?.ytd_ss || 0) * 2 + (ytd?.ytd_medicare || 0) * 2),
    py_payroll: db.roundCents(py?.ytd_payroll || 0),
    filings,
    quarters,
  };
});

// Tax liability report: per-tax breakdown for period range
ipcMain.handle('tax:liability-report', (_event, { year, quarter_start, quarter_end }: { year: number; quarter_start: number; quarter_end: number }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return null;
  const dbInstance = db.getDb();

  const startMonth = (quarter_start - 1) * 3 + 1;
  const endMonth = quarter_end * 3;
  const endDay = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][endMonth] || 31;
  const periodStart = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const periodEnd = `${year}-${String(endMonth).padStart(2, '0')}-${endDay}`;

  // Period aggregation
  const period = dbInstance.prepare(`
    SELECT
      COALESCE(SUM(ps.gross_pay), 0) as wages,
      COALESCE(SUM(ps.federal_tax), 0) as federal_wh,
      COALESCE(SUM(ps.social_security), 0) as ss_ee,
      COALESCE(SUM(ps.medicare), 0) as med_ee,
      COALESCE(SUM(ps.state_tax), 0) as state_wh
    FROM pay_stubs ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
  `).get(companyId, periodStart, periodEnd) as any;

  // YTD aggregation
  const yearStart = `${year}-01-01`;
  const ytd = dbInstance.prepare(`
    SELECT
      COALESCE(SUM(ps.gross_pay), 0) as wages,
      COALESCE(SUM(ps.federal_tax), 0) as federal_wh,
      COALESCE(SUM(ps.social_security), 0) as ss_ee,
      COALESCE(SUM(ps.medicare), 0) as med_ee,
      COALESCE(SUM(ps.state_tax), 0) as state_wh
    FROM pay_stubs ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
  `).get(companyId, yearStart, periodEnd) as any;

  return { period, ytd, periodStart, periodEnd };
});

// Employee tax summary
ipcMain.handle('tax:employee-tax-summary', (_event, { year, employee_id }: { year: number; employee_id?: string }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return [];
  const dbInstance = db.getDb();

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  let sql = `
    SELECT
      ps.employee_id,
      e.name as employee_name,
      e.w4_filing_status, e.w4_step2_checkbox, e.w4_step3_dependent_credit,
      COALESCE(SUM(ps.gross_pay), 0) as total_gross,
      COALESCE(SUM(ps.federal_tax), 0) as total_federal,
      COALESCE(SUM(ps.social_security), 0) as total_ss,
      COALESCE(SUM(ps.medicare), 0) as total_medicare,
      COALESCE(SUM(ps.state_tax), 0) as total_state,
      COALESCE(SUM(ps.net_pay), 0) as total_net
    FROM pay_stubs ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    JOIN employees e ON e.id = ps.employee_id
    WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
  `;
  const params: any[] = [companyId, yearStart, yearEnd];

  if (employee_id) {
    sql += ' AND ps.employee_id = ?';
    params.push(employee_id);
  }

  sql += ' GROUP BY ps.employee_id ORDER BY e.name';
  return dbInstance.prepare(sql).all(...params);
});
```

**Step 2: Add `scheduleAutoBackup()` calls**

Every handler that mutates data (`tax:save-utah-config`, `tax:record-filing`) must call `scheduleAutoBackup()` after the write. (Move the call before the return statement in each mutating handler.)

**Step 3: Verify**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/main/ipc/index.ts
git commit -m "feat(tax): add 9 IPC handlers for tax config, filing, and reporting"
```

---

## Task 5: API Methods — Frontend Tax API

**Files:**
- Modify: `src/renderer/lib/api.ts` (add new methods before the closing `};`)

**Step 1: Add tax API methods**

Add these methods to the `api` object:

```typescript
// ─── Tax System ─────────────────────────────────
taxGetUtahConfig: (year: number): Promise<any> =>
  window.electronAPI.invoke('tax:get-utah-config', { year }),
taxSaveUtahConfig: (year: number, config: Record<string, any>): Promise<any> =>
  window.electronAPI.invoke('tax:save-utah-config', { year, config }),
taxGetFilingSummary: (year: number, quarter?: number): Promise<any> =>
  window.electronAPI.invoke('tax:get-filing-summary', { year, quarter }),
taxRecordFiling: (data: { form_type: string; year: number; quarter: number; filed_date?: string; confirmation_number?: string; amount_paid?: number; payment_date?: string; notes?: string }): Promise<any> =>
  window.electronAPI.invoke('tax:record-filing', data),
taxGetW2Data: (year: number, employee_id?: string): Promise<any[]> =>
  window.electronAPI.invoke('tax:get-w2-data', { year, employee_id }),
taxGetW3Data: (year: number): Promise<any> =>
  window.electronAPI.invoke('tax:get-w3-data', { year }),
taxDashboardSummary: (year: number): Promise<any> =>
  window.electronAPI.invoke('tax:dashboard-summary', { year }),
taxLiabilityReport: (year: number, quarter_start: number, quarter_end: number): Promise<any> =>
  window.electronAPI.invoke('tax:liability-report', { year, quarter_start, quarter_end }),
taxEmployeeTaxSummary: (year: number, employee_id?: string): Promise<any[]> =>
  window.electronAPI.invoke('tax:employee-tax-summary', { year, employee_id }),
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/renderer/lib/api.ts
git commit -m "feat(tax): add 9 tax API methods to frontend wrapper"
```

---

## Task 6: Tax Module — Index with Sub-Tabs

**Files:**
- Modify: `src/renderer/modules/taxes/index.tsx` (full rewrite of existing file)

**Step 1: Rewrite the Tax module index with new sub-tabs**

The existing file has 4 tabs (dashboard, categories, payments, configuration). Replace with 5 tabs: Dashboard, Filing & Compliance, Reports, Categories (legacy), Configuration.

```typescript
import React, { useState } from 'react';
import { BarChart3, FileText, PieChart, Tag, Settings } from 'lucide-react';
import TaxDashboard from './TaxDashboard';
import TaxFiling from './TaxFiling';
import TaxReports from './TaxReports';
import TaxCategories from './TaxCategories';
import TaxConfiguration from './TaxConfiguration';

type Tab = 'dashboard' | 'filing' | 'reports' | 'categories' | 'configuration';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={15} /> },
  { key: 'filing', label: 'Filing & Compliance', icon: <FileText size={15} /> },
  { key: 'reports', label: 'Reports', icon: <PieChart size={15} /> },
  { key: 'categories', label: 'Categories', icon: <Tag size={15} /> },
  { key: 'configuration', label: 'Configuration', icon: <Settings size={15} /> },
];

const TaxModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <h1 className="text-lg font-bold text-text-primary">Tax Management</h1>
      <div className="flex gap-1 border-b border-border-primary pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-b-accent-blue text-accent-blue'
                : 'border-b-transparent text-text-muted hover:text-text-primary transition-colors'
            }`}
            style={{ borderRadius: '6px 6px 0 0' }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'dashboard' && <TaxDashboard />}
      {activeTab === 'filing' && <TaxFiling />}
      {activeTab === 'reports' && <TaxReports />}
      {activeTab === 'categories' && <TaxCategories />}
      {activeTab === 'configuration' && <TaxConfiguration />}
    </div>
  );
};

export default TaxModule;
```

**Step 2: Verify — will fail until TaxFiling/TaxReports exist. Create stubs first.**

**Step 3: Commit**

```bash
git add src/renderer/modules/taxes/index.tsx
git commit -m "feat(tax): rewrite tax module with 5 sub-tabs including filing and reports"
```

---

## Task 7: Tax Dashboard — Full Rewrite

**Files:**
- Modify: `src/renderer/modules/taxes/TaxDashboard.tsx` (full rewrite)

**Step 1: Rewrite TaxDashboard with KPI cards, deadline tracker, quarterly chart, filing grid**

This replaces the existing self-employment/estimated-tax dashboard with an employer payroll tax dashboard. The component calls `api.taxDashboardSummary(year)` and renders:
- 4 KPI cards (YTD Payroll, Federal, State, FICA) with prior-year comparison
- Upcoming deadlines list (computed from current date)
- Quarterly bar chart (CSS-rendered)
- Filing status grid

The full component code should be written following the existing `StatCard` pattern already in the file, but repurposed for payroll tax data.

**Step 2: Verify and commit**

---

## Task 8: Tax Filing Component

**Files:**
- Create: `src/renderer/modules/taxes/TaxFiling.tsx`

**Step 1: Create TaxFiling component**

This component renders the quarterly filing tracker from Section 4 of the design:
- Year + quarter selector
- Per-quarter cards showing 941 and TC-941 line items
- "Record Payment" and "Mark as Filed" buttons
- W-2/W-3 annual section
- Status badges

Calls: `api.taxGetFilingSummary(year)`, `api.taxRecordFiling(data)`, `api.taxGetW2Data(year)`, `api.taxGetW3Data(year)`

**Step 2: Create print template functions for 941 worksheet and W-2**

Add to a new file `src/renderer/modules/taxes/tax-forms.ts`:
- `generate941WorksheetHTML(data)` — IRS 941 line items mapped to a print-ready layout
- `generateTC941WorksheetHTML(data)` — Utah TC-941 equivalent
- `generateW2HTML(employeeData)` — W-2 Copy B format
- `generateW3HTML(summaryData)` — W-3 transmittal summary
- All include "WORKSHEET ONLY" disclaimer

**Step 3: Verify and commit**

---

## Task 9: Tax Reports Component

**Files:**
- Create: `src/renderer/modules/taxes/TaxReports.tsx`

**Step 1: Create TaxReports component**

Two report sections:
1. **Tax Liability Report** — period selector, per-tax breakdown table, print button
2. **Employee Tax Summary** — employee filter, per-employee table with expandable detail

Calls: `api.taxLiabilityReport(year, qStart, qEnd)`, `api.taxEmployeeTaxSummary(year, empId?)`

Uses existing `reportHeader()` / `reportFooter()` from `print-templates.ts` for print output.

**Step 2: Verify and commit**

---

## Task 10: Employee W-4 Fields in EmployeeForm

**Files:**
- Modify: `src/renderer/modules/payroll/EmployeeForm.tsx`

**Step 1: Add W-4 fields to EmployeeFormData interface**

```typescript
// Add to EmployeeFormData interface:
w4_filing_status: 'single' | 'married' | 'head_of_household';
w4_step2_checkbox: boolean;
w4_step3_dependent_credit: string;
w4_step4a_other_income: string;
w4_step4b_deductions: string;
w4_step4c_extra_withholding: string;
ut_exemptions: string;
ut_additional_withholding: string;
w4_received_date: string;
```

**Step 2: Add defaults to EMPTY_FORM**

```typescript
w4_filing_status: 'single',
w4_step2_checkbox: false,
w4_step3_dependent_credit: '0',
w4_step4a_other_income: '0',
w4_step4b_deductions: '0',
w4_step4c_extra_withholding: '0',
ut_exemptions: '1',
ut_additional_withholding: '0',
w4_received_date: '',
```

**Step 3: Add W-4 form section in the JSX**

Add a new collapsible section "W-4 Information (2020+)" after the Tax Info section:
- Filing status radio buttons (Single, Married, Head of Household)
- Step 2 checkbox
- Step 3/4a/4b/4c numeric inputs
- Utah exemptions + additional withholding
- W-4 received date

**Step 4: Wire up form population from existing employee data**

In the `useEffect` that loads employee data, map the new fields from the API response.

**Step 5: Wire up save to include new fields in the `api.update()`/`api.create()` call**

**Step 6: Verify and commit**

---

## Task 11: Settings — Federal & Utah Tax Config Cards

**Files:**
- Modify: `src/renderer/modules/settings/index.tsx`

**Step 1: Add Federal Tax Configuration section**

New `SectionCard` with:
- Year selector
- Standard deduction fields (single, MFJ, HoH)
- FICA rates (SS rate, wage base, Medicare rate, additional Medicare)
- Editable bracket table for selected filing status
- "Reset to Defaults" button that calls `tax:seed-year`
- "Save" button that calls `api.rawQuery` to update `federal_payroll_constants`

**Step 2: Add Utah State Tax section**

New `SectionCard` with:
- Flat rate input (default 4.55%)
- Personal exemption credit
- SUI rate + wage base
- WC rate + class code + carrier
- Save calls `api.taxSaveUtahConfig(year, config)`

**Step 3: Verify and commit**

---

## Task 12: PayrollRunner Integration with TaxCalculationEngine

**Files:**
- Modify: `src/renderer/modules/payroll/PayrollRunner.tsx`

**Step 1: Replace inline tax calculations with engine-backed IPC call**

The current `calcPayStub()` function has inline tax math. Instead of rewriting the frontend function, add a new IPC handler that the PayrollRunner can optionally call:

Add to `src/main/ipc/index.ts`:

```typescript
ipcMain.handle('tax:calc-payroll', (_event, { grossPay, payFrequency, w4, utah, ytdGross }: any) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return null;
  const { calculateFullPayroll } = require('../services/TaxCalculationEngine');
  return calculateFullPayroll(grossPay, payFrequency, w4, utah, ytdGross, companyId, 2026);
});
```

**Step 2: Update `calcPayStub` in PayrollRunner to call engine when W-4 data is available**

When the employee has `w4_filing_status` set (new employees), use the engine result. Legacy employees without W-4 data continue using the existing inline calculation as fallback.

**Step 3: Load employee W-4 fields alongside existing employee data**

The existing `loadEmployees` query fetches from `employees` table — the new W-4 columns will automatically be included since it does `SELECT *` equivalent via `api.query`.

**Step 4: Verify and commit**

---

## Task 13: Final Wiring & Type Check

**Files:**
- Modify: `src/renderer/App.tsx` (verify `taxes` module already wired — it is)
- Modify: `src/renderer/components/layout/Sidebar.tsx` (verify `taxes` nav item already exists — it does)

**Step 1: Verify App.tsx**

The `taxes` module is already lazy-loaded and wired in App.tsx at line 29 (`TaxesModule`) and line 113 (`case 'taxes'`). No changes needed.

**Step 2: Verify Sidebar.tsx**

The `taxes` nav item already exists at line 82 (`{ id: 'taxes', label: 'Taxes', icon: Calculator }`). No changes needed.

**Step 3: Run full type check**

```bash
npx tsc --noEmit
```

Fix any errors.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(tax): complete tax system wiring and type check"
```

---

## Implementation Order Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Employee W-4 migrations | None |
| 2 | Utah config + filing tables | None |
| 3 | TaxCalculationEngine service | Tasks 1-2 (tables exist) |
| 4 | IPC handlers (9 new) | Task 3 (imports engine) |
| 5 | API methods (frontend) | Task 4 |
| 6 | Tax module index rewrite | None (UI only) |
| 7 | Tax Dashboard rewrite | Task 5 |
| 8 | Tax Filing component + forms | Task 5 |
| 9 | Tax Reports component | Task 5 |
| 10 | Employee W-4 fields | Task 1 |
| 11 | Settings tax config cards | Task 5 |
| 12 | PayrollRunner integration | Tasks 3, 10 |
| 13 | Final wiring + type check | All above |

**Total: 13 tasks, ~6 new files, ~8 modified files, ~9 new IPC handlers**
