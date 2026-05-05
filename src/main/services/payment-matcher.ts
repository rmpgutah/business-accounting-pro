// src/main/services/payment-matcher.ts
//
// B11 — Smart payment matching.
//
// Given a bank-import line (date + amount + description), suggest
// the open invoice it most likely pays. Used during bank
// reconciliation to skip the manual "click invoice X to apply
// this payment" dance.
//
// Scoring (0-100):
//   • Exact amount match            +50
//   • Amount within ±$0.01          +45
//   • Amount within ±$1.00          +20 (rounding allowance)
//   • Date within ±3 days of issue  +20
//   • Date within ±7 days of issue  +10
//   • Client name appears in desc   +25 (string-includes)
//   • Invoice number appears in desc +30
//
// Threshold for surfacing: 60. We return up to 3 candidates
// sorted descending so the user can confirm the right one.

import * as db from '../database';

export interface MatchCandidate {
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  client_name: string | null;
  total: number;
  amount_paid: number;
  balance_due: number;
  issue_date: string;
  due_date: string;
  score: number;
  reasons: string[];   // ["amount exact", "client name in desc"]
}

export function suggestMatches(opts: {
  amount: number;
  date: string;          // YYYY-MM-DD
  description: string;
  company_id: string;
}): MatchCandidate[] {
  const { amount, date, description, company_id } = opts;
  const dbi = db.getDb();
  const desc = (description || '').toLowerCase();

  // Pull all open invoices for this company. For very large tenants
  // (>10k open invoices) this would need pre-filtering by amount band;
  // typical SMB has <500 open at a time so a full scan is fine.
  const open = dbi.prepare(`
    SELECT i.id, i.invoice_number, i.total, i.amount_paid, i.issue_date, i.due_date,
           i.client_id, c.name AS client_name
    FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    WHERE i.company_id = ?
      AND i.status NOT IN ('paid', 'voided', 'cancelled')
      AND COALESCE(i.deleted_at, '') = ''
      AND (i.total - i.amount_paid) > 0
  `).all(company_id) as any[];

  const importTime = new Date(date + 'T12:00:00').getTime();
  const dayMs = 86_400_000;

  const candidates: MatchCandidate[] = [];

  for (const inv of open) {
    const balance = Number(inv.total) - Number(inv.amount_paid);
    const issueTime = inv.issue_date ? new Date(inv.issue_date + 'T12:00:00').getTime() : 0;
    const dayDiff = issueTime > 0 ? Math.abs(importTime - issueTime) / dayMs : 999;
    const amountDiff = Math.abs(amount - balance);

    let score = 0;
    const reasons: string[] = [];

    // Amount-based score
    if (amountDiff < 0.005) { score += 50; reasons.push('amount exact'); }
    else if (amountDiff < 0.01) { score += 45; reasons.push('amount within $0.01'); }
    else if (amountDiff < 1.0) { score += 20; reasons.push('amount within $1'); }

    // Date-based score
    if (dayDiff <= 3) { score += 20; reasons.push('issued within 3 days'); }
    else if (dayDiff <= 7) { score += 10; reasons.push('issued within 7 days'); }

    // Client name in description
    if (inv.client_name && inv.client_name.length > 3 && desc.includes(inv.client_name.toLowerCase())) {
      score += 25;
      reasons.push('client name in description');
    }

    // Invoice number in description
    if (inv.invoice_number && desc.includes(String(inv.invoice_number).toLowerCase())) {
      score += 30;
      reasons.push('invoice # in description');
    }

    if (score >= 60) {
      candidates.push({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        client_id: inv.client_id,
        client_name: inv.client_name,
        total: Number(inv.total) || 0,
        amount_paid: Number(inv.amount_paid) || 0,
        balance_due: balance,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        score,
        reasons,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 3);
}
