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
