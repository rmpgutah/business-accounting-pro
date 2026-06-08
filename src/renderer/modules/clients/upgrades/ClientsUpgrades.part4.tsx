import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../lib/api';
import { formatCurrency, formatDate } from '../../../lib/format';
import { useCompanyStore } from '../../../stores/companyStore';

// ─────────────────────────────────────────────────────────────────────────────
// Clients Upgrades — Part 4: "Export, Templates & Reporting"
//
// A self-contained vertical stack of small, working features. Every card loads
// REAL data through the api wrapper (rawQuery / query / listClientContacts),
// scoped to the active company where the underlying table has company_id, and
// either computes a real stat, exports a CSV/JSON Blob, prints a sheet, copies
// to the clipboard, or persists a setting to localStorage. No dead buttons,
// no hard-coded numbers.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared row shape pulled once and reused across many cards ────────────────
interface ClientAgg {
  id: string;
  name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  tax_id: string;
  payment_terms: number;
  status: string;
  tags: string;
  custom_fields: string;
  created_at: string;
  // computed aggregates
  invoice_count: number;
  revenue: number;       // lifetime invoiced (non-cancelled)
  collected: number;     // amount_paid
  outstanding: number;   // revenue - collected
  last_invoice_date: string | null;
  first_invoice_date: string | null;
  last_payment_date: string | null;
  billable_expense: number;
}

interface ContactRow {
  client_id: string;
  client_name: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: number;
}

// ── CSV helpers ──────────────────────────────────────────────────────────────
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCSV(headers: string[], rows: Array<Array<unknown>>): string {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  return head + '\n' + body;
}

