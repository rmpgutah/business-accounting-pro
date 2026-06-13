# Full-System 50-Feature Advanced Wave — Master Catalog & Spec

**Date:** 2026-06-13
**Branch:** `claude/romantic-lalande-ac2d3a` (base tip `d495cb2`)
**Status:** Catalog for approval. Supersedes/extends the Vendor Intelligence spec (`f9b4f7b`) by folding it in as Batch A.

## Premise

50 advanced features across the full system, **grounded in the existing dark backend** (~1,800 built-but-unsurfaced IPC handlers, all already wrapped in `api.ts`). The vast majority are **SURFACE** (handler + wrapper exist, UI-only) or **BUILD-LITE** (small new read-only handler over existing tables). A few are **BUILD-HEAVY** (migration / write paths). Pattern for every feature: a new tab/panel in the relevant module copying the token-clean `vendors-ap/shared/ui` approach (`Section`/`StatCard`/`MiniBar`/`TOK`, per-slice `useState`, one `useEffect` + `cancelled` guard, **no `Promise.all`**, no hex), calling existing `api.*` wrappers.

**Execution:** batch-by-batch, subagent-driven, continuous. Each feature: build → `npm run typecheck` → `npm run build` (or `build:renderer`) → `bash scripts/ui-leak-check.sh` (no rise) → commit. Each batch is independently mergeable. Batches ordered low-risk → high-risk.

**Coordination:** Expenses overhaul is merged; still avoid churn in `expenses/`. All new backend is append-only.

---

## Batch A — Vendor Intelligence & AP (6) — per spec `2026-06-13-vendor-ap-advanced-intelligence-design.md`
| # | Feature | Module/Tab | Tag |
|---|---------|-----------|-----|
| 1 | Payment-risk / fraud flags (ACH change before payment) | vendors-ap › Intelligence | BUILD-LITE |
| 2 | Duplicate-vendor detection | vendors-ap › Intelligence | BUILD-LITE |
| 3 | Composite vendor risk score (A–F) | vendors-ap › Intelligence | BUILD-LITE |
| 4 | Off-contract spend + unit-price drift | vendors-ap › Optimization | BUILD-LITE |
| 5 | Subscription roll-up + contract-renewal pipeline | vendors-ap › Optimization | SURFACE |
| 6 | 3-way match (bill↔PO↔receipt) + touchless auto-approve | vendors-ap › Matching | BUILD-HEAVY (migration) |

## Batch B — Reporting & Dashboard Engine (`rpt:`, SURFACE) (8)
| # | Feature | Module/Tab | Tag | Key api |
|---|---------|-----------|-----|---------|
| 7 | Saved report-definition engine (rebuild custom-reports on rpt) | custom-reports | SURFACE | `rptDefCreate/rptDefList/rptRun/rptRunRows` |
| 8 | Saved views + sharing + set-default | custom-reports/reports | SURFACE | `rptViewSave/rptViewList/rptViewSetDefault/rptViewShare` |
| 9 | Scheduled report delivery (auto-monthly + recipients) | new "Scheduled Reports" | SURFACE | `rptSchedCreate/rptSchedRunNow/rptSchedAddRecipients/rptExecAutoMonthly` |
| 10 | Interactive grouping / pivot / aggregate on grids | reports toolbar | SURFACE | `rptRowsGroup/rptRowsAggregate/rptRowsFilter/rptRowsSort` |
| 11 | Variance pack (YoY / QoQ / PoP / actual-vs-budget) | reports/budgets | SURFACE | `rptVarianceYoy/Qoq/Pop/ActualVsBudget` |
| 12 | Customizable widget dashboards (versioned, shareable) | dashboard | SURFACE | `rptDashCreate/rptDashAddWidget/rptDashMoveWidget/rptDashSaveVersion` |
| 13 | KPI target-tracking + deltas + series | kpi | SURFACE | `rptKpiCreate/rptKpiSetTarget/rptKpiSeries/rptKpiDelta` |
| 14 | Drill-down to source + narrative summaries + threshold alerts | reports/dashboard/notifications | SURFACE | `rptDrillInto/rptNarrativeRender/rptAlertCreate` |

