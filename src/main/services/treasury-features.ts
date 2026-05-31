// ─── Batch 7: Banking, Treasury, Multi-Currency (F91-F110) ───
//
// 20 features covering cash position, forecasting, FX rates/revaluation,
// wire transfers, ACH batches, bank-fee auto-classification, fuzzy match
// audit, stop payments, pending deposits, petty cash, treasury investments,
// letters of credit, loan covenants, sweep rules, inter-company transfers,
// credit-card statements, lockbox imports, positive-pay files.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);

// ════════════════════════════════════════════════════════════════
// F91. Cash position snapshot
// ════════════════════════════════════════════════════════════════
export function captureCashPosition(companyId: string, snapshotDate?: string): any {
  const dbi = db.getDb();
  const date = snapshotDate || today();
  // Roll up all bank/cash accounts to a flat total
  const accounts = dbi.prepare(`
    SELECT id, name, currency, COALESCE(currency, 'USD') AS cur
      FROM accounts
     WHERE company_id = ?
       AND (account_type = 'bank' OR account_type = 'cash' OR LOWER(name) LIKE '%cash%' OR LOWER(name) LIKE '%bank%')
       AND (deleted_at IS NULL OR deleted_at = '')
  `).all(companyId) as any[];

  let totalCash = 0;
  const breakdown: any[] = [];
  for (const acct of accounts) {
    const bal = computeAccountBalance(companyId, acct.id);
    breakdown.push({ id: acct.id, name: acct.name, currency: acct.cur, balance: bal });
    totalCash += bal;
  }
  const totalAR = (dbi.prepare(`SELECT COALESCE(SUM(total - amount_paid), 0) AS s FROM invoices WHERE company_id = ? AND status NOT IN ('paid','void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any).s;
  const totalAP = (dbi.prepare(`SELECT COALESCE(SUM(total - amount_paid), 0) AS s FROM bills WHERE company_id = ? AND status NOT IN ('paid','void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any).s;

  const id = uuid();
  dbi.prepare(`
    INSERT INTO cash_position_snapshots
      (id, company_id, snapshot_date, base_currency, total_cash, total_ar, total_ap, accounts_breakdown, created_at)
    VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, snapshot_date) DO UPDATE SET
      total_cash = excluded.total_cash,
      total_ar = excluded.total_ar,
      total_ap = excluded.total_ap,
      accounts_breakdown = excluded.accounts_breakdown
  `).run(id, companyId, date, totalCash, totalAR, totalAP, JSON.stringify(breakdown), now());
  return { id, snapshot_date: date, total_cash: totalCash, total_ar: totalAR, total_ap: totalAP, breakdown };
}

function computeAccountBalance(companyId: string, accountId: string): number {
  const dbi = db.getDb();
  const row = dbi.prepare(`
    SELECT COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS bal
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE jel.account_id = ?
       AND je.company_id = ?
       AND je.is_posted = 1
  `).get(accountId, companyId) as any;
  return row?.bal || 0;
}

export function listCashPositionSnapshots(companyId: string, opts?: { from?: string; to?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.from) { where += ' AND snapshot_date >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND snapshot_date <= ?'; params.push(opts.to); }
  const sql = `SELECT * FROM cash_position_snapshots WHERE ${where} ORDER BY snapshot_date DESC LIMIT ${Math.min(opts?.limit || 90, 365)}`;
  return dbi.prepare(sql).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F92. Cash forecast
// ════════════════════════════════════════════════════════════════
export function rebuildCashForecast(companyId: string, daysAhead: number = 90): { generated: number; horizon_days: number } {
  const dbi = db.getDb();
  const forecastDate = today();
  // Clear old forecast
  dbi.prepare(`DELETE FROM cash_forecast_lines WHERE company_id = ? AND forecast_date = ?`).run(companyId, forecastDate);

  // Outgoing: bills with due_date in window
  const bills = dbi.prepare(`
    SELECT id, due_date, (total - amount_paid) AS balance FROM bills
     WHERE company_id = ? AND status NOT IN ('paid','void','cancelled')
       AND (deleted_at IS NULL OR deleted_at = '')
       AND due_date IS NOT NULL AND due_date <= date('now', '+' || ? || ' days')
  `).all(companyId, daysAhead) as any[];
  // Incoming: invoices with due_date in window
  const invoices = dbi.prepare(`
    SELECT id, due_date, (total - amount_paid) AS balance FROM invoices
     WHERE company_id = ? AND status NOT IN ('paid','void','cancelled')
       AND (deleted_at IS NULL OR deleted_at = '')
       AND due_date IS NOT NULL AND due_date <= date('now', '+' || ? || ' days')
  `).all(companyId, daysAhead) as any[];

  let count = 0;
  const insert = dbi.prepare(`
    INSERT INTO cash_forecast_lines (id, company_id, forecast_date, projection_date, source_type, source_id, amount, direction, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = dbi.transaction(() => {
    for (const b of bills) {
      insert.run(uuid(), companyId, forecastDate, b.due_date, 'bill', b.id, b.balance || 0, 'out', 0.85, now());
      count++;
    }
    for (const i of invoices) {
      insert.run(uuid(), companyId, forecastDate, i.due_date, 'invoice', i.id, i.balance || 0, 'in', 0.7, now());
      count++;
    }
  });
  tx();
  return { generated: count, horizon_days: daysAhead };
}

export function getCashForecast(companyId: string, opts?: { days?: number }): any[] {
  const dbi = db.getDb();
  const days = Math.min(opts?.days || 90, 365);
  return dbi.prepare(`
    SELECT projection_date,
           SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END) AS cash_in,
           SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END) AS cash_out,
           COUNT(*) AS line_count
      FROM cash_forecast_lines
     WHERE company_id = ?
       AND projection_date <= date('now', '+' || ? || ' days')
       AND projection_date >= date('now', '-1 day')
     GROUP BY projection_date
     ORDER BY projection_date ASC
  `).all(companyId, days) as any[];
}

// ════════════════════════════════════════════════════════════════
// F93. FX rates store
// ════════════════════════════════════════════════════════════════
export function upsertFxRate(rate: { rate_date: string; from_currency: string; to_currency: string; rate: number; source?: string }): any {
  const dbi = db.getDb();
  const id = uuid();
  const source = rate.source || 'manual';
  dbi.prepare(`
    INSERT INTO fx_rates (id, rate_date, from_currency, to_currency, rate, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rate_date, from_currency, to_currency, source) DO UPDATE SET rate = excluded.rate
  `).run(id, rate.rate_date, rate.from_currency.toUpperCase(), rate.to_currency.toUpperCase(), rate.rate, source, now());
  return { id, ...rate };
}

export function getFxRate(from: string, to: string, asOfDate?: string): number | null {
  if (from === to) return 1.0;
  const dbi = db.getDb();
  const date = asOfDate || today();
  const row = dbi.prepare(`
    SELECT rate FROM fx_rates
     WHERE from_currency = ? AND to_currency = ?
       AND rate_date <= ?
     ORDER BY rate_date DESC LIMIT 1
  `).get(from.toUpperCase(), to.toUpperCase(), date) as any;
  return row?.rate ?? null;
}

export function listFxRates(opts?: { from?: string; to?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [];
  let where = '1=1';
  if (opts?.from) { where += ' AND from_currency = ?'; params.push(opts.from.toUpperCase()); }
  if (opts?.to) { where += ' AND to_currency = ?'; params.push(opts.to.toUpperCase()); }
  return dbi.prepare(`SELECT * FROM fx_rates WHERE ${where} ORDER BY rate_date DESC LIMIT ${Math.min(opts?.limit || 200, 2000)}`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F94. FX revaluation
// ════════════════════════════════════════════════════════════════
export function runFxRevaluation(companyId: string, asOfDate?: string, createdBy?: string): any {
  const dbi = db.getDb();
  const date = asOfDate || today();
  // Find all foreign-currency open invoices and bills
  const invoices = dbi.prepare(`
    SELECT id, currency, exchange_rate, (total - amount_paid) AS balance FROM invoices
     WHERE company_id = ? AND currency != 'USD' AND status NOT IN ('paid','void','cancelled')
       AND (deleted_at IS NULL OR deleted_at = '')
  `).all(companyId) as any[];
  const bills = dbi.prepare(`
    SELECT id, currency, exchange_rate, (total - amount_paid) AS balance FROM bills
     WHERE company_id = ? AND currency != 'USD' AND status NOT IN ('paid','void','cancelled')
       AND (deleted_at IS NULL OR deleted_at = '')
  `).all(companyId) as any[];

  let totalGain = 0;
  let totalLoss = 0;
  const breakdown: any[] = [];
  for (const inv of invoices) {
    const currentRate = getFxRate(inv.currency, 'USD', date);
    if (!currentRate || !inv.exchange_rate) continue;
    const oldUSD = (inv.balance || 0) * inv.exchange_rate;
    const newUSD = (inv.balance || 0) * currentRate;
    const delta = newUSD - oldUSD;
    breakdown.push({ entity: 'invoice', id: inv.id, currency: inv.currency, balance: inv.balance, old_rate: inv.exchange_rate, new_rate: currentRate, delta_usd: delta });
    if (delta > 0) totalGain += delta; else totalLoss += Math.abs(delta);
  }
  for (const bl of bills) {
    const currentRate = getFxRate(bl.currency, 'USD', date);
    if (!currentRate || !bl.exchange_rate) continue;
    const oldUSD = (bl.balance || 0) * bl.exchange_rate;
    const newUSD = (bl.balance || 0) * currentRate;
    const delta = newUSD - oldUSD;
    // For a liability (bill), gain when delta < 0
    breakdown.push({ entity: 'bill', id: bl.id, currency: bl.currency, balance: bl.balance, old_rate: bl.exchange_rate, new_rate: currentRate, delta_usd: delta });
    if (delta < 0) totalGain += Math.abs(delta); else totalLoss += delta;
  }

  const id = uuid();
  dbi.prepare(`
    INSERT INTO fx_revaluation_runs
      (id, company_id, revaluation_date, base_currency, total_unrealized_gain, total_unrealized_loss, breakdown_json, is_posted, created_at, created_by)
    VALUES (?, ?, ?, 'USD', ?, ?, ?, 0, ?, ?)
  `).run(id, companyId, date, totalGain, totalLoss, JSON.stringify(breakdown), now(), createdBy || null);
  return { id, revaluation_date: date, total_unrealized_gain: totalGain, total_unrealized_loss: totalLoss, breakdown_count: breakdown.length };
}

export function listFxRevaluationRuns(companyId: string, limit: number = 50): any[] {
  const dbi = db.getDb();
  return dbi.prepare(`SELECT * FROM fx_revaluation_runs WHERE company_id = ? ORDER BY revaluation_date DESC LIMIT ?`).all(companyId, Math.min(limit, 500)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F96. Wire transfers
// ════════════════════════════════════════════════════════════════
export function upsertWireTransfer(w: any): any {
  const dbi = db.getDb();
  const id = w.id || uuid();
  if (w.id) {
    dbi.prepare(`
      UPDATE wire_transfers SET
        transfer_date = ?, from_account_id = ?, to_beneficiary = ?, amount = ?,
        currency = ?, wire_fee = ?, intermediary_bank = ?, reference_number = ?,
        status = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(w.transfer_date, w.from_account_id, w.to_beneficiary, w.amount, w.currency || 'USD',
           w.wire_fee || 0, w.intermediary_bank, w.reference_number, w.status || 'pending', w.notes, now(), w.id);
  } else {
    dbi.prepare(`
      INSERT INTO wire_transfers
        (id, company_id, transfer_date, from_account_id, to_beneficiary, amount, currency,
         wire_fee, intermediary_bank, reference_number, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, w.company_id, w.transfer_date, w.from_account_id, w.to_beneficiary, w.amount,
           w.currency || 'USD', w.wire_fee || 0, w.intermediary_bank, w.reference_number,
           w.status || 'pending', w.notes, now(), now());
  }
  return { id, ...w };
}

export function listWireTransfers(companyId: string, opts?: { status?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM wire_transfers WHERE ${where} ORDER BY transfer_date DESC LIMIT ${Math.min(opts?.limit || 100, 1000)}`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F97. ACH batches
// ════════════════════════════════════════════════════════════════
export function createAchBatch(b: { company_id: string; batch_date: string; effective_date: string; bank_account_id?: string; sec_code?: string; company_entry_description?: string; items: Array<{ payee_name: string; routing_number: string; account_number_last4: string; account_type?: string; amount: number; direction?: string; addenda?: string; bill_id?: string }> }): any {
  const dbi = db.getDb();
  const batchId = uuid();
  let totalDebit = 0, totalCredit = 0;
  for (const it of b.items) {
    if ((it.direction || 'credit') === 'debit') totalDebit += it.amount;
    else totalCredit += it.amount;
  }
  dbi.prepare(`
    INSERT INTO ach_batches
      (id, company_id, batch_date, effective_date, bank_account_id, sec_code, company_entry_description,
       total_debit, total_credit, item_count, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(batchId, b.company_id, b.batch_date, b.effective_date, b.bank_account_id || null,
         b.sec_code || 'CCD', b.company_entry_description || '', totalDebit, totalCredit,
         b.items.length, now());

  const insertItem = dbi.prepare(`
    INSERT INTO ach_batch_items (id, batch_id, payee_name, routing_number, account_number_last4,
      account_type, amount, direction, addenda, bill_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = dbi.transaction(() => {
    for (const it of b.items) {
      insertItem.run(uuid(), batchId, it.payee_name, it.routing_number, it.account_number_last4,
                     it.account_type || 'checking', it.amount, it.direction || 'credit',
                     it.addenda || null, it.bill_id || null, now());
    }
  });
  tx();
  return { id: batchId, item_count: b.items.length, total_debit: totalDebit, total_credit: totalCredit };
}

export function listAchBatches(companyId: string, opts?: { status?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM ach_batches WHERE ${where} ORDER BY batch_date DESC LIMIT ${Math.min(opts?.limit || 50, 500)}`).all(...params) as any[];
}

export function getAchBatchItems(batchId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM ach_batch_items WHERE batch_id = ? ORDER BY created_at ASC`).all(batchId) as any[];
}

export function markAchBatchSubmitted(batchId: string, nachaFilePath?: string): boolean {
  const dbi = db.getDb();
  const r = dbi.prepare(`UPDATE ach_batches SET status = 'submitted', submitted_at = ?, nacha_file_path = ? WHERE id = ?`).run(now(), nachaFilePath || null, batchId);
  return r.changes > 0;
}

// ════════════════════════════════════════════════════════════════
// F98. Bank fee auto-categorization
// ════════════════════════════════════════════════════════════════
export function upsertBankFeeCategory(c: { id?: string; company_id: string; pattern: string; category_id?: string; expense_account_id?: string; is_active?: boolean }): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  if (c.id) {
    dbi.prepare(`UPDATE bank_fee_categories SET pattern = ?, category_id = ?, expense_account_id = ?, is_active = ? WHERE id = ?`)
      .run(c.pattern, c.category_id || null, c.expense_account_id || null, c.is_active === false ? 0 : 1, c.id);
  } else {
    dbi.prepare(`
      INSERT INTO bank_fee_categories (id, company_id, pattern, category_id, expense_account_id, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, c.company_id, c.pattern, c.category_id || null, c.expense_account_id || null, c.is_active === false ? 0 : 1, now());
  }
  return { id, ...c };
}

export function listBankFeeCategories(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM bank_fee_categories WHERE company_id = ? ORDER BY match_count DESC, pattern ASC`).all(companyId) as any[];
}

export function suggestBankFeeCategory(companyId: string, description: string): { category_id: string | null; expense_account_id: string | null } | null {
  const dbi = db.getDb();
  const rules = dbi.prepare(`SELECT * FROM bank_fee_categories WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
  const desc = (description || '').toLowerCase();
  for (const r of rules) {
    if (desc.includes((r.pattern || '').toLowerCase())) {
      dbi.prepare(`UPDATE bank_fee_categories SET match_count = match_count + 1 WHERE id = ?`).run(r.id);
      return { category_id: r.category_id, expense_account_id: r.expense_account_id };
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// F99. Bank match fuzzy attempts log
// ════════════════════════════════════════════════════════════════
export function logBankMatchAttempt(companyId: string, transactionId: string, candidate: { type: string; id: string; score: number; accepted?: boolean }): void {
  db.getDb().prepare(`
    INSERT INTO bank_match_attempts (id, company_id, transaction_id, candidate_type, candidate_id, score, accepted, matched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), companyId, transactionId, candidate.type, candidate.id, candidate.score, candidate.accepted ? 1 : 0, now());
}

export function listBankMatchAttempts(companyId: string, transactionId?: string, limit: number = 100): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (transactionId) { where += ' AND transaction_id = ?'; params.push(transactionId); }
  return dbi.prepare(`SELECT * FROM bank_match_attempts WHERE ${where} ORDER BY matched_at DESC LIMIT ${Math.min(limit, 1000)}`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F100. Stop payments
// ════════════════════════════════════════════════════════════════
export function upsertStopPayment(s: any): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  if (s.id) {
    dbi.prepare(`
      UPDATE stop_payments SET bank_account_id = ?, check_number = ?, amount = ?, payee = ?,
        requested_date = ?, effective_date = ?, expires_at = ?, reason = ?, status = ?, fee = ?, notes = ?
      WHERE id = ?
    `).run(s.bank_account_id, s.check_number, s.amount, s.payee, s.requested_date, s.effective_date,
           s.expires_at, s.reason, s.status || 'active', s.fee || 0, s.notes, s.id);
  } else {
    dbi.prepare(`
      INSERT INTO stop_payments (id, company_id, bank_account_id, check_number, amount, payee,
        requested_date, effective_date, expires_at, reason, status, fee, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, s.company_id, s.bank_account_id, s.check_number, s.amount, s.payee,
           s.requested_date, s.effective_date, s.expires_at, s.reason,
           s.status || 'active', s.fee || 0, s.notes, now());
  }
  return { id, ...s };
}

export function listStopPayments(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM stop_payments WHERE ${where} ORDER BY requested_date DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F101. Pending deposits / float
// ════════════════════════════════════════════════════════════════
export function upsertPendingDeposit(p: any): any {
  const dbi = db.getDb();
  const id = p.id || uuid();
  if (p.id) {
    dbi.prepare(`
      UPDATE pending_deposits SET deposit_date = ?, expected_clear_date = ?, bank_account_id = ?,
        amount = ?, deposit_type = ?, reference = ?, status = ?, cleared_at = ?, notes = ?
      WHERE id = ?
    `).run(p.deposit_date, p.expected_clear_date, p.bank_account_id, p.amount,
           p.deposit_type || 'check', p.reference, p.status || 'pending',
           p.cleared_at || null, p.notes, p.id);
  } else {
    dbi.prepare(`
      INSERT INTO pending_deposits (id, company_id, deposit_date, expected_clear_date,
        bank_account_id, amount, deposit_type, reference, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, p.company_id, p.deposit_date, p.expected_clear_date, p.bank_account_id,
           p.amount, p.deposit_type || 'check', p.reference,
           p.status || 'pending', p.notes, now());
  }
  return { id, ...p };
}

export function listPendingDeposits(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM pending_deposits WHERE ${where} ORDER BY deposit_date DESC`).all(...params) as any[];
}

export function totalPendingFloat(companyId: string): { total_pending: number; count: number } {
  const r = db.getDb().prepare(`SELECT COALESCE(SUM(amount), 0) AS total_pending, COUNT(*) AS count FROM pending_deposits WHERE company_id = ? AND status = 'pending'`).get(companyId) as any;
  return r;
}

// ════════════════════════════════════════════════════════════════
// F102. Petty cash log
// ════════════════════════════════════════════════════════════════
export function logPettyCash(p: any): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`
    INSERT INTO petty_cash_log (id, company_id, log_date, direction, amount, purpose, payee, receipt_path, custodian, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, p.company_id, p.log_date || today(), p.direction || 'out', p.amount,
         p.purpose, p.payee, p.receipt_path, p.custodian, now());
  return { id, ...p };
}

export function listPettyCash(companyId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT * FROM petty_cash_log WHERE company_id = ? ORDER BY log_date DESC LIMIT ?`).all(companyId, Math.min(limit, 1000)) as any[];
}

export function pettyCashBalance(companyId: string): number {
  const r = db.getDb().prepare(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS bal
      FROM petty_cash_log WHERE company_id = ?
  `).get(companyId) as any;
  return r?.bal || 0;
}

// ════════════════════════════════════════════════════════════════
// F103. Treasury investments
// ════════════════════════════════════════════════════════════════
export function upsertTreasuryInvestment(t: any): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`
      UPDATE treasury_investments SET instrument_type = ?, institution = ?, cusip = ?,
        purchase_date = ?, maturity_date = ?, face_value = ?, purchase_price = ?,
        interest_rate = ?, interest_frequency = ?, status = ?, auto_roll = ?, notes = ?
      WHERE id = ?
    `).run(t.instrument_type, t.institution, t.cusip, t.purchase_date, t.maturity_date,
           t.face_value, t.purchase_price, t.interest_rate, t.interest_frequency || 'monthly',
           t.status || 'active', t.auto_roll ? 1 : 0, t.notes, t.id);
  } else {
    dbi.prepare(`
      INSERT INTO treasury_investments (id, company_id, instrument_type, institution, cusip,
        purchase_date, maturity_date, face_value, purchase_price, interest_rate, interest_frequency,
        status, auto_roll, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, t.company_id, t.instrument_type, t.institution, t.cusip, t.purchase_date,
           t.maturity_date, t.face_value, t.purchase_price, t.interest_rate,
           t.interest_frequency || 'monthly', t.status || 'active',
           t.auto_roll ? 1 : 0, t.notes, now());
  }
  return { id, ...t };
}

export function listTreasuryInvestments(companyId: string, opts?: { status?: string; maturing_within_days?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.maturing_within_days) {
    where += ` AND maturity_date <= date('now', '+' || ? || ' days')`;
    params.push(opts.maturing_within_days);
  }
  return dbi.prepare(`SELECT * FROM treasury_investments WHERE ${where} ORDER BY maturity_date ASC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F104. Letters of credit
// ════════════════════════════════════════════════════════════════
export function upsertLetterOfCredit(lc: any): any {
  const dbi = db.getDb();
  const id = lc.id || uuid();
  if (lc.id) {
    dbi.prepare(`
      UPDATE letters_of_credit SET lc_number = ?, lc_type = ?, issuing_bank = ?, beneficiary = ?,
        face_amount = ?, currency = ?, issue_date = ?, expiry_date = ?, status = ?,
        fee_accrued = ?, notes = ?
      WHERE id = ?
    `).run(lc.lc_number, lc.lc_type || 'standby', lc.issuing_bank, lc.beneficiary,
           lc.face_amount, lc.currency || 'USD', lc.issue_date, lc.expiry_date,
           lc.status || 'open', lc.fee_accrued || 0, lc.notes, lc.id);
  } else {
    dbi.prepare(`
      INSERT INTO letters_of_credit (id, company_id, lc_number, lc_type, issuing_bank, beneficiary,
        face_amount, currency, issue_date, expiry_date, status, fee_accrued, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, lc.company_id, lc.lc_number, lc.lc_type || 'standby', lc.issuing_bank, lc.beneficiary,
           lc.face_amount, lc.currency || 'USD', lc.issue_date, lc.expiry_date,
           lc.status || 'open', lc.fee_accrued || 0, lc.notes, now());
  }
  return { id, ...lc };
}

export function listLettersOfCredit(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM letters_of_credit WHERE ${where} ORDER BY expiry_date ASC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F105. Loan covenants
// ════════════════════════════════════════════════════════════════
export function upsertLoanCovenant(c: any): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  if (c.id) {
    dbi.prepare(`
      UPDATE loan_covenants SET loan_id = ?, covenant_name = ?, metric = ?, operator = ?,
        threshold_value = ?, measurement_frequency = ?, next_measurement_date = ?, notes = ?
      WHERE id = ?
    `).run(c.loan_id, c.covenant_name, c.metric, c.operator || '>=', c.threshold_value,
           c.measurement_frequency || 'quarterly', c.next_measurement_date, c.notes, c.id);
  } else {
    dbi.prepare(`
      INSERT INTO loan_covenants (id, company_id, loan_id, covenant_name, metric, operator,
        threshold_value, measurement_frequency, next_measurement_date, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, c.company_id, c.loan_id, c.covenant_name, c.metric, c.operator || '>=',
           c.threshold_value, c.measurement_frequency || 'quarterly',
           c.next_measurement_date, c.notes, now());
  }
  return { id, ...c };
}

export function recordCovenantMeasurement(covenantId: string, measuredValue: number): { breach_status: string; threshold_value: number; measured_value: number } {
  const dbi = db.getDb();
  const cov = dbi.prepare(`SELECT * FROM loan_covenants WHERE id = ?`).get(covenantId) as any;
  if (!cov) throw new Error('Covenant not found');
  const op = cov.operator || '>=';
  let pass = false;
  switch (op) {
    case '>=': pass = measuredValue >= cov.threshold_value; break;
    case '<=': pass = measuredValue <= cov.threshold_value; break;
    case '>':  pass = measuredValue > cov.threshold_value; break;
    case '<':  pass = measuredValue < cov.threshold_value; break;
    case '=':  pass = measuredValue === cov.threshold_value; break;
  }
  const breachStatus = pass ? 'compliant' : 'breached';
  dbi.prepare(`UPDATE loan_covenants SET last_measured_value = ?, last_measured_at = ?, breach_status = ? WHERE id = ?`)
    .run(measuredValue, now(), breachStatus, covenantId);
  return { breach_status: breachStatus, threshold_value: cov.threshold_value, measured_value: measuredValue };
}

export function listLoanCovenants(companyId: string, opts?: { loan_id?: string; breached_only?: boolean }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.loan_id) { where += ' AND loan_id = ?'; params.push(opts.loan_id); }
  if (opts?.breached_only) where += ` AND breach_status = 'breached'`;
  return dbi.prepare(`SELECT * FROM loan_covenants WHERE ${where} ORDER BY next_measurement_date ASC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F106. Sweep rules
// ════════════════════════════════════════════════════════════════
export function upsertSweepRule(s: any): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  if (s.id) {
    dbi.prepare(`
      UPDATE sweep_rules SET source_account_id = ?, target_account_id = ?, rule_type = ?,
        minimum_balance = ?, target_balance = ?, is_active = ?, notes = ?
      WHERE id = ?
    `).run(s.source_account_id, s.target_account_id, s.rule_type || 'threshold',
           s.minimum_balance || 0, s.target_balance || 0, s.is_active === false ? 0 : 1,
           s.notes, s.id);
  } else {
    dbi.prepare(`
      INSERT INTO sweep_rules (id, company_id, source_account_id, target_account_id, rule_type,
        minimum_balance, target_balance, is_active, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, s.company_id, s.source_account_id, s.target_account_id, s.rule_type || 'threshold',
           s.minimum_balance || 0, s.target_balance || 0, s.is_active === false ? 0 : 1,
           s.notes, now());
  }
  return { id, ...s };
}

export function listSweepRules(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  const params: any[] = [companyId];
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM sweep_rules WHERE ${where}`).all(...params) as any[];
}

export function evaluateSweepRules(companyId: string): Array<{ rule_id: string; suggested_amount: number; source: string; target: string }> {
  const dbi = db.getDb();
  const rules = dbi.prepare(`SELECT * FROM sweep_rules WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
  const out: any[] = [];
  for (const r of rules) {
    const sourceBal = computeAccountBalance(companyId, r.source_account_id);
    if (sourceBal > (r.minimum_balance || 0)) {
      const sweepAmount = sourceBal - (r.target_balance || r.minimum_balance || 0);
      if (sweepAmount > 0) {
        out.push({ rule_id: r.id, suggested_amount: sweepAmount, source: r.source_account_id, target: r.target_account_id });
      }
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// F107. Inter-company transfers
// ════════════════════════════════════════════════════════════════
export function recordInterCompanyTransfer(t: any): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`
    INSERT INTO inter_company_transfers (id, transfer_date, from_company_id, to_company_id,
      from_account_id, to_account_id, amount, currency, purpose, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, t.transfer_date || today(), t.from_company_id, t.to_company_id,
         t.from_account_id, t.to_account_id, t.amount, t.currency || 'USD',
         t.purpose, t.status || 'pending', now());
  return { id, ...t };
}

export function listInterCompanyTransfers(opts: { company_id?: string; status?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [];
  let where = '1=1';
  if (opts.company_id) {
    where += ' AND (from_company_id = ? OR to_company_id = ?)';
    params.push(opts.company_id, opts.company_id);
  }
  if (opts.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM inter_company_transfers WHERE ${where} ORDER BY transfer_date DESC LIMIT ${Math.min(opts.limit || 100, 1000)}`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F108. Credit card statements
// ════════════════════════════════════════════════════════════════
export function upsertCreditCardStatement(s: any): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  if (s.id) {
    dbi.prepare(`
      UPDATE credit_card_statements SET card_account_id = ?, statement_date = ?, closing_date = ?,
        due_date = ?, new_balance = ?, minimum_payment = ?
      WHERE id = ?
    `).run(s.card_account_id, s.statement_date, s.closing_date, s.due_date,
           s.new_balance, s.minimum_payment, s.id);
  } else {
    dbi.prepare(`
      INSERT INTO credit_card_statements (id, company_id, card_account_id, statement_date,
        closing_date, due_date, new_balance, minimum_payment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, s.company_id, s.card_account_id, s.statement_date, s.closing_date,
           s.due_date, s.new_balance, s.minimum_payment, now());
  }
  return { id, ...s };
}

export function addStatementLines(statementId: string, lines: Array<{ transaction_date: string; description: string; amount: number }>): { added: number } {
  const dbi = db.getDb();
  const insert = dbi.prepare(`
    INSERT INTO cc_statement_lines (id, statement_id, transaction_date, description, amount)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = dbi.transaction(() => {
    for (const l of lines) {
      insert.run(uuid(), statementId, l.transaction_date, l.description, l.amount);
    }
  });
  tx();
  return { added: lines.length };
}

export function listCreditCardStatements(companyId: string, opts?: { card_account_id?: string; unreconciled_only?: boolean }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.card_account_id) { where += ' AND card_account_id = ?'; params.push(opts.card_account_id); }
  if (opts?.unreconciled_only) where += ' AND is_reconciled = 0';
  return dbi.prepare(`SELECT * FROM credit_card_statements WHERE ${where} ORDER BY statement_date DESC`).all(...params) as any[];
}

export function getStatementLines(statementId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM cc_statement_lines WHERE statement_id = ? ORDER BY transaction_date ASC`).all(statementId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F109. Lockbox imports
// ════════════════════════════════════════════════════════════════
export function importLockbox(imp: { company_id: string; import_date?: string; bank_account_id?: string; file_path?: string; items: Array<{ customer_id?: string; invoice_number?: string; payment_date?: string; amount: number; notes?: string }> }): any {
  const dbi = db.getDb();
  const importId = uuid();
  const totalAmount = imp.items.reduce((s, i) => s + (i.amount || 0), 0);
  dbi.prepare(`
    INSERT INTO lockbox_imports (id, company_id, import_date, bank_account_id, file_path,
      total_amount, item_count, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?)
  `).run(importId, imp.company_id, imp.import_date || today(), imp.bank_account_id || null,
         imp.file_path || null, totalAmount, imp.items.length, now());

  const insert = dbi.prepare(`
    INSERT INTO lockbox_items (id, import_id, customer_id, invoice_number, payment_date,
      amount, match_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = dbi.transaction(() => {
    for (const it of imp.items) {
      // Auto-match if invoice_number matches an open invoice
      let matchStatus = 'unmatched';
      let matchedInvoiceId: string | null = null;
      if (it.invoice_number) {
        const inv = dbi.prepare(`
          SELECT id FROM invoices
           WHERE company_id = ? AND invoice_number = ? AND status NOT IN ('paid','void','cancelled')
           LIMIT 1
        `).get(imp.company_id, it.invoice_number) as any;
        if (inv) { matchStatus = 'matched'; matchedInvoiceId = inv.id; }
      }
      const itemId = uuid();
      insert.run(itemId, importId, it.customer_id || null, it.invoice_number || null,
                 it.payment_date || null, it.amount, matchStatus, it.notes || null);
      if (matchedInvoiceId) {
        dbi.prepare(`UPDATE lockbox_items SET matched_invoice_id = ? WHERE id = ?`).run(matchedInvoiceId, itemId);
      }
    }
  });
  tx();
  return { id: importId, item_count: imp.items.length, total_amount: totalAmount };
}

export function listLockboxImports(companyId: string, limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM lockbox_imports WHERE company_id = ? ORDER BY import_date DESC LIMIT ?`).all(companyId, Math.min(limit, 500)) as any[];
}

export function getLockboxItems(importId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM lockbox_items WHERE import_id = ? ORDER BY payment_date ASC`).all(importId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F110. Positive-pay file generation
// ════════════════════════════════════════════════════════════════
export function generatePositivePayFile(companyId: string, opts: { bank_account_id?: string; file_date?: string; file_format?: 'csv' | 'fixed' }): { id: string; csv: string; check_count: number; total_amount: number } {
  const dbi = db.getDb();
  // Find issued checks since last positive-pay submission
  const lastFile = dbi.prepare(`
    SELECT MAX(file_date) AS last_date FROM positive_pay_files
     WHERE company_id = ? AND submitted = 1
  `).get(companyId) as any;
  const sinceDate = lastFile?.last_date || '1900-01-01';
  const params: any[] = [companyId, sinceDate];
  let acctClause = '';
  if (opts.bank_account_id) {
    acctClause = ' AND payment_account_id = ?';
    params.push(opts.bank_account_id);
  }
  const checks = dbi.prepare(`
    SELECT id, payment_number AS check_number, amount, payee_name AS payee, payment_date
      FROM bill_payments
     WHERE company_id = ? AND payment_date >= ? AND payment_method = 'check'
       ${acctClause}
     ORDER BY payment_date ASC
  `).all(...params) as any[];

  const headers = ['check_number', 'amount', 'payee', 'payment_date'];
  const lines = [headers.join(',')];
  let total = 0;
  for (const c of checks) {
    total += c.amount || 0;
    lines.push([c.check_number || '', c.amount || 0, `"${(c.payee || '').replace(/"/g, '""')}"`, c.payment_date || ''].join(','));
  }
  const csv = lines.join('\n');
  const id = uuid();
  dbi.prepare(`
    INSERT INTO positive_pay_files (id, company_id, bank_account_id, file_date, file_format,
      check_count, total_amount, submitted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, companyId, opts.bank_account_id || null, opts.file_date || today(),
         opts.file_format || 'csv', checks.length, total, now());
  return { id, csv, check_count: checks.length, total_amount: total };
}

export function listPositivePayFiles(companyId: string, limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM positive_pay_files WHERE company_id = ? ORDER BY file_date DESC LIMIT ?`).all(companyId, Math.min(limit, 500)) as any[];
}

export function markPositivePayFileSubmitted(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE positive_pay_files SET submitted = 1, submitted_at = ? WHERE id = ?`).run(now(), id);
  return r.changes > 0;
}
