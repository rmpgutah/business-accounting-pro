/**
 * Print Template Generators
 * Produces self-contained HTML strings for invoices, pay stubs, and reports.
 * Light theme, professional layout, inline CSS, print-optimized.
 */

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

// ─── Currency Formatter ──────────────────────────────────────
// formatCurrency guards against Infinity/NaN/non-finite values that would
// otherwise render as "$NaN" or "$∞" in customer-facing PDFs.
export function formatCurrency(n: number | string | null | undefined): string {
  const num = typeof n === 'number' ? n : Number(n ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(safe);
}
// Accounting-style negatives: -1234.56 → "(1,234.56)"
export function formatAccountingAmount(n: number | string | null | undefined): string {
  const num = typeof n === 'number' ? n : Number(n ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  if (safe < 0) {
    const positive = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    }).format(Math.abs(safe));
    return `(${positive})`;
  }
  return formatCurrency(safe);
}
const fmt = formatCurrency;

const fmtDate = (d: string) => {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return d; }
};

// ─── Shared base styles ─────────────────────────────────────
const baseStyles = `
  /* ════════════════════════════════════════════════════════════════
     BAP Print Stylesheet — modernized 2026-05-05
     Design tokens layered on top so legacy classes keep working.
     ════════════════════════════════════════════════════════════════ */

  /* Design tokens — change these to retheme everything at once */
  :root {
    --ink:          #0f172a;
    --ink-soft:     #1e293b;
    --ink-muted:    #475569;
    --ink-faint:    #64748b;
    --ink-faintest: #94a3b8;
    --paper:        #ffffff;
    --paper-soft:   #fafbfc;
    --paper-tint:   #f8fafc;
    --rule:         #e2e8f0;
    --rule-soft:    #f1f5f9;
    --rule-strong:  #cbd5e1;
    --accent:       #2563eb;
    --accent-soft:  #dbeafe;
    --positive:     #16a34a;
    --positive-soft:#dcfce7;
    --negative:     #dc2626;
    --negative-soft:#fee2e2;
    --warning:      #d97706;
    --warning-soft: #fef3c7;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 1.55;
    background: var(--paper);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    font-feature-settings: 'kern', 'liga', 'calt';
  }
  /* Page numbers (Chromium printToPDF supports CSS Paged Media counters
     in modern Electron). Counter resets per @page rule. Falls back gracefully
     if the engine doesn't render the @bottom-right region. */
  @page {
    size: letter;
    margin: 0.55in 0.5in 0.65in 0.5in;
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font-family: 'Inter', sans-serif;
      font-size: 8.5pt;
      color: #94a3b8;
    }
  }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { padding: 9px 14px; text-align: left; word-wrap: break-word; overflow-wrap: anywhere; }
  th {
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: var(--ink-faint);
    border-bottom: 1.5px solid var(--ink);
    background: linear-gradient(180deg, var(--paper-tint) 0%, var(--paper-soft) 100%);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  td { border-bottom: 1px solid var(--rule); color: var(--ink-muted); font-size: 11px; }
  tr:nth-child(even) td { background: rgba(248,250,252,0.55); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tr:hover td { background: rgba(219, 234, 254, 0.25); }
  .text-right { text-align: right; font-variant-numeric: tabular-nums; }
  .font-mono { font-variant-numeric: tabular-nums; font-family: 'SF Mono', 'Menlo', Consolas, 'Courier New', monospace; }
  .font-bold { font-weight: 700; }
  .text-muted { color: var(--ink-faintest); }
  .text-dark { color: var(--ink); }
  .text-green { color: var(--positive); }
  .text-red { color: var(--negative); }
  .text-blue { color: var(--accent); }
  .section-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    color: var(--ink-faint); letter-spacing: 0.8px; margin-bottom: 6px;
  }
  /* Hero "big number" — for invoice total, balance due, net pay, etc. */
  .hero-num {
    font-family: 'Inter', sans-serif;
    font-size: 32px;
    font-weight: 800;
    color: var(--ink);
    letter-spacing: -0.5px;
    font-variant-numeric: tabular-nums;
    line-height: 1.05;
  }
  .hero-num-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--ink-faint);
    margin-bottom: 4px;
  }
  /* Watermark for DRAFT / VOID / PAID / OVERDUE stamps */
  .stamp-watermark {
    position: fixed;
    top: 38%;
    left: 18%;
    transform: rotate(-22deg);
    font-size: 140px;
    font-weight: 900;
    letter-spacing: 12px;
    color: rgba(0,0,0,0.05);
    pointer-events: none;
    z-index: 0;
    text-transform: uppercase;
    font-family: 'Inter', sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .stamp-watermark.draft   { color: rgba(100, 116, 139, 0.10); }
  .stamp-watermark.paid    { color: rgba(22, 163, 74, 0.10); }
  .stamp-watermark.void    { color: rgba(220, 38, 38, 0.10); }
  .stamp-watermark.overdue { color: rgba(220, 38, 38, 0.10); }
  /* Accent gradient bar — subtle decorative element for headers */
  .accent-bar {
    height: 4px;
    background: linear-gradient(90deg, var(--ink) 0%, var(--accent) 50%, var(--ink) 100%);
    margin-bottom: 18px;
    border-radius: 2px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Status pill — replaces the older .fd-status-badge with cleaner look */
  .status-pill {
    display: inline-block;
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1.5px solid;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .status-pill.paid     { color: var(--positive); border-color: var(--positive); background: var(--positive-soft); }
  .status-pill.draft    { color: var(--ink-faint); border-color: var(--rule-strong); background: var(--paper-tint); }
  .status-pill.sent     { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .status-pill.overdue  { color: var(--negative); border-color: var(--negative); background: var(--negative-soft); }
  .status-pill.partial  { color: var(--warning); border-color: var(--warning); background: var(--warning-soft); }
  .status-pill.cancelled, .status-pill.void { color: var(--ink-faint); border-color: var(--ink-faintest); background: var(--paper-tint); text-decoration: line-through; }
  /* Subtle card surface for sub-sections inside templates */
  .card-surface {
    background: var(--paper-soft);
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 14px 16px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .card-surface.elevated {
    box-shadow: 0 1px 0 rgba(15,23,42,0.04);
  }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; break-after: avoid; }
  img { max-width: 100%; height: auto; }
  /* Let totals/footer blocks stay together */
  .totals, .totals-box, .balance-box, .net-pay-box, .signature-block, .sig-block, .footer-co { page-break-inside: avoid; break-inside: avoid; }
  /* ── Enhanced report utilities (modernized 2026-05-05) ── */
  .rpt-page { padding: 40px 44px; }
  .rpt-hdr {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 3px solid var(--ink); padding-bottom: 18px; margin-bottom: 24px;
  }
  .rpt-co { font-size: 22px; font-weight: 800; color: var(--ink); letter-spacing: -0.4px; }
  .rpt-co-sub { font-size: 11px; color: var(--ink-faint); margin-top: 4px; font-weight: 500; }
  .rpt-badge {
    font-size: 11px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.4px; color: var(--ink); padding: 7px 16px;
    border: 2px solid var(--ink); border-radius: 6px;
    background: linear-gradient(180deg, #ffffff 0%, var(--paper-tint) 100%);
  }
  .rpt-meta {
    display: flex; gap: 28px; margin-bottom: 22px; padding: 14px 18px;
    background: var(--paper-tint); border: 1px solid var(--rule);
    border-radius: 6px; border-left: 3px solid var(--accent);
  }
  .rpt-meta-item .rpt-meta-label {
    font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.2px; color: var(--ink-faint); display: block; margin-bottom: 3px;
  }
  .rpt-meta-item .rpt-meta-val {
    font-size: 13px; font-weight: 700; color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .rpt-section {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.6px; color: #fff; padding: 8px 14px;
    margin-top: 26px; margin-bottom: 0;
    background: linear-gradient(90deg, var(--ink) 0%, #1e293b 100%);
    border-radius: 6px 6px 0 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .rpt-section-alt { background: linear-gradient(90deg, #334155 0%, #475569 100%); }
  .rpt-stats {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 12px; margin-bottom: 22px;
  }
  .rpt-stat {
    border: 1px solid var(--rule); padding: 14px 16px;
    background: linear-gradient(180deg, #ffffff 0%, var(--paper-tint) 100%);
    border-radius: 8px; position: relative; overflow: hidden;
    box-shadow: 0 1px 0 rgba(15,23,42,0.04), 0 4px 8px -4px rgba(15,23,42,0.06);
  }
  .rpt-stat::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg, var(--ink), var(--accent), var(--ink));
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .rpt-stat-label {
    font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.2px; color: var(--ink-faint); margin-bottom: 6px;
  }
  .rpt-stat-val {
    font-size: 22px; font-weight: 800; color: var(--ink);
    font-variant-numeric: tabular-nums; letter-spacing: -0.4px; line-height: 1.05;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }
  .rpt-stat-sub { font-size: 10px; color: var(--ink-faint); margin-top: 3px; font-weight: 500; }
  .rpt-stat.positive .rpt-stat-val { color: var(--positive); }
  .rpt-stat.negative .rpt-stat-val { color: var(--negative); }
  .rpt-stat.warning .rpt-stat-val { color: var(--warning); }
  .rpt-total td {
    border-top: 2px solid var(--ink); border-bottom: none;
    background: var(--paper-tint); font-weight: 800; color: var(--ink);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .rpt-footer {
    display: flex; justify-content: space-between; margin-top: 32px;
    padding-top: 12px; border-top: 1px solid var(--rule);
    font-size: 9px; color: var(--ink-faint); font-weight: 500;
  }
  @media print { .rpt-page { padding: 0; } .no-break { page-break-inside: avoid; } }

  /* ── Legal document utilities (demand letters, affidavits, court packets) ── */
  .legal-page { font-family: Georgia, 'Times New Roman', 'Liberation Serif', serif; color: #111; font-size: 12pt; line-height: 1.65; }
  .legal-page p, .legal-page li { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.7; }
  .legal-letterhead { border-bottom: 3px double #000; padding-bottom: 14px; margin-bottom: 28px; text-align: center; }
  .legal-letterhead .lh-name { font-family: Georgia, 'Times New Roman', serif; font-size: 22pt; font-weight: 700; letter-spacing: 3px; color: #000; text-transform: uppercase; }
  .legal-letterhead .lh-rule { width: 60px; height: 2px; background: #000; margin: 8px auto; }
  .legal-letterhead .lh-meta { font-size: 10pt; color: #333; line-height: 1.5; font-family: Georgia, serif; font-style: italic; }
  .legal-date { text-align: right; font-size: 11pt; margin-bottom: 24px; font-family: Georgia, serif; }
  .legal-recipient { margin-left: 1in; margin-bottom: 24px; font-size: 11pt; line-height: 1.5; font-family: Georgia, serif; }
  .legal-subject { font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 18px 0; font-family: Georgia, serif; font-size: 11pt; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 8px 0; }
  .legal-body { text-align: justify; }
  .legal-body p { margin-bottom: 14px; text-indent: 0.4in; }
  .legal-body p.no-indent { text-indent: 0; }
  .legal-amount-table { width: 80%; margin: 18px auto; border-collapse: collapse; font-family: Georgia, serif; }
  .legal-amount-table td { border: 1px solid #000; padding: 8px 14px; font-size: 11pt; }
  .legal-amount-table td.amt { text-align: right; font-variant-numeric: tabular-nums; font-family: 'SF Mono', 'Menlo', Consolas, 'Courier New', monospace; }
  .legal-amount-table tr.total td { border-top: 2px solid #000; border-bottom: 3px double #000; font-weight: 700; background: #f4f4f0; }
  .legal-notice { border: 1.5px solid #000; padding: 14px 18px; margin: 22px 0; font-size: 10.5pt; line-height: 1.6; background: #fafaf6; font-family: Georgia, serif; }
  .legal-notice .ln-heading { font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; font-size: 10pt; }
  .legal-mini-miranda { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 10px 0; margin: 22px 0; font-size: 10.5pt; font-style: italic; text-align: center; font-family: Georgia, serif; }
  .legal-signature { margin-top: 48px; page-break-inside: avoid; }
  .legal-sig-line { border-bottom: 1px solid #000; width: 320px; margin-top: 56px; }
  .legal-sig-name { font-weight: 700; margin-top: 4px; font-family: Georgia, serif; font-size: 11pt; }
  .legal-sig-title { font-style: italic; color: #333; font-size: 10.5pt; font-family: Georgia, serif; }
  .legal-confidential-footer { border-top: 1px solid #000; margin-top: 36px; padding-top: 8px; font-size: 9pt; color: #444; text-align: center; font-style: italic; font-family: Georgia, serif; }
  .legal-caption { text-align: center; font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.7; margin-bottom: 24px; border-bottom: 3px double #000; padding-bottom: 16px; }
  .legal-caption .cap-state { font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .legal-caption .cap-title { font-weight: 700; text-transform: uppercase; letter-spacing: 3px; font-size: 14pt; margin-top: 12px; }
  .legal-numbered { counter-reset: legalpara; }
  .legal-numbered > p.lp { counter-increment: legalpara; padding-left: 36px; position: relative; text-indent: 0; margin-bottom: 14px; text-align: justify; }
  .legal-numbered > p.lp::before { content: counter(legalpara) "."; position: absolute; left: 0; top: 0; font-weight: 700; width: 28px; text-align: right; }
  .legal-jurat { border: 1.5px solid #000; padding: 18px 22px; margin-top: 36px; font-family: Georgia, serif; font-size: 11pt; line-height: 1.9; page-break-inside: avoid; }
  .legal-jurat .jurat-title { text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; font-size: 11pt; margin-bottom: 12px; border-bottom: 1px solid #000; padding-bottom: 6px; }
  .legal-jurat .jurat-blank { display: inline-block; border-bottom: 1px solid #000; min-width: 60px; padding: 0 4px; }
  .legal-jurat .seal-box { float: right; width: 130px; height: 130px; border: 2px dashed #555; margin-left: 16px; text-align: center; padding: 50px 6px; font-size: 9pt; color: #777; font-style: italic; }
  .legal-exhibit-cover { text-align: center; padding-top: 2.5in; font-family: Georgia, 'Times New Roman', serif; page-break-after: always; page-break-before: always; }
  .legal-exhibit-cover .ex-tab { display: inline-block; border: 3px solid #000; padding: 24px 48px; font-size: 60pt; font-weight: 700; letter-spacing: 8px; }
  .legal-exhibit-cover .ex-label { font-size: 16pt; text-transform: uppercase; letter-spacing: 4px; margin-top: 24px; }
  .legal-remit { border: 2px dashed #000; margin-top: 36px; padding: 18px 22px; font-family: Georgia, serif; font-size: 10.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; page-break-inside: avoid; }
  .legal-remit .remit-tear { text-align: center; font-size: 10pt; color: #555; letter-spacing: 4px; margin-bottom: 14px; }
  .legal-page p { orphans: 3; widows: 3; }
  .legal-page .legal-subject { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .legal-page .legal-amount-table tr.total td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .legal-jurat .seal-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .legal-bates-page { counter-reset: bates; }
  .legal-bates-mark::after { counter-increment: bates; content: "BAP-" counter(bates, decimal-leading-zero); }

  /* ── Customer-facing financial document utilities (modernized 2026-05-05) ── */
  .fd-font { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .fd-tnum { font-variant-numeric: tabular-nums; }
  .fd-mono { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
  .fd-letterhead {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 24px; margin-bottom: 24px; padding-bottom: 18px;
    border-bottom: 2px solid var(--ink);
    min-height: 76px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-letterhead-left { flex: 1 1 auto; min-width: 0; }
  .fd-letterhead-right { text-align: right; min-width: 220px; flex-shrink: 0; }
  /* Subtle accent bar above the letterhead (decorative) */
  .fd-letterhead-accent {
    height: 4px;
    background: linear-gradient(90deg, var(--ink) 0%, var(--accent) 60%, var(--ink) 100%);
    margin-bottom: 20px;
    border-radius: 2px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-co-name {
    font-size: 22px; font-weight: 800; color: var(--ink);
    letter-spacing: -0.4px; line-height: 1.1;
  }
  .fd-co-line { font-size: 10.5px; color: var(--ink-muted); line-height: 1.6; margin-top: 4px; }
  .fd-doc-type {
    font-size: 34px; font-weight: 900; color: var(--ink);
    letter-spacing: -0.6px; text-transform: uppercase; line-height: 0.95;
  }
  .fd-doc-num {
    font-size: 13px; color: var(--ink-muted); font-weight: 700;
    margin-top: 8px; font-variant-numeric: tabular-nums; letter-spacing: 0.5px;
  }
  .fd-doc-date {
    font-size: 10.5px; color: var(--ink-faint); margin-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .fd-meta-strip {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 32px;
    padding: 12px 16px; background: var(--paper-tint);
    border: 1px solid var(--rule); border-radius: 6px;
    margin-bottom: 22px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-meta-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 10.5px; gap: 12px; }
  .fd-meta-row .lbl {
    color: var(--ink-faint); font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.7px; font-size: 9px;
  }
  .fd-meta-row .val {
    color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums;
  }
  .fd-addr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .fd-addr-grid.single { grid-template-columns: 1fr; max-width: 55%; }
  .fd-addr-card {
    background: var(--paper-soft);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--accent);
    padding: 13px 16px;
    border-radius: 4px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-addr-card.from { border-left-color: var(--ink-faint); }
  .fd-addr-lbl {
    font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.4px; color: var(--ink-faint); margin-bottom: 6px;
  }
  .fd-addr-name { font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 4px; line-height: 1.2; }
  .fd-addr-detail { font-size: 10.5px; color: var(--ink-muted); line-height: 1.6; }
  .fd-row-chip {
    display: inline-block; font-size: 8px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.6px;
    color: var(--accent); background: var(--accent-soft);
    padding: 2px 6px; border-radius: 999px; margin-left: 6px; vertical-align: middle;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-status-badge {
    display: inline-block; font-size: 9px; font-weight: 800;
    text-transform: uppercase; letter-spacing: 1.2px;
    padding: 4px 10px; border-radius: 999px; border: 1.5px solid;
    vertical-align: middle; margin-left: 10px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Modern totals card — clearer hierarchy, hero "total" treatment */
  .fd-totals-card {
    float: right; min-width: 320px; max-width: 360px;
    padding: 0; background: var(--paper);
    border: 1px solid var(--rule-strong);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 0 rgba(15,23,42,0.04), 0 4px 8px -2px rgba(15,23,42,0.04);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-totals-card .totals-rows { padding: 14px 18px 6px; }
  .fd-totals-card .totals-row {
    display: flex; justify-content: space-between; gap: 12px;
    padding: 6px 0; font-size: 11.5px; color: var(--ink-muted);
  }
  .fd-totals-card .totals-row .val {
    font-variant-numeric: tabular-nums;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-weight: 600; color: var(--ink-soft);
  }
  .fd-totals-card .totals-row.subtle .val { color: var(--ink-faint); font-weight: 500; }
  .fd-totals-card .totals-divider {
    height: 1px; background: var(--rule); margin: 4px 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Hero TOTAL row — gradient accent strip background */
  .fd-totals-card .totals-grand {
    margin-top: 4px; padding: 16px 18px;
    background: linear-gradient(180deg, var(--ink) 0%, #1e293b 100%);
    color: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-totals-card .totals-grand .lbl {
    font-size: 10px; font-weight: 800;
    text-transform: uppercase; letter-spacing: 1.4px;
    color: rgba(255,255,255,0.7);
    margin-bottom: 4px;
  }
  .fd-totals-card .totals-grand .val {
    font-size: 24px; font-weight: 800;
    color: #fff; letter-spacing: -0.5px;
    font-variant-numeric: tabular-nums;
    font-family: 'Inter', sans-serif;
  }
  .fd-totals-card .totals-paid {
    padding: 10px 18px; background: var(--positive-soft);
    color: var(--positive); font-size: 11px; font-weight: 700;
    display: flex; justify-content: space-between;
    border-top: 1px solid var(--positive);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-totals-card .totals-balance-due {
    padding: 12px 18px; background: var(--negative-soft);
    color: var(--negative); font-size: 13px; font-weight: 800;
    display: flex; justify-content: space-between;
    border-top: 1px solid var(--negative);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .fd-quote-sig {
    margin-top: 36px; padding-top: 16px;
    border-top: 1px solid var(--rule-strong);
    display: grid; grid-template-columns: 1fr 1fr; gap: 36px;
  }
  .fd-sig-line { border-bottom: 1px solid var(--ink); height: 36px; }
  .fd-sig-lbl {
    font-size: 9px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 1px;
    color: var(--ink-faint); margin-top: 6px;
  }
  @media print {
    .fd-totals-card { background: #f8fafc !important; }
  }
  /* Print color-adjust applied per-element (avoids forcing whole-page bg) */
  .fd-accent-keep, .fd-totals-card, .status-stamp, .fd-status-badge {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Totals-card row label/value alignment */
  .fd-totals-card .fd-meta-row { display: flex; justify-content: space-between; gap: 12px; }
  .fd-totals-card .fd-meta-row .val { font-variant-numeric: tabular-nums; font-family: 'SF Mono', Menlo, Consolas, monospace; }
  .fd-empty-row td { text-align: center; color: #94a3b8; padding: 18px; font-style: italic; }
  /* Multiline address support */
  .fd-addr-detail .addr-line { display: block; }
`;

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
    <div class="rpt-badge" style="border-color: var(--ink); color: var(--ink); padding: 7px 16px; letter-spacing: 1.4px; font-size: 11px; background: linear-gradient(180deg, #fff, var(--paper-tint)); -webkit-print-color-adjust: exact; print-color-adjust: exact;">${esc(docTitle)}</div>
  </div>`;
}

function reportFooter(companyName: string): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `<div class="rpt-footer" style="border-top-color: var(--rule-strong); padding-top: 12px; margin-top: 32px; font-size: 9px;">
    <span style="font-weight: 600; color: var(--ink-muted);">${esc(companyName)}</span>
    <span style="color: var(--ink-faintest);">Generated ${date}</span>
  </div>`;
}

// ─── Status stamp helper ─────────────────────────────────────
function statusStampCSS(color: string): string {
  return `
  .status-stamp {
    position: absolute; top: 92px; right: 32px;
    font-size: 24px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 2.5px; color: ${color};
    border: 2px solid ${color}; border-radius: 4px;
    padding: 5px 14px; opacity: 0.18; transform: rotate(-10deg);
    pointer-events: none; background: rgba(255,255,255,0.6);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    z-index: 5;
  }
  `;
}

// ─── SVG donut chart helper (pure inline SVG, print-safe) ───
function svgDonut(
  segments: Array<{ value: number; color: string; label?: string }>,
  size = 80,
  centerLabel?: string,
  centerSub?: string,
): string {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return '';
  const r = size / 2;
  const inner = r * 0.62;
  const cx = r, cy = r;
  let cumulative = 0;
  const paths = segments.map(seg => {
    const v = Math.max(0, seg.value);
    if (v <= 0) return '';
    const startA = (cumulative / total) * Math.PI * 2 - Math.PI / 2;
    cumulative += v;
    const endA = (cumulative / total) * Math.PI * 2 - Math.PI / 2;
    const large = (endA - startA) > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startA), y1 = cy + r * Math.sin(startA);
    const x2 = cx + r * Math.cos(endA), y2 = cy + r * Math.sin(endA);
    const x3 = cx + inner * Math.cos(endA), y3 = cy + inner * Math.sin(endA);
    const x4 = cx + inner * Math.cos(startA), y4 = cy + inner * Math.sin(startA);
    return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z" fill="${seg.color}" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;" />`;
  }).join('');
  const center = centerLabel
    ? `<text x="${cx}" y="${cy - 1}" text-anchor="middle" dominant-baseline="central" font-size="${(size * 0.16).toFixed(1)}" font-weight="700" fill="#0f172a" font-family="Inter,sans-serif">${esc(centerLabel)}</text>${centerSub ? `<text x="${cx}" y="${cy + size * 0.16}" text-anchor="middle" font-size="${(size * 0.10).toFixed(1)}" fill="#64748b" font-family="Inter,sans-serif">${esc(centerSub)}</text>` : ''}`
    : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;">${paths}${center}</svg>`;
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

