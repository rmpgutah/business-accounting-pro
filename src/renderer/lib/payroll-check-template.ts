/**
 * Payroll Check Print Template — Production Grade
 * Check-on-top (3-part) for 8.5x11 blank check paper.
 * Calibri/sans-serif. All text BLACK except YTD Summary taxes(red)/net(green).
 */

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n || 0);
const fmtLong = (d: string) => { if (!d) return ''; try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return d; } };
const fmtShort = (d: string) => { if (!d) return ''; try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); } catch { return d; } };

function amountToWords(amount: number): string {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const dollars = Math.floor(amount); const cents = Math.round((amount - dollars) * 100);
  function c(n: number): string {
    if (n === 0) return 'Zero'; if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + c(n % 100) : '');
    if (n < 1e6) return c(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + c(n % 1000) : '');
    return c(Math.floor(n / 1e6)) + ' Million' + (n % 1e6 ? ' ' + c(n % 1e6) : '');
  }
  return c(dollars) + ' and ' + String(cents).padStart(2, '0') + '/100 DOLLARS';
}

function maskSSN(ssn: string | undefined | null): string {
  if (!ssn) return ''; const d = ssn.replace(/\D/g, '');
  return d.length >= 4 ? '***-**-' + d.slice(-4) : ssn;
}

// ─── Shared CSS ───────────────────────────────────────────
const CSS = `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Calibri, 'Segoe UI', -apple-system, Arial, sans-serif; font-size: 10px; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 8.5in; height: 11in; position: relative; }
.sec-check { height: 3.667in; padding: 0.2in 0.4in 0.28in; position: relative; overflow: hidden; }
.sec-stub { height: 3.667in; padding: 0.1in 0.3in 0.06in; position: relative; overflow: hidden; }
/* Tables */
.t { width:100%; border-collapse:collapse; }
.t th { padding:2px 4px; font-size:6.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:#000; border-bottom:1.5px solid #000; background:#e8e8e8; text-align:left; }
.t th.r { text-align:right; }
.t td { padding:2px 4px; font-size:8px; border-bottom:0.5px solid #ccc; color:#000; }
.t td.r { text-align:right; font-variant-numeric:tabular-nums; }
.t td.b { font-weight:700; }
.t tr.tot td { border-top:1.5px solid #000; border-bottom:none; font-weight:700; padding-top:2px; }
.t tr.sub td { font-size:7px; padding-left:10px; border-bottom:0.5px dashed #ddd; }
.void-wm { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:56px; font-weight:900; color:rgba(200,0,0,0.12); letter-spacing:10px; pointer-events:none; z-index:10; }
.micr { font-family:'MICR','Courier New',monospace; font-size:11px; letter-spacing:2px; color:#000; position:absolute; bottom:0.2in; left:0.45in; }
@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
`;

