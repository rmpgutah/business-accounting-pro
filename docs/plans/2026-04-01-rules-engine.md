# Rules Engine, Information Placement & Data Creation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified rules engine covering pricing, tax, approval, and alert rule types; add a Rules module UI with 6 tabs; add contextual information panels inside forms; add list summary bars; and add Cmd+K quick-create, clone record, create-from-time, and CSV import wizard.

**Architecture:** A single `evaluateRules(category, context)` function in `src/main/rules/engine.ts` handles all rule types. On-save rules (pricing, tax) are called from IPC handlers before writing to SQLite. Scheduled rules (alert, approval) run from the existing nightly cron. The renderer has one Rules module with 6 tabs, migrating BankRules and Automations into it.

**Tech Stack:** TypeScript, better-sqlite3, React, Tailwind CSS (existing patterns throughout)

---

## Task 1: Schema — rules and approval_queue tables

**Files:**
- Modify: `src/main/database/schema.sql`

**Step 1: Append two new tables at the end of schema.sql**

```sql
-- Rules Engine
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  category TEXT NOT NULL CHECK(category IN ('bank','automation','pricing','tax','approval','alert')),
  name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  trigger TEXT NOT NULL CHECK(trigger IN ('on_save','scheduled','manual')),
  conditions TEXT DEFAULT '[]',
  actions TEXT DEFAULT '[]',
  applied_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  last_alerted_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_company_category ON rules(company_id, category, is_active);

CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  record_type TEXT NOT NULL CHECK(record_type IN ('invoice','expense','bill')),
  record_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_approval_queue_company ON approval_queue(company_id, status);
```

**Step 2: Add rules_applied column to invoices and expenses tables**

In the invoices CREATE TABLE, add before closing paren:
```sql
  rules_applied TEXT DEFAULT '[]',
```

Same for expenses table.

**Step 3: Build to verify schema copied cleanly**
```bash
cd "/Users/rmpgutah/Business Accounting Pro"
npm run build:main 2>&1 | tail -5
```
Expected: clean

**Step 4: Commit**
```bash
git add src/main/database/schema.sql
git commit -m "feat: add rules + approval_queue tables to schema"
```

---

## Task 2: Rules Engine — conditions.ts

**Files:**
- Create: `src/main/rules/conditions.ts`

**Step 1: Create the file**

```typescript
// src/main/rules/conditions.ts
export interface Condition {
  field: string;
  op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'starts_with' | 'ends_with' | 'in' | 'regex' | 'between';
  value: unknown;
}

export function evaluateCondition(condition: Condition, record: Record<string, unknown>): boolean {
  const raw = record[condition.field];
  const { op, value } = condition;

  switch (op) {
    case 'eq':          return raw == value;
    case 'neq':         return raw != value;
    case 'lt':          return Number(raw) < Number(value);
    case 'lte':         return Number(raw) <= Number(value);
    case 'gt':          return Number(raw) > Number(value);
    case 'gte':         return Number(raw) >= Number(value);
    case 'contains':    return String(raw ?? '').toLowerCase().includes(String(value).toLowerCase());
    case 'starts_with': return String(raw ?? '').toLowerCase().startsWith(String(value).toLowerCase());
    case 'ends_with':   return String(raw ?? '').toLowerCase().endsWith(String(value).toLowerCase());
    case 'in':          return Array.isArray(value) && value.includes(raw);
    case 'regex':       return new RegExp(String(value), 'i').test(String(raw ?? ''));
    case 'between': {
      const [min, max] = value as [number, number];
      const n = Number(raw);
      return n >= min && n <= max;
    }
    default: return false;
  }
}

// Returns true if ALL conditions pass (AND logic)
export function evaluateConditions(conditions: Condition[], record: Record<string, unknown>): boolean {
  if (conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, record));
}
```

**Step 2: Build**
```bash
npm run build:main 2>&1 | tail -5
```

**Step 3: Commit**
```bash
git add src/main/rules/conditions.ts
git commit -m "feat: rules engine condition evaluator"
```

---

## Task 3: Rules Engine — actions.ts

**Files:**
- Create: `src/main/rules/actions.ts`

**Step 1: Create the file**

```typescript
// src/main/rules/actions.ts
import { v4 as uuid } from 'uuid';
import type { Database } from 'better-sqlite3';

export interface Action {
  type: 'discount' | 'markup' | 'set_unit_price' | 'set_tax_rate' | 'set_account' |
        'flag_approval' | 'notify' | 'send_email' | 'set_description';
  method?: 'percent' | 'fixed';
  value?: unknown;
  message?: string;
  record_type?: string;
}

export interface ActionResult {
  type: string;
  applied: boolean;
  detail?: string;
  patch?: Record<string, unknown>;
}

let _notifyFn: ((msg: string) => void) | null = null;
export function setNotifyFn(fn: (msg: string) => void): void { _notifyFn = fn; }

export function executeAction(
  action: Action,
  record: Record<string, unknown>,
  context: { db: Database; company_id: string; rule_id: string; rule_name: string }
): ActionResult {
  switch (action.type) {
    case 'discount': {
      const total = Number(record.total ?? record.amount ?? 0);
      const discount = action.method === 'percent'
        ? total * (Number(action.value) / 100)
        : Number(action.value);
      return { type: 'discount', applied: true, detail: `Discounted by ${action.value}${action.method === 'percent' ? '%' : ' (fixed)'}`, patch: { discount_amount: discount } };
    }
    case 'markup': {
      const price = Number(record.unit_price ?? record.amount ?? 0);
      const markup = action.method === 'percent'
        ? price * (Number(action.value) / 100)
        : Number(action.value);
      return { type: 'markup', applied: true, patch: { unit_price: price + markup } };
    }
    case 'set_unit_price':
      return { type: 'set_unit_price', applied: true, patch: { unit_price: Number(action.value) } };
    case 'set_tax_rate':
      return { type: 'set_tax_rate', applied: true, patch: { tax_rate: Number(action.value) } };
    case 'set_account':
      return { type: 'set_account', applied: true, patch: { account_id: String(action.value) } };
    case 'set_description':
      return { type: 'set_description', applied: true, patch: { description: String(action.value) } };
    case 'flag_approval': {
      context.db.prepare(`
        INSERT OR IGNORE INTO approval_queue (id, company_id, record_type, record_id, rule_id, rule_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuid(), context.company_id, String(action.record_type ?? record._type ?? 'invoice'), String(record.id), context.rule_id, context.rule_name);
      return { type: 'flag_approval', applied: true, detail: `Flagged for approval: ${context.rule_name}` };
    }
    case 'notify': {
      const msg = String(action.message ?? 'Rule triggered');
      if (_notifyFn) _notifyFn(msg);
      return { type: 'notify', applied: true, detail: msg };
    }
    default:
      return { type: action.type, applied: false, detail: 'Unknown action type' };
  }
}
```

**Step 2: Build**
```bash
npm run build:main 2>&1 | tail -5
```

**Step 3: Commit**
```bash
git add src/main/rules/actions.ts
git commit -m "feat: rules engine action executor"
```

---

## Task 4: Rules Engine — engine.ts + index.ts

**Files:**
- Create: `src/main/rules/engine.ts`
- Create: `src/main/rules/index.ts`

**Step 1: Create engine.ts**

```typescript
// src/main/rules/engine.ts
import type { Database } from 'better-sqlite3';
import { evaluateConditions, type Condition } from './conditions';
import { executeAction, type Action, type ActionResult } from './actions';

