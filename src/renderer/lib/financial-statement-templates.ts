// Classic PDF generators for financial statements (Trial Balance + General Ledger +
// Balance Sheet + Cash Flow Statement).
// These produce Arial/B&W ruled-table output via the classic-styles helpers.
// All HTML is safe: user-supplied text is passed through esc().

import {
  esc,
  classicDocument,
  docFrame,
  docHeader,
  metaStrip,
  ruledTable,
  footerBar,
} from './classic-styles';
import type { Company } from '../../shared/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  // Format as accounting value — negative shown with parentheses.
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

function coDetailHtml(company: Company): string {
  const parts: string[] = [];
  const addr = [company.address_line1, company.address_line2].filter(Boolean).join(', ');
  if (addr) parts.push(esc(addr));
  const csz = [company.city, company.state, company.zip].filter(Boolean).join(', ');
  if (csz) parts.push(esc(csz));
  if (company.phone) parts.push(esc(company.phone));
  if (company.email) parts.push(esc(company.email));
  return parts.join('<br>');
}

function generated(): string {
  return `Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

// ─── Trial Balance ───────────────────────────────────────────────────────────

export interface TBLine {
  account_code: string;
  account_name: string;
  account_type: string;
  debit_total: number;
  credit_total: number;
  balance: number;
  normal_side: 'debit' | 'credit';
  is_active: number;
}

export interface TBOpts {
  startDate: string;
  endDate: string;
  /** If provided, shown in the meta strip */
  view?: string;
  balanced?: boolean;
  totalDebits?: number;
  totalCredits?: number;
}

/**
 * Generates a classic-style Trial Balance HTML document.
 *
 * @param rows     The visible (filtered) trial balance lines from the screen.
 * @param company  The active company (for header).
 * @param opts     Date range + summary numbers already computed by the screen.
 */
export function generateTrialBalanceHTML(
  rows: TBLine[],
  company: Company,
  opts: TBOpts,
): string {
  const period = `${opts.startDate} to ${opts.endDate}`;

  const header = docHeader({
    coName: company.name || 'Company',
    coDetailHtml: coDetailHtml(company),
    title: 'Trial Balance',
    number: period,
  });

  const meta = metaStrip([
    { label: 'Period', value: period },
    { label: 'As of', value: opts.endDate },
    { label: 'Status', value: opts.balanced === true ? 'Balanced' : opts.balanced === false ? 'OUT OF BALANCE' : '' },
    { label: 'Generated', value: generated() },
  ]);

  // Build table rows — debit balance in Debit col, credit balance in Credit col.
  const tableRows: string[][] = rows.map((l) => {
    const isDebitBal = l.normal_side === 'debit';
    const drAmt = isDebitBal && l.balance > 0 ? fmt(l.balance)
                : !isDebitBal && l.balance < 0 ? fmt(Math.abs(l.balance))
                : '';
    const crAmt = !isDebitBal && l.balance > 0 ? fmt(l.balance)
                : isDebitBal && l.balance < 0 ? fmt(Math.abs(l.balance))
                : '';
    return [
      esc(l.account_code),
      esc(l.account_name) + (!l.is_active ? ' <em style="font-size:9px;color:#666;">(inactive)</em>' : ''),
      esc(l.account_type.charAt(0).toUpperCase() + l.account_type.slice(1)),
      drAmt || '<span style="color:#aaa;">—</span>',
      crAmt || '<span style="color:#aaa;">—</span>',
    ];
  });

  // Totals row (using raw debit_total / credit_total sums — same as screen's totalDebits/totalCredits).
  const sumDr = opts.totalDebits !== undefined
    ? opts.totalDebits
    : rows.reduce((s, l) => s + l.debit_total, 0);
  const sumCr = opts.totalCredits !== undefined
    ? opts.totalCredits
    : rows.reduce((s, l) => s + l.credit_total, 0);

  // Totals as a final row with bold text (we embed it manually since ruledTable has no colspan):
  tableRows.push([
    '<strong>TOTAL</strong>',
    '',
    '',
    `<strong>${fmt(sumDr)}</strong>`,
    `<strong>${fmt(sumCr)}</strong>`,
  ]);

  const table = ruledTable(
    [
      { label: 'Code', width: '90px' },
      { label: 'Account Name' },
      { label: 'Type', width: '90px' },
      { label: 'Debit', align: 'right', width: '120px' },
      { label: 'Credit', align: 'right', width: '120px' },
    ],
    tableRows,
  );

  const body = docFrame(
    header +
    meta +
    `<div style="padding:0;">${table}</div>` +
    footerBar(`${company.name} · Trial Balance · ${period} · ${rows.length} accounts`),
  );

  return classicDocument({ title: `Trial Balance ${period}`, bodyHtml: body });
}

// ─── General Ledger ──────────────────────────────────────────────────────────

export interface GLTxn {
  line_id: string;
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  running_balance?: number;
}

export interface GLAcct {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  transactions: GLTxn[];
  opening_balance: number;
  closing_balance: number;
}

export interface GLOpts {
  startDate: string;
  endDate: string;
}

/**
 * Generates a classic-style General Ledger HTML document.
 *
 * @param accounts  The filteredAccounts array from the screen (already has running_balance per txn).
 * @param company   The active company (for header).
 * @param opts      Date range.
 */
export function generateGeneralLedgerHTML(
  accounts: GLAcct[],
  company: Company,
  opts: GLOpts,
): string {
  const period = `${opts.startDate} to ${opts.endDate}`;

  const header = docHeader({
    coName: company.name || 'Company',
    coDetailHtml: coDetailHtml(company),
    title: 'General Ledger',
    number: period,
  });

  const meta = metaStrip([
    { label: 'Period', value: period },
    { label: 'Accounts', value: String(accounts.length) },
    { label: 'Transactions', value: String(accounts.reduce((s, a) => s + a.transactions.length, 0)) },
    { label: 'Generated', value: generated() },
  ]);

  // Build one section per account
  const sections: string[] = [];
  for (const acct of accounts) {
    // Account section header row (full-width black bar, 7 columns)
    const acctHeaderRow = `<tr><td colspan="7" style="background:#000;color:#fff;font-weight:bold;padding:7px 8px;font-size:11px;letter-spacing:0.3px;">${esc(acct.account_code)} — ${esc(acct.account_name)} <span style="font-weight:normal;font-size:10px;">(${esc(acct.account_type.charAt(0).toUpperCase() + acct.account_type.slice(1))})</span></td></tr>`;

    // Build 7-column transaction rows: Date / Entry # / Description / Reference / Debit / Credit / Balance
    const txnRows7 = acct.transactions.map((t) => {
      const drCell = t.debit > 0 ? esc(fmt(t.debit)) : '<span style="color:#aaa;">—</span>';
      const crCell = t.credit > 0 ? esc(fmt(t.credit)) : '<span style="color:#aaa;">—</span>';
      const bal = t.running_balance !== undefined ? t.running_balance : 0;
      const balFmt = esc(fmt(bal)) + (bal < 0 ? ' <em style="font-size:9px;">Cr</em>' : bal > 0 ? ' <em style="font-size:9px;">Dr</em>' : '');
      return `<tr>` +
        `<td style="border:1px solid #000;padding:5px 8px;font-size:10px;white-space:nowrap;">${esc(t.date)}</td>` +
        `<td style="border:1px solid #000;padding:5px 8px;font-size:10px;">${esc(t.entry_number)}</td>` +
        `<td style="border:1px solid #000;padding:5px 8px;font-size:10px;">${esc(t.description || '—')}</td>` +
        `<td style="border:1px solid #000;padding:5px 8px;font-size:10px;color:#555;">${esc(t.reference || '—')}</td>` +
        `<td style="border:1px solid #000;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;font-size:10px;">${drCell}</td>` +
        `<td style="border:1px solid #000;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;font-size:10px;">${crCell}</td>` +
        `<td style="border:1px solid #000;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;font-size:10px;">${balFmt}</td>` +
        `</tr>`;
    });

    // Closing balance row
    const closingRow = `<tr style="background:#f0f0f0;font-weight:bold;"><td colspan="6" style="border:1px solid #000;padding:5px 8px;font-size:10px;font-style:italic;text-align:right;">Balance carried forward</td><td style="border:1px solid #000;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;font-size:10px;">${esc(fmt(acct.closing_balance))} ${acct.closing_balance < 0 ? '<em style="font-size:9px;">Cr</em>' : '<em style="font-size:9px;">Dr</em>'}</td></tr>`;

    const theadCols = ['Date', 'Entry #', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'];
    const thead = `<thead><tr>${theadCols.map((c, i) => {
      const right = i >= 4 ? ' style="text-align:right;"' : '';
      return `<th style="background:#000;color:#fff;border:1px solid #000;padding:7px 8px;text-align:left;letter-spacing:0.5px;text-transform:uppercase;font-size:10px;"${right}>${esc(c)}</th>`;
    }).join('')}</tr></thead>`;

    const openRow7 = `<tr style="background:#f5f5f5;"><td colspan="6" style="border:1px solid #000;padding:5px 8px;font-size:10px;font-style:italic;color:#444;">Balance brought forward</td><td style="border:1px solid #000;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;font-size:10px;">${esc(fmt(acct.opening_balance))} ${acct.opening_balance < 0 ? '<em style="font-size:9px;">Cr</em>' : '<em style="font-size:9px;">Dr</em>'}</td></tr>`;

    const sectionTable = `<table class="ruled" style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:0;">${thead}<tbody>${acctHeaderRow}${openRow7}${txnRows7.join('')}${closingRow}</tbody></table>`;

    sections.push(`<div style="margin-bottom:16px;">${sectionTable}</div>`);
  }

  const body = docFrame(
    header +
    meta +
    `<div style="padding:0;">${sections.join('')}</div>` +
    footerBar(`${company.name} · General Ledger · ${period}`),
  );

  return classicDocument({ title: `General Ledger ${period}`, bodyHtml: body });
}

