/**
 * Print Template Generators
 * Produces self-contained HTML strings for invoices, pay stubs, and reports.
 * Light theme, professional layout, inline CSS, print-optimized.
 */

// ─── Currency Formatter ──────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n || 0);

const fmtDate = (d: string) => {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return d; }
};

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
  @page { margin: 0.45in; }
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
  .text-muted { color: #64748b; }
  .text-dark { color: #0f172a; }
  .text-green { color: #16a34a; }
  .text-red { color: #dc2626; }
  .section-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    color: #64748b; letter-spacing: 0.8px; margin-bottom: 6px;
  }
`;

// ─── Status stamp helper ─────────────────────────────────────
function statusStampCSS(color: string): string {
  return `
  .status-stamp {
    position: fixed; top: 60px; right: 40px;
    font-size: 36px; font-weight: 900; text-transform: uppercase;
    letter-spacing: 4px; color: ${color};
    border: 4px solid ${color}; border-radius: 4px;
    padding: 6px 16px; opacity: 0.18; transform: rotate(-18deg);
    pointer-events: none;
  }
  @media print { .status-stamp { position: fixed; } }
  `;
}

function getStatusStamp(status: string): { label: string; color: string } | null {
  switch (status) {
    case 'paid': return { label: 'PAID', color: '#16a34a' };
    case 'overdue': return { label: 'OVERDUE', color: '#dc2626' };
    case 'draft': return { label: 'DRAFT', color: '#94a3b8' };
    case 'cancelled': return { label: 'VOID', color: '#dc2626' };
    case 'partial': return { label: 'PARTIAL', color: '#d97706' };
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// INVOICE TEMPLATE
// ═══════════════════════════════════════════════════════════════

export type LineRowType = 'item' | 'section' | 'note' | 'subtotal' | 'image' | 'spacer';

export interface InvoiceColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  order: number;
}

export interface InvoiceSettings {
  accent_color?: string;
  secondary_color?: string;
  logo_data?: string | null;
  template_style?: 'classic' | 'modern' | 'minimal' | 'executive' | 'compact';
  show_logo?: boolean | number;
  show_tax_column?: boolean | number;
  show_payment_terms?: boolean | number;
  footer_text?: string;
  watermark_text?: string;
  watermark_opacity?: number;
  font_family?: 'system' | 'inter' | 'georgia' | 'mono';
  header_layout?: 'logo-left' | 'logo-center' | 'logo-right';
  column_config?: InvoiceColumnConfig[] | string;
  payment_qr_url?: string;
  show_payment_qr?: boolean | number;
  custom_field_1_label?: string;
  custom_field_2_label?: string;
  custom_field_3_label?: string;
  custom_field_4_label?: string;
}

const DEFAULT_COLUMNS: InvoiceColumnConfig[] = [
  { key: 'item_code',   label: 'Code',        visible: false, order: 0 },
  { key: 'description', label: 'Description', visible: true,  order: 1 },
  { key: 'quantity',    label: 'Qty',         visible: true,  order: 2 },
  { key: 'unit_label',  label: 'Unit',        visible: false, order: 3 },
  { key: 'unit_price',  label: 'Rate',        visible: true,  order: 4 },
  { key: 'tax_rate',    label: 'Tax %',       visible: true,  order: 5 },
  { key: 'amount',      label: 'Amount',      visible: true,  order: 6 },
];

export { DEFAULT_COLUMNS };

function resolveColumns(raw: InvoiceColumnConfig[] | string | undefined): InvoiceColumnConfig[] {
  if (!raw) return DEFAULT_COLUMNS;
  const parsed: InvoiceColumnConfig[] = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return []; } })()
    : raw;
  if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_COLUMNS;
  return [...parsed].sort((a, b) => a.order - b.order).filter(c => c.visible);
}

function fontStack(family: string | undefined): string {
  switch (family) {
    case 'inter':   return "'Segoe UI', Optima, Arial, sans-serif";
    case 'georgia': return "Georgia, 'Times New Roman', serif";
    case 'mono':    return "'Courier New', Courier, monospace";
    default:        return "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  }
}

function watermarkCSS(text: string, opacity: number): string {
  if (!text) return '';
  return `
  .watermark {
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 80px; font-weight: 900; text-transform: uppercase;
    letter-spacing: 8px; color: #000;
    opacity: ${Math.min(0.15, Math.max(0.02, opacity || 0.06))};
    pointer-events: none; white-space: nowrap; z-index: 0;
  }
  @media print { .watermark { position: fixed; } }`;
}

// Simple placeholder QR — renders a labeled box. Replace with qrcode-svg for real QR.
function qrPlaceholder(url: string): string {
  if (!url) return '';
  return `
  <div style="display:inline-block;border:2px solid #334155;padding:8px;text-align:center;border-radius:3px;">
    <div style="width:72px;height:72px;background:repeating-linear-gradient(45deg,#334155 0px,#334155 2px,#fff 2px,#fff 8px);margin-bottom:4px;"></div>
    <div style="font-size:8px;color:#64748b;max-width:80px;word-break:break-all;">${url}</div>
  </div>`;
}

export function generateInvoiceHTML(
  invoice: any,
  company: any,
  client: any,
  lineItems: any[],
  settings?: InvoiceSettings,
  paymentSchedule?: any[]
): string {
  const accent    = settings?.accent_color || '#2563eb';
  const secondary = settings?.secondary_color || '#64748b';
  const style     = settings?.template_style || 'classic';
  const showLogo  = settings?.show_logo !== 0 && settings?.show_logo !== false;
  const logoData  = showLogo ? (settings?.logo_data || null) : null;
  const footerText = settings?.footer_text || '';
  const headerLayout = settings?.header_layout || 'logo-left';
  const wmText    = settings?.watermark_text || '';
  const wmOpacity = settings?.watermark_opacity ?? 0.06;
  const showQR    = settings?.show_payment_qr && settings?.show_payment_qr !== 0;
  const qrUrl     = settings?.payment_qr_url || '';
  const cols      = resolveColumns(settings?.column_config);

  const escapeHTML = (s: string) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const customFieldRows = [1, 2, 3, 4]
    .map(n => ({
      label: settings?.[`custom_field_${n}_label` as keyof InvoiceSettings] as string | undefined,
      value: (invoice as any)[`custom_field_${n}`] as string | undefined,
    }))
    .filter(f => f.label && f.value)
    .map(f => `<div><div class="meta-label">${escapeHTML(f.label!)}</div><div class="meta-value">${escapeHTML(f.value!)}</div></div>`)
    .join('');

  const companyName  = company?.name || 'Company';
  const companyAddr  = [company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
  const companyEmail = company?.email || '';
  const companyPhone = company?.phone || '';

  const clientName  = client?.name || 'Client';
  const clientEmail = client?.email || '';
  const clientAddr  = [client?.address_line1, client?.address_line2, client?.city, client?.state, client?.zip].filter(Boolean).join(', ');
  const clientPhone = client?.phone || '';

  const taxAmount      = Number(invoice.tax_amount || 0);

  // Tax breakdown by rate (EU VAT Art. 226 / US mixed-rate compliance)
  const taxByRate: Record<string, { taxable: number; tax: number }> = {};
  for (const l of lineItems) {
    if ((l.row_type || 'item') !== 'item') continue;
    const override = Number(l.tax_rate_override ?? -1);
    const rate = override >= 0 ? override : Number(l.tax_rate || 0);
    if (rate <= 0) continue;
    const base = Number(l.quantity || 0) * Number(l.unit_price || 0) * (1 - (Number(l.discount_pct || 0)) / 100);
    const key = rate.toFixed(2);
    if (!taxByRate[key]) taxByRate[key] = { taxable: 0, tax: 0 };
    taxByRate[key].taxable += base;
    taxByRate[key].tax += base * (rate / 100);
  }
  const sortedRates = Object.keys(taxByRate).sort((a, b) => parseFloat(a) - parseFloat(b));
  const hasMultipleRates = sortedRates.length > 1;
  const taxBreakdownHTML = hasMultipleRates
    ? sortedRates.map(rate =>
        `<div class="totals-row"><span>Tax @ ${rate}% on ${fmt(taxByRate[rate].taxable)}</span><span>${fmt(taxByRate[rate].tax)}</span></div>`
      ).join('')
    : (taxAmount > 0
        ? `<div class="totals-row"><span>Tax</span><span>${fmt(taxAmount)}</span></div>`
        : '');

  const discountAmount = Number(invoice.discount_amount || 0);
  const amountPaid     = Number(invoice.amount_paid || 0);
  const total          = Number(invoice.total || 0);
  const balance        = total - amountPaid;
  const stamp          = getStatusStamp(invoice.status);

  const isCompact = style === 'compact';
  const baseFontSize = isCompact ? '11px' : '13px';

  // ── Font override in baseStyles ──
  const bodyFont = fontStack(settings?.font_family);
  const styledBase = baseStyles.replace(
    "font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;",
    `font-family: ${bodyFont};`
  ).replace('font-size: 13px;', `font-size: ${baseFontSize};`);

  // ── Column headers ──
  const colHeaders = cols.map(c => {
    const right = ['quantity','unit_price','tax_rate','amount'].includes(c.key);
    return `<th class="${right ? 'text-right' : ''}">${c.label}</th>`;
  }).join('');

  // ── Calculate running subtotal for subtotal rows ──
  let runningItemAmt = 0;
  let lastSubtotalAt = 0;

  // ── Line item rows (rich row types) ──
  const lineRows = lineItems.map((l, i) => {
    const rowType: LineRowType = l.row_type || 'item';
    const colSpan = cols.length;

    if (rowType === 'spacer') {
      return `<tr><td colspan="${colSpan}" style="height:16px;border:none;"></td></tr>`;
    }

    if (rowType === 'section') {
      return `<tr>
        <td colspan="${colSpan}" style="background:${secondary}22;font-weight:700;font-size:${isCompact?'10px':'11px'};
          text-transform:uppercase;letter-spacing:0.8px;color:#0f172a;padding:${isCompact?'4px 12px':'6px 12px'};border-bottom:none;">
          ${l.description || ''}
        </td>
      </tr>`;
    }

    if (rowType === 'note') {
      return `<tr>
        <td colspan="${colSpan}" style="font-style:italic;color:#64748b;font-size:${isCompact?'10px':'11px'};
          padding-left:24px;border-bottom:none;">
          ${l.description || ''}
        </td>
      </tr>`;
    }

    if (rowType === 'image') {
      const caption = l.unit_label || '';
      return `<tr>
        <td colspan="${colSpan}" style="text-align:center;padding:12px;border-bottom:none;">
          ${l.description ? `<img src="${l.description}" alt="${caption}" style="max-width:300px;max-height:180px;object-fit:contain;">` : ''}
          ${caption ? `<div style="font-size:10px;color:#64748b;margin-top:4px;">${caption}</div>` : ''}
        </td>
      </tr>`;
    }

    if (rowType === 'subtotal') {
      const subtotalAmt = lineItems
        .slice(lastSubtotalAt, i)
        .filter(r => (r.row_type || 'item') === 'item')
        .reduce((sum, r) => sum + Number(r.amount || (r.quantity || 1) * (r.unit_price || 0)), 0);
      lastSubtotalAt = i + 1;
      return `<tr style="border-top:1px solid #334155;">
        <td colspan="${colSpan - 1}" style="font-weight:700;font-size:${isCompact?'11px':'12px'};color:#0f172a;">
          ${l.description || 'Subtotal'}
        </td>
        <td class="text-right font-mono font-bold" style="color:#0f172a;">${fmt(subtotalAmt)}</td>
      </tr>`;
    }

    // ── Standard item row ──
    const rowBg = (style === 'modern' || style === 'executive') && i % 2 === 0 ? `background:${secondary}14;` : '';
    const rowPad = isCompact ? 'padding-top:4px;padding-bottom:4px;' : '';
    const lineStyleAttr = [
      (l.bold || 0) ? 'font-weight:700' : '',
      (l.italic || 0) ? 'font-style:italic' : '',
      (l.highlight_color || '') ? `background-color:${l.highlight_color}` : '',
    ].filter(Boolean).join(';');
    const discountedPrice = (() => {
      const baseAmt = Number(l.amount || (l.quantity || 1) * (l.unit_price || 0));
      if (!l.line_discount || l.line_discount === 0) return baseAmt;
      if (l.line_discount_type === 'flat') return baseAmt - Number(l.line_discount);
      return baseAmt * (1 - Number(l.line_discount) / 100);
    })();

    const cells = cols.map(c => {
      const right = ['quantity','unit_price','tax_rate','amount'].includes(c.key);
      const cls = `${right ? 'text-right font-mono' : ''} ${c.key === 'amount' ? 'font-bold' : ''}`.trim();
      let val = '';
      switch (c.key) {
        case 'item_code':    val = l.item_code ? `<span style="font-size:9px;background:#f1f5f9;padding:1px 4px;border-radius:2px;color:#64748b;">${l.item_code}</span>` : ''; break;
        case 'description':  val = l.description || ''; break;
        case 'quantity':     val = String(l.quantity ?? 1); break;
        case 'unit_label':   val = l.unit_label || ''; break;
        case 'unit_price':   val = fmt(l.unit_price || 0); break;
        case 'tax_rate':     val = l.tax_rate > 0 ? l.tax_rate + '%' : '—'; break;
        case 'amount':       val = fmt(discountedPrice); break;
      }
      return `<td class="${cls}" style="${rowPad}">${val}</td>`;
    }).join('');

    const mergedRowStyle = [rowBg, lineStyleAttr].filter(Boolean).join(';');
    return `<tr style="${mergedRowStyle}">${cells}</tr>`;
  }).join('');

  // ── Template CSS ──
  const templateStyles =
    style === 'modern' ? `
      .header { display: flex; justify-content: space-between; align-items: stretch; margin-bottom: 0; }
      .header-left { background: ${accent}; color: #fff; padding: 32px 28px; min-width: 220px; }
      .header-right { padding: 28px 28px 28px 0; flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-end; }
      .company-name { font-size: 20px; font-weight: 800; color: #fff; }
      .company-detail { font-size: 11px; color: rgba(255,255,255,0.75); margin-top: 8px; line-height: 1.6; }
      .inv-title { font-size: 32px; font-weight: 900; color: ${accent}; text-transform: uppercase; text-align: right; }
      .inv-number { font-size: 14px; color: #64748b; text-align: right; margin-top: 4px; font-weight: 700; }
      .page { padding: 0; }
      .content { padding: 32px 28px; }
      th { background: ${accent}; color: #fff !important; border-bottom: none; }
      td { border-bottom: 1px solid #e2e8f0; }
    ` : style === 'minimal' ? `
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
      .company-name { font-size: 18px; font-weight: 700; color: #0f172a; }
      .company-detail { font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.6; }
      .inv-title { font-size: 22px; font-weight: 700; color: #0f172a; text-align: right; }
      .inv-number { font-size: 12px; color: #64748b; text-align: right; margin-top: 2px; }
      .page { padding: 40px; }
      .content { padding: 0; }
      th { border-bottom: 1px solid #0f172a; }
    ` : style === 'executive' ? `
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0; }
      .header-top { background: ${accent}; padding: 24px 32px 20px; }
      .header-bottom { background: #fff; padding: 12px 32px 24px; border-bottom: 3px solid ${accent}; display: flex; justify-content: space-between; align-items: flex-end; }
      .company-name { font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
      .company-detail { font-size: 11px; color: rgba(255,255,255,0.8); margin-top: 6px; line-height: 1.7; }
      .inv-title { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: ${accent}; }
      .inv-number { font-size: 28px; font-weight: 900; color: #0f172a; }
      .page { padding: 0; }
      .content { padding: 28px 32px; }
      th { border-bottom: 2px solid ${accent}; color: ${accent} !important; }
    ` : style === 'compact' ? `
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid ${accent}; }
      .company-name { font-size: 16px; font-weight: 800; color: #0f172a; }
      .company-detail { font-size: 10px; color: #64748b; margin-top: 3px; line-height: 1.5; }
      .inv-title { font-size: 20px; font-weight: 800; color: ${accent}; text-transform: uppercase; text-align: right; }
      .inv-number { font-size: 11px; color: #64748b; text-align: right; font-weight: 600; }
      .page { padding: 28px 32px; }
      .content { padding: 0; }
      th { border-bottom: 2px solid ${accent}; color: ${accent} !important; font-size: 9px; }
      td { padding: 4px 12px; font-size: 11px; border-bottom: 1px solid #f1f5f9; }
      .meta-row { padding: 8px 12px; margin-bottom: 14px; }
      .addresses { margin-bottom: 12px; }
    ` : /* classic */ `
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; }
      .company-name { font-size: 22px; font-weight: 800; color: #0f172a; }
      .company-detail { font-size: 11px; color: #64748b; margin-top: 6px; line-height: 1.6; }
      .inv-title { font-size: 28px; font-weight: 800; color: ${accent}; text-transform: uppercase; text-align: right; }
      .inv-number { font-size: 13px; color: #64748b; text-align: right; margin-top: 4px; font-weight: 600; }
      .page { padding: 48px; }
      .content { padding: 0; }
      th { border-bottom: 2px solid ${accent}; color: ${accent} !important; }
    `;

  const logoHTML = logoData
    ? `<img src="${logoData}" alt="${companyName}" style="max-height:56px;max-width:180px;object-fit:contain;display:block;margin-bottom:8px;">`
    : '';

  // ── Header layout variants ──
  const companyBlock = `
    ${logoHTML}
    <div class="company-name">${companyName}</div>
    <div class="company-detail">
      ${companyAddr ? companyAddr + '<br>' : ''}
      ${companyEmail}${companyPhone ? ' &middot; ' + companyPhone : ''}
    </div>`;

  const invoiceTypeLabel = invoice.invoice_type === 'credit_note' ? 'Credit Note'
    : invoice.invoice_type === 'proforma' ? 'Proforma Invoice'
    : invoice.invoice_type === 'retainer' ? 'Retainer Invoice'
    : invoice.invoice_type === 'service' ? 'Service Invoice'
    : invoice.invoice_type === 'product' ? 'Invoice'
    : 'Invoice';
  const currencyLabel = invoice.currency && invoice.currency !== 'USD' ? ` (${invoice.currency})` : '';
  const shippingAmount = Number(invoice.shipping_amount || 0);

  const invBlock = `
    <div class="inv-title">${invoiceTypeLabel}${currencyLabel}</div>
    <div class="inv-number">#${invoice.invoice_number || ''}</div>
    ${invoice.po_number ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">PO# ${invoice.po_number}</div>` : ''}
    ${invoice.job_reference ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Project: ${invoice.job_reference}</div>` : ''}`;

  let headerHTML = '';
  if (style === 'executive') {
    headerHTML = `
    <div class="header-top">
      <div class="company-name">${companyName}</div>
      <div class="company-detail">
        ${companyAddr ? companyAddr + '<br>' : ''}
        ${companyEmail}${companyPhone ? ' &middot; ' + companyPhone : ''}
      </div>
    </div>
    <div class="header-bottom">
      <div>${logoHTML}</div>
      <div>
        <div class="inv-title">${invoiceTypeLabel}${currencyLabel}</div>
        <div class="inv-number">#${invoice.invoice_number || ''}</div>
        ${invoice.po_number ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">PO# ${invoice.po_number}</div>` : ''}
        ${invoice.job_reference ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Project: ${invoice.job_reference}</div>` : ''}
      </div>
    </div>`;
  } else if (style === 'modern') {
    headerHTML = `
    <div class="header">
      <div class="header-left">${companyBlock}</div>
      <div class="header-right">${invBlock}</div>
    </div>`;
  } else if (headerLayout === 'logo-center') {
    headerHTML = `
    <div style="text-align:center;margin-bottom:24px;">
      ${logoHTML}
      <div class="company-name">${companyName}</div>
      <div class="company-detail">${companyAddr ? companyAddr + '<br>' : ''}${companyEmail}${companyPhone ? ' &middot; ' + companyPhone : ''}</div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:24px;">${invBlock}</div>`;
  } else if (headerLayout === 'logo-right') {
    headerHTML = `
    <div class="header">
      <div>${invBlock}</div>
      <div>${companyBlock}</div>
    </div>`;
  } else {
    headerHTML = `
    <div class="header">
      <div>${companyBlock}</div>
      <div style="text-align:right;">${invBlock}</div>
    </div>`;
  }

  // ── Payment schedule ──
  const scheduleHTML = (() => {
    if (!paymentSchedule || paymentSchedule.length === 0) return '';
    const rows = paymentSchedule.map(m => `
      <tr>
        <td>${m.milestone_label || ''}</td>
        <td class="text-right">${fmtDate(m.due_date)}</td>
        <td class="text-right font-mono">${fmt(Number(m.amount || 0))}</td>
        <td class="text-right">${m.paid ? '<span style="color:#16a34a;font-weight:700;">PAID</span>' : '<span style="color:#64748b;">Due</span>'}</td>
      </tr>`).join('');
    return `
    <div style="margin-top:24px;">
      <div class="section-label" style="margin-bottom:8px;">Payment Schedule</div>
      <table>
        <thead><tr>
          <th>Milestone</th><th class="text-right">Due Date</th>
          <th class="text-right">Amount</th><th class="text-right">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  })();

  const qrSection = showQR && qrUrl
    ? `<div style="margin-top:20px;display:flex;align-items:center;gap:16px;">
         ${qrPlaceholder(`${qrUrl}/${invoice.invoice_number || ''}`)}
         <div style="font-size:11px;color:#64748b;">Scan to pay online</div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${invoice.invoice_number || ''}</title><style>
${styledBase}
${templateStyles}
${stamp ? statusStampCSS(stamp.color) : ''}
${wmText ? watermarkCSS(wmText, wmOpacity) : invoice.invoice_type === 'proforma' ? watermarkCSS('PROFORMA', 0.07) : ''}
.addresses { display: flex; justify-content: space-between; margin-bottom: 24px; }
.addr-block { max-width: 48%; }
.addr-name { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
.addr-detail { font-size: 12px; color: #64748b; line-height: 1.5; }
.meta-row { display: flex; gap: 36px; padding: 12px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 3px; margin-bottom: 24px; flex-wrap: wrap; }
.meta-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.8px; }
.meta-value { font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px; }
.totals { display: flex; justify-content: flex-end; margin-top: 10px; }
.totals-box { width: 280px; }
.totals-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #475569; }
.totals-row span:last-child { font-variant-numeric: tabular-nums; }
.totals-total { border-top: 2px solid ${accent}; font-weight: 800; font-size: 16px; color: #0f172a; padding-top: 10px; margin-top: 4px; }
.totals-paid { color: #16a34a; }
.totals-balance { font-weight: 700; font-size: 14px; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 4px; color: ${balance > 0.005 ? '#dc2626' : '#16a34a'}; }
.footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e2e8f0; }
.footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.footer-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.8px; margin-bottom: 4px; }
.footer-text { font-size: 11px; color: #64748b; line-height: 1.6; white-space: pre-line; }
.footer-bottom { text-align: center; margin-top: 28px; font-size: 10px; color: #64748b; }
.accent-bar { height: 4px; background: ${accent}; margin-bottom: 0; }
</style></head>
<body>
${wmText ? `<div class="watermark">${wmText}</div>` : invoice.invoice_type === 'proforma' ? '<div class="watermark">PROFORMA</div>' : ''}
${style === 'modern' ? `<div class="accent-bar"></div>` : ''}
${stamp ? `<div class="status-stamp">${stamp.label}</div>` : ''}
<div class="page">
<div class="content">
  ${headerHTML}

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
    <div><div class="meta-label">Invoice Date</div><div class="meta-value">${fmtDate(invoice.issue_date)}</div></div>
    <div><div class="meta-label">Due Date</div><div class="meta-value">${fmtDate(invoice.due_date)}</div></div>
    <div><div class="meta-label">Terms</div><div class="meta-value">${invoice.terms || 'Net 30'}</div></div>
    <div><div class="meta-label">Status</div><div class="meta-value" style="color:${stamp?.color || '#0f172a'}">${(invoice.status || 'draft').toUpperCase()}</div></div>
    ${customFieldRows}
  </div>

  <table>
    <thead><tr>${colHeaders}</tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="totals-row"><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></div>
      ${taxBreakdownHTML}
      ${discountAmount > 0 ? `<div class="totals-row" style="color:#16a34a"><span>Discount</span><span>-${fmt(discountAmount)}</span></div>` : ''}
      ${(invoice.discount_pct && invoice.discount_pct > 0) ? `<div class="totals-row" style="color:#ef4444"><span>Discount (${invoice.discount_pct}%)</span><span>-${fmt(Number(invoice.subtotal || 0) * invoice.discount_pct / 100)}</span></div>` : ''}
      ${shippingAmount > 0 ? `<div class="totals-row"><span>Shipping</span><span>${fmt(shippingAmount)}</span></div>` : ''}
      <div class="totals-row totals-total">
        <span>${invoice.invoice_type === 'credit_note' ? 'Credit Amount' : 'Total'}</span>
        <span style="${invoice.invoice_type === 'credit_note' ? 'color:#16a34a' : ''}">${invoice.invoice_type === 'credit_note' ? `(${fmt(Math.abs(total))}) CR` : fmt(total)}</span>
      </div>
      ${amountPaid > 0 && invoice.invoice_type !== 'credit_note' ? `
        <div class="totals-row totals-paid"><span>Amount Paid</span><span>${fmt(amountPaid)}</span></div>
        <div class="totals-row totals-balance"><span>Balance Due</span><span>${fmt(Math.max(0, balance))}</span></div>
      ` : ''}
    </div>
  </div>

  ${scheduleHTML}
  ${qrSection}

  ${(invoice.notes || invoice.terms_text) ? `
  <div class="footer">
    <div class="footer-grid">
      ${invoice.notes ? `<div><div class="footer-label">Notes</div><div class="footer-text">${invoice.notes}</div></div>` : ''}
      ${invoice.terms_text ? `<div><div class="footer-label">Terms &amp; Conditions</div><div class="footer-text">${invoice.terms_text}</div></div>` : ''}
    </div>
  </div>` : ''}

  <div class="footer-bottom">
    ${footerText || companyName}
    ${invoice.late_fee_pct && invoice.late_fee_pct > 0 ? `<p style="font-size:10px;color:#64748b;margin-top:8px;">A late fee of ${invoice.late_fee_pct}% per month applies after ${invoice.late_fee_grace_days || 0} days.</p>` : ''}
  </div>
</div>
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
.stub-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-top: 12px; }
.emp-row { display: flex; justify-content: space-between; padding: 12px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 2px; margin-bottom: 20px; }
.emp-name { font-size: 15px; font-weight: 700; color: #0f172a; }
.emp-meta { font-size: 11px; color: #64748b; }
.section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; margin-bottom: 8px; margin-top: 20px; }
.net-pay-box { text-align: center; padding: 20px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 2px; margin-top: 24px; }
.net-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
.net-value { font-size: 28px; font-weight: 800; color: #16a34a; margin-top: 4px; font-variant-numeric: tabular-nums; }
.net-ytd { font-size: 12px; color: #64748b; margin-top: 4px; }
.footer-co { text-align: center; margin-top: 32px; font-size: 10px; color: #64748b; }
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
.report-dates { font-size: 11px; color: #475569; margin-top: 2px; }
.footer-co { text-align: center; margin-top: 32px; font-size: 10px; color: #64748b; }
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


// ═══════════════════════════════════════════════════════════════
// DEBT PORTFOLIO REPORT
// ═══════════════════════════════════════════════════════════════
export function generateDebtPortfolioReportHTML(
  debts: any[],
  collectedYtd: number,
  company: any
): string {
  const companyName = company?.name || 'Company';
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const now = Date.now();
  const bucket = (d: any) => {
    const days = Math.floor((now - new Date(d.delinquent_date || d.created_at).getTime()) / 86_400_000);
    if (days <= 30) return '0-30';
    if (days <= 90) return '31-90';
    if (days <= 180) return '91-180';
    return '180+';
  };
  const buckets: Record<string, { count: number; amount: number }> = {
    '0-30': { count: 0, amount: 0 }, '31-90': { count: 0, amount: 0 },
    '91-180': { count: 0, amount: 0 }, '180+': { count: 0, amount: 0 },
  };
  debts.forEach(d => { const b = bucket(d); buckets[b].count++; buckets[b].amount += Number(d.balance_due || 0); });

  const totalBalance = debts.reduce((s, d) => s + Number(d.balance_due || 0), 0);
  const totalOriginal = debts.reduce((s, d) => s + Number(d.original_amount || 0), 0);
  const recoveryRate = totalOriginal > 0 ? ((collectedYtd / totalOriginal) * 100).toFixed(1) : '0.0';

  const stages: Record<string, number> = {};
  debts.forEach(d => { stages[d.current_stage || 'unknown'] = (stages[d.current_stage || 'unknown'] || 0) + 1; });

  const top10 = [...debts].sort((a, b) => Number(b.balance_due) - Number(a.balance_due)).slice(0, 10);

  const agingRows = Object.entries(buckets).map(([label, { count, amount }]) => `
    <tr>
      <td>${label} days</td>
      <td class="text-right">${count}</td>
      <td class="text-right font-mono">${fmt(amount)}</td>
      <td class="text-right text-muted">${totalBalance > 0 ? ((amount / totalBalance) * 100).toFixed(1) : '0.0'}%</td>
    </tr>`).join('');

  const stageRows = Object.entries(stages).map(([stage, count]) => `
    <tr><td style="text-transform:capitalize;">${stage.replace(/_/g, ' ')}</td><td class="text-right">${count}</td></tr>`).join('');

  const top10Rows = top10.map(d => {
    const days = Math.floor((now - new Date(d.delinquent_date || d.created_at).getTime()) / 86_400_000);
    return `<tr>
      <td>${d.debtor_name || '—'}</td>
      <td class="text-right font-mono">${fmt(Number(d.balance_due || 0))}</td>
      <td class="text-right">${days}d</td>
      <td style="text-transform:capitalize;">${(d.current_stage || '').replace(/_/g, ' ')}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Debt Portfolio Report</title><style>
${baseStyles}
.page { padding: 48px; }
.report-header { border-bottom: 3px solid #0f172a; padding-bottom: 16px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: flex-end; }
.report-title { font-size: 22px; font-weight: 800; color: #0f172a; }
.report-date { font-size: 11px; color: #64748b; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
.stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 14px 16px; }
.stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; margin-bottom: 4px; }
.stat-value { font-size: 20px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
.section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #0f172a; margin: 24px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
.text-right { text-align: right; }
.text-muted { color: #64748b; }
.font-mono { font-variant-numeric: tabular-nums; }
</style></head>
<body><div class="page">
  <div class="report-header">
    <div>
      <div class="report-title">Debt Portfolio Report</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">${companyName}</div>
    </div>
    <div class="report-date">Generated ${today}</div>
  </div>

  <div class="stats-grid">
    <div class="stat-box"><div class="stat-label">Total Accounts</div><div class="stat-value">${debts.length}</div></div>
    <div class="stat-box"><div class="stat-label">Total Balance</div><div class="stat-value">${fmt(totalBalance)}</div></div>
    <div class="stat-box"><div class="stat-label">Collected YTD</div><div class="stat-value" style="color:#16a34a">${fmt(collectedYtd)}</div></div>
    <div class="stat-box"><div class="stat-label">Recovery Rate</div><div class="stat-value">${recoveryRate}%</div></div>
  </div>

  <div class="section-title">Aging Breakdown</div>
  <table><thead><tr><th>Bucket</th><th class="text-right">Accounts</th><th class="text-right">Balance</th><th class="text-right">% of Total</th></tr></thead>
  <tbody>${agingRows}</tbody></table>

  <div class="section-title">Pipeline Stage Breakdown</div>
  <table><thead><tr><th>Stage</th><th class="text-right">Count</th></tr></thead>
  <tbody>${stageRows}</tbody></table>

  <div class="section-title">Top 10 Accounts by Balance</div>
  <table><thead><tr><th>Debtor</th><th class="text-right">Balance</th><th class="text-right">Age</th><th>Stage</th></tr></thead>
  <tbody>${top10Rows}</tbody></table>
</div></body></html>`;
}

// ═══════════════════════════════════════════════════════════════
// FORMAL DEMAND LETTER
// ═══════════════════════════════════════════════════════════════
export function generateDemandLetterHTML(
  debt: any,
  payments: any[],
  company: any,
  options: {
    deadline_days?: number;
    payment_address?: string;
    online_payment_url?: string;
    signatory_name?: string;
    signatory_title?: string;
  } = {}
): string {
  const companyName = company?.name || 'Your Company';
  const companyAddr = [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
  const deadlineDays = options.deadline_days ?? 10;
  const deadlineDate = new Date(Date.now() + deadlineDays * 86_400_000)
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const todayLong = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const fmtDateLocal = (s: string) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balanceDue = Number(debt.balance_due || 0);
  const originalAmount = Number(debt.original_amount || 0);
  const interest = Number(debt.interest_accrued || 0);
  const fees = Number(debt.fees_accrued || 0);

  const paymentRows = payments.length > 0
    ? payments.map(p => `<tr>
        <td>${fmtDateLocal(p.received_date)}</td>
        <td class="text-right font-mono">${fmt(Number(p.amount || 0))}</td>
        <td>${p.method || '—'}</td>
        <td class="text-muted">${p.reference_number || '—'}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:#64748b;font-style:italic;">No payments received</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Demand Letter — ${debt.debtor_name}</title><style>
${baseStyles}
.page { padding: 60px; max-width: 720px; margin: 0 auto; }
.letterhead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
.company-name { font-size: 20px; font-weight: 800; color: #0f172a; }
.company-addr { font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.6; }
.date-line { font-size: 12px; color: #334155; text-align: right; }
.re-block { background: #f8fafc; border-left: 4px solid #0f172a; padding: 12px 16px; margin: 28px 0; }
.re-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; }
.re-value { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 2px; }
.body-text { font-size: 12px; color: #334155; line-height: 1.8; margin-bottom: 16px; }
.balance-box { border: 2px solid #0f172a; border-radius: 4px; padding: 20px 24px; text-align: center; margin: 24px 0; }
.balance-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
.balance-amount { font-size: 36px; font-weight: 900; color: #dc2626; font-variant-numeric: tabular-nums; margin-top: 4px; }
.signature-block { margin-top: 48px; }
.sig-name { font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 32px; }
.sig-title { font-size: 12px; color: #64748b; }
.text-right { text-align: right; }
.text-muted { color: #64748b; }
.font-mono { font-variant-numeric: tabular-nums; }
</style></head>
<body><div class="page">
  <div class="letterhead">
    <div>
      <div class="company-name">${companyName}</div>
      <div class="company-addr">${companyAddr}</div>
    </div>
    <div class="date-line">${todayLong}</div>
  </div>

  <div style="margin-bottom:28px;">
    <div style="font-size:12px;color:#334155;font-weight:600;">${debt.debtor_name || 'To Whom It May Concern'}</div>
    ${debt.debtor_address ? `<div style="font-size:12px;color:#64748b;">${debt.debtor_address}</div>` : ''}
    ${debt.debtor_email ? `<div style="font-size:12px;color:#64748b;">${debt.debtor_email}</div>` : ''}
  </div>

  <div class="re-block">
    <div class="re-label">RE: Formal Demand for Payment</div>
    <div class="re-value">Account #${(debt.id || '').slice(0, 8).toUpperCase() || 'N/A'} — Balance Due: ${fmt(balanceDue)}</div>
  </div>

  <p class="body-text">Dear ${debt.debtor_name || 'Account Holder'},</p>

  <p class="body-text">
    This letter constitutes a formal demand for payment of the outstanding balance owed to <strong>${companyName}</strong>.
    Our records reflect that an account was established with an original principal of <strong>${fmt(originalAmount)}</strong>.
    Despite prior notices, this balance remains unpaid as of the date of this letter.
  </p>

  <div style="margin:20px 0;">
    <table>
      <thead><tr><th>Description</th><th class="text-right">Amount</th></tr></thead>
      <tbody>
        <tr><td>Original Principal</td><td class="text-right font-mono">${fmt(originalAmount)}</td></tr>
        ${interest > 0 ? `<tr><td>Accrued Interest</td><td class="text-right font-mono">${fmt(interest)}</td></tr>` : ''}
        ${fees > 0 ? `<tr><td>Fees &amp; Charges</td><td class="text-right font-mono">${fmt(fees)}</td></tr>` : ''}
        ${totalPaid > 0 ? `<tr><td style="color:#16a34a;">Payments Received</td><td class="text-right font-mono" style="color:#16a34a;">-${fmt(totalPaid)}</td></tr>` : ''}
      </tbody>
    </table>
  </div>

  ${payments.length > 0 ? `
  <div class="section-title" style="margin-top:20px;margin-bottom:8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#0f172a;">Payment History</div>
  <table>
    <thead><tr><th>Date</th><th class="text-right">Amount</th><th>Method</th><th>Reference</th></tr></thead>
    <tbody>${paymentRows}</tbody>
  </table>` : ''}

  <div class="balance-box">
    <div class="balance-label">Total Amount Now Due</div>
    <div class="balance-amount">${fmt(balanceDue)}</div>
  </div>

  <p class="body-text">
    <strong>You are hereby demanded to remit payment in full no later than ${deadlineDate}.</strong>
    ${options.payment_address ? ` Payment by check should be made payable to <strong>${companyName}</strong> and mailed to: <strong>${options.payment_address}</strong>.` : ''}
    ${options.online_payment_url ? ` Payment may also be submitted online at: <strong>${options.online_payment_url}</strong>.` : ''}
  </p>

  <p class="body-text">
    Failure to remit payment by the deadline may result in escalated collection activity, referral to a collection agency,
    reporting to credit bureaus, and/or legal action to recover the full amount owed, including court costs and attorney fees
    as permitted by applicable law.
  </p>

  <p class="body-text">
    If you believe this amount is in error or wish to discuss a payment arrangement, please contact us immediately at
    ${company?.email || 'our office'} or ${company?.phone || 'the number on file'}.
  </p>

  <div class="signature-block">
    <p class="body-text">Sincerely,</p>
    <div class="sig-name">${options.signatory_name || companyName}</div>
    <div class="sig-title">${options.signatory_title || 'Accounts Receivable'}</div>
    <div style="font-size:12px;color:#64748b;margin-top:2px;">${companyName}</div>
  </div>
</div></body></html>`;
}


// ═══════════════════════════════════════════════════════════════
// COLLECTION LETTER GENERATOR (multiple letter types)
// ═══════════════════════════════════════════════════════════════
export function generateCollectionLetterHTML(
  debt: any,
  payments: any[],
  company: any,
  letterType: string,
): string {
  const companyName = company?.name || 'Your Company';
  const companyAddr = [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
  const companyPhone = company?.phone || '';
  const companyEmail = company?.email || '';
  const todayLong = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmtAmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);
  const debtorName = debt?.debtor_name || 'Account Holder';
  const debtorAddr = debt?.debtor_address || '';
  const balanceDue = debt?.balance_due || 0;
  const originalAmt = debt?.original_amount || 0;
  const interestAmt = debt?.interest_accrued || 0;
  const feesAmt = debt?.fees_accrued || 0;
  const dueDate = debt?.due_date ? new Date(debt.due_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const totalPaid = payments?.reduce((s: number, p: any) => s + (p.amount || 0), 0) || 0;
  const deadlineDate = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const thirtyDayDate = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const summaryTable = `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:12px;">
  <tr><td style="padding:6px 12px;border:1px solid #ddd;">Original Amount</td><td style="padding:6px 12px;border:1px solid #ddd;text-align:right;font-family:monospace;">${fmtAmt(originalAmt)}</td></tr>
  <tr><td style="padding:6px 12px;border:1px solid #ddd;">Interest</td><td style="padding:6px 12px;border:1px solid #ddd;text-align:right;font-family:monospace;">${fmtAmt(interestAmt)}</td></tr>
  <tr><td style="padding:6px 12px;border:1px solid #ddd;">Fees</td><td style="padding:6px 12px;border:1px solid #ddd;text-align:right;font-family:monospace;">${fmtAmt(feesAmt)}</td></tr>
  <tr><td style="padding:6px 12px;border:1px solid #ddd;">Payments</td><td style="padding:6px 12px;border:1px solid #ddd;text-align:right;font-family:monospace;color:#16a34a;">-${fmtAmt(totalPaid)}</td></tr>
  <tr style="font-weight:700;"><td style="padding:8px 12px;border:2px solid #111;">Balance Due</td><td style="padding:8px 12px;border:2px solid #111;text-align:right;font-family:monospace;">${fmtAmt(balanceDue)}</td></tr>
</table>`;

  const LETTERS: Record<string, { title: string; accent: string; body: string }> = {
    reminder: {
      title: 'Payment Reminder',
      accent: '#2563eb',
      body: `<p>This is a friendly reminder that your account has a past-due balance of <strong>${fmtAmt(balanceDue)}</strong> (due ${dueDate}).</p>
<p>Please remit payment at your earliest convenience. If you have already sent payment, please disregard this notice.</p>
<p>Contact us at ${companyPhone || companyEmail || 'the number on file'} for questions or payment arrangements.</p>`,
    },
    warning: {
      title: 'Warning Notice',
      accent: '#d97706',
      body: `<p>Despite prior correspondence, your account remains past due.</p>${summaryTable}
<p>Please pay by <strong>${thirtyDayDate}</strong> to avoid further collection activity, additional fees, and potential credit reporting.</p>`,
    },
    final_notice: {
      title: 'Final Notice Before Legal Action',
      accent: '#dc2626',
      body: `<p><strong style="color:#dc2626;">THIS IS YOUR FINAL NOTICE.</strong></p>
<p>Your account has a delinquent balance of <strong>${fmtAmt(balanceDue)}</strong>.</p>
<p>Unless payment or a satisfactory arrangement is received by <strong>${deadlineDate}</strong>, we will pursue collections agency referral, credit bureau reporting, and/or legal action including civil complaint and garnishment.</p>${summaryTable}`,
    },
    demand: {
      title: 'Demand for Payment',
      accent: '#111',
      body: `<p>This constitutes a formal demand for payment of <strong>${fmtAmt(balanceDue)}</strong> owed to ${companyName}.</p>
<p>The debt arises from an obligation of <strong>${fmtAmt(originalAmt)}</strong> (due ${dueDate}), plus interest and fees.</p>${summaryTable}
<p>Pay within <strong>ten (10) days</strong> of this letter or ${companyName} will commence legal proceedings. Under the FDCPA, you may dispute this debt in writing within 30 days.</p>`,
    },
    settlement_offer: {
      title: 'Settlement Offer',
      accent: '#0891b2',
      body: `<p>To resolve your outstanding balance of <strong>${fmtAmt(balanceDue)}</strong>, ${companyName} offers a settlement of <strong>${fmtAmt(balanceDue * 0.7)}</strong> (70%) as payment in full, if received by <strong>${thirtyDayDate}</strong>.</p>${summaryTable}
<p>This offer expires on ${thirtyDayDate}. After that date, the full balance remains due.</p>`,
    },
    payment_confirmation: {
      title: 'Payment Confirmation',
      accent: '#16a34a',
      body: `<p>Thank you for your payment${totalPaid > 0 ? ' of <strong>' + fmtAmt(totalPaid) + '</strong>' : ''}.</p>${summaryTable}
${balanceDue <= 0 ? '<p>Your account is <strong>paid in full</strong>. Thank you.</p>' : '<p>A remaining balance of <strong>' + fmtAmt(balanceDue) + '</strong> is still due.</p>'}`,
    },
  };

  const letter = LETTERS[letterType] || LETTERS.reminder;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Georgia,serif; font-size:13px; color:#111; background:#fff; padding:48px; line-height:1.7; }
  .page { max-width:700px; margin:0 auto; }
  .hdr { border-bottom:3px solid ${letter.accent}; padding-bottom:20px; margin-bottom:32px; }
  .co { font-size:20px; font-weight:700; color:${letter.accent}; }
  .co-info { font-size:11px; color:#555; margin-top:4px; }
  .dt { text-align:right; font-size:12px; color:#555; margin-bottom:24px; }
  .addr { margin-bottom:24px; font-size:12px; line-height:1.6; }
  .ttl { font-size:16px; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:${letter.accent}; border-bottom:1px solid #ddd; padding-bottom:8px; margin-bottom:20px; }
  .bd p { margin-bottom:12px; } .bd ul { margin:12px 0; padding-left:24px; }
  .sig { margin-top:40px; }
  .sl { width:200px; border-top:1px solid #333; margin-top:48px; padding-top:4px; }
  .ft { border-top:1px solid #ddd; margin-top:40px; padding-top:12px; text-align:center; font-size:10px; color:#555; }
  @media print { body { padding:0; } }
</style></head><body>
<div class="page">
  <div class="hdr"><div class="co">${companyName}</div><div class="co-info">${companyAddr}${companyPhone ? ' · ' + companyPhone : ''}${companyEmail ? ' · ' + companyEmail : ''}</div></div>
  <div class="dt">${todayLong}</div>
  <div class="addr"><strong>${debtorName}</strong><br>${debtorAddr || '—'}</div>
  <div class="ttl">${letter.title}</div>
  <div class="bd"><p>Dear ${debtorName},</p>${letter.body}</div>
  <div class="sig"><p>Sincerely,</p><div class="sl"><strong>${companyName}</strong><br><span style="font-size:11px;color:#555;">Collections Department</span></div></div>
  <div class="ft">This is an attempt to collect a debt. Any information obtained will be used for that purpose.<br>${companyName} · ${todayLong}</div>
</div></body></html>`;
}


// ═══════════════════════════════════════════════════════════════
// EXPENSE DETAIL REPORT
// ═══════════════════════════════════════════════════════════════
export function generateExpenseReportHTML(
  expenses: Array<{
    date: string;
    description: string;
    vendor_name: string;
    category_name: string;
    amount: number;
    tax_amount: number;
    status: string;
    line_items?: Array<{
      description: string;
      quantity: number;
      unit_price: number;
      amount: number;
    }>;
  }>,
  companyName: string,
  dateRange: string,
  groupBy: string
): string {
  const grandTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      paid: '#16a34a', approved: '#16a34a', pending: '#d97706',
      rejected: '#dc2626', draft: '#94a3b8',
    };
    const c = colors[status?.toLowerCase()] || '#64748b';
    return `<span style="font-size:10px;font-weight:600;color:${c};text-transform:uppercase;letter-spacing:0.5px;">${status || '—'}</span>`;
  };

  const expenseRows = expenses.map(e => {
    const mainRow = `<tr>
      <td>${fmtDate(e.date)}</td>
      <td>${e.description || '—'}</td>
      <td>${e.vendor_name || '—'}</td>
      <td>${e.category_name || '—'}</td>
      <td class="text-right font-mono">${fmt(Number(e.amount) || 0)}</td>
      <td>${statusBadge(e.status)}</td>
    </tr>`;

    const lineItemRows = e.line_items && e.line_items.length > 0
      ? `<tr><td colspan="6" style="padding:0 0 0 32px;">
          <table style="width:100%;margin:4px 0 8px;">
            <thead><tr>
              <th style="font-size:9px;border-bottom:1px solid #e2e8f0;padding:4px 8px;">Description</th>
              <th style="font-size:9px;border-bottom:1px solid #e2e8f0;padding:4px 8px;text-align:right;">Qty</th>
              <th style="font-size:9px;border-bottom:1px solid #e2e8f0;padding:4px 8px;text-align:right;">Unit Price</th>
              <th style="font-size:9px;border-bottom:1px solid #e2e8f0;padding:4px 8px;text-align:right;">Amount</th>
            </tr></thead>
            <tbody>
              ${e.line_items.map(li => `<tr style="background:#f8fafc;">
                <td style="padding:3px 8px;font-size:11px;color:#475569;border-bottom:1px solid #f1f5f9;">${li.description || '—'}</td>
                <td style="padding:3px 8px;font-size:11px;color:#475569;text-align:right;border-bottom:1px solid #f1f5f9;">${li.quantity}</td>
                <td style="padding:3px 8px;font-size:11px;color:#475569;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #f1f5f9;">${fmt(Number(li.unit_price) || 0)}</td>
                <td style="padding:3px 8px;font-size:11px;color:#475569;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #f1f5f9;">${fmt(Number(li.amount) || 0)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </td></tr>`
      : '';

    return mainRow + lineItemRows;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${baseStyles}
.report { padding: 48px; }
.report-header { text-align: center; margin-bottom: 28px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
.report-company { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #0f172a; }
.report-title { font-size: 12px; color: #475569; margin-top: 4px; }
.report-dates { font-size: 11px; color: #475569; margin-top: 2px; }
.footer-co { text-align: center; margin-top: 32px; font-size: 10px; color: #64748b; }
@media print { .report { padding: 0; } tr { page-break-inside: avoid; } }
</style></head>
<body>
<div class="report">
  <div class="report-header">
    <div class="report-company">${companyName}</div>
    <div class="report-title">Expense Detail Report</div>
    <div class="report-dates">${dateRange}</div>
    ${groupBy && groupBy !== 'none' ? `<div style="font-size:11px;color:#475569;margin-top:2px;">Grouped by: ${groupBy}</div>` : ''}
  </div>

  <table>
    <thead><tr>
      <th>Date</th>
      <th>Description</th>
      <th>Vendor</th>
      <th>Category</th>
      <th class="text-right">Amount</th>
      <th>Status</th>
    </tr></thead>
    <tbody>${expenseRows}</tbody>
  </table>

  <div style="margin-top:24px;padding-top:16px;border-top:2px solid #0f172a;">
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
      <span style="font-weight:700;color:#0f172a;">Grand Total</span>
      <span style="font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;">${fmt(grandTotal)}</span>
    </div>
  </div>

  <div class="footer-co">${companyName}</div>
</div>
</body></html>`;
}
