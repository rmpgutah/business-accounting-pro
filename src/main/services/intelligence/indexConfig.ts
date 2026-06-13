// Which entities are searchable, and how each row projects into the FTS index.
// Adding a table here is the ONLY change needed to make it searchable.
export interface IndexDoc { title: string; subtitle: string; body: string; }

export interface IndexEntry {
  table: string;
  /** appStore module to navigate to when this result is chosen */
  module: string;
  /** entity-type label used by setFocusEntity + result grouping */
  entityType: string;
  toDoc: (row: any) => IndexDoc;
}

const s = (v: any) => (v == null ? '' : String(v));

export const INDEX_ENTRIES: IndexEntry[] = [
  { table: 'clients', module: 'clients', entityType: 'client',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.email), body: `${s(r.phone)} ${s(r.notes)}` }) },
  { table: 'vendors', module: 'expenses', entityType: 'vendor',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.email), body: `${s(r.phone)} ${s(r.notes)}` }) },
  { table: 'invoices', module: 'invoicing', entityType: 'invoice',
    toDoc: r => ({ title: `Invoice ${s(r.invoice_number)}`, subtitle: s(r.status), body: s(r.notes) }) },
  { table: 'bills', module: 'bills', entityType: 'bill',
    toDoc: r => ({ title: `Bill ${s(r.bill_number)}`, subtitle: s(r.status), body: s(r.notes) }) },
  { table: 'expenses', module: 'expenses', entityType: 'expense',
    toDoc: r => ({ title: s(r.description) || 'Expense', subtitle: s(r.amount), body: s(r.reference) }) },
  { table: 'quotes', module: 'quotes', entityType: 'quote',
    toDoc: r => ({ title: `Quote ${s(r.quote_number)}`, subtitle: s(r.status), body: s(r.notes) }) },
  { table: 'projects', module: 'projects', entityType: 'project',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.status), body: s(r.description) }) },
  // accounts: real columns are `type` (not account_type) and `code` (not account_number).
  { table: 'accounts', module: 'accounts', entityType: 'account',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.type), body: s(r.code) }) },
  // employees: single `name` column (no first_name/last_name); no `title` column.
  { table: 'employees', module: 'payroll', entityType: 'employee',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.email), body: '' }) },
  // debts: no `reference` column — use notes for body.
  { table: 'debts', module: 'debt-collection', entityType: 'debt',
    toDoc: r => ({ title: s(r.debtor_name), subtitle: s(r.status), body: s(r.notes) }) },
  { table: 'purchase_orders', module: 'purchase-orders', entityType: 'purchase_order',
    toDoc: r => ({ title: `PO ${s(r.po_number)}`, subtitle: s(r.status), body: s(r.notes) }) },
  // payments: real column is `payment_method` (not method).
  { table: 'payments', module: 'invoicing', entityType: 'payment',
    toDoc: r => ({ title: `Payment ${s(r.reference) || s(r.id).slice(0, 8)}`, subtitle: s(r.amount), body: s(r.payment_method) }) },
];

export const INDEXED_TABLES = new Set(INDEX_ENTRIES.map(e => e.table));
export const entryFor = (table: string) => INDEX_ENTRIES.find(e => e.table === table);