## Batch C — Cross-Module & Client Analytics (`sw:` + `feat:` analytics, SURFACE) (8)
| # | Feature | Module/Tab | Tag | Key api |
|---|---------|-----------|-----|---------|
| 15 | Customer LTV leaderboard | clients/kpi | SURFACE | `swCustomerLtv/swClientRevenueRanking` |
| 16 | Client retention & acquisition trend | clients › Analytics | SURFACE | `swClientRetention/swClientAcquisition` |
| 17 | Cohort-retention grid | clients › Analytics | SURFACE | `featCohortBuild/featRetentionCalc` |
| 18 | Churn-prediction worklist | clients | SURFACE | `featChurnCalc/featReportChurnPredict` |
| 19 | LTV:CAC ratio scorecard | kpi/clients | SURFACE | `featLtvCalc/featCacCalc/featLtvCacRatio` |
| 20 | Operating-metrics / quick-ratios scorecard | kpi | SURFACE | `swOperatingMetrics/swQuickRatios/swBurnRate` |
| 21 | Cross-module executive snapshot | dashboard hero | SURFACE | `swFinancialSnapshot/swCrossModuleSummary` |
| 22 | Project profitability & burn dashboard | projects › Analytics | SURFACE | `swProjectProfitability/swProjectBurn/swOverBudgetProjects` |

## Batch D — Smart Forecasting & Cash (`feat:smart`, `sw:`, SURFACE) (5)
| # | Feature | Module/Tab | Tag | Key api |
|---|---------|-----------|-----|---------|
| 23 | Smart cash-flow forecast + payment-date prediction | forecasting | SURFACE | `featSmartForecast/featSmartPredictPayment/featCashForecastGet` |
| 24 | 90-day spend forecast + industry benchmark | expenses/dashboard | SURFACE | `featSpendForecast90d/featSpendBenchmarkVsIndustry` |
| 25 | AP-vs-AR cash bridge + payment forecast | dashboard/forecasting | SURFACE | `swApVsAr/swPaymentForecast` |
| 26 | Recurring vs one-off revenue split | dashboard/forecasting | SURFACE | `swRecurringRevenue/swRevenueByService` |
| 27 | Profit-margin trend & MoM growth | forecasting/dashboard | SURFACE | `swProfitMarginTrend/swMomGrowth` |

## Batch E — Subscriptions & Billing (`iv:`/`iw:`/`feat:sub`, SURFACE/BUILD-LITE) (7)
| # | Feature | Module/Tab | Tag | Key api |
|---|---------|-----------|-----|---------|
| 28 | Subscription lifecycle console | NEW `subscriptions` module | SURFACE | `featSubCreate/Pause/Resume/Cancel/ChangePlan` |
| 29 | MRR/ARR + churn dashboard | subscriptions › Metrics | SURFACE | `featMrrCalc/iwMetricsMrr/iwChurnPredict` |
| 30 | Proration & auto-renew controls | subscriptions | SURFACE | `iwProration/iwSubAutoRenew/iwTrialsExpiring` |
| 31 | Coupons & promo-codes manager | invoices › Discounts | SURFACE | `ivCouponUpsert/Validate/Redeem/Summary` |
| 32 | Installment payment plans on invoices | invoices › Detail | SURFACE | `ivPaymentPlanCreate/Installments/Cancel` |
| 33 | Credit memos | invoices › Credit Memos | BUILD-LITE | `ivCreditMemoCreate/Apply/Void/Summary` |
| 34 | Phantom-subscription detector | subscriptions › Detected | BUILD-LITE | `featSubDetectScan/Confirm/Cancel/Summary` |

## Batch F — Lending Suite (`lf:`/`la:`/`lk:`, BUILD-LITE) (6)
| # | Feature | Module/Tab | Tag | Key api |
|---|---------|-----------|-----|---------|
| 35 | Financial-calculator suite (IDR/PSLF/HELOC/reverse/lease-vs-buy/CC payoff/NPV/IRR) | loans › Calculators | BUILD-LITE | `lfIdrCalc/lfPslfTrack/lfHelocPhaseCalc/lfReverseOptions/lfLeaseVsBuy/lfCcPayoff/lfNpv/lfIrr` |
| 36 | Refinance & loan-modification workbench | loans › Detail › Refi | BUILD-LITE | `laRefiCompare/laRefiExecute/laModApply/laRecast` |
| 37 | Biweekly / lump-principal accelerators | loans › Detail › Payoff | BUILD-LITE | `laBiweeklyImpact/laLumpPrincipal` |
| 38 | Covenant tracking + DSCR/LTV/stress | loans › Detail › Covenants | BUILD-LITE | `laCovenantCreate/Measure/Breaches/laDscr/laLtv/laStressRateShock` |
| 39 | Loan↔bank/expense auto-linkage (extend existing) | loans ↔ bank-recon | BUILD-LITE | `lkSuggestLoanForBankTx/lkLinkBankTx/lkGenerateBill/lkLinkageDashboard` |
| 40 | Loan portfolio risk analytics (aging/vintage/concentration/CECL) | loans › Portfolio | BUILD-LITE | `lfPortfolioAging/Vintage/Concentration/lfCecl/lfReservesRequired` |

