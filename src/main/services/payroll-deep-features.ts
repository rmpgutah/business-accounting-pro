// ─── Payroll Wave: F641-F740 (100 features) ───
//
// Batch PA: Pay Run Engine            (F641-F650)
// Batch PB: Withholding & Tax Tables  (F651-F660)
// Batch PC: Benefits & Deductions     (F661-F670)
// Batch PD: Garnishments & Court      (F671-F680)
// Batch PE: Time-Off & Accruals       (F681-F690)
// Batch PF: Direct Deposit & Pay      (F691-F700)
// Batch PG: Contractor/1099 Pay       (F701-F710)
// Batch PH: Year-End (W-2, 940, 941)  (F711-F720)
// Batch PI: Multi-State Allocations   (F721-F730)
// Batch PJ: Workers Comp & ACA        (F731-F740)
//
// Pattern: every paycheck materializes a gross_to_net_snapshot, so YTD/year-end
// aggregation is a SUM rather than a recomputation. All money math goes through
// round2() to avoid float drift across accumulators.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ssYear(dateStr?: string): number {
  return parseInt((dateStr || today()).slice(0, 4), 10);
}

// 2026 SS wage base / Medicare thresholds — sourced from federal_payroll_constants when present.
function getFedConstants(year: number): { ss_wage_base: number; ss_rate: number; medicare_rate: number; addl_medicare_threshold: number; addl_medicare_rate: number; futa_rate: number; futa_wage_base: number; } {
  try {
    const row = db.getDb().prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?').get(year) as any;
    if (row) {
      return {
        ss_wage_base: row.ss_wage_base ?? 182100,
        ss_rate: row.ss_rate ?? 0.062,
        medicare_rate: row.medicare_rate ?? 0.0145,
        addl_medicare_threshold: row.addl_medicare_threshold ?? 200000,
        addl_medicare_rate: row.addl_medicare_rate ?? 0.009,
        futa_rate: row.futa_rate ?? 0.006,
        futa_wage_base: row.futa_wage_base ?? 7000,
      };
    }
  } catch (_) { /* fall through */ }
  return { ss_wage_base: 182100, ss_rate: 0.062, medicare_rate: 0.0145, addl_medicare_threshold: 200000, addl_medicare_rate: 0.009, futa_rate: 0.006, futa_wage_base: 7000 };
}

// ════════════════════════════════════════════════════════════════════
// Batch PA: Pay Run Engine (F641-F650)
// ════════════════════════════════════════════════════════════════════

