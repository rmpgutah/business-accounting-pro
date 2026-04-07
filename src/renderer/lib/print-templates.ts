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
  .text-muted { color: #94a3b8; }
  .text-dark { color: #0f172a; }
  .text-green { color: #16a34a; }
  .text-red { color: #dc2626; }
  .section-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    color: #94a3b8; letter-spacing: 0.8px; margin-bottom: 6px;
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

  const companyName  = company?.name || 'Company';
  const companyAddr  = [company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
  const companyEmail = company?.email || '';
  const companyPhone = company?.phone || '';

  const clientName  = client?.name || 'Client';
  const clientEmail = client?.email || '';
  const clientAddr  = [client?.address_line1, client?.address_line2, client?.city, client?.state, client?.zip].filter(Boolean).join(', ');
  const clientPhone = client?.phone || '';

  const taxAmount      = Number(invoice.tax_amount || 0);
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
        <td colspan="${colSpan}" style="font-style:italic;color:#94a3b8;font-size:${isCompact?'10px':'11px'};
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
          ${caption ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px;">${caption}</div>` : ''}
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

    return `<tr style="${rowBg}">${cells}</tr>`;
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
      .company-detail { font-size: 11px; color: #94a3b8; margin-top: 4px; line-height: 1.6; }
      .inv-title { font-size: 22px; font-weight: 700; color: #0f172a; text-align: right; }
      .inv-number { font-size: 12px; color: #94a3b8; text-align: right; margin-top: 2px; }
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

  const invBlock = `
    <div class="inv-title">Invoice</div>
    <div class="inv-number">#${invoice.invoice_number || ''}</div>`;

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
        <div class="inv-title">Invoice</div>
        <div class="inv-number">#${invoice.invoice_number || ''}</div>
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
        <td class="text-right">${m.paid ? '<span style="color:#16a34a;font-weight:700;">PAID</span>' : '<span style="color:#94a3b8;">Due</span>'}</td>
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
${wmText ? watermarkCSS(wmText, wmOpacity) : ''}
.addresses { display: flex; justify-content: space-between; margin-bottom: 24px; }
.addr-block { max-width: 48%; }
.addr-name { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
.addr-detail { font-size: 12px; color: #64748b; line-height: 1.5; }
.meta-row { display: flex; gap: 36px; padding: 12px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 3px; margin-bottom: 24px; flex-wrap: wrap; }
.meta-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; }
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
.footer-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; margin-bottom: 4px; }
.footer-text { font-size: 11px; color: #64748b; line-height: 1.6; white-space: pre-line; }
.footer-bottom { text-align: center; margin-top: 28px; font-size: 10px; color: #cbd5e1; }
.accent-bar { height: 4px; background: ${accent}; margin-bottom: 0; }
</style></head>
<body>
${wmText ? `<div class="watermark">${wmText}</div>` : ''}
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
  </div>

  <table>
    <thead><tr>${colHeaders}</tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="totals-row"><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></div>
      ${taxAmount > 0 ? `<div class="totals-row"><span>Tax</span><span>${fmt(taxAmount)}</span></div>` : ''}
      ${discountAmount > 0 ? `<div class="totals-row" style="color:#16a34a"><span>Discount</span><span>-${fmt(discountAmount)}</span></div>` : ''}
      <div class="totals-row totals-total"><span>Total</span><span>${fmt(total)}</span></div>
      ${amountPaid > 0 ? `
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

  <div class="footer-bottom">${footerText || companyName}</div>
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
.stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 4px; }
.stat-value { font-size: 20px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
.section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #0f172a; margin: 24px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
.text-right { text-align: right; }
.text-muted { color: #94a3b8; }
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