const FIRST_MATCH_CATEGORIES = new Set(['pricing', 'tax', 'bank']);

export interface RuleContext {
  category: 'pricing' | 'tax' | 'approval' | 'alert' | 'bank' | 'automation';
  record: Record<string, unknown>;
  company_id: string;
  db: Database;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  actions: ActionResult[];
}

export function evaluateRules(ctx: RuleContext): RuleResult[] {
  const { category, record, company_id, db } = ctx;
  const rows = db.prepare(`
    SELECT id, name, conditions, actions
    FROM rules
    WHERE company_id = ? AND category = ? AND is_active = 1
    ORDER BY priority ASC
  `).all(company_id, category) as Array<{ id: string; name: string; conditions: string; actions: string }>;

  const results: RuleResult[] = [];
  const firstMatch = FIRST_MATCH_CATEGORIES.has(category);

  for (const row of rows) {
    let conditions: Condition[] = [];
    let actions: Action[] = [];
    try {
      conditions = JSON.parse(row.conditions ?? '[]');
      actions = JSON.parse(row.actions ?? '[]');
    } catch { continue; }

    const matched = evaluateConditions(conditions, record);
    if (!matched) {
      results.push({ ruleId: row.id, ruleName: row.name, matched: false, actions: [] });
      continue;
    }

    const actionResults = actions.map(a =>
      executeAction(a, record, { db, company_id, rule_id: row.id, rule_name: row.name })
    );

    db.prepare(`UPDATE rules SET applied_count = applied_count + 1, last_run_at = datetime('now') WHERE id = ?`).run(row.id);
    results.push({ ruleId: row.id, ruleName: row.name, matched: true, actions: actionResults });
    if (firstMatch) break;
  }

  return results;
}

export function mergePatches(results: RuleResult[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const result of results) {
    if (!result.matched) continue;
    for (const action of result.actions) {
      if (action.patch) Object.assign(patch, action.patch);
    }
  }
  return patch;
}

export function rulesAppliedSummary(results: RuleResult[]): string {
  return JSON.stringify(
    results.filter(r => r.matched).map(r => ({ id: r.ruleId, name: r.ruleName }))
  );
}
```

**Step 2: Create index.ts**

```typescript
// src/main/rules/index.ts
export { evaluateRules, mergePatches, rulesAppliedSummary } from './engine';
export { setNotifyFn } from './actions';
```

**Step 3: Build**
```bash
npm run build:main 2>&1 | tail -5
```

**Step 4: Commit**
```bash
git add src/main/rules/
git commit -m "feat: rules engine evaluateRules core"
```

---

## Task 5: IPC Handlers — rules CRUD + approval queue

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Read ipc/index.ts fully first, then append these handlers before the closing brace of registerIpcHandlers**

```typescript
  // Rules Engine
  ipcMain.handle('rules:list', (_event, { company_id, category }: { company_id: string; category?: string }) => {
    let sql = `SELECT * FROM rules WHERE company_id = ?`;
    const params: unknown[] = [company_id];
    if (category) { sql += ` AND category = ?`; params.push(category); }
    sql += ` ORDER BY priority ASC`;
    return db.getDb().prepare(sql).all(...params);
  });

  ipcMain.handle('rules:create', (_event, data: Record<string, unknown>) => {
    const id = uuid();
    const row = { id, ...data, created_at: new Date().toISOString() };
    db.getDb().prepare(`
      INSERT INTO rules (id, company_id, category, name, priority, is_active, trigger, conditions, actions, created_at)
      VALUES (@id, @company_id, @category, @name, @priority, @is_active, @trigger, @conditions, @actions, @created_at)
    `).run(row);
    return { id };
  });

  ipcMain.handle('rules:update', (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
    const sets = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
    db.getDb().prepare(`UPDATE rules SET ${sets} WHERE id = @id`).run({ ...data, id });
    return { ok: true };
  });

  ipcMain.handle('rules:delete', (_event, id: string) => {
    db.getDb().prepare(`DELETE FROM rules WHERE id = ?`).run(id);
    return { ok: true };
  });

  ipcMain.handle('approval:list', (_event, { company_id, status }: { company_id: string; status?: string }) => {
    let sql = `SELECT aq.*, r.category FROM approval_queue aq LEFT JOIN rules r ON aq.rule_id = r.id WHERE aq.company_id = ?`;
    const params: unknown[] = [company_id];
    if (status) { sql += ` AND aq.status = ?`; params.push(status); }
    sql += ` ORDER BY aq.created_at DESC`;
    return db.getDb().prepare(sql).all(...params);
  });

  ipcMain.handle('approval:resolve', (_event, { id, status, notes }: { id: string; status: 'approved' | 'rejected'; notes?: string }) => {
    db.getDb().prepare(`UPDATE approval_queue SET status = ?, notes = ?, resolved_at = datetime('now') WHERE id = ?`).run(status, notes ?? null, id);
    return { ok: true };
  });

  ipcMain.handle('approval:pending-count', (_event, company_id: string) => {
    const row = db.getDb().prepare(`SELECT COUNT(*) as count FROM approval_queue WHERE company_id = ? AND status = 'pending'`).get(company_id) as { count: number };
    return row.count;
  });

  ipcMain.handle('record:clone', (_event, { table, id }: { table: string; id: string }) => {
    const original = db.getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!original) return { error: 'Not found' };
    const newId = uuid();
    const clone: Record<string, unknown> = { ...original, id: newId, created_at: new Date().toISOString(), status: 'draft', rules_applied: '[]' };
    if (table === 'invoices') {
      delete clone.invoice_number;
      clone.issue_date = new Date().toISOString().split('T')[0];
      delete clone.paid_date;
      clone.amount_paid = 0;
    }
    if (table === 'expenses') { clone.date = new Date().toISOString().split('T')[0]; }
    const cols = Object.keys(clone);
    db.getDb().prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(clone);
    return { id: newId };
  });

  ipcMain.handle('invoice:from-time-entries', (_event, { project_id, company_id }: { project_id: string; company_id: string }) => {
    const entries = db.getDb().prepare(`
      SELECT te.*, e.name as employee_name, e.pay_rate, p.client_id, p.name as project_name
      FROM time_entries te
      JOIN employees e ON te.employee_id = e.id
      JOIN projects p ON te.project_id = p.id
      WHERE te.project_id = ? AND te.company_id = ? AND te.is_billed = 0
    `).all(project_id, company_id) as any[];
    if (entries.length === 0) return { error: 'No unbilled time entries for this project.' };
    const client_id = entries[0].client_id;
    const project_name = entries[0].project_name;
    const byEmployee: Record<string, { name: string; minutes: number; rate: number }> = {};
    for (const e of entries) {
      if (!byEmployee[e.employee_id]) byEmployee[e.employee_id] = { name: e.employee_name, minutes: 0, rate: Number(e.pay_rate ?? 0) };
      byEmployee[e.employee_id].minutes += Number(e.duration_minutes ?? 0);
    }
    const lines = Object.values(byEmployee).map(emp => ({
      description: `${emp.name} — ${project_name}`,
      quantity: parseFloat((emp.minutes / 60).toFixed(2)),
      unit_price: emp.rate,
      tax_rate: 0,
    }));
    return { client_id, lines, entry_ids: entries.map((e: any) => e.id) };
  });
