import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Printer, Download, GitCompare, FileSpreadsheet, TrendingUp } from 'lucide-react';
import { format, startOfMonth, endOfMonth, parseISO, differenceInDays, startOfYear } from 'date-fns';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { fiscalYearStart, fiscalYearEnd } from '../../lib/date-helpers';
import { generateReportHTML } from '../../lib/print-templates';
import type { ReportColumn, ReportSummary } from '../../lib/print-templates';
import { downloadCSVBlob } from '../../lib/csv-export';
import ErrorBanner from '../../components/ErrorBanner';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';

// ─── Types ──────────────────────────────────────────────
interface LineItem {
  account_name: string;
  account_code: string;
  subtype: string;
  total: number;
}

interface PnLData {
  revenue: LineItem[];
  costOfServices: LineItem[];
  operatingExpenses: Record<string, LineItem[]>;
  otherIncome: LineItem[];
  otherExpenses: LineItem[];
}

interface MonthlyRevenue {
  month: string;
  revenue: number;
}

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

// ─── Chart theme colors ────────────────────────────────
const CHART_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

// ─── KPI Card ───────────────────────────────────────────
const KPICard: React.FC<{
  label: string;
  value: number;
  subtitle?: string;
  borderColor: string;
}> = ({ label, value, subtitle, borderColor }) => (
  <div
    className={`block-card p-3 border-l-4 ${borderColor}`}
    style={{ borderRadius: '6px' }}
  >
    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
      {label}
    </div>
    <div className={`text-base font-bold font-mono mt-1 ${value >= 0 ? 'text-text-primary' : 'text-accent-expense'}`}>
      {fmtNeg(value)}
    </div>
    {subtitle && (
      <div className="text-[10px] text-text-muted mt-0.5">{subtitle}</div>
    )}
  </div>
);

// ─── Ratio Box ──────────────────────────────────────────
const RatioBox: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{label}</div>
    <div className="text-sm font-bold text-text-primary font-mono mt-1">{value}</div>
  </div>
);

// ─── Render helpers ─────────────────────────────────────
const SectionHeader: React.FC<{ label: string; cols?: number }> = ({ label, cols = 2 }) => (
  <tr className="bg-bg-tertiary/30 report-section-heading">
    <td
      colSpan={cols}
      className="px-6 py-2 text-xs font-bold text-text-primary uppercase tracking-wider"
    >
      {label}
    </td>
  </tr>
);

const PnLLineRow: React.FC<{
  name: string;
  amount: number;
  indent?: number;
  bold?: boolean;
  accent?: string;
  priorAmount?: number | null;
  change?: React.ReactNode;
  annualized?: number | null;
}> = ({ name, amount, indent = 0, bold = false, accent, priorAmount, change, annualized }) => (
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
    {priorAmount !== undefined && priorAmount !== null && (
      <td className="py-1.5 text-right pr-4 font-mono text-xs text-text-muted">
        {fmtNeg(priorAmount)}
      </td>
    )}
    {change !== undefined && (
      <td className="py-1.5 text-right pr-6 text-xs">
        {change}
      </td>
    )}
    {annualized !== undefined && annualized !== null && (
      <td className="py-1.5 text-right pr-6 font-mono text-xs text-text-muted">
        {fmtNeg(annualized)}
      </td>
    )}
  </tr>
);

const PnLSubtotalRow: React.FC<{
  label: string;
  amount: number;
  accent?: string;
  topBorder?: boolean;
  doubleBorder?: boolean;
  priorAmount?: number | null;
  change?: React.ReactNode;
  annualized?: number | null;
}> = ({ label, amount, accent, topBorder, doubleBorder, priorAmount, change, annualized }) => (
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
    {priorAmount !== undefined && priorAmount !== null && (
      <td className="py-2 text-right pr-4 font-mono text-xs font-bold text-text-muted">
        {fmtNeg(priorAmount)}
      </td>
    )}
    {change !== undefined && (
      <td className="py-2 text-right pr-6 text-xs font-bold">
        {change}
      </td>
    )}
    {annualized !== undefined && annualized !== null && (
      <td className="py-2 text-right pr-6 font-mono text-xs font-bold text-text-muted">
        {fmtNeg(annualized)}
      </td>
    )}
  </tr>
);

const PnLSpacer: React.FC = () => (
  <tr>
    <td colSpan={2} className="py-1" />
  </tr>
);

