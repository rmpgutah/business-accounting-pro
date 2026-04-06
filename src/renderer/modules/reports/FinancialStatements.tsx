import React, { useEffect, useState } from 'react';
import { Printer, Download, FileSpreadsheet } from 'lucide-react';
import { format, startOfYear, endOfMonth, startOfMonth } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
type StatementTab = 'pnl' | 'balance-sheet' | 'cash-flow';

interface AccountLine {
  account_name: string;
  account_code: string;
  subtype: string;
  total?: number;
  balance?: number;
}

interface PnLData {
  revenue: AccountLine[];
  costOfServices: AccountLine[];
  operatingExpenses: Record<string, AccountLine[]>;
  otherIncome: AccountLine[];
  otherExpenses: AccountLine[];
}

interface BSData {
  currentAssets: AccountLine[];
  fixedAssets: AccountLine[];
  currentLiabilities: AccountLine[];
  longTermLiabilities: AccountLine[];
  equity: AccountLine[];
}

interface CashFlowData {
  operating: AccountLine[];
  investing: AccountLine[];
  financing: AccountLine[];
}

// ─── Statement HTML generators for print/PDF ────────────
function buildPnLHTML(data: PnLData, companyName: string, startDate: string, endDate: string): string {
  const totalRevenue = (data.revenue || []).reduce((s, a) => s + (a.total || 0), 0);
  const totalCOGS = (data.costOfServices || []).reduce((s, a) => s + (a.total || 0), 0);
  const grossProfit = totalRevenue - totalCOGS;
  const allOpex = Object.values(data.operatingExpenses || {}).flat();
  const totalOpex = allOpex.reduce((s, a) => s + (a.total || 0), 0);
  const netIncome = grossProfit - totalOpex;

  const lineRow = (name: string, amount: number, indent = 0, bold = false) =>
    `<tr><td style="padding-left:${16 + indent * 20}px;${bold ? 'font-weight:700;' : ''}">${name}</td><td style="text-align:right;font-family:monospace;${bold ? 'font-weight:700;' : ''}">${formatCurrency(amount)}</td></tr>`;

  const sectionHeader = (label: string) =>
    `<tr style="background:rgba(255,255,255,0.03);"><td colspan="2" style="padding:8px 16px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">${label}</td></tr>`;

  let rows = '';
  rows += sectionHeader('Revenue');
  (data.revenue || []).forEach(a => { rows += lineRow(a.account_name, a.total || 0, 1); });
  rows += lineRow('Total Revenue', totalRevenue, 0, true);
  rows += sectionHeader('Cost of Goods Sold');
  (data.costOfServices || []).forEach(a => { rows += lineRow(a.account_name, a.total || 0, 1); });
  rows += lineRow('Total COGS', totalCOGS, 0, true);
  rows += lineRow('Gross Profit', grossProfit, 0, true);
  rows += sectionHeader('Operating Expenses');
  for (const [cat, items] of Object.entries(data.operatingExpenses || {})) {
    if (items.length > 0) {
      rows += `<tr><td colspan="2" style="padding:4px 16px 2px 24px;font-size:10px;font-weight:600;text-transform:uppercase;color:#888;">${cat}</td></tr>`;
      items.forEach(a => { rows += lineRow(a.account_name, a.total || 0, 2); });
    }
  }
  rows += lineRow('Total Operating Expenses', totalOpex, 0, true);
  rows += `<tr style="border-top:2px solid #333;"><td style="padding:8px 16px;font-weight:700;font-size:14px;">Net Income</td><td style="text-align:right;font-family:monospace;font-weight:700;font-size:14px;color:${netIncome >= 0 ? '#10b981' : '#ef4444'};">${formatCurrency(netIncome)}</td></tr>`;

  return `<html><head><style>body{font-family:-apple-system,sans-serif;padding:40px;color:#222;max-width:800px;margin:0 auto;}table{width:100%;border-collapse:collapse;}td{padding:4px 16px;font-size:12px;border-bottom:1px solid #eee;}</style></head><body><h1 style="font-size:18px;margin-bottom:4px;">${companyName}</h1><h2 style="font-size:14px;font-weight:400;color:#666;margin-bottom:24px;">Profit & Loss Statement: ${startDate} to ${endDate}</h2><table>${rows}</table></body></html>`;
}

