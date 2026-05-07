// src/main/services/tax-forms/form-1099-shared.ts
//
// Shared infrastructure for the 1099 family — every 1099 variant
// (NEC/MISC/INT/DIV/R/K/B/G/C/SA) has the same payer + recipient
// identity block, the same TIN/threshold/warning logic, and the
// same audit-trail sort ordering. This module factors that out.

import * as db from '../../database';

export interface PayerIdentity {
  payer_name: string;
  payer_address: string;
  payer_city: string;
  payer_state: string;
  payer_zip: string;
  payer_tin: string;
  payer_phone: string;
}

export interface RecipientIdentity {
  recipient_name: string;
  recipient_address: string;
  recipient_city: string;
  recipient_state: string;
  recipient_zip: string;
  recipient_tin: string;
  recipient_id: string;
  account_number: string;
}

export interface FilingFlags {
  meets_filing_threshold: boolean;
  has_tin: boolean;
  warnings: string[];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build the payer block from the company record. */
export function buildPayerIdentity(company: any): PayerIdentity {
  return {
    payer_name: company.legal_name || company.name || '',
    payer_address: [company.address_line1, company.address_line2].filter(Boolean).join(', '),
    payer_city: company.city || '',
    payer_state: company.state || '',
    payer_zip: company.zip || '',
    payer_tin: company.ein || company.tax_id || '',
    payer_phone: company.phone || '',
  };
}

/** Build the recipient block from a vendor or client record. */
export function buildRecipientIdentity(v: any): RecipientIdentity {
  return {
    recipient_name: v.name || '',
    recipient_address: [v.address_line1, v.address_line2].filter(Boolean).join(', ') || v.address || '',
    recipient_city: v.city || '',
    recipient_state: v.state || '',
    recipient_zip: v.zip || '',
    recipient_tin: v.tin || v.tax_id || v.ein || v.ssn || '',
    recipient_id: v.id,
    account_number: v.account_number || '',
  };
}

/**
 * Standard ready-to-file sort: forms with both filing-threshold met AND
 * TIN on file rank first, then by amount desc. Missing-TIN warnings sink
 * to the bottom so the user sees blockers last.
 */
export function sortReadyFirst<T extends FilingFlags>(forms: T[], amountKey: keyof T): T[] {
  return forms.sort((a, b) => {
    const aReady = a.meets_filing_threshold && a.has_tin ? 1 : 0;
    const bReady = b.meets_filing_threshold && b.has_tin ? 1 : 0;
    if (aReady !== bReady) return bReady - aReady;
    return (Number(b[amountKey]) || 0) - (Number(a[amountKey]) || 0);
  });
}

/** Build standard TIN/address warnings. Variants add their own threshold warnings. */
export function buildIdentityWarnings(recipient: RecipientIdentity, formName: string): string[] {
  const warnings: string[] = [];
  if (!recipient.recipient_tin) {
    warnings.push('Recipient has no TIN on file — required for ' + formName + '. Request a W-9 / W-8.');
  }
  if (!recipient.recipient_address) {
    warnings.push('Recipient address missing.');
  }
  return warnings;
}

/** Pull all vendors flagged for any 1099 issuance. */
export function loadEligibleVendors(companyId: string): any[] {
  const dbi = db.getDb();
  return dbi.prepare(`
    SELECT v.*
    FROM vendors v
    WHERE v.company_id = ?
      AND COALESCE(v.deleted_at, '') = ''
      AND (
        v.is_1099_eligible = 1
        OR v.vendor_1099 = 1
        OR v.requires_1099 = 1
        OR v.is_1099_int_eligible = 1
        OR v.is_1099_div_eligible = 1
        OR v.is_1099_misc_eligible = 1
      )
  `).all(companyId) as any[];
}

/** Pull all clients flagged for 1099 issuance (for outbound 1099-INT/DIV/R). */
export function loadEligibleClients(companyId: string): any[] {
  const dbi = db.getDb();
  try {
    return dbi.prepare(`
      SELECT c.*
      FROM clients c
      WHERE c.company_id = ?
        AND COALESCE(c.deleted_at, '') = ''
        AND (c.is_1099_eligible = 1 OR c.requires_1099 = 1)
    `).all(companyId) as any[];
  } catch {
    return [];
  }
}
