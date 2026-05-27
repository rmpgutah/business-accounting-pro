/**
 * LoanWizard — Loan Full-System Wave (F993-F1052)
 *
 * Type-aware multi-step wizard for originating loans of any kind:
 *  Step 1: Pick loan type (mortgage / HELOC / auto / student / personal /
 *          business / SBA / construction / equipment / bridge / margin)
 *  Step 2: Type-specific fields (different per type)
 *  Step 3: Math/calculator — live preview of payment, total interest, APR
 *  Step 4: Documents + disclosures (GFE, CD, TIL placeholders)
 *  Step 5: Review + save (delegates to existing api.invoke('loans:save'))
 *
 * Reuses the existing loans table — no schema migration. Type-specific
 * sidecar data (HELOC draws, construction draws, IDR plan, etc.) can be
 * added post-save via the per-type API endpoints.
 */

import React, { useMemo, useState } from 'react';
import { Home, CreditCard, GraduationCap, Car, Briefcase, Hammer, TrendingUp, FileText, Award, Building, ChevronRight, ChevronLeft, Save, X } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

interface LoanType {
  key: string;
  name: string;
  icon: any;
  description: string;
  defaultRate: number;       // % annual
  defaultTermMonths: number;
}

const LOAN_TYPES: LoanType[] = [
  { key: 'mortgage', name: 'Mortgage', icon: Home, description: '30-year fixed, ARM, FHA, VA, jumbo', defaultRate: 7.0, defaultTermMonths: 360 },
  { key: 'heloc', name: 'HELOC', icon: CreditCard, description: 'Home equity line of credit', defaultRate: 8.5, defaultTermMonths: 120 },
  { key: 'auto', name: 'Auto Loan', icon: Car, description: 'New, used, refinance', defaultRate: 7.5, defaultTermMonths: 60 },
  { key: 'student', name: 'Student Loan', icon: GraduationCap, description: 'Federal or private; IDR / PSLF tracking', defaultRate: 5.5, defaultTermMonths: 120 },
  { key: 'personal', name: 'Personal Loan', icon: FileText, description: 'Unsecured / secured', defaultRate: 10.0, defaultTermMonths: 36 },
  { key: 'business', name: 'Business Term', icon: Briefcase, description: 'General business financing', defaultRate: 9.0, defaultTermMonths: 60 },
  { key: 'sba', name: 'SBA Loan', icon: Award, description: 'SBA 7(a) or 504', defaultRate: 9.5, defaultTermMonths: 120 },
  { key: 'construction', name: 'Construction', icon: Hammer, description: 'Interest-only during build', defaultRate: 8.0, defaultTermMonths: 12 },
  { key: 'equipment', name: 'Equipment', icon: Building, description: 'Operating or capital lease', defaultRate: 8.0, defaultTermMonths: 60 },
  { key: 'bridge', name: 'Bridge', icon: TrendingUp, description: 'Short-term high-rate', defaultRate: 12.0, defaultTermMonths: 12 },
];

const STEPS = [
  { num: 1, label: 'Type' },
  { num: 2, label: 'Borrower & Details' },
  { num: 3, label: 'Terms & Math' },
  { num: 4, label: 'Documents' },
  { num: 5, label: 'Review' },
];

interface Props {
  onSaved: (loanId: string) => void;
  onCancel: () => void;
}