// ─── Main Generator ───────────────────────────────────────
export function generatePaycheckHTML(
  stub: any, employee: any, company: any, run: any,
  options?: { isVoid?: boolean; checkNumber?: string; memo?: string }
): string {
  // ── Company ──
  const co = esc(company?.name || 'Company');
  const coLegal = esc(company?.legal_name || '');
  const coAddr1 = esc(company?.address_line1 || '');
  const coAddr2 = esc(company?.address_line2 || '');
  const coCSZ = esc([company?.city, company?.state, company?.zip].filter(Boolean).join(', '));
  const coPhone = esc(company?.phone || '');
  const coEmail = esc(company?.email || '');
  const coEIN = esc(company?.ein || company?.tax_id || '');
  const coBank = esc(company?.bank_name || '');
  const coRouting = esc(company?.bank_routing_number || '');
  const coAcct = esc(company?.bank_account_number || '');
  const coFraction = esc(company?.bank_fraction_code || '');

  // ── Employee ──
  const empName = esc(employee?.name || stub?.employee_name || 'Employee');
  const empAddr1 = esc(employee?.address_line1 || '');
  const empAddr2 = esc(employee?.address_line2 || '');
  const empCSZ = esc([employee?.city, employee?.state, employee?.zip].filter(Boolean).join(', '));
  const empSSN = maskSSN(employee?.ssn || employee?.ssn_last4);
  const empId = esc(employee?.id?.substring(0, 8)?.toUpperCase() || '');
  const empDept = esc(employee?.department || '');
  const empHireDate = fmtShort(employee?.start_date || '');
  const empEmail = esc(employee?.email || '');
  const empFiling = esc(employee?.filing_status || '');
  const empAllowances = employee?.federal_allowances ?? '';
  const empStateCode = esc(employee?.state || '');
  const empStateAllow = employee?.state_allowances ?? '';

  // ── Pay info ──
  const payDate = fmtLong(run?.pay_date || stub?.pay_date || '');
  const payDateS = fmtShort(run?.pay_date || stub?.pay_date || '');
  const pStart = fmtShort(run?.pay_period_start || stub?.period_start || '');
  const pEnd = fmtShort(run?.pay_period_end || stub?.period_end || '');
  const runType = esc(run?.run_type || stub?.run_type || 'regular');
  const paySchedule = esc(employee?.pay_schedule || run?.pay_schedule || stub?.pay_schedule || '');
  const isDD = !!(employee?.routing_number);
  const payType = esc(employee?.pay_type || (stub?.hours_regular > 0 ? 'hourly' : 'salary'));
  const payRate = employee?.pay_rate || 0;

  // ── Amounts ──
  const net = stub?.net_pay || 0;
  const gross = stub?.gross_pay || 0;
  const fedTax = stub?.federal_tax || 0;
  const stTax = stub?.state_tax || 0;
  const ss = stub?.social_security || 0;
  const med = stub?.medicare || 0;
  const preTax = stub?.pretax_deductions || stub?.other_deductions || 0;
  const postTax = stub?.posttax_deductions || 0;
  const totalTaxes = fedTax + stTax + ss + med;
  const totalDed = totalTaxes + preTax + postTax;
  const hrsReg = stub?.hours_regular || stub?.hours || 0;
  const hrsOT = stub?.hours_overtime || 0;
  const hrsTot = hrsReg + hrsOT;
  const chkNum = esc(options?.checkNumber || stub?.check_number || stub?.id?.substring(0, 6).toUpperCase() || '000001');

  // ── YTD ──
  const ytdG = stub?.ytd_gross || 0;
  const ytdT = stub?.ytd_taxes || 0;
  const ytdN = stub?.ytd_net || 0;
  const ytdFed = stub?.ytd_federal_tax || 0;
  const ytdSt = stub?.ytd_state_tax || 0;
  const ytdSS = stub?.ytd_social_security || 0;
  const ytdMed = stub?.ytd_medicare || 0;

  // ── Computed ──
  const effRate = hrsTot > 0 ? gross / (hrsReg + hrsOT * 1.5) : payRate;
  const regPay = hrsTot > 0 ? effRate * hrsReg : gross;
  const otPay = hrsTot > 0 ? effRate * 1.5 * hrsOT : 0;
  const taxableWages = gross - preTax;
  const fedEffRate = taxableWages > 0 ? ((fedTax / taxableWages) * 100).toFixed(1) : '0.0';
  const stEffRate = taxableWages > 0 ? ((stTax / taxableWages) * 100).toFixed(1) : '0.0';
  const totalEffRate = gross > 0 ? ((totalDed / gross) * 100).toFixed(1) : '0.0';

  const isVoid = options?.isVoid || false;
  const memo = esc(options?.memo || `Payroll ${pStart} — ${pEnd}`);

  // Deduction detail
  let dedItems: [string, number][] = [];
  if (stub?.deduction_detail && stub.deduction_detail !== '{}') {
    try { dedItems = Object.entries(JSON.parse(stub.deduction_detail)).map(([k, v]) => [k, Number(v)]); } catch {}
  }

  const voidWM = isVoid ? '<div class="void-wm">VOID</div>' : '';
  const ddBanner = isDD ? `<div style="position:absolute;top:0.15in;left:50%;transform:translateX(-50%);font-size:8px;font-weight:700;color:#000;letter-spacing:2px;text-transform:uppercase;">*** NON-NEGOTIABLE — DIRECT DEPOSIT ***</div>` : '';

  // ═══════════════════════════════════════
  // CHECK FACE (top third)
  // ═══════════════════════════════════════
  const checkHTML = `
  <div class="sec-check">
    ${voidWM}${ddBanner}

    <!-- Row 1: Company + Bank + Check # -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
      <!-- Company Block -->
      <div style="max-width:55%;">
        <div style="font-size:15px;font-weight:800;letter-spacing:-0.2px;">${co}</div>
        ${coLegal && coLegal !== co ? `<div style="font-size:7px;">${coLegal}</div>` : ''}
        <div style="font-size:8px;line-height:1.35;margin-top:2px;">
          ${coAddr1 ? coAddr1 + '<br>' : ''}${coAddr2 ? coAddr2 + '<br>' : ''}${coCSZ}
          ${coPhone ? '<br>' + coPhone : ''}${coEmail ? ' &middot; ' + coEmail : ''}
          ${coEIN ? '<br>EIN: ' + coEIN : ''}
        </div>
      </div>
      <!-- Check Number + Date + Bank -->
      <div style="text-align:right;">
        <div style="font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Check No.</div>
        <div style="font-size:19px;font-weight:800;letter-spacing:1px;line-height:1;">${chkNum}</div>
        ${coFraction ? `<div style="font-size:7px;margin-top:1px;">${coFraction}</div>` : ''}
        <div style="font-size:9px;margin-top:4px;"><strong>Date:</strong> ${payDate}</div>
        ${coBank ? `<div style="font-size:7px;margin-top:2px;">${coBank}</div>` : ''}
      </div>
    </div>

    <!-- Row 2: PAY TO THE ORDER OF -->
    <div style="margin-bottom:4px;">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:2px;">Pay to the Order of</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:2px;">
        <div>
          <div style="font-size:13px;font-weight:700;">${empName}</div>
          <div style="font-size:8px;">
            ${empAddr1 ? empAddr1 + '<br>' : ''}${empAddr2 ? empAddr2 + '<br>' : ''}${empCSZ}
          </div>
        </div>
        <div style="border:2px solid #000;padding:2px 12px;min-width:120px;text-align:center;">
          <div style="font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Amount</div>
          <div style="font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;">${fmt(net)}</div>
        </div>
      </div>
    </div>

    <!-- Row 3: Amount in words -->
    <div style="border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:6px;font-size:9px;">
      ${amountToWords(net)} <span style="letter-spacing:2px;">********</span>
    </div>

    <!-- Row 4: Bank + Memo + Signature -->
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div style="font-size:8px;">
        ${coBank ? `<div style="font-weight:700;">${coBank}</div>` : ''}
        <div style="margin-top:2px;"><strong>Memo:</strong> ${memo}</div>
      </div>
      <div style="text-align:center;">
        <div style="border-top:1px solid #000;width:180px;padding-top:2px;">
          <span style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Authorized Signature</span>
        </div>
      </div>
    </div>

    <!-- MICR -->
    <div class="micr">&#9416;${chkNum}&#9416; &#9414;${coRouting || '000000000'}&#9414; ${coAcct || '0000000000'}&#9416;</div>
  </div>`;

  // ═══════════════════════════════════════
  // STUB BUILDER (employee + employer)
  // ═══════════════════════════════════════
  const buildStub = (label: string, isEmployer: boolean) => `
  <div class="sec-stub">
    ${voidWM}

    <!-- Header: Label + Company -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
      <div style="font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">${label}</div>
      <div style="font-size:10px;font-weight:800;">${co}</div>
    </div>

    <!-- 14-cell Info Grid -->
    <div style="display:grid;grid-template-columns:repeat(7,1fr);border:1px solid #999;margin-bottom:4px;font-size:7px;">
      <div style="padding:2px 4px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;grid-column:span 2;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.2px;">Employee</div>
        <div style="font-weight:700;font-size:9px;">${empName}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">SSN</div>
        <div>${empSSN || '—'}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Emp. ID</div>
        <div>${empId || '—'}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Pay Date</div>
        <div style="font-weight:700;">${payDateS}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;border-bottom:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Period</div>
        <div>${pStart} — ${pEnd}</div>
      </div>
      <div style="padding:2px 4px;border-bottom:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Check #</div>
        <div style="font-weight:700;">${chkNum}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Department</div>
        <div>${empDept || '—'}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Hire Date</div>
        <div>${empHireDate || '—'}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Filing / Allow.</div>
        <div style="text-transform:capitalize;">${empFiling || '—'} / ${empAllowances !== '' ? empAllowances : '—'}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">State / Allow.</div>
        <div>${empStateCode || '—'} / ${empStateAllow !== '' ? empStateAllow : '—'}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Pay Type / Rate</div>
        <div style="text-transform:capitalize;">${payType}${payRate > 0 ? ' @ ' + fmt(payRate) : ''}</div>
      </div>
      <div style="padding:2px 4px;border-right:1px solid #ddd;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Schedule</div>
        <div style="text-transform:capitalize;">${paySchedule || '—'}</div>
      </div>
      <div style="padding:2px 4px;">
        <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;">Method / Type</div>
        <div style="text-transform:capitalize;">${isDD ? 'Direct Dep.' : 'Check'} / ${runType}</div>
      </div>
    </div>

    <!-- 3-Column Layout: Earnings | Taxes+Deductions | Summary -->
    <div style="display:flex;gap:5px;">

      <!-- COL 1: EARNINGS -->
      <div style="flex:1.3;">
        <table class="t">
          <thead><tr><th>Earnings</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Current</th><th class="r">YTD</th></tr></thead>
          <tbody>
            ${hrsTot > 0 ? `
            <tr><td>Regular</td><td class="r">${hrsReg.toFixed(2)}</td><td class="r">${fmt(effRate)}</td><td class="r b">${fmt(regPay)}</td><td class="r">${fmt(ytdG)}</td></tr>
            ${hrsOT > 0 ? `<tr><td>Overtime (1.5x)</td><td class="r">${hrsOT.toFixed(2)}</td><td class="r">${fmt(effRate * 1.5)}</td><td class="r b">${fmt(otPay)}</td><td class="r">—</td></tr>` : ''}
            ` : `
            <tr><td>Salary</td><td class="r">—</td><td class="r">${payRate > 0 ? fmt(payRate) + '/yr' : '—'}</td><td class="r b">${fmt(gross)}</td><td class="r">${fmt(ytdG)}</td></tr>
            `}
            <tr class="tot"><td>Gross Earnings</td><td class="r">${hrsTot > 0 ? hrsTot.toFixed(2) : ''}</td><td></td><td class="r">${fmt(gross)}</td><td class="r">${fmt(ytdG)}</td></tr>
          </tbody>
        </table>
        ${preTax > 0 ? `
        <table class="t" style="margin-top:2px;">
          <thead><tr><th colspan="2">Pre-Tax Deductions</th><th class="r">Current</th></tr></thead>
          <tbody>
            ${dedItems.filter(([, a]) => a > 0).map(([n, a]) => `<tr class="sub"><td colspan="2">${esc(n)}</td><td class="r">${fmt(a)}</td></tr>`).join('')}
            ${dedItems.length === 0 ? `<tr><td colspan="2">Pre-Tax</td><td class="r">${fmt(preTax)}</td></tr>` : ''}
            <tr class="tot"><td colspan="2">Taxable Wages</td><td class="r">${fmt(taxableWages)}</td></tr>
          </tbody>
        </table>
        ` : ''}
      </div>

      <!-- COL 2: TAXES + POST-TAX -->
      <div style="flex:1.1;">
        <table class="t">
          <thead><tr><th>Taxes</th><th class="r">Rate</th><th class="r">Current</th><th class="r">YTD</th></tr></thead>
          <tbody>
            <tr><td>Federal Income</td><td class="r">${fedEffRate}%</td><td class="r">${fmt(fedTax)}</td><td class="r">${ytdFed > 0 ? fmt(ytdFed) : '—'}</td></tr>
            <tr><td>State${empStateCode ? ' (' + empStateCode + ')' : ''}</td><td class="r">${stEffRate}%</td><td class="r">${fmt(stTax)}</td><td class="r">${ytdSt > 0 ? fmt(ytdSt) : '—'}</td></tr>
            <tr><td>Social Security</td><td class="r">6.20%</td><td class="r">${fmt(ss)}</td><td class="r">${ytdSS > 0 ? fmt(ytdSS) : '—'}</td></tr>
            <tr><td>Medicare</td><td class="r">1.45%</td><td class="r">${fmt(med)}</td><td class="r">${ytdMed > 0 ? fmt(ytdMed) : '—'}</td></tr>
            <tr class="tot"><td>Total Taxes</td><td class="r">${totalEffRate}%</td><td class="r">${fmt(totalTaxes)}</td><td class="r">${ytdT > 0 ? fmt(ytdT) : '—'}</td></tr>
          </tbody>
        </table>
        ${postTax > 0 ? `
        <table class="t" style="margin-top:2px;">
          <thead><tr><th>Post-Tax Deductions</th><th class="r">Current</th></tr></thead>
          <tbody><tr><td>Post-Tax</td><td class="r">${fmt(postTax)}</td></tr></tbody>
        </table>` : ''}
        ${isEmployer ? `
        <table class="t" style="margin-top:2px;">
          <thead><tr><th>Employer Contributions</th><th class="r">Current</th></tr></thead>
          <tbody>
            <tr><td>FICA Match (SS 6.2%)</td><td class="r">${fmt(ss)}</td></tr>
            <tr><td>FICA Match (Med 1.45%)</td><td class="r">${fmt(med)}</td></tr>
            <tr class="tot"><td>Total Employer Cost</td><td class="r">${fmt(gross + ss + med)}</td></tr>
          </tbody>
        </table>` : ''}
      </div>

      <!-- COL 3: SUMMARY -->
      <div style="width:120px;">
        <!-- Net Pay Box -->
        <div style="border:2px solid #000;text-align:center;padding:3px 5px;margin-bottom:3px;">
          <div style="font-size:5.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Net Pay</div>
          <div style="font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;">${fmt(net)}</div>
          <div style="font-size:6px;">${isDD ? 'Direct Deposit' : 'Check #' + chkNum}</div>
        </div>

        <!-- Pay Waterfall -->
        <div style="border:1px solid #999;padding:3px 4px;font-size:7px;line-height:1.5;margin-bottom:3px;">
          <div style="font-weight:700;text-transform:uppercase;font-size:5.5px;letter-spacing:0.4px;border-bottom:0.5px solid #ccc;padding-bottom:1px;margin-bottom:2px;">Pay Calculation</div>
          <div style="display:flex;justify-content:space-between;"><span>Gross</span><span style="font-weight:700;">${fmt(gross)}</span></div>
          ${preTax > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Pre-Tax</span><span>-${fmt(preTax)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;"><span>Taxes</span><span>-${fmt(totalTaxes)}</span></div>
          ${postTax > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Post-Tax</span><span>-${fmt(postTax)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;border-top:1px solid #000;padding-top:1px;margin-top:1px;font-weight:700;"><span>Net</span><span>${fmt(net)}</span></div>
        </div>

        <!-- YTD (only colored section) -->
        <div style="border:1px solid #999;padding:3px 4px;font-size:7px;line-height:1.5;">
          <div style="font-weight:700;text-transform:uppercase;font-size:5.5px;letter-spacing:0.4px;border-bottom:0.5px solid #ccc;padding-bottom:1px;margin-bottom:2px;">Year-to-Date</div>
          <div style="display:flex;justify-content:space-between;"><span>Gross</span><span style="font-weight:700;">${fmt(ytdG)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Taxes</span><span style="font-weight:700;color:#dc2626;">${fmt(ytdT)}</span></div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid #000;padding-top:1px;margin-top:1px;font-weight:700;"><span>Net</span><span style="color:#16a34a;">${fmt(ytdN)}</span></div>
        </div>
      </div>
    </div>

    ${isEmployer ? `
    <!-- Employer Footer -->
    <div style="display:flex;gap:4px;margin-top:2px;font-size:6.5px;">
      <div style="flex:1;border:0.5px solid #ccc;padding:2px 4px;">
        <strong>EIN:</strong> ${coEIN || '—'} &nbsp;|&nbsp; <strong>Run:</strong> <span style="text-transform:capitalize;">${runType}</span> &nbsp;|&nbsp; <strong>Employer Total:</strong> ${fmt(gross + ss + med)}
      </div>
      ${empEmail ? `<div style="flex:0.6;border:0.5px solid #ccc;padding:2px 4px;"><strong>Employee Email:</strong> ${empEmail}</div>` : ''}
    </div>` : ''}
  </div>`;

  // ═══════════════════════════════════════
  // FULL PAGE
  // ═══════════════════════════════════════
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="page">
  ${checkHTML}
  ${buildStub('Employee Copy — Detach and Retain', false)}
  ${buildStub('Employer Copy — For Records', true)}
</div>
</body></html>`;
}

// ─── Batch helpers ────────────────────────────────────────
export function extractCheckBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match?.[1] || html;
}
export function wrapBatchChecks(bodies: string[]): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${bodies.join('<div style="page-break-before:always;"></div>')}</body></html>`;
}
