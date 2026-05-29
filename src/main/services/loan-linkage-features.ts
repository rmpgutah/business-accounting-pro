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
    return db.getDb().prepare(`SELECT id, date, amount, description, category_id, status, related_loan_payment_id, loan_component FROM expenses WHERE ${where} AND (deleted_at IS NULL) ORDER BY date DESC LIMIT ?`).all(...params);
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

// ════════════════════════════════════════════════════════════════════
// Global backfill — ensure EVERY loan payment already in the system has
// matching Interest + Principal expense rows in the Expenses ledger,
// properly categorized. Reads each payment's stored split (the source
// of truth that reconciles to the balance) rather than re-deriving.
//
// Idempotent: only processes payments missing a link
// (related_expense_id IS NULL / related_principal_expense_id IS NULL),
// so it's safe to run on every app launch and as a manual re-sync.
//
// Scope: ALL companies (joins loan_payments → loans for company_id).
// Pass a companyId to restrict.
// ════════════════════════════════════════════════════════════════════
export function backfillLoanPaymentExpenses(companyId?: string): {
  created_interest: number;
  created_principal: number;
  payments_processed: number;
  error?: string;
} {
  try {
    const dbi = db.getDb();

    // Pull payments that are missing at least one linked expense row.
    // JOIN loans for company_id + loan name; skip soft-deleted loans.
    const where = companyId ? 'AND l.company_id = ?' : '';
    const params: any[] = companyId ? [companyId] : [];
    const rows = dbi.prepare(`
      SELECT lp.id, lp.payment_date, lp.principal_amount, lp.interest_amount,
             lp.payment_method, lp.related_expense_id, lp.related_principal_expense_id,
             l.company_id, l.name AS loan_name
      FROM loan_payments lp
      JOIN loans l ON lp.loan_id = l.id
      WHERE (l.deleted_at IS NULL)
        AND (
          (lp.related_expense_id IS NULL AND lp.interest_amount > 0.005) OR
          (lp.related_principal_expense_id IS NULL AND lp.principal_amount > 0.005)
        )
        ${where}
    `).all(...params) as any[];

    if (rows.length === 0) {
      return { created_interest: 0, created_principal: 0, payments_processed: 0 };
    }

    // Per-company category cache so we find-or-create each category once.
    const catCache: Record<string, { interest?: string; principal?: string }> = {};
    const findOrCreateCategory = (cid: string, name: string, color: string, slot: 'interest' | 'principal'): string => {
      if (!catCache[cid]) catCache[cid] = {};
      const cached = catCache[cid][slot];
      if (cached) return cached;
      const existing = dbi.prepare(
        "SELECT id FROM categories WHERE company_id = ? AND lower(name) = lower(?) AND is_active = 1 LIMIT 1"
      ).get(cid, name) as any;
      let id = existing?.id;
      if (!id) {
        id = uuid();
        dbi.prepare(
          "INSERT INTO categories (id, company_id, name, type, color, description, is_active, created_at, updated_at) VALUES (?, ?, ?, 'expense', ?, ?, 1, datetime('now'), datetime('now'))"
        ).run(id, cid, name, color, 'Auto-created for loan payment integration');
      }
      catCache[cid][slot] = id;
      return id;
    };

    const insertExpense = dbi.prepare(
      "INSERT INTO expenses (id, company_id, date, amount, tax_amount, description, category_id, vendor_id, payment_method, status, related_loan_id, related_loan_payment_id, loan_component, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, 'paid', NULL, ?, ?, datetime('now'), datetime('now'))"
    );
    const linkInterest = dbi.prepare("UPDATE loan_payments SET related_expense_id = ? WHERE id = ?");
    const linkPrincipal = dbi.prepare("UPDATE loan_payments SET related_principal_expense_id = ? WHERE id = ?");

    let createdInterest = 0, createdPrincipal = 0;

    const tx = dbi.transaction(() => {
      for (const r of rows) {
        const method = r.payment_method || 'ach';
        if (r.related_expense_id == null && r.interest_amount > 0.005) {
          const cat = findOrCreateCategory(r.company_id, 'Interest Expense', '#f59e0b', 'interest');
          const exId = uuid();
          insertExpense.run(exId, r.company_id, r.payment_date, round2(r.interest_amount),
            (r.loan_name || 'Loan') + ' · interest on ' + r.payment_date,
            cat, method, r.id, 'interest');
          linkInterest.run(exId, r.id);
          createdInterest++;
        }
        if (r.related_principal_expense_id == null && r.principal_amount > 0.005) {
          const cat = findOrCreateCategory(r.company_id, 'Loan Principal', '#6366f1', 'principal');
          const exId = uuid();
          insertExpense.run(exId, r.company_id, r.payment_date, round2(r.principal_amount),
            (r.loan_name || 'Loan') + ' · principal on ' + r.payment_date,
            cat, method, r.id, 'principal');
          linkPrincipal.run(exId, r.id);
          createdPrincipal++;
        }
      }
    });
    tx();

    return {
      created_interest: createdInterest,
      created_principal: createdPrincipal,
      payments_processed: rows.length,
    };
  } catch (e: any) {
    return { created_interest: 0, created_principal: 0, payments_processed: 0, error: e?.message };
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
