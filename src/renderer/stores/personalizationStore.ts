import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../lib/api';

// Per-user UI preferences (theme, density, dashboard layout, sidebar order,
// quick actions, notifications, formatting). Persisted in two layers:
//   1. localStorage (instant load on app boot, no flash)
//   2. settings table key personalization:<user_id> (cross-device, when
//      user re-logs in on another machine)

export type Density = 'compact' | 'cozy' | 'comfortable';
export type FontScale = 'small' | 'medium' | 'large';
export type FontFamily = 'inter' | 'sf-pro' | 'helvetica' | 'georgia';
export type Radius = '0px' | '2px' | '4px' | '6px';
export type ThemeMode = 'dark' | 'light' | 'auto';
export type DateFormat = 'us' | 'intl' | 'iso';
export type ThousandsSep = ',' | '.' | ' ';
export type CurrencyPos = 'before' | 'after';

export interface AccentSlots {
  primary: string;
  income: string;
  expense: string;
  warning: string;
  blue: string;
  purple: string;
}

export interface DashboardWidget {
  id: string;
  visible: boolean;
  size: 'small' | 'medium' | 'large';
  mini: boolean;
  refreshMin: number;
  period: 'week' | 'month' | 'quarter' | 'custom';
}

export interface DashboardTab {
  id: string;
  name: string;
  widgets: DashboardWidget[];
}

export interface NotificationPref {
  channel: 'inapp' | 'email' | 'off';
}

export const DEFAULT_ACCENTS: AccentSlots = {
  primary: '#60a5fa',
  income: '#34d399',
  expense: '#f87171',
  warning: '#fbbf24',
  blue: '#60a5fa',
  purple: '#c084fc',
};

export const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: 'Sky', value: '#60a5fa' },
  { name: 'Emerald', value: '#34d399' },
  { name: 'Amber', value: '#fbbf24' },
  { name: 'Rose', value: '#fb7185' },
  { name: 'Violet', value: '#a78bfa' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Lime', value: '#a3e635' },
  { name: 'Pink', value: '#f472b6' },
  { name: 'Orange', value: '#fb923c' },
  { name: 'Teal', value: '#2dd4bf' },
  { name: 'Indigo', value: '#818cf8' },
  { name: 'Slate', value: '#94a3b8' },
];

export const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'kpis', visible: true, size: 'large', mini: false, refreshMin: 0, period: 'month' },
  { id: 'quick-metrics', visible: true, size: 'large', mini: false, refreshMin: 0, period: 'month' },
  { id: 'cross-module', visible: true, size: 'large', mini: false, refreshMin: 0, period: 'month' },
  { id: 'revenue-trend', visible: true, size: 'large', mini: false, refreshMin: 0, period: 'month' },
  { id: 'income-pie', visible: true, size: 'medium', mini: false, refreshMin: 0, period: 'month' },
  { id: 'cash-forecast', visible: true, size: 'medium', mini: false, refreshMin: 0, period: 'month' },
  { id: 'expense-treemap', visible: true, size: 'large', mini: false, refreshMin: 0, period: 'month' },
  { id: 'quick-actions', visible: true, size: 'large', mini: false, refreshMin: 0, period: 'month' },
  { id: 'activity', visible: true, size: 'medium', mini: false, refreshMin: 5, period: 'month' },
  { id: 'upcoming-due', visible: true, size: 'medium', mini: false, refreshMin: 0, period: 'month' },
  { id: 'top-clients', visible: true, size: 'medium', mini: false, refreshMin: 0, period: 'quarter' },
];

