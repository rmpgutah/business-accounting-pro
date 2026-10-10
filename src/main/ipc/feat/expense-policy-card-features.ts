import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EXPENSE_POLICY_CARD_FEAT: Record<string, FeatSpec<any>> = {
  'feat:exp-policy:upsert': {
    call: (s, p: any, { cid }) => s.upsertExpensePolicy({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:exp-policy:list': {
    call: (s, opts: any = {}, { cid }) => s.listExpensePolicies(cid!, opts),
    requiresCompany: [],
  },
  'feat:exp-policy:evaluate': {
    call: (s, opts: any, { cid }) => s.evaluatePolicies({ ...opts, company_id: cid }),
  },
  'feat:exp-policy:ack-violation': {
    call: (s, { id, user_id }: any) => ({ ok: s.acknowledgeViolation(id, user_id) }),
    mutates: true,
  },
  'feat:exp-policy:violations': {
    call: (s, opts: any = {}, { cid }) => s.listPolicyViolations(cid!, opts),
    requiresCompany: [],
  },
  'feat:irs-rate:upsert': { call: (s, opts: any) => s.upsertIRSRate(opts), mutates: true },
  'feat:irs-rate:current': { call: (s, { tax_year }: any = {}) => s.getCurrentIRSRate(tax_year) },
  'feat:travel-cap:upsert': {
    call: (s, c: any, { cid }) => s.upsertTravelCap({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:travel-cap:list': {
    call: (s, _p: any, { cid }) => s.listTravelCaps(cid!),
    requiresCompany: [],
  },
  'feat:exp-violations:by-employee': {
    call: (s, { employee_id, months_back }: any, { cid }) =>
      s.violationsByEmployee(cid!, employee_id, months_back),
    requiresCompany: [],
  },
  'feat:exp-tpl:save': {
    call: (s, t: any, { cid }) => s.saveExpenseTemplate({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:exp-tpl:list': {
    call: (s, { user_id }: any = {}, { cid }) => s.listExpenseTemplates(cid!, user_id),
    requiresCompany: [],
  },
  'feat:exp-tpl:use': { call: (s, { id }: any) => s.useTemplate(id) },
  'feat:exp-tpl:suggested': {
    call: (s, { user_id }: any, { cid }) => s.suggestedTemplates(cid!, user_id),
    requiresCompany: [],
  },
  'feat:sub-detect:scan': {
    call: (s, { lookback_days }: any = {}, { cid }) =>
      s.detectSubscriptions(cid!, lookback_days || 180),
    mutates: true,
    requiresCompany: null,
  },
  'feat:sub-detect:summary': {
    call: (s, _p: any, { cid }) => s.subscriptionAnnualSummary(cid!),
    requiresCompany: null,
  },
  'feat:sub-detect:confirm': {
    call: (s, { id, confirmed }: any) => ({ ok: s.confirmSubscription(id, confirmed) }),
  },
  'feat:sub-detect:cancel': { call: (s, { id }: any) => ({ ok: s.cancelSubscription(id) }) },
  'feat:auto-tag:upsert': {
    call: (s, r: any, { cid }) => s.upsertAutoTagRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:auto-tag:apply': {
    call: (s, opts: any, { cid }) => s.applyAutoTagRules({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:auto-tag:list': {
    call: (s, _p: any, { cid }) => s.listAutoTagRules(cid!),
    requiresCompany: [],
  },
  'feat:corp-card:register': {
    call: (s, c: any, { cid }) => s.registerCorporateCard({ ...c, company_id: cid }),
  },
  'feat:corp-card:list': {
    call: (s, opts: any = {}, { cid }) => s.listCorporateCards(cid!, opts),
    requiresCompany: [],
  },
  'feat:card-tx:match': {
    call: (s, { card_tx_id, expense_id }: any) => ({
      ok: s.matchCardTransaction(card_tx_id, expense_id),
    }),
  },
  'feat:card-tx:import': {
    call: (s, opts: any, { cid }) => s.importCardTransactions({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:card-tx:spend-by-user': {
    call: (s, opts: any = {}, { cid }) => s.cardSpendByUser(cid!, opts),
    requiresCompany: [],
  },
  'feat:card-tx:unmatched': {
    call: (s, { limit }: any = {}, { cid }) => s.unmatchedCardTransactions(cid!, limit),
    requiresCompany: [],
  },
  'feat:card-tx:dispute': {
    call: (s, opts: any, { cid }) => s.disputeCardTransaction({ ...opts, company_id: cid }),
  },
  'feat:card-tx:spend-by-merchant': {
    call: (s, opts: any = {}, { cid }) => s.cardSpendByMerchant(cid!, opts),
    requiresCompany: [],
  },
  'feat:card-tx:reconcile': { call: (s, { card_id }: any) => s.reconcileCard(card_id) },
  'feat:card-rule:upsert': {
    call: (s, r: any, { cid }) => s.upsertCardSpendRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:trip:create': {
    call: (s, t: any, { cid }) => s.createTrip({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:trip:add-expense': {
    call: (s, { expense_id, trip_id }: any) => ({ ok: s.addExpenseToTrip(expense_id, trip_id) }),
    mutates: true,
  },
  'feat:trip:days': { call: (s, { trip_id }: any) => s.tripDays(trip_id) },
  'feat:trip:apply-perdiem': { call: (s, opts: any) => s.applyTripPerDiem(opts), mutates: true },
  'feat:trip:add-itinerary': { call: (s, leg: any) => s.addItineraryLeg(leg), mutates: true },
  'feat:trip:itinerary': { call: (s, { trip_id }: any) => s.tripItinerary(trip_id) },
  'feat:trip:preapprove': {
    call: (s, { trip_id, approved_by }: any) => ({ ok: s.preApproveTrip(trip_id, approved_by) }),
  },
  'feat:trip:cost-summary': { call: (s, { trip_id }: any) => s.tripCostSummary(trip_id) },
  'feat:trip:list': {
    call: (s, opts: any = {}, { cid }) => s.listTrips(cid!, opts),
    requiresCompany: [],
  },
  'feat:mileage-state:upsert': {
    call: (s, opts: any) => s.upsertStateMileageRate(opts),
    mutates: true,
  },
  'feat:mileage-route:create': {
    call: (s, r: any, { cid }) => s.createMileageRoute({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:mileage-route:stops': { call: (s, { route_id }: any) => s.getRouteStops(route_id) },
  'feat:mileage:split': { call: (s, opts: any) => s.splitMileage(opts) },
  'feat:vehicle-dep:upsert': {
    call: (s, v: any, { cid }) => s.upsertVehicleDepreciation({ ...v, company_id: cid }),
    mutates: true,
  },
  'feat:vehicle-maint:log': {
    call: (s, m: any, { cid }) => s.logVehicleMaintenance({ ...m, company_id: cid }),
    mutates: true,
  },
  'feat:vehicle-maint:list': {
    call: (s, { vehicle_id }: any) => s.listVehicleMaintenance(vehicle_id),
  },
  'feat:vehicle-maint:due': {
    call: (s, { days_ahead }: any = {}, { cid }) =>
      s.upcomingMaintenanceDue(cid!, days_ahead || 60),
    requiresCompany: [],
  },
  'feat:vehicle:set-mileage-method': {
    call: (s, { vehicle_id, method }: any) => ({ ok: s.setMileageMethod(vehicle_id, method) }),
    mutates: true,
  },
  'feat:mileage-route:add-stop': { call: (svc, s: any) => svc.addRouteStop(s), mutates: true },
};

export function registerExpensePolicyCardFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('expense-policy-card-features'), EXPENSE_POLICY_CARD_FEAT);
}