```

**Step 2: Add API methods to src/renderer/lib/api.ts**

Append to the api object:
```typescript
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
```

**Step 3: Build**
```bash
npm run build:main 2>&1 | tail -5
```

**Step 4: Commit**
```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat: rules, approval, clone, time-to-invoice IPC handlers"
```

---

## Task 6: Wire pricing + tax + approval rules into db:create IPC

**Files:**
- Modify: `src/main/ipc/index.ts`

**Step 1: Add import at top of ipc/index.ts**

After existing imports, add:
```typescript
import { evaluateRules, mergePatches, rulesAppliedSummary } from '../rules';
```

**Step 2: Find the existing db:create handler and modify its body**

Read the handler carefully. At the START of the handler body (before the insert), add:

```typescript
    // Apply rules for invoices
    if (table === 'invoices' && data.company_id) {
      const pricingResults = evaluateRules({ category: 'pricing', record: data, company_id: data.company_id, db: db.getDb() });
      const taxResults     = evaluateRules({ category: 'tax',     record: data, company_id: data.company_id, db: db.getDb() });
      Object.assign(data, mergePatches([...pricingResults, ...taxResults]));
      data.rules_applied = rulesAppliedSummary([...pricingResults, ...taxResults]);
    }
    // Apply tax rules for expenses
    if (table === 'expenses' && data.company_id) {
      const taxResults = evaluateRules({ category: 'tax', record: data, company_id: data.company_id, db: db.getDb() });
      Object.assign(data, mergePatches(taxResults));
      data.rules_applied = rulesAppliedSummary(taxResults);
    }
    // Apply approval rules for invoices, expenses, bills
    if ((table === 'invoices' || table === 'expenses' || table === 'bills') && data.company_id) {
      const approvalResults = evaluateRules({ category: 'approval', record: { ...data, _type: table }, company_id: data.company_id, db: db.getDb() });
      if (approvalResults.some(r => r.matched)) data.status = 'pending_approval';
    }
```

**Step 3: Build**
```bash
npm run build:main 2>&1 | tail -5
```

**Step 4: Commit**
```bash
git add src/main/ipc/index.ts
git commit -m "feat: evaluate pricing/tax/approval rules on invoice + expense create"
```

---

## Task 7: Nightly alert rules cron

**Files:**
- Create: `src/main/crons/alerts.ts`
- Modify: `src/main/services/recurring-processor.ts` OR wherever `startCrons`/nightly schedule is — read the file first to find the right location

**Step 1: Create src/main/crons/alerts.ts**

```typescript
// src/main/crons/alerts.ts
import type { Database } from 'better-sqlite3';
import { evaluateRules } from '../rules';

export function runAlertRules(db: Database): void {
  const companies = db.prepare(`SELECT id FROM companies`).all() as { id: string }[];

  for (const { id: company_id } of companies) {
    const cashRow = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN type = 'asset' THEN balance ELSE -balance END), 0) as cash_balance
      FROM accounts WHERE company_id = ? AND type IN ('asset','liability')
    `).get(company_id) as { cash_balance: number } | undefined;

    const overdueRow = db.prepare(`
      SELECT COUNT(*) as invoice_overdue_count,
             COALESCE(SUM(total - amount_paid), 0) as receivables_total
      FROM invoices WHERE company_id = ? AND status = 'overdue'
    `).get(company_id) as { invoice_overdue_count: number; receivables_total: number } | undefined;

    const record: Record<string, unknown> = {
      cash_balance: cashRow?.cash_balance ?? 0,
      invoice_overdue_count: overdueRow?.invoice_overdue_count ?? 0,
      receivables_total: overdueRow?.receivables_total ?? 0,
    };

    evaluateRules({ category: 'alert', record, company_id, db });
  }
}
```

**Step 2: Register in the nightly cron**

Read `src/main/services/recurring-processor.ts` and find the scheduling pattern. Add alongside existing nightly jobs:
```typescript
import { runAlertRules } from '../crons/alerts';
// In nightly cron callback:
runAlertRules(db);
```

**Step 3: Build**
```bash
npm run build:main 2>&1 | tail -5
```

**Step 4: Commit**
```bash
git add src/main/crons/alerts.ts
git commit -m "feat: nightly alert rule evaluation cron"
```

---

## Task 8: Rules UI — shared components RuleList + RuleLog

**Files:**
- Create: `src/renderer/modules/rules/RuleList.tsx`
- Create: `src/renderer/modules/rules/RuleLog.tsx`

**Step 1: Create RuleList.tsx**

```typescript
// src/renderer/modules/rules/RuleList.tsx
import React from 'react';
import { Edit2, Trash2, ToggleLeft, ToggleRight, Plus } from 'lucide-react';

interface Rule {
  id: string; name: string; category: string; trigger: string;
  is_active: number; applied_count: number; last_run_at: string | null; priority: number;
}
interface Props {
  rules: Rule[];
  onEdit: (rule: Rule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, is_active: boolean) => void;
  onNew: () => void;
}

export const RuleList: React.FC<Props> = ({ rules, onEdit, onDelete, onToggle, onNew }) => (
  <div>
    <div className="flex justify-between items-center mb-4">
      <span className="text-xs text-gray-500 uppercase tracking-widest font-bold">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
      <button onClick={onNew} className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-indigo-700">
        <Plus size={14} /> New Rule
      </button>
    </div>
    {rules.length === 0 && (
      <div className="border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">No rules yet — click New Rule to create one</div>
    )}
    {rules.map(rule => (
      <div key={rule.id} className="border border-gray-200 bg-white mb-2 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => onToggle(rule.id, !rule.is_active)}>
            {rule.is_active
              ? <ToggleRight size={20} className="text-indigo-600" />
              : <ToggleLeft size={20} className="text-gray-400" />}
          </button>
          <div>
            <div className="font-bold text-sm">{rule.name}</div>
            <div className="text-xs text-gray-400">
              Priority {rule.priority} · Applied {rule.applied_count}&times;
              {rule.last_run_at ? ` · Last: ${new Date(rule.last_run_at).toLocaleDateString()}` : ''}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onEdit(rule)} className="p-1.5 border border-gray-200 hover:border-indigo-400"><Edit2 size={14} /></button>
          <button onClick={() => onDelete(rule.id)} className="p-1.5 border border-gray-200 hover:border-red-400 text-red-500"><Trash2 size={14} /></button>
        </div>
      </div>
    ))}
  </div>
);
```

