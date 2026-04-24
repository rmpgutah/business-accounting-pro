/**
 * Payroll Check Print Template
 * Generates HTML for a standard check-on-top format (3-part):
 *   Top third:    Negotiable check (aligns with blue security border area)
 *   Middle third: Employee earnings stub (detach and retain)
 *   Bottom third: Employer stub with YTD summary (for records)
 *
 * Designed for letter-size (8.5 x 11 in) blank check paper.
 * Font: Calibri / sans-serif dominant.
 * Perforation lines align at exactly 1/3 and 2/3 page height.
 */

// ─── HTML escape helper (XSS prevention) ────────────────
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Currency Formatter ────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n || 0);

const fmtDate = (d: string) => {
  if (!d) return '';
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return d;
  }
};

const fmtDateShort = (d: string) => {
  if (!d) return '';
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  } catch {
    return d;
  }
};

// ─── Number-to-words conversion for check amount ───────────
function amountToWords(amount: number): string {
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

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

// ─── Mask SSN (show last 4 only) ───────────────────────────
function maskSSN(ssn: string | undefined | null): string {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return ssn;
  return '***-**-' + digits.slice(-4);
}

// ─── Shared CSS ────────────────────────────────────────────
const CHECK_STYLES = `
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Calibri, 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    color: #1a1a1a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 8.5in;
    height: 11in;
    position: relative;
  }
  /* Each section is exactly 1/3 of the page */
  .check-section {
    height: 3.667in;
    padding: 0.25in 0.45in 0.35in;
    position: relative;
    overflow: hidden;
  }
  .stub-section {
    height: 3.667in;
    padding: 0.15in 0.4in 0.1in;
    position: relative;
    overflow: hidden;
  }

  /* ── Typography ── */
  .font-cal { font-family: Calibri, 'Segoe UI', -apple-system, sans-serif; }
  .font-mono { font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-variant-numeric: tabular-nums; }
  .upper { text-transform: uppercase; letter-spacing: 0.5px; }
  .bold { font-weight: 700; }
  .light { color: #64748b; }
  .xs { font-size: 8px; }
  .sm { font-size: 9px; }
  .md { font-size: 10px; }
  .lg { font-size: 12px; }

  /* ── Tables (stubs) ── */
  .stub-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  .stub-table th {
    padding: 3px 6px;
    text-align: left;
    font-size: 7.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #64748b;
    border-bottom: 1.5px solid #334155;
    background: #f1f5f9;
  }
  .stub-table th.r { text-align: right; }
  .stub-table td {
    padding: 2.5px 6px;
    font-size: 9px;
    border-bottom: 1px solid #e2e8f0;
    color: #334155;
  }
  .stub-table td.r { text-align: right; font-variant-numeric: tabular-nums; font-family: Calibri, sans-serif; }
  .stub-table tr.total-row td {
    border-top: 1.5px solid #334155;
    border-bottom: none;
    font-weight: 700;
    color: #0f172a;
    padding-top: 4px;
  }

  /* ── Net Pay Box ── */
  .net-box {
    border: 2px solid #0f172a;
    text-align: center;
    padding: 5px 8px;
  }
  .net-label { font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
  .net-amount { font-size: 16px; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }

  /* ── MICR ── */
  .micr-line {
    font-family: 'MICR', 'Courier New', monospace;
    font-size: 11px;
    letter-spacing: 2px;
    color: #333;
    position: absolute;
    bottom: 0.25in;
    left: 0.5in;
  }

  /* ── Void Watermark ── */
  .void-watermark {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 60px;
    font-weight: 900;
    color: rgba(200, 0, 0, 0.12);
    letter-spacing: 12px;
    pointer-events: none;
    z-index: 10;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

// ─── Main generator ────────────────────────────────────────
export function generatePaycheckHTML(
  stub: any,
  employee: any,
  company: any,
  run: any,
  options?: { isVoid?: boolean; checkNumber?: string; memo?: string }
): string {
  const companyName = esc(company?.name || 'Company');
  const companyLegal = esc(company?.legal_name || '');
  const companyAddr = esc([company?.address_line1, company?.address_line2].filter(Boolean).join(', '));
  const companyCityState = esc([company?.city, company?.state, company?.zip].filter(Boolean).join(', '));
  const companyPhone = esc(company?.phone || '');
  const companyEmail = esc(company?.email || '');
  const employeeName = esc(employee?.name || stub?.employee_name || 'Employee');
  const employeeAddr = esc([employee?.address_line1, employee?.city, employee?.state, employee?.zip].filter(Boolean).join(', '));
  const employeeSSN = maskSSN(employee?.ssn || employee?.ssn_last4);
  const employeeId = esc(employee?.id?.substring(0, 8)?.toUpperCase() || '');
  const payDate = fmtDate(run?.pay_date || stub?.pay_date || '');
  const payDateShort = fmtDateShort(run?.pay_date || stub?.pay_date || '');
  const periodStart = fmtDateShort(run?.pay_period_start || stub?.period_start || '');
  const periodEnd = fmtDateShort(run?.pay_period_end || stub?.period_end || '');
  const netPay = stub?.net_pay || 0;
  const grossPay = stub?.gross_pay || 0;
  const federalTax = stub?.federal_tax || 0;
  const stateTax = stub?.state_tax || 0;
  const ssTax = stub?.social_security || 0;
  const medicareTax = stub?.medicare || 0;
  const preTaxDed = stub?.pretax_deductions || stub?.other_deductions || 0;
  const postTaxDed = stub?.posttax_deductions || 0;
  const totalDeductions = federalTax + stateTax + ssTax + medicareTax + preTaxDed + postTaxDed;
  const hoursRegular = stub?.hours_regular || stub?.hours || 0;
  const hoursOvertime = stub?.hours_overtime || 0;
  const totalHours = hoursRegular + hoursOvertime;
  const checkNumber = esc(options?.checkNumber || stub?.check_number || stub?.id?.substring(0, 6).toUpperCase() || '000001');
  const ytdGross = stub?.ytd_gross || 0;
  const ytdTaxes = stub?.ytd_taxes || 0;
  const ytdNet = stub?.ytd_net || 0;
  const isVoid = options?.isVoid || false;
  const memo = esc(options?.memo || `Payroll ${periodStart} — ${periodEnd}`);
  const payScheduleLabel = esc(stub?.pay_schedule || run?.pay_schedule || employee?.pay_schedule || '');
  const isDirectDeposit = !!(employee?.routing_number);
  const payType = esc(employee?.pay_type || (hoursRegular > 0 ? 'hourly' : 'salary'));
  const payRate = employee?.pay_rate || 0;

  // Computed values
  const effectiveRate = totalHours > 0 ? grossPay / (hoursRegular + hoursOvertime * 1.5) : payRate;
  const regularPay = totalHours > 0 ? effectiveRate * hoursRegular : grossPay;
  const overtimePay = totalHours > 0 ? effectiveRate * 1.5 * hoursOvertime : 0;
  const ytdFederalTax = stub?.ytd_federal_tax || 0;
  const ytdStateTax = stub?.ytd_state_tax || 0;
  const ytdSS = stub?.ytd_social_security || 0;
  const ytdMedicare = stub?.ytd_medicare || 0;

  // Parse deduction detail
  let deductionItems: [string, number][] = [];
  if (stub?.deduction_detail && stub.deduction_detail !== '{}') {
    try {
      const detail = JSON.parse(stub.deduction_detail);
      deductionItems = Object.entries(detail).map(([k, v]) => [k, Number(v)]);
    } catch { /* ignore */ }
  }

  const voidWatermark = isVoid ? '<div class="void-watermark">VOID</div>' : '';
  const ddBanner = isDirectDeposit
    ? `<div style="position:absolute;top:0.2in;left:50%;transform:translateX(-50%);font-size:9px;font-weight:700;color:#2563eb;letter-spacing:2px;text-transform:uppercase;font-family:Calibri,sans-serif;">*** NON-NEGOTIABLE &mdash; DIRECT DEPOSIT ***</div>`
    : '';

  // ═══════════════════════════════════════════════════════
  // STUB SECTION BUILDER (used for both employee + employer)
  // ═══════════════════════════════════════════════════════
  const buildStub = (label: string, showYTDDetail: boolean) => `
    <div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin-bottom:4px;">${label}</div>

    <!-- Stub Header: Company + Employee + Pay Info -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
      <div>
        <div style="font-size:12px;font-weight:800;color:#0f172a;">${companyName}</div>
        <div style="font-size:8px;color:#64748b;">${companyAddr}${companyCityState ? (companyAddr ? ', ' : '') + companyCityState : ''}</div>
      </div>
      <div style="text-align:right;font-size:8.5px;color:#475569;line-height:1.5;">
        <div><strong>Pay Date:</strong> ${payDateShort}</div>
        <div><strong>Period:</strong> ${periodStart} &ndash; ${periodEnd}</div>
        <div><strong>Check #:</strong> ${checkNumber} &nbsp;|&nbsp; ${isDirectDeposit ? 'Direct Deposit' : 'Check'}</div>
      </div>
    </div>

    <!-- Employee Info Bar -->
    <div style="display:flex;justify-content:space-between;align-items:center;background:#f1f5f9;border:1px solid #e2e8f0;padding:4px 8px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="font-size:11px;font-weight:700;color:#0f172a;">${employeeName}</div>
        ${employeeSSN ? `<div style="font-size:8px;color:#64748b;">SSN: ${employeeSSN}</div>` : ''}
        ${employeeId ? `<div style="font-size:8px;color:#64748b;">ID: ${employeeId}</div>` : ''}
      </div>
      <div style="font-size:8px;color:#64748b;text-transform:capitalize;">${payType} ${payScheduleLabel ? '&middot; ' + payScheduleLabel : ''}</div>
    </div>

    <!-- Main Content: Earnings | Deductions | Net Pay -->
    <div style="display:flex;gap:8px;">

      <!-- EARNINGS TABLE -->
      <div style="flex:1.2;">
        <table class="stub-table">
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
              <td class="r">${hoursRegular.toFixed(2)}</td>
              <td class="r">${fmt(effectiveRate)}</td>
              <td class="r bold">${fmt(regularPay)}</td>
              <td class="r light">—</td>
            </tr>
            ${hoursOvertime > 0 ? `
            <tr>
              <td>Overtime (1.5x)</td>
              <td class="r">${hoursOvertime.toFixed(2)}</td>
              <td class="r">${fmt(effectiveRate * 1.5)}</td>
              <td class="r bold">${fmt(overtimePay)}</td>
              <td class="r light">—</td>
            </tr>` : ''}
            ` : `
            <tr>
              <td>Salary</td>
              <td class="r light">—</td>
              <td class="r">${payRate > 0 ? fmt(payRate) : '—'}</td>
              <td class="r bold">${fmt(grossPay)}</td>
              <td class="r light">—</td>
            </tr>
            `}
            <tr class="total-row">
              <td>Gross Pay</td>
              <td class="r">${totalHours > 0 ? totalHours.toFixed(2) : ''}</td>
              <td></td>
              <td class="r">${fmt(grossPay)}</td>
              <td class="r">${fmt(ytdGross)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- DEDUCTIONS TABLE -->
      <div style="flex:1;">
        <table class="stub-table">
          <thead><tr>
            <th>Deductions</th>
            <th class="r">Current</th>
            ${showYTDDetail ? '<th class="r">YTD</th>' : ''}
          </tr></thead>
          <tbody>
            <tr><td>Federal Income Tax</td><td class="r">${fmt(federalTax)}</td>${showYTDDetail ? `<td class="r light">${ytdFederalTax > 0 ? fmt(ytdFederalTax) : '—'}</td>` : ''}</tr>
            <tr><td>State Income Tax</td><td class="r">${fmt(stateTax)}</td>${showYTDDetail ? `<td class="r light">${ytdStateTax > 0 ? fmt(ytdStateTax) : '—'}</td>` : ''}</tr>
            <tr><td>Social Security (6.2%)</td><td class="r">${fmt(ssTax)}</td>${showYTDDetail ? `<td class="r light">${ytdSS > 0 ? fmt(ytdSS) : '—'}</td>` : ''}</tr>
            <tr><td>Medicare (1.45%)</td><td class="r">${fmt(medicareTax)}</td>${showYTDDetail ? `<td class="r light">${ytdMedicare > 0 ? fmt(ytdMedicare) : '—'}</td>` : ''}</tr>
            ${preTaxDed > 0 ? `<tr><td>Pre-Tax Deductions</td><td class="r">${fmt(preTaxDed)}</td>${showYTDDetail ? '<td class="r light">—</td>' : ''}</tr>` : ''}
            ${postTaxDed > 0 ? `<tr><td>Post-Tax Deductions</td><td class="r">${fmt(postTaxDed)}</td>${showYTDDetail ? '<td class="r light">—</td>' : ''}</tr>` : ''}
            ${deductionItems.map(([name, amount]) =>
              `<tr><td style="padding-left:14px;font-size:8px;color:#64748b;">${esc(name)}</td><td class="r" style="font-size:8px;color:#64748b;">${fmt(amount)}</td>${showYTDDetail ? '<td class="r light">—</td>' : ''}</tr>`
            ).join('')}
            <tr class="total-row"><td>Total Deductions</td><td class="r">${fmt(totalDeductions)}</td>${showYTDDetail ? `<td class="r">${fmt(ytdTaxes)}</td>` : ''}</tr>
          </tbody>
        </table>
      </div>

      <!-- NET PAY BOX -->
      <div style="width:115px;display:flex;flex-direction:column;justify-content:space-between;">
        <div class="net-box">
          <div class="net-label">Net Pay</div>
          <div class="net-amount">${fmt(netPay)}</div>
        </div>
        ${showYTDDetail ? `
        <div style="margin-top:4px;border:1px solid #e2e8f0;padding:4px 6px;">
          <div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8;margin-bottom:2px;">YTD Summary</div>
          <div style="display:flex;justify-content:space-between;font-size:8px;"><span class="light">Gross</span><span class="bold">${fmt(ytdGross)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:8px;"><span class="light">Taxes</span><span style="color:#dc2626;">${fmt(ytdTaxes)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:8px;border-top:1px solid #e2e8f0;padding-top:2px;margin-top:2px;"><span class="bold">Net</span><span class="bold" style="color:#16a34a;">${fmt(ytdNet)}</span></div>
        </div>
        ` : `
        <div style="text-align:center;margin-top:4px;">
          <div style="font-size:7px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">YTD Net</div>
          <div style="font-size:10px;font-weight:700;">${fmt(ytdNet)}</div>
        </div>
        `}
      </div>
    </div>`;

  // ═══════════════════════════════════════════════════════
  // FULL PAGE HTML
  // ═══════════════════════════════════════════════════════
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${CHECK_STYLES}
</style></head><body>
<div class="page">

  <!-- ═══ CHECK (Top Third) ═══ -->
  <div class="check-section">
    ${voidWatermark}
    ${ddBanner}

    <!-- Company Info + Check Number -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
      <div>
        <div style="font-size:16px;font-weight:800;color:#0f172a;letter-spacing:-0.2px;">${companyName}</div>
        ${companyLegal && companyLegal !== companyName ? `<div style="font-size:8px;color:#94a3b8;">${companyLegal}</div>` : ''}
        <div style="font-size:9px;color:#64748b;margin-top:3px;line-height:1.4;">
          ${companyAddr ? companyAddr + '<br>' : ''}
          ${companyCityState || ''}
          ${companyPhone ? '<br>' + companyPhone : ''}${companyEmail ? (companyPhone ? ' &middot; ' : '<br>') + companyEmail : ''}
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;">Check No.</div>
        <div style="font-size:20px;font-weight:800;font-family:Calibri,sans-serif;color:#0f172a;letter-spacing:1px;">${checkNumber}</div>
        <div style="font-size:10px;color:#334155;margin-top:6px;">
          <span style="font-weight:700;">Date:</span> ${payDate}
        </div>
      </div>
    </div>

    <!-- PAY TO THE ORDER OF -->
    <div style="margin-bottom:8px;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;margin-bottom:3px;">Pay to the Order of</div>
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0f172a;padding-bottom:3px;">
        <div style="font-size:15px;font-weight:700;color:#0f172a;">${employeeName}</div>
        <div style="font-size:17px;font-weight:800;font-family:Calibri,sans-serif;border:2px solid #0f172a;padding:2px 14px;color:#0f172a;letter-spacing:0.5px;">
          ${fmt(netPay)}
        </div>
      </div>
    </div>

    <!-- Amount in Words -->
    <div style="border-bottom:1.5px solid #334155;padding-bottom:3px;margin-bottom:10px;">
      <span style="font-size:10px;color:#0f172a;">${amountToWords(netPay)}</span>
      <span style="font-size:10px;color:#94a3b8;"> ************************************</span>
    </div>

    <!-- Memo + Signature -->
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:1px;">Memo</div>
        <div style="font-size:9px;color:#334155;">${memo}</div>
      </div>
      <div style="text-align:right;">
        <div style="border-top:1.5px solid #334155;width:200px;padding-top:3px;">
          <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;">Authorized Signature</span>
        </div>
      </div>
    </div>

    <!-- MICR Line -->
    <div class="micr-line">&#9416;${checkNumber}&#9416; &#9414;000000000&#9414; 0000000000&#9416;</div>
  </div>

  <!-- ═══ EMPLOYEE STUB (Middle Third) ═══ -->
  <div class="stub-section">
    ${voidWatermark}
    ${buildStub('Employee Copy &mdash; Detach and Retain', false)}
  </div>

  <!-- ═══ EMPLOYER STUB (Bottom Third) ═══ -->
  <div class="stub-section">
    ${voidWatermark}
    ${buildStub('Employer Copy &mdash; For Records', true)}
  </div>

</div>
</body></html>`;
}

// ─── Extract body content (for batch printing) ─────────────
export function extractCheckBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match?.[1] || html;
}

// ─── Batch check wrapper ───────────────────────────────────
export function wrapBatchChecks(bodies: string[]): string {
  const combined = bodies.join('<div style="page-break-before:always;"></div>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${CHECK_STYLES}
</style></head><body>${combined}</body></html>`;
}
