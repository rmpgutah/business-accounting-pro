import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  X, Save, Plus, Trash2, Loader2, AlertTriangle, Wand2, RotateCcw,
  Repeat, Paperclip, MessageSquare, GripVertical, Calculator,
  Eye, History, Lock, FileText, ListPlus,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import { roundCents, formatCurrency } from '../../lib/format';
import { JE_TEMPLATES, findAccountByHint } from '../../lib/je-templates';
import {
  resolveTemplateString, computeScheduleDates, detectAndSplit,
  buildBalanceSuggestions, rememberBalancer, generateJeCoverSheetHTML,
} from '../../lib/je-helpers';

// ─── Types ──────────────────────────────────────────────
interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface LineItem {
  key: string; // local key for React
  account_id: string;
  debit: string;
  credit: string;
  description: string;
  is_locked?: boolean;
}

interface JournalEntry {
  id: string;
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  is_posted: number;
  is_recurring?: number;
  is_reversing?: number;
  reverse_on_date?: string | null;
  approval_status?: string;
  class?: string;
  source_type?: string;
  source_id?: string;
  recurring_template_id?: string | null;
}

interface JournalEntryFormProps {
  entry: JournalEntry | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

// ─── Helpers ────────────────────────────────────────────
let keyCounter = 0;
const nextKey = () => `line_${++keyCounter}`;

const emptyLine = (): LineItem => ({
  key: nextKey(),
  account_id: '',
  debit: '',
  credit: '',
  description: '',
});

// Inline calculator: accept "=120+50*1.08" expressions; evaluate safely (digits + operators only).
const evalExpr = (val: string): string => {
  const trimmed = (val || '').trim();
  if (!trimmed.startsWith('=')) return val;
  const expr = trimmed.slice(1).replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(expr)) return val;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${expr});`)();
    if (typeof v === 'number' && Number.isFinite(v)) return String(roundCents(v));
  } catch { /* fall through */ }
  return val;
};

const parseAmount = (val: string): number => {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : roundCents(n);
};

// localStorage key per company+entry-id (or 'new')
const draftKey = (companyId: string, entryId: string | null) =>
  `je-draft:${companyId}:${entryId ?? 'new'}`;

const lastAccountsKey = (userId: string, companyId: string) =>
  `je-last-accounts:${userId}:${companyId}`;

const recordRecentAccount = (userId: string, companyId: string, accountId: string) => {
  if (!accountId) return;
  try {
    const k = lastAccountsKey(userId, companyId);
    const cur: string[] = JSON.parse(localStorage.getItem(k) || '[]');
    const next = [accountId, ...cur.filter((a) => a !== accountId)].slice(0, 5);
    localStorage.setItem(k, JSON.stringify(next));
  } catch { /* ignore */ }
};

const getRecentAccounts = (userId: string, companyId: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(lastAccountsKey(userId, companyId)) || '[]');
  } catch { return []; }
};

// ─── Component ──────────────────────────────────────────
const JournalEntryForm: React.FC<JournalEntryFormProps> = ({
  entry,
  onClose,
  onSaved,
}) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const isEdit = entry !== null;
  const isLocked = isEdit && entry?.is_posted === 1;

  const [date, setDate] = useState(
    entry?.date ?? new Date().toISOString().slice(0, 10)
  );
  const [description, setDescription] = useState(entry?.description ?? '');
  const [reference, setReference] = useState(entry?.reference ?? '');
  const [klass, setKlass] = useState(entry?.class ?? '');
  const [lines, setLines] = useState<LineItem[]>([emptyLine(), emptyLine()]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [entryNumber, setEntryNumber] = useState<string>(entry?.entry_number ?? '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Feature toggles
  const [isRecurring, setIsRecurring] = useState<boolean>(entry?.is_recurring === 1);
  const [recurFrequency, setRecurFrequency] = useState<'weekly'|'biweekly'|'monthly'|'quarterly'|'annually'>('monthly');
  const [isReversing, setIsReversing] = useState<boolean>(entry?.is_reversing === 1);
  const [reverseOnDate, setReverseOnDate] = useState<string>(entry?.reverse_on_date ?? '');

  const [referenceSuggestions, setReferenceSuggestions] = useState<string[]>([]);
  const [showRefSuggestions, setShowRefSuggestions] = useState(false);

  // Comments + attachments (only meaningful when editing)
  const [comments, setComments] = useState<Array<{ id: string; body: string; user_id: string; created_at: string }>>([]);
  const [newComment, setNewComment] = useState('');
  const [docs, setDocs] = useState<Array<{ id: string; filename: string; file_path: string }>>([]);
  // Round 2 state
  const [showPreview, setShowPreview] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; version: number; changed_at: string; changed_by: string }>>([]);
  const [otherEntries, setOtherEntries] = useState<Array<{ id: string; entry_number: string; date: string; description: string }>>([]);
  const [balanceSuggestions, setBalanceSuggestions] = useState<Array<{ label: string; account_id: string; account_label: string; side: 'debit'|'credit'; amount: number }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sourceDoc, setSourceDoc] = useState<any>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string>('');

  // Drag/drop reorder
  const dragKey = useRef<string | null>(null);

  // Fetch next entry number for new entries
  useEffect(() => {
    if (isEdit) return;
    api.nextJournalNumber().then(setEntryNumber).catch(() => setEntryNumber('JE-1001'));
  }, [isEdit]);

  // Load accounts
  useEffect(() => {
    if (!activeCompany) return;
    api.query('accounts', { company_id: activeCompany.id, is_active: true })
      .then((data: any) => {
        if (Array.isArray(data)) {
          setAccounts(
            data.map((a: any) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))
              .sort((a: AccountOption, b: AccountOption) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
              )
          );
        }
      })
      .catch((err) => console.error('Failed to load accounts:', err));
  }, [activeCompany]);

  // Load existing lines / comments / docs when editing
  useEffect(() => {
    if (!entry) return;
    api.query('journal_entry_lines', { journal_entry_id: entry.id })
      .then((data: any) => {
        if (Array.isArray(data) && data.length > 0) {
          const sorted = data.slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          setLines(sorted.map((l: any) => ({
            key: nextKey(),
            account_id: l.account_id ?? '',
            debit: l.debit ? String(l.debit) : '',
            credit: l.credit ? String(l.credit) : '',
            description: l.description ?? l.line_memo ?? '',
            is_locked: !!l.is_locked,
          })));
        }
      })
      .catch((err) => console.error('Failed to load entry lines:', err));

    api.query('je_comments', { journal_entry_id: entry.id })
      .then((data: any) => { if (Array.isArray(data)) setComments(data); })
      .catch(() => {});

    api.query('documents', { entity_type: 'journal_entry', entity_id: entry.id })
      .then((data: any) => { if (Array.isArray(data)) setDocs(data); })
      .catch(() => {});

    // F12: source-doc inline preview
    if (entry.source_type && entry.source_id) {
      const tbl = entry.source_type === 'invoice' ? 'invoices'
        : entry.source_type === 'bill' ? 'bills'
        : entry.source_type === 'expense' ? 'expenses' : null;
      if (tbl) {
        api.get(tbl, entry.source_id).then((d: any) => { if (d) setSourceDoc({ ...d, _table: tbl }); }).catch(() => {});
      }
    }

    // F23: version history
    api.jeHistoryList(entry.id).then((v: any) => { if (Array.isArray(v)) setVersions(v); }).catch(() => {});
  }, [entry]);

  // F10: load other entries for copy-lines picker
  useEffect(() => {
    if (!activeCompany || !showCopyPicker) return;
    api.query('journal_entries', { company_id: activeCompany.id }).then((d: any) => {
      if (Array.isArray(d)) {
        setOtherEntries(d.filter((e: any) => !entry || e.id !== entry.id)
          .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, 200));
      }
    }).catch(() => {});
  }, [activeCompany, showCopyPicker, entry]);

  // F26: same-day duplicate detection
  useEffect(() => {
    if (!activeCompany || !user || !date || !description.trim()) { setDuplicateWarning(''); return; }
    const totalD = lines.reduce((s, l) => s + parseAmount(l.debit), 0);
    if (totalD <= 0) { setDuplicateWarning(''); return; }
    const t = setTimeout(() => {
      api.rawQuery(
        `SELECT je.id, je.entry_number,
           (SELECT COALESCE(SUM(debit),0) FROM journal_entry_lines WHERE journal_entry_id = je.id) AS td
         FROM journal_entries je
         WHERE je.company_id = ? AND je.date = ? AND je.description = ? AND je.created_by = ? AND je.id != ?
         LIMIT 1`,
        [activeCompany.id, date, description.trim(), user.id, entry?.id || '']
      ).then((rows: any) => {
        if (Array.isArray(rows) && rows.length && Math.abs(rows[0].td - totalD) < 0.005) {
          setDuplicateWarning(`Possible duplicate of ${rows[0].entry_number}`);
        } else {
          setDuplicateWarning('');
        }
      }).catch(() => setDuplicateWarning(''));
    }, 700);
    return () => clearTimeout(t);
  }, [activeCompany, user, date, description, lines, entry]);

  // Reference autocomplete: fetch distinct references from prior entries
  useEffect(() => {
    if (!activeCompany) return;
    api.rawQuery(
      `SELECT DISTINCT reference FROM journal_entries WHERE company_id = ? AND reference IS NOT NULL AND reference <> '' ORDER BY date DESC LIMIT 100`,
      [activeCompany.id]
    ).then((data: any) => {
      if (Array.isArray(data)) setReferenceSuggestions(data.map((r: any) => r.reference).filter(Boolean));
    }).catch(() => {});
  }, [activeCompany]);

  // ─── Auto-save draft (every 5s) ─────────────────────
  useEffect(() => {
    if (!activeCompany || isLocked) return;
    const k = draftKey(activeCompany.id, entry?.id ?? null);
    const handle = setInterval(() => {
      try {
        localStorage.setItem(k, JSON.stringify({
          date, description, reference, klass, lines, isRecurring,
          recurFrequency, isReversing, reverseOnDate, entryNumber,
          savedAt: Date.now(),
        }));
      } catch { /* quota — ignore */ }
    }, 5000);
    return () => clearInterval(handle);
  }, [activeCompany, entry, date, description, reference, klass, lines, isRecurring, recurFrequency, isReversing, reverseOnDate, entryNumber, isLocked]);

  // Restore draft once on mount when creating a new entry
  useEffect(() => {
    if (!activeCompany || isEdit) return;
    try {
      const raw = localStorage.getItem(draftKey(activeCompany.id, null));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.lines) || d.lines.length === 0) return;
      if (!window.confirm('Resume your unsaved draft from last session?')) {
        localStorage.removeItem(draftKey(activeCompany.id, null));
        return;
      }
      setDate(d.date ?? new Date().toISOString().slice(0, 10));
      setDescription(d.description ?? '');
      setReference(d.reference ?? '');
      setKlass(d.klass ?? '');
      setLines(d.lines);
      setIsRecurring(!!d.isRecurring);
      setRecurFrequency(d.recurFrequency ?? 'monthly');
      setIsReversing(!!d.isReversing);
      setReverseOnDate(d.reverseOnDate ?? '');
      if (d.entryNumber) setEntryNumber(d.entryNumber);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Line Item Handlers ─────────────────────────────
  const updateLine = (key: string, field: keyof LineItem, value: string) => {
    setLines((prev) => prev.map((line) => {
      if (line.key !== key) return line;
      if (line.is_locked) return line; // F20: locked
      const updated = { ...line, [field]: value };
      if (field === 'debit' && value) updated.credit = '';
      else if (field === 'credit' && value) updated.debit = '';
      return updated;
    }));
  };

  const handleAmountBlur = (key: string, field: 'debit'|'credit', value: string) => {
    const evaluated = evalExpr(value);
    if (evaluated !== value) updateLine(key, field, evaluated);
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (key: string) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  // F18: Multi-line paste — auto-detect CSV / TSV / multi-space
  const handlePaste = (e: React.ClipboardEvent<HTMLTableSectionElement>) => {
    const txt = e.clipboardData.getData('text');
    if (!txt || !/[\n\t,]/.test(txt)) return;
    const grid = detectAndSplit(txt);
    if (grid.length < 2) return;
    e.preventDefault();
    const codeMap = new Map(accounts.map((a) => [a.code.toLowerCase(), a.id]));
    const parsed: LineItem[] = grid.map((cols) => {
      const [code = '', deb = '', cred = '', memo = ''] = cols;
      return {
        key: nextKey(),
        account_id: codeMap.get(code.toLowerCase()) ?? '',
        debit: parseAmount(deb) > 0 ? String(parseAmount(deb)) : '',
        credit: parseAmount(cred) > 0 ? String(parseAmount(cred)) : '',
        description: memo,
      };
    });
    setLines(parsed);
  };

  // Drag-and-drop reorder
  const onDragStart = (key: string) => { dragKey.current = key; };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onDrop = (targetKey: string) => {
    const src = dragKey.current;
    dragKey.current = null;
    if (!src || src === targetKey) return;
    setLines((prev) => {
      const copy = prev.slice();
      const fromIdx = copy.findIndex((l) => l.key === src);
      const toIdx = copy.findIndex((l) => l.key === targetKey);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  // ─── Templates ──────────────────────────────────────
  const applyTemplate = async (templateId: string) => {
    const tpl = JE_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    if (!description.trim()) setDescription(tpl.defaultMemo);
    const ctx = activeCompany ? { companyId: activeCompany.id, date, accounts } : null;
    const prefilled: LineItem[] = [];
    for (const tl of tpl.lines) {
      const accountId = findAccountByHint(tl.hint, accounts);
      let memo = tl.description;
      // F1: template variable resolution
      if (ctx) {
        try { memo = await resolveTemplateString(memo, ctx); } catch { /* ignore */ }
      }
      prefilled.push({
        key: nextKey(),
        account_id: accountId,
        debit: '',
        credit: '',
        description: memo,
      });
    }
    setLines(prefilled.length >= 2 ? prefilled : [...prefilled, emptyLine()]);
  };

  // ─── Auto-balance helper ────────────────────────────
  const autoBalance = () => {
    const totalD = lines.reduce((s, l) => s + parseAmount(l.debit), 0);
    const totalC = lines.reduce((s, l) => s + parseAmount(l.credit), 0);
    const diff = roundCents(totalD - totalC);
    if (diff === 0) return;
    const suspense = accounts.find((a) => /suspense/i.test(a.name))
      || accounts.find((a) => a.type === 'equity')
      || accounts[0];
    if (!suspense) return;
    setLines((prev) => [
      ...prev,
      {
        key: nextKey(),
        account_id: suspense.id,
        debit: diff < 0 ? String(Math.abs(diff)) : '',
        credit: diff > 0 ? String(diff) : '',
        description: 'Auto-balance (suspense)',
      },
    ]);
  };

  // F13: Smart auto-balance suggestions
  const openBalanceSuggestions = async () => {
    if (!activeCompany) return;
    const totalD = lines.reduce((s, l) => s + parseAmount(l.debit), 0);
    const totalC = lines.reduce((s, l) => s + parseAmount(l.credit), 0);
    const d = roundCents(totalD - totalC);
    if (Math.abs(d) < 0.005) return;
    const sug = await buildBalanceSuggestions({
      companyId: activeCompany.id,
      diff: d,
      accounts: accounts as any,
      currentLineAccountIds: lines.map((l) => l.account_id).filter(Boolean),
    });
    setBalanceSuggestions(sug);
    setShowSuggestions(true);
  };

  const applyBalanceSuggestion = (s: { account_id: string; side: 'debit'|'credit'; amount: number; account_label: string }) => {
    if (activeCompany) rememberBalancer(activeCompany.id, s.account_id);
    setLines((prev) => [
      ...prev,
      {
        key: nextKey(),
        account_id: s.account_id,
        debit: s.side === 'debit' ? String(s.amount) : '',
        credit: s.side === 'credit' ? String(s.amount) : '',
        description: `Auto-balance to ${s.account_label}`,
      },
    ]);
    setShowSuggestions(false);
  };

  // F15: Cleanup actions
  const removeZeroLines = () => {
    setLines((prev) => {
      const filtered = prev.filter((l) => parseAmount(l.debit) > 0 || parseAmount(l.credit) > 0 || l.account_id);
      while (filtered.length < 2) filtered.push(emptyLine());
      return filtered;
    });
  };
  const roundAllToCents = () => {
    setLines((prev) => prev.map((l) => ({
      ...l,
      debit: l.debit ? String(roundCents(parseAmount(l.debit))) : '',
      credit: l.credit ? String(roundCents(parseAmount(l.credit))) : '',
    })));
  };
  const sortByAccountCode = () => {
    const codeMap = new Map(accounts.map((a) => [a.id, a.code]));
    setLines((prev) => [...prev].sort((a, b) => (codeMap.get(a.account_id) || '').localeCompare(codeMap.get(b.account_id) || '')));
  };

  // F20: Toggle line lock
  const toggleLineLock = (key: string) => {
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, is_locked: !l.is_locked } : l));
  };

  // ─── Totals ─────────────────────────────────────────
  const totalDebit = lines.reduce((sum, l) => sum + parseAmount(l.debit), 0);
  const totalCredit = lines.reduce((sum, l) => sum + parseAmount(l.credit), 0);
  const diff = roundCents(totalDebit - totalCredit);
  const isBalanced = Math.abs(diff) < 0.005 && totalDebit > 0;

  // ─── Validation & Save ──────────────────────────────
  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!date) errs.date = 'Date is required';
    if (!description.trim()) errs.description = 'Description is required';
    if (isReversing && !reverseOnDate) errs.reverse = 'Reverse date is required';

    const validLines = lines.filter(
      (l) => l.account_id && (parseAmount(l.debit) > 0 || parseAmount(l.credit) > 0)
    );
    if (validLines.length < 2) {
      errs.lines = 'At least two line items with accounts and amounts are required';
    }
    const ld = validLines.reduce((s, l) => s + parseAmount(l.debit), 0);
    const lc = validLines.reduce((s, l) => s + parseAmount(l.credit), 0);
    if (Math.abs(ld - lc) >= 0.005) errs.balance = 'Total debits must equal total credits';
    if (ld === 0 && lc === 0) errs.balance = 'Entry must have non-zero amounts';

    const dual = lines.find((l) => parseAmount(l.debit) > 0 && parseAmount(l.credit) > 0);
    if (dual) errs.balance = 'A line cannot have both a debit and a credit';
    const neg = lines.find((l) => parseAmount(l.debit) < 0 || parseAmount(l.credit) < 0);
    if (neg) errs.balance = 'Debit and credit amounts cannot be negative';

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = useCallback(async () => {
    if (isLocked) { setErrors({ _form: 'Posted entries are read-only. Unpost first.' }); return; }
    if (!validate() || !activeCompany) return;
    setSaving(true);
    try {
      const validLines = lines.filter(
        (l) => l.account_id && (parseAmount(l.debit) > 0 || parseAmount(l.credit) > 0)
      );

      // Optionally create a recurring_templates row
      let recurringTemplateId: string | null = entry?.recurring_template_id ?? null;
      if (isRecurring && !recurringTemplateId) {
        try {
          const created = await api.create('recurring_templates', {
            company_id: activeCompany.id,
            type: 'expense', // closest existing enum — schema CHECK only allows invoice/expense
            name: `JE: ${description.trim().slice(0, 60)}`,
            frequency: recurFrequency,
            next_date: date,
            is_active: 1,
            template_data: JSON.stringify({
              kind: 'journal_entry',
              description: description.trim(),
              reference: reference.trim(),
              klass,
              lines: validLines.map((l) => ({
                account_id: l.account_id,
                debit: parseAmount(l.debit),
                credit: parseAmount(l.credit),
                description: l.description,
              })),
            }),
          });
          recurringTemplateId = created?.id ?? null;
        } catch (e) {
          console.warn('Failed to create recurring template:', e);
        }
      }

      const entryPayload: Record<string, any> = {
        company_id: activeCompany.id,
        entry_number: isEdit ? entry!.entry_number : entryNumber,
        date,
        description: description.trim(),
        reference: reference.trim() || null,
        is_posted: 0,
        is_adjusting: 0,
        is_recurring: isRecurring ? 1 : 0,
        recurring_template_id: recurringTemplateId,
        is_reversing: isReversing ? 1 : 0,
        reverse_on_date: isReversing ? reverseOnDate : null,
        approval_status: entry?.approval_status ?? 'draft',
        class: klass.trim(),
      };

      let entryId: string;
      if (isEdit && entry) {
        // F23: snapshot before saving
        try { await api.jeSnapshot(entry.id, user?.id || ''); } catch { /* ignore */ }
        await api.update('journal_entries', entry.id, entryPayload);
        entryId = entry.id;
        const existing = await api.query('journal_entry_lines', { journal_entry_id: entry.id });
        if (Array.isArray(existing)) {
          for (const el of existing) await api.remove('journal_entry_lines', el.id);
        }
      } else {
        const created = await api.create('journal_entries', entryPayload);
        entryId = created.id;
      }

      for (let i = 0; i < validLines.length; i++) {
        const l = validLines[i];
        await api.create('journal_entry_lines', {
          journal_entry_id: entryId,
          account_id: l.account_id,
          debit: parseAmount(l.debit),
          credit: parseAmount(l.credit),
          description: l.description.trim() || null,
          line_memo: l.description.trim() || null,
          sort_order: i,
          is_locked: l.is_locked ? 1 : 0,
        });
        if (user) recordRecentAccount(user.id, activeCompany.id, l.account_id);
      }

      // Clear draft slot
      try {
        localStorage.removeItem(draftKey(activeCompany.id, null));
        localStorage.removeItem(draftKey(activeCompany.id, entryId));
      } catch { /* ignore */ }

      onSaved();
    } catch (err: any) {
      console.error('Failed to save journal entry:', err);
      setErrors({ _form: err?.message ?? 'Failed to save journal entry' });
    } finally {
      setSaving(false);
    }
  }, [activeCompany, entry, date, description, reference, klass, lines, isEdit, entryNumber, isRecurring, recurFrequency, isReversing, reverseOnDate, isLocked, user, onSaved]);

  // ─── Keyboard shortcuts ─────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, onClose]);

  // Enter on last cell adds a row; F17: Delete/Backspace removes row when not in input
  const handleCellKeyDown = (e: React.KeyboardEvent, rowIdx: number, isLastCell: boolean) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (isLastCell && rowIdx === lines.length - 1) {
        e.preventDefault();
        addLine();
      }
    }
  };

  // F17: row-level keyboard delete (when row container is focused)
  const handleRowKeyDown = (e: React.KeyboardEvent, key: string) => {
    const target = e.target as HTMLElement;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeLine(key);
    }
  };

  // F10: Copy lines from another entry
  const copyLinesFrom = async (otherId: string) => {
    try {
      const lns: any = await api.query('journal_entry_lines', { journal_entry_id: otherId });
      if (!Array.isArray(lns)) return;
      const sorted = lns.slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const newLines: LineItem[] = sorted.map((l: any) => ({
        key: nextKey(),
        account_id: l.account_id ?? '',
        debit: l.debit ? String(l.debit) : '',
        credit: l.credit ? String(l.credit) : '',
        description: l.description ?? l.line_memo ?? '',
      }));
      // Append after existing non-empty lines
      setLines((prev) => {
        const keep = prev.filter((p) => p.account_id || p.debit || p.credit);
        return [...keep, ...newLines];
      });
      setShowCopyPicker(false);
    } catch { /* ignore */ }
  };

  // F24: Rollback to a version
  const rollbackTo = async (historyId: string) => {
    if (!entry || !user) return;
    if (!window.confirm('Rollback to this version? Current state will be saved as a new history entry.')) return;
    const r = await api.jeHistoryRollback(historyId, user.id);
    if (r?.error) alert('Rollback failed: ' + r.error);
    else { alert('Rolled back. Reload to see changes.'); onSaved(); }
  };

  // F8/F25: Build preview HTML and print
  const buildPreviewHTML = (withSig: boolean) => {
    const acctMap = new Map(accounts.map((a) => [a.id, a]));
    return generateJeCoverSheetHTML({
      entry: {
        entry_number: entry?.entry_number || entryNumber || '(new)',
        date, description, reference, class: klass,
      },
      totalDebit, totalCredit,
      lines: lines.filter((l) => l.account_id && (parseAmount(l.debit) > 0 || parseAmount(l.credit) > 0))
        .map((l) => {
          const a = acctMap.get(l.account_id);
          return {
            account_code: a?.code || '',
            account_name: a?.name || '',
            debit: parseAmount(l.debit),
            credit: parseAmount(l.credit),
            description: l.description,
          };
        }),
      companyName: activeCompany?.name,
      withSignatureLine: withSig,
    });
  };

  const printWithSignature = async () => {
    try { await api.printPreview(buildPreviewHTML(true), `JE ${entry?.entry_number || ''}`); }
    catch (err) { console.error(err); }
  };

  // F19: Auto-fill from invoice/bill source
  const autoFillFromSource = async () => {
    if (!sourceDoc || !activeCompany) return;
    const total = Number(sourceDoc.total || sourceDoc.subtotal || 0);
    const tax = Number(sourceDoc.tax_amount || sourceDoc.total_tax || 0);
    if (total <= 0) { alert('Source has no total to fill from.'); return; }
    const isInvoice = sourceDoc._table === 'invoices';
    // Invoice: DR AR, CR Revenue + tax payable. Bill/expense: DR Expense + tax recv, CR AP.
    const ar = accounts.find((a) => /receivable|^a\/?r$/i.test(a.name));
    const ap = accounts.find((a) => /payable|^a\/?p$/i.test(a.name));
    const rev = accounts.find((a) => /revenue|sales/i.test(a.name) && a.type === 'revenue');
    const exp = accounts.find((a) => a.type === 'expense');
    const taxAcct = accounts.find((a) => /tax/i.test(a.name));
    const newLines: LineItem[] = [];
    if (isInvoice) {
      newLines.push({ key: nextKey(), account_id: ar?.id || '', debit: String(total), credit: '', description: 'Receivable' });
      newLines.push({ key: nextKey(), account_id: rev?.id || '', debit: '', credit: String(roundCents(total - tax)), description: 'Revenue' });
      if (tax > 0 && taxAcct) newLines.push({ key: nextKey(), account_id: taxAcct.id, debit: '', credit: String(tax), description: 'Sales tax' });
    } else {
      newLines.push({ key: nextKey(), account_id: exp?.id || '', debit: String(roundCents(total - tax)), credit: '', description: 'Expense' });
      if (tax > 0 && taxAcct) newLines.push({ key: nextKey(), account_id: taxAcct.id, debit: String(tax), credit: '', description: 'Tax' });
      newLines.push({ key: nextKey(), account_id: ap?.id || '', debit: '', credit: String(total), description: 'Payable' });
    }
    setLines(newLines.length >= 2 ? newLines : [...newLines, emptyLine()]);
  };

  // ─── Comments ───────────────────────────────────────
  const addComment = async () => {
    if (!entry || !newComment.trim()) return;
    try {
      const created = await api.create('je_comments', {
        journal_entry_id: entry.id,
        user_id: user?.id ?? '',
        body: newComment.trim(),
      });
      setComments((p) => [...p, created]);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  };

  // ─── Attachments ────────────────────────────────────
  const attachDocument = async () => {
    if (!entry || !activeCompany) return;
    try {
      const result: any = await api.openFileDialog();
      if (!result || !result.path) return;
      const created = await api.create('documents', {
        company_id: activeCompany.id,
        filename: result.name,
        file_path: result.path,
        file_size: result.size ?? 0,
        entity_type: 'journal_entry',
        entity_id: entry.id,
      });
      setDocs((p) => [...p, created]);
    } catch (err) {
      console.error('Failed to attach document:', err);
    }
  };

  // ─── Recent / Sorted accounts (last-account auto-suggest) ──
  const recentIds = useMemo(() => {
    if (!user || !activeCompany) return [];
    return getRecentAccounts(user.id, activeCompany.id);
  }, [user, activeCompany]);

  const renderAccountOptions = () => {
    const TYPE_LABELS: Record<string, string> = {
      asset: 'Assets', equity: 'Equity', expense: 'Expenses',
      liability: 'Liabilities', revenue: 'Revenue',
    };
    const groups: Record<string, AccountOption[]> = {};
    for (const a of accounts) {
      const k = TYPE_LABELS[a.type] ?? 'Other';
      (groups[k] ||= []).push(a);
    }
    const recents = recentIds
      .map((id) => accounts.find((a) => a.id === id))
      .filter(Boolean) as AccountOption[];
    return (
      <>
        {recents.length > 0 && (
          <optgroup label="Recently Used">
            {recents.map((a) => (
              <option key={`r-${a.id}`} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </optgroup>
        )}
        {Object.keys(groups).sort((a, b) => a.localeCompare(b)).map((label) => (
          <optgroup key={label} label={label}>
            {groups[label].map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </optgroup>
        ))}
      </>
    );
  };

  // ─── Render ─────────────────────────────────────────
  const sourceChip = entry?.source_type && entry?.source_id ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-accent-blue/15 text-accent-blue" style={{ borderRadius: '6px' }}>
      Posted from {entry.source_type} {entry.source_id.slice(0, 8)}
    </span>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/50">
      <div className="bg-bg-elevated border border-border-primary w-full max-w-4xl shadow-xl" style={{ borderRadius: '6px' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-text-primary">
              {isEdit ? `Edit Journal Entry ${entry?.entry_number ?? ''}` : 'New Journal Entry'}
            </h2>
            {entryNumber && !isEdit && (
              <span className="text-[10px] font-mono text-text-muted">{entryNumber}</span>
            )}
            {sourceChip}
            {isLocked && (
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-accent-income/15 text-accent-income" style={{ borderRadius: '6px' }}>
                POSTED — read-only
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Live balance strip */}
        <div className={`px-5 py-2 border-b border-border-primary text-[11px] font-mono flex items-center justify-between ${isBalanced ? 'bg-accent-income/10 text-accent-income' : Math.abs(diff) > 0.005 ? 'bg-accent-expense/10 text-accent-expense' : 'bg-bg-tertiary text-text-muted'}`}>
          <div className="flex items-center gap-4">
            <span>Debits: <strong>{formatCurrency(totalDebit)}</strong></span>
            <span>Credits: <strong>{formatCurrency(totalCredit)}</strong></span>
            <span>Diff: <strong>{formatCurrency(Math.abs(diff))}</strong></span>
            {isBalanced && <span className="font-bold">BALANCED</span>}
          </div>
          {!isLocked && Math.abs(diff) > 0.005 && (
            <div className="flex items-center gap-3">
              <button onClick={autoBalance} className="flex items-center gap-1 text-[10px] font-semibold underline hover:no-underline">
                <Wand2 size={11} /> Balance
              </button>
              <button onClick={openBalanceSuggestions} className="flex items-center gap-1 text-[10px] font-semibold underline hover:no-underline">
                Smart suggest
              </button>
            </div>
          )}
        </div>

        {/* Action toolbar */}
        <div className="px-5 py-2 border-b border-border-primary flex items-center gap-2 text-[11px] flex-wrap">
          <button onClick={() => setShowPreview(true)} className="block-btn flex items-center gap-1 px-2 py-1" style={{ borderRadius: '6px' }}>
            <Eye size={11} /> Preview
          </button>
          <button onClick={printWithSignature} className="block-btn flex items-center gap-1 px-2 py-1" style={{ borderRadius: '6px' }}>
            <FileText size={11} /> Cover sheet
          </button>
          {(isRecurring || isReversing) && (
            <button onClick={() => setShowSchedule(true)} className="block-btn flex items-center gap-1 px-2 py-1" style={{ borderRadius: '6px' }}>
              <Repeat size={11} /> Schedule
            </button>
          )}
          {isEdit && (
            <button onClick={() => setShowVersions((v) => !v)} className="block-btn flex items-center gap-1 px-2 py-1" style={{ borderRadius: '6px' }}>
              <History size={11} /> Versions ({versions.length})
            </button>
          )}
          <button onClick={() => setShowCopyPicker(true)} className="block-btn flex items-center gap-1 px-2 py-1" style={{ borderRadius: '6px' }}>
            <ListPlus size={11} /> Copy lines from JE
          </button>
          <span className="mx-2 text-text-muted">|</span>
          <button onClick={removeZeroLines} className="text-text-secondary hover:text-text-primary underline">Remove zero lines</button>
          <button onClick={roundAllToCents} className="text-text-secondary hover:text-text-primary underline">Round to cents</button>
          <button onClick={sortByAccountCode} className="text-text-secondary hover:text-text-primary underline">Sort by code</button>
        </div>

        {/* Body */}
        <fieldset disabled={isLocked} className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {errors._form && (
            <div className="bg-accent-expense/10 border border-accent-expense/30 text-accent-expense text-xs px-3 py-2" style={{ borderRadius: '6px' }}>
              {errors._form}
            </div>
          )}

          {/* F14: Warnings panel */}
          {(() => {
            const warnings: string[] = [];
            if (Math.abs(diff) > 0.005) warnings.push(`Unbalanced by ${formatCurrency(Math.abs(diff))}`);
            const hasZero = lines.some((l) => l.account_id && parseAmount(l.debit) === 0 && parseAmount(l.credit) === 0);
            if (hasZero) warnings.push('Some lines have an account but zero amount');
            const negLine = lines.some((l) => parseAmount(l.debit) < 0 || parseAmount(l.credit) < 0);
            if (negLine) warnings.push('Negative amounts detected');
            const dualLine = lines.some((l) => parseAmount(l.debit) > 0 && parseAmount(l.credit) > 0);
            if (dualLine) warnings.push('A line has both debit and credit');
            const noClass = !klass.trim() && lines.some((l) => l.account_id);
            if (noClass) warnings.push('No class/department set');
            if (duplicateWarning) warnings.push(duplicateWarning);
            if (warnings.length === 0) return null;
            return (
              <div className="bg-yellow-500/10 border border-yellow-500/30 text-xs px-3 py-2" style={{ borderRadius: '6px' }}>
                <div className="font-semibold mb-1 flex items-center gap-1"><AlertTriangle size={12} /> Warnings</div>
                <ul className="list-disc ml-5 space-y-0.5 text-text-secondary">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            );
          })()}

          {/* F12: Source-doc inline preview */}
          {sourceDoc && (
            <div className="bg-bg-tertiary border border-border-primary px-3 py-2 text-xs flex items-center gap-3" style={{ borderRadius: '6px' }}>
              <span className="font-semibold text-text-primary">
                {sourceDoc._table === 'invoices' ? 'Invoice' : sourceDoc._table === 'bills' ? 'Bill' : 'Expense'}{' '}
                {sourceDoc.invoice_number || sourceDoc.bill_number || sourceDoc.expense_number || sourceDoc.id?.slice(0, 8)}
              </span>
              <span className="text-text-secondary">Total: {formatCurrency(Number(sourceDoc.total || sourceDoc.subtotal || 0))}</span>
              {sourceDoc.client_name && <span className="text-text-secondary">{sourceDoc.client_name}</span>}
              {sourceDoc.vendor_name && <span className="text-text-secondary">{sourceDoc.vendor_name}</span>}
              <button onClick={autoFillFromSource} className="ml-auto block-btn px-2 py-0.5 text-[10px]" style={{ borderRadius: '4px' }}>
                Auto-fill lines
              </button>
            </div>
          )}

          {/* Top fields */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className={`block-input w-full px-3 py-2 text-sm bg-bg-primary border ${errors.date ? 'border-accent-expense' : 'border-border-primary'} text-text-primary focus:outline-none focus:border-accent-blue`}
                style={{ borderRadius: '6px' }} />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Description *</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Entry description"
                className={`block-input w-full px-3 py-2 text-sm bg-bg-primary border ${errors.description ? 'border-accent-expense' : 'border-border-primary'} text-text-primary focus:outline-none focus:border-accent-blue`}
                style={{ borderRadius: '6px' }} />
            </div>
            <div className="relative">
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Reference</label>
              <input type="text" value={reference}
                onChange={(e) => setReference(e.target.value)}
                onFocus={() => setShowRefSuggestions(true)}
                onBlur={() => setTimeout(() => setShowRefSuggestions(false), 150)}
                placeholder="e.g. INV-001"
                list="je-ref-suggestions"
                className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                style={{ borderRadius: '6px' }} />
              <datalist id="je-ref-suggestions">
                {referenceSuggestions.filter((r) => !reference || r.toLowerCase().includes(reference.toLowerCase())).slice(0, 20).map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Class / Dept</label>
              <input type="text" value={klass} onChange={(e) => setKlass(e.target.value)}
                placeholder="e.g. Sales, R&D"
                className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                style={{ borderRadius: '6px' }} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Use Template</label>
              <select onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); e.target.value = ''; }}
                defaultValue=""
                className="block-select w-full px-2 py-2 text-xs bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                style={{ borderRadius: '6px' }}>
                <option value="">— pick a template —</option>
                {JE_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
                <Repeat size={12} /> Recurring
              </label>
              {isRecurring && (
                <select value={recurFrequency} onChange={(e) => setRecurFrequency(e.target.value as any)}
                  className="block-select px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary"
                  style={{ borderRadius: '6px' }}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              )}
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={isReversing} onChange={(e) => setIsReversing(e.target.checked)} />
                <RotateCcw size={12} /> Reversing
              </label>
              {isReversing && (
                <input type="date" value={reverseOnDate} onChange={(e) => setReverseOnDate(e.target.value)}
                  className="block-input px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary"
                  style={{ borderRadius: '6px' }} />
              )}
            </div>
          </div>
          {errors.reverse && <p className="text-[10px] text-accent-expense">{errors.reverse}</p>}

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Line Items</label>
              <div className="flex items-center gap-3 text-[10px] text-text-muted">
                <span title="Type =EXPR in amount fields to evaluate inline">
                  <Calculator size={11} className="inline" /> =EXPR supported
                </span>
                <span>Paste tab/CSV rows · Drag <GripVertical size={11} className="inline" /> to reorder</span>
                <button onClick={addLine} className="flex items-center gap-1 text-xs text-accent-blue hover:text-accent-blue/80">
                  <Plus size={12} /> Add Line
                </button>
              </div>
            </div>

            {errors.lines && <p className="text-[10px] text-accent-expense mb-2">{errors.lines}</p>}

            <div className="border border-border-primary overflow-hidden" style={{ borderRadius: '6px' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-tertiary border-b border-border-primary">
                    <th className="w-6"></th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Account</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-32">Debit</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-32">Credit</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Memo</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody onPaste={handlePaste}>
                  {lines.map((line, idx) => {
                    const dVal = parseAmount(line.debit);
                    const cVal = parseAmount(line.credit);
                    const lineErr = (dVal < 0 || cVal < 0) ? 'Negative not allowed'
                      : (dVal > 0 && cVal > 0) ? 'A line cannot have both debit & credit'
                      : (line.account_id && dVal === 0 && cVal === 0) ? 'Account set but no amount'
                      : '';
                    const errBorder = lineErr ? 'border-accent-expense' : 'border-border-primary';
                    return (
                    <tr key={line.key} className={`border-b border-border-primary ${line.is_locked ? 'bg-bg-tertiary/50' : ''}`}
                        tabIndex={0}
                        onKeyDown={(e) => handleRowKeyDown(e, line.key)}
                        onDragOver={onDragOver} onDrop={() => onDrop(line.key)}
                        title={lineErr || undefined}>
                      <td className="px-1 py-1.5 text-center text-text-muted cursor-move"
                          draggable onDragStart={() => onDragStart(line.key)}>
                        <GripVertical size={12} />
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={line.account_id}
                          onChange={(e) => updateLine(line.key, 'account_id', e.target.value)}
                          className="block-select w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                          style={{ borderRadius: '6px' }}>
                          <option value="">Select account...</option>
                          {renderAccountOptions()}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" inputMode="decimal" value={line.debit}
                          onChange={(e) => updateLine(line.key, 'debit', e.target.value)}
                          onBlur={(e) => handleAmountBlur(line.key, 'debit', e.target.value)}
                          onKeyDown={(e) => handleCellKeyDown(e, idx, false)}
                          placeholder="0.00"
                          className="block-input w-full px-2 py-1 text-xs text-right font-mono bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                          style={{ borderRadius: '6px' }} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" inputMode="decimal" value={line.credit}
                          onChange={(e) => updateLine(line.key, 'credit', e.target.value)}
                          onBlur={(e) => handleAmountBlur(line.key, 'credit', e.target.value)}
                          onKeyDown={(e) => handleCellKeyDown(e, idx, false)}
                          placeholder="0.00"
                          className="block-input w-full px-2 py-1 text-xs text-right font-mono bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                          style={{ borderRadius: '6px' }} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={line.description}
                          onChange={(e) => updateLine(line.key, 'description', e.target.value)}
                          onKeyDown={(e) => handleCellKeyDown(e, idx, true)}
                          placeholder="Line memo"
                          className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                          style={{ borderRadius: '6px' }} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => toggleLineLock(line.key)} title={line.is_locked ? 'Unlock line' : 'Lock line'}
                            className={line.is_locked ? 'text-accent-blue' : 'text-text-muted hover:text-accent-blue'}>
                            <Lock size={11} />
                          </button>
                          <button onClick={() => removeLine(line.key)} disabled={lines.length <= 2 || line.is_locked}
                            className="text-text-muted hover:text-accent-expense transition-colors disabled:opacity-25 disabled:cursor-not-allowed">
                            <Trash2 size={13} />
                          </button>
                          {lineErr && <AlertTriangle size={11} className="text-accent-expense" />}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {errors.balance && (
            <div className="bg-accent-expense/10 border border-accent-expense/30 text-accent-expense text-xs px-3 py-2 flex items-center gap-2"
                 style={{ borderRadius: '6px' }}>
              <AlertTriangle size={14} /> {errors.balance}
            </div>
          )}

          {/* Attachments + Comments (only when editing) */}
          {isEdit && (
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border-primary">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
                    <Paperclip size={11} /> Attachments
                  </label>
                  <button onClick={attachDocument} type="button" className="text-xs text-accent-blue hover:underline">+ Attach</button>
                </div>
                <div className="space-y-1">
                  {docs.length === 0 && <p className="text-[10px] text-text-muted">No attachments</p>}
                  {docs.map((d) => {
                    const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(d.filename || '');
                    return (
                      <div key={d.id} className="flex items-center gap-2 text-xs text-text-secondary">
                        {isImage && d.file_path ? (
                          <img src={`file://${d.file_path}`} alt={d.filename}
                            className="w-8 h-8 object-cover border border-border-primary"
                            style={{ borderRadius: '4px' }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <span className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary text-[9px]"
                                style={{ borderRadius: '4px' }}>{(d.filename.split('.').pop() || '?').toUpperCase()}</span>
                        )}
                        <span className="truncate">{d.filename}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1 mb-2">
                  <MessageSquare size={11} /> Comments
                </label>
                <div className="space-y-1 max-h-24 overflow-y-auto mb-2">
                  {comments.length === 0 && <p className="text-[10px] text-text-muted">No comments</p>}
                  {comments.map((c) => (
                    <div key={c.id} className="text-xs text-text-secondary border-l-2 border-border-primary pl-2">
                      {c.body}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    className="block-input flex-1 px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary"
                    style={{ borderRadius: '6px' }} />
                  <button onClick={addComment} className="block-btn px-2 py-1 text-xs">Post</button>
                </div>
              </div>
            </div>
          )}
        </fieldset>

        {/* F23: Versions sidebar (inline) */}
        {showVersions && isEdit && (
          <div className="px-5 py-3 border-t border-border-primary bg-bg-tertiary text-xs">
            <div className="font-semibold mb-2 flex items-center justify-between">
              <span>Version History</span>
              <button onClick={() => setShowVersions(false)} className="text-text-muted">×</button>
            </div>
            {versions.length === 0 ? (
              <p className="text-text-muted">No prior versions yet. Versions are recorded each time you save.</p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between border border-border-primary px-2 py-1" style={{ borderRadius: '4px' }}>
                    <span className="font-mono">v{v.version}</span>
                    <span className="text-text-muted">{v.changed_at}</span>
                    <button onClick={() => rollbackTo(v.id)} className="text-accent-blue underline">Rollback</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* F2: Schedule preview modal */}
        {showSchedule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-bg-elevated border border-border-primary w-96 shadow-xl" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-2 border-b border-border-primary flex items-center justify-between">
                <h3 className="text-sm font-bold">Schedule preview — next 12</h3>
                <button onClick={() => setShowSchedule(false)} className="text-text-muted">×</button>
              </div>
              <ul className="px-4 py-3 text-xs font-mono space-y-1 max-h-72 overflow-y-auto">
                {(isReversing && reverseOnDate
                  ? [reverseOnDate, ...computeScheduleDates(reverseOnDate, recurFrequency, 11)]
                  : computeScheduleDates(date, recurFrequency, 12)
                ).map((d, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-text-muted">#{i + 1}</span>
                    <span className="text-text-primary">{d}</span>
                    <span className="text-text-secondary">{formatCurrency(totalDebit)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* F8: Preview modal (read-only print-style) */}
        {showPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-bg-elevated border border-border-primary w-full max-w-3xl shadow-xl" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-2 border-b border-border-primary flex items-center justify-between">
                <h3 className="text-sm font-bold">Preview</h3>
                <div className="flex items-center gap-2">
                  <button onClick={printWithSignature} className="block-btn px-2 py-1 text-xs" style={{ borderRadius: '4px' }}>Print</button>
                  <button onClick={() => setShowPreview(false)} className="text-text-muted">×</button>
                </div>
              </div>
              <iframe title="JE preview" className="w-full bg-white" style={{ height: '70vh' }}
                srcDoc={buildPreviewHTML(true)} />
            </div>
          </div>
        )}

        {/* F10: Copy lines picker */}
        {showCopyPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-bg-elevated border border-border-primary w-full max-w-xl shadow-xl" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-2 border-b border-border-primary flex items-center justify-between">
                <h3 className="text-sm font-bold">Copy lines from another entry</h3>
                <button onClick={() => setShowCopyPicker(false)} className="text-text-muted">×</button>
              </div>
              <ul className="max-h-96 overflow-y-auto text-xs">
                {otherEntries.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => copyLinesFrom(e.id)}
                      className="w-full text-left px-4 py-2 hover:bg-bg-hover border-b border-border-primary">
                      <span className="font-mono mr-2">{e.entry_number}</span>
                      <span className="text-text-muted mr-2">{e.date}</span>
                      <span>{e.description}</span>
                    </button>
                  </li>
                ))}
                {otherEntries.length === 0 && <li className="px-4 py-3 text-text-muted">Loading…</li>}
              </ul>
            </div>
          </div>
        )}

        {/* F13: Smart auto-balance suggestions */}
        {showSuggestions && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-bg-elevated border border-border-primary w-96 shadow-xl" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-2 border-b border-border-primary flex items-center justify-between">
                <h3 className="text-sm font-bold">Balance suggestions</h3>
                <button onClick={() => setShowSuggestions(false)} className="text-text-muted">×</button>
              </div>
              <ul className="text-xs">
                {balanceSuggestions.length === 0 && <li className="px-4 py-3 text-text-muted">No suggestions available.</li>}
                {balanceSuggestions.map((s, i) => (
                  <li key={i}>
                    <button onClick={() => applyBalanceSuggestion(s)}
                      className="w-full text-left px-4 py-2 hover:bg-bg-hover border-b border-border-primary">
                      <span className="font-semibold mr-2">{s.label}</span>
                      <span className="font-mono">{s.account_label}</span>
                      <span className="ml-2 text-text-secondary">{s.side === 'debit' ? 'DR' : 'CR'} {formatCurrency(s.amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* F6: Dependency graph chip */}
        {entry?.recurring_template_id && (
          <div className="px-5 py-2 border-t border-border-primary text-[11px] text-text-muted">
            <span className="mr-2">Linked:</span>
            <span className="font-mono px-2 py-0.5 bg-bg-tertiary border border-border-primary"
                  style={{ borderRadius: '4px' }}>recurring template {entry.recurring_template_id.slice(0, 8)}</span>
            {entry.source_type && entry.source_id && (
              <span className="ml-2 font-mono px-2 py-0.5 bg-bg-tertiary border border-border-primary"
                    style={{ borderRadius: '4px' }}>{entry.source_type} {entry.source_id.slice(0, 8)}</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border-primary">
          <span className="text-[10px] text-text-muted">
            <kbd className="font-mono">⌘↵</kbd> save · <kbd className="font-mono">Esc</kbd> cancel · <kbd className="font-mono">Enter</kbd> on last cell adds row
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-text-secondary bg-bg-tertiary border border-border-primary hover:bg-bg-hover transition-colors"
              style={{ borderRadius: '6px' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || !isBalanced || isLocked}
              className="block-btn-primary flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{ borderRadius: '6px' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {isEdit ? 'Update Entry' : 'Save Entry'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JournalEntryForm;
