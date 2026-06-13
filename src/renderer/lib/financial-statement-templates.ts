// Classic PDF generators for financial statements (Trial Balance + General Ledger).
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
