// New/edit a client. Standard fields mirror the desktop's clients table.
// Backing API: POST /api/clients (create) or PUT /api/clients/:id (update).

import { shell, escapeHTML } from './shell';

export interface ClientRow {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  tax_id?: string;
  notes?: string;
  status?: string;
}

export function clientFormPage(row: ClientRow | null): string {
  const isEdit = !!row?.id;
  const r = row || {};
  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} Client</h1>
  <a href="/app/clients" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="card grid" style="gap:1rem">
  <label class="field">Name<input name="name" required maxlength="120" value="${escapeHTML(r.name || '')}"></label>
  <div class="grid grid-2">
    <label class="field">Email<input name="email" type="email" value="${escapeHTML(r.email || '')}"></label>
    <label class="field">Phone<input name="phone" type="tel" value="${escapeHTML(r.phone || '')}"></label>
  </div>
  <label class="field">Address<textarea name="address" rows="3">${escapeHTML(r.address || '')}</textarea></label>
  <div class="grid grid-2">
    <label class="field">Tax ID / EIN<input name="tax_id" value="${escapeHTML(r.tax_id || '')}"></label>
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
    <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Create client'}</button>
  </div>
</form>
<script>
const isEdit = ${isEdit ? 'true' : 'false'};
const id = ${isEdit ? JSON.stringify(r.id) : 'null'};
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const payload = Object.fromEntries(new FormData(ev.target).entries());
  const url = isEdit ? '/api/clients/' + id : '/api/clients';
  const method = isEdit ? 'PUT' : 'POST';
  try {
    await window.fetchJSON(url, { method, body: JSON.stringify(payload) });
    window.toast('Client saved', 'ok');
    setTimeout(() => location.href = '/app/clients', 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this client? Their invoices stay but become unlinked.')) return;
  try { await window.fetchJSON('/api/clients/' + id, { method: 'DELETE' });
    location.href = '/app/clients';
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({ title: isEdit ? 'Edit Client' : 'New Client', activeNav: 'clients', body, brand: 'BAP Cloud' });
}
