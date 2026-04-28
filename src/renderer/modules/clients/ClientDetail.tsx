import React, { useEffect, useState, useMemo } from 'react';
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
  Scale,
  Printer,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  DollarSign,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Shield,
  BarChart3,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { useNavigation } from '../../lib/navigation';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import ClientInsights from './ClientInsights';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';
import EntityChip from '../../components/EntityChip';

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
  custom_fields: string;
  created_at: string;
}

interface SummaryStats {
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
}

interface AgingData {
  current_due: number;
  age_1_30: number;
  age_31_60: number;
  age_61_90: number;
  age_90_plus: number;
}

interface PaymentChartEntry {
  month: string;
  total: number;
}

interface ContactInfo {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: number;
}

interface ActivityEntry {
  date: string;
  type: 'invoice_created' | 'payment_received' | 'project_started' | 'project_completed' | 'communication';
  label: string;
  amount?: number;
  id?: string;
}

type Tab = 'invoices' | 'projects' | 'time' | 'documents' | 'debts' | 'revenue' | 'activity';

interface ClientDetailProps {
  clientId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

// ─── Chart Tooltip ──────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'rgba(15, 15, 20, 0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '6px',
        padding: '8px 12px',
      }}
    >
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, margin: 0 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? '#34d399', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, margin: '2px 0 0' }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

