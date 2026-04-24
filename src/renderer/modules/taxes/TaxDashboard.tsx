import React, { useEffect, useState, useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  Calculator,
  AlertTriangle,
  Calendar,
  CheckCircle,
  Clock,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface QuarterPayment {
  quarter: string;
  dueDate: string;
  amount: number;
  paid: boolean;
  paidAmount: number;
}


// ─── Federal Tax Brackets (Simplified 2024) ─────────────
const FEDERAL_BRACKETS = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: Infinity, rate: 0.32 },
];

const SE_TAX_RATE = 0.153;
const SE_INCOME_FACTOR = 0.9235;

function calcFederalTax(taxableIncome: number): number {
  let tax = 0;
  for (const bracket of FEDERAL_BRACKETS) {
    if (taxableIncome <= bracket.min) break;
    const taxable = Math.min(taxableIncome, bracket.max) - bracket.min;
    tax += taxable * bracket.rate;
  }
  return tax;
}

function calcSelfEmploymentTax(netIncome: number): number {
  const seIncome = netIncome * SE_INCOME_FACTOR;
  return Math.max(0, seIncome * SE_TAX_RATE);
}

// ─── Quarterly Due Dates ────────────────────────────────
function getQuarterlyDueDates(year: number): { quarter: string; dueDate: string }[] {
  return [
    { quarter: 'Q1 (Jan-Mar)', dueDate: `${year}-04-15` },
    { quarter: 'Q2 (Apr-May)', dueDate: `${year}-06-15` },
    { quarter: 'Q3 (Jun-Aug)', dueDate: `${year}-09-15` },
    { quarter: 'Q4 (Sep-Dec)', dueDate: `${year + 1}-01-15` },
  ];
}

// ─── Stat Card ──────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accentClass: string;
  subtitle?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, accentClass, subtitle }) => (
  <div
    className={`block-card p-4 border-l-2 ${accentClass}`}
    style={{ borderRadius: '6px' }}
  >
    <div className="flex items-start justify-between">
      <div>
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          {label}
        </span>
        <p className="text-2xl font-mono text-text-primary mt-1">{value}</p>
        {subtitle && (
          <span className="text-xs text-text-muted mt-0.5 block">{subtitle}</span>
        )}
      </div>
      <div
        className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary"
        style={{ borderRadius: '6px' }}
      >
        {icon}
      </div>
    </div>
  </div>
);

