// src/main/services/tax-forms/sales-tax.ts
//
// Sales Tax Remittance Worksheet (state-agnostic).
//
// Each state has its own form and rate structure (UT TC-62M,
// CA BOE-401-A, TX 01-114, etc.) but the underlying math is
// the same: aggregate taxable sales by tax-rate-bucket, multiply
// by rate, sum, subtract any prepayments. This worksheet
// produces the data; the user transcribes to their state form
// or e-files separately.
//
// Sources: per-state DOR/DRS instructions

import * as db from '../../database';

export interface SalesTaxLineItem {
  rate: number;                  // e.g. 0.0775
  rate_label: string;             // "UT 7.75%"
  taxable_sales: number;          // sum of (qty × price) where tax_rate matches
  tax_collected: number;          // tax_amount sum from invoice lines
  tax_due: number;                // taxable_sales × rate
  variance: number;               // tax_collected - tax_due (rounding/manual edits)
  invoice_count: number;
}

export interface SalesTaxData {
  // Filing identity
  business_name: string;
  state: string;
  state_tax_id: string;           // sales tax permit / seller's permit
  ein: string;
  period_start: string;            // YYYY-MM-DD
  period_end: string;
  filing_frequency: 'monthly' | 'quarterly' | 'annual';
  year: number;

  // Aggregates
  total_gross_sales: number;       // ALL invoices in period
  total_taxable_sales: number;     // sum of taxable line amounts
  total_nontaxable_sales: number;  // gross - taxable
  total_tax_collected: number;     // what the customer paid
  total_tax_due: number;           // what we OWE (computed from rates)
  total_variance: number;          // collected - due (rounding diff)

  // Per-rate breakdown
  rate_lines: SalesTaxLineItem[];

  // Reduction items (prepayments, credits, discounts for early filing)
  prepayments: number;             // user-entered
  early_filing_discount_pct: number; // some states allow 0.5-2% for prompt filing
  early_filing_discount: number;
  net_remittance: number;          // total_tax_due - prepayments - discount

  // Computation metadata
  invoice_count: number;
  warnings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface InvoiceLine {
  invoice_id: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  amount: number;
  discount_pct: number;
  tax_rate_override: number;
  row_type: string;
}

interface InvoiceMeta {
  id: string;
  issue_date: string;
  status: string;
  client_id: string;
}

export function computeSalesTax(
  companyId: string,
  periodStart: string,
  periodEnd: string,
  opts?: { filing_frequency?: 'monthly' | 'quarterly' | 'annual'; prepayments?: number; early_filing_discount_pct?: number; state?: string }
): SalesTaxData {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};

  // Pull all paid + sent invoices in the period
  const invoices = dbi.prepare(`
    SELECT id, issue_date, status, client_id, total
    FROM invoices
    WHERE company_id = ?
      AND issue_date BETWEEN ? AND ?
      AND status NOT IN ('voided', 'cancelled', 'draft')
      AND COALESCE(deleted_at, '') = ''
  `).all(companyId, periodStart, periodEnd) as InvoiceMeta[];

  if (invoices.length === 0) {
    return {
      business_name: company.name || '',
      state: opts?.state || company.state || '',
      state_tax_id: company.sales_tax_id || company.state_id || '',
      ein: company.ein || '',
      period_start: periodStart,
      period_end: periodEnd,
      filing_frequency: opts?.filing_frequency || 'quarterly',
      year: parseInt(periodStart.slice(0, 4)),
      total_gross_sales: 0,
      total_taxable_sales: 0,
      total_nontaxable_sales: 0,
      total_tax_collected: 0,
      total_tax_due: 0,
      total_variance: 0,
      rate_lines: [],
      prepayments: opts?.prepayments || 0,
      early_filing_discount_pct: opts?.early_filing_discount_pct || 0,
      early_filing_discount: 0,
      net_remittance: 0,
      invoice_count: 0,
      warnings: ['No invoices in this period.'],
    };
  }

  const invoiceIds = invoices.map((i) => i.id);
  const placeholders = invoiceIds.map(() => '?').join(',');

  // Pull all line items for these invoices
  const lines = dbi.prepare(
    "SELECT li.*, COALESCE(li.tax_rate_override, -1) AS tax_rate_override " +
    "FROM invoice_line_items li " +
    "WHERE li.invoice_id IN (" + placeholders + ")"
  ).all(...invoiceIds) as InvoiceLine[];

