/**
 * ExpensesUpgrades.part4 — "Export, Templates & Reporting"
 *
 * A self-contained vertical stack of small, working export / reporting
 * features for the Expenses module. Every card reads REAL data through the
 * `api` wrapper (scoped to the active company) and produces a real artifact:
 * a CSV download (via downloadCSVBlob), a printout (api.print), a PDF
 * (api.saveToPDF), a clipboard copy, or a persisted localStorage preset.
 *
 * No external props — drop <ExpensesUpgradesPart4 /> anywhere in the module.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Printer,
  FileText,
  Clipboard,
  Save,
  Receipt,
  Building2,
  CalendarRange,
  Tag as TagIcon,
  CreditCard,
  Briefcase,
  RefreshCw,
  Layers,
  Mail,
} from 'lucide-react';
import api from '../../../lib/api';
import { formatCurrency, formatDate } from '../../../lib/format';
import {
  downloadCSVBlob,
  dateStampedFilename,
  type ColumnSpec,
} from '../../../lib/csv-export';
import { useCompanyStore } from '../../../stores/companyStore';

// ─── Local row shapes ────────────────────────────────────
interface ExpenseRow {
  id: string;
  date: string | null;
  amount: number | null;
  tax_amount: number | null;
  description: string | null;
  reference: string | null;
  category_id: string | null;
  category_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_tax_id: string | null;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  client_name: string | null;
  payment_method: string | null;
  status: string | null;
  is_billable: number | null;
  is_reimbursable: number | null;
  reimbursed: number | null;
  is_recurring: number | null;
  receipt_path: string | null;
  tags: string | null;
  custom_fields: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ExportPreset {
  name: string;
  columns: string[];
  year: string; // '' = all years
}

// ─── Helpers ─────────────────────────────────────────────
const num = (v: number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const yyyymm = (d: string | null): string => (d ? d.slice(0, 7) : '');
const yyyy = (d: string | null): string => (d ? d.slice(0, 4) : '');

const quarterOf = (d: string | null): string => {
  if (!d) return '';
  const m = Number(d.slice(5, 7));
  if (!m) return '';
  return `Q${Math.floor((m - 1) / 3) + 1}`;
};

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  } catch {
    /* not JSON — treat as comma list */
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function parseCustomFields(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

// All known export-eligible columns for the picker.
const ALL_COLUMNS: { key: string; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'vendor_name', label: 'Vendor' },
  { key: 'category_name', label: 'Category' },
  { key: 'description', label: 'Description' },
  { key: 'amount', label: 'Amount' },
  { key: 'tax_amount', label: 'Tax' },
  { key: 'payment_method', label: 'Payment Method' },
  { key: 'status', label: 'Status' },
  { key: 'reference', label: 'Reference' },
  { key: 'project_name', label: 'Project' },
  { key: 'client_name', label: 'Client' },
  { key: 'created_at', label: 'Created' },
  { key: 'updated_at', label: 'Updated' },
];

const PRESETS_KEY = 'bap-expense-export-presets';

// ─── Card shell ──────────────────────────────────────────
function Card({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: 'var(--color-accent-blue)', display: 'inline-flex' }}>{icon}</span>
        <h3 className="text-text-primary" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          {title}
        </h3>
      </div>
      <p className="text-text-muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
        {desc}
      </p>
      {children}
    </div>
  );
}

const rowGap: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };

