// Shared "classic" document styling — Arial, pure black & white, ruled
// tables and boxed sections. Every generate*HTML() form template composes
// these. Pure string builders, NO renderer imports, so they are unit-
// testable in isolation (scripts/test-classic-styles.cjs).
//
// Escaping contract: fields named `label`/`title`/plain text args ARE
// escaped here. Fields named `*Html` / `rows` cells are caller-supplied
// TRUSTED HTML and are NOT escaped — the caller must esc() any user text.

const CLASSIC_FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

export function esc(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function classicStyles(): string {
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter; margin: 0.5in 0.55in; }
  body { font-family: ${CLASSIC_FONT}; color: #000; background: #fff;
    font-size: 12px; line-height: 1.4;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc-frame { border: 2px solid #000; position: relative; }
  .doc-header { display: flex; border-bottom: 2px solid #000; }
  .doc-header .co { flex: 1; padding: 14px 16px; border-right: 2px solid #000; }
  .doc-header .co-name { font-size: 17px; font-weight: bold; letter-spacing: 0.5px; }
  .doc-logo { max-height: 48px; max-width: 220px; width: auto; height: auto;
    object-fit: contain; display: block; margin-bottom: 6px; filter: grayscale(1); }
  .doc-header .co-detail { font-size: 11px; margin-top: 5px; line-height: 1.5; }
  .doc-header .doc-meta { width: 230px; padding: 14px 16px; text-align: right; }
  .doc-title { font-size: 27px; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; }
  .doc-number { font-size: 12px; margin-top: 6px; }
  .meta-strip { width: 100%; border-collapse: collapse; border-bottom: 2px solid #000;
    font-size: 11px; text-align: center; }
  .meta-strip td { border-right: 1px solid #000; padding: 7px 6px; }
  .meta-strip td:last-child { border-right: none; }
  .meta-strip .ml { font-weight: bold; letter-spacing: 1px; font-size: 10px; text-transform: uppercase; }
  .meta-strip .mv { margin-top: 3px; }
  .box-row { display: flex; border-bottom: 2px solid #000; }
  .box-row .box { flex: 1; padding: 10px 16px; border-right: 1px solid #000; }
  .box-row .box:last-child { border-right: none; }
  .sec-label { font-size: 10px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; }
  table.ruled { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.ruled th { background: #000; color: #fff; border: 1px solid #000; padding: 7px 8px;
    text-align: left; letter-spacing: 0.5px; text-transform: uppercase; font-size: 10px; }
  table.ruled td { border: 1px solid #000; padding: 7px 8px; }
  table.ruled td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.ruled td.ctr { text-align: center; }
  .totals { border-collapse: collapse; font-size: 12px; width: 262px; }
  .totals td { padding: 6px 12px; text-align: right; border-bottom: 1px solid #000; }
  .totals td.val { border-left: 1px solid #000; font-variant-numeric: tabular-nums; width: 96px; }
  .totals tr.grand td { background: #000; color: #fff; font-weight: bold; letter-spacing: 1px;
    padding: 9px 12px; border-bottom: none; }
  .totals tr.grand td.val { border-left: 1px solid #fff; }
  .footer-bar { border-top: 2px solid #000; padding: 8px 16px; font-size: 10px;
    text-align: center; letter-spacing: 0.3px; }
  .draft-wm { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg);
    font-size: 90px; font-weight: bold; color: rgba(0,0,0,0.07); letter-spacing: 12px;
    pointer-events: none; z-index: 0; }
  @media print { .no-break { page-break-inside: avoid; }
    table.ruled { page-break-inside: auto; } tr { page-break-inside: avoid; } }
  `;
}

export interface MetaCell { label: string; value: string; }
export function metaStrip(cells: MetaCell[]): string {
  return `<table class="meta-strip"><tr>${cells.map(c =>
    `<td><div class="ml">${esc(c.label)}</div><div class="mv">${esc(c.value)}</div></td>`).join('')}</tr></table>`;
}

export interface DocBox { label: string; html: string; }
export function boxRow(boxes: DocBox[]): string {
  return `<div class="box-row">${boxes.map(b =>
    `<div class="box"><div class="sec-label">${esc(b.label)}</div>` +
    `<div style="margin-top:5px;">${b.html}</div></div>`).join('')}</div>`;
}

// `number` is plain text (escaped). `numberHtml` is TRUSTED HTML for multi-line
// number/status blocks (e.g. "No. 42 [SENT]<br>Re: Invoice #7") — caller must
// esc() any user text inside it. If both are given, numberHtml wins.
export interface DocHeaderOpts { coName: string; coDetailHtml: string; title: string; number?: string; numberHtml?: string; }
export function docHeader(o: DocHeaderOpts): string {
  const numberBlock = o.numberHtml
    ? `<div class="doc-number">${o.numberHtml}</div>`
    : (o.number ? `<div class="doc-number">${esc(o.number)}</div>` : '');
  return `<div class="doc-header">` +
    `<div class="co"><div class="co-name">${esc(o.coName)}</div>` +
    `<div class="co-detail">${o.coDetailHtml}</div></div>` +
    `<div class="doc-meta"><div class="doc-title">${esc(o.title)}</div>` +
    `${numberBlock}</div></div>`;
}

export interface RuledColumn { label: string; align?: 'left' | 'right' | 'center'; width?: string; }
export function ruledTable(columns: RuledColumn[], rows: string[][]): string {
  const cls = (a?: string) => a === 'right' ? ' class="num"' : a === 'center' ? ' class="ctr"' : '';
  const head = `<tr>${columns.map(c =>
    `<th${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr>${r.map((cell, i) =>
    `<td${cls(columns[i]?.align)}>${cell}</td>`).join('')}</tr>`).join('');
  return `<table class="ruled"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export interface TotalRow { label: string; value: string; grand?: boolean; }
export function totalsBox(rows: TotalRow[]): string {
  return `<table class="totals">${rows.map(r =>
    `<tr${r.grand ? ' class="grand"' : ''}><td>${esc(r.label)}</td>` +
    `<td class="val">${esc(r.value)}</td></tr>`).join('')}</table>`;
}

export function docFrame(inner: string, opts?: { draft?: boolean }): string {
  return `<div class="doc-frame">${opts?.draft ? '<div class="draft-wm">DRAFT</div>' : ''}${inner}</div>`;
}

export function footerBar(text: string): string {
  return `<div class="footer-bar">${esc(text)}</div>`;
}

// Renders a company logo <img> (grayscale, classic) from a data: or https: URL,
// or '' if missing/unsafe. Centralizes logo treatment across all forms so the
// "pure B&W, logo grayscale" decision is enforced in one place.
export function logoImg(logoData: string | null | undefined, alt = ''): string {
  const safe = logoData && /^(data:|https?:)/.test(String(logoData)) ? logoData : null;
  return safe ? `<img class="doc-logo" src="${esc(safe)}" alt="${esc(alt)}">` : '';
}

export function classicDocument(o: { title: string; bodyHtml: string; extraHead?: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title>` +
    `${o.extraHead || ''}<style>${classicStyles()}</style></head><body>${o.bodyHtml}</body></html>`;
}
