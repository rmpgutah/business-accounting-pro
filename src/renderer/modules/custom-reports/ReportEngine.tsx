import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BookOpen,
  Play,
  Copy,
  Trash2,
  Plus,
  Download,
  Globe,
  Star,
  ChevronRight,
  ChevronLeft,
  BarChart2,
  FileText,
  Save,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Constants ───────────────────────────────────────────────────────────────

const SOURCE_TABLES = [
  'invoices',
  'expenses',
  'clients',
  'vendors',
  'bills',
  'projects',
  'time_entries',
  'employees',
  'bank_transactions',
  'accounts',
];

const AGG_OPS = ['sum', 'avg', 'min', 'max', 'count'] as const;
type AggOp = typeof AGG_OPS[number];

const PAGE_SIZE = 50;

const CURRENCY_FIELD = /amount|total|price|rate|pay|cost|balance|fee|net|subtotal|paid|budget/i;
const DATE_FIELD = /date|_at$/i;

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function cellDisplay(val: unknown, key: string): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number' && CURRENCY_FIELD.test(key)) return formatCurrency(val);
  if (typeof val === 'string' && DATE_FIELD.test(key) && /^\d{4}-\d{2}-\d{2}/.test(val))
    return formatDate(val);
  return String(val);
}

// ─── Sub-types ───────────────────────────────────────────────────────────────

interface ReportDef {
  id: string;
  name: string;
  source_table: string | null;
  category: string | null;
  description: string | null;
  permission_level: string | null;
}

interface SourceCol {
  name: string;
  type: string;
  display_name: string;
  format_hint: string | null;
}

interface RunResult {
  run_id: string;
  status: string;
  row_count: number;
  elapsed_ms: number;
  rows: any[];
}

interface SavedView {
  id: string;
  name: string;
  is_default: number;
  visibility: string;
  sort_by: string | null;
  grouping: string | null;
}

interface NarrativeTemplate {
  id: string;
  name: string;
  template_type: string;
}

// ─── New Definition Form ──────────────────────────────────────────────────────

interface NewDefFormProps {
  onSaved: (id: string) => void;
  onCancel: () => void;
}

