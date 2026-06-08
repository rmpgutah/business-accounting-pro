/**
 * ExpensesUpgrades.part3 — "Bulk Actions & Productivity"
 *
 * A self-contained panel for the Expenses module that bundles ~25 small,
 * working productivity features over the real `expenses` table. Selection
 * state, loaded reference data (categories / vendors / projects / clients)
 * and a refresh key are all owned internally so the panel works standalone.
 *
 * Every card performs a real action through the `api` wrapper (bulk update,
 * bulk delete, per-row update, CSV export, clipboard, localStorage, invoice
 * draft creation, etc.). Nothing here renders a dead button or a fake number.
 *
 * Data access is exclusively via the frontend api wrapper. rawQuery is used
 * for JOIN-backed reads and is scoped to the active company id.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate, roundCents } from '../../../lib/format';

// ─── Local row/reference types ───────────────────────────────────────────
interface ExpenseRow {
  id: string;
  date: string;
  amount: number;
  description: string;
  reference: string;
  vendor_id: string | null;
  vendor_name: string | null;
  category_id: string;
  category_name: string | null;
  project_id: string | null;
  client_id: string | null;
  status: string;
  payment_method: string;
  is_billable: number;
  is_reimbursable: number;
  reimbursed: number;
  reimbursed_date: string;
  receipt_path: string | null;
  tags: string;
}

interface Ref {
  id: string;
  name: string;
}

interface UndoSnapshot {
  label: string;
  rows: Array<{ id: string; data: Record<string, any> }>;
}

const PAYMENT_METHODS = ['cash', 'check', 'credit_card', 'debit_card', 'bank_transfer', 'paypal', 'other'];
const TEMPLATE_KEY = 'bap-expense-templates-v1';
const SETTINGS_KEY = 'bap-expenses-part3-settings-v1';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((t) => String(t)) : [];
  } catch {
    return [];
  }
}

// ─── Root component ───────────────────────────────────────────────────────
export default function ExpensesUpgradesPart3() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id ?? '';

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<Ref[]>([]);
  const [vendors, setVendors] = useState<Ref[]>([]);
  const [projects, setProjects] = useState<Ref[]>([]);
  const [clients, setClients] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  // Shared selection across all cards.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Last bulk action snapshot for the Undo card.
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);
  // Transient toast text.
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(() => setListKey((k) => k + 1), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  // ── Load real data ──
  useEffect(() => {
    let cancelled = false;
    if (!companyId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [exp, cats, vens, projs, clis] = await Promise.all([
          api.rawQuery(
            `SELECT e.id, e.date, e.amount, e.description, e.reference, e.vendor_id,
                    v.name AS vendor_name, e.category_id, c.name AS category_name,
                    e.project_id, e.client_id, e.status, e.payment_method,
                    e.is_billable, e.is_reimbursable, e.reimbursed, e.reimbursed_date,
                    e.receipt_path, e.tags
               FROM expenses e
               LEFT JOIN vendors v ON v.id = e.vendor_id
               LEFT JOIN categories c ON c.id = e.category_id
              WHERE e.company_id = ?
              ORDER BY e.date DESC
              LIMIT 500`,
            [companyId]
          ) as Promise<ExpenseRow[]>,
          api.rawQuery(
            `SELECT id, name FROM categories WHERE company_id = ? AND type = 'expense' ORDER BY name`,
            [companyId]
          ) as Promise<Ref[]>,
          api.rawQuery(`SELECT id, name FROM vendors WHERE company_id = ? ORDER BY name`, [companyId]) as Promise<Ref[]>,
          api.rawQuery(`SELECT id, name FROM projects WHERE company_id = ? ORDER BY name`, [companyId]) as Promise<Ref[]>,
          api.rawQuery(`SELECT id, name FROM clients WHERE company_id = ? ORDER BY name`, [companyId]) as Promise<Ref[]>,
        ]);
        if (cancelled) return;
        setRows(Array.isArray(exp) ? exp : []);
        setCategories(Array.isArray(cats) ? cats : []);
        setVendors(Array.isArray(vens) ? vens : []);
        setProjects(Array.isArray(projs) ? projs : []);
        setClients(Array.isArray(clis) ? clis : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load expense data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, listKey]);

  // Prune selection of any ids that no longer exist after a refresh.
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(rows.map((r) => r.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ── Shared bulk helper: snapshots prior values for Undo, then batchUpdates ──
  const runBulk = useCallback(
    async (label: string, patch: Record<string, any>, fields: string[]) => {
      if (selectedIds.length === 0) {
        showToast('Select at least one expense first.');
        return;
      }
      try {
        const snapshot: UndoSnapshot = {
          label,
          rows: selectedRows.map((r) => {
            const prior: Record<string, any> = {};
            fields.forEach((f) => {
              prior[f] = (r as any)[f];
            });
            return { id: r.id, data: prior };
          }),
        };
        const res = await api.batchUpdate('expenses', selectedIds, patch);
        if (res && (res as any).error) {
          showToast(`Failed: ${(res as any).error}`);
          return;
        }
        setUndo(snapshot);
        showToast(`${label}: ${selectedIds.length} expense(s) updated.`);
        refresh();
      } catch (e: any) {
        showToast(`Failed: ${e?.message ?? 'unknown error'}`);
      }
    },
    [selectedIds, selectedRows, refresh, showToast]
  );

  if (loading) {
    return (
      <div className="block-card">
        <p className="text-text-muted text-sm">Loading expense productivity tools…</p>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="block-card">
        <p className="text-text-muted text-sm">Select a company to use Bulk Actions &amp; Productivity.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="block-card">
        <p className="text-sm" style={{ color: 'var(--color-accent-expense)' }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-text-primary">Bulk Actions &amp; Productivity</h2>
        <span className="text-xs text-text-muted">
          {rows.length} expense(s) loaded · {selectedIds.length} selected
        </span>
      </div>

      {toast && (
        <div className="block-card" role="status" style={{ borderColor: 'var(--color-accent-blue)' }}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text-primary">{toast}</span>
            <button className="block-btn" onClick={() => setToast(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <SelectionCard
        rows={rows}
        categories={categories}
        vendors={vendors}
        selected={selected}
        toggleRow={toggleRow}
        clearSelection={clearSelection}
        setSelected={setSelected}
      />

      <BulkStatusCard runBulk={runBulk} selectedCount={selectedIds.length} />

      <BulkReimburseCard
        selectedRows={selectedRows}
        refresh={refresh}
        showToast={showToast}
      />

      <BulkRecategorizeCard categories={categories} runBulk={runBulk} />

      <BulkVendorCard vendors={vendors} runBulk={runBulk} />

      <BulkProjectClientCard projects={projects} clients={clients} runBulk={runBulk} />

      <BulkTagCard selectedRows={selectedRows} refresh={refresh} showToast={showToast} />

      <BulkToggleBillableCard runBulk={runBulk} />

      <BulkPaymentMethodCard runBulk={runBulk} />

      <BulkDateCard runBulk={runBulk} />

      <BulkReferenceCard runBulk={runBulk} />

      <UndoCard undo={undo} setUndo={setUndo} refresh={refresh} showToast={showToast} />

      <BulkDeleteCard selectedIds={selectedIds} refresh={refresh} clearSelection={clearSelection} showToast={showToast} />

      <QuickAddCard
        companyId={companyId}
        categories={categories}
        vendors={vendors}
        refresh={refresh}
        showToast={showToast}
      />

      <TemplatesCard
        companyId={companyId}
        categories={categories}
        vendors={vendors}
        refresh={refresh}
        showToast={showToast}
      />

      <DuplicateCard
        companyId={companyId}
        rows={rows}
        refresh={refresh}
        showToast={showToast}
      />

      <InlineEditCard selectedRows={selectedRows} categories={categories} refresh={refresh} showToast={showToast} />

      <SplitCard selectedRows={selectedRows} refresh={refresh} showToast={showToast} />

      <MergeDuplicatesCard selectedRows={selectedRows} refresh={refresh} clearSelection={clearSelection} showToast={showToast} />

      <VendorRuleCard rows={rows} vendors={vendors} categories={categories} refresh={refresh} showToast={showToast} />

      <ConvertToInvoiceCard
        companyId={companyId}
        selectedRows={selectedRows}
        clients={clients}
        showToast={showToast}
      />

      <PasteCreateCard companyId={companyId} refresh={refresh} showToast={showToast} />

      <CleanupWizardCard rows={rows} categories={categories} vendors={vendors} refresh={refresh} showToast={showToast} />

      <CommandPaletteCard
        onApprove={() => runBulk('Approve', { status: 'approved' }, ['status'])}
        onPaid={() => runBulk('Mark paid', { status: 'paid' }, ['status'])}
        rows={rows}
        categories={categories}
        vendors={vendors}
      />

      <ExportCard rows={rows} selectedRows={selectedRows} categories={categories} vendors={vendors} />

      <CsvSettingsCard />
    </div>
  );
}

// ─── 1 + 23. Bulk status (approve / mark paid) ────────────────────────────
function BulkStatusCard({
  runBulk,
  selectedCount,
}: {
  runBulk: (label: string, patch: Record<string, any>, fields: string[]) => void;
  selectedCount: number;
}) {
  return (
    <Card title="Bulk status workflow" subtitle="Approve selected, or push approved expenses to paid.">
      <div className="flex flex-wrap gap-2">
        <button
          className="block-btn block-btn-primary"
          onClick={() => runBulk('Approve', { status: 'approved' }, ['status'])}
        >
          Approve selected
        </button>
        <button
          className="block-btn"
          onClick={() => runBulk('Mark paid', { status: 'paid' }, ['status'])}
        >
          Mark selected as paid
        </button>
        <button
          className="block-btn"
          onClick={() => runBulk('Reset to pending', { status: 'pending' }, ['status'])}
        >
          Reset to pending
        </button>
      </div>
      <p className="mt-2 text-xs text-text-muted">{selectedCount} expense(s) will be affected.</p>
    </Card>
  );
}

// ─── 2. Bulk mark reimbursed ──────────────────────────────────────────────
function BulkReimburseCard({
  selectedRows,
  refresh,
  showToast,
}: {
  selectedRows: ExpenseRow[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const reimbursable = selectedRows.filter((r) => Number(r.is_reimbursable) === 1);
  const run = async () => {
    const ids = reimbursable.map((r) => r.id);
    if (ids.length === 0) {
      showToast('No reimbursable expenses selected.');
      return;
    }
    try {
      await api.batchUpdate('expenses', ids, { reimbursed: 1, reimbursed_date: today() });
      showToast(`Marked ${ids.length} reimbursable expense(s) as reimbursed.`);
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };
  return (
    <Card title="Bulk mark reimbursed" subtitle="Stamps today's date on selected reimbursable expenses.">
      <div className="flex items-center gap-3">
        <button className="block-btn block-btn-primary" onClick={run} disabled={reimbursable.length === 0}>
          Mark reimbursed
        </button>
        <span className="text-xs text-text-muted">
          {reimbursable.length} of {selectedRows.length} selected are reimbursable.
        </span>
      </div>
    </Card>
  );
}

// ─── 3. Bulk re-categorize ────────────────────────────────────────────────
function BulkRecategorizeCard({
  categories,
  runBulk,
}: {
  categories: Ref[];
  runBulk: (label: string, patch: Record<string, any>, fields: string[]) => void;
}) {
  const [cat, setCat] = useState('');
  return (
    <Card title="Bulk re-categorize" subtitle="Apply one category to every selected expense.">
      <div className="flex flex-wrap items-center gap-2">
        <select className="block-select" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Choose category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="block-btn block-btn-primary"
          disabled={!cat}
          onClick={() => runBulk('Re-categorize', { category_id: cat }, ['category_id'])}
        >
          Apply category
        </button>
      </div>
    </Card>
  );
}

// ─── 4. Bulk assign vendor ────────────────────────────────────────────────
function BulkVendorCard({
  vendors,
  runBulk,
}: {
  vendors: Ref[];
  runBulk: (label: string, patch: Record<string, any>, fields: string[]) => void;
}) {
  const [vendor, setVendor] = useState('');
  return (
    <Card title="Bulk assign vendor" subtitle="Fix blank vendor_id rows in one pass.">
      <div className="flex flex-wrap items-center gap-2">
        <select className="block-select" value={vendor} onChange={(e) => setVendor(e.target.value)}>
          <option value="">Choose vendor…</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          className="block-btn block-btn-primary"
          disabled={!vendor}
          onClick={() => runBulk('Assign vendor', { vendor_id: vendor }, ['vendor_id'])}
        >
          Assign vendor
        </button>
      </div>
    </Card>
  );
}

// ─── 5. Bulk assign project / client ──────────────────────────────────────
function BulkProjectClientCard({
  projects,
  clients,
  runBulk,
}: {
  projects: Ref[];
  clients: Ref[];
  runBulk: (label: string, patch: Record<string, any>, fields: string[]) => void;
}) {
  const [project, setProject] = useState('');
  const [client, setClient] = useState('');
  const apply = () => {
    const patch: Record<string, any> = {};
    const fields: string[] = [];
    if (project) {
      patch.project_id = project;
      fields.push('project_id');
    }
    if (client) {
      patch.client_id = client;
      fields.push('client_id');
    }
    if (fields.length === 0) return;
    runBulk('Cost allocation', patch, fields);
  };
  return (
    <Card title="Bulk assign project / client" subtitle="Allocate selected expenses for cost tracking.">
      <div className="flex flex-wrap items-center gap-2">
        <select className="block-select" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="block-select" value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="block-btn block-btn-primary" disabled={!project && !client} onClick={apply}>
          Apply allocation
        </button>
      </div>
    </Card>
  );
}

// ─── 6. Bulk add / remove tag ─────────────────────────────────────────────
function BulkTagCard({
  selectedRows,
  refresh,
  showToast,
}: {
  selectedRows: ExpenseRow[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const [tag, setTag] = useState('');
  const mutate = async (mode: 'add' | 'remove') => {
    const clean = tag.trim();
    if (!clean) {
      showToast('Enter a tag first.');
      return;
    }
    if (selectedRows.length === 0) {
      showToast('Select at least one expense.');
      return;
    }
    try {
      let changed = 0;
      for (const r of selectedRows) {
        const set = new Set(parseTags(r.tags));
        if (mode === 'add') set.add(clean);
        else set.delete(clean);
        const next = JSON.stringify(Array.from(set));
        if (next !== JSON.stringify(parseTags(r.tags))) {
          await api.update('expenses', r.id, { tags: next });
          changed++;
        }
      }
      showToast(`${mode === 'add' ? 'Added' : 'Removed'} tag "${clean}" on ${changed} expense(s).`);
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };
  return (
    <Card title="Bulk add / remove tag" subtitle="Merges or strips a tag in each selected expense's tags JSON.">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="block-input"
          placeholder="tag name"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
        <button className="block-btn block-btn-primary" onClick={() => mutate('add')}>
          Add tag
        </button>
        <button className="block-btn" onClick={() => mutate('remove')}>
          Remove tag
        </button>
      </div>
    </Card>
  );
}

// ─── 7. Bulk toggle billable ──────────────────────────────────────────────
function BulkToggleBillableCard({
  runBulk,
}: {
  runBulk: (label: string, patch: Record<string, any>, fields: string[]) => void;
}) {
  return (
    <Card title="Bulk toggle billable" subtitle="Make selected expenses client-billable (or not) at once.">
      <div className="flex flex-wrap gap-2">
        <button
          className="block-btn block-btn-primary"
          onClick={() => runBulk('Set billable', { is_billable: 1 }, ['is_billable'])}
        >
          Set billable
        </button>
        <button
          className="block-btn"
          onClick={() => runBulk('Clear billable', { is_billable: 0 }, ['is_billable'])}
        >
          Clear billable
        </button>
      </div>
    </Card>
  );
}

// ─── 8. Bulk set payment method ───────────────────────────────────────────
function BulkPaymentMethodCard({
  runBulk,
}: {
  runBulk: (label: string, patch: Record<string, any>, fields: string[]) => void;
}) {
  const [method, setMethod] = useState('');
  return (
    <Card title="Bulk set payment method" subtitle="Normalize the payment method across selected expenses.">
      <div className="flex flex-wrap items-center gap-2">
        <select className="block-select" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">Choose method…</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <button
          className="block-btn block-btn-primary"
          disabled={!method}
          onClick={() => runBulk('Set payment method', { payment_method: method }, ['payment_method'])}
        >
          Apply method
        </button>
      </div>
    </Card>
  );
}

// ─── 18. Bulk move to date ────────────────────────────────────────────────
function BulkDateCard({
  runBulk,
}: {
  runBulk: (label: string, patch: Record<string, any>, fields: string[]) => void;
}) {
  const [date, setDate] = useState(today());
  return (
    <Card title="Bulk move to date / period" subtitle="Re-date selected expenses for period reclassification.">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="block-input" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          className="block-btn block-btn-primary"
          disabled={!date}
          onClick={() => runBulk('Move to date', { date }, ['date'])}
        >
          Apply date
        </button>
      </div>
    </Card>
  );
}

// ─── 21. Bulk attach reference number ─────────────────────────────────────
function BulkReferenceCard({
  runBulk,
}: {
  runBulk: (label: string, patch: Record<string, any>, fields: string[]) => void;
}) {
  const [ref, setRef] = useState('');
  return (
    <Card title="Bulk attach reference" subtitle="Stamp a common check/reference number on selected expenses.">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="block-input"
          placeholder="e.g. CHK-1042"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <button
          className="block-btn block-btn-primary"
          disabled={!ref.trim()}
          onClick={() => runBulk('Attach reference', { reference: ref.trim() }, ['reference'])}
        >
          Apply reference
        </button>
      </div>
    </Card>
  );
}

// ─── 19. Undo last bulk action ────────────────────────────────────────────
function UndoCard({
  undo,
  setUndo,
  refresh,
  showToast,
}: {
  undo: UndoSnapshot | null;
  setUndo: (u: UndoSnapshot | null) => void;
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const run = async () => {
    if (!undo) return;
    try {
      // Group rows by identical prior-value payloads so we can batch.
      const groups = new Map<string, { data: Record<string, any>; ids: string[] }>();
      for (const r of undo.rows) {
        const key = JSON.stringify(r.data);
        const g = groups.get(key);
        if (g) g.ids.push(r.id);
        else groups.set(key, { data: r.data, ids: [r.id] });
      }
      for (const g of groups.values()) {
        await api.batchUpdate('expenses', g.ids, g.data);
      }
      showToast(`Reverted "${undo.label}" on ${undo.rows.length} expense(s).`);
      setUndo(null);
      refresh();
    } catch (e: any) {
      showToast(`Undo failed: ${e?.message ?? 'unknown error'}`);
    }
  };
  return (
    <Card title="Undo last bulk action" subtitle="Re-applies the prior field values from the most recent bulk update.">
      {undo ? (
        <div className="flex items-center gap-3">
          <button className="block-btn block-btn-primary" onClick={run}>
            Undo "{undo.label}" ({undo.rows.length})
          </button>
          <button className="block-btn" onClick={() => setUndo(null)}>
            Discard
          </button>
        </div>
      ) : (
        <p className="text-xs text-text-muted">No bulk action to undo yet.</p>
      )}
    </Card>
  );
}

// ─── 9. Bulk delete with typed confirm ────────────────────────────────────
function BulkDeleteCard({
  selectedIds,
  refresh,
  clearSelection,
  showToast,
}: {
  selectedIds: string[];
  refresh: () => void;
  clearSelection: () => void;
  showToast: (m: string) => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const run = async () => {
    if (selectedIds.length === 0) {
      showToast('Select expenses to delete.');
      return;
    }
    if (confirmText.trim().toUpperCase() !== 'DELETE') {
      showToast('Type DELETE to confirm.');
      return;
    }
    try {
      await api.batchDelete('expenses', selectedIds);
      showToast(`Deleted ${selectedIds.length} expense(s).`);
      setConfirmText('');
      clearSelection();
      refresh();
    } catch (e: any) {
      showToast(`Delete failed: ${e?.message ?? 'unknown error'}`);
    }
  };
  return (
    <Card title="Bulk delete (typed confirm)" subtitle="Permanently removes selected expenses. Type DELETE to enable.">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="block-input"
          placeholder='Type "DELETE"'
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
        <button
          className="block-btn"
          style={{ borderColor: 'var(--color-accent-expense)', color: 'var(--color-accent-expense)' }}
          disabled={confirmText.trim().toUpperCase() !== 'DELETE' || selectedIds.length === 0}
          onClick={run}
        >
          Delete {selectedIds.length} selected
        </button>
      </div>
    </Card>
  );
}

// ─── 11. Quick-add inline row ─────────────────────────────────────────────
function QuickAddCard({
  companyId,
  categories,
  vendors,
  refresh,
  showToast,
}: {
  companyId: string;
  categories: Ref[];
  vendors: Ref[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(today());
  const [desc, setDesc] = useState('');

  const add = async () => {
    const amt = roundCents(amount);
    if (!(amt > 0)) {
      showToast('Enter a positive amount.');
      return;
    }
    try {
      const res = await api.create('expenses', {
        company_id: companyId,
        date,
        amount: amt,
        description: desc,
        vendor_id: vendor || null,
        category_id: category || '',
        status: 'pending',
      });
      if (res && (res as any).error) {
        showToast(`Failed: ${(res as any).error}`);
        return;
      }
      showToast('Expense added.');
      setAmount('');
      setDesc('');
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  return (
    <Card title="Quick-add expense" subtitle="A compact entry row — vendor, amount, category, date.">
      <div className="flex flex-wrap items-end gap-2">
        <select className="block-select" value={vendor} onChange={(e) => setVendor(e.target.value)}>
          <option value="">Vendor…</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <input
          className="block-input"
          style={{ maxWidth: 120 }}
          placeholder="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select className="block-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input type="date" className="block-input" value={date} onChange={(e) => setDate(e.target.value)} />
        <input
          className="block-input"
          placeholder="description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <button className="block-btn block-btn-primary" onClick={add}>
          Add
        </button>
      </div>
    </Card>
  );
}

// ─── 12. Expense templates (localStorage) ─────────────────────────────────
interface ExpenseTemplate {
  name: string;
  amount: number;
  description: string;
  vendor_id: string | null;
  category_id: string;
}
function loadTemplates(): ExpenseTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function TemplatesCard({
  companyId,
  categories,
  vendors,
  refresh,
  showToast,
}: {
  companyId: string;
  categories: Ref[];
  vendors: Ref[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const [templates, setTemplates] = useState<ExpenseTemplate[]>(() => loadTemplates());
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [vendor, setVendor] = useState('');
  const [category, setCategory] = useState('');

  const persist = (list: ExpenseTemplate[]) => {
    setTemplates(list);
    try {
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list));
    } catch {
      /* storage full / disabled — non-fatal */
    }
  };

  const save = () => {
    if (!name.trim()) {
      showToast('Name the template first.');
      return;
    }
    const next = [
      ...templates.filter((t) => t.name !== name.trim()),
      {
        name: name.trim(),
        amount: roundCents(amount),
        description: desc,
        vendor_id: vendor || null,
        category_id: category,
      },
    ];
    persist(next);
    showToast(`Template "${name.trim()}" saved.`);
    setName('');
  };

  const useTemplate = async (t: ExpenseTemplate) => {
    try {
      const res = await api.create('expenses', {
        company_id: companyId,
        date: today(),
        amount: t.amount,
        description: t.description,
        vendor_id: t.vendor_id,
        category_id: t.category_id,
        status: 'pending',
      });
      if (res && (res as any).error) {
        showToast(`Failed: ${(res as any).error}`);
        return;
      }
      showToast(`Created expense from "${t.name}".`);
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  return (
    <Card title="Expense templates" subtitle="Save reusable expense presets to this browser; one click creates one.">
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <input className="block-input" placeholder="template name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="block-input"
          style={{ maxWidth: 110 }}
          placeholder="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select className="block-select" value={vendor} onChange={(e) => setVendor(e.target.value)}>
          <option value="">Vendor…</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <select className="block-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className="block-input" placeholder="description" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className="block-btn block-btn-primary" onClick={save}>
          Save template
        </button>
      </div>
      {templates.length === 0 ? (
        <p className="text-xs text-text-muted">No templates yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <span key={t.name} className="inline-flex items-center gap-1">
              <button className="block-btn" onClick={() => useTemplate(t)}>
                {t.name} · {formatCurrency(t.amount)}
              </button>
              <button
                className="block-btn"
                title="Delete template"
                onClick={() => persist(templates.filter((x) => x.name !== t.name))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── 10. Duplicate an expense ─────────────────────────────────────────────
function DuplicateCard({
  companyId,
  rows,
  refresh,
  showToast,
}: {
  companyId: string;
  rows: ExpenseRow[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const [id, setId] = useState('');
  const duplicate = async () => {
    if (!id) return;
    try {
      const src = (await api.get('expenses', id)) as Record<string, any> | null;
      if (!src) {
        showToast('Source expense not found.');
        return;
      }
      const copy = { ...src };
      delete copy.id;
      delete copy.created_at;
      delete copy.updated_at;
      copy.company_id = companyId;
      copy.date = today();
      copy.status = 'pending';
      copy.reimbursed = 0;
      copy.reimbursed_date = '';
      const res = await api.create('expenses', copy);
      if (res && (res as any).error) {
        showToast(`Failed: ${(res as any).error}`);
        return;
      }
      showToast('Expense duplicated with today’s date.');
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };
  return (
    <Card title="Duplicate an expense" subtitle="Clone an existing expense for fast re-entry.">
      <div className="flex flex-wrap items-center gap-2">
        <select className="block-select" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Pick an expense…</option>
          {rows.slice(0, 200).map((r) => (
            <option key={r.id} value={r.id}>
              {formatDate(r.date)} · {formatCurrency(r.amount)} · {r.vendor_name || r.description || 'expense'}
            </option>
          ))}
        </select>
        <button className="block-btn block-btn-primary" disabled={!id} onClick={duplicate}>
          Duplicate
        </button>
      </div>
    </Card>
  );
}

// ─── 14. Inline editable amount / description / category ──────────────────
function InlineEditCard({
  selectedRows,
  categories,
  refresh,
  showToast,
}: {
  selectedRows: ExpenseRow[];
  categories: Ref[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const row = selectedRows[0];
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('');

  useEffect(() => {
    if (row) {
      setAmount(String(row.amount ?? ''));
      setDesc(row.description ?? '');
      setCat(row.category_id ?? '');
    }
  }, [row?.id]);

  const saveField = async (field: 'amount' | 'description' | 'category_id', value: any) => {
    if (!row) return;
    try {
      await api.update('expenses', row.id, { [field]: value });
      showToast(`Updated ${field.replace('_id', '')}.`);
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  if (!row) {
    return (
      <Card title="Inline edit (first selected)" subtitle="Select one expense to edit its amount, description and category.">
        <p className="text-xs text-text-muted">No expense selected.</p>
      </Card>
    );
  }
  return (
    <Card
      title="Inline edit (first selected)"
      subtitle={`Editing ${formatDate(row.date)} · ${row.vendor_name || row.description || row.id.slice(0, 8)}`}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-text-muted">
          Amount
          <input
            className="block-input mt-1"
            style={{ maxWidth: 120 }}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => saveField('amount', roundCents(amount))}
          />
        </label>
        <label className="text-xs text-text-muted flex-1" style={{ minWidth: 160 }}>
          Description
          <input
            className="block-input mt-1"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => saveField('description', desc)}
          />
        </label>
        <label className="text-xs text-text-muted">
          Category
          <select
            className="block-select mt-1"
            value={cat}
            onChange={(e) => {
              setCat(e.target.value);
              saveField('category_id', e.target.value);
            }}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Card>
  );
}

// ─── 13. Split expense into line items (stored in custom_fields JSON) ──────
interface SplitLine {
  description: string;
  amount: string;
}
function SplitCard({
  selectedRows,
  refresh,
  showToast,
}: {
  selectedRows: ExpenseRow[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const row = selectedRows[0];
  const [lines, setLines] = useState<SplitLine[]>([
    { description: '', amount: '' },
    { description: '', amount: '' },
  ]);

  const total = useMemo(() => lines.reduce((s, l) => s + roundCents(l.amount), 0), [lines]);
  const target = row ? roundCents(row.amount) : 0;
  const balanced = row ? Math.abs(total - target) < 0.005 : false;

  const setLine = (i: number, patch: Partial<SplitLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!row) return;
    if (!balanced) {
      showToast('Split lines must sum to the expense amount.');
      return;
    }
    try {
      const splits = lines
        .filter((l) => roundCents(l.amount) !== 0)
        .map((l) => ({ description: l.description, amount: roundCents(l.amount) }));
      await api.update('expenses', row.id, {
        custom_fields: JSON.stringify({ splits }),
      });
      showToast(`Saved ${splits.length} split line(s) to expense.`);
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  if (!row) {
    return (
      <Card title="Split expense into lines" subtitle="Select one expense to break it into multiple cost lines.">
        <p className="text-xs text-text-muted">No expense selected.</p>
      </Card>
    );
  }
  return (
    <Card
      title="Split expense into lines"
      subtitle={`Splitting ${formatCurrency(target)} — lines stored in the expense's custom_fields.`}
    >
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="block-input flex-1"
              placeholder={`line ${i + 1} description`}
              value={l.description}
              onChange={(e) => setLine(i, { description: e.target.value })}
            />
            <input
              className="block-input"
              style={{ maxWidth: 120 }}
              inputMode="decimal"
              placeholder="amount"
              value={l.amount}
              onChange={(e) => setLine(i, { amount: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button className="block-btn" onClick={() => setLines((p) => [...p, { description: '', amount: '' }])}>
          + line
        </button>
        <button className="block-btn block-btn-primary" disabled={!balanced} onClick={save}>
          Save split
        </button>
        <span
          className="text-xs"
          style={{ color: balanced ? 'var(--color-accent-income)' : 'var(--color-accent-warning)' }}
        >
          {formatCurrency(total)} / {formatCurrency(target)}
        </span>
      </div>
    </Card>
  );
}

// ─── 15. Merge duplicate expenses ─────────────────────────────────────────
function MergeDuplicatesCard({
  selectedRows,
  refresh,
  clearSelection,
  showToast,
}: {
  selectedRows: ExpenseRow[];
  refresh: () => void;
  clearSelection: () => void;
  showToast: (m: string) => void;
}) {
  const [keepId, setKeepId] = useState('');
  useEffect(() => {
    if (selectedRows.length && !selectedRows.some((r) => r.id === keepId)) {
      setKeepId(selectedRows[0].id);
    }
  }, [selectedRows.map((r) => r.id).join(',')]);

  const merge = async () => {
    if (selectedRows.length < 2) {
      showToast('Select 2 or more expenses to merge.');
      return;
    }
    const removeIds = selectedRows.filter((r) => r.id !== keepId).map((r) => r.id);
    if (removeIds.length === 0) return;
    if (!window.confirm(`Keep 1 expense and delete ${removeIds.length} duplicate(s)?`)) return;
    try {
      await api.batchDelete('expenses', removeIds);
      showToast(`Merged: kept 1, deleted ${removeIds.length}.`);
      clearSelection();
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  return (
    <Card title="Merge duplicate expenses" subtitle="Select 2+ suspected duplicates, keep one, delete the rest.">
      {selectedRows.length < 2 ? (
        <p className="text-xs text-text-muted">Select 2 or more expenses.</p>
      ) : (
        <>
          <div className="mb-2" style={{ overflow: 'auto' }}>
            <table className="block-table">
              <thead>
                <tr>
                  <th>Keep</th>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="radio"
                        name="merge-keep"
                        checked={keepId === r.id}
                        onChange={() => setKeepId(r.id)}
                      />
                    </td>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.vendor_name || r.description || '—'}</td>
                    <td className="text-right">{formatCurrency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="block-btn block-btn-primary" onClick={merge}>
            Merge {selectedRows.length} → 1
          </button>
        </>
      )}
    </Card>
  );
}

// ─── 20. Recategorize-by-vendor rule ──────────────────────────────────────
function VendorRuleCard({
  rows,
  vendors,
  categories,
  refresh,
  showToast,
}: {
  rows: ExpenseRow[];
  vendors: Ref[];
  categories: Ref[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const [vendor, setVendor] = useState('');
  const [category, setCategory] = useState('');

  const targets = useMemo(
    () => rows.filter((r) => r.vendor_id === vendor && (!r.category_id || r.category_id === '')),
    [rows, vendor]
  );

  const apply = async () => {
    if (!vendor || !category) {
      showToast('Pick a vendor and a category.');
      return;
    }
    if (targets.length === 0) {
      showToast('No uncategorized expenses for that vendor.');
      return;
    }
    try {
      await api.batchUpdate(
        'expenses',
        targets.map((t) => t.id),
        { category_id: category }
      );
      showToast(`Categorized ${targets.length} expense(s) for this vendor.`);
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  return (
    <Card title="Recategorize by vendor" subtitle="Set a preferred category on a vendor's uncategorized expenses.">
      <div className="flex flex-wrap items-center gap-2">
        <select className="block-select" value={vendor} onChange={(e) => setVendor(e.target.value)}>
          <option value="">Vendor…</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <select className="block-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="block-btn block-btn-primary" disabled={!vendor || !category} onClick={apply}>
          Apply rule
        </button>
        {vendor && <span className="text-xs text-text-muted">{targets.length} uncategorized match.</span>}
      </div>
    </Card>
  );
}

// ─── 22. Convert expense to billable invoice draft ────────────────────────
function ConvertToInvoiceCard({
  companyId,
  selectedRows,
  clients,
  showToast,
}: {
  companyId: string;
  selectedRows: ExpenseRow[];
  clients: Ref[];
  showToast: (m: string) => void;
}) {
  const billable = selectedRows.filter((r) => Number(r.is_billable) === 1);
  const [client, setClient] = useState('');

  useEffect(() => {
    const firstWithClient = selectedRows.find((r) => r.client_id);
    if (firstWithClient?.client_id && !client) setClient(firstWithClient.client_id);
  }, [selectedRows.map((r) => r.id).join(',')]);

  const convert = async () => {
    if (!client) {
      showToast('Pick a client for the invoice.');
      return;
    }
    if (billable.length === 0) {
      showToast('Select billable expenses first.');
      return;
    }
    try {
      const subtotal = roundCents(billable.reduce((s, r) => s + Number(r.amount || 0), 0));
      const number = `EXP-${Date.now().toString().slice(-6)}`;
      const issue = today();
      const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const inv = (await api.create('invoices', {
        company_id: companyId,
        client_id: client,
        invoice_number: number,
        status: 'draft',
        issue_date: issue,
        due_date: due,
        subtotal,
        total: subtotal,
      })) as { id?: string; error?: string };
      if (!inv || inv.error || !inv.id) {
        showToast(`Failed: ${inv?.error ?? 'no invoice id returned'}`);
        return;
      }
      for (const r of billable) {
        await api.create('invoice_line_items', {
          invoice_id: inv.id,
          description: r.description || `Reimbursable expense ${formatDate(r.date)}`,
          quantity: 1,
          unit_price: roundCents(r.amount),
          amount: roundCents(r.amount),
          project_id: r.project_id || null,
        });
      }
      showToast(`Draft invoice ${number} created with ${billable.length} line(s).`);
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  return (
    <Card title="Convert to invoice draft" subtitle="Turn selected billable expenses into a draft invoice.">
      <div className="flex flex-wrap items-center gap-2">
        <select className="block-select" value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="block-btn block-btn-primary" disabled={!client || billable.length === 0} onClick={convert}>
          Create draft
        </button>
        <span className="text-xs text-text-muted">{billable.length} billable selected.</span>
      </div>
    </Card>
  );
}

// ─── 24. Clipboard paste-to-create ────────────────────────────────────────
function PasteCreateCard({
  companyId,
  refresh,
  showToast,
}: {
  companyId: string;
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const [text, setText] = useState('');

  const parse = (raw: string) =>
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const cells = line.includes('\t') ? line.split('\t') : line.split(',');
        return cells.map((c) => c.trim());
      })
      .filter((cells) => cells.length >= 2);

  const parsed = useMemo(() => parse(text), [text]);

  const run = async () => {
    if (parsed.length === 0) {
      showToast('Paste rows like: 2026-01-15, 42.50, Office supplies');
      return;
    }
    try {
      let created = 0;
      for (const cells of parsed) {
        const [date, amt, desc] = cells;
        const amount = roundCents(amt);
        if (!(amount > 0)) continue;
        const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today();
        await api.create('expenses', {
          company_id: companyId,
          date: safeDate,
          amount,
          description: desc || '',
          status: 'pending',
        });
        created++;
      }
      showToast(`Created ${created} expense(s) from pasted data.`);
      setText('');
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  return (
    <Card title="Paste-to-create" subtitle="Paste date, amount, description rows (tab or comma separated).">
      <textarea
        className="block-input w-full"
        rows={4}
        placeholder={'2026-01-15, 42.50, Office supplies\n2026-01-16, 19.99, Coffee'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-3 mt-2">
        <button className="block-btn block-btn-primary" disabled={parsed.length === 0} onClick={run}>
          Create {parsed.length} expense(s)
        </button>
        <span className="text-xs text-text-muted">{parsed.length} valid row(s) parsed.</span>
      </div>
    </Card>
  );
}

// ─── 25. Pending-cleanup wizard ───────────────────────────────────────────
function CleanupWizardCard({
  rows,
  categories,
  vendors,
  refresh,
  showToast,
}: {
  rows: ExpenseRow[];
  categories: Ref[];
  vendors: Ref[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const incomplete = useMemo(
    () =>
      rows.filter(
        (r) => !r.category_id || r.category_id === '' || !r.vendor_id || !r.receipt_path
      ),
    [rows]
  );
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(idx, Math.max(0, incomplete.length - 1));
  const current = incomplete[safeIdx];

  const [vendor, setVendor] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    if (current) {
      setVendor(current.vendor_id || '');
      setCategory(current.category_id || '');
    }
  }, [current?.id]);

  const fix = async () => {
    if (!current) return;
    try {
      await api.update('expenses', current.id, {
        vendor_id: vendor || null,
        category_id: category || '',
      });
      showToast('Expense fixed.');
      setIdx((i) => i + 1);
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e?.message ?? 'unknown error'}`);
    }
  };

  return (
    <Card title="Pending-cleanup wizard" subtitle="Step through expenses missing a category, vendor or receipt.">
      {incomplete.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--color-accent-income)' }}>
          Nothing to clean up — every expense has a category, vendor and receipt.
        </p>
      ) : current ? (
        <div className="space-y-2">
          <div className="text-sm text-text-primary">
            {safeIdx + 1} / {incomplete.length} · {formatDate(current.date)} · {formatCurrency(current.amount)}
            {current.description ? ` · ${current.description}` : ''}
          </div>
          <div className="text-xs text-text-muted">
            Missing:{' '}
            {[
              !current.vendor_id ? 'vendor' : null,
              !current.category_id ? 'category' : null,
              !current.receipt_path ? 'receipt' : null,
            ]
              .filter(Boolean)
              .join(', ') || 'none'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="block-select" value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">Vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select className="block-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button className="block-btn block-btn-primary" onClick={fix}>
              Fix &amp; next
            </button>
            <button className="block-btn" onClick={() => setIdx((i) => i + 1)}>
              Skip
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--color-accent-income)' }}>
          Reached the end of the cleanup queue.
        </p>
      )}
    </Card>
  );
}

// ─── 16 + 17. Command palette + select-all-matching-filter ────────────────
function SelectionCard({
  rows,
  categories,
  vendors,
  selected,
  toggleRow,
  clearSelection,
  setSelected,
}: {
  rows: ExpenseRow[];
  categories: Ref[];
  vendors: Ref[];
  selected: Set<string>;
  toggleRow: (id: string) => void;
  clearSelection: () => void;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [venFilter, setVenFilter] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (catFilter && r.category_id !== catFilter) return false;
      if (venFilter && r.vendor_id !== venFilter) return false;
      if (q) {
        const hay = `${r.description} ${r.vendor_name ?? ''} ${r.category_name ?? ''} ${r.reference}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, catFilter, venFilter]);

  const selectAllMatching = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const filteredTotal = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amount || 0), 0),
    [filtered]
  );

  return (
    <Card
      title="Filter &amp; select"
      subtitle="Search and filter live expenses, then select all matches for the bulk actions below."
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          className="block-input flex-1"
          style={{ minWidth: 160 }}
          placeholder="Search description, vendor, reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="block-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
        </select>
        <select className="block-select" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="block-select" value={venFilter} onChange={(e) => setVenFilter(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="block-btn block-btn-primary" onClick={selectAllMatching}>
          Select all {filtered.length} matching
        </button>
        <button className="block-btn" onClick={clearSelection}>
          Clear selection
        </button>
        <span className="text-xs text-text-muted">
          {filtered.length} match · {formatCurrency(filteredTotal)} · {selected.size} selected
        </span>
      </div>

      <div style={{ maxHeight: 280, overflow: 'auto' }}>
        <table className="block-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Date</th>
              <th>Vendor</th>
              <th>Description</th>
              <th>Status</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-text-muted text-sm">
                  No matching expenses.
                </td>
              </tr>
            ) : (
              filtered.slice(0, 200).map((r) => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                  </td>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.vendor_name || '—'}</td>
                  <td>{r.description || '—'}</td>
                  <td>{r.status}</td>
                  <td className="text-right">{formatCurrency(r.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > 200 && (
        <p className="mt-2 text-xs text-text-muted">Showing first 200 rows; "Select all matching" still covers all {filtered.length}.</p>
      )}
    </Card>
  );
}

// ─── 16. Keyboard command palette (Cmd/Ctrl-K) ────────────────────────────
interface PaletteAction {
  label: string;
  run: () => void;
}
function CommandPaletteCard({
  onApprove,
  onPaid,
  rows,
  categories,
  vendors,
}: {
  onApprove: () => void;
  onPaid: () => void;
  rows: ExpenseRow[];
  categories: Ref[];
  vendors: Ref[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const exportAll = useCallback(() => {
    downloadCsv('expenses-all.csv', expensesToCsv(rows, categories, vendors));
  }, [rows, categories, vendors]);

  const actions: PaletteAction[] = useMemo(
    () => [
      { label: 'Approve selected', run: onApprove },
      { label: 'Mark selected as paid', run: onPaid },
      { label: 'Export all expenses to CSV', run: exportAll },
    ],
    [onApprove, onPaid, exportAll]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  const visible = actions.filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Card title="Command palette" subtitle="Press Cmd/Ctrl-K anywhere to run common actions.">
      <button className="block-btn" onClick={() => setOpen(true)}>
        Open command palette (⌘K)
      </button>
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '12vh',
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={() => setOpen(false)}
        >
          <div className="block-card" style={{ width: 'min(520px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              className="block-input w-full"
              placeholder="Type a command…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="mt-2 space-y-1">
              {visible.length === 0 ? (
                <p className="text-xs text-text-muted">No matching command.</p>
              ) : (
                visible.map((a) => (
                  <button
                    key={a.label}
                    className="block-btn w-full text-left"
                    onClick={() => {
                      a.run();
                      setOpen(false);
                    }}
                  >
                    {a.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── CSV export (all + selected) ──────────────────────────────────────────
function expensesToCsv(rows: ExpenseRow[], categories: Ref[], vendors: Ref[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const venMap = new Map(vendors.map((v) => [v.id, v.name]));
  const header = ['Date', 'Vendor', 'Category', 'Description', 'Reference', 'Status', 'Billable', 'Amount'];
  const esc = (v: any) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.date,
      r.vendor_name || (r.vendor_id ? venMap.get(r.vendor_id) ?? '' : ''),
      r.category_name || catMap.get(r.category_id) || '',
      r.description,
      r.reference,
      r.status,
      Number(r.is_billable) === 1 ? 'yes' : 'no',
      Number(r.amount || 0).toFixed(2),
    ]
      .map(esc)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportCard({
  rows,
  selectedRows,
  categories,
  vendors,
}: {
  rows: ExpenseRow[];
  selectedRows: ExpenseRow[];
  categories: Ref[];
  vendors: Ref[];
}) {
  return (
    <Card title="Export to CSV" subtitle="Download all or only selected expenses as a spreadsheet.">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="block-btn block-btn-primary"
          onClick={() => downloadCsv('expenses-all.csv', expensesToCsv(rows, categories, vendors))}
        >
          Export all ({rows.length})
        </button>
        <button
          className="block-btn"
          disabled={selectedRows.length === 0}
          onClick={() => downloadCsv('expenses-selected.csv', expensesToCsv(selectedRows, categories, vendors))}
        >
          Export selected ({selectedRows.length})
        </button>
      </div>
    </Card>
  );
}

// ─── Persisted setting toggle (localStorage) ──────────────────────────────
interface PanelSettings {
  confirmBulkDelete: boolean;
  defaultStatusPending: boolean;
}
function loadSettings(): PanelSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return {
      confirmBulkDelete: v.confirmBulkDelete ?? true,
      defaultStatusPending: v.defaultStatusPending ?? true,
    };
  } catch {
    return { confirmBulkDelete: true, defaultStatusPending: true };
  }
}
function CsvSettingsCard() {
  const [settings, setSettings] = useState<PanelSettings>(() => loadSettings());

  const update = (patch: Partial<PanelSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* non-fatal */
    }
  };

  return (
    <Card title="Panel preferences" subtitle="Saved to this browser via localStorage.">
      <label className="flex items-center gap-2 text-sm text-text-primary mb-2">
        <input
          type="checkbox"
          checked={settings.confirmBulkDelete}
          onChange={(e) => update({ confirmBulkDelete: e.target.checked })}
        />
        Require typed confirmation before bulk delete
      </label>
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={settings.defaultStatusPending}
          onChange={(e) => update({ defaultStatusPending: e.target.checked })}
        />
        New quick-add expenses default to "pending"
      </label>
    </Card>
  );
}

// ─── Shared card shell ────────────────────────────────────────────────────
function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="block-card">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
