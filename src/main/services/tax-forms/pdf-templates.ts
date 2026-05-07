// src/main/services/tax-forms/pdf-templates.ts
//
// Tax-form PDF templates. NOT official IRS forms — these are
// worksheet-style summaries listing each line's calculated value
// next to the official line number + description. The user
// transcribes to the actual IRS form (or e-files separately)
// using these as supporting documentation.
//
// Why not pixel-perfect IRS forms:
//   • Pixel-perfect requires copyrighted IRS PDF mechanicals
//   • IRS rejects any non-official form for paper filing anyway
//   • The value is in the COMPUTATION + worksheet trail, which
//     a CPA reviews during e-filing prep

import type { Form941Data } from './form-941';
import type { ScheduleCData } from './schedule-c';
import type { Form1099NECData } from './form-1099-nec';
import type { FormW2Data } from './form-w2';
import type { ScheduleSEData } from './schedule-se';
import type { SalesTaxData } from './sales-tax';
import type { FormW3Data } from './form-w3';
import type { Form940Data } from './form-940';
import type { Form1099MISCData } from './form-1099-misc';

const SHARED_HEAD = `<style>
  @page { size: letter; margin: 0.5in; @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #94a3b8; } }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.4; }
  .form-header { border-bottom: 3px solid #0f172a; padding-bottom: 14px; margin-bottom: 16px; }
  .form-title { font-size: 22px; font-weight: 800; }
  .form-subtitle { font-size: 12px; color: #475569; margin-top: 4px; }
  .form-meta { font-size: 11px; color: #64748b; margin-top: 8px; }
  .filer-block { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
  .filer-block .filer-card { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; }
  .filer-block .label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 4px; }
  .filer-block .value { font-size: 12px; font-weight: 600; }
  .section-header { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px; padding: 6px 10px; background: #0f172a; color: #fff; margin: 18px 0 0; border-radius: 6px 6px 0 0; }
  table.lines { width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; border-top: none; }
  table.lines th { background: #f1f5f9; padding: 6px 10px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; border-bottom: 1px solid #cbd5e1; text-align: left; }
  table.lines td { padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #e2e8f0; }
  table.lines td.line-num { color: #94a3b8; width: 60px; font-family: 'SF Mono', Menlo, monospace; }
  table.lines td.line-amt { text-align: right; font-family: 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums; width: 110px; font-weight: 600; }
  table.lines td.line-amt.totals { font-weight: 800; background: #f8fafc; }
  .disclaimer { margin-top: 14px; padding: 10px 12px; border: 1px dashed #cbd5e1; border-radius: 6px; background: #fffbeb; font-size: 10px; color: #78350f; }
  .warnings { padding: 10px 12px; border: 1px solid #fca5a5; background: #fef2f2; border-radius: 6px; font-size: 11px; color: #991b1b; margin-bottom: 14px; }
  .warnings ul { margin: 4px 0 0 18px; }
</style>`;

