import React, { useEffect, useState, useMemo } from 'react';
import { Receipt, Printer, Download, ChevronRight, ChevronDown } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import { SummaryBar } from '../../components/SummaryBar';
import { downloadCSVBlob } from '../../lib/csv-export';
import ErrorBanner from '../../components/ErrorBanner';

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

type GroupBy = 'none' | 'category' | 'vendor' | 'project';

interface GroupSection {
  label: string;
  total: number;
  expenses: Expense[];
}

// ─── Helpers ────────────────────────────────────────────
function getYearStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

// Use local-date format() not toISOString() — the latter returns the UTC
// date, so late-evening users west of UTC (e.g. America/Denver) saw the
// next day's date pre-filled into the report range.
function getToday(): string {
  return fmtDate(new Date(), 'yyyy-MM-dd');
}

function groupExpenses(expenses: Expense[], groupBy: GroupBy): GroupSection[] {
  if (groupBy === 'none') return [];

  const map = new Map<string, Expense[]>();
  for (const exp of expenses) {
    let key: string;
    if (groupBy === 'category') key = exp.category_name || 'Uncategorized';
    else if (groupBy === 'vendor') key = exp.vendor_name || 'No Vendor';
    else key = exp.project_name || 'No Project';

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
        }));

        setExpenses(expenseList);

        // Fetch line items for all expenses
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
    return () => {
      cancelled = true;
    };
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
        groupBy
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
          <td className="px-4 py-2 text-xs text-text-primary font-mono">
            {formatDate(exp.date)}
          </td>
          <td className="px-4 py-2 text-xs text-text-primary font-medium">
            {exp.description || '--'}
          </td>
          <td className="px-4 py-2 text-xs text-text-secondary">
            {exp.category_name || '--'}
          </td>
          <td className="px-4 py-2 text-xs text-text-secondary">
            {exp.vendor_name || '--'}
          </td>
          <td className="px-4 py-2 text-xs text-text-primary font-mono text-right font-semibold">
            {formatCurrency(Math.abs(exp.amount))}
          </td>
          <td className="px-4 py-2">
            <span className={`block-badge text-[10px] ${statusInfo.className}`}>
              {statusInfo.label}
            </span>
          </td>
          <td className="px-4 py-2 text-center w-10">
            {hasItems ? (
              isExpanded ? (
                <ChevronDown size={14} className="text-text-muted inline" />
              ) : (
                <ChevronRight size={14} className="text-text-muted inline" />
              )
            ) : null}
          </td>
        </tr>

        {/* Expanded line items */}
        {hasItems && isExpanded && (
          <tr>
            <td colSpan={7} className="p-0">
              <div className="bg-bg-tertiary/40 border-b border-border-primary/50">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-left pl-12 pr-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Description
                      </th>
                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Qty
                      </th>
                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Unit Price
                      </th>
                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items!.map((li) => (
                      <tr
                        key={li.id}
                        className="border-t border-border-primary/30"
                      >
                        <td className="pl-12 pr-4 py-1.5 text-xs text-text-secondary">
                          {li.description || '--'}
                        </td>
                        <td className="px-4 py-1.5 text-xs text-text-secondary font-mono text-right">
                          {li.quantity}
                        </td>
                        <td className="px-4 py-1.5 text-xs text-text-secondary font-mono text-right">
                          {formatCurrency(li.unit_price)}
                        </td>
                        <td className="px-4 py-1.5 text-xs text-text-primary font-mono text-right">
                          {formatCurrency(li.amount)}
                        </td>
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
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Date
        </th>
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Description
        </th>
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Category
        </th>
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Vendor
        </th>
        <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Amount
        </th>
        <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Status
        </th>
        <th className="px-4 py-2 w-10" />
      </tr>
    </thead>
  );

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load expense detail report" onDismiss={() => setError('')} />}
      {/* Controls */}
      <div
        className="block-card p-4 flex items-center justify-between flex-wrap gap-3"
        style={{ borderRadius: '6px' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <Receipt size={16} className="text-accent-expense" />
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            From
          </label>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            To
          </label>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <select
            className="block-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            <option value="none">No Grouping</option>
            <option value="category">Group by Category</option>
            <option value="vendor">Group by Vendor</option>
            <option value="project">Group by Project</option>
          </select>
          <select
            className="block-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={handlePrint}
            title="Print Report"
          >
            <Printer size={14} />
            Print
          </button>
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={handleExport}
            title="Export CSV"
          >
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* Summary */}
      <SummaryBar
        items={[
          { label: 'Total Expenses', value: formatCurrency(total) },
          {
            label: 'Pending',
            value: `${pendingItems.length} \u00B7 ${formatCurrency(pendingAmt)}`,
            accent: 'orange',
          },
          {
            label: 'Approved',
            value: `${approvedItems.length} \u00B7 ${formatCurrency(approvedAmt)}`,
            accent: 'green',
          },
          {
            label: 'Paid',
            value: `${paidItems.length} \u00B7 ${formatCurrency(paidAmt)}`,
          },
        ]}
      />

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Loading expense data...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">
          No expenses found for this period.
        </div>
      ) : groupBy === 'none' ? (
        /* Flat table */
        <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="block-table w-full text-sm">
            {tableHead}
            <tbody>{filtered.map(renderExpenseRow)}</tbody>
            <tfoot>
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                <td colSpan={4} className="px-4 py-2 text-xs font-bold text-text-primary">
                  Total ({filtered.length} expenses)
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs font-bold text-accent-expense">
                  {formatCurrency(total)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        /* Grouped tables */
        <div className="space-y-4">
          {groups.map((group) => (
            <div
              key={group.label}
              className="block-card overflow-hidden"
              style={{ borderRadius: '6px' }}
            >
              {/* Group header */}
              <div className="px-4 py-2.5 bg-bg-tertiary border-b border-border-primary flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
                  {group.label}
                </span>
                <span className="text-xs font-bold font-mono text-accent-expense">
                  {formatCurrency(group.total)}
                </span>
              </div>
              <table className="block-table w-full text-sm">
                {tableHead}
                <tbody>{group.expenses.map(renderExpenseRow)}</tbody>
              </table>
            </div>
          ))}

          {/* Grand total */}
          <div
            className="block-card p-3 flex items-center justify-between"
            style={{ borderRadius: '6px' }}
          >
            <span className="text-xs font-bold text-text-primary">
              Grand Total ({filtered.length} expenses)
            </span>
            <span className="text-sm font-bold font-mono text-accent-expense">
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseDetailReport;
