import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfYear } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

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

const PnLLineRow: React.FC<{
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

const PnLSubtotalRow: React.FC<{
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
           WHERE je.entry_date BETWEEN ? AND ?
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
              result.costOfServices.push(item);
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
      } catch (err) {
        console.error('Failed to load P&L:', err);
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
  const totalRevenue = useMemo(
    () => data.revenue.reduce((s, r) => s + r.total, 0),
    [data.revenue]
  );
  const totalCOS = useMemo(
    () => data.costOfServices.reduce((s, r) => s + Math.abs(r.total), 0),
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
            {['This Month', 'This Year'].map((p) => (
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
              Profit & Loss Statement
            </h3>
            <p className="text-[10px] text-text-muted mt-0.5">
              {format(new Date(startDate), 'MMM d, yyyy')} &ndash;{' '}
              {format(new Date(endDate), 'MMM d, yyyy')}
            </p>
          </div>

          <table className="w-full text-sm">
            <tbody>
              {/* Revenue */}
              <SectionHeader label="Revenue" />
              {data.revenue.map((r) => (
                <PnLLineRow
                  key={r.account_code}
                  name={r.account_name}
                  amount={r.total}
                  indent={1}
                />
              ))}
              <PnLSubtotalRow
                label="Total Revenue"
                amount={totalRevenue}
                accent="text-accent-income"
                topBorder
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
                      amount={Math.abs(r.total)}
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
                    netIncome >= 0
                      ? 'text-accent-income'
                      : 'text-accent-expense'
                  }`}
                >
                  {fmt.format(netIncome)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ProfitAndLoss;
