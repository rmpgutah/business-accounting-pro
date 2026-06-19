type FormValue = string | number | boolean | null | undefined;

function valueToString(value: FormValue): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function required(value: FormValue, label: string): string | null {
  if (typeof value === 'boolean') return value ? null : `${label} is required`;
  return valueToString(value).trim() ? null : `${label} is required`;
}

export function email(value: FormValue): string | null {
  const normalized = valueToString(value).trim();
  if (!normalized) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? null : 'Invalid email address';
}

export function minValue(value: FormValue, min: number, label: string): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? null : `${label} must be at least ${min}`;
}

export function maxValue(value: FormValue, max: number, label: string): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n <= max ? null : `${label} must be ${max} or less`;
}

export function maxLength(value: FormValue, max: number, label: string): string | null {
  return valueToString(value).length <= max ? null : `${label} must be ${max} characters or less`;
}

export function validDate(value: FormValue, label: string): string | null {
  const normalized = valueToString(value).trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${label} must be a valid date`;
  const d = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(d.getTime()) ? `${label} must be a valid date` : null;
}

export function dateNotBefore(value: FormValue, minDate: FormValue, label: string, minLabel: string): string | null {
  const v = valueToString(value).trim();
  const min = valueToString(minDate).trim();
  if (!v || !min) return null;
  return v >= min ? null : `${label} cannot be before ${minLabel}`;
}

export function finiteNumber(value: FormValue, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? null : `${label} must be a valid number`;
}

export function money(
  value: FormValue,
  label: string,
  opts: { allowZero?: boolean; allowNegative?: boolean } = {}
): string | null {
  const normalized = valueToString(value).trim();
  if (!normalized) return `${label} is required`;

  const n = Number(normalized);
  if (!Number.isFinite(n)) return `${label} must be a valid amount`;
  if (!opts.allowNegative && n < 0) return `${label} cannot be negative`;
  if (!opts.allowZero && n === 0) return `${label} cannot be zero`;

  return null;
}

export function percentage(value: FormValue, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return `${label} must be a valid percentage`;
  if (n < 0 || n > 100) return `${label} must be between 0 and 100`;

  return null;
}

export function validateForm(checks: Array<string | null | undefined | false>): string[] {
  return checks.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
}
