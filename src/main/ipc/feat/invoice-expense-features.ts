import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const INVOICE_EXPENSE_FEAT: Record<string, FeatSpec<any>> = {
  'feat:invoice:late-fee:compute': {
    call: (s, { invoice_id }: any) => s.computeLateFee(invoice_id),
  },
  'feat:invoice:late-fee:apply': {
    call: (s, { invoice_id }: any) => s.applyLateFee(invoice_id),
    mutates: true,
  },
  'feat:invoice:reminders:schedule': {
    call: (s, { invoice_id, days }: any) => ({
      scheduled: s.scheduleInvoiceReminders(invoice_id, days || [7, 14, 30]),
    }),
    mutates: true,
  },
  'feat:invoice:reminders:pending': {
    call: (s, { as_of }: any = {}) => s.pendingReminders(as_of),
  },
  'feat:invoice:reminders:mark-sent': {
    call: (s, { id }: any) => ({ ok: s.markReminderSent(id) }),
    mutates: true,
  },
  'feat:invoice:recalc-payment-state': {
    call: (s, { invoice_id }: any) => s.recalcInvoicePaymentState(invoice_id),
    mutates: true,
  },
  'feat:credit-memo:create': {
    call: (s, memo: any, { cid }) => s.createCreditMemo({ ...memo, company_id: cid }),
    mutates: true,
  },
  'feat:credit-memo:apply': {
    call: (s, { memo_id, invoice_id, amount }: any) =>
      s.applyCreditMemo(memo_id, invoice_id, amount),
    mutates: true,
  },
  'feat:credit-memo:list': {
    call: (s, { client_id }: any = {}, { cid }) => s.listCreditMemos(cid!, client_id),
    requiresCompany: [],
  },
  'feat:invoice:batch-send:candidates': {
    call: (s, opts: any, { cid }) => s.getBatchSendCandidates(cid!, opts),
    requiresCompany: [],
  },
  'feat:invoice:templates:list': {
    call: (s, _p: any, { cid }) => s.listInvoiceTemplates(cid!),
    requiresCompany: [],
  },
  'feat:invoice:templates:upsert': {
    call: (s, t: any, { cid }) => s.upsertInvoiceTemplate({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:invoice:exchange-rate': {
    call: (s, { invoice_id, rate }: any) => ({ ok: s.setInvoiceExchangeRate(invoice_id, rate) }),
    mutates: true,
  },
  'feat:invoice:deposit': {
    call: (s, { invoice_id, amount, due_date }: any) => ({
      ok: s.setInvoiceDeposit(invoice_id, amount, due_date),
    }),
    mutates: true,
  },
  'feat:budget-alert:upsert': {
    call: (s, record: any, { cid }) => s.upsertBudgetAlert({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:budget-alert:check': {
    call: (s, _p: any, { cid }) => s.checkBudgetAlerts(cid!),
    requiresCompany: [],
  },
  'feat:vendor:suggest': {
    call: (s, { prefix, limit }: any = {}, { cid }) => s.suggestVendors(cid!, prefix, limit),
    requiresCompany: [],
  },
  'feat:expense:split:create': {
    call: (s, { expense_id, splits }: any) => s.createExpenseSplit(expense_id, splits),
    mutates: true,
  },
  'feat:expense:split:get': { call: (s, { expense_id }: any) => s.getExpenseSplits(expense_id) },
  'feat:reimbursement:create': {
    call: (s, record: any, { cid }) => s.createReimbursement({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:reimbursement:approve': {
    call: (s, { id, approved_by }: any) => ({ ok: s.approveReimbursement(id, approved_by) }),
    mutates: true,
  },
  'feat:reimbursement:reject': {
    call: (s, { id, reason }: any) => ({ ok: s.rejectReimbursement(id, reason) }),
    mutates: true,
  },
  'feat:reimbursement:pay': {
    call: (s, { id, method }: any) => ({ ok: s.payReimbursement(id, method) }),
    mutates: true,
  },
  'feat:reimbursement:list': {
    call: (s, { status }: any = {}, { cid }) => s.listReimbursements(cid!, status),
    requiresCompany: [],
  },
  'feat:per-diem:upsert': {
    call: (s, record: any, { cid }) => s.upsertPerDiemRate({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:per-diem:lookup': {
    call: (s, { city, state, year }: any, { cid }) => s.lookupPerDiem(cid!, city, state, year),
    requiresCompany: null,
  },
  'feat:expense:report': {
    call: (s, opts: any, { cid }) => s.buildExpenseReport(cid!, opts),
    requiresCompany: null,
  },
  'feat:expense:duplicates': {
    call: (s, { expense, days_window }: any, { cid }) =>
      s.findExpenseDuplicates(cid!, expense, days_window),
    requiresCompany: [],
  },
};

export function registerInvoiceExpenseFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('invoice-expense-features'), INVOICE_EXPENSE_FEAT);
}
