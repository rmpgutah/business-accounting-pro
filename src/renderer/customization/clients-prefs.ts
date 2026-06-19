// src/renderer/customization/clients-prefs.ts
//
// Typed read-side for the Clients section. Same shape as
// invoicing-prefs.ts / expenses-prefs.ts — copy-paste with the field
// names swapped to whatever the section descriptor defines.

import { useCustomizationStore } from '../stores/customizationStore';
import { optionKey } from './registry';

type Value = boolean | string | number;

function val(id: string): Value | undefined {
  return useCustomizationStore.getState().get(optionKey('clients', id));
}
function bool(id: string, fallback = false): boolean {
  const v = val(id);
  return v == null ? fallback : Boolean(v);
}
function num(id: string, fallback: number): number {
  const v = Number(val(id));
  return Number.isFinite(v) ? v : fallback;
}
function str(id: string, fallback: string): string {
  const v = val(id);
  return v == null ? fallback : String(v);
}

const CURRENCY_SYMBOL: Record<string, string> = {
  usd: '$', eur: '€', gbp: '£', cad: '$', aud: '$',
};

export function clientsCurrencySymbol(): string {
  return CURRENCY_SYMBOL[str('clients-currency-symbol', 'usd')] ?? '$';
}

/**
 * Format a balance amount per Clients formatting prefs (decimals,
 * thousands sep, symbol position, negative style, zero-balance display).
 */
export function formatClientAmount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) n = 0;
  let v = Number(n);

  // Zero-balance display: dash | zero | blank.
  if (Math.abs(v) < 0.005) {
    switch (str('clients-zero-balance-display', 'dash')) {
      case 'blank': return '';
      case 'dash':  return '—';
      // 'zero' falls through to the normal formatter.
    }
  }

  const decimals = Math.max(0, Math.min(4, num('clients-decimal-places', 2)));
  const negStyle = str('clients-negative-balance-style', 'parentheses');
  const isNegative = v < 0;
  v = Math.abs(v);
  const fixed = v.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');

  const thouMap: Record<string, string> = { comma: ',', period: '.', space: ' ', none: '' };
  const thouSep = thouMap[str('clients-thousands-separator', 'comma')] ?? ',';

  let grouped = '';
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) grouped += thouSep;
    grouped += intPart[i];
  }
  const number = decPart ? `${grouped}.${decPart}` : grouped;

  const symbol = clientsCurrencySymbol();
  const before = str('clients-currency-position', 'before') === 'before';
  let body = before ? `${symbol}${number}` : `${number}${symbol}`;
  if (isNegative) body = negStyle === 'parentheses' ? `(${body})` : `-${body}`;
  return body;
}

export function isClientNegativeRed(n: number | null | undefined): boolean {
  return Number(n) < 0 && str('clients-negative-balance-style', 'parentheses') === 'red';
}

/** Date formatter mirrors expenses-prefs. */
export function formatClientDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const monShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  switch (str('clients-date-format', 'mdy')) {
    case 'dmy':  return `${dd}/${mm}/${yyyy}`;
    case 'iso':  return `${yyyy}-${mm}-${dd}`;
    case 'long': return `${monShort} ${d.getDate()}, ${yyyy}`;
    case 'mdy':
    default:     return `${mm}/${dd}/${yyyy}`;
  }
}

/**
 * Render a name per the `clients-name-format` preference. Returns the
 * input untouched when the preference is "first-last" (the common case)
 * or the company-only mode is requested with no company on file.
 */
export function formatClientName(args: {
  first?: string | null;
  last?: string | null;
  fullName?: string | null;
  company?: string | null;
}): string {
  const fmt = str('clients-name-format', 'first-last');
  const company = (args.company || '').trim();
  const first = (args.first || '').trim();
  const last  = (args.last  || '').trim();
  const full  = (args.fullName || '').trim();
  if (fmt === 'company-only' && company) return company;
  if (fmt === 'last-first') {
    if (last && first) return `${last}, ${first}`;
    if (full && full.includes(' ')) {
      const parts = full.split(/\s+/);
      const ln = parts.pop()!;
      return `${ln}, ${parts.join(' ')}`;
    }
    return full || last || first || company || '';
  }
  // first-last (default)
  return full || [first, last].filter(Boolean).join(' ') || company || '';
}

/**
 * Format a phone number per `clients-phone-format`. The "national" mode
 * assumes US-style (XXX) XXX-XXXX for 10-digit input; longer strings
 * flip to international with the country code preserved.
 */
export function formatClientPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = String(raw).replace(/\D+/g, '');
  if (!digits) return String(raw);
  const fmt = str('clients-phone-format', 'national');
  if (fmt === 'raw') return digits;
  if (fmt === 'international') {
    if (digits.length === 10) return `+1 ${digits.slice(0,3)} ${digits.slice(3,6)} ${digits.slice(6)}`;
    if (digits.length === 11) return `+${digits.slice(0,1)} ${digits.slice(1,4)} ${digits.slice(4,7)} ${digits.slice(7)}`;
    return `+${digits}`;
  }
  // national
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 7)  return `${digits.slice(0,3)}-${digits.slice(3)}`;
  return digits;
}

export interface ClientsPrefs {
  rowsPerPage: number;
  density: 'compact' | 'comfortable' | 'spacious';
  showAvatars: boolean;
  avatarStyle: 'initials' | 'logo' | 'gravatar' | 'none';
  zebra: boolean;
  stickyHeader: boolean;
  showRowNumbers: boolean;
  showQuickStats: boolean;
  highlightOverdue: boolean;
  showFavoritesFirst: boolean;
  showInactive: boolean;
  inactiveStyle: 'dimmed' | 'strikethrough' | 'badge';
  showTagsInline: boolean;
  maxInlineTags: number;
  truncateLongNames: boolean;
  nameMaxLength: number;
  capitalizeNames: boolean;
}

function readPrefs(): ClientsPrefs {
  return {
    rowsPerPage: num('clients-rows-per-page', 25),
    density: str('clients-row-density', 'comfortable') as ClientsPrefs['density'],
    showAvatars: bool('clients-show-avatars', true),
    avatarStyle: str('clients-avatar-style', 'initials') as ClientsPrefs['avatarStyle'],
    zebra: bool('clients-zebra-striping', true),
    stickyHeader: bool('clients-sticky-header', true),
    showRowNumbers: bool('clients-show-row-numbers', false),
    showQuickStats: bool('clients-show-quick-stats', true),
    highlightOverdue: bool('clients-highlight-overdue', true),
    showFavoritesFirst: bool('clients-show-favorites-first', true),
    showInactive: bool('clients-show-inactive', false),
    inactiveStyle: str('clients-inactive-style', 'dimmed') as ClientsPrefs['inactiveStyle'],
    showTagsInline: bool('clients-show-tags-inline', true),
    maxInlineTags: num('clients-max-inline-tags', 3),
    truncateLongNames: bool('clients-truncate-long-names', true),
    nameMaxLength: num('clients-name-max-length', 40),
    capitalizeNames: bool('clients-capitalize-names', true),
  };
}

export function useClientsPrefs(): ClientsPrefs {
  useCustomizationStore((s) => s.values);
  return readPrefs();
}

export function getClientsPrefs(): ClientsPrefs {
  return readPrefs();
}