## Batch G — Accounting Ops & Controls (`feat:` + `close:`/`sox:`/`numbering:`) (7)
| # | Feature | Module/Tab | Tag | Key api |
|---|---------|-----------|-----|---------|
| 41 | ASC 606 revenue recognition (deferred-rev schedules) | accounts/reports › Revenue | BUILD-LITE | `featDeferredRevCreate/List/Due/Recognize/featObligationUpsert/featBundleAllocate` |
| 42 | Prepaid & accrual schedulers | accounts › Schedules | BUILD-LITE | `featPrepaidCreate/Due/Recognize/featAccrualCreate/Post/DueReversals` |
| 43 | SOX/SOD control center | audit | BUILD-LITE | `soxControlsList/soxControlSave/soxTestSave/featSodDeclare/Check/Assign` |
| 44 | Audit sampling & inquiry workpapers | audit | BUILD-LITE | `featAuditSampleGenerate/featAuditConfirmUpsert/featAuditorInqLog/featAuditIssueUpsert` |
| 45 | Period-close orchestration (year-end/quarter checklist) | NEW close tab (audit/reports) | SURFACE | `featCloseYearEnd/QuarterChecklist/closeRunMonth/closeLockPeriodV2/closeRollForward/closeCycleDashboard` |
| 46 | Document numbering / gap detection | settings/audit | SURFACE | `numberingList/Generate/Gaps/Renumber/jeGapDetect` |
| 47 | Dunning sequence builder | invoices/debt-collection › Collections | BUILD-LITE | `featDunningSeqCreate/dunningPreview/dunningRun/ivCollectionBoard/ivCollectionScore` |

## Batch H — Debt-Collection Analytics (`dc:`, SURFACE) (3)
| # | Feature | Module/Tab | Tag | Key api |
|---|---------|-----------|-----|---------|
| 48 | Portfolio-health + concentration + recovery forecast | debt-collection › Portfolio | SURFACE | `dcPortfolioHealth/dcConcentration/dcRiskDistribution/dcRecoveryForecast/dcRecoveryRate` |
| 49 | Collector workload balancing + settlement analytics | debt-collection › Collector | SURFACE | `dcCollectorWorkload/dcCollectorPerformance/dcSettlementSummary/dcAvgSettlementDiscount` |
| 50 | FDCPA compliance + statute radar + write-off / skip-trace queues | debt-collection › Compliance | SURFACE | `dcFdcpaCheck/dcContactRestrictions/dcStatuteExpiring/dcWriteoffCandidates/dcNeedSkipTrace` |

---

## Tally
- **SURFACE:** ~31 · **BUILD-LITE:** ~17 · **BUILD-HEAVY:** ~2 (Batch A #6 matching migration; everything else is read-only or uses existing write handlers).
- New top-level module: 1 (`subscriptions`). New tabs across existing modules: ~20. New read-only `vn:`-style handlers: ~12 (only where BUILD-LITE; most batches are pure SURFACE).

## Deferred (optional future "Batch I" — BUILD-HEAVY thin-module engines, NOT in this 50)
Multi-entity consolidation (`multi-company`), rolling-forecast/scenario/13-week cash (`forecasting` tables), lot/serial/warehouse inventory, fixed-asset impairments/revaluations, project/construction accounting (milestones/change-orders/progress-billing). These back genuinely empty tables and need new IPC + UI — larger scope, flagged for a later wave.

## Verification & risk
Same gates as the shipped module (no test runner): typecheck + build + leak-check per feature, manual dev pass per batch. Risk concentrated in Batch A #6 (the only schema migration) and the few write-path features (#28-34 subscription writes, #41-42 schedule posting, #47 dunning run) — these get extra care (confirm dialogs, `scheduleAutoBackup()`).