function fmtMoney(n: number): string {
  if (n === null || n === undefined) return '';
  const sign = n < 0 ? '-$' : '$';
  return sign + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escape(s: string): string {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

// ── Form 941 ──────────────────────────────────────────────────

export function form941HTML(data: Form941Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form 941 Q${data.quarter} ${data.year} — ${escape(data.business_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 941 — Employer's Quarterly Federal Tax Return</div>
  <div class="form-subtitle">Q${data.quarter} ${data.year} · Worksheet</div>
  <div class="form-meta">${escape(data.business_name)} · EIN ${escape(data.ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

<div class="filer-block">
  <div class="filer-card">
    <div class="label">Employer</div>
    <div class="value">${escape(data.business_name)}</div>
    <div style="font-size: 11px; color: #475569; margin-top: 2px;">
      ${escape(data.address)}<br>
      ${escape(data.city)}, ${escape(data.state)} ${escape(data.zip)}
    </div>
  </div>
  <div class="filer-card">
    <div class="label">Filing</div>
    <div class="value">Quarter ${data.quarter}, ${data.year}</div>
    <div style="font-size: 11px; color: #475569; margin-top: 2px;">
      ${data.line1_employees} employee${data.line1_employees === 1 ? '' : 's'} · ${data.payroll_run_count} pay run${data.payroll_run_count === 1 ? '' : 's'} · ${data.pay_stub_count} pay stub${data.pay_stub_count === 1 ? '' : 's'}
    </div>
  </div>
</div>

<div class="section-header">Part 1 — Quarterly Wages &amp; Taxes</div>
<table class="lines">
  <thead><tr><th>Line</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    <tr><td class="line-num">1</td><td>Number of employees who received wages</td><td class="line-amt">${data.line1_employees}</td></tr>
    <tr><td class="line-num">2</td><td>Wages, tips, and other compensation</td><td class="line-amt">${fmtMoney(data.line2_wages_tips)}</td></tr>
    <tr><td class="line-num">3</td><td>Federal income tax withheld from wages</td><td class="line-amt">${fmtMoney(data.line3_fed_income_tax)}</td></tr>
    <tr><td class="line-num">4</td><td>Wages NOT subject to social security or Medicare</td><td class="line-amt">${data.line4_no_fica ? '☑' : '☐'}</td></tr>
    <tr><td class="line-num">5a</td><td>Taxable social security wages × 0.124</td><td class="line-amt">${fmtMoney(data.line5a_taxable_ss_wages)}</td></tr>
    <tr><td class="line-num">5a tax</td><td style="color:#475569">  → SS tax (employer + employee)</td><td class="line-amt">${fmtMoney(data.line5a_ss_tax)}</td></tr>
    <tr><td class="line-num">5b</td><td>Taxable social security tips × 0.124</td><td class="line-amt">${fmtMoney(data.line5b_taxable_ss_tips)}</td></tr>
    <tr><td class="line-num">5c</td><td>Taxable Medicare wages and tips × 0.029</td><td class="line-amt">${fmtMoney(data.line5c_taxable_medicare_wages)}</td></tr>
    <tr><td class="line-num">5c tax</td><td style="color:#475569">  → Medicare tax (employer + employee)</td><td class="line-amt">${fmtMoney(data.line5c_medicare_tax)}</td></tr>
    <tr><td class="line-num">5d</td><td>Wages subject to additional Medicare 0.9% (over $200k)</td><td class="line-amt">${fmtMoney(data.line5d_addtl_medicare_wages)}</td></tr>
    <tr><td class="line-num">5d tax</td><td style="color:#475569">  → Additional Medicare withheld (0.9%)</td><td class="line-amt">${fmtMoney(data.line5d_addtl_medicare_tax)}</td></tr>
    <tr><td class="line-num">5e</td><td>Total social security &amp; Medicare taxes (5a + 5b + 5c + 5d)</td><td class="line-amt totals">${fmtMoney(data.line5e_total)}</td></tr>
    <tr><td class="line-num">5f</td><td>Section 3121(q) notice — unreported tip wages</td><td class="line-amt">${fmtMoney(data.line5f_ss_tips_unreported)}</td></tr>
    <tr><td class="line-num">6</td><td>Total taxes before adjustments (lines 3 + 5e + 5f)</td><td class="line-amt totals">${fmtMoney(data.line6_total_taxes_before_adj)}</td></tr>
    <tr><td class="line-num">7</td><td>Current quarter's adjustment for fractions of cents</td><td class="line-amt">${fmtMoney(data.line7_fractions_adj)}</td></tr>
    <tr><td class="line-num">8</td><td>Current quarter's adjustment for sick pay</td><td class="line-amt">${fmtMoney(data.line8_sick_pay_adj)}</td></tr>
    <tr><td class="line-num">9</td><td>Current quarter's adjustments for tips and group-term life</td><td class="line-amt">${fmtMoney(data.line9_tips_group_term)}</td></tr>
    <tr><td class="line-num">10</td><td>Total taxes after adjustments (lines 6 ± 7-9)</td><td class="line-amt totals">${fmtMoney(data.line10_total_taxes_after_adj)}</td></tr>
    <tr><td class="line-num">11a</td><td>Qualified small-business payroll tax credit (R&amp;D)</td><td class="line-amt">${fmtMoney(data.line11a_qual_small_biz_credit)}</td></tr>
    <tr><td class="line-num">11c</td><td>Total nonrefundable credits</td><td class="line-amt">${fmtMoney(data.line11c_nonref_total)}</td></tr>
    <tr><td class="line-num">11e</td><td>Total refundable credits</td><td class="line-amt">${fmtMoney(data.line11e_ref_total)}</td></tr>
    <tr><td class="line-num">12</td><td>Total taxes after credits (line 10 − 11c − 11e)</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.line12_total_taxes_after_credits)}</td></tr>
    <tr><td class="line-num">13a</td><td>Total deposits for this quarter (per IRS records)</td><td class="line-amt">${fmtMoney(data.line13a_total_deposits)}</td></tr>
    <tr><td class="line-num">13g</td><td>Total deposits and credits</td><td class="line-amt totals">${fmtMoney(data.line13g_total)}</td></tr>
    <tr><td class="line-num">14</td><td>Balance due (line 12 − 13g, if positive)</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.line14_balance_due)}</td></tr>
    <tr><td class="line-num">15</td><td>Overpayment (line 13g − 12, if positive)</td><td class="line-amt totals" style="color:#16a34a">${fmtMoney(data.line15_overpayment)}</td></tr>
  </tbody>
</table>

<div class="section-header">Part 2 — Tax Liability for the Quarter</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">Schedule</td><td>Deposit schedule</td><td class="line-amt" style="text-transform:uppercase;font-weight:800">${data.deposit_schedule}</td></tr>
    <tr><td class="line-num">Month 1</td><td>Liability for first month of quarter</td><td class="line-amt">${fmtMoney(data.month1_liability)}</td></tr>
    <tr><td class="line-num">Month 2</td><td>Liability for second month of quarter</td><td class="line-amt">${fmtMoney(data.month2_liability)}</td></tr>
    <tr><td class="line-num">Month 3</td><td>Liability for third month of quarter</td><td class="line-amt">${fmtMoney(data.month3_liability)}</td></tr>
    <tr><td class="line-num">Total</td><td>Total liability (must equal line 12)</td><td class="line-amt totals">${fmtMoney(data.total_quarter_liability)}</td></tr>
  </tbody>
</table>

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  Use these numbers to e-file via EFTPS/IRS Direct Pay or transcribe to the official Form 941. The deposit schedule and Schedule B (semi-weekly depositors) are not auto-filled — verify with your CPA. Form 941 is due by the last day of the month following each quarter (Apr 30, Jul 31, Oct 31, Jan 31).
</div>
</body></html>`;
}

// ── Schedule C ────────────────────────────────────────────────

export function scheduleCHTML(data: ScheduleCData): string {
  const otherList = data.line27a_other_expenses
    .sort((a, b) => b.amount - a.amount)
    .map((x) => `<tr><td class="line-num">27a</td><td>${escape(x.description)}</td><td class="line-amt">${fmtMoney(x.amount)}</td></tr>`)
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Schedule C ${data.year} — ${escape(data.business_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Schedule C — Profit or Loss from Business</div>
  <div class="form-subtitle">(Sole Proprietorship) · Tax Year ${data.year}</div>
  <div class="form-meta">${escape(data.business_name)} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

<div class="filer-block">
  <div class="filer-card">
    <div class="label">Proprietor</div>
    <div class="value">${escape(data.taxpayer_name) || '<em style="color:#94a3b8">Enter on filing</em>'}</div>
  </div>
  <div class="filer-card">
    <div class="label">Business</div>
    <div class="value">${escape(data.business_name)}</div>
    <div style="font-size: 11px; color: #475569; margin-top: 2px;">
      Code ${escape(data.business_code) || '______'} · Method: ${data.accounting_method}
    </div>
  </div>
</div>

<div class="section-header">Part I — Income</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">1</td><td>Gross receipts or sales</td><td class="line-amt">${fmtMoney(data.line1_gross_receipts)}</td></tr>
    <tr><td class="line-num">2</td><td>Returns and allowances</td><td class="line-amt">${fmtMoney(data.line2_returns_allowances)}</td></tr>
    <tr><td class="line-num">3</td><td>Subtract line 2 from line 1</td><td class="line-amt">${fmtMoney(data.line3_subtract)}</td></tr>
    <tr><td class="line-num">4</td><td>Cost of goods sold (from line 42)</td><td class="line-amt">${fmtMoney(data.line4_cogs)}</td></tr>
    <tr><td class="line-num">5</td><td>Gross profit (line 3 − line 4)</td><td class="line-amt">${fmtMoney(data.line5_gross_profit)}</td></tr>
    <tr><td class="line-num">6</td><td>Other income</td><td class="line-amt">${fmtMoney(data.line6_other_income)}</td></tr>
    <tr><td class="line-num">7</td><td>Gross income (line 5 + line 6)</td><td class="line-amt totals">${fmtMoney(data.line7_gross_income)}</td></tr>
  </tbody>
</table>

<div class="section-header">Part II — Expenses</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">8</td><td>Advertising</td><td class="line-amt">${fmtMoney(data.line8_advertising)}</td></tr>
    <tr><td class="line-num">9</td><td>Car and truck expenses</td><td class="line-amt">${fmtMoney(data.line9_car_truck)}</td></tr>
    <tr><td class="line-num">10</td><td>Commissions and fees</td><td class="line-amt">${fmtMoney(data.line10_commissions_fees)}</td></tr>
    <tr><td class="line-num">11</td><td>Contract labor</td><td class="line-amt">${fmtMoney(data.line11_contract_labor)}</td></tr>
    <tr><td class="line-num">12</td><td>Depletion</td><td class="line-amt">${fmtMoney(data.line12_depletion)}</td></tr>
    <tr><td class="line-num">13</td><td>Depreciation and Section 179</td><td class="line-amt">${fmtMoney(data.line13_depreciation)}</td></tr>
    <tr><td class="line-num">14</td><td>Employee benefit programs</td><td class="line-amt">${fmtMoney(data.line14_employee_benefits)}</td></tr>
    <tr><td class="line-num">15</td><td>Insurance (other than health)</td><td class="line-amt">${fmtMoney(data.line15_insurance)}</td></tr>
    <tr><td class="line-num">16a</td><td>Mortgage interest (paid to banks)</td><td class="line-amt">${fmtMoney(data.line16a_mortgage_interest)}</td></tr>
    <tr><td class="line-num">16b</td><td>Other interest</td><td class="line-amt">${fmtMoney(data.line16b_other_interest)}</td></tr>
    <tr><td class="line-num">17</td><td>Legal and professional services</td><td class="line-amt">${fmtMoney(data.line17_legal_professional)}</td></tr>
    <tr><td class="line-num">18</td><td>Office expense</td><td class="line-amt">${fmtMoney(data.line18_office_expense)}</td></tr>
    <tr><td class="line-num">19</td><td>Pension and profit-sharing plans</td><td class="line-amt">${fmtMoney(data.line19_pension_profit_sharing)}</td></tr>
    <tr><td class="line-num">20a</td><td>Rent — vehicles, machinery, equipment</td><td class="line-amt">${fmtMoney(data.line20a_rent_vehicles_machinery)}</td></tr>
    <tr><td class="line-num">20b</td><td>Rent — other business property</td><td class="line-amt">${fmtMoney(data.line20b_rent_other)}</td></tr>
    <tr><td class="line-num">21</td><td>Repairs and maintenance</td><td class="line-amt">${fmtMoney(data.line21_repairs_maintenance)}</td></tr>
    <tr><td class="line-num">22</td><td>Supplies</td><td class="line-amt">${fmtMoney(data.line22_supplies)}</td></tr>
    <tr><td class="line-num">23</td><td>Taxes and licenses</td><td class="line-amt">${fmtMoney(data.line23_taxes_licenses)}</td></tr>
    <tr><td class="line-num">24a</td><td>Travel</td><td class="line-amt">${fmtMoney(data.line24a_travel)}</td></tr>
    <tr><td class="line-num">24b</td><td>Deductible meals (50%)</td><td class="line-amt">${fmtMoney(data.line24b_meals)}</td></tr>
    <tr><td class="line-num">25</td><td>Utilities</td><td class="line-amt">${fmtMoney(data.line25_utilities)}</td></tr>
    <tr><td class="line-num">26</td><td>Wages</td><td class="line-amt">${fmtMoney(data.line26_wages)}</td></tr>
    ${otherList || '<tr><td class="line-num">27a</td><td><em style="color:#94a3b8">No other expenses</em></td><td class="line-amt">$0.00</td></tr>'}
    <tr><td class="line-num">27b</td><td>Total other expenses</td><td class="line-amt">${fmtMoney(data.line27b_other_total)}</td></tr>
    <tr><td class="line-num">28</td><td>Total expenses (sum of 8 through 27b)</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.line28_total_expenses)}</td></tr>
    <tr><td class="line-num">29</td><td>Tentative profit (line 7 − line 28)</td><td class="line-amt totals">${fmtMoney(data.line29_tentative_profit)}</td></tr>
    <tr><td class="line-num">30</td><td>Expenses for business use of your home (Form 8829)</td><td class="line-amt">${fmtMoney(data.line30_home_office)}</td></tr>
    <tr><td class="line-num">31</td><td>Net profit (line 29 − line 30)</td><td class="line-amt totals" style="color:${data.line31_net_profit >= 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(data.line31_net_profit)}</td></tr>
  </tbody>
</table>

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  Categories are auto-mapped from your expense category names using keyword pattern matching. Verify each line — especially line 27a "other expenses" — before transcribing to your return. Line 31 carries to Form 1040 Schedule 1 line 3 (and is also subject to self-employment tax via Schedule SE).
</div>
</body></html>`;
}

// ── 1099-NEC (one document with multiple recipient pages) ─────

export function nec1099HTML(forms: Form1099NECData[], year: number, payer: { name: string; ein: string }): string {
  if (forms.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>1099-NEC Summary ${year}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 1099-NEC — Nonemployee Compensation</div>
  <div class="form-subtitle">Tax Year ${year} · Summary</div>
</div>
<div class="warnings">No 1099-eligible vendors found for ${year}. Mark vendors as 1099-eligible (is_1099_eligible) to include them.</div>
</body></html>`;
  }

  const recipientCard = (f: Form1099NECData, idx: number) => `
    <div style="${idx > 0 ? 'page-break-before: always;' : ''}">
      <div class="form-header">
        <div class="form-title">Form 1099-NEC · ${escape(f.recipient_name)}</div>
        <div class="form-subtitle">Tax Year ${year} · Copy B (For Recipient)</div>
      </div>
      ${f.warnings.length > 0 ? `<div class="warnings"><strong>Filing warnings:</strong><ul>${f.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}
      <div class="filer-block">
        <div class="filer-card">
          <div class="label">PAYER</div>
          <div class="value">${escape(f.payer_name)}</div>
          <div style="font-size: 11px; margin-top: 2px;">
            ${escape(f.payer_address)}<br>
            ${escape(f.payer_city)}, ${escape(f.payer_state)} ${escape(f.payer_zip)}<br>
            <span style="color:#64748b">EIN: ${escape(f.payer_tin) || '__-_______'}</span>
          </div>
        </div>
        <div class="filer-card">
          <div class="label">RECIPIENT</div>
          <div class="value">${escape(f.recipient_name)}</div>
          <div style="font-size: 11px; margin-top: 2px;">
            ${escape(f.recipient_address)}<br>
            ${escape(f.recipient_city)}, ${escape(f.recipient_state)} ${escape(f.recipient_zip)}<br>
            <span style="color:#64748b">TIN: ${escape(f.recipient_tin) || '<em style="color:#dc2626">MISSING</em>'}</span>
          </div>
        </div>
      </div>
      <table class="lines">
        <tbody>
          <tr><td class="line-num">Box 1</td><td>Nonemployee compensation</td><td class="line-amt totals" style="color:#16a34a">${fmtMoney(f.box1_nonemployee_comp)}</td></tr>
          <tr><td class="line-num">Box 2</td><td>Payer made direct sales of $5,000+ of consumer products</td><td class="line-amt">${f.box2_direct_sales ? '☑' : '☐'}</td></tr>
          <tr><td class="line-num">Box 4</td><td>Federal income tax withheld (backup withholding)</td><td class="line-amt">${fmtMoney(f.box4_fed_income_tax_withheld)}</td></tr>
          <tr><td class="line-num">Box 5</td><td>State tax withheld</td><td class="line-amt">${fmtMoney(f.box5_state_tax_withheld)}</td></tr>
          <tr><td class="line-num">Box 6</td><td>State / Payer's state no.</td><td class="line-amt">${escape(f.box6_state_payer_no)}</td></tr>
          <tr><td class="line-num">Box 7</td><td>State income</td><td class="line-amt">${fmtMoney(f.box7_state_income)}</td></tr>
        </tbody>
      </table>
      <div style="font-size:10px;color:#64748b;margin-top:8px;">${f.payment_count} payment${f.payment_count === 1 ? '' : 's'} totaling ${fmtMoney(f.box1_nonemployee_comp)}</div>
    </div>
  `;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>1099-NEC ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>
${forms.map((f, i) => recipientCard(f, i)).join('')}
<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  File Form 1099-NEC with the IRS by January 31 (paper or electronic). Each recipient also gets Copy B by January 31. Forms with missing TINs cannot be filed — request a W-9 from those recipients first. Filing electronically is required if you have 10+ information returns.
</div>
</body></html>`;
}

// ── W-2 (one document with multiple employee pages) ───────────

export function w2HTML(forms: FormW2Data[], year: number, employer: { name: string; ein: string }): string {
  if (forms.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>W-2 Summary ${year}</title>${SHARED_HEAD}</head>
<body><div class="form-header"><div class="form-title">Form W-2 — Wage and Tax Statement</div><div class="form-subtitle">Tax Year ${year}</div></div>
<div class="warnings">No employees with pay stubs in ${year}.</div></body></html>`;
  }

  const employeePage = (f: FormW2Data, idx: number) => `
    <div style="${idx > 0 ? 'page-break-before: always;' : ''}">
      <div class="form-header">
        <div class="form-title">Form W-2 · ${escape(f.employee_first_name)} ${escape(f.employee_last_name)}</div>
        <div class="form-subtitle">Tax Year ${year} · Copy B (Filed With Employee Federal Tax Return)</div>
      </div>
      ${f.warnings.length > 0 ? `<div class="warnings"><strong>Filing warnings:</strong><ul>${f.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}
      <div class="filer-block">
        <div class="filer-card">
          <div class="label">Box b — Employer EIN</div>
          <div class="value">${escape(f.employer_ein) || '__-_______'}</div>
          <div class="label" style="margin-top:8px">Box c — Employer name &amp; address</div>
          <div style="font-size: 11px;">
            ${escape(f.employer_name)}<br>
            ${escape(f.employer_address)}<br>
            ${escape(f.employer_city)}, ${escape(f.employer_state)} ${escape(f.employer_zip)}
          </div>
        </div>
        <div class="filer-card">
          <div class="label">Box a — Employee SSN</div>
          <div class="value">${escape(f.employee_ssn) || '<em style="color:#dc2626">MISSING</em>'}</div>
          <div class="label" style="margin-top:8px">Box e/f — Employee name &amp; address</div>
          <div style="font-size: 11px;">
            ${escape(f.employee_first_name)} ${escape(f.employee_last_name)}<br>
            ${escape(f.employee_address)}<br>
            ${escape(f.employee_city)}, ${escape(f.employee_state)} ${escape(f.employee_zip)}
          </div>
        </div>
      </div>
      <table class="lines">
        <tbody>
          <tr><td class="line-num">1</td><td>Wages, tips, other compensation</td><td class="line-amt totals">${fmtMoney(f.box1_wages_tips)}</td></tr>
          <tr><td class="line-num">2</td><td>Federal income tax withheld</td><td class="line-amt">${fmtMoney(f.box2_fed_income_tax)}</td></tr>
          <tr><td class="line-num">3</td><td>Social security wages</td><td class="line-amt">${fmtMoney(f.box3_ss_wages)}</td></tr>
          <tr><td class="line-num">4</td><td>Social security tax withheld</td><td class="line-amt">${fmtMoney(f.box4_ss_tax)}</td></tr>
          <tr><td class="line-num">5</td><td>Medicare wages and tips</td><td class="line-amt">${fmtMoney(f.box5_medicare_wages)}</td></tr>
          <tr><td class="line-num">6</td><td>Medicare tax withheld</td><td class="line-amt">${fmtMoney(f.box6_medicare_tax)}</td></tr>
          <tr><td class="line-num">7</td><td>Social security tips</td><td class="line-amt">${fmtMoney(f.box7_ss_tips)}</td></tr>
          <tr><td class="line-num">10</td><td>Dependent care benefits</td><td class="line-amt">${fmtMoney(f.box10_dependent_care)}</td></tr>
          <tr><td class="line-num">11</td><td>Nonqualified plans</td><td class="line-amt">${fmtMoney(f.box11_nonqualified_plans)}</td></tr>
          ${f.box12_codes.map((c) => `<tr><td class="line-num">12${c.code}</td><td>${escape(c.label)}</td><td class="line-amt">${fmtMoney(c.amount)}</td></tr>`).join('')}
          <tr><td class="line-num">13</td><td>Statutory employee · Retirement plan · Third-party sick pay</td><td class="line-amt">${f.box13_statutory_employee ? '☑' : '☐'} ${f.box13_retirement_plan ? '☑' : '☐'} ${f.box13_third_party_sick_pay ? '☑' : '☐'}</td></tr>
          <tr><td class="line-num">15</td><td>State / Employer's state ID</td><td class="line-amt">${escape(f.box15_state)} / ${escape(f.state_employer_id)}</td></tr>
          <tr><td class="line-num">16</td><td>State wages, tips, etc.</td><td class="line-amt">${fmtMoney(f.box16_state_wages)}</td></tr>
          <tr><td class="line-num">17</td><td>State income tax</td><td class="line-amt">${fmtMoney(f.box17_state_income_tax)}</td></tr>
        </tbody>
      </table>
      <div style="font-size:10px;color:#64748b;margin-top:8px;">${f.pay_stub_count} pay stub${f.pay_stub_count === 1 ? '' : 's'} · YTD gross: ${fmtMoney(f.ytd_gross)}</div>
    </div>
  `;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>W-2 ${year} — ${escape(employer.name)}</title>${SHARED_HEAD}</head>
<body>
${forms.map((f, i) => employeePage(f, i)).join('')}
<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  File W-2 + W-3 transmittal with the SSA by January 31. Each employee gets Copy B + Copy C by January 31. Filing electronically is required if you have 10+ W-2s. Pre-tax deduction handling is simplified; if employees have HSA, 401(k), or Section 125 cafeteria plan deductions, verify Box 1/3/5 separation with your CPA.
</div>
</body></html>`;
}

// ── Schedule SE (Self-Employment Tax) ─────────────────────────

export function scheduleSEHTML(data: ScheduleSEData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Schedule SE ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Schedule SE — Self-Employment Tax</div>
  <div class="form-subtitle">Form 1040 · Tax Year ${data.year}</div>
  <div class="form-meta">${escape(data.taxpayer_name) || '<em style="color:#94a3b8">Enter on filing</em>'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

${data.is_negative_profit ? `<div class="warnings"><strong>No SE tax owed.</strong> Schedule C net profit is negative — no self-employment tax due. Schedule SE is not required to be filed.</div>` : ''}
${data.line2_other_se_income > 0 && data.line2_other_se_income < 400 ? `<div class="warnings"><strong>Below $400 threshold.</strong> Net SE earnings of ${fmtMoney(data.line2_other_se_income)} are below the $400 minimum that triggers SE tax filing. No Schedule SE required.</div>` : ''}

<div class="section-header">Part I — Self-Employment Income</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">1a</td><td>Net farm SE income (Schedule F)</td><td class="line-amt">${fmtMoney(data.line1a_farm_se_income)}</td></tr>
    <tr><td class="line-num">2</td><td>Net profit from Schedule C, line 31</td><td class="line-amt">${fmtMoney(data.line2_other_se_income)}</td></tr>
    <tr><td class="line-num">3</td><td>Combine lines 1a, 1b, 2</td><td class="line-amt">${fmtMoney(data.line3_total)}</td></tr>
    <tr><td class="line-num">4a</td><td>Multiply line 3 by 92.35% (0.9235)</td><td class="line-amt">${fmtMoney(data.line4a_se_income_x_92pct)}</td></tr>
    <tr><td class="line-num">4c</td><td>Combine lines 4a + 4b</td><td class="line-amt">${fmtMoney(data.line4c_total)}</td></tr>
    <tr><td class="line-num">6</td><td>Total self-employment income subject to SE tax</td><td class="line-amt totals">${fmtMoney(data.line6_total_se_income)}</td></tr>
  </tbody>
</table>

<div class="section-header">Part II — Self-Employment Tax</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">7</td><td>Maximum amount subject to social security tax (2026 wage base)</td><td class="line-amt">${fmtMoney(data.line7_max_ss_earnings)}</td></tr>
    <tr><td class="line-num">8a</td><td>Total SS wages from W-2 jobs</td><td class="line-amt">${fmtMoney(data.line8a_ss_wages_w2)}</td></tr>
    <tr><td class="line-num">8d</td><td>Add 8a, 8b, 8c</td><td class="line-amt">${fmtMoney(data.line8d_total_ss_already_subject)}</td></tr>
    <tr><td class="line-num">9</td><td>Subtract line 8d from line 7</td><td class="line-amt">${fmtMoney(data.line9_remaining_ss_cap)}</td></tr>
    <tr><td class="line-num">10</td><td>Multiply min(line 6, line 9) × 12.4% — Social Security tax</td><td class="line-amt">${fmtMoney(data.line10_ss_tax)}</td></tr>
    <tr><td class="line-num">11</td><td>Multiply line 6 × 2.9% — Medicare tax</td><td class="line-amt">${fmtMoney(data.line11_medicare_tax)}</td></tr>
    <tr><td class="line-num">12</td><td>Total self-employment tax (line 10 + line 11) — carries to Schedule 2</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.line12_total_se_tax)}</td></tr>
    <tr><td class="line-num">13</td><td>Deductible part of SE tax (line 12 × 50%) — above-the-line deduction</td><td class="line-amt totals" style="color:#16a34a">${fmtMoney(data.line13_deductible_half)}</td></tr>
  </tbody>
</table>

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  Line 12 carries to Form 1040 Schedule 2 line 4. <strong>Line 13 is one of the most-missed deductions in DIY filing</strong> — it's an above-the-line deduction on Form 1040 Schedule 1 line 15, reducing AGI even if you don't itemize. Line 8a should be filled in if you also have W-2 wages from an employer (we default to $0 — edit if applicable).
</div>
</body></html>`;
}

// ── Sales Tax Remittance ──────────────────────────────────────

export function salesTaxHTML(data: SalesTaxData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Sales Tax Remittance ${data.period_start} to ${data.period_end} — ${escape(data.business_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Sales Tax Remittance Worksheet</div>
  <div class="form-subtitle">${escape(data.state) || 'State'} · Period ${data.period_start} → ${data.period_end} · ${data.filing_frequency}</div>
  <div class="form-meta">${escape(data.business_name)} · Permit ${escape(data.state_tax_id) || '__________'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

${data.warnings.length > 0 ? `<div class="warnings"><ul>${data.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}

<div class="section-header">Period Summary</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">A</td><td>Total gross sales (all invoices)</td><td class="line-amt">${fmtMoney(data.total_gross_sales)}</td></tr>
    <tr><td class="line-num">B</td><td>Non-taxable sales (services, exempt items)</td><td class="line-amt">${fmtMoney(data.total_nontaxable_sales)}</td></tr>
    <tr><td class="line-num">C</td><td>Taxable sales (A − B)</td><td class="line-amt totals">${fmtMoney(data.total_taxable_sales)}</td></tr>
    <tr><td class="line-num">D</td><td>Tax collected from customers</td><td class="line-amt">${fmtMoney(data.total_tax_collected)}</td></tr>
    <tr><td class="line-num">E</td><td>Tax due (computed from rates × taxable sales)</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.total_tax_due)}</td></tr>
    <tr><td class="line-num">F</td><td>Variance (D − E, should be near zero)</td><td class="line-amt" style="color:${Math.abs(data.total_variance) < 1 ? '#16a34a' : '#d97706'}">${fmtMoney(data.total_variance)}</td></tr>
  </tbody>
</table>

<div class="section-header">By Tax Rate</div>
<table class="lines">
  <thead><tr><th>Rate</th><th style="text-align:right">Taxable Sales</th><th style="text-align:right">Tax Due</th><th style="text-align:right">Tax Collected</th><th style="text-align:right">Variance</th><th style="text-align:right">Invoices</th></tr></thead>
  <tbody>
    ${data.rate_lines.map((l) => `
      <tr>
        <td class="line-num">${escape(l.rate_label)}</td>
        <td class="line-amt">${fmtMoney(l.taxable_sales)}</td>
        <td class="line-amt">${fmtMoney(l.tax_due)}</td>
        <td class="line-amt">${fmtMoney(l.tax_collected)}</td>
        <td class="line-amt" style="color:${Math.abs(l.variance) < 0.5 ? '#16a34a' : '#d97706'}">${fmtMoney(l.variance)}</td>
        <td class="line-amt">${l.invoice_count}</td>
      </tr>
    `).join('') || `<tr><td colspan="6" style="padding:14px;text-align:center;color:#94a3b8">No taxable sales in this period.</td></tr>`}
  </tbody>
</table>

<div class="section-header">Remittance Calculation</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">1</td><td>Total tax due (from line E above)</td><td class="line-amt">${fmtMoney(data.total_tax_due)}</td></tr>
    <tr><td class="line-num">2</td><td>Less: prepayments / credits applied</td><td class="line-amt" style="color:#16a34a">${fmtMoney(-data.prepayments)}</td></tr>
    <tr><td class="line-num">3</td><td>Less: early-filing discount (${data.early_filing_discount_pct}%)</td><td class="line-amt" style="color:#16a34a">${fmtMoney(-data.early_filing_discount)}</td></tr>
    <tr><td class="line-num">4</td><td>Net amount to remit to ${escape(data.state)}</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.net_remittance)}</td></tr>
  </tbody>
