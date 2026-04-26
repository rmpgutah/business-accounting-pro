import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Printer, Download, AlertTriangle, CheckCircle, Lock, FileText, Layers, Search } from 'lucide-react';
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
  tax_line?: string;
  debit_total: number;
  credit_total: number;
  balance: number;
  normal_side: 'debit' | 'credit';
  prior_debit?: number;
  prior_credit?: number;
  prior_balance?: number;
  adj_debit?: number;
  adj_credit?: number;
  // round-2:
  monthly?: number[];        // index 0..11 = Jan..Dec balance change for current year selection
  rolling12?: number[];      // last 12 months net (oldest first)
  pre_close_balance?: number;
  post_close_balance?: number;
  consolidated_extra?: number; // sum from other companies
  elimination?: number;        // signed amount (debits positive)
  fx_balance?: number;
}

const NORMAL_SIDE: Record<string, 'debit' | 'credit'> = {
  asset: 'debit', expense: 'debit',
  liability: 'credit', equity: 'credit', revenue: 'credit', income: 'credit',
};
const TYPE_GROUP_ORDER = ['asset', 'liability', 'equity', 'revenue', 'income', 'expense'];

type PresetKey = 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'last-year' | 'custom';
type ViewMode =
  | 'standard' | 'jurisdiction' | 'class-sub' | 'heatmap' | 'exception'
  | 'consolidation' | 'schedule' | 'monthly' | 'rolling12' | 'fx'
  | 'preclose' | 'hierarchy';

function presetRange(key: PresetKey): { start: string; end: string } | null {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (key) {
    case 'this-month': return { start: fmt(new Date(y, m, 1)), end: fmt(new Date(y, m + 1, 0)) };
    case 'last-month': return { start: fmt(new Date(y, m - 1, 1)), end: fmt(new Date(y, m, 0)) };
    case 'this-quarter': { const q = Math.floor(m / 3); return { start: fmt(new Date(y, q * 3, 1)), end: fmt(new Date(y, q * 3 + 3, 0)) }; }
    case 'this-year': return { start: `${y}-01-01`, end: fmt(today) };
    case 'last-year': return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    default: return null;
  }
}

function priorRange(start: string, end: string): { start: string; end: string } {
  const s = new Date(start);
  const e = new Date(end);
  const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  const ps = new Date(s); ps.setDate(ps.getDate() - days);
  const pe = new Date(s); pe.setDate(pe.getDate() - 1);
  return { start: format(ps, 'yyyy-MM-dd'), end: format(pe, 'yyyy-MM-dd') };
}

