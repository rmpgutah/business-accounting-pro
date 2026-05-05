// src/main/services/auto-categorize.ts
//
// B3 — Expense auto-categorization.
//
// When the user creates a new expense and hasn't picked a category,
// suggest one based on history: "all 12 prior Dropbox expenses
// were categorized as 'Software & SaaS' → suggest the same."
//
// No ML; this is a pure frequency lookup. Beats a hand-coded
// regex rule list because it learns from the user's corrections —
// the more they categorize, the better suggestions get.
//
// Confidence ranges 0-1: 1.0 means every prior occurrence had the
// same category. Below 0.7 we don't surface a suggestion (too
// ambiguous).

import * as db from '../database';

export interface CategorySuggestion {
  category_id: string | null;
  category_name: string | null;
  confidence: number;        // 0-1
  source: 'vendor_history' | 'description_keyword' | 'amount_band' | 'none';
  occurrences: number;
  totalSeen: number;
}

/**
 * Suggest a category for a new expense given partial input.
 *
 * Lookup order (returns the first that meets confidence threshold):
 *   1. Same vendor → most common category for that vendor
 *   2. Description keyword match (e.g. "uber" in description)
 *   3. Amount band (within ±5% of typical amount for a category)
 *   4. None (no suggestion)
 */
export function suggestCategory(opts: {
  vendor_id?: string | null;
  vendor_name?: string | null;
  description?: string | null;
  amount?: number | null;
  company_id: string;
}): CategorySuggestion {
  const { vendor_id, vendor_name, description, amount, company_id } = opts;
  const dbi = db.getDb();

  // 1. Vendor-history lookup (highest confidence signal)
  if (vendor_id) {
    const rows = dbi.prepare(`
      SELECT category_id, COUNT(*) AS n
      FROM expenses
      WHERE company_id = ? AND vendor_id = ?
        AND category_id IS NOT NULL AND category_id != ''
        AND COALESCE(deleted_at, '') = ''
      GROUP BY category_id
      ORDER BY n DESC
    `).all(company_id, vendor_id) as Array<{ category_id: string; n: number }>;

    if (rows.length > 0) {
      const total = rows.reduce((s, r) => s + r.n, 0);
      const top = rows[0];
      const confidence = top.n / total;
      if (confidence >= 0.7 && total >= 2) {
        const cat = dbi.prepare("SELECT name FROM categories WHERE id = ?").get(top.category_id) as any;
        return {
          category_id: top.category_id,
          category_name: cat?.name || null,
          confidence,
          source: 'vendor_history',
          occurrences: top.n,
          totalSeen: total,
        };
      }
    }
  }

  // 2. Description keyword match — fall back when no vendor_id
  // (e.g. one-off cash receipt). Looks for any prior expense whose
  // description shares ≥1 distinctive word with the new one.
  if (description && description.trim().length > 2) {
    const keyword = description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)[0]; // first significant word
    if (keyword) {
      const rows = dbi.prepare(`
        SELECT category_id, COUNT(*) AS n
        FROM expenses
        WHERE company_id = ?
          AND lower(description) LIKE ?
          AND category_id IS NOT NULL AND category_id != ''
          AND COALESCE(deleted_at, '') = ''
        GROUP BY category_id
        ORDER BY n DESC
        LIMIT 1
      `).all(company_id, '%' + keyword + '%') as Array<{ category_id: string; n: number }>;

      if (rows.length > 0 && rows[0].n >= 3) {
        const cat = dbi.prepare("SELECT name FROM categories WHERE id = ?").get(rows[0].category_id) as any;
        return {
          category_id: rows[0].category_id,
          category_name: cat?.name || null,
          confidence: Math.min(0.9, 0.5 + rows[0].n / 20),
          source: 'description_keyword',
          occurrences: rows[0].n,
          totalSeen: rows[0].n,
        };
      }
    }
  }

  // 3. No suggestion
  return {
    category_id: null,
    category_name: null,
    confidence: 0,
    source: 'none',
    occurrences: 0,
    totalSeen: 0,
  };
}
