// Mobile expense-capture screen. Optimized for phones — single column form,
// large inputs, receipt upload via <input type="file" capture="environment">
// so iOS/Android open the camera directly.
//
// POSTs JSON to /api/expenses; receipt upload is multipart to /api/receipts.

import { shell, escapeHTML } from './shell';

export interface ExpenseCaptureOptions {
  today: string;
  vendors: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
}

export function expenseCapturePage(opts: ExpenseCaptureOptions): string {
  const optList = (xs: Array<{ id: string; name: string }>) =>
    xs.map(x => `<option value="${escapeHTML(x.id)}">${escapeHTML(x.name)}</option>`).join('');

  const body = `
<div class="page-header">
  <div>
    <h1 class="page-title">New Expense</h1>
    <div class="page-subtitle">Capture on the go — syncs to desktop automatically</div>
  </div>
  <a href="/app/dashboard" class="btn-ghost btn">Cancel</a>
</div>

<form id="expForm" class="card grid" style="gap:1rem">
  <div class="grid grid-2">
    <label class="field">Date<input name="date" type="date" required value="${escapeHTML(opts.today)}"></label>
    <label class="field">Amount<input name="amount" type="number" step="0.01" min="0" required inputmode="decimal" placeholder="0.00"></label>
  </div>
  <label class="field">Description<input name="description" required maxlength="200" placeholder="What was this for?"></label>
  <div class="grid grid-2">
    <label class="field">Vendor
      <select name="vendor_id"><option value="">— None —</option>${optList(opts.vendors)}</select>
    </label>
    <label class="field">Category
      <select name="category_id"><option value="">— None —</option>${optList(opts.categories)}</select>
    </label>
  </div>
  <div class="grid grid-2">
    <label class="field">Project
      <select name="project_id"><option value="">— None —</option>${optList(opts.projects)}</select>
    </label>
    <label class="field">Client
      <select name="client_id" id="clientSel"><option value="">— None —</option>${optList(opts.clients)}</select>
    </label>
  </div>
  <div class="grid grid-2">
    <label class="field">Payment Method
      <select name="payment_method">
        <option value="">—</option>
        <option value="credit_card">Credit Card</option>
        <option value="debit_card">Debit Card</option>
        <option value="cash">Cash</option>
        <option value="check">Check</option>
        <option value="bank_transfer">Bank Transfer</option>
        <option value="ach">ACH</option>
        <option value="paypal">PayPal</option>
        <option value="venmo">Venmo</option>
        <option value="zelle">Zelle</option>
      </select>
    </label>
    <label class="field">Reference / Invoice #<input name="reference" placeholder="Optional"></label>
  </div>
  <div class="grid grid-2">
    <label class="field">Tax Amount<input name="tax_amount" type="number" step="0.01" min="0" placeholder="0.00" inputmode="decimal"></label>
    <label class="field" style="justify-content:flex-end">
      <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-weight:500;color:var(--text);cursor:pointer">
        <input type="checkbox" id="billableChk" name="is_billable" disabled>
        Bill to client (pick a client first)
      </label>
    </label>
  </div>
  <label class="field">Notes<textarea name="notes" placeholder="Anything else worth recording"></textarea></label>

  <div>
    <div class="card-title">Receipt (optional)</div>
    <input id="receipt" type="file" accept="image/*,application/pdf" capture="environment"
      style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:10px;color:var(--text-bright);width:100%">
    <div class="muted" style="font-size:0.75rem;margin-top:6px">Photos use your camera on mobile. Uploads after the expense saves.</div>
  </div>

  <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
    <button type="button" class="btn btn-ghost" onclick="history.back()">Cancel</button>
    <button type="submit" class="btn">Save Expense</button>
  </div>
</form>
<script>
const f = document.getElementById('expForm');
const clientSel = document.getElementById('clientSel');
const billableChk = document.getElementById('billableChk');
clientSel.addEventListener('change', function(){
  billableChk.disabled = !clientSel.value;
  if (!clientSel.value) billableChk.checked = false;
});
f.addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(f);
  const payload = {};
  for (const [k, v] of fd.entries()){
    if (k === 'is_billable') payload[k] = 1;
    else payload[k] = v === '' ? null : v;
  }
  if (!('is_billable' in payload)) payload.is_billable = 0;
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const created = await window.fetchJSON('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
    // Upload receipt if attached
    const file = document.getElementById('receipt').files[0];
    if (file && created.id){
      const upload = new FormData();
      upload.append('file', file);
      const r = await fetch('/api/receipts/' + created.id, { method: 'POST', body: upload, credentials: 'same-origin' });
      if (!r.ok) window.toast('Saved, but receipt upload failed', 'err');
    }
    window.toast('Expense saved', 'ok');
    setTimeout(function(){ location.href = '/app/dashboard'; }, 600);
  } catch (err) {
    window.toast(err.message || 'Save failed', 'err');
    btn.disabled = false; btn.textContent = 'Save Expense';
  }
});
</script>`;
  return shell({ title: 'New Expense', activeNav: 'expenses', body, brand: 'BAP Cloud' });
}
