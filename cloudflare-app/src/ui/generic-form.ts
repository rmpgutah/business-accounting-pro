// Generic key/value CRUD form. Cuts ~500 lines of boilerplate across the
// simple-shape modules (inventory items, fixed assets, loans, budgets,
// recurring templates, accounts, debts, categories). Each module declares
// its fields once and the renderer + submit handler are shared.
//
// For anything with line items (invoices, bills, quotes, POs) use
// document-form.ts instead — this helper handles single-table records only.

import { shell, escapeHTML } from './shell';

export type FieldKind = 'text' | 'email' | 'tel' | 'url' | 'date' | 'number' | 'textarea' | 'select' | 'checkbox';

export interface SimpleField {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  step?: string;            // for number inputs
  min?: string;
  max?: string;
  inputmode?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;  // for select
  // Optional layout hint — fields with the same column index sit side-by-side
  // in a grid-2 / grid-3 row depending on how many siblings they have.
  rowGroup?: number;
  // Optional fetch coercer: 'number' converts the value to Number on submit,
  // 'checkbox' converts on/off to 1/0, 'nullify' converts '' to null.
  coerce?: 'number' | 'integer' | 'checkbox' | 'nullify';
}

export interface SimpleFormConfig {
  entitySingular: string;   // "Inventory item"
  entityPlural: string;     // "Inventory items"
  apiPath: string;          // "/api/inventory"
  navKey: string;           // "inventory"
  listPath: string;         // "/app/inventory"
  fields: SimpleField[];
  // Optional intro shown above the form
  intro?: string;
}

export function simpleFormPage(row: Record<string, any> | null, cfg: SimpleFormConfig): string {
  const isEdit = !!row?.id;
  const r = row || {};

  // Group fields by rowGroup index so same-row fields share a grid row.
  const groups = new Map<number, SimpleField[]>();
  cfg.fields.forEach((f, i) => {
    const g = f.rowGroup ?? i;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  });

  const renderField = (f: SimpleField): string => {
    const val = r[f.name];
    const safe = (s: any) => escapeHTML(String(s ?? ''));
    const common = `name="${f.name}"${f.required ? ' required' : ''}${f.placeholder ? ` placeholder="${safe(f.placeholder)}"` : ''}`;
    let input = '';
    switch (f.kind) {
      case 'textarea':
        input = `<textarea ${common} rows="3">${safe(val)}</textarea>`;
        break;
      case 'select':
        input = `<select ${common}>${(f.options || []).map(o =>
          `<option value="${safe(o.value)}"${String(val ?? '') === o.value ? ' selected' : ''}>${safe(o.label)}</option>`).join('')}</select>`;
        break;
      case 'checkbox':
        input = `<label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-weight:500;color:var(--text);cursor:pointer;padding:10px 0">
          <input type="checkbox" ${common} ${val ? 'checked' : ''}>${safe(f.label)}
        </label>`;
        return `<div class="field-checkbox">${input}</div>`;
      case 'number':
        input = `<input type="number" ${common}${f.step ? ` step="${f.step}"` : ' step="0.01"'}${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}${f.inputmode ? ` inputmode="${f.inputmode}"` : ' inputmode="decimal"'} value="${safe(val)}">`;
        break;
      default:
        input = `<input type="${f.kind}" ${common} value="${safe(val)}">`;
    }
    // Checkbox returns early from its case above; everything else gets a
    // standard <label class="field"> wrapper for layout.
    return `<label class="field">${safe(f.label)}${input}</label>`;
  };

  const rowsHTML = Array.from(groups.values()).map(siblings => {
    if (siblings.length === 1) return renderField(siblings[0]);
    const cls = siblings.length === 2 ? 'grid grid-2' : siblings.length === 3 ? 'grid grid-3' : 'grid grid-2';
    return `<div class="${cls}" style="gap:1rem">${siblings.map(renderField).join('')}</div>`;
  }).join('');

  const body = `
<div class="page-header">
  <h1 class="page-title">${isEdit ? 'Edit' : 'New'} ${escapeHTML(cfg.entitySingular)}</h1>
  <a href="${escapeHTML(cfg.listPath)}" class="btn btn-ghost">Back</a>
</div>
${cfg.intro ? `<div class="card" style="margin-bottom:1rem;font-size:0.85rem;color:var(--text-dim)">${cfg.intro}</div>` : ''}
<form id="f" class="card grid" style="gap:1rem">
  ${rowsHTML}
  <div style="display:flex;gap:8px;justify-content:flex-end">
    ${isEdit ? `<button type="button" id="del" class="btn btn-danger">Delete</button>` : ''}
    <button type="submit" class="btn">${isEdit ? 'Save changes' : 'Create ' + escapeHTML(cfg.entitySingular.toLowerCase())}</button>
  </div>
</form>
<script>
const isEdit = ${isEdit ? 'true' : 'false'};
const id = ${isEdit ? JSON.stringify(r.id) : 'null'};
const API = ${JSON.stringify(cfg.apiPath)};
const LIST = ${JSON.stringify(cfg.listPath)};
// Per-field coercion table — applied to the FormData before sending.
const COERCE = ${JSON.stringify(Object.fromEntries(cfg.fields.filter(f => f.coerce).map(f => [f.name, f.coerce])))};
const CHECKBOX_FIELDS = ${JSON.stringify(cfg.fields.filter(f => f.kind === 'checkbox').map(f => f.name))};
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const payload = {};
  // Checkbox fields only appear in FormData when checked — seed them 0 first.
  for (const k of CHECKBOX_FIELDS) payload[k] = 0;
  for (const [k, v] of fd.entries()) {
    const c = COERCE[k];
    if (c === 'number') payload[k] = v === '' ? null : Number(v);
    else if (c === 'integer') payload[k] = v === '' ? null : parseInt(String(v), 10);
    else if (c === 'checkbox') payload[k] = 1;
    else if (c === 'nullify') payload[k] = v === '' ? null : v;
    else payload[k] = v === '' ? null : v;
  }
  try {
    await window.fetchJSON(isEdit ? API + '/' + id : API, {
      method: isEdit ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    window.toast(${JSON.stringify(cfg.entitySingular)} + ' saved', 'ok');
    setTimeout(() => location.href = LIST, 500);
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
const del = document.getElementById('del');
if (del) del.addEventListener('click', async function(){
  if (!confirm('Delete this ' + ${JSON.stringify(cfg.entitySingular.toLowerCase())} + '?')) return;
  try { await window.fetchJSON(API + '/' + id, { method: 'DELETE' });
    location.href = LIST;
  } catch (e) { window.toast(e.message || 'Delete failed', 'err'); }
});
</script>`;
  return shell({
    title: (isEdit ? 'Edit ' : 'New ') + cfg.entitySingular,
    activeNav: cfg.navKey,
    body,
    brand: 'BAP Cloud',
  });
}
