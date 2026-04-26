import React, { useState } from 'react';
import logoUrl from '../../assets/RMPG_WHITE_NEGATIVE_TRANSPARENT_FIXED.png';
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Receipt,
  UserCircle,
  Users,
  Clock,
  FolderKanban,
  Package,
  Calculator,
  PiggyBank,
  Landmark,
  CreditCard,
  BarChart3,
  Gauge,
  TrendingUp,
  FileBarChart,
  Paperclip,
  Repeat,
  Mail,
  Bell,
  Shield,
  Zap,
  Building2,
  Plug,
  Globe,
  Smartphone,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  FileInput,
  ClipboardList,
  Boxes,
  Scale,
  FileCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { usePersonalizationStore } from '../../stores/personalizationStore';
import { Star, Pin, MoreHorizontal } from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: 'MAIN',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'accounts', label: 'Accounts & GL', icon: BookOpen },
      { id: 'invoicing', label: 'Invoicing', icon: FileText },
      { id: 'expenses', label: 'Expenses', icon: Receipt },
      { id: 'clients', label: 'Clients', icon: UserCircle },
      { id: 'quotes', label: 'Quotes', icon: FileCheck },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { id: 'payroll', label: 'Employee', icon: Users },
      { id: 'time-tracking', label: 'Time Tracking', icon: Clock },
      { id: 'projects', label: 'Projects', icon: FolderKanban },
      { id: 'inventory', label: 'Inventory', icon: Package },
      { id: 'fixed-assets', label: 'Fixed Assets', icon: Boxes },
    ],
  },
  {
    title: 'FINANCE',
    items: [
      { id: 'taxes', label: 'Taxes', icon: Calculator },
      { id: 'budgets', label: 'Budgets', icon: PiggyBank },
      { id: 'bank-recon', label: 'Bank Recon', icon: Landmark },
      { id: 'stripe-sync', label: 'Stripe Sync', icon: CreditCard },
      { id: 'bills', label: 'Bills (AP)', icon: FileInput },
      { id: 'purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
      { id: 'debt-collection', label: 'Debt Collection', icon: Scale },
    ],
  },
  {
    title: 'ANALYTICS',
    items: [
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'kpi-dashboard', label: 'KPI Dashboard', icon: Gauge },
      { id: 'forecasting', label: 'Forecasting', icon: TrendingUp },
      { id: 'report-builder', label: 'Report Builder', icon: FileBarChart },
    ],
  },
  {
    title: 'PLATFORM',
    items: [
      { id: 'documents', label: 'Documents', icon: Paperclip },
      { id: 'recurring', label: 'Recurring', icon: Repeat },
      { id: 'email', label: 'Email', icon: Mail },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'audit-trail', label: 'Audit Trail', icon: Shield },
      { id: 'rules', label: 'Rules', icon: Shield },
      { id: 'automations', label: 'Automations', icon: Zap },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { id: 'companies', label: 'Companies', icon: Building2 },
      { id: 'api-integrations', label: 'API & Integrations', icon: Plug },
      { id: 'client-portal', label: 'Client Portal', icon: Globe },
      { id: 'mobile', label: 'Mobile', icon: Smartphone },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

// Build a flat lookup from sections so we can render in user's custom order.
const ALL_ITEMS: Record<string, NavItem> = sections.reduce((acc, sec) => {
  for (const item of sec.items) acc[item.id] = item;
  return acc;
}, {} as Record<string, NavItem>);

const Sidebar: React.FC = () => {
  const currentModule = useAppStore((s) => s.currentModule);
  const setModule = useAppStore((s) => s.setModule);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const sidebarOrder = usePersonalizationStore((s) => s.sidebarOrder);
  const hiddenModules = usePersonalizationStore((s) => s.hiddenModules);
  const pinnedModules = usePersonalizationStore((s) => s.pinnedModules);
  const favoriteModules = usePersonalizationStore((s) => s.favoriteModules);
  const [showHidden, setShowHidden] = useState(false);

  // Resolve order: pinned first, then user-ordered visible, then hidden under "More"
  const visibleOrder = sidebarOrder.filter(
    (id) => ALL_ITEMS[id] && !hiddenModules.includes(id) && !pinnedModules.includes(id)
  );
  const pinned = pinnedModules.filter((id) => ALL_ITEMS[id]);
  const hidden = hiddenModules.filter((id) => ALL_ITEMS[id]);

  const renderItem = (id: string) => {
    const item = ALL_ITEMS[id];
    if (!item) return null;
    const Icon = item.icon;
    const isActive = currentModule === id;
    const isFav = favoriteModules.includes(id);
    return (
      <button
        key={id}
        onClick={() => setModule(id)}
        className={`flex items-center gap-2.5 w-full text-left transition-all duration-200 ${
          sidebarCollapsed ? 'justify-center px-0 py-2 mx-auto' : 'px-3 py-2'
        } ${
          isActive
            ? 'text-accent-blue border-r-2 border-accent-blue'
            : 'text-text-secondary hover:text-text-primary border-r-2 border-transparent'
        }`}
        style={isActive ? {
          background: 'linear-gradient(90deg, transparent, rgba(96,165,250,0.08))',
          boxShadow: 'inset -2px 0 8px rgba(96,165,250,0.06)',
          borderRadius: '0px',
        } : { borderRadius: '0px' }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = ''; }}
        title={sidebarCollapsed ? item.label : undefined}
      >
        <Icon size={16} className="shrink-0" />
        {!sidebarCollapsed && (
          <>
            <span className="text-[13px] truncate flex-1">{item.label}</span>
            {isFav && <Star size={10} className="text-accent-warning shrink-0" />}
          </>
        )}
      </button>
    );
  };

  return (
    <aside
      className={`flex flex-col h-full border-r transition-all duration-200 ${
        sidebarCollapsed ? 'w-16' : 'w-56'
      }`}
      style={{
        borderRadius: '0px',
        background: 'rgba(14, 15, 20, 0.85)',
        backdropFilter: 'blur(20px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
        borderColor: 'rgba(255,255,255,0.06)',
      }}
    >
      {/* App Header — pt-10 leaves room for macOS traffic lights on hiddenInset title bar */}
      <div
        className="flex items-center gap-2.5 px-3 pt-10 pb-2 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <img
          src={logoUrl}
          alt="RMPG"
          className="w-8 h-8 shrink-0"
          style={{ objectFit: 'contain' }}
        />
        {!sidebarCollapsed && (
          <div className="flex flex-col leading-tight overflow-hidden">
            <span className="text-[11px] font-semibold text-text-primary tracking-tight">BAP</span>
            <span className="text-[10px] text-text-muted truncate">Accounting Pro</span>
          </div>
        )}
      </div>

      {/* Navigation — user-customized order with Pinned + More overflow */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {pinned.length > 0 && (
          <div>
            {!sidebarCollapsed && (
              <div className="px-4 pt-2.5 pb-1 flex items-center gap-1">
                <Pin size={9} className="text-accent-blue" />
                <span className="text-[10px] font-semibold text-text-muted" style={{ letterSpacing: '0.04em' }}>
                  PINNED
                </span>
              </div>
            )}
            {pinned.map(renderItem)}
            {!sidebarCollapsed && (
              <div className="mx-3 my-1.5" style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />
            )}
          </div>
        )}
        {visibleOrder.map(renderItem)}
        {hidden.length > 0 && !sidebarCollapsed && (
          <div className="mt-2 border-t border-border-primary pt-2">
            <button
              onClick={() => setShowHidden((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 w-full text-text-muted hover:text-text-primary text-left"
              style={{ borderRadius: '0px' }}
            >
              <MoreHorizontal size={14} />
              <span className="text-[12px]">More ({hidden.length})</span>
            </button>
            {showHidden && hidden.map(renderItem)}
          </div>
        )}
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-border-primary px-2 py-2 shrink-0">
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center w-full py-1.5 text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-all duration-150"
          style={{ borderRadius: '6px' }}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
