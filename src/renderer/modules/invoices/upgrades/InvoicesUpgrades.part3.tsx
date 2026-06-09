/**
 * InvoicesUpgradesPart3 — "Bulk Actions & Productivity"
 *
 * A self-contained vertical stack of small, working productivity features for
 * the Invoices module. Each card reads REAL invoice data through the `api`
 * wrapper (scoped to the active company) and performs a concrete action:
 * bulk status changes, tagging, late-fee math, dunning advancement,
 * duplication, partial-payment recording, CSV export, clipboard copy,
 * localStorage-persisted snooze reminders, keyboard shortcuts, etc.
 *
 * No external props — the panel owns its own selection / data state so it can
 * be dropped anywhere in the Invoices module without wiring.
 *
 * Conventions: theme utility classes only (no raw hex), tokens for color,
 * formatCurrency/formatDate from lib/format, data via api only.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle, Send, Ban, Trash2, Flag, Tag as TagIcon, UserCheck, CalendarClock,
  Percent, Bell, Copy, ClipboardCopy, Download, DollarSign, FileText, Keyboard,
  AlarmClock, StickyNote, Eye, RefreshCw, Search, AlertTriangle,
} from 'lucide-react';
import api from '../../../lib/api';
import { useToast } from '../../../components/ToastProvider';
import { batchDeleteWithUndo } from '../../../lib/toastUndo';
import { downloadCSVBlob } from '../../../lib/csv-export';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus, roundCents } from '../../../lib/format';

// ─── Local types ────────────────────────────────────────
interface InvoiceRow {
  id: string;
  invoice_number?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  status?: string | null;
  total?: number | null;
  amount_paid?: number | null;
  due_date?: string | null;
  issue_date?: string | null;
  priority?: string | null;
  tags?: string | null;
  sales_rep_id?: string | null;
  currency?: string | null;
  late_fee_pct?: number | null;
  late_fee_applied?: number | null;
  dunning_stage?: number | null;
  internal_notes?: string | null;
  times_sent?: number | null;
  portal_viewed_count?: number | null;
  payment_link?: string | null;
}

interface UserRow { id: string; display_name?: string | null }

const FOLLOWUP_LS_KEY = 'bap-invoice-followups-v1';

// ─── Helpers ────────────────────────────────────────────
const todayISO = () => new Date().toISOString().slice(0, 10);

function shiftDate(iso: string | null | undefined, days: number): string {
  const base = iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')) : new Date();
  if (isNaN(base.getTime())) return todayISO();
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function isOverdue(inv: InvoiceRow): boolean {
  if (!inv.due_date) return false;
  const s = inv.status || '';
  if (s === 'paid' || s === 'cancelled' || s === 'void') return false;
  const due = new Date(inv.due_date + 'T23:59:59').getTime();
  return due < Date.now();
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((t) => String(t)).filter(Boolean);
  } catch { /* not JSON — fall through */ }
  return String(raw).split(',').map((t) => t.trim()).filter(Boolean);
}

