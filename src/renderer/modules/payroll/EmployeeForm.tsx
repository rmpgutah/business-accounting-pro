import React, { useEffect, useState } from 'react';
import { ArrowLeft, Users, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';

// ─── Types ──────────────────────────────────────────────
interface EmployeeFormData {
  name: string;
  email: string;
  phone: string;
  type: 'employee' | 'contractor';
  pay_type: 'salary' | 'hourly';
  pay_rate: string;
  pay_schedule: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  filing_status: 'single' | 'married_joint' | 'married_separate' | 'head_household';
  federal_allowances: string;
  state: string;
  state_allowances: string;
  start_date: string;
  ssn: string;           // full 9-digit SSN, displayed masked
  ssn_last4: string;     // legacy field kept for payroll runner compatibility
  status: 'active' | 'inactive';
  employment_type: 'full-time' | 'part-time' | 'contractor';
  department: string;
  job_title: string;
  address_line1: string;
  address_line2: string;
  city: string;
  zip: string;
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
  phone: '',
  type: 'employee',
  pay_type: 'salary',
  pay_rate: '',
  pay_schedule: 'biweekly',
  filing_status: 'single',
  federal_allowances: '0',
  state: '',
  state_allowances: '0',
  start_date: '',
  ssn: '',
  ssn_last4: '',
  status: 'active',
  employment_type: 'full-time',
  department: '',
  job_title: '',
  address_line1: '',
  address_line2: '',
  city: '',
  zip: '',
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

// ─── Pay History ────────────────────────────────────────
const PayHistory: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [stubs, setStubs] = useState<any[]>([]);
  useEffect(() => {
    api.rawQuery(
      `SELECT ps.*, pr.pay_date, pr.pay_period_start, pr.pay_period_end, pr.run_type
       FROM pay_stubs ps
       JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
       WHERE ps.employee_id = ?
       ORDER BY pr.pay_date DESC LIMIT 12`,
      [employeeId]
    ).then(r => setStubs(Array.isArray(r) ? r : [])).catch(() => {});
  }, [employeeId]);

  if (stubs.length === 0) return null;

  return (
    <div className="block-card p-4 mt-4">
      <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Pay History (Last 12)</h3>
      <div className="overflow-x-auto">
        <table className="block-table">
          <thead>
            <tr>
              <th>Pay Date</th>
              <th>Period</th>
              <th>Type</th>
              <th className="text-right">Gross</th>
              <th className="text-right">Taxes</th>
              <th className="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {stubs.map((s: any) => (
              <tr key={s.id}>
                <td className="font-mono text-xs">{formatDate(s.pay_date)}</td>
                <td className="text-xs text-text-muted">{formatDate(s.pay_period_start)} — {formatDate(s.pay_period_end)}</td>
                <td><span className="capitalize text-xs">{s.run_type || 'regular'}</span></td>
                <td className="text-right font-mono">{formatCurrency(s.gross_pay)}</td>
                <td className="text-right font-mono text-accent-expense">{formatCurrency(s.federal_tax + s.state_tax + s.social_security + s.medicare)}</td>
                <td className="text-right font-mono text-accent-income font-bold">{formatCurrency(s.net_pay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Employee Deductions Panel ──────────────────────────
const DeductionsPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [deductions, setDeductions] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', type: 'deduction', calculation: 'fixed', amount: '',
    is_pretax: 1, is_active: 1, effective_date: '', end_date: '',
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const rows = await api.query('employee_deductions', { employee_id: employeeId });
    setDeductions(Array.isArray(rows) ? rows : []);
  };

  useEffect(() => { load(); }, [employeeId]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.amount) return;
    setSaving(true);
    try {
      const payload = {
        employee_id: employeeId,
        name: form.name.trim(),
        type: form.type,
        calculation: form.calculation,
        amount: parseFloat(form.amount) || 0,
        is_pretax: form.is_pretax,
        is_active: form.is_active,
        effective_date: form.effective_date || null,
        end_date: form.end_date || null,
      };
      if (editingId) {
        await api.update('employee_deductions', editingId, payload);
      } else {
        await api.create('employee_deductions', payload);
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ name: '', type: 'deduction', calculation: 'fixed', amount: '', is_pretax: 1, is_active: 1, effective_date: '', end_date: '' });
      await load();
    } catch (err: any) {
      alert('Failed to save deduction: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (d: any) => {
    setEditingId(d.id);
    setForm({
      name: d.name || '',
      type: d.type || 'deduction',
      calculation: d.calculation || 'fixed',
      amount: String(d.amount || ''),
      is_pretax: d.is_pretax ?? 1,
      is_active: d.is_active ?? 1,
      effective_date: d.effective_date || '',
      end_date: d.end_date || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this deduction?')) return;
    await api.remove('employee_deductions', id);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Employee Deductions</h3>
        <button className="block-btn-primary flex items-center gap-2 text-xs" onClick={() => { setEditingId(null); setForm({ name: '', type: 'deduction', calculation: 'fixed', amount: '', is_pretax: 1, is_active: 1, effective_date: '', end_date: '' }); setShowForm(!showForm); }}>
          <Plus size={12} /> {showForm ? 'Cancel' : 'Add Deduction'}
        </button>
      </div>

      {showForm && (
        <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Name *</label>
              <input className="block-input" placeholder="e.g. Health Insurance" value={form.name} onChange={(e) => setForm(f => ({...f, name: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Type</label>
              <select className="block-select" value={form.type} onChange={(e) => setForm(f => ({...f, type: e.target.value}))}>
                {/* Group: Pre-tax (Benefit, Retirement) vs Post-tax (Deduction, Garnishment) — alphabetical within */}
                <optgroup label="Post-Tax">
                  <option value="deduction">Deduction</option>
                  <option value="garnishment">Garnishment</option>
                </optgroup>
                <optgroup label="Pre-Tax">
                  <option value="benefit">Benefit</option>
                  <option value="retirement">Retirement (401k)</option>
                </optgroup>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Calculation</label>
              <select className="block-select" value={form.calculation} onChange={(e) => setForm(f => ({...f, calculation: e.target.value}))}>
                {/* Alphabetical A→Z */}
                <option value="fixed">Fixed Amount</option>
                <option value="percentage">Percentage of Gross</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Amount {form.calculation === 'percentage' ? '(%)' : '($)'}</label>
              <input type="number" step="0.01" min="0" className="block-input font-mono" value={form.amount} onChange={(e) => setForm(f => ({...f, amount: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Tax Treatment</label>
              <select className="block-select" value={String(form.is_pretax)} onChange={(e) => setForm(f => ({...f, is_pretax: parseInt(e.target.value)}))}>
                {/* Alphabetical A→Z */}
                <option value="0">Post-Tax</option>
                <option value="1">Pre-Tax</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Effective Date</label>
              <input type="date" className="block-input" value={form.effective_date} onChange={(e) => setForm(f => ({...f, effective_date: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">End Date</label>
              <input type="date" className="block-input" value={form.end_date} onChange={(e) => setForm(f => ({...f, end_date: e.target.value}))} />
            </div>
          </div>
          <button className="block-btn-primary text-xs" onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
          </button>
        </div>
      )}

      {deductions.length === 0 && !showForm ? (
        <p className="text-sm text-text-muted">No deductions configured. Add health insurance, 401k, garnishments, etc.</p>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Tax</th>
              <th>Status</th>
              <th style={{width: 80}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {deductions.map((d: any) => (
              <tr key={d.id}>
                <td className="text-text-primary font-medium">{d.name}</td>
                <td className="capitalize">{d.type}</td>
                <td className="font-mono">{d.calculation === 'percentage' ? `${d.amount}%` : formatCurrency(d.amount)}</td>
                <td>{d.is_pretax ? 'Pre-Tax' : 'Post-Tax'}</td>
                <td>{d.is_active ? <span className="block-badge block-badge-income">Active</span> : <span className="block-badge">Inactive</span>}</td>
                <td>
                  <div className="flex gap-1">
                    <button className="text-text-muted hover:text-accent-blue transition-colors p-0.5" onClick={() => handleEdit(d)} title="Edit"><Pencil size={12} /></button>
                    <button className="text-text-muted hover:text-accent-expense transition-colors p-0.5" onClick={() => handleDelete(d.id)} title="Delete"><Trash2 size={12} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const EmployeeForm: React.FC<EmployeeFormProps> = ({ employeeId, onBack, onSaved }) => {
  const [form, setForm] = useState<EmployeeFormData>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'hr' | 'banking' | 'deductions'>('general');
  const [ytdSummary, setYtdSummary] = useState<any>(null);

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
            phone: emp.phone ?? '',
            type: emp.type ?? 'employee',
            pay_type: emp.pay_type ?? 'salary',
            pay_rate: emp.pay_rate != null ? String(emp.pay_rate) : '',
            pay_schedule: emp.pay_schedule ?? 'biweekly',
            filing_status: emp.filing_status ?? 'single',
            federal_allowances: emp.federal_allowances != null ? String(emp.federal_allowances) : '0',
            state: emp.state ?? '',
            state_allowances: emp.state_allowances != null ? String(emp.state_allowances) : '0',
            start_date: emp.start_date ?? '',
            ssn: emp.ssn ?? '',
            ssn_last4: emp.ssn_last4 ?? '',
            status: emp.status ?? 'active',
            employment_type: emp.employment_type ?? 'full-time',
            department: emp.department ?? '',
            job_title: emp.job_title ?? '',
            address_line1: emp.address_line1 ?? '',
            address_line2: emp.address_line2 ?? '',
            city: emp.city ?? '',
            zip: emp.zip ?? '',
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

  // ─── Load YTD Summary ──────────────────────────────
  useEffect(() => {
    if (!employeeId) return;
    api.employeeSummary(employeeId).then(setYtdSummary).catch((err) => {
      console.warn('YTD summary unavailable:', err?.message || err);
    });
  }, [employeeId]);

  // ─── Field updater ──────────────────────────────────
  const setField = <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ─── SSN masked input (full 9-digit) ────────────────
  const [ssnFocused, setSsnFocused] = useState(false);
  const handleSsnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 9);
    setField('ssn', raw);
    setField('ssn_last4', raw.slice(-4));  // keep legacy field in sync
  };
  const ssnDisplay = ssnFocused
    ? form.ssn.replace(/(\d{3})(\d{2})(\d{1,4})/, '$1-$2-$3').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    : form.ssn.length === 9
      ? `***-**-${form.ssn.slice(-4)}`
      : form.ssn.length > 0
        ? '•'.repeat(form.ssn.length)
        : '';

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
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Email is not a valid format.');
      return;
    }
    if (form.routing_number && !/^\d{9}$/.test(form.routing_number)) {
      setError('Routing number must be exactly 9 digits.');
      return;
    }
    if (form.ssn && form.ssn.length !== 9) {
      setError('SSN must be 9 digits.');
      return;
    }
    if (form.zip && !/^\d{5}(-\d{4})?$/.test(form.zip)) {
      setError('ZIP code must be 5 digits or 5+4 format (e.g. 12345 or 12345-6789).');
      return;
    }
    if (Number(form.federal_allowances) < 0 || Number(form.state_allowances) < 0) {
      setError('Allowances cannot be negative.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        type: form.type,
        pay_type: form.pay_type,
        pay_rate: Number(form.pay_rate),
        pay_schedule: form.pay_schedule,
        filing_status: form.filing_status,
        federal_allowances: Number(form.federal_allowances) || 0,
        state: form.state.trim(),
        state_allowances: Number(form.state_allowances) || 0,
        start_date: form.start_date,
        ssn: form.ssn,
        ssn_last4: form.ssn.slice(-4),
        status: form.status,
        employment_type: form.employment_type,
        department: form.department.trim(),
        job_title: form.job_title.trim(),
        address_line1: form.address_line1.trim(),
        address_line2: form.address_line2.trim(),
        city: form.city.trim(),
        zip: form.zip.trim(),
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
      alert('Failed to save employee: ' + (err?.message || 'Unknown error'));
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
          className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors"
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
          {(['general', 'hr', 'banking', 'deductions'] as const).map((tab) => (
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
              {tab === 'general' ? 'General' : tab === 'hr' ? 'HR & Profile' : tab === 'banking' ? 'Banking & Emergency' : 'Deductions'}
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
                    name="name"
                    autoComplete="name"
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
                    name="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Phone</label>
                  <input
                    className="block-input w-full"
                    type="tel"
                    name="phone"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                    placeholder="(555) 000-0000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Type</label>
                  <select
                    className="block-select w-full"
                    value={form.type}
                    onChange={(e) => setField('type', e.target.value as 'employee' | 'contractor')}
                  >
                    {/* Alphabetical A→Z */}
                    <option value="contractor">Contractor</option>
                    <option value="employee">Employee</option>
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
                  <label className="block text-xs font-semibold text-text-secondary mb-1">SSN</label>
                  <input
                    className="block-input w-full font-mono"
                    value={ssnDisplay}
                    onChange={handleSsnChange}
                    onFocus={() => setSsnFocused(true)}
                    onBlur={() => setSsnFocused(false)}
                    placeholder="___-__-____"
                    maxLength={11}
                    autoComplete="off"
                  />
                  <p className="text-[10px] text-text-muted mt-1">Stored encrypted — masked when not editing</p>
                </div>
              </div>
            </div>

            {/* Address */}
            <div>
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Address</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Street Address</label>
                  <input
                    className="block-input w-full"
                    name="address_line1"
                    autoComplete="address-line1"
                    value={form.address_line1}
                    onChange={(e) => setField('address_line1', e.target.value)}
                    placeholder="123 Main St"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-text-secondary mb-1">Address Line 2</label>
                  <input
                    className="block-input w-full"
                    name="address_line2"
                    autoComplete="address-line2"
                    value={form.address_line2}
                    onChange={(e) => setField('address_line2', e.target.value)}
                    placeholder="Apt, Suite, Unit (optional)"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1">City</label>
                  <input
                    className="block-input w-full"
                    name="city"
                    autoComplete="address-level2"
                    value={form.city}
                    onChange={(e) => setField('city', e.target.value)}
                    placeholder="City"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">State</label>
                    <input
                      className="block-input w-full"
                      name="state"
                      autoComplete="address-level1"
                      value={form.state}
                      onChange={(e) => setField('state', e.target.value)}
                      placeholder="CA"
                      maxLength={2}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">ZIP</label>
                    <input
                      className="block-input w-full font-mono"
                      name="zip"
                      autoComplete="postal-code"
                      value={form.zip}
                      onChange={(e) => setField('zip', e.target.value)}
                      placeholder="00000"
                      maxLength={10}
                    />
                  </div>
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
                    {/* Alphabetical A→Z */}
                    <option value="hourly">Hourly</option>
                    <option value="salary">Salary</option>
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
                    {/* Alphabetical A→Z */}
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="semimonthly">Semi-monthly</option>
                    <option value="weekly">Weekly</option>
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
                      {/* Alphabetical A→Z by label */}
                      {Object.entries(FILING_STATUS_LABELS)
                        .sort(([, a], [, b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
                        .map(([val, label]) => (
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
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Tax Withholding State</label>
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
                {/* Alphabetical A→Z */}
                <option value="contractor">Contractor</option>
                <option value="full-time">Full-Time</option>
                <option value="part-time">Part-Time</option>
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
              <input className="block-input w-full font-mono" name="routing_number" autoComplete="off" value={form.routing_number} onChange={(e) => setForm(p => ({ ...p, routing_number: e.target.value }))} placeholder="9 digits" maxLength={9} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Number</label>
              <input className="block-input w-full font-mono" name="account_number" autoComplete="off" value={form.account_number} onChange={(e) => setForm(p => ({ ...p, account_number: e.target.value }))} placeholder="Account number" />
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
              <input className="block-input w-full" name="emergency_contact_name" autoComplete="name" value={form.emergency_contact_name} onChange={(e) => setForm(p => ({ ...p, emergency_contact_name: e.target.value }))} placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contact Phone</label>
              <input className="block-input w-full" name="emergency_contact_phone" type="tel" autoComplete="tel" value={form.emergency_contact_phone} onChange={(e) => setForm(p => ({ ...p, emergency_contact_phone: e.target.value }))} placeholder="(555) 000-0000" />
            </div>
          </div>
        )}

        {/* Deductions tab */}
        {activeTab === 'deductions' && employeeId && (
          <DeductionsPanel employeeId={employeeId} />
        )}
        {activeTab === 'deductions' && !employeeId && (
          <p className="text-sm text-text-muted">Save the employee first to manage deductions.</p>
        )}
      </div>

      {/* YTD Earnings Summary */}
      {isEditing && ytdSummary?.ytd && (
        <div className="block-card p-4">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            {new Date().getFullYear()} Year-to-Date Earnings
          </h3>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Gross Pay', value: ytdSummary.ytd.ytd_gross, color: 'text-text-primary' },
              { label: 'Taxes', value: ytdSummary.ytd.ytd_taxes, color: 'text-accent-expense' },
              { label: 'Deductions', value: ytdSummary.ytd.ytd_deductions, color: 'text-orange-500' },
              { label: 'Net Pay', value: ytdSummary.ytd.ytd_net, color: 'text-accent-income' },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <p className="text-[10px] uppercase tracking-widest text-text-muted font-bold mb-1">{item.label}</p>
                <p className={`text-lg font-bold font-mono ${item.color}`}>
                  ${Number(item.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
          {ytdSummary.ytd.pay_count > 0 && (
            <p className="text-xs text-text-muted mt-2 text-center">
              {ytdSummary.ytd.pay_count} pay stub{ytdSummary.ytd.pay_count !== 1 ? 's' : ''} · Last paid: {ytdSummary.ytd.last_pay_date || '—'}
            </p>
          )}
        </div>
      )}

      {/* Pay History */}
      {isEditing && (
        <PayHistory employeeId={employeeId!} />
      )}

      {/* Cross-integration panels */}
      {isEditing && employeeId && (
        <div className="grid grid-cols-2 gap-4 mt-6">
          <RelatedPanel entityType="employee" entityId={employeeId} hide={['pay_stubs']} />
          <EntityTimeline entityType="employees" entityId={employeeId} />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 justify-end">
        <button
          className="block-btn text-text-secondary hover:text-text-primary px-4 py-2 text-sm transition-colors"
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
