// src/main/ipc/payroll-wave.ts
//
// Payroll Wave (F641-F740) — 100+ thin `payroll:*` IPC handlers that delegate
// to services/payroll-deep-features. Extracted from the ipc/index.ts monolith
// and registered via registerPayrollWaveIpc(ipcMain).
//
// NOTE: other payroll:* handlers (process, edit, ytd-totals, pto-*, ...) still
// live in ipc/index.ts; this module owns only the pay-run-engine wave.

import { IpcMain } from 'electron';

export function registerPayrollWaveIpc(ipcMain: IpcMain): void {
  // ─── Payroll Wave (F641-F740) — 100 handlers under `payroll:*` ──
  const pdf = () => require('../services/payroll-deep-features');
  // Batch PA: Pay Run Engine
  ipcMain.handle('payroll:create-period', (_e, p: any) => pdf().createPayPeriod(p));
  ipcMain.handle('payroll:list-periods', (_e, p: any = {}) => pdf().listPayPeriods(p));
  ipcMain.handle('payroll:create-run', (_e, p: any) => pdf().createPayRun(p));
  ipcMain.handle('payroll:add-item', (_e, p: any) => pdf().addPayRunItem(p));
  ipcMain.handle('payroll:calc-gross', (_e, { id }: any) => pdf().calculateGrossPay(id));
  ipcMain.handle('payroll:calc-taxes', (_e, { id }: any) => pdf().calculateAllTaxes(id));
  ipcMain.handle('payroll:calc-net', (_e, { id }: any) => pdf().calculateNetPay(id));
  ipcMain.handle('payroll:post-run', (_e, { id }: any) => pdf().postPayRun(id));
  ipcMain.handle('payroll:void-run', (_e, { id, reason }: any) => pdf().voidPayRun(id, reason));
  ipcMain.handle('payroll:reverse-item', (_e, { id, reason }: any) => pdf().reversePayRunItem(id, reason));
  // Batch PB: Withholding & Tax Tables
  ipcMain.handle('payroll:seed-fed-tables', (_e, { year }: any) => pdf().seedFederalTaxTables(year));
  ipcMain.handle('payroll:calc-fed-wh', (_e, { employee_id, period_taxable, year, filing_status }: any) => pdf().calculateFederalWithholding(employee_id, period_taxable, year, filing_status));
  ipcMain.handle('payroll:set-suta-rate', (_e, p: any) => pdf().setStateSutaRate(p));
  ipcMain.handle('payroll:calc-suta', (_e, { id, state_code }: any) => pdf().calculateSuta(id, state_code));
  ipcMain.handle('payroll:upsert-w4', (_e, p: any) => pdf().upsertEmployeeW4(p));
  ipcMain.handle('payroll:supplemental-rate', (_e, { amount, rate }: any) => pdf().applySupplementalRate(amount, rate));
  ipcMain.handle('payroll:calc-sdi', (_e, { id, state_code, rate, wage_cap }: any) => pdf().calculateSdi(id, state_code, rate, wage_cap));
  ipcMain.handle('payroll:run-tax-liability', (_e, { id }: any) => pdf().payRunTaxLiability(id));
  ipcMain.handle('payroll:ytd-withholding', (_e, { employee_id, year }: any) => pdf().ytdWithholdingForEmployee(employee_id, year));
  ipcMain.handle('payroll:recalc-all', (_e, { id }: any) => pdf().recalculateAllTaxes(id));
  // Batch PC: Benefits & Deductions
  ipcMain.handle('payroll:benefit:create', (_e, p: any) => pdf().createBenefitPlan(p));
  ipcMain.handle('payroll:benefit:enroll', (_e, p: any) => pdf().enrollInBenefit(p));
  ipcMain.handle('payroll:deduction:add', (_e, p: any) => pdf().addDeduction(p));
  ipcMain.handle('payroll:deduction:apply', (_e, { id }: any) => pdf().applyDeductions(id));
  ipcMain.handle('payroll:benefit:apply', (_e, { id }: any) => pdf().applyBenefitDeductions(id));
  ipcMain.handle('payroll:retirement:setup', (_e, p: any) => pdf().setupRetirementContribution(p));
  ipcMain.handle('payroll:retirement:calc-401k', (_e, { id }: any) => pdf().calculate401kContribution(id));
  ipcMain.handle('payroll:hsa-fsa:setup', (_e, p: any) => pdf().setupHsaFsa(p));
  ipcMain.handle('payroll:advance:create', (_e, p: any) => pdf().createPayAdvance(p));
  ipcMain.handle('payroll:advance:process-repayment', (_e, { advance_id, pay_run_item_id }: any) => pdf().processPayAdvanceRepayment(advance_id, pay_run_item_id));
  // Batch PD: Garnishments
  ipcMain.handle('payroll:garn:create', (_e, p: any) => pdf().createGarnishment(p));
  ipcMain.handle('payroll:cs:create', (_e, p: any) => pdf().createChildSupportOrder(p));
  ipcMain.handle('payroll:garn:apply', (_e, { id }: any) => pdf().applyGarnishments(id));
  ipcMain.handle('payroll:garn:active', (_e, { employee_id }: any) => pdf().listActiveGarnishments(employee_id));
  ipcMain.handle('payroll:garn:satisfy', (_e, { id, payoff_date }: any) => pdf().satisfyGarnishment(id, payoff_date));
  ipcMain.handle('payroll:cs:release', (_e, { id, release_date }: any) => pdf().releaseChildSupport(id, release_date));
  ipcMain.handle('payroll:garn:remittance', (_e, { year, payee_type }: any) => pdf().garnishmentRemittanceReport(year, payee_type));
  ipcMain.handle('payroll:ccpa:max', (_e, { id, supports_family, supports_child_only }: any) => pdf().ccpaMaxGarnishable(id, supports_family, supports_child_only));
  ipcMain.handle('payroll:new-hire:report', (_e, { new_hires }: any) => pdf().generateNewHireReport(new_hires || []));
  ipcMain.handle('payroll:garn:fee', (_e, { id, fee }: any) => pdf().addGarnishmentFee(id, fee));
  // Batch PE: Time-Off
  ipcMain.handle('payroll:tor:create-accrual', (_e, p: any) => pdf().createTimeOffAccrual(p));
  ipcMain.handle('payroll:tor:accrue', (_e, { employee_id, hours_worked }: any) => pdf().accrueTimeOff(employee_id, hours_worked));
  ipcMain.handle('payroll:tor:request', (_e, p: any) => pdf().requestTimeOff(p));
  ipcMain.handle('payroll:tor:decide', (_e, { id, approve, approver_id }: any) => pdf().decideTimeOffRequest(id, approve, approver_id));
  ipcMain.handle('payroll:tor:balances', (_e, { employee_id }: any) => pdf().getTimeOffBalances(employee_id));
  ipcMain.handle('payroll:tor:carryover', (_e, { year }: any) => pdf().timeOffYearEndCarryover(year));
  ipcMain.handle('payroll:tor:calendar', (_e, { range_start, range_end }: any) => pdf().timeOffCalendar(range_start, range_end));
  ipcMain.handle('payroll:tor:cash-out', (_e, { employee_id, hourly_rate }: any) => pdf().ptoCashOut(employee_id, hourly_rate));
  ipcMain.handle('payroll:holiday:create-rule', (_e, p: any) => pdf().createHolidayPayRule(p));
  ipcMain.handle('payroll:ot:create-rule', (_e, p: any) => pdf().createOvertimeRule(p));
  // Batch PF: Direct Deposit
  ipcMain.handle('payroll:dd:add', (_e, p: any) => pdf().addDirectDepositAccount(p));
  ipcMain.handle('payroll:dd:allocate', (_e, { employee_id, net_pay }: any) => pdf().allocateNetPayToAccounts(employee_id, net_pay));
  ipcMain.handle('payroll:ach:build', (_e, { pay_run_id }: any) => pdf().buildAchBatch(pay_run_id));
  ipcMain.handle('payroll:check:create-run', (_e, p: any) => pdf().createCheckPrintRun(p));
  ipcMain.handle('payroll:check:mark-printed', (_e, { id }: any) => pdf().markCheckRunPrinted(id));
  ipcMain.handle('payroll:check:void', (_e, { id, reason }: any) => pdf().voidCheck(id, reason));
  ipcMain.handle('payroll:dd:prenote', (_e, { account_id }: any) => pdf().sendPrenoteForAccount(account_id));
  ipcMain.handle('payroll:dd:unverified', () => pdf().listUnverifiedAccounts());
  ipcMain.handle('payroll:paycard:load', (_e, { employee_id, amount }: any) => pdf().loadPayCard(employee_id, amount));
  ipcMain.handle('payroll:employee:update-pay-method', (_e, { id, pay_method }: any) => pdf().updateEmployeePayMethod(id, pay_method));
  // Batch PG: Contractors
  ipcMain.handle('payroll:contractor:create-run', (_e, p: any) => pdf().createContractorPayRun(p));
  ipcMain.handle('payroll:contractor:add-item', (_e, p: any) => pdf().addContractorPayItem(p));
  ipcMain.handle('payroll:contractor:post', (_e, { id }: any) => pdf().postContractorPayRun(id));
  ipcMain.handle('payroll:contractor:ytd', (_e, { year }: any) => pdf().contractorYtdTotals(year));
  ipcMain.handle('payroll:1099:flag-required', (_e, { year }: any) => pdf().flag1099Required(year));
  ipcMain.handle('payroll:1099:generate', (_e, { year }: any) => pdf().generate1099NecFilings(year));
  ipcMain.handle('payroll:backup-wh:apply', (_e, { vendor_id, amount }: any) => pdf().applyBackupWithholding(vendor_id, amount));
  ipcMain.handle('payroll:contractor:history', (_e, { vendor_id, year }: any) => pdf().contractorPaymentHistory(vendor_id, year));
  ipcMain.handle('payroll:1099:update-wh', (_e, { id, federal, state }: any) => pdf().update1099Withholding(id, federal, state));
  ipcMain.handle('payroll:1099:transmitted', (_e, { id }: any) => pdf().markFiling1099Transmitted(id));
  // Batch PH: Year-End
  ipcMain.handle('payroll:w2:generate-one', (_e, { employee_id, year }: any) => pdf().generateW2ForEmployee(employee_id, year));
  ipcMain.handle('payroll:w2:generate-all', (_e, { year }: any) => pdf().generateAllW2s(year));
  ipcMain.handle('payroll:941:generate', (_e, { year, quarter }: any) => pdf().generate941(year, quarter));
  ipcMain.handle('payroll:941:record-deposit', (_e, p: any) => pdf().recordTaxDeposit(p));
  ipcMain.handle('payroll:940:generate', (_e, { year }: any) => pdf().generate940(year));
  ipcMain.handle('payroll:year-end:summary', (_e, { year }: any) => pdf().generateYearEndSummary(year));
  ipcMain.handle('payroll:w2:mark-filed', (_e, { id }: any) => pdf().markW2Filed(id));
  ipcMain.handle('payroll:941:mark-filed', (_e, { id }: any) => pdf().mark941Filed(id));
  ipcMain.handle('payroll:940:mark-filed', (_e, { id }: any) => pdf().mark940Filed(id));
  ipcMain.handle('payroll:filings:status', (_e, { year }: any) => pdf().yearEndFilingStatus(year));
  ipcMain.handle('payroll:w2:add-box12', (_e, { id, code, amount }: any) => pdf().addW2Box12Code(id, code, amount));
  // Batch PI: Multi-State
  ipcMain.handle('payroll:multi-state:set', (_e, p: any) => pdf().setMultiStateAllocation(p));
  ipcMain.handle('payroll:multi-state:calc', (_e, { id }: any) => pdf().calculateMultiStateWithholding(id));
  ipcMain.handle('payroll:reciprocity:apply', (_e, { employee_id, work_state }: any) => pdf().applyReciprocity(employee_id, work_state));
  ipcMain.handle('payroll:multi-state:quarterly', (_e, { year, quarter }: any) => pdf().multiStateQuarterlyTotals(year, quarter));
  ipcMain.handle('payroll:state-q:create', (_e, p: any) => pdf().createStateQuarterlyFiling(p));
  ipcMain.handle('payroll:state-q:mark-filed', (_e, { id }: any) => pdf().markStateQuarterlyFiled(id));
  ipcMain.handle('payroll:nexus:list', () => pdf().listNexusStates());
  ipcMain.handle('payroll:multi-state:end', (_e, { id, end_date }: any) => pdf().endStateAllocation(id, end_date));
  ipcMain.handle('payroll:local-wh:calc', (_e, { id, locality, rate }: any) => pdf().calculateLocalWithholding(id, locality, rate));
  ipcMain.handle('payroll:sui:review', () => pdf().reviewSuiRates());
  // Batch PJ: Workers Comp & ACA
  ipcMain.handle('payroll:wc:add-class', (_e, p: any) => pdf().addWcClassification(p));
  ipcMain.handle('payroll:wc:assign', (_e, p: any) => pdf().assignWcClassification(p));
  ipcMain.handle('payroll:wc:calc-premium', (_e, { id }: any) => pdf().calculateWcPremium(id));
  ipcMain.handle('payroll:wc:summary', (_e, { range_start, range_end }: any) => pdf().wcPremiumSummary(range_start, range_end));
  ipcMain.handle('payroll:aca:record', (_e, p: any) => pdf().recordAcaMonth(p));
  ipcMain.handle('payroll:aca:readiness', (_e, { year }: any) => pdf().aca1095cReadiness(year));
  ipcMain.handle('payroll:cobra:record', (_e, p: any) => pdf().recordCobraEvent(p));
  ipcMain.handle('payroll:life-event:record', (_e, p: any) => pdf().recordLifeEvent(p));
  ipcMain.handle('payroll:comp-change:record', (_e, p: any) => pdf().recordCompensationChange(p));
  ipcMain.handle('payroll:dashboard:summary', (_e, { year }: any) => pdf().payrollDashboardSummary(year));
}
