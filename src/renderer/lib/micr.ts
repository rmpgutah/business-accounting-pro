// MICR E-13B line builder. Pure, no imports — unit-tested in
// scripts/test-micr.cjs. The font (data URI) lives in micr-font.ts; this
// module only sequences characters per the ANSI X9 / ABA MICR grammar.
//
// Canonical symbol tokens (data is digit-only, so these letters never clash):
export const TRANSIT = 'T';   // routing flank
export const ONUS    = 'O';   // on-us field delimiter (account / check no)
export const AMOUNT  = 'A';   // amount flank (bank adds later — NOT emitted here)
export const DASH    = 'D';   // sub-field separator

// Maps a canonical token to the character the bundled E-13B font draws as
// that symbol. PIN to the chosen font in the font task (most E-13B fonts: A/B/C/D).
export const MICR_GLYPH_MAP: Record<string, string> = {
  [TRANSIT]: 'A',
  [AMOUNT]: 'B',
  [ONUS]: 'C',
  [DASH]: 'D',
};

function onlyDigits(s: string | undefined): string { return (s || '').replace(/\D/g, ''); }

export interface MicrFields { routing: string; account: string; checkNumber?: string; }

// Issued-check layout: aux on-us (check no) ⑈, transit ⑆routing⑆, on-us account⑈.
export function buildMicrCanonical(f: MicrFields): string {
  const routing = onlyDigits(f.routing).padStart(9, '0').slice(0, 9);
  const account = onlyDigits(f.account);
  const chk = onlyDigits(f.checkNumber);
  const aux = chk ? `${ONUS}${chk}${ONUS} ` : '';
  return `${aux}${TRANSIT}${routing}${TRANSIT} ${account}${ONUS}`;
}

export function toFontGlyphs(canonical: string): string {
  return canonical.replace(/[TOAD]/g, (c) => MICR_GLYPH_MAP[c] ?? c);
}

export function buildMicrLine(f: MicrFields): string {
  return toFontGlyphs(buildMicrCanonical(f));
}

// Unicode MICR symbols, for a readable fallback line when no E-13B font is
// embedded. These code points render as the actual transit/on-us/amount/dash
// glyphs in most system fonts, so the fallback looks like a real MICR line
// rather than the font's A/B/C/D glyph-slot letters.
export const MICR_UNICODE: Record<string, string> = {
  [TRANSIT]: '⑆', // ⑆ OCR branch bank identification (transit)
  [AMOUNT]:  '⑇', // ⑇ OCR amount of check
  [ONUS]:    '⑉', // ⑉ OCR customer account number (on-us)
  [DASH]:    '⑈', // ⑈ OCR dash
};

export function buildMicrUnicode(f: MicrFields): string {
  return buildMicrCanonical(f).replace(/[TOAD]/g, (c) => MICR_UNICODE[c] ?? c);
}
