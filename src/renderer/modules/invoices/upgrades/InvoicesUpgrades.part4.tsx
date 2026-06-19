/**
 * InvoicesUpgradesPart4 — "Export, Templates & Reporting"
 *
 * A self-contained vertical stack of ~25 small working features for the
 * Invoices module: CSV/JSON exports, aging & revenue reports, statement
 * generators, template libraries (localStorage), printable registers, a
 * monthly-close checklist, bulk actions, and an email-draft generator.
 *
 * All data is loaded live through the `api` wrapper (db:query / db:raw-query),
 * scoped to the active company. Every button does real work — no dead UI.
 * TypeScript-clean: every identifier declared, no `any` abuse.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { downloadCSVBlob, dateStampedFilename } from '../../../lib/csv-export';
import { formatCurrency, formatDate } from '../../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_id: string;
  client_name: string;
  status: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  amount_paid: number;
  notes: string;
  terms: string;
  custom_fields: string;
}

interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  payment_terms: number;
}

interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: number;
  date: string;
  payment_method: string;
  reference: string;
}

interface LineItemRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  client_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_rate: number;
}

interface RecurringRow {
  id: string;
  name: string;
  type: string;
  frequency: string;
  next_date: string;
  is_active: number;
  template_data: string;
}

interface CatalogItem {
  id?: string;
  name?: string;
  description?: string;
  unit_price?: number;
  price?: number;
  rate?: number;
}

// ─── Helpers ────────────────────────────────────────────
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const balanceOf = (inv: InvoiceRow): number => num(inv.total) - num(inv.amount_paid);

const daysOverdue = (inv: InvoiceRow): number => {
  if (inv.status === 'paid' || inv.status === 'cancelled') return 0;
  if (!inv.due_date) return 0;
  const due = new Date(`${inv.due_date}T00:00:00`).getTime();
  if (!Number.isFinite(due)) return 0;
  const d = Math.floor((Date.now() - due) / 86_400_000);
  return d > 0 ? d : 0;
};

const monthKey = (iso: string): string => (iso && iso.length >= 7 ? iso.slice(0, 7) : 'unknown');
const quarterOf = (iso: string): string => {
  if (!iso || iso.length < 7) return 'unknown';
  const m = Number(iso.slice(5, 7));
  const q = Math.floor((m - 1) / 3) + 1;
  return `${iso.slice(0, 4)}-Q${q}`;
};

const agingBucket = (days: number): string => {
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
};
const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '90+'] as const;

function parseCustomFields(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — ignore */
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadJSONBlob(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Print a report via Electron's headless printToPDF→print pipeline.
 * Replaces the legacy window.open/Blob URL approach.
 */
async function printHTML(title: string, bodyHTML: string): Promise<void> {
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<style>` +
    `body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:32px;color:#1a1a1a;}` +
    `h1{font-size:20px;margin:0 0 4px;}h2{font-size:14px;color:#555;margin:0 0 24px;font-weight:400;}` +
    `table{border-collapse:collapse;width:100%;font-size:12px;margin-top:12px;}` +
    `th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}` +
    `td.num,th.num{text-align:right;}` +
    `tfoot td{font-weight:700;background:#fafafa;}` +
    `@media print{button{display:none;}}` +
    `</style></head><body>${bodyHTML}` +
    `</body></html>`;
  await api.print(html);
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
  );

// ─── Persisted setting keys ─────────────────────────────
const LS_COLUMN_PRESETS = 'bap:inv:csvColumnPresets';
const LS_INVOICE_TEMPLATES = 'bap:inv:templates';
const LS_TERMS_PRESETS = 'bap:inv:termsPresets';
const LS_CUSTOM_LABELS = 'bap:inv:customFieldLabels';

interface ColumnPreset {
  name: string;
  columns: string[];
}
interface InvoiceTemplate {
  name: string;
  terms: string;
  lines: Array<{ description: string; quantity: number; unit_price: number }>;
}
interface CustomFieldLabels {
  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;
  custom_field_4: string;
  po_number: string;
  job_reference: string;
}

const ALL_CSV_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'invoice_number', label: 'Invoice #' },
  { key: 'client_name', label: 'Client' },
  { key: 'status', label: 'Status' },
  { key: 'issue_date', label: 'Issue Date' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'subtotal', label: 'Subtotal' },
  { key: 'tax_amount', label: 'Tax' },
  { key: 'total', label: 'Total' },
  { key: 'amount_paid', label: 'Paid' },
  { key: 'balance', label: 'Balance' },
  { key: 'days_overdue', label: 'Days Overdue' },
];

// ─── Small UI atoms ─────────────────────────────────────
const Card: React.FC<{ title: string; desc: string; children: React.ReactNode }> = ({
  title,
  desc,
  children,
}) => (
  <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
    <div style={{ marginBottom: 10 }}>
      <div className="text-text-primary" style={{ fontWeight: 600, fontSize: 14 }}>
        {title}
      </div>
      <div className="text-text-muted" style={{ fontSize: 12, marginTop: 2 }}>
        {desc}
      </div>
    </div>
    {children}
  </div>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>{children}</div>
);

