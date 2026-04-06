import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download, AlertTriangle } from 'lucide-react';
import { format, endOfMonth } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface AccountLine {
  account_name: string;
  account_code: string;
  subtype: string;
  balance: number;
}

interface BSData {
  currentAssets: AccountLine[];
  fixedAssets: AccountLine[];
  currentLiabilities: AccountLine[];
  longTermLiabilities: AccountLine[];
  equity: AccountLine[];
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

const SubSectionHeader: React.FC<{ label: string }> = ({ label }) => (
  <tr>
    <td
      colSpan={2}
      className="px-6 pt-2 pb-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider"
      style={{ paddingLeft: '24px' }}
    >
      {label}
    </td>
  </tr>
);

const LineRow: React.FC<{
  name: string;
  amount: number;
  indent?: number;
}> = ({ name, amount, indent = 0 }) => (
  <tr className="border-b border-border-primary/30 hover:bg-bg-hover/30 transition-colors">
    <td
      className="py-1.5 text-xs text-text-secondary"
      style={{ paddingLeft: `${24 + indent * 20}px` }}
    >
      {name}
    </td>
    <td className="py-1.5 text-right pr-6 font-mono text-xs text-text-primary">
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
const BalanceSheet: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [asOfDate, setAsOfDate] = useState(() =>
    format(endOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BSData>({
    currentAssets: [],
    fixedAssets: [],
    currentLiabilities: [],
    longTermLiabilities: [],
    equity: [],
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);

      try {
        // Query all account balances as of the date
        // For balance sheet accounts: net debit balance for assets, net credit for liabilities/equity
        const rows: any[] = await api.rawQuery(
          `SELECT
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
          [asOfDate, activeCompany.id, activeCompany.id]
        );

        if (cancelled) return;

        const result: BSData = {
          currentAssets: [],
          fixedAssets: [],
          currentLiabilities: [],
          longTermLiabilities: [],
          equity: [],
        };

        // Also get retained earnings (revenue - expense up to date)
        const reRows: any[] = await api.rawQuery(
          `SELECT
             COALESCE(SUM(jel.credit - jel.debit), 0) AS retained_earnings
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.date <= ?
             AND je.company_id = ?
             AND a.type IN ('revenue', 'expense')`,
          [asOfDate, activeCompany.id]
        );

        const retainedEarnings = Number(reRows?.[0]?.retained_earnings) || 0;

        for (const row of rows ?? []) {
          const item: AccountLine = {
            account_name: row.account_name,
            account_code: row.account_code,
            subtype: row.subtype || '',
            balance: Number(row.balance) || 0,
          };

          const sub = item.subtype.toLowerCase();

          if (row.account_type === 'asset') {
            if (
              sub.includes('fixed') ||
              sub.includes('property') ||
              sub.includes('equipment') ||
              sub.includes('long-term') ||
              sub.includes('depreciation')
            ) {
              result.fixedAssets.push(item);
            } else {
              result.currentAssets.push(item);
            }
          } else if (row.account_type === 'liability') {
            // Flip sign for liabilities (stored as credits)
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
        if (retainedEarnings !== 0) {
          result.equity.push({
            account_name: 'Retained Earnings',
            account_code: '',
            subtype: 'retained',
            balance: retainedEarnings,
          });
        }

        setData(result);
      } catch (err) {
        console.error('Failed to load Balance Sheet:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [asOfDate, activeCompany]);

  // ─── Computed totals ────────────────────────────────────
  const totalCurrentAssets = useMemo(
    () => data.currentAssets.reduce((s, a) => s + a.balance, 0),
    [data.currentAssets]
  );
  const totalFixedAssets = useMemo(
    () => data.fixedAssets.reduce((s, a) => s + a.balance, 0),
    [data.fixedAssets]
  );
  const totalAssets = totalCurrentAssets + totalFixedAssets;

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

  return (
    <div className="space-y-4">
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
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print"
          >
            <Printer size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
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
              As of {format(new Date(asOfDate), 'MMMM d, yyyy')}
            </p>
          </div>

          <table className="w-full text-sm">
            <tbody>
              {/* ASSETS */}
              <SectionHeader label="Assets" />

              {data.currentAssets.length > 0 && (
                <>
                  <SubSectionHeader label="Current Assets" />
                  {data.currentAssets.map((a) => (
                    <LineRow
                      key={a.account_code || a.account_name}
                      name={a.account_name}
                      amount={a.balance}
                      indent={2}
                    />
                  ))}
                  <SubtotalRow
                    label="Total Current Assets"
                    amount={totalCurrentAssets}
                    topBorder
                  />
                </>
              )}

              {data.fixedAssets.length > 0 && (
                <>
                  <SubSectionHeader label="Fixed Assets" />
                  {data.fixedAssets.map((a) => (
                    <LineRow
                      key={a.account_code || a.account_name}
                      name={a.account_name}
                      amount={a.balance}
                      indent={2}
                    />
                  ))}
                  <SubtotalRow
                    label="Total Fixed Assets"
                    amount={totalFixedAssets}
                    topBorder
                  />
                </>
              )}

              <SubtotalRow
                label="TOTAL ASSETS"
                amount={totalAssets}
                accent="text-accent-blue"
                doubleBorder
              />

              <Spacer />

              {/* LIABILITIES */}
              <SectionHeader label="Liabilities" />

              {data.currentLiabilities.length > 0 && (
                <>
                  <SubSectionHeader label="Current Liabilities" />
                  {data.currentLiabilities.map((a) => (
                    <LineRow
                      key={a.account_code || a.account_name}
                      name={a.account_name}
                      amount={a.balance}
                      indent={2}
                    />
                  ))}
                  <SubtotalRow
                    label="Total Current Liabilities"
                    amount={totalCurrentLiabilities}
                    topBorder
                  />
                </>
              )}

              {data.longTermLiabilities.length > 0 && (
                <>
                  <SubSectionHeader label="Long-Term Liabilities" />
                  {data.longTermLiabilities.map((a) => (
                    <LineRow
                      key={a.account_code || a.account_name}
                      name={a.account_name}
                      amount={a.balance}
                      indent={2}
                    />
                  ))}
                  <SubtotalRow
                    label="Total Long-Term Liabilities"
                    amount={totalLongTermLiabilities}
                    topBorder
                  />
                </>
              )}

              <SubtotalRow
                label="Total Liabilities"
                amount={totalLiabilities}
                accent="text-accent-expense"
                doubleBorder
              />

              <Spacer />

              {/* EQUITY */}
              <SectionHeader label="Equity" />
              {data.equity.map((a) => (
                <LineRow
                  key={a.account_code || a.account_name}
                  name={a.account_name}
                  amount={a.balance}
                  indent={1}
                />
              ))}
              <SubtotalRow
                label="Total Equity"
                amount={totalEquity}
                topBorder
              />

              <Spacer />

              {/* TOTAL LIABILITIES + EQUITY */}
              <tr className="border-t-2 border-text-primary bg-bg-tertiary/50">
                <td className="px-6 py-3 text-sm font-bold text-text-primary">
                  TOTAL LIABILITIES & EQUITY
                </td>
                <td className="py-3 text-right pr-6 font-mono text-sm font-bold text-accent-blue">
                  {fmt.format(totalLiabilitiesAndEquity)}
                </td>
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
      )}
    </div>
  );
};

export default BalanceSheet;
