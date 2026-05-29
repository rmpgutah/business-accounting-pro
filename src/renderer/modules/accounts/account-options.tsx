// account-options.tsx
// Shared renderer for account <select> dropdowns: groups options by account
// type (standard accounting order), sorts alphabetically by code within each
// group, and uses a concise `code · name` label. Keeps every account picker
// in the app consistent.
import React from 'react';

export interface AcctOption {
  id: string;
  code?: string | null;
  name: string;
  type?: string | null;
}

// Standard financial-statement ordering, not alphabetical-by-type.
const TYPE_ORDER: Array<{ key: string; label: string }> = [
  { key: 'asset', label: 'Assets' },
  { key: 'liability', label: 'Liabilities' },
  { key: 'equity', label: 'Equity' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'expense', label: 'Expenses' },
];

const byCode = (a: AcctOption, b: AcctOption) =>
  (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }) ||
  (a.name || '').localeCompare(b.name || '');

const label = (a: AcctOption) => (a.code ? `${a.code} · ${a.name}` : a.name);

/**
 * Returns <optgroup> elements (one per account type, in accounting order),
 * each holding its accounts sorted alphabetically by code. Use inside a
 * <select>, after any leading placeholder <option>.
 */
export function renderAccountOptions(accounts: AcctOption[]): React.ReactNode {
  const byType = new Map<string, AcctOption[]>();
  for (const a of accounts) {
    const t = (a.type || 'other').toLowerCase();
    (byType.get(t) ?? byType.set(t, []).get(t)!).push(a);
  }

  const groups: React.ReactNode[] = [];
  const seen = new Set<string>();
  const pushGroup = (key: string, groupLabel: string) => {
    const list = byType.get(key);
    if (!list || list.length === 0) return;
    seen.add(key);
    groups.push(
      <optgroup key={key} label={groupLabel}>
        {[...list].sort(byCode).map((a) => (
          <option key={a.id} value={a.id}>{label(a)}</option>
        ))}
      </optgroup>
    );
  };

  for (const { key, label: l } of TYPE_ORDER) pushGroup(key, l);
  // Any non-standard types fall through, alphabetized by their type name.
  for (const key of [...byType.keys()].filter((k) => !seen.has(k)).sort()) {
    pushGroup(key, key.charAt(0).toUpperCase() + key.slice(1));
  }
  return groups;
}
