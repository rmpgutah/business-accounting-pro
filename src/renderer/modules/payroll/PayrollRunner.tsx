import React, { useEffect, useState, useMemo } from 'react';
import { Calculator, DollarSign, ArrowLeft, FileText } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

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
  state?: string;
  state_allowances?: number;
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
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  pre_tax_deductions: number;
  post_tax_deductions: number;
  net_pay: number;
}

interface PayrollRunnerProps {
  onComplete: () => void;
  onBack: () => void;
}

// ─── Constants ──────────────────────────────────────────
const PAY_PERIODS_MAP: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

const DEFAULT_HOURS_MAP: Record<string, number> = {
  weekly: 40,
  biweekly: 80,
  semimonthly: 86.67,
  monthly: 173.33,
};

const SS_RATE = 0.062;
const SS_WAGE_BASE = 168600;
const MEDICARE_RATE = 0.0145;
const FALLBACK_STATE_TAX_RATE = 0.05;

// ─── Federal Tax Brackets (2024 Single) ─────────────────
const FEDERAL_BRACKETS = [
  { limit: 11600, rate: 0.10 },
  { limit: 47150, rate: 0.12 },
  { limit: 100525, rate: 0.22 },
  { limit: 191950, rate: 0.24 },
  { limit: 243725, rate: 0.32 },
  { limit: 609350, rate: 0.35 },
  { limit: Infinity, rate: 0.37 },
];

// ─── Tax Calculation Helpers ────────────────────────────
function calcFederalTaxAnnual(annualIncome: number): number {
  let tax = 0;
  let prev = 0;
  for (const bracket of FEDERAL_BRACKETS) {
    if (annualIncome <= prev) break;
    const taxable = Math.min(annualIncome, bracket.limit) - prev;
    tax += taxable * bracket.rate;
    prev = bracket.limit;
  }
  return tax;
}

