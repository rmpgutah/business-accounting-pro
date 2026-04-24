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
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('(801) 888-2257');
  const [address, setAddress] = useState('2966 S 200 E');
  const [city, setCity] = useState('South Salt Lake');
  const [state, setState] = useState('UT');
  const [zip, setZip] = useState('84115');
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
      // Link company to current user (gracefully handle stale auth)
      if (authUser?.id) {
        try {
          await api.linkUserCompany(authUser.id, company.id, 'owner');
        } catch (linkErr: any) {
          // FK constraint = user doesn't exist in DB. Verify and re-link.
          if (linkErr?.message?.includes('FOREIGN KEY')) {
            const users = await api.rawQuery('SELECT id FROM users LIMIT 1');
            if (users && (users as any[]).length > 0) {
              await api.linkUserCompany((users as any[])[0].id, company.id, 'owner');
            }
          } else {
            throw linkErr;
          }
        }
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

  const handleSkip = async () => {
    if (skipping) return;
    setSkipping(true);
    setError('');
    try {
      const defaultName = authUser?.display_name ? `${authUser.display_name.split(' ')[0]}'s Business` : 'My Company';
      const company = await api.createCompany({ name: defaultName, fiscal_year_start: 1 });
      if (authUser?.id) {
        await api.linkUserCompany(authUser.id, company.id, 'owner').catch(() => {});
      }
      await api.switchCompany(company.id);
      const companies = await api.listCompanies();
      setCompanies(companies);
      setActiveCompany(company);
    } catch (err: any) {
      setError(err?.message || 'Failed to skip setup');
      setSkipping(false);
    }
  };

  const labelClass = 'text-xs font-semibold text-text-muted uppercase tracking-wider mb-1 block';

  return (
    <div
      className="flex items-center justify-center min-h-screen p-6"
      style={{ background: 'var(--color-bg-primary-solid)' }}
    >
      {/* Drag region at the top of the window for macOS hiddenInset title bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '38px', WebkitAppRegion: 'drag' as any, zIndex: 10 }} />
      <div
        className="w-full p-8"
        style={{
          maxWidth: '640px',
          background: 'var(--color-bg-secondary-solid)',
          border: '1px solid var(--color-border-primary)',
          borderRadius: '8px',
        }}
      >
        {/* Logo & Header */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="flex items-center justify-center mb-4"
            style={{
              width: '56px',
              height: '56px',
              background: 'var(--color-accent-blue)',
              borderRadius: '8px',
            }}
          >
            <Building2 size={28} color="white" />
          </div>
          <h1 className="text-xl font-bold text-text-primary">Business Accounting Pro</h1>
          <p className="text-sm text-text-secondary mt-1">Set up your company to get started</p>
        </div>

        {error && (
          <div
            className="mb-4 text-accent-expense text-sm"
            style={{
              padding: '10px 14px',
              background: 'var(--color-accent-expense-bg)',
              border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: '6px',
            }}
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label className={labelClass}>Company Name <span className="text-accent-expense">*</span></label>
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
            disabled={!name.trim() || submitting || skipping}
            className="block-btn-primary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: (!name.trim() || submitting || skipping) ? 0.5 : 1 }}
          >
            {submitting ? 'Creating...' : 'Create Company & Get Started'}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>

        {/* Skip setup — creates a placeholder company and goes straight to the app */}
        <div style={{ textAlign: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #1e1e1e' }}>
          <span style={{ fontSize: '13px', color: '#5a5a5a' }}>Don't have details handy? </span>
          <button
            onClick={handleSkip}
            disabled={skipping || submitting}
            style={{ background: 'none', border: 'none', color: '#5a5a5a', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', opacity: skipping ? 0.5 : 1, transition: 'color 0.2s' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#a0a0a0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#5a5a5a'; }}
          >
            {skipping ? 'Setting up...' : 'Skip setup'}
          </button>
          <span style={{ fontSize: '12px', color: '#3a3a3a', display: 'block', marginTop: '4px' }}>
            You can fill in company details later in Settings
          </span>
        </div>
      </div>
    </div>
  );
};

export default CompanySetup;
