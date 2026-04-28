import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download, ToggleLeft, ToggleRight } from 'lucide-react';
import { format, endOfMonth, parseISO, differenceInDays } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { fiscalYearStart, fiscalYearEnd } from '../../lib/date-helpers';
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

// ─── KPI Card ───────────────────────────────────────────
const KPICard: React.FC<{
  label: string;
  value: number | string;
  subtitle?: string;
  borderColor: string;
  isText?: boolean;
}> = ({ label, value, subtitle, borderColor, isText }) => (
  <div
    className={`block-card p-3 border-l-4 ${borderColor}`}
    style={{ borderRadius: '6px' }}
  >
    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
      {label}
    </div>
    <div className={`text-base font-bold font-mono mt-1 ${
      isText ? 'text-text-primary' : ((value as number) >= 0 ? 'text-text-primary' : 'text-accent-expense')
    }`}>
      {isText ? value : fmtNeg(value as number)}
    </div>
    {subtitle && (
      <div className="text-[10px] text-text-muted mt-0.5">{subtitle}</div>
    )}
  </div>
);

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

interface IndirectData {
  netIncome: number;
  depreciation: number;
  amortization: number;
  arChange: number;
  apChange: number;
  inventoryChange: number;
  prepaidChange: number;
}

interface MonthlyCashFlow {
  month: string;
  netCash: number;
}

