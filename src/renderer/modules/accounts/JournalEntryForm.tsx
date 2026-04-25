import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  X, Save, Plus, Trash2, Loader2, AlertTriangle, Wand2, RotateCcw,
  Repeat, Paperclip, MessageSquare, GripVertical, Calculator,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import { roundCents, formatCurrency } from '../../lib/format';
import { JE_TEMPLATES, findAccountByHint } from '../../lib/je-templates';

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
  }, [entry]);

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

  // Multi-line paste — account_code,debit,credit,description
  const handlePaste = (e: React.ClipboardEvent<HTMLTableSectionElement>) => {
    const txt = e.clipboardData.getData('text');
    if (!txt || !/[\n\t,]/.test(txt)) return;
    const rows = txt.split(/\r?\n/).filter((r) => r.trim().length > 0);
    if (rows.length < 2) return; // single cell — let default behavior win
    e.preventDefault();
    const codeMap = new Map(accounts.map((a) => [a.code.toLowerCase(), a.id]));
    const parsed: LineItem[] = rows.map((row) => {
      const cols = row.split(/\t|,/).map((c) => c.trim());
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
  const applyTemplate = (templateId: string) => {
    const tpl = JE_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    if (!description.trim()) setDescription(tpl.defaultMemo);
    const prefilled = tpl.lines.map((tl) => {
      const accountId = findAccountByHint(tl.hint, accounts);
      return {
        key: nextKey(),
        account_id: accountId,
        debit: tl.side === 'debit' ? '' : '',
        credit: tl.side === 'credit' ? '' : '',
        description: tl.description,
      };
    });
    setLines(prefilled.length >= 2 ? prefilled : [...prefilled, emptyLine()]);
  };

  // ─── Auto-balance helper ────────────────────────────
  const autoBalance = () => {
    const totalD = lines.reduce((s, l) => s + parseAmount(l.debit), 0);
    const totalC = lines.reduce((s, l) => s + parseAmount(l.credit), 0);
    const diff = roundCents(totalD - totalC);
    if (diff === 0) return;
    // Use first account whose name matches "suspense", else first equity/liability, else any
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

  // Enter on last cell adds a row
  const handleCellKeyDown = (e: React.KeyboardEvent, rowIdx: number, isLastCell: boolean) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (isLastCell && rowIdx === lines.length - 1) {
        e.preventDefault();
        addLine();
      }
    }
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
            <button onClick={autoBalance} className="flex items-center gap-1 text-[10px] font-semibold underline hover:no-underline">
              <Wand2 size={11} /> Balance
            </button>
          )}
        </div>

        {/* Body */}
        <fieldset disabled={isLocked} className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {errors._form && (
            <div className="bg-accent-expense/10 border border-accent-expense/30 text-accent-expense text-xs px-3 py-2" style={{ borderRadius: '6px' }}>
              {errors._form}
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
                  {lines.map((line, idx) => (
                    <tr key={line.key} className="border-b border-border-primary"
                        onDragOver={onDragOver} onDrop={() => onDrop(line.key)}>
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
                        <button onClick={() => removeLine(line.key)} disabled={lines.length <= 2}
                          className="text-text-muted hover:text-accent-expense transition-colors disabled:opacity-25 disabled:cursor-not-allowed">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
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
                  {docs.map((d) => (
                    <div key={d.id} className="text-xs text-text-secondary truncate">{d.filename}</div>
                  ))}
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
