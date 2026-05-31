// src/main/automations/expenses/reimbursement-batch-builder.ts
//
// Reimbursement Batch Builder
//
// Groups approved, reimbursable, not-yet-reimbursed expenses into a
// single PENDING reimbursement batch per company per run. This gives
// the AP clerk one row to act on ("pay 7 reimbursable expenses,
// $432.18 total") instead of chasing individual line items.
//
// Design / safety:
//  • DOES NOT move money, mark anything paid, or send email. It only
//    QUEUES a batch in 'pending' status and links the expenses to it
//    via a junction table. A human approves/pays the batch elsewhere.
//  • IDEMPOTENT: an expense already attached to an OPEN (pending) batch
//    is skipped, so re-running the same day never double-includes a
//    line. If no eligible un-batched expenses exist, no batch is made.
//  • DEFENSIVE: the reimbursement_batch / batch_item tables may not be
//    in schema.sql, so we CREATE TABLE IF NOT EXISTS them here and wrap
//    everything in try/catch. run() never throws.
//
// "Eligible" expense = is_reimbursable=1 AND reimbursed=0 AND
// status='approved' (only approved expenses are safe to reimburse).

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ensureTables(database: any): void {
  database.prepare(`
    CREATE TABLE IF NOT EXISTS reimbursement_batches (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      expense_count INTEGER DEFAULT 0,
      total_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      created_date TEXT DEFAULT ''
    )
  `).run();
  database.prepare(`
    CREATE TABLE IF NOT EXISTS reimbursement_batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      expense_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  try {
    ensureTables(database);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Could not ensure batch tables: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();

  // Resolve target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map((r) => ({ id: r.id }));
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  let batchesCreated = 0;
  let expensesBatched = 0;

  const insertBatch = database.prepare(`
    INSERT INTO reimbursement_batches (id, company_id, status, expense_count, total_amount, created_date)
    VALUES (?, ?, 'pending', ?, ?, ?)
  `);
  const insertItem = database.prepare(`
    INSERT INTO reimbursement_batch_items (id, batch_id, expense_id, company_id, amount)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const { id: companyId } of companies) {
    try {
      // Eligible expenses NOT already in an open (pending) batch.
      const eligible = database.prepare(`
        SELECT e.id AS id, e.amount AS amount
        FROM expenses e
        WHERE e.company_id = ?
          AND COALESCE(e.is_reimbursable, 0) = 1
          AND COALESCE(e.reimbursed, 0) = 0
          AND e.status = 'approved'
          AND NOT EXISTS (
            SELECT 1
            FROM reimbursement_batch_items bi
            JOIN reimbursement_batches b ON b.id = bi.batch_id
            WHERE bi.expense_id = e.id
              AND b.status = 'pending'
          )
      `).all(companyId) as any[];

      if (!eligible.length) continue;

      const total = eligible.reduce((s, r) => s + Number(r.amount || 0), 0);
      const batchId = newId('rbatch');

      const tx = database.transaction(() => {
        insertBatch.run(batchId, companyId, eligible.length, total, today);
        for (const e of eligible) {
          insertItem.run(newId('rbitem'), batchId, e.id, companyId, Number(e.amount || 0));
        }
      });
      tx();

      batchesCreated++;
      expensesBatched += eligible.length;

      // Audit trail (best-effort).
      try {
        db.logAudit(companyId, 'reimbursement_batches', batchId, 'auto_batch_created', {
          expense_count: eligible.length,
          total_amount: total,
          automation: 'reimbursement-batch-builder',
          date: today,
        });
      } catch { /* audit best-effort */ }
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  const detail = batchesCreated > 0
    ? `Created ${batchesCreated} pending reimbursement batch(es) covering ${expensesBatched} expense(s).`
    : 'No eligible un-batched reimbursable expenses found.';

  return {
    ok: true,
    affected: batchesCreated,
    detail,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'reimbursement-batch-builder',
  name: 'Reimbursement Batch Builder',
  domain: 'expenses',
  trigger: 'daily',
  run,
};
