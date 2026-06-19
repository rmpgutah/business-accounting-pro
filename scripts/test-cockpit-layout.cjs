// Pure grid-math tests for the cockpit layout. Run: npm run test:cockpit
const assert = require('node:assert');
const path = require('node:path');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

// layout-utils is renderer TS (types only). Compile this one file on the fly with
// fully explicit flags. TypeScript 6.x errors (TS5112) when a tsconfig.json is
// present alongside a command-line file list, so we pass --ignoreConfig to make
// the compile fully self-contained and independent of the project tsconfig.
// layout-utils has zero imports, so module resolution is irrelevant — we omit
// --moduleResolution (its 'node'→'node10' alias is deprecated/errors in TS 6.x).
const repoRoot = path.resolve(__dirname, '..');
const srcFile = path.join(repoRoot, 'src/renderer/modules/cockpit/layout-utils.ts');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-'));
execSync(
  `npx tsc "${srcFile}" --outDir "${outDir}" --module commonjs --target ES2022 --skipLibCheck --ignoreConfig`,
  { stdio: 'inherit', cwd: repoRoot }
);
const u = require(path.join(outDir, 'layout-utils.js'));

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };
console.log('cockpit-layout tests\n');

test('clampPlacement keeps widgets in bounds', () => {
  assert.deepStrictEqual(u.clampPlacement({ id: 'a', type: 't', x: 11, y: -2, w: 6, h: 0 }), { id: 'a', type: 't', x: 6, y: 0, w: 6, h: 1 });
});
test('clampPlacement caps width to grid', () => {
  assert.strictEqual(u.clampPlacement({ id: 'a', type: 't', x: 0, y: 0, w: 99, h: 2 }).w, u.GRID_COLS);
});
test('nextFreeRow returns 0 for empty layout', () => {
  assert.strictEqual(u.nextFreeRow([]), 0);
});
test('nextFreeRow returns below lowest widget', () => {
  assert.strictEqual(u.nextFreeRow([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }, { id: 'b', type: 't', x: 4, y: 3, w: 4, h: 1 }]), 4);
});
test('addWidget places new widget at the bottom full-defaults', () => {
  const out = u.addWidget([{ id: 'a', type: 't', x: 0, y: 0, w: 12, h: 2 }], 'kpi', 'b');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].y, 2);
});
test('removeWidget drops by id', () => {
  assert.strictEqual(u.removeWidget([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }], 'a').length, 0);
});
test('updatePlacement patches + re-clamps', () => {
  const out = u.updatePlacement([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }], 'a', { x: 99 });
  assert.strictEqual(out[0].x, u.GRID_COLS - 4);
});
test('pixelToCell maps offset to grid', () => {
  // canvas 1200px / 12 cols = 100px per col; 250px → col 3 (rounded: 2.5 → 3 via round-half-up)
  assert.strictEqual(u.pixelToCell(250, 0, 1200, 80).x, 3);
});

console.log(`\n${passed} passed`);
