/**
 * Payroll Check Print Template — Production Grade
 * Check-on-top (3-part) for 8.5x11 blank check paper.
 * Calibri dominant. All text BLACK except YTD Summary taxes(red)/net(green).
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

const CSS = `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Calibri, 'Segoe UI', -apple-system, Arial, sans-serif; font-size: 10px; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pg { width: 8.5in; height: 11in; position: relative; }

.chk { height: 3.667in; padding: 0.18in 0.42in 0.3in; position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 6px; }
.stb { height: 3.667in; padding: 0.06in 0.3in 0.04in; position: relative; overflow: hidden; }

/* Check face */
.chk-co { font-size: 16px; font-weight: 800; letter-spacing: -0.3px; }
.chk-num { font-size: 22px; font-weight: 800; letter-spacing: 1.5px; line-height: 1; font-variant-numeric: tabular-nums; }

/* MICR line — clean monospace numbers with labeled sections.
   Real MICR encoding is pre-printed with magnetic ink on check stock;
   this line provides the human-readable reference only. */
.micr-bar {
  position: absolute; bottom: 0.15in; left: 0.42in; right: 0.42in;
  display: flex; align-items: baseline; gap: 6px;
  font-family: 'OCR B', 'Courier New', Courier, monospace;
  font-size: 11px; letter-spacing: 2px; color: #000;
  border-top: 0.5px solid #ccc; padding-top: 3px;
}
.micr-bar .micr-seg {
  display: inline-flex; align-items: baseline; gap: 2px;
}
.micr-bar .micr-lbl {
  font-family: Calibri, sans-serif; font-size: 5.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.5px; color: #666;
  margin-right: 2px;
}
.micr-bar .micr-num {
  font-family: 'OCR B', 'Courier New', Courier, monospace;
  font-size: 12px; font-weight: 400; letter-spacing: 2.5px;
  font-variant-numeric: tabular-nums;
}
.micr-bar .micr-spacer { width: 16px; }

