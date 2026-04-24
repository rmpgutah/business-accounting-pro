/**
 * Payroll Check Print Template
 * Generates HTML for a standard check-on-top format:
 *   Top third: Negotiable check
 *   Middle third: Employee stub (detach and retain)
 *   Bottom third: Employer stub (for records)
 * Designed for letter-size (8.5 x 11 in) paper with micro-dotted fold lines.
 */

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

// ─── Main generator ────────────────────────────────────────
export function generatePaycheckHTML(
  stub: any,
  employee: any,
  company: any,
  run: any,
  options?: { isVoid?: boolean; checkNumber?: string; memo?: string }
): string {
  const companyName = company?.name || 'Company';
  const companyAddr = [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
  const companyPhone = company?.phone || '';
  const employeeName = employee?.name || stub?.employee_name || 'Employee';
  const employeeAddr = [employee?.address_line1, employee?.city, employee?.state, employee?.zip].filter(Boolean).join(', ');
  const employeeSSN = maskSSN(employee?.ssn || employee?.ssn_last4);
  const payDate = fmtDate(run?.pay_date || stub?.pay_date || '');
  const periodStart = fmtDate(run?.pay_period_start || stub?.period_start || '');
  const periodEnd = fmtDate(run?.pay_period_end || stub?.period_end || '');
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
  const checkNumber = options?.checkNumber || stub?.check_number || stub?.id?.substring(0, 6).toUpperCase() || '000001';
  const ytdGross = stub?.ytd_gross || 0;
  const ytdTaxes = stub?.ytd_taxes || 0;
  const ytdNet = stub?.ytd_net || 0;
  const isVoid = options?.isVoid || false;
  const memo = options?.memo || `Payroll ${periodStart} — ${periodEnd}`;
  const payScheduleLabel = stub?.pay_schedule || run?.pay_schedule || '';
  const isDirectDeposit = !!(employee?.routing_number);

  // Payment method indicator
  const paymentMethod = isDirectDeposit ? 'DIRECT DEPOSIT' : 'CHECK';

  // Earnings detail rows
  let earningsRows = '';
  if (hoursRegular > 0) {
    const regularRate = hoursOvertime > 0 && hoursRegular > 0
      ? (grossPay - (hoursOvertime * (grossPay / (hoursRegular + hoursOvertime * 1.5)) * 1.5)) / hoursRegular
      : (hoursRegular > 0 ? grossPay / hoursRegular : 0);
    earningsRows += `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;">Regular</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">${hoursRegular.toFixed(2)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">${hoursRegular > 0 ? fmt(regularRate) : '—'}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;font-weight:600;">${fmt(hoursRegular * regularRate)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">${fmt(ytdGross)}</td>
    </tr>`;
    if (hoursOvertime > 0) {
      const otRate = regularRate * 1.5;
      earningsRows += `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;">Overtime (1.5x)</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">${hoursOvertime.toFixed(2)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">${fmt(otRate)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;font-weight:600;">${fmt(hoursOvertime * otRate)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">—</td>
      </tr>`;
    }
  } else {
    earningsRows += `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;">Salary</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">—</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">—</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;font-weight:600;">${fmt(grossPay)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e5e5;text-align:right;">${fmt(ytdGross)}</td>
    </tr>`;
  }

  // Deductions detail
  const deductionItems = [
    { name: 'Federal Income Tax', amount: federalTax },
    { name: 'State Income Tax', amount: stateTax },
    { name: 'Social Security (6.2%)', amount: ssTax },
    { name: 'Medicare (1.45%)', amount: medicareTax },
    ...(preTaxDed > 0 ? [{ name: 'Pre-Tax Deductions', amount: preTaxDed }] : []),
    ...(postTaxDed > 0 ? [{ name: 'Post-Tax Deductions', amount: postTaxDed }] : []),
  ];
  const deductionRows = deductionItems.map(d => `<tr>
    <td style="padding:3px 8px;border-bottom:1px solid #e5e5e5;font-size:10px;">${d.name}</td>
    <td style="padding:3px 8px;border-bottom:1px solid #e5e5e5;text-align:right;font-size:10px;font-family:monospace;">${fmt(d.amount)}</td>
  </tr>`).join('');

  // Stub section (used twice -- employee copy and employer copy)
  const stubSection = `
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
      <div>
        <div style="font-size:14px;font-weight:700;">${companyName}</div>
        <div style="font-size:10px;color:#555;">${companyAddr}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:#555;">Pay Date: <strong>${payDate}</strong></div>
        <div style="font-size:10px;color:#555;">Period: ${periodStart} — ${periodEnd}</div>
        <div style="font-size:10px;color:#555;">Check #${checkNumber}</div>
        ${payScheduleLabel ? `<div style="font-size:10px;color:#555;text-transform:capitalize;">${payScheduleLabel} Pay</div>` : ''}
        <div style="font-size:10px;color:#555;font-weight:600;">${paymentMethod}</div>
      </div>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:6px;">
      <div style="font-size:11px;"><strong>${employeeName}</strong></div>
      ${employeeSSN ? `<div style="font-size:10px;color:#555;margin-left:8px;">SSN: ${employeeSSN}</div>` : ''}
      ${employeeAddr ? `<div style="font-size:10px;color:#555;margin-left:8px;">${employeeAddr}</div>` : ''}
    </div>
    <div style="display:flex;gap:16px;">
      <div style="flex:1;">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#555;margin-bottom:4px;">Earnings</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr style="background:#f0f0f0;">
            <th style="padding:3px 8px;text-align:left;font-size:8px;text-transform:uppercase;">Type</th>
            <th style="padding:3px 8px;text-align:right;font-size:8px;">Hours</th>
            <th style="padding:3px 8px;text-align:right;font-size:8px;">Rate</th>
            <th style="padding:3px 8px;text-align:right;font-size:8px;">Current</th>
            <th style="padding:3px 8px;text-align:right;font-size:8px;">YTD</th>
          </tr></thead>
          <tbody>${earningsRows}
            <tr style="font-weight:700;"><td colspan="3" style="padding:3px 8px;">Gross Pay</td><td style="padding:3px 8px;text-align:right;">${fmt(grossPay)}</td><td style="padding:3px 8px;text-align:right;">${fmt(ytdGross)}</td></tr>
          </tbody>
        </table>
      </div>
      <div style="flex:1;">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#555;margin-bottom:4px;">Deductions</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr style="background:#f0f0f0;"><th style="padding:3px 8px;text-align:left;font-size:8px;text-transform:uppercase;">Description</th><th style="padding:3px 8px;text-align:right;font-size:8px;">Amount</th></tr></thead>
          <tbody>${deductionRows}
            <tr style="font-weight:700;"><td style="padding:3px 8px;">Total Deductions</td><td style="padding:3px 8px;text-align:right;">${fmt(totalDeductions)}</td></tr>
          </tbody>
        </table>
      </div>
      <div style="width:140px;text-align:center;border:2px solid #111;padding:8px;">
        <div style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#555;">Net Pay</div>
        <div style="font-size:20px;font-weight:800;font-family:monospace;">${fmt(netPay)}</div>
      </div>
    </div>`;

  const voidWatermark = isVoid ? '<div class="void-watermark">VOID</div>' : '';
  const directDepositBanner = isDirectDeposit
    ? `<div style="position:absolute;top:0.3in;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:#0066cc;letter-spacing:2px;text-transform:uppercase;">*** NON-NEGOTIABLE — DIRECT DEPOSIT ***</div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Courier New', monospace; font-size: 11px; color: #111; }
  .page { width: 8.5in; height: 11in; position: relative; }
  .check-section { height: 3.667in; padding: 0.3in 0.5in; position: relative; border-bottom: 1px dashed #999; }
  .stub-section { height: 3.667in; padding: 0.25in 0.5in; position: relative; border-bottom: 1px dashed #999; }
  .stub-section:last-child { border-bottom: none; }
  .fold-guide { position: absolute; left: 0; right: 0; bottom: 0; height: 0; border-bottom: 1px dashed #bbb; }
  .fold-label { position: absolute; right: 0.5in; bottom: 2px; font-size: 7px; color: #bbb; letter-spacing: 1px; }
  .micr-line { font-family: 'MICR', 'Courier New', monospace; font-size: 12px; letter-spacing: 2px; color: #333; position: absolute; bottom: 0.3in; left: 0.5in; }
  .void-watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 60px; font-weight: 900; color: rgba(200,0,0,0.15); letter-spacing: 10px; pointer-events: none; z-index: 10; }
  @media print {
    .fold-guide { border-bottom-style: dashed !important; }
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
</style></head><body>
<div class="page">
  <!-- CHECK (Top Third) -->
  <div class="check-section">
    ${voidWatermark}
    ${directDepositBanner}
    <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
      <div>
        <div style="font-size:16px;font-weight:800;">${companyName}</div>
        <div style="font-size:10px;color:#555;">${companyAddr}</div>
        ${companyPhone ? `<div style="font-size:10px;color:#555;">${companyPhone}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:#555;">Check #</div>
        <div style="font-size:18px;font-weight:700;font-family:monospace;">${checkNumber}</div>
        <div style="font-size:11px;margin-top:4px;">Date: <strong>${payDate}</strong></div>
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <div style="font-size:10px;color:#555;margin-bottom:2px;">PAY TO THE ORDER OF</div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #111;padding-bottom:4px;">
        <div style="font-size:14px;font-weight:700;">${employeeName}</div>
        <div style="font-size:16px;font-weight:800;font-family:monospace;border:2px solid #111;padding:2px 12px;">
          ${fmt(netPay)}
        </div>
      </div>
    </div>

    <div style="border-bottom:1px solid #111;padding-bottom:4px;margin-bottom:12px;">
      <div style="font-size:11px;">${amountToWords(netPay)} ************************************</div>
    </div>

    <div style="display:flex;justify-content:space-between;">
      <div>
        <div style="font-size:10px;color:#555;">Memo: ${memo}</div>
      </div>
      <div style="text-align:right;">
        <div style="border-top:1px solid #111;width:200px;padding-top:4px;font-size:10px;">Authorized Signature</div>
      </div>
    </div>

    <div class="micr-line">&#9416;${checkNumber}&#9416; &#9414;000000000&#9414; 0000000000&#9416;</div>
    <div class="fold-guide"><span class="fold-label">— FOLD HERE —</span></div>
  </div>

  <!-- EMPLOYEE STUB (Middle Third) -->
  <div class="stub-section">
    ${voidWatermark}
    <div style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:6px;">Employee Copy — Detach and Retain</div>
    ${stubSection}
    <div class="fold-guide"><span class="fold-label">— FOLD HERE —</span></div>
  </div>

  <!-- EMPLOYER STUB (Bottom Third) -->
  <div class="stub-section">
    ${voidWatermark}
    <div style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:6px;">Employer Copy — For Records</div>
    ${stubSection}
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
    @page { size: letter; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Courier New', monospace; font-size: 11px; color: #111; }
    .page { width: 8.5in; height: 11in; position: relative; }
    .check-section { height: 3.667in; padding: 0.3in 0.5in; position: relative; border-bottom: 1px dashed #999; }
    .stub-section { height: 3.667in; padding: 0.25in 0.5in; position: relative; border-bottom: 1px dashed #999; }
    .stub-section:last-child { border-bottom: none; }
    .fold-guide { position: absolute; left: 0; right: 0; bottom: 0; height: 0; border-bottom: 1px dashed #bbb; }
    .fold-label { position: absolute; right: 0.5in; bottom: 2px; font-size: 7px; color: #bbb; letter-spacing: 1px; }
    .micr-line { font-family: 'MICR', 'Courier New', monospace; font-size: 12px; letter-spacing: 2px; color: #333; position: absolute; bottom: 0.3in; left: 0.5in; }
    .void-watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 60px; font-weight: 900; color: rgba(200,0,0,0.15); letter-spacing: 10px; pointer-events: none; z-index: 10; }
    @media print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style></head><body>${combined}</body></html>`;
}
