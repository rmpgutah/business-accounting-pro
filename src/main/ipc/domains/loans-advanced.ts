import type { IpcMain } from 'electron';
import * as db from '../../database';
import type { IpcDeps } from '../core/types';

export function registerLoansAdvancedIpc(ipcMain: IpcMain, _deps: IpcDeps): void {
  // ─── Loan Wave (F963-F992) — `la:*` namespace ──
  const la = () => require('../../services/loan-advanced-features');
  // Batch LA: Refinance & Modifications
  ipcMain.handle('la:refi:compare', (_e, p: any) => la().refinanceScenarioComparison(p));
  ipcMain.handle('la:refi:execute', (_e, p: any) => la().executeRefinance(p));
  ipcMain.handle('la:mod:apply', (_e, p: any) => la().applyLoanModification(p));
  ipcMain.handle('la:lump-principal', (_e, p: any) => la().lumpSumPrincipalPayment(p));
  ipcMain.handle('la:biweekly:impact', (_e, { loan_id }: any) =>
    la().biweeklyConversionImpact(loan_id),
  );
  // Batch LB: Collateral & Documents
  ipcMain.handle('la:collateral:attach', (_e, p: any) => la().attachCollateral(p));
  ipcMain.handle('la:doc:attach', (_e, p: any) => la().attachLoanDocument(p));
  ipcMain.handle('la:collateral:revalue', (_e, { id, new_value, appraisal_date }: any) =>
    la().revalueCollateral(id, new_value, appraisal_date),
  );
  ipcMain.handle('la:ltv', (_e, { loan_id }: any) => la().computeLtv(loan_id));
  ipcMain.handle('la:loans-by-asset', (_e, { asset_id }: any) =>
    la().loansSecuredByAsset(asset_id),
  );
  // Batch LC: Covenants & Compliance
  ipcMain.handle('la:covenant:create', (_e, p: any) => la().createCovenant(p));
  ipcMain.handle('la:covenant:measure', (_e, { id }: any) => la().computeCovenantStatus(id));
  ipcMain.handle('la:covenant:breaches', () => la().listCovenantBreaches());
  ipcMain.handle('la:compliance:certificate', (_e, opts: any = {}) =>
    la().generateComplianceCertificate(opts),
  );
  ipcMain.handle('la:covenant:upcoming', (_e, { days_ahead }: any = {}) =>
    la().upcomingCovenantMeasurements(days_ahead || 30),
  );
  // Batch LD: ARM
  ipcMain.handle('la:arm:schedule', (_e, p: any) => la().scheduleArmReset(p));
  ipcMain.handle('la:arm:upcoming', (_e, { days_ahead }: any = {}) =>
    la().upcomingArmResets(days_ahead || 90),
  );
  ipcMain.handle('la:arm:apply', (_e, { id }: any) => la().applyArmReset(id));
  ipcMain.handle('la:recast', (_e, { loan_id }: any) => la().recastSchedule(loan_id));
  ipcMain.handle('la:stress:rate-shock', (_e, { loan_id, shock_pct }: any) =>
    la().rateShockStressTest(loan_id, shock_pct),
  );
  // Batch LE: Escrow & PMI
  ipcMain.handle('la:escrow:record', (_e, p: any) => la().recordEscrowEntry(p));
  ipcMain.handle('la:escrow:analysis', (_e, { loan_id, year }: any) =>
    la().annualEscrowAnalysis(loan_id, year),
  );
  ipcMain.handle('la:pmi:setup', (_e, p: any) => la().setupPmi(p));
  ipcMain.handle('la:pmi:check-cancel', (_e, { loan_id }: any) =>
    la().checkPmiCancellation(loan_id),
  );
  ipcMain.handle('la:insurance:link', (_e, { collateral_id, policy_id }: any) =>
    la().linkInsuranceToCollateral(collateral_id, policy_id),
  );
  // Batch LF: Tax & Portfolio
  ipcMain.handle('la:1098:generate', (_e, { loan_id, tax_year }: any) =>
    la().generate1098(loan_id, tax_year),
  );
  ipcMain.handle('la:deductible-interest', (_e, { loan_id, tax_year, business_use_pct }: any) =>
    la().computeDeductibleInterest(loan_id, tax_year, business_use_pct),
  );
  ipcMain.handle('la:dscr', () => la().computeDscr());
  ipcMain.handle('la:debt-to-equity', () => la().computeDebtToEquity());
  ipcMain.handle('la:portfolio:dashboard', () => la().loanPortfolioDashboard());

  // ─── Loan Full-System Wave (F993-F1052) — `lf:*` namespace ──
  const lf = () => require('../../services/loan-full-system');
  // LG type-specific calculations
  ipcMain.handle('lf:idr:calc', (_e, p: any) => lf().calculateIdrPayment(p));
  ipcMain.handle('lf:pslf:track', (_e, p: any) => lf().trackPslfPayment(p));
  ipcMain.handle('lf:heloc:phase-calc', (_e, p: any) => lf().helocPhaseCalculator(p));
  ipcMain.handle('lf:construction:project', (_e, p: any) => lf().constructionLoanProjection(p));
  ipcMain.handle('lf:reverse:options', (_e, p: any) => lf().reverseMortgageOptions(p));
  ipcMain.handle('lf:cc:payoff', (_e, p: any) => lf().creditCardPayoff(p));
  ipcMain.handle('lf:lease-vs-buy', (_e, p: any) => lf().leaseVsBuyComparison(p));
  ipcMain.handle('lf:auto:afford', (_e, p: any) => lf().autoLoanAffordability(p));
  ipcMain.handle('lf:sba:eligible', (_e, p: any) => lf().sbaEligibilityCheck(p));
  ipcMain.handle('lf:margin:call', (_e, p: any) => lf().marginCallCalculator(p));
  // LH advanced math
  ipcMain.handle('lf:pv', (_e, p: any) => lf().presentValue(p));
  ipcMain.handle('lf:fv', (_e, p: any) => lf().futureValue(p));
  ipcMain.handle('lf:npv', (_e, { cash_flows, discount_rate_pct }: any) =>
    lf().calculateNpv(cash_flows || [], discount_rate_pct),
  );
  ipcMain.handle('lf:irr', (_e, { cash_flows, max_iter, tolerance }: any) =>
    lf().calculateIrr(cash_flows || [], max_iter, tolerance),
  );
  ipcMain.handle('lf:apr-to-apy', (_e, { apr_pct, compounds }: any) =>
    lf().aprToApy(apr_pct, compounds || 12),
  );
  ipcMain.handle('lf:apy-to-apr', (_e, { apy_pct, compounds }: any) =>
    lf().apyToApr(apy_pct, compounds || 12),
  );
  ipcMain.handle('lf:apr-with-fees', (_e, p: any) => lf().calculateAprWithFees(p));
  ipcMain.handle('lf:yield-maintenance', (_e, p: any) => lf().yieldMaintenancePenalty(p));
  ipcMain.handle('lf:defeasance', (_e, p: any) => lf().defeasanceCost(p));
  ipcMain.handle('lf:duration', (_e, p: any) => lf().modifiedDuration(p));
  ipcMain.handle('lf:cecl', (_e, p: any) => lf().cecLossReserve(p));
  ipcMain.handle('lf:tax-equiv-yield', (_e, p: any) => lf().taxEquivalentYield(p));
  // LI applications & origination
  ipcMain.handle('lf:app:create', (_e, p: any) => lf().createLoanApplication(p));
  ipcMain.handle('lf:prequal', (_e, p: any) => lf().preQualify(p));
  ipcMain.handle('lf:1003', (_e, { borrower_id, application_id }: any) =>
    lf().generate1003Form(borrower_id, application_id),
  );
  ipcMain.handle('lf:underwriting:checklist', (_e, { application_id }: any) =>
    lf().underwritingChecklist(application_id),
  );
  ipcMain.handle('lf:loan-estimate', (_e, { application_id }: any) =>
    lf().generateLoanEstimate(application_id),
  );
  ipcMain.handle('lf:cd:generate', (_e, { loan_id }: any) =>
    lf().generateClosingDisclosure(loan_id),
  );
  ipcMain.handle('lf:til:generate', (_e, { loan_id }: any) => lf().generateTilDisclosure(loan_id));
  ipcMain.handle('lf:promissory:create', (_e, p: any) => lf().createPromissoryNote(p));
  ipcMain.handle('lf:committee:package', (_e, { application_id }: any) =>
    lf().loanCommitteePackage(application_id),
  );
  ipcMain.handle('lf:borrower:upsert', (_e, p: any) => lf().upsertBorrowerProfile(p));
  // LJ risk & compliance
  ipcMain.handle('lf:credit:update', (_e, { borrower_id, score, source }: any) =>
    lf().updateCreditScore(borrower_id, score, source),
  );
  ipcMain.handle('lf:dti', (_e, { borrower_id, additional_monthly_payment }: any) =>
    lf().calculateBorrowerDti(borrower_id, additional_monthly_payment || 0),
  );
  ipcMain.handle('lf:reserve:portfolio', (_e, opts: any = {}) => lf().portfolioLossReserve(opts));
  ipcMain.handle('lf:dscr:weighted', () => lf().riskWeightedDscr());
  ipcMain.handle('lf:hmda', (_e, { application_id }: any) =>
    lf().hmdaReportingFields(application_id),
  );
  ipcMain.handle('lf:fair-lending', () => lf().fairLendingCheck());
  ipcMain.handle('lf:risk-grade:assign', (_e, p: any) => lf().assignRiskGrade(p));
  ipcMain.handle('lf:watchlist', () => lf().loanWatchlist());
  ipcMain.handle('lf:charge-off', (_e, p: any) => lf().chargeOffLoan(p));
  ipcMain.handle('lf:recovery', (_e, p: any) => lf().recordRecovery(p));
  // LK specialized products
  ipcMain.handle('lf:heloc:draw', (_e, p: any) => lf().helocRecordDraw(p));
  ipcMain.handle('lf:heloc:to-repayment', (_e, p: any) => lf().helocTransitionToRepayment(p));
  ipcMain.handle('lf:construction:draw', (_e, p: any) => lf().createConstructionDraw(p));
  ipcMain.handle('lf:bridge:calc', (_e, p: any) => lf().bridgeLoanCalculator(p));
  ipcMain.handle('lf:lease:classify', (_e, p: any) => lf().classifyLease(p));
  ipcMain.handle('lf:sale-leaseback', (_e, p: any) => lf().saleLeasebackAnalysis(p));
  ipcMain.handle('lf:factoring', (_e, p: any) => lf().factoringAnalysis(p));
  ipcMain.handle('lf:mca', (_e, p: any) => lf().mcaAnalysis(p));
  ipcMain.handle('lf:afr', (_e, { term_category }: any) =>
    lf().getCurrentAfr(term_category || 'mid'),
  );
  ipcMain.handle('lf:loc:track', (_e, p: any) => lf().trackLetterOfCredit(p));
  // LL portfolio analytics
  ipcMain.handle('lf:portfolio:aging', () => lf().portfolioAging());
  ipcMain.handle('lf:portfolio:vintage', () => lf().vintageAnalysis());
  ipcMain.handle('lf:portfolio:concentration', () => lf().concentrationRisk());
  ipcMain.handle('lf:nim', (_e, { months }: any = {}) => lf().netInterestMargin(months || 12));
  ipcMain.handle('lf:loan:yield', (_e, { loan_id }: any) => lf().loanYield(loan_id));
  ipcMain.handle('lf:charge-off:rate', () => lf().chargeOffRate());
  ipcMain.handle('lf:recovery:rate', () => lf().recoveryRate());
  ipcMain.handle('lf:delinquency:rate', () => lf().delinquencyRate());
  ipcMain.handle('lf:portfolio:stress', (_e, p: any) => lf().portfolioStressTest(p));
  ipcMain.handle('lf:reserves:required', () => lf().requiredReserves());

  // ─── Loan Linkage Wave (F1053-F1062) — `lk:*` namespace ──
  const lk = () => require('../../services/loan-linkage-features');
  ipcMain.handle('lk:record-payment', (_e, p: any) => lk().recordPaymentWithExpense(p));
  ipcMain.handle('lk:link-bank-tx', (_e, p: any) => lk().linkBankTxToLoanPmt(p));
  ipcMain.handle('lk:expenses-for-loan', (_e, { loan_id, opts }: any) =>
    lk().expensesForLoan(loan_id, opts || {}),
  );
  ipcMain.handle('lk:suggest-loan-for-bank-tx', (_e, p: any) => lk().suggestLoanForBankTx(p));
  ipcMain.handle('lk:auto-gl-accounts', (_e, { loan_id }: any) =>
    lk().autoCreateGlAccountsForLoan(loan_id),
  );
  ipcMain.handle('lk:retrolink', (_e, { expense_id, loan_id, loan_payment_id }: any) =>
    lk().retroLinkExpenseToLoan(expense_id, loan_id, loan_payment_id),
  );
  ipcMain.handle('lk:linkage-dashboard', () => lk().loanLinkageDashboard());
  ipcMain.handle('lk:generate-bill', (_e, p: any) => lk().generateBillForUpcomingPayment(p));
  ipcMain.handle('lk:cashflow-timeline', (_e, { loan_id, opts }: any) =>
    lk().loanCashflowTimeline(loan_id, opts || {}),
  );
  ipcMain.handle('lk:loan-context-for-expense', (_e, { expense_id }: any) =>
    lk().loanContextForExpense(expense_id),
  );
  // Global backfill — reconcile ALL existing loan payments into the
  // expense ledger. Defaults to the active company; pass {all:true}
  // to process every company. Idempotent.
  ipcMain.handle('lk:backfill-expenses', (_e, payload?: { all?: boolean }) => {
    try {
      const cid = payload?.all ? undefined : db.getCurrentCompanyId() || undefined;
      return lk().backfillLoanPaymentExpenses(cid);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
}
