import React, { useEffect, useState } from 'react';
import { ArrowLeft, Package, Edit } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';

interface VendorDetailProps {
  vendorId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

type Tab = 'expenses' | 'bills';

const VendorDetail: React.FC<VendorDetailProps> = ({ vendorId, onBack, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [vendor, setVendor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('expenses');
  const [tabData, setTabData] = useState<any[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [stats, setStats] = useState({ totalSpend: 0, billCount: 0, expenseCount: 0 });

  useEffect(() => {
    const load = async () => {
      try {
        const v = await api.get('vendors', vendorId);
        setVendor(v);
        // Summary stats
        const [expData, billData] = await Promise.all([
          api.query('expenses', { vendor_id: vendorId, company_id: activeCompany?.id }),
          api.query('bills', { vendor_id: vendorId, company_id: activeCompany?.id }),
        ]);
        const expenses = Array.isArray(expData) ? expData : [];
        const bills = Array.isArray(billData) ? billData : [];
        setStats({
          totalSpend: expenses.reduce((s: number, e: any) => s + (e.amount || 0), 0) + bills.reduce((s: number, b: any) => s + (b.total || 0), 0),
          expenseCount: expenses.length,
          billCount: bills.length,
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
    return <div className="p-8 text-center text-text-muted text-sm">Loading vendor...</div>;
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <button className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Vendors
        </button>
        <button className="block-btn inline-flex items-center gap-1.5" onClick={() => onEdit(vendorId)}>
          <Edit size={14} /> Edit
        </button>
      </div>

      {/* Vendor Card */}
      <div className="block-card p-6" style={{ borderRadius: '6px' }}>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
            <Package size={24} className="text-text-muted" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-text-primary">{vendor.name}</h2>
            <div className="flex items-center gap-4 mt-1 text-xs text-text-muted">
              {vendor.email && <span>{vendor.email}</span>}
              {vendor.phone && <span>{vendor.phone}</span>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold font-mono text-text-primary">{formatCurrency(stats.totalSpend)}</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wider">Total Spend</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-2xl font-bold font-mono text-text-primary">{stats.expenseCount}</p>
          <p className="text-[10px] text-text-muted uppercase tracking-wider">Expenses</p>
        </div>
        <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-2xl font-bold font-mono text-text-primary">{stats.billCount}</p>
          <p className="text-[10px] text-text-muted uppercase tracking-wider">Bills</p>
        </div>
        <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-2xl font-bold font-mono text-accent-expense">{formatCurrency(stats.totalSpend)}</p>
          <p className="text-[10px] text-text-muted uppercase tracking-wider">Total Spend</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['expenses', 'bills'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? 'bg-accent-blue text-white' : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-primary'}`} style={{ borderRadius: '6px' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tabLoading ? (
        <div className="text-center py-8 text-text-muted text-sm">Loading...</div>
      ) : tabData.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">No {tab} found for this vendor.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tabData.map((item: any) => {
                const badge = formatStatus(item.status);
                return (
                  <tr key={item.id}>
                    <td className="text-xs font-mono">{formatDate(item.date || item.issue_date)}</td>
                    <td className="text-text-primary truncate max-w-[300px]">{item.description || item.vendor_name || '\u2014'}</td>
                    <td className="text-right font-mono">{formatCurrency(item.amount || item.total)}</td>
                    <td><span className={badge.className}>{badge.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="vendor" entityId={vendorId} hide={['expenses', 'bills']} />
        <EntityTimeline entityType="vendors" entityId={vendorId} />
      </div>
    </div>
  );
};

export default VendorDetail;