function loadFollowups(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FOLLOWUP_LS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function saveFollowups(map: Record<string, string>) {
  try { localStorage.setItem(FOLLOWUP_LS_KEY, JSON.stringify(map)); } catch { /* quota — ignore */ }
}

// ─── Card shell ─────────────────────────────────────────
function FeatureCard({ icon, title, hint, children }: {
  icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="block-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: 'var(--accent-primary)', display: 'inline-flex' }}>{icon}</span>
        <h3 className="text-text-primary" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</h3>
      </div>
      {hint && <p className="text-text-muted" style={{ fontSize: 11, margin: '0 0 10px' }}>{hint}</p>}
      <div>{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
//  Main component
// ════════════════════════════════════════════════════════
export default function InvoicesUpgradesPart3() {
  const toast = useToast();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id ?? null;

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);

  // Per-feature control state
  const [priority, setPriority] = useState('high');
  const [tagInput, setTagInput] = useState('');
  const [repId, setRepId] = useState('');
  const [shiftDays, setShiftDays] = useState('7');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [noteText, setNoteText] = useState('');
  const [partialFor, setPartialFor] = useState<string | null>(null);
  const [partialAmt, setPartialAmt] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [activeRow, setActiveRow] = useState(0);
  const [followups, setFollowups] = useState<Record<string, string>>(() => loadFollowups());

  const searchRef = useRef<HTMLInputElement | null>(null);

  // ─── Load data ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const where = companyId ? `WHERE i.company_id = ?` : '';
        const params = companyId ? [companyId] : [];
        const rows = await api.rawQuery(
          `SELECT i.id, i.invoice_number, i.client_id, i.status, i.total, i.amount_paid,
                  i.due_date, i.issue_date, i.priority, i.tags, i.sales_rep_id, i.currency,
                  i.late_fee_pct, i.late_fee_applied, i.dunning_stage, i.internal_notes,
                  i.times_sent, i.portal_viewed_count, i.payment_link,
                  c.name AS client_name
           FROM invoices i
           LEFT JOIN clients c ON c.id = i.client_id
           ${where}
           ORDER BY i.issue_date DESC, i.invoice_number DESC
           LIMIT 500`,
          params,
        );
        const userRows = await api.query('users');
        if (cancelled) return;
        setInvoices(Array.isArray(rows) ? (rows as InvoiceRow[]) : []);
        setUsers(Array.isArray(userRows) ? (userRows as UserRow[]) : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load invoices.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  // ─── Derived ──────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((i) =>
      (i.invoice_number || '').toLowerCase().includes(q) ||
      (i.client_name || '').toLowerCase().includes(q) ||
      (i.status || '').toLowerCase().includes(q));
  }, [invoices, search]);

  const selected = useMemo(
    () => invoices.filter((i) => selectedIds.has(i.id)),
    [invoices, selectedIds],
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allIn = filtered.every((i) => next.has(i.id));
      if (allIn) filtered.forEach((i) => next.delete(i.id));
      else filtered.forEach((i) => next.add(i.id));
      return next;
    });
  }, [filtered]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ─── Generic bulk runner ──────────────────────────────
  const runBulk = useCallback(async (
    label: string,
    fn: (inv: InvoiceRow) => Promise<void> | null,
    predicate?: (inv: InvoiceRow) => boolean,
  ) => {
    const targets = selected.filter((i) => (predicate ? predicate(i) : true));
    if (targets.length === 0) {
      toast.info(`No eligible invoices for "${label}".`);
      return;
    }
    let ok = 0; let fail = 0;
    for (const inv of targets) {
      try {
        const p = fn(inv);
        if (p) await p;
        ok++;
      } catch { fail++; }
    }
    if (fail) toast.error(`${label}: ${ok} updated, ${fail} failed.`);
    else toast.success(`${label}: ${ok} invoice${ok === 1 ? '' : 's'} updated.`);
    clearSelection();
    refresh();
  }, [selected, toast, clearSelection, refresh]);

  // ─── Feature 1: bulk mark-as-sent ─────────────────────
  const bulkMarkSent = () => runBulk(
    'Marked as sent',
    (inv) => api.update('invoices', inv.id, {
      status: 'sent', times_sent: (Number(inv.times_sent) || 0) + 1,
    }),
    (inv) => inv.status === 'draft' || inv.status === 'sent',
  );

  // ─── Feature 2: bulk mark-as-paid (+ payment row) ─────
  const bulkMarkPaid = () => runBulk(
    'Marked as paid',
    (inv) => {
      const total = roundCents(inv.total);
      return (async () => {
        await api.update('invoices', inv.id, { status: 'paid', amount_paid: total });
        const already = roundCents(inv.amount_paid);
        const delta = roundCents(total - already);
        if (delta > 0) {
          await api.create('payments', {
            invoice_id: inv.id, amount: delta, date: todayISO(),
            method: 'manual', notes: 'Bulk mark-as-paid',
          });
        }
      })();
    },
    (inv) => inv.status !== 'paid' && inv.status !== 'cancelled',
  );

  // ─── Feature 3: bulk void/cancel ──────────────────────
  const bulkVoid = async () => {
    if (selected.length === 0) { toast.info('Select invoices to cancel.'); return; }
    if (!window.confirm(`Cancel ${selected.length} invoice(s)? Paid invoices are skipped.`)) return;
    await runBulk(
      'Cancelled',
      (inv) => api.update('invoices', inv.id, { status: 'cancelled' }),
      (inv) => inv.status !== 'paid',
    );
  };

  // ─── Feature 4: bulk delete with undo ─────────────────
  const bulkDelete = async () => {
    if (selected.length === 0) { toast.info('Select invoices to delete.'); return; }
    if (!window.confirm(`Delete ${selected.length} invoice(s)? You can undo.`)) return;
    const ids = selected.map((i) => i.id);
    await batchDeleteWithUndo(toast, 'invoices', ids, { onSuccess: () => { clearSelection(); refresh(); } });
  };

  // ─── Feature 5: bulk priority ─────────────────────────
  const bulkPriority = () => runBulk(
    `Priority → ${priority}`,
    (inv) => api.update('invoices', inv.id, { priority }),
  );

  // ─── Feature 6: bulk tag add / remove ─────────────────
  const bulkTag = (mode: 'add' | 'remove') => {
    const tag = tagInput.trim();
    if (!tag) { toast.info('Enter a tag first.'); return; }
    return runBulk(
      `Tag ${mode === 'add' ? 'added' : 'removed'}: ${tag}`,
      (inv) => {
        const tags = parseTags(inv.tags);
        const has = tags.includes(tag);
        let next: string[];
        if (mode === 'add') { if (has) return null; next = [...tags, tag]; }
        else { if (!has) return null; next = tags.filter((t) => t !== tag); }
        return api.update('invoices', inv.id, { tags: JSON.stringify(next) });
      },
    );
  };

  // ─── Feature 7: bulk assign sales rep ─────────────────
  const bulkAssignRep = () => {
    if (!repId) { toast.info('Choose a sales rep.'); return; }
    return runBulk(
      'Sales rep assigned',
      (inv) => api.update('invoices', inv.id, { sales_rep_id: repId }),
    );
  };

  // ─── Feature 8: bulk due-date shift ───────────────────
  const bulkShiftDue = () => {
    const days = parseInt(shiftDays, 10);
    if (!Number.isFinite(days) || days === 0) { toast.info('Enter a non-zero day count.'); return; }
    return runBulk(
      `Due date shifted ${days > 0 ? '+' : ''}${days}d`,
      (inv) => api.update('invoices', inv.id, { due_date: shiftDate(inv.due_date, days) }),
    );
  };

  // ─── Feature 9: bulk apply late fee ───────────────────
  const bulkLateFee = () => runBulk(
    'Late fee applied',
    (inv) => {
      const pct = Number(inv.late_fee_pct) || 0;
      const fee = roundCents((Number(inv.total) || 0) * (pct / 100));
      if (fee <= 0) return null;
      return api.update('invoices', inv.id, {
        total: roundCents((Number(inv.total) || 0) + fee),
        late_fee_applied: 1,
      });
    },
    (inv) => isOverdue(inv) && !inv.late_fee_applied && (Number(inv.late_fee_pct) || 0) > 0,
  );

  // ─── Feature 10: bulk advance dunning stage ───────────
  const bulkAdvanceDunning = () => runBulk(
    'Dunning stage advanced',
    (inv) => api.update('invoices', inv.id, { dunning_stage: (Number(inv.dunning_stage) || 0) + 1 }),
    (inv) => isOverdue(inv),
  );

  // ─── Feature 22: bulk currency normalize ──────────────
  const bulkCurrency = () => {
    const code = currencyCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) { toast.info('Enter a 3-letter currency code.'); return; }
    return runBulk(
      `Currency → ${code}`,
      (inv) => api.update('invoices', inv.id, { currency: code }),
    );
  };

  // ─── Feature 24: bulk add internal note ───────────────
  const bulkAddNote = () => {
    const note = noteText.trim();
    if (!note) { toast.info('Type a note to append.'); return; }
    const stamp = `[${formatDate(todayISO())}] ${note}`;
    return runBulk(
      'Note appended',
      (inv) => {
        const prev = (inv.internal_notes || '').trim();
        const next = prev ? `${prev}\n${stamp}` : stamp;
        return api.update('invoices', inv.id, { internal_notes: next });
      },
    ).then(() => setNoteText(''));
  };

  // ─── Feature 25: bulk mark-viewed clearing ────────────
  const bulkClearViews = () => runBulk(
    'View tracking reset',
    (inv) => api.update('invoices', inv.id, { portal_viewed_count: 0, last_viewed_at: null }),
    (inv) => (Number(inv.portal_viewed_count) || 0) > 0,
  );

  // ─── Feature 11: duplicate invoice ────────────────────
  const duplicateInvoice = async (inv: InvoiceRow) => {
    try {
      const src: any = await api.get('invoices', inv.id);
      if (!src) { toast.error('Source invoice not found.'); return; }
      const maxNum = nextInvoiceNumber();
      const created: any = await api.create('invoices', {
        ...stripIdFields(src),
        invoice_number: maxNum,
        status: 'draft',
        amount_paid: 0,
        issue_date: todayISO(),
        due_date: shiftDate(todayISO(), 30),
        times_sent: 0,
        portal_viewed_count: 0,
      });
      const newId = created?.id || created;
      if (newId && typeof newId === 'string') {
        const lines = await api.query('invoice_line_items', { invoice_id: inv.id });
        if (Array.isArray(lines)) {
          for (const li of lines as any[]) {
            await api.create('invoice_line_items', { ...stripIdFields(li), invoice_id: newId });
          }
        }
      }
      toast.success(`Duplicated → ${maxNum}.`);
      refresh();
    } catch (e: any) {
      toast.error('Duplicate failed: ' + (e?.message || 'unknown'));
    }
  };

  // ─── Feature 12: convert draft to recurring ───────────
  const convertToRecurring = async (inv: InvoiceRow) => {
    if (inv.status !== 'draft') { toast.info('Only drafts can be templated.'); return; }
    try {
      const src: any = await api.get('invoices', inv.id);
      const tpl: any = await api.create('recurring_templates', {
        client_id: src?.client_id ?? inv.client_id,
        amount: roundCents(inv.total),
        frequency: 'monthly',
        next_run_date: shiftDate(todayISO(), 30),
        status: 'active',
        source_invoice_id: inv.id,
      });
      const tplId = tpl?.id || tpl;
      await api.update('invoices', inv.id, {
        is_recurring: 1,
        recurring_template_id: typeof tplId === 'string' ? tplId : null,
      });
      toast.success('Recurring template created.');
      refresh();
    } catch (e: any) {
      toast.error('Convert failed: ' + (e?.message || 'unknown'));
    }
  };

  // ─── Feature 13: quick partial-payment recorder ───────
  const recordPartial = async (inv: InvoiceRow) => {
    const amt = roundCents(partialAmt);
    if (!(amt > 0)) { toast.info('Enter a positive amount.'); return; }
    try {
      await api.create('payments', {
        invoice_id: inv.id, amount: amt, date: todayISO(), method: 'manual', notes: 'Partial payment',
      });
      const paid = roundCents((Number(inv.amount_paid) || 0) + amt);
      const total = roundCents(inv.total);
      const status = paid >= total ? 'paid' : 'partial';
      await api.update('invoices', inv.id, { amount_paid: paid, status });
      toast.success(`Recorded ${formatCurrency(amt)} → ${status}.`);
      setPartialFor(null); setPartialAmt(''); refresh();
    } catch (e: any) {
      toast.error('Payment failed: ' + (e?.message || 'unknown'));
    }
  };

  // ─── Feature 14: one-click write-off ──────────────────
  const writeOff = async (inv: InvoiceRow) => {
    if (!window.confirm(`Write off remaining balance on ${inv.invoice_number || 'invoice'}?`)) return;
    try {
      const total = roundCents(inv.total);
      await api.update('invoices', inv.id, {
        amount_paid: total,
        status: 'paid',
        internal_notes: ((inv.internal_notes || '').trim() + `\n[${formatDate(todayISO())}] Balance written off`).trim(),
      });
      toast.info('Balance written off · ⌘Z to undo not available — re-open to revert', { duration: 6000 });
      refresh();
    } catch (e: any) {
      toast.error('Write-off failed: ' + (e?.message || 'unknown'));
    }
  };

  // ─── Feature 15: copy number / link to clipboard ──────
  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label}.`);
    } catch {
      toast.error('Clipboard unavailable.');
    }
  };

  // ─── Feature 16: inline status quick-edit ─────────────
  const quickStatus = async (inv: InvoiceRow, status: string) => {
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status } : i))); // optimistic
    try {
      await api.update('invoices', inv.id, { status });
    } catch {
      toast.error('Status update failed.');
      refresh();
    }
  };

  // ─── Feature 17: inline due-date quick-edit ───────────
  const quickDueDate = async (inv: InvoiceRow, due: string) => {
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, due_date: due } : i)));
    try {
      await api.update('invoices', inv.id, { due_date: due });
    } catch {
      toast.error('Due-date update failed.');
      refresh();
    }
  };

  // ─── Feature 18: next-invoice-number suggester ────────
  const nextInvoiceNumber = useCallback((): string => {
    let maxN = 0; let prefix = 'INV-'; let width = 4;
    for (const inv of invoices) {
      const num = inv.invoice_number || '';
      const m = num.match(/^(.*?)(\d+)\s*$/);
      if (m) {
        const n = parseInt(m[2], 10);
        if (Number.isFinite(n) && n >= maxN) { maxN = n; prefix = m[1] || prefix; width = Math.max(width, m[2].length); }
      }
    }
    const next = String(maxN + 1).padStart(width, '0');
    return `${prefix}${next}`;
  }, [invoices]);

  const suggestNumber = () => setNewNumber(nextInvoiceNumber());

  // ─── Feature 19: duplicate-number validator ───────────
  const numberCollision = useMemo(() => {
    const n = newNumber.trim();
    if (!n) return false;
    return invoices.some((i) => (i.invoice_number || '').trim() === n);
  }, [newNumber, invoices]);

  // ─── Feature 23: snooze / follow-up reminder ──────────
  const setFollowup = (id: string, date: string) => {
    const next = { ...followups };
    if (date) next[id] = date; else delete next[id];
    setFollowups(next);
    saveFollowups(next);
    toast.success(date ? `Follow-up set for ${formatDate(date)}.` : 'Follow-up cleared.');
  };

  const dueForFollowup = (id: string): boolean => {
    const d = followups[id];
    return !!d && d <= todayISO();
  };

  // ─── Feature 20: keyboard shortcuts ───────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === '?') { setShowShortcuts((s) => !s); return; }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'j') { setActiveRow((r) => Math.min(filtered.length - 1, r + 1)); return; }
      if (e.key === 'k') { setActiveRow((r) => Math.max(0, r - 1)); return; }
      if (e.key === 'x') {
        const row = filtered[activeRow];
        if (row) toggle(row.id);
        return;
      }
      if (e.key === 'Escape') { setShowShortcuts(false); clearSelection(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, activeRow, toggle, clearSelection]);

  // ─── Feature: CSV export of selection ─────────────────
  const exportCsv = () => {
    const rows = (selected.length ? selected : filtered).map((i) => ({
      invoice_number: i.invoice_number || '',
      client: i.client_name || '',
      status: i.status || '',
      total: roundCents(i.total),
      amount_paid: roundCents(i.amount_paid),
      balance: roundCents((Number(i.total) || 0) - (Number(i.amount_paid) || 0)),
      due_date: i.due_date || '',
      overdue: isOverdue(i) ? 'yes' : 'no',
    }));
    if (rows.length === 0) { toast.info('Nothing to export.'); return; }
    downloadCSVBlob(rows, `invoices-${todayISO()}`);
    toast.success(`Exported ${rows.length} row(s).`);
  };

  // ─── Render ───────────────────────────────────────────
  const selCount = selectedIds.size;
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id));

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 className="text-text-primary" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Bulk Actions &amp; Productivity
        </h2>
        <span className="text-text-muted" style={{ fontSize: 12 }}>
          {loading ? 'Loading…' : `${invoices.length} invoices · ${selCount} selected`}
        </span>
      </div>

      {error && (
        <div className="block-card" style={{ padding: 12, borderColor: 'var(--color-accent-expense)' }}>
          <span style={{ color: 'var(--color-accent-expense)', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <AlertTriangle size={14} /> {error}
          </span>
        </div>
      )}

      {/* ── Selection / search / select-all-in-filter (#21) ── */}
      <FeatureCard
        icon={<Search size={15} />}
        title="Selection workspace"
        hint="Search live invoices, toggle rows, or select every match in the current filter. Selection drives all bulk actions below. Press ? for shortcuts."
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input
            ref={searchRef}
            className="block-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Search number, client, status…  (press /)"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setActiveRow(0); }}
          />
          <label className="text-text-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={allFilteredSelected} onChange={selectAllFiltered} />
            Select all {filtered.length} in filter
          </label>
          <button type="button" className="block-btn" onClick={clearSelection}>Clear</button>
        </div>

        {loading ? (
          <p className="text-text-muted" style={{ fontSize: 12 }}>Loading invoices…</p>
        ) : filtered.length === 0 ? (
          <p className="text-text-muted" style={{ fontSize: 12 }}>No invoices match.</p>
        ) : (
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="block-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Number</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                  <th>Quick actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((inv, idx) => {
                  const st = formatStatus(inv.status);
                  const bal = roundCents((Number(inv.total) || 0) - (Number(inv.amount_paid) || 0));
                  const collision = false;
                  return (
                    <tr
                      key={inv.id}
                      style={idx === activeRow ? { outline: '1px solid var(--accent-primary)' } : undefined}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(inv.id)}
                          onChange={() => toggle(inv.id)}
                        />
                      </td>
                      <td>
                        <span className="text-text-primary" style={{ fontSize: 12 }}>
                          {inv.invoice_number || '—'}
                        </span>
                        {dueForFollowup(inv.id) && (
                          <span className="block-badge block-badge-warning" style={{ marginLeft: 6 }}>FOLLOW-UP</span>
                        )}
                        {isOverdue(inv) && (
                          <span className="block-badge block-badge-expense" style={{ marginLeft: 6 }}>OVERDUE</span>
                        )}
                      </td>
                      <td className="text-text-secondary" style={{ fontSize: 12 }}>{inv.client_name || '—'}</td>
                      <td>
                        {/* #16 inline status quick-edit */}
                        <select
                          className="block-select text-xs"
                          value={inv.status || 'draft'}
                          onChange={(e) => quickStatus(inv, e.target.value)}
                        >
                          {['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'].map((s) => (
                            <option key={s} value={s}>{formatStatus(s).label}</option>
                          ))}
                        </select>
                        {!collision && <span className={st.className} style={{ display: 'none' }}>{st.label}</span>}
                      </td>
                      <td>
                        {/* #17 inline due-date quick-edit */}
                        <input
                          type="date"
                          className="block-input text-xs"
                          value={inv.due_date || ''}
                          onChange={(e) => quickDueDate(inv, e.target.value)}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }} className="text-text-primary">{formatCurrency(bal)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          {/* #15 copy */}
                          <button type="button" className="block-btn" title="Copy number"
                            onClick={() => copyText(inv.invoice_number || '', 'number')}>
                            <Copy size={12} />
                          </button>
                          {inv.payment_link && (
                            <button type="button" className="block-btn" title="Copy payment link"
                              onClick={() => copyText(inv.payment_link || '', 'link')}>
                              <ClipboardCopy size={12} />
                            </button>
                          )}
                          {/* #11 duplicate */}
                          <button type="button" className="block-btn" title="Duplicate"
                            onClick={() => duplicateInvoice(inv)}>
                            <FileText size={12} />
                          </button>
                          {/* #12 convert to recurring */}
                          <button type="button" className="block-btn" title="Convert draft → recurring"
                            onClick={() => convertToRecurring(inv)}>
                            <RefreshCw size={12} />
                          </button>
                          {/* #13 partial payment */}
                          <button type="button" className="block-btn" title="Record partial payment"
                            onClick={() => { setPartialFor(inv.id); setPartialAmt(''); }}>
                            <DollarSign size={12} />
                          </button>
                          {/* #14 write-off */}
                          <button type="button" className="block-btn" title="Write off balance"
                            onClick={() => writeOff(inv)}>
                            <Ban size={12} />
                          </button>
                          {/* #23 follow-up snooze */}
                          <input
                            type="date"
                            className="block-input text-xs"
                            style={{ width: 130 }}
                            title="Set follow-up reminder"
                            value={followups[inv.id] || ''}
                            onChange={(e) => setFollowup(inv.id, e.target.value)}
                          />
                          {partialFor === inv.id && (
                            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              <input
                                className="block-input text-xs"
                                style={{ width: 90 }}
                                placeholder="Amount"
                                value={partialAmt}
                                onChange={(e) => setPartialAmt(e.target.value)}
                              />
                              <button type="button" className="block-btn-primary" onClick={() => recordPartial(inv)}>Save</button>
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 100 && (
              <p className="text-text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                Showing first 100 of {filtered.length}. Use "Select all in filter" to act on every match.
              </p>
            )}
          </div>
        )}
      </FeatureCard>

      {/* ── Bulk status actions (#1, #2, #3, #4) ── */}
      <FeatureCard
        icon={<CheckCircle size={15} />}
        title="Bulk status actions"
        hint={`Acts on the ${selCount} selected invoice(s).`}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="block-btn" onClick={bulkMarkSent} disabled={!selCount}>
            <Send size={12} /> Mark as sent
          </button>
          <button type="button" className="block-btn" onClick={bulkMarkPaid} disabled={!selCount}>
            <CheckCircle size={12} /> Mark as paid
          </button>
          <button type="button" className="block-btn" onClick={bulkVoid} disabled={!selCount}>
            <Ban size={12} /> Cancel / void
          </button>
          <button type="button" className="block-btn" onClick={bulkDelete} disabled={!selCount}>
            <Trash2 size={12} /> Delete (undo)
          </button>
        </div>
      </FeatureCard>

      {/* ── Bulk metadata (#5, #6, #7) ── */}
      <FeatureCard icon={<Flag size={15} />} title="Bulk metadata">
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="text-text-secondary" style={{ fontSize: 12, width: 90 }}>Priority</span>
            <select className="block-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <button type="button" className="block-btn" onClick={bulkPriority} disabled={!selCount}>Apply</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="text-text-secondary" style={{ fontSize: 12, width: 90 }}>
              <TagIcon size={12} style={{ verticalAlign: 'middle' }} /> Tag
            </span>
            <input className="block-input" style={{ width: 160 }} placeholder="tag name" value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
            <button type="button" className="block-btn" onClick={() => bulkTag('add')} disabled={!selCount}>Add</button>
            <button type="button" className="block-btn" onClick={() => bulkTag('remove')} disabled={!selCount}>Remove</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="text-text-secondary" style={{ fontSize: 12, width: 90 }}>
              <UserCheck size={12} style={{ verticalAlign: 'middle' }} /> Sales rep
            </span>
            <select className="block-select" value={repId} onChange={(e) => setRepId(e.target.value)}>
              <option value="">— choose —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.id}</option>)}
            </select>
            <button type="button" className="block-btn" onClick={bulkAssignRep} disabled={!selCount}>Assign</button>
          </div>
        </div>
      </FeatureCard>

      {/* ── Collections & scheduling (#8, #9, #10, #25) ── */}
      <FeatureCard icon={<CalendarClock size={15} />} title="Collections &amp; scheduling">
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="text-text-secondary" style={{ fontSize: 12, width: 110 }}>Shift due date</span>
            <input className="block-input" style={{ width: 80 }} value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} />
            <span className="text-text-muted" style={{ fontSize: 11 }}>days (±)</span>
            <button type="button" className="block-btn" onClick={bulkShiftDue} disabled={!selCount}>
              <CalendarClock size={12} /> Shift
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="block-btn" onClick={bulkLateFee} disabled={!selCount}>
              <Percent size={12} /> Apply late fee (overdue only)
            </button>
            <button type="button" className="block-btn" onClick={bulkAdvanceDunning} disabled={!selCount}>
              <Bell size={12} /> Advance dunning stage
            </button>
            <button type="button" className="block-btn" onClick={bulkClearViews} disabled={!selCount}>
              <Eye size={12} /> Reset view tracking
            </button>
          </div>
        </div>
      </FeatureCard>

      {/* ── Cleanup & docs (#22, #24) ── */}
      <FeatureCard icon={<StickyNote size={15} />} title="Cleanup &amp; documentation">
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="text-text-secondary" style={{ fontSize: 12, width: 110 }}>Normalize currency</span>
            <input className="block-input" style={{ width: 80 }} value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} maxLength={3} />
            <button type="button" className="block-btn" onClick={bulkCurrency} disabled={!selCount}>Apply</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className="text-text-secondary" style={{ fontSize: 12, width: 110, paddingTop: 6 }}>
              <StickyNote size={12} style={{ verticalAlign: 'middle' }} /> Internal note
            </span>
            <input className="block-input" style={{ flex: 1, minWidth: 180 }} placeholder="appended with timestamp" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button type="button" className="block-btn" onClick={bulkAddNote} disabled={!selCount}>Append</button>
          </div>
        </div>
      </FeatureCard>

      {/* ── Numbering helpers (#18, #19) ── */}
      <FeatureCard
        icon={<FileText size={15} />}
        title="Next-number suggester &amp; collision check"
        hint="Scans existing invoice numbers to propose the next, and warns on duplicates before you save."
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="block-input"
            style={{ width: 200 }}
            placeholder="invoice number"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
          />
          <button type="button" className="block-btn" onClick={suggestNumber}>Suggest next</button>
          {newNumber.trim() && (
            numberCollision
              ? <span className="block-badge block-badge-expense">DUPLICATE — already exists</span>
              : <span className="block-badge block-badge-income">AVAILABLE</span>
          )}
        </div>
      </FeatureCard>

      {/* ── Export (#CSV) ── */}
      <FeatureCard
        icon={<Download size={15} />}
        title="Export to CSV"
        hint="Exports the selected invoices (or all filtered if none selected) with computed balance + overdue flags."
      >
        <button type="button" className="block-btn-primary" onClick={exportCsv}>
          <Download size={12} /> Export {selCount ? `${selCount} selected` : `${filtered.length} filtered`}
        </button>
      </FeatureCard>

      {/* ── Keyboard shortcuts (#20) ── */}
      <FeatureCard icon={<Keyboard size={15} />} title="Keyboard shortcuts">
        <button type="button" className="block-btn" onClick={() => setShowShortcuts((s) => !s)}>
          <Keyboard size={12} /> {showShortcuts ? 'Hide' : 'Show'} shortcuts ( ? )
        </button>
        {showShortcuts && (
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
            {[
              ['/', 'Focus search'],
              ['j / k', 'Move active row'],
              ['x', 'Toggle select active row'],
              ['?', 'Toggle this help'],
              ['Esc', 'Clear selection / close'],
            ].map(([k, d]) => (
              <div key={k} className="text-text-secondary" style={{ fontSize: 12, display: 'flex', gap: 8 }}>
                <kbd className="block-badge" style={{ minWidth: 40, textAlign: 'center' }}>{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-text-muted" style={{ fontSize: 11, marginTop: 8 }}>
          <AlarmClock size={11} style={{ verticalAlign: 'middle' }} /> Active row #{activeRow + 1} of {filtered.length}
        </p>
      </FeatureCard>
    </section>
  );
}

// ─── module-scope helpers ───────────────────────────────
function stripIdFields(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...row };
  delete out.id;
  delete out.created_at;
  delete out.updated_at;
  return out;
}