export const WIDGET_CATALOG: { id: string; name: string; description: string }[] = [
  { id: 'kpis', name: 'KPI Stat Cards', description: 'Revenue, Expenses, Net, Outstanding' },
  { id: 'quick-metrics', name: 'Quick Metrics', description: 'Invoices sent, avg DTP, growth, top client' },
  { id: 'cross-module', name: 'Cross-Module Summary', description: 'Debt, Bills/AP, Payroll' },
  { id: 'revenue-trend', name: 'Revenue Trend', description: 'Trailing 12-month revenue vs expenses' },
  { id: 'income-pie', name: 'Income Sources', description: 'Pie chart by client' },
  { id: 'cash-forecast', name: 'Cash Flow Forecast', description: '3-month projection' },
  { id: 'expense-treemap', name: 'Expense Breakdown', description: 'Treemap by category' },
  { id: 'quick-actions', name: 'Quick Actions', description: 'New Invoice, Expense, etc.' },
  { id: 'activity', name: 'Activity Feed', description: 'Recent audit log entries' },
  { id: 'upcoming-due', name: 'Upcoming Due', description: 'Invoices due in 7 days' },
  { id: 'top-clients', name: 'Top Clients', description: 'Top 5 clients by revenue (90d)' },
];

export const DEFAULT_SIDEBAR_ORDER: string[] = [
  'dashboard', 'accounts', 'invoicing', 'expenses', 'clients', 'quotes',
  'payroll', 'time-tracking', 'projects', 'inventory', 'fixed-assets',
  'taxes', 'budgets', 'bank-recon', 'stripe-sync', 'bills', 'purchase-orders', 'debt-collection',
  'reports', 'kpi-dashboard', 'forecasting', 'report-builder',
  'documents', 'recurring', 'email', 'notifications', 'audit-trail', 'rules', 'automations',
  'companies', 'api-integrations', 'client-portal', 'mobile', 'settings',
];

export const DEFAULT_QUICK_ACTIONS: string[] = ['new-invoice', 'new-expense', 'search'];

export const QUICK_ACTION_CATALOG: { id: string; label: string; icon: string }[] = [
  { id: 'new-invoice', label: 'New Invoice', icon: 'FileText' },
  { id: 'new-expense', label: 'New Expense', icon: 'Receipt' },
  { id: 'new-client', label: 'New Client', icon: 'UserCircle' },
  { id: 'new-quote', label: 'New Quote', icon: 'FileCheck' },
  { id: 'start-timer', label: 'Start Timer', icon: 'Clock' },
  { id: 'search', label: 'Search', icon: 'Search' },
  { id: 'reports', label: 'Reports', icon: 'BarChart3' },
];

export interface PersonalizationState {
  themeMode: ThemeMode;
  accents: AccentSlots;
  density: Density;
  fontScale: FontScale;
  fontFamily: FontFamily;
  radius: Radius;
  glassIntensity: number;
  moduleAccents: Record<string, string>;
  dashboardTabs: DashboardTab[];
  activeTabId: string;
  roleDefaults: Record<string, DashboardWidget[]>;
  sidebarOrder: string[];
  hiddenModules: string[];
  pinnedModules: string[];
  favoriteModules: string[];
  quickActions: string[];
  shortcutOverrides: Record<string, string>;
  notificationPrefs: Record<string, NotificationPref>;
  dateFormat: DateFormat;
  thousandsSep: ThousandsSep;
  decimalSep: '.' | ',';
  currencyPos: CurrencyPos;
  onboardingComplete: boolean;

  set: (patch: Partial<PersonalizationState>) => void;
  setAccent: (slot: keyof AccentSlots, value: string) => void;
  resetTheme: () => void;
  resetDashboard: () => void;
  reorderSidebar: (order: string[]) => void;
  toggleHidden: (moduleId: string) => void;
  togglePinned: (moduleId: string) => void;
  toggleFavorite: (moduleId: string) => void;
  upsertWidget: (tabId: string, widget: DashboardWidget) => void;
  reorderWidgets: (tabId: string, ids: string[]) => void;
  removeWidget: (tabId: string, widgetId: string) => void;
  addWidget: (tabId: string, widgetId: string) => void;
  addTab: (name: string) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  exportTheme: () => string;
  importTheme: (json: string) => boolean;
  saveToCloud: (userId: string) => Promise<void>;
  loadFromCloud: (userId: string) => Promise<void>;
}

const DEFAULT_TAB: DashboardTab = {
  id: 'default',
  name: 'Overview',
  widgets: DEFAULT_WIDGETS,
};

