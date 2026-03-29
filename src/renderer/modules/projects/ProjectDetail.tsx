import React, { useEffect, useState, useMemo } from 'react';
import {
  ArrowLeft,
  Clock,
  DollarSign,
  TrendingUp,
  Receipt,
  FileText,
  Edit,
} from 'lucide-react';
import api from '../../lib/api';
import { useNavigation } from '../../lib/navigation';
import { Plus } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────
interface Project {
  id: string;
  name: string;
  client_id: string;
  description: string;
  status: 'active' | 'completed' | 'on_hold' | 'archived';
  budget: number;
  budget_type: string;
  hourly_rate: number;
  start_date: string;
  end_date: string;
  tags: string;
}

interface Client {
  id: string;
  name: string;
}

interface TimeEntry {
  id: string;
  project_id: string;
  description: string;
  hours: number;
  date: string;
  user_name?: string;
  billable?: boolean;
  hourly_rate?: number;
}

interface Expense {
  id: string;
  project_id: string;
  description: string;
  amount: number;
  date: string;
  category?: string;
  vendor?: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string;
  total: number;
  status: string;
  date: string;
  due_date: string;
}

interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  project_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

type DetailTab = 'time' | 'expenses' | 'invoices';

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

// ─── Status Config ──────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  active: 'block-badge block-badge-income',
  completed: 'block-badge block-badge-blue',
  on_hold: 'block-badge block-badge-warning',
  archived: 'block-badge block-badge-expense',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  on_hold: 'On Hold',
  archived: 'Archived',
};

// ─── Formatters ─────────────────────────────────────────
const fmtCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

// ─── Stat Card ──────────────────────────────────────────
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  accentClass: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, accentClass }) => (
  <div
    className={`block-card p-4 border-l-2 ${accentClass}`}
    style={{ borderRadius: '2px' }}
  >
    <div className="flex items-center gap-2 mb-1">
      <span className="text-text-muted">{icon}</span>
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
    </div>
    <p className="text-xl font-mono text-text-primary font-bold">{value}</p>
  </div>
);

// ─── Component ──────────────────────────────────────────
const ProjectDetail: React.FC<ProjectDetailProps> = ({ projectId, onBack, onEdit }) => {
  const nav = useNavigation();
  const [project, setProject] = useState<Project | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>('time');

  // ─── Load Data ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const [proj, allTimeEntries, allExpenses, allInvoices, allLineItems] = await Promise.all([
          api.get('projects', projectId),
          api.query('time_entries'),
          api.query('expenses'),
          api.query('invoices'),
          api.query('invoice_line_items'),
        ]);
        if (cancelled) return;

        setProject(proj ?? null);

        // Load client
        if (proj?.client_id) {
          try {
            const cl = await api.get('clients', proj.client_id);
            if (!cancelled) setClient(cl ?? null);
          } catch {
            // client may not exist
          }
        }

        // Filter related records
        const projectTime = Array.isArray(allTimeEntries)
          ? allTimeEntries.filter((t: any) => t.project_id === projectId)
          : [];
        setTimeEntries(projectTime);

        const projectExpenses = Array.isArray(allExpenses)
          ? allExpenses.filter((e: any) => e.project_id === projectId)
          : [];
        setExpenses(projectExpenses);

        // Filter line items by project, then find matching invoices
        const projectLineItems = Array.isArray(allLineItems)
          ? allLineItems.filter((li: any) => li.project_id === projectId)
          : [];
        setLineItems(projectLineItems);

        const invoiceIds = new Set(projectLineItems.map((li: any) => li.invoice_id));
        const projectInvoices = Array.isArray(allInvoices)
          ? allInvoices.filter((inv: any) => invoiceIds.has(inv.id))
          : [];
        setInvoices(projectInvoices);
      } catch (err) {
        console.error('Failed to load project detail:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  // ─── Computed Stats ───────────────────────────────────
  const stats = useMemo(() => {
    const totalRevenue = lineItems.reduce((sum, li) => sum + (li.amount ?? 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const totalHours = timeEntries.reduce((sum, t) => sum + (t.hours ?? 0), 0);
    const profitLoss = totalRevenue - totalExpenses;
    return { totalRevenue, totalExpenses, totalHours, profitLoss };
  }, [lineItems, expenses, timeEntries]);

  // ─── Loading State ────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm font-mono">Loading project...</span>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          Back to Projects
        </button>
        <p className="text-sm text-text-muted">Project not found.</p>
      </div>
    );
  }

  // ─── Tab Config ───────────────────────────────────────
  const tabs: { key: DetailTab; label: string; count: number }[] = [
    { key: 'time', label: 'Time Entries', count: timeEntries.length },
    { key: 'expenses', label: 'Expenses', count: expenses.length },
    { key: 'invoices', label: 'Invoices', count: invoices.length },
  ];

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Projects
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-text-primary">{project.name}</h1>
            <span className={STATUS_BADGE[project.status] ?? 'block-badge'}>
              {STATUS_LABEL[project.status] ?? project.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
            {client && <span>{client.name}</span>}
            <span>{fmtDate(project.start_date)}{project.end_date ? ` - ${fmtDate(project.end_date)}` : ''}</span>
          </div>
          {project.description && (
            <p className="text-xs text-text-secondary mt-2 max-w-xl">{project.description}</p>
          )}
        </div>
        <button
          onClick={() => onEdit(project.id)}
          className="block-btn inline-flex items-center gap-1.5 text-xs"
        >
          <Edit size={13} />
          Edit
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign size={14} />}
          label="Total Revenue"
          value={fmtCurrency.format(stats.totalRevenue)}
          accentClass="border-l-accent-income"
        />
        <StatCard
          icon={<Receipt size={14} />}
          label="Total Expenses"
          value={fmtCurrency.format(stats.totalExpenses)}
          accentClass="border-l-accent-expense"
        />
        <StatCard
          icon={<Clock size={14} />}
          label="Total Hours"
          value={`${stats.totalHours.toFixed(1)}h`}
          accentClass="border-l-accent-blue"
        />
        <StatCard
          icon={<TrendingUp size={14} />}
          label="Profit / Loss"
          value={fmtCurrency.format(stats.profitLoss)}
          accentClass={stats.profitLoss >= 0 ? 'border-l-accent-income' : 'border-l-accent-expense'}
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border-primary pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-accent-blue text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 opacity-60">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'time' && (
          <TimeEntriesTab entries={timeEntries} />
        )}
        {activeTab === 'expenses' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                className="block-btn-primary inline-flex items-center gap-1.5 text-xs"
                onClick={() => {
                  sessionStorage.setItem('nav:prefillProjectId', projectId);
                  nav.goTo('expenses');
                }}
              >
                <Plus size={14} />
                Record Expense
              </button>
            </div>
            <ExpensesTab expenses={expenses} />
          </div>
        )}
        {activeTab === 'invoices' && (
          <InvoicesTab invoices={invoices} />
        )}
      </div>
    </div>
  );
};

