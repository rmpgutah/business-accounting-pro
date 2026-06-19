// src/main/automations/index.ts
//
// AUTO-GENERATED registry of all system automation modules.
// Each module under ./<domain>/<slug>.ts exports a standard `automation`
// object. This registry collects them and exposes trigger-bucketed runners
// used by the cron scheduler (main.ts) and the manual IPC handlers.
//
// Every run() is best-effort and never throws; the registry adds a second
// try/catch belt so one bad module can't break a whole batch.

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export type AutomationTrigger = 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: AutomationTrigger;
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

import { automation as a0 } from './ap-bills/bill-approval-sla-escalator';
import { automation as a1 } from './ap-bills/bill-due-reminder';
import { automation as a2 } from './ap-bills/bill-overdue-stamp';
import { automation as a3 } from './ap-bills/duplicate-bill-detector';
import { automation as a4 } from './ap-bills/early-pay-discount-alert';
import { automation as a5 } from './ap-bills/recurring-bill-generator';
import { automation as a6 } from './ap-bills/vendor-1099-threshold-tracker';
import { automation as a7 } from './ap-bills/vendor-w9-missing-flag';
import { automation as a8 } from './banking/auto-bank-match';
import { automation as a9 } from './banking/bank-rule-categorizer';
import { automation as a10 } from './banking/duplicate-transaction-detector';
import { automation as a11 } from './banking/low-balance-alert';
import { automation as a12 } from './banking/reconciliation-reminder';
import { automation as a13 } from './banking/stale-uncleared-flag';
import { automation as a14 } from './banking/sweep-rule-executor';
import { automation as a15 } from './collections/broken-promise-flag';
import { automation as a16 } from './collections/collection-cadence-advancer';
import { automation as a17 } from './collections/collections-handoff-suggester';
import { automation as a18 } from './collections/promise-to-pay-followup';
import { automation as a19 } from './collections/settlement-offer-expiry';
import { automation as a20 } from './compliance-admin/backup-verification';
import { automation as a21 } from './compliance-admin/document-retention-purge';
import { automation as a22 } from './compliance-admin/exchange-rate-refresh';
import { automation as a23 } from './compliance-admin/license-cert-expiry';
import { automation as a24 } from './crm-sales/deal-followup-reminder';
import { automation as a25 } from './crm-sales/lead-aging-escalator';
import { automation as a26 } from './crm-sales/quote-expiry-reminder';
import { automation as a27 } from './crm-sales/stale-deal-flag';
import { automation as a28 } from './crm-sales/winloss-snapshot';
import { automation as a29 } from './expenses/duplicate-expense-detector';
import { automation as a30 } from './expenses/expense-approval-aging';
import { automation as a31 } from './expenses/expense-auto-categorizer';
import { automation as a32 } from './expenses/expense-policy-violation-flag';
import { automation as a33 } from './expenses/mileage-rate-refresh';
import { automation as a34 } from './expenses/receipt-missing-reminder';
import { automation as a35 } from './expenses/reimbursement-batch-builder';
import { automation as a36 } from './inventory/dead-stock-flag';
import { automation as a37 } from './inventory/expiring-lot-alert';
import { automation as a38 } from './inventory/inventory-valuation-snapshot';
import { automation as a39 } from './inventory/low-stock-reorder-alert';
import { automation as a40 } from './inventory/negative-stock-flag';
import { automation as a41 } from './invoicing/auto-late-fee';
import { automation as a42 } from './invoicing/credit-memo-auto-apply';
import { automation as a43 } from './invoicing/deposit-due-reminder';
import { automation as a44 } from './invoicing/dso-cache-refresh';
import { automation as a45 } from './invoicing/duplicate-invoice-detector';
import { automation as a46 } from './invoicing/invoice-overdue-escalator';
import { automation as a47 } from './invoicing/recurring-invoice-generator';
import { automation as a48 } from './invoicing/scheduled-invoice-sender';
import { automation as a49 } from './invoicing/tiny-balance-writeoff';
import { automation as a50 } from './payroll-hr/benefit-enrollment-window';
import { automation as a51 } from './payroll-hr/contractor-1099-reminder';
import { automation as a52 } from './payroll-hr/garnishment-order-monitor';
import { automation as a53 } from './payroll-hr/overtime-threshold-alert';
import { automation as a54 } from './payroll-hr/payroll-tax-deposit-alert';
import { automation as a55 } from './payroll-hr/pto-accrual-poster';
import { automation as a56 } from './payroll-hr/review-anniversary-reminder';
import { automation as a57 } from './payroll-hr/upcoming-payroll-reminder';
import { automation as a58 } from './projects-time/milestone-due-reminder';
import { automation as a59 } from './projects-time/project-budget-overrun-flag';
import { automation as a60 } from './projects-time/project-profitability-snapshot';
import { automation as a61 } from './projects-time/timesheet-approval-reminder';
import { automation as a62 } from './projects-time/unbilled-time-alert';
import { automation as a63 } from './reporting-finance/cash-forecast-refresh';
import { automation as a64 } from './reporting-finance/cash-position-snapshot';
import { automation as a65 } from './reporting-finance/financial-anomaly-detector';
import { automation as a66 } from './reporting-finance/financial-ratio-recompute';
import { automation as a67 } from './reporting-finance/kpi-scorecard-refresh';
import { automation as a68 } from './reporting-finance/monthly-financial-snapshot';
import { automation as a69 } from './tax/nexus-threshold-monitor';
import { automation as a70 } from './tax/quarterly-estimated-tax-reminder';
import { automation as a71 } from './tax/sales-tax-filing-reminder';
import { automation as a72 } from './tax/tax-rate-updater';
import { automation as a73 } from './tax/unremitted-tax-flag';
import { automation as a74 } from './tax/use-tax-accrual';

