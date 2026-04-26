import React, { useState } from 'react';
import {
  Palette, Layout, ListOrdered, Bell, Calendar, Hash, RotateCcw,
  Download, Upload, GripVertical, Eye, EyeOff, Star, Pin, Plus, Trash2, X,
} from 'lucide-react';
import {
  usePersonalizationStore, ACCENT_PRESETS, WIDGET_CATALOG, QUICK_ACTION_CATALOG,
  DEFAULT_SIDEBAR_ORDER, type AccentSlots,
} from '../../stores/personalizationStore';
import { useAuthStore } from '../../stores/authStore';

// Module catalog for sidebar customization (mirrors Sidebar.tsx)
const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', accounts: 'Accounts & GL', invoicing: 'Invoicing',
  expenses: 'Expenses', clients: 'Clients', quotes: 'Quotes',
  payroll: 'Employee', 'time-tracking': 'Time Tracking', projects: 'Projects',
  inventory: 'Inventory', 'fixed-assets': 'Fixed Assets',
  taxes: 'Taxes', budgets: 'Budgets', 'bank-recon': 'Bank Recon',
  'stripe-sync': 'Stripe Sync', bills: 'Bills (AP)', 'purchase-orders': 'Purchase Orders',
  'debt-collection': 'Debt Collection', reports: 'Reports', 'kpi-dashboard': 'KPI Dashboard',
  forecasting: 'Forecasting', 'report-builder': 'Report Builder',
  documents: 'Documents', recurring: 'Recurring', email: 'Email',
  notifications: 'Notifications', 'audit-trail': 'Audit Trail', rules: 'Rules',
  automations: 'Automations', companies: 'Companies', 'api-integrations': 'API & Integrations',
  'client-portal': 'Client Portal', mobile: 'Mobile', settings: 'Settings',
};

const Section: React.FC<{ title: string; description?: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  title, description, icon, children,
}) => (
  <div className="block-card space-y-4">
    <div className="flex items-center gap-3">
      <div
        className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0"
        style={{ borderRadius: 'var(--app-radius, 6px)' }}
      >
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
    </div>
    <div className="border-t border-border-primary pt-4">{children}</div>
  </div>
);

const ColorSwatch: React.FC<{ value: string; selected: boolean; onClick: () => void; title?: string }> = ({
  value, selected, onClick, title,
}) => (
  <button
    onClick={onClick}
    title={title}
    className="w-7 h-7 transition-transform hover:scale-110"
    style={{
      background: value,
      borderRadius: 'var(--app-radius, 4px)',
      border: selected ? '2px solid #fff' : '2px solid rgba(255,255,255,0.1)',
      boxShadow: selected ? `0 0 0 2px ${value}` : 'none',
    }}
  />
);

// Pure CSS+JS DnD list. No new deps.
function DndList<T extends { id: string }>(props: {
  items: T[];
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  const onDragStart = (id: string) => (e: React.DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || dragId === id) return;
    const ids = props.items.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    props.onReorder(ids);
  };

  return (
    <div className="space-y-1">
      {props.items.map((item, i) => (
        <div
          key={item.id}
          draggable
          onDragStart={onDragStart(item.id)}
          onDragOver={onDragOver(item.id)}
          onDragEnd={() => setDragId(null)}
          className="flex items-center gap-2 px-2 py-1.5 bg-bg-tertiary border border-border-primary cursor-move hover:bg-bg-hover"
          style={{
            borderRadius: 'var(--app-radius, 4px)',
            opacity: dragId === item.id ? 0.5 : 1,
          }}
        >
          <GripVertical size={12} className="text-text-muted shrink-0" />
          {props.renderItem(item, i)}
        </div>
      ))}
    </div>
  );
}

