import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  Plus,
  ArrowRightLeft,
  CheckCircle,
  X,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface Company {
  id: string;
  name: string;
  legal_name: string;
  tax_id: string;
  created_at: string;
}

// ─── Multi-Company Component ────────────────────────────
const MultiCompany: React.FC = () => {
  const { activeCompany, setActiveCompany, setCompanies } = useCompanyStore();
  const [companies, setLocalCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    legal_name: '',
    tax_id: '',
    industry: '',
    fiscal_year_end: '12',
    base_currency: 'USD',
  });
  const [creating, setCreating] = useState(false);

  const loadCompanies = useCallback(async () => {
    try {
      const result = await api.listCompanies();
      const list: Company[] = result ?? [];
      setLocalCompanies(list);
      setCompanies(list as any);
    } catch (err) {
      console.error('Failed to load companies:', err);
    } finally {
      setLoading(false);
    }
  }, [setCompanies]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const handleSwitch = async (company: Company) => {
    setSwitching(company.id);
    try {
      await api.switchCompany(company.id);
      setActiveCompany(company as any);
    } catch (err) {
      console.error('Failed to switch company:', err);
    } finally {
      setSwitching(null);
    }
  };

  const handleCreate = async () => {
    if (!formData.name) return;
    setCreating(true);
    try {
      await api.createCompany({
        name: formData.name,
        legal_name: formData.legal_name,
        tax_id: formData.tax_id,
        industry: formData.industry,
        fiscal_year_end: formData.fiscal_year_end,
        base_currency: formData.base_currency,
      });
      setFormData({
        name: '',
        legal_name: '',
        tax_id: '',
        industry: '',
        fiscal_year_end: '12',
        base_currency: 'USD',
      });
      setShowForm(false);
      await loadCompanies();
    } catch (err) {
      console.error('Failed to create company:', err);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <span className="text-text-muted text-sm">Loading companies...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-2">
          <Building2 size={20} className="text-accent-blue" />
          <h1 className="module-title">Company Management</h1>
        </div>
        <div className="module-actions">
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Cancel' : 'New Company'}
          </button>
        </div>
      </div>

      {/* New Company Form (inline) */}
      {showForm && (
        <div className="block-card p-5" style={{ borderColor: 'var(--color-accent-blue)' }}>
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Create New Company
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider block mb-1">
                Company Name *
              </label>
              <input
                className="block-input"
                placeholder="Acme Corp"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider block mb-1">
                Legal Name
              </label>
              <input
                className="block-input"
                placeholder="Acme Corporation LLC"
                value={formData.legal_name}
                onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider block mb-1">
                Tax ID (EIN)
              </label>
              <input
                className="block-input"
                placeholder="XX-XXXXXXX"
                value={formData.tax_id}
                onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider block mb-1">
                Industry
              </label>
              <input
                className="block-input"
                placeholder="Technology, Consulting, etc."
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider block mb-1">
                Fiscal Year End
              </label>
              <select
                className="block-select"
                value={formData.fiscal_year_end}
                onChange={(e) => setFormData({ ...formData, fiscal_year_end: e.target.value })}
              >
                <option value="1">January</option>
                <option value="2">February</option>
                <option value="3">March</option>
                <option value="4">April</option>
                <option value="5">May</option>
                <option value="6">June</option>
                <option value="7">July</option>
                <option value="8">August</option>
                <option value="9">September</option>
                <option value="10">October</option>
                <option value="11">November</option>
                <option value="12">December</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider block mb-1">
                Base Currency
              </label>
              <select
                className="block-select"
                value={formData.base_currency}
                onChange={(e) => setFormData({ ...formData, base_currency: e.target.value })}
              >
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="GBP">GBP - British Pound</option>
                <option value="CAD">CAD - Canadian Dollar</option>
                <option value="AUD">AUD - Australian Dollar</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button
              className="block-btn-success flex items-center gap-2"
              onClick={handleCreate}
              disabled={!formData.name || creating}
              style={{ opacity: !formData.name || creating ? 0.5 : 1 }}
            >
              <Plus size={14} />
              {creating ? 'Creating...' : 'Create Company'}
            </button>
          </div>
        </div>
      )}

      {/* Companies List */}
      {companies.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Building2 size={24} className="text-text-muted" />
          </div>
          <p className="text-text-muted text-sm">No companies configured</p>
          <p className="text-text-muted text-xs mt-1">
            Create your first company to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {companies.map((company) => {
            const isActive = activeCompany?.id === company.id;
            return (
              <div
                key={company.id}
                className="block-card p-4 flex items-center justify-between"
                style={{
                  borderColor: isActive
                    ? 'var(--color-accent-blue)'
                    : 'var(--color-border-primary)',
                  borderWidth: isActive ? '2px' : '1px',
                }}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  {/* Icon */}
                  <div
                    className="flex items-center justify-center shrink-0"
                    style={{
                      width: '40px',
                      height: '40px',
                      backgroundColor: isActive
                        ? 'var(--color-accent-blue-bg)'
                        : 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border-primary)',
                      borderRadius: '2px',
                    }}
                  >
                    <Building2
                      size={18}
                      style={{
                        color: isActive
                          ? 'var(--color-accent-blue)'
                          : 'var(--color-text-muted)',
                      }}
                    />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary truncate">
                        {company.name}
                      </span>
                      {isActive && (
                        <span className="block-badge block-badge-blue">
                          <CheckCircle size={10} className="mr-1" />
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-0.5">
                      {company.legal_name && (
                        <span className="text-xs text-text-muted">
                          {company.legal_name}
                        </span>
                      )}
                      {company.tax_id && (
                        <span className="text-xs text-text-muted font-mono">
                          EIN: {company.tax_id}
                        </span>
                      )}
                      {company.created_at && (
                        <span className="text-xs text-text-muted">
                          Created: {new Date(company.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Switch Button */}
                {!isActive && (
                  <button
                    className="block-btn flex items-center gap-2 shrink-0 ml-4"
                    onClick={() => handleSwitch(company)}
                    disabled={switching === company.id}
                    style={{ opacity: switching === company.id ? 0.6 : 1 }}
                  >
                    <ArrowRightLeft size={14} />
                    {switching === company.id ? 'Switching...' : 'Switch'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MultiCompany;