// ─── Time Entries Tab ───────────────────────────────────
const TimeEntriesTab: React.FC<{ entries: TimeEntry[] }> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock size={24} className="mx-auto text-text-muted mb-2" />
        <p className="text-xs text-text-muted">No time entries for this project.</p>
      </div>
    );
  }

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '2px' }}>
      <table className="block-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>User</th>
            <th className="text-right">Hours</th>
            <th className="text-center">Billable</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="text-text-secondary font-mono text-xs">
                {fmtDate(entry.date)}
              </td>
              <td className="text-text-primary text-xs">
                {entry.description || '--'}
              </td>
              <td className="text-text-secondary text-xs">
                {entry.user_name || '--'}
              </td>
              <td className="text-right font-mono text-xs text-text-primary">
                {(entry.hours ?? 0).toFixed(1)}h
              </td>
              <td className="text-center">
                <span
                  className={`block-badge text-[10px] ${
                    entry.billable !== false ? 'block-badge-income' : 'block-badge-expense'
                  }`}
                >
                  {entry.billable !== false ? 'Yes' : 'No'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── Expenses Tab ───────────────────────────────────────
const ExpensesTab: React.FC<{ expenses: Expense[] }> = ({ expenses }) => {
  if (expenses.length === 0) {
    return (
      <div className="text-center py-8">
        <Receipt size={24} className="mx-auto text-text-muted mb-2" />
        <p className="text-xs text-text-muted">No expenses for this project.</p>
      </div>
    );
  }

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '2px' }}>
      <table className="block-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Category</th>
            <th>Vendor</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((exp) => (
            <tr key={exp.id}>
              <td className="text-text-secondary font-mono text-xs">
                {fmtDate(exp.date)}
              </td>
              <td className="text-text-primary text-xs">
                {exp.description || '--'}
              </td>
              <td className="text-text-secondary text-xs">
                {exp.category || '--'}
              </td>
              <td className="text-text-secondary text-xs">
                {exp.vendor || '--'}
              </td>
              <td className="text-right font-mono text-xs text-accent-expense">
                {fmtCurrency.format(exp.amount ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── Invoices Tab ───────────────────────────────────────
const InvoicesTab: React.FC<{ invoices: Invoice[] }> = ({ invoices }) => {
  if (invoices.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText size={24} className="mx-auto text-text-muted mb-2" />
        <p className="text-xs text-text-muted">No invoices linked to this project.</p>
      </div>
    );
  }

  const invoiceBadge: Record<string, string> = {
    paid: 'block-badge block-badge-income',
    sent: 'block-badge block-badge-blue',
    draft: 'block-badge block-badge-warning',
    overdue: 'block-badge block-badge-expense',
  };

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '2px' }}>
      <table className="block-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Date</th>
            <th>Due Date</th>
            <th>Status</th>
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td className="text-text-primary text-xs font-mono font-medium">
                {inv.invoice_number || '--'}
              </td>
              <td className="text-text-secondary font-mono text-xs">
                {fmtDate(inv.date)}
              </td>
              <td className="text-text-secondary font-mono text-xs">
                {fmtDate(inv.due_date)}
              </td>
              <td>
                <span className={invoiceBadge[inv.status] ?? 'block-badge'}>
                  {inv.status}
                </span>
              </td>
              <td className="text-right font-mono text-xs text-text-primary">
                {fmtCurrency.format(inv.total ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ProjectDetail;
