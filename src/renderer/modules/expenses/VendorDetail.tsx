import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Package, Edit, Trash2, Globe, Phone, Mail,
  MapPin, CreditCard, FileText, Receipt, TrendingDown,
  Calendar, Hash, AlertCircle, Building2,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';

interface VendorDetailProps {
  vendorId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
  onDeleted?: () => void;
}

type Tab = 'expenses' | 'bills';

const VendorDetail: React.FC<VendorDetailProps> = ({ vendorId, onBack, onEdit, onDeleted }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [vendor, setVendor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('expenses');
  const [tabData, setTabData] = useState<any[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [stats, setStats] = useState({
    totalSpend: 0, billCount: 0, expenseCount: 0,
    avgExpense: 0, lastDate: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const v = await api.get('vendors', vendorId);
        setVendor(v);
        const [expData, billData] = await Promise.all([
          api.query('expenses', { vendor_id: vendorId, company_id: activeCompany?.id }),
          api.query('bills', { vendor_id: vendorId, company_id: activeCompany?.id }),
        ]);
        const expenses = Array.isArray(expData) ? expData : [];
        const bills = Array.isArray(billData) ? billData : [];
        const totalSpend =
          expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0) +
          bills.reduce((s: number, b: any) => s + (Number(b.total) || 0), 0);
        const allDates = [...expenses.map((e: any) => e.date), ...bills.map((b: any) => b.issue_date)]
          .filter(Boolean).sort().reverse();
        setStats({
          totalSpend,
          expenseCount: expenses.length,
          billCount: bills.length,
          avgExpense: expenses.length > 0
            ? expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0) / expenses.length
            : 0,
          lastDate: allDates[0] ?? '',
        });
      } catch (err) {
        console.error('Failed to load vendor:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [vendorId, activeCompany]);

  useEffect(() => {
    if (!activeCompany) return;
    setTabLoading(true);
    const table = tab === 'expenses' ? 'expenses' : 'bills';
    api.query(table, { vendor_id: vendorId, company_id: activeCompany.id }, { field: 'date', dir: 'desc' })
      .then(r => setTabData(Array.isArray(r) ? r : []))
      .catch(() => setTabData([]))
      .finally(() => setTabLoading(false));
  }, [tab, vendorId, activeCompany]);

  if (loading || !vendor) {
    return <div className="p-8 text-center text-text-muted text-sm">Loading vendor…</div>;
  }

  const handleDelete = async () => {
    if (!window.confirm(
      `Delete vendor "${vendor.name}"?\n\nIt will move to Trash (recoverable for 30 days). ` +
      `Linked expenses, bills, POs, and bank rules will be unlinked.`
    )) return;
    const res = await api.vendorDelete(vendorId, false);
    if (res?.error) { alert('Failed to delete vendor: ' + res.error); return; }
    onDeleted ? onDeleted() : onBack();
  };

  const hasLogo = vendor.logo_data && /^data:image\//i.test(String(vendor.logo_data));
  const addressParts = [vendor.address].filter(Boolean);

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">

      {/* ── Top nav ── */}
      <div className="flex items-center justify-between">
        <button
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          onClick={onBack}
        >
          <ArrowLeft size={16} /> Back to Vendors
        </button>
        <div className="flex items-center gap-2">
          <button className="block-btn inline-flex items-center gap-1.5 text-xs" onClick={() => onEdit(vendorId)}>
            <Edit size={13} /> Edit
          </button>
          <button className="block-btn-danger inline-flex items-center gap-1.5 text-xs" onClick={handleDelete}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>

      {/* ── Hero card ── */}
      <div className="block-card overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
        {/* Accent stripe */}
        <div className="h-1 w-full" style={{ background: 'var(--accent-primary)' }} />

        <div className="p-6 flex items-start gap-5">
          {/* Logo / avatar */}
          <div
            className="flex-shrink-0 w-16 h-16 flex items-center justify-center bg-bg-elevated border border-border-primary overflow-hidden"
            style={{ borderRadius: 'var(--app-radius)' }}
          >
            {hasLogo ? (
              <img
                src={vendor.logo_data}
                alt={vendor.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-2xl font-bold text-text-muted">
                {vendor.name?.[0]?.toUpperCase() ?? <Package size={28} />}
              </span>
            )}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-text-primary truncate">{vendor.name}</h2>
              {vendor.status && (
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 ${
                  vendor.status === 'active'
                    ? 'bg-accent-income/10 text-accent-income border border-accent-income/20'
                    : 'bg-bg-elevated text-text-muted border border-border-primary'
                }`} style={{ borderRadius: 'var(--app-radius)' }}>
                  {vendor.status}
                </span>
              )}
              {vendor.vendor_type && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 bg-bg-elevated text-text-muted border border-border-primary"
                  style={{ borderRadius: 'var(--app-radius)' }}>
                  {vendor.vendor_type}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-text-muted">
              {vendor.email && (
                <span className="inline-flex items-center gap-1"><Mail size={11} />{vendor.email}</span>
              )}
              {vendor.phone && (
                <span className="inline-flex items-center gap-1"><Phone size={11} />{vendor.phone}</span>
              )}
              {vendor.website && (
                <span className="inline-flex items-center gap-1"><Globe size={11} />{vendor.website}</span>
              )}
              {addressParts.length > 0 && (
                <span className="inline-flex items-center gap-1"><MapPin size={11} />{addressParts.join(', ')}</span>
              )}
            </div>
          </div>

          {/* Total spend */}
          <div className="flex-shrink-0 text-right pl-4 border-l border-border-primary">
            <p className="text-3xl font-bold font-mono" style={{ color: 'var(--color-accent-expense)' }}>
              {formatCurrency(stats.totalSpend)}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mt-0.5">Total Spend</p>
          </div>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Expenses', value: stats.expenseCount.toString(), icon: <Receipt size={14} className="text-text-muted" />, color: 'text-text-primary' },
          { label: 'Bills', value: stats.billCount.toString(), icon: <FileText size={14} className="text-text-muted" />, color: 'text-text-primary' },
          { label: 'Avg Expense', value: formatCurrency(stats.avgExpense), icon: <TrendingDown size={14} className="text-accent-expense" />, color: 'text-accent-expense' },
          { label: 'Last Activity', value: stats.lastDate ? formatDate(stats.lastDate) : '—', icon: <Calendar size={14} className="text-text-muted" />, color: 'text-text-secondary' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="block-card p-4 flex items-start gap-3" style={{ borderRadius: 'var(--app-radius)' }}>
            <div className="mt-0.5">{icon}</div>
            <div className="min-w-0">
              <p className={`text-base font-bold font-mono truncate ${color}`}>{value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main content: tab list (left) + vendor info sidebar (right) ── */}
      <div className="grid grid-cols-[1fr_260px] gap-4 items-start">

        {/* Left: tabs + table */}
        <div className="space-y-3 min-w-0">
          {/* Tab buttons */}
          <div className="flex gap-1 border-b border-border-primary pb-0">
            {(['expenses', 'bills'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 -mb-px transition-colors ${
                  tab === t
                    ? 'text-accent-primary border-accent-primary'
                    : 'text-text-muted border-transparent hover:text-text-secondary'
                }`}
              >
                {t === 'expenses' ? <Receipt size={12} /> : <FileText size={12} />}
                {t}
                <span className={`ml-1 text-[10px] font-bold px-1.5 py-0 rounded-full ${
                  tab === t ? 'bg-accent-primary/15 text-accent-primary' : 'bg-bg-elevated text-text-muted'
                }`}>
                  {t === 'expenses' ? stats.expenseCount : stats.billCount}
                </span>
              </button>
            ))}
          </div>

          {/* Table */}
          {tabLoading ? (
            <div className="py-10 text-center text-sm text-text-muted">Loading…</div>
          ) : tabData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2">
              <div className="w-10 h-10 flex items-center justify-center bg-bg-elevated border border-border-primary" style={{ borderRadius: 'var(--app-radius)' }}>
                {tab === 'expenses' ? <Receipt size={18} className="text-text-muted" /> : <FileText size={18} className="text-text-muted" />}
              </div>
              <p className="text-sm text-text-muted">No {tab} for this vendor</p>
            </div>
          ) : (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    {tab === 'expenses' && <th>Category</th>}
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tabData.map((item: any) => {
                    const badge = formatStatus(item.status);
                    return (
                      <tr key={item.id}>
                        <td className="text-xs font-mono text-text-muted whitespace-nowrap">
                          {formatDate(item.date || item.issue_date)}
                        </td>
                        <td className="text-text-primary text-sm truncate max-w-[200px]">
                          {item.description || '—'}
                        </td>
                        {tab === 'expenses' && (
                          <td className="text-xs text-text-muted">{item.category_name || item.category || '—'}</td>
                        )}
                        <td className="text-right font-mono font-semibold text-sm">
                          <span style={{ color: 'var(--color-accent-expense)' }}>
                            {formatCurrency(item.amount || item.total)}
                          </span>
                        </td>
                        <td><span className={badge.className}>{badge.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: vendor details sidebar */}
        <div className="space-y-3">
          <div className="block-card p-4 space-y-3" style={{ borderRadius: 'var(--app-radius)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Vendor Details</p>
            <div className="space-y-2.5">
              {[
                vendor.tax_id && { icon: <Hash size={12} />, label: 'Tax ID', value: vendor.tax_id },
                vendor.payment_terms && { icon: <CreditCard size={12} />, label: 'Net Terms', value: `Net ${vendor.payment_terms}` },
                vendor.currency && vendor.currency !== 'USD' && { icon: <Building2 size={12} />, label: 'Currency', value: vendor.currency },
                vendor.credit_limit && { icon: <AlertCircle size={12} />, label: 'Credit Limit', value: formatCurrency(Number(vendor.credit_limit)) },
                vendor.w9_status && { icon: <FileText size={12} />, label: 'W-9 Status', value: vendor.w9_status.replace(/_/g, ' ') },
                vendor.preferred_payment_method && { icon: <CreditCard size={12} />, label: 'Pay Method', value: vendor.preferred_payment_method.replace(/_/g, ' ') },
              ].filter(Boolean).map((row: any) => (
                <div key={row.label} className="flex items-start gap-2">
                  <span className="mt-0.5 text-text-muted">{row.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[10px] text-text-muted uppercase tracking-wide">{row.label}</p>
                    <p className="text-xs text-text-primary font-medium capitalize">{row.value}</p>
                  </div>
                </div>
              ))}
              {/* Show placeholder when no details available */}
              {!vendor.tax_id && !vendor.payment_terms && !vendor.credit_limit && (
                <p className="text-xs text-text-muted italic">No additional details on file.</p>
              )}
            </div>
          </div>

          {vendor.notes && (
            <div className="block-card p-4 space-y-1.5" style={{ borderRadius: 'var(--app-radius)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Notes</p>
              <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">{vendor.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Cross-integration panels ── */}
      <div className="grid grid-cols-2 gap-4">
        <RelatedPanel entityType="vendor" entityId={vendorId} hide={['expenses', 'bills']} />
        <EntityTimeline entityType="vendor" entityId={vendorId} />
      </div>
    </div>
  );
};

export default VendorDetail;