const TrialBalance: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const allCompanies = useCompanyStore((s) => s.companies);
  const setModule = useAppStore((s) => s.setModule);
  const setFocusEntity = useAppStore((s) => s.setFocusEntity);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<TrialBalanceLine[]>([]);
  const [classOptions, setClassOptions] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState<string>('');
  const [lockDate, setLockDate] = useState<string>('');
  const [closeDate, setCloseDate] = useState<string>('');

  const today = new Date();
  const [preset, setPreset] = useState<PresetKey>('this-year');
  const [startDate, setStartDate] = useState(`${today.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'));

  const [excludeInactive, setExcludeInactive] = useState(true);
  const [summaryOnly, setSummaryOnly] = useState(false);
  const [groupMode, setGroupMode] = useState<'type' | 'class'>('type');
  const [includeClosing, setIncludeClosing] = useState(true);
  const [comparePrior, setComparePrior] = useState(false);
  const [workingMode, setWorkingMode] = useState(false);
  const [showAdjusted, setShowAdjusted] = useState(true);
  const [view, setView] = useState<ViewMode>('standard');

  // Round-2 controls
  const [consolidatedCompanyIds, setConsolidatedCompanyIds] = useState<string[]>([]);
  const [eliminationsByAcct, setEliminationsByAcct] = useState<Record<string, { amount: number; id: string; memo: string }>>({});
  const [eliminationOpen, setEliminationOpen] = useState(false);
  const [elimDraft, setElimDraft] = useState({ accountId: '', amount: 0, memo: '' });
  const [fxRate, setFxRate] = useState<number>(1);
  const [showPostClose, setShowPostClose] = useState(true);
  const [expandedHierarchy, setExpandedHierarchy] = useState<Set<string>>(new Set());
  const [walkerOpen, setWalkerOpen] = useState(false);
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [whatIfDraft, setWhatIfDraft] = useState<{ accountId: string; debit: number; credit: number }[]>([
    { accountId: '', debit: 0, credit: 0 },
    { accountId: '', debit: 0, credit: 0 },
  ]);

  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const onPosted = () => setRefreshTick((t) => t + 1);
    window.addEventListener('je:posted', onPosted);
    window.addEventListener('je:changed', onPosted);
    return () => {
      window.removeEventListener('je:posted', onPosted);
      window.removeEventListener('je:changed', onPosted);
    };
  }, []);

  const applyPreset = (k: PresetKey) => {
    setPreset(k);
    const r = presetRange(k);
    if (r) { setStartDate(r.start); setEndDate(r.end); }
  };

  // Lock date, close date, classes
  useEffect(() => {
    if (!activeCompany) return;
    api.rawQuery(
      `SELECT locked_through_date FROM period_locks WHERE company_id=? ORDER BY locked_through_date DESC LIMIT 1`,
      [activeCompany.id]
    ).then((rows: any[]) => {
      if (rows && rows[0]?.locked_through_date) setLockDate(rows[0].locked_through_date);
    }).catch(() => {});
    api.rawQuery(
      `SELECT period_end FROM period_close_log WHERE company_id=? ORDER BY period_end DESC LIMIT 1`,
      [activeCompany.id]
    ).then((rows: any[]) => {
      if (rows && rows[0]?.period_end) setCloseDate(rows[0].period_end);
    }).catch(() => {});
    api.rawQuery(
      `SELECT DISTINCT class FROM journal_entries WHERE company_id=? AND IFNULL(class,'') <> ''`,
      [activeCompany.id]
    ).then((rows: any[]) => {
      setClassOptions((rows ?? []).map((r) => r.class).filter(Boolean));
    }).catch(() => setClassOptions([]));
  }, [activeCompany, refreshTick]);

  // Load eliminations for current period
  useEffect(() => {
    if (!activeCompany) return;
    const periodLabel = `${startDate}|${endDate}`;
    api.rawQuery(
      `SELECT id, account_id, amount, memo FROM tb_elimination_entries WHERE company_id=? AND period_label=?`,
      [activeCompany.id, periodLabel]
    ).then((rows: any[]) => {
      const map: Record<string, any> = {};
      for (const r of rows ?? []) map[r.account_id] = { id: r.id, amount: Number(r.amount) || 0, memo: r.memo || '' };
      setEliminationsByAcct(map);
    }).catch(() => setEliminationsByAcct({}));
  }, [activeCompany, startDate, endDate, refreshTick]);

  // Main fetch
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        const buildSql = (s: string, e: string, companyId: string, opts?: { excludeClosing?: boolean; closingOnly?: boolean }) => {
          const classClause = classFilter ? 'AND je.class = ?' : '';
          let closingClause = '';
          if (opts?.excludeClosing) closingClause = 'AND IFNULL(je.is_closing,0) = 0';
          else if (opts?.closingOnly) closingClause = 'AND IFNULL(je.is_closing,0) = 1';
          else if (!includeClosing) closingClause = 'AND IFNULL(je.is_closing,0) = 0';
          return {
            sql: `SELECT
               a.id AS account_id, a.code AS account_code, a.name AS account_name,
               LOWER(a.type) AS account_type, a.parent_id, a.is_active, IFNULL(a.tax_line,'') AS tax_line,
               COALESCE(SUM(jel.debit),  0) AS debit_total,
               COALESCE(SUM(jel.credit), 0) AS credit_total
             FROM accounts a
             LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
             LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
               AND je.is_posted = 1 AND je.date >= ? AND je.date <= ? AND je.company_id = ?
               ${classClause} ${closingClause}
             WHERE a.company_id = ?
             GROUP BY a.id, a.code, a.name, a.type, a.parent_id, a.is_active, a.tax_line
             ORDER BY a.code ASC LIMIT 5000`,
            params: [s, e, companyId, ...(classFilter ? [classFilter] : []), companyId],
          };
        };

        const cur = buildSql(startDate, endDate, activeCompany.id);
        const rows: any[] = await api.rawQuery(cur.sql, cur.params);
        if (cancelled) return;

        // Prior period
        let priorMap: Record<string, { debit: number; credit: number }> = {};
        if (comparePrior || view === 'heatmap') {
          const pr = priorRange(startDate, endDate);
          const prior = buildSql(pr.start, pr.end, activeCompany.id);
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

        // Pre-close vs post-close
        let preCloseMap: Record<string, number> = {};
        let postCloseMap: Record<string, number> = {};
        if (view === 'preclose') {
          try {
            const exclQ = buildSql(startDate, endDate, activeCompany.id, { excludeClosing: true });
            const preRows: any[] = await api.rawQuery(exclQ.sql, exclQ.params);
            for (const r of preRows ?? []) {
              const ns = NORMAL_SIDE[(r.account_type || 'asset')] ?? 'debit';
              const d = Number(r.debit_total), c = Number(r.credit_total);
              preCloseMap[r.account_id] = ns === 'debit' ? d - c : c - d;
            }
          } catch {}
        }

        // Monthly columns for current calendar year
        let monthlyMap: Record<string, number[]> = {};
        if (view === 'monthly') {
          const yr = new Date(startDate).getFullYear() || today.getFullYear();
          try {
            const mRows: any[] = await api.rawQuery(
              `SELECT jel.account_id AS account_id, LOWER(a.type) AS account_type,
                      strftime('%m', je.date) AS mo,
                      COALESCE(SUM(jel.debit),0) AS d, COALESCE(SUM(jel.credit),0) AS c
                 FROM journal_entry_lines jel
                 JOIN journal_entries je ON je.id = jel.journal_entry_id
                 JOIN accounts a ON a.id = jel.account_id
                WHERE je.company_id=? AND je.is_posted=1
                  AND strftime('%Y', je.date) = ?
                GROUP BY jel.account_id, mo`,
              [activeCompany.id, String(yr)]
            );
            for (const r of mRows ?? []) {
              const ns = NORMAL_SIDE[r.account_type] ?? 'debit';
              const idx = (parseInt(r.mo, 10) || 1) - 1;
              const v = ns === 'debit' ? (Number(r.d) - Number(r.c)) : (Number(r.c) - Number(r.d));
              if (!monthlyMap[r.account_id]) monthlyMap[r.account_id] = new Array(12).fill(0);
              monthlyMap[r.account_id][idx] = v;
            }
          } catch {}
        }

        // Rolling 12 months ending at endDate
        let rolling12Map: Record<string, number[]> = {};
        let rolling12Labels: string[] = [];
        if (view === 'rolling12') {
          const eDate = new Date(endDate);
          for (let i = 11; i >= 0; i--) {
            const d = new Date(eDate.getFullYear(), eDate.getMonth() - i, 1);
            rolling12Labels.push(format(d, 'yyyy-MM'));
          }
          try {
            const r12Rows: any[] = await api.rawQuery(
              `SELECT jel.account_id AS account_id, LOWER(a.type) AS account_type,
                      strftime('%Y-%m', je.date) AS ym,
                      COALESCE(SUM(jel.debit),0) AS d, COALESCE(SUM(jel.credit),0) AS c
                 FROM journal_entry_lines jel
                 JOIN journal_entries je ON je.id = jel.journal_entry_id
                 JOIN accounts a ON a.id = jel.account_id
                WHERE je.company_id=? AND je.is_posted=1
                  AND je.date >= ? AND je.date <= ?
                GROUP BY jel.account_id, ym`,
              [activeCompany.id, format(new Date(eDate.getFullYear(), eDate.getMonth() - 11, 1), 'yyyy-MM-dd'), endDate]
            );
            for (const r of r12Rows ?? []) {
              const ns = NORMAL_SIDE[r.account_type] ?? 'debit';
              const v = ns === 'debit' ? (Number(r.d) - Number(r.c)) : (Number(r.c) - Number(r.d));
              const idx = rolling12Labels.indexOf(r.ym);
              if (idx < 0) continue;
              if (!rolling12Map[r.account_id]) rolling12Map[r.account_id] = new Array(12).fill(0);
              rolling12Map[r.account_id][idx] = v;
            }
          } catch {}
        }

        // Consolidation: sum balances from other selected companies (by code+name match)
        let consolidatedExtra: Record<string, number> = {};
        if (view === 'consolidation' && consolidatedCompanyIds.length > 0) {
          try {
            const others = consolidatedCompanyIds.filter((id) => id !== activeCompany.id);
            for (const cid of others) {
              const q = buildSql(startDate, endDate, cid);
              const oRows: any[] = await api.rawQuery(q.sql, q.params);
              // match by account code+name
              const codeNameToBal: Record<string, number> = {};
              for (const r of oRows ?? []) {
                const ns = NORMAL_SIDE[(r.account_type || 'asset')] ?? 'debit';
                const d = Number(r.debit_total), c = Number(r.credit_total);
                const bal = ns === 'debit' ? d - c : c - d;
                codeNameToBal[`${r.account_code}|${r.account_name}`] = (codeNameToBal[`${r.account_code}|${r.account_name}`] || 0) + bal;
              }
              for (const r of rows ?? []) {
                const k = `${r.account_code}|${r.account_name}`;
                if (codeNameToBal[k] != null) {
                  consolidatedExtra[r.account_id] = (consolidatedExtra[r.account_id] || 0) + codeNameToBal[k];
                }
              }
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
            tax_line: row.tax_line || '',
            debit_total: debit,
            credit_total: credit,
            balance,
            normal_side: normalSide,
          };
          if (comparePrior || view === 'heatmap') {
            const p = priorMap[row.account_id];
            const pd = p?.debit || 0, pc = p?.credit || 0;
            out.prior_debit = pd; out.prior_credit = pc;
            out.prior_balance = normalSide === 'debit' ? pd - pc : pc - pd;
          }
          const a = adjMap[row.account_id];
          if (a) { out.adj_debit = a.debit; out.adj_credit = a.credit; }
          if (monthlyMap[row.account_id]) out.monthly = monthlyMap[row.account_id];
          if (rolling12Map[row.account_id]) out.rolling12 = rolling12Map[row.account_id];
          if (preCloseMap[row.account_id] !== undefined) {
            out.pre_close_balance = preCloseMap[row.account_id];
            out.post_close_balance = balance;
          }
          if (consolidatedExtra[row.account_id]) out.consolidated_extra = consolidatedExtra[row.account_id];
          out.fx_balance = balance * (Number.isFinite(fxRate) ? fxRate : 1);
          return out;
        });
        setLines(mapped);
        // store rolling12 labels in window for render
        (window as any).__tbRolling12Labels = rolling12Labels;
      } catch (err: any) {
        console.error('Failed to load Trial Balance:', err);
        if (!cancelled) setError(err?.message || 'Failed to load Trial Balance');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate, classFilter, includeClosing, comparePrior, workingMode, showAdjusted, refreshTick, view, JSON.stringify(consolidatedCompanyIds), fxRate]);

  // Filter
  const visible = useMemo(() => {
    const parentIds = new Set(lines.map((l) => l.parent_id).filter(Boolean) as string[]);
    return lines.filter((l) => {
      if (excludeInactive && !l.is_active) return false;
      if (summaryOnly) {
        if (!parentIds.has(l.account_id)) return false;
      }
      return true;
    });
  }, [lines, excludeInactive, summaryOnly]);

  // Hierarchy expansion (feature #14)
  const hierarchyVisible = useMemo(() => {
    if (view !== 'hierarchy') return visible;
    // Show roots + expanded children
    const childMap: Record<string, TrialBalanceLine[]> = {};
    for (const l of visible) {
      const k = l.parent_id || '__root__';
      (childMap[k] = childMap[k] || []).push(l);
    }
    const out: TrialBalanceLine[] = [];
    const walk = (parentKey: string, depth: number) => {
      const kids = childMap[parentKey] || [];
      for (const k of kids) {
        out.push({ ...k, account_name: '\u00A0\u00A0'.repeat(depth) + k.account_name });
        if (expandedHierarchy.has(k.account_id)) walk(k.account_id, depth + 1);
      }
    };
    walk('__root__', 0);
    return out;
  }, [visible, view, expandedHierarchy]);

  const grouped = useMemo(() => {
    const source = view === 'hierarchy' ? hierarchyVisible : visible;
    const map: Record<string, TrialBalanceLine[]> = {};
    for (const line of source) {
      let key: string;
      if (view === 'jurisdiction') key = line.tax_line || '(unassigned)';
      else if (view === 'class-sub') key = classFilter || (line.account_type);
      else if (groupMode === 'type') key = line.account_type;
      else key = classFilter || 'all';
      if (!map[key]) map[key] = [];
      map[key].push(line);
    }
    return map;
  }, [visible, hierarchyVisible, view, groupMode, classFilter]);

  const orderedGroupKeys = useMemo(() => {
    if (view === 'jurisdiction') return Object.keys(grouped).sort();
    if (groupMode === 'type') return TYPE_GROUP_ORDER.filter((t) => grouped[t]?.length > 0);
    return Object.keys(grouped);
  }, [grouped, groupMode, view]);

  const adjustedBal = useCallback((l: TrialBalanceLine) => {
    const ad = l.adj_debit || 0; const ac = l.adj_credit || 0;
    const totalD = l.debit_total + ad; const totalC = l.credit_total + ac;
    return l.normal_side === 'debit' ? totalD - totalC : totalC - totalD;
  }, []);

  const balanceFor = useCallback((l: TrialBalanceLine) => {
    if (view === 'consolidation') return l.balance + (l.consolidated_extra || 0) - (eliminationsByAcct[l.account_id]?.amount || 0);
    if (view === 'fx') return (l.fx_balance ?? l.balance);
    if (view === 'preclose') return showPostClose ? (l.post_close_balance ?? l.balance) : (l.pre_close_balance ?? l.balance);
    return l.balance;
  }, [view, eliminationsByAcct, showPostClose]);

  const totalDebits = useMemo(() => visible.reduce((s, l) => s + l.debit_total + (workingMode ? (l.adj_debit || 0) : 0), 0), [visible, workingMode]);
  const totalCredits = useMemo(() => visible.reduce((s, l) => s + l.credit_total + (workingMode ? (l.adj_credit || 0) : 0), 0), [visible, workingMode]);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;
  const delta = totalDebits - totalCredits;

  // Exception report (feature #4)
  const exceptions = useMemo(() => {
    if (view !== 'exception') return [] as { line: TrialBalanceLine; reason: string }[];
    const out: { line: TrialBalanceLine; reason: string }[] = [];
    for (const l of visible) {
      if (l.is_active && Math.abs(l.balance) < 0.01) out.push({ line: l, reason: 'Active account, zero balance' });
      const prior = l.prior_balance ?? 0;
      if (Math.abs(prior) > 0.01 && Math.abs((l.balance - prior) / prior) > 0.5) {
        out.push({ line: l, reason: `Balance changed > 50% (was ${formatCurrency(prior)})` });
      }
      if (l.balance < 0 && l.normal_side === 'debit') out.push({ line: l, reason: 'Asset/Expense gone negative' });
      if (l.balance > 0 && l.normal_side === 'credit' && l.account_type !== 'liability' && l.account_type !== 'equity' && l.account_type !== 'revenue' && l.account_type !== 'income') {
        // not really negative — skip
      }
    }
    return out;
  }, [view, visible]);

  // Unposted-closing detection (feature #12)
  const unpostedClosingWarning = useMemo(() => {
    if (!closeDate) return null;
    const isAfterClose = endDate >= closeDate;
    if (!isAfterClose) return null;
    const offenders = visible.filter((l) =>
      (l.account_type === 'revenue' || l.account_type === 'income' || l.account_type === 'expense') &&
      Math.abs(l.balance) > 0.01
    );
    if (offenders.length === 0) return null;
    return offenders;
  }, [visible, endDate, closeDate]);

  // Walker — top entries by absolute amount this period (feature #13)
  const [walkerRows, setWalkerRows] = useState<any[]>([]);
  useEffect(() => {
    if (!walkerOpen || !activeCompany) return;
    api.rawQuery(
      `SELECT je.id, je.entry_number, je.date, je.description,
              COALESCE(SUM(jel.debit),0) AS d, COALESCE(SUM(jel.credit),0) AS c
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
        WHERE je.company_id=? AND je.is_posted=1 AND je.date>=? AND je.date<=?
        GROUP BY je.id
        ORDER BY ABS(COALESCE(SUM(jel.debit),0) - COALESCE(SUM(jel.credit),0)) DESC,
                 (COALESCE(SUM(jel.debit),0) + COALESCE(SUM(jel.credit),0)) DESC
        LIMIT 25`,
      [activeCompany.id, startDate, endDate]
    ).then(setWalkerRows).catch(() => setWalkerRows([]));
  }, [walkerOpen, activeCompany, startDate, endDate]);

  // What-if preview (feature #15)
  const whatIfPreview = useMemo(() => {
    const totalD = whatIfDraft.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const totalC = whatIfDraft.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    const newDebits = totalDebits + totalD;
    const newCredits = totalCredits + totalC;
    return { totalD, totalC, newDebits, newCredits, balanced: Math.abs(newDebits - newCredits) < 0.01 };
  }, [whatIfDraft, totalDebits, totalCredits]);

  const drillDown = (accountId: string) => {
    setFocusEntity({ type: 'account', id: accountId });
    setModule('reports');
    window.dispatchEvent(new CustomEvent('gl:focus-account', { detail: { accountId, startDate, endDate } }));
  };

  const handleExport = () => {
    const rows = visible.map((l) => ({
      account_code: l.account_code, account_name: l.account_name, account_type: l.account_type,
      tax_line: l.tax_line || '',
      debit: l.debit_total.toFixed(2), credit: l.credit_total.toFixed(2),
      balance: balanceFor(l).toFixed(2), normal_side: l.normal_side,
      ...(view === 'consolidation' ? { other_companies: (l.consolidated_extra || 0).toFixed(2), elimination: (eliminationsByAcct[l.account_id]?.amount || 0).toFixed(2) } : {}),
      ...(view === 'fx' ? { fx_rate: fxRate, fx_balance: (l.fx_balance ?? 0).toFixed(2) } : {}),
    }));
    downloadCSVBlob(rows, `trial-balance-${view}-${startDate}-${endDate}.csv`);
  };

  const handlePrintPDF = async () => {
    const html = document.getElementById('tb-print-area')?.outerHTML || '';
    try {
      await api.printPreview(`<html><head><style>body{font-family:system-ui;padding:24px;}table{width:100%;border-collapse:collapse;}th,td{padding:6px;border-bottom:1px solid #ddd;font-size:11px;}.acc-neg::before{content:"(";}.acc-neg::after{content:")";}</style></head><body>${html}</body></html>`, `Trial Balance ${startDate} to ${endDate}`);
    } catch { window.print(); }
  };

  const periodIsLocked = lockDate && endDate <= lockDate;

  // Heat-map color helper (feature #3)
  const heatStyle = (l: TrialBalanceLine): React.CSSProperties => {
    const v = (l.balance) - (l.prior_balance ?? 0);
    if (Math.abs(v) < 1) return {};
    const max = 50000;
    const ratio = Math.max(-1, Math.min(1, v / max));
    if (ratio > 0) return { background: `rgba(34,197,94,${0.05 + ratio * 0.25})` };
    return { background: `rgba(239,68,68,${0.05 + Math.abs(ratio) * 0.25})` };
  };

  // Save elimination
  const saveElimination = async () => {
    if (!activeCompany || !elimDraft.accountId) return;
    const periodLabel = `${startDate}|${endDate}`;
    try {
      await api.create('tb_elimination_entries', {
        company_id: activeCompany.id,
        period_label: periodLabel,
        account_id: elimDraft.accountId,
        amount: elimDraft.amount,
        memo: elimDraft.memo,
      });
      setElimDraft({ accountId: '', amount: 0, memo: '' });
      setEliminationOpen(false);
      setRefreshTick((t) => t + 1);
    } catch (err: any) {
      alert('Failed to save elimination: ' + (err?.message || err));
    }
  };
  const removeElimination = async (id: string) => {
    try { await api.remove('tb_elimination_entries', id); setRefreshTick((t) => t + 1); } catch {}
  };

  return (
    <div className="space-y-4">
      <PrintReportHeader title="Trial Balance" periodLabel={`${startDate} to ${endDate}`} periodEnd={endDate} />
      {error && <ErrorBanner message={error} title="Failed to load Trial Balance" onDismiss={() => setError('')} />}

      {!loading && !isBalanced && (
        <div className="block-card p-3 flex items-center gap-2 border border-accent-expense/40 bg-accent-expense/5" style={{ borderRadius: '6px' }}>
          <AlertTriangle size={16} className="text-accent-expense" />
          <span className="text-xs font-semibold text-accent-expense">
            Out of balance by {formatCurrency(Math.abs(delta))} (debits {delta > 0 ? 'exceed' : 'are less than'} credits)
          </span>
          <button className="ml-auto text-[11px] text-accent-blue underline" onClick={() => setWalkerOpen(true)}>
            <Search size={11} className="inline mr-1" />Find offending entry…
          </button>
        </div>
      )}

      {periodIsLocked && (
        <div className="block-card p-2 flex items-center gap-2 border border-accent-blue/30 bg-accent-blue/5" style={{ borderRadius: '6px' }}>
          <Lock size={13} className="text-accent-blue" />
          <span className="text-[11px] font-semibold text-accent-blue">Period locked through {lockDate}</span>
        </div>
      )}

      {unpostedClosingWarning && unpostedClosingWarning.length > 0 && (
        <div className="block-card p-2 flex items-center gap-2 border border-accent-expense/30 bg-accent-expense/5" style={{ borderRadius: '6px' }}>
          <AlertTriangle size={13} className="text-accent-expense" />
          <span className="text-[11px] font-semibold text-accent-expense">
            Closing not posted: {unpostedClosingWarning.length} revenue/expense account(s) still have non-zero balances after close date {closeDate}.
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="block-card p-4 flex flex-wrap items-center gap-3 justify-between" style={{ borderRadius: '6px' }}>
        <div className="flex flex-wrap items-center gap-3">
          <select className="block-select text-xs" style={{ width: '140px' }} value={preset} onChange={(e) => applyPreset(e.target.value as PresetKey)}>
            <option value="this-month">This Month</option>
            <option value="last-month">Last Month</option>
            <option value="this-quarter">This Quarter</option>
            <option value="this-year">This Year</option>
            <option value="last-year">Last Year</option>
            <option value="custom">Custom</option>
          </select>
          <input type="date" className="block-input text-xs" style={{ width: '140px' }} value={startDate} onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); }} />
          <input type="date" className="block-input text-xs" style={{ width: '140px' }} value={endDate} onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); }} />
          {classOptions.length > 0 && (
            <select className="block-select text-xs" style={{ width: '140px' }} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">All Classes</option>
              {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="block-select text-xs" style={{ width: '170px' }} value={view} onChange={(e) => setView(e.target.value as ViewMode)} title="TB View">
            <option value="standard">Standard</option>
            <option value="jurisdiction">By Jurisdiction (tax line)</option>
            <option value="class-sub">By Class (subtotals)</option>
            <option value="heatmap">Heat map vs prior</option>
            <option value="exception">Exception report</option>
            <option value="consolidation">Consolidation</option>
            <option value="schedule">Schedule of accounts</option>
            <option value="monthly">By Month (Jan–Dec)</option>
            <option value="rolling12">Rolling 12-month</option>
            <option value="fx">FX-translated</option>
            <option value="preclose">Pre/Post-close</option>
            <option value="hierarchy">Hierarchy expansion</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${isBalanced ? 'text-accent-income' : 'text-accent-expense'}`}>
            {isBalanced ? <><CheckCircle size={14} /> Balanced</> : <><AlertTriangle size={14} /> Out of Balance</>}
          </div>
          <button className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" style={{ borderRadius: '6px' }} title="What-if (sensitivity)" onClick={() => setWhatIfOpen(true)}>
            <Layers size={15} />
          </button>
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
        {view === 'preclose' && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showPostClose} onChange={(e) => setShowPostClose(e.target.checked)} />
            Show post-close (uncheck for pre-close)
          </label>
        )}
        {view === 'fx' && (
          <label className="flex items-center gap-1.5">
            FX rate:
            <input type="number" step="0.0001" className="block-input text-xs" style={{ width: '80px' }} value={fxRate} onChange={(e) => setFxRate(parseFloat(e.target.value) || 1)} />
          </label>
        )}
        {view === 'consolidation' && allCompanies.length > 1 && (
          <label className="flex items-center gap-1.5">
            Other companies:
            <select multiple className="block-select text-xs" style={{ width: '180px', height: '28px' }} value={consolidatedCompanyIds}
              onChange={(e) => setConsolidatedCompanyIds(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {allCompanies.filter((c) => c.id !== activeCompany?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="text-[10px] underline text-accent-blue" onClick={() => setEliminationOpen(true)}>Eliminations…</button>
          </label>
        )}
        <span className="ml-auto text-text-muted">Group by:</span>
        <select className="block-select text-xs" style={{ width: '120px' }} value={groupMode} onChange={(e) => setGroupMode(e.target.value as any)}>
          <option value="type">Account Type</option>
          <option value="class">Class</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : view === 'exception' ? (
        // Exception report view
        <div id="tb-print-area" className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="block-table">
            <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="text-right">Balance</th><th>Anomaly</th></tr></thead>
            <tbody>
              {exceptions.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-text-muted text-xs">No anomalies detected</td></tr>
              ) : exceptions.map((ex, i) => (
                <tr key={i} className="hover:bg-bg-hover cursor-pointer" onClick={() => drillDown(ex.line.account_id)}>
                  <td className="font-mono text-xs text-text-muted">{ex.line.account_code}</td>
                  <td className="text-accent-blue">{ex.line.account_name}</td>
                  <td className="text-xs text-text-muted">{ex.line.account_type}</td>
                  <td className="text-right font-mono">{formatCurrency(Math.abs(ex.line.balance))}</td>
                  <td className="text-xs text-accent-expense">{ex.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view === 'monthly' || view === 'rolling12' ? (
        // Wide month-column views
        <div id="tb-print-area" className="block-card p-0 overflow-auto" style={{ borderRadius: '6px' }}>
          <table className="block-table">
            <thead>
              <tr>
                <th>Code</th><th>Account</th>
                {view === 'monthly'
                  ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m) => <th key={m} className="text-right">{m}</th>)
                  : ((window as any).__tbRolling12Labels || []).map((m: string) => <th key={m} className="text-right">{m.slice(2)}</th>)}
                <th className="text-right">{view === 'monthly' ? 'YTD' : 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const arr = view === 'monthly' ? (l.monthly || new Array(12).fill(0)) : (l.rolling12 || new Array(12).fill(0));
                const total = arr.reduce((s, v) => s + v, 0);
                return (
                  <tr key={l.account_id} className="hover:bg-bg-hover cursor-pointer" onClick={() => drillDown(l.account_id)}>
                    <td className="font-mono text-xs text-text-muted">{l.account_code}</td>
                    <td className="text-accent-blue text-xs">{l.account_name}</td>
                    {arr.map((v, i) => (
                      <td key={i} className={`text-right font-mono text-xs ${v < 0 ? 'text-accent-expense' : 'text-text-secondary'}`}>
                        <span data-neg={v < 0 ? 'true' : undefined} className={v < 0 ? 'acc-neg' : ''}>{Math.abs(v) < 0.01 ? '—' : formatCurrency(Math.abs(v))}</span>
                      </td>
                    ))}
                    <td className={`text-right font-mono font-semibold text-xs ${total < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                      <span data-neg={total < 0 ? 'true' : undefined} className={total < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(total))}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : view === 'schedule' ? (
        // Printable schedule of accounts (full list, debit/credit columns)
        <div id="tb-print-area" className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="block-table">
            <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody>
              {visible.map((l) => {
                const dr = l.normal_side === 'debit' ? Math.max(0, l.balance) : 0;
                const cr = l.normal_side === 'credit' ? Math.max(0, l.balance) : 0;
                return (
                  <tr key={l.account_id} className="hover:bg-bg-hover">
                    <td className="font-mono text-xs text-text-muted">{l.account_code}</td>
                    <td className="text-text-secondary">{l.account_name}{!l.is_active && <span className="ml-2 text-[9px] text-text-muted">inactive</span>}</td>
                    <td className="text-xs text-text-muted">{l.account_type}</td>
                    <td className="text-right font-mono text-xs">{dr > 0 ? formatCurrency(dr) : '—'}</td>
                    <td className="text-right font-mono text-xs">{cr > 0 ? formatCurrency(cr) : '—'}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '2px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)' }}>
                <td colSpan={3} className="py-2 px-4 text-right text-xs font-bold uppercase tracking-wider">Total</td>
                <td className="text-right font-mono font-bold">{formatCurrency(visible.filter((l) => l.normal_side === 'debit').reduce((s, l) => s + Math.max(0, l.balance), 0))}</td>
                <td className="text-right font-mono font-bold">{formatCurrency(visible.filter((l) => l.normal_side === 'credit').reduce((s, l) => s + Math.max(0, l.balance), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div id="tb-print-area">
          <div className="grid grid-cols-3 gap-3 report-summary-tiles">
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
                    {workingMode && <><th className="text-right">Adj Dr</th><th className="text-right">Adj Cr</th></>}
                    <th className="text-right">Balance</th>
                    {workingMode && showAdjusted && <th className="text-right">Adjusted</th>}
                    {view === 'consolidation' && <><th className="text-right">Other Cos</th><th className="text-right">Elim</th><th className="text-right">Consol.</th></>}
                    {view === 'fx' && <th className="text-right">FX Bal ({fxRate.toFixed(4)})</th>}
                    {view === 'preclose' && <><th className="text-right">Pre-Close</th><th className="text-right">Post-Close</th></>}
                    {comparePrior && <><th className="text-right">Prior</th><th className="text-right">Δ</th><th className="text-right">Δ%</th></>}
                  </tr>
                </thead>
                <tbody>
                  {orderedGroupKeys.map((key) => (
                    <React.Fragment key={key}>
                      <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
                        <td colSpan={20} className="py-2 px-4">
                          <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                            {view === 'jurisdiction' ? `Tax Line: ${key}` : `${key.charAt(0).toUpperCase() + key.slice(1)}${groupMode === 'type' ? ' Accounts' : ''}`}
                          </span>
                        </td>
                      </tr>
                      {grouped[key].map((line) => {
                        const variance = (line.balance) - (line.prior_balance ?? 0);
                        const variancePct = line.prior_balance ? (variance / Math.abs(line.prior_balance)) * 100 : 0;
                        const adjBal = adjustedBal(line);
                        const isParent = lines.some((x) => x.parent_id === line.account_id);
                        const consolBal = balanceFor(line);
                        const elim = eliminationsByAcct[line.account_id]?.amount || 0;
                        return (
                          <tr key={line.account_id}
                              className="hover:bg-bg-hover cursor-pointer"
                              style={view === 'heatmap' ? heatStyle(line) : undefined}
                              onClick={() => view !== 'hierarchy' || !isParent ? drillDown(line.account_id) : null}>
                            <td className="font-mono text-text-muted text-xs">
                              {view === 'hierarchy' && isParent && (
                                <button className="mr-1" onClick={(e) => { e.stopPropagation();
                                  setExpandedHierarchy((p) => { const n = new Set(p); if (n.has(line.account_id)) n.delete(line.account_id); else n.add(line.account_id); return n; });
                                }}>
                                  {expandedHierarchy.has(line.account_id) ? '−' : '+'}
                                </button>
                              )}
                              {line.account_code}
                            </td>
                            <td className="text-text-secondary">
                              <span className="text-accent-blue hover:underline">{line.account_name}</span>
                              {!line.is_active && <span className="ml-2 text-[9px] text-text-muted uppercase">inactive</span>}
                            </td>
                            <td className="text-right font-mono text-text-secondary">{line.debit_total > 0 ? formatCurrency(line.debit_total) : <span className="text-text-muted">—</span>}</td>
                            <td className="text-right font-mono text-text-secondary">{line.credit_total > 0 ? formatCurrency(line.credit_total) : <span className="text-text-muted">—</span>}</td>
                            {workingMode && <>
                              <td className="text-right font-mono text-text-muted">{(line.adj_debit || 0) > 0 ? formatCurrency(line.adj_debit!) : '—'}</td>
                              <td className="text-right font-mono text-text-muted">{(line.adj_credit || 0) > 0 ? formatCurrency(line.adj_credit!) : '—'}</td>
                            </>}
                            <td className={`text-right font-mono font-semibold ${line.balance < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                              <span data-neg={line.balance < 0 ? 'true' : undefined} className={line.balance < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(line.balance))}</span>
                              {line.balance < 0 ? ' Cr' : line.balance > 0 ? ' Dr' : ''}
                            </td>
                            {workingMode && showAdjusted && (
                              <td className={`text-right font-mono font-semibold ${adjBal < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                                <span data-neg={adjBal < 0 ? 'true' : undefined} className={adjBal < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(adjBal))}</span>
                              </td>
                            )}
                            {view === 'consolidation' && <>
                              <td className="text-right font-mono text-xs">{formatCurrency(line.consolidated_extra || 0)}</td>
                              <td className="text-right font-mono text-xs text-accent-expense">{elim ? formatCurrency(elim) : '—'}</td>
                              <td className={`text-right font-mono font-semibold ${consolBal < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>{formatCurrency(Math.abs(consolBal))}</td>
                            </>}
                            {view === 'fx' && <td className="text-right font-mono text-xs">{formatCurrency(line.fx_balance ?? 0)}</td>}
                            {view === 'preclose' && <>
                              <td className="text-right font-mono text-xs">{formatCurrency(Math.abs(line.pre_close_balance ?? 0))}</td>
                              <td className="text-right font-mono text-xs">{formatCurrency(Math.abs(line.post_close_balance ?? 0))}</td>
                            </>}
                            {comparePrior && <>
                              <td className="text-right font-mono text-text-muted">{formatCurrency(Math.abs(line.prior_balance ?? 0))}</td>
                              <td className={`text-right font-mono ${variance >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                                <span data-neg={variance < 0 ? 'true' : undefined} className={`${variance < 0 ? 'acc-neg' : ''} ${variance >= 0 ? 'variance-under' : 'variance-over'}`}>{formatCurrency(Math.abs(variance))}</span>
                              </td>
                              <td className={`text-right font-mono text-xs ${variance >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>{line.prior_balance ? `${variancePct.toFixed(1)}%` : '—'}</td>
                            </>}
                          </tr>
                        );
                      })}
                      <tr className="report-subtotal-row" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.1)' }}>
                        <td colSpan={2} className="py-1.5 px-4 text-right">
                          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Subtotal</span>
                        </td>
                        <td className="text-right font-mono text-xs font-semibold text-text-secondary">{formatCurrency(grouped[key].reduce((s, l) => s + l.debit_total, 0))}</td>
                        <td className="text-right font-mono text-xs font-semibold text-text-secondary">{formatCurrency(grouped[key].reduce((s, l) => s + l.credit_total, 0))}</td>
                        {workingMode && <>
                          <td className="text-right font-mono text-xs text-text-muted">{formatCurrency(grouped[key].reduce((s, l) => s + (l.adj_debit || 0), 0))}</td>
                          <td className="text-right font-mono text-xs text-text-muted">{formatCurrency(grouped[key].reduce((s, l) => s + (l.adj_credit || 0), 0))}</td>
                        </>}
                        <td className="text-right font-mono text-xs font-semibold text-text-primary">{formatCurrency(Math.abs(grouped[key].reduce((s, l) => s + l.balance, 0)))}</td>
                        {workingMode && showAdjusted && <td className="text-right font-mono text-xs font-semibold text-text-primary">{formatCurrency(Math.abs(grouped[key].reduce((s, l) => s + adjustedBal(l), 0)))}</td>}
                        {view === 'consolidation' && <><td /><td /><td className="text-right font-mono text-xs font-semibold">{formatCurrency(Math.abs(grouped[key].reduce((s, l) => s + balanceFor(l), 0)))}</td></>}
                        {view === 'fx' && <td className="text-right font-mono text-xs font-semibold">{formatCurrency(grouped[key].reduce((s, l) => s + (l.fx_balance ?? 0), 0))}</td>}
                        {view === 'preclose' && <><td /><td /></>}
                        {comparePrior && <><td colSpan={3} /></>}
                      </tr>
                    </React.Fragment>
                  ))}
                  <tr className="report-grand-total-row" style={{ borderTop: '2px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)' }}>
                    <td colSpan={2} className="py-3 px-4 text-right">
                      <span className="text-xs font-bold text-text-primary uppercase tracking-wider">Grand Total</span>
                    </td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(totalDebits)}</td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(totalCredits)}</td>
                    {workingMode && <><td /><td /></>}
                    <td className={`text-right font-mono font-bold ${isBalanced ? 'text-accent-income' : 'text-accent-expense'}`}>{isBalanced ? '—' : formatCurrency(Math.abs(delta))}</td>
                    {workingMode && showAdjusted && <td />}
                    {view === 'consolidation' && <><td /><td /><td /></>}
                    {view === 'fx' && <td />}
                    {view === 'preclose' && <><td /><td /></>}
                    {comparePrior && <><td /><td /><td /></>}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Walker modal */}
      {walkerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setWalkerOpen(false)}>
          <div className="block-card p-4 w-[640px] max-h-[80vh] overflow-auto" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">Out-of-Balance Walker</h3>
            <p className="text-xs text-text-muted mb-3">Difference: <span className="font-mono text-accent-expense">{formatCurrency(Math.abs(delta))}</span>. Top entries this period — click to inspect.</p>
            <table className="block-table text-xs">
              <thead><tr><th>Date</th><th>Entry #</th><th>Description</th><th className="text-right">Dr</th><th className="text-right">Cr</th><th className="text-right">Diff</th></tr></thead>
              <tbody>
                {walkerRows.map((r) => {
                  const diff = (Number(r.d) || 0) - (Number(r.c) || 0);
                  return (
                    <tr key={r.id} className="hover:bg-bg-hover cursor-pointer" onClick={() => { setFocusEntity({ type: 'journal_entry', id: r.id }); setModule('accounts'); }}>
                      <td className="font-mono">{r.date}</td>
                      <td className="font-mono">{r.entry_number}</td>
                      <td>{r.description}</td>
                      <td className="text-right font-mono">{formatCurrency(Number(r.d) || 0)}</td>
                      <td className="text-right font-mono">{formatCurrency(Number(r.c) || 0)}</td>
                      <td className={`text-right font-mono ${Math.abs(diff) > 0.01 ? 'text-accent-expense' : 'text-text-muted'}`}>{formatCurrency(diff)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex justify-end mt-3"><button className="block-btn px-3 py-1 text-xs" onClick={() => setWalkerOpen(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* What-if modal */}
      {whatIfOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setWhatIfOpen(false)}>
          <div className="block-card p-4 w-[560px]" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">What-If Sensitivity</h3>
            <p className="text-xs text-text-muted mb-3">Enter a hypothetical journal entry. Preview how the trial balance changes — nothing is committed.</p>
            <table className="block-table text-xs mb-3">
              <thead><tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
              <tbody>
                {whatIfDraft.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <select className="block-select text-xs w-full" value={row.accountId} onChange={(e) => {
                        const v = [...whatIfDraft]; v[i] = { ...v[i], accountId: e.target.value }; setWhatIfDraft(v);
                      }}>
                        <option value="">— Select —</option>
                        {visible.map((l) => <option key={l.account_id} value={l.account_id}>{l.account_code} {l.account_name}</option>)}
                      </select>
                    </td>
                    <td><input type="number" className="block-input text-xs w-full text-right" value={row.debit || ''} onChange={(e) => { const v = [...whatIfDraft]; v[i] = { ...v[i], debit: parseFloat(e.target.value) || 0 }; setWhatIfDraft(v); }} /></td>
                    <td><input type="number" className="block-input text-xs w-full text-right" value={row.credit || ''} onChange={(e) => { const v = [...whatIfDraft]; v[i] = { ...v[i], credit: parseFloat(e.target.value) || 0 }; setWhatIfDraft(v); }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="block-card p-2 text-xs" style={{ borderRadius: '6px' }}>
              <div className="flex justify-between"><span>New Total Debits:</span><span className="font-mono">{formatCurrency(whatIfPreview.newDebits)}</span></div>
              <div className="flex justify-between"><span>New Total Credits:</span><span className="font-mono">{formatCurrency(whatIfPreview.newCredits)}</span></div>
              <div className={`flex justify-between font-semibold ${whatIfPreview.balanced ? 'text-accent-income' : 'text-accent-expense'}`}>
                <span>{whatIfPreview.balanced ? 'Still balanced' : 'Out of balance'}</span>
                <span className="font-mono">{formatCurrency(Math.abs(whatIfPreview.newDebits - whatIfPreview.newCredits))}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3"><button className="block-btn px-3 py-1 text-xs" onClick={() => setWhatIfOpen(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* Eliminations modal */}
      {eliminationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEliminationOpen(false)}>
          <div className="block-card p-4 w-[520px]" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">Intercompany Elimination Entries</h3>
            <p className="text-xs text-text-muted mb-3">Period: {startDate} → {endDate}</p>
            <table className="block-table text-xs mb-3">
              <thead><tr><th>Account</th><th className="text-right">Amount</th><th>Memo</th><th></th></tr></thead>
              <tbody>
                {Object.entries(eliminationsByAcct).map(([aid, e]) => {
                  const a = visible.find((x) => x.account_id === aid);
                  return (
                    <tr key={aid}>
                      <td>{a ? `${a.account_code} ${a.account_name}` : aid}</td>
                      <td className="text-right font-mono">{formatCurrency(e.amount)}</td>
                      <td className="text-text-muted">{e.memo}</td>
                      <td><button className="text-accent-expense text-[10px]" onClick={() => removeElimination(e.id)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <select className="block-select text-xs col-span-2" value={elimDraft.accountId} onChange={(e) => setElimDraft({ ...elimDraft, accountId: e.target.value })}>
                <option value="">— Account —</option>
                {visible.map((l) => <option key={l.account_id} value={l.account_id}>{l.account_code} {l.account_name}</option>)}
              </select>
              <input type="number" className="block-input text-xs" placeholder="Amount" value={elimDraft.amount || ''} onChange={(e) => setElimDraft({ ...elimDraft, amount: parseFloat(e.target.value) || 0 })} />
            </div>
            <input type="text" className="block-input text-xs w-full mb-3" placeholder="Memo" value={elimDraft.memo} onChange={(e) => setElimDraft({ ...elimDraft, memo: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button className="block-btn px-3 py-1 text-xs" onClick={() => setEliminationOpen(false)}>Close</button>
              <button className="block-btn px-3 py-1 text-xs bg-accent-blue text-white" onClick={saveElimination}>Add Elimination</button>
            </div>
          </div>
        </div>
      )}

      <PrintReportFooter />
    </div>
  );
};

export default TrialBalance;
