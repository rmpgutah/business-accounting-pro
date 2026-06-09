// New/edit employee. Backs the time-tracking module (pay_rate flows into
// time_entries.hourly_rate as the default).

import { shell, escapeHTML } from './shell';

export interface EmployeeRow {
  id?: string; name?: string; email?: string; phone?: string;
  role?: string; pay_rate?: number; pay_type?: string;
  hire_date?: string; status?: string; notes?: string;
}

export function employeeFormPage(row: EmployeeRow | null): string {
  const isEdit = !!row?.id;
  const r = row || {};
  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} Employee</h1>
  <a href="/app/employees" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="card grid" style="gap:1rem">
  <label class="field">Name<input name="name" required maxlength="120" value="${escapeHTML(r.name || '')}"></label>
  <div class="grid grid-2">
    <label class="field">Email<input name="email" type="email" value="${escapeHTML(r.email || '')}"></label>
    <label class="field">Phone<input name="phone" type="tel" value="${escapeHTML(r.phone || '')}"></label>
  </div>
  <div class="grid grid-3">
    <label class="field">Role
      <select name="role">
        ${['employee','contractor','admin','owner'].map(s =>
          `<option value="${s}"${r.role === s ? ' selected' : ''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
      </select>
    </label>
    <label class="field">Pay Type
      <select name="pay_type">
        ${['hourly','salary','1099'].map(s =>
          `<option value="${s}"${(r.pay_type || 'hourly') === s ? ' selected' : ''}>${s === '1099' ? '1099' : s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
      </select>
    </label>
    <label class="field">Pay Rate<input name="pay_rate" type="number" step="0.01" min="0" inputmode="decimal" value="${r.pay_rate || ''}"></label>
  </div>
  <div class="grid grid-2">
    <label class="field">Hire Date<input name="hire_date" type="date" value="${escapeHTML(r.hire_date || '')}"></label>
    <label class="field">Status
      <select name="status">
        <option value="active"${r.status === 'active' || !r.status ? ' selected' : ''}>Active</option>
        <option value="inactive"${r.status === 'inactive' ? ' selected' : ''}>Inactive</option>
      </select>
    </label>
  </div>
  <label class="field">Notes<textarea name="notes" rows="3">${escapeHTML(r.notes || '')}</textarea></label>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    ${isEdit ? `<button type="button" id="del" class="btn btn-danger">Delete</button>` : ''}
    <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Create employee'}</button>
  </div>
</form>
<script>
const isEdit = ${isEdit ? 'true' : 'false'};
const id = ${isEdit ? JSON.stringify(r.id) : 'null'};
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const payload = {};
  for (const [k,v] of fd.entries()) {
    if (k === 'pay_rate') payload[k] = v ? Number(v) : 0;
    else payload[k] = v === '' ? null : v;
  }
  const url = isEdit ? '/api/employees/' + id : '/api/employees';
  try {
    await window.fetchJSON(url, { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    window.toast('Employee saved', 'ok');
    setTimeout(() => location.href = '/app/employees', 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this employee? Time entries stay; the employee link is cleared.')) return;
  try { await window.fetchJSON('/api/employees/' + id, { method: 'DELETE' });
    location.href = '/app/employees';
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({ title: isEdit ? 'Edit Employee' : 'New Employee', activeNav: 'employees', body, brand: 'BAP Cloud' });
}
