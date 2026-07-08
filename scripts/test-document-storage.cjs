// Regression tests for document copy-into-store + mime detection.
//
// The repo has no test runner, so this is a dependency-free assertion
// script. Run with: npm run test:attachments
// (builds the main process first, then executes against dist/ output).

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const modPath = path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'document-storage.js');
let mod;
try {
  mod = require(modPath);
} catch (e) {
  console.error(`\nCould not load compiled module at ${modPath}.`);
  console.error('Run `npm run build:main` first (or use `npm run test:attachments`).\n');
  throw e;
}

const { getMimeType, copyIntoDocumentsStore } = mod;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('document-storage regression tests\n');

test('getMimeType maps known extensions', () => {
  assert.strictEqual(getMimeType('receipt.PDF'), 'application/pdf');
  assert.strictEqual(getMimeType('photo.jpg'), 'image/jpeg');
  assert.strictEqual(getMimeType('photo.jpeg'), 'image/jpeg');
  assert.strictEqual(getMimeType('logo.png'), 'image/png');
  assert.strictEqual(getMimeType('data.csv'), 'text/csv');
  assert.strictEqual(getMimeType('book.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.strictEqual(getMimeType('notes.txt'), 'application/octet-stream');
});

test('copyIntoDocumentsStore copies the file into a per-company folder and survives source deletion', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bap-doc-test-'));
  const userDataPath = path.join(tmpRoot, 'userData');
  const sourcePath = path.join(tmpRoot, 'original-invoice.pdf');
  fs.writeFileSync(sourcePath, 'fake pdf bytes');

  const result = copyIntoDocumentsStore(userDataPath, 'company-123', sourcePath);

  assert.ok(result.path.includes(path.join('documents', 'company-123')));
  assert.strictEqual(result.mimeType, 'application/pdf');
  assert.strictEqual(result.size, fs.statSync(sourcePath).size);
  assert.ok(fs.existsSync(result.path));

  // Deleting the original must not affect the copy.
  fs.unlinkSync(sourcePath);
  assert.ok(fs.existsSync(result.path), 'copy must survive source deletion');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

console.log(`\n${passed} passed.`);
