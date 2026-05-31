// src/main/automations/payroll-hr/pto-accrual-poster.ts
//
// PTO Accrual Poster
//
// Posts due accruals defined in `pto_accrual_rules` into `pto_balances`
// and `pto_transactions`, one accrual transaction per rule per period.
//
// Design notes / safety:
//  • These three tables are NOT in schema.sql at time of writing. The
//    automation therefore probes the SQLite catalog first and degrades
//    gracefully ({ ok:false } + warning) if any table or required column
//    is missing — it NEVER throws and NEVER creates schema.
//  • Idempotent: before inserting an accrual we check that no
//    pto_transactions row already exists for (rule, employee, period).
//    Re-running the same day is a no-op.
//  • Best-effort: every db touch is wrapped in try/catch. Partial
//    failures (one bad rule) do not abort the whole run.
//  • Never moves money / never sends email — it only writes ledger rows
//    representing earned PTO hours and bumps a running balance.
//  • Period is derived from the rule's frequency; we only post a period
//    once its boundary has been crossed (period_end <= today).
//
// Style mirrors src/main/crons/overdue-checker.ts and
// src/main/services/invoice-payment-features.ts.

import * as db from '../../database';

export interface AutomationResult {
  ok: boolean;
  affected: number;
  detail: string;
  warnings?: string[];
}