**Step 2: Create RuleLog.tsx**

```typescript
// src/renderer/modules/rules/RuleLog.tsx
import React from 'react';

interface LogEntry { id: string; ran_at: string; status: string; detail: string; }
interface Props { entries: LogEntry[]; }

const STATUS_CLS: Record<string, string> = {
  PASS: 'bg-green-100 text-green-800 border border-green-300',
  FAIL: 'bg-red-100 text-red-800 border border-red-300',
  SKIP: 'bg-gray-100 text-gray-500 border border-gray-200',
};

export const RuleLog: React.FC<Props> = ({ entries }) => {
  if (entries.length === 0) return <p className="text-xs text-gray-400 italic p-4">No run history yet.</p>;
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500 uppercase tracking-widest">
          <th className="pb-2 pr-4">When</th>
          <th className="pb-2 pr-4">Status</th>
          <th className="pb-2">Detail</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(e => (
          <tr key={e.id} className="border-b border-gray-100">
            <td className="py-2 pr-4 text-gray-400">{new Date(e.ran_at).toLocaleString()}</td>
            <td className="py-2 pr-4">
              <span className={`px-2 py-0.5 font-bold uppercase text-xs ${STATUS_CLS[e.status] ?? STATUS_CLS.SKIP}`}>{e.status}</span>
            </td>
            <td className="py-2 text-gray-600">{e.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
```

**Step 3: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 4: Commit**
```bash
git add src/renderer/modules/rules/RuleList.tsx src/renderer/modules/rules/RuleLog.tsx
git commit -m "feat: RuleList and RuleLog shared UI components"
```

---

## Task 9: Rules UI — RuleForm.tsx

**Files:**
- Create: `src/renderer/modules/rules/RuleForm.tsx`

**Step 1: Create the file**

```typescript
// src/renderer/modules/rules/RuleForm.tsx
import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

const CONDITION_FIELDS: Record<string, string[]> = {
  pricing:    ['client_id','invoice_total','quantity','line_item_category'],
  tax:        ['client_state','client_country','line_item_description','expense_category','account_code'],
  approval:   ['amount_gt','vendor_id','expense_category','invoice_total','client_id'],
  alert:      ['cash_balance','invoice_overdue_count','receivables_total','account_balance'],
  bank:       ['description','reference','amount'],
  automation: ['invoice_overdue_days','bill_due_days'],
};

const ACTION_TYPES: Record<string, string[]> = {
  pricing:    ['discount','markup','set_unit_price'],
  tax:        ['set_tax_rate'],
  approval:   ['flag_approval'],
  alert:      ['notify','send_email'],
  bank:       ['set_account','set_description'],
  automation: ['set_description','notify'],
};

const OPS = ['eq','neq','lt','lte','gt','gte','contains','starts_with','ends_with','in','regex','between'];

const TRIGGER_FOR: Record<string, string> = {
  pricing: 'on_save', tax: 'on_save', bank: 'manual',
  approval: 'on_save', alert: 'scheduled', automation: 'scheduled',
};

interface Props { category: string; rule?: any; onSave: () => void; onCancel: () => void; }

export const RuleForm: React.FC<Props> = ({ category, rule, onSave, onCancel }) => {
  const { activeCompany } = useCompanyStore();
  const [name, setName] = useState(rule?.name ?? '');
  const [priority, setPriority] = useState(String(rule?.priority ?? '0'));
  const [conditions, setConditions] = useState<any[]>(rule ? JSON.parse(rule.conditions ?? '[]') : []);
  const [actions, setActions] = useState<any[]>(rule ? JSON.parse(rule.actions ?? '[]') : []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const addCondition = () => setConditions(prev => [...prev, { field: CONDITION_FIELDS[category]?.[0] ?? '', op: 'eq', value: '' }]);
  const addAction = () => setActions(prev => [...prev, { type: ACTION_TYPES[category]?.[0] ?? 'notify', value: '', method: 'percent', message: '' }]);

  const handleSave = async () => {
    if (!name.trim()) { setError('Rule name is required.'); return; }
    const parsedPriority = parseInt(priority, 10);
    if (isNaN(parsedPriority)) { setError('Priority must be a number.'); return; }
    setSaving(true);
    const data = {
      company_id: activeCompany!.id, category, name: name.trim(),
      priority: parsedPriority, is_active: 1,
      trigger: TRIGGER_FOR[category] ?? 'manual',
      conditions: JSON.stringify(conditions),
      actions: JSON.stringify(actions),
    };
    if (rule?.id) { await api.updateRule(rule.id, data); }
    else { await api.createRule(data); }
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-200">
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <h2 className="font-black uppercase tracking-wider text-sm">{rule ? 'Edit' : 'New'} {category} Rule</h2>
          <button onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="p-4 space-y-4">
          {error && <div className="bg-red-50 border border-red-300 text-red-700 text-xs p-2">{error}</div>}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1">Rule Name</label>
            <input className="block-input w-full" value={name} onChange={e => { setName(e.target.value); setError(''); }} placeholder="e.g. Gold client 15% discount" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1">Priority (lower = evaluated first)</label>
            <input className="block-input w-32" value={priority} onChange={e => setPriority(e.target.value)} placeholder="0" />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider">Conditions (ALL must match)</label>
              <button onClick={addCondition} className="flex items-center gap-1 text-xs text-indigo-600 font-bold hover:underline"><Plus size={12} /> Add Condition</button>
            </div>
            {conditions.map((c, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select className="block-input flex-1" value={c.field}
                  onChange={e => setConditions(prev => prev.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>
                  {(CONDITION_FIELDS[category] ?? []).map(f => <option key={f}>{f}</option>)}
                </select>
                <select className="block-input w-32" value={c.op}
                  onChange={e => setConditions(prev => prev.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}>
                  {OPS.map(op => <option key={op}>{op}</option>)}
                </select>
                <input className="block-input flex-1" value={String(c.value ?? '')} placeholder="value"
                  onChange={e => setConditions(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                <button onClick={() => setConditions(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} className="text-red-400" /></button>
              </div>
            ))}
            {conditions.length === 0 && <p className="text-xs text-gray-400 italic">No conditions — rule will match all records</p>}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider">Actions</label>
              <button onClick={addAction} className="flex items-center gap-1 text-xs text-indigo-600 font-bold hover:underline"><Plus size={12} /> Add Action</button>
            </div>
            {actions.map((a, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select className="block-input flex-1" value={a.type}
                  onChange={e => setActions(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                  {(ACTION_TYPES[category] ?? []).map(t => <option key={t}>{t}</option>)}
                </select>
                {(a.type === 'discount' || a.type === 'markup') && (
                  <select className="block-input w-20" value={a.method ?? 'percent'}
                    onChange={e => setActions(prev => prev.map((x, j) => j === i ? { ...x, method: e.target.value } : x))}>
                    <option value="percent">%</option>
                    <option value="fixed">$</option>
                  </select>
                )}
                {a.type !== 'flag_approval' && (
                  <input className="block-input flex-1"
                    value={String(a.type === 'notify' || a.type === 'send_email' ? (a.message ?? '') : (a.value ?? ''))}
                    placeholder={a.type === 'notify' || a.type === 'send_email' ? 'Alert message' : 'value'}
                    onChange={e => setActions(prev => prev.map((x, j) => j === i
                      ? (a.type === 'notify' || a.type === 'send_email' ? { ...x, message: e.target.value } : { ...x, value: e.target.value })
                      : x))} />
                )}
                <button onClick={() => setActions(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} className="text-red-400" /></button>
              </div>
            ))}
            {actions.length === 0 && <p className="text-xs text-gray-400 italic">No actions added yet</p>}
          </div>
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200">
          <button onClick={onCancel} className="px-4 py-2 text-xs font-bold uppercase border border-gray-300 hover:border-gray-500">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-xs font-bold uppercase bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Rule'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

**Step 2: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 3: Commit**
```bash
git add src/renderer/modules/rules/RuleForm.tsx
git commit -m "feat: RuleForm adaptive create/edit for all rule categories"
```

---

## Task 10: Rules Module — index.tsx + App.tsx registration

**Files:**
- Create: `src/renderer/modules/rules/index.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: sidebar nav file (read App.tsx to find nav component path)