function downloadCSVBlob(filename: string, csv: string): void {
  downloadBlob(filename, csv, 'text/csv;charset=utf-8;');
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Build a printable document by writing into a Blob URL loaded in a new tab.
// Avoids document.write entirely (no live-DOM string injection).
function printHTML(title: string, bodyHtml: string): void {
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>` +
    `*{box-sizing:border-box}` +
    `body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:32px;font-size:13px;line-height:1.5}` +
    `h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px}` +
    `table{border-collapse:collapse;width:100%;margin-top:8px}` +
    `th,td{border:1px solid #d0d0d0;padding:6px 8px;text-align:left}` +
    `th{background:#f3f3f3}` +
    `.muted{color:#666;font-size:12px}.right{text-align:right}` +
    `.note-cell{height:28px}` +
    `@media print{button{display:none}}` +
    `</style></head><body>${bodyHtml}` +
    `<p class="muted" style="margin-top:24px">Generated ${escapeHtml(
      new Date().toLocaleString()
    )}</p>` +
    `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>` +
    `</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeParseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  } catch {
    /* ignore */
  }
  return [];
}

function parseCustomField(raw: string, key: string): string {
  try {
    const v = JSON.parse(raw || '{}');
    if (v && typeof v === 'object' && v[key] != null) return String(v[key]);
  } catch {
    /* ignore */
  }
  return '';
}

function fmtAddress(c: ClientAgg): string {
  const cityLine = [c.city, c.state].filter(Boolean).join(', ');
  return [
    c.address_line1,
    c.address_line2,
    [cityLine, c.zip].filter(Boolean).join(' '),
    c.country && c.country !== 'US' ? c.country : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
const ClientsUpgradesPart4: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id;

  const [clients, setClients] = useState<ClientAgg[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!companyId) {
      setClients([]);
      setContacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        // One aggregate query joining invoices + payments + billable expenses.
        const rows = (await api.rawQuery(
          `SELECT c.id, c.name, c.email, c.phone,
                  c.address_line1, c.address_line2, c.city, c.state, c.zip, c.country,
                  c.tax_id, c.payment_terms, c.status, c.tags, c.custom_fields, c.created_at,
                  COUNT(DISTINCT i.id) AS invoice_count,
                  COALESCE(SUM(CASE WHEN i.status != 'cancelled' THEN i.total ELSE 0 END), 0) AS revenue,
                  COALESCE(SUM(CASE WHEN i.status != 'cancelled' THEN i.amount_paid ELSE 0 END), 0) AS collected,
                  MAX(i.issue_date) AS last_invoice_date,
                  MIN(i.issue_date) AS first_invoice_date,
                  (SELECT MAX(p.date) FROM payments p
                     JOIN invoices pi ON pi.id = p.invoice_id
                     WHERE pi.client_id = c.id AND p.company_id = ?) AS last_payment_date,
                  (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
                     WHERE e.client_id = c.id AND e.company_id = ? AND e.is_billable = 1) AS billable_expense
           FROM clients c
           LEFT JOIN invoices i ON i.client_id = c.id AND i.company_id = ?
           WHERE c.company_id = ?
           GROUP BY c.id
           ORDER BY revenue DESC`,
          [companyId, companyId, companyId, companyId]
        )) as any[];

        const mapped: ClientAgg[] = (Array.isArray(rows) ? rows : []).map((r) => {
          const revenue = Number(r.revenue ?? 0);
          const collected = Number(r.collected ?? 0);
          return {
            id: String(r.id),
            name: String(r.name ?? ''),
            email: String(r.email ?? ''),
            phone: String(r.phone ?? ''),
            address_line1: String(r.address_line1 ?? ''),
            address_line2: String(r.address_line2 ?? ''),
            city: String(r.city ?? ''),
            state: String(r.state ?? ''),
            zip: String(r.zip ?? ''),
            country: String(r.country ?? ''),
            tax_id: String(r.tax_id ?? ''),
            payment_terms: Number(r.payment_terms ?? 0),
            status: String(r.status ?? ''),
            tags: String(r.tags ?? '[]'),
            custom_fields: String(r.custom_fields ?? '{}'),
            created_at: String(r.created_at ?? ''),
            invoice_count: Number(r.invoice_count ?? 0),
            revenue,
            collected,
            outstanding: revenue - collected,
            last_invoice_date: r.last_invoice_date ?? null,
            first_invoice_date: r.first_invoice_date ?? null,
            last_payment_date: r.last_payment_date ?? null,
            billable_expense: Number(r.billable_expense ?? 0),
          };
        });

        // Flatten contacts across all clients.
        const contactRows: ContactRow[] = [];
        await Promise.all(
          mapped.map(async (c) => {
            try {
              const list = (await api.listClientContacts(c.id)) as any[];
              if (Array.isArray(list)) {
                for (const ct of list) {
                  contactRows.push({
                    client_id: c.id,
                    client_name: c.name,
                    name: String(ct.name ?? ''),
                    title: String(ct.title ?? ''),
                    email: String(ct.email ?? ''),
                    phone: String(ct.phone ?? ''),
                    is_primary: Number(ct.is_primary ?? 0),
                  });
                }
              }
            } catch {
              /* per-client contact failure is non-fatal */
            }
          })
        );

        if (!cancelled) {
          setClients(mapped);
          setContacts(contactRows);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load client data');
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (!companyId) {
    return (
      <div className="block-card">
        <p className="text-text-muted text-sm">Select a company to view reporting tools.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="block-card">
        <p className="text-text-secondary text-sm">Loading client reporting data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="block-card">
        <p className="text-sm" style={{ color: 'var(--color-accent-expense)' }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text-primary">Export, Templates &amp; Reporting</h2>

      <FilteredListExport clients={clients} />
      <ClientStatement clients={clients} companyId={companyId} />
      <ArAgingReport companyId={companyId} />
      <ContactsExport contacts={contacts} />
      <RevenueSummaryExport clients={clients} />
      <TopNReport clients={clients} />
      <EmailTemplates clients={clients} />
      <ReminderDraft clients={clients} companyId={companyId} />
      <MailingLabels clients={clients} />
      <NewClientsReport clients={clients} />
      <DormantReport clients={clients} />
      <ProfitabilityRanking clients={clients} />
      <IndustryRollup clients={clients} />
      <PerClientInvoiceCSV clients={clients} companyId={companyId} />
      <PerClientPaymentCSV clients={clients} companyId={companyId} />
      <CollectionsWorksheet clients={clients} />
      <ColumnPicker clients={clients} />
      <JsonBackup clients={clients} />
      <WelcomeLetter clients={clients} />
      <QuarterlyActivity companyId={companyId} />
      <DirectoryPrint clients={clients} contacts={contacts} />
      <TagCloud clients={clients} />
      <SavedReports />
      <CompletenessScorecard clients={clients} />
    </div>
  );
};

export default ClientsUpgradesPart4;

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ─────────────────────────────────────────────────────────────────────────────
const Card: React.FC<{ title: string; desc?: string; children: React.ReactNode }> = ({
  title,
  desc,
  children,
}) => (
  <div className="block-card">
    <h3 className="text-sm font-semibold text-text-primary mb-1">{title}</h3>
    {desc && <p className="text-xs text-text-muted mb-3">{desc}</p>}
    {children}
  </div>
);

function useFlash(): [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };
  return [msg, flash];
}

const Flash: React.FC<{ msg: string | null }> = ({ msg }) =>
  msg ? (
    <span className="text-xs ml-2" style={{ color: 'var(--color-accent-income)' }}>
      {msg}
    </span>
  ) : null;

// ── 1. Filtered-list CSV export ──────────────────────────────────────────────
const ALL_COLUMNS: Array<{ key: keyof ClientAgg; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'status', label: 'Status' },
  { key: 'invoice_count', label: 'Invoices' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'outstanding', label: 'Balance' },
];

const FilteredListExport: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<'revenue' | 'outstanding' | 'name'>('revenue');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = clients.filter(
      (c) =>
        (status === 'all' || c.status === status) &&
        (!q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
    );
    r = [...r].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      return Number(b[sort]) - Number(a[sort]);
    });
    return r;
  }, [clients, search, status, sort]);

  const exportCsv = () => {
    const headers = ALL_COLUMNS.map((c) => c.label);
    const data = rows.map((r) =>
      ALL_COLUMNS.map((c) => {
        const v = r[c.key];
        if (c.key === 'revenue' || c.key === 'outstanding') return Number(v).toFixed(2);
        return v;
      })
    );
    downloadCSVBlob(`clients_filtered_${todayISO()}.csv`, toCSV(headers, data));
  };

  return (
    <Card
      title="1. Filtered list CSV export"
      desc="Search, filter and sort the client list, then export exactly what you see."
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          className="block-input flex-1 min-w-[160px]"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="block-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="prospect">Prospect</option>
        </select>
        <select className="block-select" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="revenue">Sort: Revenue</option>
          <option value="outstanding">Sort: Balance</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">
          {rows.length} of {clients.length} clients match
        </span>
        <button className="block-btn block-btn-primary" onClick={exportCsv} disabled={!rows.length}>
          Export {rows.length} to CSV
        </button>
      </div>
    </Card>
  );
};

// ── 2. Client statement (print) ──────────────────────────────────────────────
const ClientStatement: React.FC<{ clients: ClientAgg[]; companyId: string }> = ({
  clients,
  companyId,
}) => {
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    setBusy(true);
    try {
      const tx = (await api.rawQuery(
        `SELECT issue_date AS date, 'Invoice ' || invoice_number AS memo, total AS charge, 0 AS payment
           FROM invoices WHERE client_id = ? AND company_id = ? AND status != 'cancelled'
         UNION ALL
         SELECT p.date AS date, 'Payment ' || COALESCE(p.reference,'') AS memo, 0 AS charge, p.amount AS payment
           FROM payments p JOIN invoices i ON i.id = p.invoice_id
           WHERE i.client_id = ? AND p.company_id = ?
         ORDER BY date`,
        [clientId, companyId, clientId, companyId]
      )) as any[];

      let running = 0;
      const lines = (Array.isArray(tx) ? tx : [])
        .map((t) => {
          const charge = Number(t.charge ?? 0);
          const payment = Number(t.payment ?? 0);
          running += charge - payment;
          return `<tr><td>${escapeHtml(formatDate(t.date))}</td><td>${escapeHtml(
            t.memo
          )}</td><td class="right">${charge ? formatCurrency(charge) : ''}</td><td class="right">${
            payment ? formatCurrency(payment) : ''
          }</td><td class="right">${formatCurrency(running)}</td></tr>`;
        })
        .join('');

      printHTML(
        `Statement — ${client.name}`,
        `<h1>Statement of Account</h1><p class="muted">${escapeHtml(client.name)}</p>` +
          `<table><thead><tr><th>Date</th><th>Description</th><th class="right">Charge</th>` +
          `<th class="right">Payment</th><th class="right">Balance</th></tr></thead><tbody>${
            lines || '<tr><td colspan="5">No activity</td></tr>'
          }</tbody></table>` +
          `<h2>Balance due: ${formatCurrency(running)}</h2>`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="2. Client statement (printable)"
      desc="Printable statement of all invoices and payments with a running balance."
    >
      <div className="flex flex-wrap gap-2">
        <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
        <button
          className="block-btn block-btn-primary"
          onClick={run}
          disabled={!clientId || busy}
        >
          {busy ? 'Building…' : 'Print statement'}
        </button>
      </div>
    </Card>
  );
};

// ── 3. AR aging report export ────────────────────────────────────────────────
const ArAgingReport: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [matrix, setMatrix] = useState<
    Array<{ name: string; b0: number; b30: number; b60: number; b90: number; total: number }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  const build = async () => {
    const rows = (await api.rawQuery(
      `SELECT c.name AS name,
              CAST(julianday('now') - julianday(i.due_date) AS INTEGER) AS age,
              (i.total - i.amount_paid) AS bal
         FROM invoices i JOIN clients c ON c.id = i.client_id
         WHERE i.company_id = ? AND i.status IN ('sent','overdue','partial')
           AND (i.total - i.amount_paid) > 0`,
      [companyId]
    )) as any[];

    const map = new Map<
      string,
      { name: string; b0: number; b30: number; b60: number; b90: number; total: number }
    >();
    for (const r of Array.isArray(rows) ? rows : []) {
      const name = String(r.name ?? '');
      const age = Number(r.age ?? 0);
      const bal = Number(r.bal ?? 0);
      const e = map.get(name) ?? { name, b0: 0, b30: 0, b60: 0, b90: 0, total: 0 };
      if (age <= 30) e.b0 += bal;
      else if (age <= 60) e.b30 += bal;
      else if (age <= 90) e.b60 += bal;
      else e.b90 += bal;
      e.total += bal;
      map.set(name, e);
    }
    const arr = Array.from(map.values()).sort((a, b) => b.total - a.total);
    setMatrix(arr);
    setLoaded(true);
  };

  const exportCsv = () => {
    const headers = ['Client', '0-30', '31-60', '61-90', '90+', 'Total'];
    const data = matrix.map((m) => [
      m.name,
      m.b0.toFixed(2),
      m.b30.toFixed(2),
      m.b60.toFixed(2),
      m.b90.toFixed(2),
      m.total.toFixed(2),
    ]);
    downloadCSVBlob(`ar_aging_${todayISO()}.csv`, toCSV(headers, data));
  };

  const totals = useMemo(
    () =>
      matrix.reduce(
        (acc, m) => {
          acc.b0 += m.b0;
          acc.b30 += m.b30;
          acc.b60 += m.b60;
          acc.b90 += m.b90;
          acc.total += m.total;
          return acc;
        },
        { b0: 0, b30: 0, b60: 0, b90: 0, total: 0 }
      ),
    [matrix]
  );

  return (
    <Card
      title="3. AR aging report"
      desc="0-30 / 31-60 / 61-90 / 90+ aging across every client with an open balance."
    >
      <div className="flex gap-2 mb-3">
        <button className="block-btn block-btn-primary" onClick={build}>
          {loaded ? 'Refresh' : 'Build'} aging
        </button>
        <button className="block-btn" onClick={exportCsv} disabled={!matrix.length}>
          Export CSV
        </button>
      </div>
      {loaded && (
        <div className="overflow-x-auto">
          <table className="block-table text-xs">
            <thead>
              <tr>
                <th>Client</th>
                <th className="text-right">0-30</th>
                <th className="text-right">31-60</th>
                <th className="text-right">61-90</th>
                <th className="text-right">90+</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrix.slice(0, 12).map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td className="text-right">{formatCurrency(m.b0)}</td>
                  <td className="text-right">{formatCurrency(m.b30)}</td>
                  <td className="text-right">{formatCurrency(m.b60)}</td>
                  <td className="text-right">{formatCurrency(m.b90)}</td>
                  <td className="text-right">{formatCurrency(m.total)}</td>
                </tr>
              ))}
              {!matrix.length && (
                <tr>
                  <td colSpan={6} className="text-text-muted">
                    No outstanding balances.
                  </td>
                </tr>
              )}
            </tbody>
            {matrix.length > 0 && (
              <tfoot>
                <tr>
                  <td className="font-semibold">Total</td>
                  <td className="text-right">{formatCurrency(totals.b0)}</td>
                  <td className="text-right">{formatCurrency(totals.b30)}</td>
                  <td className="text-right">{formatCurrency(totals.b60)}</td>
                  <td className="text-right">{formatCurrency(totals.b90)}</td>
                  <td className="text-right">{formatCurrency(totals.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
};

// ── 4. Contacts export ───────────────────────────────────────────────────────
const ContactsExport: React.FC<{ contacts: ContactRow[] }> = ({ contacts }) => {
  const exportCsv = () => {
    const headers = ['Name', 'Title', 'Email', 'Phone', 'Client', 'Primary'];
    const data = contacts.map((c) => [
      c.name,
      c.title,
      c.email,
      c.phone,
      c.client_name,
      c.is_primary ? 'yes' : '',
    ]);
    downloadCSVBlob(`client_contacts_${todayISO()}.csv`, toCSV(headers, data));
  };
  return (
    <Card
      title="4. Contacts export (CSV)"
      desc="Flatten every client contact into one address-book CSV."
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{contacts.length} contacts across clients</span>
        <button
          className="block-btn block-btn-primary"
          onClick={exportCsv}
          disabled={!contacts.length}
        >
          Export contacts
        </button>
      </div>
    </Card>
  );
};

// ── 5. Revenue summary CSV ───────────────────────────────────────────────────
const RevenueSummaryExport: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const exportCsv = () => {
    const headers = [
      'Client',
      'Lifetime Revenue',
      'Collected',
      'Outstanding',
      'Invoices',
      'Last Invoice',
    ];
    const data = clients.map((c) => [
      c.name,
      c.revenue.toFixed(2),
      c.collected.toFixed(2),
      c.outstanding.toFixed(2),
      c.invoice_count,
      c.last_invoice_date ?? '',
    ]);
    downloadCSVBlob(`client_revenue_summary_${todayISO()}.csv`, toCSV(headers, data));
  };
  const total = useMemo(() => clients.reduce((s, c) => s + c.revenue, 0), [clients]);
  return (
    <Card
      title="5. Client revenue summary CSV"
      desc="One row per client: lifetime revenue, collected, outstanding, invoice count, last invoice."
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">
          {clients.length} clients · {formatCurrency(total)} total revenue
        </span>
        <button
          className="block-btn block-btn-primary"
          onClick={exportCsv}
          disabled={!clients.length}
        >
          Export summary
        </button>
      </div>
    </Card>
  );
};

// ── 6. Top-N report ──────────────────────────────────────────────────────────
const TopNReport: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [n, setN] = useState(5);
  const [by, setBy] = useState<'revenue' | 'outstanding'>('revenue');

  const top = useMemo(
    () => [...clients].sort((a, b) => Number(b[by]) - Number(a[by])).slice(0, n),
    [clients, n, by]
  );

  const exportCsv = () => {
    const headers = ['Rank', 'Client', by === 'revenue' ? 'Revenue' : 'Balance'];
    const data = top.map((c, i) => [i + 1, c.name, Number(c[by]).toFixed(2)]);
    downloadCSVBlob(`top_${n}_clients_${by}_${todayISO()}.csv`, toCSV(headers, data));
  };

  const print = () => {
    const rows = top
      .map(
        (c, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(c.name)}</td><td class="right">${formatCurrency(
            Number(c[by])
          )}</td></tr>`
      )
      .join('');
    printHTML(
      `Top ${n} clients by ${by}`,
      `<h1>Top ${n} clients by ${by === 'revenue' ? 'revenue' : 'balance'}</h1>` +
        `<table><thead><tr><th>Rank</th><th>Client</th><th class="right">${
          by === 'revenue' ? 'Revenue' : 'Balance'
        }</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  };

  return (
    <Card title="6. Top-N clients report" desc="Configurable leaderboard by revenue or balance.">
      <div className="flex flex-wrap gap-2 mb-3">
        <select className="block-select" value={n} onChange={(e) => setN(Number(e.target.value))}>
          {[3, 5, 10, 20].map((v) => (
            <option key={v} value={v}>
              Top {v}
            </option>
          ))}
        </select>
        <select className="block-select" value={by} onChange={(e) => setBy(e.target.value as any)}>
          <option value="revenue">By revenue</option>
          <option value="outstanding">By balance</option>
        </select>
        <button className="block-btn" onClick={exportCsv} disabled={!top.length}>
          CSV
        </button>
        <button className="block-btn" onClick={print} disabled={!top.length}>
          Print
        </button>
      </div>
      <table className="block-table text-xs">
        <tbody>
          {top.map((c, i) => (
            <tr key={c.id}>
              <td className="w-8">{i + 1}</td>
              <td>{c.name}</td>
              <td className="text-right">{formatCurrency(Number(c[by]))}</td>
            </tr>
          ))}
          {!top.length && (
            <tr>
              <td className="text-text-muted">No clients.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
};

// ── 7. Email templates with merge tags ───────────────────────────────────────
interface MsgTemplate {
  id: string;
  name: string;
  body: string;
}
const TPL_KEY = 'bap-client-msg-templates';
const DEFAULT_TPL: MsgTemplate[] = [
  {
    id: 'thanks',
    name: 'Thank you',
    body: 'Hi {{name}},\n\nThank you for your continued business. Our standard terms are Net {{terms}} days.\n\nBest regards',
  },
  {
    id: 'balance',
    name: 'Balance note',
    body: 'Hi {{name}},\n\nOur records show an outstanding balance of {{balance}}. Please let us know if you have any questions.\n\nThanks',
  },
];

function loadTemplates(): MsgTemplate[] {
  try {
    const raw = localStorage.getItem(TPL_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_TPL;
}

function mergeTags(body: string, c: ClientAgg | undefined): string {
  if (!c) return body;
  return body
    .replace(/\{\{name\}\}/g, c.name)
    .replace(/\{\{balance\}\}/g, formatCurrency(c.outstanding))
    .replace(/\{\{terms\}\}/g, String(c.payment_terms))
    .replace(/\{\{email\}\}/g, c.email);
}

const EmailTemplates: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [templates, setTemplates] = useState<MsgTemplate[]>(() => loadTemplates());
  const [tplId, setTplId] = useState(() => loadTemplates()[0]?.id ?? '');
  const [clientId, setClientId] = useState('');
  const [draft, setDraft] = useState('');
  const [flash, doFlash] = useFlash();

  const persist = (next: MsgTemplate[]) => {
    setTemplates(next);
    try {
      localStorage.setItem(TPL_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const tpl = templates.find((t) => t.id === tplId);
  const client = clients.find((c) => c.id === clientId);
  const rendered = tpl ? mergeTags(draft || tpl.body, client) : '';

  const saveTpl = () => {
    if (!tpl) return;
    persist(templates.map((t) => (t.id === tpl.id ? { ...t, body: draft || t.body } : t)));
    doFlash('Template saved');
  };

  return (
    <Card
      title="7. Email templates with merge tags"
      desc="Reusable messages (saved locally) with {{name}} {{balance}} {{terms}} placeholders."
    >
      <div className="flex flex-wrap gap-2 mb-2">
        <select
          className="block-select"
          value={tplId}
          onChange={(e) => {
            setTplId(e.target.value);
            setDraft('');
          }}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
      </div>
      <textarea
        className="block-input w-full font-mono text-xs"
        rows={4}
        value={draft || tpl?.body || ''}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-2 p-2 rounded bg-bg-tertiary text-xs whitespace-pre-wrap text-text-secondary">
        {rendered || 'Pick a template…'}
      </div>
      <div className="flex gap-2 mt-2 items-center">
        <button className="block-btn" onClick={saveTpl} disabled={!tpl}>
          Save template
        </button>
        <button
          className="block-btn block-btn-primary"
          disabled={!rendered}
          onClick={async () => doFlash((await copyText(rendered)) ? 'Copied' : 'Copy failed')}
        >
          Copy filled message
        </button>
        <Flash msg={flash} />
      </div>
    </Card>
  );
};

// ── 8. Payment reminder draft generator ──────────────────────────────────────
const ReminderDraft: React.FC<{ clients: ClientAgg[]; companyId: string }> = ({
  clients,
  companyId,
}) => {
  const [clientId, setClientId] = useState('');
  const [draft, setDraft] = useState('');
  const [flash, doFlash] = useFlash();

  const generate = async () => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const rows = (await api.rawQuery(
      `SELECT invoice_number, due_date, (total - amount_paid) AS bal
         FROM invoices
         WHERE client_id = ? AND company_id = ? AND status IN ('sent','overdue','partial')
           AND (total - amount_paid) > 0
         ORDER BY due_date`,
      [clientId, companyId]
    )) as any[];

    const open = Array.isArray(rows) ? rows : [];
    const list = open
      .map(
        (r) =>
          `  • ${r.invoice_number} (due ${formatDate(r.due_date)}): ${formatCurrency(
            Number(r.bal ?? 0)
          )}`
      )
      .join('\n');
    const total = open.reduce((s, r) => s + Number(r.bal ?? 0), 0);

    const body =
      `Hi ${client.name},\n\nThis is a friendly reminder regarding the following outstanding ` +
      `invoice${open.length === 1 ? '' : 's'}:\n\n${list || '  • (no open invoices)'}\n\n` +
      `Total due: ${formatCurrency(total)}\n\nPlease arrange payment at your earliest convenience. ` +
      `Thank you.`;
    setDraft(body);
  };

  const client = clients.find((c) => c.id === clientId);

  return (
    <Card
      title="8. Payment reminder draft"
      desc="Generate a reminder from the client's actual overdue invoices; copy or open in your mail app."
    >
      <div className="flex flex-wrap gap-2 mb-2">
        <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
        <button className="block-btn block-btn-primary" onClick={generate} disabled={!clientId}>
          Generate draft
        </button>
      </div>
      {draft && (
        <>
          <div className="p-2 rounded bg-bg-tertiary text-xs whitespace-pre-wrap text-text-secondary">
            {draft}
          </div>
          <div className="flex gap-2 mt-2 items-center">
            <button
              className="block-btn"
              onClick={async () => doFlash((await copyText(draft)) ? 'Copied' : 'Copy failed')}
            >
              Copy
            </button>
            <a
              className="block-btn"
              href={`mailto:${encodeURIComponent(client?.email ?? '')}?subject=${encodeURIComponent(
                'Payment reminder'
              )}&body=${encodeURIComponent(draft)}`}
            >
              Open in mail
            </a>
            <Flash msg={flash} />
          </div>
        </>
      )}
    </Card>
  );
};

// ── 9. Mailing labels / address blocks ───────────────────────────────────────
const MailingLabels: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const withAddr = useMemo(() => clients.filter((c) => c.address_line1 || c.city), [clients]);
  const chosen = withAddr.filter((c) => selected[c.id]);

  const exportCsv = () => {
    const headers = ['Client', 'Address'];
    const data = chosen.map((c) => [c.name, fmtAddress(c).replace(/\n/g, ', ')]);
    downloadCSVBlob(`mailing_addresses_${todayISO()}.csv`, toCSV(headers, data));
  };

  const printLabels = () => {
    const tds = chosen.map(
      (c) =>
        `<td style="border:1px dashed #aaa;padding:14px;vertical-align:top;width:50%">` +
        `<strong>${escapeHtml(c.name)}</strong><br>${escapeHtml(fmtAddress(c)).replace(
          /\n/g,
          '<br>'
        )}</td>`
    );
    const rows: string[] = [];
    for (let i = 0; i < tds.length; i += 2) {
      rows.push('<tr>' + tds[i] + (tds[i + 1] ?? '<td></td>') + '</tr>');
    }
    printHTML(
      'Mailing labels',
      `<h1>Mailing labels</h1><table style="border:none">${rows.join('')}</table>`
    );
  };

  return (
    <Card
      title="9. Mailing-label export"
      desc="Pick clients and export formatted addresses to CSV or a printable label sheet."
    >
      <div className="max-h-40 overflow-y-auto mb-2 border border-border-primary rounded p-2">
        {withAddr.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!selected[c.id]}
              onChange={(e) => setSelected((s) => ({ ...s, [c.id]: e.target.checked }))}
            />
            <span className="text-text-secondary">{c.name}</span>
          </label>
        ))}
        {!withAddr.length && (
          <span className="text-xs text-text-muted">No clients with an address.</span>
        )}
      </div>
      <div className="flex gap-2 items-center">
        <span className="text-xs text-text-muted">{chosen.length} selected</span>
        <button className="block-btn" onClick={exportCsv} disabled={!chosen.length}>
          Export CSV
        </button>
        <button className="block-btn block-btn-primary" onClick={printLabels} disabled={!chosen.length}>
          Print labels
        </button>
      </div>
    </Card>
  );
};

// ── 10. New clients this period ──────────────────────────────────────────────
const NewClientsReport: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayISO());

  const rows = useMemo(
    () =>
      clients
        .filter((c) => {
          const created = (c.created_at || '').slice(0, 10);
          return created >= from && created <= to;
        })
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [clients, from, to]
  );

  const exportCsv = () => {
    const headers = ['Client', 'Created', 'First Invoice', 'Revenue'];
    const data = rows.map((c) => [
      c.name,
      (c.created_at || '').slice(0, 10),
      c.first_invoice_date ?? '',
      c.revenue.toFixed(2),
    ]);
    downloadCSVBlob(`new_clients_${from}_to_${to}.csv`, toCSV(headers, data));
  };

  return (
    <Card
      title="10. New clients this period"
      desc="Clients created in a date range, with first-invoice date."
    >
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <input type="date" className="block-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-text-muted text-xs">to</span>
        <input type="date" className="block-input" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="block-btn block-btn-primary" onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </button>
      </div>
      <p className="text-xs text-text-muted">{rows.length} new clients in range.</p>
    </Card>
  );
};

// ── 11. Inactive / dormant clients ───────────────────────────────────────────
const DormantReport: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [months, setMonths] = useState(6);

  const rows = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    return clients
      .filter((c) => !c.last_invoice_date || c.last_invoice_date.slice(0, 10) < cutoffISO)
      .sort((a, b) => ((a.last_invoice_date ?? '') < (b.last_invoice_date ?? '') ? -1 : 1));
  }, [clients, months]);

  const exportCsv = () => {
    const headers = ['Client', 'Email', 'Last Invoice', 'Lifetime Revenue'];
    const data = rows.map((c) => [
      c.name,
      c.email,
      c.last_invoice_date ?? 'never',
      c.revenue.toFixed(2),
    ]);
    downloadCSVBlob(`dormant_clients_${months}mo_${todayISO()}.csv`, toCSV(headers, data));
  };

  return (
    <Card
      title="11. Dormant clients"
      desc="Clients with no invoice in the chosen window — a re-engagement list."
    >
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <select
          className="block-select"
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
        >
          {[3, 6, 12, 24].map((m) => (
            <option key={m} value={m}>
              No invoice in {m} months
            </option>
          ))}
        </select>
        <button className="block-btn block-btn-primary" onClick={exportCsv} disabled={!rows.length}>
          Export {rows.length}
        </button>
      </div>
      <p className="text-xs text-text-muted">{rows.length} dormant clients.</p>
    </Card>
  );
};

// ── 12. Profitability ranking ────────────────────────────────────────────────
const ProfitabilityRanking: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const ranked = useMemo(
    () =>
      clients
        .map((c) => ({ ...c, profit: c.revenue - c.billable_expense }))
        .sort((a, b) => b.profit - a.profit),
    [clients]
  );

  const exportCsv = () => {
    const headers = ['Rank', 'Client', 'Revenue', 'Billable Expenses', 'Profit', 'Margin %'];
    const data = ranked.map((c, i) => [
      i + 1,
      c.name,
      c.revenue.toFixed(2),
      c.billable_expense.toFixed(2),
      c.profit.toFixed(2),
      c.revenue > 0 ? ((c.profit / c.revenue) * 100).toFixed(1) : '0.0',
    ]);
    downloadCSVBlob(`client_profitability_${todayISO()}.csv`, toCSV(headers, data));
  };

  return (
    <Card
      title="12. Profitability ranking"
      desc="Revenue minus attributed billable expenses, ranked per client."
    >
      <button className="block-btn block-btn-primary mb-3" onClick={exportCsv} disabled={!ranked.length}>
        Export ranking
      </button>
      <table className="block-table text-xs">
        <thead>
          <tr>
            <th>Client</th>
            <th className="text-right">Revenue</th>
            <th className="text-right">Profit</th>
          </tr>
        </thead>
        <tbody>
          {ranked.slice(0, 8).map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="text-right">{formatCurrency(c.revenue)}</td>
              <td className="text-right">{formatCurrency(c.profit)}</td>
            </tr>
          ))}
          {!ranked.length && (
            <tr>
              <td colSpan={3} className="text-text-muted">
                No data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
};

// ── 13. Industry / tier rollup ───────────────────────────────────────────────
const IndustryRollup: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [field, setField] = useState('industry');

  const rollup = useMemo(() => {
    const map = new Map<string, { group: string; count: number; revenue: number }>();
    for (const c of clients) {
      const key = parseCustomField(c.custom_fields, field) || '(unspecified)';
      const e = map.get(key) ?? { group: key, count: 0, revenue: 0 };
      e.count += 1;
      e.revenue += c.revenue;
      map.set(key, e);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [clients, field]);

  const exportCsv = () => {
    const headers = [field, 'Clients', 'Revenue'];
    const data = rollup.map((r) => [r.group, r.count, r.revenue.toFixed(2)]);
    downloadCSVBlob(`rollup_by_${field}_${todayISO()}.csv`, toCSV(headers, data));
  };

  return (
    <Card
      title="13. Industry / tier rollup"
      desc="Pivot clients and revenue by a custom_fields key (e.g. industry, tier)."
    >
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <select className="block-select" value={field} onChange={(e) => setField(e.target.value)}>
          <option value="industry">Group by: industry</option>
          <option value="tier">Group by: tier</option>
          <option value="segment">Group by: segment</option>
        </select>
        <button className="block-btn block-btn-primary" onClick={exportCsv} disabled={!rollup.length}>
          Export CSV
        </button>
      </div>
      <table className="block-table text-xs">
        <thead>
          <tr>
            <th>Group</th>
            <th className="text-right">Clients</th>
            <th className="text-right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rollup.map((r) => (
            <tr key={r.group}>
              <td>{r.group}</td>
              <td className="text-right">{r.count}</td>
              <td className="text-right">{formatCurrency(r.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};

// ── 14. Per-client invoice history CSV ───────────────────────────────────────
const PerClientInvoiceCSV: React.FC<{ clients: ClientAgg[]; companyId: string }> = ({
  clients,
  companyId,
}) => {
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, doFlash] = useFlash();

  const run = async () => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    setBusy(true);
    try {
      const rows = (await api.rawQuery(
        `SELECT invoice_number, issue_date, due_date, total, amount_paid, status
           FROM invoices WHERE client_id = ? AND company_id = ? ORDER BY issue_date DESC`,
        [clientId, companyId]
      )) as any[];
      const headers = ['Number', 'Issue Date', 'Due Date', 'Total', 'Paid', 'Status'];
      const data = (Array.isArray(rows) ? rows : []).map((r) => [
        r.invoice_number,
        r.issue_date,
        r.due_date,
        Number(r.total ?? 0).toFixed(2),
        Number(r.amount_paid ?? 0).toFixed(2),
        r.status,
      ]);
      if (!data.length) {
        doFlash('No invoices');
        return;
      }
      downloadCSVBlob(
        `invoices_${client.name.replace(/\s+/g, '_')}_${todayISO()}.csv`,
        toCSV(headers, data)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="14. Per-client invoice history CSV" desc="Export one client's full invoice list.">
      <div className="flex flex-wrap gap-2 items-center">
        <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
        <button className="block-btn block-btn-primary" onClick={run} disabled={!clientId || busy}>
          Export invoices
        </button>
        <Flash msg={flash} />
      </div>
    </Card>
  );
};

// ── 15. Per-client payment history CSV ───────────────────────────────────────
const PerClientPaymentCSV: React.FC<{ clients: ClientAgg[]; companyId: string }> = ({
  clients,
  companyId,
}) => {
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, doFlash] = useFlash();

  const run = async () => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    setBusy(true);
    try {
      const rows = (await api.rawQuery(
        `SELECT p.date, p.amount, p.payment_method, p.reference, i.invoice_number
           FROM payments p JOIN invoices i ON i.id = p.invoice_id
           WHERE i.client_id = ? AND p.company_id = ? ORDER BY p.date DESC`,
        [clientId, companyId]
      )) as any[];
      const headers = ['Date', 'Amount', 'Method', 'Reference', 'Invoice'];
      const data = (Array.isArray(rows) ? rows : []).map((r) => [
        r.date,
        Number(r.amount ?? 0).toFixed(2),
        r.payment_method,
        r.reference,
        r.invoice_number,
      ]);
      if (!data.length) {
        doFlash('No payments');
        return;
      }
      downloadCSVBlob(
        `payments_${client.name.replace(/\s+/g, '_')}_${todayISO()}.csv`,
        toCSV(headers, data)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="15. Per-client payment history CSV" desc="Export one client's received payments.">
      <div className="flex flex-wrap gap-2 items-center">
        <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
        <button className="block-btn block-btn-primary" onClick={run} disabled={!clientId || busy}>
          Export payments
        </button>
        <Flash msg={flash} />
      </div>
    </Card>
  );
};

// ── 16. Collections worksheet (print) ────────────────────────────────────────
const CollectionsWorksheet: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const rows = useMemo(
    () => clients.filter((c) => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding),
    [clients]
  );

  const print = () => {
    const body = rows
      .map((c) => {
        const days = c.last_invoice_date
          ? Math.max(
              0,
              Math.round((Date.now() - new Date(c.last_invoice_date).getTime()) / 86_400_000)
            )
          : '';
        return (
          `<tr><td>${escapeHtml(c.name)}</td><td class="right">${formatCurrency(
            c.outstanding
          )}</td><td class="right">${days}</td><td>${escapeHtml(
            c.last_payment_date ? formatDate(c.last_payment_date) : '—'
          )}</td><td class="note-cell"></td></tr>`
        );
      })
      .join('');
    printHTML(
      'Collections worksheet',
      `<h1>Collections worksheet</h1>` +
        `<table><thead><tr><th>Client</th><th class="right">Balance</th>` +
        `<th class="right">Days since last invoice</th><th>Last payment</th><th>Call notes</th>` +
        `</tr></thead><tbody>${body || '<tr><td colspan="5">No open balances</td></tr>'}</tbody></table>`
    );
  };

  return (
    <Card
      title="16. Collections worksheet"
      desc="Printable call sheet of clients with balances, days overdue and a notes column."
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{rows.length} clients with a balance</span>
        <button className="block-btn block-btn-primary" onClick={print} disabled={!rows.length}>
          Print worksheet
        </button>
      </div>
    </Card>
  );
};

// ── 17. Column picker CSV ────────────────────────────────────────────────────
interface PickerCol {
  key: string;
  label: string;
  get: (c: ClientAgg) => string | number;
}
const PICKER_COLS: PickerCol[] = [
  { key: 'name', label: 'Name', get: (c) => c.name },
  { key: 'email', label: 'Email', get: (c) => c.email },
  { key: 'phone', label: 'Phone', get: (c) => c.phone },
  { key: 'status', label: 'Status', get: (c) => c.status },
  { key: 'tax_id', label: 'Tax ID', get: (c) => c.tax_id },
  { key: 'terms', label: 'Terms', get: (c) => c.payment_terms },
  { key: 'revenue', label: 'Revenue', get: (c) => c.revenue.toFixed(2) },
  { key: 'collected', label: 'Collected', get: (c) => c.collected.toFixed(2) },
  { key: 'outstanding', label: 'Outstanding', get: (c) => c.outstanding.toFixed(2) },
  { key: 'invoices', label: 'Invoices', get: (c) => c.invoice_count },
];

const ColumnPicker: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [picked, setPicked] = useState<Record<string, boolean>>({
    name: true,
    email: true,
    revenue: true,
    outstanding: true,
  });

  const cols = PICKER_COLS.filter((c) => picked[c.key]);

  const exportCsv = () => {
    const headers = cols.map((c) => c.label);
    const data = clients.map((c) => cols.map((col) => col.get(c)));
    downloadCSVBlob(`clients_custom_${todayISO()}.csv`, toCSV(headers, data));
  };

  return (
    <Card title="17. Custom column export" desc="Choose exactly which fields land in the CSV.">
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
        {PICKER_COLS.map((c) => (
          <label
            key={c.key}
            className="flex items-center gap-1.5 text-xs cursor-pointer text-text-secondary"
          >
            <input
              type="checkbox"
              checked={!!picked[c.key]}
              onChange={(e) => setPicked((s) => ({ ...s, [c.key]: e.target.checked }))}
            />
            {c.label}
          </label>
        ))}
      </div>
      <button
        className="block-btn block-btn-primary"
        onClick={exportCsv}
        disabled={!cols.length || !clients.length}
      >
        Export {cols.length} columns
      </button>
    </Card>
  );
};

// ── 18. JSON backup ──────────────────────────────────────────────────────────
const JsonBackup: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const exportJson = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      count: clients.length,
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        status: c.status,
        payment_terms: c.payment_terms,
        tax_id: c.tax_id,
        tags: safeParseTags(c.tags),
        custom_fields: (() => {
          try {
            return JSON.parse(c.custom_fields || '{}');
          } catch {
            return {};
          }
        })(),
        created_at: c.created_at,
      })),
    };
    downloadBlob(
      `clients_backup_${todayISO()}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  };
  return (
    <Card
      title="18. JSON backup export"
      desc="Portable JSON dump of clients including tags and custom fields."
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{clients.length} clients</span>
        <button className="block-btn block-btn-primary" onClick={exportJson} disabled={!clients.length}>
          Download JSON
        </button>
      </div>
    </Card>
  );
};