// ─── Health Badge ───────────────────────────────────────
function getHealthBadge(outstanding: number, totalInvoiced: number, avgPaymentDays: number): { label: string; color: string; bg: string } {
  const outstandingRatio = totalInvoiced > 0 ? outstanding / totalInvoiced : 0;
  if (outstandingRatio > 0.5 || avgPaymentDays > 60) return { label: 'At Risk', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
  if (outstandingRatio > 0.2 || avgPaymentDays > 30) return { label: 'Watch', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  return { label: 'Healthy', color: '#34d399', bg: 'rgba(52,211,153,0.12)' };
}

// ─── Payment Trend ──────────────────────────────────────
function getPaymentTrend(recentDays: number[], avgDays: number): { label: string; icon: React.ReactNode } {
  if (recentDays.length < 2) return { label: 'Stable', icon: <Minus size={12} /> };
  const recentAvg = recentDays.slice(-3).reduce((a, b) => a + b, 0) / Math.min(recentDays.length, 3);
  if (recentAvg < avgDays * 0.8) return { label: 'Improving', icon: <TrendingDown size={12} className="text-accent-income" /> };
  if (recentAvg > avgDays * 1.2) return { label: 'Declining', icon: <TrendingUp size={12} className="text-accent-expense" /> };
  return { label: 'Stable', icon: <Minus size={12} className="text-text-muted" /> };
}

// ─── Component ──────────────────────────────────────────
const ClientDetail: React.FC<ClientDetailProps> = ({ clientId, onBack, onEdit }) => {
  const nav = useNavigation();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('invoices');
  const [stats, setStats] = useState<SummaryStats>({ totalInvoiced: 0, totalPaid: 0, outstanding: 0 });
  const [tabData, setTabData] = useState<any[]>([]);
  const [tabLoading, setTabLoading] = useState(false);

  // Feature 31-33: Enhanced header data
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [avgPaymentDays, setAvgPaymentDays] = useState(0);
  const [recentPaymentDays, setRecentPaymentDays] = useState<number[]>([]);

  // Feature 34: Payment history chart
  const [paymentChart, setPaymentChart] = useState<PaymentChartEntry[]>([]);

  // Feature 35: Aging breakdown
  const [aging, setAging] = useState<AgingData>({ current_due: 0, age_1_30: 0, age_31_60: 0, age_61_90: 0, age_90_plus: 0 });

  // Feature 36-37: Contacts
  const [contacts, setContacts] = useState<ContactInfo[]>([]);

  // Feature 38: Notes expanded
  const [notesExpanded, setNotesExpanded] = useState(false);

  // Feature 40: Revenue tab data
  const [revenueData, setRevenueData] = useState<any[]>([]);
  const [expenseData, setExpenseData] = useState<any[]>([]);

  // Feature 41: Activity timeline
  const [activityData, setActivityData] = useState<ActivityEntry[]>([]);

  // ─── Load Client + Enhanced Stats ───────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const companyId = activeCompany?.id;
        const c = await api.get('clients', clientId);
        if (!cancelled && c) setClient(c);

        // Compute summary stats from invoices
        const invoices = await api.query('invoices', { client_id: clientId, company_id: companyId });
        if (!cancelled && Array.isArray(invoices)) {
          const totalInvoiced = invoices.reduce((s: number, inv: any) => s + (inv.total ?? 0), 0);
          const totalPaid = invoices.reduce((s: number, inv: any) => s + (inv.amount_paid ?? 0), 0);
          setStats({ totalInvoiced, totalPaid, outstanding: totalInvoiced - totalPaid });
          setInvoiceCount(invoices.length);
        }

        // Feature 34: Payment chart (last 12 months)
        try {
          const payRows = await api.rawQuery(
            `SELECT strftime('%Y-%m', p.date) as month, COALESCE(SUM(p.amount), 0) as total
             FROM payments p JOIN invoices i ON p.invoice_id = i.id
             WHERE i.client_id = ? AND i.company_id = ? AND p.date >= date('now', '-12 months')
             GROUP BY month ORDER BY month`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(payRows)) setPaymentChart(payRows as PaymentChartEntry[]);
        } catch { /* ignore */ }

        // Feature 35: Aging breakdown
        try {
          const agingRows = await api.rawQuery(
            `SELECT
              COALESCE(SUM(CASE WHEN due_date >= date('now') THEN total - amount_paid ELSE 0 END), 0) as current_due,
              COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN total - amount_paid ELSE 0 END), 0) as age_1_30,
              COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN total - amount_paid ELSE 0 END), 0) as age_31_60,
              COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 61 AND 90 THEN total - amount_paid ELSE 0 END), 0) as age_61_90,
              COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) > 90 THEN total - amount_paid ELSE 0 END), 0) as age_90_plus
            FROM invoices WHERE client_id = ? AND company_id = ? AND status NOT IN ('paid', 'void', 'cancelled')`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(agingRows) && agingRows.length > 0) {
            setAging(agingRows[0] as AgingData);
          }
        } catch { /* ignore */ }

        // Feature 31-33: Avg payment days
        try {
          const dayRows = await api.rawQuery(
            `SELECT CAST(julianday(p.date) - julianday(i.issue_date) AS INTEGER) as days
             FROM payments p JOIN invoices i ON p.invoice_id = i.id
             WHERE i.client_id = ? AND i.company_id = ?
             ORDER BY p.date DESC`,
            [clientId, companyId]
          );
          if (!cancelled && Array.isArray(dayRows) && dayRows.length > 0) {
            const allDays = dayRows.map((r: any) => r.days).filter((d: number) => d >= 0);
            const avg = allDays.length > 0 ? Math.round(allDays.reduce((a: number, b: number) => a + b, 0) / allDays.length) : 0;
            setAvgPaymentDays(avg);
            setRecentPaymentDays(allDays.slice(0, 5));
          }
        } catch { /* ignore */ }

        // Feature 36: Load contacts (if table exists)
        try {
          const contactRows = await api.rawQuery(
            `SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, name ASC`,
            [clientId]
          );
          if (!cancelled && Array.isArray(contactRows)) setContacts(contactRows as ContactInfo[]);
        } catch { /* table may not exist */ }
      } catch (err) {
        console.error('Failed to load client:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clientId, activeCompany]);

  // ─── Load Tab Data ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loadTab = async () => {
      setTabLoading(true);
      const companyId = activeCompany?.id;
      try {
        if (activeTab === 'debts') {
          const rows = await api.rawQuery(
            `SELECT d.* FROM debts d WHERE d.company_id = ? AND (
              d.debtor_name = (SELECT name FROM clients WHERE id = ?) OR
              d.source_id IN (SELECT id FROM invoices WHERE client_id = ? AND company_id = ?)
            ) ORDER BY d.created_at DESC`,
            [companyId, clientId, clientId, companyId]
          );
          if (!cancelled) setTabData(Array.isArray(rows) ? rows : []);
        } else if (activeTab === 'revenue') {
          // Feature 40: Revenue & Expense tab
          try {
            const revRows = await api.rawQuery(
              `SELECT strftime('%Y-%m', issue_date) as month, COALESCE(SUM(total), 0) as invoiced
               FROM invoices WHERE client_id = ? AND company_id = ? AND issue_date >= date('now', '-12 months')
               GROUP BY month ORDER BY month`,
              [clientId, companyId]
            );
            if (!cancelled) setRevenueData(Array.isArray(revRows) ? revRows : []);
          } catch { if (!cancelled) setRevenueData([]); }
          try {
            const expRows = await api.rawQuery(
              `SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(amount), 0) as expenses
               FROM expenses WHERE client_id = ? AND company_id = ? AND date >= date('now', '-12 months')
               GROUP BY month ORDER BY month`,
              [clientId, companyId]
            );
            if (!cancelled) setExpenseData(Array.isArray(expRows) ? expRows : []);
          } catch { if (!cancelled) setExpenseData([]); }
          if (!cancelled) setTabData([{ loaded: true }]); // non-empty marker
        } else if (activeTab === 'activity') {
          // Feature 41: Activity timeline
          const activities: ActivityEntry[] = [];
          try {
            const invRows = await api.rawQuery(
              `SELECT id, invoice_number, issue_date, total, status FROM invoices WHERE client_id = ? AND company_id = ? ORDER BY issue_date DESC LIMIT 50`,
              [clientId, companyId]
            );
            if (Array.isArray(invRows)) {
              invRows.forEach((inv: any) => {
                activities.push({ date: inv.issue_date, type: 'invoice_created', label: `Invoice ${inv.invoice_number} created (${formatCurrency(inv.total)})`, amount: inv.total, id: inv.id });
              });
            }
          } catch { /* ignore */ }
          try {
            const payRows = await api.rawQuery(
              `SELECT p.id, p.amount, p.date, p.payment_method, i.invoice_number
               FROM payments p JOIN invoices i ON p.invoice_id = i.id
               WHERE i.client_id = ? AND i.company_id = ?
               ORDER BY p.date DESC LIMIT 50`,
              [clientId, companyId]
            );
            if (Array.isArray(payRows)) {
              payRows.forEach((p: any) => {
                activities.push({ date: p.date, type: 'payment_received', label: `Payment ${formatCurrency(p.amount)} on invoice ${p.invoice_number}${p.payment_method ? ` (${p.payment_method})` : ''}`, amount: p.amount, id: p.id });
              });
            }
          } catch { /* ignore */ }
          try {
            const projRows = await api.rawQuery(
              `SELECT id, name, status, created_at FROM projects WHERE client_id = ? AND company_id = ?`,
              [clientId, companyId]
            );
            if (Array.isArray(projRows)) {
              projRows.forEach((pr: any) => {
                activities.push({ date: pr.created_at, type: 'project_started', label: `Project "${pr.name}" started`, id: pr.id });
                if (pr.status === 'completed') {
                  activities.push({ date: pr.created_at, type: 'project_completed', label: `Project "${pr.name}" completed`, id: pr.id });
                }
              });
            }
          } catch { /* ignore */ }
          try {
            const commRows = await api.rawQuery(
              `SELECT dc.id, dc.type, dc.subject, dc.logged_at, dc.direction
               FROM debt_communications dc
               JOIN debts d ON dc.debt_id = d.id
               WHERE d.company_id = ? AND (
                 d.debtor_name = (SELECT name FROM clients WHERE id = ?) OR
                 d.source_id IN (SELECT id FROM invoices WHERE client_id = ? AND company_id = ?)
               )
               ORDER BY dc.logged_at DESC LIMIT 30`,
              [companyId, clientId, clientId, companyId]
            );
            if (Array.isArray(commRows)) {
              commRows.forEach((c: any) => {
                activities.push({ date: c.logged_at, type: 'communication', label: `${c.direction === 'outbound' ? 'Sent' : 'Received'} ${c.type}${c.subject ? `: ${c.subject}` : ''}`, id: c.id });
              });
            }
          } catch { /* ignore */ }
          // Sort by date descending
          activities.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
          if (!cancelled) {
            setActivityData(activities);
            setTabData(activities.length > 0 ? activities : []);
          }
        } else {
          const tableMap: Record<string, string> = {
            invoices: 'invoices',
            projects: 'projects',
            time: 'time_entries',
            documents: 'documents',
          };
          const rows = await api.query(tableMap[activeTab], { client_id: clientId, company_id: companyId });
          if (!cancelled) setTabData(Array.isArray(rows) ? rows : []);
        }
      } catch (err) {
        console.error(`Failed to load ${activeTab}:`, err);
        if (!cancelled) setTabData([]);
      } finally {
        if (!cancelled) setTabLoading(false);
      }
    };
    loadTab();
    return () => { cancelled = true; };
  }, [activeTab, clientId, activeCompany]);

  // ─── Computed Values ────────────────────────────────
  const healthBadge = useMemo(() => getHealthBadge(stats.outstanding, stats.totalInvoiced, avgPaymentDays), [stats, avgPaymentDays]);
  const paymentTrend = useMemo(() => getPaymentTrend(recentPaymentDays, avgPaymentDays), [recentPaymentDays, avgPaymentDays]);
  const primaryContact = useMemo(() => contacts.find((c) => c.is_primary) || contacts[0] || null, [contacts]);
  const agingTotal = useMemo(() => aging.current_due + aging.age_1_30 + aging.age_31_60 + aging.age_61_90 + aging.age_90_plus, [aging]);

  // Feature 40: Merged revenue data
  const mergedRevenueChart = useMemo(() => {
    const map: Record<string, { month: string; invoiced: number; expenses: number; net: number }> = {};
    revenueData.forEach((r: any) => {
      if (!map[r.month]) map[r.month] = { month: r.month, invoiced: 0, expenses: 0, net: 0 };
      map[r.month].invoiced = r.invoiced ?? 0;
    });
    expenseData.forEach((e: any) => {
      if (!map[e.month]) map[e.month] = { month: e.month, invoiced: 0, expenses: 0, net: 0 };
      map[e.month].expenses = e.expenses ?? 0;
    });
    return Object.values(map)
      .map((m) => ({ ...m, net: m.invoiced - m.expenses }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [revenueData, expenseData]);

  // ─── Print Statement ────────────────────────────────
  const handlePrintStatement = async () => {
    if (!client) return;
    const companyId = activeCompany?.id;
    let invoiceRows: any[] = [];
    let paymentRows: any[] = [];
    try {
      invoiceRows = (await api.rawQuery(
        `SELECT invoice_number, issue_date, due_date, total, amount_paid, status FROM invoices WHERE client_id = ? AND company_id = ? ORDER BY issue_date DESC`,
        [clientId, companyId]
      )) as any[] || [];
    } catch { /* ignore */ }
    try {
      paymentRows = (await api.rawQuery(
        `SELECT p.amount, p.date, p.payment_method, i.invoice_number
         FROM payments p JOIN invoices i ON p.invoice_id = i.id
         WHERE i.client_id = ? AND i.company_id = ?
         ORDER BY p.date DESC`,
        [clientId, companyId]
      )) as any[] || [];
    } catch { /* ignore */ }

    const html = `
      <div style="font-family: 'Inter', system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
        <div style="border-bottom: 3px solid #1a1a2e; padding-bottom: 20px; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 24px; color: #1a1a2e;">Client Statement</h1>
          <p style="margin: 4px 0 0; color: #666; font-size: 14px;">Generated ${new Date().toLocaleDateString()}</p>
        </div>
        <div style="margin-bottom: 30px;">
          <h2 style="margin: 0 0 8px; font-size: 18px;">${client.name}</h2>
          ${client.email ? `<p style="margin: 2px 0; color: #666; font-size: 13px;">${client.email}</p>` : ''}
          ${client.phone ? `<p style="margin: 2px 0; color: #666; font-size: 13px;">${client.phone}</p>` : ''}
          ${client.address_line1 ? `<p style="margin: 2px 0; color: #666; font-size: 13px;">${client.address_line1}${client.city ? `, ${client.city}` : ''}${client.state ? `, ${client.state}` : ''} ${client.zip || ''}</p>` : ''}
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 30px;">
          <div style="background: #f0fdf4; padding: 16px; border-radius: 6px; text-align: center;">
            <div style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em;">Total Invoiced</div>
            <div style="font-size: 20px; font-weight: 700; color: #16a34a; font-family: monospace;">$${stats.totalInvoiced.toFixed(2)}</div>
          </div>
          <div style="background: #eff6ff; padding: 16px; border-radius: 6px; text-align: center;">
            <div style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em;">Total Paid</div>
            <div style="font-size: 20px; font-weight: 700; color: #2563eb; font-family: monospace;">$${stats.totalPaid.toFixed(2)}</div>
          </div>
          <div style="background: #fef3c7; padding: 16px; border-radius: 6px; text-align: center;">
            <div style="font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em;">Outstanding</div>
            <div style="font-size: 20px; font-weight: 700; color: #d97706; font-family: monospace;">$${stats.outstanding.toFixed(2)}</div>
          </div>
        </div>
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 12px;">Aging Summary</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead><tr style="border-bottom: 2px solid #e5e7eb;">
              <th style="text-align: left; padding: 8px 4px;">Current</th>
              <th style="text-align: left; padding: 8px 4px;">1-30 Days</th>
              <th style="text-align: left; padding: 8px 4px;">31-60 Days</th>
              <th style="text-align: left; padding: 8px 4px;">61-90 Days</th>
              <th style="text-align: left; padding: 8px 4px;">90+ Days</th>
            </tr></thead>
            <tbody><tr>
              <td style="padding: 8px 4px; font-family: monospace;">$${(aging.current_due ?? 0).toFixed(2)}</td>
              <td style="padding: 8px 4px; font-family: monospace;">$${(aging.age_1_30 ?? 0).toFixed(2)}</td>
              <td style="padding: 8px 4px; font-family: monospace;">$${(aging.age_31_60 ?? 0).toFixed(2)}</td>
              <td style="padding: 8px 4px; font-family: monospace;">$${(aging.age_61_90 ?? 0).toFixed(2)}</td>
              <td style="padding: 8px 4px; font-family: monospace; color: #dc2626;">$${(aging.age_90_plus ?? 0).toFixed(2)}</td>
            </tr></tbody>
          </table>
        </div>
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 12px;">Invoices</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead><tr style="border-bottom: 2px solid #e5e7eb;">
              <th style="text-align: left; padding: 8px 4px;">Invoice #</th>
              <th style="text-align: left; padding: 8px 4px;">Date</th>
              <th style="text-align: left; padding: 8px 4px;">Due Date</th>
              <th style="text-align: left; padding: 8px 4px;">Status</th>
              <th style="text-align: right; padding: 8px 4px;">Total</th>
              <th style="text-align: right; padding: 8px 4px;">Paid</th>
            </tr></thead>
            <tbody>${invoiceRows.map((inv: any) => `<tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 8px 4px; font-family: monospace;">${inv.invoice_number}</td>
              <td style="padding: 8px 4px;">${inv.issue_date}</td>
              <td style="padding: 8px 4px;">${inv.due_date}</td>
              <td style="padding: 8px 4px; text-transform: capitalize;">${inv.status}</td>
              <td style="padding: 8px 4px; text-align: right; font-family: monospace;">$${(inv.total ?? 0).toFixed(2)}</td>
              <td style="padding: 8px 4px; text-align: right; font-family: monospace;">$${(inv.amount_paid ?? 0).toFixed(2)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 12px;">Payment History</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead><tr style="border-bottom: 2px solid #e5e7eb;">
              <th style="text-align: left; padding: 8px 4px;">Date</th>
              <th style="text-align: left; padding: 8px 4px;">Invoice</th>
              <th style="text-align: left; padding: 8px 4px;">Method</th>
              <th style="text-align: right; padding: 8px 4px;">Amount</th>
            </tr></thead>
            <tbody>${paymentRows.map((p: any) => `<tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 8px 4px;">${p.date}</td>
              <td style="padding: 8px 4px; font-family: monospace;">${p.invoice_number}</td>
              <td style="padding: 8px 4px; text-transform: capitalize;">${p.payment_method || '--'}</td>
              <td style="padding: 8px 4px; text-align: right; font-family: monospace;">$${(p.amount ?? 0).toFixed(2)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div style="border-top: 2px solid #1a1a2e; padding-top: 16px; text-align: right; font-size: 12px; color: #999;">
          <strong>Total Outstanding: $${stats.outstanding.toFixed(2)}</strong>
        </div>
      </div>
    `;
    await api.printPreview(html, `Statement - ${client.name}`);
  };

  // ─── Tab Definitions ────────────────────────────────
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'invoices', label: 'Invoices', icon: <FileText size={14} /> },
    { key: 'projects', label: 'Projects', icon: <FolderKanban size={14} /> },
    { key: 'time', label: 'Time Entries', icon: <Clock size={14} /> },
    { key: 'revenue', label: 'Revenue', icon: <BarChart3 size={14} /> },
    { key: 'activity', label: 'Activity', icon: <Activity size={14} /> },
    { key: 'documents', label: 'Documents', icon: <Paperclip size={14} /> },
    { key: 'debts', label: 'Debts', icon: <Scale size={14} /> },
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
          {/* Feature 39: Print Statement */}
          <button
            className="block-btn inline-flex items-center gap-1.5"
            onClick={handlePrintStatement}
          >
            <Printer size={14} />
            Print Statement
          </button>
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
                {/* Feature 31: Health badge */}
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5"
                  style={{ color: healthBadge.color, background: healthBadge.bg, borderRadius: '6px' }}
                >
                  {healthBadge.label}
                </span>
              </div>
              <p className="text-xs text-text-muted uppercase tracking-wider mb-3">
                <span className="capitalize">{client.type}</span> {client.tax_id ? `· Tax ID: ${client.tax_id}` : ''}
                {/* Feature 33: Client since */}
                {client.created_at && (
                  <> &middot; Client since {formatDate(client.created_at, { style: 'short' })}</>
                )}
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
            </div>
          </div>

          {/* Feature 36-37: Primary Contact Quick Actions */}
          {primaryContact && (
            <div className="flex items-center gap-4 mt-3 p-3 bg-bg-secondary border border-border-primary" style={{ borderRadius: '6px' }}>
              <div className="flex-1">
                <div className="text-sm font-semibold text-text-primary">{primaryContact.name}</div>
                {primaryContact.title && <div className="text-xs text-text-muted">{primaryContact.title}</div>}
              </div>
              {primaryContact.email && (
                <button className="block-btn text-xs flex items-center gap-1" onClick={() => window.open(`mailto:${primaryContact.email}`)}>
                  <Mail size={12} /> Email
                </button>
              )}
              {primaryContact.phone && (
                <button className="block-btn text-xs flex items-center gap-1" onClick={() => window.open(`tel:${primaryContact.phone}`)}>
                  <Phone size={12} /> Call
                </button>
              )}
            </div>
          )}
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

      {/* Feature 31-33: Enhanced Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Lifetime Value</div>
          <div className="text-lg font-mono font-bold text-text-primary mt-1">{formatCurrency(stats.totalInvoiced)}</div>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Outstanding</div>
          <div className="text-lg font-mono font-bold text-accent-expense mt-1">{formatCurrency(stats.outstanding)}</div>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Payment Days</div>
          <div className="text-lg font-mono font-bold text-text-primary mt-1">{avgPaymentDays > 0 ? `${avgPaymentDays}d` : '--'}</div>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Invoices</div>
          <div className="text-lg font-mono font-bold text-text-primary mt-1">{invoiceCount}</div>
        </div>
      </div>

      {/* Feature 42: Credit & Risk Section */}
      <div className="grid grid-cols-3 gap-4">
        {/* Payment Trend */}
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Payment Trend</div>
          <div className="flex items-center gap-2">
            {paymentTrend.icon}
            <span className="text-sm font-semibold text-text-primary">{paymentTrend.label}</span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            {avgPaymentDays > 0 ? `Avg ${avgPaymentDays} days to pay` : 'No payment data'}
          </p>
        </div>

        {/* Feature 34: Payment History Sparkline */}
        <div className="block-card p-4 col-span-2" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Payment History (12 Months)</div>
          {paymentChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={paymentChart} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="total" fill="rgba(52, 211, 153, 0.7)" radius={[2, 2, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[80px] text-xs text-text-muted font-mono">No payment data</div>
          )}
        </div>
      </div>

      {/* Feature 35: Aging Breakdown */}
      {agingTotal > 0 && (
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Aging Breakdown</div>
          {/* Horizontal stacked bar */}
          <div className="flex h-6 overflow-hidden" style={{ borderRadius: '6px' }}>
            {aging.current_due > 0 && (
              <div
                className="flex items-center justify-center text-[9px] font-mono font-bold"
                style={{ width: `${(aging.current_due / agingTotal) * 100}%`, background: 'rgba(52,211,153,0.5)', color: '#fff', minWidth: '30px' }}
                title={`Current: ${formatCurrency(aging.current_due)}`}
              >
                {formatCurrency(aging.current_due)}
              </div>
            )}
            {aging.age_1_30 > 0 && (
              <div
                className="flex items-center justify-center text-[9px] font-mono font-bold"
                style={{ width: `${(aging.age_1_30 / agingTotal) * 100}%`, background: 'rgba(245,158,11,0.5)', color: '#fff', minWidth: '30px' }}
                title={`1-30 Days: ${formatCurrency(aging.age_1_30)}`}
              >
                {formatCurrency(aging.age_1_30)}
              </div>
            )}
            {aging.age_31_60 > 0 && (
              <div
                className="flex items-center justify-center text-[9px] font-mono font-bold"
                style={{ width: `${(aging.age_31_60 / agingTotal) * 100}%`, background: 'rgba(249,115,22,0.5)', color: '#fff', minWidth: '30px' }}
                title={`31-60 Days: ${formatCurrency(aging.age_31_60)}`}
              >
                {formatCurrency(aging.age_31_60)}
              </div>
            )}
            {aging.age_61_90 > 0 && (
              <div
                className="flex items-center justify-center text-[9px] font-mono font-bold"
                style={{ width: `${(aging.age_61_90 / agingTotal) * 100}%`, background: 'rgba(239,68,68,0.5)', color: '#fff', minWidth: '30px' }}
                title={`61-90 Days: ${formatCurrency(aging.age_61_90)}`}
              >
                {formatCurrency(aging.age_61_90)}
              </div>
            )}
            {aging.age_90_plus > 0 && (
              <div
                className="flex items-center justify-center text-[9px] font-mono font-bold"
                style={{ width: `${(aging.age_90_plus / agingTotal) * 100}%`, background: 'rgba(185,28,28,0.6)', color: '#fff', minWidth: '30px' }}
                title={`90+ Days: ${formatCurrency(aging.age_90_plus)}`}
              >
                {formatCurrency(aging.age_90_plus)}
              </div>
            )}
          </div>
          <div className="flex gap-4 mt-2 text-[10px] text-text-muted">
            <span><span style={{ color: 'rgba(52,211,153,0.8)' }}>&#9632;</span> Current</span>
            <span><span style={{ color: 'rgba(245,158,11,0.8)' }}>&#9632;</span> 1-30d</span>
            <span><span style={{ color: 'rgba(249,115,22,0.8)' }}>&#9632;</span> 31-60d</span>
            <span><span style={{ color: 'rgba(239,68,68,0.8)' }}>&#9632;</span> 61-90d</span>
            <span><span style={{ color: 'rgba(185,28,28,0.8)' }}>&#9632;</span> 90+d</span>
          </div>
        </div>
      )}

      {/* Feature 38: Notes & Internal Notes Section */}
      {client.notes && (
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <button
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setNotesExpanded(!notesExpanded)}
          >
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Notes</h3>
            {notesExpanded ? <ChevronUp size={12} className="text-text-muted" /> : <ChevronDown size={12} className="text-text-muted" />}
          </button>
          {notesExpanded && (
            <div className="text-sm text-text-secondary whitespace-pre-wrap mt-2">{client.notes}</div>
          )}
        </div>
      )}

      {/* Client Insights */}
      <ClientInsights clientId={clientId} />

      {/* Tabs */}
      <div>
        <div className="flex gap-0 border-b border-border-primary overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-px whitespace-nowrap ${
                activeTab === tab.key
                  ? 'text-accent-blue border-accent-blue'
                  : 'text-text-muted border-transparent hover:text-text-secondary transition-colors'
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
          ) : activeTab === 'revenue' ? (
            /* Feature 40: Revenue & Expense Tab */
            <RevenueTab data={mergedRevenueChart} />
          ) : activeTab === 'activity' ? (
            /* Feature 41: Activity Timeline */
            <ActivityTimelineTab data={activityData} />
          ) : tabData.length === 0 ? (
            <EmptyState
              icon={
                activeTab === 'invoices' ? FileText
                : activeTab === 'projects' ? FolderOpen
                : activeTab === 'time' ? Clock
                : activeTab === 'debts' ? Scale
                : FileText
              }
              message={`No ${activeTab} found for this client`}
            />
          ) : (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              {activeTab === 'invoices' && <InvoicesTable data={tabData} onNavigate={(id) => nav.goToInvoice(id)} />}
              {activeTab === 'projects' && <ProjectsTable data={tabData} onNavigate={(id) => nav.goToProject(id)} />}
              {activeTab === 'time' && <TimeEntriesTable data={tabData} />}
              {activeTab === 'documents' && <DocumentsTable data={tabData} />}
              {activeTab === 'debts' && <DebtsTable data={tabData} />}
            </div>
          )}
        </div>

        {/* Cross-entity integration: everything touching this client */}
        <div className="grid grid-cols-2 gap-4 mt-6">
          <RelatedPanel entityType="client" entityId={clientId} />
          <EntityTimeline entityType="clients" entityId={clientId} />
        </div>
      </div>
    </div>
  );
};

// ─── Feature 40: Revenue Tab ────────────────────────────
const RevenueTab: React.FC<{ data: any[] }> = ({ data }) => {
  const totalInvoiced = data.reduce((s, r) => s + (r.invoiced ?? 0), 0);
  const totalExpenses = data.reduce((s, r) => s + (r.expenses ?? 0), 0);
  const netRevenue = totalInvoiced - totalExpenses;
  const marginPct = totalInvoiced > 0 ? ((netRevenue / totalInvoiced) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Invoiced</div>
          <div className="text-lg font-mono font-bold text-accent-income mt-1">{formatCurrency(totalInvoiced)}</div>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Expenses</div>
          <div className="text-lg font-mono font-bold text-accent-expense mt-1">{formatCurrency(totalExpenses)}</div>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Net Revenue</div>
          <div className={`text-lg font-mono font-bold mt-1 ${netRevenue >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
            {formatCurrency(netRevenue)}
          </div>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Profit Margin</div>
          <div className={`text-lg font-mono font-bold mt-1 ${Number(marginPct) >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
            {marginPct}%
          </div>
        </div>
      </div>
      {/* Chart */}
      {data.length > 0 ? (
        <div className="block-card p-4" style={{ borderRadius: '6px', background: 'rgba(255,255,255,0.02)' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Revenue vs Expenses (12 Months)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} width={48} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }} />
              <Bar dataKey="invoiced" name="Invoiced" fill="rgba(52, 211, 153, 0.7)" radius={[3, 3, 0, 0]} maxBarSize={24} />
              <Bar dataKey="expenses" name="Expenses" fill="rgba(239, 68, 68, 0.5)" radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState icon={BarChart3} message="No revenue data for the last 12 months" />
      )}
      {/* Net Revenue Line */}
      {data.length > 0 && (
        <div className="block-card p-4" style={{ borderRadius: '6px', background: 'rgba(255,255,255,0.02)' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Net Revenue Trend</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} width={48} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <Line type="monotone" dataKey="net" name="Net Revenue" stroke="#34d399" strokeWidth={2} dot={{ fill: '#34d399', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

// ─── Feature 41: Activity Timeline Tab ──────────────────
const ACTIVITY_COLORS: Record<string, string> = {
  invoice_created: 'rgba(96, 165, 250, 0.8)',
  payment_received: 'rgba(52, 211, 153, 0.8)',
  project_started: 'rgba(167, 139, 250, 0.8)',
  project_completed: 'rgba(52, 211, 153, 0.8)',
  communication: 'rgba(245, 158, 11, 0.8)',
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  invoice_created: <FileText size={12} />,
  payment_received: <DollarSign size={12} />,
  project_started: <FolderKanban size={12} />,
  project_completed: <FolderKanban size={12} />,
  communication: <Mail size={12} />,
};

const ActivityTimelineTab: React.FC<{ data: ActivityEntry[] }> = ({ data }) => {
  if (data.length === 0) {
    return <EmptyState icon={Activity} message="No activity recorded for this client" />;
  }

  return (
    <div className="block-card p-4" style={{ borderRadius: '6px' }}>
      <div className="space-y-0">
        {data.map((entry, i) => (
          <div key={i} className="flex gap-3 relative">
            {/* Timeline line */}
            {i < data.length - 1 && (
              <div className="absolute left-[11px] top-[24px] bottom-0 w-px bg-border-primary" />
            )}
            {/* Dot */}
            <div
              className="flex items-center justify-center w-6 h-6 shrink-0 mt-1"
              style={{ borderRadius: '6px', background: ACTIVITY_COLORS[entry.type] ?? 'rgba(255,255,255,0.1)' }}
            >
              {ACTIVITY_ICONS[entry.type] ?? <Activity size={12} />}
            </div>
            {/* Content */}
            <div className="flex-1 pb-4">
              <div className="text-sm text-text-primary">{entry.label}</div>
              <div className="text-[10px] text-text-muted font-mono mt-0.5">
                {entry.date ? formatDate(entry.date) : '--'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Sub-Tables ─────────────────────────────────────────
const InvoicesTable: React.FC<{ data: any[]; onNavigate?: (id: string) => void }> = ({ data, onNavigate }) => (
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
        <tr
          key={inv.id}
          className={onNavigate ? 'cursor-pointer hover:bg-bg-hover transition-colors' : ''}
          onClick={() => onNavigate?.(inv.id)}
        >
          <td className="font-mono text-text-primary" onClick={(e) => e.stopPropagation()}>
            <EntityChip type="invoice" id={inv.id} label={inv.invoice_number ?? inv.id} variant="inline" />
          </td>
          <td className="text-text-secondary text-xs">{inv.issue_date ?? inv.date ?? inv.created_at ?? '--'}</td>
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
              <span className="capitalize">{inv.status}</span>
            </span>
          </td>
          <td className="font-mono text-text-primary">{formatCurrency(inv.total ?? 0)}</td>
          <td className="font-mono text-text-secondary">{formatCurrency(inv.amount_paid ?? 0)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const ProjectsTable: React.FC<{ data: any[]; onNavigate?: (id: string) => void }> = ({ data, onNavigate }) => (
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
        <tr
          key={p.id}
          className={onNavigate ? 'cursor-pointer hover:bg-bg-hover transition-colors' : ''}
          onClick={() => onNavigate?.(p.id)}
        >
          <td className="text-text-primary font-medium" onClick={(e) => e.stopPropagation()}>
            <EntityChip type="project" id={p.id} label={p.name} variant="inline" />
          </td>
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

const DebtsTable: React.FC<{ data: any[] }> = ({ data }) => (
  <table className="block-table">
    <thead>
      <tr>
        <th>Debtor</th>
        <th>Status</th>
        <th>Original</th>
        <th>Balance</th>
        <th>Due Date</th>
      </tr>
    </thead>
    <tbody>
      {data.map((d) => (
        <tr key={d.id}>
          <td className="text-text-primary font-medium">{d.debtor_name}</td>
          <td>
            <span className={formatStatus(d.status).className}>
              {formatStatus(d.status).label}
            </span>
          </td>
          <td className="font-mono text-text-secondary">{formatCurrency(d.original_amount ?? 0)}</td>
          <td className="font-mono text-text-primary">{formatCurrency(d.balance_due ?? 0)}</td>
          <td className="text-text-secondary text-xs">{d.due_date ?? '--'}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default ClientDetail;