**Step 1: Create index.tsx**

```typescript
// src/renderer/modules/rules/index.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Shield, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { RuleList } from './RuleList';
import { RuleForm } from './RuleForm';

const TABS = [
  { key: 'bank', label: 'Bank' },
  { key: 'automation', label: 'Automation' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'tax', label: 'Tax' },
  { key: 'approval', label: 'Approval' },
  { key: 'alert', label: 'Alert' },
];

const RulesModule: React.FC = () => {
  const { activeCompany } = useCompanyStore();
  const [tab, setTab] = useState('bank');
  const [rules, setRules] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    const rows = await api.listRules(activeCompany.id, tab);
    setRules(rows ?? []);
    if (tab === 'approval') {
      const queue = await api.listApprovals(activeCompany.id, 'pending');
      setApprovals(queue ?? []);
    }
    setLoading(false);
  }, [activeCompany, tab]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    await api.deleteRule(id);
    load();
  };

  const handleToggle = async (id: string, is_active: boolean) => {
    await api.updateRule(id, { is_active: is_active ? 1 : 0 });
    load();
  };

  const handleResolve = async (id: string, status: 'approved' | 'rejected') => {
    await api.resolveApproval(id, status);
    setApprovals(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <Shield size={20} className="text-indigo-600" />
        <h1 className="font-black uppercase tracking-widest text-sm">Rules</h1>
      </div>
      <div className="bg-white border-b border-gray-200 px-6 flex">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-colors ${tab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-6">
        {tab === 'approval' && approvals.length > 0 && (
          <div className="mb-6 border border-orange-300 bg-orange-50 p-4">
            <h2 className="text-xs font-black uppercase tracking-wider text-orange-700 mb-3 flex items-center gap-2">
              <AlertTriangle size={14} /> {approvals.length} Pending Approval{approvals.length !== 1 ? 's' : ''}
            </h2>
            {approvals.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between bg-white border border-orange-200 px-4 py-3 mb-2">
                <div>
                  <div className="font-bold text-sm">{a.rule_name}</div>
                  <div className="text-xs text-gray-400">{a.record_type} · {a.record_id} · {new Date(a.created_at).toLocaleDateString()}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleResolve(a.id, 'approved')} className="px-3 py-1 bg-green-600 text-white text-xs font-bold uppercase hover:bg-green-700">Approve</button>
                  <button onClick={() => handleResolve(a.id, 'rejected')} className="px-3 py-1 bg-red-100 text-red-700 border border-red-300 text-xs font-bold uppercase hover:bg-red-200">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {loading
          ? <div className="text-xs text-gray-400 p-4">Loading…</div>
          : <RuleList rules={rules} onEdit={rule => { setEditing(rule); setShowForm(true); }} onDelete={handleDelete} onToggle={handleToggle} onNew={() => { setEditing(null); setShowForm(true); }} />
        }
      </div>
      {showForm && (
        <RuleForm category={tab} rule={editing} onSave={() => { setShowForm(false); load(); }} onCancel={() => setShowForm(false)} />
      )}
    </div>
  );
};

export default RulesModule;
```

**Step 2: Register in App.tsx**

Add lazy import with existing lazy imports:
```typescript
const RulesModule = lazy(() => import('./modules/rules'));
```

Add case in the router switch:
```typescript
case 'rules': return <RulesModule />;
```

**Step 3: Add nav item in the sidebar**

Read the sidebar component file (find it via grep for existing nav items). Add:
```tsx
{ view: 'rules', label: 'Rules', icon: Shield }
```

**Step 4: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 5: Commit**
```bash
git add src/renderer/modules/rules/index.tsx src/renderer/App.tsx
git commit -m "feat: Rules module 6-tab UI registered in app router"
```

---

## Task 11: Dashboard widgets — approval badge + activity strip

**Files:**
- Modify: `src/renderer/modules/dashboard/Dashboard.tsx`

**Step 1: Read Dashboard.tsx fully before editing**

**Step 2: Add state for pending approvals and rules activity**

```typescript
const [pendingApprovals, setPendingApprovals] = useState(0);
const [rulesActivity, setRulesActivity] = useState<any>(null);
```

**Step 3: Fetch in existing load effect alongside stats**

```typescript
const [approvalCount, activityRow] = await Promise.all([
  api.pendingApprovalCount(activeCompany.id),
  api.rawQuery(`
    SELECT
      (SELECT COUNT(*) FROM rules WHERE company_id = ? AND category='pricing' AND date(last_run_at)=date('now')) as pricing_today,
      (SELECT COUNT(*) FROM approval_queue WHERE company_id = ? AND status='pending') as approvals_pending,
      (SELECT COUNT(*) FROM rules WHERE company_id = ? AND category='alert' AND date(last_run_at)>=date('now','-7 days')) as alerts_week
  `, [activeCompany.id, activeCompany.id, activeCompany.id]),
]);
setPendingApprovals(approvalCount ?? 0);
setRulesActivity(activityRow);
```

**Step 4: Add rules activity strip JSX above or below the existing stats cards**

