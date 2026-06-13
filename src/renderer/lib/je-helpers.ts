// JE round 2 helpers — template variable resolution, schedule preview,
// smart paste, balance suggestions. Pure / dependency-free.

import api from './api';
import { roundCents } from './format';

// ─── Template variable resolution ──────────────────────────
// Supported tokens:
//   {{period_end}}                  → ISO date YYYY-MM-DD (last day of current month)
//   {{period_end_balance:CODE}}     → balance of account CODE as of period_end
//   {{prior_balance:CODE}}          → balance as of last day of previous month
export interface ResolveCtx {
  companyId: string;
  date?: string;
  accounts: Array<{ id: string; code: string; name: string }>;
}

// DATE: Format last-day-of-month as YYYY-MM-DD using local Y/M/D components,
// not toISOString().slice(0,10) — the latter shifts by ±1 day in non-UTC zones
// because new Date(y, m, 0) yields midnight local, which serializes to the
// previous UTC date for any timezone west of UTC.
const fmtYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const lastDayOfMonth = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return fmtYmd(last);
};

const lastDayOfPriorMonth = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return fmtYmd(last);
};

async function balanceOfAccount(companyId: string, accountId: string, asOfIso: string): Promise<number> {
  const rows: any = await api.rawQuery(
    `SELECT COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS bal
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.company_id = ? AND jel.account_id = ? AND je.is_posted = 1 AND je.date <= ?`,
    [companyId, accountId, asOfIso]
  );
  return Array.isArray(rows) && rows.length ? Number(rows[0]?.bal || 0) : 0;
}

export async function resolveTemplateString(input: string, ctx: ResolveCtx): Promise<string> {
  if (!input || input.indexOf('{{') < 0) return input;
  const today = ctx.date || new Date().toISOString().slice(0, 10);
  const periodEnd = lastDayOfMonth(today);
  const priorEnd = lastDayOfPriorMonth(today);
  const codeMap = new Map(ctx.accounts.map((a) => [a.code.toLowerCase(), a]));

  let out = input.replace(/\{\{\s*period_end\s*\}\}/g, periodEnd);

  const re = /\{\{\s*(period_end_balance|prior_balance)\s*:\s*([^}\s]+)\s*\}\}/g;
  const tokens: Array<{ kind: string; code: string; raw: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(out))) tokens.push({ kind: m[1], code: m[2], raw: m[0] });
  for (const t of tokens) {
    const acct = codeMap.get(t.code.toLowerCase());
    if (!acct) { out = out.split(t.raw).join('0.00'); continue; }
    const asOf = t.kind === 'prior_balance' ? priorEnd : periodEnd;
    const bal = await balanceOfAccount(ctx.companyId, acct.id, asOf);
    out = out.split(t.raw).join(roundCents(bal).toFixed(2));
  }
  return out;
}

// ─── Schedule preview (recurring/reversing) ───────────────
export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annually';

export function computeScheduleDates(start: string, frequency: Frequency, count = 12): string[] {
  const out: string[] = [];
  const d = new Date(start + 'T12:00:00');
  if (isNaN(d.getTime())) return out;
  for (let i = 0; i < count; i++) {
    const c = new Date(d);
    if (frequency === 'weekly') c.setDate(d.getDate() + 7 * i);
    else if (frequency === 'biweekly') c.setDate(d.getDate() + 14 * i);
    else if (frequency === 'monthly') c.setMonth(d.getMonth() + i);
    else if (frequency === 'quarterly') c.setMonth(d.getMonth() + 3 * i);
    else if (frequency === 'annually') c.setFullYear(d.getFullYear() + i);
    out.push(fmtYmd(c));
  }
  return out;
}

// ─── Smart paste: detect CSV / TSV / multi-space ──────────
export function detectAndSplit(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n').filter((r) => r.length > 0);
  if (rows.length === 0) return [];
  const sample = rows[0];
  let delim: string | RegExp = '\t';
  if (sample.indexOf('\t') >= 0) delim = '\t';
  else if (sample.indexOf(',') >= 0) delim = ',';
  else delim = /\s{2,}/;
  return rows.map((r) => r.split(delim as any).map((c) => String(c).trim()));
}

// ─── Smart auto-balance suggestions ───────────────────────
export interface BalanceSuggestion {
  label: string;
  account_id: string;
  account_label: string;
  side: 'debit' | 'credit';
  amount: number;
}

