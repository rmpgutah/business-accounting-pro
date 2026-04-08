import React from 'react';
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

const Sidebar: React.FC = () => {
  const currentModule = useAppStore((s) => s.currentModule);
  const setModule = useAppStore((s) => s.setModule);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

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
      {/* App Header */}
      <div className="flex items-center gap-2.5 px-3 h-14 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div
          className="flex items-center justify-center w-8 h-8 bg-accent-blue text-white font-bold text-sm shrink-0"
          style={{ borderRadius: '4px' }}
        >
          B
        </div>
        {!sidebarCollapsed && (
          <div className="flex flex-col leading-tight overflow-hidden">
            <span className="text-[11px] font-semibold text-text-primary tracking-tight">BAP</span>
            <span className="text-[10px] text-text-muted truncate">Accounting Pro</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {sections.map((section, sectionIdx) => (
          <div key={section.title}>
            {/* Section divider (except first) */}
            {sectionIdx > 0 && !sidebarCollapsed && (
              <div className="mx-3 my-1.5" style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />
            )}
            {sectionIdx > 0 && sidebarCollapsed && <div className="my-1" style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 8px' }} />}
            {!sidebarCollapsed && (
              <div className="px-4 pt-2.5 pb-1">
                <span className="text-[10px] font-semibold text-text-muted" style={{ letterSpacing: '0.04em' }}>
                  {section.title}
                </span>
              </div>
            )}
            {sidebarCollapsed && <div className="pt-1" />}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = currentModule === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setModule(item.id)}
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
                  } : {}}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = ''; }}
                  title={sidebarCollapsed ? item.label : undefined}
                  style={{ borderRadius: '0px' }}
                >
                  <Icon size={16} className="shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="text-[13px] truncate">{item.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-border-primary px-2 py-2 shrink-0">
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center w-full py-1.5 text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-all duration-150"
          style={{ borderRadius: '4px' }}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
