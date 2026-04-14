/**
 * PDF Invoice Generator
 * Uses Electron's webContents.printToPDF() with an HTML template.
 * No external dependencies required.
 */
import { BrowserWindow } from 'electron';

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
  const companyName = company?.name || 'Company';
  const companyLegal = company?.legal_name || '';
  const companyAddr = [company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip]
    .filter(Boolean)
    .join(', ');
  const companyEmail = company?.email || '';
  const companyPhone = company?.phone || '';
  const companyWebsite = company?.website || '';

  const clientName = client?.name || 'Client';
  const clientEmail = client?.email || '';
  const clientPhone = client?.phone || '';
  const clientAddr = [client?.address_line1, client?.address_line2, client?.city, client?.state, client?.zip]
    .filter(Boolean)
    .join(', ');

  const lineRows = lineItems
    .map(
      (l) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e2e2;color:#1a1a1a;">${l.description || ''}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e2e2;text-align:right;color:#444;font-variant-numeric:tabular-nums;">${l.quantity || 1}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e2e2;text-align:right;color:#444;font-variant-numeric:tabular-nums;">${fmt(l.unit_price)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e2e2;text-align:right;color:#444;font-variant-numeric:tabular-nums;">${l.tax_rate > 0 ? l.tax_rate + '%' : '--'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e2e2;text-align:right;font-weight:600;color:#1a1a1a;font-variant-numeric:tabular-nums;">${fmt(l.amount || l.quantity * l.unit_price)}</td>
    </tr>
  `
    )
    .join('');

  const statusColors: Record<string, { bg: string; color: string }> = {
    draft: { bg: '#f3f4f6', color: '#4b5563' },
    sent: { bg: '#dbeafe', color: '#1e40af' },
    paid: { bg: '#dcfce7', color: '#166534' },
    overdue: { bg: '#fee2e2', color: '#991b1b' },
    partial: { bg: '#f3e8ff', color: '#6b21a8' },
    cancelled: { bg: '#f3f4f6', color: '#6b7280' },
  };
  const sc = statusColors[invoice.status] || statusColors.draft;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
    padding: 48px 48px 40px;
    font-size: 13px;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
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
  .addr-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; margin-bottom: 6px; }
  .addr-name { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
  .addr-detail { font-size: 12px; color: #64748b; line-height: 1.5; }

  .meta-row { display: flex; gap: 48px; margin-bottom: 32px; padding: 16px 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 2px; }
  .meta-item .meta-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; display: block; margin-bottom: 3px; }
  .meta-item .meta-value { font-size: 13px; font-weight: 600; color: #0f172a; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  thead th {
    padding: 10px 14px;
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #64748b;
    letter-spacing: 0.8px;
    border-bottom: 2px solid #0f172a;
  }
  thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4), thead th:nth-child(5) { text-align: right; }

  .totals-section { display: flex; justify-content: flex-end; }
  .totals-box { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; color: #475569; }
  .totals-row span:last-child { font-variant-numeric: tabular-nums; }
  .totals-total { border-top: 2px solid #0f172a; font-weight: 800; font-size: 17px; color: #0f172a; padding-top: 12px; margin-top: 6px; }
  .totals-paid { color: #16a34a; }
  .totals-balance { font-weight: 700; font-size: 15px; color: #0f172a; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 4px; }

  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  .footer-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; margin-bottom: 6px; }
  .footer-text { font-size: 12px; color: #64748b; line-height: 1.6; white-space: pre-line; }
  .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
</style></head>
<body>
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
      <div class="invoice-number">#${invoice.invoice_number}</div>
      <div class="status-badge" style="background:${sc.bg};color:${sc.color};">${(invoice.status || 'draft').toUpperCase()}</div>
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
    <div class="meta-item"><span class="meta-label">Invoice Date</span><span class="meta-value">${invoice.issue_date || ''}</span></div>
    <div class="meta-item"><span class="meta-label">Due Date</span><span class="meta-value">${invoice.due_date || ''}</span></div>
    <div class="meta-item"><span class="meta-label">Payment Terms</span><span class="meta-value">${invoice.terms || 'Net 30'}</span></div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th>Amount</th></tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals-section">
    <div class="totals-box">
      <div class="totals-row"><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></div>
      ${invoice.tax_amount ? `<div class="totals-row"><span>Tax</span><span>${fmt(invoice.tax_amount)}</span></div>` : ''}
      ${invoice.discount_amount ? `<div class="totals-row"><span>Discount</span><span>-${fmt(invoice.discount_amount)}</span></div>` : ''}
      <div class="totals-row totals-total"><span>Total</span><span>${fmt(invoice.total)}</span></div>
      ${invoice.amount_paid > 0 ? `
        <div class="totals-row totals-paid"><span>Amount Paid</span><span>${fmt(invoice.amount_paid)}</span></div>
        <div class="totals-row totals-balance"><span>Balance Due</span><span>${fmt(invoice.total - invoice.amount_paid)}</span></div>
      ` : ''}
    </div>
  </div>

  ${(invoice.notes || invoice.terms_text) ? `
  <div class="footer">
    <div class="footer-grid">
      ${invoice.notes ? `<div><div class="footer-label">Notes</div><div class="footer-text">${invoice.notes}</div></div>` : ''}
      ${invoice.terms_text ? `<div><div class="footer-label">Terms & Conditions</div><div class="footer-text">${invoice.terms_text}</div></div>` : ''}
    </div>
  </div>` : ''}
</body>
</html>`;
}

// ─── Generate PDF Buffer ─────────────────────────────────
export async function generateInvoicePDF(
  invoiceData: any,
  companyData: any,
  clientData: any,
  lineItems: any[]
): Promise<Buffer> {
  const html = buildInvoiceHTML(companyData, clientData, invoiceData, lineItems);

  const win = new BrowserWindow({ show: false, width: 800, height: 1100 });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdfData = await win.webContents.printToPDF({
      pageSize: 'Letter',
      margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 },
      printBackground: true,
    });
    return Buffer.from(pdfData);
  } finally {
    win.close();
  }
}

// NOTE: generateInvoiceHTML was removed. Renderer uses
// src/renderer/lib/print-templates.ts → generateInvoiceHTML(...) which
// respects invoice settings (logo, accent, columns, payment schedule, etc.).
// This file is now ONLY a fallback for headless PDF generation when the
// renderer cannot supply its own HTML (e.g., cron jobs, CLI automation).
