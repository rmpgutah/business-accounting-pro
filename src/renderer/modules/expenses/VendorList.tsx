import React, { useEffect, useState } from 'react';
import { Building2, Plus, Search } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';
import { formatStatus } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import {
  VENDOR_TYPE, VENDOR_APPROVAL, VENDOR_LOCATION, VENDOR_DIVERSITY,
  ClassificationBadge, ClassificationBadges,
} from '../../lib/classifications';

// ─── Types ──────────────────────────────────────────────
interface Vendor {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  status?: string;
  payment_terms?: number;
  vendor_type?: string;
  approval_status?: string;
  location_type?: string;
  diversity?: string;
}

interface VendorListProps {
  onNew: () => void;
  onEdit: (id: string) => void;
  onView?: (id: string) => void;
}

// ─── Component ──────────────────────────────────────────
const VendorList: React.FC<VendorListProps> = ({ onNew, onEdit, onView }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadVendors = async () => {
    if (!activeCompany) return;
    try {
      setLoadError('');
      const data = await api.query('vendors', { company_id: activeCompany.id });
      setVendors(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to load vendors:', err);
      setLoadError(err?.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVendors();
  }, [activeCompany]);

  const filtered = search
    ? vendors.filter((v) => {
        const q = search.toLowerCase();
        return (
          v.name?.toLowerCase().includes(q) ||
          v.email?.toLowerCase().includes(q) ||
          v.phone?.toLowerCase().includes(q)
        );
      })
    : vendors;

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete vendor "${name}"? This cannot be undone.`)) return;
    try {
      await api.remove('vendors', id);
      setVendors((prev) => prev.filter((v) => v.id !== id));
    } catch (err: any) {
      console.error('Failed to delete vendor:', err);
      alert('Failed to delete vendor: ' + (err?.message || 'Unknown error') +
        '\n\nThis vendor may be referenced by existing expenses or bills.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading vendors...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loadError && <ErrorBanner message={loadError} title="Failed to load vendors" onDismiss={() => setLoadError('')} />}
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <Building2 size={18} className="text-accent-purple" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Vendors</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} vendor{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
          <Plus size={16} />
          New Vendor
        </button>
      </div>

      {/* Search */}
      <div className="block-card p-3">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search vendors..."
            className="block-input pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Building2 size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">
            {vendors.length === 0 ? 'No vendors yet' : 'No vendors match your search'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {vendors.length === 0
              ? 'Add your first vendor to get started.'
              : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Type</th>
                <th>Approval</th>
                <th>Location</th>
                <th>Diversity</th>
                <th>Payment Terms</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id}>
                  <td className="text-text-primary font-medium truncate max-w-[200px]">
                    {onView ? (
                      <button
                        className="hover:text-accent-blue transition-colors text-left"
                        onClick={() => onView(v.id)}
                      >
                        {v.name}
                      </button>
                    ) : v.name}
                  </td>
                  <td className="text-text-secondary truncate max-w-[200px]">{v.email || '-'}</td>
                  <td className="text-text-secondary font-mono text-xs">{v.phone || '-'}</td>
                  <td>
                    <span className={formatStatus(v.status).className}>
                      {formatStatus(v.status).label}
                    </span>
                  </td>
                  <td><ClassificationBadge def={VENDOR_TYPE} value={v.vendor_type} /></td>
                  <td><ClassificationBadge def={VENDOR_APPROVAL} value={v.approval_status} /></td>
                  <td><ClassificationBadge def={VENDOR_LOCATION} value={v.location_type} /></td>
                  <td><ClassificationBadges def={VENDOR_DIVERSITY} values={v.diversity} /></td>
                  <td className="text-text-secondary">{v.payment_terms ? `Net ${v.payment_terms}` : '-'}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="block-btn px-3 py-1 text-xs"
                        onClick={() => onEdit(v.id)}
                      >
                        Edit
                      </button>
                      <button
                        className="block-btn-danger px-3 py-1 text-xs"
                        onClick={() => handleDelete(v.id, v.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default VendorList;
