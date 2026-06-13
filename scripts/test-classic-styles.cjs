// Dependency-free assertions for the classic style helpers. The repo has
// no test runner; this compiles the single pure TS module with tsc and
// requires the JS output. Run: npm run test:classic
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, '.tmp-test');
fs.rmSync(out, { recursive: true, force: true });
execSync(`npx tsc src/renderer/lib/classic-styles.ts --outDir .tmp-test ` +
  `--module commonjs --target ES2019 --moduleResolution node10 --skipLibCheck --ignoreConfig --ignoreDeprecations 6.0`,
  { cwd: root, stdio: 'inherit' });

const m = require(path.join(out, 'classic-styles.js'));
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('classicStyles uses Arial, black, ruled tables', () => {
  const css = m.classicStyles();
  assert.ok(css.includes('Arial'), 'has Arial');
  assert.ok(css.includes('#000'), 'has black');
  assert.ok(css.includes('border-collapse'), 'has ruled tables');
  assert.ok(!/Inter|#2563eb|Source Serif/.test(css), 'no glass-era styles');
});
t('ruledTable emits one th per column and num class on right cols', () => {
  const html = m.ruledTable(
    [{ label: 'Desc' }, { label: 'Amt', align: 'right' }],
    [['Widget', '$1.00']]);
  assert.ok(html.includes('<table class="ruled">'));
  assert.ok(html.includes('<thead>'), 'has thead (repeats header across PDF pages)');
  assert.strictEqual((html.match(/<th[\s>]/g) || []).length, 2);
  assert.ok(html.includes('<td class="num">$1.00</td>'));
});
t('metaStrip escapes labels', () => {
  const html = m.metaStrip([{ label: '<x>', value: 'v' }]);
  assert.ok(html.includes('&lt;x&gt;'), 'label escaped');
});
t('totalsBox marks grand row', () => {
  const html = m.totalsBox([{ label: 'Total', value: '$5', grand: true }]);
  assert.ok(html.includes('<tr class="grand">'));
});

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${passed} passed`);
