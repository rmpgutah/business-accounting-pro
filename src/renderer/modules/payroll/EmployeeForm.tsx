import React, { useEffect, useState } from 'react';
import { ArrowLeft, Users } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface EmployeeFormData {
  name: string;
  email: string;
  type: 'employee' | 'contractor';
  pay_type: 'salary' | 'hourly';
  pay_rate: string;
  pay_schedule: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  filing_status: 'single' | 'married_joint' | 'married_separate' | 'head_household';
  federal_allowances: string;
  state: string;
  state_allowances: string;
  start_date: string;
  ssn_last4: string;
  status: 'active' | 'inactive';
  employment_type: 'full-time' | 'part-time' | 'contractor';
  department: string;
  job_title: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  routing_number: string;
  account_number: string;
  account_type: 'checking' | 'savings';
  notes: string;
}

interface EmployeeFormProps {
  employeeId?: string | null;
  onBack: () => void;
  onSaved: () => void;
}

const EMPTY_FORM: EmployeeFormData = {
  name: '',
  email: '',
  type: 'employee',
  pay_type: 'salary',
  pay_rate: '',
  pay_schedule: 'biweekly',
  filing_status: 'single',
  federal_allowances: '0',
  state: '',
  state_allowances: '0',
  start_date: '',
  ssn_last4: '',
  status: 'active',
  employment_type: 'full-time',
  department: '',
  job_title: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  routing_number: '',
  account_number: '',
  account_type: 'checking',
  notes: '',
};

const FILING_STATUS_LABELS: Record<string, string> = {
  single: 'Single',
  married_joint: 'Married Filing Jointly',
  married_separate: 'Married Filing Separately',
  head_household: 'Head of Household',
};

