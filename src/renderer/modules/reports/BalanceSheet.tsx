import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Printer, Download, AlertTriangle, GitCompare, ChevronRight, ChevronDown } from 'lucide-react';
import { format, endOfMonth, parseISO } from 'date-fns';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';
import { downloadCSVBlob } from '../../lib/csv-export';

// ─── Types ──────────────────────────────────────────────
interface AccountLine {
  account_name: string;
  account_code: string;
  account_id?: number;
  subtype: string;
  balance: number;
}

interface BSData {
  currentAssets: AccountLine[];
  fixedAssets: AccountLine[];
  otherAssets: AccountLine[];
  currentLiabilities: AccountLine[];
  longTermLiabilities: AccountLine[];
  equity: AccountLine[];
}

interface JournalDetail {
  date: string;
  entry_number: string;
  description: string;
  debit: number;
  credit: number;
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
  value: number | string;
  subtitle?: string;
  borderColor: string;
  isRatio?: boolean;
}> = ({ label, value, subtitle, borderColor, isRatio }) => (
  <div
    className={`block-card p-3 border-l-4 ${borderColor}`}
    style={{ borderRadius: '6px' }}
  >
    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
      {label}
    </div>
    <div className={`text-base font-bold font-mono mt-1 text-text-primary`}>
      {isRatio ? value : fmtNeg(value as number)}
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

const SubSectionHeader: React.FC<{ label: string; cols?: number }> = ({ label, cols = 2 }) => (
  <tr>
    <td
      colSpan={cols}
      className="px-6 pt-2 pb-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider"
      style={{ paddingLeft: '24px' }}
    >
      {label}
    </td>
  </tr>
);

const SubtotalRow: React.FC<{
  label: string;
  amount: number;
  accent?: string;
  topBorder?: boolean;
  doubleBorder?: boolean;
  priorAmount?: number | null;
  change?: React.ReactNode;
}> = ({ label, amount, accent, topBorder, doubleBorder, priorAmount, change }) => (
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
  </tr>
);

const Spacer: React.FC = () => (
  <tr>
    <td colSpan={2} className="py-1" />
  </tr>
);

// ─── Expandable Line Row ────────────────────────────────
const ExpandableLineRow: React.FC<{
  account: AccountLine;
  indent?: number;
  asOfDate: string;
  priorAmount?: number | null;
  change?: React.ReactNode;
}> = ({ account, indent = 0, asOfDate, priorAmount, change }) => {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<JournalDetail[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const toggleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!account.account_id) { setExpanded(true); return; }
    setLoadingDetails(true);
    try {
      const rows: any[] = await api.rawQuery(
        `SELECT je.date, je.entry_number, je.description, jel.debit, jel.credit
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = ? AND je.is_posted = 1 AND je.date <= ?
         ORDER BY je.date DESC LIMIT 20`,
        [account.account_id, asOfDate]
      );
      setDetails((rows ?? []).map((r: any) => ({
        date: r.date,
        entry_number: r.entry_number || '',
        description: r.description || '',
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
      })));
    } catch {
      setDetails([]);
    } finally {
      setLoadingDetails(false);
      setExpanded(true);
    }
  };

  return (
    <>
      <tr
        className="border-b border-border-primary/30 hover:bg-bg-hover/30 transition-colors cursor-pointer"
        onClick={toggleExpand}
      >
        <td
          className="py-1.5 text-xs text-text-secondary flex items-center gap-1"
          style={{ paddingLeft: `${24 + indent * 20}px` }}
        >
          {account.account_id ? (
            expanded ? <ChevronDown size={12} className="text-text-muted shrink-0" /> : <ChevronRight size={12} className="text-text-muted shrink-0" />
          ) : <span className="w-3" />}
          {account.account_name}
        </td>
        <td className="py-1.5 text-right pr-6 font-mono text-xs text-text-primary">
          {fmtNeg(account.balance)}
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
      </tr>
      {expanded && account.account_id && (
        <tr>
          <td colSpan={priorAmount !== undefined ? 4 : 2} className="px-0 py-0">
            <div className="bg-bg-tertiary/20 border-t border-b border-border-primary/20 mx-6 mb-1">
              {loadingDetails ? (
                <div className="px-4 py-2 text-[10px] text-text-muted font-mono">Loading entries...</div>
              ) : details.length === 0 ? (
                <div className="px-4 py-2 text-[10px] text-text-muted font-mono">No journal entries found</div>
              ) : (
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-text-muted">
                      <th className="px-3 py-1 text-left font-semibold uppercase tracking-wider">Date</th>
                      <th className="px-3 py-1 text-left font-semibold uppercase tracking-wider">Entry #</th>
                      <th className="px-3 py-1 text-left font-semibold uppercase tracking-wider">Description</th>
                      <th className="px-3 py-1 text-right font-semibold uppercase tracking-wider">Debit</th>
                      <th className="px-3 py-1 text-right font-semibold uppercase tracking-wider">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((d, i) => (
                      <tr key={i} className="border-t border-border-primary/10">
                        <td className="px-3 py-1 text-text-secondary font-mono">{d.date}</td>
                        <td className="px-3 py-1 text-text-secondary font-mono">{d.entry_number}</td>
                        <td className="px-3 py-1 text-text-secondary">{d.description}</td>
                        <td className="px-3 py-1 text-right text-text-secondary font-mono">{d.debit > 0 ? fmt.format(d.debit) : ''}</td>
                        <td className="px-3 py-1 text-right text-text-secondary font-mono">{d.credit > 0 ? fmt.format(d.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

// ─── Component ──────────────────────────────────────────
const BalanceSheet: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [asOfDate, setAsOfDate] = useState(() =>
    format(endOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compareYoY, setCompareYoY] = useState(false);
  const [priorData, setPriorData] = useState<BSData | null>(null);
  const [retainedEarnings, setRetainedEarnings] = useState(0);
  const [priorRetainedEarnings, setPriorRetainedEarnings] = useState(0);
  const [showREBreakdown, setShowREBreakdown] = useState(false);
  const [reBreakdown, setReBreakdown] = useState<{ beginningRE: number; periodNetIncome: number; dividends: number }>({
    beginningRE: 0, periodNetIncome: 0, dividends: 0,
  });
  const [data, setData] = useState<BSData>({
    currentAssets: [],
    fixedAssets: [],
    otherAssets: [],
    currentLiabilities: [],
    longTermLiabilities: [],
    equity: [],
  });

  // ─── Load helper ──────────────────────────────────────
  const loadBSData = useCallback(async (date: string, companyId: string): Promise<{ bsData: BSData; retEarnings: number }> => {
    const rows: any[] = await api.rawQuery(
      `SELECT
         a.id AS account_id,
         a.name AS account_name,
         a.code AS account_code,
         a.type AS account_type,
         a.subtype AS subtype,
         COALESCE(SUM(jel.debit - jel.credit), 0) AS balance
       FROM accounts a
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
         AND je.date <= ?
         AND je.company_id = ?
       WHERE a.company_id = ?
         AND a.type IN ('asset', 'liability', 'equity')
         AND a.is_active = 1
       GROUP BY a.id, a.name, a.code, a.type, a.subtype
       HAVING balance != 0
       ORDER BY a.type, a.subtype, a.code`,
      [date, companyId, companyId]
    );

    const result: BSData = {
      currentAssets: [],
      fixedAssets: [],
      otherAssets: [],
      currentLiabilities: [],
      longTermLiabilities: [],
      equity: [],
    };

    const reRows: any[] = await api.rawQuery(
      `SELECT
         COALESCE(SUM(jel.credit - jel.debit), 0) AS retained_earnings
       FROM journal_entry_lines jel
       JOIN accounts a ON a.id = jel.account_id
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE je.date <= ?
         AND je.company_id = ?
         AND a.type IN ('revenue', 'expense')`,
      [date, companyId]
    );

    const retEarnings = Number(reRows?.[0]?.retained_earnings) || 0;

    for (const row of rows ?? []) {
      const item: AccountLine = {
        account_name: row.account_name,
        account_code: row.account_code,
        account_id: row.account_id,
        subtype: row.subtype || '',
        balance: Number(row.balance) || 0,
      };

      const sub = item.subtype.toLowerCase();

      if (row.account_type === 'asset') {
        if (
          sub.includes('fixed') ||
          sub.includes('property') ||
          sub.includes('equipment') ||
          sub.includes('depreciation')
        ) {
          result.fixedAssets.push(item);
        } else if (
          sub.includes('other') ||
          sub.includes('intangible') ||
          sub.includes('long-term investment')
        ) {
          result.otherAssets.push(item);
        } else {
          result.currentAssets.push(item);
        }
      } else if (row.account_type === 'liability') {
        item.balance = Math.abs(item.balance);
        if (
          sub.includes('long-term') ||
          sub.includes('mortgage') ||
          sub.includes('bond')
        ) {
          result.longTermLiabilities.push(item);
        } else {
          result.currentLiabilities.push(item);
        }
      } else if (row.account_type === 'equity') {
        item.balance = Math.abs(item.balance);
        result.equity.push(item);
      }
    }

    // Add retained earnings to equity section
    if (retEarnings !== 0) {
      result.equity.push({
        account_name: 'Retained Earnings',
        account_code: '',
        subtype: 'retained',
        balance: retEarnings,
      });
    }

    return { bsData: result, retEarnings };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');

      try {
        const { bsData, retEarnings } = await loadBSData(asOfDate, activeCompany.id);
        if (cancelled) return;
        setData(bsData);
        setRetainedEarnings(retEarnings);

        // Load retained earnings breakdown
        const yearStart = asOfDate.slice(0, 4) + '-01-01';
        const beginRERows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(jel.credit - jel.debit), 0) AS re
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.date < ? AND je.company_id = ? AND a.type IN ('revenue', 'expense')`,
          [yearStart, activeCompany.id]
        );
        const beginningRE = Number(beginRERows?.[0]?.re) || 0;

        const dividendRows: any[] = await api.rawQuery(
          `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS total
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.date >= ? AND je.date <= ? AND je.company_id = ?
             AND a.type = 'equity' AND (a.subtype LIKE '%dividend%' OR a.subtype LIKE '%draw%')`,
          [yearStart, asOfDate, activeCompany.id]
        );
        const dividends = Number(dividendRows?.[0]?.total) || 0;

        if (!cancelled) {
          setReBreakdown({
            beginningRE,
            periodNetIncome: retEarnings - beginningRE + dividends,
            dividends,
          });
        }
      } catch (err: any) {
        console.error('Failed to load Balance Sheet:', err);
        if (!cancelled) setError(err?.message || 'Failed to load Balance Sheet');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [asOfDate, activeCompany, loadBSData]);

  // ─── Load prior year data for YoY comparison ──────────
  useEffect(() => {
    if (!compareYoY || !activeCompany) { setPriorData(null); return; }
    const priorDate = asOfDate.replace(/^\d{4}/, String(parseInt(asOfDate.slice(0, 4), 10) - 1));

    loadBSData(priorDate, activeCompany.id).then(({ bsData, retEarnings }) => {
      setPriorData(bsData);
      setPriorRetainedEarnings(retEarnings);
    }).catch(() => {
      setPriorData(null);
      setPriorRetainedEarnings(0);
    });
  }, [compareYoY, asOfDate, activeCompany, loadBSData]);

  // ─── Computed totals ────────────────────────────────────
  const totalCurrentAssets = useMemo(
    () => data.currentAssets.reduce((s, a) => s + a.balance, 0),
    [data.currentAssets]
  );
  const totalFixedAssets = useMemo(
    () => data.fixedAssets.reduce((s, a) => s + a.balance, 0),
    [data.fixedAssets]
  );
  const totalOtherAssets = useMemo(
    () => data.otherAssets.reduce((s, a) => s + a.balance, 0),
    [data.otherAssets]
  );
  const totalAssets = totalCurrentAssets + totalFixedAssets + totalOtherAssets;

  const totalCurrentLiabilities = useMemo(
    () => data.currentLiabilities.reduce((s, a) => s + a.balance, 0),
    [data.currentLiabilities]
  );
  const totalLongTermLiabilities = useMemo(
    () => data.longTermLiabilities.reduce((s, a) => s + a.balance, 0),
    [data.longTermLiabilities]
  );
  const totalLiabilities = totalCurrentLiabilities + totalLongTermLiabilities;

  const totalEquity = useMemo(
    () => data.equity.reduce((s, a) => s + a.balance, 0),
    [data.equity]
  );
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  const isBalanced =
    Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

  // ─── Prior year totals ─────────────────────────────────
  const priorTotalCurrentAssets = priorData?.currentAssets.reduce((s, a) => s + a.balance, 0) ?? 0;
  const priorTotalFixedAssets = priorData?.fixedAssets.reduce((s, a) => s + a.balance, 0) ?? 0;
  const priorTotalOtherAssets = priorData?.otherAssets.reduce((s, a) => s + a.balance, 0) ?? 0;
  const priorTotalAssets = priorTotalCurrentAssets + priorTotalFixedAssets + priorTotalOtherAssets;
  const priorTotalCurrentLiabilities = priorData?.currentLiabilities.reduce((s, a) => s + a.balance, 0) ?? 0;
  const priorTotalLongTermLiabilities = priorData?.longTermLiabilities.reduce((s, a) => s + a.balance, 0) ?? 0;
  const priorTotalLiabilities = priorTotalCurrentLiabilities + priorTotalLongTermLiabilities;
  const priorTotalEquity = priorData?.equity.reduce((s, a) => s + a.balance, 0) ?? 0;
  const priorTotalLiabAndEquity = priorTotalLiabilities + priorTotalEquity;

  const priorAmountMap = useMemo(() => {
    if (!priorData) return new Map<string, number>();
    const map = new Map<string, number>();
    const addAll = (items: AccountLine[]) => items.forEach(i => map.set(i.account_code, i.balance));
    addAll(priorData.currentAssets);
    addAll(priorData.fixedAssets);
    addAll(priorData.otherAssets);
    addAll(priorData.currentLiabilities);
    addAll(priorData.longTermLiabilities);
    addAll(priorData.equity);
    return map;
  }, [priorData]);

  const changeArrow = (current: number, prior: number) => {
    if (!compareYoY || !priorData) return undefined;
    const diff = current - prior;
    if (Math.abs(diff) < 0.01) return null;
    const pct = prior !== 0 ? Math.round((diff / Math.abs(prior)) * 100) : 0;
    return (
      <span className={`text-[10px] font-mono ${diff > 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
        {diff > 0 ? '+' : ''}{fmt.format(diff)} ({pct > 0 ? '+' : ''}{pct}%)
      </span>
    );
  };

  // ─── Liquidity ratios ─────────────────────────────────
  const currentRatio = totalCurrentLiabilities > 0 ? totalCurrentAssets / totalCurrentLiabilities : 0;
  const inventory = useMemo(() => {
    return data.currentAssets
      .filter(a => a.subtype.toLowerCase().includes('inventory'))
      .reduce((s, a) => s + a.balance, 0);
  }, [data.currentAssets]);
  const quickRatio = totalCurrentLiabilities > 0 ? (totalCurrentAssets - inventory) / totalCurrentLiabilities : 0;
  const workingCapital = totalCurrentAssets - totalCurrentLiabilities;
  const debtToEquity = totalEquity > 0 ? totalLiabilities / totalEquity : 0;
  const equityRatio = totalAssets > 0 ? (totalEquity / totalAssets) * 100 : 0;

  // ─── Pie chart data ───────────────────────────────────
  const assetPieData = useMemo(() => {
    const items: { name: string; value: number }[] = [];
    if (totalCurrentAssets > 0) items.push({ name: 'Current Assets', value: totalCurrentAssets });
    if (totalFixedAssets > 0) items.push({ name: 'Fixed Assets', value: Math.abs(totalFixedAssets) });
    if (totalOtherAssets > 0) items.push({ name: 'Other Assets', value: totalOtherAssets });
    return items;
  }, [totalCurrentAssets, totalFixedAssets, totalOtherAssets]);

  const liabilityPieData = useMemo(() => {
    const items: { name: string; value: number }[] = [];
    if (totalCurrentLiabilities > 0) items.push({ name: 'Current Liabilities', value: totalCurrentLiabilities });
    if (totalLongTermLiabilities > 0) items.push({ name: 'Long-Term Liabilities', value: totalLongTermLiabilities });
    return items;
  }, [totalCurrentLiabilities, totalLongTermLiabilities]);

  // ─── Col count ─────────────────────────────────────────
  const colCount = compareYoY && priorData ? 4 : 2;

  // ─── CSV Export ────────────────────────────────────────
  const handleExportCSV = () => {
    const rows: Array<Record<string, any>> = [];
    const section = (name: string, items: AccountLine[]) => {
      rows.push({ section: name, account: '', balance: '' });
      for (const a of items) rows.push({ section: '', account: a.account_name, balance: a.balance });
    };
    section('Current Assets', data.currentAssets);
    rows.push({ section: 'Total Current Assets', account: '', balance: totalCurrentAssets });
    section('Fixed Assets', data.fixedAssets);
    rows.push({ section: 'Total Fixed Assets', account: '', balance: totalFixedAssets });
    if (data.otherAssets.length > 0) {
      section('Other Assets', data.otherAssets);
      rows.push({ section: 'Total Other Assets', account: '', balance: totalOtherAssets });
    }
    rows.push({ section: 'Total Assets', account: '', balance: totalAssets });
    section('Current Liabilities', data.currentLiabilities);
    rows.push({ section: 'Total Current Liabilities', account: '', balance: totalCurrentLiabilities });
    section('Long-Term Liabilities', data.longTermLiabilities);
    rows.push({ section: 'Total Long-Term Liabilities', account: '', balance: totalLongTermLiabilities });
    rows.push({ section: 'Total Liabilities', account: '', balance: totalLiabilities });
    section('Equity', data.equity);
    rows.push({ section: 'Total Equity', account: '', balance: totalEquity });
    rows.push({ section: 'Total Liabilities & Equity', account: '', balance: totalLiabilitiesAndEquity });
    downloadCSVBlob(rows, `balance-sheet-${asOfDate}.csv`);
  };

  return (
    <div className="space-y-4">
      <PrintReportHeader title="Balance Sheet" periodEnd={asOfDate} />
      {error && <ErrorBanner message={error} title="Failed to load Balance Sheet" onDismiss={() => setError('')} />}
      {/* Controls */}
      <div
        className="block-card p-4 flex items-center justify-between"
        style={{ borderRadius: '6px' }}
      >
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            As of
          </label>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
          <button
            onClick={() =>
              setAsOfDate(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
            }
            className="px-2 py-1 text-[10px] font-semibold bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          {!isBalanced && !loading && (
            <div className="flex items-center gap-1.5 text-accent-warning text-xs font-semibold mr-2">
              <AlertTriangle size={14} />
              <span>Out of Balance</span>
            </div>
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
            <KPICard label="Total Assets" value={totalAssets} borderColor="border-l-accent-blue" />
            <KPICard label="Total Liabilities" value={totalLiabilities} borderColor="border-l-accent-expense" />
            <KPICard label="Total Equity" value={totalEquity} borderColor="border-l-accent-income" />
            <KPICard label="Debt-to-Equity" value={debtToEquity.toFixed(2) + 'x'} borderColor="border-l-[#f59e0b]" isRatio />
            <KPICard label="Current Ratio" value={currentRatio.toFixed(2) + 'x'} borderColor="border-l-[#8b5cf6]" isRatio />
            <KPICard label="Working Capital" value={workingCapital} borderColor="border-l-[#06b6d4]" />
          </div>

          {/* ─── Liquidity Ratios Panel ──────────────── */}
          <div className="grid grid-cols-5 gap-3">
            <RatioBox label="Current Ratio" value={`${currentRatio.toFixed(2)}x`} />
            <RatioBox label="Quick Ratio" value={`${quickRatio.toFixed(2)}x`} />
            <RatioBox label="Working Capital" value={fmt.format(workingCapital)} />
            <RatioBox label="Debt-to-Equity" value={`${debtToEquity.toFixed(2)}x`} />
            <RatioBox label="Equity Ratio" value={`${equityRatio.toFixed(1)}%`} />
          </div>

          {/* ─── Composition Charts ──────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            {assetPieData.length > 0 && (
              <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                  Asset Composition
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={assetPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={70}
                      paddingAngle={2}
                    >
                      {assetPieData.map((_entry, index) => (
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

            {liabilityPieData.length > 0 && (
              <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                  Liability Composition
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={liabilityPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={70}
                      paddingAngle={2}
                    >
                      {liabilityPieData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={[CHART_COLORS[3], CHART_COLORS[4]][index % 2]} />
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

          {/* ─── Balance Sheet Table ──────────────────── */}
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
                Balance Sheet
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5">
                As of {format(parseISO(asOfDate), 'MMMM d, yyyy')}
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
                {/* ASSETS */}
                <SectionHeader label="Assets" cols={colCount} />

                {data.currentAssets.length > 0 && (
                  <>
                    <SubSectionHeader label="Current Assets" cols={colCount} />
                    {data.currentAssets.map((a) => (
                      <ExpandableLineRow
                        key={a.account_code || a.account_name}
                        account={a}
                        indent={2}
                        asOfDate={asOfDate}
                        priorAmount={compareYoY && priorData ? (priorAmountMap.get(a.account_code) ?? 0) : undefined}
                        change={compareYoY && priorData ? changeArrow(a.balance, priorAmountMap.get(a.account_code) ?? 0) : undefined}
                      />
                    ))}
                    <SubtotalRow
                      label="Total Current Assets"
                      amount={totalCurrentAssets}
                      topBorder
                      priorAmount={compareYoY && priorData ? priorTotalCurrentAssets : undefined}
                      change={compareYoY && priorData ? changeArrow(totalCurrentAssets, priorTotalCurrentAssets) : undefined}
                    />
                  </>
                )}

                {data.fixedAssets.length > 0 && (
                  <>
                    <SubSectionHeader label="Fixed Assets" cols={colCount} />
                    {data.fixedAssets.map((a) => (
                      <ExpandableLineRow
                        key={a.account_code || a.account_name}
                        account={a}
                        indent={2}
                        asOfDate={asOfDate}
                        priorAmount={compareYoY && priorData ? (priorAmountMap.get(a.account_code) ?? 0) : undefined}
                        change={compareYoY && priorData ? changeArrow(a.balance, priorAmountMap.get(a.account_code) ?? 0) : undefined}
                      />
                    ))}
                    <SubtotalRow
                      label="Total Fixed Assets"
                      amount={totalFixedAssets}
                      topBorder
                      priorAmount={compareYoY && priorData ? priorTotalFixedAssets : undefined}
                      change={compareYoY && priorData ? changeArrow(totalFixedAssets, priorTotalFixedAssets) : undefined}
                    />
                  </>
                )}

                {data.otherAssets.length > 0 && (
                  <>
                    <SubSectionHeader label="Other Assets" cols={colCount} />
                    {data.otherAssets.map((a) => (
                      <ExpandableLineRow
                        key={a.account_code || a.account_name}
                        account={a}
                        indent={2}
                        asOfDate={asOfDate}
                        priorAmount={compareYoY && priorData ? (priorAmountMap.get(a.account_code) ?? 0) : undefined}
                        change={compareYoY && priorData ? changeArrow(a.balance, priorAmountMap.get(a.account_code) ?? 0) : undefined}
                      />
                    ))}
                    <SubtotalRow
                      label="Total Other Assets"
                      amount={totalOtherAssets}
                      topBorder
                      priorAmount={compareYoY && priorData ? priorTotalOtherAssets : undefined}
                      change={compareYoY && priorData ? changeArrow(totalOtherAssets, priorTotalOtherAssets) : undefined}
                    />
                  </>
                )}

                <SubtotalRow
                  label="TOTAL ASSETS"
                  amount={totalAssets}
                  accent="text-accent-blue"
                  doubleBorder
                  priorAmount={compareYoY && priorData ? priorTotalAssets : undefined}
                  change={compareYoY && priorData ? changeArrow(totalAssets, priorTotalAssets) : undefined}
                />

                <Spacer />

                {/* LIABILITIES */}
                <SectionHeader label="Liabilities" cols={colCount} />

                {data.currentLiabilities.length > 0 && (
                  <>
                    <SubSectionHeader label="Current Liabilities" cols={colCount} />
                    {data.currentLiabilities.map((a) => (
                      <ExpandableLineRow
                        key={a.account_code || a.account_name}
                        account={a}
                        indent={2}
                        asOfDate={asOfDate}
                        priorAmount={compareYoY && priorData ? (priorAmountMap.get(a.account_code) ?? 0) : undefined}
                        change={compareYoY && priorData ? changeArrow(a.balance, priorAmountMap.get(a.account_code) ?? 0) : undefined}
                      />
                    ))}
                    <SubtotalRow
                      label="Total Current Liabilities"
                      amount={totalCurrentLiabilities}
                      topBorder
                      priorAmount={compareYoY && priorData ? priorTotalCurrentLiabilities : undefined}
                      change={compareYoY && priorData ? changeArrow(totalCurrentLiabilities, priorTotalCurrentLiabilities) : undefined}
                    />
                  </>
                )}

                {data.longTermLiabilities.length > 0 && (
                  <>
                    <SubSectionHeader label="Long-Term Liabilities" cols={colCount} />
                    {data.longTermLiabilities.map((a) => (
                      <ExpandableLineRow
                        key={a.account_code || a.account_name}
                        account={a}
                        indent={2}
                        asOfDate={asOfDate}
                        priorAmount={compareYoY && priorData ? (priorAmountMap.get(a.account_code) ?? 0) : undefined}
                        change={compareYoY && priorData ? changeArrow(a.balance, priorAmountMap.get(a.account_code) ?? 0) : undefined}
                      />
                    ))}
                    <SubtotalRow
                      label="Total Long-Term Liabilities"
                      amount={totalLongTermLiabilities}
                      topBorder
                      priorAmount={compareYoY && priorData ? priorTotalLongTermLiabilities : undefined}
                      change={compareYoY && priorData ? changeArrow(totalLongTermLiabilities, priorTotalLongTermLiabilities) : undefined}
                    />
                  </>
                )}

                <SubtotalRow
                  label="Total Liabilities"
                  amount={totalLiabilities}
                  accent="text-accent-expense"
                  doubleBorder
                  priorAmount={compareYoY && priorData ? priorTotalLiabilities : undefined}
                  change={compareYoY && priorData ? changeArrow(totalLiabilities, priorTotalLiabilities) : undefined}
                />

                <Spacer />

                {/* EQUITY */}
                <SectionHeader label="Equity" cols={colCount} />
                {data.equity.map((a) => (
                  <ExpandableLineRow
                    key={a.account_code || a.account_name}
                    account={a}
                    indent={1}
                    asOfDate={asOfDate}
                    priorAmount={compareYoY && priorData ? (priorAmountMap.get(a.account_code) ?? 0) : undefined}
                    change={compareYoY && priorData ? changeArrow(a.balance, priorAmountMap.get(a.account_code) ?? 0) : undefined}
                  />
                ))}
                <SubtotalRow
                  label="Total Equity"
                  amount={totalEquity}
                  topBorder
                  priorAmount={compareYoY && priorData ? priorTotalEquity : undefined}
                  change={compareYoY && priorData ? changeArrow(totalEquity, priorTotalEquity) : undefined}
                />

                <Spacer />

                {/* TOTAL LIABILITIES + EQUITY */}
                <tr className="border-t-2 border-text-primary bg-bg-tertiary/50 report-grand-total-row">
                  <td className="px-6 py-3 text-sm font-bold text-text-primary">
                    TOTAL LIABILITIES & EQUITY
                  </td>
                  <td className="py-3 text-right pr-6 font-mono text-sm font-bold text-accent-blue">
                    {fmtNeg(totalLiabilitiesAndEquity)}
                  </td>
                  {compareYoY && priorData && (
                    <td className="py-3 text-right pr-4 font-mono text-sm font-bold text-text-muted">
                      {fmtNeg(priorTotalLiabAndEquity)}
                    </td>
                  )}
                  {compareYoY && priorData && (
                    <td className="py-3 text-right pr-6 text-sm font-bold">
                      {changeArrow(totalLiabilitiesAndEquity, priorTotalLiabAndEquity)}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>

            {/* Balance check */}
            <div
              className={`px-6 py-2 text-xs font-mono text-center border-t border-border-primary ${
                isBalanced
                  ? 'bg-accent-income/10 text-accent-income'
                  : 'bg-accent-expense/10 text-accent-expense'
              }`}
            >
              {isBalanced
                ? 'Balanced -- Assets = Liabilities + Equity'
                : `Out of balance by ${fmt.format(Math.abs(totalAssets - totalLiabilitiesAndEquity))}`}
            </div>
          </div>

          {/* ─── Retained Earnings Breakdown ─────────── */}
          {retainedEarnings !== 0 && (
            <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
              <button
                className="w-full px-6 py-3 flex items-center justify-between hover:bg-bg-hover/30 transition-colors"
                onClick={() => setShowREBreakdown(v => !v)}
              >
                <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
                  Retained Earnings Breakdown
                </span>
                {showREBreakdown ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
              </button>
              {showREBreakdown && (
                <div className="px-6 pb-4 border-t border-border-primary/30">
                  <table className="w-full text-sm mt-2">
                    <tbody>
                      <tr className="border-b border-border-primary/30">
                        <td className="py-1.5 text-xs text-text-secondary" style={{ paddingLeft: '24px' }}>Beginning Retained Earnings</td>
                        <td className="py-1.5 text-right pr-6 font-mono text-xs text-text-primary">{fmtNeg(reBreakdown.beginningRE)}</td>
                      </tr>
                      <tr className="border-b border-border-primary/30">
                        <td className="py-1.5 text-xs text-text-secondary" style={{ paddingLeft: '24px' }}>Add: Net Income (Current Period)</td>
                        <td className="py-1.5 text-right pr-6 font-mono text-xs text-accent-income">{fmtNeg(reBreakdown.periodNetIncome)}</td>
                      </tr>
                      <tr className="border-b border-border-primary/30">
                        <td className="py-1.5 text-xs text-text-secondary" style={{ paddingLeft: '24px' }}>Less: Dividends / Draws</td>
                        <td className="py-1.5 text-right pr-6 font-mono text-xs text-accent-expense">{fmtNeg(-reBreakdown.dividends)}</td>
                      </tr>
                      <tr className="border-t border-border-primary">
                        <td className="px-6 py-2 text-xs font-bold text-text-primary">Ending Retained Earnings</td>
                        <td className="py-2 text-right pr-6 font-mono text-xs font-bold text-text-primary">{fmtNeg(retainedEarnings)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <PrintReportFooter />
    </div>
  );
};

export default BalanceSheet;
