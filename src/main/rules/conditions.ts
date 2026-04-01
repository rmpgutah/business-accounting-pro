// src/main/rules/conditions.ts
export interface Condition {
  field: string;
  op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'starts_with' | 'ends_with' | 'in' | 'regex' | 'between';
  value: unknown;
}

export function evaluateCondition(condition: Condition, record: Record<string, unknown>): boolean {
  const raw = record[condition.field];
  const { op, value } = condition;

  switch (op) {
    case 'eq':          return raw == value;
    case 'neq':         return raw != value;
    case 'lt':          return Number(raw) < Number(value);
    case 'lte':         return Number(raw) <= Number(value);
    case 'gt':          return Number(raw) > Number(value);
    case 'gte':         return Number(raw) >= Number(value);
    case 'contains':    return String(raw ?? '').toLowerCase().includes(String(value).toLowerCase());
    case 'starts_with': return String(raw ?? '').toLowerCase().startsWith(String(value).toLowerCase());
    case 'ends_with':   return String(raw ?? '').toLowerCase().endsWith(String(value).toLowerCase());
    case 'in':          return Array.isArray(value) && value.includes(raw);
    case 'regex':       return new RegExp(String(value), 'i').test(String(raw ?? ''));
    case 'between': {
      const [min, max] = value as [number, number];
      const n = Number(raw);
      return n >= min && n <= max;
    }
    default: return false;
  }
}

// Returns true if ALL conditions pass (AND logic)
export function evaluateConditions(conditions: Condition[], record: Record<string, unknown>): boolean {
  if (conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, record));
}
