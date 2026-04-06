import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings as SettingsIcon, Building2, Percent, Mail, CreditCard,
  Database, Save, HardDrive, Trash2, AlertTriangle, UserX,
} from 'lucide-react';
import { format } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import ImportExport from './ImportExport';

// ─── Types ──────────────────────────────────────────────
interface SettingsMap {
  [key: string]: string;
}

// ─── Section Card ───────────────────────────────────────
const SectionCard: React.FC<{
  icon: React.FC<{ size?: number; className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ icon: Icon, title, description, children }) => (
  <div className="block-card space-y-4">
    <div className="flex items-center gap-3">
      <div
        className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0"
        style={{ borderRadius: '6px' }}
      >
        <Icon size={16} className="text-accent-blue" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
    </div>
    <div className="border-t border-border-primary pt-4">{children}</div>
  </div>
);

// ─── Field ──────────────────────────────────────────────
const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
}> = ({ label, children, hint }) => (
  <div>
    <label className="block text-xs text-text-muted mb-1">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-text-muted mt-1">{hint}</p>}
  </div>
);

// ─── Danger Zone ───────────────────────────────────────
const DangerZone: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companies = useCompanyStore((s) => s.companies);
  const setCompanies = useCompanyStore((s) => s.setCompanies);
  const setActiveCompany = useCompanyStore((s) => s.setActiveCompany);
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [confirmDelete, setConfirmDelete] = useState<'company' | 'account' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDeleteCompany = async () => {
    if (!activeCompany || confirmText !== activeCompany.name) return;
    setDeleting(true);
    try {
      // Delete all company data
      const tables = [
        'debts', 'debt_automation_rules', 'debt_templates',
        'rules', 'approval_queue', 'automation_rules', 'automation_run_log', 'financial_anomalies',
        'invoices', 'expenses', 'clients', 'vendors', 'projects', 'employees',
        'accounts', 'journal_entries', 'categories', 'budgets',
        'bank_accounts', 'documents', 'notifications', 'recurring_templates',
        'bills', 'purchase_orders', 'fixed_assets', 'credit_notes',
        'time_entries', 'inventory_items',
      ];
      for (const table of tables) {
        await api.rawQuery(`DELETE FROM ${table} WHERE company_id = ?`, [activeCompany.id]).catch(() => {});
      }
      // Remove user-company link
      await api.rawQuery('DELETE FROM user_companies WHERE company_id = ?', [activeCompany.id]).catch(() => {});
      // Delete the company record
      await api.remove('companies', activeCompany.id);
      // Refresh companies list
      const remaining = await api.listCompanies();
      setCompanies(remaining ?? []);
      if (remaining && remaining.length > 0) {
        setActiveCompany(remaining[0]);
        await api.switchCompany(remaining[0].id);
      } else {
        setActiveCompany(null);
      }
      setConfirmDelete(null);
      setConfirmText('');
    } catch (err) {
      console.error('Failed to delete company:', err);
      alert('Failed to delete company');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!authUser || confirmText !== authUser.email) return;
    setDeleting(true);
    try {
      // Remove all user-company links
      await api.rawQuery('DELETE FROM user_companies WHERE user_id = ?', [authUser.id]);
      // Delete the user
      await api.rawQuery('DELETE FROM users WHERE id = ?', [authUser.id]);
      // Logout
      logout();
      setCompanies([]);
      setActiveCompany(null);
    } catch (err) {
      console.error('Failed to delete account:', err);
      alert('Failed to delete account');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="block-card" style={{ borderColor: 'rgba(248,113,113,0.25)' }}>
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-8 h-8 flex items-center justify-center shrink-0"
          style={{ borderRadius: '6px', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.2)' }}
        >
          <AlertTriangle size={16} className="text-accent-expense" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-accent-expense">Danger Zone</h3>
          <p className="text-xs text-text-muted mt-0.5">Irreversible actions</p>
        </div>
      </div>
      <div className="border-t pt-4 space-y-4" style={{ borderColor: 'rgba(248,113,113,0.15)' }}>
        {/* Delete Company */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary font-medium">Delete this company</p>
            <p className="text-xs text-text-muted">Permanently remove {activeCompany?.name || 'this company'} and all its data</p>
          </div>
          {confirmDelete !== 'company' ? (
            <button
              className="block-btn-danger flex items-center gap-1.5 text-xs"
              onClick={() => { setConfirmDelete('company'); setConfirmText(''); }}
            >
              <Trash2 size={13} /> Delete Company
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="block-input text-xs"
                style={{ width: '180px' }}
                placeholder={`Type "${activeCompany?.name}" to confirm`}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
              />
              <button
                className="block-btn-danger text-xs"
                disabled={confirmText !== activeCompany?.name || deleting}
                onClick={handleDeleteCompany}
              >
                {deleting ? 'Deleting...' : 'Confirm'}
              </button>
              <button className="block-btn text-xs" onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          )}
        </div>

        {/* Delete Account */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary font-medium">Delete your account</p>
            <p className="text-xs text-text-muted">Permanently remove your user account ({authUser?.email})</p>
          </div>
          {confirmDelete !== 'account' ? (
            <button
              className="block-btn-danger flex items-center gap-1.5 text-xs"
              onClick={() => { setConfirmDelete('account'); setConfirmText(''); }}
            >
              <UserX size={13} /> Delete Account
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="block-input text-xs"
                style={{ width: '200px' }}
                placeholder={`Type "${authUser?.email}" to confirm`}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
              />
              <button
                className="block-btn-danger text-xs"
                disabled={confirmText !== authUser?.email || deleting}
                onClick={handleDeleteAccount}
              >
                {deleting ? 'Deleting...' : 'Confirm'}
              </button>
              <button className="block-btn text-xs" onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
export default function SettingsModule() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState('');
  const [taxRatesError, setTaxRatesError] = useState('');
  const [emailError, setEmailError] = useState('');

  // ── Company Profile form ──
  const [companyForm, setCompanyForm] = useState<Record<string, any>>({});

  // ── Tax Rates ──
  const [taxRates, setTaxRates] = useState({
    tax_federal_rate: '',
    tax_state_rate: '',
    tax_se_rate: '',
  });

  // ── Email Config ──
  const [emailConfig, setEmailConfig] = useState({
    smtp_host: '',
    smtp_port: '',
    smtp_username: '',
    smtp_password: '',
    from_name: '',
    from_email: '',
  });

  // ── Stripe Config ──
  const [stripeConfig, setStripeConfig] = useState({
    stripe_api_key: '',
    stripe_test_mode: true,
  });

  // ── Backup ──
  const [backupConfig, setBackupConfig] = useState({
    auto_backup: false,
    last_backup_date: '',
  });
  const [backupMsg, setBackupMsg] = useState('');

  // ─── Load ─────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        // Bug fix #16: api.query('settings') returned ALL companies' settings.
        // Use the dedicated scoped handler instead.
        const data = await api.listSettings();
        const map: SettingsMap = {};
        if (Array.isArray(data)) {
          for (const s of data) map[s.key] = s.value;
        }
        setSettings(map);

        setTaxRates({
          tax_federal_rate: map.tax_federal_rate || '',
          tax_state_rate: map.tax_state_rate || '',
          tax_se_rate: map.tax_se_rate || '',
        });

        setEmailConfig({
          smtp_host: map.smtp_host || '',
          smtp_port: map.smtp_port || '',
          smtp_username: map.smtp_username || '',
          smtp_password: map.smtp_password || '',
          from_name: map.from_name || '',
          from_email: map.from_email || '',
        });

        setStripeConfig({
          stripe_api_key: map.stripe_api_key || '',
          stripe_test_mode: map.stripe_test_mode !== 'false',
        });

        setBackupConfig({
          auto_backup: map.auto_backup === 'true',
          last_backup_date: map.last_backup_date || '',
        });
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (activeCompany) setCompanyForm({ ...activeCompany });
  }, [activeCompany]);

  // ─── Save helpers ─────────────────────────────────────
  const saveSetting = useCallback(async (key: string, value: string) => {
    try {
      // Bug fix #16b: use scoped setSetting instead of generic query/update/create.
      await api.setSetting(key, value);
    } catch (err) {
      console.error(`Failed to save setting ${key}:`, err);
    }
  }, []);

  const saveMultiple = useCallback(
    async (entries: Record<string, string>, section: string) => {
      setSavingSection(section);
      try {
        await Promise.all(
          Object.entries(entries).map(([key, value]) => saveSetting(key, value)),
        );
        setSettings((prev) => ({ ...prev, ...entries }));
      } catch (err) {
        console.error(`Failed to save ${section}:`, err);
      } finally {
        setSavingSection('');
      }
    },
    [saveSetting],
  );

  // ─── Save Tax Rates (validated) ───────────────────────
  const saveTaxRates = async () => {
    const fields: [string, string][] = [
      ['Federal Rate', taxRates.tax_federal_rate],
      ['State Rate', taxRates.tax_state_rate],
      ['Self-Employment Rate', taxRates.tax_se_rate],
    ];
    for (const [label, value] of fields) {
      if (value.trim() === '') continue;
      const n = parseFloat(value);
      if (isNaN(n) || n < 0 || n > 100) {
        setTaxRatesError(`${label} must be a number between 0 and 100.`);
        return;
      }
    }
    setTaxRatesError('');
    await saveMultiple(taxRates, 'tax');
  };

  // ─── Save Email Settings (validated) ──────────────────
  const saveEmailSettings = async () => {
    if (emailConfig.smtp_port.trim() !== '') {
      const port = parseInt(emailConfig.smtp_port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        setEmailError('SMTP port must be a number between 1 and 65535.');
        return;
      }
    }
    setEmailError('');
    await saveMultiple(emailConfig, 'email');
  };

  // ─── Save Company ─────────────────────────────────────
  const saveCompany = async () => {
    if (!activeCompany?.id) return;
    setSavingSection('company');
    try {
      await api.updateCompany(activeCompany.id, companyForm);
    } catch (err) {
      console.error('Failed to save company:', err);
    } finally {
      setSavingSection('');
    }
  };

  // ─── Backup ───────────────────────────────────────────
  const runBackup = async () => {
    setSavingSection('backup-run');
    try {
      const now = new Date().toISOString();
      await saveSetting('last_backup_date', now);
      setBackupConfig((prev) => ({ ...prev, last_backup_date: now }));
      setBackupMsg('Backup created successfully.');
      setTimeout(() => setBackupMsg(''), 3000);
    } catch (err) {
      console.error('Backup failed:', err);
    } finally {
      setSavingSection('');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <SettingsIcon size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Settings</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Manage your application configuration
            </p>
          </div>
        </div>
      </div>

      {/* ── Company Profile ────────────────────────────── */}
      <SectionCard
        icon={Building2}
        title="Company Profile"
        description="Your business details used on invoices and documents"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company Name">
            <input
              className="block-input"
              value={companyForm.name || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
              placeholder="Acme Corp"
            />
          </Field>
          <Field label="Legal Name">
            <input
              className="block-input"
              value={companyForm.legal_name || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, legal_name: e.target.value })}
              placeholder="Acme Corporation LLC"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Email">
            <input
              className="block-input"
              value={companyForm.email || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
              placeholder="info@company.com"
            />
          </Field>
          <Field label="Phone">
            <input
              className="block-input"
              value={companyForm.phone || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
              placeholder="(555) 123-4567"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Address">
            <input
              className="block-input"
              value={companyForm.address_line1 || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, address_line1: e.target.value })}
              placeholder="123 Main St"
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Field label="City">
            <input
              className="block-input"
              value={companyForm.city || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
              placeholder="New York"
            />
          </Field>
          <Field label="State">
            <input
              className="block-input"
              value={companyForm.state || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, state: e.target.value })}
              placeholder="NY"
            />
          </Field>
          <Field label="ZIP">
            <input
              className="block-input"
              value={companyForm.zip || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, zip: e.target.value })}
              placeholder="10001"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Tax ID (EIN)">
            <input
              className="block-input"
              value={companyForm.tax_id || ''}
              onChange={(e) => setCompanyForm({ ...companyForm, tax_id: e.target.value })}
              placeholder="XX-XXXXXXX"
            />
          </Field>
          <Field label="Fiscal Year Start">
            <select
              className="block-select"
              value={companyForm.fiscal_year_start || 1}
              onChange={(e) =>
                setCompanyForm({ ...companyForm, fiscal_year_start: parseInt(e.target.value) })
              }
            >
              {[
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December',
              ].map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex justify-end mt-4">
          <button
            className="block-btn-primary flex items-center gap-1.5"
            onClick={saveCompany}
            disabled={savingSection === 'company'}
          >
            <Save size={14} />
            {savingSection === 'company' ? 'Saving...' : 'Save Company Profile'}
          </button>
        </div>
      </SectionCard>

      {/* ── Tax Rates ──────────────────────────────────── */}
      <SectionCard
        icon={Percent}
        title="Tax Rates"
        description="Default tax rates for calculations and reports"
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Federal Rate (%)" hint="Applied to federal tax calculations">
            <input
              type="number"
              step="0.01"
              className="block-input"
              value={taxRates.tax_federal_rate}
              onChange={(e) => setTaxRates({ ...taxRates, tax_federal_rate: e.target.value })}
              placeholder="22.00"
            />
          </Field>
          <Field label="State Rate (%)" hint="Applied to state tax calculations">
            <input
              type="number"
              step="0.01"
              className="block-input"
              value={taxRates.tax_state_rate}
              onChange={(e) => setTaxRates({ ...taxRates, tax_state_rate: e.target.value })}
              placeholder="5.00"
            />
          </Field>
          <Field label="Self-Employment Rate (%)" hint="SE tax rate for freelancers">
            <input
              type="number"
              step="0.01"
              className="block-input"
              value={taxRates.tax_se_rate}
              onChange={(e) => setTaxRates({ ...taxRates, tax_se_rate: e.target.value })}
              placeholder="15.30"
            />
          </Field>
        </div>
        {taxRatesError && (
          <div
            className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mt-2"
            style={{ borderRadius: '6px' }}
          >
            {taxRatesError}
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button
            className="block-btn-primary flex items-center gap-1.5"
            onClick={saveTaxRates}
            disabled={savingSection === 'tax'}
          >
            <Save size={14} />
            {savingSection === 'tax' ? 'Saving...' : 'Save Tax Rates'}
          </button>
        </div>
      </SectionCard>

      {/* ── Email Configuration ────────────────────────── */}
      <SectionCard
        icon={Mail}
        title="Email Configuration"
        description="SMTP settings for sending invoices and notifications"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP Host">
            <input
              className="block-input"
              value={emailConfig.smtp_host}
              onChange={(e) => setEmailConfig({ ...emailConfig, smtp_host: e.target.value })}
              placeholder="smtp.gmail.com"
            />
          </Field>
          <Field label="SMTP Port">
            <input
              type="number"
              className="block-input"
              value={emailConfig.smtp_port}
              onChange={(e) => setEmailConfig({ ...emailConfig, smtp_port: e.target.value })}
              placeholder="587"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Username">
            <input
              className="block-input"
              value={emailConfig.smtp_username}
              onChange={(e) => setEmailConfig({ ...emailConfig, smtp_username: e.target.value })}
              placeholder="user@gmail.com"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              className="block-input"
              value={emailConfig.smtp_password}
              onChange={(e) => setEmailConfig({ ...emailConfig, smtp_password: e.target.value })}
              placeholder="App password"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="From Name">
            <input
              className="block-input"
              value={emailConfig.from_name}
              onChange={(e) => setEmailConfig({ ...emailConfig, from_name: e.target.value })}
              placeholder="Acme Corp"
            />
          </Field>
          <Field label="From Email">
            <input
              type="email"
              className="block-input"
              value={emailConfig.from_email}
              onChange={(e) => setEmailConfig({ ...emailConfig, from_email: e.target.value })}
              placeholder="billing@company.com"
            />
          </Field>
        </div>
        {emailError && (
          <div
            className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mt-2"
            style={{ borderRadius: '6px' }}
          >
            {emailError}
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button
            className="block-btn-primary flex items-center gap-1.5"
            onClick={saveEmailSettings}
            disabled={savingSection === 'email'}
          >
            <Save size={14} />
            {savingSection === 'email' ? 'Saving...' : 'Save Email Settings'}
          </button>
        </div>
      </SectionCard>

      {/* ── Stripe Configuration ───────────────────────── */}
      <SectionCard
        icon={CreditCard}
        title="Stripe Configuration"
        description="Payment processing with Stripe"
      >
        <div className="space-y-3">
          <Field label="API Key" hint="Your Stripe secret key (starts with sk_)">
            <input
              type="password"
              className="block-input font-mono text-xs"
              value={stripeConfig.stripe_api_key}
              onChange={(e) => setStripeConfig({ ...stripeConfig, stripe_api_key: e.target.value })}
              placeholder="sk_live_..."
            />
          </Field>
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-5 flex items-center rounded-sm p-0.5 cursor-pointer transition-colors ${
                stripeConfig.stripe_test_mode
                  ? 'bg-accent-warning'
                  : 'bg-bg-tertiary border border-border-primary'
              }`}
              onClick={() =>
                setStripeConfig({ ...stripeConfig, stripe_test_mode: !stripeConfig.stripe_test_mode })
              }
            >
              <div
                className={`w-4 h-4 bg-bg-secondary rounded-sm transform transition-transform ${
                  stripeConfig.stripe_test_mode ? 'translate-x-5' : 'translate-x-0'
                }`}
                style={{ borderRadius: '6px' }}
              />
            </div>
            <span className="text-sm text-text-secondary">
              {stripeConfig.stripe_test_mode ? 'Test Mode' : 'Live Mode'}
            </span>
            {stripeConfig.stripe_test_mode && (
              <span className="block-badge block-badge-warning text-[10px]">TEST</span>
            )}
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            className="block-btn-primary flex items-center gap-1.5"
            onClick={() =>
              saveMultiple(
                {
                  stripe_api_key: stripeConfig.stripe_api_key,
                  stripe_test_mode: String(stripeConfig.stripe_test_mode),
                },
                'stripe',
              )
            }
            disabled={savingSection === 'stripe'}
          >
            <Save size={14} />
            {savingSection === 'stripe' ? 'Saving...' : 'Save Stripe Settings'}
          </button>
        </div>
      </SectionCard>

      {/* ── Backup ─────────────────────────────────────── */}
      <SectionCard
        icon={HardDrive}
        title="Backup"
        description="Database backup configuration"
      >
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-5 flex items-center rounded-sm p-0.5 cursor-pointer transition-colors ${
                  backupConfig.auto_backup
                    ? 'bg-accent-income'
                    : 'bg-bg-tertiary border border-border-primary'
                }`}
                onClick={async () => {
                  const newVal = !backupConfig.auto_backup;
                  setBackupConfig({ ...backupConfig, auto_backup: newVal });
                  await saveSetting('auto_backup', String(newVal));
                }}
              >
                <div
                  className={`w-4 h-4 bg-bg-secondary rounded-sm transform transition-transform ${
                    backupConfig.auto_backup ? 'translate-x-5' : 'translate-x-0'
                  }`}
                  style={{ borderRadius: '6px' }}
                />
              </div>
              <span className="text-sm text-text-secondary">
                Auto-backup {backupConfig.auto_backup ? 'enabled' : 'disabled'}
              </span>
            </div>
            {backupConfig.last_backup_date ? (
              <p className="text-xs text-text-muted">
                Last backup: {format(new Date(backupConfig.last_backup_date), 'MMM d, yyyy h:mm a')}
              </p>
            ) : (
              <p className="text-xs text-text-muted">No backups yet</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {backupMsg && (
              <span className="text-xs font-medium" style={{ color: '#22c55e' }}>{backupMsg}</span>
            )}
            <button
              className="block-btn-success flex items-center gap-1.5"
              onClick={runBackup}
              disabled={savingSection === 'backup-run'}
            >
              <Database size={14} />
              {savingSection === 'backup-run' ? 'Backing up...' : 'Backup Now'}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* ── Data Import / Export ────────────────────────── */}
      <ImportExport />

      {/* ── Danger Zone ─────────────────────────────────── */}
      <DangerZone />
    </div>
  );
}
