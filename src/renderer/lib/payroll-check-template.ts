/**
 * Payroll Check Print Template — Enhanced
 * Check-on-top format (3-part) for letter-size blank check paper.
 * Font: Calibri / sans-serif. All text BLACK except YTD Summary taxes/net.
 */

// ─── Helpers ────────────────────────────────────────────
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n || 0);

const fmtDate = (d: string) => {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return d; }
};

const fmtShort = (d: string) => {
  if (!d) return '';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); }
  catch { return d; }
};

function amountToWords(amount: number): string {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const dollars = Math.floor(amount);
  const cents = Math.round((amount - dollars) * 100);
  function convert(n: number): string {
    if (n === 0) return 'Zero';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 1000000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    return convert(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 ? ' ' + convert(n % 1000000) : '');
  }
  return convert(dollars) + ' and ' + String(cents).padStart(2, '0') + '/100';
}

function maskSSN(ssn: string | undefined | null): string {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return ssn;
  return '***-**-' + digits.slice(-4);
}

// ─── Shared CSS (all text black) ───────────────────────────
const CHECK_STYLES = `
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Calibri, 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { width: 8.5in; height: 11in; position: relative; }
  .check-section { height: 3.667in; padding: 0.22in 0.45in 0.3in; position: relative; overflow: hidden; }
  .stub-section { height: 3.667in; padding: 0.12in 0.35in 0.08in; position: relative; overflow: hidden; }

  /* Tables */
  .t { width: 100%; border-collapse: collapse; font-size: 8.5px; color: #000; }
  .t th {
    padding: 2.5px 5px; text-align: left; font-size: 7px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.4px; color: #000;
    border-bottom: 1.5px solid #000; background: #f0f0f0;
  }
  .t th.r { text-align: right; }
  .t td { padding: 2px 5px; font-size: 8.5px; border-bottom: 0.5px solid #ccc; color: #000; }
  .t td.r { text-align: right; font-variant-numeric: tabular-nums; }
  .t td.b { font-weight: 700; }
  .t tr.tot td { border-top: 1.5px solid #000; border-bottom: none; font-weight: 700; padding-top: 3px; }
  .t tr.sub td { font-size: 7.5px; padding-left: 12px; color: #000; border-bottom: 0.5px dashed #ddd; }

  .void-watermark {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 60px; font-weight: 900; color: rgba(200,0,0,0.12);
    letter-spacing: 12px; pointer-events: none; z-index: 10;
  }
  .micr-line {
    font-family: 'MICR', 'Courier New', monospace; font-size: 11px;
    letter-spacing: 2px; color: #000; position: absolute; bottom: 0.22in; left: 0.5in;
  }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

// ─── Main Generator ────────────────────────────────────────
export function generatePaycheckHTML(
  stub: any, employee: any, company: any, run: any,
  options?: { isVoid?: boolean; checkNumber?: string; memo?: string }
): string {
  // ── Extract all data fields ──
  const co = esc(company?.name || 'Company');
  const coLegal = esc(company?.legal_name || '');
  const coAddr1 = esc(company?.address_line1 || '');
  const coAddr2 = esc(company?.address_line2 || '');
  const coCity = esc([company?.city, company?.state, company?.zip].filter(Boolean).join(', '));
  const coPhone = esc(company?.phone || '');
  const coEmail = esc(company?.email || '');
  const coEIN = esc(company?.ein || company?.tax_id || '');
  const coBankName = esc(company?.bank_name || '');
  const coBankRouting = esc(company?.bank_routing_number || '');
  const coBankAccount = esc(company?.bank_account_number || '');
  const coBankFraction = esc(company?.bank_fraction_code || '');

  const empName = esc(employee?.name || stub?.employee_name || 'Employee');
  const empAddr = esc([employee?.address_line1, employee?.address_line2].filter(Boolean).join(', '));
  const empCityState = esc([employee?.city, employee?.state, employee?.zip].filter(Boolean).join(', '));
  const empSSN = maskSSN(employee?.ssn || employee?.ssn_last4);
  const empId = esc(employee?.id?.substring(0, 8)?.toUpperCase() || '');
  const empDept = esc(employee?.department || '');
  const empStartDate = fmtShort(employee?.start_date || '');
  const empEmail = esc(employee?.email || '');
  const empFilingStatus = esc(employee?.filing_status || '');
  const empAllowances = employee?.federal_allowances ?? '';
  const empState = esc(employee?.state || '');

  const payDate = fmtDate(run?.pay_date || stub?.pay_date || '');
  const payDateShort = fmtShort(run?.pay_date || stub?.pay_date || '');
  const periodStart = fmtShort(run?.pay_period_start || stub?.period_start || '');
  const periodEnd = fmtShort(run?.pay_period_end || stub?.period_end || '');
  const runType = esc(run?.run_type || stub?.run_type || 'regular');

  const netPay = stub?.net_pay || 0;
  const grossPay = stub?.gross_pay || 0;
  const federalTax = stub?.federal_tax || 0;
  const stateTax = stub?.state_tax || 0;
  const ssTax = stub?.social_security || 0;
  const medicareTax = stub?.medicare || 0;
  const preTaxDed = stub?.pretax_deductions || stub?.other_deductions || 0;
  const postTaxDed = stub?.posttax_deductions || 0;
  const totalTaxes = federalTax + stateTax + ssTax + medicareTax;
  const totalDeductions = totalTaxes + preTaxDed + postTaxDed;
  const hoursReg = stub?.hours_regular || stub?.hours || 0;
  const hoursOT = stub?.hours_overtime || 0;
  const totalHours = hoursReg + hoursOT;
  const checkNum = esc(options?.checkNumber || stub?.check_number || stub?.id?.substring(0, 6).toUpperCase() || '000001');
  const ytdGross = stub?.ytd_gross || 0;
  const ytdTaxes = stub?.ytd_taxes || 0;
  const ytdNet = stub?.ytd_net || 0;
  const ytdFederal = stub?.ytd_federal_tax || 0;
  const ytdState = stub?.ytd_state_tax || 0;
  const ytdSS = stub?.ytd_social_security || 0;
  const ytdMedicare = stub?.ytd_medicare || 0;
  const isVoid = options?.isVoid || false;
  const memo = esc(options?.memo || `Payroll ${periodStart} — ${periodEnd}`);
  const paySchedule = esc(stub?.pay_schedule || run?.pay_schedule || employee?.pay_schedule || '');
  const isDD = !!(employee?.routing_number);
  const payType = esc(employee?.pay_type || (hoursReg > 0 ? 'hourly' : 'salary'));
  const payRate = employee?.pay_rate || 0;

  // Computed
  const effRate = totalHours > 0 ? grossPay / (hoursReg + hoursOT * 1.5) : payRate;
  const regPay = totalHours > 0 ? effRate * hoursReg : grossPay;
  const otPay = totalHours > 0 ? effRate * 1.5 * hoursOT : 0;
  const taxableWages = grossPay - preTaxDed;

  // Deduction detail
  let dedItems: [string, number][] = [];
  if (stub?.deduction_detail && stub.deduction_detail !== '{}') {
    try { dedItems = Object.entries(JSON.parse(stub.deduction_detail)).map(([k, v]) => [k, Number(v)]); } catch {}
  }

  const voidWM = isVoid ? '<div class="void-watermark">VOID</div>' : '';
  const ddBanner = isDD ? `<div style="position:absolute;top:0.18in;left:50%;transform:translateX(-50%);font-size:8px;font-weight:700;color:#000;letter-spacing:2px;text-transform:uppercase;">*** NON-NEGOTIABLE &mdash; DIRECT DEPOSIT ***</div>` : '';

  // ═══════════════════════════════════════════════════════
  // INFO GRID (2-row, 6-column metadata)
  // ═══════════════════════════════════════════════════════
  const infoGrid = `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);border:1px solid #999;margin-bottom:5px;font-size:7.5px;">
      <div style="padding:3px 5px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Employee Name</div>
        <div style="font-weight:700;font-size:9px;">${empName}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">SSN</div>
        <div>${empSSN || '—'}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Employee ID</div>
        <div>${empId || '—'}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Pay Date</div>
        <div style="font-weight:700;">${payDateShort}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Period</div>
        <div>${periodStart} &ndash; ${periodEnd}</div>
      </div>
      <div style="padding:3px 5px;border-bottom:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Check #</div>
        <div style="font-weight:700;">${checkNum}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Department</div>
        <div>${empDept || '—'}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Filing Status</div>
        <div style="text-transform:capitalize;">${empFilingStatus || '—'}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Allowances</div>
        <div>${empAllowances !== '' ? empAllowances : '—'}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Pay Type</div>
        <div style="text-transform:capitalize;">${payType}${payRate > 0 ? ' @ ' + fmt(payRate) : ''}</div>
      </div>
      <div style="padding:3px 5px;border-right:1px solid #ddd;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Pay Schedule</div>
        <div style="text-transform:capitalize;">${paySchedule || '—'}</div>
      </div>
      <div style="padding:3px 5px;">
        <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Payment Method</div>
        <div style="font-weight:700;">${isDD ? 'Direct Deposit' : 'Check'}</div>
      </div>
    </div>`;

  // ═══════════════════════════════════════════════════════
  // STUB BUILDER
  // ═══════════════════════════════════════════════════════
  const buildStub = (label: string, isEmployer: boolean) => `
    <!-- Label -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
      <div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#000;">${label}</div>
      <div style="font-size:11px;font-weight:800;color:#000;">${co}</div>
    </div>

    <!-- Info Grid -->
    ${infoGrid}

    <!-- Tables Row: Earnings | Deductions + Taxes | Summary -->
    <div style="display:flex;gap:6px;">

      <!-- EARNINGS -->
      <div style="flex:1.3;">
        <table class="t">
          <thead><tr>
            <th>Earnings</th>
            <th class="r">Hours</th>
            <th class="r">Rate</th>
            <th class="r">Current</th>
            <th class="r">YTD</th>
          </tr></thead>
          <tbody>
            ${totalHours > 0 ? `
            <tr>
              <td>Regular</td>
              <td class="r">${hoursReg.toFixed(2)}</td>
              <td class="r">${fmt(effRate)}</td>
              <td class="r b">${fmt(regPay)}</td>
              <td class="r">${fmt(ytdGross)}</td>
            </tr>
            ${hoursOT > 0 ? `
            <tr>
              <td>Overtime (1.5x)</td>
              <td class="r">${hoursOT.toFixed(2)}</td>
              <td class="r">${fmt(effRate * 1.5)}</td>
              <td class="r b">${fmt(otPay)}</td>
              <td class="r">—</td>
            </tr>` : ''}
            ` : `
            <tr>
              <td>Salary</td>
              <td class="r">—</td>
              <td class="r">${payRate > 0 ? fmt(payRate) : '—'}</td>
              <td class="r b">${fmt(grossPay)}</td>
              <td class="r">${fmt(ytdGross)}</td>
            </tr>`}
            <tr class="tot">
              <td>Gross Pay</td>
              <td class="r">${totalHours > 0 ? totalHours.toFixed(2) : ''}</td>
              <td></td>
              <td class="r">${fmt(grossPay)}</td>
              <td class="r">${fmt(ytdGross)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- DEDUCTIONS + TAXES -->
      <div style="flex:1.1;">
        <table class="t">
          <thead><tr>
            <th>Statutory Deductions</th>
            <th class="r">Current</th>
            <th class="r">YTD</th>
          </tr></thead>
          <tbody>
            <tr><td>Federal Income Tax</td><td class="r">${fmt(federalTax)}</td><td class="r">${ytdFederal > 0 ? fmt(ytdFederal) : '—'}</td></tr>
            <tr><td>State Income Tax${empState ? ' (' + empState + ')' : ''}</td><td class="r">${fmt(stateTax)}</td><td class="r">${ytdState > 0 ? fmt(ytdState) : '—'}</td></tr>
            <tr><td>Social Security (OASDI) 6.2%</td><td class="r">${fmt(ssTax)}</td><td class="r">${ytdSS > 0 ? fmt(ytdSS) : '—'}</td></tr>
            <tr><td>Medicare (HI) 1.45%</td><td class="r">${fmt(medicareTax)}</td><td class="r">${ytdMedicare > 0 ? fmt(ytdMedicare) : '—'}</td></tr>
            <tr class="tot"><td>Total Taxes</td><td class="r">${fmt(totalTaxes)}</td><td class="r">${ytdTaxes > 0 ? fmt(ytdTaxes) : '—'}</td></tr>
          </tbody>
        </table>
        ${(preTaxDed > 0 || postTaxDed > 0 || dedItems.length > 0) ? `
        <table class="t" style="margin-top:3px;">
          <thead><tr><th>Other Deductions</th><th class="r">Current</th></tr></thead>
          <tbody>
            ${preTaxDed > 0 ? `<tr><td>Pre-Tax Deductions</td><td class="r">${fmt(preTaxDed)}</td></tr>` : ''}
            ${dedItems.map(([n, a]) => `<tr class="sub"><td>${esc(n)}</td><td class="r">${fmt(a)}</td></tr>`).join('')}
            ${postTaxDed > 0 ? `<tr><td>Post-Tax Deductions</td><td class="r">${fmt(postTaxDed)}</td></tr>` : ''}
          </tbody>
        </table>` : ''}
      </div>

      <!-- SUMMARY -->
      <div style="width:130px;">
        <!-- Net Pay -->
        <div style="border:2px solid #000;text-align:center;padding:4px 6px;margin-bottom:4px;">
          <div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Net Pay</div>
          <div style="font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;">${fmt(netPay)}</div>
        </div>
        <!-- Pay Waterfall -->
        <div style="border:1px solid #999;padding:4px 5px;font-size:7.5px;line-height:1.6;">
          <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.5px;margin-bottom:2px;">Pay Calculation</div>
          <div style="display:flex;justify-content:space-between;"><span>Gross Earnings</span><span class="b">${fmt(grossPay)}</span></div>
          ${preTaxDed > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Pre-Tax Ded.</span><span>-${fmt(preTaxDed)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;"><span>Taxable Wages</span><span>${fmt(taxableWages)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Total Taxes</span><span>-${fmt(totalTaxes)}</span></div>
          ${postTaxDed > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Post-Tax Ded.</span><span>-${fmt(postTaxDed)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;border-top:1px solid #000;padding-top:2px;margin-top:2px;font-weight:700;"><span>Net Pay</span><span>${fmt(netPay)}</span></div>
        </div>
        <!-- YTD Summary (ONLY colored section) -->
        <div style="border:1px solid #999;padding:4px 5px;font-size:7.5px;line-height:1.6;margin-top:3px;">
          <div style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.5px;margin-bottom:2px;">YTD Summary</div>
          <div style="display:flex;justify-content:space-between;"><span>Gross Earnings</span><span style="font-weight:700;">${fmt(ytdGross)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Total Taxes</span><span style="font-weight:700;color:#dc2626;">${fmt(ytdTaxes)}</span></div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid #000;padding-top:2px;margin-top:2px;font-weight:700;"><span>Net Pay</span><span style="color:#16a34a;">${fmt(ytdNet)}</span></div>
        </div>
      </div>
    </div>

    ${isEmployer ? `
    <!-- Employer-only: Additional details -->
    <div style="display:flex;gap:6px;margin-top:4px;font-size:7px;">
      <div style="flex:1;border:1px solid #ddd;padding:3px 5px;">
        <span style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Employer FICA Match:</span>
        SS ${fmt(ssTax)} + Medicare ${fmt(medicareTax)} = <strong>${fmt(ssTax + medicareTax)}</strong>
      </div>
      <div style="flex:1;border:1px solid #ddd;padding:3px 5px;">
        <span style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">Run Type:</span>
        <span style="text-transform:capitalize;">${runType}</span>
        &nbsp;|&nbsp; <strong>Total Cost:</strong> ${fmt(grossPay + ssTax + medicareTax)}
      </div>
      ${coEIN ? `<div style="flex:0.6;border:1px solid #ddd;padding:3px 5px;">
        <span style="font-weight:700;text-transform:uppercase;font-size:6px;letter-spacing:0.3px;">EIN:</span> ${coEIN}
      </div>` : ''}
    </div>` : ''}
  `;

  // ═══════════════════════════════════════════════════════
  // FULL PAGE
  // ═══════════════════════════════════════════════════════
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${CHECK_STYLES}
</style></head><body>
<div class="page">

  <!-- ═══ CHECK (Top Third) ═══ -->
  <div class="check-section">
    ${voidWM}
    ${ddBanner}

    <!-- Company + Check Number -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
      <div>
        <div style="font-size:16px;font-weight:800;letter-spacing:-0.2px;">${co}</div>
        ${coLegal && coLegal !== co ? `<div style="font-size:8px;">${coLegal}</div>` : ''}
        <div style="font-size:9px;margin-top:2px;line-height:1.4;">
          ${coAddr1 ? coAddr1 + '<br>' : ''}${coAddr2 ? coAddr2 + '<br>' : ''}${coCity || ''}
          ${coPhone ? '<br>' + coPhone : ''}${coEmail ? ' &middot; ' + coEmail : ''}
          ${coEIN ? '<br>EIN: ' + coEIN : ''}
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Check No.</div>
        <div style="font-size:20px;font-weight:800;letter-spacing:1px;">${checkNum}</div>
        <div style="font-size:10px;margin-top:4px;"><strong>Date:</strong> ${payDate}</div>
      </div>
    </div>

    <!-- PAY TO THE ORDER OF -->
    <div style="margin-bottom:6px;">
      <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">Pay to the Order of</div>
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:2px;">
        <div>
          <div style="font-size:14px;font-weight:700;">${empName}</div>
          ${empAddr ? `<div style="font-size:8px;">${empAddr}${empCityState ? ', ' + empCityState : ''}</div>` : ''}
        </div>
        <div style="font-size:16px;font-weight:800;border:2px solid #000;padding:2px 14px;letter-spacing:0.5px;">
          ${fmt(netPay)}
        </div>
      </div>
    </div>

    <!-- Amount in Words -->
    <div style="border-bottom:1.5px solid #000;padding-bottom:2px;margin-bottom:8px;">
      <span style="font-size:10px;">${amountToWords(netPay)}</span>
      <span style="font-size:10px;"> ************************************</span>
    </div>

    <!-- Bank Info + Memo + Signature -->
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        ${coBankName ? `<div style="font-size:8px;font-weight:700;margin-bottom:1px;">${coBankName}</div>` : ''}
        ${coBankFraction ? `<div style="font-size:7px;margin-bottom:2px;">${coBankFraction}</div>` : ''}
        <div style="font-size:7px;font-weight:700;text-transform:uppercase;margin-bottom:1px;">Memo</div>
        <div style="font-size:9px;">${memo}</div>
      </div>
      <div style="text-align:center;">
        <div style="border-top:1.5px solid #000;width:200px;padding-top:2px;">
          <span style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Authorized Signature</span>
        </div>
      </div>
    </div>

    <!-- MICR Line (standard check font) -->
    <div class="micr-line">&#9416;${checkNum}&#9416; &#9414;${coBankRouting || '000000000'}&#9414; ${coBankAccount || '0000000000'}&#9416;</div>
  </div>

  <!-- ═══ EMPLOYEE STUB (Middle Third) ═══ -->
  <div class="stub-section">
    ${voidWM}
    ${buildStub('Employee Copy &mdash; Detach and Retain', false)}
  </div>

  <!-- ═══ EMPLOYER STUB (Bottom Third) ═══ -->
  <div class="stub-section">
    ${voidWM}
    ${buildStub('Employer Copy &mdash; For Records', true)}
  </div>

</div>
</body></html>`;
}

// ─── Batch helpers ─────────────────────────────────────────
export function extractCheckBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match?.[1] || html;
}

export function wrapBatchChecks(bodies: string[]): string {
  const combined = bodies.join('<div style="page-break-before:always;"></div>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${CHECK_STYLES}
</style></head><body>${combined}</body></html>`;
}
