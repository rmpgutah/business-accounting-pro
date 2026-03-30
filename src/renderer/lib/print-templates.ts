/**
 * Print Template Generators
 * Produces self-contained HTML strings for invoices, pay stubs, and reports.
 * Light theme, professional layout, inline CSS, print-optimized.
 */

// ─── Currency Formatter ──────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n || 0);

// ─── Shared base styles ─────────────────────────────────────
const baseStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a1a;
    font-size: 13px;
    line-height: 1.55;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page { margin: 0.4in; }
  .page { padding: 48px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 12px; text-align: left; }
  th {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #64748b;
    border-bottom: 2px solid #0f172a;
  }
  td { border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px; }
  .text-right { text-align: right; }
  .font-mono { font-variant-numeric: tabular-nums; font-family: 'SF Mono', 'Fira Code', monospace, system-ui; }
  .font-bold { font-weight: 700; }
  .text-muted { color: #94a3b8; }
  .text-dark { color: #0f172a; }
  .text-green { color: #16a34a; }
  .text-red { color: #dc2626; }
  .section-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    color: #94a3b8; letter-spacing: 0.8px; margin-bottom: 6px;
  }
`;

// ═══════════════════════════════════════════════════════════════
// INVOICE TEMPLATE
// ═══════════════════════════════════════════════════════════════
export function generateInvoiceHTML(
  invoice: any,
  company: any,
  client: any,
  lineItems: any[]
): string {
  const companyName = company?.name || 'Company';
  const companyAddr = [company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip]
    .filter(Boolean).join(', ');
  const companyEmail = company?.email || '';
  const companyPhone = company?.phone || '';

  const clientName = client?.name || 'Client';
  const clientEmail = client?.email || '';
  const clientAddr = [client?.address_line1, client?.address_line2, client?.city, client?.state, client?.zip]
    .filter(Boolean).join(', ');
  const clientPhone = client?.phone || '';

  const lineRows = lineItems.map(l => `
    <tr>
      <td>${l.description || ''}</td>
      <td class="text-right font-mono">${l.quantity ?? 1}</td>
      <td class="text-right font-mono">${fmt(l.unit_price)}</td>
      <td class="text-right font-mono">${l.tax_rate > 0 ? l.tax_rate + '%' : '--'}</td>
      <td class="text-right font-mono font-bold">${fmt(l.amount || (l.quantity || 1) * (l.unit_price || 0))}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${baseStyles}
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
.company-name { font-size: 22px; font-weight: 800; color: #0f172a; }
.company-detail { font-size: 11px; color: #64748b; margin-top: 6px; line-height: 1.6; }
.inv-title { font-size: 28px; font-weight: 800; color: #0f172a; text-transform: uppercase; text-align: right; }
.inv-number { font-size: 13px; color: #64748b; text-align: right; margin-top: 4px; }
.addresses { display: flex; justify-content: space-between; margin-bottom: 28px; }
.addr-block { max-width: 48%; }
.addr-name { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
.addr-detail { font-size: 12px; color: #64748b; line-height: 1.5; }
.meta-row { display: flex; gap: 40px; padding: 14px 18px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 2px; margin-bottom: 28px; }
.meta-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; }
.meta-value { font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px; }
.totals { display: flex; justify-content: flex-end; margin-top: 8px; }
.totals-box { width: 260px; }
.totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12px; color: #475569; }
.totals-row span:last-child { font-variant-numeric: tabular-nums; }
.totals-total { border-top: 2px solid #0f172a; font-weight: 800; font-size: 16px; color: #0f172a; padding-top: 10px; margin-top: 4px; }
.totals-paid { color: #16a34a; }
.totals-balance { font-weight: 700; font-size: 14px; color: #0f172a; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 4px; }
.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
.footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.footer-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; margin-bottom: 4px; }
.footer-text { font-size: 11px; color: #64748b; line-height: 1.6; white-space: pre-line; }
.footer-company { text-align: center; margin-top: 32px; font-size: 10px; color: #cbd5e1; }
</style></head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="company-name">${companyName}</div>
      <div class="company-detail">
        ${companyAddr ? companyAddr + '<br>' : ''}
        ${companyEmail}${companyPhone ? ' &middot; ' + companyPhone : ''}
      </div>
    </div>
    <div>
      <div class="inv-title">Invoice</div>
      <div class="inv-number">#${invoice.invoice_number || ''}</div>
    </div>
  </div>

  <div class="addresses">
    <div class="addr-block">
      <div class="section-label">Bill To</div>
      <div class="addr-name">${clientName}</div>
      <div class="addr-detail">
        ${clientEmail ? clientEmail + '<br>' : ''}
        ${clientAddr ? clientAddr + '<br>' : ''}
        ${clientPhone || ''}
      </div>
    </div>
  </div>

  <div class="meta-row">
    <div><div class="meta-label">Invoice Date</div><div class="meta-value">${invoice.issue_date || ''}</div></div>
    <div><div class="meta-label">Due Date</div><div class="meta-value">${invoice.due_date || ''}</div></div>
    <div><div class="meta-label">Terms</div><div class="meta-value">${invoice.terms || 'Net 30'}</div></div>
  </div>

  <table>
    <thead><tr>
      <th>Description</th>
      <th class="text-right">Qty</th>
      <th class="text-right">Rate</th>
      <th class="text-right">Tax</th>
      <th class="text-right">Amount</th>
    </tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="totals-row"><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></div>
      ${invoice.tax > 0 ? `<div class="totals-row"><span>Tax</span><span>${fmt(invoice.tax)}</span></div>` : ''}
      ${invoice.discount > 0 ? `<div class="totals-row"><span>Discount</span><span>-${fmt(invoice.discount)}</span></div>` : ''}
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
      ${invoice.terms_text ? `<div><div class="footer-label">Terms &amp; Conditions</div><div class="footer-text">${invoice.terms_text}</div></div>` : ''}
    </div>
  </div>` : ''}

  <div class="footer-company">${companyName}</div>
</div>
</body></html>`;
}


// ═══════════════════════════════════════════════════════════════
// PAY STUB TEMPLATE
// ═══════════════════════════════════════════════════════════════
export interface PayStubData {
  employee_name: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  hours: number;
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  net_pay: number;
}

export interface YtdData {
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  net_pay: number;
}

export function generatePayStubHTML(
  stub: PayStubData,
  ytd: YtdData,
  company: any
): string {
  const companyName = company?.name || 'Company';
  const companyAddr = [company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip]
    .filter(Boolean).join(', ');

  const totalDed = stub.federal_tax + stub.state_tax + stub.social_security + stub.medicare;
  const ytdTotalDed = ytd.federal_tax + ytd.state_tax + ytd.social_security + ytd.medicare;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${baseStyles}
.stub { max-width: 640px; margin: 0 auto; padding: 48px 40px; }
.stub-header { text-align: center; margin-bottom: 28px; padding-bottom: 16px; border-bottom: 2px solid #0f172a; }
.stub-company { font-size: 18px; font-weight: 800; color: #0f172a; }
.stub-addr { font-size: 11px; color: #64748b; margin-top: 4px; }
.stub-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-top: 12px; }
.emp-row { display: flex; justify-content: space-between; padding: 12px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 2px; margin-bottom: 20px; }
.emp-name { font-size: 15px; font-weight: 700; color: #0f172a; }
.emp-meta { font-size: 11px; color: #64748b; }
.section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 8px; margin-top: 20px; }
.net-pay-box { text-align: center; padding: 20px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 2px; margin-top: 24px; }
.net-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; }
.net-value { font-size: 28px; font-weight: 800; color: #16a34a; margin-top: 4px; font-variant-numeric: tabular-nums; }
.net-ytd { font-size: 12px; color: #64748b; margin-top: 4px; }
.footer-co { text-align: center; margin-top: 32px; font-size: 10px; color: #cbd5e1; }
</style></head>
<body>
<div class="stub">
  <div class="stub-header">
    <div class="stub-company">${companyName}</div>
    ${companyAddr ? `<div class="stub-addr">${companyAddr}</div>` : ''}
    <div class="stub-title">Earnings Statement</div>
  </div>

  <div class="emp-row">
    <div>
      <div class="emp-name">${stub.employee_name}</div>
    </div>
    <div style="text-align:right;">
      <div class="emp-meta">Period: ${stub.period_start} &ndash; ${stub.period_end}</div>
      <div class="emp-meta">Pay Date: ${stub.pay_date}</div>
    </div>
  </div>

  <div class="section-title">Earnings</div>
  <table>
    <thead><tr>
      <th>Description</th>
      <th class="text-right">Hours</th>
      <th class="text-right">Current</th>
      <th class="text-right">YTD</th>
    </tr></thead>
    <tbody>
      <tr>
        <td>${stub.hours > 0 ? 'Regular Hours' : 'Salary'}</td>
        <td class="text-right font-mono">${stub.hours > 0 ? stub.hours.toFixed(2) : '--'}</td>
        <td class="text-right font-mono font-bold">${fmt(stub.gross_pay)}</td>
        <td class="text-right font-mono text-muted">${fmt(ytd.gross_pay)}</td>
      </tr>
      <tr style="border-top:2px solid #e2e8f0;">
        <td class="font-bold">Gross Pay</td>
        <td></td>
        <td class="text-right font-mono font-bold">${fmt(stub.gross_pay)}</td>
        <td class="text-right font-mono text-muted">${fmt(ytd.gross_pay)}</td>
      </tr>
    </tbody>
  </table>

  <div class="section-title">Deductions</div>
  <table>
    <thead><tr>
      <th>Description</th>
      <th class="text-right">Current</th>
      <th class="text-right">YTD</th>
    </tr></thead>
    <tbody>
      <tr>
        <td>Federal Income Tax</td>
        <td class="text-right font-mono text-red">${fmt(stub.federal_tax)}</td>
        <td class="text-right font-mono text-muted">${fmt(ytd.federal_tax)}</td>
      </tr>
      <tr>
        <td>State Income Tax</td>
        <td class="text-right font-mono text-red">${fmt(stub.state_tax)}</td>
        <td class="text-right font-mono text-muted">${fmt(ytd.state_tax)}</td>
      </tr>
      <tr>
        <td>Social Security (6.2%)</td>
        <td class="text-right font-mono text-red">${fmt(stub.social_security)}</td>
        <td class="text-right font-mono text-muted">${fmt(ytd.social_security)}</td>
      </tr>
      <tr>
        <td>Medicare (1.45%)</td>
        <td class="text-right font-mono text-red">${fmt(stub.medicare)}</td>
        <td class="text-right font-mono text-muted">${fmt(ytd.medicare)}</td>
      </tr>
      <tr style="border-top:2px solid #e2e8f0;">
        <td class="font-bold">Total Deductions</td>
        <td class="text-right font-mono font-bold text-red">${fmt(totalDed)}</td>
        <td class="text-right font-mono text-muted">${fmt(ytdTotalDed)}</td>
      </tr>
    </tbody>
  </table>

  <div class="net-pay-box">
    <div class="net-label">Net Pay</div>
    <div class="net-value">${fmt(stub.net_pay)}</div>
    <div class="net-ytd">YTD: ${fmt(ytd.net_pay)}</div>
  </div>

  <div class="footer-co">${companyName}</div>
</div>
</body></html>`;
}


// ═══════════════════════════════════════════════════════════════
// REPORT TEMPLATE (generic — P&L, Balance Sheet, etc.)
// ═══════════════════════════════════════════════════════════════
export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  format?: 'currency' | 'text';
}

export interface ReportSummary {
  label: string;
  value: string;
  accent?: 'green' | 'red' | 'default';
}

export function generateReportHTML(
  title: string,
  companyName: string,
  dateRange: string,
  columns: ReportColumn[],
  rows: Record<string, any>[],
  summary?: ReportSummary[]
): string {
  const headerCells = columns
    .map(c => `<th class="${c.align === 'right' ? 'text-right' : ''}">${c.label}</th>`)
    .join('');

  const bodyRows = rows.map(row => {
    const cells = columns.map(c => {
      const val = row[c.key];
      const align = c.align === 'right' ? 'text-right' : '';
      const mono = c.format === 'currency' ? 'font-mono' : '';
      const display = c.format === 'currency' ? fmt(Number(val) || 0) : (val ?? '');
      const bold = row._bold ? 'font-bold' : '';
      const accent = row._accent || '';
      return `<td class="${align} ${mono} ${bold} ${accent}">${display}</td>`;
    }).join('');

    const trClass = row._separator ? 'style="border-top:2px solid #0f172a;"' : '';
    const bgClass = row._highlight ? 'style="background:#f8fafc;"' : '';
    return `<tr ${trClass} ${bgClass}>${cells}</tr>`;
  }).join('');

  const summaryHTML = summary && summary.length > 0 ? `
    <div style="margin-top:24px;padding-top:16px;border-top:2px solid #0f172a;">
      ${summary.map(s => {
        const color = s.accent === 'green' ? '#16a34a' : s.accent === 'red' ? '#dc2626' : '#0f172a';
        return `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
          <span style="font-weight:700;color:#0f172a;">${s.label}</span>
          <span style="font-weight:700;color:${color};font-variant-numeric:tabular-nums;">${s.value}</span>
        </div>`;
      }).join('')}
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${baseStyles}
.report { padding: 48px; }
.report-header { text-align: center; margin-bottom: 28px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
.report-company { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #0f172a; }
.report-title { font-size: 12px; color: #475569; margin-top: 4px; }
.report-dates { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.footer-co { text-align: center; margin-top: 32px; font-size: 10px; color: #cbd5e1; }
</style></head>
<body>
<div class="report">
  <div class="report-header">
    <div class="report-company">${companyName}</div>
    <div class="report-title">${title}</div>
    <div class="report-dates">${dateRange}</div>
  </div>

  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>

  ${summaryHTML}

  <div class="footer-co">${companyName}</div>
</div>
</body></html>`;
}
