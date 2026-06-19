// src/main/ipc/loans.ts
//
// Loan-tracking IPC handlers, extracted from the ipc/index.ts monolith.
// The Loan Calculator service owns the math; these handlers own CRUD +
// cross-table operations (regenerate schedule on save, record payment +
// update running totals atomically, etc.).
//
// Registered from registerIpcHandlers() via registerLoanIpc(ipcMain,
// scheduleAutoBackup). scheduleAutoBackup is injected because the auto-backup
// debounce timer lives in ipc/index.ts.

import { IpcMain, shell } from 'electron';
import { v4 as uuid } from 'uuid';
import path from 'path';
import * as db from '../database';
import { saveHTMLAsPDF } from '../services/print-preview';

// Shared helpers that still live in ipc/index.ts are injected so this module
// doesn't import the monolith (which would be circular):
//  • scheduleAutoBackup — 30s auto-backup debounce timer
//  • findClosedPeriod    — closed-accounting-period guard (nested closure)
//  • postJournalEntry    — GL posting helper (module-level in index.ts)
interface LoanIpcDeps {
  scheduleAutoBackup: () => void;
  findClosedPeriod: (companyId: string, date: string) => { id: string; period_start: string; period_end: string; close_reason: string } | null;
  postJournalEntry: (
    dbInstance: ReturnType<typeof db.getDb>,
    companyId: string,
    date: string,
    description: string,
    lines: Array<{ nameHint: string; debit: number; credit: number; note?: string }>,
  ) => void;
}