/* Stub header */
.stb-hdr { display: flex; justify-content: space-between; align-items: center; background: #000; color: #fff; padding: 2px 6px; margin-bottom: 3px; }
.stb-hdr-label { font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; }
.stb-hdr-co { font-size: 10px; font-weight: 800; }

/* Info grid */
.ig { display: grid; border: 1.5px solid #000; margin-bottom: 4px; }
.ig7 { grid-template-columns: repeat(7, 1fr); }
.ig-c { padding: 2px 4px; border-right: 0.5px solid #bbb; border-bottom: 0.5px solid #bbb; }
.ig-c:nth-child(7n) { border-right: none; }
.ig-c:nth-last-child(-n+7) { border-bottom: none; }
.ig-c.s2 { grid-column: span 2; }
.ig-lbl { font-size: 5.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px; }
.ig-val { font-size: 8px; }
.ig-val.big { font-size: 10px; font-weight: 700; }
.ig-val.b { font-weight: 700; }

/* Tables */
.st { width: 100%; border-collapse: collapse; border: 1px solid #999; }
.st th {
  padding: 2.5px 5px; font-size: 7px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.3px;
  background: #c0c0c0; border-bottom: 1.5px solid #000; text-align: left;
}
.st th.r { text-align: right; }
.st td { padding: 2.5px 5px; font-size: 8.5px; border-bottom: 0.5px solid #ddd; }
.st td.r { text-align: right; font-variant-numeric: tabular-nums; }
.st td.b { font-weight: 700; }
.st tr:nth-child(even) td { background: #f5f5f5; }
.st tr.tot td { border-top: 1.5px solid #000; border-bottom: none; font-weight: 700; background: #e0e0e0; padding-top: 3px; }
.st tr.tot:nth-child(even) td { background: #e0e0e0; }
.st tr.sub td { font-size: 7.5px; padding-left: 12px; border-bottom: 0.5px dashed #ccc; }
.st-section { font-size: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #333; color: #fff; padding: 2px 5px; }

/* Summary boxes */
.net-box { border: 2.5px solid #000; text-align: center; padding: 5px 8px; background: #e8e8e8; margin-bottom: 4px; }
.net-box .lbl { font-size: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.net-box .amt { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 1px 0; }
.net-box .sub { font-size: 6.5px; }
.sum-box { border: 1.5px solid #000; padding: 3px 5px; font-size: 7px; line-height: 1.5; margin-bottom: 3px; }
.sum-box .stitle { font-weight: 700; text-transform: uppercase; font-size: 5.5px; letter-spacing: 0.5px; background: #000; color: #fff; margin: -3px -5px 2px; padding: 1.5px 5px; }
.sr { display: flex; justify-content: space-between; }
.sr-tot { border-top: 1.5px solid #000; padding-top: 2px; margin-top: 2px; font-weight: 700; }

.void-wm { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:56px; font-weight:900; color:rgba(200,0,0,0.12); letter-spacing:10px; pointer-events:none; z-index:10; }
.emp-ft { display:flex; gap:4px; margin-top:3px; font-size:7px; }
.emp-ft-c { flex:1; border:1px solid #999; padding:2px 5px; background:#f0f0f0; }

@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
`;

export function generatePaycheckHTML(
  stub: any, employee: any, company: any, run: any,
  options?: { isVoid?: boolean; checkNumber?: string; memo?: string }
): string {
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
  const coSignature = company?.signature_image || '';

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

  const payDate = fmtLong(run?.pay_date || stub?.pay_date || '');
  const payDateS = fmtShort(run?.pay_date || stub?.pay_date || '');
  const pStart = fmtShort(run?.pay_period_start || stub?.period_start || '');
  const pEnd = fmtShort(run?.pay_period_end || stub?.period_end || '');
  const runType = esc(run?.run_type || stub?.run_type || 'regular');
  const paySchedule = esc(employee?.pay_schedule || run?.pay_schedule || stub?.pay_schedule || '');
  const isDD = !!(employee?.routing_number);
  const payType = esc(employee?.pay_type || (stub?.hours_regular > 0 ? 'hourly' : 'salary'));
  const payRate = employee?.pay_rate || 0;

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
  const chk = esc(options?.checkNumber || stub?.check_number || stub?.id?.substring(0, 6).toUpperCase() || '000001');
  const ytdG = stub?.ytd_gross || 0;
  const ytdT = stub?.ytd_taxes || 0;
  const ytdN = stub?.ytd_net || 0;
  const ytdFed = stub?.ytd_federal_tax || 0;
  const ytdSt = stub?.ytd_state_tax || 0;
  const ytdSS = stub?.ytd_social_security || 0;
  const ytdMed = stub?.ytd_medicare || 0;

  const effRate = hrsTot > 0 ? gross / (hrsReg + hrsOT * 1.5) : payRate;
  const regPay = hrsTot > 0 ? effRate * hrsReg : gross;
  const otPay = hrsTot > 0 ? effRate * 1.5 * hrsOT : 0;
  const taxableWages = gross - preTax;
  const fedPct = taxableWages > 0 ? ((fedTax / taxableWages) * 100).toFixed(1) : '0.0';
  const stPct = taxableWages > 0 ? ((stTax / taxableWages) * 100).toFixed(1) : '0.0';
  const totPct = gross > 0 ? ((totalDed / gross) * 100).toFixed(1) : '0.0';
  const employerFICA = ss + med;
  const employerTotal = gross + employerFICA;
  // YTD hours estimate (for hourly: ytdGross / effective rate; salaried: n/a)
  const ytdHours = hrsTot > 0 && effRate > 0 ? Math.round((ytdG / effRate) * 100) / 100 : 0;
  const isVoid = options?.isVoid || false;
  const memo = esc(options?.memo || `Payroll ${pStart} — ${pEnd}`);
  let dedItems: [string, number][] = [];
  if (stub?.deduction_detail && stub.deduction_detail !== '{}') {
    try { dedItems = Object.entries(JSON.parse(stub.deduction_detail)).map(([k, v]) => [k, Number(v)]); } catch {}
  }
  const voidWM = isVoid ? '<div class="void-wm">VOID</div>' : '';
  const ddBanner = isDD ? `<div style="position:absolute;top:0.14in;left:50%;transform:translateX(-50%);font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">*** NON-NEGOTIABLE — DIRECT DEPOSIT ***</div>` : '';

  // ── Info grid (shared) ──
  const infoGrid = `
    <div class="ig ig7">
      <div class="ig-c s2"><div class="ig-lbl">Employee</div><div class="ig-val big">${empName}</div></div>
      <div class="ig-c"><div class="ig-lbl">SSN</div><div class="ig-val">${empSSN || '—'}</div></div>
      <div class="ig-c"><div class="ig-lbl">Emp. ID</div><div class="ig-val">${empId || '—'}</div></div>
      <div class="ig-c"><div class="ig-lbl">Pay Date</div><div class="ig-val b">${payDateS}</div></div>
      <div class="ig-c"><div class="ig-lbl">Period</div><div class="ig-val">${pStart} — ${pEnd}</div></div>
      <div class="ig-c"><div class="ig-lbl">Check #</div><div class="ig-val b">${chk}</div></div>
      <div class="ig-c"><div class="ig-lbl">Department</div><div class="ig-val">${empDept || '—'}</div></div>
      <div class="ig-c"><div class="ig-lbl">Hire Date</div><div class="ig-val">${empHireDate || '—'}</div></div>
      <div class="ig-c"><div class="ig-lbl">Filing / Allow.</div><div class="ig-val" style="text-transform:capitalize;">${empFiling || '—'} / ${empAllowances !== '' ? empAllowances : '—'}</div></div>
      <div class="ig-c"><div class="ig-lbl">State / Allow.</div><div class="ig-val">${empStateCode || '—'} / ${empStateAllow !== '' ? empStateAllow : '—'}</div></div>
      <div class="ig-c"><div class="ig-lbl">Pay Type / Rate</div><div class="ig-val" style="text-transform:capitalize;">${payType}${payRate > 0 ? ' @ ' + fmt(payRate) : ''}</div></div>
      <div class="ig-c"><div class="ig-lbl">Schedule</div><div class="ig-val" style="text-transform:capitalize;">${paySchedule || '—'}</div></div>
      <div class="ig-c"><div class="ig-lbl">Method / Type</div><div class="ig-val" style="text-transform:capitalize;">${isDD ? 'Direct Dep.' : 'Check'} / ${runType}</div></div>
    </div>`;

  // ── Earnings table (shared) ──
  const earningsTable = `
    <table class="st">
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
    <table class="st" style="margin-top:3px;">
      <thead><tr><th colspan="2">Pre-Tax Deductions</th><th class="r">Current</th></tr></thead>
      <tbody>
        ${dedItems.filter(([, a]) => a > 0).map(([n, a]) => `<tr class="sub"><td colspan="2">${esc(n)}</td><td class="r">${fmt(a)}</td></tr>`).join('')}
        ${dedItems.length === 0 ? `<tr><td colspan="2">Pre-Tax</td><td class="r">${fmt(preTax)}</td></tr>` : ''}
        <tr class="tot"><td colspan="2">Taxable Wages</td><td class="r">${fmt(taxableWages)}</td></tr>
      </tbody>
    </table>` : ''}`;

  // ── Taxes table (shared) ──
  const taxesTable = `
    <table class="st">
      <thead><tr><th>Taxes</th><th class="r">Rate</th><th class="r">Current</th><th class="r">YTD</th></tr></thead>
      <tbody>
        <tr><td>Federal Income</td><td class="r">${fedPct}%</td><td class="r">${fmt(fedTax)}</td><td class="r">${ytdFed > 0 ? fmt(ytdFed) : '—'}</td></tr>
        <tr><td>State${empStateCode ? ' (' + empStateCode + ')' : ''}</td><td class="r">${stPct}%</td><td class="r">${fmt(stTax)}</td><td class="r">${ytdSt > 0 ? fmt(ytdSt) : '—'}</td></tr>
        <tr><td>Social Security</td><td class="r">6.20%</td><td class="r">${fmt(ss)}</td><td class="r">${ytdSS > 0 ? fmt(ytdSS) : '—'}</td></tr>
        <tr><td>Medicare</td><td class="r">1.45%</td><td class="r">${fmt(med)}</td><td class="r">${ytdMed > 0 ? fmt(ytdMed) : '—'}</td></tr>
        <tr class="tot"><td>Total Taxes</td><td class="r">${totPct}%</td><td class="r">${fmt(totalTaxes)}</td><td class="r">${ytdT > 0 ? fmt(ytdT) : '—'}</td></tr>
      </tbody>
    </table>
    ${postTax > 0 ? `
    <table class="st" style="margin-top:3px;">
      <thead><tr><th>Post-Tax Deductions</th><th class="r">Current</th></tr></thead>
      <tbody><tr><td>Post-Tax</td><td class="r">${fmt(postTax)}</td></tr></tbody>
    </table>` : ''}`;

  // ── Summary column (shared) ──
  const summaryCol = `
    <div class="net-box">
      <div class="lbl">Net Pay</div>
      <div class="amt">${fmt(net)}</div>
      <div class="sub">${isDD ? 'Direct Deposit' : 'Check #' + chk}</div>
    </div>
    <div class="sum-box">
      <div class="stitle">Pay Calculation</div>
      <div class="sr"><span>Gross</span><span style="font-weight:700;">${fmt(gross)}</span></div>
      ${preTax > 0 ? `<div class="sr"><span>Pre-Tax</span><span>-${fmt(preTax)}</span></div>` : ''}
      <div class="sr"><span>Taxes</span><span>-${fmt(totalTaxes)}</span></div>
      ${postTax > 0 ? `<div class="sr"><span>Post-Tax</span><span>-${fmt(postTax)}</span></div>` : ''}
      <div class="sr sr-tot"><span>Net</span><span>${fmt(net)}</span></div>
    </div>
    <div class="sum-box">
      <div class="stitle">Year-to-Date</div>
      ${ytdHours > 0 ? `<div class="sr"><span>Hours</span><span style="font-weight:700;">${ytdHours.toFixed(1)}</span></div>` : ''}
      <div class="sr"><span>Gross</span><span style="font-weight:700;">${fmt(ytdG)}</span></div>
      <div class="sr"><span>Taxes</span><span style="font-weight:700;color:#dc2626;">${fmt(ytdT)}</span></div>
      <div class="sr sr-tot"><span>Net</span><span style="color:#16a34a;">${fmt(ytdN)}</span></div>
    </div>`;

  // ══════════════════════════════════════════════════
  // CHECK FACE
  // ══════════════════════════════════════════════════
  const checkHTML = `
  <div class="chk">
    ${voidWM}${ddBanner}
    <div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="chk-co">${co}</div>
          ${coLegal && coLegal !== co ? `<div style="font-size:7.5px;">${coLegal}</div>` : ''}
          <div style="font-size:7.5px;line-height:1.4;margin-top:2px;">
            ${coAddr1 ? coAddr1 : ''}${coAddr2 ? '<br>' + coAddr2 : ''}${coCSZ ? '<br>' + coCSZ : ''}
            ${coPhone ? '<br>' + coPhone : ''}${coEmail ? ' &middot; ' + coEmail : ''}
            ${coEIN ? '<br>EIN: ' + coEIN : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Check No.</div>
          <div class="chk-num">${chk}</div>
          ${coFraction ? `<div style="font-size:7.5px;margin-top:1px;">${coFraction}</div>` : ''}
          <div style="border:1.5px solid #000;padding:3px 10px;text-align:center;margin-top:6px;">
            <div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Date</div>
            <div style="font-size:10px;font-weight:700;">${payDate}</div>
          </div>
          ${coBank ? `<div style="font-size:7.5px;margin-top:3px;font-weight:600;">${coBank}</div>` : ''}
        </div>
      </div>
    </div>
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px;">Pay to the Order of</div>
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:3px;margin-bottom:5px;">
        <div>
          <div style="font-size:14px;font-weight:700;">${empName}</div>
          <div style="font-size:8.5px;margin-top:1px;">${[empAddr1, empAddr2, empCSZ].filter(Boolean).join(', ')}</div>
        </div>
        <div style="border:2.5px solid #000;padding:4px 16px;text-align:center;background:#f5f5f5;">
          <div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Amount</div>
          <div style="font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;">${fmt(net)}</div>
        </div>
      </div>
      <div style="font-size:10px;border-bottom:1.5px solid #000;padding-bottom:3px;">${amountToWords(net)} <span style="letter-spacing:2px;color:#999;">********</span></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div style="font-size:8.5px;">
        ${coBank ? `<div style="font-weight:700;margin-bottom:2px;">${coBank}</div>` : ''}
        <div><strong>Memo:</strong> ${memo}</div>
      </div>
      <div style="text-align:center;width:220px;">
        ${coSignature
          ? `<img src="${coSignature}" style="height:36px;max-width:200px;object-fit:contain;display:block;margin:0 auto 2px;" />`
          : `<div style="height:36px;"></div>`
        }
        <div style="border-top:1.5px solid #000;padding-top:3px;">
          <span style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Authorized Signature</span>
        </div>
      </div>
    </div>
    <!-- MICR — labeled segments, clean monospace -->
    <div class="micr-bar">
      <div class="micr-seg"><span class="micr-lbl">CHK</span><span class="micr-num">${chk}</span></div>
      <div class="micr-spacer"></div>
      <div class="micr-seg"><span class="micr-lbl">RTN</span><span class="micr-num">${coRouting || '000000000'}</span></div>
      <div class="micr-spacer"></div>
      <div class="micr-seg"><span class="micr-lbl">ACCT</span><span class="micr-num">${coAcct || '0000000000'}</span></div>
    </div>
  </div>`;

  // ══════════════════════════════════════════════════
  // EMPLOYEE STUB
  // ══════════════════════════════════════════════════
  const employeeStub = `
  <div class="stb">
    ${voidWM}
    <div class="stb-hdr"><div class="stb-hdr-label">Employee Copy — Detach and Retain</div><div class="stb-hdr-co">${co}</div></div>
    ${infoGrid}
    <div style="display:flex;gap:5px;">
      <div style="flex:1.3;">${earningsTable}</div>
      <div style="flex:1.1;">${taxesTable}</div>
      <div style="width:125px;">${summaryCol}</div>
    </div>
  </div>`;

  // ══════════════════════════════════════════════════
  // EMPLOYER STUB (enhanced detail)
  // ══════════════════════════════════════════════════
  const employerStub = `
  <div class="stb">
    ${voidWM}
    <div class="stb-hdr"><div class="stb-hdr-label">Employer Copy — For Records</div><div class="stb-hdr-co">${co}</div></div>
    ${infoGrid}
    <div style="display:flex;gap:5px;">
      <div style="flex:1.3;">${earningsTable}</div>
      <div style="flex:1.1;">
        ${taxesTable}
        <!-- Employer-only: contributions + cost -->
        <table class="st" style="margin-top:3px;">
          <thead><tr><th colspan="2">Employer Contributions</th><th class="r">Current</th></tr></thead>
          <tbody>
            <tr><td colspan="2">FICA Match — SS (6.2%)</td><td class="r">${fmt(ss)}</td></tr>
            <tr><td colspan="2">FICA Match — Medicare (1.45%)</td><td class="r">${fmt(med)}</td></tr>
            <tr class="tot"><td colspan="2">Total FICA Match</td><td class="r">${fmt(employerFICA)}</td></tr>
          </tbody>
        </table>
      </div>
      <div style="width:125px;">
        ${summaryCol}
      </div>
    </div>
    <!-- Employer footer: compact single row with cost + metadata -->
    <div style="display:flex;gap:3px;margin-top:2px;font-size:6.5px;">
      <div style="flex:1;border:1px solid #999;padding:1.5px 4px;background:#e8e8e8;">
        <strong>Employer Cost:</strong> Gross ${fmt(gross)} + FICA ${fmt(employerFICA)} = <strong>${fmt(employerTotal)}</strong>
      </div>
      <div style="flex:0.5;border:1px solid #999;padding:1.5px 4px;background:#f0f0f0;">
        <strong>EIN:</strong> ${coEIN || '—'} &nbsp;|&nbsp; <strong>Run:</strong> <span style="text-transform:capitalize;">${runType}</span>
      </div>
      ${empEmail ? `<div style="flex:0.4;border:1px solid #999;padding:1.5px 4px;background:#f0f0f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${empEmail}</div>` : ''}
    </div>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="pg">
  ${checkHTML}
  ${employeeStub}
  ${employerStub}
</div>
</body></html>`;
}

export function extractCheckBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match?.[1] || html;
}
export function wrapBatchChecks(bodies: string[]): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${bodies.join('<div style="page-break-before:always;"></div>')}</body></html>`;
}
