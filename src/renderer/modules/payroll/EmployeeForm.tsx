import React, { useEffect, useState } from 'react';
import { ArrowLeft, Users, Plus, Pencil, Trash2, FileText, Laptop, ShieldCheck, PenTool, X, CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';
import {
  EMPLOYEE_ROLE, EMPLOYEE_DEPARTMENT, EMPLOYEE_WORK_LOCATION, EMPLOYMENT_STATUS, EMPLOYEE_COST_CLASS,
  ClassificationSelect,
} from '../../lib/classifications';

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
  status: string; // active | inactive | terminated | on_leave | probation
  employment_type: 'full-time' | 'part-time' | 'contractor';
  department: string;
  job_title: string;
  role: string;
  work_location: string;
  cost_class: string;
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
  w4_filing_status: 'single' | 'married' | 'head_of_household';
  w4_step2_checkbox: boolean;
  w4_step3_dependent_credit: string;
  w4_step4a_other_income: string;
  w4_step4b_deductions: string;
  w4_step4c_extra_withholding: string;
  ut_exemptions: string;
  ut_additional_withholding: string;
  w4_received_date: string;
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
  role: '',
  work_location: '',
  cost_class: '',
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
  w4_filing_status: 'single',
  w4_step2_checkbox: false,
  w4_step3_dependent_credit: '0',
  w4_step4a_other_income: '0',
  w4_step4b_deductions: '0',
  w4_step4c_extra_withholding: '0',
  ut_exemptions: '1',
  ut_additional_withholding: '0',
  w4_received_date: '',
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
              <input type="number" step="0.01" className="block-input font-mono" value={form.amount} onChange={(e) => setForm(f => ({...f, amount: e.target.value}))} />
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

// ─── Equipment Panel ─────────────────────────────────────
const EquipmentPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    item_name: '', description: '', serial_number: '', model: '',
    condition: 'good', assigned_date: new Date().toISOString().split('T')[0], return_date: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const rows = await api.query('employee_equipment', { employee_id: employeeId });
    setItems(Array.isArray(rows) ? rows : []);
  };

  useEffect(() => { load(); }, [employeeId]);

  const resetForm = () => {
    setForm({
      item_name: '', description: '', serial_number: '', model: '',
      condition: 'good', assigned_date: new Date().toISOString().split('T')[0], return_date: '', notes: '',
    });
  };

  const handleSave = async () => {
    if (!form.item_name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        employee_id: employeeId,
        item_name: form.item_name.trim(),
        description: form.description.trim(),
        serial_number: form.serial_number.trim(),
        model: form.model.trim(),
        condition: form.condition,
        assigned_date: form.assigned_date || null,
        return_date: form.return_date || null,
        notes: form.notes.trim(),
      };
      if (editingId) {
        await api.update('employee_equipment', editingId, payload);
      } else {
        await api.create('employee_equipment', payload);
      }
      setShowForm(false);
      setEditingId(null);
      resetForm();
      await load();
    } catch (err: any) {
      alert('Failed to save equipment: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item: any) => {
    setEditingId(item.id);
    setForm({
      item_name: item.item_name || '',
      description: item.description || '',
      serial_number: item.serial_number || '',
      model: item.model || '',
      condition: item.condition || 'good',
      assigned_date: item.assigned_date || '',
      return_date: item.return_date || '',
      notes: item.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this equipment item?')) return;
    await api.remove('employee_equipment', id);
    await load();
  };

  const conditionBadge = (cond: string) => {
    const colors: Record<string, string> = {
      new: 'block-badge-income', excellent: 'block-badge-income',
      good: 'block-badge', fair: 'block-badge block-badge-warning',
      poor: 'block-badge block-badge-expense',
    };
    return <span className={colors[cond] || 'block-badge'} style={{ textTransform: 'capitalize', fontSize: '10px' }}>{cond}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Issued Equipment</h3>
        <button className="block-btn-primary flex items-center gap-2 text-xs" onClick={() => { setEditingId(null); resetForm(); setShowForm(!showForm); }}>
          <Plus size={12} /> {showForm ? 'Cancel' : 'Add Equipment'}
        </button>
      </div>

      {showForm && (
        <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Item Name *</label>
              <input className="block-input" placeholder="e.g. MacBook Pro 16-inch, Dell Monitor" value={form.item_name} onChange={(e) => setForm(f => ({...f, item_name: e.target.value}))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Description</label>
              <input className="block-input" placeholder="Optional description" value={form.description} onChange={(e) => setForm(f => ({...f, description: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Serial Number</label>
              <input className="block-input font-mono" placeholder="SN-..." value={form.serial_number} onChange={(e) => setForm(f => ({...f, serial_number: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Model</label>
              <input className="block-input" placeholder="e.g. A2442" value={form.model} onChange={(e) => setForm(f => ({...f, model: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Condition</label>
              <select className="block-select" value={form.condition} onChange={(e) => setForm(f => ({...f, condition: e.target.value}))}>
                <option value="new">New</option>
                <option value="excellent">Excellent</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="poor">Poor</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Assigned Date</label>
              <input type="date" className="block-input" value={form.assigned_date} onChange={(e) => setForm(f => ({...f, assigned_date: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Return Date</label>
              <input type="date" className="block-input" value={form.return_date} onChange={(e) => setForm(f => ({...f, return_date: e.target.value}))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Notes</label>
              <input className="block-input" placeholder="Optional notes" value={form.notes} onChange={(e) => setForm(f => ({...f, notes: e.target.value}))} />
            </div>
          </div>
          <button className="block-btn-primary text-xs" onClick={handleSave} disabled={saving || !form.item_name.trim()}>
            {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
          </button>
        </div>
      )}

      {items.length === 0 && !showForm ? (
        <p className="text-sm text-text-muted">No equipment issued. Add laptops, monitors, phones, and other company property.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Serial #</th>
                <th>Model</th>
                <th>Condition</th>
                <th>Date Issued</th>
                <th>Returned</th>
                <th style={{width: 80}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => (
                <tr key={item.id}>
                  <td className="text-text-primary font-medium">{item.item_name}</td>
                  <td className="font-mono text-xs">{item.serial_number || '—'}</td>
                  <td className="text-xs text-text-muted">{item.model || '—'}</td>
                  <td>{conditionBadge(item.condition)}</td>
                  <td className="font-mono text-xs">{formatDate(item.assigned_date)}</td>
                  <td className="font-mono text-xs">{item.return_date ? formatDate(item.return_date) : <span className="text-accent-income text-xs">In Use</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="text-text-muted hover:text-accent-blue transition-colors p-0.5" onClick={() => handleEdit(item)} title="Edit"><Pencil size={12} /></button>
                      <button className="text-text-muted hover:text-accent-expense transition-colors p-0.5" onClick={() => handleDelete(item.id)} title="Delete"><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Agreements Panel ─────────────────────────────────────
type AgreementType = 'equipment' | 'employee';
interface SignedDoc { id: string; html: string; name: string; date: string }

const escapeHtml = (s: string): string =>
  String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

const AGREEMENT_TITLE: Record<AgreementType, string> = {
  equipment: 'Employer Provided Equipment Agreement',
  employee: 'Employee Agreement',
};

const AgreementsPanel: React.FC<{ employeeId: string; employeeName: string }> = ({ employeeId, employeeName }) => {
  const [generatingEquip, setGeneratingEquip] = useState(false);
  const [generatingEmp, setGeneratingEmp] = useState(false);
  // Per-type signed document (html with signature block embedded), loaded on
  // mount from the e-sign store and updated after a fresh signature.
  const [signed, setSigned] = useState<Partial<Record<AgreementType, SignedDoc>>>({});
  const [signModal, setSignModal] = useState<null | AgreementType>(null);

  // Description marker links an esign_document back to this employee + type,
  // so the signed status persists across sessions.
  const marker = (type: AgreementType) => `emp:${employeeId}:${type}`;

  // Load any existing signed agreements on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const docs = await api.esignList();
        if (!Array.isArray(docs)) return;
        const next: Partial<Record<AgreementType, SignedDoc>> = {};
        for (const type of ['equipment', 'employee'] as AgreementType[]) {
          const doc = docs.find((d: any) => d.description === marker(type) && d.status === 'signed');
          if (doc) {
            const full = await api.esignGet(doc.id);
            const sig = full?.signatures?.[full.signatures.length - 1];
            next[type] = {
              id: doc.id,
              html: full?.content || '',
              name: sig?.typed_name || sig?.signer_name || employeeName,
              date: (sig?.signed_at || doc.updated_at || '').slice(0, 10),
            };
          }
        }
        if (!cancelled) setSigned(next);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const genHtml = async (type: AgreementType): Promise<string> => {
    const { html } = type === 'equipment'
      ? await api.generateEquipmentAgreement(employeeId)
      : await api.generateEmployeeAgreement(employeeId);
    return html || '';
  };

  // Preview: prefer the signed copy (with signature block) if present.
  const handleGenerate = async (type: AgreementType) => {
    const setLoading = type === 'equipment' ? setGeneratingEquip : setGeneratingEmp;
    setLoading(true);
    try {
      const html = signed[type]?.html || (await genHtml(type));
      if (html) await api.printPreview(html, AGREEMENT_TITLE[type]);
    } catch (err: any) {
      alert('Failed to generate document: ' + (err?.message || 'Unknown error'));
    } finally { setLoading(false); }
  };

  const handleSavePDF = async (type: AgreementType) => {
    const setLoading = type === 'equipment' ? setGeneratingEquip : setGeneratingEmp;
    setLoading(true);
    try {
      const html = signed[type]?.html || (await genHtml(type));
      if (html) {
        await api.saveToPDF(html, AGREEMENT_TITLE[type], {
          doctype: type === 'equipment' ? 'EquipAgreement' : 'EmployeeAgreement',
          identifier: employeeId,
          pdfOptions: { pageSize: 'Letter', printBackground: true },
          openAfterSave: true,
        });
      }
    } catch (err: any) {
      alert('Failed to save document: ' + (err?.message || 'Unknown error'));
    } finally { setLoading(false); }
  };

  // Build a print-friendly signature block and embed it before </body>.
  const embedSignature = (html: string, typedName: string, dateStr: string): string => {
    const dateDisplay = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const block = `<div style="margin-top:48px;padding-top:16px;border-top:2px solid #333;page-break-inside:avoid;">
      <div style="font-size:11px;letter-spacing:1px;color:#666;text-transform:uppercase;margin-bottom:6px;">Electronic Signature</div>
      <div style="font-family:'Snell Roundhand','Apple Chancery','Brush Script MT',cursive;font-size:30px;color:#111;line-height:1.1;">${escapeHtml(typedName)}</div>
      <div style="font-size:12px;color:#333;margin-top:8px;">Signed by <strong>${escapeHtml(employeeName)}</strong> &nbsp;&middot;&nbsp; Date: <strong>${dateDisplay}</strong></div>
      <div style="font-size:10px;color:#999;margin-top:4px;">Electronically signed &amp; recorded. This signature is cryptographically bound to the document content (SHA-256).</div>
    </div>`;
    return html.includes('</body>') ? html.replace('</body>', block + '</body>') : html + block;
  };

  const handleSign = async (type: AgreementType, typedName: string, dateStr: string) => {
    const baseHtml = await genHtml(type);
    if (!baseHtml) throw new Error('Could not generate the agreement to sign.');
    const signedHtml = embedSignature(baseHtml, typedName, dateStr);
    const created = await api.esignCreate(`${AGREEMENT_TITLE[type]} — ${employeeName}`, marker(type), signedHtml);
    if (!created?.id) throw new Error('Could not create the e-sign document.');
    const res = await api.esignSign(created.id, typedName, 'employee', employeeId, employeeName, dateStr);
    if (res?.error) throw new Error(res.error);
    setSigned((prev) => ({ ...prev, [type]: { id: created.id, html: signedHtml, name: typedName, date: dateStr } }));
  };

  const renderCard = (type: AgreementType, Icon: typeof Laptop, iconColor: string, desc: string) => {
    const busy = type === 'equipment' ? generatingEquip : generatingEmp;
    const sig = signed[type];
    return (
      <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-2">
          <Icon size={18} className={iconColor} />
          <div>
            <p className="text-sm font-semibold text-text-primary">{AGREEMENT_TITLE[type]}</p>
            <p className="text-xs text-text-muted">{desc}</p>
          </div>
        </div>
        {sig && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-accent-income)' }}>
            <CheckCircle2 size={13} />
            <span>Signed by <strong>{sig.name}</strong> on {new Date(sig.date + 'T12:00:00').toLocaleDateString()}</span>
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <button className="block-btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5" onClick={() => handleGenerate(type)} disabled={busy}>
            <FileText size={12} /> {busy ? 'Generating...' : 'Preview'}
          </button>
          <button className="block-btn flex items-center gap-1.5 text-xs px-3 py-1.5" onClick={() => handleSavePDF(type)} disabled={busy}>
            Save PDF
          </button>
          <button className="block-btn flex items-center gap-1.5 text-xs px-3 py-1.5" onClick={() => setSignModal(type)} disabled={busy}
            style={{ borderColor: 'var(--color-accent-income)', color: 'var(--color-accent-income)' }}>
            <PenTool size={12} /> {sig ? 'Re-sign' : 'E-Sign'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">Employment Documents</h3>
      <div className="grid grid-cols-2 gap-4">
        {renderCard('equipment', Laptop, 'text-accent-blue', 'Itemizes all equipment issued to this employee with terms of use.')}
        {renderCard('employee', ShieldCheck, 'text-accent-income', 'Employment contract with position details, compensation, and terms.')}
      </div>
      {signModal && (
        <ESignModal
          title={AGREEMENT_TITLE[signModal]}
          defaultName={employeeName}
          onClose={() => setSignModal(null)}
          onSign={async (typedName, dateStr) => { await handleSign(signModal, typedName, dateStr); setSignModal(null); }}
        />
      )}
    </div>
  );
};

// ─── E-Sign Modal ─────────────────────────────────────────
// Captures a typed signature + a signing date. The date defaults to today
// and is capped at today (max=) so the user can back-date to the current OR
// a past date — but never the future.
const ESignModal: React.FC<{
  title: string;
  defaultName: string;
  onClose: () => void;
  onSign: (typedName: string, dateStr: string) => Promise<void>;
}> = ({ title, defaultName, onClose, onSign }) => {
  const today = new Date().toISOString().split('T')[0];
  const [typedName, setTypedName] = useState(defaultName || '');
  const [dateStr, setDateStr] = useState(today);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!typedName.trim()) { setError('Type your full legal name to sign.'); return; }
    if (!agree) { setError('You must confirm intent to sign.'); return; }
    if (dateStr > today) { setError('Signing date cannot be in the future.'); return; }
    setBusy(true); setError('');
    try {
      await onSign(typedName.trim(), dateStr);
    } catch (err: any) {
      setError(err?.message || 'Failed to sign');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="block-card w-full max-w-md p-5 space-y-4" style={{ borderRadius: '10px' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PenTool size={16} className="text-accent-income" />
            <span className="text-sm font-bold text-text-primary">E-Sign Document</span>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary" style={{ borderRadius: '6px' }}><X size={16} /></button>
        </div>
        <p className="text-xs text-text-muted">{title}</p>

        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Full Legal Name (your signature)</label>
          <input className="block-input" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Type your full name" autoFocus />
          {typedName.trim() && (
            <div className="mt-2 px-3 py-2" style={{ borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border-primary)' }}>
              <span style={{ fontFamily: "'Snell Roundhand','Apple Chancery','Brush Script MT',cursive", fontSize: 26, color: 'var(--color-text-primary)' }}>{typedName}</span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Date Signed</label>
          <input type="date" className="block-input" value={dateStr} max={today} onChange={(e) => setDateStr(e.target.value)} />
          <p className="text-[10px] text-text-muted mt-1">Defaults to today. You may back-date to a past date; future dates are not allowed.</p>
        </div>

        <label className="flex items-start gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 2, accentColor: '#16a34a' }} />
          <span>I, the named employee, agree that typing my name constitutes my electronic signature and that I have read and accept this document.</span>
        </label>

        {error && <p className="text-xs" style={{ color: 'var(--color-accent-expense)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="block-btn text-xs px-3 py-1.5" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="block-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5" onClick={submit} disabled={busy}
            style={{ background: 'var(--color-accent-income)', borderColor: 'var(--color-accent-income)' }}>
            <PenTool size={12} /> {busy ? 'Signing...' : 'Sign Document'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const EmployeeForm: React.FC<EmployeeFormProps> = ({ employeeId, onBack, onSaved }) => {
  const [form, setForm] = useState<EmployeeFormData>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'hr' | 'banking' | 'deductions' | 'equipment'>('general');
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
            role: emp.role ?? '',
            work_location: emp.work_location ?? '',
            cost_class: emp.cost_class ?? '',
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
            w4_filing_status: emp.w4_filing_status || 'single',
            w4_step2_checkbox: !!emp.w4_step2_checkbox,
            w4_step3_dependent_credit: String(emp.w4_step3_dependent_credit ?? 0),
            w4_step4a_other_income: String(emp.w4_step4a_other_income ?? 0),
            w4_step4b_deductions: String(emp.w4_step4b_deductions ?? 0),
            w4_step4c_extra_withholding: String(emp.w4_step4c_extra_withholding ?? 0),
            ut_exemptions: String(emp.ut_exemptions ?? 1),
            ut_additional_withholding: String(emp.ut_additional_withholding ?? 0),
            w4_received_date: emp.w4_received_date || '',
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
        role: form.role || '',
        work_location: form.work_location || '',
        cost_class: form.cost_class || '',
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
        w4_filing_status: form.w4_filing_status,
        w4_step2_checkbox: form.w4_step2_checkbox ? 1 : 0,
        w4_step3_dependent_credit: parseFloat(form.w4_step3_dependent_credit) || 0,
        w4_step4a_other_income: parseFloat(form.w4_step4a_other_income) || 0,
        w4_step4b_deductions: parseFloat(form.w4_step4b_deductions) || 0,
        w4_step4c_extra_withholding: parseFloat(form.w4_step4c_extra_withholding) || 0,
        ut_exemptions: parseInt(form.ut_exemptions) || 1,
        ut_additional_withholding: parseFloat(form.ut_additional_withholding) || 0,
        w4_received_date: form.w4_received_date,
      };

      if (isEditing && employeeId) {
        await api.update('employees', employeeId, payload);
      } else {
        await api.create('employees', payload);
      }
      onSaved();
    } catch (err: any) {
      // VISIBILITY: surface save-employee errors instead of swallowing
      console.error('Failed to save employee:', err);
      setError(err?.message ?? String(err));
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
          {(['general', 'hr', 'banking', 'deductions', 'equipment'] as const).map((tab) => (
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
              {tab === 'general' ? 'General' : tab === 'hr' ? 'HR & Profile' : tab === 'banking' ? 'Banking & Emergency' : tab === 'deductions' ? 'Deductions' : 'Equipment & Agreements'}
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
                  <ClassificationSelect
                    def={EMPLOYMENT_STATUS}
                    value={form.status}
                    onChange={(v) => setField('status', v)}
                    allowEmpty={false}
                  />
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

            {/* ─── W-4 Information (2020+) ─── */}
            {form.type === 'employee' && (
              <div className="block-card space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0" style={{ borderRadius: '6px' }}>
                    <FileText size={16} className="text-accent-blue" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">W-4 Information (2020+)</h3>
                    <p className="text-xs text-text-muted mt-0.5">Federal W-4 and Utah TC-40W withholding data</p>
                  </div>
                </div>
                <div className="border-t border-border-primary pt-4 space-y-3">
                  {/* W-4 Filing Status */}
                  <div>
                    <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-2">W-4 Filing Status</label>
                    <div className="flex gap-4">
                      {(['single', 'married', 'head_of_household'] as const).map(s => (
                        <label key={s} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="w4_filing_status" value={s} checked={form.w4_filing_status === s}
                            onChange={() => setForm(f => ({ ...f, w4_filing_status: s }))}
                            className="accent-accent-blue" />
                          <span className="text-xs text-text-secondary">
                            {s === 'single' ? 'Single' : s === 'married' ? 'Married' : 'Head of Household'}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Step 2 Checkbox */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.w4_step2_checkbox}
                      onChange={e => setForm(f => ({ ...f, w4_step2_checkbox: e.target.checked }))}
                      className="w-4 h-4 accent-accent-blue" />
                    <span className="text-xs text-text-secondary">Step 2: Multiple Jobs or Spouse Works</span>
                  </label>
                  {/* Steps 3, 4a, 4b, 4c */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Step 3: Dependent Credit ($)</label>
                      <input type="number" value={form.w4_step3_dependent_credit} onChange={e => setForm(f => ({ ...f, w4_step3_dependent_credit: e.target.value }))} className="block-input" step="100" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Step 4a: Other Income ($)</label>
                      <input type="number" value={form.w4_step4a_other_income} onChange={e => setForm(f => ({ ...f, w4_step4a_other_income: e.target.value }))} className="block-input" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Step 4b: Deductions ($)</label>
                      <input type="number" value={form.w4_step4b_deductions} onChange={e => setForm(f => ({ ...f, w4_step4b_deductions: e.target.value }))} className="block-input" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Step 4c: Extra Withholding ($)</label>
                      <input type="number" value={form.w4_step4c_extra_withholding} onChange={e => setForm(f => ({ ...f, w4_step4c_extra_withholding: e.target.value }))} className="block-input" />
                    </div>
                  </div>
                  {/* Utah Fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Utah Exemptions</label>
                      <input type="number" value={form.ut_exemptions} onChange={e => setForm(f => ({ ...f, ut_exemptions: e.target.value }))} className="block-input" min="0" max="10" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">UT Additional W/H ($)</label>
                      <input type="number" value={form.ut_additional_withholding} onChange={e => setForm(f => ({ ...f, ut_additional_withholding: e.target.value }))} className="block-input" />
                    </div>
                  </div>
                  {/* W-4 Received Date */}
                  <div>
                    <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">W-4 Received Date</label>
                    <input type="date" value={form.w4_received_date} onChange={e => setForm(f => ({ ...f, w4_received_date: e.target.value }))} className="block-input" />
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
              <ClassificationSelect def={EMPLOYEE_DEPARTMENT} value={form.department} onChange={(v) => setForm(p => ({ ...p, department: v }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Role</label>
              <ClassificationSelect def={EMPLOYEE_ROLE} value={form.role} onChange={(v) => setForm(p => ({ ...p, role: v }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Work Location</label>
              <ClassificationSelect def={EMPLOYEE_WORK_LOCATION} value={form.work_location} onChange={(v) => setForm(p => ({ ...p, work_location: v }))} />
              {form.work_location === 'remote' && (
                <p className="mt-1 text-[10px] text-text-muted">Hint: Remote workers may be ineligible for travel per-diem.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Cost Class</label>
              <ClassificationSelect def={EMPLOYEE_COST_CLASS} value={form.cost_class} onChange={(v) => setForm(p => ({ ...p, cost_class: v }))} />
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

        {/* Equipment & Agreements tab */}
        {activeTab === 'equipment' && employeeId && (
          <div className="space-y-6">
            <EquipmentPanel employeeId={employeeId} />
            <div className="border-t border-border-primary" />
            <AgreementsPanel employeeId={employeeId} employeeName={form.name} />
          </div>
        )}
        {activeTab === 'equipment' && !employeeId && (
          <p className="text-sm text-text-muted">Save the employee first to manage equipment and generate agreements.</p>
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
