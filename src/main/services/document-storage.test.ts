import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getMimeType, copyIntoDocumentsStore } from './document-storage';

describe('document-storage', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bap-doc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getMimeType maps known extensions', () => {
    expect(getMimeType('receipt.PDF')).toBe('application/pdf');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('logo.png')).toBe('image/png');
    expect(getMimeType('data.csv')).toBe('text/csv');
    expect(getMimeType('book.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(getMimeType('notes.txt')).toBe('application/octet-stream');
  });

  it('copyIntoDocumentsStore copies the file into a per-company folder and survives source deletion', () => {
    const userDataPath = path.join(tmpRoot, 'userData');
    const sourcePath = path.join(tmpRoot, 'original-invoice.pdf');
    fs.writeFileSync(sourcePath, 'fake pdf bytes');

    const result = copyIntoDocumentsStore(userDataPath, 'company-123', sourcePath);

    expect(result.path.includes(path.join('documents', 'company-123'))).toBeTruthy();
    expect(result.mimeType).toBe('application/pdf');
    expect(result.size).toBe(fs.statSync(sourcePath).size);
    expect(fs.existsSync(result.path)).toBeTruthy();

    // Deleting the original must not affect the copy.
    fs.unlinkSync(sourcePath);
    expect(fs.existsSync(result.path), 'copy must survive source deletion').toBeTruthy();
  });
});