const Stat: React.FC<{ label: string; value: string; tone?: 'income' | 'expense' | 'warning' | 'blue' }> = ({
  label,
  value,
  tone,
}) => {
  const color =
    tone === 'income'
      ? 'var(--color-accent-income)'
      : tone === 'expense'
        ? 'var(--color-accent-expense)'
        : tone === 'warning'
          ? 'var(--color-accent-warning)'
          : tone === 'blue'
            ? 'var(--color-accent-blue)'
            : undefined;
  return (
    <div
      className="bg-bg-tertiary"
      style={{ padding: '8px 12px', borderRadius: 'var(--app-radius)', minWidth: 110 }}
    >
      <div className="text-text-muted" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color }} className={color ? '' : 'text-text-primary'}>
        {value}
      </div>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const InvoicesUpgradesPart4: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id ?? '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([]);
  const [recurring, setRecurring] = useState<RecurringRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  // Live UI state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statementClientId, setStatementClientId] = useState('');
  const [emailInvoiceId, setEmailInvoiceId] = useState('');
  const [printInvoiceId, setPrintInvoiceId] = useState('');
  const [billingClientId, setBillingClientId] = useState('');
  const [status, setStatus] = useState<string>('');

  // Persisted settings
  const [columnPresets, setColumnPresets] = useState<ColumnPreset[]>(() =>
    lsGet<ColumnPreset[]>(LS_COLUMN_PRESETS, [])
  );
  const [activeColumns, setActiveColumns] = useState<string[]>(() =>
    ALL_CSV_COLUMNS.map((c) => c.key)
  );
  const [templates, setTemplates] = useState<InvoiceTemplate[]>(() =>
    lsGet<InvoiceTemplate[]>(LS_INVOICE_TEMPLATES, [])
  );
  const [termsPresets, setTermsPresets] = useState<string[]>(() =>
    lsGet<string[]>(LS_TERMS_PRESETS, [])
  );
  const [customLabels, setCustomLabels] = useState<CustomFieldLabels>(() =>
    lsGet<CustomFieldLabels>(LS_CUSTOM_LABELS, {
      custom_field_1: 'Custom 1',
      custom_field_2: 'Custom 2',
      custom_field_3: 'Custom 3',
      custom_field_4: 'Custom 4',
      po_number: 'PO Number',
      job_reference: 'Job Reference',
    })
  );

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(''), 3500);
  }, []);

  // ─── Load data ────────────────────────────────────────
  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [invRows, cliRows, payRows, liRows, recRows] = await Promise.all([
          api.rawQuery(
            `SELECT i.id, i.invoice_number, i.client_id, COALESCE(c.name,'—') AS client_name,
                    i.status, i.issue_date, i.due_date, i.subtotal, i.tax_amount,
                    i.discount_amount, i.total, i.amount_paid, i.notes, i.terms,
                    COALESCE(i.custom_fields,'{}') AS custom_fields
             FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
             WHERE i.company_id = ?
             ORDER BY i.issue_date DESC, i.invoice_number DESC`,
            [companyId]
          ) as Promise<InvoiceRow[]>,
          api.rawQuery(
            `SELECT id, name, COALESCE(email,'') AS email, COALESCE(phone,'') AS phone,
                    COALESCE(payment_terms,30) AS payment_terms
             FROM clients WHERE company_id = ? ORDER BY name`,
            [companyId]
          ) as Promise<ClientRow[]>,
          api.rawQuery(
            `SELECT id, invoice_id, amount, date, COALESCE(payment_method,'') AS payment_method,
                    COALESCE(reference,'') AS reference
             FROM payments WHERE company_id = ? ORDER BY date DESC`,
            [companyId]
          ) as Promise<PaymentRow[]>,
          api.rawQuery(
            `SELECT li.id, li.invoice_id, i.invoice_number, COALESCE(c.name,'—') AS client_name,
                    li.description, li.quantity, li.unit_price, li.amount, li.tax_rate
             FROM invoice_line_items li
             JOIN invoices i ON i.id = li.invoice_id
             LEFT JOIN clients c ON c.id = i.client_id
             WHERE i.company_id = ?`,
            [companyId]
          ) as Promise<LineItemRow[]>,
          api.rawQuery(
            `SELECT id, name, type, frequency, next_date, is_active,
                    COALESCE(template_data,'{}') AS template_data
             FROM recurring_templates WHERE company_id = ? AND type = 'invoice'
             ORDER BY next_date`,
            [companyId]
          ) as Promise<RecurringRow[]>,
        ]);

        let cat: CatalogItem[] = [];
        try {
          cat = (await api.listCatalogItems()) ?? [];
        } catch {
          cat = [];
        }

        if (cancelled) return;
        setInvoices(Array.isArray(invRows) ? invRows : []);
        setClients(Array.isArray(cliRows) ? cliRows : []);
        setPayments(Array.isArray(payRows) ? payRows : []);
        setLineItems(Array.isArray(liRows) ? liRows : []);
        setRecurring(Array.isArray(recRows) ? recRows : []);
        setCatalog(Array.isArray(cat) ? cat : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load invoice data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, reloadKey]);

  // ─── Derived: filtered + sorted invoices ──────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (!q) return true;
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.client_name || '').toLowerCase().includes(q)
      );
    });
  }, [invoices, search, statusFilter]);

  const exportRows = useMemo(
    () =>
      filtered.map((inv) => ({
        invoice_number: inv.invoice_number,
        client_name: inv.client_name,
        status: inv.status,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        subtotal: num(inv.subtotal).toFixed(2),
        tax_amount: num(inv.tax_amount).toFixed(2),
        total: num(inv.total).toFixed(2),
        amount_paid: num(inv.amount_paid).toFixed(2),
        balance: balanceOf(inv).toFixed(2),
        days_overdue: String(daysOverdue(inv)),
      })),
    [filtered]
  );

  const visibleCsvColumns = useMemo(
    () => ALL_CSV_COLUMNS.filter((c) => activeColumns.includes(c.key)),
    [activeColumns]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Derived rollups (declared before early returns so hooks order is stable) ─
  const recurringRows = useMemo(
    () =>
      recurring.map((r) => {
        let est = 0;
        try {
          const td = JSON.parse(r.template_data || '{}');
          est = num(td?.total ?? td?.subtotal ?? 0);
        } catch {
          est = 0;
        }
        const perMonth =
          r.frequency === 'weekly'
            ? est * 4.33
            : r.frequency === 'biweekly'
              ? est * 2.17
              : r.frequency === 'monthly'
                ? est
                : r.frequency === 'quarterly'
                  ? est / 3
                  : est / 12;
        return {
          name: r.name,
          frequency: r.frequency,
          next_date: r.next_date,
          active: r.is_active ? 'Yes' : 'No',
          est_invoice: est.toFixed(2),
          est_monthly: perMonth.toFixed(2),
        };
      }),
    [recurring]
  );

  const closeStats = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    const thisMonth = invoices.filter((i) => monthKey(i.issue_date) === ym);
    const today = new Date().toISOString().slice(0, 10);
    return {
      drafts: invoices.filter((i) => i.status === 'draft').length,
      unpaidDue: invoices.filter(
        (i) => balanceOf(i) > 0.005 && i.due_date && i.due_date <= today && i.status !== 'cancelled'
      ).length,
      untaxed: thisMonth.filter((i) => num(i.tax_amount) === 0 && num(i.subtotal) > 0).length,
      monthCount: thisMonth.length,
    };
  }, [invoices]);

  const billingDefaults = useMemo(() => {
    const c = clients.find((x) => x.id === billingClientId);
    if (!c) return null;
    const terms = num(c.payment_terms) || 30;
    const due = new Date();
    due.setDate(due.getDate() + terms);
    return { terms, dueDate: due.toISOString().slice(0, 10) };
  }, [billingClientId, clients]);

  // ─── Loading / empty / error guards ──────────────────
  const heading = (
    <h2 className="text-text-primary" style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
      Export, Templates &amp; Reporting
    </h2>
  );

  if (!companyId) {
    return (
      <div>
        {heading}
        <div className="block-card text-text-muted" style={{ padding: 16, fontSize: 13 }}>
          Select a company to use export and reporting tools.
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div>
        {heading}
        <div className="block-card text-text-muted" style={{ padding: 16, fontSize: 13 }}>
          Loading invoice data…
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {heading}
        <div
          className="block-card"
          style={{ padding: 16, fontSize: 13, color: 'var(--color-accent-expense)' }}
        >
          {error}
          <div style={{ marginTop: 8 }}>
            <button className="block-btn" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Feature actions ─────────────────────────────────

  // 1. CSV export of filtered list
  const exportFiltered = () => {
    if (!exportRows.length) return flash('No invoices match the current filter.');
    downloadCSVBlob(exportRows, dateStampedFilename('invoices-filtered'), ALL_CSV_COLUMNS);
    flash(`Exported ${exportRows.length} invoice(s).`);
  };

  // 2. Selected-rows CSV export (columns from visibility settings)
  const exportSelected = () => {
    const rows = exportRows.filter((_, i) => selectedIds.has(filtered[i].id));
    if (!rows.length) return flash('No rows selected.');
    downloadCSVBlob(rows, dateStampedFilename('invoices-selected'), visibleCsvColumns);
    flash(`Exported ${rows.length} selected invoice(s).`);
  };

  // 3. Aging report CSV (client × bucket)
  const exportAging = () => {
    const byClient = new Map<string, Record<string, number>>();
    for (const inv of invoices) {
      const bal = balanceOf(inv);
      if (bal <= 0.005 || inv.status === 'paid' || inv.status === 'cancelled') continue;
      const bucket = agingBucket(daysOverdue(inv));
      const key = inv.client_name || '—';
      const rec = byClient.get(key) ?? {};
      rec[bucket] = (rec[bucket] ?? 0) + bal;
      byClient.set(key, rec);
    }
    if (!byClient.size) return flash('No outstanding balances to age.');
    const rows = Array.from(byClient.entries()).map(([client, rec]) => {
      const out: Record<string, string> = { client };
      let total = 0;
      for (const b of AGING_BUCKETS) {
        const v = rec[b] ?? 0;
        out[b] = v.toFixed(2);
        total += v;
      }
      out.total = total.toFixed(2);
      return out;
    });
    downloadCSVBlob(rows, dateStampedFilename('ar-aging'), [
      { key: 'client', label: 'Client' },
      ...AGING_BUCKETS.map((b) => ({ key: b, label: b })),
      { key: 'total', label: 'Total Outstanding' },
    ]);
    flash(`Aging report: ${rows.length} client(s).`);
  };

  // 4. Payments-received CSV
  const exportPayments = () => {
    if (!payments.length) return flash('No payments recorded.');
    const invById = new Map(invoices.map((i) => [i.id, i]));
    const rows = payments.map((p) => {
      const inv = invById.get(p.invoice_id);
      return {
        date: p.date,
        invoice_number: inv?.invoice_number ?? '—',
        client_name: inv?.client_name ?? '—',
        amount: num(p.amount).toFixed(2),
        payment_method: p.payment_method || '—',
        reference: p.reference || '',
      };
    });
    downloadCSVBlob(rows, dateStampedFilename('payments-received'), [
      { key: 'date', label: 'Date' },
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'client_name', label: 'Client' },
      { key: 'amount', label: 'Amount' },
      { key: 'payment_method', label: 'Method' },
      { key: 'reference', label: 'Reference' },
    ]);
    flash(`Exported ${rows.length} payment(s).`);
  };

  // 5. Client statement (CSV + printable)
  const buildStatementRows = (clientId: string) => {
    const cliInv = invoices
      .filter((i) => i.client_id === clientId)
      .slice()
      .sort((a, b) => (a.issue_date < b.issue_date ? -1 : 1));
    const cliPay = payments.filter((p) => cliInv.some((i) => i.id === p.invoice_id));
    type Ev = { date: string; type: 'Invoice' | 'Payment'; ref: string; charge: number; credit: number };
    const events: Ev[] = [];
    for (const i of cliInv)
      events.push({
        date: i.issue_date,
        type: 'Invoice',
        ref: i.invoice_number,
        charge: num(i.total),
        credit: 0,
      });
    for (const p of cliPay) {
      const inv = cliInv.find((i) => i.id === p.invoice_id);
      events.push({
        date: p.date,
        type: 'Payment',
        ref: inv?.invoice_number ?? '',
        charge: 0,
        credit: num(p.amount),
      });
    }
    events.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === 'Invoice' ? -1 : 1
    );
    let running = 0;
    return events.map((e) => {
      running += e.charge - e.credit;
      return {
        date: e.date,
        type: e.type,
        ref: e.ref,
        charge: e.charge ? e.charge.toFixed(2) : '',
        credit: e.credit ? e.credit.toFixed(2) : '',
        balance: running.toFixed(2),
      };
    });
  };

  const exportStatementCSV = () => {
    if (!statementClientId) return flash('Choose a client first.');
    const rows = buildStatementRows(statementClientId);
    if (!rows.length) return flash('No activity for that client.');
    const cli = clients.find((c) => c.id === statementClientId);
    downloadCSVBlob(rows, dateStampedFilename(`statement-${cli?.name ?? 'client'}`), [
      { key: 'date', label: 'Date' },
      { key: 'type', label: 'Type' },
      { key: 'ref', label: 'Reference' },
      { key: 'charge', label: 'Charge' },
      { key: 'credit', label: 'Credit' },
      { key: 'balance', label: 'Running Balance' },
    ]);
    flash('Statement CSV exported.');
  };

  const printStatement = () => {
    if (!statementClientId) return flash('Choose a client first.');
    const rows = buildStatementRows(statementClientId);
    const cli = clients.find((c) => c.id === statementClientId);
    const closing = rows.length ? rows[rows.length - 1].balance : '0.00';
    const body =
      `<h1>${esc(activeCompany?.name ?? 'Company')}</h1>` +
      `<h2>Statement of Account — ${esc(cli?.name ?? '')} (as of ${esc(formatDate(new Date().toISOString()))})</h2>` +
      `<table><thead><tr><th>Date</th><th>Type</th><th>Reference</th>` +
      `<th class="num">Charge</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>` +
      rows
        .map(
          (r) =>
            `<tr><td>${esc(r.date)}</td><td>${esc(r.type)}</td><td>${esc(r.ref)}</td>` +
            `<td class="num">${r.charge ? esc(formatCurrency(Number(r.charge))) : ''}</td>` +
            `<td class="num">${r.credit ? esc(formatCurrency(Number(r.credit))) : ''}</td>` +
            `<td class="num">${esc(formatCurrency(Number(r.balance)))}</td></tr>`
        )
        .join('') +
      `</tbody><tfoot><tr><td colspan="5">Balance Due</td>` +
      `<td class="num">${esc(formatCurrency(Number(closing)))}</td></tr></tfoot></table>`;
    printHTML('Statement of Account', body);
  };

  // 6. Revenue-by-month CSV (billed vs collected)
  const exportRevenueByMonth = () => {
    const map = new Map<string, { billed: number; collected: number }>();
    for (const inv of invoices) {
      const k = monthKey(inv.issue_date);
      const rec = map.get(k) ?? { billed: 0, collected: 0 };
      rec.billed += num(inv.total);
      map.set(k, rec);
    }
    const invById = new Map(invoices.map((i) => [i.id, i]));
    for (const p of payments) {
      const inv = invById.get(p.invoice_id);
      const k = monthKey(p.date || inv?.issue_date || '');
      const rec = map.get(k) ?? { billed: 0, collected: 0 };
      rec.collected += num(p.amount);
      map.set(k, rec);
    }
    if (!map.size) return flash('No revenue data.');
    const rows = Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, r]) => ({
        month,
        billed: r.billed.toFixed(2),
        collected: r.collected.toFixed(2),
      }));
    downloadCSVBlob(rows, dateStampedFilename('revenue-by-month'), [
      { key: 'month', label: 'Month' },
      { key: 'billed', label: 'Billed' },
      { key: 'collected', label: 'Collected' },
    ]);
    flash(`Revenue series: ${rows.length} month(s).`);
  };

  // 7. Revenue-by-client CSV
  const exportRevenueByClient = () => {
    const map = new Map<string, { billed: number; paid: number }>();
    for (const inv of invoices) {
      const rec = map.get(inv.client_name) ?? { billed: 0, paid: 0 };
      rec.billed += num(inv.total);
      rec.paid += num(inv.amount_paid);
      map.set(inv.client_name, rec);
    }
    if (!map.size) return flash('No invoices.');
    const rows = Array.from(map.entries())
      .sort((a, b) => b[1].billed - a[1].billed)
      .map(([client, r]) => ({
        client,
        billed: r.billed.toFixed(2),
        paid: r.paid.toFixed(2),
        outstanding: (r.billed - r.paid).toFixed(2),
      }));
    downloadCSVBlob(rows, dateStampedFilename('revenue-by-client'), [
      { key: 'client', label: 'Client' },
      { key: 'billed', label: 'Total Billed' },
      { key: 'paid', label: 'Total Paid' },
      { key: 'outstanding', label: 'Outstanding' },
    ]);
    flash(`Exported ${rows.length} client(s).`);
  };

  // 8. Tax summary (by quarter)
  const exportTaxSummary = () => {
    const map = new Map<string, { tax: number; taxable: number }>();
    for (const inv of invoices) {
      if (inv.status === 'cancelled') continue;
      const k = quarterOf(inv.issue_date);
      const rec = map.get(k) ?? { tax: 0, taxable: 0 };
      rec.tax += num(inv.tax_amount);
      rec.taxable += num(inv.subtotal) - num(inv.discount_amount);
      map.set(k, rec);
    }
    if (!map.size) return flash('No invoices to summarize.');
    const rows = Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([period, r]) => ({
        period,
        taxable: r.taxable.toFixed(2),
        tax: r.tax.toFixed(2),
      }));
    downloadCSVBlob(rows, dateStampedFilename('tax-summary'), [
      { key: 'period', label: 'Quarter' },
      { key: 'taxable', label: 'Taxable Sales' },
      { key: 'tax', label: 'Tax Collected' },
    ]);
    flash(`Tax summary: ${rows.length} period(s).`);
  };

  // 9. Printable invoice register
  const printRegister = () => {
    if (!filtered.length) return flash('Nothing to print.');
    const body =
      `<h1>${esc(activeCompany?.name ?? 'Company')}</h1>` +
      `<h2>Invoice Register (${filtered.length} invoices, ${esc(formatDate(new Date().toISOString()))})</h2>` +
      `<table><thead><tr><th>Invoice #</th><th>Client</th><th>Status</th><th>Issued</th><th>Due</th>` +
      `<th class="num">Total</th><th class="num">Balance</th></tr></thead><tbody>` +
      filtered
        .map(
          (i) =>
            `<tr><td>${esc(i.invoice_number)}</td><td>${esc(i.client_name)}</td><td>${esc(i.status)}</td>` +
            `<td>${esc(i.issue_date)}</td><td>${esc(i.due_date)}</td>` +
            `<td class="num">${esc(formatCurrency(num(i.total)))}</td>` +
            `<td class="num">${esc(formatCurrency(balanceOf(i)))}</td></tr>`
        )
        .join('') +
      `</tbody></table>`;
    printHTML('Invoice Register', body);
  };

  // 10. Saved CSV column presets
  const persistColumnPresets = (next: ColumnPreset[]) => {
    setColumnPresets(next);
    lsSet(LS_COLUMN_PRESETS, next);
  };
  const saveColumnPreset = () => {
    const name = window.prompt('Preset name?');
    if (!name) return;
    const next = [
      ...columnPresets.filter((p) => p.name !== name),
      { name, columns: activeColumns.slice() },
    ];
    persistColumnPresets(next);
    flash(`Saved preset "${name}".`);
  };
  const applyColumnPreset = (name: string) => {
    const p = columnPresets.find((x) => x.name === name);
    if (p) setActiveColumns(p.columns.slice());
  };

  // 11. Line-item detail export
  const exportLineItems = () => {
    if (!lineItems.length) return flash('No line items.');
    const rows = lineItems.map((li) => ({
      invoice_number: li.invoice_number,
      client_name: li.client_name,
      description: li.description,
      quantity: num(li.quantity).toString(),
      unit_price: num(li.unit_price).toFixed(2),
      amount: num(li.amount).toFixed(2),
      tax_rate: num(li.tax_rate).toString(),
    }));
    downloadCSVBlob(rows, dateStampedFilename('invoice-line-items'), [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'client_name', label: 'Client' },
      { key: 'description', label: 'Description' },
      { key: 'quantity', label: 'Qty' },
      { key: 'unit_price', label: 'Unit Price' },
      { key: 'amount', label: 'Amount' },
      { key: 'tax_rate', label: 'Tax %' },
    ]);
    flash(`Exported ${rows.length} line item(s).`);
  };

  // 12. Invoice templates library (save current selection's line items)
  const persistTemplates = (next: InvoiceTemplate[]) => {
    setTemplates(next);
    lsSet(LS_INVOICE_TEMPLATES, next);
  };
  const saveTemplateFromInvoice = () => {
    const first = Array.from(selectedIds)[0] ?? filtered[0]?.id;
    if (!first) return flash('Select an invoice to capture as a template.');
    const name = window.prompt('Template name?');
    if (!name) return;
    const src = invoices.find((i) => i.id === first);
    const lis = lineItems
      .filter((li) => li.invoice_id === first)
      .map((li) => ({
        description: li.description,
        quantity: num(li.quantity),
        unit_price: num(li.unit_price),
      }));
    const next = [
      ...templates.filter((t) => t.name !== name),
      { name, terms: src?.terms ?? '', lines: lis },
    ];
    persistTemplates(next);
    flash(`Saved template "${name}" with ${lis.length} line(s).`);
  };
  const deleteTemplate = (name: string) => {
    persistTemplates(templates.filter((t) => t.name !== name));
  };
  const exportTemplate = (t: InvoiceTemplate) => {
    downloadJSONBlob(t, dateStampedFilename(`template-${t.name}`, 'json'));
  };

  // 13. Catalog-driven quick template
  const buildCatalogTemplate = () => {
    if (!catalog.length) return flash('No catalog items found.');
    const lines = catalog.slice(0, 25).map((c) => ({
      description: c.name ?? c.description ?? 'Item',
      quantity: 1,
      unit_price: num(c.unit_price ?? c.price ?? c.rate ?? 0),
    }));
    const name = `Catalog Starter (${lines.length})`;
    const next = [...templates.filter((t) => t.name !== name), { name, terms: '', lines }];
    persistTemplates(next);
    flash(`Built "${name}" from catalog.`);
  };

  // 14. Default terms & notes presets
  const persistTermsPresets = (next: string[]) => {
    setTermsPresets(next);
    lsSet(LS_TERMS_PRESETS, next);
  };
  const addTermsPreset = () => {
    const t = window.prompt('Terms / notes blurb to save?');
    if (!t || !t.trim()) return;
    persistTermsPresets([...termsPresets, t.trim()]);
    flash('Saved terms preset.');
  };
  const copyTermsPreset = async (t: string) => {
    flash((await copyToClipboard(t)) ? 'Terms copied.' : 'Copy failed.');
  };

  // 16. Bulk-send summary (mark drafts as sent + manifest)
  const bulkMarkSent = async () => {
    const ids = Array.from(selectedIds);
    const targets = filtered.filter((i) => ids.includes(i.id) && i.status === 'draft');
    if (!targets.length) return flash('Select draft invoices to mark as sent.');
    if (!window.confirm(`Mark ${targets.length} draft invoice(s) as sent?`)) return;
    try {
      await api.batchUpdate(
        'invoices',
        targets.map((t) => t.id),
        { status: 'sent' }
      );
    } catch (e) {
      return flash(e instanceof Error ? e.message : 'Bulk update failed.');
    }
    const manifest = targets.map((t) => ({
      invoice_number: t.invoice_number,
      client_name: t.client_name,
      amount: num(t.total).toFixed(2),
      sent_date: new Date().toISOString().slice(0, 10),
    }));
    downloadCSVBlob(manifest, dateStampedFilename('bulk-send-manifest'), [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'client_name', label: 'Client' },
      { key: 'amount', label: 'Amount' },
      { key: 'sent_date', label: 'Sent Date' },
    ]);
    setSelectedIds(new Set());
    setReloadKey((k) => k + 1);
    flash(`Marked ${targets.length} sent; manifest downloaded.`);
  };

  // 17. Overdue follow-up worklist
  const exportOverdueWorklist = () => {
    const cliById = new Map(clients.map((c) => [c.id, c]));
    const rows = invoices
      .filter((i) => daysOverdue(i) > 0 && balanceOf(i) > 0.005)
      .sort((a, b) => daysOverdue(b) - daysOverdue(a))
      .map((i) => {
        const c = cliById.get(i.client_id);
        return {
          invoice_number: i.invoice_number,
          client_name: i.client_name,
          email: c?.email || '',
          phone: c?.phone || '',
          balance: balanceOf(i).toFixed(2),
          days_overdue: String(daysOverdue(i)),
          due_date: i.due_date,
        };
      });
    if (!rows.length) return flash('No overdue invoices.');
    downloadCSVBlob(rows, dateStampedFilename('overdue-worklist'), [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'client_name', label: 'Client' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'balance', label: 'Balance' },
      { key: 'days_overdue', label: 'Days Overdue' },
      { key: 'due_date', label: 'Due Date' },
    ]);
    flash(`Worklist: ${rows.length} overdue.`);
  };

  // 19. Email-draft copy generator
  const generateEmailDraft = async () => {
    const inv = invoices.find((i) => i.id === emailInvoiceId) ?? filtered[0];
    if (!inv) return flash('No invoice available.');
    const body =
      `Subject: Payment reminder — Invoice ${inv.invoice_number}\n\n` +
      `Dear ${inv.client_name},\n\n` +
      `This is a friendly reminder that invoice ${inv.invoice_number} for ` +
      `${formatCurrency(balanceOf(inv))} is ` +
      (daysOverdue(inv) > 0
        ? `${daysOverdue(inv)} day(s) overdue`
        : `due on ${formatDate(inv.due_date)}`) +
      `.\n\nWe'd appreciate your prompt payment. Please let us know if you have any questions.\n\n` +
      `Thank you,\n${activeCompany?.name ?? ''}`;
    flash((await copyToClipboard(body)) ? 'Reminder email copied to clipboard.' : 'Copy failed.');
  };

  // 20. QuickBooks-style flat export
  const exportQuickBooks = () => {
    if (!invoices.length) return flash('No invoices.');
    const rows = invoices.map((i) => ({
      date: i.issue_date,
      num: i.invoice_number,
      customer: i.client_name,
      amount: num(i.total).toFixed(2),
      memo: (i.notes || '').replace(/\s+/g, ' ').slice(0, 120),
    }));
    downloadCSVBlob(rows, dateStampedFilename('quickbooks-import'), [
      { key: 'date', label: 'Date' },
      { key: 'num', label: 'Num' },
      { key: 'customer', label: 'Customer' },
      { key: 'amount', label: 'Amount' },
      { key: 'memo', label: 'Memo' },
    ]);
    flash(`QB export: ${rows.length} rows.`);
  };

  // 21. JSON backup of filtered invoices + line items
  const exportJSONBackup = () => {
    if (!filtered.length) return flash('Nothing to back up.');
    const idSet = new Set(filtered.map((i) => i.id));
    const payload = {
      exported_at: new Date().toISOString(),
      company: activeCompany?.name ?? '',
      invoices: filtered,
      line_items: lineItems.filter((li) => idSet.has(li.invoice_id)),
    };
    downloadJSONBlob(payload, dateStampedFilename('invoices-backup', 'json'));
    flash(`Backed up ${filtered.length} invoice(s) as JSON.`);
  };

  // 22. Per-invoice statement print (with line items)
  const printInvoiceStatement = async () => {
    const id = printInvoiceId || filtered[0]?.id;
    const inv = invoices.find((i) => i.id === id);
    if (!inv) return flash('Choose an invoice.');
    let lis: LineItemRow[] = lineItems.filter((li) => li.invoice_id === id);
    if (!lis.length) {
      try {
        const fetched = (await api.query('invoice_line_items', { invoice_id: id })) as LineItemRow[];
        if (Array.isArray(fetched)) lis = fetched;
      } catch {
        /* fall through with empty */
      }
    }
    const body =
      `<h1>${esc(activeCompany?.name ?? 'Company')}</h1>` +
      `<h2>Invoice ${esc(inv.invoice_number)} — ${esc(inv.client_name)} (${esc(inv.status)})</h2>` +
      `<table><thead><tr><th>Description</th><th class="num">Qty</th>` +
      `<th class="num">Unit</th><th class="num">Amount</th></tr></thead><tbody>` +
      lis
        .map(
          (li) =>
            `<tr><td>${esc(li.description)}</td><td class="num">${esc(num(li.quantity))}</td>` +
            `<td class="num">${esc(formatCurrency(num(li.unit_price)))}</td>` +
            `<td class="num">${esc(formatCurrency(num(li.amount)))}</td></tr>`
        )
        .join('') +
      `</tbody><tfoot>` +
      `<tr><td colspan="3">Subtotal</td><td class="num">${esc(formatCurrency(num(inv.subtotal)))}</td></tr>` +
      `<tr><td colspan="3">Tax</td><td class="num">${esc(formatCurrency(num(inv.tax_amount)))}</td></tr>` +
      `<tr><td colspan="3">Total</td><td class="num">${esc(formatCurrency(num(inv.total)))}</td></tr>` +
      `<tr><td colspan="3">Balance Due</td><td class="num">${esc(formatCurrency(balanceOf(inv)))}</td></tr>` +
      `</tfoot></table>`;
    printHTML(`Invoice ${inv.invoice_number}`, body);
  };

  // 23. Recurring schedule report
  const exportRecurring = () => {
    if (!recurringRows.length) return flash('No recurring invoice templates.');
    downloadCSVBlob(recurringRows, dateStampedFilename('recurring-schedule'), [
      { key: 'name', label: 'Template' },
      { key: 'frequency', label: 'Frequency' },
      { key: 'next_date', label: 'Next Date' },
      { key: 'active', label: 'Active' },
      { key: 'est_invoice', label: 'Est. Per Invoice' },
      { key: 'est_monthly', label: 'Est. Monthly' },
    ]);
    flash(`Recurring report: ${recurringRows.length} template(s).`);
  };

  // 24. Write-off / bad-debt report
  const exportWriteOffs = () => {
    const rows = invoices
      .filter((i) => i.status === 'cancelled')
      .map((i) => ({
        invoice_number: i.invoice_number,
        client_name: i.client_name,
        issue_date: i.issue_date,
        original_total: num(i.total).toFixed(2),
        amount_paid: num(i.amount_paid).toFixed(2),
        written_off: balanceOf(i).toFixed(2),
      }));
    if (!rows.length) return flash('No cancelled / written-off invoices.');
    downloadCSVBlob(rows, dateStampedFilename('bad-debt'), [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'client_name', label: 'Client' },
      { key: 'issue_date', label: 'Issue Date' },
      { key: 'original_total', label: 'Original Total' },
      { key: 'amount_paid', label: 'Amount Paid' },
      { key: 'written_off', label: 'Written Off' },
    ]);
    flash(`Bad-debt report: ${rows.length} invoice(s).`);
  };

  // 25. Custom-field export mapping
  const persistCustomLabels = (next: CustomFieldLabels) => {
    setCustomLabels(next);
    lsSet(LS_CUSTOM_LABELS, next);
  };
  const exportWithCustomFields = () => {
    if (!invoices.length) return flash('No invoices.');
    const keys: Array<keyof CustomFieldLabels> = [
      'po_number',
      'job_reference',
      'custom_field_1',
      'custom_field_2',
      'custom_field_3',
      'custom_field_4',
    ];
    const rows = invoices.map((inv) => {
      const cf = parseCustomFields(inv.custom_fields);
      const base: Record<string, string> = {
        invoice_number: inv.invoice_number,
        client_name: inv.client_name,
        total: num(inv.total).toFixed(2),
      };
      for (const k of keys) base[k] = String(cf[k] ?? '');
      return base;
    });
    downloadCSVBlob(rows, dateStampedFilename('invoices-custom-fields'), [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'client_name', label: 'Client' },
      { key: 'total', label: 'Total' },
      ...keys.map((k) => ({ key: k, label: customLabels[k] })),
    ]);
    flash(`Exported with ${keys.length} custom columns.`);
  };

  // ─── Render ──────────────────────────────────────────
  return (
    <div>
      {heading}

      {status && (
        <div
          className="block-card"
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--color-accent-income)',
          }}
        >
          {status}
        </div>
      )}

      {/* Shared filter / selection — drives features 1, 2, 9, 21 */}
      <Card
        title="Filter & Selection"
        desc={`Search and filter the live list (${invoices.length} invoices). Filtered set feeds the exports below.`}
      >
        <Row>
          <input
            className="block-input"
            placeholder="Search number or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 200px', minWidth: 180 }}
          />
          <select
            className="block-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Stat label="Matched" value={String(filtered.length)} tone="blue" />
          <Stat label="Selected" value={String(selectedIds.size)} tone="warning" />
        </Row>
        <div
          style={{
            maxHeight: 160,
            overflow: 'auto',
            marginTop: 10,
            border: '1px solid var(--structure)',
            borderRadius: 'var(--app-radius)',
          }}
        >
          <table className="block-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(inv.id)}
                      onChange={() => toggleSelect(inv.id)}
                    />
                  </td>
                  <td>{inv.invoice_number}</td>
                  <td>{inv.client_name}</td>
                  <td>{inv.status}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(balanceOf(inv))}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} className="text-text-muted" style={{ textAlign: 'center' }}>
                    No invoices match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 1, 2 */}
      <Card title="CSV Exports — Filtered & Selected" desc="Export the filtered list or only checked rows.">
        <Row>
          <button className="block-btn block-btn-primary" onClick={exportFiltered}>
            Export Filtered ({filtered.length})
          </button>
          <button className="block-btn" onClick={exportSelected}>
            Export Selected ({selectedIds.size})
          </button>
        </Row>
      </Card>

      {/* 10 + column visibility (used by feature 2) */}
      <Card title="CSV Column Presets" desc="Choose which columns the Selected export includes; save named presets.">
        <Row>
          {ALL_CSV_COLUMNS.map((c) => (
            <label key={c.key} className="text-text-secondary" style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={activeColumns.includes(c.key)}
                onChange={(e) =>
                  setActiveColumns((prev) =>
                    e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key)
                  )
                }
              />{' '}
              {c.label}
            </label>
          ))}
        </Row>
        <Row>
          <button className="block-btn" onClick={saveColumnPreset}>
            Save Preset
          </button>
          <select
            className="block-select"
            value=""
            onChange={(e) => e.target.value && applyColumnPreset(e.target.value)}
          >
            <option value="">Apply preset…</option>
            {columnPresets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </Row>
      </Card>

      {/* 3, 4, 6, 7, 8 */}
      <Card title="Financial Reports (CSV)" desc="Aging, payments, revenue and tax summaries from live data.">
        <Row>
          <button className="block-btn" onClick={exportAging}>
            A/R Aging Report
          </button>
          <button className="block-btn" onClick={exportPayments}>
            Payments Received
          </button>
          <button className="block-btn" onClick={exportRevenueByMonth}>
            Revenue by Month
          </button>
          <button className="block-btn" onClick={exportRevenueByClient}>
            Revenue by Client
          </button>
          <button className="block-btn" onClick={exportTaxSummary}>
            Tax Summary (Quarterly)
          </button>
        </Row>
      </Card>

      {/* 5 */}
      <Card title="Client Statement Generator" desc="Running-balance statement (invoices + payments) for one client.">
        <Row>
          <select
            className="block-select"
            value={statementClientId}
            onChange={(e) => setStatementClientId(e.target.value)}
            style={{ flex: '1 1 200px' }}
          >
            <option value="">Choose client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="block-btn" onClick={exportStatementCSV}>
            Statement CSV
          </button>
          <button className="block-btn" onClick={printStatement}>
            Print Statement
          </button>
        </Row>
      </Card>

      {/* 9, 22 — printable views */}
      <Card title="Printable Views (PDF via print)" desc="Open a print-ready window for the OS print/save-PDF dialog.">
        <Row>
          <button className="block-btn" onClick={printRegister}>
            Invoice Register ({filtered.length})
          </button>
          <select
            className="block-select"
            value={printInvoiceId}
            onChange={(e) => setPrintInvoiceId(e.target.value)}
          >
            <option value="">First filtered invoice</option>
            {filtered.slice(0, 100).map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoice_number} — {i.client_name}
              </option>
            ))}
          </select>
          <button className="block-btn" onClick={printInvoiceStatement}>
            Print Invoice (w/ items)
          </button>
        </Row>
      </Card>

      {/* 11, 20, 21, 24 */}
      <Card title="Detail & Accounting Exports" desc="Line items, QuickBooks-style import, JSON backup, bad-debt.">
        <Row>
          <button className="block-btn" onClick={exportLineItems}>
            Line Items ({lineItems.length})
          </button>
          <button className="block-btn" onClick={exportQuickBooks}>
            QuickBooks Flat CSV
          </button>
          <button className="block-btn" onClick={exportJSONBackup}>
            JSON Backup (filtered)
          </button>
          <button className="block-btn" onClick={exportWriteOffs}>
            Write-off / Bad-Debt
          </button>
        </Row>
      </Card>

      {/* 25 */}
      <Card title="Custom-Field Export Mapping" desc="Label and export PO / job ref / custom fields stored in invoice custom_fields.">
        <Row>
          {(
            [
              'po_number',
              'job_reference',
              'custom_field_1',
              'custom_field_2',
              'custom_field_3',
              'custom_field_4',
            ] as Array<keyof CustomFieldLabels>
          ).map((k) => (
            <input
              key={k}
              className="block-input"
              value={customLabels[k]}
              onChange={(e) => persistCustomLabels({ ...customLabels, [k]: e.target.value })}
              style={{ width: 130 }}
            />
          ))}
        </Row>
        <Row>
          <button className="block-btn block-btn-primary" onClick={exportWithCustomFields}>
            Export With Custom Columns
          </button>
        </Row>
      </Card>

      {/* 12, 13 */}
      <Card title="Invoice Template Library" desc="Capture line items + terms as reusable templates (saved locally).">
        <Row>
          <button className="block-btn" onClick={saveTemplateFromInvoice}>
            Save From Selected Invoice
          </button>
          <button className="block-btn" onClick={buildCatalogTemplate}>
            Build From Catalog ({catalog.length})
          </button>
        </Row>
        {templates.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {templates.map((t) => (
              <div
                key={t.name}
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}
              >
                <span className="text-text-secondary" style={{ fontSize: 12, flex: 1 }}>
                  {t.name} — {t.lines.length} line(s)
                </span>
                <button className="block-btn" onClick={() => exportTemplate(t)}>
                  Export
                </button>
                <button className="block-btn" onClick={() => deleteTemplate(t.name)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 14 */}
      <Card title="Terms & Notes Presets" desc="Reusable terms blurbs you can copy into an invoice's terms field.">
        <Row>
          <button className="block-btn" onClick={addTermsPreset}>
            Add Preset
          </button>
        </Row>
        {termsPresets.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {termsPresets.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <span className="text-text-secondary" style={{ fontSize: 12, flex: 1 }}>
                  {t.slice(0, 80)}
                </span>
                <button className="block-btn" onClick={() => copyTermsPreset(t)}>
                  Copy
                </button>
                <button
                  className="block-btn"
                  onClick={() => persistTermsPresets(termsPresets.filter((_, j) => j !== i))}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 15 */}
      <Card title="Per-Client Billing Defaults" desc="Preview the due date a client's payment terms would set on a new invoice.">
        <Row>
          <select
            className="block-select"
            value={billingClientId}
            onChange={(e) => setBillingClientId(e.target.value)}
            style={{ flex: '1 1 200px' }}
          >
            <option value="">Choose client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {billingDefaults && (
            <>
              <Stat label="Net Terms" value={`${billingDefaults.terms}d`} tone="blue" />
              <Stat label="Due Date" value={formatDate(billingDefaults.dueDate)} tone="warning" />
            </>
          )}
        </Row>
      </Card>

      {/* 16, 17 */}
      <Card title="Bulk Send & Collections" desc="Mark selected drafts sent (with manifest) and export an overdue call-list.">
        <Row>
          <button className="block-btn block-btn-primary" onClick={bulkMarkSent}>
            Mark Selected Sent + Manifest
          </button>
          <button className="block-btn" onClick={exportOverdueWorklist}>
            Overdue Follow-up Worklist
          </button>
        </Row>
      </Card>

      {/* 18 */}
      <Card title="Monthly Close Checklist" desc="Read-only rollups to clean up before closing the period.">
        <Row>
          <Stat
            label="Unsent Drafts"
            value={String(closeStats.drafts)}
            tone={closeStats.drafts ? 'warning' : 'income'}
          />
          <Stat
            label="Unpaid & Due"
            value={String(closeStats.unpaidDue)}
            tone={closeStats.unpaidDue ? 'expense' : 'income'}
          />
          <Stat label="Untaxed (this mo.)" value={String(closeStats.untaxed)} tone="blue" />
          <Stat label="Invoiced (this mo.)" value={String(closeStats.monthCount)} />
        </Row>
      </Card>

      {/* 19 */}
      <Card title="Reminder Email Draft" desc="Generate a templated reminder body and copy it to the clipboard.">
        <Row>
          <select
            className="block-select"
            value={emailInvoiceId}
            onChange={(e) => setEmailInvoiceId(e.target.value)}
            style={{ flex: '1 1 200px' }}
          >
            <option value="">First filtered invoice</option>
            {filtered.slice(0, 100).map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoice_number} — {i.client_name}
              </option>
            ))}
          </select>
          <button className="block-btn" onClick={generateEmailDraft}>
            Copy Email Draft
          </button>
        </Row>
      </Card>

      {/* 23 */}
      <Card
        title="Recurring Schedule Report"
        desc={`Upcoming recurring billings (${recurring.length} templates) with est. monthly value.`}
      >
        <Row>
          <button className="block-btn" onClick={exportRecurring}>
            Export Recurring Schedule
          </button>
          {recurringRows.slice(0, 1).map((r, i) => (
            <Stat
              key={i}
              label="Next"
              value={`${r.name.slice(0, 14)} · ${formatDate(r.next_date)}`}
              tone="blue"
            />
          ))}
        </Row>
      </Card>
    </div>
  );
};

export default InvoicesUpgradesPart4;