// ─── Balance Sheet ───────────────────────────────────────────────────────────

export interface BSAccountLine {
  account_name: string;
  account_code: string;
  subtype: string;
  balance: number;
}

export interface BSData {
  currentAssets: BSAccountLine[];
  fixedAssets: BSAccountLine[];
  otherAssets: BSAccountLine[];
  currentLiabilities: BSAccountLine[];
  longTermLiabilities: BSAccountLine[];
  equity: BSAccountLine[];
}

export interface BSOpts {
  asOfDate: string;
  isBalanced: boolean;
  totalCurrentAssets: number;
  totalFixedAssets: number;
  totalOtherAssets: number;
  totalAssets: number;
  totalCurrentLiabilities: number;
  totalLongTermLiabilities: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
}

/**
 * Generates a classic-style Balance Sheet HTML document.
 *
 * @param data     The BSData sections already loaded by the screen.
 * @param company  The active company (for header).
 * @param opts     As-of date + all computed totals from the screen's useMemo hooks.
 */
export function generateBalanceSheetHTML(
  data: BSData,
  company: Company,
  opts: BSOpts,
): string {
  const title = 'Balance Sheet';
  const asOf = `As of ${opts.asOfDate}`;

  const header = docHeader({
    coName: company.name || 'Company',
    coDetailHtml: coDetailHtml(company),
    title,
    number: asOf,
  });

  const meta = metaStrip([
    { label: 'As of', value: opts.asOfDate },
    { label: 'Status', value: opts.isBalanced ? 'Balanced' : 'OUT OF BALANCE' },
    { label: 'Total Assets', value: `$${fmt(opts.totalAssets)}` },
    { label: 'Generated', value: generated() },
  ]);

  // Helper: render a group of lines as <tr> rows inside an outer <tbody>
  const lineRows = (items: BSAccountLine[]): string =>
    items.map(a =>
      `<tr><td style="padding-left:32px;">${esc(a.account_name)}</td>` +
      `<td class="num">$${fmt(a.balance)}</td></tr>`
    ).join('');

  const sectionBar = (label: string): string =>
    `<tr><td colspan="2" style="background:#000;color:#fff;font-weight:bold;` +
    `letter-spacing:1px;padding:7px 8px;font-size:11px;">${esc(label)}</td></tr>`;

  const subBar = (label: string): string =>
    `<tr><td colspan="2" style="font-weight:bold;font-size:10px;letter-spacing:0.5px;` +
    `text-transform:uppercase;padding:6px 8px 3px 20px;color:#444;">${esc(label)}</td></tr>`;

  const subtotalRow = (label: string, amount: number, strong = false): string =>
    `<tr style="${strong ? 'border-top:2px solid #000;' : 'border-top:1px solid #000;'}">` +
    `<td style="padding-left:16px;${strong ? 'font-weight:bold;' : ''}">${esc(label)}</td>` +
    `<td class="num" style="${strong ? 'font-weight:bold;' : ''}">$${fmt(amount)}</td></tr>`;

  const spacerRow = (): string =>
    `<tr><td colspan="2" style="padding:4px 0;"></td></tr>`;

  // Build tbody rows
  let rows = '';

  // ASSETS section
  rows += sectionBar('ASSETS');

  if (data.currentAssets.length > 0) {
    rows += subBar('Current Assets');
    rows += lineRows(data.currentAssets);
    rows += subtotalRow('Total Current Assets', opts.totalCurrentAssets);
  }

  if (data.fixedAssets.length > 0) {
    rows += subBar('Fixed Assets');
    rows += lineRows(data.fixedAssets);
    rows += subtotalRow('Total Fixed Assets', opts.totalFixedAssets);
  }

  if (data.otherAssets.length > 0) {
    rows += subBar('Other Assets');
    rows += lineRows(data.otherAssets);
    rows += subtotalRow('Total Other Assets', opts.totalOtherAssets);
  }

  rows += `<tr style="border-top:2px solid #000;background:#f0f0f0;">` +
    `<td style="font-weight:bold;padding-left:8px;">TOTAL ASSETS</td>` +
    `<td class="num" style="font-weight:bold;">$${fmt(opts.totalAssets)}</td></tr>`;

  rows += spacerRow();

  // LIABILITIES section
  rows += sectionBar('LIABILITIES');

  if (data.currentLiabilities.length > 0) {
    rows += subBar('Current Liabilities');
    rows += lineRows(data.currentLiabilities);
    rows += subtotalRow('Total Current Liabilities', opts.totalCurrentLiabilities);
  }

  if (data.longTermLiabilities.length > 0) {
    rows += subBar('Long-Term Liabilities');
    rows += lineRows(data.longTermLiabilities);
    rows += subtotalRow('Total Long-Term Liabilities', opts.totalLongTermLiabilities);
  }

  rows += `<tr style="border-top:2px solid #000;background:#f0f0f0;">` +
    `<td style="font-weight:bold;padding-left:8px;">TOTAL LIABILITIES</td>` +
    `<td class="num" style="font-weight:bold;">$${fmt(opts.totalLiabilities)}</td></tr>`;

  rows += spacerRow();

  // EQUITY section
  rows += sectionBar('EQUITY');
  rows += lineRows(data.equity);
  rows += subtotalRow('Total Equity', opts.totalEquity);

  rows += spacerRow();

  // Grand total
  rows += `<tr style="border-top:2px solid #000;background:#000;color:#fff;">` +
    `<td style="font-weight:bold;padding:9px 8px;letter-spacing:0.5px;">TOTAL LIABILITIES &amp; EQUITY</td>` +
    `<td class="num" style="font-weight:bold;padding:9px 8px;">$${fmt(opts.totalLiabilitiesAndEquity)}</td></tr>`;

  // Balance check note
  const balanceNote = opts.isBalanced
    ? `<tr style="background:#e8f5e9;"><td colspan="2" style="text-align:center;padding:5px 8px;font-size:10px;font-style:italic;">` +
      `Assets = Liabilities + Equity — Balanced</td></tr>`
    : `<tr style="background:#fdecea;"><td colspan="2" style="text-align:center;padding:5px 8px;font-size:10px;font-style:italic;font-weight:bold;">` +
      `WARNING: Out of Balance by $${fmt(Math.abs(opts.totalAssets - opts.totalLiabilitiesAndEquity))}</td></tr>`;

  rows += balanceNote;

  const table =
    `<table class="ruled" style="width:100%;border-collapse:collapse;">` +
    `<thead><tr>` +
    `<th style="width:70%;">Account</th>` +
    `<th style="text-align:right;">Amount</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody></table>`;

  const body = docFrame(
    header +
    meta +
    `<div style="padding:0;">${table}</div>` +
    footerBar(`${company.name} · Balance Sheet · ${asOf}`),
  );

  return classicDocument({ title: `Balance Sheet ${opts.asOfDate}`, bodyHtml: body });
}

