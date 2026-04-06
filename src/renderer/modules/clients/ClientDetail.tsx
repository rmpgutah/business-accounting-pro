import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  UserCircle,
  Mail,
  Phone,
  MapPin,
  FileText,
  FolderKanban,
  FolderOpen,
  Clock,
  Paperclip,
  Edit,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { useNavigation } from '../../lib/navigation';
import { formatCurrency, formatStatus } from '../../lib/format';
import ClientInsights from './ClientInsights';

// ─── Types ──────────────────────────────────────────────
interface Client {
  id: string;
  name: string;
  type: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  payment_terms: number;
  tax_id: string;
  status: 'active' | 'inactive' | 'prospect';
  notes: string;
  tags: string;
}

interface SummaryStats {
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
}

type Tab = 'invoices' | 'projects' | 'time' | 'documents';

interface ClientDetailProps {
  clientId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

// ─── Component ──────────────────────────────────────────
const ClientDetail: React.FC<ClientDetailProps> = ({ clientId, onBack, onEdit }) => {
  const nav = useNavigation();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('invoices');
  const [stats, setStats] = useState<SummaryStats>({ totalInvoiced: 0, totalPaid: 0, outstanding: 0 });
  const [tabData, setTabData] = useState<any[]>([]);
  const [tabLoading, setTabLoading] = useState(false);

  // ─── Load Client ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const c = await api.get('clients', clientId);
        if (!cancelled && c) setClient(c);

        // Compute summary stats from invoices
        const invoices = await api.query('invoices', { client_id: clientId });
        if (!cancelled && Array.isArray(invoices)) {
          const totalInvoiced = invoices.reduce((s: number, inv: any) => s + (inv.total ?? 0), 0);
          const totalPaid = invoices.reduce((s: number, inv: any) => s + (inv.amount_paid ?? 0), 0);
          setStats({
            totalInvoiced,
            totalPaid,
            outstanding: totalInvoiced - totalPaid,
          });
        }
      } catch (err) {
        console.error('Failed to load client:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clientId]);

  // ─── Load Tab Data ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loadTab = async () => {
      setTabLoading(true);
      try {
        const tableMap: Record<Tab, string> = {
          invoices: 'invoices',
          projects: 'projects',
          time: 'time_entries',
          documents: 'documents',
        };
        const rows = await api.query(tableMap[activeTab], { client_id: clientId });
        if (!cancelled) setTabData(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error(`Failed to load ${activeTab}:`, err);
        if (!cancelled) setTabData([]);
      } finally {
        if (!cancelled) setTabLoading(false);
      }
    };
    loadTab();
    return () => { cancelled = true; };
  }, [activeTab, clientId]);

