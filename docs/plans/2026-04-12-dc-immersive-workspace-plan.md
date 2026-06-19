# DC Immersive Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent debt list panel, immutable audit log, court packet export, verification affidavit, batch interest recalc, smart recommendations, and bank payment matching to the Debt Collection module.

**Architecture:** Approach B — enhance the existing 6-tab structure rather than replace it. New `DebtMiniList` component renders in a persistent left panel. Court features extend `LegalToolkit.tsx` with new sub-tabs. Automations are new IPC handlers with UI buttons. The `logDebtAudit` helper is injected into 14 existing handlers for chain-of-custody.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, Tailwind CSS, lucide-react icons. PDF generation via `htmlToPDFBuffer` (from `src/main/services/print-preview.ts`).

**Design doc:** `docs/plans/2026-04-12-dc-immersive-workspace-design.md`

---

## Phase 1: Foundation (Audit Log)

### Task 1: Schema + logDebtAudit helper

**Files:**
- Modify: `src/main/database/index.ts` (migrations array ~line 345, tablesWithoutUpdatedAt ~line 490)
- Modify: `src/main/ipc/index.ts` (tablesWithoutCompanyId ~line 423, new helper function before debt handlers ~line 960)

**Step 1: Add debt_audit_log + debt_payment_matches tables to migrations**

In `src/main/database/index.ts`, find the closing `];` of the migrations array (after the invoice customization migrations). Insert before it:

