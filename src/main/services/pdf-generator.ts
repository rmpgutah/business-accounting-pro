/**
 * PDF Invoice Generator
 * Uses Electron's webContents.printToPDF() with an HTML template.
 * No external dependencies required.
 */
// BrowserWindow is no longer needed directly — rendering now goes through
// the shared helper in print-preview.ts.

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

  const lineRows = (lineItems || [])
    .map(
      (l, i) => {
        const qty = Number(l.quantity) || 1;
        const rate = Number(l.unit_price) || 0;
        const taxRate = Number(l.tax_rate) || 0;
        const lineSubtotal = Number(l.amount) || (qty * rate);
        const lineTax = lineSubtotal * (taxRate / 100);
        const lineTotalWithTax = lineSubtotal + lineTax;
        return `
    <tr${i % 2 === 1 ? ' style="background:#fafafa;"' : ''}>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#1a1a1a;">${esc(l.description || '')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#334155;font-variant-numeric:tabular-nums;">${qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#334155;font-variant-numeric:tabular-nums;">${fmt(rate)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#334155;font-variant-numeric:tabular-nums;">${taxRate > 0 ? taxRate + '%' : '\u2014'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#334155;font-variant-numeric:tabular-nums;">${taxRate > 0 ? fmt(lineTax) : '\u2014'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;color:#1a1a1a;font-variant-numeric:tabular-nums;">${fmt(lineTotalWithTax)}</td>
    </tr>
  `;
      }
    )
    .join('');

  const statusColors: Record<string, { bg: string; color: string }> = {
    draft: { bg: '#f3f4f6', color: '#1e293b' },
    sent: { bg: '#dbeafe', color: '#1e40af' },
    paid: { bg: '#dcfce7', color: '#166534' },
    overdue: { bg: '#fee2e2', color: '#991b1b' },
    partial: { bg: '#f3e8ff', color: '#6b21a8' },
    cancelled: { bg: '#f3f4f6', color: '#475569' },
  };
  const sc = statusColors[invoice.status] || statusColors.draft;

  const isDraft = invoice.status === 'draft';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page {
    size: letter;
    margin: 0.5in 0.6in;
  }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
    padding: 48px 48px 40px;
    font-size: 13px;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-break { page-break-inside: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }

  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 44px; }
  .company-block {}
  .company-name { font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.3px; }
  .company-legal { font-size: 12px; color: #64748b; margin-top: 2px; }
  .company-contact { font-size: 11px; color: #64748b; margin-top: 8px; line-height: 1.6; }

  .invoice-block { text-align: right; }
  .invoice-title { font-size: 32px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; text-transform: uppercase; }
  .invoice-number { font-size: 14px; color: #64748b; margin-top: 4px; font-weight: 500; }
  .status-badge {
    display: inline-block;
    padding: 3px 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    border-radius: 2px;
    margin-top: 8px;
  }

  .addresses { display: flex; justify-content: space-between; margin-bottom: 32px; }
  .addr-block { max-width: 48%; }
  .addr-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #475569; letter-spacing: 0.8px; margin-bottom: 6px; }
  .addr-name { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
  .addr-detail { font-size: 12px; color: #64748b; line-height: 1.5; }

  .meta-row { display: flex; gap: 48px; margin-bottom: 32px; padding: 16px 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 2px; }
  .meta-item .meta-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #475569; letter-spacing: 0.8px; display: block; margin-bottom: 3px; }
  .meta-item .meta-value { font-size: 13px; font-weight: 600; color: #0f172a; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  thead th {
    padding: 8px 12px;
    text-align: left;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    color: #475569;
    letter-spacing: 0.5px;
    border-bottom: 2px solid #0f172a;
    background: #f8fafc;
  }
  thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4), thead th:nth-child(5) { text-align: right; }
  tr:nth-child(even) td { background: #fafafa; }

  .totals-section { display: flex; justify-content: flex-end; }
  .totals-box { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; color: #475569; }
  .totals-row span:last-child { font-variant-numeric: tabular-nums; }
  .totals-total { border-top: 2px solid #0f172a; font-weight: 800; font-size: 17px; color: #0f172a; padding-top: 12px; margin-top: 6px; }
  .totals-paid { color: #16a34a; }
  .totals-balance { font-weight: 700; font-size: 15px; color: #0f172a; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 4px; }

  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  .footer-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #475569; letter-spacing: 0.8px; margin-bottom: 6px; }
  .footer-text { font-size: 12px; color: #475569; line-height: 1.6; white-space: pre-line; }
  .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }

  .print-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 9px;
    color: #64748b;
    padding: 4px 0;
    border-top: 1px solid #e5e5e5;
  }

  .draft-watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 80px;
    font-weight: 900;
    color: rgba(200, 0, 0, 0.06);
    letter-spacing: 15px;
    pointer-events: none;
    z-index: 1;
  }
</style></head>
<body>
  ${isDraft ? '<div class="draft-watermark">DRAFT</div>' : ''}

  <div class="header">
    <div class="company-block">
      <div class="company-name">${companyName}</div>
      ${companyLegal ? `<div class="company-legal">${companyLegal}</div>` : ''}
      <div class="company-contact">
        ${companyAddr ? companyAddr + '<br>' : ''}
        ${companyEmail ? companyEmail : ''}${companyPhone ? ' &middot; ' + companyPhone : ''}
        ${companyWebsite ? '<br>' + companyWebsite : ''}
      </div>
    </div>
    <div class="invoice-block">
      <div class="invoice-title">Invoice</div>
      <div class="invoice-number">#${esc(invoice.invoice_number || '')}</div>
      <div class="status-badge" style="background:${sc.bg};color:${sc.color};">${esc((invoice.status || 'draft').toUpperCase())}</div>
    </div>
  </div>

  <div class="addresses">
    <div class="addr-block">
      <div class="addr-label">Bill To</div>
      <div class="addr-name">${clientName}</div>
      <div class="addr-detail">
        ${clientEmail ? clientEmail + '<br>' : ''}
        ${clientAddr ? clientAddr + '<br>' : ''}
        ${clientPhone ? clientPhone : ''}
      </div>
    </div>
  </div>

  <div class="meta-row">
    <div class="meta-item"><span class="meta-label">Invoice Date</span><span class="meta-value">${esc(invoice.issue_date || '')}</span></div>
    <div class="meta-item"><span class="meta-label">Due Date</span><span class="meta-value">${esc(invoice.due_date || '')}</span></div>
    <div class="meta-item"><span class="meta-label">Payment Terms</span><span class="meta-value">${esc(invoice.terms || 'Net 30')}</span></div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax %</th><th>Tax Amount</th><th>Amount</th></tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals-section">
    <div class="totals-box">
      <div class="totals-row"><span>Subtotal</span><span>${fmt(invoice.subtotal || 0)}</span></div>
      ${(invoice.discount_amount || invoice.tax_amount) ? `<div class="totals-row"><span>Pre-Tax Amount</span><span>${fmt((invoice.subtotal || 0) - (invoice.discount_amount || 0))}</span></div>` : ''}
      ${invoice.tax_amount ? `<div class="totals-row"><span>Tax</span><span>${fmt(invoice.tax_amount)}</span></div>` : ''}
      ${invoice.discount_amount ? `<div class="totals-row"><span>Discount</span><span>-${fmt(invoice.discount_amount)}</span></div>` : ''}
      <div class="totals-row totals-total"><span>Total</span><span>${fmt(invoice.total || 0)}</span></div>
      ${invoice.amount_paid > 0 ? `
        <div class="totals-row totals-paid"><span>Amount Paid</span><span>${fmt(invoice.amount_paid)}</span></div>
        <div class="totals-row totals-balance"><span>Balance Due</span><span>${fmt((invoice.total || 0) - (invoice.amount_paid || 0))}</span></div>
      ` : ''}
    </div>
  </div>

  ${(invoice.notes || invoice.terms_text) ? `
  <div class="footer">
    <div class="footer-grid">
      ${invoice.notes ? `<div><div class="footer-label">Notes</div><div class="footer-text">${esc(invoice.notes)}</div></div>` : ''}
      ${invoice.terms_text ? `<div><div class="footer-label">Terms &amp; Conditions</div><div class="footer-text">${esc(invoice.terms_text)}</div></div>` : ''}
    </div>
  </div>` : ''}

  <div class="print-footer">
    ${companyName} &middot; Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
  </div>
</body>
</html>`;
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