  // ─── Tab Definitions ────────────────────────────────
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'invoices', label: 'Invoices', icon: <FileText size={14} /> },
    { key: 'projects', label: 'Projects', icon: <FolderKanban size={14} /> },
    { key: 'time', label: 'Time Entries', icon: <Clock size={14} /> },
    { key: 'documents', label: 'Documents', icon: <Paperclip size={14} /> },
  ];

  if (loading || !client) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <span className="text-sm text-text-muted font-mono">Loading client...</span>
      </div>
    );
  }

  const addressParts = [
    client.address_line1,
    client.address_line2,
    [client.city, client.state, client.zip].filter(Boolean).join(', '),
    client.country,
  ].filter(Boolean);

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <button
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          Back to Clients
        </button>
        <div className="flex items-center gap-2">
          <button
            className="block-btn-primary inline-flex items-center gap-1.5"
            onClick={() => {
              sessionStorage.setItem('nav:prefillClientId', clientId);
              nav.goTo('invoicing');
            }}
          >
            <FileText size={14} />
            New Invoice
          </button>
          <button
            className="block-btn inline-flex items-center gap-1.5"
            onClick={() => onEdit(clientId)}
          >
            <Edit size={14} />
            Edit
          </button>
        </div>
      </div>

      {/* Top Section: Contact Card + Stats */}
      <div className="grid grid-cols-3 gap-4">
        {/* Contact Card */}
        <div className="col-span-2 block-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start gap-4">
            <div
              className="flex items-center justify-center w-12 h-12 bg-bg-tertiary border border-border-primary shrink-0"
              style={{ borderRadius: '6px' }}
            >
              <UserCircle size={24} className="text-text-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold text-text-primary truncate">{client.name}</h2>
                <span className={formatStatus(client.status).className}>
                  {formatStatus(client.status).label}
                </span>
              </div>
              <p className="text-xs text-text-muted uppercase tracking-wider mb-3">
                {client.type} {client.tax_id ? `\u00B7 Tax ID: ${client.tax_id}` : ''}
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {client.email && (
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Mail size={14} className="text-text-muted shrink-0" />
                    <span className="truncate">{client.email}</span>
                  </div>
                )}
                {client.phone && (
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Phone size={14} className="text-text-muted shrink-0" />
                    <span className="font-mono text-xs">{client.phone}</span>
                  </div>
                )}
                {addressParts.length > 0 && (
                  <div className="flex items-start gap-2 text-text-secondary col-span-2">
                    <MapPin size={14} className="text-text-muted shrink-0 mt-0.5" />
                    <span className="text-xs leading-relaxed">{addressParts.join(', ')}</span>
                  </div>
                )}
              </div>
              {client.payment_terms > 0 && (
                <p className="text-xs text-text-muted mt-3">
                  Payment Terms: <span className="font-mono text-text-secondary">Net {client.payment_terms}</span>
                </p>
              )}
              {client.notes && (
                <p className="text-xs text-text-muted mt-2 leading-relaxed border-t border-border-primary pt-2">
                  {client.notes}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="space-y-4">
          <div className="stat-card border-l-2 border-l-accent-income" style={{ borderRadius: '6px' }}>
            <span className="stat-label">Total Invoiced</span>
            <span className="stat-value text-text-primary">{formatCurrency(stats.totalInvoiced)}</span>
          </div>
          <div className="stat-card border-l-2 border-l-accent-blue" style={{ borderRadius: '6px' }}>
            <span className="stat-label">Total Paid</span>
            <span className="stat-value text-accent-income">{formatCurrency(stats.totalPaid)}</span>
          </div>
          <div className="stat-card border-l-2 border-l-accent-warning" style={{ borderRadius: '6px' }}>
            <span className="stat-label">Outstanding</span>
            <span className="stat-value text-accent-warning">{formatCurrency(stats.outstanding)}</span>
          </div>
        </div>
      </div>

      {/* Client Insights */}
      <ClientInsights clientId={clientId} />

      {/* Tabs */}
      <div>
        <div className="flex gap-0 border-b border-border-primary">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'text-accent-blue border-accent-blue'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="mt-4">
          {tabLoading ? (
            <div className="py-12 text-center text-sm text-text-muted font-mono">
              Loading {activeTab}...
            </div>
          ) : tabData.length === 0 ? (
            <EmptyState
              icon={
                activeTab === 'invoices' ? FileText
                : activeTab === 'projects' ? FolderOpen
                : activeTab === 'time' ? Clock
                : FileText
              }
              message={`No ${activeTab} found for this client`}
            />
          ) : (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              {activeTab === 'invoices' && <InvoicesTable data={tabData} />}
              {activeTab === 'projects' && <ProjectsTable data={tabData} />}
              {activeTab === 'time' && <TimeEntriesTable data={tabData} />}
              {activeTab === 'documents' && <DocumentsTable data={tabData} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Sub-Tables ─────────────────────────────────────────
const InvoicesTable: React.FC<{ data: any[] }> = ({ data }) => (
  <table className="block-table">
    <thead>
      <tr>
        <th>Invoice #</th>
        <th>Date</th>
        <th>Status</th>
        <th>Total</th>
        <th>Paid</th>
      </tr>
    </thead>
    <tbody>
      {data.map((inv) => (
        <tr key={inv.id}>
          <td className="font-mono text-text-primary">{inv.invoice_number ?? inv.id}</td>
          <td className="text-text-secondary text-xs">{inv.date ?? inv.created_at ?? '--'}</td>
          <td>
            <span
              className={`block-badge ${
                inv.status === 'paid'
                  ? 'block-badge-income'
                  : inv.status === 'overdue'
                  ? 'block-badge-expense'
                  : 'block-badge-warning'
              }`}
            >
              {inv.status}
            </span>
          </td>
          <td className="font-mono text-text-primary">{formatCurrency(inv.total ?? 0)}</td>
          <td className="font-mono text-text-secondary">{formatCurrency(inv.amount_paid ?? 0)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const ProjectsTable: React.FC<{ data: any[] }> = ({ data }) => (
  <table className="block-table">
    <thead>
      <tr>
        <th>Project</th>
        <th>Status</th>
        <th>Budget</th>
      </tr>
    </thead>
    <tbody>
      {data.map((p) => (
        <tr key={p.id}>
          <td className="text-text-primary font-medium">{p.name}</td>
          <td>
            <span className="block-badge block-badge-blue">{p.status ?? 'active'}</span>
          </td>
          <td className="font-mono text-text-secondary">{p.budget ? formatCurrency(p.budget) : '--'}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const TimeEntriesTable: React.FC<{ data: any[] }> = ({ data }) => (
  <table className="block-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th>Duration</th>
        <th>Billable</th>
      </tr>
    </thead>
    <tbody>
      {data.map((t) => (
        <tr key={t.id}>
          <td className="text-text-secondary text-xs">{t.date ?? '--'}</td>
          <td className="text-text-primary">{t.description ?? '--'}</td>
          <td className="font-mono text-text-secondary">
            {t.duration_minutes ? `${Math.floor(t.duration_minutes / 60)}h ${t.duration_minutes % 60}m` : '--'}
          </td>
          <td>
            <span className={`block-badge ${t.billable ? 'block-badge-income' : 'block-badge-expense'}`}>
              {t.billable ? 'Yes' : 'No'}
            </span>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const DocumentsTable: React.FC<{ data: any[] }> = ({ data }) => (
  <table className="block-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Date</th>
      </tr>
    </thead>
    <tbody>
      {data.map((d) => (
        <tr key={d.id}>
          <td className="text-text-primary font-medium">{d.name ?? d.filename ?? '--'}</td>
          <td className="text-text-secondary text-xs uppercase">{d.type ?? d.mime_type ?? '--'}</td>
          <td className="text-text-secondary text-xs">{d.created_at ?? '--'}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default ClientDetail;
