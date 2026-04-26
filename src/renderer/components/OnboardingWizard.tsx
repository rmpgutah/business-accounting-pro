import React, { useState, useEffect, useMemo } from 'react';
import * as Icons from 'lucide-react';
import { ChevronLeft, ChevronRight, Check, X, Sparkles } from 'lucide-react';
import api from '../lib/api';
import { INDUSTRY_PRESETS, getPreset, type IndustryPreset } from '../lib/industry-presets';
import { COA_TEMPLATES } from '../lib/coa-templates';
import { useCompanyStore } from '../stores/companyStore';

// Wizard step keys
type StepKey = 'industry' | 'company' | 'branding' | 'banking' | 'team' | 'first-entity' | 'done';

const STEP_ORDER: StepKey[] = ['industry', 'company', 'branding', 'banking', 'team', 'first-entity', 'done'];

const STEP_LABEL: Record<StepKey, string> = {
  industry: 'Industry',
  company: 'Company',
  branding: 'Branding',
  banking: 'Banking',
  team: 'Team',
  'first-entity': 'First Entity',
  done: 'Done',
};

interface OnboardingState {
  step: StepKey;
  presetKey: string;
  company: { name: string; address: string; city: string; state: string; zip: string; phone: string; email: string; website: string; fiscalYearStart: number; currency: string };
  branding: { accentColor: string; logoDataUri: string; templateStyle: string };
  banking: { accountName: string; openingBalance: string };
  team: { emails: string[]; current: string };
  firstEntity: { sampleClientName: string; sampleItemName: string; sampleItemPrice: string };
}

const INITIAL_STATE: OnboardingState = {
  step: 'industry',
  presetKey: '',
  company: { name: '', address: '', city: '', state: '', zip: '', phone: '', email: '', website: '', fiscalYearStart: 1, currency: 'USD' },
  branding: { accentColor: '#2563eb', logoDataUri: '', templateStyle: 'classic' },
  banking: { accountName: 'Business Checking', openingBalance: '0' },
  team: { emails: [], current: '' },
  firstEntity: { sampleClientName: '', sampleItemName: '', sampleItemPrice: '' },
};

const STORAGE_KEY = 'onboarding_wizard_state_v1';

// Look up a lucide icon by name with a fallback.
function getIcon(name: string): React.FC<any> {
  const Comp = (Icons as any)[name];
  return Comp || Icons.Briefcase;
}