const PersonalizationSettings: React.FC = () => {
  const state = usePersonalizationStore();
  const authUser = useAuthStore((s) => s.user);
  const [importJson, setImportJson] = useState('');
  const [importErr, setImportErr] = useState('');

  const handleSaveCloud = async () => {
    if (authUser?.id) await state.saveToCloud(authUser.id);
  };

  const activeTab = state.dashboardTabs.find((t) => t.id === state.activeTabId) ?? state.dashboardTabs[0];

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: 'var(--app-radius, 6px)' }}
          >
            <Palette size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Personalization</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Customize theme, dashboard, sidebar, and notifications for your account
            </p>
          </div>
        </div>
        <div className="module-actions">
          <button className="block-btn flex items-center gap-1.5 text-xs" onClick={handleSaveCloud}>
            <Download size={13} /> Sync to Cloud
          </button>
        </div>
      </div>

      {/* ─── Theme ─────────────────────────────────────── */}
      <Section
        title="Theme"
        description="Colors, light/dark mode, and visual density"
        icon={<Palette size={16} className="text-accent-blue" />}
      >
        {/* Mode (#9) */}
        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1.5">Appearance Mode</label>
          <div className="flex gap-2">
            {(['dark', 'light', 'auto'] as const).map((m) => (
              <button
                key={m}
                onClick={() => state.set({ themeMode: m })}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  state.themeMode === m ? 'bg-accent-blue text-white' : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
                style={{ borderRadius: 'var(--app-radius, 6px)' }}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Accent slots (#1, #2) */}
        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1.5">Accent Colors</label>
          <p className="text-[11px] text-text-muted mb-3">Pick from presets or enter a custom hex.</p>
          {(['primary', 'income', 'expense', 'warning', 'blue', 'purple'] as (keyof AccentSlots)[]).map((slot) => (
            <div key={slot} className="flex items-center gap-3 mb-2">
              <span className="text-xs text-text-secondary w-20 capitalize">{slot}</span>
              <div className="flex gap-1.5 flex-wrap">
                {ACCENT_PRESETS.map((p) => (
                  <ColorSwatch
                    key={p.value}
                    value={p.value}
                    selected={state.accents[slot] === p.value}
                    onClick={() => state.setAccent(slot, p.value)}
                    title={p.name}
                  />
                ))}
                <input
                  type="text"
                  className="block-input text-xs font-mono"
                  style={{ width: 90 }}
                  value={state.accents[slot]}
                  onChange={(e) => state.setAccent(slot, e.target.value)}
                  placeholder="#000000"
                  maxLength={7}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Density (#3) */}
        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1.5">Density</label>
          <div className="flex gap-2">
            {(['compact', 'cozy', 'comfortable'] as const).map((d) => (
              <button
                key={d}
                onClick={() => state.set({ density: d })}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  state.density === d ? 'bg-accent-blue text-white' : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
                style={{ borderRadius: 'var(--app-radius, 6px)' }}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Font scale (#4) + Family (#5) */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Font Scale</label>
            <select
              className="block-select"
              value={state.fontScale}
              onChange={(e) => state.set({ fontScale: e.target.value as any })}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Font Family</label>
            <select
              className="block-select"
              value={state.fontFamily}
              onChange={(e) => state.set({ fontFamily: e.target.value as any })}
            >
              <option value="inter">Inter</option>
              <option value="sf-pro">SF Pro Display</option>
              <option value="helvetica">Helvetica Neue</option>
              <option value="georgia">Georgia (serif)</option>
            </select>
          </div>
        </div>

        {/* Radius (#6) + Glass (#7) */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Border Radius</label>
            <div className="flex gap-2">
              {(['0px', '2px', '4px', '6px'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => state.set({ radius: r })}
                  className={`px-3 py-1.5 text-xs font-mono ${
                    state.radius === r ? 'bg-accent-blue text-white' : 'bg-bg-tertiary text-text-muted'
                  }`}
                  style={{ borderRadius: r }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              Glass Intensity ({Math.round(state.glassIntensity * 100)}%)
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={state.glassIntensity}
              onChange={(e) => state.set({ glassIntensity: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
        </div>

        {/* Per-module accents (#8) */}
        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-1.5">Per-Module Accent Override</label>
          <p className="text-[11px] text-text-muted mb-2">
            Override the primary accent when a specific module is active.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(MODULE_LABELS).slice(0, 6).map(([mid, label]) => (
              <div key={mid} className="flex items-center gap-2">
                <span className="text-xs text-text-secondary w-28 truncate">{label}</span>
                <input
                  type="text"
                  className="block-input text-xs font-mono"
                  style={{ width: 90 }}
                  placeholder="(default)"
                  value={state.moduleAccents[mid] ?? ''}
                  onChange={(e) =>
                    state.set({
                      moduleAccents: { ...state.moduleAccents, [mid]: e.target.value },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* Reset / Export / Import (#10) */}
        <div className="flex flex-wrap gap-2 pt-3 border-t border-border-primary">
          <button className="block-btn flex items-center gap-1.5 text-xs" onClick={state.resetTheme}>
            <RotateCcw size={13} /> Reset Theme
          </button>
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={() => {
              const json = state.exportTheme();
              navigator.clipboard?.writeText(json).catch(() => {});
              alert('Theme JSON copied to clipboard.');
            }}
          >
            <Download size={13} /> Export
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <input
              type="text"
              className="block-input text-xs font-mono flex-1"
              placeholder='Paste theme JSON here'
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
            />
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={() => {
                const ok = state.importTheme(importJson);
                setImportErr(ok ? '' : 'Invalid theme JSON');
                if (ok) setImportJson('');
              }}
            >
              <Upload size={13} /> Import
            </button>
          </div>
          {importErr && <span className="text-xs text-accent-expense">{importErr}</span>}
        </div>
      </Section>

      {/* ─── Dashboard Layout ──────────────────────────── */}
      <Section
        title="Dashboard Layout"
        description="Choose, reorder, and configure the widgets shown on each dashboard tab"
        icon={<Layout size={16} className="text-accent-blue" />}
      >
        {/* Tabs (#16) */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {state.dashboardTabs.map((t) => (
            <div key={t.id} className="flex items-center gap-1">
              <button
                onClick={() => state.setActiveTab(t.id)}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  state.activeTabId === t.id ? 'bg-accent-blue text-white' : 'bg-bg-tertiary text-text-muted'
                }`}
                style={{ borderRadius: 'var(--app-radius, 6px)' }}
              >
                {t.name}
              </button>
              {state.dashboardTabs.length > 1 && (
                <button
                  onClick={() => state.removeTab(t.id)}
                  className="p-1 text-text-muted hover:text-accent-expense"
                  title="Remove tab"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => {
              const name = prompt('Tab name (e.g., Sales, Operations, Cash)?');
              if (name) state.addTab(name);
            }}
            className="block-btn flex items-center gap-1 text-xs"
          >
            <Plus size={12} /> Add Tab
          </button>
          <button className="block-btn flex items-center gap-1 text-xs ml-auto" onClick={state.resetDashboard}>
            <RotateCcw size={12} /> Reset Layout
          </button>
        </div>

        {/* Widget catalog (#11) + Widget list (#12,#13,#14,#15,#18,#19) */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Widgets in this Tab</p>
            <DndList
              items={activeTab.widgets}
              onReorder={(ids) => state.reorderWidgets(activeTab.id, ids)}
              renderItem={(w) => {
                const meta = WIDGET_CATALOG.find((c) => c.id === w.id);
                return (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-text-primary font-medium truncate">{meta?.name ?? w.id}</span>
                      <div className="flex items-center gap-1">
                        <button
                          className="p-1 text-text-muted hover:text-text-primary"
                          title={w.visible ? 'Hide' : 'Show'}
                          onClick={() =>
                            state.upsertWidget(activeTab.id, { ...w, visible: !w.visible })
                          }
                        >
                          {w.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
                        <button
                          className="p-1 text-text-muted hover:text-accent-expense"
                          title="Remove"
                          onClick={() => state.removeWidget(activeTab.id, w.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <select
                        className="text-[10px] bg-bg-secondary border border-border-primary px-1 py-0.5"
                        style={{ borderRadius: 'var(--app-radius, 3px)' }}
                        value={w.size}
                        onChange={(e) =>
                          state.upsertWidget(activeTab.id, { ...w, size: e.target.value as any })
                        }
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                      <select
                        className="text-[10px] bg-bg-secondary border border-border-primary px-1 py-0.5"
                        style={{ borderRadius: 'var(--app-radius, 3px)' }}
                        value={w.period}
                        onChange={(e) =>
                          state.upsertWidget(activeTab.id, { ...w, period: e.target.value as any })
                        }
                      >
                        <option value="week">Week</option>
                        <option value="month">Month</option>
                        <option value="quarter">Quarter</option>
                        <option value="custom">Custom</option>
                      </select>
                      <input
                        type="number"
                        min={0}
                        max={120}
                        className="text-[10px] bg-bg-secondary border border-border-primary px-1 py-0.5 w-12"
                        style={{ borderRadius: 'var(--app-radius, 3px)' }}
                        value={w.refreshMin}
                        title="Refresh interval (min, 0 = off)"
                        onChange={(e) =>
                          state.upsertWidget(activeTab.id, {
                            ...w,
                            refreshMin: parseInt(e.target.value, 10) || 0,
                          })
                        }
                      />
                      <label className="flex items-center gap-1 text-[10px] text-text-muted">
                        <input
                          type="checkbox"
                          checked={w.mini}
                          onChange={(e) =>
                            state.upsertWidget(activeTab.id, { ...w, mini: e.target.checked })
                          }
                        />
                        Mini
                      </label>
                    </div>
                  </div>
                );
              }}
            />
          </div>

          <div>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Available Widgets</p>
            <div className="space-y-1">
              {WIDGET_CATALOG.filter((c) => !activeTab.widgets.some((w) => w.id === c.id)).map((c) => (
                <button
                  key={c.id}
                  onClick={() => state.addWidget(activeTab.id, c.id)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-bg-tertiary border border-border-primary hover:bg-bg-hover text-left"
                  style={{ borderRadius: 'var(--app-radius, 4px)' }}
                >
                  <div>
                    <div className="text-xs text-text-primary font-medium">{c.name}</div>
                    <div className="text-[10px] text-text-muted">{c.description}</div>
                  </div>
                  <Plus size={13} className="text-accent-blue" />
                </button>
              ))}
              {WIDGET_CATALOG.every((c) => activeTab.widgets.some((w) => w.id === c.id)) && (
                <p className="text-xs text-text-muted">All widgets in use.</p>
              )}
            </div>
          </div>
        </div>

        {/* Role defaults (#17) */}
        <div className="mt-4 pt-3 border-t border-border-primary">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            Default Layout per Role (Admin)
          </p>
          <div className="flex gap-2 flex-wrap">
            {(['Owner', 'Manager', 'Accountant', 'Viewer'] as const).map((role) => (
              <button
                key={role}
                onClick={() =>
                  state.set({
                    roleDefaults: { ...state.roleDefaults, [role]: activeTab.widgets },
                  })
                }
                className="block-btn text-xs"
              >
                Save Current as {role} Default
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ─── Sidebar & TopBar ──────────────────────────── */}
      <Section
        title="Sidebar &amp; Top Bar"
        description="Reorder modules, hide unused ones, pin favorites, and pick quick actions"
        icon={<ListOrdered size={16} className="text-accent-blue" />}
      >
        <div className="grid grid-cols-2 gap-4">
          {/* Sidebar order (#21,#22,#23,#25) */}
          <div>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Sidebar Modules</p>
            <DndList
              items={state.sidebarOrder.map((id) => ({ id }))}
              onReorder={(ids) => state.reorderSidebar(ids)}
              renderItem={({ id }) => (
                <div className="flex-1 flex items-center justify-between gap-2 min-w-0">
                  <span className="text-xs text-text-primary truncate">{MODULE_LABELS[id] ?? id}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => state.toggleFavorite(id)}
                      className={`p-1 ${state.favoriteModules.includes(id) ? 'text-accent-warning' : 'text-text-muted'}`}
                      title="Favorite"
                    >
                      <Star size={11} />
                    </button>
                    <button
                      onClick={() => state.togglePinned(id)}
                      className={`p-1 ${state.pinnedModules.includes(id) ? 'text-accent-blue' : 'text-text-muted'}`}
                      title="Pin"
                    >
                      <Pin size={11} />
                    </button>
                    <button
                      onClick={() => state.toggleHidden(id)}
                      className={`p-1 ${state.hiddenModules.includes(id) ? 'text-accent-expense' : 'text-text-muted'}`}
                      title={state.hiddenModules.includes(id) ? 'Hidden — show' : 'Hide'}
                    >
                      {state.hiddenModules.includes(id) ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  </div>
                </div>
              )}
            />
            <button
              className="block-btn text-xs mt-2 flex items-center gap-1.5"
              onClick={() => state.reorderSidebar([...DEFAULT_SIDEBAR_ORDER])}
            >
              <RotateCcw size={11} /> Reset Order
            </button>
          </div>

          {/* TopBar quick actions (#24) */}
          <div>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Top Bar Quick Actions (max 5)
            </p>
            <div className="space-y-1">
              {QUICK_ACTION_CATALOG.map((qa) => {
                const checked = state.quickActions.includes(qa.id);
                return (
                  <label
                    key={qa.id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-bg-tertiary border border-border-primary cursor-pointer hover:bg-bg-hover"
                    style={{ borderRadius: 'var(--app-radius, 4px)' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (state.quickActions.length >= 5) return;
                          state.set({ quickActions: [...state.quickActions, qa.id] });
                        } else {
                          state.set({ quickActions: state.quickActions.filter((q) => q !== qa.id) });
                        }
                      }}
                    />
                    <span className="text-xs text-text-primary">{qa.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      {/* ─── Notifications (#27) ───────────────────────── */}
      <Section
        title="Notification Preferences"
        description="Choose how you want to be notified for each event type"
        icon={<Bell size={16} className="text-accent-blue" />}
      >
        <div className="space-y-2">
          {Object.entries(state.notificationPrefs).map(([type, pref]) => (
            <div key={type} className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-primary capitalize">{type.replace(/_/g, ' ')}</span>
              <select
                className="block-select text-xs"
                style={{ width: 140 }}
                value={pref.channel}
                onChange={(e) =>
                  state.set({
                    notificationPrefs: {
                      ...state.notificationPrefs,
                      [type]: { channel: e.target.value as any },
                    },
                  })
                }
              >
                <option value="inapp">In-app</option>
                <option value="email">Email</option>
                <option value="off">Off</option>
              </select>
            </div>
          ))}
        </div>
      </Section>

      {/* ─── Date / Number formats (#28, #29) ──────────── */}
      <Section
        title="Date &amp; Number Format"
        description="How dates, numbers, and currency display in the app"
        icon={<Calendar size={16} className="text-accent-blue" />}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Date Format</label>
            <select
              className="block-select"
              value={state.dateFormat}
              onChange={(e) => state.set({ dateFormat: e.target.value as any })}
            >
              <option value="us">MM/DD/YYYY (US)</option>
              <option value="intl">DD/MM/YYYY (Intl)</option>
              <option value="iso">YYYY-MM-DD (ISO)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Currency Position</label>
            <select
              className="block-select"
              value={state.currencyPos}
              onChange={(e) => state.set({ currencyPos: e.target.value as any })}
            >
              <option value="before">$ before (US)</option>
              <option value="after">€ after (intl)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Thousands Separator</label>
            <select
              className="block-select"
              value={state.thousandsSep}
              onChange={(e) => state.set({ thousandsSep: e.target.value as any })}
            >
              <option value=",">Comma (1,000)</option>
              <option value=".">Period (1.000)</option>
              <option value=" ">Space (1 000)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Decimal Separator</label>
            <select
              className="block-select"
              value={state.decimalSep}
              onChange={(e) => state.set({ decimalSep: e.target.value as any })}
            >
              <option value=".">Period (1.50)</option>
              <option value=",">Comma (1,50)</option>
            </select>
          </div>
        </div>
      </Section>

      {/* ─── Keyboard shortcuts (#26) ──────────────────── */}
      <Section
        title="Keyboard Shortcuts"
        description="Override default shortcuts (admin defaults shown in placeholder)"
        icon={<Hash size={16} className="text-accent-blue" />}
      >
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'newItem', label: 'New Item', def: 'Cmd+N' },
            { key: 'focusSearch', label: 'Search', def: 'Cmd+K' },
            { key: 'exportView', label: 'Export', def: 'Cmd+Shift+E' },
            { key: 'openSettings', label: 'Open Settings', def: 'Cmd+,' },
            { key: 'quickCreate', label: 'Quick Create', def: 'Cmd+Shift+K' },
          ].map(({ key, label, def }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-text-secondary w-32">{label}</span>
              <input
                type="text"
                className="block-input text-xs font-mono"
                placeholder={def}
                value={state.shortcutOverrides[key] ?? ''}
                onChange={(e) =>
                  state.set({
                    shortcutOverrides: {
                      ...state.shortcutOverrides,
                      [key]: e.target.value,
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};

export default PersonalizationSettings;
