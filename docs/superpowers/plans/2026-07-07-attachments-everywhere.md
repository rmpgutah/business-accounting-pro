# File & Document Attachments — Full Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every entity type in the app a working "attach a file, view it, delete it" capability, backed by a copy-into-app-storage model and a real in-app viewer, instead of the current placeholder preview and 6 one-off upload call sites.

**Architecture:** A new main-process storage helper copies uploaded files into `userData/documents/<companyId>/`, exposed via one IPC handler (`documents:upload`) that also creates the `documents` row. A new renderer `<AttachmentsPanel>` component (list + upload + delete) and `<DocumentViewerModal>` (PDF/image inline, else OS-open) are built once and then dropped into 10 module detail views, plus the existing Documents module is refactored to use the same pieces.

**Tech Stack:** Electron main process (Node fs/path, better-sqlite3 via existing `db` module), React 19 + TypeScript renderer, existing `.block-card`/`.block-btn`/`.block-table` styling tokens.

---

## Spec-to-task coverage map

- Managed file storage (spec §1) → Task 1, Task 2
- `<AttachmentsPanel>` (spec §2) → Task 4
- Document viewer (spec §3) → Task 5
- Documents module refactor + entity_type extension (spec §4 intro, §4 table row for `documents/index.tsx`) → Task 6
- Rollout to 10 modules (spec §4 table) → Tasks 7–16 (Vendor, Client, Bill, PO, Project, Employee, Fixed Asset, Tax Payment, Bank Account, Contract/Debt)
- Data/company scoping (spec §5) → covered inline in Task 3 (`uploadDocument` always takes `companyId`) and every module task (each passes `activeCompany.id`)
- Final `npm run build` verification (spec Testing) → Task 17

Two spec-table rows changed during planning (per your decisions):
- **Tax Filings** → now **Tax Payments** (`taxes/TaxPayments.tsx`), `entity_type = 'tax_payment'`, attached per-row via a small modal (there is no persisted per-quarter filing record).
- **Bank Reconciliation** → now **Bank Account** (`bank-recon/BankAccountForm.tsx`), `entity_type = 'bank_account'` (ReconcileView itself is a matching workspace, not a record view).

---

### Task 1: Document storage service (mime mapping + copy-into-store)

**Files:**
- Create: `src/main/services/document-storage.ts`
- Create: `scripts/test-document-storage.cjs`
- Modify: `package.json:9` (add `test:attachments` script next to `test:loan`)

- [ ] **Step 1: Write the service**

```typescript
// src/main/services/document-storage.ts
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';

export function getMimeType(filename: string): string {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.pdf')) return 'application/pdf';
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
  if (ext.endsWith('.gif')) return 'image/gif';
  if (ext.endsWith('.csv')) return 'text/csv';
  if (ext.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

export interface StoredFile {
  path: string;
  size: number;
  mimeType: string;
}

// Copies `sourcePath` into `<userDataPath>/documents/<companyId>/<uuid>-<basename>`,
// creating the per-company directory if needed. Returns the new path so the
// caller never has to depend on the original file surviving.
export function copyIntoDocumentsStore(
  userDataPath: string,
  companyId: string,
  sourcePath: string
): StoredFile {
  const destDir = path.join(userDataPath, 'documents', companyId);
  fs.mkdirSync(destDir, { recursive: true });

  const basename = path.basename(sourcePath);
  const destPath = path.join(destDir, `${uuid()}-${basename}`);
  fs.copyFileSync(sourcePath, destPath);

  const stats = fs.statSync(destPath);
  return {
    path: destPath,
    size: stats.size,
    mimeType: getMimeType(basename),
  };
}
```

- [ ] **Step 2: Write the regression test script**

```javascript
// scripts/test-document-storage.cjs
// Regression tests for document copy-into-store + mime detection.
//
// The repo has no test runner, so this is a dependency-free assertion
// script. Run with: npm run test:attachments
// (builds the main process first, then executes against dist/ output).

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const modPath = path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'document-storage.js');
let mod;
try {
  mod = require(modPath);
} catch (e) {
  console.error(`\nCould not load compiled module at ${modPath}.`);
  console.error('Run `npm run build:main` first (or use `npm run test:attachments`).\n');
  throw e;
}

const { getMimeType, copyIntoDocumentsStore } = mod;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('document-storage regression tests\n');

test('getMimeType maps known extensions', () => {
  assert.strictEqual(getMimeType('receipt.PDF'), 'application/pdf');
  assert.strictEqual(getMimeType('photo.jpg'), 'image/jpeg');
  assert.strictEqual(getMimeType('photo.jpeg'), 'image/jpeg');
  assert.strictEqual(getMimeType('logo.png'), 'image/png');
  assert.strictEqual(getMimeType('data.csv'), 'text/csv');
  assert.strictEqual(getMimeType('book.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.strictEqual(getMimeType('notes.txt'), 'application/octet-stream');
});

test('copyIntoDocumentsStore copies the file into a per-company folder and survives source deletion', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bap-doc-test-'));
  const userDataPath = path.join(tmpRoot, 'userData');
  const sourcePath = path.join(tmpRoot, 'original-invoice.pdf');
  fs.writeFileSync(sourcePath, 'fake pdf bytes');

  const result = copyIntoDocumentsStore(userDataPath, 'company-123', sourcePath);

  assert.ok(result.path.includes(path.join('documents', 'company-123')));
  assert.strictEqual(result.mimeType, 'application/pdf');
  assert.strictEqual(result.size, fs.statSync(sourcePath).size);
  assert.ok(fs.existsSync(result.path));

  // Deleting the original must not affect the copy.
  fs.unlinkSync(sourcePath);
  assert.ok(fs.existsSync(result.path), 'copy must survive source deletion');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

console.log(`\n${passed} passed.`);
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add this line immediately after `"test:loan": "npm run build:main && node scripts/test-loan-calculator.cjs",`:

```json
    "test:attachments": "npm run build:main && node scripts/test-document-storage.cjs",
