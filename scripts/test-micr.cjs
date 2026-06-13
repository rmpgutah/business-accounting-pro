// Dependency-free assertions for the MICR encoder. Run: npm run test:micr
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, '.tmp-test');
fs.rmSync(out, { recursive: true, force: true });
execSync(`npx tsc src/renderer/lib/micr.ts --outDir .tmp-test ` +
  `--module commonjs --target ES2019 --moduleResolution node10 --skipLibCheck --ignoreConfig --ignoreDeprecations 6.0`,
  { cwd: root, stdio: 'inherit' });
const m = require(path.join(out, 'micr.js'));

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('canonical layout with check number', () => {
  assert.strictEqual(
    m.buildMicrCanonical({ routing: '123456789', account: '0001234567', checkNumber: '1042' }),
    'O1042O T123456789T 0001234567O');
});
t('routing padded to 9 digits', () => {
  assert.ok(m.buildMicrCanonical({ routing: '12345', account: '99' }).includes('T000012345T'));
});
t('no aux field when checkNumber absent', () => {
  assert.ok(!m.buildMicrCanonical({ routing: '123456789', account: '5' }).startsWith('O'));
});
t('amount field never emitted', () => {
  assert.ok(!m.buildMicrCanonical({ routing: '123456789', account: '5', checkNumber: '1' }).includes('A'));
});
t('glyph map converts tokens (T->A, O->C)', () => {
  const g = m.buildMicrLine({ routing: '123456789', account: '0001234567', checkNumber: '1042' });
  assert.ok(!/[TO]/.test(g), 'no raw tokens left');
  assert.ok(g.startsWith('C1042C A123456789A'), 'mapped glyphs');
});

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${passed} passed`);