```tsx
{rulesActivity && (rulesActivity.pricing_today > 0 || rulesActivity.approvals_pending > 0 || rulesActivity.alerts_week > 0) && (
  <div className="border border-indigo-200 bg-indigo-50 px-4 py-2 flex gap-6 text-xs font-bold text-indigo-700 mb-4 flex-wrap">
    {rulesActivity.pricing_today > 0 && (
      <span>{rulesActivity.pricing_today} pricing rule{rulesActivity.pricing_today !== 1 ? 's' : ''} applied today</span>
    )}
    {rulesActivity.approvals_pending > 0 && (
      <span className="text-orange-700">{rulesActivity.approvals_pending} approval{rulesActivity.approvals_pending !== 1 ? 's' : ''} pending</span>
    )}
    {rulesActivity.alerts_week > 0 && (
      <span>{rulesActivity.alerts_week} alert{rulesActivity.alerts_week !== 1 ? 's' : ''} fired this week</span>
    )}
  </div>
)}
```

**Step 5: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 6: Commit**
```bash
git add src/renderer/modules/dashboard/Dashboard.tsx
git commit -m "feat: dashboard rules activity strip and pending approval count"
```

---

## Task 12: Contextual sidebar panels in forms

**Files:**
- Create: `src/renderer/components/ContextPanel.tsx`
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx`
- Modify: `src/renderer/modules/expenses/ExpenseForm.tsx`

**Step 1: Create ContextPanel.tsx**

```typescript
// src/renderer/components/ContextPanel.tsx
import React, { useEffect, useState } from 'react';
import api from '../lib/api';

interface ClientContextProps { clientId: string | null; companyId: string; }

export const ClientContext: React.FC<ClientContextProps> = ({ clientId, companyId }) => {
  const [data, setData] = useState<{ outstanding: number; lastPayment: string | null; ytd: number } | null>(null);

  useEffect(() => {
    if (!clientId) { setData(null); return; }
    Promise.all([
      api.rawQuery(`SELECT COALESCE(SUM(total - amount_paid), 0) as outstanding FROM invoices WHERE client_id = ? AND company_id = ? AND status NOT IN ('paid','cancelled')`, [clientId, companyId]),
      api.rawQuery(`SELECT MAX(paid_date) as last_payment FROM invoices WHERE client_id = ? AND company_id = ? AND status = 'paid'`, [clientId, companyId]),
      api.rawQuery(`SELECT COALESCE(SUM(total), 0) as ytd FROM invoices WHERE client_id = ? AND company_id = ? AND strftime('%Y', issue_date) = strftime('%Y', 'now')`, [clientId, companyId]),
    ]).then(([outRow, payRow, ytdRow]) => setData({
      outstanding: outRow?.outstanding ?? 0,
      lastPayment: payRow?.last_payment ?? null,
      ytd: ytdRow?.ytd ?? 0,
    }));
  }, [clientId, companyId]);

  if (!clientId || !data) return null;

  return (
    <div className="border border-indigo-100 bg-indigo-50 p-3 text-xs space-y-1.5 mt-2">
      <div className="font-black uppercase tracking-wider text-indigo-600 text-[10px] mb-2">Client Overview</div>
      <div className="flex justify-between">
        <span className="text-gray-500">Outstanding</span>
        <span className={`font-bold ${Number(data.outstanding) > 0 ? 'text-orange-600' : 'text-gray-700'}`}>${Number(data.outstanding).toFixed(2)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">Last Payment</span>
        <span className="font-bold">{data.lastPayment ? new Date(data.lastPayment).toLocaleDateString() : '—'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">Invoiced YTD</span>
        <span className="font-bold">${Number(data.ytd).toFixed(2)}</span>
      </div>
    </div>
  );
};

interface CategoryContextProps { categoryId: string | null; companyId: string; }

export const CategoryContext: React.FC<CategoryContextProps> = ({ categoryId, companyId }) => {
  const [data, setData] = useState<{ month_spend: number; budget: number } | null>(null);

  useEffect(() => {
    if (!categoryId) { setData(null); return; }
    api.rawQuery(`
      SELECT
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', date) = strftime('%Y-%m', 'now') THEN amount ELSE 0 END), 0) as month_spend,
        COALESCE((SELECT bl.amount FROM budget_lines bl WHERE bl.category_id = ? LIMIT 1), 0) as budget
      FROM expenses WHERE company_id = ? AND category_id = ?
    `, [categoryId, companyId, categoryId]).then(row => setData(row));
  }, [categoryId, companyId]);

  if (!categoryId || !data) return null;
  const over = Number(data.month_spend) > Number(data.budget) && Number(data.budget) > 0;

  return (
    <div className={`border p-3 text-xs space-y-1.5 mt-2 ${over ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
      <div className="font-black uppercase tracking-wider text-[10px] mb-2 text-gray-500">Category This Month</div>
      <div className="flex justify-between">
        <span className="text-gray-500">Spent</span>
        <span className={`font-bold ${over ? 'text-red-600' : ''}`}>${Number(data.month_spend).toFixed(2)}</span>
      </div>
      {Number(data.budget) > 0 && (
        <div className="flex justify-between">
          <span className="text-gray-500">Budget</span>
          <span className="font-bold">${Number(data.budget).toFixed(2)}</span>
        </div>
      )}
      {over && <div className="text-red-600 font-bold text-[10px] uppercase tracking-wider">Over budget</div>}
    </div>
  );
};
```

**Step 2: Add ClientContext to InvoiceForm.tsx**

Read the file first. Import:
```typescript
import { ClientContext } from '../../components/ContextPanel';
```

Find where `client_id` select renders. Add directly below it:
```tsx
<ClientContext clientId={form.client_id || null} companyId={activeCompany?.id ?? ''} />
```

**Step 3: Add CategoryContext to ExpenseForm.tsx**

Read the file first. Import and add below category select:
```tsx
<CategoryContext categoryId={form.category_id || null} companyId={activeCompany?.id ?? ''} />
```

**Step 4: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 5: Commit**
```bash
git add src/renderer/components/ContextPanel.tsx src/renderer/modules/invoices/InvoiceForm.tsx src/renderer/modules/expenses/ExpenseForm.tsx
git commit -m "feat: contextual panels — client balance in InvoiceForm, category spend in ExpenseForm"
```

---

## Task 13: List summary bars

**Files:**
- Create: `src/renderer/components/SummaryBar.tsx`
- Modify: `src/renderer/modules/invoices/InvoiceList.tsx`
- Modify: `src/renderer/modules/expenses/ExpenseList.tsx`
- Modify: `src/renderer/modules/clients/ClientList.tsx`

**Step 1: Create SummaryBar.tsx**

```typescript
// src/renderer/components/SummaryBar.tsx
import React from 'react';

export interface SummaryItem { label: string; value: string; accent?: 'red' | 'orange' | 'green' | 'default'; }

export const SummaryBar: React.FC<{ items: SummaryItem[] }> = ({ items }) => {
  const accentCls: Record<string, string> = {
    red: 'text-red-600', orange: 'text-orange-600', green: 'text-green-600', default: 'text-gray-900',
  };
  return (
    <div className="flex gap-6 bg-white border-b border-gray-200 px-6 py-2.5 flex-wrap">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{item.label}</span>
          <span className={`text-sm font-black ${accentCls[item.accent ?? 'default']}`}>{item.value}</span>
        </div>
      ))}
    </div>
  );
};
```

**Step 2: Add to InvoiceList.tsx**

Read the file first. Add rawQuery in load effect:
```typescript
const invoiceSummary = await api.rawQuery(`
  SELECT
    COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled') THEN total - amount_paid ELSE 0 END), 0) as outstanding,
    COALESCE(SUM(CASE WHEN status = 'overdue' THEN total - amount_paid ELSE 0 END), 0) as overdue,
    COALESCE(SUM(CASE WHEN status = 'paid' AND strftime('%Y-%m', paid_date) = strftime('%Y-%m', 'now') THEN amount_paid ELSE 0 END), 0) as collected_month
  FROM invoices WHERE company_id = ?
`, [activeCompany.id]);
setInvoiceSummary(invoiceSummary);
```

Add `<SummaryBar>` above the invoice table:
```tsx
{invoiceSummary && (
  <SummaryBar items={[
    { label: 'Outstanding', value: `$${Number(invoiceSummary.outstanding).toFixed(2)}`, accent: 'orange' },
    { label: 'Overdue', value: `$${Number(invoiceSummary.overdue).toFixed(2)}`, accent: 'red' },
    { label: 'Collected This Month', value: `$${Number(invoiceSummary.collected_month).toFixed(2)}`, accent: 'green' },
  ]} />
)}
```

**Step 3: Add to ExpenseList.tsx** with:
- Total this month
- Largest category (subquery for MAX)
- Over-budget count (red accent if > 0)

**Step 4: Add to ClientList.tsx** with:
- Total receivables (SUM of outstanding invoices)
- Clients with overdue invoices count

**Step 5: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 6: Commit**
```bash
git add src/renderer/components/SummaryBar.tsx src/renderer/modules/invoices/InvoiceList.tsx src/renderer/modules/expenses/ExpenseList.tsx src/renderer/modules/clients/ClientList.tsx
git commit -m "feat: summary bars on invoice, expense, client list views"
```

---

## Task 14: Cmd+K Quick-create command palette

**Files:**
- Create: `src/renderer/components/QuickCreate.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Create QuickCreate.tsx**

```typescript
// src/renderer/components/QuickCreate.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

const COMMANDS = [
  { label: 'New Invoice',       view: 'invoicing',     hint: 'inv' },
  { label: 'New Expense',       view: 'expenses',      hint: 'exp' },
  { label: 'New Client',        view: 'clients',       hint: 'cli' },
  { label: 'New Vendor',        view: 'expenses',      hint: 'ven' },
  { label: 'New Employee',      view: 'payroll',       hint: 'emp' },
  { label: 'New Journal Entry', view: 'accounts',      hint: 'jou' },
  { label: 'New Bill',          view: 'bills',         hint: 'bil' },
  { label: 'New Project',       view: 'projects',      hint: 'pro' },
  { label: 'New Time Entry',    view: 'time-tracking', hint: 'tim' },
];

interface Props { onNavigate: (view: string) => void; onClose: () => void; }

export const QuickCreate: React.FC<Props> = ({ onNavigate, onClose }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = COMMANDS.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) || c.hint.includes(query.toLowerCase())
  );

  const select = (view: string) => { onNavigate(view); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-32 z-50" onClick={onClose}>
      <div className="bg-white w-full max-w-md border border-gray-200 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input ref={inputRef} className="flex-1 outline-none text-sm bg-transparent"
            placeholder="Create something… (inv, exp, cli…)"
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && filtered.length > 0) select(filtered[0].view);
            }} />
          <button onClick={onClose}><X size={16} className="text-gray-400" /></button>
        </div>
        {filtered.map((c, i) => (
          <button key={i} onClick={() => select(c.view)}
            className="w-full text-left px-4 py-3 text-sm font-medium hover:bg-indigo-50 border-b border-gray-100 last:border-0 flex items-center justify-between">
            {c.label}
            <span className="text-xs text-gray-300 font-mono">{c.hint}</span>
          </button>
        ))}
        {filtered.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No matches</div>}
      </div>
    </div>
  );
};
```

**Step 2: Wire into App.tsx**

Read App.tsx first. Add state:
```typescript
const [quickCreateOpen, setQuickCreateOpen] = useState(false);
```

Add keydown listener in a useEffect:
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setQuickCreateOpen(prev => !prev);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

Add to JSX alongside the current-view router:
```tsx
{quickCreateOpen && (
  <QuickCreate
    onNavigate={view => setCurrentView(view)}
    onClose={() => setQuickCreateOpen(false)}
  />
)}
```

**Step 3: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 4: Commit**
```bash
git add src/renderer/components/QuickCreate.tsx src/renderer/App.tsx
git commit -m "feat: Cmd+K quick-create command palette"
```

---

## Task 15: Clone record — Invoice, Expense, Bill

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceDetail.tsx`
- Modify: `src/renderer/modules/expenses/ExpenseList.tsx` or expense detail
- Modify: `src/renderer/modules/bills/index.tsx`

