import type { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import { eventBus } from '../../services/EventBus';
import * as db from '../../database';
import type { IpcDeps } from '../core/types';

export function registerHrPayrollIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const { scheduleAutoBackup, postJournalEntry } = deps;
  // Payroll integrity guard: scan all runs / validate one before posting.
  ipcMain.handle('payroll:scan-integrity', () => {
    try {
      const { scanPayrollIntegrity } = require('../../services/payroll-integrity');
      return scanPayrollIntegrity(db.getCurrentCompanyId());
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('payroll:validate-run', (_e, { runId }: { runId: string }) => {
    try {
      const { assertPayrollRunValid } = require('../../services/payroll-integrity');
      return assertPayrollRunValid(runId);
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  });

  // ─── HR: Org Chart ───────────────────────────────────────
  ipcMain.handle('hr:orgChart', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();
    return dbInstance
      .prepare(
        `SELECT e.id, e.name, e.job_title, e.manager_id, e.department_id,
              mgr.name as manager_name,
              d.name as department_name
       FROM employees e
       LEFT JOIN employees mgr ON mgr.id = e.manager_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.company_id = ? AND e.status = 'active'
       ORDER BY e.name`,
      )
      .all(companyId);
  });

  // ─── HR: Headcount & Turnover Analytics ──────────────────
  ipcMain.handle(
    'hr:analytics',
    (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const dbInstance = db.getDb();

      const byDepartment = dbInstance
        .prepare(
          `SELECT COALESCE(d.name, 'Unassigned') as department_name, COUNT(*) as count
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.company_id = ? AND e.status = 'active'
       GROUP BY department_name
       ORDER BY count DESC`,
        )
        .all(companyId) as any[];

      const statusCounts = dbInstance
        .prepare(
          `SELECT status, COUNT(*) as count FROM employees WHERE company_id = ? GROUP BY status`,
        )
        .all(companyId) as any[];
      const active = statusCounts.find((r) => r.status === 'active')?.count || 0;
      const inactive = statusCounts.reduce((s, r) => (r.status !== 'active' ? s + r.count : s), 0);

      const newHires = dbInstance
        .prepare(
          `SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND start_date >= ? AND start_date <= ?`,
        )
        .get(companyId, startDate, endDate) as any;

      const departures = dbInstance
        .prepare(
          `SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND end_date >= ? AND end_date <= ?`,
        )
        .get(companyId, startDate, endDate) as any;

      const tenureRows = dbInstance
        .prepare(
          `SELECT start_date, end_date FROM employees WHERE company_id = ? AND start_date IS NOT NULL AND start_date != ''`,
        )
        .all(companyId) as any[];
      const now = Date.now();
      let totalDays = 0;
      let counted = 0;
      for (const r of tenureRows) {
        const start = new Date(r.start_date).getTime();
        const end = r.end_date ? new Date(r.end_date).getTime() : now;
        if (!isNaN(start) && !isNaN(end) && end >= start) {
          totalDays += (end - start) / 86400000;
          counted++;
        }
      }
      const avgTenureDays = counted > 0 ? Math.round(totalDays / counted) : 0;

      return {
        byDepartment,
        active,
        inactive,
        newHires: newHires?.count || 0,
        departures: departures?.count || 0,
        avgTenureDays,
      };
    },
  );

  // ─── Payroll YTD Totals ───────────────────────────────────
  // Bug fix: PayrollRunner always set ytd_gross/taxes/net to 0 because
  // there was no backend call to fetch cumulative YTD from existing stubs.
  ipcMain.handle(
    'payroll:ytd-totals',
    (_event, { employeeId, year }: { employeeId: string; year: number }) => {
      const dbInstance = db.getDb();
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const row = dbInstance
        .prepare(
          `
      SELECT
        COALESCE(SUM(ps.gross_pay), 0) AS ytd_gross,
        COALESCE(SUM(ps.federal_tax + ps.state_tax + ps.social_security + ps.medicare), 0) AS ytd_taxes,
        COALESCE(SUM(ps.net_pay), 0) AS ytd_net,
        COALESCE(SUM(ps.federal_tax), 0) AS ytd_federal_tax,
        COALESCE(SUM(ps.state_tax), 0) AS ytd_state_tax,
        COALESCE(SUM(ps.social_security), 0) AS ytd_social_security,
        COALESCE(SUM(ps.medicare), 0) AS ytd_medicare
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE ps.employee_id = ?
        AND pr.pay_date >= ?
        AND pr.pay_date <= ?
        AND pr.status != 'draft'
    `,
        )
        .get(employeeId, yearStart, yearEnd) as any;
      return {
        ytd_gross: row?.ytd_gross ?? 0,
        ytd_taxes: row?.ytd_taxes ?? 0,
        ytd_net: row?.ytd_net ?? 0,
        ytd_federal_tax: row?.ytd_federal_tax ?? 0,
        ytd_state_tax: row?.ytd_state_tax ?? 0,
        ytd_social_security: row?.ytd_social_security ?? 0,
        ytd_medicare: row?.ytd_medicare ?? 0,
      };
    },
  );

  // ─── Payroll Process (with journal entry) ────────────────────
  // Creates payroll_run + pay_stubs in a transaction and posts
  // DR Wages/Salary Expense / CR Wages Payable journal entry.
  ipcMain.handle(
    'payroll:process',
    (
      _event,
      {
        periodStart,
        periodEnd,
        payDate,
        totalGross,
        totalTaxes,
        totalNet,
        stubs, // Array<{ employeeId, hours, hoursOvertime, grossPay, federalTax, stateTax, ss, medicare, netPay, ytdGross, ytdTaxes, ytdNet, preTaxDeductions?, postTaxDeductions?, deductionDetail? }>
        runType,
        notes,
        employeeCount,
      }: any,
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company');
      const dbInstance = db.getDb();

      // BUG 1: Check for duplicate payroll run
      const existingRun = (dbInstance as any)
        .prepare(
          `SELECT id FROM payroll_runs WHERE company_id = ? AND pay_period_start = ? AND pay_period_end = ?`,
        )
        .get(companyId, periodStart, periodEnd);
      if (existingRun) {
        return {
          error:
            'A payroll run already exists for this period. Delete the existing run first to reprocess.',
        };
      }

      const tx = (dbInstance as any).transaction(() => {
        const runId = uuid();
        // Compute totals before INSERT so total_deductions is accurate
        const totalPreTax = stubs.reduce(
          (sum: number, s: any) => sum + (s.preTaxDeductions || 0),
          0,
        );
        const totalPostTax = stubs.reduce(
          (sum: number, s: any) => sum + (s.postTaxDeductions || 0),
          0,
        );
        (dbInstance as any)
          .prepare(
            `
        INSERT INTO payroll_runs (id, company_id, pay_period_start, pay_period_end, pay_date, status, total_gross, total_taxes, total_deductions, total_net, run_type, notes, employee_count)
        VALUES (?, ?, ?, ?, ?, 'processed', ?, ?, ?, ?, ?, ?, ?)
      `,
          )
          .run(
            runId,
            companyId,
            periodStart,
            periodEnd,
            payDate,
            totalGross,
            totalTaxes,
            totalPreTax + totalPostTax,
            totalNet,
            runType || 'regular',
            notes || '',
            employeeCount || stubs.length,
          );

        // Feature 20: Auto-generate sequential check numbers
        let lastCheckNum = 1000;
        try {
          const lastCheck = (dbInstance as any)
            .prepare(
              `SELECT check_number FROM pay_stubs WHERE check_number != '' ORDER BY CAST(check_number AS INTEGER) DESC LIMIT 1`,
            )
            .get();
          if (lastCheck?.check_number) {
            lastCheckNum = parseInt(lastCheck.check_number, 10) || 1000;
          }
        } catch {
          /* ignore — column may not exist yet */
        }

        for (const s of stubs) {
          lastCheckNum++;
          const checkNumber = String(lastCheckNum).padStart(6, '0');

          // Compute per-tax YTD by summing all prior stubs for this employee in the same year
          const payYear = (payDate || '').substring(0, 4);
          let ytdFederal = s.federalTax || 0,
            ytdState = s.stateTax || 0,
            ytdSS = s.ss || 0,
            ytdMedicare = s.medicare || 0;
          if (payYear && s.employeeId) {
            try {
              const prior = (dbInstance as any)
                .prepare(
                  `
              SELECT COALESCE(SUM(ps.federal_tax), 0) AS f, COALESCE(SUM(ps.state_tax), 0) AS st,
                     COALESCE(SUM(ps.social_security), 0) AS ss, COALESCE(SUM(ps.medicare), 0) AS m
              FROM pay_stubs ps JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
              WHERE ps.employee_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ? AND pr.status != 'draft'
            `,
                )
                .get(s.employeeId, `${payYear}-01-01`, `${payYear}-12-31`);
              if (prior) {
                ytdFederal += prior.f || 0;
                ytdState += prior.st || 0;
                ytdSS += prior.ss || 0;
                ytdMedicare += prior.m || 0;
              }
            } catch {
              /* ignore */
            }
          }

          (dbInstance as any)
            .prepare(
              `
          INSERT INTO pay_stubs (id, payroll_run_id, employee_id, hours_regular, hours_overtime, gross_pay, federal_tax, state_tax, social_security, medicare, other_deductions, net_pay, ytd_gross, ytd_taxes, ytd_net, pretax_deductions, posttax_deductions, deduction_detail, check_number, ytd_federal_tax, ytd_state_tax, ytd_social_security, ytd_medicare)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            )
            .run(
              uuid(),
              runId,
              s.employeeId,
              s.hours,
              s.hoursOvertime || 0,
              s.grossPay,
              s.federalTax,
              s.stateTax,
              s.ss,
              s.medicare,
              s.netPay,
              s.ytdGross,
              s.ytdTaxes,
              s.ytdNet,
              s.preTaxDeductions || 0,
              s.postTaxDeductions || 0,
              s.deductionDetail || '{}',
              checkNumber,
              ytdFederal,
              ytdState,
              ytdSS,
              ytdMedicare,
            );
        }

        // BUG 4: Break out taxes into separate GL lines instead of single lumped "Tax" line
        const totalFederalTax = stubs.reduce((sum: number, s: any) => sum + (s.federalTax || 0), 0);
        const totalStateTax = stubs.reduce((sum: number, s: any) => sum + (s.stateTax || 0), 0);
        const totalSS = stubs.reduce((sum: number, s: any) => sum + (s.ss || 0), 0);
        const totalMedicare = stubs.reduce((sum: number, s: any) => sum + (s.medicare || 0), 0);

        // FIX #1: Post employer-side payroll taxes. Employer FICA matches
        // employee FICA (6.2% SS + 1.45% Medicare on same wage base). Also
        // compute FUTA (6.0% on first $7,000 per employee per year) — uses
        // simplified per-stub gross since we don't have aggregate YTD per
        // employee from the stubs array alone.
        const totalEmployerSS = stubs.reduce((sum: number, s: any) => sum + (s.ss || 0), 0);
        const totalEmployerMedicare = stubs.reduce(
          (sum: number, s: any) => sum + (s.medicare || 0),
          0,
        );
        let totalFUTA = 0;
        for (const s of stubs) {
          const gross = s.grossPay || 0;
          // FUTA applies only to first $7,000 of annual wages per employee.
          // Without access to full YTD gross per employee in the stubs payload,
          // we approximate by checking the per-stub gross directly. This
          // understates FUTA when an employee crosses $7k mid-period.
          totalFUTA += Math.min(gross, 7000) * 0.006;
        }

        postJournalEntry(
          dbInstance,
          companyId,
          payDate,
          `Payroll - ${periodStart} to ${periodEnd}`,
          [
            { nameHint: 'Wages Expense', debit: totalGross, credit: 0, note: 'Gross wages' },
            { nameHint: 'Wages Payable', debit: 0, credit: totalNet, note: 'Net wages payable' },
            {
              nameHint: 'Federal Withholding',
              debit: 0,
              credit: totalFederalTax,
              note: 'Federal income tax withheld',
            },
            {
              nameHint: 'State Withholding',
              debit: 0,
              credit: totalStateTax,
              note: 'State income tax withheld',
            },
            {
              nameHint: 'Social Security Payable',
              debit: 0,
              credit: totalSS,
              note: 'Employee SS withholding',
            },
            {
              nameHint: 'Medicare Payable',
              debit: 0,
              credit: totalMedicare,
              note: 'Employee Medicare withholding',
            },
            // Pre-tax and post-tax deductions (401k, garnishments, etc.) — prevent JE imbalance
            {
              nameHint: totalPreTax > 0 ? 'Pre-tax Deductions Payable' : '_skip',
              debit: 0,
              credit: totalPreTax,
              note: 'Pre-tax deductions withheld',
            },
            {
              nameHint: totalPostTax > 0 ? 'Post-tax Deductions Payable' : '_skip',
              debit: 0,
              credit: totalPostTax,
              note: 'Post-tax deductions withheld',
            },
            // Employer-side payroll tax expenses and liabilities — FIX #1
            {
              nameHint: 'Payroll Tax Expense — FICA',
              debit: totalEmployerSS + totalEmployerMedicare,
              credit: 0,
              note: 'Employer FICA tax',
            },
            {
              nameHint: 'Social Security Payable',
              debit: 0,
              credit: totalEmployerSS,
              note: 'Employer SS matching',
            },
            {
              nameHint: 'Medicare Payable',
              debit: 0,
              credit: totalEmployerMedicare,
              note: 'Employer Medicare matching',
            },
            // FUTA — employer-only federal unemployment tax
            {
              nameHint: 'Payroll Tax Expense — FUTA',
              debit: totalFUTA,
              credit: 0,
              note: 'FUTA expense',
            },
            { nameHint: 'FUTA Payable', debit: 0, credit: totalFUTA, note: 'FUTA liability' },
          ],
        );

        // ── PTO Auto-Accrual ──
        // For each employee in this run, check if they have PTO policies and accrue hours
        try {
          const ptoPolicies = (dbInstance as any)
            .prepare(
              'SELECT pb.*, pp.accrual_rate, pp.accrual_unit, pp.cap_hours, pp.name as policy_name FROM pto_balances pb JOIN pto_policies pp ON pb.policy_id = pp.id WHERE pb.employee_id IN (' +
                stubs.map(() => '?').join(',') +
                ')',
            )
            .all(...stubs.map((s: any) => s.employeeId)) as any[];

          for (const pb of ptoPolicies) {
            // Calculate accrual amount based on unit
            let accrualHours = 0;
            if (pb.accrual_unit === 'hours_per_pay_period') {
              accrualHours = pb.accrual_rate;
            } else if (pb.accrual_unit === 'annual') {
              // Divide annual rate by number of pay periods (assume 26 for biweekly)
              accrualHours = pb.accrual_rate / 26;
            } else if (pb.accrual_unit === 'monthly') {
              accrualHours = pb.accrual_rate; // 1 accrual per monthly run
            }

            if (accrualHours <= 0) continue;

            // Check cap
            const newBalance = (pb.balance_hours || 0) + accrualHours;
            const cappedBalance = pb.cap_hours ? Math.min(newBalance, pb.cap_hours) : newBalance;
            const actualAccrual = cappedBalance - (pb.balance_hours || 0);

            if (actualAccrual <= 0) continue;

            // Update balance
            (dbInstance as any)
              .prepare(
                "UPDATE pto_balances SET balance_hours = ?, accrued_hours_ytd = accrued_hours_ytd + ?, updated_at = datetime('now') WHERE id = ?",
              )
              .run(cappedBalance, actualAccrual, pb.id);

            // Log transaction
            (dbInstance as any)
              .prepare(
                "INSERT INTO pto_transactions (id, employee_id, policy_id, type, hours, note, payroll_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
              )
              .run(
                uuid(),
                pb.employee_id,
                pb.policy_id,
                'accrual',
                actualAccrual,
                `Auto-accrual from payroll run ${periodStart} - ${periodEnd}`,
                runId,
              );
          }
        } catch (ptoErr) {
          console.warn('PTO accrual skipped:', ptoErr);
          // PTO accrual is non-critical — don't fail the payroll run
        }

        return { runId };
      });

      const result = tx();
      scheduleAutoBackup();
      // Reactive engine: emit payroll.processed event.
      try {
        if (companyId && result?.runId) {
          eventBus
            .emit({
              type: 'payroll.processed',
              companyId,
              entityType: 'payroll_run',
              entityId: result.runId,
              data: {
                totalGross,
                totalNet,
                totalTaxes,
                employeeCount: employeeCount || stubs.length,
                periodStart,
                periodEnd,
                payDate,
              },
            })
            .catch(() => {});
        }
      } catch {
        /* fire-and-forget */
      }
      return result;
    },
  );

  // ─── Payroll Edit (replace existing run) ────────────────
  // Mirrors payroll:process but UPDATEs the existing run, deletes
  // and re-inserts pay_stubs, and reverses + reposts the GL entry.
  ipcMain.handle(
    'payroll:edit',
    (
      _event,
      {
        runId,
        periodStart,
        periodEnd,
        payDate,
        totalGross,
        totalTaxes,
        totalNet,
        stubs,
        runType,
        notes,
        employeeCount,
      }: any,
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company');
      if (!runId) return { error: 'runId is required for edit' };
      const dbInstance = db.getDb();

      // Verify run exists and belongs to this company
      const existing = (dbInstance as any)
        .prepare(
          `SELECT id, pay_date, pay_period_start FROM payroll_runs WHERE id = ? AND company_id = ?`,
        )
        .get(runId, companyId);
      if (!existing) return { error: 'Payroll run not found' };

      const tx = (dbInstance as any).transaction(() => {
        // 1. Delete existing pay stubs
        (dbInstance as any).prepare(`DELETE FROM pay_stubs WHERE payroll_run_id = ?`).run(runId);

        // 2. Delete the previously auto-posted journal entry for this run
        const oldJE = (dbInstance as any)
          .prepare(`SELECT id FROM journal_entries WHERE company_id = ? AND description LIKE ?`)
          .get(companyId, `Payroll - ${existing.pay_period_start}%`);
        if (oldJE) {
          (dbInstance as any)
            .prepare(`DELETE FROM journal_entry_lines WHERE journal_entry_id = ?`)
            .run(oldJE.id);
          (dbInstance as any).prepare(`DELETE FROM journal_entries WHERE id = ?`).run(oldJE.id);
        }

        // 3. Update the run row with new totals + period info
        (dbInstance as any)
          .prepare(
            `
        UPDATE payroll_runs SET pay_period_start = ?, pay_period_end = ?, pay_date = ?, total_gross = ?, total_taxes = ?, total_net = ?, run_type = ?, notes = ?, employee_count = ?, updated_at = datetime('now')
        WHERE id = ? AND company_id = ?
      `,
          )
          .run(
            periodStart,
            periodEnd,
            payDate,
            totalGross,
            totalTaxes,
            totalNet,
            runType || 'regular',
            notes || '',
            employeeCount || stubs.length,
            runId,
            companyId,
          );

        // 4. Insert new stubs (mirror payroll:process logic)
        let lastCheckNum = 1000;
        try {
          const lastCheck = (dbInstance as any)
            .prepare(
              `SELECT check_number FROM pay_stubs WHERE check_number != '' ORDER BY CAST(check_number AS INTEGER) DESC LIMIT 1`,
            )
            .get();
          if (lastCheck?.check_number) {
            lastCheckNum = parseInt(lastCheck.check_number, 10) || 1000;
          }
        } catch {
          /* ignore */
        }

        for (const s of stubs) {
          lastCheckNum++;
          const checkNumber = String(lastCheckNum).padStart(6, '0');

          const payYear = (payDate || '').substring(0, 4);
          let ytdFederal = s.federalTax || 0,
            ytdState = s.stateTax || 0,
            ytdSS = s.ss || 0,
            ytdMedicare = s.medicare || 0;
          if (payYear && s.employeeId) {
            try {
              // Exclude THIS run from the YTD sum (we just deleted its stubs but be explicit)
              const prior = (dbInstance as any)
                .prepare(
                  `
              SELECT COALESCE(SUM(ps.federal_tax), 0) AS f, COALESCE(SUM(ps.state_tax), 0) AS st,
                     COALESCE(SUM(ps.social_security), 0) AS ss, COALESCE(SUM(ps.medicare), 0) AS m
              FROM pay_stubs ps JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
              WHERE ps.employee_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ? AND pr.status != 'draft' AND pr.id != ?
            `,
                )
                .get(s.employeeId, `${payYear}-01-01`, `${payYear}-12-31`, runId);
              if (prior) {
                ytdFederal += prior.f || 0;
                ytdState += prior.st || 0;
                ytdSS += prior.ss || 0;
                ytdMedicare += prior.m || 0;
              }
            } catch {
              /* ignore */
            }
          }

          (dbInstance as any)
            .prepare(
              `
          INSERT INTO pay_stubs (id, payroll_run_id, employee_id, hours_regular, hours_overtime, gross_pay, federal_tax, state_tax, social_security, medicare, other_deductions, net_pay, ytd_gross, ytd_taxes, ytd_net, pretax_deductions, posttax_deductions, deduction_detail, check_number, ytd_federal_tax, ytd_state_tax, ytd_social_security, ytd_medicare)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            )
            .run(
              uuid(),
              runId,
              s.employeeId,
              s.hours,
              s.hoursOvertime || 0,
              s.grossPay,
              s.federalTax,
              s.stateTax,
              s.ss,
              s.medicare,
              s.netPay,
              s.ytdGross,
              s.ytdTaxes,
              s.ytdNet,
              s.preTaxDeductions || 0,
              s.postTaxDeductions || 0,
              s.deductionDetail || '{}',
              checkNumber,
              ytdFederal,
              ytdState,
              ytdSS,
              ytdMedicare,
            );
        }

        // 5. Re-post journal entry with updated totals
        const totalFederalTax = stubs.reduce((sum: number, s: any) => sum + (s.federalTax || 0), 0);
        const totalStateTax = stubs.reduce((sum: number, s: any) => sum + (s.stateTax || 0), 0);
        const totalSS = stubs.reduce((sum: number, s: any) => sum + (s.ss || 0), 0);
        const totalMedicare = stubs.reduce((sum: number, s: any) => sum + (s.medicare || 0), 0);
        const totalPreTax = stubs.reduce(
          (sum: number, s: any) => sum + (s.preTaxDeductions || 0),
          0,
        );
        const totalPostTax = stubs.reduce(
          (sum: number, s: any) => sum + (s.postTaxDeductions || 0),
          0,
        );

        // FIX #1: Employer-side payroll taxes
        const totalEmployerSS = stubs.reduce((sum: number, s: any) => sum + (s.ss || 0), 0);
        const totalEmployerMedicare = stubs.reduce(
          (sum: number, s: any) => sum + (s.medicare || 0),
          0,
        );
        let totalFUTA = 0;
        for (const s of stubs) {
          const gross = s.grossPay || 0;
          totalFUTA += Math.min(gross, 7000) * 0.006;
        }

        postJournalEntry(
          dbInstance,
          companyId,
          payDate,
          `Payroll - ${periodStart} to ${periodEnd}`,
          [
            { nameHint: 'Wages Expense', debit: totalGross, credit: 0, note: 'Gross wages' },
            { nameHint: 'Wages Payable', debit: 0, credit: totalNet, note: 'Net wages payable' },
            {
              nameHint: 'Federal Withholding',
              debit: 0,
              credit: totalFederalTax,
              note: 'Federal income tax withheld',
            },
            {
              nameHint: 'State Withholding',
              debit: 0,
              credit: totalStateTax,
              note: 'State income tax withheld',
            },
            {
              nameHint: 'Social Security Payable',
              debit: 0,
              credit: totalSS,
              note: 'Employee SS withholding',
            },
            {
              nameHint: 'Medicare Payable',
              debit: 0,
              credit: totalMedicare,
              note: 'Employee Medicare withholding',
            },
            // Pre-tax and post-tax deductions (401k, garnishments, etc.) — prevent JE imbalance
            {
              nameHint: totalPreTax > 0 ? 'Pre-tax Deductions Payable' : '_skip',
              debit: 0,
              credit: totalPreTax,
              note: 'Pre-tax deductions withheld',
            },
            {
              nameHint: totalPostTax > 0 ? 'Post-tax Deductions Payable' : '_skip',
              debit: 0,
              credit: totalPostTax,
              note: 'Post-tax deductions withheld',
            },
            // Employer-side payroll tax expenses and liabilities — FIX #1
            {
              nameHint: 'Payroll Tax Expense — FICA',
              debit: totalEmployerSS + totalEmployerMedicare,
              credit: 0,
              note: 'Employer FICA tax',
            },
            {
              nameHint: 'Social Security Payable',
              debit: 0,
              credit: totalEmployerSS,
              note: 'Employer SS matching',
            },
            {
              nameHint: 'Medicare Payable',
              debit: 0,
              credit: totalEmployerMedicare,
              note: 'Employer Medicare matching',
            },
            {
              nameHint: 'Payroll Tax Expense — FUTA',
              debit: totalFUTA,
              credit: 0,
              note: 'FUTA expense',
            },
            { nameHint: 'FUTA Payable', debit: 0, credit: totalFUTA, note: 'FUTA liability' },
          ],
        );
      });
      tx();

      scheduleAutoBackup();

      // Emit event for workflows
      try {
        eventBus
          .emit({
            type: 'payroll.processed',
            companyId,
            entityType: 'payroll_run',
            entityId: runId,
            data: {
              totalGross,
              totalNet,
              totalTaxes,
              employeeCount: employeeCount || stubs.length,
              periodStart,
              periodEnd,
              payDate,
              edited: true,
            },
          })
          .catch(() => {});
      } catch {
        /* fire-and-forget */
      }

      return { success: true, runId };
    },
  );

  // ─── Payroll: Employee Summary ───────────────────────────
  ipcMain.handle('payroll:employee-summary', (_event, { employeeId }: { employeeId: string }) => {
    try {
      const dbInstance = db.getDb();
      const year = new Date().getFullYear();
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const ytd = dbInstance
        .prepare(
          `
        SELECT
          COALESCE(SUM(gross_pay), 0) as ytd_gross,
          COALESCE(SUM(net_pay), 0) as ytd_net,
          COALESCE(SUM(federal_tax + state_tax + social_security + medicare), 0) as ytd_taxes,
          COALESCE(SUM(total_deductions), 0) as ytd_deductions,
          COUNT(*) as pay_count,
          MAX(pr.pay_date) as last_pay_date
        FROM pay_stubs ps
        JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
        -- DATE: Item #6/#18 — date() wrap; pay_date stored as date-only string,
        -- but be defensive in case future code ever stores a timestamp here.
        WHERE ps.employee_id = ? AND date(pr.pay_date) BETWEEN date(?) AND date(?)
      `,
        )
        .get(employeeId, yearStart, yearEnd) as any;

      const deductions = dbInstance
        .prepare(
          `
        SELECT * FROM employee_deductions WHERE employee_id = ? AND (end_date IS NULL OR end_date >= ?)
        ORDER BY type, name
      `,
        )
        .all(employeeId, yearStart);

      return { ytd: ytd || {}, deductions };
    } catch {
      return { ytd: {}, deductions: [] };
    }
  });

  // ─── PTO ─────────────────────────────────────────────
  ipcMain.handle('payroll:pto-policies', (_event, { companyId }: { companyId: string }) => {
    try {
      return db.queryAll('pto_policies', { company_id: companyId });
    } catch {
      return [];
    }
  });

  ipcMain.handle('payroll:pto-policy-save', (_event, data: Record<string, any>) => {
    try {
      const companyId = db.getCurrentCompanyId();
      const result = data.id
        ? db.update('pto_policies', data.id, data)
        : db.create('pto_policies', { ...data, company_id: companyId });
      scheduleAutoBackup();
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('payroll:pto-balances', (_event, { companyId }: { companyId: string }) => {
    try {
      return db
        .getDb()
        .prepare(
          `
        SELECT pb.*, e.name as employee_name, pp.name as policy_name
        FROM pto_balances pb
        JOIN employees e ON pb.employee_id = e.id
        LEFT JOIN pto_policies pp ON pb.policy_id = pp.id
        WHERE e.company_id = ?
        ORDER BY e.name`,
        )
        .all(companyId);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    'payroll:pto-adjust',
    (
      _event,
      {
        employeeId,
        policyId,
        hours,
        note,
      }: { employeeId: string; policyId: string; hours: number; note: string },
    ) => {
      try {
        const d = db.getDb();
        const existing = d
          .prepare('SELECT * FROM pto_balances WHERE employee_id = ? AND policy_id = ?')
          .get(employeeId, policyId) as any;
        if (existing) {
          db.update('pto_balances', existing.id, {
            balance_hours: Number(existing.balance_hours) + hours,
          });
        } else {
          db.create('pto_balances', {
            employee_id: employeeId,
            policy_id: policyId,
            balance_hours: hours,
            used_hours_ytd: 0,
            accrued_hours_ytd: Math.max(0, hours),
          });
        }
        db.create('pto_transactions', {
          employee_id: employeeId,
          policy_id: policyId,
          type: 'adjustment',
          hours,
          note: note || 'Manual adjustment',
        });
        scheduleAutoBackup();
        return { success: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ─── State Tax Rate ───────────────────────────────────
  ipcMain.handle(
    'payroll:state-tax-rate',
    (
      _event,
      {
        state,
        grossPay,
        allowances,
        periodsPerYear,
      }: { state: string; grossPay: number; allowances: number; periodsPerYear: number },
    ) => {
      try {
        const { stateTaxEngine } = require('../../services/StateTaxEngine');
        const withholding = stateTaxEngine.getStateWithholding(
          state,
          grossPay,
          allowances,
          periodsPerYear,
        );
        const sdi = stateTaxEngine.getSdiWithholding(state, grossPay);
        return { withholding, sdi, total: withholding + sdi };
      } catch {
        return { withholding: grossPay * 0.05, sdi: 0, total: grossPay * 0.05 };
      }
    },
  );

  // ─── HR Suite (50 features: HR1–HR50) ────────────────────
  const hrs = () => require('../../services/hr-suite-features');
  // Benefits (HR1-HR10)
  ipcMain.handle('hr:benefit-plans', (_e, { activeOnly }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().listBenefitPlans(c, !!activeOnly) : [];
  });
  ipcMain.handle('hr:benefit-plan:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().upsertBenefitPlan({ ...p, company_id: c });
  });
  ipcMain.handle('hr:benefit-plan:delete', (_e, { id }: any) => {
    hrs().deleteBenefitPlan(id);
    return { ok: true };
  });
  ipcMain.handle('hr:benefit-plan:summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().benefitPlanSummary(c) : {};
  });
  ipcMain.handle('hr:benefit-plan:enrollees', (_e, { planId }: any) =>
    hrs().benefitPlanEnrollees(planId),
  );
  ipcMain.handle('hr:enroll', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().enrollEmployee({ ...p, company_id: c });
  });
  ipcMain.handle('hr:enrollment:terminate', (_e, { id, endDate }: any) => {
    hrs().terminateEnrollment(id, endDate);
    return { ok: true };
  });
  ipcMain.handle('hr:employee-benefits', (_e, { employeeId }: any) =>
    hrs().employeeBenefits(employeeId),
  );
  ipcMain.handle('hr:enrollment:update', (_e, { id, ...data }: any) => {
    hrs().updateEnrollment(id, data);
    return { ok: true };
  });
  ipcMain.handle('hr:benefits-cost-per-employee', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().benefitsCostPerEmployee(c) : [];
  });
  // Overtime (HR11-HR15)
  ipcMain.handle('hr:overtime-rules', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().listOvertimeRules(c) : [];
  });
  ipcMain.handle('hr:overtime-rule:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().upsertOvertimeRule({ ...p, company_id: c });
  });
  ipcMain.handle('hr:overtime-rule:delete', (_e, { id }: any) => {
    hrs().deleteOvertimeRule(id);
    return { ok: true };
  });
  ipcMain.handle('hr:overtime:calculate', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().calculateOvertime(c, p.hours, p.stateCode) : {};
  });
  ipcMain.handle('hr:overtime:summary', (_e, { startDate, endDate }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().overtimeSummary(c, startDate, endDate) : [];
  });
  // Time-off (HR16-HR27)
  ipcMain.handle('hr:time-off:submit', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().submitTimeOffRequest({ ...p, company_id: c });
  });
  ipcMain.handle('hr:time-off:approve', (_e, { id, approvedBy }: any) => {
    hrs().approveTimeOffRequest(id, approvedBy);
    return { ok: true };
  });
  ipcMain.handle('hr:time-off:deny', (_e, { id, reason }: any) => {
    hrs().denyTimeOffRequest(id, reason);
    return { ok: true };
  });
  ipcMain.handle('hr:time-off:cancel', (_e, { id }: any) => {
    hrs().cancelTimeOffRequest(id);
    return { ok: true };
  });
  ipcMain.handle('hr:time-off:list', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().listTimeOffRequests(c, opts) : [];
  });
  ipcMain.handle('hr:time-off:pending-count', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().pendingTimeOffCount(c) : 0;
  });
  ipcMain.handle('hr:time-off:calendar', (_e, { month }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().timeOffCalendar(c, month) : [];
  });
  ipcMain.handle('hr:accruals:list', (_e, { employeeId }: any) =>
    hrs().listTimeOffAccruals(employeeId),
  );
  ipcMain.handle('hr:accruals:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().upsertTimeOffAccrual({ ...p, company_id: c });
  });
  ipcMain.handle('hr:accruals:run', (_e, { employeeId, hoursWorked }: any) =>
    hrs().runAccrualForEmployee(employeeId, hoursWorked),
  );
  ipcMain.handle('hr:accruals:deduct', (_e, { employeeId, type, hours }: any) =>
    hrs().deductTimeOff(employeeId, type, hours),
  );
  // Salary reviews (HR28-HR32)
  ipcMain.handle('hr:salary-reviews:list', (_e, { employeeId }: any) =>
    hrs().listSalaryReviews(employeeId),
  );
  ipcMain.handle('hr:salary-review:create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().createSalaryReview({ ...p, company_id: c });
  });
  ipcMain.handle('hr:salary-review:delete', (_e, { id }: any) => {
    hrs().deleteSalaryReview(id);
    return { ok: true };
  });
  ipcMain.handle('hr:salary-review:dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().salaryReviewDashboard(c) : {};
  });
  ipcMain.handle('hr:employees-due-for-review', (_e, { months }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().employeesDueForReview(c, months || 12) : [];
  });
  // State allocations (HR33-HR36)
  ipcMain.handle('hr:state-allocations:list', (_e, { employeeId }: any) =>
    hrs().listStateAllocations(employeeId),
  );
  ipcMain.handle('hr:state-allocation:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().upsertStateAllocation({ ...p, company_id: c });
  });
  ipcMain.handle('hr:state-allocation:delete', (_e, { id }: any) => {
    hrs().deleteStateAllocation(id);
    return { ok: true };
  });
  ipcMain.handle('hr:multi-state-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().multiStateSummary(c) : [];
  });
  // Pay schedules (HR37-HR40)
  ipcMain.handle('hr:pay-schedules', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().listPaySchedules(c) : [];
  });
  ipcMain.handle('hr:pay-schedule:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().upsertPaySchedule({ ...p, company_id: c });
  });
  ipcMain.handle('hr:pay-schedule:delete', (_e, { id }: any) => {
    hrs().deletePaySchedule(id);
    return { ok: true };
  });
  ipcMain.handle('hr:next-pay-dates', (_e, { count }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().nextPayDates(c, count || 6) : [];
  });
  // Onboarding templates (HR41-HR45)
  ipcMain.handle('hr:onboarding-templates', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().listOnboardingTemplates(c) : [];
  });
  ipcMain.handle('hr:onboarding-template:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hrs().upsertOnboardingTemplate({ ...p, company_id: c });
  });
  ipcMain.handle('hr:onboarding-template:delete', (_e, { id }: any) => {
    hrs().deleteOnboardingTemplate(id);
    return { ok: true };
  });
  ipcMain.handle('hr:onboarding:apply-template', (_e, { employeeId, templateId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().applyOnboardingTemplate(c, employeeId, templateId) : { error: 'No company' };
  });
  ipcMain.handle('hr:onboarding:assignments', (_e, { employeeId }: any) =>
    hrs().listOnboardingAssignments(employeeId),
  );
  ipcMain.handle('hr:onboarding:toggle', (_e, { id, done, completedBy }: any) => {
    hrs().toggleOnboardingAssignment(id, !!done, completedBy);
    return { ok: true };
  });
  // Analytics (HR46-HR50)
  ipcMain.handle('hr:dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().hrDashboard(c) : {};
  });
  ipcMain.handle('hr:turnover-rate', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().turnoverRate(c, year) : {};
  });
  ipcMain.handle('hr:payroll-cost-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().payrollCostSummary(c) : {};
  });
  ipcMain.handle('hr:anniversaries', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().anniversariesThisMonth(c) : [];
  });
  ipcMain.handle('hr:birthdays', () => {
    const c = db.getCurrentCompanyId();
    return c ? hrs().birthdaysThisMonth(c) : [];
  });

  // ─── HR Suite Wave 2 (50 features: HR51–HR100) ──────────
  const hr2 = () => require('../../services/hr-suite-wave2');
  // Garnishments (HR51-HR55)
  ipcMain.handle('hr:garnishments', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().listGarnishmentOrders(c, opts.employeeId) : [];
  });
  ipcMain.handle('hr:garnishment:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr2().upsertGarnishmentOrder({ ...p, company_id: c });
  });
  ipcMain.handle('hr:garnishment:delete', (_e, { id }: any) => {
    hr2().deleteGarnishmentOrder(id);
    return { ok: true };
  });
  ipcMain.handle('hr:garnishment:summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().garnishmentSummary(c) : {};
  });
  ipcMain.handle('hr:garnishment:record-deduction', (_e, { orderId, amount }: any) => {
    hr2().recordGarnishmentDeduction(orderId, amount);
    return { ok: true };
  });
  // Workers' Comp (HR56-HR60)
  ipcMain.handle('hr:workers-comp', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().listWorkersCompClasses(c) : [];
  });
  ipcMain.handle('hr:workers-comp:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr2().upsertWorkersCompClass({ ...p, company_id: c });
  });
  ipcMain.handle('hr:workers-comp:delete', (_e, { id }: any) => {
    hr2().deleteWorkersCompClass(id);
    return { ok: true };
  });
  ipcMain.handle('hr:workers-comp:estimate', (_e, { annualPayroll }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().estimateWorkersCompCost(c, annualPayroll) : {};
  });
  ipcMain.handle('hr:workers-comp:by-state', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().workersCompByState(c) : [];
  });
  // Retirement (HR61-HR66)
  ipcMain.handle('hr:retirement', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().listRetirementContributions(c, opts.employeeId) : [];
  });
  ipcMain.handle('hr:retirement:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr2().upsertRetirementContribution({ ...p, company_id: c });
  });
  ipcMain.handle('hr:retirement:delete', (_e, { id }: any) => {
    hr2().deleteRetirementContribution(id);
    return { ok: true };
  });
  ipcMain.handle('hr:retirement:summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().retirementSummary(c) : {};
  });
  ipcMain.handle('hr:retirement:nearing-limit', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().retirementNearingLimit(c) : [];
  });
  ipcMain.handle(
    'hr:retirement:record-payment',
    (_e, { id, employeeAmount, employerAmount }: any) => {
      hr2().recordRetirementContributionPayment(id, employeeAmount, employerAmount);
      return { ok: true };
    },
  );
  // Compliance docs (HR67-HR71)
  ipcMain.handle('hr:compliance-docs', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().listComplianceDocs(c, opts.personType, opts.personId) : [];
  });
  ipcMain.handle('hr:compliance-doc:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr2().upsertComplianceDoc({ ...p, company_id: c });
  });
  ipcMain.handle('hr:compliance-doc:delete', (_e, { id }: any) => {
    hr2().deleteComplianceDoc(id);
    return { ok: true };
  });
  ipcMain.handle('hr:compliance:expiring', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().complianceExpiringSoon(c, days || 30) : [];
  });
  ipcMain.handle('hr:compliance:overview', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().complianceOverview(c) : {};
  });
  // Year-end (HR72-HR75)
  ipcMain.handle('hr:year-end:get', (_e, { year }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().getYearEndSummary(c, year) : null;
  });
  ipcMain.handle('hr:year-end:generate', (_e, { year }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().generateYearEndSummary(c, year) : {};
  });
  ipcMain.handle('hr:year-end:list', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().listYearEndSummaries(c) : [];
  });
  ipcMain.handle('hr:year-end:yoy', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().yearOverYearComparison(c) : [];
  });
  // Labor cost (HR76-HR80)
  ipcMain.handle('hr:labor-cost:by-dept', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().laborCostByDepartment(c) : [];
  });
  ipcMain.handle('hr:labor-cost:by-type', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().laborCostByType(c) : [];
  });
  ipcMain.handle('hr:labor-cost:total', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().totalLaborCost(c) : {};
  });
  ipcMain.handle('hr:cost-per-hire', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().costPerHire(c, year) : {};
  });
  ipcMain.handle('hr:compensation-distribution', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().compensationDistribution(c) : [];
  });
  // Directory + org (HR81-HR85)
  ipcMain.handle('hr:directory', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().employeeDirectory(c) : [];
  });
  ipcMain.handle('hr:headcount-by-month', (_e, { months }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().headcountByMonth(c, months || 12) : [];
  });
  ipcMain.handle('hr:by-location', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().employeesByLocation(c) : [];
  });
  ipcMain.handle('hr:tenure-milestones', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().tenureMilestones(c) : [];
  });
  ipcMain.handle('hr:new-hire-report', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().newHireReport(c, days || 90) : [];
  });
  // Pay equity (HR86-HR90)
  ipcMain.handle('hr:pay-equity:by-dept', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().payEquityByDepartment(c) : [];
  });
  ipcMain.handle('hr:pay-equity:by-role', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().payEquityByRole(c) : [];
  });
  ipcMain.handle('hr:compensation-benchmark', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().compensationBenchmark(c) : {};
  });
  ipcMain.handle('hr:recent-raises', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().recentRaises(c, days || 90) : [];
  });
  ipcMain.handle('hr:top-earners', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().topEarners(c, limit || 10) : [];
  });
  // Probation + retention (HR91-HR95)
  ipcMain.handle('hr:probation', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().employeesOnProbation(c, days || 90) : [];
  });
  ipcMain.handle('hr:onboarding-progress', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().onboardingProgress(c) : [];
  });
  ipcMain.handle('hr:onboarding-overdue', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().onboardingOverdueItems(c) : [];
  });
  ipcMain.handle('hr:retention-risk', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().employeeRetentionRisk(c) : [];
  });
  ipcMain.handle('hr:satisfaction-proxy', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().employeeSatisfactionProxy(c) : {};
  });
  // Advanced reports (HR96-HR100)
  ipcMain.handle('hr:employee-snapshot', (_e, { employeeId }: any) =>
    hr2().fullEmployeeSnapshot(employeeId),
  );
  ipcMain.handle('hr:bulk-status-change', (_e, { employeeIds, newStatus }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().bulkStatusChange(c, employeeIds, newStatus) : {};
  });
  ipcMain.handle('hr:export-roster', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().exportEmployeeRoster(c) : [];
  });
  ipcMain.handle('hr:termination-report', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().terminationReport(c, year) : [];
  });
  ipcMain.handle('hr:company-wide-metrics', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr2().companyWideHRMetrics(c) : {};
  });

  // ─── HR Suite Wave 3 (HR101–HR150) ──────────────────────
  const hr3 = () => require('../../services/hr-suite-wave3');
  // COBRA (HR101-HR106)
  ipcMain.handle('hr:cobra:list', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().listCobraRecords(c, opts.employeeId) : [];
  });
  ipcMain.handle('hr:cobra:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr3().upsertCobraRecord({ ...p, company_id: c });
  });
  ipcMain.handle('hr:cobra:delete', (_e, { id }: any) => {
    hr3().deleteCobraRecord(id);
    return { ok: true };
  });
  ipcMain.handle('hr:cobra:pending-notices', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().cobraPendingNotices(c) : [];
  });
  ipcMain.handle('hr:cobra:mark-sent', (_e, { id }: any) => {
    hr3().markCobraNoticeSent(id);
    return { ok: true };
  });
  ipcMain.handle('hr:cobra:summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().cobraSummary(c) : {};
  });
  // Direct deposit (HR107-HR112)
  ipcMain.handle('hr:dd-accounts', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().listDirectDepositAccounts(c, opts.employeeId) : [];
  });
  ipcMain.handle('hr:dd-account:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr3().upsertDirectDeposit({ ...p, company_id: c });
  });
  ipcMain.handle('hr:dd-account:delete', (_e, { id }: any) => {
    hr3().deleteDirectDeposit(id);
    return { ok: true };
  });
  ipcMain.handle('hr:dd-batches', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().listDirectDepositBatches(c) : [];
  });
  ipcMain.handle('hr:dd-batch:create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr3().createDirectDepositBatch({ ...p, company_id: c });
  });
  ipcMain.handle('hr:dd-batch:submit', (_e, { id }: any) => {
    hr3().submitDirectDepositBatch(id);
    return { ok: true };
  });
  // Life events (HR113-HR117)
  ipcMain.handle('hr:life-events', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().listLifeEvents(c, opts.employeeId) : [];
  });
  ipcMain.handle('hr:life-event:create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr3().createLifeEvent({ ...p, company_id: c });
  });
  ipcMain.handle('hr:life-event:processed', (_e, { id }: any) => {
    hr3().markLifeEventProcessed(id);
    return { ok: true };
  });
  ipcMain.handle('hr:life-events:pending', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().pendingLifeEvents(c) : [];
  });
  ipcMain.handle('hr:life-event:delete', (_e, { id }: any) => {
    hr3().deleteLifeEvent(id);
    return { ok: true };
  });
  // W-2 runs (HR118-HR122)
  ipcMain.handle('hr:w2-runs', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().listW2Runs(c) : [];
  });
  ipcMain.handle('hr:w2-run:get', (_e, { year }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().getW2Run(c, year) : null;
  });
  ipcMain.handle('hr:w2-run:generate', (_e, { year }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().generateW2Run(c, year) : {};
  });
  ipcMain.handle('hr:w2-run:submit', (_e, { id, submittedBy }: any) => {
    hr3().submitW2Run(id, submittedBy || '');
    return { ok: true };
  });
  ipcMain.handle('hr:w2-per-employee', (_e, { year }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().w2PerEmployeeDetail(c, year) : [];
  });
  // Check runs (HR123-HR126)
  ipcMain.handle('hr:check-runs', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().listCheckPrintRuns(c) : [];
  });
  ipcMain.handle('hr:check-run:create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr3().createCheckPrintRun({ ...p, company_id: c });
  });
  ipcMain.handle('hr:check-run:printed', (_e, { id }: any) => {
    hr3().markChecksPrinted(id);
    return { ok: true };
  });
  ipcMain.handle('hr:check-run:void', (_e, { id }: any) => {
    hr3().voidCheckRun(id);
    return { ok: true };
  });
  // State reciprocity + journal links (HR127-HR130)
  ipcMain.handle('hr:state-reciprocity', () => hr3().listStateReciprocity());
  ipcMain.handle('hr:check-reciprocity', (_e, { workState, residentState }: any) =>
    hr3().checkReciprocity(workState, residentState),
  );
  ipcMain.handle('hr:payroll-journal-links', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().listPayrollJournalLinks(c) : [];
  });
  ipcMain.handle('hr:payroll-journal-link:create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr3().createPayrollJournalLink({ ...p, company_id: c });
  });
  // Legacy garnishments (HR131-HR135)
  ipcMain.handle('hr:garnishments-legacy', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().listGarnishments(c, opts.employeeId) : [];
  });
  ipcMain.handle('hr:garnishment-legacy:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return hr3().upsertGarnishment({ ...p, company_id: c });
  });
  ipcMain.handle('hr:garnishment-legacy:delete', (_e, { id }: any) => {
    hr3().deleteGarnishment(id);
    return { ok: true };
  });
  ipcMain.handle('hr:garnishment-legacy:record-payment', (_e, { id, amount }: any) => {
    hr3().recordGarnishmentPayment(id, amount);
    return { ok: true };
  });
  ipcMain.handle('hr:garnishments-legacy:total', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().activeGarnishmentTotal(c) : {};
  });
  // Advanced payroll analytics (HR136-HR140)
  ipcMain.handle('hr:payroll-by-month', (_e, { months }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().payrollByMonth(c, months || 12) : [];
  });
  ipcMain.handle('hr:avg-pay-by-dept', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().avgPayByDepartment(c) : [];
  });
  ipcMain.handle('hr:payroll-tax-liability', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().payrollTaxLiability(c, year) : {};
  });
  ipcMain.handle('hr:highest-paid-by-dept', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().highestPaidByDepartment(c) : [];
  });
  ipcMain.handle('hr:pay-stub-search', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().payStubSearch(c, opts) : [];
  });
  // Workforce planning (HR141-HR145)
  ipcMain.handle('hr:headcount-forecast', (_e, { months }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().headcountForecast(c, months || 6) : {};
  });
  ipcMain.handle('hr:labor-budget-variance', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().laborBudgetVariance(c) : {};
  });
  ipcMain.handle('hr:dept-staffing', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().departmentStaffingLevels(c) : [];
  });
  ipcMain.handle('hr:fte-count', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().fteCount(c) : {};
  });
  ipcMain.handle('hr:seasonal-hiring', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().seasonalHiringPattern(c) : [];
  });
  // HR action log + misc (HR146-HR150)
  ipcMain.handle('hr:action-log', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().hrActionLog(c, days || 30) : [];
  });
  ipcMain.handle('hr:employee-cost-breakdown', (_e, { employeeId }: any) =>
    hr3().employeeCostBreakdown(employeeId),
  );
  ipcMain.handle('hr:employee-timeline', (_e, { employeeId }: any) =>
    hr3().employeeTimelineSummary(employeeId),
  );
  ipcMain.handle('hr:org-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().companyOrgSummary(c) : {};
  });
  ipcMain.handle('hr:compliance-checklist', () => {
    const c = db.getCurrentCompanyId();
    return c ? hr3().hrComplianceChecklist(c) : [];
  });
}
