import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers } from '../core/featHandlers';
import { svc } from '../core/svc';

export function registerTreasuryFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('treasury-features'), {
    'feat:cash-position:capture': {
      call: (s, { snapshot_date }: any = {}, { cid }) => s.captureCashPosition(cid!, snapshot_date),
      mutates: true,
      requiresCompany: null,
    },
    'feat:cash-position:list': {
      call: (s, opts: any = {}, { cid }) => s.listCashPositionSnapshots(cid!, opts),
      requiresCompany: [],
    },
    'feat:cash-forecast:rebuild': {
      call: (s, { days_ahead }: any = {}, { cid }) => s.rebuildCashForecast(cid!, days_ahead || 90),
      mutates: true,
      requiresCompany: null,
    },
    'feat:cash-forecast:get': {
      call: (s, opts: any = {}, { cid }) => s.getCashForecast(cid!, opts),
      requiresCompany: [],
    },
    'feat:fx-rate:upsert': { call: (s, r: any) => s.upsertFxRate(r), mutates: true },
    'feat:fx-rate:get': {
      call: (s, { from, to, as_of_date }: any) => s.getFxRate(from, to, as_of_date),
    },
    'feat:fx-rate:list': { call: (s, opts: any = {}) => s.listFxRates(opts) },
    'feat:fx-revaluation:run': {
      call: (s, { as_of_date, created_by }: any = {}, { cid }) =>
        s.runFxRevaluation(cid!, as_of_date, created_by),
      mutates: true,
      requiresCompany: null,
    },
    'feat:fx-revaluation:list': {
      call: (s, { limit }: any = {}, { cid }) => s.listFxRevaluationRuns(cid!, limit),
      requiresCompany: [],
    },
    'feat:wire-transfer:upsert': {
      call: (s, w: any, { cid }) => s.upsertWireTransfer({ ...w, company_id: cid }),
      mutates: true,
    },
    'feat:wire-transfer:list': {
      call: (s, opts: any = {}, { cid }) => s.listWireTransfers(cid!, opts),
      requiresCompany: [],
    },
    'feat:ach-batch:create': {
      call: (s, b: any, { cid }) => s.createAchBatch({ ...b, company_id: cid }),
      mutates: true,
    },
    'feat:ach-batch:list': {
      call: (s, opts: any = {}, { cid }) => s.listAchBatches(cid!, opts),
      requiresCompany: [],
    },
    'feat:ach-batch:items': { call: (s, { batch_id }: any) => s.getAchBatchItems(batch_id) },
    'feat:ach-batch:mark-submitted': {
      call: (s, { batch_id, nacha_file_path }: any) => ({
        ok: s.markAchBatchSubmitted(batch_id, nacha_file_path),
      }),
      mutates: true,
    },
    'feat:bank-fee-cat:upsert': {
      call: (s, c: any, { cid }) => s.upsertBankFeeCategory({ ...c, company_id: cid }),
      mutates: true,
    },
    'feat:bank-fee-cat:list': {
      call: (s, _p: any, { cid }) => s.listBankFeeCategories(cid!),
      requiresCompany: [],
    },
    'feat:bank-fee-cat:suggest': {
      call: (s, { description }: any, { cid }) => s.suggestBankFeeCategory(cid!, description),
      requiresCompany: null,
    },
    'feat:bank-match:log': {
      call: (s, { transaction_id, candidate }: any, { cid }) => {
        s.logBankMatchAttempt(cid, transaction_id, candidate);
        return { ok: true };
      },
      mutates: true,
    },
    'feat:bank-match:list': {
      call: (s, { transaction_id, limit }: any = {}, { cid }) =>
        s.listBankMatchAttempts(cid!, transaction_id, limit),
      requiresCompany: [],
    },
    'feat:stop-payment:upsert': {
      call: (svc, s, { cid }) => svc.upsertStopPayment({ ...s, company_id: cid }),
      mutates: true,
    },
    'feat:stop-payment:list': {
      call: (s, opts: any = {}, { cid }) => s.listStopPayments(cid!, opts),
      requiresCompany: [],
    },
    'feat:pending-deposit:upsert': {
      call: (s, p: any, { cid }) => s.upsertPendingDeposit({ ...p, company_id: cid }),
      mutates: true,
    },
    'feat:pending-deposit:list': {
      call: (s, opts: any = {}, { cid }) => s.listPendingDeposits(cid!, opts),
      requiresCompany: [],
    },
    'feat:pending-deposit:float': {
      call: (s, _p: any, { cid }) => s.totalPendingFloat(cid!),
      requiresCompany: { total_pending: 0, count: 0 },
    },
    'feat:petty-cash:log': {
      call: (s, p: any, { cid }) => s.logPettyCash({ ...p, company_id: cid }),
      mutates: true,
    },
    'feat:petty-cash:list': {
      call: (s, { limit }: any = {}, { cid }) => s.listPettyCash(cid!, limit),
      requiresCompany: [],
    },
    'feat:petty-cash:balance': {
      call: (s, _p: any, { cid }) => s.pettyCashBalance(cid!),
      requiresCompany: 0,
    },
    'feat:treasury:upsert': {
      call: (s, t: any, { cid }) => s.upsertTreasuryInvestment({ ...t, company_id: cid }),
      mutates: true,
    },
    'feat:treasury:list': {
      call: (s, opts: any = {}, { cid }) => s.listTreasuryInvestments(cid!, opts),
      requiresCompany: [],
    },
    'feat:loc:upsert': {
      call: (s, lc: any, { cid }) => s.upsertLetterOfCredit({ ...lc, company_id: cid }),
      mutates: true,
    },
    'feat:loc:list': {
      call: (s, opts: any = {}, { cid }) => s.listLettersOfCredit(cid!, opts),
      requiresCompany: [],
    },
    'feat:covenant:upsert': {
      call: (s, c: any, { cid }) => s.upsertLoanCovenant({ ...c, company_id: cid }),
      mutates: true,
    },
    'feat:covenant:measure': {
      call: (s, { covenant_id, value }: any) => s.recordCovenantMeasurement(covenant_id, value),
      mutates: true,
    },
    'feat:covenant:list': {
      call: (s, opts: any = {}, { cid }) => s.listLoanCovenants(cid!, opts),
      requiresCompany: [],
    },
    'feat:sweep:upsert': {
      call: (svc, s, { cid }) => svc.upsertSweepRule({ ...s, company_id: cid }),
      mutates: true,
    },
    'feat:sweep:list': {
      call: (s, { active_only }: any = {}, { cid }) => s.listSweepRules(cid!, !!active_only),
      requiresCompany: [],
    },
    'feat:sweep:evaluate': {
      call: (s, _p: any, { cid }) => s.evaluateSweepRules(cid!),
      requiresCompany: [],
    },
    'feat:inter-co:record': { call: (s, t: any) => s.recordInterCompanyTransfer(t), mutates: true },
    'feat:inter-co:list': {
      call: (s, opts: any = {}, { cid }) =>
        s.listInterCompanyTransfers({ company_id: cid, ...opts }),
    },
    'feat:cc-stmt:upsert': {
      call: (svc, s, { cid }) => svc.upsertCreditCardStatement({ ...s, company_id: cid }),
      mutates: true,
    },
    'feat:cc-stmt:add-lines': {
      call: (s, { statement_id, lines }: any) => s.addStatementLines(statement_id, lines),
      mutates: true,
    },
    'feat:cc-stmt:list': {
      call: (s, opts: any = {}, { cid }) => s.listCreditCardStatements(cid!, opts),
      requiresCompany: [],
    },
    'feat:cc-stmt:lines': { call: (s, { statement_id }: any) => s.getStatementLines(statement_id) },
    'feat:lockbox:import': {
      call: (s, imp: any, { cid }) => s.importLockbox({ ...imp, company_id: cid }),
      mutates: true,
    },
    'feat:lockbox:list': {
      call: (s, { limit }: any = {}, { cid }) => s.listLockboxImports(cid!, limit),
      requiresCompany: [],
    },
    'feat:lockbox:items': { call: (s, { import_id }: any) => s.getLockboxItems(import_id) },
    'feat:positive-pay:generate': {
      call: (s, opts: any = {}, { cid }) => s.generatePositivePayFile(cid!, opts),
      requiresCompany: null,
    },
    'feat:positive-pay:list': {
      call: (s, { limit }: any = {}, { cid }) => s.listPositivePayFiles(cid!, limit),
      requiresCompany: [],
    },
    'feat:positive-pay:mark-submitted': {
      call: (s, { id }: any) => ({ ok: s.markPositivePayFileSubmitted(id) }),
      mutates: true,
    },
  });
}
