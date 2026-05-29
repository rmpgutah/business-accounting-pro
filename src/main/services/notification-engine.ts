import * as db from '../database';

// ─── Check Overdue Invoices ──────────────────────────────
export function checkOverdueInvoices(companyId?: string): number {
  const dbInstance = db.getDb();
  // DATE: format from local Y/M/D — toISOString() shifts day in non-UTC zones
  // and would either over-collect ("today" is tomorrow's overdues) or
  // under-collect ("today" is yesterday) depending on the local time.
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  let created = 0;

  let sql = `
    SELECT i.id, i.invoice_number, i.total, i.amount_paid, i.due_date, i.company_id, c.name as client_name
    FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id
    WHERE i.status IN ('sent', 'partial')
    AND i.due_date < ?
  `;
  const params: any[] = [today];
  if (companyId) {
    sql += ' AND i.company_id = ?';
    params.push(companyId);
  }

  const overdueInvoices = dbInstance.prepare(sql).all(...params) as any[];

  for (const inv of overdueInvoices) {
    // Check if we already created an overdue notification for this invoice today
    const existing = dbInstance.prepare(
      `SELECT id FROM notifications
       WHERE entity_type = 'invoice' AND entity_id = ? AND type = 'overdue'
       AND date(created_at) = ?`
    ).get(inv.id, today) as any;

    if (existing) continue;

    const balance = (inv.total || 0) - (inv.amount_paid || 0);
    const clientName = inv.client_name || 'Unknown';

    db.create('notifications', {
      company_id: inv.company_id,
      type: 'overdue',
      title: `Invoice ${inv.invoice_number} is overdue`,
      message: `Invoice ${inv.invoice_number} for ${clientName} — $${balance.toFixed(2)} balance due since ${inv.due_date}`,
      entity_type: 'invoice',
      entity_id: inv.id,
      is_read: 0,
    });

    // Update invoice status to overdue
    dbInstance.prepare(
      "UPDATE invoices SET status = 'overdue', updated_at = datetime('now') WHERE id = ? AND status IN ('sent', 'partial')"
    ).run(inv.id);

    created++;
  }

  return created;
}

// ─── Check Budget Thresholds ─────────────────────────────
export function checkBudgetThresholds(companyId?: string): number {
  const dbInstance = db.getDb();
  // DATE: format from local Y/M/D — toISOString() shifts day in non-UTC zones
  // and would either over-collect ("today" is tomorrow's overdues) or
  // under-collect ("today" is yesterday) depending on the local time.
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  let created = 0;

  let budgetSql = `
    SELECT b.id, b.company_id, b.name, b.start_date, b.end_date
    FROM budgets b
    WHERE b.status = 'active'
    AND b.start_date <= ? AND b.end_date >= ?
  `;
  const budgetParams: any[] = [today, today];
  if (companyId) {
    budgetSql += ' AND b.company_id = ?';
    budgetParams.push(companyId);
  }

  const activeBudgets = dbInstance.prepare(budgetSql).all(...budgetParams) as any[];

  for (const budget of activeBudgets) {
    // Get total budgeted amount
    const budgetLines = dbInstance.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total_budgeted FROM budget_lines WHERE budget_id = ?'
    ).get(budget.id) as any;

    const totalBudgeted = budgetLines?.total_budgeted || 0;
    if (totalBudgeted <= 0) continue;

    // Get actual expenses in the budget period
    const actualExpenses = dbInstance.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?'
    ).get(budget.company_id, budget.start_date, budget.end_date) as any;

    const totalActual = actualExpenses?.total || 0;
    const usagePct = (totalActual / totalBudgeted) * 100;

    if (usagePct >= 90) {
      // Check if we already notified about this budget today
      const existing = dbInstance.prepare(
        `SELECT id FROM notifications
         WHERE entity_type = 'budget' AND entity_id = ? AND type = 'budget_alert'
         AND date(created_at) = ?`
      ).get(budget.id, today) as any;

      if (existing) continue;

      db.create('notifications', {
        company_id: budget.company_id,
        type: 'budget_alert',
        title: `Budget "${budget.name}" at ${usagePct.toFixed(0)}%`,
        message: `Budget "${budget.name}" has reached ${usagePct.toFixed(1)}% usage — $${totalActual.toFixed(2)} of $${totalBudgeted.toFixed(2)} budgeted`,
        entity_type: 'budget',
        entity_id: budget.id,
        is_read: 0,
      });

      created++;
    }
  }

  return created;
}