// ─── Component ──────────────────────────────────────────
const TaxDashboard: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [ytdIncome, setYtdIncome] = useState(0);
  const [ytdExpenses, setYtdExpenses] = useState(0);
  const [taxPayments, setTaxPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        // Bug fix #7: rawQuery calls were missing company_id — showed all-company totals.
        const [incomeData, expenseData, payments] = await Promise.all([
          api.rawQuery(
            `SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE company_id = ? AND status = 'paid' AND issue_date BETWEEN ? AND ?`,
            [activeCompany.id, yearStart, yearEnd]
          ),
          api.rawQuery(
            `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ?`,
            [activeCompany.id, yearStart, yearEnd]
          ),
          api.query('tax_payments', { company_id: activeCompany.id, year: currentYear }),
        ]);
        if (cancelled) return;
        setYtdIncome(incomeData?.[0]?.total ?? 0);
        setYtdExpenses(expenseData?.[0]?.total ?? 0);
        setTaxPayments(Array.isArray(payments) ? payments : []);
      } catch (err) {
        console.error('Failed to load tax data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany, currentYear, yearStart, yearEnd]);

  const netIncome = useMemo(() => Math.max(0, ytdIncome - ytdExpenses), [ytdIncome, ytdExpenses]);
  const federalTax = useMemo(() => calcFederalTax(netIncome), [netIncome]);
  const seTax = useMemo(() => calcSelfEmploymentTax(netIncome), [netIncome]);
  const totalEstimatedTax = federalTax + seTax;
  const quarterlyAmount = totalEstimatedTax / 4;

  const quarters = useMemo(() => {
    const dueDates = getQuarterlyDueDates(currentYear);
    return dueDates.map((q) => {
      const paymentsForQ = taxPayments.filter(
        (p) => p.period === q.quarter || p.period === q.quarter.split(' ')[0]
      );
      const paidAmount = paymentsForQ.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      return {
        ...q,
        amount: quarterlyAmount,
        paid: quarterlyAmount > 0 && paidAmount >= quarterlyAmount,
        paidAmount,
      } as QuarterPayment;
    });
  }, [currentYear, taxPayments, quarterlyAmount]);

  const nextDue = quarters.find((q) => !q.paid && q.dueDate >= today);

  const effectiveRate = netIncome > 0 ? (totalEstimatedTax / netIncome) * 100 : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading tax data...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Next Payment Due Alert */}
      {nextDue && (
        <div
          className="block-card p-4 border-l-2 border-l-accent-warning flex items-center gap-3"
          style={{ borderRadius: '6px' }}
        >
          <AlertTriangle size={18} className="text-accent-warning flex-shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-semibold text-text-primary">
              Next Estimated Payment Due
            </span>
            <p className="text-xs text-text-muted mt-0.5">
              {nextDue.quarter} &mdash; {formatCurrency(nextDue.amount)} due by{' '}
              {formatDate(nextDue.dueDate)}
            </p>
          </div>
          <span className="text-lg font-mono font-bold text-accent-warning">
            {formatCurrency(nextDue.amount)}
          </span>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="YTD Income"
          value={formatCurrency(ytdIncome)}
          icon={<TrendingUp size={16} className="text-accent-income" />}
          accentClass="border-l-accent-income"
        />
        <StatCard
          label="YTD Deductible Expenses"
          value={formatCurrency(ytdExpenses)}
          icon={<DollarSign size={16} className="text-accent-expense" />}
          accentClass="border-l-accent-expense"
        />
        <StatCard
          label="Est. Taxable Income"
          value={formatCurrency(netIncome)}
          icon={<Calculator size={16} className="text-accent-blue" />}
          accentClass="border-l-accent-blue"
        />
        <StatCard
          label="Est. Total Tax Liability"
          value={formatCurrency(totalEstimatedTax)}
          icon={<AlertTriangle size={16} className="text-accent-warning" />}
          accentClass="border-l-accent-warning"
          subtitle={`Effective rate: ${effectiveRate.toFixed(1)}%`}
        />
      </div>

      {/* Tax Breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div className="block-card p-5" style={{ borderRadius: '6px' }}>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Tax Breakdown
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Federal Income Tax</span>
              <span className="text-sm font-mono text-text-primary">{formatCurrency(federalTax)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">
                Self-Employment Tax (15.3%)
              </span>
              <span className="text-sm font-mono text-text-primary">{formatCurrency(seTax)}</span>
            </div>
            <div
              className="border-t border-border-primary pt-3 flex items-center justify-between"
            >
              <span className="text-sm font-semibold text-text-primary">Total Estimated</span>
              <span className="text-sm font-mono font-bold text-accent-warning">
                {formatCurrency(totalEstimatedTax)}
              </span>
            </div>
          </div>
        </div>

        <div className="block-card p-5" style={{ borderRadius: '6px' }}>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Federal Bracket Detail
          </h3>
          <div className="space-y-2">
            {FEDERAL_BRACKETS.map((b, i) => {
              const bracketTaxable = Math.max(
                0,
                Math.min(netIncome, b.max) - b.min
              );
              const bracketTax = bracketTaxable * b.rate;
              if (bracketTaxable === 0 && i > 0) return null;
              return (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">
                    {(b.rate * 100).toFixed(0)}% up to{' '}
                    {b.max === Infinity ? '...' : formatCurrency(b.max)}
                  </span>
                  <span className="font-mono text-text-secondary">
                    {formatCurrency(bracketTaxable)} &rarr; {formatCurrency(bracketTax)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quarterly Estimated Payments */}
      <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
        <div className="px-5 py-4 border-b border-border-primary">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Quarterly Estimated Payments &mdash; {currentYear}
          </h3>
        </div>
        <table className="block-table">
          <thead>
            <tr>
              <th>Quarter</th>
              <th>Due Date</th>
              <th className="text-right">Est. Amount</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Remaining</th>
              <th className="text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q) => {
              const remaining = Math.max(0, q.amount - q.paidAmount);
              const overdue = !q.paid && q.dueDate < today;
              return (
                <tr key={q.quarter}>
                  <td className="text-text-primary font-medium text-sm">{q.quarter}</td>
                  <td className="font-mono text-text-secondary text-xs">
                    {formatDate(q.dueDate)}
                  </td>
                  <td className="text-right font-mono text-text-secondary text-sm">
                    {formatCurrency(q.amount)}
                  </td>
                  <td className="text-right font-mono text-accent-income text-sm">
                    {formatCurrency(q.paidAmount)}
                  </td>
                  <td className="text-right font-mono text-text-primary text-sm">
                    {formatCurrency(remaining)}
                  </td>
                  <td className="text-center">
                    {q.paid ? (
                      <span className="block-badge block-badge-income inline-flex items-center gap-1">
                        <CheckCircle size={12} /> Paid
                      </span>
                    ) : overdue ? (
                      <span className="block-badge block-badge-expense inline-flex items-center gap-1">
                        <AlertTriangle size={12} /> Overdue
                      </span>
                    ) : (
                      <span className="block-badge block-badge-warning inline-flex items-center gap-1">
                        <Clock size={12} /> Pending
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider">
                Total
              </td>
              <td className="text-right font-mono font-bold text-text-primary">
                {formatCurrency(totalEstimatedTax)}
              </td>
              <td className="text-right font-mono font-bold text-accent-income">
                {formatCurrency(quarters.reduce((s, q) => s + q.paidAmount, 0))}
              </td>
              <td className="text-right font-mono font-bold text-text-primary">
                {formatCurrency(
                  quarters.reduce((s, q) => s + Math.max(0, q.amount - q.paidAmount), 0)
                )}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default TaxDashboard;