```

- [ ] **Step 4: Run the test and verify it fails (module doesn't exist yet is expected to pass once built — instead verify the assertions are meaningful by temporarily breaking one)**

Run: `npm run test:attachments`
Expected: all assertions PASS (the implementation was written in Step 1, so this validates the happy path). To confirm the test actually catches regressions, temporarily change `getMimeType`'s `.pdf` branch to return `'wrong/type'`, rerun, confirm it fails with an `AssertionError`, then revert.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/document-storage.ts scripts/test-document-storage.cjs package.json
git commit -m "feat(documents): add copy-into-store service with regression tests"
```

---

### Task 2: IPC handlers — `documents:upload` and `documents:open-path`

**Files:**
- Modify: `src/main/ipc/index.ts:1` (import), `src/main/ipc/index.ts:4912-4922` (add new handlers after existing `dialog:open-file`)

- [ ] **Step 1: Add the `app` import and the new service import**

At `src/main/ipc/index.ts:1`, change:

```typescript
import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
```

to:

```typescript
import { ipcMain, BrowserWindow, dialog, shell, app } from 'electron';
```

Then, immediately after the existing line `import { generateInvoicePDF, buildInvoiceHTML } from '../services/pdf-generator';` (currently line 11), add:

```typescript
import { copyIntoDocumentsStore } from '../services/document-storage';
```

- [ ] **Step 2: Add the two IPC handlers**

In `src/main/ipc/index.ts`, immediately after the existing block (currently lines 4912–4922):

```typescript
  // ─── File Dialog ────────────────────────────────────────
  ipcMain.handle('dialog:open-file', async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stats = fs.statSync(filePath);
    return { path: filePath, name: path.basename(filePath), size: stats.size };
  });
```

add this new block right after it:

```typescript
  // ─── Document Upload (copies file into app-managed storage) ──
  ipcMain.handle('documents:upload', async (_event, args: {
    companyId: string;
    entityType: string;
    entityId: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => {
    const { companyId, entityType, entityId, filters } = args;
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const sourcePath = result.filePaths[0];
    const filename = path.basename(sourcePath);
    const stored = copyIntoDocumentsStore(app.getPath('userData'), companyId, sourcePath);

    const doc = db.create('documents', {
      company_id: companyId,
      filename,
      file_path: stored.path,
      file_size: stored.size,
      mime_type: stored.mimeType,
      entity_type: entityType,
      entity_id: entityId,
      tags: '',
      uploaded_at: new Date().toISOString(),
    });
    scheduleAutoBackup();
    return doc;
  });

  // ─── Open a stored document in the OS default app ────────────
  ipcMain.handle('documents:open-path', async (_event, filePath: string) => {
    return openPathInOS(filePath);
  });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. (`openPathInOS` and `db` are already imported at the top of this file — confirmed by existing usage at `src/main/ipc/index.ts:5067` and `:7318`.)

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/index.ts
git commit -m "feat(documents): add documents:upload and documents:open-path IPC handlers"
```

---

### Task 3: Renderer API wrappers

**Files:**
- Modify: `src/renderer/lib/api.ts` (add two methods near the existing `openFileDialog`)
- Modify: `src/shared/types.ts:474-487` (no change needed — `Document` interface already matches; verify only)

- [ ] **Step 1: Add `uploadDocument` and `openPath` to `api.ts`**

Immediately after the existing block:

```typescript
  // File dialog
  openFileDialog: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) =>
    invoke('dialog:open-file', options),
```

add:

```typescript
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/api.ts
git commit -m "feat(documents): add uploadDocument/openPath to renderer api"
```

---

### Task 4: `<AttachmentsPanel>` component

