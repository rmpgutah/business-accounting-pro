// src/main/services/client-risk-scorer.ts
//
// B7 — Client risk scoring.
//
// Analyzes payment behavior per client and produces a 0-100 risk
// score. Higher score = higher risk. Surfaces patterns like:
//   "this client used to pay in 12 days, now averaging 45 days"
//   "this client has $X in receivables aged >60 days"
//   "this client's invoice volume dropped 60% YoY"
//
// Scoring weights (sum to 100):
//   • Average DSO trend     — 25 pts (payment speed slowing?)
//   • Outstanding balance   — 20 pts (how much currently owed?)
//   • Aging severity        — 25 pts (how old is the oldest unpaid?)
//   • Late-pay frequency    — 15 pts (% of paid invoices that were late)
//   • Volume change         — 15 pts (revenue trend YoY?)

import * as db from '../database';

export interface ClientRiskScore {
  client_id: string;
  client_name: string;
  client_email: string | null;

  // Score & rating
  risk_score: number;            // 0-100
  risk_band: 'low' | 'moderate' | 'elevated' | 'high';
  risk_color: 'green' | 'yellow' | 'orange' | 'red';

  // Component scores (each 0-100, weighted into total)
  dso_score: number;
  outstanding_score: number;
  aging_score: number;
  late_pay_score: number;
  volume_score: number;

  // Supporting metrics
  avg_dso_days: number;          // average days from issue to paid
  avg_dso_recent: number;        // last 90 days subset
  avg_dso_historical: number;    // before last 90 days subset
  outstanding_balance: number;
  oldest_unpaid_days: number;
  late_pay_pct: number;          // % of invoices paid past due_date
  invoice_count: number;
  invoice_count_ytd: number;
  revenue_ytd: number;
  revenue_prior_year: number;
  volume_change_pct: number;

  // Explanations rendered in the UI
  warnings: string[];
}

interface InvoiceSnapshot {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  status: string;
  paid_date: string | null;     // derived: when fully paid (max payment date)
}

