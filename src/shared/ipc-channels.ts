// src/shared/ipc-channels.ts
// Typed IPC channel contracts shared between main (handlers) and renderer (invoke).
// Each channel is a key in IpcChannelMap with { request, response } types.
// This enables type-safe invoke() calls without casting through `any`.
//
// Usage:
//   // In main: ipcMain.handle('db:get', handler)
//   // In renderer: api.dbGet(table, id) → IpcChannelMap['db:get']['response']

export interface IpcChannelMap {
  // ─── Generic CRUD ───────────────────────────────────────
  'db:query': {
    request: { table: string; filters?: Record<string, any>; sort?: { field: string; dir: 'asc' | 'desc' }; limit?: number; offset?: number };
    response: any[];
  };
  'db:get': {
    request: { table: string; id: string };
    response: any | null;
  };
  'db:create': {
    request: { table: string; data: Record<string, any> };
    response: { id?: string; error?: string };
  };
  'db:update': {
    request: { table: string; id: string; data: Record<string, any> };
    response: { ok?: boolean; error?: string };
  };
  'db:delete': {
    request: { table: string; id: string };
    response: { ok?: boolean; error?: string };
  };
  'db:raw-query': {
    request: { sql: string; params?: any[] };
    response: any[];
  };

  // ─── Authentication ─────────────────────────────────────
  'auth:register': {
    request: { email: string; password: string; displayName: string };
    response: { ok?: boolean; error?: string };
  };
  'auth:login': {
    request: { email: string; password: string };
    response: { ok?: boolean; user?: any; error?: string };
  };
  'auth:has-users': {
    request: void;
    response: boolean;
  };
  'auth:list-users': {
    request: void;
    response: any[];
  };
  'auth:validate-session': {
    request: void;
    response: { valid: boolean; user?: any };
  };

  // ─── Company Management ─────────────────────────────────
  'company:list': {
    request: void;
    response: any[];
  };
  'company:get': {
    request: { id: string };
    response: any | null;
  };
  'company:create': {
    request: { data: Record<string, any> };
    response: any;
  };
  'company:update': {
    request: { id: string; data: Record<string, any> };
    response: any;
  };
  'company:switch': {
    request: { companyId: string };
    response: { ok: boolean };
  };

  // ─── Dashboard ──────────────────────────────────────────
  'dashboard:stats': {
    request: void;
    response: Record<string, any>;
  };
  'dashboard:cashflow': {
    request: { months?: number };
    response: any[];
  };
  'dashboard:activity': {
    request: { limit?: number };
    response: any[];
  };

  // ─── Search ─────────────────────────────────────────────
  'search:global': {
    request: { query: string };
    response: any[];
  };

  // ─── Invoice ────────────────────────────────────────────
  'invoice:save': {
    request: { invoice: Record<string, any>; lineItems: Record<string, any>[] };
    response: { id?: string; error?: string };
  };
  'invoice:generate-pdf': {
    request: { invoiceId: string };
    response: { ok?: boolean; path?: string; error?: string };
  };
  'invoice:send-email': {
    request: { invoiceId: string; to: string; cc?: string; subject?: string; body?: string };
    response: { ok?: boolean; error?: string };
  };
  'invoice:record-payment': {
    request: { invoiceId: string; amount: number; method: string; reference?: string; date?: string };
    response: { ok?: boolean; error?: string };
  };
  'invoice:overdue-candidates': {
    request: void;
    response: any[];
  };
  'invoice:convert-to-debt': {
    request: { invoiceId: string };
    response: { ok?: boolean; debtId?: string; error?: string };
  };
  'invoice:batch-pdf': {
    request: { invoiceIds: string[]; mode: 'combined' | 'separate' | 'zip' };
    response: { ok?: boolean; error?: string };
  };
  'invoice:apply-late-fees': {
    request: { invoiceIds: string[]; feeType?: string; feeAmount?: number; feePercent?: number };
    response: { applied: number; error?: string };
  };
  'invoice:run-dunning': {
    request: void;
    response: { sent: number; error?: string };
  };

  // ─── Settings ───────────────────────────────────────────
  'settings:list': {
    request: void;
    response: any[];
  };
  'settings:get': {
    request: { key: string };
    response: any | null;
  };
  'settings:set': {
    request: { key: string; value: any };
    response: { ok: boolean };
  };

