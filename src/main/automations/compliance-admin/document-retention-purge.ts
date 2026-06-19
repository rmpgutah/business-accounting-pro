// src/main/automations/compliance-admin/document-retention-purge.ts
//
// Document Retention Purge
//
// Soft-purges documents that have aged past the horizons defined in the
// company's retention policies. Two policy tables are consulted (either or
// both may be empty / non-existent depending on migration state):
//
//   • data_retention_policies      — entity_type + retention_days +
//                                     action_after_retention + is_active
//   • document_retention_policies  — document_type + retention_years +
//                                     auto_delete + is_active
//
// Matching: a policy applies to a `documents` row when its target type
// (entity_type / document_type) equals the document's `entity_type`.
//
// SAFETY / DESIGN:
//   • SOFT purge only — we set a `purged_at` timestamp, never DELETE the
//     row or touch the file on disk. The integrator can hard-delete files
//     in a separate, explicitly-confirmed step.
//   • We only act when the policy OPTS IN to deletion:
//       - document_retention_policies: auto_delete = 1
//       - data_retention_policies: action_after_retention IN
//         ('delete','purge','soft_delete','anonymize')  ('archive' is a
//         no-op here — archiving is out of scope for a purge job).
//   • IDEMPOTENT — already-purged rows (purged_at NOT NULL) are skipped, so
//     re-running the same day is a no-op.
//   • The `purged_at` column is added defensively at runtime via a guarded
//     ALTER TABLE (harmless if it already exists). This automation owns no
//     migration file, so it self-provisions its flag column.
//   • run() is BEST-EFFORT and NEVER throws — any failure degrades to
//     { ok:false } with a warning.

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

const SLUG = 'document-retention-purge';