export async function buildBalanceSuggestions(args: {
  companyId: string;
  diff: number;
  accounts: Array<{ id: string; code: string; name: string; type?: string }>;
  currentLineAccountIds: string[];
}): Promise<BalanceSuggestion[]> {
  const { diff, accounts, currentLineAccountIds, companyId } = args;
  if (Math.abs(diff) < 0.005) return [];
  const side: 'debit' | 'credit' = diff < 0 ? 'debit' : 'credit';
  const amount = roundCents(Math.abs(diff));
  const out: BalanceSuggestion[] = [];

  const suspense = accounts.find((a) => /suspense/i.test(a.name));
  if (suspense) {
    out.push({ label: 'Suspense', account_id: suspense.id, account_label: `${suspense.code} — ${suspense.name}`, side, amount });
  }

  try {
    if (currentLineAccountIds.length > 0) {
      const placeholders = currentLineAccountIds.map(() => '?').join(',');
      const rows: any = await api.rawQuery(
        `SELECT a.id, a.code, a.name, COUNT(*) AS pair_count
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         WHERE je.company_id = ?
           AND jel.journal_entry_id IN (
             SELECT DISTINCT journal_entry_id FROM journal_entry_lines WHERE account_id IN (${placeholders})
           )
           AND jel.account_id NOT IN (${placeholders})
         GROUP BY a.id ORDER BY pair_count DESC LIMIT 1`,
        [companyId, ...currentLineAccountIds, ...currentLineAccountIds]
      );
      if (Array.isArray(rows) && rows.length) {
        const a = rows[0];
        out.push({ label: 'Most-paired', account_id: a.id, account_label: `${a.code} — ${a.name}`, side, amount });
      }
    }
  } catch { /* ignore */ }

  try {
    const last = localStorage.getItem(`je-last-balancer:${companyId}`);
    if (last) {
      const a = accounts.find((x) => x.id === last);
      if (a) out.push({ label: 'Last-used', account_id: a.id, account_label: `${a.code} — ${a.name}`, side, amount });
    }
  } catch { /* ignore */ }

  const seen = new Set<string>();
  return out.filter((s) => { if (seen.has(s.account_id)) return false; seen.add(s.account_id); return true; });
}

export function rememberBalancer(companyId: string, accountId: string) {
  try { localStorage.setItem(`je-last-balancer:${companyId}`, accountId); } catch { /* ignore */ }
}

// ─── Date increment helpers (clone) ────────────────────────
export function incrementDate(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return fmtYmd(d);
}

export function nextMonthEnd(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return fmtYmd(last);
}

// ─── Printable cover sheet HTML ───────────────────────────
import {
  classicStyles, docFrame, docHeader, metaStrip, boxRow, ruledTable, totalsBox, footerBar, esc as cesc,
} from './classic-styles';

export function generateJeCoverSheetHTML(args: {
  entry: { entry_number: string; date: string; description: string; reference?: string; class?: string };
  totalDebit: number;
  totalCredit: number;
  lines: Array<{ account_code: string; account_name: string; debit: number; credit: number; description?: string }>;
  companyName?: string;
  withSignatureLine?: boolean;
}): string {
  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const isBalanced = Math.abs(args.totalDebit - args.totalCredit) < 0.005;

  // ── Header ──
  const header = docHeader({
    coName: args.companyName || '',
    coDetailHtml: '',
    title: 'Journal Entry',
    numberHtml: `No. ${cesc(args.entry.entry_number)}`,
  });

  // ── Meta strip: Entry # / Date / Reference / Class ──
  const meta = metaStrip([
    { label: 'Entry #',    value: args.entry.entry_number || '—' },
    { label: 'Date',       value: args.entry.date || '—' },
    { label: 'Reference',  value: args.entry.reference || '—' },
    { label: 'Class',      value: args.entry.class || '—' },
  ]);

  // ── Description box ──
  const descBox = boxRow([
    { label: 'Description / Memo', html: `<div style="white-space:pre-line;">${cesc(args.entry.description)}</div>` },
  ]);

  // ── Line items ruled table ──
  const lineRows: string[][] = args.lines.map((l) => [
    cesc(l.account_code),
    cesc(l.account_name),
    l.debit  ? cesc(fmt(l.debit))  : '',
    l.credit ? cesc(fmt(l.credit)) : '',
    cesc(l.description || ''),
  ]);
  const itemsTable = ruledTable(
    [
      { label: 'Code' },
      { label: 'Account Name' },
      { label: 'Debit',  align: 'right', width: '110px' },
      { label: 'Credit', align: 'right', width: '110px' },
      { label: 'Memo' },
    ],
    lineRows,
  );

  // ── Totals box ──
  const balanceStatus = isBalanced ? 'BALANCED' : `OFF BY ${fmt(Math.abs(args.totalDebit - args.totalCredit))}`;
  const totals = totalsBox([
    { label: 'Total Debits',  value: fmt(args.totalDebit) },
    { label: 'Total Credits', value: fmt(args.totalCredit) },
    { label: balanceStatus,   value: isBalanced ? '—' : fmt(Math.abs(args.totalDebit - args.totalCredit)), grand: true },
  ]);

  // ── Optional signature lines ──
  const sigHTML = args.withSignatureLine
    ? `<div style="display:flex;gap:64px;padding:24px 16px;border-top:1px solid #000;">` +
      `<div style="flex:1;border-top:2px solid #000;padding-top:6px;font-size:10px;">Prepared by</div>` +
      `<div style="flex:1;border-top:2px solid #000;padding-top:6px;font-size:10px;">Reviewed by</div>` +
      `<div style="flex:1;border-top:2px solid #000;padding-top:6px;font-size:10px;">Date</div>` +
      `</div>`
    : '';

  // ── Footer ──
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const footer = footerBar(
    [args.companyName, `JE #${args.entry.entry_number}`, `Generated ${generated}`].filter(Boolean).join(' · ')
  );

  // ── Assemble ──
  const inner =
    header +
    meta +
    descBox +
    itemsTable +
    `<div style="display:flex;justify-content:flex-end;padding:10px 16px;">${totals}</div>` +
    sigHTML +
    footer;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>JE ${cesc(args.entry.entry_number)}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(inner) +
    `</body></html>`;
}