function calcPayStub(
  emp: Employee,
  hoursOverride?: number,
  stateTaxOverride?: number,
  empDeductions?: EmployeeDeduction[]
): PayCalc {
  const periods = PAY_PERIODS_MAP[emp.pay_schedule] ?? 26;
  const defaultHours = DEFAULT_HOURS_MAP[emp.pay_schedule] ?? 80;
  const hours = emp.pay_type === 'hourly' ? (hoursOverride ?? defaultHours) : 0;

  // Gross pay
  let gross_pay: number;
  if (emp.pay_type === 'salary') {
    gross_pay = emp.pay_rate / periods;
  } else {
    gross_pay = hours * emp.pay_rate;
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

  // Taxable gross (after pre-tax deductions)
  const taxableGross = Math.max(0, gross_pay - pre_tax_deductions);

  // Annualized taxable gross for tax bracket lookup
  const annualTaxableGross = taxableGross * periods;

  // Federal tax (per period, on taxable gross)
  const federalAnnual = calcFederalTaxAnnual(annualTaxableGross);
  const federal_tax = federalAnnual / periods;

  // State tax: use engine result if provided, else flat fallback on taxable gross
  const state_tax = stateTaxOverride !== undefined
    ? stateTaxOverride
    : taxableGross * FALLBACK_STATE_TAX_RATE;

  // Social Security (6.2% up to wage base, on taxable gross)
  const ssAnnualTaxable = Math.min(annualTaxableGross, SS_WAGE_BASE);
  const social_security = (ssAnnualTaxable * SS_RATE) / periods;

  // Medicare (1.45%, on taxable gross)
  const medicare = taxableGross * MEDICARE_RATE;

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

  return {
    employee: emp,
    hours,
    gross_pay,
    federal_tax,
    state_tax,
    social_security,
    medicare,
    pre_tax_deductions,
    post_tax_deductions,
    net_pay,
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
const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => (
  <div className="flex items-center gap-2 mb-6">
    {[1, 2, 3].map((s) => (
      <React.Fragment key={s}>
        <div
          className={`w-8 h-8 flex items-center justify-center text-xs font-bold border-2 ${
            currentStep >= s
              ? 'bg-accent-blue border-accent-blue text-white'
              : 'border-border-primary text-text-muted'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {s}
        </div>
        {s < 3 && (
          <div
            className={`flex-1 h-0.5 ${currentStep > s ? 'bg-accent-blue' : 'bg-border-primary'}`}
          />
        )}
      </React.Fragment>
    ))}
  </div>
);

// ─── Component ──────────────────────────────────────────
const PayrollRunner: React.FC<PayrollRunnerProps> = ({ onComplete, onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [step, setStep] = useState(1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Async-computed tax/deduction data
  const [stateTaxMap, setStateTaxMap] = useState<Record<string, number>>({});
  const [deductionsByEmployee, setDeductionsByEmployee] = useState<Record<string, EmployeeDeduction[]>>({});

  // Step 1: pay period dates
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [payDate, setPayDate] = useState('');

  // Run type (regular, bonus, correction, off_cycle)
  const [runType, setRunType] = useState<'regular' | 'bonus' | 'correction' | 'off_cycle'>('regular');
  const [bonusMap, setBonusMap] = useState<Record<string, number>>({});

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

  // ─── Calculations ─────────────────────────────────────
  const calculations = useMemo(() => {
    return employees.map((emp) =>
      calcPayStub(emp, hoursMap[emp.id], stateTaxMap[emp.id], deductionsByEmployee[emp.id])
    );
  }, [employees, hoursMap, stateTaxMap, deductionsByEmployee]);

  const totals = useMemo(() => {
    return calculations.reduce(
      (acc, c) => ({
        gross_pay: acc.gross_pay + c.gross_pay,
        federal_tax: acc.federal_tax + c.federal_tax,
        state_tax: acc.state_tax + c.state_tax,
        social_security: acc.social_security + c.social_security,
        medicare: acc.medicare + c.medicare,
        pre_tax_deductions: acc.pre_tax_deductions + c.pre_tax_deductions,
        post_tax_deductions: acc.post_tax_deductions + c.post_tax_deductions,
        net_pay: acc.net_pay + c.net_pay,
      }),
      { gross_pay: 0, federal_tax: 0, state_tax: 0, social_security: 0, medicare: 0, pre_tax_deductions: 0, post_tax_deductions: 0, net_pay: 0 }
    );
  }, [calculations]);

  // ─── Step Navigation ──────────────────────────────────
  const canProceedStep1 = periodStart && periodEnd && payDate;

  const handleNextStep1 = async () => {
    if (!canProceedStep1) return;
    // Initialize default hours for hourly employees
    const defaults: Record<string, number> = {};
    employees.forEach((emp) => {
      if (emp.pay_type === 'hourly') {
        defaults[emp.id] = DEFAULT_HOURS_MAP[emp.pay_schedule] ?? 80;
      }
    });
    setHoursMap(defaults);
    setStep(2);
  };

  // ─── Process Payroll ──────────────────────────────────
  const handleProcess = async () => {
    setError(null);
    setProcessing(true);
    try {
      const year = new Date(payDate).getFullYear();
      const totalTaxes = totals.federal_tax + totals.state_tax + totals.social_security + totals.medicare;

      // Fetch YTD for each employee first, then submit all in one server-side transaction
      const stubs = await Promise.all(
        calculations.map(async (calc) => {
          const ytd = await api.payrollYtd(calc.employee.id, year);
          const totalWithholding = calc.federal_tax + calc.state_tax + calc.social_security + calc.medicare;
          return {
            employeeId: calc.employee.id,
            hours: calc.hours,
            grossPay: calc.gross_pay,
            federalTax: calc.federal_tax,
            stateTax: calc.state_tax,
            ss: calc.social_security,
            medicare: calc.medicare,
            netPay: calc.net_pay,
            ytdGross: ytd.ytd_gross + calc.gross_pay,
            ytdTaxes: ytd.ytd_taxes + totalWithholding,
            ytdNet: ytd.ytd_net + calc.net_pay,
          };
        })
      );

      await (api.processPayroll as any)({
        periodStart,
        periodEnd,
        payDate,
        totalGross: totals.gross_pay,
        totalTaxes,
        totalNet: totals.net_pay,
        stubs,
        runType,
      });

      onComplete();
    } catch (err: any) {
      console.error('Failed to process payroll:', err);
      setError(err?.message ?? 'Failed to process payroll. Please try again.');
      alert('Failed to process payroll: ' + (err?.message || 'Unknown error'));
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm font-mono">Loading employees...</span>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <Calculator size={20} className="text-text-muted" />
          <h1 className="text-lg font-bold text-text-primary">Run Payroll</h1>
        </div>
      </div>

      <StepIndicator currentStep={step} />

      {error && (
        <div className="block-card bg-accent-expense/10 border-accent-expense text-accent-expense text-sm px-4 py-3" style={{ borderRadius: '6px' }}>
          {error}
        </div>
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

          <div className="text-xs text-text-muted">
            {employees.length} active employee{employees.length !== 1 ? 's' : ''} will be included in this payroll run.
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

          <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
            <table className="block-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  {employees.some((e) => e.pay_type === 'hourly') && <th>Hours</th>}
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
                  return (
                    <tr key={calc.employee.id}>
                      <td className="text-text-primary font-medium">{calc.employee.name}</td>
                      <td>
                        <span className="text-[10px] text-text-muted uppercase">{calc.employee.pay_type}</span>
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
              className="block-btn text-text-secondary hover:text-text-primary px-4 py-2 text-sm"
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

            <div className="border-t border-border-primary pt-4 space-y-2">
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
          </div>

          <div className="flex justify-between items-center">
            <button
              className="block-btn text-text-secondary hover:text-text-primary px-4 py-2 text-sm"
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
    </div>
  );
};

export default PayrollRunner;