export const usePersonalizationStore = create<PersonalizationState>()(
  persist(
    (set, get) => ({
      themeMode: 'dark',
      accents: { ...DEFAULT_ACCENTS },
      density: 'cozy',
      fontScale: 'medium',
      fontFamily: 'inter',
      radius: '2px',
      glassIntensity: 0.65,
      moduleAccents: {},
      dashboardTabs: [DEFAULT_TAB],
      activeTabId: 'default',
      roleDefaults: {},
      sidebarOrder: [...DEFAULT_SIDEBAR_ORDER],
      hiddenModules: [],
      pinnedModules: [],
      favoriteModules: [],
      quickActions: [...DEFAULT_QUICK_ACTIONS],
      shortcutOverrides: {},
      notificationPrefs: {
        invoice_paid: { channel: 'inapp' },
        expense_submitted: { channel: 'inapp' },
        debt_overdue: { channel: 'inapp' },
      },
      dateFormat: 'us',
      thousandsSep: ',',
      decimalSep: '.',
      currencyPos: 'before',
      onboardingComplete: false,

      set: (patch) => set(patch),

      setAccent: (slot, value) =>
        set((s) => ({ accents: { ...s.accents, [slot]: value } })),

      resetTheme: () =>
        set({
          accents: { ...DEFAULT_ACCENTS },
          density: 'cozy',
          fontScale: 'medium',
          fontFamily: 'inter',
          radius: '2px',
          glassIntensity: 0.65,
          themeMode: 'dark',
        }),

      resetDashboard: () => {
        const role = 'Owner';
        const defaults = get().roleDefaults[role] ?? DEFAULT_WIDGETS;
        set({
          dashboardTabs: [{ id: 'default', name: 'Overview', widgets: defaults }],
          activeTabId: 'default',
        });
      },

      reorderSidebar: (order) => set({ sidebarOrder: order }),

      toggleHidden: (moduleId) =>
        set((s) => ({
          hiddenModules: s.hiddenModules.includes(moduleId)
            ? s.hiddenModules.filter((m) => m !== moduleId)
            : [...s.hiddenModules, moduleId],
        })),

      togglePinned: (moduleId) =>
        set((s) => ({
          pinnedModules: s.pinnedModules.includes(moduleId)
            ? s.pinnedModules.filter((m) => m !== moduleId)
            : [...s.pinnedModules, moduleId],
        })),

      toggleFavorite: (moduleId) =>
        set((s) => ({
          favoriteModules: s.favoriteModules.includes(moduleId)
            ? s.favoriteModules.filter((m) => m !== moduleId)
            : [...s.favoriteModules, moduleId],
        })),

      upsertWidget: (tabId, widget) =>
        set((s) => ({
          dashboardTabs: s.dashboardTabs.map((t) =>
            t.id !== tabId
              ? t
              : {
                  ...t,
                  widgets: t.widgets.some((w) => w.id === widget.id)
                    ? t.widgets.map((w) => (w.id === widget.id ? widget : w))
                    : [...t.widgets, widget],
                }
          ),
        })),

      reorderWidgets: (tabId, ids) =>
        set((s) => ({
          dashboardTabs: s.dashboardTabs.map((t) =>
            t.id !== tabId
              ? t
              : {
                  ...t,
                  widgets: ids
                    .map((id) => t.widgets.find((w) => w.id === id))
                    .filter((w): w is DashboardWidget => !!w),
                }
          ),
        })),

      removeWidget: (tabId, widgetId) =>
        set((s) => ({
          dashboardTabs: s.dashboardTabs.map((t) =>
            t.id !== tabId ? t : { ...t, widgets: t.widgets.filter((w) => w.id !== widgetId) }
          ),
        })),

      addWidget: (tabId, widgetId) =>
        set((s) => ({
          dashboardTabs: s.dashboardTabs.map((t) =>
            t.id !== tabId
              ? t
              : {
                  ...t,
                  widgets: t.widgets.some((w) => w.id === widgetId)
                    ? t.widgets
                    : [
                        ...t.widgets,
                        {
                          id: widgetId,
                          visible: true,
                          size: 'medium',
                          mini: false,
                          refreshMin: 0,
                          period: 'month',
                        },
                      ],
                }
          ),
        })),

      addTab: (name) =>
        set((s) => {
          const id = 'tab-' + Date.now();
          return {
            dashboardTabs: [
              ...s.dashboardTabs,
              { id, name, widgets: DEFAULT_WIDGETS.map((w) => ({ ...w })) },
            ],
            activeTabId: id,
          };
        }),

      removeTab: (tabId) =>
        set((s) => {
          if (s.dashboardTabs.length <= 1) return {};
          const next = s.dashboardTabs.filter((t) => t.id !== tabId);
          return {
            dashboardTabs: next,
            activeTabId: s.activeTabId === tabId ? next[0].id : s.activeTabId,
          };
        }),

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      exportTheme: () => {
        const s = get();
        return JSON.stringify(
          {
            version: 1,
            themeMode: s.themeMode,
            accents: s.accents,
            density: s.density,
            fontScale: s.fontScale,
            fontFamily: s.fontFamily,
            radius: s.radius,
            glassIntensity: s.glassIntensity,
            moduleAccents: s.moduleAccents,
          },
          null,
          2
        );
      },

      importTheme: (json) => {
        try {
          const data = JSON.parse(json);
          if (!data || typeof data !== 'object') return false;
          set({
            themeMode: data.themeMode ?? get().themeMode,
            accents: { ...DEFAULT_ACCENTS, ...(data.accents || {}) },
            density: data.density ?? get().density,
            fontScale: data.fontScale ?? get().fontScale,
            fontFamily: data.fontFamily ?? get().fontFamily,
            radius: data.radius ?? get().radius,
            glassIntensity: data.glassIntensity ?? get().glassIntensity,
            moduleAccents: data.moduleAccents ?? get().moduleAccents,
          });
          return true;
        } catch {
          return false;
        }
      },

      saveToCloud: async (userId: string) => {
        const s = get();
        const payload = {
          themeMode: s.themeMode,
          accents: s.accents,
          density: s.density,
          fontScale: s.fontScale,
          fontFamily: s.fontFamily,
          radius: s.radius,
          glassIntensity: s.glassIntensity,
          moduleAccents: s.moduleAccents,
          dashboardTabs: s.dashboardTabs,
          activeTabId: s.activeTabId,
          sidebarOrder: s.sidebarOrder,
          hiddenModules: s.hiddenModules,
          pinnedModules: s.pinnedModules,
          favoriteModules: s.favoriteModules,
          quickActions: s.quickActions,
          shortcutOverrides: s.shortcutOverrides,
          notificationPrefs: s.notificationPrefs,
          dateFormat: s.dateFormat,
          thousandsSep: s.thousandsSep,
          decimalSep: s.decimalSep,
          currencyPos: s.currencyPos,
          onboardingComplete: s.onboardingComplete,
        };
        try {
          await api.setSetting(`personalization:${userId}`, JSON.stringify(payload));
        } catch {
          // best effort
        }
      },

      loadFromCloud: async (userId: string) => {
        try {
          const raw = await api.getSetting(`personalization:${userId}`);
          if (!raw) return;
          const data = JSON.parse(raw);
          set({ ...data });
        } catch {
          // ignore
        }
      },
    }),
    { name: 'bap-personalization' }
  )
);