```typescript
  // DC Immersive Workspace (2026-04-12)
  `CREATE TABLE IF NOT EXISTS debt_audit_log (
    id TEXT PRIMARY KEY,
    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    field_name TEXT DEFAULT '',
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    performed_by TEXT DEFAULT 'user',
    performed_at TEXT DEFAULT (datetime('now')),
    ip_address TEXT DEFAULT '',
    notes TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_debt_audit_debt ON debt_audit_log(debt_id)`,
  `CREATE TABLE IF NOT EXISTS debt_payment_matches (
    id TEXT PRIMARY KEY,
    bank_transaction_id TEXT NOT NULL,
    debt_id TEXT NOT NULL,
    match_type TEXT NOT NULL CHECK(match_type IN ('auto','suggested')),
    confidence REAL DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dpm_debt ON debt_payment_matches(debt_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dpm_txn ON debt_payment_matches(bank_transaction_id)`,
```

**Step 2: Add both tables to tablesWithoutUpdatedAt**

Find the `tablesWithoutUpdatedAt` Set in `database/index.ts` (~line 452). Add at the end before the closing `]);`:

```typescript
  'debt_audit_log', 'debt_payment_matches',
```

**Step 3: Add both tables to tablesWithoutCompanyId**

Find the `tablesWithoutCompanyId` Set in `ipc/index.ts` (~line 400). Add at the end before the closing `]);`:

```typescript
  'debt_audit_log', 'debt_payment_matches',
```

**Step 4: Define the logDebtAudit helper function**

In `ipc/index.ts`, find the line `// ─── Debt Collection` or the first debt handler (approximately line 960-1000). Insert BEFORE the first `ipcMain.handle('debt:...')` call:

```typescript
  // ─── Audit Log Helper ──────────────────────────────────
  // Immutable chain-of-custody logging. Called by every debt-mutating handler.
  // MUST NEVER throw — audit is a side-effect, not a gate.
  function logDebtAudit(
    debtId: string,
    action: string,
    fieldName: string = '',
    oldValue: string = '',
    newValue: string = '',
    performedBy: string = 'user'
  ): void {
    try {
      const dbInstance = db.getDb();
      const id = uuid();
      dbInstance.prepare(`
        INSERT INTO debt_audit_log (id, debt_id, action, field_name, old_value, new_value, performed_by, performed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(id, debtId, action, fieldName, oldValue, newValue, performedBy);
    } catch (_) { /* audit logging must never crash the primary operation */ }
  }
```

Check that `uuid` is available — it should already be imported at the top of `ipc/index.ts` (look for `import { v4 as uuid }` or `const uuid = crypto.randomUUID` or similar). If not, use `crypto.randomUUID()` instead.

**Step 5: Add the audit-log query handler**

After the `logDebtAudit` function, add:

```typescript
  ipcMain.handle('debt:audit-log', (_event, { debtId, limit }: { debtId: string; limit?: number }) => {
    try {
      const dbInstance = db.getDb();
      return dbInstance.prepare(`
        SELECT * FROM debt_audit_log WHERE debt_id = ? ORDER BY performed_at DESC LIMIT ?
      `).all(debtId, limit || 200);
    } catch (err: any) {
      return [];
    }
  });
```

**Step 6: Type check**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: Only the pre-existing `baseUrl` deprecation.

**Step 7: Commit**

```bash
git add src/main/database/index.ts src/main/ipc/index.ts
git commit -m "feat(dc): add debt_audit_log + debt_payment_matches tables and logDebtAudit helper

- debt_audit_log: immutable chain-of-custody for every debt mutation
- debt_payment_matches: bank transaction → debt payment linking
- logDebtAudit(): silent-fail helper injected before debt handlers
- debt:audit-log query handler for UI consumption
- Both tables added to tablesWithoutCompanyId and tablesWithoutUpdatedAt"
```

---

### Task 2: Inject logDebtAudit into 14 existing handlers

**Files:**
- Modify: `src/main/ipc/index.ts` (14 handler locations)

This task adds 1-3 lines to each of 14 existing IPC handlers. For each handler below, add the `logDebtAudit(...)` call AFTER the primary mutation succeeds but BEFORE the `return` statement and `scheduleAutoBackup()`.

**Handler 1: `debt:advance-stage` (~line 3047)**

Find the line that updates the debt's stage. After the stage update, add:

```typescript
logDebtAudit(debtId, 'stage_advance', 'current_stage', oldStage || '', newStage);
```

You'll need to capture `oldStage` before the update. Read the current stage first:

```typescript
const oldDebt = db.getById('debts', debtId);
const oldStage = oldDebt?.current_stage || '';
// ... existing advance logic ...
logDebtAudit(debtId, 'stage_advance', 'current_stage', oldStage, newStage);
```

If the handler already reads the debt before updating (to compute the next stage), reuse that variable.

**Handler 2: `debt:hold-toggle` (~line 3063)**

```typescript
logDebtAudit(debtId, 'hold_toggle', 'hold', hold ? '0' : '1', hold ? '1' : '0');
```

**Handler 3: `debt:assign-collector` (~line 3068)**

Read old collector ID before update:

```typescript
const oldDebt = db.getById('debts', debtId);
// ... existing assign logic ...
logDebtAudit(debtId, 'assignment_change', 'assigned_collector_id', oldDebt?.assigned_collector_id || '', collectorId || '');
```

**Handler 4: `debt:add-fee` (~line 3608)**

Already inside a transaction. Add after the fee update:

```typescript
logDebtAudit(debtId, 'fee_added', 'fees_accrued', '', String(amount) + ' (' + feeType + ')');
```

**Handler 5: `debt:settlement-save` (~line 3429)**

```typescript
logDebtAudit(data.debt_id, 'settlement_offered', 'offer_amount', '', String(data.offer_amount || 0));
```

**Handler 6: `debt:settlement-accept` (~line 3457)**

```typescript
logDebtAudit(debtId, 'settlement_accepted', 'status', 'in_collection', 'settled');
```

**Handler 7: `debt:compliance-save` (~line 3477)**

```typescript
logDebtAudit(data.debt_id, 'compliance_event', 'event_type', '', data.event_type || '');
```

**Handler 8: `debt:payment-plan-save` (~line 3375)**

```typescript
logDebtAudit(data.debt_id, 'plan_created', 'payment_plan', '', data.installment_amount ? 'Installment plan: $' + data.installment_amount : 'Plan saved');
```

**Handler 9: `debt:promise-save` (~line 1175)**

```typescript
logDebtAudit(data.debt_id, 'promise_recorded', 'promised_date', '', data.promised_date + ' $' + (data.promised_amount || 0));
```

**Handler 10: `debt:promise-update` (~line 1191)**

```typescript
logDebtAudit(id, 'promise_updated', 'kept', '', kept ? 'kept' : 'broken');
```

Note: `id` here is the promise ID, but audit needs the `debt_id`. Read the promise to get its `debt_id`:

```typescript
const promise = db.getById('debt_promises', id);
if (promise) logDebtAudit(promise.debt_id, 'promise_updated', 'kept', '', kept ? 'kept' : 'broken');
```

**Handler 11: `debt:quick-note` (~line 3597)**

```typescript
logDebtAudit(debtId, 'note_added', 'notes', '', note.substring(0, 100));
```

**Handler 12: Generic `db:update` for debts table (~line 455-470)**

This is the trickiest one. The generic `db:update` handler handles ALL table updates. We need to intercept ONLY updates to the `debts` table, read the old values, diff them, and log each changed field.

Find the `ipcMain.handle('db:update', ...)` handler. Inside it, AFTER the table name check but BEFORE the actual update call, add:

```typescript
// Audit log for debt field edits
if (table === 'debts' && id) {
  try {
    const oldRow = db.getById('debts', id);
    if (oldRow) {
      // After the update completes, diff and log each changed field
      setTimeout(() => {
        try {
          const newRow = db.getById('debts', id);
          if (!newRow) return;
          for (const key of Object.keys(data)) {
            const oldVal = String(oldRow[key] ?? '');
            const newVal = String(newRow[key] ?? '');
            if (oldVal !== newVal) {
              logDebtAudit(id, 'field_edit', key, oldVal, newVal);
            }
          }
        } catch (_) {}
      }, 0);
    }
  } catch (_) {}
}
```

The `setTimeout(..., 0)` defers the diff to after the update runs, so we can read the new values.

**Handler 13: Generic `db:create` for debt child tables**

Find the `ipcMain.handle('db:create', ...)` handler. After the create succeeds, check if the table is a debt child table and log:

```typescript
// Audit log for debt-related record creation
const DEBT_CHILD_TABLES: Record<string, string> = {
  'debt_payments': 'payment_recorded',
  'debt_communications': 'communication_logged',
  'debt_disputes': 'dispute_filed',
};
if (DEBT_CHILD_TABLES[table] && data.debt_id) {
  logDebtAudit(data.debt_id, DEBT_CHILD_TABLES[table], table, '', result?.id || '');
}
```

**Handler 14: Generic `db:delete` (remove) for debt child tables**

Find the `ipcMain.handle('db:delete', ...)` or `db:remove` handler. Before the delete, check if the record belongs to a debt:

```typescript
// Audit log for debt-related record deletion
const DEBT_TABLES = ['debt_payments', 'debt_communications', 'debt_evidence', 'debt_legal_actions',
  'debt_settlements', 'debt_disputes', 'debt_contacts', 'debt_promises', 'debt_notes'];
if (DEBT_TABLES.includes(table)) {
  try {
    const row = db.getById(table, id);
    if (row?.debt_id) logDebtAudit(row.debt_id, 'record_deleted', table, id, '');
  } catch (_) {}
}
```

**Step: Type check**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: Only the pre-existing `baseUrl` deprecation.

**Step: Commit**

```bash
git add src/main/ipc/index.ts
git commit -m "feat(dc): inject logDebtAudit into 14 existing handlers

Chain-of-custody: every debt mutation now auto-logs to debt_audit_log.
Covers: stage advance, hold toggle, assignment, fee, settlement,
compliance, payment plan, promise, quick note, field edits (generic
db:update on debts), child record create (payments, communications,
disputes), and child record delete.
Silent fail on audit errors — primary ops never blocked."
```

---

### Task 3: Audit Log UI card in DebtDetail + API method

**Files:**
- Modify: `src/renderer/lib/api.ts` (add debtAuditLog method)
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx` (add audit log state + card)

**Step 1: Add API method**

In `src/renderer/lib/api.ts`, find the debt API section (near `addDebtFee`, `collectorPerformance`, etc.). Add:

```typescript
  debtAuditLog: (debtId: string, limit?: number): Promise<any[]> =>
    window.electronAPI.invoke('debt:audit-log', { debtId, limit }),
```

**Step 2: Add audit log state to DebtDetail.tsx**

After the existing `documents` state declaration, add:

```typescript
  const [auditLog, setAuditLog] = useState<any[]>([]);
```

**Step 3: Load audit log in the data-loading section**

Find where other post-load queries happen (after the main Promise.all, near where installments and documents are loaded). Add:

```typescript
api.debtAuditLog(debtId, 100).then(r => setAuditLog(Array.isArray(r) ? r : [])).catch(() => {});
```

**Step 4: Add the Audit Log card to the RIGHT column**

Find the right column in DebtDetail (after the Documents card, before the Activity Timeline card). Add:

```tsx
{/* Card — Chain of Custody Audit Log */}
<div className="block-card p-6">
  <SectionLabel>Chain of Custody</SectionLabel>
  {auditLog.length === 0 ? (
    <p className="text-sm text-text-muted">No audit entries yet.</p>
  ) : (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {auditLog.map((entry: any) => {
        const actionLabels: Record<string, string> = {
          stage_advance: 'Stage Advanced',
          hold_toggle: 'Hold Toggled',
          assignment_change: 'Collector Assigned',
          fee_added: 'Fee Added',
          settlement_accepted: 'Settlement Accepted',
          settlement_offered: 'Settlement Offered',
          compliance_event: 'Compliance Event',
          plan_created: 'Payment Plan Created',
          promise_recorded: 'Promise Recorded',
          promise_updated: 'Promise Updated',
          note_added: 'Note Added',
          field_edit: 'Field Updated',
          payment_recorded: 'Payment Recorded',
          communication_logged: 'Communication Logged',
          dispute_filed: 'Dispute Filed',
          record_deleted: 'Record Deleted',
          interest_recalculated: 'Interest Recalculated',
        };
        const label = actionLabels[entry.action] || entry.action;
        return (
          <div key={entry.id} className="flex items-start gap-2 px-2 py-1.5 border-l-2 border-border-primary text-xs">
            <span className="text-text-muted font-mono whitespace-nowrap flex-shrink-0">
              {formatDate(entry.performed_at, { style: 'short' })}
            </span>
            <div className="min-w-0">
              <span className="text-text-primary font-semibold">{label}</span>
              {entry.field_name && (
                <span className="text-text-muted ml-1">({entry.field_name})</span>
              )}
              {entry.old_value && entry.new_value && (
                <span className="text-text-muted ml-1">
                  {entry.old_value} → {entry.new_value}
                </span>
              )}
              {!entry.old_value && entry.new_value && (
                <span className="text-text-muted ml-1">: {entry.new_value}</span>
              )}
            </div>
            <span className="text-[10px] text-text-muted ml-auto flex-shrink-0 capitalize">{entry.performed_by}</span>
          </div>
        );
      })}
    </div>
  )}
</div>
```

**CRITICAL:** This card has NO edit or delete buttons. Audit entries are immutable.

**Step: Type check**

Run: `npx tsc --noEmit 2>&1 | head -10`

**Step: Commit**

```bash
git add src/renderer/lib/api.ts src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat(dc): audit log UI card in DebtDetail

- Read-only chain-of-custody card (no edit/delete — immutable by design)
- Shows timestamped action, field name, old→new values, performer
- Loads via debt:audit-log handler, max 100 entries"
```

---

## Phase 2: Court Features

### Task 4: Court Packet Export (IPC handler + print template)

**Files:**
- Modify: `src/main/ipc/index.ts` (add `debt:generate-court-packet` handler)
- Modify: `src/renderer/lib/print-templates.ts` (add `generateCourtPacketHTML`)
- Modify: `src/renderer/lib/api.ts` (add method)
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx` (add button)

**Step 1: Add the IPC handler**

In `ipc/index.ts`, after the `debt:audit-log` handler, add `debt:generate-court-packet`. This handler aggregates data from 8+ tables and returns it as a structured object:

```typescript
ipcMain.handle('debt:generate-court-packet', async (_event, { debtId }: { debtId: string }) => {
  try {
    const dbInstance = db.getDb();
    const companyId = db.getCurrentCompanyId();
    const debt = db.getById('debts', debtId);
    if (!debt) return { error: 'Debt not found' };
    const company = companyId ? db.getById('companies', companyId) : null;

    const [communications, payments, evidence, compliance, auditLog, settlements, contacts, disputes, legalActions] = [
      dbInstance.prepare('SELECT * FROM debt_communications WHERE debt_id = ? ORDER BY logged_at ASC').all(debtId),
      dbInstance.prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY received_date ASC').all(debtId),
      dbInstance.prepare('SELECT * FROM debt_evidence WHERE debt_id = ? ORDER BY date_of_evidence ASC').all(debtId),
      dbInstance.prepare('SELECT * FROM debt_compliance_log WHERE debt_id = ? ORDER BY event_date ASC').all(debtId),
      dbInstance.prepare('SELECT * FROM debt_audit_log WHERE debt_id = ? ORDER BY performed_at ASC').all(debtId),
      dbInstance.prepare('SELECT * FROM debt_settlements WHERE debt_id = ? ORDER BY created_at ASC').all(debtId),
      dbInstance.prepare('SELECT * FROM debt_contacts WHERE debt_id = ? ORDER BY role ASC').all(debtId),
      dbInstance.prepare('SELECT * FROM debt_disputes WHERE debt_id = ? ORDER BY created_at ASC').all(debtId),
      dbInstance.prepare('SELECT * FROM debt_legal_actions WHERE debt_id = ? ORDER BY created_at ASC').all(debtId),
    ];

    return { debt, company, communications, payments, evidence, compliance, auditLog, settlements, contacts, disputes, legalActions };
  } catch (err: any) {
    return { error: err.message };
  }
});
```

**Step 2: Add `generateCourtPacketHTML` print template**

In `src/renderer/lib/print-templates.ts`, add a new exported function at the end of the file. This generates a multi-section HTML document with a table of contents. The function receives the aggregated data object from the IPC handler and produces a single HTML string.

The template should:
- Use professional legal document styling (serif font, numbered sections, page breaks between major sections)
- Include a cover page with company name, debtor name, case reference, generation date, and "CONFIDENTIAL — PREPARED FOR LEGAL PROCEEDINGS"
- Include a Table of Contents linking to each section by anchor
- Each section has a header, a brief count, and the data formatted as a table or list
- Use `@media print { .section { page-break-before: always; } }` for clean PDF pages
- Escape all user-generated strings via the `escapeHTML` helper (already exists in the file from Task 3 of the previous plan, or add one)

Due to the template's length (~200 lines of HTML), the implementer should write it following the pattern of `generateDebtPortfolioReportHTML` already in the file — similar structure, similar styling.

**Step 3: Add API method + wire button**

In `api.ts`:
```typescript
generateCourtPacket: (debtId: string): Promise<any> =>
  window.electronAPI.invoke('debt:generate-court-packet', { debtId }),
```

In `DebtDetail.tsx`, add a "Court Packet" button to the action bar (next to "Statement" and the Generate Letter dropdown):

```tsx
<button
  className="block-btn flex items-center gap-2 text-xs"
  onClick={async () => {
    const data = await api.generateCourtPacket(debtId);
    if (data?.error) { console.error(data.error); return; }
    const { generateCourtPacketHTML } = await import('../../lib/print-templates');
    const html = generateCourtPacketHTML(data);
    await api.printPreview(html, `Court Packet — ${debt?.debtor_name}`);
  }}
>
  <Scale size={14} />
  Court Packet
</button>
```

**Step: Type check + Commit**

```bash
git commit -m "feat(dc): court packet export — 11-section judge-ready PDF

- debt:generate-court-packet aggregates 8+ tables into one payload
- generateCourtPacketHTML renders cover page, TOC, and 11 data sections
- Button in DebtDetail action bar opens print preview
- Sections: statement, communications, payments, evidence, compliance,
  audit trail, settlements, contacts, disputes, legal actions"
```

---

### Task 5: Verification Affidavit Generator

**Files:**
- Modify: `src/renderer/lib/print-templates.ts` (add `generateVerificationAffidavitHTML`)
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx` (add button)

**Step 1: Add the template**

In `print-templates.ts`, add:

```typescript
export function generateVerificationAffidavitHTML(
  debt: any,
  company: any,
  signatoryName: string,
): string {
  const companyName = company?.name || 'Company';
  const companyAddr = [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
  const debtorName = debt?.debtor_name || 'Debtor';
  const fmtAmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);
  const todayLong = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { font-family: 'Times New Roman', Georgia, serif; font-size: 14px; color: #111; padding: 60px; line-height: 1.8; }
  .page { max-width: 650px; margin: 0 auto; }
  h1 { text-align: center; font-size: 18px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 32px; border-bottom: 2px solid #111; padding-bottom: 12px; }
  .section { margin-bottom: 24px; }
  .section-title { font-weight: 700; text-decoration: underline; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  td { padding: 6px 12px; border: 1px solid #ccc; font-size: 13px; }
  td:first-child { font-weight: 600; width: 40%; background: #f9f9f9; }
  .sig-block { margin-top: 48px; }
  .sig-line { border-top: 1px solid #111; width: 300px; margin-top: 48px; padding-top: 4px; }
  .notary { margin-top: 40px; border: 1px solid #ccc; padding: 20px; background: #fafafa; }
  .notary-title { font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; margin-bottom: 12px; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="page">
  <h1>Verification of Debt &mdash; Affidavit</h1>

  <div class="section">
    <p>I, <strong>${signatoryName || '[Signatory Name]'}</strong>, being duly sworn, depose and state as follows:</p>
  </div>

  <div class="section">
    <div class="section-title">1. Identity and Authority</div>
    <p>I am an authorized representative of <strong>${companyName}</strong>, located at ${companyAddr || '[Company Address]'}. I have personal knowledge of the business records and accounts maintained by ${companyName}, and I am authorized to make this verification on behalf of the company.</p>
  </div>

  <div class="section">
    <div class="section-title">2. Debt Verification</div>
    <p>The following debt is a true and accurate representation of the obligation owed by <strong>${debtorName}</strong> to ${companyName}:</p>
    <table>
      <tr><td>Debtor Name</td><td>${debtorName}</td></tr>
      <tr><td>Original Amount</td><td>${fmtAmt(debt?.original_amount)}</td></tr>
      <tr><td>Interest Accrued</td><td>${fmtAmt(debt?.interest_accrued)}</td></tr>
      <tr><td>Fees Accrued</td><td>${fmtAmt(debt?.fees_accrued)}</td></tr>
      <tr><td>Payments Made</td><td>${fmtAmt(debt?.payments_made)}</td></tr>
      <tr><td>Current Balance Due</td><td><strong>${fmtAmt(debt?.balance_due)}</strong></td></tr>
      <tr><td>Date of Original Obligation</td><td>${debt?.due_date || '[Date]'}</td></tr>
      <tr><td>Source Reference</td><td>${debt?.source_type === 'invoice' ? 'Invoice #' + (debt?.source_id?.substring(0, 8).toUpperCase() || '') : 'Manual Entry'}</td></tr>
      <tr><td>Jurisdiction</td><td>${debt?.jurisdiction || '[Jurisdiction]'}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">3. Basis of Knowledge</div>
    <p>The information set forth herein is based upon the business records of ${companyName}, which are kept in the regular course of business, made at or near the time of the events recorded, and maintained by persons with knowledge of the recorded acts and events.</p>
  </div>

  <div class="section">
    <div class="section-title">4. Verification Statement</div>
    <p>I verify under penalty of perjury that the foregoing statements are true and correct to the best of my knowledge, information, and belief. This verification is made pursuant to 15 U.S.C. &sect; 1692g of the Fair Debt Collection Practices Act.</p>
  </div>

  <div class="sig-block">
    <div class="sig-line">
      <strong>${signatoryName || '[Signatory Name]'}</strong><br>
      <span style="font-size:12px;color:#555;">Authorized Representative, ${companyName}</span>
    </div>
    <p style="margin-top:12px;">Date: ${todayLong}</p>
  </div>

  <div class="notary">
    <div class="notary-title">Notary Acknowledgment</div>
    <p>State of _________________ &nbsp;&nbsp; County of _________________</p>
    <p>Subscribed and sworn to before me this ______ day of _________________, 20_____.</p>
    <div style="margin-top:32px;border-top:1px solid #111;width:250px;padding-top:4px;">
      Notary Public<br>
      <span style="font-size:11px;">My commission expires: _______________</span>
    </div>
  </div>

  <div style="margin-top:40px;text-align:center;font-size:11px;color:#555;border-top:1px solid #ddd;padding-top:12px;">
    Generated by ${companyName} &middot; ${todayLong}
  </div>
</div></body></html>`;
}
```

**Step 2: Add button to DebtDetail**

In the action bar, add next to the Court Packet button:

```tsx
<button
  className="block-btn flex items-center gap-2 text-xs"
  onClick={async () => {
    const { generateVerificationAffidavitHTML } = await import('../../lib/print-templates');
    const html = generateVerificationAffidavitHTML(debt, activeCompany, activeCompany?.name || '');
    await api.printPreview(html, `Verification Affidavit — ${debt?.debtor_name}`);
  }}
>
  <FileText size={14} />
  Affidavit
</button>
```

**Step: Type check + Commit**

```bash
git commit -m "feat(dc): verification affidavit generator (FDCPA 1692g)

- generateVerificationAffidavitHTML with Times New Roman legal styling
- 4 sections: identity, debt verification table, basis of knowledge,
  verification statement, plus signature and notary blocks
- Button in DebtDetail action bar opens print preview"
```

---

### Task 6: LegalToolkit — Audit Trail + Court Packet sub-tabs

**Files:**
- Modify: `src/renderer/modules/debt-collection/LegalToolkit.tsx`

Add two new sub-tabs to the existing Legal Toolkit: "Audit Trail" (full filterable view of a debt's audit log) and "Court Packet" (generate button for the selected debt).

**Step 1:** Expand the `SubTab` type:

```typescript
type SubTab = 'evidence' | 'demand_letters' | 'court_filings' | 'statute_tracker' | 'bundle' | 'audit_trail' | 'court_packet';
```

**Step 2:** Add two new `SubTabBtn` entries in the tab bar (after 'bundle'):

```tsx
<SubTabBtn active={subTab === 'audit_trail'} icon={<Clock size={14} />} label="Audit Trail" onClick={() => setSubTab('audit_trail')} />
<SubTabBtn active={subTab === 'court_packet'} icon={<Scale size={14} />} label="Court Packet" onClick={() => setSubTab('court_packet')} />
```

**Step 3:** Add the render branches for both sub-tabs at the bottom of the switch/conditional:

For `audit_trail`: render the same audit log card pattern from Task 3, but full-width and with a search/filter input. Load `api.debtAuditLog(selectedDebtId)` with higher limit (500).

For `court_packet`: render a simple card with a "Generate Court Packet" button that calls `api.generateCourtPacket(selectedDebtId)` and opens print preview. Also show a "Generate Affidavit" button.

**Step: Type check + Commit**

```bash
git commit -m "feat(dc): audit trail + court packet sub-tabs in Legal Toolkit

- 'Audit Trail' sub-tab: full searchable audit log for selected debt
- 'Court Packet' sub-tab: generate court packet + affidavit buttons"
```

---

## Phase 3: Automations + Layout

### Task 7: Batch Interest Recalculation

**Files:**
- Modify: `src/main/ipc/index.ts` (add handler)
- Modify: `src/renderer/lib/api.ts` (add method)
- Modify: `src/renderer/modules/debt-collection/DebtList.tsx` (add button)

Add the `debt:batch-recalc-interest` handler exactly as specified in the design doc (Section 3B). Use the interest formulas: simple = `P * r * t`, compound = `P * (1 + r/n)^(n*t) - P`. Each recalculation logs to audit trail via `logDebtAudit`. Runs in a SQLite transaction.

Add "Recalc Interest" button to DebtList toolbar near the existing "Run Escalation" button. Show result: "Updated interest on X debts".

**Step: Type check + Commit**

```bash
git commit -m "feat(dc): batch interest recalculation

- debt:batch-recalc-interest handler with simple/compound formulas
- SQLite transaction for atomicity, audit log for each recalculation
- 'Recalc Interest' button in DebtList toolbar with result count"
```

---

### Task 8: Smart Stage Recommendations

**Files:**
- Modify: `src/main/ipc/index.ts` (add handler)
- Modify: `src/renderer/lib/api.ts` (add method)
- Modify: `src/renderer/modules/debt-collection/CollectorDashboard.tsx` (add Recommendations section)

Add `debt:smart-recommendations` handler that queries all active debts and applies the 7 rules from the design doc (Section 3C). Return `{ debtId, debtorName, recommendation, reason, priority }[]`.

Add a "Smart Recommendations" card to `CollectorDashboard.tsx` after the existing 4 action cards. Each recommendation shows the debtor name, recommendation text, reason, and a one-click action button.

**Step: Type check + Commit**

```bash
git commit -m "feat(dc): smart stage recommendations

- debt:smart-recommendations with 7 rule-based conditions
- Recommendations card in CollectorDashboard with action buttons
- Priorities: critical (statute expiring), high (legal/escalation),
  medium (settlement/advance suggestions)"
```

---

### Task 9: Payment Matching from Bank Imports

**Files:**
- Modify: `src/main/ipc/index.ts` (add handler)
- Modify: `src/renderer/lib/api.ts` (add methods)
- Create: `src/renderer/modules/debt-collection/PaymentMatchReview.tsx` (~150 lines)
- Modify: `src/renderer/modules/debt-collection/DebtList.tsx` (add button + modal)

Add `debt:match-bank-payments` handler that:
1. Queries unmatched credit-side `bank_transactions` (amount > 0, not already linked)
2. For each, searches `debts` by reference (memo contains invoice#) → auto-match
3. For amount proximity ($0.01 tolerance) → suggested match
4. Auto-matches: create `debt_payments` + audit log
5. Suggested matches: create `debt_payment_matches` with `status='pending'`

Create `PaymentMatchReview.tsx` modal component showing suggested matches. Each row: bank transaction details (date, amount, memo) → suggested debt (debtor name, balance). Accept/Reject buttons. Accept creates `debt_payments` and updates match status.

Add "Match Payments" button to DebtList toolbar. After running, if suggestions exist, open the review modal.

**Step: Type check + Commit**

```bash
git commit -m "feat(dc): bank payment matching (auto + suggested)

- debt:match-bank-payments matches bank_transactions to debts
- Auto-match by reference number in memo → creates debt_payments
- Suggested match by amount proximity → pending review
- PaymentMatchReview.tsx modal for accepting/rejecting suggestions
- 'Match Payments' button in DebtList toolbar"
```

---

### Task 10: Persistent DebtMiniList Panel

**Files:**
- Create: `src/renderer/modules/debt-collection/DebtMiniList.tsx` (~180 lines)
- Modify: `src/renderer/modules/debt-collection/index.tsx` (grid layout + state wiring)

Create `DebtMiniList.tsx` as described in the design doc (Section 1). Compact scrollable list with:
- Search input at top
- Status/stage filter dropdown
- Each row: debtor name (truncated), balance (font-mono), risk-score color dot (using existing `calcRiskScore` + `getRiskBadge`)
- Blue left border on selected row
- Click handler calls `onSelect(debtId)`

Modify `index.tsx`:
- Wrap the existing tab content area in `<div className="grid" style={{ gridTemplateColumns: '280px 1fr', height: '100%' }}>` 
- Left column: `<DebtMiniList activeDebtId={activeDebtId} onSelect={(id) => { setActiveDebtId(id); setView('detail'); }} />`
- Right column: existing tab content (everything inside the current `<div className="p-6 h-full overflow-y-auto">`)
- Import the new component
- The left panel always shows regardless of which tab is active

**IMPORTANT layout notes:**
- The outer container must be `h-full overflow-hidden` so the grid fills the module area
- The left panel must be `overflow-y-auto` for scrolling
- The right panel must be `overflow-y-auto` for its own scrolling
- The existing `<div className="p-6 h-full overflow-y-auto">` becomes the right panel — adjust padding if needed

**Step: Type check + Commit**

```bash
git commit -m "feat(dc): persistent DebtMiniList panel

- 280px left panel visible across all 6 tabs
- Search, status/stage filter, risk-score color indicators
- Selected debt highlighted with blue left border
- Click selects debt and switches to detail view
- Grid layout wraps existing tab content in right column"
```

---

## Task 11: Final Verification + Build + Deploy

**Step 1:** `npx tsc --noEmit 2>&1` — only `baseUrl` warning
**Step 2:** `npm run build 2>&1 | tail -5` — `✓ built`
**Step 3:** `npx electron-builder --mac --arm64 2>&1 | tail -3`
**Step 4:** `bash scripts/codesign-mac.sh "release/mac-arm64/Business Accounting Pro.app" 2>&1 | tail -2`
**Step 5:** Install, xattr, rebuild better-sqlite3
**Step 6:** `npm run deploy 2>&1 | tail -10`
**Step 7:** `curl -sS -o /dev/null -w "HTTP %{http_code}" https://accounting.rmpgutah.us/api/health` — expect 200

---

## Rollback plan

All schema changes are new tables (not ALTER TABLE on existing tables). To rollback: `git revert` the relevant commit. The tables stay in the DB but are unused. The `logDebtAudit` helper is a no-op if the table doesn't exist (silent catch).
