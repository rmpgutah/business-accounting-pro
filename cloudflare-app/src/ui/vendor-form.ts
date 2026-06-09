// New/edit a vendor. Mirrors the desktop vendors table for the columns the
// expense capture screen + Expense Record print actually use.

import { shell, escapeHTML } from './shell';

export interface VendorRow {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  tax_id?: string;
  status?: string;
}

export function vendorFormPage(row: VendorRow | null): string {
  const isEdit = !!row?.id;
  const r = row || {};
  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} Vendor</h1>
  <a href="/app/vendors" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="card grid" style="gap:1rem">
  <label class="field">Name<input name="name" required maxlength="120" value="${escapeHTML(r.name || '')}"></label>
  <div class="grid grid-2">
    <label class="field">Email<input name="email" type="email" value="${escapeHTML(r.email || '')}"></label>
    <label class="field">Phone<input name="phone" type="tel" value="${escapeHTML(r.phone || '')}"></label>
  </div>
  <label class="field">Address<textarea name="address" rows="3">${escapeHTML(r.address || '')}</textarea></label>
  <div class="grid grid-2">
    <label class="field">Website<input name="website" type="url" placeholder="https://" value="${escapeHTML(r.website || '')}"></label>
    <label class="field">Tax ID / EIN<input name="tax_id" value="${escapeHTML(r.tax_id || '')}"></label>
  </div>
  <label class="field">Status
    <select name="status">
      <option value="active"${r.status === 'active' || !r.status ? ' selected' : ''}>Active</option>
      <option value="inactive"${r.status === 'inactive' ? ' selected' : ''}>Inactive</option>
    </select>
  </label>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    ${isEdit ? `<button type="button" id="del" class="btn btn-danger">Delete</button>` : ''}
    <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Create vendor'}</button>
  </div>
</form>
<script>
const isEdit = ${isEdit ? 'true' : 'false'};
const id = ${isEdit ? JSON.stringify(r.id) : 'null'};
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const payload = Object.fromEntries(new FormData(ev.target).entries());
  const url = isEdit ? '/api/vendors/' + id : '/api/vendors';
  const method = isEdit ? 'PUT' : 'POST';
  try {
    await window.fetchJSON(url, { method, body: JSON.stringify(payload) });
    window.toast('Vendor saved', 'ok');
    setTimeout(() => location.href = '/app/vendors', 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this vendor? Existing expenses keep the vendor name but lose the link.')) return;
  try { await window.fetchJSON('/api/vendors/' + id, { method: 'DELETE' });
    location.href = '/app/vendors';
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({ title: isEdit ? 'Edit Vendor' : 'New Vendor', activeNav: 'vendors', body, brand: 'BAP Cloud' });
}
