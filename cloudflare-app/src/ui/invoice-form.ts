// New/edit an invoice with dynamic line items. Totals reconcile live in the
// browser; the server is authoritative on save (recomputes from line items
// so a tampered DOM can't ship a bogus total).
//
// XSS posture: the dynamic line-row factory uses document.createElement /
// textContent — NOT innerHTML — so there's no template-injection surface
// even if a future change pulls user input into the row builder.

import { shell, escapeHTML } from './shell';

export interface InvoiceLine {
  id?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  tax_rate?: number;
}
export interface InvoiceRow {
  id?: string;
  client_id?: string;
  invoice_number?: string;
  date?: string;
  due_date?: string;
  status?: string;
  notes?: string;
  terms?: string;
  currency?: string;
  shipping_amount?: number;
  discount?: number;
  amount_paid?: number;
}

export function invoiceFormPage(
  row: InvoiceRow | null,
  lines: InvoiceLine[],
  clients: Array<{ id: string; name: string }>,
  todayISO: string,
): string {
  const isEdit = !!row?.id;
  const r = row || {};
  const initialLines = lines.length > 0
    ? lines
    : [{ description: '', quantity: 1, unit_price: 0, tax_rate: 0 }];
  const clientOpts = clients.map(c =>
    `<option value="${escapeHTML(c.id)}"${c.id === r.client_id ? ' selected' : ''}>${escapeHTML(c.name)}</option>`
  ).join('');

  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} Invoice</h1>
  <a href="/app/invoices" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="grid" style="gap:1rem">
  <div class="card grid grid-2" style="gap:1rem">
    <label class="field">Client
      <select name="client_id" required><option value="">— Choose client —</option>${clientOpts}</select>
    </label>
    <label class="field">Invoice #<input name="invoice_number" value="${escapeHTML(r.invoice_number || '')}" placeholder="INV-001"></label>
    <label class="field">Date<input name="date" type="date" required value="${escapeHTML(r.date || todayISO)}"></label>
    <label class="field">Due Date<input name="due_date" type="date" value="${escapeHTML(r.due_date || '')}"></label>
    <label class="field">Status
      <select name="status">
        ${['draft','sent','paid','overdue','partial','void'].map(s =>
          `<option value="${s}"${(r.status || 'draft') === s ? ' selected' : ''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
      </select>
    </label>
    <label class="field">Currency<input name="currency" value="${escapeHTML(r.currency || 'USD')}" maxlength="4"></label>
  </div>

  <div class="card">
    <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>Line Items</span>
      <button type="button" id="addLine" class="btn btn-ghost" style="padding:6px 12px;font-size:0.75rem">+ Add Line</button>
    </div>
    <table class="data" id="lines">
      <thead><tr>
        <th style="width:50%">Description</th>
        <th class="num" style="width:80px">Qty</th>
        <th class="num" style="width:110px">Unit Price</th>
        <th class="num" style="width:80px">Tax %</th>
        <th class="num" style="width:110px">Amount</th>
        <th style="width:40px"></th>
      </tr></thead>
      <tbody>
        ${initialLines.map(l => lineRow(l)).join('')}
      </tbody>
    </table>
  </div>

  <div class="card grid grid-2" style="gap:1rem">
    <label class="field">Shipping<input name="shipping_amount" type="number" step="0.01" min="0" inputmode="decimal" value="${r.shipping_amount || ''}"></label>
    <label class="field">Discount (flat $)<input name="discount" type="number" step="0.01" min="0" inputmode="decimal" value="${r.discount || ''}"></label>
    <label class="field" style="grid-column:span 2">Terms<textarea name="terms" rows="2">${escapeHTML(r.terms || '')}</textarea></label>
    <label class="field" style="grid-column:span 2">Notes<textarea name="notes" rows="3">${escapeHTML(r.notes || '')}</textarea></label>
  </div>

  <div class="card" style="display:grid;grid-template-columns:1fr auto;gap:1rem;align-items:end">
    <div id="totals" style="font-family:'SF Mono',Menlo,monospace;color:var(--text-dim);font-size:0.85rem;display:flex;flex-direction:column;gap:4px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      ${isEdit ? `<button type="button" id="del" class="btn btn-danger">Delete</button>` : ''}
      <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Create invoice'}</button>
    </div>
  </div>
</form>
<script>
const isEdit = ${isEdit ? 'true' : 'false'};
const id = ${isEdit ? JSON.stringify(r.id) : 'null'};

// Build a new <tr> for a blank line. Uses createElement + textContent — NOT
// innerHTML — so there's no XSS surface even if user-supplied defaults are
// piped through here later.
function buildLineRow() {
  const tr = document.createElement('tr');
  const cellInput = (name, val, isNum) => {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.className = 'lf' + (isNum ? ' num' : '');
    inp.name = name;
    if (isNum) {
      inp.type = 'number';
      inp.step = '0.01';
      inp.min = '0';
      inp.style.textAlign = 'right';
    }
    inp.value = String(val);
    inp.style.width = '100%';
    inp.style.background = 'transparent';
    inp.style.border = '1px solid var(--border)';
    inp.style.borderRadius = '2px';
    inp.style.padding = '6px';
    inp.style.color = 'var(--text-bright)';
    td.appendChild(inp);
    return td;
  };
  tr.appendChild(cellInput('li_description', '', false));
  tr.appendChild(cellInput('li_quantity', 1, true));
  tr.appendChild(cellInput('li_unit_price', 0, true));
  tr.appendChild(cellInput('li_tax_rate', 0, true));
  const tdAmt = document.createElement('td');
  tdAmt.className = 'num lineAmount';
  tdAmt.textContent = '$0.00';
  tr.appendChild(tdAmt);
  const tdRm = document.createElement('td');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rmRow';
  btn.textContent = '×';
  btn.style.background = 'none';
  btn.style.border = 'none';
  btn.style.color = 'var(--red)';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '1.1rem';
  tdRm.appendChild(btn);
  tr.appendChild(tdRm);
  return tr;
}

function addBlankLine() {
  const tr = buildLineRow();
  document.querySelector('#lines tbody').appendChild(tr);
  wireRow(tr);
  recalc();
}

function wireRow(tr) {
  tr.querySelectorAll('input.lf').forEach(i => i.addEventListener('input', recalc));
  const rm = tr.querySelector('.rmRow');
  if (rm) rm.addEventListener('click', () => {
    if (document.querySelectorAll('#lines tbody tr').length <= 1) {
      window.toast('At least one line item is required', 'err');
      return;
    }
    tr.remove();
    recalc();
  });
}
document.querySelectorAll('#lines tbody tr').forEach(wireRow);
document.getElementById('addLine').addEventListener('click', addBlankLine);

// Recompute per-line and grand totals. Mirrors the server's logic on save.
// Uses textContent + appendChild — no innerHTML — to dodge XSS even if some
// future row contains user-supplied strings.
function recalc() {
  let subtotal = 0, tax = 0;
  document.querySelectorAll('#lines tbody tr').forEach(tr => {
    const qty  = Number(tr.querySelector('[name=li_quantity]').value) || 0;
    const unit = Number(tr.querySelector('[name=li_unit_price]').value) || 0;
    const rate = Number(tr.querySelector('[name=li_tax_rate]').value) || 0;
    const amt = qty * unit;
    const taxA = amt * (rate / 100);
    tr.querySelector('.lineAmount').textContent = '$' + amt.toFixed(2);
    subtotal += amt;
    tax += taxA;
  });
  const ship = Number(document.querySelector('[name=shipping_amount]').value) || 0;
  const disc = Number(document.querySelector('[name=discount]').value) || 0;
  const total = Math.max(0, subtotal + tax + ship - disc);
  const totEl = document.getElementById('totals');
  while (totEl.firstChild) totEl.removeChild(totEl.firstChild);
  const addRow = (label, val, bright) => {
    const d = document.createElement('div');
    d.textContent = label + ': $' + val.toFixed(2);
    if (bright) {
      d.style.color = 'var(--text-bright)';
      d.style.fontSize = '1.05rem';
      d.style.fontWeight = '700';
    }
    totEl.appendChild(d);
  };
  addRow('Subtotal', subtotal, false);
  if (tax > 0) addRow('Tax', tax, false);
  if (ship > 0) addRow('Shipping', ship, false);
  if (disc > 0) {
    const d = document.createElement('div');
    d.textContent = 'Discount: −$' + disc.toFixed(2);
    totEl.appendChild(d);
  }
  addRow('Total', total, true);
}
document.querySelectorAll('[name=shipping_amount],[name=discount]').forEach(i => i.addEventListener('input', recalc));
recalc();

document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const headerFields = ['client_id','invoice_number','date','due_date','status','currency','shipping_amount','discount','terms','notes'];
  const header = {};
  headerFields.forEach(k => {
    const v = fd.get(k);
    if (k === 'shipping_amount' || k === 'discount') header[k] = v ? Number(v) : 0;
    else header[k] = v || null;
  });
  // Walk row-by-row; DOM order is the authoritative line ordering.
  const lines = [];
  document.querySelectorAll('#lines tbody tr').forEach(tr => {
    lines.push({
      description: tr.querySelector('[name=li_description]').value,
      quantity:    Number(tr.querySelector('[name=li_quantity]').value)   || 0,
      unit_price:  Number(tr.querySelector('[name=li_unit_price]').value) || 0,
      tax_rate:    Number(tr.querySelector('[name=li_tax_rate]').value)   || 0,
    });
  });
  const payload = Object.assign({}, header, { lines });
  const url = isEdit ? '/api/invoices/' + id : '/api/invoices';
  const method = isEdit ? 'PUT' : 'POST';
  try {
    await window.fetchJSON(url, { method, body: JSON.stringify(payload) });
    window.toast('Invoice saved', 'ok');
    setTimeout(() => location.href = '/app/invoices', 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this invoice? Recorded payments stay; the invoice itself is removed.')) return;
  try { await window.fetchJSON('/api/invoices/' + id, { method: 'DELETE' });
    location.href = '/app/invoices';
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({ title: isEdit ? 'Edit Invoice' : 'New Invoice', activeNav: 'invoices', body, brand: 'BAP Cloud' });
}

function lineRow(l: InvoiceLine): string {
  const inp = (name: string, val: string | number | undefined, num = false) =>
    `<input class="lf${num ? ' num' : ''}" name="${name}"${num ? ' type="number" step="0.01" min="0"' : ''} value="${escapeHTML(String(val ?? ''))}" style="width:100%;background:transparent;border:1px solid var(--border);border-radius:2px;padding:6px;color:var(--text-bright);${num ? 'text-align:right' : ''}">`;
  return `<tr>
    <td>${inp('li_description', l.description)}</td>
    <td>${inp('li_quantity', l.quantity ?? 1, true)}</td>
    <td>${inp('li_unit_price', l.unit_price ?? 0, true)}</td>
    <td>${inp('li_tax_rate', l.tax_rate ?? 0, true)}</td>
    <td class="num lineAmount">$0.00</td>
    <td><button type="button" class="rmRow" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1.1rem">×</button></td>
  </tr>`;
}
