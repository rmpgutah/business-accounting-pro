// Shared helpers for expense categorization, tax & compliance features.
import api from '../../lib/api';

export interface CategoryRow {
  id: string;
  name: string;
  type?: string;
  color?: string;
  icon?: string;
  is_active?: number | boolean;
  parent_id?: string | null;
  monthly_cap?: number;
  default_account_id?: string;
  required_fields?: string;
}

export interface CategoryNode extends CategoryRow {
  children: CategoryNode[];
  fullPath: string;
}

/**
 * Build a parent-grouped, alphabetized tree of categories.
 * Categories with `parent_id` are nested under their parent and rendered as
 * "[Parent] / [Sub]" in dropdowns.
 */
export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const r of rows) {
    byId.set(r.id, { ...r, children: [], fullPath: r.name });
  }
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      const parent = byId.get(node.parent_id)!;
      parent.children.push(node);
      node.fullPath = `${parent.name} / ${node.name}`;
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (arr: CategoryNode[]) => {
    arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const n of arr) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

/** Flatten a tree into a list ordered by parent group, child below. */
export function flattenCategoryTree(roots: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (nodes: CategoryNode[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** Suggest the most-frequent category for a vendor (last 5 expenses). */
export async function suggestCategoryForVendor(vendorId: string): Promise<string | null> {
  if (!vendorId) return null;
  try {
    const rows: any = await api.rawQuery(
      `SELECT category_id, COUNT(*) as c FROM (
         SELECT category_id FROM expenses
         WHERE vendor_id = ? AND category_id IS NOT NULL AND category_id != ''
         ORDER BY date DESC LIMIT 5
       ) GROUP BY category_id ORDER BY c DESC LIMIT 1`,
      [vendorId]
    );
    const arr = Array.isArray(rows) ? rows : [];
    return arr[0]?.category_id || null;
  } catch {
    return null;
  }
}

/** Number of times a category was used by this company in the current month. */
export async function categoryMonthlyUsage(
  companyId: string,
  categoryId: string
): Promise<{ count: number; total: number }> {
  if (!companyId || !categoryId) return { count: 0, total: 0 };
  try {
    const rows: any = await api.rawQuery(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total
       FROM expenses WHERE company_id = ? AND category_id = ?
         AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')`,
      [companyId, categoryId]
    );
    const r = Array.isArray(rows) ? rows[0] : rows;
    return { count: Number(r?.count || 0), total: Number(r?.total || 0) };
  } catch {
    return { count: 0, total: 0 };
  }
}

/** Parse JSON string safely. */
export function parseJSON<T>(s: any, fallback: T): T {
  if (s == null) return fallback;
  if (typeof s !== 'string') return s as T;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export interface CustomFieldDef {
  id?: string;
  field_name: string;
  field_label: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  options?: string[];
  is_required?: number | boolean;
}
