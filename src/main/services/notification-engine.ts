import * as db from '../database';

// ─── Check Overdue Invoices ──────────────────────────────
export function checkOverdueInvoices(companyId?: string): number {
  const dbInstance = db.getDb();
  const today = new Date().toISOString().slice(0, 10);
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
  const today = new Date().toISOString().slice(0, 10);
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
  const today = new Date().toISOString().slice(0, 10);
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
export interface NotificationCheckResult {
  overdueNotifications: number;
  budgetAlerts: number;
  reconciliationAlerts: number;
}

export function runNotificationChecks(companyId?: string): NotificationCheckResult {
  const overdueNotifications = checkOverdueInvoices(companyId);
  const budgetAlerts = checkBudgetThresholds(companyId);
  const reconciliationAlerts = checkUnmatchedTransactions(companyId);

  return { overdueNotifications, budgetAlerts, reconciliationAlerts };
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
