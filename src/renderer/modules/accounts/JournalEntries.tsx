import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  Plus, Search, FileText, Trash2, Copy, RotateCcw, Upload, Download,
  CheckSquare, Square, ChevronDown,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, formatDate, roundCents } from '../../lib/format';
import { toCSVString, downloadCSVBlob, dateStampedFilename } from '../../lib/csv-export';
import ErrorBanner from '../../components/ErrorBanner';
import EntityChip from '../../components/EntityChip';

interface JournalEntry {
  id: string;
  entry_number: string;
  date: string;
  description: string;
  reference?: string;
  total_debit: number;
  total_credit: number;
  is_posted: number;
  is_adjusting?: number;
  is_recurring?: number;
  is_reversing?: number;
  approval_status?: string;
  class?: string;
  source_type?: string;
  source_id?: string;
  has_attachment?: number;
  created_at: string;
}

interface JournalEntriesProps {
  onNewEntry: () => void;
  onEditEntry: (entry: JournalEntry) => void;
}

interface ParsedRow {
  entry_number: string;
  date: string;
  description: string;
  account_code: string;
  debit: number;
  credit: number;
}

const splitCSVLine = (line: string): string[] => {
  // Minimal CSV split: handles quoted fields with commas.
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === ',' && !q) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
};

