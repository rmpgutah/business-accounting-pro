// src/main/ipc/hr-portal.ts
//
// HR Portal Wave — per-employee self-service snapshot, announcements board
// with acknowledgment tracking, printable employee record data, and the
// Employee↔Debt-Collection bridge (pay advances escalate into formal debt
// cases with debtor_type='employee'; garnishments and advances surface on
// the employee snapshot).
//
// Registered from registerIpcHandlers() via registerHrPortalIpc().

import { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../database';

interface HrPortalIpcDeps {
  scheduleAutoBackup: () => void;
}

export function registerHrPortalIpc(ipcMain: IpcMain, deps: HrPortalIpcDeps): void {
  const { scheduleAutoBackup } = deps;

  // ─── Employee snapshot — one call powers the whole portal view ─────
  // Profile + PTO balances + recent pay stubs + open time-off requests +
  // active garnishments + advances + linked debt cases + reviews +
  // tenure/anniversary math. Every sub-query is individually guarded so a
  // missing optional table never blanks the snapshot.
  // NOTE: namespaced hr:portal-* — a prior HR analytics wave already owns
  // hr:employee-snapshot and hr:directory; re-registering those channels
  // would throw "second handler" at startup.
  ipcMain.handle('hr:portal-snapshot', (_e, { employee_id }: { employee_id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid || !employee_id) return { error: 'No employee' };
      const dbi = db.getDb();

      const employee = dbi.prepare(
        'SELECT * FROM employees WHERE id = ? AND company_id = ?'
      ).get(employee_id, cid) as any;
      if (!employee) return { error: 'Employee not found' };
      // PRIVACY: never ship full SSN / bank account to the renderer from
      // this snapshot — last-4 only (the dedicated form handles editing).
      const last4 = (raw: any) => String(raw || '').replace(/\D/g, '').slice(-4);
      employee.ssn = '';
      employee.ssn_last4 = last4(employee.ssn_last4) || last4(employee.ssn);
      employee.account_number = last4(employee.account_number);
      employee.routing_number = '';

      const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

      const ptoBalances = safe(() => dbi.prepare(
        'SELECT * FROM pto_balances WHERE employee_id = ?'
      ).all(employee_id), [] as any[]);

      const recentStubs = safe(() => dbi.prepare(`
        SELECT ps.id, ps.gross_pay, ps.net_pay, ps.ytd_gross, ps.ytd_net,
               pr.pay_date, pr.pay_period_start, pr.pay_period_end
        FROM pay_stubs ps JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
        WHERE ps.employee_id = ? ORDER BY pr.pay_date DESC LIMIT 6
      `).all(employee_id), [] as any[]);

      const timeOffRequests = safe(() => dbi.prepare(
        "SELECT * FROM time_off_requests WHERE employee_id = ? ORDER BY start_date DESC LIMIT 10"
      ).all(employee_id), [] as any[]);

      const garnishments = safe(() => dbi.prepare(
        "SELECT * FROM garnishment_orders WHERE employee_id = ? ORDER BY created_at DESC"
      ).all(employee_id), [] as any[]);

      const advances = safe(() => dbi.prepare(
        "SELECT * FROM pay_advances WHERE employee_id = ? ORDER BY advance_date DESC"
      ).all(employee_id), [] as any[]);

      // Debt cases where this employee is the debtor.
      const debts = safe(() => dbi.prepare(
        "SELECT id, status, original_amount, balance_due, payments_made, current_stage, due_date FROM debts WHERE company_id = ? AND debtor_type = 'employee' AND debtor_id = ? ORDER BY created_at DESC"
      ).all(cid, employee_id), [] as any[]);

      const reviews = safe(() => dbi.prepare(
        "SELECT * FROM employee_reviews WHERE employee_id = ? ORDER BY review_date DESC LIMIT 5"
      ).all(employee_id), [] as any[]);

      // Tenure math — anchored at noon for TZ safety.
      let tenure: { years: number; months: number; next_anniversary: string | null } | null = null;
      if (employee.start_date) {
        const start = new Date(employee.start_date + 'T12:00:00');
        const now = new Date();
        if (Number.isFinite(start.getTime())) {
          let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
          if (now.getDate() < start.getDate()) months -= 1;
          const nextAnniv = new Date(start);
          nextAnniv.setFullYear(start.getFullYear() + Math.floor(months / 12) + 1);
          tenure = {
            years: Math.floor(months / 12),
            months: months % 12,
            next_anniversary: nextAnniv.toISOString().slice(0, 10),
          };
        }
      }

      return {
        employee, pto_balances: ptoBalances, recent_stubs: recentStubs,
        time_off_requests: timeOffRequests, garnishments, advances, debts,
        reviews, tenure,
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── HR directory — active roster with HR-relevant fields ──────────
  ipcMain.handle('hr:portal-directory', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      return db.getDb().prepare(`
        SELECT id, name, email, phone, department, job_title, employment_type,
               status, start_date, work_location, pay_schedule
        FROM employees
        WHERE company_id = ? AND COALESCE(deleted_at, '') = ''
        ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, name
      `).all(cid);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Announcements board ───────────────────────────────────────────

  ipcMain.handle('hr:announcements:list', (_e, opts?: { include_expired?: boolean }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const dbi = db.getDb();
      const rows = dbi.prepare(`
        SELECT a.*,
          (SELECT COUNT(*) FROM hr_announcement_acks k WHERE k.announcement_id = a.id) AS ack_count
        FROM hr_announcements a
        WHERE a.company_id = ?
          ${opts?.include_expired ? '' : "AND (a.expires_date IS NULL OR a.expires_date = '' OR a.expires_date >= date('now'))"}
        ORDER BY a.pinned DESC, a.created_at DESC
        LIMIT 100
      `).all(cid) as any[];
      return rows;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('hr:announcements:save', (_e, payload: {
    id?: string; title: string; body?: string; category?: string; priority?: string;
    requires_ack?: boolean; pinned?: boolean; effective_date?: string; expires_date?: string;
  }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const title = String(payload.title || '').trim().slice(0, 200);
      if (!title) return { error: 'Title required' };
      const dbi = db.getDb();
      const fields = {
        title,
        body: String(payload.body || '').slice(0, 10000),
        category: ['general', 'policy', 'benefits', 'safety', 'event', 'payroll'].includes(payload.category || '') ? payload.category : 'general',
        priority: ['low', 'normal', 'high', 'urgent'].includes(payload.priority || '') ? payload.priority : 'normal',
        requires_ack: payload.requires_ack ? 1 : 0,
        pinned: payload.pinned ? 1 : 0,
        effective_date: payload.effective_date || null,
        expires_date: payload.expires_date || null,
      };
      if (payload.id) {
        dbi.prepare(`
          UPDATE hr_announcements SET title = ?, body = ?, category = ?, priority = ?,
            requires_ack = ?, pinned = ?, effective_date = ?, expires_date = ?, updated_at = datetime('now')
          WHERE id = ? AND company_id = ?
        `).run(fields.title, fields.body, fields.category, fields.priority,
          fields.requires_ack, fields.pinned, fields.effective_date, fields.expires_date,
          payload.id, cid);
        return { ok: true, id: payload.id };
      }
      const id = uuid();
      dbi.prepare(`
        INSERT INTO hr_announcements (id, company_id, title, body, category, priority, requires_ack, pinned, effective_date, expires_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, cid, fields.title, fields.body, fields.category, fields.priority,
        fields.requires_ack, fields.pinned, fields.effective_date, fields.expires_date);
      scheduleAutoBackup();
      return { ok: true, id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('hr:announcements:delete', (_e, { id }: { id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const dbi = db.getDb();
      dbi.prepare('DELETE FROM hr_announcement_acks WHERE announcement_id = ?').run(id);
      dbi.prepare('DELETE FROM hr_announcements WHERE id = ? AND company_id = ?').run(id, cid);
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Acknowledge on behalf of an employee. UNIQUE constraint makes this
  // idempotent — re-acking is a no-op, not a duplicate.
  ipcMain.handle('hr:announcements:ack', (_e, { announcement_id, employee_id }: { announcement_id: string; employee_id: string }) => {
    try {
      const dbi = db.getDb();
      dbi.prepare(
        'INSERT OR IGNORE INTO hr_announcement_acks (id, announcement_id, employee_id) VALUES (?, ?, ?)'
      ).run(uuid(), announcement_id, employee_id);
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('hr:announcements:acks', (_e, { announcement_id }: { announcement_id: string }) => {
    try {
      return db.getDb().prepare(`
        SELECT k.employee_id, k.acked_at, e.name
        FROM hr_announcement_acks k LEFT JOIN employees e ON e.id = k.employee_id
        WHERE k.announcement_id = ? ORDER BY k.acked_at
      `).all(announcement_id);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Employee ↔ Debt-Collection bridge ─────────────────────────────

  // Escalate a pay advance into a formal debt case. The debts table
  // already models employee debtors (debtor_type='employee'); we create
  // the case with the advance's outstanding balance and back-link it so
  // the escalation is one-way-once (re-running returns the existing case).
  ipcMain.handle('hr:advance-to-debt', (_e, { advance_id }: { advance_id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const dbi = db.getDb();

      const adv = dbi.prepare(
        'SELECT * FROM pay_advances WHERE id = ? AND company_id = ?'
      ).get(advance_id, cid) as any;
      if (!adv) return { error: 'Advance not found' };
      if (adv.related_debt_id) return { ok: true, debt_id: adv.related_debt_id, already_linked: true };

      const balance = Math.round((Number(adv.balance) || Number(adv.advance_amount) || 0) * 100) / 100;
      if (balance <= 0) return { error: 'Advance has no outstanding balance to escalate' };

      const emp = dbi.prepare(
        'SELECT id, name, email, phone FROM employees WHERE id = ? AND company_id = ?'
      ).get(adv.employee_id, cid) as any;
      if (!emp) return { error: 'Employee not found' };

      const debtId = uuid();
      dbi.transaction(() => {
        dbi.prepare(`
          INSERT INTO debts (id, company_id, type, status, debtor_id, debtor_type, debtor_name,
            debtor_email, debtor_phone, source_type, source_id, original_amount, balance_due,
            interest_rate, due_date, priority, current_stage, notes)
          VALUES (?, ?, 'receivable', 'active', ?, 'employee', ?, ?, ?, 'manual', ?, ?, ?, ?, ?, 'medium', 'reminder', ?)
        `).run(
          debtId, cid, emp.id, emp.name, emp.email || '', emp.phone || '',
          advance_id, balance, balance,
          Number(adv.interest_rate) || 0,
          adv.repayment_start || null,
          `Escalated from pay advance ${advance_id} (advanced ${adv.advance_date || 'n/a'}, original ${Number(adv.advance_amount || 0).toFixed(2)})`,
        );
        dbi.prepare(
          "UPDATE pay_advances SET related_debt_id = ?, status = 'escalated', updated_at = datetime('now') WHERE id = ?"
        ).run(debtId, advance_id);
      })();

      scheduleAutoBackup();
      return { ok: true, debt_id: debtId };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Roll-up of employee-debtor cases for the HR portal header and the
  // payroll dashboard ("how much do employees owe the company?").
  ipcMain.handle('hr:employee-debt-summary', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { count: 0, total_balance: 0, by_employee: [] };
      const dbi = db.getDb();
      const byEmployee = dbi.prepare(`
        SELECT d.debtor_id AS employee_id, d.debtor_name, COUNT(*) AS case_count,
               ROUND(SUM(d.balance_due), 2) AS balance_due,
               ROUND(SUM(d.payments_made), 2) AS payments_made
        FROM debts d
        WHERE d.company_id = ? AND d.debtor_type = 'employee'
          AND d.status NOT IN ('settled', 'written_off')
        GROUP BY d.debtor_id ORDER BY balance_due DESC
      `).all(cid) as any[];
      const total = byEmployee.reduce((s, r) => s + (r.balance_due || 0), 0);
      return {
        count: byEmployee.reduce((s, r) => s + (r.case_count || 0), 0),
        total_balance: Math.round(total * 100) / 100,
        by_employee: byEmployee,
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Printable employee record ─────────────────────────────────────
  // Gathers everything the print template needs in one call. SSN/bank
  // are pre-masked to last-4 here so the full values never cross the
  // IPC boundary for printing.
  ipcMain.handle('hr:employee-record-data', (_e, { employee_id }: { employee_id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const dbi = db.getDb();
      const employee = dbi.prepare(
        'SELECT * FROM employees WHERE id = ? AND company_id = ?'
      ).get(employee_id, cid) as any;
      if (!employee) return { error: 'Employee not found' };

      const last4 = (raw: any) => String(raw || '').replace(/\D/g, '').slice(-4);
      const ssn4 = last4(employee.ssn_last4) || last4(employee.ssn);
      employee.ssn = '';
      employee.ssn_last4 = ssn4;
      employee.account_number = last4(employee.account_number);
      employee.routing_number = last4(employee.routing_number);

      const company = dbi.prepare('SELECT * FROM companies WHERE id = ?').get(cid) as any;
      const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

      const ytd = safe(() => dbi.prepare(`
        SELECT ROUND(COALESCE(SUM(ps.gross_pay), 0), 2) AS gross,
               ROUND(COALESCE(SUM(ps.net_pay), 0), 2) AS net
        FROM pay_stubs ps JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
        WHERE ps.employee_id = ? AND strftime('%Y', pr.pay_date) = strftime('%Y', 'now')
      `).get(employee_id), { gross: 0, net: 0 }) as any;

      const pto = safe(() => dbi.prepare(
        'SELECT * FROM pto_balances WHERE employee_id = ?'
      ).all(employee_id), [] as any[]);

      const garnishments = safe(() => dbi.prepare(
        "SELECT * FROM garnishment_orders WHERE employee_id = ? AND COALESCE(status, 'active') = 'active'"
      ).all(employee_id), [] as any[]);

      const advances = safe(() => dbi.prepare(
        "SELECT * FROM pay_advances WHERE employee_id = ? AND status IN ('active', 'escalated')"
      ).all(employee_id), [] as any[]);

      return { employee, company, ytd, pto, garnishments, advances };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
}