**Step 1: Read each file before editing**

**Step 2: Add Duplicate handler to InvoiceDetail.tsx**

Import Copy icon: `import { Copy } from 'lucide-react';`

Add handler:
```typescript
const handleDuplicate = async () => {
  const result = await api.cloneRecord('invoices', invoice.id);
  if (result.error) { setError(result.error); return; }
  onBack(); // navigate back to list where the clone appears
};
```

Add button near the existing action buttons:
```tsx
<button onClick={handleDuplicate} className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-xs font-bold uppercase hover:border-indigo-400 hover:text-indigo-600">
  <Copy size={14} /> Duplicate
</button>
```

**Step 3: Repeat for expense detail/list and bills**

Follow same pattern — read each file, add handler + button.

**Step 4: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 5: Commit**
```bash
git add src/renderer/modules/invoices/InvoiceDetail.tsx src/renderer/modules/expenses/ src/renderer/modules/bills/
git commit -m "feat: Duplicate button on invoice, expense, bill"
```

---

## Task 16: Invoice from time entries

**Files:**
- Modify: `src/renderer/modules/projects/ProjectDetail.tsx` or `src/renderer/modules/time/TimeEntryList.tsx`

**Step 1: Read the time entry list or project detail to find the right location**

**Step 2: Add "Create Invoice" button**

```typescript
const handleCreateInvoice = async () => {
  if (!activeProject) return;
  const result = await api.invoiceFromTimeEntries(activeProject.id, activeCompany!.id);
  if (result.error) { setError(result.error); return; }
  // Navigate to invoice form with pre-filled data
  // Store the prefill in a shared store or pass via navigation state
  // For now: store in localStorage and InvoiceForm reads it on mount
  localStorage.setItem('invoiceFormPrefill', JSON.stringify(result));
  onNavigate('invoicing');
};
```

Add button:
```tsx
<button onClick={handleCreateInvoice} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-xs font-bold uppercase hover:bg-indigo-700">
  Create Invoice from Time
</button>
```

**Step 3: In InvoiceForm.tsx, read prefill on mount**

