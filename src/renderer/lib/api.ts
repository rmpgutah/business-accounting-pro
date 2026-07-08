declare global {
  interface Window {
    electronAPI: {
      invoke: <T = any>(channel: string, ...args: unknown[]) => Promise<T>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

// Channels that work without a session cookie (auth bootstrap)
const WEB_PUBLIC_CHANNELS = new Set(['auth:has-users', 'auth:list-users', 'auth:login', 'auth:register']);

// Web-mode fetch bridge — used when window.electronAPI is not present (browser/Cloudflare Worker host).
const webInvoke = async <T = any>(channel: string, ...args: unknown[]): Promise<T> => {
  const endpoint = WEB_PUBLIC_CHANNELS.has(channel) ? '/api/rpc/public' : '/api/rpc';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ channel, args }),
  });
  if (res.status === 401) {
    // Notify the app to transition back to AuthScreen without a page reload.
    // A full redirect would trigger another bootstrap cycle and loop.
    window.dispatchEvent(new CustomEvent('bap:session-expired'));
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `RPC ${channel} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
};

const invoke = <T = any>(channel: string, ...args: unknown[]): Promise<T> =>
  (window as any).electronAPI?.invoke
    ? window.electronAPI.invoke<T>(channel, ...args)
    : webInvoke<T>(channel, ...args);

const webOn = (_channel: string, _callback: (...args: any[]) => void): (() => void) => () => {};

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
    invoke('db:query', { table, filters, sort, limit, offset }),

  get: (table: string, id: string) =>
    invoke('db:get', { table, id }),

  create: (table: string, data: Record<string, any>) =>
    invoke('db:create', { table, data }),

  update: (table: string, id: string, data: Record<string, any>) =>
    invoke('db:update', { table, id, data }),

  remove: (table: string, id: string) =>
    invoke('db:delete', { table, id }),

  // Dedicated vendor delete — cleans up all references (expenses, bills,
  // POs, bank rules) and returns a clear result. Soft-delete by default
  // (recoverable in Trash); pass hard=true to permanently remove.
  vendorDelete: (id: string, hard?: boolean): Promise<{ ok?: boolean; hard?: boolean; vendor_name?: string; unlinked?: { expenses: number; bills: number; purchase_orders: number; bank_rules: number }; error?: string }> =>
    invoke('vendors:delete', { id, hard: !!hard }),

  rawQuery: (sql: string, params: any[] = []) =>
    invoke('db:raw-query', { sql, params }),

  // Company
  listCompanies: () => invoke('company:list'),
  getCompany: (id: string) => invoke('company:get', id),
  createCompany: (data: any) => invoke('company:create', data),
  updateCompany: (id: string, data: any) => invoke('company:update', { id, data }),
  switchCompany: (id: string) => invoke('company:switch', id),

  // Dashboard
  dashboardStats: (startDate: string, endDate: string) =>
    invoke('dashboard:stats', { startDate, endDate }),
  dashboardCashflow: (startDate: string, endDate: string) =>
    invoke('dashboard:cashflow', { startDate, endDate }),

  // Human Resources
  hrOrgChart: () => invoke('hr:orgChart'),
  hrAnalytics: (startDate: string, endDate: string) =>
    invoke('hr:analytics', { startDate, endDate }),

  // Search
  globalSearch: (query: string) => invoke('search:global', query),
  searchIndex: (query: string, limit?: number) =>
    invoke('search:index', { query, limit }),
  searchBackfill: () => invoke('search:backfill'),
  invokeAction: (actionId: string, params?: any) =>
    invoke('action:invoke', { actionId, params }),

  // Notifications
  listNotifications: (unreadOnly?: boolean) =>
    invoke('notification:list', { unread_only: unreadOnly }),
  markNotificationRead: (id: string) => invoke('notification:mark-read', id),
  // Perf: bulk operation — single SQL UPDATE instead of N round-trips
  markAllNotificationsRead: (): Promise<number> => invoke('notification:mark-all-read'),

  // Invoice Settings & Catalog
  getInvoiceSettings: (): Promise<any> =>
    invoke('invoice:get-settings'),
  saveInvoiceSettings: (settings: Record<string, any>): Promise<any> =>
    invoke('invoice:save-settings', settings),
  listCatalogItems: (): Promise<any[]> =>
    invoke('invoice:catalog-list'),
  saveCatalogItem: (item: Record<string, any>): Promise<any> =>
    invoke('invoice:catalog-save', item),
  deleteCatalogItem: (id: string): Promise<void> =>
    invoke('invoice:catalog-delete', id),
  listPaymentSchedule: (invoiceId: string): Promise<any[]> =>
    invoke('invoice:payment-schedule-list', invoiceId),
  savePaymentSchedule: (invoiceId: string, milestones: any[]): Promise<any> =>
    invoke('invoice:payment-schedule-save', { invoiceId, milestones }),
  listClientContacts: (clientId: string): Promise<any[]> =>
    invoke('client:contacts-list', clientId),
  saveClientContacts: (clientId: string, contacts: any[]): Promise<any> =>
    invoke('client:contacts-save', { clientId, contacts }),
  listDebtPromises: (debtId: string): Promise<any[]> =>
    invoke('debt:promises-list', debtId),
  saveDebtPromise: (data: Record<string, any>): Promise<any> =>
    invoke('debt:promise-save', data),
  updateDebtPromise: (id: string, kept: boolean, notes?: string): Promise<any> =>
    invoke('debt:promise-update', { id, kept, notes }),
  getDebtPortfolioReportData: (companyId: string): Promise<any> =>
    invoke('debt:portfolio-report-data', { companyId }),

  // Invoice atomic save (header + line items in one DB transaction)
  saveInvoice: (payload: SavePayload): Promise<SaveResult> =>
    window.electronAPI.invoke<SaveResult>('invoice:save', payload),

  // Expense atomic save (header + line items in one DB transaction)
  saveExpense: (payload: SavePayload): Promise<SaveResult> =>
    window.electronAPI.invoke<SaveResult>('expense:save', payload),

  // Export
  // Bug fix #3: export:invoice-pdf handler was removed in v1.1.1 dedup cleanup;
  // routes to the canonical invoice:generate-pdf channel to avoid "No handler" crash.
  exportInvoicePdf: (invoiceId: string) => invoke('invoice:generate-pdf', invoiceId),
  exportCsv: (table: string, filters?: Record<string, any>) =>
    invoke('export:csv', { table, filters }),

  // Invoice PDF & Email
  // Pass `html` to guarantee the saved/emailed PDF matches the in-app preview
  // (applies invoice_settings: logo, accent, columns, payment schedule, etc.).
  generateInvoicePDF: (invoiceId: string, html?: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    invoke('invoice:generate-pdf', html ? { invoiceId, html } : invoiceId),
  // templateKey selects which Settings → Email Templates entry to use:
  //   invoice_send (default), payment_reminder_1, payment_reminder_2,
  //   overdue_notice. Falls back to hardcoded copy if template lookup fails.
  sendInvoiceEmail: (invoiceId: string, html?: string, templateKey?: string): Promise<{ success?: boolean; error?: string; pdfPath?: string; newStatus?: string }> =>
    invoke('invoice:send-email',
      (html || templateKey) ? { invoiceId, html, templateKey } : invoiceId),
  generateInvoiceToken: (invoiceId: string): Promise<{ token: string }> =>
    invoke('invoice:generate-token', invoiceId),
  // PORTAL: extra surface for the share modal
  invoiceTokenInfo: (invoiceId: string): Promise<{ token: string | null; expiresAt: number; lastView: any | null; error?: string }> =>
    invoke('invoice:token-info', invoiceId),
  invoiceRegenerateToken: (invoiceId: string): Promise<{ token?: string; expiresAt?: number; error?: string }> =>
    invoke('invoice:regenerate-token', invoiceId),
  invoiceDisableToken: (invoiceId: string): Promise<{ ok?: boolean; alreadyDisabled?: boolean; error?: string }> =>
    invoke('invoice:disable-token', invoiceId),
  debtPortalTokenInfo: (debtId: string): Promise<{ token: string | null; expiresAt: number; lastView: any | null; error?: string }> =>
    invoke('debt:portal-token-info', { debtId }),
  debtRegeneratePortalToken: (debtId: string): Promise<{ token?: string; expiresAt?: number; portalUrl?: string; error?: string }> =>
    invoke('debt:regenerate-portal-token', { debtId }),
  debtDisablePortalToken: (debtId: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('debt:disable-portal-token', { debtId }),
  portalBaseUrl: (): Promise<{ baseUrl: string }> =>
    invoke('portal:base-url'),
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
    invoke('portal-integration:get'),
  portalIntegrationSave: (payload: {
    portal_base_url?: string;
    api_endpoint?: string;
    auth_scheme?: 'bearer' | 'apikey-header';
    health_check_path?: string;
    auto_sync_invoices?: boolean;
    api_key?: string;          // plaintext — encrypted before storage
    clear_api_key?: boolean;
  }): Promise<{ ok?: boolean; error?: string }> =>
    invoke('portal-integration:save', payload),
  portalIntegrationTest: (): Promise<{
    ok: boolean;
    status?: number;
    elapsedMs?: number;
    message?: string;
    error?: string;
  }> =>
    invoke('portal-integration:test'),
  shellOpenExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    invoke('shell:open-external', url),
  invoiceScheduleReminders: (invoiceId: string): Promise<{ scheduled: number }> =>
    invoke('invoice:schedule-reminders', { invoiceId }),
  invoiceListReminders: (invoiceId: string): Promise<any[]> =>
    invoke('invoice:list-reminders', { invoiceId }),
  getInvoiceDebtLink: (invoiceId: string): Promise<any> =>
    invoke('invoice:debt-link', { invoiceId }),
  getDebtInvoiceLink: (debtId: string): Promise<any> =>
    invoke('debt:invoice-link', { debtId }),
  getOverdueCandidates: (companyId: string, thresholdDays?: number): Promise<any[]> =>
    invoke('invoice:overdue-candidates', { companyId, thresholdDays }),
  convertInvoiceToDebt: (invoiceId: string, companyId: string): Promise<{ debt_id?: string; error?: string }> =>
    invoke('invoice:convert-to-debt', { invoiceId, companyId }),

  // File dialog
  openFileDialog: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) =>
    invoke('dialog:open-file', options),

  // Document attachments
  uploadDocument: (
    companyId: string,
    entityType: string,
    entityId: string,
    filters?: Array<{ name: string; extensions: string[] }>
  ): Promise<import('../../shared/types').Document | null> =>
    invoke('documents:upload', { companyId, entityType, entityId, filters }),
  openPath: (filePath: string): Promise<string> =>
    invoke('documents:open-path', filePath),

  // Auth
  register: (email: string, password: string, displayName: string) =>
    invoke('auth:register', { email, password, displayName }),
  login: (email: string, password: string) =>
    invoke('auth:login', { email, password }),
  hasUsers: () => invoke('auth:has-users'),
  listUsers: (): Promise<any[]> => invoke('auth:list-users'),
  assignCollector: (debtId: string, collectorId: string | null): Promise<any> =>
    invoke('debt:assign-collector', { debtId, collectorId }),
  linkUserCompany: (userId: string, companyId: string, role?: string) =>
    invoke('auth:link-user-company', { userId, companyId, role }),
  validateSession: (userId: string) =>
    invoke('auth:validate-session', { userId }),
  // SECURITY: replaces direct `DELETE FROM users` rawQuery — see auth:delete-account handler.
  deleteAccount: (userId: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('auth:delete-account', { userId }),

  // Recurring Processing
  processRecurringNow: () => invoke('recurring:process-now'),
  getLastProcessed: () => invoke('recurring:last-processed'),
  getRecurringHistory: (templateId?: string) =>
    invoke('recurring:history', { templateId }),

  // Notification Engine
  runNotificationChecks: () => invoke('notification:run-checks'),
  clearAllNotifications: () => invoke('notification:clear-all'),
  dismissNotification: (id: string) => invoke('notification:dismiss', id),
  getNotificationPreferences: () => invoke('notification:preferences'),
  updateNotificationPreferences: (prefs: Record<string, boolean>) =>
    invoke('notification:update-preferences', prefs),

  // Enhanced Dashboard Activity
  dashboardActivity: (entityType?: string, limit?: number) =>
    invoke('dashboard:activity', { entityType, limit }),

  // Batch Operations
  batchUpdate: (table: string, ids: string[], data: Record<string, any>) =>
    invoke('batch:update', { table, ids, data }),
  batchDelete: (table: string, ids: string[]) =>
    invoke('batch:delete', { table, ids }),

  // Import / Export
  importPreviewCSV: () =>
    invoke('import:preview-csv'),
  importExecute: (filePath: string, columnMapping: Record<string, string>, targetTable: string) =>
    invoke('import:execute', { filePath, columnMapping, targetTable }),
  exportFullBackup: () =>
    invoke('export:full-backup'),

  // Chart of Accounts
  accountsSuggestCode: (companyId: string, type: string): Promise<{ code: string; range?: [number, number]; error?: string }> =>
    invoke('accounts:suggest-code', { companyId, type }),
  accountsMerge: (sourceId: string, targetId: string): Promise<{ success?: boolean; error?: string }> =>
    invoke('accounts:merge', { sourceId, targetId }),
  accountsBulkToggleActive: (ids: string[], isActive: boolean): Promise<{ success?: boolean; count?: number; error?: string }> =>
    invoke('accounts:bulk-toggle-active', { ids, isActive }),
  accountsSetOpeningBalance: (companyId: string, accountId: string, amount: number, date: string): Promise<{ success?: boolean; entry_id?: string; error?: string }> =>
    invoke('accounts:set-opening-balance', { companyId, accountId, amount, date }),
  accountsCloseToRetainedEarnings: (companyId: string, periodEndDate: string): Promise<{ success?: boolean; entry_id?: string; accounts_closed?: number; error?: string }> =>
    invoke('accounts:close-to-retained-earnings', { companyId, periodEndDate }),
  accountsStats: (companyId: string): Promise<any[]> =>
    invoke('accounts:stats', { companyId }),
  accountsHistoryPdf: (accountId: string, companyId: string): Promise<{ success?: boolean; error?: string }> =>
    invoke('accounts:history-pdf', { accountId, companyId }),
  accountsApplyTemplate: (companyId: string, accounts: Array<{ code: string; name: string; type: string; subtype?: string }>): Promise<{ success?: boolean; created?: number; error?: string }> =>
    invoke('accounts:apply-template', { companyId, accounts }),
  // CoA round 2
  complianceCheckAccountPerm: (companyId: string, accountId: string, role: string, action: 'post' | 'view'): Promise<{ allowed: boolean; reason?: string; error?: string }> =>
    invoke('compliance:check-account-perm', { companyId, accountId, role, action }),
  fxRevalue: (companyId: string, date: string, rates: Record<string, number>): Promise<{ success?: boolean; entry_id?: string; accounts_revalued?: number; error?: string }> =>
    invoke('fx:revalue', { companyId, date, rates }),
  accountsDetectDormant: (companyId: string, months?: number): Promise<{ dormant: string[]; details?: any[]; error?: string }> =>
    invoke('accounts:detect-dormant', { companyId, months }),
  accountsParseIIF: (text: string): Promise<{ accounts: any[]; error?: string }> =>
    invoke('accounts:parse-iif', { text }),
  accountsBulkCreate: (companyId: string, accounts: any[]): Promise<{ success?: boolean; created?: number; skipped?: number; error?: string }> =>
    invoke('accounts:bulk-create', { companyId, accounts }),
  accountsExportTxf: (companyId: string, year: number): Promise<{ txf?: string; count?: number; error?: string }> =>
    invoke('accounts:export-txf', { companyId, year }),
  accountsMergePreview: (sourceId: string): Promise<{ journal_lines?: number; invoice_lines?: number; bills?: number; expenses?: number; children?: number; error?: string }> =>
    invoke('accounts:merge-preview', { sourceId }),
  accountsSplit: (companyId: string, sourceAccountId: string, targetAccountId: string, dateFrom: string, dateTo: string, descriptionPattern: string): Promise<{ success?: boolean; moved?: number; error?: string }> =>
    invoke('accounts:split', { companyId, sourceAccountId, targetAccountId, dateFrom, dateTo, descriptionPattern }),
  accountsRenumber: (companyId: string, accountId: string, newCode: string): Promise<{ success?: boolean; error?: string }> =>
    invoke('accounts:renumber', { companyId, accountId, newCode }),
  accountsSoftDelete: (accountId: string): Promise<{ success?: boolean; error?: string }> =>
    invoke('accounts:soft-delete', { accountId }),
  accountsRestore: (accountId: string): Promise<{ success?: boolean; error?: string }> =>
    invoke('accounts:restore', { accountId }),
  accountsImportOpeningTb: (companyId: string, date: string, rows: Array<{ code: string; balance: number }>): Promise<{ success?: boolean; entry_id?: string; applied?: number; skipped?: number; error?: string }> =>
    invoke('accounts:import-opening-tb', { companyId, date, rows }),
  accountsSnapshotBalances: (companyId: string, date?: string): Promise<{ success?: boolean; count?: number; date?: string; error?: string }> =>
    invoke('accounts:snapshot-balances', { companyId, date }),
  accountsNaturalSideCheck: (accountId: string, debit: number, credit: number): Promise<{ warn: boolean; message?: string }> =>
    invoke('accounts:natural-side-check', { accountId, debit, credit }),
  accountsClassify: (companyId: string, description: string): Promise<{ account_id: string | null; matched?: string }> =>
    invoke('accounts:classify', { companyId, description }),
  accountsWatchlistCheck: (companyId: string): Promise<{ success?: boolean; triggered?: number; error?: string }> =>
    invoke('accounts:watchlist-check', { companyId }),

  // Print / Preview
  printPreview: (
    html: string,
    title: string,
    pdfOptions?: {
      pageSize?: 'A4' | 'Letter' | 'Legal' | 'Tabloid';
      landscape?: boolean;
      margins?: { top: number; bottom: number; left: number; right: number };
      printBackground?: boolean;
      noPageNumbers?: boolean;
    }
  ): Promise<{ success?: boolean }> =>
    invoke('print:preview', { html, title, ...(pdfOptions ? { pdfOptions } : {}) }),
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
    invoke('print:save-pdf', { html, title, ...(opts || {}) }),
  print: (html: string): Promise<{ success?: boolean; error?: string }> =>
    invoke('print:print', { html }),
  renderPdf: (
    html: string,
    pdfOptions?: { pageSize?: 'A4' | 'Letter' | 'Legal' | 'Tabloid'; landscape?: boolean; printBackground?: boolean }
  ): Promise<{ base64?: string; error?: string }> =>
    invoke('print:render', { html, pdfOptions }),

  // Journal Entry Utilities
  // Bug fix #13/#49: journal_entries.entry_number is NOT NULL + UNIQUE;
  // this fetches the next sequential number scoped to the active company.
  nextJournalNumber: (): Promise<string> =>
    invoke('journal:next-number'),

  // Rebuild GL: retro-post missing journal entries for all transactions
  rebuildGL: (): Promise<{ posted?: number; message?: string; error?: string }> =>
    invoke('gl:rebuild'),

  // ─── JE round 2 ─────────────────────────────
  jeUndoRecent: (companyId: string, n: number, userId: string): Promise<{ count?: number; error?: string }> =>
    invoke('je:undo-recent', { companyId, n, userId }),
  jeGapDetect: (companyId: string): Promise<{ gaps: string[]; error?: string }> =>
    invoke('je:gap-detect', { companyId }),
  jeSnapshot: (jeId: string, userId: string): Promise<{ ok?: boolean; version?: number; error?: string }> =>
    invoke('je:snapshot', { jeId, userId }),
  jeHistoryList: (jeId: string): Promise<Array<{ id: string; version: number; changed_at: string; changed_by: string }>> =>
    invoke('je:history-list', { jeId }),
  jeHistoryRollback: (historyId: string, userId: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('je:history-rollback', { historyId, userId }),

  // Invoice Record Payment (with journal entry)
  recordInvoicePayment: (
    invoiceId: string, amount: number, date: string, method: string, reference: string
  ): Promise<{ paymentId: string; newStatus: string; newAmountPaid: number }> =>
    invoke('invoice:record-payment', { invoiceId, amount, date, method, reference }),

  // Payroll Process (with journal entry)
  processPayroll: (args: {
    periodStart: string; periodEnd: string; payDate: string;
    totalGross: number; totalTaxes: number; totalNet: number;
    stubs: Array<{ employeeId: string; hours: number; grossPay: number; federalTax: number; stateTax: number; ss: number; medicare: number; netPay: number; ytdGross: number; ytdTaxes: number; ytdNet: number; preTaxDeductions?: number; postTaxDeductions?: number; deductionDetail?: string }>;
    runType?: string;
  }): Promise<{ runId: string; error?: string }> =>
    invoke('payroll:process', args),

  // Payroll Edit (replace existing run)
  editPayroll: (args: {
    runId: string;
    periodStart: string; periodEnd: string; payDate: string;
    totalGross: number; totalTaxes: number; totalNet: number;
    stubs: Array<{ employeeId: string; hours: number; hoursOvertime?: number; grossPay: number; federalTax: number; stateTax: number; ss: number; medicare: number; netPay: number; ytdGross: number; ytdTaxes: number; ytdNet: number; preTaxDeductions?: number; postTaxDeductions?: number; deductionDetail?: string }>;
    runType?: string; notes?: string; employeeCount?: number;
  }): Promise<{ runId?: string; error?: string; success?: boolean }> =>
    invoke('payroll:edit', args),

  // Payroll YTD
  // Bug fix #37-39: YTD values are now calculated from actual prior pay stubs.
  payrollYtd: (employeeId: string, year: number): Promise<{
    ytd_gross: number; ytd_taxes: number; ytd_net: number;
    ytd_federal_tax: number; ytd_state_tax: number; ytd_social_security: number; ytd_medicare: number;
  }> =>
    invoke('payroll:ytd-totals', { employeeId, year }),

  // Settings (company-scoped)
  // Bug fix #51: api.query('settings') returned all companies' records;
  // these handlers scope all operations to the current active company.
  listSettings: (): Promise<Array<{ key: string; value: string }>> =>
    invoke('settings:list'),
  getSetting: (key: string): Promise<string | null> =>
    invoke('settings:get', key),
  setSetting: (key: string, value: string): Promise<void> =>
    invoke('settings:set', { key, value }),

  // ─── Financial Reports ─────────────────────────────
  reportProfitLoss: (startDate: string, endDate: string) =>
    invoke('reports:profit-loss', { startDate, endDate }),
  reportBalanceSheet: (asOfDate: string) =>
    invoke('reports:balance-sheet', { asOfDate }),
  reportTrialBalance: (startDate: string, endDate: string) =>
    invoke('reports:trial-balance', { startDate, endDate }),
  reportArAging: (asOfDate: string) =>
    invoke('reports:ar-aging', { asOfDate }),
  reportApAging: (asOfDate: string) =>
    invoke('reports:ap-aging', { asOfDate }),
  reportGeneralLedger: (startDate: string, endDate: string, accountId?: string) =>
    invoke('reports:general-ledger', { startDate, endDate, accountId }),
  reportCashFlow: (startDate: string, endDate: string) =>
    invoke('reports:cash-flow', { startDate, endDate }),
  // P4.35 — Forward-looking cash flow forecast (next N days, default 90)
  reportCashFlowForecast: (days?: number): Promise<any> =>
    invoke('reports:cash-flow-forecast', { days }),
  // P4.37 — Customer profitability ranking
  reportCustomerProfitability: (startDate: string, endDate: string, limit?: number): Promise<any> =>
    invoke('reports:customer-profitability', { startDate, endDate, limit }),
  vendorSpend: (startDate: string, endDate: string): Promise<any[]> =>
    invoke('reports:vendor-spend', { startDate, endDate }),

  // ─── Bills / Accounts Payable ──────────────────────
  billsNextNumber: (): Promise<string> =>
    invoke('bills:next-number'),
  // NOTE: IPC handler destructures `date` (not `paymentDate`) — must match exactly
  billsPay: (billId: string, amount: number, date: string, paymentMethod: string, accountId: string, reference?: string) =>
    invoke('bills:pay', { billId, amount, date, paymentMethod, accountId, reference }),
  billsStats: (): Promise<{ total_unpaid: number; overdue: number; due_soon: number; paid_this_month: number }> =>
    invoke('bills:stats'),
  billsOverdueCheck: () =>
    invoke('bills:overdue-check'),

  // ─── Purchase Orders ───────────────────────────────
  poNextNumber: (): Promise<string> =>
    invoke('po:next-number'),
  poApprove: (poId: string) =>
    invoke('po:approve', { poId }),
  poConvertBill: (poId: string) =>
    invoke('po:convert-bill', { poId }),

  // ─── Fixed Assets ──────────────────────────────────
  assetsNextCode: (): Promise<string> =>
    invoke('assets:next-code'),
  assetsSchedule: (assetId: string) =>
    invoke('assets:schedule', { assetId }),
  assetsRunDepreciation: (periodDate: string) =>
    invoke('assets:run-depreciation', { periodDate }),
  // hard:true permanently deletes the asset + its depreciation history;
  // hard:false (default) soft-deletes to Trash (recoverable 30 days).
  deleteAsset: (id: string, hard?: boolean): Promise<{ ok?: boolean; hard?: boolean; asset_name?: string; depreciation_entries_removed?: number; error?: string }> =>
    invoke('assets:delete', { id, hard }),

  // ─── Bank Rules ────────────────────────────────────
  bankRulesApply: () =>
    invoke('bank-rules:apply'),

  // ─── Credit Notes ──────────────────────────────────
  creditNotesNextNumber: (): Promise<string> =>
    invoke('credit-notes:next-number'),
  creditNotesApply: (creditNoteId: string, invoiceId: string) =>
    invoke('credit-notes:apply', { creditNoteId, invoiceId }),

  // ─── Tax Configuration ─────────────────────────────
  taxSeedYear: (year: number) =>
    invoke('tax:seed-year', { year }),
  taxGetBrackets: (year: number, filingStatus: string) =>
    invoke('tax:get-brackets', { year, filingStatus }),
  // NOTE: IPC handler expects camelCase field names — grossPay, filingStatus, ytdGross
  taxCalculateWithholding: (params: {
    grossPay: number;
    filingStatus: string;
    allowances: number;
    year: number;
    ytdGross: number;
  }) => invoke('tax:calculate-withholding', params),
  // FIX #10/#11: Single source of truth for SS wage base, FICA rates, FUTA
  // rates, and standard deductions. Replaces hardcoded constants in
  // tax-brackets.ts and TaxCalculationEngine.ts that drifted apart.
  taxGetPayrollConstants: (year: number): Promise<{ ss_wage_base: number; ss_rate: number; medicare_rate: number; futa_rate: number; futa_wage_base: number; standard_deduction_single: number; standard_deduction_married: number; standard_deduction_hoh: number; error?: string }> =>
    invoke('tax:get-payroll-constants', { year }),
  taxAvailableYears: (): Promise<number[]> =>
    invoke('tax:available-years'),
  taxAutoSeedCurrentYear: () =>
    invoke('tax:auto-seed-current-year'),

  // Inventory stock movements
  inventoryMovements: (itemId: string): Promise<any[]> =>
    invoke('inventory:movements', itemId),
  inventoryAdjust: (payload: { itemId: string; type: string; quantity: number; unitCost: number; reference: string; notes: string }): Promise<any> =>
    invoke('inventory:adjust', payload),
  inventoryLowStock: (): Promise<any[]> =>
    invoke('inventory:low-stock'),

  // Categories
  categoriesSeedDefaults: (company_id: string) =>
    invoke('categories:seed-defaults', { company_id }),

  // Industry Presets
  industryApplyPreset: (payload: {
    companyId: string;
    presetKey: string;
    preset: any;
    accountSeeds?: Array<{ code: string; name: string; type: string; subtype?: string }>;
  }): Promise<{ success?: boolean; summary?: any; error?: string }> =>
    invoke('industry:apply-preset', payload),
  industryGetExisting: (companyId: string): Promise<{
    categoryNames: string[];
    vendorNames: string[];
    fields: string[];
    accountCodes: string[];
  } | null> =>
    invoke('industry:get-existing', { companyId }),

  // Automations
  listAutomations: (): Promise<any[]> =>
    invoke('automations:list'),
  toggleAutomation: (ruleId: string): Promise<void> =>
    invoke('automations:toggle', ruleId),
  automationRunLog: (ruleId: string): Promise<any[]> =>
    invoke('automations:run-log', ruleId),
  createAutomation: (rule: { name: string; trigger_type: string; trigger_config: string; conditions: string; actions: string }): Promise<any> =>
    invoke('automations:create', rule),
  deleteAutomation: (ruleId: string): Promise<any> =>
    invoke('automations:delete', ruleId),
  updateAutomation: (rule: { id: string; name: string; trigger_type: string; trigger_config: string; conditions: string; actions: string }): Promise<any> =>
    invoke('automations:update', rule),

  // Financial Intelligence
  listAnomalies: (): Promise<any[]> =>
    invoke('intelligence:anomalies'),
  dismissAnomaly: (id: string): Promise<void> =>
    invoke('intelligence:dismiss-anomaly', id),
  cashProjection: (days: number): Promise<{ inflow: any[]; outflow: any[] }> =>
    invoke('intelligence:cash-projection', { days }),
  entityHint: (entityType: string, id: string): Promise<string> =>
    invoke('intelligence:entity-hint', { entityType, id }),

  // Rules Engine
  listRules: (company_id: string, category?: string) =>
    invoke('rules:list', { company_id, category }),
  createRule: (data: Record<string, any>) =>
    invoke('rules:create', data),
  updateRule: (id: string, data: Record<string, any>) =>
    invoke('rules:update', { id, data }),
  deleteRule: (id: string) =>
    invoke('rules:delete', id),
  listApprovals: (company_id: string, status?: string) =>
    invoke('approval:list', { company_id, status }),
  resolveApproval: (id: string, status: 'approved' | 'rejected', notes?: string) =>
    invoke('approval:resolve', { id, status, notes }),
  pendingApprovalCount: (company_id: string) =>
    invoke('approval:pending-count', company_id),
  cloneRecord: (table: string, id: string) =>
    invoke('record:clone', { table, id }),
  invoiceFromTimeEntries: (project_id: string, company_id: string) =>
    invoke('invoice:from-time-entries', { project_id, company_id }),
  invoiceFromBillableExpenses: (opts: { client_id?: string; project_id?: string; company_id: string }) =>
    invoke('invoice:from-billable-expenses', opts),
  // Push local users + their pbkdf2 hashes up to the cloud companion so the
  // user can sign in on the cloud with their existing desktop password.
  // Idempotent — re-runs just refresh hashes. Handler: cloud:bootstrap-users.
  cloudBootstrapUsers: (): Promise<{ ok?: boolean; error?: string; imported?: { users?: number; companies?: number } }> =>
    window.electronAPI.invoke('cloud:bootstrap-users'),

  // ─── Debt Collection ─────────────────────────
  debtStats: (companyId: string): Promise<{
    total_outstanding: number;
    in_collection: number;
    legal_active: number;
    collected_this_month: number;
    writeoffs_ytd: number;
  }> => invoke('debt:stats', { companyId }),

  debtCalculateInterest: (debtId: string): Promise<{ interest: number; total: number }> =>
    invoke('debt:calculate-interest', { debtId }),

  debtAdvanceStage: (debtId: string, notes?: string): Promise<void> =>
    invoke('debt:advance-stage', { debtId, notes }),

  debtHoldToggle: (debtId: string, hold: boolean, reason?: string): Promise<void> =>
    invoke('debt:hold-toggle', { debtId, hold, reason }),

  debtImportOverdueInvoices: (companyId: string, daysThreshold: number): Promise<{ imported: number }> =>
    invoke('debt:import-overdue', { companyId, daysThreshold }),

  debtGenerateDemandLetter: (debtId: string, templateId: string): Promise<{ html: string }> =>
    invoke('debt:generate-demand-letter', { debtId, templateId }),

  debtExportBundle: (debtId: string): Promise<{ path?: string; cancelled?: boolean }> =>
    invoke('debt:export-bundle', { debtId }),

  debtSeedDefaultAutomation: (companyId: string): Promise<void> =>
    invoke('debt:seed-automation', { companyId }),

  debtSeedDefaultTemplates: (companyId: string): Promise<void> =>
    invoke('debt:seed-templates', { companyId }),

  debtRunEscalation: (companyId: string): Promise<{ advanced: number; flagged: number }> =>
    invoke('debt:run-escalation', { companyId }),

  debtAnalytics: (companyId: string, startDate: string, endDate: string): Promise<any> =>
    invoke('debt:analytics', { companyId, startDate, endDate }),

  getPaymentPlan: (debtId: string): Promise<any> =>
    invoke('debt:payment-plan-get', { debtId }),
  savePaymentPlan: (data: Record<string, any>): Promise<any> =>
    invoke('debt:payment-plan-save', data),
  togglePlanInstallment: (installmentId: string, paid: boolean): Promise<any> =>
    invoke('debt:plan-installment-toggle', { installmentId, paid }),
  listSettlements: (debtId: string): Promise<any[]> =>
    invoke('debt:settlements-list', { debtId }),
  saveSettlement: (data: Record<string, any>): Promise<any> =>
    invoke('debt:settlement-save', data),
  respondSettlement: (settlementId: string, response: string, counterAmount?: number): Promise<any> =>
    invoke('debt:settlement-respond', { settlementId, response, counter_amount: counterAmount }),
  acceptSettlement: (debtId: string, settlementId: string, offerAmount: number): Promise<any> =>
    invoke('debt:settlement-accept', { debtId, settlementId, offer_amount: offerAmount }),
  listComplianceLog: (debtId: string): Promise<any[]> =>
    invoke('debt:compliance-list', { debtId }),
  saveComplianceEvent: (data: Record<string, any>): Promise<any> =>
    invoke('debt:compliance-save', data),
  checkAutoAdvance: (companyId: string, thresholdDays?: number): Promise<{ advanced: number }> =>
    invoke('debt:check-auto-advance', { companyId, thresholdDays }),
  getActivityTimeline: (debtId: string): Promise<any[]> =>
    invoke('debt:activity-timeline', { debtId }),
  addQuickNote: (debtId: string, note: string): Promise<any> =>
    invoke('debt:quick-note', { debtId, note }),
  addDebtFee: (debtId: string, amount: number, feeType: string, description: string): Promise<any> =>
    invoke('debt:add-fee', { debtId, amount, feeType, description }),
  collectorPerformance: (startDate?: string, endDate?: string): Promise<any[]> =>
    invoke('debt:collector-performance', { startDate, endDate }),
  collectorDashboard: (companyId: string): Promise<any> =>
    invoke('debt:collector-dashboard', { companyId }),
  upcomingInstallments: (debtId: string): Promise<any[]> =>
    invoke('debt:upcoming-installments', { debtId }),
  uploadDebtDocument: (debtId: string, filePath: string, fileName: string, fileSize: number): Promise<any> =>
    invoke('debt:upload-document', { debtId, filePath, fileName, fileSize }),
  debtAuditLog: (debtId: string, limit?: number): Promise<any[]> =>
    invoke('debt:audit-log', { debtId, limit }),
  generateCourtPacket: (debtId: string): Promise<any> =>
    invoke('debt:generate-court-packet', { debtId }),
  batchRecalcInterest: (): Promise<{ updated: number; error?: string }> =>
    invoke('debt:batch-recalc-interest'),
  matchBankPayments: (): Promise<{ auto_matched: number; suggested: number; error?: string }> =>
    invoke('debt:match-bank-payments'),
  listPendingMatches: (): Promise<any[]> =>
    invoke('debt:list-pending-matches'),
  acceptPaymentMatch: (matchId: string): Promise<any> =>
    invoke('debt:accept-match', { matchId }),
  rejectPaymentMatch: (matchId: string): Promise<any> =>
    invoke('debt:reject-match', { matchId }),
  smartRecommendations: (companyId: string): Promise<any[]> =>
    invoke('debt:smart-recommendations', { companyId }),

  // Feature 4: Schedule Communication
  scheduleCommunication: (debtId: string, type: string, scheduledDate: string, subject: string, body: string): Promise<any> =>
    invoke('debt:schedule-communication', { debtId, type, scheduledDate, subject, body }),
  // Feature 12: Auto-Assign Debts
  autoAssignDebts: (companyId: string): Promise<{ assigned: number; error?: string }> =>
    invoke('debt:auto-assign', { companyId }),
  // Feature 13: Auto Priority Scoring
  autoPriorityScore: (companyId: string): Promise<{ updated: number; error?: string }> =>
    invoke('debt:auto-priority', { companyId }),
  // Feature 16: Freeze/Resume Interest
  freezeInterest: (debtId: string, freeze: boolean, reason?: string): Promise<any> =>
    invoke('debt:freeze-interest', { debtId, freeze, reason }),
  // Feature 20: Consolidate Debts
  consolidateDebts: (debtIds: string[], companyId: string): Promise<{ newDebtId?: string; consolidated?: number; error?: string }> =>
    invoke('debt:consolidate', { debtIds, companyId }),
  // Feature 23: Transfer Debt
  transferDebt: (debtId: string, targetCompanyId: string): Promise<{ newDebtId?: string; error?: string }> =>
    invoke('debt:transfer', { debtId, targetCompanyId }),
  // Feature 24: Campaign Manager
  listCampaigns: (companyId: string): Promise<any[]> =>
    invoke('debt:campaign-list', { companyId }),
  saveCampaign: (data: Record<string, any>): Promise<any> =>
    invoke('debt:campaign-save', data),
  // Feature 9: Payment Portal Link
  generateDebtPortalToken: (debtId: string): Promise<{ token?: string; portalUrl?: string; error?: string }> =>
    invoke('debt:generate-portal-token', { debtId }),

  // ── HR PORTAL ──────────────────────────────────────────
  // (hr:portal-* namespace — hrDirectory/hrEmployeeSnapshot below belong
  // to the earlier HR analytics wave and hit different handlers.)
  hrPortalSnapshot: (employeeId: string): Promise<any> =>
    invoke('hr:portal-snapshot', { employee_id: employeeId }),
  hrPortalDirectory: (): Promise<any[] | { error?: string }> =>
    invoke('hr:portal-directory'),
  hrAnnouncementsList: (opts?: { include_expired?: boolean }): Promise<any[] | { error?: string }> =>
    invoke('hr:announcements:list', opts || {}),
  hrAnnouncementSave: (payload: { id?: string; title: string; body?: string; category?: string; priority?: string; requires_ack?: boolean; pinned?: boolean; effective_date?: string; expires_date?: string }): Promise<{ ok?: boolean; id?: string; error?: string }> =>
    invoke('hr:announcements:save', payload),
  hrAnnouncementDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('hr:announcements:delete', { id }),
  hrAnnouncementAck: (announcementId: string, employeeId: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('hr:announcements:ack', { announcement_id: announcementId, employee_id: employeeId }),
  hrAnnouncementAcks: (announcementId: string): Promise<any[] | { error?: string }> =>
    invoke('hr:announcements:acks', { announcement_id: announcementId }),
  hrAdvanceToDebt: (advanceId: string): Promise<{ ok?: boolean; debt_id?: string; already_linked?: boolean; error?: string }> =>
    invoke('hr:advance-to-debt', { advance_id: advanceId }),
  hrEmployeeDebtSummary: (): Promise<{ count?: number; total_balance?: number; by_employee?: any[]; error?: string }> =>
    invoke('hr:employee-debt-summary'),
  hrEmployeeRecordData: (employeeId: string): Promise<any> =>
    invoke('hr:employee-record-data', { employee_id: employeeId }),

  // ── DEBT WAVE: scoring, action queue, budgets, withholding ──
  debtScoreAll: (): Promise<{ scored?: number; debts?: any[]; error?: string }> =>
    invoke('debt:score-all'),
  debtActionQueue: (): Promise<any[] | { error?: string }> =>
    invoke('debt:action-queue'),
  debtSetExpenseBudget: (debtId: string, budget: number): Promise<{ ok?: boolean; error?: string }> =>
    invoke('debt:set-expense-budget', { debt_id: debtId, budget }),
  debtMarkCostsUnrecoverable: (debtId: string): Promise<{ ok?: boolean; updated?: number; error?: string }> =>
    invoke('debts:mark-costs-unrecoverable', { debt_id: debtId }),
  expensesBulkLinkDebt: (payload: { expense_ids: string[]; debt_id: string; cost_type?: string; is_recoverable?: boolean }): Promise<{ ok?: boolean; updated?: number; error?: string }> =>
    invoke('expenses:bulk-link-debt', payload),
  hrWithholdingList: (opts?: { employee_id?: string; debt_id?: string }): Promise<any[] | { error?: string }> =>
    invoke('hr:withholding:list', opts || {}),
  hrWithholdingSave: (payload: { id?: string; employee_id: string; debt_id: string; per_pay_amount: number; start_date?: string; agreement_signed_date?: string; notes?: string }): Promise<{ ok?: boolean; id?: string; error?: string }> =>
    invoke('hr:withholding:save', payload),
  hrWithholdingStop: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('hr:withholding:stop', { id }),
  hrWithholdingRecordDeduction: (payload: { withholding_id: string; amount?: number; pay_date?: string }): Promise<{ ok?: boolean; applied?: number; new_balance?: number; completed?: boolean; error?: string }> =>
    invoke('hr:withholding:record-deduction', payload),
  hrWithholdingAgreementData: (withholdingId: string): Promise<any> =>
    invoke('hr:withholding:agreement-data', { withholding_id: withholdingId }),

  // ── DEBT COLLECTION COSTS + EXPENSE ALLOCATIONS ───────
  debtCollectionCosts: (debtId: string): Promise<{ costs?: any[]; summary?: any; error?: string }> =>
    invoke('debts:collection-costs', { debt_id: debtId }),
  debtApplyRecoverableCosts: (debtId: string): Promise<{ ok?: boolean; applied?: number; count?: number; error?: string }> =>
    invoke('debts:apply-recoverable-costs', { debt_id: debtId }),
  debtCollectionCostAnalytics: (): Promise<{ by_type?: any[]; by_debt?: any[]; portfolio?: any; error?: string }> =>
    invoke('debts:collection-cost-analytics'),
  expenseSetRecovery: (payload: { expense_id: string; recovery_status: string; recovered_amount?: number; recovered_date?: string }): Promise<{ ok?: boolean; error?: string }> =>
    invoke('expenses:set-recovery', payload),
  expenseAllocationsGet: (expenseId: string): Promise<any[] | { error?: string }> =>
    invoke('expenses:allocations:get', { expense_id: expenseId }),
  expenseAllocationsSave: (expenseId: string, allocations: any[]): Promise<{ ok?: boolean; count?: number; error?: string }> =>
    invoke('expenses:allocations:save', { expense_id: expenseId, allocations }),
  expenseAllocationSummary: (opts?: { target_type?: string; from?: string; to?: string }): Promise<any[] | { error?: string }> =>
    invoke('expenses:allocation-summary', opts || {}),
  expenseAllocTemplatesList: (): Promise<any[] | { error?: string }> =>
    invoke('expense-alloc-templates:list'),
  expenseAllocTemplateSave: (payload: { id?: string; name: string; splits: any[] }): Promise<{ ok?: boolean; id?: string; error?: string }> =>
    invoke('expense-alloc-templates:save', payload),
  expenseAllocTemplateDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('expense-alloc-templates:delete', { id }),

  // ── LOAN TRACKING ──────────────────────────────────────
  loansList: (opts?: { status?: string }): Promise<any[] | { error?: string }> =>
    invoke('loans:list', opts || {}),
  loanGet: (id: string): Promise<{ loan: any; schedule: any[]; payments: any[]; events: any[]; error?: string }> =>
    invoke('loans:get', { id }),
  loanSave: (payload: any): Promise<any> =>
    invoke('loans:save', payload),
  loanDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('loans:delete', { id }),
  loanRecordPayment: (payload: { loan_id: string; payment_date: string; amount: number; is_extra_principal?: boolean; payment_method?: string; reference?: string; notes?: string; principal_amount?: number; interest_amount?: number; escrow_amount?: number }): Promise<{ ok?: boolean; payment_id?: string; split?: { principal: number; interest: number; escrow: number; new_balance: number }; error?: string }> =>
    invoke('loans:record-payment', payload),
  loanSkipPayment: (loanId: string, reason?: string, capitalizeInterest?: boolean): Promise<{ ok?: boolean; skipped_payment_number?: number; skipped_due_date?: string; skipped_amount?: number; interest_capitalized?: number; new_next_due?: string; error?: string }> =>
    invoke('loans:skip-payment', { loan_id: loanId, reason, capitalize_interest: capitalizeInterest }),
  loanRecompute: (loanId: string): Promise<{ ok?: boolean; totals?: { total_paid_to_date: number; total_principal_paid: number; total_interest_paid: number; current_balance: number; deferred_interest_balance: number }; corrected_count?: number; amortization_type?: string; schedule_payments?: number; expenses_backfilled?: number; error?: string }> =>
    invoke('loans:recompute', loanId),
  loanUpdatePayment: (payload: { payment_id: string; payment_date?: string; amount?: number; principal_amount?: number; interest_amount?: number; escrow_amount?: number; payment_method?: string; reference?: string; notes?: string; is_extra_principal?: boolean }): Promise<{ ok?: boolean; totals?: { paid: number; principal: number; interest: number; current_balance: number }; error?: string }> =>
    invoke('loans:update-payment', payload),
  loanDeletePayment: (paymentId: string): Promise<{ ok?: boolean; totals?: { paid: number; principal: number; interest: number; current_balance: number }; error?: string }> =>
    invoke('loans:delete-payment', paymentId),

  // ─── Vendor Account Features (VN1–VN150) ────────────────
  vnDashboard: (vendorId: string) => invoke('vn:dashboard', { vendorId }),
  vnProfile: (vendorId: string) => invoke('vn:profile', { vendorId }),
  vnExpenses: (vendorId: string, limit?: number) => invoke('vn:expenses', { vendorId, limit }),
  vnBills: (vendorId: string) => invoke('vn:bills', { vendorId }),
  vnPOs: (vendorId: string) => invoke('vn:pos', { vendorId }),
  vnSpendByMonth: (vendorId: string, months?: number) => invoke('vn:spend-by-month', { vendorId, months }),
  vnSpendByCategory: (vendorId: string) => invoke('vn:spend-by-category', { vendorId }),
  vnPaymentMethods: (vendorId: string) => invoke('vn:payment-methods', { vendorId }),
  vnAvgTransaction: (vendorId: string) => invoke('vn:avg-transaction', { vendorId }),
  vnYoYSpend: (vendorId: string) => invoke('vn:yoy-spend', { vendorId }),
  vn1099Status: (vendorId: string) => invoke('vn:1099-status', { vendorId }),
  vnContractInfo: (vendorId: string) => invoke('vn:contract-info', { vendorId }),
  vnInsuranceInfo: (vendorId: string) => invoke('vn:insurance-info', { vendorId }),
  vnComplianceDocs: (vendorId: string) => invoke('vn:compliance-docs', { vendorId }),
  vnW9Status: (vendorId: string) => invoke('vn:w9-status', { vendorId }),
  vnScorecard: (vendorId: string) => invoke('vn:scorecard', { vendorId }),
  vnRanking: (limit?: number) => invoke('vn:ranking', { limit }),
  vnConcentration: () => invoke('vn:concentration'),
  vnGrowthTrend: (vendorId: string) => invoke('vn:growth-trend', { vendorId }),
  vnFrequency: (vendorId: string) => invoke('vn:frequency', { vendorId }),
  vnList: () => invoke('vn:list'),
  vnSearch: (query: string) => invoke('vn:search', { query }),
  vnByType: () => invoke('vn:by-type'),
  vnByStatus: () => invoke('vn:by-status'),
  vnByApproval: () => invoke('vn:by-approval'),
  vnByLocation: () => invoke('vn:by-location'),
  vnExpiredInsurance: () => invoke('vn:expired-insurance'),
  vnExpiredContracts: () => invoke('vn:expired-contracts'),
  vnNeeding1099: () => invoke('vn:needing-1099'),
  vnWithoutW9: () => invoke('vn:without-w9'),
  vnInactive: (days?: number) => invoke('vn:inactive', { days }),
  vnNewVendors: (days?: number) => invoke('vn:new-vendors', { days }),
  vnCount: () => invoke('vn:count'),
  vnExport: () => invoke('vn:export'),
  vnBillSummary: (vendorId: string) => invoke('vn:bill-summary', { vendorId }),
  vnPaymentHistory: (vendorId: string) => invoke('vn:payment-history', { vendorId }),
  vnAvgPaymentDays: (vendorId: string) => invoke('vn:avg-payment-days', { vendorId }),
  vnBillsByMonth: (vendorId: string) => invoke('vn:bills-by-month', { vendorId }),
  vnUpcomingBills: (vendorId: string, days?: number) => invoke('vn:upcoming-bills', { vendorId, days }),
  vnPOSummary: (vendorId: string) => invoke('vn:po-summary', { vendorId }),
  vnNotes: (vendorId: string) => invoke('vn:notes', { vendorId }),
  vnNoteAdd: (vendorId: string, note: string, createdBy?: string) => invoke('vn:note-add', { vendorId, note, createdBy }),
  vnEmailHistory: (vendorId: string) => invoke('vn:email-history', { vendorId }),
  vnActivityLog: (vendorId: string) => invoke('vn:activity-log', { vendorId }),
  vnRelated: (vendorId: string) => invoke('vn:related', { vendorId }),
  vnFullSnapshot: (vendorId: string) => invoke('vn:full-snapshot', { vendorId }),
  vnHealthCheck: () => invoke('vn:health-check'),
  vnSpendForecast: (vendorId: string) => invoke('vn:spend-forecast', { vendorId }),
  vnComparison: (vendorIds: string[]) => invoke('vn:comparison', { vendorIds }),
  vnAllScores: () => invoke('vn:all-scores'),
  vnDiversity: () => invoke('vn:diversity'),
  vnPaymentTermsBreakdown: () => invoke('vn:payment-terms'),
  vnPortfolioSummary: () => invoke('vn:portfolio-summary'),
  vnQuarterlySpend: (vendorId: string) => invoke('vn:quarterly-spend', { vendorId }),
  vnDisputes: (vendorId?: string) => invoke('vn:disputes', { vendorId }),
  vnW9Records: (vendorId: string) => invoke('vn:w9-records', { vendorId }),
  vnInsurancePolicies: (vendorId: string) => invoke('vn:insurance-policies', { vendorId }),

  // ─── Debt Collection Wave 2 (DC1–DC150) ─────────────────
  dcDashboard: () => invoke('dc:dashboard'),
  dcByStage: () => invoke('dc:by-stage'),
  dcByPriority: () => invoke('dc:by-priority'),
  dcByStatus: () => invoke('dc:by-status'),
  dcAgingBuckets: () => invoke('dc:aging-buckets'),
  dcCollectionRate: () => invoke('dc:collection-rate'),
  dcMonthlyCollections: (months?: number) => invoke('dc:monthly-collections', { months }),
  dcTopDebtors: (limit?: number) => invoke('dc:top-debtors', { limit }),
  dcTrend: () => invoke('dc:trend'),
  dcRecoveryForecast: () => invoke('dc:recovery-forecast'),
  dcCollectorPerformance: () => invoke('dc:collector-performance'),
  dcSearch: (query: string) => invoke('dc:search', { query }),
  dcByType: () => invoke('dc:by-type'),
  dcByJurisdiction: () => invoke('dc:by-jurisdiction'),
  dcSkipTraces: (debtId: string) => invoke('dc:skip-traces', { debtId }),
  dcSkipTraceCreate: (trace: any) => invoke('dc:skip-trace:create', trace),
  dcSkipTraceUpdate: (id: string, data: any) => invoke('dc:skip-trace:update', { id, ...data }),
  dcSkipTraceDelete: (id: string) => invoke('dc:skip-trace:delete', { id }),
  dcSkipTraceSummary: () => invoke('dc:skip-trace-summary'),
  dcWriteoffs: () => invoke('dc:writeoffs'),
  dcWriteoffCreate: (wo: any) => invoke('dc:writeoff:create', wo),
  dcWriteoffSummary: () => invoke('dc:writeoff-summary'),
  dcWriteoffDelete: (id: string) => invoke('dc:writeoff:delete', { id }),
  dcWriteoffByReason: () => invoke('dc:writeoff-by-reason'),
  dcNeedSkipTrace: () => invoke('dc:need-skip-trace'),
  dcWriteoffCandidates: (age?: number) => invoke('dc:writeoff-candidates', { age }),
  dcRecoveryRate: () => invoke('dc:recovery-rate'),
  dcCommHistory: (debtId: string) => invoke('dc:comm-history', { debtId }),
  dcCommSummary: () => invoke('dc:comm-summary'),
  dcRecentComms: (limit?: number) => invoke('dc:recent-comms', { limit }),
  dcNeedContact: (days?: number) => invoke('dc:need-contact', { days }),
  dcPromises: () => invoke('dc:promises'),
  dcBrokenPromises: () => invoke('dc:broken-promises'),
  dcUpcomingPromises: (days?: number) => invoke('dc:upcoming-promises', { days }),
  dcNotes: (debtId: string) => invoke('dc:notes', { debtId }),
  dcNoteCreate: (note: any) => invoke('dc:note:create', note),
  dcNoteDelete: (id: string) => invoke('dc:note:delete', { id }),
  dcActivityTimeline: (debtId: string) => invoke('dc:activity-timeline', { debtId }),
  dcAuditLogDetail: (debtId: string) => invoke('dc:audit-log-detail', { debtId }),
  dcDisputes: () => invoke('dc:disputes'),
  dcOpenDisputes: () => invoke('dc:open-disputes'),
  dcEvidence: (debtId: string) => invoke('dc:evidence', { debtId }),
  dcLegalActions: (debtId: string) => invoke('dc:legal-actions', { debtId }),
  dcPaymentHistoryDebt: (debtId: string) => invoke('dc:payment-history', { debtId }),
  dcSettlements: () => invoke('dc:settlements'),
  dcCampaigns: () => invoke('dc:campaigns'),
  dcCampaignUpsert: (c: any) => invoke('dc:campaign:upsert', c),
  dcCampaignDelete: (id: string) => invoke('dc:campaign:delete', { id }),
  dcCampaignTargets: (campaignId: string) => invoke('dc:campaign-targets', { campaignId }),
  dcCampaignSummary: () => invoke('dc:campaign-summary'),
  dcAutomationRules: () => invoke('dc:automation-rules'),
  dcBatchAdvanceStage: (debtIds: string[], stage: string) => invoke('dc:batch-advance-stage', { debtIds, stage }),
  dcBatchAssign: (debtIds: string[], collector: string) => invoke('dc:batch-assign', { debtIds, collector }),
  dcBatchPriority: (debtIds: string[], priority: string) => invoke('dc:batch-priority', { debtIds, priority }),
  dcBatchWriteOff: (debtIds: string[], reason: string) => invoke('dc:batch-writeoff', { debtIds, reason }),
  dcEscalationQueue: () => invoke('dc:escalation-queue'),
  dcAutoEscalate: () => invoke('dc:auto-escalate'),
  dcScheduledActions: () => invoke('dc:scheduled-actions'),
  dcPlanSummary: () => invoke('dc:plan-summary'),
  dcInstallmentsDue: (days?: number) => invoke('dc:installments-due', { days }),
  dcOverdueInstallments: () => invoke('dc:overdue-installments'),
  dcSettlementSummary: () => invoke('dc:settlement-summary'),
  dcPendingSettlements: () => invoke('dc:pending-settlements'),
  dcPaymentSummary: () => invoke('dc:payment-summary'),
  dcAvgSettlementDiscount: () => invoke('dc:avg-settlement-discount'),
  dcPaymentMatches: () => invoke('dc:payment-matches'),
  dcComplianceLog: (debtId?: string) => invoke('dc:compliance-log', { debtId }),
  dcComplianceSummary: () => invoke('dc:compliance-summary'),
  dcStatuteExpiring: (days?: number) => invoke('dc:statute-expiring', { days }),
  dcCeaseDesist: () => invoke('dc:cease-desist'),
  dcFDCPACheck: () => invoke('dc:fdcpa-check'),
  dcLegalSummary: () => invoke('dc:legal-summary'),
  dcInLegal: () => invoke('dc:in-legal'),
  dcBankruptcy: () => invoke('dc:bankruptcy'),
  dcContactRestrictions: () => invoke('dc:contact-restrictions'),
  dcRiskScore: (debtId: string) => invoke('dc:risk-score', { debtId }),
  dcRiskScoresBulk: () => invoke('dc:risk-scores-bulk'),
  dcRiskDistribution: () => invoke('dc:risk-distribution'),
  dcHighRisk: () => invoke('dc:high-risk'),
  dcDebtorProfile: (debtId: string) => invoke('dc:debtor-profile', { debtId }),
  dcPortfolioSummary: () => invoke('dc:portfolio-summary'),
  dcCollectorWorkload: () => invoke('dc:collector-workload'),
  dcStageTransitions: () => invoke('dc:stage-transitions'),
  dcExport: () => invoke('dc:export'),
  dcMonthlyPerformance: () => invoke('dc:monthly-performance'),
  dcConcentration: () => invoke('dc:concentration'),
  dcAvgDaysToCollect: () => invoke('dc:avg-days-to-collect'),
  dcPortfolioHealth: () => invoke('dc:portfolio-health'),
  dcQuarterlyReport: () => invoke('dc:quarterly-report'),
  dcFullReport: () => invoke('dc:full-report'),

  // ─── System-Wide (SW1–SW150) ────────────────────────────
  swClientDashboard: () => invoke('sw:client-dashboard'),
  swClientRevenueRanking: (limit?: number) => invoke('sw:client-revenue-ranking', { limit }),
  swClientRetention: () => invoke('sw:client-retention'),
  swClientAcquisition: (months?: number) => invoke('sw:client-acquisition', { months }),
  swClientsByType: () => invoke('sw:clients-by-type'),
  swClientContacts: () => invoke('sw:client-contacts'),
  swClientsNoInvoices: () => invoke('sw:clients-no-invoices'),
  swClientGeography: () => invoke('sw:client-geography'),
  swTopClientsExpenses: () => invoke('sw:top-clients-expenses'),
  swClientComms: (clientId: string) => invoke('sw:client-comms', { clientId }),
  swProjectDashboard: () => invoke('sw:project-dashboard'),
  swProjectProfitability: () => invoke('sw:project-profitability'),
  swProjectTime: (projectId: string) => invoke('sw:project-time', { projectId }),
  swProjectTimeSummary: () => invoke('sw:project-time-summary'),
  swProjectBurn: () => invoke('sw:project-burn'),
  swProjectsByClient: () => invoke('sw:projects-by-client'),
  swProjectMilestones: (projectId: string) => invoke('sw:project-milestones', { projectId }),
  swOverBudgetProjects: () => invoke('sw:over-budget-projects'),
  swProjectStatus: () => invoke('sw:project-status'),
  swProjectActivity: () => invoke('sw:project-activity'),
  swInventoryDashboard: () => invoke('sw:inventory-dashboard'),
  swLowStock: () => invoke('sw:low-stock'),
  swInventoryValuation: () => invoke('sw:inventory-valuation'),
  swInventoryMovements: (itemId: string) => invoke('sw:inventory-movements', { itemId }),
  swInventoryTurnover: () => invoke('sw:inventory-turnover'),
  swInventoryByCategory: () => invoke('sw:inventory-by-category'),
  swReorderSuggestions: () => invoke('sw:reorder-suggestions'),
  swInventoryAging: () => invoke('sw:inventory-aging'),
  swInventorySearch: (query: string) => invoke('sw:inventory-search', { query }),
  swInventoryValueTrend: () => invoke('sw:inventory-value-trend'),
  swBillsDashboard: () => invoke('sw:bills-dashboard'),
  swBillsByVendor: () => invoke('sw:bills-by-vendor'),
  swBillsAging: () => invoke('sw:bills-aging'),
  swUpcomingBills: (days?: number) => invoke('sw:upcoming-bills', { days }),
  swBillPayments: (billId: string) => invoke('sw:bill-payments', { billId }),
  swCashOutflowForecast: (weeks?: number) => invoke('sw:cash-outflow-forecast', { weeks }),
  swBillsMonthly: () => invoke('sw:bills-monthly'),
  swRecurringBills: () => invoke('sw:recurring-bills'),
  swBillsSearch: (query: string) => invoke('sw:bills-search', { query }),
  swApVsAr: () => invoke('sw:ap-vs-ar'),
  swBankReconSummary: () => invoke('sw:bank-recon-summary'),
  swUnmatchedTxns: (limit?: number) => invoke('sw:unmatched-txns', { limit }),
  swBankBalanceHistory: (accountId: string) => invoke('sw:bank-balance-history', { accountId }),
  swTxnsByCategory: () => invoke('sw:txns-by-category'),
  swReconProgress: () => invoke('sw:recon-progress'),
  swSettingsList: () => invoke('sw:settings-list'),
  swSettingGet: (key: string) => invoke('sw:setting-get', { key }),
  swSettingSet: (key: string, value: string) => invoke('sw:setting-set', { key, value }),
  swCompanyProfile: () => invoke('sw:company-profile'),
  swSystemHealth: () => invoke('sw:system-health'),
  swAssetDashboard: () => invoke('sw:asset-dashboard'),
  swAssetsByCategory: () => invoke('sw:assets-by-category'),
  swAssetsDepreciation: () => invoke('sw:assets-depreciation'),
  swAssetDepreciationSchedule: (assetId: string) => invoke('sw:asset-depreciation-schedule', { assetId }),
  swAssetsWarranty: (days?: number) => invoke('sw:assets-warranty', { days }),
  swAssetInsurance: () => invoke('sw:asset-insurance'),
  swRecentDisposals: () => invoke('sw:recent-disposals'),
  swAssetSearch: (query: string) => invoke('sw:asset-search', { query }),
  swTotalAssetValue: () => invoke('sw:total-asset-value'),
  swAssetsByLocation: () => invoke('sw:assets-by-location'),
  swBudgetDashboard: () => invoke('sw:budget-dashboard'),
  swBudgetVsActual: (budgetId: string) => invoke('sw:budget-vs-actual', { budgetId }),
  swBudgetUtilization: () => invoke('sw:budget-utilization'),
  swOverBudgetCategories: () => invoke('sw:over-budget-categories'),
  swBudgetForecast: () => invoke('sw:budget-forecast'),
  swBudgetsList: () => invoke('sw:budgets-list'),
  swBudgetLines: (budgetId: string) => invoke('sw:budget-lines', { budgetId }),
  swBudgetCreate: (budget: any) => invoke('sw:budget-create', budget),
  swBudgetLineAdd: (budgetId: string, line: any) => invoke('sw:budget-line-add', { budgetId, ...line }),
  swBudgetLineDelete: (id: string) => invoke('sw:budget-line-delete', { id }),
  swDocDashboard: () => invoke('sw:doc-dashboard'),
  swDocSearch: (query: string) => invoke('sw:doc-search', { query }),
  swDocsByEntity: (entityType: string, entityId: string) => invoke('sw:docs-by-entity', { entityType, entityId }),
  swRecentDocs: (limit?: number) => invoke('sw:recent-docs', { limit }),
  swEmailDashboard: () => invoke('sw:email-dashboard'),
  swEmailHistoryList: (limit?: number) => invoke('sw:email-history', { limit }),
  swEmailByRecipient: () => invoke('sw:email-by-recipient'),
  swNotificationStats: () => invoke('sw:notification-stats'),
  swAuditSummary: (days?: number) => invoke('sw:audit-summary', { days }),
  swAuditSearch: (query: string) => invoke('sw:audit-search', { query }),
  swTimeDashboard: () => invoke('sw:time-dashboard'),
  swTimeByEmployee: (opts?: any) => invoke('sw:time-by-employee', opts || {}),
  swTimeByProject: () => invoke('sw:time-by-project'),
  swUnbilledTime: () => invoke('sw:unbilled-time'),
  swWeeklyTime: () => invoke('sw:weekly-time'),
  swQuotesDashboard: () => invoke('sw:quotes-dashboard'),
  swQuotesByStatus: () => invoke('sw:quotes-by-status'),
  swQuoteFunnel: () => invoke('sw:quote-funnel'),
  swTopQuotes: (limit?: number) => invoke('sw:top-quotes', { limit }),
  swExpiredQuotes: () => invoke('sw:expired-quotes'),
  swAutomationsDashboard: () => invoke('sw:automations-dashboard'),
  swRuleHistory: (limit?: number) => invoke('sw:rule-history', { limit }),
  swCrossModuleSummary: () => invoke('sw:cross-module-summary'),
  swRecentActivity: (limit?: number) => invoke('sw:recent-activity', { limit }),
  swCashFlowSummary: () => invoke('sw:cash-flow-summary'),
  swTaxSummaryYTD: () => invoke('sw:tax-summary-ytd'),
  swUpcomingDeadlines: (days?: number) => invoke('sw:upcoming-deadlines', { days }),
  swGlobalSearchV2: (query: string) => invoke('sw:global-search-v2', { query }),
  swDataIntegrity: () => invoke('sw:data-integrity'),
  swFullReport: () => invoke('sw:full-report'),
  swTaxDashboard: () => invoke('sw:tax-dashboard'),
  swTaxPayments: () => invoke('sw:tax-payments'),
  swTaxCategories: () => invoke('sw:tax-categories'),
  swSalesTaxLiability: () => invoke('sw:sales-tax-liability'),
  swDeductibleSummary: (year?: number) => invoke('sw:deductible-summary', { year }),
  swEstimatedTax: () => invoke('sw:estimated-tax'),
  sw1099Summary: (year?: number) => invoke('sw:1099-summary', { year }),
  swPayrollTaxYTD: () => invoke('sw:payroll-tax-ytd'),
  swTaxCalendar: () => invoke('sw:tax-calendar'),
  swTaxRates: (state?: string) => invoke('sw:tax-rates', { state }),
  swPODashboard: () => invoke('sw:po-dashboard'),
  swPOByVendor: () => invoke('sw:po-by-vendor'),
  swPOByStatus: () => invoke('sw:po-by-status'),
  swOverduePOs: () => invoke('sw:overdue-pos'),
  swPOSearch: (query: string) => invoke('sw:po-search', { query }),
  swPOMonthly: () => invoke('sw:po-monthly'),
  swPOLines: (poId: string) => invoke('sw:po-lines', { poId }),
  swPOReceiving: () => invoke('sw:po-receiving'),
  swPOToBill: (poId: string) => invoke('sw:po-to-bill', { poId }),
  swPOApprovalStatus: () => invoke('sw:po-approval-status'),
  swKPIOverview: () => invoke('sw:kpi-overview'),
  swRevVsExpTrend: (months?: number) => invoke('sw:rev-vs-exp-trend', { months }),
  swProfitMarginTrend: () => invoke('sw:profit-margin-trend'),
  swOperatingMetrics: () => invoke('sw:operating-metrics'),
  swQuickRatios: () => invoke('sw:quick-ratios'),
  swMoMGrowth: () => invoke('sw:mom-growth'),
  swBurnRate: () => invoke('sw:burn-rate'),
  swRevenueByService: () => invoke('sw:revenue-by-service'),
  swTopExpenseCategories: () => invoke('sw:top-expense-cats'),
  swFinancialSnapshot: () => invoke('sw:financial-snapshot'),
  swStripeSummary: () => invoke('sw:stripe-summary'),
  swStripeRecent: (limit?: number) => invoke('sw:stripe-recent', { limit }),
  swStripeMonthly: () => invoke('sw:stripe-monthly'),
  swStripeFees: () => invoke('sw:stripe-fees'),
  swStripeUnmatched: () => invoke('sw:stripe-unmatched'),
  swPaymentMethodStats: () => invoke('sw:payment-method-stats'),
  swAvgPaymentSize: () => invoke('sw:avg-payment-size'),
  swPaymentsByMonth: () => invoke('sw:payments-by-month'),
  swOverduePayments: () => invoke('sw:overdue-payments'),
  swPaymentForecast: (weeks?: number) => invoke('sw:payment-forecast', { weeks }),
  swCompanyDashboard: () => invoke('sw:company-dashboard'),
  swCompanyGrowth: () => invoke('sw:company-growth'),
  swCompanyComparison: () => invoke('sw:company-comparison'),
  swRecurringRevenue: () => invoke('sw:recurring-revenue'),
  swCustomerLTV: () => invoke('sw:customer-ltv'),
  swVendorDependency: () => invoke('sw:vendor-dependency'),
  swProfitByMonth: () => invoke('sw:profit-by-month'),
  swAnnualSummary: (year?: number) => invoke('sw:annual-summary', { year }),
  swSystemUsage: () => invoke('sw:system-usage'),
  swFullSystemReport: () => invoke('sw:full-report'),

  // ─── Invoice Wave 3 (IV1–IV80) ──────────────────────────
  ivCoupons: (activeOnly?: boolean) => invoke('iv:coupons', { activeOnly }),
  ivCouponUpsert: (c: any) => invoke('iv:coupon:upsert', c),
  ivCouponDelete: (id: string) => invoke('iv:coupon:delete', { id }),
  ivCouponRedeem: (code: string, invoiceId: string, invoiceTotal: number) => invoke('iv:coupon:redeem', { code, invoiceId, invoiceTotal }),
  ivCouponHistory: () => invoke('iv:coupon:history'),
  ivCouponSummary: () => invoke('iv:coupon:summary'),
  ivCouponValidate: (code: string) => invoke('iv:coupon:validate', { code }),
  ivExpiredCoupons: () => invoke('iv:coupon:expired'),
  ivCreditMemos: (clientId?: string) => invoke('iv:credit-memos', { clientId }),
  ivCreditMemoCreate: (cm: any) => invoke('iv:credit-memo:create', cm),
  ivCreditMemoApply: (memoId: string, toInvoiceId: string) => invoke('iv:credit-memo:apply', { memoId, toInvoiceId }),
  ivCreditMemoVoid: (id: string) => invoke('iv:credit-memo:void', { id }),
  ivCreditMemoSummary: () => invoke('iv:credit-memo:summary'),
  ivClientCredit: (clientId: string) => invoke('iv:client-credit', { clientId }),
  ivPaymentPlanCreate: (plan: any) => invoke('iv:payment-plan:create', plan),
  ivPaymentPlans: (invoiceId?: string) => invoke('iv:payment-plans', { invoiceId }),
  ivPaymentPlanInstallments: (planId: string) => invoke('iv:payment-plan:installments', { planId }),
  ivInstallmentPay: (installmentId: string, amount: number) => invoke('iv:installment:pay', { installmentId, amount }),
  ivOverdueInstallments: () => invoke('iv:installments:overdue'),
  ivPaymentPlanCancel: (planId: string) => invoke('iv:payment-plan:cancel', { planId }),
  ivCollectionScore: (invoiceId: string) => invoke('iv:collection-score', { invoiceId }),
  ivCollectionScoresBulk: () => invoke('iv:collection-scores:bulk'),
  ivCollectionBoard: () => invoke('iv:collection-board'),
  ivDSO: (days?: number) => invoke('iv:dso', { days }),
  ivDSOByClient: () => invoke('iv:dso-by-client'),
  ivDSOTrend: () => invoke('iv:dso-trend'),
  ivApprovalRules: () => invoke('iv:approval-rules'),
  ivApprovalRuleUpsert: (r: any) => invoke('iv:approval-rule:upsert', r),
  ivApprovalRuleDelete: (id: string) => invoke('iv:approval-rule:delete', { id }),
  ivSubmitForApproval: (invoiceId: string, submittedBy: string) => invoke('iv:submit-for-approval', { invoiceId, submittedBy }),
  ivApprove: (invoiceId: string, approverUserId: string, comment?: string) => invoke('iv:approve', { invoiceId, approverUserId, comment }),
  ivApprovalHistory: (invoiceId: string) => invoke('iv:approval-history', { invoiceId }),
  ivTemplates: () => invoke('iv:templates'),
  ivTemplateUpsert: (t: any) => invoke('iv:template:upsert', t),
  ivTemplateDelete: (id: string) => invoke('iv:template:delete', { id }),
  ivLineTemplates: () => invoke('iv:line-templates'),
  ivLineTemplateUpsert: (lt: any) => invoke('iv:line-template:upsert', lt),
  ivLineTemplateDelete: (id: string) => invoke('iv:line-template:delete', { id }),
  ivLogEmail: (entry: any) => invoke('iv:log-email', entry),
  ivEmailHistory: (invoiceId: string) => invoke('iv:email-history', { invoiceId }),
  ivLogView: (entry: any) => invoke('iv:log-view', entry),
  ivViewHistory: (invoiceId: string) => invoke('iv:view-history', { invoiceId }),
  ivViewStats: () => invoke('iv:view-stats'),
  ivUnviewed: () => invoke('iv:unviewed'),
  ivAttachments: (invoiceId: string) => invoke('iv:attachments', { invoiceId }),
  ivAttachmentAdd: (att: any) => invoke('iv:attachment:add', att),
  ivAttachmentDelete: (id: string) => invoke('iv:attachment:delete', { id }),
  ivLogActivity: (entry: any) => invoke('iv:log-activity', entry),
  ivActivityLog: (invoiceId: string) => invoke('iv:activity-log', { invoiceId }),
  ivRecentActivity: (limit?: number) => invoke('iv:recent-activity', { limit }),
  ivDashboard: () => invoke('iv:dashboard'),
  ivRevenueByMonth: (months?: number) => invoke('iv:revenue-by-month', { months }),
  ivCollectionRate: () => invoke('iv:collection-rate'),
  ivAvgPaymentDays: () => invoke('iv:avg-payment-days'),
  ivByStatus: () => invoke('iv:by-status'),
  ivTopClients: (limit?: number) => invoke('iv:top-clients', { limit }),
  ivInvoiceAging: () => invoke('iv:aging'),
  ivGrowthRate: () => invoke('iv:growth-rate'),
  ivAvgSize: () => invoke('iv:avg-size'),
  ivByDayOfWeek: () => invoke('iv:by-day-of-week'),
  ivSmartFilters: (userId?: string) => invoke('iv:smart-filters', { userId }),
  ivSmartFilterUpsert: (f: any) => invoke('iv:smart-filter:upsert', f),
  ivSmartFilterDelete: (id: string) => invoke('iv:smart-filter:delete', { id }),
  ivWorkflowRules: () => invoke('iv:workflow-rules'),
  ivWorkflowRuleUpsert: (r: any) => invoke('iv:workflow-rule:upsert', r),
  ivWorkflowRuleDelete: (id: string) => invoke('iv:workflow-rule:delete', { id }),
  ivBatchSend: (invoiceIds: string[]) => invoke('iv:batch-send', { invoiceIds }),
  ivBatchVoid: (invoiceIds: string[]) => invoke('iv:batch-void', { invoiceIds }),
  ivDuplicate: (invoiceId: string) => invoke('iv:duplicate', { invoiceId }),
  ivPaymentMethodBreakdown: () => invoke('iv:payment-method-breakdown'),
  ivByClient: () => invoke('iv:by-client'),
  ivUnpaidSummary: () => invoke('iv:unpaid-summary'),
  ivLateFeeReport: () => invoke('iv:late-fee-report'),
  ivRecurringSummary: () => invoke('iv:recurring-summary'),
  ivExport: (startDate?: string, endDate?: string) => invoke('iv:export', { startDate, endDate }),
  ivSearch: (query: string, limit?: number) => invoke('iv:search', { query, limit }),
  ivPortalHealth: () => invoke('iv:portal-health'),
  ivQuarterly: () => invoke('iv:quarterly'),
  ivClientPaymentBehavior: () => invoke('iv:client-payment-behavior'),

  // ─── Expense Wave 3 (EX1–EX80) ──────────────────────────
  exAutoSplitProject: (expenseId: string) => invoke('ex:auto-split-project', { expenseId }),
  exDetectRecurring: () => invoke('ex:detect-recurring'),
  exCategorizationAccuracy: () => invoke('ex:categorization-accuracy'),
  exSpendingVelocity: (days?: number) => invoke('ex:spending-velocity', { days }),
  exFindDuplicates: () => invoke('ex:find-duplicates'),
  exForecastNextMonth: () => invoke('ex:forecast-next-month'),
  exVendorAnomalies: (threshold?: number) => invoke('ex:vendor-anomalies', { threshold }),
  exUnmatchedReceipts: () => invoke('ex:unmatched-receipts'),
  exExpenseAging: () => invoke('ex:expense-aging'),
  exAutoTag: (rules: Array<{ keyword: string; tagId: string }>) => invoke('ex:auto-tag', { rules }),
  exSpendingByDay: () => invoke('ex:spending-by-day'),
  exSubmissionPatterns: () => invoke('ex:submission-patterns'),
  exCategoryTrends: () => invoke('ex:category-trends'),
  exVendorLoyalty: () => invoke('ex:vendor-loyalty'),
  exTaxDeductionSummary: (year?: number) => invoke('ex:tax-deduction-summary', { year }),
  exExpenseRevenueRatio: () => invoke('ex:expense-revenue-ratio'),
  exSpendingHeatmap: (weeks?: number) => invoke('ex:spending-heatmap', { weeks }),
  exMonthlyGrowth: () => invoke('ex:monthly-growth'),
  exCategoryConcentration: () => invoke('ex:category-concentration'),
  exBudgetBurnRate: () => invoke('ex:budget-burn-rate'),
  exCheckPolicy: (expense: { amount: number; category_id?: string }) => invoke('ex:check-policy', expense),
  exApprovalChain: (amount: number) => invoke('ex:approval-chain', { amount }),
  exBatchApprove: (expenseIds: string[], approvedBy: string) => invoke('ex:batch-approve', { expenseIds, approvedBy }),
  exBatchReject: (expenseIds: string[], reason: string) => invoke('ex:batch-reject', { expenseIds, reason }),
  exGenerateReport: (opts: { title: string; expenseIds: string[]; submittedBy: string }) => invoke('ex:generate-report', opts),
  exVoidExpense: (expenseId: string, reason: string) => invoke('ex:void-expense', { expenseId, reason }),
  exSplitExpense: (expenseId: string, splits: any[]) => invoke('ex:split-expense', { expenseId, splits }),
  exRequestClarification: (expenseId: string, question: string) => invoke('ex:request-clarification', { expenseId, question }),
  exSubmitOnBehalf: (data: any, onBehalfOf: string) => invoke('ex:submit-on-behalf', { data, onBehalfOf }),
  exEscalateStale: (days?: number) => invoke('ex:escalate-stale', { days }),
  exByEmployee: (opts?: { startDate?: string; endDate?: string }) => invoke('ex:by-employee', opts || {}),
  exByPaymentMethod: () => invoke('ex:by-payment-method'),
  exYoYComparison: () => invoke('ex:yoy-comparison'),
  exLargest: (limit?: number) => invoke('ex:largest', { limit }),
  exUncategorized: () => invoke('ex:uncategorized'),
  exMissingReceipts: (threshold?: number) => invoke('ex:missing-receipts', { threshold }),
  exReimbursementAging: () => invoke('ex:reimbursement-aging'),
  exProjectSummary: () => invoke('ex:project-summary'),
  exVendorTrend: (vendorId: string) => invoke('ex:vendor-trend', { vendorId }),
  exExportCSV: (startDate?: string, endDate?: string) => invoke('ex:export-csv', { startDate, endDate }),
  exBillableByClient: () => invoke('ex:billable-by-client'),
  exUnmatchedBankTxns: () => invoke('ex:unmatched-bank-txns'),
  exLoanLinked: () => invoke('ex:loan-linked'),
  exPayrollLinked: () => invoke('ex:payroll-linked'),
  exConvertToBill: (expenseId: string) => invoke('ex:convert-to-bill', { expenseId }),
  exMarkBillable: (expenseId: string, clientId: string) => invoke('ex:mark-billable', { expenseId, clientId }),
  exLinkProjectBudget: (expenseId: string, projectId: string) => invoke('ex:link-project-budget', { expenseId, projectId }),
  exCalcMileage: (miles: number, year?: number) => invoke('ex:calc-mileage', { miles, year }),
  exConvertCurrency: (amount: number, from: string, to: string, rate: number) => invoke('ex:convert-currency', { amount, from, to, rate }),
  exToInvoiceLine: (expenseId: string) => invoke('ex:to-invoice-line', { expenseId }),
  exPerDiem: (location: string, days: number, mealsIncluded?: boolean) => invoke('ex:per-diem', { location, days, mealsIncluded }),
  exAuditTrail: (expenseId: string) => invoke('ex:audit-trail', { expenseId }),
  exPolicyCompliance: () => invoke('ex:policy-compliance'),
  exWeekendExpenses: () => invoke('ex:weekend-expenses'),
  exRoundNumber: () => invoke('ex:round-number'),
  exDeptBudgetVariance: () => invoke('ex:dept-budget-variance'),
  exTaxDeductibleBreakdown: (year?: number) => invoke('ex:tax-deductible-breakdown', { year }),
  exSubmissionTimeliness: () => invoke('ex:submission-timeliness'),
  exEmployeeMonthlySpending: (month?: string) => invoke('ex:employee-monthly-spending', { month }),
  exMileageRates: () => invoke('ex:mileage-rates'),
  exBatchRecategorize: (expenseIds: string[], categoryId: string) => invoke('ex:batch-recategorize', { expenseIds, categoryId }),
  exBatchTaxDeductible: (expenseIds: string[], deductible: boolean) => invoke('ex:batch-tax-deductible', { expenseIds, deductible }),
  exBatchAssignProject: (expenseIds: string[], projectId: string) => invoke('ex:batch-assign-project', { expenseIds, projectId }),
  exBatchPaymentMethod: (expenseIds: string[], method: string) => invoke('ex:batch-payment-method', { expenseIds, method }),
  exDataQuality: (expenseId: string) => invoke('ex:data-quality', { expenseId }),
  exBulkDataQuality: () => invoke('ex:bulk-data-quality'),
  exMergeVendor: (fromVendorId: string, toVendorId: string) => invoke('ex:merge-vendor', { fromVendorId, toVendorId }),
  exFindOrphans: () => invoke('ex:find-orphans'),
  exBatchReimburse: (expenseIds: string[]) => invoke('ex:batch-reimburse', { expenseIds }),
  exCreateTemplate: (template: any) => invoke('ex:create-template', template),
  exDashboardStats: () => invoke('ex:dashboard'),
  exRecentVendors: (limit?: number) => invoke('ex:recent-vendors', { limit }),
  exRecentCategories: (limit?: number) => invoke('ex:recent-categories', { limit }),
  exCountByStatus: () => invoke('ex:count-by-status'),
  exAvgProcessingTime: () => invoke('ex:avg-processing-time'),
  exTagsSummary: () => invoke('ex:tags-summary'),
  exQuarterlyComparison: () => invoke('ex:quarterly-comparison'),
  exFullTextSearch: (query: string, limit?: number) => invoke('ex:full-text-search', { query, limit }),
  exToggleStar: (expenseId: string) => invoke('ex:toggle-star', { expenseId }),
  exPortalHealth: () => invoke('ex:portal-health'),

  // ──── Loan ↔ Expense Linkage (lk:* namespace) ─────────────────
  // Channel names + payload shapes match the existing IPC handlers
  // registered under the "Loan Linkage Wave (F1053-F1062)" block.
  // expensesForLoan is the one LoanDetail's LinkedExpensesPanel
  // depends on. retrolink lets you connect an already-recorded
  // expense to a loan after the fact (very common — user creates
  // expense for "Car Loan Payment - November" before realizing
  // they could attach it to the loan record).
  // NOTE: the lk* payment/linkage methods (lkExpensesForLoan, lkRecordPayment,
  // lkLoanContextForExpense, lkLinkageDashboard, lkCashflowTimeline,
  // lkSuggestLoanForBankTx, lkLinkBankTx, lkAutoGlAccounts, lkGenerateBill) are
  // defined once below in the "Loan Linkage Wave" block with superset
  // signatures. Only the two methods unique to this block are kept here.
  lkRetroLinkExpense: (expense_id: string, loan_id: string, loan_payment_id?: string): Promise<any> =>
    invoke('lk:retrolink', { expense_id, loan_id, loan_payment_id }),
  lkBackfillExpenses: (all?: boolean): Promise<{ created: number; migrated: number; payments_processed: number; created_interest?: number; created_principal?: number; error?: string }> =>
    invoke('lk:backfill-expenses', { all: !!all }),
  loanPayoffScenario: (loan_id: string, extra_per_payment: number): Promise<{ baseline_total_interest: number; baseline_payoff_date: string; scenario_total_interest: number; scenario_payoff_date: string; interest_saved: number; months_saved: number; error?: string }> =>
    invoke('loans:payoff-scenario', { loan_id, extra_per_payment }),
  loansAggregate: (): Promise<{ stats: any; upcoming: any[] } | { error?: string }> =>
    invoke('loans:aggregate'),
  loansAggregateSchedule: (months?: number): Promise<Array<{ month: string; principal: number; interest: number; payment: number; balance: number }> | { error?: string }> =>
    invoke('loans:aggregate-schedule', { months: months || 60 }),
  loansCheckOverdue: (): Promise<{ overdue_count: number; by_loan: any[]; error?: string }> =>
    invoke('loans:check-overdue'),
  loanExportPDF: (loan_id: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    invoke('loans:export-pdf', { loan_id }),

  // A7: Line-item snippet library
  snippetsList: (opts?: { category?: string }): Promise<any[] | { error?: string }> =>
    invoke('snippets:list', opts || {}),
  snippetSave: (payload: any): Promise<any> =>
    invoke('snippets:save', payload),
  snippetDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('snippets:delete', { id }),
  snippetTrackUse: (id: string): Promise<{ ok?: boolean }> =>
    invoke('snippets:track-use', { id }),

  // D3: Period close + lockdown
  periodList: (): Promise<any[] | { error?: string }> =>
    invoke('period:list'),
  periodIsClosed: (date: string): Promise<{ is_closed: boolean; period?: any }> =>
    invoke('period:is-closed', { date }),
  periodClose: (payload: { period_start: string; period_end: string; reason?: string; closed_by?: string }): Promise<{ ok?: boolean; id?: string; error?: string }> =>
    invoke('period:close', payload),
  periodReopen: (payload: { id: string; reason?: string; reopened_by?: string }): Promise<{ ok?: boolean; error?: string }> =>
    invoke('period:reopen', payload),

  // Tax Forms (P4.46/47/50)
  taxForm941: (year: number, quarter: 1 | 2 | 3 | 4): Promise<any> =>
    invoke('tax:form-941', { year, quarter }),
  taxScheduleC: (year: number): Promise<any> =>
    invoke('tax:schedule-c', { year }),
  tax1099NEC: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-nec', { year }),
  taxW2: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:w2', { year }),
  taxScheduleSE: (year: number, w2_ss_wages?: number): Promise<any> =>
    invoke('tax:schedule-se', { year, w2_ss_wages }),
  taxSalesTax: (period_start: string, period_end: string, opts?: { filing_frequency?: 'monthly' | 'quarterly' | 'annual'; prepayments?: number; early_filing_discount_pct?: number; state?: string }): Promise<any> =>
    invoke('tax:sales-tax', { period_start, period_end, opts }),
  taxW3: (year: number): Promise<any> =>
    invoke('tax:w3', { year }),
  taxForm940: (year: number, opts?: { multi_state?: boolean; credit_reduction_state?: boolean; total_deposits?: number }): Promise<any> =>
    invoke('tax:form-940', { year, opts }),
  tax1099MISC: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-misc', { year }),
  taxForm944: (year: number): Promise<any> =>
    invoke('tax:form-944', { year }),
  taxForm945: (year: number, opts?: { line1_override?: number; line4_override?: number; is_final_return?: boolean; final_payment_date?: string; is_semiweekly_depositor?: boolean }): Promise<any> =>
    invoke('tax:form-945', { year, opts }),
  taxSchedule941B: (year: number, quarter: 1 | 2 | 3 | 4): Promise<any> =>
    invoke('tax:schedule-941b', { year, quarter }),
  taxForm945A: (year: number, parent_form: 'form-944' | 'form-945' | 'form-941' = 'form-945'): Promise<any> =>
    invoke('tax:form-945-a', { year, parent_form }),
  tax1099INT: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-int', { year }),
  tax1099DIV: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-div', { year }),
  tax1099R: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-r', { year }),
  tax1099K: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-k', { year }),
  tax1099B: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-b', { year }),
  tax1099G: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-g', { year }),
  tax1099C: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-c', { year }),
  tax1099SA: (year: number): Promise<any[] | { error?: string }> =>
    invoke('tax:1099-sa', { year }),
  taxW2C: (year: number, corrections: any[] = []): Promise<any[] | { error?: string }> =>
    invoke('tax:w2c', { year, corrections }),
  taxForm1096: (year: number): Promise<any> =>
    invoke('tax:form-1096', { year }),
  taxSchedule1: (year: number, opts?: { w2_other_wages?: number }): Promise<any> =>
    invoke('tax:schedule-1', { year, opts }),
  taxSchedule2: (year: number, opts?: { w2_other_wages?: number }): Promise<any> =>
    invoke('tax:schedule-2', { year, opts }),
  taxSchedule3: (year: number): Promise<any> =>
    invoke('tax:schedule-3', { year }),
  taxScheduleA: (year: number, opts?: { agi?: number }): Promise<any> =>
    invoke('tax:schedule-a', { year, opts }),
  taxScheduleB: (year: number, opts?: { interest_payers?: any[]; dividend_payers?: any[]; foreign_account?: boolean; foreign_country?: string }): Promise<any> =>
    invoke('tax:schedule-b', { year, opts }),
  taxScheduleD: (year: number, opts?: { short_term_lines?: any[]; long_term_lines?: any[]; short_term_carryover?: number; long_term_carryover?: number }): Promise<any> =>
    invoke('tax:schedule-d', { year, opts }),
  taxForm1040ES: (year: number, opts?: { prior_year_total_tax?: number; withholding_credits?: number; projected_other_income?: number; filing_status?: 'single' | 'mfj' | 'hoh'; ytd_months?: number }): Promise<any> =>
    invoke('tax:form-1040-es', { year, opts }),
  taxForm8995: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-8995', { year, opts }),
  taxForm4562: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-4562', { year, opts }),
  taxForm8829: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-8829', { year, opts }),
  taxForm4797: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-4797', { year, opts }),
  taxForm7004: (opts: any): Promise<any> =>
    invoke('tax:form-7004', { opts }),
  taxForm4868: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-4868', { year, opts }),
  taxForm1065: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-1065', { year, opts }),
  taxForm1120: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-1120', { year, opts }),
  taxForm1120S: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-1120s', { year, opts }),
  taxScheduleK1: (opts: any): Promise<any> =>
    invoke('tax:schedule-k1', { opts }),
  taxForm1041: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-1041', { year, opts }),
  // Wave 7 — ACA
  taxForm1094C: (year: number, opts?: any): Promise<any> =>
    invoke('tax:form-1094c', { year, opts }),
  taxForm1095C: (opts: any): Promise<any> =>
    invoke('tax:form-1095c', { opts }),
  // Wave 8 — Entity lifecycle
  taxFormSS4: (opts?: any): Promise<any> =>
    invoke('tax:form-ss4', { opts }),
  taxForm2553: (opts?: any): Promise<any> =>
    invoke('tax:form-2553', { opts }),
  taxForm8832: (opts?: any): Promise<any> =>
    invoke('tax:form-8832', { opts }),
  taxForm8822B: (opts?: any): Promise<any> =>
    invoke('tax:form-8822b', { opts }),
  // Wave 9 — Utah
  taxTC40: (year: number, opts?: any): Promise<any> =>
    invoke('tax:tc40', { year, opts }),
  taxTC20: (year: number, opts?: any): Promise<any> =>
    invoke('tax:tc20', { year, opts }),
  taxTC20S: (year: number, opts?: any): Promise<any> =>
    invoke('tax:tc20s', { year, opts }),
  taxTC65: (year: number, opts?: any): Promise<any> =>
    invoke('tax:tc65', { year, opts }),
  taxTC62M: (year: number, periodStart: string, periodEnd: string, opts?: any): Promise<any> =>
    invoke('tax:tc62m', { year, period_start: periodStart, period_end: periodEnd, opts }),
  taxTC941: (year: number, opts?: any): Promise<any> =>
    invoke('tax:tc941', { year, opts }),

  // ─── Compliance documents (W-4 / W-9 / I-9) ───
  complianceList: (filters?: { person_type?: 'employee' | 'vendor' | 'client'; form_type?: string; status?: string }): Promise<any[]> =>
    invoke('compliance:list', filters),
  complianceListForPerson: (person_type: 'employee' | 'vendor' | 'client', person_id: string): Promise<any[]> =>
    invoke('compliance:list-for-person', { person_type, person_id }),
  complianceUpsert: (record: any): Promise<any> =>
    invoke('compliance:upsert', record),
  complianceDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('compliance:delete', { id }),
  complianceGetMissing: (): Promise<any[]> =>
    invoke('compliance:get-missing'),
  complianceGetExpiring: (days_ahead?: number): Promise<any[]> =>
    invoke('compliance:get-expiring', { days_ahead }),
  complianceAutoExpire: (): Promise<number> =>
    invoke('compliance:auto-expire'),
  complianceGenerateBlankPDF: (form_type: 'W-4' | 'W-9' | 'I-9', person_type?: 'employee' | 'vendor' | 'client', person_id?: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    invoke('compliance:generate-blank-pdf', { form_type, person_type, person_id }),
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
    invoke('tax:export-form-pdf', { form, year, ...(opts || {}) }),

  // B7: Client risk scoring
  clientsRiskScore: (clientId?: string): Promise<any[] | { error?: string }> =>
    invoke('clients:risk-score', clientId ? { client_id: clientId } : {}),

  // B13: Tax deduction finder
  taxDeductionScan: (year?: number): Promise<any> =>
    invoke('tax:deduction-scan', { year }),

  // B5: Receipt OCR + parsing (offline via tesseract.js)
  ocrScanReceiptPick: (): Promise<{ ok?: boolean; cancelled?: boolean; parsed?: any; filePath?: string; error?: string }> =>
    invoke('ocr:scan-receipt-pick'),
  ocrScanReceiptFile: (filePath: string): Promise<{ ok?: boolean; parsed?: any; error?: string }> =>
    invoke('ocr:scan-receipt-file', { filePath }),

  // B3: Auto-categorize an expense based on history
  suggestExpenseCategory: (opts: { vendor_id?: string | null; vendor_name?: string | null; description?: string | null; amount?: number | null }): Promise<{ category_id: string | null; category_name: string | null; confidence: number; source: string; occurrences: number; totalSeen: number; error?: string }> =>
    invoke('expense:suggest-category', opts),

  // B11: Suggest invoice matches for a bank-import line
  suggestPaymentMatches: (opts: { amount: number; date: string; description: string }): Promise<any[]> =>
    invoke('payment:suggest-matches', opts),

  // B14: Auto-reconciliation — bulk-applies high-confidence matches
  autoReconcile: (opts?: { threshold?: number; dryRun?: boolean }): Promise<{
    ok?: boolean; dry_run?: boolean; threshold?: number;
    scanned?: number; applied?: number; skipped?: number; ambiguous?: number;
    applied_detail?: any[]; skipped_detail?: any[]; error?: string;
  }> =>
    invoke('payment:auto-reconcile', opts || {}),

  // P4.49: Mileage log
  mileageList: (opts?: { year?: number; limit?: number }): Promise<any[] | { error?: string }> =>
    invoke('mileage:list', opts || {}),
  mileageSave: (payload: any): Promise<any> =>
    invoke('mileage:save', payload),
  mileageDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('mileage:delete', { id }),
  mileageSummary: (year: number): Promise<{ count: number; totalMiles: number; totalDeduction: number; error?: string }> =>
    invoke('mileage:summary', { year }),
  mileageCurrentRate: (year?: number): Promise<{ business_rate: number; medical_rate?: number; charitable_rate?: number; error?: string }> =>
    invoke('mileage:current-rate', { year }),

  // P6.69: iCal calendar export
  exportInvoicesICS: (): Promise<{ ics?: string; error?: string }> =>
    invoke('cal:export-invoices-ics'),
  exportPayrollICS: (): Promise<{ ics?: string; error?: string }> =>
    invoke('cal:export-payroll-ics'),

  // P6.70: Webhook subscriptions
  webhooksList: (): Promise<any[]> =>
    invoke('webhooks:list'),
  webhooksSave: (payload: { id?: string; event_type: string; target_url: string; secret?: string; enabled?: number; description?: string }): Promise<{ ok?: boolean; id?: string; error?: string }> =>
    invoke('webhooks:save', payload),
  webhooksDelete: (id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('webhooks:delete', { id }),

  // P1.15/16/17: Integrity check (schema drift, orphan FKs, PRAGMAs)
  integrityCheck: (opts?: { skipOrphanScan?: boolean }): Promise<any> =>
    invoke('integrity:check', opts || {}),
  integrityCleanupOrphans: (target: string): Promise<{ cleaned: number; error?: string }> =>
    invoke('integrity:cleanup-orphans', { target }),
  integrityVacuum: (): Promise<{ ok: boolean; sizeBefore: number; sizeAfter: number; error?: string }> =>
    invoke('integrity:vacuum'),

  // P1.13: Trash (soft-delete recovery) ────────────────────
  // listTrash returns records grouped by table; restore undoes a
  // soft-delete; purge physically removes ONE record; empty purges
  // ALL soft-deleted records for the active company.
  trashList: (): Promise<{ items?: Record<string, any[]>; error?: string }> =>
    invoke('trash:list'),
  trashRestore: (table: string, id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('trash:restore', { table, id }),
  trashPurge: (table: string, id: string): Promise<{ ok?: boolean; error?: string }> =>
    invoke('trash:purge', { table, id }),
  trashEmpty: (): Promise<{ ok?: boolean; purged?: number; error?: string }> =>
    invoke('trash:empty'),

  // P1.12: Duplicate-invoice detector — returns up to 3 recent
  // invoices for the same client with similar total + due_date.
  // Caller decides whether to surface a confirm modal.
  checkDuplicateInvoices: (payload: {
    client_id: string;
    total: number;
    due_date: string | null;
    excludeId?: string | null;
  }): Promise<{ duplicates: Array<{ id: string; invoice_number: string; total: number; due_date: string; status: string; created_at: string }> }> =>
    invoke('invoice:check-duplicates', payload),

  // mode: 'combined' (single PDF, page-broken) | 'separate' (folder of PDFs) | 'zip' (all in one ZIP archive)
  batchExportPDF: (
    invoiceIds: string[],
    mode: 'combined' | 'separate' | 'zip' = 'combined',
  ): Promise<{ path?: string; dir?: string; files?: string[]; count?: number; skipped?: number; cancelled?: boolean; error?: string }> =>
    invoke('invoice:batch-pdf', { invoiceIds, mode }),

  // ─── Invoice Automation ───────────────────────────
  applyLateFees: (): Promise<{ applied: number }> =>
    invoke('invoice:apply-late-fees'),
  runDunning: (): Promise<{ advanced: number }> =>
    invoke('invoice:run-dunning'),

  // ─── Payroll Summary ─────────────────────────────
  employeeSummary: (employeeId: string): Promise<any> =>
    invoke('payroll:employee-summary', { employeeId }),

  // ─── Employee Document Generation ────────────────
  // ─── HR Suite (50 features: HR1–HR50) ────────────────────
  // Benefits (HR1-HR10)
  hrBenefitPlans: (activeOnly?: boolean) => invoke('hr:benefit-plans', { activeOnly }),
  hrBenefitPlanUpsert: (plan: any) => invoke('hr:benefit-plan:upsert', plan),
  hrBenefitPlanDelete: (id: string) => invoke('hr:benefit-plan:delete', { id }),
  hrBenefitPlanSummary: () => invoke('hr:benefit-plan:summary'),
  hrBenefitPlanEnrollees: (planId: string) => invoke('hr:benefit-plan:enrollees', { planId }),
  hrEnroll: (enrollment: any) => invoke('hr:enroll', enrollment),
  hrEnrollmentTerminate: (id: string, endDate?: string) => invoke('hr:enrollment:terminate', { id, endDate }),
  hrEmployeeBenefits: (employeeId: string) => invoke('hr:employee-benefits', { employeeId }),
  hrEnrollmentUpdate: (id: string, data: any) => invoke('hr:enrollment:update', { id, ...data }),
  hrBenefitsCostPerEmployee: () => invoke('hr:benefits-cost-per-employee'),
  // Overtime (HR11-HR15)
  hrOvertimeRules: () => invoke('hr:overtime-rules'),
  hrOvertimeRuleUpsert: (rule: any) => invoke('hr:overtime-rule:upsert', rule),
  hrOvertimeRuleDelete: (id: string) => invoke('hr:overtime-rule:delete', { id }),
  hrOvertimeCalculate: (hours: { daily: number; weekly: number }, stateCode?: string) => invoke('hr:overtime:calculate', { hours, stateCode }),
  hrOvertimeSummary: (startDate: string, endDate: string) => invoke('hr:overtime:summary', { startDate, endDate }),
  // Time-off (HR16-HR27)
  hrTimeOffSubmit: (req: any) => invoke('hr:time-off:submit', req),
  hrTimeOffApprove: (id: string, approvedBy: string) => invoke('hr:time-off:approve', { id, approvedBy }),
  hrTimeOffDeny: (id: string, reason?: string) => invoke('hr:time-off:deny', { id, reason }),
  hrTimeOffCancel: (id: string) => invoke('hr:time-off:cancel', { id }),
  hrTimeOffList: (opts?: { employeeId?: string; status?: string }) => invoke('hr:time-off:list', opts || {}),
  hrTimeOffPendingCount: (): Promise<number> => invoke('hr:time-off:pending-count'),
  hrTimeOffCalendar: (month: string) => invoke('hr:time-off:calendar', { month }),
  hrAccrualsList: (employeeId: string) => invoke('hr:accruals:list', { employeeId }),
  hrAccrualsUpsert: (accrual: any) => invoke('hr:accruals:upsert', accrual),
  hrAccrualsRun: (employeeId: string, hoursWorked?: number) => invoke('hr:accruals:run', { employeeId, hoursWorked }),
  hrAccrualsDeduct: (employeeId: string, type: string, hours: number) => invoke('hr:accruals:deduct', { employeeId, type, hours }),
  // Salary reviews (HR28-HR32)
  hrSalaryReviews: (employeeId: string) => invoke('hr:salary-reviews:list', { employeeId }),
  hrSalaryReviewCreate: (review: any) => invoke('hr:salary-review:create', review),
  hrSalaryReviewDelete: (id: string) => invoke('hr:salary-review:delete', { id }),
  hrSalaryReviewDashboard: () => invoke('hr:salary-review:dashboard'),
  hrEmployeesDueForReview: (months?: number) => invoke('hr:employees-due-for-review', { months }),
  // State allocations (HR33-HR36)
  hrStateAllocations: (employeeId: string) => invoke('hr:state-allocations:list', { employeeId }),
  hrStateAllocationUpsert: (alloc: any) => invoke('hr:state-allocation:upsert', alloc),
  hrStateAllocationDelete: (id: string) => invoke('hr:state-allocation:delete', { id }),
  hrMultiStateSummary: () => invoke('hr:multi-state-summary'),
  // Pay schedules (HR37-HR40)
  hrPaySchedules: () => invoke('hr:pay-schedules'),
  hrPayScheduleUpsert: (sched: any) => invoke('hr:pay-schedule:upsert', sched),
  hrPayScheduleDelete: (id: string) => invoke('hr:pay-schedule:delete', { id }),
  hrNextPayDates: (count?: number) => invoke('hr:next-pay-dates', { count }),
  // Onboarding templates (HR41-HR45)
  hrOnboardingTemplates: () => invoke('hr:onboarding-templates'),
  hrOnboardingTemplateUpsert: (tpl: any) => invoke('hr:onboarding-template:upsert', tpl),
  hrOnboardingTemplateDelete: (id: string) => invoke('hr:onboarding-template:delete', { id }),
  hrOnboardingApplyTemplate: (employeeId: string, templateId: string) => invoke('hr:onboarding:apply-template', { employeeId, templateId }),
  hrOnboardingAssignments: (employeeId: string) => invoke('hr:onboarding:assignments', { employeeId }),
  hrOnboardingToggle: (id: string, done: boolean, completedBy?: string) => invoke('hr:onboarding:toggle', { id, done, completedBy }),
  // Analytics (HR46-HR50)
  hrDashboard: () => invoke('hr:dashboard'),
  hrTurnoverRate: (year?: number) => invoke('hr:turnover-rate', { year }),
  hrPayrollCostSummary: () => invoke('hr:payroll-cost-summary'),
  hrAnniversaries: () => invoke('hr:anniversaries'),
  hrBirthdays: () => invoke('hr:birthdays'),

  // ─── HR Suite Wave 2 (HR51–HR100) ────────────────────────
  // Garnishments (HR51-HR55)
  hrGarnishments: (employeeId?: string) => invoke('hr:garnishments', { employeeId }),
  hrGarnishmentUpsert: (order: any) => invoke('hr:garnishment:upsert', order),
  hrGarnishmentDelete: (id: string) => invoke('hr:garnishment:delete', { id }),
  hrGarnishmentSummary: () => invoke('hr:garnishment:summary'),
  hrGarnishmentRecordDeduction: (orderId: string, amount: number) => invoke('hr:garnishment:record-deduction', { orderId, amount }),
  // Workers' Comp (HR56-HR60)
  hrWorkersComp: () => invoke('hr:workers-comp'),
  hrWorkersCompUpsert: (cls: any) => invoke('hr:workers-comp:upsert', cls),
  hrWorkersCompDelete: (id: string) => invoke('hr:workers-comp:delete', { id }),
  hrWorkersCompEstimate: (annualPayroll: number) => invoke('hr:workers-comp:estimate', { annualPayroll }),
  hrWorkersCompByState: () => invoke('hr:workers-comp:by-state'),
  // Retirement (HR61-HR66)
  hrRetirement: (employeeId?: string) => invoke('hr:retirement', { employeeId }),
  hrRetirementUpsert: (rc: any) => invoke('hr:retirement:upsert', rc),
  hrRetirementDelete: (id: string) => invoke('hr:retirement:delete', { id }),
  hrRetirementSummary: () => invoke('hr:retirement:summary'),
  hrRetirementNearingLimit: () => invoke('hr:retirement:nearing-limit'),
  hrRetirementRecordPayment: (id: string, employeeAmount: number, employerAmount: number) => invoke('hr:retirement:record-payment', { id, employeeAmount, employerAmount }),
  // Compliance docs (HR67-HR71)
  hrComplianceDocs: (personType?: string, personId?: string) => invoke('hr:compliance-docs', { personType, personId }),
  hrComplianceDocUpsert: (doc: any) => invoke('hr:compliance-doc:upsert', doc),
  hrComplianceDocDelete: (id: string) => invoke('hr:compliance-doc:delete', { id }),
  hrComplianceExpiring: (days?: number) => invoke('hr:compliance:expiring', { days }),
  hrComplianceOverview: () => invoke('hr:compliance:overview'),
  // Year-end (HR72-HR75)
  hrYearEndGet: (year: number) => invoke('hr:year-end:get', { year }),
  hrYearEndGenerate: (year: number) => invoke('hr:year-end:generate', { year }),
  hrYearEndList: () => invoke('hr:year-end:list'),
  hrYearEndYoY: () => invoke('hr:year-end:yoy'),
  // Labor cost (HR76-HR80)
  hrLaborCostByDept: () => invoke('hr:labor-cost:by-dept'),
  hrLaborCostByType: () => invoke('hr:labor-cost:by-type'),
  hrLaborCostTotal: () => invoke('hr:labor-cost:total'),
  hrCostPerHire: (year?: number) => invoke('hr:cost-per-hire', { year }),
  hrCompensationDistribution: () => invoke('hr:compensation-distribution'),
  // Directory + org (HR81-HR85)
  hrDirectory: () => invoke('hr:directory'),
  hrHeadcountByMonth: (months?: number) => invoke('hr:headcount-by-month', { months }),
  hrByLocation: () => invoke('hr:by-location'),
  hrTenureMilestones: () => invoke('hr:tenure-milestones'),
  hrNewHireReport: (days?: number) => invoke('hr:new-hire-report', { days }),
  // Pay equity (HR86-HR90)
  hrPayEquityByDept: () => invoke('hr:pay-equity:by-dept'),
  hrPayEquityByRole: () => invoke('hr:pay-equity:by-role'),
  hrCompensationBenchmark: () => invoke('hr:compensation-benchmark'),
  hrRecentRaises: (days?: number) => invoke('hr:recent-raises', { days }),
  hrTopEarners: (limit?: number) => invoke('hr:top-earners', { limit }),
  // Probation + retention (HR91-HR95)
  hrProbation: (days?: number) => invoke('hr:probation', { days }),
  hrOnboardingProgressAll: () => invoke('hr:onboarding-progress'),
  hrOnboardingOverdue: () => invoke('hr:onboarding-overdue'),
  hrRetentionRisk: () => invoke('hr:retention-risk'),
  hrSatisfactionProxy: () => invoke('hr:satisfaction-proxy'),
  // Advanced reports (HR96-HR100)
  hrEmployeeSnapshot: (employeeId: string) => invoke('hr:employee-snapshot', { employeeId }),
  hrBulkStatusChange: (employeeIds: string[], newStatus: string) => invoke('hr:bulk-status-change', { employeeIds, newStatus }),
  hrExportRoster: () => invoke('hr:export-roster'),
  hrTerminationReport: (year?: number) => invoke('hr:termination-report', { year }),
  hrCompanyWideMetrics: () => invoke('hr:company-wide-metrics'),

  // ─── HR Suite Wave 3 (HR101–HR150) ───────────────────────
  // COBRA (HR101-106)
  hrCobraList: (employeeId?: string) => invoke('hr:cobra:list', { employeeId }),
  hrCobraUpsert: (rec: any) => invoke('hr:cobra:upsert', rec),
  hrCobraDelete: (id: string) => invoke('hr:cobra:delete', { id }),
  hrCobraPendingNotices: () => invoke('hr:cobra:pending-notices'),
  hrCobraMarkSent: (id: string) => invoke('hr:cobra:mark-sent', { id }),
  hrCobraSummary: () => invoke('hr:cobra:summary'),
  // Direct deposit (HR107-112)
  hrDDAccounts: (employeeId?: string) => invoke('hr:dd-accounts', { employeeId }),
  hrDDAccountUpsert: (acct: any) => invoke('hr:dd-account:upsert', acct),
  hrDDAccountDelete: (id: string) => invoke('hr:dd-account:delete', { id }),
  hrDDBatches: () => invoke('hr:dd-batches'),
  hrDDBatchCreate: (batch: any) => invoke('hr:dd-batch:create', batch),
  hrDDBatchSubmit: (id: string) => invoke('hr:dd-batch:submit', { id }),
  // Life events (HR113-117)
  hrLifeEvents: (employeeId?: string) => invoke('hr:life-events', { employeeId }),
  hrLifeEventCreate: (evt: any) => invoke('hr:life-event:create', evt),
  hrLifeEventProcessed: (id: string) => invoke('hr:life-event:processed', { id }),
  hrLifeEventsPending: () => invoke('hr:life-events:pending'),
  hrLifeEventDelete: (id: string) => invoke('hr:life-event:delete', { id }),
  // W-2 runs (HR118-122)
  hrW2Runs: () => invoke('hr:w2-runs'),
  hrW2RunGet: (year: number) => invoke('hr:w2-run:get', { year }),
  hrW2RunGenerate: (year: number) => invoke('hr:w2-run:generate', { year }),
  hrW2RunSubmit: (id: string, submittedBy?: string) => invoke('hr:w2-run:submit', { id, submittedBy }),
  hrW2PerEmployee: (year: number) => invoke('hr:w2-per-employee', { year }),
  // Check runs (HR123-126)
  hrCheckRuns: () => invoke('hr:check-runs'),
  hrCheckRunCreate: (run: any) => invoke('hr:check-run:create', run),
  hrCheckRunPrinted: (id: string) => invoke('hr:check-run:printed', { id }),
  hrCheckRunVoid: (id: string) => invoke('hr:check-run:void', { id }),
  // State reciprocity + journal (HR127-130)
  hrStateReciprocity: () => invoke('hr:state-reciprocity'),
  hrCheckReciprocity: (workState: string, residentState: string) => invoke('hr:check-reciprocity', { workState, residentState }),
  hrPayrollJournalLinks: () => invoke('hr:payroll-journal-links'),
  hrPayrollJournalLinkCreate: (link: any) => invoke('hr:payroll-journal-link:create', link),
  // Legacy garnishments (HR131-135)
  hrGarnishmentsLegacy: (employeeId?: string) => invoke('hr:garnishments-legacy', { employeeId }),
  hrGarnishmentLegacyUpsert: (g: any) => invoke('hr:garnishment-legacy:upsert', g),
  hrGarnishmentLegacyDelete: (id: string) => invoke('hr:garnishment-legacy:delete', { id }),
  hrGarnishmentLegacyRecordPayment: (id: string, amount: number) => invoke('hr:garnishment-legacy:record-payment', { id, amount }),
  hrGarnishmentsLegacyTotal: () => invoke('hr:garnishments-legacy:total'),
  // Advanced payroll analytics (HR136-140)
  hrPayrollByMonth: (months?: number) => invoke('hr:payroll-by-month', { months }),
  hrAvgPayByDept: () => invoke('hr:avg-pay-by-dept'),
  hrPayrollTaxLiability: (year?: number) => invoke('hr:payroll-tax-liability', { year }),
  hrHighestPaidByDept: () => invoke('hr:highest-paid-by-dept'),
  hrPayStubSearch: (opts: { employeeId?: string; startDate?: string; endDate?: string; limit?: number }) => invoke('hr:pay-stub-search', opts),
  // Workforce planning (HR141-145)
  hrHeadcountForecast: (months?: number) => invoke('hr:headcount-forecast', { months }),
  hrLaborBudgetVariance: () => invoke('hr:labor-budget-variance'),
  hrDeptStaffing: () => invoke('hr:dept-staffing'),
  hrFTECount: () => invoke('hr:fte-count'),
  hrSeasonalHiring: () => invoke('hr:seasonal-hiring'),
  // HR action log + misc (HR146-150)
  hrActionLog: (days?: number) => invoke('hr:action-log', { days }),
  hrEmployeeCostBreakdown: (employeeId: string) => invoke('hr:employee-cost-breakdown', { employeeId }),
  hrEmployeeTimeline: (employeeId: string) => invoke('hr:employee-timeline', { employeeId }),
  hrOrgSummary: () => invoke('hr:org-summary'),
  hrComplianceChecklist: () => invoke('hr:compliance-checklist'),

  employeeChecklist: (employeeId: string, phase: 'onboarding' | 'offboarding'): Promise<{ steps: Array<{ key: string; label: string; description: string; auto: boolean; done: boolean; category: string }>; done: number; total: number; phase: string; employee_name?: string; error?: string }> =>
    invoke('employee:checklist', { employeeId, phase }),
  employeeChecklistToggle: (employeeId: string, phase: string, stepKey: string, done: boolean): Promise<{ ok?: boolean; error?: string }> =>
    invoke('employee:checklist-toggle', { employeeId, phase, stepKey, done }),

  generateEquipmentAgreement: (employeeId: string, signatures?: { employee?: { name: string; date: string }; employer?: { name: string; date: string }; employerTitle?: string }): Promise<{ html: string }> =>
    invoke('employee:generate-equipment-agreement', { employeeId, signatures }),

  generateEmployeeAgreement: (employeeId: string, signatures?: { employee?: { name: string; date: string }; employer?: { name: string; date: string }; employerTitle?: string }): Promise<{ html: string }> =>
    invoke('employee:generate-employee-agreement', { employeeId, signatures }),

  // ─── E-Sign ───────────────────────────────────────
  esignList: (filters?: any): Promise<any[]> =>
    invoke('esign:list', filters),

  esignGet: (id: string): Promise<any> =>
    invoke('esign:get', { id }),

  esignCreate: (title: string, description: string, content: string): Promise<{ id: string }> =>
    invoke('esign:create', { title, description, content }),

  esignUpdate: (id: string, title: string, description: string, content: string): Promise<any> =>
    invoke('esign:update', { id, title, description, content }),

  esignDelete: (id: string): Promise<any> =>
    invoke('esign:delete', { id }),

  esignSign: (documentId: string, typedName: string, signerType: string, signerId: string, signerName: string, signedAt?: string): Promise<{ id?: string; signatureHash?: string; status?: string; signedAt?: string; error?: string }> =>
    invoke('esign:sign', { documentId, typedName, signerType, signerId, signerName, signedAt }),

  esignRevoke: (id: string, reason?: string): Promise<any> =>
    invoke('esign:revoke', { id, reason }),

  esignVerify: (id: string): Promise<{ verified: boolean; hashMatch?: boolean; signatureValid?: boolean; signedCount?: number; status?: string; contentHash?: string; currentHash?: string; error?: string }> =>
    invoke('esign:verify', { id }),

  esignSetPermissions: (documentId: string, permissions: Array<{ userId: string; level: string }>): Promise<any> =>
    invoke('esign:set-permissions', { documentId, permissions }),

  esignGetPermissions: (documentId: string): Promise<any[]> =>
    invoke('esign:get-permissions', { documentId }),

  esignGetAuditLog: (documentId: string): Promise<any[]> =>
    invoke('esign:get-audit-log', { documentId }),

  // ─── Reports ─────────────────────────────────────
  budgetVsActual: (budgetId: string): Promise<any> =>
    invoke('reports:budget-vs-actual', { budgetId }),

  // ─── Quotes ────────────────────────────────────────
  quotesNextNumber: (): Promise<string> =>
    invoke('quotes:next-number'),
  quotesConvertToInvoice: (quoteId: string): Promise<{ invoice_id: string }> =>
    invoke('quotes:convert-to-invoice', { quoteId }),

  // ─── Client Insights ──────────────────────────────────
  clientInsights: (clientId: string): Promise<any> =>
    invoke('client:insights', { clientId }),

  // ─── Project Profitability ────────────────────────────
  projectProfitability: (projectId: string): Promise<any> =>
    invoke('project:profitability', { projectId }),

  // VPS Backup
  backupToVps: (): Promise<{ success?: boolean; error?: string; size?: number; timestamp?: string }> =>
    invoke('backup:to-vps'),
  restoreFromVps: (): Promise<{ success?: boolean; error?: string; message?: string }> =>
    invoke('backup:restore-from-vps'),

  getDashboardData: (companyId: string): Promise<any> =>
    invoke('analytics:dashboard-data', { companyId }),
  listPtoPolicies: (companyId: string): Promise<any[]> =>
    invoke('payroll:pto-policies', { companyId }),
  savePtoPolicy: (data: Record<string, any>): Promise<any> =>
    invoke('payroll:pto-policy-save', data),
  listPtoBalances: (companyId: string): Promise<any[]> =>
    invoke('payroll:pto-balances', { companyId }),
  adjustPto: (employeeId: string, policyId: string, hours: number, note: string): Promise<any> =>
    invoke('payroll:pto-adjust', { employeeId, policyId, hours, note }),
  getStateTaxRate: (state: string, grossPay: number, allowances: number, periodsPerYear: number): Promise<any> =>
    invoke('payroll:state-tax-rate', { state, grossPay, allowances, periodsPerYear }),

  // ─── Cross-entity graph ────────────────────────────────
  // Powers the Related / Timeline panels on detail pages. `graph` returns
  // groups of related records across every module; `timeline` merges
  // audit_log + email_log + notifications + documents for one entity.
  entity: {
    graph: (companyId: string, type: string, id: string): Promise<Array<{
      key: string; label: string; entityType: string; rows: Array<Record<string, unknown>>; total?: number;
    }>> => invoke('entity:graph', { companyId, type, id }),

    timeline: (companyId: string, type: string, id: string, limit?: number): Promise<Array<{
      id: string; at: string; kind: 'audit' | 'email' | 'notification' | 'document' | 'stripe';
      action: string; title: string; detail?: string; source?: string; metadata?: Record<string, unknown>;
    }>> => invoke('entity:timeline', { companyId, type, id, limit }),

    link: (args: { companyId: string; fromType: string; fromId: string; toType: string; toId: string; relation: string; metadata?: Record<string, unknown> }): Promise<{ ok: boolean; error?: string }> =>
      invoke('entity:link', args),

    unlink: (args: { companyId: string; fromType: string; fromId: string; toType: string; toId: string; relation: string }): Promise<{ ok: boolean }> =>
      invoke('entity:unlink', args),
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
      invoke('stripe:call', args),

    /** Read cached objects for a resource (never hits the network). */
    listCached: (resource: string, companyId: string, limit?: number): Promise<any[]> =>
      invoke('stripe:listCached', { resource, companyId, limit }),

    retrieveCached: (resource: string, companyId: string, stripeId: string): Promise<any | null> =>
      invoke('stripe:retrieveCached', { resource, companyId, stripeId }),

    /** Full refresh of one resource — paginates through Stripe and re-populates cache. */
    sync: (resource: string, companyId: string): Promise<{ count: number; drained: number }> =>
      invoke('stripe:sync', { resource, companyId }),

    syncState: (companyId: string): Promise<Array<{ resource: string; last_synced_at: string | null; last_ok_at: string | null; last_error: string | null }>> =>
      invoke('stripe:syncState', { companyId }),

    queueStatus: (companyId: string): Promise<Array<{ status: string; count: number }>> =>
      invoke('stripe:queueStatus', { companyId }),

    drainQueue: (companyId: string): Promise<{ drained: number; failed: number }> =>
      invoke('stripe:drainQueue', { companyId }),

    resources: (): Promise<{
      byGroup: Record<string, Array<{ key: string; label: string; preview: boolean }>>;
      all: Record<string, { label: string; group?: string; actions: string[]; custom: string[]; preview: boolean }>;
    }> => invoke('stripe:resources'),

    testConnection: (companyId: string): Promise<{ ok: boolean; error?: string; account?: any }> =>
      invoke('stripe:testConnection', { companyId }),
  },

  // ─── Expense Approval & Reimbursement ──────────────
  expenseCheckPolicy: (expense: any, lineItems?: any[]) =>
    invoke('expense:check-policy', { expense, lineItems }),
  expenseCheckDuplicate: (companyId: string, vendorId: string | undefined, amount: number, date: string, excludeId?: string) =>
    invoke('expense:check-duplicate', { companyId, vendorId, amount, date, excludeId }),
  expenseCheckPeriodLock: (companyId: string, date: string) =>
    invoke('expense:check-period-lock', { companyId, date }),
  expenseSubmit: (expenseId: string, submittedBy: string, approverId?: string) =>
    invoke('expense:submit', { expenseId, submittedBy, approverId }),
  expenseDecide: (expenseId: string, userId: string, decision: 'approve' | 'reject' | 'needs_info', comment?: string, stepId?: string) =>
    invoke('expense:decide', { expenseId, userId, decision, comment, stepId }),
  expenseApprovalQueue: (companyId: string, userId: string) =>
    invoke('expense:approval-queue', { companyId, userId }),
  expenseSetApprovalChain: (expenseId: string, approverIds: string[]) =>
    invoke('expense:set-approval-chain', { expenseId, approverIds }),
  expenseListApprovalSteps: (expenseId: string) =>
    invoke('expense:list-approval-steps', { expenseId }),
  expenseListComments: (expenseId: string) =>
    invoke('expense:list-comments', { expenseId }),
  expenseAddComment: (expenseId: string, userId: string, body: string) =>
    invoke('expense:add-comment', { expenseId, userId, body }),
  expenseGenerateToken: (expenseId: string) =>
    invoke('expense:generate-token', { expenseId }),
  expenseValidateToken: (expenseId: string, token: string) =>
    invoke('expense:validate-token', { expenseId, token }),
  expenseLock: (expenseId: string, locked: boolean) =>
    invoke('expense:lock', { expenseId, locked }),
  expenseApprovalSla: (companyId: string) =>
    invoke('expense:approval-sla', { companyId }),
  reimbursableForEmployee: (companyId: string, employeeId: string, periodStart?: string, periodEnd?: string) =>
    invoke('expense:reimbursable-for-employee', { companyId, employeeId, periodStart, periodEnd }),
  reimbursementBalances: (companyId: string) =>
    invoke('expense:reimbursement-balances', { companyId }),
  reimbursementCreateBatch: (companyId: string, employeeId: string, expenseIds: string[], periodStart?: string, periodEnd?: string, notes?: string) =>
    invoke('reimbursement:create-batch', { companyId, employeeId, expenseIds, periodStart, periodEnd, notes }),
  reimbursementMarkPaidPayroll: (batchId: string, payrollRunId: string) =>
    invoke('reimbursement:mark-paid-payroll', { batchId, payrollRunId }),
  reimbursementAging: (companyId: string, days?: number) =>
    invoke('reimbursement:aging', { companyId, days }),
  reimbursementCheckThreshold: (companyId: string, employeeId: string) =>
    invoke('reimbursement:check-threshold', { companyId, employeeId }),
  reimbursementListBatches: (companyId: string) =>
    invoke('reimbursement:list-batches', { companyId }),
  reimbursementBatchDetail: (batchId: string) =>
    invoke('reimbursement:batch-detail', { batchId }),
  reimbursementAchExport: (batchId: string) =>
    invoke('reimbursement:ach-export', { batchId }),

  // ── Universal Tags ──
  tagsList: (companyId: string, includeDeleted = false) =>
    invoke('tags:list', { companyId, includeDeleted }),
  tagsGroupsList: (companyId: string) => invoke('tags:groups-list', { companyId }),
  tagsGroupCreate: (data: any) => invoke('tags:group-create', data),
  tagsGroupUpdate: (id: string, data: any) => invoke('tags:group-update', { id, data }),
  tagsGroupDelete: (id: string) => invoke('tags:group-delete', { id }),
  tagsCreate: (data: any) => invoke('tags:create', data),
  tagsUpdate: (id: string, data: any) => invoke('tags:update', { id, data }),
  tagsRename: (id: string, name: string) => invoke('tags:rename', { id, name }),
  tagsSoftDelete: (id: string) => invoke('tags:soft-delete', { id }),
  tagsRestore: (id: string) => invoke('tags:restore', { id }),
  tagsMerge: (sourceId: string, targetId: string) => invoke('tags:merge', { sourceId, targetId }),
  tagsGetForEntity: (companyId: string, entityType: string, entityId: string) =>
    invoke('tags:get-for-entity', { companyId, entityType, entityId }),
  tagsSetForEntity: (companyId: string, entityType: string, entityId: string, tagIds: string[]) =>
    invoke('tags:set-for-entity', { companyId, entityType, entityId, tagIds }),
  tagsBulkApply: (companyId: string, entityType: string, entityIds: string[], tagIds: string[]) =>
    invoke('tags:bulk-apply', { companyId, entityType, entityIds, tagIds }),
  tagsBulkRemove: (companyId: string, entityType: string, entityIds: string[], tagIds: string[]) =>
    invoke('tags:bulk-remove', { companyId, entityType, entityIds, tagIds }),
  tagsSearchEntities: (companyId: string, entityType: string, tagIds: string[], mode: 'all' | 'any' = 'all') =>
    invoke('tags:search-entities', { companyId, entityType, tagIds, mode }),
  tagsUsageStats: (companyId: string) => invoke('tags:usage-stats', { companyId }),
  tagsRulesList: (companyId: string) => invoke('tags:rules-list', { companyId }),
  tagsRuleCreate: (data: any) => invoke('tags:rule-create', data),
  tagsRuleUpdate: (id: string, data: any) => invoke('tags:rule-update', { id, data }),
  tagsRuleDelete: (id: string) => invoke('tags:rule-delete', { id }),
  tagsRunRules: (companyId: string, entityType: string, entity: any) =>
    invoke('tags:run-rules', { companyId, entityType, entity }),
  tagsExportCsv: (companyId: string) => invoke('tags:export-csv', { companyId }),
  tagsImportCsv: (companyId: string, csv: string) => invoke('tags:import-csv', { companyId, csv }),

  // ── Custom Fields ──
  customFieldsList: (companyId: string, entityType?: string) =>
    invoke('customFields:list', { companyId, entityType }),
  customFieldsCreate: (data: any) => invoke('customFields:create', data),
  customFieldsUpdate: (id: string, data: any) => invoke('customFields:update', { id, data }),
  customFieldsDelete: (id: string) => invoke('customFields:delete', { id }),
  customFieldsGetValues: (companyId: string, entityType: string, entityId: string) =>
    invoke('customFields:get-values', { companyId, entityType, entityId }),
  customFieldsSetValues: (companyId: string, entityType: string, entityId: string, values: Record<string, any>) =>
    invoke('customFields:set-values', { companyId, entityType, entityId, values }),
  customFieldsUsageStats: (companyId: string, entityType: string) =>
    invoke('customFields:usage-stats', { companyId, entityType }),
  customFieldsBulkFill: (companyId: string, entityType: string, fieldKey: string, value: any) =>
    invoke('customFields:bulk-fill', { companyId, entityType, fieldKey, value }),
  customFieldsSearch: (companyId: string, entityType: string, fieldKey: string, op: string, value: any) =>
    invoke('customFields:search', { companyId, entityType, fieldKey, op, value }),

  // ─── Tax System ─────────────────────────────────
  taxGetUtahConfig: (year: number): Promise<any> =>
    invoke('tax:get-utah-config', { year }),
  taxSaveUtahConfig: (year: number, config: Record<string, any>): Promise<any> =>
    invoke('tax:save-utah-config', { year, config }),
  taxGetFilingSummary: (year: number, quarter?: number): Promise<any> =>
    invoke('tax:get-filing-summary', { year, quarter }),
  taxRecordFiling: (data: { form_type: string; year: number; quarter: number; filed_date?: string; confirmation_number?: string; amount_paid?: number; payment_date?: string; notes?: string }): Promise<any> =>
    invoke('tax:record-filing', data),
  taxGetW2Data: (year: number, employee_id?: string): Promise<any[]> =>
    invoke('tax:get-w2-data', { year, employee_id }),
  taxGetW3Data: (year: number): Promise<any> =>
    invoke('tax:get-w3-data', { year }),
  taxDashboardSummary: (year: number): Promise<any> =>
    invoke('tax:dashboard-summary', { year }),
  taxLiabilityReport: (year: number, quarter_start: number, quarter_end: number): Promise<any> =>
    invoke('tax:liability-report', { year, quarter_start, quarter_end }),
  taxEmployeeTaxSummary: (year: number, employee_id?: string): Promise<any[]> =>
    invoke('tax:employee-tax-summary', { year, employee_id }),
  taxCalcPayroll: (grossPay: number, payFrequency: string, w4: any, utah: any, ytdGross: number): Promise<any> =>
    invoke('tax:calc-payroll', { grossPay, payFrequency, w4, utah, ytdGross }),

  // ─── Cognitive Command Layer ─────────────────
  listCommands: () => invoke('command:list'),
  searchCommands: (query: string) => invoke('command:search', { query }),
  logCommandExecution: (data: { user_id?: string; command_id: string; params?: any; result?: string; duration_ms?: number }) =>
    invoke('command:log-execution', data),
  commandHistory: (user_id?: string, limit?: number) =>
    invoke('command:history', { user_id, limit }),
  frequentCommands: (user_id?: string, limit?: number) =>
    invoke('command:frequent', { user_id, limit }),
  listShortcuts: (user_id?: string) => invoke('shortcut:list', { user_id }),
  saveShortcut: (data: { user_id?: string; key_combo: string; command_id: string; params?: any }) =>
    invoke('shortcut:save', data),
  deleteShortcut: (id: string) => invoke('shortcut:delete', { id }),
  listMacros: (user_id?: string) => invoke('macro:list', { user_id }),
  saveMacro: (data: { id?: string; user_id?: string; name: string; description?: string; action_sequence: any[]; is_shared?: boolean }) =>
    invoke('macro:save', data),
  deleteMacro: (id: string) => invoke('macro:delete', { id }),

  // ─── Reactive Engine ────────────────
  listWorkflows: () => invoke('workflow:list'),
  saveWorkflow: (data: any) => invoke('workflow:save', data),
  deleteWorkflow: (id: string) => invoke('workflow:delete', { id }),
  workflowExecutions: (workflowId?: string, limit?: number) =>
    invoke('workflow:executions', { workflowId, limit }),
  workflowEventLog: (limit?: number) =>
    invoke('workflow:event-log', { limit }),
  emitEvent: (type: string, entityType?: string, entityId?: string, data?: any) =>
    invoke('workflow:emit-event', { type, entityType, entityId, data }),

  // ─── Predictive Intelligence ────────────────
  intelSuggestCategory: (vendor_id: string) => invoke('intel:suggest-category', { vendor_id }),
  intelDuplicateInvoices: () => invoke('intel:duplicate-invoices'),
  intelPayrollAnomaly: (employee_id: string, gross: number) => invoke('intel:payroll-anomaly', { employee_id, gross }),
  intelCashForecast: (days_ahead: number) => invoke('intel:cash-forecast', { days_ahead }),
  intelPredictPayment: (invoice_id: string) => invoke('intel:predict-payment', { invoice_id }),
  intelRefreshPatterns: () => invoke('intel:refresh-patterns'),
  intelListAnomalies: () => invoke('intel:list-anomalies'),

  // ─── Batch 1: Admin Features (15) ───────────────────
  adminCustomFieldsList: (entity_type?: string) => invoke('admin:custom-fields:list', { entity_type }),
  adminCustomFieldsUpsert: (record: any) => invoke('admin:custom-fields:upsert', record),
  adminCustomFieldsDelete: (id: string) => invoke('admin:custom-fields:delete', { id }),
  adminUserPermissionsGet: (user_id: string) => invoke('admin:user-permissions:get', { user_id }),
  adminUserPermissionsSet: (user_id: string, permissions: any) => invoke('admin:user-permissions:set', { user_id, permissions }),
  adminUserRoleSet: (user_id: string, role: string) => invoke('admin:user-role:set', { user_id, role }),
  adminTotpGenerate: (user_id: string, account_name: string) => invoke('admin:totp:generate', { user_id, account_name }),
  adminTotpEnable: (user_id: string) => invoke('admin:totp:enable', { user_id }),
  adminTotpDisable: (user_id: string) => invoke('admin:totp:disable', { user_id }),
  adminActivityFeed: (opts?: { limit?: number; entity_type?: string; performed_by?: string; since?: string }) => invoke('admin:activity-feed', opts || {}),
  adminNotificationsList: (user_id: string) => invoke('admin:notifications:list', { user_id }),
  adminNotificationsSet: (user_id: string, preference: any) => invoke('admin:notifications:set', { user_id, preference }),
  adminInvitationsCreate: (email: string, role: string, invited_by: string, expires_in_days?: number) => invoke('admin:invitations:create', { email, role, invited_by, expires_in_days }),
  adminInvitationsList: (include_expired_revoked?: boolean) => invoke('admin:invitations:list', { include_expired_revoked }),
  adminInvitationsRevoke: (id: string) => invoke('admin:invitations:revoke', { id }),
  adminPasswordPolicyGet: () => invoke('admin:password-policy:get'),
  adminPasswordValidate: (password: string) => invoke('admin:password:validate', { password }),
  adminFiscalYearRange: (calendar_year: number) => invoke('admin:fiscal-year:range', { calendar_year }),

  // ─── Batch 2: Invoicing & Expense Features (20) ───────────────
  featInvoiceLateFeeCompute: (invoice_id: string) => invoke('feat:invoice:late-fee:compute', { invoice_id }),
  featInvoiceLateFeeApply: (invoice_id: string) => invoke('feat:invoice:late-fee:apply', { invoice_id }),
  featInvoiceRemindersSchedule: (invoice_id: string, days?: number[]) => invoke('feat:invoice:reminders:schedule', { invoice_id, days }),
  featInvoiceRemindersPending: (as_of?: string) => invoke('feat:invoice:reminders:pending', { as_of }),
  featInvoiceRemindersMarkSent: (id: string) => invoke('feat:invoice:reminders:mark-sent', { id }),
  featInvoiceRecalcPaymentState: (invoice_id: string) => invoke('feat:invoice:recalc-payment-state', { invoice_id }),
  featCreditMemoCreate: (memo: any) => invoke('feat:credit-memo:create', memo),
  featCreditMemoApply: (memo_id: string, invoice_id: string, amount: number) => invoke('feat:credit-memo:apply', { memo_id, invoice_id, amount }),
  featCreditMemoList: (client_id?: string) => invoke('feat:credit-memo:list', { client_id }),
  featInvoiceBatchSendCandidates: (opts?: { status?: string; days_overdue?: number }) => invoke('feat:invoice:batch-send:candidates', opts || {}),
  featInvoiceTemplatesList: () => invoke('feat:invoice:templates:list'),
  featInvoiceTemplatesUpsert: (t: any) => invoke('feat:invoice:templates:upsert', t),
  featInvoiceExchangeRate: (invoice_id: string, rate: number) => invoke('feat:invoice:exchange-rate', { invoice_id, rate }),
  featInvoiceDeposit: (invoice_id: string, amount: number, due_date?: string) => invoke('feat:invoice:deposit', { invoice_id, amount, due_date }),
  featBudgetAlertUpsert: (record: any) => invoke('feat:budget-alert:upsert', record),
  featBudgetAlertCheck: () => invoke('feat:budget-alert:check'),
  featVendorSuggest: (prefix?: string, limit?: number) => invoke('feat:vendor:suggest', { prefix, limit }),
  featExpenseSplitCreate: (expense_id: string, splits: any[]) => invoke('feat:expense:split:create', { expense_id, splits }),
  featExpenseSplitGet: (expense_id: string) => invoke('feat:expense:split:get', { expense_id }),
  featReimbursementCreate: (record: any) => invoke('feat:reimbursement:create', record),
  featReimbursementApprove: (id: string, approved_by: string) => invoke('feat:reimbursement:approve', { id, approved_by }),
  featReimbursementReject: (id: string, reason: string) => invoke('feat:reimbursement:reject', { id, reason }),
  featReimbursementPay: (id: string, method: string) => invoke('feat:reimbursement:pay', { id, method }),
  featReimbursementList: (status?: string) => invoke('feat:reimbursement:list', { status }),
  featPerDiemUpsert: (record: any) => invoke('feat:per-diem:upsert', record),
  featPerDiemLookup: (city: string, state: string, year: number) => invoke('feat:per-diem:lookup', { city, state, year }),
  featExpenseBulkRecategorize: (expense_ids: string[], category_id: string) => invoke('feat:expense:bulk-recategorize', { expense_ids, category_id }),
  featExpenseReport: (opts: any) => invoke('feat:expense:report', opts),
  featExpenseDuplicates: (expense: any, days_window?: number) => invoke('feat:expense:duplicates', { expense, days_window }),

  // ─── Batch 3: Banking & Payroll Features (15) ─────────────────
  featBankRuleUpsert: (rule: any) => invoke('feat:bank-rule:upsert', rule),
  featBankRuleList: () => invoke('feat:bank-rule:list'),
  featBankRuleApply: (txn_ids?: string[]) => invoke('feat:bank-rule:apply', { txn_ids }),
  featReconAutoMatch: (account_id: string, date_window?: number) => invoke('feat:recon:auto-match', { account_id, date_window }),
  featBankTxDuplicates: (days_window?: number) => invoke('feat:bank-tx:duplicates', { days_window }),
  featBankTxFlagDuplicate: (txn_id: string, duplicate_of: string, confidence?: number) => invoke('feat:bank-tx:flag-duplicate', { txn_id, duplicate_of, confidence }),
  featBankTxTransfers: (date_window?: number) => invoke('feat:bank-tx:transfers', { date_window }),
  featBankTxConfirmTransfer: (outflow_id: string, inflow_id: string) => invoke('feat:bank-tx:confirm-transfer', { outflow_id, inflow_id }),
  featBankProjectBalance: (account_id: string, days_ahead?: number) => invoke('feat:bank:project-balance', { account_id, days_ahead }),
  featCsvMappingUpsert: (record: any) => invoke('feat:csv-mapping:upsert', record),
  featCsvMappingList: () => invoke('feat:csv-mapping:list'),
  featReconHistory: (account_id?: string, limit?: number) => invoke('feat:recon:history', { account_id, limit }),
  featBankOutstandingDeposits: () => invoke('feat:bank:outstanding-deposits'),
  featSalaryReviewRecord: (record: any) => invoke('feat:salary-review:record', record),
  featSalaryReviewList: (employee_id: string) => invoke('feat:salary-review:list', { employee_id }),
  featPayStubsBulk: (opts: { year?: number; quarter?: number; employee_id?: string }) => invoke('feat:pay-stubs:bulk', opts),
  featTimeOffSetBalance: (record: any) => invoke('feat:time-off:set-balance', record),
  featTimeOffRequest: (record: any) => invoke('feat:time-off:request', record),
  featTimeOffApprove: (request_id: string, approved_by: string) => invoke('feat:time-off:approve', { request_id, approved_by }),
  featTimeOffBalances: (employee_id?: string) => invoke('feat:time-off:balances', { employee_id }),
  featBonusCalculate: (opts: any) => invoke('feat:bonus:calculate', opts),
  featStateTaxRates: (state: string) => invoke('feat:state-tax:rates', { state }),
  featPayrollForecast: (months_ahead?: number) => invoke('feat:payroll:forecast', { months_ahead }),
  featOnboardingCreate: (employee_id: string, hire_date: string, template_id?: string) => invoke('feat:onboarding:create', { employee_id, hire_date, template_id }),
  featOnboardingComplete: (id: string, completed_by: string, notes?: string) => invoke('feat:onboarding:complete', { id, completed_by, notes }),
  featOnboardingProgress: (employee_id: string) => invoke('feat:onboarding:progress', { employee_id }),

  // ─── Batch 4: Reports & Analytics (10) ───────────────
  featReportPeriodOverPeriod: (opts: any) => invoke('feat:report:period-over-period', opts),
  featReportTopCustomers: (opts: any) => invoke('feat:report:top-customers', opts),
  featReportCLV: (client_id?: string) => invoke('feat:report:clv', { client_id }),
  featReportChurnPredict: (opts?: any) => invoke('feat:report:churn-predict', opts || {}),
  featReportProfitByService: (opts: any) => invoke('feat:report:profit-by-service', opts),
  featReportDeptPnL: (opts: any) => invoke('feat:report:dept-pnl', opts),
  featReportVendorYoY: (opts?: any) => invoke('feat:report:vendor-yoy', opts || {}),
  featCollectionTemplateUpsert: (t: any) => invoke('feat:collection-template:upsert', t),
  featCollectionTemplateList: () => invoke('feat:collection-template:list'),
  featCollectionTemplateRender: (template: any, invoice: any, client: any) => invoke('feat:collection-template:render', { template, invoice, client }),
  featReportYearEndTax: (year: number) => invoke('feat:report:year-end-tax', { year }),
  featWidgetsList: (user_id: string) => invoke('feat:widgets:list', { user_id }),
  featWidgetsUpsert: (w: any) => invoke('feat:widgets:upsert', w),
  featWidgetsRemove: (id: string) => invoke('feat:widgets:remove', { id }),

  // ─── Batch 5: Clients, Vendors, Documents (10) ───────────
  featClientMerge: (primary_id: string, duplicate_ids: string[]) => invoke('feat:client:merge', { primary_id, duplicate_ids }),
  featClientFindDuplicates: (opts?: any) => invoke('feat:client:find-duplicates', opts || {}),
  featTagAdd: (record: any) => invoke('feat:tag:add', record),
  featTagRemove: (id: string) => invoke('feat:tag:remove', { id }),
  featTagListEntity: (entity_type: string, entity_id: string) => invoke('feat:tag:list-entity', { entity_type, entity_id }),
  featTagListAll: (entity_type?: string) => invoke('feat:tag:list-all', { entity_type }),
  featTagSearch: (entity_type: string, tag: string) => invoke('feat:tag:search', { entity_type, tag }),
  featCommunicationLog: (record: any) => invoke('feat:communication:log', record),
  featCommunicationList: (client_id: string, opts?: any) => invoke('feat:communication:list', { client_id, ...(opts || {}) }),
  featCommunicationFollowUps: () => invoke('feat:communication:follow-ups'),
  featVendor1099Status: (year: number) => invoke('feat:vendor:1099-status', { year }),
  featVendorScorecard: (vendor_id: string, lookback_days?: number) => invoke('feat:vendor:scorecard', { vendor_id, lookback_days }),
  featVendorSetContract: (vendor_id: string, contract: any) => invoke('feat:vendor:set-contract', { vendor_id, contract }),
  featVendorExpiringContracts: (days_ahead?: number) => invoke('feat:vendor:expiring-contracts', { days_ahead }),
  featDocumentSetExpiration: (document_id: string, expires_at: string | null, reminder_days_before?: number) => invoke('feat:document:set-expiration', { document_id, expires_at, reminder_days_before }),
  featDocumentExpiring: (days_ahead?: number) => invoke('feat:document:expiring', { days_ahead }),
  featDocumentAddVersion: (record: any) => invoke('feat:document:add-version', record),
  featDocumentListVersions: (document_id: string) => invoke('feat:document:list-versions', { document_id }),
  featDocumentSetEncrypted: (document_id: string, is_encrypted: boolean) => invoke('feat:document:set-encrypted', { document_id, is_encrypted }),

  // ── Batch 6: Automation & Workflow Engine (20) ──
  featWorkflowUpsert: (w: any) => invoke('feat:workflow:upsert', w),
  featWorkflowList: (active_only?: boolean) => invoke('feat:workflow:list', { active_only }),
  featWorkflowTrigger: (trigger_type: string, payload: any) => invoke('feat:workflow:trigger', { trigger_type, payload }),
  featScheduledTaskUpsert: (t: any) => invoke('feat:scheduled-task:upsert', t),
  featScheduledTaskList: () => invoke('feat:scheduled-task:list'),
  featScheduledTaskDue: () => invoke('feat:scheduled-task:due'),
  featScheduledTaskMarkRun: (id: string, status: 'success' | 'failed', next_run_at: string) => invoke('feat:scheduled-task:mark-run', { id, status, next_run_at }),
  featApprovalChainUpsert: (c: any) => invoke('feat:approval-chain:upsert', c),
  featApprovalStart: (chain_id: string, entity_type: string, entity_id: string, submitted_by: string) => invoke('feat:approval:start', { chain_id, entity_type, entity_id, submitted_by }),
  featApprovalAct: (instance_id: string, action: 'approve' | 'reject', actor_id: string, comment?: string) => invoke('feat:approval:act', { instance_id, action, actor_id, comment }),
  featApprovalPending: (approver_user_id?: string) => invoke('feat:approval:pending', { approver_user_id }),
  featEmailTemplateUpsert: (t: any) => invoke('feat:email-template:upsert', t),
  featEmailTemplateList: (category?: string) => invoke('feat:email-template:list', { category }),
  featEmailTemplateRender: (template_id: string, data: Record<string, any>) => invoke('feat:email-template:render', { template_id, data }),
  featWebhookUpsert: (w: any) => invoke('feat:webhook:upsert', w),
  featWebhookRecordDelivery: (subscription_id: string, event_type: string, payload: any, response_status: number, response_body: string, duration_ms: number) => invoke('feat:webhook:record-delivery', { subscription_id, event_type, payload, response_status, response_body, duration_ms }),
  featAutoCategorizeLearn: (description_pattern: string, vendor_id: string | null, category_id: string) => invoke('feat:auto-categorize:learn', { description_pattern, vendor_id, category_id }),
  featAutoCategorizeSuggest: (description: string, vendor_id?: string) => invoke('feat:auto-categorize:suggest', { description, vendor_id }),
  featAutoArchiveRun: () => invoke('feat:auto-archive:run'),
  featTriggeredActionLog: (trigger_source: string, entity_type: string, entity_id: string, action_type: string, action_result: any) => invoke('feat:triggered-action:log', { trigger_source, entity_type, entity_id, action_type, action_result }),
  featTriggeredActionList: (opts?: { limit?: number; action_type?: string }) => invoke('feat:triggered-action:list', opts || {}),
  featSLAUpsert: (s: any) => invoke('feat:sla:upsert', s),
  featSLAList: () => invoke('feat:sla:list'),
  featSavedSearchUpsert: (s: any) => invoke('feat:saved-search:upsert', s),
  featSavedSearchList: (user_id: string, module?: string) => invoke('feat:saved-search:list', { user_id, module }),
  featBulkOpLog: (op: any) => invoke('feat:bulk-op:log', op),
  featBulkOpList: (opts?: { limit?: number; can_undo_only?: boolean }) => invoke('feat:bulk-op:list', opts || {}),
  featQuickActionUpsert: (a: any) => invoke('feat:quick-action:upsert', a),
  featQuickActionList: (user_id: string) => invoke('feat:quick-action:list', { user_id }),

  // ── Batch 7: Banking, Treasury, Multi-Currency (20) ──
  featCashPositionCapture: (snapshot_date?: string) => invoke('feat:cash-position:capture', { snapshot_date }),
  featCashPositionList: (opts?: { from?: string; to?: string; limit?: number }) => invoke('feat:cash-position:list', opts || {}),
  featCashForecastRebuild: (days_ahead?: number) => invoke('feat:cash-forecast:rebuild', { days_ahead }),
  featCashForecastGet: (opts?: { days?: number }) => invoke('feat:cash-forecast:get', opts || {}),
  featFxRateUpsert: (r: { rate_date: string; from_currency: string; to_currency: string; rate: number; source?: string }) => invoke('feat:fx-rate:upsert', r),
  featFxRateGet: (from: string, to: string, as_of_date?: string) => invoke('feat:fx-rate:get', { from, to, as_of_date }),
  featFxRateList: (opts?: { from?: string; to?: string; limit?: number }) => invoke('feat:fx-rate:list', opts || {}),
  featFxRevaluationRun: (as_of_date?: string, created_by?: string) => invoke('feat:fx-revaluation:run', { as_of_date, created_by }),
  featFxRevaluationList: (limit?: number) => invoke('feat:fx-revaluation:list', { limit }),
  featWireTransferUpsert: (w: any) => invoke('feat:wire-transfer:upsert', w),
  featWireTransferList: (opts?: { status?: string; limit?: number }) => invoke('feat:wire-transfer:list', opts || {}),
  featAchBatchCreate: (b: any) => invoke('feat:ach-batch:create', b),
  featAchBatchList: (opts?: { status?: string; limit?: number }) => invoke('feat:ach-batch:list', opts || {}),
  featAchBatchItems: (batch_id: string) => invoke('feat:ach-batch:items', { batch_id }),
  featAchBatchMarkSubmitted: (batch_id: string, nacha_file_path?: string) => invoke('feat:ach-batch:mark-submitted', { batch_id, nacha_file_path }),
  featBankFeeCatUpsert: (c: any) => invoke('feat:bank-fee-cat:upsert', c),
  featBankFeeCatList: () => invoke('feat:bank-fee-cat:list'),
  featBankFeeCatSuggest: (description: string) => invoke('feat:bank-fee-cat:suggest', { description }),
  featBankMatchLog: (transaction_id: string, candidate: any) => invoke('feat:bank-match:log', { transaction_id, candidate }),
  featBankMatchList: (transaction_id?: string, limit?: number) => invoke('feat:bank-match:list', { transaction_id, limit }),
  featStopPaymentUpsert: (s: any) => invoke('feat:stop-payment:upsert', s),
  featStopPaymentList: (opts?: { status?: string }) => invoke('feat:stop-payment:list', opts || {}),
  featPendingDepositUpsert: (p: any) => invoke('feat:pending-deposit:upsert', p),
  featPendingDepositList: (opts?: { status?: string }) => invoke('feat:pending-deposit:list', opts || {}),
  featPendingDepositFloat: () => invoke('feat:pending-deposit:float'),
  featPettyCashLog: (p: any) => invoke('feat:petty-cash:log', p),
  featPettyCashList: (limit?: number) => invoke('feat:petty-cash:list', { limit }),
  featPettyCashBalance: () => invoke('feat:petty-cash:balance'),
  featTreasuryUpsert: (t: any) => invoke('feat:treasury:upsert', t),
  featTreasuryList: (opts?: { status?: string; maturing_within_days?: number }) => invoke('feat:treasury:list', opts || {}),
  featLocUpsert: (lc: any) => invoke('feat:loc:upsert', lc),
  featLocList: (opts?: { status?: string }) => invoke('feat:loc:list', opts || {}),
  featCovenantUpsert: (c: any) => invoke('feat:covenant:upsert', c),
  featCovenantMeasure: (covenant_id: string, value: number) => invoke('feat:covenant:measure', { covenant_id, value }),
  featCovenantList: (opts?: { loan_id?: string; breached_only?: boolean }) => invoke('feat:covenant:list', opts || {}),
  featSweepUpsert: (s: any) => invoke('feat:sweep:upsert', s),
  featSweepList: (active_only?: boolean) => invoke('feat:sweep:list', { active_only }),
  featSweepEvaluate: () => invoke('feat:sweep:evaluate'),
  featInterCoRecord: (t: any) => invoke('feat:inter-co:record', t),
  featInterCoList: (opts?: { status?: string; limit?: number }) => invoke('feat:inter-co:list', opts || {}),
  featCcStmtUpsert: (s: any) => invoke('feat:cc-stmt:upsert', s),
  featCcStmtAddLines: (statement_id: string, lines: any[]) => invoke('feat:cc-stmt:add-lines', { statement_id, lines }),
  featCcStmtList: (opts?: { card_account_id?: string; unreconciled_only?: boolean }) => invoke('feat:cc-stmt:list', opts || {}),
  featCcStmtLines: (statement_id: string) => invoke('feat:cc-stmt:lines', { statement_id }),
  featLockboxImport: (imp: any) => invoke('feat:lockbox:import', imp),
  featLockboxList: (limit?: number) => invoke('feat:lockbox:list', { limit }),
  featLockboxItems: (import_id: string) => invoke('feat:lockbox:items', { import_id }),
  featPositivePayGenerate: (opts: { bank_account_id?: string; file_date?: string; file_format?: 'csv' | 'fixed' }) => invoke('feat:positive-pay:generate', opts),
  featPositivePayList: (limit?: number) => invoke('feat:positive-pay:list', { limit }),
  featPositivePayMarkSubmitted: (id: string) => invoke('feat:positive-pay:mark-submitted', { id }),

  // ── Batch 8: Inventory, Projects, Time (20) ──
  featWarehouseUpsert: (w: any) => invoke('feat:warehouse:upsert', w),
  featWarehouseList: (active_only?: boolean) => invoke('feat:warehouse:list', { active_only }),
  featLocationUpsert: (l: any) => invoke('feat:location:upsert', l),
  featLocationList: (warehouse_id: string) => invoke('feat:location:list', { warehouse_id }),
  featLotUpsert: (l: any) => invoke('feat:lot:upsert', l),
  featLotList: (opts?: { item_id?: string; expiring_within_days?: number; status?: string }) => invoke('feat:lot:list', opts || {}),
  featSerialUpsert: (s: any) => invoke('feat:serial:upsert', s),
  featSerialList: (opts?: { item_id?: string; status?: string; customer_id?: string }) => invoke('feat:serial:list', opts || {}),
  featTransferCreate: (t: any) => invoke('feat:transfer:create', t),
  featTransferShip: (id: string) => invoke('feat:transfer:ship', { id }),
  featTransferReceive: (id: string) => invoke('feat:transfer:receive', { id }),
  featTransferList: (opts?: { status?: string; from_warehouse_id?: string; to_warehouse_id?: string }) => invoke('feat:transfer:list', opts || {}),
  featTransferItems: (transfer_id: string) => invoke('feat:transfer:items', { transfer_id }),
  featAdjustmentCreate: (a: any) => invoke('feat:adjustment:create', a),
  featAdjustmentApprove: (id: string, approved_by: string) => invoke('feat:adjustment:approve', { id, approved_by }),
  featAdjustmentList: (opts?: { from?: string; to?: string; limit?: number }) => invoke('feat:adjustment:list', opts || {}),
  featStockTakeStart: (s: any) => invoke('feat:stock-take:start', s),
  featStockTakeCount: (session_id: string, count: any) => invoke('feat:stock-take:count', { session_id, ...count }),
  featStockTakeComplete: (session_id: string) => invoke('feat:stock-take:complete', { session_id }),
  featStockTakeList: (opts?: { status?: string }) => invoke('feat:stock-take:list', opts || {}),
  featStockTakeCounts: (session_id: string) => invoke('feat:stock-take:counts', { session_id }),
  featLowStockScan: () => invoke('feat:low-stock:scan'),
  featLowStockList: (opts?: { status?: string; severity?: string }) => invoke('feat:low-stock:list', opts || {}),
  featLowStockAck: (id: string, acknowledged_by: string) => invoke('feat:low-stock:ack', { id, acknowledged_by }),
  featValuationSetMethod: (method: 'fifo' | 'lifo' | 'average' | 'specific') => invoke('feat:valuation:set-method', { method }),
  featValuationGetMethod: () => invoke('feat:valuation:get-method'),
  featInvValueCapture: (snapshot_date?: string) => invoke('feat:inv-value:capture', { snapshot_date }),
  featInvValueList: (limit?: number) => invoke('feat:inv-value:list', { limit }),
  featTaskUpsert: (t: any) => invoke('feat:task:upsert', t),
  featTaskList: (project_id: string, opts?: { status?: string; assigned_to?: string }) => invoke('feat:task:list', { project_id, ...(opts || {}) }),
  featTaskComplete: (id: string) => invoke('feat:task:complete', { id }),
  featMilestoneUpsert: (m: any) => invoke('feat:milestone:upsert', m),
  featMilestoneList: (project_id: string) => invoke('feat:milestone:list', { project_id }),
  featResourceUpsert: (r: any) => invoke('feat:resource:upsert', r),
  featResourceList: (project_id: string) => invoke('feat:resource:list', { project_id }),
  featProjBudgetUpsert: (b: any) => invoke('feat:proj-budget:upsert', b),
  featProjBudgetList: (project_id: string) => invoke('feat:proj-budget:list', { project_id }),
  featRiskUpsert: (r: any) => invoke('feat:risk:upsert', r),
  featRiskList: (project_id: string, open_only?: boolean) => invoke('feat:risk:list', { project_id, open_only }),
  featCoUpsert: (co: any) => invoke('feat:co:upsert', co),
  featCoApprove: (id: string, approved_by: string) => invoke('feat:co:approve', { id, approved_by }),
  featCoList: (project_id: string, opts?: { status?: string }) => invoke('feat:co:list', { project_id, ...(opts || {}) }),
  featTimesheetOpen: (p: any) => invoke('feat:timesheet:open', p),
  featTimesheetSubmit: (period_id: string) => invoke('feat:timesheet:submit', { period_id }),
  featTimesheetList: (opts?: { employee_id?: string; status?: string }) => invoke('feat:timesheet:list', opts || {}),
  featTimesheetApprove: (period_id: string, approver_id: string, action: 'approve' | 'reject', comment?: string) => invoke('feat:timesheet:approve', { period_id, approver_id, action, comment }),
  featTimesheetApprovals: (period_id: string) => invoke('feat:timesheet:approvals', { period_id }),
  featBillableSummaryRebuild: (period_start: string, period_end: string) => invoke('feat:billable-summary:rebuild', { period_start, period_end }),
  featBillableSummaryGet: (opts?: any) => invoke('feat:billable-summary:get', opts || {}),
  featProfitabilityCapture: (project_id: string, snapshot_date?: string) => invoke('feat:profitability:capture', { project_id, snapshot_date }),
  featProfitabilityList: (opts?: { project_id?: string; limit?: number }) => invoke('feat:profitability:list', opts || {}),

  // ── Batch 9: CRM, Sales, Quotes (20) ──
  featStageUpsert: (s: any) => invoke('feat:stage:upsert', s),
  featStageList: (active_only?: boolean) => invoke('feat:stage:list', { active_only }),
  featStageSeedDefaults: () => invoke('feat:stage:seed-defaults'),
  featDealUpsert: (d: any) => invoke('feat:deal:upsert', d),
  featDealMoveStage: (deal_id: string, stage_id: string) => invoke('feat:deal:move-stage', { deal_id, stage_id }),
  featDealList: (opts?: any) => invoke('feat:deal:list', opts || {}),
  featDealPipelineSummary: () => invoke('feat:deal:pipeline-summary'),
  featActivityLog: (a: any) => invoke('feat:activity:log', a),
  featActivityList: (deal_id: string, limit?: number) => invoke('feat:activity:list', { deal_id, limit }),
  featTargetUpsert: (t: any) => invoke('feat:target:upsert', t),
  featTargetRefresh: (target_id: string) => invoke('feat:target:refresh', { target_id }),
  featTargetList: (opts?: { rep_id?: string; period?: string }) => invoke('feat:target:list', opts || {}),
  featPerfCapture: (opts: { rep_id?: string; period_start: string; period_end: string }) => invoke('feat:perf:capture', opts),
  featPerfList: (opts?: { rep_id?: string; limit?: number }) => invoke('feat:perf:list', opts || {}),
  featLeadFormUpsert: (f: any) => invoke('feat:lead-form:upsert', f),
  featLeadFormSubmit: (form_id: string, data: any, ip_address?: string) => invoke('feat:lead-form:submit', { form_id, data, ip_address }),
  featLeadFormList: (active_only?: boolean) => invoke('feat:lead-form:list', { active_only }),
  featLeadFormSubmissions: (form_id: string, limit?: number) => invoke('feat:lead-form:submissions', { form_id, limit }),
  featScoringUpsert: (r: any) => invoke('feat:scoring:upsert', r),
  featScoringScore: (data: any) => invoke('feat:scoring:score', { data }),
  featScoringList: () => invoke('feat:scoring:list'),
  featRoutingUpsert: (r: any) => invoke('feat:routing:upsert', r),
  featRoutingRoute: (data: any) => invoke('feat:routing:route', { data }),
  featRoutingList: () => invoke('feat:routing:list'),
  featTerritoryUpsert: (t: any) => invoke('feat:territory:upsert', t),
  featTerritoryList: (active_only?: boolean) => invoke('feat:territory:list', { active_only }),
  featCommPlanUpsert: (p: any) => invoke('feat:comm-plan:upsert', p),
  featCommPlanList: (active_only?: boolean) => invoke('feat:comm-plan:list', { active_only }),
  featCommCalc: (rep_id: string, plan_id: string, period_start: string, period_end: string) => invoke('feat:comm:calc', { rep_id, plan_id, period_start, period_end }),
  featCommList: (opts?: { rep_id?: string; paid?: boolean }) => invoke('feat:comm:list', opts || {}),
  featCommMarkPaid: (id: string) => invoke('feat:comm:mark-paid', { id }),
  featDiscountUpsert: (r: any) => invoke('feat:discount:upsert', r),
  featDiscountEvaluate: (order: { total: number; qty?: number; customer_tier?: string; item_ids?: string[] }) => invoke('feat:discount:evaluate', order),
  featDiscountList: () => invoke('feat:discount:list'),
  featPromoUpsert: (p: any) => invoke('feat:promo:upsert', p),
  featPromoRedeem: (code: string, customer_id: string | null, order_total: number, invoice_id?: string) => invoke('feat:promo:redeem', { code, customer_id, order_total, invoice_id }),
  featPromoList: () => invoke('feat:promo:list'),
  featLoyaltyTierUpsert: (t: any) => invoke('feat:loyalty:tier-upsert', t),
  featLoyaltyAward: (customer_id: string, points: number, reason: string, invoice_id?: string) => invoke('feat:loyalty:award', { customer_id, points, reason, invoice_id }),
  featLoyaltyStatus: (customer_id: string) => invoke('feat:loyalty:status', { customer_id }),
  featLoyaltyTiers: () => invoke('feat:loyalty:tiers'),
  featReferralRecord: (r: any) => invoke('feat:referral:record', r),
  featReferralConvert: (id: string, referee_customer_id: string) => invoke('feat:referral:convert', { id, referee_customer_id }),
  featReferralPayReward: (id: string) => invoke('feat:referral:pay-reward', { id }),
  featReferralList: (opts?: { status?: string; referrer_customer_id?: string }) => invoke('feat:referral:list', opts || {}),
  featQuoteTplSetLines: (template_id: string, lines: any[]) => invoke('feat:quote-tpl:set-lines', { template_id, lines }),
  featQuoteTplGetLines: (template_id: string) => invoke('feat:quote-tpl:get-lines', { template_id }),
  featQuoteLogConversion: (quote_id: string, invoice_id: string, converted_by?: string, notes?: string) => invoke('feat:quote:log-conversion', { quote_id, invoice_id, converted_by, notes }),
  featQuoteConversionList: (opts?: { quote_id?: string; limit?: number }) => invoke('feat:quote:conversion-list', opts || {}),
  featQuoteSign: (s: { quote_id: string; signer_name: string; signer_email?: string; signature_data?: string; ip_address?: string; user_agent?: string }) => invoke('feat:quote:sign', s),
  featQuoteSignatures: (quote_id: string) => invoke('feat:quote:signatures', { quote_id }),
  featRfpUpsert: (r: any) => invoke('feat:rfp:upsert', r),
  featRfpList: (opts?: { status?: string; assigned_to?: string }) => invoke('feat:rfp:list', opts || {}),
  featWinLossRecord: (w: any) => invoke('feat:win-loss:record', w),
  featWinLossSummary: (opts?: { from?: string; to?: string }) => invoke('feat:win-loss:summary', opts || {}),
  featWinLossList: (limit?: number) => invoke('feat:win-loss:list', { limit }),

  // ── Batch 10: Compliance, Security, API (20) ──
  featRetentionUpsert: (p: any) => invoke('feat:retention:upsert', p),
  featRetentionList: () => invoke('feat:retention:list'),
  featRetentionApply: (policy_id: string) => invoke('feat:retention:apply', { policy_id }),
  featDsrCreate: (r: any) => invoke('feat:dsr:create', r),
  featDsrExport: (subject_email: string) => invoke('feat:dsr:export', { subject_email }),
  featDsrComplete: (id: string, fulfilled_by: string, export_path?: string) => invoke('feat:dsr:complete', { id, fulfilled_by, export_path }),
  featDsrList: (opts?: { status?: string }) => invoke('feat:dsr:list', opts || {}),
  featAnonymizeSubject: (opts: { subject_type: string; subject_id: string; fields: string[]; performed_by: string; reason?: string; dsr_id?: string }) => invoke('feat:anonymize:subject', opts),
  featAnonymizeList: (limit?: number) => invoke('feat:anonymize:list', { limit }),
  featAuditRecord: (e: any) => invoke('feat:audit:record', e),
  featAuditHistory: (entity_type: string, entity_id: string, limit?: number) => invoke('feat:audit:history', { entity_type, entity_id, limit }),
  featSessionLog: (s: any) => invoke('feat:session:log', s),
  featSessionLogout: (session_id: string) => invoke('feat:session:logout', { session_id }),
  featSessionList: (user_id: string, limit?: number) => invoke('feat:session:list', { user_id, limit }),
  featWhitelistAdd: (w: any) => invoke('feat:whitelist:add', w),
  featWhitelistRemove: (id: string) => invoke('feat:whitelist:remove', { id }),
  featWhitelistList: (active_only?: boolean) => invoke('feat:whitelist:list', { active_only }),
  featWhitelistCheck: (ip: string) => invoke('feat:whitelist:check', { ip }),
  feat2faSetup: (user_id: string, method?: 'totp' | 'sms' | 'email') => invoke('feat:2fa:setup', { user_id, method }),
  feat2faEnable: (user_id: string) => invoke('feat:2fa:enable', { user_id }),
  feat2faDisable: (user_id: string) => invoke('feat:2fa:disable', { user_id }),
  feat2faStatus: (user_id: string) => invoke('feat:2fa:status', { user_id }),
  featApiTokenCreate: (opts: { name: string; scopes?: string[]; expires_at?: string; issued_by?: string }) => invoke('feat:api-token:create', opts),
  featApiTokenVerify: (plaintext: string) => invoke('feat:api-token:verify', { plaintext }),
  featApiTokenRevoke: (id: string) => invoke('feat:api-token:revoke', { id }),
  featApiTokenList: (include_revoked?: boolean) => invoke('feat:api-token:list', { include_revoked }),
  featRateLimitUpsert: (r: any) => invoke('feat:rate-limit:upsert', r),
  featApiRequestLog: (r: any) => invoke('feat:api-request:log', r),
  featRateLimitCheck: (token_id: string) => invoke('feat:rate-limit:check', { token_id }),
  featWebhookRotate: (subscription_id: string, rotated_by: string, reason?: string) => invoke('feat:webhook:rotate', { subscription_id, rotated_by, reason }),
  featWebhookRotations: (subscription_id: string) => invoke('feat:webhook:rotations', { subscription_id }),
  featPciUpsert: (i: any) => invoke('feat:pci:upsert', i),
  featPciList: (opts?: { status?: string }) => invoke('feat:pci:list', opts || {}),
  featSoc2Upsert: (c: any) => invoke('feat:soc2:upsert', c),
  featSoc2List: (opts?: { trust_principle?: string }) => invoke('feat:soc2:list', opts || {}),
  featMaskUpsert: (r: any) => invoke('feat:mask:upsert', r),
  featMaskApply: (value: string, mask_type?: string, visible_chars?: number, replacement_char?: string) => invoke('feat:mask:apply', { value, mask_type, visible_chars, replacement_char }),
  featMaskList: () => invoke('feat:mask:list'),
  featRtbfCreate: (r: any) => invoke('feat:rtbf:create', r),
  featRtbfVerify: (id: string) => invoke('feat:rtbf:verify', { id }),
  featRtbfFulfill: (id: string, opts: { records_deleted: number; records_anonymized: number; records_retained: number; retention_reason?: string; fulfilled_by: string }) => invoke('feat:rtbf:fulfill', { id, ...opts }),
  featRtbfList: (opts?: { status?: string }) => invoke('feat:rtbf:list', opts || {}),
  featConsentRecord: (c: any) => invoke('feat:consent:record', c),
  featConsentWithdraw: (id: string) => invoke('feat:consent:withdraw', { id }),
  featConsentList: (opts?: { subject_id?: string; subject_email?: string; consent_type?: string }) => invoke('feat:consent:list', opts || {}),
  featSubProcessorUpsert: (s: any) => invoke('feat:sub-processor:upsert', s),
  featSubProcessorList: (active_only?: boolean) => invoke('feat:sub-processor:list', { active_only }),
  featClassifyUpsert: (c: any) => invoke('feat:classify:upsert', c),
  featClassifyList: (opts?: { table_name?: string; sensitivity_level?: string }) => invoke('feat:classify:list', opts || {}),
  featEncryptionVerify: (v: any) => invoke('feat:encryption:verify', v),
  featEncryptionList: (limit?: number) => invoke('feat:encryption:list', { limit }),
  featBackupVerifyRecord: (v: any) => invoke('feat:backup-verify:record', v),
  featBackupVerifyList: (limit?: number) => invoke('feat:backup-verify:list', { limit }),
  featVulnUpsert: (v: any) => invoke('feat:vuln:upsert', v),
  featVulnList: (opts?: { status?: string; severity?: string }) => invoke('feat:vuln:list', opts || {}),
  featVulnRemediated: (id: string) => invoke('feat:vuln:remediated', { id }),

  // ═══════════ Accounting Deep-Dive (F171-F260, 90 features) ═══════════
  // Batch A: GL & JE Operations
  featRecurringJEUpsert: (r: any) => invoke('feat:recurring-je:upsert', r),
  featRecurringJEList: (active_only?: boolean) => invoke('feat:recurring-je:list', { active_only }),
  featRecurringJEDue: () => invoke('feat:recurring-je:due'),
  featRecurringJEAdvance: (id: string) => invoke('feat:recurring-je:advance', { id }),
  featRecurringJEPause: (id: string, paused?: boolean) => invoke('feat:recurring-je:pause', { id, paused }),
  featReversingJEMark: (je_id: string, reverse_on_date: string) => invoke('feat:reversing-je:mark', { je_id, reverse_on_date }),
  featReversingJELink: (original_je_id: string, reversing_je_id: string) => invoke('feat:reversing-je:link', { original_je_id, reversing_je_id }),
  featReversingJEDue: () => invoke('feat:reversing-je:due'),
  featJETemplateUpsert: (t: any) => invoke('feat:je-template:upsert', t),
  featJETemplateList: (category?: string) => invoke('feat:je-template:list', { category }),
  featJETemplateUse: (id: string) => invoke('feat:je-template:use', { id }),
  featJEFxCalc: (amount: number, from_rate: number, to_rate: number) => invoke('feat:je-fx:calc', { amount, from_rate, to_rate }),
  featIcJEPair: (opts: any) => invoke('feat:ic-je:pair', opts),
  featIcJEList: () => invoke('feat:ic-je:list'),
  featJEImportStart: (file_name: string, imported_by?: string) => invoke('feat:je-import:start', { file_name, imported_by }),
  featJEImportFinish: (id: string, summary: any) => invoke('feat:je-import:finish', { id, ...summary }),
  featJEImportList: (limit?: number) => invoke('feat:je-import:list', { limit }),
  featJECloneLines: (source_je_id: string) => invoke('feat:je:clone-lines', { source_je_id }),
  featJEAttachAdd: (a: any) => invoke('feat:je-attach:add', a),
  featJEAttachList: (je_id: string) => invoke('feat:je-attach:list', { je_id }),
  featAllocRuleUpsert: (r: any) => invoke('feat:alloc-rule:upsert', r),
  featAllocRuleApply: (rule_id: string, amount: number) => invoke('feat:alloc-rule:apply', { rule_id, amount }),
  featAllocRuleList: () => invoke('feat:alloc-rule:list'),
  featNarrativeUpsert: (n: any) => invoke('feat:narrative:upsert', n),
  featNarrativeRender: (slug: string, vars: Record<string, any>) => invoke('feat:narrative:render', { slug, vars }),
  featNarrativeList: () => invoke('feat:narrative:list'),
  featJEProof: (lines: any[]) => invoke('feat:je:proof', { lines }),
  featJEBatchPost: (ids: string[]) => invoke('feat:je:batch-post', { ids }),
  featJECommentAdd: (je_id: string, user_id: string, user_email: string, comment: string) => invoke('feat:je-comment:add', { je_id, user_id, user_email, comment }),
  featJECommentList: (je_id: string) => invoke('feat:je-comment:list', { je_id }),
  // Batch B: Chart of Accounts
  featAccountSetParent: (account_id: string, parent_account_id: string | null) => invoke('feat:account:set-parent', { account_id, parent_account_id }),
  featAccountTree: () => invoke('feat:account:tree'),
  featAccountMerge: (primary_id: string, duplicate_ids: string[]) => invoke('feat:account:merge', { primary_id, duplicate_ids }),
  featAccountRenumber: (account_id: string, new_code: string, renamed_by?: string, notes?: string) => invoke('feat:account:renumber', { account_id, new_code, renamed_by, notes }),
  featAccountRollUp: (as_of_date?: string) => invoke('feat:account:roll-up', { as_of_date }),
  featAccountSetSuspense: (account_id: string, is_suspense?: boolean) => invoke('feat:account:set-suspense', { account_id, is_suspense }),
  featAccountGetSuspense: () => invoke('feat:account:get-suspense'),
  featAccountClose: (account_id: string, reason?: string) => invoke('feat:account:close', { account_id, reason }),
  featAccountReopen: (account_id: string) => invoke('feat:account:reopen', { account_id }),
  featAccountSetTaxMapping: (account_id: string, tax_line_code: string | null, tax_form?: string) => invoke('feat:account:set-tax-mapping', { account_id, tax_line_code, tax_form }),
  featAccountByTaxLine: (tax_line_code: string) => invoke('feat:account:by-tax-line', { tax_line_code }),
  featAccountSetCashFlow: (account_id: string, section: string, subsection?: string) => invoke('feat:account:set-cash-flow', { account_id, section, subsection }),
  featOpeningBalanceSet: (b: any) => invoke('feat:opening-balance:set', b),
  featOpeningBalanceList: (as_of_date?: string) => invoke('feat:opening-balance:list', { as_of_date }),
  // Batch C: Period Close
  featCloseTplUpsert: (t: any) => invoke('feat:close-tpl:upsert', t),
  featCloseTplList: () => invoke('feat:close-tpl:list'),
  featAccrualCreate: (a: any) => invoke('feat:accrual:create', a),
  featAccrualPost: (id: string, posted_je_id: string) => invoke('feat:accrual:post', { id, posted_je_id }),
  featAccrualDueReversals: () => invoke('feat:accrual:due-reversals'),
  featAccrualMarkReversed: (id: string, reversal_je_id: string) => invoke('feat:accrual:mark-reversed', { id, reversal_je_id }),
  featAccrualList: (opts?: { status?: string }) => invoke('feat:accrual:list', opts || {}),
  featPrepaidCreate: (s: any) => invoke('feat:prepaid:create', s),
  featPrepaidRecognize: (id: string, recognition_date: string, posted_je_id?: string) => invoke('feat:prepaid:recognize', { id, recognition_date, posted_je_id }),
  featPrepaidDue: () => invoke('feat:prepaid:due'),
  featPrepaidList: (opts?: { status?: string }) => invoke('feat:prepaid:list', opts || {}),
  featDeferredRevCreate: (s: any) => invoke('feat:deferred-rev:create', s),
  featDeferredRevRecognize: (id: string, recognition_date: string, posted_je_id?: string) => invoke('feat:deferred-rev:recognize', { id, recognition_date, posted_je_id }),
  featDeferredRevDue: () => invoke('feat:deferred-rev:due'),
  featDeferredRevList: () => invoke('feat:deferred-rev:list'),
  featAutoBankFee: (amount: number, account_id: string, description?: string) => invoke('feat:auto:bank-fee', { amount, account_id, description }),
  featAutoInterestAccrual: (amount: number, account_id: string, description?: string) => invoke('feat:auto:interest-accrual', { amount, account_id, description }),
  featPeriodIsLocked: (date: string) => invoke('feat:period:is-locked', { date }),
  featCloseQuarterChecklist: (quarter_end_date: string) => invoke('feat:close:quarter-checklist', { quarter_end_date }),
  featCloseYearEnd: (opts: any) => invoke('feat:close:year-end', opts),
  featCloseListYearEnds: () => invoke('feat:close:list-year-ends'),
  // Batch D: Fixed Assets Advanced
  featAssetDispose: (d: any) => invoke('feat:asset:dispose', d),
  featAssetDisposals: () => invoke('feat:asset:disposals'),
  featAssetTransfer: (t: any) => invoke('feat:asset:transfer', t),
  featAssetTransfers: (asset_id: string) => invoke('feat:asset:transfers', { asset_id }),
  featAssetPartialDispose: (d: any) => invoke('feat:asset:partial-dispose', d),
  featAssetImpair: (i: any) => invoke('feat:asset:impair', i),
  featAssetImpairments: () => invoke('feat:asset:impairments'),
  featAssetRevalue: (r: any) => invoke('feat:asset:revalue', r),
  featAssetComponentize: (parent_asset_id: string, components: any[]) => invoke('feat:asset:componentize', { parent_asset_id, components }),
  featAROCreate: (a: any) => invoke('feat:aro:create', a),
  featAROList: () => invoke('feat:aro:list'),
  featAssetInsUpsert: (i: any) => invoke('feat:asset-ins:upsert', i),
  featAssetInsList: (asset_id: string) => invoke('feat:asset-ins:list', { asset_id }),
  featAssetWarrantyUpsert: (w: any) => invoke('feat:asset-warranty:upsert', w),
  featAssetWarrantyList: (asset_id: string) => invoke('feat:asset-warranty:list', { asset_id }),
  featAssetWarrantyExpiring: (days_ahead?: number) => invoke('feat:asset-warranty:expiring', { days_ahead }),
  featAssetSetConvention: (asset_id: string, convention: 'full_month' | 'mid_month' | 'half_year' | 'mid_quarter') => invoke('feat:asset:set-convention', { asset_id, convention }),
  // Batch E: Revenue Recognition
  featContractUpsert: (c: any) => invoke('feat:contract:upsert', c),
  featContractList: (opts?: { status?: string; client_id?: string }) => invoke('feat:contract:list', opts || {}),
  featObligationUpsert: (o: any) => invoke('feat:obligation:upsert', o),
  featObligationList: (contract_id: string) => invoke('feat:obligation:list', { contract_id }),
  featContractModLog: (m: any) => invoke('feat:contract-mod:log', m),
  featContractModList: (contract_id: string) => invoke('feat:contract-mod:list', { contract_id }),
  featSSPUpsert: (s: any) => invoke('feat:ssp:upsert', s),
  featSSPList: () => invoke('feat:ssp:list'),
  featVarConsidRecord: (v: any) => invoke('feat:var-consid:record', v),
  featRevMilestoneCreate: (m: any) => invoke('feat:rev-milestone:create', m),
  featRevMilestoneComplete: (milestone_id: string, completion_date: string, posted_je_id?: string) => invoke('feat:rev-milestone:complete', { milestone_id, completion_date, posted_je_id }),
  featRevMilestoneList: (obligation_id: string) => invoke('feat:rev-milestone:list', { obligation_id }),
  featSubWaterfall: (months_ahead?: number) => invoke('feat:sub-waterfall', { months_ahead }),
  featBundleAllocate: (items: Array<{ obligation_id: string; ssp: number }>, transaction_price: number) => invoke('feat:bundle:allocate', { items, transaction_price }),
  featReturnsReserveCalc: (period_start: string, period_end: string, historical_rate: number) => invoke('feat:returns-reserve:calc', { period_start, period_end, historical_rate }),
  featReturnsReserveList: () => invoke('feat:returns-reserve:list'),
  featRebateUpsert: (r: any) => invoke('feat:rebate:upsert', r),
  featRebateList: () => invoke('feat:rebate:list'),
  featCommDeferCreate: (c: any) => invoke('feat:comm-defer:create', c),
  featCommDeferAmortize: (deferral_id: string, amount: number) => invoke('feat:comm-defer:amortize', { deferral_id, amount }),
  featCommDeferList: () => invoke('feat:comm-defer:list'),
  // Batch F: Cost Accounting
  featCostCenterUpsert: (c: any) => invoke('feat:cost-center:upsert', c),
  featCostCenterList: (active_only?: boolean) => invoke('feat:cost-center:list', { active_only }),
  featCostAllocUpsert: (r: any) => invoke('feat:cost-alloc:upsert', r),
  featCostAllocRun: (rule_id: string, amount: number) => invoke('feat:cost-alloc:run', { rule_id, amount }),
  featCostAllocList: () => invoke('feat:cost-alloc:list'),
  featDeptUpsert: (d: any) => invoke('feat:dept:upsert', d),
  featDeptList: (active_only?: boolean) => invoke('feat:dept:list', { active_only }),
  featDeptPL: (department_id: string, period_start: string, period_end: string) => invoke('feat:dept:pl', { department_id, period_start, period_end }),
  featCostPoolUpsert: (p: any) => invoke('feat:cost-pool:upsert', p),
  featCostPoolList: () => invoke('feat:cost-pool:list'),
  featStdCostUpsert: (s: any) => invoke('feat:std-cost:upsert', s),
  featStdCostList: (opts?: { item_id?: string }) => invoke('feat:std-cost:list', opts || {}),
  featVarianceCalc: (v: any) => invoke('feat:variance:calc', v),
  featVarianceList: (opts?: { item_id?: string; limit?: number }) => invoke('feat:variance:list', opts || {}),
  featOverheadUpsert: (r: any) => invoke('feat:overhead:upsert', r),
  featOverheadApply: (rate_id: string, units: number) => invoke('feat:overhead:apply', { rate_id, units }),
  featOverheadList: () => invoke('feat:overhead:list'),
  featWIPUpsert: (w: any) => invoke('feat:wip:upsert', w),
  featWIPList: (opts?: { status?: string }) => invoke('feat:wip:list', opts || {}),
  featCOGSCompute: (period_start: string, period_end: string) => invoke('feat:cogs:compute', { period_start, period_end }),
  featBurdenUpsert: (b: any) => invoke('feat:burden:upsert', b),
  featBurdenList: () => invoke('feat:burden:list'),
  // Batch G: Audit & Controls
  featTBSnapCapture: (period_end: string, fiscal_year?: number) => invoke('feat:tb-snap:capture', { period_end, fiscal_year }),
  featTBSnapCompare: (period_end_1: string, period_end_2: string) => invoke('feat:tb-snap:compare', { period_end_1, period_end_2 }),
  featTBSnapList: () => invoke('feat:tb-snap:list'),
  featMaterialityCalc: (m: any) => invoke('feat:materiality:calc', m),
  featMaterialityList: () => invoke('feat:materiality:list'),
  featAuditSampleGenerate: (opts: any) => invoke('feat:audit-sample:generate', opts),
  featAuditSampleList: () => invoke('feat:audit-sample:list'),
  featAuditConfirmUpsert: (c: any) => invoke('feat:audit-confirm:upsert', c),
  featAuditConfirmList: (opts?: { status?: string; confirmation_type?: string }) => invoke('feat:audit-confirm:list', opts || {}),
  featWalkthroughRecord: (w: any) => invoke('feat:walkthrough:record', w),
  featWalkthroughList: () => invoke('feat:walkthrough:list'),
  featSoDDeclare: (c: any) => invoke('feat:sod:declare', c),
  featSoDAssign: (a: any) => invoke('feat:sod:assign', a),
  featSoDCheck: (user_id: string) => invoke('feat:sod:check', { user_id }),
  featSoDList: () => invoke('feat:sod:list'),
  featRCSAUpsert: (r: any) => invoke('feat:rcsa:upsert', r),
  featRCSAList: (opts?: { status?: string }) => invoke('feat:rcsa:list', opts || {}),
  featAuditIssueUpsert: (i: any) => invoke('feat:audit-issue:upsert', i),
  featAuditIssueResolve: (id: string, resolution_notes: string) => invoke('feat:audit-issue:resolve', { id, resolution_notes }),
  featAuditIssueList: (opts?: { status?: string; severity?: string }) => invoke('feat:audit-issue:list', opts || {}),
  featControlDefLog: (d: any) => invoke('feat:control-def:log', d),
  featControlDefRemediate: (id: string) => invoke('feat:control-def:remediate', { id }),
  featControlDefList: (opts?: { status?: string }) => invoke('feat:control-def:list', opts || {}),
  featAuditorInqLog: (i: any) => invoke('feat:auditor-inq:log', i),
  featAuditorInqRespond: (id: string, response_text: string, response_by?: string, supporting_docs?: string) => invoke('feat:auditor-inq:respond', { id, response_text, response_by, supporting_docs }),
  featAuditorInqList: (opts?: { status?: string }) => invoke('feat:auditor-inq:list', opts || {}),
  // Batch H: Budgeting & Forecasting Advanced
  featRollFcstUpsert: (f: any) => invoke('feat:roll-fcst:upsert', f),
  featRollFcstSetLines: (forecast_id: string, lines: any[]) => invoke('feat:roll-fcst:set-lines', { forecast_id, lines }),
  featRollFcstGetLines: (forecast_id: string) => invoke('feat:roll-fcst:get-lines', { forecast_id }),
  featRollFcstList: () => invoke('feat:roll-fcst:list'),
  featScenarioCreate: (s: any) => invoke('feat:scenario:create', s),
  featScenarioApply: (base_lines: any[], assumptions: any) => invoke('feat:scenario:apply', { base_lines, assumptions }),
  featScenarioList: () => invoke('feat:scenario:list'),
  featVarianceExplRecord: (v: any) => invoke('feat:variance-expl:record', v),
  featVarianceExplList: (opts?: { period_month?: string; material_only?: boolean }) => invoke('feat:variance-expl:list', opts || {}),
  featDriverUpsert: (d: any) => invoke('feat:driver:upsert', d),
  featDriverProject: (driver_id: string, periods: number) => invoke('feat:driver:project', { driver_id, periods }),
  featDriverList: () => invoke('feat:driver:list'),
  featBudgetConsCreate: (c: any) => invoke('feat:budget-cons:create', c),
  featBudgetConsApprove: (id: string, approved_by: string) => invoke('feat:budget-cons:approve', { id, approved_by }),
  featBudgetConsList: () => invoke('feat:budget-cons:list'),
  featBudgetApprLog: (a: any) => invoke('feat:budget-appr:log', a),
  featBudgetApprList: (budget_id: string) => invoke('feat:budget-appr:list', { budget_id }),
  featFcstAccRecord: (a: any) => invoke('feat:fcst-acc:record', a),
  featFcstAccSummary: (forecast_id?: string) => invoke('feat:fcst-acc:summary', { forecast_id }),
  featDirectCashUpsert: (f: any) => invoke('feat:direct-cash:upsert', f),
  featDirectCashList: (limit?: number) => invoke('feat:direct-cash:list', { limit }),
  featHeadcountUpsert: (h: any) => invoke('feat:headcount:upsert', h),
  featHeadcountList: (opts?: { fiscal_year?: number; department_id?: string }) => invoke('feat:headcount:list', opts || {}),
  featCapexUpsert: (c: any) => invoke('feat:capex:upsert', c),
  featCapexApprove: (id: string, approved_cost: number, approved_by: string) => invoke('feat:capex:approve', { id, approved_cost, approved_by }),
  featCapexList: (opts?: { approval_status?: string }) => invoke('feat:capex:list', opts || {}),
  // Batch I: Financial Statements
  featStmtCfgUpsert: (c: any) => invoke('feat:stmt-cfg:upsert', c),
  featStmtCfgList: (statement_type?: string) => invoke('feat:stmt-cfg:list', { statement_type }),
  featCommonSize: (lines: any[], base_amount: number) => invoke('feat:common-size', { lines, base_amount }),
  featRatiosCalc: (as_of_date: string) => invoke('feat:ratios:calc', { as_of_date }),
  featRatiosList: (limit?: number) => invoke('feat:ratios:list', { limit }),
  featKpiUpsert: (k: any) => invoke('feat:kpi:upsert', k),
  featKpiList: () => invoke('feat:kpi:list'),
  featFootnoteUpsert: (f: any) => invoke('feat:footnote:upsert', f),
  featFootnoteList: (opts?: { fiscal_year?: number; statement_type?: string; published_only?: boolean }) => invoke('feat:footnote:list', opts || {}),

  // ═══════════ Dynamic Wave (F261-F350, 90 runtime functions) ═══════════
  // Batch J: Global Search
  featSearchGlobal: (query: string, opts?: { limit?: number; entity_types?: string[] }) => invoke('feat:search:global', { query, opts }),
  featSearchRecordHistory: (user_id: string, query: string, result_count: number) => invoke('feat:search:record-history', { user_id, query, result_count }),
  featSearchRecent: (user_id: string, limit?: number) => invoke('feat:search:recent', { user_id, limit }),
  featRecentlyViewedList: (user_id: string, opts?: { entity_type?: string; limit?: number }) => invoke('feat:recently-viewed:list', { user_id, ...(opts || {}) }),
  featRecentlyViewedRecord: (user_id: string, entity_type: string, entity_id: string, entity_label?: string) => invoke('feat:recently-viewed:record', { user_id, entity_type, entity_id, entity_label }),
  featPinAdd: (user_id: string, entity_type: string, entity_id: string, entity_label?: string) => invoke('feat:pin:add', { user_id, entity_type, entity_id, entity_label }),
  featPinRemove: (user_id: string, entity_type: string, entity_id: string) => invoke('feat:pin:remove', { user_id, entity_type, entity_id }),
  featPinList: (user_id: string, entity_type?: string) => invoke('feat:pin:list', { user_id, entity_type }),
  featSearchPattern: (pattern: string, entity_type: string, opts?: { limit?: number }) => invoke('feat:search:pattern', { pattern, entity_type, opts }),
  featFuzzyMatch: (name: string, entity_type?: 'client' | 'vendor', threshold?: number) => invoke('feat:fuzzy-match', { name, entity_type, threshold }),
  featCrossRef: (entity_type: string, entity_id: string) => invoke('feat:cross-ref', { entity_type, entity_id }),
  // Batch K: Notifications
  featNotifCreate: (opts: any) => invoke('feat:notif:create', opts),
  featNotifList: (user_id: string, opts?: { unread_only?: boolean; limit?: number }) => invoke('feat:notif:list', { user_id, ...(opts || {}) }),
  featNotifMarkRead: (id: string) => invoke('feat:notif:mark-read', { id }),
  featNotifMarkAllRead: (user_id: string) => invoke('feat:notif:mark-all-read', { user_id }),
  featNotifSnooze: (id: string, until_date: string) => invoke('feat:notif:snooze', { id, until_date }),
  featNotifSetPref: (opts: any) => invoke('feat:notif:set-pref', opts),
  featNotifGetPrefs: (user_id: string) => invoke('feat:notif:get-prefs', { user_id }),
  featAlertRuleCreate: (rule: any) => invoke('feat:alert-rule:create', rule),
  featAlertRuleEvaluate: (entity_type: string, entity_data: any) => invoke('feat:alert-rule:evaluate', { entity_type, entity_data }),
  featDigestBuild: (user_id: string, period?: 'daily' | 'weekly') => invoke('feat:digest:build', { user_id, period }),
  // Batch L: Import / Export
  featCsvParse: (text: string) => invoke('feat:csv:parse', { text }),
  featCsvDetectMapping: (headers: string[], entity_type: string) => invoke('feat:csv:detect-mapping', { headers, entity_type }),
  featCsvValidate: (rows: any[], mapping: Record<string, string>, entity_type: string) => invoke('feat:csv:validate', { rows, mapping, entity_type }),
  featImportTplSave: (tpl: any) => invoke('feat:import-tpl:save', tpl),
  featImportTplList: (entity_type?: string) => invoke('feat:import-tpl:list', { entity_type }),
  featExportCsv: (rows: any[], columns: string[]) => invoke('feat:export:csv', { rows, columns }),
  featExportIif: (transactions: any[]) => invoke('feat:export:iif', { transactions }),
  featExportJobCreate: (j: any) => invoke('feat:export-job:create', j),
  featExportJobList: (active_only?: boolean) => invoke('feat:export-job:list', { active_only }),
  featExportJobMarkRun: (job_id: string, output_path?: string) => invoke('feat:export-job:mark-run', { job_id, output_path }),
  // Batch M: Bulk Actions
  featBulkUpdate: (opts: { entity_type: string; ids: string[]; fields: Record<string, any>; user_id?: string }) => invoke('feat:bulk:update', opts),
  featBulkDelete: (opts: { entity_type: string; ids: string[]; soft?: boolean; user_id?: string }) => invoke('feat:bulk:delete', opts),
  featBulkArchive: (opts: { entity_type: string; ids: string[]; user_id?: string }) => invoke('feat:bulk:archive', opts),
  featBulkChangeStatus: (opts: { entity_type: string; ids: string[]; status: string; user_id?: string }) => invoke('feat:bulk:change-status', opts),
  featBulkAssign: (opts: { entity_type: string; ids: string[]; assignee_id: string; assignee_field?: string; user_id?: string }) => invoke('feat:bulk:assign', opts),
  featBulkTag: (opts: { entity_type: string; entity_ids: string[]; tag_ids: string[] }) => invoke('feat:bulk:tag', opts),
  featBulkUntag: (opts: { entity_type: string; entity_ids: string[]; tag_ids: string[] }) => invoke('feat:bulk:untag', opts),
  featUndoList: (user_id?: string, limit?: number) => invoke('feat:undo:list', { user_id, limit }),
  featUndoApply: (snapshot_id: string) => invoke('feat:undo:apply', { snapshot_id }),
  featUndoCreateSnapshot: (opts: any) => invoke('feat:undo:create-snapshot', opts),
  // Batch N: Smart Helpers
  featSmartAnomalies: (opts?: { lookback_days?: number; z_threshold?: number }) => invoke('feat:smart:anomalies', opts || {}),
  featSmartSuggestCategory: (description: string, vendor_id?: string) => invoke('feat:smart:suggest-category', { description, vendor_id }),
  featSmartPredictPayment: (invoice_id: string) => invoke('feat:smart:predict-payment', { invoice_id }),
  featSmartFillFromPrevious: (entity_type: 'expense' | 'bill', context: { vendor_id?: string; description?: string }) => invoke('feat:smart:fill-from-previous', { entity_type, context }),
  featSmartCanonicalizeVendor: (input_name: string) => invoke('feat:smart:canonicalize-vendor', { input_name }),
  featSmartMatchTransaction: (transaction_id: string, opts?: { tolerance_days?: number; tolerance_amount_percent?: number }) => invoke('feat:smart:match-transaction', { transaction_id, opts }),
  featSmartLateRisk: (customer_id: string) => invoke('feat:smart:late-risk', { customer_id }),
  featSmartForecast: (account_id: string, periods?: number) => invoke('feat:smart:forecast', { account_id, periods }),
  featSmartRecommend: (user_id: string, limit?: number) => invoke('feat:smart:recommend', { user_id, limit }),
  featSmartDetectDupes: (entity_type?: 'expense' | 'bill', lookback_days?: number) => invoke('feat:smart:detect-dupes', { entity_type, lookback_days }),
  // Batch O: Keyboard & Macros
  featCmdRegister: (c: any) => invoke('feat:cmd:register', c),
  featCmdList: (opts?: { category?: string; scope?: string }) => invoke('feat:cmd:list', opts || {}),
  featCmdSearch: (query: string, limit?: number) => invoke('feat:cmd:search', { query, limit }),
  featMacroStart: (user_id: string, name: string, scope?: string) => invoke('feat:macro:start', { user_id, name, scope }),
  featMacroSaveSteps: (macro_id: string, steps: any[]) => invoke('feat:macro:save-steps', { macro_id, steps }),
  featMacroGetSteps: (macro_id: string) => invoke('feat:macro:get-steps', { macro_id }),
  featMacroList: (user_id: string) => invoke('feat:macro:list', { user_id }),
  featLayoutSave: (opts: { user_id: string; name: string; layout: any; is_default?: boolean }) => invoke('feat:layout:save', opts),
  featLayoutLoad: (user_id: string, name?: string) => invoke('feat:layout:load', { user_id, name }),
  featLayoutList: (user_id: string) => invoke('feat:layout:list', { user_id }),
  // Batch P: Report Engine
  featCustomReportCreate: (r: any) => invoke('feat:custom-report:create', r),
  featCustomReportRun: (report_id: string, params?: Record<string, any>) => invoke('feat:custom-report:run', { report_id, params }),
  featPivotBuild: (rows: any[], opts: { row_field: string; col_field: string; value_field: string; agg?: 'sum' | 'avg' | 'count' | 'min' | 'max' }) => invoke('feat:pivot:build', { rows, opts }),
  featReportSchedSave: (s: any) => invoke('feat:report-sched:save', s),
  featReportSchedList: () => invoke('feat:report-sched:list'),
  featReportSchedDue: () => invoke('feat:report-sched:due'),
  featReportSchedMarkRun: (schedule_id: string, next_run_at?: string) => invoke('feat:report-sched:mark-run', { schedule_id, next_run_at }),
  featCustomReportCompare: (report_id: string, params_a: any, params_b: any) => invoke('feat:custom-report:compare', { report_id, params_a, params_b }),
  featCustomReportExecutions: (report_id: string, limit?: number) => invoke('feat:custom-report:executions', { report_id, limit }),
  featCustomReportList: (opts?: { published_only?: boolean }) => invoke('feat:custom-report:list', opts || {}),
  // Batch Q: Webhook Delivery
  featWebhookRegister: (opts: { url: string; event_types: string[]; secret?: string }) => invoke('feat:webhook:register', opts),
  featWebhookSign: (payload: any, secret: string) => invoke('feat:webhook:sign', { payload, secret }),
  featWebhookVerify: (payload: any, signature: string, secret: string) => invoke('feat:webhook:verify', { payload, signature, secret }),
  featWebhookQueue: (opts: { subscription_id: string; event_type: string; payload: any }) => invoke('feat:webhook:queue', opts),
  featWebhookDue: (limit?: number) => invoke('feat:webhook:due', { limit }),
  featWebhookRecordAttempt: (queue_id: string, success: boolean, error_message?: string) => invoke('feat:webhook:record-attempt', { queue_id, success, error_message }),
  featWebhookDeliveries: (opts?: { subscription_id?: string; status?: string; limit?: number }) => invoke('feat:webhook:deliveries', opts || {}),
  featWebhookRetry: (queue_id: string) => invoke('feat:webhook:retry', { queue_id }),
  featWebhookStats: (hours?: number) => invoke('feat:webhook:stats', { hours }),
  featWebhookFireEvent: (event_type: string, payload: any) => invoke('feat:webhook:fire-event', { event_type, payload }),
  // Batch R: Real-time + Activity
  featActivityRecord: (a: any) => invoke('feat:activity:record', a),
  featActivityFeed: (opts?: { user_id?: string; entity_type?: string; entity_id?: string; limit?: number; since?: string }) => invoke('feat:activity:feed', opts || {}),
  featLockAcquire: (opts: { entity_type: string; entity_id: string; user_id: string; user_email?: string; ttl_seconds?: number }) => invoke('feat:lock:acquire', opts),
  featLockRelease: (entity_type: string, entity_id: string, user_id: string) => invoke('feat:lock:release', { entity_type, entity_id, user_id }),
  featLockCheck: (entity_type: string, entity_id: string) => invoke('feat:lock:check', { entity_type, entity_id }),
  featPresenceHeartbeat: (opts: { user_id: string; current_page?: string; current_entity_type?: string; current_entity_id?: string }) => invoke('feat:presence:heartbeat', opts),
  featPresenceActive: (seconds_window?: number) => invoke('feat:presence:active', { seconds_window }),
  featPresenceOnEntity: (entity_type: string, entity_id: string, seconds_window?: number) => invoke('feat:presence:on-entity', { entity_type, entity_id, seconds_window }),
  featActivitySummary: (opts?: { hours?: number }) => invoke('feat:activity:summary', opts || {}),
  featLockCleanup: () => invoke('feat:lock:cleanup'),

  // ═══════════════ Wave 3 (F351-F440, 90 features) ═══════════════
  // Batch S — Payroll
  featStateWhUpsert: (t: any) => invoke('feat:state-wh:upsert', t),
  featStateWhCalc: (opts: any) => invoke('feat:state-wh:calc', opts),
  featGarnUpsert: (g: any) => invoke('feat:garn:upsert', g),
  featGarnCalc: (employee_id: string, disposable_earnings: number) => invoke('feat:garn:calc', { employee_id, disposable_earnings }),
  featGarnList: (opts?: any) => invoke('feat:garn:list', opts || {}),
  featRetireUpsert: (r: any) => invoke('feat:retire:upsert', r),
  featRetireCalc: (employee_id: string, period_wages: number) => invoke('feat:retire:calc', { employee_id, period_wages }),
  featS125Upsert: (s: any) => invoke('feat:s125:upsert', s),
  featS125List: (employee_id: string) => invoke('feat:s125:list', { employee_id }),
  featPtoRuleUpsert: (r: any) => invoke('feat:pto-rule:upsert', r),
  featPtoRuleList: () => invoke('feat:pto-rule:list'),
  featEmpStateSet: (opts: any) => invoke('feat:emp-state:set', opts),
  featEmpStateGet: (employee_id: string) => invoke('feat:emp-state:get', { employee_id }),
  featWcompUpsert: (c: any) => invoke('feat:wcomp:upsert', c),
  featWcompCalc: (state_code: string, class_code: string, payroll: number) => invoke('feat:wcomp:calc', { state_code, class_code, payroll }),
  featRecipUpsert: (opts: any) => invoke('feat:recip:upsert', opts),
  featRecipCheck: (work_state: string, resident_state: string) => invoke('feat:recip:check', { work_state, resident_state }),
  featW2Run: (opts: { tax_year: number; submitted_by?: string }) => invoke('feat:w2:run', opts),
  featDdBatchBuild: (opts: any) => invoke('feat:dd-batch:build', opts),
  featDdBatchList: (limit?: number) => invoke('feat:dd-batch:list', { limit }),

  // Batch T — Sales Tax
  featNexusUpsert: (n: any) => invoke('feat:nexus:upsert', n),
  featNexusEvaluate: () => invoke('feat:nexus:evaluate'),
  featTaxJurisUpsert: (j: any) => invoke('feat:tax-juris:upsert', j),
  featTaxJurisByZip: (zip: string) => invoke('feat:tax-juris:by-zip', { zip }),
  featExemptCertUpsert: (c: any) => invoke('feat:exempt-cert:upsert', c),
  featExemptCertCheck: (customer_id: string, state_code?: string) => invoke('feat:exempt-cert:check', { customer_id, state_code }),
  featExemptCertList: (opts?: any) => invoke('feat:exempt-cert:list', opts || {}),
  featUseTaxRecord: (u: any) => invoke('feat:use-tax:record', u),
  featTaxSchedUpsert: (s: any) => invoke('feat:tax-sched:upsert', s),
  featTaxSchedUpcoming: (days_ahead?: number) => invoke('feat:tax-sched:upcoming', { days_ahead }),
  featTaxLiabRecord: (l: any) => invoke('feat:tax-liab:record', l),
  featTaxLiabMarkPaid: (id: string, payment_je_id?: string) => invoke('feat:tax-liab:mark-paid', { id, payment_je_id }),
  featTaxLiabList: (opts?: any) => invoke('feat:tax-liab:list', opts || {}),
  featTaxHolidayUpsert: (h: any) => invoke('feat:tax-holiday:upsert', h),
  featTaxHolidayActive: (state_code?: string) => invoke('feat:tax-holiday:active', { state_code }),

  // Batch U — Consolidation
  featEntitySetSub: (parent_id: string, child_id: string, ownership_pct: number, method?: string, notes?: string) => invoke('feat:entity:set-sub', { parent_id, child_id, ownership_pct, method, notes }),
  featEntityHierarchy: (parent_id: string) => invoke('feat:entity:hierarchy', { parent_id }),
  featElimRuleUpsert: (r: any) => invoke('feat:elim-rule:upsert', r),
  featElimRuleList: (parent_id: string) => invoke('feat:elim-rule:list', { parent_id }),
  featConsolGenerate: (opts: { parent_company_id: string; statement_type: 'balance_sheet' | 'income_statement'; period_end: string; generated_by?: string }) => invoke('feat:consol:generate', opts),
  featFxTranslationRecord: (t: any) => invoke('feat:fx-translation:record', t),
  featMinorityCalc: (opts: any) => invoke('feat:minority:calc', opts),
  featGoodwillRecord: (g: any) => invoke('feat:goodwill:record', g),
  featGoodwillImpair: (goodwill_id: string, impairment_amount: number) => invoke('feat:goodwill:impair', { goodwill_id, impairment_amount }),
  featEquityInvUpsert: (e: any) => invoke('feat:equity-inv:upsert', e),
  featEquityInvRecordIncome: (investment_id: string, investee_income: number) => invoke('feat:equity-inv:record-income', { investment_id, investee_income }),
  featEquityInvList: (investor_company_id: string) => invoke('feat:equity-inv:list', { investor_company_id }),

  // Batch V — Customer Portal
  featPortalCustInvite: (opts: { customer_id: string; email: string; full_name?: string }) => invoke('feat:portal-cust:invite', opts),
  featPortalActivate: (token: string, password: string) => invoke('feat:portal:activate', { token, password }),
  featPortalAuth: (email: string, password: string, company_id: string, portal_type?: string) => invoke('feat:portal:auth', { email, password, company_id, portal_type }),
  featPortalInvoices: (customer_id: string) => invoke('feat:portal:invoices', { customer_id }),
  featPortalPayRecord: (opts: any) => invoke('feat:portal-pay:record', opts),
  featPortalPayHistory: (portal_user_id: string, limit?: number) => invoke('feat:portal-pay:history', { portal_user_id, limit }),
  featPortalStatement: (customer_id: string, period_start: string, period_end: string) => invoke('feat:portal:statement', { customer_id, period_start, period_end }),
  featPortalTicketCreate: (t: any) => invoke('feat:portal-ticket:create', t),
  featPortalTicketList: (opts?: any) => invoke('feat:portal-ticket:list', opts || {}),
  featPortalDocUpload: (d: any) => invoke('feat:portal-doc:upload', d),
  featAutoPayEnroll: (opts: { customer_id: string; payment_method_id: string; max_amount_per_charge?: number }) => invoke('feat:auto-pay:enroll', opts),
  featAutoPayCancel: (customer_id: string) => invoke('feat:auto-pay:cancel', { customer_id }),
  featPortalBrandSet: (b: any) => invoke('feat:portal-brand:set', b),
  featPortalBrandGet: () => invoke('feat:portal-brand:get'),

  // Batch W — Vendor Portal
  featPortalVendInvite: (opts: { vendor_id: string; email: string; full_name?: string }) => invoke('feat:portal-vend:invite', opts),
  featVendorPoRespond: (opts: any) => invoke('feat:vendor-po:respond', opts),
  featVendorPoListResponses: (po_id?: string) => invoke('feat:vendor-po:list-responses', { po_id }),
  featVendorInvSubmit: (v: any) => invoke('feat:vendor-inv:submit', v),
  featVendorInvReview: (id: string, status: 'approved' | 'rejected', reviewed_by: string, rejection_reason?: string, matched_bill_id?: string) => invoke('feat:vendor-inv:review', { id, status, reviewed_by, rejection_reason, matched_bill_id }),
  featVendorInvList: (opts?: any) => invoke('feat:vendor-inv:list', opts || {}),
  featVendorPayStatus: (vendor_id: string) => invoke('feat:vendor-pay:status', { vendor_id }),
  featVendorAchSubmit: (opts: any) => invoke('feat:vendor-ach:submit', opts),
  featVendorAchApprove: (id: string, approved_by: string) => invoke('feat:vendor-ach:approve', { id, approved_by }),
  featVendorAchReject: (id: string, rejected_by: string) => invoke('feat:vendor-ach:reject', { id, rejected_by }),
  featVendorAchList: (opts?: any) => invoke('feat:vendor-ach:list', opts || {}),
  featVendor1099Download: (opts: any) => invoke('feat:vendor-1099:download', opts),
  featVendorAttestSubmit: (opts: any) => invoke('feat:vendor-attest:submit', opts),

  // Batch X — Time Tracking
  featTimerStart: (opts: { user_id: string; project_id?: string; task_id?: string; description?: string; is_billable?: boolean }) => invoke('feat:timer:start', opts),
  featTimerPause: (id: string) => invoke('feat:timer:pause', { id }),
  featTimerResume: (id: string) => invoke('feat:timer:resume', { id }),
  featTimerStop: (id: string) => invoke('feat:timer:stop', { id }),
  featTimerRunning: (user_id: string) => invoke('feat:timer:running', { user_id }),
  featRateUpsert: (r: any) => invoke('feat:rate:upsert', r),
  featRateEffective: (opts: { employee_id?: string; project_id?: string; role?: string; as_of_date?: string }) => invoke('feat:rate:effective', opts),
  featOtUpsert: (r: any) => invoke('feat:ot:upsert', r),
  featOtCalc: (opts: { daily_hours: number[]; weekly_hours: number; base_rate: number; state_code?: string }) => invoke('feat:ot:calc', opts),
  featProjTimeBudgetUpsert: (b: any) => invoke('feat:proj-time-budget:upsert', b),
  featProjTimeBudgetAddHours: (project_id: string, hours: number) => invoke('feat:proj-time-budget:add-hours', { project_id, hours }),
  featCalEventSync: (e: any) => invoke('feat:cal-event:sync', e),
  featCalEventToTimeEntry: (event_id: string, project_id?: string, task_id?: string) => invoke('feat:cal-event:to-time-entry', { event_id, project_id, task_id }),
  featTimeRound: (minutes: number, interval_minutes?: number, method?: 'nearest' | 'up' | 'down') => invoke('feat:time:round', { minutes, interval_minutes, method }),

  // Batch Y — Document Intelligence
  featDocClassify: (text: string) => invoke('feat:doc:classify', { text }),
  featDocRecordClassify: (opts: any) => invoke('feat:doc:record-classify', opts),
  featDocFieldExtract: (document_id: string, field_name: string, field_value: string, confidence?: number, method?: string) => invoke('feat:doc-field:extract', { document_id, field_name, field_value, confidence, method }),
  featDocFieldList: (document_id: string) => invoke('feat:doc-field:list', { document_id }),
  featBankStmtParse: (text: string) => invoke('feat:bank-stmt:parse', { text }),
  featBankStmtImport: (opts: any) => invoke('feat:bank-stmt:import', opts),
  featClausesDetect: (text: string, document_id: string) => invoke('feat:clauses:detect', { text, document_id }),
  featClausesList: (document_id: string) => invoke('feat:clauses:list', { document_id }),
  featSignFlowStart: (opts: any) => invoke('feat:sign-flow:start', opts),
  featSignFlowAdvance: (workflow_id: string) => invoke('feat:sign-flow:advance', { workflow_id }),
  featDocExpireList: (days_ahead?: number) => invoke('feat:doc-expire:list', { days_ahead }),
  featRetentionUpsertPolicy: (p: any) => invoke('feat:retention:upsert-policy', p),
  featRetentionExceeding: () => invoke('feat:retention:exceeding'),

  // Batch Z — Collaboration
  featMentionsParse: (body: string) => invoke('feat:mentions:parse', { body }),
  featMentionsList: (user_id: string, opts?: { unread_only?: boolean; limit?: number }) => invoke('feat:mentions:list', { user_id, ...(opts || {}) }),
  featMentionsMarkRead: (id: string) => invoke('feat:mentions:mark-read', { id }),
  featCommentAdd: (c: any) => invoke('feat:comment:add', c),
  featCommentList: (entity_type: string, entity_id: string, opts?: { include_internal?: boolean }) => invoke('feat:comment:list', { entity_type, entity_id, ...(opts || {}) }),
  featCommentEdit: (id: string, body: string) => invoke('feat:comment:edit', { id, body }),
  featCommentDelete: (id: string) => invoke('feat:comment:delete', { id }),
  featReactionAdd: (comment_id: string, user_id: string, emoji: string) => invoke('feat:reaction:add', { comment_id, user_id, emoji }),
  featReactionRemove: (comment_id: string, user_id: string, emoji: string) => invoke('feat:reaction:remove', { comment_id, user_id, emoji }),
  featReactionList: (comment_id: string) => invoke('feat:reaction:list', { comment_id }),
  featInternalNoteAdd: (n: any) => invoke('feat:internal-note:add', n),
  featInternalNoteList: (entity_type: string, entity_id: string) => invoke('feat:internal-note:list', { entity_type, entity_id }),
  featDraftCreate: (d: any) => invoke('feat:draft:create', d),
  featDraftMine: (user_id: string) => invoke('feat:draft:mine', { user_id }),
  featWatchAdd: (opts: any) => invoke('feat:watch:add', opts),
  featWatchRemove: (user_id: string, entity_type: string, entity_id: string) => invoke('feat:watch:remove', { user_id, entity_type, entity_id }),
  featWatchListForEntity: (entity_type: string, entity_id: string) => invoke('feat:watch:list-for-entity', { entity_type, entity_id }),
  featInboxProvision: (opts: { entity_type: string; entity_id?: string }) => invoke('feat:inbox:provision', opts),
  featInboxMatch: (inbox_address: string) => invoke('feat:inbox:match', { inbox_address }),
  featChatSend: (opts: any) => invoke('feat:chat:send', opts),
  featChatList: (opts: { user_id: string; with_user_id?: string; channel_id?: string; limit?: number }) => invoke('feat:chat:list', opts),
  featChatMarkRead: (id: string) => invoke('feat:chat:mark-read', { id }),

  // Batch AA — Integration Sync
  featStripeRecord: (opts: any) => invoke('feat:stripe:record', opts),
  featPlaidLinkCreate: (opts: any) => invoke('feat:plaid-link:create', opts),
  featPlaidLinkList: () => invoke('feat:plaid-link:list'),
  featPlaidTxSync: (t: any) => invoke('feat:plaid-tx:sync', t),
  featPlaidTxUnmatched: (limit?: number) => invoke('feat:plaid-tx:unmatched', { limit }),
  featPlaidTxMatch: (id: string, entity_type: string, entity_id: string) => invoke('feat:plaid-tx:match', { id, entity_type, entity_id }),
  featQbExportRun: (opts: { period_start: string; period_end: string; format?: 'iif' | 'csv' | 'json'; exported_by?: string }) => invoke('feat:qb-export:run', opts),
  featQbExportList: (limit?: number) => invoke('feat:qb-export:list', { limit }),
  featGmailSync: (m: any) => invoke('feat:gmail:sync', m),
  featCloudFileRecord: (f: any) => invoke('feat:cloud-file:record', f),
  featCloudFileList: (provider?: string) => invoke('feat:cloud-file:list', { provider }),
  featCalendarLink: (opts: any) => invoke('feat:calendar:link', opts),
  featCalendarIntegrations: (user_id: string) => invoke('feat:calendar:integrations', { user_id }),
  featWebhookRecvProvision: (opts: { provider?: string }) => invoke('feat:webhook-recv:provision', opts),
  featWebhookRecvReceived: (endpoint_path: string) => invoke('feat:webhook-recv:received', { endpoint_path }),
  featWebhookRecvList: () => invoke('feat:webhook-recv:list'),

  // ═══════════════ Finance Wave (F441-F540, 100 features) ═══════════════
  // Batch AB — Invoice Advanced
  featRecInvUpsert: (t: any) => invoke('feat:rec-inv:upsert', t),
  featRecInvList: (active_only?: boolean) => invoke('feat:rec-inv:list', { active_only }),
  featRecInvDue: () => invoke('feat:rec-inv:due'),
  featRecInvAdvance: (id: string, generated_invoice_id?: string) => invoke('feat:rec-inv:advance', { id, generated_invoice_id }),
  featInvApprovalLog: (opts: any) => invoke('feat:inv-approval:log', opts),
  featInvApprovalList: (invoice_id: string) => invoke('feat:inv-approval:list', { invoice_id }),
  featInvEmailLog: (e: any) => invoke('feat:inv-email:log', e),
  featInvEmailOpened: (tracking_pixel_id: string) => invoke('feat:inv-email:opened', { tracking_pixel_id }),
  featInvEmailClicked: (tracking_pixel_id: string) => invoke('feat:inv-email:clicked', { tracking_pixel_id }),
  featLateFeeUpsert: (p: any) => invoke('feat:latefee:upsert', p),
  featLateFeeCalc: (opts: { invoice_balance: number; days_overdue: number; policy_id: string }) => invoke('feat:latefee:calc', opts),
  featPayTermsUpsert: (t: any) => invoke('feat:pay-terms:upsert', t),
  featPayTermsList: () => invoke('feat:pay-terms:list'),
  featEarlyDiscCalc: (invoice_id: string, payment_date: string) => invoke('feat:early-disc:calc', { invoice_id, payment_date }),
  featProgBillCreate: (p: any) => invoke('feat:prog-bill:create', p),
  featProgBillRelease: (schedule_id: string, opts: { percent_complete: number; invoice_id?: string; notes?: string }) => invoke('feat:prog-bill:release', { schedule_id, ...opts }),
  featProgBillList: () => invoke('feat:prog-bill:list'),
  featRetainerCreate: (r: any) => invoke('feat:retainer:create', r),
  featRetainerDrawdown: (retainer_id: string, amount: number, reason?: string, invoice_id?: string) => invoke('feat:retainer:drawdown', { retainer_id, amount, reason, invoice_id }),
  featRetainerList: (opts?: { client_id?: string; status?: string }) => invoke('feat:retainer:list', opts || {}),
  featPayPlanCreate: (p: any) => invoke('feat:pay-plan:create', p),
  featPayPlanPayInstallment: (installment_id: string, amount: number) => invoke('feat:pay-plan:pay-installment', { installment_id, amount }),
  featPayPlanList: (opts?: any) => invoke('feat:pay-plan:list', opts || {}),
  featInvAttachAdd: (a: any) => invoke('feat:inv-attach:add', a),
  featInvAttachList: (invoice_id: string) => invoke('feat:inv-attach:list', { invoice_id }),
  // Batch AC — Payment Processing
  featPayLinkCreate: (opts: any) => invoke('feat:pay-link:create', opts),
  featPayLinkConsume: (short_code: string, amount?: number) => invoke('feat:pay-link:consume', { short_code, amount }),
  featReminderUpsert: (c: any) => invoke('feat:reminder:upsert', c),
  featReminderList: () => invoke('feat:reminder:list'),
  featPayRetryRecord: (opts: any) => invoke('feat:pay-retry:record', opts),
  featPayApplyPartial: (invoice_id: string, amount: number) => invoke('feat:pay:apply-partial', { invoice_id, amount }),
  featCustCreditAdd: (opts: any) => invoke('feat:cust-credit:add', opts),
  featCustCreditApply: (opts: any) => invoke('feat:cust-credit:apply', opts),
  featCustCreditGet: (customer_id: string) => invoke('feat:cust-credit:get', { customer_id }),
  featRefundRecord: (r: any) => invoke('feat:refund:record', r),
  featRefundList: (opts?: any) => invoke('feat:refund:list', opts || {}),
  featChargebackRecord: (c: any) => invoke('feat:chargeback:record', c),
  featChargebackResolve: (id: string, resolution: 'won' | 'lost', resolved_at?: string) => invoke('feat:chargeback:resolve', { id, resolution, resolved_at }),
  featCustPmAdd: (m: any) => invoke('feat:cust-pm:add', m),
  featCustPmList: (customer_id: string) => invoke('feat:cust-pm:list', { customer_id }),
  featCheckPrintRecord: (j: any) => invoke('feat:check-print:record', j),
  featCheckPrintList: (limit?: number) => invoke('feat:check-print:list', { limit }),
  featCryptoRecord: (p: any) => invoke('feat:crypto:record', p),
  // Batch AD — Expense Advanced
  featExpReportCreate: (r: any) => invoke('feat:exp-report:create', r),
  featExpReportAddExpenses: (report_id: string, expense_ids: string[]) => invoke('feat:exp-report:add-expenses', { report_id, expense_ids }),
  featExpReportSubmit: (report_id: string) => invoke('feat:exp-report:submit', { report_id }),
  featExpReportApprove: (report_id: string, approved_by: string) => invoke('feat:exp-report:approve', { report_id, approved_by }),
  featExpReportList: (opts?: any) => invoke('feat:exp-report:list', opts || {}),
  featPerDiemUpsert2: (p: any) => invoke('feat:perdiem:upsert', p),
  featPerDiemCalc: (location: string, days: number, include_lodging?: boolean) => invoke('feat:perdiem:calc', { location, days, include_lodging }),
  featVehicleUpsert: (v: any) => invoke('feat:vehicle:upsert', v),
  featVehicleList: (user_id: string) => invoke('feat:vehicle:list', { user_id }),
  featExpRecurring: () => invoke('feat:exp:recurring'),
  featExpForecast: (months_ahead?: number) => invoke('feat:exp:forecast', { months_ahead }),
  featVendor1099Recalc: (tax_year: number, vendor_id?: string) => invoke('feat:vendor-1099:recalc', { tax_year, vendor_id }),
  featVendor1099Required: (tax_year: number) => invoke('feat:vendor-1099:required', { tax_year }),
  featCatBudgetUpsert: (b: any) => invoke('feat:cat-budget:upsert', b),
  featCatBudgetRefreshActuals: (fiscal_year: number) => invoke('feat:cat-budget:refresh-actuals', { fiscal_year }),
  featReimbCreate: (r: any) => invoke('feat:reimb:create', r),
  featReimbPaid: (id: string, je_id?: string, payment_method?: string) => invoke('feat:reimb:paid', { id, je_id, payment_method }),
  featExpRebillable: (expense_id: string, client_id: string, markup_pct?: number) => invoke('feat:exp:rebillable', { expense_id, client_id, markup_pct }),
  featExpRebillableList: (client_id?: string) => invoke('feat:exp:rebillable-list', { client_id }),
  featExpRebilled: (expense_id: string, invoice_id: string) => invoke('feat:exp:rebilled', { expense_id, invoice_id }),
  featPreapprovalRequest: (p: any) => invoke('feat:preapproval:request', p),
  featPreapprovalApprove: (id: string, approved_by: string) => invoke('feat:preapproval:approve', { id, approved_by }),
  featPreapprovalReject: (id: string, reason: string) => invoke('feat:preapproval:reject', { id, reason }),
  featPreapprovalList: (opts?: any) => invoke('feat:preapproval:list', opts || {}),
  // Batch AE — Subscriptions
  featSubPlanUpsert: (p: any) => invoke('feat:sub-plan:upsert', p),
  featSubPlanList: () => invoke('feat:sub-plan:list'),
  featSubCreate: (s: any) => invoke('feat:sub:create', s),
  featSubChangePlan: (subscription_id: string, new_plan_id: string) => invoke('feat:sub:change-plan', { subscription_id, new_plan_id }),
  featSubPause: (id: string, resume_date?: string) => invoke('feat:sub:pause', { id, resume_date }),
  featSubResume: (id: string) => invoke('feat:sub:resume', { id }),
  featSubCancel: (id: string, at_period_end?: boolean) => invoke('feat:sub:cancel', { id, at_period_end }),
  featUsageRecord: (u: any) => invoke('feat:usage:record', u),
  featUsageList: (opts?: any) => invoke('feat:usage:list', opts || {}),
  featPricingTierUpsert: (t: any) => invoke('feat:pricing-tier:upsert', t),
  featPricingTierCalc: (plan_id: string, quantity: number) => invoke('feat:pricing-tier:calc', { plan_id, quantity }),
  featMrrCalc: (snapshot_date?: string) => invoke('feat:mrr:calc', { snapshot_date }),
  featChurnCalc: (period_start: string, period_end: string) => invoke('feat:churn:calc', { period_start, period_end }),
  // Batch AF — Credit & Collections
  featCreditSetLimit: (customer_id: string, limit: number) => invoke('feat:credit:set-limit', { customer_id, limit }),
  featCreditCheck: (customer_id: string, additional_charge?: number) => invoke('feat:credit:check', { customer_id, additional_charge }),
  featCreditSetHold: (customer_id: string, hold: boolean, reason?: string) => invoke('feat:credit:set-hold', { customer_id, hold, reason }),
  featAgingCalc: (as_of_date?: string) => invoke('feat:aging:calc', { as_of_date }),
  featStatementGenerate: (opts: { customer_id: string; period_start: string; period_end: string }) => invoke('feat:statement:generate', opts),
  featDunningSeqCreate: (s: any) => invoke('feat:dunning-seq:create', s),
  featDunningLog: (opts: any) => invoke('feat:dunning:log', opts),
  featWriteoffBadDebt: (opts: any) => invoke('feat:writeoff:bad-debt', opts),
  featDoubtfulCalc: (opts: any) => invoke('feat:doubtful:calc', opts),
  featAgencyHandoff: (opts: any) => invoke('feat:agency:handoff', opts),
  featAgencyRecordRecovery: (handoff_id: string, recovered_amount: number) => invoke('feat:agency:record-recovery', { handoff_id, recovered_amount }),
  featAgencyList: (opts?: any) => invoke('feat:agency:list', opts || {}),
  // Batch AG — Financial Analytics
  featArAgingChart: (as_of_date?: string) => invoke('feat:ar-aging:chart', { as_of_date }),
  featApAgingChart: (as_of_date?: string) => invoke('feat:ap-aging:chart', { as_of_date }),
  featDsoCalc: (period_days?: number) => invoke('feat:dso:calc', { period_days }),
  featDpoCalc: (period_days?: number) => invoke('feat:dpo:calc', { period_days }),
  featCccCalc: (period_days?: number) => invoke('feat:ccc:calc', { period_days }),
  featWorkingCapitalCalc: () => invoke('feat:working-capital:calc'),
  featBurnCalc: (months_history?: number) => invoke('feat:burn:calc', { months_history }),
  featRunwayCalc: (months_history?: number) => invoke('feat:runway:calc', { months_history }),
  featLtvCalc: (customer_id?: string) => invoke('feat:ltv:calc', { customer_id }),
  featCacCalc: (period_days?: number) => invoke('feat:cac:calc', { period_days }),
  featLtvCacRatio: () => invoke('feat:ltv-cac:ratio'),
  featRetentionCalc: (period_start: string, period_end: string) => invoke('feat:retention:calc', { period_start, period_end }),
  featCohortBuild: () => invoke('feat:cohort:build'),
  // Batch AH — Tax & Compliance
  feat1099RunCreate: (opts: { tax_year: number; form_type?: '1099-NEC' | '1099-MISC' }) => invoke('feat:1099-run:create', opts),
  feat1099RunList: () => invoke('feat:1099-run:list'),
  featWithholdRecord: (w: any) => invoke('feat:withhold:record', w),
  featQtaxRecord: (q: any) => invoke('feat:qtax:record', q),
  featQtaxList: (tax_year: number) => invoke('feat:qtax:list', { tax_year }),
  featTaxProvCalc: (opts: any) => invoke('feat:tax-prov:calc', opts),
  featRdCreditCalc: (opts: any) => invoke('feat:rd-credit:calc', opts),
  feat179Elect: (opts: any) => invoke('feat:179:elect', opts),
  feat179List: (tax_year?: number) => invoke('feat:179:list', { tax_year }),
  // Batch AI — Vendor Management
  featVendOnboardStart: (opts: any) => invoke('feat:vend-onboard:start', opts),
  featVendOnboardUpdate: (id: string, items_completed: number) => invoke('feat:vend-onboard:update', { id, items_completed }),
  featW9Record: (w: any) => invoke('feat:w9:record', w),
  featW9Missing: () => invoke('feat:w9:missing'),
  featVendInsRecord: (opts: any) => invoke('feat:vend-ins:record', opts),
  featVendInsExpiring: (days_ahead?: number) => invoke('feat:vend-ins:expiring', { days_ahead }),
  featVendScore: (vendor_id: string) => invoke('feat:vend:score', { vendor_id }),
  featVendDispOpen: (d: any) => invoke('feat:vend-disp:open', d),
  featVendDispResolve: (id: string, resolution_amount: number, notes?: string) => invoke('feat:vend-disp:resolve', { id, resolution_amount, notes }),
  featVendDispList: (opts?: any) => invoke('feat:vend-disp:list', opts || {}),

  // ═══════════════ Expense Advanced Wave (F541-F640, 100 features) ═══════════════
  // Batch AJ — Policy Engine
  featExpPolicyUpsert: (p: any) => invoke('feat:exp-policy:upsert', p),
  featExpPolicyList: (opts?: { scope?: string; active_only?: boolean }) => invoke('feat:exp-policy:list', opts || {}),
  featExpPolicyEvaluate: (opts: any) => invoke('feat:exp-policy:evaluate', opts),
  featExpPolicyAckViolation: (id: string, user_id: string) => invoke('feat:exp-policy:ack-violation', { id, user_id }),
  featExpPolicyViolations: (opts?: any) => invoke('feat:exp-policy:violations', opts || {}),
  featIrsRateUpsert: (opts: any) => invoke('feat:irs-rate:upsert', opts),
  featIrsRateCurrent: (tax_year?: number) => invoke('feat:irs-rate:current', { tax_year }),
  featTravelCapUpsert: (c: any) => invoke('feat:travel-cap:upsert', c),
  featTravelCapList: () => invoke('feat:travel-cap:list'),
  featExpViolationsByEmployee: (employee_id: string, months_back?: number) => invoke('feat:exp-violations:by-employee', { employee_id, months_back }),
  // Batch AK — Templates & Auto-Fill
  featExpTplSave: (t: any) => invoke('feat:exp-tpl:save', t),
  featExpTplList: (user_id?: string) => invoke('feat:exp-tpl:list', { user_id }),
  featExpTplUse: (id: string) => invoke('feat:exp-tpl:use', { id }),
  featExpTplSuggested: (user_id: string) => invoke('feat:exp-tpl:suggested', { user_id }),
  featSubDetectScan: (lookback_days?: number) => invoke('feat:sub-detect:scan', { lookback_days }),
  featSubDetectSummary: () => invoke('feat:sub-detect:summary'),
  featSubDetectConfirm: (id: string, confirmed: boolean) => invoke('feat:sub-detect:confirm', { id, confirmed }),
  featSubDetectCancel: (id: string) => invoke('feat:sub-detect:cancel', { id }),
  featAutoTagUpsert: (r: any) => invoke('feat:auto-tag:upsert', r),
  featAutoTagApply: (opts: any) => invoke('feat:auto-tag:apply', opts),
  featAutoTagList: () => invoke('feat:auto-tag:list'),
  // Batch AL — Corporate Card
  featCorpCardRegister: (c: any) => invoke('feat:corp-card:register', c),
  featCorpCardList: (opts?: { active_only?: boolean; card_holder?: string }) => invoke('feat:corp-card:list', opts || {}),
  featCardTxMatch: (card_tx_id: string, expense_id: string) => invoke('feat:card-tx:match', { card_tx_id, expense_id }),
  featCardTxImport: (opts: any) => invoke('feat:card-tx:import', opts),
  featCardTxSpendByUser: (opts?: { from?: string; to?: string }) => invoke('feat:card-tx:spend-by-user', opts || {}),
  featCardTxUnmatched: (limit?: number) => invoke('feat:card-tx:unmatched', { limit }),
  featCardTxDispute: (opts: any) => invoke('feat:card-tx:dispute', opts),
  featCardTxSpendByMerchant: (opts?: any) => invoke('feat:card-tx:spend-by-merchant', opts || {}),
  featCardTxReconcile: (card_id: string) => invoke('feat:card-tx:reconcile', { card_id }),
  featCardRuleUpsert: (r: any) => invoke('feat:card-rule:upsert', r),
  // Batch AM — Travel
  featTripCreate: (t: any) => invoke('feat:trip:create', t),
  featTripAddExpense: (expense_id: string, trip_id: string) => invoke('feat:trip:add-expense', { expense_id, trip_id }),
  featTripDays: (trip_id: string) => invoke('feat:trip:days', { trip_id }),
  featTripApplyPerdiem: (opts: any) => invoke('feat:trip:apply-perdiem', opts),
  featTripAddItinerary: (leg: any) => invoke('feat:trip:add-itinerary', leg),
  featTripItinerary: (trip_id: string) => invoke('feat:trip:itinerary', { trip_id }),
  featTripPreapprove: (trip_id: string, approved_by: string) => invoke('feat:trip:preapprove', { trip_id, approved_by }),
  featTripCostSummary: (trip_id: string) => invoke('feat:trip:cost-summary', { trip_id }),
  featTripList: (opts?: any) => invoke('feat:trip:list', opts || {}),
  // Batch AN — Mileage Advanced
  featMileageStateUpsert: (opts: any) => invoke('feat:mileage-state:upsert', opts),
  featMileageRouteCreate: (r: any) => invoke('feat:mileage-route:create', r),
  featMileageRouteAddStop: (s: any) => invoke('feat:mileage-route:add-stop', s),
  featMileageRouteStops: (route_id: string) => invoke('feat:mileage-route:stops', { route_id }),
  featMileageSplit: (opts: { total_miles: number; business_pct: number }) => invoke('feat:mileage:split', opts),
  featVehicleDepUpsert: (v: any) => invoke('feat:vehicle-dep:upsert', v),
  featVehicleMaintLog: (m: any) => invoke('feat:vehicle-maint:log', m),
  featVehicleMaintList: (vehicle_id: string) => invoke('feat:vehicle-maint:list', { vehicle_id }),
  featVehicleMaintDue: (days_ahead?: number) => invoke('feat:vehicle-maint:due', { days_ahead }),
  featVehicleSetMileageMethod: (vehicle_id: string, method: 'standard' | 'actual') => invoke('feat:vehicle:set-mileage-method', { vehicle_id, method }),
  // Batch AO — Custom Fields & Tagging
  featExpCfUpsert: (f: any) => invoke('feat:exp-cf:upsert', f),
  featExpCfList: (category_id?: string) => invoke('feat:exp-cf:list', { category_id }),
  featExpCfSetValue: (opts: any) => invoke('feat:exp-cf:set-value', opts),
  featExpCfGetValues: (expense_id: string) => invoke('feat:exp-cf:get-values', { expense_id }),
  featExpFormulaEval: (formula: string, vars: Record<string, number>) => invoke('feat:exp-formula:eval', { formula, vars }),
  featTagHierUpsert: (t: any) => invoke('feat:tag-hier:upsert', t),
  featTagHierTree: () => invoke('feat:tag-hier:tree'),
  featTagsSuggest: (description: string) => invoke('feat:tags:suggest', { description }),
  featExpBulkTag: (opts: { expense_ids: string[]; tag_ids: string[] }) => invoke('feat:exp:bulk-tag', opts),
  // Batch AP — Spend Analytics
  featSpendHeatmap: (opts?: { top_n?: number; months?: number }) => invoke('feat:spend:heatmap', opts || {}),
  featSpendForecast90d: () => invoke('feat:spend:forecast-90d'),
  featSpendTopVendors: (opts?: { from?: string; to?: string; limit?: number }) => invoke('feat:spend:top-vendors', opts || {}),
  featSpendTopCategories: (opts?: { from?: string; to?: string; limit?: number }) => invoke('feat:spend:top-categories', opts || {}),
  featSpendConcentration: (opts?: any) => invoke('feat:spend:concentration', opts || {}),
  featSpendEmployeeBenchmarks: (opts?: any) => invoke('feat:spend:employee-benchmarks', opts || {}),
  featSpendBenchmarkVsIndustry: (industry: string, total_revenue: number, opts?: any) => invoke('feat:spend:benchmark-vs-industry', { industry, total_revenue, ...(opts || {}) }),
  featCostSaveGenerate: () => invoke('feat:cost-save:generate'),
  featCostSaveList: (opts?: { status?: string }) => invoke('feat:cost-save:list', opts || {}),
  // Batch AQ — Workflow Customization
  featWfDefUpsert: (w: any) => invoke('feat:wf-def:upsert', w),
  featWfDefMatch: (opts: { amount: number; category_id?: string }) => invoke('feat:wf-def:match', opts),
  featWfDefList: () => invoke('feat:wf-def:list'),
  featDelegationCreate: (d: any) => invoke('feat:delegation:create', d),
  featDelegationResolve: (user_id: string) => invoke('feat:delegation:resolve', { user_id }),
  featDelegationList: (opts?: { active_only?: boolean }) => invoke('feat:delegation:list', opts || {}),
  featWfEscalated: () => invoke('feat:wf:escalated'),
  featWfLog: (opts: any) => invoke('feat:wf:log', opts),
  featWfPerformance: (opts?: { from?: string; to?: string }) => invoke('feat:wf:performance', opts || {}),
  // Batch AR — Mobile & Capture
  featExpInboxProvision: (user_id: string) => invoke('feat:exp-inbox:provision', { user_id }),
  featCaptureQueue: (opts: any) => invoke('feat:capture:queue', opts),
  featCapturePending: (user_id?: string) => invoke('feat:capture:pending', { user_id }),
  featCaptureProcess: (capture_id: string, created_expense_id: string) => invoke('feat:capture:process', { capture_id, created_expense_id }),
  featVoiceMemoAttach: (opts: any) => invoke('feat:voice-memo:attach', opts),
  featVoiceMemoList: (expense_id: string) => invoke('feat:voice-memo:list', { expense_id }),
  featExpSetGeo: (expense_id: string, lat: number, lng: number, location_name?: string) => invoke('feat:exp:set-geo', { expense_id, lat, lng, location_name }),
  featExpByLocation: (opts?: { radius_km?: number; lat?: number; lng?: number; limit?: number }) => invoke('feat:exp:by-location', opts || {}),
  featVoiceEntryRecord: (opts: any) => invoke('feat:voice-entry:record', opts),
  // Batch AS — Reports & Year-End
  featExpRptTplSave: (t: any) => invoke('feat:exp-rpt-tpl:save', t),
  featExpRptTplList: () => invoke('feat:exp-rpt-tpl:list'),
  featYearEndRollup: (tax_year: number) => invoke('feat:year-end:rollup', { tax_year }),
  featQuarterlyReport: (year: number, quarter: 1 | 2 | 3 | 4) => invoke('feat:quarterly:report', { year, quarter }),
  featDeptReport: (department_id: string, opts?: { from?: string; to?: string }) => invoke('feat:dept:report', { department_id, ...(opts || {}) }),
  featProjExpReport: (project_id: string) => invoke('feat:proj-exp:report', { project_id }),
  feat1099PrepReport: (tax_year: number) => invoke('feat:1099-prep:report', { tax_year }),
  featScheduleCBreakdown: (tax_year: number) => invoke('feat:schedule-c:breakdown', { tax_year }),
  featMileageLogSummary: (tax_year: number) => invoke('feat:mileage-log:summary', { tax_year }),
  featPerDiemSummary: (tax_year: number) => invoke('feat:perdiem:summary', { tax_year }),
  featCustomPeriodReport: (opts: { period_start: string; period_end: string; group_by?: 'category' | 'vendor' | 'project' | 'employee' }) => invoke('feat:custom-period:report', opts),

  // ─── Payroll Wave (F641-F740) ────────────────────────────────────
  // Batch PA: Pay Run Engine
  payrollCreatePeriod: (p: any) => invoke('payroll:create-period', p),
  payrollListPeriods: (p?: any) => invoke('payroll:list-periods', p || {}),
  payrollCreateRun: (p: any) => invoke('payroll:create-run', p),
  payrollAddItem: (p: any) => invoke('payroll:add-item', p),
  payrollCalcGross: (id: string) => invoke('payroll:calc-gross', { id }),
  payrollCalcTaxes: (id: string) => invoke('payroll:calc-taxes', { id }),
  payrollCalcNet: (id: string) => invoke('payroll:calc-net', { id }),
  payrollPostRun: (id: string) => invoke('payroll:post-run', { id }),
  payrollVoidRun: (id: string, reason?: string) => invoke('payroll:void-run', { id, reason }),
  payrollReverseItem: (id: string, reason: string) => invoke('payroll:reverse-item', { id, reason }),
  // Batch PB: Withholding
  payrollSeedFedTables: (year: number) => invoke('payroll:seed-fed-tables', { year }),
  payrollCalcFedWh: (employee_id: string, period_taxable: number, year: number, filing_status: string) => invoke('payroll:calc-fed-wh', { employee_id, period_taxable, year, filing_status }),
  payrollSetSutaRate: (p: any) => invoke('payroll:set-suta-rate', p),
  payrollCalcSuta: (id: string, state_code: string) => invoke('payroll:calc-suta', { id, state_code }),
  payrollUpsertW4: (p: any) => invoke('payroll:upsert-w4', p),
  payrollSupplementalRate: (amount: number, rate?: number) => invoke('payroll:supplemental-rate', { amount, rate }),
  payrollCalcSdi: (id: string, state_code: string, rate: number, wage_cap: number) => invoke('payroll:calc-sdi', { id, state_code, rate, wage_cap }),
  payrollRunTaxLiability: (id: string) => invoke('payroll:run-tax-liability', { id }),
  payrollYtdWithholding: (employee_id: string, year: number) => invoke('payroll:ytd-withholding', { employee_id, year }),
  payrollRecalcAll: (id: string) => invoke('payroll:recalc-all', { id }),
  // Batch PC: Benefits & Deductions
  payrollBenefitCreate: (p: any) => invoke('payroll:benefit:create', p),
  payrollBenefitEnroll: (p: any) => invoke('payroll:benefit:enroll', p),
  payrollDeductionAdd: (p: any) => invoke('payroll:deduction:add', p),
  payrollDeductionApply: (id: string) => invoke('payroll:deduction:apply', { id }),
  payrollBenefitApply: (id: string) => invoke('payroll:benefit:apply', { id }),
  payrollRetirementSetup: (p: any) => invoke('payroll:retirement:setup', p),
  payrollRetirementCalc401k: (id: string) => invoke('payroll:retirement:calc-401k', { id }),
  payrollHsaFsaSetup: (p: any) => invoke('payroll:hsa-fsa:setup', p),
  payrollAdvanceCreate: (p: any) => invoke('payroll:advance:create', p),
  payrollAdvanceProcessRepayment: (advance_id: string, pay_run_item_id: string) => invoke('payroll:advance:process-repayment', { advance_id, pay_run_item_id }),
  // Batch PD: Garnishments
  payrollGarnCreate: (p: any) => invoke('payroll:garn:create', p),
  payrollCsCreate: (p: any) => invoke('payroll:cs:create', p),
  payrollGarnApply: (id: string) => invoke('payroll:garn:apply', { id }),
  payrollGarnActive: (employee_id: string) => invoke('payroll:garn:active', { employee_id }),
  payrollGarnSatisfy: (id: string, payoff_date?: string) => invoke('payroll:garn:satisfy', { id, payoff_date }),
  payrollCsRelease: (id: string, release_date?: string) => invoke('payroll:cs:release', { id, release_date }),
  payrollGarnRemittance: (year: number, payee_type?: string) => invoke('payroll:garn:remittance', { year, payee_type }),
  payrollCcpaMax: (id: string, supports_family: boolean, supports_child_only: boolean) => invoke('payroll:ccpa:max', { id, supports_family, supports_child_only }),
  payrollNewHireReport: (new_hires: { employee_id: string; start_date: string }[]) => invoke('payroll:new-hire:report', { new_hires }),
  payrollGarnFee: (id: string, fee: number) => invoke('payroll:garn:fee', { id, fee }),
  // Batch PE: Time-Off
  payrollTorCreateAccrual: (p: any) => invoke('payroll:tor:create-accrual', p),
  payrollTorAccrue: (employee_id: string, hours_worked?: number) => invoke('payroll:tor:accrue', { employee_id, hours_worked }),
  payrollTorRequest: (p: any) => invoke('payroll:tor:request', p),
  payrollTorDecide: (id: string, approve: boolean, approver_id?: string) => invoke('payroll:tor:decide', { id, approve, approver_id }),
  payrollTorBalances: (employee_id: string) => invoke('payroll:tor:balances', { employee_id }),
  payrollTorCarryover: (year: number) => invoke('payroll:tor:carryover', { year }),
  payrollTorCalendar: (range_start: string, range_end: string) => invoke('payroll:tor:calendar', { range_start, range_end }),
  payrollTorCashOut: (employee_id: string, hourly_rate: number) => invoke('payroll:tor:cash-out', { employee_id, hourly_rate }),
  payrollHolidayCreateRule: (p: any) => invoke('payroll:holiday:create-rule', p),
  payrollOtCreateRule: (p: any) => invoke('payroll:ot:create-rule', p),
  // Batch PF: Direct Deposit
  payrollDdAdd: (p: any) => invoke('payroll:dd:add', p),
  payrollDdAllocate: (employee_id: string, net_pay: number) => invoke('payroll:dd:allocate', { employee_id, net_pay }),
  payrollAchBuild: (pay_run_id: string) => invoke('payroll:ach:build', { pay_run_id }),
  payrollCheckCreateRun: (p: any) => invoke('payroll:check:create-run', p),
  payrollCheckMarkPrinted: (id: string) => invoke('payroll:check:mark-printed', { id }),
  payrollCheckVoid: (id: string, reason: string) => invoke('payroll:check:void', { id, reason }),
  payrollDdPrenote: (account_id: string) => invoke('payroll:dd:prenote', { account_id }),
  payrollDdUnverified: () => invoke('payroll:dd:unverified'),
  payrollPaycardLoad: (employee_id: string, amount: number) => invoke('payroll:paycard:load', { employee_id, amount }),
  payrollEmployeeUpdatePayMethod: (id: string, pay_method: string) => invoke('payroll:employee:update-pay-method', { id, pay_method }),
  // Batch PG: Contractors
  payrollContractorCreateRun: (p: any) => invoke('payroll:contractor:create-run', p),
  payrollContractorAddItem: (p: any) => invoke('payroll:contractor:add-item', p),
  payrollContractorPost: (id: string) => invoke('payroll:contractor:post', { id }),
  payrollContractorYtd: (year: number) => invoke('payroll:contractor:ytd', { year }),
  payroll1099FlagRequired: (year: number) => invoke('payroll:1099:flag-required', { year }),
  payroll1099Generate: (year: number) => invoke('payroll:1099:generate', { year }),
  payrollBackupWhApply: (vendor_id: string, amount: number) => invoke('payroll:backup-wh:apply', { vendor_id, amount }),
  payrollContractorHistory: (vendor_id: string, year?: number) => invoke('payroll:contractor:history', { vendor_id, year }),
  payroll1099UpdateWh: (id: string, federal: number, state?: any[]) => invoke('payroll:1099:update-wh', { id, federal, state }),
  payroll1099Transmitted: (id: string) => invoke('payroll:1099:transmitted', { id }),
  // Batch PH: Year-End
  payrollW2GenerateOne: (employee_id: string, year: number) => invoke('payroll:w2:generate-one', { employee_id, year }),
  payrollW2GenerateAll: (year: number) => invoke('payroll:w2:generate-all', { year }),
  payroll941Generate: (year: number, quarter: number) => invoke('payroll:941:generate', { year, quarter }),
  payroll941RecordDeposit: (p: { tax_year: number; quarter: number; amount: number; deposit_date?: string }) => invoke('payroll:941:record-deposit', p),
  payroll940Generate: (year: number) => invoke('payroll:940:generate', { year }),
  payrollYearEndSummary: (year: number) => invoke('payroll:year-end:summary', { year }),
  payrollW2MarkFiled: (id: string) => invoke('payroll:w2:mark-filed', { id }),
  payroll941MarkFiled: (id: string) => invoke('payroll:941:mark-filed', { id }),
  payroll940MarkFiled: (id: string) => invoke('payroll:940:mark-filed', { id }),
  payrollFilingsStatus: (year: number) => invoke('payroll:filings:status', { year }),
  payrollW2AddBox12: (id: string, code: string, amount: number) => invoke('payroll:w2:add-box12', { id, code, amount }),
  // Batch PI: Multi-State
  payrollMultiStateSet: (p: any) => invoke('payroll:multi-state:set', p),
  payrollMultiStateCalc: (id: string) => invoke('payroll:multi-state:calc', { id }),
  payrollReciprocityApply: (employee_id: string, work_state: string) => invoke('payroll:reciprocity:apply', { employee_id, work_state }),
  payrollMultiStateQuarterly: (year: number, quarter: number) => invoke('payroll:multi-state:quarterly', { year, quarter }),
  payrollStateQCreate: (p: any) => invoke('payroll:state-q:create', p),
  payrollStateQMarkFiled: (id: string) => invoke('payroll:state-q:mark-filed', { id }),
  payrollNexusList: () => invoke('payroll:nexus:list'),
  payrollMultiStateEnd: (id: string, end_date?: string) => invoke('payroll:multi-state:end', { id, end_date }),
  payrollLocalWhCalc: (id: string, locality: string, rate: number) => invoke('payroll:local-wh:calc', { id, locality, rate }),
  payrollSuiReview: () => invoke('payroll:sui:review'),
  // Batch PJ: Workers Comp & ACA
  payrollWcAddClass: (p: any) => invoke('payroll:wc:add-class', p),
  payrollWcAssign: (p: any) => invoke('payroll:wc:assign', p),
  payrollWcCalcPremium: (id: string) => invoke('payroll:wc:calc-premium', { id }),
  payrollWcSummary: (range_start: string, range_end: string) => invoke('payroll:wc:summary', { range_start, range_end }),
  payrollAcaRecord: (p: any) => invoke('payroll:aca:record', p),
  payrollAcaReadiness: (year: number) => invoke('payroll:aca:readiness', { year }),
  payrollCobraRecord: (p: any) => invoke('payroll:cobra:record', p),
  payrollLifeEventRecord: (p: any) => invoke('payroll:life-event:record', p),
  payrollCompChangeRecord: (p: any) => invoke('payroll:comp-change:record', p),
  payrollDashboardSummary: (year: number) => invoke('payroll:dashboard:summary', { year }),

  // ─── Reporting & Dashboards Wave (F741-F840) ────────────────────
  // Batch RA: Custom Report Builder
  rptDefCreate: (p: any) => invoke('rpt:def:create', p),
  rptDefList: (f?: any) => invoke('rpt:def:list', f || {}),
  rptDefUpdate: (id: string, patch: any) => invoke('rpt:def:update', { id, patch }),
  rptDefDelete: (id: string) => invoke('rpt:def:delete', { id }),
  rptRun: (report_id: string, params?: any) => invoke('rpt:run', { report_id, params }),
  rptRunRows: (run_id: string, offset?: number, limit?: number) => invoke('rpt:run:rows', { run_id, offset, limit }),
  rptRunList: (report_id: string, limit?: number) => invoke('rpt:run:list', { report_id, limit }),
  rptDefClone: (source_id: string, new_name: string) => invoke('rpt:def:clone', { source_id, new_name }),
  rptSqlValidate: (sql_template: string, params?: any) => invoke('rpt:sql:validate', { sql_template, params }),
  rptSourceColumns: (source_table: string) => invoke('rpt:source:columns', { source_table }),
  // Batch RB: Saved Views
  rptViewSave: (p: any) => invoke('rpt:view:save', p),
  rptViewList: (report_id: string, user_id?: string) => invoke('rpt:view:list', { report_id, user_id }),
  rptViewUpdate: (id: string, patch: any) => invoke('rpt:view:update', { id, patch }),
  rptViewDelete: (id: string) => invoke('rpt:view:delete', { id }),
  rptViewSetDefault: (id: string) => invoke('rpt:view:set-default', { id }),
  rptViewRun: (id: string) => invoke('rpt:view:run', { id }),
  rptNarrativeCreate: (p: any) => invoke('rpt:narrative:create', p),
  rptNarrativeList: (type?: string) => invoke('rpt:narrative:list', { type }),
  rptNarrativeRender: (id: string, vars: any) => invoke('rpt:narrative:render', { id, vars }),
  rptViewShare: (id: string, visibility: 'team' | 'company') => invoke('rpt:view:share', { id, visibility }),
  // Batch RC: Scheduled Reports
  rptSchedCreate: (p: any) => invoke('rpt:sched:create', p),
  rptSchedList: (f?: any) => invoke('rpt:sched:list', f || {}),
  rptSchedRunNow: (id: string) => invoke('rpt:sched:run-now', { id }),
  rptSchedPause: (id: string, active: boolean) => invoke('rpt:sched:pause', { id, active }),
  rptSchedUpdateCadence: (id: string, cron?: string, preset?: string, next_run_at?: string) => invoke('rpt:sched:update-cadence', { id, cron, preset, next_run_at }),
  rptSchedHistory: (id: string, limit?: number) => invoke('rpt:sched:history', { id, limit }),
  rptSchedComputeNext: (preset: string, from_date?: string) => invoke('rpt:sched:compute-next', { preset, from_date }),
  rptSchedAddRecipients: (id: string, recipients: string[]) => invoke('rpt:sched:add-recipients', { id, recipients }),
  rptSchedRemoveRecipients: (id: string, recipients: string[]) => invoke('rpt:sched:remove-recipients', { id, recipients }),
  rptSchedDelete: (id: string) => invoke('rpt:sched:delete', { id }),
  // Batch RD: KPI Widgets
  rptKpiCreate: (p: any) => invoke('rpt:kpi:create', p),
  rptKpiSnapshot: (p: { key: string; value: number; period_start?: string; period_end?: string; inputs?: any }) => invoke('rpt:kpi:snapshot', p),
  rptKpiCurrent: (key: string) => invoke('rpt:kpi:current', { key }),
  rptKpiSeries: (key: string, opts?: { from?: string; to?: string; limit?: number }) => invoke('rpt:kpi:series', { key, opts }),
  rptKpiDelta: (key: string, days?: number) => invoke('rpt:kpi:delta', { key, days }),
  rptKpiRecalcBuiltin: () => invoke('rpt:kpi:recalc-builtin'),
  rptKpiSetTarget: (key: string, target: number) => invoke('rpt:kpi:set-target', { key, target }),
  rptKpiRollup: () => invoke('rpt:kpi:rollup'),
  rptKpiDelete: (key: string) => invoke('rpt:kpi:delete', { key }),
  rptKpiPrune: (days: number) => invoke('rpt:kpi:prune', { days }),
  // Batch RE: Drill-down & Filters
  rptDrillRecord: (p: any) => invoke('rpt:drill:record', p),
  rptDrillInto: (table: string, id: string) => invoke('rpt:drill:into', { table, id }),
  rptRowsFilter: (rows: any[], filters: any[]) => invoke('rpt:rows:filter', { rows, filters }),
  rptRowsGroup: (rows: any[], group_by: string) => invoke('rpt:rows:group', { rows, group_by }),
  rptRowsSort: (rows: any[], sort_by: string, direction?: 'asc' | 'desc') => invoke('rpt:rows:sort', { rows, sort_by, direction }),
  rptRowsAggregate: (rows: any[], column: string, op: 'sum' | 'avg' | 'min' | 'max' | 'count') => invoke('rpt:rows:aggregate', { rows, column, op }),
  rptDrillUserHistory: (user_id: string, limit?: number) => invoke('rpt:drill:user-history', { user_id, limit }),
  rptDrillTopEntities: (table: string, days?: number) => invoke('rpt:drill:top-entities', { table, days }),
  rptColMetaSet: (p: any) => invoke('rpt:col-meta:set', p),
  rptFilterPresets: () => invoke('rpt:filter:presets'),
  // Batch RF: Financial Statements
  rptPl: (start: string, end: string) => invoke('rpt:pl', { start, end }),
  rptBs: (as_of: string) => invoke('rpt:bs', { as_of }),
  rptCf: (start: string, end: string) => invoke('rpt:cf', { start, end }),
  rptTb: (as_of: string) => invoke('rpt:tb', { as_of }),
  rptArAging: () => invoke('rpt:ar-aging'),
  rptApAging: () => invoke('rpt:ap-aging'),
  rptCashPosition: () => invoke('rpt:cash-position'),
  rptProfitMarginTrend: (months?: number) => invoke('rpt:profit-margin-trend', { months }),
  rptWorkingCapital: () => invoke('rpt:working-capital'),
  rptGlDetail: (account_id: string, start: string, end: string) => invoke('rpt:gl-detail', { account_id, start, end }),
  // Batch RG: Variance
  rptVarianceActualVsBudget: (start: string, end: string) => invoke('rpt:variance:actual-vs-budget', { start, end }),
  rptVariancePop: (start_a: string, end_a: string, start_b: string, end_b: string) => invoke('rpt:variance:pop', { start_a, end_a, start_b, end_b }),
  rptVarianceYoy: (year: number) => invoke('rpt:variance:yoy', { year }),
  rptVarianceQoq: (year: number, quarter: number) => invoke('rpt:variance:qoq', { year, quarter }),
  rptVarianceCohort: (start: string, end: string) => invoke('rpt:variance:cohort', { start, end }),
  rptTopContributors: (metric: 'revenue' | 'expense' | 'invoices', start: string, end: string, limit?: number) => invoke('rpt:top:contributors', { metric, start, end, limit }),
  rptPeriodCompSave: (p: any) => invoke('rpt:period-comp:save', p),
  rptVarianceList: (limit?: number) => invoke('rpt:variance:list', { limit }),
  rptVarianceOverBudget: (threshold_pct: number, start: string, end: string) => invoke('rpt:variance:over-budget', { threshold_pct, start, end }),
  rptMonthlySummaryCard: (month?: string) => invoke('rpt:monthly-summary-card', { month }),
  // Batch RH: Dashboards
  rptDashCreate: (p: any) => invoke('rpt:dash:create', p),
  rptDashAddWidget: (p: any) => invoke('rpt:dash:add-widget', p),
  rptDashMoveWidget: (id: string, x: number, y: number, width?: number, height?: number) => invoke('rpt:dash:move-widget', { id, x, y, width, height }),
  rptDashLoad: (id: string) => invoke('rpt:dash:load', { id }),
  rptDashList: (user_id?: string) => invoke('rpt:dash:list', { user_id }),
  rptDashDelete: (id: string) => invoke('rpt:dash:delete', { id }),
  rptDashSaveVersion: (id: string, saved_by?: string, note?: string) => invoke('rpt:dash:save-version', { id, saved_by, note }),
  rptDashRestoreVersion: (id: string) => invoke('rpt:dash:restore-version', { id }),
  rptDashShare: (p: any) => invoke('rpt:dash:share', p),
  rptDashRemoveWidget: (id: string) => invoke('rpt:dash:remove-widget', { id }),
  // Batch RI: Executive Summary & Annotations
  rptExecGenerate: (start: string, end: string) => invoke('rpt:exec:generate', { start, end }),
  rptExecUpdate: (id: string, patch: any) => invoke('rpt:exec:update', { id, patch }),
  rptExecList: (limit?: number) => invoke('rpt:exec:list', { limit }),
  rptExecGet: (id: string) => invoke('rpt:exec:get', { id }),
  rptExecAutoMonthly: (month?: string) => invoke('rpt:exec:auto-monthly', { month }),
  rptAnnotAdd: (p: any) => invoke('rpt:annot:add', p),
  rptAnnotList: (p: { report_run_id?: string; widget_id?: string; dashboard_id?: string }) => invoke('rpt:annot:list', p),
  rptAnnotDelete: (id: string) => invoke('rpt:annot:delete', { id }),
  rptAlertCreate: (p: any) => invoke('rpt:alert:create', p),
  rptAlertEvaluate: () => invoke('rpt:alert:evaluate'),
  // Batch RJ: Export & Sharing
  rptExportCsv: (run_id: string) => invoke('rpt:export:csv', { run_id }),
  rptExportHtml: (run_id: string, title?: string) => invoke('rpt:export:html', { run_id, title }),
  rptPinSet: (key: string, value: any, ttl?: number) => invoke('rpt:pin:set', { key, value, ttl }),
  rptPinGet: (key: string) => invoke('rpt:pin:get', { key }),
  rptFavPin: (p: any) => invoke('rpt:fav:pin', p),
  rptFavList: (user_id: string) => invoke('rpt:fav:list', { user_id }),
  rptSubCreate: (p: any) => invoke('rpt:sub:create', p),
  rptAuditLog: (p: { user_id?: string; action: string; entity_type: string; entity_id: string; metadata?: any }) => invoke('rpt:audit:log', p),
  rptAuditGet: (f?: { user_id?: string; action?: string; limit?: number }) => invoke('rpt:audit:get', f || {}),
  rptPerfCard: (report_id: string) => invoke('rpt:perf-card', { report_id }),

  // ─── Itemization Wave (F841-F862) ────────────────────────────────
  izTplSave: (p: { name: string; description?: string; lines: any[]; owner_user_id?: string; visibility?: 'private' | 'team' | 'company' }) => invoke('iz:tpl:save', p),
  izTplList: (user_id?: string) => invoke('iz:tpl:list', { user_id }),
  izTplLoad: (id: string) => invoke('iz:tpl:load', { id }),
  izTplDelete: (id: string) => invoke('iz:tpl:delete', { id }),
  izTplUpdate: (id: string, patch: { name?: string; description?: string; visibility?: string }) => invoke('iz:tpl:update', { id, patch }),
  izTplShare: (id: string, visibility: 'team' | 'company') => invoke('iz:tpl:share', { id, visibility }),
  izBulkParse: (text: string) => invoke('iz:bulk:parse', { text }),
  izSplitEvenly: (total: number, count: number, base_description?: string) => invoke('iz:split-evenly', { total, count, base_description }),
  izLineDuplicate: (line: any) => invoke('iz:line:duplicate', { line }),
  izAutocompleteDescriptions: (opts?: { limit?: number; days_back?: number }) => invoke('iz:autocomplete:descriptions', opts || {}),
  izAutocompleteInventory: (query: string, limit?: number) => invoke('iz:autocomplete:inventory', { query, limit }),
  izTaxBreakdown: (lines: any[]) => invoke('iz:tax-breakdown', { lines }),
  izLineEffective: (line: any) => invoke('iz:line:effective', { line }),
  izContributions: (lines: any[]) => invoke('iz:contributions', { lines }),
  izBulkApplyTax: (lines: any[], rate: number) => invoke('iz:bulk:apply-tax', { lines, rate }),
  izBulkTaxExempt: (lines: any[], exempt: boolean) => invoke('iz:bulk:tax-exempt', { lines, exempt }),
  izReorder: (lines: any[], from: number, to: number) => invoke('iz:reorder', { lines, from, to }),
  izValidate: (lines: any[]) => invoke('iz:validate', { lines }),
  izRollupCategory: (lines: any[], names: Record<string, string>) => invoke('iz:rollup:category', { lines, names }),
  izRollupProject: (lines: any[], names: Record<string, string>) => invoke('iz:rollup:project', { lines, names }),
  izTplTop: (limit?: number) => invoke('iz:tpl:top', { limit }),
  izSummary: (lines: any[]) => invoke('iz:summary', { lines }),

  // ─── Expense Upgrades Wave (F863-F892) ──────────────────────────
  // Batch EA: Bulk Operations
  euBulkApproval: (p: { expense_ids: string[]; status: 'approved' | 'rejected' | 'pending'; comment?: string; actor_user_id?: string }) => invoke('eu:bulk:approval', p),
  euBulkRecategorize: (expense_ids: string[], category_id: string) => invoke('eu:bulk:recategorize', { expense_ids, category_id }),
  euBulkAssignProject: (expense_ids: string[], project_id: string | null) => invoke('eu:bulk:assign-project', { expense_ids, project_id }),
  euBulkReimbursed: (expense_ids: string[], reimbursed: boolean, date?: string) => invoke('eu:bulk:reimbursed', { expense_ids, reimbursed, date }),
  euBulkTag: (expense_ids: string[], add: string[], remove?: string[]) => invoke('eu:bulk:tag', { expense_ids, add, remove: remove || [] }),
  euBulkDelete: (expense_ids: string[]) => invoke('eu:bulk:delete', { expense_ids }),
  // Batch EB: Search & Smart Filters
  euFilterSave: (p: { name: string; filter: any; user_id?: string }) => invoke('eu:filter:save', p),
  euFilterList: (user_id?: string) => invoke('eu:filter:list', { user_id }),
  euFilterPresets: () => invoke('eu:filter:presets'),
  euVendorQuickfind: (query: string, limit?: number) => invoke('eu:vendor:quickfind', { query, limit }),
  euFilterByAmount: (p: { op: '>' | '<' | '=' | '>=' | '<=' | 'between'; value: number; value2?: number; limit?: number }) => invoke('eu:filter:by-amount', p),
  euFilterByAttachment: (has_receipt: boolean, limit?: number) => invoke('eu:filter:by-attachment', { has_receipt, limit }),
  // Batch EC: Hygiene & Duplicates
  euDupesScan: (opts?: { date_window_days?: number; amount_tolerance_cents?: number; min_confidence?: number }) => invoke('eu:dupes:scan', opts || {}),
  euReceiptsMissing: (days?: number) => invoke('eu:receipts:missing', { days }),
  euDupesResolve: (match_id: string, resolution: 'kept' | 'merged' | 'not_duplicate') => invoke('eu:dupes:resolve', { match_id, resolution }),
  euHygieneCompute: (expense_id: string) => invoke('eu:hygiene:compute', { expense_id }),
  euHygieneReport: (opts?: { limit?: number; recompute?: boolean }) => invoke('eu:hygiene:report', opts || {}),
  // Batch ED: Approval Workflow
  euApprovalCreateRule: (p: any) => invoke('eu:approval:create-rule', p),
  euApprovalRoute: (expense_id: string) => invoke('eu:approval:route', { expense_id }),
  euApprovalDelegate: (p: { delegator_user_id: string; delegate_user_id: string; starts_at: string; ends_at: string; reason?: string }) => invoke('eu:approval:delegate', p),
  euApprovalHistory: (expense_id: string) => invoke('eu:approval:history', { expense_id }),
  euApprovalSla: (days?: number) => invoke('eu:approval:sla', { days }),
  // Batch EE: Insights
  euInsightsTopVendors: (opts?: { since?: string; until?: string; limit?: number }) => invoke('eu:insights:top-vendors', opts || {}),
  euInsightsCategoryRollup: (opts?: { since?: string; until?: string }) => invoke('eu:insights:category-rollup', opts || {}),
  euInsightsAnomalies: (threshold?: number) => invoke('eu:insights:anomalies', { threshold }),
  euInsightsMonthlyTrend: (months_back?: number) => invoke('eu:insights:monthly-trend', { months_back }),
  euInsightsBurnDown: (month?: string) => invoke('eu:insights:burn-down', { month }),
  // Batch EF: UX Power
  euRecurringDetect: () => invoke('eu:recurring:detect'),
  euDraftSave: (p: { user_id?: string; draft: any }) => invoke('eu:draft:save', p),
  euDraftGet: (user_id?: string) => invoke('eu:draft:get', { user_id }),
  euDraftClear: (user_id?: string) => invoke('eu:draft:clear', { user_id }),

  // ─── Invoice Upgrades Wave (F893-F922) ──────────────────────────
  // Batch IA: Builder UX
  iuTplSave: (p: { name: string; description?: string; lines: any[]; owner_user_id?: string; visibility?: 'private' | 'team' | 'company' }) => invoke('iu:tpl:save', p),
  iuTplList: (user_id?: string) => invoke('iu:tpl:list', { user_id }),
  iuTplLoad: (id: string) => invoke('iu:tpl:load', { id }),
  iuTimePull: (project_id: string, opts?: { rate?: number; merge_by?: 'employee' | 'task' | 'date' | 'none' }) => invoke('iu:time:pull', { project_id, ...(opts || {}) }),
  iuBulkParse: (text: string) => invoke('iu:bulk:parse', { text }),
  // Batch IB: Smart Inference
  iuSmartDueDate: (client_id: string, opts?: { fallback_days?: number; issue_date?: string }) => invoke('iu:smart:due-date', { client_id, ...(opts || {}) }),
  iuFxPreview: (amount: number, from: string, to: string) => invoke('iu:fx:preview', { amount, from, to }),
  iuCreditApply: (p: { invoice_id: string; credit_amount: number; credit_source?: string }) => invoke('iu:credit:apply', p),
  iuProgressPct: (invoice_id: string) => invoke('iu:progress:pct', { invoice_id }),
  iuLateFeePreview: (invoice_id: string) => invoke('iu:late-fee:preview', { invoice_id }),
  // Batch IC: Client Engagement
  iuViewLog: (p: { invoice_id: string; event_type: 'viewed' | 'downloaded' | 'paid_link_clicked'; metadata?: any }) => invoke('iu:view:log', p),
  iuViewHistory: (invoice_id: string) => invoke('iu:view:history', { invoice_id }),
  iuEmailTplSave: (p: { name: string; state?: string; client_id?: string; subject_template: string; body_template: string; is_default?: boolean }) => invoke('iu:email-tpl:save', p),
  iuEmailTplResolve: (p: { invoice_id: string; state?: string }) => invoke('iu:email-tpl:resolve', p),
  iuEmailThankYou: (invoice_id: string) => invoke('iu:email:thank-you', { invoice_id }),
  // Batch ID: Workflow
  iuApprovalCreateRule: (p: any) => invoke('iu:approval:create-rule', p),
  iuApprovalRoute: (invoice_id: string) => invoke('iu:approval:route', { invoice_id }),
  iuPaymentSuggest: (p: { bank_transaction_id?: string; amount: number; memo?: string; date?: string; client_id?: string }) => invoke('iu:payment:suggest', p),
  iuCreditMemoIssue: (p: { invoice_id: string; amount: number; reason?: string; apply_to_invoice_id?: string }) => invoke('iu:credit-memo:issue', p),
  iuWriteoff: (invoice_id: string, reason: string, actor_user_id?: string) => invoke('iu:writeoff', { invoice_id, reason, actor_user_id }),
  // Batch IE: Analytics
  iuDso: (opts?: { client_id?: string; period_days?: number; cache?: boolean }) => invoke('iu:dso', opts || {}),
  iuTopClients: (opts?: { since?: string; until?: string; limit?: number }) => invoke('iu:top-clients', opts || {}),
  iuAging: (client_id?: string) => invoke('iu:aging', { client_id }),
  iuCashflowProjection: (days_ahead?: number) => invoke('iu:cashflow:projection', { days_ahead }),
  iuCollectionScore: (invoice_id: string) => invoke('iu:collection:score', { invoice_id }),
  // Batch IF: Bulk Ops
  iuBulkRemind: (invoice_ids: string[], opts?: { cadence?: string; actor_user_id?: string }) => invoke('iu:bulk:remind', { invoice_ids, ...(opts || {}) }),
  iuBulkApplyPayment: (p: { client_id: string; payment_amount: number; payment_date?: string; payment_method?: string }) => invoke('iu:bulk:apply-payment', p),
  iuBulkVoid: (invoice_ids: string[], reason: string, actor_user_id?: string) => invoke('iu:bulk:void', { invoice_ids, reason, actor_user_id }),
  iuBulkMarkSent: (invoice_ids: string[], sent_by?: string) => invoke('iu:bulk:mark-sent', { invoice_ids, sent_by }),
  iuBulkExportManifest: (invoice_ids: string[]) => invoke('iu:bulk:export-manifest', { invoice_ids }),

  // ─── Invoice Wave II (F923-F962) ────────────────────────────────
  // Batch IG: Recurring & Subscriptions
  iwRecurringRun: () => invoke('iw:recurring:run'),
  iwMetricsMrr: () => invoke('iw:metrics:mrr'),
  iwProration: (p: { current_amount: number; new_amount: number; cycle_days_remaining: number; total_cycle_days: number }) => invoke('iw:proration', p),
  iwTrialsExpiring: (days_ahead?: number) => invoke('iw:trials:expiring', { days_ahead }),
  iwSubAutoRenew: (subscription_id: string, auto_renew: boolean) => invoke('iw:sub:auto-renew', { subscription_id, auto_renew }),
  // Batch IH: PDF & Brand
  iwBrandUpsert: (p: any) => invoke('iw:brand:upsert', p),
  iwBrandList: () => invoke('iw:brand:list'),
  iwBrandDefault: () => invoke('iw:brand:default'),
  iwWatermark: (invoice_id: string) => invoke('iw:watermark', { invoice_id }),
  iwPreviewHtml: (invoice_id: string, brand_profile_id?: string) => invoke('iw:preview-html', { invoice_id, brand_profile_id }),
  // Batch II: Quote-to-Invoice
  iwQuoteConvert: (p: { quote_id: string; line_ids?: string[]; due_in_days?: number }) => invoke('iw:quote:convert', p),
  iwQuoteFunnel: (opts?: { since?: string; until?: string }) => invoke('iw:quote:funnel', opts || {}),
  iwQuoteAutoConvert: () => invoke('iw:quote:auto-convert'),
  iwQuoteRevisions: (quote_id: string) => invoke('iw:quote:revisions', { quote_id }),
  iwQuoteExpired: () => invoke('iw:quote:expired'),
  // Batch IJ: Discounts & Promotions
  iwCouponUpsert: (p: any) => invoke('iw:coupon:upsert', p),
  iwCouponValidate: (code: string, opts?: { invoice_id?: string; amount?: number; client_id?: string }) => invoke('iw:coupon:validate', { code, opts: opts || {} }),
  iwCouponRedeem: (p: { coupon_id: string; invoice_id: string; discount_applied: number }) => invoke('iw:coupon:redeem', p),
  iwCouponReport: () => invoke('iw:coupon:report'),
  iwVolumeDiscount: (quantity: number, tiers: Array<{ min_qty: number; discount_pct: number }>) => invoke('iw:volume-discount', { quantity, tiers }),
  // Batch IK: Payment Processing
  iwPaymentIntentCreate: (p: { invoice_id: string; provider: string; amount: number; currency?: string; payment_method_type?: string; external_intent_id?: string }) => invoke('iw:payment-intent:create', p),
  iwQrPayload: (invoice_id: string, base_url?: string) => invoke('iw:qr:payload', { invoice_id, base_url }),
  iwBankTransferInstructions: (invoice_id: string) => invoke('iw:bank-transfer:instructions', { invoice_id }),
  iwPaymentMethodRanking: () => invoke('iw:payment:method-ranking'),
  iwPaymentRetryQueue: () => invoke('iw:payment:retry-queue'),
  // Batch IL: International
  iwI18nLabels: (lang: string) => invoke('iw:i18n:labels', { lang }),
  iwVatValidate: (country: string, vat_number: string) => invoke('iw:vat:validate', { country, vat_number }),
  iwReverseCharge: (p: { supplier_country: string; customer_country: string; customer_vat?: string; b2b: boolean }) => invoke('iw:reverse-charge', p),
  iwTaxCountryRules: (country: string) => invoke('iw:tax:country-rules', { country }),
  iwFxExposure: () => invoke('iw:fx:exposure'),
  // Batch IM: Workflow
  iwWorkflowCreate: (p: any) => invoke('iw:workflow:create', p),
  iwWorkflowEvaluate: (p: { trigger_event: string; invoice_id: string }) => invoke('iw:workflow:evaluate', p),
  iwPredictPaymentDate: (invoice_id: string) => invoke('iw:predict:payment-date', { invoice_id }),
  iwSuggestClassification: (client_id: string) => invoke('iw:suggest:classification', { client_id }),
  iwApprovalRequired: (invoice_id: string) => invoke('iw:approval:required', { invoice_id }),
  // Batch IN: Client Portal & Reporting
  iwPortalToken: (p: { client_id: string; invoice_id?: string; scope?: string; valid_days?: number }) => invoke('iw:portal:token', p),
  iwStatement: (p: { client_id: string; since: string; until?: string }) => invoke('iw:statement', p),
  iwForecastRevenue: (weeks_ahead?: number) => invoke('iw:forecast:revenue', { weeks_ahead }),
  iwLtv: (client_id: string) => invoke('iw:ltv', { client_id }),
  iwChurnPredict: (client_id: string) => invoke('iw:churn:predict', { client_id }),

  // ─── Loan Wave (F963-F992) ─────────────────────────────────────
  // Batch LA: Refinance & Modifications
  laRefiCompare: (p: { loan_id: string; new_rate: number; new_term_months: number; closing_costs?: number; cashout_amount?: number }) => invoke('la:refi:compare', p),
  laRefiExecute: (p: { loan_id: string; new_rate: number; new_term_months: number; closing_costs?: number; cashout_amount?: number; new_lender_name?: string; effective_date?: string }) => invoke('la:refi:execute', p),
  laModApply: (p: { loan_id: string; modification_type: 'rate_reduction' | 'term_extension' | 'forbearance' | 'principal_reduction'; new_rate?: number; new_term_months?: number; forbearance_months?: number; principal_reduction_amount?: number; effective_date?: string; reason: string }) => invoke('la:mod:apply', p),
  laLumpPrincipal: (p: { loan_id: string; amount: number; payment_date?: string; notes?: string }) => invoke('la:lump-principal', p),
  laBiweeklyImpact: (loan_id: string) => invoke('la:biweekly:impact', { loan_id }),
  // Batch LB: Collateral & Documents
  laCollateralAttach: (p: { loan_id: string; collateral_type: string; asset_id?: string; description?: string; original_value?: number; current_value?: number; is_primary?: boolean; cross_collateralized?: boolean }) => invoke('la:collateral:attach', p),
  laDocAttach: (p: { loan_id: string; document_type: string; name: string; file_path?: string; expires_at?: string; uploaded_by?: string }) => invoke('la:doc:attach', p),
  laCollateralRevalue: (id: string, new_value: number, appraisal_date?: string) => invoke('la:collateral:revalue', { id, new_value, appraisal_date }),
  laLtv: (loan_id: string) => invoke('la:ltv', { loan_id }),
  laLoansByAsset: (asset_id: string) => invoke('la:loans-by-asset', { asset_id }),
  // Batch LC: Covenants
  laCovenantCreate: (p: { loan_id?: string; covenant_name: string; metric: 'dscr' | 'current_ratio' | 'debt_to_equity' | 'quick_ratio' | 'interest_coverage'; operator: '>=' | '<=' | '='; threshold_value: number; measurement_frequency?: 'monthly' | 'quarterly' | 'annual'; notes?: string }) => invoke('la:covenant:create', p),
  laCovenantMeasure: (id: string) => invoke('la:covenant:measure', { id }),
  laCovenantBreaches: () => invoke('la:covenant:breaches'),
  laComplianceCertificate: (opts?: { quarter?: number; year?: number }) => invoke('la:compliance:certificate', opts || {}),
  laCovenantUpcoming: (days_ahead?: number) => invoke('la:covenant:upcoming', { days_ahead }),
  // Batch LD: ARM
  laArmSchedule: (p: { loan_id: string; reset_date: string; index_name?: string; index_value?: number; margin?: number; new_rate?: number; periodic_cap?: number; lifetime_cap?: number; notes?: string }) => invoke('la:arm:schedule', p),
  laArmUpcoming: (days_ahead?: number) => invoke('la:arm:upcoming', { days_ahead }),
  laArmApply: (id: string) => invoke('la:arm:apply', { id }),
  laRecast: (loan_id: string) => invoke('la:recast', { loan_id }),
  laStressRateShock: (loan_id: string, shock_pct: number) => invoke('la:stress:rate-shock', { loan_id, shock_pct }),
  // Batch LE: Escrow & PMI
  laEscrowRecord: (p: { loan_id: string; transaction_date: string; transaction_type: 'deposit' | 'disbursement'; amount: number; category?: string; payee?: string; reference?: string; notes?: string }) => invoke('la:escrow:record', p),
  laEscrowAnalysis: (loan_id: string, year?: number) => invoke('la:escrow:analysis', { loan_id, year }),
  laPmiSetup: (p: { loan_id: string; monthly_premium: number; starts_at?: string; auto_cancel_at_ltv?: number; request_cancellation_at_ltv?: number }) => invoke('la:pmi:setup', p),
  laPmiCheckCancel: (loan_id: string) => invoke('la:pmi:check-cancel', { loan_id }),
  laInsuranceLink: (collateral_id: string, policy_id: string) => invoke('la:insurance:link', { collateral_id, policy_id }),
  // Batch LF: Tax & Portfolio
  la1098Generate: (loan_id: string, tax_year: number) => invoke('la:1098:generate', { loan_id, tax_year }),
  laDeductibleInterest: (loan_id: string, tax_year: number, business_use_pct: number) => invoke('la:deductible-interest', { loan_id, tax_year, business_use_pct }),
  laDscr: () => invoke('la:dscr'),
  laDebtToEquity: () => invoke('la:debt-to-equity'),
  laPortfolioDashboard: () => invoke('la:portfolio:dashboard'),

  // ─── Loan Full-System Wave (F993-F1052) ────────────────────────
  // LG: type-specific
  lfIdrCalc: (p: { plan: 'PAYE' | 'REPAYE' | 'IBR_new' | 'IBR_old' | 'ICR'; agi: number; family_size: number; state?: string }) => invoke('lf:idr:calc', p),
  lfPslfTrack: (p: { loan_id: string; payment_date: string; qualifies: boolean; reason?: string }) => invoke('lf:pslf:track', p),
  lfHelocPhaseCalc: (p: any) => invoke('lf:heloc:phase-calc', p),
  lfConstructionProject: (p: any) => invoke('lf:construction:project', p),
  lfReverseOptions: (p: any) => invoke('lf:reverse:options', p),
  lfCcPayoff: (p: any) => invoke('lf:cc:payoff', p),
  lfLeaseVsBuy: (p: any) => invoke('lf:lease-vs-buy', p),
  lfAutoAfford: (p: any) => invoke('lf:auto:afford', p),
  lfSbaEligible: (p: any) => invoke('lf:sba:eligible', p),
  lfMarginCall: (p: any) => invoke('lf:margin:call', p),
  // LH: math
  lfPv: (p: { future_value: number; rate_pct: number; periods: number }) => invoke('lf:pv', p),
  lfFv: (p: { present_value: number; rate_pct: number; periods: number }) => invoke('lf:fv', p),
  lfNpv: (cash_flows: number[], discount_rate_pct: number) => invoke('lf:npv', { cash_flows, discount_rate_pct }),
  lfIrr: (cash_flows: number[], max_iter?: number, tolerance?: number) => invoke('lf:irr', { cash_flows, max_iter, tolerance }),
  lfAprToApy: (apr_pct: number, compounds?: number) => invoke('lf:apr-to-apy', { apr_pct, compounds }),
  lfApyToApr: (apy_pct: number, compounds?: number) => invoke('lf:apy-to-apr', { apy_pct, compounds }),
  lfAprWithFees: (p: any) => invoke('lf:apr-with-fees', p),
  lfYieldMaintenance: (p: any) => invoke('lf:yield-maintenance', p),
  lfDefeasance: (p: any) => invoke('lf:defeasance', p),
  lfDuration: (p: any) => invoke('lf:duration', p),
  lfCecl: (p: any) => invoke('lf:cecl', p),
  lfTaxEquivYield: (p: any) => invoke('lf:tax-equiv-yield', p),
  // LI: applications & origination
  lfAppCreate: (p: any) => invoke('lf:app:create', p),
  lfPrequal: (p: any) => invoke('lf:prequal', p),
  lf1003: (borrower_id: string, application_id: string) => invoke('lf:1003', { borrower_id, application_id }),
  lfUnderwritingChecklist: (application_id: string) => invoke('lf:underwriting:checklist', { application_id }),
  lfLoanEstimate: (application_id: string) => invoke('lf:loan-estimate', { application_id }),
  lfCdGenerate: (loan_id: string) => invoke('lf:cd:generate', { loan_id }),
  lfTilGenerate: (loan_id: string) => invoke('lf:til:generate', { loan_id }),
  lfPromissoryCreate: (p: any) => invoke('lf:promissory:create', p),
  lfCommitteePackage: (application_id: string) => invoke('lf:committee:package', { application_id }),
  lfBorrowerUpsert: (p: any) => invoke('lf:borrower:upsert', p),
  // LJ: risk & compliance
  lfCreditUpdate: (borrower_id: string, score: number, source?: string) => invoke('lf:credit:update', { borrower_id, score, source }),
  lfDti: (borrower_id: string, additional_monthly_payment?: number) => invoke('lf:dti', { borrower_id, additional_monthly_payment }),
  lfReservePortfolio: (opts?: any) => invoke('lf:reserve:portfolio', opts || {}),
  lfDscrWeighted: () => invoke('lf:dscr:weighted'),
  lfHmda: (application_id: string) => invoke('lf:hmda', { application_id }),
  lfFairLending: () => invoke('lf:fair-lending'),
  lfRiskGradeAssign: (p: any) => invoke('lf:risk-grade:assign', p),
  lfWatchlist: () => invoke('lf:watchlist'),
  lfChargeOff: (p: any) => invoke('lf:charge-off', p),
  lfRecovery: (p: any) => invoke('lf:recovery', p),
  // LK: specialized
  lfHelocDraw: (p: any) => invoke('lf:heloc:draw', p),
  lfHelocToRepayment: (p: any) => invoke('lf:heloc:to-repayment', p),
  lfConstructionDraw: (p: any) => invoke('lf:construction:draw', p),
  lfBridgeCalc: (p: any) => invoke('lf:bridge:calc', p),
  lfLeaseClassify: (p: any) => invoke('lf:lease:classify', p),
  lfSaleLeaseback: (p: any) => invoke('lf:sale-leaseback', p),
  lfFactoring: (p: any) => invoke('lf:factoring', p),
  lfMca: (p: any) => invoke('lf:mca', p),
  lfAfr: (term_category: 'short' | 'mid' | 'long') => invoke('lf:afr', { term_category }),
  lfLocTrack: (p: any) => invoke('lf:loc:track', p),
  // LL: portfolio
  lfPortfolioAging: () => invoke('lf:portfolio:aging'),
  lfPortfolioVintage: () => invoke('lf:portfolio:vintage'),
  lfPortfolioConcentration: () => invoke('lf:portfolio:concentration'),
  lfNim: (months?: number) => invoke('lf:nim', { months }),
  lfLoanYield: (loan_id: string) => invoke('lf:loan:yield', { loan_id }),
  lfChargeOffRate: () => invoke('lf:charge-off:rate'),
  lfRecoveryRate: () => invoke('lf:recovery:rate'),
  lfDelinquencyRate: () => invoke('lf:delinquency:rate'),
  lfPortfolioStress: (p: { rate_shock_pct: number; default_rate_increase_pct: number }) => invoke('lf:portfolio:stress', p),
  lfReservesRequired: () => invoke('lf:reserves:required'),

  // ─── Loan Linkage Wave (F1053-F1062) ──────────────────────────
  lkRecordPayment: (p: { loan_id: string; payment_date: string; amount: number; principal_amount: number; interest_amount: number; escrow_amount?: number; fees?: number; payment_method?: string; reference?: string; vendor_id?: string; category_id?: string; notes?: string; create_expense?: boolean }) => invoke('lk:record-payment', p),
  lkLinkBankTx: (p: { bank_transaction_id: string; loan_id: string; schedule_id?: string; principal_amount: number; interest_amount: number; escrow_amount?: number; create_expense?: boolean }) => invoke('lk:link-bank-tx', p),
  lkExpensesForLoan: (loan_id: string, opts?: { limit?: number; since?: string }) => invoke('lk:expenses-for-loan', { loan_id, opts: opts || {} }),
  lkSuggestLoanForBankTx: (p: { amount: number; date: string; memo?: string; payee?: string }) => invoke('lk:suggest-loan-for-bank-tx', p),
  lkAutoGlAccounts: (loan_id: string) => invoke('lk:auto-gl-accounts', { loan_id }),
  lkRetrolink: (expense_id: string, loan_id: string, loan_payment_id?: string) => invoke('lk:retrolink', { expense_id, loan_id, loan_payment_id }),
  lkLinkageDashboard: () => invoke('lk:linkage-dashboard'),
  lkGenerateBill: (p: { loan_id: string; due_date?: string; vendor_id?: string }) => invoke('lk:generate-bill', p),
  lkCashflowTimeline: (loan_id: string, opts?: { since?: string; until?: string }) => invoke('lk:cashflow-timeline', { loan_id, opts: opts || {} }),
  lkLoanContextForExpense: (expense_id: string) => invoke('lk:loan-context-for-expense', { expense_id }),

  // ─── Vendor Locations ────────────────────────────────────────────────
  vendorLocationsList: (vendor_id: string): Promise<any[]> =>
    invoke('vendor-locations:list', { vendor_id }),
  vendorLocationsSync: (vendor_id: string, locations: any[]) =>
    invoke('vendor-locations:sync', { vendor_id, locations }),
  vendorLocationsDelete: (id: string) =>
    invoke('vendor-locations:delete', { id }),
  vendorLocationsSetPrimary: (id: string, vendor_id: string) =>
    invoke('vendor-locations:set-primary', { id, vendor_id }),

  // Events
  on: (channel: string, callback: (...args: any[]) => void) =>
    (window as any).electronAPI?.on ? window.electronAPI.on(channel, callback) : webOn(channel, callback),

  // ─── B3: AI Copilot ──────────────────────────────────────
  copilotAsk: (streamId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    invoke('copilot:ask', { streamId, messages }),
  copilotStop: (streamId: string) =>
    invoke('copilot:stop', { streamId }),
  copilotThreadsList: (): Promise<Array<{ id: string; title: string; created_at: string; updated_at: string }>> =>
    invoke('copilot:threads:list'),
  copilotThreadsLoad: (threadId: string): Promise<{ id: string; title: string; messages: any[] } | null> =>
    invoke('copilot:threads:load', { threadId }),
  copilotThreadsSave: (threadId: string, title: string, messages: any[]) =>
    invoke('copilot:threads:save', { threadId, title, messages }),
  copilotThreadsDelete: (threadId: string) =>
    invoke('copilot:threads:delete', { threadId }),
};

export default api;