// ─── Check Unmatched Bank Transactions ───────────────────
export function checkUnmatchedTransactions(companyId?: string): number {
  const dbInstance = db.getDb();
  // DATE: format from local Y/M/D — toISOString() shifts day in non-UTC zones
  // and would either over-collect ("today" is tomorrow's overdues) or
  // under-collect ("today" is yesterday) depending on the local time.
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  let created = 0;

  let sql = `
    SELECT ba.company_id, ba.name as account_name, ba.id as bank_account_id,
           COUNT(bt.id) as unmatched_count
    FROM bank_accounts ba
    JOIN bank_transactions bt ON bt.bank_account_id = ba.id
    WHERE bt.status = 'pending' AND bt.is_matched = 0
  `;
  const params: any[] = [];
  if (companyId) {
    sql += ' AND ba.company_id = ?';
    params.push(companyId);
  }
  sql += ' GROUP BY ba.id HAVING unmatched_count >= 5';

  const accounts = dbInstance.prepare(sql).all(...params) as any[];

  for (const acct of accounts) {
    // Check if already notified today
    const existing = dbInstance.prepare(
      `SELECT id FROM notifications
       WHERE entity_type = 'bank_account' AND entity_id = ? AND type = 'reconciliation'
       AND date(created_at) = ?`
    ).get(acct.bank_account_id, today) as any;

    if (existing) continue;

    db.create('notifications', {
      company_id: acct.company_id,
      type: 'reconciliation',
      title: `Bank reconciliation needed — ${acct.account_name}`,
      message: `${acct.unmatched_count} unmatched transactions in ${acct.account_name}`,
      entity_type: 'bank_account',
      entity_id: acct.bank_account_id,
      is_read: 0,
    });

    created++;
  }

  return created;
}

// ─── Run All Notification Checks ─────────────────────────
// ─── Check Overdue Loan Payments ─────────────────────────
// Surfaces active loans whose next scheduled payment date has passed.
// One notification per loan per day (idempotent like the invoice check).
export function checkOverdueLoans(companyId?: string): number {
  const dbInstance = db.getDb();
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  let created = 0;
  let sql = `
    SELECT id, company_id, name, next_payment_due, payment_amount, current_balance
    FROM loans
    WHERE status = 'active' AND next_payment_due IS NOT NULL AND date(next_payment_due) < date(?)
      AND (deleted_at IS NULL)
  `;
  const params: any[] = [today];
  if (companyId) { sql += ' AND company_id = ?'; params.push(companyId); }
  let loans: any[] = [];
  try { loans = dbInstance.prepare(sql).all(...params) as any[]; } catch { return 0; }

  for (const loan of loans) {
    const existing = dbInstance.prepare(
      `SELECT id FROM notifications WHERE entity_type = 'loan' AND entity_id = ? AND type = 'overdue' AND date(created_at) = ?`
    ).get(loan.id, today) as any;
    if (existing) continue;
    db.create('notifications', {
      company_id: loan.company_id,
      type: 'overdue',
      title: `Loan payment overdue: ${loan.name}`,
      message: `${loan.name} — payment of $${(loan.payment_amount || 0).toFixed(2)} was due ${loan.next_payment_due}. Balance $${(loan.current_balance || 0).toFixed(2)}.`,
      entity_type: 'loan',
      entity_id: loan.id,
      is_read: 0,
    });
    created++;
  }
  return created;
}

// ─── Check Overdue Bills (Accounts Payable) ──────────────
export function checkOverdueBills(companyId?: string): number {
  const dbInstance = db.getDb();
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  let created = 0;
  let sql = `
    SELECT b.id, b.company_id, b.bill_number, b.total, b.amount_paid, b.due_date, v.name AS vendor_name
    FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id
    WHERE b.status IN ('pending','received','approved','partial')
      AND b.due_date IS NOT NULL AND date(b.due_date) < date(?)
  `;
  const params: any[] = [today];
  if (companyId) { sql += ' AND b.company_id = ?'; params.push(companyId); }
  let bills: any[] = [];
  try { bills = dbInstance.prepare(sql).all(...params) as any[]; } catch { return 0; }
  for (const bill of bills) {
    const existing = dbInstance.prepare(
      `SELECT id FROM notifications WHERE entity_type='bill' AND entity_id=? AND type='overdue' AND date(created_at)=?`
    ).get(bill.id, today) as any;
    if (existing) continue;
    const bal = (bill.total || 0) - (bill.amount_paid || 0);
    db.create('notifications', {
      company_id: bill.company_id, type: 'overdue',
      title: `Bill ${bill.bill_number} is overdue`,
      message: `Bill ${bill.bill_number}${bill.vendor_name ? ` to ${bill.vendor_name}` : ''} — $${bal.toFixed(2)} due since ${bill.due_date}`,
      entity_type: 'bill', entity_id: bill.id, is_read: 0,
    });
    created++;
  }
  return created;
}

