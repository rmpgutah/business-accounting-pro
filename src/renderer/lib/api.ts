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
  // Perf: bulk operation — single SQL UPDATE instead of N round-trips
  markAllNotificationsRead: (): Promise<number> => window.electronAPI.invoke('notification:mark-all-read'),

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
  // templateKey selects which Settings → Email Templates entry to use:
  //   invoice_send (default), payment_reminder_1, payment_reminder_2,
  //   overdue_notice. Falls back to hardcoded copy if template lookup fails.
  sendInvoiceEmail: (invoiceId: string, html?: string, templateKey?: string): Promise<{ success?: boolean; error?: string; pdfPath?: string; newStatus?: string }> =>
    window.electronAPI.invoke('invoice:send-email',
      (html || templateKey) ? { invoiceId, html, templateKey } : invoiceId),
  generateInvoiceToken: (invoiceId: string): Promise<{ token: string }> =>
    window.electronAPI.invoke('invoice:generate-token', invoiceId),
  // PORTAL: extra surface for the share modal
  invoiceTokenInfo: (invoiceId: string): Promise<{ token: string | null; expiresAt: number; lastView: any | null; error?: string }> =>
    window.electronAPI.invoke('invoice:token-info', invoiceId),
  invoiceRegenerateToken: (invoiceId: string): Promise<{ token?: string; expiresAt?: number; error?: string }> =>
    window.electronAPI.invoke('invoice:regenerate-token', invoiceId),
  invoiceDisableToken: (invoiceId: string): Promise<{ ok?: boolean; alreadyDisabled?: boolean; error?: string }> =>
    window.electronAPI.invoke('invoice:disable-token', invoiceId),
  debtPortalTokenInfo: (debtId: string): Promise<{ token: string | null; expiresAt: number; lastView: any | null; error?: string }> =>
    window.electronAPI.invoke('debt:portal-token-info', { debtId }),
  debtRegeneratePortalToken: (debtId: string): Promise<{ token?: string; expiresAt?: number; portalUrl?: string; error?: string }> =>
    window.electronAPI.invoke('debt:regenerate-portal-token', { debtId }),
  debtDisablePortalToken: (debtId: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('debt:disable-portal-token', { debtId }),
  portalBaseUrl: (): Promise<{ baseUrl: string }> =>
    window.electronAPI.invoke('portal:base-url'),
  // ─── Client Portal Integration (rmpgutahps.us) ─────────
  // API key is encrypted via Electron safeStorage and stored as
  // ciphertext only. The `get` endpoint returns api_key_set:boolean
  // never the value — keys are write-only from the renderer.
  portalIntegrationGet: (): Promise<{
    portal_base_url?: string;
    api_endpoint?: string;
    auth_scheme?: 'bearer' | 'apikey-header';
    health_check_path?: string;
    auto_sync_invoices?: boolean;
    api_key_set?: boolean;
    last_sync_at?: string | null;
    last_sync_status?: string | null;
    last_test_at?: string | null;
    last_test_status?: string | null;
    last_test_message?: string;
    error?: string;
  }> =>
    window.electronAPI.invoke('portal-integration:get'),
  portalIntegrationSave: (payload: {
    portal_base_url?: string;
    api_endpoint?: string;
    auth_scheme?: 'bearer' | 'apikey-header';
    health_check_path?: string;
    auto_sync_invoices?: boolean;
    api_key?: string;          // plaintext — encrypted before storage
    clear_api_key?: boolean;
  }): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('portal-integration:save', payload),
  portalIntegrationTest: (): Promise<{
    ok: boolean;
    status?: number;
    elapsedMs?: number;
    message?: string;
    error?: string;
  }> =>
    window.electronAPI.invoke('portal-integration:test'),
  shellOpenExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    window.electronAPI.invoke('shell:open-external', url),
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
  // SECURITY: replaces direct `DELETE FROM users` rawQuery — see auth:delete-account handler.
  deleteAccount: (userId: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('auth:delete-account', { userId }),

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

  // Chart of Accounts
  accountsSuggestCode: (companyId: string, type: string): Promise<{ code: string; range?: [number, number]; error?: string }> =>
    window.electronAPI.invoke('accounts:suggest-code', { companyId, type }),
  accountsMerge: (sourceId: string, targetId: string): Promise<{ success?: boolean; error?: string }> =>
    window.electronAPI.invoke('accounts:merge', { sourceId, targetId }),
  accountsBulkToggleActive: (ids: string[], isActive: boolean): Promise<{ success?: boolean; count?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:bulk-toggle-active', { ids, isActive }),
  accountsSetOpeningBalance: (companyId: string, accountId: string, amount: number, date: string): Promise<{ success?: boolean; entry_id?: string; error?: string }> =>
    window.electronAPI.invoke('accounts:set-opening-balance', { companyId, accountId, amount, date }),
  accountsCloseToRetainedEarnings: (companyId: string, periodEndDate: string): Promise<{ success?: boolean; entry_id?: string; accounts_closed?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:close-to-retained-earnings', { companyId, periodEndDate }),
  accountsStats: (companyId: string): Promise<any[]> =>
    window.electronAPI.invoke('accounts:stats', { companyId }),
  accountsHistoryPdf: (accountId: string, companyId: string): Promise<{ success?: boolean; error?: string }> =>
    window.electronAPI.invoke('accounts:history-pdf', { accountId, companyId }),
  accountsApplyTemplate: (companyId: string, accounts: Array<{ code: string; name: string; type: string; subtype?: string }>): Promise<{ success?: boolean; created?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:apply-template', { companyId, accounts }),
  // CoA round 2
  complianceCheckAccountPerm: (companyId: string, accountId: string, role: string, action: 'post' | 'view'): Promise<{ allowed: boolean; reason?: string; error?: string }> =>
    window.electronAPI.invoke('compliance:check-account-perm', { companyId, accountId, role, action }),
  fxRevalue: (companyId: string, date: string, rates: Record<string, number>): Promise<{ success?: boolean; entry_id?: string; accounts_revalued?: number; error?: string }> =>
    window.electronAPI.invoke('fx:revalue', { companyId, date, rates }),
  accountsDetectDormant: (companyId: string, months?: number): Promise<{ dormant: string[]; details?: any[]; error?: string }> =>
    window.electronAPI.invoke('accounts:detect-dormant', { companyId, months }),
  accountsParseIIF: (text: string): Promise<{ accounts: any[]; error?: string }> =>
    window.electronAPI.invoke('accounts:parse-iif', { text }),
  accountsBulkCreate: (companyId: string, accounts: any[]): Promise<{ success?: boolean; created?: number; skipped?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:bulk-create', { companyId, accounts }),
  accountsExportTxf: (companyId: string, year: number): Promise<{ txf?: string; count?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:export-txf', { companyId, year }),
  accountsMergePreview: (sourceId: string): Promise<{ journal_lines?: number; invoice_lines?: number; bills?: number; expenses?: number; children?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:merge-preview', { sourceId }),
  accountsSplit: (companyId: string, sourceAccountId: string, targetAccountId: string, dateFrom: string, dateTo: string, descriptionPattern: string): Promise<{ success?: boolean; moved?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:split', { companyId, sourceAccountId, targetAccountId, dateFrom, dateTo, descriptionPattern }),
  accountsRenumber: (companyId: string, accountId: string, newCode: string): Promise<{ success?: boolean; error?: string }> =>
    window.electronAPI.invoke('accounts:renumber', { companyId, accountId, newCode }),
  accountsSoftDelete: (accountId: string): Promise<{ success?: boolean; error?: string }> =>
    window.electronAPI.invoke('accounts:soft-delete', { accountId }),
  accountsRestore: (accountId: string): Promise<{ success?: boolean; error?: string }> =>
    window.electronAPI.invoke('accounts:restore', { accountId }),
  accountsImportOpeningTb: (companyId: string, date: string, rows: Array<{ code: string; balance: number }>): Promise<{ success?: boolean; entry_id?: string; applied?: number; skipped?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:import-opening-tb', { companyId, date, rows }),
  accountsSnapshotBalances: (companyId: string, date?: string): Promise<{ success?: boolean; count?: number; date?: string; error?: string }> =>
    window.electronAPI.invoke('accounts:snapshot-balances', { companyId, date }),
  accountsNaturalSideCheck: (accountId: string, debit: number, credit: number): Promise<{ warn: boolean; message?: string }> =>
    window.electronAPI.invoke('accounts:natural-side-check', { accountId, debit, credit }),
  accountsClassify: (companyId: string, description: string): Promise<{ account_id: string | null; matched?: string }> =>
    window.electronAPI.invoke('accounts:classify', { companyId, description }),
  accountsWatchlistCheck: (companyId: string): Promise<{ success?: boolean; triggered?: number; error?: string }> =>
    window.electronAPI.invoke('accounts:watchlist-check', { companyId }),

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
        // P1.6: PDF metadata written to the Info dictionary by pdf-lib
        // post-process. Surfaces in Finder Get Info, Adobe Properties,
        // and Spotlight search.
        metadata?: {
          title?: string;
          author?: string;
          subject?: string;
          keywords?: string[];
          creator?: string;
          producer?: string;
        };
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

  // Rebuild GL: retro-post missing journal entries for all transactions
  rebuildGL: (): Promise<{ posted?: number; message?: string; error?: string }> =>
    window.electronAPI.invoke('gl:rebuild'),

  // ─── JE round 2 ─────────────────────────────
  jeUndoRecent: (companyId: string, n: number, userId: string): Promise<{ count?: number; error?: string }> =>
    window.electronAPI.invoke('je:undo-recent', { companyId, n, userId }),
  jeGapDetect: (companyId: string): Promise<{ gaps: string[]; error?: string }> =>
    window.electronAPI.invoke('je:gap-detect', { companyId }),
  jeSnapshot: (jeId: string, userId: string): Promise<{ ok?: boolean; version?: number; error?: string }> =>
    window.electronAPI.invoke('je:snapshot', { jeId, userId }),
  jeHistoryList: (jeId: string): Promise<Array<{ id: string; version: number; changed_at: string; changed_by: string }>> =>
    window.electronAPI.invoke('je:history-list', { jeId }),
  jeHistoryRollback: (historyId: string, userId: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('je:history-rollback', { historyId, userId }),

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

  // Payroll Edit (replace existing run)
  editPayroll: (args: {
    runId: string;
    periodStart: string; periodEnd: string; payDate: string;
    totalGross: number; totalTaxes: number; totalNet: number;
    stubs: Array<{ employeeId: string; hours: number; hoursOvertime?: number; grossPay: number; federalTax: number; stateTax: number; ss: number; medicare: number; netPay: number; ytdGross: number; ytdTaxes: number; ytdNet: number; preTaxDeductions?: number; postTaxDeductions?: number; deductionDetail?: string }>;
    runType?: string; notes?: string; employeeCount?: number;
  }): Promise<{ runId?: string; error?: string; success?: boolean }> =>
    window.electronAPI.invoke('payroll:edit', args),

  // Payroll YTD
  // Bug fix #37-39: YTD values are now calculated from actual prior pay stubs.
  payrollYtd: (employeeId: string, year: number): Promise<{
    ytd_gross: number; ytd_taxes: number; ytd_net: number;
    ytd_federal_tax: number; ytd_state_tax: number; ytd_social_security: number; ytd_medicare: number;
  }> =>
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

  // Industry Presets
  industryApplyPreset: (payload: {
    companyId: string;
    presetKey: string;
    preset: any;
    accountSeeds?: Array<{ code: string; name: string; type: string; subtype?: string }>;
  }): Promise<{ success?: boolean; summary?: any; error?: string }> =>
    window.electronAPI.invoke('industry:apply-preset', payload),
  industryGetExisting: (companyId: string): Promise<{
    categoryNames: string[];
    vendorNames: string[];
    fields: string[];
    accountCodes: string[];
  } | null> =>
    window.electronAPI.invoke('industry:get-existing', { companyId }),

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

  // P1.12: Duplicate-invoice detector — returns up to 3 recent
  // invoices for the same client with similar total + due_date.
  // Caller decides whether to surface a confirm modal.
  checkDuplicateInvoices: (payload: {
    client_id: string;
    total: number;
    due_date: string | null;
    excludeId?: string | null;
  }): Promise<{ duplicates: Array<{ id: string; invoice_number: string; total: number; due_date: string; status: string; created_at: string }> }> =>
    window.electronAPI.invoke('invoice:check-duplicates', payload),

  // mode: 'combined' (single PDF, page-broken) | 'separate' (folder of PDFs) | 'zip' (all in one ZIP archive)
  batchExportPDF: (
    invoiceIds: string[],
    mode: 'combined' | 'separate' | 'zip' = 'combined',
  ): Promise<{ path?: string; dir?: string; files?: string[]; count?: number; skipped?: number; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('invoice:batch-pdf', { invoiceIds, mode }),

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

  // ─── Expense Approval & Reimbursement ──────────────
  expenseCheckPolicy: (expense: any, lineItems?: any[]) =>
    window.electronAPI.invoke('expense:check-policy', { expense, lineItems }),
  expenseCheckDuplicate: (companyId: string, vendorId: string | undefined, amount: number, date: string, excludeId?: string) =>
    window.electronAPI.invoke('expense:check-duplicate', { companyId, vendorId, amount, date, excludeId }),
  expenseCheckPeriodLock: (companyId: string, date: string) =>
    window.electronAPI.invoke('expense:check-period-lock', { companyId, date }),
  expenseSubmit: (expenseId: string, submittedBy: string, approverId?: string) =>
    window.electronAPI.invoke('expense:submit', { expenseId, submittedBy, approverId }),
  expenseDecide: (expenseId: string, userId: string, decision: 'approve' | 'reject' | 'needs_info', comment?: string, stepId?: string) =>
    window.electronAPI.invoke('expense:decide', { expenseId, userId, decision, comment, stepId }),
  expenseApprovalQueue: (companyId: string, userId: string) =>
    window.electronAPI.invoke('expense:approval-queue', { companyId, userId }),
  expenseSetApprovalChain: (expenseId: string, approverIds: string[]) =>
    window.electronAPI.invoke('expense:set-approval-chain', { expenseId, approverIds }),
  expenseListApprovalSteps: (expenseId: string) =>
    window.electronAPI.invoke('expense:list-approval-steps', { expenseId }),
  expenseListComments: (expenseId: string) =>
    window.electronAPI.invoke('expense:list-comments', { expenseId }),
  expenseAddComment: (expenseId: string, userId: string, body: string) =>
    window.electronAPI.invoke('expense:add-comment', { expenseId, userId, body }),
  expenseGenerateToken: (expenseId: string) =>
    window.electronAPI.invoke('expense:generate-token', { expenseId }),
  expenseValidateToken: (expenseId: string, token: string) =>
    window.electronAPI.invoke('expense:validate-token', { expenseId, token }),
  expenseLock: (expenseId: string, locked: boolean) =>
    window.electronAPI.invoke('expense:lock', { expenseId, locked }),
  expenseApprovalSla: (companyId: string) =>
    window.electronAPI.invoke('expense:approval-sla', { companyId }),
  reimbursableForEmployee: (companyId: string, employeeId: string, periodStart?: string, periodEnd?: string) =>
    window.electronAPI.invoke('expense:reimbursable-for-employee', { companyId, employeeId, periodStart, periodEnd }),
  reimbursementBalances: (companyId: string) =>
    window.electronAPI.invoke('expense:reimbursement-balances', { companyId }),
  reimbursementCreateBatch: (companyId: string, employeeId: string, expenseIds: string[], periodStart?: string, periodEnd?: string, notes?: string) =>
    window.electronAPI.invoke('reimbursement:create-batch', { companyId, employeeId, expenseIds, periodStart, periodEnd, notes }),
  reimbursementMarkPaidPayroll: (batchId: string, payrollRunId: string) =>
    window.electronAPI.invoke('reimbursement:mark-paid-payroll', { batchId, payrollRunId }),
  reimbursementAging: (companyId: string, days?: number) =>
    window.electronAPI.invoke('reimbursement:aging', { companyId, days }),
  reimbursementCheckThreshold: (companyId: string, employeeId: string) =>
    window.electronAPI.invoke('reimbursement:check-threshold', { companyId, employeeId }),
  reimbursementListBatches: (companyId: string) =>
    window.electronAPI.invoke('reimbursement:list-batches', { companyId }),
  reimbursementBatchDetail: (batchId: string) =>
    window.electronAPI.invoke('reimbursement:batch-detail', { batchId }),
  reimbursementAchExport: (batchId: string) =>
    window.electronAPI.invoke('reimbursement:ach-export', { batchId }),

  // ── Universal Tags ──
  tagsList: (companyId: string, includeDeleted = false) =>
    window.electronAPI.invoke('tags:list', { companyId, includeDeleted }),
  tagsGroupsList: (companyId: string) => window.electronAPI.invoke('tags:groups-list', { companyId }),
  tagsGroupCreate: (data: any) => window.electronAPI.invoke('tags:group-create', data),
  tagsGroupUpdate: (id: string, data: any) => window.electronAPI.invoke('tags:group-update', { id, data }),
  tagsGroupDelete: (id: string) => window.electronAPI.invoke('tags:group-delete', { id }),
  tagsCreate: (data: any) => window.electronAPI.invoke('tags:create', data),
  tagsUpdate: (id: string, data: any) => window.electronAPI.invoke('tags:update', { id, data }),
  tagsRename: (id: string, name: string) => window.electronAPI.invoke('tags:rename', { id, name }),
  tagsSoftDelete: (id: string) => window.electronAPI.invoke('tags:soft-delete', { id }),
  tagsRestore: (id: string) => window.electronAPI.invoke('tags:restore', { id }),
  tagsMerge: (sourceId: string, targetId: string) => window.electronAPI.invoke('tags:merge', { sourceId, targetId }),
  tagsGetForEntity: (companyId: string, entityType: string, entityId: string) =>
    window.electronAPI.invoke('tags:get-for-entity', { companyId, entityType, entityId }),
  tagsSetForEntity: (companyId: string, entityType: string, entityId: string, tagIds: string[]) =>
    window.electronAPI.invoke('tags:set-for-entity', { companyId, entityType, entityId, tagIds }),
  tagsBulkApply: (companyId: string, entityType: string, entityIds: string[], tagIds: string[]) =>
    window.electronAPI.invoke('tags:bulk-apply', { companyId, entityType, entityIds, tagIds }),
  tagsBulkRemove: (companyId: string, entityType: string, entityIds: string[], tagIds: string[]) =>
    window.electronAPI.invoke('tags:bulk-remove', { companyId, entityType, entityIds, tagIds }),
  tagsSearchEntities: (companyId: string, entityType: string, tagIds: string[], mode: 'all' | 'any' = 'all') =>
    window.electronAPI.invoke('tags:search-entities', { companyId, entityType, tagIds, mode }),
  tagsUsageStats: (companyId: string) => window.electronAPI.invoke('tags:usage-stats', { companyId }),
  tagsRulesList: (companyId: string) => window.electronAPI.invoke('tags:rules-list', { companyId }),
  tagsRuleCreate: (data: any) => window.electronAPI.invoke('tags:rule-create', data),
  tagsRuleUpdate: (id: string, data: any) => window.electronAPI.invoke('tags:rule-update', { id, data }),
  tagsRuleDelete: (id: string) => window.electronAPI.invoke('tags:rule-delete', { id }),
  tagsRunRules: (companyId: string, entityType: string, entity: any) =>
    window.electronAPI.invoke('tags:run-rules', { companyId, entityType, entity }),
  tagsExportCsv: (companyId: string) => window.electronAPI.invoke('tags:export-csv', { companyId }),
  tagsImportCsv: (companyId: string, csv: string) => window.electronAPI.invoke('tags:import-csv', { companyId, csv }),

  // ── Custom Fields ──
  customFieldsList: (companyId: string, entityType?: string) =>
    window.electronAPI.invoke('customFields:list', { companyId, entityType }),
  customFieldsCreate: (data: any) => window.electronAPI.invoke('customFields:create', data),
  customFieldsUpdate: (id: string, data: any) => window.electronAPI.invoke('customFields:update', { id, data }),
  customFieldsDelete: (id: string) => window.electronAPI.invoke('customFields:delete', { id }),
  customFieldsGetValues: (companyId: string, entityType: string, entityId: string) =>
    window.electronAPI.invoke('customFields:get-values', { companyId, entityType, entityId }),
  customFieldsSetValues: (companyId: string, entityType: string, entityId: string, values: Record<string, any>) =>
    window.electronAPI.invoke('customFields:set-values', { companyId, entityType, entityId, values }),
  customFieldsUsageStats: (companyId: string, entityType: string) =>
    window.electronAPI.invoke('customFields:usage-stats', { companyId, entityType }),
  customFieldsBulkFill: (companyId: string, entityType: string, fieldKey: string, value: any) =>
    window.electronAPI.invoke('customFields:bulk-fill', { companyId, entityType, fieldKey, value }),
  customFieldsSearch: (companyId: string, entityType: string, fieldKey: string, op: string, value: any) =>
    window.electronAPI.invoke('customFields:search', { companyId, entityType, fieldKey, op, value }),

  // ─── Tax System ─────────────────────────────────
  taxGetUtahConfig: (year: number): Promise<any> =>
    window.electronAPI.invoke('tax:get-utah-config', { year }),
  taxSaveUtahConfig: (year: number, config: Record<string, any>): Promise<any> =>
    window.electronAPI.invoke('tax:save-utah-config', { year, config }),
  taxGetFilingSummary: (year: number, quarter?: number): Promise<any> =>
    window.electronAPI.invoke('tax:get-filing-summary', { year, quarter }),
  taxRecordFiling: (data: { form_type: string; year: number; quarter: number; filed_date?: string; confirmation_number?: string; amount_paid?: number; payment_date?: string; notes?: string }): Promise<any> =>
    window.electronAPI.invoke('tax:record-filing', data),
  taxGetW2Data: (year: number, employee_id?: string): Promise<any[]> =>
    window.electronAPI.invoke('tax:get-w2-data', { year, employee_id }),
  taxGetW3Data: (year: number): Promise<any> =>
    window.electronAPI.invoke('tax:get-w3-data', { year }),
  taxDashboardSummary: (year: number): Promise<any> =>
    window.electronAPI.invoke('tax:dashboard-summary', { year }),
  taxLiabilityReport: (year: number, quarter_start: number, quarter_end: number): Promise<any> =>
    window.electronAPI.invoke('tax:liability-report', { year, quarter_start, quarter_end }),
  taxEmployeeTaxSummary: (year: number, employee_id?: string): Promise<any[]> =>
    window.electronAPI.invoke('tax:employee-tax-summary', { year, employee_id }),
  taxCalcPayroll: (grossPay: number, payFrequency: string, w4: any, utah: any, ytdGross: number): Promise<any> =>
    window.electronAPI.invoke('tax:calc-payroll', { grossPay, payFrequency, w4, utah, ytdGross }),

  // ─── Cognitive Command Layer ─────────────────
  listCommands: () => window.electronAPI.invoke('command:list'),
  searchCommands: (query: string) => window.electronAPI.invoke('command:search', { query }),
  logCommandExecution: (data: { user_id?: string; command_id: string; params?: any; result?: string; duration_ms?: number }) =>
    window.electronAPI.invoke('command:log-execution', data),
  commandHistory: (user_id?: string, limit?: number) =>
    window.electronAPI.invoke('command:history', { user_id, limit }),
  frequentCommands: (user_id?: string, limit?: number) =>
    window.electronAPI.invoke('command:frequent', { user_id, limit }),
  listShortcuts: (user_id?: string) => window.electronAPI.invoke('shortcut:list', { user_id }),
  saveShortcut: (data: { user_id?: string; key_combo: string; command_id: string; params?: any }) =>
    window.electronAPI.invoke('shortcut:save', data),
  deleteShortcut: (id: string) => window.electronAPI.invoke('shortcut:delete', { id }),
  listMacros: (user_id?: string) => window.electronAPI.invoke('macro:list', { user_id }),
  saveMacro: (data: { id?: string; user_id?: string; name: string; description?: string; action_sequence: any[]; is_shared?: boolean }) =>
    window.electronAPI.invoke('macro:save', data),
  deleteMacro: (id: string) => window.electronAPI.invoke('macro:delete', { id }),

  // ─── Reactive Engine ────────────────
  listWorkflows: () => window.electronAPI.invoke('workflow:list'),
  saveWorkflow: (data: any) => window.electronAPI.invoke('workflow:save', data),
  deleteWorkflow: (id: string) => window.electronAPI.invoke('workflow:delete', { id }),
  workflowExecutions: (workflowId?: string, limit?: number) =>
    window.electronAPI.invoke('workflow:executions', { workflowId, limit }),
  workflowEventLog: (limit?: number) =>
    window.electronAPI.invoke('workflow:event-log', { limit }),
  emitEvent: (type: string, entityType?: string, entityId?: string, data?: any) =>
    window.electronAPI.invoke('workflow:emit-event', { type, entityType, entityId, data }),

  // ─── Predictive Intelligence ────────────────
  intelSuggestCategory: (vendor_id: string) => window.electronAPI.invoke('intel:suggest-category', { vendor_id }),
  intelDuplicateInvoices: () => window.electronAPI.invoke('intel:duplicate-invoices'),
  intelPayrollAnomaly: (employee_id: string, gross: number) => window.electronAPI.invoke('intel:payroll-anomaly', { employee_id, gross }),
  intelCashForecast: (days_ahead: number) => window.electronAPI.invoke('intel:cash-forecast', { days_ahead }),
  intelPredictPayment: (invoice_id: string) => window.electronAPI.invoke('intel:predict-payment', { invoice_id }),
  intelRefreshPatterns: () => window.electronAPI.invoke('intel:refresh-patterns'),
  intelListAnomalies: () => window.electronAPI.invoke('intel:list-anomalies'),

  // Events
  on: (channel: string, callback: (...args: any[]) => void) => window.electronAPI.on(channel, callback),
};

export default api;
