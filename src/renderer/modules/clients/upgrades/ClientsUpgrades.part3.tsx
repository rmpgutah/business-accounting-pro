import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Users,
  Tag,
  Trash2,
  Download,
  Copy,
  Star,
  Plus,
  Mail,
  Undo2,
  Wand2,
  RefreshCw,
  Layers,
  StickyNote,
  CheckSquare,
  Briefcase,
  Sparkles,
  Search,
} from 'lucide-react';
import api from '../../../lib/api';
import { formatCurrency, formatStatus } from '../../../lib/format';
import { useCompanyStore } from '../../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  payment_terms: number;
  notes: string;
  tags: string;
  custom_fields: string;
  state: string;
  country: string;
  address_line1: string;
  address_line2: string;
  city: string;
  zip: string;
  created_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
}

type ClientStatus = 'active' | 'inactive' | 'prospect';

interface UndoSnapshot {
  label: string;
  rows: Array<{ id: string; data: Record<string, any> }>;
}

const STARRED_KEY = 'bap-clients-starred';
const STATUS_CYCLE: ClientStatus[] = ['active', 'inactive', 'prospect'];

// ─── Helpers ────────────────────────────────────────────
function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function parseCustomFields(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadStarred(): Set<string> {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveStarred(set: Set<string>): void {
  try {
    localStorage.setItem(STARRED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore quota errors */
  }
}

function csvEscape(value: string | number | null | undefined): string {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Component ──────────────────────────────────────────
const ClientsUpgradesPart3: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id;

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [revenueByClient, setRevenueByClient] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [starred, setStarred] = useState<Set<string>>(() => loadStarred());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ClientStatus>('all');

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);

  // Feature 1/2/4/6/15 control values
  const [bulkStatus, setBulkStatus] = useState<ClientStatus>('active');
  const [bulkTerms, setBulkTerms] = useState<number>(30);
  const [tagValue, setTagValue] = useState('');
  const [industryValue, setIndustryValue] = useState('');
  const [stateValue, setStateValue] = useState('');
  const [noteValue, setNoteValue] = useState('');
  const [projectChoice, setProjectChoice] = useState('');

  // Feature 5 typed-confirm delete
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // Feature 10 quick-add
  const [qaName, setQaName] = useState('');
  const [qaEmail, setQaEmail] = useState('');

  // Feature 22 quick-note drawer
  const [noteDrawerId, setNoteDrawerId] = useState<string | null>(null);
  const [drawerNote, setDrawerNote] = useState('');

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3200);
  }, []);

  // ─── Load ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!companyId) {
        setClients([]);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const rows = (await api.query('clients', { company_id: companyId })) as ClientRow[];
        if (cancelled) return;
        setClients(Array.isArray(rows) ? rows : []);

        try {
          const projRows = (await api.query('projects', { company_id: companyId })) as ProjectRow[];
          if (!cancelled) setProjects(Array.isArray(projRows) ? projRows : []);
        } catch {
          /* projects optional */
        }

        try {
          const revRows = (await api.rawQuery(
            `SELECT client_id, COALESCE(SUM(total), 0) AS rev
             FROM invoices WHERE company_id = ? AND client_id IS NOT NULL
             GROUP BY client_id`,
            [companyId]
          )) as Array<{ client_id: string; rev: number }>;
          if (!cancelled && Array.isArray(revRows)) {
            const map: Record<string, number> = {};
            for (const r of revRows) map[r.client_id] = Number(r.rev) || 0;
            setRevenueByClient(map);
          }
        } catch {
          /* revenue optional */
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load clients');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // ─── Derived: filtered + sorted (starred float to top) ─
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return clients
      .filter((c) => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (!term) return true;
        return (
          (c.name || '').toLowerCase().includes(term) ||
          (c.email || '').toLowerCase().includes(term) ||
          (c.phone || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        const sa = starred.has(a.id) ? 0 : 1;
        const sb = starred.has(b.id) ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return (a.name || '').localeCompare(b.name || '');
      });
  }, [clients, search, statusFilter, starred]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedRows = useMemo(
    () => clients.filter((c) => selected.has(c.id)),
    [clients, selected]
  );

  // ─── Selection helpers ─────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Feature 7: select all matching the current filter (not just a page)
  const selectAllFiltered = useCallback(() => {
    setSelected(new Set(filtered.map((c) => c.id)));
  }, [filtered]);

  // ─── Snapshot + batchUpdate (Feature 21 undo support) ──
  const snapshotFields = useCallback(
    (ids: string[], fields: string[]): UndoSnapshot['rows'] => {
      const byId = new Map(clients.map((c) => [c.id, c]));
      return ids.map((id) => {
        const row = byId.get(id) as Record<string, any> | undefined;
        const data: Record<string, any> = {};
        for (const f of fields) data[f] = row ? row[f] : undefined;
        return { id, data };
      });
    },
    [clients]
  );

  const runBatch = useCallback(
    async (ids: string[], data: Record<string, any>, label: string, undoFields: string[]) => {
      if (!ids.length) {
        flash('No clients selected.');
        return;
      }
      setBusy(true);
      try {
        const prior = snapshotFields(ids, undoFields);
        await api.batchUpdate('clients', ids, data);
        setUndo({ label, rows: prior });
        flash(`${label} applied to ${ids.length} client${ids.length === 1 ? '' : 's'}.`);
        refresh();
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Bulk action failed.');
      } finally {
        setBusy(false);
      }
    },
    [flash, refresh, snapshotFields]
  );

  // Feature 21: undo last bulk action
  const handleUndo = useCallback(async () => {
    if (!undo) return;
    setBusy(true);
    try {
      await Promise.all(undo.rows.map((r) => api.update('clients', r.id, r.data)));
      flash(`Reverted: ${undo.label}.`);
      setUndo(null);
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Undo failed.');
    } finally {
      setBusy(false);
    }
  }, [undo, flash, refresh]);

  // ─── Feature 1: bulk status ────────────────────────────
  const applyBulkStatus = () => runBatch(selectedIds, { status: bulkStatus }, `Status → ${bulkStatus}`, ['status']);

  // ─── Feature 2: bulk payment terms ─────────────────────
  const applyBulkTerms = () =>
    runBatch(selectedIds, { payment_terms: bulkTerms }, `Net-${bulkTerms} terms`, ['payment_terms']);

  // ─── Feature 6: bulk state correction ──────────────────
  const applyBulkState = () => {
    const v = stateValue.trim().toUpperCase();
    if (!v) {
      flash('Enter a state/region value.');
      return;
    }
    runBatch(selectedIds, { state: v }, `State → ${v}`, ['state']);
  };

  // ─── Feature 13: bulk mark inactive (dormant cleanup) ──
  const markDormantInactive = () => {
    const dormantIds = selectedRows.filter((c) => c.status !== 'inactive').map((c) => c.id);
    runBatch(dormantIds, { status: 'inactive' }, 'Archive (inactive)', ['status']);
  };

  // ─── Feature 3: bulk add/remove tag (read-modify-write) ─
  const mutateTag = async (mode: 'add' | 'remove') => {
    const tag = tagValue.trim();
    if (!tag) {
      flash('Enter a tag.');
      return;
    }
    if (!selectedIds.length) {
      flash('No clients selected.');
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        selectedRows.map((c) => {
          const tags = parseTags(c.tags);
          const has = tags.includes(tag);
          let next = tags;
          if (mode === 'add' && !has) next = [...tags, tag];
          if (mode === 'remove' && has) next = tags.filter((t) => t !== tag);
          if (next === tags) return Promise.resolve(undefined);
          return api.update('clients', c.id, { tags: JSON.stringify(next) });
        })
      );
      flash(`Tag "${tag}" ${mode === 'add' ? 'added to' : 'removed from'} ${selectedIds.length} clients.`);
      setTagValue('');
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Tag update failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 4: bulk industry/segment into custom_fields ─
  const applyIndustry = async () => {
    const v = industryValue.trim();
    if (!v) {
      flash('Enter an industry/segment.');
      return;
    }
    if (!selectedIds.length) {
      flash('No clients selected.');
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        selectedRows.map((c) => {
          const cf = parseCustomFields(c.custom_fields);
          cf.industry = v;
          return api.update('clients', c.id, { custom_fields: JSON.stringify(cf) });
        })
      );
      flash(`Industry "${v}" assigned to ${selectedIds.length} clients.`);
      setIndustryValue('');
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Industry update failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 15: bulk append timestamped note ──────────
  const appendNote = async () => {
    const v = noteValue.trim();
    if (!v) {
      flash('Enter a note.');
      return;
    }
    if (!selectedIds.length) {
      flash('No clients selected.');
      return;
    }
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await Promise.all(
        selectedRows.map((c) => {
          const existing = (c.notes || '').trim();
          const line = `[${stamp}] ${v}`;
          const next = existing ? `${existing}\n${line}` : line;
          return api.update('clients', c.id, { notes: next });
        })
      );
      flash(`Note appended to ${selectedIds.length} clients.`);
      setNoteValue('');
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Note append failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 23: bulk normalize/hygiene ────────────────
  const normalizeFields = async () => {
    if (!selectedIds.length) {
      flash('No clients selected.');
      return;
    }
    setBusy(true);
    try {
      let changed = 0;
      await Promise.all(
        selectedRows.map((c) => {
          const name = (c.name || '').replace(/\s+/g, ' ').trim();
          const email = (c.email || '').trim().toLowerCase();
          const phone = (c.phone || '').trim();
          if (name === c.name && email === c.email && phone === c.phone) return Promise.resolve(undefined);
          changed += 1;
          return api.update('clients', c.id, { name, email, phone });
        })
      );
      flash(changed ? `Normalized ${changed} client record(s).` : 'All selected records already clean.');
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Normalize failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 20: recompute tier from lifetime revenue ──
  const recomputeTiers = async () => {
    if (!selectedIds.length) {
      flash('No clients selected.');
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        selectedRows.map((c) => {
          const rev = revenueByClient[c.id] || 0;
          const tier = rev >= 50000 ? 'A' : rev >= 10000 ? 'B' : rev >= 1000 ? 'C' : 'D';
          const cf = parseCustomFields(c.custom_fields);
          cf.tier = tier;
          return api.update('clients', c.id, { custom_fields: JSON.stringify(cf) });
        })
      );
      flash(`Tier recomputed for ${selectedIds.length} clients.`);
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Tier recompute failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 18: bulk assign to project ────────────────
  const assignToProject = async () => {
    if (!projectChoice) {
      flash('Choose a project.');
      return;
    }
    if (!selectedIds.length) {
      flash('No clients selected.');
      return;
    }
    // A project belongs to one client; assigning a project to multiple clients
    // is not meaningful, so apply to the first selected client and warn otherwise.
    setBusy(true);
    try {
      const target = selectedRows[0];
      await api.update('projects', projectChoice, { client_id: target.id });
      flash(
        selectedIds.length > 1
          ? `Project linked to "${target.name}" (projects map to a single client).`
          : `Project linked to "${target.name}".`
      );
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Project assign failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 5: bulk soft-delete (typed confirm) ───────
  const performDelete = async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') {
      flash('Type DELETE to confirm.');
      return;
    }
    setBusy(true);
    try {
      await Promise.all(selectedIds.map((id) => api.remove('clients', id)));
      flash(`Deleted ${selectedIds.length} client(s).`);
      setDeleteConfirm(false);
      setConfirmText('');
      clearSelection();
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 9: duplicate detector ─────────────────────
  const duplicates = useMemo(() => {
    const byEmail = new Map<string, ClientRow[]>();
    const byName = new Map<string, ClientRow[]>();
    for (const c of clients) {
      const e = (c.email || '').trim().toLowerCase();
      const n = (c.name || '').trim().toLowerCase();
      if (e) byEmail.set(e, [...(byEmail.get(e) || []), c]);
      if (n) byName.set(n, [...(byName.get(n) || []), c]);
    }
    const groups: Array<{ key: string; by: 'email' | 'name'; rows: ClientRow[] }> = [];
    for (const [k, rows] of byEmail) if (rows.length > 1) groups.push({ key: k, by: 'email', rows });
    for (const [k, rows] of byName) if (rows.length > 1) groups.push({ key: k, by: 'name', rows });
    return groups;
  }, [clients]);

  const mergeDuplicate = async (group: { rows: ClientRow[] }) => {
    if (group.rows.length < 2) return;
    const [keep, ...dupes] = group.rows;
    if (!window.confirm(`Merge ${dupes.length} duplicate(s) into "${keep.name}"? Invoices will be reassigned.`)) return;
    setBusy(true);
    try {
      for (const dup of dupes) {
        await api.rawQuery('UPDATE invoices SET client_id = ? WHERE client_id = ? AND company_id = ?', [
          keep.id,
          dup.id,
          companyId,
        ]);
        await api.remove('clients', dup.id);
      }
      flash(`Merged ${dupes.length} duplicate(s) into "${keep.name}".`);
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Merge failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 10: quick-add client ──────────────────────
  const quickAdd = async () => {
    const name = qaName.trim();
    if (!name) {
      flash('Name is required.');
      return;
    }
    setBusy(true);
    try {
      await api.create('clients', { name, email: qaEmail.trim().toLowerCase(), status: 'prospect' });
      flash(`Added "${name}".`);
      setQaName('');
      setQaEmail('');
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Add failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 11: copy details to clipboard ─────────────
  const copyDetails = async (c: ClientRow) => {
    const lines = [
      c.name,
      c.email,
      c.phone,
      [c.address_line1, c.address_line2].filter(Boolean).join(' '),
      [c.city, c.state, c.zip].filter(Boolean).join(', '),
      c.country,
    ]
      .filter((l) => l && l.trim())
      .join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      flash(`Copied details for "${c.name}".`);
    } catch {
      flash('Clipboard unavailable.');
    }
  };

  // ─── Feature 12: convert prospect → active ─────────────
  const convertProspect = async (c: ClientRow) => {
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const note = (c.notes || '').trim();
      const wonLine = `[${stamp}] Won — converted from prospect to active`;
      await api.update('clients', c.id, {
        status: 'active',
        notes: note ? `${note}\n${wonLine}` : wonLine,
      });
      flash(`"${c.name}" converted to active.`);
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Convert failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 14: duplicate-as-template ─────────────────
  const cloneAsTemplate = async (c: ClientRow) => {
    setBusy(true);
    try {
      await api.create('clients', {
        name: `${c.name} (copy)`,
        email: '',
        payment_terms: c.payment_terms ?? 30,
        tags: c.tags || '[]',
        custom_fields: c.custom_fields || '{}',
        status: 'prospect',
      });
      flash(`Template created from "${c.name}".`);
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Clone failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 17: star toggle (localStorage) ────────────
  const toggleStar = useCallback((id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveStarred(next);
      return next;
    });
  }, []);

  // ─── Feature 19: open client email in mail app ─────────
  const emailClient = async (c: ClientRow) => {
    if (!c.email) {
      flash('No email on file.');
      return;
    }
    const rev = revenueByClient[c.id] || 0;
    const subject = encodeURIComponent(`Regarding your account (${formatCurrency(rev)} lifetime)`);
    const url = `mailto:${c.email}?subject=${subject}`;
    try {
      const res = await api.shellOpenExternal(url);
      if (!res?.ok) window.open(url);
    } catch {
      window.open(url);
    }
  };

  // ─── Feature 24: inline status badge cycle ─────────────
  const cycleStatus = async (c: ClientRow) => {
    const idx = STATUS_CYCLE.indexOf(c.status as ClientStatus);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setBusy(true);
    try {
      await api.update('clients', c.id, { status: next });
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Status change failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 8: inline quick-edit persist ──────────────
  const inlineEdit = async (id: string, field: 'name' | 'email' | 'phone' | 'payment_terms', raw: string) => {
    const row = clients.find((c) => c.id === id);
    if (!row) return;
    let value: string | number = raw;
    if (field === 'payment_terms') value = Math.max(0, parseInt(raw, 10) || 0);
    if (field === 'email') value = raw.trim().toLowerCase();
    if (field === 'name') value = raw.replace(/\s+/g, ' ').trim();
    if (String((row as any)[field]) === String(value)) return;
    try {
      await api.update('clients', id, { [field]: value });
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Edit failed.');
    }
  };

  // ─── Feature 22: quick-note drawer save ────────────────
  const openNoteDrawer = (c: ClientRow) => {
    setNoteDrawerId(c.id);
    setDrawerNote(c.notes || '');
  };
  const saveNoteDrawer = async () => {
    if (!noteDrawerId) return;
    setBusy(true);
    try {
      await api.update('clients', noteDrawerId, { notes: drawerNote });
      flash('Note saved.');
      setNoteDrawerId(null);
      refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Feature 16: keyboard shortcuts ────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        const el = document.getElementById('cu3-search') as HTMLInputElement | null;
        el?.focus();
      } else if (e.key === 'Escape') {
        if (noteDrawerId) setNoteDrawerId(null);
        else if (deleteConfirm) setDeleteConfirm(false);
        else clearSelection();
      } else if ((e.key === 'a' || e.key === 'A') && !typing && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        selectAllFiltered();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [noteDrawerId, deleteConfirm, clearSelection, selectAllFiltered]);

  // ─── Feature: export selected/filtered to CSV ──────────
  const exportCsv = () => {
    const rows = selectedRows.length ? selectedRows : filtered;
    if (!rows.length) {
      flash('Nothing to export.');
      return;
    }
    const header = ['Name', 'Email', 'Phone', 'Status', 'Terms', 'State', 'Lifetime Revenue'];
    const lines = [header.join(',')];
    for (const c of rows) {
      lines.push(
        [
          csvEscape(c.name),
          csvEscape(c.email),
          csvEscape(c.phone),
          csvEscape(c.status),
          csvEscape(`Net-${c.payment_terms ?? 30}`),
          csvEscape(c.state),
          csvEscape((revenueByClient[c.id] || 0).toFixed(2)),
        ].join(',')
      );
    }
    downloadBlob(`clients-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv;charset=utf-8;');
    flash(`Exported ${rows.length} client(s).`);
  };

  // ─── Render helpers ────────────────────────────────────
  const cardTitle = (icon: React.ReactNode, title: string, sub?: string) => (
    <div className="mb-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider">{title}</h4>
      </div>
      {sub && <p className="text-[11px] text-text-muted mt-1">{sub}</p>}
    </div>
  );

  const selCount = selected.size;

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-text-muted font-mono">Loading bulk tools…</div>
    );
  }

  if (!companyId) {
    return (
      <div className="py-8 text-center text-sm text-text-muted font-mono">
        Select a company to use bulk tools.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider" style={{ letterSpacing: '0.08em' }}>
        Bulk Actions & Productivity
      </h3>

      {error && (
        <div className="block-card p-3 text-xs text-accent-expense" style={{ borderRadius: '6px' }}>
          {error}
        </div>
      )}

      {toast && (
        <div
          className="block-card p-3 text-xs text-text-primary flex items-center justify-between gap-3"
          style={{ borderRadius: '6px', borderLeft: '2px solid var(--color-accent-blue)' }}
        >
          <span>{toast}</span>
          {undo && (
            <button className="block-btn text-[11px] inline-flex items-center gap-1" disabled={busy} onClick={handleUndo}>
              <Undo2 size={11} /> Undo
            </button>
          )}
        </div>
      )}

      {/* ─── Search + select-all-filtered + export (Features 7, CSV) ─── */}
      <div className="block-card">
        {cardTitle(<Search size={12} className="text-text-muted" />, 'Search & Select', `${clients.length} clients total — press "/" to focus search`)}
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="cu3-search"
            className="block-input text-xs flex-1 min-w-[160px]"
            placeholder="Search name / email / phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="block-select text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | ClientStatus)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="prospect">Prospect</option>
          </select>
          <button className="block-btn text-xs inline-flex items-center gap-1" onClick={selectAllFiltered}>
            <CheckSquare size={12} /> Select all {filtered.length}
          </button>
          <button className="block-btn text-xs" onClick={clearSelection} disabled={!selCount}>
            Clear ({selCount})
          </button>
          <button className="block-btn text-xs inline-flex items-center gap-1" onClick={exportCsv}>
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {/* ─── Bulk toolbar (Features 1,2,3,4,6,13,15,20,23,5) ─── */}
      <div className="block-card">
        {cardTitle(
          <Layers size={12} className="text-text-muted" />,
          'Bulk Operations',
          selCount ? `${selCount} client${selCount === 1 ? '' : 's'} selected` : 'Select clients below to enable bulk actions'
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Feature 1 */}
          <div className="flex items-center gap-2">
            <select className="block-select text-xs flex-1" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as ClientStatus)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="prospect">Prospect</option>
            </select>
            <button className="block-btn text-xs" disabled={busy || !selCount} onClick={applyBulkStatus}>Set status</button>
          </div>

          {/* Feature 2 */}
          <div className="flex items-center gap-2">
            <select className="block-select text-xs flex-1" value={bulkTerms} onChange={(e) => setBulkTerms(parseInt(e.target.value, 10))}>
              {[0, 7, 14, 15, 30, 45, 60, 90].map((t) => (
                <option key={t} value={t}>Net-{t}</option>
              ))}
            </select>
            <button className="block-btn text-xs" disabled={busy || !selCount} onClick={applyBulkTerms}>Set terms</button>
          </div>

          {/* Feature 3 */}
          <div className="flex items-center gap-2">
            <input className="block-input text-xs flex-1" placeholder="Tag value" value={tagValue} onChange={(e) => setTagValue(e.target.value)} />
            <button className="block-btn text-xs inline-flex items-center gap-1" disabled={busy || !selCount} onClick={() => mutateTag('add')}>
              <Tag size={11} /> Add
            </button>
            <button className="block-btn text-xs" disabled={busy || !selCount} onClick={() => mutateTag('remove')}>Remove</button>
          </div>

          {/* Feature 4 */}
          <div className="flex items-center gap-2">
            <input className="block-input text-xs flex-1" placeholder="Industry / segment" value={industryValue} onChange={(e) => setIndustryValue(e.target.value)} />
            <button className="block-btn text-xs" disabled={busy || !selCount} onClick={applyIndustry}>Assign</button>
          </div>

          {/* Feature 6 */}
          <div className="flex items-center gap-2">
            <input className="block-input text-xs flex-1" placeholder="State / region (e.g. UT)" value={stateValue} onChange={(e) => setStateValue(e.target.value)} />
            <button className="block-btn text-xs" disabled={busy || !selCount} onClick={applyBulkState}>Fix state</button>
          </div>

          {/* Feature 15 */}
          <div className="flex items-center gap-2">
            <input className="block-input text-xs flex-1" placeholder="Append note line…" value={noteValue} onChange={(e) => setNoteValue(e.target.value)} />
            <button className="block-btn text-xs inline-flex items-center gap-1" disabled={busy || !selCount} onClick={appendNote}>
              <StickyNote size={11} /> Append
            </button>
          </div>

          {/* Feature 18 */}
          <div className="flex items-center gap-2">
            <select className="block-select text-xs flex-1" value={projectChoice} onChange={(e) => setProjectChoice(e.target.value)}>
              <option value="">Assign project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button className="block-btn text-xs inline-flex items-center gap-1" disabled={busy || !selCount || !projectChoice} onClick={assignToProject}>
              <Briefcase size={11} /> Link
            </button>
          </div>

          {/* Feature 20 / 23 / 13 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button className="block-btn text-xs inline-flex items-center gap-1" disabled={busy || !selCount} onClick={recomputeTiers}>
              <Sparkles size={11} /> Recompute tier
            </button>
            <button className="block-btn text-xs inline-flex items-center gap-1" disabled={busy || !selCount} onClick={normalizeFields}>
              <Wand2 size={11} /> Normalize
            </button>
            <button className="block-btn text-xs" disabled={busy || !selCount} onClick={markDormantInactive}>Archive</button>
          </div>
        </div>

        {/* Feature 5: bulk delete with typed confirm */}
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--hairline)' }}>
          {!deleteConfirm ? (
            <button
              className="block-btn text-xs inline-flex items-center gap-1"
              style={{ color: 'var(--color-accent-expense)' }}
              disabled={busy || !selCount}
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 size={11} /> Delete {selCount || ''} selected…
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-accent-expense">Type DELETE to remove {selCount} client(s):</span>
              <input className="block-input text-xs w-28" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
              <button className="block-btn text-xs" style={{ color: 'var(--color-accent-expense)' }} disabled={busy} onClick={performDelete}>Confirm</button>
              <button className="block-btn text-xs" onClick={() => { setDeleteConfirm(false); setConfirmText(''); }}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Quick-add (Feature 10) ─── */}
      <div className="block-card">
        {cardTitle(<Plus size={12} className="text-text-muted" />, 'Quick-Add Lead', 'Name + email only — saved as a prospect')}
        <div className="flex flex-wrap items-center gap-2">
          <input className="block-input text-xs flex-1 min-w-[120px]" placeholder="Client name" value={qaName} onChange={(e) => setQaName(e.target.value)} />
          <input className="block-input text-xs flex-1 min-w-[120px]" placeholder="email@example.com" value={qaEmail} onChange={(e) => setQaEmail(e.target.value)} />
          <button className="block-btn block-btn-primary text-xs inline-flex items-center gap-1" disabled={busy || !qaName.trim()} onClick={quickAdd}>
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* ─── Duplicate detector (Feature 9) ─── */}
      <div className="block-card">
        {cardTitle(<Users size={12} className="text-text-muted" />, 'Duplicate Detector', `${duplicates.length} potential duplicate group(s) by name/email`)}
        {duplicates.length === 0 ? (
          <p className="text-xs text-text-muted">No duplicates found.</p>
        ) : (
          <div className="space-y-2">
            {duplicates.slice(0, 8).map((g) => (
              <div key={`${g.by}-${g.key}`} className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="block-badge block-badge-warning mr-2 capitalize">{g.by}</span>
                  <span className="text-text-secondary">{g.rows.map((r) => r.name).join(', ')}</span>
                </div>
                <button className="block-btn text-[11px]" disabled={busy} onClick={() => mergeDuplicate(g)}>Merge</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Client list with inline + row actions ─── */}
      <div className="block-card">
        {cardTitle(
          <CheckSquare size={12} className="text-text-muted" />,
          'Clients',
          'Double-click a cell to edit · click the badge to cycle status · star to pin'
        )}
        {filtered.length === 0 ? (
          <p className="text-xs text-text-muted">No clients match the current filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="block-table text-xs">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ width: 24 }}></th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((c) => {
                  const status = formatStatus(c.status);
                  return (
                    <tr key={c.id}>
                      <td>
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} aria-label={`Select ${c.name}`} />
                      </td>
                      <td>
                        <button
                          onClick={() => toggleStar(c.id)}
                          title={starred.has(c.id) ? 'Unpin' : 'Pin to top'}
                          style={{ color: starred.has(c.id) ? 'var(--color-accent-warning)' : 'var(--text-muted)' }}
                        >
                          <Star size={13} fill={starred.has(c.id) ? 'currentColor' : 'none'} />
                        </button>
                      </td>
                      <td
                        contentEditable
                        suppressContentEditableWarning
                        className="cursor-text"
                        onBlur={(e) => inlineEdit(c.id, 'name', e.currentTarget.textContent || '')}
                      >
                        {c.name}
                      </td>
                      <td
                        contentEditable
                        suppressContentEditableWarning
                        className="cursor-text"
                        onBlur={(e) => inlineEdit(c.id, 'email', e.currentTarget.textContent || '')}
                      >
                        {c.email}
                      </td>
                      <td
                        contentEditable
                        suppressContentEditableWarning
                        className="cursor-text"
                        onBlur={(e) => inlineEdit(c.id, 'phone', e.currentTarget.textContent || '')}
                      >
                        {c.phone}
                      </td>
                      <td>
                        <button onClick={() => cycleStatus(c)} title="Cycle status" className={status.className}>
                          {status.label}
                        </button>
                      </td>
                      <td
                        style={{ textAlign: 'right' }}
                        contentEditable
                        suppressContentEditableWarning
                        className="cursor-text font-mono"
                        onBlur={(e) => inlineEdit(c.id, 'payment_terms', e.currentTarget.textContent || '')}
                      >
                        {c.payment_terms ?? 30}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{formatCurrency(revenueByClient[c.id] || 0)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="inline-flex items-center gap-1.5">
                          <button title="Copy details" onClick={() => copyDetails(c)}><Copy size={13} className="text-text-muted" /></button>
                          <button title="Email client" onClick={() => emailClient(c)}><Mail size={13} className="text-text-muted" /></button>
                          <button title="Quick note" onClick={() => openNoteDrawer(c)}><StickyNote size={13} className="text-text-muted" /></button>
                          <button title="Clone as template" onClick={() => cloneAsTemplate(c)}><RefreshCw size={13} className="text-text-muted" /></button>
                          {c.status === 'prospect' && (
                            <button title="Convert to active" onClick={() => convertProspect(c)}><Sparkles size={13} style={{ color: 'var(--color-accent-income)' }} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <p className="text-[11px] text-text-muted mt-2">Showing first 200 of {filtered.length} — narrow with search.</p>
            )}
          </div>
        )}
      </div>

      {/* ─── Quick-note drawer (Feature 22) ─── */}
      {noteDrawerId && (
        <div className="block-card" style={{ borderLeft: '2px solid var(--color-accent-blue)' }}>
          {cardTitle(<StickyNote size={12} className="text-text-muted" />, 'Quick Note', clients.find((c) => c.id === noteDrawerId)?.name)}
          <textarea
            className="block-input text-xs w-full"
            rows={4}
            value={drawerNote}
            onChange={(e) => setDrawerNote(e.target.value)}
            placeholder="Notes…"
          />
          <div className="flex items-center gap-2 mt-2">
            <button className="block-btn block-btn-primary text-xs" disabled={busy} onClick={saveNoteDrawer}>Save</button>
            <button className="block-btn text-xs" onClick={() => setNoteDrawerId(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsUpgradesPart3;
