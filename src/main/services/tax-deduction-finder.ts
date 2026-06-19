// src/main/services/tax-deduction-finder.ts
//
// B13 — Tax Deduction Finder.
//
// Scans a company's expense history for patterns suggesting
// overlooked deductions. Returns a structured list of suggestions
// with potential dollar value + reasoning.
//
// This is NOT tax advice — it's a heuristic surfacer. Each
// suggestion includes a rationale + supporting transaction count
// so the user (or their accountant) can verify before claiming.
//
// Categories scanned:
//   • Home office          (utilities + ISP + portion of rent)
//   • Vehicle / mileage    (fuel + maintenance, vs mileage_log)
//   • Meals & entertainment (50% deductible per IRS § 274)
//   • Education / professional development
//   • Software & SaaS       (often miscategorized)
//   • Office supplies + furniture
//   • Phone / cell service
//   • Travel
//   • Health insurance (self-employed)
//   • Bank & merchant fees

import * as db from '../database';

export interface DeductionSuggestion {
  category: string;          // human-readable category
  type: 'overlooked' | 'miscategorized' | 'underclaimed' | 'documentation';
  title: string;             // headline shown in UI
  detail: string;            // 1-2 sentence rationale
  estimated_value: number;   // potential deduction $ (best estimate)
  supporting_count: number;  // transactions backing the suggestion
  supporting_total: number;  // sum of supporting expense amounts
  confidence: 'high' | 'medium' | 'low';
  irs_reference?: string;    // optional cite (e.g. "IRC § 280A")
}

export interface DeductionScanResult {
  year: number;
  total_expenses_scanned: number;
  total_potential: number;
  suggestions: DeductionSuggestion[];
  generated_at: string;
}

// Category keyword groups — matched against expense description +
// vendor name. Conservative — only suggests when confidence is high.
const KEYWORD_GROUPS = {
  home_office: ['home office', 'office space', 'home rent portion'],
  utilities: ['comcast', 'xfinity', 'verizon fios', 'at&t internet', 'spectrum', 'electric bill', 'gas bill', 'water bill', 'utility'],
  vehicle: ['gas', 'fuel', 'shell', 'chevron', 'exxon', 'mobil', 'maintenance', 'oil change', 'tire'],
  meals: ['restaurant', 'cafe', 'starbucks', 'lunch', 'dinner', 'breakfast', 'meal'],
  education: ['course', 'training', 'workshop', 'conference', 'seminar', 'certification', 'udemy', 'coursera', 'pluralsight', 'masterclass', 'book'],
  software: ['adobe', 'microsoft', 'github', 'aws', 'azure', 'gcp', 'dropbox', 'notion', 'slack', 'zoom', 'figma', 'jetbrains', 'office 365', 'subscription'],
  supplies: ['staples', 'office depot', 'amazon', 'paper', 'pen', 'ink', 'toner'],
  phone: ['t-mobile', 'verizon wireless', 'at&t mobility', 'sprint', 'cell phone', 'mobile bill'],
  travel: ['hotel', 'airbnb', 'marriott', 'hilton', 'flight', 'airline', 'united airlines', 'delta', 'american airlines', 'uber', 'lyft', 'taxi', 'rental car', 'hertz', 'enterprise'],
  health: ['health insurance', 'medical insurance', 'dental insurance', 'vision insurance', 'blue cross', 'aetna', 'kaiser'],
  bank_fees: ['bank fee', 'service charge', 'wire fee', 'atm fee', 'overdraft', 'merchant fee', 'stripe fee', 'square fee', 'paypal fee'],
};

interface Expense {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  category_name?: string;
  vendor_name?: string;
  notes: string;
}

function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  const lc = (text || '').toLowerCase();
  return keywords.some((kw) => lc.includes(kw));
}

