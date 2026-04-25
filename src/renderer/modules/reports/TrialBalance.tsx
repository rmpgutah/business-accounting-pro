import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Printer, Download, AlertTriangle, CheckCircle, Lock, FileText } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { downloadCSVBlob } from '../../lib/csv-export';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';

// ─── Types ──────────────────────────────────────────────
interface TrialBalanceLine {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_id: string | null;
  is_active: number;
  debit_total: number;
  credit_total: number;
  balance: number;
  normal_side: 'debit' | 'credit';
  // optional comparison columns
  prior_debit?: number;
  prior_credit?: number;
  prior_balance?: number;
  // working adjustments
  adj_debit?: number;
  adj_credit?: number;
}

const NORMAL_SIDE: Record<string, 'debit' | 'credit'> = {
  asset: 'debit', expense: 'debit',
  liability: 'credit', equity: 'credit', revenue: 'credit', income: 'credit',
};
const TYPE_GROUP_ORDER = ['asset', 'liability', 'equity', 'revenue', 'income', 'expense'];

type PresetKey = 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'last-year' | 'custom';

function presetRange(key: PresetKey): { start: string; end: string } | null {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (key) {
    case 'this-month':
      return { start: fmt(new Date(y, m, 1)), end: fmt(new Date(y, m + 1, 0)) };
    case 'last-month':
      return { start: fmt(new Date(y, m - 1, 1)), end: fmt(new Date(y, m, 0)) };
    case 'this-quarter': {
      const q = Math.floor(m / 3);
      return { start: fmt(new Date(y, q * 3, 1)), end: fmt(new Date(y, q * 3 + 3, 0)) };
    }
    case 'this-year':
      return { start: `${y}-01-01`, end: fmt(today) };
    case 'last-year':
      return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    default:
      return null;
  }
}

// shift a date range backwards by its own length
function priorRange(start: string, end: string): { start: string; end: string } {
  const s = new Date(start);
  const e = new Date(end);
  const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  const ps = new Date(s);
  ps.setDate(ps.getDate() - days);
  const pe = new Date(s);
  pe.setDate(pe.getDate() - 1);
  return { start: format(ps, 'yyyy-MM-dd'), end: format(pe, 'yyyy-MM-dd') };
}

