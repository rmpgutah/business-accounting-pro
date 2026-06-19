import React, { useEffect, useMemo, useState } from 'react';
import { Printer, Download, FileSpreadsheet } from 'lucide-react';
import {
  format, startOfYear, endOfYear, endOfMonth, startOfMonth,
  startOfQuarter, endOfQuarter, subMonths, subQuarters, subYears, subDays,
  differenceInCalendarDays,
} from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
type StatementTab = 'pnl' | 'balance-sheet' | 'cash-flow';
type CompareMode = 'none' | 'prior-period' | 'prior-year';

interface AccountLine {
  account_name: string;
  account_code: string;
  subtype: string;
  total?: number;
  balance?: number;
}
interface PnLData {
  revenue: AccountLine[];
  costOfServices: AccountLine[];
  operatingExpenses: Record<string, AccountLine[]>;
  otherIncome: AccountLine[];
  otherExpenses: AccountLine[];
}
interface BSData {
  currentAssets: AccountLine[];
  fixedAssets: AccountLine[];
  currentLiabilities: AccountLine[];
  longTermLiabilities: AccountLine[];
  equity: AccountLine[];
}
interface CashFlowData {
  operating: AccountLine[];
  investing: AccountLine[];
  financing: AccountLine[];
}

// A line merged across the current + comparison periods.
interface CompLine { name: string; code: string; current: number; prior: number | null; }

const ISO = (d: Date) => format(d, 'yyyy-MM-dd');

// ─── Period presets ─────────────────────────────────────
interface Preset { id: string; label: string; range: () => { start: string; end: string }; asOf?: () => string; }
const PRESETS: Preset[] = [
  { id: 'this-month', label: 'This Month', range: () => ({ start: ISO(startOfMonth(new Date())), end: ISO(endOfMonth(new Date())) }), asOf: () => ISO(endOfMonth(new Date())) },
  { id: 'this-quarter', label: 'This Quarter', range: () => ({ start: ISO(startOfQuarter(new Date())), end: ISO(endOfQuarter(new Date())) }), asOf: () => ISO(endOfQuarter(new Date())) },
  { id: 'ytd', label: 'Year to Date', range: () => ({ start: ISO(startOfYear(new Date())), end: ISO(endOfMonth(new Date())) }), asOf: () => ISO(endOfMonth(new Date())) },
  { id: 'this-year', label: 'This Year', range: () => ({ start: ISO(startOfYear(new Date())), end: ISO(endOfYear(new Date())) }), asOf: () => ISO(endOfYear(new Date())) },
  { id: 'last-month', label: 'Last Month', range: () => ({ start: ISO(startOfMonth(subMonths(new Date(), 1))), end: ISO(endOfMonth(subMonths(new Date(), 1))) }), asOf: () => ISO(endOfMonth(subMonths(new Date(), 1))) },
  { id: 'last-quarter', label: 'Last Quarter', range: () => ({ start: ISO(startOfQuarter(subQuarters(new Date(), 1))), end: ISO(endOfQuarter(subQuarters(new Date(), 1))) }), asOf: () => ISO(endOfQuarter(subQuarters(new Date(), 1))) },
  { id: 'last-year', label: 'Last Year', range: () => ({ start: ISO(startOfYear(subYears(new Date(), 1))), end: ISO(endOfYear(subYears(new Date(), 1))) }), asOf: () => ISO(endOfYear(subYears(new Date(), 1))) },
  { id: 'custom', label: 'Custom Range', range: () => ({ start: ISO(startOfYear(new Date())), end: ISO(endOfMonth(new Date())) }) },
];

// Derive the comparison window from the current one.
function compareRange(start: string, end: string, mode: CompareMode): { start: string; end: string } | null {
  if (mode === 'none') return null;
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  if (mode === 'prior-year') return { start: ISO(subYears(s, 1)), end: ISO(subYears(e, 1)) };
  // prior-period: same length immediately before the current window.
  const len = differenceInCalendarDays(e, s);
  const pe = subDays(s, 1);
  const ps = subDays(pe, len);
  return { start: ISO(ps), end: ISO(pe) };
}
function compareAsOf(asOf: string, mode: CompareMode): string | null {
  if (mode === 'none') return null;
  const d = new Date(asOf + 'T12:00:00');
  return mode === 'prior-year' ? ISO(subYears(d, 1)) : ISO(endOfMonth(subMonths(d, 1)));
}

// ─── Merge helpers (current + prior by account) ─────────
const amt = (a: AccountLine, key: 'total' | 'balance') =>
  key === 'total' ? (a.total ?? a.balance ?? 0) : (a.balance ?? a.total ?? 0);

function mergeLines(curr: AccountLine[], prior: AccountLine[] | null, key: 'total' | 'balance'): CompLine[] {
  const map = new Map<string, CompLine>();
  (curr || []).forEach((a) => {
    const k = a.account_code || a.account_name;
    map.set(k, { name: a.account_name, code: a.account_code, current: amt(a, key), prior: prior ? 0 : null });
  });
  if (prior) {
    prior.forEach((a) => {
      const k = a.account_code || a.account_name;
      const ex = map.get(k);
      if (ex) ex.prior = amt(a, key);
      else map.set(k, { name: a.account_name, code: a.account_code, current: 0, prior: amt(a, key) });
    });
  }
  return [...map.values()];
}
const sumCurr = (l: CompLine[]) => l.reduce((s, x) => s + x.current, 0);
const sumPrior = (l: CompLine[]) => l.reduce((s, x) => s + (x.prior || 0), 0);

