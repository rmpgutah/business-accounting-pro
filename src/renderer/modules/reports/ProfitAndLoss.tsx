import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Printer, Download, GitCompare } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfYear, parseISO } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { generateReportHTML } from '../../lib/print-templates';
import type { ReportColumn, ReportSummary } from '../../lib/print-templates';
import ErrorBanner from '../../components/ErrorBanner';

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

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Render helpers ─────────────────────────────────────
const SectionHeader: React.FC<{ label: string; cols?: number }> = ({ label, cols = 2 }) => (
  <tr className="bg-bg-tertiary/30">
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
}> = ({ name, amount, indent = 0, bold = false, accent, priorAmount, change }) => (
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
    {priorAmount !== undefined && priorAmount !== null && (
      <td className="py-1.5 text-right pr-4 font-mono text-xs text-text-muted">
        {fmt.format(priorAmount)}
      </td>
    )}
    {change !== undefined && (
      <td className="py-1.5 text-right pr-6 text-xs">
        {change}
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
}> = ({ label, amount, accent, topBorder, doubleBorder, priorAmount, change }) => (
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
    {priorAmount !== undefined && priorAmount !== null && (
      <td className="py-2 text-right pr-4 font-mono text-xs font-bold text-text-muted">
        {fmt.format(priorAmount)}
      </td>
    )}
    {change !== undefined && (
      <td className="py-2 text-right pr-6 text-xs font-bold">
        {change}
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
  const [startDate, setStartDate] = useState(() =>
    format(startOfYear(new Date()), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(() =>
    format(endOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compareYoY, setCompareYoY] = useState(false);
  const [priorData, setPriorData] = useState<PnLData | null>(null);
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
              // Convention: GL stores expenses as net credit-debit (negative).
              // Display all expense categories as positive magnitudes so totals
              // and per-line values use the same sign — abs at insertion, then
              // sum directly with no further sign massaging.
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
    // costOfServices items are already stored positive (abs'd on insertion);
    // sum directly so per-line + total share one sign convention.
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
      <span className={`text-[10px] font-mono ml-2 ${isGood ? 'text-accent-income' : 'text-accent-expense'}`}>
        {diff > 0 ? '+' : ''}{fmt.format(diff)} ({pct > 0 ? '+' : ''}{pct}%)
      </span>
    );
  };

  // ─── Build P&L report HTML for printing ────────────────
  const buildPnLHTML = useCallback(() => {
    const companyName = activeCompany?.name || 'Company';
    const dateRange = `${format(parseISO(startDate), 'MMM d, yyyy')} \u2013 ${format(parseISO(endDate), 'MMM d, yyyy')}`;

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
        // r.total is already positive (abs'd at insertion).
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
    ];

    return generateReportHTML('Profit & Loss Statement', companyName, dateRange, columns, rows, summary);
  }, [data, activeCompany, startDate, endDate, totalRevenue, totalCOS, grossProfit, totalOpex, netOperatingIncome, totalOtherIncome, totalOtherExpenses, netIncome]);

  const handlePrintReport = async () => {
    const html = buildPnLHTML();
    await api.print(html);
  };

  const handleSaveReportPDF = async () => {
    const html = buildPnLHTML();
    await api.saveToPDF(html, `ProfitAndLoss-${startDate}-to-${endDate}`);
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
        setStartDate(format(startOfYear(now), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
        break;
    }
  };

  return (
    <div className="space-y-4">
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
            {compareYoY && priorData && (
              <thead>
                <tr className="border-b border-border-primary">
                  <th className="px-6 py-2 text-left text-xs font-bold text-text-muted uppercase tracking-wider">Account</th>
                  <th className="py-2 text-right pr-6 text-xs font-bold text-text-muted uppercase tracking-wider">Current</th>
                  <th className="py-2 text-right pr-4 text-xs font-bold text-text-muted uppercase tracking-wider">Prior Year</th>
                  <th className="py-2 text-right pr-6 text-xs font-bold text-text-muted uppercase tracking-wider">Change</th>
                </tr>
              </thead>
            )}
            <tbody>
              {/* Revenue */}
              <SectionHeader label="Revenue" cols={compareYoY && priorData ? 4 : 2} />
              {data.revenue.map((r) => (
                <PnLLineRow
                  key={r.account_code}
                  name={r.account_name}
                  amount={r.total}
                  indent={1}
                  priorAmount={compareYoY && priorData ? (priorAmountMap.get(r.account_code) ?? 0) : undefined}
                  change={compareYoY && priorData ? changeArrow(r.total, priorAmountMap.get(r.account_code) ?? 0) : undefined}
                />
              ))}
              <PnLSubtotalRow
                label="Total Revenue"
                amount={totalRevenue}
                accent="text-accent-income"
                topBorder
                priorAmount={compareYoY && priorData ? priorTotalRevenue : undefined}
                change={compareYoY && priorData ? changeArrow(totalRevenue, priorTotalRevenue) : undefined}
              />

              <PnLSpacer />

              {/* Cost of Services */}
              {data.costOfServices.length > 0 && (
                <>
                  <SectionHeader label="Cost of Goods / Services" />
                  {data.costOfServices.map((r) => (
                    <PnLLineRow
                      key={r.account_code}
                      name={r.account_name}
                      amount={r.total}
                      indent={1}
                    />
                  ))}
                  <PnLSubtotalRow
                    label="Total Cost of Services"
                    amount={totalCOS}
                    topBorder
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
              />

              <PnLSpacer />

              {/* Operating Expenses */}
              <SectionHeader label="Operating Expenses" />
              {Object.entries(data.operatingExpenses)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([subtype, items]) => (
                  <React.Fragment key={subtype}>
                    <tr>
                      <td
                        colSpan={2}
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
                      />
                    ))}
                  </React.Fragment>
                ))}
              <PnLSubtotalRow
                label="Total Operating Expenses"
                amount={totalOpex}
                accent="text-accent-expense"
                topBorder
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
              />

              <PnLSpacer />

              {/* Other Income / Expenses */}
              {(data.otherIncome.length > 0 ||
                data.otherExpenses.length > 0) && (
                <>
                  <SectionHeader label="Other Income & Expenses" />
                  {data.otherIncome.map((r) => (
                    <PnLLineRow
                      key={r.account_code}
                      name={r.account_name}
                      amount={r.total}
                      indent={1}
                    />
                  ))}
                  {data.otherExpenses.map((r) => (
                    <PnLLineRow
                      key={r.account_code}
                      name={r.account_name}
                      amount={-r.total}
                      indent={1}
                    />
                  ))}
                  <PnLSubtotalRow
                    label="Total Other Income/Expenses"
                    amount={totalOtherIncome - totalOtherExpenses}
                    topBorder
                  />
                  <PnLSpacer />
                </>
              )}

              {/* Net Income */}
              <tr className="border-t-2 border-text-primary bg-bg-tertiary/50">
                <td className="px-6 py-3 text-sm font-bold text-text-primary">
                  Net Income
                </td>
                <td
                  className={`py-3 text-right pr-6 font-mono text-sm font-bold ${
                    netIncome >= 0 ? 'text-accent-income' : 'text-accent-expense'
                  }`}
                >
                  {fmt.format(netIncome)}
                </td>
                {compareYoY && priorData && (
                  <td className="py-3 text-right pr-4 font-mono text-sm font-bold text-text-muted">
                    {fmt.format(priorNetIncome)}
                  </td>
                )}
                {compareYoY && priorData && (
                  <td className="py-3 text-right pr-6 text-sm font-bold">
                    {changeArrow(netIncome, priorNetIncome)}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ProfitAndLoss;
