import React, { useState } from 'react';
import { Building2, ArrowRight } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import api from '../../lib/api';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CompanySetup: React.FC = () => {
  const setCompanies = useCompanyStore((s) => s.setCompanies);
  const setActiveCompany = useCompanyStore((s) => s.setActiveCompany);
  const authUser = useAuthStore((s) => s.user);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [taxId, setTaxId] = useState('');
  const [fiscalYearStart, setFiscalYearStart] = useState(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    try {
      const company = await api.createCompany({
        name: name.trim(),
        legal_name: legalName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address_line1: address.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim(),
        tax_id: taxId.trim(),
        fiscal_year_start: fiscalYearStart,
      });
      // Link company to current user
      if (authUser?.id) {
        await api.linkUserCompany(authUser.id, company.id, 'owner');
      }
      await api.switchCompany(company.id);
      const companies = await api.listCompanies();
      setCompanies(companies);
      setActiveCompany(company);
    } catch (err: any) {
      console.error('Failed to create company:', err);
      setError(err?.message || 'Failed to create company');
    } finally {
      setSubmitting(false);
    }
  };

  const labelClass = 'text-xs font-semibold text-text-muted uppercase tracking-wider mb-1 block';

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', padding: '24px' }}>
      {/* Drag region at the top of the window for macOS hiddenInset title bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '38px', WebkitAppRegion: 'drag' as any, zIndex: 10 }} />
      <div style={{ width: '100%', maxWidth: '640px', background: '#141414', border: '1px solid #2e2e2e', padding: '32px', borderRadius: '6px' }}>
        {/* Logo & Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', background: '#3b82f6', marginBottom: '16px', borderRadius: '6px' }}>
            <Building2 size={28} color="white" />
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#f0f0f0' }}>Business Accounting Pro</h1>
          <p style={{ fontSize: '14px', color: '#a0a0a0', marginTop: '4px' }}>Set up your company to get started</p>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', marginBottom: '16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '13px', borderRadius: '6px' }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label className={labelClass}>Company Name <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              type="text"
              className="block-input"
              style={{ width: '100%' }}
              placeholder="Acme Corp"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className={labelClass}>Legal Name</label>
            <input
              type="text"
              className="block-input"
              style={{ width: '100%' }}
              placeholder="Acme Corporation LLC"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="hello@acme.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input
                type="tel"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className={labelClass}>Address</label>
            <input
              type="text"
              className="block-input"
              style={{ width: '100%' }}
              placeholder="123 Main Street"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label className={labelClass}>City</label>
              <input
                type="text"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="New York"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>State</label>
              <input
                type="text"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="NY"
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>ZIP</label>
              <input
                type="text"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="10001"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
            <div>
              <label className={labelClass}>Tax ID (EIN)</label>
              <input
                type="text"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="XX-XXXXXXX"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Fiscal Year Start</label>
              <select
                className="block-select"
                style={{ width: '100%' }}
                value={fiscalYearStart}
                onChange={(e) => setFiscalYearStart(Number(e.target.value))}
              >
                {MONTHS.map((month, i) => (
                  <option key={month} value={i + 1}>{month}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="block-btn-primary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: (!name.trim() || submitting) ? 0.5 : 1 }}
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
