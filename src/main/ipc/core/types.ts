import type Database from 'better-sqlite3';
import type { PDFMetadata } from '../../services/print-preview';

export interface ClosedPeriod {
  id: string;
  period_start: string;
  period_end: string;
  close_reason: string;
}

export interface JournalLine {
  nameHint: string;
  debit: number;
  credit: number;
  note?: string;
}

export interface HandlerCtx {
  cid: string | null;
  db: Database.Database;
  deps: IpcDeps;
}

export interface IpcDeps {
  scheduleAutoBackup(): void;
  cancelAutoBackup(): void;
  getLastLoginEmail(): string | null;
  setLastLoginEmail(email: string | null): void;
  findClosedPeriod(companyId: string, date: string): ClosedPeriod | null;
  postJournalEntry(dbi: Database.Database, companyId: string, date: string, description: string, lines: JournalLine[]): void;
  validateTable(table: string): boolean;
  cleanupReferencesBeforeDelete(table: string, id: string): void;
  isRawQueryAllowed(sql: string): { ok: boolean; reason?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildInvoiceMetadata(invoice: any, company: any, client: any): PDFMetadata;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildBillMetadata(bill: any, company: any, vendor: any): PDFMetadata;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildPOMetadata(po: any, company: any, vendor: any): PDFMetadata;
  VALID_TABLES: Set<string>;
  PROTECTED_TABLES: Set<string>;
}
