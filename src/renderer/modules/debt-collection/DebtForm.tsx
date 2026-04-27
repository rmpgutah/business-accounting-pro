import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Scale, Save, DollarSign } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';
import { required, validateForm, minValue } from '../../lib/validation';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import {
  DEBT_RISK, DEBT_SEGMENT, DEBT_ORIGINATION, DEBT_COLLECTABILITY,
  ClassificationSelect, riskCategoryFromScore,
} from '../../lib/classifications';

// ─── Types ──────────────────────────────────────────────
interface DebtFormData {
  debtor_type: 'client' | 'vendor' | 'employee' | 'custom';
  debtor_id: string;
  debtor_name: string;
  debtor_email: string;
  debtor_phone: string;
  debtor_address: string;
  source_type: 'manual' | 'invoice' | 'bill';
  source_id: string;
  original_amount: string;
  due_date: string;
  delinquent_date: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assigned_to: string;
  notes: string;
  interest_rate: string;
  interest_type: 'simple' | 'compound';
  compound_frequency: string;
  interest_start_date: string;
  jurisdiction: string;
  statute_years: string;
  employer_name: string;
  employment_status: 'unknown' | 'employed' | 'self-employed' | 'unemployed' | 'retired';
  monthly_income_estimate: number;
  best_contact_time: string;
  preferred_contact_method: string;
  do_not_call: boolean;
  cease_desist_active: boolean;
  debtor_attorney_name: string;
  debtor_attorney_phone: string;
  // Feature 2: Financial Profile
  debtor_ssn_last4: string;
  debtor_dob: string;
  debtor_employer: string;
  debtor_income_monthly: number;
  debtor_assets_description: string;
  debtor_bank_name: string;
  // Feature 6: Credit Score
  credit_score: number;
  credit_score_date: string;
  credit_score_source: string;
  // Feature 10: Multi-Currency
  currency: string;
  exchange_rate: number;
  // Feature 16: Interest Freeze
  interest_frozen: boolean;
  interest_frozen_reason: string;
  // Feature 18: Collection Costs
  collection_costs: number;
  agency_commission_rate: number;
  agency_commission_paid: number;
  // Classifications
  risk_category: string;
  segment: string;
  origination_type: string;
  collectability: string;
}

interface DropdownOption {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  // invoice/bill fields
  total?: number;
  amount_paid?: number;
  // Extended context fields
  industry?: string;
  company_size?: string;
  credit_limit?: number;
  preferred_payment_method?: string;
  default_payment_terms?: string;
  job_title?: string;
  department?: string;
  employment_type?: string;
  w9_status?: string;
  is_1099_eligible?: number;
}

interface DebtFormProps {
  debtId?: string | null;
  debtType: 'receivable' | 'payable';
  onBack: () => void;
  onSaved: () => void;
}

// ─── US States ──────────────────────────────────────────
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming', 'Other',
];

const emptyForm: DebtFormData = {
  debtor_type: 'client',
  debtor_id: '',
  debtor_name: '',
  debtor_email: '',
  debtor_phone: '',
  debtor_address: '',
  source_type: 'manual',
  source_id: '',
  original_amount: '',
  due_date: '',
  delinquent_date: '',
  priority: 'medium',
  assigned_to: '',
  notes: '',
  interest_rate: '',
  interest_type: 'simple',
  compound_frequency: '12',
  interest_start_date: '',
  jurisdiction: '',
  statute_years: '',
  employer_name: '',
  employment_status: 'unknown',
  monthly_income_estimate: 0,
  best_contact_time: '',
  preferred_contact_method: '',
  do_not_call: false,
  cease_desist_active: false,
  debtor_attorney_name: '',
  debtor_attorney_phone: '',
  debtor_ssn_last4: '',
  debtor_dob: '',
  debtor_employer: '',
  debtor_income_monthly: 0,
  debtor_assets_description: '',
  debtor_bank_name: '',
  credit_score: 0,
  credit_score_date: '',
  credit_score_source: '',
  currency: 'USD',
  exchange_rate: 1.0,
  interest_frozen: false,
  interest_frozen_reason: '',
  collection_costs: 0,
  agency_commission_rate: 0,
  agency_commission_paid: 0,
  risk_category: '',
  segment: '',
  origination_type: '',
  collectability: '',
};

