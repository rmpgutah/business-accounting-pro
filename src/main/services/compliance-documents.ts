// src/main/services/compliance-documents.ts
//
// Compliance document storage for forms RECEIVED from third parties:
//   • W-4   — Employee's Withholding Certificate (collected at hire,
//             refreshed when the employee has a life event)
//   • W-9   — Vendor's TIN request (collected before any 1099-eligible
//             payment; best practice = annual re-verify)
//   • I-9   — Employment Eligibility Verification (DHS form, must be
//             on file within 3 days of hire, retained 3 years OR 1
//             year after termination, whichever is later)
//   • W-8BEN / W-8BEN-E — Foreign-person versions of W-9
//   • state-W-4 — Per-state withholding certificates
//
// This is a paradigm flip from form-944, form-1099-nec, etc.: those
// forms are ISSUED by the business and computed from accounting data.
// W-4 / W-9 / I-9 are RECEIVED from employees/vendors and stored.
// We provide:
//   1. Pre-filled blanks (employer/payer section filled, recipient
//      section blank) for handing to new hires/vendors
//   2. Storage (link uploaded PDF → person + form_type + dates)
//   3. Reminders (missing required forms, expiring forms)

import * as db from '../database';
import { v4 as uuid } from 'uuid';

export type ComplianceFormType = 'W-4' | 'W-9' | 'I-9' | 'W-8BEN' | 'W-8BEN-E' | 'state-W-4';
export type CompliancePersonType = 'employee' | 'vendor' | 'client';
export type ComplianceStatus = 'current' | 'expired' | 'pending' | 'rejected' | 'superseded';

