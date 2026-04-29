import React, { useEffect, useState, useMemo } from 'react';
import { Calculator, DollarSign, ArrowLeft, FileText, Printer, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';
import { roundCents } from '../../lib/format';
import {
  calcFederalTaxAnnual,
  STANDARD_DEDUCTION_2025,
  SS_RATE,
  SS_WAGE_BASE_2025,
  MEDICARE_RATE,
  ADDL_MEDICARE_RATE,
  ADDL_MEDICARE_THRESHOLD,
  FUTA_RATE,
  FUTA_WAGE_BASE,
  type FilingStatus,
} from '../../lib/tax-brackets';

// MAP: DB stores filing_status as 'single' | 'married_joint' | 'married_separate'
// | 'head_household' (from EmployeeForm), or as 'married' (from W-4 fields).
// The bracket helper expects 'single' | 'mfj' | 'hoh'. Normalize here.
const mapFilingStatus = (raw?: string): FilingStatus => {
  const s = (raw || 'single').toLowerCase();
  if (s.includes('joint') || s === 'married' || s === 'mfj') return 'mfj';
  if (s.includes('head') || s === 'hoh') return 'hoh';
  return 'single';
};

// ─── Types ──────────────────────────────────────────────
interface Employee {
  id: string;
  name: string;
  email: string;
  type: 'employee' | 'contractor';
  pay_type: 'salary' | 'hourly';
  pay_rate: number;
  pay_schedule: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  status: 'active' | 'inactive';
  filing_status?: string;       // legacy filing_status column on employees
  federal_allowances?: number;  // legacy allowances count
  state?: string;
  state_allowances?: number;
  start_date?: string;
  routing_number?: string;
  // W-4 / Utah withholding fields (from EmployeeForm tax section)
  w4_filing_status?: string;
  w4_step2_checkbox?: number;
  w4_step3_dependent_credit?: number;
  w4_step4a_other_income?: number;
  w4_step4b_deductions?: number;
  w4_step4c_extra_withholding?: number;
  ut_exemptions?: number;
  ut_additional_withholding?: number;
  w4_received_date?: string;
}

interface EmployeeDeduction {
  id: string;
  employee_id: string;
  name: string;
  type: 'deduction' | 'benefit' | 'garnishment' | 'retirement';
  calculation: 'fixed' | 'percentage';
  amount: number;
  is_pretax: number; // 1 = pre-tax, 0 = post-tax
  is_active: number;
}

interface PayCalc {
  employee: Employee;
  hours: number;
  hours_regular: number;
  hours_overtime: number;
  regular_pay: number;
  overtime_pay: number;
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  pre_tax_deductions: number;
  post_tax_deductions: number;
  net_pay: number;
  // Feature 16: Employer cost fields
  employer_ss: number;
  employer_medicare: number;
  employer_futa: number;
}

interface PayrollRunnerProps {
  onComplete: () => void;
  onBack: () => void;
  /** When set, the runner loads this existing run and saves over it instead of creating a new run. */
  editRunId?: string;
}

// ─── Constants ──────────────────────────────────────────
const PAY_PERIODS_MAP: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

// DEFAULT_HOURS_MAP is a fallback only — employers should enter actual hours
// per period. Semimonthly = 2080/24 ≈ 86.6667; monthly = 2080/12 ≈ 173.3333.
const DEFAULT_HOURS_MAP: Record<string, number> = {
  weekly: 40,
  biweekly: 80,
  semimonthly: 2080 / 24,
  monthly: 2080 / 12,
};

const FALLBACK_STATE_TAX_RATE = 0.05;

// Feature 14: Federal minimum wage constant
const FEDERAL_MINIMUM_WAGE = 7.25;

// Feature 24: Default workers' comp rate (configurable)
const DEFAULT_WORKERS_COMP_RATE = 0.01; // 1% of gross

interface YtdInfo {
  /** YTD gross wages prior to this run. */
  ytdGross: number;
  /** YTD Social Security taxable wages (≈ post-pretax gross) prior to this run. */
  ytdSsWages: number;
  /** YTD Medicare-taxable wages prior to this run. */
  ytdMedicareWages: number;
  /** YTD FUTA-taxable wages prior to this run. */
  ytdFutaWages: number;
}

function calcPayStub(
  emp: Employee,
  hoursOverride?: number,
  stateTaxOverride?: number,
  empDeductions?: EmployeeDeduction[],
  runType?: string,
  periodStart?: string,
  periodEnd?: string,
  bonusAmount?: number,
  ytd?: YtdInfo,
): PayCalc {
  const periods = PAY_PERIODS_MAP[emp.pay_schedule] ?? 26;
  const defaultHours = DEFAULT_HOURS_MAP[emp.pay_schedule] ?? 80;
  const hours = emp.pay_type === 'hourly' ? (hoursOverride ?? defaultHours) : 0;

  // Feature 4: Overtime calculation for hourly employees
  const overtimeThreshold = emp.pay_schedule === 'weekly' ? 40 : 80;
  let hours_regular = hours;
  let hours_overtime = 0;
  let regular_pay = 0;
  let overtime_pay = 0;

  // Feature 23: Salary proration factor
  let prorationFactor = 1.0;
  if (emp.pay_type === 'salary' && emp.start_date && periodStart && periodEnd) {
    const startDate = new Date(emp.start_date + 'T12:00:00');
    const pStart = new Date(periodStart + 'T12:00:00');
    const pEnd = new Date(periodEnd + 'T12:00:00');
    if (startDate > pStart && startDate <= pEnd) {
      // Employee started mid-period: prorate by calendar days
      const totalDays = Math.max(1, (pEnd.getTime() - pStart.getTime()) / (1000 * 60 * 60 * 24) + 1);
      const workedDays = Math.max(1, (pEnd.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24) + 1);
      prorationFactor = workedDays / totalDays;
    }
  }

  // Gross pay — split into "regular" (subject to bracket withholding) and
  // "supplemental" (flat 22% per IRS Pub. 15-T 2025) so a bonus run only
  // applies the flat rate to the bonus portion, not the entire paycheck.
  let regular_gross: number;
  if (emp.pay_type === 'salary') {
    regular_gross = (emp.pay_rate / periods) * prorationFactor;
    hours_regular = 0;
  } else {
    hours_regular = Math.min(hours, overtimeThreshold);
    hours_overtime = Math.max(0, hours - overtimeThreshold);
    regular_pay = hours_regular * emp.pay_rate;
    overtime_pay = hours_overtime * emp.pay_rate * 1.5;
    regular_gross = regular_pay + overtime_pay;
  }
  // Bonus / supplemental wages: applied only to the bonus portion. A "bonus"
  // run with no entered amount falls back to treating the regular pay as the
  // supplemental amount (legacy behavior).
  const bonus = runType === 'bonus' ? Math.max(0, Number(bonusAmount ?? regular_gross)) : 0;
  const regular_portion = runType === 'bonus' && bonusAmount !== undefined ? regular_gross : (runType === 'bonus' ? 0 : regular_gross);
  const gross_pay = regular_portion + bonus;

  // CALC: Negative-gross guard — a 'correction' run can pass a negative
  // bonus/regular to reverse a prior overpayment, but the withholding
  // formulas below (brackets × periods, FICA × cap-remaining) are only
  // valid for non-negative wages. For negative gross we zero-out all
  // taxes and rely on the user posting a manual reversing JE for the
  // tax-side. (IRS Pub. 15 prior-period correction guidance.)
  if (gross_pay < 0) {
    return {
      employee: emp,
      hours,
      hours_regular,
      hours_overtime,
      regular_pay: roundCents(regular_pay),
      overtime_pay: roundCents(overtime_pay),
      gross_pay: roundCents(gross_pay),
      federal_tax: 0,
      state_tax: 0,
      social_security: 0,
      medicare: 0,
      pre_tax_deductions: 0,
      post_tax_deductions: 0,
      net_pay: roundCents(gross_pay),
      employer_ss: 0,
      employer_medicare: 0,
      employer_futa: 0,
    };
  }

  const deductions = empDeductions ?? [];

  // Pre-tax deductions (reduce taxable income; garnishments are always post-tax)
  const pre_tax_deductions = deductions
    .filter((d) => d.is_pretax === 1 && d.type !== 'garnishment')
    .reduce((sum, d) => {
      const amt = d.calculation === 'percentage'
        ? gross_pay * (Number(d.amount) / 100)
        : Number(d.amount);
      return sum + amt;
    }, 0);

  // Taxable gross (after pre-tax deductions). Pre-tax deductions reduce
  // the regular portion first (they're typically benefit elections that
  // don't apply to a one-off bonus run, but for simplicity we apply them
  // proportionally to the combined gross).
  const taxableGross = Math.max(0, gross_pay - pre_tax_deductions);
  const taxableRegular = Math.max(0, regular_portion - Math.min(pre_tax_deductions, regular_portion));
  const taxableBonus = Math.max(0, taxableGross - taxableRegular);

  // Annualized regular taxable gross for bracket calc.
  const annualTaxableRegular = taxableRegular * periods;

  // MATH: IRS Pub 15-T Percentage Method requires subtracting the standard
  // deduction (and per-allowance adjustment for legacy W-4) BEFORE applying
  // the bracket table. Previously we passed gross-after-pretax directly,
  // over-stating federal withholding (or under-stating once engine override
  // ran with proper deduction handling — causing reconciliation issues).
  const filingStatus = mapFilingStatus(emp.filing_status || emp.w4_filing_status);
  const stdDeduction = STANDARD_DEDUCTION_2025[filingStatus];
  // Legacy per-allowance amount per IRS pre-2020 method ($4,300 in 2025).
  const allowanceAmt = (emp.federal_allowances || 0) * 4300;
  const annualTaxableAfterDed = Math.max(0, annualTaxableRegular - stdDeduction - allowanceAmt);

  // Federal tax: brackets on the post-deduction income + flat 22% on supplemental.
  const federalAnnualRegular = calcFederalTaxAnnual(annualTaxableAfterDed, filingStatus);
  const federal_tax = (federalAnnualRegular / periods) + (taxableBonus * 0.22);

  // State tax: use engine result if provided, else flat fallback on taxable gross
  const state_tax = stateTaxOverride !== undefined
    ? stateTaxOverride
    : taxableGross * FALLBACK_STATE_TAX_RATE;

  // ─── Social Security (6.2% up to wage base, per-employee per-year) ──
  // CALC: Track YTD wages and only apply 6.2% to the portion of THIS
  // paycheck that fits under the cap. A single paycheck that itself
  // crosses the cap is split correctly via Math.min(taxableGross, cap-ytd):
  // wages up to the remaining cap are taxed, the excess (including any
  // supplemental/bonus portion above the cap) is not.
  // Source: IRC §3121(a)(1), 2025 OASDI max $176,100.
  const ytdSs = ytd?.ytdSsWages ?? 0;
  const ssRemainingCap = Math.max(0, SS_WAGE_BASE_2025 - ytdSs);
  const ssTaxableThisRun = Math.min(taxableGross, ssRemainingCap);
  const social_security = ssTaxableThisRun * SS_RATE;

  // ─── Medicare (1.45%) + Additional 0.9% surtax ─────────────────────
  // Employer must withhold the additional 0.9% on wages exceeding $200,000
  // YTD regardless of filing status (IRS Pub. 15, "Additional Medicare Tax").
  const medicare_base = taxableGross * MEDICARE_RATE;
  const ytdMed = ytd?.ytdMedicareWages ?? 0;
  const overThreshold = Math.max(0, (ytdMed + taxableGross) - ADDL_MEDICARE_THRESHOLD);
  const surtaxBase = Math.min(taxableGross, overThreshold);
  const medicare = medicare_base + (surtaxBase * ADDL_MEDICARE_RATE);

  // ─── Employer match + FUTA ─────────────────────────────────────────
  // Employer matches 6.2% SS / 1.45% Medicare. Employer does NOT match
  // the additional 0.9% Medicare surtax (IRC §3101(b)(2)).
  const employer_ss = ssTaxableThisRun * SS_RATE;
  const employer_medicare = medicare_base;

  // FUTA: per-employee per-year on first $7,000. Track YTD and stop at cap.
  const ytdFuta = ytd?.ytdFutaWages ?? 0;
  const futaRemaining = Math.max(0, FUTA_WAGE_BASE - ytdFuta);
  const futaTaxableThisRun = Math.min(gross_pay, futaRemaining);
  const employer_futa = futaTaxableThisRun * FUTA_RATE;

  // Post-tax deductions (garnishments + non-pretax deductions)
  const post_tax_deductions = deductions
    .filter((d) => d.is_pretax === 0 || d.type === 'garnishment')
    .reduce((sum, d) => {
      const amt = d.calculation === 'percentage'
        ? gross_pay * (Number(d.amount) / 100)
        : Number(d.amount);
      return sum + amt;
    }, 0);

  // Net pay
  const net_pay = gross_pay - federal_tax - state_tax - social_security - medicare - pre_tax_deductions - post_tax_deductions;

  // Round all money fields to whole cents at the boundary so 9 stub fields
  // sum cleanly in totals/journals (avoids 0.30000000000000004 artifacts).
  return {
    employee: emp,
    hours,
    hours_regular,
    hours_overtime,
    regular_pay: roundCents(regular_pay),
    overtime_pay: roundCents(overtime_pay),
    gross_pay: roundCents(gross_pay),
    federal_tax: roundCents(federal_tax),
    state_tax: roundCents(state_tax),
    social_security: roundCents(social_security),
    medicare: roundCents(medicare),
    pre_tax_deductions: roundCents(pre_tax_deductions),
    post_tax_deductions: roundCents(post_tax_deductions),
    net_pay: roundCents(net_pay),
    employer_ss: roundCents(employer_ss),
    employer_medicare: roundCents(employer_medicare),
    employer_futa: roundCents(employer_futa),
  };
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Step Indicator (module-level to avoid re-creation) ─
const STEP_LABELS = ['Pay Period', 'Calculate', 'Review', 'Results'];

const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => (
  <div className="flex items-center gap-2 mb-6">
    {[1, 2, 3, 4].map((s) => (
      <React.Fragment key={s}>
        <div className="flex flex-col items-center gap-1">
          <div
            className={`w-8 h-8 flex items-center justify-center text-xs font-bold border-2 ${
              currentStep >= s
                ? 'bg-accent-blue border-accent-blue text-white'
                : 'border-border-primary text-text-muted'
            }`}
            style={{ borderRadius: '6px' }}
          >
            {currentStep > s ? '\u2713' : s}
          </div>
          <span className="text-[9px] text-text-muted">{STEP_LABELS[s - 1]}</span>
        </div>
        {s < 4 && (
          <div
            className={`flex-1 h-0.5 mb-4 ${currentStep > s ? 'bg-accent-blue' : 'bg-border-primary'}`}
          />
        )}
      </React.Fragment>
    ))}
  </div>
);

// ─── Component ──────────────────────────────────────────
const PayrollRunner: React.FC<PayrollRunnerProps> = ({ onComplete, onBack, editRunId }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const isEditing = !!editRunId;
  const [editLoading, setEditLoading] = useState<boolean>(!!editRunId);
  const [step, setStep] = useState(1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Async-computed tax/deduction data
  const [stateTaxMap, setStateTaxMap] = useState<Record<string, number>>({});
  const [deductionsByEmployee, setDeductionsByEmployee] = useState<Record<string, EmployeeDeduction[]>>({});
  // YTD wages per employee for FICA/FUTA caps + Medicare surtax (per-employee per-year).
  const [ytdMap, setYtdMap] = useState<Record<string, YtdInfo>>({});

  // Step 1: pay period dates
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [payDate, setPayDate] = useState('');

  // Run type (regular, bonus, correction, off_cycle)
  const [runType, setRunType] = useState<'regular' | 'bonus' | 'correction' | 'off_cycle'>('regular');
  const [bonusMap, setBonusMap] = useState<Record<string, number>>({});

  // Feature 9: Payroll run notes
  const [runNotes, setRunNotes] = useState('');

  // Feature 18: Custom check memo
  const [checkMemo, setCheckMemo] = useState('');

  // Feature 24: Workers' comp rate
  const [workersCompRate, setWorkersCompRate] = useState(DEFAULT_WORKERS_COMP_RATE);

  // Feature 15: Period overlap warning
  const [periodWarning, setPeriodWarning] = useState('');

  // Feature 21: Pay date warnings
  const [payDateWarning, setPayDateWarning] = useState('');

  // Feature 11: Completed run ID (for post-processing actions)
  const [completedRunId, setCompletedRunId] = useState<string | null>(null);

  // Step 2: hours overrides for hourly employees
  const [hoursMap, setHoursMap] = useState<Record<string, number>>({});

  // ─── Load active employees + deductions ──────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoading(true);
        // Bug fix #17: was missing company_id — showed all companies' employees.
        const rows = await api.query('employees', { company_id: activeCompany.id, status: 'active' });
        const emps: Employee[] = Array.isArray(rows) ? rows : [];

        // Load active deductions for all employees in this company
        const deductionsRaw = await api.query('employee_deductions', { is_active: 1 }).catch(() => []);
        const deducMap: Record<string, EmployeeDeduction[]> = {};
        (deductionsRaw ?? []).forEach((d: EmployeeDeduction) => {
          if (!deducMap[d.employee_id]) deducMap[d.employee_id] = [];
          deducMap[d.employee_id].push(d);
        });

        if (!cancelled) {
          setEmployees(emps);
          setDeductionsByEmployee(deducMap);
        }

        // Pre-fetch state tax for all employees
        const taxMap: Record<string, number> = {};
        await Promise.all(emps.map(async (emp) => {
          const periods = PAY_PERIODS_MAP[emp.pay_schedule] ?? 26;
          const grossPerPeriod = emp.pay_type === 'salary'
            ? emp.pay_rate / periods
            : (DEFAULT_HOURS_MAP[emp.pay_schedule] ?? 80) * emp.pay_rate;
          try {
            const result = await api.getStateTaxRate(
              emp.state || '',
              grossPerPeriod,
              Number(emp.state_allowances || 0),
              periods
            );
            taxMap[emp.id] = Number(result?.withholding || 0) + Number(result?.sdi || 0);
          } catch {
            taxMap[emp.id] = grossPerPeriod * FALLBACK_STATE_TAX_RATE;
          }
        }));

        if (!cancelled) {
          setStateTaxMap(taxMap);
        }
      } catch (err: any) {
        console.error('Failed to load employees:', err);
        if (!cancelled) setError(err?.message || 'Failed to load employees');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ─── Load existing run for editing ─────────────────────
  // When editRunId is provided, fetch the run + its stubs and pre-populate
  // the form with the same period, run type, notes, and per-employee hours.
  useEffect(() => {
    if (!editRunId || !activeCompany) return;
    let cancelled = false;
    (async () => {
      try {
        const run = await api.get('payroll_runs', editRunId);
        if (!run || cancelled) return;
        setPeriodStart(run.pay_period_start || '');
        setPeriodEnd(run.pay_period_end || '');
        setPayDate(run.pay_date || '');
        if (run.run_type) {
          const rt = String(run.run_type) as 'regular' | 'bonus' | 'correction' | 'off_cycle';
          setRunType(rt);
        }
        setRunNotes(run.notes || '');

        // Load existing stubs to populate hours/bonus maps
        const existingStubs = await api.query('pay_stubs', { payroll_run_id: editRunId });
        if (!cancelled && Array.isArray(existingStubs)) {
          const hoursOverride: Record<string, number> = {};
          const bonusOverride: Record<string, number> = {};
          for (const s of existingStubs) {
            const totalHours = (s.hours_regular || 0) + (s.hours_overtime || 0);
            if (totalHours > 0) hoursOverride[s.employee_id] = totalHours;
          }
          setHoursMap(hoursOverride);
          setBonusMap(bonusOverride);
        }
      } catch (err: any) {
        console.error('Failed to load run for editing:', err);
        if (!cancelled) setError('Failed to load existing payroll run');
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editRunId, activeCompany]);

  // ─── Recalculate state tax when hours change ───────────
  // The initial stateTaxMap was computed with DEFAULT hours. When the user
  // changes hours in Step 2, we must recompute state tax on the ACTUAL gross.
  // We use the employee's state rate (flat % from StateTaxEngine fallback)
  // applied to the actual per-period gross.
  const adjustedStateTaxMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const emp of employees) {
      const periods = PAY_PERIODS_MAP[emp.pay_schedule] ?? 26;
      const actualGross = emp.pay_type === 'salary'
        ? emp.pay_rate / periods
        : (hoursMap[emp.id] ?? DEFAULT_HOURS_MAP[emp.pay_schedule] ?? 80) * emp.pay_rate;
      // Use the pre-fetched state tax map's ratio if available, else fallback 5%
      const defaultGross = emp.pay_type === 'salary'
        ? emp.pay_rate / periods
        : (DEFAULT_HOURS_MAP[emp.pay_schedule] ?? 80) * emp.pay_rate;
      const originalTax = stateTaxMap[emp.id] ?? (defaultGross * FALLBACK_STATE_TAX_RATE);
      const effectiveRate = defaultGross > 0 ? originalTax / defaultGross : FALLBACK_STATE_TAX_RATE;
      map[emp.id] = actualGross * effectiveRate;
    }
    return map;
  }, [employees, hoursMap, stateTaxMap]);

  // ─── Calculations (async to allow TaxCalculationEngine override) ──
  const [calculations, setCalculations] = useState<PayCalc[]>([]);

  useEffect(() => {
    let cancelled = false;

    const computeAll = async () => {
      // Step 1: Compute all stubs synchronously (inline math — always runs)
      const baseCalcs = employees.map((emp) =>
        calcPayStub(
          emp,
          hoursMap[emp.id],
          adjustedStateTaxMap[emp.id],
          deductionsByEmployee[emp.id],
          runType,
          periodStart,
          periodEnd,
          bonusMap[emp.id],
          ytdMap[emp.id],
        )
      );

      // Step 2: For employees with an actual W-4 form on file, optionally
      // refine taxes via TaxCalculationEngine. We use the inline calculation
      // (which is now Pub 15-T compliant after the std-deduction fix) unless
      // the employee has explicitly recorded a W-4 received date — that's
      // the signal that the W-4 fields are real, not just schema defaults.
      // SAFETY: never override state_tax with engine.utah_withholding for
      // employees in non-Utah states; the inline path uses StateTaxEngine
      // which handles all 50 states correctly.
      const finalCalcs = await Promise.all(
        baseCalcs.map(async (calc) => {
          const emp = calc.employee;
          // Skip override for legacy employees (no explicit W-4 on file).
          // Inline math handles them correctly.
          if (!emp.w4_received_date && !emp.w4_step3_dependent_credit && !emp.w4_step4a_other_income && !emp.w4_step4b_deductions && !emp.w4_step4c_extra_withholding && !emp.w4_step2_checkbox) {
            return calc;
          }
          try {
            const engineResult = await api.taxCalcPayroll(
              calc.gross_pay,
              emp.pay_schedule,
              {
                w4_filing_status: emp.w4_filing_status,
                w4_step2_checkbox: !!emp.w4_step2_checkbox,
                w4_step3_dependent_credit: emp.w4_step3_dependent_credit ?? 0,
                w4_step4a_other_income: emp.w4_step4a_other_income ?? 0,
                w4_step4b_deductions: emp.w4_step4b_deductions ?? 0,
                w4_step4c_extra_withholding: emp.w4_step4c_extra_withholding ?? 0,
              },
              {
                ut_exemptions: emp.ut_exemptions ?? 1,
                ut_additional_withholding: emp.ut_additional_withholding ?? 0,
              },
              ytdMap[emp.id]?.ytdGross ?? 0,
            );
            if (engineResult) {
              const updated = { ...calc };
              // SAFETY: only adopt engine federal if it produces a non-zero
              // value when inline expected one. If engine returns 0 but the
              // employee earns above the std deduction, keep the inline value.
              const engineFed = roundCents(engineResult.federal_withholding);
              const inlineFed = calc.federal_tax;
              updated.federal_tax = (engineFed === 0 && inlineFed > 0) ? inlineFed : engineFed;

              // SAFETY: only override state with Utah engine if employee IS
              // in Utah. Otherwise keep the inline state tax (StateTaxEngine).
              const empState = (emp.state || '').toUpperCase();
              if (empState === 'UT') {
                const engineState = roundCents(engineResult.utah_withholding);
                updated.state_tax = (engineState === 0 && calc.state_tax > 0) ? calc.state_tax : engineState;
              }
              // For non-Utah states, keep calc.state_tax (already from inline)

              updated.social_security = roundCents(engineResult.ss_employee);
              updated.medicare = roundCents(engineResult.medicare_employee);
              updated.employer_ss = roundCents(engineResult.ss_employer);
              updated.employer_medicare = roundCents(engineResult.medicare_employer);
              updated.employer_futa = roundCents(engineResult.futa);
              // Recalculate net pay with engine-provided tax values
              updated.net_pay = roundCents(
                updated.gross_pay - updated.federal_tax - updated.state_tax -
                updated.social_security - updated.medicare -
                updated.pre_tax_deductions - updated.post_tax_deductions
              );
              return updated;
            }
          } catch (err) {
            console.warn('Tax engine fallback — using inline calc for', emp.name, err);
          }
          return calc;
        })
      );

      if (!cancelled) setCalculations(finalCalcs);
    };

    computeAll();
    return () => { cancelled = true; };
  }, [employees, hoursMap, adjustedStateTaxMap, deductionsByEmployee, runType, periodStart, periodEnd, bonusMap, ytdMap]);

  const totals = useMemo(() => {
    const raw = calculations.reduce(
      (acc, c) => ({
        gross_pay: acc.gross_pay + c.gross_pay,
        federal_tax: acc.federal_tax + c.federal_tax,
        state_tax: acc.state_tax + c.state_tax,
        social_security: acc.social_security + c.social_security,
        medicare: acc.medicare + c.medicare,
        pre_tax_deductions: acc.pre_tax_deductions + c.pre_tax_deductions,
        post_tax_deductions: acc.post_tax_deductions + c.post_tax_deductions,
        net_pay: acc.net_pay + c.net_pay,
        employer_ss: acc.employer_ss + c.employer_ss,
        employer_medicare: acc.employer_medicare + c.employer_medicare,
        employer_futa: acc.employer_futa + c.employer_futa,
      }),
      { gross_pay: 0, federal_tax: 0, state_tax: 0, social_security: 0, medicare: 0, pre_tax_deductions: 0, post_tax_deductions: 0, net_pay: 0, employer_ss: 0, employer_medicare: 0, employer_futa: 0 }
    );
    // Round totals to cents — float sums of rounded stubs can still drift.
    return {
      gross_pay: roundCents(raw.gross_pay),
      federal_tax: roundCents(raw.federal_tax),
      state_tax: roundCents(raw.state_tax),
      social_security: roundCents(raw.social_security),
      medicare: roundCents(raw.medicare),
      pre_tax_deductions: roundCents(raw.pre_tax_deductions),
      post_tax_deductions: roundCents(raw.post_tax_deductions),
      net_pay: roundCents(raw.net_pay),
      employer_ss: roundCents(raw.employer_ss),
      employer_medicare: roundCents(raw.employer_medicare),
      employer_futa: roundCents(raw.employer_futa),
    };
  }, [calculations]);

  // ─── Step Navigation ──────────────────────────────────
  const canProceedStep1 = periodStart && periodEnd && payDate;

  const handleNextStep1 = async () => {
    if (!canProceedStep1) return;

    // Feature 21: Pay date warnings
    const pd = new Date(payDate + 'T12:00:00');
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dayOfWeek = pd.getDay();
    const warnings: string[] = [];
    if (pd < today) warnings.push('Pay date is in the past.');
    if (dayOfWeek === 0) warnings.push('Pay date falls on a Sunday.');
    if (dayOfWeek === 6) warnings.push('Pay date falls on a Saturday.');
    setPayDateWarning(warnings.join(' '));

    // Feature 15: Period overlap validation
    try {
      const existing = await api.rawQuery(
        `SELECT pay_period_start, pay_period_end FROM payroll_runs WHERE company_id = (SELECT id FROM companies LIMIT 1) AND pay_period_start <= ? AND pay_period_end >= ?`,
        [periodEnd, periodStart]
      );
      if (Array.isArray(existing) && existing.length > 0) {
        setPeriodWarning(`Warning: This period overlaps with ${existing.length} existing payroll run(s).`);
      } else {
        setPeriodWarning('');
      }
    } catch {
      setPeriodWarning('');
    }

    // Initialize default hours for hourly employees
    const defaults: Record<string, number> = {};
    employees.forEach((emp) => {
      if (emp.pay_type === 'hourly') {
        defaults[emp.id] = DEFAULT_HOURS_MAP[emp.pay_schedule] ?? 80;
      }
    });
    setHoursMap(defaults);

    // Fetch YTD wages per employee for the pay-date's calendar year.
    // Used to enforce per-employee SS wage cap, FUTA cap, and Medicare
    // 0.9% additional-tax threshold. SS-taxable wages ≈ taxable gross
    // (gross - pretax deductions); ytd_taxes does not give us a wage
    // breakdown, so we approximate using ytd_gross as the wage proxy.
    try {
      const year = new Date(payDate + 'T12:00:00').getFullYear();
      const ytdMapNew: Record<string, YtdInfo> = {};
      await Promise.all(
        employees.map(async (emp) => {
          try {
            const ytd = await api.payrollYtd(emp.id, year);
            const g = Number(ytd.ytd_gross || 0);
            ytdMapNew[emp.id] = {
              ytdGross: g,
              ytdSsWages: g,
              ytdMedicareWages: g,
              ytdFutaWages: g,
            };
          } catch {
            ytdMapNew[emp.id] = { ytdGross: 0, ytdSsWages: 0, ytdMedicareWages: 0, ytdFutaWages: 0 };
          }
        })
      );
      setYtdMap(ytdMapNew);
    } catch {
      setYtdMap({});
    }

    setStep(2);
  };

  // ─── Process Payroll ──────────────────────────────────
  const handleProcess = async () => {
    setError(null);
    setProcessing(true);
    try {
      // DATE: Item #4 — noon-anchor parse so a yyyy-MM-dd Jan 1 doesn't read as
      // Dec 31 of prior year (UTC midnight then local-shift west of UTC).
      const year = new Date(payDate + 'T12:00:00').getFullYear();
      const totalTaxes = totals.federal_tax + totals.state_tax + totals.social_security + totals.medicare;

      // Fetch YTD for each employee first, then submit all in one server-side transaction
      const stubs = await Promise.all(
        calculations.map(async (calc) => {
          const ytd = await api.payrollYtd(calc.employee.id, year);
          const totalWithholding = calc.federal_tax + calc.state_tax + calc.social_security + calc.medicare;
          return {
            employeeId: calc.employee.id,
            hours: calc.hours_regular,
            hoursOvertime: calc.hours_overtime,
            grossPay: calc.gross_pay,
            federalTax: calc.federal_tax,
            stateTax: calc.state_tax,
            ss: calc.social_security,
            medicare: calc.medicare,
            netPay: calc.net_pay,
            ytdGross: ytd.ytd_gross + calc.gross_pay,
            ytdTaxes: ytd.ytd_taxes + totalWithholding,
            ytdNet: ytd.ytd_net + calc.net_pay,
            preTaxDeductions: calc.pre_tax_deductions,
            postTaxDeductions: calc.post_tax_deductions,
            deductionDetail: '{}',
          };
        })
      );

      const result = isEditing
        ? await (api.editPayroll as any)({
            runId: editRunId,
            periodStart,
            periodEnd,
            payDate,
            totalGross: totals.gross_pay,
            totalTaxes,
            totalNet: totals.net_pay,
            stubs,
            runType,
            notes: runNotes,
            employeeCount: calculations.length,
          })
        : await (api.processPayroll as any)({
            periodStart,
            periodEnd,
            payDate,
            totalGross: totals.gross_pay,
            totalTaxes,
            totalNet: totals.net_pay,
            stubs,
            runType,
            notes: runNotes,
            employeeCount: calculations.length,
          });

      // BUG 1: Handle duplicate payroll run error
      if (result?.error) {
        throw new Error(result.error);
      }

      // Feature 11: Track completed run for post-processing actions
      setCompletedRunId(result?.runId || null);
      setStep(4); // Go to results step instead of immediately completing
    } catch (err: any) {
      console.error('Failed to process payroll:', err);
      setError(err?.message ?? 'Failed to process payroll. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading || editLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm font-mono">
          {editLoading ? 'Loading run for editing...' : 'Loading employees...'}
        </span>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <Calculator size={20} className="text-text-muted" />
          <h1 className="text-lg font-bold text-text-primary">{isEditing ? 'Edit Payroll Run' : 'Run Payroll'}</h1>
        </div>
      </div>

      <StepIndicator currentStep={step} />

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {/* ─── Step 1: Pay Period ─────────────────────── */}
      {step === 1 && (
        <div className="block-card p-6 space-y-6" style={{ borderRadius: '6px' }}>
          <h2 className="text-sm font-bold text-text-primary">Select Pay Period</h2>

          {/* Run Type */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Run Type</label>
            <div className="flex gap-2">
              {([
                { value: 'regular', label: 'Regular' },
                { value: 'bonus', label: 'Bonus' },
                { value: 'correction', label: 'Correction' },
                { value: 'off_cycle', label: 'Off-Cycle' },
              ] as const).map((rt) => (
                <button
                  key={rt.value}
                  className={`px-3 py-1.5 text-xs font-semibold border transition-colors ${runType === rt.value ? 'bg-accent-blue/20 border-accent-blue text-accent-blue' : 'border-border-primary text-text-muted hover:text-text-primary'}`}
                  style={{ borderRadius: '6px' }}
                  onClick={() => setRunType(rt.value)}
                >
                  {rt.label}
                </button>
              ))}
            </div>
            {runType === 'bonus' && (
              <p className="text-xs text-text-muted mt-2">Bonus runs use flat 22% federal supplemental wage rate. Enter bonus amounts in step 2.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Period Start *</label>
              <input
                className="block-input w-full"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Period End *</label>
              <input
                className="block-input w-full"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Pay Date *</label>
              <input
                className="block-input w-full"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
          </div>

          {/* Feature 9: Notes */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Notes (optional)</label>
            <textarea
              className="block-input w-full text-xs"
              rows={2}
              placeholder="Internal notes for this payroll run..."
              value={runNotes}
              onChange={(e) => setRunNotes(e.target.value)}
            />
          </div>

          {/* Feature 18: Custom check memo */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Check Memo (optional)</label>
            <input
              className="block-input w-full text-xs"
              type="text"
              placeholder={`Default: Payroll ${periodStart} — ${periodEnd}`}
              value={checkMemo}
              onChange={(e) => setCheckMemo(e.target.value)}
            />
          </div>

          {/* Feature 22: Employee count in summary */}
          <div className="text-xs text-text-muted">
            {employees.length} active employee{employees.length !== 1 ? 's' : ''} will be included in this payroll run.
            {employees.filter(e => e.pay_type === 'hourly').length > 0 && (
              <span className="ml-2">({employees.filter(e => e.pay_type === 'hourly').length} hourly, {employees.filter(e => e.pay_type === 'salary').length} salary)</span>
            )}
          </div>

          <div className="flex justify-end">
            <button
              className="block-btn-primary px-5 py-2 text-sm font-semibold"
              onClick={handleNextStep1}
              disabled={!canProceedStep1}
            >
              Next: Calculate Pay
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 2: Calculation Review ────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <div className="text-xs text-text-muted mb-1">Pay Period</div>
            <div className="text-sm text-text-primary font-mono">
              {periodStart} to {periodEnd} &mdash; Pay Date: {payDate}
            </div>
          </div>

          {/* Feature 15: Period overlap warning */}
          {periodWarning && (
            <div className="block-card p-3 border-l-4 border-yellow-500 bg-yellow-500/5 flex items-center gap-2" style={{ borderRadius: '6px' }}>
              <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
              <span className="text-xs text-text-secondary">{periodWarning}</span>
            </div>
          )}

          {/* Feature 21: Pay date warning */}
          {payDateWarning && (
            <div className="block-card p-3 border-l-4 border-yellow-500 bg-yellow-500/5 flex items-center gap-2" style={{ borderRadius: '6px' }}>
              <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
              <span className="text-xs text-text-secondary">{payDateWarning}</span>
            </div>
          )}

          {/* Feature 14: Minimum wage warnings */}
          {employees.filter(e => e.pay_type === 'hourly' && e.pay_rate < FEDERAL_MINIMUM_WAGE).length > 0 && (
            <div className="block-card p-3 border-l-4 border-accent-expense bg-accent-expense/5 flex items-center gap-2" style={{ borderRadius: '6px' }}>
              <AlertTriangle size={14} className="text-accent-expense shrink-0" />
              <span className="text-xs text-text-secondary">
                Warning: {employees.filter(e => e.pay_type === 'hourly' && e.pay_rate < FEDERAL_MINIMUM_WAGE).map(e => e.name).join(', ')} ha{employees.filter(e => e.pay_type === 'hourly' && e.pay_rate < FEDERAL_MINIMUM_WAGE).length === 1 ? 's' : 've'} an hourly rate below the federal minimum wage (${fmt.format(FEDERAL_MINIMUM_WAGE)}).
              </span>
            </div>
          )}

          {/* Auto-fill hours from time entries for hourly employees */}
          {employees.some((e) => e.pay_type === 'hourly') && (
            <div className="flex justify-end">
              <button
                className="block-btn text-xs"
                onClick={async () => {
                  if (!periodStart || !periodEnd) return;
                  const newHoursMap: Record<string, number> = {};
                  for (const emp of employees.filter(e => e.pay_type === 'hourly')) {
                    try {
                      const entries = await api.rawQuery(
                        'SELECT COALESCE(SUM(hours), 0) as total FROM time_entries WHERE employee_id = ? AND date BETWEEN ? AND ?',
                        [emp.id, periodStart, periodEnd]
                      );
                      const total = Array.isArray(entries) ? (entries[0]?.total || 0) : 0;
                      if (total > 0) newHoursMap[emp.id] = total;
                    } catch { /* ignore -- fallback to manual entry */ }
                  }
                  setHoursMap(prev => ({ ...prev, ...newHoursMap }));
                }}
              >
                Auto-Fill from Time Entries
              </button>
            </div>
          )}

          <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
            <table className="block-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type / Rate</th>
                  {employees.some((e) => e.pay_type === 'hourly') && <th>Hours</th>}
                  {calculations.some(c => c.hours_overtime > 0) && <th>OT Hrs</th>}
                  <th className="text-right">Gross</th>
                  <th className="text-right">Federal</th>
                  <th className="text-right">State</th>
                  <th className="text-right">SS</th>
                  <th className="text-right">Medicare</th>
                  <th className="text-right">Deductions</th>
                  <th className="text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {calculations.map((calc) => {
                  const hasHourly = employees.some((e) => e.pay_type === 'hourly');
                  const hasOT = calculations.some(c => c.hours_overtime > 0);
                  return (
                    <tr key={calc.employee.id}>
                      <td className="text-text-primary font-medium">{calc.employee.name}</td>
                      {/* Feature 13: Show pay rate next to type */}
                      <td>
                        <span className="text-[10px] text-text-muted uppercase">{calc.employee.pay_type}</span>
                        <span className="text-[10px] text-text-muted ml-1 font-mono">
                          {calc.employee.pay_type === 'hourly'
                            ? `@ ${fmt.format(calc.employee.pay_rate)}/hr`
                            : `@ ${fmt.format(calc.employee.pay_rate)}/yr`}
                        </span>
                      </td>
                      {hasHourly && (
                        <td>
                          {calc.employee.pay_type === 'hourly' ? (
                            <input
                              className="block-input w-20 text-right font-mono text-xs"
                              type="number"
                              min="0"
                              step="0.5"
                              value={hoursMap[calc.employee.id] ?? ''}
                              onChange={(e) => {
                                const parsed = parseFloat(e.target.value);
                                setHoursMap((prev) => ({
                                  ...prev,
                                  [calc.employee.id]: isNaN(parsed) ? (prev[calc.employee.id] ?? 0) : parsed,
                                }));
                              }}
                            />
                          ) : (
                            <span className="text-text-muted">--</span>
                          )}
                        </td>
                      )}
                      {/* Feature 4: Overtime hours column */}
                      {hasOT && (
                        <td className="text-right font-mono text-xs">
                          {calc.hours_overtime > 0
                            ? <span className="text-yellow-500 font-semibold">{calc.hours_overtime.toFixed(1)}</span>
                            : <span className="text-text-muted">--</span>}
                        </td>
                      )}
                      <td className="text-right font-mono text-xs">{fmt.format(calc.gross_pay)}</td>
                      <td className="text-right font-mono text-xs text-accent-expense">{fmt.format(calc.federal_tax)}</td>
                      <td className="text-right font-mono text-xs text-accent-expense">{fmt.format(calc.state_tax)}</td>
                      <td className="text-right font-mono text-xs text-accent-expense">{fmt.format(calc.social_security)}</td>
                      <td className="text-right font-mono text-xs text-accent-expense">{fmt.format(calc.medicare)}</td>
                      <td className="text-right font-mono text-xs text-accent-expense">
                        {calc.pre_tax_deductions + calc.post_tax_deductions > 0
                          ? fmt.format(calc.pre_tax_deductions + calc.post_tax_deductions)
                          : <span className="text-text-muted">--</span>}
                      </td>
                      <td className="text-right font-mono text-xs font-semibold text-accent-income">{fmt.format(calc.net_pay)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center">
            <button
              className="block-btn text-text-secondary hover:text-text-primary px-4 py-2 text-sm transition-colors"
              onClick={() => setStep(1)}
            >
              Back
            </button>
            <button
              className="block-btn-primary px-5 py-2 text-sm font-semibold"
              onClick={() => {
                const badHours = employees
                  .filter((e) => e.pay_type === 'hourly')
                  .filter((e) => isNaN(hoursMap[e.id]) || hoursMap[e.id] < 0);
                if (badHours.length > 0) {
                  setError(
                    `Invalid hours for: ${badHours.map((e) => e.name).join(', ')}. Please enter a valid number.`
                  );
                  return;
                }
                setError(null);
                setStep(3);
              }}
            >
              Next: Review Totals
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Review & Process ─────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="block-card p-6 space-y-4" style={{ borderRadius: '6px' }}>
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <DollarSign size={16} />
              Payroll Summary
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="block-card p-4 bg-bg-tertiary" style={{ borderRadius: '6px' }}>
                <div className="text-xs text-text-muted mb-1">Pay Period</div>
                <div className="text-sm text-text-primary font-mono">{periodStart} to {periodEnd}</div>
              </div>
              <div className="block-card p-4 bg-bg-tertiary" style={{ borderRadius: '6px' }}>
                <div className="text-xs text-text-muted mb-1">Pay Date</div>
                <div className="text-sm text-text-primary font-mono">{payDate}</div>
              </div>
              <div className="block-card p-4 bg-bg-tertiary" style={{ borderRadius: '6px' }}>
                <div className="text-xs text-text-muted mb-1">Employees</div>
                <div className="text-sm text-text-primary font-mono">{calculations.length}</div>
              </div>
              <div className="block-card p-4 bg-bg-tertiary" style={{ borderRadius: '6px' }}>
                <div className="text-xs text-text-muted mb-1">Total Gross Pay</div>
                <div className="text-sm text-text-primary font-mono font-semibold">{fmt.format(totals.gross_pay)}</div>
              </div>
            </div>

            {/* Employee Withholding Summary */}
            <div className="border-t border-border-primary pt-4 space-y-2">
              <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Employee Withholding</div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Total Gross Pay</span>
                <span className="font-mono text-text-primary">{fmt.format(totals.gross_pay)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Federal Tax</span>
                <span className="font-mono text-accent-expense">-{fmt.format(totals.federal_tax)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">State Tax</span>
                <span className="font-mono text-accent-expense">-{fmt.format(totals.state_tax)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Social Security (6.2%)</span>
                <span className="font-mono text-accent-expense">-{fmt.format(totals.social_security)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Medicare (1.45%)</span>
                <span className="font-mono text-accent-expense">-{fmt.format(totals.medicare)}</span>
              </div>
              {(totals.pre_tax_deductions + totals.post_tax_deductions) > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Employee Deductions</span>
                  <span className="font-mono text-accent-expense">-{fmt.format(totals.pre_tax_deductions + totals.post_tax_deductions)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs border-t border-border-primary pt-2 font-semibold">
                <span className="text-text-primary">Total Net Pay</span>
                <span className="font-mono text-accent-income">{fmt.format(totals.net_pay)}</span>
              </div>
            </div>

            {/* Feature 10: Employer Tax Summary */}
            <div className="border-t border-border-primary pt-4 space-y-2">
              <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Employer Tax Obligations</div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Employer SS Match (6.2%)</span>
                <span className="font-mono text-accent-expense">{fmt.format(totals.employer_ss)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Employer Medicare Match (1.45%)</span>
                <span className="font-mono text-accent-expense">{fmt.format(totals.employer_medicare)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Est. FUTA (0.6%)</span>
                <span className="font-mono text-accent-expense">{fmt.format(totals.employer_futa)}</span>
              </div>
              {/* Feature 24: Workers' comp estimate */}
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">
                  Est. Workers' Comp ({(workersCompRate * 100).toFixed(1)}%)
                  <button
                    className="ml-1 text-accent-blue text-[10px] underline"
                    onClick={() => {
                      const rate = prompt('Enter workers\' comp rate (e.g., 1.0 for 1%):', String(workersCompRate * 100));
                      if (rate === null) return;
                      const parsed = parseFloat(rate);
                      if (!Number.isFinite(parsed)) {
                        alert('Invalid input — enter a number like "1.0".');
                        return;
                      }
                      const decimal = parsed / 100;
                      // Validate range: 0% to 100%. WC rates are typically <10%
                      // but accept up to 100% for unusual jurisdictions.
                      if (decimal < 0 || decimal > 1) {
                        alert('Workers\' comp rate must be between 0% and 100%.');
                        return;
                      }
                      setWorkersCompRate(decimal);
                    }}
                  >
                    edit
                  </button>
                </span>
                <span className="font-mono text-accent-expense">{fmt.format(totals.gross_pay * workersCompRate)}</span>
              </div>
              <div className="flex justify-between text-xs border-t border-border-primary pt-2 font-semibold">
                <span className="text-text-primary">Total Employer Tax Cost</span>
                <span className="font-mono text-accent-expense">
                  {fmt.format(totals.employer_ss + totals.employer_medicare + totals.employer_futa + (totals.gross_pay * workersCompRate))}
                </span>
              </div>
            </div>

            {/* Feature 16: Total employer cost */}
            <div className="border-t border-border-primary pt-4">
              <div className="flex justify-between text-sm font-bold">
                <span className="text-text-primary">Total Cost to Employer</span>
                <span className="font-mono text-text-primary">
                  {fmt.format(totals.gross_pay + totals.employer_ss + totals.employer_medicare + totals.employer_futa + (totals.gross_pay * workersCompRate))}
                </span>
              </div>
              <div className="text-[10px] text-text-muted mt-1">
                Gross pay + employer FICA match + FUTA + workers' comp estimate
              </div>
            </div>

            {/* Feature 9: Show notes if any */}
            {runNotes && (
              <div className="border-t border-border-primary pt-4">
                <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Notes</div>
                <div className="text-xs text-text-secondary">{runNotes}</div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center">
            <button
              className="block-btn text-text-secondary hover:text-text-primary px-4 py-2 text-sm transition-colors"
              onClick={() => setStep(2)}
            >
              Back
            </button>
            <button
              className="block-btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold"
              onClick={handleProcess}
              disabled={processing}
            >
              <DollarSign size={14} />
              {processing ? 'Processing...' : 'Process Payroll'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 4: Results & Post-Processing ──────── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="block-card p-6 space-y-4" style={{ borderRadius: '6px' }}>
            <div className="text-center py-4">
              <div className="text-3xl mb-2">&#10003;</div>
              <h2 className="text-lg font-bold text-text-primary">Payroll Processed Successfully</h2>
              <p className="text-xs text-text-muted mt-1">{calculations.length} employees &mdash; {fmt.format(totals.net_pay)} total net pay</p>
            </div>

            {/* Feature 10: Employer tax summary recap */}
            <div className="block-card p-4 bg-bg-tertiary space-y-2" style={{ borderRadius: '6px' }}>
              <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Employer Tax Summary</div>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-text-muted">FICA Match</div>
                  <div className="font-mono font-semibold text-text-primary">{fmt.format(totals.employer_ss + totals.employer_medicare)}</div>
                </div>
                <div>
                  <div className="text-text-muted">Est. FUTA</div>
                  <div className="font-mono font-semibold text-text-primary">{fmt.format(totals.employer_futa)}</div>
                </div>
                <div>
                  <div className="text-text-muted">Total Employer Cost</div>
                  <div className="font-mono font-semibold text-text-primary">
                    {fmt.format(totals.gross_pay + totals.employer_ss + totals.employer_medicare + totals.employer_futa)}
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 25: Tax deposit reminder */}
            <div className="block-card p-4 border-l-4 border-accent-blue bg-accent-blue/5" style={{ borderRadius: '6px' }}>
              <div className="text-[10px] font-bold text-accent-blue uppercase tracking-wider mb-1">Tax Deposit Reminder</div>
              <div className="text-xs text-text-secondary space-y-1">
                <p>
                  <strong>Semi-weekly depositor:</strong> If payroll is paid Wed-Fri, deposit by next Wednesday. If paid Sat-Tue, deposit by next Friday.
                </p>
                <p>
                  <strong>Monthly depositor:</strong> Deposit by the 15th of the following month.
                </p>
                <p className="font-mono mt-1">
                  Total to deposit: {fmt.format(totals.federal_tax + totals.social_security + totals.medicare + totals.employer_ss + totals.employer_medicare)} (employee + employer FICA)
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              {/* Feature 3: Print All Checks */}
              {completedRunId && (
                <button
                  className="block-btn-primary flex items-center gap-2 text-xs"
                  onClick={async () => {
                    const { generatePaycheckHTML, extractCheckBody, wrapBatchChecks } = await import('../../lib/payroll-check-template');
                    const stubs = await api.rawQuery(
                      'SELECT ps.*, e.name as employee_name FROM pay_stubs ps JOIN employees e ON ps.employee_id = e.id WHERE ps.payroll_run_id = ?',
                      [completedRunId]
                    );
                    const run = await api.get('payroll_runs', completedRunId);
                    const payYear = (run?.pay_date || '').substring(0, 4) || new Date().getFullYear();
                    const bodies: string[] = [];
                    // Perf: bulk-load employees once instead of one api.get per stub
                    // (was N+1 IPC calls when printing checks for all employees).
                    const empIds = Array.from(new Set((stubs || []).map((s: any) => s.employee_id).filter(Boolean)));
                    const empMap = new Map<string, any>();
                    if (empIds.length > 0) {
                      const placeholders = empIds.map(() => '?').join(',');
                      const empRows: any[] = await api.rawQuery(
                        `SELECT * FROM employees WHERE id IN (${placeholders})`, empIds
                      ).catch(() => []);
                      for (const e of empRows) empMap.set(e.id, e);
                    }
                    for (const s of (stubs || [])) {
                      const emp = empMap.get(s.employee_id) || await api.get('employees', s.employee_id);
                      // Ensure per-tax YTD is available
                      let stubData = s;
                      if (!s.ytd_federal_tax && s.employee_id) {
                        try {
                          const ytd = await api.payrollYtd(s.employee_id, Number(payYear));
                          stubData = { ...s, ...ytd };
                        } catch { /* use stub as-is */ }
                      }
                      const checkHtml = generatePaycheckHTML(stubData, emp, activeCompany, run, {
                        memo: checkMemo || undefined,
                      });
                      bodies.push(extractCheckBody(checkHtml));
                    }
                    const combined = wrapBatchChecks(bodies);
                    await api.printPreview(combined, 'Payroll Checks — All Employees');
                  }}
                >
                  <Printer size={14} />
                  Print All Checks
                </button>
              )}

              {/* Feature 12: Print Register */}
              <button
                className="block-btn flex items-center gap-2 text-xs"
                onClick={async () => {
                  // Build a simple payroll register and print it
                  const rows = calculations.map(c =>
                    `<tr>
                      <td style="padding:4px 8px;border-bottom:1px solid #ddd;">${c.employee.name}</td>
                      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${c.hours_regular.toFixed(2)}</td>
                      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${c.hours_overtime > 0 ? c.hours_overtime.toFixed(2) : ''}</td>
                      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${fmt.format(c.gross_pay)}</td>
                      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${fmt.format(c.federal_tax)}</td>
                      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${fmt.format(c.state_tax)}</td>
                      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${fmt.format(c.social_security + c.medicare)}</td>
                      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;font-weight:700;">${fmt.format(c.net_pay)}</td>
                    </tr>`
                  ).join('');
                  const registerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
                    @page { size: letter landscape; margin: 0.5in; }
                    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
                    table { width: 100%; border-collapse: collapse; }
                    th { background: #f0f0f0; padding: 6px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #333; }
                    th.r { text-align: right; }
                  </style></head><body>
                    <h1 style="font-size:16px;margin-bottom:4px;">Payroll Register</h1>
                    <p style="font-size:11px;color:#555;margin-bottom:16px;">${periodStart} to ${periodEnd} &mdash; Pay Date: ${payDate}</p>
                    <table>
                      <thead><tr>
                        <th>Employee</th><th class="r">Reg Hrs</th><th class="r">OT Hrs</th>
                        <th class="r">Gross</th><th class="r">Federal</th><th class="r">State</th>
                        <th class="r">FICA</th><th class="r">Net Pay</th>
                      </tr></thead>
                      <tbody>${rows}
                        <tr style="font-weight:700;border-top:2px solid #333;">
                          <td style="padding:6px 8px;">TOTALS (${calculations.length} employees)</td>
                          <td></td><td></td>
                          <td style="padding:6px 8px;text-align:right;">${fmt.format(totals.gross_pay)}</td>
                          <td style="padding:6px 8px;text-align:right;">${fmt.format(totals.federal_tax)}</td>
                          <td style="padding:6px 8px;text-align:right;">${fmt.format(totals.state_tax)}</td>
                          <td style="padding:6px 8px;text-align:right;">${fmt.format(totals.social_security + totals.medicare)}</td>
                          <td style="padding:6px 8px;text-align:right;">${fmt.format(totals.net_pay)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </body></html>`;
                  await api.printPreview(registerHtml, 'Payroll Register');
                }}
              >
                <FileText size={14} />
                Print Register
              </button>

              <button
                className="block-btn flex items-center gap-2 text-xs"
                onClick={onComplete}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollRunner;
