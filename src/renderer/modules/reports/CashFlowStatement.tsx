import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download } from 'lucide-react';
import { format, startOfYear, endOfMonth, parseISO } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';
import { downloadCSVBlob } from '../../lib/csv-export';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
      {fmtNeg(amount)}
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
    className={`${topBorder ? 'border-t border-border-primary report-subtotal-row' : ''} ${doubleBorder ? 'border-t-2 border-border-primary report-grand-total-row' : ''}`}
  >
    <td className="px-6 py-2 text-xs font-bold text-text-primary">
      {label}
    </td>
    <td
      className={`py-2 text-right pr-6 font-mono text-xs font-bold ${accent || 'text-text-primary'}`}
    >
      {fmtNeg(amount)}
    </td>
  </tr>
);

const Spacer: React.FC = () => (
  <tr>
    <td colSpan={2} className="py-1" />
  </tr>
);

// ─── Types ──────────────────────────────────────────────
interface CashFlowData {
  operatingInflows: number;
  operatingOutflows: number;
  investingOutflows: number;
  financingEquityIn: number;
  financingDraws: number;
  beginningCash: number;
}

// ─── Component ──────────────────────────────────────────
const CashFlowStatement: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [startDate, setStartDate] = useState(() =>
    format(startOfYear(new Date()), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(() =>
    format(endOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<CashFlowData>({
    operatingInflows: 0,
    operatingOutflows: 0,
    investingOutflows: 0,
    financingEquityIn: 0,
    financingDraws: 0,
    beginningCash: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');

      try {
        // Operating: cash received via payments on invoices (actual cash in during period)
        const revenueRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(p.amount), 0) as total
           FROM payments p
           WHERE p.company_id = ? AND date(p.date) BETWEEN date(?) AND date(?)`,
          [activeCompany.id, startDate, endDate]
        );
        const operatingInflows = Number(revenueRows?.[0]?.total) || 0;

        // Operating: expenses paid
        const expenseRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM expenses
           WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?)`,
          [activeCompany.id, startDate, endDate]
        );
        const operatingOutflows = Number(expenseRows?.[0]?.total) || 0;

        // Investing: asset purchases from inventory (is_asset = 1)
        const investRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(unit_cost * quantity), 0) as total
           FROM inventory_items
           WHERE company_id = ? AND is_asset = 1 AND date(created_at) BETWEEN ? AND ?`,
          [activeCompany.id, startDate, endDate]
        );
        const investingOutflows = Number(investRows?.[0]?.total) || 0;

        // Financing: owner equity contributions
        const equityRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(jel.credit - jel.debit), 0) as total
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.company_id = ? AND date(je.date) BETWEEN date(?) AND date(?)
             AND a.type = 'equity' AND a.subtype LIKE '%contributed%'`,
          [activeCompany.id, startDate, endDate]
        );
        const financingEquityIn = Number(equityRows?.[0]?.total) || 0;

        // Financing: owner draws
        const drawRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as total
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.company_id = ? AND date(je.date) BETWEEN date(?) AND date(?)
             AND a.type = 'equity' AND a.subtype LIKE '%draw%'`,
          [activeCompany.id, startDate, endDate]
        );
        const financingDraws = Number(drawRows?.[0]?.total) || 0;

        // Beginning cash: sum of all cash/bank accounts before start date
        const beginCashRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as total
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.company_id = ? AND date(je.date) < date(?)
             AND a.type = 'asset' AND (a.subtype LIKE '%cash%' OR a.subtype LIKE '%bank%')`,
          [activeCompany.id, startDate]
        );
        const beginningCash = Number(beginCashRows?.[0]?.total) || 0;

        if (!cancelled) {
          setData({
            operatingInflows,
            operatingOutflows,
            investingOutflows,
            financingEquityIn,
            financingDraws,
            beginningCash,
          });
        }
      } catch (err: any) {
        console.error('Failed to load Cash Flow Statement:', err);
        if (!cancelled) setError(err?.message || 'Failed to load Cash Flow Statement');
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
  const netOperating = data.operatingInflows - data.operatingOutflows;
  const netInvesting = -data.investingOutflows;
  const netFinancing = data.financingEquityIn - data.financingDraws;
  const netChange = netOperating + netInvesting + netFinancing;
  const endingCash = data.beginningCash + netChange;

  // ─── Quick date presets ─────────────────────────────────
  const setPreset = (label: string) => {
    const now = new Date();
    switch (label) {
      case 'This Month':
        setStartDate(format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
        break;
      case 'This Year':
        setStartDate(format(startOfYear(now), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
        break;
    }
  };

  return (
    <div className="space-y-4">
      <PrintReportHeader title="Statement of Cash Flows" periodLabel="period" periodEnd={endDate} />
      {error && <ErrorBanner message={error} title="Failed to load Cash Flow Statement" onDismiss={() => setError('')} />}
      {/* Controls */}
      <div
        className="block-card p-4 flex items-center justify-between"
        style={{ borderRadius: '6px' }}
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
            {['This Month', 'This Year'].map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className="px-2 py-1 text-[10px] font-semibold bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                style={{ borderRadius: '6px' }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print"
          >
            <Printer size={15} />
          </button>
          <button
            onClick={() => {
              downloadCSVBlob([
                { line: 'Cash received from customers', amount: data.operatingInflows },
                { line: 'Cash paid for expenses', amount: -data.operatingOutflows },
                { line: 'Net Operating', amount: netOperating },
                { line: 'Purchase of assets', amount: -data.investingOutflows },
                { line: 'Net Investing', amount: netInvesting },
                { line: 'Owner equity contributions', amount: data.financingEquityIn },
                { line: 'Owner draws', amount: -data.financingDraws },
                { line: 'Net Financing', amount: netFinancing },
                { line: 'Net Change in Cash', amount: netChange },
                { line: 'Beginning Cash', amount: data.beginningCash },
                { line: 'Ending Cash', amount: endingCash },
              ], `cash-flow-${startDate}-to-${endDate}.csv`);
            }}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Export CSV"
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
          style={{ borderRadius: '6px' }}
        >
          {/* Report header */}
          <div className="px-6 py-4 border-b border-border-primary bg-bg-tertiary/50 text-center">
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">
              {activeCompany?.name ?? 'Company'}
            </h2>
            <h3 className="text-xs text-text-secondary mt-0.5">
              Cash Flow Statement
            </h3>
            <p className="text-[10px] text-text-muted mt-0.5">
              {format(parseISO(startDate), 'MMM d, yyyy')} &ndash;{' '}
              {format(parseISO(endDate), 'MMM d, yyyy')}
            </p>
          </div>

          <table className="w-full text-sm">
            {/* Operating Activities */}
            <tbody className="cashflow-section">
              <SectionHeader label="Cash Flows from Operating Activities" />
              <LineRow name="Cash received from customers" amount={data.operatingInflows} indent={1} />
              <LineRow name="Cash paid for expenses" amount={-data.operatingOutflows} indent={1} />
              <SubtotalRow
                label="Net Cash from Operating Activities"
                amount={netOperating}
                accent={netOperating >= 0 ? 'text-accent-income' : 'text-accent-expense'}
                topBorder
              />
              <Spacer />
            </tbody>

            {/* Investing Activities */}
            <tbody className="cashflow-section">
              <SectionHeader label="Cash Flows from Investing Activities" />
              <LineRow name="Purchase of assets" amount={-data.investingOutflows} indent={1} />
              <SubtotalRow
                label="Net Cash from Investing Activities"
                amount={netInvesting}
                accent={netInvesting >= 0 ? 'text-accent-income' : 'text-accent-expense'}
                topBorder
              />
              <Spacer />
            </tbody>

            {/* Financing Activities */}
            <tbody className="cashflow-section">
              <SectionHeader label="Cash Flows from Financing Activities" />
              <LineRow name="Owner equity contributions" amount={data.financingEquityIn} indent={1} />
              <LineRow name="Owner draws" amount={-data.financingDraws} indent={1} />
              <SubtotalRow
                label="Net Cash from Financing Activities"
                amount={netFinancing}
                accent={netFinancing >= 0 ? 'text-accent-income' : 'text-accent-expense'}
                topBorder
              />
              <Spacer />
            </tbody>

            {/* Net Change */}
            <tbody className="cashflow-net-change">
              <SubtotalRow
                label="Net Change in Cash"
                amount={netChange}
                accent={netChange >= 0 ? 'text-accent-income' : 'text-accent-expense'}
                doubleBorder
              />
              <Spacer />

              {/* Beginning / Ending Cash */}
              <LineRow name="Beginning Cash Balance" amount={data.beginningCash} bold />

              {/* Final row */}
              <tr className="border-t-2 border-text-primary bg-bg-tertiary/50 report-grand-total-row">
                <td className="px-6 py-3 text-sm font-bold text-text-primary">
                  Ending Cash Balance
                </td>
                <td
                  className={`py-3 text-right pr-6 font-mono text-sm font-bold ${
                    endingCash >= 0
                      ? 'text-accent-income'
                      : 'text-accent-expense'
                  }`}
                >
                  {fmtNeg(endingCash)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <PrintReportFooter />
    </div>
  );
};

export default CashFlowStatement;
