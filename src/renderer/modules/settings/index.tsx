import React, { useState, useEffect } from 'react';
import { Settings, Building2, DollarSign, Mail, CreditCard, Database, Download, Upload } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

export default function SettingsModule() {
  const { activeCompany } = useCompanyStore();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [companyForm, setCompanyForm] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
    if (activeCompany) setCompanyForm({ ...activeCompany });
  }, [activeCompany]);

  const loadSettings = async () => {
    try {
      const data = await api.query('settings');
      const map: Record<string, string> = {};
      for (const s of data) map[s.key] = s.value;
      setSettings(map);
    } catch { /* empty */ }
  };

  const saveSetting = async (key: string, value: string) => {
    try {
      const existing = await api.query('settings', { key });
      if (existing.length > 0) {
        await api.update('settings', existing[0].id, { value });
      } else {
        await api.create('settings', { key, value });
      }
      setSettings((prev) => ({ ...prev, [key]: value }));
      flashSaved();
    } catch { /* empty */ }
  };

  const saveCompany = async () => {
    if (!activeCompany) return;
    try {
      await api.updateCompany(activeCompany.id, companyForm);
      flashSaved();
    } catch { /* empty */ }
  };

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const sections = [
    {
      icon: Building2,
      title: 'Company Profile',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Company Name</label>
              <input className="block-input" value={companyForm.name || ''} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Legal Name</label>
              <input className="block-input" value={companyForm.legal_name || ''} onChange={(e) => setCompanyForm({ ...companyForm, legal_name: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Email</label>
              <input className="block-input" value={companyForm.email || ''} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Phone</label>
              <input className="block-input" value={companyForm.phone || ''} onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Address</label>
            <input className="block-input" value={companyForm.address_line1 || ''} onChange={(e) => setCompanyForm({ ...companyForm, address_line1: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">City</label>
              <input className="block-input" value={companyForm.city || ''} onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">State</label>
              <input className="block-input" value={companyForm.state || ''} onChange={(e) => setCompanyForm({ ...companyForm, state: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">ZIP</label>
              <input className="block-input" value={companyForm.zip || ''} onChange={(e) => setCompanyForm({ ...companyForm, zip: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Tax ID (EIN)</label>
              <input className="block-input" value={companyForm.tax_id || ''} onChange={(e) => setCompanyForm({ ...companyForm, tax_id: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Fiscal Year Start</label>
              <select className="block-select" value={companyForm.fiscal_year_start || 1} onChange={(e) => setCompanyForm({ ...companyForm, fiscal_year_start: parseInt(e.target.value) })}>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <button className="block-btn-primary" onClick={saveCompany}>Save Company Profile</button>
        </div>
      ),
    },
    {
      icon: DollarSign,
      title: 'Tax Rates',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Federal Tax Rate (%)</label>
              <input className="block-input" type="number" step="0.1" value={settings.tax_federal_rate || '22'} onChange={(e) => updateSetting('tax_federal_rate', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">State Tax Rate (%)</label>
              <input className="block-input" type="number" step="0.1" value={settings.tax_state_rate || '5'} onChange={(e) => updateSetting('tax_state_rate', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Self-Employment (%)</label>
              <input className="block-input" type="number" step="0.1" value={settings.tax_se_rate || '15.3'} onChange={(e) => updateSetting('tax_se_rate', e.target.value)} />
            </div>
          </div>
          <button className="block-btn-primary" onClick={() => {
            saveSetting('tax_federal_rate', settings.tax_federal_rate || '22');
            saveSetting('tax_state_rate', settings.tax_state_rate || '5');
            saveSetting('tax_se_rate', settings.tax_se_rate || '15.3');
          }}>Save Tax Rates</button>
        </div>
      ),
    },
    {
      icon: Mail,
      title: 'Email (SMTP) Configuration',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">SMTP Host</label>
              <input className="block-input" placeholder="smtp.gmail.com" value={settings.smtp_host || ''} onChange={(e) => updateSetting('smtp_host', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">SMTP Port</label>
              <input className="block-input" placeholder="587" value={settings.smtp_port || ''} onChange={(e) => updateSetting('smtp_port', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Username</label>
              <input className="block-input" value={settings.smtp_username || ''} onChange={(e) => updateSetting('smtp_username', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Password</label>
              <input className="block-input" type="password" value={settings.smtp_password || ''} onChange={(e) => updateSetting('smtp_password', e.target.value)} />
            </div>
          </div>
          <button className="block-btn-primary" onClick={() => {
            for (const key of ['smtp_host', 'smtp_port', 'smtp_username', 'smtp_password']) {
              if (settings[key]) saveSetting(key, settings[key]);
            }
          }}>Save Email Settings</button>
        </div>
      ),
    },
    {
      icon: CreditCard,
      title: 'Stripe Configuration',
      content: (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Stripe Secret Key</label>
            <input className="block-input font-mono text-xs" placeholder="sk_live_..." value={settings.stripe_api_key || ''} onChange={(e) => updateSetting('stripe_api_key', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" className="accent-accent-blue" checked={settings.stripe_test_mode === 'true'} onChange={(e) => updateSetting('stripe_test_mode', String(e.target.checked))} />
            Test Mode
          </label>
          <button className="block-btn-primary" onClick={() => {
            saveSetting('stripe_api_key', settings.stripe_api_key || '');
            saveSetting('stripe_test_mode', settings.stripe_test_mode || 'false');
          }}>Save Stripe Settings</button>
        </div>
      ),
    },
    {
      icon: Database,
      title: 'Data Management',
      content: (
        <div className="space-y-3">
          <div className="flex gap-3">
            <button className="block-btn flex items-center gap-2">
              <Download size={14} /> Export All Data (CSV)
            </button>
            <button className="block-btn flex items-center gap-2">
              <Upload size={14} /> Import Data
            </button>
          </div>
          <p className="text-xs text-text-muted">Export creates CSV files for all your accounting data. Import accepts CSV files matching our format.</p>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">Settings</h1>
        {saved && <span className="text-xs text-accent-income">Saved!</span>}
      </div>

      <div className="space-y-6 max-w-2xl">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <div key={section.title} className="block-card">
              <div className="flex items-center gap-2 mb-4">
                <Icon size={16} className="text-accent-blue" />
                <h3 className="text-sm font-semibold">{section.title}</h3>
              </div>
              {section.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