// ─── Main component ──────────────────────────────────────
export default function ExpensesUpgradesPart4() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id ?? '';
  const companyName = activeCompany?.name ?? 'Company';

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Shared filters used by several export features.
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  // Column picker (features 1, 2, 16).
  const [pickedCols, setPickedCols] = useState<string[]>([
    'date',
    'vendor_name',
    'category_name',
    'description',
    'amount',
    'tax_amount',
    'payment_method',
    'status',
  ]);

  // Custom-field key picker (feature 18).
  const [pickedCustomKeys, setPickedCustomKeys] = useState<string[]>([]);

  // Export presets (feature 15).
  const [presets, setPresets] = useState<ExportPreset[]>(() => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? (v as ExportPreset[]) : [];
    } catch {
      return [];
    }
  });

  const [copyMsg, setCopyMsg] = useState('');

  // ── Load real data ──
  useEffect(() => {
    let cancelled = false;
    if (!companyId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const sql = `
      SELECT e.id, e.date, e.amount, e.tax_amount, e.description, e.reference,
             e.category_id, c.name AS category_name,
             e.vendor_id, v.name AS vendor_name, v.tax_id AS vendor_tax_id,
             e.project_id, p.name AS project_name,
             e.client_id, cl.name AS client_name,
             e.payment_method, e.status, e.is_billable, e.is_reimbursable,
             e.reimbursed, e.is_recurring, e.receipt_path, e.tags, e.custom_fields,
             e.created_at, e.updated_at
      FROM expenses e
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN vendors   v ON v.id = e.vendor_id
      LEFT JOIN projects  p ON p.id = e.project_id
      LEFT JOIN clients   cl ON cl.id = e.client_id
      WHERE e.company_id = ?
      ORDER BY e.date DESC
    `;
    api
      .rawQuery(sql, [companyId])
      .then((res: ExpenseRow[]) => {
        if (cancelled) return;
        setRows(Array.isArray(res) ? res : []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load expenses');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // ── Derived option lists ──
  const years = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const y = yyyy(r.date);
      if (y) s.add(y);
    });
    return Array.from(s).sort().reverse();
  }, [rows]);

  const vendorOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => {
      if (r.vendor_id) m.set(r.vendor_id, r.vendor_name || 'Unnamed vendor');
    });
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [rows]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => parseTags(r.tags).forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [rows]);

  const customKeys = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => Object.keys(parseCustomFields(r.custom_fields)).forEach((k) => s.add(k)));
    return Array.from(s).sort();
  }, [rows]);

  // ── The "currently filtered" set used by most exports ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (yearFilter && yyyy(r.date) !== yearFilter) return false;
      if (vendorFilter && r.vendor_id !== vendorFilter) return false;
      if (
        q &&
        !`${r.description ?? ''} ${r.vendor_name ?? ''} ${r.category_name ?? ''} ${r.reference ?? ''}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, yearFilter, vendorFilter]);

  const filteredTotal = useMemo(
    () => filtered.reduce((a, r) => a + num(r.amount), 0),
    [filtered]
  );

  // ─── Feature 1 & 2 & 16: filtered CSV with picked columns ───
  const exportFilteredCSV = () => {
    const cols: ColumnSpec[] = pickedCols.map((key) => {
      const meta = ALL_COLUMNS.find((c) => c.key === key);
      if (key === 'amount' || key === 'tax_amount') {
        return { key, label: meta?.label ?? key, format: (v: any) => num(v).toFixed(2) };
      }
      return { key, label: meta?.label ?? key };
    });
    downloadCSVBlob(filtered, dateStampedFilename(`expenses-${companyName}`), cols);
  };

  const toggleCol = (key: string) =>
    setPickedCols((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // ─── Feature 3: category summary report ───
  const exportCategorySummary = async () => {
    const agg = new Map<string, { name: string; count: number; total: number; tax: number }>();
    filtered.forEach((r) => {
      const id = r.category_id || '_uncat';
      const cur = agg.get(id) || { name: r.category_name || 'Uncategorized', count: 0, total: 0, tax: 0 };
      cur.count += 1;
      cur.total += num(r.amount);
      cur.tax += num(r.tax_amount);
      agg.set(id, cur);
    });
    const data = Array.from(agg.values())
      .sort((a, b) => b.total - a.total)
      .map((c) => ({
        category: c.name,
        count: c.count,
        total: c.total.toFixed(2),
        tax: c.tax.toFixed(2),
        avg: (c.total / (c.count || 1)).toFixed(2),
      }));
    downloadCSVBlob(data, dateStampedFilename('expense-category-summary'), [
      { key: 'category', label: 'Category' },
      { key: 'count', label: 'Count' },
      { key: 'total', label: 'Total' },
      { key: 'tax', label: 'Tax' },
      { key: 'avg', label: 'Average' },
    ]);
  };

  // ─── Feature 4: vendor 1099 totals ───
  const exportVendor1099 = () => {
    const yr = yearFilter || years[0] || String(new Date().getFullYear());
    const agg = new Map<string, { name: string; taxId: string; count: number; total: number }>();
    rows
      .filter((r) => yyyy(r.date) === yr && r.vendor_id)
      .forEach((r) => {
        const id = r.vendor_id as string;
        const cur =
          agg.get(id) || { name: r.vendor_name || 'Unnamed', taxId: r.vendor_tax_id || '', count: 0, total: 0 };
        cur.count += 1;
        cur.total += num(r.amount);
        agg.set(id, cur);
      });
    const data = Array.from(agg.values())
      .filter((v) => v.total >= 600) // 1099-NEC threshold
      .sort((a, b) => b.total - a.total)
      .map((v) => ({
        vendor: v.name,
        tax_id: v.taxId || '(missing)',
        payments: v.count,
        total: v.total.toFixed(2),
      }));
    if (data.length === 0) {
      alert(`No vendors crossed the $600 1099 threshold in ${yr}.`);
      return;
    }
    downloadCSVBlob(data, dateStampedFilename(`1099-vendor-totals-${yr}`), [
      { key: 'vendor', label: 'Vendor' },
      { key: 'tax_id', label: 'Tax ID' },
      { key: 'payments', label: 'Payments' },
      { key: 'total', label: 'Total Paid' },
    ]);
  };

  // ─── Feature 5: monthly P&L pivot (category × month) ───
  const exportMonthlyPivot = () => {
    const months = Array.from(new Set(filtered.map((r) => yyyymm(r.date)).filter(Boolean))).sort();
    const cats = new Map<string, Record<string, number>>();
    filtered.forEach((r) => {
      const cat = r.category_name || 'Uncategorized';
      const mo = yyyymm(r.date);
      if (!mo) return;
      const row = cats.get(cat) || {};
      row[mo] = (row[mo] || 0) + num(r.amount);
      cats.set(cat, row);
    });
    const data = Array.from(cats, ([cat, mvals]) => {
      const obj: Record<string, string | number> = { category: cat };
      let total = 0;
      months.forEach((m) => {
        const v = mvals[m] || 0;
        obj[m] = v.toFixed(2);
        total += v;
      });
      obj.total = total.toFixed(2);
      return obj;
    });
    const cols: ColumnSpec[] = [
      { key: 'category', label: 'Category' },
      ...months.map((m) => ({ key: m, label: m })),
      { key: 'total', label: 'Total' },
    ];
    downloadCSVBlob(data, dateStampedFilename('expense-monthly-pivot'), cols);
  };

  // ─── Feature 6: tax-deductible line items only ───
  const exportDeductibleLineItems = async () => {
    if (!companyId) return;
    try {
      const sql = `
        SELECT li.id, e.date, v.name AS vendor_name, c.name AS category_name,
               li.description, li.amount, li.tax_rate
        FROM expense_line_items li
        JOIN expenses e ON e.id = li.expense_id
        LEFT JOIN vendors v ON v.id = e.vendor_id
        LEFT JOIN categories c ON c.id = e.category_id
        WHERE e.company_id = ? AND li.deductible = 1
        ORDER BY e.date DESC
      `;
      const li: Array<Record<string, any>> = await api.rawQuery(sql, [companyId]);
      if (!Array.isArray(li) || li.length === 0) {
        alert('No tax-deductible line items found.');
        return;
      }
      const data = li.map((r) => ({
        date: r.date,
        vendor_name: r.vendor_name || '',
        category_name: r.category_name || 'Uncategorized',
        description: r.description || '',
        amount: num(r.amount).toFixed(2),
        tax_rate: num(r.tax_rate),
      }));
      downloadCSVBlob(data, dateStampedFilename('tax-deductible-line-items'), [
        { key: 'date', label: 'Date' },
        { key: 'vendor_name', label: 'Vendor' },
        { key: 'category_name', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount' },
        { key: 'tax_rate', label: 'Tax Rate %' },
      ]);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  // ─── Feature 7: project cost report (vs budget) ───
  const exportProjectCosts = async () => {
    if (!companyId) return;
    try {
      const sql = `
        SELECT p.id, p.name, p.budget,
               COALESCE(SUM(e.amount), 0) AS spent,
               COUNT(e.id) AS cnt
        FROM projects p
        LEFT JOIN expenses e ON e.project_id = p.id AND e.company_id = p.company_id
        WHERE p.company_id = ?
        GROUP BY p.id
        ORDER BY spent DESC
      `;
      const res: Array<Record<string, any>> = await api.rawQuery(sql, [companyId]);
      if (!Array.isArray(res) || res.length === 0) {
        alert('No projects found.');
        return;
      }
      const data = res.map((r) => {
        const spent = num(r.spent);
        const budget = num(r.budget);
        return {
          project: r.name || 'Unnamed',
          budget: budget.toFixed(2),
          spent: spent.toFixed(2),
          remaining: (budget - spent).toFixed(2),
          pct_used: budget > 0 ? ((spent / budget) * 100).toFixed(1) : 'n/a',
          expenses: num(r.cnt),
        };
      });
      downloadCSVBlob(data, dateStampedFilename('project-cost-report'), [
        { key: 'project', label: 'Project' },
        { key: 'budget', label: 'Budget' },
        { key: 'spent', label: 'Spent' },
        { key: 'remaining', label: 'Remaining' },
        { key: 'pct_used', label: '% Used' },
        { key: 'expenses', label: 'Expense Count' },
      ]);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  // ─── Feature 8: reimbursement run sheet ───
  const exportReimbursementRun = () => {
    const due = rows.filter((r) => num(r.is_reimbursable) === 1 && num(r.reimbursed) === 0);
    if (due.length === 0) {
      alert('No unreimbursed reimbursable expenses.');
      return;
    }
    const data = due
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map((r) => ({
        date: r.date,
        vendor: r.vendor_name || '',
        description: r.description || '',
        category: r.category_name || '',
        amount: num(r.amount).toFixed(2),
        payment_method: r.payment_method || '',
      }));
    const total = due.reduce((a, r) => a + num(r.amount), 0);
    data.push({
      date: '',
      vendor: '',
      description: 'TOTAL DUE',
      category: '',
      amount: total.toFixed(2),
      payment_method: '',
    });
    downloadCSVBlob(data, dateStampedFilename('reimbursement-run-sheet'), [
      { key: 'date', label: 'Date' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'description', label: 'Description' },
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount' },
      { key: 'payment_method', label: 'Paid Via' },
    ]);
  };

  // ─── Report HTML builder (features 9, 10, 21) ───
  const buildReportHTML = (title: string, list: ExpenseRow[]): string => {
    const total = list.reduce((a, r) => a + num(r.amount), 0);
    const tax = list.reduce((a, r) => a + num(r.tax_amount), 0);
    const body = list
      .map(
        (r) => `<tr>
          <td>${formatDate(r.date)}</td>
          <td>${esc(r.vendor_name)}</td>
          <td>${esc(r.category_name)}</td>
          <td>${esc(r.description)}</td>
          <td style="text-align:right">${formatCurrency(num(r.amount))}</td>
        </tr>`
      )
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;padding:24px;}
      h1{font-size:18px;margin:0 0 2px;} .sub{color:#666;font-size:12px;margin:0 0 16px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;}
      th{background:#f3f3f3;} tfoot td{font-weight:700;border-top:2px solid #333;}
    </style></head><body>
      <h1>${esc(companyName)} — ${esc(title)}</h1>
      <p class="sub">${list.length} expense(s) · Generated ${formatDate(new Date().toISOString())}</p>
      <table><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="4">Tax: ${formatCurrency(tax)} · Total</td><td style="text-align:right">${formatCurrency(total)}</td></tr></tfoot>
      </table></body></html>`;
  };

  // ─── Feature 9: print-friendly report ───
  const printReport = async () => {
    if (filtered.length === 0) {
      alert('Nothing to print — the filtered list is empty.');
      return;
    }
    const res = await api.print(buildReportHTML('Expense Report', filtered));
    if (res?.error) alert(`Print failed: ${res.error}`);
  };

  // ─── Feature 10: save report to PDF ───
  const savePDF = async () => {
    if (filtered.length === 0) {
      alert('Nothing to export — the filtered list is empty.');
      return;
    }
    const res = await api.saveToPDF(buildReportHTML('Expense Report', filtered), 'Expense Report', {
      pdfOptions: {
        pageSize: 'Letter',
        printBackground: true,
        metadata: { title: 'Expense Report', author: companyName, subject: 'Expenses' },
      },
    });
    if (res?.error) alert(`PDF export failed: ${res.error}`);
  };

  // ─── Feature 11 & 24: copy summary / email recap to clipboard ───
  const copySummary = async (variant: 'category' | 'email') => {
    const catAgg = new Map<string, number>();
    filtered.forEach((r) => {
      const k = r.category_name || 'Uncategorized';
      catAgg.set(k, (catAgg.get(k) || 0) + num(r.amount));
    });
    const lines = Array.from(catAgg.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  • ${k}: ${formatCurrency(v)}`);
    let text: string;
    if (variant === 'email') {
      text =
        `Hi,\n\nHere is the expense recap for ${companyName}` +
        `${yearFilter ? ` (${yearFilter})` : ''}.\n\n` +
        `${filtered.length} expenses totaling ${formatCurrency(filteredTotal)}.\n\n` +
        `By category:\n${lines.join('\n')}\n\nBest regards`;
    } else {
      text =
        `${companyName} — Expense Summary${yearFilter ? ` (${yearFilter})` : ''}\n` +
        `Total: ${formatCurrency(filteredTotal)} across ${filtered.length} expenses\n\n` +
        `${lines.join('\n')}`;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(variant === 'email' ? 'Email recap copied' : 'Summary copied');
      setTimeout(() => setCopyMsg(''), 2500);
    } catch {
      alert('Clipboard unavailable in this context.');
    }
  };

  // ─── Feature 12: receipt checklist ───
  const exportReceiptChecklist = () => {
    const data = filtered.map((r) => ({
      date: r.date,
      vendor: r.vendor_name || '',
      description: r.description || '',
      amount: num(r.amount).toFixed(2),
      has_receipt: r.receipt_path ? 'Yes' : 'No',
    }));
    downloadCSVBlob(data, dateStampedFilename('receipt-checklist'), [
      { key: 'date', label: 'Date' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount' },
      { key: 'has_receipt', label: 'Has Receipt' },
    ]);
  };

  // ─── Feature 13: quarterly tax estimate worksheet ───
  const exportQuarterly = () => {
    const yr = yearFilter || years[0] || String(new Date().getFullYear());
    const set = rows.filter((r) => yyyy(r.date) === yr);
    const agg = new Map<string, { total: number; tax: number; count: number }>();
    ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q) => agg.set(q, { total: 0, tax: 0, count: 0 }));
    set.forEach((r) => {
      const q = quarterOf(r.date);
      if (!q) return;
      const cur = agg.get(q)!;
      cur.total += num(r.amount);
      cur.tax += num(r.tax_amount);
      cur.count += 1;
    });
    const data = Array.from(agg.entries()).map(([q, v]) => ({
      quarter: `${yr} ${q}`,
      expenses: v.count,
      total: v.total.toFixed(2),
      tax_paid: v.tax.toFixed(2),
    }));
    downloadCSVBlob(data, dateStampedFilename(`quarterly-tax-worksheet-${yr}`), [
      { key: 'quarter', label: 'Quarter' },
      { key: 'expenses', label: 'Expenses' },
      { key: 'total', label: 'Total Spend' },
      { key: 'tax_paid', label: 'Tax Paid' },
    ]);
  };

  // ─── Feature 14: vendor statement ───
  const exportVendorStatement = () => {
    if (!vendorFilter) {
      alert('Pick a vendor in the filter bar first.');
      return;
    }
    const set = rows
      .filter((r) => r.vendor_id === vendorFilter)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (set.length === 0) {
      alert('No expenses for that vendor.');
      return;
    }
    const name = set[0].vendor_name || 'vendor';
    let running = 0;
    const data = set.map((r) => {
      running += num(r.amount);
      return {
        date: r.date,
        description: r.description || '',
        reference: r.reference || '',
        amount: num(r.amount).toFixed(2),
        running_total: running.toFixed(2),
      };
    });
    downloadCSVBlob(data, dateStampedFilename(`statement-${name}`), [
      { key: 'date', label: 'Date' },
      { key: 'description', label: 'Description' },
      { key: 'reference', label: 'Reference' },
      { key: 'amount', label: 'Amount' },
      { key: 'running_total', label: 'Running Total' },
    ]);
  };

  // ─── Feature 15: export presets ───
  const savePreset = () => {
    const name = prompt('Name this export preset:');
    if (!name) return;
    const next = [
      ...presets.filter((p) => p.name !== name),
      { name, columns: pickedCols, year: yearFilter },
    ];
    setPresets(next);
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    } catch {
      /* storage may be full / disabled */
    }
  };

  const runPreset = (p: ExportPreset) => {
    const set = rows.filter((r) => !p.year || yyyy(r.date) === p.year);
    const cols: ColumnSpec[] = p.columns.map((key) => {
      const meta = ALL_COLUMNS.find((c) => c.key === key);
      if (key === 'amount' || key === 'tax_amount') {
        return { key, label: meta?.label ?? key, format: (v: any) => num(v).toFixed(2) };
      }
      return { key, label: meta?.label ?? key };
    });
    downloadCSVBlob(set, dateStampedFilename(`preset-${p.name}`), cols);
  };

  const deletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  // ─── Feature 16: audit-trail export ───
  const exportAuditTrail = () => {
    const data = filtered.map((r) => ({
      id: r.id,
      date: r.date,
      vendor: r.vendor_name || '',
      amount: num(r.amount).toFixed(2),
      status: r.status || '',
      created_at: r.created_at || '',
      updated_at: r.updated_at || '',
    }));
    downloadCSVBlob(data, dateStampedFilename('expense-audit-trail'), [
      { key: 'id', label: 'Expense ID' },
      { key: 'date', label: 'Date' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'created_at', label: 'Created' },
      { key: 'updated_at', label: 'Updated' },
    ]);
  };

  // ─── Feature 17: executive summary PDF ───
  const exportExecPDF = async () => {
    if (filtered.length === 0) {
      alert('No data for the executive summary.');
      return;
    }
    const catAgg = new Map<string, number>();
    const venAgg = new Map<string, number>();
    filtered.forEach((r) => {
      catAgg.set(r.category_name || 'Uncategorized', (catAgg.get(r.category_name || 'Uncategorized') || 0) + num(r.amount));
      if (r.vendor_name) venAgg.set(r.vendor_name, (venAgg.get(r.vendor_name) || 0) + num(r.amount));
    });
    const topCat = [...catAgg.entries()].sort((a, b) => b[1] - a[1])[0];
    const topVen = [...venAgg.entries()].sort((a, b) => b[1] - a[1])[0];
    const tile = (label: string, value: string) =>
      `<div style="flex:1;border:1px solid #ddd;border-radius:8px;padding:14px;margin:6px;">
        <div style="font-size:11px;color:#777;text-transform:uppercase;">${esc(label)}</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(value)}</div></div>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,Segoe UI,sans-serif;padding:24px;color:#1a1a1a;">
        <h1 style="font-size:20px;margin:0 0 2px;">${esc(companyName)} — Spend Executive Summary</h1>
        <p style="color:#666;font-size:12px;">${yearFilter || 'All periods'} · ${filtered.length} expenses</p>
        <div style="display:flex;margin-top:12px;">
          ${tile('Total Spend', formatCurrency(filteredTotal))}
          ${tile('Top Category', topCat ? `${topCat[0]} (${formatCurrency(topCat[1])})` : '—')}
          ${tile('Top Vendor', topVen ? `${topVen[0]} (${formatCurrency(topVen[1])})` : '—')}
        </div>
      </body></html>`;
    const res = await api.saveToPDF(html, 'Spend Executive Summary', {
      pdfOptions: { pageSize: 'Letter', landscape: true, printBackground: true },
    });
    if (res?.error) alert(`PDF export failed: ${res.error}`);
  };

  // ─── Feature 18: custom-field columns ───
  const toggleCustomKey = (k: string) =>
    setPickedCustomKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const exportWithCustomFields = () => {
    const data = filtered.map((r) => {
      const cf = parseCustomFields(r.custom_fields);
      const base: Record<string, any> = {
        date: r.date,
        vendor: r.vendor_name || '',
        amount: num(r.amount).toFixed(2),
      };
      pickedCustomKeys.forEach((k) => {
        const v = cf[k];
        base[`cf_${k}`] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      });
      return base;
    });
    const cols: ColumnSpec[] = [
      { key: 'date', label: 'Date' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'amount', label: 'Amount' },
      ...pickedCustomKeys.map((k) => ({ key: `cf_${k}`, label: k })),
    ];
    downloadCSVBlob(data, dateStampedFilename('expenses-custom-fields'), cols);
  };

  // ─── Feature 19: recurring commitments ───
  const exportRecurring = () => {
    const set = rows.filter((r) => num(r.is_recurring) === 1);
    if (set.length === 0) {
      alert('No recurring expenses found.');
      return;
    }
    const data = set.map((r) => ({
      vendor: r.vendor_name || '',
      category: r.category_name || '',
      description: r.description || '',
      amount: num(r.amount).toFixed(2),
      last_date: r.date,
    }));
    downloadCSVBlob(data, dateStampedFilename('recurring-commitments'), [
      { key: 'vendor', label: 'Vendor' },
      { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount' },
      { key: 'last_date', label: 'Most Recent' },
    ]);
  };

  // ─── Feature 20: billable client invoice prep ───
  const exportBillablePrep = async () => {
    if (!companyId) return;
    const set = rows.filter((r) => num(r.is_billable) === 1 && r.client_id);
    if (set.length === 0) {
      alert('No billable, client-linked expenses found.');
      return;
    }
    const data = set
      .slice()
      .sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''))
      .map((r) => ({
        client: r.client_name || 'Unassigned',
        date: r.date,
        description: r.description || '',
        category: r.category_name || '',
        amount: num(r.amount).toFixed(2),
      }));
    downloadCSVBlob(data, dateStampedFilename('billable-invoice-prep'), [
      { key: 'client', label: 'Client' },
      { key: 'date', label: 'Date' },
      { key: 'description', label: 'Description' },
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount' },
    ]);
  };

  // ─── Feature 21: year-end category rollup PDF ───
  const exportYearEndPDF = async () => {
    const yr = yearFilter || years[0] || String(new Date().getFullYear());
    const set = rows.filter((r) => yyyy(r.date) === yr);
    if (set.length === 0) {
      alert(`No expenses in ${yr}.`);
      return;
    }
    const months = Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, '0')}`);
    const cats = new Map<string, number[]>();
    set.forEach((r) => {
      const cat = r.category_name || 'Uncategorized';
      const idx = Number((r.date || '').slice(5, 7)) - 1;
      if (idx < 0 || idx > 11) return;
      const arr = cats.get(cat) || new Array(12).fill(0);
      arr[idx] += num(r.amount);
      cats.set(cat, arr);
    });
    const head = `<th>Category</th>${months.map((_m, i) => `<th>${i + 1}</th>`).join('')}<th>Total</th>`;
    const body = Array.from(cats.entries())
      .map(([cat, arr]) => {
        const tot = arr.reduce((a, b) => a + b, 0);
        return `<tr><td>${esc(cat)}</td>${arr
          .map((v) => `<td style="text-align:right">${v ? formatCurrency(v) : '—'}</td>`)
          .join('')}<td style="text-align:right;font-weight:700">${formatCurrency(tot)}</td></tr>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,sans-serif;padding:20px;color:#1a1a1a;}
      table{width:100%;border-collapse:collapse;font-size:10px;}
      th,td{border:1px solid #ddd;padding:4px 6px;} th{background:#f0f0f0;}
    </style></head><body>
      <h1 style="font-size:16px;">${esc(companyName)} — ${yr} Category Rollup</h1>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const res = await api.saveToPDF(html, `${yr} Category Rollup`, {
      pdfOptions: { pageSize: 'Letter', landscape: true, printBackground: true },
    });
    if (res?.error) alert(`PDF export failed: ${res.error}`);
  };

  // ─── Feature 22: tagged-expense report ───
  const exportTagged = () => {
    if (!tagFilter) {
      alert('Choose a tag first.');
      return;
    }
    const set = rows.filter((r) => parseTags(r.tags).includes(tagFilter));
    if (set.length === 0) {
      alert(`No expenses tagged "${tagFilter}".`);
      return;
    }
    const data = set.map((r) => ({
      date: r.date,
      vendor: r.vendor_name || '',
      category: r.category_name || '',
      description: r.description || '',
      amount: num(r.amount).toFixed(2),
      tags: parseTags(r.tags).join('; '),
    }));
    downloadCSVBlob(data, dateStampedFilename(`tagged-${tagFilter}`), [
      { key: 'date', label: 'Date' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount' },
      { key: 'tags', label: 'Tags' },
    ]);
  };

  // ─── Feature 23: spend by payment method ───
  const exportByPaymentMethod = () => {
    const agg = new Map<string, { total: number; count: number }>();
    filtered.forEach((r) => {
      const k = r.payment_method || '(unspecified)';
      const cur = agg.get(k) || { total: 0, count: 0 };
      cur.total += num(r.amount);
      cur.count += 1;
      agg.set(k, cur);
    });
    const data = Array.from(agg.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(([method, v]) => ({
        payment_method: method,
        count: v.count,
        total: v.total.toFixed(2),
        share: filteredTotal > 0 ? ((v.total / filteredTotal) * 100).toFixed(1) : '0',
      }));
    downloadCSVBlob(data, dateStampedFilename('spend-by-payment-method'), [
      { key: 'payment_method', label: 'Payment Method' },
      { key: 'count', label: 'Count' },
      { key: 'total', label: 'Total' },
      { key: 'share', label: '% of Spend' },
    ]);
  };

  // ─── Render ──
  const btn = 'block-btn';
  const btnP = 'block-btn block-btn-primary';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 className="text-text-primary" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 2px' }}>
          Export, Templates &amp; Reporting
        </h2>
        <p className="text-text-muted" style={{ fontSize: 12, margin: 0 }}>
          {loading
            ? 'Loading expenses…'
            : `${rows.length} expenses loaded · ${filtered.length} match current filters (${formatCurrency(
                filteredTotal
              )})`}
        </p>
      </div>

      {!companyId && (
        <div className="block-card" style={{ padding: 16 }}>
          <p className="text-text-muted" style={{ margin: 0, fontSize: 13 }}>
            Select a company to enable exports.
          </p>
        </div>
      )}

      {error && (
        <div className="block-card" style={{ padding: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-expense)' }}>{error}</p>
        </div>
      )}

      {/* Shared filter bar */}
      <Card
        icon={<CalendarRange size={16} />}
        title="Report Filters"
        desc="These filters define the working set used by the export and report tools below."
      >
        <div style={rowGap}>
          <input
            className="block-input"
            placeholder="Search vendor / description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220, flex: 1 }}
          />
          <select className="block-select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select className="block-select" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
            <option value="">All vendors</option>
            {vendorOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select className="block-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* Features 1, 2, 16 */}
      <Card
        icon={<Download size={16} />}
        title="Filtered CSV Export with Column Picker"
        desc="Export the currently filtered expenses. Tick the fields you want in the CSV."
      >
        <div style={{ ...rowGap, marginBottom: 12 }}>
          {ALL_COLUMNS.map((c) => (
            <label
              key={c.key}
              className="text-text-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
            >
              <input type="checkbox" checked={pickedCols.includes(c.key)} onChange={() => toggleCol(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
        <div style={rowGap}>
          <button className={btnP} onClick={exportFilteredCSV} disabled={filtered.length === 0}>
            <Download size={14} /> Export {filtered.length} rows
          </button>
          <button className={btn} onClick={savePreset} disabled={pickedCols.length === 0}>
            <Save size={14} /> Save as preset
          </button>
          <button className={btn} onClick={exportAuditTrail} disabled={filtered.length === 0}>
            Audit-trail CSV
          </button>
        </div>
      </Card>

      {/* Feature 15 */}
      {presets.length > 0 && (
        <Card icon={<Save size={16} />} title="Saved Export Presets" desc="One-click re-run of a saved column-set + year.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {presets.map((p) => (
              <div key={p.name} style={{ ...rowGap, justifyContent: 'space-between' }}>
                <span className="text-text-secondary" style={{ fontSize: 13 }}>
                  <strong>{p.name}</strong>{' '}
                  <span className="text-text-muted">
                    ({p.columns.length} cols{p.year ? ` · ${p.year}` : ''})
                  </span>
                </span>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <button className={btn} onClick={() => runPreset(p)}>
                    <Download size={13} /> Run
                  </button>
                  <button className={btn} onClick={() => deletePreset(p.name)}>
                    Remove
                  </button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Features 3, 5, 23 */}
      <Card
        icon={<Layers size={16} />}
        title="Accounting Summaries"
        desc="Aggregated CSVs for the books — by category, by month, and by payment method."
      >
        <div style={rowGap}>
          <button className={btn} onClick={exportCategorySummary} disabled={filtered.length === 0}>
            Category summary
          </button>
          <button className={btn} onClick={exportMonthlyPivot} disabled={filtered.length === 0}>
            Monthly P&amp;L pivot
          </button>
          <button className={btn} onClick={exportByPaymentMethod} disabled={filtered.length === 0}>
            <CreditCard size={14} /> By payment method
          </button>
        </div>
      </Card>

      {/* Features 4, 6, 13 — tax */}
      <Card
        icon={<Receipt size={16} />}
        title="Tax &amp; Compliance Exports"
        desc="1099 vendor totals, deductible line items, and a quarterly tax worksheet (uses the year filter)."
      >
        <div style={rowGap}>
          <button className={btn} onClick={exportVendor1099}>
            1099 vendor totals
          </button>
          <button className={btn} onClick={exportDeductibleLineItems} disabled={!companyId}>
            Deductible line items
          </button>
          <button className={btn} onClick={exportQuarterly}>
            Quarterly worksheet
          </button>
        </div>
      </Card>

      {/* Features 7, 8, 20 — operational */}
      <Card
        icon={<Briefcase size={16} />}
        title="Project, Reimbursement &amp; Billing"
        desc="Project cost vs budget, a reimbursement payout run sheet, and billable client invoice prep."
      >
        <div style={rowGap}>
          <button className={btn} onClick={exportProjectCosts} disabled={!companyId}>
            Project cost report
          </button>
          <button className={btn} onClick={exportReimbursementRun}>
            Reimbursement run
          </button>
          <button className={btn} onClick={exportBillablePrep} disabled={!companyId}>
            Billable invoice prep
          </button>
        </div>
      </Card>

      {/* Features 12, 19 — hygiene/forecast */}
      <Card
        icon={<RefreshCw size={16} />}
        title="Audit &amp; Forecast Lists"
        desc="Receipt-coverage checklist and a forecast of recurring fixed-cost commitments."
      >
        <div style={rowGap}>
          <button className={btn} onClick={exportReceiptChecklist} disabled={filtered.length === 0}>
            Receipt checklist
          </button>
          <button className={btn} onClick={exportRecurring}>
            Recurring commitments
          </button>
        </div>
      </Card>

      {/* Feature 14 — vendor statement */}
      <Card
        icon={<Building2 size={16} />}
        title="Vendor Statement"
        desc="Pick a vendor in the filter bar, then export a dated running-balance statement of all its expenses."
      >
        <button className={btn} onClick={exportVendorStatement} disabled={!vendorFilter}>
          <Download size={14} /> Export vendor statement
        </button>
      </Card>

      {/* Feature 22 — tagged */}
      <Card
        icon={<TagIcon size={16} />}
        title="Tagged-Expense Report"
        desc="Pick a tag in the filter bar, then export every expense carrying that tag."
      >
        <button className={btn} onClick={exportTagged} disabled={!tagFilter}>
          <Download size={14} /> Export tag “{tagFilter || '…'}”
        </button>
      </Card>

      {/* Feature 18 — custom fields */}
      <Card
        icon={<Layers size={16} />}
        title="Custom-Field Export Columns"
        desc="Flatten chosen custom_fields JSON keys into extra CSV columns."
      >
        {customKeys.length === 0 ? (
          <p className="text-text-muted" style={{ fontSize: 12, margin: 0 }}>
            No custom fields detected on these expenses.
          </p>
        ) : (
          <>
            <div style={{ ...rowGap, marginBottom: 12 }}>
              {customKeys.map((k) => (
                <label
                  key={k}
                  className="text-text-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                >
                  <input
                    type="checkbox"
                    checked={pickedCustomKeys.includes(k)}
                    onChange={() => toggleCustomKey(k)}
                  />
                  {k}
                </label>
              ))}
            </div>
            <button className={btn} onClick={exportWithCustomFields} disabled={pickedCustomKeys.length === 0}>
              <Download size={14} /> Export with custom fields
            </button>
          </>
        )}
      </Card>

      {/* Features 9, 10, 17, 21 — print & PDF */}
      <Card
        icon={<FileText size={16} />}
        title="Print &amp; PDF Reports"
        desc="Clean printout or styled PDF of the filtered list, plus a one-page executive summary and a year-end rollup."
      >
        <div style={rowGap}>
          <button className={btn} onClick={printReport} disabled={filtered.length === 0}>
            <Printer size={14} /> Print report
          </button>
          <button className={btn} onClick={savePDF} disabled={filtered.length === 0}>
            <FileText size={14} /> Save report PDF
          </button>
          <button className={btn} onClick={exportExecPDF} disabled={filtered.length === 0}>
            Executive summary PDF
          </button>
          <button className={btn} onClick={exportYearEndPDF}>
            Year-end rollup PDF
          </button>
        </div>
      </Card>

      {/* Features 11, 24 — clipboard */}
      <Card
        icon={<Clipboard size={16} />}
        title="Copy Summaries to Clipboard"
        desc="Paste a totals-by-category summary or a ready-to-send email recap into any app."
      >
        <div style={rowGap}>
          <button className={btn} onClick={() => copySummary('category')} disabled={filtered.length === 0}>
            <Clipboard size={14} /> Copy summary
          </button>
          <button className={btn} onClick={() => copySummary('email')} disabled={filtered.length === 0}>
            <Mail size={14} /> Copy email recap
          </button>
          {copyMsg && (
            <span style={{ fontSize: 12, color: 'var(--color-accent-income)' }}>{copyMsg}</span>
          )}
        </div>
      </Card>
    </div>
  );
}

// Minimal HTML escaper for report bodies.
function esc(v: string | null | undefined): string {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