// ── 19. Welcome letter ───────────────────────────────────────────────────────
const WelcomeLetter: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const [clientId, setClientId] = useState('');
  const client = clients.find((c) => c.id === clientId);

  const print = () => {
    if (!client) return;
    const addr = escapeHtml(fmtAddress(client)).replace(/\n/g, '<br>');
    printHTML(
      `Welcome — ${client.name}`,
      `<h1>Welcome aboard!</h1>` +
        `<p>${escapeHtml(client.name)}<br>${addr}</p>` +
        `<p>Dear ${escapeHtml(client.name)},</p>` +
        `<p>Thank you for choosing to work with us. We're delighted to have you as a client. ` +
        `Our standard payment terms are <strong>Net ${client.payment_terms} days</strong>, and ` +
        `you can always reach us with any questions.</p>` +
        `<p>Welcome again, and we look forward to a great working relationship.</p>` +
        `<p>Warm regards,<br>The Team</p>`
    );
  };

  return (
    <Card
      title="19. Welcome letter"
      desc="Printable onboarding letter merging the client's name, address and terms."
    >
      <div className="flex flex-wrap gap-2 items-center">
        <ClientSelect clients={clients} value={clientId} onChange={setClientId} />
        <button className="block-btn block-btn-primary" onClick={print} disabled={!clientId}>
          Print letter
        </button>
      </div>
    </Card>
  );
};

