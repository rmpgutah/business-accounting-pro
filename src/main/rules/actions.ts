// src/main/rules/actions.ts
import { v4 as uuid } from 'uuid';
import type { Database } from 'better-sqlite3';

export interface Action {
  type: 'discount' | 'markup' | 'set_unit_price' | 'set_tax_rate' | 'set_account' |
        'flag_approval' | 'notify' | 'send_email' | 'set_description';
  method?: 'percent' | 'fixed';
  value?: unknown;
  message?: string;
  record_type?: string;
}

export interface ActionResult {
  type: string;
  applied: boolean;
  detail?: string;
  patch?: Record<string, unknown>;
}

let _notifyFn: ((msg: string) => void) | null = null;
export function setNotifyFn(fn: (msg: string) => void): void { _notifyFn = fn; }

export function executeAction(
  action: Action,
  record: Record<string, unknown>,
  context: { db: Database; company_id: string; rule_id: string; rule_name: string }
): ActionResult {
  switch (action.type) {
    case 'discount': {
      const total = Number(record.total ?? record.amount ?? 0);
      const discount = action.method === 'percent'
        ? total * (Number(action.value) / 100)
        : Number(action.value);
      return { type: 'discount', applied: true, detail: `Discounted by ${action.value}${action.method === 'percent' ? '%' : ' (fixed)'}`, patch: { discount_amount: discount } };
    }
    case 'markup': {
      const price = Number(record.unit_price ?? record.amount ?? 0);
      const markup = action.method === 'percent'
        ? price * (Number(action.value) / 100)
        : Number(action.value);
      return { type: 'markup', applied: true, patch: { unit_price: price + markup } };
    }
    case 'set_unit_price':
      return { type: 'set_unit_price', applied: true, patch: { unit_price: Number(action.value) } };
    case 'set_tax_rate':
      return { type: 'set_tax_rate', applied: true, patch: { tax_rate: Number(action.value) } };
    case 'set_account':
      return { type: 'set_account', applied: true, patch: { account_id: String(action.value) } };
    case 'set_description':
      return { type: 'set_description', applied: true, patch: { description: String(action.value) } };
    case 'flag_approval': {
      context.db.prepare(`
        INSERT OR IGNORE INTO approval_queue (id, company_id, record_type, record_id, rule_id, rule_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuid(), context.company_id, String(action.record_type ?? record._type ?? 'invoice'), String(record.id), context.rule_id, context.rule_name);
      return { type: 'flag_approval', applied: true, detail: `Flagged for approval: ${context.rule_name}` };
    }
    case 'notify': {
      const msg = String(action.message ?? 'Rule triggered');
      if (_notifyFn) _notifyFn(msg);
      return { type: 'notify', applied: true, detail: msg };
    }
    default:
      return { type: action.type, applied: false, detail: 'Unknown action type' };
  }
}
