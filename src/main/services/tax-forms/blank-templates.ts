// src/main/services/tax-forms/blank-templates.ts
//
// Pre-filled BLANK PDF templates for compliance forms received from
// employees and vendors:
//   • W-4   — pre-fill employer info; employee fills the rest
//   • W-9   — pre-fill requester info; vendor fills the rest
//   • I-9   — pre-fill employer (Section 2) info; employee fills
//             Section 1
//
// These are NOT computed worksheets like the other tax forms — they
// are blank forms with the company's known fields pre-populated so
// the recipient only fills what we don't already know.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-w-4
//   • https://www.irs.gov/forms-pubs/about-form-w-9
//   • https://www.uscis.gov/i-9 (DHS, not IRS)

const SHARED_HEAD = `<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.4; }
  .form-header { border-bottom: 3px solid #0f172a; padding-bottom: 14px; margin-bottom: 16px; }
  .form-title { font-size: 22px; font-weight: 800; }
  .form-subtitle { font-size: 12px; color: #475569; margin-top: 4px; }
  .form-meta { font-size: 11px; color: #64748b; margin-top: 8px; }
  .section { margin: 16px 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; }
  .section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px; color: #0f172a; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; }
  .pre-filled { background: #ecfdf5; padding: 6px 10px; border-radius: 4px; margin: 4px 0; }
  .pre-filled .label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #065f46; }
  .pre-filled .value { font-size: 12px; font-weight: 700; color: #0f172a; }
  .blank { background: #fef3c7; padding: 6px 10px; border-radius: 4px; margin: 4px 0; min-height: 20px; }
  .blank .label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #92400e; }
  .blank .underline { display: inline-block; min-width: 240px; border-bottom: 1px solid #92400e; padding: 4px 0; margin-top: 4px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .checkbox-line { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
  .checkbox { width: 12px; height: 12px; border: 1.5px solid #0f172a; display: inline-block; vertical-align: middle; }
  .signature-block { border: 1px solid #0f172a; padding: 12px; margin-top: 16px; min-height: 80px; }
  .signature-block .label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
  .signature-block .signature-line { border-bottom: 1px solid #0f172a; min-width: 280px; height: 28px; margin-top: 16px; }
  .legend { margin: 14px 0; padding: 10px; background: #f8fafc; border-left: 3px solid #2563eb; font-size: 10px; color: #475569; line-height: 1.6; }
  .legend strong { color: #0f172a; }
</style>`;