// ─── Check Expiring Vendor Compliance (contract + insurance) ──
export function checkExpiringVendorCompliance(companyId?: string, daysAhead = 30): number {
  const dbInstance = db.getDb();
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  const h = new Date(_now.getTime() + daysAhead * 86400000);
  const horizon = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  let created = 0;
  let sql = `
    SELECT id, company_id, name,
      COALESCE(NULLIF(contract_end_date,''), NULLIF(contract_end,'')) AS contract_end,
      NULLIF(coi_expiry,'') AS coi_expiry
    FROM vendors WHERE (deleted_at IS NULL OR deleted_at = '')
  `;
  const params: any[] = [];
  if (companyId) { sql += ' AND company_id = ?'; params.push(companyId); }
  let vendors: any[] = [];
  try { vendors = dbInstance.prepare(sql).all(...params) as any[]; } catch { return 0; }
  const flag = (v: any, label: string, kind: string, dateStr: string | null) => {
    if (!dateStr || dateStr > horizon) return;
    const existing = dbInstance.prepare(
      `SELECT id FROM notifications WHERE entity_type='vendor' AND entity_id=? AND type='compliance' AND message LIKE ? AND date(created_at)=?`
    ).get(v.id, `%${kind}%`, today) as any;
    if (existing) return;
    const expired = dateStr < today;
    db.create('notifications', {
      company_id: v.company_id, type: 'compliance',
      title: `${v.name}: ${label} ${expired ? 'expired' : 'expiring soon'}`,
      message: `${v.name} ${kind} ${expired ? 'expired on' : 'expires'} ${dateStr}.`,
      entity_type: 'vendor', entity_id: v.id, is_read: 0,
    });
    created++;
  };
  for (const v of vendors) {
    flag(v, 'Contract', 'contract', v.contract_end);
    flag(v, 'Insurance (COI)', 'insurance', v.coi_expiry);
  }
  return created;
}

// ─── Check Equipment Penalties Owed ──────────────────────
export function checkEquipmentPenaltiesOwed(companyId?: string): number {
  const dbInstance = db.getDb();
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  let created = 0;
  // employee_equipment has no company_id — join employees for scoping.
  let sql = `
    SELECT ee.id, ee.item_name, ee.penalty_assessed, ee.disposition, e.company_id, e.name AS employee_name
    FROM employee_equipment ee JOIN employees e ON e.id = ee.employee_id
    WHERE ee.penalty_assessed > 0.005 AND COALESCE(ee.penalty_waived,0) = 0
  `;
  const params: any[] = [];
  if (companyId) { sql += ' AND e.company_id = ?'; params.push(companyId); }
  let rows: any[] = [];
  try { rows = dbInstance.prepare(sql).all(...params) as any[]; } catch { return 0; }
  for (const r of rows) {
    const existing = dbInstance.prepare(
      `SELECT id FROM notifications WHERE entity_type='equipment' AND entity_id=? AND type='penalty' AND date(created_at)=?`
    ).get(r.id, today) as any;
    if (existing) continue;
    db.create('notifications', {
      company_id: r.company_id, type: 'penalty',
      title: `Equipment penalty owed: $${(r.penalty_assessed || 0).toFixed(2)}`,
      message: `${r.employee_name}: ${r.item_name} (${String(r.disposition || '').replace(/_/g, ' ')}) — assessed penalty $${(r.penalty_assessed || 0).toFixed(2)} outstanding.`,
      entity_type: 'equipment', entity_id: r.id, is_read: 0,
    });
    created++;
  }
  return created;
}

// ─── Credential warning windows (DAYS AHEAD to start alerting) ───
// LEARNING-MODE CONTRIBUTION POINT — tune these to your business.
// Different credential types warrant different lead times: a license
// you renew in person (often weeks of processing) needs more runway than
// an online cert you can redo same-day. These defaults are sensible
// starting points; adjust the numbers (and add your own credential
// types) to match how your org actually renews things.
const CREDENTIAL_WARNING_DAYS: Record<string, number> = {
  license: 60,            // professional / state licenses — long renewal lead time
  certification: 45,
  training: 30,
  background_check: 30,
  drug_test: 14,
  i9: 30,                 // I-9 reverification
  w4: 30,
  other: 30,
};

