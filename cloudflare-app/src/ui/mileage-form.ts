// New/edit a mileage trip. Auto-fills the IRS standard rate for the trip's
// year on the server (the rate column lives in the mileage_log row when set,
// otherwise the API resolves it).

import { shell, escapeHTML } from './shell';

export interface MileageRow {
  id?: string;
  trip_date?: string;
  purpose?: string;
  start_location?: string;
  end_location?: string;
  miles?: number;
  rate_per_mile?: number;
  vehicle?: string;
  project_id?: string | null;
  client_id?: string | null;
  is_billable?: number;
  billed_invoice_id?: string | null;
  notes?: string;
}

export function mileageFormPage(
  row: MileageRow | null,
  projects: Array<{ id: string; name: string }>,
  clients: Array<{ id: string; name: string }>,
  defaultRate: number,
  todayISO: string,
): string {
  const isEdit = !!row?.id;
  const r = row || {};
  const opts = (xs: Array<{ id: string; name: string }>, sel?: string | null) =>
    xs.map(x => `<option value="${escapeHTML(x.id)}"${x.id === sel ? ' selected' : ''}>${escapeHTML(x.name)}</option>`).join('');
  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} Trip</h1>
  <a href="/app/mileage" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="card grid" style="gap:1rem">
  <div class="grid grid-2">
    <label class="field">Trip Date<input name="trip_date" type="date" required value="${escapeHTML(r.trip_date || todayISO)}"></label>
    <label class="field">Vehicle<input name="vehicle" value="${escapeHTML(r.vehicle || '')}" placeholder="2024 Tesla Model Y"></label>
  </div>
  <label class="field">Purpose<input name="purpose" required value="${escapeHTML(r.purpose || '')}" placeholder="Client meeting · job site visit · supply pickup"></label>
  <div class="grid grid-2">
    <label class="field">From<input name="start_location" value="${escapeHTML(r.start_location || '')}" placeholder="Home"></label>
    <label class="field">To<input name="end_location" value="${escapeHTML(r.end_location || '')}" placeholder="Client office"></label>
  </div>
  <div class="grid grid-2">
    <label class="field">Miles<input name="miles" type="number" step="0.1" min="0" required inputmode="decimal" value="${r.miles || ''}"></label>
    <label class="field">Rate / mile<input name="rate_per_mile" type="number" step="0.001" min="0" inputmode="decimal" placeholder="Default ${defaultRate.toFixed(3)}" value="${r.rate_per_mile || ''}"></label>
  </div>
  <div class="grid grid-2">
    <label class="field">Project (optional)
      <select name="project_id"><option value="">— None —</option>${opts(projects, r.project_id || null)}</select>
    </label>
    <label class="field">Client (optional)
      <select name="client_id" id="clientSel"><option value="">— None —</option>${opts(clients, r.client_id || null)}</select>
    </label>
  </div>
  <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem">
    <input type="checkbox" name="is_billable" id="billable" ${r.is_billable ? 'checked' : ''} ${r.client_id ? '' : 'disabled'}>
    <span>Bill to client ${r.billed_invoice_id ? '<span class="badge badge-green">invoiced</span>' : ''}</span>
  </label>
  <label class="field">Notes<textarea name="notes" rows="2">${escapeHTML(r.notes || '')}</textarea></label>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    ${isEdit ? `<button type="button" id="del" class="btn btn-danger">Delete</button>` : ''}
    <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Log trip'}</button>
  </div>
</form>
<script>
const isEdit = ${isEdit ? 'true' : 'false'};
const id = ${isEdit ? JSON.stringify(r.id) : 'null'};
const clientSel = document.getElementById('clientSel');
const billable = document.getElementById('billable');
clientSel.addEventListener('change', () => {
  billable.disabled = !clientSel.value;
  if (!clientSel.value) billable.checked = false;
});
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const payload = {};
  for (const [k,v] of fd.entries()) {
    if (k === 'is_billable') payload[k] = 1;
    else if (k === 'miles' || k === 'rate_per_mile') payload[k] = v ? Number(v) : null;
    else payload[k] = v === '' ? null : v;
  }
  if (!('is_billable' in payload)) payload.is_billable = 0;
  const url = isEdit ? '/api/mileage/' + id : '/api/mileage';
  const method = isEdit ? 'PUT' : 'POST';
  try {
    await window.fetchJSON(url, { method, body: JSON.stringify(payload) });
    window.toast('Trip saved', 'ok');
    setTimeout(() => location.href = '/app/mileage', 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this trip?')) return;
  try { await window.fetchJSON('/api/mileage/' + id, { method: 'DELETE' });
    location.href = '/app/mileage';
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({ title: isEdit ? 'Edit Trip' : 'New Trip', activeNav: 'mileage', body, brand: 'BAP Cloud' });
}