const JournalEntries: React.FC<JournalEntriesProps> = ({ onNewEntry, onEditEntry }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [postedFilter, setPostedFilter] = useState<'all'|'posted'|'unposted'>('all');
  const [hasAttachmentFilter, setHasAttachmentFilter] = useState<'all'|'yes'|'no'>('all');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ParsedRow[] | null>(null);
  const [importError, setImportError] = useState<string>('');

  const reload = () => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    api.rawQuery(
      `SELECT je.*,
         COALESCE((SELECT SUM(debit) FROM journal_entry_lines WHERE journal_entry_id = je.id), 0) as total_debit,
         COALESCE((SELECT SUM(credit) FROM journal_entry_lines WHERE journal_entry_id = je.id), 0) as total_credit,
         (SELECT COUNT(*) FROM documents WHERE entity_type='journal_entry' AND entity_id = je.id) as has_attachment
       FROM journal_entries je
       WHERE je.company_id = ?
       ORDER BY je.date DESC, je.created_at DESC`,
      [activeCompany.id]
    ).then((data: any) => {
      if (Array.isArray(data)) setEntries(data);
    }).catch((err: any) => {
      console.error('Failed to load journal entries:', err);
      setError(err?.message || 'Failed to load journal entries');
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany]);

  useEffect(() => {
    if (!activeCompany) return;
    api.query('accounts', { company_id: activeCompany.id, is_active: true })
      .then((d: any) => { if (Array.isArray(d)) setAccounts(d); })
      .catch(() => {});
  }, [activeCompany]);

  // Search by amount/account requires line lookups — pre-load a map of entry → accountIds
  const [linesByEntry, setLinesByEntry] = useState<Record<string, Array<{ account_id: string; debit: number; credit: number }>>>({});
  useEffect(() => {
    if (!activeCompany || !showAdvanced) return;
    api.rawQuery(
      `SELECT jel.journal_entry_id, jel.account_id, jel.debit, jel.credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE je.company_id = ?`,
      [activeCompany.id]
    ).then((data: any) => {
      if (!Array.isArray(data)) return;
      const map: Record<string, Array<{ account_id: string; debit: number; credit: number }>> = {};
      for (const r of data) {
        (map[r.journal_entry_id] ||= []).push({ account_id: r.account_id, debit: r.debit, credit: r.credit });
      }
      setLinesByEntry(map);
    }).catch(() => {});
  }, [activeCompany, showAdvanced, entries.length]);

  const filtered = useMemo(() => {
    let result = entries;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) =>
        e.entry_number.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        (e.reference ?? '').toLowerCase().includes(q)
      );
    }
    if (dateFrom) result = result.filter((e) => e.date >= dateFrom);
    if (dateTo) result = result.filter((e) => e.date <= dateTo);
    if (postedFilter !== 'all') {
      result = result.filter((e) => postedFilter === 'posted' ? e.is_posted === 1 : e.is_posted === 0);
    }
    if (hasAttachmentFilter !== 'all') {
      result = result.filter((e) =>
        hasAttachmentFilter === 'yes' ? (e.has_attachment ?? 0) > 0 : (e.has_attachment ?? 0) === 0
      );
    }
    const minN = amountMin ? parseFloat(amountMin) : NaN;
    const maxN = amountMax ? parseFloat(amountMax) : NaN;
    if (!isNaN(minN)) result = result.filter((e) => (e.total_debit ?? 0) >= minN);
    if (!isNaN(maxN)) result = result.filter((e) => (e.total_debit ?? 0) <= maxN);
    if (accountFilter) {
      result = result.filter((e) => (linesByEntry[e.id] ?? []).some((l) => l.account_id === accountFilter));
    }
    return result;
  }, [entries, searchQuery, dateFrom, dateTo, postedFilter, hasAttachmentFilter, amountMin, amountMax, accountFilter, linesByEntry]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
  const toggleAll = () => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((e) => e.id)));
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ─── Bulk actions ─────────────────────────────────
  const bulkPost = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const drafts = entries.filter((e) => ids.includes(e.id) && e.is_posted === 0);
    if (drafts.length === 0) { alert('No draft entries selected.'); return; }
    if (!window.confirm(`Post ${drafts.length} draft entries?`)) return;
    try {
      for (const d of drafts) await api.update('journal_entries', d.id, { is_posted: 1 });
      setSelectedIds(new Set());
      reload();
      window.dispatchEvent(new CustomEvent('je:posted'));
    } catch (e: any) {
      alert('Bulk post failed: ' + (e?.message || 'unknown'));
    }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} journal entries? This cannot be undone.`)) return;
    try {
      for (const id of ids) {
        const snapshot = entries.find((e) => e.id === id);
        await api.remove('journal_entries', id);
        if (activeCompany && snapshot) {
          await api.create('audit_log', {
            company_id: activeCompany.id,
            entity_type: 'journal_entry',
            entity_id: id,
            action: 'delete',
            changes: JSON.stringify({ snapshot }),
            performed_by: user?.id ?? '',
          }).catch(() => {});
        }
      }
      setSelectedIds(new Set());
      reload();
    } catch (e: any) {
      alert('Bulk delete failed: ' + (e?.message || 'unknown'));
    }
  };

  const exportSelected = async () => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : filtered.map((e) => e.id);
    if (ids.length === 0) return;
    const rows = entries.filter((e) => ids.includes(e.id));
    // Expand rows with their lines for full CSV
    const linesData: any[] = [];
    for (const e of rows) {
      const lns: any = await api.query('journal_entry_lines', { journal_entry_id: e.id });
      const acctMap = new Map(accounts.map((a) => [a.id, a]));
      if (Array.isArray(lns)) {
        for (const l of lns) {
          const acct = acctMap.get(l.account_id);
          linesData.push({
            entry_number: e.entry_number,
            date: e.date,
            description: e.description,
            account_code: acct?.code ?? '',
            account_name: acct?.name ?? '',
            debit: l.debit ?? 0,
            credit: l.credit ?? 0,
            line_memo: l.description ?? '',
            posted: e.is_posted ? 'yes' : 'no',
            class: e.class ?? '',
          });
        }
      }
    }
    // downloadCSVBlob accepts (data, filename, columns?) — ColumnSpec[]
    // permits bare string keys, so no cast needed.
    downloadCSVBlob(linesData, dateStampedFilename('journal-entries'), [
      'entry_number', 'date', 'description', 'account_code', 'account_name',
      'debit', 'credit', 'line_memo', 'posted', 'class',
    ]);
  };

  // ─── CSV Import ───────────────────────────────────
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) { setImportError('CSV must have a header and at least one row'); return; }
      const header = splitCSVLine(lines[0]).map((h) => h.toLowerCase());
      const idx = (k: string) => header.indexOf(k);
      const required = ['entry_number', 'date', 'description', 'account_code'];
      for (const r of required) if (idx(r) < 0) { setImportError(`Missing column: ${r}`); return; }
      const rows: ParsedRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cells = splitCSVLine(lines[i]);
        rows.push({
          entry_number: cells[idx('entry_number')] ?? '',
          date: cells[idx('date')] ?? '',
          description: cells[idx('description')] ?? '',
          account_code: cells[idx('account_code')] ?? '',
          debit: parseFloat(cells[idx('debit')] ?? '0') || 0,
          credit: parseFloat(cells[idx('credit')] ?? '0') || 0,
        });
      }
      setImportPreview(rows);
      setImportError('');
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const commitImport = async () => {
    if (!activeCompany || !importPreview) return;
    try {
      const codeMap = new Map(accounts.map((a) => [a.code.toLowerCase(), a.id]));
      const groups: Record<string, ParsedRow[]> = {};
      for (const r of importPreview) (groups[r.entry_number] ||= []).push(r);
      let created = 0;
      for (const [num, rows] of Object.entries(groups)) {
        const head = rows[0];
        const entryRes = await api.create('journal_entries', {
          company_id: activeCompany.id,
          entry_number: num,
          date: head.date,
          description: head.description,
          is_posted: 0,
        });
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const acctId = codeMap.get(r.account_code.toLowerCase());
          if (!acctId) continue;
          await api.create('journal_entry_lines', {
            journal_entry_id: entryRes.id,
            account_id: acctId,
            debit: roundCents(r.debit),
            credit: roundCents(r.credit),
            sort_order: i,
          });
        }
        created++;
      }
      setImportPreview(null);
      alert(`Imported ${created} journal entries.`);
      reload();
    } catch (err: any) {
      setImportError('Import failed: ' + (err?.message || 'unknown'));
    }
  };

  // ─── Per-row actions ──────────────────────────────
  const duplicateEntry = async (entry: JournalEntry) => {
    if (!activeCompany) return;
    try {
      const lines: any = await api.query('journal_entry_lines', { journal_entry_id: entry.id });
      const newNum = await api.nextJournalNumber();
      const created = await api.create('journal_entries', {
        company_id: activeCompany.id,
        entry_number: newNum,
        date: new Date().toISOString().slice(0, 10),
        description: entry.description,
        reference: entry.reference ?? '',
        is_posted: 0,
        class: entry.class ?? '',
      });
      if (Array.isArray(lines)) {
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          await api.create('journal_entry_lines', {
            journal_entry_id: created.id,
            account_id: l.account_id,
            debit: l.debit, credit: l.credit,
            description: l.description, line_memo: l.line_memo, sort_order: i,
          });
        }
      }
      reload();
    } catch (e: any) {
      alert('Duplicate failed: ' + (e?.message || 'unknown'));
    }
  };

  const reverseEntry = async (entry: JournalEntry) => {
    if (!activeCompany) return;
    const dateStr = window.prompt('Reverse entry — date for the reversing entry:', new Date().toISOString().slice(0, 10));
    if (!dateStr) return;
    try {
      const lines: any = await api.query('journal_entry_lines', { journal_entry_id: entry.id });
      const newNum = await api.nextJournalNumber();
      const created = await api.create('journal_entries', {
        company_id: activeCompany.id,
        entry_number: newNum,
        date: dateStr,
        description: `Reversal of ${entry.entry_number}: ${entry.description ?? ''}`.slice(0, 250),
        reference: entry.reference ?? '',
        is_posted: 0,
        reversed_from_id: entry.id,
      });
      if (Array.isArray(lines)) {
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          await api.create('journal_entry_lines', {
            journal_entry_id: created.id,
            account_id: l.account_id,
            debit: l.credit, // flip
            credit: l.debit,
            description: l.description, line_memo: l.line_memo, sort_order: i,
          });
        }
      }
      reload();
    } catch (e: any) {
      alert('Reverse failed: ' + (e?.message || 'unknown'));
    }
  };

  const unpostEntry = async (entry: JournalEntry) => {
    const reason = window.prompt('Unpost reason (recorded in audit log):');
    if (!reason) return;
    try {
      await api.update('journal_entries', entry.id, { is_posted: 0 });
      if (activeCompany) {
        await api.create('audit_log', {
          company_id: activeCompany.id,
          entity_type: 'journal_entry',
          entity_id: entry.id,
          action: 'update',
          changes: JSON.stringify({ unpost: true, reason }),
          performed_by: user?.id ?? '',
        }).catch(() => {});
      }
      reload();
    } catch (e: any) {
      alert('Unpost failed: ' + (e?.message || 'unknown'));
    }
  };

  const deleteEntry = async (entry: JournalEntry) => {
    if (!window.confirm(`Delete ${entry.entry_number}? This cannot be undone.`)) return;
    try {
      await api.remove('journal_entries', entry.id);
      if (activeCompany) {
        await api.create('audit_log', {
          company_id: activeCompany.id,
          entity_type: 'journal_entry',
          entity_id: entry.id,
          action: 'delete',
          changes: JSON.stringify({ snapshot: entry }),
          performed_by: user?.id ?? '',
        }).catch(() => {});
      }
      reload();
    } catch (err: any) {
      alert('Delete failed: ' + (err?.message || 'unknown'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm font-mono">Loading journal entries...</span>
      </div>
    );
  }

  const selectionCount = selectedIds.size;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load journal entries" onDismiss={() => setError('')} />}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries..."
              className="block-input w-full pl-8 pr-3 py-1.5 text-xs bg-bg-primary border border-border-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '6px' }} />
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="block-input px-2 py-1.5 text-xs bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '6px' }} />
            <span className="text-text-muted text-xs">to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="block-input px-2 py-1.5 text-xs bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
              style={{ borderRadius: '6px' }} />
          </div>
          <button onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
            <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Advanced
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
          <button onClick={() => fileInputRef.current?.click()}
            className="block-btn flex items-center gap-1 px-2 py-1.5 text-xs"
            style={{ borderRadius: '6px' }}>
            <Upload size={12} /> Import CSV
          </button>
          <button onClick={exportSelected}
            className="block-btn flex items-center gap-1 px-2 py-1.5 text-xs"
            style={{ borderRadius: '6px' }}>
            <Download size={12} /> Export CSV
          </button>
          <button onClick={onNewEntry}
            className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            style={{ borderRadius: '6px' }}>
            <Plus size={14} /> New Entry
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-5 gap-2 p-3 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Min Amount</label>
            <input type="number" value={amountMin} onChange={(e) => setAmountMin(e.target.value)}
              className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary"
              style={{ borderRadius: '6px' }} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Max Amount</label>
            <input type="number" value={amountMax} onChange={(e) => setAmountMax(e.target.value)}
              className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary"
              style={{ borderRadius: '6px' }} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Account</label>
            <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}
              className="block-select w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary"
              style={{ borderRadius: '6px' }}>
              <option value="">Any</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Status</label>
            <select value={postedFilter} onChange={(e) => setPostedFilter(e.target.value as any)}
              className="block-select w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary"
              style={{ borderRadius: '6px' }}>
              <option value="all">All</option>
              <option value="posted">Posted</option>
              <option value="unposted">Unposted</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Has Attachment</label>
            <select value={hasAttachmentFilter} onChange={(e) => setHasAttachmentFilter(e.target.value as any)}
              className="block-select w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary"
              style={{ borderRadius: '6px' }}>
              <option value="all">All</option>
              <option value="yes">With attachment</option>
              <option value="no">Without</option>
            </select>
          </div>
        </div>
      )}

      {/* Selection action bar */}
      {selectionCount > 0 && (
        <div className="flex items-center justify-between p-2 bg-accent-blue/10 border border-accent-blue/30 text-xs"
             style={{ borderRadius: '6px' }}>
          <span className="text-text-primary font-semibold">{selectionCount} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={bulkPost} className="block-btn px-3 py-1 text-xs" style={{ borderRadius: '6px' }}>Post all</button>
            <button onClick={exportSelected} className="block-btn px-3 py-1 text-xs" style={{ borderRadius: '6px' }}>Export CSV</button>
            <button onClick={bulkDelete} className="block-btn px-3 py-1 text-xs text-accent-expense" style={{ borderRadius: '6px' }}>Delete</button>
            <button onClick={() => setSelectedIds(new Set())} className="text-text-muted hover:text-text-primary">Clear</button>
          </div>
        </div>
      )}

      {/* Import preview modal */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-elevated border border-border-primary w-full max-w-2xl shadow-xl"
               style={{ borderRadius: '6px' }}>
            <div className="px-5 py-3 border-b border-border-primary flex items-center justify-between">
              <h3 className="text-sm font-bold">Import preview — {importPreview.length} rows</h3>
              <button onClick={() => setImportPreview(null)} className="text-text-muted hover:text-text-primary">×</button>
            </div>
            <div className="px-5 py-3 max-h-96 overflow-y-auto">
              {importError && <p className="text-xs text-accent-expense mb-2">{importError}</p>}
              <table className="w-full text-xs">
                <thead className="bg-bg-tertiary sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">Entry #</th>
                    <th className="text-left px-2 py-1">Date</th>
                    <th className="text-left px-2 py-1">Account</th>
                    <th className="text-right px-2 py-1">Debit</th>
                    <th className="text-right px-2 py-1">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-border-primary">
                      <td className="px-2 py-1 font-mono">{r.entry_number}</td>
                      <td className="px-2 py-1">{r.date}</td>
                      <td className="px-2 py-1 font-mono">{r.account_code}</td>
                      <td className="px-2 py-1 text-right font-mono">{r.debit || ''}</td>
                      <td className="px-2 py-1 text-right font-mono">{r.credit || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.length > 50 && <p className="text-[10px] text-text-muted mt-2">…and {importPreview.length - 50} more</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-primary">
              <button onClick={() => setImportPreview(null)} className="block-btn px-3 py-1.5 text-xs" style={{ borderRadius: '6px' }}>Cancel</button>
              <button onClick={commitImport} className="block-btn-primary px-3 py-1.5 text-xs" style={{ borderRadius: '6px' }}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="block-table bg-bg-secondary border border-border-primary overflow-hidden" style={{ borderRadius: '6px' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-tertiary border-b border-border-primary">
              <th className="px-3 py-2 w-8">
                <button onClick={toggleAll} className="text-text-muted hover:text-text-primary">
                  {allFilteredSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
              </th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Entry #</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Description</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Debit</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Credit</th>
              <th className="text-center px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Flags</th>
              <th className="px-4 py-2" style={{ width: '160px' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id}
                  className="border-b border-border-primary hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => onEditEntry(entry)}>
                <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => toggleOne(entry.id)} className="text-text-muted hover:text-text-primary">
                    {selectedIds.has(entry.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                </td>
                <td className="px-4 py-2 text-xs text-text-secondary font-mono">{formatDate(entry.date)}</td>
                <td className="px-4 py-2 text-xs text-text-primary font-mono font-medium">
                  <EntityChip type="journal_entry" id={entry.id} label={entry.entry_number} variant="mono" />
                </td>
                <td className="px-4 py-2 text-xs text-text-primary truncate max-w-[260px]">
                  {entry.description || '—'}
                  {entry.source_type && (
                    <span className="ml-2 text-[9px] uppercase font-semibold text-accent-blue">
                      from {entry.source_type}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">{formatCurrency(entry.total_debit ?? 0)}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{formatCurrency(entry.total_credit ?? 0)}</td>
                <td className="px-4 py-2 text-center">
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    {entry.is_adjusting === 1 && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold bg-accent-blue/15 text-accent-blue" style={{ borderRadius: '4px' }}>ADJ</span>
                    )}
                    {entry.is_recurring === 1 && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold bg-accent-blue/15 text-accent-blue" style={{ borderRadius: '4px' }}>REC</span>
                    )}
                    {entry.is_reversing === 1 && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold bg-accent-blue/15 text-accent-blue" style={{ borderRadius: '4px' }}>REV</span>
                    )}
                    {(entry.has_attachment ?? 0) > 0 && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold bg-bg-tertiary text-text-secondary" style={{ borderRadius: '4px' }}>📎</span>
                    )}
                    <span className={`px-2 py-0.5 text-[9px] font-semibold uppercase ${entry.is_posted === 1 ? 'bg-accent-income/15 text-accent-income' : 'bg-bg-tertiary text-text-muted'}`}
                          style={{ borderRadius: '4px' }}>
                      {entry.is_posted === 1 ? 'Posted' : 'Draft'}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => duplicateEntry(entry)} title="Duplicate"
                            className="block-btn p-1 text-text-muted hover:bg-bg-hover">
                      <Copy size={13} />
                    </button>
                    <button onClick={() => reverseEntry(entry)} title="Reverse"
                            className="block-btn p-1 text-text-muted hover:bg-bg-hover">
                      <RotateCcw size={13} />
                    </button>
                    {entry.is_posted === 1 && (
                      <button onClick={() => unpostEntry(entry)} title="Unpost"
                              className="text-[10px] text-accent-blue hover:underline font-semibold px-1">
                        Unpost
                      </button>
                    )}
                    <button onClick={() => deleteEntry(entry)} title="Delete"
                            className="block-btn p-1 text-accent-expense hover:bg-accent-expense/10">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-text-muted">
                  <FileText size={24} className="mx-auto mb-2 text-text-muted/50" />
                  {entries.length === 0 ? 'No journal entries yet. Create your first entry.' : 'No entries match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default JournalEntries;