// ─── Check Expiring Employee Credentials ─────────────────
export function checkExpiringEmployeeCredentials(companyId?: string): number {
  const dbInstance = db.getDb();
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  let created = 0;
  // No company_id on employee_credentials — scope via the employee join.
  let sql = `
    SELECT ec.id, ec.credential_type, ec.name, ec.expiry_date, e.company_id, e.name AS employee_name
    FROM employee_credentials ec JOIN employees e ON e.id = ec.employee_id
    WHERE ec.expiry_date IS NOT NULL AND ec.expiry_date != ''
  `;
  const params: any[] = [];
  if (companyId) { sql += ' AND e.company_id = ?'; params.push(companyId); }
  let rows: any[] = [];
  try { rows = dbInstance.prepare(sql).all(...params) as any[]; } catch { return 0; }
  for (const c of rows) {
    const windowDays = CREDENTIAL_WARNING_DAYS[c.credential_type] ?? 30;
    const h = new Date(_now.getTime() + windowDays * 86400000);
    const horizon = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
    if (c.expiry_date > horizon) continue; // not yet within this credential's warning window
    const existing = dbInstance.prepare(
      `SELECT id FROM notifications WHERE entity_type='credential' AND entity_id=? AND type='compliance' AND date(created_at)=?`
    ).get(c.id, today) as any;
    if (existing) continue;
    const expired = c.expiry_date < today;
    db.create('notifications', {
      company_id: c.company_id, type: 'compliance',
      title: `${c.employee_name}: ${c.name || c.credential_type} ${expired ? 'expired' : 'expiring soon'}`,
      message: `${c.employee_name}'s ${String(c.credential_type).replace(/_/g, ' ')} "${c.name}" ${expired ? 'expired on' : 'expires'} ${c.expiry_date}.`,
      entity_type: 'credential', entity_id: c.id, is_read: 0,
    });
    created++;
  }
  return created;
}

export interface NotificationCheckResult {
  overdueNotifications: number;
  budgetAlerts: number;
  reconciliationAlerts: number;
  loanAlerts: number;
  billAlerts: number;
  complianceAlerts: number;
  penaltyAlerts: number;
  credentialAlerts: number;
}

// Reentrancy guard — the 30-minute cron and ad-hoc IPC invocations can otherwise
// overlap on a slow DB and double-fire notifications for the same overdue invoice.
let notificationsRunning = false;

export function runNotificationChecks(companyId?: string): NotificationCheckResult {
  if (notificationsRunning) {
    return { overdueNotifications: 0, budgetAlerts: 0, reconciliationAlerts: 0, loanAlerts: 0, billAlerts: 0, complianceAlerts: 0, penaltyAlerts: 0, credentialAlerts: 0 };
  }
  notificationsRunning = true;
  try {
    const overdueNotifications = checkOverdueInvoices(companyId);
    const budgetAlerts = checkBudgetThresholds(companyId);
    const reconciliationAlerts = checkUnmatchedTransactions(companyId);
    const loanAlerts = checkOverdueLoans(companyId);
    const billAlerts = checkOverdueBills(companyId);
    const complianceAlerts = checkExpiringVendorCompliance(companyId);
    const penaltyAlerts = checkEquipmentPenaltiesOwed(companyId);
    const credentialAlerts = checkExpiringEmployeeCredentials(companyId);
    return { overdueNotifications, budgetAlerts, reconciliationAlerts, loanAlerts, billAlerts, complianceAlerts, penaltyAlerts, credentialAlerts };
  } finally {
    notificationsRunning = false;
  }
}

// ─── Get Notification Preferences ────────────────────────
const DEFAULT_PREFERENCES: Record<string, boolean> = {
  payment: true,
  overdue: true,
  recurring: true,
  report: true,
  budget_alert: true,
  reconciliation: true,
};

export function getNotificationPreferences(companyId: string): Record<string, boolean> {
  const dbInstance = db.getDb();
  const row = dbInstance.prepare(
    "SELECT value FROM settings WHERE company_id = ? AND key = 'notification_preferences'"
  ).get(companyId) as any;

  if (row?.value) {
    try {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(row.value) };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }
  return { ...DEFAULT_PREFERENCES };
}

export function updateNotificationPreferences(companyId: string, prefs: Record<string, boolean>): void {
  const dbInstance = db.getDb();
  const existing = dbInstance.prepare(
    "SELECT id FROM settings WHERE company_id = ? AND key = 'notification_preferences'"
  ).get(companyId) as any;

  const value = JSON.stringify(prefs);

  if (existing) {
    dbInstance.prepare(
      "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(value, existing.id);
  } else {
    db.create('settings', {
      company_id: companyId,
      key: 'notification_preferences',
      value,
    });
  }
}
