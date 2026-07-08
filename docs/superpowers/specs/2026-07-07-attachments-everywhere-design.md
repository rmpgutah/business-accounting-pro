# File & Document Attachments — Full Rollout

Date: 2026-07-07

## Problem

The app has a generic `documents` table (polymorphic `entity_type`/`entity_id`) and a Documents module that lists/uploads/tags files, but:

1. Upload only stores a pointer to wherever the source file was on disk (`file_path` = original location) — if the user moves/renames/deletes that file, the attachment silently breaks.
2. "Preview" in the Documents module is a placeholder — it never actually shows the file, only its metadata.
3. Only 6 places in the app can attach a file at all: Journal Entry Form, Debt Collection (evidence + detail), Expense capture/review, Invoice payment recorder. Ten other entity types have no attachment capability whatsoever: Vendors, Clients, Bills, Purchase Orders, Projects, Payroll/Employees, Fixed Assets, Tax Filings, Bank Reconciliation, Contracts.

## Goals

- Uploaded files survive the original source file moving/being deleted (copy into app-managed storage).
- Clicking "view" on an attachment actually shows the file: inline for PDF/images, OS-default-app for everything else.
- Every one of the ten underdeveloped entity types gets the same attach/view/delete capability via one reusable component.
- The central Documents module keeps working as a cross-entity index, including the new entity types.

## Non-Goals

- No migration of existing `documents` rows to the new copy-based storage — only new uploads are copied.
- No changes to `payments.attachment_path` or `debt_communications.attachments_json` — those stay as they are.
- No OCR, cloud storage, versioning, or file size limits/quotas.

## Design

### 1. Managed file storage (main process)

New helper in `src/main/services/` (or alongside existing file utilities): `copyIntoDocumentsStore(companyId: string, sourcePath: string): { path: string; size: number; mimeType: string }`.

- Destination: `app.getPath('userData')/documents/<companyId>/<uuid>-<originalFilename>`.
- Creates the per-company directory if missing.
- Derives `mimeType` from extension using the same mapping already inline in `documents/index.tsx` (pdf/png/jpg/jpeg/csv/xlsx/octet-stream), moved into this shared helper so it isn't duplicated per call site.

New IPC handler `documents:upload` (channel `dialog:open-file` already exists and is reused internally):

```
documents:upload({ companyId, entityType, entityId, filters? })
  → opens the native file dialog
  → if cancelled, returns null
  → else copies the file via copyIntoDocumentsStore
  → db.create('documents', { filename, file_path (copied path), file_size, mime_type, entity_type, entity_id, tags: '', uploaded_at })
  → calls scheduleAutoBackup()
  → returns the created document row
```

`api.ts` gets `uploadDocument(entityType: string, entityId: string): Promise<Document | null>` wrapping this channel. This replaces the current pattern (in `documents/index.tsx`) of calling `openFileDialog` then `api.create('documents', ...)` by hand — that module is refactored to use the new single call too, so there's one code path for "attach a file" across the whole app.

### 2. `<AttachmentsPanel>` component

`src/renderer/components/AttachmentsPanel.tsx`

Props: `{ entityType: string; entityId: string; label?: string }`.

Behavior:
- On mount (and when `entityId` changes), loads rows via `api.rawQuery('SELECT * FROM documents WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC', [entityType, entityId])`.
- Renders a compact `.block-card` list: file icon (reuses the existing `getFileIcon` mime-type logic, moved to a shared util), filename, size, uploaded date, View button, Delete button (with confirm).
- "Attach File" button calls `api.uploadDocument(entityType, entityId)`, appends the returned row to local state on success.
- Empty state: small "No files attached" line + the Attach button — no full empty-state illustration (this is a compact panel, not a standalone page).
- Self-contained: no props for styling overrides needed, matches existing card/table tokens per CLAUDE.md (no hard-coded hex, no `bg-white`/`text-gray-*`).

### 3. Document viewer

`src/renderer/components/DocumentViewerModal.tsx`, taking `{ doc: Document; onClose: () => void }`.

- PDF (`mime_type === 'application/pdf'`): `<embed src={'file://' + doc.file_path} type="application/pdf" className="w-full h-[70vh]" />`.
- Image (`mime_type` starts with `image/`): `<img src={'file://' + doc.file_path} className="max-w-full max-h-[70vh] mx-auto" />`.
- Everything else: metadata summary (current placeholder content) + an "Open in default app" button calling `api.openPath(doc.file_path)` (new thin wrapper around the existing `openPathInOS` used elsewhere via IPC — expose it as `documents:open-path` if not already reachable from renderer).
- Both `documents/index.tsx` (replacing the current placeholder preview modal) and `AttachmentsPanel`'s View button use this same modal.

### 4. Rollout to the ten modules

Each gets one line added to its detail/edit view: `<AttachmentsPanel entityType="..." entityId={record.id} />`, placed near the bottom of the existing detail layout (below the main info card, matching where Documents-style side content already sits in modules that have it, e.g. Journal Entries' attachment section).

| Module | File | entity_type |
|---|---|---|
| Vendors | `vendors-ap/Vendor360.tsx` | `vendor` |
| Clients | `clients/ClientDetail.tsx` | `client` |
| Bills | `bills/index.tsx` | `bill` |
| Purchase Orders | `purchase-orders/index.tsx` | `purchase_order` |
| Projects | `projects/ProjectDetail.tsx` | `project` |
| Payroll/Employees | `payroll/EmployeeForm.tsx` | `employee` |
| Fixed Assets | `fixed-assets/index.tsx` | `fixed_asset` |
| Tax Filings | `taxes/TaxFiling.tsx` | `tax_filing` |
| Bank Reconciliation | `bank-recon/ReconcileView.tsx` | `bank_transaction` |
| Contracts | `debt-collection/DebtDetail.tsx` | `contract` |

`client` and `project` already appear in the Documents module's entity-type filter/name-lookup; the other 8 (`vendor`, `bill`, `purchase_order`, `employee`, `fixed_asset`, `tax_filing`, `bank_transaction`, `contract`) are new and need:
- A `WHEN '<type>' THEN (SELECT <name-ish column> FROM <table> WHERE id = d.entity_id)` branch added to the `entity_name` CASE in `documents/index.tsx`'s `loadDocuments` query.
- An `<option>` added to both the filter `<select>` and the edit-modal `<select>`.
- An entry in `entityBadgeClass` (reusing existing badge color tokens — no new hex).

### 5. Data/company scoping

`documents.company_id` is already required — `AttachmentsPanel` passes `activeCompany.id` (via the existing `useCompanyStore` pattern already used everywhere) into `uploadDocument`, so uploads are scoped like every other table in the app. No schema changes needed.

## Testing

- Manual: for each of the 10 modules, open a record's detail view, attach a PDF and an image, confirm they list, view (PDF/image render inline), delete removes them and the row from `documents`.
- Confirm moving/deleting the *original* source file after upload does not break the in-app copy (proves the copy-into-store behavior).
- Confirm the central Documents module shows files uploaded from every module, with correct entity-type badge/filter/name resolution.
- `npm run build` (tsc) must pass — this touches shared types (`Document` interface, `api.ts`) used across modules.
