import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutGrid,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Share2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  BarChart3,
  DollarSign,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ───────────────────────────────────────────────

interface Dashboard {
  id: string;
  name: string;
  slug: string | null;
  layout: string;
  columns: number;
  owner_user_id: string | null;
  visibility: string;
  is_default: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface Widget {
  id: string;
  dashboard_id: string;
  widget_type: string;
  title: string | null;
  kpi_key: string | null;
  report_definition_id: string | null;
  config: Record<string, unknown>;
  config_json: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  refresh_seconds: number;
  data: unknown;
}

interface LoadedDashboard extends Dashboard {
  widgets: Widget[];
}

// ─── KPI widget type options ──────────────────────────────

const WIDGET_TYPES = [
  { value: 'kpi', label: 'KPI Value' },
  { value: 'kpi_trend', label: 'KPI Trend' },
  { value: 'text', label: 'Text / Note' },
];

const KPI_KEYS = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'net_income', label: 'Net Income' },
  { value: 'gross_profit', label: 'Gross Profit' },
  { value: 'ar_balance', label: 'AR Balance' },
  { value: 'ap_balance', label: 'AP Balance' },
  { value: 'cash', label: 'Cash Balance' },
  { value: 'invoices_paid', label: 'Invoices Paid' },
  { value: 'invoices_outstanding', label: 'Invoices Outstanding' },
];

// ─── Widget display ───────────────────────────────────────

const KpiValueDisplay: React.FC<{ widget: Widget }> = ({ widget }) => {
  const kpiData = widget.data as { value?: number; key?: string; period_end?: string } | null;
  if (!kpiData) {
    return <span className="text-text-muted text-xs">No data</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-2xl font-bold text-text-primary"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {formatCurrency(kpiData.value ?? 0)}
      </span>
      {kpiData.period_end && (
        <span className="text-xs text-text-muted">as of {formatDate(kpiData.period_end)}</span>
      )}
    </div>
  );
};

const KpiTrendDisplay: React.FC<{ widget: Widget }> = ({ widget }) => {
  const rows = Array.isArray(widget.data) ? (widget.data as { value?: number; period_end?: string }[]) : [];
  if (rows.length === 0) {
    return <span className="text-text-muted text-xs">No trend data</span>;
  }
  const latest = rows[rows.length - 1];
  const first = rows[0];
  const delta = (latest?.value ?? 0) - (first?.value ?? 0);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xl font-bold text-text-primary">
        {formatCurrency(latest?.value ?? 0)}
      </span>
      <span
        className="text-xs font-semibold"
        style={{ color: delta >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}
      >
        {delta >= 0 ? '+' : ''}
        {formatCurrency(delta)} over {rows.length} periods
      </span>
    </div>
  );
};

const TextDisplay: React.FC<{ widget: Widget }> = ({ widget }) => {
  const cfg = widget.config as { text?: string };
  return (
    <p className="text-sm text-text-secondary leading-relaxed">
      {cfg.text || '(no text)'}
    </p>
  );
};