  // ─── Tags ───────────────────────────────────────────────
  'tags:list': {
    request: void;
    response: any[];
  };
  'tags:create': {
    request: { data: Record<string, any> };
    response: any;
  };
  'tags:set-for-entity': {
    request: { entityType: string; entityId: string; tagIds: string[] };
    response: { ok: boolean };
  };
  'tags:get-for-entity': {
    request: { entityType: string; entityId: string };
    response: any[];
  };

  // ─── Financial Reports ──────────────────────────────────
  'reports:profit-loss': {
    request: { from: string; to: string; period?: 'month' | 'quarter' | 'year' };
    response: any;
  };
  'reports:balance-sheet': {
    request: { asOf: string };
    response: any;
  };
  'reports:trial-balance': {
    request: { asOf?: string; from?: string; to?: string };
    response: any[];
  };
  'reports:ar-aging': {
    request: { asOf?: string };
    response: any[];
  };
  'reports:ap-aging': {
    request: { asOf?: string };
    response: any[];
  };
  'reports:general-ledger': {
    request: { from: string; to: string; accountId?: string };
    response: any[];
  };
  'reports:cash-flow': {
    request: { from: string; to: string };
    response: any;
  };
  'reports:budget-vs-actual': {
    request: { from: string; to: string; budgetId?: string };
    response: any[];
  };

  // ─── OCR ─────────────────────────────────────────────────
  'ocr:scan-receipt-file': {
    request: { filePath: string };
    response: { ok?: boolean; parsed?: any; error?: string };
  };
  'ocr:scan-receipt-pick': {
    request: void;
    response: { ok?: boolean; cancelled?: boolean; parsed?: any; filePath?: string; error?: string };
  };

  // ─── Print ──────────────────────────────────────────────
  'print:preview': {
    request: { html: string; title?: string };
    response: { ok?: boolean; error?: string };
  };
  'print:save-pdf': {
    request: { html: string; title?: string; filename?: string; pageSize?: string };
    response: { ok?: boolean; path?: string; error?: string };
  };
  'print:print': {
    request: { html: string; title?: string };
    response: { ok?: boolean; error?: string };
  };

  // ─── Export ─────────────────────────────────────────────
  'export:csv': {
    request: { table: string; filters?: Record<string, any> };
    response: { ok?: boolean; path?: string; error?: string };
  };
  'export:full-backup': {
    request: void;
    response: { ok?: boolean; path?: string; error?: string };
  };

  // ─── Backup ─────────────────────────────────────────────
  'backup:to-vps': {
    request: void;
    response: { ok?: boolean; error?: string };
  };
  'backup:restore-from-vps': {
    request: void;
    response: { ok?: boolean; error?: string };
  };

  // ─── Integrations ──────────────────────────────────────
  'stripe:call': {
    request: { method: string; resource: string; params?: Record<string, any> };
    response: any;
  };
  'stripe:sync': {
    request: { resources?: string[] };
    response: any;
  };
  'entity:graph': {
    request: { entityType: string; entityId: string };
    response: any[];
  };
  'entity:timeline': {
    request: { entityType: string; entityId: string };
    response: any[];
  };

  // ─── Analytics ─────────────────────────────────────────
  'analytics:dashboard-data': {
    request: void;
    response: any;
  };

  // ─── Payroll ────────────────────────────────────────────
  'payroll:process': {
    request: Record<string, any>;
    response: any;
  };
  'payroll:edit': {
    request: Record<string, any>;
    response: any;
  };
  'payroll:ytd-totals': {
    request: { employeeId: string; year: number };
    response: any;
  };

  // ─── Intelligence ──────────────────────────────────────
  'intelligence:anomalies': {
    request: void;
    response: any[];
  };
  'intelligence:cash-projection': {
    request: { days?: number };
    response: any[];
  };
  'intelligence:dismiss-anomaly': {
    request: { anomalyId: string };
    response: { ok: boolean };
  };

  // ─── Notification ──────────────────────────────────────
  'notification:list': {
    request: { limit?: number };
    response: any[];
  };
  'notification:mark-read': {
    request: { id: string };
    response: { ok: boolean };
  };
  'notification:mark-all-read': {
    request: void;
    response: { ok: boolean };
  };
  'notification:run-checks': {
    request: void;
    response: { triggered: number };
  };
}