export default function LoanWizard({ onSaved, onCancel }: Props) {
  const [step, setStep] = useState(1);
  const [typeKey, setTypeKey] = useState<string>('');

  // Core form (shared with existing LoanForm save)
  const [form, setForm] = useState<any>({
    name: '',
    lender_name: '',
    principal: 0,
    interest_rate: 0.07,
    rate_type: 'fixed',
    term_months: 360,
    payment_frequency: 'monthly',
    amortization_type: 'standard',
    origination_date: new Date().toISOString().slice(0, 10),
    first_payment_date: addDays(new Date().toISOString().slice(0, 10), 30),
    notes: '',
    status: 'active',
    currency: 'USD',
  });

  // Type-specific extras
  const [extras, setExtras] = useState<any>({});

  // Prequal data (for borrower-aware verdict shown in step 3)
  const [prequal, setPrequal] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const selectedType = useMemo(() => LOAN_TYPES.find(t => t.key === typeKey), [typeKey]);

  function pickType(t: LoanType) {
    setTypeKey(t.key);
    setForm((f: any) => ({
      ...f,
      loan_type: t.key,
      interest_rate: t.defaultRate / 100,
      term_months: t.defaultTermMonths,
      amortization_type: t.key === 'heloc' || t.key === 'construction' ? 'interest_only' : 'standard',
    }));
    setStep(2);
  }

  // Live computed values for step 3
  const liveCalc = useMemo(() => {
    const p = Number(form.principal) || 0;
    const r = Number(form.interest_rate) || 0;
    const n = Number(form.term_months) || 0;
    if (p <= 0 || n <= 0) return null;
    const monthlyRate = r / 12;
    const pmt = monthlyRate === 0
      ? p / n
      : p * monthlyRate * Math.pow(1 + monthlyRate, n) / (Math.pow(1 + monthlyRate, n) - 1);
    const totalPaid = pmt * n;
    const totalInterest = totalPaid - p;
    return {
      monthly_payment: Math.round(pmt * 100) / 100,
      total_paid: Math.round(totalPaid * 100) / 100,
      total_interest: Math.round(totalInterest * 100) / 100,
      interest_pct_of_principal: Math.round((totalInterest / p) * 1000) / 10,
    };
  }, [form.principal, form.interest_rate, form.term_months]);

  async function runPrequal() {
    if (!form.principal || !form.interest_rate || !form.term_months) return;
    const result = await (api as any).lfPrequal?.({
      loan_type: typeKey,
      requested_amount: form.principal,
      estimated_rate_pct: form.interest_rate * 100,
      term_months: form.term_months,
      gross_monthly_income: extras.gross_monthly_income || 0,
      existing_monthly_debt: extras.existing_monthly_debt || 0,
      credit_score: extras.credit_score || 0,
    });
    setPrequal(result);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = { ...form, ...(typeKey === 'heloc' ? { amortization_type: 'interest_only' } : {}), payment_amount: liveCalc?.monthly_payment || 0 };
      const res: any = await (api as any).invoke?.('loans:save', payload) || await api.rawQuery('SELECT 1', []);
      // The 'loans:save' channel uses window.electronAPI.invoke directly:
      const saveRes: any = await (window as any).electronAPI.invoke('loans:save', payload);
      if (saveRes?.error) { alert(`Save failed: ${saveRes.error}`); setSaving(false); return; }
      onSaved(saveRes.id || saveRes.loan_id);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
      setSaving(false);
    }
  }

  return (
    <div className="lw-shell">
      {/* Step indicator */}
      <div className="lw-steps">
        {STEPS.map(s => (
          <div key={s.num} className={`lw-step ${step === s.num ? 'active' : step > s.num ? 'done' : ''}`}>
            <span className="lw-step-num">{step > s.num ? '✓' : s.num}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="lw-body">
        {/* Step 1: Pick loan type */}
        {step === 1 && (
          <div>
            <h2 className="module-title">What kind of loan?</h2>
            <p className="text-sm text-text-muted mb-4">Different loan types unlock different features (e.g., HELOC supports draws, mortgage gets PMI tracking, construction supports draw schedule).</p>
            <div className="lw-type-grid">
              {LOAN_TYPES.map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.key} type="button" className={`lw-type-card ${typeKey === t.key ? 'is-selected' : ''}`} onClick={() => pickType(t)}>
                    <div className="lw-type-icon"><Icon size={16} /></div>
                    <div className="lw-type-name">{t.name}</div>
                    <div className="lw-type-desc">{t.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Borrower & Details */}
        {step === 2 && selectedType && (
          <div>
            <h2 className="module-title">Loan Details</h2>
            <p className="text-sm text-text-muted mb-4">
              Selected: <span className={`lf-type-pill ${selectedType.key}`}>{selectedType.name}</span>
            </p>

            <div className="lw-section">Loan Identity</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Loan Name</label>
                <input className="block-input" placeholder="e.g. BMO Mortgage 2026" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Lender</label>
                <input className="block-input" placeholder="Lender name" value={form.lender_name} onChange={e => setForm({ ...form, lender_name: e.target.value })} />
              </div>
            </div>

            <div className="lw-section">Borrower (for pre-qualification)</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Credit Score</label>
                <input type="number" className="block-input" placeholder="700" value={extras.credit_score || ''} onChange={e => setExtras({ ...extras, credit_score: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Gross Monthly Income</label>
                <input type="number" className="block-input" placeholder="6000" value={extras.gross_monthly_income || ''} onChange={e => setExtras({ ...extras, gross_monthly_income: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Existing Monthly Debt</label>
                <input type="number" className="block-input" placeholder="800" value={extras.existing_monthly_debt || ''} onChange={e => setExtras({ ...extras, existing_monthly_debt: Number(e.target.value) || 0 })} />
              </div>
            </div>

            {/* Type-specific fields */}
            {selectedType.key === 'mortgage' && (
              <>
                <div className="lw-section">Mortgage Details</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">Property Value</label>
                    <input type="number" className="block-input" value={extras.property_value || ''} onChange={e => setExtras({ ...extras, property_value: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">Down Payment</label>
                    <input type="number" className="block-input" value={extras.down_payment || ''} onChange={e => setExtras({ ...extras, down_payment: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              </>
            )}
            {selectedType.key === 'heloc' && (
              <>
                <div className="lw-section">HELOC Details</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">Credit Limit</label>
                    <input type="number" className="block-input" value={extras.credit_limit || ''} onChange={e => setExtras({ ...extras, credit_limit: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">Draw Period (months)</label>
                    <input type="number" className="block-input" placeholder="120" value={extras.draw_period_months || 120} onChange={e => setExtras({ ...extras, draw_period_months: Number(e.target.value) || 120 })} />
                  </div>
                </div>
              </>
            )}
            {selectedType.key === 'student' && (
              <>
                <div className="lw-section">Student Loan Details</div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">Loan Source</label>
                    <select className="block-input" value={extras.federal_or_private || 'federal'} onChange={e => setExtras({ ...extras, federal_or_private: e.target.value })}>
                      <option value="federal">Federal</option>
                      <option value="private">Private</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">IDR Plan</label>
                    <select className="block-input" value={extras.idr_plan || ''} onChange={e => setExtras({ ...extras, idr_plan: e.target.value })}>
                      <option value="">— None (standard) —</option>
                      <option value="PAYE">PAYE</option>
                      <option value="REPAYE">REPAYE</option>
                      <option value="IBR_new">IBR (new)</option>
                      <option value="IBR_old">IBR (old)</option>
                      <option value="ICR">ICR</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">PSLF Eligible?</label>
                    <select className="block-input" value={extras.pslf || 'no'} onChange={e => setExtras({ ...extras, pslf: e.target.value })}>
                      <option value="no">No</option>
                      <option value="yes">Yes (qualifying employer)</option>
                    </select>
                  </div>
                </div>
              </>
            )}
            {selectedType.key === 'construction' && (
              <>
                <div className="lw-section">Construction Details</div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">Build Months</label>
                    <input type="number" className="block-input" placeholder="12" value={extras.construction_months || 12} onChange={e => setExtras({ ...extras, construction_months: Number(e.target.value) || 12 })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">Interest Reserve %</label>
                    <input type="number" step="0.1" className="block-input" placeholder="5" value={extras.interest_reserve_pct || 5} onChange={e => setExtras({ ...extras, interest_reserve_pct: Number(e.target.value) || 5 })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase"># of Draws</label>
                    <input type="number" className="block-input" placeholder="6" value={extras.draws || 6} onChange={e => setExtras({ ...extras, draws: Number(e.target.value) || 6 })} />
                  </div>
                </div>
              </>
            )}
            {selectedType.key === 'sba' && (
              <>
                <div className="lw-section">SBA Program</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">Program</label>
                    <select className="block-input" value={extras.sba_program || '7a'} onChange={e => setExtras({ ...extras, sba_program: e.target.value })}>
                      <option value="7a">7(a) — General business</option>
                      <option value="504">504 — Real estate / equipment</option>
                      <option value="microloan">Microloan</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-muted uppercase">NAICS Code</label>
                    <input className="block-input" placeholder="e.g. 541512" value={extras.naics_code || ''} onChange={e => setExtras({ ...extras, naics_code: e.target.value })} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: Terms & Math */}
        {step === 3 && selectedType && (
          <div>
            <h2 className="module-title">Terms &amp; Math</h2>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Principal ($)</label>
                <input type="number" step="0.01" className="block-input" value={form.principal || ''} onChange={e => setForm({ ...form, principal: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Interest Rate (%)</label>
                <input type="number" step="0.01" className="block-input" value={(form.interest_rate * 100).toFixed(3)} onChange={e => setForm({ ...form, interest_rate: (Number(e.target.value) || 0) / 100 })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Term (months)</label>
                <input type="number" className="block-input" value={form.term_months || ''} onChange={e => setForm({ ...form, term_months: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Rate Type</label>
                <select className="block-input" value={form.rate_type} onChange={e => setForm({ ...form, rate_type: e.target.value })}>
                  <option value="fixed">Fixed</option>
                  <option value="variable">Variable</option>
                  <option value="arm">ARM</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Frequency</label>
                <select className="block-input" value={form.payment_frequency} onChange={e => setForm({ ...form, payment_frequency: e.target.value })}>
                  <option value="monthly">Monthly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="weekly">Weekly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Amortization</label>
                <select className="block-input" value={form.amortization_type} onChange={e => setForm({ ...form, amortization_type: e.target.value })}>
                  <option value="standard">Standard</option>
                  <option value="interest_only">Interest-only</option>
                  <option value="balloon">Balloon</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>

            {liveCalc && (
              <div className="lw-calc-preview">
                <div className="lw-calc-preview-row"><span>Monthly Payment</span><span>{formatCurrency(liveCalc.monthly_payment)}</span></div>
                <div className="lw-calc-preview-row"><span>Total of Payments</span><span>{formatCurrency(liveCalc.total_paid)}</span></div>
                <div className="lw-calc-preview-row"><span>Total Interest</span><span>{formatCurrency(liveCalc.total_interest)}</span></div>
                <div className="lw-calc-preview-row highlight"><span>Interest as % of Principal</span><span>{liveCalc.interest_pct_of_principal}%</span></div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              <button type="button" className="lw-nav-btn" onClick={runPrequal}>Run Pre-Qualification</button>
              {prequal?.verdict && (
                <div className={`lf-verdict-card ${prequal.verdict}`} style={{ padding: '6px 14px' }}>
                  <span className="lf-verdict-headline" style={{ fontSize: 12 }}>{prequal.verdict.replace('_', ' ')}</span>
                </div>
              )}
            </div>
            {prequal && !prequal.error && (
              <div className="lw-calc-preview" style={{ marginTop: 12 }}>
                <div className="lw-calc-preview-row"><span>Proposed Monthly Payment</span><span>{formatCurrency(prequal.proposed_monthly_payment || 0)}</span></div>
                {prequal.dti_with_loan_pct != null && (
                  <div className="lw-calc-preview-row"><span>DTI w/ this loan</span><span>{prequal.dti_with_loan_pct}% (max {prequal.max_dti_pct}%)</span></div>
                )}
                <div className="lw-calc-preview-row"><span>Credit Score</span><span>{prequal.credit_score} (min {prequal.min_credit_score})</span></div>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Documents */}
        {step === 4 && selectedType && (
          <div>
            <h2 className="module-title">Documents &amp; Disclosures</h2>
            <p className="text-sm text-text-muted mb-3">Required disclosures vary by loan type. These are placeholders — generate the actual documents after the loan is saved.</p>
            <div className="space-y-2">
              {(selectedType.key === 'mortgage' || selectedType.key === 'heloc') && (
                <>
                  <div className="lf-disclosure-card">
                    <div className="lf-disclosure-icon"><FileText size={18} /></div>
                    <div>
                      <div className="lf-disclosure-name">Loan Estimate (LE)</div>
                      <div className="lf-disclosure-meta">3-page TRID disclosure — required within 3 business days of application</div>
                    </div>
                    <span className="lf-disclosure-status" style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>Generate later</span>
                  </div>
                  <div className="lf-disclosure-card">
                    <div className="lf-disclosure-icon"><FileText size={18} /></div>
                    <div>
                      <div className="lf-disclosure-name">Closing Disclosure (CD)</div>
                      <div className="lf-disclosure-meta">5-page document required 3 business days before closing</div>
                    </div>
                    <span className="lf-disclosure-status" style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>Generate later</span>
                  </div>
                </>
              )}
              <div className="lf-disclosure-card">
                <div className="lf-disclosure-icon"><FileText size={18} /></div>
                <div>
                  <div className="lf-disclosure-name">Truth in Lending (TIL)</div>
                  <div className="lf-disclosure-meta">APR, finance charge, amount financed, total of payments</div>
                </div>
                <span className="lf-disclosure-status" style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>Generate later</span>
              </div>
              {(selectedType.key === 'business' || selectedType.key === 'sba' || selectedType.key === 'personal') && (
                <div className="lf-disclosure-card">
                  <div className="lf-disclosure-icon"><FileText size={18} /></div>
                  <div>
                    <div className="lf-disclosure-name">Promissory Note</div>
                    <div className="lf-disclosure-meta">Borrower's written promise to repay — required for non-mortgage loans</div>
                  </div>
                  <span className="lf-disclosure-status" style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>Generate later</span>
                </div>
              )}
            </div>
            <div className="lf-warning mt-3" style={{ marginTop: 12 }}>
              <span className="lf-warning-icon">⚠</span>
              <span>Disclosures will be generated after save. Use the loan detail page → "Generate disclosures" to create them on demand.</span>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && selectedType && (
          <div>
            <h2 className="module-title">Review &amp; Save</h2>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="lf-stat-card">
                <div className="lf-stat-label">Loan Type</div>
                <div className="lf-stat-value" style={{ fontSize: 14 }}><span className={`lf-type-pill ${selectedType.key}`}>{selectedType.name}</span></div>
              </div>
              <div className="lf-stat-card">
                <div className="lf-stat-label">Loan Name</div>
                <div className="lf-stat-value" style={{ fontSize: 14 }}>{form.name || '(unnamed)'}</div>
              </div>
              <div className="lf-stat-card">
                <div className="lf-stat-label">Principal</div>
                <div className="lf-stat-value">{formatCurrency(form.principal)}</div>
              </div>
              <div className="lf-stat-card">
                <div className="lf-stat-label">Rate</div>
                <div className="lf-stat-value">{(form.interest_rate * 100).toFixed(3)}%</div>
                <div className="lf-stat-sub">{form.rate_type}</div>
              </div>
              <div className="lf-stat-card">
                <div className="lf-stat-label">Term</div>
                <div className="lf-stat-value">{form.term_months} mo</div>
                <div className="lf-stat-sub">{form.payment_frequency} · {form.amortization_type}</div>
              </div>
              {liveCalc && (
                <div className="lf-stat-card">
                  <div className="lf-stat-label">Monthly Payment</div>
                  <div className="lf-stat-value">{formatCurrency(liveCalc.monthly_payment)}</div>
                  <div className="lf-stat-sub">Total interest {formatCurrency(liveCalc.total_interest)}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="lw-nav">
        <div className="flex gap-2">
          <button type="button" className="lw-nav-btn" onClick={onCancel}><X size={11} style={{ marginRight: 4 }} />Cancel</button>
          {step > 1 && <button type="button" className="lw-nav-btn" onClick={() => setStep(step - 1)}><ChevronLeft size={11} style={{ marginRight: 4 }} />Back</button>}
        </div>
        <div className="flex gap-2">
          {step < 5 && step >= 2 && (
            <button type="button" className="lw-nav-btn primary" onClick={() => setStep(step + 1)} disabled={step === 2 && !form.name}>
              Next<ChevronRight size={11} style={{ marginLeft: 4 }} />
            </button>
          )}
          {step === 5 && (
            <button type="button" className="lw-nav-btn primary" onClick={save} disabled={saving}>
              <Save size={11} style={{ marginRight: 4 }} />{saving ? 'Saving…' : 'Save Loan'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
