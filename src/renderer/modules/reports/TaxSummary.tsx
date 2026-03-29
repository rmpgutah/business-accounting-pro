import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download } from 'lucide-react';
import { format, startOfYear, endOfYear } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Types ──────────────────────────────────────────────
interface DeductionGroup {
  category: string;
  total: number;
}

interface TaxPayment {
  id: string;
  payment_date: string;
  amount: number;
  description: string;
  tax_type: string;
}

interface TaxData {
  totalRevenue: number;
  deductions: DeductionGroup[];
  taxPayments: TaxPayment[];
}

// ─── Render helpers ─────────────────────────────────────
const SectionHeader: React.FC<{ label: string }> = ({ label }) => (
  <tr className="bg-bg-tertiary/30">
    <td
      colSpan={2}
      className="px-6 py-2 text-xs font-bold text-text-primary uppercase tracking-wider"
    >
      {label}
    </td>
  </tr>
);

const LineRow: React.FC<{
  name: string;
  amount: number;
  indent?: number;
  bold?: boolean;
  accent?: string;
}> = ({ name, amount, indent = 0, bold = false, accent }) => (
  <tr className="border-b border-border-primary/30 hover:bg-bg-hover/30 transition-colors">
    <td
      className={`py-1.5 text-xs ${bold ? 'font-bold text-text-primary' : 'text-text-secondary'}`}
      style={{ paddingLeft: `${24 + indent * 20}px` }}
    >
      {name}
    </td>
    <td
      className={`py-1.5 text-right pr-6 font-mono text-xs ${
        bold ? 'font-bold' : ''
      } ${accent || 'text-text-primary'}`}
    >
      {fmt.format(amount)}
    </td>
  </tr>
);

const SubtotalRow: React.FC<{
  label: string;
  amount: number;
  accent?: string;
  topBorder?: boolean;
  doubleBorder?: boolean;
}> = ({ label, amount, accent, topBorder, doubleBorder }) => (
  <tr
    className={`${topBorder ? 'border-t border-border-primary' : ''} ${doubleBorder ? 'border-t-2 border-border-primary' : ''}`}
  >
    <td className="px-6 py-2 text-xs font-bold text-text-primary">
      {label}
    </td>
    <td
      className={`py-2 text-right pr-6 font-mono text-xs font-bold ${accent || 'text-text-primary'}`}
    >
      {fmt.format(amount)}
    </td>
  </tr>
);

const Spacer: React.FC = () => (
  <tr>
    <td colSpan={2} className="py-1" />
  </tr>
);