interface OnboardingWizardProps {
  companyId: string;
  onClose: () => void;
  onComplete: () => void;
  initialPresetKey?: string;
  // When true, the user can never dismiss without finishing/skipping
  required?: boolean;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ companyId, onClose, onComplete, initialPresetKey, required }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const setActiveCompany = useCompanyStore((s) => s.setActiveCompany);

  // Resume from stored state if present (Feature #24).
  const [state, setState] = useState<OnboardingState>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<OnboardingState>;
        return { ...INITIAL_STATE, ...parsed, step: parsed.step || 'industry' } as OnboardingState;
      }
    } catch { /* ignore corrupt state */ }
    if (initialPresetKey) return { ...INITIAL_STATE, presetKey: initialPresetKey };
    return INITIAL_STATE;
  });

  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultSummary, setResultSummary] = useState<any>(null);

  // Pre-fill company from active record on mount.
  useEffect(() => {
    if (activeCompany && !state.company.name) {
      setState((prev) => ({
        ...prev,
        company: {
          ...prev.company,
          name: activeCompany.name || '',
          address: activeCompany.address_line1 || '',
          city: activeCompany.city || '',
          state: activeCompany.state || '',
          zip: activeCompany.zip || '',
          phone: activeCompany.phone || '',
          email: activeCompany.email || '',
          website: activeCompany.website || '',
          fiscalYearStart: activeCompany.fiscal_year_start || 1,
        },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist state on every change for resume support.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* storage full or disabled */ }
  }, [state]);

  const stepIndex = STEP_ORDER.indexOf(state.step);
  const selectedPreset: IndustryPreset | undefined = useMemo(() => getPreset(state.presetKey), [state.presetKey]);

  const goNext = () => {
    const next = STEP_ORDER[stepIndex + 1];
    if (next) setState((s) => ({ ...s, step: next }));
  };
  const goBack = () => {
    const prev = STEP_ORDER[stepIndex - 1];
    if (prev) setState((s) => ({ ...s, step: prev }));
  };

  const canAdvance = (): boolean => {
    switch (state.step) {
      case 'industry': return Boolean(state.presetKey);
      case 'company': return state.company.name.trim().length > 0;
      default: return true;
    }
  };

  const handleSkip = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    onClose();
  };

  // Apply preset + extra customizations on the final step.
  const handleFinish = async () => {
    if (!selectedPreset || !companyId) {
      setErrorMsg('No industry selected');
      return;
    }
    setApplying(true);
    setErrorMsg('');
    try {
      // Update company info
      await api.updateCompany(companyId, {
        name: state.company.name,
        address_line1: state.company.address,
        city: state.company.city,
        state: state.company.state,
        zip: state.company.zip,
        phone: state.company.phone,
        email: state.company.email,
        website: state.company.website,
        fiscal_year_start: state.company.fiscalYearStart,
        industry: selectedPreset.key,
      }).catch(() => { /* tolerate field mismatch */ });

      // Currency setting
      await api.setSetting('currency', state.company.currency).catch(() => {});

      // Apply industry preset
      const coa = COA_TEMPLATES.find((t) => t.id === selectedPreset.coaTemplateKey);
      const accountSeeds = coa?.accounts || [];
      const presetWithBranding: IndustryPreset = {
        ...selectedPreset,
        invoiceSettings: {
          ...selectedPreset.invoiceSettings,
          accent_color: state.branding.accentColor,
          template_style: state.branding.templateStyle,
        },
      };
      const result = await api.industryApplyPreset({
        companyId,
        presetKey: selectedPreset.key,
        preset: presetWithBranding,
        accountSeeds,
      });
      if (result.error) {
        setErrorMsg(result.error);
        setApplying(false);
        return;
      }

      // Logo as setting (data: URI)
      if (state.branding.logoDataUri) {
        await api.setSetting('company_logo', state.branding.logoDataUri).catch(() => {});
      }

      // Banking — create the first bank account if provided.
      if (state.banking.accountName.trim()) {
        try {
          // Find the checking account in the COA, otherwise pick any bank-type account.
          const accounts: any[] = await api.query('accounts', { company_id: companyId });
          const checking = accounts.find((a) => a.code === '1010') || accounts.find((a) => a.subtype === 'bank') || accounts[0];
          await api.create('bank_accounts', {
            company_id: companyId,
            name: state.banking.accountName.trim(),
            account_id: checking?.id || null,
            current_balance: parseFloat(state.banking.openingBalance) || 0,
          });
        } catch (err) {
          console.warn('Bank account create skipped:', err);
        }
      }

      // Team — collect emails as a setting (SMTP not wired).
      if (state.team.emails.length > 0) {
        await api.setSetting('pending_team_invites', JSON.stringify(state.team.emails)).catch(() => {});
      }

      // First entity — sample client + sample catalog item.
      if (state.firstEntity.sampleClientName.trim()) {
        try {
          await api.create('clients', {
            company_id: companyId,
            name: state.firstEntity.sampleClientName.trim(),
            type: 'company',
            status: 'active',
          });
        } catch { /* idempotency: ignore duplicate */ }
      }
      if (state.firstEntity.sampleItemName.trim()) {
        try {
          await api.saveCatalogItem({
            name: state.firstEntity.sampleItemName.trim(),
            unit_price: parseFloat(state.firstEntity.sampleItemPrice) || 0,
            description: '',
          });
        } catch { /* tolerate */ }
      }

      // Refresh active company so UI reflects new industry/branding.
      try {
        const updated = await api.getCompany(companyId);
        if (updated) setActiveCompany(updated);
      } catch { /* ignore */ }

      setResultSummary(result.summary);
      // Move to done if not already.
      setState((s) => ({ ...s, step: 'done' }));
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to apply preset');
    } finally {
      setApplying(false);
    }
  };

  // Logo upload handler (data: URI).
  const handleLogoFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setState((s) => ({ ...s, branding: { ...s.branding, logoDataUri: result } }));
    };
    reader.readAsDataURL(file);
  };

  // ─── Step renderers ───────────────────────────────
  const renderIndustryStep = () => (
    <div>
      <h3 className="text-base font-semibold text-text-primary mb-1">Pick the industry that best fits your business</h3>
      <p className="text-xs text-text-muted mb-4">We'll prime your books with industry-specific categories, accounts, and templates. You can change this later.</p>
      <div className="grid grid-cols-3 gap-3">
        {INDUSTRY_PRESETS.map((p) => {
          const Icon = getIcon(p.icon);
          const selected = state.presetKey === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setState((s) => ({ ...s, presetKey: p.key }))}
              className="block-card text-left transition-all"
              style={{
                padding: '14px',
                cursor: 'pointer',
                borderColor: selected ? 'var(--color-accent-blue)' : 'var(--color-border-primary)',
                background: selected ? 'rgba(37,99,235,0.08)' : 'var(--color-bg-secondary-solid)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="flex items-center justify-center"
                  style={{ width: 32, height: 32, background: selected ? 'var(--color-accent-blue)' : 'var(--color-bg-tertiary)', borderRadius: 6 }}
                >
                  <Icon size={16} color={selected ? 'white' : 'var(--color-text-muted)'} />
                </div>
                <span className="text-sm font-semibold text-text-primary">{p.label}</span>
                {selected && <Check size={14} className="ml-auto text-accent-blue" />}
              </div>
              <p className="text-[11px] text-text-muted leading-snug">{p.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderCompanyStep = () => (
    <div>
      <h3 className="text-base font-semibold text-text-primary mb-1">Company information</h3>
      <p className="text-xs text-text-muted mb-4">Used on invoices and reports.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company Name *">
          <input className="block-input" value={state.company.name} onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, name: e.target.value } }))} />
        </Field>
        <Field label="Phone">
          <input className="block-input" value={state.company.phone} onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, phone: e.target.value } }))} />
        </Field>
        <Field label="Email">
          <input className="block-input" type="email" value={state.company.email} onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, email: e.target.value } }))} />
        </Field>
        <Field label="Website">
          <input className="block-input" value={state.company.website} onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, website: e.target.value } }))} />
        </Field>
        <Field label="Address">
          <input className="block-input" value={state.company.address} onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, address: e.target.value } }))} />
        </Field>
        <Field label="City">
          <input className="block-input" value={state.company.city} onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, city: e.target.value } }))} />
        </Field>
        <Field label="State">
          <input className="block-input" value={state.company.state} onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, state: e.target.value } }))} />
        </Field>
        <Field label="ZIP">
          <input className="block-input" value={state.company.zip} onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, zip: e.target.value } }))} />
        </Field>
        <Field label="Fiscal Year Start">
          <select
            className="block-select"
            value={state.company.fiscalYearStart}
            onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, fiscalYearStart: parseInt(e.target.value) } }))}
          >
            {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Currency">
          <select
            className="block-select"
            value={state.company.currency}
            onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, currency: e.target.value } }))}
          >
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — British Pound</option>
            <option value="CAD">CAD — Canadian Dollar</option>
            <option value="AUD">AUD — Australian Dollar</option>
            <option value="JPY">JPY — Japanese Yen</option>
          </select>
        </Field>
      </div>
    </div>
  );

  const renderBrandingStep = () => (
    <div>
      <h3 className="text-base font-semibold text-text-primary mb-1">Branding</h3>
      <p className="text-xs text-text-muted mb-4">Personalize your invoices and reports.</p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Accent Color">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={state.branding.accentColor}
              onChange={(e) => setState((s) => ({ ...s, branding: { ...s.branding, accentColor: e.target.value } }))}
              style={{ width: 56, height: 32, padding: 0, border: '1px solid var(--color-border-primary)' }}
            />
            <input
              className="block-input"
              style={{ flex: 1 }}
              value={state.branding.accentColor}
              onChange={(e) => setState((s) => ({ ...s, branding: { ...s.branding, accentColor: e.target.value } }))}
            />
          </div>
        </Field>
        <Field label="Default Invoice Template">
          <select
            className="block-select"
            value={state.branding.templateStyle}
            onChange={(e) => setState((s) => ({ ...s, branding: { ...s.branding, templateStyle: e.target.value } }))}
          >
            <option value="classic">Classic</option>
            <option value="modern">Modern</option>
            <option value="minimal">Minimal</option>
          </select>
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Logo (optional)">
          {state.branding.logoDataUri && (
            <div style={{ marginBottom: 8, padding: 8, border: '1px solid var(--color-border-primary)', display: 'inline-block' }}>
              <img src={state.branding.logoDataUri} alt="Logo" style={{ height: 60, objectFit: 'contain' }} />
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); }}
          />
        </Field>
      </div>
    </div>
  );

  const renderBankingStep = () => (
    <div>
      <h3 className="text-base font-semibold text-text-primary mb-1">First bank account</h3>
      <p className="text-xs text-text-muted mb-4">Create your primary checking account. We'll record an opening balance journal entry.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account Name">
          <input className="block-input" value={state.banking.accountName} onChange={(e) => setState((s) => ({ ...s, banking: { ...s.banking, accountName: e.target.value } }))} />
        </Field>
        <Field label="Opening Balance">
          <input type="number" step="0.01" className="block-input" value={state.banking.openingBalance} onChange={(e) => setState((s) => ({ ...s, banking: { ...s.banking, openingBalance: e.target.value } }))} />
        </Field>
      </div>
    </div>
  );

  const renderTeamStep = () => (
    <div>
      <h3 className="text-base font-semibold text-text-primary mb-1">Invite your team</h3>
      <p className="text-xs text-text-muted mb-4">We'll save these emails. You can send invites later once SMTP is configured.</p>
      <div className="flex items-center gap-2 mb-3">
        <input
          className="block-input"
          style={{ flex: 1 }}
          placeholder="teammate@example.com"
          value={state.team.current}
          onChange={(e) => setState((s) => ({ ...s, team: { ...s.team, current: e.target.value } }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const v = state.team.current.trim();
              if (/^\S+@\S+\.\S+$/.test(v)) {
                setState((s) => ({ ...s, team: { emails: [...s.team.emails, v], current: '' } }));
              }
            }
          }}
        />
        <button
          type="button"
          className="block-btn"
          onClick={() => {
            const v = state.team.current.trim();
            if (/^\S+@\S+\.\S+$/.test(v)) {
              setState((s) => ({ ...s, team: { emails: [...s.team.emails, v], current: '' } }));
            }
          }}
        >Add</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {state.team.emails.map((e) => (
          <span key={e} className="block-badge" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {e}
            <button
              type="button"
              onClick={() => setState((s) => ({ ...s, team: { ...s.team, emails: s.team.emails.filter((x) => x !== e) } }))}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
            ><X size={12} /></button>
          </span>
        ))}
      </div>
    </div>
  );

  const renderFirstEntityStep = () => (
    <div>
      <h3 className="text-base font-semibold text-text-primary mb-1">Add a sample customer & item</h3>
      <p className="text-xs text-text-muted mb-4">Optional — helps you test invoices right away. Tailored to your industry.</p>
      <div className="space-y-3">
        <Field label="Sample Customer Name">
          <input className="block-input" placeholder={selectedPreset?.key === 'legal' ? 'Acme Litigation Matter' : selectedPreset?.key === 'healthcare' ? 'Sample Patient' : 'Acme Corp'} value={state.firstEntity.sampleClientName} onChange={(e) => setState((s) => ({ ...s, firstEntity: { ...s.firstEntity, sampleClientName: e.target.value } }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sample Item / Service">
            <input className="block-input" placeholder={selectedPreset?.key === 'service' ? 'Consulting Hour' : 'Product / Service'} value={state.firstEntity.sampleItemName} onChange={(e) => setState((s) => ({ ...s, firstEntity: { ...s.firstEntity, sampleItemName: e.target.value } }))} />
          </Field>
          <Field label="Default Price">
            <input type="number" step="0.01" className="block-input" value={state.firstEntity.sampleItemPrice} onChange={(e) => setState((s) => ({ ...s, firstEntity: { ...s.firstEntity, sampleItemPrice: e.target.value } }))} />
          </Field>
        </div>
      </div>
    </div>
  );

  const renderDoneStep = () => (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div style={{ width: 44, height: 44, borderRadius: 8, background: 'rgba(34,197,94,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Check size={22} className="text-accent-income" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-text-primary">You're all set</h3>
          <p className="text-xs text-text-muted">Industry: {selectedPreset?.label || '—'}</p>
        </div>
      </div>
      {resultSummary && (
        <div className="block-card" style={{ padding: 14 }}>
          <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Summary</div>
          <div className="grid grid-cols-2 gap-2 text-sm text-text-primary">
            <div>Categories added: <strong>{resultSummary.categoriesAdded}</strong></div>
            <div>Categories skipped: <strong>{resultSummary.categoriesSkipped}</strong></div>
            <div>Accounts added: <strong>{resultSummary.accountsAdded}</strong></div>
            <div>Accounts skipped: <strong>{resultSummary.accountsSkipped}</strong></div>
            <div>Vendors added: <strong>{resultSummary.vendorsAdded}</strong></div>
            <div>Vendors skipped: <strong>{resultSummary.vendorsSkipped}</strong></div>
            <div>Custom fields added: <strong>{resultSummary.fieldsAdded}</strong></div>
            <div>Setup hints: <strong>{resultSummary.hintsAdded}</strong></div>
          </div>
        </div>
      )}
      {selectedPreset?.setupHints && selectedPreset.setupHints.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Recommended next steps</div>
          <div className="space-y-2">
            {selectedPreset.setupHints.map((h) => (
              <div key={h.key} className="block-card" style={{ padding: 10 }}>
                <div className="text-sm font-semibold text-text-primary">{h.title}</div>
                <div className="text-xs text-text-muted">{h.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderStep = () => {
    switch (state.step) {
      case 'industry': return renderIndustryStep();
      case 'company': return renderCompanyStep();
      case 'branding': return renderBrandingStep();
      case 'banking': return renderBankingStep();
      case 'team': return renderTeamStep();
      case 'first-entity': return renderFirstEntityStep();
      case 'done': return renderDoneStep();
    }
  };

  const isLastInputStep = state.step === 'first-entity';
  const isDone = state.step === 'done';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="block-card flex flex-col"
        style={{
          width: '90vw',
          maxWidth: 880,
          maxHeight: '90vh',
          background: 'var(--color-bg-primary-solid)',
          border: '1px solid var(--color-border-primary)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-primary">
          <div className="flex items-center gap-3">
            <div style={{ width: 32, height: 32, background: 'var(--color-accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>
              <Sparkles size={16} color="white" />
            </div>
            <div>
              <div className="text-sm font-bold text-text-primary">Onboarding Wizard</div>
              <div className="text-xs text-text-muted">Step {stepIndex + 1} of {STEP_ORDER.length} — {STEP_LABEL[state.step]}</div>
            </div>
          </div>
          {!required && (
            <button onClick={handleSkip} className="block-btn flex items-center gap-1 text-xs"><X size={13} /> Skip</button>
          )}
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border-primary" style={{ background: 'var(--color-bg-secondary-solid)' }}>
          {STEP_ORDER.map((k, i) => (
            <div key={k} style={{ flex: 1, height: 4, background: i <= stepIndex ? 'var(--color-accent-blue)' : 'var(--color-bg-tertiary)' }} />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {errorMsg && (
            <div className="text-xs mb-3" style={{ padding: '8px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', borderRadius: 6 }}>
              {errorMsg}
            </div>
          )}
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border-primary" style={{ background: 'var(--color-bg-secondary-solid)' }}>
          <button
            type="button"
            className="block-btn flex items-center gap-1 text-xs"
            onClick={goBack}
            disabled={stepIndex === 0 || applying || isDone}
            style={{ opacity: stepIndex === 0 || isDone ? 0.4 : 1 }}
          >
            <ChevronLeft size={14} /> Back
          </button>
          <div className="flex items-center gap-2">
            {!isLastInputStep && !isDone && (
              <button
                type="button"
                className="block-btn-primary flex items-center gap-1 text-xs"
                onClick={goNext}
                disabled={!canAdvance() || applying}
              >
                Next <ChevronRight size={14} />
              </button>
            )}
            {isLastInputStep && (
              <button
                type="button"
                className="block-btn-primary flex items-center gap-1 text-xs"
                onClick={handleFinish}
                disabled={applying}
              >
                {applying ? 'Applying…' : 'Apply Preset'}
                <Check size={14} />
              </button>
            )}
            {isDone && (
              <button
                type="button"
                className="block-btn-primary flex items-center gap-1 text-xs"
                onClick={onComplete}
              >
                Visit Dashboard <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">{label}</label>
    {children}
  </div>
);

export default OnboardingWizard;