// Today as YYYY-MM-DD in LOCAL time — matches how uploaded_at-derived dates
// compare. (See crons/overdue-checker.ts for the same pattern.)
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function tableExists(database: any, name: string): boolean {
  try {
    const row = database
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function columnExists(database: any, table: string, column: string): boolean {
  try {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return cols.some((c) => c && c.name === column);
  } catch {
    return false;
  }
}

interface PolicyRule {
  targetType: string; // matched against documents.entity_type
  retentionDays: number; // horizon in days
  source: string; // which policy table / row
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // documents table is mandatory for any work here.
  if (!tableExists(database, 'documents')) {
    return { ok: false, affected: 0, detail: 'documents table not found', warnings: ['documents table missing'] };
  }
  if (!columnExists(database, 'documents', 'entity_type') || !columnExists(database, 'documents', 'uploaded_at')) {
    return {
      ok: false,
      affected: 0,
      detail: 'documents table missing expected columns',
      warnings: ['documents.entity_type or documents.uploaded_at missing'],
    };
  }

  // Self-provision the soft-purge flag column (idempotent / harmless if present).
  if (!columnExists(database, 'documents', 'purged_at')) {
    try {
      database.prepare(`ALTER TABLE documents ADD COLUMN purged_at TEXT DEFAULT NULL`).run();
    } catch (err: any) {
      // If we truly cannot add the column we cannot soft-purge safely.
      if (!columnExists(database, 'documents', 'purged_at')) {
        return {
          ok: false,
          affected: 0,
          detail: 'could not provision documents.purged_at',
          warnings: [`ALTER TABLE failed: ${err?.message || err}`],
        };
      }
    }
  }

  const hasDataPolicies = tableExists(database, 'data_retention_policies');
  const hasDocPolicies = tableExists(database, 'document_retention_policies');
  if (!hasDataPolicies && !hasDocPolicies) {
    return {
      ok: true,
      affected: 0,
      detail: 'no retention policy tables present; nothing to do',
      warnings: ['neither data_retention_policies nor document_retention_policies exist'],
    };
  }

  // Resolve target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const current = (() => {
        try {
          return db.getCurrentCompanyId();
        } catch {
          return null;
        }
      })();
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  let totalPurged = 0;

  // Deletion-opt-in actions for data_retention_policies.
  const deleteActions = new Set(['delete', 'purge', 'soft_delete', 'anonymize']);

  const updateStmt = database.prepare(
    `UPDATE documents SET purged_at = ? WHERE id = ? AND purged_at IS NULL`
  );

  for (const { id: companyId } of companies) {
    const rules: PolicyRule[] = [];

    // ── data_retention_policies ──────────────────────────────
    if (hasDataPolicies) {
      try {
        const rows = database
          .prepare(
            `SELECT entity_type, retention_days, action_after_retention
               FROM data_retention_policies
              WHERE company_id = ? AND COALESCE(is_active, 1) = 1`
          )
          .all(companyId) as any[];
        for (const r of rows) {
          const action = String(r?.action_after_retention || '').toLowerCase();
          const days = Number(r?.retention_days);
          if (
            r?.entity_type &&
            deleteActions.has(action) &&
            Number.isFinite(days) &&
            days > 0
          ) {
            rules.push({
              targetType: String(r.entity_type),
              retentionDays: Math.floor(days),
              source: 'data_retention_policies',
            });
          }
        }
      } catch (err: any) {
        warnings.push(`data_retention_policies read failed (company ${companyId}): ${err?.message || err}`);
      }
    }

    // ── document_retention_policies ──────────────────────────
    if (hasDocPolicies) {
      try {
        const rows = database
          .prepare(
            `SELECT document_type, retention_years, auto_delete
               FROM document_retention_policies
              WHERE company_id = ? AND COALESCE(is_active, 1) = 1 AND COALESCE(auto_delete, 0) = 1`
          )
          .all(companyId) as any[];
        for (const r of rows) {
          const years = Number(r?.retention_years);
          if (r?.document_type && Number.isFinite(years) && years > 0) {
            rules.push({
              targetType: String(r.document_type),
              retentionDays: Math.floor(years * 365),
              source: 'document_retention_policies',
            });
          }
        }
      } catch (err: any) {
        warnings.push(`document_retention_policies read failed (company ${companyId}): ${err?.message || err}`);
      }
    }

    if (rules.length === 0) continue;

    // Collapse duplicate target types to the LONGEST horizon (most
    // conservative — never purge earlier than the strictest-keeping rule).
    const byType = new Map<string, number>();
    for (const rule of rules) {
      const prev = byType.get(rule.targetType);
      if (prev === undefined || rule.retentionDays > prev) {
        byType.set(rule.targetType, rule.retentionDays);
      }
    }

    for (const [targetType, retentionDays] of byType) {
      // cutoff = today - retentionDays. Documents uploaded on/before cutoff
      // are past their horizon. Compute via SQLite date() to avoid TZ drift
      // between JS Date math and the stored TEXT timestamps.
      try {
        const candidates = database
          .prepare(
            `SELECT id, uploaded_at
               FROM documents
              WHERE company_id = ?
                AND entity_type = ?
                AND purged_at IS NULL
                AND uploaded_at IS NOT NULL
                AND uploaded_at != ''
                AND date(uploaded_at) <= date(?, ?)`
          )
          .all(companyId, targetType, today, `-${retentionDays} days`) as any[];

        if (candidates.length === 0) continue;

        const stampedAt = `${today} ${new Date().toTimeString().slice(0, 8)}`;
        const tx = database.transaction((rows: any[]) => {
          for (const doc of rows) updateStmt.run(stampedAt, doc.id);
        });
        tx(candidates);

        totalPurged += candidates.length;

        try {
          db.logAudit(companyId, 'documents', 'retention_purge', 'update', {
            _action: 'document_retention_purge',
            entity_type: targetType,
            retention_days: retentionDays,
            documents_purged: candidates.length,
            automation: SLUG,
          });
        } catch {
          /* audit best-effort */
        }
      } catch (err: any) {
        warnings.push(
          `purge failed (company ${companyId}, type ${targetType}): ${err?.message || err}`
        );
      }
    }
  }

  return {
    ok: true,
    affected: totalPurged,
    detail:
      totalPurged > 0
        ? `Soft-purged ${totalPurged} document(s) past retention horizon`
        : 'No documents past their retention horizon',
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: SLUG,
  name: 'Document Retention Purge',
  domain: 'compliance-admin',
  trigger: 'daily',
  run,
};
