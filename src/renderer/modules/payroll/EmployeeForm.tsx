import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Users, Plus, Pencil, Trash2, FileText, Laptop, ShieldCheck, PenTool, X, CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';

// PERF: these heavy panels sit below the form and would otherwise
// re-render on EVERY keystroke (each fetches + renders lists), causing
// noticeable data-entry lag. Memoize them so they only re-render when
// their (stable) props change. The hide array MUST be a module constant
// — a fresh `['pay_stubs']` literal each render would defeat React.memo's
// shallow prop comparison.
const HIDE_PAYSTUBS = ['pay_stubs'];
const MemoRelatedPanel = React.memo(RelatedPanel);
const MemoEntityTimeline = React.memo(EntityTimeline);
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
interface PenaltyRow { id?: string; label: string; penalty_type: string; amount: number; notes?: string; applies_to?: string }
const PENALTY_TYPES: { value: string; label: string; suffix: string }[] = [
  { value: 'flat', label: 'Flat fee ($)', suffix: '$' },
  { value: 'per_day', label: 'Per day ($/day)', suffix: '$/day' },
  { value: 'percent_of_value', label: '% of item value', suffix: '% of value' },
];
// Which outcome a penalty is tied to.
const PENALTY_TRIGGERS: { value: string; label: string }[] = [
  { value: 'any', label: 'Any issue' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
  { value: 'stolen', label: 'Stolen' },
  { value: 'not_returned', label: 'Not returned' },
  { value: 'late', label: 'Late return' },
];
// Equipment disposition / outcome.
const DISPOSITIONS: { value: string; label: string; clean: boolean }[] = [
  { value: 'in_use', label: 'In Use', clean: true },
  { value: 'returned_good', label: 'Returned — Good Condition', clean: true },
  { value: 'returned_damaged', label: 'Returned — Damaged', clean: false },
  { value: 'lost', label: 'Lost', clean: false },
  { value: 'stolen', label: 'Stolen', clean: false },
  { value: 'not_returned', label: 'Not Returned', clean: false },
  { value: 'retired', label: 'Retired / Decommissioned', clean: true },
];
// Penalty triggers fired by each disposition. 'late' is included for
// returned-late and not-returned outcomes (per-day fees).
const DISPOSITION_TRIGGERS: Record<string, string[]> = {
  in_use: [], returned_good: [], retired: [],
  returned_damaged: ['damaged', 'any', 'late'],
  lost: ['lost', 'any'],
  stolen: ['stolen', 'any'],
  not_returned: ['not_returned', 'any', 'late'],
};
const isReturnedDisposition = (d: string) => d.startsWith('returned');

// Compute the penalty owed for a disposition given the item's penalties,
// value, and (for per-day fees) the number of late days. A clean return
// triggers nothing → $0.
function computeAssessment(disposition: string, penalties: PenaltyRow[], itemValue: number, days: number) {
  const triggers = DISPOSITION_TRIGGERS[disposition] || [];
  if (triggers.length === 0) return { total: 0, lines: [] as Array<PenaltyRow & { computed: number }> };
  const lines = penalties
    .filter((p) => triggers.includes(p.applies_to || 'any'))
    .map((p) => {
      let computed = 0;
      if (p.penalty_type === 'per_day') computed = (Number(p.amount) || 0) * (days || 0);
      else if (p.penalty_type === 'percent_of_value') computed = ((Number(p.amount) || 0) / 100) * (itemValue || 0);
      else computed = Number(p.amount) || 0;
      return { ...p, computed: Math.round(computed * 100) / 100 };
    });
  return { total: Math.round(lines.reduce((s, l) => s + l.computed, 0) * 100) / 100, lines };
}

const EquipmentPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [items, setItems] = useState<any[]>([]);
  const [penaltyCounts, setPenaltyCounts] = useState<Record<string, number>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    item_name: '', description: '', serial_number: '', model: '',
    condition: 'good', assigned_date: new Date().toISOString().split('T')[0], return_date: '', notes: '', value: 0,
    disposition: 'in_use', disposition_date: '', disposition_notes: '',
    penalty_waived: false, penalty_override: null as number | null, penalty_days: 0,
  });
  const [penalties, setPenalties] = useState<PenaltyRow[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const rows = await api.query('employee_equipment', { employee_id: employeeId });
    const list = Array.isArray(rows) ? rows : [];
    setItems(list);
    // Tally penalties per item so the table can show a count badge.
    const counts: Record<string, number> = {};
    await Promise.all(list.map(async (it: any) => {
      const ps = await api.query('equipment_penalties', { equipment_id: it.id });
      counts[it.id] = Array.isArray(ps) ? ps.length : 0;
    }));
    setPenaltyCounts(counts);
  };

  useEffect(() => { load(); }, [employeeId]);

  const resetForm = () => {
    setForm({
      item_name: '', description: '', serial_number: '', model: '',
      condition: 'good', assigned_date: new Date().toISOString().split('T')[0], return_date: '', notes: '', value: 0,
      disposition: 'in_use', disposition_date: '', disposition_notes: '',
      penalty_waived: false, penalty_override: null, penalty_days: 0,
    });
    setPenalties([]);
  };

  // Replace the equipment's penalty set with the current form rows
  // (delete-then-insert keeps it simple and idempotent).
  const syncPenalties = async (equipmentId: string) => {
    const existing = await api.query('equipment_penalties', { equipment_id: equipmentId });
    if (Array.isArray(existing)) {
      for (const e of existing) await api.remove('equipment_penalties', e.id);
    }
    for (let i = 0; i < penalties.length; i++) {
      const p = penalties[i];
      if (!p.label.trim()) continue;
      await api.create('equipment_penalties', {
        equipment_id: equipmentId,
        label: p.label.trim(),
        penalty_type: p.penalty_type || 'flat',
        amount: Number(p.amount) || 0,
        applies_to: p.applies_to || 'any',
        notes: (p.notes || '').trim(),
        sort_order: i,
      });
    }
  };

  const handleSave = async () => {
    if (!form.item_name.trim()) return;
    setSaving(true);
    try {
      // Assess the penalty owed for the current disposition. A clean
      // return ($0-trigger) or a waiver yields 0.
      const assessment = computeAssessment(form.disposition, penalties, Number(form.value) || 0, Number(form.penalty_days) || 0);
      const computedPenalty = form.penalty_override != null ? form.penalty_override : assessment.total;
      const finalPenalty = form.penalty_waived ? 0 : computedPenalty;
      const isClean = (DISPOSITIONS.find((d) => d.value === form.disposition)?.clean) ?? true;
      const payload = {
        employee_id: employeeId,
        item_name: form.item_name.trim(),
        description: form.description.trim(),
        serial_number: form.serial_number.trim(),
        model: form.model.trim(),
        condition: form.condition,
        value: Number(form.value) || 0,
        assigned_date: form.assigned_date || null,
        // Returned dispositions imply a return date; non-returned keep null.
        return_date: isReturnedDisposition(form.disposition) ? (form.return_date || form.disposition_date || null) : (form.disposition === 'in_use' ? (form.return_date || null) : null),
        notes: form.notes.trim(),
        disposition: form.disposition,
        disposition_date: form.disposition === 'in_use' ? null : (form.disposition_date || new Date().toISOString().split('T')[0]),
        disposition_notes: form.disposition_notes.trim(),
        penalty_assessed: isClean ? 0 : finalPenalty,
        penalty_waived: form.penalty_waived ? 1 : 0,
      };
      let eqId = editingId;
      if (editingId) {
        const r = await api.update('employee_equipment', editingId, payload);
        if ((r as any)?.error) throw new Error((r as any).error);
      } else {
        const created = await api.create('employee_equipment', payload);
        if ((created as any)?.error) throw new Error((created as any).error);
        eqId = (created as any)?.id || null;
      }
      if (eqId) await syncPenalties(eqId);
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

  const handleEdit = async (item: any) => {
    setEditingId(item.id);
    setForm({
      item_name: item.item_name || '',
      description: item.description || '',
      serial_number: item.serial_number || '',
      model: item.model || '',
      condition: item.condition || 'good',
      value: Number(item.value) || 0,
      assigned_date: item.assigned_date || '',
      return_date: item.return_date || '',
      notes: item.notes || '',
      disposition: item.disposition || 'in_use',
      disposition_date: item.disposition_date || '',
      disposition_notes: item.disposition_notes || '',
      penalty_waived: !!item.penalty_waived,
      // Treat the stored assessed amount as the override starting point.
      penalty_override: item.penalty_assessed != null ? Number(item.penalty_assessed) : null,
      penalty_days: 0,
    });
    // Load this item's penalties so admin can add/edit them later.
    const ps = await api.query('equipment_penalties', { equipment_id: item.id });
    setPenalties(Array.isArray(ps) ? ps.map((r: any) => ({ id: r.id, label: r.label, penalty_type: r.penalty_type, amount: r.amount, notes: r.notes, applies_to: r.applies_to || 'any' })) : []);
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

  const dispositionBadge = (disp: string | undefined, returnDate: string | undefined) => {
    const d = disp || (returnDate ? 'returned_good' : 'in_use');
    const meta: Record<string, { label: string; cls: string }> = {
      in_use: { label: 'In Use', cls: 'block-badge-income' },
      returned_good: { label: 'Returned ✓', cls: 'block-badge' },
      returned_damaged: { label: 'Returned · Damaged', cls: 'block-badge block-badge-warning' },
      lost: { label: 'Lost', cls: 'block-badge block-badge-expense' },
      stolen: { label: 'Stolen', cls: 'block-badge block-badge-expense' },
      not_returned: { label: 'Not Returned', cls: 'block-badge block-badge-expense' },
      retired: { label: 'Retired', cls: 'block-badge' },
    };
    const m = meta[d] || meta.in_use;
    return <span className={m.cls} style={{ fontSize: '10px' }}>{m.label}</span>;
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
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Item Value / Replacement Cost</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 12 }}>$</span>
                <input type="number" step="0.01" min="0" className="block-input" style={{ paddingLeft: 22 }} placeholder="0.00"
                  value={form.value || ''} onChange={(e) => setForm(f => ({...f, value: parseFloat(e.target.value) || 0}))} />
              </div>
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

          {/* Custom penalties — admin-defined, addable now or later. Appear
              as enforceable terms on the Equipment Agreement. */}
          <div className="pt-2 border-t border-border-primary/50">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider">Custom Penalties</label>
              <button type="button" className="block-btn flex items-center gap-1 text-[11px] px-2 py-1"
                onClick={() => setPenalties(p => [...p, { label: '', penalty_type: 'flat', amount: 0, applies_to: 'any' }])}>
                <Plus size={11} /> Add Penalty
              </button>
            </div>
            {penalties.length === 0 ? (
              <p className="text-[11px] text-text-muted">No penalties defined. Add loss/damage/late-return fees that apply to this item — they’ll appear as terms on the Equipment Agreement and auto-assess when you set the disposition below.</p>
            ) : (
              <div className="space-y-2">
                <div className="grid gap-2 text-[9px] uppercase tracking-wider text-text-muted font-semibold" style={{ gridTemplateColumns: '2fr 1.1fr 1.2fr 0.9fr auto' }}>
                  <span>Penalty</span><span>Type</span><span>Applies To</span><span>Amount</span><span></span>
                </div>
                {penalties.map((p, i) => (
                  <div key={i} className="grid gap-2" style={{ gridTemplateColumns: '2fr 1.1fr 1.2fr 0.9fr auto' }}>
                    <input className="block-input text-xs" placeholder="e.g. Loss / non-return" value={p.label}
                      onChange={(e) => setPenalties(arr => arr.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                    <select className="block-select text-xs" value={p.penalty_type}
                      onChange={(e) => setPenalties(arr => arr.map((x, j) => j === i ? { ...x, penalty_type: e.target.value } : x))}>
                      {PENALTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <select className="block-select text-xs" value={p.applies_to || 'any'}
                      onChange={(e) => setPenalties(arr => arr.map((x, j) => j === i ? { ...x, applies_to: e.target.value } : x))}>
                      {PENALTY_TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <input type="number" step="0.01" min="0" className="block-input text-xs" placeholder="0"
                      value={p.amount || ''} onChange={(e) => setPenalties(arr => arr.map((x, j) => j === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))} />
                    <button type="button" className="text-text-muted hover:text-accent-expense p-1"
                      onClick={() => setPenalties(arr => arr.filter((_, j) => j !== i))} title="Remove"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Disposition / outcome — drives penalty assessment. */}
          {(() => {
            const disp = DISPOSITIONS.find((d) => d.value === form.disposition);
            const clean = disp?.clean ?? true;
            const assessment = computeAssessment(form.disposition, penalties, Number(form.value) || 0, Number(form.penalty_days) || 0);
            const hasPerDay = assessment.lines.some((l) => l.penalty_type === 'per_day');
            const computed = form.penalty_override != null ? form.penalty_override : assessment.total;
            const finalPenalty = form.penalty_waived ? 0 : computed;
            return (
              <div className="pt-2 border-t border-border-primary/50">
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Disposition / Outcome</label>
                <div className="grid gap-3" style={{ gridTemplateColumns: '2fr 1fr' }}>
                  <select className="block-select" value={form.disposition}
                    onChange={(e) => setForm(f => ({ ...f, disposition: e.target.value, penalty_override: null, penalty_waived: false }))}>
                    {DISPOSITIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                  {form.disposition !== 'in_use' && (
                    <input type="date" className="block-input" value={form.disposition_date}
                      onChange={(e) => setForm(f => ({ ...f, disposition_date: e.target.value }))} title="Date of return / loss / etc." />
                  )}
                </div>

                {/* Penalty assessment (only when the outcome triggers penalties) */}
                {!clean && (
                  <div className="mt-3 p-3" style={{ borderRadius: 6, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)' }}>
                    {assessment.lines.length === 0 ? (
                      <p className="text-[11px] text-text-muted">No penalties match this outcome. Define a penalty above with “Applies To” set to <b>{DISPOSITIONS.find(d=>d.value===form.disposition)?.label}</b> or <b>Any issue</b>, or enter an amount manually below.</p>
                    ) : (
                      <div className="space-y-1">
                        {assessment.lines.map((l, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[11px]">
                            <span className="text-text-secondary">{l.label || '(penalty)'} <span className="text-text-muted">· {PENALTY_TYPES.find(t=>t.value===l.penalty_type)?.label}</span></span>
                            <span className="font-mono text-accent-expense">{formatCurrency(l.computed)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {hasPerDay && (
                      <div className="flex items-center gap-2 mt-2">
                        <label className="text-[11px] text-text-muted">Late days</label>
                        <input type="number" min="0" className="block-input text-xs" style={{ width: 90 }} value={form.penalty_days || ''}
                          onChange={(e) => setForm(f => ({ ...f, penalty_days: parseInt(e.target.value) || 0, penalty_override: null }))} />
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-primary/40">
                      <div className="flex items-center gap-3">
                        <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Assessed Penalty</label>
                        <label className="flex items-center gap-1 text-[11px] text-text-muted">
                          <input type="checkbox" checked={form.penalty_waived} onChange={(e) => setForm(f => ({ ...f, penalty_waived: e.target.checked }))} style={{ accentColor: 'var(--color-accent-income)' }} /> Waive
                        </label>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-text-muted text-xs">$</span>
                        <input type="number" step="0.01" min="0" disabled={form.penalty_waived}
                          className="block-input text-xs text-right" style={{ width: 110, opacity: form.penalty_waived ? 0.5 : 1 }}
                          value={form.penalty_waived ? 0 : (form.penalty_override != null ? form.penalty_override : assessment.total)}
                          onChange={(e) => setForm(f => ({ ...f, penalty_override: parseFloat(e.target.value) || 0 }))} />
                      </div>
                    </div>
                    <p className="text-[10px] text-text-muted mt-1">Final penalty to charge: <b className="text-accent-expense">{formatCurrency(finalPenalty)}</b>{form.penalty_override != null && !form.penalty_waived ? ' (manually adjusted)' : ''}{form.penalty_waived ? ' (waived)' : ''}</p>
                  </div>
                )}
                {clean && form.disposition !== 'in_use' && (
                  <p className="text-[11px] text-accent-income mt-2">Returned without issue — no penalty assessed.</p>
                )}
                {form.disposition !== 'in_use' && (
                  <input className="block-input text-xs mt-3" placeholder="Disposition notes (optional)" value={form.disposition_notes}
                    onChange={(e) => setForm(f => ({ ...f, disposition_notes: e.target.value }))} />
                )}
              </div>
            );
          })()}

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
                <th className="text-right">Value</th>
                <th>Penalties</th>
                <th>Date Issued</th>
                <th>Status</th>
                <th className="text-right">Assessed</th>
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
                  <td className="font-mono text-xs text-right">{Number(item.value) > 0 ? formatCurrency(item.value) : '—'}</td>
                  <td>
                    {penaltyCounts[item.id] > 0
                      ? <span className="block-badge block-badge-warning" style={{ fontSize: 10 }}>{penaltyCounts[item.id]} penalt{penaltyCounts[item.id] === 1 ? 'y' : 'ies'}</span>
                      : <span className="text-text-muted text-xs">—</span>}
                  </td>
                  <td className="font-mono text-xs">{formatDate(item.assigned_date)}</td>
                  <td>{dispositionBadge(item.disposition, item.return_date)}</td>
                  <td className="font-mono text-xs text-right">
                    {Number(item.penalty_assessed) > 0
                      ? <span className="text-accent-expense font-semibold">{formatCurrency(item.penalty_assessed)}</span>
                      : (item.penalty_waived ? <span className="text-text-muted text-xs">waived</span> : <span className="text-text-muted">—</span>)}
                  </td>
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

// ─── Performance Reviews Panel ────────────────────────────
const RATING_LABELS = ['', 'Unsatisfactory', 'Needs Improvement', 'Meets Expectations', 'Exceeds Expectations', 'Outstanding'];
const PerformanceReviewsPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const empty = { review_date: new Date().toISOString().split('T')[0], review_period: '', reviewer_name: '', overall_rating: 3, performance_summary: '', strengths: '', areas_for_improvement: '', goals: '', status: 'draft' };
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const load = async () => { const r = await api.query('employee_reviews', { employee_id: employeeId }); setItems(Array.isArray(r) ? r : []); };
  useEffect(() => { load(); }, [employeeId]);
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { employee_id: employeeId, ...form, overall_rating: Number(form.overall_rating) || 3 };
      const r = editingId ? await api.update('employee_reviews', editingId, payload) : await api.create('employee_reviews', payload);
      if ((r as any)?.error) throw new Error((r as any).error);
      setShowForm(false); setEditingId(null); setForm({ ...empty }); await load();
    } catch (err: any) { alert('Save failed: ' + (err?.message || 'Unknown')); } finally { setSaving(false); }
  };
  const handleEdit = (it: any) => { setEditingId(it.id); setForm({ review_date: it.review_date || '', review_period: it.review_period || '', reviewer_name: it.reviewer_name || '', overall_rating: it.overall_rating || 3, performance_summary: it.performance_summary || '', strengths: it.strengths || '', areas_for_improvement: it.areas_for_improvement || '', goals: it.goals || '', status: it.status || 'draft' }); setShowForm(true); };
  const handleDelete = async (id: string) => { if (!window.confirm('Delete this review?')) return; await api.remove('employee_reviews', id); await load(); };
  const ratingBadge = (r: number) => {
    const colors = ['', 'block-badge block-badge-expense', 'block-badge block-badge-warning', 'block-badge', 'block-badge block-badge-income', 'block-badge block-badge-income'];
    return <span className={colors[r] || 'block-badge'} style={{ fontSize: 10 }}>{r}/5 · {RATING_LABELS[r]}</span>;
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Performance Reviews</h3>
        <button className="block-btn-primary flex items-center gap-2 text-xs" onClick={() => { setEditingId(null); setForm({ ...empty }); setShowForm(!showForm); }}>
          <Plus size={12} /> {showForm ? 'Cancel' : 'New Review'}
        </button>
      </div>
      {showForm && (
        <div className="block-card p-4 space-y-3" style={{ borderRadius: 6 }}>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Review Date</label><input type="date" className="block-input" value={form.review_date} onChange={e => setForm(f => ({...f, review_date: e.target.value}))} /></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Review Period</label><input className="block-input" placeholder="e.g. Q1 2026, Annual 2025" value={form.review_period} onChange={e => setForm(f => ({...f, review_period: e.target.value}))} /></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Reviewer</label><input className="block-input" placeholder="Manager / supervisor name" value={form.reviewer_name} onChange={e => setForm(f => ({...f, reviewer_name: e.target.value}))} /></div>
          </div>
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Overall Rating (1-5)</label>
            <div className="flex gap-1">{[1,2,3,4,5].map(n => (<button key={n} type="button" onClick={() => setForm(f => ({...f, overall_rating: n}))} className={`w-9 h-9 text-sm font-bold transition-colors ${form.overall_rating >= n ? 'text-white' : 'text-text-muted'}`} style={{ borderRadius: 6, background: form.overall_rating >= n ? (n <= 2 ? 'var(--color-accent-expense)' : n === 3 ? 'var(--color-accent-blue)' : 'var(--color-accent-income)') : 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border-primary)' }}>{n}</button>))}
              <span className="text-xs text-text-muted ml-2 self-center">{RATING_LABELS[form.overall_rating]}</span>
            </div>
          </div>
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Performance Summary</label><textarea className="block-input" rows={2} value={form.performance_summary} onChange={e => setForm(f => ({...f, performance_summary: e.target.value}))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Strengths</label><textarea className="block-input" rows={2} value={form.strengths} onChange={e => setForm(f => ({...f, strengths: e.target.value}))} /></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Areas for Improvement</label><textarea className="block-input" rows={2} value={form.areas_for_improvement} onChange={e => setForm(f => ({...f, areas_for_improvement: e.target.value}))} /></div>
          </div>
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Goals / Action Items</label><textarea className="block-input" rows={2} value={form.goals} onChange={e => setForm(f => ({...f, goals: e.target.value}))} /></div>
          <div className="flex items-center gap-3">
            <select className="block-select text-xs" value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
              <option value="draft">Draft</option><option value="submitted">Submitted</option><option value="acknowledged">Acknowledged</option>
            </select>
            <button className="block-btn-primary text-xs" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update' : 'Save'}</button>
          </div>
        </div>
      )}
      {items.length === 0 && !showForm ? <p className="text-sm text-text-muted">No performance reviews on record.</p> : (
        <div className="overflow-x-auto"><table className="block-table"><thead><tr><th>Date</th><th>Period</th><th>Reviewer</th><th>Rating</th><th>Status</th><th style={{width:80}}>Actions</th></tr></thead><tbody>
          {items.sort((a: any, b: any) => (b.review_date || '').localeCompare(a.review_date || '')).map((it: any) => (
            <tr key={it.id}><td className="font-mono text-xs">{formatDate(it.review_date)}</td><td className="text-xs">{it.review_period || '—'}</td><td className="text-xs">{it.reviewer_name || '—'}</td><td>{ratingBadge(it.overall_rating)}</td><td className="text-xs capitalize">{it.status}</td><td><div className="flex gap-1"><button className="text-text-muted hover:text-accent-blue p-0.5" onClick={() => handleEdit(it)}><Pencil size={12}/></button><button className="text-text-muted hover:text-accent-expense p-0.5" onClick={() => handleDelete(it.id)}><Trash2 size={12}/></button></div></td></tr>
          ))}</tbody></table></div>
      )}
    </div>
  );
};

// ─── Disciplinary Actions Panel ───────────────────────────
const SEVERITY_LABELS: Record<string, { label: string; cls: string }> = {
  verbal_warning: { label: 'Verbal Warning', cls: 'block-badge' },
  written_warning: { label: 'Written Warning', cls: 'block-badge block-badge-warning' },
  final_warning: { label: 'Final Warning', cls: 'block-badge block-badge-expense' },
  suspension: { label: 'Suspension', cls: 'block-badge block-badge-expense' },
  termination: { label: 'Termination', cls: 'block-badge block-badge-expense' },
  other: { label: 'Other', cls: 'block-badge' },
};
const DisciplinaryPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const empty = { incident_date: new Date().toISOString().split('T')[0], severity: 'verbal_warning', category: 'policy_violation', description: '', action_taken: '', follow_up_date: '', follow_up_notes: '', issued_by: '' };
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const load = async () => { const r = await api.query('employee_disciplinary', { employee_id: employeeId }); setItems(Array.isArray(r) ? r : []); };
  useEffect(() => { load(); }, [employeeId]);
  const handleSave = async () => {
    if (!form.description.trim()) { alert('Description required'); return; }
    setSaving(true);
    try {
      const payload = { employee_id: employeeId, ...form };
      const r = editingId ? await api.update('employee_disciplinary', editingId, payload) : await api.create('employee_disciplinary', payload);
      if ((r as any)?.error) throw new Error((r as any).error);
      setShowForm(false); setEditingId(null); setForm({ ...empty }); await load();
    } catch (err: any) { alert('Save failed: ' + (err?.message || 'Unknown')); } finally { setSaving(false); }
  };
  const handleEdit = (it: any) => { setEditingId(it.id); setForm({ incident_date: it.incident_date || '', severity: it.severity || 'verbal_warning', category: it.category || '', description: it.description || '', action_taken: it.action_taken || '', follow_up_date: it.follow_up_date || '', follow_up_notes: it.follow_up_notes || '', issued_by: it.issued_by || '' }); setShowForm(true); };
  const handleDelete = async (id: string) => { if (!window.confirm('Delete this record?')) return; await api.remove('employee_disciplinary', id); await load(); };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Disciplinary Actions</h3>
        <button className="block-btn-primary flex items-center gap-2 text-xs" onClick={() => { setEditingId(null); setForm({ ...empty }); setShowForm(!showForm); }}>
          <Plus size={12} /> {showForm ? 'Cancel' : 'Record Incident'}
        </button>
      </div>
      {showForm && (
        <div className="block-card p-4 space-y-3" style={{ borderRadius: 6 }}>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Incident Date</label><input type="date" className="block-input" value={form.incident_date} onChange={e => setForm(f => ({...f, incident_date: e.target.value}))} /></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Severity</label>
              <select className="block-select" value={form.severity} onChange={e => setForm(f => ({...f, severity: e.target.value}))}>
                <option value="verbal_warning">Verbal Warning</option><option value="written_warning">Written Warning</option><option value="final_warning">Final Warning</option><option value="suspension">Suspension</option><option value="termination">Termination</option><option value="other">Other</option>
              </select></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Issued By</label><input className="block-input" placeholder="Manager name" value={form.issued_by} onChange={e => setForm(f => ({...f, issued_by: e.target.value}))} /></div>
          </div>
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Category</label><input className="block-input" placeholder="e.g. Policy Violation, Attendance, Misconduct" value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))} /></div>
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Description *</label><textarea className="block-input" rows={3} value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} /></div>
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Action Taken / Corrective Plan</label><textarea className="block-input" rows={2} value={form.action_taken} onChange={e => setForm(f => ({...f, action_taken: e.target.value}))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Follow-up Date</label><input type="date" className="block-input" value={form.follow_up_date} onChange={e => setForm(f => ({...f, follow_up_date: e.target.value}))} /></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Follow-up Notes</label><input className="block-input" value={form.follow_up_notes} onChange={e => setForm(f => ({...f, follow_up_notes: e.target.value}))} /></div>
          </div>
          <button className="block-btn-primary text-xs" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update' : 'Save'}</button>
        </div>
      )}
      {items.length === 0 && !showForm ? <p className="text-sm text-text-muted">No disciplinary actions on record.</p> : (
        <div className="overflow-x-auto"><table className="block-table"><thead><tr><th>Date</th><th>Severity</th><th>Category</th><th>Description</th><th>Issued By</th><th style={{width:80}}>Actions</th></tr></thead><tbody>
          {items.sort((a: any, b: any) => (b.incident_date || '').localeCompare(a.incident_date || '')).map((it: any) => {
            const sev = SEVERITY_LABELS[it.severity] || SEVERITY_LABELS.other;
            return (<tr key={it.id}><td className="font-mono text-xs">{formatDate(it.incident_date)}</td><td><span className={sev.cls} style={{fontSize:10}}>{sev.label}</span></td><td className="text-xs">{it.category || '—'}</td><td className="text-xs truncate max-w-[200px]" title={it.description}>{it.description || '—'}</td><td className="text-xs">{it.issued_by || '—'}</td><td><div className="flex gap-1"><button className="text-text-muted hover:text-accent-blue p-0.5" onClick={() => handleEdit(it)}><Pencil size={12}/></button><button className="text-text-muted hover:text-accent-expense p-0.5" onClick={() => handleDelete(it.id)}><Trash2 size={12}/></button></div></td></tr>);
          })}</tbody></table></div>
      )}
    </div>
  );
};

// ─── Compensation History Panel ───────────────────────────
const CompensationHistoryPanel: React.FC<{ employeeId: string; currentRate: number; currentPayType: string }> = ({ employeeId, currentRate, currentPayType }) => {
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const empty = { change_date: new Date().toISOString().split('T')[0], change_type: 'raise', old_amount: currentRate, new_amount: 0, old_rate_type: currentPayType, new_rate_type: currentPayType, reason: '', approved_by: '' };
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const load = async () => {
    const r = await api.rawQuery('SELECT * FROM compensation_history WHERE employee_id = ? ORDER BY change_date DESC', [employeeId]);
    setItems(Array.isArray(r) ? r : []);
  };
  useEffect(() => { load(); }, [employeeId]);
  const handleSave = async () => {
    setSaving(true);
    try {
      const cid = await api.rawQuery("SELECT value FROM settings WHERE key = 'active_company_id' LIMIT 1", []);
      const companyId = Array.isArray(cid) && cid[0]?.value ? cid[0].value : '';
      await api.rawQuery(
        'INSERT INTO compensation_history (id, company_id, employee_id, change_date, change_type, old_amount, new_amount, old_rate_type, new_rate_type, reason, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), companyId, employeeId, form.change_date, form.change_type, form.old_amount, form.new_amount, form.old_rate_type, form.new_rate_type, form.reason, form.approved_by]
      );
      setShowForm(false); setForm({ ...empty }); await load();
    } catch (err: any) { alert('Save failed: ' + (err?.message || 'Unknown')); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Compensation History</h3>
        <button className="block-btn-primary flex items-center gap-2 text-xs" onClick={() => { setForm({ ...empty, old_amount: currentRate, old_rate_type: currentPayType, new_rate_type: currentPayType }); setShowForm(!showForm); }}>
          <Plus size={12} /> {showForm ? 'Cancel' : 'Record Change'}
        </button>
      </div>
      {showForm && (
        <div className="block-card p-4 space-y-3" style={{ borderRadius: 6 }}>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Effective Date</label><input type="date" className="block-input" value={form.change_date} onChange={e => setForm(f => ({...f, change_date: e.target.value}))} /></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Change Type</label>
              <select className="block-select" value={form.change_type} onChange={e => setForm(f => ({...f, change_type: e.target.value}))}>
                <option value="raise">Raise</option><option value="promotion">Promotion</option><option value="demotion">Demotion</option><option value="adjustment">Adjustment</option><option value="initial">Initial Rate</option>
              </select></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Approved By</label><input className="block-input" value={form.approved_by} onChange={e => setForm(f => ({...f, approved_by: e.target.value}))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Previous Rate ($)</label><input type="number" step="0.01" className="block-input" value={form.old_amount || ''} onChange={e => setForm(f => ({...f, old_amount: parseFloat(e.target.value) || 0}))} /></div>
            <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">New Rate ($)</label><input type="number" step="0.01" className="block-input" value={form.new_amount || ''} onChange={e => setForm(f => ({...f, new_amount: parseFloat(e.target.value) || 0}))} /></div>
          </div>
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Reason</label><input className="block-input" value={form.reason} onChange={e => setForm(f => ({...f, reason: e.target.value}))} placeholder="e.g. Annual review, Market adjustment" /></div>
          <button className="block-btn-primary text-xs" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      )}
      {items.length === 0 && !showForm ? <p className="text-sm text-text-muted">No compensation changes recorded. Current rate: {formatCurrency(currentRate)} ({currentPayType}).</p> : (
        <div className="overflow-x-auto"><table className="block-table"><thead><tr><th>Date</th><th>Type</th><th>Previous</th><th>New</th><th>Change</th><th>Reason</th></tr></thead><tbody>
          {items.map((it: any) => {
            const diff = (it.new_amount || 0) - (it.old_amount || 0);
            const pct = (it.old_amount || 0) > 0 ? ((diff / it.old_amount) * 100).toFixed(1) : '—';
            return (<tr key={it.id}><td className="font-mono text-xs">{formatDate(it.change_date)}</td><td className="text-xs capitalize">{(it.change_type || '').replace(/_/g, ' ')}</td><td className="font-mono text-xs">{formatCurrency(it.old_amount)}</td><td className="font-mono text-xs font-bold">{formatCurrency(it.new_amount)}</td><td className={`font-mono text-xs ${diff > 0 ? 'text-accent-income' : diff < 0 ? 'text-accent-expense' : ''}`}>{diff > 0 ? '+' : ''}{formatCurrency(diff)} ({pct}%)</td><td className="text-xs truncate max-w-[160px]" title={it.reason}>{it.reason || '—'}</td></tr>);
          })}</tbody></table></div>
      )}
    </div>
  );
};

// ─── PTO Summary Panel ────────────────────────────────────
const PtoSummaryPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [balances, setBalances] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const load = async () => {
    const b = await api.query('pto_balances', { employee_id: employeeId });
    setBalances(Array.isArray(b) ? b : []);
    const t = await api.rawQuery('SELECT * FROM pto_transactions WHERE employee_id = ? ORDER BY transaction_date DESC LIMIT 10', [employeeId]);
    setRecent(Array.isArray(t) ? t : []);
  };
  useEffect(() => { load(); }, [employeeId]);
  const totalAvailable = balances.reduce((s: number, b: any) => s + (Number(b.available_hours) || 0), 0);
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">PTO / Time Off</h3>
      {balances.length === 0 ? <p className="text-sm text-text-muted">No PTO balances. Set up PTO policies in Settings to track accruals.</p> : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {balances.map((b: any) => (
              <div key={b.id} className="block-card p-3 text-center" style={{ borderRadius: 6 }}>
                <p className="text-lg font-bold font-mono text-text-primary">{Number(b.available_hours || 0).toFixed(1)}h</p>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{(b.pto_type || 'PTO').replace(/_/g, ' ')}</p>
                {Number(b.used_hours) > 0 && <p className="text-[10px] text-text-muted mt-1">{Number(b.used_hours).toFixed(1)}h used</p>}
              </div>
            ))}
          </div>
          <p className="text-xs text-text-muted">Total available: <strong>{totalAvailable.toFixed(1)} hours</strong></p>
        </>
      )}
      {recent.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Recent Transactions</h4>
          <div className="overflow-x-auto"><table className="block-table"><thead><tr><th>Date</th><th>Type</th><th>Hours</th><th>Notes</th></tr></thead><tbody>
            {recent.map((t: any) => (
              <tr key={t.id}><td className="font-mono text-xs">{formatDate(t.transaction_date)}</td><td className="text-xs capitalize">{(t.transaction_type || '').replace(/_/g, ' ')}</td><td className={`font-mono text-xs ${(t.hours || 0) > 0 ? 'text-accent-income' : 'text-accent-expense'}`}>{(t.hours || 0) > 0 ? '+' : ''}{Number(t.hours || 0).toFixed(1)}h</td><td className="text-xs truncate max-w-[200px]">{t.notes || '—'}</td></tr>
            ))}</tbody></table></div>
        </div>
      )}
    </div>
  );
};

// ─── Onboarding / Offboarding Checklist ───────────────────
// Hybrid: auto-detected steps (derived from real data) + manual
// check-offs. Auto steps are read-only reflections of system state;
// manual steps persist in employee_checklist_items.
const OnboardingPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [phase, setPhase] = useState<'onboarding' | 'offboarding'>('onboarding');
  const [data, setData] = useState<{ steps: any[]; done: number; total: number; employee_name?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.employeeChecklist(employeeId, phase);
      if (!r?.error) setData(r);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [employeeId, phase]);

  const toggle = async (stepKey: string, done: boolean) => {
    await api.employeeChecklistToggle(employeeId, phase, stepKey, done);
    await load();
  };

  const pct = data ? Math.round((data.done / Math.max(1, data.total)) * 100) : 0;

  // Group steps by category.
  const grouped = useMemo(() => {
    if (!data) return new Map<string, any[]>();
    const m = new Map<string, any[]>();
    for (const s of data.steps) {
      const arr = m.get(s.category) || [];
      arr.push(s);
      m.set(s.category, arr);
    }
    return m;
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">
          {phase === 'onboarding' ? 'Onboarding Checklist' : 'Offboarding Checklist'}
        </h3>
        <div className="flex gap-1">
          {(['onboarding', 'offboarding'] as const).map(p => (
            <button key={p} onClick={() => setPhase(p)}
              className={`px-3 py-1 text-xs font-semibold capitalize ${phase === p ? 'text-white' : 'text-text-secondary'}`}
              style={{ borderRadius: 6, background: phase === p ? 'rgba(59,130,246,0.8)' : 'rgba(255,255,255,0.04)' }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      {data && (
        <div className="block-card p-3" style={{ borderRadius: 6 }}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-text-muted font-semibold uppercase tracking-wider">{data.done} of {data.total} complete</span>
            <span className={`font-bold font-mono ${pct === 100 ? 'text-accent-income' : 'text-accent-blue'}`}>{pct}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: pct === 100 ? 'var(--color-accent-income)' : 'var(--color-accent-blue)', transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-6 text-xs text-text-muted">Loading checklist…</div>
      ) : (
        <div className="space-y-3">
          {[...grouped.entries()].map(([category, steps]) => (
            <div key={category}>
              <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider px-1 mb-1">{category}</div>
              <div className="block-card overflow-hidden" style={{ borderRadius: 6 }}>
                {steps.map((step: any, i: number) => (
                  <div key={step.key}
                    className="flex items-center gap-3 px-3 py-2 transition-colors"
                    style={{
                      borderBottom: i < steps.length - 1 ? '1px solid var(--color-border-primary)' : undefined,
                      background: step.done ? 'rgba(22,163,74,0.04)' : undefined,
                    }}>
                    {step.auto ? (
                      <span className={`w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 ${step.done ? 'text-accent-income' : 'text-text-muted'}`} style={{ borderRadius: 6, border: `1.5px solid ${step.done ? 'var(--color-accent-income)' : 'var(--color-border-primary)'}` }}>
                        {step.done ? '✓' : ''}
                      </span>
                    ) : (
                      <input type="checkbox" checked={step.done} onChange={(e) => toggle(step.key, e.target.checked)}
                        style={{ width: 18, height: 18, accentColor: 'var(--color-accent-income)', cursor: 'pointer' }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${step.done ? 'text-text-muted line-through' : 'text-text-primary font-medium'}`}>{step.label}</span>
                        {step.auto && <span className="text-[9px] text-accent-blue px-1 py-0.5" style={{ borderRadius: 4, background: 'rgba(59,130,246,0.1)' }}>AUTO</span>}
                      </div>
                      <p className="text-[11px] text-text-muted truncate">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Credentials & Licenses Panel ─────────────────────────
const CREDENTIAL_TYPES: { value: string; label: string }[] = [
  { value: 'license', label: 'License' },
  { value: 'certification', label: 'Certification' },
  { value: 'training', label: 'Training' },
  { value: 'background_check', label: 'Background Check' },
  { value: 'drug_test', label: 'Drug Test' },
  { value: 'i9', label: 'I-9 Verification' },
  { value: 'w4', label: 'W-4' },
  { value: 'other', label: 'Other' },
];
const CredentialsPanel: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const empty = { credential_type: 'license', name: '', issuer: '', credential_number: '', issue_date: '', expiry_date: '', notes: '' };
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const rows = await api.query('employee_credentials', { employee_id: employeeId });
    setItems(Array.isArray(rows) ? rows : []);
  };
  useEffect(() => { load(); }, [employeeId]);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { employee_id: employeeId, ...form, name: form.name.trim(), issuer: form.issuer.trim(), credential_number: form.credential_number.trim(), issue_date: form.issue_date || null, expiry_date: form.expiry_date || null, notes: form.notes.trim() };
      const r = editingId ? await api.update('employee_credentials', editingId, payload) : await api.create('employee_credentials', payload);
      if ((r as any)?.error) throw new Error((r as any).error);
      setShowForm(false); setEditingId(null); setForm({ ...empty }); await load();
    } catch (err: any) {
      alert('Failed to save credential: ' + (err?.message || 'Unknown error'));
    } finally { setSaving(false); }
  };
  const handleEdit = (it: any) => {
    setEditingId(it.id);
    setForm({ credential_type: it.credential_type || 'license', name: it.name || '', issuer: it.issuer || '', credential_number: it.credential_number || '', issue_date: it.issue_date || '', expiry_date: it.expiry_date || '', notes: it.notes || '' });
    setShowForm(true);
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this credential?')) return;
    await api.remove('employee_credentials', id); await load();
  };

  // Display-side status (the notification engine uses per-type windows;
  // the badge uses a simple 30-day "expiring soon" cue).
  const expiryBadge = (expiry?: string) => {
    if (!expiry) return <span className="text-text-muted text-xs">—</span>;
    const today = new Date().toISOString().split('T')[0];
    const soon = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    if (expiry < today) return <span className="block-badge block-badge-expense" style={{ fontSize: 10 }}>Expired {formatDate(expiry)}</span>;
    if (expiry <= soon) return <span className="block-badge block-badge-warning" style={{ fontSize: 10 }}>Expiring {formatDate(expiry)}</span>;
    return <span className="block-badge block-badge-income" style={{ fontSize: 10 }}>Valid · {formatDate(expiry)}</span>;
  };
  const typeLabel = (t: string) => CREDENTIAL_TYPES.find((x) => x.value === t)?.label || t;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Credentials & Licenses</h3>
        <button className="block-btn-primary flex items-center gap-2 text-xs" onClick={() => { setEditingId(null); setForm({ ...empty }); setShowForm(!showForm); }}>
          <Plus size={12} /> {showForm ? 'Cancel' : 'Add Credential'}
        </button>
      </div>

      {showForm && (
        <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Type</label>
              <select className="block-select" value={form.credential_type} onChange={(e) => setForm(f => ({ ...f, credential_type: e.target.value }))}>
                {CREDENTIAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Name / Title *</label>
              <input className="block-input" placeholder="e.g. Utah Private Investigator License" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Issuer</label>
              <input className="block-input" placeholder="e.g. Utah DOPL" value={form.issuer} onChange={(e) => setForm(f => ({ ...f, issuer: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Credential #</label>
              <input className="block-input font-mono" value={form.credential_number} onChange={(e) => setForm(f => ({ ...f, credential_number: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Issue Date</label>
              <input type="date" className="block-input" value={form.issue_date} onChange={(e) => setForm(f => ({ ...f, issue_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Expiry Date</label>
              <input type="date" className="block-input" value={form.expiry_date} onChange={(e) => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Notes</label>
              <input className="block-input" value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <button className="block-btn-primary text-xs" onClick={handleSave} disabled={saving || !form.name.trim()}>{saving ? 'Saving...' : editingId ? 'Update' : 'Save'}</button>
        </div>
      )}

      {items.length === 0 && !showForm ? (
        <p className="text-sm text-text-muted">No credentials on file. Track licenses, certifications, background checks, and I-9/W-4 with expiry — the system will alert you before they lapse.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="block-table">
            <thead><tr><th>Type</th><th>Name</th><th>Issuer</th><th>Credential #</th><th>Status</th><th style={{ width: 80 }}>Actions</th></tr></thead>
            <tbody>
              {items.map((it: any) => (
                <tr key={it.id}>
                  <td className="text-xs text-text-muted">{typeLabel(it.credential_type)}</td>
                  <td className="text-text-primary font-medium">{it.name}</td>
                  <td className="text-xs">{it.issuer || '—'}</td>
                  <td className="font-mono text-xs">{it.credential_number || '—'}</td>
                  <td>{expiryBadge(it.expiry_date)}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="text-text-muted hover:text-accent-blue p-0.5" onClick={() => handleEdit(it)} title="Edit"><Pencil size={12} /></button>
                      <button className="text-text-muted hover:text-accent-expense p-0.5" onClick={() => handleDelete(it.id)} title="Delete"><Trash2 size={12} /></button>
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
interface SigInput { name: string; date: string }
interface SigData { employee?: SigInput; employer?: SigInput; employerTitle?: string }
interface SignedDoc { id: string; html: string; employee?: SigInput; employer?: SigInput; employerTitle?: string }

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
            const sigs: any[] = full?.signatures || [];
            const emp = sigs.find((s: any) => s.signer_type === 'employee');
            const empr = sigs.find((s: any) => s.signer_type === 'admin');
            const empSig = emp ? { name: emp.typed_name || emp.signer_name, date: (emp.signed_at || '').slice(0, 10) } : undefined;
            const emprSig = empr ? { name: empr.typed_name || empr.signer_name, date: (empr.signed_at || '').slice(0, 10) } : undefined;
            // IMPORTANT: do NOT use the stored content (full?.content) —
            // old documents may have signatures appended in the footer via
            // the legacy embedSignature() approach. Always regenerate the
            // HTML fresh with the signature data passed to the backend's
            // agreementSignatureBlock, which renders them IN the formal
            // Signatures section. This also picks up any template changes.
            const freshHtml = await (async () => {
              try {
                const sigData: SigData = { employee: empSig, employer: emprSig };
                const { html: h } = type === 'equipment'
                  ? await api.generateEquipmentAgreement(employeeId, sigData)
                  : await api.generateEmployeeAgreement(employeeId, sigData);
                return h || '';
              } catch { return ''; }
            })();
            next[type] = {
              id: doc.id,
              html: freshHtml,
              employee: empSig,
              employer: emprSig,
            };
          }
        }
        if (!cancelled) setSigned(next);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const genHtml = async (type: AgreementType, sigs?: SigData): Promise<string> => {
    const { html } = type === 'equipment'
      ? await api.generateEquipmentAgreement(employeeId, sigs)
      : await api.generateEmployeeAgreement(employeeId, sigs);
    return html || '';
  };

  // Always regenerate fresh HTML with current sigs so signatures render
  // in the formal Signatures section (not the footer from legacy stored
  // content). If the doc is signed, pass the sig data; if not, no sigs.
  const getLatestHtml = async (type: AgreementType): Promise<string> => {
    const sig = signed[type];
    const sigs: SigData | undefined = (sig?.employee || sig?.employer) ? { employee: sig?.employee, employer: sig?.employer, employerTitle: sig?.employerTitle } : undefined;
    return genHtml(type, sigs);
  };

  const handleGenerate = async (type: AgreementType) => {
    const setLoading = type === 'equipment' ? setGeneratingEquip : setGeneratingEmp;
    setLoading(true);
    try {
      const html = await getLatestHtml(type);
      if (html) await api.printPreview(html, AGREEMENT_TITLE[type]);
    } catch (err: any) {
      alert('Failed to generate document: ' + (err?.message || 'Unknown error'));
    } finally { setLoading(false); }
  };

  const handleSavePDF = async (type: AgreementType) => {
    const setLoading = type === 'equipment' ? setGeneratingEquip : setGeneratingEmp;
    setLoading(true);
    try {
      const html = await getLatestHtml(type);
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

  // Generate the agreement WITH the signatures rendered in-place (formal
  // Signatures section, both parties), persist it as an e-sign document,
  // and record each party's signature (employee + employer/admin).
  const handleSign = async (type: AgreementType, data: SigData) => {
    if (!data.employee?.name && !data.employer?.name) throw new Error('Enter at least one signature.');
    const signedHtml = await genHtml(type, data);
    if (!signedHtml) throw new Error('Could not generate the agreement to sign.');
    const created = await api.esignCreate(`${AGREEMENT_TITLE[type]} — ${employeeName}`, marker(type), signedHtml);
    if (!created?.id) throw new Error('Could not create the e-sign document.');
    if (data.employee?.name) {
      const r = await api.esignSign(created.id, data.employee.name, 'employee', employeeId, employeeName, data.employee.date);
      if (r?.error) throw new Error(r.error);
    }
    if (data.employer?.name) {
      const r = await api.esignSign(created.id, data.employer.name, 'admin', '', data.employer.name, data.employer.date);
      if (r?.error) throw new Error(r.error);
    }
    setSigned((prev) => ({ ...prev, [type]: { id: created.id, html: signedHtml, employee: data.employee, employer: data.employer, employerTitle: data.employerTitle } }));
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
        {sig && (sig.employee || sig.employer) && (
          <div className="text-xs space-y-0.5" style={{ color: 'var(--color-accent-income)' }}>
            {sig.employee && (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={13} /><span>Employee: <strong>{sig.employee.name}</strong>{sig.employee.date ? ` · ${new Date(sig.employee.date + 'T12:00:00').toLocaleDateString()}` : ''}</span>
              </div>
            )}
            {sig.employer && (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={13} /><span>Employer: <strong>{sig.employer.name}</strong>{sig.employer.date ? ` · ${new Date(sig.employer.date + 'T12:00:00').toLocaleDateString()}` : ''}</span>
              </div>
            )}
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
          defaultEmployeeName={employeeName}
          onClose={() => setSignModal(null)}
          onSign={async (data) => { await handleSign(signModal, data); setSignModal(null); }}
        />
      )}
    </div>
  );
};

// ─── E-Sign Modal ─────────────────────────────────────────
// Captures a typed signature + a signing date. The date defaults to today
// and is capped at today (max=) so the user can back-date to the current OR
// a past date — but never the future.
// Captures BOTH the employee and (optionally) the employer/admin
// signature — each a typed name + date (defaults to today, capped at
// today so you can back-date but not future-date). The signatures are
// rendered in-place in the document's formal Signatures section.
const CURSIVE = "'Snell Roundhand','Apple Chancery','Brush Script MT',cursive";
const ESignModal: React.FC<{
  title: string;
  defaultEmployeeName: string;
  onClose: () => void;
  onSign: (data: SigData) => Promise<void>;
}> = ({ title, defaultEmployeeName, onClose, onSign }) => {
  const today = new Date().toISOString().split('T')[0];
  const [empName, setEmpName] = useState(defaultEmployeeName || '');
  const [empDate, setEmpDate] = useState(today);
  const [addEmployer, setAddEmployer] = useState(false);
  const [emprName, setEmprName] = useState('');
  const [emprDate, setEmprDate] = useState(today);
  const [emprTitle, setEmprTitle] = useState('HR Manager');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!empName.trim() && !(addEmployer && emprName.trim())) { setError('Enter at least one signer name.'); return; }
    if (!agree) { setError('You must confirm intent to sign.'); return; }
    if (empDate > today || (addEmployer && emprDate > today)) { setError('Signing dates cannot be in the future.'); return; }
    setBusy(true); setError('');
    try {
      await onSign({
        employee: empName.trim() ? { name: empName.trim(), date: empDate } : undefined,
        employer: addEmployer && emprName.trim() ? { name: emprName.trim(), date: emprDate } : undefined,
        employerTitle: addEmployer ? (emprTitle.trim() || 'HR Manager') : undefined,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to sign');
    } finally { setBusy(false); }
  };

  const sigPreview = (name: string) => name.trim() ? (
    <div className="mt-2 px-3 py-2" style={{ borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border-primary)' }}>
      <span style={{ fontFamily: CURSIVE, fontSize: 24, color: 'var(--color-text-primary)' }}>{name}</span>
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="block-card w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto" style={{ borderRadius: '10px' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PenTool size={16} className="text-accent-income" />
            <span className="text-sm font-bold text-text-primary">E-Sign Document</span>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary" style={{ borderRadius: '6px' }}><X size={16} /></button>
        </div>
        <p className="text-xs text-text-muted">{title}</p>

        {/* Employee signature */}
        <div className="p-3" style={{ borderRadius: 6, border: '1px solid var(--color-border-primary)' }}>
          <label className="block text-[11px] font-bold text-text-secondary uppercase tracking-wider mb-2">Employee Signature</label>
          <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
            <input className="block-input" value={empName} onChange={(e) => setEmpName(e.target.value)} placeholder="Employee full legal name" autoFocus />
            <input type="date" className="block-input" value={empDate} max={today} onChange={(e) => setEmpDate(e.target.value)} />
          </div>
          {sigPreview(empName)}
        </div>

        {/* Employer / admin signature */}
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={addEmployer} onChange={(e) => setAddEmployer(e.target.checked)} style={{ accentColor: 'var(--color-accent-income)' }} />
          Add employer / authorized representative signature
        </label>
        {addEmployer && (
          <div className="p-3" style={{ borderRadius: 6, border: '1px solid var(--color-border-primary)' }}>
            <label className="block text-[11px] font-bold text-text-secondary uppercase tracking-wider mb-2">Employer Signature</label>
            <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
              <input className="block-input" value={emprName} onChange={(e) => setEmprName(e.target.value)} placeholder="Authorized representative name" />
              <input type="date" className="block-input" value={emprDate} max={today} onChange={(e) => setEmprDate(e.target.value)} />
            </div>
            <input className="block-input mt-2" value={emprTitle} onChange={(e) => setEmprTitle(e.target.value)} placeholder="Title (e.g. HR Manager)" />
            {sigPreview(emprName)}
          </div>
        )}

        <p className="text-[10px] text-text-muted">Dates default to today; you may back-date to a past date but not the future.</p>

        <label className="flex items-start gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--color-accent-income)' }} />
          <span>The named parties agree that typing their name constitutes their electronic signature and that they have read and accept this document.</span>
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
  const [activeTab, setActiveTab] = useState<'general' | 'hr' | 'banking' | 'deductions' | 'equipment' | 'hr-suite'>('general');
  const [ytdSummary, setYtdSummary] = useState<any>(null);

  const isEditing = Boolean(employeeId);

  // PERF: memoize the pay-history element so it isn't re-rendered on every
  // keystroke in the form (it only depends on the stable employeeId).
  const payHistoryEl = useMemo(
    () => (employeeId ? <PayHistory employeeId={employeeId} /> : null),
    [employeeId]
  );

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
          {(['general', 'hr', 'banking', 'deductions', 'equipment', 'hr-suite'] as const).map((tab) => (
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
              {tab === 'general' ? 'General' : tab === 'hr' ? 'HR & Profile' : tab === 'banking' ? 'Banking & Emergency' : tab === 'deductions' ? 'Deductions' : tab === 'equipment' ? 'Equipment & Agreements' : 'HR Suite'}
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
            <OnboardingPanel employeeId={employeeId} />
            <div className="border-t border-border-primary" />
            <EquipmentPanel employeeId={employeeId} />
            <div className="border-t border-border-primary" />
            <CredentialsPanel employeeId={employeeId} />
            <div className="border-t border-border-primary" />
            <AgreementsPanel employeeId={employeeId} employeeName={form.name} />
          </div>
        )}
        {activeTab === 'equipment' && !employeeId && (
          <p className="text-sm text-text-muted">Save the employee first to manage equipment and generate agreements.</p>
        )}

        {/* HR Suite — performance reviews, disciplinary, compensation history, PTO */}
        {activeTab === 'hr-suite' && employeeId && (
          <div className="space-y-6">
            <PerformanceReviewsPanel employeeId={employeeId} />
            <div className="border-t border-border-primary" />
            <DisciplinaryPanel employeeId={employeeId} />
            <div className="border-t border-border-primary" />
            <CompensationHistoryPanel employeeId={employeeId} currentRate={Number(form.pay_rate) || 0} currentPayType={form.pay_type} />
            <div className="border-t border-border-primary" />
            <PtoSummaryPanel employeeId={employeeId} />
          </div>
        )}
        {activeTab === 'hr-suite' && !employeeId && (
          <p className="text-sm text-text-muted">Save the employee first to access the HR Suite.</p>
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
                  {/* Use formatCurrency (pins both min AND max fraction digits
                      to 2). The bare toLocaleString with only minimumFractionDigits
                      let sub-cent values render 3 decimals, e.g. $340.016. */}
                  {formatCurrency(Number(item.value || 0))}
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

      {/* Pay History (memoized — see payHistoryEl) */}
      {isEditing && payHistoryEl}

      {/* Cross-integration panels (memoized components + stable props) */}
      {isEditing && employeeId && (
        <div className="grid grid-cols-2 gap-4 mt-6">
          <MemoRelatedPanel entityType="employee" entityId={employeeId} hide={HIDE_PAYSTUBS} />
          <MemoEntityTimeline entityType="employees" entityId={employeeId} />
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