export interface ComplianceDocument {
  id: string;
  company_id: string;
  person_type: CompliancePersonType;
  person_id: string;
  form_type: ComplianceFormType;
  document_id?: string;
  document_filename: string;
  effective_date?: string;
  expires_at?: string;
  section_1_complete: number;
  section_2_complete: number;
  section_3_complete: number;
  status: ComplianceStatus;
  notes: string;
  metadata: string;                  // JSON blob for form-specific data
  uploaded_at: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface ComplianceWithPerson extends ComplianceDocument {
  person_name: string;               // Joined from employees/vendors/clients
  person_email: string;
}

export interface ComplianceMissing {
  person_type: CompliancePersonType;
  person_id: string;
  person_name: string;
  required_forms: ComplianceFormType[];   // What's missing
  hire_date?: string;                     // For I-9 deadline calc
  days_overdue: number;                   // For I-9: hire_date + 3 business days
}

// ── Form requirements per person type ─────────────────────────

/**
 * Required compliance forms per person type. Drives the "missing forms"
 * check — if a person doesn't have a 'current' record for each required
 * form, they appear in the missing-forms list.
 */
const REQUIRED_FORMS: Record<CompliancePersonType, ComplianceFormType[]> = {
  employee: ['W-4', 'I-9'],
  vendor: ['W-9'],
  client: [],   // clients aren't typically subject to compliance forms
};

/**
 * Renewal cadence per form type. Used to compute expires_at when
 * effective_date is provided. Days = renewal interval; null = never.
 */
const RENEWAL_DAYS: Record<ComplianceFormType, number | null> = {
  'W-4': null,           // No expiration; refreshed on employee request
  'W-9': 365,             // Best practice: re-verify annually
  'I-9': null,            // Retention rule (3 yrs or 1 yr after termination)
  'W-8BEN': 1095,         // 3 years per IRS
  'W-8BEN-E': 1095,       // 3 years per IRS
  'state-W-4': null,
};

// ── Helpers ────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime();
  const b = new Date(to + 'T00:00:00').getTime();
  return Math.round((b - a) / 86400000);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── CRUD ───────────────────────────────────────────────────────

export function listForCompany(
  companyId: string,
  filters?: { person_type?: CompliancePersonType; form_type?: ComplianceFormType; status?: ComplianceStatus },
): ComplianceWithPerson[] {
  const dbi = db.getDb();
  let sql = `SELECT cd.*,
    COALESCE(e.name, v.name, c.name, '') AS person_name,
    COALESCE(e.email, v.email, c.email, '') AS person_email
    FROM compliance_documents cd
    LEFT JOIN employees e ON cd.person_type = 'employee' AND cd.person_id = e.id
    LEFT JOIN vendors v ON cd.person_type = 'vendor' AND cd.person_id = v.id
    LEFT JOIN clients c ON cd.person_type = 'client' AND cd.person_id = c.id
    WHERE cd.company_id = ?`;
  const params: any[] = [companyId];
  if (filters?.person_type) { sql += ' AND cd.person_type = ?'; params.push(filters.person_type); }
  if (filters?.form_type) { sql += ' AND cd.form_type = ?'; params.push(filters.form_type); }
  if (filters?.status) { sql += ' AND cd.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY cd.uploaded_at DESC';
  return dbi.prepare(sql).all(...params) as ComplianceWithPerson[];
}

export function listForPerson(
  personType: CompliancePersonType,
  personId: string,
): ComplianceDocument[] {
  const dbi = db.getDb();
  return dbi.prepare(`
    SELECT * FROM compliance_documents
    WHERE person_type = ? AND person_id = ?
    ORDER BY uploaded_at DESC
  `).all(personType, personId) as ComplianceDocument[];
}

export function upsertDocument(
  record: Partial<ComplianceDocument> & { company_id: string; person_type: CompliancePersonType; person_id: string; form_type: ComplianceFormType },
): ComplianceDocument {
  const dbi = db.getDb();

  // Compute expires_at from effective_date if not provided
  let expiresAt = record.expires_at;
  if (!expiresAt && record.effective_date) {
    const renewalDays = RENEWAL_DAYS[record.form_type];
    if (renewalDays) expiresAt = addDays(record.effective_date, renewalDays);
  }

  // Mark prior current document for same person+form as superseded
  if (record.status === 'current' || !record.status) {
    dbi.prepare(`
      UPDATE compliance_documents
      SET status = 'superseded', updated_at = datetime('now')
      WHERE company_id = ? AND person_type = ? AND person_id = ? AND form_type = ?
        AND status = 'current'
    `).run(record.company_id, record.person_type, record.person_id, record.form_type);
  }

  const id = record.id || uuid();
  const existingRow = record.id
    ? dbi.prepare('SELECT id FROM compliance_documents WHERE id = ?').get(record.id)
    : null;

  if (existingRow) {
    // UPDATE
    dbi.prepare(`
      UPDATE compliance_documents
      SET document_id = ?, document_filename = ?, effective_date = ?, expires_at = ?,
          section_1_complete = ?, section_2_complete = ?, section_3_complete = ?,
          status = ?, notes = ?, metadata = ?, uploaded_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      record.document_id || null,
      record.document_filename || '',
      record.effective_date || null,
      expiresAt || null,
      record.section_1_complete ?? 0,
      record.section_2_complete ?? 0,
      record.section_3_complete ?? 0,
      record.status || 'current',
      record.notes || '',
      record.metadata || '{}',
      record.uploaded_by || '',
      id,
    );
  } else {
    // INSERT
    dbi.prepare(`
      INSERT INTO compliance_documents (
        id, company_id, person_type, person_id, form_type,
        document_id, document_filename, effective_date, expires_at,
        section_1_complete, section_2_complete, section_3_complete,
        status, notes, metadata, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, record.company_id, record.person_type, record.person_id, record.form_type,
      record.document_id || null,
      record.document_filename || '',
      record.effective_date || null,
      expiresAt || null,
      record.section_1_complete ?? 0,
      record.section_2_complete ?? 0,
      record.section_3_complete ?? 0,
      record.status || 'current',
      record.notes || '',
      record.metadata || '{}',
      record.uploaded_by || '',
    );
  }

  return dbi.prepare('SELECT * FROM compliance_documents WHERE id = ?').get(id) as ComplianceDocument;
}

export function deleteDocument(id: string): boolean {
  const dbi = db.getDb();
  const r = dbi.prepare('DELETE FROM compliance_documents WHERE id = ?').run(id);
  return r.changes > 0;
}

// ── Reminders ──────────────────────────────────────────────────

/**
 * Returns persons who are missing required forms. The "days_overdue"
 * field is computed from hire_date for employees (I-9 must be on file
 * within 3 business days of hire).
 */
export function getMissing(companyId: string): ComplianceMissing[] {
  const dbi = db.getDb();
  const out: ComplianceMissing[] = [];

  // Employees missing W-4 or I-9
  const employees = dbi.prepare(`
    SELECT id, name, COALESCE(hire_date, start_date, '') AS hire_date
    FROM employees
    WHERE company_id = ? AND COALESCE(deleted_at, '') = '' AND COALESCE(status, 'active') = 'active'
  `).all(companyId) as Array<{ id: string; name: string; hire_date: string }>;

  for (const e of employees) {
    const docs = listForPerson('employee', e.id).filter((d) => d.status === 'current');
    const haveTypes = new Set(docs.map((d) => d.form_type));
    const missing = REQUIRED_FORMS.employee.filter((t) => !haveTypes.has(t));
    if (missing.length === 0) continue;

    let daysOverdue = 0;
    if (missing.includes('I-9') && e.hire_date) {
      const today = todayStr();
      const dueDate = addDays(e.hire_date, 3);
      daysOverdue = Math.max(0, daysBetween(dueDate, today));
    }
    out.push({
      person_type: 'employee',
      person_id: e.id,
      person_name: e.name,
      required_forms: missing,
      hire_date: e.hire_date,
      days_overdue: daysOverdue,
    });
  }

  // Vendors missing W-9 (1099-eligible only — others don't need it)
  let vendors: Array<{ id: string; name: string }> = [];
  try {
    vendors = dbi.prepare(`
      SELECT id, name FROM vendors
      WHERE company_id = ? AND COALESCE(deleted_at, '') = ''
        AND (is_1099_eligible = 1 OR vendor_1099 = 1 OR requires_1099 = 1
             OR is_1099_int_eligible = 1 OR is_1099_div_eligible = 1
             OR is_1099_misc_eligible = 1)
    `).all(companyId) as Array<{ id: string; name: string }>;
  } catch {
    // older schemas may not have all the *_eligible columns
    vendors = dbi.prepare(`
      SELECT id, name FROM vendors
      WHERE company_id = ? AND COALESCE(deleted_at, '') = ''
    `).all(companyId) as Array<{ id: string; name: string }>;
  }

  for (const v of vendors) {
    const docs = listForPerson('vendor', v.id).filter((d) => d.status === 'current');
    const haveTypes = new Set(docs.map((d) => d.form_type));
    if (haveTypes.has('W-9') || haveTypes.has('W-8BEN') || haveTypes.has('W-8BEN-E')) continue;
    out.push({
      person_type: 'vendor',
      person_id: v.id,
      person_name: v.name,
      required_forms: ['W-9'],
      days_overdue: 0,  // no statutory deadline for W-9
    });
  }

  return out;
}

/**
 * Returns documents expiring within N days (default 60). Useful for
 * "compliance reminders" inbox-style display.
 */
export function getExpiring(companyId: string, daysAhead: number = 60): ComplianceWithPerson[] {
  const dbi = db.getDb();
  const cutoff = addDays(todayStr(), daysAhead);
  return dbi.prepare(`
    SELECT cd.*,
      COALESCE(e.name, v.name, c.name, '') AS person_name,
      COALESCE(e.email, v.email, c.email, '') AS person_email
    FROM compliance_documents cd
    LEFT JOIN employees e ON cd.person_type = 'employee' AND cd.person_id = e.id
    LEFT JOIN vendors v ON cd.person_type = 'vendor' AND cd.person_id = v.id
    LEFT JOIN clients c ON cd.person_type = 'client' AND cd.person_id = c.id
    WHERE cd.company_id = ?
      AND cd.status = 'current'
      AND cd.expires_at IS NOT NULL
      AND cd.expires_at <= ?
    ORDER BY cd.expires_at ASC
  `).all(companyId, cutoff) as ComplianceWithPerson[];
}

/**
 * Auto-expires docs whose expires_at is past today. Should run on app
 * startup and periodically; transitions status from 'current' to 'expired'.
 */
export function autoExpire(companyId: string): number {
  const dbi = db.getDb();
  const today = todayStr();
  const r = dbi.prepare(`
    UPDATE compliance_documents
    SET status = 'expired', updated_at = datetime('now')
    WHERE company_id = ?
      AND status = 'current'
      AND expires_at IS NOT NULL
      AND expires_at < ?
  `).run(companyId, today);
  return r.changes;
}
