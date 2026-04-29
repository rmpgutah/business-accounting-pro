# Advanced System Implementation Plan — 75 Features

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 3 advanced platform layers (Cognitive Command, Reactive Engine, Predictive Intelligence) that distribute 75 enhancements and transform the app from a data entry tool into an intelligent operations platform.

**Architecture:** Three layered systems each compounding into the next. Layer 1 provides command infrastructure. Layer 2 reacts to events from any module. Layer 3 learns patterns from history. Each phase is independently shippable.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, Tailwind CSS, recharts, Zustand. Zero external AI services — all inference is local TypeScript.

**Design Doc:** `docs/plans/2026-04-28-advanced-system-design.md`

---

## Phase 1: Foundation — Database Migrations + Event Bus + Command Registry

Independently shippable: provides infrastructure but no user-visible features yet.

### Task 1: Database Migrations

**Files:**
- Modify: `src/main/database/index.ts` (append to migrations array)

**Step 1: Add 9 migrations**

Find the end of the migrations array (look for the comment block before `];`). Append:

```typescript
// Advanced System (2026-04-28) — Cognitive Command Layer
`CREATE TABLE IF NOT EXISTS custom_shortcuts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_combo TEXT NOT NULL,
  command_id TEXT NOT NULL,
  params_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS macros (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  action_sequence_json TEXT NOT NULL DEFAULT '[]',
  is_shared INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS command_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  params_json TEXT DEFAULT '{}',
  executed_at TEXT DEFAULT (datetime('now')),
  result TEXT DEFAULT 'success',
  duration_ms INTEGER DEFAULT 0
)`,
// Advanced System (2026-04-28) — Reactive Engine
`CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  trigger_type TEXT NOT NULL DEFAULT 'event',
  trigger_config_json TEXT NOT NULL DEFAULT '{}',
  conditions_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER DEFAULT 1,
  version INTEGER DEFAULT 1,
  parent_workflow_id TEXT DEFAULT NULL,
  rate_limit_per_hour INTEGER DEFAULT 0,
  requires_approval INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  triggered_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT DEFAULT '{}',
  result_json TEXT DEFAULT '{}',
  error_message TEXT DEFAULT '',
  duration_ms INTEGER DEFAULT 0
)`,
`CREATE TABLE IF NOT EXISTS workflow_event_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  payload_json TEXT DEFAULT '{}',
  occurred_at TEXT DEFAULT (datetime('now'))
)`,
// Advanced System (2026-04-28) — Predictive Intelligence
`CREATE TABLE IF NOT EXISTS pattern_cache (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  entity_type TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  pattern_data_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  last_computed_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  prediction_type TEXT NOT NULL,
  target_entity_type TEXT DEFAULT '',
  target_entity_id TEXT DEFAULT '',
  predicted_value REAL DEFAULT 0,
  confidence REAL DEFAULT 0,
  confidence_low REAL DEFAULT 0,
  confidence_high REAL DEFAULT 0,
  prediction_data_json TEXT DEFAULT '{}',
  computed_at TEXT DEFAULT (datetime('now'))
)`,
`CREATE TABLE IF NOT EXISTS anomaly_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  details_json TEXT DEFAULT '{}',
  resolved INTEGER DEFAULT 0,
  resolved_at TEXT,
  resolved_by TEXT DEFAULT '',
  detected_at TEXT DEFAULT (datetime('now'))
)`,
"CREATE INDEX IF NOT EXISTS idx_command_history_user ON command_history(user_id, executed_at DESC)",
"CREATE INDEX IF NOT EXISTS idx_workflow_event_log_type ON workflow_event_log(company_id, event_type, occurred_at DESC)",
"CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id, triggered_at DESC)",
"CREATE INDEX IF NOT EXISTS idx_pattern_cache_lookup ON pattern_cache(company_id, pattern_type, entity_id)",
"CREATE INDEX IF NOT EXISTS idx_predictions_lookup ON predictions(company_id, prediction_type, target_entity_id)",
"CREATE INDEX IF NOT EXISTS idx_anomaly_log_unresolved ON anomaly_log(company_id, resolved, detected_at DESC)",
```

Add to `tablesWithoutCompanyId` Set in `src/main/ipc/index.ts`:
- `custom_shortcuts`
- `command_history`
- `workflow_executions`
- `workflow_event_log`

Add to `tablesWithoutUpdatedAt` Set in `src/main/database/index.ts`:
- `command_history`
- `workflow_executions`
- `workflow_event_log`
- `predictions`
- `anomaly_log`

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/main/database/index.ts src/main/ipc/index.ts
git commit -m "feat(advanced): add 9 database tables for command/workflow/intelligence layers"
```

---

### Task 2: EventBus Service

**Files:**
- Create: `src/main/services/EventBus.ts`

**Step 1: Create EventBus**

Pure in-process pub/sub. No external dependencies.

```typescript
// src/main/services/EventBus.ts
// In-process semantic event bus for cross-module workflows.
// Modules emit events; subscribers (workflows, audit log, intelligence) react.

import * as db from '../database';
import { v4 as uuid } from 'uuid';

export type EventType =
  // Invoice
  | 'invoice.created' | 'invoice.updated' | 'invoice.deleted'
  | 'invoice.sent' | 'invoice.viewed' | 'invoice.paid'
  | 'invoice.partial_paid' | 'invoice.overdue' | 'invoice.voided'
  // Expense
  | 'expense.created' | 'expense.updated' | 'expense.approved'
  | 'expense.rejected' | 'expense.reimbursed'
  // Payment
  | 'payment.received' | 'payment.refunded'
  // Client / Vendor
  | 'client.created' | 'client.updated' | 'client.status_changed'
  | 'vendor.created' | 'vendor.updated'
  // Quote
  | 'quote.created' | 'quote.sent' | 'quote.accepted'
  | 'quote.rejected' | 'quote.converted' | 'quote.expired'
  // Debt
  | 'debt.created' | 'debt.escalated' | 'debt.payment_received'
  | 'debt.settled' | 'debt.closed' | 'debt.written_off'
  // Payroll
  | 'payroll.processed' | 'payroll.paid'
  // Project
  | 'project.created' | 'project.budget_warning' | 'project.completed'
  // Tax
  | 'tax.filing_due' | 'tax.deposit_due'
  // Generic
  | 'entity.deleted';

export interface EventPayload {
  type: EventType;
  companyId: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, any>;
  occurredAt?: string;
}

type Listener = (payload: EventPayload) => void | Promise<void>;

class EventBus {
  private listeners: Map<EventType, Set<Listener>> = new Map();
  private wildcardListeners: Set<Listener> = new Set();