function escape(s: string): string {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function preFilled(label: string, value: string): string {
  return `<div class="pre-filled"><div class="label">${escape(label)} (pre-filled)</div><div class="value">${escape(value) || '—'}</div></div>`;
}

function blank(label: string): string {
  return `<div class="blank"><div class="label">${escape(label)} (employee fills)</div><div class="underline">&nbsp;</div></div>`;
}

function blankShort(label: string, width: number = 120): string {
  return `<div class="blank" style="display:inline-block;margin-right:8px;vertical-align:top"><div class="label">${escape(label)}</div><div class="underline" style="min-width:${width}px">&nbsp;</div></div>`;
}

// ── Form W-4 ──────────────────────────────────────────────────

export interface BlankW4Input {
  employer_name: string;
  employer_ein: string;
  employer_address: string;
  employee_name?: string;        // If known, pre-fill (otherwise blank)
  year: number;
}

export function blankW4HTML(d: BlankW4Input): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form W-4 ${d.year} — Blank for ${escape(d.employee_name || 'New Hire')}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form W-4 — Employee's Withholding Certificate</div>
  <div class="form-subtitle">Tax Year ${d.year} · For new-hire onboarding · OMB No. 1545-0074</div>
  <div class="form-meta">Pre-filled by ${escape(d.employer_name)} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

<div class="legend">
  <strong>Employee:</strong> Fields shaded <span style="background:#fef3c7;padding:1px 4px">amber</span> are for you to fill in. Sign at the bottom and return to your employer. The fields shaded <span style="background:#ecfdf5;padding:1px 4px">green</span> are already filled in by your employer.
</div>

<div class="section">
  <div class="section-title">Step 1 — Enter Personal Information</div>
  <div class="grid-2">
    ${d.employee_name ? preFilled('Name', d.employee_name) : blank('First name and middle initial · Last name')}
    ${blank('Social Security Number')}
  </div>
  ${blank('Address (number, street, apt no.)')}
  <div class="grid-3">
    ${blank('City')}
    ${blank('State')}
    ${blank('ZIP')}
  </div>
  <div style="margin-top:10px">
    <div style="font-weight:700;font-size:11px;margin-bottom:4px">Filing status (check ONE):</div>
    <div class="checkbox-line"><span class="checkbox"></span> Single or Married filing separately</div>
    <div class="checkbox-line"><span class="checkbox"></span> Married filing jointly or Qualifying surviving spouse</div>
    <div class="checkbox-line"><span class="checkbox"></span> Head of household</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Step 2 — Multiple Jobs or Spouse Works</div>
  <div style="font-size:10px;color:#64748b;margin-bottom:6px">Complete only if (1) you hold more than one job at a time, or (2) you are married filing jointly and your spouse also works.</div>
  <div class="checkbox-line"><span class="checkbox"></span> Use IRS estimator at <strong>www.irs.gov/W4App</strong> (most accurate)</div>
  <div class="checkbox-line"><span class="checkbox"></span> Use Multiple Jobs Worksheet on page 3</div>
  <div class="checkbox-line"><span class="checkbox"></span> Check box if there are only TWO jobs total and pay is similar (simpler — gives same result as worksheet for most filers)</div>
</div>

<div class="section">
  <div class="section-title">Step 3 — Claim Dependents (only one job, or higher-paying job)</div>
  <div class="grid-2">
    ${blankShort('Qualifying children under 17 × $2,000', 100)}
    ${blankShort('Other dependents × $500', 100)}
  </div>
  ${blankShort('Add the amounts above and any other credits — enter total here', 100)}
</div>

<div class="section">
  <div class="section-title">Step 4 — Other Adjustments (optional)</div>
  ${blank('4(a) Other income (not from jobs) — annual amount')}
  ${blank('4(b) Deductions other than standard — annual amount')}
  ${blank('4(c) Extra withholding per pay period')}
</div>

<div class="signature-block">
  <div class="label">Step 5 — Sign here (REQUIRED)</div>
  <div class="signature-line"></div>
  <div style="margin-top:14px;display:flex;gap:24px">
    <div style="flex:1">${blankShort('Employee signature', 200)}</div>
    <div>${blankShort('Date', 100)}</div>
  </div>
</div>

<div class="section" style="background:#f1f5f9">
  <div class="section-title">Employer's Section (already complete)</div>
  ${preFilled('Employer name and address', d.employer_name + ' · ' + d.employer_address)}
  ${preFilled('Employer EIN', d.employer_ein || '__-_______')}
  <div class="blank" style="margin-top:8px">
    <div class="label">First date of employment (employer fills on receipt)</div>
    <div class="underline">&nbsp;</div>
  </div>
</div>
</body></html>`;
}

// ── Form W-9 ──────────────────────────────────────────────────

export interface BlankW9Input {
  requester_name: string;       // Our company (the payer requesting TIN)
  requester_address: string;
  vendor_name?: string;          // If known, pre-fill
  vendor_business_name?: string;
}

export function blankW9HTML(d: BlankW9Input): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form W-9 — Blank for ${escape(d.vendor_name || 'New Vendor')}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form W-9 — Request for Taxpayer Identification Number and Certification</div>
  <div class="form-subtitle">For vendor / contractor onboarding · OMB No. 1545-0047</div>
  <div class="form-meta">Pre-filled by ${escape(d.requester_name)} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

<div class="legend">
  <strong>Vendor:</strong> The fields shaded <span style="background:#fef3c7;padding:1px 4px">amber</span> are for you to fill in. The fields shaded <span style="background:#ecfdf5;padding:1px 4px">green</span> identify who is requesting your TIN. Sign at the bottom and return — typically required before any payment ≥ $600 is made.
</div>

<div class="section">
  <div class="section-title">Section 1 — Name and Identification</div>
  ${d.vendor_name ? preFilled('Name (as shown on tax return)', d.vendor_name) : blank('Name (as shown on tax return)')}
  ${d.vendor_business_name ? preFilled('Business name / DBA (if different)', d.vendor_business_name) : blank('Business name / DBA (if different from above)')}
  <div style="margin-top:10px">
    <div style="font-weight:700;font-size:11px;margin-bottom:4px">Federal tax classification (check ONE):</div>
    <div class="checkbox-line"><span class="checkbox"></span> Individual / sole proprietor / single-member LLC</div>
    <div class="checkbox-line"><span class="checkbox"></span> C corporation</div>
    <div class="checkbox-line"><span class="checkbox"></span> S corporation</div>
    <div class="checkbox-line"><span class="checkbox"></span> Partnership</div>
    <div class="checkbox-line"><span class="checkbox"></span> Trust / estate</div>
    <div class="checkbox-line"><span class="checkbox"></span> Limited liability company — enter tax classification (C, S, P): _____</div>
    <div class="checkbox-line"><span class="checkbox"></span> Other (see instructions)</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Section 2 — Address</div>
  ${blank('Address (number, street, apt no.)')}
  <div class="grid-3">
    ${blank('City')}
    ${blank('State')}
    ${blank('ZIP')}
  </div>
</div>

<div class="section">
  <div class="section-title">Part I — Taxpayer Identification Number (TIN)</div>
  <div style="font-size:10px;color:#64748b;margin-bottom:6px">Enter your TIN in the appropriate box. For individuals, this is generally your Social Security Number (SSN). For other entities, it is your Employer Identification Number (EIN).</div>
  <div class="grid-2">
    ${blank('Social Security Number (SSN)')}
    ${blank('Employer Identification Number (EIN)')}
  </div>
</div>

<div class="signature-block">
  <div class="label">Part II — Certification (REQUIRED)</div>
  <div style="font-size:10px;line-height:1.5;margin:8px 0;color:#475569">
    Under penalties of perjury, I certify that:
    (1) The number shown on this form is my correct taxpayer identification number, and
    (2) I am not subject to backup withholding because: (a) I am exempt, (b) I have not been notified by the IRS that I am subject to backup withholding, or (c) the IRS has notified me that I am no longer subject to backup withholding, and
    (3) I am a U.S. citizen or other U.S. person, and
    (4) The FATCA code(s) entered on this form (if any) indicating I am exempt from FATCA reporting is correct.
  </div>
  <div class="signature-line"></div>
  <div style="margin-top:14px;display:flex;gap:24px">
    <div style="flex:1">${blankShort('Signature of U.S. person', 200)}</div>
    <div>${blankShort('Date', 100)}</div>
  </div>
</div>

<div class="section" style="background:#f1f5f9">
  <div class="section-title">Requester's Information</div>
  ${preFilled('Requester (payer)', d.requester_name)}
  ${preFilled('Address', d.requester_address)}
  <div style="font-size:10px;color:#64748b;margin-top:8px">Return this completed form to the requester. The requester will keep it on file and will NOT submit it to the IRS unless backup withholding becomes required.</div>
</div>
</body></html>`;
}