export function registerLoanIpc(ipcMain: IpcMain, deps: LoanIpcDeps): void {
  const { scheduleAutoBackup, findClosedPeriod, postJournalEntry } = deps;
  // ─── LOAN TRACKING ─────────────────────────────────────
  // The Loan Calculator service owns the math; IPC handlers own
  // CRUD + cross-table operations (regenerate schedule on save,
  // record payment + update running totals atomically, etc.)

  ipcMain.handle('loans:list', (_event, opts?: { status?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const sql = "SELECT * FROM loans WHERE company_id = ? AND deleted_at IS NULL " +
                  (opts?.status ? "AND status = ? " : "") +
                  "ORDER BY created_at DESC";
      const params: any[] = [cid];
      if (opts?.status) params.push(opts.status);
      return db.getDb().prepare(sql).all(...params);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('loans:get', (_event, { id }: { id: string }) => {
    try {
      const loan = db.getById('loans', id);
      if (!loan) return { error: 'Not found' };
      const schedule = db.getDb().prepare(
        "SELECT * FROM loan_payment_schedule WHERE loan_id = ? ORDER BY payment_number"
      ).all(id);
      const payments = db.getDb().prepare(
        "SELECT * FROM loan_payments WHERE loan_id = ? ORDER BY payment_date DESC"
      ).all(id);
      const events = db.getDb().prepare(
        "SELECT * FROM loan_events WHERE loan_id = ? ORDER BY event_date DESC"
      ).all(id);
      return { loan, schedule, payments, events };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Save (create or update). Always regenerates the schedule from
  // scratch — the scheduled rows are derived data, not user-edited.
  // For UPDATE: existing scheduled rows are deleted, new ones
  // generated; existing actual payments are preserved and re-linked
  // to the new schedule rows by payment_number where possible.
  ipcMain.handle('loans:save', (_event, payload: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const dbi = db.getDb();
      const { generateSchedule, periodicPayment, periodicRate, paymentsForTerm } = require('../services/loan-calculator');

      // Compute the level payment for storage on the loan row, using the loan's
      // ACTUAL payment frequency. The old code hardcoded a monthly rate
      // (interest_rate/12) and monthly count (term_months), so the stored
      // payment_amount — shown in the loan list and summed into "Monthly Burn" —
      // was a monthly figure that disagreed with the real biweekly/weekly/
      // quarterly schedule the amortization table generated.
      const freq = payload.payment_frequency || 'monthly';
      const r = periodicRate(payload.interest_rate || 0, freq);
      const n = paymentsForTerm(payload.term_months || 1, freq);
      const computed = periodicPayment(payload.principal || 0, r, n);

      const loanData = {
        ...payload,
        company_id: cid,
        payment_amount: Math.round(computed * 100) / 100,
        // Initialize totals on create; preserve on update.
        current_balance: payload.id ? undefined : payload.principal,
        total_paid_to_date: payload.id ? undefined : 0,
        total_interest_paid: payload.id ? undefined : 0,
        total_principal_paid: payload.id ? undefined : 0,
      };
      // Strip undefined keys so PRAGMA-aware update doesn't barf.
      Object.keys(loanData).forEach((k) => loanData[k] === undefined && delete loanData[k]);

      const tx = dbi.transaction(() => {
        let loanId: string;
        if (payload.id) {
          db.update('loans', payload.id, loanData);
          loanId = payload.id;
          // Wipe and regen schedule
          dbi.prepare("DELETE FROM loan_payment_schedule WHERE loan_id = ?").run(loanId);
        } else {
          const created = db.create('loans', loanData);
          loanId = created.id;
        }

        // Generate the new amortization schedule.
        const rows = generateSchedule({
          principal: loanData.principal,
          annual_rate: loanData.interest_rate,
          term_months: loanData.term_months,
          first_payment_date: loanData.first_payment_date,
          payment_frequency: loanData.payment_frequency || 'monthly',
          amortization_type: loanData.amortization_type || 'standard',
          balloon_amount: loanData.balloon_amount || 0,
          escrow_per_payment: loanData.escrow_per_payment || 0,
        });

        const insertSched = dbi.prepare(
          "INSERT INTO loan_payment_schedule (id, loan_id, payment_number, due_date, scheduled_payment, principal_amount, interest_amount, escrow_amount, remaining_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const row of rows) {
          insertSched.run(uuid(), loanId, row.payment_number, row.due_date, row.scheduled_payment,
            row.principal_amount, row.interest_amount, row.escrow_amount, row.remaining_balance);
        }

        // Update next_payment_due to first unpaid scheduled date.
        const nextDue = rows[0]?.due_date || null;
        dbi.prepare("UPDATE loans SET next_payment_due = ? WHERE id = ?").run(nextDue, loanId);

        return loanId;
      });
      const id = tx();
      return db.getById('loans', id);
    } catch (err: any) {
      return { error: err?.message || 'Save failed' };
    }
  });

  // Edit an existing payment record. The user can override any
  // field (date, amount, principal/interest/escrow split, method,
  // reference, notes, extra-principal flag). After update, loan
  // running totals are RE-AGGREGATED as the simple sum of every
  // payment row — this respects the user's manual overrides rather
  // than re-allocating via replay. Use the "Recompute" button if
  // you want the system to re-derive splits automatically.
  ipcMain.handle('loans:update-payment', (_event, payload: {
    payment_id: string;
    payment_date?: string;
    amount?: number;
    principal_amount?: number;
    interest_amount?: number;
    escrow_amount?: number;
    payment_method?: string;
    reference?: string;
    notes?: string;
    is_extra_principal?: boolean;
  }) => {
    try {
      const dbi = db.getDb();
      const existing = dbi.prepare(
        "SELECT id, loan_id FROM loan_payments WHERE id = ?"
      ).get(payload.payment_id) as any;
      if (!existing) return { error: 'Payment not found' };

      // D3: closed-period check on the (possibly new) payment date
      const cid = db.getCurrentCompanyId();
      if (cid && payload.payment_date) {
        const period = findClosedPeriod(cid, payload.payment_date);
        if (period) {
          return { error: 'Cannot edit: ' + payload.payment_date + ' falls in a closed accounting period (' +
            period.period_start + ' to ' + period.period_end + ').' };
        }
      }

      // Build dynamic UPDATE for only the supplied fields.
      const sets: string[] = [];
      const vals: any[] = [];
      const maybe = (col: string, v: any, transform?: (x: any) => any) => {
        if (v === undefined) return;
        sets.push(col + ' = ?');
        vals.push(transform ? transform(v) : v);
      };
      maybe('payment_date', payload.payment_date);
      maybe('amount', payload.amount);
      maybe('principal_amount', payload.principal_amount);
      maybe('interest_amount', payload.interest_amount);
      maybe('escrow_amount', payload.escrow_amount);
      maybe('payment_method', payload.payment_method);
      maybe('reference', payload.reference);
      maybe('notes', payload.notes);
      maybe('is_extra_principal', payload.is_extra_principal, (v) => (v ? 1 : 0));
      if (sets.length === 0) return { error: 'No fields to update' };

      vals.push(payload.payment_id);
      dbi.prepare(`UPDATE loan_payments SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

      // Rebuild the single combined split-expense from the updated
      // payment values so the one-row expense + its Interest/Principal
      // line items stay aligned with the loan ledger.
      const linked = dbi.prepare(
        "SELECT loan_id, interest_amount, principal_amount, escrow_amount, payment_date, payment_method FROM loan_payments WHERE id = ?"
      ).get(payload.payment_id) as any;
      if (linked && cid) {
        try {
          const ln = db.getById('loans', linked.loan_id) as any;
          require('../services/loan-linkage-features').syncPaymentExpense({
            payment_id: payload.payment_id,
            loan_id: linked.loan_id,
            company_id: cid,
            loan_name: ln?.name || 'Loan',
            payment_date: linked.payment_date,
            payment_method: linked.payment_method || 'ach',
            principal: linked.principal_amount,
            interest: linked.interest_amount,
            escrow: linked.escrow_amount,
            force: true,
          });
        } catch (syncErr: any) {
          console.warn('linked expense rebuild failed:', syncErr?.message);
        }
      }

      // Re-aggregate loan totals from the sum of all payment rows.
      const agg = dbi.prepare(
        "SELECT COALESCE(SUM(amount),0) AS paid, COALESCE(SUM(principal_amount),0) AS principal, COALESCE(SUM(interest_amount),0) AS interest FROM loan_payments WHERE loan_id = ?"
      ).get(existing.loan_id) as any;
      const loan = db.getById('loans', existing.loan_id) as any;
      const newBalance = Math.max(0, (loan.principal || 0) - (agg.principal || 0));
      const newStatus = newBalance < 0.005 ? 'paid_off' : loan.status;
      dbi.prepare(
        "UPDATE loans SET current_balance = ?, total_paid_to_date = ?, total_principal_paid = ?, total_interest_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(newBalance, agg.paid, agg.principal, agg.interest, newStatus, existing.loan_id);

      return { ok: true, totals: { paid: agg.paid, principal: agg.principal, interest: agg.interest, current_balance: newBalance } };
    } catch (err: any) {
      return { error: err?.message || 'Update failed' };
    }
  });

  // Delete a payment record. Re-aggregates loan totals from
  // remaining payment rows. Does NOT delete the associated JE —
  // user should reverse that manually if posted, or use a recompute
  // workflow that recreates JEs.
  ipcMain.handle('loans:delete-payment', (_event, paymentId: string) => {
    try {
      const dbi = db.getDb();
      const existing = dbi.prepare(
        "SELECT id, loan_id, schedule_id, related_expense_id, related_principal_expense_id FROM loan_payments WHERE id = ?"
      ).get(paymentId) as any;
      if (!existing) return { error: 'Payment not found' };

      // Cascade: soft-delete the combined split-expense for this payment
      // (covers both the new single-row model and any legacy two-row
      // artifacts). Soft-delete preserves the audit trail for closed
      // periods while hiding from active lists.
      try {
        dbi.prepare(
          "UPDATE expenses SET deleted_at = datetime('now') WHERE related_loan_payment_id = ? AND loan_component IN ('combined','interest','principal')"
        ).run(paymentId);
      } catch (cascErr: any) {
        console.warn('cascade delete of linked expense failed:', cascErr?.message);
      }

      dbi.prepare("DELETE FROM loan_payments WHERE id = ?").run(paymentId);

      // If the deleted payment was linked to a schedule row, recompute
      // that row's paid_status.
      if (existing.schedule_id) {
        const remainingPaid = dbi.prepare(
          "SELECT COALESCE(SUM(amount),0) AS s FROM loan_payments WHERE schedule_id = ?"
        ).get(existing.schedule_id) as any;
        const sched = dbi.prepare(
          "SELECT scheduled_payment FROM loan_payment_schedule WHERE id = ?"
        ).get(existing.schedule_id) as any;
        if (sched) {
          const status = remainingPaid.s + 0.005 >= sched.scheduled_payment
            ? 'paid'
            : (remainingPaid.s > 0 ? 'partial' : 'pending');
          dbi.prepare(
            "UPDATE loan_payment_schedule SET paid_amount = ?, paid_status = ?, paid_date = ? WHERE id = ?"
          ).run(remainingPaid.s, status, status === 'paid' ? null : null, existing.schedule_id);
        }
      }

      // Re-aggregate loan totals.
      const agg = dbi.prepare(
        "SELECT COALESCE(SUM(amount),0) AS paid, COALESCE(SUM(principal_amount),0) AS principal, COALESCE(SUM(interest_amount),0) AS interest FROM loan_payments WHERE loan_id = ?"
      ).get(existing.loan_id) as any;
      const loan = db.getById('loans', existing.loan_id) as any;
      const newBalance = Math.max(0, (loan.principal || 0) - (agg.principal || 0));
      dbi.prepare(
        "UPDATE loans SET current_balance = ?, total_paid_to_date = ?, total_principal_paid = ?, total_interest_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(newBalance, agg.paid, agg.principal, agg.interest,
        newBalance < 0.005 ? 'paid_off' : loan.status, existing.loan_id);

      return { ok: true, totals: { paid: agg.paid, principal: agg.principal, interest: agg.interest, current_balance: newBalance } };
    } catch (err: any) {
      return { error: err?.message || 'Delete failed' };
    }
  });

  // Comprehensive loan REPAIR. One button that makes a loan internally
  // consistent again. It:
  //   1. Replays every payment with correct daily-accrual splits.
  //   2. Re-derives loan totals (FIXED: interest/principal were swapped
  //      into the wrong columns here previously — that's why "Interest
  //      Paid" showed the principal sum).
  //   3. Auto-corrects amortization_type when a term loan was mis-saved
  //      as interest_only (its stored payment clearly amortizes).
  //   4. Regenerates the forward schedule from the CURRENT balance over
  //      the remaining term, so the schedule reflects reality after
  //      payments instead of the stale origination snapshot.
  //   5. Backfills missing linked Interest/Principal expense rows for
  //      payments recorded before cross-posting existed.
  // Idempotent — safe to run repeatedly.
  ipcMain.handle('loans:recompute', (_event, loanId: string) => {
    try {
      const dbi = db.getDb();
      const loan = db.getById('loans', loanId) as any;
      if (!loan) return { error: 'Loan not found' };
      const { replayPayments, generateSchedule, periodicPayment } = require('../services/loan-calculator');

      const payments = dbi.prepare(
        "SELECT id, payment_date, amount, is_extra_principal, escrow_amount, payment_method, related_expense_id, related_principal_expense_id FROM loan_payments WHERE loan_id = ? ORDER BY payment_date"
      ).all(loanId) as any[];

      const result = replayPayments({
        origination_date: loan.origination_date,
        origination_principal: loan.principal,
        annual_rate: loan.interest_rate,
        payments,
      });

      // ── Decide the correct amortization type ──
      // If marked interest_only but the stored level payment is >10%
      // above a pure interest-only payment, it's really a term loan
      // that was mis-saved → switch to 'standard'.
      const rMonthly = (loan.interest_rate || 0) / 12;
      const curBal = result.totals.current_balance;
      const interestOnlyPmt = curBal * rMonthly;
      let amType = loan.amortization_type || 'standard';
      if (amType === 'interest_only' && (loan.payment_amount || 0) > interestOnlyPmt * 1.1) {
        amType = 'standard';
      }

      // ── Remaining payment count to amortize the current balance at the
      //    loan's level payment (guards against payment <= interest). ──
      const pmt = loan.payment_amount || periodicPayment(curBal, rMonthly, loan.term_months || 1);
      let remainingN = loan.term_months || 1;
      if (curBal <= 0.01) {
        remainingN = 0;
      } else if (amType === 'standard' && rMonthly > 0 && pmt > interestOnlyPmt) {
        remainingN = Math.max(1, Math.ceil(
          -Math.log(1 - (curBal * rMonthly) / pmt) / Math.log(1 + rMonthly)
        ));
      }

      const expCid = loan.company_id;
      const lkSvc = require('../services/loan-linkage-features');

      const tx = dbi.transaction(() => {
        // 1. Correct each payment's principal/interest/escrow split.
        const updatePayment = dbi.prepare(
          "UPDATE loan_payments SET principal_amount = ?, interest_amount = ?, escrow_amount = ? WHERE id = ?"
        );
        for (const c of result.corrected) {
          updatePayment.run(c.principal, c.interest, c.escrow, c.id);
        }

        // 2. Fix loan totals — CORRECT column/value alignment.
        const newStatus = result.totals.current_balance < 0.005 ? 'paid_off' : (loan.status === 'paid_off' ? 'active' : loan.status);
        dbi.prepare(
          "UPDATE loans SET current_balance = ?, total_paid_to_date = ?, total_interest_paid = ?, total_principal_paid = ?, amortization_type = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(
          result.totals.current_balance,
          result.totals.total_paid_to_date,
          result.totals.total_interest_paid,    // interest → interest column
          result.totals.total_principal_paid,   // principal → principal column
          amType,
          newStatus,
          loanId
        );

        // 3. Regenerate the forward schedule from the current balance.
        dbi.prepare("DELETE FROM loan_payment_schedule WHERE loan_id = ?").run(loanId);
        if (remainingN > 0 && curBal > 0.01) {
          const rows = generateSchedule({
            principal: curBal,
            annual_rate: loan.interest_rate,
            term_months: remainingN,
            first_payment_date: loan.next_payment_due || loan.first_payment_date,
            payment_frequency: loan.payment_frequency || 'monthly',
            amortization_type: amType,
            balloon_amount: loan.balloon_amount || 0,
            escrow_per_payment: loan.escrow_per_payment || 0,
          });
          const insertSched = dbi.prepare(
            "INSERT INTO loan_payment_schedule (id, loan_id, payment_number, due_date, scheduled_payment, principal_amount, interest_amount, escrow_amount, remaining_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          );
          for (const row of rows) {
            insertSched.run(uuid(), loanId, row.payment_number, row.due_date, row.scheduled_payment,
              row.principal_amount, row.interest_amount, row.escrow_amount, row.remaining_balance);
          }
          dbi.prepare("UPDATE loans SET next_payment_due = ? WHERE id = ?").run(rows[0]?.due_date || null, loanId);
        }

        // 4. Rebuild each payment's single combined split-expense from
        //    the corrected values (force=true so edited splits propagate).
        let backfilled = 0;
        for (const c of result.corrected) {
          const pRow = payments.find((p) => p.id === c.id);
          const res = lkSvc.syncPaymentExpense({
            payment_id: c.id,
            loan_id: loanId,
            company_id: expCid,
            loan_name: loan.name || 'Loan',
            payment_date: c.payment_date,
            payment_method: pRow?.payment_method || 'ach',
            principal: c.principal,
            interest: c.interest,
            escrow: c.escrow,
            force: true,
          });
          if (res?.id) backfilled++;
        }
        return backfilled;
      });
      const backfilledCount = tx();
      return {
        ok: true,
        totals: result.totals,
        corrected_count: result.corrected.length,
        amortization_type: amType,
        schedule_payments: remainingN,
        expenses_backfilled: backfilledCount,
      };
    } catch (err: any) {
      return { error: err?.message || 'Recompute failed' };
    }
  });

  // Skip a monthly payment — marks the next pending schedule row as
  // 'skipped', advances next_payment_due to the FOLLOWING row, and
  // logs the reason. Interest still accrues during the skipped month
  // (it's not forgiven — it adds to the remaining balance or extends
  // the term depending on the lender's policy). The user can optionally
  // choose to extend the term by 1 month or capitalize the skipped
  // interest into the balance.
  ipcMain.handle('loans:skip-payment', (_event, payload: {
    loan_id: string;
    reason?: string;
    capitalize_interest?: boolean; // add the month's interest to balance
  }) => {
    try {
      const dbi = db.getDb();
      const loan = db.getById('loans', payload.loan_id) as any;
      if (!loan) return { error: 'Loan not found' };
      if (loan.status !== 'active') return { error: 'Can only skip payments on active loans' };

      // Find the next pending scheduled row.
      const nextRow = dbi.prepare(
        "SELECT * FROM loan_payment_schedule WHERE loan_id = ? AND paid_status = 'pending' ORDER BY payment_number LIMIT 1"
      ).get(payload.loan_id) as any;
      if (!nextRow) return { error: 'No pending payments to skip' };

      // Mark it as skipped.
      dbi.prepare(
        "UPDATE loan_payment_schedule SET paid_status = 'skipped', paid_date = ?, paid_amount = 0 WHERE id = ?"
      ).run(new Date().toISOString().slice(0, 10), nextRow.id);

      // Optionally capitalize the skipped month's interest into the balance
      // (this is how most skip-a-payment programs work — interest accrues).
      if (payload.capitalize_interest) {
        const newBalance = (loan.current_balance || 0) + (nextRow.interest_amount || 0);
        dbi.prepare(
          "UPDATE loans SET current_balance = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(newBalance, payload.loan_id);
      }

      // Advance next_payment_due to the next pending row after the skipped one.
      const followingRow = dbi.prepare(
        "SELECT due_date FROM loan_payment_schedule WHERE loan_id = ? AND paid_status = 'pending' ORDER BY payment_number LIMIT 1"
      ).get(payload.loan_id) as any;
      dbi.prepare(
        "UPDATE loans SET next_payment_due = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(followingRow?.due_date || null, payload.loan_id);

      // Log the skip as a loan event if the table exists.
      try {
        dbi.prepare(
          "INSERT INTO loan_events (id, loan_id, event_type, event_date, description, created_at) VALUES (?, ?, 'payment_skipped', ?, ?, datetime('now'))"
        ).run(uuid(), payload.loan_id, new Date().toISOString().slice(0, 10),
          `Payment #${nextRow.payment_number} (${nextRow.due_date}, $${(nextRow.scheduled_payment || 0).toFixed(2)}) skipped. Reason: ${payload.reason || 'Not specified'}. Interest ${payload.capitalize_interest ? 'capitalized into balance' : 'deferred'}.`);
      } catch { /* loan_events may not have all columns */ }

      // Create a notification about the skip.
      try {
        const cid = db.getCurrentCompanyId();
        if (cid) {
          db.create('notifications', {
            company_id: cid, type: 'info',
            title: `Payment skipped: ${loan.name}`,
            message: `Payment #${nextRow.payment_number} ($${(nextRow.scheduled_payment || 0).toFixed(2)}) on ${nextRow.due_date} was skipped. Next due: ${followingRow?.due_date || 'N/A'}. Reason: ${payload.reason || 'Not specified'}.`,
            entity_type: 'loan', entity_id: payload.loan_id, is_read: 0,
          });
        }
      } catch { /* non-fatal */ }

      scheduleAutoBackup();
      return {
        ok: true,
        skipped_payment_number: nextRow.payment_number,
        skipped_due_date: nextRow.due_date,
        skipped_amount: nextRow.scheduled_payment,
        interest_capitalized: payload.capitalize_interest ? nextRow.interest_amount : 0,
        new_next_due: followingRow?.due_date || null,
      };
    } catch (err: any) {
      return { error: err?.message || 'Skip failed' };
    }
  });

  // Note: lk:* (Loan Linkage) handlers are registered later in this
  // file under "Loan Linkage Wave (F1053-F1062)". The API wrappers in
  // src/renderer/lib/api.ts use the destructured-object convention
  // they expect (e.g. { loan_id, opts }).

  // Record an actual payment. Splits into principal/interest, links
  // to the next pending scheduled row, updates loan running totals.
  //
  // Optional principal_amount/interest_amount/escrow_amount fields:
  // if ANY of the three are explicitly provided (not undefined), they
  // override the auto-computed daily-accrual split. Use this when the
  // bank statement gives you exact split figures and you want them
  // honored verbatim. Leave them undefined to let the system compute.
  ipcMain.handle('loans:record-payment', (_event, payload: {
    loan_id: string;
    payment_date: string;
    amount: number;
    is_extra_principal?: boolean;
    payment_method?: string;
    reference?: string;
    notes?: string;
    principal_amount?: number;
    interest_amount?: number;
    escrow_amount?: number;
  }) => {
    try {
      const dbi = db.getDb();
      const loan = db.getById('loans', payload.loan_id) as any;
      if (!loan) return { error: 'Loan not found' };

      // D3: refuse to record a payment whose date falls in a closed period
      const _cidLoan = db.getCurrentCompanyId();
      if (_cidLoan) {
        const period = findClosedPeriod(_cidLoan, payload.payment_date);
        if (period) {
          return { error: 'Cannot record payment: ' + payload.payment_date + ' falls in a closed accounting period (' +
            period.period_start + ' to ' + period.period_end + '). Reopen the period in Settings.' };
        }
      }

      const { splitPaymentDaily } = require('../services/loan-calculator');
      // Days since last payment (or since first_payment_date if no prior
      // payments). Daily accrual matches how the bank actually charges
      // interest — much more accurate than naive monthly periodic.
      const priorRow = dbi.prepare(
        "SELECT payment_date FROM loan_payments WHERE loan_id = ? ORDER BY payment_date DESC LIMIT 1"
      ).get(payload.loan_id) as any;
      const lastDate = priorRow?.payment_date || loan.origination_date;
      const days = Math.max(0, Math.round(
        (new Date(payload.payment_date + 'T12:00:00').getTime() -
         new Date(lastDate + 'T12:00:00').getTime()) / 86400000
      ));
      // Carry forward any deferred interest from prior partial payments.
      const deferredRow = dbi.prepare(
        "SELECT SUM(interest_amount) AS paid_interest FROM loan_payments WHERE loan_id = ?"
      ).get(payload.loan_id) as any;
      // Theoretical interest accrued since origination minus interest
      // actually paid = deferred interest still owed.
      const totalDaysSinceOrig = Math.max(0, Math.round(
        (new Date(payload.payment_date + 'T12:00:00').getTime() -
         new Date(loan.origination_date + 'T12:00:00').getTime()) / 86400000
      ));
      // We pass prior_deferred = 0 here because splitPaymentDaily already
      // accrues for `days` since last payment. If the prior payment was a
      // partial that left deferred interest, that was already booked then.
      // User-provided splits take priority over auto-calculated ones.
      // We accept ANY of the three being supplied — missing fields fall
      // back to the auto-split values (so user can override just one).
      const hasManualSplit =
        payload.principal_amount !== undefined ||
        payload.interest_amount !== undefined ||
        payload.escrow_amount !== undefined;
      const autoSplit = payload.is_extra_principal
        ? {
            principal: payload.amount,
            interest: 0,
            escrow: 0,
            new_balance: Math.max(0, loan.current_balance - payload.amount),
            deferred_interest: 0,
            accrued_interest: 0,
          }
        : splitPaymentDaily(
            loan.current_balance,
            payload.amount,
            loan.interest_rate,
            days,
            0,
            loan.escrow_per_payment || 0
          );
      const split = hasManualSplit
        ? (() => {
            const p = payload.principal_amount !== undefined ? payload.principal_amount : autoSplit.principal;
            const i = payload.interest_amount !== undefined ? payload.interest_amount : autoSplit.interest;
            const e = payload.escrow_amount !== undefined ? payload.escrow_amount : autoSplit.escrow;
            return {
              principal: p,
              interest: i,
              escrow: e,
              new_balance: Math.max(0, loan.current_balance - p),
              deferred_interest: 0,
              accrued_interest: autoSplit.accrued_interest,
            };
          })()
        : autoSplit;
      void totalDaysSinceOrig; void deferredRow;  // reserved for future deferred-interest tracking

      // Find the next pending scheduled row to link to (skipped for
      // extra-principal payments — those don't fulfill a scheduled
      // installment).
      let scheduleId: string | null = null;
      if (!payload.is_extra_principal) {
        const next = dbi.prepare(
          "SELECT id, paid_amount, scheduled_payment FROM loan_payment_schedule WHERE loan_id = ? AND paid_status != 'paid' ORDER BY payment_number LIMIT 1"
        ).get(payload.loan_id) as any;
        if (next) {
          scheduleId = next.id;
          const newPaid = (Number(next.paid_amount) || 0) + payload.amount;
          const newStatus = newPaid + 0.005 >= Number(next.scheduled_payment) ? 'paid' : 'partial';
          dbi.prepare(
            "UPDATE loan_payment_schedule SET paid_amount = ?, paid_status = ?, paid_date = ? WHERE id = ?"
          ).run(newPaid, newStatus, newStatus === 'paid' ? payload.payment_date : null, next.id);
        }
      }

      const pid = uuid();
      dbi.prepare(
        "INSERT INTO loan_payments (id, loan_id, schedule_id, payment_date, amount, principal_amount, interest_amount, escrow_amount, payment_method, reference, is_extra_principal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        pid, payload.loan_id, scheduleId, payload.payment_date,
        payload.amount, split.principal, split.interest, split.escrow,
        payload.payment_method || 'ach', payload.reference || '',
        payload.is_extra_principal ? 1 : 0, payload.notes || ''
      );

      // ─── ONE-ROW EXPENSE SPLIT ───────────────────────────────
      // The payment maps to a SINGLE "Loan Payment" expense (full
      // amount) with Interest + Principal (+ Escrow) line items —
      // interest deductible, principal/escrow not. Opt out via
      // skip_expense_creation. Delegated to the shared helper so
      // record / edit / backfill all build the same structure.
      const skipExpense = (payload as any).skip_expense_creation === true;
      const expCid = db.getCurrentCompanyId();
      if (!skipExpense && expCid) {
        try {
          require('../services/loan-linkage-features').syncPaymentExpense({
            payment_id: pid,
            loan_id: payload.loan_id,
            company_id: expCid,
            loan_name: loan.name || 'Loan',
            payment_date: payload.payment_date,
            payment_method: payload.payment_method || 'ach',
            principal: split.principal,
            interest: split.interest,
            escrow: split.escrow,
            force: true,
          });
        } catch (linkErr: any) {
          console.warn('loans:record-payment expense split failed:', linkErr?.message);
        }
      }

      // Update loan totals.
      const newTotalPaid = (Number(loan.total_paid_to_date) || 0) + payload.amount;
      const newTotalInterest = (Number(loan.total_interest_paid) || 0) + split.interest;
      const newTotalPrincipal = (Number(loan.total_principal_paid) || 0) + split.principal;
      const newStatus = split.new_balance < 0.005 ? 'paid_off' : loan.status;
      // Compute new next_payment_due.
      const nextRow = dbi.prepare(
        "SELECT due_date FROM loan_payment_schedule WHERE loan_id = ? AND paid_status != 'paid' ORDER BY payment_number LIMIT 1"
      ).get(payload.loan_id) as any;

      dbi.prepare(
        "UPDATE loans SET current_balance = ?, total_paid_to_date = ?, total_interest_paid = ?, total_principal_paid = ?, status = ?, next_payment_due = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(
        split.new_balance, newTotalPaid, newTotalInterest, newTotalPrincipal,
        newStatus, nextRow?.due_date || null, payload.loan_id
      );

      // ─── GL auto-posting ─────────────────────────────────
      // If the loan has GL accounts configured, post a JE:
      //   DR  Loan Liability       (principal portion)
      //   DR  Interest Expense     (interest portion)
      //   DR  Escrow Asset         (escrow portion, if any)
      //   CR  Cash / Bank          (full payment amount)
      // Falls back to name-hints if specific account IDs aren't set
      // — same hints other modules use ("Loans Payable", "Interest
      // Expense", "Cash"). Skips entirely if no Cash/Bank account
      // can be resolved (caller hasn't set up COA yet).
      const cid = db.getCurrentCompanyId();
      let journalEntryId: string | null = null;
      if (cid && payload.amount > 0) {
        try {
          // Build resolved-or-hinted lines. The DR side and the CR side
          // must balance to the penny — use the actual split values.
          const lines: Array<{ accountId?: string; nameHint: string; debit: number; credit: number; note?: string }> = [];

          // Principal: DR loan liability (or "Loans Payable" by hint)
          if (split.principal > 0) {
            lines.push({
              accountId: loan.liability_account_id || undefined,
              nameHint: 'Loans Payable',
              debit: split.principal,
              credit: 0,
              note: `Loan ${loan.name} principal payment`,
            });
          }
          // Interest: DR interest expense (or "Interest Expense" by hint)
          if (split.interest > 0) {
            lines.push({
              accountId: loan.interest_expense_account_id || undefined,
              nameHint: 'Interest Expense',
              debit: split.interest,
              credit: 0,
              note: `Loan ${loan.name} interest`,
            });
          }
          // Escrow: DR escrow asset (or fall back to liability account)
          if (split.escrow > 0) {
            lines.push({
              nameHint: 'Escrow',
              debit: split.escrow,
              credit: 0,
              note: `Loan ${loan.name} escrow`,
            });
          }
          // Cash: CR payment source account (or "Cash" by hint)
          lines.push({
            accountId: loan.payment_source_account_id || undefined,
            nameHint: 'Cash',
            debit: 0,
            credit: payload.amount,
            note: `Loan ${loan.name} payment`,
          });

          // Use the existing postJournalEntry helper. We need to map
          // the explicit accountIds through the same path — easiest
          // approach: if accountId is set, fetch its name and use as
          // the hint (since postJournalEntry resolves by hint).
          const resolvedLines = lines.map((l) => {
            if (l.accountId) {
              const acc = dbi.prepare("SELECT name FROM accounts WHERE id = ?").get(l.accountId) as any;
              if (acc?.name) return { ...l, nameHint: acc.name };
            }
            return l;
          });

          // Snapshot the highest entry_number BEFORE posting so we
          // can capture the JE id for back-linking.
          const before = dbi.prepare(
            "SELECT id FROM journal_entries WHERE company_id = ? ORDER BY created_at DESC LIMIT 1"
          ).get(cid) as any;

          postJournalEntry(dbi, cid, payload.payment_date,
            `Loan payment · ${loan.name}`,
            resolvedLines.map((l) => ({
              nameHint: l.nameHint,
              debit: l.debit,
              credit: l.credit,
              note: l.note,
            }))
          );

          // Find the newly-created JE (the one created after our snapshot).
          const after = dbi.prepare(
            "SELECT id FROM journal_entries WHERE company_id = ? ORDER BY created_at DESC LIMIT 1"
          ).get(cid) as any;
          if (after?.id && after.id !== before?.id) {
            journalEntryId = after.id;
            // Back-link the loan_payment to the JE
            dbi.prepare(
              "UPDATE loan_payments SET journal_entry_id = ? WHERE id = ?"
            ).run(journalEntryId, pid);
          }
        } catch (err) {
          // GL posting is best-effort — payment was recorded
          // successfully; if posting fails the user can rebuild GL
          // later via the existing Rebuild GL feature.
          console.warn('[loan payment] GL auto-post failed:', err);
        }
      }

      scheduleAutoBackup();
      return { ok: true, payment_id: pid, split, journal_entry_id: journalEntryId };
    } catch (err: any) {
      return { error: err?.message || 'Payment recording failed' };
    }
  });

  // Compute payoff scenario for a loan (what if I pay $X extra/period).
  ipcMain.handle('loans:payoff-scenario', (_event, { loan_id, extra_per_payment }: { loan_id: string; extra_per_payment: number }) => {
    try {
      const loan = db.getById('loans', loan_id) as any;
      if (!loan) return { error: 'Loan not found' };
      const { payoffScenario } = require('../services/loan-calculator');
      // Use current_balance as the principal — caller is asking
      // "from here, what happens?" — not "from origination".
      return payoffScenario({
        principal: loan.current_balance,
        annual_rate: loan.interest_rate,
        term_months: loan.term_months, // best estimate of remaining
        first_payment_date: loan.next_payment_due || loan.first_payment_date,
        payment_frequency: loan.payment_frequency,
        amortization_type: 'standard',
      }, extra_per_payment);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Aggregate amortization across ALL active loans — used by the
  // debt dashboard to show "if I make every payment as scheduled,
  // how does my total debt decline over time?"
  ipcMain.handle('loans:aggregate-schedule', (_event, opts?: { months?: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const dbi = db.getDb();
      const months = Math.max(12, Math.min(360, opts?.months || 60));

      // Sum scheduled rows by year-month across all active loans.
      const rows = dbi.prepare(`
        SELECT
          substr(s.due_date, 1, 7) AS month,
          COALESCE(SUM(s.principal_amount), 0) AS total_principal,
          COALESCE(SUM(s.interest_amount), 0) AS total_interest,
          COALESCE(SUM(s.scheduled_payment), 0) AS total_payment
        FROM loan_payment_schedule s
        JOIN loans l ON l.id = s.loan_id
        WHERE l.company_id = ?
          AND l.status = 'active'
          AND COALESCE(l.deleted_at, '') = ''
          AND s.due_date >= date('now')
        GROUP BY substr(s.due_date, 1, 7)
        ORDER BY month
        LIMIT ?
      `).all(cid, months) as any[];

      // Compute total outstanding at each point — start from current
      // balance, subtract cumulative principal scheduled.
      const totalCurrent = (dbi.prepare(
        "SELECT COALESCE(SUM(current_balance), 0) AS bal FROM loans WHERE company_id = ? AND status = 'active' AND COALESCE(deleted_at, '') = ''"
      ).get(cid) as any)?.bal || 0;

      let runningBalance = totalCurrent;
      const projection = rows.map((r) => {
        runningBalance -= r.total_principal;
        return {
          month: r.month,
          principal: Math.round(r.total_principal * 100) / 100,
          interest: Math.round(r.total_interest * 100) / 100,
          payment: Math.round(r.total_payment * 100) / 100,
          balance: Math.round(Math.max(0, runningBalance) * 100) / 100,
        };
      });

      return projection;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Mark scheduled payments as overdue when due_date passed without
  // a 'paid' or 'partial' status. Returns count flipped + per-loan
  // detail for the dashboard banner. Idempotent — re-running has
  // no effect on already-flagged rows.
  ipcMain.handle('loans:check-overdue', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { overdue_count: 0, by_loan: [] };
      const dbi = db.getDb();
      const today = new Date().toISOString().slice(0, 10);

      // Find pending scheduled rows past due
      const overdueRows = dbi.prepare(`
        SELECT s.id, s.loan_id, s.due_date, s.scheduled_payment, l.name AS loan_name,
          CAST(julianday(?) - julianday(s.due_date) AS INTEGER) AS days_late
        FROM loan_payment_schedule s
        JOIN loans l ON l.id = s.loan_id
        WHERE l.company_id = ?
          AND l.status = 'active'
          AND COALESCE(l.deleted_at, '') = ''
          AND s.paid_status IN ('pending', 'partial')
          AND s.due_date < ?
      `).all(today, cid, today) as any[];

      // Aggregate by loan
      const byLoan: Record<string, { loan_id: string; loan_name: string; count: number; total: number; max_days: number }> = {};
      for (const r of overdueRows) {
        const key = r.loan_id;
        if (!byLoan[key]) byLoan[key] = { loan_id: r.loan_id, loan_name: r.loan_name, count: 0, total: 0, max_days: 0 };
        byLoan[key].count++;
        byLoan[key].total += Number(r.scheduled_payment) || 0;
        byLoan[key].max_days = Math.max(byLoan[key].max_days, r.days_late || 0);
      }

      return {
        overdue_count: overdueRows.length,
        by_loan: Object.values(byLoan),
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Aggregate stats across all active loans for the Debt Dashboard.
  ipcMain.handle('loans:aggregate', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return null;
      const dbi = db.getDb();
      const stats = dbi.prepare(`
        SELECT
          COUNT(*) AS loan_count,
          COALESCE(SUM(principal), 0) AS total_principal,
          COALESCE(SUM(current_balance), 0) AS total_outstanding,
          COALESCE(SUM(total_paid_to_date), 0) AS total_paid,
          COALESCE(SUM(total_interest_paid), 0) AS total_interest_paid,
          COALESCE(SUM(payment_amount), 0) AS total_monthly_payment
        FROM loans
        WHERE company_id = ? AND deleted_at IS NULL AND status = 'active'
      `).get(cid) as any;

      // Next 30 days of scheduled payments across all loans
      const upcoming = dbi.prepare(`
        SELECT s.due_date, s.scheduled_payment, l.name AS loan_name
        FROM loan_payment_schedule s
        JOIN loans l ON l.id = s.loan_id
        WHERE l.company_id = ? AND l.deleted_at IS NULL AND l.status = 'active'
          AND s.paid_status != 'paid'
          AND s.due_date <= date('now', '+30 days')
        ORDER BY s.due_date
        LIMIT 50
      `).all(cid);

      return { stats, upcoming };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Generate a printable amortization-schedule PDF for one loan.
  // Returns the path of the saved PDF so the caller can offer
  // open-in-Finder or revealing the file.
  ipcMain.handle('loans:export-pdf', async (_event, { loan_id }: { loan_id: string }) => {
    try {
      const dbi = db.getDb();
      const loan = db.getById('loans', loan_id) as any;
      if (!loan) return { error: 'Loan not found' };
      const company = db.getById('companies', loan.company_id) as any;
      const schedule = dbi.prepare(
        "SELECT * FROM loan_payment_schedule WHERE loan_id = ? ORDER BY payment_number"
      ).all(loan_id) as any[];

      // Build HTML for the schedule. Reuses the print-templates
      // baseStyles via a generic shell so the styling matches other
      // printed documents.
      const fmt = (n: number) => '$' + (Number(n) || 0).toFixed(2);
      const fmtNum = (n: number) => (Number(n) || 0).toLocaleString('en-US');
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const totalInterest = schedule.reduce((s: number, r: any) => s + Number(r.interest_amount), 0);
      const totalPrincipal = schedule.reduce((s: number, r: any) => s + Number(r.principal_amount), 0);
      const totalPayments = schedule.reduce((s: number, r: any) => s + Number(r.scheduled_payment), 0);

      const escapeHtml = (s: string) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Amortization Schedule — ${escapeHtml(loan.name)}</title>
<style>
  @page { size: letter; margin: 0.55in 0.5in 0.65in 0.5in; @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: 'Inter', sans-serif; font-size: 8.5pt; color: #94a3b8; } }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.5; }
  .header { border-bottom: 3px solid #0f172a; padding-bottom: 14px; margin-bottom: 18px; }
  .co-name { font-size: 22px; font-weight: 800; }
  .doc-title { font-size: 16px; font-weight: 700; color: #475569; margin-top: 6px; }
  .doc-meta { font-size: 11px; color: #64748b; margin-top: 8px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 18px; }
  .stat { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; }
  .stat-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 4px; }
  .stat-value { font-size: 14px; font-weight: 800; font-family: 'SF Mono', Menlo, monospace; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 6px 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; border-bottom: 2px solid #0f172a; background: #f8fafc; text-align: right; }
  th:first-child, th:nth-child(2) { text-align: left; }
  td { padding: 5px 8px; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: 'SF Mono', Menlo, monospace; }
  td:first-child { text-align: right; color: #94a3b8; width: 40px; }
  td:nth-child(2) { text-align: left; font-family: 'SF Mono', Menlo, monospace; }
  tr:nth-child(even) td { background: #fafbfc; }
  .totals-row td { font-weight: 800; border-top: 2px solid #0f172a; background: #f1f5f9; }
  tfoot { display: table-footer-group; }
  thead { display: table-header-group; }
</style></head>
<body>
<div class="header">
  <div class="co-name">${escapeHtml(company?.name || 'Company')}</div>
  <div class="doc-title">Loan Amortization Schedule</div>
  <div class="doc-meta">
    <strong>${escapeHtml(loan.name)}</strong>
    ${loan.lender_name ? ' · ' + escapeHtml(loan.lender_name) : ''}
    ${loan.account_number ? ' · ••••' + escapeHtml(loan.account_number.slice(-4)) : ''}
    · Generated ${today}
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-label">Principal</div><div class="stat-value">${fmt(loan.principal)}</div></div>
  <div class="stat"><div class="stat-label">Rate</div><div class="stat-value">${(loan.interest_rate * 100).toFixed(3)}%</div></div>
  <div class="stat"><div class="stat-label">Term</div><div class="stat-value">${fmtNum(loan.term_months)} mo</div></div>
  <div class="stat"><div class="stat-label">Payment</div><div class="stat-value">${fmt(loan.payment_amount)}</div></div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-label">Total Payments</div><div class="stat-value">${fmt(totalPayments)}</div></div>
  <div class="stat"><div class="stat-label">Total Principal</div><div class="stat-value" style="color:#16a34a">${fmt(totalPrincipal)}</div></div>
  <div class="stat"><div class="stat-label">Total Interest</div><div class="stat-value" style="color:#dc2626">${fmt(totalInterest)}</div></div>
  <div class="stat"><div class="stat-label">Schedule Rows</div><div class="stat-value">${schedule.length}</div></div>
</div>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Due Date</th>
      <th>Payment</th>
      <th>Principal</th>
      <th>Interest</th>
      <th>Balance</th>
    </tr>
  </thead>
  <tbody>
    ${schedule.map((r: any) => `
      <tr>
        <td>${r.payment_number}</td>
        <td>${r.due_date}</td>
        <td>${fmt(r.scheduled_payment)}</td>
        <td style="color:#16a34a">${fmt(r.principal_amount)}</td>
        <td style="color:#dc2626">${fmt(r.interest_amount)}</td>
        <td>${fmt(r.remaining_balance)}</td>
      </tr>
    `).join('')}
    <tr class="totals-row">
      <td></td><td>Totals</td>
      <td>${fmt(totalPayments)}</td>
      <td style="color:#16a34a">${fmt(totalPrincipal)}</td>
      <td style="color:#dc2626">${fmt(totalInterest)}</td>
      <td></td>
    </tr>
  </tbody>
</table>
</body></html>`;

      const filename = (loan.name || 'loan').replace(/[^a-zA-Z0-9-]/g, '-') + '-amortization.pdf';
      const result = await saveHTMLAsPDF(html, 'Amortization Schedule', { defaultFilename: filename });
      return result;
    } catch (err: any) {
      return { error: err?.message || 'PDF export failed' };
    }
  });

  // Delete a loan (soft delete via the existing deleted_at flow).
  ipcMain.handle('loans:delete', (_event, { id }: { id: string }) => {
    try {
      db.getDb().prepare(
        "UPDATE loans SET deleted_at = datetime('now') WHERE id = ?"
      ).run(id);
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
}
