export function required(value: string, label: string): string | null {
  return value.trim() ? null : `${label} is required`;
}

export function email(value: string): string | null {
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Invalid email address';
}

export function minValue(value: number, min: number, label: string): string | null {
  return value >= min ? null : `${label} must be at least ${min}`;
}

export function maxLength(value: string, max: number, label: string): string | null {
  return value.length <= max ? null : `${label} must be ${max} characters or less`;
}

export function validateForm(checks: Array<string | null>): string[] {
  return checks.filter((c): c is string => c !== null);
}