function buildBSHTML(data: BSData, companyName: string, asOfDate: string): string {
  const sumBal = (arr: AccountLine[]) => (arr || []).reduce((s, a) => s + (a.balance || 0), 0);
  const totalCurrentAssets = sumBal(data.currentAssets);
  const totalFixedAssets = sumBal(data.fixedAssets);
  const totalAssets = totalCurrentAssets + totalFixedAssets;
  const totalCurrentLiab = sumBal(data.currentLiabilities);
  const totalLongTermLiab = sumBal(data.longTermLiabilities);
  const totalLiabilities = totalCurrentLiab + totalLongTermLiab;
  const totalEquity = sumBal(data.equity);

  const lineRow = (name: string, amount: number, indent = 0, bold = false) =>
    `<tr><td style="padding-left:${16 + indent * 20}px;${bold ? 'font-weight:700;' : ''}">${name}</td><td style="text-align:right;font-family:monospace;${bold ? 'font-weight:700;' : ''}">${formatCurrency(amount)}</td></tr>`;
  const sectionHeader = (label: string) =>
    `<tr style="background:rgba(0,0,0,0.03);"><td colspan="2" style="padding:8px 16px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">${label}</td></tr>`;

  let rows = '';
  rows += sectionHeader('Assets');
  rows += `<tr><td colspan="2" style="padding:2px 16px 2px 24px;font-size:10px;font-weight:600;text-transform:uppercase;color:#888;">Current Assets</td></tr>`;
  (data.currentAssets || []).forEach(a => { rows += lineRow(a.account_name, a.balance || 0, 2); });
  rows += lineRow('Total Current Assets', totalCurrentAssets, 1, true);
  rows += `<tr><td colspan="2" style="padding:2px 16px 2px 24px;font-size:10px;font-weight:600;text-transform:uppercase;color:#888;">Fixed Assets</td></tr>`;
  (data.fixedAssets || []).forEach(a => { rows += lineRow(a.account_name, a.balance || 0, 2); });
  rows += lineRow('Total Fixed Assets', totalFixedAssets, 1, true);
  rows += lineRow('Total Assets', totalAssets, 0, true);
  rows += sectionHeader('Liabilities');
  rows += `<tr><td colspan="2" style="padding:2px 16px 2px 24px;font-size:10px;font-weight:600;text-transform:uppercase;color:#888;">Current Liabilities</td></tr>`;
  (data.currentLiabilities || []).forEach(a => { rows += lineRow(a.account_name, a.balance || 0, 2); });
  rows += lineRow('Total Current Liabilities', totalCurrentLiab, 1, true);
  if ((data.longTermLiabilities || []).length > 0) {
    rows += `<tr><td colspan="2" style="padding:2px 16px 2px 24px;font-size:10px;font-weight:600;text-transform:uppercase;color:#888;">Long-Term Liabilities</td></tr>`;
    data.longTermLiabilities.forEach(a => { rows += lineRow(a.account_name, a.balance || 0, 2); });
    rows += lineRow('Total Long-Term Liabilities', totalLongTermLiab, 1, true);
  }
  rows += lineRow('Total Liabilities', totalLiabilities, 0, true);
  rows += sectionHeader('Equity');
  (data.equity || []).forEach(a => { rows += lineRow(a.account_name, a.balance || 0, 1); });
  rows += lineRow('Total Equity', totalEquity, 0, true);
  rows += `<tr style="border-top:2px solid #333;"><td style="padding:8px 16px;font-weight:700;font-size:14px;">Total Liabilities + Equity</td><td style="text-align:right;font-family:monospace;font-weight:700;font-size:14px;">${formatCurrency(totalLiabilities + totalEquity)}</td></tr>`;

  return `<html><head><style>body{font-family:-apple-system,sans-serif;padding:40px;color:#222;max-width:800px;margin:0 auto;}table{width:100%;border-collapse:collapse;}td{padding:4px 16px;font-size:12px;border-bottom:1px solid #eee;}</style></head><body><h1 style="font-size:18px;margin-bottom:4px;">${companyName}</h1><h2 style="font-size:14px;font-weight:400;color:#666;margin-bottom:24px;">Balance Sheet as of ${asOfDate}</h2><table>${rows}</table></body></html>`;
}

