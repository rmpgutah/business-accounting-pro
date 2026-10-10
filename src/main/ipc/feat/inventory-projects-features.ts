import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const INVENTORY_PROJECTS_FEAT: Record<string, FeatSpec<any>> = {
  'feat:warehouse:upsert': {
    call: (s, w: any, { cid }) => s.upsertWarehouse({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:warehouse:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listWarehouses(cid!, !!active_only),
    requiresCompany: [],
  },
  'feat:location:upsert': {
    call: (s, l: any, { cid }) => s.upsertLocation({ ...l, company_id: cid }),
    mutates: true,
  },
  'feat:location:list': { call: (s, { warehouse_id }: any) => s.listLocations(warehouse_id) },
  'feat:lot:upsert': {
    call: (s, l: any, { cid }) => s.upsertLot({ ...l, company_id: cid }),
    mutates: true,
  },
  'feat:lot:list': {
    call: (s, opts: any = {}, { cid }) => s.listLots(cid!, opts),
    requiresCompany: [],
  },
  'feat:serial:upsert': {
    call: (svc, s, { cid }) => svc.upsertSerial({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:serial:list': {
    call: (s, opts: any = {}, { cid }) => s.listSerials(cid!, opts),
    requiresCompany: [],
  },
  'feat:transfer:create': {
    call: (s, t: any, { cid }) => s.createTransfer({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:transfer:ship': {
    call: (s, { id }: any) => ({ ok: s.markTransferShipped(id) }),
    mutates: true,
  },
  'feat:transfer:receive': {
    call: (s, { id }: any) => ({ ok: s.markTransferReceived(id) }),
    mutates: true,
  },
  'feat:transfer:list': {
    call: (s, opts: any = {}, { cid }) => s.listTransfers(cid!, opts),
    requiresCompany: [],
  },
  'feat:transfer:items': { call: (s, { transfer_id }: any) => s.getTransferItems(transfer_id) },
  'feat:adjustment:create': {
    call: (s, a: any, { cid }) => s.createAdjustment({ ...a, company_id: cid }),
    mutates: true,
  },
  'feat:adjustment:approve': {
    call: (s, { id, approved_by }: any) => ({ ok: s.approveAdjustment(id, approved_by) }),
    mutates: true,
  },
  'feat:adjustment:list': {
    call: (s, opts: any = {}, { cid }) => s.listAdjustments(cid!, opts),
    requiresCompany: [],
  },
  'feat:stock-take:start': {
    call: (svc, s, { cid }) => svc.startStockTake({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:stock-take:count': {
    call: (s, { session_id, ...count }: any) => s.recordCount(session_id, count),
    mutates: true,
  },
  'feat:stock-take:complete': {
    call: (s, { session_id }: any) => s.completeStockTake(session_id),
    mutates: true,
  },
  'feat:stock-take:list': {
    call: (s, opts: any = {}, { cid }) => s.listStockTakes(cid!, opts),
    requiresCompany: [],
  },
  'feat:stock-take:counts': {
    call: (s, { session_id }: any) => s.getStockTakeCounts(session_id),
  },
  'feat:low-stock:scan': {
    call: (s, _p: any, { cid }) => s.scanLowStock(cid!),
    mutates: true,
    requiresCompany: null,
  },
  'feat:low-stock:list': {
    call: (s, opts: any = {}, { cid }) => s.listLowStockAlerts(cid!, opts),
    requiresCompany: [],
  },
  'feat:low-stock:ack': {
    call: (s, { id, acknowledged_by }: any) => ({ ok: s.acknowledgeAlert(id, acknowledged_by) }),
    mutates: true,
  },
  'feat:valuation:set-method': {
    call: (s, { method }: any, { cid }) => ({ ok: s.setValuationMethod(cid!, method) }),
    mutates: true,
    requiresCompany: false,
  },
  'feat:valuation:get-method': {
    call: (s, _p: any, { cid }) => s.getValuationMethod(cid!),
    requiresCompany: 'average',
  },
  'feat:inv-value:capture': {
    call: (s, { snapshot_date }: any = {}, { cid }) =>
      s.captureInventoryValueSnapshot(cid!, snapshot_date),
    mutates: true,
    requiresCompany: null,
  },
  'feat:inv-value:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listInventoryValueHistory(cid!, limit),
    requiresCompany: [],
  },
  'feat:task:upsert': {
    call: (s, t: any, { cid }) => s.upsertTask({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:task:list': { call: (s, { project_id, ...opts }: any) => s.listTasks(project_id, opts) },
  'feat:task:complete': { call: (s, { id }: any) => ({ ok: s.completeTask(id) }), mutates: true },
  'feat:milestone:upsert': {
    call: (s, m: any, { cid }) => s.upsertMilestone({ ...m, company_id: cid }),
    mutates: true,
  },
  'feat:milestone:list': { call: (s, { project_id }: any) => s.listMilestones(project_id) },
  'feat:resource:upsert': {
    call: (s, r: any, { cid }) => s.upsertResource({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:resource:list': { call: (s, { project_id }: any) => s.listResources(project_id) },
  'feat:proj-budget:upsert': {
    call: (s, b: any, { cid }) => s.upsertProjectBudget({ ...b, company_id: cid }),
    mutates: true,
  },
  'feat:proj-budget:list': { call: (s, { project_id }: any) => s.listProjectBudgets(project_id) },
  'feat:risk:upsert': {
    call: (s, r: any, { cid }) => s.upsertRisk({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:risk:list': {
    call: (s, { project_id, open_only }: any) => s.listRisks(project_id, !!open_only),
  },
  'feat:co:upsert': {
    call: (s, co: any, { cid }) => s.upsertChangeOrder({ ...co, company_id: cid }),
    mutates: true,
  },
  'feat:co:approve': {
    call: (s, { id, approved_by }: any) => ({ ok: s.approveChangeOrder(id, approved_by) }),
    mutates: true,
  },
  'feat:co:list': {
    call: (s, { project_id, ...opts }: any) => s.listChangeOrders(project_id, opts),
  },
  'feat:timesheet:open': {
    call: (s, p: any, { cid }) => s.openTimesheetPeriod({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:timesheet:submit': {
    call: (s, { period_id }: any) => s.submitTimesheet(period_id),
    mutates: true,
  },
  'feat:timesheet:list': {
    call: (s, opts: any = {}, { cid }) => s.listTimesheetPeriods(cid!, opts),
    requiresCompany: [],
  },
  'feat:timesheet:approve': {
    call: (s, { period_id, approver_id, action, comment }: any) =>
      s.approveTimesheet(period_id, approver_id, action, comment),
    mutates: true,
  },
  'feat:timesheet:approvals': {
    call: (s, { period_id }: any) => s.getTimesheetApprovals(period_id),
  },
  'feat:billable-summary:rebuild': {
    call: (s, { period_start, period_end }: any, { cid }) =>
      s.rebuildBillableTimeSummary(cid!, period_start, period_end),
    mutates: true,
    requiresCompany: [],
  },
  'feat:billable-summary:get': {
    call: (s, opts: any = {}, { cid }) => s.getBillableTimeSummary(cid!, opts),
    requiresCompany: [],
  },
  'feat:profitability:capture': {
    call: (s, { project_id, snapshot_date }: any, { cid }) =>
      s.captureProjectProfitability(cid!, project_id, snapshot_date),
    mutates: true,
    requiresCompany: null,
  },
  'feat:profitability:list': {
    call: (s, opts: any = {}, { cid }) => s.listProfitabilitySnapshots(cid!, opts),
    requiresCompany: [],
  },
};

export function registerInventoryProjectsFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('inventory-projects-features'), INVENTORY_PROJECTS_FEAT);
}
