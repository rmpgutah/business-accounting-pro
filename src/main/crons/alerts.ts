// src/main/crons/alerts.ts
import type { Database } from 'better-sqlite3';
import { evaluateRules } from '../rules';

export function runAlertRules(db: Database): void {
  const companies = db.prepare(`SELECT id FROM companies`).all() as { id: string }[];

  for (const { id: company_id } of companies) {
    const cashRow = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN type = 'asset' THEN balance ELSE -balance END), 0) as cash_balance
      FROM accounts WHERE company_id = ? AND type IN ('asset','liability')
    `).get(company_id) as { cash_balance: number } | undefined;

    const overdueRow = db.prepare(`
      SELECT COUNT(*) as invoice_overdue_count,
             COALESCE(SUM(total - amount_paid), 0) as receivables_total
      FROM invoices WHERE company_id = ? AND status = 'overdue'
    `).get(company_id) as { invoice_overdue_count: number; receivables_total: number } | undefined;

    const record: Record<string, unknown> = {
      cash_balance: cashRow?.cash_balance ?? 0,
      invoice_overdue_count: overdueRow?.invoice_overdue_count ?? 0,
      receivables_total: overdueRow?.receivables_total ?? 0,
    };

    evaluateRules({ category: 'alert', record, company_id, db });
  }
}
