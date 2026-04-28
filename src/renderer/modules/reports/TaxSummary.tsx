import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download, Calendar } from 'lucide-react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { fiscalYearStart, fiscalYearEnd } from '../../lib/date-helpers';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { downloadCSVBlob } from '../../lib/csv-export';
import ErrorBanner from '../../components/ErrorBanner';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';

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
  payrollTaxTotal: number;
  salesTaxTotal: number;
  quarterlyData: QuarterData[];
}

interface QuarterData {
  quarter: string;
  income_tax: number;
  payroll_tax: number;
  sales_tax: number;
  total: number;
}

// ─── Tax calendar deadlines ─────────────────────────────
function getTaxDeadlines(year: number): { name: string; date: string; description: string }[] {
  return [
    { name: 'Q1 Estimated Tax', date: `${year}-04-15`, description: 'Federal estimated tax payment for Q1' },
    { name: 'Q2 Estimated Tax', date: `${year}-06-15`, description: 'Federal estimated tax payment for Q2' },
    { name: 'Q3 Estimated Tax', date: `${year}-09-15`, description: 'Federal estimated tax payment for Q3' },
    { name: 'Q4 Estimated Tax', date: `${year + 1}-01-15`, description: 'Federal estimated tax payment for Q4' },
    { name: 'Annual Return (1040/1120)', date: `${year + 1}-04-15`, description: 'Federal income tax return due' },
    { name: 'Payroll Tax (941) Q1', date: `${year}-04-30`, description: 'Quarterly payroll tax return' },
    { name: 'Payroll Tax (941) Q2', date: `${year}-07-31`, description: 'Quarterly payroll tax return' },
    { name: 'Payroll Tax (941) Q3', date: `${year}-10-31`, description: 'Quarterly payroll tax return' },
    { name: 'Payroll Tax (941) Q4', date: `${year + 1}-01-31`, description: 'Quarterly payroll tax return' },
    { name: 'W-2/1099 Filing', date: `${year + 1}-01-31`, description: 'W-2 and 1099 forms due to recipients and IRS' },
  ];
}

// ─── Accounting parens helper ───────────────────────────
function fmtNeg(value: number): React.ReactElement {
  const n = Number(value) || 0;
  const formatted = fmt.format(Math.abs(n));
  return n < 0
    ? <span data-neg="true" className="acc-neg">{formatted}</span>
    : <span>{formatted}</span>;
}

// ─── Render helpers ─────────────────────────────────────
const SectionHeader: React.FC<{ label: string }> = ({ label }) => (
  <tr className="bg-bg-tertiary/30 report-section-heading">
    <td colSpan={2} className="px-6 py-2 text-xs font-bold text-text-primary uppercase tracking-wider">{label}</td>
  </tr>
);

const LineRow: React.FC<{ name: string; amount: number; indent?: number; bold?: boolean; accent?: string }> = ({ name, amount, indent = 0, bold = false, accent }) => (
  <tr className="border-b border-border-primary/30 hover:bg-bg-hover/30 transition-colors">
    <td className={`py-1.5 text-xs ${bold ? 'font-bold text-text-primary' : 'text-text-secondary'}`} style={{ paddingLeft: `${24 + indent * 20}px` }}>{name}</td>
    <td className={`py-1.5 text-right pr-6 font-mono text-xs ${bold ? 'font-bold' : ''} ${accent || 'text-text-primary'}`}>{fmtNeg(amount)}</td>
  </tr>
);

const SubtotalRow: React.FC<{ label: string; amount: number; accent?: string; topBorder?: boolean; doubleBorder?: boolean }> = ({ label, amount, accent, topBorder, doubleBorder }) => (
  <tr className={`${topBorder ? 'border-t border-border-primary report-subtotal-row' : ''} ${doubleBorder ? 'border-t-2 border-border-primary report-grand-total-row' : ''}`}>
    <td className="px-6 py-2 text-xs font-bold text-text-primary">{label}</td>
    <td className={`py-2 text-right pr-6 font-mono text-xs font-bold ${accent || 'text-text-primary'}`}>{fmtNeg(amount)}</td>
  </tr>
);

const Spacer: React.FC = () => <tr><td colSpan={2} className="py-1" /></tr>;

