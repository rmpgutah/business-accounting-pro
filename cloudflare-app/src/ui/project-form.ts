// New/edit project. Projects feed expenses/time/invoices via project_id;
// budget vs spent rolls up in the listing.

import { shell, escapeHTML } from './shell';

export interface ProjectRow {
  id?: string;
  client_id?: string | null;
  name?: string;
  description?: string;
  status?: string;
  budget?: number;
  budget_type?: string;
  start_date?: string;
  end_date?: string;
  hourly_rate?: number;
}

export function projectFormPage(
  row: ProjectRow | null,
  clients: Array<{ id: string; name: string }>,
  todayISO: string,
): string {
  const isEdit = !!row?.id;
  const r = row || {};
  const clientOpts = clients.map(c =>
    `<option value="${escapeHTML(c.id)}"${c.id === r.client_id ? ' selected' : ''}>${escapeHTML(c.name)}</option>`).join('');
  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} Project</h1>
  <a href="/app/projects" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="card grid" style="gap:1rem">
  <label class="field">Name<input name="name" required maxlength="160" value="${escapeHTML(r.name || '')}"></label>
  <label class="field">Client (optional)
    <select name="client_id"><option value="">— None —</option>${clientOpts}</select>
  </label>
  <label class="field">Description<textarea name="description" rows="3">${escapeHTML(r.description || '')}</textarea></label>
  <div class="grid grid-3">
    <label class="field">Status
      <select name="status">
        ${['active','completed','on_hold','archived'].map(s =>
          `<option value="${s}"${(r.status || 'active') === s ? ' selected' : ''}>${s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('')}
      </select>
    </label>
    <label class="field">Budget Type
      <select name="budget_type">
        ${['none','fixed','hourly'].map(s =>
          `<option value="${s}"${(r.budget_type || 'none') === s ? ' selected' : ''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
      </select>
    </label>
    <label class="field">Budget<input name="budget" type="number" step="0.01" min="0" inputmode="decimal" value="${r.budget || ''}"></label>
  </div>
  <div class="grid grid-3">
    <label class="field">Start Date<input name="start_date" type="date" value="${escapeHTML(r.start_date || todayISO)}"></label>
    <label class="field">End Date<input name="end_date" type="date" value="${escapeHTML(r.end_date || '')}"></label>
    <label class="field">Hourly Rate<input name="hourly_rate" type="number" step="0.01" min="0" inputmode="decimal" value="${r.hourly_rate || ''}"></label>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    ${isEdit ? `<button type="button" id="del" class="btn btn-danger">Delete</button>` : ''}
    <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Create project'}</button>
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
    if (k === 'budget' || k === 'hourly_rate') payload[k] = v ? Number(v) : 0;
    else payload[k] = v === '' ? null : v;
  }
  const url = isEdit ? '/api/projects/' + id : '/api/projects';
  try {
    await window.fetchJSON(url, { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    window.toast('Project saved', 'ok');
    setTimeout(() => location.href = '/app/projects', 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this project? Linked time/expenses keep the project_id but lose context.')) return;
  try { await window.fetchJSON('/api/projects/' + id, { method: 'DELETE' });
    location.href = '/app/projects';
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({ title: isEdit ? 'Edit Project' : 'New Project', activeNav: 'projects', body, brand: 'BAP Cloud' });
}
