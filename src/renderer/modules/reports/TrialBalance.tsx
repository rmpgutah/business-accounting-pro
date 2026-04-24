import React, { useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Printer, Download, AlertTriangle, CheckCircle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { downloadCSVBlob } from '../../lib/csv-export';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';


// ─── Types ──────────────────────────────────────────────
interface TrialBalanceLine {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  debit_total: number;
  credit_total: number;
  balance: number;
  normal_side: 'debit' | 'credit';
}

// ─── Account type normal balance side ───────────────────
// Assets, Expenses → debit normal; Liabilities, Equity, Revenue → credit normal
const NORMAL_SIDE: Record<string, 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
  income: 'credit',
};

const TYPE_GROUP_ORDER = ['asset', 'liability', 'equity', 'revenue', 'income', 'expense'];

// ─── Component ──────────────────────────────────────────
const TrialBalance: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<TrialBalanceLine[]>([]);

  // Date range defaults to current year
  const today = new Date();
  const [startDate, setStartDate] = useState(`${today.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'));

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        const rows: any[] = await api.rawQuery(
          `SELECT
             a.id AS account_id,
             a.code AS account_code,
             a.name AS account_name,
             LOWER(a.type) AS account_type,
             COALESCE(SUM(jel.debit),  0) AS debit_total,
             COALESCE(SUM(jel.credit), 0) AS credit_total
           FROM accounts a
           LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
           LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
             AND je.is_posted = 1
             AND je.date >= ?
             AND je.date <= ?
             AND je.company_id = ?
           WHERE a.company_id = ?
           GROUP BY a.id, a.code, a.name, a.type
           ORDER BY a.code ASC`,
          [startDate, endDate, activeCompany.id, activeCompany.id]
        );

        if (cancelled) return;

        const mapped: TrialBalanceLine[] = (rows ?? []).map((row) => {
          const type = row.account_type || 'asset';
          const normalSide = NORMAL_SIDE[type] ?? 'debit';
          const balance =
            normalSide === 'debit'
              ? Number(row.debit_total) - Number(row.credit_total)
              : Number(row.credit_total) - Number(row.debit_total);
          return {
            account_id: row.account_id,
            account_code: row.account_code || '',
            account_name: row.account_name || 'Unnamed Account',
            account_type: type,
            debit_total: Number(row.debit_total),
            credit_total: Number(row.credit_total),
            balance,
            normal_side: normalSide,
          };
        });

        setLines(mapped);
      } catch (err: any) {
        console.error('Failed to load Trial Balance:', err);
        if (!cancelled) setError(err?.message || 'Failed to load Trial Balance');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate]);

  // ─── Totals ──────────────────────────────────────────
  const totalDebits = useMemo(() => lines.reduce((s, l) => s + l.debit_total, 0), [lines]);
  const totalCredits = useMemo(() => lines.reduce((s, l) => s + l.credit_total, 0), [lines]);
  const isBalanced = useMemo(() => Math.abs(totalDebits - totalCredits) < 0.01, [totalDebits, totalCredits]);

  // Group lines by account type
  const grouped = useMemo(() => {
    const map: Record<string, TrialBalanceLine[]> = {};
    for (const line of lines) {
      if (!map[line.account_type]) map[line.account_type] = [];
      map[line.account_type].push(line);
    }
    return map;
  }, [lines]);

  const orderedGroups = TYPE_GROUP_ORDER.filter((t) => grouped[t]?.length > 0);

  const handleExport = () => {
    const exportData = lines.map((l) => ({
      account_code: l.account_code,
      account_name: l.account_name,
      account_type: l.account_type,
      debit: l.debit_total.toFixed(2),
      credit: l.credit_total.toFixed(2),
      balance: l.balance.toFixed(2),
      normal_side: l.normal_side,
    }));
    downloadCSVBlob(exportData, `trial-balance-${startDate}-${endDate}.csv`);
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load Trial Balance" onDismiss={() => setError('')} />}
      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">From</label>
            <input
              type="date"
              className="block-input text-xs"
              style={{ width: '140px' }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">To</label>
            <input
              type="date"
              className="block-input text-xs"
              style={{ width: '140px' }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Balance indicator */}
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${isBalanced ? 'text-accent-income' : 'text-accent-expense'}`}>
            {isBalanced
              ? <><CheckCircle size={14} /> Balanced</>
              : <><AlertTriangle size={14} /> Out of Balance</>}
          </div>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Export CSV"
            onClick={handleExport}
          >
            <Download size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print"
            onClick={() => window.print()}
          >
            <Printer size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Generating report...
        </div>
      ) : (
        <>
          {/* Summary totals */}
          <div className="grid grid-cols-3 gap-3">
            <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Total Debits</p>
              <p className="text-lg font-bold font-mono text-text-primary">{formatCurrency(totalDebits)}</p>
            </div>
            <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Total Credits</p>
              <p className="text-lg font-bold font-mono text-text-primary">{formatCurrency(totalCredits)}</p>
            </div>
            <div className={`block-card p-4 text-center ${isBalanced ? 'border border-accent-income/30' : 'border border-accent-expense/30'}`} style={{ borderRadius: '6px' }}>
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Difference</p>
              <p className={`text-lg font-bold font-mono ${isBalanced ? 'text-accent-income' : 'text-accent-expense'}`}>
                {formatCurrency(Math.abs(totalDebits - totalCredits))}
              </p>
            </div>
          </div>

          {/* Account table grouped by type */}
          {lines.length === 0 ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <p className="text-sm text-text-secondary font-medium">No posted journal entries</p>
              <p className="text-xs text-text-muted mt-1">Post journal entries to see the trial balance.</p>
            </div>
          ) : (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <table className="block-table">
                <thead>
                  <tr>
                    <th style={{ width: '90px' }}>Code</th>
                    <th>Account Name</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedGroups.map((groupType) => (
                    <React.Fragment key={groupType}>
                      {/* Group header */}
                      <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
                        <td colSpan={5} className="py-2 px-4">
                          <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                            {groupType.charAt(0).toUpperCase() + groupType.slice(1)} Accounts
                          </span>
                        </td>
                      </tr>
                      {grouped[groupType].map((line) => (
                        <tr key={line.account_id}>
                          <td className="font-mono text-text-muted text-xs">{line.account_code}</td>
                          <td className="text-text-secondary">{line.account_name}</td>
                          <td className="text-right font-mono text-text-secondary">
                            {line.debit_total > 0 ? formatCurrency(line.debit_total) : <span className="text-text-muted">—</span>}
                          </td>
                          <td className="text-right font-mono text-text-secondary">
                            {line.credit_total > 0 ? formatCurrency(line.credit_total) : <span className="text-text-muted">—</span>}
                          </td>
                          <td className={`text-right font-mono font-semibold ${line.balance < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                            {formatCurrency(Math.abs(line.balance))}
                            {line.balance < 0 ? ' Cr' : line.balance > 0 ? ' Dr' : ''}
                          </td>
                        </tr>
                      ))}
                      {/* Group subtotal */}
                      <tr style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.1)' }}>
                        <td colSpan={2} className="py-1.5 px-4 text-right">
                          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                            {groupType.charAt(0).toUpperCase() + groupType.slice(1)} Total
                          </span>
                        </td>
                        <td className="text-right font-mono text-xs font-semibold text-text-secondary">
                          {formatCurrency(grouped[groupType].reduce((s, l) => s + l.debit_total, 0))}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold text-text-secondary">
                          {formatCurrency(grouped[groupType].reduce((s, l) => s + l.credit_total, 0))}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold text-text-primary">
                          {formatCurrency(Math.abs(grouped[groupType].reduce((s, l) => s + l.balance, 0)))}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                  {/* Grand total */}
                  <tr style={{ borderTop: '2px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)' }}>
                    <td colSpan={2} className="py-3 px-4 text-right">
                      <span className="text-xs font-bold text-text-primary uppercase tracking-wider">Grand Total</span>
                    </td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(totalDebits)}</td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(totalCredits)}</td>
                    <td className={`text-right font-mono font-bold ${isBalanced ? 'text-accent-income' : 'text-accent-expense'}`}>
                      {isBalanced ? '—' : formatCurrency(Math.abs(totalDebits - totalCredits))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TrialBalance;
