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
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { id: 'payroll', label: 'Payroll', icon: Users },
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
      className={`flex flex-col h-full bg-bg-secondary border-r border-border-primary transition-all duration-200 ${
        sidebarCollapsed ? 'w-16' : 'w-56'
      }`}
      style={{ borderRadius: '0px' }}
    >
      {/* App Header */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border-primary shrink-0">
        <div
          className="flex items-center justify-center w-8 h-8 bg-accent-blue text-white font-bold text-sm shrink-0"
          style={{ borderRadius: '2px' }}
        >
          B
        </div>
        {!sidebarCollapsed && (
          <div className="flex flex-col leading-none overflow-hidden">
            <span className="text-[10px] font-semibold text-text-muted tracking-wider">BAP</span>
            <span className="text-[11px] text-text-secondary truncate">Business Accounting Pro</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {sections.map((section) => (
          <div key={section.title} className="mb-1">
            {!sidebarCollapsed && (
              <div className="px-4 pt-3 pb-1">
                <span className="text-[10px] font-semibold text-text-muted tracking-wider">
                  {section.title}
                </span>
              </div>
            )}
            {sidebarCollapsed && <div className="pt-2" />}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = currentModule === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setModule(item.id)}
                  className={`flex items-center gap-2.5 w-full text-left transition-colors duration-100 ${
                    sidebarCollapsed ? 'justify-center px-0 py-2 mx-auto' : 'px-3 py-1.5'
                  } ${
                    isActive
                      ? 'bg-accent-blue/10 text-accent-blue border-r-2 border-accent-blue'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border-r-2 border-transparent'
                  }`}
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
          className="flex items-center justify-center w-full py-1.5 text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
          style={{ borderRadius: '2px' }}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