**Files:**
- Create: `src/renderer/components/AttachmentsPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React, { useEffect, useState } from 'react';
import { Paperclip, Upload, Trash2, Eye, File, Image, FileSpreadsheet, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import { useCompanyStore } from '../stores/companyStore';
import type { Document } from '../../shared/types';
import DocumentViewerModal from './DocumentViewerModal';

interface AttachmentsPanelProps {
  entityType: string;
  entityId: string;
  label?: string;
}

const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const getFileIcon = (mime: string) => {
  if (mime?.startsWith('image/')) return Image;
  if (mime?.includes('spreadsheet') || mime?.includes('csv')) return FileSpreadsheet;
  if (mime === 'application/pdf') return FileText;
  return File;
};

const AttachmentsPanel: React.FC<AttachmentsPanelProps> = ({ entityType, entityId, label = 'Attachments' }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    if (!entityId) { setLoading(false); return; }
    try {
      const rows = await api.rawQuery(
        'SELECT * FROM documents WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC',
        [entityType, entityId]
      );
      setDocs(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      console.error('Failed to load attachments:', err);
      setError(err?.message || 'Failed to load attachments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const handleUpload = async () => {
    if (!activeCompany || !entityId) return;
    setUploading(true);
    setError('');
    try {
      const doc = await api.uploadDocument(activeCompany.id, entityType, entityId);
      if (doc) setDocs((prev) => [doc, ...prev]);
    } catch (err: any) {
      console.error('Failed to upload attachment:', err);
      setError(err?.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this attachment?')) return;
    try {
      await api.remove('documents', id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      console.error('Failed to delete attachment:', err);
      setError(err?.message || 'Failed to delete attachment');
    }
  };

  if (!entityId) return null;

  return (
    <div className="block-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip size={14} className="text-text-muted" />
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</span>
        </div>
        <button
          type="button"
          className="block-btn flex items-center gap-1.5 text-xs"
          onClick={handleUpload}
          disabled={uploading}
        >
          <Upload size={12} />
          {uploading ? 'Uploading...' : 'Attach File'}
        </button>
      </div>

      {error && <div className="text-xs text-accent-expense">{error}</div>}

      {loading ? (
        <div className="text-xs text-text-muted">Loading...</div>
      ) : docs.length === 0 ? (
        <div className="text-xs text-text-muted">No files attached.</div>
      ) : (
        <div className="space-y-1">
          {docs.map((doc) => {
            const FileIcon = getFileIcon(doc.mime_type);
            return (
              <div key={doc.id} className="flex items-center justify-between gap-2 py-1 border-t border-hairline first:border-t-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon size={14} className="text-text-muted shrink-0" />
                  <span className="text-xs text-text-primary truncate">{doc.filename}</span>
                  <span className="text-[10px] text-text-muted shrink-0">{formatFileSize(doc.file_size)}</span>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {doc.uploaded_at ? format(parseISO(doc.uploaded_at), 'MMM d, yyyy') : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="text-text-muted hover:text-accent-blue transition-colors p-1"
                    onClick={() => setViewingDoc(doc)}
                    title="View"
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    type="button"
                    className="text-text-muted hover:text-accent-expense transition-colors p-1"
                    onClick={() => handleDelete(doc.id)}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewingDoc && <DocumentViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />}
    </div>
  );
};

export default AttachmentsPanel;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: fails at this point with `Cannot find module './DocumentViewerModal'` — this is expected since Task 5 creates it. Note the error and proceed to Task 5 before re-running.

- [ ] **Step 3: Commit** (deferred to end of Task 5, since this file doesn't typecheck standalone)

---

### Task 5: `<DocumentViewerModal>` component + Documents module wiring

**Files:**
- Create: `src/renderer/components/DocumentViewerModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { X, ExternalLink } from 'lucide-react';
import type { Document } from '../../shared/types';
import api from '../lib/api';

interface DocumentViewerModalProps {
  doc: Document;
  onClose: () => void;
}