</table>

<div class="disclaimer">
  <strong>This is a worksheet, not the official state form.</strong>
  Each state has its own form (UT TC-62M, CA BOE-401-A, TX 01-114, etc.). Use these numbers to fill in the state-specific form via your DOR/DRS portal or e-filing service. Multi-jurisdiction tenants (selling into multiple states) need a separate worksheet per state — track with state-specific tax-rate codes on each invoice line.
</div>
</body></html>`;
}

// ── Form W-3 (Transmittal) ───────────────────────────────────

export function w3HTML(data: FormW3Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form W-3 ${data.tax_year} — ${escape(data.employer_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form W-3 — Transmittal of Wage and Tax Statements</div>
  <div class="form-subtitle">Tax Year ${data.tax_year} · ${data.number_of_w2s} W-2(s) attached · Filed with SSA</div>
  <div class="form-meta">${escape(data.employer_name)} · EIN ${escape(data.employer_ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

${data.warnings.length > 0 ? `<div class="warnings"><strong>Warnings:</strong><ul>${data.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}

<div class="filer-block">
  <div class="filer-card">
    <div class="label">Employer (Box e–g)</div>
    <div class="value">${escape(data.employer_name)}</div>
    <div class="value">${escape(data.employer_address)}</div>
    <div class="value">${escape(data.employer_city)}, ${escape(data.employer_state)} ${escape(data.employer_zip)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Filing Type (Box b)</div>
    <div class="value">Kind of Payer: ${escape(data.kind_of_payer)}</div>
    <div class="value">Kind of Employer: ${escape(data.kind_of_employer)}</div>
    <div class="value">3rd-Party Sick Pay: ${data.third_party_sick_pay ? 'Yes' : 'No'}</div>
    <div class="value">Forms Attached (Box c): ${data.number_of_w2s}</div>
  </div>
</div>

<div class="section-header">Box Totals (sum of all attached W-2s)</div>
<table class="lines">
  <thead><tr><th>Box</th><th>Description</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>
    <tr><td class="line-num">1</td><td>Wages, tips, other comp</td><td class="line-amt totals">${fmtMoney(data.box1_total_wages_tips)}</td></tr>
    <tr><td class="line-num">2</td><td>Federal income tax withheld</td><td class="line-amt">${fmtMoney(data.box2_total_fed_income_tax)}</td></tr>
    <tr><td class="line-num">3</td><td>Social Security wages</td><td class="line-amt">${fmtMoney(data.box3_total_ss_wages)}</td></tr>
    <tr><td class="line-num">4</td><td>Social Security tax withheld</td><td class="line-amt">${fmtMoney(data.box4_total_ss_tax)}</td></tr>
    <tr><td class="line-num">5</td><td>Medicare wages and tips</td><td class="line-amt">${fmtMoney(data.box5_total_medicare_wages)}</td></tr>
    <tr><td class="line-num">6</td><td>Medicare tax withheld</td><td class="line-amt">${fmtMoney(data.box6_total_medicare_tax)}</td></tr>
    <tr><td class="line-num">7</td><td>Social Security tips</td><td class="line-amt">${fmtMoney(data.box7_total_ss_tips)}</td></tr>
    <tr><td class="line-num">8</td><td>Allocated tips</td><td class="line-amt">${fmtMoney(data.box8_total_allocated_tips)}</td></tr>
    <tr><td class="line-num">10</td><td>Dependent care benefits</td><td class="line-amt">${fmtMoney(data.box10_total_dependent_care)}</td></tr>
    <tr><td class="line-num">11</td><td>Nonqualified plans</td><td class="line-amt">${fmtMoney(data.box11_total_nonqualified)}</td></tr>
    <tr><td class="line-num">12a</td><td>Deferred comp totals (all codes)</td><td class="line-amt">${fmtMoney(data.box12a_total)}</td></tr>
    <tr><td class="line-num">15</td><td>State (majority)</td><td class="line-amt">${escape(data.box15_state) || '—'}</td></tr>
    <tr><td class="line-num">16</td><td>State wages, tips, etc.</td><td class="line-amt">${fmtMoney(data.box16_total_state_wages)}</td></tr>
    <tr><td class="line-num">17</td><td>State income tax</td><td class="line-amt">${fmtMoney(data.box17_total_state_income_tax)}</td></tr>
    <tr><td class="line-num">18</td><td>Local wages</td><td class="line-amt">${fmtMoney(data.box18_total_local_wages)}</td></tr>
    <tr><td class="line-num">19</td><td>Local income tax</td><td class="line-amt">${fmtMoney(data.box19_total_local_income_tax)}</td></tr>
  </tbody>
</table>

${data.box12_breakdown.length > 0 ? `
<div class="section-header">Box 12 Breakdown by Code</div>
<table class="lines">
  <thead><tr><th>Code</th><th>Description</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>
    ${data.box12_breakdown.map((b) => `<tr>
      <td class="line-num">${escape(b.code)}</td>
      <td>${escape(b.label)}</td>
      <td class="line-amt">${fmtMoney(b.total)}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

<div class="section-header">Attached W-2s (${data.w2_forms.length})</div>
<table class="lines">
  <thead><tr><th>Employee</th><th style="text-align:right">Box 1 Wages</th><th style="text-align:right">Box 2 Fed Tax</th><th style="text-align:right">Box 3 SS</th><th style="text-align:right">Box 5 Medicare</th></tr></thead>
  <tbody>
    ${data.w2_forms.map((w) => `<tr>
      <td>${escape(w.employee_first_name)} ${escape(w.employee_last_name)}</td>
      <td class="line-amt">${fmtMoney(w.box1_wages_tips)}</td>
      <td class="line-amt">${fmtMoney(w.box2_fed_income_tax)}</td>
      <td class="line-amt">${fmtMoney(w.box3_ss_wages)}</td>
      <td class="line-amt">${fmtMoney(w.box5_medicare_wages)}</td>
    </tr>`).join('') || `<tr><td colspan="5" style="padding:14px;text-align:center;color:#94a3b8">No W-2s attached.</td></tr>`}
  </tbody>
</table>

<div class="section-header">Contact Information</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">Name</td><td colspan="2">${escape(data.contact_name) || '__________'}</td></tr>
    <tr><td class="line-num">Phone</td><td colspan="2">${escape(data.contact_phone) || '__________'}</td></tr>
    <tr><td class="line-num">Email</td><td colspan="2">${escape(data.contact_email) || '__________'}</td></tr>
  </tbody>
</table>

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  W-3 must be filed by January 31 with the SSA along with all W-2 Copy A forms.
  Most filers e-file via SSA Business Services Online (BSO) — paper W-3s require red-ink scannable forms ordered from IRS. The totals above MUST equal the sum of the attached W-2s exactly; if you edit any W-2 box, regenerate this form.
</div>
</body></html>`;
}

// ── Form 940 (FUTA) ───────────────────────────────────────────

export function form940HTML(data: Form940Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form 940 ${data.year} — ${escape(data.business_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 940 — Annual Federal Unemployment (FUTA) Tax Return</div>
  <div class="form-subtitle">Tax Year ${data.year} · ${data.employee_count} employee(s) · Effective rate ${(data.effective_futa_rate * 100).toFixed(1)}%</div>
  <div class="form-meta">${escape(data.business_name)} · EIN ${escape(data.ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

${data.warnings.length > 0 ? `<div class="warnings"><strong>Warnings:</strong><ul>${data.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}

<div class="filer-block">
  <div class="filer-card">
    <div class="label">Employer</div>
    <div class="value">${escape(data.business_name)}</div>
    ${data.trade_name && data.trade_name !== data.business_name ? `<div class="value">DBA: ${escape(data.trade_name)}</div>` : ''}
    <div class="value">${escape(data.address)}</div>
    <div class="value">${escape(data.city)}, ${escape(data.state)} ${escape(data.zip)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Filing Flags (Part 1)</div>
    <div class="value">${data.amended ? '☒' : '☐'} 1d Amended</div>
    <div class="value">${data.successor_employer ? '☒' : '☐'} 1c Successor employer</div>
    <div class="value">${data.no_payments_to_employees ? '☒' : '☐'} 1a No payments to employees</div>
    <div class="value">${data.final_return ? '☒' : '☐'} 1b Final return</div>
    <div class="value">${data.multi_state_employer ? '☒' : '☐'} Multi-state employer</div>
    <div class="value">${data.credit_reduction_state ? '☒' : '☐'} Credit reduction state (Schedule A)</div>
  </div>
</div>

<div class="section-header">Part 2 — FUTA Tax Before Adjustments</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">3</td><td>Total payments to all employees</td><td class="line-amt">${fmtMoney(data.line3_total_payments)}</td></tr>
    <tr><td class="line-num">4</td><td>Payments exempt from FUTA (fringe, retirement, dep care, other)</td><td class="line-amt">${fmtMoney(data.line4_payments_exempt)}</td></tr>
    <tr><td class="line-num">5</td><td>Total payments made > $7,000 per employee</td><td class="line-amt">${fmtMoney(data.line5_payments_excess_7k)}</td></tr>
    <tr><td class="line-num">6</td><td>Subtotal (lines 4 + 5)</td><td class="line-amt">${fmtMoney(data.line6_subtotal)}</td></tr>
    <tr><td class="line-num">7</td><td>Total taxable FUTA wages (line 3 − line 6)</td><td class="line-amt totals">${fmtMoney(data.line7_total_taxable)}</td></tr>
    <tr><td class="line-num">8</td><td>FUTA tax before adjustments (line 7 × 0.006)</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.line8_futa_tax)}</td></tr>
  </tbody>
</table>

<div class="section-header">Part 3 — Adjustments</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">9</td><td>If ALL FUTA wages were excluded from state UI: line 7 × 0.054</td><td class="line-amt">${fmtMoney(data.line9_no_credit)}</td></tr>
    <tr><td class="line-num">10</td><td>If SOME wages excluded or paid late: from worksheet</td><td class="line-amt">${fmtMoney(data.line10_some_credit)}</td></tr>
    <tr><td class="line-num">11</td><td>Credit reduction states (Schedule A)</td><td class="line-amt">${fmtMoney(data.line11_credit_reduction)}</td></tr>
    <tr><td class="line-num">12</td><td>Total FUTA tax (lines 8 + 9 + 10 + 11)</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.line12_total_futa)}</td></tr>
  </tbody>