// ─── Component ──────────────────────────────────────────
const EmployeeForm: React.FC<EmployeeFormProps> = ({ employeeId, onBack, onSaved }) => {
  const [form, setForm] = useState<EmployeeFormData>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'hr' | 'banking'>('general');

  const isEditing = Boolean(employeeId);

  // ─── Load existing employee ─────────────────────────
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const emp = await api.get('employees', employeeId);
        if (!cancelled && emp) {
          setForm({
            name: emp.name ?? '',
            email: emp.email ?? '',
            type: emp.type ?? 'employee',
            pay_type: emp.pay_type ?? 'salary',
            pay_rate: emp.pay_rate != null ? String(emp.pay_rate) : '',
            pay_schedule: emp.pay_schedule ?? 'biweekly',
            filing_status: emp.filing_status ?? 'single',
            federal_allowances: emp.federal_allowances != null ? String(emp.federal_allowances) : '0',
            state: emp.state ?? '',
            state_allowances: emp.state_allowances != null ? String(emp.state_allowances) : '0',
            start_date: emp.start_date ?? '',
            ssn_last4: emp.ssn_last4 ?? '',
            status: emp.status ?? 'active',
            employment_type: emp.employment_type ?? 'full-time',
            department: emp.department ?? '',
            job_title: emp.job_title ?? '',
            emergency_contact_name: emp.emergency_contact_name ?? '',
            emergency_contact_phone: emp.emergency_contact_phone ?? '',
            routing_number: emp.routing_number ?? '',
            account_number: emp.account_number ?? '',
            account_type: emp.account_type ?? 'checking',
            notes: emp.notes ?? '',
          });
        }
      } catch (err) {
        console.error('Failed to load employee:', err);
        setError('Failed to load employee data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [employeeId]);

  // ─── Field updater ──────────────────────────────────
  const setField = <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ─── SSN masked input handler ───────────────────────
  const handleSsnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
    setField('ssn_last4', raw);
  };

  // ─── Save ───────────────────────────────────────────
  const handleSave = async () => {
    setError(null);

    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!form.pay_rate.trim()) {
      setError('Pay rate is required.');
      return;
    }
    if (isNaN(Number(form.pay_rate))) {
      setError('Pay rate must be a number.');
      return;
    }
    if (Number(form.pay_rate) <= 0) {
      setError('Pay rate must be greater than zero.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        type: form.type,
        pay_type: form.pay_type,
        pay_rate: Number(form.pay_rate),
        pay_schedule: form.pay_schedule,
        filing_status: form.filing_status,
        federal_allowances: Number(form.federal_allowances) || 0,
        state: form.state.trim(),
        state_allowances: Number(form.state_allowances) || 0,
        start_date: form.start_date,
        ssn_last4: form.ssn_last4,
        status: form.status,
        employment_type: form.employment_type,
        department: form.department.trim(),
        job_title: form.job_title.trim(),
        emergency_contact_name: form.emergency_contact_name.trim(),
        emergency_contact_phone: form.emergency_contact_phone.trim(),
        routing_number: form.routing_number.trim(),
        account_number: form.account_number.trim(),
        account_type: form.account_type,
        notes: form.notes.trim(),
      };

      if (isEditing && employeeId) {
        await api.update('employees', employeeId, payload);
      } else {
        await api.create('employees', payload);
      }
      onSaved();
    } catch (err: any) {
      console.error('Failed to save employee:', err);
      setError(err?.message ?? 'Failed to save employee.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm font-mono">Loading employee...</span>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <Users size={20} className="text-text-muted" />
          <h1 className="text-lg font-bold text-text-primary">
            {isEditing ? 'Edit Employee' : 'New Employee'}
          </h1>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="block-card bg-accent-expense/10 border-accent-expense text-accent-expense text-sm px-4 py-3" style={{ borderRadius: '6px' }}>
          {error}
        </div>
      )}

      {/* Form */}
      <div className="block-card p-6" style={{ borderRadius: '6px' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border-primary)', marginBottom: 20 }}>
          {(['general', 'hr', 'banking'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 20px', fontSize: '12px', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.6px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderBottom: activeTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              {tab === 'general' ? 'General' : tab === 'hr' ? 'HR & Profile' : 'Banking & Emergency'}
            </button>
          ))}
        </div>

        {/* General tab — all existing fields */}
        {activeTab === 'general' && (
          <div className="space-y-6">
            {/* Basic Info */}
            <div>
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Basic Information</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Name *</label>
                  <input
                    className="block-input w-full"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Email</label>
                  <input
                    className="block-input w-full"
                    type="email"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Type</label>
                  <select
                    className="block-select w-full"
                    value={form.type}
                    onChange={(e) => setField('type', e.target.value as 'employee' | 'contractor')}
                  >
                    <option value="employee">Employee</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Status</label>
                  <select
                    className="block-select w-full"
                    value={form.status}
                    onChange={(e) => setField('status', e.target.value as 'active' | 'inactive')}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Start Date</label>
                  <input
                    className="block-input w-full"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setField('start_date', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">SSN (Last 4)</label>
                  <input
                    className="block-input w-full font-mono"
                    value={form.ssn_last4 ? `***-**-${form.ssn_last4.padStart(4, '_')}` : ''}
                    onChange={handleSsnChange}
                    placeholder="***-**-____"
                    maxLength={13}
                  />
                  <p className="text-[10px] text-text-muted mt-1">Only the last 4 digits are stored</p>
                </div>
              </div>
            </div>

            {/* Compensation */}
            <div>
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Compensation</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Pay Type</label>
                  <select
                    className="block-select w-full"
                    value={form.pay_type}
                    onChange={(e) => setField('pay_type', e.target.value as 'salary' | 'hourly')}
                  >
                    <option value="salary">Salary</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">
                    Pay Rate * {form.pay_type === 'salary' ? '(Annual)' : '(Per Hour)'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
                    <input
                      className="block-input w-full pl-6 font-mono"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.pay_rate}
                      onChange={(e) => setField('pay_rate', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Pay Schedule</label>
                  <select
                    className="block-select w-full"
                    value={form.pay_schedule}
                    onChange={(e) => setField('pay_schedule', e.target.value as EmployeeFormData['pay_schedule'])}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="semimonthly">Semi-monthly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Tax Info (only for employees) */}
            {form.type === 'employee' && (
              <div>
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Tax Information</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Filing Status</label>
                    <select
                      className="block-select w-full"
                      value={form.filing_status}
                      onChange={(e) => setField('filing_status', e.target.value as EmployeeFormData['filing_status'])}
                    >
                      {Object.entries(FILING_STATUS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Federal Allowances</label>
                    <input
                      className="block-input w-full font-mono"
                      type="number"
                      min="0"
                      value={form.federal_allowances}
                      onChange={(e) => setField('federal_allowances', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">State</label>
                    <input
                      className="block-input w-full"
                      value={form.state}
                      onChange={(e) => setField('state', e.target.value)}
                      placeholder="e.g. CA, NY, TX"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">State Allowances</label>
                    <input
                      className="block-input w-full font-mono"
                      type="number"
                      min="0"
                      value={form.state_allowances}
                      onChange={(e) => setField('state_allowances', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* HR tab */}
        {activeTab === 'hr' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Employment Type</label>
              <select className="block-select w-full" value={form.employment_type} onChange={(e) => setForm(p => ({ ...p, employment_type: e.target.value as any }))}>
                <option value="full-time">Full-Time</option>
                <option value="part-time">Part-Time</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Department</label>
              <input className="block-input w-full" value={form.department} onChange={(e) => setForm(p => ({ ...p, department: e.target.value }))} placeholder="e.g. Engineering" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Job Title</label>
              <input className="block-input w-full" value={form.job_title} onChange={(e) => setForm(p => ({ ...p, job_title: e.target.value }))} placeholder="e.g. Senior Developer" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Notes</label>
              <textarea className="block-input w-full" rows={4} value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Internal HR notes..." style={{ resize: 'vertical' }} />
            </div>
          </div>
        )}

        {/* Banking & Emergency tab */}
        {activeTab === 'banking' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Direct Deposit</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Routing Number</label>
              <input className="block-input w-full font-mono" value={form.routing_number} onChange={(e) => setForm(p => ({ ...p, routing_number: e.target.value }))} placeholder="9 digits" maxLength={9} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Number</label>
              <input className="block-input w-full font-mono" value={form.account_number} onChange={(e) => setForm(p => ({ ...p, account_number: e.target.value }))} placeholder="Account number" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Type</label>
              <select className="block-select w-full" value={form.account_type} onChange={(e) => setForm(p => ({ ...p, account_type: e.target.value as any }))}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </div>
            <div className="col-span-2" style={{ marginTop: 16 }}>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Emergency Contact</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contact Name</label>
              <input className="block-input w-full" value={form.emergency_contact_name} onChange={(e) => setForm(p => ({ ...p, emergency_contact_name: e.target.value }))} placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contact Phone</label>
              <input className="block-input w-full" value={form.emergency_contact_phone} onChange={(e) => setForm(p => ({ ...p, emergency_contact_phone: e.target.value }))} placeholder="(555) 000-0000" />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 justify-end">
        <button
          className="block-btn text-text-secondary hover:text-text-primary px-4 py-2 text-sm"
          onClick={onBack}
        >
          Cancel
        </button>
        <button
          className="block-btn-primary inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : isEditing ? 'Update Employee' : 'Create Employee'}
        </button>
      </div>
    </div>
  );
};

export default EmployeeForm;
