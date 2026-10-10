import type { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import { eventBus } from '../../services/EventBus';
import * as db from '../../database';
import type { IpcDeps } from '../core/types';
import { calculateFullPayroll } from '../../services/TaxCalculationEngine';

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
  ipcMain.handle('cal:export-payroll-ics', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { exportPayrollSchedule } = require('../../services/ical-export');
      return { ics: exportPayrollSchedule(cid) };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ─── Dynamic Tax Configuration ────────────────────────────

  ipcMain.handle('tax:seed-year', (_event, { year }: { year: number }) => {
    const dbInstance = db.getDb();
    const taxData: Record<number, any> = {
      2024: {
        constants: {
          ss_wage_base: 168600,
          standard_deduction_single: 14600,
          standard_deduction_married: 29200,
          standard_deduction_hoh: 21900,
        },
        brackets: {
          single: [
            [0, 11600, 0.1],
            [11600, 47150, 0.12],
            [47150, 100525, 0.22],
            [100525, 191950, 0.24],
            [191950, 243725, 0.32],
            [243725, 609350, 0.35],
            [609350, null, 0.37],
          ],
          married_jointly: [
            [0, 23200, 0.1],
            [23200, 94300, 0.12],
            [94300, 201050, 0.22],
            [201050, 383900, 0.24],
            [383900, 487450, 0.32],
            [487450, 731200, 0.35],
            [731200, null, 0.37],
          ],
          married_separately: [
            [0, 11600, 0.1],
            [11600, 47150, 0.12],
            [47150, 100525, 0.22],
            [100525, 191950, 0.24],
            [191950, 243725, 0.32],
            [243725, 365675, 0.35],
            [365675, null, 0.37],
          ],
          head_of_household: [
            [0, 16550, 0.1],
            [16550, 63100, 0.12],
            [63100, 100500, 0.22],
            [100500, 191950, 0.24],
            [191950, 243700, 0.32],
            [243700, 609350, 0.35],
            [609350, null, 0.37],
          ],
        },
      },
      2025: {
        constants: {
          ss_wage_base: 176100,
          standard_deduction_single: 15000,
          standard_deduction_married: 30000,
          standard_deduction_hoh: 22500,
        },
        brackets: {
          single: [
            [0, 11925, 0.1],
            [11925, 48475, 0.12],
            [48475, 103350, 0.22],
            [103350, 197300, 0.24],
            [197300, 250525, 0.32],
            [250525, 626350, 0.35],
            [626350, null, 0.37],
          ],
          married_jointly: [
            [0, 23850, 0.1],
            [23850, 96950, 0.12],
            [96950, 206700, 0.22],
            [206700, 394600, 0.24],
            [394600, 501050, 0.32],
            [501050, 751600, 0.35],
            [751600, null, 0.37],
          ],
          married_separately: [
            [0, 11925, 0.1],
            [11925, 48475, 0.12],
            [48475, 103350, 0.22],
            [103350, 197300, 0.24],
            [197300, 250525, 0.32],
            [250525, 375975, 0.35],
            [375975, null, 0.37],
          ],
          head_of_household: [
            [0, 17000, 0.1],
            [17000, 64850, 0.12],
            [64850, 103350, 0.22],
            [103350, 197300, 0.24],
            [197300, 250500, 0.32],
            [250500, 626350, 0.35],
            [626350, null, 0.37],
          ],
        },
      },
      2026: {
        constants: {
          ss_wage_base: 182100,
          standard_deduction_single: 15400,
          standard_deduction_married: 30800,
          standard_deduction_hoh: 23100,
        },
        brackets: {
          single: [
            [0, 12250, 0.1],
            [12250, 49800, 0.12],
            [49800, 106200, 0.22],
            [106200, 202750, 0.24],
            [202750, 257500, 0.32],
            [257500, 643750, 0.35],
            [643750, null, 0.37],
          ],
          married_jointly: [
            [0, 24500, 0.1],
            [24500, 99600, 0.12],
            [99600, 212400, 0.22],
            [212400, 405500, 0.24],
            [405500, 515000, 0.32],
            [515000, 772500, 0.35],
            [772500, null, 0.37],
          ],
          married_separately: [
            [0, 12250, 0.1],
            [12250, 49800, 0.12],
            [49800, 106200, 0.22],
            [106200, 202750, 0.24],
            [202750, 257500, 0.32],
            [257500, 386250, 0.35],
            [386250, null, 0.37],
          ],
          head_of_household: [
            [0, 17500, 0.1],
            [17500, 66700, 0.12],
            [66700, 106200, 0.22],
            [106200, 202750, 0.24],
            [202750, 257475, 0.32],
            [257475, 643750, 0.35],
            [643750, null, 0.37],
          ],
        },
      },
    };

    const data = taxData[year];
    if (!data) return { success: false, message: `No data for year ${year}` };

    const seedTx = dbInstance.transaction(() => {
      // Upsert constants
      const existing = dbInstance
        .prepare('SELECT id FROM federal_payroll_constants WHERE tax_year = ?')
        .get(year);
      const c = data.constants;
      if (existing) {
        dbInstance
          .prepare(
            `UPDATE federal_payroll_constants SET ss_wage_base = ?, standard_deduction_single = ?, standard_deduction_married = ?, standard_deduction_hoh = ? WHERE tax_year = ?`,
          )
          .run(
            c.ss_wage_base,
            c.standard_deduction_single,
            c.standard_deduction_married,
            c.standard_deduction_hoh,
            year,
          );
      } else {
        dbInstance
          .prepare(
            `INSERT INTO federal_payroll_constants (id, tax_year, ss_wage_base, ss_rate, medicare_rate, medicare_additional_rate, medicare_additional_threshold_single, medicare_additional_threshold_married, futa_rate, futa_wage_base, standard_deduction_single, standard_deduction_married, standard_deduction_hoh) VALUES (?, ?, ?, 0.062, 0.0145, 0.009, 200000, 250000, 0.006, 7000, ?, ?, ?)`,
          )
          .run(
            uuid(),
            year,
            c.ss_wage_base,
            c.standard_deduction_single,
            c.standard_deduction_married,
            c.standard_deduction_hoh,
          );
      }

      // Upsert brackets
      const statusMap: Record<string, string> = {
        single: 'single',
        married_jointly: 'married_jointly',
        married_separately: 'married_separately',
        head_of_household: 'head_of_household',
      };
      for (const [status, brackets] of Object.entries(data.brackets)) {
        for (const [min, max, rate] of brackets as any[]) {
          const existBracket = dbInstance
            .prepare(
              'SELECT id FROM federal_tax_brackets WHERE tax_year = ? AND filing_status = ? AND bracket_min = ?',
            )
            .get(year, statusMap[status], min);
          if (existBracket) {
            dbInstance
              .prepare('UPDATE federal_tax_brackets SET bracket_max = ?, rate = ? WHERE id = ?')
              .run(max, rate, (existBracket as any).id);
          } else {
            dbInstance
              .prepare(
                'INSERT INTO federal_tax_brackets (id, tax_year, filing_status, bracket_min, bracket_max, rate) VALUES (?, ?, ?, ?, ?, ?)',
              )
              .run(uuid(), year, statusMap[status], min, max, rate);
          }
        }
      }
    });
    seedTx();
    scheduleAutoBackup();
    return { success: true, year };
  });
  ipcMain.handle('tax:get-brackets', (_event, { year }: { year: number }) => {
    const dbInstance = db.getDb();
    const rawBrackets = dbInstance
      .prepare(
        'SELECT * FROM federal_tax_brackets WHERE tax_year = ? ORDER BY filing_status, bracket_min',
      )
      .all(year) as any[];
    const constants = dbInstance
      .prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?')
      .get(year);

    // Group brackets by filing status, mapping DB names to UI names
    const statusToUI: Record<string, string> = {
      single: 'single',
      married_jointly: 'married_filing_jointly',
      married_separately: 'married_filing_separately',
      head_of_household: 'head_of_household',
    };
    const brackets: Record<string, any[]> = {};
    for (const b of rawBrackets) {
      const uiKey = statusToUI[b.filing_status] ?? b.filing_status;
      if (!brackets[uiKey]) brackets[uiKey] = [];
      brackets[uiKey].push({ min: b.bracket_min, max: b.bracket_max, rate: b.rate });
    }
    return { brackets, constants };
  });
  ipcMain.handle(
    'tax:calculate-withholding',
    (
      _event,
      {
        grossPay,
        filingStatus,
        allowances,
        year,
        ytdGross,
      }: {
        grossPay: number;
        filingStatus: string;
        allowances: number;
        year: number;
        ytdGross: number;
      },
    ) => {
      const dbInstance = db.getDb();
      const constants = dbInstance
        .prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?')
        .get(year) as any;
      if (!constants) return { federal: 0, ss: 0, medicare: 0, total: 0 };

      // The UI sends `married_filing_jointly`/`married_filing_separately`, but
      // federal_tax_brackets is keyed by the DB spelling (`married_jointly`/
      // `married_separately`). Without this translation the bracket query below
      // matched 0 rows for married filers → federal withholding silently 0.
      const dbFilingStatus =
        (
          {
            married_filing_jointly: 'married_jointly',
            married_filing_separately: 'married_separately',
          } as Record<string, string>
        )[filingStatus] ?? filingStatus;

      const brackets = dbInstance
        .prepare(
          'SELECT * FROM federal_tax_brackets WHERE tax_year = ? AND filing_status = ? ORDER BY bracket_min',
        )
        .all(year, dbFilingStatus) as any[];

      // Annualize
      const annualized = grossPay * 26; // biweekly assumption
      const stdDed =
        dbFilingStatus === 'married_jointly'
          ? constants.standard_deduction_married
          : dbFilingStatus === 'head_of_household'
            ? constants.standard_deduction_hoh
            : constants.standard_deduction_single;
      const taxableAnnual = Math.max(0, annualized - stdDed - allowances * 4300);

      let annualFederal = 0;
      for (const bracket of brackets) {
        if (taxableAnnual <= bracket.bracket_min) break;
        const upper = bracket.bracket_max ?? Infinity;
        const taxable = Math.min(taxableAnnual, upper) - bracket.bracket_min;
        annualFederal += taxable * bracket.rate;
      }
      const federal = annualFederal / 26;

      // FICA
      const ssRemaining = Math.max(0, constants.ss_wage_base - ytdGross);
      const ssWages = Math.min(grossPay, ssRemaining);
      const ss = ssWages * constants.ss_rate;
      const medicare = grossPay * constants.medicare_rate;

      return {
        federal: Math.round(federal * 100) / 100,
        ss: Math.round(ss * 100) / 100,
        medicare: Math.round(medicare * 100) / 100,
        total: Math.round((federal + ss + medicare) * 100) / 100,
      };
    },
  );
  // FIX #10/#11: Single source of truth for federal payroll constants.
  // Returns SS wage base, FICA rates, FUTA rate/wage base, and standard
  // deductions for a given tax year. Both frontend (PayrollRunner) and
  // backend (TaxCalculationEngine) call this instead of using hardcoded
  // values that drift between files and across years.
  ipcMain.handle('tax:get-payroll-constants', (_event, { year }: { year: number }) => {
    try {
      const dbInstance = db.getDb();
      const constants = dbInstance
        .prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?')
        .get(year) as any;
      if (!constants) {
        // Attempt to auto-seed if missing
        const { seedTaxYear } = require('../../services/tax-forms/seed-tax-year');
        try {
          seedTaxYear(year);
        } catch {
          /* ignore */
        }
        const retry = dbInstance
          .prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?')
          .get(year) as any;
        if (!retry) return { error: `No constants available for tax year ${year}` };
        return retry;
      }
      return constants;
    } catch (err: any) {
      return { error: err?.message || 'Failed to fetch payroll constants' };
    }
  });
  ipcMain.handle('tax:available-years', () => {
    const dbInstance = db.getDb();
    const years = dbInstance
      .prepare('SELECT DISTINCT tax_year FROM federal_payroll_constants ORDER BY tax_year DESC')
      .all() as any[];
    return years.map((r: any) => r.tax_year);
  });
  ipcMain.handle('tax:auto-seed-current-year', () => {
    const currentYear = new Date().getFullYear();
    const dbInstance = db.getDb();
    const exists = dbInstance
      .prepare('SELECT id FROM federal_payroll_constants WHERE tax_year = ?')
      .get(currentYear);
    if (exists) return { seeded: false, year: currentYear };
    // Trigger seeding via the seed handler
    return {
      seeded: true,
      year: currentYear,
      message: 'Use tax:seed-year to seed data for ' + currentYear,
    };
  });
  // ─── Tax System: IPC Handlers ──────────────────────────────

  ipcMain.handle('tax:get-utah-config', (_event, { year }: { year: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();
    return (
      dbInstance
        .prepare('SELECT * FROM utah_withholding_config WHERE company_id = ? AND tax_year = ?')
        .get(companyId, year) ?? null
    );
  });
  ipcMain.handle(
    'tax:save-utah-config',
    (_event, { year, config }: { year: number; config: Record<string, any> }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No active company' };
      const dbInstance = db.getDb();
      const existing = dbInstance
        .prepare('SELECT id FROM utah_withholding_config WHERE company_id = ? AND tax_year = ?')
        .get(companyId, year) as any;

      const flat_rate = config.flat_rate ?? 0.0455;
      const personal_exemption_credit = config.personal_exemption_credit ?? 393;
      const sui_rate = config.sui_rate ?? 0.012;
      const sui_wage_base = config.sui_wage_base ?? 44800;
      const wc_rate = config.wc_rate ?? 0.008;
      const wc_class_code = config.wc_class_code ?? '8810';
      const wc_carrier = config.wc_carrier ?? '';

      let id: string;
      if (existing) {
        id = existing.id;
        dbInstance
          .prepare(
            `
        UPDATE utah_withholding_config
        SET flat_rate = ?, personal_exemption_credit = ?, sui_rate = ?, sui_wage_base = ?,
            wc_rate = ?, wc_class_code = ?, wc_carrier = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
          )
          .run(
            flat_rate,
            personal_exemption_credit,
            sui_rate,
            sui_wage_base,
            wc_rate,
            wc_class_code,
            wc_carrier,
            id,
          );
      } else {
        id = uuid();
        dbInstance
          .prepare(
            `
        INSERT INTO utah_withholding_config (id, company_id, tax_year, flat_rate, personal_exemption_credit, sui_rate, sui_wage_base, wc_rate, wc_class_code, wc_carrier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
          )
          .run(
            id,
            companyId,
            year,
            flat_rate,
            personal_exemption_credit,
            sui_rate,
            sui_wage_base,
            wc_rate,
            wc_class_code,
            wc_carrier,
          );
      }
      scheduleAutoBackup();
      return { success: true, id };
    },
  );
  ipcMain.handle(
    'tax:get-filing-summary',
    (_event, { year, quarter }: { year: number; quarter?: number }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return [];
      const dbInstance = db.getDb();

      const quarters = quarter ? [quarter] : [1, 2, 3, 4];
      const results: any[] = [];

      for (const q of quarters) {
        const startMonth = (q - 1) * 3 + 1;
        const endMonth = q * 3;
        const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
        const endDay = new Date(year, endMonth, 0).getDate();
        const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

        const agg = dbInstance
          .prepare(
            `
        SELECT
          COUNT(DISTINCT ps.employee_id) as employee_count,
          COALESCE(SUM(ps.gross_pay), 0) as total_gross,
          COALESCE(SUM(ps.federal_tax), 0) as total_federal,
          COALESCE(SUM(ps.state_tax), 0) as total_state,
          COALESCE(SUM(ps.social_security), 0) as total_ss,
          COALESCE(SUM(ps.medicare), 0) as total_medicare
        FROM pay_stubs ps
        JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
        WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
      `,
          )
          .get(companyId, startDate, endDate) as any;

        const filing941 = dbInstance
          .prepare(
            "SELECT * FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? AND quarter = ? AND form_type = '941'",
          )
          .get(companyId, year, q) as any;

        const filingTC941 = dbInstance
          .prepare(
            "SELECT * FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? AND quarter = ? AND form_type IN ('tc-941', 'TC-941')",
          )
          .get(companyId, year, q) as any;

        const ss_ee = db.roundCents(agg.total_ss);
        const ss_er = db.roundCents(agg.total_ss);
        const med_ee = db.roundCents(agg.total_medicare);
        const med_er = db.roundCents(agg.total_medicare);
        const fed_wh = db.roundCents(agg.total_federal);
        const liability_941 = db.roundCents(fed_wh + ss_ee + ss_er + med_ee + med_er);

        // Compute due dates
        const dueDates: Record<number, string> = {
          1: `${year}-04-30`,
          2: `${year}-07-31`,
          3: `${year}-10-31`,
          4: `${year + 1}-01-31`,
        };

        // Deposits from filing records
        const deposits941 = filing941?.amount_paid ?? 0;
        const depositsTC941 = filingTC941?.amount_paid ?? 0;

        results.push({
          quarter: q,
          period_start: startDate,
          period_end: endDate,
          due_date: dueDates[q] || '',
          wages: db.roundCents(agg.total_gross),
          federal_wh: fed_wh,
          ss_ee,
          ss_er,
          medicare_ee: med_ee,
          medicare_er: med_er,
          total_liability: liability_941,
          deposits_made: db.roundCents(deposits941),
          balance_due: db.roundCents(liability_941 - deposits941),
          status_941: filing941?.status ?? 'not_filed',
          status_tc941: filingTC941?.status ?? 'not_filed',
          state_wages: db.roundCents(agg.total_gross),
          state_wh: db.roundCents(agg.total_state),
          state_deposits: db.roundCents(depositsTC941),
          state_balance_due: db.roundCents(agg.total_state - depositsTC941),
          employee_count: agg.employee_count,
        });
      }
      return results;
    },
  );
  ipcMain.handle(
    'tax:record-filing',
    (
      _event,
      {
        form_type,
        year,
        quarter,
        filed_date,
        confirmation_number,
        amount_paid,
        payment_date,
        notes,
      }: {
        form_type: string;
        year: number;
        quarter: number;
        filed_date?: string;
        confirmation_number?: string;
        amount_paid?: number;
        payment_date?: string;
        notes?: string;
      },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No active company' };
      const dbInstance = db.getDb();

      const existing = dbInstance
        .prepare(
          'SELECT id, amount_paid FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? AND quarter = ? AND form_type = ?',
        )
        .get(companyId, year, quarter, form_type) as any;

      let id: string;
      if (existing) {
        id = existing.id;
        const newAmountPaid = db.roundCents((existing.amount_paid || 0) + (amount_paid || 0));
        dbInstance
          .prepare(
            `
        UPDATE tax_filing_periods
        SET status = 'filed', filed_date = COALESCE(?, filed_date), confirmation_number = COALESCE(?, confirmation_number),
            amount_paid = ?, payment_date = COALESCE(?, payment_date), notes = COALESCE(?, notes), updated_at = datetime('now')
        WHERE id = ?
      `,
          )
          .run(
            filed_date || null,
            confirmation_number || null,
            newAmountPaid,
            payment_date || null,
            notes || null,
            id,
          );
      } else {
        id = uuid();
        dbInstance
          .prepare(
            `
        INSERT INTO tax_filing_periods (id, company_id, tax_year, quarter, form_type, status, filed_date, confirmation_number, amount_paid, payment_date, notes)
        VALUES (?, ?, ?, ?, ?, 'filed', ?, ?, ?, ?, ?)
      `,
          )
          .run(
            id,
            companyId,
            year,
            quarter,
            form_type,
            filed_date || '',
            confirmation_number || '',
            db.roundCents(amount_paid || 0),
            payment_date || '',
            notes || '',
          );
      }
      scheduleAutoBackup();
      return { success: true, id };
    },
  );
  ipcMain.handle(
    'tax:get-w2-data',
    (_event, { year, employee_id }: { year: number; employee_id?: string }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return [];
      const dbInstance = db.getDb();

      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      let sql = `
      SELECT
        e.id as employee_id,
        e.name,
        e.ssn,
        e.ssn_last4,
        e.address_line1,
        e.address_line2,
        e.city,
        e.state,
        e.zip,
        COALESCE(SUM(ps.gross_pay), 0) as box1,
        COALESCE(SUM(ps.federal_tax), 0) as box2,
        COALESCE(SUM(ps.gross_pay), 0) as box3,
        COALESCE(SUM(ps.social_security), 0) as box4,
        COALESCE(SUM(ps.gross_pay), 0) as box5,
        COALESCE(SUM(ps.medicare), 0) as box6,
        COALESCE(SUM(ps.gross_pay), 0) as box16,
        COALESCE(SUM(ps.state_tax), 0) as box17
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      JOIN employees e ON ps.employee_id = e.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `;
      const params: any[] = [companyId, startDate, endDate];

      if (employee_id) {
        sql += ' AND ps.employee_id = ?';
        params.push(employee_id);
      }

      sql += ' GROUP BY ps.employee_id ORDER BY e.name';

      const rows = dbInstance.prepare(sql).all(...params) as any[];
      return rows.map((r: any) => ({
        employee_id: r.employee_id,
        employee_name: r.name || 'Unknown',
        ssn: r.ssn || '',
        ssn_last4: r.ssn_last4 || '',
        address_line1: r.address_line1 || '',
        address_line2: r.address_line2 || '',
        city: r.city || '',
        state: r.state || '',
        zip: r.zip || '',
        gross_wages: db.roundCents(r.box1),
        federal_wh: db.roundCents(r.box2),
        ss_wages: db.roundCents(r.box3),
        ss_tax: db.roundCents(r.box4),
        medicare_wages: db.roundCents(r.box5),
        medicare_tax: db.roundCents(r.box6),
        state_wages: db.roundCents(r.box16),
        state_wh: db.roundCents(r.box17),
      }));
    },
  );
  ipcMain.handle('tax:get-w3-data', (_event, { year }: { year: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const row = dbInstance
      .prepare(
        `
      SELECT
        COUNT(DISTINCT ps.employee_id) as employee_count,
        COALESCE(SUM(ps.gross_pay), 0) as box1,
        COALESCE(SUM(ps.federal_tax), 0) as box2,
        COALESCE(SUM(ps.gross_pay), 0) as box3,
        COALESCE(SUM(ps.social_security), 0) as box4,
        COALESCE(SUM(ps.gross_pay), 0) as box5,
        COALESCE(SUM(ps.medicare), 0) as box6,
        COALESCE(SUM(ps.gross_pay), 0) as box16,
        COALESCE(SUM(ps.state_tax), 0) as box17
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `,
      )
      .get(companyId, startDate, endDate) as any;

    if (!row) return null;
    return {
      total_employees: row.employee_count,
      total_wages: db.roundCents(row.box1),
      total_federal_wh: db.roundCents(row.box2),
      total_ss_wages: db.roundCents(row.box3),
      total_ss_tax: db.roundCents(row.box4),
      total_medicare_wages: db.roundCents(row.box5),
      total_medicare_tax: db.roundCents(row.box6),
      total_state_wages: db.roundCents(row.box16),
      total_state_wh: db.roundCents(row.box17),
    };
  });
  ipcMain.handle('tax:dashboard-summary', (_event, { year }: { year: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const pyStart = `${year - 1}-01-01`;
    const pyEnd = `${year - 1}-12-31`;

    // YTD totals
    const ytd = dbInstance
      .prepare(
        `
      SELECT
        COALESCE(SUM(ps.gross_pay), 0) as total_gross,
        COALESCE(SUM(ps.federal_tax), 0) as total_federal,
        COALESCE(SUM(ps.state_tax), 0) as total_state,
        COALESCE(SUM(ps.social_security), 0) as total_ss,
        COALESCE(SUM(ps.medicare), 0) as total_medicare
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `,
      )
      .get(companyId, startDate, endDate) as any;

    // Prior year payroll total
    const py = dbInstance
      .prepare(
        `
      SELECT COALESCE(SUM(ps.gross_pay), 0) as total_gross
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `,
      )
      .get(companyId, pyStart, pyEnd) as any;

    // Filing periods for this year
    const filings = dbInstance
      .prepare(
        'SELECT * FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? ORDER BY quarter, form_type',
      )
      .all(companyId, year) as any[];

    // Per-quarter breakdown
    const quarters: any[] = [];
    for (let q = 1; q <= 4; q++) {
      const sm = (q - 1) * 3 + 1;
      const em = q * 3;
      const qs = `${year}-${String(sm).padStart(2, '0')}-01`;
      const ed = new Date(year, em, 0).getDate();
      const qe = `${year}-${String(em).padStart(2, '0')}-${String(ed).padStart(2, '0')}`;

      const qa = dbInstance
        .prepare(
          `
        SELECT
          COALESCE(SUM(ps.federal_tax), 0) as federal,
          COALESCE(SUM(ps.state_tax), 0) as state,
          COALESCE(SUM(ps.social_security), 0) as ss,
          COALESCE(SUM(ps.medicare), 0) as medicare
        FROM pay_stubs ps
        JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
        WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
      `,
        )
        .get(companyId, qs, qe) as any;

      quarters.push({
        quarter: q,
        federal: db.roundCents(qa.federal),
        state: db.roundCents(qa.state),
        fica: db.roundCents(qa.ss * 2 + qa.medicare * 2),
      });
    }

    return {
      ytd_payroll: db.roundCents(ytd.total_gross),
      ytd_federal: db.roundCents(ytd.total_federal),
      ytd_state: db.roundCents(ytd.total_state),
      ytd_fica: db.roundCents(ytd.total_ss * 2 + ytd.total_medicare * 2),
      py_payroll: db.roundCents(py.total_gross),
      filings,
      quarters,
    };
  });
  ipcMain.handle(
    'tax:liability-report',
    (
      _event,
      {
        year,
        quarter_start,
        quarter_end,
      }: { year: number; quarter_start: number; quarter_end: number },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const dbInstance = db.getDb();

      const startMonth = (quarter_start - 1) * 3 + 1;
      const endMonth = quarter_end * 3;
      const periodStart = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      const endDay = new Date(year, endMonth, 0).getDate();
      const periodEnd = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
      const ytdStart = `${year}-01-01`;

      const aggregateSql = `
      SELECT
        COALESCE(SUM(ps.gross_pay), 0) as wages,
        COALESCE(SUM(ps.federal_tax), 0) as federal_wh,
        COALESCE(SUM(ps.social_security), 0) as ss_ee,
        COALESCE(SUM(ps.medicare), 0) as med_ee,
        COALESCE(SUM(ps.state_tax), 0) as state_wh
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `;

      const period = dbInstance.prepare(aggregateSql).get(companyId, periodStart, periodEnd) as any;
      const ytdRow = dbInstance.prepare(aggregateSql).get(companyId, ytdStart, periodEnd) as any;

      return {
        period: {
          wages: db.roundCents(period.wages),
          federal_wh: db.roundCents(period.federal_wh),
          ss_ee: db.roundCents(period.ss_ee),
          med_ee: db.roundCents(period.med_ee),
          state_wh: db.roundCents(period.state_wh),
        },
        ytd: {
          wages: db.roundCents(ytdRow.wages),
          federal_wh: db.roundCents(ytdRow.federal_wh),
          ss_ee: db.roundCents(ytdRow.ss_ee),
          med_ee: db.roundCents(ytdRow.med_ee),
          state_wh: db.roundCents(ytdRow.state_wh),
        },
        periodStart,
        periodEnd,
      };
    },
  );
  ipcMain.handle(
    'tax:employee-tax-summary',
    (_event, { year, employee_id }: { year: number; employee_id?: string }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return [];
      const dbInstance = db.getDb();

      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      let sql = `
      SELECT
        e.id as employee_id,
        e.name,
        e.w4_filing_status,
        e.w4_step2_checkbox,
        e.w4_step3_dependent_credit,
        COALESCE(SUM(ps.gross_pay), 0) as gross,
        COALESCE(SUM(ps.federal_tax), 0) as federal,
        COALESCE(SUM(ps.social_security), 0) as ss,
        COALESCE(SUM(ps.medicare), 0) as medicare,
        COALESCE(SUM(ps.state_tax), 0) as state,
        COALESCE(SUM(ps.net_pay), 0) as net
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      JOIN employees e ON ps.employee_id = e.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `;
      const params: any[] = [companyId, startDate, endDate];

      if (employee_id) {
        sql += ' AND ps.employee_id = ?';
        params.push(employee_id);
      }

      sql += ' GROUP BY ps.employee_id ORDER BY e.name';

      const rows = dbInstance.prepare(sql).all(...params) as any[];
      return rows.map((r: any) => ({
        employee_id: r.employee_id,
        employee_name: r.name || 'Unknown',
        gross_wages: db.roundCents(r.gross),
        federal_wh: db.roundCents(r.federal),
        ss_tax: db.roundCents(r.ss),
        medicare_tax: db.roundCents(r.medicare),
        state_wh: db.roundCents(r.state),
        total_tax: db.roundCents(
          (r.federal ?? 0) + (r.ss ?? 0) + (r.medicare ?? 0) + (r.state ?? 0),
        ),
        w4_filing_status: r.w4_filing_status || null,
        w4_step2_checkbox: r.w4_step2_checkbox || 0,
        w4_step3_dependent_credit: r.w4_step3_dependent_credit || 0,
      }));
    },
  );
  ipcMain.handle(
    'tax:calc-payroll',
    (_event, { grossPay, payFrequency, w4, utah, ytdGross }: any) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      return calculateFullPayroll(grossPay, payFrequency, w4, utah, ytdGross, companyId, 2026);
    },
  );
  // ─── Employee Document Generation ─────────────────────────
  // Shared, formal signature block for both agreements. Renders an
  // in-place cursive signature + date for each party that has signed
  // (employee and/or employer), or a blank ruled line for wet-ink
  // signing when unsigned. Replaces the old approach of dangling an
  // "ELECTRONIC SIGNATURE" block at the very bottom of the document.
  type SigData = {
    employee?: { name: string; date: string };
    employer?: { name: string; date: string };
    employerTitle?: string;
  };
  function agreementSignatureBlock(
    empName: string,
    companyName: string,
    signatures?: SigData,
  ): string {
    const esc = (s: any) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    const fmt = (d: any) =>
      d
        ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : '';
    // The employer signer's role/title — defaults to "HR Manager" (the
    // person who signs employment & equipment agreements on the company's
    // behalf). Overridable via signatures.employerTitle.
    const employerTitle = (signatures as any)?.employerTitle || 'HR Manager';
    const field = (
      label: 'Employee' | 'Employer',
      party: string,
      sig?: { name: string; date: string },
    ) => {
      const signed = !!(sig && sig.name);
      const roleLine =
        label === 'Employer'
          ? `<p style="font-size:9pt;color:#374151;font-weight:600;margin-top:1px;">${esc(employerTitle)}</p>`
          : '';
      return `<div class="signature-field"${label === 'Employer' ? ' style="margin-left:40px;"' : ''}>
        ${
          signed
            ? `<div style="font-family:'Snell Roundhand','Apple Chancery','Brush Script MT',cursive;font-size:26px;color:#111;border-bottom:1px solid #374151;padding-bottom:6px;min-height:38px;line-height:1.1;">${esc(sig.name)}</div>`
            : `<div class="signature-line">${label} Signature</div>`
        }
        <p style="margin-top:6px;font-size:10pt;color:#374151;font-weight:700;">${esc(party)}</p>
        ${roleLine}
        <p style="font-size:9pt;color:#6b7280;">${label} Signature</p>
        <p style="font-size:10pt;color:#374151;margin-top:2px;">Date: ${signed ? `<strong>${fmt(sig.date)}</strong>` : '_______________'}</p>
        ${signed ? `<p style="font-size:8pt;color:#9ca3af;margin-top:3px;">Electronically signed &amp; recorded &middot; cryptographically bound (SHA-256)</p>` : ''}
      </div>`;
    };
    return `<div class="signature-section">
    <h2>Signatures</h2>
    <p>By signing below, the parties acknowledge and agree to the terms of this Agreement.</p>
    <div class="signature-row">
      ${field('Employee', empName, signatures?.employee)}
      ${field('Employer', companyName, signatures?.employer)}
    </div>
  </div>`;
  }
  // ─── Onboarding / Offboarding Checklist ─────────────────
  // Returns a hybrid checklist: auto-detected steps (computed from real
  // data — equipment, agreements, banking, credentials) + manual
  // check-offs (stored in employee_checklist_items). Auto steps are
  // read-only and always reflect current system state.
  ipcMain.handle(
    'employee:checklist',
    (
      _event,
      { employeeId, phase }: { employeeId: string; phase: 'onboarding' | 'offboarding' },
    ) => {
      try {
        const dbi = db.getDb();
        const companyId = db.getCurrentCompanyId();
        if (!companyId || !employeeId) return { steps: [] };
        const emp = dbi
          .prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
          .get(employeeId, companyId) as any;
        if (!emp) return { steps: [] };

        // Manual check-offs for this employee + phase.
        const manualRows = dbi
          .prepare(
            'SELECT step_key, is_complete, completed_at FROM employee_checklist_items WHERE employee_id = ? AND phase = ?',
          )
          .all(employeeId, phase) as any[];
        const manualMap = new Map(manualRows.map((r) => [r.step_key, r]));
        const isManualDone = (key: string) => !!manualMap.get(key)?.is_complete;

        // Auto-detected data counts.
        const equipCount =
          (
            dbi
              .prepare('SELECT COUNT(*) c FROM employee_equipment WHERE employee_id = ?')
              .get(employeeId) as any
          )?.c || 0;
        const credCount =
          (
            dbi
              .prepare('SELECT COUNT(*) c FROM employee_credentials WHERE employee_id = ?')
              .get(employeeId) as any
          )?.c || 0;
        const hasBanking = !!(emp.bank_name || emp.bank_routing || emp.bank_account);
        const hasW4 = !!emp.w4_filing_status;
        const hasEmergency = !!emp.emergency_contact_name;

        // E-sign status for both agreement types.
        let empAgreementSigned = false,
          equipAgreementSigned = false;
        try {
          const docs = dbi
            .prepare(
              "SELECT description, status FROM esign_documents WHERE company_id = ? AND status = 'signed'",
            )
            .all(companyId) as any[];
          empAgreementSigned = docs.some(
            (d: any) => d.description === `emp:${employeeId}:employee`,
          );
          equipAgreementSigned = docs.some(
            (d: any) => d.description === `emp:${employeeId}:equipment`,
          );
        } catch {
          /* esign tables may not exist */
        }

        // Equipment return status for offboarding.
        let allReturned = true;
        if (phase === 'offboarding' && equipCount > 0) {
          const inUse =
            (
              dbi
                .prepare(
                  "SELECT COUNT(*) c FROM employee_equipment WHERE employee_id = ? AND (disposition IS NULL OR disposition = 'in_use')",
                )
                .get(employeeId) as any
            )?.c || 0;
          allReturned = inUse === 0;
        }

        type Step = {
          key: string;
          label: string;
          description: string;
          auto: boolean;
          done: boolean;
          category: string;
        };
        const steps: Step[] = [];

        if (phase === 'onboarding') {
          steps.push(
            {
              key: 'profile',
              label: 'Employee Profile',
              description: 'Name, contact info, address, job title',
              auto: true,
              done: !!(emp.name && emp.email),
              category: 'Setup',
            },
            {
              key: 'banking',
              label: 'Direct Deposit / Banking',
              description: 'Bank routing + account for payroll',
              auto: true,
              done: hasBanking,
              category: 'Setup',
            },
            {
              key: 'w4',
              label: 'W-4 Tax Withholding',
              description: 'Federal W-4 filing status and allowances',
              auto: true,
              done: hasW4,
              category: 'Setup',
            },
            {
              key: 'emergency',
              label: 'Emergency Contact',
              description: 'Emergency contact name and phone',
              auto: true,
              done: hasEmergency,
              category: 'Setup',
            },
            {
              key: 'equipment',
              label: 'Issue Equipment',
              description: 'Laptops, phones, keys, badges',
              auto: true,
              done: equipCount > 0,
              category: 'Provisioning',
            },
            {
              key: 'credentials',
              label: 'Credentials & Licenses',
              description: 'Record any required licenses or certifications',
              auto: true,
              done: credCount > 0,
              category: 'Provisioning',
            },
            {
              key: 'emp_agreement',
              label: 'Employee Agreement (E-Sign)',
              description: 'Employment contract with terms and compensation',
              auto: true,
              done: empAgreementSigned,
              category: 'Agreements',
            },
            {
              key: 'equip_agreement',
              label: 'Equipment Agreement (E-Sign)',
              description: 'Equipment responsibility and penalty terms',
              auto: true,
              done: equipAgreementSigned,
              category: 'Agreements',
            },
            // Manual steps — no data home, admin checks off when done.
            {
              key: 'orientation',
              label: 'Orientation / Training',
              description: 'Company orientation session completed',
              auto: false,
              done: isManualDone('orientation'),
              category: 'Training',
            },
            {
              key: 'building_access',
              label: 'Building / Facility Access',
              description: 'Keys, badge, alarm codes issued',
              auto: false,
              done: isManualDone('building_access'),
              category: 'Provisioning',
            },
            {
              key: 'it_accounts',
              label: 'IT Accounts Setup',
              description: 'Email, Slack, software logins provisioned',
              auto: false,
              done: isManualDone('it_accounts'),
              category: 'Provisioning',
            },
            {
              key: 'handbook_ack',
              label: 'Employee Handbook Acknowledgment',
              description: 'Employee confirmed receipt of handbook',
              auto: false,
              done: isManualDone('handbook_ack'),
              category: 'Agreements',
            },
            {
              key: 'intro_team',
              label: 'Team Introduction',
              description: 'Introduced to team and supervisor',
              auto: false,
              done: isManualDone('intro_team'),
              category: 'Training',
            },
          );
        } else {
          // Offboarding
          steps.push(
            {
              key: 'equipment_return',
              label: 'All Equipment Returned',
              description: 'Laptops, phones, keys, badges returned or accounted for',
              auto: true,
              done: allReturned,
              category: 'Return',
            },
            {
              key: 'penalties_settled',
              label: 'Equipment Penalties Settled',
              description: 'Outstanding penalties paid or waived',
              auto: true,
              done: (() => {
                try {
                  return (
                    (
                      dbi
                        .prepare(
                          'SELECT COUNT(*) c FROM employee_equipment WHERE employee_id = ? AND penalty_assessed > 0.005 AND COALESCE(penalty_waived,0) = 0',
                        )
                        .get(employeeId) as any
                    )?.c === 0
                  );
                } catch {
                  return true;
                }
              })(),
              category: 'Return',
            },
            {
              key: 'final_paycheck',
              label: 'Final Paycheck Processed',
              description: 'Last payroll run including accrued PTO',
              auto: false,
              done: isManualDone('final_paycheck'),
              category: 'Payroll',
            },
            {
              key: 'benefits_termed',
              label: 'Benefits Terminated',
              description: 'Health, dental, vision, 401k terminated or COBRA offered',
              auto: false,
              done: isManualDone('benefits_termed'),
              category: 'Payroll',
            },
            {
              key: 'it_deprovisioned',
              label: 'IT Accounts Deprovisioned',
              description: 'Email, Slack, software access revoked',
              auto: false,
              done: isManualDone('it_deprovisioned'),
              category: 'Access',
            },
            {
              key: 'building_revoked',
              label: 'Building Access Revoked',
              description: 'Keys, badge, alarm codes collected / deactivated',
              auto: false,
              done: isManualDone('building_revoked'),
              category: 'Access',
            },
            {
              key: 'exit_interview',
              label: 'Exit Interview',
              description: 'Conducted and documented',
              auto: false,
              done: isManualDone('exit_interview'),
              category: 'Admin',
            },
            {
              key: 'cobra_notice',
              label: 'COBRA Notice Sent',
              description: 'COBRA continuation notice mailed within 14 days',
              auto: false,
              done: isManualDone('cobra_notice'),
              category: 'Admin',
            },
          );
        }

        const done = steps.filter((s) => s.done).length;
        return { steps, done, total: steps.length, phase, employee_name: emp.name };
      } catch (err: any) {
        return { error: err?.message || 'Checklist failed' };
      }
    },
  );
  // Toggle a manual checklist step.
  ipcMain.handle(
    'employee:checklist-toggle',
    (
      _event,
      {
        employeeId,
        phase,
        stepKey,
        done,
      }: { employeeId: string; phase: string; stepKey: string; done: boolean },
    ) => {
      try {
        const dbi = db.getDb();
        const existing = dbi
          .prepare(
            'SELECT id FROM employee_checklist_items WHERE employee_id = ? AND phase = ? AND step_key = ?',
          )
          .get(employeeId, phase, stepKey) as any;
        if (existing) {
          dbi
            .prepare(
              'UPDATE employee_checklist_items SET is_complete = ?, completed_at = ? WHERE id = ?',
            )
            .run(done ? 1 : 0, done ? new Date().toISOString() : null, existing.id);
        } else {
          db.create('employee_checklist_items', {
            employee_id: employeeId,
            phase,
            step_key: stepKey,
            is_complete: done ? 1 : 0,
            completed_at: done ? new Date().toISOString() : null,
          });
        }
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle(
    'employee:generate-equipment-agreement',
    (_event, { employeeId, signatures }: { employeeId: string; signatures?: SigData }) => {
      try {
        const dbInstance = db.getDb();
        const companyId = db.getCurrentCompanyId();
        if (!companyId) return { html: '' };

        const employee = dbInstance
          .prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
          .get(employeeId, companyId) as any;
        if (!employee) return { html: '' };

        const company = dbInstance
          .prepare('SELECT * FROM companies WHERE id = ?')
          .get(companyId) as any;
        // ALL equipment ever issued to this employee — current, returned,
        // lost, etc. (the prior `return_date IS NULL` filter hid returned
        // items from the agreement). Future items are included automatically
        // since there's no limit. A Status column distinguishes them.
        const equipment = dbInstance
          .prepare(
            'SELECT * FROM employee_equipment WHERE employee_id = ? ORDER BY assigned_date, item_name',
          )
          .all(employeeId) as any[];

        const esc = (s: any) => {
          if (s == null) return '';
          return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        };
        const fmtDate = (d: any) =>
          d
            ? new Date(d).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            : '—';
        const fmtCurrency = (n: any) =>
          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
            Number(n) || 0,
          );

        const companyName = esc(company?.name || '');
        const companyAddr = company
          ? [
              company.address_line1,
              company.address_line2,
              `${company.city || ''} ${company.state || ''} ${company.zip || ''}`,
            ]
              .filter(Boolean)
              .join(', ')
          : '';

        const empName = esc(employee.name || '');
        const empTitle = esc(employee.job_title || '');
        const empAddr = [
          employee.address_line1,
          employee.address_line2,
          `${employee.city || ''} ${employee.state || ''} ${employee.zip || ''}`,
        ]
          .filter(Boolean)
          .join(', ');
        const empStart = fmtDate(employee.start_date);
        const today = fmtDate(new Date().toISOString());

        // Equipment table rows + per-item penalty terms.
        let equipmentRows = '';
        let penaltySection = '';
        let totalValue = 0;
        const statusMap: Record<string, string> = {
          in_use: 'In Use',
          returned_good: 'Returned',
          returned_damaged: 'Returned (Damaged)',
          lost: 'Lost',
          stolen: 'Stolen',
          not_returned: 'Not Returned',
          retired: 'Retired',
        };
        const statusSeverity: Record<string, 'high' | 'medium' | 'none'> = {
          in_use: 'none',
          returned_good: 'none',
          retired: 'none',
          returned_damaged: 'medium',
          lost: 'medium',
          stolen: 'high',
          not_returned: 'high',
        };
        const dispositionInfo = (
          item: any,
        ): { label: string; date: string; severity: 'high' | 'medium' | 'none' } => {
          const d = item.disposition || (item.return_date ? 'returned_good' : 'in_use');
          const label = statusMap[d] || 'In Use';
          const severity = statusSeverity[d] || 'none';
          const dateVal = item.return_date || item.disposition_date;
          const date = dateVal && d !== 'in_use' ? fmtDate(dateVal) : '—';
          return { label, date, severity };
        };
        if (equipment.length === 0) {
          equipmentRows =
            '<tr><td colspan="9" style="text-align:center;padding:16px;color:#6b7280;">No equipment assigned.</td></tr>';
        } else {
          const penaltyTypeLabel = (t: string, amt: number) => {
            const a = Number(amt) || 0;
            if (t === 'per_day') return `${fmtCurrency(a)} per day`;
            if (t === 'percent_of_value') return `${a}% of item value`;
            return fmtCurrency(a);
          };
          const penaltyBlocks: string[] = [];
          equipment.forEach((item: any, i: number) => {
            const val = Number(item.value) || 0;
            totalValue += val;
            const disp = dispositionInfo(item);
            const statusBg =
              disp.severity === 'high'
                ? '#fef2f2'
                : disp.severity === 'medium'
                  ? '#fffbeb'
                  : 'transparent';
            const statusColor =
              disp.severity === 'high'
                ? '#dc2626'
                : disp.severity === 'medium'
                  ? '#d97706'
                  : '#374151';
            equipmentRows += `<tr>
            <td style="padding:8px;border:1px solid #d1d5db;">${i + 1}</td>
            <td style="padding:8px;border:1px solid #d1d5db;">${esc(item.item_name)}</td>
            <td style="padding:8px;border:1px solid #d1d5db;word-break:break-all;">${esc(item.serial_number || '—')}</td>
            <td style="padding:8px;border:1px solid #d1d5db;">${esc(item.model || '—')}</td>
            <td style="padding:8px;border:1px solid #d1d5db;text-transform:capitalize;">${esc(item.condition || 'good')}</td>
            <td style="padding:8px;border:1px solid #d1d5db;text-align:right;">${val > 0 ? fmtCurrency(val) : '—'}</td>
            <td style="padding:8px;border:1px solid #d1d5db;">${fmtDate(item.assigned_date)}</td>
            <td style="padding:8px;border:1px solid #d1d5db;background:${statusBg};color:${statusColor};font-weight:${disp.severity === 'none' ? '400' : '700'};">${esc(disp.label)}</td>
            <td style="padding:8px;border:1px solid #d1d5db;">${disp.date}</td>
          </tr>`;

            // Penalties defined for this item.
            const pens = dbInstance
              .prepare(
                'SELECT label, penalty_type, amount, notes FROM equipment_penalties WHERE equipment_id = ? ORDER BY sort_order',
              )
              .all(item.id) as any[];
            if (pens.length > 0) {
              const rows = pens
                .map(
                  (p: any) =>
                    `<tr><td style="padding:5px 8px;border:1px solid #d1d5db;">${esc(p.label)}</td>
                   <td style="padding:5px 8px;border:1px solid #d1d5db;text-align:right;font-weight:600;">${penaltyTypeLabel(p.penalty_type, p.amount)}</td>
                   <td style="padding:5px 8px;border:1px solid #d1d5db;color:#6b7280;">${esc(p.notes || '')}</td></tr>`,
                )
                .join('');
              penaltyBlocks.push(
                `<p style="margin-top:14px;font-weight:700;font-size:11pt;">${esc(item.item_name)}${item.serial_number ? ` (SN: ${esc(item.serial_number)})` : ''}</p>
               <table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:10pt;">
                 <thead><tr style="background:#f3f4f6;">
                   <th style="padding:5px 8px;border:1px solid #d1d5db;text-align:left;">Penalty</th>
                   <th style="padding:5px 8px;border:1px solid #d1d5db;text-align:right;">Amount</th>
                   <th style="padding:5px 8px;border:1px solid #d1d5db;text-align:left;">Notes</th>
                 </tr></thead><tbody>${rows}</tbody>
               </table>`,
              );
            }
          });
          if (penaltyBlocks.length > 0) {
            penaltySection = `
            <h2 style="font-size:13pt;margin-top:24px;margin-bottom:6px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">Penalty &amp; Liability Terms</h2>
            <p style="font-size:10pt;color:#374151;margin-bottom:6px;">The Employee acknowledges responsibility for the following penalties in the event of loss, damage, late return, or non-return of the equipment listed above. Percent-of-value penalties are computed against each item's stated replacement value.</p>
            ${penaltyBlocks.join('')}`;
          }
        }

        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Employer Provided Equipment Agreement - ${empName}</title>
<style>
  @page { margin: 0.85in 0.9in; size: Letter; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; }
  /* Fills whatever printable width Chromium actually lays out (set via the
     printToPDF margins in EmployeeForm.tsx, since @page is cosmetic-only
     here) — a fixed px max-width previously left the table pressed against
     the right edge on Letter paper instead of centered with even margins. */
  .container { width: 100%; margin: 0 auto; }
  /* ── Formal letterhead ── */
  .letterhead { text-align: center; padding-bottom: 14px; margin-bottom: 20px; border-bottom: 0.5px solid #ccc; }
  .letterhead .co-name { font-size: 18pt; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #111; margin: 0; padding-bottom: 6px; border-bottom: 1.5px solid #111; display: inline-block; }
  .letterhead .co-addr { font-size: 9pt; color: #555; margin-top: 6px; letter-spacing: 0.3px; }
  /* ── Caption block ── */
  .caption-block { margin-top: 24px; padding: 12px 0; text-align: center; border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; }
  .caption-title { font-size: 12pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
  .caption-parties { font-size: 10pt; color: #444; margin-top: 4px; }
  .caption-date { font-size: 9.5pt; color: #666; margin-top: 2px; }
  /* ── Section headings ── */
  h2 { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 12pt; margin-top: 18px; margin-bottom: 8px; color: #222; border-bottom: 1px solid #ccc; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.8px; }
  /* ── Body + terms ── */
  .letter-body { margin-top: 12px; font-size: 10.5pt; }
  .letter-body p { margin: 8px 0; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
  .equip-table { table-layout: fixed; }
  .equip-table col.c-num { width: 4%; }
  .equip-table col.c-item { width: 16%; }
  .equip-table col.c-serial { width: 13%; }
  .equip-table col.c-model { width: 10%; }
  .equip-table col.c-cond { width: 10%; }
  .equip-table col.c-value { width: 10%; }
  .equip-table col.c-date { width: 12%; }
  .equip-table col.c-status { width: 15%; }
  .equip-table col.c-statusdate { width: 10%; }
  th { background: #f3f4f6; padding: 8px; border: 1px solid #d1d5db; text-align: left; font-weight: 600; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 8px; border: 1px solid #d1d5db; }
  .terms { margin: 16px 0; }
  .terms p { margin: 8px 0; text-align: justify; font-size: 10.5pt; padding-left: 28px; text-indent: -28px; }
  /* ── Signatures ── */
  .signature-section { margin-top: 36px; page-break-inside: avoid; }
  .signature-row { display: flex; justify-content: space-between; margin-top: 24px; }
  .signature-field { flex: 1; }
  .signature-line { border-top: 1px solid #374151; margin-top: 36px; padding-top: 4px; font-size: 10pt; }
  /* ── Footer ── */
  .footer { margin-top: 36px; text-align: center; font-size: 8.5pt; color: #999; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; border-top: 0.5px solid #ccc; padding-top: 8px; }
  /* ── Penalty table ── */
  .penalty-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; table-layout: fixed; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
  .penalty-table th { background: #1f2937; color: #fff; padding: 7px 8px; border: 1px solid #374151; text-align: left; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; }
  .penalty-table td { padding: 7px 8px; border: 1px solid #d1d5db; vertical-align: top; font-size: 8.5pt; line-height: 1.35; word-wrap: break-word; overflow-wrap: anywhere; }
  .penalty-table tr { page-break-inside: avoid; }
  .penalty-high { background: #fef2f2; }
  .penalty-medium { background: #fffbeb; }
  @media print { body { padding: 0; } }
</style></head>
<body>
<div class="container">
  <!-- Formal letterhead -->
  <div class="letterhead">
    <p class="co-name">${companyName}</p>
    ${companyAddr ? `<p class="co-addr">${esc(companyAddr)}</p>` : ''}
  </div>

  <!-- Caption block -->
  <div class="caption-block">
    <p class="caption-title">Employer Provided Equipment Agreement</p>
    <p class="caption-parties">Between ${companyName} and ${empName}</p>
    <p class="caption-date">Effective ${
      signatures?.employee?.date
        ? fmtDate(
            String(signatures.employee.date).length === 10
              ? signatures.employee.date + 'T12:00:00'
              : signatures.employee.date,
          )
        : empStart || today
    }</p>
  </div>

  <!-- Body opening: contract recital -->
  <div class="letter-body">
    <p>This Agreement is made and entered into as of ${empStart || today}, by and between ${companyName} ("Employer") and ${empName}${empTitle ? `, ${empTitle}` : ''}${empAddr ? `, of ${esc(empAddr)}` : ''} ("Employee"), regarding the issuance, use, care, and return of company-owned equipment (this "Agreement"). The parties agree as follows:</p>
  </div>

  <h2>Equipment Issued</h2>
  <p>The Employer has issued the following equipment to the Employee for business use. The Employee acknowledges receipt of the items listed below and agrees to the terms set forth in this Agreement.</p>
  <table class="equip-table">
    <colgroup>
      <col class="c-num" /><col class="c-item" /><col class="c-serial" /><col class="c-model" />
      <col class="c-cond" /><col class="c-value" /><col class="c-date" /><col class="c-status" /><col class="c-statusdate" />
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th>Item</th>
        <th>Serial #</th>
        <th>Model</th>
        <th>Condition</th>
        <th style="text-align:right;">Value</th>
        <th>Date Issued</th>
        <th>Status</th>
        <th>Status Date</th>
      </tr>
    </thead>
    <tbody>
      ${equipmentRows}
      ${totalValue > 0 ? `<tr><td colspan="5" style="padding:8px;border:1px solid #d1d5db;text-align:right;font-weight:700;">Total Equipment Value</td><td style="padding:8px;border:1px solid #d1d5db;text-align:right;font-weight:700;">${fmtCurrency(totalValue)}</td><td colspan="3" style="border:1px solid #d1d5db;"></td></tr>` : ''}
    </tbody>
  </table>

  ${penaltySection}

  <h2>Terms &amp; Conditions</h2>
  <p style="font-size:10pt;color:#6b7280;margin-bottom:12px;">The Employee acknowledges and expressly agrees to the following terms and conditions governing the use of Employer-issued equipment. Any violation of these terms may result in disciplinary action, up to and including termination of employment and legal action.</p>
  <div class="terms">
    <p><strong>1. Ownership &amp; Property Rights.</strong> All equipment provided under this Agreement, including but not limited to computers, monitors, peripherals, telephones, mobile devices, software licenses, and accessories (collectively, "Equipment"), remains the sole and exclusive property of the Employer. The Employee acquires no ownership interest, equitable title, or leasehold rights in any Equipment. The Employee shall not sell, transfer, pledge, encumber, dispose of, or otherwise grant any interest in the Equipment to any third party. The Employee shall not remove or deface any identification labels, asset tags, or property markings affixed to any Equipment.</p>

    <p><strong>2. Care, Maintenance &amp; Prohibited Modifications.</strong> The Employee shall exercise the highest degree of care in the handling, operation, and storage of all Equipment. The Employee shall (a) maintain the Equipment in good working order and promptly report any malfunction, defect, or degradation in performance; (b) keep the Equipment in a clean, safe, and secure environment when not in use; (c) protect the Equipment from extreme temperatures, moisture, dust, physical shock, and electrical surges; (d) use only manufacturer-approved chargers, cables, and accessories. The Employee is strictly prohibited from: (i) repairing, disassembling, modifying, or attempting to service any Equipment; (ii) installing, removing, or replacing any hardware components, including memory, storage drives, batteries, or network cards; (iii) altering the operating system, firmware, BIOS/UEFI settings, or security configurations; (iv) jailbreaking, rooting, or otherwise circumventing built-in security protections; (v) relabeling or cosmetically altering the Equipment in any manner. All repairs and maintenance must be performed exclusively by the Employer's authorized IT personnel or designated service providers.</p>

    <p><strong>3. Authorized Use &amp; Restrictions.</strong> Equipment shall be used exclusively for legitimate business purposes on behalf of the Employer. Limited personal use is permitted only if it (a) does not interfere with the Employee's job duties or productivity; (b) does not violate any applicable law, regulation, or Employer policy; (c) does not involve the storage, transmission, or access of illegal, obscene, harassing, discriminatory, or otherwise inappropriate material; (d) does not result in additional costs to the Employer, including but not limited to data overage charges, licensing fees, or repair expenses; (e) does not compromise the security, integrity, or confidentiality of Employer data or systems; and (f) does not diminish the useful life or residual value of the Equipment. The Employee shall not use the Equipment for any competitive activity, side business, freelance work, or any purpose that conflicts with the Employer's interests. Software installation is strictly prohibited without prior written authorization from the Employer's IT department. The Employee shall not access, download, or stream content that consumes excessive bandwidth or violates copyright laws.</p>

    <p><strong>4. Return Obligations &amp; Timeline.</strong> Upon termination of employment for any reason, whether voluntary or involuntary, with or without cause, or immediately upon demand by the Employer, the Employee shall return ALL Equipment within twenty-four (24) hours. The return shall include: (a) the Equipment itself and all component parts; (b) all power adapters, cables, docking stations, cases, and peripherals originally issued; (c) all software license keys, installation media, and documentation; (d) any Employer data, files, or records stored on the Equipment, which must first be transferred to the Employer as directed. The Equipment must be returned in person to the Employer's designated representative during regular business hours. The Employee shall receive a written receipt acknowledging the return. If the Employee fails to return Equipment within the required timeframe, the Employer reserves the right to: (i) assess a Non-Return Penalty as specified in the Monetary Penalty Schedule below; (ii) deduct the full replacement value of unreturned Equipment from the Employee's final paycheck to the fullest extent permitted by applicable law; (iii) report the Equipment as stolen property to law enforcement authorities; and (iv) pursue all available civil and criminal remedies.</p>

    <p><strong>5. Monetary Penalty Schedule.</strong> The Employee acknowledges and expressly agrees to the following specific monetary penalties for violations of this Agreement. These penalties are in addition to, and not in lieu of, the Employee's obligation to pay the full replacement cost of Equipment under Section 6 below. Each penalty amount is assessed per item of Equipment involved and per occurrence. All penalties shall be deducted directly from the Employee's wages, salary, commissions, bonuses, or any other compensation payable to the Employee, without further notice or consent, to the fullest extent permitted by applicable law.</p>
    <table class="penalty-table">
      <colgroup>
        <col style="width:7%;" />
        <col style="width:19%;" />
        <col style="width:46%;" />
        <col style="width:28%;" />
      </colgroup>
      <thead>
        <tr>
          <th>Tier</th>
          <th>Violation / Occurrence</th>
          <th>Definition</th>
          <th>Penalty Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Theft or Conversion</strong></td>
          <td>Knowingly taking, selling, pawning, or permanently depriving the Employer of Equipment with intent to deprive; fraudulent misrepresentation of loss; destruction of Equipment to conceal prior violation</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$500.00 per item + full replacement cost + referral for criminal prosecution</strong></td>
        </tr>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Non-Return of Equipment</strong></td>
          <td>Failure to return all Equipment within the 24-hour return period under Section 4, or returning Equipment in a deliberately damaged or inoperable state</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$250.00 per item + $50.00 per additional day beyond the return deadline + full replacement cost for any item not returned</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Loss of Equipment</strong></td>
          <td>Equipment lost due to negligence, including but not limited to leaving Equipment unattended in public places, in unlocked vehicles, or in locations accessible to unauthorized persons; loss while traveling without appropriate security measures</td>
          <td style="font-weight:700;color:#d97706;"><strong>Replacement cost × 1.5 (150% of replacement value) or $250.00 minimum, whichever is greater</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Willful or Negligent Damage</strong></td>
          <td>Damage caused by gross negligence, reckless behavior, unauthorized modifications, failure to exercise required degree of care, or intentional destruction. Includes liquid damage, crushing, dropping from height, and electrical damage from unauthorized chargers</td>
          <td style="font-weight:700;color:#d97706;"><strong>$150.00 + full cost of repair; or $250.00 + full replacement cost if damaged beyond economical repair</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Repair Fee</strong></td>
          <td>Any repair, service, or restoration performed on Equipment necessitated by the Employee's use, whether due to wear beyond normal expectations, accidental damage not covered above, software or firmware restoration, screen or battery replacement, port repair, or any other servicing required to return the Equipment to good working order</td>
          <td style="font-weight:700;color:#d97706;"><strong>Full cost of all parts, labor, and shipping for each repair event + $50.00 administrative processing fee per repair</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Loss of Use Fee</strong></td>
          <td>Period during which Equipment is unavailable, inoperable, or out of service due to loss, theft, damage, repair, unauthorized modification, or any other occurrence attributable to the Employee's acts or omissions. Assessed from the date of the incident until the date the Equipment is returned, replaced, or restored to full working order. This fee compensates the Employer for lost productivity, temporary replacement costs, and administrative overhead</td>
          <td style="font-weight:700;color:#d97706;"><strong>$25.00 per calendar day per item of Equipment, beginning on the date of the incident and continuing until the item is returned, replaced, or fully repaired. No maximum cap. Assessed concurrently with all other applicable penalties and replacement costs. This fee is in addition to, and not in lieu of, any Repair Fee, replacement cost, or other penalty</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Misuse of Equipment</strong></td>
          <td>Use of Equipment for unauthorized purposes including but not limited to: illegal activities, side business operations, cryptocurrency mining, unauthorized commercial use, operation of servers or network services, excessive bandwidth consumption, or use that violates any Employer policy</td>
          <td style="font-weight:700;color:#d97706;"><strong>$100.00 per occurrence + cost of any resulting data recovery, forensic examination, or remediation</strong></td>
        </tr>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Data Breach or Security Incident</strong></td>
          <td>Loss, exposure, or compromise of Employer confidential data due to the Employee's failure to maintain security measures, including but not limited to: failure to encrypt, sharing of passwords, installation of unauthorized software, disabling of security features, or failure to report a known security vulnerability</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$1,000.00 + all costs associated with breach notification, forensic investigation, credit monitoring, legal fees, regulatory fines, and any third-party claims</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Unauthorized Modifications</strong></td>
          <td>Repairing, disassembling, modifying, jailbreaking, rooting, or attempting to service Equipment; altering operating system, firmware, or security configurations; installing unauthorized hardware or software; removing or defacing asset tags</td>
          <td style="font-weight:700;color:#d97706;"><strong>$100.00 + full cost to restore Equipment to factory authorized configuration + cost of any replacement components needed</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Late or Non-Reporting of Incident</strong></td>
          <td>Failure to report loss, theft, damage, or security incident within the timeframes specified in this Agreement (2 hours for loss/theft, 1 hour for damage or security incidents)</td>
          <td style="font-weight:700;color:#d97706;"><strong>$75.00 per day, per unreported incident, not to exceed $500.00 per incident</strong></td>
        </tr>
        <tr style="background:#fafaf9;">
          <td style="text-align:center;font-weight:700;color:#6b7280;">L</td>
          <td><strong>Administrative Processing Fee</strong></td>
          <td>Cost of processing, inspecting, testing, documenting, and administering the return, replacement, or repair of any Equipment item, assessed on each occurrence</td>
          <td style="font-weight:700;color:#6b7280;"><strong>$25.00 per item per occurrence</strong></td>
        </tr>
        <tr style="background:#fafaf9;">
          <td style="text-align:center;font-weight:700;color:#6b7280;">L</td>
          <td><strong>Data Recovery Fee</strong></td>
          <td>If Equipment is returned, damaged, or inoperable and contains Employer data that must be recovered, transferred, or forensically imaged</td>
          <td style="font-weight:700;color:#6b7280;"><strong>$150.00 flat fee + $75.00 per hour of IT labor for data recovery efforts</strong></td>
        </tr>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Software Misconduct &amp; License Violation</strong></td>
          <td>Installing pirated, cracked, unlicensed, or unauthorized software; copying or distributing Employer-licensed software in violation of its license; circumventing software activation or digital-rights management; introducing malware, ransomware, keyloggers, or unauthorized remote-access tools; disabling, uninstalling, or tampering with antivirus, encryption, monitoring, or endpoint-protection software; or using the Equipment to pirate, torrent, or unlawfully distribute copyrighted material</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$250.00 per occurrence + full cost of re-licensing, remediation, malware removal, and re-imaging + any third-party license-infringement claims, statutory damages, or regulatory fines assessed against the Employer</strong></td>
        </tr>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Tampering with Security, Monitoring, or Asset Controls</strong></td>
          <td>Disabling, removing, obstructing, or defeating any GPS, telematics, mobile-device-management (MDM), remote-wipe, location, camera, or monitoring capability; removing, altering, or defacing asset tags, serial numbers, or ownership markings; spoofing device identity; or otherwise interfering with the Employer's ability to locate, monitor, secure, or recover the Equipment</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$300.00 per occurrence + full cost to restore controls + immediate forfeiture of any prorated separation-chargeback reduction (full replacement cost becomes due)</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Early-Separation Equipment Chargeback</strong></td>
          <td>Applied when employment ends (by resignation, termination, or otherwise) and Equipment is not returned in good working condition, OR when the Employer elects to charge for the depreciated value of Equipment retained, lost, or damaged at separation. The chargeback is a percentage of each item's replacement value, graduated by the time elapsed since the item was issued to the Employee</td>
          <td style="font-weight:700;color:#d97706;"><strong>100% of replacement value if separation occurs within 90 days of issuance; 75% within 91&ndash;180 days; 50% within 181&ndash;365 days; 25% within 366&ndash;730 days; 0% after 730 days &mdash; PROVIDED the item is returned undamaged. Damaged, lost, stolen, or unreturned items are charged at 100% of replacement value regardless of tenure, plus all other applicable penalties</strong></td>
        </tr>
      </tbody>
    </table>
    <p style="font-size:10pt;color:#6b7280;"><strong>Penalty Tiers:</strong> H = High Severity &mdash; may also result in immediate termination, civil litigation, and/or criminal referral. M = Medium Severity &mdash; subject to escalating disciplinary action. L = Low Severity &mdash; administrative fees applied automatically. The Employer reserves the right to assess penalties at its sole discretion based on the circumstances of each violation. All penalties are cumulative and may be applied concurrently for multiple violations. The Employer may waive or reduce any penalty in writing at its sole discretion, but no such waiver shall create a precedent or obligation to waive future penalties.</p>

    <p><strong>6. Full Replacement Cost Liability &amp; Payroll Deduction Authorization.</strong> In addition to any penalties assessed under the Monetary Penalty Schedule above, the Employee acknowledges and expressly agrees that they shall be held financially responsible for the full replacement cost of any Equipment that is lost, stolen, damaged beyond reasonable repair, destroyed, or not returned as required. "Full replacement cost" means the actual retail cost to purchase an equivalent new item of Equipment at the time of replacement, including all applicable taxes, shipping, and setup costs. The Employee authorizes the Employer to deduct the full replacement cost, together with any applicable penalties, directly from the Employee's wages, salary, commissions, bonuses, or any other compensation payable to the Employee, without further notice or consent, to the fullest extent permitted by applicable law. Additionally, the Employee understands and agrees that the Employer may require full or partial payment up front before the Employee is issued replacement or upgraded Equipment. This deduction authorization is separate and independent from any other claims or remedies the Employer may have.</p>

    <p><strong>7. Data Security, Confidentiality &amp; Privacy.</strong> The Employee acknowledges that all data, information, communications, and materials stored on, transmitted through, or accessed via the Equipment are the sole property of the Employer and may contain confidential, proprietary, and trade secret information. The Employee shall: (a) maintain the confidentiality of all Employer data in accordance with the Employer's data security and confidentiality policies; (b) use only Employer-approved encryption, VPN, and remote access solutions when accessing Employer systems or data; (c) enable and maintain all security features on the Equipment, including full-disk encryption, screen locks, antivirus software, and automatic security updates as directed by the Employer; (d) report any suspected security breach, unauthorized access, malware infection, or data loss within one (1) hour of discovery; (e) not store Employer data on any personal devices, cloud services, or unapproved storage media; (f) not share passwords, authentication tokens, or access credentials with any person for any reason; (g) allow the Employer to remotely wipe, lock, or disable the Equipment in the event of loss, theft, or termination of employment. The Employee has no expectation of privacy regarding any data stored on or transmitted through the Equipment. The Employer reserves the right to monitor, access, inspect, copy, delete, or preserve any data on the Equipment at any time, with or without notice, for any lawful purpose. Any violation of this Section 7 shall subject the Employee to the Data Breach penalties set forth in the Monetary Penalty Schedule (Section 5).</p>

    <p><strong>8. Inspection, Monitoring &amp; Auditing.</strong> The Employer, through its authorized representatives, retains the unrestricted right to inspect, audit, and monitor the Equipment and its contents at any time, with or without prior notice, and with or without the Employee's presence or consent. Inspections may include, but are not limited to: (a) physical examination of the Equipment for damage, unauthorized modifications, or wear; (b) review of installed software, applications, and configurations; (c) forensic analysis of data, files, browsing history, communications, and system logs; (d) remote access and diagnostic scanning; and (e) inventory verification against asset records. The Employee shall cooperate fully with any inspection or audit, including providing passwords and access credentials upon request (which may be changed immediately following the inspection). Refusal to cooperate with an inspection or audit constitutes a material breach of this Agreement and grounds for immediate disciplinary action, including termination, and shall subject the Employee to a penalty of $100.00 per instance under the Monetary Penalty Schedule.</p>

    <p><strong>9. Loss, Theft &amp; Damage Reporting.</strong> The Employee shall immediately report any loss, theft, damage, or suspected compromise of Equipment. Reporting requirements are as follows: (a) in the event of loss or theft, the Employee must notify both the Employer and local law enforcement within two (2) hours of discovery, and provide the Employer with the police report case number and investigating officer's contact information within 24 hours; (b) in the event of accidental damage, spill, or drop, the Employee must report the incident within one (1) hour, regardless of whether the Equipment appears functional; (c) in the event of suspected malware, virus, or unauthorized access, the Employee must immediately disconnect the Equipment from all networks and report the incident within one (1) hour. Failure to timely report any such incident shall subject the Employee to the Late or Non-Reporting penalties set forth in the Monetary Penalty Schedule (Section 5), in addition to any penalties for the underlying loss, theft, damage, or security incident.</p>

    <p><strong>10. Compliance with Policies &amp; Acceptable Use.</strong> The Employee shall at all times comply with all Employer policies, procedures, handbooks, codes of conduct, and directives, as they may be amended from time to time in the Employer's sole discretion, including without limitation: (a) the Employer's Information Technology Acceptable Use Policy; (b) the Employer's Data Security and Privacy Policy; (c) the Employer's Code of Business Conduct and Ethics; (d) the Employer's Records Retention and Disposal Policy; (e) all applicable industry regulations and legal requirements. The Employee acknowledges that they have received, read, and understand all applicable policies, or have been given the opportunity to request copies. The Employee shall not use the Equipment to violate any federal, state, or local law, regulation, or ordinance. Any violation of this Section 10 shall subject the Employee to the Misuse penalties set forth in the Monetary Penalty Schedule (Section 5).</p>

    <p><strong>11. Insurance &amp; Indemnification.</strong> The Employee acknowledges that the Equipment is not insured under any personal insurance policy held by the Employee for loss, theft, or damage. The Employee shall maintain, at their own expense, appropriate renters or homeowners insurance that covers the full replacement value of the Equipment, or shall waive any claim against their personal insurance if not so maintained. To the fullest extent permitted by law, the Employee agrees to indemnify, defend, and hold harmless the Employer, its officers, directors, employees, and agents from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to: (a) the Employee's use, misuse, or unauthorized use of the Equipment; (b) the Employee's breach of any term of this Agreement; (c) any loss, theft, or damage to the Equipment caused by the Employee's negligence, willful misconduct, or violation of law; (d) any data breach, data loss, or security incident caused or contributed to by the Employee's acts or omissions. The Employee's indemnification obligations are cumulative and in addition to any penalties assessed under the Monetary Penalty Schedule (Section 5).</p>

    <p><strong>12. Termination &amp; Survival.</strong> This Agreement shall commence on the date first set forth above and shall continue until terminated by either party. This Agreement shall automatically terminate upon the termination of the Employee's employment for any reason. Obligations under Sections 4 (Return of Equipment), 5 (Monetary Penalty Schedule), 6 (Full Replacement Cost Liability), 7 (Data Security), 9 (Loss Reporting), and 11 (Indemnification) shall survive the termination of this Agreement and the termination of employment. The Employee's obligations under this Agreement are in addition to, and not in lieu of, any obligations set forth in any separate employment agreement, confidentiality agreement, invention assignment agreement, or restrictive covenant agreement between the Employee and the Employer.</p>

    <p><strong>13. Separation Chargeback Upon Resignation or Termination.</strong> The Employee acknowledges and expressly agrees that, upon the termination of their employment for any reason &mdash; whether by voluntary resignation, involuntary termination with or without cause, layoff, abandonment, retirement, or death &mdash; any Employer Equipment in the Employee's possession, custody, or control must be returned in good working condition in accordance with Section 4. To the extent any item of Equipment is not so returned, or is returned lost, stolen, damaged, defaced, or in a non-functional or materially diminished condition, the Employer is hereby authorized to assess an <em>Early-Separation Equipment Chargeback</em> against the Employee, calculated as a percentage of each affected item's full replacement value according to the following graduated schedule, measured from the date the item was issued to the Employee to the Employee's last day of employment: <strong>(a)</strong> one hundred percent (100%) of replacement value if separation occurs within ninety (90) days of issuance; <strong>(b)</strong> seventy-five percent (75%) if within ninety-one (91) to one hundred eighty (180) days; <strong>(c)</strong> fifty percent (50%) if within one hundred eighty-one (181) to three hundred sixty-five (365) days; <strong>(d)</strong> twenty-five percent (25%) if within three hundred sixty-six (366) to seven hundred thirty (730) days; and <strong>(e)</strong> zero percent (0%) thereafter &mdash; <em>provided in each case that the item is returned undamaged and fully functional.</em> Any item that is lost, stolen, willfully or negligently damaged, tampered with, or not returned shall be charged at one hundred percent (100%) of its replacement value regardless of tenure, in addition to all other applicable penalties under the Monetary Penalty Schedule (Section 5). The graduated reduction reflects the depreciation of Equipment over its useful service life and is intended as a reasonable, agreed pre-estimate of the Employer's loss, not a penalty. The Employee authorizes the Employer to deduct the full amount of any Separation Chargeback, together with any other penalties and replacement costs owed, from the Employee's final wages, salary, commissions, accrued but unused leave (where permitted), bonuses, or any other compensation payable upon separation, to the fullest extent permitted by applicable law; any balance not so recovered shall be due and payable as a debt within thirty (30) days of demand and may be referred to collections or reported as set forth in this Agreement.</p>

    <p><strong>14. Software Misconduct, Tampering &amp; License Compliance.</strong> The Employee shall use only software that is properly licensed to the Employer and installed or authorized by the Employer's IT department. The Employee is strictly prohibited from, and shall be liable for, any of the following: <strong>(a)</strong> installing pirated, cracked, counterfeit, "abandonware," or otherwise unlicensed software, or copying, redistributing, or exceeding the seat or device limits of any Employer-licensed software; <strong>(b)</strong> downloading, torrenting, streaming, or distributing copyrighted music, film, software, or other material in violation of law or license; <strong>(c)</strong> introducing, whether intentionally or through negligence, any virus, malware, ransomware, spyware, keylogger, cryptominer, or unauthorized remote-access or backdoor tool; <strong>(d)</strong> disabling, uninstalling, bypassing, or tampering with any antivirus, endpoint-protection, encryption, firewall, content-filtering, logging, mobile-device-management (MDM), GPS, telematics, remote-wipe, or other security or monitoring software or hardware installed or required by the Employer; <strong>(e)</strong> altering, spoofing, or obscuring the Equipment's identity, serial number, MAC address, or asset tag; or <strong>(f)</strong> circumventing software activation, license servers, or digital-rights-management controls. The Employee acknowledges that such conduct exposes the Employer to security breaches, license-infringement claims, statutory copyright damages, regulatory penalties, and reputational harm. Any violation of this Section shall subject the Employee to the Software Misconduct &amp; License Violation and Tampering penalties set forth in the Monetary Penalty Schedule (Section 5), shall make the Employee liable for all resulting re-licensing, remediation, forensic, and legal costs and any third-party claims, and may constitute grounds for immediate termination and referral to law enforcement. Tampering with the Employer's security or monitoring controls additionally forfeits any prorated reduction under the Separation Chargeback (Section 13), causing the full replacement value to become immediately due.</p>

    <p><strong>15. Wage-Law Compliance, Severability &amp; Governing Law.</strong> All payroll deductions, penalties, chargebacks, and recoveries authorized under this Agreement (including Sections 5, 6, and 13) shall be administered in compliance with the federal Fair Labor Standards Act and the Utah Payment of Wages Act, Utah Code Ann. &sect;&sect; 34-28-1 et seq.: <strong>(a)</strong> no deduction shall reduce the Employee's pay below the applicable federal or Utah minimum wage for any workweek or be taken from overtime pay in violation of law; <strong>(b)</strong> deductions other than those permitted by law are made pursuant to the Employee's written authorization in this Agreement, as required by Utah Code Ann. &sect; 34-28-3; and <strong>(c)</strong> any amount that cannot lawfully be deducted shall instead be recoverable as a civil debt, with the Employer entitled to its costs of collection and reasonable attorneys' fees and interest at the maximum lawful rate. Nothing in this Agreement waives any right the Employee cannot lawfully waive, including the right to report violations to or cooperate with any government agency and the immunity under the Defend Trade Secrets Act, 18 U.S.C. &sect; 1833(b). This Agreement is governed by the laws of the State of Utah and applicable federal law; the parties consent to exclusive venue in the courts of the county of the Employer's principal place of business in Utah and, to the fullest extent permitted by law, waive trial by jury. The penalty and chargeback amounts herein are agreed reasonable pre-estimates of the Employer's loss (liquidated damages), not punitive penalties. If any provision is held invalid or unenforceable, it shall be reformed to the maximum extent lawful or severed, and the remainder shall continue in full force and effect.</p>

    <p><strong>16. Acknowledgment of Receipt &amp; Condition.</strong> BY SIGNING BELOW, THE EMPLOYEE ACKNOWLEDGES THAT THEY HAVE RECEIVED THE EQUIPMENT LISTED IN THE SCHEDULE ABOVE AND CONFIRMS THAT SUCH EQUIPMENT IS IN THE CONDITION INDICATED. THE EMPLOYEE FURTHER ACKNOWLEDGES THAT THEY HAVE PERSONALLY INSPECTED EACH ITEM AND VERIFIED ITS FUNCTIONALITY, INCLUDING BUT NOT LIMITED TO: POWER-ON OPERATION, SCREEN INTEGRITY, KEYBOARD/INPUT FUNCTIONALITY, PORT FUNCTIONALITY, AND BATTERY CONDITION. ANY DISCREPANCIES OR DEFECTS MUST BE REPORTED IN WRITING WITHIN THREE (3) BUSINESS DAYS OF RECEIPT; FAILURE TO DO SO CONSTITUTES THE EMPLOYEE'S UNQUALIFIED ACCEPTANCE OF THE EQUIPMENT IN THE CONDITION DESCRIBED. THE EMPLOYEE FURTHER ACKNOWLEDGES HAVING READ AND UNDERSTOOD THE MONETARY PENALTY SCHEDULE IN SECTION 5, THE SEPARATION CHARGEBACK IN SECTION 13, THE SOFTWARE MISCONDUCT TERMS IN SECTION 14, AND THE WAGE-LAW AND GOVERNING-LAW TERMS IN SECTION 15, AND AGREES TO ALL PENALTIES AND CHARGEBACKS DESCRIBED THEREIN.</p>

    <p><strong>17. Governing Law &amp; Jurisdiction.</strong> This Agreement shall be governed by and construed in accordance with the laws of ${esc(employee.state || "the state in which the Employer's principal place of business is located")}, without regard to its conflict of laws principles. The parties hereby submit to the exclusive personal jurisdiction and venue of the state and federal courts located in that state for any dispute arising out of or relating to this Agreement, and the Employee waives any objection to such jurisdiction or venue based on forum non conveniens or lack of personal jurisdiction. The Employee specifically consents to the jurisdiction of small claims court for recovery of any unpaid penalties or replacement costs not to exceed that court's jurisdictional limit.</p>

    <p><strong>18. Entire Agreement &amp; Amendments.</strong> This Agreement, together with the Equipment Schedule above and any referenced Employer policies, constitutes the entire agreement between the parties with respect to the subject matter hereof and supersedes all prior or contemporaneous understandings, agreements, representations, and communications, whether written or oral. This Agreement may not be amended, modified, or supplemented except by a written instrument signed by both parties. The Employee acknowledges that no representation or promise not expressly set forth in this Agreement has been made by the Employer.</p>

    <p><strong>19. Severability &amp; Waiver.</strong> If any provision of this Agreement is held to be invalid, illegal, or unenforceable by a court of competent jurisdiction, such provision shall be enforced to the maximum extent permitted by law, and the remaining provisions shall continue in full force and effect. The failure of either party to enforce any provision of this Agreement shall not be construed as a waiver of such provision or the right to enforce it in the future. No waiver shall be effective unless made in writing and signed by the party against whom enforcement is sought. Any waiver of a penalty under Section 5 shall not constitute a waiver of any future penalty or of the Employer's right to enforce the penalty schedule.</p>

    <p><strong>20. Acknowledgment of Penalties.</strong> THE EMPLOYEE ACKNOWLEDGES THAT THEY HAVE READ THE MONETARY PENALTY SCHEDULE IN SECTION 5 OF THIS AGREEMENT AND UNDERSTAND THE SPECIFIC PENALTY AMOUNTS THAT MAY BE ASSESSED FOR VIOLATIONS. THE EMPLOYEE AGREES THAT THE PENALTIES SET FORTH THEREIN ARE REASONABLE AND PROPORTIONATE TO THE POTENTIAL HARM CAUSED BY EACH TYPE OF VIOLATION. THE EMPLOYEE FURTHER AGREES THAT THE EMPLOYER MAY DEDUCT ANY UNPAID PENALTIES AND REPLACEMENT COSTS FROM THE EMPLOYEE'S FINAL COMPENSATION AND MAY REPORT ANY UNPAID OBLIGATIONS TO CREDIT BUREAUS OR COLLECTION AGENCIES.</p>
  </div>

  <h2>Equipment Schedule &mdash; Detailed Itemization</h2>
  <p>The following equipment has been issued to the Employee. The Employee acknowledges receipt and confirms the condition of each item as indicated at the time of issuance.</p>
  <table class="equip-table">
    <colgroup>
      <col class="c-num" /><col class="c-item" /><col class="c-serial" /><col class="c-model" />
      <col class="c-cond" /><col class="c-value" /><col class="c-date" /><col class="c-status" /><col class="c-statusdate" />
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th>Item Description</th>
        <th>Serial Number</th>
        <th>Model / SKU</th>
        <th>Condition at Issuance</th>
        <th style="text-align:right;">Value</th>
        <th>Date Issued</th>
        <th>Status</th>
        <th>Status Date</th>
      </tr>
    </thead>
    <tbody>
      ${equipmentRows}
    </tbody>
  </table>

  <p style="font-size:10pt;color:#6b7280;margin-top:8px;"><em>Note: Any items not listed above that were previously issued must be disclosed to the Employer immediately. Failure to disclose previously issued equipment may result in additional liability.</em></p>

  ${agreementSignatureBlock(empName, companyName, signatures)}

  <div class="footer">
    <p>${companyName} &mdash; Employer Provided Equipment Agreement</p>
    <p>${
      signatures?.employee?.date
        ? `Signed by ${empName} on ${fmtDate(String(signatures.employee.date).length === 10 ? signatures.employee.date + 'T12:00:00' : signatures.employee.date)}`
        : `Generated on ${today}`
    }</p>
  </div>
</div>
</body>
</html>`;

        return { html };
      } catch (err: any) {
        console.error('Failed to generate equipment agreement:', err);
        return { html: '' };
      }
    },
  );
  ipcMain.handle(
    'employee:generate-employee-agreement',
    (_event, { employeeId, signatures }: { employeeId: string; signatures?: SigData }) => {
      try {
        const dbInstance = db.getDb();
        const companyId = db.getCurrentCompanyId();
        if (!companyId) return { html: '' };

        const employee = dbInstance
          .prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
          .get(employeeId, companyId) as any;
        if (!employee) return { html: '' };

        const company = dbInstance
          .prepare('SELECT * FROM companies WHERE id = ?')
          .get(companyId) as any;

        const esc = (s: any) => {
          if (s == null) return '';
          return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        };
        const fmtDate = (d: any) =>
          d
            ? new Date(d).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            : '—';
        const fmtCurrency = (n: any) =>
          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
            Number(n) || 0,
          );
        // Humanize a stored enum/slug value for display: turn snake_case /
        // kebab-case tokens into Title Case ("on_site" → "On Site",
        // "operations" → "Operations"). Preserves intentional user casing —
        // a word that ISN'T all-lowercase (e.g. "iPhone", "PTO", "McAfee")
        // is left untouched, so we never clobber how the user actually typed
        // it. Only all-lowercase tokens get their first letter capitalized.
        const humanize = (s: any): string =>
          String(s ?? '')
            .replace(/[_-]+/g, ' ')
            .split(' ')
            .map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
            .join(' ')
            .trim();

        const companyName = esc(company?.name || '');
        const companyAddr = company
          ? [
              company.address_line1,
              company.address_line2,
              `${company.city || ''} ${company.state || ''} ${company.zip || ''}`,
            ]
              .filter(Boolean)
              .join(', ')
          : '';

        const empName = esc(employee.name || '');
        const empTitle = esc(humanize(employee.job_title || ''));
        const empAddr = [
          employee.address_line1,
          employee.address_line2,
          `${employee.city || ''} ${employee.state || ''} ${employee.zip || ''}`,
        ]
          .filter(Boolean)
          .join(', ');
        const empStart = fmtDate(employee.start_date);
        const empEmail = esc(employee.email || '');
        const empPhone = esc(employee.phone || '');
        const empType = employee.type === 'employee' ? 'Employee' : 'Contractor';
        const payType = employee.pay_type === 'salary' ? 'Salary' : 'Hourly';
        const payLabel = employee.pay_type === 'salary' ? 'Annual Salary' : 'Hourly Rate';
        const empPay = fmtCurrency(employee.pay_rate);
        const empSchedule = humanize(employee.pay_schedule || '');
        const empDept = esc(humanize(employee.department || ''));
        const empLoc = esc(humanize(employee.work_location || ''));
        const today = fmtDate(new Date().toISOString());

        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Employee Agreement - ${empName}</title>
<style>
  @page { margin: 0.85in 0.9in; size: Letter; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; }
  /* Fills whatever printable width Chromium actually lays out (set via the
     printToPDF margins in EmployeeForm.tsx, since @page is cosmetic-only
     here) — a fixed px max-width previously left the table pressed against
     the right edge on Letter paper instead of centered with even margins. */
  .container { width: 100%; margin: 0 auto; }
  .letterhead { text-align: center; padding-bottom: 14px; margin-bottom: 20px; border-bottom: 0.5px solid #ccc; }
  .letterhead .co-name { font-size: 18pt; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #111; margin: 0; padding-bottom: 6px; border-bottom: 1.5px solid #111; display: inline-block; }
  .letterhead .co-addr { font-size: 9pt; color: #555; margin-top: 6px; letter-spacing: 0.3px; }
  .caption-block { margin-top: 24px; padding: 12px 0; text-align: center; border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; }
  .caption-title { font-size: 12pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
  .caption-parties { font-size: 10pt; color: #444; margin-top: 4px; }
  .caption-date { font-size: 9.5pt; color: #666; margin-top: 2px; }
  h2 { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 12pt; margin-top: 18px; margin-bottom: 8px; color: #222; border-bottom: 1px solid #ccc; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.8px; }
  .letter-body { margin-top: 12px; font-size: 10.5pt; }
  .letter-body p { margin: 8px 0; text-align: justify; }
  .info-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
  .info-table td { padding: 5px 10px; font-size: 10pt; border-bottom: 1px solid #eee; }
  .info-table td:first-child { font-weight: 600; width: 170px; color: #555; }
  .section { margin: 16px 0; }
  .section p { margin: 8px 0; text-align: justify; font-size: 10.5pt; padding-left: 28px; text-indent: -28px; }
  .signature-section { margin-top: 36px; page-break-inside: avoid; }
  .signature-row { display: flex; justify-content: space-between; margin-top: 24px; }
  .signature-field { flex: 1; }
  .signature-line { border-top: 1px solid #374151; margin-top: 36px; padding-top: 4px; font-size: 10pt; }
  .footer { margin-top: 36px; text-align: center; font-size: 8.5pt; color: #999; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; border-top: 0.5px solid #ccc; padding-top: 8px; }
  @media print { body { padding: 0; } }
</style></head>
<body>
<div class="container">
  <!-- Formal letterhead -->
  <div class="letterhead">
    <p class="co-name">${companyName}</p>
    ${companyAddr ? `<p class="co-addr">${esc(companyAddr)}</p>` : ''}
  </div>

  <!-- Caption block -->
  <div class="caption-block">
    <p class="caption-title">Employment Agreement</p>
    <p class="caption-parties">Between ${companyName} and ${empName}</p>
    <p class="caption-date">Effective ${
      signatures?.employee?.date
        ? fmtDate(
            String(signatures.employee.date).length === 10
              ? signatures.employee.date + 'T12:00:00'
              : signatures.employee.date,
          )
        : empStart || today
    }</p>
  </div>

  <!-- Body opening: contract recital -->
  <div class="letter-body">
    <p>This Agreement is made and entered into as of ${empStart || today}, by and between ${companyName} ("Employer") and ${empName}${empTitle ? `, ${empTitle}` : ''}${empAddr ? `, of ${esc(empAddr)}` : ''} ("Employee")${empEmail || empPhone ? ` (contactable at${empEmail ? ` ${empEmail}` : ''}${empEmail && empPhone ? ',' : ''}${empPhone ? ` ${empPhone}` : ''})` : ''} (collectively, the "Parties"). This Agreement sets forth the terms and conditions of the Employee's employment. The Parties agree as follows:</p>
  </div>

  <h2>Terms of Employment</h2>
  <table class="info-table">
    <tr><td>Position:</td><td>${empTitle || '—'}</td></tr>
    ${empDept ? `<tr><td>Department:</td><td>${empDept}</td></tr>` : ''}
    ${empLoc ? `<tr><td>Work Location:</td><td>${empLoc}</td></tr>` : ''}
    <tr><td>Employment Type:</td><td>${esc(empType)}</td></tr>
    <tr><td>Start Date:</td><td>${empStart}</td></tr>
    <tr><td>Compensation:</td><td>${payLabel}: ${empPay} (${esc(payType)})</td></tr>
    <tr><td>Pay Schedule:</td><td>${esc(empSchedule)}</td></tr>
  </table>

  <h2>Agreement Terms</h2>
  <div class="section">
    <p><strong>1. Position and Duties.</strong> The Employee accepts employment with the Employer in the position, department, and work location set forth above and agrees to faithfully, competently, and diligently perform all duties, responsibilities, tasks, and functions reasonably associated with that position, together with any other lawful duties that the Employer may assign from time to time, whether or not such duties are expressly described in any job description, consistent with the Employee's role, qualifications, or the legitimate business needs of the Employer. The Employee shall devote their full business time, attention, energy, judgment, knowledge, skill, and best efforts to the faithful performance of their duties during all scheduled working hours; shall at all times act honestly, ethically, loyally, and in the Employer's best interests; and shall perform all work in a competent, careful, professional, and workmanlike manner consistent with the standards, quality expectations, productivity requirements, and timelines established by the Employer. The Employee further agrees to: (a) report to, communicate openly with, and follow the lawful and reasonable instructions and directions of their assigned supervisor, manager, or any other person the Employer may designate; (b) accurately and truthfully record and report their time, work activities, expenses, and results, and promptly disclose to the Employer any error, loss, damage, theft, safety hazard, suspected fraud, or violation of law or policy of which the Employee becomes aware; (c) maintain in good standing any license, certification, registration, clearance, or qualification required for the position, and immediately notify the Employer of any change, lapse, suspension, or revocation thereof; and (d) treat coworkers, clients, customers, and members of the public with courtesy, respect, and professionalism at all times. The Employee acknowledges and agrees that the Employer retains sole and continuing discretion to assign, reassign, expand, reduce, or otherwise modify the Employee's title, duties, responsibilities, reporting relationships, department, supervisor, work location, shift, and schedule as the Employer's business needs require, and that no such change shall constitute a breach of this Agreement, entitle the Employee to any additional compensation unless separately agreed in writing, or alter the at-will nature of the employment relationship described in Section 3. During the term of employment, the Employee shall not, directly or indirectly, engage in or be employed by any other business, occupation, venture, or activity that competes with the Employer, that interferes with or impairs the full and faithful performance of the Employee's duties, that makes use of the Employer's time, equipment, or Confidential Information, or that creates an actual, potential, or apparent conflict of interest, without first obtaining the Employer's prior written consent, which the Employer may grant, condition, or withhold in its sole discretion.</p>
    <p><strong>2. Compensation.</strong> In full consideration for all services to be rendered by the Employee, the Employer shall pay the Employee at the rate, in the amount, and on the pay schedule specified in the Terms of Employment set forth above, less all withholdings, taxes, garnishments, deductions, and contributions required or permitted by applicable federal, state, and local law or authorized by the Employee. The Employee acknowledges and agrees that: (a) the compensation stated above constitutes the Employee's entire and complete cash compensation for all services rendered, and no bonus, commission, incentive, raise, equity, premium, stipend, severance, or other payment of any kind is earned, promised, or owed unless and until it is separately set forth in a written agreement signed by an authorized officer or representative of the Employer; (b) for non-exempt employees, the rate stated above is the Employee's regular rate of pay, and all hours actually worked, including any authorized overtime, shall be recorded and compensated strictly in accordance with Section 10 and all applicable federal and Utah wage-and-hour laws; (c) the Employee is responsible for accurately recording all time worked and for promptly reporting any payroll error, underpayment, or overpayment, and authorizes the Employer to correct any payroll error and to recover any wage overpayment, advance, or unearned draw to the fullest extent permitted by applicable law; and (d) wages will be paid by the method and on the regular paydays established by the Employer in compliance with the Utah Payment of Wages Act. The Employer reserves the right, in its sole discretion and to the extent permitted by applicable law, to review, establish, modify, increase, or decrease the Employee's compensation, pay rate, pay method, pay frequency, commission or bonus structure, and related pay practices on a prospective basis, with such advance notice as may be required by applicable law; no such review or adjustment shall be deemed a promise of continued employment, shall create any vested right to any particular level of compensation, or shall alter the at-will nature of the employment relationship. The Employee acknowledges that they have received, read, and reviewed the compensation terms set forth above, that those terms accurately and completely reflect the agreed rate of pay and pay frequency, and that the Employee is not relying on any oral or written representation regarding compensation that is not expressly contained in this Agreement.</p>
    <p><strong>3. At-Will Employment.</strong> The Employee's employment with the Employer is and shall at all times remain strictly "at-will." This means that either the Employee or the Employer may terminate, and the Employer may modify the terms and conditions of, the employment relationship at any time, for any reason or for no reason, with or without cause, and with or without advance notice, subject only to applicable law. The Employee specifically acknowledges and agrees that: (a) nothing contained in this Agreement, in any employee handbook, policy, manual, memorandum, offer letter, application, performance review, compensation plan, training material, verbal or written statement, or course of conduct, and nothing arising from the Employee's length of service, performance, promotions, raises, or commendations, shall be construed or relied upon to create a contract of employment for any fixed, definite, or implied term, to guarantee continued or permanent employment, to require "just cause," "good cause," warnings, or progressive discipline prior to termination, or to limit in any way the Employer's right to terminate at-will; (b) any descriptions of disciplinary or termination procedures are provided as guidelines only, are not contractually binding, and may be followed, modified, bypassed, or disregarded by the Employer in its sole discretion as it deems appropriate to the circumstances; and (c) no manager, supervisor, recruiter, officer, agent, or other representative of the Employer has the authority to enter into any agreement, or to make any promise, representation, or commitment, that alters the at-will nature of the employment relationship or that is contrary to the terms of this Section, and the Employee shall not rely on any such statement. The at-will employment relationship may be modified only by an express written agreement that specifically references and supersedes this Section and that is signed by both the Employee and a duly authorized officer of the Employer. The Employee further acknowledges that the at-will relationship survives and continues notwithstanding any change in the Employee's position, title, duties, compensation, benefits, work location, or length of service, and that this Section shall control over any contrary provision, understanding, or practice. This Section is reaffirmed and supplemented by, and shall be read together with, the reservation-of-rights provisions set forth elsewhere in this Agreement.</p>
    <p><strong>4. Benefits.</strong> The Employee may, subject to eligibility, be entitled to participate in such employee benefit plans, programs, insurance arrangements, and policies as the Employer may, in its sole and exclusive discretion, choose to establish, sponsor, maintain, amend, reduce, or terminate from time to time, which may include without limitation health, dental, vision, life, disability, retirement or 401(k), paid-time-off, holiday, sick-leave, and other benefit programs. The Employee acknowledges and agrees that: (a) each such benefit is governed exclusively by the terms, conditions, eligibility requirements, waiting periods, enrollment windows, vesting schedules, contribution and cost-sharing provisions, and limitations set forth in the controlling plan documents, summary plan descriptions, and insurance contracts then in effect, which documents and contracts shall govern and control in the event of any conflict or inconsistency with this Agreement, any benefits summary, any handbook, or any oral or written representation; (b) the Employer expressly reserves the right, at any time and for any reason, to adopt, add, change, amend, reduce, suspend, replace, or discontinue any benefit, plan, program, insurer, carrier, contribution level, or eligibility rule, in whole or in part, prospectively or as otherwise permitted, to the fullest extent allowed by applicable law and the applicable plan terms, and to require employee contributions toward the cost of any benefit; (c) nothing in this Section or in any benefit plan guarantees the availability, continuation, or any particular level of any benefit, creates any vested or contractual right to any benefit except as expressly provided by the governing plan documents, or constitutes a promise of continued employment; and (d) the offering, modification, or discontinuation of any benefit does not in any way alter, limit, or affect the at-will nature of the employment relationship described in Section 3. Questions regarding eligibility, coverage, claims, or the terms of any benefit shall be governed by, and directed in accordance with, the applicable plan documents and the plan administrator's determinations.</p>
    <p><strong>5. Confidentiality.</strong> The Employee acknowledges and agrees that, in the course and scope of employment, the Employee will be given access to, will be entrusted with, and will become acquainted with confidential, proprietary, sensitive, and trade-secret information belonging to the Employer and to its clients, customers, vendors, partners, and affiliates, the unauthorized use or disclosure of which would cause substantial and irreparable harm to the Employer. Such information includes, without limitation: client, customer, and prospect lists, files, contact information, account histories, and relationship details; pricing, cost, margin, billing, and financial data; business, marketing, sales, and strategic plans; methods, systems, procedures, processes, formulas, techniques, and know-how; software, source code, databases, login credentials, and technical documentation; vendor and supplier terms; personnel, payroll, and benefits records; and any other non-public information that is disclosed to, accessed by, observed by, or developed by the Employee, whether or not marked or designated as "confidential" (collectively, "Confidential Information"). The Employee agrees, both during employment and at all times after the employment relationship ends, for so long as the information remains confidential or constitutes a trade secret: (a) to hold all Confidential Information in the strictest confidence and to take all reasonable precautions to protect and safeguard it against unauthorized access, use, or disclosure; (b) to access and use Confidential Information solely for the legitimate benefit of the Employer and only to the extent necessary to perform the Employee's authorized duties; (c) not to directly or indirectly disclose, publish, communicate, transmit, copy, reproduce, remove, transfer, or otherwise make available any Confidential Information to any person or entity inside or outside the Employer who is not authorized to receive it, and not to use any Confidential Information for the benefit of the Employee or any third party or to the detriment of the Employer; and (d) not to comingle Confidential Information with the Employee's personal records, store it on unauthorized personal devices or accounts, or retain any copy after employment ends. Upon termination of employment for any reason, or at any earlier time upon the Employer's request, the Employee shall immediately cease all use of and return or, at the Employer's direction, permanently destroy all Confidential Information and all copies, notes, summaries, and derivatives thereof in any form or medium. The Employee's obligations under this Section are in addition to, cumulative with, and shall be read together with the Employee's obligations under Section 11 (Confidential Information &amp; Non-Disclosure), Section 12 (Data Security), and all applicable federal and Utah trade-secret and unfair-competition laws, and are subject to the protected-rights and statutory carve-outs set forth elsewhere in this Agreement, including the federal Defend Trade Secrets Act immunity notice, which permits limited disclosure of a trade secret made in confidence to a government official or attorney solely for the purpose of reporting or investigating a suspected violation of law, or in a sealed court filing.</p>
    <p><strong>6. Company Property.</strong> All equipment, devices, computers, hardware, peripherals, software, licenses, tools, instruments, supplies, materials, inventory, uniforms, vehicles, fuel and credit cards, keys, badges, access cards and codes, mobile and electronic devices, telephones, documents, files, manuals, records, correspondence, data, databases, drawings, designs, and work product, and all other property, tangible or intangible, that is furnished, issued, advanced, or made available to the Employee by the Employer, or that is acquired, created, generated, or received by the Employee in connection with or as a result of employment, shall be and remain at all times the sole and exclusive property of the Employer (collectively, "Company Property"). The Employee agrees that: (a) the Employee shall use all Company Property only for legitimate, authorized business purposes and in accordance with the Employer's policies, and shall exercise reasonable and prudent care to maintain, protect, and safeguard Company Property against loss, theft, damage, misuse, tampering, and unauthorized access or disclosure; (b) the Employee shall not remove Company Property from the Employer's premises except as expressly authorized, shall not lend, sell, pledge, alter, or allow any unauthorized person to use Company Property, and shall not install unauthorized software or use Company Property for any unlawful, personal, or competing purpose; and (c) the Employee has no expectation of privacy in any Company Property or in any communication, file, or data created, stored, sent, or received using Company Property or the Employer's systems, all of which the Employer may access, monitor, review, and disclose at any time to the extent permitted by law. Upon termination of employment for any reason, or at any earlier time upon the Employer's request, the Employee shall immediately surrender and return to the Employer all Company Property in good operating condition, reasonable wear and tear excepted, together with all originals and copies of any Confidential Information in any form or medium, and shall not retain, copy, withhold, encrypt, delete, wipe, alter, damage, or destroy any Company Property, data, or account credentials without the Employer's express prior written authorization. To the fullest extent permitted by applicable law, and subject to a separate written wage-deduction authorization where required, the Employer may withhold from the Employee's wages or final pay, set off against amounts owed to the Employee, and/or pursue reimbursement or recovery for, the documented replacement or repair value of any Company Property that the Employee fails to return, or that is returned lost, damaged, destroyed, or stolen as a result of the Employee's negligence, misuse, or misconduct; provided, however, that no such deduction shall reduce the Employee's wages below the applicable federal or Utah minimum wage for any workweek or unlawfully reduce any overtime compensation due, and all such deductions shall comply with the Utah Payment of Wages Act and the Fair Labor Standards Act.</p>
    <p><strong>7. Compliance with Policies.</strong> The Employee agrees to read, understand, and comply at all times, both in letter and in spirit, with all of the Employer's policies, procedures, rules, handbooks, manuals, codes of conduct, safety rules, and other written or verbal directives, as the same may be adopted, interpreted, applied, modified, supplemented, suspended, or rescinded by the Employer in its sole discretion from time to time and without prior notice, including without limitation policies and rules governing: attendance, punctuality, and timekeeping; workplace conduct, professionalism, and dress; anti-harassment, anti-discrimination, anti-retaliation, and equal employment opportunity; information technology, electronic communications, internet, and acceptable use; data security, privacy, and confidentiality; expense, purchasing, and company-credit-card use; conflicts of interest and outside employment; drug-, alcohol-, and substance-free workplace; health, safety, and the operation of equipment and vehicles; and the protection of the Employer's property and Confidential Information. The Employee acknowledges and agrees that: (a) the Employer's policies, handbooks, and procedures are guidelines maintained for the orderly operation of the business and the convenience of the Employer, are not intended to and do not create a contract of employment, a promise of continued employment, or any contractual right, may be applied and enforced at the Employer's discretion as the circumstances warrant, and do not alter the at-will relationship described in Section 3; (b) the Employee has received, or has been afforded a full and fair opportunity to request, review, and ask questions about, all applicable policies, and is responsible for remaining current with policies as they are updated; and (c) any violation of, or failure to comply with, any policy, procedure, rule, or directive, or any act of dishonesty, insubordination, or misconduct, may result in corrective or disciplinary action, up to and including immediate termination of employment, in addition to any other remedy, recovery, or relief available to the Employer under this Agreement, the Employer's policies, or applicable law. The Employee further agrees to cooperate fully and truthfully in any internal investigation, audit, or inquiry conducted by or on behalf of the Employer. In the event of any conflict or inconsistency between a policy and this Agreement, this Agreement shall control unless the policy expressly states otherwise or applicable law requires otherwise.</p>
    <p><strong>8. Company Credit Card &amp; Purchasing Authorization.</strong> The Employer may, at its sole discretion, authorize the Employee to make purchases on a company-issued credit card, procurement card, or approved vendor account for legitimate, work-related expenses. Such authority is conditioned on the following: (a) <em>Prior approval</em> — all purchases exceeding limits set by the Employer must receive prior written or electronic approval from the Employee's supervisor or an authorized approver before the transaction is made; (b) <em>Business purpose only</em> — the card and any company funds shall be used exclusively for bona fide business purposes and never for personal, family, or household expenses; (c) <em>Receipts &amp; documentation</em> — the Employee shall retain and submit an itemized receipt and a business-purpose justification for every transaction within five (5) business days, through the Employer's expense management system; (d) <em>Spending limits</em> — the Employee shall not exceed any per-transaction, daily, or monthly limit assigned to them, nor circumvent limits by splitting transactions; (e) <em>Prohibited uses</em> — cash advances, gift cards, alcohol (unless pre-approved for a qualifying event), and any purchase prohibited by Employer policy are not permitted. The Employee acknowledges that unauthorized, undocumented, or personal charges may be deducted from wages to the fullest extent permitted by applicable law, and may result in revocation of purchasing privileges and disciplinary action up to and including termination. The card remains the property of the Employer and must be surrendered immediately upon request or termination.</p>
    <p><strong>9. Expense Reimbursement.</strong> The Employer will reimburse the Employee for reasonable, necessary, and pre-approved out-of-pocket business expenses incurred in the performance of their duties, provided the Employee submits a complete expense report with original itemized receipts within thirty (30) days of incurring the expense. Reimbursement is subject to the Employer's then-current expense and travel policies. The Employer reserves the right to deny reimbursement for expenses that are undocumented, lack a clear business purpose, exceed policy limits, or were not properly pre-approved where pre-approval is required.</p>
    <p><strong>10. Work Schedule &amp; Overtime.</strong> The Employee's regular work schedule shall be as assigned by the Employer and may be modified to meet business needs. Non-exempt employees shall be paid overtime in accordance with applicable federal and state wage-and-hour law for hours worked beyond the applicable threshold. The Employee shall accurately record all time worked and shall not perform off-the-clock work. Overtime must be authorized in advance by the Employee's supervisor.</p>
    <p><strong>11. Confidential Information &amp; Non-Disclosure.</strong> In addition to Section 5, the Employee agrees that all client lists, case files, financial records, business methods, pricing, and other proprietary information constitute trade secrets of the Employer. The Employee shall not disclose, copy, or use such information except as required to perform their duties, and these obligations survive termination of employment indefinitely.</p>
    <p><strong>12. Data Security &amp; Acceptable Use.</strong> The Employee shall protect all Employer and client data, use only Employer-approved systems and devices for work, maintain strong credentials, report any suspected security incident immediately, and comply with the Employer's Information Technology Acceptable Use Policy. The Employee shall not store Employer or client data on personal devices or unauthorized cloud services.</p>

    <p><strong>13. Background Investigation &amp; Continued Eligibility.</strong> The Employee acknowledges that, given the sensitive and security-related nature of the Employer's business, their employment is contingent upon the successful completion of, and continued satisfactory results from, a comprehensive background investigation. Such investigation may include, to the fullest extent permitted by applicable law: (a) a criminal history check at the county, state, and federal levels; (b) verification of prior employment, education, and professional references; (c) a credit history review where job-related and legally permissible; (d) verification of identity and authorization to work in the United States (Form I-9 and E-Verify); and (e) periodic re-investigation at intervals determined by the Employer or as required by any client contract, statute, or regulatory authority. The Employee agrees to promptly disclose, in writing, any arrest, charge, citation, conviction, restraining order, license suspension, or other event that could reasonably affect their eligibility to perform their duties or the Employer's standing with its clients, regulators, or insurers, within seventy-two (72) hours of such event. Failure to disclose, or the discovery of disqualifying information, may result in immediate suspension or termination of employment. The Employee authorizes the Employer and its designated agents to obtain and rely upon such information and releases the Employer from any liability arising from a good-faith investigation conducted in accordance with the Fair Credit Reporting Act and applicable state law.</p>

    <p><strong>14. Professional Licensing, Certifications &amp; Training.</strong> The Employee shall obtain and maintain, at all times during their employment and at their own expense unless the Employer agrees otherwise in writing, all licenses, registrations, permits, certifications, and continuing-education requirements necessary to lawfully perform their assigned duties, including without limitation any private investigator, security officer, process server, armed/unarmed guard, or notary credentials required by the jurisdiction(s) in which they operate. The Employee shall provide the Employer with current copies of all such credentials and shall notify the Employer immediately upon any lapse, suspension, revocation, denial, or disciplinary action affecting any credential. The Employee shall not perform any function requiring a credential they do not currently and validly hold. The Employer may, in its discretion, advance or reimburse the cost of required licensing and training; in such event, the Employee agrees that if they voluntarily resign or are terminated for cause within twelve (12) months after the Employer pays for a license, certification, or training program, the prorated cost thereof may be deducted from the Employee's final compensation to the fullest extent permitted by applicable law. Time spent obtaining or renewing credentials outside of compensable working hours is not compensable unless required by law.</p>

    <p><strong>15. Drug-Free &amp; Alcohol-Free Workplace.</strong> The Employer maintains a drug- and alcohol-free workplace. The Employee shall not manufacture, distribute, dispense, possess, use, or be under the influence of any illegal drug, controlled substance (except a lawfully prescribed medication used as directed that does not impair the Employee's ability to safely perform their duties), or alcohol while on Employer or client premises, while operating any Employer vehicle or equipment, or while otherwise performing services for the Employer. The Employee consents to drug and alcohol testing — including pre-employment, reasonable-suspicion, post-incident, random, and return-to-duty testing — administered in accordance with the Employer's policy and applicable law. A confirmed positive test, refusal to test, tampering with a sample, or violation of this Section constitutes grounds for immediate termination. The Employee shall notify their supervisor before performing safety-sensitive duties if they are taking any medication that carries a warning regarding the operation of machinery or vehicles or that may impair judgment, coordination, or alertness.</p>

    <p><strong>16. Conflicts of Interest &amp; Outside Activities.</strong> During employment, the Employee shall devote their professional loyalty to the Employer and shall avoid any activity, investment, interest, or association that conflicts or appears to conflict with the Employer's interests or the Employee's duties. The Employee shall not, without the Employer's prior written consent: (a) engage in any outside business, employment, or consulting that competes with the Employer, interferes with the Employee's duties, or uses the Employer's confidential information, equipment, or relationships; (b) accept any fee, gift, kickback, commission, or other thing of value from any client, vendor, adverse party, or other person in connection with the Employee's duties, beyond nominal courtesies of customary business value; (c) have a financial or familial interest in any vendor, client, or competitor that the Employee can influence on the Employer's behalf; or (d) use the Employer's name, logo, or credentials for any purpose not authorized by the Employer. The Employee shall promptly disclose in writing any actual, potential, or apparent conflict of interest. The Employer may require the Employee to divest, recuse, or cease any conflicting activity.</p>

    <p><strong>17. Non-Solicitation &amp; Restrictive Covenants.</strong> The Employee acknowledges that, in the course of employment, they will acquire confidential information and develop relationships with the Employer's clients, prospects, employees, and contractors that are valuable assets of the Employer. Accordingly, during employment and for a period of twelve (12) months following the termination of employment for any reason, the Employee shall not, directly or indirectly, on their own behalf or on behalf of any other person or entity: (a) solicit, divert, or attempt to solicit or divert any client or prospective client of the Employer with whom the Employee had material contact or about whom the Employee obtained confidential information during the last twenty-four (24) months of employment; (b) solicit, recruit, hire, or attempt to induce any employee, contractor, or agent of the Employer to terminate their relationship with the Employer; or (c) disparage the Employer, its officers, or its services. Each restriction is intended to be reasonable in scope, geography, and duration; if any court finds any restriction overbroad or unenforceable, the parties intend that the restriction be modified (blue-penciled) to the maximum extent enforceable rather than voided. These covenants are in addition to, and do not limit, the confidentiality obligations in Sections 5 and 11. To the extent any restriction in this Section is prohibited or unenforceable for the Employee under applicable state law, that restriction shall not apply.</p>

    <p><strong>18. Intellectual Property &amp; Work-Product Assignment.</strong> The Employee agrees that all reports, investigations, work product, inventions, discoveries, improvements, software, written materials, photographs, recordings, case files, databases, processes, and other materials conceived, developed, created, or reduced to practice by the Employee, alone or with others, within the scope of employment or using the Employer's time, equipment, information, or resources (collectively, "Work Product") are "works made for hire" and the sole and exclusive property of the Employer. To the extent any Work Product does not qualify as a work made for hire, the Employee hereby irrevocably assigns to the Employer all right, title, and interest therein, including all patent, copyright, trademark, trade-secret, and other intellectual-property rights, and waives any moral rights. The Employee shall promptly disclose all Work Product to the Employer and shall, at the Employer's expense, execute any documents and take any actions reasonably necessary to perfect, register, or enforce the Employer's rights, both during and after employment. The Employee shall not incorporate any third-party or pre-existing intellectual property into any Work Product without the Employer's prior written consent and a valid license.</p>

    <p><strong>19. Company Vehicles &amp; Driving.</strong> If the Employee is authorized to operate an Employer-owned, leased, or rented vehicle, or to drive their personal vehicle for Employer business, the Employee shall: (a) maintain a valid driver's license appropriate to the vehicle class and promptly report any suspension, revocation, or restriction; (b) comply with all traffic laws and the Employer's vehicle and safety policies; (c) never operate a vehicle while impaired, fatigued, distracted, or while using a handheld device in violation of law; (d) report any accident, citation, mechanical problem, or damage immediately; and (e) consent to the Employer obtaining and periodically reviewing the Employee's motor-vehicle record. The Employee is responsible for any fines, tolls, citations, or damage resulting from their negligent, reckless, unauthorized, or personal use of a vehicle, which may be deducted from compensation to the extent permitted by law. The Employer's vehicles and any installed telematics, GPS, or dash-camera systems may be monitored; the Employee consents to such monitoring. Personal use of Employer vehicles is prohibited unless expressly authorized in writing.</p>

    <p><strong>20. Workplace Safety &amp; Injury Reporting.</strong> The Employee shall perform all duties in a safe manner, follow all safety rules, use all required personal protective equipment, and immediately report to their supervisor any workplace injury, illness, accident, near-miss, hazard, threat, or unsafe condition, regardless of severity, no later than the end of the shift in which it occurs or is discovered. The Employee shall cooperate fully with any investigation and, where required by the Employer's workers' compensation carrier or applicable law, submit to a post-incident medical examination or drug/alcohol test. The Employee shall not operate any equipment or perform any duty for which they have not been trained and authorized. Failure to timely report a work-related injury may affect the availability of benefits and may constitute grounds for discipline. Nothing in this Section discourages or penalizes the good-faith reporting of injuries, hazards, or safety concerns, and the Employer prohibits retaliation against any Employee for such reporting.</p>

    <p><strong>21. Equal Opportunity, Anti-Harassment &amp; Anti-Retaliation.</strong> The Employer is an equal-opportunity employer and is committed to a workplace free of unlawful discrimination, harassment, and retaliation. The Employer prohibits discrimination or harassment based on race, color, religion, sex, sexual orientation, gender identity, national origin, age, disability, genetic information, veteran status, or any other characteristic protected by federal, state, or local law. The Employee shall treat all coworkers, clients, vendors, and members of the public with respect and professionalism and shall not engage in any conduct that creates an intimidating, hostile, or offensive work environment. The Employee shall promptly report any conduct they believe violates this policy to their supervisor, the HR Manager, or any member of management, and the Employer shall investigate all complaints promptly, impartially, and as confidentially as practicable. The Employer strictly prohibits retaliation against any person who, in good faith, reports a concern, files a complaint, or participates in an investigation. Violation of this Section may result in discipline up to and including termination.</p>

    <p><strong>22. Dispute Resolution.</strong> The parties shall first attempt to resolve any dispute arising out of or relating to this Agreement or the Employee's employment through good-faith informal discussion and, if unresolved, through the Employer's internal grievance process. Any dispute not so resolved shall, to the fullest extent permitted by applicable law, be submitted to final and binding arbitration administered by a neutral arbitrator under the rules of a recognized arbitration body, with each party bearing its own attorneys' fees except as a statute or the arbitrator may otherwise provide, and with the arbitration seated in the county of the Employer's principal place of business. This Section does not waive any non-waivable statutory right, does not preclude either party from seeking provisional injunctive relief in court to protect confidential information or enforce the restrictive covenants in Sections 11 and 17, and does not bar the filing of an administrative charge with any government agency. To the extent class, collective, or representative claims are not lawfully waivable, this Section applies only to the maximum extent permitted by applicable law.</p>

    <p><strong>23. Company Credit Card — Early-Separation Chargeback.</strong> The Employee expressly acknowledges and agrees that, in further consideration of the privilege of using an Employer-issued credit card, procurement card, or approved vendor account (Section 8), the following condition applies if the Employee separates from the Employer — whether by voluntary resignation, involuntary termination with or without cause, abandonment, or otherwise — <strong>within three (3) months of the Employee's start date</strong>: <strong>any and all expenses, charges, fees, interest, and amounts incurred by the Employee on or through any Employer card or account, whether or not such charges were pre-approved, authorized, documented, or for a legitimate business purpose, shall become the personal debt and obligation of the Employee and shall be charged back to the Employee in full.</strong> The Employee agrees that this chargeback applies to the entire amount charged during the Employee's tenure, including charges the Employer would otherwise have absorbed as ordinary business expenses, and that it is a negotiated condition of extending card privileges to a newly hired employee whose long-term commitment to the Employer is unproven. The Employee authorizes the Employer to recover such amounts by deducting them from the Employee's final wages, salary, commissions, accrued and payable leave (where permitted by law), bonuses, expense reimbursements, or any other compensation payable upon separation, to the fullest extent permitted by applicable law. Any balance not recovered through deduction shall be immediately due and payable as a liquidated debt within thirty (30) days of the Employer's written demand, and shall thereafter be subject to the Collections provisions of Section 24. This Section does not limit the Employer's right to recover unauthorized, personal, undocumented, or fraudulent charges at any time regardless of the Employee's length of service.</p>

    <p><strong>24. Collections, Costs of Recovery &amp; Credit Reporting.</strong> The Employee acknowledges that any amount the Employee owes to the Employer — including but not limited to unauthorized or personal credit-card charges, the Section 23 early-separation chargeback, equipment replacement costs and penalties, training or licensing repayment obligations, overpaid wages or advances, and any other debt arising under this Agreement — constitutes a valid, liquidated debt owed to the Employer. If such amount is not paid in full when due, the Employer may, to the fullest extent permitted by applicable law: <strong>(a)</strong> refer the debt to a third-party collection agency or attorney for collection; <strong>(b)</strong> report the delinquent debt to one or more consumer or commercial credit-reporting agencies; <strong>(c)</strong> pursue any civil remedy available, including suit for the principal balance, pre- and post-judgment interest at the maximum lawful rate, and recovery of all costs of collection; and <strong>(d)</strong> set off the debt against any amount the Employer may owe the Employee. <strong>The Employee agrees to pay all reasonable costs of collection incurred by the Employer, including collection-agency fees, court costs, and reasonable attorneys' fees, whether or not suit is filed.</strong> Interest shall accrue on any unpaid balance from the due date at the lesser of one and one-half percent (1.5%) per month or the maximum rate permitted by law. The Employee's obligation to repay any such debt, and the Employer's right to pursue collection, shall survive the termination of employment and this Agreement. Partial payments may be applied first to costs and interest, then to principal, at the Employer's discretion. Nothing in this Section requires the Employer to pursue collection, and the Employer's forbearance on any occasion shall not waive its right to collect on any other occasion.</p>

    <p><strong>25. Wage-Deduction Authorization &amp; Acknowledgment.</strong> The Employee voluntarily and knowingly authorizes the Employer to deduct from the Employee's wages, salary, commissions, bonuses, reimbursements, accrued and payable leave (where permitted), and any final paycheck, the full amount of any debt or obligation owed by the Employee under this Agreement, including the amounts described in Sections 8, 23, and 24, to the fullest extent permitted by applicable federal and state wage-and-hour law. The Employee understands that this authorization is given as a condition of, and in consideration for, employment and the extension of card and purchasing privileges. Where applicable law requires that a deduction not reduce the Employee's pay below the minimum wage or limits the amount that may be withheld from a single paycheck, the Employer will comply with such limits and may recover the remaining balance through subsequent deductions or as a debt under Section 24. The Employee acknowledges receiving a copy of this authorization and that it may be revoked only in writing as to <em>future</em> deductions and does not affect the Employer's right to recover amounts already incurred. This authorization shall remain in effect throughout employment and survive separation as to any amounts then owed.</p>

    <p><strong>26. Federal &amp; Utah Wage-and-Hour Compliance.</strong> All wage payments, deductions, chargebacks, and recoveries under this Agreement shall be administered in compliance with the federal Fair Labor Standards Act ("FLSA") and the Utah Payment of Wages Act, Utah Code Ann. &sect;&sect; 34-28-1 et seq. Specifically: <strong>(a)</strong> no deduction authorized under Sections 8, 23, 24, or 25 shall reduce the Employee's pay below the applicable federal or Utah minimum wage for any workweek, nor shall any deduction be taken from overtime compensation in violation of the FLSA; <strong>(b)</strong> deductions other than those required or specifically permitted by law shall be made only pursuant to the Employee's written authorization in this Agreement, as required by Utah Code Ann. &sect; 34-28-3; <strong>(c)</strong> upon involuntary separation the Employer shall pay all wages then due within twenty-four (24) hours as required by Utah Code Ann. &sect; 34-28-5, and upon voluntary separation by the next regular payday, with any disputed chargeback or debt pursued separately as a civil debt under Section 24 rather than withheld in violation of law; and <strong>(d)</strong> where any provision of this Agreement would, as applied, require a deduction or withholding prohibited by the FLSA or Utah law, that provision shall be deemed automatically modified to the maximum extent lawful, and any shortfall shall be recoverable solely as a debt under Section 24.</p>

    <p><strong>27. Protected Rights; Lawful-Activity Carve-Out.</strong> Nothing in this Agreement — including the confidentiality (Sections 5, 11), non-disparagement (Section 17), data-security (Section 12), arbitration (Section 22), or any other provision — shall be construed to waive, limit, or interfere with any right the Employee has under law that cannot lawfully be waived, including without limitation: <strong>(a)</strong> the right under Section 7 of the National Labor Relations Act to engage in protected concerted activity, including discussing wages, hours, and terms and conditions of employment; <strong>(b)</strong> the right to file a charge or complaint with, provide information to, or participate in an investigation by the Equal Employment Opportunity Commission, the National Labor Relations Board, the Occupational Safety and Health Administration, the U.S. Department of Labor, the Securities and Exchange Commission, the Utah Antidiscrimination and Labor Division, or any other federal, state, or local government agency; <strong>(c)</strong> the right to report possible violations of law, to make disclosures protected under any whistleblower statute, and to receive any whistleblower award; and <strong>(d)</strong> the immunity provided under the federal Defend Trade Secrets Act, 18 U.S.C. &sect; 1833(b), for the confidential disclosure of a trade secret to a government official or attorney solely for the purpose of reporting or investigating a suspected violation of law, or in a sealed court filing. The Employee does not need the Employer's prior authorization to engage in such protected conduct and need not notify the Employer that they have done so. This Section controls over any conflicting provision of this Agreement.</p>

    <p><strong>28. Utah Post-Employment Restrictions Act Compliance.</strong> The restrictive covenants in Section 17 are intended to comply with the Utah Post-Employment Restrictions Act, Utah Code Ann. &sect;&sect; 34-51-101 et seq. To the extent any provision of Section 17 constitutes a "post-employment restrictive covenant" or "covenant not to compete" within the meaning of that Act, its duration shall not exceed one (1) year from the date the Employee is no longer employed by the Employer, consistent with Utah Code Ann. &sect; 34-51-201, and any provision purporting to extend beyond that period shall be automatically reduced to one (1) year. Nothing in Section 17 restricts the Employee's ability to be employed by or compete with the Employer except to the limited extent expressly permitted by Utah law; the client- and employee-non-solicitation and confidentiality obligations are independent protections of the Employer's trade secrets and goodwill and are not intended as a general covenant not to compete. If a court determines that any covenant is unenforceable under the Act, the parties intend that it be reformed to the maximum enforceable extent rather than voided in its entirety.</p>

    <p><strong>29. Electronic Signatures, Counterparts &amp; Records.</strong> The parties agree that this Agreement and any related document may be executed and delivered by electronic signature, and that such electronic signatures are legally valid, binding, and enforceable to the same extent as a handwritten signature under the federal Electronic Signatures in Global and National Commerce Act ("ESIGN"), 15 U.S.C. &sect;&sect; 7001 et seq., and the Utah Uniform Electronic Transactions Act, Utah Code Ann. &sect;&sect; 46-4-101 et seq. The Employee consents to conduct this transaction by electronic means, agrees that an electronic record of this Agreement (including the cryptographic hash and audit log generated by the Employer's system) satisfies any requirement that the Agreement be in writing and signed, and agrees that such electronic record shall be admissible as an original. This Agreement may be executed in counterparts, each of which is deemed an original and all of which together constitute one instrument.</p>

    <p><strong>30. Reservation of Rights, Limitation of Liability &amp; No Waiver.</strong> <strong>(a) At-Will Reaffirmation.</strong> Notwithstanding any other provision, the Employee's employment remains at-will as set forth in Section 3; nothing in this Agreement creates a contract of employment for any definite term, a guarantee of continued employment, or any implied covenant limiting the Employer's right to terminate the employment relationship at any time, with or without cause or notice. <strong>(b) Limitation of Liability.</strong> To the fullest extent permitted by law, the Employer's aggregate liability to the Employee arising out of or relating to this Agreement, other than for amounts of earned but unpaid wages or any liability that may not lawfully be limited, shall not exceed the total compensation paid to the Employee during the three (3) months preceding the event giving rise to the claim, and the Employer shall not be liable for any consequential, incidental, punitive, or exemplary damages. <strong>(c) No Waiver; Cumulative Remedies.</strong> The Employer's failure or delay in enforcing any provision of this Agreement shall not constitute a waiver of that or any other provision or of the Employer's right to enforce it later. All of the Employer's rights and remedies under this Agreement are cumulative and in addition to, not in lieu of, any rights or remedies available at law or in equity. <strong>(d) Successors &amp; Assigns.</strong> This Agreement binds and benefits the Employer's successors and assigns; the Employer may assign this Agreement without the Employee's consent, while the Employee may not assign any obligation hereunder.</p>

    <p><strong>31. Governing Law, Venue &amp; Severability.</strong> This Agreement shall be governed by and construed in accordance with the laws of the State of Utah${esc(employee.state && employee.state.toUpperCase() !== 'UT' ? ' (or the State of ' + employee.state + " where its law mandatorily applies to the Employee's worksite)" : '')}, without regard to its conflict-of-laws principles, and, where applicable, by federal law. Subject to the arbitration provision in Section 22, the parties consent to the exclusive jurisdiction and venue of the state and federal courts located in the county of the Employer's principal place of business in Utah for any action permitted to be brought in court, and waive any objection to such venue. <strong>To the fullest extent permitted by law, each party knowingly and voluntarily waives any right to a trial by jury</strong> in any such action. If any provision of this Agreement is held invalid, unenforceable, or contrary to the FLSA, the Utah Payment of Wages Act, the Utah Post-Employment Restrictions Act, or any other applicable law, that provision shall be reformed and enforced to the maximum extent permitted, or if it cannot be so reformed, severed, and the remaining provisions shall continue in full force and effect. This Agreement, together with the Employer's policies and any other documents referenced herein, constitutes the entire agreement between the parties regarding its subject matter and supersedes all prior oral or written understandings; it may be amended only in a writing signed by the Employer. The Employee acknowledges that they have had the opportunity to review this Agreement, to ask questions, and to seek independent legal counsel before signing.</p>
  </div>

  ${agreementSignatureBlock(empName, companyName, signatures)}

  <div class="footer">
    <p>${companyName} &mdash; Employee Agreement</p>
    <p>${
      signatures?.employee?.date
        ? `Signed by ${empName} on ${fmtDate(String(signatures.employee.date).length === 10 ? signatures.employee.date + 'T12:00:00' : signatures.employee.date)}`
        : `Generated on ${today}`
    }</p>
  </div>
</div>
</body>
</html>`;

        return { html };
      } catch (err: any) {
        console.error('Failed to generate employee agreement:', err);
        return { html: '' };
      }
    },
  );
}