// ─── Component ──────────────────────────────────────────
const CashFlowStatement: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [startDate, setStartDate] = useState(() =>
    fiscalYearStart(new Date(), 1)
  );
  const [endDate, setEndDate] = useState(() =>
    format(endOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [method, setMethod] = useState<'direct' | 'indirect'>('direct');
  const [monthlyCashFlow, setMonthlyCashFlow] = useState<MonthlyCashFlow[]>([]);
  const [indirectData, setIndirectData] = useState<IndirectData>({
    netIncome: 0, depreciation: 0, amortization: 0,
    arChange: 0, apChange: 0, inventoryChange: 0, prepaidChange: 0,
  });
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
        // Operating: cash received via payments on invoices
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

        // Investing: asset purchases
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

        // Beginning cash
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

        // ─── Indirect method data ──────────────────────
        // Net income for the period
        const niRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(jel.credit - jel.debit), 0) as total
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.company_id = ? AND date(je.date) BETWEEN date(?) AND date(?)
             AND a.type IN ('revenue', 'expense')`,
          [activeCompany.id, startDate, endDate]
        );
        const netIncome = Number(niRows?.[0]?.total) || 0;

        // Depreciation & amortization
        const depRows: any[] = await api.rawQuery(
          `SELECT
             COALESCE(SUM(CASE WHEN a.subtype LIKE '%depreciation%' OR a.name LIKE '%depreciation%' THEN ABS(jel.debit - jel.credit) ELSE 0 END), 0) as depreciation,
             COALESCE(SUM(CASE WHEN a.subtype LIKE '%amortization%' OR a.name LIKE '%amortization%' THEN ABS(jel.debit - jel.credit) ELSE 0 END), 0) as amortization
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.company_id = ? AND date(je.date) BETWEEN date(?) AND date(?)
             AND a.type = 'expense'`,
          [activeCompany.id, startDate, endDate]
        );
        const depreciation = Number(depRows?.[0]?.depreciation) || 0;
        const amortization = Number(depRows?.[0]?.amortization) || 0;

        // Working capital changes (balance at end vs balance at start)
        const wcHelper = async (subtypePattern: string, acctType: string) => {
          const endBal: any[] = await api.rawQuery(
            `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as total
             FROM journal_entry_lines jel JOIN accounts a ON a.id = jel.account_id
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             WHERE je.company_id = ? AND date(je.date) <= date(?)
               AND a.type = ? AND a.subtype LIKE ?`,
            [activeCompany.id, endDate, acctType, subtypePattern]
          );
          const startBal: any[] = await api.rawQuery(
            `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as total
             FROM journal_entry_lines jel JOIN accounts a ON a.id = jel.account_id
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             WHERE je.company_id = ? AND date(je.date) < date(?)
               AND a.type = ? AND a.subtype LIKE ?`,
            [activeCompany.id, startDate, acctType, subtypePattern]
          );
          return (Number(endBal?.[0]?.total) || 0) - (Number(startBal?.[0]?.total) || 0);
        };

        const arChange = await wcHelper('%receivable%', 'asset');
        const apChange = await wcHelper('%payable%', 'liability');
        const inventoryChange = await wcHelper('%inventory%', 'asset');
        const prepaidChange = await wcHelper('%prepaid%', 'asset');

        if (!cancelled) {
          setIndirectData({
            netIncome, depreciation, amortization,
            arChange, apChange, inventoryChange, prepaidChange,
          });
        }

        // ─── Monthly cash flow trend ───────────────────
        const yearStart = startDate.slice(0, 4) + '-01-01';
        const yearEnd = startDate.slice(0, 4) + '-12-31';

        // Monthly payments received
        const monthlyInRows: any[] = await api.rawQuery(
          `SELECT strftime('%Y-%m', p.date) as month, COALESCE(SUM(p.amount), 0) as inflow
           FROM payments p
           WHERE p.company_id = ? AND date(p.date) >= date(?) AND date(p.date) <= date(?)
           GROUP BY month ORDER BY month`,
          [activeCompany.id, yearStart, yearEnd]
        );

        // Monthly expenses paid
        const monthlyOutRows: any[] = await api.rawQuery(
          `SELECT strftime('%Y-%m', e.date) as month, COALESCE(SUM(e.amount), 0) as outflow
           FROM expenses e
           WHERE e.company_id = ? AND date(e.date) >= date(?) AND date(e.date) <= date(?)
           GROUP BY month ORDER BY month`,
          [activeCompany.id, yearStart, yearEnd]
        );

        const inMap = new Map<string, number>();
        for (const r of monthlyInRows ?? []) inMap.set(r.month, Number(r.inflow) || 0);

        const outMap = new Map<string, number>();
        for (const r of monthlyOutRows ?? []) outMap.set(r.month, Number(r.outflow) || 0);

        const allMonths = new Set([...inMap.keys(), ...outMap.keys()]);
        const monthlyData: MonthlyCashFlow[] = [];
        for (const m of [...allMonths].sort()) {
          monthlyData.push({
            month: m,
            netCash: (inMap.get(m) || 0) - (outMap.get(m) || 0),
          });
        }

        if (!cancelled) {
          setMonthlyCashFlow(monthlyData);
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

  // Free cash flow = operating - capex
  const freeCashFlow = netOperating - data.investingOutflows;
  // Cash conversion ratio
  const cashConversionRatio = indirectData.netIncome !== 0
    ? netOperating / indirectData.netIncome
    : 0;

  // Indirect method operating CF
  const indirectOperatingCF = useMemo(() => {
    return indirectData.netIncome
      + indirectData.depreciation
      + indirectData.amortization
      - indirectData.arChange
      + indirectData.apChange
      - indirectData.inventoryChange
      - indirectData.prepaidChange;
  }, [indirectData]);

  // ─── Cash balance projection ──────────────────────────
  const projection = useMemo(() => {
    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      const days = differenceInDays(end, start) + 1;
      if (days >= 365) return null;

      const dailyRate = netChange / days;
      const monthlyRate = dailyRate * 30;
      const daysRemaining = 365 - days;
      const projectedYearEnd = endingCash + (dailyRate * daysRemaining);
      const monthsOfRunway = monthlyRate < 0
        ? Math.floor(endingCash / Math.abs(monthlyRate))
        : null;

      return {
        currentCash: endingCash,
        monthlyRate,
        projectedYearEnd,
        monthsOfRunway,
        daysElapsed: days,
      };
    } catch {
      return null;
    }
  }, [startDate, endDate, netChange, endingCash]);

  // ─── Quick date presets ─────────────────────────────────
  const setPreset = (label: string) => {
    const now = new Date();
    switch (label) {
      case 'This Month':
        setStartDate(format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
        break;
      case 'This Year':
        setStartDate(fiscalYearStart(now, activeCompany?.fiscal_year_start || 1));
        setEndDate(fiscalYearEnd(now, activeCompany?.fiscal_year_start || 1));
        break;
    }
  };

  // ─── CSV Export ────────────────────────────────────────
  const handleExportCSV = () => {
    const csvRows = [
      { section: 'OPERATING ACTIVITIES', line: '', amount: '' },
      { section: '', line: 'Cash received from customers', amount: data.operatingInflows },
      { section: '', line: 'Cash paid for expenses', amount: -data.operatingOutflows },
      { section: 'Net Operating Cash Flow', line: '', amount: netOperating },
      { section: '', line: '', amount: '' },
      { section: 'INVESTING ACTIVITIES', line: '', amount: '' },
      { section: '', line: 'Purchase of assets', amount: -data.investingOutflows },
      { section: 'Net Investing Cash Flow', line: '', amount: netInvesting },
      { section: '', line: '', amount: '' },
      { section: 'FINANCING ACTIVITIES', line: '', amount: '' },
      { section: '', line: 'Owner equity contributions', amount: data.financingEquityIn },
      { section: '', line: 'Owner draws', amount: -data.financingDraws },
      { section: 'Net Financing Cash Flow', line: '', amount: netFinancing },
      { section: '', line: '', amount: '' },
      { section: 'Net Change in Cash', line: '', amount: netChange },
      { section: 'Beginning Cash Balance', line: '', amount: data.beginningCash },
      { section: 'Ending Cash Balance', line: '', amount: endingCash },
      { section: '', line: '', amount: '' },
      { section: 'Free Cash Flow', line: '', amount: freeCashFlow },
      { section: 'Cash Conversion Ratio', line: '', amount: cashConversionRatio.toFixed(2) },
    ];
    downloadCSVBlob(csvRows, `cash-flow-${startDate}-to-${endDate}.csv`);
  };

  // ─── Custom chart tooltip ──────────────────────────────
  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="block-card p-2 text-xs" style={{ borderRadius: '6px' }}>
        <div className="font-semibold text-text-primary">{label}</div>
        {payload.map((p: any, i: number) => (
          <div key={i} className="text-text-secondary">
            {p.name}: {fmt.format(p.value)}
          </div>
        ))}
      </div>
    );
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
        <div className="flex gap-2 items-center">
          <button
            className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold transition-colors ${
              method === 'indirect' ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted bg-bg-tertiary hover:text-text-primary hover:bg-bg-hover'
            }`}
            style={{ borderRadius: '6px' }}
            title="Toggle Direct / Indirect Method"
            onClick={() => setMethod(m => m === 'direct' ? 'indirect' : 'direct')}
          >
            {method === 'direct' ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
            {method === 'direct' ? 'Direct' : 'Indirect'}
          </button>
          <button
            onClick={() => window.print()}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print"
          >
            <Printer size={15} />
          </button>
          <button
            onClick={handleExportCSV}
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
        <>
          {/* ─── KPI Summary Cards ───────────────────── */}
          <div className="grid grid-cols-6 gap-3">
            <KPICard label="Operating CF" value={netOperating} borderColor="border-l-accent-income" />
            <KPICard label="Investing CF" value={netInvesting} borderColor="border-l-accent-blue" />
            <KPICard label="Financing CF" value={netFinancing} borderColor="border-l-[#8b5cf6]" />
            <KPICard label="Net Cash Change" value={netChange} borderColor="border-l-[#f59e0b]" />
            <KPICard label="Free Cash Flow" value={freeCashFlow} subtitle="Operating - CapEx" borderColor="border-l-[#06b6d4]" />
            <KPICard
              label="Cash Conversion"
              value={`${cashConversionRatio.toFixed(2)}x`}
              subtitle="Operating CF / Net Income"
              borderColor="border-l-[#ec4899]"
              isText
            />
          </div>

          {/* ─── Monthly Cash Flow Trend ─────────────── */}
          {monthlyCashFlow.length > 0 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                Monthly Net Cash Flow ({startDate.slice(0, 4)})
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyCashFlow}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                    tickFormatter={(v: string) => v.slice(5)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="netCash" name="Net Cash Flow" radius={[4, 4, 0, 0]}>
                    {monthlyCashFlow.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.netCash >= 0 ? '#22c55e' : '#ef4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ─── Cash Flow Table ──────────────────────── */}
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
                Cash Flow Statement ({method === 'direct' ? 'Direct Method' : 'Indirect Method'})
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
                {method === 'direct' ? (
                  <>
                    <LineRow name="Cash received from customers" amount={data.operatingInflows} indent={1} />
                    <LineRow name="Cash paid for expenses" amount={-data.operatingOutflows} indent={1} />
                  </>
                ) : (
                  <>
                    <LineRow name="Net Income" amount={indirectData.netIncome} indent={1} bold />
                    <tr>
                      <td colSpan={2} className="px-6 pt-2 pb-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider" style={{ paddingLeft: '24px' }}>
                        Adjustments for Non-Cash Items
                      </td>
                    </tr>
                    <LineRow name="Add: Depreciation" amount={indirectData.depreciation} indent={2} />
                    <LineRow name="Add: Amortization" amount={indirectData.amortization} indent={2} />
                    <tr>
                      <td colSpan={2} className="px-6 pt-2 pb-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider" style={{ paddingLeft: '24px' }}>
                        Changes in Working Capital
                      </td>
                    </tr>
                    <LineRow
                      name="(Increase)/Decrease in Accounts Receivable"
                      amount={-indirectData.arChange}
                      indent={2}
                    />
                    <LineRow
                      name="Increase/(Decrease) in Accounts Payable"
                      amount={indirectData.apChange}
                      indent={2}
                    />
                    <LineRow
                      name="(Increase)/Decrease in Inventory"
                      amount={-indirectData.inventoryChange}
                      indent={2}
                    />
                    <LineRow
                      name="(Increase)/Decrease in Prepaid Expenses"
                      amount={-indirectData.prepaidChange}
                      indent={2}
                    />
                  </>
                )}
                <SubtotalRow
                  label="Net Cash from Operating Activities"
                  amount={method === 'direct' ? netOperating : indirectOperatingCF}
                  accent={
                    (method === 'direct' ? netOperating : indirectOperatingCF) >= 0
                      ? 'text-accent-income'
                      : 'text-accent-expense'
                  }
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

          {/* ─── Cash Balance Projection ─────────────── */}
          {projection && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                Cash Balance Projection (Year-End Estimate)
              </div>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Current Cash</div>
                  <div className={`text-sm font-bold font-mono mt-1 ${projection.currentCash >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                    {fmtNeg(projection.currentCash)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Monthly Rate</div>
                  <div className={`text-sm font-bold font-mono mt-1 ${projection.monthlyRate >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                    {fmtNeg(projection.monthlyRate)}
                    <span className="text-[10px] text-text-muted ml-1">/mo</span>
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Projected Year-End</div>
                  <div className={`text-sm font-bold font-mono mt-1 ${projection.projectedYearEnd >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                    {fmtNeg(projection.projectedYearEnd)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    {projection.monthsOfRunway !== null ? 'Months of Runway' : 'Cash Status'}
                  </div>
                  <div className="text-sm font-bold font-mono mt-1 text-text-primary">
                    {projection.monthsOfRunway !== null
                      ? `${projection.monthsOfRunway} months`
                      : 'Accumulating'}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-text-muted text-center">
                Based on {projection.daysElapsed} days of data, projecting remaining {365 - projection.daysElapsed} days at current rate
              </div>
            </div>
          )}
        </>
      )}
      <PrintReportFooter />
    </div>
  );
};

export default CashFlowStatement;