export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD (matches how date columns are stored as TEXT).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Returns the period key + inclusive end-date for the period that
// CONTAINS `todayISO`, given an accrual frequency. The period key is a
// stable string used as the idempotency token in pto_transactions.
function periodFor(
  todayISO: string,
  frequency: string,
): { key: string; periodEnd: string } {
  const [y, m] = todayISO.split('-').map((n) => parseInt(n, 10));
  const f = (frequency || 'monthly').toLowerCase();
  if (f === 'weekly') {
    // ISO-ish week key anchored at the date's Monday.
    const dt = new Date(`${todayISO}T12:00:00`);
    const day = (dt.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(dt);
    monday.setDate(dt.getDate() - day);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { key: `W:${fmt(monday)}`, periodEnd: fmt(sunday) };
  }
  if (f === 'annually' || f === 'yearly' || f === 'annual') {
    return { key: `Y:${y}`, periodEnd: `${y}-12-31` };
  }
  if (f === 'quarterly') {
    const q = Math.floor((m - 1) / 3) + 1;
    const endMonth = q * 3;
    const lastDay = new Date(y, endMonth, 0).getDate();
    return { key: `Q:${y}-Q${q}`, periodEnd: `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` };
  }
  // default: monthly
  const lastDay = new Date(y, m, 0).getDate();
  return { key: `M:${y}-${String(m).padStart(2, '0')}`, periodEnd: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` };
}

function tableExists(database: any, name: string): boolean {
  try {
    const row = database
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function columnsOf(database: any, table: string): Set<string> {
  const cols = new Set<string>();
  try {
    const rows = database.prepare(`PRAGMA table_info(${table})`).all() as any[];
    for (const r of rows) if (r?.name) cols.add(String(r.name));
  } catch {
    /* ignore */
  }
  return cols;
}

function genId(): string {
  try {
    // Node 16+/Electron exposes crypto.randomUUID.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('crypto') as typeof import('crypto')).randomUUID();
  } catch {
    return `pto_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Required tables must all exist; otherwise degrade gracefully.
  const required = ['pto_accrual_rules', 'pto_balances', 'pto_transactions'];
  const missing = required.filter((t) => !tableExists(database, t));
  if (missing.length > 0) {
    return {
      ok: false,
      affected: 0,
      detail: 'PTO accrual tables not present; nothing to post.',
      warnings: [`Missing table(s): ${missing.join(', ')}`],
    };
  }

  const ruleCols = columnsOf(database, 'pto_accrual_rules');
  const txCols = columnsOf(database, 'pto_transactions');
  const balCols = columnsOf(database, 'pto_balances');

  // Minimal column contract. If absent, bail with a warning rather than
  // risk inserting against a shape we don't understand.
  const ruleHas = (c: string) => ruleCols.has(c);
  const txHas = (c: string) => txCols.has(c);
  const balHas = (c: string) => balCols.has(c);

  if (!ruleHas('id') || !ruleHas('company_id')) {
    return {
      ok: false,
      affected: 0,
      detail: 'pto_accrual_rules missing id/company_id columns.',
      warnings: ['Unexpected pto_accrual_rules shape; skipped.'],
    };
  }
  if (!txHas('id') || !txHas('company_id')) {
    return {
      ok: false,
      affected: 0,
      detail: 'pto_transactions missing id/company_id columns.',
      warnings: ['Unexpected pto_transactions shape; skipped.'],
    };
  }

  // Identify the hours/amount column on the accrual rule.
  const ruleHoursCol = ['hours_per_period', 'accrual_hours', 'hours', 'rate', 'amount', 'accrual_rate']
    .find((c) => ruleHas(c));
  // Identify the hours/amount column on the transaction.
  const txHoursCol = ['hours', 'amount', 'delta', 'hours_delta']
    .find((c) => txHas(c));
  // Identify the period idempotency column on the transaction (best),
  // else fall back to a description/notes column.
  const txPeriodCol = ['period', 'period_key', 'accrual_period', 'reference']
    .find((c) => txHas(c));
  const txDescCol = ['description', 'notes', 'memo', 'detail'].find((c) => txHas(c));
  const txTypeCol = ['type', 'transaction_type', 'kind'].find((c) => txHas(c));
  const txDateCol = ['transaction_date', 'date', 'posted_date', 'created_at'].find((c) => txHas(c));
  const txEmpCol = ['employee_id', 'emp_id'].find((c) => txHas(c));
  const ruleEmpCol = ['employee_id', 'emp_id'].find((c) => ruleHas(c));
  const ruleFreqCol = ['frequency', 'accrual_frequency', 'period', 'schedule'].find((c) => ruleHas(c));
  const ruleActiveCol = ['active', 'is_active', 'enabled', 'status'].find((c) => ruleHas(c));

  if (!ruleHoursCol || !txHoursCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'Could not identify accrual hours column on rule or transaction.',
      warnings: ['No recognized hours/amount column; skipped to stay safe.'],
    };
  }
  if (!txPeriodCol && !txDescCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'No column on pto_transactions usable for idempotency.',
      warnings: ['Need a period/description column to dedupe; skipped.'],
    };
  }

  const todayISO = ctx?.todayISO || localTodayISO();

  // Company scope.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const cur = db.getCurrentCompanyId?.();
      if (cur) companies = [{ id: cur }];
      else companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    let rules: any[] = [];
    try {
      rules = database
        .prepare(`SELECT * FROM pto_accrual_rules WHERE company_id = ?`)
        .all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Rule fetch failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const rule of rules) {
      try {
        // Skip inactive rules where determinable.
        if (ruleActiveCol) {
          const v = rule[ruleActiveCol];
          if (
            v === 0 || v === '0' || v === false ||
            v === 'inactive' || v === 'disabled' || v === 'paused'
          ) {
            continue;
          }
        }

        const hoursRaw = Number(rule[ruleHoursCol] ?? 0);
        if (!Number.isFinite(hoursRaw) || Math.abs(hoursRaw) <= 0.005) {
          continue; // nothing to accrue
        }

        const freq = ruleFreqCol ? String(rule[ruleFreqCol] ?? 'monthly') : 'monthly';
        const { key: periodKey, periodEnd } = periodFor(todayISO, freq);

        // Only post once the period boundary has been reached.
        if (periodEnd > todayISO) continue;

        const employeeId = ruleEmpCol ? rule[ruleEmpCol] : null;
        const idemToken = `accrual:${rule.id}:${periodKey}`;

        // ── Idempotency check ──────────────────────────────
        let already = false;
        try {
          if (txPeriodCol) {
            const dedupeSql =
              `SELECT 1 FROM pto_transactions WHERE company_id = ? AND ${txPeriodCol} = ?` +
              (txEmpCol && employeeId != null ? ` AND ${txEmpCol} = ?` : '');
            const params: any[] =
              txEmpCol && employeeId != null
                ? [companyId, idemToken, employeeId]
                : [companyId, idemToken];
            already = !!database.prepare(dedupeSql).get(...params);
          } else if (txDescCol) {
            already = !!database
              .prepare(
                `SELECT 1 FROM pto_transactions WHERE company_id = ? AND ${txDescCol} LIKE ?`,
              )
              .get(companyId, `%${idemToken}%`);
          }
        } catch (err: any) {
          warnings.push(`Dedupe check failed for rule ${rule.id}: ${err?.message || err}`);
          continue; // do not risk a double-post
        }
        if (already) continue;

        // ── Build the transaction insert ───────────────────
        const cols: string[] = ['id', 'company_id', txHoursCol];
        const vals: any[] = [genId(), companyId, db.roundCents ? db.roundCents(hoursRaw) : hoursRaw];

        if (txEmpCol && employeeId != null) {
          cols.push(txEmpCol);
          vals.push(employeeId);
        }
        if (txTypeCol) {
          cols.push(txTypeCol);
          vals.push('accrual');
        }
        if (txDateCol && txDateCol !== 'created_at') {
          cols.push(txDateCol);
          vals.push(periodEnd);
        }
        if (txPeriodCol) {
          cols.push(txPeriodCol);
          vals.push(idemToken);
        }
        if (txDescCol) {
          cols.push(txDescCol);
          vals.push(`PTO accrual ${periodKey} (${idemToken})`);
        }

        const placeholders = cols.map(() => '?').join(', ');
        const insertSql = `INSERT INTO pto_transactions (${cols.join(', ')}) VALUES (${placeholders})`;

        // ── Locate the balance row to bump (best-effort) ───
        let balUpdated = false;
        const balHoursCol = ['balance', 'balance_hours', 'hours', 'available_hours', 'current_hours']
          .find((c) => balHas(c));
        const balEmpCol = ['employee_id', 'emp_id'].find((c) => balHas(c));

        const tx = database.transaction(() => {
          database.prepare(insertSql).run(...vals);
          if (balHoursCol && balHas('company_id')) {
            try {
              if (balEmpCol && employeeId != null) {
                const r = database
                  .prepare(
                    `UPDATE pto_balances SET ${balHoursCol} = COALESCE(${balHoursCol}, 0) + ? WHERE company_id = ? AND ${balEmpCol} = ?`,
                  )
                  .run(hoursRaw, companyId, employeeId);
                balUpdated = r.changes > 0;
              } else {
                const r = database
                  .prepare(
                    `UPDATE pto_balances SET ${balHoursCol} = COALESCE(${balHoursCol}, 0) + ? WHERE company_id = ?`,
                  )
                  .run(hoursRaw, companyId);
                balUpdated = r.changes > 0;
              }
            } catch (e: any) {
              // Balance bump is non-fatal; the transaction ledger is the
              // source of truth. Surface as a warning only.
              throw Object.assign(new Error('balance-bump-failed'), { cause: e });
            }
          }
        });

        try {
          tx();
        } catch (err: any) {
          if (String(err?.message) === 'balance-bump-failed') {
            // Retry inserting the transaction WITHOUT the balance bump so
            // the ledger row still lands and stays idempotent next run.
            try {
              database.prepare(insertSql).run(...vals);
              warnings.push(`Posted accrual for rule ${rule.id} but balance row not updated.`);
            } catch (e2: any) {
              warnings.push(`Failed to post accrual for rule ${rule.id}: ${e2?.message || e2}`);
              continue;
            }
          } else {
            warnings.push(`Insert failed for rule ${rule.id}: ${err?.message || err}`);
            continue;
          }
        }

        affected++;
        if (!balUpdated && balHoursCol) {
          // No matching balance row existed — informational only.
          warnings.push(`No pto_balances row matched rule ${rule.id}; ledger posted.`);
        }

        try {
          db.logAudit?.(companyId, 'pto_transactions', String(rule.id), 'pto_accrual_post', {
            period: periodKey,
            hours: hoursRaw,
            employee_id: employeeId ?? null,
            automation: 'pto-accrual-poster',
          });
        } catch {
          /* audit best-effort */
        }
      } catch (err: any) {
        warnings.push(`Rule ${rule?.id ?? '?'} errored: ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail:
      affected > 0
        ? `Posted ${affected} PTO accrual transaction(s).`
        : 'No PTO accruals due this period.',
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'pto-accrual-poster',
  name: 'PTO Accrual Poster',
  domain: 'payroll-hr',
  trigger: 'monthly',
  run,
};