// ─── Expenses by Category ────────────────────────────────────────────────────

export interface EBCRow {
  category: string;
  amount: number;
}

export interface EBCPriorRow {
  category: string;
  amount: number;
}

export interface EBCOpts {
  startDate: string;
  endDate: string;
  totalExpenses: number;
  /** When true, the prior-month columns are included in the PDF. */
  showMoM?: boolean;
  priorMonthData?: EBCPriorRow[];
  /** Vendor rows (top 10 by spend). */
  vendors?: { vendor_name: string; total_spend: number; transaction_count: number }[];
}

/**
 * Generates a classic-style Expenses by Category HTML document.
 *
 * @param rows    The category rows as displayed on screen (ordered by amount desc).
 * @param company The active company (for header).
 * @param opts    Date range, totals, and optional MoM / vendor data already loaded.
 */
export function generateExpenseByCategoryHTML(
  rows: EBCRow[],
  company: Company,
  opts: EBCOpts,
): string {
  const period = `${opts.startDate} to ${opts.endDate}`;

  const header = docHeader({
    coName: company.name || 'Company',
    coDetailHtml: coDetailHtml(company),
    title: 'Expenses by Category',
    number: period,
  });

  // KPI summary strip
  const categoriesUsed = rows.length;
  const avgPerCategory = categoriesUsed > 0 ? opts.totalExpenses / categoriesUsed : 0;
  const largest = rows.length > 0 ? rows[0] : null;

  const meta = metaStrip([
    { label: 'Period', value: period },
    { label: 'Total Expenses', value: `$${fmt(opts.totalExpenses)}` },
    { label: 'Categories', value: String(categoriesUsed) },
    { label: 'Generated', value: generated() },
  ]);

  // ── Main category table ──
  // Build prior-month lookup
  const priorMap = new Map<string, number>();
  if (opts.showMoM && opts.priorMonthData) {
    for (const p of opts.priorMonthData) priorMap.set(p.category, p.amount);
  }

  const columns: import('./classic-styles').RuledColumn[] = [
    { label: 'Category' },
    { label: 'Amount', align: 'right', width: '130px' },
    { label: '% of Total', align: 'right', width: '90px' },
    ...(opts.showMoM
      ? ([
          { label: 'Prior Month', align: 'right', width: '130px' },
          { label: 'Change %', align: 'right', width: '90px' },
        ] as import('./classic-styles').RuledColumn[])
      : []),
  ];

  const tableRows: string[][] = rows.map((cat) => {
    const pct = opts.totalExpenses > 0 ? (cat.amount / opts.totalExpenses) * 100 : 0;
    const row: string[] = [
      esc(cat.category),
      `$${fmt(cat.amount)}`,
      `${pct.toFixed(1)}%`,
    ];
    if (opts.showMoM) {
      const priorAmt = priorMap.get(cat.category) || 0;
      const changeP = priorAmt > 0 ? ((cat.amount - priorAmt) / priorAmt) * 100 : 0;
      row.push(`$${fmt(priorAmt)}`);
      row.push(priorAmt > 0 ? `${changeP > 0 ? '+' : ''}${changeP.toFixed(1)}%` : '—');
    }
    return row;
  });

  // Grand-total row (bold)
  const totalRow: string[] = [
    '<strong>TOTAL</strong>',
    `<strong>$${fmt(opts.totalExpenses)}</strong>`,
    '<strong>100.0%</strong>',
  ];
  if (opts.showMoM) {
    const priorTotal = opts.priorMonthData
      ? opts.priorMonthData.reduce((s, p) => s + p.amount, 0)
      : 0;
    totalRow.push(`<strong>$${fmt(priorTotal)}</strong>`);
    totalRow.push('');
  }
  tableRows.push(totalRow);

  const categoryTable = ruledTable(columns, tableRows);

  // ── KPI summary box ──
  const kpiHtml = (
    `<div style="display:flex;gap:0;border:1px solid #000;margin-bottom:12px;">` +
    [
      { label: 'Total Expenses', value: `$${fmt(opts.totalExpenses)}` },
      { label: 'Categories Used', value: String(categoriesUsed) },
      { label: 'Avg Per Category', value: `$${fmt(avgPerCategory)}` },
      { label: 'Largest Category', value: largest ? `${esc(largest.category)} ($${fmt(largest.amount)})` : '—' },
    ].map(k =>
      `<div style="flex:1;padding:10px 12px;border-right:1px solid #000;text-align:center;font-size:11px;">` +
      `<div style="font-size:13px;font-weight:bold;font-variant-numeric:tabular-nums;">${k.value}</div>` +
      `<div style="font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;margin-top:4px;color:#555;">${esc(k.label)}</div>` +
      `</div>`
    ).join('') +
    `</div>`
  ).replace(/border-right:1px solid #000;<\/div><\/div>$/, `border-right:none;</div></div>`);

  // ── Vendor spend table (if provided) ──
  let vendorSection = '';
  if (opts.vendors && opts.vendors.length > 0) {
    const vRows: string[][] = opts.vendors.slice(0, 10).map(v => [
      esc(v.vendor_name),
      `$${fmt(v.total_spend)}`,
      String(v.transaction_count),
    ]);
    const vendorTable = ruledTable(
      [
        { label: 'Vendor' },
        { label: 'Total Spend', align: 'right', width: '130px' },
        { label: 'Transactions', align: 'right', width: '90px' },
      ],
      vRows,
    );
    vendorSection =
      `<div style="margin-top:16px;">` +
      `<div style="font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;` +
      `padding:7px 8px;border:1px solid #000;border-bottom:none;background:#000;color:#fff;">` +
      `Top Vendors by Spend</div>` +
      vendorTable +
      `</div>`;
  }

  const body = docFrame(
    header +
    meta +
    `<div style="padding:12px 16px;">` +
    kpiHtml +
    categoryTable +
    vendorSection +
    `</div>` +
    footerBar(`${company.name} · Expenses by Category · ${period} · ${categoriesUsed} categories`),
  );

  return classicDocument({ title: `Expenses by Category ${period}`, bodyHtml: body });
}

// ─── Cash Flow Statement ─────────────────────────────────────────────────────

export interface CFData {
  operatingInflows: number;
  operatingOutflows: number;
  investingOutflows: number;
  financingEquityIn: number;
  financingDraws: number;
  beginningCash: number;
}

export interface CFIndirectData {
  netIncome: number;
  depreciation: number;
  amortization: number;
  arChange: number;
  apChange: number;
  inventoryChange: number;
  prepaidChange: number;
}

export interface CFOpts {
  startDate: string;
  endDate: string;
  method: 'direct' | 'indirect';
  netOperating: number;
  netInvesting: number;
  netFinancing: number;
  netChange: number;
  endingCash: number;
  indirectOperatingCF: number;
}

/**
 * Generates a classic-style Statement of Cash Flows HTML document.
 *
 * @param data          Direct-method raw numbers from the screen's `data` state.
 * @param indirectData  Indirect-method adjustment figures from the screen's `indirectData` state.
 * @param company       The active company (for header).
 * @param opts          Date range, method toggle, and all computed totals from the screen.
 */
export function generateCashFlowHTML(
  data: CFData,
  indirectData: CFIndirectData,
  company: Company,
  opts: CFOpts,
): string {
  const period = `${opts.startDate} to ${opts.endDate}`;
  const methodLabel = opts.method === 'direct' ? 'Direct Method' : 'Indirect Method';

  const header = docHeader({
    coName: company.name || 'Company',
    coDetailHtml: coDetailHtml(company),
    title: 'Cash Flows',
    number: period,
  });

  const meta = metaStrip([
    { label: 'Period', value: period },
    { label: 'Method', value: methodLabel },
    { label: 'Net Change', value: `$${fmt(opts.netChange)}` },
    { label: 'Generated', value: generated() },
  ]);

  // Section header row (black bar)
  const sectionBar = (label: string): string =>
    `<tr><td colspan="2" style="background:#000;color:#fff;font-weight:bold;` +
    `letter-spacing:0.5px;padding:7px 8px;font-size:11px;">${esc(label)}</td></tr>`;

  const lineRow = (label: string, amount: number, indent = 1): string =>
    `<tr><td style="padding-left:${8 + indent * 16}px;">${esc(label)}</td>` +
    `<td class="num">${amount >= 0 ? '' : '('}$${fmt(Math.abs(amount))}${amount < 0 ? ')' : ''}</td></tr>`;

  const subBar = (label: string): string =>
    `<tr><td colspan="2" style="font-weight:bold;font-size:10px;letter-spacing:0.5px;` +
    `text-transform:uppercase;padding:6px 8px 3px 20px;color:#444;">${esc(label)}</td></tr>`;

  const subtotalRow = (label: string, amount: number, strong = false): string =>
    `<tr style="border-top:1px solid #000;">` +
    `<td style="${strong ? 'font-weight:bold;' : ''}padding-left:8px;">${esc(label)}</td>` +
    `<td class="num" style="${strong ? 'font-weight:bold;' : ''}">` +
    `${amount >= 0 ? '' : '('}$${fmt(Math.abs(amount))}${amount < 0 ? ')' : ''}` +
    `</td></tr>`;

  const spacerRow = (): string =>
    `<tr><td colspan="2" style="padding:4px 0;"></td></tr>`;

  let rows = '';

  // ── Operating Activities ──
  rows += sectionBar('CASH FLOWS FROM OPERATING ACTIVITIES');

  if (opts.method === 'direct') {
    rows += lineRow('Cash received from customers', data.operatingInflows, 1);
    rows += lineRow('Cash paid for expenses', -data.operatingOutflows, 1);
  } else {
    rows += lineRow('Net Income', indirectData.netIncome, 1);
    rows += subBar('Adjustments for Non-Cash Items');
    rows += lineRow('Add: Depreciation', indirectData.depreciation, 2);
    rows += lineRow('Add: Amortization', indirectData.amortization, 2);
    rows += subBar('Changes in Working Capital');
    rows += lineRow('(Increase)/Decrease in Accounts Receivable', -indirectData.arChange, 2);
    rows += lineRow('Increase/(Decrease) in Accounts Payable', indirectData.apChange, 2);
    rows += lineRow('(Increase)/Decrease in Inventory', -indirectData.inventoryChange, 2);
    rows += lineRow('(Increase)/Decrease in Prepaid Expenses', -indirectData.prepaidChange, 2);
  }

  const operatingCF = opts.method === 'direct' ? opts.netOperating : opts.indirectOperatingCF;
  rows += subtotalRow('Net Cash from Operating Activities', operatingCF, true);
  rows += spacerRow();

  // ── Investing Activities ──
  rows += sectionBar('CASH FLOWS FROM INVESTING ACTIVITIES');
  rows += lineRow('Purchase of assets', -data.investingOutflows, 1);
  rows += subtotalRow('Net Cash from Investing Activities', opts.netInvesting, true);
  rows += spacerRow();

  // ── Financing Activities ──
  rows += sectionBar('CASH FLOWS FROM FINANCING ACTIVITIES');
  rows += lineRow('Owner equity contributions', data.financingEquityIn, 1);
  rows += lineRow('Owner draws', -data.financingDraws, 1);
  rows += subtotalRow('Net Cash from Financing Activities', opts.netFinancing, true);
  rows += spacerRow();

  // ── Net Change in Cash ──
  rows += `<tr style="border-top:2px solid #000;background:#f0f0f0;">` +
    `<td style="font-weight:bold;padding-left:8px;">NET CHANGE IN CASH</td>` +
    `<td class="num" style="font-weight:bold;">` +
    `${opts.netChange >= 0 ? '' : '('}$${fmt(Math.abs(opts.netChange))}${opts.netChange < 0 ? ')' : ''}` +
    `</td></tr>`;
  rows += spacerRow();

  // Beginning / Ending cash
  rows += lineRow('Beginning Cash Balance', data.beginningCash, 1);

  rows += `<tr style="border-top:2px solid #000;background:#000;color:#fff;">` +
    `<td style="font-weight:bold;padding:9px 8px;letter-spacing:0.5px;">ENDING CASH BALANCE</td>` +
    `<td class="num" style="font-weight:bold;padding:9px 8px;">` +
    `${opts.endingCash >= 0 ? '' : '('}$${fmt(Math.abs(opts.endingCash))}${opts.endingCash < 0 ? ')' : ''}` +
    `</td></tr>`;

  const table =
    `<table class="ruled" style="width:100%;border-collapse:collapse;">` +
    `<thead><tr>` +
    `<th style="width:70%;">Description</th>` +
    `<th style="text-align:right;">Amount</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody></table>`;

  const body = docFrame(
    header +
    meta +
    `<div style="padding:0;">${table}</div>` +
    footerBar(`${company.name} · Statement of Cash Flows (${methodLabel}) · ${period}`),
  );

  return classicDocument({ title: `Cash Flow Statement ${period}`, bodyHtml: body });
}
