import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { Printer, Download, ChevronDown, ChevronRight, Search, Lock, Pencil, History, FileText } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { downloadCSVBlob } from '../../lib/csv-export';
import { formatCurrency, formatDate } from '../../lib/format';
import EntityChip from '../../components/EntityChip';
import ErrorBanner from '../../components/ErrorBanner';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';

// ─── Types ──────────────────────────────────────────────
interface GLTransaction {
  line_id: string;
  entry_id: string;
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  type: 'debit' | 'credit';
  amount: number;
  running_balance?: number;
  is_posted: number;
  source_type?: string;
  source_id?: string;
  class?: string;
  note?: string;
  has_audit?: boolean;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

interface GLAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  transactions: GLTransaction[];
  opening_balance: number;
  closing_balance: number;
}

interface AccountOption { id: string; code: string; name: string; }

const NORMAL_SIDE: Record<string, 'debit' | 'credit'> = {
  asset: 'debit', expense: 'debit',
  liability: 'credit', equity: 'credit', revenue: 'credit', income: 'credit',
};

type PresetKey = 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'last-year' | 'custom';

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

const ROW_CAP = 5000;

const GeneralLedger: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [openingBalances, setOpeningBalances] = useState<Record<string, number>>({});
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [classOptions, setClassOptions] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState<string>('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [lockDate, setLockDate] = useState<string>('');
  const [auditLines, setAuditLines] = useState<Set<string>>(new Set());

  // Filters
  const today = new Date();
  const [preset, setPreset] = useState<PresetKey>('this-year');
  const [startDate, setStartDate] = useState(`${today.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'));
  const [includeUnposted, setIncludeUnposted] = useState(false);
  const [drFilter, setDrFilter] = useState<'all' | 'debit' | 'credit'>('all');
  const [searchText, setSearchText] = useState('');
  const [showCap, setShowCap] = useState(true);
  const [pivotMode, setPivotMode] = useState(false);

  // Selection
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [lastClickedLine, setLastClickedLine] = useState<string | null>(null);
  const [keyboardIdx, setKeyboardIdx] = useState<number>(-1);

  // Note popover
  const [editingNoteFor, setEditingNoteFor] = useState<GLTransaction | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // Reclassify modal
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [reclassifyTarget, setReclassifyTarget] = useState<string>('');
  const [reclassifyMemo, setReclassifyMemo] = useState('');

  const [refreshTick, setRefreshTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const applyPreset = (k: PresetKey) => {
    setPreset(k);
    const r = presetRange(k);
    if (r) { setStartDate(r.start); setEndDate(r.end); }
  };

  // Listen to TB drill-down event + JE post events
  useEffect(() => {
    const onFocus = (e: any) => {
      const detail = e.detail || {};
      if (detail.accountId) setSelectedAccountIds([detail.accountId]);
      if (detail.startDate) setStartDate(detail.startDate);
      if (detail.endDate) setEndDate(detail.endDate);
    };
    const onPosted = () => setRefreshTick((t) => t + 1);
    window.addEventListener('gl:focus-account', onFocus as any);
    window.addEventListener('je:posted', onPosted);
    window.addEventListener('je:changed', onPosted);
    return () => {
      window.removeEventListener('gl:focus-account', onFocus as any);
      window.removeEventListener('je:posted', onPosted);
      window.removeEventListener('je:changed', onPosted);
    };
  }, []);

  // Consume cross-module focus
  useEffect(() => {
    const fe = consumeFocusEntity('account');
    if (fe?.id) setSelectedAccountIds([fe.id]);
  }, [consumeFocusEntity]);

  // Account options + classes + lock
  useEffect(() => {
    if (!activeCompany) return;
    api.query('accounts', { company_id: activeCompany.id }).then((rows: any[]) => {
      if (Array.isArray(rows)) {
        setAccountOptions(rows.map((r) => ({ id: r.id, code: r.code || '', name: r.name }))
          .sort((a, b) => a.code.localeCompare(b.code)));
      }
    });
    api.rawQuery(
      `SELECT DISTINCT class FROM journal_entries WHERE company_id=? AND IFNULL(class,'') <> ''`,
      [activeCompany.id]
    ).then((rows: any[]) => setClassOptions((rows ?? []).map((r) => r.class).filter(Boolean))).catch(() => {});
    api.rawQuery(
      `SELECT locked_through_date FROM period_locks WHERE company_id=? ORDER BY locked_through_date DESC LIMIT 1`,
      [activeCompany.id]
    ).then((rows: any[]) => { if (rows?.[0]?.locked_through_date) setLockDate(rows[0].locked_through_date); }).catch(() => {});
  }, [activeCompany]);

  // Main fetch
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        const acctClause = selectedAccountIds.length > 0
          ? `AND a.id IN (${selectedAccountIds.map(() => '?').join(',')})`
          : '';
        const classClause = classFilter ? 'AND je.class = ?' : '';
        const postedClause = includeUnposted ? '' : 'AND je.is_posted = 1';
        const params: any[] = [
          startDate, endDate, activeCompany.id,
          ...(classFilter ? [classFilter] : []),
          activeCompany.id,
          ...selectedAccountIds,
        ];

        const sql = `SELECT
             a.id AS account_id,
             a.code AS account_code,
             a.name AS account_name,
             LOWER(a.type) AS account_type,
             jel.id AS line_id,
             je.id AS entry_id,
             je.entry_number,
             je.date,
             je.description,
             je.reference,
             je.is_posted,
             IFNULL(je.source_type,'') AS source_type,
             IFNULL(je.source_id,'') AS source_id,
             IFNULL(je.class,'') AS class,
             jel.debit,
             jel.credit,
             IFNULL(jel.note,'') AS note
           FROM accounts a
           JOIN journal_entry_lines jel ON jel.account_id = a.id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
             AND je.date >= ?
             AND je.date <= ?
             AND je.company_id = ?
             ${classClause}
             ${postedClause}
           WHERE a.company_id = ?
           ${acctClause}
           ORDER BY a.code ASC, je.date ASC, je.entry_number ASC
           LIMIT ${ROW_CAP + 1}`;

        const rows: any[] = await api.rawQuery(sql, params);
        if (cancelled) return;

        // Opening balances (sum of activity prior to startDate)
        const openSql = `SELECT a.id AS account_id, LOWER(a.type) AS account_type,
            COALESCE(SUM(jel.debit),0) AS d, COALESCE(SUM(jel.credit),0) AS c
          FROM accounts a
          LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
          LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
            AND je.is_posted=1 AND je.date < ? AND je.company_id=?
          WHERE a.company_id=? ${acctClause}
          GROUP BY a.id, a.type`;
        const openParams = [startDate, activeCompany.id, activeCompany.id, ...selectedAccountIds];
        const openRows: any[] = await api.rawQuery(openSql, openParams);
        const openMap: Record<string, number> = {};
        for (const r of openRows ?? []) {
          const ns = NORMAL_SIDE[r.account_type] ?? 'debit';
          const d = Number(r.d) || 0, c = Number(r.c) || 0;
          openMap[r.account_id] = ns === 'debit' ? d - c : c - d;
        }
        if (cancelled) return;
        setOpeningBalances(openMap);

        // Audit log lookup — flag entries with audit history
        try {
          const entryIds = Array.from(new Set((rows ?? []).map((r: any) => r.entry_id))).slice(0, 1000);
          if (entryIds.length > 0) {
            const placeholders = entryIds.map(() => '?').join(',');
            const auditRows: any[] = await api.rawQuery(
              `SELECT DISTINCT entity_id FROM audit_log WHERE entity_type='journal_entry' AND entity_id IN (${placeholders})`,
              entryIds
            );
            setAuditLines(new Set((auditRows ?? []).map((r) => r.entity_id)));
          }
        } catch { setAuditLines(new Set()); }

        // Group lines by account, retaining all attributes
        const accountMap = new Map<string, GLAccount>();
        for (const row of (rows ?? []).slice(0, ROW_CAP)) {
          if (!accountMap.has(row.account_id)) {
            accountMap.set(row.account_id, {
              account_id: row.account_id,
              account_code: row.account_code || '',
              account_name: row.account_name || 'Unnamed',
              account_type: row.account_type || 'asset',
              transactions: [],
              opening_balance: openMap[row.account_id] || 0,
              closing_balance: 0,
            });
          }
          const debit = Number(row.debit) || 0;
          const credit = Number(row.credit) || 0;
          accountMap.get(row.account_id)!.transactions.push({
            line_id: row.line_id,
            entry_id: row.entry_id,
            entry_number: row.entry_number || '',
            date: row.date || '',
            description: row.description || '',
            reference: row.reference || '',
            debit, credit,
            type: debit > 0 ? 'debit' : 'credit',
            amount: debit > 0 ? debit : credit,
            is_posted: Number(row.is_posted) || 0,
            source_type: row.source_type || '',
            source_id: row.source_id || '',
            class: row.class || '',
            note: row.note || '',
            account_id: row.account_id,
            account_code: row.account_code || '',
            account_name: row.account_name || '',
            account_type: row.account_type || 'asset',
          });
        }

        // Running balances
        const glAccounts: GLAccount[] = [];
        for (const acct of accountMap.values()) {
          const normalSide = NORMAL_SIDE[acct.account_type] ?? 'debit';
          let runningBal = acct.opening_balance;
          for (const txn of acct.transactions) {
            if (normalSide === 'debit') runningBal += txn.debit - txn.credit;
            else runningBal += txn.credit - txn.debit;
            txn.running_balance = runningBal;
          }
          acct.closing_balance = runningBal;
          glAccounts.push(acct);
        }

        setAccounts(glAccounts);
        if (glAccounts.length <= 3 || selectedAccountIds.length > 0) {
          setExpandedAccounts(new Set(glAccounts.map((a) => a.account_id)));
        } else {
          setExpandedAccounts(new Set());
        }
        setShowCap((rows ?? []).length > ROW_CAP);
      } catch (err: any) {
        console.error('Failed to load General Ledger:', err);
        if (!cancelled) setError(err?.message || 'Failed to load General Ledger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate, JSON.stringify(selectedAccountIds), classFilter, includeUnposted, refreshTick]);

  const toggleAccount = (id: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const expandAll = () => setExpandedAccounts(new Set(accounts.map((a) => a.account_id)));
  const collapseAll = () => setExpandedAccounts(new Set());

  // Filter transactions client-side for search/dr-cr filter
  const filteredAccounts = useMemo(() => {
    return accounts.map((acct) => {
      let txns = acct.transactions;
      if (drFilter !== 'all') txns = txns.filter((t) => t.type === drFilter);
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        txns = txns.filter((t) =>
          (t.description || '').toLowerCase().includes(q) ||
          (t.reference || '').toLowerCase().includes(q) ||
          (t.entry_number || '').toLowerCase().includes(q)
        );
      }
      return { ...acct, transactions: txns };
    }).filter((a) => a.transactions.length > 0 || selectedAccountIds.includes(a.account_id));
  }, [accounts, drFilter, searchText, selectedAccountIds]);

  const flatLines = useMemo(() => {
    const out: GLTransaction[] = [];
    for (const a of filteredAccounts) for (const t of a.transactions) out.push(t);
    return out;
  }, [filteredAccounts]);

  const totalTransactions = flatLines.length;

  // Pivot: month × account
  const pivot = useMemo(() => {
    if (!pivotMode) return null;
    const months = new Set<string>();
    const map = new Map<string, Map<string, number>>(); // accountId -> month -> net
    for (const a of filteredAccounts) {
      const inner = new Map<string, number>();
      for (const t of a.transactions) {
        const m = (t.date || '').slice(0, 7);
        if (!m) continue;
        months.add(m);
        const ns = NORMAL_SIDE[a.account_type] ?? 'debit';
        const v = ns === 'debit' ? (t.debit - t.credit) : (t.credit - t.debit);
        inner.set(m, (inner.get(m) || 0) + v);
      }
      map.set(a.account_id, inner);
    }
    return { months: Array.from(months).sort(), accounts: filteredAccounts, data: map };
  }, [pivotMode, filteredAccounts]);

  // Selection helpers
  const toggleLineSel = (lineId: string, e: React.MouseEvent) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedLine) {
        const ids = flatLines.map((l) => l.line_id);
        const a = ids.indexOf(lastClickedLine), b = ids.indexOf(lineId);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
        }
      } else {
        if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
      }
      return next;
    });
    setLastClickedLine(lineId);
  };

  const handleExport = useCallback(() => {
    const rows: any[] = [];
    for (const acct of filteredAccounts) {
      rows.push({
        account_code: acct.account_code, account_name: acct.account_name,
        date: '', entry_number: 'OPENING', description: 'Balance brought forward', reference: '',
        debit: '', credit: '', running_balance: (acct.opening_balance).toFixed(2),
      });
      for (const txn of acct.transactions) {
        rows.push({
          account_code: acct.account_code, account_name: acct.account_name,
          date: txn.date, entry_number: txn.entry_number, description: txn.description, reference: txn.reference,
          debit: txn.debit > 0 ? txn.debit.toFixed(2) : '',
          credit: txn.credit > 0 ? txn.credit.toFixed(2) : '',
          running_balance: (txn.running_balance ?? 0).toFixed(2),
          note: txn.note || '',
          source: txn.source_type ? `${txn.source_type}:${txn.source_id}` : '',
          posted: txn.is_posted ? 'Y' : 'N',
        });
      }
      rows.push({
        account_code: acct.account_code, account_name: acct.account_name,
        date: '', entry_number: 'CLOSING', description: 'Balance carried forward', reference: '',
        debit: '', credit: '', running_balance: (acct.closing_balance).toFixed(2),
      });
    }
    downloadCSVBlob(rows, `general-ledger-${startDate}-${endDate}.csv`);
  }, [filteredAccounts, startDate, endDate]);

  const handlePrintPDF = async () => {
    const html = document.getElementById('gl-print-area')?.outerHTML || '';
    try {
      await api.printPreview(`<html><head><style>body{font-family:system-ui;padding:24px;}table{width:100%;border-collapse:collapse;}th,td{padding:6px;border-bottom:1px solid #ddd;font-size:11px;}.acc-neg::before{content:"(";}.acc-neg::after{content:")";}</style></head><body>${html}</body></html>`, `General Ledger ${startDate} to ${endDate}`);
    } catch {
      window.print();
    }
  };

  // Save line note
  const saveNote = async () => {
    if (!editingNoteFor) return;
    try {
      await api.rawQuery(`UPDATE journal_entry_lines SET note=? WHERE id=?`, [noteDraft, editingNoteFor.line_id]);
      // local update
      setAccounts((prev) => prev.map((a) => ({
        ...a,
        transactions: a.transactions.map((t) => t.line_id === editingNoteFor.line_id ? { ...t, note: noteDraft } : t),
      })));
      setEditingNoteFor(null);
    } catch (err: any) {
      alert('Failed to save note: ' + (err?.message || err));
    }
  };

  // Bulk reclassify -> create balancing JE
  const handleReclassify = async () => {
    if (!activeCompany) return;
    if (!reclassifyTarget) { alert('Pick a target account'); return; }
    const selected = flatLines.filter((l) => selectedLineIds.has(l.line_id));
    if (selected.length === 0) return;
    try {
      // Create a balancing journal entry per source-account: move from old account to new
      const grouped: Record<string, GLTransaction[]> = {};
      for (const l of selected) {
        if (!grouped[l.account_id]) grouped[l.account_id] = [];
        grouped[l.account_id].push(l);
      }
      const dateStr = format(new Date(), 'yyyy-MM-dd');
      const entryNo = `RCLS-${Date.now().toString().slice(-6)}`;
      const entryRes = await api.create('journal_entries', {
        company_id: activeCompany.id,
        entry_number: entryNo,
        date: dateStr,
        description: `Bulk reclassify (${selected.length} lines)${reclassifyMemo ? ' — ' + reclassifyMemo : ''}`,
        reference: 'GL-Reclassify',
        is_adjusting: 1,
        is_posted: 1,
      });
      const entryId = entryRes?.id || entryRes;
      for (const fromAcct of Object.keys(grouped)) {
        const ls = grouped[fromAcct];
        const totalDebit = ls.reduce((s, l) => s + (l.debit || 0), 0);
        const totalCredit = ls.reduce((s, l) => s + (l.credit || 0), 0);
        // Reverse out of original account
        if (totalDebit > 0) {
          await api.create('journal_entry_lines', { journal_entry_id: entryId, account_id: fromAcct, debit: 0, credit: totalDebit, description: 'Reclassify out' });
          await api.create('journal_entry_lines', { journal_entry_id: entryId, account_id: reclassifyTarget, debit: totalDebit, credit: 0, description: 'Reclassify in' });
        }
        if (totalCredit > 0) {
          await api.create('journal_entry_lines', { journal_entry_id: entryId, account_id: fromAcct, debit: totalCredit, credit: 0, description: 'Reclassify out' });
          await api.create('journal_entry_lines', { journal_entry_id: entryId, account_id: reclassifyTarget, debit: 0, credit: totalCredit, description: 'Reclassify in' });
        }
      }
      setReclassifyOpen(false);
      setSelectedLineIds(new Set());
      setRefreshTick((t) => t + 1);
      window.dispatchEvent(new CustomEvent('je:posted'));
    } catch (err: any) {
      alert('Reclassify failed: ' + (err?.message || err));
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault(); handleExport(); return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setKeyboardIdx((i) => Math.min(flatLines.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setKeyboardIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && keyboardIdx >= 0 && flatLines[keyboardIdx]) {
        const t = flatLines[keyboardIdx];
        useAppStore.getState().setFocusEntity({ type: 'journal_entry', id: t.entry_id });
        useAppStore.getState().setModule('accounts');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flatLines, keyboardIdx, handleExport]);

  const periodIsLocked = (date: string) => !!lockDate && date <= lockDate;

  return (
    <div className="space-y-4" ref={containerRef}>
      <PrintReportHeader title="General Ledger" periodLabel={`${startDate} to ${endDate}`} periodEnd={endDate} />
      {error && <ErrorBanner message={error} title="Failed to load General Ledger" onDismiss={() => setError('')} />}

      {/* Lock banner */}
      {lockDate && (
        <div className="block-card p-2 flex items-center gap-2 border border-accent-blue/30 bg-accent-blue/5" style={{ borderRadius: '6px' }}>
          <Lock size={13} className="text-accent-blue" />
          <span className="text-[11px] font-semibold text-accent-blue">Periods locked through {lockDate}</span>
        </div>
      )}

      {/* Controls */}
      <div className="block-card p-4 flex flex-wrap items-center gap-3 justify-between" style={{ borderRadius: '6px' }}>
        <div className="flex flex-wrap items-center gap-3">
          <select className="block-select text-xs" style={{ width: '130px' }} value={preset} onChange={(e) => applyPreset(e.target.value as PresetKey)}>
            <option value="this-month">This Month</option>
            <option value="last-month">Last Month</option>
            <option value="this-quarter">This Quarter</option>
            <option value="this-year">This Year</option>
            <option value="last-year">Last Year</option>
            <option value="custom">Custom</option>
          </select>
          <input type="date" className="block-input text-xs" style={{ width: '140px' }} value={startDate} onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); }} />
          <input type="date" className="block-input text-xs" style={{ width: '140px' }} value={endDate} onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); }} />

          <select
            multiple
            className="block-select text-xs"
            style={{ width: '220px', height: '32px' }}
            value={selectedAccountIds}
            onChange={(e) => setSelectedAccountIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
            title="Hold Cmd/Ctrl to multi-select"
          >
            {accountOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.code} — {opt.name}</option>
            ))}
          </select>
          {selectedAccountIds.length > 0 && (
            <button className="text-[10px] text-text-muted hover:text-text-primary" onClick={() => setSelectedAccountIds([])}>Clear</button>
          )}

          {classOptions.length > 0 && (
            <select className="block-select text-xs" style={{ width: '130px' }} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">All Classes</option>
              {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          <select className="block-select text-xs" style={{ width: '110px' }} value={drFilter} onChange={(e) => setDrFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="debit">Debits only</option>
            <option value="credit">Credits only</option>
          </select>

          <div className="flex items-center gap-1.5 px-2 block-input text-xs" style={{ width: '180px' }}>
            <Search size={12} className="text-text-muted" />
            <input
              type="text"
              placeholder="Search descr/ref…"
              className="bg-transparent flex-1 outline-none text-xs"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs text-text-muted hover:text-text-primary px-2 py-1" onClick={expandAll}>Expand All</button>
          <button className="text-xs text-text-muted hover:text-text-primary px-2 py-1" onClick={collapseAll}>Collapse All</button>
          <button className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover" style={{ borderRadius: '6px' }} title="Export CSV (Cmd+E)" onClick={handleExport}><Download size={15} /></button>
          <button className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover" style={{ borderRadius: '6px' }} title="Print/PDF" onClick={handlePrintPDF}><Printer size={15} /></button>
        </div>
      </div>

      {/* Toggles + bulk action */}
      <div className="block-card p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]" style={{ borderRadius: '6px' }}>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={includeUnposted} onChange={(e) => setIncludeUnposted(e.target.checked)} />
          Include unposted
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={pivotMode} onChange={(e) => setPivotMode(e.target.checked)} />
          Pivot view (month × account)
        </label>
        <span className="text-text-muted">
          {accounts.length} accounts, {totalTransactions} txns
          {showCap && <span className="text-accent-expense ml-2">⚠ result capped at {ROW_CAP}</span>}
        </span>
        {selectedLineIds.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-text-secondary">{selectedLineIds.size} selected</span>
            <button className="block-btn px-3 py-1 text-xs bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20" onClick={() => setReclassifyOpen(true)}>Bulk Reclassify…</button>
            <button className="text-text-muted text-xs" onClick={() => setSelectedLineIds(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : pivotMode && pivot ? (
        <div id="gl-print-area" className="block-card p-0 overflow-auto" style={{ borderRadius: '6px' }}>
          <table className="block-table">
            <thead>
              <tr>
                <th>Account</th>
                {pivot.months.map((m) => <th key={m} className="text-right">{m}</th>)}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {pivot.accounts.map((a) => {
                const inner = pivot.data.get(a.account_id);
                const total = pivot.months.reduce((s, m) => s + (inner?.get(m) || 0), 0);
                return (
                  <tr key={a.account_id}>
                    <td className="text-text-secondary">{a.account_code} {a.account_name}</td>
                    {pivot.months.map((m) => {
                      const v = inner?.get(m) || 0;
                      return <td key={m} className={`text-right font-mono text-xs ${v < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                        <span className={v < 0 ? 'acc-neg' : ''}>{v === 0 ? '—' : formatCurrency(Math.abs(v))}</span>
                      </td>;
                    })}
                    <td className={`text-right font-mono font-semibold ${total < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                      <span className={total < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(total))}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
          <FileText size={24} className="mx-auto mb-2 text-text-muted/50" />
          <p className="text-sm text-text-secondary font-medium">No transactions found</p>
          <p className="text-xs text-text-muted mt-1">Adjust filters or post journal entries.</p>
        </div>
      ) : (
        <div id="gl-print-area" className="space-y-2">
          {filteredAccounts.map((acct) => {
            const isExpanded = expandedAccounts.has(acct.account_id);
            const normalSide = NORMAL_SIDE[acct.account_type] ?? 'debit';
            return (
              <div key={acct.account_id} className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover text-left" onClick={() => toggleAccount(acct.account_id)}>
                  <span className="text-text-muted">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                  <span className="font-mono text-xs text-text-muted w-16 shrink-0">{acct.account_code}</span>
                  <span className="font-semibold text-text-primary flex-1">{acct.account_name}</span>
                  <span className="text-[10px] text-text-muted uppercase tracking-wider w-20 text-center">{acct.account_type}</span>
                  <span className="text-xs text-text-muted mr-4">{acct.transactions.length} txn{acct.transactions.length !== 1 ? 's' : ''}</span>
                  <div className="text-right min-w-[120px]">
                    <span className="text-[10px] text-text-muted block">Closing</span>
                    <span className={`font-mono font-bold text-sm ${acct.closing_balance < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                      <span className={acct.closing_balance < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(acct.closing_balance))}</span>
                      <span className="text-[10px] text-text-muted ml-1">
                        {normalSide === 'debit' ? (acct.closing_balance >= 0 ? 'Dr' : 'Cr') : (acct.closing_balance >= 0 ? 'Cr' : 'Dr')}
                      </span>
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {/* Beginning balance row */}
                    <div className="px-4 py-1.5 text-[10px] text-text-muted font-semibold flex justify-between" style={{ background: 'rgba(0,0,0,0.15)' }}>
                      <span>Balance brought forward</span>
                      <span className="font-mono">{formatCurrency(Math.abs(acct.opening_balance))}{acct.opening_balance < 0 ? ' Cr' : ' Dr'}</span>
                    </div>
                    <table className="block-table">
                      <thead>
                        <tr>
                          <th style={{ width: '28px' }}><input type="checkbox" onChange={(e) => {
                            setSelectedLineIds((prev) => {
                              const next = new Set(prev);
                              for (const t of acct.transactions) { if (e.target.checked) next.add(t.line_id); else next.delete(t.line_id); }
                              return next;
                            });
                          }} /></th>
                          <th style={{ width: '100px' }}>Date</th>
                          <th style={{ width: '110px' }}>Entry #</th>
                          <th>Description</th>
                          <th style={{ width: '90px' }}>Source</th>
                          <th style={{ width: '90px' }}>Reference</th>
                          <th className="text-right" style={{ width: '110px' }}>Debit</th>
                          <th className="text-right" style={{ width: '110px' }}>Credit</th>
                          <th className="text-right" style={{ width: '130px' }}>Balance</th>
                          <th style={{ width: '70px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {acct.transactions.map((txn, idx) => {
                          const globalIdx = flatLines.indexOf(txn);
                          const isKbd = globalIdx === keyboardIdx;
                          const locked = periodIsLocked(txn.date);
                          const selected = selectedLineIds.has(txn.line_id);
                          return (
                            <tr key={txn.line_id}
                              className={`${selected ? 'bg-accent-blue/5' : ''} ${isKbd ? 'outline outline-1 outline-accent-blue' : ''} ${!txn.is_posted ? 'opacity-60' : ''}`}>
                              <td>
                                <input type="checkbox" checked={selected} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleLineSel(txn.line_id, e as any)} />
                              </td>
                              <td className="font-mono text-text-secondary text-xs">
                                {locked && <Lock size={9} className="inline mr-1 text-text-muted" />}
                                {formatDate(txn.date)}
                              </td>
                              <td className="font-mono text-xs">
                                <EntityChip type="journal_entry" id={txn.entry_id} label={txn.entry_number} variant="mono" />
                                {!txn.is_posted && <span className="ml-1 text-[9px] text-accent-expense">UNPOSTED</span>}
                              </td>
                              <td className="text-text-secondary text-xs">
                                {txn.description || '—'}
                                {txn.note && <span className="block text-[10px] text-accent-blue italic mt-0.5">📝 {txn.note}</span>}
                              </td>
                              <td className="text-xs">
                                {txn.source_type && txn.source_id
                                  ? <EntityChip type={txn.source_type} id={txn.source_id} variant="inline" label={txn.source_type} />
                                  : <span className="text-text-muted">—</span>}
                              </td>
                              <td className="text-text-muted text-xs">{txn.reference || '—'}</td>
                              <td className="text-right font-mono text-xs">
                                {txn.debit > 0 ? <span className="text-text-primary">{formatCurrency(txn.debit)}</span> : <span className="text-text-muted">—</span>}
                              </td>
                              <td className="text-right font-mono text-xs">
                                {txn.credit > 0 ? <span className="text-text-primary">{formatCurrency(txn.credit)}</span> : <span className="text-text-muted">—</span>}
                              </td>
                              <td className={`text-right font-mono font-semibold text-xs ${(txn.running_balance ?? 0) < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                                <span className={(txn.running_balance ?? 0) < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(txn.running_balance ?? 0))}</span>
                              </td>
                              <td className="text-right">
                                <button title="Add/edit note" className="p-1 text-text-muted hover:text-accent-blue" onClick={(e) => { e.stopPropagation(); setEditingNoteFor(txn); setNoteDraft(txn.note || ''); }}>
                                  <Pencil size={11} />
                                </button>
                                {auditLines.has(txn.entry_id) && (
                                  <span title="Audit history" className="ml-1 text-text-muted"><History size={11} className="inline" /></span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)' }}>
                          <td colSpan={6} className="py-2 px-4 text-right text-xs font-bold text-text-muted uppercase tracking-wider">Period Total</td>
                          <td className="text-right font-mono font-bold text-xs text-text-primary">
                            {formatCurrency(acct.transactions.reduce((s, t) => s + t.debit, 0))}
                          </td>
                          <td className="text-right font-mono font-bold text-xs text-text-primary">
                            {formatCurrency(acct.transactions.reduce((s, t) => s + t.credit, 0))}
                          </td>
                          <td className={`text-right font-mono font-bold text-xs ${acct.closing_balance < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                            <span className={acct.closing_balance < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(acct.closing_balance))}</span>
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                    <div className="px-4 py-1.5 text-[10px] text-text-muted font-semibold flex justify-between" style={{ background: 'rgba(0,0,0,0.15)' }}>
                      <span>Balance carried forward</span>
                      <span className="font-mono">{formatCurrency(Math.abs(acct.closing_balance))}{acct.closing_balance < 0 ? ' Cr' : ' Dr'}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Note popover */}
      {editingNoteFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingNoteFor(null)}>
          <div className="block-card p-4 w-[420px]" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2 text-text-primary">Line note</h3>
            <p className="text-xs text-text-muted mb-2">Entry {editingNoteFor.entry_number} — {editingNoteFor.account_name}</p>
            <textarea
              className="block-input w-full text-xs"
              rows={4}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button className="block-btn px-3 py-1 text-xs" onClick={() => setEditingNoteFor(null)}>Cancel</button>
              <button className="block-btn px-3 py-1 text-xs bg-accent-blue text-white" onClick={saveNote}>Save Note</button>
            </div>
          </div>
        </div>
      )}

      {/* Reclassify modal */}
      {reclassifyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setReclassifyOpen(false)}>
          <div className="block-card p-4 w-[480px]" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3 text-text-primary">Bulk Reclassify {selectedLineIds.size} line(s)</h3>
            <p className="text-xs text-text-muted mb-3">A balancing journal entry will be created to reclassify the selected lines into the chosen account.</p>
            <label className="text-[10px] font-semibold text-text-muted uppercase block mb-1">Target account</label>
            <select className="block-select text-xs w-full mb-3" value={reclassifyTarget} onChange={(e) => setReclassifyTarget(e.target.value)}>
              <option value="">— Select —</option>
              {accountOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.code} — {opt.name}</option>)}
            </select>
            <label className="text-[10px] font-semibold text-text-muted uppercase block mb-1">Memo (optional)</label>
            <input type="text" className="block-input text-xs w-full mb-3" value={reclassifyMemo} onChange={(e) => setReclassifyMemo(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="block-btn px-3 py-1 text-xs" onClick={() => setReclassifyOpen(false)}>Cancel</button>
              <button className="block-btn px-3 py-1 text-xs bg-accent-blue text-white" onClick={handleReclassify}>Create Reclassify JE</button>
            </div>
          </div>
        </div>
      )}

      <PrintReportFooter />
    </div>
  );
};

export default GeneralLedger;
