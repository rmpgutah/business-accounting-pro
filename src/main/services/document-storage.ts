import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';

export function getMimeType(filename: string): string {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.pdf')) return 'application/pdf';
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
  if (ext.endsWith('.gif')) return 'image/gif';
  if (ext.endsWith('.csv')) return 'text/csv';
  if (ext.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

export interface StoredFile {
  path: string;
  size: number;
  mimeType: string;
}

// Copies `sourcePath` into `<userDataPath>/documents/<companyId>/<uuid>-<basename>`,
// creating the per-company directory if needed. Returns the new path so the
// caller never has to depend on the original file surviving.
export function copyIntoDocumentsStore(
  userDataPath: string,
  companyId: string,
  sourcePath: string
): StoredFile {
  const destDir = path.join(userDataPath, 'documents', companyId);
  fs.mkdirSync(destDir, { recursive: true });

  const basename = path.basename(sourcePath);
  const destPath = path.join(destDir, `${uuid()}-${basename}`);
  fs.copyFileSync(sourcePath, destPath);

  const stats = fs.statSync(destPath);
  return {
    path: destPath,
    size: stats.size,
    mimeType: getMimeType(basename),
  };
}
