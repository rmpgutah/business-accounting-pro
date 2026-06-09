// New/edit time entry. Auto-fills hourly_rate from the selected employee's
// pay_rate via a small fetch on selector change; the server still recomputes
// on save so a manipulated DOM can't bill higher than the employee record.

import { shell, escapeHTML } from './shell';

export interface TimeRow {
  id?: string;
  employee_id?: string;
  project_id?: string | null;
  client_id?: string | null;
  date?: string;
  duration_minutes?: number;
  description?: string;
  is_billable?: number;
  hourly_rate?: number;
  is_invoiced?: number;
}
type Opt = { id: string; name: string };

export function timeFormPage(
  row: TimeRow | null,
  employees: Array<Opt & { pay_rate?: number }>,
  projects: Opt[],
  clients: Opt[],
  todayISO: string,
): string {
  const isEdit = !!row?.id;
  const r = row || {};
  const opts = (xs: Opt[], sel?: string | null, dataPay?: number) => xs.map(x =>
    `<option value="${escapeHTML(x.id)}"${x.id === sel ? ' selected' : ''}${dataPay != null ? ` data-pay="${dataPay}"` : ''}>${escapeHTML(x.name)}</option>`
  ).join('');
  const empOpts = employees.map(e =>
    `<option value="${escapeHTML(e.id)}"${e.id === r.employee_id ? ' selected' : ''} data-pay="${e.pay_rate || 0}">${escapeHTML(e.name)}</option>`
  ).join('');
  const initHours = ((r.duration_minutes || 0) / 60).toFixed(2);

  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} Time Entry</h1>
  <a href="/app/time" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="card grid" style="gap:1rem">
  <div class="grid grid-2">
    <label class="field">Employee
      <select name="employee_id" id="empSel" required>
        <option value="">— Choose employee —</option>${empOpts}
      </select>
    </label>
    <label class="field">Date<input name="date" type="date" required value="${escapeHTML(r.date || todayISO)}"></label>
  </div>
  <div class="grid grid-3">
    <label class="field">Hours<input name="hours" id="hoursInp" type="number" step="0.25" min="0" required inputmode="decimal" value="${initHours}"></label>
    <label class="field">Hourly Rate<input name="hourly_rate" id="rateInp" type="number" step="0.01" min="0" inputmode="decimal" value="${r.hourly_rate || ''}" placeholder="Defaults from employee"></label>
    <label class="field" style="justify-content:flex-end">
      <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-weight:500;color:var(--text);cursor:pointer">
        <input type="checkbox" id="billable" name="is_billable" ${r.is_billable ? 'checked' : ''}>
        Billable to client
      </label>
    </label>
  </div>
  <div class="grid grid-2">
    <label class="field">Project (optional)
      <select name="project_id"><option value="">— None —</option>${opts(projects, r.project_id || null)}</select>
    </label>
    <label class="field">Client (optional)
      <select name="client_id"><option value="">— None —</option>${opts(clients, r.client_id || null)}</select>
    </label>
  </div>
  <label class="field">Description<textarea name="description" rows="3" placeholder="What did you work on?">${escapeHTML(r.description || '')}</textarea></label>
  ${r.is_invoiced ? '<div class="badge badge-green">Already invoiced</div>' : ''}
  <div style="display:flex;gap:8px;justify-content:flex-end">
    ${isEdit ? `<button type="button" id="del" class="btn btn-danger">Delete</button>` : ''}
    <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Log time'}</button>
  </div>
</form>
<script>
const isEdit = ${isEdit ? 'true' : 'false'};
const id = ${isEdit ? JSON.stringify(r.id) : 'null'};
const empSel = document.getElementById('empSel');
const rateInp = document.getElementById('rateInp');
// When the user picks an employee, autofill the rate UNLESS they already
// typed a custom one. data-pay carries the employee's stored pay_rate.
empSel.addEventListener('change', () => {
  if (rateInp.value) return;
  const sel = empSel.options[empSel.selectedIndex];
  const pay = sel && sel.getAttribute('data-pay');
  if (pay && Number(pay) > 0) rateInp.value = Number(pay).toFixed(2);
});
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const hours = Number(fd.get('hours')) || 0;
  const payload = {
    employee_id: fd.get('employee_id'),
    date: fd.get('date'),
    duration_minutes: Math.round(hours * 60),
    hourly_rate: Number(fd.get('hourly_rate')) || 0,
    description: fd.get('description') || null,
    project_id: fd.get('project_id') || null,
    client_id: fd.get('client_id') || null,
    is_billable: fd.get('is_billable') ? 1 : 0,
  };
  const url = isEdit ? '/api/time/' + id : '/api/time';
  try {
    await window.fetchJSON(url, { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    window.toast('Time entry saved', 'ok');
    setTimeout(() => location.href = '/app/time', 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this time entry?')) return;
  try { await window.fetchJSON('/api/time/' + id, { method: 'DELETE' });
    location.href = '/app/time';
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({ title: isEdit ? 'Edit Time' : 'New Time', activeNav: 'time', body, brand: 'BAP Cloud' });
}
