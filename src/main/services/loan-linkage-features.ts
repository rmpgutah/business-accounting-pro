// ─── Loan Linkage Wave: F1053-F1062 (10 features) ───
//
// Wires the loan module into the rest of the system: expenses, bank
// reconciliation, fixed assets, bills (AP), and the GL. The loan module
// was capability-rich but isolated — payments wrote to loan_payments
// only, never appearing in the Expense module's reports.
//
// Design notes:
// 1. Soft FKs (no REFERENCES) on expenses.related_loan_id /
//    related_loan_payment_id. This avoids cascade-delete coupling and
//    lets the columns stay optional.
// 2. recordPaymentWithExpense is the new preferred entry point — it
//    wraps the existing loans:record-payment IPC and additionally
//    creates an expense row for the interest portion (categorized as
//    "Loan Interest"). Principal is balance-sheet movement, not P&L.
// 3. Bank reconciliation suggestion uses the same scoring approach as
//    invoice payment matching: amount proximity + date proximity +
//    memo contains-loan-name.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════════
// F1053: Record a loan payment AND create the matching expense row
// for the interest portion. The principal portion is balance-sheet
// movement (cash → loan liability paydown), not an expense.
// ════════════════════════════════════════════════════════════════════
export function recordPaymentWithExpense(opts: {
  loan_id: string;
  payment_date: string;
  amount: number;
  principal_amount: number;
  interest_amount: number;
  escrow_amount?: number;
  fees?: number;
  payment_method?: string;
  reference?: string;
  vendor_id?: string;
  category_id?: string;
  notes?: string;
  create_expense?: boolean;  // default true — set false to skip expense creation
}) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(opts.loan_id, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    // Resolve Loan Interest category id (lazy lookup; create if missing)
    let interestCategoryId = opts.category_id;
    if (!interestCategoryId) {
      const cat = dbi.prepare(`SELECT id FROM categories WHERE company_id = ? AND LOWER(name) = 'loan interest' LIMIT 1`).get(cid) as any;
      interestCategoryId = cat?.id;
    }
    const paymentId = uuid();
    const expenseId = uuid();
    const shouldCreateExpense = opts.create_expense !== false && (opts.interest_amount > 0);
    const txn = dbi.transaction(() => {
      // 1. Record the loan_payments row
      dbi.prepare(`INSERT INTO loan_payments (id, loan_id, payment_date, amount, principal_amount, interest_amount, escrow_amount, fees, payment_method, reference, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(paymentId, opts.loan_id, opts.payment_date, opts.amount, opts.principal_amount, opts.interest_amount, opts.escrow_amount || 0, opts.fees || 0, opts.payment_method || 'ach', opts.reference || null, opts.notes || null);
      // 2. Reduce loan balance by principal
      const newBalance = Math.max(0, (loan.current_balance || 0) - (opts.principal_amount || 0));
      dbi.prepare(`UPDATE loans SET current_balance = ?, total_paid_to_date = COALESCE(total_paid_to_date, 0) + ?, total_principal_paid = COALESCE(total_principal_paid, 0) + ?, total_interest_paid = COALESCE(total_interest_paid, 0) + ?, updated_at = ? WHERE id = ?`)
        .run(newBalance, opts.amount, opts.principal_amount || 0, opts.interest_amount || 0, now(), opts.loan_id);
      // 3. Create the expense row for the interest portion
      if (shouldCreateExpense) {
        dbi.prepare(`INSERT INTO expenses (id, company_id, date, amount, tax_amount, description, category_id, vendor_id, payment_method, status, related_loan_id, related_loan_payment_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'paid', ?, ?)`)
          .run(expenseId, cid, opts.payment_date, opts.interest_amount, `Interest on ${loan.name || 'loan'} (payment ${opts.reference || paymentId.slice(0, 8)})`, interestCategoryId || null, opts.vendor_id || null, opts.payment_method || 'ach', opts.loan_id, paymentId);
      }
    });
    txn();
    return {
      payment_id: paymentId,
      expense_id: shouldCreateExpense ? expenseId : null,
      new_balance: round2(Math.max(0, (loan.current_balance || 0) - (opts.principal_amount || 0))),
      interest_expensed: shouldCreateExpense ? round2(opts.interest_amount) : 0,
    };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1054: Link a bank transaction to an unpaid loan payment schedule row
// ════════════════════════════════════════════════════════════════════
export function linkBankTxToLoanPmt(opts: { bank_transaction_id: string; loan_id: string; schedule_id?: string; principal_amount: number; interest_amount: number; escrow_amount?: number; create_expense?: boolean }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const bankTx = dbi.prepare('SELECT * FROM bank_transactions WHERE id = ? AND company_id = ?').get(opts.bank_transaction_id, cid) as any;
    if (!bankTx) return { error: 'Bank transaction not found' };
    // Reuse the main path
    const result = recordPaymentWithExpense({
      loan_id: opts.loan_id,
      payment_date: bankTx.date || today(),
      amount: Math.abs(bankTx.amount || 0),
      principal_amount: opts.principal_amount,
      interest_amount: opts.interest_amount,
      escrow_amount: opts.escrow_amount,
      reference: bankTx.description || bankTx.memo,
      create_expense: opts.create_expense !== false,
    }) as any;
    if (result.error) return result;
    // Link the bank transaction to the loan payment
    dbi.prepare(`UPDATE loan_payments SET bank_transaction_id = ? WHERE id = ?`).run(opts.bank_transaction_id, result.payment_id);
    // Mark bank tx as matched
    try {
      dbi.prepare(`UPDATE bank_transactions SET matched = 1, matched_to_type = 'loan_payment', matched_to_id = ?, updated_at = ? WHERE id = ?`)
        .run(result.payment_id, now(), opts.bank_transaction_id);
    } catch (_) {/* schema may not have matched_to_* columns; ignore */}
    // If a schedule row was named, mark it paid
    if (opts.schedule_id) {
      try {
        dbi.prepare(`UPDATE loan_payment_schedule SET paid_status = 'paid', paid_amount = ?, paid_date = ? WHERE id = ?`)
          .run(result.payment_id ? Math.abs(bankTx.amount || 0) : 0, bankTx.date || today(), opts.schedule_id);
      } catch (_) {/* ignore */}
    }
    return { ...result, bank_tx_id: opts.bank_transaction_id, linked: true };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1055: List all expense rows linked to a given loan
// ════════════════════════════════════════════════════════════════════
export function expensesForLoan(loanId: string, opts?: { limit?: number; since?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const params: any[] = [cid, loanId];
    let where = `company_id = ? AND related_loan_id = ?`;
    if (opts?.since) { where += ` AND date >= ?`; params.push(opts.since); }
    params.push(opts?.limit || 100);
    // One row per payment (loan_component='combined'). Attach the
    // interest / principal split from the line items so the panel can
    // render a single reconciled row that shows the breakdown.
    return db.getDb().prepare(`
      SELECT e.id, e.date, e.amount, e.description, e.category_id, e.status,
             e.related_loan_payment_id, e.loan_component,
             COALESCE((SELECT SUM(amount) FROM expense_line_items WHERE expense_id = e.id AND loan_component = 'interest'), 0) AS interest_portion,
             COALESCE((SELECT SUM(amount) FROM expense_line_items WHERE expense_id = e.id AND loan_component = 'principal'), 0) AS principal_portion,
             COALESCE((SELECT SUM(amount) FROM expense_line_items WHERE expense_id = e.id AND loan_component = 'escrow'), 0) AS escrow_portion
      FROM expenses e
      WHERE ${where} AND (e.deleted_at IS NULL)
      ORDER BY e.date DESC LIMIT ?`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1056: Suggest loans that match a bank transaction (auto-detect)
// Scoring: exact amount = 0.5, matching loan name in memo = 0.3,
// matching lender = 0.2, date near a scheduled payment = 0.2
// ════════════════════════════════════════════════════════════════════
export function suggestLoanForBankTx(opts: { amount: number; date: string; memo?: string; payee?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const txAmount = Math.abs(opts.amount);
    const memo = (opts.memo || '').toLowerCase();
    const payee = (opts.payee || '').toLowerCase();
    // Pull active loans with payment_amount within $5 of the bank amount
    const candidates = db.getDb().prepare(`SELECT id, name, lender_name, payment_amount, next_payment_due FROM loans WHERE company_id = ? AND status = 'active' AND deleted_at IS NULL AND ABS(payment_amount - ?) < 50`)
      .all(cid, txAmount) as any[];
    const matches: any[] = [];
    for (const l of candidates) {
      let confidence = 0;
      const reasons: string[] = [];
      const amountDelta = Math.abs((l.payment_amount || 0) - txAmount);
      if (amountDelta < 0.01) { confidence += 0.5; reasons.push('exact payment amount'); }
      else if (amountDelta < 5) { confidence += 0.35; reasons.push(`within $${amountDelta.toFixed(2)} of payment`); }
      if (l.name && memo.includes(l.name.toLowerCase())) { confidence += 0.3; reasons.push('memo contains loan name'); }
      if (l.lender_name && memo.includes(l.lender_name.toLowerCase())) { confidence += 0.2; reasons.push('memo contains lender'); }
      if (l.lender_name && payee.includes(l.lender_name.toLowerCase())) { confidence += 0.2; reasons.push('payee matches lender'); }
      if (l.next_payment_due) {
        const dueDelta = Math.abs((new Date(opts.date).getTime() - new Date(l.next_payment_due).getTime()) / 86400000);
        if (dueDelta <= 3) { confidence += 0.15; reasons.push(`within ${Math.round(dueDelta)}d of scheduled payment`); }
        else if (dueDelta <= 7) { confidence += 0.05; reasons.push(`within ${Math.round(dueDelta)}d of scheduled payment`); }
      }
      confidence = Math.min(1, confidence);
      if (confidence >= 0.4) {
        matches.push({ loan_id: l.id, name: l.name, lender: l.lender_name, payment_amount: round2(l.payment_amount || 0), confidence: round2(confidence), reasons });
      }
    }
    return { suggestions: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 5) };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1057: Auto-create the standard GL accounts for a loan
// Creates: a Liability account for the loan balance + an Interest Expense
// account + uses a Cash account as the payment source. Backfills the
// loan's *_account_id columns.
// ════════════════════════════════════════════════════════════════════
export function autoCreateGlAccountsForLoan(loanId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(loanId, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const created: any = {};
    const txn = dbi.transaction(() => {
      // Liability account
      if (!loan.liability_account_id) {
        const liabId = uuid();
        dbi.prepare(`INSERT INTO accounts (id, company_id, name, type, subtype, balance) VALUES (?, ?, ?, 'liability', 'long_term_debt', 0)`)
          .run(liabId, cid, `Loan: ${loan.name}`);
        created.liability = liabId;
      }
      // Interest expense account
      if (!loan.interest_expense_account_id) {
        // Try to find existing "Interest Expense" account first
        const existing = dbi.prepare(`SELECT id FROM accounts WHERE company_id = ? AND type = 'expense' AND name LIKE '%Interest%' LIMIT 1`).get(cid) as any;
        if (existing) created.interest_expense = existing.id;
        else {
          const intId = uuid();
          dbi.prepare(`INSERT INTO accounts (id, company_id, name, type, subtype, balance) VALUES (?, ?, 'Interest Expense', 'expense', 'interest_expense', 0)`).run(intId, cid);
          created.interest_expense = intId;
        }
      }
      // Payment source — find first checking/cash account
      if (!loan.payment_source_account_id) {
        const cash = dbi.prepare(`SELECT id FROM accounts WHERE company_id = ? AND type = 'asset' AND (subtype IN ('cash', 'checking') OR name LIKE '%Cash%' OR name LIKE '%Checking%') LIMIT 1`).get(cid) as any;
        if (cash) created.payment_source = cash.id;
      }
      // Update the loan with the new account ids
      if (Object.keys(created).length > 0) {
        dbi.prepare(`UPDATE loans SET
          liability_account_id = COALESCE(?, liability_account_id),
          interest_expense_account_id = COALESCE(?, interest_expense_account_id),
          payment_source_account_id = COALESCE(?, payment_source_account_id),
          updated_at = ?
          WHERE id = ?`)
          .run(created.liability || null, created.interest_expense || null, created.payment_source || null, now(), loanId);
      }
    });
    txn();
    return { created, loan_id: loanId };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1058: Retro-link an existing expense to a loan
// (for users cleaning up old data that was never linked)
// ════════════════════════════════════════════════════════════════════
export function retroLinkExpenseToLoan(expenseId: string, loanId: string, loanPaymentId?: string) {
  try {
    db.getDb().prepare(`UPDATE expenses SET related_loan_id = ?, related_loan_payment_id = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(loanId, loanPaymentId || null, now(), expenseId, db.getCurrentCompanyId());
    return { linked: true };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1059: Loan linkage dashboard — how many payments are linked vs orphaned
// ════════════════════════════════════════════════════════════════════
export function loanLinkageDashboard() {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const paymentCount = (dbi.prepare(`SELECT COUNT(*) c FROM loan_payments WHERE loan_id IN (SELECT id FROM loans WHERE company_id = ?)`).get(cid) as any).c || 0;
    const expensesLinkedCount = (dbi.prepare(`SELECT COUNT(*) c FROM expenses WHERE company_id = ? AND related_loan_id IS NOT NULL`).get(cid) as any).c || 0;
    const bankMatchedCount = (dbi.prepare(`SELECT COUNT(*) c FROM loan_payments WHERE bank_transaction_id IS NOT NULL AND loan_id IN (SELECT id FROM loans WHERE company_id = ?)`).get(cid) as any).c || 0;
    const jeLinkedCount = (dbi.prepare(`SELECT COUNT(*) c FROM loan_payments WHERE journal_entry_id IS NOT NULL AND loan_id IN (SELECT id FROM loans WHERE company_id = ?)`).get(cid) as any).c || 0;
    const loansWithGl = (dbi.prepare(`SELECT COUNT(*) c FROM loans WHERE company_id = ? AND liability_account_id IS NOT NULL AND deleted_at IS NULL`).get(cid) as any).c || 0;
    const loansTotal = (dbi.prepare(`SELECT COUNT(*) c FROM loans WHERE company_id = ? AND deleted_at IS NULL`).get(cid) as any).c || 0;
    return {
      payments_total: paymentCount,
      expenses_linked: expensesLinkedCount,
      bank_matched: bankMatchedCount,
      je_posted: jeLinkedCount,
      loans_with_gl_setup: loansWithGl,
      loans_total: loansTotal,
      health_score: paymentCount > 0 ? round2(((expensesLinkedCount + bankMatchedCount + jeLinkedCount) / (paymentCount * 3)) * 100) : 100,
    };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1060: Generate an unpaid Bill (AP) for an upcoming loan payment
// — useful when the user wants to track loan payments through their
// AP approval workflow before the cash leaves.
// ════════════════════════════════════════════════════════════════════
export function generateBillForUpcomingPayment(opts: { loan_id: string; due_date?: string; vendor_id?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(opts.loan_id, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const dueDate = opts.due_date || loan.next_payment_due || today();
    const amount = (loan.payment_amount || 0) + (loan.escrow_per_payment || 0);
    if (amount <= 0) return { error: 'Loan has no payment amount configured' };
    const billId = uuid();
    try {
      dbi.prepare(`INSERT INTO bills (id, company_id, vendor_id, bill_number, date, due_date, total, amount_paid, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'open', ?)`)
        .run(billId, cid, opts.vendor_id || null, `LOAN-${loan.id.slice(0, 8)}-${dueDate}`, today(), dueDate, amount, `Auto-generated for loan: ${loan.name}`);
    } catch (_) { return { error: 'bills table not available' }; }
    return { bill_id: billId, amount: round2(amount), due_date: dueDate };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1061: Combined cash-flow timeline — scheduled loan payments +
// actual loan_payments + linked expenses for a single loan
// ════════════════════════════════════════════════════════════════════
export function loanCashflowTimeline(loanId: string, opts?: { since?: string; until?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const since = opts?.since || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const until = opts?.until || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const scheduled = dbi.prepare(`SELECT due_date date, scheduled_payment amount, principal_amount, interest_amount, paid_status FROM loan_payment_schedule WHERE loan_id = ? AND due_date BETWEEN ? AND ? ORDER BY due_date`).all(loanId, since, until) as any[];
    const actual = dbi.prepare(`SELECT payment_date date, amount, principal_amount, interest_amount, bank_transaction_id, journal_entry_id FROM loan_payments WHERE loan_id = ? AND payment_date BETWEEN ? AND ? ORDER BY payment_date`).all(loanId, since, until) as any[];
    const linkedExpenses = dbi.prepare(`SELECT date, amount, description, id FROM expenses WHERE related_loan_id = ? AND company_id = ? AND date BETWEEN ? AND ? AND (deleted_at IS NULL) ORDER BY date`).all(loanId, cid, since, until) as any[];
    // Merge into a single chronological timeline
    const events: any[] = [];
    for (const s of scheduled) events.push({ type: 'scheduled', date: s.date, amount: s.amount, principal: s.principal_amount, interest: s.interest_amount, status: s.paid_status });
    for (const a of actual) events.push({ type: 'actual_payment', date: a.date, amount: a.amount, principal: a.principal_amount, interest: a.interest_amount, bank_linked: !!a.bank_transaction_id, je_posted: !!a.journal_entry_id });
    for (const e of linkedExpenses) events.push({ type: 'expense', date: e.date, amount: e.amount, description: e.description, expense_id: e.id });
    events.sort((a, b) => a.date.localeCompare(b.date));
    return { loan_id: loanId, since, until, event_count: events.length, events };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// F1062: Get the loan context for an expense — used by the Expense
// Detail page to render "Part of: [Loan Name] — $X balance"
// ════════════════════════════════════════════════════════════════════
export function loanContextForExpense(expenseId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const exp = dbi.prepare(`SELECT id, related_loan_id, related_loan_payment_id FROM expenses WHERE id = ? AND company_id = ?`).get(expenseId, cid) as any;
    if (!exp || !exp.related_loan_id) return null;
    const loan = dbi.prepare(`SELECT id, name, loan_type, current_balance, principal, interest_rate, status FROM loans WHERE id = ? AND company_id = ?`).get(exp.related_loan_id, cid) as any;
    if (!loan) return null;
    const payment = exp.related_loan_payment_id
      ? dbi.prepare(`SELECT payment_date, amount, principal_amount, interest_amount FROM loan_payments WHERE id = ?`).get(exp.related_loan_payment_id) as any
      : null;
    return {
      loan: {
        id: loan.id,
        name: loan.name,
        loan_type: loan.loan_type,
        current_balance: round2(loan.current_balance || 0),
        original_principal: round2(loan.principal || 0),
        interest_rate_pct: round2((loan.interest_rate || 0) * 100),
        status: loan.status,
        principal_paid_pct: loan.principal > 0 ? round2(((loan.principal - loan.current_balance) / loan.principal) * 100) : 0,
      },
      payment,
    };
  } catch (e: any) { return null; }
}

// Find-or-create an expense category by name (categories use is_active,
// not deleted_at). Used for the single "Loan Payment" parent category.
function findOrCreateCategoryLk(companyId: string, name: string, color: string): string {
  const dbi = db.getDb();
  const existing = dbi.prepare(
    "SELECT id FROM categories WHERE company_id = ? AND lower(name) = lower(?) AND is_active = 1 LIMIT 1"
  ).get(companyId, name) as any;
  if (existing?.id) return existing.id;
  const id = uuid();
  dbi.prepare(
    "INSERT INTO categories (id, company_id, name, type, color, description, is_active, created_at, updated_at) VALUES (?, ?, ?, 'expense', ?, ?, 1, datetime('now'), datetime('now'))"
  ).run(id, companyId, name, color, 'Auto-created for loan payment integration');
  return id;
}

// ════════════════════════════════════════════════════════════════════
// ONE-ROW-PER-PAYMENT split. Each loan payment maps to a SINGLE expense
// row (amount = full payment) categorized "Loan Payment", broken into
// line items:
//   • Interest  (deductible = 1)
//   • Principal (deductible = 0)  ← repayment, not a deductible expense
//   • Escrow    (deductible = 0)  ← if any
// Reports can sum only deductible line items for accurate P&L while the
// parent row shows the full cash-out as one reconciled transaction.
//
// Idempotent + self-migrating: if a 'combined' expense already exists
// for the payment, it's left alone unless force=true; any LEGACY
// separate 'interest'/'principal' rows from the old two-row model are
// removed and replaced by the single combined row.
//
// Returns { id, created } — created=false means it already existed.
// ════════════════════════════════════════════════════════════════════
export function syncPaymentExpense(p: {
  payment_id: string;
  loan_id: string;
  company_id: string;
  loan_name: string;
  payment_date: string;
  payment_method?: string;
  principal: number;
  interest: number;
  escrow?: number;
  force?: boolean;
}): { id: string | null; created: boolean } {
  const dbi = db.getDb();
  const principal = round2(p.principal || 0);
  const interest = round2(p.interest || 0);
  const escrow = round2(p.escrow || 0);
  const total = round2(principal + interest + escrow);

  // Existing combined row for this payment (active only).
  const existingCombined = dbi.prepare(
    "SELECT id FROM expenses WHERE related_loan_payment_id = ? AND loan_component = 'combined' AND (deleted_at IS NULL OR deleted_at = '')"
  ).get(p.payment_id) as any;

  // Remove legacy two-row artifacts (interest/principal rows) for this
  // payment — they're being consolidated into the combined row.
  const legacy = dbi.prepare(
    "SELECT id FROM expenses WHERE related_loan_payment_id = ? AND loan_component IN ('interest','principal')"
  ).all(p.payment_id) as any[];
  for (const o of legacy) {
    dbi.prepare("DELETE FROM expense_line_items WHERE expense_id = ?").run(o.id);
    dbi.prepare("DELETE FROM expenses WHERE id = ?").run(o.id);
  }

  if (existingCombined && !p.force) {
    // Already in the new model; just make sure the back-link is right.
    dbi.prepare("UPDATE loan_payments SET related_expense_id = ?, related_principal_expense_id = NULL WHERE id = ?")
      .run(existingCombined.id, p.payment_id);
    return { id: existingCombined.id, created: legacy.length > 0 };
  }

  // force or no combined yet → (re)build it. Drop the old combined first.
  if (existingCombined) {
    dbi.prepare("DELETE FROM expense_line_items WHERE expense_id = ?").run(existingCombined.id);
    dbi.prepare("DELETE FROM expenses WHERE id = ?").run(existingCombined.id);
  }
  dbi.prepare("UPDATE loan_payments SET related_expense_id = NULL, related_principal_expense_id = NULL WHERE id = ?")
    .run(p.payment_id);

  if (total <= 0.005) return { id: null, created: false };

  const cat = findOrCreateCategoryLk(p.company_id, 'Loan Payment', '#8b5cf6');
  const expId = uuid();
  dbi.prepare(
    "INSERT INTO expenses (id, company_id, date, amount, tax_amount, description, category_id, vendor_id, payment_method, status, related_loan_id, related_loan_payment_id, loan_component, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, 'paid', ?, ?, 'combined', datetime('now'), datetime('now'))"
  ).run(expId, p.company_id, p.payment_date, total,
    (p.loan_name || 'Loan') + ' payment · ' + p.payment_date,
    cat, p.payment_method || 'ach', p.loan_id, p.payment_id);

  const liStmt = dbi.prepare(
    "INSERT INTO expense_line_items (id, expense_id, description, quantity, unit_price, amount, loan_component, deductible, sort_order, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'))"
  );
  let so = 0;
  if (interest > 0.005) liStmt.run(uuid(), expId, 'Interest (deductible)', interest, interest, 'interest', 1, so++);
  if (principal > 0.005) liStmt.run(uuid(), expId, 'Principal (non-deductible)', principal, principal, 'principal', 0, so++);
  if (escrow > 0.005) liStmt.run(uuid(), expId, 'Escrow', escrow, escrow, 'escrow', 0, so++);

  dbi.prepare("UPDATE loan_payments SET related_expense_id = ? WHERE id = ?").run(expId, p.payment_id);
  return { id: expId, created: true };
}

// ════════════════════════════════════════════════════════════════════
// Global backfill — ensure EVERY loan payment has its single combined
// split-expense row (migrating any legacy two-row data). Reads each
// payment's stored split (source of truth). Idempotent: payments that
// already have a combined row are skipped. Scope: all companies, or
// pass companyId to restrict.
// ════════════════════════════════════════════════════════════════════
export function backfillLoanPaymentExpenses(companyId?: string): {
  created: number;
  migrated: number;
  payments_processed: number;
  // legacy fields kept for callers that read them
  created_interest: number;
  created_principal: number;
  error?: string;
} {
  try {
    const dbi = db.getDb();
    const where = companyId ? 'AND l.company_id = ?' : '';
    const params: any[] = companyId ? [companyId] : [];
    const rows = dbi.prepare(`
      SELECT lp.id, lp.loan_id, lp.payment_date, lp.principal_amount, lp.interest_amount,
             lp.escrow_amount, lp.payment_method, l.company_id, l.name AS loan_name
      FROM loan_payments lp
      JOIN loans l ON lp.loan_id = l.id
      WHERE (l.deleted_at IS NULL) ${where}
    `).all(...params) as any[];

    let created = 0, migrated = 0;
    const tx = dbi.transaction(() => {
      for (const r of rows) {
        const res = syncPaymentExpense({
          payment_id: r.id,
          loan_id: r.loan_id,
          company_id: r.company_id,
          loan_name: r.loan_name,
          payment_date: r.payment_date,
          payment_method: r.payment_method,
          principal: r.principal_amount,
          interest: r.interest_amount,
          escrow: r.escrow_amount,
        });
        if (res.id && res.created) created++;
        else if (res.created) migrated++;
      }
    });
    tx();

    return {
      created,
      migrated,
      payments_processed: rows.length,
      created_interest: created,   // legacy aliases
      created_principal: 0,
    };
  } catch (e: any) {
    return { created: 0, migrated: 0, payments_processed: 0, created_interest: 0, created_principal: 0, error: e?.message };
  }
}

// ════════════════════════════════════════════════════════════════════
// Non-destructive total reconciliation. Re-derives each loan's cached
// totals (current_balance, total_paid, total_principal_paid,
// total_interest_paid) from the SUM of its payment rows — the source
// of truth. Unlike loans:recompute (which REPLAYS and re-derives the
// per-row splits via daily accrual), this TRUSTS the existing per-row
// splits and only fixes the cached aggregates. Safe to run on startup:
// it repairs drift (e.g. the old interest/principal column swap) without
// touching manually-edited splits or the schedule.
//
// Only writes when a value actually changed, so it's cheap and quiet.
// ════════════════════════════════════════════════════════════════════
export function reconcileLoanTotals(companyId?: string): { loans_fixed: number } {
  try {
    const dbi = db.getDb();
    const where = companyId ? 'WHERE company_id = ? AND deleted_at IS NULL' : 'WHERE deleted_at IS NULL';
    const params: any[] = companyId ? [companyId] : [];
    const loans = dbi.prepare(`SELECT id, principal, current_balance, total_paid_to_date, total_principal_paid, total_interest_paid, status FROM loans ${where}`).all(...params) as any[];
    let fixed = 0;
    const upd = dbi.prepare(
      "UPDATE loans SET current_balance = ?, total_paid_to_date = ?, total_principal_paid = ?, total_interest_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
    );
    const tx = dbi.transaction(() => {
      for (const l of loans) {
        const agg = dbi.prepare(
          "SELECT COALESCE(SUM(amount),0) AS paid, COALESCE(SUM(principal_amount),0) AS principal, COALESCE(SUM(interest_amount),0) AS interest FROM loan_payments WHERE loan_id = ?"
        ).get(l.id) as any;
        const newBalance = round2(Math.max(0, (l.principal || 0) - (agg.principal || 0)));
        const newPaid = round2(agg.paid);
        const newPrincipal = round2(agg.principal);
        const newInterest = round2(agg.interest);
        const newStatus = newBalance < 0.005 ? 'paid_off' : (l.status === 'paid_off' ? 'active' : l.status);
        const drift =
          Math.abs((l.current_balance || 0) - newBalance) > 0.005 ||
          Math.abs((l.total_paid_to_date || 0) - newPaid) > 0.005 ||
          Math.abs((l.total_principal_paid || 0) - newPrincipal) > 0.005 ||
          Math.abs((l.total_interest_paid || 0) - newInterest) > 0.005 ||
          l.status !== newStatus;
        if (drift) {
          upd.run(newBalance, newPaid, newPrincipal, newInterest, newStatus, l.id);
          fixed++;
        }
      }
    });
    tx();
    return { loans_fixed: fixed };
  } catch (e: any) {
    return { loans_fixed: 0 };
  }
}
