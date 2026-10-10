import type { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { syncPush } from '../../sync';
import { SYNC_SERVER } from '../core/deps';
import * as db from '../../database';
import type { IpcDeps } from '../core/types';

export function registerDebtCollectionIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const { scheduleAutoBackup, postJournalEntry, logDebtAudit, localToday, getPortalExpiryDays } =
    deps;

  // ─── Debt Portal Token: info / regenerate / disable ─────
  // The debt token is stored on the debts row itself (portal_token /
  // portal_token_expires_at columns added in round 2). If those columns
  // don't exist on a legacy DB we degrade silently rather than crashing.
  ipcMain.handle('debt:portal-token-info', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const debt = dbInstance.prepare(`SELECT * FROM debts WHERE id = ?`).get(debtId) as any;
      if (!debt) return { token: null, expiresAt: 0, lastView: null };
      let lastView: any = null;
      try {
        lastView = dbInstance
          .prepare(
            `SELECT timestamp, changes FROM audit_log
           WHERE entity_type = 'debt' AND entity_id = ? AND action = 'portal_view'
           ORDER BY timestamp DESC LIMIT 1`,
          )
          .get(debtId) as any;
      } catch {
        /* ignore */
      }
      return {
        token: debt.portal_token ?? null,
        expiresAt: debt.portal_token_expires_at ?? 0,
        lastView,
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('debt:regenerate-portal-token', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId() ?? '';
      const debt = dbInstance.prepare(`SELECT id FROM debts WHERE id = ?`).get(debtId) as any;
      if (!debt) return { error: 'Debt not found' };
      const token = crypto.randomBytes(32).toString('hex');
      const expiryDays = getPortalExpiryDays(companyId);
      const expiresAt = Math.floor(Date.now() / 1000) + expiryDays * 86400;
      // PORTAL: try to persist on the debts row; if those columns are missing
      // on an older DB, we still return the token so the immediate share works
      // (but skip sync since there's nothing to write).
      try {
        dbInstance
          .prepare(
            `UPDATE debts SET portal_token = ?, portal_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(token, expiresAt, debtId);
        syncPush({
          table_name: 'debts',
          operation: 'update',
          record_id: debtId,
          company_id: companyId,
          payload: { id: debtId, portal_token: token, portal_token_expires_at: expiresAt },
        } as any).catch(() => {});
      } catch {
        /* legacy DB without columns */
      }
      if (companyId)
        db.logAudit(companyId, 'debt', debtId, 'update', { _action: 'portal_token_regenerated' });
      const portalUrl = `${SYNC_SERVER}/portal/debt/${token}`;
      return { token, expiresAt, portalUrl };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('debt:disable-portal-token', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId() ?? '';
      try {
        dbInstance
          .prepare(
            `UPDATE debts SET portal_token_expires_at = 0, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(debtId);
        syncPush({
          table_name: 'debts',
          operation: 'update',
          record_id: debtId,
          company_id: companyId,
          payload: { id: debtId, portal_token_expires_at: 0 },
        } as any).catch(() => {});
      } catch {
        /* legacy DB */
      }
      if (companyId)
        db.logAudit(companyId, 'debt', debtId, 'update', { _action: 'portal_token_disabled' });
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('debt:invoice-link', (_event, { debtId }: { debtId: string }) => {
    try {
      return (
        db.getDb().prepare('SELECT * FROM invoice_debt_links WHERE debt_id = ?').get(debtId) || null
      );
    } catch {
      return null;
    }
  });

  // ─── Debt Promises ────────────────────────────────────
  ipcMain.handle('debt:promises-list', (_event, debtId: string) => {
    try {
      return db.queryAll(
        'debt_promises',
        { debt_id: debtId },
        { field: 'promised_date', dir: 'desc' },
      );
    } catch {
      return [];
    }
  });

  ipcMain.handle('debt:promise-save', (_event, data: Record<string, any>) => {
    try {
      const result = db.create('debt_promises', {
        debt_id: data.debt_id,
        promised_date: data.promised_date || '',
        promised_amount: Number(data.promised_amount || 0),
        kept: data.kept ? 1 : 0,
        notes: data.notes || '',
      });
      logDebtAudit(
        data.debt_id,
        'promise_recorded',
        'promised_date',
        '',
        (data.promised_date || '') + ' $' + (data.promised_amount || 0),
      );
      scheduleAutoBackup();
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'debt:promise-update',
    (_event, { id, kept, notes }: { id: string; kept: boolean; notes?: string }) => {
      try {
        const promise = db
          .getDb()
          .prepare('SELECT debt_id FROM debt_promises WHERE id = ?')
          .get(id) as any;
        const result = db.update('debt_promises', id, { kept: kept ? 1 : 0, notes: notes || '' });
        if (promise?.debt_id)
          logDebtAudit(promise.debt_id, 'promise_updated', 'kept', '', kept ? 'kept' : 'broken');
        scheduleAutoBackup();
        return result;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ─── Debt Portfolio Report Data ───────────────────────
  ipcMain.handle('debt:portfolio-report-data', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbConn = db.getDb();
      const debts = dbConn
        .prepare(`SELECT * FROM debts WHERE company_id = ? AND status != 'written_off'`)
        .all(companyId);
      const payments = dbConn
        .prepare(
          `
        SELECT dp.*, d.company_id FROM debt_payments dp
        JOIN debts d ON dp.debt_id = d.id
        WHERE d.company_id = ?
      `,
        )
        .all(companyId);
      const today = new Date();
      // DATE: build Jan 1 string from the local year — toISOString() shifts day in non-UTC zones.
      const startOfYear = `${today.getFullYear()}-01-01`;
      const paymentsYtd = payments.filter((p: any) => p.received_date >= startOfYear);
      const collectedYtd = paymentsYtd.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
      return { debts, payments, collectedYtd };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Debt Collection ────────────────────────────────────

  const DEBT_STAGE_ORDER = [
    'reminder',
    'warning',
    'final_notice',
    'demand_letter',
    'collections_agency',
    'legal_action',
    'judgment',
    'garnishment',
  ];

  function calculateDebtInterest(
    principal: number,
    rate: number,
    type: string,
    startDate: string,
    compoundFreq: number,
  ): number {
    if (!startDate || rate <= 0) return 0;
    const days = Math.max(0, Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000));
    if (days === 0) return 0;
    if (type === 'compound') {
      const years = days / 365;
      return principal * (Math.pow(1 + rate / compoundFreq, compoundFreq * years) - 1);
    }
    return principal * rate * (days / 365);
  }

  // ─── Debt: Audit Log Query ────────────────────────────
  ipcMain.handle(
    'debt:audit-log',
    (_event, { debtId, limit }: { debtId: string; limit?: number }) => {
      try {
        return db
          .getDb()
          .prepare(
            'SELECT * FROM debt_audit_log WHERE debt_id = ? ORDER BY performed_at DESC LIMIT ?',
          )
          .all(debtId, limit || 200);
      } catch (_) {
        return [];
      }
    },
  );

  ipcMain.handle('debt:generate-court-packet', async (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId();
      const debt = db.getById('debts', debtId);
      if (!debt) return { error: 'Debt not found' };
      const company = companyId ? db.getById('companies', companyId) : null;

      const communications = dbInstance
        .prepare('SELECT * FROM debt_communications WHERE debt_id = ? ORDER BY logged_at ASC')
        .all(debtId);
      const payments = dbInstance
        .prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY received_date ASC')
        .all(debtId);
      const evidence = dbInstance
        .prepare('SELECT * FROM debt_evidence WHERE debt_id = ? ORDER BY date_of_evidence ASC')
        .all(debtId);
      const compliance = dbInstance
        .prepare('SELECT * FROM debt_compliance_log WHERE debt_id = ? ORDER BY event_date ASC')
        .all(debtId);
      const auditLog = dbInstance
        .prepare('SELECT * FROM debt_audit_log WHERE debt_id = ? ORDER BY performed_at ASC')
        .all(debtId);
      const settlements = dbInstance
        .prepare('SELECT * FROM debt_settlements WHERE debt_id = ? ORDER BY created_at ASC')
        .all(debtId);
      const contacts = dbInstance
        .prepare('SELECT * FROM debt_contacts WHERE debt_id = ? ORDER BY role ASC')
        .all(debtId);
      const disputes = dbInstance
        .prepare('SELECT * FROM debt_disputes WHERE debt_id = ? ORDER BY created_at ASC')
        .all(debtId);
      const legalActions = dbInstance
        .prepare('SELECT * FROM debt_legal_actions WHERE debt_id = ? ORDER BY created_at ASC')
        .all(debtId);

      return {
        debt,
        company,
        communications,
        payments,
        evidence,
        compliance,
        auditLog,
        settlements,
        contacts,
        disputes,
        legalActions,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:batch-recalc-interest', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { updated: 0 };
      const dbInstance = db.getDb();

      const debts = dbInstance
        .prepare(
          `
        SELECT id, original_amount, interest_rate, interest_type,
               compound_frequency, interest_start_date, interest_accrued,
               fees_accrued, payments_made
        FROM debts
        WHERE company_id = ? AND status NOT IN ('settled','written_off') AND interest_rate > 0
      `,
        )
        .all(companyId) as any[];

      let updated = 0;
      const recalcTx = dbInstance.transaction(() => {
        for (const d of debts) {
          if (!d.interest_start_date) continue;
          const days = Math.max(
            0,
            (Date.now() - new Date(d.interest_start_date).getTime()) / 86_400_000,
          );
          const years = days / 365.25;
          let interest: number;

          if (d.interest_type === 'compound') {
            // CALC: A = P*(1 + r/n)^(n*t). compound_frequency = n
            // (1=annual, 4=quarterly, 12=monthly, 365=daily). Daily compound
            // = (1 + r/365)^(365*t), which is the exact form (not e^rt).
            const nRaw = Number(d.compound_frequency);
            const n = Number.isFinite(nRaw) && nRaw > 0 ? nRaw : 12;
            interest =
              d.original_amount * Math.pow(1 + d.interest_rate / n, n * years) - d.original_amount;
          } else {
            // CALC: simple interest I = P*r*t.
            interest = d.original_amount * d.interest_rate * years;
          }

          interest = Math.round(interest * 100) / 100;
          const oldInterest = d.interest_accrued || 0;
          const newBalance =
            d.original_amount + interest + (d.fees_accrued || 0) - (d.payments_made || 0);

          dbInstance
            .prepare(
              `
            UPDATE debts SET interest_accrued = ?, balance_due = ?, updated_at = datetime('now') WHERE id = ?
          `,
            )
            .run(interest, Math.round(newBalance * 100) / 100, d.id);

          logDebtAudit(
            d.id,
            'interest_recalculated',
            'interest_accrued',
            String(oldInterest.toFixed(2)),
            String(interest.toFixed(2)),
            'system',
          );
          updated++;
        }
      });
      recalcTx();
      if (updated > 0) scheduleAutoBackup();
      return { updated };
    } catch (err: any) {
      return { error: err.message, updated: 0 };
    }
  });

  ipcMain.handle('debt:smart-recommendations', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const today = localToday();
      const recommendations: Array<{
        debtId: string;
        debtorName: string;
        recommendation: string;
        reason: string;
        priority: string;
      }> = [];

      const debts = dbInstance
        .prepare(
          `
        SELECT d.*,
          (SELECT AVG(CAST(julianday(COALESCE(ps.exited_at, datetime('now'))) - julianday(ps.entered_at) AS REAL))
           FROM debt_pipeline_stages ps WHERE ps.debt_id = d.id) as avg_days_in_stage,
          (SELECT COUNT(*) FROM debt_promises dp WHERE dp.debt_id = d.id AND dp.kept = 0 AND dp.promised_date < ?) as broken_promises,
          (SELECT COUNT(*) FROM debt_legal_actions la WHERE la.debt_id = d.id) as legal_action_count,
          (SELECT COUNT(*) FROM debt_settlements s WHERE s.debt_id = d.id) as settlement_count,
          (SELECT COUNT(*) FROM debt_plan_installments pi
           JOIN debt_payment_plans pp ON pi.plan_id = pp.id
           WHERE pp.debt_id = d.id AND pi.paid = 0 AND pi.due_date < ?) as missed_installments
        FROM debts d
        WHERE d.company_id = ? AND d.status NOT IN ('settled','written_off')
        ORDER BY d.balance_due DESC
        LIMIT 100
      `,
        )
        .all(today, today, companyId) as any[];

      // Pipeline velocity averages (for "2x average" rule)
      const stageAvgs = dbInstance
        .prepare(
          `
        SELECT stage, AVG(CAST(julianday(COALESCE(exited_at, datetime('now'))) - julianday(entered_at) AS REAL)) as avg_days
        FROM debt_pipeline_stages ps
        JOIN debts d ON ps.debt_id = d.id
        WHERE d.company_id = ?
        GROUP BY stage
      `,
        )
        .all(companyId) as any[];
      const stageAvgMap: Record<string, number> = {};
      for (const sa of stageAvgs) stageAvgMap[sa.stage] = sa.avg_days || 30;

      for (const d of debts) {
        const daysDelinquent = d.delinquent_date
          ? Math.floor((Date.now() - new Date(d.delinquent_date).getTime()) / 86_400_000)
          : 0;
        const currentStageAvg = stageAvgMap[d.current_stage] || 30;
        const daysInCurrentStage = d.avg_days_in_stage || 0;

        // Rule 1: Statute expiring within 90 days
        if (d.statute_of_limitations_date) {
          const daysToStatute = Math.floor(
            (new Date(d.statute_of_limitations_date).getTime() - Date.now()) / 86_400_000,
          );
          if (daysToStatute <= 90 && daysToStatute > 0 && d.legal_action_count === 0) {
            recommendations.push({
              debtId: d.id,
              debtorName: d.debtor_name,
              recommendation: 'URGENT: File before statute expires',
              reason: `Statute expires in ${daysToStatute} days (${d.statute_of_limitations_date}). No legal action filed.`,
              priority: 'critical',
            });
            continue;
          }
        }

        // Rule 2: Broken promises >= 2 AND pre-legal
        if (
          d.broken_promises >= 2 &&
          !['legal_action', 'judgment', 'garnishment'].includes(d.current_stage)
        ) {
          recommendations.push({
            debtId: d.id,
            debtorName: d.debtor_name,
            recommendation: 'Escalate — multiple broken promises',
            reason: `${d.broken_promises} broken promises. Currently in ${d.current_stage} stage.`,
            priority: 'high',
          });
          continue;
        }

        // Rule 3: High risk + no legal action
        if (d.balance_due > 5000 && daysDelinquent > 120 && d.legal_action_count === 0) {
          recommendations.push({
            debtId: d.id,
            debtorName: d.debtor_name,
            recommendation: 'Recommend legal action',
            reason: `Balance $${d.balance_due.toFixed(0)}, ${daysDelinquent} days delinquent, no legal action filed.`,
            priority: 'high',
          });
          continue;
        }

        // Rule 4: Payment plan failing (2+ missed installments)
        if (d.missed_installments >= 2) {
          recommendations.push({
            debtId: d.id,
            debtorName: d.debtor_name,
            recommendation: 'Payment plan failing — renegotiate or escalate',
            reason: `${d.missed_installments} missed installments on active payment plan.`,
            priority: 'high',
          });
          continue;
        }

        // Rule 5: No settlement offered for large old debts
        if (d.balance_due > 5000 && daysDelinquent > 120 && d.settlement_count === 0) {
          recommendations.push({
            debtId: d.id,
            debtorName: d.debtor_name,
            recommendation: 'Consider settlement offer at 70%',
            reason: `Balance $${d.balance_due.toFixed(0)}, ${daysDelinquent} days delinquent, no settlement offered.`,
            priority: 'medium',
          });
          continue;
        }

        // Rule 6: Days in stage > 2x average
        if (daysInCurrentStage > currentStageAvg * 2 && currentStageAvg > 0) {
          recommendations.push({
            debtId: d.id,
            debtorName: d.debtor_name,
            recommendation: 'Consider advancing to next stage',
            reason: `${Math.round(daysInCurrentStage)} days in ${d.current_stage} (avg: ${Math.round(currentStageAvg)} days).`,
            priority: 'medium',
          });
          continue;
        }

        // Rule 7: C&D active + no legal counsel
        if (d.cease_desist_active && d.legal_action_count === 0) {
          recommendations.push({
            debtId: d.id,
            debtorName: d.debtor_name,
            recommendation: 'Legal counsel needed — C&D limits options',
            reason: 'Cease & desist is active but no legal action or counsel assigned.',
            priority: 'high',
          });
        }
      }

      // Sort: critical first, then high, then medium
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
      recommendations.sort(
        (a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9),
      );

      return recommendations.slice(0, 20);
    } catch (err: any) {
      console.error('debt:smart-recommendations error:', err);
      return [];
    }
  });

  ipcMain.handle('debt:stats', (_event, { companyId }: { companyId: string }) => {
    const row = db
      .getDb()
      .prepare(
        `
      SELECT
        COALESCE(SUM(CASE WHEN status NOT IN ('settled','written_off') THEN balance_due ELSE 0 END), 0) as total_outstanding,
        COALESCE(SUM(CASE WHEN status = 'in_collection' THEN 1 ELSE 0 END), 0) as in_collection,
        COALESCE(SUM(CASE WHEN status = 'legal' THEN 1 ELSE 0 END), 0) as legal_active,
        COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp JOIN debts d ON dp.debt_id = d.id WHERE d.company_id = ? AND strftime('%Y-%m', dp.received_date) = strftime('%Y-%m', 'now')), 0) as collected_this_month,
        COALESCE(SUM(CASE WHEN status = 'written_off' AND strftime('%Y', updated_at) = strftime('%Y', 'now') THEN original_amount ELSE 0 END), 0) as writeoffs_ytd
      FROM debts WHERE company_id = ?
    `,
      )
      .get(companyId, companyId) as any;
    return row;
  });

  ipcMain.handle('debt:calculate-interest', (_event, { debtId }: { debtId: string }) => {
    const debt = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
    if (!debt) return { interest: 0, total: 0 };
    const interest = calculateDebtInterest(
      debt.original_amount,
      debt.interest_rate,
      debt.interest_type,
      debt.interest_start_date,
      debt.compound_frequency,
    );
    const rounded = Math.round(interest * 100) / 100;
    db.getDb()
      .prepare(
        "UPDATE debts SET interest_accrued = ?, balance_due = original_amount + ? + fees_accrued - payments_made, updated_at = datetime('now') WHERE id = ?",
      )
      .run(rounded, rounded, debtId);
    scheduleAutoBackup();
    return {
      interest: rounded,
      total: debt.original_amount + rounded + debt.fees_accrued - debt.payments_made,
    };
  });

  ipcMain.handle(
    'debt:advance-stage',
    (_event, { debtId, notes }: { debtId: string; notes?: string }) => {
      const debt = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
      if (!debt) throw new Error('Debt not found');
      const oldStage = debt.current_stage || '';
      const currentIdx = DEBT_STAGE_ORDER.indexOf(debt.current_stage);
      if (currentIdx < 0 || currentIdx >= DEBT_STAGE_ORDER.length - 1) return;
      const nextStage = DEBT_STAGE_ORDER[currentIdx + 1];
      // Close current stage
      db.getDb()
        .prepare(
          "UPDATE debt_pipeline_stages SET exited_at = datetime('now') WHERE debt_id = ? AND stage = ? AND exited_at IS NULL",
        )
        .run(debtId, debt.current_stage);
      // Open next stage
      db.getDb()
        .prepare('INSERT INTO debt_pipeline_stages (id, debt_id, stage, notes) VALUES (?, ?, ?, ?)')
        .run(uuid(), debtId, nextStage, notes || '');
      // Update debt
      const newStatus = ['legal_action', 'judgment', 'garnishment'].includes(nextStage)
        ? 'legal'
        : 'in_collection';
      db.getDb()
        .prepare(
          "UPDATE debts SET current_stage = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(nextStage, newStatus, debtId);
      logDebtAudit(debtId, 'stage_advance', 'current_stage', oldStage, nextStage);
      scheduleAutoBackup();
    },
  );

  ipcMain.handle(
    'debt:hold-toggle',
    (_event, { debtId, hold, reason }: { debtId: string; hold: boolean; reason?: string }) => {
      db.getDb()
        .prepare(
          "UPDATE debts SET hold = ?, hold_reason = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(hold ? 1 : 0, reason || '', debtId);
      logDebtAudit(debtId, 'hold_toggle', 'hold', hold ? '0' : '1', hold ? '1' : '0');
      scheduleAutoBackup();
    },
  );

  ipcMain.handle(
    'debt:assign-collector',
    (_event, { debtId, collectorId }: { debtId: string; collectorId: string | null }) => {
      try {
        const oldDebt = db.getById('debts', debtId);
        db.update('debts', debtId, { assigned_collector_id: collectorId || null });
        logDebtAudit(
          debtId,
          'assignment_change',
          'assigned_collector_id',
          oldDebt?.assigned_collector_id || '',
          collectorId || '',
        );
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  ipcMain.handle(
    'debt:import-overdue',
    (_event, { companyId, daysThreshold }: { companyId: string; daysThreshold: number }) => {
      const dbInstance = db.getDb();
      const overdue = dbInstance
        .prepare(
          `
      SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
             c.address_line1 || ' ' || c.city || ' ' || c.state || ' ' || c.zip as client_address
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.company_id = ? AND i.status = 'overdue'
      AND julianday('now') - julianday(i.due_date) >= ?
      AND i.id NOT IN (SELECT source_id FROM debts WHERE source_type = 'invoice' AND company_id = ?)
    `,
        )
        .all(companyId, daysThreshold, companyId) as any[];

      const importTx = dbInstance.transaction(() => {
        let imported = 0;
        for (const inv of overdue) {
          const id = uuid();
          const balance = (inv.total || inv.amount || 0) - (inv.amount_paid || 0);
          dbInstance
            .prepare(
              `
          INSERT INTO debts (id, company_id, type, status, debtor_id, debtor_type, debtor_name, debtor_email, debtor_phone, debtor_address, source_type, source_id, original_amount, balance_due, due_date, delinquent_date, current_stage)
          VALUES (?, ?, 'receivable', 'active', ?, 'client', ?, ?, ?, ?, 'invoice', ?, ?, ?, ?, ?, 'reminder')
        `,
            )
            .run(
              id,
              companyId,
              inv.client_id || '',
              inv.client_name || 'Unknown',
              inv.client_email || '',
              inv.client_phone || '',
              inv.client_address || '',
              inv.id,
              balance,
              balance,
              inv.due_date || '',
              inv.due_date || '',
            );
          dbInstance
            .prepare('INSERT INTO debt_pipeline_stages (id, debt_id, stage) VALUES (?, ?, ?)')
            .run(uuid(), id, 'reminder');
          imported++;
        }
        return { imported };
      });

      const result = importTx();
      if (result.imported > 0) scheduleAutoBackup();
      return result;
    },
  );

  ipcMain.handle(
    'debt:generate-demand-letter',
    (_event, { debtId, templateId }: { debtId: string; templateId: string }) => {
      const debt = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
      const template = db
        .getDb()
        .prepare('SELECT * FROM debt_templates WHERE id = ?')
        .get(templateId) as any;
      if (!debt || !template) return { html: '' };
      const company = db
        .getDb()
        .prepare('SELECT * FROM companies WHERE id = ?')
        .get(debt.company_id) as any;

      // Escape merge VALUES (from DB) so debtor data can't break template HTML.
      // Template body/subject itself is admin-authored and may legitimately contain HTML,
      // so we don't escape those — only the values substituted into them.
      const escVal = (s: unknown): string => {
        if (s === null || s === undefined) return '';
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      };
      const fmtMoney = (n: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
      const fmtDate = (d: unknown) => {
        if (!d) return '';
        try {
          const s = String(d);
          const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
          if (isNaN(dt.getTime())) return escVal(s);
          return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        } catch {
          return escVal(d);
        }
      };

      const total =
        (debt.original_amount || 0) +
        (debt.interest_accrued || 0) +
        (debt.fees_accrued || 0) -
        (debt.payments_made || 0);
      // TZ-safe daysOverdue: anchor YYYY-MM-DD at noon local time so UTC parsing
      // can't shift the calendar day on negative-offset machines.
      const dlqRaw = debt.delinquent_date ? String(debt.delinquent_date) : '';
      const dlqStr = /^\d{4}-\d{2}-\d{2}$/.test(dlqRaw) ? dlqRaw + 'T12:00:00' : dlqRaw;
      const daysOverdue = dlqStr
        ? Math.max(0, Math.floor((Date.now() - new Date(dlqStr).getTime()) / 86400000))
        : 0;
      const demandDeadlineDate = new Date(Date.now() + 10 * 86400000);

      const cityStateZip =
        [company?.city, company?.state].filter(Boolean).join(', ') +
        (company?.zip ? ' ' + company.zip : '');
      const companyAddr = [company?.address_line1, company?.address_line2, cityStateZip.trim()]
        .filter((s: any) => s && String(s).trim())
        .join(', ');

      const fields: Record<string, string> = {
        '{{debtor_name}}': escVal(debt.debtor_name),
        '{{debtor_address}}': escVal(debt.debtor_address),
        '{{original_amount}}': fmtMoney(debt.original_amount),
        '{{interest_accrued}}': fmtMoney(debt.interest_accrued),
        '{{fees_accrued}}': fmtMoney(debt.fees_accrued),
        '{{total_due}}': fmtMoney(total),
        '{{due_date}}': fmtDate(debt.due_date),
        '{{demand_deadline}}': fmtDate(demandDeadlineDate.toISOString().split('T')[0]),
        '{{days_overdue}}': String(daysOverdue),
        '{{company_name}}': escVal(company?.name),
        '{{company_address}}': escVal(companyAddr),
        '{{company_phone}}': escVal(company?.phone),
        '{{company_email}}': escVal(company?.email),
        // Spec-required jurisdiction tokens (resolved from debt then company; falls back to "________________"
        // so authors using the token in a custom template never see a literal "{{state}}" leak through).
        '{{state}}': escVal(debt.jurisdiction || company?.state || '________________'),
        '{{jurisdiction}}': escVal(debt.jurisdiction || company?.state || '________________'),
      };

      let body = template.body || '';
      let subject = template.subject || '';
      for (const [key, val] of Object.entries(fields)) {
        body = body.split(key).join(val);
        subject = subject.split(key).join(val);
      }

      // Wrap in a print-ready letterhead for proper PDF output
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Demand Letter</title><style>
      * { box-sizing: border-box; }
      body { font-family: 'Georgia', 'Times New Roman', serif; color: #0f172a; padding: 60px; max-width: 720px; margin: 0 auto; font-size: 13px; line-height: 1.65; background: #fff; }
      h2 { font-size: 18px; font-weight: 700; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin: 0 0 24px; }
      .letter-body { white-space: pre-wrap; }
    </style></head><body>
      <h2>${subject}</h2>
      <div class="letter-body">${body}</div>
    </body></html>`;

      return { html };
    },
  );

  ipcMain.handle('debt:seed-automation', (_event, { companyId }: { companyId: string }) => {
    const existing = db
      .getDb()
      .prepare('SELECT COUNT(*) as cnt FROM debt_automation_rules WHERE company_id = ?')
      .get(companyId) as any;
    if (existing.cnt > 0) return;
    const defaults: Array<{
      from: string;
      to: string;
      days: number;
      action: string;
      review: number;
    }> = [
      { from: 'reminder', to: 'warning', days: 14, action: 'advance_stage', review: 0 },
      { from: 'warning', to: 'final_notice', days: 14, action: 'advance_stage', review: 0 },
      { from: 'final_notice', to: 'demand_letter', days: 7, action: 'advance_stage', review: 0 },
      {
        from: 'demand_letter',
        to: 'collections_agency',
        days: 14,
        action: 'flag_review',
        review: 1,
      },
      {
        from: 'collections_agency',
        to: 'legal_action',
        days: 30,
        action: 'flag_review',
        review: 1,
      },
    ];
    const stmt = db
      .getDb()
      .prepare(
        'INSERT INTO debt_automation_rules (id, company_id, from_stage, to_stage, days_after_entry, action, require_review) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
    for (const d of defaults) stmt.run(uuid(), companyId, d.from, d.to, d.days, d.action, d.review);
    scheduleAutoBackup();
  });

  ipcMain.handle('debt:seed-templates', (_event, { companyId }: { companyId: string }) => {
    const existing = db
      .getDb()
      .prepare('SELECT COUNT(*) as cnt FROM debt_templates WHERE company_id = ?')
      .get(companyId) as any;
    if (existing.cnt > 0) return;
    const templates = [
      {
        name: 'Friendly Reminder',
        type: 'reminder',
        severity: 'friendly',
        subject: 'Friendly Reminder \u2014 Payment Due',
        body: "Dear {{debtor_name}},\n\nThis is a friendly reminder that your payment of {{total_due}} was due on {{due_date}}. If you have already sent your payment, please disregard this notice.\n\nIf you have any questions about your balance, please don't hesitate to contact us at {{company_phone}} or {{company_email}}.\n\nThank you for your prompt attention to this matter.\n\nSincerely,\n{{company_name}}",
      },
      {
        name: 'Formal Warning',
        type: 'warning',
        severity: 'formal',
        subject: 'Important Notice \u2014 Past Due Balance of {{total_due}}',
        body: 'Dear {{debtor_name}},\n\nDespite our previous correspondence, your account remains past due in the amount of {{total_due}}. This balance has been outstanding for {{days_overdue}} days.\n\nPlease be advised that interest continues to accrue on this balance at the applicable rate. The current interest charged is {{interest_accrued}}.\n\nWe request immediate payment within 14 days of this notice. Failure to remit payment may result in further collection action.\n\nPlease direct payment or inquiries to:\n{{company_name}}\n{{company_address}}\n{{company_phone}}\n{{company_email}}',
      },
      {
        name: 'Final Demand',
        type: 'demand_letter',
        severity: 'final',
        subject: 'FINAL DEMAND \u2014 Immediate Payment Required',
        body: 'RE: Past Due Account \u2014 {{total_due}}\n\nDear {{debtor_name}},\n\nThis letter serves as FINAL DEMAND for payment of the outstanding balance of {{total_due}}, which includes:\n\n  Original Amount: {{original_amount}}\n  Accrued Interest: {{interest_accrued}}\n  Fees: {{fees_accrued}}\n\nThis amount has been past due since {{due_date}} ({{days_overdue}} days).\n\nYOU MUST REMIT FULL PAYMENT BY {{demand_deadline}}.\n\nFailure to pay by this date will result in this matter being referred for legal action, which may include filing a lawsuit to recover the full amount owed plus court costs, attorney fees, and any additional interest permitted by law.\n\nThis is not a threat but a statement of our intent to pursue all available legal remedies.\n\n{{company_name}}\n{{company_address}}\n{{company_phone}}',
      },
    ];
    const stmt = db
      .getDb()
      .prepare(
        'INSERT INTO debt_templates (id, company_id, name, type, subject, body, severity, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      );
    for (const t of templates)
      stmt.run(uuid(), companyId, t.name, t.type, t.subject, t.body, t.severity);
    scheduleAutoBackup();
  });

  ipcMain.handle('debt:run-escalation', (_event, { companyId }: { companyId: string }) => {
    const dbInstance = db.getDb();
    const rules = dbInstance
      .prepare(
        'SELECT * FROM debt_automation_rules WHERE company_id = ? AND enabled = 1 AND debt_id IS NULL',
      )
      .all(companyId) as any[];
    let advanced = 0,
      flagged = 0;
    // Wrap the whole escalation pass in one transaction so a partial failure
    // can't leave a debt with `current_stage` advanced but no matching pipeline-
    // stage row (or vice versa).
    const escalateTx = dbInstance.transaction(() => {
      for (const rule of rules) {
        const debts = dbInstance
          .prepare(
            `
          SELECT d.id FROM debts d
          JOIN debt_pipeline_stages dps ON dps.debt_id = d.id AND dps.stage = d.current_stage AND dps.exited_at IS NULL
          WHERE d.company_id = ? AND d.current_stage = ? AND d.hold = 0
          AND d.status NOT IN ('settled','written_off','bankruptcy')
          AND julianday('now') - julianday(dps.entered_at) >= ?
        `,
          )
          .all(companyId, rule.from_stage, rule.days_after_entry) as any[];
        for (const debt of debts) {
          if (rule.require_review) {
            flagged++;
          } else {
            const currentDebt = dbInstance
              .prepare('SELECT current_stage FROM debts WHERE id = ?')
              .get(debt.id) as any;
            const currentIdx = DEBT_STAGE_ORDER.indexOf(currentDebt.current_stage);
            if (currentIdx >= 0 && currentIdx < DEBT_STAGE_ORDER.length - 1) {
              const nextStage = DEBT_STAGE_ORDER[currentIdx + 1];
              dbInstance
                .prepare(
                  "UPDATE debt_pipeline_stages SET exited_at = datetime('now') WHERE debt_id = ? AND stage = ? AND exited_at IS NULL",
                )
                .run(debt.id, currentDebt.current_stage);
              dbInstance
                .prepare(
                  'INSERT INTO debt_pipeline_stages (id, debt_id, stage, auto_advanced) VALUES (?, ?, ?, 1)',
                )
                .run(uuid(), debt.id, nextStage);
              const newStatus = ['legal_action', 'judgment', 'garnishment'].includes(nextStage)
                ? 'legal'
                : 'in_collection';
              dbInstance
                .prepare(
                  "UPDATE debts SET current_stage = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
                )
                .run(nextStage, newStatus, debt.id);
              advanced++;
            }
          }
        }
      }
    });
    escalateTx();
    if (advanced > 0) scheduleAutoBackup();
    return { advanced, flagged };
  });

  ipcMain.handle(
    'debt:analytics',
    (
      _event,
      { companyId, startDate, endDate }: { companyId: string; startDate: string; endDate: string },
    ) => {
      // Collection rate by month
      const collectionByMonth = db
        .getDb()
        .prepare(
          `
      SELECT strftime('%Y-%m', dp.received_date) as month, SUM(dp.amount) as total
      FROM debt_payments dp JOIN debts d ON dp.debt_id = d.id
      -- DATE: Item #6 — date() wrap so timestamp values match date-only bounds.
      WHERE d.company_id = ? AND date(dp.received_date) BETWEEN date(?) AND date(?)
      GROUP BY month ORDER BY month
    `,
        )
        .all(companyId, startDate, endDate);

      // Aging breakdown
      const aging = db
        .getDb()
        .prepare(
          `
      SELECT
        CASE
          WHEN julianday('now') - julianday(delinquent_date) <= 30 THEN '0-30'
          WHEN julianday('now') - julianday(delinquent_date) <= 60 THEN '31-60'
          WHEN julianday('now') - julianday(delinquent_date) <= 90 THEN '61-90'
          WHEN julianday('now') - julianday(delinquent_date) <= 120 THEN '91-120'
          WHEN julianday('now') - julianday(delinquent_date) <= 180 THEN '121-180'
          ELSE '180+'
        END as bucket,
        COUNT(*) as count, SUM(balance_due) as total
      FROM debts WHERE company_id = ? AND status NOT IN ('settled','written_off') AND delinquent_date IS NOT NULL
      GROUP BY bucket
    `,
        )
        .all(companyId);

      // Recovery by stage
      const recoveryByStage = db
        .getDb()
        .prepare(
          `
      SELECT current_stage as stage, COUNT(*) as count
      FROM debts WHERE company_id = ? AND status IN ('settled','written_off')
      GROUP BY current_stage
    `,
        )
        .all(companyId);

      // Top debtors
      const topDebtors = db
        .getDb()
        .prepare(
          `
      SELECT debtor_name, SUM(balance_due) as total
      FROM debts WHERE company_id = ? AND status NOT IN ('settled','written_off')
      GROUP BY debtor_name ORDER BY total DESC LIMIT 10
    `,
        )
        .all(companyId);

      // Pipeline velocity
      const velocity = db
        .getDb()
        .prepare(
          `
      SELECT stage, AVG(julianday(exited_at) - julianday(entered_at)) as avg_days
      FROM debt_pipeline_stages WHERE exited_at IS NOT NULL
      AND debt_id IN (SELECT id FROM debts WHERE company_id = ?)
      GROUP BY stage
    `,
        )
        .all(companyId);

      return { collectionByMonth, aging, recoveryByStage, topDebtors, velocity };
    },
  );

  // ─── Debt Payment Plans ───────────────────────────────────
  ipcMain.handle('debt:payment-plan-get', (_event, { debtId }) => {
    try {
      const plan = db.queryAll('debt_payment_plans', { debt_id: debtId })[0] || null;
      if (!plan) return null;
      const installments = db.queryAll(
        'debt_plan_installments',
        { plan_id: plan.id },
        { field: 'due_date', dir: 'asc' },
      );
      return { ...plan, installments };
    } catch {
      return null;
    }
  });

  ipcMain.handle('debt:payment-plan-save', (_event, data) => {
    try {
      const { debt_id, installment_amount, frequency, start_date, total_installments, notes } =
        data;
      const dbInstance = db.getDb();
      // Run the delete+create+installment-inserts in a single transaction so
      // a mid-loop failure can't leave the debt with an old plan deleted but
      // no replacement, or a new plan with only some installments inserted.
      let planId = '';
      const planTx = dbInstance.transaction(() => {
        const existing = db.queryAll('debt_payment_plans', { debt_id })[0];
        if (existing) {
          dbInstance
            .prepare('DELETE FROM debt_plan_installments WHERE plan_id = ?')
            .run(existing.id);
          db.remove('debt_payment_plans', existing.id);
        }
        const plan = db.create('debt_payment_plans', {
          debt_id,
          installment_amount,
          frequency,
          start_date,
          total_installments: total_installments || 1,
          notes: notes || '',
          status: 'active',
        });
        planId = plan.id;
        const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
        const days = freqDays[frequency] || 30;
        const d = new Date(start_date + 'T12:00:00');
        // CALC: Standard amortization. Each installment payment is constant
        // (= installment_amount). Per-installment interest = balance * rate
        // per period; principal = payment - interest; new balance = balance
        // - principal. Source: standard mortgage/loan amortization formula
        //   PMT = P * r * (1+r)^n / ((1+r)^n - 1).
        // Without dedicated principal/interest columns we cannot persist the
        // split here, but we DO validate that the chosen installment_amount
        // is at least sufficient to cover first-period interest — otherwise
        // the loan never amortizes. The notes column receives a warning.
        const debtRow = dbInstance
          .prepare('SELECT balance_due, interest_rate, interest_type FROM debts WHERE id = ?')
          .get(debt_id) as any;
        const periodsPerYear = frequency === 'weekly' ? 52 : frequency === 'biweekly' ? 26 : 12;
        const principal = Number(debtRow?.balance_due) || 0;
        const annualRate = Number(debtRow?.interest_rate) || 0;
        const periodRate = annualRate / periodsPerYear;
        const firstInterest = principal * periodRate;
        if (
          Number(installment_amount) > 0 &&
          firstInterest > 0 &&
          Number(installment_amount) < firstInterest
        ) {
          // Negative-amortization warning — installment doesn't even cover
          // interest, balance grows.
          // Stored as part of the plan's notes field for visibility.
          const warn = ` [warning: installment $${Number(installment_amount).toFixed(2)} < first-period interest $${firstInterest.toFixed(2)} — negative amortization]`;
          dbInstance
            .prepare("UPDATE debt_payment_plans SET notes = COALESCE(notes,'') || ? WHERE id = ?")
            .run(warn, plan.id);
        }
        for (let i = 0; i < (total_installments || 1); i++) {
          db.create('debt_plan_installments', {
            plan_id: plan.id,
            due_date: d.toISOString().slice(0, 10),
            amount: installment_amount,
            paid: 0,
          });
          d.setDate(d.getDate() + days);
        }
      });
      planTx();
      logDebtAudit(
        debt_id,
        'plan_created',
        'payment_plan',
        '',
        installment_amount ? '$' + installment_amount + ' plan' : 'Plan saved',
      );
      scheduleAutoBackup();
      return db.queryAll(
        'debt_plan_installments',
        { plan_id: planId },
        { field: 'due_date', dir: 'asc' },
      );
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:plan-installment-toggle', (_event, { installmentId, paid }) => {
    try {
      db.update('debt_plan_installments', installmentId, {
        paid: paid ? 1 : 0,
        paid_date: paid ? localToday() : '',
      });
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:settlements-list', (_event, { debtId }) => {
    try {
      return db.queryAll(
        'debt_settlements',
        { debt_id: debtId },
        { field: 'created_at', dir: 'desc' },
      );
    } catch {
      return [];
    }
  });

  ipcMain.handle('debt:settlement-save', (_event, data) => {
    try {
      const { debt_id, offer_amount, balance_due, offered_date, notes } = data;
      const offer_pct = balance_due > 0 ? (offer_amount / balance_due) * 100 : 0;
      const result = db.create('debt_settlements', {
        debt_id,
        offer_amount,
        offer_pct,
        offered_date,
        notes: notes || '',
        response: 'pending',
      });
      logDebtAudit(debt_id, 'settlement_offered', 'offer_amount', '', String(offer_amount || 0));
      scheduleAutoBackup();
      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle(
    'debt:settlement-respond',
    (_event, { settlementId, response, counter_amount }) => {
      try {
        const data: any = { response };
        if (response === 'accepted') data.accepted_date = localToday();
        if (counter_amount != null) data.counter_amount = counter_amount;
        db.update('debt_settlements', settlementId, data);
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  ipcMain.handle('debt:settlement-accept', (_event, { debtId, settlementId, offer_amount }) => {
    try {
      // CALC: Settlement-accept write-off JE (GAAP — direct write-off method).
      // When a creditor accepts < balance_due, the difference (forgiven
      // portion) is a bad-debt expense. JE: Dr Bad Debt Expense / Cr A/R
      // (or whatever the receivable account is). The collected portion is
      // recognized via the normal payment flow; here we only book the
      // shortfall write-off so the balance closes to zero.
      const dbi = db.getDb();
      const debt = dbi.prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
      const companyId = debt?.company_id || db.getCurrentCompanyId();
      const priorBalance = Number(debt?.balance_due) || 0;
      const writeOff = Math.max(
        0,
        Math.round((priorBalance - Number(offer_amount || 0)) * 100) / 100,
      );

      db.update('debt_settlements', settlementId, {
        response: 'accepted',
        accepted_date: localToday(),
      });
      db.update('debts', debtId, { status: 'settled', balance_due: offer_amount });

      if (companyId && writeOff > 0) {
        try {
          postJournalEntry(
            dbi,
            companyId,
            localToday(),
            `Settlement write-off — debt ${debt?.debtor_name || debtId.slice(0, 8)}`,
            [
              {
                nameHint: 'Bad Debt',
                debit: writeOff,
                credit: 0,
                note: 'Forgiven portion of settled debt',
              },
              {
                nameHint: 'Receivable',
                debit: 0,
                credit: writeOff,
                note: `A/R write-off for debt ${debtId.slice(0, 8)}`,
              },
            ],
          );
        } catch (err) {
          console.warn('settlement-accept: write-off JE failed:', (err as Error)?.message);
        }
      }

      logDebtAudit(debtId, 'settlement_accepted', 'status', 'in_collection', 'settled');
      scheduleAutoBackup();
      return { ok: true, write_off_amount: writeOff };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:compliance-list', (_event, { debtId }) => {
    try {
      return db.queryAll(
        'debt_compliance_log',
        { debt_id: debtId },
        { field: 'event_date', dir: 'desc' },
      );
    } catch {
      return [];
    }
  });

  ipcMain.handle('debt:compliance-save', (_event, data) => {
    try {
      const result = db.create('debt_compliance_log', data);
      logDebtAudit(data.debt_id, 'compliance_event', 'event_type', '', data.event_type || '');
      scheduleAutoBackup();
      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:check-auto-advance', (_event, { companyId, thresholdDays = 30 }) => {
    try {
      const STAGE_ORDER = [
        'reminder',
        'warning',
        'final_notice',
        'demand_letter',
        'collections_agency',
        'legal_action',
      ];
      const debts = db.queryAll('debts', { company_id: companyId, auto_advance_enabled: 1 });
      let advanced = 0;
      const now = new Date();

      for (const debt of debts) {
        const stageIdx = STAGE_ORDER.indexOf(debt.current_stage);
        if (stageIdx < 0 || stageIdx >= STAGE_ORDER.length - 1) continue;

        const lastActivity = new Date(debt.updated_at || debt.created_at);
        const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / 86400000);

        if (daysSince >= thresholdDays) {
          const nextStage = STAGE_ORDER[stageIdx + 1];
          db.update('debts', debt.id, { current_stage: nextStage });
          db.create('debt_pipeline_stages', {
            debt_id: debt.id,
            stage: nextStage,
            auto_advanced: 1,
            advanced_by: 'system',
          });
          db.create('debt_communications', {
            debt_id: debt.id,
            type: 'letter',
            direction: 'outbound',
            subject: 'Auto-advance notification',
            body: `Auto-advanced from ${debt.current_stage} to ${nextStage} after ${daysSince} days of inactivity.`,
            outcome: 'auto_advanced',
            logged_by: 'system',
          });
          advanced++;
        }
      }

      if (advanced > 0) scheduleAutoBackup();
      return { advanced };
    } catch (err: any) {
      return { error: err.message, advanced: 0 };
    }
  });

  // ─── Debt Activity Timeline ──────────────────────────────
  ipcMain.handle('debt:activity-timeline', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbConn = db.getDb();
      const events: Array<{
        id: string;
        ts: string;
        kind: string;
        label: string;
        detail: string;
        icon: string;
      }> = [];

      // Communications
      const comms = dbConn
        .prepare(
          `SELECT id, type, direction, subject, outcome, logged_at FROM debt_communications WHERE debt_id = ? ORDER BY logged_at DESC`,
        )
        .all(debtId) as any[];
      for (const c of comms) {
        const dir = c.direction === 'inbound' ? '← Inbound' : '→ Outbound';
        events.push({
          id: c.id,
          ts: c.logged_at,
          kind: 'comm',
          label: `${dir} ${c.type}`,
          detail: c.subject || c.outcome || '',
          icon: 'comm',
        });
      }

      // Stage changes
      const stages = dbConn
        .prepare(
          `SELECT id, stage, entered_at, exited_at, notes FROM debt_pipeline_stages WHERE debt_id = ? ORDER BY entered_at DESC`,
        )
        .all(debtId) as any[];
      for (const s of stages) {
        events.push({
          id: s.id,
          ts: s.entered_at,
          kind: 'stage',
          label: `Stage: ${s.stage.replace(/_/g, ' ')}`,
          detail: s.notes || '',
          icon: 'stage',
        });
      }

      // Payments
      const payments = dbConn
        .prepare(
          `SELECT id, amount, received_date, payment_method, notes FROM debt_payments WHERE debt_id = ? ORDER BY received_date DESC`,
        )
        .all(debtId) as any[];
      for (const p of payments) {
        events.push({
          id: p.id,
          ts: p.received_date + 'T00:00:00',
          kind: 'payment',
          label: `Payment received: $${Number(p.amount).toFixed(2)}`,
          detail: [p.payment_method, p.notes].filter(Boolean).join(' — '),
          icon: 'payment',
        });
      }

      // Promises
      const promises = dbConn
        .prepare(
          `SELECT id, promised_date, promised_amount, kept, notes FROM debt_promises WHERE debt_id = ? ORDER BY promised_date DESC`,
        )
        .all(debtId) as any[];
      for (const p of promises) {
        const status = p.kept ? 'Kept' : p.promised_date < localToday() ? 'Broken' : 'Pending';
        events.push({
          id: p.id,
          ts: p.promised_date + 'T00:00:00',
          kind: 'promise',
          label: `Promise to pay $${Number(p.promised_amount).toFixed(2)} — ${status}`,
          detail: p.notes || '',
          icon: 'promise',
        });
      }

      // Compliance events
      const compliance = dbConn
        .prepare(
          `SELECT id, event_type, event_date, notes FROM debt_compliance_log WHERE debt_id = ? ORDER BY event_date DESC`,
        )
        .all(debtId) as any[];
      for (const c of compliance) {
        events.push({
          id: c.id,
          ts: c.event_date + 'T00:00:00',
          kind: 'compliance',
          label: `Compliance: ${c.event_type.replace(/_/g, ' ')}`,
          detail: c.notes || '',
          icon: 'compliance',
        });
      }

      // Settlements
      const settlements = dbConn
        .prepare(
          `SELECT id, offer_amount, response, offered_date, notes FROM debt_settlements WHERE debt_id = ? ORDER BY offered_date DESC`,
        )
        .all(debtId) as any[];
      for (const s of settlements) {
        events.push({
          id: s.id,
          ts: s.offered_date + 'T00:00:00',
          kind: 'settlement',
          label: `Settlement offer: $${Number(s.offer_amount).toFixed(2)} — ${s.response}`,
          detail: s.notes || '',
          icon: 'settlement',
        });
      }

      // Quick notes
      const notes = dbConn
        .prepare(
          `SELECT id, note, created_at FROM debt_notes WHERE debt_id = ? ORDER BY created_at DESC`,
        )
        .all(debtId) as any[];
      for (const n of notes) {
        events.push({
          id: n.id,
          ts: n.created_at,
          kind: 'note',
          label: 'Note',
          detail: n.note,
          icon: 'note',
        });
      }

      // Sort descending by timestamp
      events.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
      return events;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle(
    'debt:quick-note',
    (_event, { debtId, note }: { debtId: string; note: string }) => {
      try {
        const result = db.create('debt_notes', { debt_id: debtId, note, created_by: 'user' });
        logDebtAudit(debtId, 'note_added', 'notes', '', note.substring(0, 100));
        scheduleAutoBackup();
        return result;
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // ─── Debt: Add Fee ────────────────────────────────────────
  ipcMain.handle(
    'debt:add-fee',
    (
      _event,
      {
        debtId,
        amount,
        feeType,
        description,
      }: { debtId: string; amount: number; feeType: string; description: string },
    ) => {
      if (!amount || amount <= 0) return { error: 'Fee amount must be greater than zero' };
      try {
        const dbInstance = db.getDb();
        const addFeeTx = dbInstance.transaction(() => {
          dbInstance
            .prepare(
              `UPDATE debts SET fees_accrued = fees_accrued + ?, balance_due = balance_due + ?, updated_at = datetime('now') WHERE id = ?`,
            )
            .run(amount, amount, debtId);
          // Log as activity note
          db.create('debt_notes', {
            debt_id: debtId,
            note: `Fee added: $${amount.toFixed(2)} (${feeType}) — ${description || 'No description'}`,
            created_by: 'system',
          });
        });
        addFeeTx();
        logDebtAudit(
          debtId,
          'fee_added',
          'fees_accrued',
          '',
          amount.toFixed(2) + ' (' + feeType + ')',
        );
        scheduleAutoBackup();
        return { success: true };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // ─── Debt: Collector Performance ─────────────────────────
  ipcMain.handle(
    'debt:collector-performance',
    (_event, { startDate, endDate }: { startDate?: string; endDate?: string }) => {
      try {
        const companyId = db.getCurrentCompanyId();
        if (!companyId) return [];
        const dbInstance = db.getDb();
        const dateFilter =
          startDate && endDate ? `AND d.created_at BETWEEN '${startDate}' AND '${endDate}'` : '';
        const rows = dbInstance
          .prepare(
            `
        SELECT
          u.id as collector_id,
          u.display_name as collector_name,
          COUNT(DISTINCT d.id) as active_cases,
          COALESCE(SUM(d.original_amount), 0) as total_owed,
          COALESCE(SUM(d.payments_made), 0) as total_collected,
          CASE WHEN SUM(d.original_amount) > 0
            THEN ROUND(SUM(d.payments_made) * 100.0 / SUM(d.original_amount), 1)
            ELSE 0 END as recovery_rate,
          COALESCE(AVG(
            CASE WHEN d.payments_made > 0
              THEN CAST(julianday((SELECT MIN(dp.received_date) FROM debt_payments dp WHERE dp.debt_id = d.id)) - julianday(d.delinquent_date) AS INTEGER)
              ELSE NULL END
          ), 0) as avg_days_to_first_payment
        FROM users u
        INNER JOIN debts d ON d.assigned_collector_id = u.id AND d.company_id = ?
        ${dateFilter}
        GROUP BY u.id, u.display_name
        ORDER BY total_collected DESC
      `,
          )
          .all(companyId);
        return rows;
      } catch (err: any) {
        console.error('debt:collector-performance error:', err);
        return [];
      }
    },
  );

  // ─── Debt: Collector Dashboard ────────────────────────────
  ipcMain.handle('debt:collector-dashboard', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const today = localToday();
      const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

      const brokenPromises = dbInstance
        .prepare(
          `
        SELECT dp.*, d.debtor_name, d.balance_due, d.id as debt_id
        FROM debt_promises dp
        JOIN debts d ON dp.debt_id = d.id
        WHERE d.company_id = ? AND dp.kept = 0 AND dp.promised_date < ?
        ORDER BY dp.promised_date DESC LIMIT 25
      `,
        )
        .all(companyId, today);

      const overdueInstallments = dbInstance
        .prepare(
          `
        SELECT dpi.*, dpp.debt_id, d.debtor_name, d.balance_due
        FROM debt_plan_installments dpi
        JOIN debt_payment_plans dpp ON dpi.plan_id = dpp.id
        JOIN debts d ON dpp.debt_id = d.id
        WHERE d.company_id = ? AND dpi.paid = 0 AND dpi.due_date < ?
        ORDER BY dpi.due_date ASC LIMIT 25
      `,
        )
        .all(companyId, today);

      const upcomingHearings = dbInstance
        .prepare(
          `
        SELECT dla.*, d.debtor_name, d.balance_due, d.id as debt_id
        FROM debt_legal_actions dla
        JOIN debts d ON dla.debt_id = d.id
        -- DATE: Item #6 — date() wrap.
        WHERE d.company_id = ? AND date(dla.hearing_date) BETWEEN date(?) AND date(?)
        ORDER BY dla.hearing_date ASC LIMIT 25
      `,
        )
        .all(companyId, today, weekAhead);

      const followUpsDue = dbInstance
        .prepare(
          `
        SELECT dc.*, d.debtor_name, d.balance_due, d.id as debt_id
        FROM debt_communications dc
        JOIN debts d ON dc.debt_id = d.id
        WHERE d.company_id = ? AND dc.next_action_date <= ? AND dc.next_action_date != ''
        ORDER BY dc.next_action_date ASC LIMIT 25
      `,
        )
        .all(companyId, today);

      return { brokenPromises, overdueInstallments, upcomingHearings, followUpsDue };
    } catch (err: any) {
      console.error('debt:collector-dashboard error:', err);
      return {
        brokenPromises: [],
        overdueInstallments: [],
        upcomingHearings: [],
        followUpsDue: [],
      };
    }
  });

  // ─── Debt: Upcoming Installments ─────────────────────────
  ipcMain.handle('debt:upcoming-installments', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const rows = dbInstance
        .prepare(
          `
        SELECT dpi.*, dpp.debt_id
        FROM debt_plan_installments dpi
        JOIN debt_payment_plans dpp ON dpi.plan_id = dpp.id
        WHERE dpp.debt_id = ?
        ORDER BY dpi.due_date ASC
      `,
        )
        .all(debtId);
      return rows;
    } catch {
      return [];
    }
  });

  // ─── Debt: Upload Document ───────────────────────────────
  ipcMain.handle(
    'debt:upload-document',
    async (
      _event,
      {
        debtId,
        filePath,
        fileName,
        fileSize,
      }: { debtId: string; filePath: string; fileName: string; fileSize: number },
    ) => {
      try {
        const companyId = db.getCurrentCompanyId();
        if (!companyId) throw new Error('No active company');
        const result = db.create('documents', {
          company_id: companyId,
          filename: fileName,
          file_path: filePath,
          file_size: fileSize || 0,
          mime_type: '',
          entity_type: 'debt',
          entity_id: debtId,
          tags: '[]',
          description: '',
        });
        scheduleAutoBackup();
        return result;
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // ─── Debt: Bank Payment Matching ─────────────────────────────
  ipcMain.handle('debt:match-bank-payments', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { auto_matched: 0, suggested: 0 };
      const dbInstance = db.getDb();

      // Get credit-side bank transactions not already matched
      const txns = dbInstance
        .prepare(
          `
        SELECT bt.* FROM bank_transactions bt
        JOIN bank_accounts ba ON bt.bank_account_id = ba.id
        WHERE ba.company_id = ? AND bt.type = 'credit'
          AND bt.id NOT IN (SELECT bank_transaction_id FROM debt_payment_matches)
          AND bt.id NOT IN (SELECT COALESCE(reference_number, '') FROM debt_payments WHERE reference_number IS NOT NULL AND reference_number != '')
        ORDER BY bt.date DESC LIMIT 200
      `,
        )
        .all(companyId) as any[];

      // Get active debts for matching
      const debts = dbInstance
        .prepare(
          `
        SELECT d.id, d.debtor_name, d.balance_due, d.source_id, i.invoice_number
        FROM debts d
        LEFT JOIN invoices i ON d.source_id = i.id
        WHERE d.company_id = ? AND d.status NOT IN ('settled', 'written_off') AND d.balance_due > 0
      `,
        )
        .all(companyId) as any[];

      let autoMatched = 0;
      let suggested = 0;

      const matchTx = dbInstance.transaction(() => {
        for (const txn of txns) {
          const memo = (txn.description || txn.reference || '').toLowerCase();
          let matched = false;

          // Auto-match: check if memo contains an invoice number or debt source_id prefix
          for (const debt of debts) {
            const invoiceNum = (debt.invoice_number || '').toLowerCase();
            const sourcePrefix = (debt.source_id || '').substring(0, 8).toLowerCase();

            if (invoiceNum && memo.includes(invoiceNum)) {
              db.create('debt_payments', {
                debt_id: debt.id,
                amount: txn.amount,
                method: 'ach',
                reference_number: txn.id,
                received_date: txn.date || localToday(),
                applied_to_principal: txn.amount,
                applied_to_interest: 0,
                applied_to_fees: 0,
                notes: 'Auto-matched from bank import: ' + (txn.description || ''),
              });

              db.create('debt_payment_matches', {
                bank_transaction_id: txn.id,
                debt_id: debt.id,
                match_type: 'auto',
                confidence: 0.95,
                status: 'accepted',
              });

              logDebtAudit(
                debt.id,
                'payment_recorded',
                'amount',
                '',
                String(txn.amount) + ' (auto-matched from bank)',
              );
              autoMatched++;
              matched = true;
              break;
            }

            if (sourcePrefix && sourcePrefix.length >= 6 && memo.includes(sourcePrefix)) {
              db.create('debt_payments', {
                debt_id: debt.id,
                amount: txn.amount,
                method: 'ach',
                reference_number: txn.id,
                received_date: txn.date || localToday(),
                applied_to_principal: txn.amount,
                applied_to_interest: 0,
                applied_to_fees: 0,
                notes: 'Auto-matched from bank import: ' + (txn.description || ''),
              });

              db.create('debt_payment_matches', {
                bank_transaction_id: txn.id,
                debt_id: debt.id,
                match_type: 'auto',
                confidence: 0.85,
                status: 'accepted',
              });

              logDebtAudit(
                debt.id,
                'payment_recorded',
                'amount',
                '',
                String(txn.amount) + ' (auto-matched from bank)',
              );
              autoMatched++;
              matched = true;
              break;
            }
          }

          if (matched) continue;

          // Suggested match: amount within $0.01 of a debt's balance
          for (const debt of debts) {
            if (Math.abs(txn.amount - debt.balance_due) <= 0.01) {
              db.create('debt_payment_matches', {
                bank_transaction_id: txn.id,
                debt_id: debt.id,
                match_type: 'suggested',
                confidence: 0.7,
                status: 'pending',
              });
              suggested++;
              break;
            }
          }
        }
      });
      matchTx();
      if (autoMatched > 0) scheduleAutoBackup();
      return { auto_matched: autoMatched, suggested };
    } catch (err: any) {
      return { error: err.message, auto_matched: 0, suggested: 0 };
    }
  });

  ipcMain.handle('debt:list-pending-matches', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return [];
      return db
        .getDb()
        .prepare(
          `
        SELECT dpm.*, bt.date as txn_date, bt.amount as txn_amount, bt.description as txn_memo,
               d.debtor_name, d.balance_due
        FROM debt_payment_matches dpm
        JOIN bank_transactions bt ON dpm.bank_transaction_id = bt.id
        JOIN debts d ON dpm.debt_id = d.id
        WHERE d.company_id = ? AND dpm.status = 'pending'
        ORDER BY dpm.created_at DESC
      `,
        )
        .all(companyId);
    } catch (_) {
      return [];
    }
  });

  ipcMain.handle('debt:accept-match', (_event, { matchId }: { matchId: string }) => {
    try {
      const dbInstance = db.getDb();
      const match = dbInstance
        .prepare('SELECT * FROM debt_payment_matches WHERE id = ?')
        .get(matchId) as any;
      if (!match) return { error: 'Match not found' };

      const txn = dbInstance
        .prepare('SELECT * FROM bank_transactions WHERE id = ?')
        .get(match.bank_transaction_id) as any;
      if (!txn) return { error: 'Transaction not found' };

      db.create('debt_payments', {
        debt_id: match.debt_id,
        amount: txn.amount,
        method: 'ach',
        reference_number: txn.id,
        received_date: txn.date || localToday(),
        applied_to_principal: txn.amount,
        applied_to_interest: 0,
        applied_to_fees: 0,
        notes: 'Matched from bank import: ' + (txn.description || ''),
      });

      dbInstance
        .prepare('UPDATE debt_payment_matches SET status = ? WHERE id = ?')
        .run('accepted', matchId);
      logDebtAudit(
        match.debt_id,
        'payment_recorded',
        'amount',
        '',
        String(txn.amount) + ' (bank match accepted)',
      );
      scheduleAutoBackup();
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:reject-match', (_event, { matchId }: { matchId: string }) => {
    try {
      db.getDb()
        .prepare('UPDATE debt_payment_matches SET status = ? WHERE id = ?')
        .run('rejected', matchId);
      scheduleAutoBackup();
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Advanced Debt Collection Handlers ──────────────────────

  // Feature 4: Schedule Communication
  ipcMain.handle(
    'debt:schedule-communication',
    (
      _event,
      {
        debtId,
        type,
        scheduledDate,
        subject,
        body,
      }: { debtId: string; type: string; scheduledDate: string; subject: string; body: string },
    ) => {
      try {
        const record = db.create('debt_communications', {
          debt_id: debtId,
          type,
          direction: 'outbound',
          subject,
          body,
          next_action: 'send',
          next_action_date: scheduledDate,
          logged_at: new Date().toISOString(),
          outcome: 'scheduled',
        });
        logDebtAudit(debtId, 'communication_logged', 'scheduled', '', scheduledDate);
        scheduleAutoBackup();
        return record;
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // Feature 12: Auto-Assign Debts to Collectors
  ipcMain.handle('debt:auto-assign', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const unassigned = dbInstance
        .prepare(
          `SELECT id FROM debts WHERE company_id = ? AND (assigned_collector_id IS NULL OR assigned_collector_id = '') AND status NOT IN ('settled','written_off') ORDER BY balance_due DESC`,
        )
        .all(companyId) as any[];
      const collectors = dbInstance.prepare('SELECT id FROM users').all() as any[];
      if (collectors.length === 0 || unassigned.length === 0) return { assigned: 0 };
      let idx = 0;
      const tx = dbInstance.transaction(() => {
        for (const debt of unassigned) {
          const collectorId = collectors[idx % collectors.length].id;
          dbInstance
            .prepare(
              "UPDATE debts SET assigned_collector_id = ?, updated_at = datetime('now') WHERE id = ?",
            )
            .run(collectorId, debt.id);
          logDebtAudit(debt.id, 'assignment_change', 'assigned_collector_id', '', collectorId);
          idx++;
        }
      });
      tx();
      scheduleAutoBackup();
      return { assigned: unassigned.length };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 20: Consolidate Debts
  ipcMain.handle(
    'debt:consolidate',
    (_event, { debtIds, companyId }: { debtIds: string[]; companyId: string }) => {
      try {
        if (debtIds.length < 2) return { error: 'Need at least 2 debts to consolidate' };
        const dbInstance = db.getDb();
        const debts = debtIds
          .map((id) => dbInstance.prepare('SELECT * FROM debts WHERE id = ?').get(id) as any)
          .filter(Boolean);
        if (debts.length < 2) return { error: 'Could not find all selected debts' };
        // Check same debtor
        const debtorName = debts[0].debtor_name;
        if (!debts.every((d) => d.debtor_name === debtorName))
          return { error: 'All debts must be from the same debtor' };
        const totalBalance = debts.reduce((s: number, d: any) => s + (d.balance_due || 0), 0);
        const totalOriginal = debts.reduce((s: number, d: any) => s + (d.original_amount || 0), 0);
        const totalInterest = debts.reduce((s: number, d: any) => s + (d.interest_accrued || 0), 0);
        const totalFees = debts.reduce((s: number, d: any) => s + (d.fees_accrued || 0), 0);
        const totalPayments = debts.reduce((s: number, d: any) => s + (d.payments_made || 0), 0);
        const newDebt = db.create('debts', {
          company_id: companyId,
          type: debts[0].type,
          debtor_type: debts[0].debtor_type,
          debtor_name: debtorName,
          debtor_email: debts[0].debtor_email || '',
          debtor_phone: debts[0].debtor_phone || '',
          debtor_address: debts[0].debtor_address || '',
          original_amount: totalOriginal,
          interest_accrued: totalInterest,
          fees_accrued: totalFees,
          payments_made: totalPayments,
          balance_due: totalBalance,
          due_date: debts.reduce(
            (earliest: string, d: any) =>
              !earliest || d.due_date < earliest ? d.due_date : earliest,
            '',
          ),
          delinquent_date: debts.reduce(
            (earliest: string, d: any) =>
              !earliest || d.delinquent_date < earliest ? d.delinquent_date : earliest,
            '',
          ),
          status: 'active',
          current_stage: 'reminder',
          priority: debts.some((d: any) => d.priority === 'critical')
            ? 'critical'
            : debts.some((d: any) => d.priority === 'high')
              ? 'high'
              : 'medium',
          notes: `Consolidated from ${debts.length} debts: ${debtIds.map((id) => id.slice(0, 8)).join(', ')}`,
          source_type: 'manual',
        });
        // Mark originals as settled
        for (const d of debts) {
          dbInstance
            .prepare(
              "UPDATE debts SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
            )
            .run('settled', `Consolidated into ${newDebt.id.slice(0, 8)}`, d.id);
        }
        db.create('debt_pipeline_stages', { debt_id: newDebt.id, stage: 'reminder' });
        scheduleAutoBackup();
        return { newDebtId: newDebt.id, consolidated: debts.length };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // Feature 23: Transfer Debt Between Companies
  ipcMain.handle(
    'debt:transfer',
    (_event, { debtId, targetCompanyId }: { debtId: string; targetCompanyId: string }) => {
      try {
        const dbInstance = db.getDb();
        const debt = dbInstance.prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
        if (!debt) return { error: 'Debt not found' };
        // Create copy in target company
        const cols = Object.keys(debt).filter(
          (k) => k !== 'id' && k !== 'company_id' && k !== 'created_at' && k !== 'updated_at',
        );
        const newDebtData: Record<string, any> = { company_id: targetCompanyId };
        for (const col of cols) newDebtData[col] = debt[col];
        newDebtData.notes =
          (newDebtData.notes || '') + `\nTransferred from company ${debt.company_id.slice(0, 8)}`;
        const newDebt = db.create('debts', newDebtData);
        // Mark original as transferred
        dbInstance
          .prepare(
            "UPDATE debts SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
          )
          .run('settled', `Transferred to company ${targetCompanyId.slice(0, 8)}`, debtId);
        logDebtAudit(debtId, 'field_edit', 'status', debt.status, 'transferred');
        scheduleAutoBackup();
        return { newDebtId: newDebt.id };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // Feature 16: Freeze/Resume Interest
  ipcMain.handle(
    'debt:freeze-interest',
    (_event, { debtId, freeze, reason }: { debtId: string; freeze: boolean; reason?: string }) => {
      try {
        const today = localToday();
        db.getDb()
          .prepare(
            `UPDATE debts SET interest_frozen = ?, interest_frozen_date = ?, interest_frozen_reason = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(freeze ? 1 : 0, freeze ? today : '', reason || '', debtId);
        logDebtAudit(
          debtId,
          'field_edit',
          'interest_frozen',
          freeze ? '0' : '1',
          freeze ? '1' : '0',
        );
        scheduleAutoBackup();
        return { success: true };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // Feature 13: Auto Priority Scoring
  ipcMain.handle('debt:auto-priority', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const debts = dbInstance
        .prepare(
          `SELECT id, balance_due, statute_of_limitations_date FROM debts WHERE company_id = ? AND status NOT IN ('settled','written_off')`,
        )
        .all(companyId) as any[];
      const _today = localToday();
      let updated = 0;
      const tx = dbInstance.transaction(() => {
        for (const d of debts) {
          let priority = 'low';
          if (d.balance_due >= 10000) priority = 'critical';
          else if (d.balance_due >= 5000) priority = 'high';
          else if (d.balance_due >= 1000) priority = 'medium';
          // Override: statute expiring within 90 days
          if (d.statute_of_limitations_date) {
            const daysLeft = Math.floor(
              (new Date(d.statute_of_limitations_date).getTime() - Date.now()) / 86400000,
            );
            if (daysLeft >= 0 && daysLeft <= 90) priority = 'critical';
          }
          dbInstance
            .prepare("UPDATE debts SET priority = ?, updated_at = datetime('now') WHERE id = ?")
            .run(priority, d.id);
          updated++;
        }
      });
      tx();
      if (updated > 0) scheduleAutoBackup();
      return { updated };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 24: Campaign Manager CRUD
  ipcMain.handle('debt:campaign-list', (_event, { companyId }: { companyId: string }) => {
    try {
      return db.queryAll(
        'debt_campaigns',
        { company_id: companyId },
        { field: 'created_at', dir: 'desc' },
      );
    } catch {
      return [];
    }
  });

  ipcMain.handle('debt:campaign-save', (_event, data: Record<string, any>) => {
    try {
      const companyId = db.getCurrentCompanyId();
      const result = data.id
        ? db.update('debt_campaigns', data.id, data)
        : db.create('debt_campaigns', { ...data, company_id: companyId });
      scheduleAutoBackup();
      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 9: Generate Payment Portal Link
  // PORTAL: idempotent — returns the existing live token if one is set.
  // Persists portal_token / portal_token_expires_at on the debts row so the
  // VPS replica can validate the link via the standard sync path. Falls back
  // to ephemeral (in-memory only) on legacy DBs missing those columns.
  ipcMain.handle('debt:generate-portal-token', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const debt = dbInstance.prepare(`SELECT * FROM debts WHERE id = ?`).get(debtId) as any;
      if (!debt) return { error: 'Debt not found' };

      const existingToken: string | null = debt.portal_token ?? null;
      const existingExpiry: number = debt.portal_token_expires_at ?? 0;
      if (existingToken && existingExpiry > 0) {
        return { token: existingToken, portalUrl: `${SYNC_SERVER}/portal/debt/${existingToken}` };
      }

      const token = crypto.randomBytes(32).toString('hex');
      const companyId = db.getCurrentCompanyId() ?? '';
      const expiryDays = getPortalExpiryDays(companyId);
      const expiresAt = Math.floor(Date.now() / 1000) + expiryDays * 86400;
      try {
        dbInstance
          .prepare(
            `UPDATE debts SET portal_token = ?, portal_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(token, expiresAt, debtId);
        syncPush({
          table_name: 'debts',
          operation: 'update',
          record_id: debtId,
          company_id: companyId,
          payload: { id: debtId, portal_token: token, portal_token_expires_at: expiresAt },
        } as any).catch(() => {});
      } catch {
        /* legacy DB without portal_token columns */
      }
      const portalUrl = `${SYNC_SERVER}/portal/debt/${token}`;
      return { token, portalUrl, expiresAt };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Debt Collection Wave 2 (DC1–DC150) ─────────────────
  const dc2 = () => require('../../services/debt-collection-wave2');
  ipcMain.handle('dc:dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtDashboard(c) : {};
  });
  ipcMain.handle('dc:by-stage', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtByStage(c) : [];
  });
  ipcMain.handle('dc:by-priority', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtByPriority(c) : [];
  });
  ipcMain.handle('dc:by-status', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtByStatus(c) : [];
  });
  ipcMain.handle('dc:aging-buckets', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtAgingBuckets(c) : [];
  });
  ipcMain.handle('dc:collection-rate', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().collectionRate(c) : {};
  });
  ipcMain.handle('dc:monthly-collections', (_e, { months }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().monthlyCollections(c, months) : [];
  });
  ipcMain.handle('dc:top-debtors', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().topDebtors(c, limit) : [];
  });
  ipcMain.handle('dc:trend', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtTrend(c) : [];
  });
  ipcMain.handle('dc:recovery-forecast', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().recoveryForecast(c) : {};
  });
  ipcMain.handle('dc:collector-performance', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().collectorPerformance(c) : [];
  });
  ipcMain.handle('dc:search', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtSearch(c, query) : [];
  });
  ipcMain.handle('dc:by-type', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtByType(c) : [];
  });
  ipcMain.handle('dc:by-jurisdiction', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtByJurisdiction(c) : [];
  });
  ipcMain.handle('dc:skip-traces', (_e, { debtId }: any) => dc2().listSkipTraces(debtId));
  ipcMain.handle('dc:skip-trace:create', (_e, p: any) => dc2().createSkipTrace(p));
  ipcMain.handle('dc:skip-trace:update', (_e, { id, ...data }: any) => {
    dc2().updateSkipTrace(id, data);
    return { ok: true };
  });
  ipcMain.handle('dc:skip-trace:delete', (_e, { id }: any) => {
    dc2().deleteSkipTrace(id);
    return { ok: true };
  });
  ipcMain.handle('dc:skip-trace-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().skipTraceSummary(c) : [];
  });
  ipcMain.handle('dc:writeoffs', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().listWriteoffs(c) : [];
  });
  ipcMain.handle('dc:writeoff:create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return dc2().createWriteoff({ ...p, company_id: c });
  });
  ipcMain.handle('dc:writeoff-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().writeoffSummary(c) : {};
  });
  ipcMain.handle('dc:writeoff:delete', (_e, { id }: any) => {
    dc2().deleteWriteoff(id);
    return { ok: true };
  });
  ipcMain.handle('dc:writeoff-by-reason', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().writeoffByReason(c) : [];
  });
  ipcMain.handle('dc:need-skip-trace', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtorsNeedingSkipTrace(c) : [];
  });
  ipcMain.handle('dc:writeoff-candidates', (_e, { age }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().writeoffCandidates(c, age || 365) : [];
  });
  ipcMain.handle('dc:recovery-rate', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().recoveryRate(c) : {};
  });
  ipcMain.handle('dc:comm-history', (_e, { debtId }: any) => dc2().communicationHistory(debtId));
  ipcMain.handle('dc:comm-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().communicationSummary(c) : [];
  });
  ipcMain.handle('dc:recent-comms', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().recentCommunications(c, limit) : [];
  });
  ipcMain.handle('dc:need-contact', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtsNeedingContact(c, days || 14) : [];
  });
  ipcMain.handle('dc:promises', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().promisesList(c) : [];
  });
  ipcMain.handle('dc:broken-promises', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().brokenPromises(c) : [];
  });
  ipcMain.handle('dc:upcoming-promises', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().upcomingPromises(c, days) : [];
  });
  ipcMain.handle('dc:notes', (_e, { debtId }: any) => dc2().notesList(debtId));
  ipcMain.handle('dc:note:create', (_e, p: any) => dc2().createNote(p));
  ipcMain.handle('dc:note:delete', (_e, { id }: any) => {
    dc2().deleteNote(id);
    return { ok: true };
  });
  ipcMain.handle('dc:activity-timeline', (_e, { debtId }: any) => dc2().activityTimeline(debtId));
  ipcMain.handle('dc:audit-log-detail', (_e, { debtId }: any) => dc2().debtAuditLog(debtId));
  ipcMain.handle('dc:disputes', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().disputesList(c) : [];
  });
  ipcMain.handle('dc:open-disputes', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().openDisputes(c) : [];
  });
  ipcMain.handle('dc:evidence', (_e, { debtId }: any) => dc2().evidenceList(debtId));
  ipcMain.handle('dc:legal-actions', (_e, { debtId }: any) => dc2().legalActionsList(debtId));
  ipcMain.handle('dc:payment-history', (_e, { debtId }: any) => dc2().paymentHistory(debtId));
  ipcMain.handle('dc:settlements', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().settlementsList(c) : [];
  });
  ipcMain.handle('dc:campaigns', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().listCampaigns(c) : [];
  });
  ipcMain.handle('dc:campaign:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return dc2().upsertCampaign({ ...p, company_id: c });
  });
  ipcMain.handle('dc:campaign:delete', (_e, { id }: any) => {
    dc2().deleteCampaign(id);
    return { ok: true };
  });
  ipcMain.handle('dc:campaign-targets', (_e, { campaignId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().campaignTargets(c, campaignId) : [];
  });
  ipcMain.handle('dc:campaign-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().campaignSummary(c) : {};
  });
  ipcMain.handle('dc:automation-rules', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().automationRulesList(c) : [];
  });
  ipcMain.handle('dc:batch-advance-stage', (_e, { debtIds, stage }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().batchAdvanceStage(c, debtIds, stage) : {};
  });
  ipcMain.handle('dc:batch-assign', (_e, { debtIds, collector }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().batchAssignCollector(c, debtIds, collector) : {};
  });
  ipcMain.handle('dc:batch-priority', (_e, { debtIds, priority }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().batchUpdatePriority(c, debtIds, priority) : {};
  });
  ipcMain.handle('dc:batch-writeoff', (_e, { debtIds, reason }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().batchWriteOff(c, debtIds, reason) : {};
  });
  ipcMain.handle('dc:escalation-queue', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().escalationQueue(c) : [];
  });
  ipcMain.handle('dc:auto-escalate', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().autoEscalationCheck(c) : {};
  });
  ipcMain.handle('dc:scheduled-actions', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().scheduledActions(c) : [];
  });
  ipcMain.handle('dc:plan-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().paymentPlanSummary(c) : {};
  });
  ipcMain.handle('dc:installments-due', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().planInstallmentsDue(c, days) : [];
  });
  ipcMain.handle('dc:overdue-installments', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().overdueInstallments(c) : [];
  });
  ipcMain.handle('dc:settlement-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().settlementSummary(c) : {};
  });
  ipcMain.handle('dc:pending-settlements', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().pendingSettlements(c) : [];
  });
  ipcMain.handle('dc:payment-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtPaymentSummary(c) : [];
  });
  ipcMain.handle('dc:avg-settlement-discount', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().avgSettlementDiscount(c) : {};
  });
  ipcMain.handle('dc:payment-matches', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().paymentMatchesList(c) : [];
  });
  ipcMain.handle('dc:compliance-log', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().complianceLog(c, opts.debtId) : [];
  });
  ipcMain.handle('dc:compliance-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().complianceSummary(c) : [];
  });
  ipcMain.handle('dc:statute-expiring', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().statuteExpiringDebts(c, days || 90) : [];
  });
  ipcMain.handle('dc:cease-desist', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().ceaseAndDesistDebts(c) : [];
  });
  ipcMain.handle('dc:fdcpa-check', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().fdcpaComplianceCheck(c) : {};
  });
  ipcMain.handle('dc:legal-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().legalActionsSummary(c) : [];
  });
  ipcMain.handle('dc:in-legal', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtsInLegal(c) : [];
  });
  ipcMain.handle('dc:bankruptcy', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().bankruptcyDebts(c) : [];
  });
  ipcMain.handle('dc:contact-restrictions', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().contactRestrictions(c) : [];
  });
  ipcMain.handle('dc:risk-score', (_e, { debtId }: any) => dc2().computeDebtRiskScore(debtId));
  ipcMain.handle('dc:risk-scores-bulk', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().bulkComputeRiskScores(c) : [];
  });
  ipcMain.handle('dc:risk-distribution', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().riskDistribution(c) : {};
  });
  ipcMain.handle('dc:high-risk', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().highRiskDebts(c) : [];
  });
  ipcMain.handle('dc:debtor-profile', (_e, { debtId }: any) => dc2().debtorProfile(debtId));
  ipcMain.handle('dc:portfolio-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().portfolioSummary(c) : {};
  });
  ipcMain.handle('dc:collector-workload', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().collectorWorkload(c) : [];
  });
  ipcMain.handle('dc:stage-transitions', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().stageTransitionReport(c) : [];
  });
  ipcMain.handle('dc:export', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtExportData(c) : [];
  });
  ipcMain.handle('dc:monthly-performance', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().monthlyPerformanceReport(c) : [];
  });
  ipcMain.handle('dc:concentration', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtConcentration(c) : {};
  });
  ipcMain.handle('dc:avg-days-to-collect', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().avgDaysToCollect(c) : {};
  });
  ipcMain.handle('dc:portfolio-health', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().debtPortfolioHealth(c) : {};
  });
  ipcMain.handle('dc:quarterly-report', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().quarterlyCollectionReport(c) : [];
  });
  ipcMain.handle('dc:full-report', () => {
    const c = db.getCurrentCompanyId();
    return c ? dc2().fullDebtReport(c) : {};
  });
}