  // Compute per-line: discounted base + effective rate + tax owed
  const buckets = new Map<string, SalesTaxLineItem>();
  let grossSales = 0;
  let taxableSales = 0;
  let taxCollected = 0;
  const invoicesByRate = new Map<string, Set<string>>();

  for (const line of lines) {
    if (line.row_type && line.row_type !== 'item') continue; // skip section/note/subtotal rows
    const baseAmount = (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
    const discountedAmount = baseAmount * (1 - (Number(line.discount_pct) || 0) / 100);
    grossSales += discountedAmount;

    const overrideVal = Number(line.tax_rate_override ?? -1);
    const effectiveRate = overrideVal >= 0 ? overrideVal : Number(line.tax_rate || 0);
    if (effectiveRate <= 0) continue; // not subject to sales tax

    taxableSales += discountedAmount;
    const taxOwed = round2(discountedAmount * (effectiveRate / 100));
    const taxOnFile = Number(line.tax_amount) || taxOwed;
    taxCollected += taxOnFile;

    const rateKey = effectiveRate.toFixed(3);
    let bucket = buckets.get(rateKey);
    if (!bucket) {
      bucket = {
        rate: effectiveRate / 100,
        rate_label: (opts?.state || company.state || '') + ' ' + effectiveRate.toFixed(2) + '%',
        taxable_sales: 0,
        tax_collected: 0,
        tax_due: 0,
        variance: 0,
        invoice_count: 0,
      };
      buckets.set(rateKey, bucket);
      invoicesByRate.set(rateKey, new Set());
    }
    bucket.taxable_sales = round2(bucket.taxable_sales + discountedAmount);
    bucket.tax_collected = round2(bucket.tax_collected + taxOnFile);
    bucket.tax_due = round2(bucket.tax_due + taxOwed);
    invoicesByRate.get(rateKey)!.add(line.invoice_id);
  }

  // Finalize per-rate
  const rateLines: SalesTaxLineItem[] = [];
  for (const [key, bucket] of buckets) {
    bucket.variance = round2(bucket.tax_collected - bucket.tax_due);
    bucket.invoice_count = invoicesByRate.get(key)?.size || 0;
    rateLines.push(bucket);
  }
  rateLines.sort((a, b) => b.taxable_sales - a.taxable_sales);

  const total_gross = round2(grossSales);
  const total_taxable = round2(taxableSales);
  const total_nontaxable = round2(total_gross - total_taxable);
  const total_collected = round2(taxCollected);
  const total_due = round2(rateLines.reduce((s, l) => s + l.tax_due, 0));
  const total_variance = round2(total_collected - total_due);

  const prepayments = round2(opts?.prepayments || 0);
  const earlyFilingPct = opts?.early_filing_discount_pct || 0;
  const earlyFilingDiscount = round2(total_due * earlyFilingPct / 100);
  const net_remittance = round2(Math.max(0, total_due - prepayments - earlyFilingDiscount));

  const warnings: string[] = [];
  if (Math.abs(total_variance) > 1) {
    warnings.push(
      'Tax collected (' + total_collected.toFixed(2) + ') differs from tax due (' + total_due.toFixed(2) +
      ') by ' + total_variance.toFixed(2) + '. Review invoice line items for rate or rounding issues.'
    );
  }
  if (rateLines.length === 0) {
    warnings.push('No taxable sales in this period — no remittance required (file zero return if state requires it).');
  }
  if (!company.sales_tax_id && !company.state_id) {
    warnings.push('No state sales tax permit ID on file — required for filing.');
  }

  return {
    business_name: company.name || '',
    state: opts?.state || company.state || '',
    state_tax_id: company.sales_tax_id || company.state_id || '',
    ein: company.ein || '',
    period_start: periodStart,
    period_end: periodEnd,
    filing_frequency: opts?.filing_frequency || 'quarterly',
    year: parseInt(periodStart.slice(0, 4)),
    total_gross_sales: total_gross,
    total_taxable_sales: total_taxable,
    total_nontaxable_sales: total_nontaxable,
    total_tax_collected: total_collected,
    total_tax_due: total_due,
    total_variance,
    rate_lines: rateLines,
    prepayments,
    early_filing_discount_pct: earlyFilingPct,
    early_filing_discount: earlyFilingDiscount,
    net_remittance,
    invoice_count: invoices.length,
    warnings,
  };
}