// ─── Component ──────────────────────────────────────────
const ProfitAndLoss: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  // DATE: Item #9 — fiscal-year-aware default. Falls back to Jan 1 if no company yet.
  const [startDate, setStartDate] = useState(() =>
    fiscalYearStart(new Date(), 1)
  );
  const [endDate, setEndDate] = useState(() =>
    format(endOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compareYoY, setCompareYoY] = useState(false);
  const [showAnnualized, setShowAnnualized] = useState(false);
  const [priorData, setPriorData] = useState<PnLData | null>(null);
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([]);
  const [data, setData] = useState<PnLData>({
    revenue: [],
    costOfServices: [],
    operatingExpenses: {},
    otherIncome: [],
    otherExpenses: [],
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');

      try {
        const rows: any[] = await api.rawQuery(
          `SELECT
             a.name AS account_name,
             a.code AS account_code,
             a.type AS account_type,
             a.subtype AS subtype,
             COALESCE(SUM(jel.credit - jel.debit), 0) AS total
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE date(je.date) BETWEEN date(?) AND date(?)
             AND je.company_id = ?
             AND a.type IN ('revenue', 'expense')
           GROUP BY a.id, a.name, a.code, a.type, a.subtype
           ORDER BY a.type, a.subtype, a.code`,
          [startDate, endDate, activeCompany.id]
        );

        if (cancelled) return;

        const result: PnLData = {
          revenue: [],
          costOfServices: [],
          operatingExpenses: {},
          otherIncome: [],
          otherExpenses: [],
        };

        for (const row of rows ?? []) {
          const item: LineItem = {
            account_name: row.account_name,
            account_code: row.account_code,
            subtype: row.subtype || '',
            total: Number(row.total) || 0,
          };

          if (row.account_type === 'revenue') {
            if (
              item.subtype.toLowerCase().includes('other') ||
              item.subtype.toLowerCase().includes('interest')
            ) {
              result.otherIncome.push(item);
            } else {
              result.revenue.push(item);
            }
          } else if (row.account_type === 'expense') {
            const sub = item.subtype.toLowerCase();
            if (
              sub.includes('cost of') ||
              sub.includes('cogs') ||
              sub.includes('direct')
            ) {
              result.costOfServices.push({ ...item, total: Math.abs(item.total) });
            } else if (
              sub.includes('other') ||
              sub.includes('interest expense')
            ) {
              result.otherExpenses.push({ ...item, total: Math.abs(item.total) });
            } else {
              const group = item.subtype || 'General';
              if (!result.operatingExpenses[group]) {
                result.operatingExpenses[group] = [];
              }
              result.operatingExpenses[group].push({
                ...item,
                total: Math.abs(item.total),
              });
            }
          }
        }

        setData(result);

        // Load monthly revenue trend for sparkline
        const yearStart = startDate.slice(0, 4) + '-01-01';
        const yearEnd = startDate.slice(0, 4) + '-12-31';
        const trendRows: any[] = await api.rawQuery(
          `SELECT strftime('%Y-%m', je.date) as month, COALESCE(SUM(jel.credit - jel.debit), 0) as revenue
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.company_id = ? AND a.type = 'revenue'
             AND date(je.date) >= date(?) AND date(je.date) <= date(?)
           GROUP BY month ORDER BY month`,
          [activeCompany.id, yearStart, yearEnd]
        );
        if (!cancelled) {
          setMonthlyRevenue((trendRows ?? []).map((r: any) => ({
            month: r.month,
            revenue: Number(r.revenue) || 0,
          })));
        }
      } catch (err: any) {
        console.error('Failed to load P&L:', err);
        if (!cancelled) setError(err?.message || 'Failed to load Profit & Loss');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, activeCompany]);

  // ─── Load prior year data for YoY comparison ──────────
  useEffect(() => {
    if (!compareYoY || !activeCompany) { setPriorData(null); return; }
    const priorStart = startDate.replace(/^\d{4}/, String(parseInt(startDate.slice(0, 4), 10) - 1));
    const priorEnd = endDate.replace(/^\d{4}/, String(parseInt(endDate.slice(0, 4), 10) - 1));

    api.rawQuery(
      `SELECT a.name AS account_name, a.code AS account_code, a.type AS account_type, a.subtype AS subtype,
        COALESCE(SUM(jel.credit - jel.debit), 0) AS total
      FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE date(je.date) BETWEEN date(?) AND date(?) AND je.company_id = ? AND a.type IN ('revenue','expense')
      GROUP BY a.id, a.name, a.code, a.type, a.subtype ORDER BY a.type, a.subtype, a.code`,
      [priorStart, priorEnd, activeCompany.id]
    ).then((rows: any[]) => {
      const result: PnLData = { revenue: [], costOfServices: [], operatingExpenses: {}, otherIncome: [], otherExpenses: [] };
      for (const row of rows ?? []) {
        const item: LineItem = { account_name: row.account_name, account_code: row.account_code, subtype: row.subtype || '', total: row.total };
        const sub = (item.subtype || '').toLowerCase();
        if (row.account_type === 'revenue') {
          if (sub.includes('other')) result.otherIncome.push(item);
          else result.revenue.push(item);
        } else {
          if (sub.includes('cost of') || sub.includes('cogs')) result.costOfServices.push({ ...item, total: Math.abs(item.total) });
          else if (sub.includes('other') || sub.includes('interest expense')) result.otherExpenses.push({ ...item, total: Math.abs(item.total) });
          else {
            const group = item.subtype || 'General';
            if (!result.operatingExpenses[group]) result.operatingExpenses[group] = [];
            result.operatingExpenses[group].push({ ...item, total: Math.abs(item.total) });
          }
        }
      }
      setPriorData(result);
    }).catch(() => setPriorData(null));
  }, [compareYoY, startDate, endDate, activeCompany]);

  // ─── Computed totals ────────────────────────────────────
  const totalRevenue = useMemo(
    () => data.revenue.reduce((s, r) => s + r.total, 0),
    [data.revenue]
  );
  const totalCOS = useMemo(
    () => data.costOfServices.reduce((s, r) => s + r.total, 0),
    [data.costOfServices]
  );
  const grossProfit = totalRevenue - totalCOS;

  const totalOpex = useMemo(
    () =>
      Object.values(data.operatingExpenses)
        .flat()
        .reduce((s, r) => s + r.total, 0),
    [data.operatingExpenses]
  );
  const netOperatingIncome = grossProfit - totalOpex;

  const totalOtherIncome = useMemo(
    () => data.otherIncome.reduce((s, r) => s + r.total, 0),
    [data.otherIncome]
  );
  const totalOtherExpenses = useMemo(
    () => data.otherExpenses.reduce((s, r) => s + r.total, 0),
    [data.otherExpenses]
  );
  const netIncome = netOperatingIncome + totalOtherIncome - totalOtherExpenses;
  const totalExpenses = totalCOS + totalOpex + totalOtherExpenses;

  // ─── EBITDA calculation ────────────────────────────────
  const ebitda = useMemo(() => {
    const allExpenses = [
      ...data.costOfServices,
      ...Object.values(data.operatingExpenses).flat(),
      ...data.otherExpenses,
    ];
    let depreciation = 0;
    let amortization = 0;
    let interest = 0;
    for (const item of allExpenses) {
      const sub = item.subtype.toLowerCase();
      const name = item.account_name.toLowerCase();
      if (sub.includes('depreciation') || name.includes('depreciation')) depreciation += item.total;
      if (sub.includes('amortization') || name.includes('amortization')) amortization += item.total;
      if (sub.includes('interest') || name.includes('interest expense')) interest += item.total;
    }
    return netIncome + depreciation + amortization + interest;
  }, [data, netIncome]);

  // ─── Margin percentages ────────────────────────────────
  const grossMarginPct = totalRevenue !== 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const operatingMarginPct = totalRevenue !== 0 ? (netOperatingIncome / totalRevenue) * 100 : 0;
  const netMarginPct = totalRevenue !== 0 ? (netIncome / totalRevenue) * 100 : 0;
  const cogsPct = totalRevenue !== 0 ? (totalCOS / totalRevenue) * 100 : 0;
  const sgaPct = totalRevenue !== 0 ? (totalOpex / totalRevenue) * 100 : 0;

  // ─── Annualization factor ──────────────────────────────
  const annualizationFactor = useMemo(() => {
    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      const days = differenceInDays(end, start) + 1;
      if (days >= 365) return null; // Full year or more, no projection needed
      return 365 / days;
    } catch {
      return null;
    }
  }, [startDate, endDate]);

  const annualize = (value: number): number | null => {
    if (!showAnnualized || !annualizationFactor) return null;
    return value * annualizationFactor;
  };

  // ─── Prior year totals (for YoY) ──────────────────────
  const priorTotalRevenue = priorData?.revenue.reduce((s, r) => s + r.total, 0) ?? 0;
  const priorTotalCOS = priorData?.costOfServices.reduce((s, r) => s + r.total, 0) ?? 0;
  const priorTotalOpex = Object.values(priorData?.operatingExpenses ?? {}).flat().reduce((s, r) => s + r.total, 0);
  const priorTotalOtherIncome = priorData?.otherIncome.reduce((s, r) => s + r.total, 0) ?? 0;
  const priorTotalOtherExpenses = priorData?.otherExpenses.reduce((s, r) => s + r.total, 0) ?? 0;
  const priorGrossProfit = priorTotalRevenue - priorTotalCOS;
  const priorNetOperating = priorGrossProfit - priorTotalOpex;
  const priorNetIncome = priorNetOperating + priorTotalOtherIncome - priorTotalOtherExpenses;

  // Lookup prior amount by account code
  const priorAmountMap = useMemo(() => {
    if (!priorData) return new Map<string, number>();
    const map = new Map<string, number>();
    const addAll = (items: LineItem[]) => items.forEach(i => map.set(i.account_code, i.total));
    addAll(priorData.revenue);
    addAll(priorData.costOfServices);
    addAll(priorData.otherIncome);
    addAll(priorData.otherExpenses);
    Object.values(priorData.operatingExpenses).flat().forEach(i => map.set(i.account_code, Math.abs(i.total)));
    return map;
  }, [priorData]);

  const changeArrow = (current: number, prior: number, isExpense = false) => {
    if (!compareYoY || !priorData) return null;
    const diff = current - prior;
    if (Math.abs(diff) < 0.01) return null;
    const pct = prior !== 0 ? Math.round((diff / Math.abs(prior)) * 100) : 0;
    const isGood = isExpense ? diff < 0 : diff > 0;
    return (
      <span className={`text-[10px] font-mono ml-2 ${isGood ? 'text-accent-income variance-under' : 'text-accent-expense variance-over'}`}>
        {diff > 0 ? '+' : ''}{fmt.format(diff)} ({pct > 0 ? '+' : ''}{pct}%)
      </span>
    );
  };

  // ─── Expense pie chart data ────────────────────────────
  const expensePieData = useMemo(() => {
    const items: { name: string; value: number }[] = [];
    for (const [subtype, lineItems] of Object.entries(data.operatingExpenses)) {
      const total = lineItems.reduce((s, r) => s + r.total, 0);
      if (total > 0) items.push({ name: subtype, value: total });
    }
    if (totalCOS > 0) items.push({ name: 'Cost of Goods/Services', value: totalCOS });
    if (totalOtherExpenses > 0) items.push({ name: 'Other Expenses', value: totalOtherExpenses });
    items.sort((a, b) => b.value - a.value);
    return items.slice(0, 10);
  }, [data.operatingExpenses, totalCOS, totalOtherExpenses]);

  // ─── Revenue vs Expenses bar data ─────────────────────
  const revExpBarData = useMemo(() => [
    { name: 'Revenue', value: totalRevenue },
    { name: 'Expenses', value: totalExpenses },
    { name: 'Net Income', value: netIncome },
  ], [totalRevenue, totalExpenses, netIncome]);

  // ─── Col count for table ──────────────────────────────
  const colCount = useMemo(() => {
    let c = 2;
    if (compareYoY && priorData) c += 2;
    if (showAnnualized && annualizationFactor) c += 1;
    return c;
  }, [compareYoY, priorData, showAnnualized, annualizationFactor]);

  // ─── Build P&L report HTML for printing ────────────────
  const buildPnLHTML = useCallback(() => {
    const companyName = activeCompany?.name || 'Company';
    const dateRange = `${format(parseISO(startDate), 'MMM d, yyyy')} – ${format(parseISO(endDate), 'MMM d, yyyy')}`;

    const columns: ReportColumn[] = [
      { key: 'name', label: 'Account', align: 'left', format: 'text' },
      { key: 'amount', label: 'Amount', align: 'right', format: 'currency' },
    ];

    const rows: Record<string, any>[] = [];

    // Revenue section
    rows.push({ name: 'REVENUE', amount: '', _bold: true, _highlight: true });
    for (const r of data.revenue) {
      rows.push({ name: `    ${r.account_name}`, amount: r.total });
    }
    rows.push({ name: 'Total Revenue', amount: totalRevenue, _bold: true, _separator: true });
    rows.push({ name: '', amount: '' });

    // Cost of Services
    if (data.costOfServices.length > 0) {
      rows.push({ name: 'COST OF GOODS / SERVICES', amount: '', _bold: true, _highlight: true });
      for (const r of data.costOfServices) {
        rows.push({ name: `    ${r.account_name}`, amount: r.total });
      }
      rows.push({ name: 'Total Cost of Services', amount: totalCOS, _bold: true, _separator: true });
      rows.push({ name: '', amount: '' });
    }

    rows.push({ name: 'Gross Profit', amount: grossProfit, _bold: true, _separator: true });
    rows.push({ name: '', amount: '' });

    // Operating Expenses
    rows.push({ name: 'OPERATING EXPENSES', amount: '', _bold: true, _highlight: true });
    for (const [subtype, items] of Object.entries(data.operatingExpenses).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({ name: `  ${subtype}`, amount: '', _bold: true });
      for (const r of items) {
        rows.push({ name: `      ${r.account_name}`, amount: r.total });
      }
    }
    rows.push({ name: 'Total Operating Expenses', amount: totalOpex, _bold: true, _separator: true });
    rows.push({ name: '', amount: '' });

    rows.push({ name: 'Net Operating Income', amount: netOperatingIncome, _bold: true, _separator: true });
    rows.push({ name: '', amount: '' });

    // Other Income/Expenses
    if (data.otherIncome.length > 0 || data.otherExpenses.length > 0) {
      rows.push({ name: 'OTHER INCOME & EXPENSES', amount: '', _bold: true, _highlight: true });
      for (const r of data.otherIncome) {
        rows.push({ name: `    ${r.account_name}`, amount: r.total });
      }
      for (const r of data.otherExpenses) {
        rows.push({ name: `    ${r.account_name}`, amount: -r.total });
      }
      rows.push({ name: 'Total Other Income/Expenses', amount: totalOtherIncome - totalOtherExpenses, _bold: true, _separator: true });
      rows.push({ name: '', amount: '' });
    }

    const summary: ReportSummary[] = [
      {
        label: 'Net Income',
        value: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(netIncome),
        accent: netIncome >= 0 ? 'green' : 'red',
      },
      {
        label: 'EBITDA',
        value: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ebitda),
        accent: ebitda >= 0 ? 'green' : 'red',
      },
    ];

    return generateReportHTML('Profit & Loss Statement', companyName, dateRange, columns, rows, summary);
  }, [data, activeCompany, startDate, endDate, totalRevenue, totalCOS, grossProfit, totalOpex, netOperatingIncome, totalOtherIncome, totalOtherExpenses, netIncome, ebitda]);

  const handlePrintReport = async () => {
    const html = buildPnLHTML();
    await api.print(html);
  };

  const handleSaveReportPDF = async () => {
    const html = buildPnLHTML();
    await api.saveToPDF(html, `ProfitAndLoss-${startDate}-to-${endDate}`);
  };

  // ─── CSV Export ────────────────────────────────────────
  const handleExportCSV = () => {
    const csvRows: Record<string, any>[] = [];
    const addSection = (section: string, items: LineItem[]) => {
      csvRows.push({ section, account: '', amount: '' });
      for (const item of items) {
        csvRows.push({ section: '', account: item.account_name, amount: item.total });
      }
    };

    addSection('Revenue', data.revenue);
    csvRows.push({ section: 'Total Revenue', account: '', amount: totalRevenue });
    addSection('Cost of Goods/Services', data.costOfServices);
    csvRows.push({ section: 'Total Cost of Services', account: '', amount: totalCOS });
    csvRows.push({ section: 'Gross Profit', account: '', amount: grossProfit });
    for (const [subtype, items] of Object.entries(data.operatingExpenses).sort(([a], [b]) => a.localeCompare(b))) {
      addSection(`Operating Expenses - ${subtype}`, items);
    }
    csvRows.push({ section: 'Total Operating Expenses', account: '', amount: totalOpex });
    csvRows.push({ section: 'Net Operating Income', account: '', amount: netOperatingIncome });
    addSection('Other Income', data.otherIncome);
    addSection('Other Expenses', data.otherExpenses);
    csvRows.push({ section: 'Net Income', account: '', amount: netIncome });
    csvRows.push({ section: 'EBITDA', account: '', amount: ebitda });

    downloadCSVBlob(csvRows, `profit-and-loss-${startDate}-to-${endDate}.csv`);
  };

  // ─── Quick date presets ─────────────────────────────────
  const setPreset = (label: string) => {
    const now = new Date();
    switch (label) {
      case 'This Month':
        setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
        break;
      case 'This Year':
        setStartDate(fiscalYearStart(now, activeCompany?.fiscal_year_start || 1));
        setEndDate(fiscalYearEnd(now, activeCompany?.fiscal_year_start || 1));
        break;
    }
  };

  // ─── Custom recharts tooltip ──────────────────────────
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
      <PrintReportHeader
        title="Profit & Loss Statement"
        periodLabel="period"
        periodEnd={endDate}
        periodText={`${format(parseISO(startDate), 'MMMM d, yyyy')} – ${format(parseISO(endDate), 'MMMM d, yyyy')}`}
      />
      {error && <ErrorBanner message={error} title="Failed to load Profit & Loss" onDismiss={() => setError('')} />}
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
          {annualizationFactor && (
            <button
              className={`p-2 transition-colors ${showAnnualized ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}
              style={{ borderRadius: '6px' }}
              title="Annualized Projection"
              onClick={() => setShowAnnualized(v => !v)}
            >
              <TrendingUp size={15} />
            </button>
          )}
          <button
            className={`p-2 transition-colors ${compareYoY ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}
            style={{ borderRadius: '6px' }}
            title="Year-over-Year Comparison"
            onClick={() => setCompareYoY(v => !v)}
          >
            <GitCompare size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Export CSV"
            onClick={handleExportCSV}
          >
            <FileSpreadsheet size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print Report"
            onClick={handlePrintReport}
          >
            <Printer size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Save PDF"
            onClick={handleSaveReportPDF}
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
          {/* ─── KPI Summary Cards ─────────────────────── */}
          <div className="grid grid-cols-5 gap-3">
            <KPICard label="Total Revenue" value={totalRevenue} borderColor="border-l-accent-income" />
            <KPICard label="Gross Profit" value={grossProfit} subtitle={`${grossMarginPct.toFixed(1)}% margin`} borderColor="border-l-accent-blue" />
            <KPICard label="Operating Expenses" value={totalExpenses} borderColor="border-l-accent-expense" />
            <KPICard label="Net Income" value={netIncome} subtitle={`${netMarginPct.toFixed(1)}% margin`} borderColor="border-l-accent-income" />
            <KPICard label="EBITDA" value={ebitda} borderColor="border-l-[#8b5cf6]" />
          </div>

          {/* ─── Operating Ratios Panel ────────────────── */}
          <div className="grid grid-cols-5 gap-3">
            <RatioBox label="Gross Margin" value={`${grossMarginPct.toFixed(1)}%`} />
            <RatioBox label="Operating Margin" value={`${operatingMarginPct.toFixed(1)}%`} />
            <RatioBox label="Net Margin" value={`${netMarginPct.toFixed(1)}%`} />
            <RatioBox label="COGS % of Revenue" value={`${cogsPct.toFixed(1)}%`} />
            <RatioBox label="SGA % of Revenue" value={`${sgaPct.toFixed(1)}%`} />
          </div>

          {/* ─── Revenue Trend Sparkline ───────────────── */}
          {monthlyRevenue.length > 0 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                Monthly Revenue Trend ({startDate.slice(0, 4)})
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={monthlyRevenue}>
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
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#22c55e' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ─── P&L Table ─────────────────────────────── */}
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
                Profit & Loss Statement
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5">
                {format(parseISO(startDate), 'MMM d, yyyy')} &ndash;{' '}
                {format(parseISO(endDate), 'MMM d, yyyy')}
              </p>
            </div>

            <table className="w-full text-sm">
              {(compareYoY && priorData) || (showAnnualized && annualizationFactor) ? (
                <thead>
                  <tr className="border-b border-border-primary">
                    <th className="px-6 py-2 text-left text-xs font-bold text-text-muted uppercase tracking-wider">Account</th>
                    <th className="py-2 text-right pr-6 text-xs font-bold text-text-muted uppercase tracking-wider">Current</th>
                    {compareYoY && priorData && (
                      <>
                        <th className="py-2 text-right pr-4 text-xs font-bold text-text-muted uppercase tracking-wider">Prior Year</th>
                        <th className="py-2 text-right pr-6 text-xs font-bold text-text-muted uppercase tracking-wider">Change</th>
                      </>
                    )}
                    {showAnnualized && annualizationFactor && (
                      <th className="py-2 text-right pr-6 text-xs font-bold text-text-muted uppercase tracking-wider">Annualized</th>
                    )}
                  </tr>
                </thead>
              ) : null}
              <tbody>
                {/* Revenue */}
                <SectionHeader label="Revenue" cols={colCount} />
                {data.revenue.map((r) => (
                  <PnLLineRow
                    key={r.account_code}
                    name={r.account_name}
                    amount={r.total}
                    indent={1}
                    priorAmount={compareYoY && priorData ? (priorAmountMap.get(r.account_code) ?? 0) : undefined}
                    change={compareYoY && priorData ? changeArrow(r.total, priorAmountMap.get(r.account_code) ?? 0) : undefined}
                    annualized={annualize(r.total)}
                  />
                ))}
                <PnLSubtotalRow
                  label="Total Revenue"
                  amount={totalRevenue}
                  accent="text-accent-income"
                  topBorder
                  priorAmount={compareYoY && priorData ? priorTotalRevenue : undefined}
                  change={compareYoY && priorData ? changeArrow(totalRevenue, priorTotalRevenue) : undefined}
                  annualized={annualize(totalRevenue)}
                />

                <PnLSpacer />

                {/* Cost of Services */}
                {data.costOfServices.length > 0 && (
                  <>
                    <SectionHeader label="Cost of Goods / Services" cols={colCount} />
                    {data.costOfServices.map((r) => (
                      <PnLLineRow
                        key={r.account_code}
                        name={r.account_name}
                        amount={r.total}
                        indent={1}
                        priorAmount={compareYoY && priorData ? (priorAmountMap.get(r.account_code) ?? 0) : undefined}
                        change={compareYoY && priorData ? changeArrow(r.total, priorAmountMap.get(r.account_code) ?? 0, true) : undefined}
                        annualized={annualize(r.total)}
                      />
                    ))}
                    <PnLSubtotalRow
                      label="Total Cost of Services"
                      amount={totalCOS}
                      topBorder
                      priorAmount={compareYoY && priorData ? priorTotalCOS : undefined}
                      change={compareYoY && priorData ? changeArrow(totalCOS, priorTotalCOS, true) : undefined}
                      annualized={annualize(totalCOS)}
                    />
                    <PnLSpacer />
                  </>
                )}

                {/* Gross Profit */}
                <PnLSubtotalRow
                  label="Gross Profit"
                  amount={grossProfit}
                  accent={grossProfit >= 0 ? 'text-accent-income' : 'text-accent-expense'}
                  doubleBorder
                  priorAmount={compareYoY && priorData ? priorGrossProfit : undefined}
                  change={compareYoY && priorData ? changeArrow(grossProfit, priorGrossProfit) : undefined}
                  annualized={annualize(grossProfit)}
                />

                <PnLSpacer />

                {/* Operating Expenses */}
                <SectionHeader label="Operating Expenses" cols={colCount} />
                {Object.entries(data.operatingExpenses)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([subtype, items]) => (
                    <React.Fragment key={subtype}>
                      <tr>
                        <td
                          colSpan={colCount}
                          className="px-6 pt-2 pb-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider"
                          style={{ paddingLeft: '24px' }}
                        >
                          {subtype}
                        </td>
                      </tr>
                      {items.map((r) => (
                        <PnLLineRow
                          key={r.account_code}
                          name={r.account_name}
                          amount={r.total}
                          indent={2}
                          priorAmount={compareYoY && priorData ? (priorAmountMap.get(r.account_code) ?? 0) : undefined}
                          change={compareYoY && priorData ? changeArrow(r.total, priorAmountMap.get(r.account_code) ?? 0, true) : undefined}
                          annualized={annualize(r.total)}
                        />
                      ))}
                    </React.Fragment>
                  ))}
                <PnLSubtotalRow
                  label="Total Operating Expenses"
                  amount={totalOpex}
                  accent="text-accent-expense"
                  topBorder
                  priorAmount={compareYoY && priorData ? priorTotalOpex : undefined}
                  change={compareYoY && priorData ? changeArrow(totalOpex, priorTotalOpex, true) : undefined}
                  annualized={annualize(totalOpex)}
                />

                <PnLSpacer />

                {/* Net Operating Income */}
                <PnLSubtotalRow
                  label="Net Operating Income"
                  amount={netOperatingIncome}
                  accent={
                    netOperatingIncome >= 0
                      ? 'text-accent-income'
                      : 'text-accent-expense'
                  }
                  doubleBorder
                  priorAmount={compareYoY && priorData ? priorNetOperating : undefined}
                  change={compareYoY && priorData ? changeArrow(netOperatingIncome, priorNetOperating) : undefined}
                  annualized={annualize(netOperatingIncome)}
                />

                <PnLSpacer />

                {/* Other Income / Expenses */}
                {(data.otherIncome.length > 0 ||
                  data.otherExpenses.length > 0) && (
                  <>
                    <SectionHeader label="Other Income & Expenses" cols={colCount} />
                    {data.otherIncome.map((r) => (
                      <PnLLineRow
                        key={r.account_code}
                        name={r.account_name}
                        amount={r.total}
                        indent={1}
                        priorAmount={compareYoY && priorData ? (priorAmountMap.get(r.account_code) ?? 0) : undefined}
                        change={compareYoY && priorData ? changeArrow(r.total, priorAmountMap.get(r.account_code) ?? 0) : undefined}
                        annualized={annualize(r.total)}
                      />
                    ))}
                    {data.otherExpenses.map((r) => (
                      <PnLLineRow
                        key={r.account_code}
                        name={r.account_name}
                        amount={-r.total}
                        indent={1}
                        priorAmount={compareYoY && priorData ? -(priorAmountMap.get(r.account_code) ?? 0) : undefined}
                        change={compareYoY && priorData ? changeArrow(r.total, priorAmountMap.get(r.account_code) ?? 0, true) : undefined}
                        annualized={annualize(-r.total)}
                      />
                    ))}
                    <PnLSubtotalRow
                      label="Total Other Income/Expenses"
                      amount={totalOtherIncome - totalOtherExpenses}
                      topBorder
                      priorAmount={compareYoY && priorData ? (priorTotalOtherIncome - priorTotalOtherExpenses) : undefined}
                      change={compareYoY && priorData ? changeArrow(totalOtherIncome - totalOtherExpenses, priorTotalOtherIncome - priorTotalOtherExpenses) : undefined}
                      annualized={annualize(totalOtherIncome - totalOtherExpenses)}
                    />
                    <PnLSpacer />
                  </>
                )}

                {/* Net Income */}
                <tr className="border-t-2 border-text-primary bg-bg-tertiary/50 report-grand-total-row">
                  <td className="px-6 py-3 text-sm font-bold text-text-primary">
                    Net Income
                  </td>
                  <td
                    className={`py-3 text-right pr-6 font-mono text-sm font-bold ${
                      netIncome >= 0 ? 'text-accent-income' : 'text-accent-expense'
                    }`}
                  >
                    {fmtNeg(netIncome)}
                  </td>
                  {compareYoY && priorData && (
                    <td className="py-3 text-right pr-4 font-mono text-sm font-bold text-text-muted">
                      {fmtNeg(priorNetIncome)}
                    </td>
                  )}
                  {compareYoY && priorData && (
                    <td className="py-3 text-right pr-6 text-sm font-bold">
                      {changeArrow(netIncome, priorNetIncome)}
                    </td>
                  )}
                  {showAnnualized && annualizationFactor && (
                    <td className="py-3 text-right pr-6 font-mono text-sm font-bold text-text-muted">
                      {fmtNeg(netIncome * annualizationFactor)}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          {/* ─── Charts Section ────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            {/* Revenue vs Expenses Bar Chart */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                Revenue vs Expenses
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revExpBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
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
                  <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]}>
                    {revExpBarData.map((_entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === 0 ? '#22c55e' : index === 1 ? '#ef4444' : '#3b82f6'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Expense Breakdown Pie Chart */}
            {expensePieData.length > 0 && (
              <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                  Expense Breakdown (Top 10)
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={expensePieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {expensePieData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any) => fmt.format(Number(value) || 0)}
                      contentStyle={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border-primary)',
                        borderRadius: '6px',
                        fontSize: '11px',
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      formatter={(value: string) => (
                        <span className="text-[10px] text-text-secondary">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
      <PrintReportFooter />
    </div>
  );
};

export default ProfitAndLoss;
