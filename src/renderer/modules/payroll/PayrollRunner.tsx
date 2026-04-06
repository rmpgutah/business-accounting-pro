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
}

interface PayCalc {
  employee: Employee;
  hours: number;
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
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
const STATE_TAX_RATE = 0.05;

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

function calcPayStub(emp: Employee, hoursOverride?: number): PayCalc {
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

  // Annualized gross for tax bracket lookup
  const annualGross = gross_pay * periods;

  // Federal tax (per period)
  const federalAnnual = calcFederalTaxAnnual(annualGross);
  const federal_tax = federalAnnual / periods;

  // State tax (flat 5%)
  const state_tax = gross_pay * STATE_TAX_RATE;

  // Social Security (6.2% up to wage base)
  const ssAnnualTaxable = Math.min(annualGross, SS_WAGE_BASE);
  const social_security = (ssAnnualTaxable * SS_RATE) / periods;

  // Medicare (1.45%)
  const medicare = gross_pay * MEDICARE_RATE;

  // Net pay
  const net_pay = gross_pay - federal_tax - state_tax - social_security - medicare;

  return {
    employee: emp,
    hours,
    gross_pay,
    federal_tax,
    state_tax,
    social_security,
    medicare,
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

  // Step 1: pay period dates
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [payDate, setPayDate] = useState('');

  // Step 2: hours overrides for hourly employees
  const [hoursMap, setHoursMap] = useState<Record<string, number>>({});

  // ─── Load active employees ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoading(true);
        // Bug fix #17: was missing company_id — showed all companies' employees.
        const rows = await api.query('employees', { company_id: activeCompany.id, status: 'active' });
        if (!cancelled) {
          setEmployees(Array.isArray(rows) ? rows : []);
        }
      } catch (err) {
        console.error('Failed to load employees:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ─── Calculations ─────────────────────────────────────
  const calculations = useMemo(() => {
    return employees.map((emp) => calcPayStub(emp, hoursMap[emp.id]));
  }, [employees, hoursMap]);

  const totals = useMemo(() => {
    return calculations.reduce(
      (acc, c) => ({
        gross_pay: acc.gross_pay + c.gross_pay,
        federal_tax: acc.federal_tax + c.federal_tax,
        state_tax: acc.state_tax + c.state_tax,
        social_security: acc.social_security + c.social_security,
        medicare: acc.medicare + c.medicare,
        net_pay: acc.net_pay + c.net_pay,
      }),
      { gross_pay: 0, federal_tax: 0, state_tax: 0, social_security: 0, medicare: 0, net_pay: 0 }
    );
  }, [calculations]);

  // ─── Step Navigation ──────────────────────────────────
  const canProceedStep1 = periodStart && periodEnd && payDate;

  const handleNextStep1 = () => {
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
      // Create payroll run record
      const run = await api.create('payroll_runs', {
        pay_period_start: periodStart,
        pay_period_end: periodEnd,
        pay_date: payDate,
        status: 'processed',
        total_gross: totals.gross_pay,
        total_taxes: totals.federal_tax + totals.state_tax + totals.social_security + totals.medicare,
        total_deductions: 0,
        total_net: totals.net_pay,
      });

      const runId = run?.id ?? run;

      // Bug fix #17b: fetch real YTD values from prior pay stubs instead
      // of hardcoding 0 — which produces incorrect W2/payroll reports.
      const year = new Date(payDate).getFullYear();
      const resolvedRunId = typeof runId === 'object' ? (runId as any).id : runId;

      for (const calc of calculations) {
        const ytd = await api.payrollYtd(calc.employee.id, year);
        await api.create('pay_stubs', {
          payroll_run_id: resolvedRunId,
          employee_id: calc.employee.id,
          hours_regular: calc.hours,
          hours_overtime: 0,
          gross_pay: calc.gross_pay,
          federal_tax: calc.federal_tax,
          state_tax: calc.state_tax,
          social_security: calc.social_security,
          medicare: calc.medicare,
          other_deductions: 0,
          net_pay: calc.net_pay,
          ytd_gross: ytd.ytd_gross + calc.gross_pay,
          ytd_taxes: ytd.ytd_taxes + calc.federal_tax + calc.state_tax + calc.social_security + calc.medicare,
          ytd_net: ytd.ytd_net + calc.net_pay,
        });
      }

      onComplete();
    } catch (err: any) {
      console.error('Failed to process payroll:', err);
      setError(err?.message ?? 'Failed to process payroll. Please try again.');
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
