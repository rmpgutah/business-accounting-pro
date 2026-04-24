declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
    };
  }
}

const api = {
  // Generic CRUD
  query: (table: string, filters?: Record<string, any>, sort?: { field: string; dir: 'asc' | 'desc' }, limit?: number, offset?: number) =>
    window.electronAPI.invoke('db:query', { table, filters, sort, limit, offset }),

  get: (table: string, id: string) =>
    window.electronAPI.invoke('db:get', { table, id }),

  create: (table: string, data: Record<string, any>) =>
    window.electronAPI.invoke('db:create', { table, data }),

  update: (table: string, id: string, data: Record<string, any>) =>
    window.electronAPI.invoke('db:update', { table, id, data }),

  remove: (table: string, id: string) =>
    window.electronAPI.invoke('db:delete', { table, id }),

  rawQuery: (sql: string, params: any[] = []) =>
    window.electronAPI.invoke('db:raw-query', { sql, params }),

  // Company
  listCompanies: () => window.electronAPI.invoke('company:list'),
  getCompany: (id: string) => window.electronAPI.invoke('company:get', id),
  createCompany: (data: any) => window.electronAPI.invoke('company:create', data),
  updateCompany: (id: string, data: any) => window.electronAPI.invoke('company:update', { id, data }),
  switchCompany: (id: string) => window.electronAPI.invoke('company:switch', id),

  // Dashboard
  dashboardStats: (startDate: string, endDate: string) =>
    window.electronAPI.invoke('dashboard:stats', { startDate, endDate }),
  dashboardCashflow: (startDate: string, endDate: string) =>
    window.electronAPI.invoke('dashboard:cashflow', { startDate, endDate }),

  // Search
  globalSearch: (query: string) => window.electronAPI.invoke('search:global', query),

  // Notifications
  listNotifications: (unreadOnly?: boolean) =>
    window.electronAPI.invoke('notification:list', { unread_only: unreadOnly }),
  markNotificationRead: (id: string) => window.electronAPI.invoke('notification:mark-read', id),

  // Invoice Settings & Catalog
  getInvoiceSettings: (): Promise<any> =>
    window.electronAPI.invoke('invoice:get-settings'),
  saveInvoiceSettings: (settings: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('invoice:save-settings', settings),
  listCatalogItems: (): Promise<any[]> =>
    window.electronAPI.invoke('invoice:catalog-list'),
  saveCatalogItem: (item: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('invoice:catalog-save', item),
  deleteCatalogItem: (id: string): Promise<void> =>
    window.electronAPI.invoke('invoice:catalog-delete', id),
  listPaymentSchedule: (invoiceId: string): Promise<any[]> =>
    window.electronAPI.invoke('invoice:payment-schedule-list', invoiceId),
  savePaymentSchedule: (invoiceId: string, milestones: any[]): Promise<any> =>
    window.electronAPI.invoke('invoice:payment-schedule-save', { invoiceId, milestones }),
  listClientContacts: (clientId: string): Promise<any[]> =>
    window.electronAPI.invoke('client:contacts-list', clientId),
  saveClientContacts: (clientId: string, contacts: any[]): Promise<any> =>
    window.electronAPI.invoke('client:contacts-save', { clientId, contacts }),
  listDebtPromises: (debtId: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:promises-list', debtId),
  saveDebtPromise: (data: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('debt:promise-save', data),
  updateDebtPromise: (id: string, kept: boolean, notes?: string): Promise<any> =>
    window.electronAPI.invoke('debt:promise-update', { id, kept, notes }),
  getDebtPortfolioReportData: (companyId: string): Promise<any> =>
    window.electronAPI.invoke('debt:portfolio-report-data', { companyId }),

  // Invoice atomic save (header + line items in one DB transaction)
  saveInvoice: (payload: {
    invoiceId: string | null;
    invoiceData: Record<string, any>;
    lineItems: Array<Record<string, any>>;
    isEdit: boolean;
  }): Promise<{ id?: string; error?: string }> =>
    window.electronAPI.invoke('invoice:save', payload),

  // Expense atomic save (header + line items in one DB transaction)
  saveExpense: (payload: {
    expenseId: string | null;
    expenseData: Record<string, any>;
    lineItems: Array<Record<string, any>>;
    isEdit: boolean;
  }): Promise<{ id?: string; error?: string }> =>
    window.electronAPI.invoke('expense:save', payload),

  // Export
  // Bug fix #3: export:invoice-pdf handler was removed in v1.1.1 dedup cleanup;
  // routes to the canonical invoice:generate-pdf channel to avoid "No handler" crash.
  exportInvoicePdf: (invoiceId: string) => window.electronAPI.invoke('invoice:generate-pdf', invoiceId),
  exportCsv: (table: string, filters?: Record<string, any>) =>
    window.electronAPI.invoke('export:csv', { table, filters }),

  // Invoice PDF & Email
  // Pass `html` to guarantee the saved/emailed PDF matches the in-app preview
  // (applies invoice_settings: logo, accent, columns, payment schedule, etc.).
  generateInvoicePDF: (invoiceId: string, html?: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('invoice:generate-pdf', html ? { invoiceId, html } : invoiceId),
  sendInvoiceEmail: (invoiceId: string, html?: string): Promise<{ success?: boolean; error?: string; pdfPath?: string; newStatus?: string }> =>
    window.electronAPI.invoke('invoice:send-email', html ? { invoiceId, html } : invoiceId),
  generateInvoiceToken: (invoiceId: string): Promise<{ token: string }> =>
    window.electronAPI.invoke('invoice:generate-token', invoiceId),
  invoiceScheduleReminders: (invoiceId: string): Promise<{ scheduled: number }> =>
    window.electronAPI.invoke('invoice:schedule-reminders', { invoiceId }),
  invoiceListReminders: (invoiceId: string): Promise<any[]> =>
    window.electronAPI.invoke('invoice:list-reminders', { invoiceId }),
  getInvoiceDebtLink: (invoiceId: string): Promise<any> =>
    window.electronAPI.invoke('invoice:debt-link', { invoiceId }),
  getDebtInvoiceLink: (debtId: string): Promise<any> =>
    window.electronAPI.invoke('debt:invoice-link', { debtId }),
  getOverdueCandidates: (companyId: string, thresholdDays?: number): Promise<any[]> =>
    window.electronAPI.invoke('invoice:overdue-candidates', { companyId, thresholdDays }),
  convertInvoiceToDebt: (invoiceId: string, companyId: string): Promise<{ debt_id?: string; error?: string }> =>
    window.electronAPI.invoke('invoice:convert-to-debt', { invoiceId, companyId }),

  // File dialog
  openFileDialog: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) =>
    window.electronAPI.invoke('dialog:open-file', options),

  // Auth
  register: (email: string, password: string, displayName: string) =>
    window.electronAPI.invoke('auth:register', { email, password, displayName }),
  login: (email: string, password: string) =>
    window.electronAPI.invoke('auth:login', { email, password }),
  hasUsers: () => window.electronAPI.invoke('auth:has-users'),
  listUsers: (): Promise<any[]> => window.electronAPI.invoke('auth:list-users'),
  assignCollector: (debtId: string, collectorId: string | null): Promise<any> =>
    window.electronAPI.invoke('debt:assign-collector', { debtId, collectorId }),
  linkUserCompany: (userId: string, companyId: string, role?: string) =>
    window.electronAPI.invoke('auth:link-user-company', { userId, companyId, role }),
  validateSession: (userId: string) =>
    window.electronAPI.invoke('auth:validate-session', { userId }),

  // Recurring Processing
  processRecurringNow: () => window.electronAPI.invoke('recurring:process-now'),
  getLastProcessed: () => window.electronAPI.invoke('recurring:last-processed'),
  getRecurringHistory: (templateId?: string) =>
    window.electronAPI.invoke('recurring:history', { templateId }),

  // Notification Engine
  runNotificationChecks: () => window.electronAPI.invoke('notification:run-checks'),
  clearAllNotifications: () => window.electronAPI.invoke('notification:clear-all'),
  dismissNotification: (id: string) => window.electronAPI.invoke('notification:dismiss', id),
  getNotificationPreferences: () => window.electronAPI.invoke('notification:preferences'),
  updateNotificationPreferences: (prefs: Record<string, boolean>) =>
    window.electronAPI.invoke('notification:update-preferences', prefs),

  // Enhanced Dashboard Activity
  dashboardActivity: (entityType?: string, limit?: number) =>
    window.electronAPI.invoke('dashboard:activity', { entityType, limit }),

  // Batch Operations
  batchUpdate: (table: string, ids: string[], data: Record<string, any>) =>
    window.electronAPI.invoke('batch:update', { table, ids, data }),
  batchDelete: (table: string, ids: string[]) =>
    window.electronAPI.invoke('batch:delete', { table, ids }),

  // Import / Export
  importPreviewCSV: () =>
    window.electronAPI.invoke('import:preview-csv'),
  importExecute: (filePath: string, columnMapping: Record<string, string>, targetTable: string) =>
    window.electronAPI.invoke('import:execute', { filePath, columnMapping, targetTable }),
  exportFullBackup: () =>
    window.electronAPI.invoke('export:full-backup'),

  // Print / Preview
  printPreview: (html: string, title: string): Promise<{ success?: boolean }> =>
    window.electronAPI.invoke('print:preview', { html, title }),
  saveToPDF: (
    html: string,
    title: string,
    opts?: {
      doctype?: string;
      identifier?: string;
      pdfOptions?: {
        pageSize?: 'A4' | 'Letter' | 'Legal' | 'Tabloid';
        landscape?: boolean;
        margins?: { top: number; bottom: number; left: number; right: number };
        printBackground?: boolean;
      };
      openAfterSave?: boolean;
      revealAfterSave?: boolean;
    }
  ): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('print:save-pdf', { html, title, ...(opts || {}) }),
  print: (html: string): Promise<{ success?: boolean; error?: string }> =>
    window.electronAPI.invoke('print:print', { html }),

  // Journal Entry Utilities
  // Bug fix #13/#49: journal_entries.entry_number is NOT NULL + UNIQUE;
  // this fetches the next sequential number scoped to the active company.
  nextJournalNumber: (): Promise<string> =>
    window.electronAPI.invoke('journal:next-number'),

  // Invoice Record Payment (with journal entry)
  recordInvoicePayment: (
    invoiceId: string, amount: number, date: string, method: string, reference: string
  ): Promise<{ paymentId: string; newStatus: string; newAmountPaid: number }> =>
    window.electronAPI.invoke('invoice:record-payment', { invoiceId, amount, date, method, reference }),

  // Payroll Process (with journal entry)
  processPayroll: (args: {
    periodStart: string; periodEnd: string; payDate: string;
    totalGross: number; totalTaxes: number; totalNet: number;
    stubs: Array<{ employeeId: string; hours: number; grossPay: number; federalTax: number; stateTax: number; ss: number; medicare: number; netPay: number; ytdGross: number; ytdTaxes: number; ytdNet: number; preTaxDeductions?: number; postTaxDeductions?: number; deductionDetail?: string }>;
    runType?: string;
  }): Promise<{ runId: string; error?: string }> =>
    window.electronAPI.invoke('payroll:process', args),

  // Payroll YTD
  // Bug fix #37-39: YTD values are now calculated from actual prior pay stubs.
  payrollYtd: (employeeId: string, year: number): Promise<{ ytd_gross: number; ytd_taxes: number; ytd_net: number }> =>
    window.electronAPI.invoke('payroll:ytd-totals', { employeeId, year }),

  // Settings (company-scoped)
  // Bug fix #51: api.query('settings') returned all companies' records;
  // these handlers scope all operations to the current active company.
  listSettings: (): Promise<Array<{ key: string; value: string }>> =>
    window.electronAPI.invoke('settings:list'),
  getSetting: (key: string): Promise<string | null> =>
    window.electronAPI.invoke('settings:get', key),
  setSetting: (key: string, value: string): Promise<void> =>
    window.electronAPI.invoke('settings:set', { key, value }),

  // ─── Financial Reports ─────────────────────────────
  reportProfitLoss: (startDate: string, endDate: string) =>
    window.electronAPI.invoke('reports:profit-loss', { startDate, endDate }),
  reportBalanceSheet: (asOfDate: string) =>
    window.electronAPI.invoke('reports:balance-sheet', { asOfDate }),
  reportTrialBalance: (startDate: string, endDate: string) =>
    window.electronAPI.invoke('reports:trial-balance', { startDate, endDate }),
  reportArAging: (asOfDate: string) =>
    window.electronAPI.invoke('reports:ar-aging', { asOfDate }),
  reportApAging: (asOfDate: string) =>
    window.electronAPI.invoke('reports:ap-aging', { asOfDate }),
  reportGeneralLedger: (startDate: string, endDate: string, accountId?: string) =>
    window.electronAPI.invoke('reports:general-ledger', { startDate, endDate, accountId }),
  reportCashFlow: (startDate: string, endDate: string) =>
    window.electronAPI.invoke('reports:cash-flow', { startDate, endDate }),
  vendorSpend: (startDate: string, endDate: string): Promise<any[]> =>
    window.electronAPI.invoke('reports:vendor-spend', { startDate, endDate }),

  // ─── Bills / Accounts Payable ──────────────────────
  billsNextNumber: (): Promise<string> =>
    window.electronAPI.invoke('bills:next-number'),
  // NOTE: IPC handler destructures `date` (not `paymentDate`) — must match exactly
  billsPay: (billId: string, amount: number, date: string, paymentMethod: string, accountId: string, reference?: string) =>
    window.electronAPI.invoke('bills:pay', { billId, amount, date, paymentMethod, accountId, reference }),
  billsStats: (): Promise<{ total_unpaid: number; overdue: number; due_soon: number; paid_this_month: number }> =>
    window.electronAPI.invoke('bills:stats'),
  billsOverdueCheck: () =>
    window.electronAPI.invoke('bills:overdue-check'),

  // ─── Purchase Orders ───────────────────────────────
  poNextNumber: (): Promise<string> =>
    window.electronAPI.invoke('po:next-number'),
  poApprove: (poId: string) =>
    window.electronAPI.invoke('po:approve', { poId }),
  poConvertBill: (poId: string) =>
    window.electronAPI.invoke('po:convert-bill', { poId }),

  // ─── Fixed Assets ──────────────────────────────────
  assetsNextCode: (): Promise<string> =>
    window.electronAPI.invoke('assets:next-code'),
  assetsSchedule: (assetId: string) =>
    window.electronAPI.invoke('assets:schedule', { assetId }),
  assetsRunDepreciation: (periodDate: string) =>
    window.electronAPI.invoke('assets:run-depreciation', { periodDate }),

  // ─── Bank Rules ────────────────────────────────────
  bankRulesApply: () =>
    window.electronAPI.invoke('bank-rules:apply'),

  // ─── Credit Notes ──────────────────────────────────
  creditNotesNextNumber: (): Promise<string> =>
    window.electronAPI.invoke('credit-notes:next-number'),
  creditNotesApply: (creditNoteId: string, invoiceId: string) =>
    window.electronAPI.invoke('credit-notes:apply', { creditNoteId, invoiceId }),

  // ─── Tax Configuration ─────────────────────────────
  taxSeedYear: (year: number) =>
    window.electronAPI.invoke('tax:seed-year', { year }),
  taxGetBrackets: (year: number, filingStatus: string) =>
    window.electronAPI.invoke('tax:get-brackets', { year, filingStatus }),
  // NOTE: IPC handler expects camelCase field names — grossPay, filingStatus, ytdGross
  taxCalculateWithholding: (params: {
    grossPay: number;
    filingStatus: string;
    allowances: number;
    year: number;
    ytdGross: number;
  }) => window.electronAPI.invoke('tax:calculate-withholding', params),
  taxAvailableYears: (): Promise<number[]> =>
    window.electronAPI.invoke('tax:available-years'),
  taxAutoSeedCurrentYear: () =>
    window.electronAPI.invoke('tax:auto-seed-current-year'),

  // Inventory stock movements
  inventoryMovements: (itemId: string): Promise<any[]> =>
    window.electronAPI.invoke('inventory:movements', itemId),
  inventoryAdjust: (payload: { itemId: string; type: string; quantity: number; unitCost: number; reference: string; notes: string }): Promise<any> =>
    window.electronAPI.invoke('inventory:adjust', payload),
  inventoryLowStock: (): Promise<any[]> =>
    window.electronAPI.invoke('inventory:low-stock'),

  // Categories
  categoriesSeedDefaults: (company_id: string) =>
    window.electronAPI.invoke('categories:seed-defaults', { company_id }),

  // Automations
  listAutomations: (): Promise<any[]> =>
    window.electronAPI.invoke('automations:list'),
  toggleAutomation: (ruleId: string): Promise<void> =>
    window.electronAPI.invoke('automations:toggle', ruleId),
  automationRunLog: (ruleId: string): Promise<any[]> =>
    window.electronAPI.invoke('automations:run-log', ruleId),
  createAutomation: (rule: { name: string; trigger_type: string; trigger_config: string; conditions: string; actions: string }): Promise<any> =>
    window.electronAPI.invoke('automations:create', rule),
  deleteAutomation: (ruleId: string): Promise<any> =>
    window.electronAPI.invoke('automations:delete', ruleId),
  updateAutomation: (rule: { id: string; name: string; trigger_type: string; trigger_config: string; conditions: string; actions: string }): Promise<any> =>
    window.electronAPI.invoke('automations:update', rule),

  // Financial Intelligence
  listAnomalies: (): Promise<any[]> =>
    window.electronAPI.invoke('intelligence:anomalies'),
  dismissAnomaly: (id: string): Promise<void> =>
    window.electronAPI.invoke('intelligence:dismiss-anomaly', id),
  cashProjection: (days: number): Promise<{ inflow: any[]; outflow: any[] }> =>
    window.electronAPI.invoke('intelligence:cash-projection', { days }),

  // Rules Engine
  listRules: (company_id: string, category?: string) =>
    window.electronAPI.invoke('rules:list', { company_id, category }),
  createRule: (data: Record<string, any>) =>
    window.electronAPI.invoke('rules:create', data),
  updateRule: (id: string, data: Record<string, any>) =>
    window.electronAPI.invoke('rules:update', { id, data }),
  deleteRule: (id: string) =>
    window.electronAPI.invoke('rules:delete', id),
  listApprovals: (company_id: string, status?: string) =>
    window.electronAPI.invoke('approval:list', { company_id, status }),
  resolveApproval: (id: string, status: 'approved' | 'rejected', notes?: string) =>
    window.electronAPI.invoke('approval:resolve', { id, status, notes }),
  pendingApprovalCount: (company_id: string) =>
    window.electronAPI.invoke('approval:pending-count', company_id),
  cloneRecord: (table: string, id: string) =>
    window.electronAPI.invoke('record:clone', { table, id }),
  invoiceFromTimeEntries: (project_id: string, company_id: string) =>
    window.electronAPI.invoke('invoice:from-time-entries', { project_id, company_id }),

  // ─── Debt Collection ─────────────────────────
  debtStats: (companyId: string): Promise<{
    total_outstanding: number;
    in_collection: number;
    legal_active: number;
    collected_this_month: number;
    writeoffs_ytd: number;
  }> => window.electronAPI.invoke('debt:stats', { companyId }),

  debtCalculateInterest: (debtId: string): Promise<{ interest: number; total: number }> =>
    window.electronAPI.invoke('debt:calculate-interest', { debtId }),

  debtAdvanceStage: (debtId: string, notes?: string): Promise<void> =>
    window.electronAPI.invoke('debt:advance-stage', { debtId, notes }),

  debtHoldToggle: (debtId: string, hold: boolean, reason?: string): Promise<void> =>
    window.electronAPI.invoke('debt:hold-toggle', { debtId, hold, reason }),

  debtImportOverdueInvoices: (companyId: string, daysThreshold: number): Promise<{ imported: number }> =>
    window.electronAPI.invoke('debt:import-overdue', { companyId, daysThreshold }),

  debtGenerateDemandLetter: (debtId: string, templateId: string): Promise<{ html: string }> =>
    window.electronAPI.invoke('debt:generate-demand-letter', { debtId, templateId }),

  debtExportBundle: (debtId: string): Promise<{ path?: string; cancelled?: boolean }> =>
    window.electronAPI.invoke('debt:export-bundle', { debtId }),

  debtSeedDefaultAutomation: (companyId: string): Promise<void> =>
    window.electronAPI.invoke('debt:seed-automation', { companyId }),

  debtSeedDefaultTemplates: (companyId: string): Promise<void> =>
    window.electronAPI.invoke('debt:seed-templates', { companyId }),

  debtRunEscalation: (companyId: string): Promise<{ advanced: number; flagged: number }> =>
    window.electronAPI.invoke('debt:run-escalation', { companyId }),

  debtAnalytics: (companyId: string, startDate: string, endDate: string): Promise<any> =>
    window.electronAPI.invoke('debt:analytics', { companyId, startDate, endDate }),

  getPaymentPlan: (debtId: string): Promise<any> =>
    window.electronAPI.invoke('debt:payment-plan-get', { debtId }),
  savePaymentPlan: (data: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('debt:payment-plan-save', data),
  togglePlanInstallment: (installmentId: string, paid: boolean): Promise<any> =>
    window.electronAPI.invoke('debt:plan-installment-toggle', { installmentId, paid }),
  listSettlements: (debtId: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:settlements-list', { debtId }),
  saveSettlement: (data: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('debt:settlement-save', data),
  respondSettlement: (settlementId: string, response: string, counterAmount?: number): Promise<any> =>
    window.electronAPI.invoke('debt:settlement-respond', { settlementId, response, counter_amount: counterAmount }),
  acceptSettlement: (debtId: string, settlementId: string, offerAmount: number): Promise<any> =>
    window.electronAPI.invoke('debt:settlement-accept', { debtId, settlementId, offer_amount: offerAmount }),
  listComplianceLog: (debtId: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:compliance-list', { debtId }),
  saveComplianceEvent: (data: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('debt:compliance-save', data),
  checkAutoAdvance: (companyId: string, thresholdDays?: number): Promise<{ advanced: number }> =>
    window.electronAPI.invoke('debt:check-auto-advance', { companyId, thresholdDays }),
  getActivityTimeline: (debtId: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:activity-timeline', { debtId }),
  addQuickNote: (debtId: string, note: string): Promise<any> =>
    window.electronAPI.invoke('debt:quick-note', { debtId, note }),
  addDebtFee: (debtId: string, amount: number, feeType: string, description: string): Promise<any> =>
    window.electronAPI.invoke('debt:add-fee', { debtId, amount, feeType, description }),
  collectorPerformance: (startDate?: string, endDate?: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:collector-performance', { startDate, endDate }),
  collectorDashboard: (companyId: string): Promise<any> =>
    window.electronAPI.invoke('debt:collector-dashboard', { companyId }),
  upcomingInstallments: (debtId: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:upcoming-installments', { debtId }),
  uploadDebtDocument: (debtId: string, filePath: string, fileName: string, fileSize: number): Promise<any> =>
    window.electronAPI.invoke('debt:upload-document', { debtId, filePath, fileName, fileSize }),
  debtAuditLog: (debtId: string, limit?: number): Promise<any[]> =>
    window.electronAPI.invoke('debt:audit-log', { debtId, limit }),
  generateCourtPacket: (debtId: string): Promise<any> =>
    window.electronAPI.invoke('debt:generate-court-packet', { debtId }),
  batchRecalcInterest: (): Promise<{ updated: number; error?: string }> =>
    window.electronAPI.invoke('debt:batch-recalc-interest'),
  matchBankPayments: (): Promise<{ auto_matched: number; suggested: number; error?: string }> =>
    window.electronAPI.invoke('debt:match-bank-payments'),
  listPendingMatches: (): Promise<any[]> =>
    window.electronAPI.invoke('debt:list-pending-matches'),
  acceptPaymentMatch: (matchId: string): Promise<any> =>
    window.electronAPI.invoke('debt:accept-match', { matchId }),
  rejectPaymentMatch: (matchId: string): Promise<any> =>
    window.electronAPI.invoke('debt:reject-match', { matchId }),
  smartRecommendations: (companyId: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:smart-recommendations', { companyId }),

  // Feature 4: Schedule Communication
  scheduleCommunication: (debtId: string, type: string, scheduledDate: string, subject: string, body: string): Promise<any> =>
    window.electronAPI.invoke('debt:schedule-communication', { debtId, type, scheduledDate, subject, body }),
  // Feature 12: Auto-Assign Debts
  autoAssignDebts: (companyId: string): Promise<{ assigned: number; error?: string }> =>
    window.electronAPI.invoke('debt:auto-assign', { companyId }),
  // Feature 13: Auto Priority Scoring
  autoPriorityScore: (companyId: string): Promise<{ updated: number; error?: string }> =>
    window.electronAPI.invoke('debt:auto-priority', { companyId }),
  // Feature 16: Freeze/Resume Interest
  freezeInterest: (debtId: string, freeze: boolean, reason?: string): Promise<any> =>
    window.electronAPI.invoke('debt:freeze-interest', { debtId, freeze, reason }),
  // Feature 20: Consolidate Debts
  consolidateDebts: (debtIds: string[], companyId: string): Promise<{ newDebtId?: string; consolidated?: number; error?: string }> =>
    window.electronAPI.invoke('debt:consolidate', { debtIds, companyId }),
  // Feature 23: Transfer Debt
  transferDebt: (debtId: string, targetCompanyId: string): Promise<{ newDebtId?: string; error?: string }> =>
    window.electronAPI.invoke('debt:transfer', { debtId, targetCompanyId }),
  // Feature 24: Campaign Manager
  listCampaigns: (companyId: string): Promise<any[]> =>
    window.electronAPI.invoke('debt:campaign-list', { companyId }),
  saveCampaign: (data: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('debt:campaign-save', data),
  // Feature 9: Payment Portal Link
  generateDebtPortalToken: (debtId: string): Promise<{ token?: string; portalUrl?: string; error?: string }> =>
    window.electronAPI.invoke('debt:generate-portal-token', { debtId }),

  batchExportPDF: (invoiceIds: string[]): Promise<{ path?: string; count?: number; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('invoice:batch-pdf', { invoiceIds }),

  // ─── Invoice Automation ───────────────────────────
  applyLateFees: (): Promise<{ applied: number }> =>
    window.electronAPI.invoke('invoice:apply-late-fees'),
  runDunning: (): Promise<{ advanced: number }> =>
    window.electronAPI.invoke('invoice:run-dunning'),

  // ─── Payroll Summary ─────────────────────────────
  employeeSummary: (employeeId: string): Promise<any> =>
    window.electronAPI.invoke('payroll:employee-summary', { employeeId }),

  // ─── Reports ─────────────────────────────────────
  budgetVsActual: (budgetId: string): Promise<any> =>
    window.electronAPI.invoke('reports:budget-vs-actual', { budgetId }),

  // ─── Quotes ────────────────────────────────────────
  quotesNextNumber: (): Promise<string> =>
    window.electronAPI.invoke('quotes:next-number'),
  quotesConvertToInvoice: (quoteId: string): Promise<{ invoice_id: string }> =>
    window.electronAPI.invoke('quotes:convert-to-invoice', { quoteId }),

  // ─── Client Insights ──────────────────────────────────
  clientInsights: (clientId: string): Promise<any> =>
    window.electronAPI.invoke('client:insights', { clientId }),

  // ─── Project Profitability ────────────────────────────
  projectProfitability: (projectId: string): Promise<any> =>
    window.electronAPI.invoke('project:profitability', { projectId }),

  // VPS Backup
  backupToVps: (): Promise<{ success?: boolean; error?: string; size?: number; timestamp?: string }> =>
    window.electronAPI.invoke('backup:to-vps'),
  restoreFromVps: (): Promise<{ success?: boolean; error?: string; message?: string }> =>
    window.electronAPI.invoke('backup:restore-from-vps'),

  getDashboardData: (companyId: string): Promise<any> =>
    window.electronAPI.invoke('analytics:dashboard-data', { companyId }),
  listPtoPolicies: (companyId: string): Promise<any[]> =>
    window.electronAPI.invoke('payroll:pto-policies', { companyId }),
  savePtoPolicy: (data: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('payroll:pto-policy-save', data),
  listPtoBalances: (companyId: string): Promise<any[]> =>
    window.electronAPI.invoke('payroll:pto-balances', { companyId }),
  adjustPto: (employeeId: string, policyId: string, hours: number, note: string): Promise<any> =>
    window.electronAPI.invoke('payroll:pto-adjust', { employeeId, policyId, hours, note }),
  getStateTaxRate: (state: string, grossPay: number, allowances: number, periodsPerYear: number): Promise<any> =>
    window.electronAPI.invoke('payroll:state-tax-rate', { state, grossPay, allowances, periodsPerYear }),

  // ─── Cross-entity graph ────────────────────────────────
  // Powers the Related / Timeline panels on detail pages. `graph` returns
  // groups of related records across every module; `timeline` merges
  // audit_log + email_log + notifications + documents for one entity.
  entity: {
    graph: (companyId: string, type: string, id: string): Promise<Array<{
      key: string; label: string; entityType: string; rows: Array<Record<string, unknown>>; total?: number;
    }>> => window.electronAPI.invoke('entity:graph', { companyId, type, id }),

    timeline: (companyId: string, type: string, id: string, limit?: number): Promise<Array<{
      id: string; at: string; kind: 'audit' | 'email' | 'notification' | 'document' | 'stripe';
      action: string; title: string; detail?: string; source?: string; metadata?: Record<string, unknown>;
    }>> => window.electronAPI.invoke('entity:timeline', { companyId, type, id, limit }),

    link: (args: { companyId: string; fromType: string; fromId: string; toType: string; toId: string; relation: string; metadata?: Record<string, unknown> }): Promise<{ ok: boolean; error?: string }> =>
      window.electronAPI.invoke('entity:link', args),

    unlink: (args: { companyId: string; fromType: string; fromId: string; toType: string; toId: string; relation: string }): Promise<{ ok: boolean }> =>
      window.electronAPI.invoke('entity:unlink', args),
  },

  // ─── Stripe integration ────────────────────────────────
  // Online-first client with local cache fallback. All methods accept a
  // companyId so data is scoped per company.
  stripe: {
    /** Execute a Stripe REST call. Returns { ok, source: 'network'|'cache'|'queued', data|error }. */
    call: (args: {
      resource: string;
      action: string;
      id?: string;
      params?: Record<string, unknown>;
      companyId: string;
      idempotencyKey?: string;
    }): Promise<{ ok: boolean; source: 'network' | 'cache' | 'queued'; data?: any; error?: string; warning?: string }> =>
      window.electronAPI.invoke('stripe:call', args),

    /** Read cached objects for a resource (never hits the network). */
    listCached: (resource: string, companyId: string, limit?: number): Promise<any[]> =>
      window.electronAPI.invoke('stripe:listCached', { resource, companyId, limit }),

    retrieveCached: (resource: string, companyId: string, stripeId: string): Promise<any | null> =>
      window.electronAPI.invoke('stripe:retrieveCached', { resource, companyId, stripeId }),

    /** Full refresh of one resource — paginates through Stripe and re-populates cache. */
    sync: (resource: string, companyId: string): Promise<{ count: number; drained: number }> =>
      window.electronAPI.invoke('stripe:sync', { resource, companyId }),

    syncState: (companyId: string): Promise<Array<{ resource: string; last_synced_at: string | null; last_ok_at: string | null; last_error: string | null }>> =>
      window.electronAPI.invoke('stripe:syncState', { companyId }),

    queueStatus: (companyId: string): Promise<Array<{ status: string; count: number }>> =>
      window.electronAPI.invoke('stripe:queueStatus', { companyId }),

    drainQueue: (companyId: string): Promise<{ drained: number; failed: number }> =>
      window.electronAPI.invoke('stripe:drainQueue', { companyId }),

    resources: (): Promise<{
      byGroup: Record<string, Array<{ key: string; label: string; preview: boolean }>>;
      all: Record<string, { label: string; group?: string; actions: string[]; custom: string[]; preview: boolean }>;
    }> => window.electronAPI.invoke('stripe:resources'),

    testConnection: (companyId: string): Promise<{ ok: boolean; error?: string; account?: any }> =>
      window.electronAPI.invoke('stripe:testConnection', { companyId }),
  },

  // Events
  on: (channel: string, callback: (...args: any[]) => void) => window.electronAPI.on(channel, callback),
};

export default api;