// ── 20. Quarterly activity report ────────────────────────────────────────────
const QuarterlyActivity: React.FC<{ companyId: string }> = ({ companyId }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [rows, setRows] = useState<
    Array<{ name: string; invoices: number; amount: number; payments: number }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  const range = useMemo(() => {
    const startM = (quarter - 1) * 3;
    const start = new Date(year, startM, 1).toISOString().slice(0, 10);
    const end = new Date(year, startM + 3, 0).toISOString().slice(0, 10);
    return { start, end };
  }, [year, quarter]);

  const build = async () => {
    const data = (await api.rawQuery(
      `SELECT c.name AS name,
              COUNT(DISTINCT i.id) AS invoices,
              COALESCE(SUM(i.total), 0) AS amount,
              COALESCE((SELECT SUM(p.amount) FROM payments p
                        JOIN invoices pi ON pi.id = p.invoice_id
                        WHERE pi.client_id = c.id AND p.company_id = ?
                          AND p.date BETWEEN ? AND ?), 0) AS payments
         FROM clients c
         LEFT JOIN invoices i ON i.client_id = c.id AND i.company_id = ?
              AND i.issue_date BETWEEN ? AND ?
         WHERE c.company_id = ?
         GROUP BY c.id
         HAVING invoices > 0 OR payments > 0
         ORDER BY amount DESC`,
      [companyId, range.start, range.end, companyId, range.start, range.end, companyId]
    )) as any[];
    setRows(
      (Array.isArray(data) ? data : []).map((r) => ({
        name: String(r.name ?? ''),
        invoices: Number(r.invoices ?? 0),
        amount: Number(r.amount ?? 0),
        payments: Number(r.payments ?? 0),
      }))
    );
    setLoaded(true);
  };

  const exportCsv = () => {
    const headers = ['Client', 'Invoices Issued', 'Amount Invoiced', 'Payments Received'];
    const data = rows.map((r) => [r.name, r.invoices, r.amount.toFixed(2), r.payments.toFixed(2)]);
    downloadCSVBlob(`quarterly_Q${quarter}_${year}.csv`, toCSV(headers, data));
  };

  return (
    <Card
      title="20. Quarterly activity report"
      desc="Per-client invoices issued and payments received within a quarter."
    >
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <select className="block-select" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
        </select>
        <select className="block-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[year + 1, year, year - 1, year - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button className="block-btn block-btn-primary" onClick={build}>
          Build
        </button>
        <button className="block-btn" onClick={exportCsv} disabled={!rows.length}>
          CSV
        </button>
      </div>
      {loaded && (
        <table className="block-table text-xs">
          <thead>
            <tr>
              <th>Client</th>
              <th className="text-right">Inv</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="text-right">{r.invoices}</td>
                <td className="text-right">{formatCurrency(r.amount)}</td>
                <td className="text-right">{formatCurrency(r.payments)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="text-text-muted">
                  No activity this quarter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Card>
  );
};

// ── 21. Directory print sheet ────────────────────────────────────────────────
const DirectoryPrint: React.FC<{ clients: ClientAgg[]; contacts: ContactRow[] }> = ({
  clients,
  contacts,
}) => {
  const print = () => {
    const primaryByClient = new Map<string, ContactRow>();
    for (const ct of contacts) {
      if (ct.is_primary || !primaryByClient.has(ct.client_id)) {
        primaryByClient.set(ct.client_id, ct);
      }
    }
    const active = clients.filter((c) => c.status === 'active');
    const body = active
      .map((c) => {
        const p = primaryByClient.get(c.id);
        return `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(
          p?.name ?? ''
        )}</td><td>${escapeHtml(c.phone || p?.phone || '')}</td><td>${escapeHtml(
          c.email || p?.email || ''
        )}</td></tr>`;
      })
      .join('');
    printHTML(
      'Client directory',
      `<h1>Client directory</h1><p class="muted">${active.length} active clients</p>` +
        `<table><thead><tr><th>Client</th><th>Primary contact</th><th>Phone</th><th>Email</th>` +
        `</tr></thead><tbody>${body || '<tr><td colspan="4">No active clients</td></tr>'}</tbody></table>`
    );
  };
  return (
    <Card
      title="21. Client directory print sheet"
      desc="Compact printable directory of active clients with their primary contact."
    >
      <button className="block-btn block-btn-primary" onClick={print} disabled={!clients.length}>
        Print directory
      </button>
    </Card>
  );
};

// ── 22. Tag-cloud / usage report ─────────────────────────────────────────────
const TagCloud: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const tags = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of clients) {
      for (const t of safeParseTags(c.tags)) {
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }, [clients]);

  const max = tags[0]?.count ?? 1;

  const exportCsv = () => {
    downloadCSVBlob(
      `tag_usage_${todayISO()}.csv`,
      toCSV(
        ['Tag', 'Clients'],
        tags.map((t) => [t.tag, t.count])
      )
    );
  };

  return (
    <Card title="22. Tag-usage report" desc="Frequency of every tag across clients.">
      <button className="block-btn block-btn-primary mb-3" onClick={exportCsv} disabled={!tags.length}>
        Export CSV
      </button>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span
            key={t.tag}
            className="block-badge block-badge-blue"
            style={{ fontSize: `${0.7 + (t.count / max) * 0.5}rem` }}
          >
            {t.tag} · {t.count}
          </span>
        ))}
        {!tags.length && <span className="text-xs text-text-muted">No tags in use.</span>}
      </div>
    </Card>
  );
};

