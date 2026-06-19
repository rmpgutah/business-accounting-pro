/**
 * Print Template Generators
 * Produces self-contained HTML strings for invoices, pay stubs, and reports.
 * Light theme, professional layout, inline CSS, print-optimized.
 */

import QRCode from 'qrcode';
import {
  classicStyles,
  docFrame,
  docHeader,
  metaStrip,
  boxRow,
  ruledTable,
  totalsBox,
  footerBar,
  logoImg,
  esc as cesc,
  type RuledColumn,
} from './classic-styles';

// ─── HTML escape helper (XSS prevention) ────────────────────
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── CSS string escape helper ───────────────────────────────
// For interpolating untrusted text inside a CSS `content: "..."` string.
// Backslash MUST be escaped first (otherwise escaping `"` is incomplete and a
// stray `\` could break out), then quotes, then newlines (illegal in CSS strings).
function escCss(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, ' ');
}

// ─── Client Portal URL Builder ───────────────────────────────
// Constructs the deep-link a recipient sees on the QR code / email.
// Three URL conventions are supported so admins can repoint the portal
// without recompiling the template:
//
//   1. Template placeholder:  https://example.com/x/{token}
//      → token is substituted at the {token} marker
//   2. Login-style URL:       https://example.com/client/login
//      → token is appended as ?invoice=<token> query param so the
//        portal can route the recipient to the correct invoice after
//        successful login
//   3. Legacy path-style:     https://example.com/portal
//      → token is appended as /<token>
//
// Default base: https://rmpgutahps.us/client/login (RMPG Pro Services
// portal). Override per-tenant via InvoiceSettings.portal_base_url.
export const DEFAULT_PORTAL_BASE = 'https://rmpgutahps.us/client/login';
export function buildPortalUrl(base: string | null | undefined, token: string): string {
  const url = (base || DEFAULT_PORTAL_BASE).trim();
  if (!url) return '';
  if (url.includes('{token}')) return url.replace(/\{token\}/g, token);
  const noTrail = url.replace(/\/$/, '');
  if (/\/login$/i.test(noTrail)) return `${noTrail}?invoice=${encodeURIComponent(token)}`;
  return `${noTrail}/${token}`;
}

// ─── Payment Method Formatter ─────────────────────────────────
// Mirrors src/renderer/lib/format.ts → formatPaymentMethod. Print templates
// can't import from the React/Vite side, so the map is duplicated here. Keep
// the two in sync when adding methods.
const PRINT_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', check: 'Check', credit_card: 'Credit Card', debit_card: 'Debit Card',
  bank_transfer: 'Bank Transfer', ach: 'ACH', wire: 'Wire Transfer', wire_transfer: 'Wire Transfer',
  paypal: 'PayPal', venmo: 'Venmo', zelle: 'Zelle', apple_pay: 'Apple Pay', google_pay: 'Google Pay',
  stripe: 'Stripe', square: 'Square', cashapp: 'Cash App', money_order: 'Money Order',
  cashiers_check: "Cashier's Check", gift_card: 'Gift Card', store_credit: 'Store Credit', other: 'Other',
};
function formatPaymentMethod(value: string | null | undefined): string {
  if (!value) return '—';
  const key = String(value).toLowerCase().trim();
  if (PRINT_PAYMENT_METHOD_LABELS[key]) return PRINT_PAYMENT_METHOD_LABELS[key];
  // Fallback: humanize raw snake_case so unmapped values never leak underscores.
  return String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Currency Formatter ──────────────────────────────────────
// formatCurrency guards against Infinity/NaN/non-finite values that would
// otherwise render as "$NaN" or "$∞" in customer-facing PDFs.
//
// Multi-currency: pass an ISO 4217 code (USD, EUR, GBP, CAD, AUD, JPY,
// MXN, INR, CHF, NZD, CNY, etc.) and Intl.NumberFormat will resolve the
// correct symbol and minor-unit precision automatically (JPY → 0
// decimals, USD/EUR/GBP → 2 decimals, BHD → 3 decimals).
const SUPPORTED_CURRENCIES = new Set([
  'USD','EUR','GBP','CAD','AUD','NZD','JPY','CNY','INR','MXN','CHF','SEK',
  'NOK','DKK','HKD','SGD','ZAR','BRL','RUB','PLN','TRY','AED','SAR','ILS',
]);
function safeCurrencyCode(code: string | null | undefined): string {
  const c = (code || '').toString().trim().toUpperCase();
  return SUPPORTED_CURRENCIES.has(c) ? c : 'USD';
}
export function formatCurrency(
  n: number | string | null | undefined,
  currency?: string | null,
): string {
  const num = typeof n === 'number' ? n : Number(n ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  const code = safeCurrencyCode(currency);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: code, minimumFractionDigits: undefined,
    }).format(safe);
  } catch {
    // Fallback if an unsupported code somehow slipped through
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    }).format(safe);
  }
}
// Accounting-style negatives: -1234.56 → "(1,234.56)"
export function formatAccountingAmount(
  n: number | string | null | undefined,
  currency?: string | null,
): string {
  const num = typeof n === 'number' ? n : Number(n ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  if (safe < 0) {
    const positive = formatCurrency(Math.abs(safe), currency);
    return `(${positive})`;
  }
  return formatCurrency(safe, currency);
}
const fmt = formatCurrency;

const fmtDate = (d: string) => {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return d; }
};

// ─── Shared report header builder ──────────────────────────
// Modernized: gradient accent bar above the header, larger document title
// chip with subtle accent, and an optional dateRange prefix.
function reportHeader(companyName: string, docTitle: string, dateRange?: string): string {
  return `<div class="accent-bar"></div>
  <div class="rpt-hdr" style="border-bottom-color: var(--ink); padding-bottom: 18px; margin-bottom: 24px;">
    <div>
      <div class="rpt-co" style="font-size: 22px; letter-spacing: -0.4px;">${esc(companyName)}</div>
      ${dateRange ? `<div class="rpt-co-sub" style="font-size: 11px; color: var(--ink-faint); margin-top: 4px; font-weight: 500;">${esc(dateRange)}</div>` : ''}
    </div>
    <div class="rpt-badge" style="border-color: var(--ink); color: var(--ink); padding: 7px 16px; letter-spacing: 1.4px; font-size: 11px; background: var(--paper); -webkit-print-color-adjust: exact; print-color-adjust: exact;">${esc(docTitle)}</div>
  </div>`;
}

function reportFooter(companyName: string): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `<div class="rpt-footer" style="border-top-color: var(--rule-strong); padding-top: 12px; margin-top: 32px; font-size: 9px;">
    <span style="font-weight: 600; color: var(--ink-muted);">${esc(companyName)}</span>
    <span style="color: var(--ink-faintest);">Generated ${date}</span>
  </div>`;
}