// ─── Component ──────────────────────────────────────────
const TaxSummary: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [startDate, setStartDate] = useState(() =>
    format(startOfYear(new Date()), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(() =>
    format(endOfYear(new Date()), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TaxData>({
    totalRevenue: 0,
    deductions: [],
    taxPayments: [],
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);

      try {
        // Total revenue from invoices
        const revenueRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(total), 0) as total
           FROM invoices
           WHERE company_id = ? AND issue_date BETWEEN ? AND ?
             AND status != 'draft'`,
          [activeCompany.id, startDate, endDate]
        );
        const totalRevenue = Number(revenueRows?.[0]?.total) || 0;

        // Deductions: expenses grouped by tax category
        const deductionRows: any[] = await api.rawQuery(
          `SELECT
             COALESCE(tc.name, 'Uncategorized') as category,
             SUM(e.amount) as total
           FROM expenses e
           LEFT JOIN tax_categories tc ON e.tax_category_id = tc.id
           WHERE e.company_id = ? AND e.date BETWEEN ? AND ?
           GROUP BY COALESCE(tc.name, 'Uncategorized')
           ORDER BY total DESC`,
          [activeCompany.id, startDate, endDate]
        );
        const deductions: DeductionGroup[] = (deductionRows ?? []).map((r) => ({
          category: r.category || 'Uncategorized',
          total: Number(r.total) || 0,
        }));

        // Tax payments
        const paymentRows: any[] = await api.rawQuery(
          `SELECT id, payment_date, amount, description, tax_type
           FROM tax_payments
           WHERE company_id = ? AND payment_date BETWEEN ? AND ?
           ORDER BY payment_date DESC`,
          [activeCompany.id, startDate, endDate]
        );
        const taxPayments: TaxPayment[] = (paymentRows ?? []).map((r) => ({
          id: r.id,
          payment_date: r.payment_date,
          amount: Number(r.amount) || 0,
          description: r.description || '',
          tax_type: r.tax_type || 'Federal',
        }));

        if (!cancelled) {
          setData({ totalRevenue, deductions, taxPayments });
        }
      } catch (err) {
        console.error('Failed to load Tax Summary:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, activeCompany]);

  // ─── Computed totals ────────────────────────────────────
  const totalDeductions = useMemo(
    () => data.deductions.reduce((s, d) => s + d.total, 0),
    [data.deductions]
  );
  const taxableIncome = data.totalRevenue - totalDeductions;
  // Simplified estimated tax rate (25%)
  const estimatedTaxRate = 0.25;
  const estimatedTax = Math.max(0, taxableIncome * estimatedTaxRate);
  const totalPayments = useMemo(
    () => data.taxPayments.reduce((s, p) => s + p.amount, 0),
    [data.taxPayments]
  );
  const balanceDue = estimatedTax - totalPayments;

  // ─── Quick date presets ─────────────────────────────────
  const setPreset = (label: string) => {
    const now = new Date();
    switch (label) {
      case 'This Year':
        setStartDate(format(startOfYear(now), 'yyyy-MM-dd'));
        setEndDate(format(endOfYear(now), 'yyyy-MM-dd'));
        break;
      case 'Last Year':
        const lastYear = new Date(now.getFullYear() - 1, 0, 1);
        setStartDate(format(startOfYear(lastYear), 'yyyy-MM-dd'));
        setEndDate(format(endOfYear(lastYear), 'yyyy-MM-dd'));
        break;
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div
        className="block-card p-4 flex items-center justify-between"
        style={{ borderRadius: '2px' }}
      >
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            From
          </label>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            To
          </label>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <div className="flex gap-1 ml-2">
            {['This Year', 'Last Year'].map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className="px-2 py-1 text-[10px] font-semibold bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                style={{ borderRadius: '2px' }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
            title="Print"
          >
            <Printer size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
            title="Export"
          >
            <Download size={15} />
          </button>
        </div>
      </div>

      {/* Report body */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Generating report...
        </div>
      ) : (
        <div
          className="block-card overflow-hidden"
          style={{ borderRadius: '2px' }}
        >
          {/* Report header */}
          <div className="px-6 py-4 border-b border-border-primary bg-bg-tertiary/50 text-center">
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">
              {activeCompany?.name ?? 'Company'}
            </h2>
            <h3 className="text-xs text-text-secondary mt-0.5">
              Tax Summary
            </h3>
            <p className="text-[10px] text-text-muted mt-0.5">
              {format(new Date(startDate), 'MMM d, yyyy')} &ndash;{' '}
              {format(new Date(endDate), 'MMM d, yyyy')}
            </p>
          </div>

          <table className="w-full text-sm">
            <tbody>
              {/* Income */}
              <SectionHeader label="Income" />
              <LineRow name="Total Revenue" amount={data.totalRevenue} indent={1} />
              <SubtotalRow
                label="Gross Income"
                amount={data.totalRevenue}
                accent="text-accent-income"
                topBorder
              />

              <Spacer />

              {/* Deductions */}
              <SectionHeader label="Deductions by Tax Category" />
              {data.deductions.length > 0 ? (
                data.deductions.map((d) => (
                  <LineRow
                    key={d.category}
                    name={d.category}
                    amount={d.total}
                    indent={1}
                  />
                ))
              ) : (
                <LineRow name="No deductions recorded" amount={0} indent={1} />
              )}
              <SubtotalRow
                label="Total Deductions"
                amount={totalDeductions}
                accent="text-accent-expense"
                topBorder
              />

              <Spacer />

              {/* Taxable Income */}
              <SubtotalRow
                label="Taxable Income"
                amount={taxableIncome}
                accent={taxableIncome >= 0 ? 'text-accent-income' : 'text-accent-expense'}
                doubleBorder
              />

              <Spacer />

              {/* Estimated Tax */}
              <SectionHeader label="Tax Estimate" />
              <LineRow
                name={`Estimated tax (${(estimatedTaxRate * 100).toFixed(0)}% rate)`}
                amount={estimatedTax}
                indent={1}
              />

              <Spacer />

              {/* Tax Payments */}
              <SectionHeader label="Tax Payments Made" />
              {data.taxPayments.length > 0 ? (
                data.taxPayments.map((p) => (
                  <LineRow
                    key={p.id}
                    name={`${p.tax_type} - ${p.description || format(new Date(p.payment_date), 'MMM d, yyyy')}`}
                    amount={p.amount}
                    indent={1}
                  />
                ))
              ) : (
                <LineRow name="No tax payments recorded" amount={0} indent={1} />
              )}
              <SubtotalRow
                label="Total Payments"
                amount={totalPayments}
                topBorder
              />

              <Spacer />

              {/* Balance Due */}
              <tr className="border-t-2 border-text-primary bg-bg-tertiary/50">
                <td className="px-6 py-3 text-sm font-bold text-text-primary">
                  {balanceDue >= 0 ? 'Estimated Balance Due' : 'Estimated Overpayment'}
                </td>
                <td
                  className={`py-3 text-right pr-6 font-mono text-sm font-bold ${
                    balanceDue > 0
                      ? 'text-accent-expense'
                      : 'text-accent-income'
                  }`}
                >
                  {fmt.format(Math.abs(balanceDue))}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Disclaimer */}
          <div className="px-6 py-3 border-t border-border-primary bg-bg-tertiary/30">
            <p className="text-[10px] text-text-muted">
              This is an estimate only. The 25% flat rate is a simplified
              approximation. Consult a tax professional for accurate tax
              calculations based on your specific situation and applicable tax
              brackets.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaxSummary;