function buildCFHTML(data: CashFlowData, companyName: string, startDate: string, endDate: string): string {
  const sumTotal = (arr: AccountLine[]) => (arr || []).reduce((s, a) => s + (a.total || a.balance || 0), 0);
  const totalOp = sumTotal(data.operating);
  const totalInv = sumTotal(data.investing);
  const totalFin = sumTotal(data.financing);
  const netChange = totalOp + totalInv + totalFin;

  const lineRow = (name: string, amount: number, indent = 0, bold = false) =>
    `<tr><td style="padding-left:${16 + indent * 20}px;${bold ? 'font-weight:700;' : ''}">${name}</td><td style="text-align:right;font-family:monospace;${bold ? 'font-weight:700;' : ''}">${formatCurrency(amount)}</td></tr>`;
  const sectionHeader = (label: string) =>
    `<tr style="background:rgba(0,0,0,0.03);"><td colspan="2" style="padding:8px 16px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">${label}</td></tr>`;

  let rows = '';
  rows += sectionHeader('Operating Activities');
  (data.operating || []).forEach(a => { rows += lineRow(a.account_name, a.total || a.balance || 0, 1); });
  rows += lineRow('Net Cash from Operating', totalOp, 0, true);
  rows += sectionHeader('Investing Activities');
  (data.investing || []).forEach(a => { rows += lineRow(a.account_name, a.total || a.balance || 0, 1); });
  rows += lineRow('Net Cash from Investing', totalInv, 0, true);
  rows += sectionHeader('Financing Activities');
  (data.financing || []).forEach(a => { rows += lineRow(a.account_name, a.total || a.balance || 0, 1); });
  rows += lineRow('Net Cash from Financing', totalFin, 0, true);
  rows += `<tr style="border-top:2px solid #333;"><td style="padding:8px 16px;font-weight:700;font-size:14px;">Net Change in Cash</td><td style="text-align:right;font-family:monospace;font-weight:700;font-size:14px;color:${netChange >= 0 ? '#10b981' : '#ef4444'};">${formatCurrency(netChange)}</td></tr>`;

  return `<html><head><style>body{font-family:-apple-system,sans-serif;padding:40px;color:#222;max-width:800px;margin:0 auto;}table{width:100%;border-collapse:collapse;}td{padding:4px 16px;font-size:12px;border-bottom:1px solid #eee;}</style></head><body><h1 style="font-size:18px;margin-bottom:4px;">${companyName}</h1><h2 style="font-size:14px;font-weight:400;color:#666;margin-bottom:24px;">Cash Flow Statement: ${startDate} to ${endDate}</h2><table>${rows}</table></body></html>`;
}

// ─── Render helpers ─────────────────────────────────────
const StatementSectionHeader: React.FC<{ label: string }> = ({ label }) => (
  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
    <td
      colSpan={2}
      className="px-6 py-2 text-xs font-bold text-text-primary uppercase tracking-wider"
    >
      {label}
    </td>
  </tr>
);

const StatementSubHeader: React.FC<{ label: string }> = ({ label }) => (
  <tr>
    <td
      colSpan={2}
      className="text-[10px] font-semibold text-text-muted uppercase tracking-wider"
      style={{ padding: '4px 16px 2px 36px' }}
    >
      {label}
    </td>
  </tr>
);

const StatementRow: React.FC<{
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
      className={`py-1.5 text-right pr-6 font-mono text-xs ${bold ? 'font-bold' : ''} ${accent || 'text-text-primary'}`}
    >
      {formatCurrency(amount)}
    </td>
  </tr>
);

