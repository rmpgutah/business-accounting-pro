import React, { useState } from 'react';
import { Building2, ArrowRight } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import api from '../../lib/api';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface FormData {
  name: string;
  legal_name: string;
  email: string;
  phone: string;
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  tax_id: string;
  fiscal_year_start: number;
}

const CompanySetup: React.FC = () => {
  const { setCompanies, setActiveCompany } = useCompanyStore();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormData>({
    name: '',
    legal_name: '',
    email: '',
    phone: '',
    address_line1: '',
    city: '',
    state: '',
    zip: '',
    tax_id: '',
    fiscal_year_start: 1,
  });

  const set = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const value = field === 'fiscal_year_start' ? Number(e.target.value) : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || submitting) return;

    setSubmitting(true);
    try {
      const company = await api.createCompany(form);
      await api.switchCompany(company.id);
      const companies = await api.listCompanies();
      setCompanies(companies);
      setActiveCompany(company);
    } catch (err) {
      console.error('Failed to create company:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const labelClass = 'text-xs font-semibold text-text-muted uppercase tracking-wider mb-1 block';

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg-primary p-6">
      <div
        className="w-full max-w-2xl bg-bg-secondary border border-border-primary p-8"
        style={{ borderRadius: '2px' }}
      >
        {/* Logo & Header */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="flex items-center justify-center w-14 h-14 bg-accent-blue mb-4"
            style={{ borderRadius: '2px' }}
          >
            <Building2 size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-text-primary">Business Accounting Pro</h1>
          <p className="text-sm text-text-secondary mt-1">
            Set up your company to get started
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Company Name */}
          <div>
            <label className={labelClass}>
              Company Name <span className="text-accent-expense">*</span>
            </label>
            <input
              type="text"
              className="block-input w-full"
              placeholder="Acme Corp"
              value={form.name}
              onChange={set('name')}
              required
            />
          </div>

          {/* Legal Name */}
          <div>
            <label className={labelClass}>Legal Name</label>
            <input
              type="text"
              className="block-input w-full"
              placeholder="Acme Corporation LLC"
              value={form.legal_name}
              onChange={set('legal_name')}
            />
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                className="block-input w-full"
                placeholder="hello@acme.com"
                value={form.email}
                onChange={set('email')}
              />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input
                type="tel"
                className="block-input w-full"
                placeholder="(555) 123-4567"
                value={form.phone}
                onChange={set('phone')}
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className={labelClass}>Address</label>
            <input
              type="text"
              className="block-input w-full"
              placeholder="123 Main Street"
              value={form.address_line1}
              onChange={set('address_line1')}
            />
          </div>

          {/* City / State / ZIP */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>City</label>
              <input
                type="text"
                className="block-input w-full"
                placeholder="New York"
                value={form.city}
                onChange={set('city')}
              />
            </div>
            <div>
              <label className={labelClass}>State</label>
              <input
                type="text"
                className="block-input w-full"
                placeholder="NY"
                value={form.state}
                onChange={set('state')}
              />
            </div>
            <div>
              <label className={labelClass}>ZIP</label>
              <input
                type="text"
                className="block-input w-full"
                placeholder="10001"
                value={form.zip}
                onChange={set('zip')}
              />
            </div>
          </div>

          {/* Tax ID & Fiscal Year */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Tax ID (EIN)</label>
              <input
                type="text"
                className="block-input w-full"
                placeholder="XX-XXXXXXX"
                value={form.tax_id}
                onChange={set('tax_id')}
              />
            </div>
            <div>
              <label className={labelClass}>Fiscal Year Start</label>
              <select
                className="block-select w-full"
                value={form.fiscal_year_start}
                onChange={set('fiscal_year_start')}
              >
                {MONTHS.map((month, i) => (
                  <option key={month} value={i + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!form.name.trim() || submitting}
            className="block-btn-primary w-full flex items-center justify-center gap-2 mt-6"
          >
            {submitting ? 'Creating...' : 'Create Company & Get Started'}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CompanySetup;
