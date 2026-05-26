declare global {
  interface Window {
    electronAPI: {
      invoke: <T = any>(channel: string, ...args: unknown[]) => Promise<T>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

interface SaveResult {
  id?: string;
  error?: string;
}

interface SavePayload {
  invoiceId?: string | null;
  expenseId?: string | null;
  invoiceData?: Record<string, unknown>;
  expenseData?: Record<string, unknown>;
  lineItems?: Array<Record<string, unknown>>;
  isEdit?: boolean;
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
  saveInvoice: (payload: SavePayload): Promise<SaveResult> =>
    window.electronAPI.invoke<SaveResult>('invoice:save', payload),

  // Expense atomic save (header + line items in one DB transaction)
  saveExpense: (payload: SavePayload): Promise<SaveResult> =>
    window.electronAPI.invoke<SaveResult>('expense:save', payload),

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
  // P4.35 — Forward-looking cash flow forecast (next N days, default 90)
  reportCashFlowForecast: (days?: number): Promise<any> =>
    window.electronAPI.invoke('reports:cash-flow-forecast', { days }),
  // P4.37 — Customer profitability ranking
  reportCustomerProfitability: (startDate: string, endDate: string, limit?: number): Promise<any> =>
    window.electronAPI.invoke('reports:customer-profitability', { startDate, endDate, limit }),
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
  // FIX #10/#11: Single source of truth for SS wage base, FICA rates, FUTA
  // rates, and standard deductions. Replaces hardcoded constants in
  // tax-brackets.ts and TaxCalculationEngine.ts that drifted apart.
  taxGetPayrollConstants: (year: number): Promise<{ ss_wage_base: number; ss_rate: number; medicare_rate: number; futa_rate: number; futa_wage_base: number; standard_deduction_single: number; standard_deduction_married: number; standard_deduction_hoh: number; error?: string }> =>
    window.electronAPI.invoke('tax:get-payroll-constants', { year }),
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

  // ── LOAN TRACKING ──────────────────────────────────────
  loansList: (opts?: { status?: string }): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('loans:list', opts || {}),
  loanGet: (id: string): Promise<{ loan: any; schedule: any[]; payments: any[]; events: any[]; error?: string }> =>
    window.electronAPI.invoke('loans:get', { id }),
  loanSave: (payload: any): Promise<any> =>
    window.electronAPI.invoke('loans:save', payload),
  loanDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('loans:delete', { id }),
  loanRecordPayment: (payload: { loan_id: string; payment_date: string; amount: number; is_extra_principal?: boolean; payment_method?: string; reference?: string; notes?: string }): Promise<{ ok?: boolean; payment_id?: string; split?: { principal: number; interest: number; escrow: number; new_balance: number }; error?: string }> =>
    window.electronAPI.invoke('loans:record-payment', payload),
  loanPayoffScenario: (loan_id: string, extra_per_payment: number): Promise<{ baseline_total_interest: number; baseline_payoff_date: string; scenario_total_interest: number; scenario_payoff_date: string; interest_saved: number; months_saved: number; error?: string }> =>
    window.electronAPI.invoke('loans:payoff-scenario', { loan_id, extra_per_payment }),
  loansAggregate: (): Promise<{ stats: any; upcoming: any[] } | { error?: string }> =>
    window.electronAPI.invoke('loans:aggregate'),
  loansAggregateSchedule: (months?: number): Promise<Array<{ month: string; principal: number; interest: number; payment: number; balance: number }> | { error?: string }> =>
    window.electronAPI.invoke('loans:aggregate-schedule', { months: months || 60 }),
  loansCheckOverdue: (): Promise<{ overdue_count: number; by_loan: any[]; error?: string }> =>
    window.electronAPI.invoke('loans:check-overdue'),
  loanExportPDF: (loan_id: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('loans:export-pdf', { loan_id }),

  // A7: Line-item snippet library
  snippetsList: (opts?: { category?: string }): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('snippets:list', opts || {}),
  snippetSave: (payload: any): Promise<any> =>
    window.electronAPI.invoke('snippets:save', payload),
  snippetDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('snippets:delete', { id }),
  snippetTrackUse: (id: string): Promise<{ ok?: boolean }> =>
    window.electronAPI.invoke('snippets:track-use', { id }),

  // D3: Period close + lockdown
  periodList: (): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('period:list'),
  periodIsClosed: (date: string): Promise<{ is_closed: boolean; period?: any }> =>
    window.electronAPI.invoke('period:is-closed', { date }),
  periodClose: (payload: { period_start: string; period_end: string; reason?: string; closed_by?: string }): Promise<{ ok?: boolean; id?: string; error?: string }> =>
    window.electronAPI.invoke('period:close', payload),
  periodReopen: (payload: { id: string; reason?: string; reopened_by?: string }): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('period:reopen', payload),

  // Tax Forms (P4.46/47/50)
  taxForm941: (year: number, quarter: 1 | 2 | 3 | 4): Promise<any> =>
    window.electronAPI.invoke('tax:form-941', { year, quarter }),
  taxScheduleC: (year: number): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-c', { year }),
  tax1099NEC: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-nec', { year }),
  taxW2: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:w2', { year }),
  taxScheduleSE: (year: number, w2_ss_wages?: number): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-se', { year, w2_ss_wages }),
  taxSalesTax: (period_start: string, period_end: string, opts?: { filing_frequency?: 'monthly' | 'quarterly' | 'annual'; prepayments?: number; early_filing_discount_pct?: number; state?: string }): Promise<any> =>
    window.electronAPI.invoke('tax:sales-tax', { period_start, period_end, opts }),
  taxW3: (year: number): Promise<any> =>
    window.electronAPI.invoke('tax:w3', { year }),
  taxForm940: (year: number, opts?: { multi_state?: boolean; credit_reduction_state?: boolean; total_deposits?: number }): Promise<any> =>
    window.electronAPI.invoke('tax:form-940', { year, opts }),
  tax1099MISC: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-misc', { year }),
  taxForm944: (year: number): Promise<any> =>
    window.electronAPI.invoke('tax:form-944', { year }),
  taxForm945: (year: number, opts?: { line1_override?: number; line4_override?: number; is_final_return?: boolean; final_payment_date?: string; is_semiweekly_depositor?: boolean }): Promise<any> =>
    window.electronAPI.invoke('tax:form-945', { year, opts }),
  taxSchedule941B: (year: number, quarter: 1 | 2 | 3 | 4): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-941b', { year, quarter }),
  taxForm945A: (year: number, parent_form: 'form-944' | 'form-945' | 'form-941' = 'form-945'): Promise<any> =>
    window.electronAPI.invoke('tax:form-945-a', { year, parent_form }),
  tax1099INT: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-int', { year }),
  tax1099DIV: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-div', { year }),
  tax1099R: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-r', { year }),
  tax1099K: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-k', { year }),
  tax1099B: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-b', { year }),
  tax1099G: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-g', { year }),
  tax1099C: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-c', { year }),
  tax1099SA: (year: number): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:1099-sa', { year }),
  taxW2C: (year: number, corrections: any[] = []): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('tax:w2c', { year, corrections }),
  taxForm1096: (year: number): Promise<any> =>
    window.electronAPI.invoke('tax:form-1096', { year }),
  taxSchedule1: (year: number, opts?: { w2_other_wages?: number }): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-1', { year, opts }),
  taxSchedule2: (year: number, opts?: { w2_other_wages?: number }): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-2', { year, opts }),
  taxSchedule3: (year: number): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-3', { year }),
  taxScheduleA: (year: number, opts?: { agi?: number }): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-a', { year, opts }),
  taxScheduleB: (year: number, opts?: { interest_payers?: any[]; dividend_payers?: any[]; foreign_account?: boolean; foreign_country?: string }): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-b', { year, opts }),
  taxScheduleD: (year: number, opts?: { short_term_lines?: any[]; long_term_lines?: any[]; short_term_carryover?: number; long_term_carryover?: number }): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-d', { year, opts }),
  taxForm1040ES: (year: number, opts?: { prior_year_total_tax?: number; withholding_credits?: number; projected_other_income?: number; filing_status?: 'single' | 'mfj' | 'hoh'; ytd_months?: number }): Promise<any> =>
    window.electronAPI.invoke('tax:form-1040-es', { year, opts }),
  taxForm8995: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-8995', { year, opts }),
  taxForm4562: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-4562', { year, opts }),
  taxForm8829: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-8829', { year, opts }),
  taxForm4797: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-4797', { year, opts }),
  taxForm7004: (opts: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-7004', { opts }),
  taxForm4868: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-4868', { year, opts }),
  taxForm1065: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-1065', { year, opts }),
  taxForm1120: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-1120', { year, opts }),
  taxForm1120S: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-1120s', { year, opts }),
  taxScheduleK1: (opts: any): Promise<any> =>
    window.electronAPI.invoke('tax:schedule-k1', { opts }),
  taxForm1041: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-1041', { year, opts }),
  // Wave 7 — ACA
  taxForm1094C: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-1094c', { year, opts }),
  taxForm1095C: (opts: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-1095c', { opts }),
  // Wave 8 — Entity lifecycle
  taxFormSS4: (opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-ss4', { opts }),
  taxForm2553: (opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-2553', { opts }),
  taxForm8832: (opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-8832', { opts }),
  taxForm8822B: (opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:form-8822b', { opts }),
  // Wave 9 — Utah
  taxTC40: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:tc40', { year, opts }),
  taxTC20: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:tc20', { year, opts }),
  taxTC20S: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:tc20s', { year, opts }),
  taxTC65: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:tc65', { year, opts }),
  taxTC62M: (year: number, periodStart: string, periodEnd: string, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:tc62m', { year, period_start: periodStart, period_end: periodEnd, opts }),
  taxTC941: (year: number, opts?: any): Promise<any> =>
    window.electronAPI.invoke('tax:tc941', { year, opts }),

  // ─── Compliance documents (W-4 / W-9 / I-9) ───
  complianceList: (filters?: { person_type?: 'employee' | 'vendor' | 'client'; form_type?: string; status?: string }): Promise<any[]> =>
    window.electronAPI.invoke('compliance:list', filters),
  complianceListForPerson: (person_type: 'employee' | 'vendor' | 'client', person_id: string): Promise<any[]> =>
    window.electronAPI.invoke('compliance:list-for-person', { person_type, person_id }),
  complianceUpsert: (record: any): Promise<any> =>
    window.electronAPI.invoke('compliance:upsert', record),
  complianceDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('compliance:delete', { id }),
  complianceGetMissing: (): Promise<any[]> =>
    window.electronAPI.invoke('compliance:get-missing'),
  complianceGetExpiring: (days_ahead?: number): Promise<any[]> =>
    window.electronAPI.invoke('compliance:get-expiring', { days_ahead }),
  complianceAutoExpire: (): Promise<number> =>
    window.electronAPI.invoke('compliance:auto-expire'),
  complianceGenerateBlankPDF: (form_type: 'W-4' | 'W-9' | 'I-9', person_type?: 'employee' | 'vendor' | 'client', person_id?: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('compliance:generate-blank-pdf', { form_type, person_type, person_id }),
  taxExportFormPDF: (
    form:
      | '941' | 'schedule-c' | '1099-nec' | 'w2' | 'schedule-se' | 'sales-tax'
      | 'w3' | '940' | '1099-misc'
      | '944' | '945' | 'schedule-941b' | '945-a'
      | '1099-int' | '1099-div' | '1099-r' | '1099-k'
      | '1099-b' | '1099-g' | '1099-c' | '1099-sa'
      | 'w2c' | '1096'
      | 'schedule-1' | 'schedule-2' | 'schedule-3'
      | 'schedule-a' | 'schedule-b' | 'schedule-d'
      | '1040-es'
      | '8995' | '4562' | '8829' | '4797' | '7004' | '4868'
      | '1065' | '1120' | '1120-s' | 'k-1' | '1041'
      | '1094-c' | '1095-c'
      | 'ss-4' | '2553' | '8832' | '8822-b'
      | 'tc-40' | 'tc-20' | 'tc-20s' | 'tc-65' | 'tc-62m' | 'tc-941',
    year: number,
    opts?: {
      quarter?: 1 | 2 | 3 | 4;
      period_start?: string;
      period_end?: string;
      w2_ss_wages?: number;
      multi_state?: boolean;
      credit_reduction_state?: boolean;
      total_deposits?: number;
      form_945_opts?: any;
      parent_form?: 'form-944' | 'form-945' | 'form-941';
      w2c_corrections?: any[];
      w2c_form_index?: number;
      schedule_opts?: any;
      es_opts?: any;
      form_8995_opts?: any;
      form_4562_opts?: any;
      form_8829_opts?: any;
      form_4797_opts?: any;
      form_7004_opts?: any;
      form_4868_opts?: any;
      form_1065_opts?: any;
      form_1120_opts?: any;
      form_1120s_opts?: any;
      form_1041_opts?: any;
      k1_opts?: any;
    },
  ): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('tax:export-form-pdf', { form, year, ...(opts || {}) }),

  // B7: Client risk scoring
  clientsRiskScore: (clientId?: string): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('clients:risk-score', clientId ? { client_id: clientId } : {}),

  // B13: Tax deduction finder
  taxDeductionScan: (year?: number): Promise<any> =>
    window.electronAPI.invoke('tax:deduction-scan', { year }),

  // B5: Receipt OCR + parsing (offline via tesseract.js)
  ocrScanReceiptPick: (): Promise<{ ok?: boolean; cancelled?: boolean; parsed?: any; filePath?: string; error?: string }> =>
    window.electronAPI.invoke('ocr:scan-receipt-pick'),
  ocrScanReceiptFile: (filePath: string): Promise<{ ok?: boolean; parsed?: any; error?: string }> =>
    window.electronAPI.invoke('ocr:scan-receipt-file', { filePath }),

  // B3: Auto-categorize an expense based on history
  suggestExpenseCategory: (opts: { vendor_id?: string | null; vendor_name?: string | null; description?: string | null; amount?: number | null }): Promise<{ category_id: string | null; category_name: string | null; confidence: number; source: string; occurrences: number; totalSeen: number; error?: string }> =>
    window.electronAPI.invoke('expense:suggest-category', opts),

  // B11: Suggest invoice matches for a bank-import line
  suggestPaymentMatches: (opts: { amount: number; date: string; description: string }): Promise<any[]> =>
    window.electronAPI.invoke('payment:suggest-matches', opts),

  // B14: Auto-reconciliation — bulk-applies high-confidence matches
  autoReconcile: (opts?: { threshold?: number; dryRun?: boolean }): Promise<{
    ok?: boolean; dry_run?: boolean; threshold?: number;
    scanned?: number; applied?: number; skipped?: number; ambiguous?: number;
    applied_detail?: any[]; skipped_detail?: any[]; error?: string;
  }> =>
    window.electronAPI.invoke('payment:auto-reconcile', opts || {}),

  // P4.49: Mileage log
  mileageList: (opts?: { year?: number; limit?: number }): Promise<any[] | { error?: string }> =>
    window.electronAPI.invoke('mileage:list', opts || {}),
  mileageSave: (payload: any): Promise<any> =>
    window.electronAPI.invoke('mileage:save', payload),
  mileageDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('mileage:delete', { id }),
  mileageSummary: (year: number): Promise<{ count: number; totalMiles: number; totalDeduction: number; error?: string }> =>
    window.electronAPI.invoke('mileage:summary', { year }),
  mileageCurrentRate: (year?: number): Promise<{ business_rate: number; medical_rate?: number; charitable_rate?: number; error?: string }> =>
    window.electronAPI.invoke('mileage:current-rate', { year }),

  // P6.69: iCal calendar export
  exportInvoicesICS: (): Promise<{ ics?: string; error?: string }> =>
    window.electronAPI.invoke('cal:export-invoices-ics'),
  exportPayrollICS: (): Promise<{ ics?: string; error?: string }> =>
    window.electronAPI.invoke('cal:export-payroll-ics'),

  // P6.70: Webhook subscriptions
  webhooksList: (): Promise<any[]> =>
    window.electronAPI.invoke('webhooks:list'),
  webhooksSave: (payload: { id?: string; event_type: string; target_url: string; secret?: string; enabled?: number; description?: string }): Promise<{ ok?: boolean; id?: string; error?: string }> =>
    window.electronAPI.invoke('webhooks:save', payload),
  webhooksDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('webhooks:delete', { id }),

  // P1.15/16/17: Integrity check (schema drift, orphan FKs, PRAGMAs)
  integrityCheck: (opts?: { skipOrphanScan?: boolean }): Promise<any> =>
    window.electronAPI.invoke('integrity:check', opts || {}),
  integrityCleanupOrphans: (target: string): Promise<{ cleaned: number; error?: string }> =>
    window.electronAPI.invoke('integrity:cleanup-orphans', { target }),
  integrityVacuum: (): Promise<{ ok: boolean; sizeBefore: number; sizeAfter: number; error?: string }> =>
    window.electronAPI.invoke('integrity:vacuum'),

  // P1.13: Trash (soft-delete recovery) ────────────────────
  // listTrash returns records grouped by table; restore undoes a
  // soft-delete; purge physically removes ONE record; empty purges
  // ALL soft-deleted records for the active company.
  trashList: (): Promise<{ items?: Record<string, any[]>; error?: string }> =>
    window.electronAPI.invoke('trash:list'),
  trashRestore: (table: string, id: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('trash:restore', { table, id }),
  trashPurge: (table: string, id: string): Promise<{ ok?: boolean; error?: string }> =>
    window.electronAPI.invoke('trash:purge', { table, id }),
  trashEmpty: (): Promise<{ ok?: boolean; purged?: number; error?: string }> =>
    window.electronAPI.invoke('trash:empty'),

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

  // ─── Employee Document Generation ────────────────
  generateEquipmentAgreement: (employeeId: string): Promise<{ html: string }> =>
    window.electronAPI.invoke('employee:generate-equipment-agreement', { employeeId }),

  generateEmployeeAgreement: (employeeId: string): Promise<{ html: string }> =>
    window.electronAPI.invoke('employee:generate-employee-agreement', { employeeId }),

  // ─── E-Sign ───────────────────────────────────────
  esignList: (filters?: any): Promise<any[]> =>
    window.electronAPI.invoke('esign:list', filters),

  esignGet: (id: string): Promise<any> =>
    window.electronAPI.invoke('esign:get', { id }),

  esignCreate: (title: string, description: string, content: string): Promise<{ id: string }> =>
    window.electronAPI.invoke('esign:create', { title, description, content }),

  esignUpdate: (id: string, title: string, description: string, content: string): Promise<any> =>
    window.electronAPI.invoke('esign:update', { id, title, description, content }),

  esignDelete: (id: string): Promise<any> =>
    window.electronAPI.invoke('esign:delete', { id }),

  esignSign: (documentId: string, typedName: string, signerType: string, signerId: string, signerName: string): Promise<any> =>
    window.electronAPI.invoke('esign:sign', { documentId, typedName, signerType, signerId, signerName }),

  esignRevoke: (id: string, reason?: string): Promise<any> =>
    window.electronAPI.invoke('esign:revoke', { id, reason }),

  esignVerify: (id: string): Promise<{ verified: boolean; hashMatch?: boolean; signatureValid?: boolean; signedCount?: number; status?: string; contentHash?: string; currentHash?: string; error?: string }> =>
    window.electronAPI.invoke('esign:verify', { id }),

  esignSetPermissions: (documentId: string, permissions: Array<{ userId: string; level: string }>): Promise<any> =>
    window.electronAPI.invoke('esign:set-permissions', { documentId, permissions }),

  esignGetPermissions: (documentId: string): Promise<any[]> =>
    window.electronAPI.invoke('esign:get-permissions', { documentId }),

  esignGetAuditLog: (documentId: string): Promise<any[]> =>
    window.electronAPI.invoke('esign:get-audit-log', { documentId }),

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

  // ─── Batch 1: Admin Features (15) ───────────────────
  adminCustomFieldsList: (entity_type?: string) => window.electronAPI.invoke('admin:custom-fields:list', { entity_type }),
  adminCustomFieldsUpsert: (record: any) => window.electronAPI.invoke('admin:custom-fields:upsert', record),
  adminCustomFieldsDelete: (id: string) => window.electronAPI.invoke('admin:custom-fields:delete', { id }),
  adminUserPermissionsGet: (user_id: string) => window.electronAPI.invoke('admin:user-permissions:get', { user_id }),
  adminUserPermissionsSet: (user_id: string, permissions: any) => window.electronAPI.invoke('admin:user-permissions:set', { user_id, permissions }),
  adminUserRoleSet: (user_id: string, role: string) => window.electronAPI.invoke('admin:user-role:set', { user_id, role }),
  adminTotpGenerate: (user_id: string, account_name: string) => window.electronAPI.invoke('admin:totp:generate', { user_id, account_name }),
  adminTotpEnable: (user_id: string) => window.electronAPI.invoke('admin:totp:enable', { user_id }),
  adminTotpDisable: (user_id: string) => window.electronAPI.invoke('admin:totp:disable', { user_id }),
  adminActivityFeed: (opts?: { limit?: number; entity_type?: string; performed_by?: string; since?: string }) => window.electronAPI.invoke('admin:activity-feed', opts || {}),
  adminNotificationsList: (user_id: string) => window.electronAPI.invoke('admin:notifications:list', { user_id }),
  adminNotificationsSet: (user_id: string, preference: any) => window.electronAPI.invoke('admin:notifications:set', { user_id, preference }),
  adminInvitationsCreate: (email: string, role: string, invited_by: string, expires_in_days?: number) => window.electronAPI.invoke('admin:invitations:create', { email, role, invited_by, expires_in_days }),
  adminInvitationsList: (include_expired_revoked?: boolean) => window.electronAPI.invoke('admin:invitations:list', { include_expired_revoked }),
  adminInvitationsRevoke: (id: string) => window.electronAPI.invoke('admin:invitations:revoke', { id }),
  adminPasswordPolicyGet: () => window.electronAPI.invoke('admin:password-policy:get'),
  adminPasswordValidate: (password: string) => window.electronAPI.invoke('admin:password:validate', { password }),
  adminFiscalYearRange: (calendar_year: number) => window.electronAPI.invoke('admin:fiscal-year:range', { calendar_year }),

  // ─── Batch 2: Invoicing & Expense Features (20) ───────────────
  featInvoiceLateFeeCompute: (invoice_id: string) => window.electronAPI.invoke('feat:invoice:late-fee:compute', { invoice_id }),
  featInvoiceLateFeeApply: (invoice_id: string) => window.electronAPI.invoke('feat:invoice:late-fee:apply', { invoice_id }),
  featInvoiceRemindersSchedule: (invoice_id: string, days?: number[]) => window.electronAPI.invoke('feat:invoice:reminders:schedule', { invoice_id, days }),
  featInvoiceRemindersPending: (as_of?: string) => window.electronAPI.invoke('feat:invoice:reminders:pending', { as_of }),
  featInvoiceRemindersMarkSent: (id: string) => window.electronAPI.invoke('feat:invoice:reminders:mark-sent', { id }),
  featInvoiceRecalcPaymentState: (invoice_id: string) => window.electronAPI.invoke('feat:invoice:recalc-payment-state', { invoice_id }),
  featCreditMemoCreate: (memo: any) => window.electronAPI.invoke('feat:credit-memo:create', memo),
  featCreditMemoApply: (memo_id: string, invoice_id: string, amount: number) => window.electronAPI.invoke('feat:credit-memo:apply', { memo_id, invoice_id, amount }),
  featCreditMemoList: (client_id?: string) => window.electronAPI.invoke('feat:credit-memo:list', { client_id }),
  featInvoiceBatchSendCandidates: (opts?: { status?: string; days_overdue?: number }) => window.electronAPI.invoke('feat:invoice:batch-send:candidates', opts || {}),
  featInvoiceTemplatesList: () => window.electronAPI.invoke('feat:invoice:templates:list'),
  featInvoiceTemplatesUpsert: (t: any) => window.electronAPI.invoke('feat:invoice:templates:upsert', t),
  featInvoiceExchangeRate: (invoice_id: string, rate: number) => window.electronAPI.invoke('feat:invoice:exchange-rate', { invoice_id, rate }),
  featInvoiceDeposit: (invoice_id: string, amount: number, due_date?: string) => window.electronAPI.invoke('feat:invoice:deposit', { invoice_id, amount, due_date }),
  featBudgetAlertUpsert: (record: any) => window.electronAPI.invoke('feat:budget-alert:upsert', record),
  featBudgetAlertCheck: () => window.electronAPI.invoke('feat:budget-alert:check'),
  featVendorSuggest: (prefix?: string, limit?: number) => window.electronAPI.invoke('feat:vendor:suggest', { prefix, limit }),
  featExpenseSplitCreate: (expense_id: string, splits: any[]) => window.electronAPI.invoke('feat:expense:split:create', { expense_id, splits }),
  featExpenseSplitGet: (expense_id: string) => window.electronAPI.invoke('feat:expense:split:get', { expense_id }),
  featReimbursementCreate: (record: any) => window.electronAPI.invoke('feat:reimbursement:create', record),
  featReimbursementApprove: (id: string, approved_by: string) => window.electronAPI.invoke('feat:reimbursement:approve', { id, approved_by }),
  featReimbursementReject: (id: string, reason: string) => window.electronAPI.invoke('feat:reimbursement:reject', { id, reason }),
  featReimbursementPay: (id: string, method: string) => window.electronAPI.invoke('feat:reimbursement:pay', { id, method }),
  featReimbursementList: (status?: string) => window.electronAPI.invoke('feat:reimbursement:list', { status }),
  featPerDiemUpsert: (record: any) => window.electronAPI.invoke('feat:per-diem:upsert', record),
  featPerDiemLookup: (city: string, state: string, year: number) => window.electronAPI.invoke('feat:per-diem:lookup', { city, state, year }),
  featExpenseBulkRecategorize: (expense_ids: string[], category_id: string) => window.electronAPI.invoke('feat:expense:bulk-recategorize', { expense_ids, category_id }),
  featExpenseReport: (opts: any) => window.electronAPI.invoke('feat:expense:report', opts),
  featExpenseDuplicates: (expense: any, days_window?: number) => window.electronAPI.invoke('feat:expense:duplicates', { expense, days_window }),

  // ─── Batch 3: Banking & Payroll Features (15) ─────────────────
  featBankRuleUpsert: (rule: any) => window.electronAPI.invoke('feat:bank-rule:upsert', rule),
  featBankRuleList: () => window.electronAPI.invoke('feat:bank-rule:list'),
  featBankRuleApply: (txn_ids?: string[]) => window.electronAPI.invoke('feat:bank-rule:apply', { txn_ids }),
  featReconAutoMatch: (account_id: string, date_window?: number) => window.electronAPI.invoke('feat:recon:auto-match', { account_id, date_window }),
  featBankTxDuplicates: (days_window?: number) => window.electronAPI.invoke('feat:bank-tx:duplicates', { days_window }),
  featBankTxFlagDuplicate: (txn_id: string, duplicate_of: string, confidence?: number) => window.electronAPI.invoke('feat:bank-tx:flag-duplicate', { txn_id, duplicate_of, confidence }),
  featBankTxTransfers: (date_window?: number) => window.electronAPI.invoke('feat:bank-tx:transfers', { date_window }),
  featBankTxConfirmTransfer: (outflow_id: string, inflow_id: string) => window.electronAPI.invoke('feat:bank-tx:confirm-transfer', { outflow_id, inflow_id }),
  featBankProjectBalance: (account_id: string, days_ahead?: number) => window.electronAPI.invoke('feat:bank:project-balance', { account_id, days_ahead }),
  featCsvMappingUpsert: (record: any) => window.electronAPI.invoke('feat:csv-mapping:upsert', record),
  featCsvMappingList: () => window.electronAPI.invoke('feat:csv-mapping:list'),
  featReconHistory: (account_id?: string, limit?: number) => window.electronAPI.invoke('feat:recon:history', { account_id, limit }),
  featBankOutstandingDeposits: () => window.electronAPI.invoke('feat:bank:outstanding-deposits'),
  featSalaryReviewRecord: (record: any) => window.electronAPI.invoke('feat:salary-review:record', record),
  featSalaryReviewList: (employee_id: string) => window.electronAPI.invoke('feat:salary-review:list', { employee_id }),
  featPayStubsBulk: (opts: { year?: number; quarter?: number; employee_id?: string }) => window.electronAPI.invoke('feat:pay-stubs:bulk', opts),
  featTimeOffSetBalance: (record: any) => window.electronAPI.invoke('feat:time-off:set-balance', record),
  featTimeOffRequest: (record: any) => window.electronAPI.invoke('feat:time-off:request', record),
  featTimeOffApprove: (request_id: string, approved_by: string) => window.electronAPI.invoke('feat:time-off:approve', { request_id, approved_by }),
  featTimeOffBalances: (employee_id?: string) => window.electronAPI.invoke('feat:time-off:balances', { employee_id }),
  featBonusCalculate: (opts: any) => window.electronAPI.invoke('feat:bonus:calculate', opts),
  featStateTaxRates: (state: string) => window.electronAPI.invoke('feat:state-tax:rates', { state }),
  featPayrollForecast: (months_ahead?: number) => window.electronAPI.invoke('feat:payroll:forecast', { months_ahead }),
  featOnboardingCreate: (employee_id: string, hire_date: string, template_id?: string) => window.electronAPI.invoke('feat:onboarding:create', { employee_id, hire_date, template_id }),
  featOnboardingComplete: (id: string, completed_by: string, notes?: string) => window.electronAPI.invoke('feat:onboarding:complete', { id, completed_by, notes }),
  featOnboardingProgress: (employee_id: string) => window.electronAPI.invoke('feat:onboarding:progress', { employee_id }),

  // ─── Batch 4: Reports & Analytics (10) ───────────────
  featReportPeriodOverPeriod: (opts: any) => window.electronAPI.invoke('feat:report:period-over-period', opts),
  featReportTopCustomers: (opts: any) => window.electronAPI.invoke('feat:report:top-customers', opts),
  featReportCLV: (client_id?: string) => window.electronAPI.invoke('feat:report:clv', { client_id }),
  featReportChurnPredict: (opts?: any) => window.electronAPI.invoke('feat:report:churn-predict', opts || {}),
  featReportProfitByService: (opts: any) => window.electronAPI.invoke('feat:report:profit-by-service', opts),
  featReportDeptPnL: (opts: any) => window.electronAPI.invoke('feat:report:dept-pnl', opts),
  featReportVendorYoY: (opts?: any) => window.electronAPI.invoke('feat:report:vendor-yoy', opts || {}),
  featCollectionTemplateUpsert: (t: any) => window.electronAPI.invoke('feat:collection-template:upsert', t),
  featCollectionTemplateList: () => window.electronAPI.invoke('feat:collection-template:list'),
  featCollectionTemplateRender: (template: any, invoice: any, client: any) => window.electronAPI.invoke('feat:collection-template:render', { template, invoice, client }),
  featReportYearEndTax: (year: number) => window.electronAPI.invoke('feat:report:year-end-tax', { year }),
  featWidgetsList: (user_id: string) => window.electronAPI.invoke('feat:widgets:list', { user_id }),
  featWidgetsUpsert: (w: any) => window.electronAPI.invoke('feat:widgets:upsert', w),
  featWidgetsRemove: (id: string) => window.electronAPI.invoke('feat:widgets:remove', { id }),

  // ─── Batch 5: Clients, Vendors, Documents (10) ───────────
  featClientMerge: (primary_id: string, duplicate_ids: string[]) => window.electronAPI.invoke('feat:client:merge', { primary_id, duplicate_ids }),
  featClientFindDuplicates: (opts?: any) => window.electronAPI.invoke('feat:client:find-duplicates', opts || {}),
  featTagAdd: (record: any) => window.electronAPI.invoke('feat:tag:add', record),
  featTagRemove: (id: string) => window.electronAPI.invoke('feat:tag:remove', { id }),
  featTagListEntity: (entity_type: string, entity_id: string) => window.electronAPI.invoke('feat:tag:list-entity', { entity_type, entity_id }),
  featTagListAll: (entity_type?: string) => window.electronAPI.invoke('feat:tag:list-all', { entity_type }),
  featTagSearch: (entity_type: string, tag: string) => window.electronAPI.invoke('feat:tag:search', { entity_type, tag }),
  featCommunicationLog: (record: any) => window.electronAPI.invoke('feat:communication:log', record),
  featCommunicationList: (client_id: string, opts?: any) => window.electronAPI.invoke('feat:communication:list', { client_id, ...(opts || {}) }),
  featCommunicationFollowUps: () => window.electronAPI.invoke('feat:communication:follow-ups'),
  featVendor1099Status: (year: number) => window.electronAPI.invoke('feat:vendor:1099-status', { year }),
  featVendorScorecard: (vendor_id: string, lookback_days?: number) => window.electronAPI.invoke('feat:vendor:scorecard', { vendor_id, lookback_days }),
  featVendorSetContract: (vendor_id: string, contract: any) => window.electronAPI.invoke('feat:vendor:set-contract', { vendor_id, contract }),
  featVendorExpiringContracts: (days_ahead?: number) => window.electronAPI.invoke('feat:vendor:expiring-contracts', { days_ahead }),
  featDocumentSetExpiration: (document_id: string, expires_at: string | null, reminder_days_before?: number) => window.electronAPI.invoke('feat:document:set-expiration', { document_id, expires_at, reminder_days_before }),
  featDocumentExpiring: (days_ahead?: number) => window.electronAPI.invoke('feat:document:expiring', { days_ahead }),
  featDocumentAddVersion: (record: any) => window.electronAPI.invoke('feat:document:add-version', record),
  featDocumentListVersions: (document_id: string) => window.electronAPI.invoke('feat:document:list-versions', { document_id }),
  featDocumentSetEncrypted: (document_id: string, is_encrypted: boolean) => window.electronAPI.invoke('feat:document:set-encrypted', { document_id, is_encrypted }),

  // ── Batch 6: Automation & Workflow Engine (20) ──
  featWorkflowUpsert: (w: any) => window.electronAPI.invoke('feat:workflow:upsert', w),
  featWorkflowList: (active_only?: boolean) => window.electronAPI.invoke('feat:workflow:list', { active_only }),
  featWorkflowTrigger: (trigger_type: string, payload: any) => window.electronAPI.invoke('feat:workflow:trigger', { trigger_type, payload }),
  featScheduledTaskUpsert: (t: any) => window.electronAPI.invoke('feat:scheduled-task:upsert', t),
  featScheduledTaskList: () => window.electronAPI.invoke('feat:scheduled-task:list'),
  featScheduledTaskDue: () => window.electronAPI.invoke('feat:scheduled-task:due'),
  featScheduledTaskMarkRun: (id: string, status: 'success' | 'failed', next_run_at: string) => window.electronAPI.invoke('feat:scheduled-task:mark-run', { id, status, next_run_at }),
  featApprovalChainUpsert: (c: any) => window.electronAPI.invoke('feat:approval-chain:upsert', c),
  featApprovalStart: (chain_id: string, entity_type: string, entity_id: string, submitted_by: string) => window.electronAPI.invoke('feat:approval:start', { chain_id, entity_type, entity_id, submitted_by }),
  featApprovalAct: (instance_id: string, action: 'approve' | 'reject', actor_id: string, comment?: string) => window.electronAPI.invoke('feat:approval:act', { instance_id, action, actor_id, comment }),
  featApprovalPending: (approver_user_id?: string) => window.electronAPI.invoke('feat:approval:pending', { approver_user_id }),
  featEmailTemplateUpsert: (t: any) => window.electronAPI.invoke('feat:email-template:upsert', t),
  featEmailTemplateList: (category?: string) => window.electronAPI.invoke('feat:email-template:list', { category }),
  featEmailTemplateRender: (template_id: string, data: Record<string, any>) => window.electronAPI.invoke('feat:email-template:render', { template_id, data }),
  featWebhookUpsert: (w: any) => window.electronAPI.invoke('feat:webhook:upsert', w),
  featWebhookRecordDelivery: (subscription_id: string, event_type: string, payload: any, response_status: number, response_body: string, duration_ms: number) => window.electronAPI.invoke('feat:webhook:record-delivery', { subscription_id, event_type, payload, response_status, response_body, duration_ms }),
  featAutoCategorizeLearn: (description_pattern: string, vendor_id: string | null, category_id: string) => window.electronAPI.invoke('feat:auto-categorize:learn', { description_pattern, vendor_id, category_id }),
  featAutoCategorizeSuggest: (description: string, vendor_id?: string) => window.electronAPI.invoke('feat:auto-categorize:suggest', { description, vendor_id }),
  featAutoArchiveRun: () => window.electronAPI.invoke('feat:auto-archive:run'),
  featTriggeredActionLog: (trigger_source: string, entity_type: string, entity_id: string, action_type: string, action_result: any) => window.electronAPI.invoke('feat:triggered-action:log', { trigger_source, entity_type, entity_id, action_type, action_result }),
  featTriggeredActionList: (opts?: { limit?: number; action_type?: string }) => window.electronAPI.invoke('feat:triggered-action:list', opts || {}),
  featSLAUpsert: (s: any) => window.electronAPI.invoke('feat:sla:upsert', s),
  featSLAList: () => window.electronAPI.invoke('feat:sla:list'),
  featSavedSearchUpsert: (s: any) => window.electronAPI.invoke('feat:saved-search:upsert', s),
  featSavedSearchList: (user_id: string, module?: string) => window.electronAPI.invoke('feat:saved-search:list', { user_id, module }),
  featBulkOpLog: (op: any) => window.electronAPI.invoke('feat:bulk-op:log', op),
  featBulkOpList: (opts?: { limit?: number; can_undo_only?: boolean }) => window.electronAPI.invoke('feat:bulk-op:list', opts || {}),
  featQuickActionUpsert: (a: any) => window.electronAPI.invoke('feat:quick-action:upsert', a),
  featQuickActionList: (user_id: string) => window.electronAPI.invoke('feat:quick-action:list', { user_id }),

  // ── Batch 7: Banking, Treasury, Multi-Currency (20) ──
  featCashPositionCapture: (snapshot_date?: string) => window.electronAPI.invoke('feat:cash-position:capture', { snapshot_date }),
  featCashPositionList: (opts?: { from?: string; to?: string; limit?: number }) => window.electronAPI.invoke('feat:cash-position:list', opts || {}),
  featCashForecastRebuild: (days_ahead?: number) => window.electronAPI.invoke('feat:cash-forecast:rebuild', { days_ahead }),
  featCashForecastGet: (opts?: { days?: number }) => window.electronAPI.invoke('feat:cash-forecast:get', opts || {}),
  featFxRateUpsert: (r: { rate_date: string; from_currency: string; to_currency: string; rate: number; source?: string }) => window.electronAPI.invoke('feat:fx-rate:upsert', r),
  featFxRateGet: (from: string, to: string, as_of_date?: string) => window.electronAPI.invoke('feat:fx-rate:get', { from, to, as_of_date }),
  featFxRateList: (opts?: { from?: string; to?: string; limit?: number }) => window.electronAPI.invoke('feat:fx-rate:list', opts || {}),
  featFxRevaluationRun: (as_of_date?: string, created_by?: string) => window.electronAPI.invoke('feat:fx-revaluation:run', { as_of_date, created_by }),
  featFxRevaluationList: (limit?: number) => window.electronAPI.invoke('feat:fx-revaluation:list', { limit }),
  featWireTransferUpsert: (w: any) => window.electronAPI.invoke('feat:wire-transfer:upsert', w),
  featWireTransferList: (opts?: { status?: string; limit?: number }) => window.electronAPI.invoke('feat:wire-transfer:list', opts || {}),
  featAchBatchCreate: (b: any) => window.electronAPI.invoke('feat:ach-batch:create', b),
  featAchBatchList: (opts?: { status?: string; limit?: number }) => window.electronAPI.invoke('feat:ach-batch:list', opts || {}),
  featAchBatchItems: (batch_id: string) => window.electronAPI.invoke('feat:ach-batch:items', { batch_id }),
  featAchBatchMarkSubmitted: (batch_id: string, nacha_file_path?: string) => window.electronAPI.invoke('feat:ach-batch:mark-submitted', { batch_id, nacha_file_path }),
  featBankFeeCatUpsert: (c: any) => window.electronAPI.invoke('feat:bank-fee-cat:upsert', c),
  featBankFeeCatList: () => window.electronAPI.invoke('feat:bank-fee-cat:list'),
  featBankFeeCatSuggest: (description: string) => window.electronAPI.invoke('feat:bank-fee-cat:suggest', { description }),
  featBankMatchLog: (transaction_id: string, candidate: any) => window.electronAPI.invoke('feat:bank-match:log', { transaction_id, candidate }),
  featBankMatchList: (transaction_id?: string, limit?: number) => window.electronAPI.invoke('feat:bank-match:list', { transaction_id, limit }),
  featStopPaymentUpsert: (s: any) => window.electronAPI.invoke('feat:stop-payment:upsert', s),
  featStopPaymentList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:stop-payment:list', opts || {}),
  featPendingDepositUpsert: (p: any) => window.electronAPI.invoke('feat:pending-deposit:upsert', p),
  featPendingDepositList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:pending-deposit:list', opts || {}),
  featPendingDepositFloat: () => window.electronAPI.invoke('feat:pending-deposit:float'),
  featPettyCashLog: (p: any) => window.electronAPI.invoke('feat:petty-cash:log', p),
  featPettyCashList: (limit?: number) => window.electronAPI.invoke('feat:petty-cash:list', { limit }),
  featPettyCashBalance: () => window.electronAPI.invoke('feat:petty-cash:balance'),
  featTreasuryUpsert: (t: any) => window.electronAPI.invoke('feat:treasury:upsert', t),
  featTreasuryList: (opts?: { status?: string; maturing_within_days?: number }) => window.electronAPI.invoke('feat:treasury:list', opts || {}),
  featLocUpsert: (lc: any) => window.electronAPI.invoke('feat:loc:upsert', lc),
  featLocList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:loc:list', opts || {}),
  featCovenantUpsert: (c: any) => window.electronAPI.invoke('feat:covenant:upsert', c),
  featCovenantMeasure: (covenant_id: string, value: number) => window.electronAPI.invoke('feat:covenant:measure', { covenant_id, value }),
  featCovenantList: (opts?: { loan_id?: string; breached_only?: boolean }) => window.electronAPI.invoke('feat:covenant:list', opts || {}),
  featSweepUpsert: (s: any) => window.electronAPI.invoke('feat:sweep:upsert', s),
  featSweepList: (active_only?: boolean) => window.electronAPI.invoke('feat:sweep:list', { active_only }),
  featSweepEvaluate: () => window.electronAPI.invoke('feat:sweep:evaluate'),
  featInterCoRecord: (t: any) => window.electronAPI.invoke('feat:inter-co:record', t),
  featInterCoList: (opts?: { status?: string; limit?: number }) => window.electronAPI.invoke('feat:inter-co:list', opts || {}),
  featCcStmtUpsert: (s: any) => window.electronAPI.invoke('feat:cc-stmt:upsert', s),
  featCcStmtAddLines: (statement_id: string, lines: any[]) => window.electronAPI.invoke('feat:cc-stmt:add-lines', { statement_id, lines }),
  featCcStmtList: (opts?: { card_account_id?: string; unreconciled_only?: boolean }) => window.electronAPI.invoke('feat:cc-stmt:list', opts || {}),
  featCcStmtLines: (statement_id: string) => window.electronAPI.invoke('feat:cc-stmt:lines', { statement_id }),
  featLockboxImport: (imp: any) => window.electronAPI.invoke('feat:lockbox:import', imp),
  featLockboxList: (limit?: number) => window.electronAPI.invoke('feat:lockbox:list', { limit }),
  featLockboxItems: (import_id: string) => window.electronAPI.invoke('feat:lockbox:items', { import_id }),
  featPositivePayGenerate: (opts: { bank_account_id?: string; file_date?: string; file_format?: 'csv' | 'fixed' }) => window.electronAPI.invoke('feat:positive-pay:generate', opts),
  featPositivePayList: (limit?: number) => window.electronAPI.invoke('feat:positive-pay:list', { limit }),
  featPositivePayMarkSubmitted: (id: string) => window.electronAPI.invoke('feat:positive-pay:mark-submitted', { id }),

  // ── Batch 8: Inventory, Projects, Time (20) ──
  featWarehouseUpsert: (w: any) => window.electronAPI.invoke('feat:warehouse:upsert', w),
  featWarehouseList: (active_only?: boolean) => window.electronAPI.invoke('feat:warehouse:list', { active_only }),
  featLocationUpsert: (l: any) => window.electronAPI.invoke('feat:location:upsert', l),
  featLocationList: (warehouse_id: string) => window.electronAPI.invoke('feat:location:list', { warehouse_id }),
  featLotUpsert: (l: any) => window.electronAPI.invoke('feat:lot:upsert', l),
  featLotList: (opts?: { item_id?: string; expiring_within_days?: number; status?: string }) => window.electronAPI.invoke('feat:lot:list', opts || {}),
  featSerialUpsert: (s: any) => window.electronAPI.invoke('feat:serial:upsert', s),
  featSerialList: (opts?: { item_id?: string; status?: string; customer_id?: string }) => window.electronAPI.invoke('feat:serial:list', opts || {}),
  featTransferCreate: (t: any) => window.electronAPI.invoke('feat:transfer:create', t),
  featTransferShip: (id: string) => window.electronAPI.invoke('feat:transfer:ship', { id }),
  featTransferReceive: (id: string) => window.electronAPI.invoke('feat:transfer:receive', { id }),
  featTransferList: (opts?: { status?: string; from_warehouse_id?: string; to_warehouse_id?: string }) => window.electronAPI.invoke('feat:transfer:list', opts || {}),
  featTransferItems: (transfer_id: string) => window.electronAPI.invoke('feat:transfer:items', { transfer_id }),
  featAdjustmentCreate: (a: any) => window.electronAPI.invoke('feat:adjustment:create', a),
  featAdjustmentApprove: (id: string, approved_by: string) => window.electronAPI.invoke('feat:adjustment:approve', { id, approved_by }),
  featAdjustmentList: (opts?: { from?: string; to?: string; limit?: number }) => window.electronAPI.invoke('feat:adjustment:list', opts || {}),
  featStockTakeStart: (s: any) => window.electronAPI.invoke('feat:stock-take:start', s),
  featStockTakeCount: (session_id: string, count: any) => window.electronAPI.invoke('feat:stock-take:count', { session_id, ...count }),
  featStockTakeComplete: (session_id: string) => window.electronAPI.invoke('feat:stock-take:complete', { session_id }),
  featStockTakeList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:stock-take:list', opts || {}),
  featStockTakeCounts: (session_id: string) => window.electronAPI.invoke('feat:stock-take:counts', { session_id }),
  featLowStockScan: () => window.electronAPI.invoke('feat:low-stock:scan'),
  featLowStockList: (opts?: { status?: string; severity?: string }) => window.electronAPI.invoke('feat:low-stock:list', opts || {}),
  featLowStockAck: (id: string, acknowledged_by: string) => window.electronAPI.invoke('feat:low-stock:ack', { id, acknowledged_by }),
  featValuationSetMethod: (method: 'fifo' | 'lifo' | 'average' | 'specific') => window.electronAPI.invoke('feat:valuation:set-method', { method }),
  featValuationGetMethod: () => window.electronAPI.invoke('feat:valuation:get-method'),
  featInvValueCapture: (snapshot_date?: string) => window.electronAPI.invoke('feat:inv-value:capture', { snapshot_date }),
  featInvValueList: (limit?: number) => window.electronAPI.invoke('feat:inv-value:list', { limit }),
  featTaskUpsert: (t: any) => window.electronAPI.invoke('feat:task:upsert', t),
  featTaskList: (project_id: string, opts?: { status?: string; assigned_to?: string }) => window.electronAPI.invoke('feat:task:list', { project_id, ...(opts || {}) }),
  featTaskComplete: (id: string) => window.electronAPI.invoke('feat:task:complete', { id }),
  featMilestoneUpsert: (m: any) => window.electronAPI.invoke('feat:milestone:upsert', m),
  featMilestoneList: (project_id: string) => window.electronAPI.invoke('feat:milestone:list', { project_id }),
  featResourceUpsert: (r: any) => window.electronAPI.invoke('feat:resource:upsert', r),
  featResourceList: (project_id: string) => window.electronAPI.invoke('feat:resource:list', { project_id }),
  featProjBudgetUpsert: (b: any) => window.electronAPI.invoke('feat:proj-budget:upsert', b),
  featProjBudgetList: (project_id: string) => window.electronAPI.invoke('feat:proj-budget:list', { project_id }),
  featRiskUpsert: (r: any) => window.electronAPI.invoke('feat:risk:upsert', r),
  featRiskList: (project_id: string, open_only?: boolean) => window.electronAPI.invoke('feat:risk:list', { project_id, open_only }),
  featCoUpsert: (co: any) => window.electronAPI.invoke('feat:co:upsert', co),
  featCoApprove: (id: string, approved_by: string) => window.electronAPI.invoke('feat:co:approve', { id, approved_by }),
  featCoList: (project_id: string, opts?: { status?: string }) => window.electronAPI.invoke('feat:co:list', { project_id, ...(opts || {}) }),
  featTimesheetOpen: (p: any) => window.electronAPI.invoke('feat:timesheet:open', p),
  featTimesheetSubmit: (period_id: string) => window.electronAPI.invoke('feat:timesheet:submit', { period_id }),
  featTimesheetList: (opts?: { employee_id?: string; status?: string }) => window.electronAPI.invoke('feat:timesheet:list', opts || {}),
  featTimesheetApprove: (period_id: string, approver_id: string, action: 'approve' | 'reject', comment?: string) => window.electronAPI.invoke('feat:timesheet:approve', { period_id, approver_id, action, comment }),
  featTimesheetApprovals: (period_id: string) => window.electronAPI.invoke('feat:timesheet:approvals', { period_id }),
  featBillableSummaryRebuild: (period_start: string, period_end: string) => window.electronAPI.invoke('feat:billable-summary:rebuild', { period_start, period_end }),
  featBillableSummaryGet: (opts?: any) => window.electronAPI.invoke('feat:billable-summary:get', opts || {}),
  featProfitabilityCapture: (project_id: string, snapshot_date?: string) => window.electronAPI.invoke('feat:profitability:capture', { project_id, snapshot_date }),
  featProfitabilityList: (opts?: { project_id?: string; limit?: number }) => window.electronAPI.invoke('feat:profitability:list', opts || {}),

  // ── Batch 9: CRM, Sales, Quotes (20) ──
  featStageUpsert: (s: any) => window.electronAPI.invoke('feat:stage:upsert', s),
  featStageList: (active_only?: boolean) => window.electronAPI.invoke('feat:stage:list', { active_only }),
  featStageSeedDefaults: () => window.electronAPI.invoke('feat:stage:seed-defaults'),
  featDealUpsert: (d: any) => window.electronAPI.invoke('feat:deal:upsert', d),
  featDealMoveStage: (deal_id: string, stage_id: string) => window.electronAPI.invoke('feat:deal:move-stage', { deal_id, stage_id }),
  featDealList: (opts?: any) => window.electronAPI.invoke('feat:deal:list', opts || {}),
  featDealPipelineSummary: () => window.electronAPI.invoke('feat:deal:pipeline-summary'),
  featActivityLog: (a: any) => window.electronAPI.invoke('feat:activity:log', a),
  featActivityList: (deal_id: string, limit?: number) => window.electronAPI.invoke('feat:activity:list', { deal_id, limit }),
  featTargetUpsert: (t: any) => window.electronAPI.invoke('feat:target:upsert', t),
  featTargetRefresh: (target_id: string) => window.electronAPI.invoke('feat:target:refresh', { target_id }),
  featTargetList: (opts?: { rep_id?: string; period?: string }) => window.electronAPI.invoke('feat:target:list', opts || {}),
  featPerfCapture: (opts: { rep_id?: string; period_start: string; period_end: string }) => window.electronAPI.invoke('feat:perf:capture', opts),
  featPerfList: (opts?: { rep_id?: string; limit?: number }) => window.electronAPI.invoke('feat:perf:list', opts || {}),
  featLeadFormUpsert: (f: any) => window.electronAPI.invoke('feat:lead-form:upsert', f),
  featLeadFormSubmit: (form_id: string, data: any, ip_address?: string) => window.electronAPI.invoke('feat:lead-form:submit', { form_id, data, ip_address }),
  featLeadFormList: (active_only?: boolean) => window.electronAPI.invoke('feat:lead-form:list', { active_only }),
  featLeadFormSubmissions: (form_id: string, limit?: number) => window.electronAPI.invoke('feat:lead-form:submissions', { form_id, limit }),
  featScoringUpsert: (r: any) => window.electronAPI.invoke('feat:scoring:upsert', r),
  featScoringScore: (data: any) => window.electronAPI.invoke('feat:scoring:score', { data }),
  featScoringList: () => window.electronAPI.invoke('feat:scoring:list'),
  featRoutingUpsert: (r: any) => window.electronAPI.invoke('feat:routing:upsert', r),
  featRoutingRoute: (data: any) => window.electronAPI.invoke('feat:routing:route', { data }),
  featRoutingList: () => window.electronAPI.invoke('feat:routing:list'),
  featTerritoryUpsert: (t: any) => window.electronAPI.invoke('feat:territory:upsert', t),
  featTerritoryList: (active_only?: boolean) => window.electronAPI.invoke('feat:territory:list', { active_only }),
  featCommPlanUpsert: (p: any) => window.electronAPI.invoke('feat:comm-plan:upsert', p),
  featCommPlanList: (active_only?: boolean) => window.electronAPI.invoke('feat:comm-plan:list', { active_only }),
  featCommCalc: (rep_id: string, plan_id: string, period_start: string, period_end: string) => window.electronAPI.invoke('feat:comm:calc', { rep_id, plan_id, period_start, period_end }),
  featCommList: (opts?: { rep_id?: string; paid?: boolean }) => window.electronAPI.invoke('feat:comm:list', opts || {}),
  featCommMarkPaid: (id: string) => window.electronAPI.invoke('feat:comm:mark-paid', { id }),
  featDiscountUpsert: (r: any) => window.electronAPI.invoke('feat:discount:upsert', r),
  featDiscountEvaluate: (order: { total: number; qty?: number; customer_tier?: string; item_ids?: string[] }) => window.electronAPI.invoke('feat:discount:evaluate', order),
  featDiscountList: () => window.electronAPI.invoke('feat:discount:list'),
  featPromoUpsert: (p: any) => window.electronAPI.invoke('feat:promo:upsert', p),
  featPromoRedeem: (code: string, customer_id: string | null, order_total: number, invoice_id?: string) => window.electronAPI.invoke('feat:promo:redeem', { code, customer_id, order_total, invoice_id }),
  featPromoList: () => window.electronAPI.invoke('feat:promo:list'),
  featLoyaltyTierUpsert: (t: any) => window.electronAPI.invoke('feat:loyalty:tier-upsert', t),
  featLoyaltyAward: (customer_id: string, points: number, reason: string, invoice_id?: string) => window.electronAPI.invoke('feat:loyalty:award', { customer_id, points, reason, invoice_id }),
  featLoyaltyStatus: (customer_id: string) => window.electronAPI.invoke('feat:loyalty:status', { customer_id }),
  featLoyaltyTiers: () => window.electronAPI.invoke('feat:loyalty:tiers'),
  featReferralRecord: (r: any) => window.electronAPI.invoke('feat:referral:record', r),
  featReferralConvert: (id: string, referee_customer_id: string) => window.electronAPI.invoke('feat:referral:convert', { id, referee_customer_id }),
  featReferralPayReward: (id: string) => window.electronAPI.invoke('feat:referral:pay-reward', { id }),
  featReferralList: (opts?: { status?: string; referrer_customer_id?: string }) => window.electronAPI.invoke('feat:referral:list', opts || {}),
  featQuoteTplSetLines: (template_id: string, lines: any[]) => window.electronAPI.invoke('feat:quote-tpl:set-lines', { template_id, lines }),
  featQuoteTplGetLines: (template_id: string) => window.electronAPI.invoke('feat:quote-tpl:get-lines', { template_id }),
  featQuoteLogConversion: (quote_id: string, invoice_id: string, converted_by?: string, notes?: string) => window.electronAPI.invoke('feat:quote:log-conversion', { quote_id, invoice_id, converted_by, notes }),
  featQuoteConversionList: (opts?: { quote_id?: string; limit?: number }) => window.electronAPI.invoke('feat:quote:conversion-list', opts || {}),
  featQuoteSign: (s: { quote_id: string; signer_name: string; signer_email?: string; signature_data?: string; ip_address?: string; user_agent?: string }) => window.electronAPI.invoke('feat:quote:sign', s),
  featQuoteSignatures: (quote_id: string) => window.electronAPI.invoke('feat:quote:signatures', { quote_id }),
  featRfpUpsert: (r: any) => window.electronAPI.invoke('feat:rfp:upsert', r),
  featRfpList: (opts?: { status?: string; assigned_to?: string }) => window.electronAPI.invoke('feat:rfp:list', opts || {}),
  featWinLossRecord: (w: any) => window.electronAPI.invoke('feat:win-loss:record', w),
  featWinLossSummary: (opts?: { from?: string; to?: string }) => window.electronAPI.invoke('feat:win-loss:summary', opts || {}),
  featWinLossList: (limit?: number) => window.electronAPI.invoke('feat:win-loss:list', { limit }),

  // ── Batch 10: Compliance, Security, API (20) ──
  featRetentionUpsert: (p: any) => window.electronAPI.invoke('feat:retention:upsert', p),
  featRetentionList: () => window.electronAPI.invoke('feat:retention:list'),
  featRetentionApply: (policy_id: string) => window.electronAPI.invoke('feat:retention:apply', { policy_id }),
  featDsrCreate: (r: any) => window.electronAPI.invoke('feat:dsr:create', r),
  featDsrExport: (subject_email: string) => window.electronAPI.invoke('feat:dsr:export', { subject_email }),
  featDsrComplete: (id: string, fulfilled_by: string, export_path?: string) => window.electronAPI.invoke('feat:dsr:complete', { id, fulfilled_by, export_path }),
  featDsrList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:dsr:list', opts || {}),
  featAnonymizeSubject: (opts: { subject_type: string; subject_id: string; fields: string[]; performed_by: string; reason?: string; dsr_id?: string }) => window.electronAPI.invoke('feat:anonymize:subject', opts),
  featAnonymizeList: (limit?: number) => window.electronAPI.invoke('feat:anonymize:list', { limit }),
  featAuditRecord: (e: any) => window.electronAPI.invoke('feat:audit:record', e),
  featAuditHistory: (entity_type: string, entity_id: string, limit?: number) => window.electronAPI.invoke('feat:audit:history', { entity_type, entity_id, limit }),
  featSessionLog: (s: any) => window.electronAPI.invoke('feat:session:log', s),
  featSessionLogout: (session_id: string) => window.electronAPI.invoke('feat:session:logout', { session_id }),
  featSessionList: (user_id: string, limit?: number) => window.electronAPI.invoke('feat:session:list', { user_id, limit }),
  featWhitelistAdd: (w: any) => window.electronAPI.invoke('feat:whitelist:add', w),
  featWhitelistRemove: (id: string) => window.electronAPI.invoke('feat:whitelist:remove', { id }),
  featWhitelistList: (active_only?: boolean) => window.electronAPI.invoke('feat:whitelist:list', { active_only }),
  featWhitelistCheck: (ip: string) => window.electronAPI.invoke('feat:whitelist:check', { ip }),
  feat2faSetup: (user_id: string, method?: 'totp' | 'sms' | 'email') => window.electronAPI.invoke('feat:2fa:setup', { user_id, method }),
  feat2faEnable: (user_id: string) => window.electronAPI.invoke('feat:2fa:enable', { user_id }),
  feat2faDisable: (user_id: string) => window.electronAPI.invoke('feat:2fa:disable', { user_id }),
  feat2faStatus: (user_id: string) => window.electronAPI.invoke('feat:2fa:status', { user_id }),
  featApiTokenCreate: (opts: { name: string; scopes?: string[]; expires_at?: string; issued_by?: string }) => window.electronAPI.invoke('feat:api-token:create', opts),
  featApiTokenVerify: (plaintext: string) => window.electronAPI.invoke('feat:api-token:verify', { plaintext }),
  featApiTokenRevoke: (id: string) => window.electronAPI.invoke('feat:api-token:revoke', { id }),
  featApiTokenList: (include_revoked?: boolean) => window.electronAPI.invoke('feat:api-token:list', { include_revoked }),
  featRateLimitUpsert: (r: any) => window.electronAPI.invoke('feat:rate-limit:upsert', r),
  featApiRequestLog: (r: any) => window.electronAPI.invoke('feat:api-request:log', r),
  featRateLimitCheck: (token_id: string) => window.electronAPI.invoke('feat:rate-limit:check', { token_id }),
  featWebhookRotate: (subscription_id: string, rotated_by: string, reason?: string) => window.electronAPI.invoke('feat:webhook:rotate', { subscription_id, rotated_by, reason }),
  featWebhookRotations: (subscription_id: string) => window.electronAPI.invoke('feat:webhook:rotations', { subscription_id }),
  featPciUpsert: (i: any) => window.electronAPI.invoke('feat:pci:upsert', i),
  featPciList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:pci:list', opts || {}),
  featSoc2Upsert: (c: any) => window.electronAPI.invoke('feat:soc2:upsert', c),
  featSoc2List: (opts?: { trust_principle?: string }) => window.electronAPI.invoke('feat:soc2:list', opts || {}),
  featMaskUpsert: (r: any) => window.electronAPI.invoke('feat:mask:upsert', r),
  featMaskApply: (value: string, mask_type?: string, visible_chars?: number, replacement_char?: string) => window.electronAPI.invoke('feat:mask:apply', { value, mask_type, visible_chars, replacement_char }),
  featMaskList: () => window.electronAPI.invoke('feat:mask:list'),
  featRtbfCreate: (r: any) => window.electronAPI.invoke('feat:rtbf:create', r),
  featRtbfVerify: (id: string) => window.electronAPI.invoke('feat:rtbf:verify', { id }),
  featRtbfFulfill: (id: string, opts: { records_deleted: number; records_anonymized: number; records_retained: number; retention_reason?: string; fulfilled_by: string }) => window.electronAPI.invoke('feat:rtbf:fulfill', { id, ...opts }),
  featRtbfList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:rtbf:list', opts || {}),
  featConsentRecord: (c: any) => window.electronAPI.invoke('feat:consent:record', c),
  featConsentWithdraw: (id: string) => window.electronAPI.invoke('feat:consent:withdraw', { id }),
  featConsentList: (opts?: { subject_id?: string; subject_email?: string; consent_type?: string }) => window.electronAPI.invoke('feat:consent:list', opts || {}),
  featSubProcessorUpsert: (s: any) => window.electronAPI.invoke('feat:sub-processor:upsert', s),
  featSubProcessorList: (active_only?: boolean) => window.electronAPI.invoke('feat:sub-processor:list', { active_only }),
  featClassifyUpsert: (c: any) => window.electronAPI.invoke('feat:classify:upsert', c),
  featClassifyList: (opts?: { table_name?: string; sensitivity_level?: string }) => window.electronAPI.invoke('feat:classify:list', opts || {}),
  featEncryptionVerify: (v: any) => window.electronAPI.invoke('feat:encryption:verify', v),
  featEncryptionList: (limit?: number) => window.electronAPI.invoke('feat:encryption:list', { limit }),
  featBackupVerifyRecord: (v: any) => window.electronAPI.invoke('feat:backup-verify:record', v),
  featBackupVerifyList: (limit?: number) => window.electronAPI.invoke('feat:backup-verify:list', { limit }),
  featVulnUpsert: (v: any) => window.electronAPI.invoke('feat:vuln:upsert', v),
  featVulnList: (opts?: { status?: string; severity?: string }) => window.electronAPI.invoke('feat:vuln:list', opts || {}),
  featVulnRemediated: (id: string) => window.electronAPI.invoke('feat:vuln:remediated', { id }),

  // ═══════════ Accounting Deep-Dive (F171-F260, 90 features) ═══════════
  // Batch A: GL & JE Operations
  featRecurringJEUpsert: (r: any) => window.electronAPI.invoke('feat:recurring-je:upsert', r),
  featRecurringJEList: (active_only?: boolean) => window.electronAPI.invoke('feat:recurring-je:list', { active_only }),
  featRecurringJEDue: () => window.electronAPI.invoke('feat:recurring-je:due'),
  featRecurringJEAdvance: (id: string) => window.electronAPI.invoke('feat:recurring-je:advance', { id }),
  featRecurringJEPause: (id: string, paused?: boolean) => window.electronAPI.invoke('feat:recurring-je:pause', { id, paused }),
  featReversingJEMark: (je_id: string, reverse_on_date: string) => window.electronAPI.invoke('feat:reversing-je:mark', { je_id, reverse_on_date }),
  featReversingJELink: (original_je_id: string, reversing_je_id: string) => window.electronAPI.invoke('feat:reversing-je:link', { original_je_id, reversing_je_id }),
  featReversingJEDue: () => window.electronAPI.invoke('feat:reversing-je:due'),
  featJETemplateUpsert: (t: any) => window.electronAPI.invoke('feat:je-template:upsert', t),
  featJETemplateList: (category?: string) => window.electronAPI.invoke('feat:je-template:list', { category }),
  featJETemplateUse: (id: string) => window.electronAPI.invoke('feat:je-template:use', { id }),
  featJEFxCalc: (amount: number, from_rate: number, to_rate: number) => window.electronAPI.invoke('feat:je-fx:calc', { amount, from_rate, to_rate }),
  featIcJEPair: (opts: any) => window.electronAPI.invoke('feat:ic-je:pair', opts),
  featIcJEList: () => window.electronAPI.invoke('feat:ic-je:list'),
  featJEImportStart: (file_name: string, imported_by?: string) => window.electronAPI.invoke('feat:je-import:start', { file_name, imported_by }),
  featJEImportFinish: (id: string, summary: any) => window.electronAPI.invoke('feat:je-import:finish', { id, ...summary }),
  featJEImportList: (limit?: number) => window.electronAPI.invoke('feat:je-import:list', { limit }),
  featJECloneLines: (source_je_id: string) => window.electronAPI.invoke('feat:je:clone-lines', { source_je_id }),
  featJEAttachAdd: (a: any) => window.electronAPI.invoke('feat:je-attach:add', a),
  featJEAttachList: (je_id: string) => window.electronAPI.invoke('feat:je-attach:list', { je_id }),
  featAllocRuleUpsert: (r: any) => window.electronAPI.invoke('feat:alloc-rule:upsert', r),
  featAllocRuleApply: (rule_id: string, amount: number) => window.electronAPI.invoke('feat:alloc-rule:apply', { rule_id, amount }),
  featAllocRuleList: () => window.electronAPI.invoke('feat:alloc-rule:list'),
  featNarrativeUpsert: (n: any) => window.electronAPI.invoke('feat:narrative:upsert', n),
  featNarrativeRender: (slug: string, vars: Record<string, any>) => window.electronAPI.invoke('feat:narrative:render', { slug, vars }),
  featNarrativeList: () => window.electronAPI.invoke('feat:narrative:list'),
  featJEProof: (lines: any[]) => window.electronAPI.invoke('feat:je:proof', { lines }),
  featJEBatchPost: (ids: string[]) => window.electronAPI.invoke('feat:je:batch-post', { ids }),
  featJECommentAdd: (je_id: string, user_id: string, user_email: string, comment: string) => window.electronAPI.invoke('feat:je-comment:add', { je_id, user_id, user_email, comment }),
  featJECommentList: (je_id: string) => window.electronAPI.invoke('feat:je-comment:list', { je_id }),
  // Batch B: Chart of Accounts
  featAccountSetParent: (account_id: string, parent_account_id: string | null) => window.electronAPI.invoke('feat:account:set-parent', { account_id, parent_account_id }),
  featAccountTree: () => window.electronAPI.invoke('feat:account:tree'),
  featAccountMerge: (primary_id: string, duplicate_ids: string[]) => window.electronAPI.invoke('feat:account:merge', { primary_id, duplicate_ids }),
  featAccountRenumber: (account_id: string, new_code: string, renamed_by?: string, notes?: string) => window.electronAPI.invoke('feat:account:renumber', { account_id, new_code, renamed_by, notes }),
  featAccountRollUp: (as_of_date?: string) => window.electronAPI.invoke('feat:account:roll-up', { as_of_date }),
  featAccountSetSuspense: (account_id: string, is_suspense?: boolean) => window.electronAPI.invoke('feat:account:set-suspense', { account_id, is_suspense }),
  featAccountGetSuspense: () => window.electronAPI.invoke('feat:account:get-suspense'),
  featAccountClose: (account_id: string, reason?: string) => window.electronAPI.invoke('feat:account:close', { account_id, reason }),
  featAccountReopen: (account_id: string) => window.electronAPI.invoke('feat:account:reopen', { account_id }),
  featAccountSetTaxMapping: (account_id: string, tax_line_code: string | null, tax_form?: string) => window.electronAPI.invoke('feat:account:set-tax-mapping', { account_id, tax_line_code, tax_form }),
  featAccountByTaxLine: (tax_line_code: string) => window.electronAPI.invoke('feat:account:by-tax-line', { tax_line_code }),
  featAccountSetCashFlow: (account_id: string, section: string, subsection?: string) => window.electronAPI.invoke('feat:account:set-cash-flow', { account_id, section, subsection }),
  featOpeningBalanceSet: (b: any) => window.electronAPI.invoke('feat:opening-balance:set', b),
  featOpeningBalanceList: (as_of_date?: string) => window.electronAPI.invoke('feat:opening-balance:list', { as_of_date }),
  // Batch C: Period Close
  featCloseTplUpsert: (t: any) => window.electronAPI.invoke('feat:close-tpl:upsert', t),
  featCloseTplList: () => window.electronAPI.invoke('feat:close-tpl:list'),
  featAccrualCreate: (a: any) => window.electronAPI.invoke('feat:accrual:create', a),
  featAccrualPost: (id: string, posted_je_id: string) => window.electronAPI.invoke('feat:accrual:post', { id, posted_je_id }),
  featAccrualDueReversals: () => window.electronAPI.invoke('feat:accrual:due-reversals'),
  featAccrualMarkReversed: (id: string, reversal_je_id: string) => window.electronAPI.invoke('feat:accrual:mark-reversed', { id, reversal_je_id }),
  featAccrualList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:accrual:list', opts || {}),
  featPrepaidCreate: (s: any) => window.electronAPI.invoke('feat:prepaid:create', s),
  featPrepaidRecognize: (id: string, recognition_date: string, posted_je_id?: string) => window.electronAPI.invoke('feat:prepaid:recognize', { id, recognition_date, posted_je_id }),
  featPrepaidDue: () => window.electronAPI.invoke('feat:prepaid:due'),
  featPrepaidList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:prepaid:list', opts || {}),
  featDeferredRevCreate: (s: any) => window.electronAPI.invoke('feat:deferred-rev:create', s),
  featDeferredRevRecognize: (id: string, recognition_date: string, posted_je_id?: string) => window.electronAPI.invoke('feat:deferred-rev:recognize', { id, recognition_date, posted_je_id }),
  featDeferredRevDue: () => window.electronAPI.invoke('feat:deferred-rev:due'),
  featDeferredRevList: () => window.electronAPI.invoke('feat:deferred-rev:list'),
  featAutoBankFee: (amount: number, account_id: string, description?: string) => window.electronAPI.invoke('feat:auto:bank-fee', { amount, account_id, description }),
  featAutoInterestAccrual: (amount: number, account_id: string, description?: string) => window.electronAPI.invoke('feat:auto:interest-accrual', { amount, account_id, description }),
  featPeriodIsLocked: (date: string) => window.electronAPI.invoke('feat:period:is-locked', { date }),
  featCloseQuarterChecklist: (quarter_end_date: string) => window.electronAPI.invoke('feat:close:quarter-checklist', { quarter_end_date }),
  featCloseYearEnd: (opts: any) => window.electronAPI.invoke('feat:close:year-end', opts),
  featCloseListYearEnds: () => window.electronAPI.invoke('feat:close:list-year-ends'),
  // Batch D: Fixed Assets Advanced
  featAssetDispose: (d: any) => window.electronAPI.invoke('feat:asset:dispose', d),
  featAssetDisposals: () => window.electronAPI.invoke('feat:asset:disposals'),
  featAssetTransfer: (t: any) => window.electronAPI.invoke('feat:asset:transfer', t),
  featAssetTransfers: (asset_id: string) => window.electronAPI.invoke('feat:asset:transfers', { asset_id }),
  featAssetPartialDispose: (d: any) => window.electronAPI.invoke('feat:asset:partial-dispose', d),
  featAssetImpair: (i: any) => window.electronAPI.invoke('feat:asset:impair', i),
  featAssetImpairments: () => window.electronAPI.invoke('feat:asset:impairments'),
  featAssetRevalue: (r: any) => window.electronAPI.invoke('feat:asset:revalue', r),
  featAssetComponentize: (parent_asset_id: string, components: any[]) => window.electronAPI.invoke('feat:asset:componentize', { parent_asset_id, components }),
  featAROCreate: (a: any) => window.electronAPI.invoke('feat:aro:create', a),
  featAROList: () => window.electronAPI.invoke('feat:aro:list'),
  featAssetInsUpsert: (i: any) => window.electronAPI.invoke('feat:asset-ins:upsert', i),
  featAssetInsList: (asset_id: string) => window.electronAPI.invoke('feat:asset-ins:list', { asset_id }),
  featAssetWarrantyUpsert: (w: any) => window.electronAPI.invoke('feat:asset-warranty:upsert', w),
  featAssetWarrantyList: (asset_id: string) => window.electronAPI.invoke('feat:asset-warranty:list', { asset_id }),
  featAssetWarrantyExpiring: (days_ahead?: number) => window.electronAPI.invoke('feat:asset-warranty:expiring', { days_ahead }),
  featAssetSetConvention: (asset_id: string, convention: 'full_month' | 'mid_month' | 'half_year' | 'mid_quarter') => window.electronAPI.invoke('feat:asset:set-convention', { asset_id, convention }),
  // Batch E: Revenue Recognition
  featContractUpsert: (c: any) => window.electronAPI.invoke('feat:contract:upsert', c),
  featContractList: (opts?: { status?: string; client_id?: string }) => window.electronAPI.invoke('feat:contract:list', opts || {}),
  featObligationUpsert: (o: any) => window.electronAPI.invoke('feat:obligation:upsert', o),
  featObligationList: (contract_id: string) => window.electronAPI.invoke('feat:obligation:list', { contract_id }),
  featContractModLog: (m: any) => window.electronAPI.invoke('feat:contract-mod:log', m),
  featContractModList: (contract_id: string) => window.electronAPI.invoke('feat:contract-mod:list', { contract_id }),
  featSSPUpsert: (s: any) => window.electronAPI.invoke('feat:ssp:upsert', s),
  featSSPList: () => window.electronAPI.invoke('feat:ssp:list'),
  featVarConsidRecord: (v: any) => window.electronAPI.invoke('feat:var-consid:record', v),
  featRevMilestoneCreate: (m: any) => window.electronAPI.invoke('feat:rev-milestone:create', m),
  featRevMilestoneComplete: (milestone_id: string, completion_date: string, posted_je_id?: string) => window.electronAPI.invoke('feat:rev-milestone:complete', { milestone_id, completion_date, posted_je_id }),
  featRevMilestoneList: (obligation_id: string) => window.electronAPI.invoke('feat:rev-milestone:list', { obligation_id }),
  featSubWaterfall: (months_ahead?: number) => window.electronAPI.invoke('feat:sub-waterfall', { months_ahead }),
  featBundleAllocate: (items: Array<{ obligation_id: string; ssp: number }>, transaction_price: number) => window.electronAPI.invoke('feat:bundle:allocate', { items, transaction_price }),
  featReturnsReserveCalc: (period_start: string, period_end: string, historical_rate: number) => window.electronAPI.invoke('feat:returns-reserve:calc', { period_start, period_end, historical_rate }),
  featReturnsReserveList: () => window.electronAPI.invoke('feat:returns-reserve:list'),
  featRebateUpsert: (r: any) => window.electronAPI.invoke('feat:rebate:upsert', r),
  featRebateList: () => window.electronAPI.invoke('feat:rebate:list'),
  featCommDeferCreate: (c: any) => window.electronAPI.invoke('feat:comm-defer:create', c),
  featCommDeferAmortize: (deferral_id: string, amount: number) => window.electronAPI.invoke('feat:comm-defer:amortize', { deferral_id, amount }),
  featCommDeferList: () => window.electronAPI.invoke('feat:comm-defer:list'),
  // Batch F: Cost Accounting
  featCostCenterUpsert: (c: any) => window.electronAPI.invoke('feat:cost-center:upsert', c),
  featCostCenterList: (active_only?: boolean) => window.electronAPI.invoke('feat:cost-center:list', { active_only }),
  featCostAllocUpsert: (r: any) => window.electronAPI.invoke('feat:cost-alloc:upsert', r),
  featCostAllocRun: (rule_id: string, amount: number) => window.electronAPI.invoke('feat:cost-alloc:run', { rule_id, amount }),
  featCostAllocList: () => window.electronAPI.invoke('feat:cost-alloc:list'),
  featDeptUpsert: (d: any) => window.electronAPI.invoke('feat:dept:upsert', d),
  featDeptList: (active_only?: boolean) => window.electronAPI.invoke('feat:dept:list', { active_only }),
  featDeptPL: (department_id: string, period_start: string, period_end: string) => window.electronAPI.invoke('feat:dept:pl', { department_id, period_start, period_end }),
  featCostPoolUpsert: (p: any) => window.electronAPI.invoke('feat:cost-pool:upsert', p),
  featCostPoolList: () => window.electronAPI.invoke('feat:cost-pool:list'),
  featStdCostUpsert: (s: any) => window.electronAPI.invoke('feat:std-cost:upsert', s),
  featStdCostList: (opts?: { item_id?: string }) => window.electronAPI.invoke('feat:std-cost:list', opts || {}),
  featVarianceCalc: (v: any) => window.electronAPI.invoke('feat:variance:calc', v),
  featVarianceList: (opts?: { item_id?: string; limit?: number }) => window.electronAPI.invoke('feat:variance:list', opts || {}),
  featOverheadUpsert: (r: any) => window.electronAPI.invoke('feat:overhead:upsert', r),
  featOverheadApply: (rate_id: string, units: number) => window.electronAPI.invoke('feat:overhead:apply', { rate_id, units }),
  featOverheadList: () => window.electronAPI.invoke('feat:overhead:list'),
  featWIPUpsert: (w: any) => window.electronAPI.invoke('feat:wip:upsert', w),
  featWIPList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:wip:list', opts || {}),
  featCOGSCompute: (period_start: string, period_end: string) => window.electronAPI.invoke('feat:cogs:compute', { period_start, period_end }),
  featBurdenUpsert: (b: any) => window.electronAPI.invoke('feat:burden:upsert', b),
  featBurdenList: () => window.electronAPI.invoke('feat:burden:list'),
  // Batch G: Audit & Controls
  featTBSnapCapture: (period_end: string, fiscal_year?: number) => window.electronAPI.invoke('feat:tb-snap:capture', { period_end, fiscal_year }),
  featTBSnapCompare: (period_end_1: string, period_end_2: string) => window.electronAPI.invoke('feat:tb-snap:compare', { period_end_1, period_end_2 }),
  featTBSnapList: () => window.electronAPI.invoke('feat:tb-snap:list'),
  featMaterialityCalc: (m: any) => window.electronAPI.invoke('feat:materiality:calc', m),
  featMaterialityList: () => window.electronAPI.invoke('feat:materiality:list'),
  featAuditSampleGenerate: (opts: any) => window.electronAPI.invoke('feat:audit-sample:generate', opts),
  featAuditSampleList: () => window.electronAPI.invoke('feat:audit-sample:list'),
  featAuditConfirmUpsert: (c: any) => window.electronAPI.invoke('feat:audit-confirm:upsert', c),
  featAuditConfirmList: (opts?: { status?: string; confirmation_type?: string }) => window.electronAPI.invoke('feat:audit-confirm:list', opts || {}),
  featWalkthroughRecord: (w: any) => window.electronAPI.invoke('feat:walkthrough:record', w),
  featWalkthroughList: () => window.electronAPI.invoke('feat:walkthrough:list'),
  featSoDDeclare: (c: any) => window.electronAPI.invoke('feat:sod:declare', c),
  featSoDAssign: (a: any) => window.electronAPI.invoke('feat:sod:assign', a),
  featSoDCheck: (user_id: string) => window.electronAPI.invoke('feat:sod:check', { user_id }),
  featSoDList: () => window.electronAPI.invoke('feat:sod:list'),
  featRCSAUpsert: (r: any) => window.electronAPI.invoke('feat:rcsa:upsert', r),
  featRCSAList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:rcsa:list', opts || {}),
  featAuditIssueUpsert: (i: any) => window.electronAPI.invoke('feat:audit-issue:upsert', i),
  featAuditIssueResolve: (id: string, resolution_notes: string) => window.electronAPI.invoke('feat:audit-issue:resolve', { id, resolution_notes }),
  featAuditIssueList: (opts?: { status?: string; severity?: string }) => window.electronAPI.invoke('feat:audit-issue:list', opts || {}),
  featControlDefLog: (d: any) => window.electronAPI.invoke('feat:control-def:log', d),
  featControlDefRemediate: (id: string) => window.electronAPI.invoke('feat:control-def:remediate', { id }),
  featControlDefList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:control-def:list', opts || {}),
  featAuditorInqLog: (i: any) => window.electronAPI.invoke('feat:auditor-inq:log', i),
  featAuditorInqRespond: (id: string, response_text: string, response_by?: string, supporting_docs?: string) => window.electronAPI.invoke('feat:auditor-inq:respond', { id, response_text, response_by, supporting_docs }),
  featAuditorInqList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:auditor-inq:list', opts || {}),
  // Batch H: Budgeting & Forecasting Advanced
  featRollFcstUpsert: (f: any) => window.electronAPI.invoke('feat:roll-fcst:upsert', f),
  featRollFcstSetLines: (forecast_id: string, lines: any[]) => window.electronAPI.invoke('feat:roll-fcst:set-lines', { forecast_id, lines }),
  featRollFcstGetLines: (forecast_id: string) => window.electronAPI.invoke('feat:roll-fcst:get-lines', { forecast_id }),
  featRollFcstList: () => window.electronAPI.invoke('feat:roll-fcst:list'),
  featScenarioCreate: (s: any) => window.electronAPI.invoke('feat:scenario:create', s),
  featScenarioApply: (base_lines: any[], assumptions: any) => window.electronAPI.invoke('feat:scenario:apply', { base_lines, assumptions }),
  featScenarioList: () => window.electronAPI.invoke('feat:scenario:list'),
  featVarianceExplRecord: (v: any) => window.electronAPI.invoke('feat:variance-expl:record', v),
  featVarianceExplList: (opts?: { period_month?: string; material_only?: boolean }) => window.electronAPI.invoke('feat:variance-expl:list', opts || {}),
  featDriverUpsert: (d: any) => window.electronAPI.invoke('feat:driver:upsert', d),
  featDriverProject: (driver_id: string, periods: number) => window.electronAPI.invoke('feat:driver:project', { driver_id, periods }),
  featDriverList: () => window.electronAPI.invoke('feat:driver:list'),
  featBudgetConsCreate: (c: any) => window.electronAPI.invoke('feat:budget-cons:create', c),
  featBudgetConsApprove: (id: string, approved_by: string) => window.electronAPI.invoke('feat:budget-cons:approve', { id, approved_by }),
  featBudgetConsList: () => window.electronAPI.invoke('feat:budget-cons:list'),
  featBudgetApprLog: (a: any) => window.electronAPI.invoke('feat:budget-appr:log', a),
  featBudgetApprList: (budget_id: string) => window.electronAPI.invoke('feat:budget-appr:list', { budget_id }),
  featFcstAccRecord: (a: any) => window.electronAPI.invoke('feat:fcst-acc:record', a),
  featFcstAccSummary: (forecast_id?: string) => window.electronAPI.invoke('feat:fcst-acc:summary', { forecast_id }),
  featDirectCashUpsert: (f: any) => window.electronAPI.invoke('feat:direct-cash:upsert', f),
  featDirectCashList: (limit?: number) => window.electronAPI.invoke('feat:direct-cash:list', { limit }),
  featHeadcountUpsert: (h: any) => window.electronAPI.invoke('feat:headcount:upsert', h),
  featHeadcountList: (opts?: { fiscal_year?: number; department_id?: string }) => window.electronAPI.invoke('feat:headcount:list', opts || {}),
  featCapexUpsert: (c: any) => window.electronAPI.invoke('feat:capex:upsert', c),
  featCapexApprove: (id: string, approved_cost: number, approved_by: string) => window.electronAPI.invoke('feat:capex:approve', { id, approved_cost, approved_by }),
  featCapexList: (opts?: { approval_status?: string }) => window.electronAPI.invoke('feat:capex:list', opts || {}),
  // Batch I: Financial Statements
  featStmtCfgUpsert: (c: any) => window.electronAPI.invoke('feat:stmt-cfg:upsert', c),
  featStmtCfgList: (statement_type?: string) => window.electronAPI.invoke('feat:stmt-cfg:list', { statement_type }),
  featCommonSize: (lines: any[], base_amount: number) => window.electronAPI.invoke('feat:common-size', { lines, base_amount }),
  featRatiosCalc: (as_of_date: string) => window.electronAPI.invoke('feat:ratios:calc', { as_of_date }),
  featRatiosList: (limit?: number) => window.electronAPI.invoke('feat:ratios:list', { limit }),
  featKpiUpsert: (k: any) => window.electronAPI.invoke('feat:kpi:upsert', k),
  featKpiList: () => window.electronAPI.invoke('feat:kpi:list'),
  featFootnoteUpsert: (f: any) => window.electronAPI.invoke('feat:footnote:upsert', f),
  featFootnoteList: (opts?: { fiscal_year?: number; statement_type?: string; published_only?: boolean }) => window.electronAPI.invoke('feat:footnote:list', opts || {}),

  // ═══════════ Dynamic Wave (F261-F350, 90 runtime functions) ═══════════
  // Batch J: Global Search
  featSearchGlobal: (query: string, opts?: { limit?: number; entity_types?: string[] }) => window.electronAPI.invoke('feat:search:global', { query, opts }),
  featSearchRecordHistory: (user_id: string, query: string, result_count: number) => window.electronAPI.invoke('feat:search:record-history', { user_id, query, result_count }),
  featSearchRecent: (user_id: string, limit?: number) => window.electronAPI.invoke('feat:search:recent', { user_id, limit }),
  featRecentlyViewedList: (user_id: string, opts?: { entity_type?: string; limit?: number }) => window.electronAPI.invoke('feat:recently-viewed:list', { user_id, ...(opts || {}) }),
  featRecentlyViewedRecord: (user_id: string, entity_type: string, entity_id: string, entity_label?: string) => window.electronAPI.invoke('feat:recently-viewed:record', { user_id, entity_type, entity_id, entity_label }),
  featPinAdd: (user_id: string, entity_type: string, entity_id: string, entity_label?: string) => window.electronAPI.invoke('feat:pin:add', { user_id, entity_type, entity_id, entity_label }),
  featPinRemove: (user_id: string, entity_type: string, entity_id: string) => window.electronAPI.invoke('feat:pin:remove', { user_id, entity_type, entity_id }),
  featPinList: (user_id: string, entity_type?: string) => window.electronAPI.invoke('feat:pin:list', { user_id, entity_type }),
  featSearchPattern: (pattern: string, entity_type: string, opts?: { limit?: number }) => window.electronAPI.invoke('feat:search:pattern', { pattern, entity_type, opts }),
  featFuzzyMatch: (name: string, entity_type?: 'client' | 'vendor', threshold?: number) => window.electronAPI.invoke('feat:fuzzy-match', { name, entity_type, threshold }),
  featCrossRef: (entity_type: string, entity_id: string) => window.electronAPI.invoke('feat:cross-ref', { entity_type, entity_id }),
  // Batch K: Notifications
  featNotifCreate: (opts: any) => window.electronAPI.invoke('feat:notif:create', opts),
  featNotifList: (user_id: string, opts?: { unread_only?: boolean; limit?: number }) => window.electronAPI.invoke('feat:notif:list', { user_id, ...(opts || {}) }),
  featNotifMarkRead: (id: string) => window.electronAPI.invoke('feat:notif:mark-read', { id }),
  featNotifMarkAllRead: (user_id: string) => window.electronAPI.invoke('feat:notif:mark-all-read', { user_id }),
  featNotifSnooze: (id: string, until_date: string) => window.electronAPI.invoke('feat:notif:snooze', { id, until_date }),
  featNotifSetPref: (opts: any) => window.electronAPI.invoke('feat:notif:set-pref', opts),
  featNotifGetPrefs: (user_id: string) => window.electronAPI.invoke('feat:notif:get-prefs', { user_id }),
  featAlertRuleCreate: (rule: any) => window.electronAPI.invoke('feat:alert-rule:create', rule),
  featAlertRuleEvaluate: (entity_type: string, entity_data: any) => window.electronAPI.invoke('feat:alert-rule:evaluate', { entity_type, entity_data }),
  featDigestBuild: (user_id: string, period?: 'daily' | 'weekly') => window.electronAPI.invoke('feat:digest:build', { user_id, period }),
  // Batch L: Import / Export
  featCsvParse: (text: string) => window.electronAPI.invoke('feat:csv:parse', { text }),
  featCsvDetectMapping: (headers: string[], entity_type: string) => window.electronAPI.invoke('feat:csv:detect-mapping', { headers, entity_type }),
  featCsvValidate: (rows: any[], mapping: Record<string, string>, entity_type: string) => window.electronAPI.invoke('feat:csv:validate', { rows, mapping, entity_type }),
  featImportTplSave: (tpl: any) => window.electronAPI.invoke('feat:import-tpl:save', tpl),
  featImportTplList: (entity_type?: string) => window.electronAPI.invoke('feat:import-tpl:list', { entity_type }),
  featExportCsv: (rows: any[], columns: string[]) => window.electronAPI.invoke('feat:export:csv', { rows, columns }),
  featExportIif: (transactions: any[]) => window.electronAPI.invoke('feat:export:iif', { transactions }),
  featExportJobCreate: (j: any) => window.electronAPI.invoke('feat:export-job:create', j),
  featExportJobList: (active_only?: boolean) => window.electronAPI.invoke('feat:export-job:list', { active_only }),
  featExportJobMarkRun: (job_id: string, output_path?: string) => window.electronAPI.invoke('feat:export-job:mark-run', { job_id, output_path }),
  // Batch M: Bulk Actions
  featBulkUpdate: (opts: { entity_type: string; ids: string[]; fields: Record<string, any>; user_id?: string }) => window.electronAPI.invoke('feat:bulk:update', opts),
  featBulkDelete: (opts: { entity_type: string; ids: string[]; soft?: boolean; user_id?: string }) => window.electronAPI.invoke('feat:bulk:delete', opts),
  featBulkArchive: (opts: { entity_type: string; ids: string[]; user_id?: string }) => window.electronAPI.invoke('feat:bulk:archive', opts),
  featBulkChangeStatus: (opts: { entity_type: string; ids: string[]; status: string; user_id?: string }) => window.electronAPI.invoke('feat:bulk:change-status', opts),
  featBulkAssign: (opts: { entity_type: string; ids: string[]; assignee_id: string; assignee_field?: string; user_id?: string }) => window.electronAPI.invoke('feat:bulk:assign', opts),
  featBulkTag: (opts: { entity_type: string; entity_ids: string[]; tag_ids: string[] }) => window.electronAPI.invoke('feat:bulk:tag', opts),
  featBulkUntag: (opts: { entity_type: string; entity_ids: string[]; tag_ids: string[] }) => window.electronAPI.invoke('feat:bulk:untag', opts),
  featUndoList: (user_id?: string, limit?: number) => window.electronAPI.invoke('feat:undo:list', { user_id, limit }),
  featUndoApply: (snapshot_id: string) => window.electronAPI.invoke('feat:undo:apply', { snapshot_id }),
  featUndoCreateSnapshot: (opts: any) => window.electronAPI.invoke('feat:undo:create-snapshot', opts),
  // Batch N: Smart Helpers
  featSmartAnomalies: (opts?: { lookback_days?: number; z_threshold?: number }) => window.electronAPI.invoke('feat:smart:anomalies', opts || {}),
  featSmartSuggestCategory: (description: string, vendor_id?: string) => window.electronAPI.invoke('feat:smart:suggest-category', { description, vendor_id }),
  featSmartPredictPayment: (invoice_id: string) => window.electronAPI.invoke('feat:smart:predict-payment', { invoice_id }),
  featSmartFillFromPrevious: (entity_type: 'expense' | 'bill', context: { vendor_id?: string; description?: string }) => window.electronAPI.invoke('feat:smart:fill-from-previous', { entity_type, context }),
  featSmartCanonicalizeVendor: (input_name: string) => window.electronAPI.invoke('feat:smart:canonicalize-vendor', { input_name }),
  featSmartMatchTransaction: (transaction_id: string, opts?: { tolerance_days?: number; tolerance_amount_percent?: number }) => window.electronAPI.invoke('feat:smart:match-transaction', { transaction_id, opts }),
  featSmartLateRisk: (customer_id: string) => window.electronAPI.invoke('feat:smart:late-risk', { customer_id }),
  featSmartForecast: (account_id: string, periods?: number) => window.electronAPI.invoke('feat:smart:forecast', { account_id, periods }),
  featSmartRecommend: (user_id: string, limit?: number) => window.electronAPI.invoke('feat:smart:recommend', { user_id, limit }),
  featSmartDetectDupes: (entity_type?: 'expense' | 'bill', lookback_days?: number) => window.electronAPI.invoke('feat:smart:detect-dupes', { entity_type, lookback_days }),
  // Batch O: Keyboard & Macros
  featCmdRegister: (c: any) => window.electronAPI.invoke('feat:cmd:register', c),
  featCmdList: (opts?: { category?: string; scope?: string }) => window.electronAPI.invoke('feat:cmd:list', opts || {}),
  featCmdSearch: (query: string, limit?: number) => window.electronAPI.invoke('feat:cmd:search', { query, limit }),
  featMacroStart: (user_id: string, name: string, scope?: string) => window.electronAPI.invoke('feat:macro:start', { user_id, name, scope }),
  featMacroSaveSteps: (macro_id: string, steps: any[]) => window.electronAPI.invoke('feat:macro:save-steps', { macro_id, steps }),
  featMacroGetSteps: (macro_id: string) => window.electronAPI.invoke('feat:macro:get-steps', { macro_id }),
  featMacroList: (user_id: string) => window.electronAPI.invoke('feat:macro:list', { user_id }),
  featLayoutSave: (opts: { user_id: string; name: string; layout: any; is_default?: boolean }) => window.electronAPI.invoke('feat:layout:save', opts),
  featLayoutLoad: (user_id: string, name?: string) => window.electronAPI.invoke('feat:layout:load', { user_id, name }),
  featLayoutList: (user_id: string) => window.electronAPI.invoke('feat:layout:list', { user_id }),
  // Batch P: Report Engine
  featCustomReportCreate: (r: any) => window.electronAPI.invoke('feat:custom-report:create', r),
  featCustomReportRun: (report_id: string, params?: Record<string, any>) => window.electronAPI.invoke('feat:custom-report:run', { report_id, params }),
  featPivotBuild: (rows: any[], opts: { row_field: string; col_field: string; value_field: string; agg?: 'sum' | 'avg' | 'count' | 'min' | 'max' }) => window.electronAPI.invoke('feat:pivot:build', { rows, opts }),
  featReportSchedSave: (s: any) => window.electronAPI.invoke('feat:report-sched:save', s),
  featReportSchedList: () => window.electronAPI.invoke('feat:report-sched:list'),
  featReportSchedDue: () => window.electronAPI.invoke('feat:report-sched:due'),
  featReportSchedMarkRun: (schedule_id: string, next_run_at?: string) => window.electronAPI.invoke('feat:report-sched:mark-run', { schedule_id, next_run_at }),
  featCustomReportCompare: (report_id: string, params_a: any, params_b: any) => window.electronAPI.invoke('feat:custom-report:compare', { report_id, params_a, params_b }),
  featCustomReportExecutions: (report_id: string, limit?: number) => window.electronAPI.invoke('feat:custom-report:executions', { report_id, limit }),
  featCustomReportList: (opts?: { published_only?: boolean }) => window.electronAPI.invoke('feat:custom-report:list', opts || {}),
  // Batch Q: Webhook Delivery
  featWebhookRegister: (opts: { url: string; event_types: string[]; secret?: string }) => window.electronAPI.invoke('feat:webhook:register', opts),
  featWebhookSign: (payload: any, secret: string) => window.electronAPI.invoke('feat:webhook:sign', { payload, secret }),
  featWebhookVerify: (payload: any, signature: string, secret: string) => window.electronAPI.invoke('feat:webhook:verify', { payload, signature, secret }),
  featWebhookQueue: (opts: { subscription_id: string; event_type: string; payload: any }) => window.electronAPI.invoke('feat:webhook:queue', opts),
  featWebhookDue: (limit?: number) => window.electronAPI.invoke('feat:webhook:due', { limit }),
  featWebhookRecordAttempt: (queue_id: string, success: boolean, error_message?: string) => window.electronAPI.invoke('feat:webhook:record-attempt', { queue_id, success, error_message }),
  featWebhookDeliveries: (opts?: { subscription_id?: string; status?: string; limit?: number }) => window.electronAPI.invoke('feat:webhook:deliveries', opts || {}),
  featWebhookRetry: (queue_id: string) => window.electronAPI.invoke('feat:webhook:retry', { queue_id }),
  featWebhookStats: (hours?: number) => window.electronAPI.invoke('feat:webhook:stats', { hours }),
  featWebhookFireEvent: (event_type: string, payload: any) => window.electronAPI.invoke('feat:webhook:fire-event', { event_type, payload }),
  // Batch R: Real-time + Activity
  featActivityRecord: (a: any) => window.electronAPI.invoke('feat:activity:record', a),
  featActivityFeed: (opts?: { user_id?: string; entity_type?: string; entity_id?: string; limit?: number; since?: string }) => window.electronAPI.invoke('feat:activity:feed', opts || {}),
  featLockAcquire: (opts: { entity_type: string; entity_id: string; user_id: string; user_email?: string; ttl_seconds?: number }) => window.electronAPI.invoke('feat:lock:acquire', opts),
  featLockRelease: (entity_type: string, entity_id: string, user_id: string) => window.electronAPI.invoke('feat:lock:release', { entity_type, entity_id, user_id }),
  featLockCheck: (entity_type: string, entity_id: string) => window.electronAPI.invoke('feat:lock:check', { entity_type, entity_id }),
  featPresenceHeartbeat: (opts: { user_id: string; current_page?: string; current_entity_type?: string; current_entity_id?: string }) => window.electronAPI.invoke('feat:presence:heartbeat', opts),
  featPresenceActive: (seconds_window?: number) => window.electronAPI.invoke('feat:presence:active', { seconds_window }),
  featPresenceOnEntity: (entity_type: string, entity_id: string, seconds_window?: number) => window.electronAPI.invoke('feat:presence:on-entity', { entity_type, entity_id, seconds_window }),
  featActivitySummary: (opts?: { hours?: number }) => window.electronAPI.invoke('feat:activity:summary', opts || {}),
  featLockCleanup: () => window.electronAPI.invoke('feat:lock:cleanup'),

  // ═══════════════ Wave 3 (F351-F440, 90 features) ═══════════════
  // Batch S — Payroll
  featStateWhUpsert: (t: any) => window.electronAPI.invoke('feat:state-wh:upsert', t),
  featStateWhCalc: (opts: any) => window.electronAPI.invoke('feat:state-wh:calc', opts),
  featGarnUpsert: (g: any) => window.electronAPI.invoke('feat:garn:upsert', g),
  featGarnCalc: (employee_id: string, disposable_earnings: number) => window.electronAPI.invoke('feat:garn:calc', { employee_id, disposable_earnings }),
  featGarnList: (opts?: any) => window.electronAPI.invoke('feat:garn:list', opts || {}),
  featRetireUpsert: (r: any) => window.electronAPI.invoke('feat:retire:upsert', r),
  featRetireCalc: (employee_id: string, period_wages: number) => window.electronAPI.invoke('feat:retire:calc', { employee_id, period_wages }),
  featS125Upsert: (s: any) => window.electronAPI.invoke('feat:s125:upsert', s),
  featS125List: (employee_id: string) => window.electronAPI.invoke('feat:s125:list', { employee_id }),
  featPtoRuleUpsert: (r: any) => window.electronAPI.invoke('feat:pto-rule:upsert', r),
  featPtoRuleList: () => window.electronAPI.invoke('feat:pto-rule:list'),
  featEmpStateSet: (opts: any) => window.electronAPI.invoke('feat:emp-state:set', opts),
  featEmpStateGet: (employee_id: string) => window.electronAPI.invoke('feat:emp-state:get', { employee_id }),
  featWcompUpsert: (c: any) => window.electronAPI.invoke('feat:wcomp:upsert', c),
  featWcompCalc: (state_code: string, class_code: string, payroll: number) => window.electronAPI.invoke('feat:wcomp:calc', { state_code, class_code, payroll }),
  featRecipUpsert: (opts: any) => window.electronAPI.invoke('feat:recip:upsert', opts),
  featRecipCheck: (work_state: string, resident_state: string) => window.electronAPI.invoke('feat:recip:check', { work_state, resident_state }),
  featW2Run: (opts: { tax_year: number; submitted_by?: string }) => window.electronAPI.invoke('feat:w2:run', opts),
  featDdBatchBuild: (opts: any) => window.electronAPI.invoke('feat:dd-batch:build', opts),
  featDdBatchList: (limit?: number) => window.electronAPI.invoke('feat:dd-batch:list', { limit }),

  // Batch T — Sales Tax
  featNexusUpsert: (n: any) => window.electronAPI.invoke('feat:nexus:upsert', n),
  featNexusEvaluate: () => window.electronAPI.invoke('feat:nexus:evaluate'),
  featTaxJurisUpsert: (j: any) => window.electronAPI.invoke('feat:tax-juris:upsert', j),
  featTaxJurisByZip: (zip: string) => window.electronAPI.invoke('feat:tax-juris:by-zip', { zip }),
  featExemptCertUpsert: (c: any) => window.electronAPI.invoke('feat:exempt-cert:upsert', c),
  featExemptCertCheck: (customer_id: string, state_code?: string) => window.electronAPI.invoke('feat:exempt-cert:check', { customer_id, state_code }),
  featExemptCertList: (opts?: any) => window.electronAPI.invoke('feat:exempt-cert:list', opts || {}),
  featUseTaxRecord: (u: any) => window.electronAPI.invoke('feat:use-tax:record', u),
  featTaxSchedUpsert: (s: any) => window.electronAPI.invoke('feat:tax-sched:upsert', s),
  featTaxSchedUpcoming: (days_ahead?: number) => window.electronAPI.invoke('feat:tax-sched:upcoming', { days_ahead }),
  featTaxLiabRecord: (l: any) => window.electronAPI.invoke('feat:tax-liab:record', l),
  featTaxLiabMarkPaid: (id: string, payment_je_id?: string) => window.electronAPI.invoke('feat:tax-liab:mark-paid', { id, payment_je_id }),
  featTaxLiabList: (opts?: any) => window.electronAPI.invoke('feat:tax-liab:list', opts || {}),
  featTaxHolidayUpsert: (h: any) => window.electronAPI.invoke('feat:tax-holiday:upsert', h),
  featTaxHolidayActive: (state_code?: string) => window.electronAPI.invoke('feat:tax-holiday:active', { state_code }),

  // Batch U — Consolidation
  featEntitySetSub: (parent_id: string, child_id: string, ownership_pct: number, method?: string, notes?: string) => window.electronAPI.invoke('feat:entity:set-sub', { parent_id, child_id, ownership_pct, method, notes }),
  featEntityHierarchy: (parent_id: string) => window.electronAPI.invoke('feat:entity:hierarchy', { parent_id }),
  featElimRuleUpsert: (r: any) => window.electronAPI.invoke('feat:elim-rule:upsert', r),
  featElimRuleList: (parent_id: string) => window.electronAPI.invoke('feat:elim-rule:list', { parent_id }),
  featConsolGenerate: (opts: { parent_company_id: string; statement_type: 'balance_sheet' | 'income_statement'; period_end: string; generated_by?: string }) => window.electronAPI.invoke('feat:consol:generate', opts),
  featFxTranslationRecord: (t: any) => window.electronAPI.invoke('feat:fx-translation:record', t),
  featMinorityCalc: (opts: any) => window.electronAPI.invoke('feat:minority:calc', opts),
  featGoodwillRecord: (g: any) => window.electronAPI.invoke('feat:goodwill:record', g),
  featGoodwillImpair: (goodwill_id: string, impairment_amount: number) => window.electronAPI.invoke('feat:goodwill:impair', { goodwill_id, impairment_amount }),
  featEquityInvUpsert: (e: any) => window.electronAPI.invoke('feat:equity-inv:upsert', e),
  featEquityInvRecordIncome: (investment_id: string, investee_income: number) => window.electronAPI.invoke('feat:equity-inv:record-income', { investment_id, investee_income }),
  featEquityInvList: (investor_company_id: string) => window.electronAPI.invoke('feat:equity-inv:list', { investor_company_id }),

  // Batch V — Customer Portal
  featPortalCustInvite: (opts: { customer_id: string; email: string; full_name?: string }) => window.electronAPI.invoke('feat:portal-cust:invite', opts),
  featPortalActivate: (token: string, password: string) => window.electronAPI.invoke('feat:portal:activate', { token, password }),
  featPortalAuth: (email: string, password: string, company_id: string, portal_type?: string) => window.electronAPI.invoke('feat:portal:auth', { email, password, company_id, portal_type }),
  featPortalInvoices: (customer_id: string) => window.electronAPI.invoke('feat:portal:invoices', { customer_id }),
  featPortalPayRecord: (opts: any) => window.electronAPI.invoke('feat:portal-pay:record', opts),
  featPortalPayHistory: (portal_user_id: string, limit?: number) => window.electronAPI.invoke('feat:portal-pay:history', { portal_user_id, limit }),
  featPortalStatement: (customer_id: string, period_start: string, period_end: string) => window.electronAPI.invoke('feat:portal:statement', { customer_id, period_start, period_end }),
  featPortalTicketCreate: (t: any) => window.electronAPI.invoke('feat:portal-ticket:create', t),
  featPortalTicketList: (opts?: any) => window.electronAPI.invoke('feat:portal-ticket:list', opts || {}),
  featPortalDocUpload: (d: any) => window.electronAPI.invoke('feat:portal-doc:upload', d),
  featAutoPayEnroll: (opts: { customer_id: string; payment_method_id: string; max_amount_per_charge?: number }) => window.electronAPI.invoke('feat:auto-pay:enroll', opts),
  featAutoPayCancel: (customer_id: string) => window.electronAPI.invoke('feat:auto-pay:cancel', { customer_id }),
  featPortalBrandSet: (b: any) => window.electronAPI.invoke('feat:portal-brand:set', b),
  featPortalBrandGet: () => window.electronAPI.invoke('feat:portal-brand:get'),

  // Batch W — Vendor Portal
  featPortalVendInvite: (opts: { vendor_id: string; email: string; full_name?: string }) => window.electronAPI.invoke('feat:portal-vend:invite', opts),
  featVendorPoRespond: (opts: any) => window.electronAPI.invoke('feat:vendor-po:respond', opts),
  featVendorPoListResponses: (po_id?: string) => window.electronAPI.invoke('feat:vendor-po:list-responses', { po_id }),
  featVendorInvSubmit: (v: any) => window.electronAPI.invoke('feat:vendor-inv:submit', v),
  featVendorInvReview: (id: string, status: 'approved' | 'rejected', reviewed_by: string, rejection_reason?: string, matched_bill_id?: string) => window.electronAPI.invoke('feat:vendor-inv:review', { id, status, reviewed_by, rejection_reason, matched_bill_id }),
  featVendorInvList: (opts?: any) => window.electronAPI.invoke('feat:vendor-inv:list', opts || {}),
  featVendorPayStatus: (vendor_id: string) => window.electronAPI.invoke('feat:vendor-pay:status', { vendor_id }),
  featVendorAchSubmit: (opts: any) => window.electronAPI.invoke('feat:vendor-ach:submit', opts),
  featVendorAchApprove: (id: string, approved_by: string) => window.electronAPI.invoke('feat:vendor-ach:approve', { id, approved_by }),
  featVendor1099Download: (opts: any) => window.electronAPI.invoke('feat:vendor-1099:download', opts),
  featVendorAttestSubmit: (opts: any) => window.electronAPI.invoke('feat:vendor-attest:submit', opts),

  // Batch X — Time Tracking
  featTimerStart: (opts: { user_id: string; project_id?: string; task_id?: string; description?: string; is_billable?: boolean }) => window.electronAPI.invoke('feat:timer:start', opts),
  featTimerPause: (id: string) => window.electronAPI.invoke('feat:timer:pause', { id }),
  featTimerResume: (id: string) => window.electronAPI.invoke('feat:timer:resume', { id }),
  featTimerStop: (id: string) => window.electronAPI.invoke('feat:timer:stop', { id }),
  featTimerRunning: (user_id: string) => window.electronAPI.invoke('feat:timer:running', { user_id }),
  featRateUpsert: (r: any) => window.electronAPI.invoke('feat:rate:upsert', r),
  featRateEffective: (opts: { employee_id?: string; project_id?: string; role?: string; as_of_date?: string }) => window.electronAPI.invoke('feat:rate:effective', opts),
  featOtUpsert: (r: any) => window.electronAPI.invoke('feat:ot:upsert', r),
  featOtCalc: (opts: { daily_hours: number[]; weekly_hours: number; base_rate: number; state_code?: string }) => window.electronAPI.invoke('feat:ot:calc', opts),
  featProjTimeBudgetUpsert: (b: any) => window.electronAPI.invoke('feat:proj-time-budget:upsert', b),
  featProjTimeBudgetAddHours: (project_id: string, hours: number) => window.electronAPI.invoke('feat:proj-time-budget:add-hours', { project_id, hours }),
  featCalEventSync: (e: any) => window.electronAPI.invoke('feat:cal-event:sync', e),
  featCalEventToTimeEntry: (event_id: string, project_id?: string, task_id?: string) => window.electronAPI.invoke('feat:cal-event:to-time-entry', { event_id, project_id, task_id }),
  featTimeRound: (minutes: number, interval_minutes?: number, method?: 'nearest' | 'up' | 'down') => window.electronAPI.invoke('feat:time:round', { minutes, interval_minutes, method }),

  // Batch Y — Document Intelligence
  featDocClassify: (text: string) => window.electronAPI.invoke('feat:doc:classify', { text }),
  featDocRecordClassify: (opts: any) => window.electronAPI.invoke('feat:doc:record-classify', opts),
  featDocFieldExtract: (document_id: string, field_name: string, field_value: string, confidence?: number, method?: string) => window.electronAPI.invoke('feat:doc-field:extract', { document_id, field_name, field_value, confidence, method }),
  featDocFieldList: (document_id: string) => window.electronAPI.invoke('feat:doc-field:list', { document_id }),
  featBankStmtParse: (text: string) => window.electronAPI.invoke('feat:bank-stmt:parse', { text }),
  featBankStmtImport: (opts: any) => window.electronAPI.invoke('feat:bank-stmt:import', opts),
  featClausesDetect: (text: string, document_id: string) => window.electronAPI.invoke('feat:clauses:detect', { text, document_id }),
  featClausesList: (document_id: string) => window.electronAPI.invoke('feat:clauses:list', { document_id }),
  featSignFlowStart: (opts: any) => window.electronAPI.invoke('feat:sign-flow:start', opts),
  featSignFlowAdvance: (workflow_id: string) => window.electronAPI.invoke('feat:sign-flow:advance', { workflow_id }),
  featDocExpireList: (days_ahead?: number) => window.electronAPI.invoke('feat:doc-expire:list', { days_ahead }),
  featRetentionUpsertPolicy: (p: any) => window.electronAPI.invoke('feat:retention:upsert-policy', p),
  featRetentionExceeding: () => window.electronAPI.invoke('feat:retention:exceeding'),

  // Batch Z — Collaboration
  featMentionsParse: (body: string) => window.electronAPI.invoke('feat:mentions:parse', { body }),
  featMentionsList: (user_id: string, opts?: { unread_only?: boolean; limit?: number }) => window.electronAPI.invoke('feat:mentions:list', { user_id, ...(opts || {}) }),
  featMentionsMarkRead: (id: string) => window.electronAPI.invoke('feat:mentions:mark-read', { id }),
  featCommentAdd: (c: any) => window.electronAPI.invoke('feat:comment:add', c),
  featCommentList: (entity_type: string, entity_id: string, opts?: { include_internal?: boolean }) => window.electronAPI.invoke('feat:comment:list', { entity_type, entity_id, ...(opts || {}) }),
  featCommentEdit: (id: string, body: string) => window.electronAPI.invoke('feat:comment:edit', { id, body }),
  featCommentDelete: (id: string) => window.electronAPI.invoke('feat:comment:delete', { id }),
  featReactionAdd: (comment_id: string, user_id: string, emoji: string) => window.electronAPI.invoke('feat:reaction:add', { comment_id, user_id, emoji }),
  featReactionRemove: (comment_id: string, user_id: string, emoji: string) => window.electronAPI.invoke('feat:reaction:remove', { comment_id, user_id, emoji }),
  featReactionList: (comment_id: string) => window.electronAPI.invoke('feat:reaction:list', { comment_id }),
  featInternalNoteAdd: (n: any) => window.electronAPI.invoke('feat:internal-note:add', n),
  featInternalNoteList: (entity_type: string, entity_id: string) => window.electronAPI.invoke('feat:internal-note:list', { entity_type, entity_id }),
  featDraftCreate: (d: any) => window.electronAPI.invoke('feat:draft:create', d),
  featDraftMine: (user_id: string) => window.electronAPI.invoke('feat:draft:mine', { user_id }),
  featWatchAdd: (opts: any) => window.electronAPI.invoke('feat:watch:add', opts),
  featWatchRemove: (user_id: string, entity_type: string, entity_id: string) => window.electronAPI.invoke('feat:watch:remove', { user_id, entity_type, entity_id }),
  featWatchListForEntity: (entity_type: string, entity_id: string) => window.electronAPI.invoke('feat:watch:list-for-entity', { entity_type, entity_id }),
  featInboxProvision: (opts: { entity_type: string; entity_id?: string }) => window.electronAPI.invoke('feat:inbox:provision', opts),
  featInboxMatch: (inbox_address: string) => window.electronAPI.invoke('feat:inbox:match', { inbox_address }),
  featChatSend: (opts: any) => window.electronAPI.invoke('feat:chat:send', opts),
  featChatList: (opts: { user_id: string; with_user_id?: string; channel_id?: string; limit?: number }) => window.electronAPI.invoke('feat:chat:list', opts),
  featChatMarkRead: (id: string) => window.electronAPI.invoke('feat:chat:mark-read', { id }),

  // Batch AA — Integration Sync
  featStripeRecord: (opts: any) => window.electronAPI.invoke('feat:stripe:record', opts),
  featPlaidLinkCreate: (opts: any) => window.electronAPI.invoke('feat:plaid-link:create', opts),
  featPlaidLinkList: () => window.electronAPI.invoke('feat:plaid-link:list'),
  featPlaidTxSync: (t: any) => window.electronAPI.invoke('feat:plaid-tx:sync', t),
  featPlaidTxUnmatched: (limit?: number) => window.electronAPI.invoke('feat:plaid-tx:unmatched', { limit }),
  featPlaidTxMatch: (id: string, entity_type: string, entity_id: string) => window.electronAPI.invoke('feat:plaid-tx:match', { id, entity_type, entity_id }),
  featQbExportRun: (opts: { period_start: string; period_end: string; format?: 'iif' | 'csv' | 'json'; exported_by?: string }) => window.electronAPI.invoke('feat:qb-export:run', opts),
  featQbExportList: (limit?: number) => window.electronAPI.invoke('feat:qb-export:list', { limit }),
  featGmailSync: (m: any) => window.electronAPI.invoke('feat:gmail:sync', m),
  featCloudFileRecord: (f: any) => window.electronAPI.invoke('feat:cloud-file:record', f),
  featCloudFileList: (provider?: string) => window.electronAPI.invoke('feat:cloud-file:list', { provider }),
  featCalendarLink: (opts: any) => window.electronAPI.invoke('feat:calendar:link', opts),
  featCalendarIntegrations: (user_id: string) => window.electronAPI.invoke('feat:calendar:integrations', { user_id }),
  featWebhookRecvProvision: (opts: { provider?: string }) => window.electronAPI.invoke('feat:webhook-recv:provision', opts),
  featWebhookRecvReceived: (endpoint_path: string) => window.electronAPI.invoke('feat:webhook-recv:received', { endpoint_path }),
  featWebhookRecvList: () => window.electronAPI.invoke('feat:webhook-recv:list'),

  // ═══════════════ Finance Wave (F441-F540, 100 features) ═══════════════
  // Batch AB — Invoice Advanced
  featRecInvUpsert: (t: any) => window.electronAPI.invoke('feat:rec-inv:upsert', t),
  featRecInvList: (active_only?: boolean) => window.electronAPI.invoke('feat:rec-inv:list', { active_only }),
  featRecInvDue: () => window.electronAPI.invoke('feat:rec-inv:due'),
  featRecInvAdvance: (id: string, generated_invoice_id?: string) => window.electronAPI.invoke('feat:rec-inv:advance', { id, generated_invoice_id }),
  featInvApprovalLog: (opts: any) => window.electronAPI.invoke('feat:inv-approval:log', opts),
  featInvApprovalList: (invoice_id: string) => window.electronAPI.invoke('feat:inv-approval:list', { invoice_id }),
  featInvEmailLog: (e: any) => window.electronAPI.invoke('feat:inv-email:log', e),
  featInvEmailOpened: (tracking_pixel_id: string) => window.electronAPI.invoke('feat:inv-email:opened', { tracking_pixel_id }),
  featInvEmailClicked: (tracking_pixel_id: string) => window.electronAPI.invoke('feat:inv-email:clicked', { tracking_pixel_id }),
  featLateFeeUpsert: (p: any) => window.electronAPI.invoke('feat:latefee:upsert', p),
  featLateFeeCalc: (opts: { invoice_balance: number; days_overdue: number; policy_id: string }) => window.electronAPI.invoke('feat:latefee:calc', opts),
  featPayTermsUpsert: (t: any) => window.electronAPI.invoke('feat:pay-terms:upsert', t),
  featPayTermsList: () => window.electronAPI.invoke('feat:pay-terms:list'),
  featEarlyDiscCalc: (invoice_id: string, payment_date: string) => window.electronAPI.invoke('feat:early-disc:calc', { invoice_id, payment_date }),
  featProgBillCreate: (p: any) => window.electronAPI.invoke('feat:prog-bill:create', p),
  featProgBillRelease: (schedule_id: string, opts: { percent_complete: number; invoice_id?: string; notes?: string }) => window.electronAPI.invoke('feat:prog-bill:release', { schedule_id, ...opts }),
  featProgBillList: () => window.electronAPI.invoke('feat:prog-bill:list'),
  featRetainerCreate: (r: any) => window.electronAPI.invoke('feat:retainer:create', r),
  featRetainerDrawdown: (retainer_id: string, amount: number, reason?: string, invoice_id?: string) => window.electronAPI.invoke('feat:retainer:drawdown', { retainer_id, amount, reason, invoice_id }),
  featRetainerList: (opts?: { client_id?: string; status?: string }) => window.electronAPI.invoke('feat:retainer:list', opts || {}),
  featPayPlanCreate: (p: any) => window.electronAPI.invoke('feat:pay-plan:create', p),
  featPayPlanPayInstallment: (installment_id: string, amount: number) => window.electronAPI.invoke('feat:pay-plan:pay-installment', { installment_id, amount }),
  featPayPlanList: (opts?: any) => window.electronAPI.invoke('feat:pay-plan:list', opts || {}),
  featInvAttachAdd: (a: any) => window.electronAPI.invoke('feat:inv-attach:add', a),
  featInvAttachList: (invoice_id: string) => window.electronAPI.invoke('feat:inv-attach:list', { invoice_id }),
  // Batch AC — Payment Processing
  featPayLinkCreate: (opts: any) => window.electronAPI.invoke('feat:pay-link:create', opts),
  featPayLinkConsume: (short_code: string, amount?: number) => window.electronAPI.invoke('feat:pay-link:consume', { short_code, amount }),
  featReminderUpsert: (c: any) => window.electronAPI.invoke('feat:reminder:upsert', c),
  featReminderList: () => window.electronAPI.invoke('feat:reminder:list'),
  featPayRetryRecord: (opts: any) => window.electronAPI.invoke('feat:pay-retry:record', opts),
  featPayApplyPartial: (invoice_id: string, amount: number) => window.electronAPI.invoke('feat:pay:apply-partial', { invoice_id, amount }),
  featCustCreditAdd: (opts: any) => window.electronAPI.invoke('feat:cust-credit:add', opts),
  featCustCreditApply: (opts: any) => window.electronAPI.invoke('feat:cust-credit:apply', opts),
  featCustCreditGet: (customer_id: string) => window.electronAPI.invoke('feat:cust-credit:get', { customer_id }),
  featRefundRecord: (r: any) => window.electronAPI.invoke('feat:refund:record', r),
  featRefundList: (opts?: any) => window.electronAPI.invoke('feat:refund:list', opts || {}),
  featChargebackRecord: (c: any) => window.electronAPI.invoke('feat:chargeback:record', c),
  featChargebackResolve: (id: string, resolution: 'won' | 'lost', resolved_at?: string) => window.electronAPI.invoke('feat:chargeback:resolve', { id, resolution, resolved_at }),
  featCustPmAdd: (m: any) => window.electronAPI.invoke('feat:cust-pm:add', m),
  featCustPmList: (customer_id: string) => window.electronAPI.invoke('feat:cust-pm:list', { customer_id }),
  featCheckPrintRecord: (j: any) => window.electronAPI.invoke('feat:check-print:record', j),
  featCheckPrintList: (limit?: number) => window.electronAPI.invoke('feat:check-print:list', { limit }),
  featCryptoRecord: (p: any) => window.electronAPI.invoke('feat:crypto:record', p),
  // Batch AD — Expense Advanced
  featExpReportCreate: (r: any) => window.electronAPI.invoke('feat:exp-report:create', r),
  featExpReportAddExpenses: (report_id: string, expense_ids: string[]) => window.electronAPI.invoke('feat:exp-report:add-expenses', { report_id, expense_ids }),
  featExpReportSubmit: (report_id: string) => window.electronAPI.invoke('feat:exp-report:submit', { report_id }),
  featExpReportApprove: (report_id: string, approved_by: string) => window.electronAPI.invoke('feat:exp-report:approve', { report_id, approved_by }),
  featExpReportList: (opts?: any) => window.electronAPI.invoke('feat:exp-report:list', opts || {}),
  featPerDiemUpsert2: (p: any) => window.electronAPI.invoke('feat:perdiem:upsert', p),
  featPerDiemCalc: (location: string, days: number, include_lodging?: boolean) => window.electronAPI.invoke('feat:perdiem:calc', { location, days, include_lodging }),
  featVehicleUpsert: (v: any) => window.electronAPI.invoke('feat:vehicle:upsert', v),
  featVehicleList: (user_id: string) => window.electronAPI.invoke('feat:vehicle:list', { user_id }),
  featExpRecurring: () => window.electronAPI.invoke('feat:exp:recurring'),
  featExpForecast: (months_ahead?: number) => window.electronAPI.invoke('feat:exp:forecast', { months_ahead }),
  featVendor1099Recalc: (tax_year: number, vendor_id?: string) => window.electronAPI.invoke('feat:vendor-1099:recalc', { tax_year, vendor_id }),
  featVendor1099Required: (tax_year: number) => window.electronAPI.invoke('feat:vendor-1099:required', { tax_year }),
  featCatBudgetUpsert: (b: any) => window.electronAPI.invoke('feat:cat-budget:upsert', b),
  featCatBudgetRefreshActuals: (fiscal_year: number) => window.electronAPI.invoke('feat:cat-budget:refresh-actuals', { fiscal_year }),
  featReimbCreate: (r: any) => window.electronAPI.invoke('feat:reimb:create', r),
  featReimbPaid: (id: string, je_id?: string, payment_method?: string) => window.electronAPI.invoke('feat:reimb:paid', { id, je_id, payment_method }),
  featExpRebillable: (expense_id: string, client_id: string, markup_pct?: number) => window.electronAPI.invoke('feat:exp:rebillable', { expense_id, client_id, markup_pct }),
  featExpRebillableList: (client_id?: string) => window.electronAPI.invoke('feat:exp:rebillable-list', { client_id }),
  featExpRebilled: (expense_id: string, invoice_id: string) => window.electronAPI.invoke('feat:exp:rebilled', { expense_id, invoice_id }),
  featPreapprovalRequest: (p: any) => window.electronAPI.invoke('feat:preapproval:request', p),
  featPreapprovalApprove: (id: string, approved_by: string) => window.electronAPI.invoke('feat:preapproval:approve', { id, approved_by }),
  featPreapprovalReject: (id: string, reason: string) => window.electronAPI.invoke('feat:preapproval:reject', { id, reason }),
  featPreapprovalList: (opts?: any) => window.electronAPI.invoke('feat:preapproval:list', opts || {}),
  // Batch AE — Subscriptions
  featSubPlanUpsert: (p: any) => window.electronAPI.invoke('feat:sub-plan:upsert', p),
  featSubPlanList: () => window.electronAPI.invoke('feat:sub-plan:list'),
  featSubCreate: (s: any) => window.electronAPI.invoke('feat:sub:create', s),
  featSubChangePlan: (subscription_id: string, new_plan_id: string) => window.electronAPI.invoke('feat:sub:change-plan', { subscription_id, new_plan_id }),
  featSubPause: (id: string, resume_date?: string) => window.electronAPI.invoke('feat:sub:pause', { id, resume_date }),
  featSubResume: (id: string) => window.electronAPI.invoke('feat:sub:resume', { id }),
  featSubCancel: (id: string, at_period_end?: boolean) => window.electronAPI.invoke('feat:sub:cancel', { id, at_period_end }),
  featUsageRecord: (u: any) => window.electronAPI.invoke('feat:usage:record', u),
  featUsageList: (opts?: any) => window.electronAPI.invoke('feat:usage:list', opts || {}),
  featPricingTierUpsert: (t: any) => window.electronAPI.invoke('feat:pricing-tier:upsert', t),
  featPricingTierCalc: (plan_id: string, quantity: number) => window.electronAPI.invoke('feat:pricing-tier:calc', { plan_id, quantity }),
  featMrrCalc: (snapshot_date?: string) => window.electronAPI.invoke('feat:mrr:calc', { snapshot_date }),
  featChurnCalc: (period_start: string, period_end: string) => window.electronAPI.invoke('feat:churn:calc', { period_start, period_end }),
  // Batch AF — Credit & Collections
  featCreditSetLimit: (customer_id: string, limit: number) => window.electronAPI.invoke('feat:credit:set-limit', { customer_id, limit }),
  featCreditCheck: (customer_id: string, additional_charge?: number) => window.electronAPI.invoke('feat:credit:check', { customer_id, additional_charge }),
  featCreditSetHold: (customer_id: string, hold: boolean, reason?: string) => window.electronAPI.invoke('feat:credit:set-hold', { customer_id, hold, reason }),
  featAgingCalc: (as_of_date?: string) => window.electronAPI.invoke('feat:aging:calc', { as_of_date }),
  featStatementGenerate: (opts: { customer_id: string; period_start: string; period_end: string }) => window.electronAPI.invoke('feat:statement:generate', opts),
  featDunningSeqCreate: (s: any) => window.electronAPI.invoke('feat:dunning-seq:create', s),
  featDunningLog: (opts: any) => window.electronAPI.invoke('feat:dunning:log', opts),
  featWriteoffBadDebt: (opts: any) => window.electronAPI.invoke('feat:writeoff:bad-debt', opts),
  featDoubtfulCalc: (opts: any) => window.electronAPI.invoke('feat:doubtful:calc', opts),
  featAgencyHandoff: (opts: any) => window.electronAPI.invoke('feat:agency:handoff', opts),
  featAgencyRecordRecovery: (handoff_id: string, recovered_amount: number) => window.electronAPI.invoke('feat:agency:record-recovery', { handoff_id, recovered_amount }),
  featAgencyList: (opts?: any) => window.electronAPI.invoke('feat:agency:list', opts || {}),
  // Batch AG — Financial Analytics
  featArAgingChart: (as_of_date?: string) => window.electronAPI.invoke('feat:ar-aging:chart', { as_of_date }),
  featApAgingChart: (as_of_date?: string) => window.electronAPI.invoke('feat:ap-aging:chart', { as_of_date }),
  featDsoCalc: (period_days?: number) => window.electronAPI.invoke('feat:dso:calc', { period_days }),
  featDpoCalc: (period_days?: number) => window.electronAPI.invoke('feat:dpo:calc', { period_days }),
  featCccCalc: (period_days?: number) => window.electronAPI.invoke('feat:ccc:calc', { period_days }),
  featWorkingCapitalCalc: () => window.electronAPI.invoke('feat:working-capital:calc'),
  featBurnCalc: (months_history?: number) => window.electronAPI.invoke('feat:burn:calc', { months_history }),
  featRunwayCalc: (months_history?: number) => window.electronAPI.invoke('feat:runway:calc', { months_history }),
  featLtvCalc: (customer_id?: string) => window.electronAPI.invoke('feat:ltv:calc', { customer_id }),
  featCacCalc: (period_days?: number) => window.electronAPI.invoke('feat:cac:calc', { period_days }),
  featLtvCacRatio: () => window.electronAPI.invoke('feat:ltv-cac:ratio'),
  featRetentionCalc: (period_start: string, period_end: string) => window.electronAPI.invoke('feat:retention:calc', { period_start, period_end }),
  featCohortBuild: () => window.electronAPI.invoke('feat:cohort:build'),
  // Batch AH — Tax & Compliance
  feat1099RunCreate: (opts: { tax_year: number; form_type?: '1099-NEC' | '1099-MISC' }) => window.electronAPI.invoke('feat:1099-run:create', opts),
  feat1099RunList: () => window.electronAPI.invoke('feat:1099-run:list'),
  featWithholdRecord: (w: any) => window.electronAPI.invoke('feat:withhold:record', w),
  featQtaxRecord: (q: any) => window.electronAPI.invoke('feat:qtax:record', q),
  featQtaxList: (tax_year: number) => window.electronAPI.invoke('feat:qtax:list', { tax_year }),
  featTaxProvCalc: (opts: any) => window.electronAPI.invoke('feat:tax-prov:calc', opts),
  featRdCreditCalc: (opts: any) => window.electronAPI.invoke('feat:rd-credit:calc', opts),
  feat179Elect: (opts: any) => window.electronAPI.invoke('feat:179:elect', opts),
  feat179List: (tax_year?: number) => window.electronAPI.invoke('feat:179:list', { tax_year }),
  // Batch AI — Vendor Management
  featVendOnboardStart: (opts: any) => window.electronAPI.invoke('feat:vend-onboard:start', opts),
  featVendOnboardUpdate: (id: string, items_completed: number) => window.electronAPI.invoke('feat:vend-onboard:update', { id, items_completed }),
  featW9Record: (w: any) => window.electronAPI.invoke('feat:w9:record', w),
  featW9Missing: () => window.electronAPI.invoke('feat:w9:missing'),
  featVendInsRecord: (opts: any) => window.electronAPI.invoke('feat:vend-ins:record', opts),
  featVendInsExpiring: (days_ahead?: number) => window.electronAPI.invoke('feat:vend-ins:expiring', { days_ahead }),
  featVendScore: (vendor_id: string) => window.electronAPI.invoke('feat:vend:score', { vendor_id }),
  featVendDispOpen: (d: any) => window.electronAPI.invoke('feat:vend-disp:open', d),
  featVendDispResolve: (id: string, resolution_amount: number, notes?: string) => window.electronAPI.invoke('feat:vend-disp:resolve', { id, resolution_amount, notes }),
  featVendDispList: (opts?: any) => window.electronAPI.invoke('feat:vend-disp:list', opts || {}),

  // ═══════════════ Expense Advanced Wave (F541-F640, 100 features) ═══════════════
  // Batch AJ — Policy Engine
  featExpPolicyUpsert: (p: any) => window.electronAPI.invoke('feat:exp-policy:upsert', p),
  featExpPolicyList: (opts?: { scope?: string; active_only?: boolean }) => window.electronAPI.invoke('feat:exp-policy:list', opts || {}),
  featExpPolicyEvaluate: (opts: any) => window.electronAPI.invoke('feat:exp-policy:evaluate', opts),
  featExpPolicyAckViolation: (id: string, user_id: string) => window.electronAPI.invoke('feat:exp-policy:ack-violation', { id, user_id }),
  featExpPolicyViolations: (opts?: any) => window.electronAPI.invoke('feat:exp-policy:violations', opts || {}),
  featIrsRateUpsert: (opts: any) => window.electronAPI.invoke('feat:irs-rate:upsert', opts),
  featIrsRateCurrent: (tax_year?: number) => window.electronAPI.invoke('feat:irs-rate:current', { tax_year }),
  featTravelCapUpsert: (c: any) => window.electronAPI.invoke('feat:travel-cap:upsert', c),
  featTravelCapList: () => window.electronAPI.invoke('feat:travel-cap:list'),
  featExpViolationsByEmployee: (employee_id: string, months_back?: number) => window.electronAPI.invoke('feat:exp-violations:by-employee', { employee_id, months_back }),
  // Batch AK — Templates & Auto-Fill
  featExpTplSave: (t: any) => window.electronAPI.invoke('feat:exp-tpl:save', t),
  featExpTplList: (user_id?: string) => window.electronAPI.invoke('feat:exp-tpl:list', { user_id }),
  featExpTplUse: (id: string) => window.electronAPI.invoke('feat:exp-tpl:use', { id }),
  featExpTplSuggested: (user_id: string) => window.electronAPI.invoke('feat:exp-tpl:suggested', { user_id }),
  featSubDetectScan: (lookback_days?: number) => window.electronAPI.invoke('feat:sub-detect:scan', { lookback_days }),
  featSubDetectSummary: () => window.electronAPI.invoke('feat:sub-detect:summary'),
  featSubDetectConfirm: (id: string, confirmed: boolean) => window.electronAPI.invoke('feat:sub-detect:confirm', { id, confirmed }),
  featSubDetectCancel: (id: string) => window.electronAPI.invoke('feat:sub-detect:cancel', { id }),
  featAutoTagUpsert: (r: any) => window.electronAPI.invoke('feat:auto-tag:upsert', r),
  featAutoTagApply: (opts: any) => window.electronAPI.invoke('feat:auto-tag:apply', opts),
  featAutoTagList: () => window.electronAPI.invoke('feat:auto-tag:list'),
  // Batch AL — Corporate Card
  featCorpCardRegister: (c: any) => window.electronAPI.invoke('feat:corp-card:register', c),
  featCorpCardList: (opts?: { active_only?: boolean; card_holder?: string }) => window.electronAPI.invoke('feat:corp-card:list', opts || {}),
  featCardTxMatch: (card_tx_id: string, expense_id: string) => window.electronAPI.invoke('feat:card-tx:match', { card_tx_id, expense_id }),
  featCardTxImport: (opts: any) => window.electronAPI.invoke('feat:card-tx:import', opts),
  featCardTxSpendByUser: (opts?: { from?: string; to?: string }) => window.electronAPI.invoke('feat:card-tx:spend-by-user', opts || {}),
  featCardTxUnmatched: (limit?: number) => window.electronAPI.invoke('feat:card-tx:unmatched', { limit }),
  featCardTxDispute: (opts: any) => window.electronAPI.invoke('feat:card-tx:dispute', opts),
  featCardTxSpendByMerchant: (opts?: any) => window.electronAPI.invoke('feat:card-tx:spend-by-merchant', opts || {}),
  featCardTxReconcile: (card_id: string) => window.electronAPI.invoke('feat:card-tx:reconcile', { card_id }),
  featCardRuleUpsert: (r: any) => window.electronAPI.invoke('feat:card-rule:upsert', r),
  // Batch AM — Travel
  featTripCreate: (t: any) => window.electronAPI.invoke('feat:trip:create', t),
  featTripAddExpense: (expense_id: string, trip_id: string) => window.electronAPI.invoke('feat:trip:add-expense', { expense_id, trip_id }),
  featTripDays: (trip_id: string) => window.electronAPI.invoke('feat:trip:days', { trip_id }),
  featTripApplyPerdiem: (opts: any) => window.electronAPI.invoke('feat:trip:apply-perdiem', opts),
  featTripAddItinerary: (leg: any) => window.electronAPI.invoke('feat:trip:add-itinerary', leg),
  featTripItinerary: (trip_id: string) => window.electronAPI.invoke('feat:trip:itinerary', { trip_id }),
  featTripPreapprove: (trip_id: string, approved_by: string) => window.electronAPI.invoke('feat:trip:preapprove', { trip_id, approved_by }),
  featTripCostSummary: (trip_id: string) => window.electronAPI.invoke('feat:trip:cost-summary', { trip_id }),
  featTripList: (opts?: any) => window.electronAPI.invoke('feat:trip:list', opts || {}),
  // Batch AN — Mileage Advanced
  featMileageStateUpsert: (opts: any) => window.electronAPI.invoke('feat:mileage-state:upsert', opts),
  featMileageRouteCreate: (r: any) => window.electronAPI.invoke('feat:mileage-route:create', r),
  featMileageRouteAddStop: (s: any) => window.electronAPI.invoke('feat:mileage-route:add-stop', s),
  featMileageRouteStops: (route_id: string) => window.electronAPI.invoke('feat:mileage-route:stops', { route_id }),
  featMileageSplit: (opts: { total_miles: number; business_pct: number }) => window.electronAPI.invoke('feat:mileage:split', opts),
  featVehicleDepUpsert: (v: any) => window.electronAPI.invoke('feat:vehicle-dep:upsert', v),
  featVehicleMaintLog: (m: any) => window.electronAPI.invoke('feat:vehicle-maint:log', m),
  featVehicleMaintList: (vehicle_id: string) => window.electronAPI.invoke('feat:vehicle-maint:list', { vehicle_id }),
  featVehicleMaintDue: (days_ahead?: number) => window.electronAPI.invoke('feat:vehicle-maint:due', { days_ahead }),
  featVehicleSetMileageMethod: (vehicle_id: string, method: 'standard' | 'actual') => window.electronAPI.invoke('feat:vehicle:set-mileage-method', { vehicle_id, method }),
  // Batch AO — Custom Fields & Tagging
  featExpCfUpsert: (f: any) => window.electronAPI.invoke('feat:exp-cf:upsert', f),
  featExpCfList: (category_id?: string) => window.electronAPI.invoke('feat:exp-cf:list', { category_id }),
  featExpCfSetValue: (opts: any) => window.electronAPI.invoke('feat:exp-cf:set-value', opts),
  featExpCfGetValues: (expense_id: string) => window.electronAPI.invoke('feat:exp-cf:get-values', { expense_id }),
  featExpFormulaEval: (formula: string, vars: Record<string, number>) => window.electronAPI.invoke('feat:exp-formula:eval', { formula, vars }),
  featTagHierUpsert: (t: any) => window.electronAPI.invoke('feat:tag-hier:upsert', t),
  featTagHierTree: () => window.electronAPI.invoke('feat:tag-hier:tree'),
  featTagsSuggest: (description: string) => window.electronAPI.invoke('feat:tags:suggest', { description }),
  featExpBulkTag: (opts: { expense_ids: string[]; tag_ids: string[] }) => window.electronAPI.invoke('feat:exp:bulk-tag', opts),
  // Batch AP — Spend Analytics
  featSpendHeatmap: (opts?: { top_n?: number; months?: number }) => window.electronAPI.invoke('feat:spend:heatmap', opts || {}),
  featSpendForecast90d: () => window.electronAPI.invoke('feat:spend:forecast-90d'),
  featSpendTopVendors: (opts?: { from?: string; to?: string; limit?: number }) => window.electronAPI.invoke('feat:spend:top-vendors', opts || {}),
  featSpendTopCategories: (opts?: { from?: string; to?: string; limit?: number }) => window.electronAPI.invoke('feat:spend:top-categories', opts || {}),
  featSpendConcentration: (opts?: any) => window.electronAPI.invoke('feat:spend:concentration', opts || {}),
  featSpendEmployeeBenchmarks: (opts?: any) => window.electronAPI.invoke('feat:spend:employee-benchmarks', opts || {}),
  featSpendBenchmarkVsIndustry: (industry: string, total_revenue: number, opts?: any) => window.electronAPI.invoke('feat:spend:benchmark-vs-industry', { industry, total_revenue, ...(opts || {}) }),
  featCostSaveGenerate: () => window.electronAPI.invoke('feat:cost-save:generate'),
  featCostSaveList: (opts?: { status?: string }) => window.electronAPI.invoke('feat:cost-save:list', opts || {}),
  // Batch AQ — Workflow Customization
  featWfDefUpsert: (w: any) => window.electronAPI.invoke('feat:wf-def:upsert', w),
  featWfDefMatch: (opts: { amount: number; category_id?: string }) => window.electronAPI.invoke('feat:wf-def:match', opts),
  featWfDefList: () => window.electronAPI.invoke('feat:wf-def:list'),
  featDelegationCreate: (d: any) => window.electronAPI.invoke('feat:delegation:create', d),
  featDelegationResolve: (user_id: string) => window.electronAPI.invoke('feat:delegation:resolve', { user_id }),
  featDelegationList: (opts?: { active_only?: boolean }) => window.electronAPI.invoke('feat:delegation:list', opts || {}),
  featWfEscalated: () => window.electronAPI.invoke('feat:wf:escalated'),
  featWfLog: (opts: any) => window.electronAPI.invoke('feat:wf:log', opts),
  featWfPerformance: (opts?: { from?: string; to?: string }) => window.electronAPI.invoke('feat:wf:performance', opts || {}),
  // Batch AR — Mobile & Capture
  featExpInboxProvision: (user_id: string) => window.electronAPI.invoke('feat:exp-inbox:provision', { user_id }),
  featCaptureQueue: (opts: any) => window.electronAPI.invoke('feat:capture:queue', opts),
  featCapturePending: (user_id?: string) => window.electronAPI.invoke('feat:capture:pending', { user_id }),
  featCaptureProcess: (capture_id: string, created_expense_id: string) => window.electronAPI.invoke('feat:capture:process', { capture_id, created_expense_id }),
  featVoiceMemoAttach: (opts: any) => window.electronAPI.invoke('feat:voice-memo:attach', opts),
  featVoiceMemoList: (expense_id: string) => window.electronAPI.invoke('feat:voice-memo:list', { expense_id }),
  featExpSetGeo: (expense_id: string, lat: number, lng: number, location_name?: string) => window.electronAPI.invoke('feat:exp:set-geo', { expense_id, lat, lng, location_name }),
  featExpByLocation: (opts?: { radius_km?: number; lat?: number; lng?: number; limit?: number }) => window.electronAPI.invoke('feat:exp:by-location', opts || {}),
  featVoiceEntryRecord: (opts: any) => window.electronAPI.invoke('feat:voice-entry:record', opts),
  // Batch AS — Reports & Year-End
  featExpRptTplSave: (t: any) => window.electronAPI.invoke('feat:exp-rpt-tpl:save', t),
  featExpRptTplList: () => window.electronAPI.invoke('feat:exp-rpt-tpl:list'),
  featYearEndRollup: (tax_year: number) => window.electronAPI.invoke('feat:year-end:rollup', { tax_year }),
  featQuarterlyReport: (year: number, quarter: 1 | 2 | 3 | 4) => window.electronAPI.invoke('feat:quarterly:report', { year, quarter }),
  featDeptReport: (department_id: string, opts?: { from?: string; to?: string }) => window.electronAPI.invoke('feat:dept:report', { department_id, ...(opts || {}) }),
  featProjExpReport: (project_id: string) => window.electronAPI.invoke('feat:proj-exp:report', { project_id }),
  feat1099PrepReport: (tax_year: number) => window.electronAPI.invoke('feat:1099-prep:report', { tax_year }),
  featScheduleCBreakdown: (tax_year: number) => window.electronAPI.invoke('feat:schedule-c:breakdown', { tax_year }),
  featMileageLogSummary: (tax_year: number) => window.electronAPI.invoke('feat:mileage-log:summary', { tax_year }),
  featPerDiemSummary: (tax_year: number) => window.electronAPI.invoke('feat:perdiem:summary', { tax_year }),
  featCustomPeriodReport: (opts: { period_start: string; period_end: string; group_by?: 'category' | 'vendor' | 'project' | 'employee' }) => window.electronAPI.invoke('feat:custom-period:report', opts),

  // ─── Payroll Wave (F641-F740) ────────────────────────────────────
  // Batch PA: Pay Run Engine
  payrollCreatePeriod: (p: any) => window.electronAPI.invoke('payroll:create-period', p),
  payrollListPeriods: (p?: any) => window.electronAPI.invoke('payroll:list-periods', p || {}),
  payrollCreateRun: (p: any) => window.electronAPI.invoke('payroll:create-run', p),
  payrollAddItem: (p: any) => window.electronAPI.invoke('payroll:add-item', p),
  payrollCalcGross: (id: string) => window.electronAPI.invoke('payroll:calc-gross', { id }),
  payrollCalcTaxes: (id: string) => window.electronAPI.invoke('payroll:calc-taxes', { id }),
  payrollCalcNet: (id: string) => window.electronAPI.invoke('payroll:calc-net', { id }),
  payrollPostRun: (id: string) => window.electronAPI.invoke('payroll:post-run', { id }),
  payrollVoidRun: (id: string, reason?: string) => window.electronAPI.invoke('payroll:void-run', { id, reason }),
  payrollReverseItem: (id: string, reason: string) => window.electronAPI.invoke('payroll:reverse-item', { id, reason }),
  // Batch PB: Withholding
  payrollSeedFedTables: (year: number) => window.electronAPI.invoke('payroll:seed-fed-tables', { year }),
  payrollCalcFedWh: (employee_id: string, period_taxable: number, year: number, filing_status: string) => window.electronAPI.invoke('payroll:calc-fed-wh', { employee_id, period_taxable, year, filing_status }),
  payrollSetSutaRate: (p: any) => window.electronAPI.invoke('payroll:set-suta-rate', p),
  payrollCalcSuta: (id: string, state_code: string) => window.electronAPI.invoke('payroll:calc-suta', { id, state_code }),
  payrollUpsertW4: (p: any) => window.electronAPI.invoke('payroll:upsert-w4', p),
  payrollSupplementalRate: (amount: number, rate?: number) => window.electronAPI.invoke('payroll:supplemental-rate', { amount, rate }),
  payrollCalcSdi: (id: string, state_code: string, rate: number, wage_cap: number) => window.electronAPI.invoke('payroll:calc-sdi', { id, state_code, rate, wage_cap }),
  payrollRunTaxLiability: (id: string) => window.electronAPI.invoke('payroll:run-tax-liability', { id }),
  payrollYtdWithholding: (employee_id: string, year: number) => window.electronAPI.invoke('payroll:ytd-withholding', { employee_id, year }),
  payrollRecalcAll: (id: string) => window.electronAPI.invoke('payroll:recalc-all', { id }),
  // Batch PC: Benefits & Deductions
  payrollBenefitCreate: (p: any) => window.electronAPI.invoke('payroll:benefit:create', p),
  payrollBenefitEnroll: (p: any) => window.electronAPI.invoke('payroll:benefit:enroll', p),
  payrollDeductionAdd: (p: any) => window.electronAPI.invoke('payroll:deduction:add', p),
  payrollDeductionApply: (id: string) => window.electronAPI.invoke('payroll:deduction:apply', { id }),
  payrollBenefitApply: (id: string) => window.electronAPI.invoke('payroll:benefit:apply', { id }),
  payrollRetirementSetup: (p: any) => window.electronAPI.invoke('payroll:retirement:setup', p),
  payrollRetirementCalc401k: (id: string) => window.electronAPI.invoke('payroll:retirement:calc-401k', { id }),
  payrollHsaFsaSetup: (p: any) => window.electronAPI.invoke('payroll:hsa-fsa:setup', p),
  payrollAdvanceCreate: (p: any) => window.electronAPI.invoke('payroll:advance:create', p),
  payrollAdvanceProcessRepayment: (advance_id: string, pay_run_item_id: string) => window.electronAPI.invoke('payroll:advance:process-repayment', { advance_id, pay_run_item_id }),
  // Batch PD: Garnishments
  payrollGarnCreate: (p: any) => window.electronAPI.invoke('payroll:garn:create', p),
  payrollCsCreate: (p: any) => window.electronAPI.invoke('payroll:cs:create', p),
  payrollGarnApply: (id: string) => window.electronAPI.invoke('payroll:garn:apply', { id }),
  payrollGarnActive: (employee_id: string) => window.electronAPI.invoke('payroll:garn:active', { employee_id }),
  payrollGarnSatisfy: (id: string, payoff_date?: string) => window.electronAPI.invoke('payroll:garn:satisfy', { id, payoff_date }),
  payrollCsRelease: (id: string, release_date?: string) => window.electronAPI.invoke('payroll:cs:release', { id, release_date }),
  payrollGarnRemittance: (year: number, payee_type?: string) => window.electronAPI.invoke('payroll:garn:remittance', { year, payee_type }),
  payrollCcpaMax: (id: string, supports_family: boolean, supports_child_only: boolean) => window.electronAPI.invoke('payroll:ccpa:max', { id, supports_family, supports_child_only }),
  payrollNewHireReport: (new_hires: { employee_id: string; start_date: string }[]) => window.electronAPI.invoke('payroll:new-hire:report', { new_hires }),
  payrollGarnFee: (id: string, fee: number) => window.electronAPI.invoke('payroll:garn:fee', { id, fee }),
  // Batch PE: Time-Off
  payrollTorCreateAccrual: (p: any) => window.electronAPI.invoke('payroll:tor:create-accrual', p),
  payrollTorAccrue: (employee_id: string, hours_worked?: number) => window.electronAPI.invoke('payroll:tor:accrue', { employee_id, hours_worked }),
  payrollTorRequest: (p: any) => window.electronAPI.invoke('payroll:tor:request', p),
  payrollTorDecide: (id: string, approve: boolean, approver_id?: string) => window.electronAPI.invoke('payroll:tor:decide', { id, approve, approver_id }),
  payrollTorBalances: (employee_id: string) => window.electronAPI.invoke('payroll:tor:balances', { employee_id }),
  payrollTorCarryover: (year: number) => window.electronAPI.invoke('payroll:tor:carryover', { year }),
  payrollTorCalendar: (range_start: string, range_end: string) => window.electronAPI.invoke('payroll:tor:calendar', { range_start, range_end }),
  payrollTorCashOut: (employee_id: string, hourly_rate: number) => window.electronAPI.invoke('payroll:tor:cash-out', { employee_id, hourly_rate }),
  payrollHolidayCreateRule: (p: any) => window.electronAPI.invoke('payroll:holiday:create-rule', p),
  payrollOtCreateRule: (p: any) => window.electronAPI.invoke('payroll:ot:create-rule', p),
  // Batch PF: Direct Deposit
  payrollDdAdd: (p: any) => window.electronAPI.invoke('payroll:dd:add', p),
  payrollDdAllocate: (employee_id: string, net_pay: number) => window.electronAPI.invoke('payroll:dd:allocate', { employee_id, net_pay }),
  payrollAchBuild: (pay_run_id: string) => window.electronAPI.invoke('payroll:ach:build', { pay_run_id }),
  payrollCheckCreateRun: (p: any) => window.electronAPI.invoke('payroll:check:create-run', p),
  payrollCheckMarkPrinted: (id: string) => window.electronAPI.invoke('payroll:check:mark-printed', { id }),
  payrollCheckVoid: (id: string, reason: string) => window.electronAPI.invoke('payroll:check:void', { id, reason }),
  payrollDdPrenote: (account_id: string) => window.electronAPI.invoke('payroll:dd:prenote', { account_id }),
  payrollDdUnverified: () => window.electronAPI.invoke('payroll:dd:unverified'),
  payrollPaycardLoad: (employee_id: string, amount: number) => window.electronAPI.invoke('payroll:paycard:load', { employee_id, amount }),
  payrollEmployeeUpdatePayMethod: (id: string, pay_method: string) => window.electronAPI.invoke('payroll:employee:update-pay-method', { id, pay_method }),
  // Batch PG: Contractors
  payrollContractorCreateRun: (p: any) => window.electronAPI.invoke('payroll:contractor:create-run', p),
  payrollContractorAddItem: (p: any) => window.electronAPI.invoke('payroll:contractor:add-item', p),
  payrollContractorPost: (id: string) => window.electronAPI.invoke('payroll:contractor:post', { id }),
  payrollContractorYtd: (year: number) => window.electronAPI.invoke('payroll:contractor:ytd', { year }),
  payroll1099FlagRequired: (year: number) => window.electronAPI.invoke('payroll:1099:flag-required', { year }),
  payroll1099Generate: (year: number) => window.electronAPI.invoke('payroll:1099:generate', { year }),
  payrollBackupWhApply: (vendor_id: string, amount: number) => window.electronAPI.invoke('payroll:backup-wh:apply', { vendor_id, amount }),
  payrollContractorHistory: (vendor_id: string, year?: number) => window.electronAPI.invoke('payroll:contractor:history', { vendor_id, year }),
  payroll1099UpdateWh: (id: string, federal: number, state?: any[]) => window.electronAPI.invoke('payroll:1099:update-wh', { id, federal, state }),
  payroll1099Transmitted: (id: string) => window.electronAPI.invoke('payroll:1099:transmitted', { id }),
  // Batch PH: Year-End
  payrollW2GenerateOne: (employee_id: string, year: number) => window.electronAPI.invoke('payroll:w2:generate-one', { employee_id, year }),
  payrollW2GenerateAll: (year: number) => window.electronAPI.invoke('payroll:w2:generate-all', { year }),
  payroll941Generate: (year: number, quarter: number) => window.electronAPI.invoke('payroll:941:generate', { year, quarter }),
  payroll941RecordDeposit: (p: { tax_year: number; quarter: number; amount: number; deposit_date?: string }) => window.electronAPI.invoke('payroll:941:record-deposit', p),
  payroll940Generate: (year: number) => window.electronAPI.invoke('payroll:940:generate', { year }),
  payrollYearEndSummary: (year: number) => window.electronAPI.invoke('payroll:year-end:summary', { year }),
  payrollW2MarkFiled: (id: string) => window.electronAPI.invoke('payroll:w2:mark-filed', { id }),
  payroll941MarkFiled: (id: string) => window.electronAPI.invoke('payroll:941:mark-filed', { id }),
  payroll940MarkFiled: (id: string) => window.electronAPI.invoke('payroll:940:mark-filed', { id }),
  payrollFilingsStatus: (year: number) => window.electronAPI.invoke('payroll:filings:status', { year }),
  payrollW2AddBox12: (id: string, code: string, amount: number) => window.electronAPI.invoke('payroll:w2:add-box12', { id, code, amount }),
  // Batch PI: Multi-State
  payrollMultiStateSet: (p: any) => window.electronAPI.invoke('payroll:multi-state:set', p),
  payrollMultiStateCalc: (id: string) => window.electronAPI.invoke('payroll:multi-state:calc', { id }),
  payrollReciprocityApply: (employee_id: string, work_state: string) => window.electronAPI.invoke('payroll:reciprocity:apply', { employee_id, work_state }),
  payrollMultiStateQuarterly: (year: number, quarter: number) => window.electronAPI.invoke('payroll:multi-state:quarterly', { year, quarter }),
  payrollStateQCreate: (p: any) => window.electronAPI.invoke('payroll:state-q:create', p),
  payrollStateQMarkFiled: (id: string) => window.electronAPI.invoke('payroll:state-q:mark-filed', { id }),
  payrollNexusList: () => window.electronAPI.invoke('payroll:nexus:list'),
  payrollMultiStateEnd: (id: string, end_date?: string) => window.electronAPI.invoke('payroll:multi-state:end', { id, end_date }),
  payrollLocalWhCalc: (id: string, locality: string, rate: number) => window.electronAPI.invoke('payroll:local-wh:calc', { id, locality, rate }),
  payrollSuiReview: () => window.electronAPI.invoke('payroll:sui:review'),
  // Batch PJ: Workers Comp & ACA
  payrollWcAddClass: (p: any) => window.electronAPI.invoke('payroll:wc:add-class', p),
  payrollWcAssign: (p: any) => window.electronAPI.invoke('payroll:wc:assign', p),
  payrollWcCalcPremium: (id: string) => window.electronAPI.invoke('payroll:wc:calc-premium', { id }),
  payrollWcSummary: (range_start: string, range_end: string) => window.electronAPI.invoke('payroll:wc:summary', { range_start, range_end }),
  payrollAcaRecord: (p: any) => window.electronAPI.invoke('payroll:aca:record', p),
  payrollAcaReadiness: (year: number) => window.electronAPI.invoke('payroll:aca:readiness', { year }),
  payrollCobraRecord: (p: any) => window.electronAPI.invoke('payroll:cobra:record', p),
  payrollLifeEventRecord: (p: any) => window.electronAPI.invoke('payroll:life-event:record', p),
  payrollCompChangeRecord: (p: any) => window.electronAPI.invoke('payroll:comp-change:record', p),
  payrollDashboardSummary: (year: number) => window.electronAPI.invoke('payroll:dashboard:summary', { year }),

  // ─── Reporting & Dashboards Wave (F741-F840) ────────────────────
  // Batch RA: Custom Report Builder
  rptDefCreate: (p: any) => window.electronAPI.invoke('rpt:def:create', p),
  rptDefList: (f?: any) => window.electronAPI.invoke('rpt:def:list', f || {}),
  rptDefUpdate: (id: string, patch: any) => window.electronAPI.invoke('rpt:def:update', { id, patch }),
  rptDefDelete: (id: string) => window.electronAPI.invoke('rpt:def:delete', { id }),
  rptRun: (report_id: string, params?: any) => window.electronAPI.invoke('rpt:run', { report_id, params }),
  rptRunRows: (run_id: string, offset?: number, limit?: number) => window.electronAPI.invoke('rpt:run:rows', { run_id, offset, limit }),
  rptRunList: (report_id: string, limit?: number) => window.electronAPI.invoke('rpt:run:list', { report_id, limit }),
  rptDefClone: (source_id: string, new_name: string) => window.electronAPI.invoke('rpt:def:clone', { source_id, new_name }),
  rptSqlValidate: (sql_template: string, params?: any) => window.electronAPI.invoke('rpt:sql:validate', { sql_template, params }),
  rptSourceColumns: (source_table: string) => window.electronAPI.invoke('rpt:source:columns', { source_table }),
  // Batch RB: Saved Views
  rptViewSave: (p: any) => window.electronAPI.invoke('rpt:view:save', p),
  rptViewList: (report_id: string, user_id?: string) => window.electronAPI.invoke('rpt:view:list', { report_id, user_id }),
  rptViewUpdate: (id: string, patch: any) => window.electronAPI.invoke('rpt:view:update', { id, patch }),
  rptViewDelete: (id: string) => window.electronAPI.invoke('rpt:view:delete', { id }),
  rptViewSetDefault: (id: string) => window.electronAPI.invoke('rpt:view:set-default', { id }),
  rptViewRun: (id: string) => window.electronAPI.invoke('rpt:view:run', { id }),
  rptNarrativeCreate: (p: any) => window.electronAPI.invoke('rpt:narrative:create', p),
  rptNarrativeList: (type?: string) => window.electronAPI.invoke('rpt:narrative:list', { type }),
  rptNarrativeRender: (id: string, vars: any) => window.electronAPI.invoke('rpt:narrative:render', { id, vars }),
  rptViewShare: (id: string, visibility: 'team' | 'company') => window.electronAPI.invoke('rpt:view:share', { id, visibility }),
  // Batch RC: Scheduled Reports
  rptSchedCreate: (p: any) => window.electronAPI.invoke('rpt:sched:create', p),
  rptSchedList: (f?: any) => window.electronAPI.invoke('rpt:sched:list', f || {}),
  rptSchedRunNow: (id: string) => window.electronAPI.invoke('rpt:sched:run-now', { id }),
  rptSchedPause: (id: string, active: boolean) => window.electronAPI.invoke('rpt:sched:pause', { id, active }),
  rptSchedUpdateCadence: (id: string, cron?: string, preset?: string, next_run_at?: string) => window.electronAPI.invoke('rpt:sched:update-cadence', { id, cron, preset, next_run_at }),
  rptSchedHistory: (id: string, limit?: number) => window.electronAPI.invoke('rpt:sched:history', { id, limit }),
  rptSchedComputeNext: (preset: string, from_date?: string) => window.electronAPI.invoke('rpt:sched:compute-next', { preset, from_date }),
  rptSchedAddRecipients: (id: string, recipients: string[]) => window.electronAPI.invoke('rpt:sched:add-recipients', { id, recipients }),
  rptSchedRemoveRecipients: (id: string, recipients: string[]) => window.electronAPI.invoke('rpt:sched:remove-recipients', { id, recipients }),
  rptSchedDelete: (id: string) => window.electronAPI.invoke('rpt:sched:delete', { id }),
  // Batch RD: KPI Widgets
  rptKpiCreate: (p: any) => window.electronAPI.invoke('rpt:kpi:create', p),
  rptKpiSnapshot: (p: { key: string; value: number; period_start?: string; period_end?: string; inputs?: any }) => window.electronAPI.invoke('rpt:kpi:snapshot', p),
  rptKpiCurrent: (key: string) => window.electronAPI.invoke('rpt:kpi:current', { key }),
  rptKpiSeries: (key: string, opts?: { from?: string; to?: string; limit?: number }) => window.electronAPI.invoke('rpt:kpi:series', { key, opts }),
  rptKpiDelta: (key: string, days?: number) => window.electronAPI.invoke('rpt:kpi:delta', { key, days }),
  rptKpiRecalcBuiltin: () => window.electronAPI.invoke('rpt:kpi:recalc-builtin'),
  rptKpiSetTarget: (key: string, target: number) => window.electronAPI.invoke('rpt:kpi:set-target', { key, target }),
  rptKpiRollup: () => window.electronAPI.invoke('rpt:kpi:rollup'),
  rptKpiDelete: (key: string) => window.electronAPI.invoke('rpt:kpi:delete', { key }),
  rptKpiPrune: (days: number) => window.electronAPI.invoke('rpt:kpi:prune', { days }),
  // Batch RE: Drill-down & Filters
  rptDrillRecord: (p: any) => window.electronAPI.invoke('rpt:drill:record', p),
  rptDrillInto: (table: string, id: string) => window.electronAPI.invoke('rpt:drill:into', { table, id }),
  rptRowsFilter: (rows: any[], filters: any[]) => window.electronAPI.invoke('rpt:rows:filter', { rows, filters }),
  rptRowsGroup: (rows: any[], group_by: string) => window.electronAPI.invoke('rpt:rows:group', { rows, group_by }),
  rptRowsSort: (rows: any[], sort_by: string, direction?: 'asc' | 'desc') => window.electronAPI.invoke('rpt:rows:sort', { rows, sort_by, direction }),
  rptRowsAggregate: (rows: any[], column: string, op: 'sum' | 'avg' | 'min' | 'max' | 'count') => window.electronAPI.invoke('rpt:rows:aggregate', { rows, column, op }),
  rptDrillUserHistory: (user_id: string, limit?: number) => window.electronAPI.invoke('rpt:drill:user-history', { user_id, limit }),
  rptDrillTopEntities: (table: string, days?: number) => window.electronAPI.invoke('rpt:drill:top-entities', { table, days }),
  rptColMetaSet: (p: any) => window.electronAPI.invoke('rpt:col-meta:set', p),
  rptFilterPresets: () => window.electronAPI.invoke('rpt:filter:presets'),
  // Batch RF: Financial Statements
  rptPl: (start: string, end: string) => window.electronAPI.invoke('rpt:pl', { start, end }),
  rptBs: (as_of: string) => window.electronAPI.invoke('rpt:bs', { as_of }),
  rptCf: (start: string, end: string) => window.electronAPI.invoke('rpt:cf', { start, end }),
  rptTb: (as_of: string) => window.electronAPI.invoke('rpt:tb', { as_of }),
  rptArAging: () => window.electronAPI.invoke('rpt:ar-aging'),
  rptApAging: () => window.electronAPI.invoke('rpt:ap-aging'),
  rptCashPosition: () => window.electronAPI.invoke('rpt:cash-position'),
  rptProfitMarginTrend: (months?: number) => window.electronAPI.invoke('rpt:profit-margin-trend', { months }),
  rptWorkingCapital: () => window.electronAPI.invoke('rpt:working-capital'),
  rptGlDetail: (account_id: string, start: string, end: string) => window.electronAPI.invoke('rpt:gl-detail', { account_id, start, end }),
  // Batch RG: Variance
  rptVarianceActualVsBudget: (start: string, end: string) => window.electronAPI.invoke('rpt:variance:actual-vs-budget', { start, end }),
  rptVariancePop: (start_a: string, end_a: string, start_b: string, end_b: string) => window.electronAPI.invoke('rpt:variance:pop', { start_a, end_a, start_b, end_b }),
  rptVarianceYoy: (year: number) => window.electronAPI.invoke('rpt:variance:yoy', { year }),
  rptVarianceQoq: (year: number, quarter: number) => window.electronAPI.invoke('rpt:variance:qoq', { year, quarter }),
  rptVarianceCohort: (start: string, end: string) => window.electronAPI.invoke('rpt:variance:cohort', { start, end }),
  rptTopContributors: (metric: 'revenue' | 'expense' | 'invoices', start: string, end: string, limit?: number) => window.electronAPI.invoke('rpt:top:contributors', { metric, start, end, limit }),
  rptPeriodCompSave: (p: any) => window.electronAPI.invoke('rpt:period-comp:save', p),
  rptVarianceList: (limit?: number) => window.electronAPI.invoke('rpt:variance:list', { limit }),
  rptVarianceOverBudget: (threshold_pct: number, start: string, end: string) => window.electronAPI.invoke('rpt:variance:over-budget', { threshold_pct, start, end }),
  rptMonthlySummaryCard: (month?: string) => window.electronAPI.invoke('rpt:monthly-summary-card', { month }),
  // Batch RH: Dashboards
  rptDashCreate: (p: any) => window.electronAPI.invoke('rpt:dash:create', p),
  rptDashAddWidget: (p: any) => window.electronAPI.invoke('rpt:dash:add-widget', p),
  rptDashMoveWidget: (id: string, x: number, y: number, width?: number, height?: number) => window.electronAPI.invoke('rpt:dash:move-widget', { id, x, y, width, height }),
  rptDashLoad: (id: string) => window.electronAPI.invoke('rpt:dash:load', { id }),
  rptDashList: (user_id?: string) => window.electronAPI.invoke('rpt:dash:list', { user_id }),
  rptDashDelete: (id: string) => window.electronAPI.invoke('rpt:dash:delete', { id }),
  rptDashSaveVersion: (id: string, saved_by?: string, note?: string) => window.electronAPI.invoke('rpt:dash:save-version', { id, saved_by, note }),
  rptDashRestoreVersion: (id: string) => window.electronAPI.invoke('rpt:dash:restore-version', { id }),
  rptDashShare: (p: any) => window.electronAPI.invoke('rpt:dash:share', p),
  rptDashRemoveWidget: (id: string) => window.electronAPI.invoke('rpt:dash:remove-widget', { id }),
  // Batch RI: Executive Summary & Annotations
  rptExecGenerate: (start: string, end: string) => window.electronAPI.invoke('rpt:exec:generate', { start, end }),
  rptExecUpdate: (id: string, patch: any) => window.electronAPI.invoke('rpt:exec:update', { id, patch }),
  rptExecList: (limit?: number) => window.electronAPI.invoke('rpt:exec:list', { limit }),
  rptExecGet: (id: string) => window.electronAPI.invoke('rpt:exec:get', { id }),
  rptExecAutoMonthly: (month?: string) => window.electronAPI.invoke('rpt:exec:auto-monthly', { month }),
  rptAnnotAdd: (p: any) => window.electronAPI.invoke('rpt:annot:add', p),
  rptAnnotList: (p: { report_run_id?: string; widget_id?: string; dashboard_id?: string }) => window.electronAPI.invoke('rpt:annot:list', p),
  rptAnnotDelete: (id: string) => window.electronAPI.invoke('rpt:annot:delete', { id }),
  rptAlertCreate: (p: any) => window.electronAPI.invoke('rpt:alert:create', p),
  rptAlertEvaluate: () => window.electronAPI.invoke('rpt:alert:evaluate'),
  // Batch RJ: Export & Sharing
  rptExportCsv: (run_id: string) => window.electronAPI.invoke('rpt:export:csv', { run_id }),
  rptExportHtml: (run_id: string, title?: string) => window.electronAPI.invoke('rpt:export:html', { run_id, title }),
  rptPinSet: (key: string, value: any, ttl?: number) => window.electronAPI.invoke('rpt:pin:set', { key, value, ttl }),
  rptPinGet: (key: string) => window.electronAPI.invoke('rpt:pin:get', { key }),
  rptFavPin: (p: any) => window.electronAPI.invoke('rpt:fav:pin', p),
  rptFavList: (user_id: string) => window.electronAPI.invoke('rpt:fav:list', { user_id }),
  rptSubCreate: (p: any) => window.electronAPI.invoke('rpt:sub:create', p),
  rptAuditLog: (p: { user_id?: string; action: string; entity_type: string; entity_id: string; metadata?: any }) => window.electronAPI.invoke('rpt:audit:log', p),
  rptAuditGet: (f?: { user_id?: string; action?: string; limit?: number }) => window.electronAPI.invoke('rpt:audit:get', f || {}),
  rptPerfCard: (report_id: string) => window.electronAPI.invoke('rpt:perf-card', { report_id }),

  // ─── Itemization Wave (F841-F862) ────────────────────────────────
  izTplSave: (p: { name: string; description?: string; lines: any[]; owner_user_id?: string; visibility?: 'private' | 'team' | 'company' }) => window.electronAPI.invoke('iz:tpl:save', p),
  izTplList: (user_id?: string) => window.electronAPI.invoke('iz:tpl:list', { user_id }),
  izTplLoad: (id: string) => window.electronAPI.invoke('iz:tpl:load', { id }),
  izTplDelete: (id: string) => window.electronAPI.invoke('iz:tpl:delete', { id }),
  izTplUpdate: (id: string, patch: { name?: string; description?: string; visibility?: string }) => window.electronAPI.invoke('iz:tpl:update', { id, patch }),
  izTplShare: (id: string, visibility: 'team' | 'company') => window.electronAPI.invoke('iz:tpl:share', { id, visibility }),
  izBulkParse: (text: string) => window.electronAPI.invoke('iz:bulk:parse', { text }),
  izSplitEvenly: (total: number, count: number, base_description?: string) => window.electronAPI.invoke('iz:split-evenly', { total, count, base_description }),
  izLineDuplicate: (line: any) => window.electronAPI.invoke('iz:line:duplicate', { line }),
  izAutocompleteDescriptions: (opts?: { limit?: number; days_back?: number }) => window.electronAPI.invoke('iz:autocomplete:descriptions', opts || {}),
  izAutocompleteInventory: (query: string, limit?: number) => window.electronAPI.invoke('iz:autocomplete:inventory', { query, limit }),
  izTaxBreakdown: (lines: any[]) => window.electronAPI.invoke('iz:tax-breakdown', { lines }),
  izLineEffective: (line: any) => window.electronAPI.invoke('iz:line:effective', { line }),
  izContributions: (lines: any[]) => window.electronAPI.invoke('iz:contributions', { lines }),
  izBulkApplyTax: (lines: any[], rate: number) => window.electronAPI.invoke('iz:bulk:apply-tax', { lines, rate }),
  izBulkTaxExempt: (lines: any[], exempt: boolean) => window.electronAPI.invoke('iz:bulk:tax-exempt', { lines, exempt }),
  izReorder: (lines: any[], from: number, to: number) => window.electronAPI.invoke('iz:reorder', { lines, from, to }),
  izValidate: (lines: any[]) => window.electronAPI.invoke('iz:validate', { lines }),
  izRollupCategory: (lines: any[], names: Record<string, string>) => window.electronAPI.invoke('iz:rollup:category', { lines, names }),
  izRollupProject: (lines: any[], names: Record<string, string>) => window.electronAPI.invoke('iz:rollup:project', { lines, names }),
  izTplTop: (limit?: number) => window.electronAPI.invoke('iz:tpl:top', { limit }),
  izSummary: (lines: any[]) => window.electronAPI.invoke('iz:summary', { lines }),

  // ─── Expense Upgrades Wave (F863-F892) ──────────────────────────
  // Batch EA: Bulk Operations
  euBulkApproval: (p: { expense_ids: string[]; status: 'approved' | 'rejected' | 'pending'; comment?: string; actor_user_id?: string }) => window.electronAPI.invoke('eu:bulk:approval', p),
  euBulkRecategorize: (expense_ids: string[], category_id: string) => window.electronAPI.invoke('eu:bulk:recategorize', { expense_ids, category_id }),
  euBulkAssignProject: (expense_ids: string[], project_id: string | null) => window.electronAPI.invoke('eu:bulk:assign-project', { expense_ids, project_id }),
  euBulkReimbursed: (expense_ids: string[], reimbursed: boolean, date?: string) => window.electronAPI.invoke('eu:bulk:reimbursed', { expense_ids, reimbursed, date }),
  euBulkTag: (expense_ids: string[], add: string[], remove?: string[]) => window.electronAPI.invoke('eu:bulk:tag', { expense_ids, add, remove: remove || [] }),
  euBulkDelete: (expense_ids: string[]) => window.electronAPI.invoke('eu:bulk:delete', { expense_ids }),
  // Batch EB: Search & Smart Filters
  euFilterSave: (p: { name: string; filter: any; user_id?: string }) => window.electronAPI.invoke('eu:filter:save', p),
  euFilterList: (user_id?: string) => window.electronAPI.invoke('eu:filter:list', { user_id }),
  euFilterPresets: () => window.electronAPI.invoke('eu:filter:presets'),
  euVendorQuickfind: (query: string, limit?: number) => window.electronAPI.invoke('eu:vendor:quickfind', { query, limit }),
  euFilterByAmount: (p: { op: '>' | '<' | '=' | '>=' | '<=' | 'between'; value: number; value2?: number; limit?: number }) => window.electronAPI.invoke('eu:filter:by-amount', p),
  euFilterByAttachment: (has_receipt: boolean, limit?: number) => window.electronAPI.invoke('eu:filter:by-attachment', { has_receipt, limit }),
  // Batch EC: Hygiene & Duplicates
  euDupesScan: (opts?: { date_window_days?: number; amount_tolerance_cents?: number; min_confidence?: number }) => window.electronAPI.invoke('eu:dupes:scan', opts || {}),
  euReceiptsMissing: (days?: number) => window.electronAPI.invoke('eu:receipts:missing', { days }),
  euDupesResolve: (match_id: string, resolution: 'kept' | 'merged' | 'not_duplicate') => window.electronAPI.invoke('eu:dupes:resolve', { match_id, resolution }),
  euHygieneCompute: (expense_id: string) => window.electronAPI.invoke('eu:hygiene:compute', { expense_id }),
  euHygieneReport: (opts?: { limit?: number; recompute?: boolean }) => window.electronAPI.invoke('eu:hygiene:report', opts || {}),
  // Batch ED: Approval Workflow
  euApprovalCreateRule: (p: any) => window.electronAPI.invoke('eu:approval:create-rule', p),
  euApprovalRoute: (expense_id: string) => window.electronAPI.invoke('eu:approval:route', { expense_id }),
  euApprovalDelegate: (p: { delegator_user_id: string; delegate_user_id: string; starts_at: string; ends_at: string; reason?: string }) => window.electronAPI.invoke('eu:approval:delegate', p),
  euApprovalHistory: (expense_id: string) => window.electronAPI.invoke('eu:approval:history', { expense_id }),
  euApprovalSla: (days?: number) => window.electronAPI.invoke('eu:approval:sla', { days }),
  // Batch EE: Insights
  euInsightsTopVendors: (opts?: { since?: string; until?: string; limit?: number }) => window.electronAPI.invoke('eu:insights:top-vendors', opts || {}),
  euInsightsCategoryRollup: (opts?: { since?: string; until?: string }) => window.electronAPI.invoke('eu:insights:category-rollup', opts || {}),
  euInsightsAnomalies: (threshold?: number) => window.electronAPI.invoke('eu:insights:anomalies', { threshold }),
  euInsightsMonthlyTrend: (months_back?: number) => window.electronAPI.invoke('eu:insights:monthly-trend', { months_back }),
  euInsightsBurnDown: (month?: string) => window.electronAPI.invoke('eu:insights:burn-down', { month }),
  // Batch EF: UX Power
  euRecurringDetect: () => window.electronAPI.invoke('eu:recurring:detect'),
  euDraftSave: (p: { user_id?: string; draft: any }) => window.electronAPI.invoke('eu:draft:save', p),
  euDraftGet: (user_id?: string) => window.electronAPI.invoke('eu:draft:get', { user_id }),
  euDraftClear: (user_id?: string) => window.electronAPI.invoke('eu:draft:clear', { user_id }),

  // Events
  on: (channel: string, callback: (...args: any[]) => void) => window.electronAPI.on(channel, callback),
};

export default api;
