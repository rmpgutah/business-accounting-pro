// Embed a MICR E-13B font file into src/renderer/lib/micr-font.ts as a base64
// data URI, so the check HTML is self-contained for Electron's printToPDF.
//
// No permissively-licensed E-13B font ships publicly, so the font file is not
// committed. Download MicrEncoding (Digital Graphics Labs) — or any E-13B
// font you are licensed to use — then run:
//
//   node scripts/embed-micr-font.cjs /path/to/MICRENC.TTF
//
// This rewrites micr-font.ts in place (data URI + correct @font-face format).
// It never prints the base64 to stdout. After running, verify the symbol
// mapping on a rendered check; if the font's transit/on-us/amount/dash glyphs
// are not on A/B/C/D, update MICR_GLYPH_MAP in src/renderer/lib/micr.ts.
const fs = require('node:fs');
const path = require('node:path');

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/embed-micr-font.cjs /path/to/font.(ttf|otf|woff2)');
  process.exit(1);
}
const buf = fs.readFileSync(src);

// Detect format from magic bytes.
const head = buf.subarray(0, 4).toString('latin1');
const hex = buf.subarray(0, 4).toString('hex');
let mime, fmt;
if (head === 'wOF2') { mime = 'font/woff2'; fmt = 'woff2'; }
else if (head === 'wOFF') { mime = 'font/woff'; fmt = 'woff'; }
else if (head === 'OTTO') { mime = 'font/otf'; fmt = 'opentype'; }
else if (hex === '00010000' || head === 'true' || head === 'ttcf') { mime = 'font/ttf'; fmt = 'truetype'; }
else { console.error(`Not a recognized font file (magic bytes: ${hex}).`); process.exit(1); }

const b64 = buf.toString('base64');
const dataUri = `data:${mime};base64,${b64}`;

const target = path.join(__dirname, '..', 'src', 'renderer', 'lib', 'micr-font.ts');
let txt = fs.readFileSync(target, 'utf8');
txt = txt.replace(/export const MICR_FONT_DATA_URI = '[^']*';/,
  `export const MICR_FONT_DATA_URI = '${dataUri}';`);
txt = txt.replace(/format\('[a-z0-9]+'\)/, `format('${fmt}')`);
fs.writeFileSync(target, txt);

console.log(`Embedded ${path.basename(src)} (${buf.length} bytes, ${fmt}) into micr-font.ts.`);
console.log('Next: run `npm run typecheck && npm run build`, then verify a rendered check.');