export function scanDeductions(companyId: string, year?: number): DeductionScanResult {
  const dbi = db.getDb();
  const targetYear = year || new Date().getFullYear();
  const yearStart = targetYear + '-01-01';
  const yearEnd = targetYear + '-12-31';

  // Pull all expenses for the year + their categories + vendor names.
  let expenses: Expense[] = [];
  try {
    expenses = dbi.prepare(`
      SELECT e.id, e.date, e.description, e.amount, e.category_id AS category, e.notes,
             c.name AS category_name, v.name AS vendor_name
      FROM expenses e
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN vendors v ON v.id = e.vendor_id
      WHERE e.company_id = ?
        AND e.date BETWEEN ? AND ?
        AND COALESCE(e.deleted_at, '') = ''
    `).all(companyId, yearStart, yearEnd) as any;
  } catch {
    return { year: targetYear, total_expenses_scanned: 0, total_potential: 0, suggestions: [], generated_at: new Date().toISOString() };
  }

  const suggestions: DeductionSuggestion[] = [];
  const totalScanned = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // Helper: collect expenses matching keywords in a SET of fields
  const matching = (groupKey: keyof typeof KEYWORD_GROUPS): Expense[] => {
    const kws = KEYWORD_GROUPS[groupKey];
    return expenses.filter((e) => {
      const haystack = (e.description || '') + ' ' + (e.vendor_name || '') + ' ' + (e.notes || '');
      return matchesAnyKeyword(haystack, kws);
    });
  };

  // ── Home office deduction ──
  const utilityHits = matching('utilities');
  if (utilityHits.length >= 6) {
    // 6+ utility transactions in a year = consistent home office signal
    const utilityTotal = utilityHits.reduce((s, e) => s + e.amount, 0);
    suggestions.push({
      category: 'Home Office',
      type: 'overlooked',
      title: 'Home office deduction may be available',
      detail: `${utilityHits.length} utility/internet transactions totaling $${utilityTotal.toFixed(2)} suggest a home office. The IRS Simplified Option allows $5/sq ft up to 300 sq ft = $1,500 max. The Regular Method allows actual % of home used for business.`,
      estimated_value: Math.min(1500, utilityTotal * 0.20),
      supporting_count: utilityHits.length,
      supporting_total: Math.round(utilityTotal * 100) / 100,
      confidence: 'medium',
      irs_reference: 'IRC § 280A · Form 8829',
    });
  }

  // ── Vehicle / mileage ──
  const vehicleHits = matching('vehicle');
  if (vehicleHits.length >= 3) {
    const vehicleTotal = vehicleHits.reduce((s, e) => s + e.amount, 0);
    // Check if user has any mileage log entries this year
    let mileageRecords = 0;
    try {
      mileageRecords = (dbi.prepare(
        "SELECT COUNT(*) AS n FROM mileage_log WHERE company_id = ? AND substr(trip_date, 1, 4) = ?"
      ).get(companyId, String(targetYear)) as any)?.n || 0;
    } catch { /* mileage table may not exist */ }

    if (mileageRecords === 0) {
      suggestions.push({
        category: 'Vehicle Expenses',
        type: 'documentation',
        title: 'Vehicle expenses without mileage log',
        detail: `${vehicleHits.length} fuel/maintenance transactions totaling $${vehicleTotal.toFixed(2)} but no mileage log entries for ${targetYear}. The IRS standard mileage rate (currently $0.70/mi) may yield a higher deduction than actual expenses — but requires a written mileage log.`,
        estimated_value: vehicleTotal,
        supporting_count: vehicleHits.length,
        supporting_total: Math.round(vehicleTotal * 100) / 100,
        confidence: 'high',
        irs_reference: 'IRC § 162 · Pub 463',
      });
    }
  }

  // ── Meals (50% deductible) ──
  const mealHits = matching('meals');
  if (mealHits.length >= 2) {
    const mealTotal = mealHits.reduce((s, e) => s + e.amount, 0);
    suggestions.push({
      category: 'Meals & Entertainment',
      type: 'underclaimed',
      title: 'Business meals — 50% deductible',
      detail: `${mealHits.length} meal transactions totaling $${mealTotal.toFixed(2)}. Per IRS § 274(n), 50% is deductible if ordinary & necessary business expense. Verify each was a legitimate business meeting (client, vendor, employee).`,
      estimated_value: Math.round(mealTotal * 0.5 * 100) / 100,
      supporting_count: mealHits.length,
      supporting_total: Math.round(mealTotal * 100) / 100,
      confidence: 'high',
      irs_reference: 'IRC § 274(n) · 50% limit',
    });
  }

  // ── Education / professional development ──
  const educationHits = matching('education');
  if (educationHits.length >= 1) {
    const eduTotal = educationHits.reduce((s, e) => s + e.amount, 0);
    if (eduTotal >= 200) {
      suggestions.push({
        category: 'Professional Development',
        type: 'overlooked',
        title: 'Continuing education is deductible',
        detail: `${educationHits.length} courses/conferences/books totaling $${eduTotal.toFixed(2)}. Education that maintains or improves skills required in your trade is fully deductible (not just for new careers).`,
        estimated_value: eduTotal,
        supporting_count: educationHits.length,
        supporting_total: Math.round(eduTotal * 100) / 100,
        confidence: 'high',
        irs_reference: 'Treas. Reg. § 1.162-5',
      });
    }
  }

  // ── Software & SaaS ──
  const softwareHits = matching('software');
  if (softwareHits.length >= 3) {
    const softwareTotal = softwareHits.reduce((s, e) => s + e.amount, 0);
    suggestions.push({
      category: 'Software & SaaS',
      type: 'underclaimed',
      title: 'Software subscriptions are 100% deductible',
      detail: `${softwareHits.length} software subscriptions totaling $${softwareTotal.toFixed(2)}. All business software (Adobe, Microsoft 365, GitHub, AWS, etc.) is fully deductible the year paid. Verify these are categorized as business expenses, not personal.`,
      estimated_value: softwareTotal,
      supporting_count: softwareHits.length,
      supporting_total: Math.round(softwareTotal * 100) / 100,
      confidence: 'high',
    });
  }

  // ── Phone / cell ──
  const phoneHits = matching('phone');
  if (phoneHits.length >= 6) {
    const phoneTotal = phoneHits.reduce((s, e) => s + e.amount, 0);
    suggestions.push({
      category: 'Phone Service',
      type: 'overlooked',
      title: 'Cell phone business-use percentage',
      detail: `${phoneHits.length} phone bill transactions totaling $${phoneTotal.toFixed(2)}. The business-use % of your cell bill is deductible. Conservative estimate: 50% if you use the same line for personal + business.`,
      estimated_value: Math.round(phoneTotal * 0.5 * 100) / 100,
      supporting_count: phoneHits.length,
      supporting_total: Math.round(phoneTotal * 100) / 100,
      confidence: 'medium',
    });
  }

  // ── Travel ──
  const travelHits = matching('travel');
  if (travelHits.length >= 3) {
    const travelTotal = travelHits.reduce((s, e) => s + e.amount, 0);
    suggestions.push({
      category: 'Business Travel',
      type: 'underclaimed',
      title: 'Travel expenses (lodging, transportation) — 100% deductible',
      detail: `${travelHits.length} hotel/flight/rideshare transactions totaling $${travelTotal.toFixed(2)}. Lodging + transportation for business travel is fully deductible (vs meals at 50%). Document the business purpose for each trip.`,
      estimated_value: travelTotal,
      supporting_count: travelHits.length,
      supporting_total: Math.round(travelTotal * 100) / 100,
      confidence: 'high',
      irs_reference: 'IRC § 162(a)(2) · Pub 463',
    });
  }

  // ── Health insurance (self-employed only) ──
  const healthHits = matching('health');
  if (healthHits.length >= 6) {
    const healthTotal = healthHits.reduce((s, e) => s + e.amount, 0);
    suggestions.push({
      category: 'Self-Employed Health Insurance',
      type: 'overlooked',
      title: 'Self-employed health insurance deduction',
      detail: `${healthHits.length} health/medical insurance payments totaling $${healthTotal.toFixed(2)}. Self-employed individuals can deduct 100% of health insurance premiums for themselves + family on Schedule 1, line 17 (above-the-line, reduces AGI).`,
      estimated_value: healthTotal,
      supporting_count: healthHits.length,
      supporting_total: Math.round(healthTotal * 100) / 100,
      confidence: 'medium',
      irs_reference: 'IRC § 162(l)',
    });
  }

  // ── Bank & merchant fees ──
  const feeHits = matching('bank_fees');
  if (feeHits.length >= 3) {
    const feeTotal = feeHits.reduce((s, e) => s + e.amount, 0);
    suggestions.push({
      category: 'Bank & Merchant Fees',
      type: 'underclaimed',
      title: 'Bank and payment-processor fees are 100% deductible',
      detail: `${feeHits.length} fee transactions totaling $${feeTotal.toFixed(2)}. Stripe/Square/PayPal processing fees, bank service charges, wire fees, etc. are ordinary business expenses.`,
      estimated_value: feeTotal,
      supporting_count: feeHits.length,
      supporting_total: Math.round(feeTotal * 100) / 100,
      confidence: 'high',
    });
  }

  // ── Uncategorized expenses ──
  const uncategorized = expenses.filter((e) => !e.category && !e.category_name);
  if (uncategorized.length >= 5) {
    const uncatTotal = uncategorized.reduce((s, e) => s + e.amount, 0);
    suggestions.push({
      category: 'Categorization',
      type: 'documentation',
      title: 'Uncategorized expenses are tax-deduction blind spots',
      detail: `${uncategorized.length} expenses totaling $${uncatTotal.toFixed(2)} have no category. Without categorization, you can't claim them on the right Schedule C line and audit defense is harder.`,
      estimated_value: 0,
      supporting_count: uncategorized.length,
      supporting_total: Math.round(uncatTotal * 100) / 100,
      confidence: 'high',
    });
  }

  // Sort by estimated_value descending
  suggestions.sort((a, b) => b.estimated_value - a.estimated_value);

  const totalPotential = suggestions.reduce((s, sg) => s + sg.estimated_value, 0);

  return {
    year: targetYear,
    total_expenses_scanned: Math.round(totalScanned * 100) / 100,
    total_potential: Math.round(totalPotential * 100) / 100,
    suggestions,
    generated_at: new Date().toISOString(),
  };
}