// ─── Stacked horizontal allocation bar helper ───
function stackedBar(
  segments: Array<{ value: number; color: string; label: string }>,
  height = 12,
): string {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return '';
  const segs = segments.filter(s => s.value > 0).map(s => {
    const pct = (s.value / total) * 100;
    return `<div title="${esc(s.label)}: ${pct.toFixed(1)}%" style="width:${pct.toFixed(2)}%;background:${s.color};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>`;
  }).join('');
  const legend = segments.filter(s => s.value > 0).map(s => {
    const pct = (s.value / total) * 100;
    return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><span style="display:inline-block;width:8px;height:8px;background:${s.color};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>${esc(s.label)} ${pct.toFixed(0)}%</span>`;
  }).join('');
  return `<div style="display:flex;height:${height}px;width:100%;border:1px solid #e2e8f0;border-radius:2px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${segs}</div>
    <div style="font-size:9px;color:#475569;margin-top:4px;">${legend}</div>`;
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
  // Font picker — one of FONT_OPTIONS.id values.
  // Kept as `string` rather than a union literal so future additions
  // to FONT_OPTIONS don't require updating this signature.
  font_family?: string;
  header_layout?: 'logo-left' | 'logo-center' | 'logo-right';
  column_config?: InvoiceColumnConfig[] | string;
  payment_qr_url?: string;       // legacy: arbitrary payment URL prefix
  show_payment_qr?: boolean | number;
  portal_base_url?: string;       // overrides default https://rmpgutahps.us/client/login (supports {token} placeholder, /login query-mode, or legacy /portal path-mode)
  // ── P1.4: Custom Letterhead ────────────────────────────
  // Wider banner image (full page-width, vs logo_data which is constrained).
  // 'top'     — banner above the existing header (additive)
  // 'replace' — banner IS the header (no co-name text rendered)
  // 'bottom'  — banner above the page footer (footer-style)
  letterhead_data?: string | null;
  letterhead_position?: 'top' | 'replace' | 'bottom';
  letterhead_height?: number;     // pixels; default 90
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
  { key: 'tax_amount',  label: 'Tax Amount',  visible: true,  order: 6 },
  { key: 'amount',      label: 'Amount',      visible: true,  order: 7 },
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

// ─── Font Picker ─────────────────────────────────────────────
// All 10 options use SYSTEM-AVAILABLE typefaces — no remote @font-face
// loading. PDFs generated by Electron's headless Chromium will render
// reliably without an internet connection. Stacks degrade gracefully
// across macOS, Windows, and Linux print servers.
//
// Each entry: { id, label, stack, sample }
// `stack` is the CSS font-family value, `sample` is a one-word label
// the picker UI uses for the visual preview swatch.
// @deprecated — output is always Arial (classic theme). Generated documents
// no longer honor `settings.font_family`; this list is retained only so the
// settings UI's (now inert) font picker keeps compiling.
export const FONT_OPTIONS: Array<{ id: string; label: string; stack: string; category: 'sans' | 'serif' | 'mono' }> = [
  { id: 'system',    label: 'System Default',     stack: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", category: 'sans' },
  { id: 'inter',     label: 'Inter (Modern Sans)', stack: "'Inter', 'Segoe UI', Helvetica, Arial, sans-serif", category: 'sans' },
  { id: 'helvetica', label: 'Helvetica',          stack: "'Helvetica Neue', Helvetica, Arial, sans-serif", category: 'sans' },
  { id: 'arial',     label: 'Arial',              stack: "Arial, Helvetica, sans-serif", category: 'sans' },
  { id: 'verdana',   label: 'Verdana (Readable)', stack: "Verdana, Geneva, sans-serif", category: 'sans' },
  { id: 'calibri',   label: 'Calibri',            stack: "Calibri, Candara, 'Segoe UI', Optima, Arial, sans-serif", category: 'sans' },
  { id: 'georgia',   label: 'Georgia (Elegant)',  stack: "Georgia, 'Times New Roman', serif", category: 'serif' },
  { id: 'times',     label: 'Times New Roman',    stack: "'Times New Roman', Times, serif", category: 'serif' },
  { id: 'palatino',  label: 'Palatino (Humanist)', stack: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif", category: 'serif' },
  { id: 'garamond',  label: 'Garamond (Classic)', stack: "Garamond, 'EB Garamond', 'Cormorant Garamond', Georgia, serif", category: 'serif' },
  { id: 'mono',      label: 'Mono (Menlo)',       stack: "Menlo, Consolas, 'Courier New', Courier, monospace", category: 'mono' },
];

// ─── QR Code Generator (synchronous SVG render from qrcode.create()) ──
// Uses qrcode's sync .create() to get the raw module matrix, then renders
// inline SVG ourselves. This avoids making the entire template chain
// async (qrcode.toString() returns a Promise).
function generateQRSVG(text: string, sizePx: number = 100): string {
  if (!text) return '';
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const moduleCount = qr.modules.size;
    const data = qr.modules.data;
    // 4-module quiet zone per QR spec
    const quietZone = 4;
    const totalCells = moduleCount + quietZone * 2;
    const cellSize = sizePx / totalCells;
    const offset = quietZone * cellSize;

    let rects = '';
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (data[r * moduleCount + c]) {
          const x = (offset + c * cellSize).toFixed(2);
          const y = (offset + r * cellSize).toFixed(2);
          const s = cellSize.toFixed(2);
          rects += `<rect x="${x}" y="${y}" width="${s}" height="${s}"/>`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}" shape-rendering="crispEdges"><rect width="${sizePx}" height="${sizePx}" fill="#ffffff"/><g fill="#0f172a">${rects}</g></svg>`;
  } catch {
    return ''; // Graceful degrade — no QR rather than broken PDF
  }
}

export function generateInvoiceHTML(
  invoice: any,
  company: any,
  client: any,
  lineItems: any[],
  settings?: InvoiceSettings,
  paymentSchedule?: any[]
): string {
  // ── Multi-currency: shadow module-level `fmt` with a currency-bound
  // version so every dollar amount in this invoice renders in its
  // declared currency (USD, EUR, GBP, JPY, etc.). Zero call-site
  // migration needed — JS closure scoping rebinds all references.
  const docCurrency = invoice.currency || 'USD';
  const fmt = (v: number | string | null | undefined) => formatCurrency(v, docCurrency);

  // ── CLASSIC THEME: output is always Arial + pure black/white. The
  // per-invoice accent/secondary/font/template_style settings are
  // intentionally ignored for presentation — only structural/feature
  // settings (logo, watermark text, QR, columns, custom fields) are honored.
  const showLogo  = settings?.show_logo !== 0 && settings?.show_logo !== false;
  const logoData  = showLogo ? (settings?.logo_data || null) : null;
  const footerText = settings?.footer_text || '';
  const wmText    = settings?.watermark_text || '';
  const showQR    = settings?.show_payment_qr && settings?.show_payment_qr !== 0;
  const qrUrl     = settings?.payment_qr_url || '';
  const cols      = resolveColumns(settings?.column_config);

  // Custom fields (1-4) → classic meta-strip cells appended after the
  // standard meta cells. Only populated (label + value) pairs are shown.
  const customFieldCells = [1, 2, 3, 4]
    .map(n => ({
      label: settings?.[`custom_field_${n}_label` as keyof InvoiceSettings] as string | undefined,
      value: (invoice as any)[`custom_field_${n}`] as string | undefined,
    }))
    .filter(f => f.label && f.value)
    .map(f => ({ label: String(f.label), value: String(f.value) }));

  const companyName  = esc(company?.name || 'Company');
  const companyAddr  = esc([company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip].filter(Boolean).join(', '));
  const companyEmail = esc(company?.email || '');
  const companyPhone = esc(company?.phone || '');

  const clientName  = esc(client?.name || 'Client');
  const clientEmail = esc(client?.email || '');
  const clientAddr  = esc([client?.address_line1, client?.address_line2, client?.city, client?.state, client?.zip].filter(Boolean).join(', '));
  const clientPhone = esc(client?.phone || '');

  const taxAmount      = Number(invoice.tax_amount || 0);

  // MATH: Single source of truth for per-line discounted base — applies BOTH
  // `discount_pct` (the active form field) AND `line_discount` (legacy /
  // import-only field) so the per-line Amount column reconciles with the
  // totals box regardless of which discount field is populated.
  const lineDiscountedBase = (l: any): number => {
    const base = Number(l.quantity || 0) * Number(l.unit_price || 0);
    const afterPct = base * (1 - (Number(l.discount_pct || 0)) / 100);
    if (!l.line_discount || Number(l.line_discount) <= 0) return afterPct;
    return l.line_discount_type === 'flat'
      ? Math.max(0, afterPct - Number(l.line_discount))
      : afterPct * (1 - Number(l.line_discount) / 100);
  };
  const lineEffectiveRate = (l: any): number => {
    const override = Number(l.tax_rate_override ?? -1);
    return override >= 0 ? override : Number(l.tax_rate || 0);
  };

  // Tax breakdown by rate (EU VAT Art. 226 / US mixed-rate compliance)
  const taxByRate: Record<string, { taxable: number; tax: number }> = {};
  for (const l of lineItems) {
    if ((l.row_type || 'item') !== 'item') continue;
    const rate = lineEffectiveRate(l);
    if (rate <= 0) continue;
    // MATH: round per-line so taxByRate sums match the per-line column sums.
    const base = Math.round(lineDiscountedBase(l) * 100) / 100;
    const key = rate.toFixed(2);
    if (!taxByRate[key]) taxByRate[key] = { taxable: 0, tax: 0 };
    taxByRate[key].taxable = Math.round((taxByRate[key].taxable + base) * 100) / 100;
    taxByRate[key].tax = Math.round((taxByRate[key].tax + Math.round(base * (rate / 100) * 100) / 100) * 100) / 100;
  }
  const sortedRates = Object.keys(taxByRate).sort((a, b) => parseFloat(a) - parseFloat(b));
  const hasMultipleRates = sortedRates.length > 1;
  // Tax breakdown rows for the classic totals box. Multi-rate → one row per
  // rate (EU VAT Art. 226 / US mixed-rate compliance); single rate → one
  // "Tax" row. Tax always shows on non-quote documents (even $0.00) so the
  // record is auditable — a reader can tell tax was zero vs. accidentally omitted.
  const taxTotalRows: { label: string; value: string }[] = hasMultipleRates
    ? sortedRates.map(rate => ({
        label: `Tax @ ${rate}% on ${fmt(taxByRate[rate].taxable)}`,
        value: fmt(taxByRate[rate].tax),
      }))
    : ((invoice.invoice_type === 'quote' || invoice.document_type === 'quote') && taxAmount <= 0 ? [] : [{ label: `Tax${invoice.tax_inclusive ? ' (incl.)' : ''}`, value: fmt(taxAmount) }]);

  const discountAmount = Number(invoice.discount_amount || 0);
  const amountPaid     = Number(invoice.amount_paid || 0);
  const total          = Number(invoice.total || 0);
  const balance        = total - amountPaid;

  // ── Classic ruled-table columns (drives both the <thead> and the
  // per-row cell mapping below). Numeric columns right-align. ──
  const numericKeys = ['quantity', 'unit_price', 'tax_rate', 'tax_amount', 'amount'];
  const tableColumns: RuledColumn[] = cols.map(c => ({
    label: c.label,
    align: numericKeys.includes(c.key) ? 'right' : 'left',
  }));
  const colSpan = cols.length;

  // ── Calculate running subtotal for subtotal rows ──
  let lastSubtotalAt = 0;

  // ── Line item rows (rich row types) ──
  // Each entry is a complete <tr> string (classic styling). Special row
  // types (section/note/spacer/image/subtotal) span all columns; standard
  // item rows map onto the resolved `cols`. Cell text is escaped here
  // because we emit raw <td> markup (matching ruledTable's contract).
  const lineRows = lineItems.map((l, i) => {
    const rowType: LineRowType = l.row_type || 'item';

    if (rowType === 'spacer') {
      return `<tr><td colspan="${colSpan}" style="height:14px;border:none;"></td></tr>`;
    }

    if (rowType === 'section') {
      return `<tr>
        <td colspan="${colSpan}" style="background:#000;color:#fff;font-weight:bold;font-size:10px;
          text-transform:uppercase;letter-spacing:1px;padding:6px 8px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          ${cesc(l.description || '')}
        </td>
      </tr>`;
    }

    if (rowType === 'note') {
      return `<tr>
        <td colspan="${colSpan}" style="font-style:italic;font-size:10px;padding-left:20px;">
          ${cesc(l.description || '')}
        </td>
      </tr>`;
    }

    if (rowType === 'image') {
      const caption = cesc(l.unit_label || '');
      return `<tr>
        <td colspan="${colSpan}" style="text-align:center;padding:10px;">
          ${l.description ? `<img src="${cesc(l.description)}" alt="${caption}" style="max-width:300px;max-height:180px;object-fit:contain;">` : ''}
          ${caption ? `<div style="font-size:10px;margin-top:4px;">${caption}</div>` : ''}
        </td>
      </tr>`;
    }

    if (rowType === 'subtotal') {
      // MATH: in-table subtotal row sums per-line "Amount" column values, which
      // include tax (matching the per-line tax-inclusive Amount column).
      // Sum (discountedBase + lineTax) for each item row so the running subtotal
      // reconciles exactly to the visible Amount column above it.
      const subtotalAmt = lineItems
        .slice(lastSubtotalAt, i)
        .filter(r => (r.row_type || 'item') === 'item')
        .reduce((sum, r) => {
          const base = Math.round(lineDiscountedBase(r) * 100) / 100;
          const rate = lineEffectiveRate(r);
          const tax = Math.round(base * (rate / 100) * 100) / 100;
          return sum + base + tax;
        }, 0);
      lastSubtotalAt = i + 1;
      return `<tr>
        <td colspan="${colSpan - 1}" style="font-weight:bold;text-align:right;">
          ${cesc(l.description || 'Subtotal')}
        </td>
        <td class="num" style="font-weight:bold;">${cesc(fmt(subtotalAmt))}</td>
      </tr>`;
    }

    // ── Standard item row ──
    // Preserve per-line emphasis (bold/italic/highlight). Highlight color is
    // user-configured; honored as an inline background so it survives print.
    const lineStyleAttr = [
      (l.bold || 0) ? 'font-weight:bold' : '',
      (l.italic || 0) ? 'font-style:italic' : '',
      (l.highlight_color || '') ? `background-color:${l.highlight_color};-webkit-print-color-adjust:exact;print-color-adjust:exact;` : '',
    ].filter(Boolean).join(';');
    // MATH: pre-discount raw (qty × unit_price) for strikethrough display.
    const baseAmtRaw = Number(l.quantity || 1) * Number(l.unit_price || 0);
    const hasLineDiscount = !!(l.line_discount && Number(l.line_discount) > 0);
    const hasPctDiscount = !!(l.discount_pct && Number(l.discount_pct) > 0);
    // MATH: shared discounted-base helper keeps line column reconciled to
    // taxByRate / totals box. Round per-line so column sums match exactly.
    const discountedPrice = Math.round(lineDiscountedBase(l) * 100) / 100;
    const lineEffectiveTaxRate = lineEffectiveRate(l);
    const lineTaxAmount = Math.round(discountedPrice * (lineEffectiveTaxRate / 100) * 100) / 100;
    const lineAmountWithTax = discountedPrice + lineTaxAmount;

    const cells = cols.map(c => {
      const isNum = numericKeys.includes(c.key);
      let val = '';
      switch (c.key) {
        case 'item_code':    val = l.item_code ? `<span style="font-size:9px;border:1px solid #000;padding:0 3px;">${cesc(l.item_code)}</span>` : ''; break;
        case 'description': {
          const desc = cesc(l.description || '');
          const isService = String(l.row_type || 'item') === 'item' && (l.is_service || /service|consult|labor|hour/i.test(String(l.description || '')));
          const chip = isService ? ` <span style="font-size:8px;border:1px solid #000;padding:0 3px;letter-spacing:0.5px;">SVC</span>` : '';
          val = `${desc}${chip}`;
          break;
        }
        case 'quantity':     val = cesc(String(l.quantity ?? 1)); break;
        case 'unit_label':   val = cesc(l.unit_label || ''); break;
        case 'unit_price':   val = cesc(fmt(l.unit_price || 0)); break;
        case 'tax_rate':     val = lineEffectiveTaxRate > 0 ? cesc(lineEffectiveTaxRate + '%') : '—'; break;
        case 'tax_amount':   val = lineEffectiveTaxRate > 0 ? cesc(fmt(lineTaxAmount)) : '—'; break;
        case 'amount': {
          // MATH: show strikethrough whenever EITHER per-line discount field
          // reduced the base — so the visual matches taxByRate / totals box.
          if ((hasLineDiscount || hasPctDiscount) && discountedPrice < baseAmtRaw) {
            const dlbl = hasLineDiscount
              ? (l.line_discount_type === 'flat' ? `−${fmt(Number(l.line_discount))}` : `−${Number(l.line_discount)}%`)
              : `−${Number(l.discount_pct)}%`;
            val = `<span style="text-decoration:line-through;font-size:10px;display:block;line-height:1.1;">${cesc(fmt(baseAmtRaw))}</span><span style="display:block;line-height:1.2;font-weight:bold;">${cesc(fmt(lineAmountWithTax))}</span><span style="font-size:8px;">${cesc(dlbl)}</span>`;
          } else {
            val = cesc(fmt(lineAmountWithTax));
          }
          break;
        }
      }
      return `<td${isNum ? ' class="num"' : ''}>${val}</td>`;
    }).join('');

    return `<tr${lineStyleAttr ? ` style="${lineStyleAttr}"` : ''}>${cells}</tr>`;
  }).join('');

  // Assemble the ruled line-items table (classic <thead> + custom body rows).
  const itemsTableHead = `<tr>${tableColumns.map(c =>
    `<th>${cesc(c.label)}</th>`).join('')}</tr>`;
  const itemsTableHTML = `<table class="ruled"><thead>${itemsTableHead}</thead><tbody>${lineRows}</tbody></table>`;

  // ── Document type / labels ──
  const isCreditNote = invoice.invoice_type === 'credit_note';
  const isQuote = invoice.invoice_type === 'quote' || invoice.document_type === 'quote';
  const isProforma = invoice.invoice_type === 'proforma';
  const invoiceTypeLabel = isCreditNote ? 'Credit Note'
    : isQuote ? 'Quote'
    : isProforma ? 'Proforma Invoice'
    : invoice.invoice_type === 'retainer' ? 'Retainer Invoice'
    : invoice.invoice_type === 'service' ? 'Service Invoice'
    : invoice.invoice_type === 'product' ? 'Invoice'
    : 'Invoice';

  const shippingAmount = Number(invoice.shipping_amount || 0);
  const subtotalNum    = Number(invoice.subtotal || 0);
  const docNumberField = invoice.invoice_number || invoice.quote_number || invoice.document_number || '';

  // Status badge (classic = boxed monochrome label, no color fills).
  const statusBadges: Record<string, string> = {
    paid: 'PAID', overdue: 'OVERDUE', cancelled: 'VOID', void: 'VOID',
    sent: 'SENT', accepted: 'ACCEPTED', declined: 'DECLINED', partial: 'PARTIAL',
  };
  const statusBadge = statusBadges[String(invoice.status || '').toLowerCase()];

  // ── Logo (only embed data: / https: URIs — file:// fails in Electron PDF) ──
  // Grayscale + sizing centralized in classic-styles `.doc-logo`.
  const logoHTML = logoImg(logoData, companyName);

  // ── P1.4: Custom Letterhead banner (data-URI validated) ──
  const letterheadSrc = settings?.letterhead_data && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(String(settings.letterhead_data))
    ? String(settings.letterhead_data)
    : null;
  const letterheadPos = settings?.letterhead_position || 'top';
  const letterheadH = Math.min(300, Math.max(40, Number(settings?.letterhead_height) || 90));
  const letterheadHTML = letterheadSrc
    ? `<div style="margin:0 0 ${letterheadPos === 'replace' ? '14px' : '10px'} 0;text-align:center;">
        <img src="${letterheadSrc}" alt="Letterhead" style="display:block;width:100%;max-width:100%;height:${letterheadH}px;object-fit:contain;object-position:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;"/>
      </div>`
    : '';

  // ── Classic header (company block + doc title/number) ──
  // companyName/companyAddr/companyEmail/companyPhone are ALREADY esc()-ed
  // above, so they are trusted HTML here — do not double-escape.
  const coDetail = [
    companyAddr,
    [companyEmail, companyPhone].filter(Boolean).join(' &middot; '),
  ].filter(Boolean).join('<br>');
  const currencyLabel = invoice.currency && invoice.currency !== 'USD' ? ` (${invoice.currency})` : '';
  const numberLines = [
    `No. ${cesc(docNumberField)}${statusBadge ? `  [${cesc(statusBadge)}]` : ''}`,
    isCreditNote && invoice.reference_invoice_number ? `Re: Invoice #${cesc(invoice.reference_invoice_number)}` : '',
  ].filter(Boolean).join('<br>');
  // For 'replace' letterhead the banner stands in for the company block, so
  // emit an empty company cell; otherwise show logo + company details.
  const useReplaceHeader = !!(letterheadSrc && letterheadPos === 'replace');
  // numberLines is multi-line trusted HTML (number + status + optional
  // "Re: …"), so pass it via docHeader's numberHtml option.
  const headerWithNumber = docHeader({
    coName: useReplaceHeader ? '' : (company?.name || 'Company'),
    coDetailHtml: useReplaceHeader ? '' : (logoHTML + coDetail),
    title: `${invoiceTypeLabel}${currencyLabel}`,
    numberHtml: numberLines,
  });

  // ── Meta strip (Issue/Due or Quote/Valid Until + PO + custom fields) ──
  const statusPretty = invoice.status
    ? String(invoice.status).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    : '';
  const metaCells: { label: string; value: string }[] = [
    { label: isQuote ? 'Quote Date' : isCreditNote ? 'Credit Date' : 'Issue Date', value: fmtDate(invoice.issue_date) },
    isQuote
      ? { label: 'Valid Until', value: fmtDate(invoice.valid_until || invoice.due_date || '') }
      : { label: isCreditNote ? 'Ref Invoice' : 'Due Date', value: isCreditNote ? (invoice.reference_invoice_number || '—') : fmtDate(invoice.due_date) },
    { label: 'Terms', value: invoice.terms || (isQuote ? 'Quote' : 'Net 30') },
  ];
  if (invoice.po_number) metaCells.push({ label: 'PO Number', value: String(invoice.po_number) });
  if (invoice.job_reference) metaCells.push({ label: 'Project', value: String(invoice.job_reference) });
  if (!isQuote && !isCreditNote && statusPretty) metaCells.push({ label: 'Status', value: statusPretty });
  if (invoice.sent_date) metaCells.push({ label: 'Sent', value: fmtDate(invoice.sent_date) });
  metaCells.push({ label: 'Currency', value: invoice.currency || 'USD' });
  // Custom fields appended (already filtered for label + value).
  metaCells.push(...customFieldCells);
  const meta = metaStrip(metaCells);

  // ── Bill To / Ship To boxes ──
  const shipName = esc(invoice.ship_to_name || '');
  const shipAddr = esc([invoice.ship_to_address_line1, invoice.ship_to_address_line2, invoice.ship_to_city, invoice.ship_to_state, invoice.ship_to_zip].filter(Boolean).join(', '));
  const hasShip = !!(shipName || shipAddr);
  // Client tenure note (informational; classic = plain text).
  const tenureNote = (() => {
    const since = (client?.created_at || client?.client_since || '').toString().slice(0, 4);
    const sinceYear = parseInt(since, 10);
    if (!sinceYear || sinceYear < 1990 || sinceYear > new Date().getFullYear()) return '';
    return `<div style="font-size:10px;margin-top:5px;">Client since ${sinceYear}</div>`;
  })();
  const billHtml = `<b>${clientName}</b>` +
    ((clientAddr || clientEmail || clientPhone)
      ? '<br>' + [clientAddr, [clientEmail, clientPhone].filter(Boolean).join(' &middot; ')].filter(Boolean).join('<br>')
      : '') +
    tenureNote;
  const partyBoxes = [{ label: isQuote ? 'Quote For' : 'Bill To', html: billHtml }];
  if (hasShip) {
    partyBoxes.push({
      label: 'Ship To',
      html: `<b>${shipName || clientName}</b>${shipAddr ? '<br>' + shipAddr : ''}`,
    });
  }
  const parties = boxRow(partyBoxes);

  // ── Payment progress note (partial payments; classic = plain text) ──
  const paymentPct = total > 0 ? Math.min(100, Math.max(0, (amountPaid / total) * 100)) : 0;
  const paymentNote = (amountPaid > 0 && balance > 0.005 && total > 0 && !isQuote && !isCreditNote)
    ? `<div style="padding:8px 16px;border-bottom:2px solid #000;font-size:11px;">` +
      `<b>Payment Progress:</b> ${paymentPct.toFixed(0)}% paid &middot; ${cesc(fmt(amountPaid))} of ${cesc(fmt(total))} ` +
      `&middot; Balance Due ${cesc(fmt(balance))}</div>`
    : '';

  // ── Totals box ──
  const totalRows: { label: string; value: string; grand?: boolean }[] = [
    { label: 'Subtotal', value: fmt(subtotalNum) },
    ...taxTotalRows,
  ];
  if (discountAmount > 0) totalRows.push({ label: 'Discount', value: `−${fmt(discountAmount)}` });
  if (shippingAmount > 0) totalRows.push({ label: 'Shipping', value: fmt(shippingAmount) });
  totalRows.push(
    isCreditNote
      ? { label: 'Credit Amount', value: `(${fmt(Math.abs(total))}) CR`, grand: true }
      : { label: 'Total', value: fmt(total), grand: true }
  );
  if (amountPaid > 0 && !isCreditNote) {
    totalRows.push({ label: 'Amount Paid', value: fmt(amountPaid) });
    totalRows.push({ label: 'Balance Due', value: fmt(Math.max(0, balance)), grand: true });
  }
  const totals = totalsBox(totalRows);

  // ── Payment schedule (classic ruled table) ──
  const scheduleHTML = (() => {
    if (!paymentSchedule || paymentSchedule.length === 0) return '';
    const rows: string[][] = paymentSchedule.map(m => [
      cesc(m.milestone_label || ''),
      cesc(fmtDate(m.due_date)),
      cesc(fmt(Number(m.amount || 0))),
      m.paid ? 'PAID' : 'Due',
    ]);
    return `<div style="padding:12px 16px;border-top:2px solid #000;">
      <div class="sec-label" style="margin-bottom:6px;">Payment Schedule</div>
      ${ruledTable(
        [
          { label: 'Milestone' },
          { label: 'Due Date', align: 'right' },
          { label: 'Amount', align: 'right' },
          { label: 'Status', align: 'center' },
        ],
        rows,
      )}
    </div>`;
  })();

  // ── Payment QR (classic = QR inside a bordered box) ──
  // Prefer the portal deep-link (scopes recipient to THIS invoice); fall back
  // to a configured payment-URL prefix. buildPortalUrl() handles {token}
  // substitution, /login query-param mode, and legacy /portal path-style URLs.
  const portalDeepLink = invoice.portal_token
    ? buildPortalUrl(settings?.portal_base_url, invoice.portal_token)
    : (qrUrl ? `${qrUrl.replace(/\/$/, '')}/${invoice.invoice_number || ''}` : '');
  const showQRResolved = (showQR || !!invoice.portal_token) && !!portalDeepLink && !isQuote;
  const qrCaption = isCreditNote ? 'View Credit' : (balance > 0.005 ? 'Pay this Invoice' : 'View Receipt');
  const qrSvg = showQRResolved ? generateQRSVG(portalDeepLink, 96) : '';
  const qrSection = (showQRResolved && qrSvg)
    ? `<div style="padding:12px 16px;border-top:2px solid #000;">
        <div style="display:inline-flex;align-items:center;gap:14px;border:1px solid #000;padding:10px 14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <div style="width:96px;height:96px;flex:0 0 96px;">${qrSvg}</div>
          <div style="font-size:11px;line-height:1.4;max-width:170px;">
            <div style="font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">${cesc(qrCaption)}</div>
            <div style="font-size:9.5px;">Scan with your phone camera to view, pay, and download a receipt.</div>
          </div>
        </div>
      </div>`
    : '';

  // ── Notes / Terms (boxRow) ──
  const noteBoxes: { label: string; html: string }[] = [];
  if (invoice.notes) noteBoxes.push({ label: 'Notes', html: `<div style="white-space:pre-line;">${cesc(invoice.notes)}</div>` });
  if (invoice.terms_text) noteBoxes.push({ label: 'Terms & Conditions', html: `<div style="white-space:pre-line;">${cesc(invoice.terms_text)}</div>` });
  const notesHTML = noteBoxes.length ? boxRow(noteBoxes) : '';

  // ── Quote signature block ──
  const quoteSigHTML = isQuote
    ? `<div style="padding:18px 16px 12px;border-top:2px solid #000;">
        <div style="display:flex;gap:40px;">
          <div style="flex:1;"><div style="border-bottom:1px solid #000;height:28px;"></div><div style="font-size:10px;margin-top:4px;">Authorized Signature &middot; ${companyName}</div></div>
          <div style="flex:1;"><div style="border-bottom:1px solid #000;height:28px;"></div><div style="font-size:10px;margin-top:4px;">Accepted by ${clientName} &middot; Date</div></div>
        </div>
        <div style="font-size:10px;font-style:italic;margin-top:10px;line-height:1.5;">
          By signing above, the customer accepts the goods and services described in this quote at the prices stated, subject to the terms above. This quote is valid${invoice.valid_until ? ` until ${cesc(fmtDate(invoice.valid_until))}` : ''}.
        </div>
      </div>`
    : '';

  // ── Credit note / late-fee notices ──
  const creditNoteHTML = isCreditNote
    ? `<div style="padding:12px 16px;border-top:2px solid #000;font-size:10px;font-style:italic;line-height:1.5;">
        Amounts shown are credits to the customer's account. Negative values or "(CR)" indicate funds owed to the customer${invoice.reference_invoice_number ? ` against Invoice #${cesc(invoice.reference_invoice_number)}` : ''}.
      </div>`
    : '';
  const lateFeeNote = (invoice.late_fee_pct && invoice.late_fee_pct > 0 && !isQuote && !isCreditNote)
    ? `<div style="padding:0 16px 10px;font-size:10px;">A late fee of ${cesc(String(invoice.late_fee_pct))}% per month applies after ${cesc(String(invoice.late_fee_grace_days || 0))} days.</div>`
    : '';

  // ── Custom watermark (faint, in addition to DRAFT via docFrame). PROFORMA
  // documents get an automatic watermark when no custom one is set. ──
  const effectiveWmText = wmText || (isProforma ? 'PROFORMA' : '');
  const wmOpacity = settings?.watermark_opacity ?? 0.06;
  const customWmHTML = effectiveWmText
    ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:84px;font-weight:bold;color:rgba(0,0,0,${Math.max(0.02, Math.min(0.3, wmOpacity))});letter-spacing:10px;pointer-events:none;z-index:0;white-space:nowrap;">${cesc(effectiveWmText)}</div>`
    : '';
  // DRAFT watermark via docFrame only when there's no explicit/proforma
  // custom watermark (avoids overlapping watermarks).
  const showDraftWm = invoice.status === 'draft' && !effectiveWmText;

  // ── Footer bar ──
  const footerLine = `${esc(footerText) || companyName} · ${invoiceTypeLabel} #${esc(String(docNumberField))} · Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;

  // ── Assemble the document frame ──
  const inner =
    customWmHTML +
    headerWithNumber +
    meta +
    parties +
    paymentNote +
    itemsTableHTML +
    `<div style="display:flex;justify-content:flex-end;padding:10px 16px;">${totals}</div>` +
    scheduleHTML +
    qrSection +
    notesHTML +
    quoteSigHTML +
    creditNoteHTML +
    lateFeeNote +
    footerBar(footerLine);

  const bodyInner =
    (letterheadSrc && letterheadPos === 'top' ? letterheadHTML : '') +
    docFrame(inner, { draft: showDraftWm }) +
    (letterheadSrc && letterheadPos === 'bottom' ? letterheadHTML : '');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${cesc(docNumberField)}</title>` +
    `<style>${classicStyles()}</style></head><body>${bodyInner}</body></html>`;
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
  hours_regular?: number;
  hours_overtime?: number;
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  net_pay: number;
  pretax_deductions?: number;
  posttax_deductions?: number;
  deduction_detail?: string;
  check_number?: string;
  // ── Optional employee/identity fields (privacy-enforced) ──
  employee_id_short?: string;        // HR id / employee number, NOT SSN
  employee_address?: string;         // pre-formatted single-line address
  ssn?: string;                      // ANY length input — only last 4 ever rendered
  ssn_last4?: string;                // explicit last-4 (preferred)
  // ── Direct deposit (privacy-enforced) ──
  bank_name?: string;
  account_number?: string;           // ANY length — only last 4 ever rendered
  bank_account_last4?: string;       // explicit last-4 (preferred)
  // ── Employer-side contributions (informational, not deducted) ──
  employer_social_security?: number;
  employer_medicare?: number;
  employer_futa?: number;
  employer_suta?: number;
  employer_retirement_match?: number;
  employer_health_contribution?: number;
  // ── Extended employee / payroll metadata ──
  department?: string;
  job_title?: string;
  pay_type?: string;                 // salary | hourly
  pay_rate?: number;                 // annual salary or hourly rate
  pay_schedule?: string;             // weekly | biweekly | semimonthly | monthly
  filing_status?: string;            // single | married | head_of_household
  federal_allowances?: number;
  state_name?: string;               // e.g. "Utah"
  state_allowances?: number;
  hire_date?: string;
  employment_type?: string;          // full-time | part-time | contractor
  run_type?: string;                 // regular | bonus | correction | off-cycle
  pay_period_number?: number;        // e.g. 8 of 26
  pay_periods_per_year?: number;     // 26 for biweekly
  employer_ein?: string;
  employer_state_id?: string;
  w4_step2?: boolean;
  w4_step3_credit?: number;
  w4_step4c_extra?: number;
  // ── YTD hours (optional) ──
  ytd_hours_regular?: number;
  ytd_hours_overtime?: number;
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
  // ── CLASSIC THEME: Arial + pure black/white. ──

  const coName = company?.name || 'Company';
  const coDetailHtml = [
    company?.legal_name ? cesc(company.legal_name) : '',
    [company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip].filter(Boolean).map(cesc).join(', '),
    [company?.phone, company?.email].filter(Boolean).map(cesc).join(' &middot; '),
  ].filter(Boolean).join('<br>');
  const logoData = company?.logo_data ?? company?.logo ?? null;

  // ── Math (unchanged) ──
  const taxDed = stub.federal_tax + stub.state_tax + stub.social_security + stub.medicare;
  const preTax = stub.pretax_deductions ?? 0;
  const postTax = stub.posttax_deductions ?? 0;
  const totalDed = taxDed + preTax + postTax;
  const ytdTotalDed = ytd.federal_tax + ytd.state_tax + ytd.social_security + ytd.medicare;

  const hoursRegular = stub.hours_regular ?? stub.hours ?? 0;
  const hoursOvertime = stub.hours_overtime ?? 0;
  const totalHours = hoursRegular + hoursOvertime;
  const isSalaried = totalHours === 0;

  // Compute approximate regular/OT pay split
  const effectiveRate = totalHours > 0 ? stub.gross_pay / (hoursRegular + hoursOvertime * 1.5) : 0;
  const regularPay = isSalaried ? stub.gross_pay : effectiveRate * hoursRegular;
  const overtimePay = isSalaried ? 0 : effectiveRate * 1.5 * hoursOvertime;

  // ── Extended metadata ──
  const payType = stub.pay_type === 'salary' ? 'Salary' : stub.pay_type === 'hourly' ? 'Hourly' : '';
  const payRate = stub.pay_rate ?? 0;
  const payScheduleLabels: Record<string, string> = { weekly: 'Weekly', biweekly: 'Bi-Weekly', semimonthly: 'Semi-Monthly', monthly: 'Monthly' };
  const payScheduleLabel = payScheduleLabels[stub.pay_schedule || ''] || '';
  const filingStatusLabels: Record<string, string> = { single: 'Single', married: 'Married Filing Jointly', head_of_household: 'Head of Household', married_joint: 'Married Filing Jointly', married_separate: 'Married Filing Separately', head_household: 'Head of Household' };
  const filingLabel = filingStatusLabels[stub.filing_status || ''] || cesc(stub.filing_status || '');
  const runTypeLabels: Record<string, string> = { regular: 'Regular', bonus: 'Bonus', correction: 'Correction', 'off-cycle': 'Off-Cycle' };
  const runTypeLabel = runTypeLabels[stub.run_type || 'regular'] || 'Regular';
  const periodsPerYr = stub.pay_periods_per_year ?? 26;
  const stateName = stub.state_name || 'Utah';

  // Parse deduction detail JSON
  let deductionItems: [string, number][] = [];
  if (stub.deduction_detail && stub.deduction_detail !== '{}') {
    try {
      const detail = JSON.parse(stub.deduction_detail);
      deductionItems = Object.entries(detail).map(([k, v]) => [k, Number(v)]);
    } catch { /* ignore */ }
  }

  // ── PRIVACY: enforce last-4-only rendering for SSN and bank account ──
  const last4 = (raw: string | undefined | null): string => {
    if (!raw) return '';
    const digits = String(raw).replace(/\D/g, '');
    return digits.slice(-4);
  };
  const ssnLast4 = last4(stub.ssn_last4 || stub.ssn);
  const ssnDisplay = ssnLast4 ? `XXX-XX-${ssnLast4}` : '';
  const bankAcctLast4 = last4(stub.bank_account_last4 || stub.account_number);
  const bankAcctDisplay = bankAcctLast4 ? `••••${bankAcctLast4}` : '';

  // ── Employer contributions (informational, NOT deducted from pay) ──
  const empSS = stub.employer_social_security ?? 0;
  const empMed = stub.employer_medicare ?? 0;
  const empFuta = stub.employer_futa ?? 0;
  const empSuta = stub.employer_suta ?? 0;
  const empMatch = stub.employer_retirement_match ?? 0;
  const empHealth = stub.employer_health_contribution ?? 0;
  const employerTotal = empSS + empMed + empFuta + empSuta + empMatch + empHealth;
  const hasEmployerContribs = employerTotal > 0;

  // ── Year fraction for annualized projections (unchanged math) ──
  const periodEndDate = (() => {
    const raw = stub.period_end || '';
    if (!raw) return new Date();
    const isoMatch = /^\d{4}-\d{2}-\d{2}/.test(raw);
    const parsed = isoMatch ? new Date(raw + 'T12:00:00') : new Date(raw);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  })();
  const yStart = new Date(periodEndDate.getFullYear(), 0, 1).getTime();
  const yEnd = new Date(periodEndDate.getFullYear() + 1, 0, 1).getTime();
  const yearFrac = Math.max(0.01, Math.min(1, (periodEndDate.getTime() - yStart) / (yEnd - yStart)));

  // ── Effective tax rates (data preserved; color→plain-text in classic) ──
  const effFedRate = stub.gross_pay > 0 ? (stub.federal_tax / stub.gross_pay * 100).toFixed(2) : '0.00';
  const effStateRate = stub.gross_pay > 0 ? (stub.state_tax / stub.gross_pay * 100).toFixed(2) : '0.00';
  const effFicaRate = stub.gross_pay > 0 ? ((stub.social_security + stub.medicare) / stub.gross_pay * 100).toFixed(2) : '0.00';
  const effTotalRate = stub.gross_pay > 0 ? (taxDed / stub.gross_pay * 100).toFixed(2) : '0.00';

  // ── FICA wage base tracker (data preserved; progress bar→text in classic) ──
  const ssPct = Math.min(100, (ytd.gross_pay / 182100) * 100);
  const medPct = Math.min(100, (ytd.gross_pay / 200000) * 100);

  // ── Net of gross % (data preserved; bar→text in classic) ──
  const netOfGrossPct = stub.gross_pay > 0 ? (stub.net_pay / stub.gross_pay * 100).toFixed(1) : '0.0';

  // ── Earnings composition: regular vs OT percentages (data preserved; bar→text) ──
  const earningsCompositionRows: string[][] = (!isSalaried && (regularPay + overtimePay) > 0) ? [
    [cesc('Regular'), cesc(hoursRegular.toFixed(2)), cesc(fmt(effectiveRate)), cesc(fmt(regularPay)),
     cesc(`${((regularPay / (regularPay + overtimePay)) * 100).toFixed(1)}%`)],
    ...(hoursOvertime > 0 ? [[cesc('Overtime (1.5x)'), cesc(hoursOvertime.toFixed(2)), cesc(fmt(effectiveRate * 1.5)), cesc(fmt(overtimePay)),
     cesc(`${((overtimePay / (regularPay + overtimePay)) * 100).toFixed(1)}%`)]] : []),
  ] : [];

  // ── YTD progress vs annualized (data preserved; bar→text in classic) ──
  const annualGross = ytd.gross_pay / yearFrac;
  const annualNet = ytd.net_pay / yearFrac;
  const annualTax = ytdTotalDed / yearFrac;

  // ─ Header ─
  const header = docHeader({
    coName,
    coDetailHtml: (logoImg(logoData, coName) + coDetailHtml),
    title: 'Pay Statement',
    numberHtml: `<div class="doc-number">Pay Date: ${cesc(stub.pay_date)}</div>` +
      (stub.check_number ? `<div class="doc-number">Check #${cesc(stub.check_number)}</div>` : '') +
      `<div class="doc-number">${cesc(runTypeLabel)} Run</div>`,
  });

  // ─ Meta strip ─
  const meta = metaStrip([
    { label: 'Pay Date',   value: stub.pay_date },
    { label: 'Period',     value: `${stub.period_start} – ${stub.period_end}` },
    { label: 'Net Pay',    value: fmt(stub.net_pay) },
    { label: 'Gross Pay',  value: fmt(stub.gross_pay) },
    { label: 'Total Ded.', value: fmt(totalDed) },
    { label: 'YTD Net',    value: fmt(ytd.net_pay) },
  ]);

  // ─ Employee & employer info boxRow ─
  const empInfoRow = boxRow([
    {
      label: 'Employee',
      html: `<strong>${cesc(stub.employee_name)}</strong>` +
        (stub.employee_id_short ? `<br>${cesc('ID: ' + stub.employee_id_short)}` : '') +
        (stub.employee_address ? `<br>${cesc(stub.employee_address)}` : '') +
        (ssnDisplay ? `<br>SSN: ${cesc(ssnDisplay)} <em style="font-size:9px;">(last 4 only)</em>` : ''),
    },
    {
      label: 'Employment',
      html: `${cesc(stub.department || '')}${stub.department && stub.job_title ? ' &mdash; ' : ''}${cesc(stub.job_title || '')}` +
        `<br>${cesc(payType)}${payRate > 0 ? ' &mdash; ' + cesc(payType === 'Salary' ? fmt(payRate) + '/yr' : fmt(payRate) + '/hr') : ''}` +
        `<br>${cesc(payScheduleLabel || '')}${periodsPerYr ? cesc(' (' + periodsPerYr + '/yr)') : ''}` +
        `<br>${cesc('Hire: ' + (stub.hire_date || '—'))} &nbsp; ${cesc(stub.employment_type || '')}`,
    },
    {
      label: 'Tax Withholding',
      html: `Filing: ${cesc(filingLabel || '—')}` +
        `<br>Fed allowances: ${cesc(stub.federal_allowances != null ? String(stub.federal_allowances) : '—')}` +
        `<br>State (${cesc(stateName)}): ${cesc(stub.state_allowances != null ? stub.state_allowances + ' exempt.' : '—')}` +
        (stub.w4_step4c_extra ? `<br>Extra W/H: ${cesc(fmt(stub.w4_step4c_extra))}` : '') +
        (stub.employer_ein ? `<br>EIN: ${cesc(stub.employer_ein)}` : ''),
    },
    {
      label: 'Hours',
      html: isSalaried
        ? 'Salaried (N/A)'
        : `Regular: ${cesc(hoursRegular.toFixed(2))} h` +
          `<br>Overtime: ${cesc(hoursOvertime.toFixed(2))} h` +
          `<br>Total: ${cesc(totalHours.toFixed(2))} h` +
          (totalHours > 0 ? `<br>Avg $/hr (net): ${cesc(fmt(stub.net_pay / totalHours))}` : ''),
    },
  ]);

  // ─ Earnings table ─
  const earningsRows: string[][] = isSalaried
    ? [[cesc('Salary'), '--', '--', cesc(fmt(stub.gross_pay)), cesc(fmt(ytd.gross_pay))]]
    : [
        [cesc('Regular'), cesc(hoursRegular.toFixed(2)), cesc(fmt(effectiveRate)), cesc(fmt(regularPay)), '--'],
        ...(hoursOvertime > 0 ? [[cesc('Overtime (1.5x)'), cesc(hoursOvertime.toFixed(2)), cesc(fmt(effectiveRate * 1.5)), cesc(fmt(overtimePay)), '--']] : []),
        [cesc('<strong>Gross Pay</strong>'), cesc(`<strong>${totalHours.toFixed(2)}</strong>`), '', cesc(`<strong>${fmt(stub.gross_pay)}</strong>`), cesc(`<strong>${fmt(ytd.gross_pay)}</strong>`)],
      ];
  if (!isSalaried) {
    // Remove separate gross total row — already appended above
  } else {
    // For salaried: just the one row + totals below
  }
  const earningsCols: RuledColumn[] = [
    { label: 'Description', width: '38%' },
    { label: 'Hours', align: 'right', width: '12%' },
    { label: 'Rate', align: 'right', width: '14%' },
    { label: 'Current', align: 'right', width: '18%' },
    { label: 'YTD', align: 'right', width: '18%' },
  ];
  // Rebuild as simple rows for ruledTable (html allowed in cells as TRUSTED HTML)
  const earningsTableRows: string[][] = isSalaried
    ? [
        ['Salary', '--', '--', cesc(fmt(stub.gross_pay)), cesc(fmt(ytd.gross_pay))],
        ...(preTax > 0 ? [
          [`<em>Less: Pre-Tax Deductions</em>`, '', '', `-${cesc(fmt(preTax))}`, '--'],
          [`<strong>Taxable Wages</strong>`, '', '', `<strong>${cesc(fmt(stub.gross_pay - preTax))}</strong>`, cesc(fmt(ytd.gross_pay))],
        ] : []),
      ]
    : [
        ['Regular', cesc(hoursRegular.toFixed(2)), cesc(fmt(effectiveRate)), cesc(fmt(regularPay)), '--'],
        ...(hoursOvertime > 0 ? [['Overtime (1.5x)', cesc(hoursOvertime.toFixed(2)), cesc(fmt(effectiveRate * 1.5)), cesc(fmt(overtimePay)), '--']] : []),
        [`<strong>Gross Pay</strong>`, `<strong>${cesc(totalHours.toFixed(2))}</strong>`, '', `<strong>${cesc(fmt(stub.gross_pay))}</strong>`, `<strong>${cesc(fmt(ytd.gross_pay))}</strong>`],
        ...(preTax > 0 ? [
          [`<em>Less: Pre-Tax Deductions</em>`, '', '', `-${cesc(fmt(preTax))}`, '--'],
          [`<strong>Taxable Wages</strong>`, '', '', `<strong>${cesc(fmt(stub.gross_pay - preTax))}</strong>`, cesc(fmt(ytd.gross_pay))],
        ] : []),
      ];

  // ─ Deductions table ─
  const taxableFed = Math.max(0, stub.gross_pay - preTax);
  const taxableState = Math.max(0, stub.gross_pay - preTax);
  const taxRows: string[][] = [
    ['Federal Income Tax',
     taxableFed > 0 ? cesc((stub.federal_tax / taxableFed * 100).toFixed(2) + '%') : '--',
     cesc(fmt(stub.federal_tax)), cesc(fmt(ytd.federal_tax)), cesc(fmt(taxableFed))],
    [`State Income Tax (${cesc(stateName)})`,
     taxableState > 0 ? cesc((stub.state_tax / taxableState * 100).toFixed(2) + '%') : '--',
     cesc(fmt(stub.state_tax)), cesc(fmt(ytd.state_tax)), cesc(fmt(taxableState))],
    ['Social Security (OASDI) — cap $182,100', '6.20%',
     cesc(fmt(stub.social_security)), cesc(fmt(ytd.social_security)),
     cesc(fmt(Math.min(stub.gross_pay, Math.max(0, 182100 - (ytd.gross_pay - stub.gross_pay)))))],
    ['Medicare (HI)', '1.45%',
     cesc(fmt(stub.medicare)), cesc(fmt(ytd.medicare)), cesc(fmt(stub.gross_pay))],
    [`<strong>Total Statutory Taxes</strong>`, '',
     `<strong>${cesc(fmt(taxDed))}</strong>`, `<strong>${cesc(fmt(ytdTotalDed))}</strong>`, ''],
  ];
  const taxCols: RuledColumn[] = [
    { label: 'Tax', width: '34%' },
    { label: 'Rate', align: 'right', width: '10%' },
    { label: 'Current', align: 'right', width: '18%' },
    { label: 'YTD', align: 'right', width: '18%' },
    { label: 'Taxable Wages', align: 'right', width: '20%' },
  ];

  // ─ Voluntary deductions table ─
  const voluntaryRows: string[][] = [
    ...(deductionItems.length > 0 ? deductionItems.map(([name, amount]) => {
      const isPre = name.toLowerCase().includes('401k') || name.toLowerCase().includes('hsa') || name.toLowerCase().includes('fsa') || name.toLowerCase().includes('health') || name.toLowerCase().includes('dental') || name.toLowerCase().includes('vision') || name.toLowerCase().includes('retirement');
      return [cesc(name), isPre ? 'Pre-Tax' : 'Post-Tax', 'Per Period', cesc(fmt(amount)), '--'];
    }) : []),
    ...(preTax > 0 && deductionItems.length === 0 ? [['Pre-Tax Deductions', 'Pre-Tax', 'Per Period', cesc(fmt(preTax)), '--']] : []),
    ...(postTax > 0 && deductionItems.length === 0 ? [['Post-Tax Deductions', 'Post-Tax', 'Per Period', cesc(fmt(postTax)), '--']] : []),
    [`<strong>Total Voluntary Deductions</strong>`, '', '', `<strong>${cesc(fmt(preTax + postTax))}</strong>`, '--'],
  ];
  const volCols: RuledColumn[] = [
    { label: 'Deduction', width: '38%' },
    { label: 'Type', align: 'right', width: '14%' },
    { label: 'Basis', align: 'right', width: '14%' },
    { label: 'Current', align: 'right', width: '17%' },
    { label: 'YTD', align: 'right', width: '17%' },
  ];
  const hasVoluntary = preTax > 0 || postTax > 0 || deductionItems.length > 0;

  // ─ Employer contributions table ─
  const empContribRows: string[][] = [
    ...(empSS > 0 ? [['Social Security (OASDI Match)', '6.20%', cesc(fmt(empSS)), '$182,100']] : []),
    ...(empMed > 0 ? [['Medicare (HI Match)', '1.45%', cesc(fmt(empMed)), 'No limit']] : []),
    ...(empFuta > 0 ? [['Federal Unemployment (FUTA)', '0.60%', cesc(fmt(empFuta)), '$7,000']] : []),
    ...(empSuta > 0 ? [['State Unemployment (UT SUI)', '1.20%', cesc(fmt(empSuta)), '$44,800']] : []),
    ...(empMatch > 0 ? [['Retirement Plan Match', '--', cesc(fmt(empMatch)), '--']] : []),
    ...(empHealth > 0 ? [['Health Insurance Contribution', '--', cesc(fmt(empHealth)), '--']] : []),
    [`<strong>Total Employer Cost</strong>`, '', `<strong>${cesc(fmt(employerTotal))}</strong>`, ''],
  ];
  const empContribCols: RuledColumn[] = [
    { label: 'Obligation', width: '42%' },
    { label: 'Rate', align: 'right', width: '13%' },
    { label: 'Current', align: 'right', width: '22%' },
    { label: 'Wage Base', align: 'right', width: '23%' },
  ];

  // ─ YTD summary table ─
  const ytdRows: string[][] = [
    [`<strong>Gross Earnings</strong>`, `<strong>${cesc(fmt(ytd.gross_pay))}</strong>`, `<strong>${cesc(fmt(annualGross))}</strong>`],
    ['Federal Income Tax', cesc(fmt(ytd.federal_tax)), cesc(fmt(ytd.federal_tax / yearFrac))],
    [`State Income Tax (${cesc(stateName)})`, cesc(fmt(ytd.state_tax)), cesc(fmt(ytd.state_tax / yearFrac))],
    ['Social Security (OASDI)', cesc(fmt(ytd.social_security)), cesc(fmt(ytd.social_security / yearFrac))],
    ['Medicare (HI)', cesc(fmt(ytd.medicare)), cesc(fmt(ytd.medicare / yearFrac))],
    [`<strong>Total Taxes YTD</strong>`, `<strong>${cesc(fmt(ytdTotalDed))}</strong>`, `<strong>${cesc(fmt(annualTax))}</strong>`],
    [`<strong>Net Pay YTD</strong>`, `<strong>${cesc(fmt(ytd.net_pay))}</strong>`, `<strong>${cesc(fmt(annualNet))}</strong>`],
  ];
  const ytdCols: RuledColumn[] = [
    { label: 'Category', width: '44%' },
    { label: 'YTD Amount', align: 'right', width: '28%' },
    { label: `Annualized (${(yearFrac * 100).toFixed(0)}% elapsed)`, align: 'right', width: '28%' },
  ];

  // ─ Hours-to-date table (hourly only) ─
  const hoursSummaryTable = !isSalaried ? ruledTable(
    [
      { label: 'Hours Type', width: '40%' },
      { label: 'Current Period', align: 'right', width: '30%' },
      { label: 'YTD', align: 'right', width: '30%' },
    ],
    [
      ['Regular', cesc(hoursRegular.toFixed(2)), cesc((stub.ytd_hours_regular != null ? stub.ytd_hours_regular : hoursRegular).toFixed(2))],
      ['Overtime', cesc(hoursOvertime.toFixed(2)), cesc((stub.ytd_hours_overtime != null ? stub.ytd_hours_overtime : hoursOvertime).toFixed(2))],
      [`<strong>Total</strong>`, `<strong>${cesc(totalHours.toFixed(2))}</strong>`, ''],
    ],
  ) : '';

  // ─ FICA wage base table (data preserved; bars→text) ─
  const ficaTable = ruledTable(
    [{ label: 'FICA Wage Base — 2026', width: '40%' }, { label: 'YTD Wages', align: 'right', width: '20%' }, { label: 'Limit', align: 'right', width: '18%' }, { label: '% Used', align: 'right', width: '12%' }, { label: 'Status', align: 'right', width: '10%' }],
    [
      ['Social Security (OASDI)', cesc(fmt(ytd.gross_pay)), '$182,100', cesc(ssPct.toFixed(1) + '%'), ytd.gross_pay >= 182100 ? '<strong>CAP REACHED</strong>' : 'Active'],
      ['Medicare Surtax Threshold', cesc(fmt(ytd.gross_pay)), '$200,000', cesc(medPct.toFixed(1) + '%'), ytd.gross_pay >= 200000 ? '<strong>SURTAX ACTIVE</strong>' : cesc('Remaining: ' + fmt(Math.max(0, 200000 - ytd.gross_pay)))],
    ],
  );

  // ─ Effective tax rate table (data preserved; colored boxes→table) ─
  const effRateTable = ruledTable(
    [{ label: 'Tax Rate Analysis', width: '50%' }, { label: 'Effective Rate', align: 'right', width: '50%' }],
    [
      ['Effective Federal Rate', cesc(effFedRate + '%')],
      [`Effective ${cesc(stateName)} State Rate`, cesc(effStateRate + '%')],
      ['FICA (SS + Medicare) Rate', cesc(effFicaRate + '%')],
      [`<strong>Total Tax Burden</strong>`, `<strong>${cesc(effTotalRate + '%')}</strong>`],
      [`Net of Gross`, `${cesc(netOfGrossPct)}%`],
    ],
  );

  // ─ Pay calculation detail (preserved verbatim data) ─
  const calcDetailRows: string[][] = [
    ...(isSalaried
      ? [[`Annual Salary`, payRate > 0 ? cesc(fmt(payRate)) : 'Per employment agreement', `÷ ${cesc(String(periodsPerYr))} periods`, `= ${cesc(fmt(stub.gross_pay))} / period`]]
      : [
          ['Regular Pay', `${cesc(hoursRegular.toFixed(2))} h × ${cesc(fmt(effectiveRate))}`, '', `= ${cesc(fmt(regularPay))}`],
          ...(hoursOvertime > 0 ? [['Overtime Pay', `${cesc(hoursOvertime.toFixed(2))} h × ${cesc(fmt(effectiveRate))} × 1.5`, '', `= ${cesc(fmt(overtimePay))}`]] : []),
          ['Gross Pay', `${cesc(fmt(regularPay))}${hoursOvertime > 0 ? ' + ' + cesc(fmt(overtimePay)) : ''}`, '', `= ${cesc(fmt(stub.gross_pay))}`],
        ]),
    ['Federal W/H', `Annualized ${cesc(fmt(stub.gross_pay * periodsPerYr))} − std ded → bracket ÷ ${cesc(String(periodsPerYr))}${stub.w4_step4c_extra ? ` + ${cesc(fmt(stub.w4_step4c_extra))} extra` : ''}`, '', `= ${cesc(fmt(stub.federal_tax))}`],
    [`${cesc(stateName)} W/H`, `Annualized × flat rate − exemption credits ÷ ${cesc(String(periodsPerYr))}`, '', `= ${cesc(fmt(stub.state_tax))}`],
    ['SS (OASDI)', `${cesc(fmt(Math.min(stub.gross_pay, Math.max(0, 182100 - (ytd.gross_pay - stub.gross_pay)))))} × 6.2%`, '', `= ${cesc(fmt(stub.social_security))}`],
    ['Medicare (HI)', `${cesc(fmt(stub.gross_pay))} × 1.45%`, '', `= ${cesc(fmt(stub.medicare))}`],
    [`<strong>Net Pay</strong>`, `${cesc(fmt(stub.gross_pay))} − ${cesc(fmt(taxDed))} taxes${preTax > 0 ? ' − ' + cesc(fmt(preTax)) + ' pre-tax' : ''}${postTax > 0 ? ' − ' + cesc(fmt(postTax)) + ' post-tax' : ''}`, '', `<strong>= ${cesc(fmt(stub.net_pay))}</strong>`],
  ];
  const calcDetailTable = ruledTable(
    [{ label: 'Pay Calculation Detail', width: '22%' }, { label: 'Basis', width: '50%' }, { label: '', width: '8%' }, { label: 'Amount', align: 'right', width: '20%' }],
    calcDetailRows,
  );

  // ─ Earnings composition table (data preserved; bar→table) ─
  const earningsCompTable = (!isSalaried && (regularPay + overtimePay) > 0)
    ? `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
      `<div class="sec-label" style="margin-bottom:6px;">Earnings Composition</div>` +
      ruledTable(
        [
          { label: 'Type', width: '25%' },
          { label: 'Hours', align: 'right', width: '15%' },
          { label: 'Rate', align: 'right', width: '20%' },
          { label: 'Amount', align: 'right', width: '20%' },
          { label: '% of Total', align: 'right', width: '20%' },
        ],
        earningsCompositionRows,
      ) +
      `</div>`
    : '';

  // ─ Gross→Net breakdown table (replaces donut; all data preserved) ─
  const grossNetBreakdownTable = stub.gross_pay > 0
    ? `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
      `<div class="sec-label" style="margin-bottom:6px;">Gross → Net Breakdown</div>` +
      ruledTable(
        [{ label: 'Category', width: '50%' }, { label: 'Amount', align: 'right', width: '25%' }, { label: '% of Gross', align: 'right', width: '25%' }],
        [
          ['Statutory Taxes', cesc(fmt(taxDed)), cesc((taxDed / stub.gross_pay * 100).toFixed(1) + '%')],
          ...(preTax > 0 ? [['Pre-Tax Deductions', cesc(fmt(preTax)), cesc((preTax / stub.gross_pay * 100).toFixed(1) + '%')]] : []),
          ...(postTax > 0 ? [['Post-Tax Deductions', cesc(fmt(postTax)), cesc((postTax / stub.gross_pay * 100).toFixed(1) + '%')]] : []),
          [`<strong>Net Pay</strong>`, `<strong>${cesc(fmt(stub.net_pay))}</strong>`, `<strong>${cesc((stub.net_pay / stub.gross_pay * 100).toFixed(1) + '%')}</strong>`],
        ],
      ) +
      `</div>`
    : '';

  // ─ Totals box ─
  const totals = totalsBox([
    { label: 'Gross Pay', value: fmt(stub.gross_pay) },
    ...(preTax > 0 ? [{ label: 'Pre-Tax Deductions', value: fmt(preTax) }] : []),
    ...(postTax > 0 ? [{ label: 'Post-Tax Deductions', value: fmt(postTax) }] : []),
    { label: 'Statutory Taxes', value: fmt(taxDed) },
    { label: 'Total Deductions', value: fmt(totalDed) },
    { label: 'Net Pay This Period', value: fmt(stub.net_pay), grand: true },
  ]);

  // ─ Notices (preserved verbatim) ─
  const noticesHtml = `<div style="padding:10px 16px;border-bottom:2px solid #000;font-size:9px;line-height:1.7;">` +
    `<div class="sec-label" style="margin-bottom:4px;">Important Information</div>` +
    `<div>&bull; Federal tax calculated per IRS Publication 15-T (2026) Percentage Method for Form W-4 (2020 or later).</div>` +
    `<div>&bull; ${cesc(stateName)} state tax calculated at the flat withholding rate per TC-40W, with applicable personal exemption credits.</div>` +
    `<div>&bull; Social Security (OASDI) tax applies to wages up to the annual wage base of $182,100 (2026). Once the cap is reached, no further SS tax is withheld for the remainder of the calendar year.</div>` +
    `<div>&bull; Medicare (HI) tax of 1.45% applies to all wages with no cap. Additional 0.9% Medicare surtax applies to combined wages exceeding $200,000 YTD (IRC &sect;3101(b)(2)).</div>` +
    `<div>&bull; Pre-tax deductions (401(k), HSA, health insurance) reduce taxable income for federal and state withholding but remain subject to FICA taxes unless specifically exempted.</div>` +
    `<div>&bull; This earnings statement is provided for informational purposes. Retain for your personal tax records. Report discrepancies to your employer within 30 days of receipt.</div>` +
    `<div>&bull; Employer contributions shown are paid by the employer and do not reduce your take-home pay. They represent additional compensation value beyond your gross earnings.</div>` +
    `</div>`;

  // ─ Direct deposit box ─
  const directDepositBox = (stub.bank_name || bankAcctDisplay)
    ? boxRow([
        { label: 'Direct Deposit — Bank', html: cesc(stub.bank_name || '—') },
        { label: 'Account (last 4 only)', html: cesc(bankAcctDisplay || '—') },
      ])
    : '';

  // ─ Assemble doc ─
  const body =
    header +
    meta +
    empInfoRow +
    `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">Earnings</div>` +
    ruledTable(earningsCols, earningsTableRows) +
    `</div>` +
    `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">Statutory Tax Withholdings</div>` +
    ruledTable(taxCols, taxRows) +
    `</div>` +
    (hasVoluntary
      ? `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
        `<div class="sec-label" style="margin-bottom:6px;">Voluntary Deductions</div>` +
        ruledTable(volCols, voluntaryRows) +
        `</div>`
      : '') +
    earningsCompTable +
    grossNetBreakdownTable +
    `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">Tax Rate Analysis</div>` +
    effRateTable +
    `</div>` +
    `<div style="padding:10px 16px 14px;border-bottom:2px solid #000;display:flex;justify-content:flex-end;">` +
    totals +
    `</div>` +
    directDepositBox +
    (hasEmployerContribs
      ? `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
        `<div class="sec-label" style="margin-bottom:4px;">Employer Contributions (Informational — Not Deducted from Pay)</div>` +
        ruledTable(empContribCols, empContribRows) +
        (hasEmployerContribs ? `<div style="padding:6px 0;font-size:10px;">Total Compensation This Period: <strong>${cesc(fmt(stub.gross_pay + employerTotal))}</strong> (Gross ${cesc(fmt(stub.gross_pay))} + Employer ${cesc(fmt(employerTotal))})</div>` : '') +
        `</div>`
      : '') +
    `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">Year-to-Date Summary</div>` +
    ruledTable(ytdCols, ytdRows) +
    `</div>` +
    (!isSalaried
      ? `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
        `<div class="sec-label" style="margin-bottom:6px;">Hours Summary</div>` +
        hoursSummaryTable +
        `</div>`
      : '') +
    `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">FICA Wage Base Tracking — 2026</div>` +
    ficaTable +
    `</div>` +
    `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">Pay Calculation Detail</div>` +
    calcDetailTable +
    `</div>` +
    noticesHtml +
    footerBar(`${cesc(coName)} · Pay Period ${cesc(stub.period_start)} – ${cesc(stub.period_end)} · Confidential Employee Pay Information — Retain for Tax Records`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pay Statement — ${cesc(stub.employee_name)}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(body) +
    `</body></html>`;
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
  // ── CLASSIC THEME: Arial + pure black/white ──

  // Map ReportColumn align to ruledTable align (ReportColumn only has left/right)
  const ruledCols: RuledColumn[] = columns.map(c => ({
    label: c.label,
    align: c.align === 'right' ? 'right' : 'left',
  }));

  // Build table rows — separator rows render as black band; bold rows get inline bold
  const tableRows: string[][] = rows.map(row =>
    columns.map(c => {
      const val = row[c.key];
      const display = c.format === 'currency'
        ? cesc(fmt(Number(val) || 0))
        : cesc(String(val ?? ''));
      if (row._bold || row._separator) {
        return `<strong>${display}</strong>`;
      }
      return display;
    })
  );

  // Count data rows (not separator/subtotal rows)
  const rowCount = rows.filter(r => !r._separator && !r._bold).length;

  // ── Header ──
  const header = docHeader({
    coName: companyName,
    coDetailHtml: dateRange ? cesc(dateRange) : '',
    title,
  });

  // ── Meta strip: report name, period, row count ──
  const meta = metaStrip([
    { label: 'Report',  value: title },
    { label: 'Period',  value: dateRange || '—' },
    { label: 'Entries', value: String(rowCount) },
  ]);

  // ── Main data table ──
  const dataTable = `<div style="padding:0;">${ruledTable(ruledCols, tableRows)}</div>`;

  // ── Summary section (replaces colored flex rows) ──
  const summaryHTML = summary && summary.length > 0
    ? `<div style="display:flex;justify-content:flex-end;padding:10px 16px;border-top:1px solid #000;">` +
      totalsBox(summary.map((s, i) => ({
        label: s.label,
        value: s.value,
        grand: i === summary.length - 1,
      }))) +
      `</div>`
    : '';

  // ── Footer ──
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const footerLine = [companyName, dateRange, `Generated ${generated}`].filter(Boolean).join(' · ');

  const inner =
    header +
    meta +
    dataTable +
    summaryHTML +
    footerBar(footerLine);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${cesc(title)} — ${cesc(companyName)}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(inner) +
    `</body></html>`;
}


// ═══════════════════════════════════════════════════════════════
// DEBT PORTFOLIO REPORT
// ═══════════════════════════════════════════════════════════════
export function generateDebtPortfolioReportHTML(
  debts: any[],
  collectedYtd: number,
  company: any
): string {
  // ── CLASSIC THEME: Arial + pure black/white ──

  const companyName = company?.name || 'Company';
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const now = Date.now();
  // TZ-safe parse for YYYY-MM-DD: anchor at noon local so UTC->local conversion doesn't shift the calendar day.
  const parseDateSafe = (raw: any): number => {
    if (!raw) return NaN;
    const s = String(raw);
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
    return dt.getTime();
  };
  const daysSince = (d: any): number => {
    const t = parseDateSafe(d.delinquent_date || d.created_at);
    if (!isFinite(t)) return 0;
    return Math.max(0, Math.floor((now - t) / 86_400_000));
  };
  const bucket = (d: any) => {
    const days = daysSince(d);
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

  // ── Header ──
  const header = docHeader({
    coName: companyName,
    coDetailHtml: cesc(today),
    title: 'Debt Portfolio',
  });

  // ── Portfolio totals meta strip ──
  const meta = metaStrip([
    { label: 'Total Accounts',    value: String(debts.length) },
    { label: 'Total Outstanding', value: fmt(totalBalance) },
    { label: 'Original Amount',   value: fmt(totalOriginal) },
    { label: 'Collected YTD',     value: fmt(collectedYtd) },
    { label: 'Recovery Rate',     value: `${recoveryRate}%` },
  ]);

  // ── Aging Breakdown — classic ruled table (replaces color bar chart; all data preserved) ──
  const agingSection = `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">Aging Breakdown</div>` +
    ruledTable(
      [
        { label: 'Age Bucket',  width: '30%' },
        { label: 'Accounts',    align: 'right', width: '15%' },
        { label: 'Balance',     align: 'right', width: '30%' },
        { label: '% of Total',  align: 'right', width: '25%' },
      ],
      Object.entries(buckets).map(([label, { count, amount }]) => [
        cesc(`${label} days`),
        cesc(String(count)),
        cesc(fmt(amount)),
        cesc(`${totalBalance > 0 ? ((amount / totalBalance) * 100).toFixed(1) : '0.0'}%`),
      ]),
    ) +
    `</div>`;

  // ── Pipeline Stage Breakdown — classic ruled table ──
  const stageSection = `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">Pipeline Stage Breakdown</div>` +
    ruledTable(
      [
        { label: 'Stage',      width: '55%' },
        { label: 'Count',      align: 'right', width: '20%' },
        { label: '% of Total', align: 'right', width: '25%' },
      ],
      Object.entries(stages).map(([stage, count]) => [
        cesc(stage.replace(/_/g, ' ')),
        cesc(String(count)),
        cesc(`${debts.length > 0 ? ((count / debts.length) * 100).toFixed(1) : '0.0'}%`),
      ]),
    ) +
    `</div>`;

  // ── Top 10 Accounts — classic ruled table (replaces colored age cells) ──
  const top10Section = `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:6px;">Top 10 Accounts by Balance</div>` +
    ruledTable(
      [
        { label: '#',       width: '6%' },
        { label: 'Debtor',  width: '34%' },
        { label: 'Balance', align: 'right', width: '22%' },
        { label: 'Age',     align: 'right', width: '13%' },
        { label: 'Stage',   width: '25%' },
      ],
      top10.map((d, i) => {
        const days = daysSince(d);
        return [
          cesc(String(i + 1)),
          cesc(d.debtor_name || '—'),
          cesc(fmt(Number(d.balance_due || 0))),
          cesc(`${days}d`),
          cesc((d.current_stage || '').replace(/_/g, ' ')),
        ];
      }),
    ) +
    `</div>`;

  // ── Feature #13: Risk Score Distribution — classic ruled table (replaces color histogram) ──
  const riskSection = (() => {
    const bands = [
      { label: 'Low',      min: 0,  max: 25  },
      { label: 'Medium',   min: 25, max: 50  },
      { label: 'High',     min: 50, max: 75  },
      { label: 'Critical', min: 75, max: 101 },
    ];
    const counts = bands.map(b => debts.filter(d => {
      const r = Number(d.risk_score ?? d.risk ?? -1);
      return r >= b.min && r < b.max;
    }).length);
    if (counts.reduce((s, x) => s + x, 0) === 0) return '';
    const total = counts.reduce((s, x) => s + x, 0);
    return `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
      `<div class="sec-label" style="margin-bottom:6px;">Risk Score Distribution</div>` +
      ruledTable(
        [
          { label: 'Band',       width: '25%' },
          { label: 'Range',      width: '25%' },
          { label: 'Count',      align: 'right', width: '25%' },
          { label: '% of Total', align: 'right', width: '25%' },
        ],
        bands.map((b, i) => [
          cesc(b.label),
          cesc(`${b.min}–${b.max === 101 ? '100' : b.max}`),
          cesc(String(counts[i])),
          cesc(`${total > 0 ? ((counts[i] / total) * 100).toFixed(1) : '0.0'}%`),
        ]),
      ) +
      `</div>`;
  })();

  // ── Feature #14: Top Collectors — classic ruled table (replaces color bar chart) ──
  const collectorsSection = (() => {
    const byCollector: Record<string, number> = {};
    debts.forEach(d => {
      const name = d.collector_name || d.assigned_to_name || d.collector || d.assigned_collector || '';
      const collected = Number(d.amount_collected || d.collected || (Number(d.original_amount || 0) - Number(d.balance_due || 0)));
      if (!name || !isFinite(collected) || collected <= 0) return;
      byCollector[name] = (byCollector[name] || 0) + collected;
    });
    const top = Object.entries(byCollector).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length === 0) return '';
    const totalCollected = top.reduce((s, [, v]) => s + v, 0);
    return `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
      `<div class="sec-label" style="margin-bottom:6px;">Top Collectors</div>` +
      ruledTable(
        [
          { label: 'Collector',  width: '55%' },
          { label: 'Collected',  align: 'right', width: '25%' },
          { label: '% of Group', align: 'right', width: '20%' },
        ],
        top.map(([name, amt]) => [
          cesc(name),
          cesc(fmt(amt)),
          cesc(`${totalCollected > 0 ? ((amt / totalCollected) * 100).toFixed(1) : '0.0'}%`),
        ]),
      ) +
      `</div>`;
  })();

  // ── Totals box ──
  const portfolioTotals = totalsBox([
    { label: 'Total Outstanding', value: fmt(totalBalance) },
    { label: 'Collected YTD',     value: fmt(collectedYtd) },
    { label: 'Recovery Rate',     value: `${recoveryRate}%`, grand: true },
  ]);

  // ── Footer (legal disclaimer preserved as plain text) ──
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const footerLine = [
    companyName,
    `Generated ${generated}`,
    'This communication may contain privileged or confidential information. Unauthorized disclosure is prohibited.',
  ].join(' · ');

  const inner =
    header +
    meta +
    agingSection +
    stageSection +
    top10Section +
    riskSection +
    collectorsSection +
    `<div style="display:flex;justify-content:flex-end;padding:10px 16px;border-top:1px solid #000;">${portfolioTotals}</div>` +
    footerBar(footerLine);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Debt Portfolio — ${cesc(companyName)}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(inner) +
    `</body></html>`;

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
  const companyName = esc(company?.name || 'Your Company');
  const cityStateZip = [company?.city, company?.state].filter(Boolean).join(', ') + (company?.zip ? ' ' + company.zip : '');
  const _companyAddrRaw = [company?.address_line1, company?.address_line2, cityStateZip.trim()].filter(s => s && String(s).trim()).join(', ');
  const companyAddrEsc = esc(_companyAddrRaw);
  const deadlineDays = options.deadline_days ?? 10;
  const deadlineDate = new Date(Date.now() + deadlineDays * 86_400_000)
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const todayLong = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // DATE: Item #4 — noon-anchor instead of midnight; midnight UTC parses as
  // previous day in TZ west of UTC and renders as the wrong calendar date.
  const fmtDateLocal = (s: string) => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balanceDue = Number(debt.balance_due || 0);
  const originalAmount = Number(debt.original_amount || 0);
  const interest = Number(debt.interest_accrued || 0);
  const fees = Number(debt.fees_accrued || 0);

  const acctNum = (debt.debt_number || debt.id || '').toString().slice(0, 12).toUpperCase() || 'N/A';
  const phone = esc(company?.phone || '');
  const email = esc(company?.email || '');
  const jurisdiction = esc(debt?.jurisdiction || '[your state of residence]');
  const sigName = esc(options.signatory_name || 'Authorized Representative');
  const sigTitle = esc(options.signatory_title || 'Accounts Receivable Manager');

  // ── Feature #10: days overdue — classic plain-text indicator ──
  const delinqRaw = debt.delinquent_date || debt.due_date || debt.created_at;
  const daysOverdue = delinqRaw ? Math.max(0, Math.floor((Date.now() - new Date(delinqRaw + (typeof delinqRaw === 'string' && delinqRaw.length === 10 ? 'T12:00:00' : '')).getTime()) / 86_400_000)) : 0;
  // Classic: render days-overdue as a plain bordered text block (no color fill)
  const daysOverdueHTML = daysOverdue > 0
    ? `<div style="border:1px solid #000;padding:8px 14px;margin:12px 0;font-family:Arial,sans-serif;font-size:10pt;page-break-inside:avoid;">` +
      `<span style="font-weight:700;text-transform:uppercase;letter-spacing:1px;">Days Overdue:</span>` +
      `<span style="font-size:18pt;font-weight:800;font-variant-numeric:tabular-nums;margin-left:10px;">${daysOverdue}${daysOverdue >= 126 ? '+' : ''}</span>` +
      `<span style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-left:6px;">days</span></div>`
    : '';

  // ── Feature #9: aging bucket — classic text table (no color bars) ──
  const ageBuckets = [
    { label: 'Current (0–30)', max: 30 },
    { label: '31–60 days', max: 60 },
    { label: '61–90 days', max: 90 },
    { label: '90+ days', max: Infinity },
  ];
  const activeBucketIdx = ageBuckets.findIndex(b => daysOverdue <= b.max);
  const activeBucket = activeBucketIdx >= 0 ? activeBucketIdx : ageBuckets.length - 1;
  const agingBarHTML = balanceDue > 0
    ? `<div style="margin:8px 0 14px;font-family:Arial,sans-serif;font-size:10pt;page-break-inside:avoid;">` +
      `<div style="font-weight:700;text-transform:uppercase;letter-spacing:0.8px;font-size:9pt;margin-bottom:4px;">Aging Status</div>` +
      `<table style="width:100%;border-collapse:collapse;font-size:9.5pt;"><tbody><tr>` +
      ageBuckets.map((b, i) =>
        `<td style="border:1px solid #000;padding:5px 8px;text-align:center;font-weight:${i === activeBucket ? '800' : '400'};${i === activeBucket ? 'text-decoration:underline;' : ''}">${b.label}${i === activeBucket ? ' ◄' : ''}</td>`
      ).join('') +
      `</tr></tbody></table></div>`
    : '';

  // ── Feature #19: balance breakdown — classic ruled mini-table (no donut) ──
  const totalDueDonutHTML = (() => {
    const total = originalAmount + interest + fees;
    if (total <= 0) return '';
    const rows: Array<[string, number]> = [
      ['Principal', originalAmount],
      ['Interest', interest],
      ['Fees', fees],
    ].filter(([, v]) => (v as number) > 0) as Array<[string, number]>;
    if (rows.length === 0) return '';
    return `<div style="float:right;margin:0 0 12px 14px;width:200px;font-family:Arial,sans-serif;font-size:9.5pt;border:1px solid #000;page-break-inside:avoid;">` +
      `<div style="background:#000;color:#fff;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:1px;padding:4px 8px;">Balance Breakdown</div>` +
      `<table style="width:100%;border-collapse:collapse;"><tbody>` +
      rows.map(([lbl, v]) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #000;">${lbl}</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #000;font-variant-numeric:tabular-nums;">${fmt(v)}</td></tr>`
      ).join('') +
      (totalPaid > 0 ? `<tr><td style="padding:4px 8px;border-bottom:1px solid #000;">Less Paid</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #000;font-variant-numeric:tabular-nums;">(${fmt(totalPaid)})</td></tr>` : '') +
      `</tbody></table></div>`;
  })();

  // Classic co-detail for letterhead
  const coDetailHtml = `${companyAddrEsc}${phone ? `<br>Tel: ${phone}` : ''}${email ? `<br>${email}` : ''}`;

  // Payment schedule rows (classic ruled table)
  const paymentTableHTML = payments.length > 0
    ? ruledTable(
        [
          { label: 'Date' },
          { label: 'Amount', align: 'right' as const },
          { label: 'Method' },
          { label: 'Reference' },
        ],
        payments.map(p => [
          esc(fmtDateLocal(p.received_date)),
          esc(fmt(Number(p.amount || 0))),
          esc(p.method || '—'),
          esc(p.reference_number || '—'),
        ])
      )
    : '';

  const logoHtml = logoImg(company?.logo_data, company?.name);

  const headerHtml = docHeader({
    coName: company?.name || 'Your Company',
    coDetailHtml: (logoHtml ? logoHtml + '<br>' : '') + coDetailHtml,
    title: 'Demand Letter',
    number: `Account #${acctNum}`,
  });

  const dateRecipientBoxHtml = boxRow([
    {
      label: 'Date',
      html: `<div style="font-size:11pt;">${esc(todayLong)}</div>`,
    },
    {
      label: 'Debtor / Recipient',
      html: `<strong>${esc(debt.debtor_name || 'To Whom It May Concern')}</strong>` +
        (debt.debtor_address ? `<br>${esc(debt.debtor_address).replace(/\n/g, '<br>')}` : '') +
        (debt.debtor_email ? `<br>${esc(debt.debtor_email)}` : ''),
    },
  ]);

  const amountSummaryHtml = totalsBox([
    { label: 'Original Principal Amount', value: fmt(originalAmount) },
    { label: 'Interest Accrued', value: fmt(interest) },
    { label: 'Fees and Charges Accrued', value: fmt(fees) },
    { label: 'Payments Received and Applied', value: `(${fmt(totalPaid)})` },
    { label: 'TOTAL DUE', value: fmt(balanceDue), grand: true },
  ]);

  // FDCPA validation notice — verbatim
  const fdcpaNoticeHtml =
    `<div style="border:1.5px solid #000;padding:12px 16px;margin:18px 0;font-family:Arial,sans-serif;font-size:10pt;line-height:1.6;page-break-inside:avoid;">` +
    `<div style="font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;font-size:9.5pt;">Notice of Your Rights — Validation of Debt (15 U.S.C. &sect; 1692g)</div>` +
    `<p style="margin:0;text-indent:0;">Unless you notify this office within 30 days after receiving this notice that you dispute the validity of this debt or any portion thereof, this office will assume this debt is valid. If you notify this office in writing within 30 days from receiving this notice that you dispute the validity of this debt or any portion thereof, this office will: obtain verification of the debt or obtain a copy of a judgment and mail you a copy of such judgment or verification. If you request this office in writing within 30 days after receiving this notice, this office will provide you with the name and address of the original creditor, if different from the current creditor.</p>` +
    `</div>`;

  // Mini-Miranda — verbatim
  const miniMirandaHtml =
    `<div style="border-top:1px solid #000;border-bottom:1px solid #000;padding:7px 0;margin:16px 0;text-align:center;font-family:Arial,sans-serif;font-size:9pt;font-style:italic;">` +
    `This communication is from a debt collector. This is an attempt to collect a debt and any information obtained will be used for that purpose.` +
    `</div>`;

  const bodyHtml =
    headerHtml +
    dateRecipientBoxHtml +
    `<div style="padding:14px 16px;font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;">` +
    `<div style="font-weight:700;font-size:11pt;margin-bottom:12px;">RE: Outstanding Debt — Account #${acctNum}</div>` +
    `<p style="margin-bottom:10px;">Dear ${esc(debt.debtor_name || 'Sir or Madam')}:</p>` +
    `<p style="margin-bottom:10px;">This letter constitutes formal demand for payment of an outstanding obligation owed by you to <strong>${companyName}</strong>. Our records establish that you are indebted to ${companyName} in the sum identified below, and that despite the passage of the applicable due date this balance remains unsatisfied.</p>` +
    daysOverdueHTML +
    agingBarHTML +
    totalDueDonutHTML +
    `<div style="margin:16px 0;">${amountSummaryHtml}</div>` +
    (payments.length > 0
      ? `<div style="font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:0.5px;margin:18px 0 6px;">Schedule of Payments Received</div>${paymentTableHTML}`
      : '') +
    `<p style="margin:14px 0;"><strong>YOU ARE HEREBY DEMANDED to pay the sum of ${fmt(balanceDue)} within ${deadlineDays} days from the date of this letter, on or before ${deadlineDate}.</strong> Payment must be tendered in certified funds and made payable to ${companyName}${options.payment_address ? `, addressed to ${esc(options.payment_address)}` : ''}.${options.online_payment_url ? ` Electronic remittance may be made at ${esc(options.online_payment_url)}.` : ''}</p>` +
    `<p style="margin-bottom:10px;">Should you fail to remit payment in full by the date stated above, ${companyName} will have no alternative but to pursue all lawful remedies available to it under the laws of ${jurisdiction}, including but not limited to the institution of civil proceedings to obtain a money judgment, recovery of court costs and reasonable attorneys' fees as permitted by contract or statute, post-judgment enforcement (including wage garnishment, bank levy, and judgment liens upon real property), and reporting of the delinquency to consumer credit reporting agencies.</p>` +
    fdcpaNoticeHtml +
    miniMirandaHtml +
    `<p style="margin-bottom:10px;">If you believe this debt has been satisfied or has been asserted in error, or if you wish to discuss a mutually acceptable resolution, please contact the undersigned in writing at the address above${phone ? ` or by telephone at ${phone}` : ''}${email ? ` or by email at ${email}` : ''} prior to the deadline stated herein.</p>` +
    `<p style="margin-top:28px;">Respectfully,</p>` +
    `<div style="margin-top:36px;border-bottom:1px solid #000;width:260px;"></div>` +
    `<div style="font-weight:700;margin-top:4px;font-family:Arial,sans-serif;font-size:10pt;">${sigName}</div>` +
    `<div style="color:#333;font-size:9.5pt;font-family:Arial,sans-serif;">${sigTitle}</div>` +
    `<div style="color:#333;font-size:9.5pt;font-family:Arial,sans-serif;">${companyName}</div>` +
    `</div>` +
    footerBar(`This communication may contain privileged or confidential information intended solely for the addressee. Sent on ${todayLong} via U.S. First Class Mail. Account #${acctNum}.`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Demand Letter — ${esc(debt.debtor_name)}</title>` +
    `<style>${classicStyles()}@page{size:letter;margin:1in;}</style></head>` +
    `<body style="background:#fff;">${docFrame(bodyHtml)}</body></html>`;
}
export function generateCollectionLetterHTML(
  debt: any,
  payments: any[],
  company: any,
  letterType: string,
): string {
  const companyName = esc(company?.name || 'Your Company');
  const _cityStateZip2 = [company?.city, company?.state].filter(Boolean).join(', ') + (company?.zip ? ' ' + company.zip : '');
  const companyAddr = esc([company?.address_line1, company?.address_line2, _cityStateZip2.trim()].filter(s => s && String(s).trim()).join(', '));
  const companyPhone = esc(company?.phone || '');
  const companyEmail = esc(company?.email || '');
  const todayLong = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmtAmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);
  const debtorName = esc(debt?.debtor_name || 'Account Holder');
  const debtorAddr = esc(debt?.debtor_address || '');
  const balanceDue = debt?.balance_due || 0;
  const originalAmt = debt?.original_amount || 0;
  const interestAmt = debt?.interest_accrued || 0;
  const feesAmt = debt?.fees_accrued || 0;
  const dueDate = debt?.due_date ? new Date(debt.due_date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const totalPaid = payments?.reduce((s: number, p: any) => s + (p.amount || 0), 0) || 0;
  const deadlineDate = new Date(Date.now() + 10 * 86_400_000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const thirtyDayDate = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Classic amount summary — totalsBox
  const amountSummaryHtml = totalsBox([
    { label: 'Original Amount', value: fmtAmt(originalAmt) },
    { label: 'Interest Accrued', value: fmtAmt(interestAmt) },
    { label: 'Fees & Charges', value: fmtAmt(feesAmt) },
    { label: 'Payments Received', value: `−${fmtAmt(totalPaid)}` },
    { label: 'BALANCE DUE', value: fmtAmt(balanceDue), grand: true },
  ]);

  // Shared blocks
  // SECURITY: source_id is a renderer-supplied UUID, but defensive escape keeps
  // it from breaking out of HTML if a malformed/legacy id ever sneaks in.
  const accountRef = debt?.source_type === 'invoice'
    ? `Invoice #${esc((debt?.source_id || '').substring(0, 8).toUpperCase())}`
    : debt?.source_type === 'bill' ? `Bill #${esc((debt?.source_id || '').substring(0, 8).toUpperCase())}` : 'Manual Entry';
  const delinquentDate = debt?.delinquent_date ? new Date(debt.delinquent_date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const jurisdiction = esc(debt?.jurisdiction || 'the applicable jurisdiction');
  const interestRate = debt?.interest_rate ? `${(debt.interest_rate * 100).toFixed(2)}% per annum (${debt.interest_type === 'compound' ? 'compound' : 'simple'})` : 'N/A';
  const daysOverdue = debt?.delinquent_date ? Math.max(0, Math.floor((Date.now() - new Date(String(debt.delinquent_date).length === 10 ? debt.delinquent_date + 'T12:00:00' : debt.delinquent_date).getTime()) / 86_400_000)) : 0;
  const settlementAmt = Math.round(balanceDue * 0.7 * 100) / 100;

  // Account reference key-value block — classic metaStrip
  const accountRefBlock = metaStrip([
    { label: 'Original Due Date', value: dueDate },
    { label: 'Date Delinquent', value: delinquentDate },
    { label: 'Days Past Due', value: `${daysOverdue} days` },
    { label: 'Interest Rate', value: interestRate },
    { label: 'Jurisdiction', value: jurisdiction },
    { label: 'Balance Due', value: fmtAmt(balanceDue) },
  ]);

  // Payment instructions — classic bordered block
  const paymentInstructions =
    `<div style="margin:16px 0;border:1px solid #000;font-family:Arial,sans-serif;font-size:10pt;">` +
    `<div style="background:#000;color:#fff;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:1px;padding:4px 8px;">Payment Instructions</div>` +
    `<div style="padding:10px 14px;">` +
    `<p style="margin:0 0 6px 0;">Make checks payable to <strong>${companyName}</strong> and mail to:<br>${companyAddr || '[Company Address]'}</p>` +
    (companyPhone ? `<p style="margin:0 0 4px 0;">Phone: ${companyPhone}</p>` : '') +
    (companyEmail ? `<p style="margin:0 0 4px 0;">Email: ${companyEmail}</p>` : '') +
    `<p style="margin:6px 0 0 0;font-size:9.5pt;">Please include your account reference <strong>${accountRef}</strong> with all correspondence and payments.</p>` +
    `</div></div>`;

  // FDCPA notice — verbatim text preserved
  const fdcpaNotice =
    `<div style="margin:16px 0;border:1.5px solid #000;font-family:Arial,sans-serif;font-size:10pt;line-height:1.7;page-break-inside:avoid;">` +
    `<div style="background:#000;color:#fff;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:1px;padding:4px 8px;">Your Rights Under Federal Law</div>` +
    `<div style="padding:10px 14px;">` +
    `<p style="margin:0 0 6px 0;">Under the Fair Debt Collection Practices Act (15 U.S.C. &sect; 1692 et seq.), you have the right to:</p>` +
    `<ul style="margin:6px 0;padding-left:20px;">` +
    `<li>Dispute this debt in writing within thirty (30) days of receiving this notice.</li>` +
    `<li>Request the name and address of the original creditor, if different from the current creditor.</li>` +
    `<li>Request verification of the debt, including the amount owed and the name of the creditor.</li>` +
    `</ul>` +
    `<p style="margin:6px 0 0 0;">If you dispute this debt in writing within the 30-day period, ${companyName} will cease collection activities until verification has been provided to you. Unless you dispute this debt within 30 days after receipt of this notice, the debt will be assumed to be valid.</p>` +
    `</div></div>`;

  const LETTERS: Record<string, { title: string; body: string }> = {
    reminder: {
      title: 'Payment Reminder',
      body: `<p>We are writing to remind you that the following account has a past-due balance that requires your attention.</p>` +
        accountRefBlock + amountSummaryHtml +
        `<p>Our records indicate that a payment of <strong>${fmtAmt(balanceDue)}</strong> was due on <strong>${dueDate}</strong> and remains unpaid as of the date of this letter. The account is now <strong>${daysOverdue} days past due</strong>.</p>` +
        `<p>We understand that oversights can occur. If you have already submitted payment, please disregard this notice and accept our thanks. If payment has not yet been sent, we kindly request that you remit the amount due at your earliest convenience to avoid additional fees or collection activity.</p>` +
        paymentInstructions +
        `<p>If you are experiencing financial difficulty and would like to discuss a payment arrangement, please contact us at ${companyPhone || companyEmail || 'the number on file'}. We are committed to working with you to resolve this matter amicably.</p>`,
    },
    warning: {
      title: 'Warning Notice — Second Notice',
      body: `<p>Despite our previous correspondence dated on or about your original due date of ${dueDate}, the balance on your account remains unpaid. This letter serves as a <strong>formal warning</strong> that failure to resolve this matter may result in additional consequences.</p>` +
        accountRefBlock + amountSummaryHtml +
        `<p><strong>Please be advised that if payment is not received by ${thirtyDayDate}, the following actions may be taken:</strong></p>` +
        `<ul style="margin:12px 0;padding-left:24px;line-height:1.9;">` +
        `<li>Assessment of additional late fees and collection costs as permitted by law</li>` +
        `<li>Accrual of interest at a rate of ${interestRate} on the outstanding balance</li>` +
        `<li>Referral of this account to a third-party collections agency</li>` +
        `<li>Reporting of the delinquent account to one or more consumer credit reporting bureaus</li>` +
        `</ul>` +
        `<p>We strongly urge you to contact our office immediately to make payment or to arrange a mutually agreeable payment plan. This is your opportunity to resolve this debt before more serious measures are taken.</p>` +
        paymentInstructions + fdcpaNotice,
    },
    final_notice: {
      title: 'Final Notice Before Legal Action',
      body: `<p><strong>This is your final notice. Immediate action is required.</strong></p>` +
        `<p>Multiple attempts have been made to resolve the outstanding balance on your account. As of the date of this letter, no payment or satisfactory response has been received. Your account is now <strong>${daysOverdue} days past due</strong>.</p>` +
        accountRefBlock + amountSummaryHtml +
        `<p><strong>Unless full payment of ${fmtAmt(balanceDue)} or a satisfactory payment arrangement is received by ${deadlineDate}, ${companyName} intends to pursue one or more of the following remedies without further notice:</strong></p>` +
        `<ul style="margin:12px 0;padding-left:24px;line-height:1.9;">` +
        `<li>Filing a civil complaint in the appropriate court in ${jurisdiction}</li>` +
        `<li>Seeking a monetary judgment for the full amount owed plus court costs, attorney fees, and accrued interest</li>` +
        `<li>Pursuing post-judgment remedies including wage garnishment, bank levy, and/or property lien</li>` +
        `<li>Reporting the delinquent account and any resulting judgment to all major credit bureaus</li>` +
        `<li>Referral to an external collections agency or law firm for further action</li>` +
        `</ul>` +
        `<p>A judgment against you may remain on your credit report for up to seven (7) years and may affect your ability to obtain credit, housing, or employment.</p>` +
        `<p><strong>To avoid legal proceedings, please remit payment or contact us immediately to discuss resolution options.</strong></p>` +
        paymentInstructions + fdcpaNotice,
    },
    demand: {
      title: 'Formal Demand for Payment',
      body: `<p style="font-weight:700;">RE: DEMAND FOR PAYMENT — ${accountRef}</p>` +
        `<p>This letter constitutes a formal demand for payment pursuant to the laws of ${jurisdiction}. Please treat this correspondence with the utmost seriousness.</p>` +
        accountRefBlock + amountSummaryHtml +
        `<p>The above-referenced debt arises from an obligation originally in the amount of <strong>${fmtAmt(originalAmt)}</strong>, which became due and payable on <strong>${dueDate}</strong>. Despite the passage of <strong>${daysOverdue} days</strong> since the date of delinquency, the obligation remains unsatisfied. Interest continues to accrue at a rate of <strong>${interestRate}</strong> until the balance is paid in full.</p>` +
        `<p><strong>DEMAND:</strong> You are hereby demanded to pay the total sum of <strong>${fmtAmt(balanceDue)}</strong> within <strong>ten (10) calendar days</strong> of the date of this letter (i.e., by <strong>${deadlineDate}</strong>).</p>` +
        `<p><strong>CONSEQUENCES OF NON-PAYMENT:</strong> If payment is not received by the above deadline, ${companyName} reserves the right to, and intends to, commence legal proceedings against you in a court of competent jurisdiction in ${jurisdiction} to recover the full amount owed, together with:</p>` +
        `<ul style="margin:12px 0;padding-left:24px;line-height:1.9;">` +
        `<li>Pre-judgment and post-judgment interest at the maximum rate permitted by law</li>` +
        `<li>Court costs, filing fees, and service of process expenses</li>` +
        `<li>Reasonable attorney fees as permitted by contract or statute</li>` +
        `<li>All additional collection costs and administrative expenses</li>` +
        `</ul>` +
        `<p>This letter may be tendered as evidence of demand in any subsequent legal proceeding.</p>` +
        paymentInstructions + fdcpaNotice,
    },
    settlement_offer: {
      title: 'Settlement Offer',
      body: `<p>In an effort to resolve the outstanding balance on your account without the need for further collection activity or legal proceedings, ${companyName} is prepared to offer the following settlement.</p>` +
        accountRefBlock + amountSummaryHtml +
        `<div style="border:1.5px solid #000;padding:12px 16px;text-align:center;margin:16px 0;font-family:Arial,sans-serif;page-break-inside:avoid;">` +
        `<div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Settlement Amount</div>` +
        `<div style="font-size:22pt;font-weight:800;font-variant-numeric:tabular-nums;margin:4px 0;">${fmtAmt(settlementAmt)}</div>` +
        `<div style="font-size:10pt;">(${Math.round((settlementAmt / balanceDue) * 100)}% of current balance — a savings of ${fmtAmt(balanceDue - settlementAmt)})</div>` +
        `</div>` +
        `<p><strong>Terms of this offer:</strong></p>` +
        `<ul style="margin:12px 0;padding-left:24px;line-height:1.9;">` +
        `<li>Payment of <strong>${fmtAmt(settlementAmt)}</strong> must be received in full by <strong>${thirtyDayDate}</strong>.</li>` +
        `<li>Payment must be made by certified check, cashier's check, or wire transfer.</li>` +
        `<li>Upon receipt of payment, ${companyName} will consider this account <strong>settled in full</strong> and cease all further collection activity.</li>` +
        `<li>A written confirmation of settlement will be provided within ten (10) business days of payment.</li>` +
        `<li>This offer is made without prejudice and does not constitute an admission that the balance owed is less than the full amount.</li>` +
        `</ul>` +
        `<p><strong>This offer expires on ${thirtyDayDate}.</strong> If payment is not received by that date, the offer is automatically withdrawn and the full balance of <strong>${fmtAmt(balanceDue)}</strong> will remain due and subject to continued collection activity, including legal action.</p>` +
        paymentInstructions +
        `<p style="font-size:9.5pt;">To accept this offer, please remit payment referencing account <strong>${accountRef}</strong> and write "Settlement" on the memo line of your check.</p>`,
    },
    payment_confirmation: {
      title: 'Payment Confirmation & Account Update',
      body: `<p>We are writing to confirm receipt of your recent payment and to provide an updated summary of your account.</p>` +
        accountRefBlock +
        `<div style="border:1.5px solid #000;padding:12px 16px;text-align:center;margin:16px 0;font-family:Arial,sans-serif;page-break-inside:avoid;">` +
        `<div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Payment Received</div>` +
        `<div style="font-size:22pt;font-weight:800;font-variant-numeric:tabular-nums;margin:4px 0;">${fmtAmt(totalPaid)}</div>` +
        `<div style="font-size:10pt;">Applied to your account on ${todayLong}</div>` +
        `</div>` +
        amountSummaryHtml +
        (balanceDue <= 0
          ? `<p style="font-weight:700;">Your account balance is now <strong>$0.00</strong>. This account is considered <strong>paid in full</strong>.</p>` +
            `<p>Thank you for resolving this matter. No further action is required on your part. If you require a formal payoff letter or receipt for your records, please contact our office and we will provide one promptly.</p>`
          : `<p>Thank you for your payment. Please note that a remaining balance of <strong>${fmtAmt(balanceDue)}</strong> is still outstanding on this account.</p>` +
            `<p>Interest continues to accrue at a rate of <strong>${interestRate}</strong> on the unpaid balance. We encourage you to remit the remaining balance as soon as possible to avoid additional charges and to bring your account to good standing.</p>` +
            `<p>If you would like to set up a payment plan for the remaining balance, please contact us at ${companyPhone || companyEmail || 'the number on file'} to discuss available options.</p>`) +
        paymentInstructions +
        `<p style="font-size:9.5pt;">Please retain this letter for your records. If you believe there is a discrepancy in the payment amount or account balance shown above, contact our office within ten (10) business days.</p>`,
    },
  };

  const letter = LETTERS[letterType] || LETTERS.reminder;

  // Payment options block — classic bordered
  const paymentOptions =
    `<div style="border:1.5px solid #000;margin:16px 0;font-family:Arial,sans-serif;font-size:10pt;page-break-inside:avoid;">` +
    `<div style="background:#000;color:#fff;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:1px;padding:4px 8px;">Payment Options</div>` +
    `<div style="padding:10px 14px;">` +
    `<p style="margin:0 0 4px 0;"><strong>By Mail:</strong> Send check or money order to ${companyName}, ${companyAddr || '[Company Address]'}.</p>` +
    `<p style="margin:0 0 4px 0;"><strong>By ACH / Bank Transfer:</strong> Contact our office${companyPhone ? ' at ' + companyPhone : ''} for routing instructions.</p>` +
    `<p style="margin:0;"><strong>Online:</strong> Visit our payment portal or contact us${companyEmail ? ' at ' + companyEmail : ''} for the secure payment link.</p>` +
    `</div></div>`;

  // Mini-Miranda — verbatim
  const miniMiranda =
    `<div style="border-top:1px solid #000;border-bottom:1px solid #000;padding:7px 0;margin:16px 0;text-align:center;font-family:Arial,sans-serif;font-size:9pt;font-style:italic;">` +
    `This communication is from a debt collector. This is an attempt to collect a debt and any information obtained will be used for that purpose.` +
    `</div>`;

  // Remit slip — classic: dashed border box, plain text
  // FIX (2026-05-25): uses CSS letter-spacing on a single string + white-space:nowrap
  const remitSlip =
    `<div style="border:1.5px dashed #000;margin-top:28px;padding:16px 20px;font-family:Arial,sans-serif;font-size:9.5pt;page-break-inside:avoid;">` +
    `<div style="text-align:center;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.42em;white-space:nowrap;overflow:hidden;margin-bottom:10px;padding-bottom:8px;border-bottom:1px dashed #000;">&#9986; &nbsp;&nbsp; Detach and return with payment &nbsp;&nbsp; &#9986;</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;margin-bottom:10px;">` +
    `<div><div style="font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#000;margin-bottom:2px;">Remit to</div>` +
    `<div><strong>${companyName}</strong></div><div style="font-size:9pt;">${companyAddr || ''}</div></div>` +
    `<div><div style="font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#000;margin-bottom:2px;">From</div>` +
    `<div><strong>${debtorName}</strong></div><div style="font-size:9pt;">${debtorAddr || ''}</div></div>` +
    `<div><div style="font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#000;margin-bottom:2px;">Account reference</div>` +
    `<div><strong>${accountRef}</strong></div></div>` +
    `<div><div style="font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#000;margin-bottom:2px;">Amount enclosed</div>` +
    `<div>$ <span style="display:inline-block;border-bottom:1px solid #000;min-width:80px;"></span></div></div>` +
    `<div><div style="font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#000;margin-bottom:2px;">Balance due</div>` +
    `<div style="font-weight:800;font-variant-numeric:tabular-nums;">${fmtAmt(balanceDue)}</div></div>` +
    `<div><div style="font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#000;margin-bottom:2px;">Date</div>` +
    `<div><span style="display:inline-block;border-bottom:1px solid #000;min-width:120px;"></span></div></div>` +
    `</div>` +
    `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #000;font-size:8pt;font-style:italic;text-align:center;">Make checks payable to ${companyName}. Include account reference ${accountRef} on the memo line.</div>` +
    `</div>`;

  const logoHtml = logoImg(company?.logo_data, company?.name);
  const coDetailHtml = `${companyAddr || ''}${companyPhone ? `<br>Tel: ${companyPhone}` : ''}${companyEmail ? `<br>${companyEmail}` : ''}`;

  const headerHtml = docHeader({
    coName: company?.name || 'Your Company',
    coDetailHtml: (logoHtml ? logoHtml + '<br>' : '') + coDetailHtml,
    title: esc(letter.title),
    numberHtml: `<div style="margin-top:4px;font-size:10pt;">${todayLong}</div><div style="font-size:10pt;margin-top:2px;">${accountRef}</div>`,
  });

  const recipientBoxHtml = boxRow([
    {
      label: 'Addressed To',
      html: `<strong>${debtorName}</strong>` + (debtorAddr ? `<br>${debtorAddr}` : ''),
    },
  ]);

  const bodyHtml =
    headerHtml +
    recipientBoxHtml +
    `<div style="padding:14px 16px;font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;">` +
    `<p>Dear ${debtorName}:</p>` +
    letter.body +
    `</div>` +
    paymentOptions +
    `<div style="padding:0 16px;">` +
    miniMiranda +
    `<div style="margin-top:28px;font-family:Arial,sans-serif;">` +
    `<p style="margin-bottom:0;">Sincerely,</p>` +
    `<div style="border-bottom:1px solid #000;width:260px;margin-top:28px;"></div>` +
    `<div style="font-weight:700;margin-top:4px;font-size:10pt;">${companyName}</div>` +
    `<div style="font-size:9.5pt;">Collections Department</div>` +
    `</div>` +
    remitSlip +
    `</div>` +
    footerBar('This communication may contain privileged or confidential information intended solely for the addressee.');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(letter.title)} — ${debtorName}</title>` +
    `<style>${classicStyles()}@page{size:letter;margin:0.75in;}</style></head>` +
    `<body style="background:#fff;">${docFrame(bodyHtml)}</body></html>`;
}


// ═══════════════════════════════════════════════════════════════
// EXPENSE DETAIL REPORT — front-page analytics helpers
// ═══════════════════════════════════════════════════════════════

// Monthly spending timeline — pure inline SVG (bars + trend line).
// Buckets expenses by YYYY-MM and renders a print-safe bar chart with a
// smoothed trend polyline overlaid. Returns '' when there is nothing to show.
function expenseTimelineSVG(expenses: Array<{ date: string; amount: number }>): string {
  const byMonth = new Map<string, number>();
  for (const e of expenses) {
    const key = (e.date || '').slice(0, 7); // YYYY-MM
    if (!key) continue;
    byMonth.set(key, (byMonth.get(key) || 0) + (Number(e.amount) || 0));
  }
  const months = Array.from(byMonth.keys()).sort();
  if (months.length === 0) return '';

  const vals = months.map((m) => byMonth.get(m) || 0);
  const max = Math.max(...vals, 1);
  const total = vals.reduce((s, v) => s + v, 0);
  const mean = total / months.length;

  const W = 720, H = 165;
  const padT = 16, padB = 30, padX = 6;
  const chartH = H - padT - padB;
  const n = months.length;
  const slot = (W - padX * 2) / n;
  const barW = Math.min(slot * 0.5, 54);

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    const lbl = d.toLocaleDateString('en-US', { month: 'short' });
    return Number(m) === 1 ? `${lbl} '${y.slice(2)}` : lbl;
  };
  const compact = (v: number) =>
    v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`;

  const cx = (i: number) => padX + slot * i + slot / 2;
  const cy = (v: number) => padT + chartH - (v / max) * chartH;

  // Flat, formal bars — single solid ink-slate fill, square edges
  const bars = months.map((m, i) => {
    const v = byMonth.get(m) || 0;
    const x = cx(i) - barW / 2;
    const y = cy(v);
    const h = padT + chartH - y;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" fill="#334155" />
      <text x="${cx(i).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="#334155" font-family="'SF Mono',Menlo,monospace">${compact(v)}</text>
      <text x="${cx(i).toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="#64748b">${monthLabel(m)}</text>`;
  }).join('');

  // Hairline gridlines
  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + chartH - chartH * f;
    return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${(W - padX).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#eef2f7" stroke-width="1" />`;
  }).join('');

  // Dashed mean reference line (formal analytical marker)
  const meanY = cy(mean);
  const meanLine = `<line x1="${padX}" y1="${meanY.toFixed(1)}" x2="${(W - padX).toFixed(1)}" y2="${meanY.toFixed(1)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 3" />
    <text x="${(W - padX).toFixed(1)}" y="${(meanY - 4).toFixed(1)}" text-anchor="end" font-size="8" font-weight="600" fill="#94a3b8" letter-spacing="0.5">AVG ${compact(mean)}</text>`;

  // Peak / quiet captions
  let peakI = 0, lowI = 0;
  vals.forEach((v, i) => { if (v > vals[peakI]) peakI = i; if (v < vals[lowI]) lowI = i; });
  const caption = n > 1
    ? `<div class="exp-viz-cap">Peak: ${monthLabel(months[peakI])} (${fmt(vals[peakI])}) &nbsp;&middot;&nbsp; Lowest: ${monthLabel(months[lowI])} (${fmt(vals[lowI])}) &nbsp;&middot;&nbsp; Monthly average: ${fmt(mean)}</div>`
    : '';

  return `<div class="exp-viz-card no-break">
    <div class="exp-viz-title">Spending Over Time</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${gridLines}
      ${bars}
      ${meanLine}
    </svg>${caption}
  </div>`;
}

// Date → spending heatmap — GitHub-style calendar grid, pure inline SVG.
// Each cell is one day; colour intensity scales with that day's total spend.
// Columns are ISO weeks (Sunday-aligned), rows are weekdays.
function expenseHeatmapSVG(expenses: Array<{ date: string; amount: number }>): string {
  const byDay = new Map<string, number>();
  let min: string | null = null, max: string | null = null;
  for (const e of expenses) {
    const d = (e.date || '').slice(0, 10);
    if (!d) continue;
    byDay.set(d, (byDay.get(d) || 0) + (Number(e.amount) || 0));
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min || !max) return '';

  const start = new Date(min + 'T12:00:00');
  start.setDate(start.getDate() - start.getDay()); // align to Sunday
  const end = new Date(max + 'T12:00:00');

  const maxVal = Math.max(...Array.from(byDay.values()), 1);
  // 5-step monochrome ink ramp (index 0 = no spend) — flat, formal
  const ramp = ['#eef2f7', '#cdd7e4', '#9fb0c8', '#6e84a4', '#41587d', '#1e293b'];
  const bucket = (v: number) => {
    if (v <= 0) return 0;
    const r = v / maxVal;
    if (r <= 0.2) return 1;
    if (r <= 0.4) return 2;
    if (r <= 0.6) return 3;
    if (r <= 0.8) return 4;
    return 5;
  };
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const cell = 12, gap = 3, step = cell + gap;
  const padL = 26, padT = 16;

  const cells: string[] = [];
  const monthMarks: string[] = [];
  let lastMonth = -1;
  let activeDays = 0;
  let peakDay = ''; let peakVal = 0;
  const cur = new Date(start);
  let week = 0;
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow === 0) week = Math.round((cur.getTime() - start.getTime()) / (7 * 86400000));
    const key = iso(cur);
    const v = byDay.get(key) || 0;
    if (v > 0) activeDays++;
    if (v > peakVal) { peakVal = v; peakDay = key; }
    const x = padL + week * step;
    const y = padT + dow * step;
    cells.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="1" fill="${ramp[bucket(v)]}"><title>${key}: ${fmt(v)}</title></rect>`);
    if (cur.getMonth() !== lastMonth && dow <= 6) {
      lastMonth = cur.getMonth();
      monthMarks.push(`<text x="${x}" y="${padT - 5}" font-size="9" font-weight="600" fill="#64748b">${cur.toLocaleDateString('en-US', { month: 'short' })}</text>`);
    }
    cur.setDate(cur.getDate() + 1);
  }

  const totalWeeks = Math.round((end.getTime() - start.getTime()) / (7 * 86400000)) + 1;
  const W = padL + totalWeeks * step + 4;
  const H = padT + 7 * step + 4;
  const dayLabels = [['Mon', 1], ['Wed', 3], ['Fri', 5]]
    .map(([lbl, d]) => `<text x="0" y="${padT + (d as number) * step + cell - 2}" font-size="8" fill="#94a3b8">${lbl}</text>`)
    .join('');

  const legend = ramp.map((c, i) => `<rect x="${i * (cell + 2)}" y="0" width="${cell}" height="${cell}" rx="1" fill="${c}" />`).join('');

  const peakLabel = peakDay
    ? new Date(peakDay + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';
  const caption = `<div class="exp-viz-cap">Busiest day: ${peakLabel} (${fmt(peakVal)}) &nbsp;&middot;&nbsp; ${activeDays} active spending day${activeDays === 1 ? '' : 's'}</div>`;

  return `<div class="exp-viz-card no-break">
    <div class="exp-viz-title" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;">
      <span>Daily Spending Heatmap</span>
      <span style="display:inline-flex;align-items:center;gap:6px;font-size:8px;font-weight:600;color:#94a3b8;text-transform:none;letter-spacing:0;">
        Less
        <svg width="${ramp.length * (cell + 2)}" height="${cell}" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;">${legend}</svg>
        More
      </span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" preserveAspectRatio="xMinYMid meet" style="display:block;max-width:100%;height:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${dayLabels}
      ${monthMarks.join('')}
      ${cells.join('')}
    </svg>${caption}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// EXPENSE DETAIL REPORT
// ═══════════════════════════════════════════════════════════════
interface ExpenseReportRow {
  date: string;
  description: string;
  vendor_name: string;
  category_name: string;
  amount: number;
  tax_amount: number;
  status: string;
  project_name?: string | null;
  is_tax_deductible?: number | boolean | null;
  payment_method?: string | null;
  line_items?: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
}

export function generateExpenseReportHTML(
  expenses: ExpenseReportRow[],
  companyName: string,
  dateRange: string,
  groupBy: string
): string {
  // ── CLASSIC THEME: Arial + pure black/white. ──

  // ── Math (unchanged) ──
  const grandTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalTax = expenses.reduce((s, e) => s + (Number(e.tax_amount) || 0), 0);
  const avgExpense = expenses.length > 0 ? grandTotal / expenses.length : 0;
  const largestExpense = expenses.reduce((m, e) => Math.max(m, Number(e.amount) || 0), 0);

  // Short date for table rows — "Mar 17, 2026" to prevent overflow.
  const fmtDateShort = (d: string) => {
    if (!d) return '';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return d; }
  };

  // Status: plain-text uppercase label (no color in classic)
  const statusLabel = (status: string) => cesc(status ? String(status).toUpperCase() : '—');

  // ── Grouping logic (unchanged) ──
  const quarterOf = (d: string) => {
    const m = parseInt((d || '').substring(5, 7), 10);
    const y = (d || '').substring(0, 4);
    if (!m) return 'Undated';
    if (m <= 3) return `${y} · Q1`;
    if (m <= 6) return `${y} · Q2`;
    if (m <= 9) return `${y} · Q3`;
    return `${y} · Q4`;
  };
  const pmLabel = (m: string | null | undefined) => {
    const map: Record<string, string> = { cash: 'Cash', check: 'Check', credit_card: 'Credit Card', bank_transfer: 'Bank Transfer' };
    return map[(m || '').toLowerCase()] || (m ? String(m) : 'Unspecified');
  };
  const groupKey = (e: ExpenseReportRow): string => {
    switch (groupBy) {
      case 'category': return e.category_name || 'Uncategorized';
      case 'vendor': return e.vendor_name || 'No Vendor';
      case 'project': return e.project_name || 'No Project';
      case 'quarter': return quarterOf(e.date);
      case 'tax_deductible': return e.is_tax_deductible ? 'Tax Deductible' : 'Non-Deductible';
      case 'payment_method': return pmLabel(e.payment_method);
      default: return '';
    }
  };

  const isGrouped = groupBy && groupBy !== 'none';
  const groups: Array<{ label: string; total: number; rows: ExpenseReportRow[] }> = [];
  if (isGrouped) {
    const map = new Map<string, ExpenseReportRow[]>();
    for (const e of expenses) {
      const k = groupKey(e);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    for (const [label, rows] of map.entries()) {
      groups.push({ label, total: rows.reduce((s, e) => s + (Number(e.amount) || 0), 0), rows });
    }
    groups.sort((a, b) => b.total - a.total);
  }
  const groupByLabel = ({
    category: 'Category', vendor: 'Vendor', project: 'Project', quarter: 'Quarter',
    tax_deductible: 'Tax Status', payment_method: 'Payment Method',
  } as Record<string, string>)[groupBy] || '';

  // ── Category breakdown (data preserved; rendered as ruled table) ──
  const catTotals: Record<string, number> = {};
  expenses.forEach(e => { const c = e.category_name || 'Uncategorized'; catTotals[c] = (catTotals[c] || 0) + (Number(e.amount) || 0); });
  const topCategories = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // ── Spending timeline data (preserved; rendered as ruled table instead of SVG) ──
  const byMonth = new Map<string, number>();
  for (const e of expenses) {
    const key = (e.date || '').slice(0, 7);
    if (!key) continue;
    byMonth.set(key, (byMonth.get(key) || 0) + (Number(e.amount) || 0));
  }
  const months = Array.from(byMonth.keys()).sort();
  const fmtMonthLabel = (ym: string) => {
    const [y, mo] = ym.split('-');
    const d = new Date(Number(y), Number(mo) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  // ── Header ──
  const header = docHeader({
    coName: companyName,
    coDetailHtml: dateRange ? cesc(dateRange) : '',
    title: 'Expense Report',
  });

  // ── Meta strip: key stats ──
  const meta = metaStrip([
    { label: 'Date Range',   value: dateRange || '—' },
    { label: 'Transactions', value: String(expenses.length) },
    { label: 'Total Spend',  value: fmt(grandTotal) },
    { label: 'Average',      value: fmt(avgExpense) },
    { label: 'Largest',      value: fmt(largestExpense) },
    { label: 'Total Tax',    value: fmt(totalTax) },
  ]);

  // ── Spending over time — classic ruled table (replaces SVG bar chart; all data preserved) ──
  const timelineHTML = months.length > 0
    ? `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
      `<div class="sec-label" style="margin-bottom:6px;">Spending Over Time</div>` +
      ruledTable(
        [
          { label: 'Month', width: '60%' },
          { label: 'Amount', align: 'right', width: '40%' },
        ],
        months.map(m => [cesc(fmtMonthLabel(m)), cesc(fmt(byMonth.get(m) || 0))]),
      ) +
      (() => {
        if (months.length < 2) return '';
        const vals = months.map(m => byMonth.get(m) || 0);
        let peakI = 0, lowI = 0;
        vals.forEach((v, i) => { if (v > vals[peakI]) peakI = i; if (v < vals[lowI]) lowI = i; });
        const mean = grandTotal / months.length;
        return `<div style="font-size:10px;margin-top:6px;font-variant-numeric:tabular-nums;">` +
          `Peak: ${cesc(fmtMonthLabel(months[peakI]))} (${cesc(fmt(vals[peakI]))}) &nbsp;&middot;&nbsp; ` +
          `Lowest: ${cesc(fmtMonthLabel(months[lowI]))} (${cesc(fmt(vals[lowI]))}) &nbsp;&middot;&nbsp; ` +
          `Monthly average: ${cesc(fmt(mean))}</div>`;
      })() +
      `</div>`
    : '';

  // ── Top Categories — classic ruled table (replaces bar chart; all data preserved) ──
  const catHTML = topCategories.length > 0
    ? `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
      `<div class="sec-label" style="margin-bottom:6px;">Top Categories</div>` +
      ruledTable(
        [
          { label: 'Category', width: '50%' },
          { label: 'Amount', align: 'right', width: '25%' },
          { label: '% of Total', align: 'right', width: '25%' },
        ],
        topCategories.map(([cat, amount]) => {
          const sharePct = grandTotal > 0 ? (amount / grandTotal) * 100 : 0;
          return [cesc(cat), cesc(fmt(amount)), cesc(`${sharePct.toFixed(1)}%`)];
        }),
      ) +
      `</div>`
    : '';

  // ── Line items sub-table renderer (classic styled) ──
  const renderLineItems = (e: ExpenseReportRow): string => {
    if (!e.line_items || e.line_items.length === 0) return '';
    return `<tr><td colspan="6" style="padding:0 0 0 24px;border-bottom:1px solid #000;">` +
      ruledTable(
        [
          { label: 'Description', width: '52%' },
          { label: 'Qty', align: 'right', width: '12%' },
          { label: 'Unit Price', align: 'right', width: '18%' },
          { label: 'Amount', align: 'right', width: '18%' },
        ],
        e.line_items.map(li => [
          cesc(li.description || '—'),
          cesc(String(li.quantity)),
          cesc(fmt(Number(li.unit_price) || 0)),
          cesc(fmt(Number(li.amount) || 0)),
        ]),
      ) +
      `</td></tr>`;
  };

  // ── Main expense row renderer ──
  const renderRow = (e: ExpenseReportRow): string => {
    const mainRow = `<tr>
      <td style="white-space:nowrap;font-variant-numeric:tabular-nums;">${cesc(fmtDateShort(e.date))}</td>
      <td>${cesc(e.description) || '—'}</td>
      <td>${cesc(e.vendor_name) || '—'}</td>
      <td>${cesc(e.category_name) || '—'}</td>
      <td class="num" style="white-space:nowrap;">${cesc(fmt(Number(e.amount) || 0))}</td>
      <td class="ctr">${statusLabel(e.status)}</td>
    </tr>`;
    return mainRow + renderLineItems(e);
  };

  // ── Detail table header row (matches ruledTable column structure) ──
  const detailColumns: RuledColumn[] = [
    { label: 'Date',        width: '13%' },
    { label: 'Description', width: '22%' },
    { label: 'Vendor',      width: '17%' },
    { label: 'Category',    width: '16%' },
    { label: 'Amount',      align: 'right', width: '16%' },
    { label: 'Status',      align: 'center', width: '16%' },
  ];
  const colHead = `<tr>${detailColumns.map(c =>
    `<th${c.width ? ` style="width:${c.width}"` : ''}>${cesc(c.label)}</th>`).join('')}</tr>`;

  // Grouped or flat detail rows
  const detailRows = isGrouped
    ? groups.map(g => {
        const groupRowsHtml = g.rows.map(renderRow).join('');
        // Group header: full-width bold classic band
        const groupHdr = `<tr><td colspan="6" style="background:#000;color:#fff;font-weight:bold;` +
          `letter-spacing:0.8px;text-transform:uppercase;padding:6px 8px;font-size:10px;">` +
          `${cesc(g.label)} &nbsp;—&nbsp; ${cesc(fmt(g.total))} &middot; ${g.rows.length} item${g.rows.length === 1 ? '' : 's'}` +
          `</td></tr>`;
        return groupHdr + groupRowsHtml;
      }).join('')
    : expenses.map(renderRow).join('');

  const detailTable = `<table class="ruled" style="table-layout:fixed;"><thead>${colHead}</thead><tbody>${detailRows}</tbody></table>`;

  // Section title bar for detail section
  const detailTitle = `<div style="padding:8px 16px;background:#000;color:#fff;font-size:10px;font-weight:bold;` +
    `letter-spacing:1.6px;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact;">` +
    `Transaction Detail${isGrouped ? ` — Grouped by ${cesc(groupByLabel)}` : ''}</div>`;

  // ── Totals box (math unchanged) ──
  const totals = totalsBox([
    { label: `Grand Total (${expenses.length} transaction${expenses.length === 1 ? '' : 's'})`, value: fmt(grandTotal), grand: true },
  ]);

  // ── Footer ──
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const footerLine = [companyName, dateRange, `Generated ${generated}`].filter(Boolean).join(' · ');

  // ── Assemble ──
  const inner =
    header +
    meta +
    timelineHTML +
    catHTML +
    detailTitle +
    detailTable +
    `<div style="display:flex;justify-content:flex-end;padding:10px 16px;border-top:1px solid #000;">${totals}</div>` +
    footerBar(footerLine);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Expense Report — ${cesc(companyName)}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(inner) +
    `</body></html>`;
}
// ─── Court Packet (Judge-Ready PDF Bundle) ──────────────────
export function generateCourtPacketHTML(data: {
  debt: any;
  company: any;
  communications: any[];
  payments: any[];
  evidence: any[];
  compliance: any[];
  auditLog: any[];
  settlements: any[];
  contacts: any[];
  disputes: any[];
  legalActions: any[];
}): string {
  const { debt, company, communications, payments, evidence, compliance, auditLog, settlements, contacts, disputes, legalActions } = data;

  const escL = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cfmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);
  const dfmt = (d: string) => {
    if (!d) return '—';
    const s = String(d);
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const caseRef = debt.id ? String(debt.id).substring(0, 8).toUpperCase() : 'N/A';
  const generatedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const companyName = escL(company?.name || 'Company');
  const jurisdiction = escL(debt?.jurisdiction || '________________');

  const sectionCounts = [
    { title: 'Account Summary', count: 1 },
    { title: 'Communication Log', count: communications.length },
    { title: 'Payment History', count: payments.length },
    { title: 'Evidence Inventory', count: evidence.length },
    { title: 'FDCPA/TCPA Compliance Timeline', count: compliance.length },
    { title: 'Chain of Custody (Audit Trail)', count: auditLog.length },
    { title: 'Settlement History', count: settlements.length },
    { title: 'Contact Directory', count: contacts.length },
    { title: 'Dispute History', count: disputes.length },
    { title: 'Legal Actions', count: legalActions.length },
    { title: 'Generation Certificate', count: 1 },
  ];

  // Classic ruled-table helpers
  const tableHead = (cols: string[]) =>
    `<thead><tr>${cols.map(c => `<th style="background:#000;color:#fff;border:1px solid #000;padding:6px 8px;text-align:left;font-size:9.5pt;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">${c}</th>`).join('')}</tr></thead>`;
  const td = (v: any) => `<td style="border:1px solid #000;padding:6px 8px;font-size:10pt;font-family:Arial,sans-serif;">${escL(v)}</td>`;
  const noRecords = '<p style="font-style:italic;margin:12px 0;font-family:Arial,sans-serif;font-size:10pt;">No records available.</p>';

  const sectionHeader = (n: number, title: string, count: number) =>
    `<div class="section" id="section-${n}" style="page-break-before:always;">` +
    `<div style="font-size:12pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;color:#000;font-family:Arial,sans-serif;">SECTION ${n}: ${escL(title)}</div>` +
    `<div style="font-size:10pt;font-family:Arial,sans-serif;margin-bottom:8px;">(${count} item${count !== 1 ? 's' : ''})</div>` +
    `<div style="border-top:2px solid #000;margin-bottom:16px;"></div>`;

  const tbl = (cols: string[], rows: string) =>
    `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">${tableHead(cols)}<tbody>${rows}</tbody></table>`;

  // ── Section 1: Account Summary ──
  const section1 = sectionHeader(1, 'Account Summary', 1) +
    `<table style="width:100%;border-collapse:collapse;">` +
    `<tbody>` +
    `<tr><td style="font-weight:700;width:40%;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Debtor Name</td>${td(debt.debtor_name)}</tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Original Amount</td><td style="border:1px solid #000;padding:6px 8px;font-size:10pt;font-family:Arial,sans-serif;">${cfmt(debt.original_amount)}</td></tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Accrued Interest</td><td style="border:1px solid #000;padding:6px 8px;font-size:10pt;font-family:Arial,sans-serif;">${cfmt(debt.interest_accrued)}</td></tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Fees &amp; Costs</td><td style="border:1px solid #000;padding:6px 8px;font-size:10pt;font-family:Arial,sans-serif;">${cfmt(debt.fees_accrued)}</td></tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Payments Applied</td><td style="border:1px solid #000;padding:6px 8px;font-size:10pt;font-family:Arial,sans-serif;">${cfmt(debt.payments_made)}</td></tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Balance Due</td><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-size:10pt;font-family:Arial,sans-serif;">${cfmt(debt.balance_due)}</td></tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Due Date</td>${td(dfmt(debt.due_date))}</tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Delinquent Date</td>${td(dfmt(debt.delinquent_date))}</tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Jurisdiction</td>${td(debt.jurisdiction || 'N/A')}</tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Interest Rate</td><td style="border:1px solid #000;padding:6px 8px;font-size:10pt;font-family:Arial,sans-serif;">${debt.interest_rate ? (Number(debt.interest_rate) * 100).toFixed(2) + '%' : 'N/A'}</td></tr>` +
    `<tr><td style="font-weight:700;border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">Interest Type</td>${td(debt.interest_type || 'N/A')}</tr>` +
    `</tbody></table></div>`;

  // ── Section 2: Communication Log ──
  const section2 = sectionHeader(2, 'Communication Log', communications.length) +
    (communications.length === 0 ? noRecords : tbl(['Date', 'Type', 'Direction', 'Subject', 'Outcome'],
      communications.map(c => `<tr>${td(dfmt(c.logged_at))}${td(c.type)}${td(c.direction)}${td(c.subject)}${td(c.outcome)}</tr>`).join(''))) +
    `</div>`;

  // ── Section 3: Payment History ──
  const section3 = sectionHeader(3, 'Payment History', payments.length) +
    (payments.length === 0 ? noRecords : tbl(['Date', 'Amount', 'Method', 'Reference', 'Applied To'],
      payments.map(p => `<tr>${td(dfmt(p.received_date))}<td style="border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">${cfmt(p.amount)}</td>${td(p.method)}${td(p.reference_number)}${td(p.applied_to)}</tr>`).join(''))) +
    `</div>`;

  // ── Section 4: Evidence Inventory ──
  const section4 = sectionHeader(4, 'Evidence Inventory', evidence.length) +
    (evidence.length === 0 ? noRecords : tbl(['Type', 'Title', 'Court Relevance', 'Date', 'Description'],
      evidence.map(e => `<tr>${td(e.evidence_type)}${td(e.title)}${td(e.court_relevance)}${td(dfmt(e.date_of_evidence))}<td style="border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">${escL(String(e.description || '').substring(0, 120))}${(e.description || '').length > 120 ? '&hellip;' : ''}</td></tr>`).join(''))) +
    `</div>`;

  // ── Section 5: FDCPA/TCPA Compliance Timeline ──
  const section5 = sectionHeader(5, 'FDCPA/TCPA Compliance Timeline', compliance.length) +
    (compliance.length === 0 ? noRecords : tbl(['Date', 'Event Type', 'Notes'],
      compliance.map(c => `<tr>${td(dfmt(c.event_date))}${td(c.event_type)}${td(c.notes)}</tr>`).join(''))) +
    `</div>`;

  // ── Section 6: Chain of Custody (Audit Trail) ──
  const section6 = sectionHeader(6, 'Chain of Custody (Audit Trail)', auditLog.length) +
    (auditLog.length === 0 ? noRecords : tbl(['Timestamp', 'Action', 'Field', 'Old Value', 'New Value', 'Performed By'],
      auditLog.map(a => `<tr>${td(dfmt(a.performed_at))}${td(a.action)}${td(a.field_name)}${td(a.old_value)}${td(a.new_value)}${td(a.performed_by)}</tr>`).join(''))) +
    `</div>`;

  // ── Section 7: Settlement History ──
  const section7 = sectionHeader(7, 'Settlement History', settlements.length) +
    (settlements.length === 0 ? noRecords : tbl(['Date', 'Offer Amount', 'Response', 'Counter Amount', 'Accepted Date'],
      settlements.map(s => `<tr>${td(dfmt(s.created_at))}<td style="border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">${cfmt(s.offer_amount)}</td>${td(s.response)}${s.counter_amount ? `<td style="border:1px solid #000;padding:6px 8px;font-family:Arial,sans-serif;font-size:10pt;">${cfmt(s.counter_amount)}</td>` : td('')}${td(dfmt(s.accepted_date))}</tr>`).join(''))) +
    `</div>`;

  // ── Section 8: Contact Directory ──
  const section8 = sectionHeader(8, 'Contact Directory', contacts.length) +
    (contacts.length === 0 ? noRecords : tbl(['Role', 'Name', 'Email', 'Phone', 'Company'],
      contacts.map(c => `<tr>${td(c.role)}${td(c.name)}${td(c.email)}${td(c.phone)}${td(c.company_name)}</tr>`).join(''))) +
    `</div>`;

  // ── Section 9: Dispute History ──
  const section9 = sectionHeader(9, 'Dispute History', disputes.length) +
    (disputes.length === 0 ? noRecords : tbl(['Date', 'Reason', 'Status', 'Resolution'],
      disputes.map(d => `<tr>${td(dfmt(d.created_at))}${td(d.reason)}${td(d.status)}${td(d.resolution)}</tr>`).join(''))) +
    `</div>`;

  // ── Section 10: Legal Actions ──
  const section10 = sectionHeader(10, 'Legal Actions', legalActions.length) +
    (legalActions.length === 0 ? noRecords : tbl(['Type', 'Status', 'Court', 'Case Number', 'Hearing Date'],
      legalActions.map(l => `<tr>${td(l.action_type)}${td(l.status)}${td(l.court_name)}${td(l.case_number)}${td(dfmt(l.hearing_date))}</tr>`).join(''))) +
    `</div>`;

  // ── Section 11: Generation Certificate ──
  const section11 = sectionHeader(11, 'Generation Certificate', 1) +
    `<div style="border:2px solid #000;padding:24px;margin:12px 0;font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;">` +
    `<p style="margin-bottom:12px;">This document was generated on <strong>${generatedDate}</strong> from the business records of <strong>${companyName}</strong>. Records are maintained in the regular course of business by persons with knowledge of the recorded acts.</p>` +
    `<p style="margin-bottom:12px;">The information contained herein is a true and accurate representation of the records as stored in the electronic database at the time of generation.</p>` +
    `<div style="margin-top:36px;border-top:1px solid #000;width:50%;padding-top:8px;font-size:10pt;">Authorized Signature / Date</div>` +
    `</div></div>`;

  const exhibitLetter = (n: number) => String.fromCharCode(64 + n); // 1->A
  const exhibits = [
    { letter: exhibitLetter(1), title: 'Account Summary & Itemized Statement' },
    { letter: exhibitLetter(2), title: 'Communications Log' },
    { letter: exhibitLetter(3), title: 'Payment History' },
    { letter: exhibitLetter(4), title: 'Evidence Inventory' },
    { letter: exhibitLetter(5), title: 'FDCPA / TCPA Compliance Timeline' },
    { letter: exhibitLetter(6), title: 'Chain of Custody (Audit Trail)' },
    { letter: exhibitLetter(7), title: 'Settlement History' },
    { letter: exhibitLetter(8), title: 'Contact Directory' },
    { letter: exhibitLetter(9), title: 'Dispute History' },
    { letter: exhibitLetter(10), title: 'Legal Actions' },
    { letter: exhibitLetter(11), title: 'Custodian Certification' },
  ];

  const logoHtml = logoImg(company?.logo_data, company?.name);
  const coDetailHtml = (logoHtml ? logoHtml + '<br>' : '') +
    escL([company?.address_line1, company?.address_line2, [company?.city, company?.state].filter(Boolean).join(', ') + (company?.zip ? ' ' + company.zip : '')].filter(Boolean).join(', '));

  const coverBodyHtml =
    // Classic double-rule court caption
    `<div style="text-align:center;padding-top:0.5in;font-family:Arial,sans-serif;">` +
    `<div style="border-top:3px solid #000;border-bottom:3px solid #000;padding:16px 0;margin-bottom:36px;">` +
    `<div style="font-weight:700;text-transform:uppercase;letter-spacing:2px;font-size:12pt;">In the Court of Competent Jurisdiction</div>` +
    `<div style="font-weight:700;text-transform:uppercase;letter-spacing:2px;font-size:12pt;margin-top:4px;">${jurisdiction}</div>` +
    `<div style="font-style:italic;font-size:11pt;margin-top:14px;">${companyName},<br><span style="font-size:10pt;font-style:normal;">Plaintiff,</span></div>` +
    `<div style="text-align:center;margin:6px 0;font-style:italic;font-size:11pt;">vs.</div>` +
    `<div style="font-style:italic;font-size:11pt;">${escL(debt.debtor_name)},<br><span style="font-size:10pt;font-style:normal;">Defendant.</span></div>` +
    `<div style="margin-top:14px;font-size:10pt;">Case Ref. No. BAP-${caseRef}</div>` +
    `</div>` +
    `<div style="font-size:24pt;font-weight:700;letter-spacing:5px;margin:36px 0 14px;text-transform:uppercase;">Court Packet</div>` +
    `<div style="font-size:13pt;font-style:italic;margin-bottom:8px;">Bates-Numbered Evidentiary Bundle</div>` +
    `<div style="font-size:12pt;margin-bottom:4px;">Compiled by: <strong>${companyName}</strong></div>` +
    `<div style="font-size:12pt;margin-bottom:4px;">Date of Compilation: ${generatedDate}</div>` +
    // Exhibit list — classic bordered
    `<div style="margin:36px auto;max-width:5in;text-align:left;border:1px solid #000;padding:18px 22px;">` +
    `<div style="font-size:11pt;text-transform:uppercase;letter-spacing:2px;text-align:center;margin-bottom:10px;border-bottom:1px solid #000;padding-bottom:6px;font-weight:700;">List of Exhibits</div>` +
    exhibits.map(ex =>
      `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11pt;border-bottom:1px solid #ddd;">` +
      `<span style="font-weight:700;width:1.2in;display:inline-block;">Exhibit ${ex.letter}</span>` +
      `<span>${escL(ex.title)}</span></div>`
    ).join('') +
    `</div>` +
    // Exhibit thumbnail grid — classic: black borders, white bg, no colors
    `<div style="margin:24px auto 0;max-width:6.5in;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;page-break-inside:avoid;">` +
    exhibits.map(ex =>
      `<div style="border:1.5px solid #000;padding:10px 6px 8px;text-align:center;background:#fff;">` +
      `<div style="font-family:Arial,sans-serif;font-size:22pt;font-weight:700;letter-spacing:3px;border:2px solid #000;padding:6px 0;margin-bottom:6px;background:#fff;">${ex.letter}</div>` +
      `<div style="font-family:Arial,sans-serif;font-size:7.5pt;line-height:1.25;color:#000;min-height:2.4em;">${escL(ex.title)}</div>` +
      `</div>`
    ).join('') +
    `</div>` +
    `<div style="margin-top:60px;font-size:11pt;font-weight:700;letter-spacing:2px;text-transform:uppercase;border:2px solid #000;display:inline-block;padding:8px 20px;">Confidential &mdash; For Legal Proceedings Only</div>` +
    `</div>`;

  const sections = [section1, section2, section3, section4, section5, section6, section7, section8, section9, section10, section11];
  const sectionsWithCovers = sections.map((s, i) =>
    `<div style="text-align:center;padding-top:2.8in;page-break-before:always;page-break-after:always;font-family:Arial,sans-serif;">` +
    `<div style="display:inline-block;border:4px solid #000;padding:26px 56px;font-size:56pt;font-weight:700;letter-spacing:10px;">${exhibits[i].letter}</div>` +
    `<div style="font-size:16pt;text-transform:uppercase;letter-spacing:4px;margin-top:28px;font-style:italic;">Exhibit ${exhibits[i].letter}</div>` +
    `<div style="font-size:13pt;letter-spacing:2px;margin-top:8px;">${escL(exhibits[i].title)}</div>` +
    `</div>` +
    s
  ).join('');

  // Classic page-level styles (Arial, black rules)
  const styles = classicStyles() + `
    @page { size: letter; margin: 1in 1in 1.1in 1in; }
    body { font-size: 11pt; line-height: 1.6; }
    .section { page-break-before: always; }
    .cover { page-break-after: always; }
    @media print {
      tr { page-break-inside: avoid; break-inside: avoid; orphans: 3; widows: 3; }
      thead { display: table-header-group; }
      h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
      p { orphans: 3; widows: 3; }
    }
  `;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Court Packet — ${escL(debt.debtor_name)}</title>` +
    `<style>${styles}</style></head><body>` +
    `<div style="font-size:8.5pt;font-style:italic;text-align:center;padding:4px 0;border-bottom:1px solid #000;font-family:Arial,sans-serif;">Confidential — Prepared for Legal Proceedings</div>` +
    `<div class="cover">${coverBodyHtml}</div>` +
    sectionsWithCovers +
    `</body></html>`;
}
// ─── Verification Affidavit ────────────────────────────────
export function generateVerificationAffidavitHTML(
  debt: any,
  company: any,
  signatoryName: string,
): string {
  const companyName = esc(company?.name || 'Company');
  const _cityStateZipA = [company?.city, company?.state].filter(Boolean).join(', ') + (company?.zip ? ' ' + company.zip : '');
  const companyAddr = esc([company?.address_line1, company?.address_line2, _cityStateZipA.trim()].filter(s => s && String(s).trim()).join(', '));
  const debtorName = esc(debt?.debtor_name || 'Debtor');
  const sigName = esc(signatoryName || '[Signatory Name]');
  const fmtAmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);
  const todayLong = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const stateName = esc(debt?.jurisdiction_state || debt?.jurisdiction || '________________');
  const countyName = esc(debt?.jurisdiction_county || '________________');
  const acctNum = (debt?.debt_number || debt?.id || '').toString().slice(0, 12).toUpperCase() || 'N/A';
  const sigTitle = esc(debt?.signatory_title || 'Authorized Custodian of Records');

  // ── Feature #20: chronological event ribbon — classic ruled table (no color) ──
  const chronologyHTML = (() => {
    const events: Array<{ label: string; date: string }> = [];
    if (debt?.origination_date) events.push({ label: 'Origination', date: debt.origination_date });
    else if (debt?.created_at) events.push({ label: 'Record Created', date: String(debt.created_at).slice(0, 10) });
    if (debt?.delinquent_date) events.push({ label: 'Delinquent', date: debt.delinquent_date });
    if (debt?.first_contact_date || debt?.first_contact_at) events.push({ label: 'First Contact', date: String(debt.first_contact_date || debt.first_contact_at).slice(0, 10) });
    if (debt?.last_demand_date) events.push({ label: 'Demand Letter', date: String(debt.last_demand_date).slice(0, 10) });
    // DATE: build YYYY-MM-DD from local components — toISOString() shifts day in non-UTC zones.
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    events.push({ label: 'Today', date: todayStr });
    const valid = events.filter(e => {
      const t = new Date(e.date + 'T12:00:00').getTime();
      return isFinite(t);
    });
    if (valid.length < 2) return '';
    // Classic: render as a plain ruled table instead of SVG ribbon
    return `<div style="margin:14px 0 18px;border:1px solid #000;font-family:Arial,sans-serif;page-break-inside:avoid;">` +
      `<div style="background:#000;color:#fff;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:1px;padding:4px 8px;">Chronology</div>` +
      `<table style="width:100%;border-collapse:collapse;"><tbody><tr>` +
      valid.map(e =>
        `<td style="border:1px solid #000;padding:6px 8px;text-align:center;font-size:9.5pt;">` +
        `<div style="font-weight:700;">${esc(e.label)}</div>` +
        `<div style="font-style:italic;margin-top:2px;">${esc(new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }))}</div>` +
        `</td>`
      ).join('') +
      `</tr></tbody></table></div>`;
  })();

  const logoHtml = logoImg(company?.logo_data, company?.name);
  const coDetailHtml = (logoHtml ? logoHtml + '<br>' : '') +
    `${companyAddr || '________________'}`;

  const amountTable = totalsBox([
    { label: 'Original Principal Amount', value: fmtAmt(debt?.original_amount) },
    { label: 'Interest Accrued', value: fmtAmt(debt?.interest_accrued) },
    { label: 'Fees and Charges Accrued', value: fmtAmt(debt?.fees_accrued) },
    { label: 'Payments Received and Applied', value: `(${fmtAmt(debt?.payments_made)})` },
    { label: 'TOTAL AMOUNT DUE AND OWING', value: fmtAmt(debt?.balance_due), grand: true },
  ]);

  const bodyHtml =
    docHeader({
      coName: company?.name || 'Company',
      coDetailHtml,
      title: 'Affidavit of Debt Verification',
      number: `Account No. ${acctNum}`,
    }) +
    // Legal caption — classic double-rule centered block
    `<div style="text-align:center;font-family:Arial,sans-serif;font-size:12pt;line-height:1.7;padding:16px;border-bottom:3px solid #000;">` +
    `<div style="font-weight:700;letter-spacing:2px;text-transform:uppercase;">STATE OF ${stateName}</div>` +
    `<div style="font-weight:700;letter-spacing:2px;text-transform:uppercase;">COUNTY OF ${countyName}</div>` +
    `<div style="font-weight:700;text-transform:uppercase;letter-spacing:3px;font-size:14pt;margin-top:12px;">Affidavit of Debt Verification</div>` +
    `<div style="font-size:10pt;font-style:italic;margin-top:6px;">Account No. ${acctNum}</div>` +
    `</div>` +
    `<div style="padding:14px 16px;font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;">` +
    `<p style="margin-bottom:18px;">BEFORE ME, the undersigned authority, personally appeared <strong>${sigName}</strong>, who, being first duly sworn upon oath, deposes and states as follows:</p>` +
    // Numbered paragraphs — verbatim legal text
    `<div style="counter-reset:legalpara;">` +
    [
      `I am the ${sigTitle} of ${companyName}, with its principal place of business located at ${companyAddr || '________________'}. I am over the age of eighteen (18) years and competent to testify to the matters set forth herein.`,
      `I am authorized to make this Affidavit on behalf of ${companyName}, and the statements set forth herein are made upon my personal knowledge derived from the business records of ${companyName} maintained in the regular and ordinary course of its business.`,
      `The records of ${companyName} are made at or near the time of the events recorded by, or from information transmitted by, persons with knowledge of those events; such records are kept in the course of regularly conducted business activity, and the making of such records is a regular practice of that business activity, satisfying the business records exception to the rule against hearsay under <em>Fed. R. Evid. 803(6)</em>.`,
      `The records of ${companyName} reflect that <strong>${debtorName}</strong> ("Debtor") is indebted to ${companyName} in connection with Account No. ${acctNum}, and as of ${todayLong} the indebtedness is itemized as follows:`,
    ].map((text, i) =>
      `<div style="display:flex;gap:12px;margin-bottom:14px;text-align:justify;">` +
      `<span style="font-weight:700;min-width:24px;text-align:right;flex-shrink:0;">${i + 1}.</span>` +
      `<span>${text}</span></div>`
    ).join('') +
    `</div>` +
    `<div style="margin:16px 0;">${amountTable}</div>` +
    chronologyHTML +
    // Numbered paragraphs continued (5–7)
    `<div>` +
    [
      `Demand has been duly made upon the Debtor for the payment of said indebtedness; however, no portion of said indebtedness has been paid except as credited above, and the entire balance set forth above remains due, owing, and unpaid.`,
      `${companyName} is the lawful owner and holder of the debt described herein, and no other person or entity has any interest in or claim to said debt.`,
      `I declare under penalty of perjury under the laws of the State of ${stateName} that the foregoing is true and correct.`,
    ].map((text, i) =>
      `<div style="display:flex;gap:12px;margin-bottom:14px;text-align:justify;">` +
      `<span style="font-weight:700;min-width:24px;text-align:right;flex-shrink:0;">${i + 5}.</span>` +
      `<span>${text}</span></div>`
    ).join('') +
    `</div>` +
    `<p style="margin-top:30px;">FURTHER AFFIANT SAYETH NAUGHT.</p>` +
    // Signature block
    `<div style="margin-top:28px;page-break-inside:avoid;">` +
    `<div style="border-bottom:1px solid #000;width:260px;margin-top:28px;"></div>` +
    `<div style="font-weight:700;margin-top:4px;font-size:10pt;">${sigName}</div>` +
    `<div style="font-size:9.5pt;">${sigTitle}, ${companyName}</div>` +
    `</div>` +
    `</div>` +
    // Jurat / notary block — classic boxed (verbatim jurat text)
    `<div style="border:1.5px solid #000;padding:18px 22px;margin:36px 16px 16px;font-family:Arial,sans-serif;font-size:11pt;line-height:1.9;page-break-inside:avoid;">` +
    `<div style="text-align:center;font-weight:700;text-transform:uppercase;letter-spacing:2px;font-size:11pt;margin-bottom:12px;border-bottom:1px solid #000;padding-bottom:6px;">Jurat</div>` +
    `<div style="float:right;width:130px;height:130px;border:2px dashed #555;margin-left:16px;text-align:center;padding:50px 6px;font-size:9pt;font-style:italic;">[NOTARY<br>SEAL]</div>` +
    `<p style="text-indent:0;margin:0 0 4px 0;">STATE OF <span style="display:inline-block;border-bottom:1px solid #000;min-width:60px;padding:0 4px;">${stateName}</span></p>` +
    `<p style="text-indent:0;margin:0 0 10px 0;">COUNTY OF <span style="display:inline-block;border-bottom:1px solid #000;min-width:60px;padding:0 4px;">${countyName}</span></p>` +
    `<p style="text-indent:0;margin:10px 0 0 0;">Subscribed and sworn to (or affirmed) before me this <span style="display:inline-block;border-bottom:1px solid #000;min-width:60px;padding:0 4px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> day of <span style="display:inline-block;border-bottom:1px solid #000;min-width:100px;padding:0 4px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>, 20<span style="display:inline-block;border-bottom:1px solid #000;min-width:30px;padding:0 4px;">&nbsp;&nbsp;&nbsp;</span>, by ${sigName}, who is personally known to me or who has produced satisfactory identification.</p>` +
    `<div style="margin-top:36px;clear:both;">` +
    `<div style="border-top:1px solid #000;width:280px;padding-top:4px;">Notary Public — Signature</div>` +
    `<p style="text-indent:0;margin-top:8px;">Printed Name: <span style="display:inline-block;border-bottom:1px solid #000;min-width:200px;padding:0 4px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>` +
    `<p style="text-indent:0;">My Commission Expires: <span style="display:inline-block;border-bottom:1px solid #000;min-width:160px;padding:0 4px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>` +
    `</div></div>` +
    footerBar('This communication may contain privileged or confidential information intended solely for the addressee.');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Affidavit of Debt Verification</title>` +
    `<style>${classicStyles()}@page{size:letter;margin:1in;}</style></head>` +
    `<body style="background:#fff;">${docFrame(bodyHtml)}</body></html>`;
}
// ═══════════════════════════════════════════════════════════════
// SHARED HELPERS (Bill / PO / Expense templates)
// ═══════════════════════════════════════════════════════════════

function safeImg(src: string | null | undefined, alt: string, style: string): string {
  if (!src) return '';
  const s = String(src);
  if (!/^data:|^https?:/i.test(s)) return '';
  return `<img src="${esc(s)}" alt="${esc(alt)}" style="${style}">`;
}

function addrLines(parts: Array<string | null | undefined>): string {
  // Split each part on newlines so multiline addresses don't run into one string
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    String(p).split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed) out.push(`<div class="addr-line">${esc(trimmed)}</div>`);
    });
  }
  return out.join('');
}

function fmtDateMaybe(d: string | null | undefined): string {
  if (!d) return '';
  // Accept either YYYY-MM-DD or full ISO
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(d);
  try {
    const dt = isDateOnly ? new Date(d + 'T12:00:00') : new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return d; }
}

function statusBadgeInline(label: string, color: string): string {
  return `<span class="fd-status-badge" style="background:${color}1f;color:${color};border:1px solid ${color}66;">${esc(label)}</span>`;
}

// ═══════════════════════════════════════════════════════════════
// BILL TEMPLATE
// ═══════════════════════════════════════════════════════════════

export function generateBillHTML(
  bill: any,
  company: any,
  vendor: any,
  lineItems: any[],
  settings?: InvoiceSettings,
  accounts?: Array<{ id: string; code?: string; name?: string }>
): string {
  // ── CLASSIC THEME: Arial + pure black/white. ──

  // Multi-currency: shadow module-level fmt with bill's currency
  const docCurrency = bill.currency || 'USD';
  const fmt = (v: number | string | null | undefined) => formatCurrency(v, docCurrency);

  // Build account lookup map for GL coding
  const accountMap = new Map<string, { code?: string; name?: string }>();
  (accounts || []).forEach(a => accountMap.set(a.id, a));

  // ── Math (unchanged from original) ──
  const total    = Number(bill.total || 0);
  const paid     = Number(bill.amount_paid || 0);
  const balance  = total - paid;
  const subtotal = Number(bill.subtotal || 0);
  const tax      = Number(bill.tax_amount || 0);

  // Status: draft gets docFrame watermark; others appear in numberHtml block
  const isDraft = bill.status === 'draft';
  const statusBadges: Record<string, string> = {
    paid: 'PAID', overdue: 'OVERDUE', partial: 'PARTIAL', sent: 'SENT', void: 'VOID',
  };
  const statusTag = statusBadges[String(bill.status || '').toLowerCase()] || '';

  // ── Header ──
  const coAddr  = cesc([company?.address_line1, company?.address_line2,
    [company?.city, company?.state, company?.zip].filter(Boolean).join(', ')].filter(Boolean).join(', '));
  const coPhone = cesc(company?.phone || '');
  const coEmail = cesc(company?.email || '');
  const coDetail = [coAddr, [coEmail, coPhone].filter(Boolean).join(' &middot;')].filter(Boolean).join('<br>');
  const showLogo = settings?.show_logo !== 0 && settings?.show_logo !== false;
  const logoHTML = logoImg(showLogo ? settings?.logo_data : null, company?.name || '');
  const currLabel = (bill.currency && bill.currency !== 'USD') ? ` (${bill.currency})` : '';
  const numberHtml = `No. ${cesc(bill.bill_number || '')}${statusTag ? `  [${cesc(statusTag)}]` : ''}`;
  const header = docHeader({
    coName: company?.name || 'Company',
    coDetailHtml: logoHTML + coDetail,
    title: `Bill${currLabel}`,
    numberHtml,
  });

  // ── Meta strip ──
  const metaCells: { label: string; value: string }[] = [
    { label: 'Bill Date', value: fmtDateMaybe(bill.bill_date || bill.issue_date) || '—' },
    { label: 'Due Date',  value: bill.due_date ? fmtDateMaybe(bill.due_date) : '—' },
    { label: 'Terms',     value: bill.terms || '—' },
  ];
  if (bill.po_number)       metaCells.push({ label: 'PO Ref',  value: String(bill.po_number) });
  if (bill.reference)       metaCells.push({ label: 'Ref',     value: String(bill.reference) });
  if (statusTag)            metaCells.push({ label: 'Status',  value: statusTag });
  const meta = metaStrip(metaCells);

  // ── Feature #17: 1099 eligible badge (classic = bordered monochrome box) ──
  const is1099 = !!(vendor?.is_1099_eligible || vendor?.vendor_1099 || vendor?.requires_1099);
  const badge1099Html = is1099
    ? `<div style="display:inline-block;margin-top:6px;padding:2px 7px;border:1.5px solid #000;font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">1099 Eligible</div>`
    : '';

  // ── Party boxes ──
  const vendorAddrHtml = [
    vendor?.address_line1, vendor?.address_line2,
    [vendor?.city, vendor?.state, vendor?.zip].filter(Boolean).join(', '),
  ].filter(Boolean).map(l => cesc(l as string)).join('<br>');
  const vendorContactHtml = [vendor?.email, vendor?.phone].filter(Boolean).map(cesc).join(' &middot; ');
  const vendorHtml = `<b>${cesc(vendor?.name || 'Vendor')}</b>` +
    (vendorAddrHtml ? '<br>' + vendorAddrHtml : '') +
    (vendorContactHtml ? '<br>' + vendorContactHtml : '') +
    badge1099Html;

  const companyAddrHtml = [
    company?.address_line1, company?.address_line2,
    [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
  ].filter(Boolean).map(l => cesc(l as string)).join('<br>');
  const companyContactHtml = [company?.email, company?.phone].filter(Boolean).map(cesc).join(' &middot; ');
  const companyHtml = `<b>${cesc(company?.name || 'Company')}</b>` +
    (companyAddrHtml ? '<br>' + companyAddrHtml : '') +
    (companyContactHtml ? '<br>' + companyContactHtml : '');

  const parties = boxRow([
    { label: 'From', html: vendorHtml },
    { label: 'Bill To', html: companyHtml },
  ]);

  // ── Line items table ──
  // Columns: Description / Qty / Unit Price / Account (GL) / Amount
  const lineColumns: RuledColumn[] = [
    { label: 'Description' },
    { label: 'Qty',        align: 'right', width: '60px' },
    { label: 'Unit Price', align: 'right', width: '100px' },
    { label: 'Account',    align: 'right', width: '130px' },
    { label: 'Amount',     align: 'right', width: '100px' },
  ];
  const lineRows: string[][] = (lineItems || []).map((l: any) => {
    const qty    = Number(l.quantity || 0);
    const unit   = Number(l.unit_price || 0);
    const amt    = Number(l.amount ?? qty * unit);
    const acctId = l.expense_account_id || l.account_id || '';
    const acct   = acctId ? accountMap.get(acctId) : null;
    const acctLabel = acct ? cesc(acct.code || acct.name || '') : '';
    return [cesc(l.description || ''), cesc(String(qty)), cesc(fmt(unit)), acctLabel, cesc(fmt(amt))];
  });
  const emptyRow: string[][] = lineRows.length === 0
    ? [[`<span style="font-style:italic;">(no line items)</span>`, '', '', '', '']]
    : [];
  const itemsTable = ruledTable(lineColumns, lineRows.length > 0 ? lineRows : emptyRow);

  // ── Feature #5: Account Allocation breakdown (classic = ruled mini-table) ──
  // Replaces the color-filled stacked bar with a plain black/white breakdown.
  const allocByAcct: Record<string, { label: string; total: number }> = {};
  (lineItems || []).forEach((l: any) => {
    const acctId = l.expense_account_id || l.account_id || '';
    const amt = Number(l.amount ?? Number(l.quantity || 0) * Number(l.unit_price || 0));
    if (amt <= 0) return;
    const acct = acctId ? accountMap.get(acctId) : null;
    const label = acct ? (acct.name || acct.code || 'Unassigned') : 'Unassigned';
    if (!allocByAcct[label]) allocByAcct[label] = { label, total: 0 };
    allocByAcct[label].total += amt;
  });
  const allocEntries = Object.values(allocByAcct).sort((a, b) => b.total - a.total);
  const allocationHTML = allocEntries.length > 1
    ? `<div style="padding:10px 16px;border-top:1px solid #000;">` +
      `<div class="sec-label" style="margin-bottom:6px;">Account Allocation</div>` +
      ruledTable(
        [{ label: 'Account' }, { label: 'Amount', align: 'right', width: '110px' }],
        allocEntries.map(e => [cesc(e.label), cesc(fmt(e.total))]),
      ) +
      `</div>`
    : '';

  // ── Totals box (math unchanged) ──
  const totalRows: { label: string; value: string; grand?: boolean }[] = [
    { label: 'Subtotal', value: fmt(subtotal) },
  ];
  if (tax > 0) totalRows.push({ label: 'Tax', value: fmt(tax) });
  totalRows.push({ label: 'Total', value: fmt(total), grand: true });
  if (paid > 0) {
    totalRows.push({ label: 'Amount Paid', value: `−${fmt(paid)}` });
    totalRows.push({ label: 'Balance Due', value: fmt(balance), grand: true });
  }
  const totals = totalsBox(totalRows);

  // ── Notes ──
  const notesHTML = bill.notes
    ? boxRow([{ label: 'Notes', html: `<div style="white-space:pre-line;">${cesc(bill.notes)}</div>` }])
    : '';

  // ── Footer ──
  const created   = bill.created_at ? fmtDateMaybe(bill.created_at) : '';
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const footerLine = [
    company?.name || 'Company',
    `Bill #${bill.bill_number || ''}`,
    created ? `Created ${created}` : '',
    `Generated ${generated}`,
  ].filter(Boolean).join(' · ');

  // ── Assemble ──
  const inner =
    header +
    meta +
    parties +
    itemsTable +
    allocationHTML +
    `<div style="display:flex;justify-content:flex-end;padding:10px 16px;">${totals}</div>` +
    notesHTML +
    footerBar(footerLine);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill ${cesc(bill.bill_number || '')}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(inner, { draft: isDraft }) +
    `</body></html>`;
}

// ═══════════════════════════════════════════════════════════════
// PURCHASE ORDER TEMPLATE
// ═══════════════════════════════════════════════════════════════

export function generatePurchaseOrderHTML(
  po: any,
  company: any,
  vendor: any,
  lineItems: any[],
  settings?: InvoiceSettings & {
    ship_to_name?: string;
    ship_to_address_line1?: string;
    ship_to_address_line2?: string;
    ship_to_city?: string;
    ship_to_state?: string;
    ship_to_zip?: string;
    delivery_terms?: string;
    payment_terms?: string;
  }
): string {
  // ── CLASSIC THEME: Arial + pure black/white. ──

  // Multi-currency: shadow module-level fmt with PO's currency
  const docCurrency = po.currency || 'USD';
  const fmt = (v: number | string | null | undefined) => formatCurrency(v, docCurrency);

  // ── Math (unchanged from original) ──
  const subtotal = Number(po.subtotal || 0);
  const tax      = Number(po.tax_amount || 0);
  const total    = Number(po.total || 0);

  // Status: draft gets docFrame watermark; others appear in numberHtml block
  const isDraft = po.status === 'draft';
  const statusBadgesMap: Record<string, string> = {
    sent: 'SENT', received: 'RECEIVED', cancelled: 'CLOSED', approved: 'APPROVED',
  };
  const statusTag = statusBadgesMap[String(po.status || '').toLowerCase()] || '';

  // ── Header ──
  const coAddr  = cesc([company?.address_line1, company?.address_line2,
    [company?.city, company?.state, company?.zip].filter(Boolean).join(', ')].filter(Boolean).join(', '));
  const coPhone = cesc(company?.phone || '');
  const coEmail = cesc(company?.email || '');
  const coDetail = [coAddr, [coEmail, coPhone].filter(Boolean).join(' &middot;')].filter(Boolean).join('<br>');
  const showLogo = settings?.show_logo !== 0 && settings?.show_logo !== false;
  const logoHTML = logoImg(showLogo ? settings?.logo_data : null, company?.name || '');
  const currLabel = (po.currency && po.currency !== 'USD') ? ` (${po.currency})` : '';
  const numberHtml = `No. ${cesc(po.po_number || '')}${statusTag ? `  [${cesc(statusTag)}]` : ''}`;
  const header = docHeader({
    coName: company?.name || 'Company',
    coDetailHtml: logoHTML + coDetail,
    title: `Purchase Order${currLabel}`,
    numberHtml,
  });

  // ── Meta strip ──
  const orderDateStr    = fmtDateMaybe(po.order_date || po.issue_date);
  const expectedDateStr = fmtDateMaybe(po.expected_delivery_date || po.expected_date);
  const metaCells: { label: string; value: string }[] = [
    { label: 'PO Date',      value: orderDateStr || '—' },
    { label: 'Required By',  value: expectedDateStr || '—' },
    { label: 'Terms',        value: po.terms || settings?.payment_terms || '—' },
  ];
  if (settings?.delivery_terms) metaCells.push({ label: 'Delivery',  value: settings.delivery_terms });
  if (statusTag)                metaCells.push({ label: 'Status',    value: statusTag });
  const meta = metaStrip(metaCells);

  // ── Party boxes ──
  const vendorAddrHtml = [
    vendor?.address_line1, vendor?.address_line2,
    [vendor?.city, vendor?.state, vendor?.zip].filter(Boolean).join(', '),
  ].filter(Boolean).map(l => cesc(l as string)).join('<br>');
  const vendorContactHtml = [vendor?.email, vendor?.phone].filter(Boolean).map(cesc).join(' &middot; ');
  const vendorHtml = `<b>${cesc(vendor?.name || 'Vendor')}</b>` +
    (vendorAddrHtml ? '<br>' + vendorAddrHtml : '') +
    (vendorContactHtml ? '<br>' + vendorContactHtml : '');

  // Ship To resolves settings overrides → company address (original logic unchanged)
  const shipName  = settings?.ship_to_name  || company?.name  || '';
  const shipL1    = settings?.ship_to_address_line1 || company?.address_line1 || '';
  const shipL2    = settings?.ship_to_address_line2 || company?.address_line2 || '';
  const shipCity  = settings?.ship_to_city  || company?.city  || '';
  const shipState = settings?.ship_to_state || company?.state || '';
  const shipZip   = settings?.ship_to_zip   || company?.zip   || '';
  const shipAddrHtml = [shipL1, shipL2, [shipCity, shipState, shipZip].filter(Boolean).join(', ')]
    .filter(Boolean).map(l => cesc(l as string)).join('<br>');
  const shipHtml = `<b>${cesc(shipName)}</b>` + (shipAddrHtml ? '<br>' + shipAddrHtml : '');

  const parties = boxRow([
    { label: 'Vendor',   html: vendorHtml },
    { label: 'Ship To',  html: shipHtml },
  ]);

  // ── Feature #8: PO delivery timeline (classic = text info row) ──
  // The original shows a color-filled progress bar. Classic replaces this with
  // a plain text row showing order status relative to today's date.
  const deliveryTimelineHTML = (() => {
    const orderRaw    = po.order_date || po.issue_date;
    const expectedRaw = po.expected_delivery_date || po.expected_date;
    if (!orderRaw || !expectedRaw) return '';
    const order    = new Date(orderRaw + 'T12:00:00').getTime();
    const expected = new Date(expectedRaw + 'T12:00:00').getTime();
    const today    = Date.now();
    if (!isFinite(order) || !isFinite(expected) || expected <= order) return '';
    const overdue     = today > expected;
    const approaching = !overdue && (expected - today) < (expected - order) * 0.2;
    const daysLeft    = Math.ceil((expected - today) / 86_400_000);
    const daysOver    = Math.floor((today - expected) / 86_400_000);
    const statusText  = overdue
      ? `OVERDUE by ${daysOver} day${daysOver !== 1 ? 's' : ''}`
      : approaching
        ? `APPROACHING — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`
        : `ON TRACK — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`;
    return `<div style="padding:7px 16px;border-top:1px solid #000;border-bottom:1px solid #000;font-size:10px;">` +
      `<span class="sec-label">Delivery Timeline</span>&nbsp;&nbsp;` +
      `Ordered ${cesc(fmtDateMaybe(orderRaw))} &nbsp;&middot;&nbsp; ` +
      `Expected ${cesc(fmtDateMaybe(expectedRaw))} &nbsp;&middot;&nbsp; ` +
      `<b>${cesc(statusText)}</b>` +
      `</div>`;
  })();

  // ── Line items table ──
  // Columns: Description / Qty / Unit / Unit Price / Tax % / Line Total
  const lineColumns: RuledColumn[] = [
    { label: 'Description' },
    { label: 'Qty',        align: 'right',  width: '50px' },
    { label: 'Unit',       align: 'center', width: '60px' },
    { label: 'Unit Price', align: 'right',  width: '90px' },
    { label: 'Tax %',      align: 'right',  width: '60px' },
    { label: 'Line Total', align: 'right',  width: '100px' },
  ];
  const lineRows: string[][] = (lineItems || []).map((l: any) => {
    const qty     = Number(l.quantity || 0);
    const unit    = Number(l.unit_price || 0);
    const amt     = Number(l.amount ?? qty * unit);
    const taxRate = Number(l.tax_rate || 0);
    return [
      cesc(l.description || ''),
      cesc(String(qty)),
      cesc(l.unit_label || ''),
      cesc(fmt(unit)),
      taxRate > 0 ? cesc(taxRate + '%') : '—',
      cesc(fmt(amt)),
    ];
  });
  const emptyRow: string[][] = lineRows.length === 0
    ? [[`<span style="font-style:italic;">(no line items)</span>`, '', '', '', '', '']]
    : [];
  const itemsTable = ruledTable(lineColumns, lineRows.length > 0 ? lineRows : emptyRow);

  // ── Totals box (math unchanged) ──
  const totalRows: { label: string; value: string; grand?: boolean }[] = [
    { label: 'Subtotal', value: fmt(subtotal) },
  ];
  if (tax > 0) totalRows.push({ label: 'Tax', value: fmt(tax) });
  totalRows.push({ label: 'Order Total', value: fmt(total), grand: true });
  const totals = totalsBox(totalRows);

  // ── Terms & Conditions ──
  const terms         = po.terms || '';
  const deliveryTerms = settings?.delivery_terms || '';
  const paymentTerms  = settings?.payment_terms || '';
  const termsHTML = (terms || deliveryTerms || paymentTerms)
    ? boxRow([{
        label: 'Terms & Conditions',
        html: [
          deliveryTerms ? `<b>Delivery:</b> ${cesc(deliveryTerms)}` : '',
          paymentTerms  ? `<b>Payment:</b> ${cesc(paymentTerms)}`  : '',
          terms         ? `<div style="margin-top:4px;white-space:pre-line;">${cesc(terms)}</div>` : '',
        ].filter(Boolean).join('<br>'),
      }])
    : '';

  // ── Notes ──
  const notesHTML = po.notes
    ? boxRow([{ label: 'Notes', html: `<div style="white-space:pre-line;">${cesc(po.notes)}</div>` }])
    : '';

  // ── Signature block (Approved by / Date) ──
  const sigHTML = `<div style="padding:18px 16px 12px;border-top:2px solid #000;">` +
    `<div style="display:flex;gap:40px;">` +
    `<div style="flex:1;"><div style="border-bottom:1px solid #000;height:28px;"></div>` +
    `<div style="font-size:10px;margin-top:4px;">Approved by</div></div>` +
    `<div style="flex:1;"><div style="border-bottom:1px solid #000;height:28px;"></div>` +
    `<div style="font-size:10px;margin-top:4px;">Date</div></div>` +
    `</div></div>`;

  // ── Footer ──
  const generated  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const footerLine = [
    `Purchase Order ${po.po_number || ''}`,
    company?.name || 'Company',
    `Generated ${generated}`,
  ].filter(Boolean).join(' · ');

  // ── Assemble ──
  const inner =
    header +
    meta +
    parties +
    deliveryTimelineHTML +
    itemsTable +
    `<div style="display:flex;justify-content:flex-end;padding:10px 16px;">${totals}</div>` +
    termsHTML +
    notesHTML +
    sigHTML +
    footerBar(footerLine);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Order ${cesc(po.po_number || '')}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(inner, { draft: isDraft }) +
    `</body></html>`;
}

// ═══════════════════════════════════════════════════════════════
// EXPENSE RECEIPT TEMPLATE
// ═══════════════════════════════════════════════════════════════

export function generateExpenseReceiptHTML(
  expense: any,
  company: any,
  vendor?: any,
  lineItems?: any[]
): string {
  // ── CLASSIC THEME: Arial + pure black/white. ──

  // Multi-currency: shadow module-level fmt with expense's currency
  const docCurrency = expense.currency || 'USD';
  const fmt = (v: number | string | null | undefined) => formatCurrency(v, docCurrency);

  // ── Math (unchanged) ──
  // FINAL-PRICE: expense.amount is the PRE-TAX subtotal and tax_amount is the
  // tax, so the final cost ALWAYS adds tax on top (amount + tax − discount).
  const tax = Number(expense.tax_amount || 0);
  const subtotal = Number(expense.amount || expense.subtotal || 0);
  const expDiscFlat = Number(expense.discount_amount || 0);
  const expDiscPct = Number(expense.discount_percent || 0);
  const grossWithTax = subtotal + tax;
  const expDiscountTotal = Math.min(grossWithTax, expDiscFlat + grossWithTax * (expDiscPct / 100));
  const total = Math.max(0, grossWithTax - expDiscountTotal);

  const reimbStatus = expense.reimbursement_status || expense.status || 'pending';

  // Line items table — surface per-line notations (tags + notes) directly
  // beneath the description so the printed record is auditable: each purchase
  // line carries its own context, not just the rolled-up expense description.
  // tags is stored as a JSON array string; notes is plain text.
  const renderLineMeta = (l: any): string => {
    let tags: string[] = [];
    if (Array.isArray(l.tags)) {
      tags = l.tags.filter((t: any) => t != null && String(t).trim() !== '');
    } else if (typeof l.tags === 'string' && l.tags.trim() && l.tags.trim() !== '[]') {
      try {
        const parsed = JSON.parse(l.tags);
        if (Array.isArray(parsed)) tags = parsed.filter((t: any) => t != null && String(t).trim() !== '');
      } catch {
        // tags may also be stored as a comma-separated string in legacy rows
        tags = l.tags.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }
    const notes = (l.notes || '').toString().trim();
    if (tags.length === 0 && !notes) return '';
    const tagsHTML = tags.length > 0
      ? `<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px;">${tags.map(t =>
          `<span style="display:inline-block;padding:1px 5px;font-size:9px;background:#f0f0f0;color:#000;border:1px solid #888;border-radius:0;">${esc(t)}</span>`
        ).join('')}</div>`
      : '';
    const notesHTML = notes
      ? `<div style="margin-top:3px;font-size:10px;color:#333;font-style:italic;white-space:pre-line;">${esc(notes)}</div>`
      : '';
    return tagsHTML + notesHTML;
  };

  // ── Receipt image (classic: grayscale, hard border) ──
  const receiptImgSrc = expense.receipt_path || expense.receipt_data || null;
  const receiptImgHTML = receiptImgSrc
    ? (() => {
        const s = String(receiptImgSrc);
        if (!/^data:|^https?:/i.test(s)) return '';
        return `<img src="${cesc(s)}" alt="Receipt" style="max-width:100%;max-height:380px;object-fit:contain;border:2px solid #000;padding:6px;background:#fff;display:block;margin:0 auto;filter:grayscale(1);">`;
      })()
    : '';

  // ── Line items table (classic ruledTable) ──
  const linesHTML = (lineItems && lineItems.length > 0)
    ? ruledTable(
        [
          { label: 'Description' },
          { label: 'Qty',        align: 'right', width: '60px' },
          { label: 'Unit Price', align: 'right', width: '100px' },
          { label: 'Amount',     align: 'right', width: '110px' },
        ],
        lineItems.map((l: any) => {
          const qty  = Number(l.quantity  || 1);
          const unit = Number(l.unit_price || 0);
          const amt  = Number(l.amount    || 0);
          const meta = renderLineMeta(l);
          return [
            cesc(l.description || '') + (meta ? `<div style="margin-top:3px;">${meta}</div>` : ''),
            cesc(String(qty)),
            cesc(fmt(unit)),
            cesc(fmt(amt)),
          ];
        }),
      )
    : '';

  // ── Details & Classification grid (all fields preserved) ──
  const dash = (v: any): string => {
    if (v === 0) return '0';
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  };
  const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const reimbursableLabel = expense.is_reimbursable
    ? (expense.reimbursed ? `Reimbursed${expense.reimbursed_date ? ' ' + fmtDateMaybe(expense.reimbursed_date) : ''}` : 'Pending')
    : 'No';
  const exch = Number(expense.exchange_rate || 1);
  const miles = Number(expense.miles || 0);
  const detailRows: Array<[string, string]> = [
    ['Payment Method', expense.payment_method ? titleCase(String(expense.payment_method)) : '—'],
    ['Status', expense.status ? titleCase(String(expense.status)) : '—'],
    ['Approval', expense.approval_status ? titleCase(String(expense.approval_status)) : '—'],
    ['Project', dash(expense.project_name)],
    ['Billable', expense.is_billable ? 'Yes' : 'No'],
    ['Reimbursable', reimbursableLabel],
    ['Tax-Deductible', expense.is_tax_deductible === 0 ? 'No' : 'Yes'],
    ['Tax Amount', fmt(tax)],
    ['Tip Amount', fmt(Number(expense.tip_amount || 0))],
    ['Currency', String(expense.currency || 'USD')],
    ['Exchange Rate', exch && exch !== 1 ? exch.toFixed(4) : '—'],
    ['Schedule C Line', dash(expense.schedule_c_line)],
    ['Mileage', miles > 0 ? `${miles.toFixed(1)} mi @ $${Number(expense.mileage_rate || 0.7).toFixed(2)}` : '—'],
    ['Merchant Location', dash(expense.merchant_location)],
    ['Recurring', expense.is_recurring ? 'Yes' : 'No'],
    ['Submitted', expense.created_at ? fmtDateMaybe(expense.created_at) : '—'],
  ];
  const detailsHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px 14px;">
    ${detailRows.map(([k, v]) => `<div>
      <div style="font-size:8.5px;text-transform:uppercase;letter-spacing:0.04em;color:#555;font-weight:600;">${esc(k)}</div>
      <div style="font-size:11px;color:#000;font-weight:600;margin-top:1px;">${esc(v)}</div>
    </div>`).join('')}
  </div>`;

  // ── Resolved vars (were undefined in merged code) ──
  const shipping  = Number(expense.shipping_amount || 0);
  const generated = new Date().toLocaleString('en-US');

  // ── Header ──
  const numberHtml = cesc(expense.reference || expense.expense_number || expense.id || '');
  const header = docHeader({
    coName: company?.name || 'Company',
    coDetailHtml: [
      cesc([company?.address_line1, company?.address_line2,
        [company?.city, company?.state, company?.zip].filter(Boolean).join(', ')].filter(Boolean).join(', ')),
      [cesc(company?.email || ''), cesc(company?.phone || '')].filter(Boolean).join(' &middot; '),
    ].filter(Boolean).join('<br>'),
    title: 'Expense Record',
    numberHtml,
  });

  // ── Vendor block ──
  const vendorAddrHtml = [
    vendor?.address_line1 || vendor?.address,
    vendor?.address_line2,
    [vendor?.city, vendor?.state, vendor?.zip].filter(Boolean).join(', '),
  ].filter(Boolean).map(l => cesc(l as string)).join('<br>');
  // Vendor logo: stored as a data-URI (base64). Grayscale to match the classic B&W theme.
  const vendorLogoSrc = vendor?.logo_data;
  const vendorLogoHTML = vendorLogoSrc && /^data:image\//i.test(String(vendorLogoSrc))
    ? `<div style="margin-bottom:6px;"><img src="${cesc(String(vendorLogoSrc))}" alt="Vendor logo" style="max-width:140px;max-height:56px;object-fit:contain;display:block;"></div>`
    : '';
  const vendorHtml =
    vendorLogoHTML +
    `<b>${cesc(vendor?.name || expense.vendor_name || '—')}</b>` +
    (vendorAddrHtml ? '<br>' + vendorAddrHtml : '') +
    (vendor?.phone   ? '<br>' + cesc(vendor.phone)   : '') +
    (vendor?.email   ? '<br>' + cesc(vendor.email)   : '') +
    (vendor?.website ? '<br>' + cesc(vendor.website) : '') +
    (vendor?.tax_id  ? `<br><span style="font-size:9px;">Tax ID: ${cesc(vendor.tax_id)}</span>` : '');

  // ── Meta strip ──
  const metaCells: { label: string; value: string }[] = [
    { label: 'Date',     value: fmtDateMaybe(expense.date || expense.expense_date) || '—' },
    { label: 'Category', value: expense.category || expense.category_name || '—' },
    { label: 'Reference', value: expense.reference || '—' },
  ];
  if (expense.payment_method) metaCells.push({ label: 'Payment Method', value: formatPaymentMethod(expense.payment_method) });
  if (expense.merchant_location) metaCells.push({ label: 'Merchant Location', value: expense.merchant_location });
  if (expense.geo_location_name) metaCells.push({ label: 'GPS / Location', value: expense.geo_location_name });
  if (shipping > 0 && expense.shipping_speed) metaCells.push({ label: 'Shipping Speed', value: expense.shipping_speed });
  const meta = metaStrip(metaCells);

  // ── Party box ──
  const parties = boxRow([{ label: 'Vendor', html: vendorHtml }]);

  // ── Details & Classification ──
  const detailsTable = boxRow([{ label: 'Details & Classification', html: detailsHTML }]);

  // ── Description ──
  const descHTML = expense.description
    ? boxRow([{ label: 'Description', html: `<div style="white-space:pre-line;">${cesc(expense.description)}</div>` }])
    : '';

  // ── Totals ──
  const totalRows: { label: string; value: string; grand?: boolean }[] = [
    { label: `Subtotal (pre-tax)`, value: fmt(subtotal) },
  ];
  if (tax > 0) totalRows.push({ label: `Tax${expense.tax_inclusive ? ' (incl.)' : ''}`, value: fmt(tax) });
  if (expDiscountTotal > 0) totalRows.push({ label: 'Discount', value: `−${fmt(expDiscountTotal)}` });
  totalRows.push({ label: `Total Expense`, value: fmt(total), grand: true });
  const totals = totalsBox(totalRows);

  // ── Reimbursement status ──
  const reimbLabel = String(reimbStatus).toUpperCase().replace('_', ' ');
  const reimbHTML = boxRow([{
    label: 'Reimbursement',
    html: `<span style="font-weight:700;">${cesc(reimbLabel)}</span>`,
  }]);

  // ── Receipt image section ──
  const receiptSection = receiptImgHTML
    ? `<div style="margin-top:14px;page-break-inside:avoid;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Receipt</div><div style="text-align:center;">${receiptImgHTML}</div></div>`
    : '';

  // ── Footer ──
  const footerLine = [company?.name || '', `Expense ${numberHtml}`, `Generated ${generated}`].filter(Boolean).join(' · ');

  // ── Assemble ──
  const inner =
    header +
    meta +
    parties +
    detailsTable +
    descHTML +
    linesHTML +
    `<div style="display:flex;justify-content:flex-end;padding:6px 12px;">${totals}</div>` +
    reimbHTML +
    receiptSection +
    footerBar(footerLine);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Expense Record ${cesc(numberHtml)}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(inner) +
    `</body></html>`;
}

// ─── Employee Record (HR Portal Wave) ─────────────────────────────────
// Full printable employee record — 8.5×11 personnel file sheet covering
// identity (SSN last-4 only), employment, compensation, tax withholding,
// banking (last-4 only), emergency contact, PTO balances, active
// garnishments/advances, and acknowledgment signature lines.
export function generateEmployeeRecordHTML(data: {
  employee: any;
  company: any;
  ytd?: { gross: number; net: number };
  pto?: any[];
  garnishments?: any[];
  advances?: any[];
}): string {
  const { employee: emp, company, ytd, pto = [], garnishments = [], advances = [] } = data;
  const dash = (v: any): string => (v === null || v === undefined || v === '' ? '—' : String(v));
  const money = (v: any): string => formatCurrency(Number(v) || 0);
  const generated = new Date().toLocaleString('en-US');

  const ssnDisplay = emp.ssn_last4 ? `XXX-XX-${emp.ssn_last4}` : '—';
  const acctDisplay = emp.account_number ? `••••${emp.account_number}` : '—';
  const routingDisplay = emp.routing_number ? `••••${emp.routing_number}` : '—';
  const statusColor = emp.status === 'active' ? '#16a34a' : '#94a3b8';
  const address = [emp.address_line1, emp.address_line2, [emp.city, emp.state, emp.zip].filter(Boolean).join(', ')]
    .filter(Boolean).join(' · ');

  const payRateLabel = emp.pay_type === 'salary'
    ? `${money(emp.pay_rate)} / year`
    : `${money(emp.pay_rate)} / hour`;
  const scheduleLabels: Record<string, string> = { weekly: 'Weekly', biweekly: 'Bi-Weekly', semimonthly: 'Semi-Monthly', monthly: 'Monthly' };

  const grid = (rows: Array<[string, string]>): string => `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 18px;margin-top:8px;">
    ${rows.map(([k, v]) => `<div>
      <div style="font-size:8.5px;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;font-weight:600;">${esc(k)}</div>
      <div style="font-size:11px;color:#0f172a;font-weight:600;margin-top:2px;">${esc(v)}</div>
    </div>`).join('')}
  </div>`;

  const ptoHTML = pto.length > 0 ? `
  <div style="margin-top:16px;">
    <div class="section-label">PTO Balances</div>
    <table style="margin-top:6px;">
      <thead><tr><th>Type</th><th class="text-right">Accrued</th><th class="text-right">Used</th><th class="text-right">Available</th></tr></thead>
      <tbody>${pto.map((p: any) => `<tr>
        <td>${esc(p.pto_type || p.type || 'PTO')}</td>
        <td class="text-right">${(Number(p.accrued_hours ?? p.accrued) || 0).toFixed(1)} h</td>
        <td class="text-right">${(Number(p.used_hours ?? p.used) || 0).toFixed(1)} h</td>
        <td class="text-right font-bold">${((Number(p.accrued_hours ?? p.accrued) || 0) - (Number(p.used_hours ?? p.used) || 0)).toFixed(1)} h</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : '';

  const garnHTML = garnishments.length > 0 ? `
  <div style="margin-top:16px;">
    <div class="section-label">Active Garnishment Orders</div>
    <table style="margin-top:6px;">
      <thead><tr><th>Type</th><th>Case #</th><th class="text-right">Per-Pay Amount</th><th class="text-right">Remaining</th></tr></thead>
      <tbody>${garnishments.map((g: any) => `<tr>
        <td>${esc(g.garnishment_type || g.type || 'Garnishment')}</td>
        <td>${esc(g.case_number || '—')}</td>
        <td class="text-right">${money(g.per_pay_amount ?? g.amount_per_pay)}</td>
        <td class="text-right">${money(g.remaining_balance ?? g.balance)}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : '';

  const advHTML = advances.length > 0 ? `
  <div style="margin-top:16px;">
    <div class="section-label">Outstanding Pay Advances</div>
    <table style="margin-top:6px;">
      <thead><tr><th>Date</th><th class="text-right">Advanced</th><th class="text-right">Repay / Pay</th><th class="text-right">Balance</th><th>Status</th></tr></thead>
      <tbody>${advances.map((a: any) => `<tr>
        <td>${esc(fmtDateMaybe(a.advance_date))}</td>
        <td class="text-right">${money(a.advance_amount)}</td>
        <td class="text-right">${money(a.repayment_per_pay)}</td>
        <td class="text-right font-bold">${money(a.balance)}</td>
        <td>${esc(String(a.status || 'active').toUpperCase())}${a.related_debt_id ? ' · IN COLLECTIONS' : ''}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Employee Record — ${esc(emp.name || '')}</title>
<style>${classicStyles()}</style></head>
<body><div class="rpt-page" style="padding:32px 36px;">
<div class="fd-letterhead">
  <div class="fd-letterhead-left">
    <div class="fd-co-name" style="font-size:14px;">${esc(company?.name || 'Company')}</div>
    <div style="font-size:9px;color:#64748b;margin-top:2px;">${esc([company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', '))}</div>
  </div>
  <div class="fd-letterhead-right">
    <div class="fd-doc-type" style="font-size:22px;">Employee Record</div>
    <div class="fd-doc-num">${esc(emp.name || '')}${statusBadgeInline(String(emp.status || 'active').toUpperCase(), statusColor)}</div>
    <div class="fd-doc-date">Generated ${esc(generated)}</div>
  </div>
</div>

<div style="margin-top:18px;">
  <div class="section-label">Identity &amp; Contact</div>
  ${grid([
    ['Full Name', dash(emp.name)],
    ['SSN', ssnDisplay],
    ['Email', dash(emp.email)],
    ['Phone', dash(emp.phone)],
    ['Address', address || '—'],
    ['Emergency Contact', dash(emp.emergency_contact_name)],
    ['Emergency Phone', dash(emp.emergency_contact_phone)],
    ['Employee ID', String(emp.id || '').slice(0, 8).toUpperCase()],
  ])}
</div>

<div style="margin-top:16px;">
  <div class="section-label">Employment</div>
  ${grid([
    ['Status', String(emp.status || 'active').toUpperCase()],
    ['Type', dash(emp.employment_type || emp.type)],
    ['Department', dash(emp.department)],
    ['Job Title', dash(emp.job_title)],
    ['Start Date', fmtDateMaybe(emp.start_date) || '—'],
    ['End Date', emp.end_date ? fmtDateMaybe(emp.end_date) : '—'],
    ['Work Location', dash(emp.work_location)],
    ['Role', dash(emp.role)],
  ])}
</div>

<div style="margin-top:16px;">
  <div class="section-label">Compensation &amp; Payroll</div>
  ${grid([
    ['Pay Type', emp.pay_type === 'salary' ? 'Salary' : 'Hourly'],
    ['Pay Rate', payRateLabel],
    ['Pay Schedule', scheduleLabels[emp.pay_schedule] || dash(emp.pay_schedule)],
    ['Rate Effective', emp.pay_rate_effective_date ? fmtDateMaybe(emp.pay_rate_effective_date) : '—'],
    ['YTD Gross', money(ytd?.gross)],
    ['YTD Net', money(ytd?.net)],
    ['Filing Status', dash(emp.w4_filing_status || emp.filing_status)],
    ['W-4 Received', emp.w4_received_date ? fmtDateMaybe(emp.w4_received_date) : '—'],
  ])}
</div>

<div style="margin-top:16px;">
  <div class="section-label">Direct Deposit (masked)</div>
  ${grid([
    ['Account Type', dash(emp.account_type)],
    ['Routing #', routingDisplay],
    ['Account #', acctDisplay],
    ['State', dash(emp.state)],
  ])}
</div>

${ptoHTML}
${garnHTML}
${advHTML}

<div style="margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:32px;">
  <div>
    <div style="border-top:1px solid #0f172a;padding-top:4px;font-size:9px;color:#64748b;">Employee Signature</div>
    <div style="margin-top:24px;border-top:1px solid #0f172a;padding-top:4px;font-size:9px;color:#64748b;">Date</div>
  </div>
  <div>
    <div style="border-top:1px solid #0f172a;padding-top:4px;font-size:9px;color:#64748b;">HR / Authorized Representative</div>
    <div style="margin-top:24px;border-top:1px solid #0f172a;padding-top:4px;font-size:9px;color:#64748b;">Date</div>
  </div>
</div>

<div style="margin-top:18px;font-size:8px;color:#94a3b8;">
  Confidential personnel record. SSN and bank details are masked to last-4 by design; the full values
  are never embedded in this document. Retain per company document-retention policy.
</div>

<div style="margin-top:10px;display:flex;justify-content:space-between;font-size:8px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:6px;">
  <span>${esc(company?.name || '')}</span>
  <span>Generated ${esc(generated)}</span>
</div>
</div></body></html>`;
}

// ─── Wage Withholding Agreement (Debt Collections 200 Wave) ───────────
// Printable authorization: employee agrees to a per-paycheck deduction
// applied to a specific employee-debtor case. 8.5×11 with terms,
// repayment math, and dual signature blocks.
export function generateWageWithholdingAgreementHTML(data: {
  withholding: any;
  employee: any;
  debt: any;
  company: any;
}): string {
  const { withholding: w, employee: emp, debt, company } = data;
  const money = (v: any): string => formatCurrency(Number(v) || 0);
  const generated = new Date().toLocaleString('en-US');
  const perPay = Number(w?.per_pay_amount) || 0;
  const balance = Number(debt?.balance_due) || 0;
  const estPayments = perPay > 0 ? Math.ceil(balance / perPay) : 0;
  const scheduleLabels: Record<string, string> = { weekly: 'weekly', biweekly: 'bi-weekly', semimonthly: 'semi-monthly', monthly: 'monthly' };
  const schedule = scheduleLabels[emp?.pay_schedule] || 'per-paycheck';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Wage Withholding Agreement — ${esc(emp?.name || '')}</title>
<style>${classicStyles()}</style></head>
<body><div class="rpt-page" style="padding:40px 48px;">
<div class="fd-letterhead">
  <div class="fd-letterhead-left">
    <div class="fd-co-name" style="font-size:14px;">${esc(company?.name || 'Company')}</div>
    <div style="font-size:9px;color:#64748b;margin-top:2px;">${esc([company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', '))}</div>
  </div>
  <div class="fd-letterhead-right">
    <div class="fd-doc-type" style="font-size:20px;">Wage Withholding<br/>Authorization Agreement</div>
    <div class="fd-doc-date">Generated ${esc(generated)}</div>
  </div>
</div>

<div style="margin-top:20px;font-size:11px;line-height:1.7;color:#0f172a;">
  <p>This Voluntary Wage Withholding Authorization (“Agreement”) is entered into between
  <strong>${esc(company?.name || 'the Company')}</strong> (“Employer”) and
  <strong>${esc(emp?.name || 'the Employee')}</strong>${emp?.job_title ? `, ${esc(emp.job_title)}` : ''}
  (“Employee”), effective ${esc(fmtDateMaybe(w?.start_date) || '____________')}.</p>

  <p><strong>1. Acknowledged Debt.</strong> Employee acknowledges owing Employer the amount of
  <strong>${money(debt?.original_amount)}</strong> (current outstanding balance
  <strong>${money(balance)}</strong>, with <strong>${money(debt?.payments_made)}</strong> repaid to date),
  arising from ${esc(debt?.notes || 'amounts advanced by Employer to Employee')}.</p>

  <p><strong>2. Authorization.</strong> Employee voluntarily authorizes Employer to deduct
  <strong>${money(perPay)}</strong> from each ${esc(schedule)} paycheck, beginning
  ${esc(fmtDateMaybe(w?.start_date) || 'the next regular pay date')}, and continuing until the
  balance is paid in full${estPayments > 0 ? ` (approximately <strong>${estPayments}</strong> paychecks at the current balance)` : ''}.
  The final deduction will be reduced as needed so total withholding never exceeds the outstanding balance.</p>

  <p><strong>3. Limits.</strong> Deductions under this Agreement shall not reduce Employee's pay below
  applicable federal or state minimum-wage or wage-deduction limits. If a scheduled deduction would
  exceed a legal limit, the deduction shall be reduced to the maximum lawful amount for that period.</p>

  <p><strong>4. Voluntary; Revocation.</strong> This authorization is voluntary and may be revoked by
  Employee in writing at any time. Revocation does not extinguish the underlying debt, which remains
  due and may be pursued through other lawful means.</p>

  <p><strong>5. Early Payoff &amp; Separation.</strong> Employee may repay the remaining balance early at
  any time without penalty. Upon separation of employment, the remaining balance becomes due and,
  to the extent permitted by law, may be deducted from final wages.</p>
</div>

<div style="margin-top:18px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;">
  <div class="section-label">Repayment Summary</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 18px;margin-top:8px;">
    ${[
      ['Outstanding Balance', money(balance)],
      ['Per-Paycheck Deduction', money(perPay)],
      ['Pay Frequency', schedule[0].toUpperCase() + schedule.slice(1)],
      ['Est. Paychecks to Payoff', estPayments > 0 ? String(estPayments) : '—'],
    ].map(([k, v]) => `<div>
      <div style="font-size:8.5px;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;font-weight:600;">${esc(k)}</div>
      <div style="font-size:12px;color:#0f172a;font-weight:700;margin-top:2px;">${esc(v)}</div>
    </div>`).join('')}
  </div>
</div>

<div style="margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:32px;">
  <div>
    <div style="border-top:1px solid #0f172a;padding-top:4px;font-size:9px;color:#64748b;">Employee Signature — ${esc(emp?.name || '')}</div>
    <div style="margin-top:26px;border-top:1px solid #0f172a;padding-top:4px;font-size:9px;color:#64748b;">Date</div>
  </div>
  <div>
    <div style="border-top:1px solid #0f172a;padding-top:4px;font-size:9px;color:#64748b;">Employer Representative — ${esc(company?.name || '')}</div>
    <div style="margin-top:26px;border-top:1px solid #0f172a;padding-top:4px;font-size:9px;color:#64748b;">Date</div>
  </div>
</div>

<div style="margin-top:20px;font-size:8px;color:#94a3b8;">
  This document is a template for a voluntary wage-deduction authorization and is not legal advice.
  Wage-deduction rules vary by jurisdiction — consult counsel before relying on this form.
</div>
</div></body></html>`;
}