function NewDefForm({ onSaved, onCancel }: NewDefFormProps) {
  const [name, setName] = useState('');
  const [sourceTable, setSourceTable] = useState(SOURCE_TABLES[0]);
  const [columns, setColumns] = useState<SourceCol[]>([]);
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setColumns([]);
    setSelectedCols([]);
    api.rptSourceColumns(sourceTable).then((result: any) => {
      if (cancelledRef.current) return;
      if (Array.isArray(result)) {
        setColumns(result);
        setSelectedCols(result.slice(0, 6).map((c: SourceCol) => c.name));
      }
    });
    return () => { cancelledRef.current = true; };
  }, [sourceTable]);

  const toggleCol = (col: string) => {
    setSelectedCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    const result: any = await api.rptDefCreate({
      name: name.trim(),
      source_table: sourceTable,
      columns: selectedCols,
      description: description.trim() || null,
      category: 'custom',
      permission_level: 'private',
    });
    setSaving(false);
    if (result?.error) { setError(result.error); return; }
    onSaved(result.id);
  };

  return (
    <div className="block-card space-y-4">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        New Report Definition
      </h3>

      {error && (
        <p className="text-xs" style={{ color: 'var(--color-accent-expense)' }}>{error}</p>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Name</label>
        <input
          className="block-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Report"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Data Source</label>
        <select
          className="block-select"
          value={sourceTable}
          onChange={(e) => setSourceTable(e.target.value)}
        >
          {SOURCE_TABLES.map((t) => (
            <option key={t} value={t}>{humanize(t)}</option>
          ))}
        </select>
      </div>

      {columns.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Columns ({selectedCols.length} selected)
          </label>
          <div className="flex flex-wrap gap-1">
            {columns.map((col) => {
              const active = selectedCols.includes(col.name);
              return (
                <button
                  key={col.name}
                  onClick={() => toggleCol(col.name)}
                  className="text-xs px-2 py-0.5 transition-colors"
                  style={{
                    borderRadius: 'var(--app-radius)',
                    background: active ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
                    color: active ? '#fff' : 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border-primary)',
                  }}
                >
                  {col.display_name || col.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Description (optional)</label>
        <input
          className="block-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this report show?"
        />
      </div>

      <div className="flex gap-2">
        <button
          className="block-btn-primary text-xs"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Create'}
        </button>
        <button className="block-btn text-xs" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Definitions List (left pane) ─────────────────────────────────────────────

interface DefListProps {
  selectedId: string | null;
  onSelect: (def: ReportDef) => void;
  refreshKey: number;
  onNew: () => void;
}

function DefList({ selectedId, onSelect, refreshKey, onNew }: DefListProps) {
  const [defs, setDefs] = useState<ReportDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [cloning, setCloning] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(() => {
    cancelledRef.current = false;
    setLoading(true);
    api.rptDefList().then((result: any) => {
      if (cancelledRef.current) return;
      setDefs(Array.isArray(result) ? result : []);
      setLoading(false);
    });
    return () => { cancelledRef.current = true; };
  }, []);

  useEffect(() => {
    const cancel = load();
    return cancel;
  }, [load, refreshKey]);

  const handleDelete = async (def: ReportDef, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${def.name}"? This cannot be undone.`)) return;
    await api.rptDefDelete(def.id);
    load();
  };

  const handleClone = async (def: ReportDef, e: React.MouseEvent) => {
    e.stopPropagation();
    setCloning(def.id);
    await api.rptDefClone(def.id, `${def.name} (copy)`);
    setCloning(null);
    load();
  };

  if (loading) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Loading definitions…
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Saved Reports
        </span>
        <button
          className="block-btn text-xs flex items-center gap-1"
          onClick={onNew}
        >
          <Plus size={12} /> New
        </button>
      </div>

      {defs.length === 0 ? (
        <div className="text-xs text-center py-6" style={{ color: 'var(--color-text-muted)' }}>
          No report definitions yet.
          <br />
          <button className="underline mt-1" style={{ color: 'var(--color-accent-primary)' }} onClick={onNew}>
            Create one
          </button>
        </div>
      ) : (
        defs.map((def) => {
          const active = def.id === selectedId;
          return (
            <div
              key={def.id}
              onClick={() => onSelect(def)}
              className="flex items-center gap-2 px-2 py-2 cursor-pointer transition-colors"
              style={{
                borderRadius: 'var(--app-radius)',
                background: active ? 'var(--color-accent-primary)' : 'transparent',
                color: active ? '#fff' : 'var(--color-text-primary)',
              }}
            >
              <BookOpen size={13} style={{ flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{def.name}</div>
                {def.source_table && (
                  <div
                    className="text-xs truncate"
                    style={{ color: active ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}
                  >
                    {humanize(def.source_table)}
                  </div>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  title="Clone"
                  disabled={cloning === def.id}
                  onClick={(e) => handleClone(def, e)}
                  className="p-1 rounded transition-colors hover:opacity-70"
                  style={{ color: active ? 'rgba(255,255,255,0.8)' : 'var(--color-text-muted)' }}
                >
                  <Copy size={11} />
                </button>
                <button
                  title="Delete"
                  onClick={(e) => handleDelete(def, e)}
                  className="p-1 rounded transition-colors hover:opacity-70"
                  style={{ color: active ? 'rgba(255,255,255,0.8)' : 'var(--color-accent-expense)' }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Saved Views panel ────────────────────────────────────────────────────────

interface SavedViewsPanelProps {
  reportId: string;
  currentRows: any[];
  currentRunId: string | null;
  onViewRun: (rows: any[], runId: string) => void;
}

function SavedViewsPanel({ reportId, currentRows, currentRunId, onViewRun }: SavedViewsPanelProps) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [saving, setSaving] = useState(false);
  const cancelledRef = useRef(false);

  const loadViews = useCallback(() => {
    cancelledRef.current = false;
    api.rptViewList(reportId).then((result: any) => {
      if (cancelledRef.current) return;
      setViews(Array.isArray(result) ? result : []);
    });
    return () => { cancelledRef.current = true; };
  }, [reportId]);

  useEffect(() => {
    const cancel = loadViews();
    return cancel;
  }, [loadViews]);

  const handleSaveView = async () => {
    if (!newViewName.trim()) return;
    setSaving(true);
    await api.rptViewSave({
      report_definition_id: reportId,
      name: newViewName.trim(),
      columns: currentRows.length > 0 ? Object.keys(currentRows[0]) : [],
      visibility: 'private',
      is_default: false,
    });
    setSaving(false);
    setNewViewName('');
    setShowForm(false);
    loadViews();
  };

  const handleRunView = async (view: SavedView) => {
    const result: any = await api.rptViewRun(view.id);
    if (result?.run_id) {
      const rowData: any = await api.rptRunRows(result.run_id, 0, PAGE_SIZE);
      onViewRun(rowData?.rows || result.rows || [], result.run_id);
    }
  };

  const handleSetDefault = async (view: SavedView) => {
    await api.rptViewSetDefault(view.id);
    loadViews();
  };

  const handleDeleteView = async (view: SavedView) => {
    if (!window.confirm(`Delete view "${view.name}"?`)) return;
    await api.rptViewDelete(view.id);
    loadViews();
  };

  return (
    <div
      className="block-card space-y-3"
      style={{ borderTop: '1px solid var(--color-border-primary)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Saved Views
        </span>
        <button
          className="block-btn text-xs flex items-center gap-1"
          onClick={() => setShowForm((v) => !v)}
          disabled={!currentRunId}
          title={!currentRunId ? 'Run the report first' : 'Save current view'}
        >
          <Save size={11} /> Save View
        </button>
      </div>

      {showForm && (
        <div className="flex gap-2">
          <input
            className="block-input text-xs flex-1"
            placeholder="View name"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
          />
          <button className="block-btn-primary text-xs" onClick={handleSaveView} disabled={saving}>
            {saving ? '…' : 'Save'}
          </button>
          <button className="block-btn text-xs" onClick={() => setShowForm(false)}>×</button>
        </div>
      )}

      {views.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No saved views yet.</p>
      ) : (
        <div className="space-y-1">
          {views.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded"
              style={{
                borderRadius: 'var(--app-radius)',
                background: 'var(--color-bg-tertiary)',
              }}
            >
              {v.is_default ? (
                <Star size={11} style={{ color: 'var(--color-accent-warning)', flexShrink: 0 }} />
              ) : (
                <FileText size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              )}
              <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text-primary)' }}>
                {v.name}
                {v.visibility !== 'private' && (
                  <span className="ml-1 text-xs" style={{ color: 'var(--color-accent-blue)' }}>
                    ({v.visibility})
                  </span>
                )}
              </span>
              <button
                title="Run this view"
                onClick={() => handleRunView(v)}
                className="p-0.5 hover:opacity-70 transition-colors"
                style={{ color: 'var(--color-accent-primary)' }}
              >
                <Play size={10} />
              </button>
              {!v.is_default && (
                <button
                  title="Set as default"
                  onClick={() => handleSetDefault(v)}
                  className="p-0.5 hover:opacity-70 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <Star size={10} />
                </button>
              )}
              <button
                title="Delete view"
                onClick={() => handleDeleteView(v)}
                className="p-0.5 hover:opacity-70 transition-colors"
                style={{ color: 'var(--color-accent-expense)' }}
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Narrative Panel ──────────────────────────────────────────────────────────

function NarrativePanel() {
  const [templates, setTemplates] = useState<NarrativeTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [rendered, setRendered] = useState('');
  const [rendering, setRendering] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    api.rptNarrativeList().then((result: any) => {
      if (cancelledRef.current) return;
      setTemplates(Array.isArray(result) ? result : []);
    });
    return () => { cancelledRef.current = true; };
  }, []);

  const handleRender = async () => {
    if (!selectedId) return;
    setRendering(true);
    setRendered('');
    const result: any = await api.rptNarrativeRender(selectedId, {});
    setRendering(false);
    setRendered(result?.rendered ?? result?.error ?? '');
  };

  if (templates.length === 0) return null;

  return (
    <div
      className="block-card space-y-3"
      style={{ borderTop: '1px solid var(--color-border-primary)' }}
    >
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
        Narrative
      </span>
      <div className="flex gap-2">
        <select
          className="block-select text-xs flex-1"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">Select template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button
          className="block-btn-primary text-xs"
          onClick={handleRender}
          disabled={!selectedId || rendering}
        >
          {rendering ? '…' : 'Render'}
        </button>
      </div>
      {rendered && (
        <div
          className="text-xs p-2"
          style={{
            borderRadius: 'var(--app-radius)',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            maxHeight: '120px',
            overflowY: 'auto',
          }}
        >
          {rendered}
        </div>
      )}
    </div>
  );
}

// ─── Right Pane: Report Runner ────────────────────────────────────────────────

interface ReportRunnerProps {
  def: ReportDef;
}

function ReportRunner({ def }: ReportRunnerProps) {
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

  // Row-op state
  const [groupBy, setGroupBy] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [aggCol, setAggCol] = useState('');
  const [aggOp, setAggOp] = useState<AggOp>('sum');
  const [aggResult, setAggResult] = useState<number | null>(null);
  const [groupedRows, setGroupedRows] = useState<Record<string, any[]> | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const cancelledRef = useRef(false);

  // Reset everything when the selected def changes
  useEffect(() => {
    setRunResult(null);
    setRows([]);
    setTotal(0);
    setPage(0);
    setRunError('');
    setGroupBy('');
    setSortBy('');
    setAggResult(null);
    setGroupedRows(null);
    setExportMsg('');
  }, [def.id]);

  const handleRun = async () => {
    cancelledRef.current = false;
    setRunning(true);
    setRunError('');
    setGroupedRows(null);
    setAggResult(null);
    setGroupBy('');
    setSortBy('');
    setPage(0);

    const result: any = await api.rptRun(def.id);
    if (cancelledRef.current) return;

    if (result?.error) {
      setRunError(result.error);
      setRunning(false);
      return;
    }

    setRunResult(result);
    // Fetch first page from disk snapshot for accuracy
    const pageData: any = await api.rptRunRows(result.run_id, 0, PAGE_SIZE);
    if (cancelledRef.current) return;
    setRows(pageData?.rows ?? result.rows?.slice(0, PAGE_SIZE) ?? []);
    setTotal(pageData?.total ?? result.row_count ?? 0);
    setRunning(false);
  };

  const loadPage = async (p: number) => {
    if (!runResult) return;
    cancelledRef.current = false;
    const pageData: any = await api.rptRunRows(runResult.run_id, p * PAGE_SIZE, PAGE_SIZE);
    if (cancelledRef.current) return;
    setPage(p);
    setRows(pageData?.rows ?? []);
    setGroupedRows(null);
    setAggResult(null);
  };

  const handleGroupBy = async () => {
    if (!groupBy || rows.length === 0) return;
    const result: any = await api.rptRowsGroup(rows, groupBy);
    setGroupedRows(typeof result === 'object' && !Array.isArray(result) ? result : null);
  };

  const handleSort = async () => {
    if (!sortBy || rows.length === 0) return;
    const result: any = await api.rptRowsSort(rows, sortBy, sortDir);
    if (Array.isArray(result)) setRows(result);
    setGroupedRows(null);
  };

  const handleAggregate = async () => {
    if (!aggCol || rows.length === 0) return;
    const result: any = await api.rptRowsAggregate(rows, aggCol, aggOp);
    setAggResult(typeof result === 'number' ? result : null);
  };

  const handleExportCsv = async () => {
    if (!runResult) return;
    setExporting(true);
    const result: any = await api.rptExportCsv(runResult.run_id);
    setExporting(false);
    setExportMsg(result?.path ? `CSV saved: ${result.path}` : result?.error ?? 'Export failed');
  };

  const handleExportHtml = async () => {
    if (!runResult) return;
    setExporting(true);
    const result: any = await api.rptExportHtml(runResult.run_id, def.name);
    setExporting(false);
    setExportMsg(result?.path ? `HTML saved: ${result.path}` : result?.error ?? 'Export failed');
  };

  const colKeys = rows.length > 0 ? Object.keys(rows[0]) : [];
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Flatten grouped rows back to a display list
  const flatGrouped: Array<{ groupKey: string; rows: any[] }> = groupedRows
    ? Object.entries(groupedRows).map(([k, v]) => ({ groupKey: k, rows: v }))
    : [];

  return (
    <div className="space-y-4">
      {/* Header + Run */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {def.name}
          </h2>
          {def.source_table && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Source: {humanize(def.source_table)}
              {def.description ? ` — ${def.description}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={handleRun}
            disabled={running}
          >
            <Play size={13} />
            {running ? 'Running…' : 'Run Report'}
          </button>
          {runResult && (
            <>
              <button
                className="block-btn flex items-center gap-1 text-xs"
                onClick={handleExportCsv}
                disabled={exporting}
                title="Export to CSV"
              >
                <Download size={12} /> CSV
              </button>
              <button
                className="block-btn flex items-center gap-1 text-xs"
                onClick={handleExportHtml}
                disabled={exporting}
                title="Export to HTML"
              >
                <Globe size={12} /> HTML
              </button>
            </>
          )}
        </div>
      </div>

      {runError && (
        <div
          className="text-xs px-3 py-2"
          style={{
            borderRadius: 'var(--app-radius)',
            background: 'rgba(var(--color-accent-expense-rgb,220,38,38),0.08)',
            border: '1px solid var(--color-accent-expense)',
            color: 'var(--color-accent-expense)',
          }}
        >
          {runError}
        </div>
      )}

      {exportMsg && (
        <div
          className="text-xs px-3 py-2"
          style={{
            borderRadius: 'var(--app-radius)',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {exportMsg}
        </div>
      )}

      {/* Row-ops toolbar — only shown after a run */}
      {runResult && colKeys.length > 0 && (
        <div
          className="block-card space-y-3"
          style={{ padding: '10px 12px' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Row Operations
          </span>
          <div className="flex flex-wrap gap-3 items-end">
            {/* Group-by */}
            <div className="flex items-center gap-1">
              <select
                className="block-select text-xs"
                value={groupBy}
                onChange={(e) => { setGroupBy(e.target.value); setGroupedRows(null); }}
                style={{ width: 'auto' }}
              >
                <option value="">Group by…</option>
                {colKeys.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
              </select>
              <button
                className="block-btn text-xs"
                disabled={!groupBy}
                onClick={handleGroupBy}
              >
                <BarChart2 size={11} />
              </button>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1">
              <select
                className="block-select text-xs"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="">Sort by…</option>
                {colKeys.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
              </select>
              <select
                className="block-select text-xs"
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                style={{ width: '70px' }}
              >
                <option value="asc">ASC</option>
                <option value="desc">DESC</option>
              </select>
              <button
                className="block-btn text-xs"
                disabled={!sortBy}
                onClick={handleSort}
              >
                Sort
              </button>
            </div>

            {/* Aggregate */}
            <div className="flex items-center gap-1">
              <select
                className="block-select text-xs"
                value={aggCol}
                onChange={(e) => { setAggCol(e.target.value); setAggResult(null); }}
                style={{ width: 'auto' }}
              >
                <option value="">Aggregate col…</option>
                {colKeys.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
              </select>
              <select
                className="block-select text-xs"
                value={aggOp}
                onChange={(e) => setAggOp(e.target.value as AggOp)}
                style={{ width: '70px' }}
              >
                {AGG_OPS.map((op) => <option key={op} value={op}>{op.toUpperCase()}</option>)}
              </select>
              <button
                className="block-btn text-xs"
                disabled={!aggCol}
                onClick={handleAggregate}
              >
                Calc
              </button>
              {aggResult !== null && (
                <span className="text-xs font-mono font-semibold" style={{ color: 'var(--color-accent-income)' }}>
                  = {CURRENCY_FIELD.test(aggCol) ? formatCurrency(aggResult) : String(aggResult)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results table */}
      {running ? (
        <div className="empty-state">
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Running report…</p>
        </div>
      ) : runResult === null ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <BookOpen size={24} style={{ color: 'var(--color-text-muted)' }} />
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Click Run Report to fetch data
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Results appear here after the first run
          </p>
        </div>
      ) : groupedRows ? (
        /* Grouped view */
        <div className="space-y-3">
          {flatGrouped.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No groups.</p>
          ) : (
            flatGrouped.map(({ groupKey, rows: gRows }) => (
              <div key={groupKey} className="block-card">
                <div
                  className="text-xs font-semibold mb-2 pb-2"
                  style={{
                    borderBottom: '1px solid var(--color-border-primary)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {groupBy}: {groupKey === '__none__' ? '(none)' : groupKey}
                  <span className="ml-2 font-normal" style={{ color: 'var(--color-text-muted)' }}>
                    {gRows.length} row{gRows.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="block-table">
                    <thead>
                      <tr>
                        {Object.keys(gRows[0] || {}).map((h) => (
                          <th key={h}>{humanize(h)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gRows.slice(0, 20).map((row, i) => (
                        <tr key={i}>
                          {Object.keys(row).map((k) => (
                            <td key={k} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                              {cellDisplay(row[k], k)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {gRows.length > 20 && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      …and {gRows.length - 20} more rows in this group.
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
          <button className="block-btn text-xs" onClick={() => setGroupedRows(null)}>
            Clear grouping
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No rows returned.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            The query ran successfully but returned 0 rows.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {total} row{total !== 1 ? 's' : ''} total
              {runResult && ` — ran in ${runResult.elapsed_ms}ms`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  className="block-btn text-xs p-1"
                  onClick={() => loadPage(page - 1)}
                  disabled={page === 0}
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {page + 1} / {totalPages}
                </span>
                <button
                  className="block-btn text-xs p-1"
                  onClick={() => loadPage(page + 1)}
                  disabled={page >= totalPages - 1}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="block-table">
              <thead>
                <tr>
                  {colKeys.map((h) => <th key={h}>{humanize(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {colKeys.map((k) => (
                      <td
                        key={k}
                        className="text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {cellDisplay(row[k], k)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Saved Views + Narrative — only after a def is selected */}
      {runResult && (
        <SavedViewsPanel
          reportId={def.id}
          currentRows={rows}
          currentRunId={runResult.run_id}
          onViewRun={(newRows, newRunId) => {
            setRows(newRows);
            setRunResult((prev) => prev ? { ...prev, run_id: newRunId, row_count: newRows.length } : prev);
            setGroupedRows(null);
            setAggResult(null);
          }}
        />
      )}

      <NarrativePanel />
    </div>
  );
}

// ─── Root: ReportEngine ───────────────────────────────────────────────────────

export default function ReportEngine() {
  const [selectedDef, setSelectedDef] = useState<ReportDef | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [listRefreshKey, setListRefreshKey] = useState(0);

  const handleDefCreated = (id: string) => {
    setShowNewForm(false);
    setListRefreshKey((k) => k + 1);
    // Auto-select the new definition by id (set via a placeholder that forces list reload)
    // We'll select it via the list after reload — use a sentinel
    setSelectedDef((prev) => prev?.id === id ? prev : { id, name: '', source_table: null, category: 'custom', description: null, permission_level: 'private' });
  };

  return (
    <div className="grid grid-cols-4 gap-4" style={{ minHeight: '500px' }}>
      {/* LEFT: Definition list */}
      <div
        className="col-span-1 block-card space-y-2"
        style={{ overflowY: 'auto', maxHeight: '80vh' }}
      >
        {showNewForm ? (
          <NewDefForm
            onSaved={handleDefCreated}
            onCancel={() => setShowNewForm(false)}
          />
        ) : (
          <DefList
            selectedId={selectedDef?.id ?? null}
            onSelect={(def) => { setSelectedDef(def); setShowNewForm(false); }}
            refreshKey={listRefreshKey}
            onNew={() => setShowNewForm(true)}
          />
        )}
      </div>

      {/* RIGHT: Runner / empty state */}
      <div className="col-span-3">
        {selectedDef ? (
          <ReportRunner key={selectedDef.id} def={selectedDef} />
        ) : (
          <div className="empty-state h-full">
            <div className="empty-state-icon">
              <BookOpen size={28} style={{ color: 'var(--color-text-muted)' }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Select a report definition to run it
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Or create a new one with the + New button
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
