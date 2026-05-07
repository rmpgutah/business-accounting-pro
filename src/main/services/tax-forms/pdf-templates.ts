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
import type { Form944Data } from './form-944';
import type { Form945Data } from './form-945';
import type { Schedule941BData, DailyLiability as Schedule941BDailyLiability } from './form-941-schedule-b';
import type { Form945AData } from './form-945-a';
import type { Form1099INTData } from './form-1099-int';
import type { Form1099DIVData } from './form-1099-div';
import type { Form1099RData } from './form-1099-r';
import type { Form1099KData } from './form-1099-k';
import type { Form1099BData, Form1099GData, Form1099CData, Form1099SAData } from './form-1099-other';
import type { FormW2CData } from './form-w2c';
import type { Form1096Data } from './form-1096';
import type { Schedule1Data } from './schedule-1';
import type { Schedule2Data } from './schedule-2';
import type { Schedule3Data } from './schedule-3';
import type { ScheduleAData } from './schedule-a';
import type { ScheduleBData } from './schedule-b';
import type { ScheduleDData } from './schedule-d';
import type { Form1040ESData } from './form-1040-es';
import type { Form8995Data } from './form-8995';
import type { Form4562Data } from './form-4562';
import type { Form8829Data } from './form-8829';
import type { Form4797Data } from './form-4797';
import type { Form7004Data } from './form-7004';
import type { Form4868Data } from './form-4868';
import type { Form1065Data } from './form-1065';
import type { Form1120Data } from './form-1120';
import type { Form1120SData } from './form-1120s';
import type { K1Data } from './schedule-k1';
import type { Form1041Data } from './form-1041';

type DailyLiability = Schedule941BDailyLiability;

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

// ── Form 944 (Annual variant of 941) ───────────────────────────

export function form944HTML(data: Form944Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form 944 ${data.year} — ${escape(data.business_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 944 — Employer's ANNUAL Federal Tax Return</div>
  <div class="form-subtitle">Tax Year ${data.year} · ${data.employee_count} employee(s) · ${data.payroll_run_count} pay run(s)</div>
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
    <div class="label">Filing</div>
    <div class="value">EIN: ${escape(data.ein)}</div>
    <div class="value">Tax Year: ${data.year}</div>
    <div class="value">Filed: Annually (by Jan 31)</div>
    ${data.business_closed ? `<div class="value" style="color:#dc2626">Business closed ${escape(data.business_closed_date)}</div>` : ''}
  </div>
</div>

<div class="section-header">Part 1 — Annual Wages and Taxes</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">1</td><td>Wages, tips, and other compensation</td><td class="line-amt">${fmtMoney(data.line1_wages_tips)}</td></tr>
    <tr><td class="line-num">2</td><td>Federal income tax withheld</td><td class="line-amt">${fmtMoney(data.line2_fed_income_tax)}</td></tr>
    <tr><td class="line-num">3</td><td>${data.line3_no_fica ? '☒' : '☐'} No SS/Medicare wages — skip to line 5</td><td class="line-amt">—</td></tr>
    <tr><td class="line-num">4a</td><td>Taxable SS wages × 12.4%</td><td class="line-amt">${fmtMoney(data.line4a_taxable_ss_wages)} → ${fmtMoney(data.line4a_ss_tax)}</td></tr>
    <tr><td class="line-num">4b</td><td>Taxable SS tips × 12.4%</td><td class="line-amt">${fmtMoney(data.line4b_taxable_ss_tips)} → ${fmtMoney(data.line4b_ss_tax)}</td></tr>
    <tr><td class="line-num">4c</td><td>Taxable Medicare wages × 2.9%</td><td class="line-amt">${fmtMoney(data.line4c_taxable_medicare_wages)} → ${fmtMoney(data.line4c_medicare_tax)}</td></tr>
    <tr><td class="line-num">4d</td><td>Addtl Medicare wages > $200K × 0.9%</td><td class="line-amt">${fmtMoney(data.line4d_addtl_medicare_wages)} → ${fmtMoney(data.line4d_addtl_medicare_tax)}</td></tr>
    <tr><td class="line-num">4e</td><td>Total SS + Medicare taxes (4a+4b+4c+4d)</td><td class="line-amt totals">${fmtMoney(data.line4e_total)}</td></tr>
    <tr><td class="line-num">5</td><td>Total taxes before adjustments (line 2 + 4e)</td><td class="line-amt totals">${fmtMoney(data.line5_total_before_adj)}</td></tr>
    <tr><td class="line-num">6</td><td>Current year's adjustments</td><td class="line-amt">${fmtMoney(data.line6_adjustments)}</td></tr>
    <tr><td class="line-num">7</td><td>Total taxes after adjustments (5 + 6)</td><td class="line-amt totals">${fmtMoney(data.line7_total_after_adj)}</td></tr>
    <tr><td class="line-num">8</td><td>Qualified small business R&D credit (Form 8974)</td><td class="line-amt" style="color:#16a34a">${fmtMoney(data.line8_qual_small_biz_credit)}</td></tr>
    <tr><td class="line-num">9</td><td>Total taxes after credits (7 − 8)</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.line9_total_after_credits)}</td></tr>
    <tr><td class="line-num">10</td><td>Total deposits for the year</td><td class="line-amt" style="color:#16a34a">${fmtMoney(data.line10_total_deposits)}</td></tr>
    <tr><td class="line-num">11</td><td>Balance due (9 − 10 if positive)</td><td class="line-amt" style="color:${data.line11_balance_due > 0 ? '#dc2626' : '#94a3b8'}">${fmtMoney(data.line11_balance_due)}</td></tr>
    <tr><td class="line-num">12a</td><td>Overpayment (10 − 9 if positive)</td><td class="line-amt" style="color:${data.line12a_overpayment > 0 ? '#16a34a' : '#94a3b8'}">${fmtMoney(data.line12a_overpayment)}</td></tr>
  </tbody>
</table>

${data.line13_monthly_required ? `
<div class="section-header">Part 2 — Monthly Tax Liability (line 9 ≥ $2,500)</div>
<table class="lines">
  <thead><tr><th>Month</th><th style="text-align:right">Liability</th></tr></thead>
  <tbody>
    <tr><td class="line-num">13a Jan</td><td class="line-amt">${fmtMoney(data.line13a_jan)}</td></tr>
    <tr><td class="line-num">13b Feb</td><td class="line-amt">${fmtMoney(data.line13b_feb)}</td></tr>
    <tr><td class="line-num">13c Mar</td><td class="line-amt">${fmtMoney(data.line13c_mar)}</td></tr>
    <tr><td class="line-num">13d Apr</td><td class="line-amt">${fmtMoney(data.line13d_apr)}</td></tr>
    <tr><td class="line-num">13e May</td><td class="line-amt">${fmtMoney(data.line13e_may)}</td></tr>
    <tr><td class="line-num">13f Jun</td><td class="line-amt">${fmtMoney(data.line13f_jun)}</td></tr>
    <tr><td class="line-num">13g Jul</td><td class="line-amt">${fmtMoney(data.line13g_jul)}</td></tr>
    <tr><td class="line-num">13h Aug</td><td class="line-amt">${fmtMoney(data.line13h_aug)}</td></tr>
    <tr><td class="line-num">13i Sep</td><td class="line-amt">${fmtMoney(data.line13i_sep)}</td></tr>
    <tr><td class="line-num">13j Oct</td><td class="line-amt">${fmtMoney(data.line13j_oct)}</td></tr>
    <tr><td class="line-num">13k Nov</td><td class="line-amt">${fmtMoney(data.line13k_nov)}</td></tr>
    <tr><td class="line-num">13l Dec</td><td class="line-amt">${fmtMoney(data.line13l_dec)}</td></tr>
    <tr><td class="line-num">13m</td><td class="line-amt totals">Total — must equal line 9 → ${fmtMoney(data.line13m_total)}</td></tr>
  </tbody>
</table>` : `
<div class="disclaimer" style="background:#f0f9ff;color:#075985;border-color:#bae6fd">
  <strong>Monthly schedule not required.</strong> Annual liability (${fmtMoney(data.line9_total_after_credits)}) is below the $2,500 threshold. Pay the full amount with this return by January 31.
</div>`}

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  Form 944 is for small employers under $1,000 annual liability — and only if the IRS notified you in writing to file 944 instead of quarterly 941s. If your annual liability exceeded $1,000 in ${data.year}, contact the IRS to switch back to Form 941. Due January 31 of the following year.
</div>
</body></html>`;
}

// ── Form 945 (Annual backup withholding) ───────────────────────

export function form945HTML(data: Form945Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form 945 ${data.year} — ${escape(data.business_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 945 — Annual Return of Withheld Federal Income Tax</div>
  <div class="form-subtitle">Tax Year ${data.year} · Non-payroll withholding (1099 backup, pensions, gambling)</div>
  <div class="form-meta">${escape(data.business_name)} · EIN ${escape(data.ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

${data.warnings.length > 0 ? `<div class="warnings"><strong>Warnings:</strong><ul>${data.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}

<div class="filer-block">
  <div class="filer-card">
    <div class="label">Filer</div>
    <div class="value">${escape(data.business_name)}</div>
    <div class="value">${escape(data.address)}</div>
    <div class="value">${escape(data.city)}, ${escape(data.state)} ${escape(data.zip)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Filing</div>
    <div class="value">EIN: ${escape(data.ein)}</div>
    <div class="value">Tax Year: ${data.year}</div>
    <div class="value">Filed: Annually (by Jan 31)</div>
    ${data.is_final_return ? `<div class="value" style="color:#dc2626">Final return ${escape(data.final_payment_date)}</div>` : ''}
  </div>
</div>

<div class="section-header">Withholding Totals</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">1</td><td>Federal tax withheld from pensions, annuities, IRAs, gambling</td><td class="line-amt">${fmtMoney(data.line1_fed_withheld)}</td></tr>
    <tr><td class="line-num">2</td><td>Backup withholding (24% on payments to vendors without TIN)</td><td class="line-amt">${fmtMoney(data.line2_backup_withholding)}</td></tr>
    <tr><td class="line-num">3</td><td>Total taxes (line 1 + line 2)</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.line3_total_taxes)}</td></tr>
    <tr><td class="line-num">4</td><td>Total deposits for the year</td><td class="line-amt" style="color:#16a34a">${fmtMoney(data.line4_total_deposits)}</td></tr>
    <tr><td class="line-num">5</td><td>Balance due (3 − 4 if positive)</td><td class="line-amt" style="color:${data.line5_balance_due > 0 ? '#dc2626' : '#94a3b8'}">${fmtMoney(data.line5_balance_due)}</td></tr>
    <tr><td class="line-num">6a</td><td>Overpayment (4 − 3 if positive)</td><td class="line-amt" style="color:${data.line6a_overpayment > 0 ? '#16a34a' : '#94a3b8'}">${fmtMoney(data.line6a_overpayment)}</td></tr>
  </tbody>
</table>

