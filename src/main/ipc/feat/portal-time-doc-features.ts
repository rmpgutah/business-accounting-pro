import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PORTAL_TIME_DOC_FEAT: Record<string, FeatSpec<any>> = {
  'feat:portal-cust:invite': {
    call: (s, opts: any, { cid }) => s.inviteCustomerPortalUser({ ...opts, company_id: cid }),
  },
  'feat:portal:activate': {
    call: (s, { token, password }: any) => s.activatePortalUser(token, password),
  },
  'feat:portal:auth': {
    call: (s, { email, password, company_id, portal_type }: any) =>
      s.authPortalUser(email, password, company_id, portal_type),
  },
  'feat:portal:invoices': { call: (s, { customer_id }: any) => s.listPortalInvoices(customer_id) },
  'feat:portal-pay:record': {
    call: (s, opts: any, { cid }) => s.recordPortalPayment({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:portal-pay:history': {
    call: (s, { portal_user_id, limit }: any) => s.listPortalPaymentHistory(portal_user_id, limit),
  },
  'feat:portal:statement': {
    call: (s, { customer_id, period_start, period_end }: any, { cid }) =>
      s.generateCustomerStatement(cid!, customer_id, period_start, period_end),
    requiresCompany: null,
  },
  'feat:portal-ticket:create': {
    call: (s, t: any, { cid }) => s.createSupportTicket({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:portal-ticket:list': {
    call: (s, opts: any = {}, { cid }) => s.listSupportTickets(cid!, opts),
    requiresCompany: [],
  },
  'feat:portal-doc:upload': {
    call: (s, d: any, { cid }) => s.uploadPortalDocument({ ...d, company_id: cid }),
  },
  'feat:auto-pay:enroll': {
    call: (s, opts: any, { cid }) => s.enrollAutoPay({ ...opts, company_id: cid }),
  },
  'feat:auto-pay:cancel': {
    call: (s, { customer_id }: any, { cid }) => ({ ok: s.cancelAutoPay(cid!, customer_id) }),
    requiresCompany: false,
  },
  'feat:portal-brand:set': {
    call: (s, b: any, { cid }) => s.setPortalBranding({ ...b, company_id: cid }),
    mutates: true,
  },
  'feat:portal-brand:get': {
    call: (s, _p: any, { cid }) => s.getPortalBranding(cid!),
    requiresCompany: null,
  },
  'feat:portal-vend:invite': {
    call: (s, opts: any, { cid }) => s.inviteVendorPortalUser({ ...opts, company_id: cid }),
  },
  'feat:vendor-po:respond': {
    call: (s, opts: any, { cid }) => s.respondToPO({ ...opts, company_id: cid }),
  },
  'feat:vendor-po:list-responses': {
    call: (s, { po_id }: any = {}, { cid }) => s.listPORResponses(cid!, po_id),
    requiresCompany: [],
  },
  'feat:vendor-inv:submit': {
    call: (s, v: any, { cid }) => s.submitVendorInvoice({ ...v, company_id: cid }),
    mutates: true,
  },
  'feat:vendor-inv:review': {
    call: (s, { id, status, reviewed_by, rejection_reason, matched_bill_id }: any) => ({
      ok: s.reviewVendorInvoice(id, status, reviewed_by, rejection_reason, matched_bill_id),
    }),
  },
  'feat:vendor-inv:list': {
    call: (s, opts: any = {}, { cid }) => s.listVendorInvoiceSubmissions(cid!, opts),
    requiresCompany: [],
  },
  'feat:vendor-pay:status': {
    call: (s, { vendor_id }: any, { cid }) => s.vendorPaymentStatus(cid!, vendor_id),
    requiresCompany: null,
  },
  'feat:vendor-ach:submit': {
    call: (s, opts: any, { cid }) => s.submitACHUpdate({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:vendor-ach:approve': {
    call: (s, { id, approved_by }: any) => ({ ok: s.approveACHUpdate(id, approved_by) }),
    mutates: true,
  },
  'feat:vendor-ach:reject': {
    call: (s, { id, rejected_by }: any) => ({ ok: s.rejectACHUpdate(id, rejected_by) }),
  },
  'feat:vendor-ach:list': {
    call: (s, opts: any = {}, { cid }) => s.listACHUpdates(cid!, opts),
    requiresCompany: [],
  },
  'feat:vendor-1099:download': {
    call: (s, opts: any, { cid }) => s.recordVendor1099Download({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:vendor-attest:submit': {
    call: (s, opts: any, { cid }) => s.submitComplianceAttestation({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:timer:start': {
    call: (s, opts: any, { cid }) => s.startTimer({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:timer:pause': { call: (s, { id }: any) => ({ ok: s.pauseTimer(id) }) },
  'feat:timer:resume': { call: (s, { id }: any) => ({ ok: s.resumeTimer(id) }) },
  'feat:timer:stop': { call: (s, { id }: any) => s.stopTimer(id) },
  'feat:timer:running': { call: (s, { user_id }: any) => s.getRunningTimer(user_id) },
  'feat:rate:upsert': {
    call: (s, r: any, { cid }) => s.upsertBillableRate({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:rate:effective': {
    call: (s, opts: any, { cid }) => s.getEffectiveRate({ ...opts, company_id: cid }),
  },
  'feat:ot:upsert': {
    call: (s, r: any, { cid }) => s.upsertOvertimeRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:ot:calc': {
    call: (s, opts: any, { cid }) => s.calcOvertime({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:proj-time-budget:upsert': {
    call: (s, b: any, { cid }) => s.upsertProjectTimeBudget({ ...b, company_id: cid }),
    mutates: true,
  },
  'feat:proj-time-budget:add-hours': {
    call: (s, { project_id, hours }: any) => s.updateConsumedHours(project_id, hours),
    mutates: true,
  },
  'feat:cal-event:sync': { call: (s, e: any) => s.syncCalendarEvent(e) },
  'feat:cal-event:to-time-entry': {
    call: (s, { event_id, project_id, task_id }: any) =>
      s.convertCalendarToTimeEntry(event_id, project_id, task_id),
  },
  'feat:time:round': {
    call: (s, { minutes, interval_minutes, method }: any) =>
      s.applyRounding(minutes, interval_minutes, method),
  },
  'feat:doc:classify': { call: (s, { text }: any) => s.classifyDocument(text) },
  'feat:doc:record-classify': {
    call: (s, opts: any, { cid }) => s.recordClassification({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:doc-field:extract': {
    call: (s, { document_id, field_name, field_value, confidence, method }: any) =>
      s.extractField(document_id, field_name, field_value, confidence, method),
  },
  'feat:doc-field:list': { call: (s, { document_id }: any) => s.getExtractedFields(document_id) },
  'feat:bank-stmt:parse': { call: (s, { text }: any) => s.parseBankStatementCSV(text) },
  'feat:bank-stmt:import': {
    call: (s, opts: any, { cid }) => s.recordBankStatementImport({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:clauses:detect': {
    call: (s, { text, document_id }: any, { cid }) =>
      s.detectContractClauses(text, document_id, cid!),
    requiresCompany: { detected: 0 },
  },
  'feat:clauses:list': { call: (s, { document_id }: any) => s.listContractClauses(document_id) },
  'feat:sign-flow:start': {
    call: (s, opts: any, { cid }) => s.startSigningWorkflow({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:sign-flow:advance': {
    call: (s, { workflow_id }: any) => s.advanceSigningWorkflow(workflow_id),
    mutates: true,
  },
  'feat:doc-expire:list': {
    call: (s, { days_ahead }: any = {}, { cid }) => s.findExpiringDocuments(cid!, days_ahead || 30),
    requiresCompany: [],
  },
  'feat:retention:upsert-policy': {
    call: (s, p: any, { cid }) => s.upsertRetentionPolicy({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:retention:exceeding': {
    call: (s, _p: any, { cid }) => s.findDocsExceedingRetention(cid!),
    requiresCompany: [],
  },
};

export function registerPortalTimeDocFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('portal-time-doc-features'), PORTAL_TIME_DOC_FEAT);
}