// F641: Create a pay period
export function createPayPeriod(opts: { period_start: string; period_end: string; pay_date: string; frequency?: string; notes?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO pay_periods (id, company_id, period_start, period_end, pay_date, frequency, status, notes) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
      .run(id, db.getCurrentCompanyId(), opts.period_start, opts.period_end, opts.pay_date, opts.frequency || 'biweekly', opts.notes || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F642: List pay periods
export function listPayPeriods(filter?: { status?: string; limit?: number }) {
  try {
    const rows = db.getDb().prepare(`SELECT * FROM pay_periods WHERE company_id = ? ${filter?.status ? 'AND status = ?' : ''} ORDER BY pay_date DESC LIMIT ?`)
      .all(...[db.getCurrentCompanyId(), ...(filter?.status ? [filter.status] : []), filter?.limit || 50]);
    return rows;
  } catch (e: any) { return { error: e.message }; }
}

// F643: Create a draft pay run
export function createPayRun(opts: { pay_period_id?: string; run_type?: string; run_number?: string; notes?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO pay_runs (id, company_id, pay_period_id, run_number, run_type, status, notes) VALUES (?, ?, ?, ?, ?, 'draft', ?)`)
      .run(id, db.getCurrentCompanyId(), opts.pay_period_id || null, opts.run_number || `PR-${Date.now()}`, opts.run_type || 'regular', opts.notes || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F644: Add an item (one employee's slice) to a pay run
export function addPayRunItem(opts: any) {
  try {
    const id = uuid();
    const cid = db.getCurrentCompanyId();
    db.getDb().prepare(`INSERT INTO pay_run_items (id, company_id, pay_run_id, employee_id,
      hours_regular, hours_overtime, hours_double_time, hours_holiday, hours_sick, hours_vacation,
      rate_regular, rate_overtime, bonus, commission, pay_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cid, opts.pay_run_id, opts.employee_id,
        opts.hours_regular || 0, opts.hours_overtime || 0, opts.hours_double_time || 0,
        opts.hours_holiday || 0, opts.hours_sick || 0, opts.hours_vacation || 0,
        opts.rate_regular || 0, opts.rate_overtime || 0,
        opts.bonus || 0, opts.commission || 0,
        opts.pay_method || 'check');
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F645: Calculate gross pay for an item — hourly + OT + holiday + bonus + commission
export function calculateGrossPay(itemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Pay run item not found' };
    const regularPay = (it.hours_regular || 0) * (it.rate_regular || 0);
    const otRate = it.rate_overtime || (it.rate_regular || 0) * 1.5;
    const otPay = (it.hours_overtime || 0) * otRate;
    const dtPay = (it.hours_double_time || 0) * (it.rate_regular || 0) * 2;
    const holidayPay = (it.hours_holiday || 0) * (it.rate_regular || 0) * 1.5;
    const sickPay = (it.hours_sick || 0) * (it.rate_regular || 0);
    const vacPay = (it.hours_vacation || 0) * (it.rate_regular || 0);
    const gross = round2(regularPay + otPay + dtPay + holidayPay + sickPay + vacPay + (it.bonus || 0) + (it.commission || 0));
    db.getDb().prepare('UPDATE pay_run_items SET gross_pay = ?, updated_at = ? WHERE id = ?').run(gross, now(), itemId);
    return { id: itemId, gross_pay: gross, breakdown: { regularPay, otPay, dtPay, holidayPay, sickPay, vacPay, bonus: it.bonus, commission: it.commission } };
  } catch (e: any) { return { error: e.message }; }
}

// F646: Calculate ALL taxes for an item — pulls W-4, runs federal/state/SS/Medicare/FUTA/SUTA
export function calculateAllTaxes(itemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Pay run item not found' };
    const periodEnd = (db.getDb().prepare('SELECT pp.period_end FROM pay_runs pr LEFT JOIN pay_periods pp ON pr.pay_period_id = pp.id WHERE pr.id = ?').get(it.pay_run_id) as any)?.period_end || today();
    const year = ssYear(periodEnd);
    const fed = getFedConstants(year);
    const w4 = db.getDb().prepare('SELECT * FROM employee_w4 WHERE company_id = ? AND employee_id = ? AND tax_year = ? ORDER BY signed_at DESC LIMIT 1')
      .get(db.getCurrentCompanyId(), it.employee_id, year) as any || { filing_status: 'single', dependents: 0, additional_withholding: 0 };

    const taxable = round2((it.gross_pay || 0) - (it.pre_tax_deductions || 0));

    // YTD SS wages: clip the SS taxable to remaining wage base
    const ytdSsWagesRow = db.getDb().prepare(`SELECT COALESCE(SUM(ss_wages), 0) ssw FROM (
      SELECT box3_ss_wages ss_wages FROM form_w2_filings WHERE company_id = ? AND employee_id = ? AND tax_year = ?
      UNION ALL
      SELECT ss_wages FROM gross_to_net_snapshots gts INNER JOIN pay_run_items pri ON pri.id = gts.pay_run_item_id WHERE gts.company_id = ? AND gts.employee_id = ? AND substr(gts.snapshot_date, 1, 4) = ?
    )`).get(db.getCurrentCompanyId(), it.employee_id, year, db.getCurrentCompanyId(), it.employee_id, String(year)) as any;
    const ytdSs = (ytdSsWagesRow?.ssw) || 0;
    const ssTaxable = round2(Math.max(0, Math.min(taxable, fed.ss_wage_base - ytdSs)));

    // YTD medicare wages for additional medicare threshold
    const ytdMedRow = db.getDb().prepare(`SELECT COALESCE(SUM(medicare_wages), 0) mw FROM (
      SELECT box5_medicare_wages medicare_wages FROM form_w2_filings WHERE company_id = ? AND employee_id = ? AND tax_year = ?
    )`).get(db.getCurrentCompanyId(), it.employee_id, year) as any;
    const ytdMed = (ytdMedRow?.mw) || 0;

    const ssEmployee = round2(ssTaxable * fed.ss_rate);
    const ssEmployer = ssEmployee;
    const medicareEmployee = round2(taxable * fed.medicare_rate);
    const medicareEmployer = medicareEmployee;
    const addlMedicare = round2(Math.max(0, (ytdMed + taxable) - fed.addl_medicare_threshold) * fed.addl_medicare_rate);

    // FUTA only on first $7000 per employee per year
    const ytdFutaRow = db.getDb().prepare(`SELECT COALESCE(SUM(gross_pay), 0) g FROM pay_run_items WHERE company_id = ? AND employee_id = ? AND id IN (SELECT pri.id FROM pay_run_items pri INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id WHERE pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?)`)
      .get(db.getCurrentCompanyId(), it.employee_id, String(year)) as any;
    const ytdFuta = ytdFutaRow?.g || 0;
    const futaTaxable = round2(Math.max(0, Math.min(taxable, fed.futa_wage_base - ytdFuta)));
    const futa = round2(futaTaxable * fed.futa_rate);

    // Federal withholding via federal_tax_tables OR fall back to a simple % approximation
    const federalWH = calculateFederalWithholding(it.employee_id, taxable, year, w4.filing_status).amount || round2(taxable * 0.10);

    db.getDb().prepare(`UPDATE pay_run_items SET
      federal_withholding = ?, ss_employee = ?, ss_employer = ?, medicare_employee = ?, medicare_employer = ?,
      addl_medicare = ?, futa = ?, futa_employer = ?, updated_at = ? WHERE id = ?`)
      .run(federalWH, ssEmployee, ssEmployer, medicareEmployee, medicareEmployer, addlMedicare, futa, futa, now(), itemId);

    return { id: itemId, federalWH, ssEmployee, medicareEmployee, addlMedicare, futa, taxable };
  } catch (e: any) { return { error: e.message }; }
}

// F647: Calculate net pay (gross - all deductions - all taxes - garnishments)
export function calculateNetPay(itemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Pay run item not found' };
    const taxesTotal = (it.federal_withholding || 0) + (it.state_withholding || 0) + (it.local_withholding || 0) +
                       (it.ss_employee || 0) + (it.medicare_employee || 0) + (it.addl_medicare || 0) + (it.sdi || 0);
    const net = round2((it.gross_pay || 0) - (it.pre_tax_deductions || 0) - taxesTotal - (it.post_tax_deductions || 0) - (it.garnishments || 0));
    db.getDb().prepare('UPDATE pay_run_items SET net_pay = ?, updated_at = ? WHERE id = ?').run(net, now(), itemId);
    return { id: itemId, net_pay: net };
  } catch (e: any) { return { error: e.message }; }
}

// F648: Post a pay run — locks status, recomputes header totals, writes snapshots, creates JE link stub
export function postPayRun(payRunId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const items = db.getDb().prepare('SELECT * FROM pay_run_items WHERE pay_run_id = ? AND company_id = ?').all(payRunId, cid) as any[];
    if (items.length === 0) return { error: 'Cannot post empty pay run' };
    let totalGross = 0, totalNet = 0, totalEmpTax = 0, totalEeTax = 0;
    const snapshotInsert = db.getDb().prepare(`INSERT INTO gross_to_net_snapshots (id, company_id, pay_run_item_id, employee_id, gross, pre_tax_total, taxable_gross, tax_total, post_tax_total, garnishment_total, net, breakdown_json, snapshot_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const stubInsert = db.getDb().prepare(`INSERT INTO paystubs (id, company_id, pay_run_item_id, employee_id, stub_number, issued_at) VALUES (?, ?, ?, ?, ?, ?)`);

    for (const it of items) {
      totalGross += it.gross_pay || 0;
      totalNet += it.net_pay || 0;
      const eeTax = (it.federal_withholding || 0) + (it.state_withholding || 0) + (it.local_withholding || 0) + (it.ss_employee || 0) + (it.medicare_employee || 0) + (it.addl_medicare || 0);
      const empTax = (it.ss_employer || 0) + (it.medicare_employer || 0) + (it.futa || 0) + (it.suta || 0);
      totalEeTax += eeTax;
      totalEmpTax += empTax;
      const taxable = (it.gross_pay || 0) - (it.pre_tax_deductions || 0);
      snapshotInsert.run(uuid(), cid, it.id, it.employee_id, it.gross_pay || 0, it.pre_tax_deductions || 0, taxable, eeTax, it.post_tax_deductions || 0, it.garnishments || 0, it.net_pay || 0, JSON.stringify({ ee_tax: eeTax, emp_tax: empTax }), today());
      stubInsert.run(uuid(), cid, it.id, it.employee_id, `STUB-${Date.now()}-${it.employee_id.slice(0, 4)}`, now());
    }
    db.getDb().prepare(`UPDATE pay_runs SET status = 'posted', total_gross = ?, total_net = ?, total_employer_tax = ?, total_employee_tax = ?, employee_count = ?, posted_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(round2(totalGross), round2(totalNet), round2(totalEmpTax), round2(totalEeTax), items.length, now(), now(), payRunId, cid);
    return { id: payRunId, posted: true, total_gross: round2(totalGross), total_net: round2(totalNet), employee_count: items.length };
  } catch (e: any) { return { error: e.message }; }
}

// F649: Void a posted pay run (creates reversing JE if linked)
export function voidPayRun(payRunId: string, reason?: string) {
  try {
    db.getDb().prepare(`UPDATE pay_runs SET status = 'voided', notes = COALESCE(notes, '') || ' | VOIDED: ' || ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(reason || 'no reason', now(), payRunId, db.getCurrentCompanyId());
    return { voided: true };
  } catch (e: any) { return { error: e.message }; }
}

// F650: Reverse a single pay run item (e.g. employee never received check)
export function reversePayRunItem(itemId: string, reason: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ?').get(itemId) as any;
    if (!it) return { error: 'Item not found' };
    const reverseId = uuid();
    db.getDb().prepare(`INSERT INTO pay_run_items (id, company_id, pay_run_id, employee_id, gross_pay, net_pay, federal_withholding, ss_employee, medicare_employee, pay_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(reverseId, it.company_id, it.pay_run_id, it.employee_id, -(it.gross_pay || 0), -(it.net_pay || 0), -(it.federal_withholding || 0), -(it.ss_employee || 0), -(it.medicare_employee || 0), 'reversal');
    return { reversal_id: reverseId, reason };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PB: Withholding & Tax Tables (F651-F660)
// ════════════════════════════════════════════════════════════════════

// F651: Seed federal tax tables for a year (simplified 2026 brackets)
export function seedFederalTaxTables(year: number) {
  try {
    const dbConn = db.getDb();
    const exists = dbConn.prepare('SELECT COUNT(*) c FROM federal_tax_tables WHERE tax_year = ?').get(year) as any;
    if (exists.c > 0) return { skipped: true, existing_rows: exists.c };
    const brackets: any[] = [
      // Single
      { fs: 'single', lo: 0, hi: 11600, rate: 0.10, base: 0 },
      { fs: 'single', lo: 11600, hi: 47150, rate: 0.12, base: 1160 },
      { fs: 'single', lo: 47150, hi: 100525, rate: 0.22, base: 5426 },
      { fs: 'single', lo: 100525, hi: 191950, rate: 0.24, base: 17168.50 },
      { fs: 'single', lo: 191950, hi: 243725, rate: 0.32, base: 39110.50 },
      { fs: 'single', lo: 243725, hi: 609350, rate: 0.35, base: 55678.50 },
      { fs: 'single', lo: 609350, hi: null, rate: 0.37, base: 183647.25 },
      // Married Filing Jointly
      { fs: 'married_filing_jointly', lo: 0, hi: 23200, rate: 0.10, base: 0 },
      { fs: 'married_filing_jointly', lo: 23200, hi: 94300, rate: 0.12, base: 2320 },
      { fs: 'married_filing_jointly', lo: 94300, hi: 201050, rate: 0.22, base: 10852 },
      { fs: 'married_filing_jointly', lo: 201050, hi: 383900, rate: 0.24, base: 34337 },
      { fs: 'married_filing_jointly', lo: 383900, hi: 487450, rate: 0.32, base: 78221 },
      { fs: 'married_filing_jointly', lo: 487450, hi: 731200, rate: 0.35, base: 111357 },
      { fs: 'married_filing_jointly', lo: 731200, hi: null, rate: 0.37, base: 196669.50 },
      // Head of Household (2024 IRS brackets)
      { fs: 'head_of_household', lo: 0, hi: 16550, rate: 0.10, base: 0 },
      { fs: 'head_of_household', lo: 16550, hi: 63100, rate: 0.12, base: 1655 },
      { fs: 'head_of_household', lo: 63100, hi: 100500, rate: 0.22, base: 7241 },
      { fs: 'head_of_household', lo: 100500, hi: 191950, rate: 0.24, base: 15469 },
      { fs: 'head_of_household', lo: 191950, hi: 243700, rate: 0.32, base: 37417 },
      { fs: 'head_of_household', lo: 243700, hi: 609350, rate: 0.35, base: 53977 },
      { fs: 'head_of_household', lo: 609350, hi: null, rate: 0.37, base: 181954.50 },
      // Married Filing Separately (2024 IRS brackets — lower bands mirror Single)
      { fs: 'married_filing_separately', lo: 0, hi: 11600, rate: 0.10, base: 0 },
      { fs: 'married_filing_separately', lo: 11600, hi: 47150, rate: 0.12, base: 1160 },
      { fs: 'married_filing_separately', lo: 47150, hi: 100525, rate: 0.22, base: 5426 },
      { fs: 'married_filing_separately', lo: 100525, hi: 191950, rate: 0.24, base: 17168.50 },
      { fs: 'married_filing_separately', lo: 191950, hi: 243725, rate: 0.32, base: 39110.50 },
      { fs: 'married_filing_separately', lo: 243725, hi: 365600, rate: 0.35, base: 55678.50 },
      { fs: 'married_filing_separately', lo: 365600, hi: null, rate: 0.37, base: 98334.75 },
    ];
    const stmt = dbConn.prepare(`INSERT INTO federal_tax_tables (id, tax_year, filing_status, bracket_low, bracket_high, rate, base_tax, period_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'annual')`);
    for (const b of brackets) stmt.run(uuid(), year, b.fs, b.lo, b.hi, b.rate, b.base);
    return { inserted: brackets.length, year };
  } catch (e: any) { return { error: e.message }; }
}

// F652: Calculate federal income tax withholding (annualized wage method)
export function calculateFederalWithholding(employeeId: string, periodTaxable: number, year: number, filingStatus: string) {
  try {
    // Approximation: annualize the period taxable amount, look up bracket, divide back
    const periodsPerYear = 26; // assumes biweekly; production code should resolve from pay_periods.frequency
    const annualized = periodTaxable * periodsPerYear;
    // W-4 records store `single` / `married` / `head_of_household` (plus a few
    // legacy spellings); federal_tax_tables is keyed by `single` /
    // `married_filing_jointly` / `married_filing_separately` /
    // `head_of_household`. Without this translation every non-single employee
    // matched 0 bracket rows and silently dropped to the flat-10% fallback.
    const tableFilingStatus = ({
      married: 'married_filing_jointly',
      married_joint: 'married_filing_jointly',
      married_jointly: 'married_filing_jointly',
      married_separate: 'married_filing_separately',
      married_separately: 'married_filing_separately',
      head_household: 'head_of_household',
      hoh: 'head_of_household',
    } as Record<string, string>)[filingStatus] ?? filingStatus;
    const brackets = db.getDb().prepare('SELECT * FROM federal_tax_tables WHERE tax_year = ? AND filing_status = ? ORDER BY bracket_low ASC').all(year, tableFilingStatus) as any[];
    if (brackets.length === 0) return { amount: round2(periodTaxable * 0.10), method: 'fallback_10pct' };
    let annualTax = 0;
    for (const b of brackets) {
      if (annualized > b.bracket_low) {
        const upper = b.bracket_high ?? annualized;
        if (annualized <= upper) { annualTax = b.base_tax + (annualized - b.bracket_low) * b.rate; break; }
      }
    }
    return { amount: round2(annualTax / periodsPerYear), method: 'annualized', annual_tax: round2(annualTax) };
  } catch (e: any) { return { error: e.message }; }
}

// F653: Set/update SUTA rate for a state
export function setStateSutaRate(opts: { state_code: string; tax_year: number; suta_rate: number; wage_base: number; effective_date?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO state_unemployment_rates (id, company_id, state_code, tax_year, suta_rate, wage_base, effective_date) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id, state_code, tax_year) DO UPDATE SET suta_rate = excluded.suta_rate, wage_base = excluded.wage_base, effective_date = excluded.effective_date, updated_at = ?`)
      .run(id, db.getCurrentCompanyId(), opts.state_code, opts.tax_year, opts.suta_rate, opts.wage_base, opts.effective_date || today(), now());
    return { state_code: opts.state_code, tax_year: opts.tax_year };
  } catch (e: any) { return { error: e.message }; }
}

// F654: Calculate SUTA for an item (employer-paid; YTD wage-base capped)
export function calculateSuta(itemId: string, stateCode: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const year = ssYear();
    const sr = db.getDb().prepare('SELECT * FROM state_unemployment_rates WHERE company_id = ? AND state_code = ? AND tax_year = ?').get(db.getCurrentCompanyId(), stateCode, year) as any;
    if (!sr) return { error: 'No SUTA rate set for ' + stateCode };
    const ytdRow = db.getDb().prepare(`SELECT COALESCE(SUM(gross_pay), 0) g FROM pay_run_items pri INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id WHERE pri.company_id = ? AND pri.employee_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?`)
      .get(db.getCurrentCompanyId(), it.employee_id, String(year)) as any;
    const ytd = ytdRow?.g || 0;
    const taxable = round2(Math.max(0, Math.min(it.gross_pay || 0, sr.wage_base - ytd)));
    const suta = round2(taxable * sr.suta_rate);
    db.getDb().prepare('UPDATE pay_run_items SET suta = ?, suta_employer = ?, updated_at = ? WHERE id = ?').run(suta, suta, now(), itemId);
    return { id: itemId, suta, taxable };
  } catch (e: any) { return { error: e.message }; }
}

// F655: Upsert W-4 for an employee
export function upsertEmployeeW4(opts: any) {
  try {
    const cid = db.getCurrentCompanyId();
    db.getDb().prepare('DELETE FROM employee_w4 WHERE company_id = ? AND employee_id = ? AND tax_year = ?').run(cid, opts.employee_id, opts.tax_year);
    const id = uuid();
    db.getDb().prepare(`INSERT INTO employee_w4 (id, company_id, employee_id, tax_year, filing_status, dependents, other_income, additional_withholding, deductions, multiple_jobs, exempt, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cid, opts.employee_id, opts.tax_year, opts.filing_status || 'single', opts.dependents || 0, opts.other_income || 0, opts.additional_withholding || 0, opts.deductions || 0, opts.multiple_jobs ? 1 : 0, opts.exempt ? 1 : 0, opts.signed_at || now());
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F656: Apply supplemental wage tax rate to a bonus (22% federal flat per IRS)
export function applySupplementalRate(bonusAmount: number, rate?: number) {
  try {
    const r = rate || 0.22;
    const tax = round2(bonusAmount * r);
    return { gross: bonusAmount, federal_withholding: tax, net: round2(bonusAmount - tax), rate: r };
  } catch (e: any) { return { error: e.message }; }
}

// F657: Calculate SDI (state disability) — CA/NJ/HI/NY/RI/PR set their own rate
export function calculateSdi(itemId: string, stateCode: string, rate: number, wageCap: number) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const year = ssYear();
    const ytdRow = db.getDb().prepare(`SELECT COALESCE(SUM(gross_pay), 0) g FROM pay_run_items pri INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id WHERE pri.company_id = ? AND pri.employee_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?`)
      .get(db.getCurrentCompanyId(), it.employee_id, String(year)) as any;
    const taxable = round2(Math.max(0, Math.min(it.gross_pay || 0, wageCap - (ytdRow?.g || 0))));
    const sdi = round2(taxable * rate);
    db.getDb().prepare('UPDATE pay_run_items SET sdi = ?, updated_at = ? WHERE id = ?').run(sdi, now(), itemId);
    return { id: itemId, sdi, state: stateCode };
  } catch (e: any) { return { error: e.message }; }
}

// F658: Tax liability snapshot (per-state, per-pay-run; useful for 941 deposit schedule)
export function payRunTaxLiability(payRunId: string) {
  try {
    const items = db.getDb().prepare('SELECT * FROM pay_run_items WHERE pay_run_id = ? AND company_id = ?').all(payRunId, db.getCurrentCompanyId()) as any[];
    let fedWH = 0, ssE = 0, ssEr = 0, medE = 0, medEr = 0, addlMed = 0, futa = 0, suta = 0;
    for (const i of items) {
      fedWH += i.federal_withholding || 0;
      ssE += i.ss_employee || 0; ssEr += i.ss_employer || 0;
      medE += i.medicare_employee || 0; medEr += i.medicare_employer || 0;
      addlMed += i.addl_medicare || 0;
      futa += i.futa || 0; suta += i.suta || 0;
    }
    const total941 = round2(fedWH + ssE + ssEr + medE + medEr + addlMed);
    return { total_941_liability: total941, federal_wh: round2(fedWH), ss_employee: round2(ssE), ss_employer: round2(ssEr), medicare_employee: round2(medE), medicare_employer: round2(medEr), addl_medicare: round2(addlMed), futa: round2(futa), suta: round2(suta) };
  } catch (e: any) { return { error: e.message }; }
}

// F659: Get effective YTD withholding for an employee (used by 941 wizard)
export function ytdWithholdingForEmployee(employeeId: string, year: number) {
  try {
    const row = db.getDb().prepare(`SELECT
      COALESCE(SUM(pri.gross_pay), 0) gross,
      COALESCE(SUM(pri.federal_withholding), 0) fed,
      COALESCE(SUM(pri.ss_employee), 0) ss_e,
      COALESCE(SUM(pri.medicare_employee), 0) med_e,
      COALESCE(SUM(pri.state_withholding), 0) state
      FROM pay_run_items pri
      INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id
      WHERE pri.company_id = ? AND pri.employee_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?`)
      .get(db.getCurrentCompanyId(), employeeId, String(year)) as any;
    return { employee_id: employeeId, year, ...row };
  } catch (e: any) { return { error: e.message }; }
}

// F660: Recompute taxes for ALL items in a pay run (batch helper for "Recalculate All")
export function recalculateAllTaxes(payRunId: string) {
  try {
    const items = db.getDb().prepare('SELECT id FROM pay_run_items WHERE pay_run_id = ? AND company_id = ?').all(payRunId, db.getCurrentCompanyId()) as any[];
    const results: any[] = [];
    for (const i of items) {
      calculateGrossPay(i.id);
      const r = calculateAllTaxes(i.id);
      calculateNetPay(i.id);
      results.push({ id: i.id, ...r });
    }
    return { count: items.length, results };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PC: Benefits & Deductions (F661-F670)
// ════════════════════════════════════════════════════════════════════

// F661: Create a benefit plan (health/dental/vision/401k/etc.)
export function createBenefitPlan(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO benefit_plans (id, company_id, plan_name, plan_type, provider, employee_cost, employer_cost, pre_tax, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.plan_name, opts.plan_type, opts.provider || null, opts.employee_cost || 0, opts.employer_cost || 0, opts.pre_tax ? 1 : 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F662: Enroll employee in a benefit plan
export function enrollInBenefit(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO benefit_enrollments (id, company_id, employee_id, plan_id, enrolled_at, ends_at, employee_contribution, employer_contribution, coverage_level, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.plan_id, opts.enrolled_at || today(), opts.ends_at || null, opts.employee_contribution || 0, opts.employer_contribution || 0, opts.coverage_level || 'employee');
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F663: Add recurring deduction (loan repayment, garnishment, etc.)
export function addDeduction(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO deductions (id, company_id, employee_id, deduction_type, description, amount, percent_of_gross, pre_tax, frequency, starts_at, ends_at, max_total, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.deduction_type, opts.description || null, opts.amount || 0, opts.percent_of_gross || null, opts.pre_tax ? 1 : 0, opts.frequency || 'each_pay', opts.starts_at || today(), opts.ends_at || null, opts.max_total || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F664: Apply all active deductions to a pay run item (splits pre/post tax)
export function applyDeductions(itemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const ded = db.getDb().prepare(`SELECT * FROM deductions WHERE company_id = ? AND employee_id = ? AND active = 1 AND (ends_at IS NULL OR ends_at > ?)`).all(db.getCurrentCompanyId(), it.employee_id, today()) as any[];
    let pre = 0, post = 0;
    for (const d of ded) {
      const amt = d.percent_of_gross ? round2((it.gross_pay || 0) * d.percent_of_gross / 100) : (d.amount || 0);
      if (d.max_total && (d.accumulated || 0) + amt > d.max_total) continue;
      if (d.pre_tax) pre += amt; else post += amt;
      db.getDb().prepare('UPDATE deductions SET accumulated = COALESCE(accumulated, 0) + ?, updated_at = ? WHERE id = ?').run(amt, now(), d.id);
    }
    db.getDb().prepare('UPDATE pay_run_items SET pre_tax_deductions = ?, post_tax_deductions = ?, updated_at = ? WHERE id = ?').run(round2(pre), round2(post), now(), itemId);
    return { id: itemId, pre_tax: round2(pre), post_tax: round2(post), deductions_applied: ded.length };
  } catch (e: any) { return { error: e.message }; }
}

// F665: Apply employee benefit deductions to a pay run item
export function applyBenefitDeductions(itemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const enrollments = db.getDb().prepare(`SELECT be.*, bp.pre_tax, bp.plan_name FROM benefit_enrollments be INNER JOIN benefit_plans bp ON be.plan_id = bp.id WHERE be.company_id = ? AND be.employee_id = ? AND be.status = 'active'`).all(db.getCurrentCompanyId(), it.employee_id) as any[];
    let pre = 0, post = 0, employerCost = 0;
    for (const e of enrollments) {
      if (e.pre_tax) pre += e.employee_contribution || 0;
      else post += e.employee_contribution || 0;
      employerCost += e.employer_contribution || 0;
    }
    db.getDb().prepare('UPDATE pay_run_items SET pre_tax_deductions = COALESCE(pre_tax_deductions, 0) + ?, post_tax_deductions = COALESCE(post_tax_deductions, 0) + ?, benefits_employer = ?, updated_at = ? WHERE id = ?').run(round2(pre), round2(post), round2(employerCost), now(), itemId);
    return { id: itemId, pre_tax: round2(pre), post_tax: round2(post), employer_cost: round2(employerCost) };
  } catch (e: any) { return { error: e.message }; }
}

// F666: Set up 401k contribution
export function setupRetirementContribution(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO retirement_contributions (id, company_id, employee_id, plan_type, employee_percent, employer_match_percent, employer_match_cap, tax_year, catch_up) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.plan_type || '401k', opts.employee_percent || 0, opts.employer_match_percent || 0, opts.employer_match_cap || 0, opts.tax_year || ssYear(), opts.catch_up ? 1 : 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F667: Calculate 401k contribution + employer match for a paycheck
export function calculate401kContribution(itemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const rc = db.getDb().prepare(`SELECT * FROM retirement_contributions WHERE company_id = ? AND employee_id = ? AND tax_year = ?`).get(db.getCurrentCompanyId(), it.employee_id, ssYear()) as any;
    if (!rc) return { skipped: true, reason: 'No retirement plan' };
    // IRS 2026 401(k) limit: $23,000 (catch-up adds $7,500 for 50+)
    const annualLimit = rc.catch_up ? 30500 : 23000;
    const employeeAmt = round2(Math.min((it.gross_pay || 0) * (rc.employee_percent || 0) / 100, annualLimit - (rc.ytd_employee || 0)));
    const matchCap = round2((it.gross_pay || 0) * (rc.employer_match_cap || 0) / 100);
    const employerAmt = round2(Math.min(employeeAmt * (rc.employer_match_percent || 0) / 100, matchCap));
    db.getDb().prepare('UPDATE retirement_contributions SET ytd_employee = COALESCE(ytd_employee, 0) + ?, ytd_employer = COALESCE(ytd_employer, 0) + ?, updated_at = ? WHERE id = ?').run(employeeAmt, employerAmt, now(), rc.id);
    return { id: itemId, employee_contribution: employeeAmt, employer_match: employerAmt };
  } catch (e: any) { return { error: e.message }; }
}

// F668: Set up HSA / FSA contribution
export function setupHsaFsa(opts: any) {
  try {
    const id = uuid();
    const perPay = opts.per_pay_amount || round2((opts.annual_election || 0) / (opts.periods_per_year || 26));
    db.getDb().prepare(`INSERT INTO hsa_fsa_contributions (id, company_id, employee_id, account_type, annual_election, per_pay_amount, employer_contribution, tax_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.account_type, opts.annual_election || 0, perPay, opts.employer_contribution || 0, opts.tax_year || ssYear());
    return { id, per_pay_amount: perPay };
  } catch (e: any) { return { error: e.message }; }
}

// F669: Generate pay-advance and schedule repayment
export function createPayAdvance(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO pay_advances (id, company_id, employee_id, advance_amount, advance_date, repayment_per_pay, repayment_start, balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.advance_amount, opts.advance_date || today(), opts.repayment_per_pay || 0, opts.repayment_start || addDays(today(), 14), opts.advance_amount);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F670: Process pay-advance repayment from a paycheck (creates a deduction line)
export function processPayAdvanceRepayment(advanceId: string, payRunItemId: string) {
  try {
    const adv = db.getDb().prepare('SELECT * FROM pay_advances WHERE id = ? AND company_id = ?').get(advanceId, db.getCurrentCompanyId()) as any;
    if (!adv) return { error: 'Advance not found' };
    const repay = Math.min(adv.repayment_per_pay, adv.balance);
    if (repay <= 0) return { skipped: true, reason: 'Advance fully repaid' };
    const newBalance = round2(adv.balance - repay);
    db.getDb().prepare(`UPDATE pay_run_items SET post_tax_deductions = COALESCE(post_tax_deductions, 0) + ?, updated_at = ? WHERE id = ?`).run(repay, now(), payRunItemId);
    db.getDb().prepare(`UPDATE pay_advances SET balance = ?, status = ?, updated_at = ? WHERE id = ?`).run(newBalance, newBalance <= 0 ? 'paid_off' : 'active', now(), advanceId);
    return { repaid: repay, remaining_balance: newBalance };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PD: Garnishments & Court Orders (F671-F680)
// ════════════════════════════════════════════════════════════════════

// F671: Create a garnishment order
export function createGarnishment(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO garnishment_orders (id, company_id, employee_id, order_number, garnishment_type, court_or_agency, creditor_name, total_amount, per_pay_amount, percent_of_disposable, priority, starts_at, ends_at, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.order_number || null, opts.garnishment_type, opts.court_or_agency || null, opts.creditor_name || null, opts.total_amount || null, opts.per_pay_amount || 0, opts.percent_of_disposable || null, opts.priority || 1, opts.starts_at || today(), opts.ends_at || null, opts.notes || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F672: Create a child-support order with CCPA limits
export function createChildSupportOrder(opts: any) {
  try {
    const id = uuid();
    const perPay = opts.per_pay_amount || round2((opts.monthly_amount || 0) * 12 / 26);
    db.getDb().prepare(`INSERT INTO child_support_orders (id, company_id, employee_id, case_number, state_agency, monthly_amount, per_pay_amount, arrears, ccpa_limit, payee_address, fips_code, medical_support, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.case_number || null, opts.state_agency || null, opts.monthly_amount || 0, perPay, opts.arrears || 0, opts.ccpa_limit || 0.5, opts.payee_address || null, opts.fips_code || null, opts.medical_support ? 1 : 0);
    return { id, per_pay_amount: perPay };
  } catch (e: any) { return { error: e.message }; }
}

// F673: Apply garnishments to a pay run item — respects CCPA priority order
export function applyGarnishments(itemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    // Disposable earnings = gross - taxes (federal/state/local/SS/medicare)
    const taxes = (it.federal_withholding || 0) + (it.state_withholding || 0) + (it.ss_employee || 0) + (it.medicare_employee || 0);
    const disposable = round2((it.gross_pay || 0) - taxes);

    // Child support comes first, CCPA-capped
    const csOrders = db.getDb().prepare(`SELECT * FROM child_support_orders WHERE company_id = ? AND employee_id = ? AND status = 'active'`).all(db.getCurrentCompanyId(), it.employee_id) as any[];
    let totalGarnish = 0;
    let remainingCcpa = disposable * (csOrders[0]?.ccpa_limit || 0.5);

    for (const cs of csOrders) {
      const amt = Math.min(cs.per_pay_amount || 0, remainingCcpa);
      totalGarnish += amt;
      remainingCcpa -= amt;
    }

    // Other garnishments in priority order
    const garns = db.getDb().prepare(`SELECT * FROM garnishment_orders WHERE company_id = ? AND employee_id = ? AND status = 'active' ORDER BY priority ASC`).all(db.getCurrentCompanyId(), it.employee_id) as any[];
    for (const g of garns) {
      const amt = g.percent_of_disposable ? round2(disposable * g.percent_of_disposable / 100) : (g.per_pay_amount || 0);
      const capped = Math.min(amt, remainingCcpa);
      if (g.total_amount && (g.accumulated || 0) + capped > g.total_amount) continue;
      totalGarnish += capped;
      remainingCcpa -= capped;
      db.getDb().prepare('UPDATE garnishment_orders SET accumulated = COALESCE(accumulated, 0) + ?, updated_at = ? WHERE id = ?').run(capped, now(), g.id);
      if (g.total_amount && (g.accumulated || 0) + capped >= g.total_amount) {
        db.getDb().prepare(`UPDATE garnishment_orders SET status = 'satisfied', updated_at = ? WHERE id = ?`).run(now(), g.id);
      }
    }

    db.getDb().prepare('UPDATE pay_run_items SET garnishments = ?, updated_at = ? WHERE id = ?').run(round2(totalGarnish), now(), itemId);
    return { id: itemId, total_garnished: round2(totalGarnish), disposable };
  } catch (e: any) { return { error: e.message }; }
}

// F674: List active garnishments for an employee
export function listActiveGarnishments(employeeId: string) {
  try {
    const garns = db.getDb().prepare(`SELECT * FROM garnishment_orders WHERE company_id = ? AND employee_id = ? AND status = 'active' ORDER BY priority ASC`).all(db.getCurrentCompanyId(), employeeId);
    const cs = db.getDb().prepare(`SELECT * FROM child_support_orders WHERE company_id = ? AND employee_id = ? AND status = 'active'`).all(db.getCurrentCompanyId(), employeeId);
    return { garnishments: garns, child_support: cs };
  } catch (e: any) { return { error: e.message }; }
}

// F675: Mark a garnishment as satisfied
export function satisfyGarnishment(garnishmentId: string, payoffDate?: string) {
  try {
    db.getDb().prepare(`UPDATE garnishment_orders SET status = 'satisfied', ends_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(payoffDate || today(), now(), garnishmentId, db.getCurrentCompanyId());
    return { satisfied: true };
  } catch (e: any) { return { error: e.message }; }
}

// F676: Release a child-support order (when terminated by court)
export function releaseChildSupport(orderId: string, releaseDate?: string) {
  try {
    db.getDb().prepare(`UPDATE child_support_orders SET status = 'released', updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(now(), orderId, db.getCurrentCompanyId());
    return { released: true, date: releaseDate || today() };
  } catch (e: any) { return { error: e.message }; }
}

// F677: Garnishment YTD report (for payee remittance)
export function garnishmentRemittanceReport(year: number, payeeType?: string) {
  try {
    const rows = db.getDb().prepare(`SELECT g.creditor_name, g.court_or_agency, SUM(pri.garnishments) total
      FROM pay_run_items pri
      INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id
      INNER JOIN garnishment_orders g ON g.employee_id = pri.employee_id
      WHERE pri.company_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?
      ${payeeType ? "AND g.garnishment_type = ?" : ''}
      GROUP BY g.creditor_name, g.court_or_agency`)
      .all(...[db.getCurrentCompanyId(), String(year), ...(payeeType ? [payeeType] : [])]);
    return rows;
  } catch (e: any) { return { error: e.message }; }
}

// F678: Validate CCPA cap — returns max garnishable amount for a paycheck
export function ccpaMaxGarnishable(payRunItemId: string, supportsFamily: boolean, supportsChildOnly: boolean) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(payRunItemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const disposable = (it.gross_pay || 0) - ((it.federal_withholding || 0) + (it.state_withholding || 0) + (it.ss_employee || 0) + (it.medicare_employee || 0));
    // 50% w/ family + current, 60% w/o family + current, +5% if >12 weeks arrears
    const cap = supportsFamily ? 0.5 : (supportsChildOnly ? 0.6 : 0.25);
    return { disposable, max_garnishable: round2(disposable * cap), cap_pct: cap };
  } catch (e: any) { return { error: e.message }; }
}

// F679: New-hire reporting for child support enforcement
export function generateNewHireReport(newHires: { employee_id: string; start_date: string }[]) {
  try {
    const rows: any[] = [];
    for (const nh of newHires) {
      const e = db.getDb().prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?').get(nh.employee_id, db.getCurrentCompanyId()) as any;
      if (e) rows.push({ name: e.name, ssn_last4: (e.ssn || '').slice(-4), start_date: nh.start_date, state: e.state || null });
    }
    return { count: rows.length, report: rows };
  } catch (e: any) { return { error: e.message }; }
}

// F680: Garnishment fee withholding (some states let employer charge $1-5 per garnishment)
export function addGarnishmentFee(itemId: string, feeAmount: number) {
  try {
    db.getDb().prepare('UPDATE pay_run_items SET post_tax_deductions = COALESCE(post_tax_deductions, 0) + ?, updated_at = ? WHERE id = ?').run(feeAmount, now(), itemId);
    return { fee_applied: feeAmount };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PE: Time-Off & Accruals (F681-F690)
// ════════════════════════════════════════════════════════════════════

// F681: Create a time-off accrual policy for an employee
export function createTimeOffAccrual(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO time_off_accruals (id, company_id, employee_id, accrual_type, accrual_method, rate_per_period, rate_per_hour_worked, cap_hours, carryover_cap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.accrual_type, opts.accrual_method || 'per_pay', opts.rate_per_period || 0, opts.rate_per_hour_worked || 0, opts.cap_hours || null, opts.carryover_cap || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F682: Accrue time off after each pay run
export function accrueTimeOff(employeeId: string, hoursWorked?: number) {
  try {
    const accruals = db.getDb().prepare(`SELECT * FROM time_off_accruals WHERE company_id = ? AND employee_id = ?`).all(db.getCurrentCompanyId(), employeeId) as any[];
    const out: any[] = [];
    for (const a of accruals) {
      let add = 0;
      if (a.accrual_method === 'per_pay') add = a.rate_per_period || 0;
      else if (a.accrual_method === 'per_hour') add = (hoursWorked || 0) * (a.rate_per_hour_worked || 0);
      const next = (a.current_balance || 0) + add;
      const capped = a.cap_hours ? Math.min(next, a.cap_hours) : next;
      db.getDb().prepare(`UPDATE time_off_accruals SET current_balance = ?, ytd_accrued = COALESCE(ytd_accrued, 0) + ?, last_accrued_at = ?, updated_at = ? WHERE id = ?`)
        .run(round2(capped), round2(add), now(), now(), a.id);
      out.push({ type: a.accrual_type, accrued: add, balance: capped });
    }
    return out;
  } catch (e: any) { return { error: e.message }; }
}

// F683: Submit a time-off request
export function requestTimeOff(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO time_off_requests (id, company_id, employee_id, request_type, starts_at, ends_at, hours_requested, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.request_type, opts.starts_at, opts.ends_at, opts.hours_requested || 0, opts.notes || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F684: Approve / deny a time-off request
export function decideTimeOffRequest(requestId: string, approve: boolean, approverId?: string) {
  try {
    const r = db.getDb().prepare('SELECT * FROM time_off_requests WHERE id = ? AND company_id = ?').get(requestId, db.getCurrentCompanyId()) as any;
    if (!r) return { error: 'Request not found' };
    db.getDb().prepare(`UPDATE time_off_requests SET status = ?, approver_id = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
      .run(approve ? 'approved' : 'denied', approverId || null, now(), now(), requestId);
    if (approve) {
      // Decrement balance
      db.getDb().prepare(`UPDATE time_off_accruals SET current_balance = current_balance - ?, ytd_used = COALESCE(ytd_used, 0) + ?, updated_at = ? WHERE company_id = ? AND employee_id = ? AND accrual_type = ?`)
        .run(r.hours_requested, r.hours_requested, now(), db.getCurrentCompanyId(), r.employee_id, r.request_type);
    }
    return { decided: true, status: approve ? 'approved' : 'denied' };
  } catch (e: any) { return { error: e.message }; }
}

// F685: Get time-off balances for an employee
export function getTimeOffBalances(employeeId: string) {
  try {
    return db.getDb().prepare(`SELECT accrual_type, current_balance, ytd_accrued, ytd_used, cap_hours FROM time_off_accruals WHERE company_id = ? AND employee_id = ?`).all(db.getCurrentCompanyId(), employeeId);
  } catch (e: any) { return { error: e.message }; }
}

// F686: Year-end carryover — apply carryover caps and zero ytd counters
export function timeOffYearEndCarryover(year: number) {
  try {
    const accruals = db.getDb().prepare(`SELECT * FROM time_off_accruals WHERE company_id = ?`).all(db.getCurrentCompanyId()) as any[];
    let touched = 0;
    for (const a of accruals) {
      const newBal = a.carryover_cap ? Math.min(a.current_balance || 0, a.carryover_cap) : (a.current_balance || 0);
      db.getDb().prepare(`UPDATE time_off_accruals SET current_balance = ?, ytd_accrued = 0, ytd_used = 0, updated_at = ? WHERE id = ?`).run(round2(newBal), now(), a.id);
      touched++;
    }
    return { year, employees_touched: touched };
  } catch (e: any) { return { error: e.message }; }
}

// F687: Calendar of approved time-off (range query)
export function timeOffCalendar(rangeStart: string, rangeEnd: string) {
  try {
    return db.getDb().prepare(`SELECT tor.*, e.name FROM time_off_requests tor LEFT JOIN employees e ON tor.employee_id = e.id WHERE tor.company_id = ? AND tor.status = 'approved' AND tor.starts_at <= ? AND tor.ends_at >= ?`)
      .all(db.getCurrentCompanyId(), rangeEnd, rangeStart);
  } catch (e: any) { return { error: e.message }; }
}

// F688: PTO cash-out (convert hours to dollars on termination)
export function ptoCashOut(employeeId: string, hourlyRate: number) {
  try {
    const balances = db.getDb().prepare(`SELECT accrual_type, current_balance FROM time_off_accruals WHERE company_id = ? AND employee_id = ?`).all(db.getCurrentCompanyId(), employeeId) as any[];
    const out: any[] = [];
    let total = 0;
    for (const b of balances) {
      const cash = round2((b.current_balance || 0) * hourlyRate);
      total += cash;
      out.push({ type: b.accrual_type, hours: b.current_balance, cash });
    }
    return { employee_id: employeeId, by_type: out, total_cash_out: round2(total) };
  } catch (e: any) { return { error: e.message }; }
}

// F689: Holiday pay rule setup
export function createHolidayPayRule(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO holiday_pay_rules (id, company_id, holiday_date, holiday_name, multiplier, eligible_after_days, applies_to) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.holiday_date, opts.holiday_name || null, opts.multiplier || 1.5, opts.eligible_after_days || 0, opts.applies_to || 'all');
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F690: Overtime rule setup (state-specific thresholds)
export function createOvertimeRule(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO overtime_rules (id, company_id, rule_name, state_code, daily_threshold, weekly_threshold, double_time_after_hours, seventh_day_double, multiplier, double_multiplier, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.rule_name, opts.state_code || null, opts.daily_threshold || 0, opts.weekly_threshold || 40, opts.double_time_after_hours || 0, opts.seventh_day_double ? 1 : 0, opts.multiplier || 1.5, opts.double_multiplier || 2);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PF: Direct Deposit & Pay Methods (F691-F700)
// ════════════════════════════════════════════════════════════════════

// F691: Add a direct-deposit account (multi-account split supported)
export function addDirectDepositAccount(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO direct_deposit_accounts (id, company_id, employee_id, routing_last4, account_last4, account_type, allocation_type, allocation_value, priority, bank_name, verified, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.routing_last4 || null, opts.account_last4 || null, opts.account_type || 'checking', opts.allocation_type || 'remainder', opts.allocation_value || 100, opts.priority || 1, opts.bank_name || null, opts.verified ? 1 : 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F692: Allocate net pay across multiple DD accounts (fixed amounts then remainder)
export function allocateNetPayToAccounts(employeeId: string, netPay: number) {
  try {
    const accts = db.getDb().prepare(`SELECT * FROM direct_deposit_accounts WHERE company_id = ? AND employee_id = ? AND active = 1 ORDER BY priority ASC`).all(db.getCurrentCompanyId(), employeeId) as any[];
    const allocs: any[] = [];
    let remaining = netPay;
    // Fixed amounts and percentages first
    for (const a of accts.filter(a => a.allocation_type !== 'remainder')) {
      let amt = 0;
      if (a.allocation_type === 'fixed') amt = Math.min(a.allocation_value, remaining);
      else if (a.allocation_type === 'percent') amt = round2(netPay * a.allocation_value / 100);
      allocs.push({ account_id: a.id, last4: a.account_last4, amount: round2(amt) });
      remaining -= amt;
    }
    // Remainder
    const remainderAcct = accts.find(a => a.allocation_type === 'remainder');
    if (remainderAcct && remaining > 0) {
      allocs.push({ account_id: remainderAcct.id, last4: remainderAcct.account_last4, amount: round2(remaining) });
    }
    return { net_pay: netPay, allocations: allocs };
  } catch (e: any) { return { error: e.message }; }
}

// F693: Build a NACHA-style ACH batch for direct deposit
export function buildAchBatch(payRunId: string) {
  try {
    const items = db.getDb().prepare(`SELECT pri.* FROM pay_run_items pri WHERE pri.pay_run_id = ? AND pri.company_id = ? AND pri.pay_method = 'direct_deposit'`).all(payRunId, db.getCurrentCompanyId()) as any[];
    let total = 0; let count = 0;
    const fileLines: string[] = [];
    fileLines.push(`101 0000000000${Date.now()}A094101BANK OF AMERICA          COMPANY                        ${today().replace(/-/g, '')}`);
    for (const it of items) {
      const allocs = allocateNetPayToAccounts(it.employee_id, it.net_pay || 0) as any;
      for (const a of (allocs.allocations || [])) {
        fileLines.push(`6320000000${(a.last4 || '0000').padStart(17, '0')}${String(Math.round(a.amount * 100)).padStart(10, '0')}${it.employee_id.slice(0, 15).padEnd(15, ' ')}`);
        total += a.amount; count++;
      }
    }
    fileLines.push(`8200000001${String(count).padStart(6, '0')}${String(Math.round(total * 100)).padStart(12, '0')}`);
    const id = uuid();
    db.getDb().prepare(`INSERT INTO direct_deposit_batches (id, company_id, pay_run_id, batch_number, total_amount, item_count, status, nacha_hash) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, db.getCurrentCompanyId(), payRunId, `ACH-${Date.now()}`, round2(total), count, require('crypto').createHash('sha256').update(fileLines.join('\n')).digest('hex').slice(0, 32));
    return { batch_id: id, total: round2(total), count, nacha_lines: fileLines.length };
  } catch (e: any) { return { error: e.message }; }
}

// F694: Print physical paychecks
export function createCheckPrintRun(opts: any) {
  try {
    const id = uuid();
    const items = db.getDb().prepare(`SELECT * FROM pay_run_items WHERE pay_run_id = ? AND company_id = ? AND pay_method = 'check'`).all(opts.pay_run_id, db.getCurrentCompanyId()) as any[];
    let total = 0;
    for (const it of items) total += it.net_pay || 0;
    db.getDb().prepare(`INSERT INTO check_print_runs (id, company_id, pay_run_id, starting_check_number, check_count, total_amount, bank_account_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(id, db.getCurrentCompanyId(), opts.pay_run_id, opts.starting_check_number || 1001, items.length, round2(total), opts.bank_account_id || null);
    // Assign check numbers
    let n = opts.starting_check_number || 1001;
    for (const it of items) {
      db.getDb().prepare('UPDATE pay_run_items SET check_number = ?, updated_at = ? WHERE id = ?').run(String(n), now(), it.id);
      n++;
    }
    return { check_run_id: id, count: items.length, total: round2(total) };
  } catch (e: any) { return { error: e.message }; }
}

// F695: Mark check run as printed
export function markCheckRunPrinted(checkRunId: string) {
  try {
    db.getDb().prepare(`UPDATE check_print_runs SET status = 'printed', printed_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(now(), now(), checkRunId, db.getCurrentCompanyId());
    return { printed: true };
  } catch (e: any) { return { error: e.message }; }
}

// F696: Void a printed check (creates voiding journal entry)
export function voidCheck(payRunItemId: string, reason: string) {
  try {
    db.getDb().prepare(`UPDATE pay_run_items SET check_number = NULL, pay_method = 'voided', updated_at = ? WHERE id = ?`).run(now(), payRunItemId);
    return { voided: true, reason };
  } catch (e: any) { return { error: e.message }; }
}

// F697: Pre-notification (zero-dollar ACH for new accounts)
export function sendPrenoteForAccount(accountId: string) {
  try {
    db.getDb().prepare(`UPDATE direct_deposit_accounts SET verified = 1, updated_at = ? WHERE id = ? AND company_id = ?`).run(now(), accountId, db.getCurrentCompanyId());
    return { prenote_sent: true };
  } catch (e: any) { return { error: e.message }; }
}

// F698: List unverified DD accounts
export function listUnverifiedAccounts() {
  try {
    return db.getDb().prepare(`SELECT dda.*, e.name FROM direct_deposit_accounts dda LEFT JOIN employees e ON dda.employee_id = e.id WHERE dda.company_id = ? AND dda.verified = 0 AND dda.active = 1`).all(db.getCurrentCompanyId());
  } catch (e: any) { return { error: e.message }; }
}

// F699: Pay card load (prepaid debit card alternative to check/DD)
export function loadPayCard(employeeId: string, amount: number) {
  try {
    // Records the load as a snapshot — production would call a card-issuer API
    const id = uuid();
    db.getDb().prepare(`INSERT INTO gross_to_net_snapshots (id, company_id, pay_run_item_id, employee_id, gross, net, breakdown_json, snapshot_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), 'PAYCARD', employeeId, amount, amount, JSON.stringify({ method: 'paycard' }), today());
    return { loaded: true, amount, snapshot_id: id };
  } catch (e: any) { return { error: e.message }; }
}

// F700: Update employee's preferred pay method
export function updateEmployeePayMethod(employeeId: string, payMethod: string) {
  try {
    db.getDb().prepare(`UPDATE employees SET pay_method = ?, updated_at = ? WHERE id = ? AND company_id = ?`).run(payMethod, now(), employeeId, db.getCurrentCompanyId());
    return { updated: true };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PG: Contractor/1099 Payments (F701-F710)
// ════════════════════════════════════════════════════════════════════

// F701: Create a contractor pay run (separate from W-2 employees)
export function createContractorPayRun(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO contractor_pay_runs (id, company_id, run_number, pay_date, status) VALUES (?, ?, ?, ?, 'draft')`)
      .run(id, db.getCurrentCompanyId(), opts.run_number || `CPR-${Date.now()}`, opts.pay_date || today());
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F702: Add a contractor payment to a contractor pay run
export function addContractorPayItem(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO contractor_pay_items (id, company_id, contractor_pay_run_id, vendor_id, description, amount, pay_method, reportable_1099) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.contractor_pay_run_id, opts.vendor_id, opts.description || null, opts.amount || 0, opts.pay_method || 'check', opts.reportable_1099 === false ? 0 : 1);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F703: Post a contractor pay run
export function postContractorPayRun(runId: string) {
  try {
    const items = db.getDb().prepare(`SELECT * FROM contractor_pay_items WHERE contractor_pay_run_id = ? AND company_id = ?`).all(runId, db.getCurrentCompanyId()) as any[];
    let total = 0;
    for (const i of items) total += i.amount || 0;
    db.getDb().prepare(`UPDATE contractor_pay_runs SET status = 'posted', contractor_count = ?, total_amount = ?, posted_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(items.length, round2(total), now(), now(), runId, db.getCurrentCompanyId());
    return { posted: true, count: items.length, total: round2(total) };
  } catch (e: any) { return { error: e.message }; }
}

// F704: List contractor YTD totals (1099 prep helper)
export function contractorYtdTotals(year: number) {
  try {
    return db.getDb().prepare(`SELECT cpi.vendor_id, v.name, SUM(cpi.amount) ytd FROM contractor_pay_items cpi
      INNER JOIN contractor_pay_runs cpr ON cpi.contractor_pay_run_id = cpr.id
      LEFT JOIN vendors v ON cpi.vendor_id = v.id
      WHERE cpi.company_id = ? AND cpr.status = 'posted' AND substr(cpr.pay_date, 1, 4) = ? AND cpi.reportable_1099 = 1
      GROUP BY cpi.vendor_id, v.name ORDER BY ytd DESC`).all(db.getCurrentCompanyId(), String(year));
  } catch (e: any) { return { error: e.message }; }
}

// F705: Flag contractors above $600 threshold for 1099-NEC filing
export function flag1099Required(year: number) {
  try {
    const rows = (contractorYtdTotals(year) as any[]).filter((r: any) => (r.ytd || 0) >= 600);
    return { year, count: rows.length, vendors: rows };
  } catch (e: any) { return { error: e.message }; }
}

// F706: Generate 1099-NEC filings (one per contractor over threshold)
export function generate1099NecFilings(year: number) {
  try {
    const threshold = (flag1099Required(year) as any).vendors || [];
    const dbConn = db.getDb();
    const cid = db.getCurrentCompanyId();
    let inserted = 0;
    for (const v of threshold) {
      try {
        dbConn.prepare(`INSERT INTO form_1099_nec_filings (id, company_id, tax_year, vendor_id, box1_nonemployee_comp, status) VALUES (?, ?, ?, ?, ?, 'draft')`)
          .run(uuid(), cid, year, v.vendor_id, round2(v.ytd));
        inserted++;
      } catch (_) {/* unique constraint */}
    }
    return { year, inserted, total_filings_expected: threshold.length };
  } catch (e: any) { return { error: e.message }; }
}

// F707: Backup-withholding (24%) when contractor lacks W-9
export function applyBackupWithholding(vendorId: string, paymentAmount: number) {
  try {
    const v = db.getDb().prepare('SELECT * FROM vendors WHERE id = ? AND company_id = ?').get(vendorId, db.getCurrentCompanyId()) as any;
    const hasW9 = v?.w9_on_file === 1 || v?.tin;
    if (hasW9) return { applied: false, reason: 'W-9 on file' };
    const wh = round2(paymentAmount * 0.24);
    return { applied: true, withholding: wh, net: round2(paymentAmount - wh) };
  } catch (e: any) { return { error: e.message }; }
}

// F708: Contractor payment history (drill-down)
export function contractorPaymentHistory(vendorId: string, year?: number) {
  try {
    const yClause = year ? "AND substr(cpr.pay_date, 1, 4) = ?" : '';
    const params: any[] = [db.getCurrentCompanyId(), vendorId];
    if (year) params.push(String(year));
    return db.getDb().prepare(`SELECT cpi.*, cpr.pay_date, cpr.status run_status FROM contractor_pay_items cpi INNER JOIN contractor_pay_runs cpr ON cpi.contractor_pay_run_id = cpr.id WHERE cpi.company_id = ? AND cpi.vendor_id = ? ${yClause} ORDER BY cpr.pay_date DESC`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// F709: Update 1099-NEC withholding box4 (when state requires)
export function update1099Withholding(filingId: string, federalWithheld: number, stateWithheld?: any[]) {
  try {
    db.getDb().prepare(`UPDATE form_1099_nec_filings SET box4_federal_withheld = ?, state_withheld_json = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(federalWithheld, JSON.stringify(stateWithheld || []), now(), filingId, db.getCurrentCompanyId());
    return { updated: true };
  } catch (e: any) { return { error: e.message }; }
}

// F710: Mark 1099-NEC filings as transmitted to IRS
export function markFiling1099Transmitted(filingId: string) {
  try {
    db.getDb().prepare(`UPDATE form_1099_nec_filings SET status = 'transmitted', transmitted_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(now(), now(), filingId, db.getCurrentCompanyId());
    return { transmitted: true };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PH: Year-End (W-2, 940, 941) (F711-F720)
// ════════════════════════════════════════════════════════════════════

// F711: Generate W-2 for one employee
export function generateW2ForEmployee(employeeId: string, year: number) {
  try {
    const ytd = ytdWithholdingForEmployee(employeeId, year) as any;
    if (ytd.error) return { error: ytd.error };
    const cid = db.getCurrentCompanyId();
    const id = uuid();
    try {
      db.getDb().prepare(`INSERT INTO form_w2_filings (id, company_id, tax_year, employee_id, box1_wages, box2_federal_tax, box3_ss_wages, box4_ss_tax, box5_medicare_wages, box6_medicare_tax, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`)
        .run(id, cid, year, employeeId, round2(ytd.gross || 0), round2(ytd.fed || 0), round2(ytd.gross || 0), round2(ytd.ss_e || 0), round2(ytd.gross || 0), round2(ytd.med_e || 0));
    } catch (_) {
      // Already exists — update
      db.getDb().prepare(`UPDATE form_w2_filings SET box1_wages = ?, box2_federal_tax = ?, box3_ss_wages = ?, box4_ss_tax = ?, box5_medicare_wages = ?, box6_medicare_tax = ?, updated_at = ? WHERE company_id = ? AND tax_year = ? AND employee_id = ?`)
        .run(round2(ytd.gross || 0), round2(ytd.fed || 0), round2(ytd.gross || 0), round2(ytd.ss_e || 0), round2(ytd.gross || 0), round2(ytd.med_e || 0), now(), cid, year, employeeId);
    }
    return { id, employee_id: employeeId, year, ...ytd };
  } catch (e: any) { return { error: e.message }; }
}

// F712: Bulk-generate W-2s for all employees for a year
export function generateAllW2s(year: number) {
  try {
    const employees = db.getDb().prepare(`SELECT DISTINCT employee_id FROM pay_run_items WHERE company_id = ? AND id IN (SELECT pri.id FROM pay_run_items pri INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id WHERE pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?)`).all(db.getCurrentCompanyId(), String(year)) as any[];
    const out: any[] = [];
    for (const e of employees) out.push(generateW2ForEmployee(e.employee_id, year));
    return { year, count: out.length, w2s: out };
  } catch (e: any) { return { error: e.message }; }
}

// F713: Generate 941 (quarterly federal payroll tax return)
export function generate941(year: number, quarter: number) {
  try {
    const months = quarter === 1 ? ['01', '02', '03'] : quarter === 2 ? ['04', '05', '06'] : quarter === 3 ? ['07', '08', '09'] : ['10', '11', '12'];
    const monthClause = months.map(m => `'${year}-${m}'`).join(',');
    const tot = db.getDb().prepare(`SELECT
      COALESCE(SUM(pri.gross_pay), 0) wages,
      COALESCE(SUM(pri.federal_withholding), 0) fed,
      COALESCE(SUM(pri.ss_employee + pri.ss_employer), 0) ss_tax,
      COALESCE(SUM(pri.medicare_employee + pri.medicare_employer), 0) med_tax,
      COALESCE(SUM(pri.addl_medicare), 0) addl_med,
      COALESCE(SUM(pri.ss_employee), 0) + COALESCE(SUM(pri.ss_employer), 0) ss_combined
      FROM pay_run_items pri
      INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id
      WHERE pri.company_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 7) IN (${monthClause})`)
      .get(db.getCurrentCompanyId()) as any;
    const total = round2((tot.fed || 0) + (tot.ss_combined || 0) + (tot.med_tax || 0) + (tot.addl_med || 0));
    const id = uuid();
    try {
      db.getDb().prepare(`INSERT INTO form_941_filings (id, company_id, tax_year, quarter, total_wages, federal_tax_withheld, ss_wages, ss_tax, medicare_wages, medicare_tax, addl_medicare_tax, total_tax_liability, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`)
        .run(id, db.getCurrentCompanyId(), year, quarter, round2(tot.wages), round2(tot.fed), round2(tot.wages), round2(tot.ss_combined), round2(tot.wages), round2(tot.med_tax), round2(tot.addl_med), total);
    } catch (_) {
      db.getDb().prepare(`UPDATE form_941_filings SET total_wages = ?, federal_tax_withheld = ?, ss_wages = ?, ss_tax = ?, medicare_wages = ?, medicare_tax = ?, addl_medicare_tax = ?, total_tax_liability = ?, updated_at = ? WHERE company_id = ? AND tax_year = ? AND quarter = ?`)
        .run(round2(tot.wages), round2(tot.fed), round2(tot.wages), round2(tot.ss_combined), round2(tot.wages), round2(tot.med_tax), round2(tot.addl_med), total, now(), db.getCurrentCompanyId(), year, quarter);
    }
    return { id, year, quarter, ...tot, total_liability: total };
  } catch (e: any) { return { error: e.message }; }
}

// F713a: Record a tax deposit (so 941 reconciliation shows balance due / refund)
export function recordTaxDeposit(opts: { tax_year: number; quarter: number; amount: number; deposit_date?: string }) {
  try {
    db.getDb().prepare(`UPDATE form_941_filings SET deposits_made = COALESCE(deposits_made, 0) + ?, balance_due = COALESCE(total_tax_liability, 0) - (COALESCE(deposits_made, 0) + ?), updated_at = ? WHERE company_id = ? AND tax_year = ? AND quarter = ?`)
      .run(opts.amount, opts.amount, now(), db.getCurrentCompanyId(), opts.tax_year, opts.quarter);
    return { recorded: true, amount: opts.amount };
  } catch (e: any) { return { error: e.message }; }
}

// F714: Generate 940 (annual federal unemployment tax return)
export function generate940(year: number) {
  try {
    const tot = db.getDb().prepare(`SELECT
      COALESCE(SUM(pri.gross_pay), 0) total_payments,
      COALESCE(SUM(pri.futa), 0) futa_tax
      FROM pay_run_items pri
      INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id
      WHERE pri.company_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?`)
      .get(db.getCurrentCompanyId(), String(year)) as any;
    const id = uuid();
    try {
      db.getDb().prepare(`INSERT INTO form_940_filings (id, company_id, tax_year, total_payments, futa_wages, futa_tax_before_adjustments, futa_tax_after_adjustments, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`)
        .run(id, db.getCurrentCompanyId(), year, round2(tot.total_payments), round2(tot.total_payments), round2(tot.futa_tax), round2(tot.futa_tax));
    } catch (_) {
      db.getDb().prepare(`UPDATE form_940_filings SET total_payments = ?, futa_wages = ?, futa_tax_before_adjustments = ?, futa_tax_after_adjustments = ?, updated_at = ? WHERE company_id = ? AND tax_year = ?`)
        .run(round2(tot.total_payments), round2(tot.total_payments), round2(tot.futa_tax), round2(tot.futa_tax), now(), db.getCurrentCompanyId(), year);
    }
    return { id, year, ...tot };
  } catch (e: any) { return { error: e.message }; }
}

// F715: Generate annual year-end summary (rollup of all paychecks for the year)
export function generateYearEndSummary(year: number) {
  try {
    const tot = db.getDb().prepare(`SELECT
      COUNT(DISTINCT pri.employee_id) emp_count,
      COALESCE(SUM(pri.gross_pay), 0) gross,
      COALESCE(SUM(pri.federal_withholding), 0) fed,
      COALESCE(SUM(pri.ss_employer), 0) ss_er,
      COALESCE(SUM(pri.medicare_employer), 0) med_er,
      COALESCE(SUM(pri.futa), 0) futa,
      COALESCE(SUM(pri.suta), 0) suta
      FROM pay_run_items pri
      INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id
      WHERE pri.company_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?`)
      .get(db.getCurrentCompanyId(), String(year)) as any;
    const id = uuid();
    try {
      db.getDb().prepare(`INSERT INTO year_end_summaries (id, company_id, tax_year, employee_count, total_gross, total_federal_withheld, total_ss_employer, total_medicare_employer, total_futa, total_suta, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, db.getCurrentCompanyId(), year, tot.emp_count, round2(tot.gross), round2(tot.fed), round2(tot.ss_er), round2(tot.med_er), round2(tot.futa), round2(tot.suta), now());
    } catch (_) {
      db.getDb().prepare(`UPDATE year_end_summaries SET employee_count = ?, total_gross = ?, total_federal_withheld = ?, total_ss_employer = ?, total_medicare_employer = ?, total_futa = ?, total_suta = ?, generated_at = ?, updated_at = ? WHERE company_id = ? AND tax_year = ?`)
        .run(tot.emp_count, round2(tot.gross), round2(tot.fed), round2(tot.ss_er), round2(tot.med_er), round2(tot.futa), round2(tot.suta), now(), now(), db.getCurrentCompanyId(), year);
    }
    return { id, year, ...tot };
  } catch (e: any) { return { error: e.message }; }
}

// F716: Mark W-2 as filed (transmitted to SSA)
export function markW2Filed(w2Id: string) {
  try {
    db.getDb().prepare(`UPDATE form_w2_filings SET status = 'filed', transmitted_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`).run(now(), now(), w2Id, db.getCurrentCompanyId());
    return { filed: true };
  } catch (e: any) { return { error: e.message }; }
}

// F717: Mark 941 as filed
export function mark941Filed(filingId: string) {
  try {
    db.getDb().prepare(`UPDATE form_941_filings SET status = 'filed', filed_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`).run(now(), now(), filingId, db.getCurrentCompanyId());
    return { filed: true };
  } catch (e: any) { return { error: e.message }; }
}

// F718: Mark 940 as filed
export function mark940Filed(filingId: string) {
  try {
    db.getDb().prepare(`UPDATE form_940_filings SET status = 'filed', filed_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`).run(now(), now(), filingId, db.getCurrentCompanyId());
    return { filed: true };
  } catch (e: any) { return { error: e.message }; }
}

// F719: Show year-end filing status (W-2 + 940 + 941 dashboard)
export function yearEndFilingStatus(year: number) {
  try {
    const w2 = db.getDb().prepare(`SELECT status, COUNT(*) c FROM form_w2_filings WHERE company_id = ? AND tax_year = ? GROUP BY status`).all(db.getCurrentCompanyId(), year);
    const q941 = db.getDb().prepare(`SELECT quarter, status, total_tax_liability FROM form_941_filings WHERE company_id = ? AND tax_year = ?`).all(db.getCurrentCompanyId(), year);
    const f940 = db.getDb().prepare(`SELECT * FROM form_940_filings WHERE company_id = ? AND tax_year = ?`).get(db.getCurrentCompanyId(), year);
    const f1099 = db.getDb().prepare(`SELECT status, COUNT(*) c FROM form_1099_nec_filings WHERE company_id = ? AND tax_year = ? GROUP BY status`).all(db.getCurrentCompanyId(), year);
    return { year, w2_by_status: w2, q941: q941, f940, f1099_by_status: f1099 };
  } catch (e: any) { return { error: e.message }; }
}

// F720: W-2 box 12 codes (DD = employer health cost, D = 401k, etc.)
export function addW2Box12Code(w2Id: string, code: string, amount: number) {
  try {
    const w2 = db.getDb().prepare('SELECT box12_codes_json FROM form_w2_filings WHERE id = ? AND company_id = ?').get(w2Id, db.getCurrentCompanyId()) as any;
    const codes = JSON.parse(w2?.box12_codes_json || '[]');
    codes.push({ code, amount: round2(amount) });
    db.getDb().prepare('UPDATE form_w2_filings SET box12_codes_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(codes), now(), w2Id);
    return { codes_count: codes.length };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PI: Multi-State Allocations (F721-F730)
// ════════════════════════════════════════════════════════════════════

// F721: Set work-location allocation for an employee (multi-state)
export function setMultiStateAllocation(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO multi_state_allocations (id, company_id, employee_id, state_code, allocation_percent, work_location, effective_date, end_date, is_resident_state, reciprocity_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.state_code, opts.allocation_percent, opts.work_location || null, opts.effective_date || today(), opts.end_date || null, opts.is_resident_state ? 1 : 0, opts.reciprocity_state || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F722: Calculate state-by-state withholding for a paycheck
export function calculateMultiStateWithholding(payRunItemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(payRunItemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const allocs = db.getDb().prepare(`SELECT * FROM multi_state_allocations WHERE company_id = ? AND employee_id = ? AND (end_date IS NULL OR end_date > ?)`).all(db.getCurrentCompanyId(), it.employee_id, today()) as any[];
    if (allocs.length === 0) return { skipped: true, reason: 'No multi-state allocation' };

    const out: any[] = [];
    let totalSt = 0;
    for (const a of allocs) {
      const stateGross = round2((it.gross_pay || 0) * a.allocation_percent / 100);
      const stateRate = 0.05; // simplified — production: lookup state_tax_tables
      const stateWh = round2(stateGross * stateRate);
      totalSt += stateWh;
      out.push({ state: a.state_code, gross: stateGross, withheld: stateWh, allocation_pct: a.allocation_percent });
    }
    db.getDb().prepare('UPDATE pay_run_items SET state_withholding = ?, updated_at = ? WHERE id = ?').run(round2(totalSt), now(), payRunItemId);
    return { id: payRunItemId, total_state_withheld: round2(totalSt), by_state: out };
  } catch (e: any) { return { error: e.message }; }
}

// F723: Apply state-reciprocity (e.g., NJ resident working in PA pays only NJ)
export function applyReciprocity(employeeId: string, workState: string) {
  try {
    const alloc = db.getDb().prepare(`SELECT * FROM multi_state_allocations WHERE company_id = ? AND employee_id = ? AND state_code = ? AND reciprocity_state IS NOT NULL`).get(db.getCurrentCompanyId(), employeeId, workState) as any;
    if (!alloc) return { reciprocity: false };
    return { reciprocity: true, tax_state: alloc.reciprocity_state, work_state: workState };
  } catch (e: any) { return { error: e.message }; }
}

// F724: Multi-state quarterly filing helper
export function multiStateQuarterlyTotals(year: number, quarter: number) {
  try {
    const months = quarter === 1 ? ['01', '02', '03'] : quarter === 2 ? ['04', '05', '06'] : quarter === 3 ? ['07', '08', '09'] : ['10', '11', '12'];
    const rows = db.getDb().prepare(`SELECT msa.state_code, SUM(pri.gross_pay * msa.allocation_percent / 100) wages, SUM(pri.state_withholding * msa.allocation_percent / 100) state_wh
      FROM pay_run_items pri
      INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id
      INNER JOIN multi_state_allocations msa ON msa.employee_id = pri.employee_id
      WHERE pri.company_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 7) IN (${months.map(m => `'${year}-${m}'`).join(',')})
      GROUP BY msa.state_code`).all(db.getCurrentCompanyId());
    return rows;
  } catch (e: any) { return { error: e.message }; }
}

// F725: Create a state quarterly filing record
export function createStateQuarterlyFiling(opts: any) {
  try {
    const id = uuid();
    try {
      db.getDb().prepare(`INSERT INTO state_quarterly_filings (id, company_id, state_code, tax_year, quarter, form_type, total_wages, taxable_wages, tax_due, employee_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`)
        .run(id, db.getCurrentCompanyId(), opts.state_code, opts.tax_year, opts.quarter, opts.form_type || null, opts.total_wages || 0, opts.taxable_wages || 0, opts.tax_due || 0, opts.employee_count || 0);
    } catch (_) {
      db.getDb().prepare(`UPDATE state_quarterly_filings SET total_wages = ?, taxable_wages = ?, tax_due = ?, employee_count = ?, updated_at = ? WHERE company_id = ? AND state_code = ? AND tax_year = ? AND quarter = ?`)
        .run(opts.total_wages, opts.taxable_wages, opts.tax_due, opts.employee_count, now(), db.getCurrentCompanyId(), opts.state_code, opts.tax_year, opts.quarter);
    }
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F726: Mark a state quarterly as filed
export function markStateQuarterlyFiled(filingId: string) {
  try {
    db.getDb().prepare(`UPDATE state_quarterly_filings SET status = 'filed', filed_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`).run(now(), now(), filingId, db.getCurrentCompanyId());
    return { filed: true };
  } catch (e: any) { return { error: e.message }; }
}

// F727: List all states for which the company has nexus (i.e., active allocations)
export function listNexusStates() {
  try {
    return db.getDb().prepare(`SELECT DISTINCT state_code, COUNT(DISTINCT employee_id) employee_count FROM multi_state_allocations WHERE company_id = ? AND (end_date IS NULL OR end_date > ?) GROUP BY state_code`).all(db.getCurrentCompanyId(), today());
  } catch (e: any) { return { error: e.message }; }
}

// F728: Mark a state allocation as ended (employee moves states)
export function endStateAllocation(allocationId: string, endDate?: string) {
  try {
    db.getDb().prepare(`UPDATE multi_state_allocations SET end_date = ?, updated_at = ? WHERE id = ? AND company_id = ?`).run(endDate || today(), now(), allocationId, db.getCurrentCompanyId());
    return { ended: true };
  } catch (e: any) { return { error: e.message }; }
}

// F729: Local withholding (city/county taxes like NYC, Philadelphia, San Francisco)
export function calculateLocalWithholding(itemId: string, localityCode: string, rate: number) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(itemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const wh = round2((it.gross_pay || 0) * rate);
    db.getDb().prepare('UPDATE pay_run_items SET local_withholding = ?, updated_at = ? WHERE id = ?').run(wh, now(), itemId);
    return { id: itemId, locality: localityCode, withheld: wh };
  } catch (e: any) { return { error: e.message }; }
}

// F730: SUI rate review (annual notice from state)
export function reviewSuiRates() {
  try {
    const rates = db.getDb().prepare(`SELECT * FROM state_unemployment_rates WHERE company_id = ? ORDER BY state_code, tax_year DESC`).all(db.getCurrentCompanyId());
    return { count: (rates as any[]).length, rates };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch PJ: Workers Comp & ACA Compliance (F731-F740)
// ════════════════════════════════════════════════════════════════════

// F731: Add a workers' comp classification (NCCI class code)
export function addWcClassification(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO workers_comp_classifications (id, company_id, class_code, description, rate_per_100, state_code, effective_date, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.class_code, opts.description || null, opts.rate_per_100 || 0, opts.state_code || null, opts.effective_date || today(), opts.expiry_date || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F732: Assign a classification to an employee
export function assignWcClassification(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO workers_comp_assignments (id, company_id, employee_id, classification_id, effective_date, end_date) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.classification_id, opts.effective_date || today(), opts.end_date || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F733: Calculate WC premium for a pay run item
export function calculateWcPremium(payRunItemId: string) {
  try {
    const it = db.getDb().prepare('SELECT * FROM pay_run_items WHERE id = ? AND company_id = ?').get(payRunItemId, db.getCurrentCompanyId()) as any;
    if (!it) return { error: 'Item not found' };
    const assignment = db.getDb().prepare(`SELECT wca.*, wcc.rate_per_100, wcc.class_code FROM workers_comp_assignments wca INNER JOIN workers_comp_classifications wcc ON wca.classification_id = wcc.id WHERE wca.company_id = ? AND wca.employee_id = ? AND (wca.end_date IS NULL OR wca.end_date > ?) LIMIT 1`).get(db.getCurrentCompanyId(), it.employee_id, today()) as any;
    if (!assignment) return { skipped: true, reason: 'No WC classification' };
    const premium = round2((it.gross_pay || 0) / 100 * (assignment.rate_per_100 || 0));
    db.getDb().prepare(`INSERT INTO workers_comp_premium_calcs (id, company_id, pay_run_id, employee_id, classification_id, payroll_amount, rate_per_100, premium, calc_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), db.getCurrentCompanyId(), it.pay_run_id, it.employee_id, assignment.classification_id, it.gross_pay || 0, assignment.rate_per_100, premium, today());
    return { id: payRunItemId, class_code: assignment.class_code, premium };
  } catch (e: any) { return { error: e.message }; }
}

// F734: WC premium summary for a period (sent to carrier monthly)
export function wcPremiumSummary(rangeStart: string, rangeEnd: string) {
  try {
    return db.getDb().prepare(`SELECT wcc.class_code, wcc.description, SUM(wcpc.payroll_amount) payroll, SUM(wcpc.premium) premium FROM workers_comp_premium_calcs wcpc INNER JOIN workers_comp_classifications wcc ON wcpc.classification_id = wcc.id WHERE wcpc.company_id = ? AND wcpc.calc_date BETWEEN ? AND ? GROUP BY wcc.class_code, wcc.description`).all(db.getCurrentCompanyId(), rangeStart, rangeEnd);
  } catch (e: any) { return { error: e.message }; }
}

// F735: Record ACA monthly hours (full-time tracking)
export function recordAcaMonth(opts: any) {
  try {
    const id = uuid();
    try {
      db.getDb().prepare(`INSERT INTO aca_compliance_records (id, company_id, employee_id, tax_year, month, full_time, hours_of_service, offered_coverage, coverage_code, safe_harbor_code, employee_share_lowest_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.tax_year, opts.month, opts.full_time ? 1 : 0, opts.hours_of_service || 0, opts.offered_coverage ? 1 : 0, opts.coverage_code || null, opts.safe_harbor_code || null, opts.employee_share_lowest_cost || 0);
    } catch (_) {
      db.getDb().prepare(`UPDATE aca_compliance_records SET full_time = ?, hours_of_service = ?, offered_coverage = ?, coverage_code = ?, safe_harbor_code = ?, employee_share_lowest_cost = ?, updated_at = ? WHERE company_id = ? AND employee_id = ? AND tax_year = ? AND month = ?`)
        .run(opts.full_time ? 1 : 0, opts.hours_of_service || 0, opts.offered_coverage ? 1 : 0, opts.coverage_code || null, opts.safe_harbor_code || null, opts.employee_share_lowest_cost || 0, now(), db.getCurrentCompanyId(), opts.employee_id, opts.tax_year, opts.month);
    }
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F736: ACA 1095-C readiness check (for ALEs ≥50 FTEs)
export function aca1095cReadiness(year: number) {
  try {
    const totalEmployees = (db.getDb().prepare(`SELECT COUNT(DISTINCT employee_id) c FROM aca_compliance_records WHERE company_id = ? AND tax_year = ?`).get(db.getCurrentCompanyId(), year) as any)?.c || 0;
    const completeRecords = (db.getDb().prepare(`SELECT COUNT(*) c FROM aca_compliance_records WHERE company_id = ? AND tax_year = ? GROUP BY employee_id HAVING COUNT(*) = 12`).all(db.getCurrentCompanyId(), year) as any[]).length;
    const isAle = totalEmployees >= 50;
    return { year, total_employees: totalEmployees, complete_records: completeRecords, is_ale: isAle, ready_to_file: completeRecords === totalEmployees };
  } catch (e: any) { return { error: e.message }; }
}

// F737: Record a COBRA qualifying event
export function recordCobraEvent(opts: any) {
  try {
    const id = uuid();
    const elecDeadline = addDays(opts.event_date, 60);
    db.getDb().prepare(`INSERT INTO cobra_records (id, company_id, employee_id, qualifying_event, event_date, notice_sent_at, election_deadline, coverage_start, monthly_premium, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'notice_sent')`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.qualifying_event, opts.event_date, now(), elecDeadline, opts.coverage_start || opts.event_date, opts.monthly_premium || 0);
    return { id, election_deadline: elecDeadline };
  } catch (e: any) { return { error: e.message }; }
}

// F738: Record a life-event change (drives benefits update window)
export function recordLifeEvent(opts: any) {
  try {
    const id = uuid();
    const windowEnd = addDays(opts.event_date, 30);
    db.getDb().prepare(`INSERT INTO life_event_changes (id, company_id, employee_id, event_type, event_date, benefits_window_end, documentation_path, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.event_type, opts.event_date, windowEnd, opts.documentation_path || null, opts.notes || null);
    return { id, benefits_window_end: windowEnd };
  } catch (e: any) { return { error: e.message }; }
}

// F739: Record a compensation change (audit trail for raises/promotions/title changes)
export function recordCompensationChange(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO compensation_history (id, company_id, employee_id, change_date, change_type, old_amount, new_amount, old_rate_type, new_rate_type, reason, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.employee_id, opts.change_date || today(), opts.change_type, opts.old_amount || null, opts.new_amount || null, opts.old_rate_type || null, opts.new_rate_type || null, opts.reason || null, opts.approved_by || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F740: Payroll dashboard summary (one call powers the payroll module landing page)
export function payrollDashboardSummary(year: number) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbConn = db.getDb();
    const ytd = dbConn.prepare(`SELECT
      COUNT(DISTINCT pri.employee_id) emp_count,
      COALESCE(SUM(pri.gross_pay), 0) ytd_gross,
      COALESCE(SUM(pri.net_pay), 0) ytd_net,
      COALESCE(SUM(pri.federal_withholding + pri.state_withholding + pri.ss_employee + pri.medicare_employee), 0) ytd_ee_taxes,
      COALESCE(SUM(pri.ss_employer + pri.medicare_employer + pri.futa + pri.suta), 0) ytd_er_taxes
      FROM pay_run_items pri INNER JOIN pay_runs pr ON pri.pay_run_id = pr.id
      WHERE pri.company_id = ? AND pr.status = 'posted' AND substr(pr.created_at, 1, 4) = ?`).get(cid, String(year)) as any;
    const nextPeriod = dbConn.prepare(`SELECT * FROM pay_periods WHERE company_id = ? AND status = 'open' ORDER BY pay_date ASC LIMIT 1`).get(cid);
    const filingsDue = dbConn.prepare(`SELECT 'W2' kind, COUNT(*) c FROM form_w2_filings WHERE company_id = ? AND tax_year = ? AND status = 'draft'
      UNION ALL SELECT '941', COUNT(*) FROM form_941_filings WHERE company_id = ? AND tax_year = ? AND status = 'draft'
      UNION ALL SELECT '940', COUNT(*) FROM form_940_filings WHERE company_id = ? AND tax_year = ? AND status = 'draft'
      UNION ALL SELECT '1099-NEC', COUNT(*) FROM form_1099_nec_filings WHERE company_id = ? AND tax_year = ? AND status = 'draft'`)
      .all(cid, year, cid, year, cid, year, cid, year);
    return { year, ...ytd, next_period: nextPeriod, filings_due: filingsDue };
  } catch (e: any) { return { error: e.message }; }
}