// ── 23. Saved-report scheduling reminders ────────────────────────────────────
interface SavedReport {
  id: string;
  name: string;
  cadenceDays: number;
  lastRun: string; // ISO date
}
const SR_KEY = 'bap-client-saved-reports';

function loadSaved(): SavedReport[] {
  try {
    const raw = localStorage.getItem(SR_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
    }
  } catch {
    /* ignore */
  }
  return [];
}

const SavedReports: React.FC = () => {
  const [items, setItems] = useState<SavedReport[]>(() => loadSaved());
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState(30);

  const persist = (next: SavedReport[]) => {
    setItems(next);
    try {
      localStorage.setItem(SR_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const add = () => {
    if (!name.trim()) return;
    persist([
      ...items,
      { id: String(Date.now()), name: name.trim(), cadenceDays: cadence, lastRun: todayISO() },
    ]);
    setName('');
  };

  const markRun = (id: string) =>
    persist(items.map((r) => (r.id === id ? { ...r, lastRun: todayISO() } : r)));
  const remove = (id: string) => persist(items.filter((r) => r.id !== id));

  const isDue = (r: SavedReport) => {
    const next = new Date(r.lastRun);
    next.setDate(next.getDate() + r.cadenceDays);
    return next.getTime() <= Date.now();
  };
  const dueCount = items.filter(isDue).length;

  return (
    <Card title="23. Saved report reminders" desc="Pin a report cadence; we flag when it's due to re-run.">
      {dueCount > 0 && (
        <div
          className="text-xs mb-3 px-2 py-1 rounded"
          style={{
            background: 'color-mix(in srgb, var(--color-accent-warning) 18%, transparent)',
            color: 'var(--color-accent-warning)',
          }}
        >
          {dueCount} report{dueCount === 1 ? '' : 's'} due to run.
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          className="block-input flex-1 min-w-[140px]"
          placeholder="Report name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="block-select" value={cadence} onChange={(e) => setCadence(Number(e.target.value))}>
          {[7, 14, 30, 90].map((d) => (
            <option key={d} value={d}>
              every {d} days
            </option>
          ))}
        </select>
        <button className="block-btn block-btn-primary" onClick={add} disabled={!name.trim()}>
          Pin
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {items.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs">
            <span
              className={isDue(r) ? 'font-semibold' : ''}
              style={isDue(r) ? { color: 'var(--color-accent-warning)' } : undefined}
            >
              {isDue(r) ? '● ' : '○ '}
              {r.name}
            </span>
            <span className="text-text-muted">
              every {r.cadenceDays}d · last {formatDate(r.lastRun)}
            </span>
            <button className="block-btn ml-auto" onClick={() => markRun(r.id)}>
              Mark run
            </button>
            <button className="block-btn" onClick={() => remove(r.id)}>
              ✕
            </button>
          </div>
        ))}
        {!items.length && <span className="text-xs text-text-muted">No saved reports yet.</span>}
      </div>
    </Card>
  );
};

// ── 24. Data-completeness scorecard ──────────────────────────────────────────
const CompletenessScorecard: React.FC<{ clients: ClientAgg[] }> = ({ clients }) => {
  const scored = useMemo(() => {
    return clients
      .map((c) => {
        const checks = [
          !!c.email,
          !!c.phone,
          !!(c.address_line1 || c.city),
          !!c.tax_id,
          c.payment_terms > 0,
        ];
        const filled = checks.filter(Boolean).length;
        return {
          client: c,
          pct: Math.round((filled / checks.length) * 100),
          missing: [
            !c.email && 'email',
            !c.phone && 'phone',
            !(c.address_line1 || c.city) && 'address',
            !c.tax_id && 'tax_id',
            !(c.payment_terms > 0) && 'terms',
          ].filter(Boolean) as string[],
        };
      })
      .sort((a, b) => a.pct - b.pct);
  }, [clients]);

  const avg = scored.length
    ? Math.round(scored.reduce((s, r) => s + r.pct, 0) / scored.length)
    : 0;

  const exportCsv = () => {
    const headers = ['Client', 'Completeness %', 'Missing Fields'];
    const data = scored.map((r) => [r.client.name, r.pct, r.missing.join('; ')]);
    downloadCSVBlob(`client_completeness_${todayISO()}.csv`, toCSV(headers, data));
  };

  return (
    <Card
      title="24. Data-completeness scorecard"
      desc="Per-client profile completeness (email, phone, address, tax ID, terms)."
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-text-muted">Average completeness: {avg}%</span>
        <button className="block-btn block-btn-primary" onClick={exportCsv} disabled={!scored.length}>
          Export cleanup CSV
        </button>
      </div>
      <table className="block-table text-xs">
        <thead>
          <tr>
            <th>Client</th>
            <th className="text-right">%</th>
            <th>Missing</th>
          </tr>
        </thead>
        <tbody>
          {scored.slice(0, 8).map((r) => (
            <tr key={r.client.id}>
              <td>{r.client.name}</td>
              <td className="text-right">{r.pct}%</td>
              <td className="text-text-muted">{r.missing.join(', ') || '—'}</td>
            </tr>
          ))}
          {!scored.length && (
            <tr>
              <td colSpan={3} className="text-text-muted">
                No clients.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
};

// ── Shared client <select> ───────────────────────────────────────────────────
const ClientSelect: React.FC<{
  clients: ClientAgg[];
  value: string;
  onChange: (id: string) => void;
}> = ({ clients, value, onChange }) => (
  <select
    className="block-select min-w-[160px]"
    value={value}
    onChange={(e) => onChange(e.target.value)}
  >
    <option value="">Select client…</option>
    {clients.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
      </option>
    ))}
  </select>
);