const StatementTotalRow: React.FC<{
  name: string;
  amount: number;
  large?: boolean;
}> = ({ name, amount, large = false }) => (
  <tr
    className="border-b-2 border-border-primary"
    style={{ background: 'rgba(255,255,255,0.02)' }}
  >
    <td
      className={`py-2 font-bold text-text-primary ${large ? 'text-sm' : 'text-xs'}`}
      style={{ paddingLeft: '24px' }}
    >
      {name}
    </td>
    <td
      className={`py-2 text-right pr-6 font-mono font-bold ${large ? 'text-sm' : 'text-xs'} ${
        amount >= 0 ? 'text-accent-income' : 'text-accent-expense'
      }`}
    >
      {formatCurrency(amount)}
    </td>
  </tr>
);

// ─── Component ───────────���──────────────────────────────
const FinancialStatements: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyName = activeCompany?.name || 'Company';

  const [tab, setTab] = useState<StatementTab>('pnl');
  const [startDate, setStartDate] = useState(() => format(startOfYear(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [asOfDate, setAsOfDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const [pnlData, setPnlData] = useState<PnLData | null>(null);
  const [bsData, setBsData] = useState<BSData | null>(null);
  const [cfData, setCfData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'pnl') {
        const result = await api.reportProfitLoss(startDate, endDate);
        setPnlData(result);
      } else if (tab === 'balance-sheet') {
        const result = await api.reportBalanceSheet(asOfDate);
        setBsData(result);
      } else if (tab === 'cash-flow') {
        const result = await api.reportCashFlow(startDate, endDate);
        setCfData(result);
      }
    } catch (err) {
      console.error('Failed to load financial statement:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [tab, startDate, endDate, asOfDate]);

  const getHTML = (): string => {
    if (tab === 'pnl' && pnlData) return buildPnLHTML(pnlData, companyName, startDate, endDate);
    if (tab === 'balance-sheet' && bsData) return buildBSHTML(bsData, companyName, asOfDate);
    if (tab === 'cash-flow' && cfData) return buildCFHTML(cfData, companyName, startDate, endDate);
    return '';
  };

  const getTitle = (): string => {
    if (tab === 'pnl') return `ProfitLoss-${startDate}-to-${endDate}`;
    if (tab === 'balance-sheet') return `BalanceSheet-${asOfDate}`;
    return `CashFlow-${startDate}-to-${endDate}`;
  };

  const handlePrint = async () => {
    const html = getHTML();
    if (html) await api.print(html);
  };

  const handleSavePDF = async () => {
    const html = getHTML();
    if (html) await api.saveToPDF(html, getTitle());
  };

  // ─── P&L computed totals ──────────────────────────────
  const pnlTotalRevenue = (pnlData?.revenue || []).reduce((s, a) => s + (a.total || 0), 0);
  const pnlTotalCOGS = (pnlData?.costOfServices || []).reduce((s, a) => s + (a.total || 0), 0);
  const pnlGrossProfit = pnlTotalRevenue - pnlTotalCOGS;
  const pnlAllOpex = Object.values(pnlData?.operatingExpenses || {}).flat();
  const pnlTotalOpex = pnlAllOpex.reduce((s, a) => s + (a.total || 0), 0);
  const pnlNetIncome = pnlGrossProfit - pnlTotalOpex;

  // ─── BS computed totals ───────────────────────────────
  const sumBal = (arr: AccountLine[]) => (arr || []).reduce((s, a) => s + (a.balance || 0), 0);
  const bsTotalCurrentAssets = sumBal(bsData?.currentAssets || []);
  const bsTotalFixedAssets = sumBal(bsData?.fixedAssets || []);
  const bsTotalAssets = bsTotalCurrentAssets + bsTotalFixedAssets;
  const bsTotalCurrentLiab = sumBal(bsData?.currentLiabilities || []);
  const bsTotalLongTermLiab = sumBal(bsData?.longTermLiabilities || []);
  const bsTotalLiabilities = bsTotalCurrentLiab + bsTotalLongTermLiab;
  const bsTotalEquity = sumBal(bsData?.equity || []);

  // ─── CF computed totals ───────────────────────────────
  const sumAmt = (arr: AccountLine[]) => (arr || []).reduce((s, a) => s + (a.total || a.balance || 0), 0);
  const cfTotalOp = sumAmt(cfData?.operating || []);
  const cfTotalInv = sumAmt(cfData?.investing || []);
  const cfTotalFin = sumAmt(cfData?.financing || []);
  const cfNetChange = cfTotalOp + cfTotalInv + cfTotalFin;

  const TABS: { id: StatementTab; label: string }[] = [
    { id: 'pnl', label: 'Profit & Loss' },
    { id: 'balance-sheet', label: 'Balance Sheet' },
    { id: 'cash-flow', label: 'Cash Flow' },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar + actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1" style={{ borderRadius: '6px', overflow: 'hidden' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                tab === t.id
                  ? 'text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
              style={{
                borderRadius: '6px',
                background: tab === t.id ? 'rgba(59,130,246,0.8)' : 'rgba(255,255,255,0.04)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className="block-btn flex items-center gap-2"
            onClick={handlePrint}
          >
            <Printer size={14} />
            Print
          </button>
          <button
            className="block-btn flex items-center gap-2"
            onClick={handleSavePDF}
          >
            <Download size={14} />
            Save as PDF
          </button>
        </div>
      </div>

      {/* Date selectors */}
      <div
        className="block-card p-4 flex items-center gap-4"
        style={{ borderRadius: '6px' }}
      >
        <FileSpreadsheet size={16} className="text-text-muted" />
        {tab === 'balance-sheet' ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
              As of
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="bg-bg-tertiary border border-border-primary text-text-primary text-xs px-3 py-1.5 font-mono"
              style={{ borderRadius: '6px' }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
                From
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-bg-tertiary border border-border-primary text-text-primary text-xs px-3 py-1.5 font-mono"
                style={{ borderRadius: '6px' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
                To
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-bg-tertiary border border-border-primary text-text-primary text-xs px-3 py-1.5 font-mono"
                style={{ borderRadius: '6px' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Statement body */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Loading statement...
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          {/* Statement header */}
          <div
            className="px-6 py-4 border-b border-border-primary"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <h2 className="text-sm font-bold text-text-primary">{companyName}</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {tab === 'pnl' && `Profit & Loss Statement: ${startDate} to ${endDate}`}
              {tab === 'balance-sheet' && `Balance Sheet as of ${asOfDate}`}
              {tab === 'cash-flow' && `Cash Flow Statement: ${startDate} to ${endDate}`}
            </p>
          </div>

          {/* ─── Profit & Loss ───────────────────────────── */}
          {tab === 'pnl' && pnlData && (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <StatementSectionHeader label="Revenue" />
                {(pnlData.revenue || []).map((a, i) => (
                  <StatementRow key={`rev-${i}`} name={a.account_name} amount={a.total || 0} indent={1} />
                ))}
                <StatementTotalRow name="Total Revenue" amount={pnlTotalRevenue} />

                <StatementSectionHeader label="Cost of Goods Sold" />
                {(pnlData.costOfServices || []).map((a, i) => (
                  <StatementRow key={`cogs-${i}`} name={a.account_name} amount={a.total || 0} indent={1} />
                ))}
                <StatementTotalRow name="Total COGS" amount={pnlTotalCOGS} />
                <StatementTotalRow name="Gross Profit" amount={pnlGrossProfit} large />

                <StatementSectionHeader label="Operating Expenses" />
                {Object.entries(pnlData.operatingExpenses || {}).map(([cat, items]) =>
                  items.length > 0 ? (
                    <React.Fragment key={`opex-${cat}`}>
                      <StatementSubHeader label={cat} />
                      {items.map((a, i) => (
                        <StatementRow key={`opex-${cat}-${i}`} name={a.account_name} amount={a.total || 0} indent={2} />
                      ))}
                    </React.Fragment>
                  ) : null
                )}
                <StatementTotalRow name="Total Operating Expenses" amount={pnlTotalOpex} />
                <StatementTotalRow name="Net Income" amount={pnlNetIncome} large />
              </tbody>
            </table>
          )}

          {/* ─── Balance Sheet ───────────────────────────── */}
          {tab === 'balance-sheet' && bsData && (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <StatementSectionHeader label="Assets" />
                <StatementSubHeader label="Current Assets" />
                {(bsData.currentAssets || []).map((a, i) => (
                  <StatementRow key={`ca-${i}`} name={a.account_name} amount={a.balance || 0} indent={2} />
                ))}
                <StatementRow name="Total Current Assets" amount={bsTotalCurrentAssets} indent={1} bold />
                <StatementSubHeader label="Fixed Assets" />
                {(bsData.fixedAssets || []).map((a, i) => (
                  <StatementRow key={`fa-${i}`} name={a.account_name} amount={a.balance || 0} indent={2} />
                ))}
                <StatementRow name="Total Fixed Assets" amount={bsTotalFixedAssets} indent={1} bold />
                <StatementTotalRow name="Total Assets" amount={bsTotalAssets} />

                <StatementSectionHeader label="Liabilities" />
                <StatementSubHeader label="Current Liabilities" />
                {(bsData.currentLiabilities || []).map((a, i) => (
                  <StatementRow key={`cl-${i}`} name={a.account_name} amount={a.balance || 0} indent={2} />
                ))}
                <StatementRow name="Total Current Liabilities" amount={bsTotalCurrentLiab} indent={1} bold />
                {(bsData.longTermLiabilities || []).length > 0 && (
                  <>
                    <StatementSubHeader label="Long-Term Liabilities" />
                    {bsData.longTermLiabilities.map((a, i) => (
                      <StatementRow key={`ltl-${i}`} name={a.account_name} amount={a.balance || 0} indent={2} />
                    ))}
                    <StatementRow name="Total Long-Term Liabilities" amount={bsTotalLongTermLiab} indent={1} bold />
                  </>
                )}
                <StatementTotalRow name="Total Liabilities" amount={bsTotalLiabilities} />

                <StatementSectionHeader label="Equity" />
                {(bsData.equity || []).map((a, i) => (
                  <StatementRow key={`eq-${i}`} name={a.account_name} amount={a.balance || 0} indent={1} />
                ))}
                <StatementTotalRow name="Total Equity" amount={bsTotalEquity} />
                <StatementTotalRow name="Total Liabilities + Equity" amount={bsTotalLiabilities + bsTotalEquity} large />
              </tbody>
            </table>
          )}

          {/* ─── Cash Flow ───────────────────────────────── */}
          {tab === 'cash-flow' && cfData && (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <StatementSectionHeader label="Operating Activities" />
                {(cfData.operating || []).map((a, i) => (
                  <StatementRow key={`op-${i}`} name={a.account_name} amount={a.total || a.balance || 0} indent={1} />
                ))}
                <StatementTotalRow name="Net Cash from Operating" amount={cfTotalOp} />

                <StatementSectionHeader label="Investing Activities" />
                {(cfData.investing || []).map((a, i) => (
                  <StatementRow key={`inv-${i}`} name={a.account_name} amount={a.total || a.balance || 0} indent={1} />
                ))}
                <StatementTotalRow name="Net Cash from Investing" amount={cfTotalInv} />

                <StatementSectionHeader label="Financing Activities" />
                {(cfData.financing || []).map((a, i) => (
                  <StatementRow key={`fin-${i}`} name={a.account_name} amount={a.total || a.balance || 0} indent={1} />
                ))}
                <StatementTotalRow name="Net Cash from Financing" amount={cfTotalFin} />

                <StatementTotalRow name="Net Change in Cash" amount={cfNetChange} large />
              </tbody>
            </table>
          )}

          {/* Empty state */}
          {!loading && (
            (tab === 'pnl' && !pnlData) ||
            (tab === 'balance-sheet' && !bsData) ||
            (tab === 'cash-flow' && !cfData)
          ) && (
            <div className="p-12 text-center">
              <p className="text-sm text-text-muted">No data available for the selected period.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FinancialStatements;
