/**
 * PDF Invoice Generator
 * Uses Electron's webContents.printToPDF() with an HTML template.
 * No external dependencies required.
 */
// BrowserWindow is no longer needed directly — rendering now goes through
// the shared helper in print-preview.ts.
import { formatStatusLabel } from '../../shared/utils';

// ─── HTML escape helper (XSS prevention) ────────────────
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Currency Formatter ──────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

// Classic styles mirrored from src/renderer/lib/classic-styles.ts (main process can't import renderer module).
const CLASSIC_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: letter; margin: 0.5in 0.55in; }
body { font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; color: #000; background: #fff;
  font-size: 12px; line-height: 1.4;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc-frame { border: 2px solid #000; position: relative; }
.doc-header { display: flex; border-bottom: 2px solid #000; }
.doc-header .co { flex: 1; padding: 14px 16px; border-right: 2px solid #000; }
.doc-header .co-name { font-size: 17px; font-weight: bold; letter-spacing: 0.5px; }
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
.totals-tbl { border-collapse: collapse; font-size: 12px; width: 262px; }
.totals-tbl td { padding: 6px 12px; text-align: right; border-bottom: 1px solid #000; }
.totals-tbl td.val { border-left: 1px solid #000; font-variant-numeric: tabular-nums; width: 96px; }
.totals-tbl tr.grand td { background: #000; color: #fff; font-weight: bold; letter-spacing: 1px;
  padding: 9px 12px; border-bottom: none; }
.totals-tbl tr.grand td.val { border-left: 1px solid #fff; }
.footer-bar { border-top: 2px solid #000; padding: 8px 16px; font-size: 10px;
  text-align: center; letter-spacing: 0.3px; }
.draft-wm { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg);
  font-size: 90px; font-weight: bold; color: rgba(0,0,0,0.07); letter-spacing: 12px;
  pointer-events: none; z-index: 0; }
@media print { .no-break { page-break-inside: avoid; }
  table.ruled { page-break-inside: auto; } tr { page-break-inside: avoid; } }
`;

// ─── HTML Template Builder ───────────────────────────────
export function buildInvoiceHTML(
  company: any,
  client: any,
  invoice: any,
  lineItems: any[]
): string {
  const companyName = esc(company?.name || 'Company');
  const companyLegal = esc(company?.legal_name || '');
  const companyAddr = esc([company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip]
    .filter(Boolean)
    .join(', '));
  const companyEmail = esc(company?.email || '');
  const companyPhone = esc(company?.phone || '');
  const companyWebsite = esc(company?.website || '');

  const clientName = esc(client?.name || 'Client');
  const clientEmail = esc(client?.email || '');
  const clientPhone = esc(client?.phone || '');
  const clientAddr = esc([client?.address_line1, client?.address_line2, client?.city, client?.state, client?.zip]
    .filter(Boolean)
    .join(', '));

  const isDraft = invoice.status === 'draft';
  const statusLabel = esc(formatStatusLabel(invoice.status || 'draft').toUpperCase());

  // ── Line rows (math unchanged: per-line tax_rate_override respected) ──
  const lineRows = (lineItems || []).map((l: any) => {
    const qty = Number(l.quantity) || 1;
    const rate = Number(l.unit_price) || 0;
    // MATH: respect per-line tax_rate_override when set, matching how
    // InvoiceForm/print-templates compute tax. Otherwise tax shown here
    // and tax shown in the totals box would diverge for overridden rates.
    const overrideRate = Number(l.tax_rate_override ?? -1);
    const taxRate = overrideRate >= 0 ? overrideRate : (Number(l.tax_rate) || 0);
    // l.amount is persisted as qty*unit_price*(1 - discount_pct/100) and
    // already rounded. Fall back to qty*rate for not-yet-saved invoices.
    const lineSubtotal = Number(l.amount) || (qty * rate);
    const lineTax = Math.round(lineSubtotal * (taxRate / 100) * 100) / 100;
    const lineTotalWithTax = lineSubtotal + lineTax;
    return `<tr>` +
      `<td>${esc(l.description || '')}</td>` +
      `<td class="num">${qty}</td>` +
      `<td class="num">${fmt(rate)}</td>` +
      `<td class="num">${taxRate > 0 ? taxRate + '%' : '&mdash;'}</td>` +
      `<td class="num">${taxRate > 0 ? fmt(lineTax) : '&mdash;'}</td>` +
      `<td class="num">${fmt(lineTotalWithTax)}</td>` +
      `</tr>`;
  }).join('');

  // ── Totals rows (math unchanged) ──
  const subtotal = invoice.subtotal || 0;
  const taxAmt   = invoice.tax_amount || 0;
  const discAmt  = invoice.discount_amount || 0;
  const shipAmt  = invoice.shipping_amount || 0;
  const total    = invoice.total || 0;
  const amtPaid  = invoice.amount_paid || 0;

  let totalsRows = `<tr><td>Subtotal</td><td class="val">${fmt(subtotal)}</td></tr>`;
  if (discAmt || taxAmt) {
    totalsRows += `<tr><td>Pre-Tax Amount</td><td class="val">${fmt(subtotal - discAmt)}</td></tr>`;
  }
  if (taxAmt)  totalsRows += `<tr><td>Tax</td><td class="val">${fmt(taxAmt)}</td></tr>`;
  if (discAmt) totalsRows += `<tr><td>Discount</td><td class="val">-${fmt(discAmt)}</td></tr>`;
  if (shipAmt) totalsRows += `<tr><td>Shipping</td><td class="val">${fmt(shipAmt)}</td></tr>`;
  totalsRows += `<tr class="grand"><td>Total</td><td class="val">${fmt(total)}</td></tr>`;
  if (amtPaid > 0) {
    totalsRows += `<tr><td>Amount Paid</td><td class="val">${fmt(amtPaid)}</td></tr>`;
    totalsRows += `<tr class="grand"><td>Balance Due</td><td class="val">${fmt(total - amtPaid)}</td></tr>`;
  }

  // ── Notes / Terms ──
  const notesHTML = (invoice.notes || invoice.terms_text)
    ? `<div class="box-row">` +
      (invoice.notes
        ? `<div class="box"><div class="sec-label">Notes</div><div style="margin-top:5px;font-size:11px;white-space:pre-line;">${esc(invoice.notes)}</div></div>`
        : '') +
      (invoice.terms_text
        ? `<div class="box"><div class="sec-label">Terms &amp; Conditions</div><div style="margin-top:5px;font-size:11px;white-space:pre-line;">${esc(invoice.terms_text)}</div></div>`
        : '') +
      `</div>`
    : '';

  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Assemble ──
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${esc(invoice.invoice_number || '')}</title>` +
    `<style>${CLASSIC_CSS}</style></head><body>` +
    `<div class="doc-frame">` +
    (isDraft ? `<div class="draft-wm">DRAFT</div>` : '') +
    // Header
    `<div class="doc-header">` +
      `<div class="co">` +
        `<div class="co-name">${companyName}</div>` +
        `<div class="co-detail">` +
          (companyLegal ? `<div>${companyLegal}</div>` : '') +
          (companyAddr  ? `<div>${companyAddr}</div>` : '') +
          ([companyEmail, companyPhone].filter(Boolean).join(' &middot; ') || '') +
          (companyWebsite ? `<div>${companyWebsite}</div>` : '') +
        `</div>` +
      `</div>` +
      `<div class="doc-meta">` +
        `<div class="doc-title">Invoice</div>` +
        `<div class="doc-number">#${esc(invoice.invoice_number || '')}</div>` +
        (statusLabel ? `<div style="margin-top:6px;font-size:11px;font-weight:bold;">[${statusLabel}]</div>` : '') +
      `</div>` +
    `</div>` +
    // Meta strip: invoice date / due date / payment terms
    `<table class="meta-strip"><tr>` +
      `<td><div class="ml">Invoice Date</div><div class="mv">${esc(invoice.issue_date || '&mdash;')}</div></td>` +
      `<td><div class="ml">Due Date</div><div class="mv">${esc(invoice.due_date || '&mdash;')}</div></td>` +
      `<td><div class="ml">Payment Terms</div><div class="mv">${esc(invoice.terms || 'Net 30')}</div></td>` +
    `</tr></table>` +
    // Bill To box
    `<div class="box-row">` +
      `<div class="box">` +
        `<div class="sec-label">Bill To</div>` +
        `<div style="margin-top:5px;"><b>${clientName}</b>` +
        (clientEmail ? `<br>${clientEmail}` : '') +
        (clientAddr  ? `<br>${clientAddr}` : '') +
        (clientPhone ? `<br>${clientPhone}` : '') +
        `</div>` +
      `</div>` +
    `</div>` +
    // Line items ruled table (black header bar)
    `<table class="ruled"><thead><tr>` +
      `<th>Description</th>` +
      `<th style="text-align:right;width:50px;">Qty</th>` +
      `<th style="text-align:right;width:90px;">Rate</th>` +
      `<th style="text-align:right;width:60px;">Tax %</th>` +
      `<th style="text-align:right;width:90px;">Tax Amt</th>` +
      `<th style="text-align:right;width:90px;">Amount</th>` +
    `</tr></thead><tbody>${lineRows || '<tr><td colspan="6"><i>(no line items)</i></td></tr>'}</tbody></table>` +
    // Bordered totals box
    `<div style="display:flex;justify-content:flex-end;padding:10px 16px;border-top:1px solid #000;">` +
      `<table class="totals-tbl">${totalsRows}</table>` +
    `</div>` +
    // Notes / Terms
    notesHTML +
    // Footer bar
    `<div class="footer-bar">${companyName} &middot; Invoice #${esc(invoice.invoice_number || '')} &middot; Generated ${generated}</div>` +
    `</div>` +
    `</body></html>`;
}

// ─── Generate PDF Buffer ─────────────────────────────────
// Delegates to the shared headless renderer (htmlToPDFBuffer) so PDF
// options, security (nodeIntegration off), and window cleanup are handled
// in one place. Previously this path hard-coded Letter + small margins
// and used win.close() (which can leak if a throw occurs before it).
export async function generateInvoicePDF(
  invoiceData: any,
  companyData: any,
  clientData: any,
  lineItems: any[],
  options?: import('./print-preview').PDFOptions
): Promise<Buffer> {
  // Lazy-require to avoid a circular dep between pdf-generator and print-preview.
  const { htmlToPDFBuffer } = await import('./print-preview');
  const html = buildInvoiceHTML(companyData, clientData, invoiceData, lineItems);
  return htmlToPDFBuffer(html, options);
}

// NOTE: generateInvoiceHTML was removed. Renderer uses
// src/renderer/lib/print-templates.ts → generateInvoiceHTML(...) which
// respects invoice settings (logo, accent, columns, payment schedule, etc.).
// This file is now ONLY a fallback for headless PDF generation when the
// renderer cannot supply its own HTML (e.g., cron jobs, CLI automation).
