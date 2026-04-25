// src/renderer/lib/irs-rates.ts
//
// IRS reference rates for 2025/2026. Used by mileage entry, per-diem entry
// modes, Schedule C mapping, and compliance retention computations.
//
// Sources:
//  - IRS Notice 2025-XX (standard mileage)
//  - GSA FY2025 per-diem tables (CONUS major-city rates)

/**
 * Standard business mileage rate for the current tax year (USD per mile).
 * 2025 IRS standard mileage rate for business use is $0.70/mile.
 * Update this constant annually.
 */
export const IRS_MILEAGE_RATE_2025 = 0.70;
export const IRS_MILEAGE_RATE_CURRENT = IRS_MILEAGE_RATE_2025;

/** Other 2025 standard mileage rates (informational). */
export const IRS_MILEAGE_RATES = {
  business: 0.70,
  medical: 0.21,
  moving: 0.21, // armed forces only
  charitable: 0.14,
} as const;

/**
 * Per-diem rates (lodging + M&IE) for major US cities. Approximations of
 * GSA FY2025 standard rates — fall back to DEFAULT for cities not listed.
 */
export interface PerDiemRate {
  city: string;
  state: string;
  lodging: number;
  meals: number;
  total: number;
}

export const PER_DIEM_RATES: Record<string, PerDiemRate> = {
  default: { city: 'Standard CONUS', state: '—', lodging: 110, meals: 68, total: 178 },
  'new-york-ny': { city: 'New York', state: 'NY', lodging: 295, meals: 79, total: 374 },
  'san-francisco-ca': { city: 'San Francisco', state: 'CA', lodging: 270, meals: 79, total: 349 },
  'los-angeles-ca': { city: 'Los Angeles', state: 'CA', lodging: 197, meals: 79, total: 276 },
  'chicago-il': { city: 'Chicago', state: 'IL', lodging: 218, meals: 79, total: 297 },
  'washington-dc': { city: 'Washington', state: 'DC', lodging: 257, meals: 79, total: 336 },
  'boston-ma': { city: 'Boston', state: 'MA', lodging: 285, meals: 79, total: 364 },
  'seattle-wa': { city: 'Seattle', state: 'WA', lodging: 218, meals: 79, total: 297 },
  'denver-co': { city: 'Denver', state: 'CO', lodging: 199, meals: 79, total: 278 },
  'atlanta-ga': { city: 'Atlanta', state: 'GA', lodging: 175, meals: 74, total: 249 },
  'dallas-tx': { city: 'Dallas', state: 'TX', lodging: 174, meals: 74, total: 248 },
  'houston-tx': { city: 'Houston', state: 'TX', lodging: 171, meals: 74, total: 245 },
  'miami-fl': { city: 'Miami', state: 'FL', lodging: 213, meals: 79, total: 292 },
  'philadelphia-pa': { city: 'Philadelphia', state: 'PA', lodging: 198, meals: 74, total: 272 },
  'phoenix-az': { city: 'Phoenix', state: 'AZ', lodging: 178, meals: 74, total: 252 },
  'las-vegas-nv': { city: 'Las Vegas', state: 'NV', lodging: 168, meals: 79, total: 247 },
  'salt-lake-city-ut': { city: 'Salt Lake City', state: 'UT', lodging: 142, meals: 74, total: 216 },
};

export function lookupPerDiem(key: string): PerDiemRate {
  return PER_DIEM_RATES[key] || PER_DIEM_RATES.default;
}

/**
 * IRS Schedule C (Form 1040) Part II expense categories.
 * Used to tag business expenses for tax preparation.
 */
export const SCHEDULE_C_LINES: { code: string; label: string }[] = [
  { code: '8',  label: 'Advertising' },
  { code: '9',  label: 'Car and truck expenses' },
  { code: '10', label: 'Commissions and fees' },
  { code: '11', label: 'Contract labor' },
  { code: '12', label: 'Depletion' },
  { code: '13', label: 'Depreciation and section 179' },
  { code: '14', label: 'Employee benefit programs' },
  { code: '15', label: 'Insurance (other than health)' },
  { code: '16a', label: 'Mortgage interest' },
  { code: '16b', label: 'Other interest' },
  { code: '17', label: 'Legal and professional services' },
  { code: '18', label: 'Office expense' },
  { code: '19', label: 'Pension and profit-sharing plans' },
  { code: '20a', label: 'Rent or lease — vehicles, machinery, equipment' },
  { code: '20b', label: 'Rent or lease — other business property' },
  { code: '21', label: 'Repairs and maintenance' },
  { code: '22', label: 'Supplies' },
  { code: '23', label: 'Taxes and licenses' },
  { code: '24a', label: 'Travel' },
  { code: '24b', label: 'Deductible meals' },
  { code: '25', label: 'Utilities' },
  { code: '26', label: 'Wages' },
  { code: '27a', label: 'Other expenses' },
].sort((a, b) => a.label.localeCompare(b.label));

/** IRS retention period for receipt records (years). */
export const IRS_RECEIPT_RETENTION_YEARS = 7;

/** IRS receipt threshold — receipts > $75 require documentation per Pub 463. */
export const IRS_RECEIPT_THRESHOLD = 75;

export function computeReceiptExpiry(dateISO: string): string {
  if (!dateISO) return '';
  try {
    const d = new Date(dateISO);
    d.setFullYear(d.getFullYear() + IRS_RECEIPT_RETENTION_YEARS);
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}
