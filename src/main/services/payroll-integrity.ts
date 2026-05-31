// src/main/services/payroll-integrity.ts
//
// AREA 4 — Payroll Integrity Guard
//
// Enforces the payroll accounting invariant:
//
//     total_gross == total_net + total_taxes + total_deductions
//
// i.e. every dollar of gross pay is accounted for as either take-home
// (net), withheld taxes, or other deductions. When this fails, the
// run's books don't balance — gross was reported as more (or less)
// than the sum of its parts, which corrupts P&L, tax liability, and
// employee pay-stub totals downstream.
//
// Design choices:
//
//  • Money tolerance is 0.01 (one cent). Payroll figures are stored as
//    REAL and computed from per-stub rounding, so sub-cent float drift
//    is expected and benign; a gap > 1¢ is a real reconciliation error.
//
//  • GUARD, not auto-fixer. validatePayrollRun / assertPayrollRunValid
//    are meant to BLOCK a draft run from transitioning to
//    'processed'/'paid' when its totals don't balance. They NEVER
//    mutate the stored figures — fabricating a tax or deduction number
//    to force balance would hide a real bug and mis-state liabilities.
//    Remediation is a human/recompute decision.
//
//  • scanPayrollIntegrity is read-only reporting: list every run that
//    currently violates the invariant (e.g. legacy/seed data) so it can
//    be surfaced in an integrity dashboard.
//
//  • Best-effort: never throws. On any failure (db not ready, missing
//    run) callers get ok:false / an empty list, so a payroll save is
//    never crashed by the guard itself.

import type { Database } from 'better-sqlite3';
import * as db from '../database';

// One cent — see header. Stricter than the 0.005 settled-balance epsilon
// because payroll totals accumulate per-stub rounding across many rows.
const MONEY_EPSILON = 0.01;

export interface PayrollViolation {
  runId: string;
  payDate: string;
  gross: number;
  net: number;
  taxes: number;
  deductions: number;
  expectedNet: number; // gross - taxes - deductions (what net SHOULD be)
  gap: number;         // gross - (net + taxes + deductions); signed
}

interface PayrollRunRow {
  id: string;
  pay_date: string;
  total_gross: number;
  total_net: number;
  total_taxes: number;
  total_deductions: number;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Pure invariant check. ok when |gross - (net+taxes+deductions)| <= 0.01.
 * gap is the signed difference gross - (net+taxes+deductions).
 */
export function validatePayrollRun(run: {
  total_gross: number;
  total_net: number;
  total_taxes: number;
  total_deductions: number;
}): { ok: boolean; gap: number; message?: string } {
  const gross = n(run.total_gross);
  const net = n(run.total_net);
  const taxes = n(run.total_taxes);
  const deductions = n(run.total_deductions);

  const gap = gross - (net + taxes + deductions);
  const ok = Math.abs(gap) <= MONEY_EPSILON;

  if (ok) return { ok: true, gap };
  return {
    ok: false,
    gap,
    message:
      `Payroll totals do not balance: gross ${gross.toFixed(2)} != ` +
      `net ${net.toFixed(2)} + taxes ${taxes.toFixed(2)} + ` +
      `deductions ${deductions.toFixed(2)} (gap ${gap.toFixed(2)})`,
  };
}

function toViolation(row: PayrollRunRow): PayrollViolation | null {
  const gross = n(row.total_gross);
  const net = n(row.total_net);
  const taxes = n(row.total_taxes);
  const deductions = n(row.total_deductions);
  const check = validatePayrollRun(row);
  if (check.ok) return null;
  return {
    runId: row.id,
    payDate: row.pay_date,
    gross,
    net,
    taxes,
    deductions,
    expectedNet: gross - taxes - deductions,
    gap: check.gap,
  };
}

/**
 * Scan all payroll runs for invariant violations. Read-only.
 * If companyId is omitted, scans the current company. Never throws —
 * returns [] on any failure.
 */
export function scanPayrollIntegrity(companyId?: string): PayrollViolation[] {
  let database: Database;
  try {
    database = db.getDb();
  } catch {
    return [];
  }

  const cid = companyId ?? db.getCurrentCompanyId();
  if (!cid) return [];

  let rows: PayrollRunRow[] = [];
  try {
    rows = database
      .prepare(
        `SELECT id, pay_date, total_gross, total_net, total_taxes, total_deductions
         FROM payroll_runs
         WHERE company_id = ?`
      )
      .all(cid) as PayrollRunRow[];
  } catch {
    return [];
  }

  const violations: PayrollViolation[] = [];
  for (const row of rows) {
    const v = toViolation(row);
    if (v) violations.push(v);
  }
  return violations;
}

/**
 * Load a single run and check the invariant. Intended as a GUARD before
 * transitioning a run to 'processed'/'paid'. Does NOT mutate figures.
 * Never throws — returns ok:false on db error / missing run.
 */
export function assertPayrollRunValid(
  runId: string
): { ok: boolean; violation?: PayrollViolation } {
  let database: Database;
  try {
    database = db.getDb();
  } catch {
    return { ok: false };
  }

  let row: PayrollRunRow | undefined;
  try {
    row = database
      .prepare(
        `SELECT id, pay_date, total_gross, total_net, total_taxes, total_deductions
         FROM payroll_runs
         WHERE id = ?`
      )
      .get(runId) as PayrollRunRow | undefined;
  } catch {
    return { ok: false };
  }

  if (!row) return { ok: false };

  const violation = toViolation(row);
  if (violation) return { ok: false, violation };
  return { ok: true };
}