// ─── Component ──────────────────────────────────────────
const DebtForm: React.FC<DebtFormProps> = ({ debtId, debtType, onBack, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [form, setForm] = useState<DebtFormData>({ ...emptyForm });
  const [clients, setClients] = useState<DropdownOption[]>([]);
  const [vendors, setVendors] = useState<DropdownOption[]>([]);
  const [employees, setEmployees] = useState<DropdownOption[]>([]);
  const [invoices, setInvoices] = useState<DropdownOption[]>([]);
  const [bills, setBills] = useState<DropdownOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState('');
  const [selectedAccountInfo, setSelectedAccountInfo] = useState<DropdownOption | null>(null);

  const isEditing = !!debtId;

  // ── Pre-fill from invoice navigation ──
  useEffect(() => {
    const sourceInvoice = sessionStorage.getItem('nav:source_invoice');
    if (sourceInvoice && !debtId) {
      sessionStorage.removeItem('nav:source_invoice');
      setForm(prev => ({ ...prev, source_type: 'invoice', source_id: sourceInvoice }));
      api.get('invoices', sourceInvoice).then((inv: any) => {
        if (inv) {
          const balance = (inv.total || inv.amount || 0) - (inv.amount_paid || 0);
          setForm(prev => ({ ...prev, original_amount: balance.toFixed(2) }));
          if (inv.client_id) {
            api.get('clients', inv.client_id).then((client: any) => {
              if (client) {
                setForm(prev => ({
                  ...prev,
                  debtor_type: 'client',
                  debtor_id: inv.client_id,
                  debtor_name: client.name || '',
                  debtor_email: client.email || '',
                  debtor_phone: client.phone || '',
                  debtor_address: [client.address_line1, client.city, client.state, client.zip].filter(Boolean).join(', '),
                }));
                setSelectedAccountInfo({
                  id: inv.client_id,
                  name: client.name || '',
                  email: client.email || '',
                  phone: client.phone || '',
                  address: [client.address_line1, client.city, client.state, client.zip].filter(Boolean).join(', '),
                  industry: client.industry,
                  company_size: client.company_size,
                  credit_limit: client.credit_limit,
                  preferred_payment_method: client.preferred_payment_method,
                  default_payment_terms: client.default_payment_terms,
                });
              }
            });
          }
        }
      });
    }
  }, []);

  // ── Load data ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const cid = activeCompany.id;

        // Critical: clients + vendors (debtor selection)
        const [clientData, vendorData] = await Promise.all([
          api.query('clients', { company_id: cid }),
          api.query('vendors', { company_id: cid }),
        ]);
        if (cancelled) return;

        setClients(Array.isArray(clientData) ? clientData : []);
        setVendors(Array.isArray(vendorData) ? vendorData : []);

        // Non-critical secondary data — failures don't hide primary content
        api.query('employees', { company_id: cid })
          .then(r => {
            if (!cancelled) setEmployees((Array.isArray(r) ? r : []).map((emp: any) => ({
              ...emp,
              name: emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
              address: [emp.address_line1, emp.city, emp.state, emp.zip].filter(Boolean).join(', '),
            })));
          })
          .catch(() => {});
        api.query('invoices', { company_id: cid, status: 'overdue' })
          .then(r => {
            if (!cancelled) setInvoices((Array.isArray(r) ? r : []).map((inv: any) => ({
              ...inv,
              name: `${inv.invoice_number || inv.id.slice(0, 8)} — ${formatCurrency((inv.total || 0) - (inv.amount_paid || 0))} due`,
            })));
          })
          .catch(() => {});
        api.query('bills', { company_id: cid })
          .then(r => {
            if (!cancelled) setBills((Array.isArray(r) ? r : []).map((bill: any) => ({
              ...bill,
              name: `${bill.bill_number || bill.id.slice(0, 8)} — ${formatCurrency((bill.total || 0) - (bill.amount_paid || 0))} due`,
            })));
          })
          .catch(() => {});

        if (debtId) {
          const existing = await api.get('debts', debtId);
          if (existing && !cancelled) {
            setForm({
              debtor_type: existing.debtor_type || 'custom',
              debtor_id: existing.debtor_id || '',
              debtor_name: existing.debtor_name || '',
              debtor_email: existing.debtor_email || '',
              debtor_phone: existing.debtor_phone || '',
              debtor_address: existing.debtor_address || '',
              source_type: existing.source_type || 'manual',
              source_id: existing.source_id || '',
              original_amount: existing.original_amount?.toString() || '',
              due_date: existing.due_date || '',
              delinquent_date: existing.delinquent_date || '',
              priority: existing.priority || 'medium',
              assigned_to: existing.assigned_to || '',
              notes: existing.notes || '',
              interest_rate: existing.interest_rate != null
                ? (existing.interest_rate * 100).toString()
                : '',
              interest_type: existing.interest_type || 'simple',
              compound_frequency: existing.compound_frequency?.toString() || '12',
              interest_start_date: existing.interest_start_date || '',
              jurisdiction: existing.jurisdiction || '',
              statute_years: existing.statute_years?.toString() || '',
              employer_name: existing.employer_name ?? '',
              employment_status: existing.employment_status ?? 'unknown',
              monthly_income_estimate: Number(existing.monthly_income_estimate || 0),
              best_contact_time: existing.best_contact_time ?? '',
              preferred_contact_method: existing.preferred_contact_method ?? '',
              do_not_call: !!existing.do_not_call,
              cease_desist_active: !!existing.cease_desist_active,
              debtor_attorney_name: existing.debtor_attorney_name ?? '',
              debtor_attorney_phone: existing.debtor_attorney_phone ?? '',
              debtor_ssn_last4: existing.debtor_ssn_last4 ?? '',
              debtor_dob: existing.debtor_dob ?? '',
              debtor_employer: existing.debtor_employer ?? '',
              debtor_income_monthly: Number(existing.debtor_income_monthly || 0),
              debtor_assets_description: existing.debtor_assets_description ?? '',
              debtor_bank_name: existing.debtor_bank_name ?? '',
              credit_score: Number(existing.credit_score || 0),
              credit_score_date: existing.credit_score_date ?? '',
              credit_score_source: existing.credit_score_source ?? '',
              currency: existing.currency ?? 'USD',
              exchange_rate: Number(existing.exchange_rate || 1.0),
              interest_frozen: !!existing.interest_frozen,
              interest_frozen_reason: existing.interest_frozen_reason ?? '',
              collection_costs: Number(existing.collection_costs || 0),
              agency_commission_rate: Number(existing.agency_commission_rate || 0),
              agency_commission_paid: Number(existing.agency_commission_paid || 0),
              risk_category: existing.risk_category ?? '',
              segment: existing.segment ?? '',
              origination_type: existing.origination_type ?? '',
              collectability: existing.collectability ?? '',
            });
          }
        }
      } catch (err) {
        console.error('Failed to load debt form data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [debtId, activeCompany]);

  // ── Handlers ──
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleDebtorTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as 'client' | 'vendor' | 'employee' | 'custom';
    setForm((prev) => ({
      ...prev,
      debtor_type: value,
      debtor_id: '',
      debtor_name: '',
      debtor_email: '',
      debtor_phone: '',
      debtor_address: '',
    }));
    setSelectedAccountInfo(null);
  };

  const handleDebtorSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const list = form.debtor_type === 'client' ? clients : form.debtor_type === 'employee' ? employees : vendors;
    const selected = list.find((item) => item.id === id);
    if (selected) {
      setForm((prev) => ({
        ...prev,
        debtor_id: selected.id,
        debtor_name: selected.name || '',
        debtor_email: selected.email || '',
        debtor_phone: selected.phone || '',
        debtor_address: selected.address || '',
      }));
      setSelectedAccountInfo(selected);

      // Pre-fill employment fields when selecting an employee
      if (form.debtor_type === 'employee' && selected) {
        setForm((prev) => ({
          ...prev,
          employer_name: (selected as any).employer || activeCompany?.name || prev.employer_name,
          employment_status: 'employed',
        }));
      }
    } else {
      setForm((prev) => ({
        ...prev,
        debtor_id: '',
        debtor_name: '',
        debtor_email: '',
        debtor_phone: '',
        debtor_address: '',
      }));
      setSelectedAccountInfo(null);
    }
  };

  const handleSourceTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as 'manual' | 'invoice' | 'bill';
    setForm((prev) => ({
      ...prev,
      source_type: value,
      source_id: '',
      original_amount: value === 'manual' ? prev.original_amount : '',
    }));
  };

  const handleSourceSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const list = form.source_type === 'invoice' ? invoices : bills;
    const selected = list.find((item) => item.id === id);
    if (selected) {
      const total = selected.total || 0;
      const paid = selected.amount_paid || 0;
      setForm((prev) => ({
        ...prev,
        source_id: selected.id,
        original_amount: (total - paid).toFixed(2),
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        source_id: '',
        original_amount: '',
      }));
    }
  };

  // ── Computed: statute of limitations date ──
  const statuteDate = useMemo(() => {
    if (!form.delinquent_date || !form.statute_years) return '';
    const years = parseInt(form.statute_years, 10);
    if (isNaN(years) || years <= 0) return '';
    const d = new Date(form.delinquent_date);
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().split('T')[0];
  }, [form.delinquent_date, form.statute_years]);

  // ── Submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !activeCompany) return;

    const checks: Array<string | null> = [
      required(form.debtor_name, 'Debtor Name'),
      minValue(parseFloat(form.original_amount) || 0, 0.01, 'Original Amount'),
      required(form.due_date, 'Due Date'),
    ];
    const validationErrors = validateForm(checks);
    if (form.debtor_email && !/^\S+@\S+\.\S+$/.test(form.debtor_email)) {
      validationErrors.push('Email is not a valid format');
    }
    if (form.delinquent_date && form.due_date && form.delinquent_date < form.due_date) {
      validationErrors.push('Delinquent date must be on or after due date');
    }
    if (form.interest_start_date && form.delinquent_date && form.interest_start_date < form.delinquent_date) {
      validationErrors.push('Interest start date must be on or after delinquent date');
    }
    if (form.credit_score && (form.credit_score < 300 || form.credit_score > 850)) {
      validationErrors.push('Credit score must be between 300 and 850');
    }
    if (form.currency !== 'USD' && (!form.exchange_rate || form.exchange_rate <= 0)) {
      validationErrors.push('Exchange rate must be greater than zero for non-USD currencies');
    }
    if (form.agency_commission_rate < 0 || form.agency_commission_rate > 100) {
      validationErrors.push('Agency commission % must be between 0 and 100');
    }
    if (form.collection_costs < 0 || form.agency_commission_paid < 0) {
      validationErrors.push('Collection costs and commission paid cannot be negative');
    }
    if (form.interest_rate && (parseFloat(form.interest_rate) < 0 || parseFloat(form.interest_rate) > 100)) {
      validationErrors.push('Interest rate must be between 0 and 100');
    }
    if (form.statute_years && parseInt(form.statute_years, 10) < 0) {
      validationErrors.push('Statute years cannot be negative');
    }
    if (form.debtor_ssn_last4 && form.debtor_ssn_last4.length !== 4) {
      validationErrors.push('SSN last 4 must be exactly 4 digits');
    }
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    setSaving(true);
    setSaveError('');

    try {
      const interestRate = form.interest_rate
        ? parseFloat(form.interest_rate) / 100
        : null;

      const payload: Record<string, any> = {
        type: debtType,
        debtor_type: form.debtor_type,
        debtor_id: form.debtor_id || null,
        debtor_name: form.debtor_name.trim(),
        debtor_email: form.debtor_email.trim() || null,
        debtor_phone: form.debtor_phone.trim() || null,
        debtor_address: form.debtor_address.trim() || null,
        source_type: form.source_type,
        source_id: form.source_id || null,
        original_amount: parseFloat(form.original_amount) || 0,
        due_date: form.due_date,
        delinquent_date: form.delinquent_date || form.due_date,
        priority: form.priority,
        assigned_to: form.assigned_to.trim() || null,
        notes: form.notes.trim() || null,
        interest_rate: interestRate,
        interest_type: form.interest_type,
        compound_frequency: form.interest_type === 'compound'
          ? parseInt(form.compound_frequency, 10) || 12
          : null,
        interest_start_date: form.interest_start_date || form.delinquent_date || form.due_date,
        jurisdiction: form.jurisdiction || null,
        statute_years: form.statute_years ? parseInt(form.statute_years, 10) : null,
        statute_of_limitations_date: statuteDate || null,
        employer_name: form.employer_name.trim() || null,
        employment_status: form.employment_status,
        monthly_income_estimate: form.monthly_income_estimate || null,
        best_contact_time: form.best_contact_time.trim() || null,
        preferred_contact_method: form.preferred_contact_method || null,
        do_not_call: form.do_not_call ? 1 : 0,
        cease_desist_active: form.cease_desist_active ? 1 : 0,
        debtor_attorney_name: form.debtor_attorney_name.trim() || null,
        debtor_attorney_phone: form.debtor_attorney_phone.trim() || null,
        // Feature 2: Financial Profile
        debtor_ssn_last4: form.debtor_ssn_last4.trim() || null,
        debtor_dob: form.debtor_dob || null,
        debtor_employer: form.debtor_employer.trim() || null,
        debtor_income_monthly: form.debtor_income_monthly || null,
        debtor_assets_description: form.debtor_assets_description.trim() || null,
        debtor_bank_name: form.debtor_bank_name.trim() || null,
        // Feature 6: Credit Score
        credit_score: form.credit_score || null,
        credit_score_date: form.credit_score_date || null,
        credit_score_source: form.credit_score_source.trim() || null,
        // Feature 10: Multi-Currency
        currency: form.currency || 'USD',
        exchange_rate: form.exchange_rate || 1.0,
        // Feature 16: Interest Freeze
        interest_frozen: form.interest_frozen ? 1 : 0,
        interest_frozen_reason: form.interest_frozen_reason.trim() || null,
        // Feature 18: Collection Costs
        collection_costs: form.collection_costs || null,
        agency_commission_rate: form.agency_commission_rate || null,
        agency_commission_paid: form.agency_commission_paid || null,
        // Classifications (auto-categorize risk_category from existing risk_score on save)
        risk_category: form.risk_category || '',
        segment: form.segment || '',
        origination_type: form.origination_type || '',
        collectability: form.collectability || '',
      };
      // Auto-categorize risk_category from risk_score if available and user hasn't picked one
      try {
        if (!payload.risk_category && isEditing && debtId) {
          const cur = await api.get('debts', debtId);
          if (cur && Number.isFinite(cur.risk_score)) {
            payload.risk_category = riskCategoryFromScore(cur.risk_score);
          }
        }
      } catch (_) { /* ignore */ }

      if (isEditing && debtId) {
        await api.update('debts', debtId, payload);
      } else {
        payload.company_id = activeCompany.id;
        payload.balance_due = payload.original_amount;
        payload.status = 'active';
        payload.current_stage = 'reminder';
        const newDebt = await api.create('debts', payload);
        // Create initial pipeline stage
        if (newDebt?.id) {
          await api.create('debt_pipeline_stages', {
            debt_id: newDebt.id,
            stage: 'reminder',
          });
        }
      }
      onSaved();
    } catch (err: any) {
      // VISIBILITY: surface save-debt errors instead of swallowing
      console.error('Failed to save debt:', err);
      setSaveError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Title ──
  const title = isEditing
    ? 'Edit Debt'
    : debtType === 'receivable'
      ? 'New Receivable Debt'
      : 'New Payable Debt';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="module-header flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            className="block-btn flex items-center gap-2 px-3 py-2"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex items-center gap-2">
            <Scale size={18} className="text-accent-blue" />
            <h2 className="module-title text-text-primary">{title}</h2>
          </div>
        </div>
        <button
          type="button"
          className="block-btn-primary flex items-center gap-2"
          disabled={saving}
          onClick={handleSubmit as any}
        >
          <Save size={16} />
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Validation Errors */}
      {errors.length > 0 && (
        <div
          style={{
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            padding: '12px 16px',
          }}
        >
          <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
            {errors.map((err, i) => (
              <li key={i} style={{ color: '#ef4444', fontSize: '13px', lineHeight: '1.6' }}>
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {saveError && (
          <ErrorBanner
            message={saveError}
            title="Failed to save debt"
            onDismiss={() => setSaveError('')}
          />
        )}
        {/* Section 1 — Debtor Information */}
        <div className="block-card p-6 mb-4">
          <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
            Debtor Information
          </h3>
          <div className="grid grid-cols-2 gap-5">
            {/* Debtor Type */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Debtor Type
              </label>
              <select
                name="debtor_type"
                className="block-select"
                value={form.debtor_type}
                onChange={handleDebtorTypeChange}
              >
                <option value="client">Client</option>
                <option value="custom">Custom</option>
                <option value="employee">Employee</option>
                <option value="vendor">Vendor</option>
              </select>
            </div>

            {/* Client/Vendor/Employee Dropdown */}
            {form.debtor_type !== 'custom' && (
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Select {form.debtor_type === 'client' ? 'Client' : form.debtor_type === 'employee' ? 'Employee' : 'Vendor'}
                </label>
                <select
                  className="block-select"
                  value={form.debtor_id}
                  onChange={handleDebtorSelect}
                >
                  <option value="">
                    Select {form.debtor_type === 'client' ? 'client' : form.debtor_type === 'employee' ? 'employee' : 'vendor'}...
                  </option>
                  {[...(form.debtor_type === 'client' ? clients : form.debtor_type === 'employee' ? employees : vendors)]
                    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
                    .map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Debtor Name */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Debtor Name <span className="text-accent-expense">*</span>
              </label>
              <input
                type="text"
                name="debtor_name"
                autoComplete="name"
                className="block-input"
                placeholder="Full name or company"
                value={form.debtor_name}
                onChange={handleChange}
                readOnly={form.debtor_type !== 'custom' && !!form.debtor_id}
                required
              />
            </div>

            {/* Debtor Email */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                name="debtor_email"
                autoComplete="email"
                className="block-input"
                placeholder="email@example.com"
                value={form.debtor_email}
                onChange={handleChange}
                readOnly={form.debtor_type !== 'custom' && !!form.debtor_id}
              />
            </div>

            {/* Debtor Phone */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Phone
              </label>
              <input
                type="tel"
                name="debtor_phone"
                autoComplete="tel"
                className="block-input"
                placeholder="(555) 123-4567"
                value={form.debtor_phone}
                onChange={handleChange}
                readOnly={form.debtor_type !== 'custom' && !!form.debtor_id}
              />
            </div>

            {/* Debtor Address */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Address
              </label>
              <input
                type="text"
                name="debtor_address"
                autoComplete="street-address"
                className="block-input"
                placeholder="Street address, city, state"
                value={form.debtor_address}
                onChange={handleChange}
                readOnly={form.debtor_type !== 'custom' && !!form.debtor_id}
              />
            </div>
          </div>

          {/* Account Context — shown when a known entity is selected */}
          {form.debtor_type !== 'custom' && selectedAccountInfo && (
            <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--color-bg-tertiary)', borderRadius: 6, border: '1px solid var(--color-border-primary)' }}>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Account Details</div>
              <div className="grid grid-cols-3 gap-3">
                {form.debtor_type === 'client' && (
                  <>
                    {selectedAccountInfo.industry && (
                      <div><div className="text-xs text-text-muted">Industry</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.industry}</div></div>
                    )}
                    {selectedAccountInfo.company_size && (
                      <div><div className="text-xs text-text-muted">Company Size</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.company_size}</div></div>
                    )}
                    {selectedAccountInfo.credit_limit != null && selectedAccountInfo.credit_limit > 0 && (
                      <div><div className="text-xs text-text-muted">Credit Limit</div><div className="text-xs text-text-primary font-medium">${selectedAccountInfo.credit_limit.toLocaleString()}</div></div>
                    )}
                    {selectedAccountInfo.preferred_payment_method && (
                      <div><div className="text-xs text-text-muted">Preferred Payment</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.preferred_payment_method}</div></div>
                    )}
                    {selectedAccountInfo.default_payment_terms && (
                      <div><div className="text-xs text-text-muted">Default Terms</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.default_payment_terms}</div></div>
                    )}
                  </>
                )}
                {form.debtor_type === 'employee' && (
                  <>
                    {selectedAccountInfo.job_title && (
                      <div><div className="text-xs text-text-muted">Job Title</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.job_title}</div></div>
                    )}
                    {selectedAccountInfo.department && (
                      <div><div className="text-xs text-text-muted">Department</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.department}</div></div>
                    )}
                    {selectedAccountInfo.employment_type && (
                      <div><div className="text-xs text-text-muted">Employment Type</div><div className="text-xs text-text-primary font-medium">{selectedAccountInfo.employment_type}</div></div>
                    )}
                  </>
                )}
                {form.debtor_type === 'vendor' && (
                  <>
                    {selectedAccountInfo.w9_status && (
                      <div><div className="text-xs text-text-muted">W-9 Status</div><div className="text-xs text-text-primary font-medium" style={{ textTransform: 'capitalize' }}>{selectedAccountInfo.w9_status.replace(/_/g, ' ')}</div></div>
                    )}
                    {selectedAccountInfo.is_1099_eligible ? (
                      <div><div className="text-xs text-text-muted">1099 Eligible</div><div className="text-xs font-medium text-accent-revenue">Yes</div></div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Section 2 — Debt Details */}
        <div className="block-card p-6 mb-4">
          <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
            Debt Details
          </h3>
          <div className="grid grid-cols-2 gap-5">
            {/* Source Type */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Source Type
              </label>
              <select
                name="source_type"
                className="block-select"
                value={form.source_type}
                onChange={handleSourceTypeChange}
              >
                <option value="bill">From Bill</option>
                <option value="invoice">From Invoice</option>
                <option value="manual">Manual Entry</option>
              </select>
            </div>

            {/* Invoice/Bill Dropdown */}
            {form.source_type !== 'manual' && (
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Select {form.source_type === 'invoice' ? 'Invoice' : 'Bill'}
                </label>
                <select
                  className="block-select"
                  value={form.source_id}
                  onChange={handleSourceSelect}
                >
                  <option value="">
                    Select {form.source_type === 'invoice' ? 'invoice' : 'bill'}...
                  </option>
                  {[...(form.source_type === 'invoice' ? invoices : bills)]
                    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
                    .map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Original Amount */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Original Amount <span className="text-accent-expense">*</span>
              </label>
              <div className="relative">
                <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="number"
                  name="original_amount"
                  step="0.01"
                  min="0"
                  className="block-input pl-8"
                  placeholder="0.00"
                  value={form.original_amount}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Due Date <span className="text-accent-expense">*</span>
              </label>
              <input
                type="date"
                name="due_date"
                className="block-input"
                value={form.due_date}
                onChange={handleChange}
                required
              />
            </div>

            {/* Delinquent Date */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Delinquent Date
              </label>
              <input
                type="date"
                name="delinquent_date"
                className="block-input"
                value={form.delinquent_date}
                onChange={handleChange}
                placeholder="Defaults to due date"
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Priority
              </label>
              <select
                name="priority"
                className="block-select"
                value={form.priority}
                onChange={handleChange}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
              </select>
            </div>

            {/* Risk Category */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Risk Category</label>
              <ClassificationSelect def={DEBT_RISK} value={form.risk_category} onChange={(v) => setForm(p => ({ ...p, risk_category: v }))} />
            </div>

            {/* Segment */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Segment</label>
              <ClassificationSelect def={DEBT_SEGMENT} value={form.segment} onChange={(v) => setForm(p => ({ ...p, segment: v }))} />
            </div>

            {/* Origination Type */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Origination Type</label>
              <ClassificationSelect def={DEBT_ORIGINATION} value={form.origination_type} onChange={(v) => setForm(p => ({ ...p, origination_type: v }))} />
            </div>

            {/* Collectability */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Collectability</label>
              <ClassificationSelect def={DEBT_COLLECTABILITY} value={form.collectability} onChange={(v) => setForm(p => ({ ...p, collectability: v }))} />
              {form.collectability === 'uncollectable' && (
                <p className="mt-1 text-xs text-accent-warning">Uncollectable: consider triggering a write-off in journal entries.</p>
              )}
            </div>

            {/* Assigned To */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Assigned To
              </label>
              <input
                type="text"
                name="assigned_to"
                className="block-input"
                placeholder="Person responsible"
                value={form.assigned_to}
                onChange={handleChange}
              />
            </div>

            {/* Notes — full width */}
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Notes
              </label>
              <textarea
                name="notes"
                className="block-input"
                rows={4}
                placeholder="Additional details about this debt..."
                value={form.notes}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        {/* Section 3 — Interest Configuration */}
        <div className="block-card p-6 mb-4">
          <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
            Interest Configuration
          </h3>
          <div className="grid grid-cols-2 gap-5">
            {/* Interest Rate */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Annual Interest Rate %
              </label>
              <input
                type="number"
                name="interest_rate"
                step="0.01"
                min="0"
                className="block-input"
                placeholder="e.g. 5.5"
                value={form.interest_rate}
                onChange={handleChange}
              />
            </div>

            {/* Interest Type */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Interest Type
              </label>
              <select
                name="interest_type"
                className="block-select"
                value={form.interest_type}
                onChange={handleChange}
              >
                <option value="compound">Compound</option>
                <option value="simple">Simple</option>
              </select>
            </div>

            {/* Compound Frequency — only if compound */}
            {form.interest_type === 'compound' && (
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Compound Frequency
                </label>
                <select
                  name="compound_frequency"
                  className="block-select"
                  value={form.compound_frequency}
                  onChange={handleChange}
                >
                  <option value="1">Annually</option>
                  <option value="12">Monthly</option>
                  <option value="4">Quarterly</option>
                </select>
              </div>
            )}

            {/* Interest Start Date */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Interest Start Date
              </label>
              <input
                type="date"
                name="interest_start_date"
                className="block-input"
                value={form.interest_start_date}
                onChange={handleChange}
                placeholder="Defaults to delinquent date"
              />
            </div>
          </div>
        </div>

        {/* Section 4 — Legal / Jurisdiction */}
        <div className="block-card p-6 mb-4">
          <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
            Legal / Jurisdiction
          </h3>
          <div className="grid grid-cols-2 gap-5">
            {/* Jurisdiction */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Jurisdiction
              </label>
              <select
                name="jurisdiction"
                className="block-select"
                value={form.jurisdiction}
                onChange={handleChange}
              >
                <option value="">Select state...</option>
                {US_STATES.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>

            {/* Statute of Limitations (years) */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Statute of Limitations (years)
              </label>
              <input
                type="number"
                name="statute_years"
                min="0"
                step="1"
                className="block-input"
                placeholder="e.g. 6"
                value={form.statute_years}
                onChange={handleChange}
              />
            </div>

            {/* Calculated Statute Date */}
            {statuteDate && (
              <div className="col-span-2">
                <div
                  className="flex items-center gap-2 px-4 py-3 bg-bg-tertiary border border-border-secondary text-sm text-text-secondary"
                  style={{ borderRadius: '6px' }}
                >
                  <span className="text-text-muted uppercase text-xs font-semibold tracking-wider">
                    Statute Expires:
                  </span>
                  <span className="text-text-primary font-medium">{statuteDate}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 5 — Debtor Profile */}
        <div className="block-card p-6 mb-4">
          <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
            Debtor Profile
          </h3>
          <div className="grid grid-cols-2 gap-5">
            {/* Debtor Profile header row — intentionally empty, grid continues below */}
            <div className="col-span-2 mt-0">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Employment &amp; Contact Preferences</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Employer</label>
              <input className="block-input" value={form.employer_name} onChange={(e) => setForm(p => ({...p, employer_name: e.target.value}))} placeholder="Employer name" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Employment Status</label>
              <select className="block-select w-full" value={form.employment_status} onChange={(e) => setForm(p => ({...p, employment_status: e.target.value as DebtFormData['employment_status']}))}>
                <option value="employed">Employed</option>
                <option value="retired">Retired</option>
                <option value="self-employed">Self-Employed</option>
                <option value="unemployed">Unemployed</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Est. Monthly Income</label>
              <input type="number" min={0} step="100" className="block-input" value={form.monthly_income_estimate} onChange={(e) => setForm(p => ({...p, monthly_income_estimate: parseFloat(e.target.value) || 0}))} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Best Contact Time</label>
              <input className="block-input" value={form.best_contact_time} onChange={(e) => setForm(p => ({...p, best_contact_time: e.target.value}))} placeholder="e.g. Mornings, after 5pm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Preferred Contact Method</label>
              <select className="block-select w-full" value={form.preferred_contact_method} onChange={(e) => setForm(p => ({...p, preferred_contact_method: e.target.value}))}>
                <option value="">No Preference</option>
                <optgroup label="Digital">
                  <option value="email">Email</option>
                  <option value="text">Text</option>
                </optgroup>
                <optgroup label="Physical">
                  <option value="letter">Letter</option>
                  <option value="phone">Phone</option>
                </optgroup>
              </select>
            </div>
            <div className="flex items-center gap-6 col-span-2">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={form.do_not_call} onChange={(e) => setForm(p => ({...p, do_not_call: e.target.checked}))} />
                <span className="font-semibold uppercase tracking-wider">Do Not Call</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={form.cease_desist_active} onChange={(e) => setForm(p => ({...p, cease_desist_active: e.target.checked}))} />
                <span className="font-semibold uppercase tracking-wider text-red-400">Cease & Desist Active</span>
              </label>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Debtor Attorney</label>
              <input className="block-input" value={form.debtor_attorney_name} onChange={(e) => setForm(p => ({...p, debtor_attorney_name: e.target.value}))} placeholder="Attorney name" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Attorney Phone</label>
              <input className="block-input" type="tel" name="debtor_attorney_phone" autoComplete="tel" value={form.debtor_attorney_phone} onChange={(e) => setForm(p => ({...p, debtor_attorney_phone: e.target.value}))} placeholder="(555) 000-0000" />
            </div>
          </div>
        </div>

        {/* Section 6 — Financial Profile (Feature 2) */}
        <div className="block-card p-6 mb-4">
          <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
            Financial Profile
          </h3>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">SSN Last 4</label>
              <input className="block-input" maxLength={4} placeholder="0000" value={form.debtor_ssn_last4} onChange={(e) => setForm(p => ({...p, debtor_ssn_last4: e.target.value.replace(/\D/g, '').slice(0, 4)}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Date of Birth</label>
              <input type="date" className="block-input" value={form.debtor_dob} onChange={(e) => setForm(p => ({...p, debtor_dob: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Employer</label>
              <input className="block-input" placeholder="Employer name" value={form.debtor_employer} onChange={(e) => setForm(p => ({...p, debtor_employer: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Monthly Income</label>
              <input type="number" min={0} step="100" className="block-input" placeholder="0.00" value={form.debtor_income_monthly || ''} onChange={(e) => setForm(p => ({...p, debtor_income_monthly: parseFloat(e.target.value) || 0}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Bank Name</label>
              <input className="block-input" placeholder="Bank name" value={form.debtor_bank_name} onChange={(e) => setForm(p => ({...p, debtor_bank_name: e.target.value}))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Assets Description</label>
              <textarea className="block-input" rows={2} placeholder="Known assets..." value={form.debtor_assets_description} onChange={(e) => setForm(p => ({...p, debtor_assets_description: e.target.value}))} style={{ resize: 'vertical' }} />
            </div>
          </div>
        </div>

        {/* Section 7 — Credit Score (Feature 6) & Currency (Feature 10) */}
        <div className="block-card p-6 mb-4">
          <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
            Credit & Currency
          </h3>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Credit Score</label>
              <input type="number" min={0} max={850} className="block-input" placeholder="0" value={form.credit_score || ''} onChange={(e) => setForm(p => ({...p, credit_score: parseInt(e.target.value) || 0}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Score Date</label>
              <input type="date" className="block-input" value={form.credit_score_date} onChange={(e) => setForm(p => ({...p, credit_score_date: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Score Source</label>
              <select className="block-select" value={form.credit_score_source} onChange={(e) => setForm(p => ({...p, credit_score_source: e.target.value}))}>
                <option value="">Select source...</option>
                <option value="Equifax">Equifax</option>
                <option value="Experian">Experian</option>
                <option value="Other">Other</option>
                <option value="TransUnion">TransUnion</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Currency</label>
              <select className="block-select" value={form.currency} onChange={(e) => setForm(p => ({...p, currency: e.target.value}))}>
                <option value="AUD">AUD</option>
                <option value="CAD">CAD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="JPY">JPY</option>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>
            {form.currency !== 'USD' && (
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Exchange Rate (to USD)</label>
                <input type="number" min={0} step="0.001" className="block-input" placeholder="1.00" value={form.exchange_rate} onChange={(e) => setForm(p => ({...p, exchange_rate: parseFloat(e.target.value) || 1}))} />
              </div>
            )}
          </div>
        </div>

        {/* Section 8 — Collection Costs (Feature 18) */}
        <div className="block-card p-6 mb-4">
          <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
            Collection Costs
          </h3>
          <div className="grid grid-cols-3 gap-5">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Total Costs</label>
              <input type="number" min={0} step="0.01" className="block-input" placeholder="0.00" value={form.collection_costs || ''} onChange={(e) => setForm(p => ({...p, collection_costs: parseFloat(e.target.value) || 0}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Agency Commission %</label>
              <input type="number" min={0} max={100} step="0.5" className="block-input" placeholder="0" value={form.agency_commission_rate || ''} onChange={(e) => setForm(p => ({...p, agency_commission_rate: parseFloat(e.target.value) || 0}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Commission Paid</label>
              <input type="number" min={0} step="0.01" className="block-input" placeholder="0.00" value={form.agency_commission_paid || ''} onChange={(e) => setForm(p => ({...p, agency_commission_paid: parseFloat(e.target.value) || 0}))} />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            className="block-btn mr-3"
            onClick={onBack}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="block-btn-primary flex items-center gap-2"
            disabled={saving}
          >
            <Save size={16} />
            {saving ? 'Saving...' : isEditing ? 'Update Debt' : 'Save Debt'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default DebtForm;
