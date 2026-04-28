import React, { useEffect, useState, useMemo } from 'react';
import { Receipt, Printer, Download, ChevronRight, ChevronDown } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import { SummaryBar } from '../../components/SummaryBar';
import { downloadCSVBlob } from '../../lib/csv-export';
import ErrorBanner from '../../components/ErrorBanner';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';

// ─── Types ──────────────────────────────────────────────
interface Expense {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: string;
  vendor_id: string | null;
  category_id: string | null;
  project_id: string | null;
  vendor_name: string | null;
  category_name: string | null;
  project_name: string | null;
  is_tax_deductible: number | boolean | null;
  is_billable: number | boolean | null;
  payment_method: string | null;
}

interface LineItem {
  id: string;
  expense_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  sort_order: number;
}

type GroupBy = 'none' | 'category' | 'vendor' | 'project' | 'quarter' | 'tax_deductible' | 'payment_method';

interface GroupSection {
  label: string;
  total: number;
  expenses: Expense[];
}

// ─── IRS Schedule C line mapping (Change 51) ────────────
const SCHEDULE_C_HINTS: Record<string, string> = {
  'Advertising': 'Line 8 - Advertising',
  'Car and Truck': 'Line 9 - Car and truck expenses',
  'Commission': 'Line 10 - Commissions and fees',
  'Insurance': 'Line 15 - Insurance',
  'Interest': 'Line 16 - Interest',
  'Legal and Professional': 'Line 17 - Legal and professional services',
  'Office': 'Line 18 - Office expense',
  'Rent': 'Line 20b - Rent (other business property)',
  'Repairs': 'Line 21 - Repairs and maintenance',
  'Supplies': 'Line 22 - Supplies',
  'Taxes and Licenses': 'Line 23 - Taxes and licenses',
  'Travel': 'Line 24a - Travel',
  'Meals': 'Line 24b - Deductible meals',
  'Utilities': 'Line 25 - Utilities',
  'Wages': 'Line 26 - Wages',
};

// ─── Helpers ────────────────────────────────────────────
function getYearStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function getToday(): string {
  return fmtDate(new Date(), 'yyyy-MM-dd');
}

function getQuarter(dateStr: string): string {
  if (!dateStr) return 'Unknown';
  const month = parseInt(dateStr.substring(5, 7), 10);
  if (month <= 3) return 'Q1';
  if (month <= 6) return 'Q2';
  if (month <= 9) return 'Q3';
  return 'Q4';
}

function groupExpenses(expenses: Expense[], groupBy: GroupBy): GroupSection[] {
  if (groupBy === 'none') return [];

  const map = new Map<string, Expense[]>();
  for (const exp of expenses) {
    let key: string;
    if (groupBy === 'category') key = exp.category_name || 'Uncategorized';
    else if (groupBy === 'vendor') key = exp.vendor_name || 'No Vendor';
    else if (groupBy === 'project') key = exp.project_name || 'No Project';
    else if (groupBy === 'quarter') key = getQuarter(exp.date);
    else if (groupBy === 'tax_deductible') key = exp.is_tax_deductible ? 'Tax Deductible' : 'Non-Deductible';
    else if (groupBy === 'payment_method') key = exp.payment_method || 'Unknown';
    else key = 'Unknown';

    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(exp);
  }

  return Array.from(map.entries())
    .map(([label, exps]) => ({
      label,
      total: exps.reduce((s, e) => s + Math.abs(Number(e.amount) || 0), 0),
      expenses: exps,
    }))
    .sort((a, b) => b.total - a.total);
}