</table>

<div class="section-header">Part 4 — Balance Due / Overpayment</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">13</td><td>Total deposits made for ${data.year}</td><td class="line-amt" style="color:#16a34a">${fmtMoney(data.line13_total_deposits)}</td></tr>
    <tr><td class="line-num">14</td><td>Balance due (line 12 − line 13, if positive)</td><td class="line-amt totals" style="color:${data.line14_balance_due > 0 ? '#dc2626' : '#94a3b8'}">${fmtMoney(data.line14_balance_due)}</td></tr>
    <tr><td class="line-num">15</td><td>Overpayment (line 13 − line 12, if positive)</td><td class="line-amt" style="color:${data.line15_overpayment > 0 ? '#16a34a' : '#94a3b8'}">${fmtMoney(data.line15_overpayment)}</td></tr>
  </tbody>
</table>

${data.has_quarterly_deposit_required ? `
<div class="section-header">Part 5 — Quarterly Liability (required when line 12 > $500)</div>
<table class="lines">
  <thead><tr><th>Quarter</th><th>Period</th><th style="text-align:right">FUTA Liability</th></tr></thead>
  <tbody>
    <tr><td class="line-num">16a</td><td>Q1 (Jan–Mar)</td><td class="line-amt">${fmtMoney(data.q1_liability)}</td></tr>
    <tr><td class="line-num">16b</td><td>Q2 (Apr–Jun)</td><td class="line-amt">${fmtMoney(data.q2_liability)}</td></tr>
    <tr><td class="line-num">16c</td><td>Q3 (Jul–Sep)</td><td class="line-amt">${fmtMoney(data.q3_liability)}</td></tr>
    <tr><td class="line-num">16d</td><td>Q4 (Oct–Dec)</td><td class="line-amt">${fmtMoney(data.q4_liability)}</td></tr>
    <tr><td class="line-num">17</td><td>Total quarterly liability (must equal line 12)</td><td class="line-amt totals">${fmtMoney(data.total_quarterly_liability)}</td></tr>
  </tbody>
</table>` : `
<div class="disclaimer" style="background:#f0f9ff;color:#075985;border-color:#bae6fd">
  <strong>Quarterly deposits not required.</strong>
  Total FUTA tax (${fmtMoney(data.line12_total_futa)}) is at or below the $500 threshold. You may pay the full amount with your annual Form 940 by January 31. Part 5 is not required.
</div>`}

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  Form 940 is filed annually by January 31 (or February 10 if you deposited all FUTA tax timely). The 0.6% effective rate assumes you paid state unemployment tax timely; if not, you may owe up to the full 6.0%. Multi-state employers and credit-reduction-state filers must complete Schedule A separately.
</div>
</body></html>`;
}

// ── Form 1099-MISC ────────────────────────────────────────────

export function misc1099HTML(forms: Form1099MISCData[], year: number, payer: { name: string; ein: string }): string {
  const totalsByBox = forms.reduce((acc, f) => {
    acc.box1 += f.box1_rents;
    acc.box2 += f.box2_royalties;
    acc.box3 += f.box3_other_income;
    acc.box6 += f.box6_medical_healthcare;
    acc.box10 += f.box10_gross_proceeds_attorney;
    return acc;
  }, { box1: 0, box2: 0, box3: 0, box6: 0, box10: 0 });
  const grandTotal = forms.reduce((s, f) => s + f.total_paid, 0);

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form 1099-MISC ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 1099-MISC — Miscellaneous Information</div>
  <div class="form-subtitle">Tax Year ${year} · ${forms.length} recipient(s) · Total paid ${fmtMoney(grandTotal)}</div>
  <div class="form-meta">${escape(payer.name)} · EIN ${escape(payer.ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

<div class="section-header">Summary by Box</div>
<table class="lines">
  <thead><tr><th>Box</th><th>Description</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>
    <tr><td class="line-num">1</td><td>Rents</td><td class="line-amt">${fmtMoney(totalsByBox.box1)}</td></tr>
    <tr><td class="line-num">2</td><td>Royalties (≥ $10 threshold)</td><td class="line-amt">${fmtMoney(totalsByBox.box2)}</td></tr>
    <tr><td class="line-num">3</td><td>Other income (prizes, awards, taxable damages)</td><td class="line-amt">${fmtMoney(totalsByBox.box3)}</td></tr>
    <tr><td class="line-num">6</td><td>Medical and health care payments</td><td class="line-amt">${fmtMoney(totalsByBox.box6)}</td></tr>
    <tr><td class="line-num">10</td><td>Gross proceeds paid to attorney (settlements)</td><td class="line-amt">${fmtMoney(totalsByBox.box10)}</td></tr>
  </tbody>
</table>

<div class="section-header">Recipients</div>
${forms.map((f) => `
<div style="margin:14px 0; border:1px solid #e2e8f0; border-radius:6px; padding:10px 12px; ${!f.has_tin || !f.meets_filing_threshold ? 'background:#fffbeb' : ''}">
  <div style="display:flex; justify-content:space-between; align-items:flex-start;">
    <div>
      <div style="font-size:13px; font-weight:700">${escape(f.recipient_name) || '(unnamed)'}</div>
      <div style="font-size:10px; color:#64748b">TIN: ${escape(f.recipient_tin) || '— missing —'} · ${escape(f.recipient_address)} ${escape(f.recipient_city)}, ${escape(f.recipient_state)} ${escape(f.recipient_zip)}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:14px; font-weight:800; font-variant-numeric: tabular-nums">${fmtMoney(f.total_paid)}</div>
      <div style="font-size:9px; text-transform:uppercase; letter-spacing:0.5px; color:${f.meets_filing_threshold && f.has_tin ? '#16a34a' : '#dc2626'}; font-weight:700">
        ${f.meets_filing_threshold && f.has_tin ? '✓ Ready to file' : !f.has_tin ? '⛔ No TIN' : '⏸ Below threshold'}
      </div>
    </div>
  </div>
  <table class="lines" style="margin-top:8px; border:none">
    <tbody>
      ${f.box1_rents > 0  ? `<tr><td class="line-num">Box 1</td><td>Rents</td><td class="line-amt">${fmtMoney(f.box1_rents)}</td></tr>` : ''}
      ${f.box2_royalties > 0 ? `<tr><td class="line-num">Box 2</td><td>Royalties</td><td class="line-amt">${fmtMoney(f.box2_royalties)}</td></tr>` : ''}
      ${f.box3_other_income > 0 ? `<tr><td class="line-num">Box 3</td><td>Other income</td><td class="line-amt">${fmtMoney(f.box3_other_income)}</td></tr>` : ''}
      ${f.box6_medical_healthcare > 0 ? `<tr><td class="line-num">Box 6</td><td>Medical/healthcare</td><td class="line-amt">${fmtMoney(f.box6_medical_healthcare)}</td></tr>` : ''}
      ${f.box10_gross_proceeds_attorney > 0 ? `<tr><td class="line-num">Box 10</td><td>Gross proceeds to attorney</td><td class="line-amt">${fmtMoney(f.box10_gross_proceeds_attorney)}</td></tr>` : ''}
    </tbody>
  </table>
  ${f.warnings.length > 0 ? `<div style="font-size:10px; color:#92400e; margin-top:6px">${f.warnings.map(escape).join(' · ')}</div>` : ''}
</div>
`).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-MISC eligible vendors found for ${year}.</div>`}

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  1099-MISC is filed by February 28 (paper) or March 31 (electronic) with the IRS, and recipients must receive Copy B by January 31. <strong>Box 10 (gross proceeds to attorney) is for SETTLEMENTS only — legal fees go on 1099-NEC.</strong> The $600 threshold applies to most boxes; royalties (Box 2) start at $10.
</div>
</body></html>`;
}