export const ALL_AUTOMATIONS: AutomationModule[] = [
  a0,
  a1,
  a2,
  a3,
  a4,
  a5,
  a6,
  a7,
  a8,
  a9,
  a10,
  a11,
  a12,
  a13,
  a14,
  a15,
  a16,
  a17,
  a18,
  a19,
  a20,
  a21,
  a22,
  a23,
  a24,
  a25,
  a26,
  a27,
  a28,
  a29,
  a30,
  a31,
  a32,
  a33,
  a34,
  a35,
  a36,
  a37,
  a38,
  a39,
  a40,
  a41,
  a42,
  a43,
  a44,
  a45,
  a46,
  a47,
  a48,
  a49,
  a50,
  a51,
  a52,
  a53,
  a54,
  a55,
  a56,
  a57,
  a58,
  a59,
  a60,
  a61,
  a62,
  a63,
  a64,
  a65,
  a66,
  a67,
  a68,
  a69,
  a70,
  a71,
  a72,
  a73,
  a74,
];

export function listAutomations() {
  return ALL_AUTOMATIONS.map((a) => ({ id: a.id, name: a.name, domain: a.domain, trigger: a.trigger }));
}

export function runAutomation(id: string, ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const a = ALL_AUTOMATIONS.find((x) => x.id === id);
  if (!a) return { ok: false, affected: 0, detail: 'Unknown automation: ' + id };
  try {
    return a.run(ctx);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: 'threw: ' + (err?.message || String(err)) };
  }
}

export interface BatchRunResult {
  trigger: AutomationTrigger;
  ran: number;
  okCount: number;
  totalAffected: number;
  results: Array<{ id: string; ok: boolean; affected: number; detail: string }>;
}

export function runAutomationsByTrigger(
  trigger: AutomationTrigger,
  ctx?: { todayISO?: string; companyId?: string }
): BatchRunResult {
  const out: BatchRunResult = { trigger, ran: 0, okCount: 0, totalAffected: 0, results: [] };
  for (const a of ALL_AUTOMATIONS) {
    if (a.trigger !== trigger) continue;
    out.ran++;
    let r: AutomationResult;
    try {
      r = a.run(ctx);
    } catch (err: any) {
      r = { ok: false, affected: 0, detail: 'threw: ' + (err?.message || String(err)) };
    }
    if (r.ok) out.okCount++;
    out.totalAffected += r.affected || 0;
    out.results.push({ id: a.id, ok: r.ok, affected: r.affected || 0, detail: r.detail });
  }
  return out;
}