// ─── Component ──────────────────────────────────────────
const ExpenseDetailReport: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  const [startDate, setStartDate] = useState(getYearStart);
  const [endDate, setEndDate] = useState(getToday);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [lineItemsMap, setLineItemsMap] = useState<Record<string, LineItem[]>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  // ─── Data Loading ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');

      try {
        const rows: any[] = await api.rawQuery(
          `SELECT e.*, v.name as vendor_name, c.name as category_name, p.name as project_name
           FROM expenses e
           LEFT JOIN vendors v ON e.vendor_id = v.id
           LEFT JOIN categories c ON e.category_id = c.id
           LEFT JOIN projects p ON e.project_id = p.id
           WHERE e.company_id = ? AND date(e.date) BETWEEN date(?) AND date(?)
           ORDER BY e.date DESC`,
          [activeCompany.id, startDate, endDate]
        );

        if (cancelled) return;

        const expenseList: Expense[] = (rows ?? []).map((r: any) => ({
          id: r.id,
          date: r.date,
          description: r.description || '',
          amount: Number(r.amount) || 0,
          status: r.status || 'pending',
          vendor_id: r.vendor_id,
          category_id: r.category_id,
          project_id: r.project_id,
          vendor_name: r.vendor_name,
          category_name: r.category_name,
          project_name: r.project_name,
          is_tax_deductible: r.is_tax_deductible,
          is_billable: r.is_billable,
          payment_method: r.payment_method || null,
        }));

        setExpenses(expenseList);

        // Fetch line items
        if (expenseList.length > 0) {
          const ids = expenseList.map((e) => e.id);
          const placeholders = ids.map(() => '?').join(',');
          const liRows: any[] = await api.rawQuery(
            `SELECT * FROM expense_line_items WHERE expense_id IN (${placeholders}) ORDER BY sort_order ASC`,
            ids
          );

          if (cancelled) return;

          const liMap: Record<string, LineItem[]> = {};
          for (const li of liRows ?? []) {
            const eid = li.expense_id;
            if (!liMap[eid]) liMap[eid] = [];
            liMap[eid].push({
              id: li.id,
              expense_id: li.expense_id,
              description: li.description || '',
              quantity: Number(li.quantity) || 0,
              unit_price: Number(li.unit_price) || 0,
              amount: Number(li.amount) || 0,
              sort_order: Number(li.sort_order) || 0,
            });
          }
          setLineItemsMap(liMap);
        } else {
          setLineItemsMap({});
        }
      } catch (err: any) {
        console.error('Failed to load expense detail report:', err);
        if (!cancelled) setError(err?.message || 'Failed to load expense detail report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [startDate, endDate, activeCompany]);

  // ─── Filtered & computed data ───────────────────────
  const filtered = useMemo(() => {
    if (statusFilter === 'all') return expenses;
    return expenses.filter((e) => e.status === statusFilter);
  }, [expenses, statusFilter]);

  const total = useMemo(() => filtered.reduce((s, e) => s + Math.abs(e.amount), 0), [filtered]);

  const pendingItems = useMemo(() => filtered.filter((e) => e.status === 'pending'), [filtered]);
  const approvedItems = useMemo(() => filtered.filter((e) => e.status === 'approved'), [filtered]);
  const paidItems = useMemo(() => filtered.filter((e) => e.status === 'paid'), [filtered]);

  const pendingAmt = useMemo(() => pendingItems.reduce((s, e) => s + Math.abs(e.amount), 0), [pendingItems]);
  const approvedAmt = useMemo(() => approvedItems.reduce((s, e) => s + Math.abs(e.amount), 0), [approvedItems]);
  const paidAmt = useMemo(() => paidItems.reduce((s, e) => s + Math.abs(e.amount), 0), [paidItems]);

  const groups = useMemo(() => groupExpenses(filtered, groupBy), [filtered, groupBy]);

  // ─── Change 51-52: Tax Deductible Summary ──────────
  const taxDeductible = useMemo(() => filtered.filter(e => e.is_tax_deductible), [filtered]);
  const taxNonDeductible = useMemo(() => filtered.filter(e => !e.is_tax_deductible), [filtered]);
  const deductibleAmt = useMemo(() => taxDeductible.reduce((s, e) => s + Math.abs(e.amount), 0), [taxDeductible]);
  const nonDeductibleAmt = useMemo(() => taxNonDeductible.reduce((s, e) => s + Math.abs(e.amount), 0), [taxNonDeductible]);
  const deductiblePct = total > 0 ? (deductibleAmt / total) * 100 : 0;

  // Deductible by category for IRS hints
  const deductibleByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of taxDeductible) {
      const cat = e.category_name || 'Uncategorized';
      map.set(cat, (map.get(cat) || 0) + Math.abs(e.amount));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [taxDeductible]);

  // ─── Change 53: Billable vs Non-Billable ──────────
  const billableItems = useMemo(() => filtered.filter(e => e.is_billable), [filtered]);
  const nonBillableItems = useMemo(() => filtered.filter(e => !e.is_billable), [filtered]);
  const billableAmt = useMemo(() => billableItems.reduce((s, e) => s + Math.abs(e.amount), 0), [billableItems]);
  const nonBillableAmt = useMemo(() => nonBillableItems.reduce((s, e) => s + Math.abs(e.amount), 0), [nonBillableItems]);

  // ─── Change 54: Payment Method Breakdown ──────────
  const paymentMethodBreakdown = useMemo(() => {
    const methods = ['cash', 'check', 'credit_card', 'bank_transfer'];
    const labels: Record<string, string> = { cash: 'Cash', check: 'Check', credit_card: 'Credit Card', bank_transfer: 'Bank Transfer' };
    const result: { method: string; label: string; amount: number; count: number }[] = [];
    for (const m of methods) {
      const items = filtered.filter(e => (e.payment_method || '').toLowerCase() === m);
      result.push({
        method: m,
        label: labels[m] || m,
        amount: items.reduce((s, e) => s + Math.abs(e.amount), 0),
        count: items.length,
      });
    }
    // Add "Other" for anything not in the standard list
    const otherItems = filtered.filter(e => !methods.includes((e.payment_method || '').toLowerCase()));
    if (otherItems.length > 0) {
      result.push({
        method: 'other',
        label: 'Other',
        amount: otherItems.reduce((s, e) => s + Math.abs(e.amount), 0),
        count: otherItems.length,
      });
    }
    return result;
  }, [filtered]);

  // ─── Expand/Collapse ────────────────────────────────
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Print ──────────────────────────────────────────
  const handlePrint = async () => {
    if (!activeCompany) return;
    try {
      const { generateExpenseReportHTML } = await import('../../lib/print-templates');
      const printData = filtered.map((e) => ({
        ...e,
        tax_amount: (e as any).tax_amount ?? 0,
        line_items: (lineItemsMap[e.id] || []).map((li: any) => ({
          description: li.description ?? '',
          quantity: li.quantity ?? 1,
          unit_price: li.unit_price ?? li.amount ?? 0,
          amount: li.amount ?? 0,
        })),
      }));
      const html = generateExpenseReportHTML(
        printData as any,
        activeCompany.name,
        `${startDate} to ${endDate}`,
        groupBy === 'quarter' || groupBy === 'tax_deductible' || groupBy === 'payment_method' ? 'none' : groupBy
      );
      await api.printPreview(html, 'Expense Detail Report');
    } catch (err) {
      console.error('Print failed:', err);
    }
  };

  // ─── CSV Export ─────────────────────────────────────
  const handleExport = () => {
    const rows: Record<string, any>[] = [];
    for (const exp of filtered) {
      const items = lineItemsMap[exp.id];
      if (items && items.length > 0) {
        for (const li of items) {
          rows.push({
            date: exp.date,
            description: exp.description,
            category: exp.category_name || '',
            vendor: exp.vendor_name || '',
            project: exp.project_name || '',
            status: exp.status,
            tax_deductible: exp.is_tax_deductible ? 'Yes' : 'No',
            billable: exp.is_billable ? 'Yes' : 'No',
            payment_method: exp.payment_method || '',
            line_description: li.description,
            quantity: li.quantity,
            unit_price: li.unit_price,
            line_amount: li.amount,
            expense_total: exp.amount,
          });
        }
      } else {
        rows.push({
          date: exp.date,
          description: exp.description,
          category: exp.category_name || '',
          vendor: exp.vendor_name || '',
          project: exp.project_name || '',
          status: exp.status,
          tax_deductible: exp.is_tax_deductible ? 'Yes' : 'No',
          billable: exp.is_billable ? 'Yes' : 'No',
          payment_method: exp.payment_method || '',
          line_description: '',
          quantity: '',
          unit_price: '',
          line_amount: '',
          expense_total: exp.amount,
        });
      }
    }
    downloadCSVBlob(rows, `expense-detail-${startDate}-to-${endDate}.csv`);
  };

  // ─── Render Expense Row ─────────────────────────────
  const renderExpenseRow = (exp: Expense) => {
    const items = lineItemsMap[exp.id];
    const hasItems = items && items.length > 0;
    const isExpanded = expandedIds.has(exp.id);
    const statusInfo = formatStatus(exp.status);

    return (
      <React.Fragment key={exp.id}>
        <tr
          className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors cursor-pointer"
          onClick={() => hasItems && toggleExpand(exp.id)}
        >
          <td className="px-4 py-2 text-xs text-text-primary font-mono">{formatDate(exp.date)}</td>
          <td className="px-4 py-2 text-xs text-text-primary font-medium">{exp.description || '--'}</td>
          <td className="px-4 py-2 text-xs text-text-secondary">{exp.category_name || '--'}</td>
          <td className="px-4 py-2 text-xs text-text-secondary">{exp.vendor_name || '--'}</td>
          <td className="px-4 py-2 text-xs text-text-primary font-mono text-right font-semibold">{formatCurrency(Math.abs(exp.amount))}</td>
          <td className="px-4 py-2">
            <span className={`block-badge text-[10px] ${statusInfo.className}`}>{statusInfo.label}</span>
          </td>
          <td className="px-4 py-2 text-center w-10">
            {hasItems ? (isExpanded ? <ChevronDown size={14} className="text-text-muted inline" /> : <ChevronRight size={14} className="text-text-muted inline" />) : null}
          </td>
        </tr>
        {hasItems && isExpanded && (
          <tr>
            <td colSpan={7} className="p-0">
              <div className="bg-bg-tertiary/40 border-b border-border-primary/50">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-left pl-12 pr-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Description</th>
                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Qty</th>
                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Unit Price</th>
                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items!.map((li) => (
                      <tr key={li.id} className="border-t border-border-primary/30">
                        <td className="pl-12 pr-4 py-1.5 text-xs text-text-secondary">{li.description || '--'}</td>
                        <td className="px-4 py-1.5 text-xs text-text-secondary font-mono text-right">{li.quantity}</td>
                        <td className="px-4 py-1.5 text-xs text-text-secondary font-mono text-right">{formatCurrency(li.unit_price)}</td>
                        <td className="px-4 py-1.5 text-xs text-text-primary font-mono text-right">{formatCurrency(li.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  // ─── Render Table Header ────────────────────────────
  const tableHead = (
    <thead>
      <tr className="bg-bg-tertiary border-b border-border-primary">
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Date</th>
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Description</th>
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Category</th>
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Vendor</th>
        <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Amount</th>
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Status</th>
        <th className="px-4 py-2 w-10" />
      </tr>
    </thead>
  );

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PrintReportHeader title="Expense Detail Report" periodLabel="period" periodEnd={endDate} />
      {error && <ErrorBanner message={error} title="Failed to load expense detail report" onDismiss={() => setError('')} />}

      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between flex-wrap gap-3" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Receipt size={16} className="text-accent-expense" />
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">From</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">To</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          {/* Change 55: Enhanced grouping */}
          <select className="block-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="none">No Grouping</option>
            <option value="category">Group by Category</option>
            <option value="vendor">Group by Vendor</option>
            <option value="project">Group by Project</option>
            <option value="quarter">Group by Quarter</option>
            <option value="tax_deductible">Group by Tax Deductible</option>
            <option value="payment_method">Group by Payment Method</option>
          </select>
          <select className="block-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button className="block-btn flex items-center gap-1.5 text-xs" onClick={handlePrint} title="Print Report"><Printer size={14} /> Print</button>
          <button className="block-btn flex items-center gap-1.5 text-xs" onClick={handleExport} title="Export CSV"><Download size={14} /> Export</button>
        </div>
      </div>

      {/* Summary */}
      <div className="report-summary-tiles">
        <SummaryBar
          items={[
            { label: 'Total Expenses', value: formatCurrency(total) },
            { label: 'Pending', value: `${pendingItems.length} · ${formatCurrency(pendingAmt)}`, accent: 'orange' },
            { label: 'Approved', value: `${approvedItems.length} · ${formatCurrency(approvedAmt)}`, accent: 'green' },
            { label: 'Paid', value: `${paidItems.length} · ${formatCurrency(paidAmt)}` },
          ]}
        />
      </div>

      {/* Change 51-52: Tax Deductible Summary */}
      {filtered.length > 0 && (
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Tax Deductible Summary</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="text-center">
              <p className="text-lg font-bold font-mono text-accent-income">{formatCurrency(deductibleAmt)}</p>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Deductible</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold font-mono text-text-secondary">{formatCurrency(nonDeductibleAmt)}</p>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Non-Deductible</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold font-mono text-accent-blue">{deductiblePct.toFixed(1)}%</p>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Deductible Rate</p>
            </div>
          </div>
          {deductibleByCategory.length > 0 && (
            <div className="border-t border-border-primary/50 pt-3 mt-1">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">IRS Schedule C Hints</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {deductibleByCategory.slice(0, 8).map(([cat, amt]) => (
                  <div key={cat} className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary truncate" title={SCHEDULE_C_HINTS[cat] || ''}>{cat}</span>
                    <span className="font-mono text-text-muted ml-2">{formatCurrency(amt)}</span>
                  </div>
                ))}
              </div>
              {deductibleByCategory.length > 0 && (
                <p className="text-[9px] text-text-muted mt-2 opacity-60">Hover category names for Schedule C line references. Consult a tax professional for accuracy.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Change 53: Billable vs Non-Billable */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
            <p className="text-lg font-bold font-mono text-accent-income">{formatCurrency(billableAmt)}</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-1">Billable ({billableItems.length})</p>
          </div>
          <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
            <p className="text-lg font-bold font-mono text-text-secondary">{formatCurrency(nonBillableAmt)}</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-1">Non-Billable ({nonBillableItems.length})</p>
          </div>
        </div>
      )}

      {/* Change 54: Payment Method Breakdown */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {paymentMethodBreakdown.filter(m => m.count > 0).map(m => (
            <div key={m.method} className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
              <p className="text-sm font-bold font-mono text-text-primary">{formatCurrency(m.amount)}</p>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-0.5">{m.label} ({m.count})</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Loading expense data...</div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">No expenses found for this period.</div>
      ) : groupBy === 'none' ? (
        <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="block-table w-full text-sm">
            {tableHead}
            <tbody>{filtered.map(renderExpenseRow)}</tbody>
            <tfoot>
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/50 report-grand-total-row">
                <td colSpan={4} className="px-4 py-2 text-xs font-bold text-text-primary">Total ({filtered.length} expenses)</td>
                <td className="px-4 py-2 text-right font-mono text-xs font-bold text-accent-expense">{formatCurrency(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.label} className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-2.5 bg-bg-tertiary border-b border-border-primary flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary uppercase tracking-wider">{group.label}</span>
                <span className="text-xs font-bold font-mono text-accent-expense">{formatCurrency(group.total)}</span>
              </div>
              <table className="block-table w-full text-sm">
                {tableHead}
                <tbody>{group.expenses.map(renderExpenseRow)}</tbody>
              </table>
            </div>
          ))}

          <div className="block-card p-3 flex items-center justify-between report-grand-total-row" style={{ borderRadius: '6px' }}>
            <span className="text-xs font-bold text-text-primary">Grand Total ({filtered.length} expenses)</span>
            <span className="text-sm font-bold font-mono text-accent-expense">{formatCurrency(total)}</span>
          </div>
        </div>
      )}
      <PrintReportFooter />
    </div>
  );
};

export default ExpenseDetailReport;
