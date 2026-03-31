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

  // Export
  // Bug fix #3: export:invoice-pdf handler was removed in v1.1.1 dedup cleanup;
  // routes to the canonical invoice:generate-pdf channel to avoid "No handler" crash.
  exportInvoicePdf: (invoiceId: string) => window.electronAPI.invoke('invoice:generate-pdf', invoiceId),
  exportCsv: (table: string, filters?: Record<string, any>) =>
    window.electronAPI.invoke('export:csv', { table, filters }),

  // Invoice PDF & Email
  generateInvoicePDF: (invoiceId: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('invoice:generate-pdf', invoiceId),
  previewInvoicePDF: (invoiceId: string): Promise<{ success?: boolean; error?: string }> =>
    window.electronAPI.invoke('invoice:preview-pdf', invoiceId),
  sendInvoiceEmail: (invoiceId: string): Promise<{ success?: boolean; error?: string; pdfPath?: string; newStatus?: string }> =>
    window.electronAPI.invoke('invoice:send-email', invoiceId),

  // File dialog
  openFileDialog: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) =>
    window.electronAPI.invoke('dialog:open-file', options),

  // Auth
  register: (email: string, password: string, displayName: string) =>
    window.electronAPI.invoke('auth:register', { email, password, displayName }),
  login: (email: string, password: string) =>
    window.electronAPI.invoke('auth:login', { email, password }),
  hasUsers: () => window.electronAPI.invoke('auth:has-users'),
  listUsers: () => window.electronAPI.invoke('auth:list-users'),
  linkUserCompany: (userId: string, companyId: string, role?: string) =>
    window.electronAPI.invoke('auth:link-user-company', { userId, companyId, role }),

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
  saveToPDF: (html: string, title: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> =>
    window.electronAPI.invoke('print:save-pdf', { html, title }),
  print: (html: string): Promise<{ success?: boolean; error?: string }> =>
    window.electronAPI.invoke('print:print', { html }),

  // Journal Entry Utilities
  // Bug fix #13/#49: journal_entries.entry_number is NOT NULL + UNIQUE;
  // this fetches the next sequential number scoped to the active company.
  nextJournalNumber: (): Promise<string> =>
    window.electronAPI.invoke('journal:next-number'),

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

  // ─── Bills / Accounts Payable ──────────────────────
  billsNextNumber: (): Promise<string> =>
    window.electronAPI.invoke('bills:next-number'),
  billsPay: (billId: string, amount: number, paymentDate: string, paymentMethod: string, accountId: string, reference?: string) =>
    window.electronAPI.invoke('bills:pay', { billId, amount, paymentDate, paymentMethod, accountId, reference }),
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
  taxCalculateWithholding: (params: {
    gross_pay: number;
    pay_frequency: string;
    filing_status: string;
    allowances: number;
    additional_withholding: number;
    year: number;
  }) => window.electronAPI.invoke('tax:calculate-withholding', params),
  taxAvailableYears: (): Promise<number[]> =>
    window.electronAPI.invoke('tax:available-years'),
  taxAutoSeedCurrentYear: () =>
    window.electronAPI.invoke('tax:auto-seed-current-year'),

  // Events
  on: (channel: string, callback: (...args: any[]) => void) => window.electronAPI.on(channel, callback),
};

export default api;