  on(type: EventType, listener: Listener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  onAny(listener: Listener): () => void {
    this.wildcardListeners.add(listener);
    return () => this.wildcardListeners.delete(listener);
  }

  async emit(payload: EventPayload): Promise<void> {
    const enriched: EventPayload = {
      ...payload,
      occurredAt: payload.occurredAt || new Date().toISOString(),
    };

    // PERSIST: log to workflow_event_log for audit + replay
    try {
      const dbI = db.getDb();
      dbI.prepare(
        `INSERT INTO workflow_event_log (id, company_id, event_type, entity_type, entity_id, payload_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uuid(),
        enriched.companyId,
        enriched.type,
        enriched.entityType || '',
        enriched.entityId || '',
        JSON.stringify(enriched.data || {}),
        enriched.occurredAt!
      );
    } catch (err) {
      console.warn('[EventBus] Failed to log event:', err);
    }

    // FAN OUT: typed listeners + wildcard listeners
    const typed = this.listeners.get(enriched.type) || new Set();
    const all = [...typed, ...this.wildcardListeners];
    for (const fn of all) {
      try {
        await Promise.resolve(fn(enriched));
      } catch (err) {
        console.warn(`[EventBus] Listener error for ${enriched.type}:`, err);
      }
    }
  }
}

// Singleton
export const eventBus = new EventBus();
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/main/services/EventBus.ts
git commit -m "feat(advanced): add EventBus for semantic cross-module events"
```

---

### Task 3: CommandRegistry Service

**Files:**
- Create: `src/main/services/CommandRegistry.ts`

**Step 1: Create CommandRegistry**

```typescript
// src/main/services/CommandRegistry.ts
// Registry of executable commands surfaced via Cmd+K palette.

export interface CommandParam {
  name: string;
  type: 'string' | 'number' | 'date' | 'entity';
  entityType?: string;
  required?: boolean;
}

export interface CommandDef {
  id: string;
  module: string;
  label: string;
  description?: string;
  keywords?: string[];
  params?: CommandParam[];
  scope?: 'global' | 'module' | 'view';
  // executor returns ipc payload to relay back to renderer for UI navigation
  executor?: (params: Record<string, any>) => Promise<{ navigate?: { module: string; entityId?: string }; result?: any; error?: string }>;
}

class CommandRegistry {
  private commands: Map<string, CommandDef> = new Map();

  register(cmd: CommandDef) {
    this.commands.set(cmd.id, cmd);
  }

  get(id: string): CommandDef | undefined {
    return this.commands.get(id);
  }

  search(query: string): CommandDef[] {
    if (!query.trim()) return Array.from(this.commands.values()).slice(0, 20);
    const q = query.toLowerCase();
    return Array.from(this.commands.values())
      .map(cmd => {
        const labelMatch = cmd.label.toLowerCase().indexOf(q);
        const idMatch = cmd.id.toLowerCase().indexOf(q);
        const kwMatch = (cmd.keywords || []).some(k => k.toLowerCase().includes(q));
        const score = labelMatch >= 0 ? 100 - labelMatch
                    : idMatch >= 0 ? 50 - idMatch
                    : kwMatch ? 30
                    : -1;
        return { cmd, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.cmd)
      .slice(0, 30);
  }

  all(): CommandDef[] {
    return Array.from(this.commands.values());
  }
}

export const commandRegistry = new CommandRegistry();

// Bootstrap with built-in commands
export function bootstrapBuiltinCommands() {
  commandRegistry.register({
    id: 'invoice.create', module: 'invoices', label: 'Create New Invoice',
    keywords: ['new', 'invoice', 'bill'], scope: 'global',
  });
  commandRegistry.register({
    id: 'expense.create', module: 'expenses', label: 'Create New Expense',
    keywords: ['new', 'expense', 'cost'], scope: 'global',
  });
  commandRegistry.register({
    id: 'quote.create', module: 'quotes', label: 'Create New Quote',
    keywords: ['new', 'quote', 'estimate'], scope: 'global',
  });
  commandRegistry.register({
    id: 'client.create', module: 'clients', label: 'Add Client',
    keywords: ['new', 'client', 'customer'], scope: 'global',
  });
  commandRegistry.register({
    id: 'payroll.run', module: 'payroll', label: 'Run Payroll',
    keywords: ['payroll', 'pay', 'process'], scope: 'global',
  });
  commandRegistry.register({
    id: 'reports.profit-loss', module: 'reports', label: 'Open Profit & Loss',
    keywords: ['p&l', 'pl', 'income', 'profit'], scope: 'global',
  });
  commandRegistry.register({
    id: 'reports.balance-sheet', module: 'reports', label: 'Open Balance Sheet',
    keywords: ['balance', 'bs', 'sheet'], scope: 'global',
  });
  commandRegistry.register({
    id: 'reports.cash-flow', module: 'reports', label: 'Open Cash Flow Statement',
    keywords: ['cash', 'cf', 'flow'], scope: 'global',
  });
  commandRegistry.register({
    id: 'tax.dashboard', module: 'taxes', label: 'Open Tax Dashboard',
    keywords: ['tax', 'taxes', 'irs'], scope: 'global',
  });
  commandRegistry.register({
    id: 'debt.dashboard', module: 'debt-collection', label: 'Open Collections Dashboard',
    keywords: ['debt', 'collections', 'collect'], scope: 'global',
  });
}
```

**Step 2: Bootstrap on app start**

Modify `src/main/ipc/index.ts` — find the IPC registration function and add at the top:

```typescript
import { bootstrapBuiltinCommands } from '../services/CommandRegistry';
import { eventBus } from '../services/EventBus';
// ...inside registerIpcHandlers():
bootstrapBuiltinCommands();
```

**Step 3: Verify + Commit**

```bash
npx tsc --noEmit
git add src/main/services/CommandRegistry.ts src/main/ipc/index.ts
git commit -m "feat(advanced): add CommandRegistry with 10 built-in commands"
```

---

### Task 4: Phase 1 IPC Handlers

**Files:**
- Modify: `src/main/ipc/index.ts` (add new handlers)
- Modify: `src/renderer/lib/api.ts` (add API methods)

**Step 1: Add IPC handlers**

Insert these handlers near the end of the IPC registration:

```typescript
// ─── Cognitive Command Layer ────────────────────────────
ipcMain.handle('command:list', () => {
  const { commandRegistry } = require('../services/CommandRegistry');
  return commandRegistry.all().map((c: any) => ({
    id: c.id, module: c.module, label: c.label,
    description: c.description, keywords: c.keywords,
    params: c.params, scope: c.scope,
  }));
});

ipcMain.handle('command:search', (_event, { query }: { query: string }) => {
  const { commandRegistry } = require('../services/CommandRegistry');
  return commandRegistry.search(query).map((c: any) => ({
    id: c.id, module: c.module, label: c.label,
    description: c.description, keywords: c.keywords,
  }));
});

ipcMain.handle('command:log-execution', (_event, { user_id, command_id, params, result, duration_ms }: any) => {
  const dbI = db.getDb();
  dbI.prepare(
    `INSERT INTO command_history (id, user_id, command_id, params_json, result, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uuid(), user_id || 'anon', command_id, JSON.stringify(params || {}), result || 'success', duration_ms || 0);
  return { success: true };
});

ipcMain.handle('command:history', (_event, { user_id, limit }: { user_id?: string; limit?: number }) => {
  const dbI = db.getDb();
  return dbI.prepare(
    `SELECT * FROM command_history WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?`
  ).all(user_id || 'anon', limit || 50);
});

ipcMain.handle('command:frequent', (_event, { user_id, limit }: { user_id?: string; limit?: number }) => {
  const dbI = db.getDb();
  return dbI.prepare(
    `SELECT command_id, COUNT(*) as count FROM command_history
     WHERE user_id = ? AND executed_at >= date('now', '-30 days')
     GROUP BY command_id ORDER BY count DESC LIMIT ?`
  ).all(user_id || 'anon', limit || 10);
});

ipcMain.handle('shortcut:list', (_event, { user_id }: { user_id?: string }) => {
  const dbI = db.getDb();
  return dbI.prepare(`SELECT * FROM custom_shortcuts WHERE user_id = ?`).all(user_id || 'anon');
});

ipcMain.handle('shortcut:save', (_event, { user_id, key_combo, command_id, params }: any) => {
  const dbI = db.getDb();
  const existing = dbI.prepare(
    `SELECT id FROM custom_shortcuts WHERE user_id = ? AND key_combo = ?`
  ).get(user_id || 'anon', key_combo) as any;
  if (existing) {
    dbI.prepare(
      `UPDATE custom_shortcuts SET command_id = ?, params_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(command_id, JSON.stringify(params || {}), existing.id);
    return { success: true, id: existing.id };
  }
  const id = uuid();
  dbI.prepare(
    `INSERT INTO custom_shortcuts (id, user_id, key_combo, command_id, params_json) VALUES (?, ?, ?, ?, ?)`
  ).run(id, user_id || 'anon', key_combo, command_id, JSON.stringify(params || {}));
  return { success: true, id };
});

ipcMain.handle('shortcut:delete', (_event, { id }: { id: string }) => {
  db.getDb().prepare(`DELETE FROM custom_shortcuts WHERE id = ?`).run(id);
  return { success: true };
});

ipcMain.handle('macro:list', (_event, { user_id }: { user_id?: string }) => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(
    `SELECT * FROM macros WHERE (user_id = ? OR is_shared = 1) AND company_id = ? ORDER BY name`
  ).all(user_id || 'anon', companyId);
});

ipcMain.handle('macro:save', (_event, { id, user_id, name, description, action_sequence, is_shared }: any) => {
  const companyId = db.getCurrentCompanyId();
  const dbI = db.getDb();
  const seqJson = JSON.stringify(action_sequence || []);
  if (id) {
    dbI.prepare(
      `UPDATE macros SET name = ?, description = ?, action_sequence_json = ?, is_shared = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(name || '', description || '', seqJson, is_shared ? 1 : 0, id);
    return { success: true, id };
  }
  const newId = uuid();
  dbI.prepare(
    `INSERT INTO macros (id, user_id, company_id, name, description, action_sequence_json, is_shared) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(newId, user_id || 'anon', companyId, name || '', description || '', seqJson, is_shared ? 1 : 0);
  scheduleAutoBackup();
  return { success: true, id: newId };
});

ipcMain.handle('macro:delete', (_event, { id }: { id: string }) => {
  db.getDb().prepare(`DELETE FROM macros WHERE id = ?`).run(id);
  scheduleAutoBackup();
  return { success: true };
});
```

**Step 2: Add API methods**

Add to `src/renderer/lib/api.ts` before the closing `};`:

```typescript
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
```

**Step 3: Verify + Commit**

```bash
npx tsc --noEmit
git add src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat(advanced): add 11 IPC handlers + API methods for command layer"
```

---

## Phase 2: Cognitive Command Palette UI

Independently shippable: produces visible Cmd+K command palette.

### Task 5: Command Parser (NL Input)

**Files:**
- Create: `src/renderer/lib/commandParser.ts`

```typescript
// src/renderer/lib/commandParser.ts
// Parse natural-language strings into structured command intents.
// Examples:
//   "$45 lunch with john abc" → { type: 'expense.create', amount: 45, description: 'lunch with john', clientHint: 'abc' }
//   "inv 1024" → { type: 'navigate', module: 'invoices', identifier: '1024' }
//   "pay 100 invoice 1024" → { type: 'invoice.record-payment', invoiceId: '1024', amount: 100 }

export interface ParsedIntent {
  type: 'expense.create' | 'invoice.create' | 'invoice.record-payment' | 'navigate' | 'unknown';
  amount?: number;
  description?: string;
  clientHint?: string;
  vendorHint?: string;
  module?: string;
  identifier?: string;
  invoiceId?: string;
  raw: string;
}

const MONEY_RE = /\$?(\d+(?:\.\d{1,2})?)/;
const NAVIGATE_PATTERNS: Array<{ re: RegExp; module: string }> = [
  { re: /^inv(?:oice)?\s+(\S+)/i, module: 'invoices' },
  { re: /^exp(?:ense)?\s+(\S+)/i, module: 'expenses' },
  { re: /^client\s+(\S+)/i, module: 'clients' },
  { re: /^vendor\s+(\S+)/i, module: 'vendors' },
  { re: /^quote\s+(\S+)/i, module: 'quotes' },
  { re: /^debt\s+(\S+)/i, module: 'debt-collection' },
  { re: /^emp(?:loyee)?\s+(\S+)/i, module: 'payroll' },
];

export function parseCommand(input: string): ParsedIntent {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'unknown', raw: trimmed };

  // Navigate patterns
  for (const { re, module } of NAVIGATE_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return { type: 'navigate', module, identifier: m[1], raw: trimmed };
  }

  // "pay X invoice N"
  const payMatch = trimmed.match(/^pay\s+\$?(\d+(?:\.\d{1,2})?)\s+invoice\s+(\S+)/i);
  if (payMatch) {
    return {
      type: 'invoice.record-payment',
      amount: parseFloat(payMatch[1]),
      invoiceId: payMatch[2],
      raw: trimmed,
    };
  }

  // Expense quick-create: starts with $ amount
  const dollarMatch = trimmed.match(/^\$?(\d+(?:\.\d{1,2})?)\s+(.+)/);
  if (dollarMatch && !trimmed.startsWith('inv')) {
    const amount = parseFloat(dollarMatch[1]);
    const rest = dollarMatch[2].trim();
    // Extract trailing client hint after "for"
    const forMatch = rest.match(/^(.*)\s+for\s+(\S+)$/i);
    if (forMatch) {
      return {
        type: 'expense.create',
        amount,
        description: forMatch[1].trim(),
        clientHint: forMatch[2].trim(),
        raw: trimmed,
      };
    }
    return { type: 'expense.create', amount, description: rest, raw: trimmed };
  }

  return { type: 'unknown', raw: trimmed };
}
```

**Step 2: Verify + Commit**

```bash
npx tsc --noEmit
git add src/renderer/lib/commandParser.ts
git commit -m "feat(advanced): add commandParser for NL quick-create intents"
```

---

### Task 6: CommandPalette Component

**Files:**
- Create: `src/renderer/components/CommandPalette.tsx`
- Create: `src/renderer/components/CommandPaletteCommands.ts`

**Step 1: Create commands registry (renderer side)**

```typescript
// src/renderer/components/CommandPaletteCommands.ts
import api from '../lib/api';

export interface RendererCommand {
  id: string;
  label: string;
  module: string;
  keywords?: string[];
  icon?: string;
  execute: (ctx: CommandContext) => Promise<void> | void;
}

export interface CommandContext {
  setModule: (m: string) => void;
  setFocusEntity?: (type: string, id: string) => void;
  showToast?: (msg: string) => void;
  navigate?: (module: string, params?: any) => void;
}

export const RENDERER_COMMANDS: RendererCommand[] = [
  { id: 'invoice.create', label: 'Create New Invoice', module: 'invoicing', keywords: ['new', 'invoice'],
    execute: (ctx) => { ctx.setModule('invoicing'); }},
  { id: 'expense.create', label: 'Create New Expense', module: 'expenses', keywords: ['new', 'expense'],
    execute: (ctx) => { ctx.setModule('expenses'); }},
  { id: 'quote.create', label: 'Create New Quote', module: 'quotes', keywords: ['new', 'quote'],
    execute: (ctx) => { ctx.setModule('quotes'); }},
  { id: 'client.create', label: 'Add Client', module: 'clients', keywords: ['new', 'client'],
    execute: (ctx) => { ctx.setModule('clients'); }},
  { id: 'payroll.run', label: 'Run Payroll', module: 'payroll', keywords: ['payroll'],
    execute: (ctx) => { ctx.setModule('payroll'); }},
  { id: 'reports.profit-loss', label: 'Open Profit & Loss', module: 'reports', keywords: ['p&l', 'pl', 'income'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.balance-sheet', label: 'Open Balance Sheet', module: 'reports', keywords: ['balance'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.cash-flow', label: 'Open Cash Flow', module: 'reports', keywords: ['cash', 'flow'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'tax.dashboard', label: 'Open Tax Dashboard', module: 'taxes', keywords: ['tax'],
    execute: (ctx) => { ctx.setModule('taxes'); }},
  { id: 'debt.dashboard', label: 'Open Collections', module: 'debt-collection', keywords: ['debt', 'collect'],
    execute: (ctx) => { ctx.setModule('debt-collection'); }},
  // Navigation
  { id: 'goto.dashboard', label: 'Go to Dashboard', module: 'dashboard', keywords: ['home', 'dashboard'],
    execute: (ctx) => { ctx.setModule('dashboard'); }},
  { id: 'goto.accounts', label: 'Go to Accounts & GL', module: 'accounts', keywords: ['accounts', 'gl', 'ledger'],
    execute: (ctx) => { ctx.setModule('accounts'); }},
  { id: 'goto.bills', label: 'Go to Bills (AP)', module: 'bills', keywords: ['bills', 'ap'],
    execute: (ctx) => { ctx.setModule('bills'); }},
  { id: 'goto.budgets', label: 'Go to Budgets', module: 'budgets', keywords: ['budgets'],
    execute: (ctx) => { ctx.setModule('budgets'); }},
  { id: 'goto.settings', label: 'Open Settings', module: 'settings', keywords: ['settings', 'preferences'],
    execute: (ctx) => { ctx.setModule('settings'); }},
];

export function findCommands(query: string): RendererCommand[] {
  if (!query.trim()) return RENDERER_COMMANDS.slice(0, 10);
  const q = query.toLowerCase();
  return RENDERER_COMMANDS
    .map(c => {
      const labelMatch = c.label.toLowerCase().indexOf(q);
      const keywordMatch = (c.keywords || []).some(k => k.toLowerCase().includes(q));
      const score = labelMatch >= 0 ? 100 - labelMatch : keywordMatch ? 30 : -1;
      return { c, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.c)
    .slice(0, 20);
}
```

**Step 2: Create CommandPalette overlay**

```typescript
// src/renderer/components/CommandPalette.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ArrowRight, Clock, Zap } from 'lucide-react';
import api from '../lib/api';
import { useAppStore } from '../stores/appStore';
import { useCompanyStore } from '../stores/companyStore';
import { parseCommand } from '../lib/commandParser';
import { RENDERER_COMMANDS, findCommands, type RendererCommand } from './CommandPaletteCommands';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SearchResult {
  type: 'command' | 'entity' | 'parsed';
  command?: RendererCommand;
  entity?: { id: string; type: string; label: string; subtitle?: string };
  parsed?: { description: string; action: () => void };
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [entities, setEntities] = useState<any[]>([]);
  const [recent, setRecent] = useState<RendererCommand[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const setModule = useAppStore((s) => s.setModule);
  const setFocusEntity = useAppStore((s) => s.setFocusEntity);
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      // Load recent commands
      api.frequentCommands('anon', 5).then((rows: any[]) => {
        const ids = (rows || []).map(r => r.command_id);
        setRecent(RENDERER_COMMANDS.filter(c => ids.includes(c.id)));
      }).catch(() => {});
    }
  }, [isOpen]);

  // Entity search (live)
  useEffect(() => {
    if (!query.trim() || !activeCompany) { setEntities([]); return; }
    const q = query.trim();
    if (q.length < 2) { setEntities([]); return; }
    const sql = `
      SELECT 'invoice' as type, id, invoice_number as label, total as subtitle
      FROM invoices WHERE company_id = ? AND (invoice_number LIKE ? OR notes LIKE ?) LIMIT 5
      UNION ALL
      SELECT 'client' as type, id, name as label, email as subtitle
      FROM clients WHERE company_id = ? AND (name LIKE ? OR email LIKE ?) LIMIT 5
      UNION ALL
      SELECT 'expense' as type, id, description as label, CAST(amount AS TEXT) as subtitle
      FROM expenses WHERE company_id = ? AND description LIKE ? LIMIT 5
    `;
    const like = `%${q}%`;
    api.rawQuery(sql, [activeCompany.id, like, like, activeCompany.id, like, like, activeCompany.id, like])
      .then((rows: any[]) => setEntities(Array.isArray(rows) ? rows : []))
      .catch(() => setEntities([]));
  }, [query, activeCompany]);

  // Parsed intent
  const parsed = useMemo(() => parseCommand(query), [query]);

  // Combined results
  const results = useMemo<SearchResult[]>(() => {
    const cmds = findCommands(query).map(c => ({ type: 'command' as const, command: c }));
    const ents = entities.map(e => ({
      type: 'entity' as const,
      entity: { id: e.id, type: e.type, label: e.label || '(unnamed)', subtitle: e.subtitle },
    }));
    const intents: SearchResult[] = [];
    if (parsed.type === 'expense.create' && parsed.amount) {
      intents.push({
        type: 'parsed',
        parsed: {
          description: `Create expense: $${parsed.amount} for "${parsed.description || ''}"`,
          action: () => { setModule('expenses'); onClose(); },
        },
      });
    }
    if (parsed.type === 'navigate' && parsed.module) {
      intents.push({
        type: 'parsed',
        parsed: {
          description: `Navigate to ${parsed.module} ${parsed.identifier}`,
          action: () => { setModule(parsed.module!); onClose(); },
        },
      });
    }
    return [...intents, ...cmds, ...ents];
  }, [query, entities, parsed, setModule, onClose]);

  const executeResult = async (r: SearchResult) => {
    const t0 = performance.now();
    if (r.type === 'command' && r.command) {
      r.command.execute({ setModule, setFocusEntity });
      try {
        await api.logCommandExecution({
          command_id: r.command.id,
          params: {},
          result: 'success',
          duration_ms: performance.now() - t0,
        });
      } catch {}
    } else if (r.type === 'entity' && r.entity) {
      const moduleMap: Record<string, string> = {
        invoice: 'invoicing', expense: 'expenses', client: 'clients',
        vendor: 'vendors', quote: 'quotes', debt: 'debt-collection',
      };
      const mod = moduleMap[r.entity.type] || r.entity.type;
      setFocusEntity?.(r.entity.type, r.entity.id);
      setModule(mod);
    } else if (r.type === 'parsed' && r.parsed) {
      r.parsed.action();
    }
    onClose();
  };

  // Keyboard handlers
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = results[selectedIdx];
        if (r) executeResult(r);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, results, selectedIdx, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="block-card-elevated"
        style={{
          width: '600px', maxWidth: '90vw',
          maxHeight: '70vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          borderRadius: '8px',
        }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-primary">
          <Search size={16} className="text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            placeholder="Type a command or search... (try: $45 lunch, inv 1024, pay 100 invoice X)"
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted"
            style={{ caretColor: 'var(--color-accent-blue)' }}
          />
          <span className="text-[10px] text-text-muted font-mono px-2 py-1 border border-border-primary" style={{ borderRadius: '4px' }}>ESC</span>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {!query && recent.length > 0 && (
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold flex items-center gap-1">
              <Clock size={10} /> Recent
            </div>
          )}
          {!query && recent.map((c, i) => (
            <ResultRow
              key={c.id}
              label={c.label}
              icon={<Clock size={14} className="text-text-muted" />}
              selected={selectedIdx === i}
              onClick={() => executeResult({ type: 'command', command: c })}
            />
          ))}

          {results.length > 0 && (
            <>
              {results.some(r => r.type === 'parsed') && (
                <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold flex items-center gap-1">
                  <Zap size={10} /> Quick Actions
                </div>
              )}
              {results.map((r, i) => (
                <ResultRow
                  key={i}
                  label={
                    r.type === 'command' ? r.command!.label
                    : r.type === 'entity' ? `${r.entity!.type.toUpperCase()}: ${r.entity!.label}`
                    : r.parsed!.description
                  }
                  subtitle={r.type === 'entity' ? r.entity!.subtitle : undefined}
                  icon={
                    r.type === 'parsed' ? <Zap size={14} className="text-accent-blue" />
                    : r.type === 'entity' ? <ArrowRight size={14} className="text-text-muted" />
                    : <ArrowRight size={14} className="text-text-muted" />
                  }
                  selected={selectedIdx === i}
                  onClick={() => executeResult(r)}
                />
              ))}
            </>
          )}

          {query && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              No commands or matches found.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border-primary flex items-center justify-between text-[10px] text-text-muted">
          <span>↑↓ Navigate · ↵ Execute · ESC Close</span>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
};

const ResultRow: React.FC<{
  label: string; subtitle?: string; icon: React.ReactNode;
  selected: boolean; onClick: () => void;
}> = ({ label, subtitle, icon, selected, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
      selected ? 'bg-bg-tertiary text-text-primary' : 'hover:bg-bg-hover text-text-secondary'
    }`}
  >
    {icon}
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium truncate">{label}</div>
      {subtitle && <div className="text-xs text-text-muted truncate">{subtitle}</div>}
    </div>
  </button>
);

export default CommandPalette;
```

**Step 3: Mount globally + register Cmd+K**

Modify `src/renderer/App.tsx`:
- Import: `import CommandPalette from './components/CommandPalette';`
- Add state: `const [paletteOpen, setPaletteOpen] = useState(false);`
- In a useEffect, register keyboard shortcut:

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setPaletteOpen(o => !o);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

- Render: `<CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />` near the end of the App return JSX (before the closing tag).

**Step 4: Verify + Commit**

```bash
npx tsc --noEmit
git add src/renderer/components/CommandPalette.tsx src/renderer/components/CommandPaletteCommands.ts src/renderer/App.tsx
git commit -m "feat(advanced): Cmd+K command palette with entity search + NL parsing"
```

---

## Phase 3: Macro Recording + Custom Shortcuts

Independently shippable: extends Cmd+K with macros and shortcut customization in Settings.

### Task 7: MacroRecorder + Shortcuts UI

**Files:**
- Create: `src/renderer/components/MacroRecorder.tsx`
- Modify: `src/renderer/modules/settings/index.tsx` (add Shortcuts/Macros card)

```typescript
// src/renderer/components/MacroRecorder.tsx
import React, { useState } from 'react';
import { Circle, StopCircle, Play, Save } from 'lucide-react';
import api from '../lib/api';

interface RecordedAction {
  command_id: string;
  params: any;
  timestamp: number;
}

interface MacroRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const MacroRecorder: React.FC<MacroRecorderProps> = ({ isOpen, onClose, onSaved }) => {
  const [recording, setRecording] = useState(false);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  const startRecording = () => { setRecording(true); setActions([]); };
  const stopRecording = () => { setRecording(false); };

  const handleSave = async () => {
    if (!name || actions.length === 0) return;
    await api.saveMacro({ name, description, action_sequence: actions });
    onSaved();
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} className="block-card-elevated" style={{ width: '500px', padding: '24px', borderRadius: '8px' }}>
        <h2 className="text-base font-bold text-text-primary mb-4">Record Macro</h2>
        <div className="space-y-3">
          <input className="block-input w-full" placeholder="Macro name" value={name} onChange={e => setName(e.target.value)} />
          <textarea className="block-input w-full" rows={2} placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
          <div className="flex items-center gap-2">
            {!recording ? (
              <button onClick={startRecording} className="block-btn-primary flex items-center gap-2 text-xs px-4 py-2">
                <Circle size={12} /> Start Recording
              </button>
            ) : (
              <button onClick={stopRecording} className="block-btn flex items-center gap-2 text-xs px-4 py-2 text-accent-expense">
                <StopCircle size={12} /> Stop Recording
              </button>
            )}
            <span className="text-xs text-text-muted">{actions.length} action(s) recorded</span>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border-primary">
            <button onClick={onClose} className="block-btn text-xs px-4 py-2">Cancel</button>
            <button onClick={handleSave} disabled={!name || actions.length === 0} className="block-btn-primary text-xs px-4 py-2 flex items-center gap-1">
              <Save size={12} /> Save Macro
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MacroRecorder;
```

**Step 2: Add Shortcuts settings card**

In `src/renderer/modules/settings/index.tsx`, add a SectionCard:

```jsx
<SectionCard icon={Zap} title="Keyboard Shortcuts & Macros" description="Customize Cmd+K palette behavior and record macros">
  <button onClick={() => setMacroOpen(true)} className="block-btn text-xs">Record New Macro</button>
  {/* List existing macros */}
</SectionCard>
```

**Step 3: Verify + Commit**

```bash
npx tsc --noEmit
git add src/renderer/components/MacroRecorder.tsx src/renderer/modules/settings/index.tsx
git commit -m "feat(advanced): macro recorder + shortcuts settings card"
```

---

## Phase 4: Workflow Engine + Saga Coordinator

Independently shippable: provides workflow infrastructure (UI in Phase 5).

### Task 8: WorkflowEngine

**Files:**
- Create: `src/main/services/WorkflowEngine.ts`
- Create: `src/main/services/SagaCoordinator.ts`

```typescript
// src/main/services/WorkflowEngine.ts
import { v4 as uuid } from 'uuid';
import * as db from '../database';
import { eventBus, EventPayload, EventType } from './EventBus';

interface Condition {
  field: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'exists';
  value: any;
}

interface Action {
  type: 'log_to_je' | 'send_notification' | 'update_field' | 'create_task' | 'webhook' | 'log_audit' | 'trigger_macro';
  config: Record<string, any>;
}

interface WorkflowDefinition {
  id: string;
  company_id: string;
  name: string;
  trigger_type: string;
  trigger_config_json: string;
  conditions_json: string;
  actions_json: string;
  is_active: number;
  rate_limit_per_hour: number;
}

class WorkflowEngine {
  private subscribed = false;

  start() {
    if (this.subscribed) return;
    this.subscribed = true;
    eventBus.onAny(async (payload) => {
      await this.handleEvent(payload);
    });
  }

  private async handleEvent(payload: EventPayload) {
    let workflows: WorkflowDefinition[] = [];
    try {
      workflows = db.getDb().prepare(
        `SELECT * FROM workflow_definitions WHERE company_id = ? AND is_active = 1 AND trigger_type = 'event'`
      ).all(payload.companyId) as WorkflowDefinition[];
    } catch (err) {
      console.warn('[WorkflowEngine] Failed to load workflows:', err);
      return;
    }

    for (const wf of workflows) {
      try {
        const triggerCfg = JSON.parse(wf.trigger_config_json || '{}');
        if (triggerCfg.event_type !== payload.type) continue;
        // Rate limit check
        if (wf.rate_limit_per_hour > 0) {
          const recent = db.getDb().prepare(
            `SELECT COUNT(*) as c FROM workflow_executions WHERE workflow_id = ? AND triggered_at >= datetime('now', '-1 hour')`
          ).get(wf.id) as any;
          if (recent.c >= wf.rate_limit_per_hour) continue;
        }

        // Conditions
        const conditions: Condition[] = JSON.parse(wf.conditions_json || '[]');
        const data = payload.data || {};
        const allMatch = conditions.every(c => evaluateCondition(c, data));
        if (!allMatch) continue;

        // Actions
        const actions: Action[] = JSON.parse(wf.actions_json || '[]');
        await this.executeWorkflow(wf, payload, actions);
      } catch (err) {
        console.warn(`[WorkflowEngine] Workflow ${wf.id} error:`, err);
      }
    }
  }

  private async executeWorkflow(wf: WorkflowDefinition, payload: EventPayload, actions: Action[]) {
    const execId = uuid();
    const startedAt = Date.now();
    db.getDb().prepare(
      `INSERT INTO workflow_executions (id, workflow_id, status, payload_json) VALUES (?, ?, 'running', ?)`
    ).run(execId, wf.id, JSON.stringify(payload));

    let status = 'success';
    let errorMsg = '';
    try {
      for (const action of actions) {
        await this.executeAction(action, payload);
      }
    } catch (err: any) {
      status = 'failed';
      errorMsg = err?.message || 'unknown error';
    }

    const duration = Date.now() - startedAt;
    db.getDb().prepare(
      `UPDATE workflow_executions SET status = ?, completed_at = datetime('now'), error_message = ?, duration_ms = ? WHERE id = ?`
    ).run(status, errorMsg, duration, execId);
  }

  private async executeAction(action: Action, payload: EventPayload) {
    switch (action.type) {
      case 'log_audit':
        // No-op for now; integrate with audit_log table if needed
        break;
      case 'send_notification':
        // Insert a notification row
        try {
          db.getDb().prepare(
            `INSERT INTO notifications (id, company_id, type, message, entity_type, entity_id, read_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`
          ).run(
            uuid(),
            payload.companyId,
            action.config.notification_type || 'info',
            action.config.message || `Workflow triggered by ${payload.type}`,
            payload.entityType || '',
            payload.entityId || ''
          );
        } catch {}
        break;
      case 'webhook':
        // Stub — implement HTTP call if needed
        break;
      case 'trigger_macro':
        // Stub — implement macro replay
        break;
      default:
        // Unknown action types just log
        console.log(`[WorkflowEngine] Unknown action: ${action.type}`);
    }
  }
}

function evaluateCondition(cond: Condition, data: Record<string, any>): boolean {
  const fieldVal = data[cond.field];
  switch (cond.op) {
    case 'eq': return fieldVal === cond.value;
    case 'neq': return fieldVal !== cond.value;
    case 'gt': return Number(fieldVal) > Number(cond.value);
    case 'gte': return Number(fieldVal) >= Number(cond.value);
    case 'lt': return Number(fieldVal) < Number(cond.value);
    case 'lte': return Number(fieldVal) <= Number(cond.value);
    case 'contains': return String(fieldVal || '').includes(String(cond.value));
    case 'in': return Array.isArray(cond.value) && cond.value.includes(fieldVal);
    case 'exists': return fieldVal !== undefined && fieldVal !== null && fieldVal !== '';
    default: return false;
  }
}

export const workflowEngine = new WorkflowEngine();
```

```typescript
// src/main/services/SagaCoordinator.ts
// Multi-step operations with rollback support.

export interface SagaStep {
  name: string;
  forward: () => Promise<any>;
  rollback: (forwardResult?: any) => Promise<void>;
}

export class Saga {
  private steps: SagaStep[] = [];
  private completed: Array<{ step: SagaStep; result: any }> = [];

  add(step: SagaStep): this {
    this.steps.push(step);
    return this;
  }

  async run(): Promise<{ success: boolean; results: any[]; error?: string }> {
    const results: any[] = [];
    for (const step of this.steps) {
      try {
        const result = await step.forward();
        this.completed.push({ step, result });
        results.push(result);
      } catch (err: any) {
        // Rollback in reverse
        for (const c of this.completed.reverse()) {
          try { await c.step.rollback(c.result); } catch (rbErr) {
            console.warn(`[Saga] Rollback of ${c.step.name} failed:`, rbErr);
          }
        }
        return { success: false, results, error: err?.message || 'saga failed' };
      }
    }
    return { success: true, results };
  }
}
```

**Step 2: Start engine on boot**

In `src/main/ipc/index.ts`, after `bootstrapBuiltinCommands()`:

```typescript
import { workflowEngine } from '../services/WorkflowEngine';
// ...
workflowEngine.start();
```

**Step 3: Verify + Commit**

```bash
npx tsc --noEmit
git add src/main/services/WorkflowEngine.ts src/main/services/SagaCoordinator.ts src/main/ipc/index.ts
git commit -m "feat(advanced): WorkflowEngine + SagaCoordinator services"
```

---

### Task 9: Workflow IPC Handlers + Event Emission

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add workflow IPC handlers**

```typescript
ipcMain.handle('workflow:list', () => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(
    `SELECT * FROM workflow_definitions WHERE company_id = ? ORDER BY name`
  ).all(companyId);
});

ipcMain.handle('workflow:save', (_event, { id, name, description, trigger_type, trigger_config, conditions, actions, is_active, rate_limit_per_hour, requires_approval }: any) => {
  const companyId = db.getCurrentCompanyId();
  const dbI = db.getDb();
  if (id) {
    dbI.prepare(
      `UPDATE workflow_definitions SET name = ?, description = ?, trigger_type = ?, trigger_config_json = ?, conditions_json = ?, actions_json = ?, is_active = ?, rate_limit_per_hour = ?, requires_approval = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      name || '', description || '', trigger_type || 'event',
      JSON.stringify(trigger_config || {}),
      JSON.stringify(conditions || []),
      JSON.stringify(actions || []),
      is_active ? 1 : 0,
      rate_limit_per_hour || 0,
      requires_approval ? 1 : 0,
      id
    );
    scheduleAutoBackup();
    return { success: true, id };
  }
  const newId = uuid();
  dbI.prepare(
    `INSERT INTO workflow_definitions (id, company_id, name, description, trigger_type, trigger_config_json, conditions_json, actions_json, is_active, rate_limit_per_hour, requires_approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId, companyId, name || '', description || '', trigger_type || 'event',
    JSON.stringify(trigger_config || {}),
    JSON.stringify(conditions || []),
    JSON.stringify(actions || []),
    is_active ? 1 : 0,
    rate_limit_per_hour || 0,
    requires_approval ? 1 : 0
  );
  scheduleAutoBackup();
  return { success: true, id: newId };
});

ipcMain.handle('workflow:delete', (_event, { id }: { id: string }) => {
  db.getDb().prepare(`DELETE FROM workflow_definitions WHERE id = ?`).run(id);
  scheduleAutoBackup();
  return { success: true };
});

ipcMain.handle('workflow:executions', (_event, { workflowId, limit }: { workflowId?: string; limit?: number }) => {
  const dbI = db.getDb();
  if (workflowId) {
    return dbI.prepare(
      `SELECT * FROM workflow_executions WHERE workflow_id = ? ORDER BY triggered_at DESC LIMIT ?`
    ).all(workflowId, limit || 50);
  }
  const companyId = db.getCurrentCompanyId();
  return dbI.prepare(
    `SELECT we.* FROM workflow_executions we
     JOIN workflow_definitions wd ON wd.id = we.workflow_id
     WHERE wd.company_id = ? ORDER BY we.triggered_at DESC LIMIT ?`
  ).all(companyId, limit || 50);
});

ipcMain.handle('workflow:event-log', (_event, { limit }: { limit?: number }) => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(
    `SELECT * FROM workflow_event_log WHERE company_id = ? ORDER BY occurred_at DESC LIMIT ?`
  ).all(companyId, limit || 100);
});

ipcMain.handle('workflow:emit-event', async (_event, { type, entityType, entityId, data }: any) => {
  const companyId = db.getCurrentCompanyId();
  await eventBus.emit({ type, companyId: companyId || '', entityType, entityId, data });
  return { success: true };
});
```

**Step 2: Add API methods**

```typescript
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
```

**Step 3: Wire event emission to existing mutating handlers**

Find these handlers in `src/main/ipc/index.ts` and add `eventBus.emit(...)` after the SQL succeeds:

- `invoice:save` → emit `invoice.created` or `invoice.updated`
- `invoice:record-payment` → emit `payment.received` and `invoice.paid` (if fully paid)
- `expense:save` → emit `expense.created`
- `db:create` (for `clients`, `vendors`) → emit `client.created`/`vendor.created`
- Quote save → emit `quote.created`
- Debt creation → emit `debt.created`

Pattern:
```typescript
import { eventBus } from '../services/EventBus';
// ...inside handler after success:
const companyId = db.getCurrentCompanyId();
if (companyId) {
  await eventBus.emit({
    type: 'invoice.created',
    companyId,
    entityType: 'invoice',
    entityId: result.id,
    data: { total: invoiceData.total, client_id: invoiceData.client_id },
  });
}
```

**Step 4: Verify + Commit**

```bash
npx tsc --noEmit
git add src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat(advanced): workflow IPC handlers + event emission on key mutations"
```

---

## Phase 5: Workflow Builder UI

Independently shippable: visual builder in Automations module.

### Task 10: WorkflowList + WorkflowBuilder + WorkflowExecutionLog

**Files:**
- Create: `src/renderer/modules/automations/WorkflowList.tsx`
- Create: `src/renderer/modules/automations/WorkflowBuilder.tsx`
- Create: `src/renderer/modules/automations/WorkflowExecutionLog.tsx`
- Modify: `src/renderer/modules/automations/index.tsx` (add tabs)

**Step 1: WorkflowList.tsx (~300 lines)**

Standard list view: Name, Trigger, Active toggle, Actions count, Last Run, Edit/Delete buttons. Loads via `api.listWorkflows()`.

**Step 2: WorkflowBuilder.tsx (~600 lines)**

Form with sections:
- Basic Info: Name, Description, Active toggle
- Trigger: Type dropdown (event/schedule), Event Type dropdown (the EventType union)
- Conditions: Add/remove rows of `field op value` rules
- Actions: Add/remove action rows (notification, log, webhook URL, trigger macro)
- Save button calls `api.saveWorkflow(...)`

**Step 3: WorkflowExecutionLog.tsx (~250 lines)**

Table of recent executions: Workflow Name, Triggered At, Status badge, Duration, Error Message. Auto-refresh every 30s.

**Step 4: Wire into Automations module**

In `src/renderer/modules/automations/index.tsx`, add 3 tabs: Existing, **Workflows** (new), **Event Log** (new). Each renders the corresponding component.

**Step 5: Verify + Commit**

```bash
npx tsc --noEmit
git add src/renderer/modules/automations/
git commit -m "feat(advanced): workflow builder UI + execution log + event log"
```

---

## Phase 6: IntelligenceService + Algorithms

Independently shippable: provides inference infrastructure.

### Task 11: Statistical Algorithms

**Files:**
- Create: `src/main/services/algorithms/anomalyDetection.ts`
- Create: `src/main/services/algorithms/cashFlowForecast.ts`
- Create: `src/main/services/algorithms/patternDetection.ts`

**Step 1: anomalyDetection.ts**

Z-score based detection on a numeric series:

```typescript
export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number;
  mean: number;
  stdDev: number;
}

export function detectAnomaly(value: number, history: number[], threshold = 2): AnomalyResult {
  if (history.length < 5) return { isAnomaly: false, zScore: 0, mean: value, stdDev: 0 };
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev > 0 ? (value - mean) / stdDev : 0;
  return { isAnomaly: Math.abs(zScore) > threshold, zScore, mean, stdDev };
}

export function detectDuplicates(records: Array<{ id: string; amount: number; date: string; entity: string }>): string[][] {
  // Group by (amount, entity) within ±3 days
  const groups: Record<string, typeof records> = {};
  for (const r of records) {
    const key = `${r.amount.toFixed(2)}|${r.entity}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const dupes: string[][] = [];
  for (const grp of Object.values(groups)) {
    if (grp.length < 2) continue;
    grp.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < grp.length - 1; i++) {
      const dDays = Math.abs(
        (new Date(grp[i + 1].date).getTime() - new Date(grp[i].date).getTime()) / 86_400_000
      );
      if (dDays <= 3) dupes.push([grp[i].id, grp[i + 1].id]);
    }
  }
  return dupes;
}
```

**Step 2: cashFlowForecast.ts**

Linear regression on past cash position:

```typescript
export interface ForecastResult {
  predicted: number;
  confidenceLow: number;
  confidenceHigh: number;
  slope: number;
  intercept: number;
}

export function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number; stdError: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0, stdError: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  // Std error of estimate
  const residuals = points.map(p => p.y - (slope * p.x + intercept));
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const stdError = Math.sqrt(ssRes / Math.max(1, n - 2));
  return { slope, intercept, stdError };
}

export function forecastValue(points: Array<{ x: number; y: number }>, futureX: number, confidence = 1.96): ForecastResult {
  const { slope, intercept, stdError } = linearRegression(points);
  const predicted = slope * futureX + intercept;
  const margin = confidence * stdError;
  return { predicted, confidenceLow: predicted - margin, confidenceHigh: predicted + margin, slope, intercept };
}
```

**Step 3: patternDetection.ts**

```typescript
export interface VendorPattern {
  vendorId: string;
  avgAmount: number;
  dayOfMonthPattern: number[]; // 0-31, frequency map
  intervalDays: number;
}

export function detectVendorPattern(history: Array<{ vendorId: string; amount: number; date: string }>): VendorPattern[] {
  const byVendor: Record<string, Array<{ amount: number; date: string }>> = {};
  for (const r of history) {
    if (!byVendor[r.vendorId]) byVendor[r.vendorId] = [];
    byVendor[r.vendorId].push({ amount: r.amount, date: r.date });
  }
  return Object.entries(byVendor).map(([vid, txns]) => {
    const avgAmount = txns.reduce((s, t) => s + t.amount, 0) / txns.length;
    const dayPattern = new Array(32).fill(0);
    for (const t of txns) dayPattern[new Date(t.date).getDate()]++;
    txns.sort((a, b) => a.date.localeCompare(b.date));
    let intervalSum = 0;
    for (let i = 1; i < txns.length; i++) {
      intervalSum += (new Date(txns[i].date).getTime() - new Date(txns[i - 1].date).getTime()) / 86_400_000;
    }
    const intervalDays = txns.length > 1 ? intervalSum / (txns.length - 1) : 0;
    return { vendorId: vid, avgAmount, dayOfMonthPattern: dayPattern, intervalDays };
  });
}

export function suggestCategoryForVendor(vendorId: string, history: Array<{ vendorId: string; categoryId: string }>): string | null {
  const counts: Record<string, number> = {};
  for (const r of history) {
    if (r.vendorId === vendorId && r.categoryId) {
      counts[r.categoryId] = (counts[r.categoryId] || 0) + 1;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}
```

**Step 4: Verify + Commit**

```bash
npx tsc --noEmit
git add src/main/services/algorithms/
git commit -m "feat(advanced): statistical algorithms (anomaly, forecast, pattern detection)"
```

---

### Task 12: IntelligenceService + IPC

**Files:**
- Create: `src/main/services/IntelligenceService.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: IntelligenceService**

```typescript
// src/main/services/IntelligenceService.ts
import { v4 as uuid } from 'uuid';
import * as db from '../database';
import { detectAnomaly, detectDuplicates } from './algorithms/anomalyDetection';
import { forecastValue } from './algorithms/cashFlowForecast';
import { detectVendorPattern, suggestCategoryForVendor } from './algorithms/patternDetection';

class IntelligenceService {
  /**
   * Suggest expense category for a new expense based on vendor history.
   */
  suggestCategory(companyId: string, vendorId: string): string | null {
    try {
      const rows = db.getDb().prepare(
        `SELECT vendor_id, category_id FROM expenses WHERE company_id = ? AND vendor_id = ?`
      ).all(companyId, vendorId) as Array<{ vendor_id: string; category_id: string }>;
      return suggestCategoryForVendor(
        vendorId,
        rows.map(r => ({ vendorId: r.vendor_id, categoryId: r.category_id }))
      );
    } catch { return null; }
  }

  /**
   * Detect duplicate invoices (same amount + client within ±3 days).
   */
  detectDuplicateInvoices(companyId: string): string[][] {
    try {
      const rows = db.getDb().prepare(
        `SELECT id, total as amount, issue_date as date, client_id as entity FROM invoices WHERE company_id = ?`
      ).all(companyId) as Array<{ id: string; amount: number; date: string; entity: string }>;
      return detectDuplicates(rows);
    } catch { return []; }
  }

  /**
   * Anomaly check on a payroll amount.
   */
  detectPayrollAnomaly(employeeId: string, currentGross: number): { isAnomaly: boolean; zScore: number; mean: number } {
    try {
      const rows = db.getDb().prepare(
        `SELECT gross_pay FROM pay_stubs WHERE employee_id = ? ORDER BY created_at DESC LIMIT 12`
      ).all(employeeId) as Array<{ gross_pay: number }>;
      const history = rows.map(r => r.gross_pay).filter(v => v > 0);
      const r = detectAnomaly(currentGross, history);
      return { isAnomaly: r.isAnomaly, zScore: r.zScore, mean: r.mean };
    } catch { return { isAnomaly: false, zScore: 0, mean: 0 }; }
  }

  /**
   * Cash flow forecast for the next N days.
   */
  forecastCashFlow(companyId: string, daysAhead: number): { predicted: number; low: number; high: number } {
    try {
      const rows = db.getDb().prepare(
        `SELECT date(date) as d, SUM(CASE WHEN type='credit' THEN amount ELSE -amount END) as net
         FROM bank_transactions WHERE company_id = ? GROUP BY date(date) ORDER BY date(date) DESC LIMIT 90`
      ).all(companyId) as Array<{ d: string; net: number }>;
      if (rows.length < 5) return { predicted: 0, low: 0, high: 0 };
      // Build cumulative
      let cum = 0;
      const points = rows.reverse().map((r, i) => { cum += r.net; return { x: i, y: cum }; });
      const f = forecastValue(points, points.length + daysAhead);
      return { predicted: f.predicted, low: f.confidenceLow, high: f.confidenceHigh };
    } catch { return { predicted: 0, low: 0, high: 0 }; }
  }

  /**
   * Predict payment date for an outstanding invoice based on client's history.
   */
  predictPaymentDate(invoiceId: string): { predictedDate: string | null; avgDaysToPay: number } {
    try {
      const inv = db.getDb().prepare(
        `SELECT client_id, issue_date FROM invoices WHERE id = ?`
      ).get(invoiceId) as any;
      if (!inv) return { predictedDate: null, avgDaysToPay: 0 };
      const rows = db.getDb().prepare(
        `SELECT julianday(p.date) - julianday(i.issue_date) as days
         FROM payments p JOIN invoices i ON p.invoice_id = i.id
         WHERE i.client_id = ? AND p.amount >= i.total LIMIT 20`
      ).all(inv.client_id) as Array<{ days: number }>;
      if (rows.length === 0) return { predictedDate: null, avgDaysToPay: 0 };
      const avg = rows.reduce((s, r) => s + r.days, 0) / rows.length;
      const predicted = new Date(new Date(inv.issue_date).getTime() + avg * 86_400_000);
      return { predictedDate: predicted.toISOString().slice(0, 10), avgDaysToPay: avg };
    } catch { return { predictedDate: null, avgDaysToPay: 0 }; }
  }

  /**
   * Refresh pattern cache nightly (or on-demand).
   */
  refreshPatterns(companyId: string): void {
    try {
      const rows = db.getDb().prepare(
        `SELECT vendor_id, amount, date FROM expenses WHERE company_id = ? AND date >= date('now', '-180 days')`
      ).all(companyId) as Array<{ vendor_id: string; amount: number; date: string }>;
      const patterns = detectVendorPattern(
        rows.map(r => ({ vendorId: r.vendor_id, amount: r.amount, date: r.date }))
      );
      const dbI = db.getDb();
      const now = new Date().toISOString();
      for (const p of patterns) {
        dbI.prepare(
          `INSERT OR REPLACE INTO pattern_cache (id, company_id, pattern_type, entity_type, entity_id, pattern_data_json, confidence, sample_size, last_computed_at)
           VALUES ((SELECT id FROM pattern_cache WHERE company_id = ? AND pattern_type = ? AND entity_id = ?) , ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          companyId, 'vendor_payment', p.vendorId,
          companyId, 'vendor_payment', 'vendor', p.vendorId,
          JSON.stringify(p),
          0.7, // simplistic confidence
          rows.filter(r => r.vendor_id === p.vendorId).length,
          now
        );
      }
    } catch (err) {
      console.warn('[IntelligenceService] refreshPatterns failed:', err);
    }
  }
}

export const intelligenceService = new IntelligenceService();
```

**Step 2: IPC handlers + API**

```typescript
ipcMain.handle('intel:suggest-category', (_event, { vendor_id }: { vendor_id: string }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId || !vendor_id) return null;
  const { intelligenceService } = require('../services/IntelligenceService');
  return intelligenceService.suggestCategory(companyId, vendor_id);
});

ipcMain.handle('intel:duplicate-invoices', () => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return [];
  const { intelligenceService } = require('../services/IntelligenceService');
  return intelligenceService.detectDuplicateInvoices(companyId);
});

ipcMain.handle('intel:payroll-anomaly', (_event, { employee_id, gross }: any) => {
  const { intelligenceService } = require('../services/IntelligenceService');
  return intelligenceService.detectPayrollAnomaly(employee_id, gross);
});

ipcMain.handle('intel:cash-forecast', (_event, { days_ahead }: { days_ahead: number }) => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return null;
  const { intelligenceService } = require('../services/IntelligenceService');
  return intelligenceService.forecastCashFlow(companyId, days_ahead || 30);
});

ipcMain.handle('intel:predict-payment', (_event, { invoice_id }: { invoice_id: string }) => {
  const { intelligenceService } = require('../services/IntelligenceService');
  return intelligenceService.predictPaymentDate(invoice_id);
});

ipcMain.handle('intel:refresh-patterns', () => {
  const companyId = db.getCurrentCompanyId();
  if (!companyId) return { success: false };
  const { intelligenceService } = require('../services/IntelligenceService');
  intelligenceService.refreshPatterns(companyId);
  return { success: true };
});

ipcMain.handle('intel:list-anomalies', () => {
  const companyId = db.getCurrentCompanyId();
  return db.getDb().prepare(
    `SELECT * FROM anomaly_log WHERE company_id = ? AND resolved = 0 ORDER BY detected_at DESC LIMIT 100`
  ).all(companyId);
});
```

API methods:
```typescript
intelSuggestCategory: (vendor_id: string) => window.electronAPI.invoke('intel:suggest-category', { vendor_id }),
intelDuplicateInvoices: () => window.electronAPI.invoke('intel:duplicate-invoices'),
intelPayrollAnomaly: (employee_id: string, gross: number) => window.electronAPI.invoke('intel:payroll-anomaly', { employee_id, gross }),
intelCashForecast: (days_ahead: number) => window.electronAPI.invoke('intel:cash-forecast', { days_ahead }),
intelPredictPayment: (invoice_id: string) => window.electronAPI.invoke('intel:predict-payment', { invoice_id }),
intelRefreshPatterns: () => window.electronAPI.invoke('intel:refresh-patterns'),
intelListAnomalies: () => window.electronAPI.invoke('intel:list-anomalies'),
```

**Step 3: Verify + Commit**

```bash
npx tsc --noEmit
git add src/main/services/IntelligenceService.ts src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat(advanced): IntelligenceService with 7 prediction methods + IPC"
```

---

## Phase 7: Smart Defaults + Anomaly Detection in Forms

Independently shippable: hooks intelligence into existing forms.

### Task 13: Smart Defaults Hook + AnomalyBanner

**Files:**
- Create: `src/renderer/components/SmartDefaultsHook.ts`
- Create: `src/renderer/components/AnomalyBanner.tsx`
- Modify: `src/renderer/modules/expenses/ExpenseForm.tsx` (apply suggested category)
- Modify: `src/renderer/modules/payroll/PayrollRunner.tsx` (anomaly banner per employee)

**Step 1: SmartDefaultsHook.ts**

```typescript
import { useEffect, useState } from 'react';
import api from '../lib/api';

export function useSuggestedCategory(vendorId?: string) {
  const [suggested, setSuggested] = useState<string | null>(null);
  useEffect(() => {
    if (!vendorId) { setSuggested(null); return; }
    api.intelSuggestCategory(vendorId).then((id: string | null) => setSuggested(id)).catch(() => setSuggested(null));
  }, [vendorId]);
  return suggested;
}
```

**Step 2: AnomalyBanner.tsx**

```typescript
import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface AnomalyBannerProps {
  message: string;
  severity?: 'low' | 'medium' | 'high';
  onDismiss?: () => void;
}

export const AnomalyBanner: React.FC<AnomalyBannerProps> = ({ message, severity = 'medium', onDismiss }) => {
  const colorMap = {
    low: 'bg-bg-tertiary border-border-primary text-text-secondary',
    medium: 'bg-accent-warning/10 border-accent-warning/30 text-accent-warning',
    high: 'bg-accent-expense/10 border-accent-expense/30 text-accent-expense',
  };
  return (
    <div className={`flex items-start gap-2 p-3 border ${colorMap[severity]}`} style={{ borderRadius: '6px' }}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span className="text-xs flex-1">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-[10px] underline hover:no-underline">Dismiss</button>
      )}
    </div>
  );
};

export default AnomalyBanner;
```

**Step 3: Wire into ExpenseForm**

In `ExpenseForm.tsx`, when vendor changes:
```typescript
const suggested = useSuggestedCategory(form.vendor_id);
useEffect(() => {
  if (suggested && !form.category_id) {
    setForm(f => ({ ...f, category_id: suggested }));
  }
}, [suggested]);
```

**Step 4: Wire into PayrollRunner**

For each employee row, after computing gross, call `api.intelPayrollAnomaly(emp.id, gross)`. If `isAnomaly`, render an AnomalyBanner above the row.

**Step 5: Verify + Commit**

```bash
npx tsc --noEmit
git add src/renderer/components/SmartDefaultsHook.ts src/renderer/components/AnomalyBanner.tsx src/renderer/modules/expenses/ExpenseForm.tsx src/renderer/modules/payroll/PayrollRunner.tsx
git commit -m "feat(advanced): smart defaults + anomaly banners in forms"
```

---

## Phase 8: Predictive Dashboard Insights

Independently shippable: surfaces insights on the main dashboard.

### Task 14: InsightsPanel Component

**Files:**
- Create: `src/renderer/components/InsightsPanel.tsx`
- Modify: `src/renderer/modules/dashboard/Dashboard.tsx` (add panel)

**Step 1: InsightsPanel.tsx**

```typescript
import React, { useEffect, useState } from 'react';
import { Sparkles, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';
import api from '../lib/api';
import { formatCurrency } from '../lib/format';

interface Insight {
  type: 'forecast' | 'anomaly' | 'duplicate' | 'pattern' | 'risk';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}

const InsightsPanel: React.FC = () => {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInsights();
  }, []);

  const loadInsights = async () => {
    setLoading(true);
    const list: Insight[] = [];
    try {
      // Cash flow forecast
      const cf = await api.intelCashForecast(30);
      if (cf?.predicted < 0) {
        list.push({
          type: 'forecast',
          severity: 'critical',
          title: 'Cash flow forecast: Negative in 30 days',
          detail: `Projected cash position: ${formatCurrency(cf.predicted)} (range ${formatCurrency(cf.low)} – ${formatCurrency(cf.high)})`,
        });
      } else if (cf?.predicted) {
        list.push({
          type: 'forecast',
          severity: 'info',
          title: '30-day cash flow forecast',
          detail: `Projected: ${formatCurrency(cf.predicted)}`,
        });
      }

      // Duplicate invoices
      const dupes = await api.intelDuplicateInvoices();
      if (Array.isArray(dupes) && dupes.length > 0) {
        list.push({
          type: 'duplicate',
          severity: 'warning',
          title: `${dupes.length} potential duplicate invoice(s)`,
          detail: 'Same amount and client within 3 days. Review to confirm.',
        });
      }

      // Unresolved anomalies
      const anoms = await api.intelListAnomalies();
      if (Array.isArray(anoms) && anoms.length > 0) {
        list.push({
          type: 'anomaly',
          severity: 'warning',
          title: `${anoms.length} unresolved anomaly alert(s)`,
          detail: 'Transactions deviating from normal patterns.',
        });
      }
    } catch (err) {
      console.warn('Failed to load insights:', err);
    }
    setInsights(list);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="block-card p-4" style={{ borderRadius: '6px' }}>
        <div className="text-xs text-text-muted">Loading insights...</div>
      </div>
    );
  }
  if (insights.length === 0) {
    return (
      <div className="block-card p-4" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <CheckCircle size={14} className="text-accent-income" />
          No insights at the moment. Everything looks normal.
        </div>
      </div>
    );
  }

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center gap-2">
        <Sparkles size={14} className="text-accent-blue" />
        <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">AI Insights</h3>
      </div>
      <div className="divide-y divide-border-primary">
        {insights.map((insight, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-start gap-2">
              {insight.severity === 'critical' && <AlertTriangle size={14} className="text-accent-expense shrink-0 mt-0.5" />}
              {insight.severity === 'warning' && <AlertTriangle size={14} className="text-accent-warning shrink-0 mt-0.5" />}
              {insight.severity === 'info' && <TrendingUp size={14} className="text-accent-blue shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary">{insight.title}</div>
                <div className="text-xs text-text-muted mt-0.5">{insight.detail}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InsightsPanel;
```

**Step 2: Mount in Dashboard**

In `src/renderer/modules/dashboard/Dashboard.tsx`, add:
```jsx
import InsightsPanel from '../../components/InsightsPanel';
// ... in JSX, near the top of the dashboard:
<InsightsPanel />
```

**Step 3: Verify + Commit**

```bash
npx tsc --noEmit
git add src/renderer/components/InsightsPanel.tsx src/renderer/modules/dashboard/Dashboard.tsx
git commit -m "feat(advanced): InsightsPanel on dashboard with forecast + anomaly + duplicate detection"
```

---

## Final Verification

### Task 15: System integration test

**Step 1: Type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

**Step 2: Build**

```bash
npm run build
```

Expected: clean build.

**Step 3: Smoke test checklist**

Manual run-through:
- [ ] Cmd+K opens the command palette
- [ ] Typing "inv" shows invoice-related commands
- [ ] Typing "$45 lunch with john" shows quick expense intent
- [ ] Selecting a command navigates to correct module
- [ ] Settings > Macros card visible
- [ ] Automations module shows Workflows tab
- [ ] Creating a workflow definition saves successfully
- [ ] Creating an invoice fires `invoice.created` event (visible in event log)
- [ ] Dashboard shows InsightsPanel
- [ ] Cash flow forecast appears (with sufficient data)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(advanced): final integration verification"
```

---

## Implementation Order Summary

| # | Phase | Tasks | Lines | Visible Outcome |
|---|-------|-------|-------|-----------------|
| 1 | Foundation | 1-4 | ~600 | DB tables + EventBus + CommandRegistry + IPC |
| 2 | Command Palette | 5-6 | ~1200 | Cmd+K palette UI |
| 3 | Macros + Shortcuts | 7 | ~500 | Settings card + recorder modal |
| 4 | Workflow Engine | 8-9 | ~800 | Service + IPC + event emission |
| 5 | Workflow Builder | 10 | ~1500 | Automations module enhancement |
| 6 | Intelligence Algos | 11-12 | ~800 | Service + 7 IPC methods |
| 7 | Smart Defaults | 13 | ~600 | Form integration |
| 8 | Insights Panel | 14 | ~600 | Dashboard widget |

**Total estimate:** ~6,600 new lines, 18 new files, 9 new tables, ~30 modified files.

**Each phase is independently shippable** — if you stop after Phase 1, you have infrastructure for future use. After Phase 2, you have a working command palette. After Phase 4, workflows execute (without UI to build them). After Phase 5, users can build workflows visually. Phases 6-8 layer in intelligence.

---

**Plan complete and saved to `docs/plans/2026-04-28-advanced-system-plan.md`. Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
