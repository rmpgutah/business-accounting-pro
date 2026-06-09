// Generic "money document with line items" form. Used by both Bills (AP)
// and Quotes (outbound proposals), and conceptually mirrors invoice-form.ts
// — but parameterized over the entity name + party (vendor for bills,
// client for quotes) so we don't fork the same 250 lines twice.
//
// All math (subtotal/tax/total) reconciles live in the browser AND is
// recomputed server-side on save, so a tampered DOM can never store
// a fake total.

import { shell, escapeHTML } from './shell';

export interface DocumentLine {
  id?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  tax_rate?: number;
}
export interface DocumentRow {
  id?: string;
  client_id?: string;
  vendor_id?: string;
  // Doc-specific identifier — quote_number for quotes, bill_number for bills
  number?: string;
  date?: string;
  due_date?: string;
  expires_date?: string;
  status?: string;
  notes?: string;
  terms?: string;
  currency?: string;
  shipping_amount?: number;
  discount?: number;
  reference?: string;
}

export interface DocFormConfig {
  // Used in URLs + headings ("bill", "quote")
  kind: 'bill' | 'quote';
  // "Bills (AP)" vs "Quotes"
  pluralLabel: string;
  // Sidebar nav key
  navKey: string;
  // Which party the doc references
  partyLabel: 'Vendor' | 'Client';
  partyField: 'vendor_id' | 'client_id';
  parties: Array<{ id: string; name: string }>;
  // Status options for the dropdown — first one is the default
  statusOptions: string[];
  // Number-field label ("Bill #", "Quote #")
  numberLabel: string;
  // Whether the doc has a due_date (bills) or expires_date (quotes)
  secondaryDateLabel: string;
  secondaryDateField: 'due_date' | 'expires_date';
}

