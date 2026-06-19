// ─── Itemization Wave: F841-F862 (22 features) ───
//
// Templates, helpers, and parsers that power the redesigned itemization box
// in ExpenseForm. The form layer handles UX (drag, toggles, layout); this
// service layer handles persistence + data transforms.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════════
// Templates (F841-F846)
// ════════════════════════════════════════════════════════════════════

// F841: Save the current line items as a reusable template
export function saveItemizationTemplate(opts: { name: string; description?: string; lines: any[]; owner_user_id?: string; visibility?: 'private' | 'team' | 'company' }) {
  try {
    const id = uuid();
    // STRIP TRANSIENT FIELDS: `id` and `amount` are per-instance; recompute on use.
    const cleanedLines = (opts.lines || []).map(l => ({
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      account_id: l.account_id || null,
      category_id: l.category_id || null,
      project_id: l.project_id || null,
      client_id: l.client_id || null,
      tax_rate: l.tax_rate || 0,
      discount_amount: l.discount_amount || 0,
      discount_percent: l.discount_percent || 0,
      is_tax_deductible: l.is_tax_deductible !== false ? 1 : 0,
      is_tax_exempt: l.is_tax_exempt ? 1 : 0,
      notes: l.notes || '',
      item_type: l.item_type || 'item',
      tags: l.tags || [],
      tax_jurisdictions: l.tax_jurisdictions || [],
    }));
    db.getDb().prepare(`INSERT INTO expense_itemization_templates (id, company_id, name, description, lines_json, owner_user_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.description || null, JSON.stringify(cleanedLines), opts.owner_user_id || null, opts.visibility || 'private');
    return { id, line_count: cleanedLines.length };
  } catch (e: any) { return { error: e.message }; }
}

// F842: List itemization templates (filter by visibility)
export function listItemizationTemplates(userId?: string) {
  try {
    return db.getDb().prepare(`SELECT id, name, description, times_used, last_used_at, visibility, owner_user_id, created_at,
      (SELECT json_array_length(lines_json) FROM expense_itemization_templates WHERE id = t.id) line_count
      FROM expense_itemization_templates t
      WHERE company_id = ? AND (visibility IN ('company', 'team') OR owner_user_id = ?)
      ORDER BY times_used DESC, last_used_at DESC NULLS LAST, name`)
      .all(db.getCurrentCompanyId(), userId || '');
  } catch (e: any) { return { error: e.message }; }
}

// F843: Load a template (returns the line items, increments usage counter)
export function loadItemizationTemplate(id: string) {
  try {
    const t = db.getDb().prepare(`SELECT * FROM expense_itemization_templates WHERE id = ? AND company_id = ?`).get(id, db.getCurrentCompanyId()) as any;
    if (!t) return { error: 'Template not found' };
    db.getDb().prepare(`UPDATE expense_itemization_templates SET times_used = COALESCE(times_used, 0) + 1, last_used_at = ?, updated_at = ? WHERE id = ?`)
      .run(now(), now(), id);
    return { id: t.id, name: t.name, description: t.description, lines: JSON.parse(t.lines_json || '[]') };
  } catch (e: any) { return { error: e.message }; }
}

// F844: Delete an itemization template
export function deleteItemizationTemplate(id: string) {
  try {
    db.getDb().prepare(`DELETE FROM expense_itemization_templates WHERE id = ? AND company_id = ?`).run(id, db.getCurrentCompanyId());
    return { deleted: true };
  } catch (e: any) { return { error: e.message }; }
}

// F845: Rename / update template metadata (NOT lines — re-save for that)
export function updateItemizationTemplate(id: string, patch: { name?: string; description?: string; visibility?: string }) {
  try {
    const sets: string[] = []; const vals: any[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
    if (patch.description !== undefined) { sets.push('description = ?'); vals.push(patch.description); }
    if (patch.visibility !== undefined) { sets.push('visibility = ?'); vals.push(patch.visibility); }
    if (sets.length === 0) return { skipped: true };
    sets.push('updated_at = ?'); vals.push(now());
    vals.push(id, db.getCurrentCompanyId());
    db.getDb().prepare(`UPDATE expense_itemization_templates SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
    return { updated: true };
  } catch (e: any) { return { error: e.message }; }
}

// F846: Share a template (change visibility from private to team/company)
export function shareItemizationTemplate(id: string, visibility: 'team' | 'company') {
  try {
    db.getDb().prepare(`UPDATE expense_itemization_templates SET visibility = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(visibility, now(), id, db.getCurrentCompanyId());
    return { shared: true };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Bulk operations (F847-F852)
// ════════════════════════════════════════════════════════════════════

// F847: Parse pasted CSV/TSV content into line items
// Supports: 2-col (desc, price), 3-col (desc, qty, price), 4-col (desc, qty, price, tax_rate%)
export function parseBulkLines(rawText: string): { lines: any[]; warnings: string[] } {
  const lines: any[] = [];
  const warnings: string[] = [];
  const rows = (rawText || '').split(/\r?\n/).filter(r => r.trim().length > 0);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].trim();
    const cells = row.includes('\t') ? row.split('\t') : row.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) {
      warnings.push(`Row ${i + 1} skipped (need ≥2 columns): ${row}`);
      continue;
    }
    const description = cells[0];
    let quantity = 1, unit_price = 0, tax_rate = 0;
    if (cells.length === 2) {
      unit_price = parseFloat(cells[1]) || 0;
    } else if (cells.length === 3) {
      quantity = parseFloat(cells[1]) || 1;
      unit_price = parseFloat(cells[2]) || 0;
    } else {
      quantity = parseFloat(cells[1]) || 1;
      unit_price = parseFloat(cells[2]) || 0;
      tax_rate = parseFloat(cells[3]) || 0;
    }
    if (unit_price === 0 && quantity === 1 && !description) continue; // empty row
    lines.push({ description, quantity, unit_price, tax_rate, amount: round2(quantity * unit_price) });
  }
  return { lines, warnings };
}

// F848: Split a total amount evenly into N line items (e.g., "split $300 into 4 lines of $75")
export function splitEvenly(totalAmount: number, lineCount: number, baseDescription?: string): any[] {
  if (lineCount <= 0) return [];
  const per = round2(totalAmount / lineCount);
  // Remainder absorbs into the LAST line so the sum equals the total exactly.
  const lines: any[] = [];
  let sum = 0;
  for (let i = 0; i < lineCount; i++) {
    const isLast = i === lineCount - 1;
    const amount = isLast ? round2(totalAmount - sum) : per;
    sum += amount;
    lines.push({
      description: baseDescription ? `${baseDescription} (${i + 1}/${lineCount})` : `Split ${i + 1}/${lineCount}`,
      quantity: 1,
      unit_price: amount,
      amount,
      tax_rate: 0,
    });
  }
  return lines;
}

// F849: Duplicate a single line (used by the "duplicate" row action)
export function duplicateLine(line: any): any {
  return { ...line, id: undefined, description: `${line.description || ''} (copy)`.trim() };
}

// F850: Recent line descriptions for autocomplete (last 90 days, dedup)
export function recentLineDescriptions(opts?: { limit?: number; days_back?: number }) {
  try {
    const since = new Date(Date.now() - (opts?.days_back || 90) * 86400000).toISOString();
    return db.getDb().prepare(`SELECT DISTINCT eli.description, COUNT(*) freq, MAX(e.date) last_seen
      FROM expense_line_items eli
      INNER JOIN expenses e ON eli.expense_id = e.id
      WHERE e.company_id = ? AND e.created_at >= ? AND eli.description IS NOT NULL AND length(trim(eli.description)) > 0
      GROUP BY eli.description
      ORDER BY freq DESC, last_seen DESC
      LIMIT ?`)
      .all(db.getCurrentCompanyId(), since, opts?.limit || 25);
  } catch (e: any) { return { error: e.message }; }
}

// F851: Search inventory items for the description autocomplete picker
export function searchInventoryForLine(query: string, limit = 10) {
  try {
    const q = `%${(query || '').toLowerCase()}%`;
    return db.getDb().prepare(`SELECT id, name, sku, unit_price, default_account_id FROM inventory_items
      WHERE company_id = ? AND (LOWER(name) LIKE ? OR LOWER(sku) LIKE ?)
      ORDER BY name LIMIT ?`)
      .all(db.getCurrentCompanyId(), q, q, limit);
  } catch (e: any) { return []; }
}

// F852: Tax breakdown by jurisdiction across the current line items (form helper)
// Used in the totals area to show "CA State $X + County $Y + City $Z"
export function taxBreakdownByJurisdiction(lines: any[]): Array<{ jurisdiction: string; amount: number }> {
  const buckets: Record<string, number> = {};
  for (const line of lines || []) {
    const subtotal = (line.quantity || 0) * (line.unit_price || 0) - (line.discount_amount || 0);
    if (line.is_tax_exempt) continue;
    const jurisdictions = line.tax_jurisdictions || [];
    if (jurisdictions.length === 0) {
      // Single tax_rate applied as "Tax"
      const tax = subtotal * ((line.tax_rate || 0) / 100);
      if (tax > 0) buckets['Tax'] = round2((buckets['Tax'] || 0) + tax);
    } else {
      for (const j of jurisdictions) {
        const tax = subtotal * ((j.rate || 0) / 100);
        if (tax > 0) {
          const key = j.jurisdiction || 'Tax';
          buckets[key] = round2((buckets[key] || 0) + tax);
        }
      }
    }
  }
  return Object.entries(buckets).map(([jurisdiction, amount]) => ({ jurisdiction, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

// ════════════════════════════════════════════════════════════════════
// Line-level helpers (F853-F858)
// ════════════════════════════════════════════════════════════════════

// F853: Compute effective amount for one line (qty × price − discount)
export function computeLineEffectiveAmount(line: any): { subtotal: number; discount: number; pre_tax: number; tax: number; total: number } {
  const subtotal = round2((line.quantity || 0) * (line.unit_price || 0));
  const discount = line.discount_amount
    ? round2(line.discount_amount)
    : line.discount_percent
      ? round2(subtotal * (line.discount_percent / 100))
      : 0;
  const pre_tax = round2(Math.max(0, subtotal - discount));
  const tax = line.is_tax_exempt ? 0 : round2(pre_tax * ((line.tax_rate || 0) / 100));
  const total = round2(pre_tax + tax);
  return { subtotal, discount, pre_tax, tax, total };
}

// F854: Compute % contribution of each line to the grand total (for the contribution bars)
export function lineContributions(lines: any[]): Array<{ index: number; percent: number }> {
  const totals = (lines || []).map(l => computeLineEffectiveAmount(l).total);
  const grand = totals.reduce((s, n) => s + n, 0);
  if (grand <= 0) return totals.map((_, i) => ({ index: i, percent: 0 }));
  return totals.map((t, i) => ({ index: i, percent: round2((t / grand) * 100) }));
}

// F855: Apply a single tax rate to ALL lines (bulk fill helper)
export function applyTaxRateToAll(lines: any[], ratePercent: number): any[] {
  return (lines || []).map(line => ({
    ...line,
    tax_rate: ratePercent,
    tax_amount: round2((line.quantity || 0) * (line.unit_price || 0) * (ratePercent / 100)),
  }));
}

// F856: Mark all lines tax-exempt / non-exempt (bulk toggle)
export function setAllTaxExempt(lines: any[], exempt: boolean): any[] {
  return (lines || []).map(line => ({ ...line, is_tax_exempt: exempt ? 1 : 0 }));
}

// F857: Reorder lines (drag-drop helper — returns new array with item moved)
export function reorderLines(lines: any[], fromIndex: number, toIndex: number): any[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= lines.length || toIndex >= lines.length) return lines;
  const arr = [...lines];
  const [item] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, item);
  return arr;
}

// F858: Validate a set of lines — returns warnings (e.g., empty descriptions, negative qty)
export function validateLines(lines: any[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < (lines || []).length; i++) {
    const l = lines[i];
    if (!l.description || !l.description.trim()) warnings.push(`Line ${i + 1}: missing description`);
    if ((l.quantity || 0) <= 0) warnings.push(`Line ${i + 1}: quantity must be > 0`);
    if ((l.unit_price || 0) < 0) warnings.push(`Line ${i + 1}: unit price cannot be negative`);
    if (l.discount_amount && l.discount_percent) warnings.push(`Line ${i + 1}: has both fixed and % discount — fixed wins`);
    if ((l.tax_rate || 0) > 30 && !l.is_tax_exempt) warnings.push(`Line ${i + 1}: tax rate ${l.tax_rate}% looks unusually high — check format`);
  }
  return warnings;
}

// ════════════════════════════════════════════════════════════════════
// Statistics (F859-F862)
// ════════════════════════════════════════════════════════════════════

// F859: Per-category totals across all lines (drives the "% by category" widget)
export function categoryRollupForLines(lines: any[], categoryNames: Record<string, string>): Array<{ category_id: string; name: string; total: number; line_count: number }> {
  const buckets: Record<string, { total: number; count: number }> = {};
  for (const line of lines || []) {
    const key = line.category_id || '__unassigned__';
    if (!buckets[key]) buckets[key] = { total: 0, count: 0 };
    buckets[key].total += computeLineEffectiveAmount(line).total;
    buckets[key].count += 1;
  }
  return Object.entries(buckets).map(([category_id, b]) => ({
    category_id,
    name: category_id === '__unassigned__' ? '(unassigned)' : (categoryNames[category_id] || '(deleted category)'),
    total: round2(b.total),
    line_count: b.count,
  })).sort((a, b) => b.total - a.total);
}

// F860: Per-project totals (drives billable-rebill projections)
export function projectRollupForLines(lines: any[], projectNames: Record<string, string>): Array<{ project_id: string; name: string; total: number; line_count: number }> {
  const buckets: Record<string, { total: number; count: number }> = {};
  for (const line of lines || []) {
    const key = line.project_id || '__unassigned__';
    if (!buckets[key]) buckets[key] = { total: 0, count: 0 };
    buckets[key].total += computeLineEffectiveAmount(line).total;
    buckets[key].count += 1;
  }
  return Object.entries(buckets).map(([project_id, b]) => ({
    project_id,
    name: project_id === '__unassigned__' ? '(no project)' : (projectNames[project_id] || '(deleted project)'),
    total: round2(b.total),
    line_count: b.count,
  })).sort((a, b) => b.total - a.total);
}

// F861: Top templates report (which are used most)
export function topTemplatesReport(limit = 10) {
  try {
    return db.getDb().prepare(`SELECT id, name, times_used, last_used_at
      FROM expense_itemization_templates
      WHERE company_id = ? AND times_used > 0
      ORDER BY times_used DESC LIMIT ?`)
      .all(db.getCurrentCompanyId(), limit);
  } catch (e: any) { return []; }
}

// F862: Quick-summary of a line set (used in the saving toast / preview)
export function summarizeLineSet(lines: any[]): { count: number; subtotal: number; discount: number; tax: number; total: number } {
  let subtotal = 0, discount = 0, tax = 0, total = 0;
  for (const l of lines || []) {
    const e = computeLineEffectiveAmount(l);
    subtotal += e.subtotal;
    discount += e.discount;
    tax += e.tax;
    total += e.total;
  }
  return {
    count: (lines || []).length,
    subtotal: round2(subtotal),
    discount: round2(discount),
    tax: round2(tax),
    total: round2(total),
  };
}