// Apply CSS variables to :root when prefs change.
export function applyPersonalization(state: PersonalizationState): void {
  const root = document.documentElement;
  const isDark =
    state.themeMode === 'dark' ||
    (state.themeMode === 'auto' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  root.setAttribute('data-theme', isDark ? 'dark' : 'light');

  root.style.setProperty('--accent-primary', state.accents.primary);
  root.style.setProperty('--color-accent-blue', state.accents.blue);
  root.style.setProperty('--color-accent-income', state.accents.income);
  root.style.setProperty('--color-accent-expense', state.accents.expense);
  root.style.setProperty('--color-accent-warning', state.accents.warning);
  root.style.setProperty('--color-accent-purple', state.accents.purple);
  root.style.setProperty('--color-accent-blue-bg', hexToRgba(state.accents.blue, 0.12));
  root.style.setProperty('--color-accent-income-bg', hexToRgba(state.accents.income, 0.12));
  root.style.setProperty('--color-accent-expense-bg', hexToRgba(state.accents.expense, 0.12));
  root.style.setProperty('--color-accent-warning-bg', hexToRgba(state.accents.warning, 0.12));
  root.style.setProperty('--color-accent-purple-bg', hexToRgba(state.accents.purple, 0.12));

  const densityMap: Record<Density, { y: string; x: string }> = {
    compact: { y: '0.375rem', x: '0.625rem' },
    cozy: { y: '0.5625rem', x: '0.875rem' },
    comfortable: { y: '0.75rem', x: '1.125rem' },
  };
  root.style.setProperty('--row-padding-y', densityMap[state.density].y);
  root.style.setProperty('--row-padding-x', densityMap[state.density].x);

  const fsMap: Record<FontScale, string> = {
    small: '14px',
    medium: '16px',
    large: '18px',
  };
  root.style.setProperty('font-size', fsMap[state.fontScale]);

  const ffMap: Record<FontFamily, string> = {
    inter: "'Inter', system-ui, sans-serif",
    'sf-pro': "'SF Pro Display', -apple-system, system-ui, sans-serif",
    helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    georgia: "'Georgia', 'Times New Roman', serif",
  };
  root.style.setProperty('--font-sans', ffMap[state.fontFamily]);

  root.style.setProperty('--app-radius', state.radius);

  const blurPx = Math.round(8 + state.glassIntensity * 24);
  root.style.setProperty('--glass-blur', blurPx + 'px');
  root.style.setProperty('--glass-opacity', String(0.55 + state.glassIntensity * 0.4));

  if (!isDark) {
    root.style.setProperty('--color-bg-primary-solid', '#f8fafc');
    root.style.setProperty('--color-bg-primary', '#ffffff');
    root.style.setProperty('--color-bg-secondary', 'rgba(255,255,255,0.85)');
    root.style.setProperty('--color-bg-tertiary', 'rgba(241,245,249,0.85)');
    root.style.setProperty('--color-bg-elevated', 'rgba(255,255,255,0.95)');
    root.style.setProperty('--color-bg-hover', 'rgba(0,0,0,0.04)');
    root.style.setProperty('--color-text-primary', '#0f172a');
    root.style.setProperty('--color-text-secondary', '#475569');
    root.style.setProperty('--color-text-muted', '#94a3b8');
    root.style.setProperty('--color-glass-border', 'rgba(0,0,0,0.08)');
    root.style.setProperty('--color-glass-border-hover', 'rgba(0,0,0,0.14)');
  } else {
    root.style.removeProperty('--color-bg-primary-solid');
    root.style.removeProperty('--color-bg-primary');
    root.style.removeProperty('--color-bg-secondary');
    root.style.removeProperty('--color-bg-tertiary');
    root.style.removeProperty('--color-bg-elevated');
    root.style.removeProperty('--color-bg-hover');
    root.style.removeProperty('--color-text-primary');
    root.style.removeProperty('--color-text-secondary');
    root.style.removeProperty('--color-text-muted');
    root.style.removeProperty('--color-glass-border');
    root.style.removeProperty('--color-glass-border-hover');
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyModuleAccent(moduleId: string): void {
  const state = usePersonalizationStore.getState();
  const override = state.moduleAccents[moduleId];
  const root = document.documentElement;
  if (override) {
    root.style.setProperty('--color-accent-blue', override);
  } else {
    root.style.setProperty('--color-accent-blue', state.accents.blue);
  }
}

export function formatDateUser(d: Date | string): string {
  const state = usePersonalizationStore.getState();
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return String(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  switch (state.dateFormat) {
    case 'iso':
      return `${yyyy}-${mm}-${dd}`;
    case 'intl':
      return `${dd}/${mm}/${yyyy}`;
    default:
      return `${mm}/${dd}/${yyyy}`;
  }
}

export function formatNumberUser(n: number, decimals = 2): string {
  const state = usePersonalizationStore.getState();
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, state.thousandsSep);
  return decPart != null
    ? `${sign}${withSep}${state.decimalSep}${decPart}`
    : `${sign}${withSep}`;
}
