// MICR E-13B font embedded as a base64 data URI so the check HTML is
// self-contained and renders inside the sandboxed printToPDF window (which
// has no filesystem access). Deliberate exception to the "system fonts
// only" convention in print-templates.ts — no OS ships an E-13B face.
// License of the bundled font: docs/licenses/MICR-E13B-LICENSE.txt
//
// When empty, micrFontFace() returns '' and checks fall back to a monospace
// face (still legible). Populate MICR_FONT_DATA_URI with a base64 woff2/ttf
// to enable authentic E-13B rendering.
export const MICR_FONT_DATA_URI = '';

export function micrFontFace(): string {
  if (!MICR_FONT_DATA_URI) return '';
  return `@font-face{font-family:'MICRE13B';` +
    `src:url(${MICR_FONT_DATA_URI}) format('woff2');` +
    `font-weight:normal;font-style:normal;}`;
}

// True when an embedded font is available (checks use this to decide whether
// to render the E-13B glyph form or a human-readable fallback line).
export function hasMicrFont(): boolean { return !!MICR_FONT_DATA_URI; }