In the load effect:
```typescript
const prefill = localStorage.getItem('invoiceFormPrefill');
if (prefill) {
  const { client_id, lines } = JSON.parse(prefill);
  setForm(prev => ({ ...prev, client_id }));
  setLineItems(lines);
  localStorage.removeItem('invoiceFormPrefill');
}
```

**Step 4: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 5: Commit**
```bash
git add src/renderer/modules/projects/ src/renderer/modules/time/ src/renderer/modules/invoices/InvoiceForm.tsx
git commit -m "feat: create invoice from unbilled project time entries"
```

---

## Task 17: CSV Import Wizard

**Files:**
- Create: `src/renderer/components/ImportWizard.tsx`
- Modify: `src/renderer/modules/clients/ClientList.tsx`
- Modify: `src/renderer/modules/expenses/ExpenseList.tsx`
- Modify: `src/renderer/modules/accounts/AccountsList.tsx`

**Step 1: Create ImportWizard.tsx**

```typescript
// src/renderer/components/ImportWizard.tsx
import React, { useState } from 'react';
import { Upload, X, Check } from 'lucide-react';
import api from '../lib/api';

interface Props {
  table: string;
  requiredFields: string[];
  extraData?: Record<string, unknown>; // e.g. company_id injected on every row
  onDone: () => void;
  onCancel: () => void;
}

export const ImportWizard: React.FC<Props> = ({ table, requiredFields, extraData = {}, onDone, onCancel }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [error, setError] = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = String(ev.target?.result ?? '');
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { setError('CSV must have a header row and at least one data row.'); return; }
      const hdrs = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const dataRows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        return Object.fromEntries(hdrs.map((h, i) => [h, vals[i] ?? '']));
      });
      setHeaders(hdrs);
      setRows(dataRows);
      const autoMap: Record<string, string> = {};
      for (const f of requiredFields) {
        const match = hdrs.find(h => h.toLowerCase() === f.toLowerCase());
        if (match) autoMap[f] = match;
      }
      setMapping(autoMap);
      setStep(2);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    const missing = requiredFields.filter(f => !mapping[f]);
    if (missing.length > 0) { setError(`Map required fields: ${missing.join(', ')}`); return; }
    setImporting(true);
    let imported = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const data: Record<string, unknown> = { ...extraData };
      for (const [field, col] of Object.entries(mapping)) data[field] = row[col] ?? '';
      try { await api.create(table, data); imported++; }
      catch (e: any) { errors.push(String(e?.message ?? e)); }
    }
    setResult({ imported, errors });
    setStep(3);
    setImporting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-xl border border-gray-200">
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <h2 className="font-black uppercase tracking-wider text-sm">Import {table} — Step {step} of 3</h2>
          <button onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="p-4">
          {error && <div className="bg-red-50 border border-red-300 text-red-700 text-xs p-2 mb-3">{error}</div>}

          {step === 1 && (
            <div className="text-center py-8">
              <Upload size={32} className="mx-auto text-gray-300 mb-4" />
              <p className="text-sm text-gray-500 mb-1">Upload a CSV file</p>
              <p className="text-xs text-gray-400 mb-4">Required columns: <span className="font-bold">{requiredFields.join(', ')}</span></p>
              <label className="cursor-pointer inline-block bg-indigo-600 text-white px-4 py-2 text-xs font-bold uppercase hover:bg-indigo-700">
                Choose CSV File
                <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
              </label>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-xs text-gray-500 mb-3">{rows.length} rows found. Map CSV columns to fields:</p>
              {requiredFields.map(field => (
                <div key={field} className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-bold w-36 uppercase text-gray-700">{field}</span>
                  <select className="block-input flex-1"
                    value={mapping[field] ?? ''}
                    onChange={e => { setMapping(prev => ({ ...prev, [field]: e.target.value })); setError(''); }}>
                    <option value="">— select column —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
              {rows[0] && (
                <div className="mt-3 text-xs text-gray-400 border border-gray-100 bg-gray-50 p-2">
                  Preview row 1: {Object.entries(rows[0]).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                </div>
              )}
            </div>
          )}

          {step === 3 && result && (
            <div className="text-center py-6">
              <Check size={32} className="mx-auto text-green-500 mb-3" />
              <p className="font-bold text-sm">{result.imported} record{result.imported !== 1 ? 's' : ''} imported successfully</p>
              {result.errors.length > 0 && (
                <p className="text-xs text-red-600 mt-2">{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}: {result.errors.slice(0, 3).join('; ')}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200">
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} className="px-4 py-2 text-xs font-bold uppercase border border-gray-300 hover:border-gray-500">Back</button>
              <button onClick={handleImport} disabled={importing}
                className="px-4 py-2 text-xs font-bold uppercase bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                {importing ? 'Importing…' : `Import ${rows.length} Row${rows.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
          {step === 3 && <button onClick={onDone} className="px-4 py-2 text-xs font-bold uppercase bg-indigo-600 text-white hover:bg-indigo-700">Done</button>}
        </div>
      </div>
    </div>
  );
};
```

**Step 2: Add Import CSV button to ClientList.tsx**

Read file first. Add state: `const [showImport, setShowImport] = useState(false);`

Add button in list header area:
```tsx
<button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-xs font-bold uppercase hover:border-indigo-400">
  Import CSV
</button>
```

Add wizard at bottom of JSX:
```tsx
{showImport && (
  <ImportWizard
    table="clients"
    requiredFields={['name', 'email', 'phone', 'type']}
    extraData={{ company_id: activeCompany?.id, status: 'active' }}
    onDone={() => { setShowImport(false); load(); }}
    onCancel={() => setShowImport(false)}
  />
)}
```

**Step 3: Repeat for ExpenseList.tsx**

```tsx
<ImportWizard
  table="expenses"
  requiredFields={['date', 'amount', 'description']}
  extraData={{ company_id: activeCompany?.id }}
  onDone={() => { setShowImport(false); load(); }}
  onCancel={() => setShowImport(false)}
/>
```

**Step 4: Repeat for AccountsList.tsx**

```tsx
<ImportWizard
  table="accounts"
  requiredFields={['code', 'name', 'type']}
  extraData={{ company_id: activeCompany?.id }}
  onDone={() => { setShowImport(false); load(); }}
  onCancel={() => setShowImport(false)}
/>
```

**Step 5: Build renderer**
```bash
npm run build:renderer 2>&1 | tail -5
```

**Step 6: Commit**
```bash
git add src/renderer/components/ImportWizard.tsx src/renderer/modules/clients/ClientList.tsx src/renderer/modules/expenses/ExpenseList.tsx src/renderer/modules/accounts/AccountsList.tsx
git commit -m "feat: CSV import wizard for clients, expenses, accounts"
```

---

## Final: Full build verification + push

```bash
cd "/Users/rmpgutah/Business Accounting Pro"
npm run build:main 2>&1 | tail -5
npm run build:renderer 2>&1 | tail -5
git push origin main
```

Expected: both builds clean, all 17 tasks committed, pushed to origin.