// Variance %: change from prior → current. Returns display string + sign.
function variance(cur: number, prior: number | null): { text: string; sign: number } {
  if (prior == null) return { text: '', sign: 0 };
  if (Math.abs(prior) < 0.005) return { text: cur === 0 ? '0.0%' : '—', sign: cur >= 0 ? 1 : -1 };
  const v = ((cur - prior) / Math.abs(prior)) * 100;
  return { text: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, sign: v >= 0 ? 1 : -1 };
}

// ─── Normalizers: map raw report-handler output → display model ──
// The reports:* IPC handlers return shapes that DON'T match the display
// model (P&L uses {revenue,cogs,expenses} with a `net_amount` field;
// balance-sheet returns flat {assets,liabilities,equity} with `balance`
// and credit-balance liabilities as negatives; cash-flow nests
// inflows/outflows). Previously the component read non-existent fields,
// so the statements rendered empty/zero. These adapters fix that.
const mkLine = (name: string, code: string, subtype: string, val: number): AccountLine =>
  ({ account_name: name, account_code: code || '', subtype: subtype || '', total: val, balance: val });
const humanizeSub = (s: string): string =>
  String(s || '').replace(/[_-]+/g, ' ').split(' ').map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ').trim();

function normalizePnL(raw: any): PnLData {
  const empty: PnLData = { revenue: [], costOfServices: [], operatingExpenses: {}, otherIncome: [], otherExpenses: [] };
  if (!raw) return empty;
  const map = (arr: any[]) => (arr || []).map((r) => mkLine(r.name, r.code, r.subtype, Number(r.net_amount ?? r.total ?? 0)));
  const opex: Record<string, AccountLine[]> = {};
  for (const r of (raw.expenses || [])) {
    const cat = humanizeSub(r.subtype) || 'Operating Expenses';
    (opex[cat] ||= []).push(mkLine(r.name, r.code, r.subtype, Number(r.net_amount ?? 0)));
  }
  return { revenue: map(raw.revenue), costOfServices: map(raw.cogs), operatingExpenses: opex, otherIncome: [], otherExpenses: [] };
}

function normalizeBS(raw: any): BSData {
  const empty: BSData = { currentAssets: [], fixedAssets: [], currentLiabilities: [], longTermLiabilities: [], equity: [] };
  if (!raw) return empty;
  const isFixed = (st = '') => /fixed|ppe|equipment|property|depreciat|intangible|long|non.?current/i.test(st);
  const isLongTerm = (st = '') => /long.?term|notes?_payable|loan|mortgage|bond|deferred/i.test(st);
  const ca: AccountLine[] = [], fa: AccountLine[] = [];
  for (const r of (raw.assets || [])) (isFixed(r.subtype) ? fa : ca).push(mkLine(r.name, r.code, r.subtype, Number(r.balance ?? 0)));
  const cl: AccountLine[] = [], ltl: AccountLine[] = [];
  for (const r of (raw.liabilities || [])) (isLongTerm(r.subtype) ? ltl : cl).push(mkLine(r.name, r.code, r.subtype, Math.abs(Number(r.balance ?? 0))));
  const eq: AccountLine[] = (raw.equity || []).map((r: any) => mkLine(r.name, r.code, r.subtype, Math.abs(Number(r.balance ?? 0))));
  if (raw.retainedEarnings) eq.push(mkLine('Retained Earnings', '', 'retained_earnings', Number(raw.retainedEarnings)));
  return { currentAssets: ca, fixedAssets: fa, currentLiabilities: cl, longTermLiabilities: ltl, equity: eq };
}

function normalizeCF(raw: any): CashFlowData {
  const empty: CashFlowData = { operating: [], investing: [], financing: [] };
  if (!raw) return empty;
  const sect = (s: any): AccountLine[] => {
    const lines: AccountLine[] = [];
    (s?.inflows || []).forEach((x: any) => { if (x.amount) lines.push(mkLine(x.label, '', '', Number(x.amount))); });
    (s?.outflows || []).forEach((x: any) => { if (x.amount) lines.push(mkLine(x.label, '', '', -Number(x.amount))); });
    return lines;
  };
  return { operating: sect(raw.operating), investing: sect(raw.investing), financing: sect(raw.financing) };
}