function localTodayISO(): string {
  const d = new Date();
  const pad = (n: number) => n < 10 ? '0' + n : String(n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00').getTime();
  const db_ = new Date(b + 'T12:00:00').getTime();
  return Math.round((db_ - da) / 86_400_000);
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function scoreOneClient(companyId: string, clientId: string): ClientRiskScore | null {
  const dbi = db.getDb();
  const today = localTodayISO();
  const ninetyDaysAgo = (() => {
    const d = new Date(Date.now() - 90 * 86_400_000);
    return d.toISOString().slice(0, 10);
  })();
  const yearStart = new Date().getFullYear() + '-01-01';
  const lastYearStart = (new Date().getFullYear() - 1) + '-01-01';
  const lastYearEnd = (new Date().getFullYear() - 1) + '-12-31';

  // Pull client info
  const client = dbi.prepare("SELECT id, name, email FROM clients WHERE id = ?").get(clientId) as any;
  if (!client) return null;

  // Pull all invoices for this client
  const invoices = dbi.prepare(`
    SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.total, i.amount_paid, i.status,
      (SELECT MAX(p.date) FROM payments p WHERE p.invoice_id = i.id) AS paid_date
    FROM invoices i
    WHERE i.company_id = ? AND i.client_id = ?
      AND COALESCE(i.deleted_at, '') = ''
  `).all(companyId, clientId) as InvoiceSnapshot[];

  const totalInvoices = invoices.length;

  // ── DSO (Days Sales Outstanding) calculation ──
  const paidInvoices = invoices.filter((i) => i.status === 'paid' && i.paid_date && i.issue_date);
  const dsoAll = paidInvoices.map((i) => dayDiff(i.issue_date, i.paid_date!));
  const dsoRecent = paidInvoices.filter((i) => i.paid_date! >= ninetyDaysAgo).map((i) => dayDiff(i.issue_date, i.paid_date!));
  const dsoHistorical = paidInvoices.filter((i) => i.paid_date! < ninetyDaysAgo).map((i) => dayDiff(i.issue_date, i.paid_date!));

  const avg_dso_days = average(dsoAll);
  const avg_dso_recent = average(dsoRecent);
  const avg_dso_historical = average(dsoHistorical);

  // ── Outstanding balance + aging ──
  const open = invoices.filter((i) => i.status !== 'paid' && i.status !== 'voided' && i.status !== 'cancelled');
  const outstanding_balance = open.reduce((s, i) => s + Math.max(0, (i.total || 0) - (i.amount_paid || 0)), 0);
  const oldest_unpaid = open
    .filter((i) => i.due_date)
    .map((i) => dayDiff(i.due_date, today))
    .filter((d) => d > 0)
    .sort((a, b) => b - a)[0] || 0;

  // ── Late-pay percentage ──
  const latePaid = paidInvoices.filter((i) => i.due_date && i.paid_date! > i.due_date);
  const late_pay_pct = paidInvoices.length > 0 ? (latePaid.length / paidInvoices.length) * 100 : 0;

  // ── Revenue trend YoY ──
  const revenueYTD = invoices.filter((i) => i.issue_date >= yearStart).reduce((s, i) => s + (i.amount_paid || 0), 0);
  const revenuePriorYear = invoices.filter((i) => i.issue_date >= lastYearStart && i.issue_date <= lastYearEnd).reduce((s, i) => s + (i.amount_paid || 0), 0);
  const volume_change_pct = revenuePriorYear > 0 ? ((revenueYTD - revenuePriorYear) / revenuePriorYear) * 100 : 0;
  const invoice_count_ytd = invoices.filter((i) => i.issue_date >= yearStart).length;

  // ── Component scores (each 0-100) ──
  // DSO score: fast pay = low score, slow + slowing = high
  let dsoScore = clamp((avg_dso_days - 15) * 2, 0, 100);
  if (avg_dso_recent > 0 && avg_dso_historical > 0) {
    const trend = avg_dso_recent - avg_dso_historical;
    if (trend > 7) dsoScore += clamp(trend * 1.5, 0, 30);
  }
  dsoScore = clamp(dsoScore, 0, 100);

  // Outstanding score: relative to client's typical invoice size
  const avgInvoiceSize = paidInvoices.length > 0
    ? paidInvoices.reduce((s, i) => s + (i.total || 0), 0) / paidInvoices.length
    : 1;
  const outstandingMultiple = avgInvoiceSize > 0 ? outstanding_balance / avgInvoiceSize : 0;
  const outstandingScore = clamp(outstandingMultiple * 15, 0, 100);

  // Aging score
  const agingScore = clamp(oldest_unpaid * 1.2, 0, 100);

  // Late-pay score
  const latePayScore = clamp(late_pay_pct * 1.5, 0, 100);

  // Volume change score (negative change = risk)
  let volumeScore = 0;
  if (volume_change_pct < 0) volumeScore = clamp(Math.abs(volume_change_pct) * 1.5, 0, 100);

  // Weighted total
  const riskScore = Math.round(
    dsoScore * 0.25 +
    outstandingScore * 0.20 +
    agingScore * 0.25 +
    latePayScore * 0.15 +
    volumeScore * 0.15
  );

  // Banding
  let band: ClientRiskScore['risk_band'] = 'low';
  let color: ClientRiskScore['risk_color'] = 'green';
  if (riskScore >= 70) { band = 'high'; color = 'red'; }
  else if (riskScore >= 50) { band = 'elevated'; color = 'orange'; }
  else if (riskScore >= 25) { band = 'moderate'; color = 'yellow'; }

  // ── Build warnings ──
  const warnings: string[] = [];
  if (avg_dso_recent - avg_dso_historical > 7 && avg_dso_historical > 0) {
    warnings.push(
      'Average days-to-pay slipped from ' + Math.round(avg_dso_historical) + 'd to ' + Math.round(avg_dso_recent) + 'd in the last 90 days'
    );
  }
  if (oldest_unpaid > 60) {
    warnings.push('Oldest unpaid invoice is ' + oldest_unpaid + ' days past due');
  }
  if (late_pay_pct > 30) {
    warnings.push(Math.round(late_pay_pct) + '% of invoices have been paid past their due date');
  }
  if (volume_change_pct < -30 && revenuePriorYear > 0) {
    warnings.push('Revenue YTD is down ' + Math.abs(Math.round(volume_change_pct)) + '% vs same period last year');
  }
  if (outstanding_balance > 0 && outstandingMultiple > 3) {
    warnings.push('Outstanding balance is ' + outstandingMultiple.toFixed(1) + 'x their typical invoice size');
  }

  return {
    client_id: client.id,
    client_name: client.name || '',
    client_email: client.email || null,
    risk_score: riskScore,
    risk_band: band,
    risk_color: color,
    dso_score: Math.round(dsoScore),
    outstanding_score: Math.round(outstandingScore),
    aging_score: Math.round(agingScore),
    late_pay_score: Math.round(latePayScore),
    volume_score: Math.round(volumeScore),
    avg_dso_days: Math.round(avg_dso_days * 10) / 10,
    avg_dso_recent: Math.round(avg_dso_recent * 10) / 10,
    avg_dso_historical: Math.round(avg_dso_historical * 10) / 10,
    outstanding_balance: Math.round(outstanding_balance * 100) / 100,
    oldest_unpaid_days: oldest_unpaid,
    late_pay_pct: Math.round(late_pay_pct * 10) / 10,
    invoice_count: totalInvoices,
    invoice_count_ytd,
    revenue_ytd: Math.round(revenueYTD * 100) / 100,
    revenue_prior_year: Math.round(revenuePriorYear * 100) / 100,
    volume_change_pct: Math.round(volume_change_pct * 10) / 10,
    warnings,
  };
}

/**
 * Score every client for the company. Returns ranked array (highest
 * risk first). Skips clients with zero invoice history.
 */
export function scoreAllClients(companyId: string): ClientRiskScore[] {
  const dbi = db.getDb();
  // clients has no deleted_at column (not soft-deletable) — don't filter on it.
  const clients = dbi.prepare(
    "SELECT id FROM clients WHERE company_id = ?"
  ).all(companyId) as Array<{ id: string }>;

  const scores: ClientRiskScore[] = [];
  for (const c of clients) {
    const score = scoreOneClient(companyId, c.id);
    if (score && score.invoice_count > 0) scores.push(score);
  }
  scores.sort((a, b) => b.risk_score - a.risk_score);
  return scores;
}