const WidgetCard: React.FC<{
  widget: Widget;
  onRemove: (id: string) => void;
  onMove: (id: string, dx: number, dy: number) => void;
}> = ({ widget, onRemove, onMove }) => {
  const typeLabel = WIDGET_TYPES.find((t) => t.value === widget.widget_type)?.label ?? widget.widget_type;
  const kpiLabel = KPI_KEYS.find((k) => k.value === widget.kpi_key)?.label ?? widget.kpi_key;

  const renderData = () => {
    switch (widget.widget_type) {
      case 'kpi':
        return <KpiValueDisplay widget={widget} />;
      case 'kpi_trend':
        return <KpiTrendDisplay widget={widget} />;
      case 'text':
        return <TextDisplay widget={widget} />;
      default:
        return <span className="text-text-muted text-xs">Unknown widget type</span>;
    }
  };

  return (
    <div
      className="block-card flex flex-col gap-3 p-4 relative"
      style={{ borderRadius: 'var(--app-radius)' }}
    >
      {/* header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">
            {widget.title || kpiLabel || typeLabel}
          </span>
          <span className="text-xs text-text-muted">{typeLabel}</span>
        </div>
        <button
          className="text-text-muted hover:text-[color:var(--color-accent-expense)] transition-colors flex-shrink-0"
          onClick={() => onRemove(widget.id)}
          title="Remove widget"
        >
          <X size={14} />
        </button>
      </div>

      {/* data area */}
      <div className="flex-1">{renderData()}</div>

      {/* position controls */}
      <div className="flex items-center justify-between border-t border-border-muted pt-2">
        <span className="text-xs text-text-muted">
          pos ({widget.position_x},{widget.position_y}) {widget.width}×{widget.height}
        </span>
        <div className="flex gap-1">
          <button
            className="block-btn py-0 px-1 text-xs"
            onClick={() => onMove(widget.id, -1, 0)}
            title="Move left"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            className="block-btn py-0 px-1 text-xs"
            onClick={() => onMove(widget.id, 0, -1)}
            title="Move up"
          >
            <ChevronUp size={12} />
          </button>
          <button
            className="block-btn py-0 px-1 text-xs"
            onClick={() => onMove(widget.id, 0, 1)}
            title="Move down"
          >
            <ChevronDown size={12} />
          </button>
          <button
            className="block-btn py-0 px-1 text-xs"
            onClick={() => onMove(widget.id, 1, 0)}
            title="Move right"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Add Widget Form ──────────────────────────────────────

const AddWidgetForm: React.FC<{
  dashboardId: string;
  onAdded: () => void;
  onCancel: () => void;
}> = ({ dashboardId, onAdded, onCancel }) => {
  const [widgetType, setWidgetType] = useState<string>('kpi');
  const [title, setTitle] = useState('');
  const [kpiKey, setKpiKey] = useState<string>(KPI_KEYS[0].value);
  const [textContent, setTextContent] = useState('');
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [width, setWidth] = useState(4);
  const [height, setHeight] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    setSaving(true);
    setError(null);
    try {
      const config: Record<string, unknown> = {};
      if (widgetType === 'text') config.text = textContent;

      const result = await api.rptDashAddWidget({
        dashboard_id: dashboardId,
        widget_type: widgetType,
        title: title || undefined,
        kpi_key: (widgetType === 'kpi' || widgetType === 'kpi_trend') ? kpiKey : undefined,
        config,
        position_x: posX,
        position_y: posY,
        width,
        height,
      });

      if (result && (result as { error?: string }).error) {
        setError((result as { error: string }).error);
      } else {
        onAdded();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add widget');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="block-card p-4 flex flex-col gap-3" style={{ borderRadius: 'var(--app-radius)' }}>
      <span className="text-sm font-semibold text-text-primary">Add Widget</span>

      {error && (
        <div
          className="text-xs p-2 rounded"
          style={{
            background: 'color-mix(in srgb, var(--color-accent-expense) 12%, transparent)',
            color: 'var(--color-accent-expense)',
            borderRadius: 'var(--app-radius)',
          }}
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Type</label>
          <select
            className="block-input text-sm"
            value={widgetType}
            onChange={(e) => setWidgetType(e.target.value)}
          >
            {WIDGET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Title (optional)</label>
          <input
            className="block-input text-sm"
            placeholder="Widget title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </div>

      {(widgetType === 'kpi' || widgetType === 'kpi_trend') && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">KPI Key</label>
          <select
            className="block-input text-sm"
            value={kpiKey}
            onChange={(e) => setKpiKey(e.target.value)}
          >
            {KPI_KEYS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
      )}

      {widgetType === 'text' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Text / Note</label>
          <textarea
            className="block-input text-sm resize-none"
            rows={3}
            placeholder="Enter note text..."
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
          />
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'X', value: posX, set: setPosX },
          { label: 'Y', value: posY, set: setPosY },
          { label: 'W', value: width, set: setWidth },
          { label: 'H', value: height, set: setHeight },
        ].map(({ label, value, set }) => (
          <div key={label} className="flex flex-col gap-1">
            <label className="text-xs text-text-muted">{label}</label>
            <input
              type="number"
              className="block-input text-sm"
              min={0}
              max={24}
              value={value}
              onChange={(e) => set(Number(e.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-2 justify-end">
        <button className="block-btn text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="block-btn text-sm"
          onClick={handleAdd}
          disabled={saving}
          style={{ background: 'var(--accent-primary)', color: 'white' }}
        >
          {saving ? 'Adding…' : 'Add Widget'}
        </button>
      </div>
    </div>
  );
};

// ─── Save Version Form ────────────────────────────────────

const SaveVersionForm: React.FC<{
  dashboardId: string;
  onSaved: () => void;
  onCancel: () => void;
}> = ({ dashboardId, onSaved, onCancel }) => {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.rptDashSaveVersion(dashboardId, undefined, note || undefined);
      if (result && (result as { error?: string }).error) {
        setError((result as { error: string }).error);
      } else {
        onSaved();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save version');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="block-card p-4 flex flex-col gap-3" style={{ borderRadius: 'var(--app-radius)' }}>
      <span className="text-sm font-semibold text-text-primary">Save Version Snapshot</span>
      {error && (
        <div
          className="text-xs p-2"
          style={{
            background: 'color-mix(in srgb, var(--color-accent-expense) 12%, transparent)',
            color: 'var(--color-accent-expense)',
            borderRadius: 'var(--app-radius)',
          }}
        >
          {error}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">Note (optional)</label>
        <input
          className="block-input text-sm"
          placeholder="e.g. 'Before Q2 layout change'"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button className="block-btn text-sm" onClick={onCancel}>Cancel</button>
        <button
          className="block-btn text-sm"
          onClick={handleSave}
          disabled={saving}
          style={{ background: 'var(--accent-primary)', color: 'white' }}
        >
          {saving ? 'Saving…' : 'Save Version'}
        </button>
      </div>
    </div>
  );
};

// ─── Dashboard Detail View ────────────────────────────────

const DashboardDetail: React.FC<{
  dashboardId: string;
  onBack: () => void;
}> = ({ dashboardId, onBack }) => {
  const [dashboard, setDashboard] = useState<LoadedDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [showSaveVersion, setShowSaveVersion] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.rptDashLoad(dashboardId).then((result: unknown) => {
      if (cancelled) return;
      const r = result as LoadedDashboard & { error?: string };
      if (r.error) {
        setError(r.error);
      } else {
        setDashboard(r);
      }
      setLoading(false);
    }).catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [dashboardId]);

  useEffect(() => {
    return load();
  }, [load]);

  const handleRemoveWidget = async (widgetId: string) => {
    const result = await api.rptDashRemoveWidget(widgetId);
    const r = result as { error?: string };
    if (r.error) {
      setActionMsg('Error: ' + r.error);
    } else {
      setActionMsg('Widget removed.');
      load();
    }
  };

  const handleMoveWidget = async (widgetId: string, dx: number, dy: number) => {
    const widget = dashboard?.widgets.find((w) => w.id === widgetId);
    if (!widget) return;
    const newX = Math.max(0, widget.position_x + dx);
    const newY = Math.max(0, widget.position_y + dy);
    await api.rptDashMoveWidget(widgetId, newX, newY);
    load();
  };

  const handleRestoreVersion = async () => {
    // Restore takes a version id — we need to pick the latest. Since we don't
    // have a version list in this view, show a simple prompt for the version id.
    const versionId = window.prompt('Enter the version ID to restore (from a saved version snapshot):');
    if (!versionId) return;
    const result = await api.rptDashRestoreVersion(versionId);
    const r = result as { error?: string; restored?: boolean; widget_count?: number };
    if (r.error) {
      setActionMsg('Error: ' + r.error);
    } else {
      setActionMsg(`Restored — ${r.widget_count ?? 0} widgets reloaded.`);
      load();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw size={20} className="text-text-muted animate-spin" />
        <span className="ml-2 text-sm text-text-muted">Loading dashboard…</span>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="block-card p-6 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
        <p className="text-sm" style={{ color: 'var(--color-accent-expense)' }}>
          {error || 'Dashboard not found'}
        </p>
        <button className="block-btn mt-3 text-sm" onClick={onBack}>Back to list</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* sub-header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button className="block-btn text-sm flex items-center gap-1" onClick={onBack}>
          <ChevronLeft size={14} />
          All Dashboards
        </button>
        <h2 className="text-base font-bold text-text-primary flex-1 truncate">{dashboard.name}</h2>
        <div className="flex gap-2 flex-wrap">
          <button
            className="block-btn text-sm flex items-center gap-1"
            onClick={() => { setShowAddWidget((v) => !v); setShowSaveVersion(false); }}
          >
            <Plus size={14} />
            Add Widget
          </button>
          <button
            className="block-btn text-sm flex items-center gap-1"
            onClick={() => { setShowSaveVersion((v) => !v); setShowAddWidget(false); }}
          >
            <Save size={14} />
            Save Version
          </button>
          <button
            className="block-btn text-sm flex items-center gap-1"
            onClick={handleRestoreVersion}
            title="Restore a previous version by ID"
          >
            <RotateCcw size={14} />
            Restore Version
          </button>
        </div>
      </div>

      {/* action message */}
      {actionMsg && (
        <div
          className="text-xs p-2 flex items-center justify-between"
          style={{
            background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
            color: 'var(--accent-primary)',
            borderRadius: 'var(--app-radius)',
          }}
        >
          <span>{actionMsg}</span>
          <button onClick={() => setActionMsg(null)}><X size={12} /></button>
        </div>
      )}

      {/* inline forms */}
      {showAddWidget && (
        <AddWidgetForm
          dashboardId={dashboardId}
          onAdded={() => { setShowAddWidget(false); setActionMsg('Widget added.'); load(); }}
          onCancel={() => setShowAddWidget(false)}
        />
      )}
      {showSaveVersion && (
        <SaveVersionForm
          dashboardId={dashboardId}
          onSaved={() => { setShowSaveVersion(false); setActionMsg('Version snapshot saved.'); }}
          onCancel={() => setShowSaveVersion(false)}
        />
      )}

      {/* widget grid */}
      {dashboard.widgets.length === 0 ? (
        <div
          className="block-card p-10 text-center flex flex-col items-center gap-2"
          style={{ borderRadius: 'var(--app-radius)' }}
        >
          <BarChart3 size={32} className="text-text-muted" />
          <p className="text-sm text-text-muted">No widgets yet.</p>
          <button
            className="block-btn text-sm flex items-center gap-1 mt-1"
            onClick={() => setShowAddWidget(true)}
          >
            <Plus size={14} />
            Add your first widget
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '12px',
          }}
        >
          {dashboard.widgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              onRemove={handleRemoveWidget}
              onMove={handleMoveWidget}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── New Dashboard Form ───────────────────────────────────

const NewDashboardForm: React.FC<{
  onCreated: (id: string) => void;
  onCancel: () => void;
}> = ({ onCreated, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'team' | 'company'>('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.rptDashCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
        layout: 'grid',
        columns: 12,
      });
      const r = result as { id?: string; error?: string };
      if (r.error) {
        setError(r.error);
      } else if (r.id) {
        onCreated(r.id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create dashboard');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="block-card p-5 flex flex-col gap-3" style={{ borderRadius: 'var(--app-radius)' }}>
      <span className="text-sm font-semibold text-text-primary">New Dashboard</span>

      {error && (
        <div
          className="text-xs p-2"
          style={{
            background: 'color-mix(in srgb, var(--color-accent-expense) 12%, transparent)',
            color: 'var(--color-accent-expense)',
            borderRadius: 'var(--app-radius)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">Name *</label>
        <input
          className="block-input text-sm"
          placeholder="e.g. Q2 Executive Overview"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">Description</label>
        <input
          className="block-input text-sm"
          placeholder="Optional description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">Visibility</label>
        <select
          className="block-input text-sm"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'private' | 'team' | 'company')}
        >
          <option value="private">Private</option>
          <option value="team">Team</option>
          <option value="company">Company-wide</option>
        </select>
      </div>

      <div className="flex gap-2 justify-end">
        <button className="block-btn text-sm" onClick={onCancel}>Cancel</button>
        <button
          className="block-btn text-sm"
          onClick={handleCreate}
          disabled={saving}
          style={{ background: 'var(--accent-primary)', color: 'white' }}
        >
          {saving ? 'Creating…' : 'Create Dashboard'}
        </button>
      </div>
    </div>
  );
};

// ─── Dashboard List ───────────────────────────────────────

const DashboardList: React.FC<{
  onSelect: (id: string) => void;
}> = ({ onSelect }) => {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.rptDashList().then((result: unknown) => {
      if (cancelled) return;
      if (Array.isArray(result)) {
        setDashboards(result as Dashboard[]);
      } else {
        const r = result as { error?: string };
        setError(r.error ?? 'Unknown error');
      }
      setLoading(false);
    }).catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : 'Failed to load dashboards');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return load();
  }, [load]);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete dashboard "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    const result = await api.rptDashDelete(id);
    const r = result as { error?: string };
    if (r.error) {
      alert('Delete failed: ' + r.error);
    } else {
      load();
    }
    setDeleting(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-muted">
          {dashboards.length} dashboard{dashboards.length !== 1 ? 's' : ''}
        </span>
        <button
          className="block-btn text-sm flex items-center gap-1"
          onClick={() => setShowNew((v) => !v)}
          style={{ background: showNew ? 'var(--accent-primary)' : undefined, color: showNew ? 'white' : undefined }}
        >
          <Plus size={14} />
          New Dashboard
        </button>
      </div>

      {showNew && (
        <NewDashboardForm
          onCreated={(id) => { setShowNew(false); onSelect(id); }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-muted py-4">
          <RefreshCw size={16} className="animate-spin" />
          Loading dashboards…
        </div>
      )}

      {!loading && error && (
        <div
          className="text-sm p-3"
          style={{
            background: 'color-mix(in srgb, var(--color-accent-expense) 10%, transparent)',
            color: 'var(--color-accent-expense)',
            borderRadius: 'var(--app-radius)',
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && dashboards.length === 0 && !showNew && (
        <div
          className="block-card p-10 text-center flex flex-col items-center gap-3"
          style={{ borderRadius: 'var(--app-radius)' }}
        >
          <LayoutGrid size={36} className="text-text-muted" />
          <p className="text-sm text-text-muted">No dashboards yet.</p>
          <button
            className="block-btn text-sm flex items-center gap-1"
            onClick={() => setShowNew(true)}
          >
            <Plus size={14} />
            Create your first dashboard
          </button>
        </div>
      )}

      {!loading && !error && dashboards.length > 0 && (
        <div className="block-card overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
          <table className="block-table w-full">
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold text-text-muted px-4 py-2">Name</th>
                <th className="text-left text-xs font-semibold text-text-muted px-4 py-2">Visibility</th>
                <th className="text-left text-xs font-semibold text-text-muted px-4 py-2">Created</th>
                <th className="text-right text-xs font-semibold text-text-muted px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dashboards.map((d) => (
                <tr
                  key={d.id}
                  className="hover:bg-bg-hover cursor-pointer"
                  onClick={() => onSelect(d.id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-text-primary">
                        {d.name}
                        {d.is_default === 1 && (
                          <span
                            className="ml-2 text-xs px-1.5 py-0.5 rounded"
                            style={{
                              background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)',
                              color: 'var(--accent-primary)',
                            }}
                          >
                            default
                          </span>
                        )}
                      </span>
                      {d.description && (
                        <span className="text-xs text-text-muted">{d.description}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-text-secondary capitalize">{d.visibility}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-text-muted">
                      {d.created_at ? formatDate(d.created_at) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="block-btn text-xs py-1 px-2 flex items-center gap-1 ml-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(d.id, d.name);
                      }}
                      disabled={deleting === d.id}
                      style={{ color: 'var(--color-accent-expense)' }}
                      title="Delete dashboard"
                    >
                      <Trash2 size={12} />
                      {deleting === d.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Root Module ──────────────────────────────────────────

const CustomDashboardsModule: React.FC = () => {
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* module header */}
      <div className="module-header flex items-center gap-3">
        <LayoutGrid size={20} className="text-text-muted" />
        <div>
          <h1 className="text-base font-bold text-text-primary leading-tight">Custom Dashboards</h1>
          <p className="text-xs text-text-muted">
            Build, save, and share custom KPI widget dashboards with version history.
          </p>
        </div>
      </div>

      {/* content area */}
      <div className="flex-1 p-4 overflow-auto">
        {selectedDashboardId ? (
          <DashboardDetail
            dashboardId={selectedDashboardId}
            onBack={() => setSelectedDashboardId(null)}
          />
        ) : (
          <DashboardList onSelect={setSelectedDashboardId} />
        )}
      </div>
    </div>
  );
};

export default CustomDashboardsModule;