const TrialBalance: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const setModule = useAppStore((s) => s.setModule);
  const setFocusEntity = useAppStore((s) => s.setFocusEntity);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<TrialBalanceLine[]>([]);
  const [classOptions, setClassOptions] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState<string>('');
  const [lockDate, setLockDate] = useState<string>('');

  // Period
  const today = new Date();
  const [preset, setPreset] = useState<PresetKey>('this-year');
  const [startDate, setStartDate] = useState(`${today.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'));

  // Toggles
  const [excludeInactive, setExcludeInactive] = useState(true);
  const [summaryOnly, setSummaryOnly] = useState(false);
  const [groupMode, setGroupMode] = useState<'type' | 'class'>('type');
  const [includeClosing, setIncludeClosing] = useState(true);
  const [comparePrior, setComparePrior] = useState(false);
  const [workingMode, setWorkingMode] = useState(false);
  const [showAdjusted, setShowAdjusted] = useState(true);

  const [refreshTick, setRefreshTick] = useState(0);

  // Listen for journal-posted events to auto-refresh
  useEffect(() => {
    const onPosted = () => setRefreshTick((t) => t + 1);
    window.addEventListener('je:posted', onPosted);
    window.addEventListener('je:changed', onPosted);
    return () => {
      window.removeEventListener('je:posted', onPosted);
      window.removeEventListener('je:changed', onPosted);
    };
  }, []);

  // Period preset application
  const applyPreset = (k: PresetKey) => {
    setPreset(k);
    const r = presetRange(k);
    if (r) { setStartDate(r.start); setEndDate(r.end); }
  };

  // Load period lock and classes
  useEffect(() => {
    if (!activeCompany) return;
    api.rawQuery(
      `SELECT locked_through_date FROM period_locks WHERE company_id=? ORDER BY locked_through_date DESC LIMIT 1`,
      [activeCompany.id]
    ).then((rows: any[]) => {
      if (rows && rows[0]?.locked_through_date) setLockDate(rows[0].locked_through_date);
    }).catch(() => {});
    api.rawQuery(
      `SELECT DISTINCT class FROM journal_entries WHERE company_id=? AND IFNULL(class,'') <> ''`,
      [activeCompany.id]
    ).then((rows: any[]) => {
      setClassOptions((rows ?? []).map((r) => r.class).filter(Boolean));
    }).catch(() => setClassOptions([]));
  }, [activeCompany, refreshTick]);

  // Main fetch
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        const buildSql = (s: string, e: string) => {
          const classClause = classFilter ? 'AND je.class = ?' : '';
          const closingClause = includeClosing ? '' : 'AND IFNULL(je.is_closing,0) = 0';
          return {
            sql: `SELECT
               a.id AS account_id,
               a.code AS account_code,
               a.name AS account_name,
               LOWER(a.type) AS account_type,
               a.parent_id,
               a.is_active,
               COALESCE(SUM(jel.debit),  0) AS debit_total,
               COALESCE(SUM(jel.credit), 0) AS credit_total
             FROM accounts a
             LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
             LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
               AND je.is_posted = 1
               AND je.date >= ?
               AND je.date <= ?
               AND je.company_id = ?
               ${classClause}
               ${closingClause}
             WHERE a.company_id = ?
             GROUP BY a.id, a.code, a.name, a.type, a.parent_id, a.is_active
             ORDER BY a.code ASC
             LIMIT 5000`,
            params: [s, e, activeCompany.id, ...(classFilter ? [classFilter] : []), activeCompany.id],
          };
        };

        const cur = buildSql(startDate, endDate);
        const rows: any[] = await api.rawQuery(cur.sql, cur.params);
        if (cancelled) return;

        let priorMap: Record<string, { debit: number; credit: number }> = {};
        if (comparePrior) {
          const pr = priorRange(startDate, endDate);
          const prior = buildSql(pr.start, pr.end);
          const priorRows: any[] = await api.rawQuery(prior.sql, prior.params);
          if (cancelled) return;
          for (const r of priorRows ?? []) {
            priorMap[r.account_id] = { debit: Number(r.debit_total), credit: Number(r.credit_total) };
          }
        }

        // Working adjustments
        let adjMap: Record<string, { debit: number; credit: number }> = {};
        if (workingMode || showAdjusted) {
          try {
            const adjRows: any[] = await api.rawQuery(
              `SELECT account_id, COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c
               FROM tb_working_adjustments
               WHERE company_id=? AND period_start=? AND period_end=?
               GROUP BY account_id`,
              [activeCompany.id, startDate, endDate]
            );
            for (const r of adjRows ?? []) {
              adjMap[r.account_id] = { debit: Number(r.d) || 0, credit: Number(r.c) || 0 };
            }
          } catch {}
        }

        const mapped: TrialBalanceLine[] = (rows ?? []).map((row) => {
          const type = row.account_type || 'asset';
          const normalSide = NORMAL_SIDE[type] ?? 'debit';
          const debit = Number(row.debit_total);
          const credit = Number(row.credit_total);
          const balance = normalSide === 'debit' ? debit - credit : credit - debit;
          const out: TrialBalanceLine = {
            account_id: row.account_id,
            account_code: row.account_code || '',
            account_name: row.account_name || 'Unnamed Account',
            account_type: type,
            parent_id: row.parent_id || null,
            is_active: Number(row.is_active ?? 1),
            debit_total: debit,
            credit_total: credit,
            balance,
            normal_side: normalSide,
          };
          if (comparePrior) {
            const p = priorMap[row.account_id];
            const pd = p?.debit || 0, pc = p?.credit || 0;
            out.prior_debit = pd;
            out.prior_credit = pc;
            out.prior_balance = normalSide === 'debit' ? pd - pc : pc - pd;
          }
          const a = adjMap[row.account_id];
          if (a) { out.adj_debit = a.debit; out.adj_credit = a.credit; }
          return out;
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
  }, [activeCompany, startDate, endDate, classFilter, includeClosing, comparePrior, workingMode, showAdjusted, refreshTick]);

  // Filter lines based on toggles
  const visible = useMemo(() => {
    const parentIds = new Set(lines.map((l) => l.parent_id).filter(Boolean) as string[]);
    return lines.filter((l) => {
      if (excludeInactive && !l.is_active) return false;
      if (summaryOnly) {
        // only show lines that are "parent" accounts (referenced by some other account as parent)
        if (!parentIds.has(l.account_id)) return false;
      }
      // Hide accounts with zero activity if filter is meaningful
      return true;
    });
  }, [lines, excludeInactive, summaryOnly]);

  // Group key resolver
  const grouped = useMemo(() => {
    const map: Record<string, TrialBalanceLine[]> = {};
    for (const line of visible) {
      const key = groupMode === 'type' ? line.account_type : (classFilter || 'all');
      if (!map[key]) map[key] = [];
      map[key].push(line);
    }
    return map;
  }, [visible, groupMode, classFilter]);

  const orderedGroupKeys = useMemo(() => {
    if (groupMode === 'type') return TYPE_GROUP_ORDER.filter((t) => grouped[t]?.length > 0);
    return Object.keys(grouped);
  }, [grouped, groupMode]);

  // Adjusted balances helper
  const adjustedBal = useCallback((l: TrialBalanceLine) => {
    const ad = l.adj_debit || 0;
    const ac = l.adj_credit || 0;
    const totalD = l.debit_total + ad;
    const totalC = l.credit_total + ac;
    return l.normal_side === 'debit' ? totalD - totalC : totalC - totalD;
  }, []);

  const totalDebits = useMemo(() => visible.reduce((s, l) => s + l.debit_total + (workingMode ? (l.adj_debit || 0) : 0), 0), [visible, workingMode]);
  const totalCredits = useMemo(() => visible.reduce((s, l) => s + l.credit_total + (workingMode ? (l.adj_credit || 0) : 0), 0), [visible, workingMode]);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;
  const delta = totalDebits - totalCredits;

  // Drill-down to GL
  const drillDown = (accountId: string) => {
    setFocusEntity({ type: 'account', id: accountId });
    setModule('reports');
    // tell GL which account
    window.dispatchEvent(new CustomEvent('gl:focus-account', { detail: { accountId, startDate, endDate } }));
  };

  const handleExport = () => {
    const rows = visible.map((l) => ({
      account_code: l.account_code,
      account_name: l.account_name,
      account_type: l.account_type,
      debit: l.debit_total.toFixed(2),
      credit: l.credit_total.toFixed(2),
      balance: l.balance.toFixed(2),
      ...(workingMode ? { adj_debit: (l.adj_debit || 0).toFixed(2), adj_credit: (l.adj_credit || 0).toFixed(2), adjusted_balance: adjustedBal(l).toFixed(2) } : {}),
      ...(comparePrior ? { prior_balance: (l.prior_balance ?? 0).toFixed(2), variance: ((l.balance) - (l.prior_balance ?? 0)).toFixed(2) } : {}),
      normal_side: l.normal_side,
    }));
    downloadCSVBlob(rows, `trial-balance-${startDate}-${endDate}.csv`);
  };

  const handlePrintPDF = async () => {
    const html = document.getElementById('tb-print-area')?.outerHTML || '';
    try {
      await api.printPreview(`<html><head><style>body{font-family:system-ui;padding:24px;}table{width:100%;border-collapse:collapse;}th,td{padding:6px;border-bottom:1px solid #ddd;font-size:11px;}.acc-neg::before{content:"(";}.acc-neg::after{content:")";}</style></head><body>${html}</body></html>`, `Trial Balance ${startDate} to ${endDate}`);
    } catch {
      window.print();
    }
  };

  // Period locked indicator
  const periodIsLocked = lockDate && endDate <= lockDate;

  return (
    <div className="space-y-4">
      <PrintReportHeader title="Trial Balance" periodLabel={`${startDate} to ${endDate}`} periodEnd={endDate} />
      {error && <ErrorBanner message={error} title="Failed to load Trial Balance" onDismiss={() => setError('')} />}

      {/* Out-of-balance warning banner */}
      {!loading && !isBalanced && (
        <div className="block-card p-3 flex items-center gap-2 border border-accent-expense/40 bg-accent-expense/5" style={{ borderRadius: '6px' }}>
          <AlertTriangle size={16} className="text-accent-expense" />
          <span className="text-xs font-semibold text-accent-expense">
            Out of balance by {formatCurrency(Math.abs(delta))} (debits {delta > 0 ? 'exceed' : 'are less than'} credits)
          </span>
        </div>
      )}

      {/* Period lock badge */}
      {periodIsLocked && (
        <div className="block-card p-2 flex items-center gap-2 border border-accent-blue/30 bg-accent-blue/5" style={{ borderRadius: '6px' }}>
          <Lock size={13} className="text-accent-blue" />
          <span className="text-[11px] font-semibold text-accent-blue">Period locked through {lockDate}</span>
        </div>
      )}

      {/* Controls */}
      <div className="block-card p-4 flex flex-wrap items-center gap-3 justify-between" style={{ borderRadius: '6px' }}>
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="block-select text-xs"
            style={{ width: '140px' }}
            value={preset}
            onChange={(e) => applyPreset(e.target.value as PresetKey)}
          >
            <option value="this-month">This Month</option>
            <option value="last-month">Last Month</option>
            <option value="this-quarter">This Quarter</option>
            <option value="this-year">This Year</option>
            <option value="last-year">Last Year</option>
            <option value="custom">Custom</option>
          </select>
          <input
            type="date"
            className="block-input text-xs"
            style={{ width: '140px' }}
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); }}
          />
          <input
            type="date"
            className="block-input text-xs"
            style={{ width: '140px' }}
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); }}
          />
          {classOptions.length > 0 && (
            <select
              className="block-select text-xs"
              style={{ width: '140px' }}
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              title="Filter by class / department"
            >
              <option value="">All Classes</option>
              {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${isBalanced ? 'text-accent-income' : 'text-accent-expense'}`}>
            {isBalanced ? <><CheckCircle size={14} /> Balanced</> : <><AlertTriangle size={14} /> Out of Balance</>}
          </div>
          <button className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" style={{ borderRadius: '6px' }} title="Export CSV (Cmd+E)" onClick={handleExport}>
            <Download size={15} />
          </button>
          <button className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" style={{ borderRadius: '6px' }} title="Export PDF / Print" onClick={handlePrintPDF}>
            <Printer size={15} />
          </button>
        </div>
      </div>

      {/* Toggle row */}
      <div className="block-card p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]" style={{ borderRadius: '6px' }}>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={excludeInactive} onChange={(e) => setExcludeInactive(e.target.checked)} />
          Exclude inactive
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={summaryOnly} onChange={(e) => setSummaryOnly(e.target.checked)} />
          Summary (parents only)
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={includeClosing} onChange={(e) => setIncludeClosing(e.target.checked)} />
          Include closing entries
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={comparePrior} onChange={(e) => setComparePrior(e.target.checked)} />
          Compare to prior period
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={workingMode} onChange={(e) => setWorkingMode(e.target.checked)} />
          Working TB (adjustments)
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showAdjusted} onChange={(e) => setShowAdjusted(e.target.checked)} disabled={!workingMode} />
          Show adjusted vs unadjusted
        </label>
        <span className="ml-auto text-text-muted">Group by:</span>
        <select className="block-select text-xs" style={{ width: '120px' }} value={groupMode} onChange={(e) => setGroupMode(e.target.value as any)}>
          <option value="type">Account Type</option>
          <option value="class">Class</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : (
        <div id="tb-print-area">
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
              <p className={`text-lg font-bold font-mono ${isBalanced ? 'text-accent-income' : 'text-accent-expense'}`}>{formatCurrency(Math.abs(delta))}</p>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="block-card p-8 text-center mt-3" style={{ borderRadius: '6px' }}>
              <FileText size={24} className="mx-auto mb-2 text-text-muted/50" />
              <p className="text-sm text-text-secondary font-medium">No posted journal entries</p>
              <p className="text-xs text-text-muted mt-1">Adjust filters or post journal entries to see the trial balance.</p>
            </div>
          ) : (
            <div className="block-card p-0 overflow-hidden mt-3" style={{ borderRadius: '6px' }}>
              <table className="block-table">
                <thead>
                  <tr>
                    <th style={{ width: '90px' }}>Code</th>
                    <th>Account Name</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                    {workingMode && <>
                      <th className="text-right">Adj Dr</th>
                      <th className="text-right">Adj Cr</th>
                    </>}
                    <th className="text-right">Balance</th>
                    {workingMode && showAdjusted && <th className="text-right">Adjusted</th>}
                    {comparePrior && <>
                      <th className="text-right">Prior</th>
                      <th className="text-right">Δ</th>
                      <th className="text-right">Δ%</th>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {orderedGroupKeys.map((key) => (
                    <React.Fragment key={key}>
                      <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
                        <td colSpan={20} className="py-2 px-4">
                          <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                            {key.charAt(0).toUpperCase() + key.slice(1)}{groupMode === 'type' ? ' Accounts' : ''}
                          </span>
                        </td>
                      </tr>
                      {grouped[key].map((line) => {
                        const variance = (line.balance) - (line.prior_balance ?? 0);
                        const variancePct = line.prior_balance ? (variance / Math.abs(line.prior_balance)) * 100 : 0;
                        const adjBal = adjustedBal(line);
                        return (
                          <tr key={line.account_id} className="hover:bg-bg-hover cursor-pointer" onClick={() => drillDown(line.account_id)}>
                            <td className="font-mono text-text-muted text-xs">{line.account_code}</td>
                            <td className="text-text-secondary">
                              <span className="text-accent-blue hover:underline">{line.account_name}</span>
                              {!line.is_active && <span className="ml-2 text-[9px] text-text-muted uppercase">inactive</span>}
                            </td>
                            <td className="text-right font-mono text-text-secondary">
                              {line.debit_total > 0 ? formatCurrency(line.debit_total) : <span className="text-text-muted">—</span>}
                            </td>
                            <td className="text-right font-mono text-text-secondary">
                              {line.credit_total > 0 ? formatCurrency(line.credit_total) : <span className="text-text-muted">—</span>}
                            </td>
                            {workingMode && <>
                              <td className="text-right font-mono text-text-muted">{(line.adj_debit || 0) > 0 ? formatCurrency(line.adj_debit!) : '—'}</td>
                              <td className="text-right font-mono text-text-muted">{(line.adj_credit || 0) > 0 ? formatCurrency(line.adj_credit!) : '—'}</td>
                            </>}
                            <td className={`text-right font-mono font-semibold ${line.balance < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                              <span className={line.balance < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(line.balance))}</span>
                              {line.balance < 0 ? ' Cr' : line.balance > 0 ? ' Dr' : ''}
                            </td>
                            {workingMode && showAdjusted && (
                              <td className={`text-right font-mono font-semibold ${adjBal < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                                <span className={adjBal < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(adjBal))}</span>
                              </td>
                            )}
                            {comparePrior && <>
                              <td className="text-right font-mono text-text-muted">{formatCurrency(Math.abs(line.prior_balance ?? 0))}</td>
                              <td className={`text-right font-mono ${variance >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                                <span className={variance < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(variance))}</span>
                              </td>
                              <td className={`text-right font-mono text-xs ${variance >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                                {line.prior_balance ? `${variancePct.toFixed(1)}%` : '—'}
                              </td>
                            </>}
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.1)' }}>
                        <td colSpan={2} className="py-1.5 px-4 text-right">
                          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Subtotal</span>
                        </td>
                        <td className="text-right font-mono text-xs font-semibold text-text-secondary">
                          {formatCurrency(grouped[key].reduce((s, l) => s + l.debit_total, 0))}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold text-text-secondary">
                          {formatCurrency(grouped[key].reduce((s, l) => s + l.credit_total, 0))}
                        </td>
                        {workingMode && <>
                          <td className="text-right font-mono text-xs text-text-muted">{formatCurrency(grouped[key].reduce((s, l) => s + (l.adj_debit || 0), 0))}</td>
                          <td className="text-right font-mono text-xs text-text-muted">{formatCurrency(grouped[key].reduce((s, l) => s + (l.adj_credit || 0), 0))}</td>
                        </>}
                        <td className="text-right font-mono text-xs font-semibold text-text-primary">
                          {formatCurrency(Math.abs(grouped[key].reduce((s, l) => s + l.balance, 0)))}
                        </td>
                        {workingMode && showAdjusted && <td className="text-right font-mono text-xs font-semibold text-text-primary">{formatCurrency(Math.abs(grouped[key].reduce((s, l) => s + adjustedBal(l), 0)))}</td>}
                        {comparePrior && <><td colSpan={3} /></>}
                      </tr>
                    </React.Fragment>
                  ))}
                  <tr style={{ borderTop: '2px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)' }}>
                    <td colSpan={2} className="py-3 px-4 text-right">
                      <span className="text-xs font-bold text-text-primary uppercase tracking-wider">Grand Total</span>
                    </td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(totalDebits)}</td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(totalCredits)}</td>
                    {workingMode && <><td /><td /></>}
                    <td className={`text-right font-mono font-bold ${isBalanced ? 'text-accent-income' : 'text-accent-expense'}`}>
                      {isBalanced ? '—' : formatCurrency(Math.abs(delta))}
                    </td>
                    {workingMode && showAdjusted && <td />}
                    {comparePrior && <><td /><td /><td /></>}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <PrintReportFooter />
    </div>
  );
};

export default TrialBalance;
