import React, { useEffect, useState } from 'react';
import { Tag, Plus, X } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface TaxCategory {
  id: string;
  name: string;
  description: string;
  schedule_c_line: string;
  is_deductible: boolean;
}

// ─── Default Categories ─────────────────────────────────
const DEFAULT_CATEGORIES: Omit<TaxCategory, 'id'>[] = [
  { name: 'Advertising', description: 'Marketing and advertising expenses', schedule_c_line: 'Line 8', is_deductible: true },
  { name: 'Car & Truck Expenses', description: 'Vehicle expenses for business use', schedule_c_line: 'Line 9', is_deductible: true },
  { name: 'Insurance', description: 'Business insurance premiums', schedule_c_line: 'Line 15', is_deductible: true },
  { name: 'Legal & Professional', description: 'Legal, accounting, and professional fees', schedule_c_line: 'Line 17', is_deductible: true },
  { name: 'Office Expenses', description: 'Office supplies and postage', schedule_c_line: 'Line 18', is_deductible: true },
  { name: 'Rent or Lease', description: 'Rent for business property', schedule_c_line: 'Line 20b', is_deductible: true },
  { name: 'Supplies', description: 'Materials and supplies consumed', schedule_c_line: 'Line 22', is_deductible: true },
  { name: 'Travel', description: 'Business travel expenses', schedule_c_line: 'Line 24a', is_deductible: true },
  { name: 'Utilities', description: 'Phone, internet, electricity for business', schedule_c_line: 'Line 25', is_deductible: true },
  { name: 'Wages', description: 'Wages paid to employees', schedule_c_line: 'Line 26', is_deductible: true },
];

// ─── Component ──────────────────────────────────────────
const TaxCategories: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [categories, setCategories] = useState<TaxCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    schedule_c_line: '',
    is_deductible: true,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadCategories = async () => {
    if (!activeCompany) return;
    try {
      const data = await api.query('tax_categories', { company_id: activeCompany.id });
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load tax categories:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, [activeCompany]);

  const seedDefaults = async () => {
    try {
      for (const cat of DEFAULT_CATEGORIES) {
        await api.create('tax_categories', cat);
      }
      await loadCategories();
    } catch (err) {
      console.error('Failed to seed defaults:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFormError('Category name is required.');
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await api.create('tax_categories', formData);
      setFormData({ name: '', description: '', schedule_c_line: '', is_deductible: true });
      setFormError('');
      setShowForm(false);
      await loadCategories();
    } catch (err) {
      console.error('Failed to create tax category:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading tax categories...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <Tag size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Tax Categories</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {categories.length === 0 && (
            <button
              className="block-btn flex items-center gap-2 text-xs"
              onClick={seedDefaults}
            >
              Seed Defaults
            </button>
          )}
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={() => setShowForm(true)}
          >
            <Plus size={16} />
            Add Category
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="block-card p-5" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-primary">New Tax Category</h3>
            <button
              className="text-text-muted hover:text-text-primary"
              onClick={() => setShowForm(false)}
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            {formError && (
              <div
                className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20"
                style={{ borderRadius: '6px' }}
              >
                {formError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  className="block-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Category name"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Schedule C Line
                </label>
                <input
                  type="text"
                  className="block-input"
                  value={formData.schedule_c_line}
                  onChange={(e) => setFormData({ ...formData, schedule_c_line: e.target.value })}
                  placeholder="e.g. Line 8"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Description
              </label>
              <input
                type="text"
                className="block-input"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_deductible"
                checked={formData.is_deductible}
                onChange={(e) => setFormData({ ...formData, is_deductible: e.target.checked })}
                style={{ borderRadius: '6px' }}
              />
              <label htmlFor="is_deductible" className="text-sm text-text-secondary">
                Is Deductible
              </label>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                className="block-btn-primary"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Category'}
              </button>
              <button
                type="button"
                className="block-btn"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {categories.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Tag size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No tax categories</p>
          <p className="text-xs text-text-muted mt-1">
            Add categories or seed the defaults to get started.
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Schedule C Line</th>
                <th className="text-center">Deductible</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td className="text-text-primary font-medium text-sm">{cat.name}</td>
                  <td className="text-text-secondary text-sm">{cat.description || '-'}</td>
                  <td className="font-mono text-text-secondary text-xs">
                    {cat.schedule_c_line || '-'}
                  </td>
                  <td className="text-center">
                    {cat.is_deductible ? (
                      <span className="text-accent-income">&#10003;</span>
                    ) : (
                      <span className="text-text-muted">&#10005;</span>
                    )}
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

export default TaxCategories;
