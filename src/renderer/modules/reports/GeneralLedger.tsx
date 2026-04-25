import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { Printer, Download, ChevronDown, ChevronRight, Search, Lock, Pencil, History, FileText, Flag, CheckSquare, HelpCircle, Mail, Link as LinkIcon, Scissors, Users, Save, Palette, Receipt } from 'lucide-react';
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
  signed_off_by?: string;
  signed_off_at?: string;
  flagged?: number;
  flag_reason?: string;
  question_flag?: number;
  approval_step?: number;
  is_credit_memo?: number;
  is_accountant_adj?: number;
  mention?: string;
}

// Row-level highlight rule (feature #20)
interface HighlightRule {
  id: string;
  field: 'amount' | 'description' | 'class';
  op: 'gt' | 'lt' | 'contains';
  value: string;
  color: string;  // hex
}

// Saved view template (feature #19)
interface SavedView {
  id: string;
  name: string;
  accountIds: string[];
  startDate: string;
  endDate: string;
  classFilter: string;
  drFilter: string;
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

  // Round-2 features
  const [onlyUnsigned, setOnlyUnsigned] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [showMatching, setShowMatching] = useState(false);
  const [showContras, setShowContras] = useState(false);
  const [subtotalEvery, setSubtotalEvery] = useState<number>(0); // 0=off, N=every N rows
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem('gl-saved-views') || '[]'); } catch { return []; }
  });
  const [highlightRules, setHighlightRules] = useState<HighlightRule[]>(() => {
    try { return JSON.parse(localStorage.getItem('gl-highlight-rules') || '[]'); } catch { return []; }
  });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [savedViewName, setSavedViewName] = useState('');
  const [splitFor, setSplitFor] = useState<GLTransaction | null>(null);
  const [splitDraft, setSplitDraft] = useState({ accountId: '', amount: 0 });
  const [combineFor, setCombineFor] = useState<GLTransaction | null>(null);
  const [drawerLine, setDrawerLine] = useState<GLTransaction | null>(null);
  const [drawerData, setDrawerData] = useState<{ audit: any[]; comments: any[]; sameDay: any[] } | null>(null);
  const [flagDraft, setFlagDraft] = useState<{ line: GLTransaction; reason: string; type: 'flag' | 'question' } | null>(null);

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
             IFNULL(jel.note,'') AS note,
             IFNULL(jel.signed_off_by,'') AS signed_off_by,
             IFNULL(jel.signed_off_at,'') AS signed_off_at,
             IFNULL(jel.flagged,0) AS flagged,
             IFNULL(jel.flag_reason,'') AS flag_reason,
             IFNULL(jel.question_flag,0) AS question_flag,
             IFNULL(jel.approval_step,0) AS approval_step,
             IFNULL(jel.is_credit_memo,0) AS is_credit_memo,
             IFNULL(jel.is_accountant_adj,0) AS is_accountant_adj,
             IFNULL(jel.mention,'') AS mention
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
            signed_off_by: row.signed_off_by || '',
            signed_off_at: row.signed_off_at || '',
            flagged: Number(row.flagged) || 0,
            flag_reason: row.flag_reason || '',
            question_flag: Number(row.question_flag) || 0,
            approval_step: Number(row.approval_step) || 0,
            is_credit_memo: Number(row.is_credit_memo) || 0,
            is_accountant_adj: Number(row.is_accountant_adj) || 0,
            mention: row.mention || '',
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
      if (onlyUnsigned) txns = txns.filter((t) => !t.signed_off_by);
      if (onlyFlagged) txns = txns.filter((t) => t.flagged || t.question_flag);
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        // Feature #24: invoice-number search — pattern like INV-xxx or numeric
        const looksLikeInvoice = /^(inv-?|#?)?\d+$/i.test(q.trim());
        txns = txns.filter((t) =>
          (t.description || '').toLowerCase().includes(q) ||
          (t.reference || '').toLowerCase().includes(q) ||
          (t.entry_number || '').toLowerCase().includes(q) ||
          (looksLikeInvoice && t.source_type && (t.source_id || '').toLowerCase().includes(q.replace(/\D/g, '')))
        );
      }
      return { ...acct, transactions: txns };
    }).filter((a) => a.transactions.length > 0 || selectedAccountIds.includes(a.account_id));
  }, [accounts, drFilter, searchText, selectedAccountIds, onlyUnsigned, onlyFlagged]);

  // Feature #16: GL transaction matching — pair lines with equal/opposite amounts in same JE
  const matchedPairs = useMemo(() => {
    if (!showMatching) return new Map<string, string>();
    const pairs = new Map<string, string>();
    const byEntry: Record<string, GLTransaction[]> = {};
    for (const a of filteredAccounts) for (const t of a.transactions) {
      (byEntry[t.entry_id] = byEntry[t.entry_id] || []).push(t);
    }
    for (const eid in byEntry) {
      const list = byEntry[eid];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (Math.abs(list[i].debit - list[j].credit) < 0.01 && list[i].debit > 0) {
            pairs.set(list[i].line_id, list[j].line_id);
            pairs.set(list[j].line_id, list[i].line_id);
          }
        }
      }
    }
    return pairs;
  }, [showMatching, filteredAccounts]);

  // Feature #20: row highlight color
  const highlightColorFor = useCallback((t: GLTransaction): string | undefined => {
    for (const rule of highlightRules) {
      let match = false;
      if (rule.field === 'amount') {
        const amt = t.debit + t.credit;
        const v = parseFloat(rule.value) || 0;
        if (rule.op === 'gt' && amt > v) match = true;
        if (rule.op === 'lt' && amt < v) match = true;
      } else if (rule.field === 'description') {
        if ((t.description || '').toLowerCase().includes(rule.value.toLowerCase())) match = true;
      } else if (rule.field === 'class') {
        if ((t.class || '').toLowerCase().includes(rule.value.toLowerCase())) match = true;
      }
      if (match) return rule.color;
    }
    return undefined;
  }, [highlightRules]);

  // Save highlight rules / saved views to localStorage
  useEffect(() => { localStorage.setItem('gl-highlight-rules', JSON.stringify(highlightRules)); }, [highlightRules]);
  useEffect(() => { localStorage.setItem('gl-saved-views', JSON.stringify(savedViews)); }, [savedViews]);

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

  // ── Round-2 line actions ───────────────────────────────────────
  const updateLineField = async (lineId: string, fields: Record<string, any>) => {
    const sets = Object.keys(fields).map((k) => `${k}=?`).join(', ');
    const params = [...Object.values(fields), lineId];
    try {
      await api.rawQuery(`UPDATE journal_entry_lines SET ${sets} WHERE id=?`, params);
      setAccounts((prev) => prev.map((a) => ({
        ...a,
        transactions: a.transactions.map((t) => t.line_id === lineId ? { ...t, ...fields } : t),
      })));
    } catch (err: any) { alert('Update failed: ' + (err?.message || err)); }
  };

  // Feature #17 sign-off
  const signOffLine = (t: GLTransaction) => {
    if (t.signed_off_by) updateLineField(t.line_id, { signed_off_by: '', signed_off_at: '' });
    else updateLineField(t.line_id, { signed_off_by: 'me', signed_off_at: new Date().toISOString() });
  };
  const bulkSignOff = () => {
    for (const id of selectedLineIds) updateLineField(id, { signed_off_by: 'me', signed_off_at: new Date().toISOString() });
    setSelectedLineIds(new Set());
  };

  // Feature #18 / #33 / #34 flag / question / approval-step
  const saveFlag = () => {
    if (!flagDraft) return;
    if (flagDraft.type === 'flag') updateLineField(flagDraft.line.line_id, { flagged: 1, flag_reason: flagDraft.reason });
    else updateLineField(flagDraft.line.line_id, { question_flag: 1, flag_reason: flagDraft.reason });
    setFlagDraft(null);
  };
  const clearFlag = (t: GLTransaction) => updateLineField(t.line_id, { flagged: 0, question_flag: 0, flag_reason: '' });
  const advanceApproval = (t: GLTransaction) => updateLineField(t.line_id, { approval_step: Math.min(3, (t.approval_step || 0) + 1) });

  // Feature #27 credit-memo
  const toggleCreditMemo = (t: GLTransaction) => updateLineField(t.line_id, { is_credit_memo: t.is_credit_memo ? 0 : 1 });
  // Feature #35 accountant-adj
  const toggleAccountantAdj = (t: GLTransaction) => updateLineField(t.line_id, { is_accountant_adj: t.is_accountant_adj ? 0 : 1 });

  // Feature #28 transaction reversal
  const reverseLine = async (t: GLTransaction) => {
    if (!activeCompany) return;
    if (!confirm(`Create offsetting JE to reverse line ${t.entry_number} (${formatCurrency(t.amount)})?`)) return;
    try {
      const dateStr = format(new Date(), 'yyyy-MM-dd');
      const entryNo = `REV-${Date.now().toString().slice(-6)}`;
      const er = await api.create('journal_entries', {
        company_id: activeCompany.id, entry_number: entryNo, date: dateStr,
        description: `Reversal of ${t.entry_number}`, reference: 'GL-Reverse', is_posted: 1,
      });
      const eid = er?.id || er;
      await api.create('journal_entry_lines', {
        journal_entry_id: eid, account_id: t.account_id,
        debit: t.credit, credit: t.debit, description: 'Reversal',
      });
      setRefreshTick((tk) => tk + 1);
      window.dispatchEvent(new CustomEvent('je:posted'));
    } catch (err: any) { alert('Reversal failed: ' + (err?.message || err)); }
  };

  // Feature #25 split
  const doSplit = async () => {
    if (!splitFor || !splitDraft.accountId || splitDraft.amount <= 0) return;
    try {
      const orig = splitFor;
      const newAmt = splitDraft.amount;
      const remaining = orig.amount - newAmt;
      if (remaining <= 0) { alert('Split amount must be less than original'); return; }
      // update original to remaining
      if (orig.type === 'debit') await api.rawQuery(`UPDATE journal_entry_lines SET debit=? WHERE id=?`, [remaining, orig.line_id]);
      else await api.rawQuery(`UPDATE journal_entry_lines SET credit=? WHERE id=?`, [remaining, orig.line_id]);
      // create new line on same JE for split account
      await api.create('journal_entry_lines', {
        journal_entry_id: orig.entry_id, account_id: splitDraft.accountId,
        debit: orig.type === 'debit' ? newAmt : 0, credit: orig.type === 'credit' ? newAmt : 0,
        description: `Split from ${orig.description}`,
      });
      setSplitFor(null); setSplitDraft({ accountId: '', amount: 0 });
      setRefreshTick((tk) => tk + 1);
      window.dispatchEvent(new CustomEvent('je:posted'));
    } catch (err: any) { alert('Split failed: ' + (err?.message || err)); }
  };

  // Feature #26 combine — merge selected (must be 2 on same JE+account)
  const doCombine = async () => {
    const sel = flatLines.filter((l) => selectedLineIds.has(l.line_id));
    if (sel.length !== 2) { alert('Select exactly 2 lines on same JE/account'); return; }
    if (sel[0].entry_id !== sel[1].entry_id || sel[0].account_id !== sel[1].account_id) {
      alert('Lines must be on same journal entry and account'); return;
    }
    try {
      const totalD = sel[0].debit + sel[1].debit;
      const totalC = sel[0].credit + sel[1].credit;
      await api.rawQuery(`UPDATE journal_entry_lines SET debit=?, credit=? WHERE id=?`, [totalD, totalC, sel[0].line_id]);
      await api.remove('journal_entry_lines', sel[1].line_id);
      setSelectedLineIds(new Set());
      setRefreshTick((tk) => tk + 1);
      window.dispatchEvent(new CustomEvent('je:posted'));
    } catch (err: any) { alert('Combine failed: ' + (err?.message || err)); }
  };

  // Feature #23 sub-ledger drill (double-click)
  const drillSubLedger = (t: GLTransaction) => {
    if (!t.source_type || !t.source_id) { alert('No sub-ledger source linked'); return; }
    useAppStore.getState().setFocusEntity({ type: t.source_type, id: t.source_id });
    const map: Record<string, string> = { invoice: 'invoices', bill: 'bills', payment: 'payments' };
    useAppStore.getState().setModule(map[t.source_type] || 'invoices');
  };

  // Feature #29 print check stub
  const printCheckStub = async (t: GLTransaction) => {
    if (!t.source_type) { alert('No source linked'); return; }
    const html = `<html><head><style>body{font-family:system-ui;padding:32px;}.stub{border:1px solid #999;padding:16px;width:520px;}h2{margin:0 0 12px 0;}td{padding:4px 8px;}</style></head><body>
      <div class="stub">
        <h2>Check Stub</h2>
        <table>
          <tr><td><b>Date:</b></td><td>${t.date}</td></tr>
          <tr><td><b>Entry #:</b></td><td>${t.entry_number}</td></tr>
          <tr><td><b>Description:</b></td><td>${t.description}</td></tr>
          <tr><td><b>Account:</b></td><td>${t.account_code} ${t.account_name}</td></tr>
          <tr><td><b>Reference:</b></td><td>${t.reference || ''}</td></tr>
          <tr><td><b>Source:</b></td><td>${t.source_type}:${t.source_id}</td></tr>
          <tr><td><b>Amount:</b></td><td>${formatCurrency(t.amount)} ${t.type === 'debit' ? 'Dr' : 'Cr'}</td></tr>
        </table>
      </div></body></html>`;
    try { await api.printPreview(html, `Check Stub ${t.entry_number}`); } catch { window.print(); }
  };

  // Feature #30 detail drawer
  const openDrawer = async (t: GLTransaction) => {
    setDrawerLine(t);
    if (!activeCompany) return;
    try {
      const audit: any[] = await api.rawQuery(
        `SELECT * FROM audit_log WHERE entity_type='journal_entry' AND entity_id=? ORDER BY created_at DESC LIMIT 50`,
        [t.entry_id]
      ).catch(() => []);
      const comments: any[] = await api.rawQuery(
        `SELECT * FROM je_comments WHERE journal_entry_id=? ORDER BY created_at DESC LIMIT 50`,
        [t.entry_id]
      ).catch(() => []);
      const sameDay: any[] = await api.rawQuery(
        `SELECT id, entry_number, description FROM journal_entries
          WHERE company_id=? AND date=? AND id<>? LIMIT 25`,
        [activeCompany.id, t.date, t.entry_id]
      ).catch(() => []);
      setDrawerData({ audit: audit || [], comments: comments || [], sameDay: sameDay || [] });
    } catch { setDrawerData({ audit: [], comments: [], sameDay: [] }); }
  };

  // Feature #31 email selected
  const emailSelected = () => {
    const sel = flatLines.filter((l) => selectedLineIds.has(l.line_id));
    if (sel.length === 0) return;
    const csv = ['Date,Entry,Account,Description,Debit,Credit'].concat(
      sel.map((t) => `${t.date},${t.entry_number},"${t.account_name}","${(t.description || '').replace(/"/g, '""')}",${t.debit},${t.credit}`)
    ).join('%0D%0A');
    const subject = `GL lines export (${sel.length})`;
    const body = `Selected GL lines:%0D%0A%0D%0A${csv}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;
  };

  // Feature #32 mention
  const setMention = (t: GLTransaction) => {
    const m = prompt('Mention (e.g. @alex review this):', t.mention || '');
    if (m == null) return;
    updateLineField(t.line_id, { mention: m });
  };

  // Feature #19 saved view templates
  const saveCurrentView = () => {
    const name = savedViewName.trim();
    if (!name) return;
    setSavedViews((prev) => [...prev, {
      id: `sv-${Date.now()}`, name,
      accountIds: selectedAccountIds, startDate, endDate, classFilter, drFilter,
    }]);
    setSavedViewName('');
  };
  const loadView = (sv: SavedView) => {
    setSelectedAccountIds(sv.accountIds);
    setStartDate(sv.startDate); setEndDate(sv.endDate);
    setClassFilter(sv.classFilter); setDrFilter(sv.drFilter as any);
    setPreset('custom');
  };
  const deleteView = (id: string) => setSavedViews((prev) => prev.filter((v) => v.id !== id));

  // Feature #21 contras: when one account is selected, auto-include accounts paired with it on same JEs
  useEffect(() => {
    if (!showContras || !activeCompany || selectedAccountIds.length !== 1) return;
    const aid = selectedAccountIds[0];
    api.rawQuery(
      `SELECT DISTINCT jel2.account_id AS id
         FROM journal_entry_lines jel
         JOIN journal_entry_lines jel2 ON jel2.journal_entry_id = jel.journal_entry_id AND jel2.account_id <> jel.account_id
         JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE jel.account_id = ? AND je.company_id=? AND je.date>=? AND je.date<=? AND je.is_posted=1
        LIMIT 25`,
      [aid, activeCompany.id, startDate, endDate]
    ).then((rows: any[]) => {
      const contraIds = (rows ?? []).map((r) => r.id);
      const merged = Array.from(new Set([aid, ...contraIds]));
      // avoid loop: only set if changed
      if (merged.length !== selectedAccountIds.length) setSelectedAccountIds(merged);
    }).catch(() => {});
  }, [showContras, activeCompany?.id, JSON.stringify(selectedAccountIds), startDate, endDate]);

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
            <button className="block-btn px-3 py-1 text-xs" onClick={bulkSignOff} title="Sign off selected">Sign-off</button>
            <button className="block-btn px-3 py-1 text-xs" onClick={doCombine} title="Combine 2 lines (same JE+account)">Combine</button>
            <button className="block-btn px-3 py-1 text-xs" onClick={emailSelected} title="Email selected as CSV"><Mail size={11} className="inline" /> Email</button>
            <button className="text-text-muted text-xs" onClick={() => setSelectedLineIds(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {/* Round-2 toggles + saved views + highlight rules */}
      <div className="block-card p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]" style={{ borderRadius: '6px' }}>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={onlyUnsigned} onChange={(e) => setOnlyUnsigned(e.target.checked)} />
          Only unsigned
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          Only flagged/?
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showMatching} onChange={(e) => setShowMatching(e.target.checked)} />
          Show matching pairs
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showContras} onChange={(e) => setShowContras(e.target.checked)} />
          Auto-include contras
        </label>
        <label className="flex items-center gap-1.5">
          Subtotal every:
          <select className="block-select text-xs" style={{ width: '80px' }} value={subtotalEvery} onChange={(e) => setSubtotalEvery(parseInt(e.target.value, 10) || 0)}>
            <option value="0">off</option>
            <option value="10">10 rows</option>
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
          </select>
        </label>
        <span className="ml-auto flex items-center gap-2">
          <input type="text" placeholder="Save view as…" className="block-input text-xs" style={{ width: '140px' }} value={savedViewName} onChange={(e) => setSavedViewName(e.target.value)} />
          <button className="block-btn px-2 py-0.5 text-xs" onClick={saveCurrentView}><Save size={10} className="inline" /> Save</button>
          {savedViews.length > 0 && (
            <select className="block-select text-xs" style={{ width: '160px' }} value="" onChange={(e) => {
              if (!e.target.value) return;
              if (e.target.value.startsWith('del:')) deleteView(e.target.value.slice(4));
              else { const v = savedViews.find((x) => x.id === e.target.value); if (v) loadView(v); }
            }}>
              <option value="">— Load view —</option>
              {savedViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              <option disabled>──────</option>
              {savedViews.map((v) => <option key={'d'+v.id} value={`del:${v.id}`}>Delete: {v.name}</option>)}
            </select>
          )}
          <button className="block-btn px-2 py-0.5 text-xs" onClick={() => setRulesOpen(true)} title="Highlight rules"><Palette size={10} className="inline" /> Rules</button>
        </span>
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
                          const hlColor = highlightColorFor(txn);
                          const subtotalDivider = subtotalEvery > 0 && idx > 0 && idx % subtotalEvery === 0;
                          const matched = matchedPairs.get(txn.line_id);
                          const rowStyle: React.CSSProperties = hlColor ? { background: hlColor + '33' } : {};
                          const approvalLabels = ['', 'Initial', 'Senior', 'Approved'];
                          return (
                            <React.Fragment key={txn.line_id}>
                              {subtotalDivider && (
                                <tr style={{ background: 'rgba(0,0,0,0.15)' }}>
                                  <td colSpan={10} className="py-1 px-4 text-[10px] text-text-muted uppercase tracking-wider text-right">
                                    Subtotal at row {idx}: Dr {formatCurrency(acct.transactions.slice(0, idx).reduce((s, t) => s + t.debit, 0))} · Cr {formatCurrency(acct.transactions.slice(0, idx).reduce((s, t) => s + t.credit, 0))}
                                  </td>
                                </tr>
                              )}
                              <tr
                                style={rowStyle}
                                onDoubleClick={() => drillSubLedger(txn)}
                                className={`${selected ? 'bg-accent-blue/5' : ''} ${isKbd ? 'outline outline-1 outline-accent-blue' : ''} ${!txn.is_posted ? 'opacity-60' : ''} ${txn.is_credit_memo ? 'text-accent-expense' : ''}`}>
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
                                {txn.is_credit_memo ? <span className="ml-1 text-[9px] bg-accent-expense/20 text-accent-expense px-1 rounded">CM</span> : null}
                                {txn.is_accountant_adj ? <span className="ml-1 text-[9px] bg-accent-blue/20 text-accent-blue px-1 rounded">ACC</span> : null}
                                {matched && <LinkIcon size={10} className="inline ml-1 text-accent-income" />}
                              </td>
                              <td className="text-text-secondary text-xs">
                                {txn.description || '—'}
                                {txn.note && <span className="block text-[10px] text-accent-blue italic mt-0.5">📝 {txn.note}</span>}
                                {txn.flag_reason && <span className="block text-[10px] text-accent-expense italic mt-0.5" title={txn.flag_reason}>🚩 {txn.flag_reason}</span>}
                                {txn.mention && <span className="block text-[10px] text-accent-blue mt-0.5">@ {txn.mention}</span>}
                                {(txn.approval_step || 0) > 0 && <span className="block text-[10px] text-accent-income mt-0.5">✓ {approvalLabels[txn.approval_step || 0]}</span>}
                              </td>
                              <td className="text-xs">
                                {txn.source_type && txn.source_id
                                  ? <EntityChip type={txn.source_type} id={txn.source_id} variant="inline" label={txn.source_type} />
                                  : <span className="text-text-muted">—</span>}
                              </td>
                              <td className="text-text-muted text-xs">{txn.reference || '—'}</td>
                              <td className="text-right font-mono text-xs">
                                {txn.debit > 0 ? <span className={txn.is_credit_memo ? 'text-accent-expense' : 'text-text-primary'}>{formatCurrency(txn.debit)}</span> : <span className="text-text-muted">—</span>}
                              </td>
                              <td className="text-right font-mono text-xs">
                                {txn.credit > 0 ? <span className={txn.is_credit_memo ? 'text-accent-expense' : 'text-text-primary'}>{formatCurrency(txn.credit)}</span> : <span className="text-text-muted">—</span>}
                              </td>
                              <td className={`text-right font-mono font-semibold text-xs ${(txn.running_balance ?? 0) < 0 ? 'text-accent-expense' : 'text-text-primary'}`}>
                                <span className={(txn.running_balance ?? 0) < 0 ? 'acc-neg' : ''}>{formatCurrency(Math.abs(txn.running_balance ?? 0))}</span>
                              </td>
                              <td className="text-right whitespace-nowrap">
                                <button title="Detail drawer" className="p-1 text-text-muted hover:text-accent-blue" onClick={(e) => { e.stopPropagation(); openDrawer(txn); }}><FileText size={11} /></button>
                                <button title="Add/edit note" className="p-1 text-text-muted hover:text-accent-blue" onClick={(e) => { e.stopPropagation(); setEditingNoteFor(txn); setNoteDraft(txn.note || ''); }}>
                                  <Pencil size={11} />
                                </button>
                                <button title={txn.signed_off_by ? `Signed off ${txn.signed_off_at}` : 'Sign off'} className={`p-1 ${txn.signed_off_by ? 'text-accent-income' : 'text-text-muted hover:text-accent-income'}`} onClick={(e) => { e.stopPropagation(); signOffLine(txn); }}>
                                  <CheckSquare size={11} />
                                </button>
                                <button title={txn.flagged ? `Flagged: ${txn.flag_reason} (click to clear)` : 'Flag for follow-up'} className={`p-1 ${txn.flagged ? 'text-accent-expense' : 'text-text-muted hover:text-accent-expense'}`} onClick={(e) => { e.stopPropagation(); if (txn.flagged) clearFlag(txn); else setFlagDraft({ line: txn, reason: '', type: 'flag' }); }}>
                                  <Flag size={11} />
                                </button>
                                <button title={txn.question_flag ? 'Clear question' : 'Mark needs review'} className={`p-1 ${txn.question_flag ? 'text-accent-expense' : 'text-text-muted hover:text-accent-expense'}`} onClick={(e) => { e.stopPropagation(); if (txn.question_flag) clearFlag(txn); else setFlagDraft({ line: txn, reason: '', type: 'question' }); }}>
                                  <HelpCircle size={11} />
                                </button>
                                <button title={`Approval step ${txn.approval_step || 0} of 3 — click to advance`} className="p-1 text-text-muted hover:text-accent-income" onClick={(e) => { e.stopPropagation(); advanceApproval(txn); }}>
                                  <Users size={11} />
                                </button>
                                <button title="Toggle credit-memo" className={`p-1 ${txn.is_credit_memo ? 'text-accent-expense' : 'text-text-muted'}`} onClick={(e) => { e.stopPropagation(); toggleCreditMemo(txn); }}>
                                  CM
                                </button>
                                <button title="Toggle accountant adjustment" className={`p-1 text-[10px] ${txn.is_accountant_adj ? 'text-accent-blue' : 'text-text-muted'}`} onClick={(e) => { e.stopPropagation(); toggleAccountantAdj(txn); }}>
                                  ACC
                                </button>
                                <button title="Mention/notify" className="p-1 text-text-muted hover:text-accent-blue" onClick={(e) => { e.stopPropagation(); setMention(txn); }}>@</button>
                                <button title="Split line" className="p-1 text-text-muted hover:text-accent-blue" onClick={(e) => { e.stopPropagation(); setSplitFor(txn); setSplitDraft({ accountId: '', amount: 0 }); }}>
                                  <Scissors size={11} />
                                </button>
                                <button title="Reverse" className="p-1 text-text-muted hover:text-accent-expense" onClick={(e) => { e.stopPropagation(); reverseLine(txn); }}>↺</button>
                                <button title="Print check stub" className="p-1 text-text-muted hover:text-accent-blue" onClick={(e) => { e.stopPropagation(); printCheckStub(txn); }}>
                                  <Receipt size={11} />
                                </button>
                                {auditLines.has(txn.entry_id) && (
                                  <span title="Audit history" className="ml-1 text-text-muted"><History size={11} className="inline" /></span>
                                )}
                              </td>
                            </tr>
                            </React.Fragment>
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

      {/* Split modal */}
      {splitFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSplitFor(null)}>
          <div className="block-card p-4 w-[440px]" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">Split Line</h3>
            <p className="text-xs text-text-muted mb-3">Split {formatCurrency(splitFor.amount)} from {splitFor.account_name} into another account on the same JE.</p>
            <label className="text-[10px] font-semibold uppercase block mb-1">Other account</label>
            <select className="block-select text-xs w-full mb-3" value={splitDraft.accountId} onChange={(e) => setSplitDraft({ ...splitDraft, accountId: e.target.value })}>
              <option value="">— Select —</option>
              {accountOptions.filter((o) => o.id !== splitFor.account_id).map((o) => <option key={o.id} value={o.id}>{o.code} {o.name}</option>)}
            </select>
            <label className="text-[10px] font-semibold uppercase block mb-1">Amount to move</label>
            <input type="number" className="block-input text-xs w-full mb-3" value={splitDraft.amount || ''} onChange={(e) => setSplitDraft({ ...splitDraft, amount: parseFloat(e.target.value) || 0 })} />
            <div className="flex justify-end gap-2">
              <button className="block-btn px-3 py-1 text-xs" onClick={() => setSplitFor(null)}>Cancel</button>
              <button className="block-btn px-3 py-1 text-xs bg-accent-blue text-white" onClick={doSplit}>Split</button>
            </div>
          </div>
        </div>
      )}

      {/* Flag/Question modal */}
      {flagDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setFlagDraft(null)}>
          <div className="block-card p-4 w-[420px]" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">{flagDraft.type === 'flag' ? 'Flag for follow-up' : 'Mark needs accountant review'}</h3>
            <p className="text-xs text-text-muted mb-2">Entry {flagDraft.line.entry_number} — {flagDraft.line.account_name}</p>
            <textarea className="block-input w-full text-xs" rows={3} value={flagDraft.reason} onChange={(e) => setFlagDraft({ ...flagDraft, reason: e.target.value })} placeholder="Reason / question" autoFocus />
            <div className="flex justify-end gap-2 mt-3">
              <button className="block-btn px-3 py-1 text-xs" onClick={() => setFlagDraft(null)}>Cancel</button>
              <button className="block-btn px-3 py-1 text-xs bg-accent-blue text-white" onClick={saveFlag}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Highlight rules modal */}
      {rulesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRulesOpen(false)}>
          <div className="block-card p-4 w-[560px]" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">Row Highlight Rules</h3>
            <p className="text-xs text-text-muted mb-3">Stored locally. Earlier rules win.</p>
            <table className="block-table text-xs mb-3">
              <thead><tr><th>Field</th><th>Op</th><th>Value</th><th>Color</th><th></th></tr></thead>
              <tbody>
                {highlightRules.map((r, i) => (
                  <tr key={r.id}>
                    <td><select className="block-select text-xs" value={r.field} onChange={(e) => { const v = [...highlightRules]; v[i] = { ...v[i], field: e.target.value as any }; setHighlightRules(v); }}>
                      <option value="amount">amount</option><option value="description">description</option><option value="class">class</option>
                    </select></td>
                    <td><select className="block-select text-xs" value={r.op} onChange={(e) => { const v = [...highlightRules]; v[i] = { ...v[i], op: e.target.value as any }; setHighlightRules(v); }}>
                      <option value="gt">&gt;</option><option value="lt">&lt;</option><option value="contains">contains</option>
                    </select></td>
                    <td><input className="block-input text-xs" value={r.value} onChange={(e) => { const v = [...highlightRules]; v[i] = { ...v[i], value: e.target.value }; setHighlightRules(v); }} /></td>
                    <td><input type="color" value={r.color} onChange={(e) => { const v = [...highlightRules]; v[i] = { ...v[i], color: e.target.value }; setHighlightRules(v); }} /></td>
                    <td><button className="text-accent-expense" onClick={() => setHighlightRules(highlightRules.filter((x) => x.id !== r.id))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="block-btn px-3 py-1 text-xs" onClick={() => setHighlightRules([...highlightRules, { id: `r-${Date.now()}`, field: 'amount', op: 'gt', value: '5000', color: '#ef4444' }])}>+ Add rule</button>
            <div className="flex justify-end mt-3"><button className="block-btn px-3 py-1 text-xs" onClick={() => setRulesOpen(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {drawerLine && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50" onClick={() => { setDrawerLine(null); setDrawerData(null); }}>
          <div className="block-card p-4 w-[420px] h-full overflow-auto" style={{ borderRadius: '0' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">Line Detail</h3>
            <p className="text-xs text-text-muted mb-3">{drawerLine.entry_number} — {drawerLine.date} — {drawerLine.account_name}</p>
            <div className="text-xs mb-3">
              <div>Description: {drawerLine.description}</div>
              <div>Amount: {formatCurrency(drawerLine.amount)} {drawerLine.type === 'debit' ? 'Dr' : 'Cr'}</div>
              <div>Reference: {drawerLine.reference || '—'}</div>
              {drawerLine.signed_off_by && <div className="text-accent-income">✓ Signed off {drawerLine.signed_off_at}</div>}
            </div>
            <h4 className="text-[11px] font-bold uppercase text-text-muted mb-1">Audit Log ({drawerData?.audit.length || 0})</h4>
            <div className="text-xs space-y-1 mb-3">
              {(drawerData?.audit || []).slice(0, 10).map((a) => <div key={a.id} className="text-text-muted">{a.action} — {a.created_at} — {a.user_id || 'system'}</div>)}
              {(!drawerData || drawerData.audit.length === 0) && <span className="text-text-muted italic">No audit entries</span>}
            </div>
            <h4 className="text-[11px] font-bold uppercase text-text-muted mb-1">Comments ({drawerData?.comments.length || 0})</h4>
            <div className="text-xs space-y-1 mb-3">
              {(drawerData?.comments || []).map((c) => <div key={c.id}>{c.body}</div>)}
              {(!drawerData || drawerData.comments.length === 0) && <span className="text-text-muted italic">No comments</span>}
            </div>
            <h4 className="text-[11px] font-bold uppercase text-text-muted mb-1">Other JEs that day ({drawerData?.sameDay.length || 0})</h4>
            <div className="text-xs space-y-1">
              {(drawerData?.sameDay || []).map((s) => <div key={s.id}>{s.entry_number}: {s.description}</div>)}
              {(!drawerData || drawerData.sameDay.length === 0) && <span className="text-text-muted italic">None</span>}
            </div>
            <div className="flex justify-end mt-3"><button className="block-btn px-3 py-1 text-xs" onClick={() => { setDrawerLine(null); setDrawerData(null); }}>Close</button></div>
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