// ─── Print/PDF styles ───────────────────────────────────
const FS_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter; margin: 0.5in 0.6in; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1e293b; font-size: 11px; line-height: 1.5; background: #fff; padding: 40px 44px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .fs-page { max-width: 760px; margin: 0 auto; page-break-after: always; }
  .fs-page:last-child { page-break-after: auto; }
  .fs-hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 14px; margin-bottom: 20px; }
  .fs-co { font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.3px; }
  .fs-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  .fs-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #0f172a; padding: 5px 14px; border: 2px solid #0f172a; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; }
  thead th { font-size: 8px; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; padding: 4px 14px; text-align: right; border-bottom: 1px solid #e2e8f0; }
  thead th:first-child { text-align: left; }
  .fs-section td { padding: 6px 14px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #fff; background: #0f172a; border: none; }
  .fs-section-alt td { background: #334155; }
  .fs-subsec td { padding: 3px 14px 3px 28px; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; border-bottom: 1px solid #f1f5f9; }
  .fs-line td { padding: 5px 14px; font-size: 11px; color: #334155; border-bottom: 1px solid #f1f5f9; }
  .fs-line td:first-child { padding-left: 36px; }
  .fs-line-deep td:first-child { padding-left: 52px; font-size: 10px; color: #64748b; }
  .fs-total td { padding: 6px 14px; font-weight: 700; color: #0f172a; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  .fs-subtotal td { padding: 5px 14px; font-weight: 600; color: #0f172a; border-top: 1px solid #e2e8f0; }
  .fs-grand td { padding: 10px 14px; font-weight: 800; font-size: 13px; color: #0f172a; border-top: 3px solid #0f172a; border-bottom: none; background: #f8fafc; }
  .r { text-align: right; font-variant-numeric: tabular-nums; font-family: 'SF Mono', Menlo, Consolas, monospace; }
  .vcol { font-size: 9px; color: #64748b; }
  .green { color: #16a34a; } .red { color: #dc2626; }
  .fs-footer { display: flex; justify-content: space-between; margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; }
  @media print { body { padding: 0; } }
`;
const fsDate = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// ─── PDF builders (comparison-aware) ────────────────────
interface BuildOpts { compare: boolean; priorLabel: string; }
function pdfRow(name: string, cur: number, prior: number | null, opts: BuildOpts, cls = 'fs-line'): string {
  const v = variance(cur, prior);
  const cols = opts.compare
    ? `<td class="r">${formatCurrency(cur)}</td><td class="r">${prior == null ? '' : formatCurrency(prior)}</td><td class="r vcol ${v.sign >= 0 ? 'green' : 'red'}">${v.text}</td>`
    : `<td class="r">${formatCurrency(cur)}</td>`;
  return `<tr class="${cls}"><td>${name}</td>${cols}</tr>`;
}
function pdfSection(name: string, opts: BuildOpts, alt = false): string {
  return `<tr class="fs-section${alt ? ' fs-section-alt' : ''}"><td colspan="${opts.compare ? 4 : 2}">${name}</td></tr>`;
}
function pdfSubsec(name: string, opts: BuildOpts): string {
  return `<tr class="fs-subsec"><td colspan="${opts.compare ? 4 : 2}">${name}</td></tr>`;
}
function pdfHead(opts: BuildOpts): string {
  if (!opts.compare) return '';
  return `<thead><tr><th>Account</th><th>Current</th><th>${opts.priorLabel}</th><th>&Delta;%</th></tr></thead>`;
}

function buildPnLHTML(cur: PnLData, prior: PnLData | null, companyName: string, startDate: string, endDate: string, opts: BuildOpts): string {
  const rev = mergeLines(cur.revenue, prior?.revenue || null, 'total');
  const cogs = mergeLines(cur.costOfServices, prior?.costOfServices || null, 'total');
  const opexEntries: [string, CompLine[]][] = Object.keys(cur.operatingExpenses || {}).map((catKey) => [
    catKey, mergeLines(cur.operatingExpenses[catKey] || [], prior ? (prior.operatingExpenses?.[catKey] || []) : null, 'total'),
  ]);
  const totRevC = sumCurr(rev), totRevP = sumPrior(rev);
  const totCogsC = sumCurr(cogs), totCogsP = sumPrior(cogs);
  const gpC = totRevC - totCogsC, gpP = totRevP - totCogsP;
  const allOpex = opexEntries.flatMap(([, v]) => v);
  const totOpexC = sumCurr(allOpex), totOpexP = sumPrior(allOpex);
  const niC = gpC - totOpexC, niP = gpP - totOpexP;
  const grandV = variance(niC, opts.compare ? niP : null);

  let rows = '';
  rows += pdfSection('Revenue', opts);
  rev.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Total Revenue', totRevC, opts.compare ? totRevP : null, opts, 'fs-total');
  rows += pdfSection('Cost of Goods Sold', opts, true);
  cogs.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Total COGS', totCogsC, opts.compare ? totCogsP : null, opts, 'fs-total');
  rows += pdfRow('Gross Profit', gpC, opts.compare ? gpP : null, opts, 'fs-total');
  rows += pdfSection('Operating Expenses', opts);
  opexEntries.forEach(([cat, items]) => {
    if (items.length > 0) { rows += pdfSubsec(cat, opts); items.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts, 'fs-line fs-line-deep'); }); }
  });
  rows += pdfRow('Total Operating Expenses', totOpexC, opts.compare ? totOpexP : null, opts, 'fs-total');
  rows += `<tr class="fs-grand"><td>Net Income</td><td class="r ${niC >= 0 ? 'green' : 'red'}">${formatCurrency(niC)}</td>${opts.compare ? `<td class="r">${formatCurrency(niP)}</td><td class="r vcol ${grandV.sign >= 0 ? 'green' : 'red'}">${grandV.text}</td>` : ''}</tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FS_STYLES}</style></head><body>
<div class="fs-page">
  <div class="fs-hdr"><div><div class="fs-co">${companyName}</div><div class="fs-sub">${startDate} through ${endDate}${opts.compare ? ` &middot; compared to ${opts.priorLabel}` : ''}</div></div><div class="fs-badge">Profit &amp; Loss</div></div>
  <table>${pdfHead(opts)}<tbody>${rows}</tbody></table>
  <div class="fs-footer"><span>${companyName}</span><span>Generated ${fsDate()}</span></div>
</div></body></html>`;
}

function buildBSHTML(cur: BSData, prior: BSData | null, companyName: string, asOfDate: string, opts: BuildOpts): string {
  const ca = mergeLines(cur.currentAssets, prior?.currentAssets || null, 'balance');
  const fa = mergeLines(cur.fixedAssets, prior?.fixedAssets || null, 'balance');
  const cl = mergeLines(cur.currentLiabilities, prior?.currentLiabilities || null, 'balance');
  const ltl = mergeLines(cur.longTermLiabilities, prior?.longTermLiabilities || null, 'balance');
  const eq = mergeLines(cur.equity, prior?.equity || null, 'balance');
  const taC = sumCurr(ca) + sumCurr(fa), taP = sumPrior(ca) + sumPrior(fa);
  const tlC = sumCurr(cl) + sumCurr(ltl), tlP = sumPrior(cl) + sumPrior(ltl);
  const teC = sumCurr(eq), teP = sumPrior(eq);

  let rows = '';
  rows += pdfSection('Assets', opts);
  rows += pdfSubsec('Current Assets', opts);
  ca.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Total Current Assets', sumCurr(ca), opts.compare ? sumPrior(ca) : null, opts, 'fs-subtotal');
  rows += pdfSubsec('Fixed Assets', opts);
  fa.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Total Fixed Assets', sumCurr(fa), opts.compare ? sumPrior(fa) : null, opts, 'fs-subtotal');
  rows += pdfRow('Total Assets', taC, opts.compare ? taP : null, opts, 'fs-total');
  rows += pdfSection('Liabilities', opts, true);
  rows += pdfSubsec('Current Liabilities', opts);
  cl.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Total Current Liabilities', sumCurr(cl), opts.compare ? sumPrior(cl) : null, opts, 'fs-subtotal');
  if (ltl.length > 0) {
    rows += pdfSubsec('Long-Term Liabilities', opts);
    ltl.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
    rows += pdfRow('Total Long-Term Liabilities', sumCurr(ltl), opts.compare ? sumPrior(ltl) : null, opts, 'fs-subtotal');
  }
  rows += pdfRow('Total Liabilities', tlC, opts.compare ? tlP : null, opts, 'fs-total');
  rows += pdfSection('Equity', opts);
  eq.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Total Equity', teC, opts.compare ? teP : null, opts, 'fs-total');
  const balanced = Math.abs(taC - (tlC + teC)) < 0.01;
  rows += `<tr class="fs-grand"><td>Total Liabilities + Equity ${balanced ? '<span style="font-size:9px;color:#16a34a;margin-left:8px;">&#x2713; Balanced</span>' : '<span style="font-size:9px;color:#dc2626;margin-left:8px;">&#x2717; Unbalanced</span>'}</td><td class="r">${formatCurrency(tlC + teC)}</td>${opts.compare ? `<td class="r">${formatCurrency(tlP + teP)}</td><td></td>` : ''}</tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FS_STYLES}</style></head><body>
<div class="fs-page">
  <div class="fs-hdr"><div><div class="fs-co">${companyName}</div><div class="fs-sub">As of ${asOfDate}${opts.compare ? ` &middot; vs ${opts.priorLabel}` : ''}</div></div><div class="fs-badge">Balance Sheet</div></div>
  <table>${pdfHead(opts)}<tbody>${rows}</tbody></table>
  <div class="fs-footer"><span>${companyName}</span><span>Generated ${fsDate()}</span></div>
</div></body></html>`;
}

function buildCFHTML(cur: CashFlowData, prior: CashFlowData | null, companyName: string, startDate: string, endDate: string, opts: BuildOpts): string {
  const op = mergeLines(cur.operating, prior?.operating || null, 'total');
  const inv = mergeLines(cur.investing, prior?.investing || null, 'total');
  const fin = mergeLines(cur.financing, prior?.financing || null, 'total');
  const opC = sumCurr(op), opP = sumPrior(op), invC = sumCurr(inv), invP = sumPrior(inv), finC = sumCurr(fin), finP = sumPrior(fin);
  const ncC = opC + invC + finC, ncP = opP + invP + finP;

  let rows = '';
  rows += pdfSection('Operating Activities', opts);
  op.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Net Cash from Operating', opC, opts.compare ? opP : null, opts, 'fs-total');
  rows += pdfSection('Investing Activities', opts, true);
  inv.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Net Cash from Investing', invC, opts.compare ? invP : null, opts, 'fs-total');
  rows += pdfSection('Financing Activities', opts);
  fin.forEach((a) => { rows += pdfRow(a.name, a.current, a.prior, opts); });
  rows += pdfRow('Net Cash from Financing', finC, opts.compare ? finP : null, opts, 'fs-total');
  const v = variance(ncC, opts.compare ? ncP : null);
  rows += `<tr class="fs-grand"><td>Net Change in Cash</td><td class="r ${ncC >= 0 ? 'green' : 'red'}">${formatCurrency(ncC)}</td>${opts.compare ? `<td class="r">${formatCurrency(ncP)}</td><td class="r vcol ${v.sign >= 0 ? 'green' : 'red'}">${v.text}</td>` : ''}</tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FS_STYLES}</style></head><body>
<div class="fs-page">
  <div class="fs-hdr"><div><div class="fs-co">${companyName}</div><div class="fs-sub">${startDate} through ${endDate}${opts.compare ? ` &middot; compared to ${opts.priorLabel}` : ''}</div></div><div class="fs-badge">Cash Flow Statement</div></div>
  <table>${pdfHead(opts)}<tbody>${rows}</tbody></table>
  <div class="fs-footer"><span>${companyName}</span><span>Generated ${fsDate()}</span></div>
</div></body></html>`;
}

// ─── On-screen comparative rows ─────────────────────────
const SectionHeader: React.FC<{ label: string; compare: boolean }> = ({ label, compare }) => (
  <tr style={{ background: 'var(--color-bg-elevated)' }}>
    <td colSpan={compare ? 4 : 2} className="px-6 py-2 text-xs font-bold text-text-primary uppercase tracking-wider">{label}</td>
  </tr>
);
const SubHeader: React.FC<{ label: string; compare: boolean }> = ({ label, compare }) => (
  <tr><td colSpan={compare ? 4 : 2} className="text-[10px] font-semibold text-text-muted uppercase tracking-wider" style={{ padding: '4px 16px 2px 36px' }}>{label}</td></tr>
);

const Row: React.FC<{ line: CompLine; indent?: number; bold?: boolean; total?: boolean; compare: boolean; basePct?: number | null }> =
({ line, indent = 0, bold = false, total = false, compare, basePct }) => {
  const v = variance(line.current, line.prior);
  const cs = basePct ? ` · ${((line.current / basePct) * 100).toFixed(1)}%` : '';
  return (
    <tr className={total ? 'border-b-2 border-border-primary' : 'border-b border-border-primary/30 hover:bg-bg-hover/30 transition-colors'} style={total ? { background: 'var(--color-bg-elevated)' } : undefined}>
      <td className={`py-1.5 text-xs ${bold || total ? 'font-bold text-text-primary' : 'text-text-secondary'}`} style={{ paddingLeft: `${24 + indent * 18}px` }}>
        {line.name}{basePct ? <span className="text-text-muted font-normal">{cs}</span> : null}
      </td>
      <td className={`py-1.5 text-right pr-4 font-mono text-xs ${bold || total ? 'font-bold text-text-primary' : 'text-text-primary'}`}>{formatCurrency(line.current)}</td>
      {compare && <td className="py-1.5 text-right pr-4 font-mono text-xs text-text-muted">{line.prior == null ? '—' : formatCurrency(line.prior)}</td>}
      {compare && <td className={`py-1.5 text-right pr-6 font-mono text-[11px] ${v.sign >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>{v.text}</td>}
    </tr>
  );
};

// ─── Component ──────────────────────────────────────────
const FinancialStatements: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyName = activeCompany?.name || 'Company';

  const [tab, setTab] = useState<StatementTab>('pnl');
  const [presetId, setPresetId] = useState('ytd');
  const [startDate, setStartDate] = useState(() => PRESETS.find(p => p.id === 'ytd')!.range().start);
  const [endDate, setEndDate] = useState(() => PRESETS.find(p => p.id === 'ytd')!.range().end);
  const [asOfDate, setAsOfDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [compareMode, setCompareMode] = useState<CompareMode>('none');
  const [commonSize, setCommonSize] = useState(false);

  const [pnl, setPnl] = useState<{ cur: PnLData | null; prior: PnLData | null }>({ cur: null, prior: null });
  const [bs, setBs] = useState<{ cur: BSData | null; prior: BSData | null }>({ cur: null, prior: null });
  const [cf, setCf] = useState<{ cur: CashFlowData | null; prior: CashFlowData | null }>({ cur: null, prior: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p || id === 'custom') return;
    const r = p.range();
    setStartDate(r.start); setEndDate(r.end);
    if (p.asOf) setAsOfDate(p.asOf());
  };

  const priorLabel = useMemo(() => compareMode === 'prior-year' ? 'Prior Year' : compareMode === 'prior-period' ? 'Prior Period' : '', [compareMode]);

  const loadData = async () => {
    setLoading(true); setError('');
    try {
      if (tab === 'pnl') {
        const cur = normalizePnL(await api.reportProfitLoss(startDate, endDate));
        let prior: PnLData | null = null;
        const cr = compareRange(startDate, endDate, compareMode);
        if (cr) prior = normalizePnL(await api.reportProfitLoss(cr.start, cr.end));
        setPnl({ cur, prior });
      } else if (tab === 'balance-sheet') {
        const cur = normalizeBS(await api.reportBalanceSheet(asOfDate));
        let prior: BSData | null = null;
        const ca = compareAsOf(asOfDate, compareMode);
        if (ca) prior = normalizeBS(await api.reportBalanceSheet(ca));
        setBs({ cur, prior });
      } else {
        const cur = normalizeCF(await api.reportCashFlow(startDate, endDate));
        let prior: CashFlowData | null = null;
        const cr = compareRange(startDate, endDate, compareMode);
        if (cr) prior = normalizeCF(await api.reportCashFlow(cr.start, cr.end));
        setCf({ cur, prior });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load financial statement');
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [tab, startDate, endDate, asOfDate, compareMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildOpts: BuildOpts = { compare: compareMode !== 'none', priorLabel };

  const getHTML = (): string => {
    if (tab === 'pnl' && pnl.cur) return buildPnLHTML(pnl.cur, pnl.prior, companyName, startDate, endDate, buildOpts);
    if (tab === 'balance-sheet' && bs.cur) return buildBSHTML(bs.cur, bs.prior, companyName, asOfDate, buildOpts);
    if (tab === 'cash-flow' && cf.cur) return buildCFHTML(cf.cur, cf.prior, companyName, startDate, endDate, buildOpts);
    return '';
  };
  // Consolidated: all three statements in one PDF package.
  const getConsolidatedHTML = async (): Promise<string> => {
    const cr = compareRange(startDate, endDate, compareMode);
    const ca = compareAsOf(asOfDate, compareMode);
    const [pCur, bCur, cCur] = await Promise.all([
      api.reportProfitLoss(startDate, endDate).then(normalizePnL),
      api.reportBalanceSheet(asOfDate).then(normalizeBS),
      api.reportCashFlow(startDate, endDate).then(normalizeCF),
    ]);
    const [pPri, bPri, cPri] = await Promise.all([
      cr ? api.reportProfitLoss(cr.start, cr.end).then(normalizePnL) : Promise.resolve(null),
      ca ? api.reportBalanceSheet(ca).then(normalizeBS) : Promise.resolve(null),
      cr ? api.reportCashFlow(cr.start, cr.end).then(normalizeCF) : Promise.resolve(null),
    ]);
    const pages = [
      buildPnLHTML(pCur, pPri, companyName, startDate, endDate, buildOpts),
      buildBSHTML(bCur, bPri, companyName, asOfDate, buildOpts),
      buildCFHTML(cCur, cPri, companyName, startDate, endDate, buildOpts),
    ].map((h) => h.replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, ''));
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FS_STYLES}</style></head><body>${pages.join('\n')}</body></html>`;
  };

  const getTitle = () => tab === 'pnl' ? `ProfitLoss-${startDate}-to-${endDate}` : tab === 'balance-sheet' ? `BalanceSheet-${asOfDate}` : `CashFlow-${startDate}-to-${endDate}`;
  const handlePrint = async () => { const h = getHTML(); if (h) await api.print(h); };
  const handleSavePDF = async () => { const h = getHTML(); if (h) await api.saveToPDF(h, getTitle()); };
  const handleConsolidated = async () => {
    setLoading(true);
    try { const h = await getConsolidatedHTML(); await api.saveToPDF(h, `FinancialStatements-${companyName}-${endDate}`); }
    catch (err: any) { setError(err?.message || 'Failed to build consolidated package'); }
    finally { setLoading(false); }
  };

  const compare = compareMode !== 'none';
  const TABS: { id: StatementTab; label: string }[] = [
    { id: 'pnl', label: 'Profit & Loss' },
    { id: 'balance-sheet', label: 'Balance Sheet' },
    { id: 'cash-flow', label: 'Cash Flow' },
  ];

  // ── P&L on-screen model ──
  const pnlModel = useMemo(() => {
    if (!pnl.cur) return null;
    const rev = mergeLines(pnl.cur.revenue, pnl.prior?.revenue || null, 'total');
    const cogs = mergeLines(pnl.cur.costOfServices, pnl.prior?.costOfServices || null, 'total');
    const opex: [string, CompLine[]][] = Object.keys(pnl.cur.operatingExpenses || {}).map((k) => [k, mergeLines(pnl.cur!.operatingExpenses[k] || [], pnl.prior ? (pnl.prior.operatingExpenses?.[k] || []) : null, 'total')]);
    const totRev = sumCurr(rev), totCogs = sumCurr(cogs), gp = totRev - totCogs;
    const totOpex = opex.flatMap(([, v]) => v).reduce((s, x) => s + x.current, 0);
    return { rev, cogs, opex, totRev, totCogs, gp, totOpex, ni: gp - totOpex };
  }, [pnl]);

  const bsModel = useMemo(() => {
    if (!bs.cur) return null;
    const ca = mergeLines(bs.cur.currentAssets, bs.prior?.currentAssets || null, 'balance');
    const fa = mergeLines(bs.cur.fixedAssets, bs.prior?.fixedAssets || null, 'balance');
    const cl = mergeLines(bs.cur.currentLiabilities, bs.prior?.currentLiabilities || null, 'balance');
    const ltl = mergeLines(bs.cur.longTermLiabilities, bs.prior?.longTermLiabilities || null, 'balance');
    const eq = mergeLines(bs.cur.equity, bs.prior?.equity || null, 'balance');
    return { ca, fa, cl, ltl, eq, ta: sumCurr(ca) + sumCurr(fa), tcl: sumCurr(cl), tltl: sumCurr(ltl), te: sumCurr(eq) };
  }, [bs]);

  const cfModel = useMemo(() => {
    if (!cf.cur) return null;
    const op = mergeLines(cf.cur.operating, cf.prior?.operating || null, 'total');
    const inv = mergeLines(cf.cur.investing, cf.prior?.investing || null, 'total');
    const fin = mergeLines(cf.cur.financing, cf.prior?.financing || null, 'total');
    return { op, inv, fin, opT: sumCurr(op), invT: sumCurr(inv), finT: sumCurr(fin) };
  }, [cf]);

  const ctp = (cName: string, c: number, p: number | null): CompLine => ({ name: cName, code: '', current: c, prior: compare ? p : null });
  const pnlBase = commonSize && pnlModel ? pnlModel.totRev : null;
  const bsBase = commonSize && bsModel ? bsModel.ta : null;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load financial statement" onDismiss={() => setError('')} />}

      {/* Tabs + actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${tab === t.id ? 'text-white' : 'text-text-secondary hover:text-text-primary'}`}
              style={{ borderRadius: '6px', background: tab === t.id ? 'var(--color-accent-blue)' : 'var(--color-border-primary)' }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="block-btn flex items-center gap-2" onClick={handlePrint}><Printer size={14} /> Print</button>
          <button className="block-btn flex items-center gap-2" onClick={handleSavePDF}><Download size={14} /> Save PDF</button>
          <button className="block-btn-primary flex items-center gap-2" onClick={handleConsolidated} title="Export P&L + Balance Sheet + Cash Flow as one PDF package"><FileSpreadsheet size={14} /> Full Package</button>
        </div>
      </div>

      {/* Controls: preset, dates, compare, common-size */}
      <div className="block-card p-4 flex items-center gap-4 flex-wrap" style={{ borderRadius: '6px' }}>
        <FileSpreadsheet size={16} className="text-text-muted" />
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">Period</label>
          <select value={presetId} onChange={(e) => applyPreset(e.target.value)} className="bg-bg-tertiary border border-border-primary text-text-primary text-xs px-3 py-1.5" style={{ borderRadius: '6px' }}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        {tab === 'balance-sheet' ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">As of</label>
            <input type="date" value={asOfDate} onChange={(e) => { setAsOfDate(e.target.value); setPresetId('custom'); }} className="bg-bg-tertiary border border-border-primary text-text-primary text-xs px-3 py-1.5 font-mono" style={{ borderRadius: '6px' }} />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">From</label>
              <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPresetId('custom'); }} className="bg-bg-tertiary border border-border-primary text-text-primary text-xs px-3 py-1.5 font-mono" style={{ borderRadius: '6px' }} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">To</label>
              <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPresetId('custom'); }} className="bg-bg-tertiary border border-border-primary text-text-primary text-xs px-3 py-1.5 font-mono" style={{ borderRadius: '6px' }} />
            </div>
          </>
        )}
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">Compare</label>
          <select value={compareMode} onChange={(e) => setCompareMode(e.target.value as CompareMode)} className="bg-bg-tertiary border border-border-primary text-text-primary text-xs px-3 py-1.5" style={{ borderRadius: '6px' }}>
            <option value="none">None</option>
            <option value="prior-period">Prior Period</option>
            <option value="prior-year">Prior Year</option>
          </select>
        </div>
        {tab !== 'cash-flow' && (
          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={commonSize} onChange={(e) => setCommonSize(e.target.checked)} style={{ accentColor: 'var(--accent-primary)' }} />
            Common-size %
          </label>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Loading statement...</div>
      ) : (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="px-6 py-4 border-b border-border-primary" style={{ background: 'var(--color-bg-elevated)' }}>
            <h2 className="text-sm font-bold text-text-primary">{companyName}</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {tab === 'pnl' && `Profit & Loss: ${startDate} to ${endDate}`}
              {tab === 'balance-sheet' && `Balance Sheet as of ${asOfDate}`}
              {tab === 'cash-flow' && `Cash Flow: ${startDate} to ${endDate}`}
              {compare && ` · vs ${priorLabel}`}
            </p>
          </div>

          <table className="block-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="text-right">{compare ? 'Current' : (tab === 'balance-sheet' ? 'Balance' : 'Amount')}</th>
                {compare && <th className="text-right">{priorLabel}</th>}
                {compare && <th className="text-right">Δ%</th>}
              </tr>
            </thead>
            <tbody>
              {/* P&L */}
              {tab === 'pnl' && pnlModel && (<>
                <SectionHeader label="Revenue" compare={compare} />
                {pnlModel.rev.map((a, i) => <Row key={`r${i}`} line={a} indent={1} compare={compare} basePct={pnlBase} />)}
                <Row line={ctp('Total Revenue', pnlModel.totRev, sumPrior(pnlModel.rev))} total compare={compare} />
                <SectionHeader label="Cost of Goods Sold" compare={compare} />
                {pnlModel.cogs.map((a, i) => <Row key={`c${i}`} line={a} indent={1} compare={compare} basePct={pnlBase} />)}
                <Row line={ctp('Total COGS', pnlModel.totCogs, sumPrior(pnlModel.cogs))} total compare={compare} />
                <Row line={ctp('Gross Profit', pnlModel.gp, sumPrior(pnlModel.rev) - sumPrior(pnlModel.cogs))} total compare={compare} />
                <SectionHeader label="Operating Expenses" compare={compare} />
                {pnlModel.opex.map(([cat, items]) => items.length > 0 ? (
                  <React.Fragment key={`oe${cat}`}>
                    <SubHeader label={cat} compare={compare} />
                    {items.map((a, i) => <Row key={`oe${cat}${i}`} line={a} indent={2} compare={compare} basePct={pnlBase} />)}
                  </React.Fragment>
                ) : null)}
                <Row line={ctp('Total Operating Expenses', pnlModel.totOpex, pnlModel.opex.flatMap(([, v]) => v).reduce((s, x) => s + (x.prior || 0), 0))} total compare={compare} />
                <Row line={ctp('Net Income', pnlModel.ni, (sumPrior(pnlModel.rev) - sumPrior(pnlModel.cogs)) - pnlModel.opex.flatMap(([, v]) => v).reduce((s, x) => s + (x.prior || 0), 0))} total compare={compare} />
              </>)}

              {/* Balance Sheet */}
              {tab === 'balance-sheet' && bsModel && (<>
                <SectionHeader label="Assets" compare={compare} />
                <SubHeader label="Current Assets" compare={compare} />
                {bsModel.ca.map((a, i) => <Row key={`ca${i}`} line={a} indent={2} compare={compare} basePct={bsBase} />)}
                <Row line={ctp('Total Current Assets', sumCurr(bsModel.ca), sumPrior(bsModel.ca))} indent={1} bold compare={compare} />
                <SubHeader label="Fixed Assets" compare={compare} />
                {bsModel.fa.map((a, i) => <Row key={`fa${i}`} line={a} indent={2} compare={compare} basePct={bsBase} />)}
                <Row line={ctp('Total Fixed Assets', sumCurr(bsModel.fa), sumPrior(bsModel.fa))} indent={1} bold compare={compare} />
                <Row line={ctp('Total Assets', bsModel.ta, sumPrior(bsModel.ca) + sumPrior(bsModel.fa))} total compare={compare} />
                <SectionHeader label="Liabilities" compare={compare} />
                <SubHeader label="Current Liabilities" compare={compare} />
                {bsModel.cl.map((a, i) => <Row key={`cl${i}`} line={a} indent={2} compare={compare} basePct={bsBase} />)}
                <Row line={ctp('Total Current Liabilities', bsModel.tcl, sumPrior(bsModel.cl))} indent={1} bold compare={compare} />
                {bsModel.ltl.length > 0 && (<>
                  <SubHeader label="Long-Term Liabilities" compare={compare} />
                  {bsModel.ltl.map((a, i) => <Row key={`ltl${i}`} line={a} indent={2} compare={compare} basePct={bsBase} />)}
                  <Row line={ctp('Total Long-Term Liabilities', bsModel.tltl, sumPrior(bsModel.ltl))} indent={1} bold compare={compare} />
                </>)}
                <Row line={ctp('Total Liabilities', bsModel.tcl + bsModel.tltl, sumPrior(bsModel.cl) + sumPrior(bsModel.ltl))} total compare={compare} />
                <SectionHeader label="Equity" compare={compare} />
                {bsModel.eq.map((a, i) => <Row key={`eq${i}`} line={a} indent={1} compare={compare} basePct={bsBase} />)}
                <Row line={ctp('Total Equity', bsModel.te, sumPrior(bsModel.eq))} total compare={compare} />
                <Row line={ctp('Total Liabilities + Equity', bsModel.tcl + bsModel.tltl + bsModel.te, sumPrior(bsModel.cl) + sumPrior(bsModel.ltl) + sumPrior(bsModel.eq))} total compare={compare} />
              </>)}

              {/* Cash Flow */}
              {tab === 'cash-flow' && cfModel && (<>
                <SectionHeader label="Operating Activities" compare={compare} />
                {cfModel.op.map((a, i) => <Row key={`op${i}`} line={a} indent={1} compare={compare} />)}
                <Row line={ctp('Net Cash from Operating', cfModel.opT, sumPrior(cfModel.op))} total compare={compare} />
                <SectionHeader label="Investing Activities" compare={compare} />
                {cfModel.inv.map((a, i) => <Row key={`inv${i}`} line={a} indent={1} compare={compare} />)}
                <Row line={ctp('Net Cash from Investing', cfModel.invT, sumPrior(cfModel.inv))} total compare={compare} />
                <SectionHeader label="Financing Activities" compare={compare} />
                {cfModel.fin.map((a, i) => <Row key={`fin${i}`} line={a} indent={1} compare={compare} />)}
                <Row line={ctp('Net Cash from Financing', cfModel.finT, sumPrior(cfModel.fin))} total compare={compare} />
                <Row line={ctp('Net Change in Cash', cfModel.opT + cfModel.invT + cfModel.finT, sumPrior(cfModel.op) + sumPrior(cfModel.inv) + sumPrior(cfModel.fin))} total compare={compare} />
              </>)}
            </tbody>
          </table>

          {!loading && ((tab === 'pnl' && !pnlModel) || (tab === 'balance-sheet' && !bsModel) || (tab === 'cash-flow' && !cfModel)) && (
            <div className="p-12 text-center"><p className="text-sm text-text-muted">No data available for the selected period.</p></div>
          )}
        </div>
      )}
    </div>
  );
};

export default FinancialStatements;