function getStatusStamp(status: string): { label: string; color: string } | null {
  switch (status) {
    case 'paid': return { label: 'PAID', color: '#16a34a' };
    case 'overdue': return { label: 'OVERDUE', color: '#dc2626' };
    case 'draft': return { label: 'DRAFT', color: '#475569' };
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
    <div style="font-size:8px;color:#64748b;max-width:80px;word-break:break-all;">${esc(url)}</div>
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

  const customFieldRows = [1, 2, 3, 4]
    .map(n => ({
      label: settings?.[`custom_field_${n}_label` as keyof InvoiceSettings] as string | undefined,
      value: (invoice as any)[`custom_field_${n}`] as string | undefined,
    }))
    .filter(f => f.label && f.value)
    .map(f => `<div><div class="meta-label">${esc(f.label!)}</div><div class="meta-value">${esc(f.value!)}</div></div>`)
    .join('');

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
  const totalTaxSum = sortedRates.reduce((s, r) => s + taxByRate[r].tax, 0);
  // Composition bar segments (CSS-grid widths) for visual tax-rate composition
  const taxRateColors = ['#0f766e', '#0891b2', '#7c3aed', '#db2777', '#ea580c'];
  const taxBreakdownBar = hasMultipleRates && totalTaxSum > 0
    ? `<div class="fd-tax-breakdown" style="display:flex;height:8px;width:100%;margin:6px 0 8px;border-radius:2px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;border:1px solid #e2e8f0;">
        ${sortedRates.map((r, i) => {
          const pct = (taxByRate[r].tax / totalTaxSum) * 100;
          return `<div title="${r}% = ${fmt(taxByRate[r].tax)}" style="width:${pct.toFixed(2)}%;background:${taxRateColors[i % taxRateColors.length]};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>`;
        }).join('')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:9px;color:#64748b;margin-bottom:6px;">
        ${sortedRates.map((r, i) => {
          const pct = (taxByRate[r].tax / totalTaxSum) * 100;
          return `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;background:${taxRateColors[i % taxRateColors.length]};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>${r}% &middot; ${fmt(taxByRate[r].tax)} (${pct.toFixed(0)}%)</span>`;
        }).join('')}
      </div>`
    : '';
  const taxBreakdownHTML = hasMultipleRates
    ? taxBreakdownBar + sortedRates.map(rate =>
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
    const right = ['quantity','unit_price','tax_rate','tax_amount','amount'].includes(c.key);
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
          ${esc(l.description || '')}
        </td>
      </tr>`;
    }

    if (rowType === 'note') {
      return `<tr>
        <td colspan="${colSpan}" style="font-style:italic;color:#64748b;font-size:${isCompact?'10px':'11px'};
          padding-left:24px;border-bottom:none;">
          ${esc(l.description || '')}
        </td>
      </tr>`;
    }

    if (rowType === 'image') {
      const caption = esc(l.unit_label || '');
      return `<tr>
        <td colspan="${colSpan}" style="text-align:center;padding:12px;border-bottom:none;">
          ${l.description ? `<img src="${esc(l.description)}" alt="${caption}" style="max-width:300px;max-height:180px;object-fit:contain;">` : ''}
          ${caption ? `<div style="font-size:10px;color:#64748b;margin-top:4px;">${caption}</div>` : ''}
        </td>
      </tr>`;
    }

    if (rowType === 'subtotal') {
      // MATH: in-table subtotal row sums per-line "Amount" column values, which
      // now include tax (matching the user's per-line tax-inclusive change).
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
      return `<tr style="border-top:1px solid #334155;">
        <td colspan="${colSpan - 1}" style="font-weight:700;font-size:${isCompact?'11px':'12px'};color:#0f172a;">
          ${esc(l.description || 'Subtotal')}
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
      const right = ['quantity','unit_price','tax_rate','tax_amount','amount'].includes(c.key);
      const cls = `${right ? 'text-right font-mono' : ''} ${c.key === 'amount' ? 'font-bold' : ''}`.trim();
      let val = '';
      switch (c.key) {
        case 'item_code':    val = l.item_code ? `<span style="font-size:9px;background:#f1f5f9;padding:1px 4px;border-radius:2px;color:#64748b;">${esc(l.item_code)}</span>` : ''; break;
        case 'description': {
          const desc = esc(l.description || '');
          const isService = String(l.row_type || 'item') === 'item' && (l.is_service || /service|consult|labor|hour/i.test(String(l.description || '')));
          const chip = isService ? `<span class="fd-row-chip">SVC</span>` : '';
          val = `${desc}${chip}`;
          break;
        }
        case 'quantity':     val = String(l.quantity ?? 1); break;
        case 'unit_label':   val = esc(l.unit_label || ''); break;
        case 'unit_price':   val = fmt(l.unit_price || 0); break;
        case 'tax_rate':     val = lineEffectiveTaxRate > 0 ? lineEffectiveTaxRate + '%' : '—'; break;
        case 'tax_amount':   val = lineEffectiveTaxRate > 0 ? fmt(lineTaxAmount) : '—'; break;
        case 'amount': {
          // MATH: show strikethrough whenever EITHER per-line discount field
          // reduced the base — so the visual matches taxByRate / totals box.
          if ((hasLineDiscount || hasPctDiscount) && discountedPrice < baseAmtRaw) {
            const dlbl = hasLineDiscount
              ? (l.line_discount_type === 'flat' ? `−${fmt(Number(l.line_discount))}` : `−${Number(l.line_discount)}%`)
              : `−${Number(l.discount_pct)}%`;
            val = `<span style="text-decoration:line-through;color:#94a3b8;font-weight:400;font-size:10px;display:block;line-height:1.1;">${fmt(baseAmtRaw)}</span><span style="color:#16a34a;display:block;line-height:1.2;">${fmt(lineAmountWithTax)}</span><span style="font-size:8px;color:#16a34a;font-weight:600;">${dlbl}</span>`;
          } else {
            val = fmt(lineAmountWithTax);
          }
          break;
        }
      }
      return `<td class="${cls}" style="${rowPad}">${val}</td>`;
    }).join('');

    const discountAccent = (hasLineDiscount || hasPctDiscount) && discountedPrice < baseAmtRaw
      ? 'box-shadow: inset 3px 0 0 #16a34a; -webkit-print-color-adjust:exact; print-color-adjust:exact;'
      : '';
    const mergedRowStyle = [rowBg, lineStyleAttr, discountAccent].filter(Boolean).join(';');
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

  // Only embed logo if it's a data: URI or https: URL — file:// paths fail in
  // Electron print-to-PDF renderers that load from data:text/html.
  const safeLogo = logoData && /^(data:|https?:)/.test(String(logoData)) ? logoData : null;
  const logoHTML = safeLogo
    ? `<img src="${esc(safeLogo)}" alt="${companyName}" style="max-height:56px;max-width:180px;width:auto;height:auto;object-fit:contain;display:block;margin-bottom:8px;">`
    : '';

  // ── Header layout variants ──
  const companyBlock = `
    ${logoHTML}
    <div class="company-name">${companyName}</div>
    <div class="company-detail">
      ${companyAddr ? companyAddr + '<br>' : ''}
      ${companyEmail}${companyPhone ? ' &middot; ' + companyPhone : ''}
    </div>`;

  const isCreditNote = invoice.invoice_type === 'credit_note';
  const isQuote = invoice.invoice_type === 'quote' || invoice.document_type === 'quote';
  const invoiceTypeLabel = isCreditNote ? 'Credit Note'
    : isQuote ? 'Quote'
    : invoice.invoice_type === 'proforma' ? 'Proforma Invoice'
    : invoice.invoice_type === 'retainer' ? 'Retainer Invoice'
    : invoice.invoice_type === 'service' ? 'Service Invoice'
    : invoice.invoice_type === 'product' ? 'Invoice'
    : 'Invoice';

  // Status badge near the doc number (only for sent/paid/overdue/void)
  const badgeMap: Record<string, { label: string; bg: string; fg: string }> = {
    paid:      { label: 'PAID',     bg: '#dcfce7', fg: '#166534' },
    overdue:   { label: 'OVERDUE',  bg: '#fee2e2', fg: '#991b1b' },
    cancelled: { label: 'VOID',     bg: '#fee2e2', fg: '#991b1b' },
    void:      { label: 'VOID',     bg: '#fee2e2', fg: '#991b1b' },
    sent:      { label: 'SENT',     bg: '#dbeafe', fg: '#1e40af' },
    accepted:  { label: 'ACCEPTED', bg: '#dcfce7', fg: '#166534' },
    declined:  { label: 'DECLINED', bg: '#fee2e2', fg: '#991b1b' },
  };
  const badge = badgeMap[String(invoice.status || '').toLowerCase()];
  const statusBadgeHTML = badge
    ? `<span class="fd-status-badge" style="background:${badge.bg};color:${badge.fg};">${badge.label}</span>`
    : '';
  const currencyLabel = invoice.currency && invoice.currency !== 'USD' ? ` (${invoice.currency})` : '';
  const shippingAmount = Number(invoice.shipping_amount || 0);

  const docNumberField = invoice.invoice_number || invoice.quote_number || invoice.document_number || '';
  const invBlock = `
    <div class="inv-title">${invoiceTypeLabel}${currencyLabel}</div>
    <div class="inv-number">#${esc(docNumberField)}${statusBadgeHTML}</div>
    ${isCreditNote && invoice.reference_invoice_number ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Re: Invoice #${esc(invoice.reference_invoice_number)}</div>` : ''}
    ${invoice.po_number ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">PO# ${esc(invoice.po_number)}</div>` : ''}
    ${invoice.job_reference ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Project: ${esc(invoice.job_reference)}</div>` : ''}
    ${isQuote && invoice.valid_until ? `<div style="font-size:11px;color:#0f172a;font-weight:600;margin-top:6px;border-top:2px solid ${accent};padding-top:4px;display:inline-block;">Valid until ${fmtDate(invoice.valid_until)}</div>` : ''}`;

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
        <div class="inv-number">#${esc(invoice.invoice_number || '')}</div>
        ${invoice.po_number ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">PO# ${esc(invoice.po_number)}</div>` : ''}
        ${invoice.job_reference ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Project: ${esc(invoice.job_reference)}</div>` : ''}
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
        <td>${esc(m.milestone_label || '')}</td>
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

  // ── Feature #2: payment status progress bar (only for partial payments) ──
  const paymentPct = total > 0 ? Math.min(100, Math.max(0, (amountPaid / total) * 100)) : 0;
  const paymentBarHTML = (amountPaid > 0 && balance > 0.005 && total > 0 && !isQuote && !isCreditNote)
    ? `<div class="fd-payment-progress" style="margin:0 0 14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;margin-bottom:3px;">
          <span>Payment Progress</span>
          <span style="color:#0f172a;">${paymentPct.toFixed(0)}% paid &middot; ${fmt(amountPaid)} of ${fmt(total)}</span>
        </div>
        <div style="display:flex;height:10px;width:100%;border:1px solid #e2e8f0;border-radius:2px;overflow:hidden;background:#f1f5f9;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <div style="width:${paymentPct.toFixed(2)}%;background:${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
          <div style="flex:1;background:#e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        </div>
        <div style="font-size:9px;color:#dc2626;font-weight:600;margin-top:3px;text-align:right;">Balance Due: ${fmt(balance)}</div>
      </div>`
    : '';

  // ── Feature #4: totals composition donut ──
  const subtotalNum = Number(invoice.subtotal || 0);
  // MATH: Only the flat discount_amount is actually deducted from total.
  // Header `discount_pct` is stored for reference but not subtracted, so
  // including it in the donut would mis-state the visualization.
  const discTotal = discountAmount;
  const totalsDonutHTML = (() => {
    const segs = [
      { value: subtotalNum, color: accent, label: 'Subtotal' },
      { value: taxAmount, color: '#0891b2', label: 'Tax' },
      { value: shippingAmount, color: '#7c3aed', label: 'Ship' },
      { value: discTotal, color: '#16a34a', label: 'Disc' },
    ];
    if (segs.reduce((s, x) => s + x.value, 0) <= 0) return '';
    return `<div style="display:flex;align-items:center;gap:10px;margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0;">
      ${svgDonut(segs, 72, '', '')}
      <div style="font-size:9px;color:#475569;line-height:1.5;">
        ${segs.filter(s => s.value > 0).map(s => `<div style="display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:8px;height:8px;background:${s.color};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>${esc(s.label)}: ${fmt(s.value)}</div>`).join('')}
      </div>
    </div>`;
  })();

  // ── Feature #16: client tenure indicator ──
  const tenureBadgeHTML = (() => {
    const since = (client?.created_at || client?.client_since || '').toString().slice(0, 4);
    const sinceYear = parseInt(since, 10);
    if (!sinceYear || sinceYear < 1990 || sinceYear > new Date().getFullYear()) return '';
    const years = Math.max(0, new Date().getFullYear() - sinceYear);
    const dotPct = Math.min(100, (years / 10) * 100);
    return `<div style="display:inline-flex;align-items:center;gap:6px;font-size:9px;color:#64748b;margin-top:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <span style="text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Client since ${sinceYear}</span>
      <span style="display:inline-block;width:48px;height:4px;background:#e2e8f0;position:relative;">
        <span style="position:absolute;left:${dotPct.toFixed(0)}%;top:-2px;width:8px;height:8px;border-radius:50%;background:${accent};margin-left:-4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>
      </span>
      <span>${years}y</span>
    </div>`;
  })();

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${esc(invoice.invoice_number || '')}</title><style>
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
/* Per-document footer: reserves space via @page running content
   so it never overlaps body content (replaces old position:fixed) */
@page {
  margin: 0.55in 0.5in 0.85in 0.5in;
  @bottom-left {
    content: "${companyName.replace(/"/g, '\\"')} · ${invoiceTypeLabel.replace(/"/g, '\\"')} #${(docNumberField || '').toString().replace(/"/g, '\\"')} · Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}";
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 8pt;
    color: #94a3b8;
    padding-bottom: 12pt;
  }
  @bottom-right {
    padding-bottom: 12pt;
  }
}
.totals { display: flex; justify-content: flex-end; margin-top: 14px; }
.totals-box {
  width: 320px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
  box-shadow: 0 1px 0 rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.06);
}
.totals-box > .totals-row,
.totals-box > [class^="totals-row"] { padding-left: 18px; padding-right: 18px; }
.totals-row {
  display: flex;
  justify-content: space-between;
  padding: 7px 0;
  font-size: 11.5px;
  color: #64748b;
  font-weight: 500;
  letter-spacing: 0.1px;
}
.totals-row > span:first-child { text-transform: none; }
.totals-row > span:last-child {
  font-variant-numeric: tabular-nums;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  color: #1e293b;
  font-weight: 600;
}
.totals-row:first-child { padding-top: 14px; }
.totals-total {
  background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
  color: #ffffff !important;
  padding: 14px 18px !important;
  margin-top: 6px;
  border-top: none;
  font-weight: 800;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.4px;
}
.totals-total > span:first-child {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1.4px;
  color: rgba(255,255,255,0.72);
  align-self: center;
}
.totals-total > span:last-child {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: #ffffff !important;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.totals-paid {
  background: rgba(22,163,74,0.06);
  color: #16a34a !important;
  padding: 10px 18px !important;
  border-top: 1px solid rgba(22,163,74,0.18);
  font-size: 11px;
  font-weight: 600;
}
.totals-paid > span:last-child { color: #16a34a !important; }
.totals-balance {
  background: ${balance > 0.005 ? 'rgba(220,38,38,0.06)' : 'rgba(22,163,74,0.06)'};
  color: ${balance > 0.005 ? '#dc2626' : '#16a34a'} !important;
  padding: 12px 18px !important;
  border-top: 1px solid ${balance > 0.005 ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.2)'};
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.2px;
}
.totals-balance > span:last-child {
  color: ${balance > 0.005 ? '#dc2626' : '#16a34a'} !important;
  font-size: 14px;
  font-weight: 800;
}
.footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e2e8f0; }
.footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.footer-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.8px; margin-bottom: 4px; }
.footer-text { font-size: 11px; color: #64748b; line-height: 1.6; white-space: pre-line; }
.footer-bottom { text-align: center; margin-top: 28px; font-size: 10px; color: #64748b; }
.accent-bar { height: 4px; background: ${accent}; margin-bottom: 0; }
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
${wmText ? `<div class="watermark">${esc(wmText)}</div>` : invoice.invoice_type === 'proforma' ? '<div class="watermark">PROFORMA</div>' : ''}
${invoice.status === 'draft' && !wmText ? '<div class="draft-watermark">DRAFT</div>' : ''}
${style === 'modern' ? `<div class="accent-bar"></div>` : ''}
${stamp ? `<div class="status-stamp">${stamp.label}</div>` : ''}
<div class="page">
<div class="content">
  ${headerHTML}

  ${(() => {
    const shipName = esc(invoice.ship_to_name || '');
    const shipAddr = esc([invoice.ship_to_address_line1, invoice.ship_to_address_line2, invoice.ship_to_city, invoice.ship_to_state, invoice.ship_to_zip].filter(Boolean).join(', '));
    const hasShip = !!(shipName || shipAddr);
    const billCard = `
      <div class="fd-addr-card">
        <div class="fd-addr-lbl">${isQuote ? 'Quote For' : 'Bill To'}</div>
        <div class="fd-addr-name">${clientName}</div>
        <div class="fd-addr-detail">
          ${clientAddr ? clientAddr + '<br>' : ''}
          ${clientEmail ? clientEmail + (clientPhone ? ' &middot; ' + clientPhone : '') : (clientPhone || '')}
        </div>
        ${tenureBadgeHTML}
      </div>`;
    const shipCard = hasShip ? `
      <div class="fd-addr-card">
        <div class="fd-addr-lbl">Ship To</div>
        <div class="fd-addr-name">${shipName || clientName}</div>
        <div class="fd-addr-detail">${shipAddr || ''}</div>
      </div>` : '';
    return `<div class="fd-addr-grid${hasShip ? '' : ' single'}">${billCard}${shipCard}</div>`;
  })()}

  ${paymentBarHTML}

  <div class="fd-meta-strip">
    <div class="fd-meta-row"><span class="lbl">${isQuote ? 'Quote Date' : isCreditNote ? 'Credit Date' : 'Issue Date'}</span><span class="val">${fmtDate(invoice.issue_date)}</span></div>
    ${isQuote
      ? `<div class="fd-meta-row"><span class="lbl">Valid Until</span><span class="val">${fmtDate(invoice.valid_until || '')}</span></div>`
      : `<div class="fd-meta-row"><span class="lbl">${isCreditNote ? 'Ref Invoice' : 'Due Date'}</span><span class="val">${isCreditNote ? esc(invoice.reference_invoice_number || '—') : fmtDate(invoice.due_date)}</span></div>`}
    ${invoice.po_number ? `<div class="fd-meta-row"><span class="lbl">PO Number</span><span class="val">${esc(invoice.po_number)}</span></div>` : ''}
    ${invoice.job_reference ? `<div class="fd-meta-row"><span class="lbl">Project</span><span class="val">${esc(invoice.job_reference)}</span></div>` : ''}
    <div class="fd-meta-row"><span class="lbl">Currency</span><span class="val">${esc(invoice.currency || 'USD')}</span></div>
    <div class="fd-meta-row"><span class="lbl">Terms</span><span class="val">${esc(invoice.terms || (isQuote ? 'Quote' : 'Net 30'))}</span></div>
  </div>

  <table>
    <thead><tr>${colHeaders}</tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="totals-row"><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></div>
      ${taxBreakdownHTML}
      ${discountAmount > 0 ? `<div class="totals-row" style="color:#16a34a"><span>Discount</span><span>\u2212${fmt(discountAmount)}</span></div>` : ''}
      ${shippingAmount > 0 ? `<div class="totals-row"><span>Shipping</span><span>${fmt(shippingAmount)}</span></div>` : ''}
      <div class="totals-row totals-total">
        <span>${invoice.invoice_type === 'credit_note' ? 'Credit Amount' : 'Total'}</span>
        <span style="${invoice.invoice_type === 'credit_note' ? 'color:#16a34a' : ''}">${invoice.invoice_type === 'credit_note' ? `(${fmt(Math.abs(total))}) CR` : fmt(total)}</span>
      </div>
      ${amountPaid > 0 && invoice.invoice_type !== 'credit_note' ? `
        <div class="totals-row totals-paid"><span>Amount Paid</span><span>${fmt(amountPaid)}</span></div>
        <div class="totals-row totals-balance"><span>Balance Due</span><span>${fmt(Math.max(0, balance))}</span></div>
      ` : ''}
      ${totalsDonutHTML}
    </div>
  </div>

  ${scheduleHTML}
  ${qrSection}

  ${(invoice.notes || invoice.terms_text) ? `
  <div class="footer">
    <div class="footer-grid">
      ${invoice.notes ? `<div><div class="footer-label">Notes</div><div class="footer-text">${esc(invoice.notes)}</div></div>` : ''}
      ${invoice.terms_text ? `<div><div class="footer-label">Terms &amp; Conditions</div><div class="footer-text">${esc(invoice.terms_text)}</div></div>` : ''}
    </div>
  </div>` : ''}

  ${isQuote ? `
  <div class="fd-quote-sig">
    <div>
      <div class="fd-sig-line"></div>
      <div class="fd-sig-lbl">Authorized Signature &middot; ${companyName}</div>
    </div>
    <div>
      <div class="fd-sig-line"></div>
      <div class="fd-sig-lbl">Accepted by ${clientName} &middot; Date</div>
    </div>
  </div>
  <div style="font-size:10px;color:#64748b;font-style:italic;margin-top:10px;line-height:1.5;">
    By signing above, the customer accepts the goods and services described in this quote at the prices stated, subject to the terms above. This quote is valid${invoice.valid_until ? ` until ${fmtDate(invoice.valid_until)}` : ''}.
  </div>` : ''}

  ${isCreditNote ? `
  <div style="font-size:10px;color:#64748b;font-style:italic;margin-top:14px;line-height:1.5;">
    Amounts shown are credits to the customer's account. Negative values or "(CR)" indicate funds owed to the customer${invoice.reference_invoice_number ? ` against Invoice #${esc(invoice.reference_invoice_number)}` : ''}.
  </div>` : ''}

  <div class="footer-bottom">
    ${esc(footerText) || companyName}
    ${invoice.late_fee_pct && invoice.late_fee_pct > 0 && !isQuote && !isCreditNote ? `<p style="font-size:10px;color:#64748b;margin-top:8px;">A late fee of ${invoice.late_fee_pct}% per month applies after ${invoice.late_fee_grace_days || 0} days.</p>` : ''}
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
  const companyName = esc(company?.name || 'Company');
  const companyLegal = esc(company?.legal_name || '');
  const companyAddr = esc([company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip]
    .filter(Boolean).join(', '));
  const companyPhone = esc(company?.phone || '');
  const companyEmail = esc(company?.email || '');

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
  const department = esc(stub.department || '');
  const jobTitle = esc(stub.job_title || '');
  const payType = stub.pay_type === 'salary' ? 'Salary' : stub.pay_type === 'hourly' ? 'Hourly' : '';
  const payRate = stub.pay_rate ?? 0;
  const payScheduleLabels: Record<string, string> = { weekly: 'Weekly', biweekly: 'Bi-Weekly', semimonthly: 'Semi-Monthly', monthly: 'Monthly' };
  const payScheduleLabel = payScheduleLabels[stub.pay_schedule || ''] || '';
  const filingStatusLabels: Record<string, string> = { single: 'Single', married: 'Married Filing Jointly', head_of_household: 'Head of Household', married_joint: 'Married Filing Jointly', married_separate: 'Married Filing Separately', head_household: 'Head of Household' };
  const filingLabel = filingStatusLabels[stub.filing_status || ''] || esc(stub.filing_status || '');
  const hireDate = esc(stub.hire_date || '');
  const empType = esc(stub.employment_type || '');
  const runTypeLabels: Record<string, string> = { regular: 'Regular', bonus: 'Bonus', correction: 'Correction', 'off-cycle': 'Off-Cycle' };
  const runTypeLabel = runTypeLabels[stub.run_type || 'regular'] || 'Regular';
  const periodsPerYr = stub.pay_periods_per_year ?? 26;
  const employerEIN = esc(stub.employer_ein || '');
  const stateName = esc(stub.state_name || 'Utah');

  // Parse deduction detail JSON
  let deductionItems: [string, number][] = [];
  if (stub.deduction_detail && stub.deduction_detail !== '{}') {
    try {
      const detail = JSON.parse(stub.deduction_detail);
      deductionItems = Object.entries(detail).map(([k, v]) => [k, Number(v)]);
    } catch { /* ignore */ }
  }

  // ── PRIVACY: enforce last-4-only rendering for SSN and bank account ──
  // Even if a caller mistakenly hands us a full SSN or full account number,
  // we strip everything except the trailing 4 digits before rendering.
  const last4 = (raw: string | undefined | null): string => {
    if (!raw) return '';
    const digits = String(raw).replace(/\D/g, '');
    return digits.slice(-4);
  };
  const ssnLast4 = last4(stub.ssn_last4 || stub.ssn);
  const ssnDisplay = ssnLast4 ? `XXX-XX-${ssnLast4}` : '';
  const bankAcctLast4 = last4(stub.bank_account_last4 || stub.account_number);
  const bankAcctDisplay = bankAcctLast4 ? `••••${bankAcctLast4}` : '';
  const employeeAddress = esc(stub.employee_address || '');
  const employeeIdShort = esc(stub.employee_id_short || '');

  // ── Employer contributions (informational, NOT deducted from pay) ──
  const empSS = stub.employer_social_security ?? 0;
  const empMed = stub.employer_medicare ?? 0;
  const empFuta = stub.employer_futa ?? 0;
  const empSuta = stub.employer_suta ?? 0;
  const empMatch = stub.employer_retirement_match ?? 0;
  const empHealth = stub.employer_health_contribution ?? 0;
  const employerTotal = empSS + empMed + empFuta + empSuta + empMatch + empHealth;
  const hasEmployerContribs = employerTotal > 0;

  // ── Feature #6: deductions donut (gross → taxes / pre-tax / post-tax / net) ──
  const psAccent = '#16a34a';
  const deductionsDonutHTML = stub.gross_pay > 0 ? (() => {
    const segs = [
      { value: taxDed, color: '#dc2626', label: 'Taxes' },
      { value: preTax, color: '#7c3aed', label: 'Pre-Tax' },
      { value: postTax, color: '#0891b2', label: 'Post-Tax' },
      { value: stub.net_pay, color: psAccent, label: 'Net' },
    ];
    if (segs.reduce((s, x) => s + x.value, 0) <= 0) return '';
    const netPctOfGross = stub.gross_pay > 0 ? (stub.net_pay / stub.gross_pay) * 100 : 0;
    return `<div style="display:flex;align-items:center;gap:14px;margin:14px 0;padding:10px 14px;border:1px solid #e2e8f0;background:#f8fafc;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;">
      ${svgDonut(segs, 96, `${netPctOfGross.toFixed(0)}%`, 'Net')}
      <div style="flex:1;font-size:10px;color:#475569;line-height:1.6;">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#0f172a;margin-bottom:4px;">Gross → Net Breakdown</div>
        ${segs.filter(s => s.value > 0).map(s => `<div style="display:flex;justify-content:space-between;gap:12px;"><span><span style="display:inline-block;width:8px;height:8px;background:${s.color};margin-right:5px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>${esc(s.label)}</span><span style="font-variant-numeric:tabular-nums;">${fmt(s.value)} (${(s.value / stub.gross_pay * 100).toFixed(1)}%)</span></div>`).join('')}
      </div>
    </div>`;
  })() : '';

  // ── Feature #15: rate-of-pay visual (regular vs OT) ──
  const ratePayHTML = (!isSalaried && hoursOvertime > 0 && (regularPay + overtimePay) > 0) ? (() => {
    const total = regularPay + overtimePay;
    const regPct = (regularPay / total) * 100;
    const otPct = (overtimePay / total) * 100;
    return `<div style="margin:8px 0 14px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="display:flex;justify-content:space-between;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;margin-bottom:4px;">
        <span>Earnings Composition</span>
        <span style="color:#0f172a;">${fmt(total)}</span>
      </div>
      <div style="display:flex;height:10px;border:1px solid #cbd5e1;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <div title="Regular" style="width:${regPct.toFixed(2)}%;background:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        <div title="Overtime" style="width:${otPct.toFixed(2)}%;background:#d97706;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#475569;margin-top:4px;font-variant-numeric:tabular-nums;">
        <span><span style="display:inline-block;width:8px;height:8px;background:#0f172a;margin-right:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>Regular ${hoursRegular.toFixed(2)}h × ${fmt(effectiveRate)} = ${fmt(regularPay)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:#d97706;margin-right:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>OT ${hoursOvertime.toFixed(2)}h × ${fmt(effectiveRate * 1.5)} = ${fmt(overtimePay)}</span>
      </div>
    </div>`;
  })() : '';

  // ── Feature #18: net-of-gross horizontal indicator ──
  const netOfGrossPct = stub.gross_pay > 0 ? (stub.net_pay / stub.gross_pay) * 100 : 0;
  const netOfGrossHTML = stub.gross_pay > 0 ? `
    <div style="margin-top:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="display:flex;justify-content:space-between;font-size:8px;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;font-weight:700;margin-bottom:3px;">
        <span>Net of Gross</span><span>${netOfGrossPct.toFixed(0)}%</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,0.3);border-radius:3px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <div style="width:${netOfGrossPct.toFixed(2)}%;height:100%;background:${psAccent};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
      </div>
    </div>` : '';

  // ── Feature #7: YTD vs annualized projection bars ──
  // Use period_end fraction of year as projection denominator.
  // period_end may arrive as ISO ("2026-04-15") OR pre-formatted ("Apr 15, 2026")
  // because callers sometimes hand display-ready dates. Try both safely so the
  // year-fraction projection doesn't go to NaN.
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
  const ytdBar = (ytdVal: number, annualized: number, color: string) => {
    if (annualized <= 0) return '';
    const pct = Math.min(100, (ytdVal / annualized) * 100);
    return `<div style="height:4px;background:#e2e8f0;width:60px;display:inline-block;vertical-align:middle;margin-left:6px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><div style="height:100%;width:${pct.toFixed(1)}%;background:${color};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div></div>`;
  };
  const ytdProgressHTML = ytd.gross_pay > 0 ? (() => {
    const annualGross = ytd.gross_pay / yearFrac;
    const annualNet = ytd.net_pay / yearFrac;
    const annualTax = ytdTotalDed / yearFrac;
    return `<div style="margin:6px 0 14px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:9px;color:#475569;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#0f172a;margin-bottom:6px;">YTD Progress · Annualized Projection (${(yearFrac * 100).toFixed(0)}% of year elapsed)</div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;"><span>Gross</span><span style="font-variant-numeric:tabular-nums;">${fmt(ytd.gross_pay)} of ~${fmt(annualGross)}${ytdBar(ytd.gross_pay, annualGross, '#0f172a')}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;"><span>Taxes</span><span style="font-variant-numeric:tabular-nums;">${fmt(ytdTotalDed)} of ~${fmt(annualTax)}${ytdBar(ytdTotalDed, annualTax, '#dc2626')}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;"><span>Net</span><span style="font-variant-numeric:tabular-nums;">${fmt(ytd.net_pay)} of ~${fmt(annualNet)}${ytdBar(ytd.net_pay, annualNet, psAccent)}</span></div>
    </div>`;
  })() : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter; margin: 0.4in 0.5in; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: #1e293b;
    font-size: 12px;
    line-height: 1.5;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    padding: 0;
  }
  .page { max-width: 680px; margin: 0 auto; padding: 36px 40px; }

  /* ── Header (modernized 2026-05-05) ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 22px;
    border-bottom: 3px solid #0f172a;
    margin-bottom: 24px;
    position: relative;
  }
  .header::before {
    content: ''; position: absolute; top: -4px; left: 0; right: 0; height: 4px;
    background: linear-gradient(90deg, #0f172a 0%, ${psAccent} 50%, #0f172a 100%);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .co-name { font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.4px; }
  .co-legal { font-size: 10px; color: #94a3b8; margin-top: 2px; font-weight: 500; }
  .co-detail { font-size: 10.5px; color: #64748b; margin-top: 7px; line-height: 1.6; }
  .doc-label {
    font-size: 12px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.6px; color: #0f172a;
    padding: 8px 18px;
    border: 2px solid #0f172a;
    border-radius: 6px;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* ── Employee Info Grid (modernized) ── */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 0;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    margin-bottom: 24px;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 1px 0 rgba(15,23,42,0.04), 0 4px 8px -4px rgba(15,23,42,0.05);
  }
  .info-cell {
    padding: 11px 14px;
    border-right: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
  }
  .info-cell:nth-child(4n) { border-right: none; }
  .info-cell:nth-last-child(-n+4) { border-bottom: none; }
  .info-label {
    font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.1px; color: #94a3b8; margin-bottom: 3px;
  }
  .info-value { font-size: 12.5px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; }
  .info-value.emp-name { font-size: 14px; font-weight: 800; letter-spacing: -0.2px; }

  /* ── Section Headers (modernized) ── */
  .section {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.6px; color: #fff;
    padding: 8px 14px; margin-top: 22px; margin-bottom: 0;
    border-radius: 6px 6px 0 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .section-earn    { background: linear-gradient(90deg, #0f172a 0%, #1e293b 100%); }
  .section-ded     { background: linear-gradient(90deg, #7f1d1d 0%, #991b1b 100%); }
  .section-summary { background: linear-gradient(90deg, #14532d 0%, #166534 100%); }
  .section-employer{ background: linear-gradient(90deg, #475569 0%, #64748b 100%); }
  .section-deposit { background: linear-gradient(90deg, #1e3a8a 0%, #2563eb 100%); }

  /* ── Employee identity block ── */
  .id-block {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 0;
    border: 1px solid #cbd5e1;
    margin-bottom: 16px;
  }
  .id-cell {
    padding: 12px 14px;
    border-right: 1px solid #e2e8f0;
  }
  .id-cell:last-child { border-right: none; }
  .id-cell .info-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 4px; }
  .id-name { font-size: 14px; font-weight: 800; color: #0f172a; }
  .id-meta-row { font-size: 10px; color: #475569; margin-top: 2px; }
  .id-period-row { display: flex; justify-content: space-between; font-size: 10px; margin-top: 6px; }
  .id-period-row .id-pl { color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; font-size: 8px; font-weight: 700; }
  .id-period-row .id-pv { font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums; }

  /* ── Employer contributions ── */
  .employer-note {
    font-size: 8px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: #64748b;
    background: #f1f5f9; padding: 4px 12px;
    border-bottom: 1px solid #e2e8f0;
  }
  .employer-table td { font-size: 10px; color: #475569; }
  .employer-table .total-row td { background: #f1f5f9; }

  /* ── Direct deposit block ── */
  .deposit-block {
    margin-top: 6px;
    padding: 10px 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
  }
  .deposit-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; }
  .deposit-val { font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums; }

  /* ── Confidential footer ── */
  .confidential {
    margin-top: 16px; padding: 8px 12px;
    border: 1px dashed #cbd5e1; background: #fafaf9;
    text-align: center; font-size: 9px;
    color: #64748b; letter-spacing: 0.6px;
    text-transform: uppercase; font-weight: 600;
  }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; }
  th {
    padding: 6px 12px; text-align: left;
    font-size: 8px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; color: #64748b;
    border-bottom: 1px solid #cbd5e1;
    background: #f8fafc;
  }
  td {
    padding: 6px 12px; font-size: 11px; color: #334155;
    border-bottom: 1px solid #e2e8f0;
  }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-variant-numeric: tabular-nums; }
  .b { font-weight: 700; }
  .red { color: #dc2626; }
  .green { color: #16a34a; }
  .muted { color: #94a3b8; }
  .dark { color: #0f172a; }
  .total-row td { border-top: 2px solid #0f172a; border-bottom: none; background: #f8fafc; }
  .sub-row td { font-size: 10px; color: #64748b; padding-top: 4px; padding-bottom: 4px; border-bottom: 1px dashed #e2e8f0; }

  /* ── Net Pay Box (hero, modernized) ── */
  .net-box {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 26px;
    padding: 22px 26px;
    background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #f0fdf4 100%);
    border: 2px solid #86efac;
    border-radius: 10px;
    page-break-inside: avoid;
    break-inside: avoid;
    position: relative;
    overflow: hidden;
    box-shadow: 0 2px 0 rgba(22,163,74,0.06), 0 8px 16px -6px rgba(22,163,74,0.16);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .net-box::before {
    content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: 5px;
    background: linear-gradient(180deg, #16a34a 0%, #15803d 100%);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .net-current { padding-left: 8px; }
  .net-label {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.4px; color: #16a34a;
  }
  .net-amount {
    font-size: 36px; font-weight: 800; color: #15803d;
    font-variant-numeric: tabular-nums; margin-top: 4px;
    letter-spacing: -0.7px;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    line-height: 1.05;
  }
  .net-ytd-label {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.4px; color: #64748b; text-align: right;
  }
  .net-ytd-amount {
    font-size: 18px; font-weight: 800; color: #334155;
    text-align: right; margin-top: 4px;
    font-variant-numeric: tabular-nums;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: -0.3px;
  }

  /* ── Waterfall Summary ── */
  .waterfall { margin-top: 20px; }
  .wf-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 14px;
    font-size: 11px;
    border-bottom: 1px solid #f1f5f9;
  }
  .wf-row.wf-total {
    border-top: 2px solid #0f172a;
    border-bottom: none;
    font-weight: 800;
    font-size: 13px;
    padding-top: 8px;
    margin-top: 4px;
    color: #0f172a;
  }
  .wf-label { color: #475569; }
  .wf-value { font-variant-numeric: tabular-nums; font-family: 'SF Mono', Menlo, monospace; }

  /* ── Footer ── */
  .footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #94a3b8;
  }

  /* ── Print ── */
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 0; }
    .no-break { page-break-inside: avoid; }
  }
</style></head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="co-name">${companyName}</div>
      ${companyLegal ? `<div class="co-legal">${companyLegal}</div>` : ''}
      <div class="co-detail">
        ${companyAddr ? companyAddr + '<br>' : ''}
        ${companyPhone ? companyPhone : ''}${companyEmail ? (companyPhone ? ' &middot; ' : '') + companyEmail : ''}
      </div>
    </div>
    <div class="doc-label">Earnings Statement</div>
  </div>

  <!-- Employee Identity & Period block -->
  ${(employeeAddress || ssnDisplay || employeeIdShort) ? `
  <div class="id-block">
    <div class="id-cell">
      <div class="info-label">Employee</div>
      <div class="id-name">${esc(stub.employee_name)}</div>
      ${employeeIdShort ? `<div class="id-meta-row">Employee ID: <span class="b dark">${employeeIdShort}</span></div>` : ''}
      ${employeeAddress ? `<div class="id-meta-row">${employeeAddress}</div>` : ''}
      ${ssnDisplay ? `<div class="id-meta-row">SSN: <span class="mono b dark">${ssnDisplay}</span> <span class="muted" style="font-size:8px;">(last 4 only)</span></div>` : ''}
    </div>
    <div class="id-cell">
      <div class="info-label">Pay Period</div>
      <div class="id-period-row"><span class="id-pl">Start</span><span class="id-pv">${esc(stub.period_start)}</span></div>
      <div class="id-period-row"><span class="id-pl">End</span><span class="id-pv">${esc(stub.period_end)}</span></div>
      <div class="id-period-row"><span class="id-pl">Pay Date</span><span class="id-pv">${esc(stub.pay_date)}</span></div>
      ${stub.check_number ? `<div class="id-period-row"><span class="id-pl">Check #</span><span class="id-pv">${esc(stub.check_number)}</span></div>` : ''}
    </div>
  </div>
  ` : ''}

  <!-- Employee Info Grid (expanded) -->
  <div class="info-grid">
    <div class="info-cell" style="grid-column: span 2;">
      <div class="info-label">Employee Name</div>
      <div class="info-value emp-name">${esc(stub.employee_name)}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Employee ID</div>
      <div class="info-value">${employeeIdShort || '--'}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">SSN</div>
      <div class="info-value mono">${ssnDisplay || 'XXX-XX-XXXX'}</div>
    </div>

    <div class="info-cell">
      <div class="info-label">Department</div>
      <div class="info-value">${department || '--'}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Job Title</div>
      <div class="info-value">${jobTitle || '--'}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Hire Date</div>
      <div class="info-value">${hireDate || '--'}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Employment</div>
      <div class="info-value">${empType || '--'}</div>
    </div>

    <div class="info-cell">
      <div class="info-label">Pay Date</div>
      <div class="info-value">${esc(stub.pay_date)}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Period</div>
      <div class="info-value">${esc(stub.period_start)} &ndash; ${esc(stub.period_end)}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Check #</div>
      <div class="info-value mono">${esc(stub.check_number || '--')}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Run Type</div>
      <div class="info-value">${runTypeLabel}</div>
    </div>

    <div class="info-cell">
      <div class="info-label">Pay Type / Rate</div>
      <div class="info-value">${payType}${payRate > 0 ? ' &mdash; ' + (payType === 'Salary' ? fmt(payRate) + '/yr' : fmt(payRate) + '/hr') : ''}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Schedule</div>
      <div class="info-value">${payScheduleLabel || '--'}${periodsPerYr ? ' (' + periodsPerYr + '/yr)' : ''}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Hours (Reg / OT)</div>
      <div class="info-value">${isSalaried ? 'Salaried' : hoursRegular.toFixed(2) + ' / ' + hoursOvertime.toFixed(2)}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Total Hours</div>
      <div class="info-value">${isSalaried ? 'N/A' : totalHours.toFixed(2)}</div>
    </div>

    <div class="info-cell">
      <div class="info-label">Filing Status (W-4)</div>
      <div class="info-value">${filingLabel || '--'}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Fed Allowances</div>
      <div class="info-value">${stub.federal_allowances != null ? String(stub.federal_allowances) : '--'}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">State (${stateName})</div>
      <div class="info-value">${stub.state_allowances != null ? stub.state_allowances + ' exempt.' : '--'}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">W-4 Extra W/H</div>
      <div class="info-value">${stub.w4_step4c_extra ? fmt(stub.w4_step4c_extra) : '--'}</div>
    </div>
  </div>

  ${employerEIN ? `
  <div style="display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;padding:4px 14px;margin-bottom:8px;">
    <span>Employer EIN: <span class="mono dark" style="font-weight:600;">${employerEIN}</span></span>
    <span>${companyAddr}</span>
  </div>
  ` : ''}

  ${ratePayHTML}

  <!-- Earnings Section -->
  <div class="section section-earn">Earnings</div>
  <table>
    <thead><tr>
      <th style="width:40%">Description</th>
      <th class="r" style="width:12%">Hours</th>
      <th class="r" style="width:12%">Rate</th>
      <th class="r" style="width:18%">Current</th>
      <th class="r" style="width:18%">YTD</th>
    </tr></thead>
    <tbody>
      ${isSalaried ? `
      <tr>
        <td class="dark">Salary</td>
        <td class="r mono muted">--</td>
        <td class="r mono muted">--</td>
        <td class="r mono b dark">${fmt(stub.gross_pay)}</td>
        <td class="r mono muted">${fmt(ytd.gross_pay)}</td>
      </tr>
      ` : `
      <tr>
        <td class="dark">Regular</td>
        <td class="r mono">${hoursRegular.toFixed(2)}</td>
        <td class="r mono">${fmt(effectiveRate)}</td>
        <td class="r mono b dark">${fmt(regularPay)}</td>
        <td class="r mono muted">--</td>
      </tr>
      ${hoursOvertime > 0 ? `
      <tr>
        <td class="dark">Overtime (1.5x)</td>
        <td class="r mono">${hoursOvertime.toFixed(2)}</td>
        <td class="r mono">${fmt(effectiveRate * 1.5)}</td>
        <td class="r mono b dark">${fmt(overtimePay)}</td>
        <td class="r mono muted">--</td>
      </tr>
      ` : ''}
      `}
      <tr class="total-row">
        <td class="b dark">Gross Pay</td>
        <td class="r mono b">${isSalaried ? '' : totalHours.toFixed(2)}</td>
        <td></td>
        <td class="r mono b dark" style="font-size:13px;">${fmt(stub.gross_pay)}</td>
        <td class="r mono b muted">${fmt(ytd.gross_pay)}</td>
      </tr>
      ${preTax > 0 ? `
      <tr>
        <td style="color:#7c3aed;padding-left:16px;">Less: Pre-Tax Deductions</td>
        <td></td>
        <td></td>
        <td class="r mono" style="color:#7c3aed;">-${fmt(preTax)}</td>
        <td class="r mono muted">--</td>
      </tr>
      <tr class="total-row">
        <td class="b dark">Taxable Wages (Subject to Tax)</td>
        <td></td>
        <td></td>
        <td class="r mono b dark" style="font-size:13px;">${fmt(stub.gross_pay - preTax)}</td>
        <td class="r mono b muted">${fmt(ytd.gross_pay)}</td>
      </tr>
      ` : ''}
    </tbody>
  </table>

  <!-- Statutory Taxes Section -->
  <div class="section section-ded">Statutory Tax Withholdings</div>
  <table>
    <thead><tr>
      <th style="width:36%">Tax</th>
      <th class="r" style="width:11%">Rate</th>
      <th class="r" style="width:18%">Current</th>
      <th class="r" style="width:18%">YTD</th>
      <th class="r" style="width:17%">Taxable Wages</th>
    </tr></thead>
    <tbody>
      <tr>
        <td>Federal Income Tax</td>
        <td class="r mono muted">${stub.gross_pay > 0 ? (stub.federal_tax / stub.gross_pay * 100).toFixed(2) + '%' : '--'}</td>
        <td class="r mono red">${fmt(stub.federal_tax)}</td>
        <td class="r mono muted">${fmt(ytd.federal_tax)}</td>
        <td class="r mono muted">${fmt(stub.gross_pay - preTax)}</td>
      </tr>
      <tr>
        <td>State Income Tax (UT)</td>
        <td class="r mono muted">${stub.gross_pay > 0 ? (stub.state_tax / stub.gross_pay * 100).toFixed(2) + '%' : '--'}</td>
        <td class="r mono red">${fmt(stub.state_tax)}</td>
        <td class="r mono muted">${fmt(ytd.state_tax)}</td>
        <td class="r mono muted">${fmt(stub.gross_pay)}</td>
      </tr>
      <tr>
        <td>Social Security (OASDI) <span class="muted" style="font-size:8px;">cap $182,100</span></td>
        <td class="r mono muted">6.20%</td>
        <td class="r mono red">${fmt(stub.social_security)}</td>
        <td class="r mono muted">${fmt(ytd.social_security)}</td>
        <td class="r mono muted">${fmt(Math.min(stub.gross_pay, Math.max(0, 182100 - (ytd.gross_pay - stub.gross_pay))))}</td>
      </tr>
      <tr>
        <td>Medicare (HI)</td>
        <td class="r mono muted">1.45%</td>
        <td class="r mono red">${fmt(stub.medicare)}</td>
        <td class="r mono muted">${fmt(ytd.medicare)}</td>
        <td class="r mono muted">${fmt(stub.gross_pay)}</td>
      </tr>
      <tr class="total-row">
        <td class="b dark" colspan="2">Total Statutory Taxes</td>
        <td class="r mono b red" style="font-size:12px;">${fmt(taxDed)}</td>
        <td class="r mono b muted">${fmt(ytdTotalDed)}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <!-- Effective Tax Rate Analysis -->
  <div style="display:flex;gap:12px;margin:10px 0 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="flex:1;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#991b1b;">Effective Fed Rate</div>
      <div style="font-size:16px;font-weight:800;color:#dc2626;font-variant-numeric:tabular-nums;margin-top:2px;">
        ${stub.gross_pay > 0 ? (stub.federal_tax / stub.gross_pay * 100).toFixed(2) : '0.00'}%
      </div>
    </div>
    <div style="flex:1;padding:8px 12px;background:#fefce8;border:1px solid #fde68a;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#854d0e;">Effective State Rate</div>
      <div style="font-size:16px;font-weight:800;color:#d97706;font-variant-numeric:tabular-nums;margin-top:2px;">
        ${stub.gross_pay > 0 ? (stub.state_tax / stub.gross_pay * 100).toFixed(2) : '0.00'}%
      </div>
    </div>
    <div style="flex:1;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#1e40af;">FICA Rate</div>
      <div style="font-size:16px;font-weight:800;color:#2563eb;font-variant-numeric:tabular-nums;margin-top:2px;">
        ${stub.gross_pay > 0 ? ((stub.social_security + stub.medicare) / stub.gross_pay * 100).toFixed(2) : '0.00'}%
      </div>
    </div>
    <div style="flex:1;padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#166534;">Total Tax Burden</div>
      <div style="font-size:16px;font-weight:800;color:#16a34a;font-variant-numeric:tabular-nums;margin-top:2px;">
        ${stub.gross_pay > 0 ? (taxDed / stub.gross_pay * 100).toFixed(2) : '0.00'}%
      </div>
    </div>
  </div>

  <!-- Pre-Tax & Post-Tax Deductions Section -->
  ${(preTax > 0 || postTax > 0 || deductionItems.length > 0) ? `
  <div class="section" style="background:#4c1d95;margin-top:16px;">Voluntary Deductions</div>
  <table>
    <thead><tr>
      <th style="width:40%">Deduction</th>
      <th class="r" style="width:15%">Type</th>
      <th class="r" style="width:15%">Basis</th>
      <th class="r" style="width:15%">Current</th>
      <th class="r" style="width:15%">YTD</th>
    </tr></thead>
    <tbody>
      ${deductionItems.length > 0 ? deductionItems.map(([name, amount]) => {
        const isPre = name.toLowerCase().includes('401k') || name.toLowerCase().includes('hsa') || name.toLowerCase().includes('fsa') || name.toLowerCase().includes('health') || name.toLowerCase().includes('dental') || name.toLowerCase().includes('vision') || name.toLowerCase().includes('retirement');
        return `
      <tr>
        <td class="dark">${esc(name)}</td>
        <td class="r muted" style="font-size:10px;">${isPre ? 'Pre-Tax' : 'Post-Tax'}</td>
        <td class="r muted" style="font-size:10px;">Per Period</td>
        <td class="r mono red">${fmt(amount)}</td>
        <td class="r mono muted">--</td>
      </tr>`;
      }).join('') : ''}
      ${(preTax > 0 && deductionItems.length === 0) ? `
      <tr>
        <td class="dark">Pre-Tax Deductions</td>
        <td class="r muted" style="font-size:10px;">Pre-Tax</td>
        <td class="r muted" style="font-size:10px;">Per Period</td>
        <td class="r mono red">${fmt(preTax)}</td>
        <td class="r mono muted">--</td>
      </tr>` : ''}
      ${(postTax > 0 && deductionItems.length === 0) ? `
      <tr>
        <td class="dark">Post-Tax Deductions</td>
        <td class="r muted" style="font-size:10px;">Post-Tax</td>
        <td class="r muted" style="font-size:10px;">Per Period</td>
        <td class="r mono red">${fmt(postTax)}</td>
        <td class="r mono muted">--</td>
      </tr>` : ''}
      <tr class="total-row">
        <td class="b dark" colspan="3">Total Voluntary Deductions</td>
        <td class="r mono b red">${fmt(preTax + postTax)}</td>
        <td class="r mono b muted">--</td>
      </tr>
    </tbody>
  </table>
  ` : ''}

  <!-- Combined Deductions Summary -->
  <div style="display:flex;gap:0;margin:12px 0;border:1px solid #cbd5e1;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="flex:1;padding:10px 14px;border-right:1px solid #e2e8f0;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Statutory Taxes</div>
      <div style="font-size:14px;font-weight:800;color:#dc2626;font-variant-numeric:tabular-nums;margin-top:2px;">${fmt(taxDed)}</div>
    </div>
    ${preTax > 0 ? `
    <div style="flex:1;padding:10px 14px;border-right:1px solid #e2e8f0;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Pre-Tax</div>
      <div style="font-size:14px;font-weight:800;color:#7c3aed;font-variant-numeric:tabular-nums;margin-top:2px;">${fmt(preTax)}</div>
    </div>
    ` : ''}
    ${postTax > 0 ? `
    <div style="flex:1;padding:10px 14px;border-right:1px solid #e2e8f0;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Post-Tax</div>
      <div style="font-size:14px;font-weight:800;color:#0891b2;font-variant-numeric:tabular-nums;margin-top:2px;">${fmt(postTax)}</div>
    </div>
    ` : ''}
    <div style="flex:1;padding:10px 14px;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Total Deducted</div>
      <div style="font-size:14px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;margin-top:2px;">${fmt(totalDed)}</div>
    </div>
  </div>

  ${deductionsDonutHTML}
  ${ytdProgressHTML}

  <!-- Waterfall Summary -->
  <div class="waterfall no-break">
    <div class="section section-summary">Pay Summary</div>
    <div class="wf-row" style="background:#f8fafc;">
      <span class="wf-label b">Gross Earnings</span>
      <span class="wf-value dark b">${fmt(stub.gross_pay)}</span>
    </div>
    <div class="wf-row">
      <span class="wf-label">Statutory Taxes (Federal + State + FICA)</span>
      <span class="wf-value red">-${fmt(taxDed)}</span>
    </div>
    ${preTax > 0 ? `
    <div class="wf-row">
      <span class="wf-label">Pre-Tax Deductions</span>
      <span class="wf-value red">-${fmt(preTax)}</span>
    </div>
    ` : ''}
    ${postTax > 0 ? `
    <div class="wf-row">
      <span class="wf-label">Post-Tax Deductions</span>
      <span class="wf-value red">-${fmt(postTax)}</span>
    </div>
    ` : ''}
    <div class="wf-row wf-total">
      <span>Net Pay</span>
      <span class="wf-value green" style="font-size:15px;">${fmt(stub.net_pay)}</span>
    </div>
  </div>

  <!-- Net Pay Callout -->
  <div class="net-box no-break">
    <div class="net-current">
      <div class="net-label">Net Pay This Period</div>
      <div class="net-amount">${fmt(stub.net_pay)}</div>
      ${netOfGrossHTML}
    </div>
    <div>
      <div class="net-ytd-label">Year-to-Date Net</div>
      <div class="net-ytd-amount">${fmt(ytd.net_pay)}</div>
      <div style="font-size:9px;color:#94a3b8;text-align:right;margin-top:4px;">
        YTD Gross: ${fmt(ytd.gross_pay)}<br>
        YTD Taxes: ${fmt(ytdTotalDed)}
      </div>
    </div>
  </div>

  <!-- Employer Contributions (informational, NOT deducted from pay) -->
  ${hasEmployerContribs ? `
  <div class="section section-employer no-break">Employer Contributions</div>
  <div class="employer-note">Informational — Employer-paid obligations not deducted from employee pay</div>
  <table class="employer-table">
    <thead><tr>
      <th style="width:44%">Obligation</th>
      <th class="r" style="width:14%">Rate</th>
      <th class="r" style="width:21%">Current</th>
      <th class="r" style="width:21%">Wage Base</th>
    </tr></thead>
    <tbody>
      ${empSS > 0 ? `<tr><td>Social Security (OASDI Match)</td><td class="r mono muted">6.20%</td><td class="r mono">${fmt(empSS)}</td><td class="r mono muted">$182,100</td></tr>` : ''}
      ${empMed > 0 ? `<tr><td>Medicare (HI Match)</td><td class="r mono muted">1.45%</td><td class="r mono">${fmt(empMed)}</td><td class="r mono muted">No limit</td></tr>` : ''}
      ${empFuta > 0 ? `<tr><td>Federal Unemployment (FUTA)</td><td class="r mono muted">0.60%</td><td class="r mono">${fmt(empFuta)}</td><td class="r mono muted">$7,000</td></tr>` : ''}
      ${empSuta > 0 ? `<tr><td>State Unemployment (UT SUI)</td><td class="r mono muted">1.20%</td><td class="r mono">${fmt(empSuta)}</td><td class="r mono muted">$44,800</td></tr>` : ''}
      ${empMatch > 0 ? `<tr><td>Retirement Plan Match</td><td class="r mono muted">--</td><td class="r mono">${fmt(empMatch)}</td><td class="r mono muted">--</td></tr>` : ''}
      ${empHealth > 0 ? `<tr><td>Health Insurance Contribution</td><td class="r mono muted">--</td><td class="r mono">${fmt(empHealth)}</td><td class="r mono muted">--</td></tr>` : ''}
      <tr class="total-row">
        <td class="b dark" colspan="2">Total Employer Cost</td>
        <td class="r mono b dark">${fmt(employerTotal)}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <!-- Total Compensation Statement -->
  <div style="margin:12px 0;padding:12px 16px;background:#f0f9ff;border:2px solid #93c5fd;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#1e40af;margin-bottom:8px;">Total Compensation Statement</div>
    <div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid #dbeafe;">
      <span style="color:#475569;">Gross Earnings</span>
      <span style="font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,monospace;">${fmt(stub.gross_pay)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid #dbeafe;">
      <span style="color:#475569;">Employer Contributions</span>
      <span style="font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,monospace;">${fmt(employerTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0 0;border-top:2px solid #1e40af;margin-top:4px;">
      <span style="font-weight:800;color:#1e40af;">Total Compensation This Period</span>
      <span style="font-weight:800;color:#1e40af;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,monospace;">${fmt(stub.gross_pay + employerTotal)}</span>
    </div>
  </div>
  ` : ''}

  <!-- Direct Deposit Info (last-4 only — full account never rendered) -->
  ${(stub.bank_name || bankAcctDisplay) ? `
  <div class="section section-deposit no-break">Direct Deposit</div>
  <div class="deposit-block no-break">
    <div>
      <div class="deposit-label">Bank</div>
      <div class="deposit-val">${esc(stub.bank_name || '')}</div>
    </div>
    <div style="text-align:right;">
      <div class="deposit-label">Account</div>
      <div class="deposit-val">${bankAcctDisplay || '--'} <span class="muted" style="font-weight:400;font-size:9px;">(last 4 only)</span></div>
    </div>
  </div>
  ` : ''}

  <!-- Comprehensive YTD Breakdown -->
  <div class="section no-break" style="background:#334155;margin-top:20px;">Year-to-Date Summary</div>
  <table>
    <thead><tr>
      <th style="width:44%">Category</th>
      <th class="r" style="width:28%">YTD Amount</th>
      <th class="r" style="width:28%">Annualized Projection</th>
    </tr></thead>
    <tbody>
      <tr>
        <td class="dark b">Gross Earnings</td>
        <td class="r mono b dark">${fmt(ytd.gross_pay)}</td>
        <td class="r mono muted">${fmt(ytd.gross_pay / yearFrac)}</td>
      </tr>
      <tr style="background:#fef2f2;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <td style="padding-left:20px;">Federal Income Tax</td>
        <td class="r mono red">${fmt(ytd.federal_tax)}</td>
        <td class="r mono muted">${fmt(ytd.federal_tax / yearFrac)}</td>
      </tr>
      <tr style="background:#fef2f2;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <td style="padding-left:20px;">State Income Tax (UT)</td>
        <td class="r mono red">${fmt(ytd.state_tax)}</td>
        <td class="r mono muted">${fmt(ytd.state_tax / yearFrac)}</td>
      </tr>
      <tr style="background:#fef2f2;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <td style="padding-left:20px;">Social Security (OASDI)</td>
        <td class="r mono red">${fmt(ytd.social_security)}</td>
        <td class="r mono muted">${fmt(ytd.social_security / yearFrac)}</td>
      </tr>
      <tr style="background:#fef2f2;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <td style="padding-left:20px;">Medicare (HI)</td>
        <td class="r mono red">${fmt(ytd.medicare)}</td>
        <td class="r mono muted">${fmt(ytd.medicare / yearFrac)}</td>
      </tr>
      <tr class="total-row">
        <td class="b dark">Total Taxes YTD</td>
        <td class="r mono b red">${fmt(ytdTotalDed)}</td>
        <td class="r mono b muted">${fmt(ytdTotalDed / yearFrac)}</td>
      </tr>
      <tr>
        <td class="dark b" style="color:#16a34a;">Net Pay YTD</td>
        <td class="r mono b green">${fmt(ytd.net_pay)}</td>
        <td class="r mono b muted">${fmt(ytd.net_pay / yearFrac)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Hours-to-Date (hourly employees) -->
  ${!isSalaried ? `
  <div style="display:flex;gap:0;margin:10px 0;border:1px solid #cbd5e1;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="flex:1;padding:8px 14px;border-right:1px solid #e2e8f0;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Current Hours</div>
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-top:2px;">${totalHours.toFixed(2)}</div>
    </div>
    <div style="flex:1;padding:8px 14px;border-right:1px solid #e2e8f0;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Regular</div>
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-top:2px;">${hoursRegular.toFixed(2)}</div>
    </div>
    <div style="flex:1;padding:8px 14px;border-right:1px solid #e2e8f0;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Overtime</div>
      <div style="font-size:14px;font-weight:800;color:${hoursOvertime > 0 ? '#d97706' : '#0f172a'};margin-top:2px;">${hoursOvertime.toFixed(2)}</div>
    </div>
    <div style="flex:1;padding:8px 14px;text-align:center;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;">Avg $/Hour</div>
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-top:2px;">${totalHours > 0 ? fmt(stub.net_pay / totalHours) : '--'}</div>
    </div>
  </div>
  ` : ''}

  <!-- Social Security Wage Base Tracker -->
  <div style="margin:14px 0;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;">
    <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#0f172a;margin-bottom:8px;">FICA Wage Base Tracking — 2026</div>
    <div style="display:flex;gap:16px;">
      <div style="flex:1;">
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#64748b;margin-bottom:3px;">
          <span>Social Security (OASDI)</span>
          <span class="mono">${fmt(ytd.gross_pay)} of $182,100</span>
        </div>
        <div style="height:8px;background:#e2e8f0;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <div style="height:100%;width:${Math.min(100, (ytd.gross_pay / 182100) * 100).toFixed(1)}%;background:${ytd.gross_pay >= 182100 ? '#dc2626' : '#2563eb'};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:8px;color:#94a3b8;margin-top:2px;">
          <span>${(Math.min(100, (ytd.gross_pay / 182100) * 100)).toFixed(1)}% used</span>
          <span>${ytd.gross_pay >= 182100 ? 'CAP REACHED — No further SS withheld' : 'Remaining: ' + fmt(Math.max(0, 182100 - ytd.gross_pay))}</span>
        </div>
      </div>
      <div style="flex:1;">
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#64748b;margin-bottom:3px;">
          <span>Medicare Surtax Threshold</span>
          <span class="mono">${fmt(ytd.gross_pay)} of $200,000</span>
        </div>
        <div style="height:8px;background:#e2e8f0;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <div style="height:100%;width:${Math.min(100, (ytd.gross_pay / 200000) * 100).toFixed(1)}%;background:${ytd.gross_pay >= 200000 ? '#dc2626' : '#7c3aed'};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:8px;color:#94a3b8;margin-top:2px;">
          <span>${(Math.min(100, (ytd.gross_pay / 200000) * 100)).toFixed(1)}% toward threshold</span>
          <span>${ytd.gross_pay >= 200000 ? '0.9% SURTAX ACTIVE' : 'Before surtax: ' + fmt(Math.max(0, 200000 - ytd.gross_pay))}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Pay Calculation Detail -->
  <div style="margin:10px 0;padding:10px 14px;background:#f1f5f9;border:1px solid #e2e8f0;font-size:9px;color:#475569;line-height:1.7;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;">
    <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#0f172a;margin-bottom:4px;">Pay Calculation Detail</div>
    ${isSalaried ? `
    <div>&bull; <strong>Annual Salary:</strong> ${payRate > 0 ? fmt(payRate) : 'Per employment agreement'} &divide; ${periodsPerYr} periods = <strong>${fmt(stub.gross_pay)}</strong> per period</div>
    ` : `
    <div>&bull; <strong>Regular:</strong> ${hoursRegular.toFixed(2)} hours &times; ${fmt(effectiveRate)} = ${fmt(regularPay)}</div>
    ${hoursOvertime > 0 ? `<div>&bull; <strong>Overtime:</strong> ${hoursOvertime.toFixed(2)} hours &times; ${fmt(effectiveRate)} &times; 1.5 = ${fmt(overtimePay)}</div>` : ''}
    <div>&bull; <strong>Gross Pay:</strong> ${fmt(regularPay)}${hoursOvertime > 0 ? ' + ' + fmt(overtimePay) : ''} = <strong>${fmt(stub.gross_pay)}</strong></div>
    `}
    <div>&bull; <strong>Federal W/H:</strong> Annualized gross ${fmt(stub.gross_pay * periodsPerYr)} &minus; std deduction &rarr; bracket calc &divide; ${periodsPerYr}${stub.w4_step4c_extra ? ' + $' + stub.w4_step4c_extra.toFixed(2) + ' extra' : ''} = <strong>${fmt(stub.federal_tax)}</strong></div>
    <div>&bull; <strong>${stateName} W/H:</strong> Annualized gross &times; flat rate &minus; exemption credits &divide; ${periodsPerYr} = <strong>${fmt(stub.state_tax)}</strong></div>
    <div>&bull; <strong>SS (OASDI):</strong> Taxable wages ${fmt(Math.min(stub.gross_pay, Math.max(0, 182100 - (ytd.gross_pay - stub.gross_pay))))} &times; 6.2% = <strong>${fmt(stub.social_security)}</strong></div>
    <div>&bull; <strong>Medicare (HI):</strong> ${fmt(stub.gross_pay)} &times; 1.45% = <strong>${fmt(stub.medicare)}</strong></div>
    <div>&bull; <strong>Net Pay:</strong> ${fmt(stub.gross_pay)} &minus; ${fmt(taxDed)} taxes${preTax > 0 ? ' &minus; ' + fmt(preTax) + ' pre-tax' : ''}${postTax > 0 ? ' &minus; ' + fmt(postTax) + ' post-tax' : ''} = <strong style="color:#16a34a;">${fmt(stub.net_pay)}</strong></div>
  </div>

  <!-- Important Notices -->
  <div style="margin:10px 0 8px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;font-size:9px;color:#92400e;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;">
    <div style="font-weight:700;margin-bottom:4px;">Important Information</div>
    <div>&bull; Federal tax calculated per IRS Publication 15-T (2026) Percentage Method for Form W-4 (2020 or later).</div>
    <div>&bull; ${stateName} state tax calculated at the flat withholding rate per TC-40W, with applicable personal exemption credits.</div>
    <div>&bull; Social Security (OASDI) tax applies to wages up to the annual wage base of $182,100 (2026). Once the cap is reached, no further SS tax is withheld for the remainder of the calendar year.</div>
    <div>&bull; Medicare (HI) tax of 1.45% applies to all wages with no cap. Additional 0.9% Medicare surtax applies to combined wages exceeding $200,000 YTD (IRC &sect;3101(b)(2)).</div>
    <div>&bull; Pre-tax deductions (401(k), HSA, health insurance) reduce taxable income for federal and state withholding but remain subject to FICA taxes unless specifically exempted.</div>
    <div>&bull; This earnings statement is provided for informational purposes. Retain for your personal tax records. Report discrepancies to your employer within 30 days of receipt.</div>
    <div>&bull; Employer contributions shown are paid by the employer and do not reduce your take-home pay. They represent additional compensation value beyond your gross earnings.</div>
  </div>

  <!-- Confidential notice -->
  <div class="confidential no-break">Confidential Employee Pay Information &mdash; Retain for Tax Records</div>

  <!-- Footer -->
  <div class="footer no-break">
    <span>${companyName}${companyLegal ? ' &middot; ' + companyLegal : ''}</span>
    <span>Pay Period ${esc(stub.period_start)} &ndash; ${esc(stub.period_end)}</span>
    <span>Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
  </div>

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
    .map(c => `<th class="${c.align === 'right' ? 'text-right' : ''}">${esc(c.label)}</th>`)
    .join('');

  const bodyRows = rows.map(row => {
    const cells = columns.map(c => {
      const val = row[c.key];
      const align = c.align === 'right' ? 'text-right' : '';
      const mono = c.format === 'currency' ? 'font-mono' : '';
      const display = c.format === 'currency' ? fmt(Number(val) || 0) : esc(String(val ?? ''));
      const bold = row._bold ? 'font-bold' : '';
      const accent = row._accent || '';
      return `<td class="${align} ${mono} ${bold} ${accent}">${display}</td>`;
    }).join('');

    const trClass = row._separator ? 'class="rpt-total"' : '';
    const bgClass = row._highlight ? 'style="background:#f1f5f9;"' : '';
    return `<tr ${trClass} ${bgClass}>${cells}</tr>`;
  }).join('');

  const summaryHTML = summary && summary.length > 0 ? `
    <div class="no-break" style="margin-top:24px;">
      <div class="rpt-section" style="margin-top:0;">Summary</div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;background:#ffffff;box-shadow:0 1px 0 rgba(15,23,42,0.04),0 4px 12px -4px rgba(15,23,42,0.06);-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${summary.map((s, i) => {
        const color = s.accent === 'green' ? '#16a34a' : s.accent === 'red' ? '#dc2626' : '#0f172a';
        const bg = i % 2 === 0 ? 'background:#f8fafc;' : 'background:#ffffff;';
        const isLast = i === summary.length - 1;
        const border = isLast ? '' : 'border-bottom:1px solid #f1f5f9;';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;font-size:12px;${bg}${border}-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <span style="font-weight:700;color:#0f172a;letter-spacing:0.1px;">${esc(s.label)}</span>
          <span style="font-weight:800;color:${color};font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,monospace;font-size:13px;letter-spacing:-0.2px;">${esc(s.value)}</span>
        </div>`;
      }).join('')}
      </div>
    </div>
  ` : '';

  const rowCount = rows.filter(r => !r._separator && !r._bold).length;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${baseStyles}
</style></head>
<body>
<div class="rpt-page">
  ${reportHeader(companyName, title, dateRange)}

  <div class="rpt-meta">
    <div class="rpt-meta-item"><span class="rpt-meta-label">Report</span><span class="rpt-meta-val">${esc(title)}</span></div>
    <div class="rpt-meta-item"><span class="rpt-meta-label">Period</span><span class="rpt-meta-val">${esc(dateRange)}</span></div>
    <div class="rpt-meta-item"><span class="rpt-meta-label">Entries</span><span class="rpt-meta-val">${rowCount}</span></div>
  </div>

  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>

  ${summaryHTML}

  ${reportFooter(companyName)}
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
  const companyName = esc(company?.name || 'Company');
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

  const agingRows = Object.entries(buckets).map(([label, { count, amount }]) => `
    <tr>
      <td>${label} days</td>
      <td class="text-right">${count}</td>
      <td class="text-right font-mono">${fmt(amount)}</td>
      <td class="text-right text-muted">${totalBalance > 0 ? ((amount / totalBalance) * 100).toFixed(1) : '0.0'}%</td>
    </tr>`).join('');

  const stageRows = Object.entries(stages).map(([stage, count]) => `
    <tr><td style="text-transform:capitalize;">${esc(stage.replace(/_/g, ' '))}</td><td class="text-right">${count}</td></tr>`).join('');

  const top10Rows = top10.map(d => {
    const days = daysSince(d);
    return `<tr>
      <td>${esc(d.debtor_name || '—')}</td>
      <td class="text-right font-mono">${fmt(Number(d.balance_due || 0))}</td>
      <td class="text-right">${days}d</td>
      <td style="text-transform:capitalize;">${esc((d.current_stage || '').replace(/_/g, ' '))}</td>
    </tr>`;
  }).join('');

  // Aging bar chart widths
  const maxBucket = Math.max(...Object.values(buckets).map(b => b.amount), 1);
  const bucketColors: Record<string, string> = { '0-30': '#22c55e', '31-90': '#eab308', '91-180': '#f97316', '180+': '#dc2626' };

  const agingBars = Object.entries(buckets).map(([label, { count, amount }]) => {
    const pct = maxBucket > 0 ? (amount / maxBucket) * 100 : 0;
    const color = bucketColors[label] || '#64748b';
    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
      <span style="width:60px;font-size:11px;font-weight:600;color:#334155;">${label}d</span>
      <div style="flex:1;height:18px;background:#f1f5f9;position:relative;">
        <div style="height:100%;width:${pct}%;background:${color};min-width:${amount > 0 ? '2px' : '0'};"></div>
      </div>
      <span style="width:40px;text-align:right;font-size:10px;color:#64748b;">${count}</span>
      <span style="width:90px;text-align:right;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,monospace;">${fmt(amount)}</span>
      <span style="width:45px;text-align:right;font-size:10px;color:#94a3b8;">${totalBalance > 0 ? ((amount / totalBalance) * 100).toFixed(1) : '0.0'}%</span>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Debt Portfolio Report</title><style>
${baseStyles}
</style></head>
<body><div class="rpt-page">
  ${reportHeader(companyName, 'Debt Portfolio Report')}

  <!-- KPI Cards -->
  <div class="rpt-stats">
    <div class="rpt-stat" style="border-left:3px solid #0f172a;">
      <div class="rpt-stat-label">Total Accounts</div>
      <div class="rpt-stat-val">${debts.length}</div>
    </div>
    <div class="rpt-stat" style="border-left:3px solid #dc2626;">
      <div class="rpt-stat-label">Total Balance Due</div>
      <div class="rpt-stat-val" style="color:#dc2626;">${fmt(totalBalance)}</div>
      <div class="rpt-stat-sub">Original: ${fmt(totalOriginal)}</div>
    </div>
    <div class="rpt-stat" style="border-left:3px solid #16a34a;">
      <div class="rpt-stat-label">Collected YTD</div>
      <div class="rpt-stat-val" style="color:#16a34a;">${fmt(collectedYtd)}</div>
    </div>
    <div class="rpt-stat" style="border-left:3px solid #2563eb;">
      <div class="rpt-stat-label">Recovery Rate</div>
      <div class="rpt-stat-val">${recoveryRate}%</div>
    </div>
  </div>

  <!-- Aging Breakdown (bar chart) -->
  <div class="rpt-section">Aging Breakdown</div>
  <div style="padding:12px 0;">
    <div style="display:flex;gap:12px;padding:0 0 6px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;border-bottom:1px solid #e2e8f0;">
      <span style="width:60px;">Bucket</span><span style="flex:1;">Distribution</span><span style="width:40px;text-align:right;">Accts</span><span style="width:90px;text-align:right;">Balance</span><span style="width:45px;text-align:right;">%</span>
    </div>
    ${agingBars}
  </div>

  <!-- Pipeline Stages -->
  <div class="rpt-section rpt-section-alt">Pipeline Stage Breakdown</div>
  <table><thead><tr><th>Stage</th><th class="text-right">Count</th><th class="text-right">% of Total</th></tr></thead>
  <tbody>${Object.entries(stages).map(([stage, count]) => `
    <tr>
      <td style="text-transform:capitalize;">${esc(stage.replace(/_/g, ' '))}</td>
      <td class="text-right font-mono">${count}</td>
      <td class="text-right text-muted">${debts.length > 0 ? ((count / debts.length) * 100).toFixed(1) : '0.0'}%</td>
    </tr>`).join('')}</tbody></table>

  <!-- Top 10 -->
  <div class="rpt-section">Top 10 Accounts by Balance</div>
  <table><thead><tr><th style="width:5%">#</th><th>Debtor</th><th class="text-right">Balance</th><th class="text-right">Age</th><th>Stage</th></tr></thead>
  <tbody>${top10.map((d, i) => {
    const days = daysSince(d);
    const ageColor = days > 180 ? '#dc2626' : days > 90 ? '#f97316' : days > 30 ? '#eab308' : '#22c55e';
    return `<tr>
      <td style="color:#94a3b8;font-size:10px;">${i + 1}</td>
      <td class="font-bold">${esc(d.debtor_name || '\u2014')}</td>
      <td class="text-right font-mono font-bold">${fmt(Number(d.balance_due || 0))}</td>
      <td class="text-right" style="color:${ageColor};font-weight:600;">${days}d</td>
      <td style="text-transform:capitalize;color:#64748b;">${esc((d.current_stage || '').replace(/_/g, ' '))}</td>
    </tr>`;
  }).join('')}</tbody></table>

  ${(() => {
    // ── Feature #13: risk score histogram ──
    const bands = [
      { label: 'Low', min: 0, max: 25, color: '#16a34a' },
      { label: 'Medium', min: 25, max: 50, color: '#eab308' },
      { label: 'High', min: 50, max: 75, color: '#f97316' },
      { label: 'Critical', min: 75, max: 101, color: '#dc2626' },
    ];
    const counts = bands.map(b => debts.filter(d => {
      const r = Number(d.risk_score ?? d.risk ?? -1);
      return r >= b.min && r < b.max;
    }).length);
    if (counts.reduce((s, x) => s + x, 0) === 0) return '';
    const maxC = Math.max(...counts, 1);
    return `<div class="rpt-section rpt-section-alt">Risk Score Distribution</div>
      <div style="padding:12px 0;">
        ${bands.map((b, i) => {
          const w = (counts[i] / maxC) * 100;
          return `<div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
            <span style="width:80px;font-size:11px;font-weight:600;color:#334155;">${b.label}</span>
            <span style="width:60px;font-size:10px;color:#64748b;">${b.min}-${b.max === 101 ? '100' : b.max}</span>
            <div style="flex:1;height:14px;background:#f1f5f9;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
              <div style="height:100%;width:${w.toFixed(1)}%;background:${b.color};min-width:${counts[i] > 0 ? '2px' : '0'};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
            </div>
            <span style="width:50px;text-align:right;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;">${counts[i]}</span>
          </div>`;
        }).join('')}
      </div>`;
  })()}

  ${(() => {
    // ── Feature #14: top collectors dashboard ──
    const byCollector: Record<string, number> = {};
    debts.forEach(d => {
      const name = d.collector_name || d.assigned_to_name || d.collector || d.assigned_collector || '';
      const collected = Number(d.amount_collected || d.collected || (Number(d.original_amount || 0) - Number(d.balance_due || 0)));
      if (!name || !isFinite(collected) || collected <= 0) return;
      byCollector[name] = (byCollector[name] || 0) + collected;
    });
    const top = Object.entries(byCollector).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length === 0) return '';
    const max = top[0][1];
    return `<div class="rpt-section">Top Collectors</div>
      <div style="padding:12px 0;">
        ${top.map(([name, amt]) => {
          const w = (amt / max) * 100;
          return `<div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
            <span style="width:160px;font-size:11px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>
            <div style="flex:1;height:14px;background:#f1f5f9;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
              <div style="height:100%;width:${w.toFixed(1)}%;background:#16a34a;min-width:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
            </div>
            <span style="width:100px;text-align:right;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;">${fmt(amt)}</span>
          </div>`;
        }).join('')}
      </div>`;
  })()}

  ${reportFooter(companyName)}
  <div style="margin-top:12px;border-top:1px solid #000;padding-top:8px;font-family:Georgia,'Times New Roman',serif;font-size:9pt;color:#444;text-align:center;font-style:italic;">
    This communication may contain privileged or confidential information. Unauthorized disclosure is prohibited.
  </div>
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
  const companyName = esc(company?.name || 'Your Company');
  const cityStateZip = [company?.city, company?.state].filter(Boolean).join(', ') + (company?.zip ? ' ' + company.zip : '');
  const companyAddr = esc([company?.address_line1, company?.address_line2, cityStateZip.trim()].filter(s => s && String(s).trim()).join(', '));
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

  const paymentRows = payments.length > 0
    ? payments.map(p => `<tr>
        <td>${fmtDateLocal(p.received_date)}</td>
        <td class="text-right font-mono">${fmt(Number(p.amount || 0))}</td>
        <td>${esc(p.method || '—')}</td>
        <td class="text-muted">${esc(p.reference_number || '—')}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:#64748b;font-style:italic;">No payments received</td></tr>`;

  // ── Feature #10: days overdue indicator with weekly strip ──
  const delinqRaw = debt.delinquent_date || debt.due_date || debt.created_at;
  const daysOverdue = delinqRaw ? Math.max(0, Math.floor((Date.now() - new Date(delinqRaw + (typeof delinqRaw === 'string' && delinqRaw.length === 10 ? 'T12:00:00' : '')).getTime()) / 86_400_000)) : 0;
  const daysOverdueHTML = daysOverdue > 0 ? (() => {
    const totalCells = 18 * 7; // 126 days
    const filled = Math.min(totalCells, daysOverdue);
    let cells = '';
    for (let i = 0; i < totalCells; i++) {
      const isFilled = i < filled;
      const isWeekStart = i % 7 === 0;
      cells += `<span style="display:inline-block;width:7px;height:7px;margin:1px;background:${isFilled ? '#dc2626' : '#e2e8f0'};${isWeekStart ? 'margin-left:3px;' : ''}-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>`;
    }
    return `<div style="margin:14px 0;padding:10px 14px;background:#fef2f2;border:1.5px solid #dc2626;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="display:flex;align-items:baseline;gap:14px;">
        <span style="font-size:32pt;font-weight:800;color:#dc2626;font-family:Georgia,serif;font-variant-numeric:tabular-nums;line-height:1;">${daysOverdue}</span>
        <span style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#991b1b;">days overdue${daysOverdue >= totalCells ? ' (chart truncated at 126 days)' : ''}</span>
      </div>
      <div style="margin-top:8px;line-height:0;">${cells}</div>
    </div>`;
  })() : '';

  // ── Feature #9: aging bucket bar ──
  const ageBuckets = [
    { label: 'Current', max: 30, color: '#16a34a' },
    { label: '31-60', max: 60, color: '#eab308' },
    { label: '61-90', max: 90, color: '#f97316' },
    { label: '90+', max: Infinity, color: '#dc2626' },
  ];
  const bucketIdx = ageBuckets.findIndex(b => daysOverdue <= b.max);
  const activeBucket = bucketIdx >= 0 ? bucketIdx : ageBuckets.length - 1;
  const agingBarHTML = balanceDue > 0 ? (() => {
    // Distribution: weight bucket the debt falls into; show full bar with all buckets
    const widths = ageBuckets.map((_, i) => i === activeBucket ? 40 : 20); // emphasize active
    const sum = widths.reduce((a, b) => a + b, 0);
    return `<div style="margin:10px 0 14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#444;margin-bottom:5px;font-family:Georgia,serif;">Aging Status</div>
      <div style="display:flex;height:14px;border:1px solid #000;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        ${ageBuckets.map((b, i) => `<div style="width:${(widths[i] / sum * 100).toFixed(2)}%;background:${b.color};opacity:${i === activeBucket ? '1' : '0.35'};-webkit-print-color-adjust:exact;print-color-adjust:exact;border-right:${i < ageBuckets.length - 1 ? '1px solid #000' : 'none'};"></div>`).join('')}
      </div>
      <div style="display:flex;font-size:8.5pt;color:#333;margin-top:3px;font-family:Georgia,serif;">
        ${ageBuckets.map((b, i) => `<div style="width:${(widths[i] / sum * 100).toFixed(2)}%;text-align:center;font-weight:${i === activeBucket ? '700' : '400'};">${b.label}${i === activeBucket ? ' \u25C0' : ''}</div>`).join('')}
      </div>
    </div>`;
  })() : '';

  // ── Feature #19: total-due donut ──
  const totalDueDonutHTML = (() => {
    const segs = [
      { value: originalAmount, color: '#0f766e', label: 'Principal' },
      { value: interest, color: '#0891b2', label: 'Interest' },
      { value: fees, color: '#ea580c', label: 'Fees' },
    ];
    if (segs.reduce((s, x) => s + x.value, 0) <= 0) return '';
    return `<div style="float:right;margin:0 0 12px 14px;text-align:center;font-family:Georgia,serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${svgDonut(segs, 90)}
      <div style="font-size:8.5pt;color:#333;margin-top:4px;line-height:1.5;">
        ${segs.filter(s => s.value > 0).map(s => `<div><span style="display:inline-block;width:8px;height:8px;background:${s.color};margin-right:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></span>${esc(s.label)}: ${fmt(s.value)}</div>`).join('')}
        ${totalPaid > 0 ? `<div style="font-style:italic;color:#16a34a;">Less paid: (${fmt(totalPaid)})</div>` : ''}
      </div>
    </div>`;
  })();

  const acctNum = (debt.debt_number || debt.id || '').toString().slice(0, 12).toUpperCase() || 'N/A';
  const phone = esc(company?.phone || '');
  const email = esc(company?.email || '');
  const jurisdiction = esc(debt?.jurisdiction || '[your state of residence]');
  const sigName = esc(options.signatory_name || 'Authorized Representative');
  const sigTitle = esc(options.signatory_title || 'Accounts Receivable Manager');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Demand Letter — ${esc(debt.debtor_name)}</title><style>
${baseStyles}
@page { size: letter; margin: 1in; }
body { background: #fff; }
.legal-wrap { max-width: 6.5in; margin: 0 auto; }
</style></head>
<body><div class="legal-page legal-wrap">
  <div class="legal-letterhead">
    <div class="lh-name">${companyName}</div>
    <div class="lh-rule"></div>
    <div class="lh-meta">
      ${companyAddr || ''}${phone ? ` &middot; Tel: ${phone}` : ''}${email ? ` &middot; ${email}` : ''}
    </div>
  </div>

  <div class="legal-date">${todayLong}</div>

  <div class="legal-recipient">
    <strong>${esc(debt.debtor_name || 'To Whom It May Concern')}</strong><br>
    ${debt.debtor_address ? esc(debt.debtor_address).replace(/\n/g, '<br>') + '<br>' : ''}
    ${debt.debtor_email ? esc(debt.debtor_email) : ''}
  </div>

  <div class="legal-subject">RE: Outstanding Debt — Account #${acctNum}</div>

  <div class="legal-body">
    <p class="no-indent">Dear ${esc(debt.debtor_name || 'Sir or Madam')}:</p>

    <p>This letter constitutes formal demand for payment of an outstanding obligation owed by you to <strong>${companyName}</strong>. Our records establish that you are indebted to ${companyName} in the sum identified below, and that despite the passage of the applicable due date this balance remains unsatisfied.</p>

    ${daysOverdueHTML}
    ${agingBarHTML}
    ${totalDueDonutHTML}

    <table class="legal-amount-table">
      <tbody>
        <tr><td>Original Principal Amount</td><td class="amt">${fmt(originalAmount)}</td></tr>
        <tr><td>Interest Accrued</td><td class="amt">${fmt(interest)}</td></tr>
        <tr><td>Fees and Charges Accrued</td><td class="amt">${fmt(fees)}</td></tr>
        <tr><td>Payments Received and Applied</td><td class="amt">(${fmt(totalPaid)})</td></tr>
        <tr class="total"><td>TOTAL DUE</td><td class="amt">${fmt(balanceDue)}</td></tr>
      </tbody>
    </table>

    ${payments.length > 0 ? `
    <p class="no-indent" style="margin-top:18px;font-weight:700;font-size:10.5pt;text-transform:uppercase;letter-spacing:0.5px;">Schedule of Payments Received</p>
    <table class="legal-amount-table" style="width:100%;">
      <thead><tr><td style="font-weight:700;">Date</td><td style="font-weight:700;" class="amt">Amount</td><td style="font-weight:700;">Method</td><td style="font-weight:700;">Reference</td></tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>` : ''}

    <p><strong>YOU ARE HEREBY DEMANDED to pay the sum of ${fmt(balanceDue)} within ${deadlineDays} days from the date of this letter, on or before ${deadlineDate}.</strong> Payment must be tendered in certified funds and made payable to ${companyName}${options.payment_address ? `, addressed to ${esc(options.payment_address)}` : ''}.${options.online_payment_url ? ` Electronic remittance may be made at ${esc(options.online_payment_url)}.` : ''}</p>

    <p>Should you fail to remit payment in full by the date stated above, ${companyName} will have no alternative but to pursue all lawful remedies available to it under the laws of ${jurisdiction}, including but not limited to the institution of civil proceedings to obtain a money judgment, recovery of court costs and reasonable attorneys' fees as permitted by contract or statute, post-judgment enforcement (including wage garnishment, bank levy, and judgment liens upon real property), and reporting of the delinquency to consumer credit reporting agencies.</p>

    <div class="legal-notice">
      <div class="ln-heading">Notice of Your Rights — Validation of Debt (15 U.S.C. &sect; 1692g)</div>
      <p style="text-indent:0;margin-bottom:8px;">Unless you notify this office within 30 days after receiving this notice that you dispute the validity of this debt or any portion thereof, this office will assume this debt is valid. If you notify this office in writing within 30 days from receiving this notice that you dispute the validity of this debt or any portion thereof, this office will: obtain verification of the debt or obtain a copy of a judgment and mail you a copy of such judgment or verification. If you request this office in writing within 30 days after receiving this notice, this office will provide you with the name and address of the original creditor, if different from the current creditor.</p>
    </div>

    <div class="legal-mini-miranda">
      This communication is from a debt collector. This is an attempt to collect a debt and any information obtained will be used for that purpose.
    </div>

    <p>If you believe this debt has been satisfied or has been asserted in error, or if you wish to discuss a mutually acceptable resolution, please contact the undersigned in writing at the address above${phone ? ` or by telephone at ${phone}` : ''}${email ? ` or by email at ${email}` : ''} prior to the deadline stated herein.</p>

    <p class="no-indent" style="margin-top:28px;">Respectfully,</p>

    <div class="legal-signature">
      <div class="legal-sig-line"></div>
      <div class="legal-sig-name">${sigName}</div>
      <div class="legal-sig-title">${sigTitle}</div>
      <div class="legal-sig-title">${companyName}</div>
    </div>
  </div>

  <div class="legal-confidential-footer">
    This communication may contain privileged or confidential information intended solely for the addressee.<br>
    Sent on ${todayLong} via U.S. First Class Mail. Account #${acctNum}.
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

  const summaryTable = `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:12px;">
  <tr><td style="padding:6px 12px;border:1px solid #ddd;">Original Amount</td><td style="padding:6px 12px;border:1px solid #ddd;text-align:right;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,Consolas,monospace;">${fmtAmt(originalAmt)}</td></tr>
  <tr><td style="padding:6px 12px;border:1px solid #ddd;">Interest</td><td style="padding:6px 12px;border:1px solid #ddd;text-align:right;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,Consolas,monospace;">${fmtAmt(interestAmt)}</td></tr>
  <tr><td style="padding:6px 12px;border:1px solid #ddd;">Fees</td><td style="padding:6px 12px;border:1px solid #ddd;text-align:right;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,Consolas,monospace;">${fmtAmt(feesAmt)}</td></tr>
  <tr><td style="padding:6px 12px;border:1px solid #ddd;">Payments</td><td style="padding:6px 12px;border:1px solid #ddd;text-align:right;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,Consolas,monospace;color:#16a34a;">\u2212${fmtAmt(totalPaid)}</td></tr>
  <tr style="font-weight:700;"><td style="padding:8px 12px;border:2px solid #111;">Balance Due</td><td style="padding:8px 12px;border:2px solid #111;text-align:right;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,Consolas,monospace;">${fmtAmt(balanceDue)}</td></tr>
</table>`;

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

  const accountRefBlock = `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:11px;background:#f9f9f9;">
  <tr><td style="padding:5px 12px;border:1px solid #e5e5e5;font-weight:600;width:35%;">Account Reference</td><td style="padding:5px 12px;border:1px solid #e5e5e5;">${accountRef}</td></tr>
  <tr><td style="padding:5px 12px;border:1px solid #e5e5e5;font-weight:600;">Original Due Date</td><td style="padding:5px 12px;border:1px solid #e5e5e5;">${dueDate}</td></tr>
  <tr><td style="padding:5px 12px;border:1px solid #e5e5e5;font-weight:600;">Date Delinquent</td><td style="padding:5px 12px;border:1px solid #e5e5e5;">${delinquentDate}</td></tr>
  <tr><td style="padding:5px 12px;border:1px solid #e5e5e5;font-weight:600;">Days Past Due</td><td style="padding:5px 12px;border:1px solid #e5e5e5;">${daysOverdue} days</td></tr>
  <tr><td style="padding:5px 12px;border:1px solid #e5e5e5;font-weight:600;">Interest Rate</td><td style="padding:5px 12px;border:1px solid #e5e5e5;">${interestRate}</td></tr>
  <tr><td style="padding:5px 12px;border:1px solid #e5e5e5;font-weight:600;">Jurisdiction</td><td style="padding:5px 12px;border:1px solid #e5e5e5;">${jurisdiction}</td></tr>
</table>`;

  const paymentInstructions = `<div style="margin:16px 0;padding:14px;border:1px solid #ddd;border-left:3px solid #2563eb;background:#fafafa;">
  <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#333;margin-bottom:6px;">Payment Instructions</p>
  <p style="font-size:12px;color:#444;line-height:1.6;">Make checks payable to <strong>${companyName}</strong> and mail to:<br>${companyAddr || '[Company Address]'}</p>
  ${companyPhone ? `<p style="font-size:12px;color:#444;">Phone: ${companyPhone}</p>` : ''}
  ${companyEmail ? `<p style="font-size:12px;color:#444;">Email: ${companyEmail}</p>` : ''}
  <p style="font-size:11px;color:#666;margin-top:6px;">Please include your account reference <strong>${accountRef}</strong> with all correspondence and payments.</p>
</div>`;

  const fdcpaNotice = `<div style="margin:16px 0;padding:12px;border:1px solid #e5e5e5;background:#fffbf0;font-size:10px;color:#555;line-height:1.7;">
  <p style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Your Rights Under Federal Law</p>
  <p>Under the Fair Debt Collection Practices Act (15 U.S.C. &sect; 1692 et seq.), you have the right to:</p>
  <ul style="margin:6px 0;padding-left:20px;">
    <li>Dispute this debt in writing within thirty (30) days of receiving this notice.</li>
    <li>Request the name and address of the original creditor, if different from the current creditor.</li>
    <li>Request verification of the debt, including the amount owed and the name of the creditor.</li>
  </ul>
  <p>If you dispute this debt in writing within the 30-day period, ${companyName} will cease collection activities until verification has been provided to you. Unless you dispute this debt within 30 days after receipt of this notice, the debt will be assumed to be valid.</p>
</div>`;

  const LETTERS: Record<string, { title: string; accent: string; body: string }> = {
    reminder: {
      title: 'Payment Reminder',
      accent: '#2563eb',
      body: `<p>We are writing to remind you that the following account has a past-due balance that requires your attention.</p>
${accountRefBlock}
${summaryTable}
<p>Our records indicate that a payment of <strong>${fmtAmt(balanceDue)}</strong> was due on <strong>${dueDate}</strong> and remains unpaid as of the date of this letter. The account is now <strong>${daysOverdue} days past due</strong>.</p>
<p>We understand that oversights can occur. If you have already submitted payment, please disregard this notice and accept our thanks. If payment has not yet been sent, we kindly request that you remit the amount due at your earliest convenience to avoid additional fees or collection activity.</p>
${paymentInstructions}
<p>If you are experiencing financial difficulty and would like to discuss a payment arrangement, please contact us at ${companyPhone || companyEmail || 'the number on file'}. We are committed to working with you to resolve this matter amicably.</p>`,
    },
    warning: {
      title: 'Warning Notice — Second Notice',
      accent: '#d97706',
      body: `<p>Despite our previous correspondence dated on or about your original due date of ${dueDate}, the balance on your account remains unpaid. This letter serves as a <strong>formal warning</strong> that failure to resolve this matter may result in additional consequences.</p>
${accountRefBlock}
${summaryTable}
<p><strong>Please be advised that if payment is not received by ${thirtyDayDate}, the following actions may be taken:</strong></p>
<ul style="margin:12px 0;padding-left:24px;line-height:1.9;">
  <li>Assessment of additional late fees and collection costs as permitted by law</li>
  <li>Accrual of interest at a rate of ${interestRate} on the outstanding balance</li>
  <li>Referral of this account to a third-party collections agency</li>
  <li>Reporting of the delinquent account to one or more consumer credit reporting bureaus</li>
</ul>
<p>We strongly urge you to contact our office immediately to make payment or to arrange a mutually agreeable payment plan. This is your opportunity to resolve this debt before more serious measures are taken.</p>
${paymentInstructions}
${fdcpaNotice}`,
    },
    final_notice: {
      title: 'Final Notice Before Legal Action',
      accent: '#dc2626',
      body: `<p style="font-weight:700;color:#dc2626;font-size:14px;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">This is your final notice. Immediate action is required.</p>
<p>Multiple attempts have been made to resolve the outstanding balance on your account. As of the date of this letter, no payment or satisfactory response has been received. Your account is now <strong>${daysOverdue} days past due</strong>.</p>
${accountRefBlock}
${summaryTable}
<p><strong>Unless full payment of ${fmtAmt(balanceDue)} or a satisfactory payment arrangement is received by ${deadlineDate}, ${companyName} intends to pursue one or more of the following remedies without further notice:</strong></p>
<ul style="margin:12px 0;padding-left:24px;line-height:1.9;">
  <li>Filing a civil complaint in the appropriate court in ${jurisdiction}</li>
  <li>Seeking a monetary judgment for the full amount owed plus court costs, attorney fees, and accrued interest</li>
  <li>Pursuing post-judgment remedies including wage garnishment, bank levy, and/or property lien</li>
  <li>Reporting the delinquent account and any resulting judgment to all major credit bureaus</li>
  <li>Referral to an external collections agency or law firm for further action</li>
</ul>
<p>A judgment against you may remain on your credit report for up to seven (7) years and may affect your ability to obtain credit, housing, or employment.</p>
<p><strong>To avoid legal proceedings, please remit payment or contact us immediately to discuss resolution options.</strong></p>
${paymentInstructions}
${fdcpaNotice}`,
    },
    demand: {
      title: 'Formal Demand for Payment',
      accent: '#111',
      body: `<p style="font-weight:700;">RE: DEMAND FOR PAYMENT — ${accountRef}</p>
<p>This letter constitutes a formal demand for payment pursuant to the laws of ${jurisdiction}. Please treat this correspondence with the utmost seriousness.</p>
${accountRefBlock}
${summaryTable}
<p>The above-referenced debt arises from an obligation originally in the amount of <strong>${fmtAmt(originalAmt)}</strong>, which became due and payable on <strong>${dueDate}</strong>. Despite the passage of <strong>${daysOverdue} days</strong> since the date of delinquency, the obligation remains unsatisfied. Interest continues to accrue at a rate of <strong>${interestRate}</strong> until the balance is paid in full.</p>
<p><strong>DEMAND:</strong> You are hereby demanded to pay the total sum of <strong>${fmtAmt(balanceDue)}</strong> within <strong>ten (10) calendar days</strong> of the date of this letter (i.e., by <strong>${deadlineDate}</strong>).</p>
<p><strong>CONSEQUENCES OF NON-PAYMENT:</strong> If payment is not received by the above deadline, ${companyName} reserves the right to, and intends to, commence legal proceedings against you in a court of competent jurisdiction in ${jurisdiction} to recover the full amount owed, together with:</p>
<ul style="margin:12px 0;padding-left:24px;line-height:1.9;">
  <li>Pre-judgment and post-judgment interest at the maximum rate permitted by law</li>
  <li>Court costs, filing fees, and service of process expenses</li>
  <li>Reasonable attorney fees as permitted by contract or statute</li>
  <li>All additional collection costs and administrative expenses</li>
</ul>
<p>This letter may be tendered as evidence of demand in any subsequent legal proceeding.</p>
${paymentInstructions}
${fdcpaNotice}`,
    },
    settlement_offer: {
      title: 'Settlement Offer',
      accent: '#0891b2',
      body: `<p>In an effort to resolve the outstanding balance on your account without the need for further collection activity or legal proceedings, ${companyName} is prepared to offer the following settlement.</p>
${accountRefBlock}
${summaryTable}
<p style="padding:14px;border:2px solid #0891b2;background:#f0fdfa;text-align:center;margin:16px 0;">
  <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#0891b2;font-weight:700;">Settlement Amount</span>
  <span style="display:block;font-size:24px;font-weight:800;color:#111;margin:4px 0;">${fmtAmt(settlementAmt)}</span>
  <span style="display:block;font-size:12px;color:#555;">(${Math.round((settlementAmt / balanceDue) * 100)}% of current balance — a savings of ${fmtAmt(balanceDue - settlementAmt)})</span>
</p>
<p><strong>Terms of this offer:</strong></p>
<ul style="margin:12px 0;padding-left:24px;line-height:1.9;">
  <li>Payment of <strong>${fmtAmt(settlementAmt)}</strong> must be received in full by <strong>${thirtyDayDate}</strong>.</li>
  <li>Payment must be made by certified check, cashier's check, or wire transfer.</li>
  <li>Upon receipt of payment, ${companyName} will consider this account <strong>settled in full</strong> and cease all further collection activity.</li>
  <li>A written confirmation of settlement will be provided within ten (10) business days of payment.</li>
  <li>This offer is made without prejudice and does not constitute an admission that the balance owed is less than the full amount.</li>
</ul>
<p><strong>This offer expires on ${thirtyDayDate}.</strong> If payment is not received by that date, the offer is automatically withdrawn and the full balance of <strong>${fmtAmt(balanceDue)}</strong> will remain due and subject to continued collection activity, including legal action.</p>
${paymentInstructions}
<p style="font-size:11px;color:#666;">To accept this offer, please remit payment referencing account <strong>${accountRef}</strong> and write "Settlement" on the memo line of your check.</p>`,
    },
    payment_confirmation: {
      title: 'Payment Confirmation & Account Update',
      accent: '#16a34a',
      body: `<p>We are writing to confirm receipt of your recent payment and to provide an updated summary of your account.</p>
${accountRefBlock}
<div style="padding:14px;border:2px solid #16a34a;background:#f0fdf4;text-align:center;margin:16px 0;">
  <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#16a34a;font-weight:700;">Payment Received</span>
  <span style="display:block;font-size:24px;font-weight:800;color:#111;margin:4px 0;">${fmtAmt(totalPaid)}</span>
  <span style="display:block;font-size:12px;color:#555;">Applied to your account on ${todayLong}</span>
</div>
${summaryTable}
${balanceDue <= 0
  ? `<p style="font-weight:700;color:#16a34a;">Your account balance is now <strong>$0.00</strong>. This account is considered <strong>paid in full</strong>.</p>
<p>Thank you for resolving this matter. No further action is required on your part. If you require a formal payoff letter or receipt for your records, please contact our office and we will provide one promptly.</p>`
  : `<p>Thank you for your payment. Please note that a remaining balance of <strong>${fmtAmt(balanceDue)}</strong> is still outstanding on this account.</p>
<p>Interest continues to accrue at a rate of <strong>${interestRate}</strong> on the unpaid balance. We encourage you to remit the remaining balance as soon as possible to avoid additional charges and to bring your account to good standing.</p>
<p>If you would like to set up a payment plan for the remaining balance, please contact us at ${companyPhone || companyEmail || 'the number on file'} to discuss available options.</p>`}
${paymentInstructions}
<p style="font-size:11px;color:#666;">Please retain this letter for your records. If you believe there is a discrepancy in the payment amount or account balance shown above, contact our office within ten (10) business days.</p>`,
    },
  };

  const letter = LETTERS[letterType] || LETTERS.reminder;

  const remitSlip = `<div class="legal-remit">
  <div class="remit-tear">&#9986; &nbsp; D E T A C H &nbsp; A N D &nbsp; R E T U R N &nbsp; W I T H &nbsp; P A Y M E N T &nbsp; &#9986;</div>
  <table>
    <tr><td style="width:55%;"><strong>Remit To:</strong><br>${companyName}<br>${companyAddr || ''}</td>
        <td style="vertical-align:top;"><strong>From:</strong><br>${debtorName}<br>${debtorAddr || ''}</td></tr>
    <tr><td><strong>Account Reference:</strong> ${accountRef}</td>
        <td><strong>Amount Enclosed:</strong> $ ____________________</td></tr>
    <tr><td><strong>Balance Due:</strong> ${fmtAmt(balanceDue)}</td>
        <td><strong>Date:</strong> ____________________</td></tr>
  </table>
  <p style="font-size:9.5pt;color:#444;margin-top:8px;font-style:italic;">Make checks payable to ${companyName}. Write account reference ${accountRef} on the memo line.</p>
</div>`;

  const paymentOptions = `<div class="legal-notice">
  <div class="ln-heading">Payment Options</div>
  <p style="text-indent:0;margin:4px 0;"><strong>By Mail:</strong> Send check or money order to ${companyName}, ${companyAddr || '[Company Address]'}.</p>
  <p style="text-indent:0;margin:4px 0;"><strong>By ACH / Bank Transfer:</strong> Contact our office${companyPhone ? ' at ' + companyPhone : ''} for routing instructions.</p>
  <p style="text-indent:0;margin:4px 0;"><strong>Online:</strong> Visit our payment portal or contact us${companyEmail ? ' at ' + companyEmail : ''} for the secure payment link.</p>
</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(letter.title)} — ${debtorName}</title><style>
${baseStyles}
@page { size: letter; margin: 1in; }
body { background: #fff; }
.legal-wrap { max-width: 6.5in; margin: 0 auto; }
.cl-title { font-family: Georgia, 'Times New Roman', serif; font-size: 13pt; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #000; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 8px 0; margin: 16px 0 22px; text-align: center; }
.cl-body { font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.7; color: #111; }
.cl-body p { margin-bottom: 12px; }
.cl-body ul { margin: 10px 0 14px; padding-left: 28px; }
.cl-body ul li { margin-bottom: 4px; }
</style></head><body>
<div class="legal-page legal-wrap">
  <div class="legal-letterhead">
    <div class="lh-name">${companyName}</div>
    <div class="lh-rule"></div>
    <div class="lh-meta">
      ${companyAddr || ''}${companyPhone ? ` &middot; Tel: ${companyPhone}` : ''}${companyEmail ? ` &middot; ${companyEmail}` : ''}
    </div>
  </div>

  <div class="legal-date">${todayLong}<br><span style="font-size:10pt;font-style:italic;">Account Reference: ${accountRef}</span></div>

  <div class="legal-recipient">
    <strong>${debtorName}</strong><br>
    ${debtorAddr || ''}
  </div>

  <div class="cl-title">${esc(letter.title)}</div>

  <div class="cl-body">
    <p>Dear ${debtorName}:</p>
    ${letter.body}
  </div>

  ${paymentOptions}

  <div class="legal-mini-miranda">
    This communication is from a debt collector. This is an attempt to collect a debt and any information obtained will be used for that purpose.
  </div>

  <div class="legal-signature">
    <p style="margin-top:22px;">Sincerely,</p>
    <div class="legal-sig-line"></div>
    <div class="legal-sig-name">${companyName}</div>
    <div class="legal-sig-title">Collections Department</div>
  </div>

  <div class="legal-confidential-footer">
    This communication may contain privileged or confidential information intended solely for the addressee.
  </div>

  ${remitSlip}
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
      rejected: '#dc2626', draft: '#475569',
    };
    const c = colors[status?.toLowerCase()] || '#64748b';
    return `<span style="font-size:10px;font-weight:600;color:${c};text-transform:uppercase;letter-spacing:0.5px;">${status || '—'}</span>`;
  };

  const expenseRows = expenses.map(e => {
    const mainRow = `<tr>
      <td>${fmtDate(e.date)}</td>
      <td>${esc(e.description) || '\u2014'}</td>
      <td>${esc(e.vendor_name) || '\u2014'}</td>
      <td>${esc(e.category_name) || '\u2014'}</td>
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
                <td style="padding:3px 8px;font-size:11px;color:#475569;border-bottom:1px solid #f1f5f9;">${esc(li.description) || '\u2014'}</td>
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

  // Compute stats
  const totalTax = expenses.reduce((s, e) => s + (Number(e.tax_amount) || 0), 0);
  const avgExpense = expenses.length > 0 ? grandTotal / expenses.length : 0;

  // Category breakdown
  const catTotals: Record<string, number> = {};
  expenses.forEach(e => { const c = e.category_name || 'Uncategorized'; catTotals[c] = (catTotals[c] || 0) + (Number(e.amount) || 0); });
  const topCategories = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCat = Math.max(...topCategories.map(([, v]) => v), 1);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${baseStyles}
</style></head>
<body>
<div class="rpt-page">
  ${reportHeader(companyName, 'Expense Detail Report', dateRange)}

  <!-- Stats -->
  <div class="rpt-stats">
    <div class="rpt-stat" style="border-left:3px solid #dc2626;">
      <div class="rpt-stat-label">Grand Total</div>
      <div class="rpt-stat-val" style="color:#dc2626;">${fmt(grandTotal)}</div>
    </div>
    <div class="rpt-stat" style="border-left:3px solid #0f172a;">
      <div class="rpt-stat-label">Transactions</div>
      <div class="rpt-stat-val">${expenses.length}</div>
    </div>
    <div class="rpt-stat" style="border-left:3px solid #64748b;">
      <div class="rpt-stat-label">Average</div>
      <div class="rpt-stat-val">${fmt(avgExpense)}</div>
    </div>
    <div class="rpt-stat" style="border-left:3px solid #eab308;">
      <div class="rpt-stat-label">Total Tax</div>
      <div class="rpt-stat-val">${fmt(totalTax)}</div>
    </div>
  </div>

  <!-- Top Categories Mini-Chart -->
  ${topCategories.length > 0 ? `
  <div class="rpt-section rpt-section-alt">Top Categories</div>
  <div style="padding:8px 0 16px;">
    ${topCategories.map(([cat, amount]) => {
      const pct = maxCat > 0 ? (amount / maxCat) * 100 : 0;
      return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0;">
        <span style="width:120px;font-size:10px;font-weight:600;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(cat)}</span>
        <div style="flex:1;height:14px;background:#f1f5f9;">
          <div style="height:100%;width:${pct}%;background:#ef4444;opacity:0.7;"></div>
        </div>
        <span style="width:80px;text-align:right;font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,monospace;">${fmt(amount)}</span>
      </div>`;
    }).join('')}
  </div>
  ` : ''}

  <!-- Detail Table -->
  <div class="rpt-section">Transaction Detail</div>
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

  <!-- Grand Total -->
  <div class="no-break" style="margin-top:16px;">
    <div class="rpt-section" style="background:#7f1d1d;margin-top:0;">Total</div>
    <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#fef2f2;font-size:13px;">
      <span style="font-weight:800;color:#0f172a;">Grand Total (${expenses.length} transactions)</span>
      <span style="font-weight:800;color:#dc2626;font-variant-numeric:tabular-nums;font-family:'SF Mono',Menlo,monospace;">${fmt(grandTotal)}</span>
    </div>
  </div>

  ${reportFooter(companyName)}
</div>
</body></html>`;
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

  const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cfmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);
  const dfmt = (d: string) => {
    if (!d) return '\u2014';
    const s = String(d);
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
    if (isNaN(dt.getTime())) return '\u2014';
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const caseRef = debt.id ? String(debt.id).substring(0, 8).toUpperCase() : 'N/A';
  const generatedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const companyName = esc(company?.name || 'Company');

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

  const tableHead = (cols: string[]) => `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
  const td = (v: any) => `<td>${esc(v)}</td>`;
  const noRecords = '<p style="color:#888;font-style:italic;margin:12px 0;">No records available.</p>';

  const sectionHeader = (n: number, title: string, count: number) =>
    `<div class="section" id="section-${n}">
      <h2 style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;color:#111;">SECTION ${n}: ${esc(title)}</h2>
      <div style="font-size:11px;color:#666;margin-bottom:8px;">(${count} item${count !== 1 ? 's' : ''})</div>
      <hr style="border:none;border-top:2px solid #333;margin-bottom:16px;">`;

  // ── Section 1: Account Summary ──
  const section1 = `${sectionHeader(1, 'Account Summary', 1)}
    <table><tbody>
      <tr><td style="font-weight:700;width:40%;">Debtor Name</td>${td(debt.debtor_name)}</tr>
      <tr><td style="font-weight:700;">Original Amount</td><td>${cfmt(debt.original_amount)}</td></tr>
      <tr><td style="font-weight:700;">Accrued Interest</td><td>${cfmt(debt.interest_accrued)}</td></tr>
      <tr><td style="font-weight:700;">Fees &amp; Costs</td><td>${cfmt(debt.fees_accrued)}</td></tr>
      <tr><td style="font-weight:700;">Payments Applied</td><td>${cfmt(debt.payments_made)}</td></tr>
      <tr><td style="font-weight:700;">Balance Due</td><td style="font-weight:700;color:#b91c1c;">${cfmt(debt.balance_due)}</td></tr>
      <tr><td style="font-weight:700;">Due Date</td>${td(dfmt(debt.due_date))}</tr>
      <tr><td style="font-weight:700;">Delinquent Date</td>${td(dfmt(debt.delinquent_date))}</tr>
      <tr><td style="font-weight:700;">Jurisdiction</td>${td(debt.jurisdiction || 'N/A')}</tr>
      <tr><td style="font-weight:700;">Interest Rate</td><td>${debt.interest_rate ? (Number(debt.interest_rate) * 100).toFixed(2) + '%' : 'N/A'}</td></tr>
      <tr><td style="font-weight:700;">Interest Type</td>${td(debt.interest_type || 'N/A')}</tr>
    </tbody></table>
  </div>`;

  // ── Section 2: Communication Log ──
  const section2 = `${sectionHeader(2, 'Communication Log', communications.length)}
    ${communications.length === 0 ? noRecords : `<table>${tableHead(['Date', 'Type', 'Direction', 'Subject', 'Outcome'])}
    <tbody>${communications.map(c => `<tr>${td(dfmt(c.logged_at))}${td(c.type)}${td(c.direction)}${td(c.subject)}${td(c.outcome)}</tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 3: Payment History ──
  const section3 = `${sectionHeader(3, 'Payment History', payments.length)}
    ${payments.length === 0 ? noRecords : `<table>${tableHead(['Date', 'Amount', 'Method', 'Reference', 'Applied To'])}
    <tbody>${payments.map(p => `<tr>${td(dfmt(p.received_date))}<td>${cfmt(p.amount)}</td>${td(p.method)}${td(p.reference_number)}${td(p.applied_to)}</tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 4: Evidence Inventory ──
  const section4 = `${sectionHeader(4, 'Evidence Inventory', evidence.length)}
    ${evidence.length === 0 ? noRecords : `<table>${tableHead(['Type', 'Title', 'Court Relevance', 'Date', 'Description'])}
    <tbody>${evidence.map(e => `<tr>${td(e.evidence_type)}${td(e.title)}${td(e.court_relevance)}${td(dfmt(e.date_of_evidence))}<td>${esc(String(e.description || '').substring(0, 120))}${(e.description || '').length > 120 ? '&hellip;' : ''}</td></tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 5: FDCPA/TCPA Compliance Timeline ──
  const section5 = `${sectionHeader(5, 'FDCPA/TCPA Compliance Timeline', compliance.length)}
    ${compliance.length === 0 ? noRecords : `<table>${tableHead(['Date', 'Event Type', 'Notes'])}
    <tbody>${compliance.map(c => `<tr>${td(dfmt(c.event_date))}${td(c.event_type)}${td(c.notes)}</tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 6: Chain of Custody (Audit Trail) ──
  const section6 = `${sectionHeader(6, 'Chain of Custody (Audit Trail)', auditLog.length)}
    ${auditLog.length === 0 ? noRecords : `<table>${tableHead(['Timestamp', 'Action', 'Field', 'Old Value', 'New Value', 'Performed By'])}
    <tbody>${auditLog.map(a => `<tr>${td(dfmt(a.performed_at))}${td(a.action)}${td(a.field_name)}${td(a.old_value)}${td(a.new_value)}${td(a.performed_by)}</tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 7: Settlement History ──
  const section7 = `${sectionHeader(7, 'Settlement History', settlements.length)}
    ${settlements.length === 0 ? noRecords : `<table>${tableHead(['Date', 'Offer Amount', 'Response', 'Counter Amount', 'Accepted Date'])}
    <tbody>${settlements.map(s => `<tr>${td(dfmt(s.created_at))}<td>${cfmt(s.offer_amount)}</td>${td(s.response)}${s.counter_amount ? `<td>${cfmt(s.counter_amount)}</td>` : td('')}${td(dfmt(s.accepted_date))}</tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 8: Contact Directory ──
  const section8 = `${sectionHeader(8, 'Contact Directory', contacts.length)}
    ${contacts.length === 0 ? noRecords : `<table>${tableHead(['Role', 'Name', 'Email', 'Phone', 'Company'])}
    <tbody>${contacts.map(c => `<tr>${td(c.role)}${td(c.name)}${td(c.email)}${td(c.phone)}${td(c.company_name)}</tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 9: Dispute History ──
  const section9 = `${sectionHeader(9, 'Dispute History', disputes.length)}
    ${disputes.length === 0 ? noRecords : `<table>${tableHead(['Date', 'Reason', 'Status', 'Resolution'])}
    <tbody>${disputes.map(d => `<tr>${td(dfmt(d.created_at))}${td(d.reason)}${td(d.status)}${td(d.resolution)}</tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 10: Legal Actions ──
  const section10 = `${sectionHeader(10, 'Legal Actions', legalActions.length)}
    ${legalActions.length === 0 ? noRecords : `<table>${tableHead(['Type', 'Status', 'Court', 'Case Number', 'Hearing Date'])}
    <tbody>${legalActions.map(l => `<tr>${td(l.action_type)}${td(l.status)}${td(l.court_name)}${td(l.case_number)}${td(dfmt(l.hearing_date))}</tr>`).join('')}</tbody></table>`}
  </div>`;

  // ── Section 11: Generation Certificate ──
  const section11 = `${sectionHeader(11, 'Generation Certificate', 1)}
    <div style="border:2px solid #333;padding:24px;margin:12px 0;">
      <p style="margin-bottom:12px;">This document was generated on <strong>${generatedDate}</strong> from the business records of <strong>${companyName}</strong>. Records are maintained in the regular course of business by persons with knowledge of the recorded acts.</p>
      <p style="margin-bottom:12px;">The information contained herein is a true and accurate representation of the records as stored in the electronic database at the time of generation.</p>
      <div style="margin-top:36px;border-top:1px solid #333;width:50%;padding-top:8px;font-size:11px;color:#666;">Authorized Signature / Date</div>
    </div>
  </div>`;

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
  const jurisdiction = esc(debt?.jurisdiction || '________________');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Court Packet — ${esc(debt.debtor_name)}</title>
<style>
${baseStyles}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #111; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html { counter-reset: bates; }
  @page {
    size: letter;
    margin: 1in 1in 1.1in 1in;
    @bottom-right { content: "BAP-" counter(bates, decimal-leading-zero); font-family: 'SF Mono', Menlo, monospace; font-size: 9pt; color: #333; }
    @bottom-left { content: "Confidential — Prepared for Legal Proceedings"; font-family: Georgia, serif; font-size: 8.5pt; color: #555; font-style: italic; }
  }
  body { counter-increment: bates; }
  @media print {
    .section { page-break-before: always; counter-increment: bates; }
    .cover { page-break-after: always; counter-increment: bates; }
    .ex-cover-page { counter-increment: bates; }
    tr { page-break-inside: avoid; break-inside: avoid; orphans: 3; widows: 3; }
    thead { display: table-header-group; }
    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
    p { orphans: 3; widows: 3; }
  }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; table-layout: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { padding: 7px 10px; text-align: left; border: 1px solid #555; font-size: 10.5pt; word-wrap: break-word; overflow-wrap: anywhere; font-family: Georgia, 'Times New Roman', serif; }
  th { background: #ececec; font-weight: 700; text-transform: uppercase; font-size: 9.5pt; letter-spacing: 0.6px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  .court-cover { text-align: center; padding-top: 0.5in; font-family: Georgia, 'Times New Roman', serif; }
  .court-caption { border-top: 3px double #000; border-bottom: 3px double #000; padding: 16px 0; margin-bottom: 36px; }
  .court-caption .court-name { font-weight: 700; text-transform: uppercase; letter-spacing: 2px; font-size: 12pt; }
  .court-caption .case-line { font-style: italic; font-size: 11pt; margin-top: 6px; }
  .cover h1 { font-size: 26pt; font-weight: 700; letter-spacing: 5px; margin: 36px 0 14px; text-transform: uppercase; }
  .cover .subtitle { font-size: 13pt; color: #333; margin-bottom: 8px; font-style: italic; }
  .cover .meta { font-size: 12pt; color: #222; margin-bottom: 4px; }
  .cover .confidential { margin-top: 60px; font-size: 11pt; font-weight: 700; letter-spacing: 2px; color: #000; text-transform: uppercase; border: 2px solid #000; display: inline-block; padding: 8px 20px; }
  .exhibit-list { margin: 36px auto; max-width: 5in; text-align: left; border: 1px solid #000; padding: 18px 22px; }
  .exhibit-list h3 { font-size: 12pt; text-transform: uppercase; letter-spacing: 2px; text-align: center; margin-bottom: 10px; border-bottom: 1px solid #000; padding-bottom: 6px; }
  .exhibit-list .ex-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11pt; border-bottom: 1px dotted #aaa; }
  .exhibit-list .ex-row:last-child { border-bottom: none; }
  .exhibit-list .ex-letter { font-weight: 700; width: 1.2in; }
  .ex-cover-page { text-align: center; padding-top: 2.8in; page-break-before: always; page-break-after: always; }
  .ex-cover-page .ex-tab { display: inline-block; border: 4px solid #000; padding: 26px 56px; font-size: 64pt; font-weight: 700; letter-spacing: 10px; font-family: Georgia, 'Times New Roman', serif; }
  .ex-cover-page .ex-label { font-size: 16pt; text-transform: uppercase; letter-spacing: 4px; margin-top: 28px; font-style: italic; }
  .bates-footer { position: fixed; bottom: 0.4in; right: 0.7in; font-size: 9pt; color: #333; font-variant-numeric: tabular-nums; font-family: 'SF Mono', Menlo, monospace; }
  .court-conf-footer { position: fixed; bottom: 0.4in; left: 0.7in; font-size: 8.5pt; color: #555; font-style: italic; font-family: Georgia, serif; }
</style></head><body>

<div class="bates-footer">BAP-${caseRef.padStart(6, '0')}</div>
<div class="court-conf-footer">Confidential — Prepared for Legal Proceedings</div>

<div class="cover">
  <div class="court-caption">
    <div class="court-name">In the Court of Competent Jurisdiction</div>
    <div class="court-name" style="margin-top:4px;">${jurisdiction}</div>
    <div class="case-line" style="margin-top:14px;">${companyName},<br><span style="font-size:10pt;font-style:normal;">Plaintiff,</span></div>
    <div style="text-align:center;margin:6px 0;font-style:italic;">vs.</div>
    <div class="case-line">${esc(debt.debtor_name)},<br><span style="font-size:10pt;font-style:normal;">Defendant.</span></div>
    <div style="margin-top:14px;font-size:10pt;">Case Ref. No. BAP-${caseRef}</div>
  </div>
  <h1>Court Packet</h1>
  <div class="subtitle">Bates-Numbered Evidentiary Bundle</div>
  <div class="meta" style="margin-top:18px;">Compiled by: <strong>${companyName}</strong></div>
  <div class="meta">Date of Compilation: ${generatedDate}</div>

  <div class="exhibit-list">
    <h3>List of Exhibits</h3>
    ${exhibits.map(ex => `<div class="ex-row"><span class="ex-letter">Exhibit ${ex.letter}</span><span>${esc(ex.title)}</span></div>`).join('')}
  </div>

  <!-- Feature #11: exhibit thumbnail contact-sheet strip -->
  <div style="margin:24px auto 0;max-width:6.5in;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;page-break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    ${exhibits.map(ex => `
      <div style="border:1.5px solid #000;padding:10px 6px 8px;text-align:center;background:#fafaf6;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:22pt;font-weight:700;letter-spacing:3px;border:2px solid #000;padding:6px 0;margin-bottom:6px;background:#fff;">${ex.letter}</div>
        <div style="font-family:Georgia,serif;font-size:7.5pt;line-height:1.25;color:#222;min-height:2.4em;">${esc(ex.title)}</div>
      </div>
    `).join('')}
  </div>

  <div class="confidential">Confidential &mdash; For Legal Proceedings Only</div>
</div>

${[section1, section2, section3, section4, section5, section6, section7, section8, section9, section10, section11].map((s, i) => `
<div class="ex-cover-page">
  <div class="ex-tab">${exhibits[i].letter}</div>
  <div class="ex-label">Exhibit ${exhibits[i].letter}</div>
  <div class="ex-label" style="font-size:13pt;letter-spacing:2px;font-style:normal;margin-top:8px;">${esc(exhibits[i].title)}</div>
</div>
${s}`).join('')}

</body></html>`;
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

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Affidavit of Debt Verification</title><style>
${baseStyles}
@page { size: letter; margin: 1in; }
body { background: #fff; }
.legal-wrap { max-width: 6.5in; margin: 0 auto; }
</style></head><body>
<div class="legal-page legal-wrap">

  <div class="legal-caption">
    <div class="cap-state">STATE OF ${stateName}</div>
    <div class="cap-state">COUNTY OF ${countyName}</div>
    <div class="cap-title">Affidavit of Debt Verification</div>
    <div style="font-size:10pt;font-style:italic;margin-top:6px;">Account No. ${acctNum}</div>
  </div>

  <p style="margin-bottom:18px;">BEFORE ME, the undersigned authority, personally appeared <strong>${sigName}</strong>, who, being first duly sworn upon oath, deposes and states as follows:</p>

  <div class="legal-numbered">
    <p class="lp">I am the ${sigTitle} of ${companyName}, with its principal place of business located at ${companyAddr || '________________'}. I am over the age of eighteen (18) years and competent to testify to the matters set forth herein.</p>

    <p class="lp">I am authorized to make this Affidavit on behalf of ${companyName}, and the statements set forth herein are made upon my personal knowledge derived from the business records of ${companyName} maintained in the regular and ordinary course of its business.</p>

    <p class="lp">The records of ${companyName} are made at or near the time of the events recorded by, or from information transmitted by, persons with knowledge of those events; such records are kept in the course of regularly conducted business activity, and the making of such records is a regular practice of that business activity, satisfying the business records exception to the rule against hearsay under <em>Fed. R. Evid. 803(6)</em>.</p>

    <p class="lp">The records of ${companyName} reflect that <strong>${debtorName}</strong> ("Debtor") is indebted to ${companyName} in connection with Account No. ${acctNum}, and as of ${todayLong} the indebtedness is itemized as follows:</p>
  </div>

  <table class="legal-amount-table">
    <tbody>
      <tr><td>Original Principal Amount</td><td class="amt">${fmtAmt(debt?.original_amount)}</td></tr>
      <tr><td>Interest Accrued</td><td class="amt">${fmtAmt(debt?.interest_accrued)}</td></tr>
      <tr><td>Fees and Charges Accrued</td><td class="amt">${fmtAmt(debt?.fees_accrued)}</td></tr>
      <tr><td>Payments Received and Applied</td><td class="amt">(${fmtAmt(debt?.payments_made)})</td></tr>
      <tr class="total"><td>TOTAL AMOUNT DUE AND OWING</td><td class="amt">${fmtAmt(debt?.balance_due)}</td></tr>
    </tbody>
  </table>

  ${(() => {
    // ── Feature #20: chronological event ribbon ──
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
    const times = valid.map(e => new Date(e.date + 'T12:00:00').getTime());
    const min = Math.min(...times), max = Math.max(...times);
    const span = Math.max(1, max - min);
    return `<div style="margin:14px 0 18px;padding:14px 18px;border:1px solid #000;background:#fafaf6;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;">
      <div style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#222;margin-bottom:10px;font-family:Georgia,serif;">Chronology</div>
      <div style="position:relative;height:36px;margin:0 12px;">
        <div style="position:absolute;left:0;right:0;top:14px;height:2px;background:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        ${valid.map((e, i) => {
          const t = new Date(e.date + 'T12:00:00').getTime();
          const pct = ((t - min) / span) * 100;
          const isLast = i === valid.length - 1;
          return `<div style="position:absolute;left:${pct.toFixed(1)}%;top:8px;transform:translateX(-50%);text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
            <div style="width:14px;height:14px;border-radius:50%;background:${isLast ? '#dc2626' : '#000'};border:2px solid #fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0 auto;"></div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:8.5pt;color:#333;margin-top:4px;font-family:Georgia,serif;">
        ${valid.map(e => `<div style="text-align:center;flex:1;"><div style="font-weight:700;">${esc(e.label)}</div><div style="font-style:italic;">${esc(new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }))}</div></div>`).join('')}
      </div>
    </div>`;
  })()}

  <div class="legal-numbered" style="counter-reset: legalpara 4;">
    <p class="lp">Demand has been duly made upon the Debtor for the payment of said indebtedness; however, no portion of said indebtedness has been paid except as credited above, and the entire balance set forth above remains due, owing, and unpaid.</p>

    <p class="lp">${companyName} is the lawful owner and holder of the debt described herein, and no other person or entity has any interest in or claim to said debt.</p>

    <p class="lp">I declare under penalty of perjury under the laws of the State of ${stateName} that the foregoing is true and correct.</p>
  </div>

  <p style="margin-top:30px;">FURTHER AFFIANT SAYETH NAUGHT.</p>

  <div class="legal-signature">
    <div class="legal-sig-line"></div>
    <div class="legal-sig-name">${sigName}</div>
    <div class="legal-sig-title">${sigTitle}, ${companyName}</div>
  </div>

  <div class="legal-jurat">
    <div class="seal-box">[NOTARY<br>SEAL]</div>
    <div class="jurat-title">Jurat</div>
    <p style="text-indent:0;">STATE OF <span class="jurat-blank">${stateName}</span></p>
    <p style="text-indent:0;">COUNTY OF <span class="jurat-blank">${countyName}</span></p>
    <p style="text-indent:0;margin-top:10px;">Subscribed and sworn to (or affirmed) before me this <span class="jurat-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> day of <span class="jurat-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>, 20<span class="jurat-blank">&nbsp;&nbsp;&nbsp;</span>, by ${sigName}, who is personally known to me or who has produced satisfactory identification.</p>
    <div style="margin-top:36px;clear:both;">
      <div style="border-top: 1px solid #000; width: 280px; padding-top: 4px;">
        Notary Public — Signature
      </div>
      <p style="text-indent:0;margin-top:8px;">Printed Name: <span class="jurat-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
      <p style="text-indent:0;">My Commission Expires: <span class="jurat-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
    </div>
  </div>

  <div class="legal-confidential-footer">
    This communication may contain privileged or confidential information intended solely for the addressee.
  </div>
</div></body></html>`;
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
  const accountMap = new Map<string, { code?: string; name?: string }>();
  (accounts || []).forEach(a => accountMap.set(a.id, a));

  const total = Number(bill.total || 0);
  const paid = Number(bill.amount_paid || 0);
  const balance = total - paid;
  const subtotal = Number(bill.subtotal || 0);
  const tax = Number(bill.tax_amount || 0);

  const stamp = getStatusStamp(bill.status);
  const statusColor =
    bill.status === 'paid' ? '#16a34a' :
    bill.status === 'overdue' ? '#dc2626' :
    bill.status === 'partial' ? '#d97706' :
    bill.status === 'draft' ? '#475569' : '#2563eb';

  const logoHTML = safeImg(settings?.logo_data || null, esc(company?.name || ''),
    'max-height:42px;max-width:160px;object-fit:contain;margin-bottom:6px;');

  // ── Feature #17: 1099 eligible badge ──
  const is1099 = !!(vendor?.is_1099_eligible || vendor?.vendor_1099 || vendor?.requires_1099);
  const badge1099 = is1099
    ? `<div style="display:inline-block;margin-top:6px;padding:3px 8px;background:#fef3c7;color:#92400e;border:1.5px solid #b45309;font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact;">1099 Eligible</div>`
    : '';

  const vendorBlock = `
    <div class="fd-addr-card">
      <div class="fd-addr-lbl">Bill From</div>
      <div class="fd-addr-name">${esc(vendor?.name || 'Vendor')}</div>
      <div class="fd-addr-detail">
        ${addrLines([vendor?.address_line1, vendor?.address_line2,
          [vendor?.city, vendor?.state, vendor?.zip].filter(Boolean).join(', ') || null])}
        ${vendor?.email ? `<div>${esc(vendor.email)}</div>` : ''}
        ${vendor?.phone ? `<div>${esc(vendor.phone)}</div>` : ''}
      </div>
      ${badge1099}
    </div>`;

  const companyBlock = `
    <div class="fd-addr-card">
      <div class="fd-addr-lbl">Bill To</div>
      <div class="fd-addr-name">${esc(company?.name || 'Company')}</div>
      <div class="fd-addr-detail">
        ${addrLines([company?.address_line1, company?.address_line2,
          [company?.city, company?.state, company?.zip].filter(Boolean).join(', ') || null])}
        ${company?.email ? `<div>${esc(company.email)}</div>` : ''}
        ${company?.phone ? `<div>${esc(company.phone)}</div>` : ''}
      </div>
    </div>`;

  const rows = (lineItems || []).map((l: any) => {
    const qty = Number(l.quantity || 0);
    const unit = Number(l.unit_price || 0);
    const amt = Number(l.amount ?? qty * unit);
    const acctId = l.expense_account_id || l.account_id || '';
    const acct = acctId ? accountMap.get(acctId) : null;
    const acctLabel = acct ? esc(acct.code || acct.name || '') : '';
    return `<tr>
      <td>${esc(l.description || '')}</td>
      <td class="text-right">${qty}</td>
      <td class="text-right">${fmt(unit)}</td>
      <td class="text-right" style="font-size:10px;color:#64748b;">${acctLabel}</td>
      <td class="text-right font-bold" style="color:#0f172a;">${fmt(amt)}</td>
    </tr>`;
  }).join('');

  const created = bill.created_at ? fmtDateMaybe(bill.created_at) : '';
  const generated = new Date().toLocaleString('en-US');

  // ── Feature #5: bill account allocation visual ──
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
  const allocPalette = ['#0f766e', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#65a30d'];
  const allocationHTML = allocEntries.length > 1
    ? `<div style="margin-top:12px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <div class="section-label" style="margin-bottom:6px;">Account Allocation</div>
        ${stackedBar(allocEntries.map((e, i) => ({ value: e.total, color: allocPalette[i % allocPalette.length], label: e.label })), 14)}
      </div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${esc(bill.bill_number || '')}</title>
<style>${baseStyles}${stamp ? statusStampCSS(stamp.color) : ''}</style></head>
<body><div class="rpt-page" style="padding:32px 36px;">
${stamp ? `<div class="status-stamp">${stamp.label}</div>` : ''}
<div class="fd-letterhead">
  <div class="fd-letterhead-left">
    ${logoHTML}
    <div class="fd-co-name" style="font-size:14px;">${esc(company?.name || 'Company')}</div>
    <div class="fd-co-line">${esc([company?.address_line1, company?.city, company?.state].filter(Boolean).join(' · '))}</div>
  </div>
  <div class="fd-letterhead-right">
    <div class="fd-doc-type" style="font-size:22px;">Vendor Bill</div>
    <div class="fd-doc-num">${esc(bill.bill_number || '')}${statusBadgeInline((bill.status || '').toUpperCase(), statusColor)}</div>
    <div class="fd-doc-date">${esc(fmtDateMaybe(bill.bill_date || bill.issue_date))}</div>
    ${bill.due_date ? `<div class="fd-doc-date">Due ${esc(fmtDateMaybe(bill.due_date))}</div>` : ''}
  </div>
</div>

<div class="fd-addr-grid">
  ${vendorBlock}
  ${companyBlock}
</div>

<table style="margin-top:8px;">
  <thead>
    <tr>
      <th>Description</th>
      <th class="text-right">Qty</th>
      <th class="text-right">Unit Price</th>
      <th class="text-right">Account</th>
      <th class="text-right">Amount</th>
    </tr>
  </thead>
  <tbody>${rows || `<tr class="fd-empty-row"><td colspan="5">(no line items)</td></tr>`}</tbody>
</table>

${allocationHTML}

<div style="overflow:hidden;margin-top:18px;">
  <div class="fd-totals-card">
    <div class="totals-rows">
      <div class="totals-row"><span>Subtotal</span><span class="val">${fmt(subtotal)}</span></div>
      ${tax > 0 ? `<div class="totals-row"><span>Tax</span><span class="val">${fmt(tax)}</span></div>` : ''}
    </div>
    <div class="totals-grand">
      <div class="lbl">Total</div>
      <div class="val">${fmt(total)}</div>
    </div>
    ${paid > 0 ? `<div class="totals-paid"><span>Amount Paid</span><span style="font-variant-numeric:tabular-nums;">−${fmt(paid)}</span></div>` : ''}
    ${(paid > 0 || balance !== total) ? `<div class="totals-balance-due"><span>Balance Due</span><span style="font-variant-numeric:tabular-nums;">${fmt(balance)}</span></div>` : ''}
  </div>
</div>

${bill.notes ? `<div style="clear:both;margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;">
  <div class="section-label">Notes</div>
  <div style="font-size:11px;color:#475569;white-space:pre-line;">${esc(bill.notes)}</div>
</div>` : '<div style="clear:both;"></div>'}

<div class="rpt-footer" style="margin-top:32px;">
  <span>${created ? `Created ${esc(created)}` : ''}</span>
  <span>Generated ${esc(generated)}</span>
</div>
</div></body></html>`;
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
  const subtotal = Number(po.subtotal || 0);
  const tax = Number(po.tax_amount || 0);
  const total = Number(po.total || 0);

  const statusColor =
    po.status === 'received' ? '#16a34a' :
    po.status === 'cancelled' ? '#dc2626' :
    po.status === 'approved' ? '#2563eb' :
    po.status === 'sent' ? '#d97706' : '#475569';

  const stamp =
    po.status === 'draft' ? { label: 'DRAFT', color: '#475569' } :
    po.status === 'sent' ? { label: 'SENT', color: '#d97706' } :
    po.status === 'received' ? { label: 'RECEIVED', color: '#16a34a' } :
    po.status === 'cancelled' ? { label: 'CLOSED', color: '#dc2626' } :
    null;

  const logoHTML = safeImg(settings?.logo_data || null, esc(company?.name || ''),
    'max-height:42px;max-width:160px;object-fit:contain;margin-bottom:6px;');

  const vendorBlock = `
    <div class="fd-addr-card">
      <div class="fd-addr-lbl">Vendor</div>
      <div class="fd-addr-name">${esc(vendor?.name || 'Vendor')}</div>
      <div class="fd-addr-detail">
        ${addrLines([vendor?.address_line1, vendor?.address_line2,
          [vendor?.city, vendor?.state, vendor?.zip].filter(Boolean).join(', ') || null])}
        ${vendor?.email ? `<div>${esc(vendor.email)}</div>` : ''}
        ${vendor?.phone ? `<div>${esc(vendor.phone)}</div>` : ''}
      </div>
    </div>`;

  const shipName = settings?.ship_to_name || company?.name || '';
  const shipL1 = settings?.ship_to_address_line1 || company?.address_line1 || '';
  const shipL2 = settings?.ship_to_address_line2 || company?.address_line2 || '';
  const shipCity = settings?.ship_to_city || company?.city || '';
  const shipState = settings?.ship_to_state || company?.state || '';
  const shipZip = settings?.ship_to_zip || company?.zip || '';

  const shipBlock = `
    <div class="fd-addr-card">
      <div class="fd-addr-lbl">Ship To</div>
      <div class="fd-addr-name">${esc(shipName)}</div>
      <div class="fd-addr-detail">
        ${addrLines([shipL1, shipL2, [shipCity, shipState, shipZip].filter(Boolean).join(', ') || null])}
      </div>
    </div>`;

  const rows = (lineItems || []).map((l: any) => {
    const qty = Number(l.quantity || 0);
    const unit = Number(l.unit_price || 0);
    const amt = Number(l.amount ?? qty * unit);
    const taxRate = Number(l.tax_rate || 0);
    return `<tr>
      <td>${esc(l.description || '')}</td>
      <td class="text-right">${qty}</td>
      <td class="text-right" style="font-size:10px;color:#64748b;">${esc(l.unit_label || '')}</td>
      <td class="text-right">${fmt(unit)}</td>
      <td class="text-right" style="font-size:10px;color:#64748b;">${taxRate > 0 ? taxRate + '%' : '—'}</td>
      <td class="text-right font-bold" style="color:#0f172a;">${fmt(amt)}</td>
    </tr>`;
  }).join('');

  const generated = new Date().toLocaleString('en-US');

  // ── Feature #8: PO delivery timeline ──
  const deliveryTimelineHTML = (() => {
    const orderRaw = po.order_date || po.issue_date;
    const expectedRaw = po.expected_delivery_date || po.expected_date;
    if (!orderRaw || !expectedRaw) return '';
    const order = new Date(orderRaw + 'T12:00:00').getTime();
    const expected = new Date(expectedRaw + 'T12:00:00').getTime();
    const today = Date.now();
    if (!isFinite(order) || !isFinite(expected) || expected <= order) return '';
    const span = expected - order;
    const todayPct = Math.max(0, Math.min(100, ((today - order) / span) * 100));
    const overdue = today > expected;
    const approaching = !overdue && expected - today < span * 0.2;
    const color = overdue ? '#dc2626' : approaching ? '#d97706' : '#2563eb';
    const status = overdue ? `${Math.floor((today - expected) / 86_400_000)}d overdue` : approaching ? 'Approaching' : 'On track';
    return `<div style="margin-top:14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;margin-bottom:6px;">
        <span>Delivery Timeline</span>
        <span style="color:${color};">${status}</span>
      </div>
      <div style="position:relative;height:14px;background:#e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <div style="position:absolute;left:0;top:0;height:100%;width:${Math.min(100, todayPct).toFixed(1)}%;background:${color};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        <div style="position:absolute;right:0;top:-3px;bottom:-3px;width:2px;background:#0f172a;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#475569;margin-top:4px;font-variant-numeric:tabular-nums;">
        <span>Ordered ${esc(fmtDateMaybe(orderRaw))}</span>
        <span>Today</span>
        <span>Expected ${esc(fmtDateMaybe(expectedRaw))}</span>
      </div>
    </div>`;
  })();

  const terms: string = po.terms || '';
  const deliveryTerms = settings?.delivery_terms || '';
  const paymentTerms = settings?.payment_terms || '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Purchase Order ${esc(po.po_number || '')}</title>
<style>${baseStyles}${stamp ? statusStampCSS(stamp.color) : ''}</style></head>
<body><div class="rpt-page" style="padding:32px 36px;">
${stamp ? `<div class="status-stamp">${stamp.label}</div>` : ''}
<div class="fd-letterhead">
  <div class="fd-letterhead-left">
    ${logoHTML}
    <div class="fd-co-name">${esc(company?.name || 'Company')}</div>
    <div class="fd-co-line">${esc([company?.address_line1, company?.city, company?.state].filter(Boolean).join(' · '))}</div>
  </div>
  <div class="fd-letterhead-right">
    <div class="fd-doc-type">Purchase Order</div>
    <div class="fd-doc-num">${esc(po.po_number || '')}${statusBadgeInline((po.status || '').toUpperCase().replace('_',' '), statusColor)}</div>
    <div class="fd-doc-date">Order ${esc(fmtDateMaybe(po.order_date || po.issue_date))}</div>
    ${(po.expected_delivery_date || po.expected_date) ? `<div class="fd-doc-date">Expected ${esc(fmtDateMaybe(po.expected_delivery_date || po.expected_date))}</div>` : ''}
  </div>
</div>

<div class="fd-addr-grid">
  ${vendorBlock}
  ${shipBlock}
</div>

${deliveryTimelineHTML}

<table style="margin-top:8px;">
  <thead>
    <tr>
      <th>Description</th>
      <th class="text-right">Qty</th>
      <th class="text-right">Unit</th>
      <th class="text-right">Unit Price</th>
      <th class="text-right">Tax %</th>
      <th class="text-right">Line Total</th>
    </tr>
  </thead>
  <tbody>${rows || `<tr class="fd-empty-row"><td colspan="6">(no line items)</td></tr>`}</tbody>
</table>

<div style="overflow:hidden;margin-top:18px;">
  <div class="fd-totals-card">
    <div class="totals-rows">
      <div class="totals-row"><span>Subtotal</span><span class="val">${fmt(subtotal)}</span></div>
      ${tax > 0 ? `<div class="totals-row"><span>Tax</span><span class="val">${fmt(tax)}</span></div>` : ''}
    </div>
    <div class="totals-grand">
      <div class="lbl">Order Total</div>
      <div class="val">${fmt(total)}</div>
    </div>
  </div>
</div>

<div style="clear:both;"></div>

${(terms || deliveryTerms || paymentTerms) ? `<div style="margin-top:24px;padding:14px 16px;background:var(--paper-tint);border:1px solid var(--rule);border-radius:6px;border-left:3px solid var(--accent);">
  <div class="section-label">Terms &amp; Conditions</div>
  ${deliveryTerms ? `<div style="font-size:10.5px;margin-bottom:4px;"><strong>Delivery:</strong> ${esc(deliveryTerms)}</div>` : ''}
  ${paymentTerms ? `<div style="font-size:10.5px;margin-bottom:4px;"><strong>Payment:</strong> ${esc(paymentTerms)}</div>` : ''}
  ${terms ? `<div style="font-size:10.5px;color:#475569;white-space:pre-line;">${esc(terms)}</div>` : ''}
</div>` : ''}

${po.notes ? `<div style="margin-top:18px;">
  <div class="section-label">Notes</div>
  <div style="font-size:11px;color:#475569;white-space:pre-line;">${esc(po.notes)}</div>
</div>` : ''}

<div class="signature-block" style="margin-top:42px;display:grid;grid-template-columns:1fr 1fr;gap:32px;">
  <div>
    <div class="fd-sig-line"></div>
    <div class="fd-sig-lbl">Approved by</div>
  </div>
  <div>
    <div class="fd-sig-line"></div>
    <div class="fd-sig-lbl">Date</div>
  </div>
</div>

<div class="rpt-footer" style="margin-top:32px;">
  <span>Purchase Order ${esc(po.po_number || '')}</span>
  <span>Generated ${esc(generated)}</span>
</div>
</div></body></html>`;
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
  const total = Number(expense.amount || expense.total || 0);
  const tax = Number(expense.tax_amount || 0);
  const subtotal = Number(expense.subtotal || (total - tax));

  const reimbStatus = expense.reimbursement_status || expense.status || 'pending';
  const reimbColor =
    reimbStatus === 'reimbursed' || reimbStatus === 'paid' ? '#16a34a' :
    reimbStatus === 'approved' ? '#2563eb' :
    reimbStatus === 'rejected' ? '#dc2626' : '#d97706';

  const receiptHTML = safeImg(expense.receipt_path || expense.receipt_data || null, 'Receipt',
    'max-width:100%;max-height:380px;object-fit:contain;border:1px solid #e2e8f0;padding:6px;background:#fff;');

  const linesHTML = (lineItems && lineItems.length > 0) ? `
    <table style="margin-top:12px;">
      <thead><tr><th>Description</th><th class="text-right">Amount</th></tr></thead>
      <tbody>
        ${lineItems.map((l: any) => `<tr>
          <td>${esc(l.description || '')}</td>
          <td class="text-right font-bold">${fmt(Number(l.amount || 0))}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '';

  const generated = new Date().toLocaleString('en-US');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Expense ${esc(expense.reference || expense.id || '')}</title>
<style>${baseStyles}</style></head>
<body><div class="rpt-page" style="padding:32px 36px;">
<div class="fd-letterhead">
  <div class="fd-letterhead-left">
    <div class="fd-co-name" style="font-size:14px;">${esc(company?.name || 'Company')}</div>
  </div>
  <div class="fd-letterhead-right">
    <div class="fd-doc-type" style="font-size:22px;">Expense Record</div>
    <div class="fd-doc-num">${esc(expense.reference || expense.expense_number || expense.id || '')}${statusBadgeInline(String(reimbStatus).toUpperCase().replace('_',' '), reimbColor)}</div>
    <div class="fd-doc-date">${esc(fmtDateMaybe(expense.date || expense.expense_date))}</div>
  </div>
</div>

<div class="fd-meta-strip">
  <div class="fd-meta-row"><span class="lbl">Vendor</span><span class="val">${esc(vendor?.name || expense.vendor_name || '—')}</span></div>
  <div class="fd-meta-row"><span class="lbl">Category</span><span class="val">${esc(expense.category || expense.category_name || '—')}</span></div>
  <div class="fd-meta-row"><span class="lbl">Date</span><span class="val">${esc(fmtDateMaybe(expense.date || expense.expense_date))}</span></div>
  <div class="fd-meta-row"><span class="lbl">Reference</span><span class="val">${esc(expense.reference || '—')}</span></div>
</div>

${expense.description ? `<div style="margin-bottom:14px;">
  <div class="section-label">Description</div>
  <div style="font-size:11px;color:#475569;white-space:pre-line;">${esc(expense.description)}</div>
</div>` : ''}

${linesHTML}

<div style="overflow:hidden;margin-top:14px;">
  <div class="fd-totals-card">
    <div class="totals-rows">
      <div class="totals-row"><span>Subtotal</span><span class="val">${fmt(subtotal)}</span></div>
      ${tax > 0 ? `<div class="totals-row"><span>Tax</span><span class="val">${fmt(tax)}</span></div>` : ''}
    </div>
    <div class="totals-grand">
      <div class="lbl">Total Expense</div>
      <div class="val">${fmt(total)}</div>
    </div>
  </div>
</div>

<div style="clear:both;margin-top:18px;padding:14px 16px;background:var(--paper-tint);border:1px solid var(--rule);border-radius:6px;border-left:3px solid var(--accent);">
  <div class="section-label">Reimbursement</div>
  <div style="font-size:11px;color:#475569;">Status: ${statusBadgeInline(String(reimbStatus).toUpperCase().replace('_',' '), reimbColor)}</div>
</div>

${receiptHTML ? `<div style="margin-top:22px;page-break-inside:avoid;">
  <div class="section-label">Receipt</div>
  <div style="text-align:center;">${receiptHTML}</div>
</div>` : ''}

<div class="rpt-footer" style="margin-top:32px;">
  <span>${esc(company?.name || '')}</span>
  <span>Generated ${esc(generated)}</span>
</div>
</div></body></html>`;
}
