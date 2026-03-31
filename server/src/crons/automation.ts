import { db } from '../db';
import { pushToDesktop } from '../ws';
import { v4 as uuidv4 } from 'uuid';

export async function runAutomations() {
  const rules = db.prepare(`SELECT * FROM automation_rules WHERE is_active = 1`).all() as any[];

  for (const rule of rules) {
    const config = JSON.parse(rule.trigger_config || '{}');
    const actions: any[] = JSON.parse(rule.actions || '[]');

    try {
      const triggered = await evaluateTrigger(rule.trigger_type, config);

      if (triggered) {
        for (const action of actions) await executeAction(action, rule);
      }

      db.prepare(
        `UPDATE automation_rules SET last_run_at = strftime('%s','now'), run_count = run_count + 1 WHERE id = ?`
      ).run(rule.id);

      db.prepare(
        `INSERT INTO automation_run_log (id, rule_id, status) VALUES (?, ?, ?)`
      ).run(uuidv4(), rule.id, triggered ? 'pass' : 'skip');
    } catch (err: any) {
      db.prepare(
        `INSERT INTO automation_run_log (id, rule_id, status, detail) VALUES (?, ?, 'fail', ?)`
      ).run(uuidv4(), rule.id, err.message);
    }
  }
}

async function evaluateTrigger(type: string, config: any): Promise<boolean> {
  switch (type) {
    case 'invoice_overdue': {
      const days = config.days_overdue ?? 1;
      const row = db.prepare(
        `SELECT COUNT(*) as n FROM invoices WHERE status NOT IN ('paid','void') AND due_date < date('now', '-${Number(days)} days')`
      ).get() as any;
      return row.n > 0;
    }
    case 'bill_due_soon': {
      const days = config.days_ahead ?? 3;
      const row = db.prepare(
        `SELECT COUNT(*) as n FROM bills WHERE status NOT IN ('paid','void') AND due_date BETWEEN date('now') AND date('now', '+${Number(days)} days')`
      ).get() as any;
      return row.n > 0;
    }
    case 'payment_received': {
      const row = db.prepare(
        `SELECT COUNT(*) as n FROM payments WHERE created_at > strftime('%s','now') - 900`
      ).get() as any;
      return row.n > 0;
    }
    case 'schedule':
      return true;
    default:
      return false;
  }
}

async function executeAction(action: any, rule: any) {
  switch (action.type) {
    case 'create_notification':
      pushToDesktop({
        type: 'notification:create',
        title: action.title ?? rule.name,
        message: action.message ?? `Automation "${rule.name}" triggered`,
        companyId: rule.company_id,
      });
      break;
    case 'update_status': {
      const { table, where_status, set_status } = action;
      if (table && where_status && set_status) {
        db.prepare(`UPDATE "${table}" SET status = ? WHERE status = ?`).run(set_status, where_status);
      }
      break;
    }
    default:
      console.warn(`Unknown action type: ${action.type}`);
  }
}