${data.line7_monthly_required ? `
<div class="section-header">Line 7 — Monthly Summary of Federal Tax Liability (line 3 ≥ $2,500)</div>
<table class="lines">
  <thead><tr><th>Month</th><th style="text-align:right">Liability</th></tr></thead>
  <tbody>
    <tr><td class="line-num">7a Jan</td><td class="line-amt">${fmtMoney(data.line7a_jan)}</td></tr>
    <tr><td class="line-num">7b Feb</td><td class="line-amt">${fmtMoney(data.line7b_feb)}</td></tr>
    <tr><td class="line-num">7c Mar</td><td class="line-amt">${fmtMoney(data.line7c_mar)}</td></tr>
    <tr><td class="line-num">7d Apr</td><td class="line-amt">${fmtMoney(data.line7d_apr)}</td></tr>
    <tr><td class="line-num">7e May</td><td class="line-amt">${fmtMoney(data.line7e_may)}</td></tr>
    <tr><td class="line-num">7f Jun</td><td class="line-amt">${fmtMoney(data.line7f_jun)}</td></tr>
    <tr><td class="line-num">7g Jul</td><td class="line-amt">${fmtMoney(data.line7g_jul)}</td></tr>
    <tr><td class="line-num">7h Aug</td><td class="line-amt">${fmtMoney(data.line7h_aug)}</td></tr>
    <tr><td class="line-num">7i Sep</td><td class="line-amt">${fmtMoney(data.line7i_sep)}</td></tr>
    <tr><td class="line-num">7j Oct</td><td class="line-amt">${fmtMoney(data.line7j_oct)}</td></tr>
    <tr><td class="line-num">7k Nov</td><td class="line-amt">${fmtMoney(data.line7k_nov)}</td></tr>
    <tr><td class="line-num">7l Dec</td><td class="line-amt">${fmtMoney(data.line7l_dec)}</td></tr>
    <tr><td class="line-num">7m</td><td class="line-amt totals">Total — must equal line 3 → ${fmtMoney(data.line7m_total)}</td></tr>
  </tbody>
</table>` : `
<div class="disclaimer" style="background:#f0f9ff;color:#075985;border-color:#bae6fd">
  <strong>Monthly schedule not required.</strong> Total taxes (${fmtMoney(data.line3_total_taxes)}) ${data.line3_total_taxes < 2500 ? 'are below the $2,500 threshold' : 'qualify for semiweekly Form 945-A'}.
</div>`}

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  Form 945 is filed by January 31 for federal income tax withheld from non-payroll sources during the prior year. The most common source for accounting users is backup withholding (Box 4 on 1099 forms) — 24% on payments to vendors who failed to provide a valid W-9. ${data.source_count} qualifying source row(s) found in our records.
</div>
</body></html>`;
}

// ── 941 Schedule B (Semiweekly daily liability — quarterly) ────

export function schedule941BHTML(data: Schedule941BData): string {
  const renderMonth = (name: string, daily: DailyLiability[], total: number) => {
    if (daily.length === 0) {
      return `<div style="margin-bottom:14px"><div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:#64748b;margin-bottom:4px">${escape(name)}</div><div style="font-size:11px;color:#94a3b8;padding:6px 10px;background:#f8fafc;border-radius:4px">No tax liability dates in this month.</div></div>`;
    }
    return `<div style="margin-bottom:14px">
      <div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:#64748b;margin-bottom:4px">${escape(name)} — Total ${fmtMoney(total)}</div>
      <table class="lines">
        <thead><tr><th>Day</th><th style="text-align:right">Liability</th></tr></thead>
        <tbody>
          ${daily.map((d) => `<tr><td class="line-num">${d.day}</td><td class="line-amt">${fmtMoney(d.amount)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form 941 Schedule B Q${data.quarter} ${data.year} — ${escape(data.business_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 941 Schedule B — Report of Tax Liability for Semiweekly Schedule Depositors</div>
  <div class="form-subtitle">Q${data.quarter} ${data.year} · ${data.pay_dates_count} pay date(s) · Total ${fmtMoney(data.total_quarter_liability)}</div>
  <div class="form-meta">${escape(data.business_name)} · EIN ${escape(data.ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

${data.warnings.length > 0 ? `<div class="warnings"><strong>Warnings:</strong><ul>${data.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}

<div class="section-header">Daily Tax Liability by Month</div>
${renderMonth(data.month1_name, data.month1_liability, data.month1_total)}
${renderMonth(data.month2_name, data.month2_liability, data.month2_total)}
${renderMonth(data.month3_name, data.month3_liability, data.month3_total)}

<table class="lines">
  <tbody>
    <tr><td class="line-num">Q${data.quarter} TOTAL</td><td>Sum of all daily liabilities — MUST equal Form 941 line 12</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.total_quarter_liability)}</td></tr>
  </tbody>
</table>

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  Schedule B is required for semiweekly depositors and for any employer who accumulated $100,000+ of liability on any single day during a deposit period. Each day's liability = federal income tax + employee SS + employer SS + employee Medicare + employer Medicare from all checks issued that day. The IRS rejects 941 + Schedule B filings where the totals do not agree to the penny.
</div>
</body></html>`;
}

// ── Form 945-A (Annual semiweekly daily liability) ─────────────

export function form945AHTML(data: Form945AData): string {
  const renderMonth = (m: { month_name: string; daily: DailyLiability[]; month_total: number }) => {
    if (m.daily.length === 0) return '';
    return `<div style="margin-bottom:14px">
      <div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:#64748b;margin-bottom:4px">${escape(m.month_name)} — Total ${fmtMoney(m.month_total)}</div>
      <table class="lines">
        <thead><tr><th>Day</th><th style="text-align:right">Liability</th></tr></thead>
        <tbody>
          ${m.daily.map((d) => `<tr><td class="line-num">${d.day}</td><td class="line-amt">${fmtMoney(d.amount)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  };

  const parentFormLabel = ({
    'form-941': 'Form 941 (quarterly payroll)',
    'form-944': 'Form 944 (annual payroll)',
    'form-945': 'Form 945 (annual non-payroll withholding)',
  })[data.parent_form];

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form 945-A ${data.year} — ${escape(data.business_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 945-A — Annual Record of Federal Tax Liability</div>
  <div class="form-subtitle">${data.year} · Attached to ${escape(parentFormLabel)} · ${data.liability_dates_count} liability date(s) · Total ${fmtMoney(data.total_year_liability)}</div>
  <div class="form-meta">${escape(data.business_name)} · EIN ${escape(data.ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

${data.warnings.length > 0 ? `<div class="warnings"><strong>Warnings:</strong><ul>${data.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}

<div class="section-header">Daily Tax Liability by Month</div>
${data.months.map(renderMonth).filter(Boolean).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No tax liability dates found for ${data.year}.</div>`}

<table class="lines">
  <tbody>
    <tr><td class="line-num">${data.year} TOTAL</td><td>Sum of all daily liabilities — MUST equal parent form's total</td><td class="line-amt totals" style="color:#dc2626">${fmtMoney(data.total_year_liability)}</td></tr>
  </tbody>
</table>

<div class="disclaimer">
  <strong>This is a worksheet, not the official IRS form.</strong>
  Form 945-A is required for semiweekly depositors filing Form 944 / 945 / 941 and for any filer who accumulated $100,000+ of liability on any single day. The total here MUST agree with the parent form's tax liability line — the IRS rejects mismatched filings.
</div>
</body></html>`;
}

// ── Generic 1099-recipient block helper ───────────────────────

function renderRecipientBlock(f: { recipient_name: string; recipient_tin: string; recipient_address: string; recipient_city: string; recipient_state: string; recipient_zip: string; meets_filing_threshold: boolean; has_tin: boolean; warnings: string[] }, totalLabel: string, totalAmount: number, boxLines: Array<[string, string, number | string]>): string {
  return `
<div style="margin:14px 0; border:1px solid #e2e8f0; border-radius:6px; padding:10px 12px; ${!f.has_tin || !f.meets_filing_threshold ? 'background:#fffbeb' : ''}">
  <div style="display:flex; justify-content:space-between; align-items:flex-start;">
    <div>
      <div style="font-size:13px; font-weight:700">${escape(f.recipient_name) || '(unnamed)'}</div>
      <div style="font-size:10px; color:#64748b">TIN: ${escape(f.recipient_tin) || '— missing —'} · ${escape(f.recipient_address)} ${escape(f.recipient_city)}, ${escape(f.recipient_state)} ${escape(f.recipient_zip)}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px; color:#64748b">${escape(totalLabel)}</div>
      <div style="font-size:14px; font-weight:800; font-variant-numeric: tabular-nums">${fmtMoney(totalAmount)}</div>
      <div style="font-size:9px; text-transform:uppercase; letter-spacing:0.5px; color:${f.meets_filing_threshold && f.has_tin ? '#16a34a' : '#dc2626'}; font-weight:700">
        ${f.meets_filing_threshold && f.has_tin ? '✓ Ready' : !f.has_tin ? '⛔ No TIN' : '⏸ Below threshold'}
      </div>
    </div>
  </div>
  ${boxLines.length > 0 ? `<table class="lines" style="margin-top:8px; border:none">
    <tbody>
      ${boxLines.filter(([_, __, v]) => typeof v === 'number' ? v > 0 : !!v).map(([n, label, v]) => `<tr><td class="line-num">${escape(n)}</td><td>${escape(label)}</td><td class="line-amt">${typeof v === 'number' ? fmtMoney(v) : escape(String(v))}</td></tr>`).join('')}
    </tbody>
  </table>` : ''}
  ${f.warnings.length > 0 ? `<div style="font-size:10px; color:#92400e; margin-top:6px">${f.warnings.map(escape).join(' · ')}</div>` : ''}
</div>`;
}

function form1099Header(title: string, subtitle: string, payerName: string, payerEin: string, year: number): string {
  return `<div class="form-header">
    <div class="form-title">${escape(title)}</div>
    <div class="form-subtitle">${escape(subtitle)}</div>
    <div class="form-meta">${escape(payerName)} · EIN ${escape(payerEin) || '__-_______'} · Tax year ${year} · Generated ${new Date().toLocaleDateString('en-US')}</div>
  </div>`;
}

// ── Form 1099-INT ─────────────────────────────────────────────

export function int1099HTML(forms: Form1099INTData[], year: number, payer: { name: string; ein: string }): string {
  const grand = forms.reduce((s, f) => s + f.box1_interest_income, 0);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1099-INT ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>${form1099Header('Form 1099-INT — Interest Income', `${forms.length} recipient(s) · Total interest paid ${fmtMoney(grand)}`, payer.name, payer.ein, year)}
<div class="section-header">Recipients</div>
${forms.map((f) => renderRecipientBlock(f, 'Box 1 Interest', f.box1_interest_income, [
  ['1', 'Interest income', f.box1_interest_income],
  ['2', 'Early withdrawal penalty', f.box2_early_withdrawal_penalty],
  ['3', 'US Treasury bond interest', f.box3_us_savings_bond],
  ['4', 'Federal income tax withheld', f.box4_fed_tax_withheld],
  ['8', 'Tax-exempt interest', f.box8_tax_exempt_interest],
])).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-INT recipients found for ${year}.</div>`}
<div class="disclaimer"><strong>Worksheet, not official IRS form.</strong> 1099-INT is filed when business paid $10+ of interest to a recipient. Recipients must receive Copy B by January 31; IRS Copy A by February 28 (paper) or March 31 (electronic).</div>
</body></html>`;
}

// ── Form 1099-DIV ─────────────────────────────────────────────

export function div1099HTML(forms: Form1099DIVData[], year: number, payer: { name: string; ein: string }): string {
  const grand = forms.reduce((s, f) => s + f.box1a_total_ordinary_dividends, 0);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1099-DIV ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>${form1099Header('Form 1099-DIV — Dividends and Distributions', `${forms.length} shareholder(s) · Total ordinary dividends ${fmtMoney(grand)}`, payer.name, payer.ein, year)}
<div class="section-header">Shareholders</div>
${forms.map((f) => renderRecipientBlock(f, 'Box 1a Ordinary', f.box1a_total_ordinary_dividends, [
  ['1a', 'Total ordinary dividends', f.box1a_total_ordinary_dividends],
  ['1b', 'Qualified dividends', f.box1b_qualified_dividends],
  ['2a', 'Total capital gain distribution', f.box2a_total_capital_gain_distr],
  ['3', 'Nondividend distributions', f.box3_nondividend_distributions],
  ['4', 'Federal income tax withheld', f.box4_fed_tax_withheld],
  ['5', 'Section 199A dividends', f.box5_section_199a_dividends],
])).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-DIV recipients flagged for ${year}.</div>`}
<div class="disclaimer"><strong>Worksheet, not official IRS form.</strong> 1099-DIV is filed by C-corps that paid $10+ of dividends. Most small accounting users (S-corps, partnerships, sole props) do NOT issue 1099-DIVs.</div>
</body></html>`;
}

// ── Form 1099-R ───────────────────────────────────────────────

export function r1099HTML(forms: Form1099RData[], year: number, payer: { name: string; ein: string }): string {
  const grand = forms.reduce((s, f) => s + f.box1_gross_distribution, 0);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1099-R ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>${form1099Header('Form 1099-R — Distributions From Pensions, Annuities, IRAs, Retirement Plans', `${forms.length} recipient(s) · Total gross distributions ${fmtMoney(grand)}`, payer.name, payer.ein, year)}
<div class="section-header">Recipients</div>
${forms.map((f) => renderRecipientBlock(f, 'Box 1 Gross', f.box1_gross_distribution, [
  ['1', 'Gross distribution', f.box1_gross_distribution],
  ['2a', 'Taxable amount', f.box2a_taxable_amount],
  ['4', 'Federal income tax withheld', f.box4_fed_tax_withheld],
  ['5', 'Employee contributions', f.box5_employee_contributions],
  ['7', 'Distribution code', f.box7_distribution_code],
  ['14', 'State tax withheld', f.box14_state_tax_withheld],
])).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-R recipients flagged for ${year}.</div>`}
<div class="disclaimer"><strong>Worksheet, not official IRS form.</strong> 1099-R is filed by retirement-plan administrators. Box 7 distribution codes: 1=early, 2=early w/ exception, 7=normal, 4=death, G=direct rollover, etc.</div>
</body></html>`;
}

// ── Form 1099-K ───────────────────────────────────────────────

export function k1099HTML(forms: Form1099KData[], year: number, payer: { name: string; ein: string }): string {
  const grand = forms.reduce((s, f) => s + f.box1a_gross_amount, 0);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1099-K ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>${form1099Header('Form 1099-K — Payment Card and Third Party Network Transactions', `${forms.length} recipient(s) · Total gross amount ${fmtMoney(grand)}`, payer.name, payer.ein, year)}
<div class="section-header">Recipients</div>
${forms.map((f) => renderRecipientBlock(f, 'Box 1a Gross', f.box1a_gross_amount, [
  ['1a', 'Gross amount of payment card / TPN transactions', f.box1a_gross_amount],
  ['1b', 'Card not present (online/phone/keyed)', f.box1b_card_not_present],
  ['2', 'Merchant category code', f.box2_merchant_category_code],
  ['3', 'Number of transactions', f.box3_number_of_transactions],
  ['4', 'Federal income tax withheld', f.box4_fed_tax_withheld],
  ['5a', 'January', f.box5a_jan], ['5b', 'February', f.box5b_feb],
  ['5c', 'March', f.box5c_mar], ['5d', 'April', f.box5d_apr],
  ['5e', 'May', f.box5e_may], ['5f', 'June', f.box5f_jun],
  ['5g', 'July', f.box5g_jul], ['5h', 'August', f.box5h_aug],
  ['5i', 'September', f.box5i_sep], ['5j', 'October', f.box5j_oct],
  ['5k', 'November', f.box5k_nov], ['5l', 'December', f.box5l_dec],
])).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-K recipients flagged for ${year}.</div>`}
<div class="disclaimer"><strong>Worksheet, not official IRS form.</strong> 1099-K is filed by payment processors (Stripe, Square, PayPal). 2025-2026 threshold is $5,000 (was $20K + 200 tx pre-2024).</div>
</body></html>`;
}

// ── Form 1099-B ───────────────────────────────────────────────

export function b1099HTML(forms: Form1099BData[], year: number, payer: { name: string; ein: string }): string {
  const grand = forms.reduce((s, f) => s + f.box1d_proceeds, 0);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1099-B ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>${form1099Header('Form 1099-B — Proceeds From Broker and Barter Exchange Transactions', `${forms.length} recipient(s) · Total proceeds ${fmtMoney(grand)}`, payer.name, payer.ein, year)}
<div class="section-header">Transactions</div>
${forms.map((f) => renderRecipientBlock(f, 'Box 1d Proceeds', f.box1d_proceeds, [
  ['1a', 'Description of property', f.box1a_description],
  ['1b', 'Date acquired', f.box1b_date_acquired],
  ['1c', 'Date sold', f.box1c_date_sold],
  ['1d', 'Proceeds', f.box1d_proceeds],
  ['1e', 'Cost or other basis', f.box1e_cost_basis],
  ['2', 'Short or long term', f.box2_short_long_term],
  ['4', 'Federal income tax withheld', f.box4_fed_tax_withheld],
])).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-B recipients flagged for ${year}.</div>`}
<div class="disclaimer"><strong>Worksheet, not official IRS form.</strong> 1099-B is filed by brokers and barter exchanges. The recipient uses these on their Schedule D.</div>
</body></html>`;
}

// ── Form 1099-G ───────────────────────────────────────────────

export function g1099HTML(forms: Form1099GData[], year: number, payer: { name: string; ein: string }): string {
  const grand = forms.reduce((s, f) => s + f.box1_unemployment_comp + f.box2_state_local_refund + f.box6_taxable_grants, 0);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1099-G ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>${form1099Header('Form 1099-G — Certain Government Payments', `${forms.length} recipient(s) · Total reported ${fmtMoney(grand)}`, payer.name, payer.ein, year)}
<div class="section-header">Recipients</div>
${forms.map((f) => renderRecipientBlock(f, 'Total Reported', f.box1_unemployment_comp + f.box2_state_local_refund + f.box6_taxable_grants, [
  ['1', 'Unemployment compensation', f.box1_unemployment_comp],
  ['2', 'State/local income tax refund', f.box2_state_local_refund],
  ['4', 'Federal income tax withheld', f.box4_fed_tax_withheld],
  ['6', 'Taxable grants', f.box6_taxable_grants],
  ['7', 'Agriculture payments', f.box7_agriculture_payments],
])).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-G recipients flagged for ${year}.</div>`}
<div class="disclaimer"><strong>Worksheet, not official IRS form.</strong> 1099-G is filed by government agencies. Most accounting users RECEIVE these (not issue them) and report Box 1/2 on their own Schedule 1.</div>
</body></html>`;
}

// ── Form 1099-C ───────────────────────────────────────────────

export function c1099HTML(forms: Form1099CData[], year: number, payer: { name: string; ein: string }): string {
  const grand = forms.reduce((s, f) => s + f.box2_amount_debt_canceled, 0);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1099-C ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>${form1099Header('Form 1099-C — Cancellation of Debt', `${forms.length} debtor(s) · Total debt canceled ${fmtMoney(grand)}`, payer.name, payer.ein, year)}
<div class="section-header">Debtors</div>
${forms.map((f) => renderRecipientBlock(f, 'Box 2 Debt Canceled', f.box2_amount_debt_canceled, [
  ['1', 'Date of identifiable event', f.box1_date_canceled],
  ['2', 'Amount of debt canceled', f.box2_amount_debt_canceled],
  ['3', 'Interest, if included in box 2', f.box3_interest_in_box_2],
  ['4', 'Debt description', f.box4_debt_description],
  ['6', 'Identifiable event code', f.box6_identifiable_event_code],
  ['7', 'Fair market value of property', f.box7_fair_market_value_property],
])).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-C debtors flagged for ${year}.</div>`}
<div class="disclaimer"><strong>Worksheet, not official IRS form.</strong> 1099-C is filed by lenders that canceled $600+ of debt. Box 6 codes: A=bankruptcy, B=insolvency, C=statute of limitations, D=foreclosure, E=other identifiable event, F=settlement, G=decision/policy, H=other.</div>
</body></html>`;
}

// ── Form 1099-SA ──────────────────────────────────────────────

export function sa1099HTML(forms: Form1099SAData[], year: number, payer: { name: string; ein: string }): string {
  const grand = forms.reduce((s, f) => s + f.box1_gross_distribution, 0);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1099-SA ${year} — ${escape(payer.name)}</title>${SHARED_HEAD}</head>
<body>${form1099Header('Form 1099-SA — Distributions From an HSA, Archer MSA, or MA MSA', `${forms.length} recipient(s) · Total gross distributions ${fmtMoney(grand)}`, payer.name, payer.ein, year)}
<div class="section-header">Recipients</div>
${forms.map((f) => renderRecipientBlock(f, 'Box 1 Gross', f.box1_gross_distribution, [
  ['1', 'Gross distribution', f.box1_gross_distribution],
  ['2', 'Earnings on excess contributions', f.box2_earnings_on_excess],
  ['3', 'Distribution code', f.box3_distribution_code],
  ['4', 'Fair market value on date of death', f.box4_fmv_on_date_of_death],
  ['5', 'HSA / Archer MSA / MA MSA', f.box5_hsa_archer_msa_ma_msa],
])).join('') || `<div style="padding:14px;text-align:center;color:#94a3b8">No 1099-SA recipients flagged for ${year}.</div>`}
<div class="disclaimer"><strong>Worksheet, not official IRS form.</strong> 1099-SA is filed by HSA/MSA trustees (banks, brokerages). Box 3 codes: 1=normal, 2=excess contribution, 3=disability, 4=death, 5=prohibited transaction, 6=death after RBD.</div>
</body></html>`;
}

// ── Form W-2c (Corrected W-2) ─────────────────────────────────

export function w2cHTML(form: FormW2CData): string {
  const fmtPair = (label: string, prev: any, corrected: any, format?: 'money' | 'text') => {
    const fmt = format === 'text' ? (v: any) => escape(String(v)) : (v: any) => fmtMoney(Number(v) || 0);
    const changed = format === 'text' ? prev !== corrected : Math.abs((Number(prev) || 0) - (Number(corrected) || 0)) > 0.005;
    return `<tr style="${changed ? 'background:#fef3c7' : ''}">
      <td style="padding:6px 10px;font-size:11px">${escape(label)}</td>
      <td style="padding:6px 10px;font-size:11px;text-align:right;font-family:'SF Mono',Menlo,monospace;color:${changed ? '#92400e' : '#94a3b8'}">${fmt(prev)}</td>
      <td style="padding:6px 10px;font-size:11px;text-align:right;font-family:'SF Mono',Menlo,monospace;font-weight:${changed ? 700 : 400};color:${changed ? '#0f172a' : '#94a3b8'}">${fmt(corrected)}</td>
    </tr>`;
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form W-2c ${form.tax_year} — ${escape(form.prev.employee_first_name)} ${escape(form.prev.employee_last_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form W-2c — Corrected Wage and Tax Statement</div>
  <div class="form-subtitle">Tax Year ${form.tax_year} · Employee: ${escape(form.prev.employee_first_name)} ${escape(form.prev.employee_last_name)} · ${form.changed_fields.length} field(s) changed</div>
  <div class="form-meta">${escape(form.employer_name)} · EIN ${escape(form.employer_ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>
${form.warnings.length > 0 ? `<div class="warnings"><strong>Notes:</strong><ul>${form.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}
${form.reason ? `<div style="margin-bottom:12px;padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:11px"><strong>Reason for correction:</strong> ${escape(form.reason)}</div>` : ''}
<div class="section-header">Side-by-Side Comparison (changed values highlighted)</div>
<table class="lines">
  <thead><tr><th>Field</th><th style="text-align:right">Previously Reported</th><th style="text-align:right">Corrected</th></tr></thead>
  <tbody>
    ${fmtPair('Employee SSN', form.prev.employee_ssn, form.corrected.employee_ssn, 'text')}
    ${fmtPair('First name', form.prev.employee_first_name, form.corrected.employee_first_name, 'text')}
    ${fmtPair('Last name', form.prev.employee_last_name, form.corrected.employee_last_name, 'text')}
    ${fmtPair('Address', form.prev.employee_address, form.corrected.employee_address, 'text')}
    ${fmtPair('Box 1 Wages, tips, other comp', form.prev.box1_wages_tips, form.corrected.box1_wages_tips)}
    ${fmtPair('Box 2 Federal income tax withheld', form.prev.box2_fed_income_tax, form.corrected.box2_fed_income_tax)}
    ${fmtPair('Box 3 Social Security wages', form.prev.box3_ss_wages, form.corrected.box3_ss_wages)}
    ${fmtPair('Box 4 Social Security tax', form.prev.box4_ss_tax, form.corrected.box4_ss_tax)}
    ${fmtPair('Box 5 Medicare wages', form.prev.box5_medicare_wages, form.corrected.box5_medicare_wages)}
    ${fmtPair('Box 6 Medicare tax', form.prev.box6_medicare_tax, form.corrected.box6_medicare_tax)}
    ${fmtPair('Box 15 State', form.prev.box15_state, form.corrected.box15_state, 'text')}
    ${fmtPair('Box 16 State wages', form.prev.box16_state_wages, form.corrected.box16_state_wages)}
    ${fmtPair('Box 17 State income tax', form.prev.box17_state_income_tax, form.corrected.box17_state_income_tax)}
  </tbody>
</table>
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> W-2c is filed with the SSA along with Form W-3c (corrected transmittal). Provide Copy B and Copy C to the employee. If only the SSN was wrong, special instructions apply — see IRS General Instructions for Forms W-2 and W-3.</div>
</body></html>`;
}

// ── Form 1096 (Transmittal cover) ─────────────────────────────

export function form1096HTML(data: Form1096Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1096 ${data.year} — ${escape(data.filer_name)}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form 1096 — Annual Summary and Transmittal of U.S. Information Returns</div>
  <div class="form-subtitle">Tax Year ${data.year} · ${data.total_forms} form(s) · ${fmtMoney(data.total_reported)} total reported</div>
  <div class="form-meta">${escape(data.filer_name)} · EIN ${escape(data.filer_ein) || '__-_______'} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>
${data.warnings.length > 0 ? `<div class="warnings"><strong>Notes:</strong><ul>${data.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}
<div class="filer-block">
  <div class="filer-card">
    <div class="label">Filer</div>
    <div class="value">${escape(data.filer_name)}</div>
    <div class="value">${escape(data.filer_address)}</div>
    <div class="value">${escape(data.filer_city)}, ${escape(data.filer_state)} ${escape(data.filer_zip)}</div>
    ${data.contact_name ? `<div class="value">Contact: ${escape(data.contact_name)}</div>` : ''}
  </div>
  <div class="filer-card">
    <div class="label">Filing</div>
    <div class="value">EIN: ${escape(data.filer_ein)}</div>
    <div class="value">Phone: ${escape(data.filer_phone)}</div>
    <div class="value">Email: ${escape(data.filer_email)}</div>
  </div>
</div>
<div class="section-header">Box 3 — Forms by Variant</div>
<table class="lines">
  <thead><tr><th>Form</th><th>1096 Box</th><th style="text-align:right">Forms Count</th><th style="text-align:right">Ready to File</th><th style="text-align:right">Total Amount</th></tr></thead>
  <tbody>
    ${data.rows.length === 0 ? `<tr><td colspan="5" style="padding:14px;text-align:center;color:#94a3b8">No 1099 forms found for ${data.year}.</td></tr>` :
      data.rows.map((r) => `<tr>
        <td class="line-num">${escape(r.variant)}</td>
        <td>Check box ${escape(r.irs_box)}</td>
        <td class="line-amt">${r.forms_count}</td>
        <td class="line-amt" style="color:${r.ready_to_file_count === r.forms_count ? '#16a34a' : '#d97706'}">${r.ready_to_file_count} / ${r.forms_count}</td>
        <td class="line-amt">${fmtMoney(r.total_amount)}</td>
      </tr>`).join('')}
  </tbody>
</table>
<div class="section-header">Totals</div>
<table class="lines">
  <tbody>
    <tr><td class="line-num">3</td><td>Total number of forms (across all variants)</td><td class="line-amt totals">${data.total_forms}</td></tr>
    <tr><td class="line-num">4</td><td>Federal income tax withheld</td><td class="line-amt">${fmtMoney(data.total_fed_withheld)}</td></tr>
    <tr><td class="line-num">5</td><td>Total amount reported</td><td class="line-amt totals">${fmtMoney(data.total_reported)}</td></tr>
  </tbody>
</table>
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Form 1096 is the cover sheet for PAPER filings only — if you e-file via FIRE or IRIS, no 1096 is needed. <strong>File a SEPARATE Form 1096 for each 1099 variant</strong> (one for all 1099-NECs, one for all 1099-MISCs, etc.). Check ONLY ONE box per 1096 in the lower section identifying which variant the cover sheet applies to.</div>
</body></html>`;
}

// ── Helper: Schedule line table ────────────────────────────────

function scheduleLines(rows: Array<[string, string, number | string]>): string {
  return `<table class="lines"><tbody>${rows.map(([n, label, v]) => `<tr><td class="line-num">${escape(n)}</td><td>${escape(label)}</td><td class="line-amt">${typeof v === 'number' ? fmtMoney(v) : escape(String(v))}</td></tr>`).join('')}</tbody></table>`;
}

function scheduleHeader(title: string, subtitle: string, name: string, year: number): string {
  return `<div class="form-header">
    <div class="form-title">${escape(title)}</div>
    <div class="form-subtitle">${escape(subtitle)}</div>
    <div class="form-meta">${escape(name)} · Tax year ${year} · Generated ${new Date().toLocaleDateString('en-US')}</div>
  </div>`;
}

function scheduleWarnings(warnings: string[]): string {
  if (warnings.length === 0) return '';
  return `<div class="warnings"><strong>Notes:</strong><ul>${warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></div>`;
}

// ── Schedule 1 (Additional Income / Adjustments) ──────────────

export function schedule1HTML(data: Schedule1Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Schedule 1 ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Schedule 1 (Form 1040) — Additional Income and Adjustments to Income', `Tax Year ${data.year}`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Part I — Additional Income</div>
${scheduleLines([
  ['1', 'Taxable refunds of state/local income tax', data.line1_taxable_refunds],
  ['2a', 'Alimony received', data.line2a_alimony_received],
  ['3', 'Business income (from Schedule C)', data.line3_business_income],
  ['4', 'Other gains or losses (Form 4797)', data.line4_other_gains],
  ['5', 'Rental real estate, royalties (Schedule E)', data.line5_rental_real_estate],
  ['6', 'Farm income (Schedule F)', data.line6_farm_income],
  ['7', 'Unemployment compensation', data.line7_unemployment_comp],
  ['9', 'Total other income', data.line9_total_other_income],
  ['10', 'Total additional income (sum)', data.line10_total_additional_income],
])}
<div class="section-header">Part II — Adjustments to Income</div>
${scheduleLines([
  ['11', 'Educator expenses', data.line11_educator_expenses],
  ['13', 'HSA deduction', data.line13_hsa_deduction],
  ['15', 'Deductible part of SE tax (½ from Schedule SE)', data.line15_se_tax_deduction],
  ['16', 'Self-employed health insurance', data.line16_se_health_insurance],
  ['17', 'Self-employed retirement contributions', data.line17_se_retirement_contributions],
  ['20', 'IRA deduction', data.line20_ira_deduction],
  ['21', 'Student loan interest', data.line21_student_loan_interest],
  ['26', 'Total adjustments (sum)', data.line26_total_adjustments],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Line 10 carries to Form 1040 line 8. Line 26 carries to Form 1040 line 10. Lines 3 and 15 are autofilled from your Schedule C and Schedule SE worksheets — most other lines are personal and need manual entry.</div>
</body></html>`;
}

// ── Schedule 2 (Additional Tax) ───────────────────────────────

export function schedule2HTML(data: Schedule2Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Schedule 2 ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Schedule 2 (Form 1040) — Additional Taxes', `Tax Year ${data.year}`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Part I — Tax</div>
${scheduleLines([
  ['1', 'Alternative minimum tax (Form 6251)', data.line1_amt],
  ['2', 'Excess advance premium tax credit (Form 8962)', data.line2_excess_advance_premium_credit],
  ['3', 'Total (line 1 + line 2)', data.line3_total_part1],
])}
<div class="section-header">Part II — Other Taxes</div>
${scheduleLines([
  ['4', 'Self-employment tax (Schedule SE)', data.line4_se_tax],
  ['7', 'Total addtl SS / Medicare taxes', data.line7_total_addtl_ss_medicare],
  ['8', 'Additional tax on IRAs (Form 5329)', data.line8_addtl_tax_iras],
  ['9', 'Household employment taxes (Schedule H)', data.line9_household_employment_taxes],
  ['11', 'Additional Medicare Tax (Form 8959)', data.line11_addtl_medicare_tax],
  ['12', 'Net investment income tax (Form 8960)', data.line12_net_investment_income_tax],
  ['21', 'Total other taxes (sum)', data.line21_total_other_taxes],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Line 3 carries to Form 1040 line 17. Line 21 carries to Form 1040 line 23. Line 4 (SE tax) is autofilled from your Schedule SE — most other lines are situational and need manual entry.</div>
</body></html>`;
}

// ── Schedule 3 (Additional Credits and Payments) ──────────────

export function schedule3HTML(data: Schedule3Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Schedule 3 ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Schedule 3 (Form 1040) — Additional Credits and Payments', `Tax Year ${data.year}`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Part I — Nonrefundable Credits</div>
${scheduleLines([
  ['1', 'Foreign tax credit', data.line1_foreign_tax_credit],
  ['2', 'Credit for child and dependent care', data.line2_dependent_care_credit],
  ['3', 'Education credits', data.line3_education_credit],
  ['4', 'Retirement savings contributions credit', data.line4_retirement_savings_credit],
  ['5a', 'Residential clean energy credit', data.line5a_residential_clean_energy],
  ['5b', 'Energy efficient home improvement credit', data.line5b_energy_efficient_home],
  ['7', 'Total other nonrefundable credits', data.line7_total_other_credits],
  ['8', 'Total nonrefundable credits (sum)', data.line8_total_part1],
])}
<div class="section-header">Part II — Refundable Credits and Other Payments</div>
${scheduleLines([
  ['9', 'Net premium tax credit (Form 8962)', data.line9_net_premium_tax_credit],
  ['10', 'Amount paid with extension (Form 4868)', data.line10_amount_paid_with_extension],
  ['11', 'Excess SS / Tier 1 RRTA tax', data.line11_excess_ss_tier1_rrta_tax],
  ['12', 'Credit for federal tax on fuels (Form 4136)', data.line12_credit_fed_tax_on_fuels],
  ['15', 'Total payments (sum)', data.line15_total_part2],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Line 8 carries to Form 1040 line 20. Line 15 carries to Form 1040 line 31. Most credits on Schedule 3 are personal (children, education, energy) — fill any applicable manually.</div>
</body></html>`;
}

// ── Schedule A (Itemized Deductions) ──────────────────────────

export function scheduleAHTML(data: ScheduleAData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Schedule A ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Schedule A (Form 1040) — Itemized Deductions', `Tax Year ${data.year}`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Medical and Dental Expenses</div>
${scheduleLines([
  ['1', 'Medical and dental expenses', data.line1_medical_dental],
  ['2', 'AGI (from 1040 line 11)', data.line2_agi],
  ['3', 'AGI floor (line 2 × 7.5%)', data.line3_agi_floor],
  ['4', 'Medical deduction (line 1 − line 3, ≥ 0)', data.line4_medical_deduction],
])}
<div class="section-header">Taxes You Paid</div>
${scheduleLines([
  ['5a', 'State / local income or sales tax', data.line5a_state_local_income_or_sales],
  ['5b', 'State / local real estate taxes', data.line5b_state_local_real_estate],
  ['5c', 'State / local personal property taxes', data.line5c_state_local_personal_property],
  ['5d', 'Sum of 5a + 5b + 5c', data.line5d_total_5a_5b_5c],
  ['5e', 'Smaller of 5d or $10,000 (SALT cap)', data.line5e_smaller_of_5d_or_10000],
  ['7', 'Total taxes (5e + 6)', data.line7_total_taxes],
])}
<div class="section-header">Interest, Charity, Other</div>
${scheduleLines([
  ['8e', 'Total home mortgage interest', data.line8e_total_8a_8b_8c],
  ['9', 'Investment interest', data.line9_investment_interest],
  ['10', 'Total interest (8e + 9)', data.line10_total_interest],
  ['14', 'Total gifts to charity', data.line14_total_charity],
  ['15', 'Casualty and theft losses (Form 4684)', data.line15_casualty_theft],
  ['16', 'Total other itemized', data.line16_total_other],
  ['17', 'TOTAL ITEMIZED DEDUCTIONS', data.line17_total_itemized],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Line 17 carries to Form 1040 line 12. Compare against your standard deduction (single $15,000 / MFJ $30,000 / HoH $22,500 for 2025) — only itemize if line 17 is greater. SALT (line 5e) is capped at $10,000.</div>
</body></html>`;
}

// ── Schedule B (Interest and Ordinary Dividends) ──────────────

export function scheduleBHTML(data: ScheduleBData): string {
  const renderPayers = (payers: Array<{ name: string; amount: number }>) => payers.length === 0
    ? `<div style="padding:8px 12px;color:#94a3b8;font-size:11px">No payers entered.</div>`
    : `<table class="lines"><tbody>${payers.map((p, i) => `<tr><td class="line-num">${i + 1}</td><td>${escape(p.name)}</td><td class="line-amt">${fmtMoney(p.amount)}</td></tr>`).join('')}</tbody></table>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Schedule B ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Schedule B (Form 1040) — Interest and Ordinary Dividends', `Tax Year ${data.year}`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Part I — Interest</div>
${renderPayers(data.line1_interest_payers)}
${scheduleLines([
  ['2', 'Total interest', data.line2_total_interest],
  ['3', 'Excludable savings bond interest', data.line3_excluded_interest],
  ['4', 'Taxable interest (carries to 1040 line 2b)', data.line4_taxable_interest],
])}
<div class="section-header">Part II — Ordinary Dividends</div>
${renderPayers(data.line5_dividend_payers)}
${scheduleLines([
  ['6', 'Total ordinary dividends (carries to 1040 line 3b)', data.line6_total_dividends],
])}
<div class="section-header">Part III — Foreign Accounts and Trusts</div>
${scheduleLines([
  ['7a', 'Financial interest in foreign account (Yes/No)', data.line7a_foreign_account_yes ? 'Yes' : 'No'],
  ['7a', 'Country (if Yes)', data.line7a_country || '—'],
  ['7b', 'Required to file FinCEN 114 (FBAR)', data.line7b_required_to_file_fbar ? 'Yes' : 'No'],
  ['8', 'Distribution from / grantor of foreign trust', data.line8_foreign_trust ? 'Yes' : 'No'],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Schedule B is required when interest > $1,500 OR dividends > $1,500 OR you have a foreign account. Pass interest/dividend payers via opts.interest_payers and opts.dividend_payers — autofill from received 1099-INT/DIV is queued for a future wave.</div>
</body></html>`;
}

// ── Schedule D (Capital Gains and Losses) ─────────────────────

export function scheduleDHTML(data: ScheduleDData): string {
  const renderTxns = (lines: Array<{ description: string; date_acquired: string; date_sold: string; proceeds: number; cost_basis: number; gain_loss: number }>) => {
    if (lines.length === 0) return `<div style="padding:8px 12px;color:#94a3b8;font-size:11px">No transactions entered.</div>`;
    return `<table class="lines"><thead><tr><th>Description</th><th>Acquired</th><th>Sold</th><th style="text-align:right">Proceeds</th><th style="text-align:right">Basis</th><th style="text-align:right">Gain/Loss</th></tr></thead><tbody>${lines.map((l) => `<tr>
      <td>${escape(l.description)}</td>
      <td style="font-size:10px;color:#64748b">${escape(l.date_acquired)}</td>
      <td style="font-size:10px;color:#64748b">${escape(l.date_sold)}</td>
      <td class="line-amt">${fmtMoney(l.proceeds)}</td>
      <td class="line-amt">${fmtMoney(l.cost_basis)}</td>
      <td class="line-amt" style="color:${l.gain_loss >= 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(l.gain_loss)}</td>
    </tr>`).join('')}</tbody></table>`;
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Schedule D ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Schedule D (Form 1040) — Capital Gains and Losses', `Tax Year ${data.year}`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Part I — Short-Term (Held ≤ 1 year)</div>
${renderTxns(data.line1a_basis_reported_short)}
${scheduleLines([
  ['6', 'Short-term capital loss carryover', data.line6_short_term_carryover],
  ['7', 'TOTAL short-term gain/loss', data.line7_total_short_term_gain_loss],
])}
<div class="section-header">Part II — Long-Term (Held > 1 year)</div>
${renderTxns(data.line8a_basis_reported_long)}
${scheduleLines([
  ['14', 'Long-term capital loss carryover', data.line14_long_term_carryover],
  ['15', 'TOTAL long-term gain/loss', data.line15_total_long_term_gain_loss],
])}
<div class="section-header">Part III — Summary</div>
${scheduleLines([
  ['16', 'Combined total (line 7 + line 15)', data.line16_combined_total],
  ['21', 'Capital loss limitation (max $3,000 deduction this year)', data.line21_capital_loss_limit],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Line 16 carries to Form 1040 line 7. Net capital losses > $3,000 carry forward to next year (line 6 / line 14 on next year's Schedule D). Use Form 8949 to detail individual transactions before summarizing here.</div>
</body></html>`;
}

// ── Form 1040-ES (Quarterly Estimated Tax Vouchers) ───────────

export function form1040ESHTML(data: Form1040ESData): string {
  const renderVoucher = (v: Form1040ESData['vouchers'][number]) => `<div style="border:2px solid #0f172a;border-radius:6px;padding:14px;margin:10px 0;page-break-inside:avoid">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#64748b">Voucher ${v.voucher_number} of 4</div>
        <div style="font-size:14px;font-weight:700">Form 1040-ES Payment Voucher</div>
        <div style="font-size:11px;color:#475569">Due ${escape(v.due_date_label)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#64748b">Amount</div>
        <div style="font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;color:#dc2626">${fmtMoney(v.amount)}</div>
      </div>
    </div>
    <div style="font-size:11px;color:#475569;line-height:1.5">
      Make check payable to <strong>"United States Treasury"</strong>. Write your SSN, "${data.year} Form 1040-ES", and the voucher number on the check. Mail to the address for your state listed in Form 1040-ES instructions, or pay online at <strong>irs.gov/payments</strong>.
    </div>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1040-ES ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 1040-ES — Estimated Tax for Individuals', `Tax Year ${data.year} · 4 Quarterly Vouchers`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Estimated Tax Worksheet</div>
${scheduleLines([
  ['1', 'Projected business income (Schedule C, annualized)', data.projected_business_income],
  ['2', 'Other income', data.projected_other_income],
  ['3', 'Adjustments (½ SE tax, etc.)', data.projected_adjustments],
  ['4', 'Projected AGI', data.projected_agi],
  ['5', 'Standard deduction', data.projected_standard_deduction],
  ['6', 'QBI deduction (20% of business income, simple case)', data.projected_qbi_deduction],
  ['7', 'Projected taxable income', data.projected_taxable_income],
  ['8', 'Projected income tax (brackets × line 7)', data.projected_income_tax],
  ['9', 'Projected SE tax (Schedule SE)', data.projected_se_tax],
  ['10', 'TOTAL projected tax (8 + 9)', data.projected_total_tax],
  ['11', 'Withholding credits (W-2 / 1099)', data.withholding_credits],
  ['12', 'Net estimated tax (10 − 11)', data.net_estimated_tax],
])}
<div class="section-header">Safe Harbor Comparison</div>
${scheduleLines([
  ['A', 'Prior year total tax (× 110% if AGI > $150K)', data.safe_harbor_prior_year],
  ['B', 'Current year safe harbor (90% × line 12)', data.safe_harbor_current_year],
  ['C', 'Recommended total (lower of A and B)', data.recommended_total],
  ['D', 'Quarterly payment (line C ÷ 4)', data.recommended_quarterly],
])}
<div class="section-header">Quarterly Vouchers</div>
${data.vouchers.map(renderVoucher).join('')}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Pay any of the safe-harbor amounts to avoid the underpayment penalty: 100% of prior year's tax (110% if AGI > $150K) OR 90% of current year's projected tax. The lower amount is recommended. Recompute in Q2/Q3 if your YTD income changes significantly. Pay online at irs.gov/payments instead of mailing the voucher when possible.</div>
</body></html>`;
}

// ── Form 8995 (QBI Simplified) ────────────────────────────────

export function form8995HTML(data: Form8995Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 8995 ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 8995 — QBI Deduction (Simplified)', `Tax Year ${data.year} · Eligible if taxable income ≤ ${fmtMoney(data.threshold_single)} single / ${fmtMoney(data.threshold_mfj)} MFJ`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Line 1 — Qualified Trades / Businesses</div>
<table class="lines">
  <thead><tr><th>Row</th><th>(a) Name</th><th>(b) TIN</th><th style="text-align:right">(c) QBI</th></tr></thead>
  <tbody>
    ${data.line1_trades_businesses.map((t, i) => `<tr>
      <td class="line-num">${['i','ii','iii','iv','v'][i]}</td>
      <td>${escape(t.name) || '<span style="color:#94a3b8">—</span>'}</td>
      <td style="font-family:'SF Mono',Menlo,monospace;color:#64748b">${escape(t.tin)}</td>
      <td class="line-amt">${t.qbi !== 0 ? fmtMoney(t.qbi) : '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>
${scheduleLines([
  ['2', 'Total QBI (sum of line 1 column c)', data.line2_total_qbi],
  ['3', 'QBI loss carryforward from prior year (negative)', data.line3_qbi_loss_carryforward],
  ['4', 'Total QBI after carryforward (≥ 0)', data.line4_total_qbi_after_carryforward],
  ['5', 'QBI component (line 4 × 20%)', data.line5_qbi_component],
  ['6', 'REIT dividends + PTP income', data.line6_reit_ptp_income],
  ['7', 'REIT/PTP loss carryforward (negative)', data.line7_reit_ptp_loss_carryforward],
  ['8', 'Total REIT/PTP (≥ 0)', data.line8_total_reit_ptp],
  ['9', 'REIT/PTP component (line 8 × 20%)', data.line9_reit_ptp_component],
  ['10', 'QBI deduction before income limit (5 + 9)', data.line10_qbi_before_income_limit],
  ['11', 'Taxable income before QBI deduction', data.line11_taxable_income_before_qbi],
  ['12', 'Net capital gain + qualified dividends', data.line12_net_capital_gain],
  ['13', 'Subtract (11 − 12, ≥ 0)', data.line13_taxable_income_minus_cg],
  ['14', 'Income limitation (line 13 × 20%)', data.line14_income_limitation],
  ['15', 'QBI DEDUCTION (smaller of 10 or 14)', data.line15_qbi_deduction],
  ['16', 'QBI loss carryforward to next year', data.line16_qbi_loss_carryforward_to_next_year],
  ['17', 'REIT/PTP loss carryforward to next year', data.line17_reit_ptp_loss_carryforward_to_next_year],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Line 15 carries to Form 1040 line 13. The QBI deduction is the most-missed deduction for pass-through entity owners — it's 20% of qualified business income, capped at 20% of taxable income excluding net capital gains.</div>
</body></html>`;
}

// ── Form 4562 (Depreciation) ──────────────────────────────────

export function form4562HTML(data: Form4562Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 4562 ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 4562 — Depreciation and Amortization', `Tax Year ${data.year} · ${data.asset_count} fixed asset(s) · Total depreciation ${fmtMoney(data.line22_total_depreciation)}`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Part I — Section 179 (Immediate Expensing)</div>
${scheduleLines([
  ['1', 'Maximum amount allowed', data.line1_max_section_179],
  ['2', 'Total cost of Section 179 property', data.line2_total_property_cost_section_179],
  ['3', 'Threshold (begins phase-out)', data.line3_threshold_phase_out],
  ['4', 'Reduction in limit (line 2 − line 3, ≥ 0)', data.line4_reduction_in_limit],
  ['5', 'Dollar limit (line 1 − line 4, ≥ 0)', data.line5_dollar_limit],
  ['8', 'Total elected', data.line8_total_elected],
  ['9', 'Tentative deduction (smaller of 5 or 8)', data.line9_tentative_deduction],
  ['10', 'Carryover from prior year', data.line10_carryover_prior_year],
  ['11', 'Business income limit', data.line11_business_income_limit],
  ['12', 'SECTION 179 DEDUCTION', data.line12_section_179_deduction],
  ['13', 'Carryover to next year', data.line13_carryover_to_next_year],
])}

<div class="section-header">Part II — Bonus Depreciation</div>
${scheduleLines([
  ['14', 'Property eligible for bonus depreciation (basis)', data.line14_bonus_property_basis],
  ['15', 'Bonus depreciation (40% for 2025)', data.line15_bonus_depreciation],
])}

<div class="section-header">Part III — MACRS Depreciation (placed in service this year)</div>
${scheduleLines([
  ['17', 'Pre-year MACRS property', data.line17_macrs_pre_year_property],
  ['19a', '3-year property', data.line19a_3yr_property],
  ['19b', '5-year property (autos, computers)', data.line19b_5yr_property],
  ['19c', '7-year property (office furniture)', data.line19c_7yr_property],
  ['19d', '10-year property', data.line19d_10yr_property],
  ['19e', '15-year property (land improvements)', data.line19e_15yr_property],
  ['19f', '20-year property', data.line19f_20yr_property],
  ['19h', 'Residential rental (27.5 yr)', data.line19h_residential_rental],
  ['19i', 'Nonresidential real (39 yr)', data.line19i_nonresidential_real],
])}

<div class="section-header">Part IV — Summary</div>
${scheduleLines([
  ['21', 'Listed property amount (from Part V)', data.line21_listed_property_amount],
  ['22', 'TOTAL DEPRECIATION (sum of 12, 15, 17, 19, 21)', data.line22_total_depreciation],
])}

${data.listed_property.length > 0 ? `<div class="section-header">Part V — Listed Property (Vehicles, Computers)</div>
<table class="lines">
  <thead><tr><th>Description</th><th>In Service</th><th style="text-align:right">Cost</th><th style="text-align:right">Bus %</th><th style="text-align:right">Depreciation</th></tr></thead>
  <tbody>
    ${data.listed_property.map((l) => `<tr>
      <td>${escape(l.description)}</td>
      <td style="font-size:10px;color:#64748b">${escape(l.date_placed_in_service)}</td>
      <td class="line-amt">${fmtMoney(l.cost)}</td>
      <td class="line-amt">${l.business_use_percentage.toFixed(1)}%</td>
      <td class="line-amt">${fmtMoney(l.current_year_depreciation)}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Total depreciation (line 22) carries to Schedule C line 13. Section 179 has an annual cap of $1.25M (2025) phasing out above $3.13M total purchases. Bonus depreciation rate declines: 60% (2024) → 40% (2025) → 20% (2026) → 0% (2027+) unless Congress acts.</div>
</body></html>`;
}

// ── Form 8829 (Home Office) ───────────────────────────────────

export function form8829HTML(data: Form8829Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 8829 ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 8829 — Expenses for Business Use of Your Home', `Tax Year ${data.year} · Business use ${data.line3_business_pct.toFixed(2)}% · Deduction ${fmtMoney(data.line35_total_home_office_deduction)}`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Part I — Part of Your Home Used for Business</div>
${scheduleLines([
  ['1', 'Area used regularly and exclusively for business (sq ft)', data.line1_business_sq_ft],
  ['2', 'Total area of home (sq ft)', data.line2_total_sq_ft],
  ['3', 'Business percentage (line 1 / line 2 × 100)', data.line3_business_pct.toFixed(4) + '%'],
  ['7', 'Business use percentage', data.line7_business_use_pct.toFixed(4) + '%'],
])}
<div class="section-header">Part II — Allowable Deduction</div>
${scheduleLines([
  ['8', 'Gross income from home use (Sch C tentative profit)', data.line8_gross_income_from_home_use],
  ['10', 'Deductible mortgage interest (full)', data.line10_deductible_mortgage_interest],
  ['11', 'Real estate taxes (full)', data.line11_real_estate_taxes],
  ['13', 'Multiply line 12 by business %', data.line13_multiply_line_12_by_business_pct],
  ['15', 'Income limit before other expenses', data.line15_subtract_line_14_from_line_8],
  ['18', 'Insurance × business %', data.line18_insurance_indirect],
  ['19', 'Rent × business %', data.line19_rent_indirect],
  ['20', 'Repairs/maintenance × business %', data.line20_repairs_maintenance_indirect],
  ['21', 'Utilities × business %', data.line21_utilities_indirect],
  ['25', 'Total operating expenses × business %', data.line25_multiply_line_24_by_business_pct],
  ['26', 'Add direct expenses', data.line26_add_line_23],
  ['27', 'Carryover from prior year', data.line27_carryover_prior_year],
  ['28', 'ALLOWABLE operating expenses (income-limited)', data.line28_allowable_operating_expenses],
  ['29', 'Remaining income for depreciation', data.line29_remaining_income],
  ['31', 'Depreciation of home', data.line31_depreciation_of_home],
  ['33', 'Total depreciation + carryover', data.line33_total_lines_30_31_32],
  ['34', 'ALLOWABLE depreciation (income-limited)', data.line34_allowable_depreciation],
  ['35', 'TOTAL HOME OFFICE DEDUCTION (→ Sch C line 30)', data.line35_total_home_office_deduction],
])}
<div class="section-header">Part III — Depreciation Worksheet</div>
${scheduleLines([
  ['36', 'Smaller of basis or FMV', data.line36_smaller_of_basis_or_fmv],
  ['37', 'Value of land (does not depreciate)', data.line37_value_of_land],
  ['38', 'Basis of building', data.line38_basis_of_building],
  ['39', 'Business basis of building (line 38 × business %)', data.line39_business_basis_of_building],
  ['40', 'Depreciation rate (39-yr SL nonresidential)', (data.line40_depreciation_pct * 100).toFixed(3) + '%'],
  ['41', 'Annual depreciation', data.line41_depreciation_for_year],
])}
<div class="section-header">Part IV — Carryover to Next Year</div>
${scheduleLines([
  ['42', 'Operating expenses carryover', data.line42_operating_expenses_carryover],
  ['44', 'Depreciation carryover', data.line44_depreciation_carryover],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Line 35 carries to Schedule C line 30. The home-office deduction CANNOT create a loss — operating expenses (line 28) and depreciation (line 34) are each income-limited and excess carries forward. Renters skip Part III. Tip: simplified method ($5 × business sq ft, capped at 300 sq ft = $1,500) skips this whole form.</div>
</body></html>`;
}

// ── Form 4797 (Sale of Business Property) ─────────────────────

export function form4797HTML(data: Form4797Data): string {
  const renderTxns = (txns: any[]) => {
    if (txns.length === 0) return `<div style="padding:8px 12px;color:#94a3b8;font-size:11px">No transactions.</div>`;
    return `<table class="lines"><thead><tr><th>Description</th><th>Acquired</th><th>Sold</th><th style="text-align:right">Proceeds</th><th style="text-align:right">Basis</th><th style="text-align:right">Gain/Loss</th></tr></thead><tbody>${txns.map((t: any) => `<tr>
      <td>${escape(t.description)}</td>
      <td style="font-size:10px;color:#64748b">${escape(t.date_acquired)}</td>
      <td style="font-size:10px;color:#64748b">${escape(t.date_sold)}</td>
      <td class="line-amt">${fmtMoney(t.gross_sales_price)}</td>
      <td class="line-amt">${fmtMoney(Math.max(0, (Number(t.cost_or_basis) || 0) - (Number(t.depreciation_allowed) || 0)))}</td>
      <td class="line-amt" style="color:${t.gain_loss >= 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(t.gain_loss)}</td>
    </tr>`).join('')}</tbody></table>`;
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 4797 ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 4797 — Sales of Business Property', `Tax Year ${data.year} · ${data.line2_section_1231_transactions.length + data.line10_ordinary_transactions.length} transaction(s)`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="section-header">Part I — Section 1231 Property (held > 1 year)</div>
${renderTxns(data.line2_section_1231_transactions)}
${scheduleLines([
  ['7', 'Net Section 1231 gain/loss', data.line7_combine_lines_6],
  ['8', 'Nonrecaptured Section 1231 losses (prior 5 years)', data.line8_nonrecaptured_section_1231_losses],
  ['9', 'NET (gain → long-term capital gain; loss → ordinary)', data.line9_subtract_line_8],
])}
<div class="section-header">Part II — Ordinary Gains/Losses</div>
${renderTxns(data.line10_ordinary_transactions)}
${scheduleLines([
  ['13', 'Section 1245 recapture (from Part III)', data.line13_gain_ordinary_2],
  ['15', 'Section 179/280F recapture', data.line15_recapture_section_179_280f],
  ['17', 'Net ordinary gain/loss', data.line17_combine_lines_10_16],
])}
<div class="section-header">Part III — Section 1245 Recapture (Depreciation Recapture)</div>
${renderTxns(data.line19_section_1245_property)}
${scheduleLines([
  ['22', 'TOTAL Section 1245 recapture (carries to Part II line 13)', data.line22_total_section_1245_recapture],
  ['26', 'Section 1250 gain (real property)', data.line26_total_gain_section_1250],
])}
<div class="section-header">Part IV — Section 179 / 280F Recapture</div>
${scheduleLines([
  ['33', 'Section 179 recapture', data.line33_section_179_recapture],
  ['34', 'Section 280F(b)(2) recapture', data.line34_section_280f_recapture],
  ['35', 'TOTAL recapture (carries to Part II line 15)', data.line35_total_recapture],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Section 1231 net gain → long-term capital gain (Sch D). Section 1231 net loss → ordinary deduction. Section 1245 recapture (depreciation taken on equipment) comes back as ORDINARY income, not capital gain — that's the IRS clawing back the depreciation deduction at ordinary rates.</div>
</body></html>`;
}

// ── Form 7004 (Business Extension) ────────────────────────────

export function form7004HTML(data: Form7004Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 7004 — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 7004 — Application for Automatic Extension', `For ${escape(data.form_code_description)} · 6-month extension`, data.taxpayer_name, parseInt(data.tax_year_end.slice(0, 4)))}
${scheduleWarnings(data.warnings)}
<div class="filer-block">
  <div class="filer-card">
    <div class="label">Filer</div>
    <div class="value">${escape(data.taxpayer_name)}</div>
    ${data.trade_name && data.trade_name !== data.taxpayer_name ? `<div class="value">DBA: ${escape(data.trade_name)}</div>` : ''}
    <div class="value">${escape(data.address)}</div>
    <div class="value">${escape(data.city)}, ${escape(data.state)} ${escape(data.zip)}</div>
    <div class="value">EIN: ${escape(data.ein)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Extension Details</div>
    <div class="value">Form code: ${escape(data.form_code)}</div>
    <div class="value">Original due: ${escape(data.original_due_date)}</div>
    <div class="value">Extended due: <strong>${escape(data.extended_due_date)}</strong></div>
    <div class="value">Tax year: ${escape(data.tax_year_start)} → ${escape(data.tax_year_end)}</div>
  </div>
</div>
<div class="section-header">Part I — Form for Which Extension Is Filed</div>
<div style="padding:10px 12px;background:#f8fafc;border-radius:4px;font-size:11px"><strong>Code ${escape(data.form_code)}:</strong> ${escape(data.form_code_description)}</div>
<div class="section-header">Part II — Tax Computation</div>
${scheduleLines([
  ['6', 'Tentative total tax for the year (estimate)', data.line6_tentative_total_tax],
  ['7', 'Total payments and credits', data.line7_total_payments_credits],
  ['8', 'BALANCE DUE (line 6 − line 7) — pay with this form', data.line8_balance_due],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> File Form 7004 BY the original due date (${escape(data.original_due_date)}) to get the automatic 6-month extension to ${escape(data.extended_due_date)}. Pay the balance due (line 8) with this form via EFTPS, IRS Direct Pay, or check — an extension to FILE is not an extension to PAY. Failure-to-pay penalty (0.5%/month) applies on unpaid balances.</div>
</body></html>`;
}

// ── Form 4868 (Individual Extension) ──────────────────────────

export function form4868HTML(data: Form4868Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 4868 ${data.year} — ${escape(data.taxpayer_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 4868 — Application for Automatic Extension (Individual)', `Tax Year ${data.year} · Extends 1040 deadline 6 months`, data.taxpayer_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="filer-block">
  <div class="filer-card">
    <div class="label">Filer</div>
    <div class="value">${escape(data.taxpayer_name)}</div>
    ${data.spouse_name ? `<div class="value">Spouse: ${escape(data.spouse_name)}</div>` : ''}
    <div class="value">${escape(data.address)}</div>
    <div class="value">${escape(data.city)}, ${escape(data.state)} ${escape(data.zip)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Extension Details</div>
    <div class="value">Original due: ${escape(data.original_due_date)}</div>
    <div class="value">Extended due: <strong>${escape(data.extended_due_date)}</strong></div>
    ${data.is_out_of_country ? '<div class="value" style="color:#dc2626">Out-of-country filer (auto 2-mo + 4-mo)</div>' : ''}
  </div>
</div>
<div class="section-header">Tax Computation</div>
${scheduleLines([
  ['4', 'Estimated total tax for the year', data.line4_estimated_total_tax],
  ['5', 'Total payments (withholding + estimated)', data.line5_total_payments_2024],
  ['6', 'BALANCE DUE (line 4 − line 5)', data.line6_balance_due],
  ['7', 'Amount paying with this extension', data.line7_amount_paying_with_extension],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> File Form 4868 BY April 15 to get the automatic 6-month extension to October 15. Pay the balance due (line 6) with this form via EFTPS, IRS Direct Pay, or check — an extension to FILE is not an extension to PAY. Failure-to-pay penalty (0.5%/month) applies on unpaid balances.</div>
</body></html>`;
}

// ── Form 1065 (Partnership Return) ─────────────────────────────

export function form1065HTML(data: Form1065Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1065 ${data.year} — ${escape(data.entity_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 1065 — U.S. Return of Partnership Income', `Tax Year ${data.year} · ${data.number_of_partners} partner(s) · Net income ${fmtMoney(data.line23_ordinary_business_income)}`, data.entity_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="filer-block">
  <div class="filer-card">
    <div class="label">Partnership</div>
    <div class="value">${escape(data.entity_name)}</div>
    <div class="value">${escape(data.address)}, ${escape(data.city)}, ${escape(data.state)} ${escape(data.zip)}</div>
    <div class="value">EIN: ${escape(data.ein)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Activity</div>
    <div class="value">Business: ${escape(data.business_activity)}</div>
    <div class="value">Product/Service: ${escape(data.product_or_service)}</div>
    <div class="value">Code: ${escape(data.business_code)}</div>
  </div>
</div>
<div class="section-header">Income (lines 1-8)</div>
${scheduleLines([
  ['1a', 'Gross receipts or sales', data.line1a_gross_receipts],
  ['1b', 'Returns and allowances', data.line1b_returns_allowances],
  ['1c', 'Balance', data.line1c_balance],
  ['2', 'Cost of goods sold', data.line2_cost_of_goods_sold],
  ['3', 'Gross profit', data.line3_gross_profit],
  ['8', 'TOTAL income', data.line8_total_income],
])}
<div class="section-header">Deductions (lines 9-22)</div>
${scheduleLines([
  ['9', 'Salaries and wages', data.line9_salaries_wages],
  ['10', 'Guaranteed payments to partners', data.line10_guaranteed_payments_partners],
  ['11', 'Repairs and maintenance', data.line11_repairs_maintenance],
  ['13', 'Rent', data.line13_rent],
  ['14', 'Taxes and licenses', data.line14_taxes_licenses],
  ['15', 'Interest', data.line15_interest_paid],
  ['16c', 'Depreciation (net)', data.line16c_balance_depreciation],
  ['18', 'Retirement plans', data.line18_retirement_plans],
  ['19', 'Employee benefits', data.line19_employee_benefit_programs],
  ['21', 'Other deductions', data.line21_other_deductions],
  ['22', 'TOTAL deductions', data.line22_total_deductions],
  ['23', 'ORDINARY BUSINESS INCOME / LOSS (8 − 22)', data.line23_ordinary_business_income],
])}
<div class="section-header">Schedule K — Total Distributive Shares</div>
${scheduleLines([
  ['1', 'Ordinary business income (→ K-1 box 1)', data.schK_ordinary_business_income],
  ['4', 'Guaranteed payments (→ K-1 box 4)', data.schK_guaranteed_payments],
  ['5', 'Interest income (→ K-1 box 5)', data.schK_interest_income],
  ['6a', 'Ordinary dividends (→ K-1 box 6a)', data.schK_dividend_income],
  ['7', 'Royalties (→ K-1 box 7)', data.schK_royalties],
  ['9a', 'Net long-term capital gain (→ K-1 box 9a)', data.schK_net_long_term_cap_gain],
  ['10', 'Section 1231 gain (→ K-1 box 10)', data.schK_section_1231_gain],
  ['12', 'Section 179 deduction (→ K-1 box 12)', data.schK_section_179_deduction],
  ['14a', 'Self-employment earnings (→ K-1 box 14)', data.schK_self_employment_earnings],
])}
${data.partners.length > 0 ? `<div class="section-header">Partners (${data.partners.length})</div>
<table class="lines"><thead><tr><th>Name</th><th>TIN</th><th style="text-align:right">Ownership %</th></tr></thead><tbody>${data.partners.map((p) => `<tr><td>${escape(p.name)}</td><td style="font-family:'SF Mono',Menlo,monospace">${escape(p.ssn_or_ein)}</td><td class="line-amt">${(p.ownership_pct || 0).toFixed(2)}%</td></tr>`).join('')}</tbody></table>` : ''}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Form 1065 is due March 15 (or 6-mo extension to Sep 15 via Form 7004). Each partner gets a K-1 showing their proportional share — partners report on their personal returns. Schedule L (Balance Sheet) and Schedule M-1 (Book/Tax Reconciliation) required for partnerships with > $250K gross receipts or assets.</div>
</body></html>`;
}

// ── Form 1120 (C-Corp Return) ──────────────────────────────────

export function form1120HTML(data: Form1120Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1120 ${data.year} — ${escape(data.entity_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 1120 — U.S. Corporation Income Tax Return', `Tax Year ${data.year} · Total income ${fmtMoney(data.line11_total_income)} · Tax ${fmtMoney(data.line31_total_tax)}`, data.entity_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="filer-block">
  <div class="filer-card">
    <div class="label">Corporation</div>
    <div class="value">${escape(data.entity_name)}</div>
    <div class="value">${escape(data.address)}, ${escape(data.city)}, ${escape(data.state)} ${escape(data.zip)}</div>
    <div class="value">EIN: ${escape(data.ein)}</div>
    <div class="value">Incorporated: ${escape(data.date_incorporated)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Tax Year</div>
    <div class="value">Year: ${data.year}</div>
    <div class="value">Total assets: ${fmtMoney(data.total_assets)}</div>
    <div class="value">Tax rate: ${(data.schJ_tax_rate * 100).toFixed(0)}% flat (TCJA)</div>
  </div>
</div>
<div class="section-header">Income (lines 1-11)</div>
${scheduleLines([
  ['1c', 'Gross profit (sales − returns − COGS)', data.line1c_balance],
  ['3', 'Gross profit subtotal', data.line3_gross_profit],
  ['4', 'Dividends', data.line4_dividends_special_deductions],
  ['5', 'Interest', data.line5_interest],
  ['6', 'Gross rents', data.line6_gross_rents],
  ['7', 'Gross royalties', data.line7_gross_royalties],
  ['8', 'Capital gain net income', data.line8_capital_gain_net_income],
  ['10', 'Other income', data.line10_other_income],
  ['11', 'TOTAL income', data.line11_total_income],
])}
<div class="section-header">Deductions (lines 12-27)</div>
${scheduleLines([
  ['12', 'Compensation of officers', data.line12_compensation_officers],
  ['13', 'Salaries and wages', data.line13_salaries_wages],
  ['14', 'Repairs and maintenance', data.line14_repairs_maintenance],
  ['16', 'Rents', data.line16_rents],
  ['17', 'Taxes and licenses', data.line17_taxes_licenses],
  ['18', 'Interest', data.line18_interest],
  ['19', 'Charitable contributions', data.line19_charitable_contributions],
  ['20', 'Depreciation', data.line20_depreciation],
  ['22', 'Advertising', data.line22_advertising],
  ['23', 'Pension / profit sharing', data.line23_pension_profit_sharing],
  ['24', 'Employee benefit programs', data.line24_employee_benefit_programs],
  ['26', 'Other deductions', data.line26_other_deductions],
  ['27', 'TOTAL deductions', data.line27_total_deductions],
])}
<div class="section-header">Tax Computation</div>
${scheduleLines([
  ['28', 'Taxable income before NOL & special deductions', data.line28_taxable_income_before_nol_dividends_received],
  ['29a', 'Net operating loss deduction', data.line29a_net_operating_loss_deduction],
  ['29b', 'Special deductions', data.line29b_special_deductions],
  ['29c', 'Total NOL + special deductions', data.line29c_total_29a_29b],
  ['30', 'TAXABLE INCOME (line 28 − line 29c)', data.line30_taxable_income],
  ['31', 'TOTAL TAX (line 30 × 21%)', data.line31_total_tax],
  ['32', 'Estimated tax payments', data.line32_estimated_tax_payments],
  ['33', 'BALANCE DUE', data.line33_balance_due],
  ['34', 'Overpayment', data.line34_overpayment],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Form 1120 is due April 15 (or 6-mo extension via Form 7004). C-corp income is taxed at flat 21% (TCJA), then dividends to shareholders are taxed AGAIN on personal returns ("double taxation"). NOLs from 2018+ can be carried forward indefinitely, limited to 80% of taxable income each year.</div>
</body></html>`;
}

// ── Form 1120-S (S-Corp Return) ────────────────────────────────

export function form1120SHTML(data: Form1120SData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1120-S ${data.year} — ${escape(data.entity_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 1120-S — U.S. Income Tax Return for an S Corporation', `Tax Year ${data.year} · ${data.number_of_shareholders} shareholder(s) · Ordinary income ${fmtMoney(data.line21_ordinary_business_income_loss)}`, data.entity_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="filer-block">
  <div class="filer-card">
    <div class="label">S Corporation</div>
    <div class="value">${escape(data.entity_name)}</div>
    <div class="value">${escape(data.address)}, ${escape(data.city)}, ${escape(data.state)} ${escape(data.zip)}</div>
    <div class="value">EIN: ${escape(data.ein)}</div>
  </div>
  <div class="filer-card">
    <div class="label">S Election</div>
    <div class="value">Incorporated: ${escape(data.date_incorporated)}</div>
    <div class="value">S Election: ${escape(data.date_s_election) || '— missing —'}</div>
    <div class="value">Activity: ${escape(data.business_activity)}</div>
  </div>
</div>
<div class="section-header">Income (lines 1-6)</div>
${scheduleLines([
  ['1c', 'Gross profit balance', data.line1c_balance],
  ['2', 'Cost of goods sold', data.line2_cost_of_goods_sold],
  ['3', 'Gross profit', data.line3_gross_profit],
  ['5', 'Other income', data.line5_other_income],
  ['6', 'TOTAL income', data.line6_total_income],
])}
<div class="section-header">Deductions (lines 7-20)</div>
${scheduleLines([
  ['7', 'Compensation of officers (W-2 wages to owners)', data.line7_compensation_officers],
  ['8', 'Salaries and wages (other employees)', data.line8_salaries_wages],
  ['9', 'Repairs and maintenance', data.line9_repairs_maintenance],
  ['11', 'Rents', data.line11_rents],
  ['12', 'Taxes and licenses', data.line12_taxes_licenses],
  ['13', 'Interest', data.line13_interest],
  ['14', 'Depreciation', data.line14_depreciation],
  ['16', 'Advertising', data.line16_advertising],
  ['17', 'Pension / profit sharing', data.line17_pension_profit_sharing],
  ['18', 'Employee benefits', data.line18_employee_benefit_programs],
  ['19', 'Other deductions', data.line19_other_deductions],
  ['20', 'TOTAL deductions', data.line20_total_deductions],
  ['21', 'ORDINARY BUSINESS INCOME / LOSS (6 − 20)', data.line21_ordinary_business_income_loss],
])}
<div class="section-header">Schedule K — Total Distributive Shares</div>
${scheduleLines([
  ['1', 'Ordinary business income (→ K-1 box 1)', data.schK_ordinary_business_income],
  ['4', 'Interest income (→ K-1 box 4)', data.schK_interest_income],
  ['5a', 'Ordinary dividends (→ K-1 box 5a)', data.schK_dividend_income],
  ['8a', 'Net long-term capital gain (→ K-1 box 8a)', data.schK_net_long_term_cap_gain],
  ['9', 'Section 1231 gain (→ K-1 box 9)', data.schK_section_1231_gain],
  ['11', 'Section 179 deduction (→ K-1 box 11)', data.schK_section_179_deduction],
  ['16d', 'Distributions to shareholders (→ K-1 box 16)', data.schK_distributions],
])}
${data.shareholders.length > 0 ? `<div class="section-header">Shareholders (${data.shareholders.length})</div>
<table class="lines"><thead><tr><th>Name</th><th>SSN</th><th style="text-align:right">Ownership %</th></tr></thead><tbody>${data.shareholders.map((s) => `<tr><td>${escape(s.name)}</td><td style="font-family:'SF Mono',Menlo,monospace">${escape(s.ssn_or_ein)}</td><td class="line-amt">${(s.ownership_pct || 0).toFixed(2)}%</td></tr>`).join('')}</tbody></table>` : ''}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Form 1120-S is due March 15 (or 6-mo extension via Form 7004). S-corps don't pay federal income tax — income passes to shareholders via K-1. <strong>S-corp owners working in the business MUST take W-2 wages</strong> ("reasonable compensation") — taking only K-1 distributions to avoid SE tax is an IRS audit trigger.</div>
</body></html>`;
}

// ── Schedule K-1 (1065 / 1120-S) ──────────────────────────────

export function scheduleK1HTML(data: K1Data): string {
  const isPartnership = data.variant === '1065';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Schedule K-1 (${escape(data.variant)}) — ${escape(data.recipient_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Schedule K-1 (Form ' + data.variant + ')', isPartnership ? 'Partner\'s Share of Income, Deductions, Credits, etc.' : 'Shareholder\'s Share of Income, Deductions, Credits, etc.', data.recipient_name, 0)}
${scheduleWarnings(data.warnings)}
<div class="filer-block">
  <div class="filer-card">
    <div class="label">Part I — ${isPartnership ? 'Partnership' : 'Corporation'}</div>
    <div class="value">${escape(data.entity_name)}</div>
    <div class="value">EIN: ${escape(data.entity_ein)}</div>
    <div class="value">${escape(data.entity_address)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Part II — ${isPartnership ? 'Partner' : 'Shareholder'}</div>
    <div class="value">${escape(data.recipient_name)}</div>
    <div class="value">TIN: ${escape(data.recipient_tin)}</div>
    <div class="value">${escape(data.recipient_address)}</div>
    <div class="value">Ownership: ${data.share_profit_pct_end.toFixed(2)}%</div>
    ${isPartnership ? `<div class="value">${data.is_general_partner ? 'General Partner' : 'Limited Partner'}</div>` : ''}
  </div>
</div>
${isPartnership ? `<div class="section-header">Part II Item L — Capital Account</div>
${scheduleLines([
  ['Begin', 'Beginning capital', data.capital_beginning],
  ['Cont', 'Capital contributed', data.capital_contributed],
  ['Inc', 'Current year increase', data.capital_current_year_increase],
  ['W/D', 'Withdrawals & distributions', data.capital_withdrawals_distributions],
  ['End', 'Ending capital', data.capital_ending],
])}` : ''}
<div class="section-header">Part III — Distributive Share Items</div>
${scheduleLines((() => {
  const rows: Array<[string, string, number | string]> = [
    ['1', 'Ordinary business income (loss)', data.box1_ordinary_business_income],
    ['2', 'Net rental real estate income', data.box2_net_rental_real_estate],
    ['3', 'Other net rental income', data.box3_other_net_rental],
  ];
  if (isPartnership) rows.push(['4a', 'Guaranteed payments for services', data.box4a_guaranteed_payments_services]);
  rows.push(['5', 'Interest income', data.box5_interest_income]);
  rows.push(['6a', 'Ordinary dividends', data.box6a_ordinary_dividends]);
  rows.push(['7', 'Royalties', data.box7_royalties]);
  rows.push(['8', 'Net short-term capital gain', data.box8_net_short_term_capital_gain]);
  rows.push(['9a', 'Net long-term capital gain', data.box9a_net_long_term_capital_gain]);
  rows.push(['10', 'Section 1231 gain', data.box10_net_section_1231_gain]);
  rows.push(['12', 'Section 179 deduction', data.box12_section_179_deduction]);
  rows.push(['13', 'Other deductions (charitable, etc.)', data.box13_other_deductions]);
  if (isPartnership) {
    rows.push(['14', 'Self-employment earnings (→ Sch SE)', data.box14_self_employment_earnings]);
    rows.push(['19', 'Distributions of money', data.box19_distributions_money]);
  } else {
    rows.push(['16d', 'Distributions', data.box16_distributions]);
  }
  return rows;
})())}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> The recipient uses these box values on their personal Form 1040. Box 1 ordinary income flows to Schedule E (or Schedule SE for partnerships, which reports SE tax on box 14 — S-corp K-1s do NOT trigger SE tax because owners already take W-2 wages). The IRS receives a copy of every K-1; recipient names and TINs must match.</div>
</body></html>`;
}

// ── Form 1041 (Estate / Trust) ────────────────────────────────

export function form1041HTML(data: Form1041Data): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 1041 ${data.year} — ${escape(data.entity_name)}</title>${SHARED_HEAD}</head>
<body>${scheduleHeader('Form 1041 — U.S. Income Tax Return for Estates and Trusts', `Tax Year ${data.year} · ${escape(data.entity_type)} · Taxable income ${fmtMoney(data.line22_taxable_income)} · Tax ${fmtMoney(data.line23_total_tax)}`, data.entity_name, data.year)}
${scheduleWarnings(data.warnings)}
<div class="filer-block">
  <div class="filer-card">
    <div class="label">Estate / Trust</div>
    <div class="value">${escape(data.entity_name)}</div>
    <div class="value">EIN: ${escape(data.ein)}</div>
    <div class="value">Type: ${escape(data.entity_type)}</div>
    <div class="value">Created: ${escape(data.date_entity_created)}</div>
  </div>
  <div class="filer-card">
    <div class="label">Fiduciary</div>
    <div class="value">${escape(data.fiduciary_name)}</div>
    <div class="value">${escape(data.fiduciary_address)}</div>
    <div class="value">Exemption: ${fmtMoney(data.line21_exemption)}</div>
  </div>
</div>
<div class="section-header">Income</div>
${scheduleLines([
  ['1', 'Interest income', data.line1_interest_income],
  ['2a', 'Ordinary dividends', data.line2a_ordinary_dividends],
  ['3', 'Business income', data.line3_business_income],
  ['4', 'Capital gain or loss', data.line4_capital_gains],
  ['5', 'Rents, royalties, partnerships', data.line5_rents_royalties_partnerships],
  ['8', 'Other income', data.line8_other_income],
  ['9', 'TOTAL income', data.line9_total_income],
])}
<div class="section-header">Deductions</div>
${scheduleLines([
  ['10', 'Interest', data.line10_interest],
  ['11', 'Taxes', data.line11_taxes],
  ['12', 'Fiduciary fees', data.line12_fiduciary_fees],
  ['13', 'Charitable contributions', data.line13_charitable_contributions],
  ['14', 'Attorney/accountant fees', data.line14_attorney_accountant_fees],
  ['15a', 'Other deductions', data.line15a_other_deductions],
  ['16', 'TOTAL deductions', data.line16_total_deductions],
  ['17', 'Adjusted total income', data.line17_adjusted_total_income],
  ['18', 'Income distribution deduction (to beneficiaries)', data.line18_income_distribution_deduction],
  ['21', 'Exemption', data.line21_exemption],
  ['22', 'TAXABLE INCOME', data.line22_taxable_income],
  ['23', 'TOTAL TAX (compressed bracket: 37% ≥ $15,650)', data.line23_total_tax],
  ['24', 'Total payments', data.line24_total_payments],
  ['25', 'Balance due', data.line25_balance_due],
  ['26', 'Overpayment', data.line26_overpayment],
])}
<div class="disclaimer"><strong>Worksheet, not the official IRS form.</strong> Trust/estate brackets are HIGHLY compressed: 37% applies above $15,650 of taxable income (vs $626K+ for individuals). Strong incentive to distribute to beneficiaries via line 18 — distributed income is taxed at the beneficiary's lower personal rates instead. Simple trusts MUST distribute all income; complex trusts can choose.</div>
</body></html>`;
}