const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({ doc, onClose }) => {
  const isPdf = doc.mime_type === 'application/pdf';
  const isImage = doc.mime_type?.startsWith('image/');
  const fileUrl = `file://${doc.file_path}`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="block-card-elevated w-full max-w-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary truncate">{doc.filename}</h3>
          <button className="text-text-muted hover:text-text-primary transition-colors" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {isPdf && (
          <embed src={fileUrl} type="application/pdf" className="w-full h-[70vh]" />
        )}

        {isImage && (
          <img src={fileUrl} alt={doc.filename} className="max-w-full max-h-[70vh] mx-auto" />
        )}

        {!isPdf && !isImage && (
          <div className="space-y-3">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Type</span>
                <span className="text-text-secondary">{doc.mime_type || 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Size</span>
                <span className="text-text-secondary font-mono">{formatFileSize(doc.file_size)}</span>
              </div>
            </div>
            <button
              type="button"
              className="block-btn-primary flex items-center gap-2"
              onClick={() => api.openPath(doc.file_path)}
            >
              <ExternalLink size={14} />
              Open in Default App
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentViewerModal;
```

- [ ] **Step 2: Typecheck both new components together**

Run: `npm run typecheck`
Expected: no errors involving `AttachmentsPanel.tsx` or `DocumentViewerModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/AttachmentsPanel.tsx src/renderer/components/DocumentViewerModal.tsx
git commit -m "feat(documents): add reusable AttachmentsPanel and DocumentViewerModal"
```

---

### Task 6: Refactor the Documents module to use the new upload/viewer + extend entity types

**Files:**
- Modify: `src/renderer/modules/documents/index.tsx`

- [ ] **Step 1: Replace the hand-rolled upload logic with `api.uploadDocument`**

Replace the existing `handleUpload` function (currently lines 105–135):

```tsx
  const handleUpload = async () => {
    try {
      const file = await api.openFileDialog();
      if (!file) return; // user cancelled

      const mimeType = file.name.endsWith('.pdf') ? 'application/pdf'
        : file.name.endsWith('.png') ? 'image/png'
        : file.name.endsWith('.jpg') || file.name.endsWith('.jpeg') ? 'image/jpeg'
        : file.name.endsWith('.csv') ? 'text/csv'
        : file.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/octet-stream';

      const doc = await api.create('documents', {
        filename: file.name,
        file_path: file.path,
        file_size: file.size,
        mime_type: mimeType,
        entity_type: '',
        entity_id: '',
        tags: '',
        uploaded_at: new Date().toISOString(),
      });

      setDocuments((prev) => [doc, ...prev]);
      setOpSuccess('Document uploaded'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      // VISIBILITY: surface upload errors via banner instead of duplicate alert
      console.error('Failed to upload document:', err);
      setOpError('Failed to upload: ' + (err?.message || String(err))); setTimeout(() => setOpError(''), 5000);
    }
  };
```

with:

```tsx
  const handleUpload = async () => {
    if (!activeCompany) return;
    try {
      const doc = await api.uploadDocument(activeCompany.id, '', '');
      if (!doc) return; // user cancelled
      setDocuments((prev) => [doc, ...prev]);
      setOpSuccess('Document uploaded'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      // VISIBILITY: surface upload errors via banner instead of duplicate alert
      console.error('Failed to upload document:', err);
      setOpError('Failed to upload: ' + (err?.message || String(err))); setTimeout(() => setOpError(''), 5000);
    }
  };
```

- [ ] **Step 2: Extend the `entity_name` CASE, the filter `<select>`, the edit-modal `<select>`, and `entityBadgeClass` with the 8 new entity types**

In the `loadDocuments` function, replace this SQL string (currently lines 78–91's template literal body):

```sql
        `SELECT d.*,
           CASE d.entity_type
             WHEN 'client'  THEN (SELECT name FROM clients WHERE id = d.entity_id)
             WHEN 'invoice' THEN (SELECT invoice_number FROM invoices WHERE id = d.entity_id)
             WHEN 'project' THEN (SELECT name FROM projects WHERE id = d.entity_id)
             WHEN 'expense' THEN (SELECT description FROM expenses WHERE id = d.entity_id)
           END AS entity_name
         FROM documents d
         WHERE d.company_id = ?
         ORDER BY d.uploaded_at DESC
         LIMIT 1000`,
```

with:

```sql
        `SELECT d.*,
           CASE d.entity_type
             WHEN 'client'         THEN (SELECT name FROM clients WHERE id = d.entity_id)
             WHEN 'invoice'        THEN (SELECT invoice_number FROM invoices WHERE id = d.entity_id)
             WHEN 'project'        THEN (SELECT name FROM projects WHERE id = d.entity_id)
             WHEN 'expense'        THEN (SELECT description FROM expenses WHERE id = d.entity_id)
             WHEN 'vendor'         THEN (SELECT name FROM vendors WHERE id = d.entity_id)
             WHEN 'bill'           THEN (SELECT bill_number FROM bills WHERE id = d.entity_id)
             WHEN 'purchase_order' THEN (SELECT po_number FROM purchase_orders WHERE id = d.entity_id)
             WHEN 'employee'       THEN (SELECT name FROM employees WHERE id = d.entity_id)
             WHEN 'fixed_asset'    THEN (SELECT name FROM fixed_assets WHERE id = d.entity_id)
             WHEN 'tax_payment'    THEN (SELECT confirmation_number FROM tax_payments WHERE id = d.entity_id)
             WHEN 'bank_account'   THEN (SELECT name FROM bank_accounts WHERE id = d.entity_id)
             WHEN 'debt'           THEN (SELECT debtor_name FROM debts WHERE id = d.entity_id)
           END AS entity_name
         FROM documents d
         WHERE d.company_id = ?
         ORDER BY d.uploaded_at DESC
         LIMIT 1000`,
```

(If any of `vendors.name`, `bills.bill_number`, `purchase_orders.po_number`, `employees.name`, `fixed_assets.name`, `tax_payments.confirmation_number`, `bank_accounts.name`, `debts.debtor_name` doesn't match the actual schema column, grep `schema.sql` for the exact table/column name before this step and adjust — do not guess a second time.)

Replace the type definition (currently line 25):

```tsx
type EntityFilter = '' | 'client' | 'invoice' | 'expense' | 'project';
```

with:

```tsx
type EntityFilter = '' | 'client' | 'invoice' | 'expense' | 'project'
  | 'vendor' | 'bill' | 'purchase_order' | 'employee' | 'fixed_asset' | 'tax_payment' | 'bank_account' | 'debt';
```

Replace `entityBadgeClass` (currently lines 42–47):

```tsx
const entityBadgeClass: Record<string, string> = {
  client: 'block-badge block-badge-blue',
  invoice: 'block-badge block-badge-income',
  expense: 'block-badge block-badge-expense',
  project: 'block-badge block-badge-purple',
};
```

with:

```tsx
const entityBadgeClass: Record<string, string> = {
  client: 'block-badge block-badge-blue',
  invoice: 'block-badge block-badge-income',
  expense: 'block-badge block-badge-expense',
  project: 'block-badge block-badge-purple',
  vendor: 'block-badge block-badge-blue',
  bill: 'block-badge block-badge-expense',
  purchase_order: 'block-badge block-badge-purple',
  employee: 'block-badge block-badge-blue',
  fixed_asset: 'block-badge block-badge-purple',
  tax_payment: 'block-badge block-badge-warning',
  bank_account: 'block-badge block-badge-blue',
  debt: 'block-badge block-badge-expense',
};
```

In the filter `<select>` (currently lines 259–264), replace:

```tsx
              <option value="">All Entity Types</option>
              <option value="client">Client</option>
              <option value="invoice">Invoice</option>
              <option value="expense">Expense</option>
              <option value="project">Project</option>
```

with:

```tsx
              <option value="">All Entity Types</option>
              <option value="client">Client</option>
              <option value="invoice">Invoice</option>
              <option value="expense">Expense</option>
              <option value="project">Project</option>
              <option value="vendor">Vendor</option>
              <option value="bill">Bill</option>
              <option value="purchase_order">Purchase Order</option>
              <option value="employee">Employee</option>
              <option value="fixed_asset">Fixed Asset</option>
              <option value="tax_payment">Tax Payment</option>
              <option value="bank_account">Bank Account</option>
              <option value="debt">Debt</option>
```

Apply the identical 8-option addition to the edit-modal `<select>` (currently lines 400–405, same option list as above).

- [ ] **Step 3: Replace the placeholder preview modal with `<DocumentViewerModal>`**

Replace the entire "Preview Modal" block (currently lines 427–484):

```tsx
      {/* Preview Modal */}
      {previewDoc && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 cursor-pointer"
          onClick={() => setPreviewDoc(null)}
        >
          ...
        </div>
      )}
```

with:

```tsx
      {previewDoc && (
        <DocumentViewerModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
```

Add the import near the top (after `import ErrorBanner from '../../components/ErrorBanner';`):

```tsx
import DocumentViewerModal from '../../components/DocumentViewerModal';
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If the entity_name CASE references a column that doesn't exist, `tsc` won't catch it (it's a runtime SQL string) — instead run the app (`npm run dev`) and open the Documents module to confirm `loadDocuments` doesn't throw. If it throws "no such column", grep `schema.sql` for the correct column and fix the CASE branch.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/documents/index.tsx
git commit -m "refactor(documents): use shared upload/viewer, add 8 new entity types"
```

---

### Task 7: Wire into Vendors (`Vendor360.tsx`)

**Files:**
- Modify: `src/renderer/modules/vendors-ap/Vendor360.tsx`

- [ ] **Step 1: Add the import**

After the existing import block (ends at `src/renderer/modules/vendors-ap/Vendor360.tsx:8`, `import { useNavigation } from '../../lib/navigation';`), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel**

Find the closing of the notes/activity grid (currently around line 195–196):

```tsx
        </Section>
      </div>
    </div>
  );
```

Insert `<AttachmentsPanel>` between the two closing `</div>`s:

```tsx
        </Section>
      </div>
      <div className="mt-6">
        <AttachmentsPanel entityType="vendor" entityId={vendorId} />
      </div>
    </div>
  );
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/vendors-ap/Vendor360.tsx
git commit -m "feat(vendors): add file attachments to vendor detail view"
```

---

### Task 8: Wire into Clients (`ClientDetail.tsx`)

**Files:**
- Modify: `src/renderer/modules/clients/ClientDetail.tsx`

- [ ] **Step 1: Add the import**

After the existing import block (ends at `src/renderer/modules/clients/ClientDetail.tsx:47`, `import EntityChip from '../../components/EntityChip';`), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel next to the existing cross-integration panels**

Find (currently lines 937–940):

```tsx
        <div className="grid grid-cols-2 gap-4 mt-...">
          <RelatedPanel entityType="client" entityId={clientId} />
          <EntityTimeline entityType="client" entityId={clientId} />
        </div>
```

Replace with:

```tsx
        <div className="grid grid-cols-2 gap-4 mt-...">
          <RelatedPanel entityType="client" entityId={clientId} />
          <EntityTimeline entityType="client" entityId={clientId} />
        </div>
        <div className="mt-4">
          <AttachmentsPanel entityType="client" entityId={clientId} />
        </div>
```

(Keep whatever the real `mt-...` class value is — do not change it, only append the new block after.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/clients/ClientDetail.tsx
git commit -m "feat(clients): add file attachments to client detail view"
```

---

### Task 9: Wire into Bills (`BillDetail` in `bills/index.tsx`)

**Files:**
- Modify: `src/renderer/modules/bills/index.tsx`

**Caveat:** this file contains multiple components (`BillsList`, `BillForm`, `BillDetail`, `BillsDashboard`, `BillsModule`). Only touch `BillDetail` (currently lines 2106–2613). Do not add this to `BillForm` — it's used for creating brand-new bills where no `billId` exists yet.

- [ ] **Step 1: Add the import**

After the existing import block (ends at `src/renderer/modules/bills/index.tsx:36`, `import { useNavigation } from '../../lib/navigation';`), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel inside `BillDetail`'s cross-integration block**

Find (currently lines 2484–2488, inside `BillDetail`):

```tsx
      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="bill" entityId={billId} hide={['lines', 'payments']} />
        <EntityTimeline entityType="bills" entityId={billId} />
      </div>
```

Replace with:

```tsx
      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="bill" entityId={billId} hide={['lines', 'payments']} />
        <EntityTimeline entityType="bills" entityId={billId} />
      </div>
      <div className="mt-4">
        <AttachmentsPanel entityType="bill" entityId={billId} />
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/bills/index.tsx
git commit -m "feat(bills): add file attachments to bill detail view"
```

---

### Task 10: Wire into Purchase Orders (`PODetail` in `purchase-orders/index.tsx`)

**Files:**
- Modify: `src/renderer/modules/purchase-orders/index.tsx`

**Caveat:** only touch `PODetail` (currently lines 786–1163), not `POForm` (used for create+edit, `editId` may be undefined for new POs).

- [ ] **Step 1: Add the import**

After the existing import block (ends at `src/renderer/modules/purchase-orders/index.tsx:13`, `import EntityChip from '../../components/EntityChip';`), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel inside `PODetail`'s cross-integration block**

Find (currently lines 1142–1145):

```tsx
      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="purchase_order" entityId={poId} hide={['lines']} />
        <EntityTimeline entityType="purchase_orders" entityId={poId} />
      </div>
```

Replace with:

```tsx
      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="purchase_order" entityId={poId} hide={['lines']} />
        <EntityTimeline entityType="purchase_orders" entityId={poId} />
      </div>
      <div className="mt-4">
        <AttachmentsPanel entityType="purchase_order" entityId={poId} />
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/purchase-orders/index.tsx
git commit -m "feat(purchase-orders): add file attachments to PO detail view"
```

---

### Task 11: Wire into Projects (`ProjectDetail.tsx`)

**Files:**
- Modify: `src/renderer/modules/projects/ProjectDetail.tsx`

**Note:** this file doesn't yet have a `RelatedPanel`/`EntityTimeline` cross-integration block — this is the first one added here.

- [ ] **Step 1: Add the import**

After the existing import block (ends at `src/renderer/modules/projects/ProjectDetail.tsx:15`, `import { useCompanyStore } from '../../stores/companyStore';`), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel before the component's closing return**

Find (currently lines 408–414):

```tsx
        {activeTab === 'invoices' && (
          <InvoicesTab invoices={invoices} />
        )}
      </div>
    </div>
  );
};
```

Replace with:

```tsx
        {activeTab === 'invoices' && (
          <InvoicesTab invoices={invoices} />
        )}
      </div>
      <div className="mt-4">
        <AttachmentsPanel entityType="project" entityId={projectId} />
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/projects/ProjectDetail.tsx
git commit -m "feat(projects): add file attachments to project detail view"
```

---

### Task 12: Wire into Payroll/Employees (`EmployeeForm.tsx`)

**Files:**
- Modify: `src/renderer/modules/payroll/EmployeeForm.tsx`

**Caveat:** this form handles both create and edit. The existing cross-integration block is already guarded with `isEditing && employeeId` — follow the same guard.

- [ ] **Step 1: Add the import**

Immediately after `src/renderer/modules/payroll/EmployeeForm.tsx:6` (`import EntityTimeline from '../../components/EntityTimeline';`), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel inside the existing guarded block**

Find (currently lines 2345–2351):

```tsx
      {/* Cross-integration panels (memoized components + stable props) */}
      {isEditing && employeeId && (
        <div className="grid grid-cols-2 gap-4 mt-6">
          <MemoRelatedPanel entityType="employee" entityId={employeeId} hide={HIDE_PAYSTUBS} />
          <MemoEntityTimeline entityType="employees" entityId={employeeId} />
        </div>
      )}
```

Replace with:

```tsx
      {/* Cross-integration panels (memoized components + stable props) */}
      {isEditing && employeeId && (
        <div className="grid grid-cols-2 gap-4 mt-6">
          <MemoRelatedPanel entityType="employee" entityId={employeeId} hide={HIDE_PAYSTUBS} />
          <MemoEntityTimeline entityType="employees" entityId={employeeId} />
        </div>
      )}
      {isEditing && employeeId && (
        <div className="mt-4">
          <AttachmentsPanel entityType="employee" entityId={employeeId} />
        </div>
      )}
```

(Skip introducing a `MemoAttachmentsPanel` wrapper — `AttachmentsPanel` only re-renders on `entityId`/`entityType` change already via its own effect dependency array, and this file's existing memoization is for panels that receive unstable inline props like `hide={HIDE_PAYSTUBS}` arrays; not needed here since `AttachmentsPanel` takes only primitive props.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/payroll/EmployeeForm.tsx
git commit -m "feat(payroll): add file attachments to employee detail view"
```

---

### Task 13: Wire into Fixed Assets (`AssetDetail` in `fixed-assets/index.tsx`)

**Files:**
- Modify: `src/renderer/modules/fixed-assets/index.tsx`

**Caveat:** only touch `AssetDetail` (currently lines 1272–1645), not `AssetForm` (create+edit combined).

- [ ] **Step 1: Add the import**

Immediately after `src/renderer/modules/fixed-assets/index.tsx:20` (the closing line of the multi-line `classifications` import), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel inside `AssetDetail`'s cross-integration block**

Find (currently lines 1595–1599):

```tsx
      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-2">
        <RelatedPanel entityType="fixed_asset" entityId={assetId} />
        <EntityTimeline entityType="fixed_assets" entityId={assetId} />
      </div>
```

Replace with:

```tsx
      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-2">
        <RelatedPanel entityType="fixed_asset" entityId={assetId} />
        <EntityTimeline entityType="fixed_assets" entityId={assetId} />
      </div>
      <div className="mt-4">
        <AttachmentsPanel entityType="fixed_asset" entityId={assetId} />
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/fixed-assets/index.tsx
git commit -m "feat(fixed-assets): add file attachments to asset detail view"
```

---

### Task 14: Wire into Tax Payments (per-row modal in `taxes/TaxPayments.tsx`)

**Files:**
- Modify: `src/renderer/modules/taxes/TaxPayments.tsx`

**Note:** unlike the other 9 modules, this is a flat table with no per-row detail view — attachments are exposed via a small per-row modal, matching the "editingDoc modal" pattern already used in `documents/index.tsx`.

- [ ] **Step 1: Add imports**

Change line 1–2:

```tsx
import React, { useEffect, useState } from 'react';
import { CreditCard, Plus, X } from 'lucide-react';
```

to:

```tsx
import React, { useEffect, useState } from 'react';
import { CreditCard, Plus, X, Paperclip } from 'lucide-react';
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add modal state**

In the component body, immediately after the existing state declarations (currently `const [formError, setFormError] = useState('');`), add:

```tsx
  const [attachmentsPaymentId, setAttachmentsPaymentId] = useState<string | null>(null);
```

- [ ] **Step 3: Add an "Attachments" column**

In the table header (currently the `<thead><tr>` block with `Type`, `Amount`, `Date`, `Period`, `Year`, `Confirmation #`), add a final column:

```tsx
                <th>Confirmation #</th>
                <th className="text-center">Files</th>
```

(replacing the existing lone `<th>Confirmation #</th>` closing tag — i.e. keep it and add the new `<th>` right after it).

In the table body, add a matching `<td>` right after the confirmation number cell:

```tsx
                  <td className="font-mono text-text-muted text-xs">
                    {p.confirmation_number || '-'}
                  </td>
                  <td className="text-center">
                    <button
                      type="button"
                      className="text-text-muted hover:text-accent-blue transition-colors p-1"
                      onClick={() => setAttachmentsPaymentId(p.id)}
                      title="Attachments"
                    >
                      <Paperclip size={14} />
                    </button>
                  </td>
```

In the `<tfoot>` row, extend `colSpan` by 1 to keep the footer aligned:

```tsx
                <td colSpan={4} />
```

becomes:

```tsx
                <td colSpan={5} />
```

- [ ] **Step 4: Add the modal**

Immediately before the component's final closing `</div>` and `);` (end of the returned JSX, right before `export default TaxPayments;`), add:

```tsx
      {attachmentsPaymentId && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setAttachmentsPaymentId(null)}
        >
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <AttachmentsPanel entityType="tax_payment" entityId={attachmentsPaymentId} />
          </div>
        </div>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/taxes/TaxPayments.tsx
git commit -m "feat(taxes): add per-payment file attachments"
```

---

### Task 15: Wire into Bank Accounts (`BankAccountForm.tsx`)

**Files:**
- Modify: `src/renderer/modules/bank-recon/BankAccountForm.tsx`

**Caveat:** guard on `isEditing && account` — new (unsaved) accounts have no id yet, same pattern as Task 12.

- [ ] **Step 1: Add the import**

After `src/renderer/modules/bank-recon/BankAccountForm.tsx:5` (`import type { BankAccount } from './BankAccountList';`), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel before the Actions block**

Find (currently around lines 227–242, ending right before `{/* Actions */}`):

```tsx
          {/* Balance */}
          <div>
            <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
              Current Balance
            </label>
            <input
              type="number"
              step="0.01"
              className="block-input w-full"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
```

Replace with:

```tsx
          {/* Balance */}
          <div>
            <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
              Current Balance
            </label>
            <input
              type="number"
              step="0.01"
              className="block-input w-full"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </div>
        </div>

        {isEditing && account && (
          <AttachmentsPanel entityType="bank_account" entityId={account.id} />
        )}

        {/* Actions */}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/bank-recon/BankAccountForm.tsx
git commit -m "feat(bank-recon): add file attachments to bank account form"
```

---

### Task 16: Wire into Contracts/Debt Collection (`DebtDetail.tsx`)

**Files:**
- Modify: `src/renderer/modules/debt-collection/DebtDetail.tsx`

- [ ] **Step 1: Add the import**

After `src/renderer/modules/debt-collection/DebtDetail.tsx:39` (`import CollectionCostsPanel from './CollectionCostsPanel';`), add:

```tsx
import AttachmentsPanel from '../../components/AttachmentsPanel';
```

- [ ] **Step 2: Add the panel inside the existing cross-entity block**

Find (currently lines 2413–2417):

```tsx
      {/* ── Cross-entity integration ────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="debt" entityId={debtId} hide={['comms', 'evidence', 'contacts', 'payments']} />
        <EntityTimeline entityType="debts" entityId={debtId} />
      </div>
```

Replace with:

```tsx
      {/* ── Cross-entity integration ────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="debt" entityId={debtId} hide={['comms', 'evidence', 'contacts', 'payments']} />
        <EntityTimeline entityType="debts" entityId={debtId} />
      </div>
      <div className="mt-4">
        <AttachmentsPanel entityType="debt" entityId={debtId} label="Contracts & Documents" />
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat(debt-collection): add contract/document attachments to debt detail view"
```

---

### Task 17: Full build verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: `Found 0 errors.` for both the main and renderer tsconfig projects.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: exits 0, produces `dist/main` and `dist/renderer` output with no errors.

- [ ] **Step 3: Run the new regression test**

Run: `npm run test:attachments`
Expected: all assertions print `✓` and the script exits 0.

- [ ] **Step 4: Manual smoke test (per the spec's Testing section)**

Start the app (`npm run dev`), then for at least 3 of the 10 wired modules (pick Vendors, Bills, and Tax Payments to cover both the standard detail-view pattern and the per-row-modal pattern):
1. Open a record's detail view (or, for Tax Payments, click the paperclip icon on a row).
2. Click "Attach File", pick a PDF and confirm it appears in the list immediately.
3. Click the Eye icon — confirm the PDF renders inline in the modal.
4. Attach an image, confirm it renders inline too.
5. Click Delete on one attachment, confirm it disappears from the list and (via the Documents module) from the global list too.
6. Open the Documents module (main nav), confirm the uploaded files show up with the correct entity-type badge (e.g. "vendor", "bill") and that the filter dropdown can filter to just that type.
7. In Finder/Terminal, locate and delete the *original* source file you attached from (the one you picked in the file dialog, not the app's copy) — confirm the attachment still displays and views correctly, proving the copy-into-store behavior works.

- [ ] **Step 5: Commit any fixes found during smoke testing, otherwise no commit needed for this task.**

---

## Notes for the implementer

- Every module task follows the same shape: add one import line, add one `<AttachmentsPanel entityType="..." entityId={...} />` block. If a module's actual surrounding code differs slightly from what's quoted here (e.g. a different `mt-*` class, or lines have shifted because an earlier task in this plan touched a shared file), match on the *nearest unique anchor text* shown (e.g. the `{/* Cross-integration panels */}` comment) rather than the exact line number.
- Tasks 7–16 are independent of each other (different files) and can be parallelized across subagents if using subagent-driven-development — only Tasks 1–6 must run in order first, since every later task imports `AttachmentsPanel`.
- If `npm run typecheck` reveals that a quoted "existing pattern" snippet in Tasks 8–16 doesn't match the real file content (the exploration this plan was based on may be slightly stale), re-read the actual file section before editing rather than forcing the quoted diff.