// ─── Component ──────────────────────────────────────────
const TaxSummary: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [startDate, setStartDate] = useState(() => fiscalYearStart(new Date(), 1));
  const [endDate, setEndDate] = useState(() => fiscalYearEnd(new Date(), 1));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<TaxData>({
    totalRevenue: 0,
    deductions: [],
    taxPayments: [],
    payrollTaxTotal: 0,
    salesTaxTotal: 0,
    quarterlyData: [],
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');

      try {
        // Total revenue
        const revenueRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(total), 0) as total
           FROM invoices
           WHERE company_id = ? AND date(issue_date) BETWEEN date(?) AND date(?)
             AND status != 'draft'`,
          [activeCompany.id, startDate, endDate]
        );
        const totalRevenue = Number(revenueRows?.[0]?.total) || 0;

        // Deductions
        const deductionRows: any[] = await api.rawQuery(
          `SELECT COALESCE(tc.name, 'Uncategorized') as category, SUM(e.amount) as total
           FROM expenses e
           LEFT JOIN tax_categories tc ON e.category_id = tc.id
           WHERE e.company_id = ? AND date(e.date) BETWEEN date(?) AND date(?)
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
          `SELECT id, date AS payment_date, amount, notes AS description, type AS tax_type
           FROM tax_payments
           WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?)
           ORDER BY date DESC`,
          [activeCompany.id, startDate, endDate]
        );
        const taxPayments: TaxPayment[] = (paymentRows ?? []).map((r) => ({
          id: r.id,
          payment_date: r.payment_date,
          amount: Number(r.amount) || 0,
          description: r.description || '',
          tax_type: r.tax_type || 'Federal',
        }));

        // Change 66-67: Payroll tax total
        let payrollTaxTotal = 0;
        try {
          const prRows: any[] = await api.rawQuery(
            `SELECT COALESCE(SUM(ps.federal_tax + ps.state_tax + ps.social_security + ps.medicare), 0) as total
             FROM pay_stubs ps
             JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
             WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?`,
            [activeCompany.id, startDate, endDate]
          );
          payrollTaxTotal = Number(prRows?.[0]?.total) || 0;
        } catch { /* no payroll data */ }

        // Sales tax
        let salesTaxTotal = 0;
        try {
          const stRows: any[] = await api.rawQuery(
            `SELECT COALESCE(SUM(amount), 0) as total FROM tax_payments
             WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?) AND type = 'Sales Tax'`,
            [activeCompany.id, startDate, endDate]
          );
          salesTaxTotal = Number(stRows?.[0]?.total) || 0;
        } catch { /* no sales tax data */ }

        // Change 68: Quarterly comparison
        let quarterlyData: QuarterData[] = [];
        try {
          const qRows: any[] = await api.rawQuery(
            `SELECT
               CASE
                 WHEN CAST(strftime('%m', date) AS INTEGER) BETWEEN 1 AND 3 THEN 'Q1'
                 WHEN CAST(strftime('%m', date) AS INTEGER) BETWEEN 4 AND 6 THEN 'Q2'
                 WHEN CAST(strftime('%m', date) AS INTEGER) BETWEEN 7 AND 9 THEN 'Q3'
                 ELSE 'Q4'
               END as quarter,
               type as tax_type,
               COALESCE(SUM(amount), 0) as total
             FROM tax_payments
             WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?)
             GROUP BY quarter, type
             ORDER BY quarter`,
            [activeCompany.id, startDate, endDate]
          );

          const qMap = new Map<string, { income_tax: number; payroll_tax: number; sales_tax: number }>();
          for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
            qMap.set(q, { income_tax: 0, payroll_tax: 0, sales_tax: 0 });
          }
          for (const r of qRows ?? []) {
            const q = qMap.get(r.quarter);
            if (!q) continue;
            const tt = (r.tax_type || '').toLowerCase();
            const amt = Number(r.total) || 0;
            if (tt.includes('payroll') || tt.includes('941')) q.payroll_tax += amt;
            else if (tt.includes('sales')) q.sales_tax += amt;
            else q.income_tax += amt;
          }
          quarterlyData = Array.from(qMap.entries()).map(([quarter, d]) => ({
            quarter,
            income_tax: d.income_tax,
            payroll_tax: d.payroll_tax,
            sales_tax: d.sales_tax,
            total: d.income_tax + d.payroll_tax + d.sales_tax,
          }));
        } catch { /* no quarterly data */ }

        if (!cancelled) {
          setData({ totalRevenue, deductions, taxPayments, payrollTaxTotal, salesTaxTotal, quarterlyData });
        }
      } catch (err: any) {
        console.error('Failed to load Tax Summary:', err);
        if (!cancelled) setError(err?.message || 'Failed to load Tax Summary');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [startDate, endDate, activeCompany]);

  // ─── Computed totals ────────────────────────────────────
  const totalDeductions = useMemo(() => data.deductions.reduce((s, d) => s + d.total, 0), [data.deductions]);
  const taxableIncome = data.totalRevenue - totalDeductions;
  const estimatedTaxRate = 0.25;
  const estimatedTax = Math.max(0, taxableIncome * estimatedTaxRate);
  const totalPayments = useMemo(() => data.taxPayments.reduce((s, p) => s + p.amount, 0), [data.taxPayments]);
  const balanceDue = estimatedTax - totalPayments;
  const effectiveTaxRate = data.totalRevenue > 0 ? (totalPayments / data.totalRevenue) * 100 : 0;

  // ─── Change 69: Tax Calendar ────────────────────────────
  const taxDeadlines = useMemo(() => {
    const year = new Date().getFullYear();
    const today = new Date();
    return getTaxDeadlines(year)
      .map(d => ({
        ...d,
        daysRemaining: differenceInCalendarDays(parseISO(d.date), today),
      }))
      .filter(d => d.daysRemaining >= -30) // Show recent past deadlines too
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, []);

  // ─── Quick date presets ─────────────────────────────────
  const setPreset = (label: string) => {
    const now = new Date();
    switch (label) {
      case 'This Year': {
        const fy = activeCompany?.fiscal_year_start || 1;
        setStartDate(fiscalYearStart(now, fy));
        setEndDate(fiscalYearEnd(now, fy));
        break;
      }
      case 'Last Year': {
        const fy = activeCompany?.fiscal_year_start || 1;
        const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        setStartDate(fiscalYearStart(lastYear, fy));
        setEndDate(fiscalYearEnd(lastYear, fy));
        break;
      }
    }
  };

  // ─── Change 70: CSV Export ──────────────────────────────
  const handleExportCSV = () => {
    const rows: Record<string, any>[] = [];
    rows.push({ section: 'Revenue', item: 'Total Revenue', amount: data.totalRevenue.toFixed(2) });
    for (const d of data.deductions) {
      rows.push({ section: 'Deductions', item: d.category, amount: d.total.toFixed(2) });
    }
    rows.push({ section: 'Totals', item: 'Total Deductions', amount: totalDeductions.toFixed(2) });
    rows.push({ section: 'Totals', item: 'Taxable Income', amount: taxableIncome.toFixed(2) });
    rows.push({ section: 'Totals', item: 'Estimated Tax', amount: estimatedTax.toFixed(2) });
    for (const p of data.taxPayments) {
      rows.push({ section: 'Payments', item: `${p.tax_type} - ${p.description || p.payment_date}`, amount: p.amount.toFixed(2) });
    }
    rows.push({ section: 'Totals', item: 'Balance Due', amount: balanceDue.toFixed(2) });
    downloadCSVBlob(rows, `tax-summary-${startDate}-to-${endDate}.csv`);
  };

  // ─── Change 70: Enhanced Print ──────────────────────────
  const handlePrint = async () => {
    const escHtml = (s: string | null | undefined): string => {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    const deductionRows = data.deductions.map(d => `<tr><td style="padding:4px 20px 4px 40px;border-bottom:1px solid #e2e8f0;font-size:11px;">${escHtml(d.category)}</td><td style="padding:4px 20px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;font-size:11px;">${fmt.format(d.total)}</td></tr>`).join('');
    const paymentRows = data.taxPayments.map(p => `<tr><td style="padding:4px 20px 4px 40px;border-bottom:1px solid #e2e8f0;font-size:11px;">${escHtml(p.tax_type)} - ${escHtml(p.description || p.payment_date)}</td><td style="padding:4px 20px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;font-size:11px;">${fmt.format(p.amount)}</td></tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @page { size: letter; margin: 0.5in 0.6in; }
      body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #111; }
      h1 { font-size: 18px; margin-bottom: 4px; text-align: center; } h2 { font-size: 12px; color: #475569; margin-bottom: 16px; text-align: center; }
      .section { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 20px; background: #f8fafc; }
      .subtotal td { font-weight: 700; border-top: 1px solid #334155; }
      .grand td { font-weight: 700; border-top: 2px solid #0f172a; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      @media print { tr { page-break-inside: avoid; } }
    </style></head><body>
      <h1>${escHtml(activeCompany?.name || 'Company')} - Tax Summary</h1>
      <h2>${escHtml(startDate)} to ${escHtml(endDate)}</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
        <div style="padding:10px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;"><div style="font-size:16px;font-weight:700;">${fmt.format(data.totalRevenue)}</div><div style="font-size:9px;color:#64748b;text-transform:uppercase;">Revenue</div></div>
        <div style="padding:10px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;"><div style="font-size:16px;font-weight:700;">${fmt.format(totalPayments)}</div><div style="font-size:9px;color:#64748b;text-transform:uppercase;">Tax Paid</div></div>
        <div style="padding:10px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;"><div style="font-size:16px;font-weight:700;color:${balanceDue > 0 ? '#ef4444' : '#22c55e'};">${fmt.format(Math.abs(balanceDue))}</div><div style="font-size:9px;color:#64748b;text-transform:uppercase;">${balanceDue >= 0 ? 'Balance Due' : 'Overpayment'}</div></div>
      </div>
      <table>
        <tr><td colspan="2" class="section">Income</td></tr>
        <tr><td style="padding:4px 20px 4px 40px;font-size:11px;">Total Revenue</td><td style="padding:4px 20px;text-align:right;font-size:11px;">${fmt.format(data.totalRevenue)}</td></tr>
        <tr class="subtotal"><td style="padding:6px 20px;font-size:11px;">Gross Income</td><td style="padding:6px 20px;text-align:right;font-size:11px;">${fmt.format(data.totalRevenue)}</td></tr>
        <tr><td colspan="2" class="section">Deductions</td></tr>
        ${deductionRows || '<tr><td style="padding:4px 40px;font-size:11px;" colspan="2">No deductions</td></tr>'}
        <tr class="subtotal"><td style="padding:6px 20px;font-size:11px;">Total Deductions</td><td style="padding:6px 20px;text-align:right;font-size:11px;color:#ef4444;">${fmt.format(totalDeductions)}</td></tr>
        <tr class="grand"><td style="padding:8px 20px;">Taxable Income</td><td style="padding:8px 20px;text-align:right;">${fmt.format(taxableIncome)}</td></tr>
        <tr><td colspan="2" class="section">Tax Payments</td></tr>
        ${paymentRows || '<tr><td style="padding:4px 40px;font-size:11px;" colspan="2">No payments</td></tr>'}
        <tr class="subtotal"><td style="padding:6px 20px;font-size:11px;">Total Payments</td><td style="padding:6px 20px;text-align:right;font-size:11px;">${fmt.format(totalPayments)}</td></tr>
        <tr class="grand"><td style="padding:8px 20px;">${balanceDue >= 0 ? 'Estimated Balance Due' : 'Estimated Overpayment'}</td><td style="padding:8px 20px;text-align:right;color:${balanceDue > 0 ? '#ef4444' : '#22c55e'};">${fmt.format(Math.abs(balanceDue))}</td></tr>
      </table>
      <p style="font-size:9px;color:#94a3b8;margin-top:12px;">This is an estimate. The 25% flat rate is a simplified approximation. Consult a tax professional.</p>
    </body></html>`;
    await api.printPreview(html, 'Tax Summary');
  };

  return (
    <div className="space-y-4">
      <PrintReportHeader title="Tax Summary" periodLabel="period" periodEnd={endDate} />
      {error && <ErrorBanner message={error} title="Failed to load Tax Summary" onDismiss={() => setError('')} />}

      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between flex-wrap gap-3" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">From</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">To</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <div className="flex gap-1 ml-2">
            {['This Year', 'Last Year'].map((p) => (
              <button key={p} onClick={() => setPreset(p)} className="px-2 py-1 text-[10px] font-semibold bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" style={{ borderRadius: '6px' }}>{p}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="block-btn flex items-center gap-2 text-xs"><Printer size={14} /> Print</button>
          <button onClick={handleExportCSV} className="block-btn flex items-center gap-2 text-xs"><Download size={14} /> CSV</button>
        </div>
      </div>

      {/* Change 66-67: KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'Total Revenue', value: formatCurrency(data.totalRevenue), color: 'text-accent-income' },
          { label: 'Total Tax Paid', value: formatCurrency(totalPayments), color: 'text-accent-expense' },
          { label: balanceDue >= 0 ? 'Net Tax Due' : 'Overpayment', value: formatCurrency(Math.abs(balanceDue)), color: balanceDue > 0 ? 'text-accent-expense' : 'text-accent-income' },
          { label: 'Effective Tax Rate', value: `${effectiveTaxRate.toFixed(1)}%`, color: 'text-accent-blue' },
          { label: 'YTD Payroll Tax', value: formatCurrency(data.payrollTaxTotal), color: 'text-text-primary' },
          { label: 'Sales Tax Paid', value: formatCurrency(data.salesTaxTotal), color: 'text-text-primary' },
        ].map(c => (
          <div key={c.label} className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
            <p className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Report body */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : (
        <>
          <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
            {/* Report header */}
            <div className="px-6 py-4 border-b border-border-primary bg-bg-tertiary/50 text-center">
              <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">{activeCompany?.name ?? 'Company'}</h2>
              <h3 className="text-xs text-text-secondary mt-0.5">Tax Summary</h3>
              <p className="text-[10px] text-text-muted mt-0.5">
                {format(parseISO(startDate), 'MMM d, yyyy')} &ndash; {format(parseISO(endDate), 'MMM d, yyyy')}
              </p>
            </div>

            <table className="w-full text-sm">
              <tbody>
                <SectionHeader label="Income" />
                <LineRow name="Total Revenue" amount={data.totalRevenue} indent={1} />
                <SubtotalRow label="Gross Income" amount={data.totalRevenue} accent="text-accent-income" topBorder />
                <Spacer />
                <SectionHeader label="Deductions by Tax Category" />
                {data.deductions.length > 0 ? (
                  data.deductions.map((d) => <LineRow key={d.category} name={d.category} amount={d.total} indent={1} />)
                ) : (
                  <LineRow name="No deductions recorded" amount={0} indent={1} />
                )}
                <SubtotalRow label="Total Deductions" amount={totalDeductions} accent="text-accent-expense" topBorder />
                <Spacer />
                <SubtotalRow label="Taxable Income" amount={taxableIncome} accent={taxableIncome >= 0 ? 'text-accent-income' : 'text-accent-expense'} doubleBorder />
                <Spacer />
                <SectionHeader label="Tax Estimate" />
                <LineRow name={`Estimated tax (${(estimatedTaxRate * 100).toFixed(0)}% rate)`} amount={estimatedTax} indent={1} />
                <Spacer />
                <SectionHeader label="Tax Payments Made" />
                {data.taxPayments.length > 0 ? (
                  data.taxPayments.map((p) => (
                    <LineRow key={p.id} name={`${p.tax_type} - ${p.description || format(parseISO(p.payment_date), 'MMM d, yyyy')}`} amount={p.amount} indent={1} />
                  ))
                ) : (
                  <LineRow name="No tax payments recorded" amount={0} indent={1} />
                )}
                <SubtotalRow label="Total Payments" amount={totalPayments} topBorder />
                <Spacer />
                <tr className="border-t-2 border-text-primary bg-bg-tertiary/50">
                  <td className="px-6 py-3 text-sm font-bold text-text-primary">{balanceDue >= 0 ? 'Estimated Balance Due' : 'Estimated Overpayment'}</td>
                  <td className={`py-3 text-right pr-6 font-mono text-sm font-bold ${balanceDue > 0 ? 'text-accent-expense' : 'text-accent-income'}`}>{fmt.format(Math.abs(balanceDue))}</td>
                </tr>
              </tbody>
            </table>

            <div className="px-6 py-3 border-t border-border-primary bg-bg-tertiary/30">
              <p className="text-[10px] text-text-muted">
                This is an estimate only. The 25% flat rate is a simplified approximation. Consult a tax professional for accurate tax calculations based on your specific situation and applicable tax brackets.
              </p>
            </div>
          </div>

          {/* Change 68: Quarterly Comparison Table */}
          {data.quarterlyData.some(q => q.total > 0) && (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-3 border-b border-border-primary bg-bg-tertiary/30">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Quarterly Tax Comparison</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-tertiary border-b border-border-primary">
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Tax Type</th>
                    {data.quarterlyData.map(q => (
                      <th key={q.quarter} className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">{q.quarter}</th>
                    ))}
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border-primary/50">
                    <td className="px-4 py-2 text-xs text-text-primary font-medium">Income Tax</td>
                    {data.quarterlyData.map(q => <td key={q.quarter} className="px-4 py-2 text-right font-mono text-xs">{formatCurrency(q.income_tax)}</td>)}
                    <td className="px-4 py-2 text-right font-mono text-xs font-bold">{formatCurrency(data.quarterlyData.reduce((s, q) => s + q.income_tax, 0))}</td>
                  </tr>
                  <tr className="border-b border-border-primary/50">
                    <td className="px-4 py-2 text-xs text-text-primary font-medium">Payroll Tax</td>
                    {data.quarterlyData.map(q => <td key={q.quarter} className="px-4 py-2 text-right font-mono text-xs">{formatCurrency(q.payroll_tax)}</td>)}
                    <td className="px-4 py-2 text-right font-mono text-xs font-bold">{formatCurrency(data.quarterlyData.reduce((s, q) => s + q.payroll_tax, 0))}</td>
                  </tr>
                  <tr className="border-b border-border-primary/50">
                    <td className="px-4 py-2 text-xs text-text-primary font-medium">Sales Tax</td>
                    {data.quarterlyData.map(q => <td key={q.quarter} className="px-4 py-2 text-right font-mono text-xs">{formatCurrency(q.sales_tax)}</td>)}
                    <td className="px-4 py-2 text-right font-mono text-xs font-bold">{formatCurrency(data.quarterlyData.reduce((s, q) => s + q.sales_tax, 0))}</td>
                  </tr>
                  <tr className="border-t-2 border-border-primary bg-bg-tertiary/30">
                    <td className="px-4 py-2 text-xs font-bold text-text-primary">Total</td>
                    {data.quarterlyData.map(q => <td key={q.quarter} className="px-4 py-2 text-right font-mono text-xs font-bold">{formatCurrency(q.total)}</td>)}
                    <td className="px-4 py-2 text-right font-mono text-xs font-bold text-accent-expense">{formatCurrency(data.quarterlyData.reduce((s, q) => s + q.total, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Change 69: Tax Calendar */}
          <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
            <div className="px-4 py-3 border-b border-border-primary bg-bg-tertiary/30 flex items-center gap-2">
              <Calendar size={14} className="text-text-muted" />
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Upcoming Tax Deadlines</h3>
            </div>
            <div className="divide-y divide-border-primary/50">
              {taxDeadlines.slice(0, 8).map((d, idx) => {
                const isPast = d.daysRemaining < 0;
                const isUrgent = d.daysRemaining >= 0 && d.daysRemaining <= 14;
                const isSoon = d.daysRemaining > 14 && d.daysRemaining <= 30;
                return (
                  <div key={idx} className="px-4 py-2 flex items-center justify-between">
                    <div>
                      <p className={`text-xs font-medium ${isPast ? 'text-text-muted line-through' : 'text-text-primary'}`}>{d.name}</p>
                      <p className="text-[10px] text-text-muted">{d.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono text-text-secondary">{d.date}</p>
                      <p className={`text-[10px] font-semibold ${isPast ? 'text-text-muted' : isUrgent ? 'text-accent-expense' : isSoon ? 'text-accent-blue' : 'text-text-muted'}`}>
                        {isPast ? `${Math.abs(d.daysRemaining)}d ago` : d.daysRemaining === 0 ? 'TODAY' : `${d.daysRemaining}d remaining`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      <PrintReportFooter />
    </div>
  );
};

export default TaxSummary;