// ── Form I-9 ──────────────────────────────────────────────────

export interface BlankI9Input {
  employer_name: string;
  employer_address: string;
  employer_ein: string;
  employee_name?: string;
}

export function blankI9HTML(d: BlankI9Input): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Form I-9 — Blank for ${escape(d.employee_name || 'New Hire')}</title>${SHARED_HEAD}</head>
<body>
<div class="form-header">
  <div class="form-title">Form I-9 — Employment Eligibility Verification</div>
  <div class="form-subtitle">U.S. Citizenship and Immigration Services (DHS) · OMB No. 1615-0047</div>
  <div class="form-meta">Pre-filled by ${escape(d.employer_name)} · Generated ${new Date().toLocaleDateString('en-US')}</div>
</div>

<div class="legend">
  <strong>Employee:</strong> Complete <strong>Section 1</strong> on or before your first day. <strong>Employer:</strong> Complete <strong>Section 2</strong> within 3 business days of the employee's first day. Retain this form for 3 years after hire OR 1 year after termination, whichever is later.
</div>

<div class="section">
  <div class="section-title">Section 1 — Employee Information and Attestation (employee fills)</div>
  <div class="grid-2">
    ${d.employee_name ? preFilled('Last Name (Family Name)', d.employee_name.split(' ').slice(-1).join(' ')) : blank('Last Name (Family Name)')}
    ${d.employee_name ? preFilled('First Name (Given Name)', d.employee_name.split(' ')[0]) : blank('First Name (Given Name)')}
  </div>
  ${blank('Middle Initial · Other Last Names Used (if any)')}
  ${blank('Address (street name and number) · Apt. Number')}
  <div class="grid-3">
    ${blank('City')}
    ${blank('State')}
    ${blank('ZIP')}
  </div>
  <div class="grid-3">
    ${blank('Date of Birth (mm/dd/yyyy)')}
    ${blank('U.S. Social Security Number')}
    ${blank("Employee's Email Address")}
  </div>
  ${blank("Employee's Telephone Number")}

  <div style="margin-top:14px">
    <div style="font-weight:700;font-size:11px;margin-bottom:4px">I attest, under penalty of perjury, that I am (check ONE):</div>
    <div class="checkbox-line"><span class="checkbox"></span> 1. A citizen of the United States</div>
    <div class="checkbox-line"><span class="checkbox"></span> 2. A noncitizen national of the United States</div>
    <div class="checkbox-line"><span class="checkbox"></span> 3. A lawful permanent resident — Alien Registration Number / USCIS Number: _____________</div>
    <div class="checkbox-line"><span class="checkbox"></span> 4. An alien authorized to work until: ___________ (Form I-94 / Foreign Passport / etc.)</div>
  </div>

  <div class="signature-block" style="background:#fef3c7">
    <div class="label">Employee signature</div>
    <div class="signature-line"></div>
    <div style="margin-top:14px;display:flex;gap:24px">
      <div style="flex:1">${blankShort('Signature', 200)}</div>
      <div>${blankShort('Date (mm/dd/yyyy)', 120)}</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Section 2 — Employer or Authorized Representative Review and Verification</div>
  <div style="font-size:10px;color:#64748b;margin-bottom:8px">Examine ONE document from List A, OR ONE document from List B AND ONE from List C. Examine documents in the employee's physical presence (or authorized remote alternative).</div>

  <div class="grid-3">
    <div>
      <div style="font-weight:700;font-size:10px;margin-bottom:4px">List A (Identity & Work Authorization)</div>
      ${blank('Document Title')}
      ${blank('Issuing Authority')}
      ${blank('Document Number')}
      ${blank('Expiration Date (if any)')}
    </div>
    <div>
      <div style="font-weight:700;font-size:10px;margin-bottom:4px">List B (Identity)</div>
      ${blank('Document Title')}
      ${blank('Issuing Authority')}
      ${blank('Document Number')}
      ${blank('Expiration Date (if any)')}
    </div>
    <div>
      <div style="font-weight:700;font-size:10px;margin-bottom:4px">List C (Work Authorization)</div>
      ${blank('Document Title')}
      ${blank('Issuing Authority')}
      ${blank('Document Number')}
      ${blank('Expiration Date (if any)')}
    </div>
  </div>

  <div style="margin-top:14px;background:#ecfdf5;padding:10px;border-radius:4px">
    <div class="label" style="color:#065f46">Employer Information (pre-filled)</div>
    ${preFilled('Business / Organization Name', d.employer_name)}
    ${preFilled('Address', d.employer_address)}
    ${preFilled('Employer EIN', d.employer_ein || '__-_______')}
  </div>

  <div class="signature-block">
    <div class="label">Certification by Employer or Authorized Representative</div>
    <div style="font-size:10px;line-height:1.5;margin:8px 0;color:#475569">
      I attest, under penalty of perjury, that (1) I have examined the documents presented by the employee, (2) the documents appear to be genuine and to relate to the named employee, and (3) to the best of my knowledge the employee is authorized to work in the United States.
    </div>
    <div class="signature-line"></div>
    <div style="margin-top:14px;display:flex;gap:24px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">${blankShort('Signature of Employer', 240)}</div>
      <div>${blankShort('Date (mm/dd/yyyy)', 120)}</div>
    </div>
    ${blank("Employer or Authorized Representative's Name")}
    ${blank("Title")}
  </div>
</div>

<div class="section" style="background:#fef2f2">
  <div class="section-title" style="color:#991b1b">Section 3 — Reverification (used only at re-hire or work-authorization expiration)</div>
  <div style="font-size:10px;color:#7f1d1d">Leave blank for new hires. Used only when (a) re-hiring within 3 years and re-verifying the original I-9 is still valid, or (b) the employee's work authorization document has expired and they have presented a new one.</div>
</div>

<div class="legend" style="border-left-color:#dc2626;background:#fef2f2;color:#7f1d1d">
  <strong>Retention rule:</strong> Keep this completed I-9 for 3 years after the date of hire OR 1 year after the date employment ended, WHICHEVER IS LATER. Do not file with USCIS unless requested. Make available for inspection by USCIS, ICE, or DOL agents.
</div>
</body></html>`;
}