export function documentFormPage(
  row: DocumentRow | null,
  lines: DocumentLine[],
  cfg: DocFormConfig,
  todayISO: string,
): string {
  const isEdit = !!row?.id;
  const r = row || {};
  const initialLines = lines.length > 0
    ? lines
    : [{ description: '', quantity: 1, unit_price: 0, tax_rate: 0 }];
  const partyVal = cfg.partyField === 'vendor_id' ? r.vendor_id : r.client_id;
  const partyOpts = cfg.parties.map(p =>
    `<option value="${escapeHTML(p.id)}"${p.id === partyVal ? ' selected' : ''}>${escapeHTML(p.name)}</option>`
  ).join('');
  const secondaryDateVal = cfg.secondaryDateField === 'due_date' ? r.due_date : r.expires_date;

  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} ${cfg.kind === 'bill' ? 'Bill' : 'Quote'}</h1>
  <a href="/app/${cfg.navKey}" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="grid" style="gap:1rem">
  <div class="card grid grid-2" style="gap:1rem">
    <label class="field">${cfg.partyLabel}
      <select name="party_id" required><option value="">— Choose ${cfg.partyLabel.toLowerCase()} —</option>${partyOpts}</select>
    </label>
    <label class="field">${cfg.numberLabel}<input name="number" value="${escapeHTML(r.number || '')}" placeholder="${cfg.kind === 'bill' ? 'V-INV-001' : 'Q-001'}"></label>
    <label class="field">Date<input name="date" type="date" required value="${escapeHTML(r.date || todayISO)}"></label>
    <label class="field">${cfg.secondaryDateLabel}<input name="secondary_date" type="date" value="${escapeHTML(secondaryDateVal || '')}"></label>
    <label class="field">Status
      <select name="status">
        ${cfg.statusOptions.map((s, i) =>
          `<option value="${s}"${(r.status || cfg.statusOptions[0]) === s ? ' selected' : ''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
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
      <tbody>${initialLines.map(l => lineRowHTML(l)).join('')}</tbody>
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
      <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Create ' + cfg.kind}</button>
    </div>
  </div>
</form>
<script>
const isEdit = ${isEdit ? 'true' : 'false'};
const id = ${isEdit ? JSON.stringify(r.id) : 'null'};
const KIND = ${JSON.stringify(cfg.kind)};
const NAV = ${JSON.stringify(cfg.navKey)};
const PARTY_FIELD = ${JSON.stringify(cfg.partyField)};
const SECONDARY_DATE_FIELD = ${JSON.stringify(cfg.secondaryDateField)};
const NUMBER_FIELD = ${JSON.stringify(cfg.kind === 'bill' ? 'bill_number' : 'quote_number')};

function buildLineRow() {
  const tr = document.createElement('tr');
  const cellInput = (name, val, isNum) => {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.className = 'lf' + (isNum ? ' num' : '');
    inp.name = name;
    if (isNum) { inp.type = 'number'; inp.step = '0.01'; inp.min = '0'; inp.style.textAlign = 'right'; }
    inp.value = String(val);
    inp.style.cssText = 'width:100%;background:transparent;border:1px solid var(--border);border-radius:var(--radius);padding:6px;color:var(--text-bright);' + (isNum ? 'text-align:right' : '');
    td.appendChild(inp);
    return td;
  };
  tr.appendChild(cellInput('li_description', '', false));
  tr.appendChild(cellInput('li_quantity', 1, true));
  tr.appendChild(cellInput('li_unit_price', 0, true));
  tr.appendChild(cellInput('li_tax_rate', 0, true));
  const tdAmt = document.createElement('td');
  tdAmt.className = 'num lineAmount'; tdAmt.textContent = '$0.00';
  tr.appendChild(tdAmt);
  const tdRm = document.createElement('td');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'rmRow'; btn.textContent = '×';
  btn.style.cssText = 'background:none;border:none;color:var(--red);cursor:pointer;font-size:1.1rem';
  tdRm.appendChild(btn);
  tr.appendChild(tdRm);
  return tr;
}

function wireRow(tr) {
  tr.querySelectorAll('input.lf').forEach(i => i.addEventListener('input', recalc));
  const rm = tr.querySelector('.rmRow');
  if (rm) rm.addEventListener('click', () => {
    if (document.querySelectorAll('#lines tbody tr').length <= 1) {
      window.toast('At least one line item is required', 'err'); return;
    }
    tr.remove(); recalc();
  });
}
document.querySelectorAll('#lines tbody tr').forEach(wireRow);
document.getElementById('addLine').addEventListener('click', () => {
  const tr = buildLineRow();
  document.querySelector('#lines tbody').appendChild(tr);
  wireRow(tr); recalc();
});

function recalc() {
  let subtotal = 0, tax = 0;
  document.querySelectorAll('#lines tbody tr').forEach(tr => {
    const qty = Number(tr.querySelector('[name=li_quantity]').value) || 0;
    const unit = Number(tr.querySelector('[name=li_unit_price]').value) || 0;
    const rate = Number(tr.querySelector('[name=li_tax_rate]').value) || 0;
    const amt = qty * unit;
    tr.querySelector('.lineAmount').textContent = '$' + amt.toFixed(2);
    subtotal += amt; tax += amt * (rate / 100);
  });
  const ship = Number(document.querySelector('[name=shipping_amount]').value) || 0;
  const disc = Number(document.querySelector('[name=discount]').value) || 0;
  const total = Math.max(0, subtotal + tax + ship - disc);
  const totEl = document.getElementById('totals');
  while (totEl.firstChild) totEl.removeChild(totEl.firstChild);
  const addRow = (label, val, bright) => {
    const d = document.createElement('div');
    d.textContent = label + ': $' + val.toFixed(2);
    if (bright) { d.style.color = 'var(--text-bright)'; d.style.fontSize = '1.05rem'; d.style.fontWeight = '700'; }
    totEl.appendChild(d);
  };
  addRow('Subtotal', subtotal, false);
  if (tax > 0) addRow('Tax', tax, false);
  if (ship > 0) addRow('Shipping', ship, false);
  if (disc > 0) {
    const d = document.createElement('div'); d.textContent = 'Discount: −$' + disc.toFixed(2);
    totEl.appendChild(d);
  }
  addRow('Total', total, true);
}
document.querySelectorAll('[name=shipping_amount],[name=discount]').forEach(i => i.addEventListener('input', recalc));
recalc();

document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const header = {};
  header[PARTY_FIELD] = fd.get('party_id') || null;
  header[NUMBER_FIELD] = fd.get('number') || null;
  header.date = fd.get('date');
  header[SECONDARY_DATE_FIELD] = fd.get('secondary_date') || null;
  header.status = fd.get('status') || null;
  header.currency = fd.get('currency') || 'USD';
  header.shipping_amount = Number(fd.get('shipping_amount')) || 0;
  header.discount = Number(fd.get('discount')) || 0;
  header.notes = fd.get('notes') || null;
  header.terms = fd.get('terms') || null;
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
  const url = isEdit ? '/api/' + KIND + 's/' + id : '/api/' + KIND + 's';
  try {
    await window.fetchJSON(url, { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    window.toast((KIND === 'bill' ? 'Bill' : 'Quote') + ' saved', 'ok');
    setTimeout(() => location.href = '/app/' + NAV, 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this ' + KIND + '?')) return;
  try { await window.fetchJSON('/api/' + KIND + 's/' + id, { method: 'DELETE' });
    location.href = '/app/' + NAV;
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({ title: (isEdit ? 'Edit ' : 'New ') + (cfg.kind === 'bill' ? 'Bill' : 'Quote'), activeNav: cfg.navKey, body, brand: 'BAP Cloud' });
}

function lineRowHTML(l: DocumentLine): string {
  const inp = (name: string, val: string | number | undefined, num = false) =>
    `<input class="lf${num ? ' num' : ''}" name="${name}"${num ? ' type="number" step="0.01" min="0"' : ''} value="${escapeHTML(String(val ?? ''))}" style="width:100%;background:transparent;border:1px solid var(--border);border-radius:var(--radius);padding:6px;color:var(--text-bright);${num ? 'text-align:right' : ''}">`;
  return `<tr>
    <td>${inp('li_description', l.description)}</td>
    <td>${inp('li_quantity', l.quantity ?? 1, true)}</td>
    <td>${inp('li_unit_price', l.unit_price ?? 0, true)}</td>
    <td>${inp('li_tax_rate', l.tax_rate ?? 0, true)}</td>
    <td class="num lineAmount">$0.00</td>
    <td><button type="button" class="rmRow" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1.1rem">×</button></td>
  </tr>`;
}
