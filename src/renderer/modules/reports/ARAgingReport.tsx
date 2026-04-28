import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { format, differenceInCalendarDays, parseISO, startOfDay } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';
import { downloadCSVBlob } from '../../lib/csv-export';
import EntityChip from '../../components/EntityChip';
import PrintReportHeader from '../../components/PrintReportHeader';
import PrintReportFooter from '../../components/PrintReportFooter';

// ─── Types ──────────────────────────────────────────────
interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_id: string | null;
  client_name: string;
  total: number;
  amount_paid: number;
  due_date: string;
  issue_date: string;
  status: string;
}

interface AgingEntry {
  id: string;
  invoiceNumber: string;
  clientId: string | null;
  clientName: string;
  amountDue: number;
  daysOutstanding: number;
  bucket: string;
}

interface DrillInvoice {
  invoice_number: string;
  issue_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  days_overdue: number;
}

type BucketKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';

const BUCKET_LABELS: Record<BucketKey, string> = {
  current: 'Current (Not Due)',
  '1-30': '1-30 Days',
  '31-60': '31-60 Days',
  '61-90': '61-90 Days',
  '90+': '90+ Days',
};

const BUCKET_COLORS: Record<BucketKey, string> = {
  current: '#22c55e',
  '1-30': '#3b82f6',
  '31-60': '#f59e0b',
  '61-90': '#f97316',
  '90+': '#ef4444',
};

const BUCKET_BADGE_CLASS: Record<BucketKey, string> = {
  current: 'block-badge block-badge-income',
  '1-30': 'block-badge block-badge-blue',
  '31-60': 'block-badge block-badge-purple',
  '61-90': 'block-badge block-badge-purple',
  '90+': 'block-badge block-badge-expense',
};

function getBucket(days: number): BucketKey {
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

// ─── Component ──────────────────────────────────────────
const ARAgingReport: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AgingEntry[]>([]);
  const [error, setError] = useState('');
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [drillData, setDrillData] = useState<Record<string, DrillInvoice[]>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');

      try {
        const rows: InvoiceRow[] = await api.rawQuery(
          `SELECT i.id, i.invoice_number, i.client_id, i.total, i.amount_paid, i.due_date, i.issue_date, i.status,
                  c.name as client_name
           FROM invoices i
           LEFT JOIN clients c ON i.client_id = c.id
           WHERE i.company_id = ? AND i.status IN ('sent','overdue','partial')`,
          [activeCompany.id]
        );

        if (cancelled) return;

        const today = startOfDay(new Date());
        const mapped: AgingEntry[] = (rows ?? []).map((row) => {
          const amountDue = (Number(row.total) || 0) - (Number(row.amount_paid) || 0);
          const dueDate = row.due_date ? startOfDay(parseISO(row.due_date)) : today;
          const daysOutstanding = differenceInCalendarDays(today, dueDate);
          return {
            id: row.id,
            invoiceNumber: row.invoice_number || row.id,
            clientId: row.client_id || null,
            clientName: row.client_name || 'Unknown',
            amountDue,
            daysOutstanding,
            bucket: getBucket(daysOutstanding),
          };
        });

        mapped.sort((a, b) => b.daysOutstanding - a.daysOutstanding);
        setEntries(mapped);
      } catch (err: any) {
        console.error('Failed to load AR Aging:', err);
        if (!cancelled) setError(err?.message || 'Failed to load AR Aging report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ─── Bucket totals ──────────────────────────────────────
  const bucketTotals = useMemo(() => {
    const totals: Record<BucketKey, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const e of entries) totals[e.bucket as BucketKey] += e.amountDue;
    return totals;
  }, [entries]);

  const grandTotal = useMemo(() => entries.reduce((s, e) => s + e.amountDue, 0), [entries]);

  // ─── Change 36-37: KPI computed values ──────────────────
  const currentAmt = bucketTotals['current'];
  const pastDueAmt = grandTotal - currentAmt;
  const weightedAvgDays = useMemo(() => {
    if (grandTotal === 0) return 0;
    const weightedSum = entries.reduce((s, e) => s + (Math.max(0, e.daysOutstanding) * e.amountDue), 0);
    return Math.round(weightedSum / grandTotal);
  }, [entries, grandTotal]);

  // ─── Client groupings for drill-down ────────────────────
  const clientGroups = useMemo(() => {
    const map = new Map<string, { clientId: string | null; clientName: string; total: number; entries: AgingEntry[] }>();
    for (const e of entries) {
      const key = e.clientId || e.clientName;
      const existing = map.get(key) || { clientId: e.clientId, clientName: e.clientName, total: 0, entries: [] };
      existing.total += e.amountDue;
      existing.entries.push(e);
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [entries]);

  // ─── Change 39: Client drill-down ───────────────────────
  const toggleClient = async (clientKey: string, clientId: string | null) => {
    const next = new Set(expandedClients);
    if (next.has(clientKey)) {
      next.delete(clientKey);
      setExpandedClients(next);
      return;
    }
    next.add(clientKey);
    setExpandedClients(next);

    if (!drillData[clientKey] && clientId) {
      try {
        const rows: any[] = await api.rawQuery(
          `SELECT invoice_number, issue_date, due_date, total, amount_paid, (total - amount_paid) as balance,
            CAST(julianday('now') - julianday(due_date) AS INTEGER) as days_overdue
           FROM invoices WHERE client_id = ? AND status NOT IN ('paid','void','cancelled')
           ORDER BY due_date`,
          [clientId]
        );
        setDrillData(prev => ({ ...prev, [clientKey]: (rows ?? []).map((r: any) => ({
          invoice_number: r.invoice_number || '',
          issue_date: r.issue_date || '',
          due_date: r.due_date || '',
          total: Number(r.total) || 0,
          amount_paid: Number(r.amount_paid) || 0,
          balance: Number(r.balance) || 0,
          days_overdue: Number(r.days_overdue) || 0,
        })) }));
      } catch (err) {
        console.error('Drill-down failed:', err);
      }
    }
  };

  // ─── Change 40: CSV Export ──────────────────────────────
  const handleExportCSV = () => {
    downloadCSVBlob(
      entries.map((e) => ({
        invoice_number: e.invoiceNumber,
        client: e.clientName,
        amount_due: e.amountDue.toFixed(2),
        days_outstanding: e.daysOutstanding,
        bucket: BUCKET_LABELS[e.bucket as BucketKey],
      })),
      `ar-aging-${format(new Date(), 'yyyy-MM-dd')}.csv`
    );
  };

  // ─── Change 40: Enhanced Print ──────────────────────────
  const handlePrint = async () => {
    const escHtml = (s: string | null | undefined): string => {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    const bucketKeys = Object.keys(BUCKET_LABELS) as BucketKey[];
    const agingBarHtml = `<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:16px;">
      ${bucketKeys.map(k => {
        const pct = grandTotal > 0 ? (bucketTotals[k] / grandTotal) * 100 : 0;
        return pct > 0 ? `<div style="width:${pct}%;background:${BUCKET_COLORS[k]};min-width:2px;" title="${BUCKET_LABELS[k]}: ${formatCurrency(bucketTotals[k])}"></div>` : '';
      }).join('')}
    </div>
    <div style="display:flex;gap:12px;margin-bottom:16px;font-size:10px;">
      ${bucketKeys.map(k => `<span><span style="display:inline-block;width:10px;height:10px;background:${BUCKET_COLORS[k]};border-radius:2px;margin-right:4px;"></span>${BUCKET_LABELS[k]}: ${formatCurrency(bucketTotals[k])}</span>`).join('')}
    </div>`;

    const rowsHtml = entries.map(e => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escHtml(e.invoiceNumber)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escHtml(e.clientName)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(e.amountDue)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${e.daysOutstanding}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${BUCKET_LABELS[e.bucket as BucketKey]}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @page { size: letter; margin: 0.5in 0.6in; }
      body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      h1 { font-size: 18px; margin-bottom: 4px; } h2 { font-size: 12px; color: #475569; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #f8fafc; padding: 6px 10px; text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #0f172a; color: #475569; }
      @media print { tr { page-break-inside: avoid; } }
    </style></head><body>
      <h1>A/R Aging Summary</h1>
      <h2>As of ${format(new Date(), 'MMM d, yyyy')} &middot; Total: ${formatCurrency(grandTotal)} &middot; Past Due: ${formatCurrency(pastDueAmt)} &middot; Avg Days: ${weightedAvgDays}</h2>
      ${agingBarHtml}
      <table><thead><tr><th>Invoice</th><th>Client</th><th style="text-align:right">Amount Due</th><th style="text-align:right">Days</th><th>Bucket</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    </body></html>`;
    await api.printPreview(html, 'A/R Aging Summary');
  };

  return (
    <div className="space-y-4">
      <PrintReportHeader title="A/R Aging Summary" periodEnd={new Date()} />
      {error && <ErrorBanner message={error} title="Failed to load AR Aging" onDismiss={() => setError('')} />}

      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between" style={{ borderRadius: '6px' }}>
        <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">
          As of {format(new Date(), 'MMM d, yyyy')}
        </span>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="block-btn flex items-center gap-2 text-xs"><Printer size={14} /> Print</button>
          <button onClick={handleExportCSV} className="block-btn flex items-center gap-2 text-xs"><Download size={14} /> CSV</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : (
        <>
          {/* Change 36-37: KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Receivables', value: formatCurrency(grandTotal), color: 'text-text-primary' },
              { label: 'Current (Not Due)', value: formatCurrency(currentAmt), color: 'text-accent-income' },
              { label: 'Past Due', value: formatCurrency(pastDueAmt), color: 'text-accent-expense' },
              { label: 'Weighted Avg Days', value: `${weightedAvgDays}`, color: 'text-accent-blue' },
            ].map(c => (
              <div key={c.label} className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                <p className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</p>
                <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-1">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Change 38: Aging Distribution Visual */}
          {grandTotal > 0 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Aging Distribution</h3>
              <div className="flex h-6 overflow-hidden" style={{ borderRadius: '6px' }}>
                {(Object.keys(BUCKET_LABELS) as BucketKey[]).map(k => {
                  const pct = (bucketTotals[k] / grandTotal) * 100;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={k}
                      className="h-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: BUCKET_COLORS[k], minWidth: pct > 0 ? '2px' : '0' }}
                      title={`${BUCKET_LABELS[k]}: ${formatCurrency(bucketTotals[k])} (${pct.toFixed(1)}%)`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 mt-2">
                {(Object.keys(BUCKET_LABELS) as BucketKey[]).map(k => (
                  <span key={k} className="flex items-center gap-1.5 text-[10px] text-text-muted">
                    <span className="w-2.5 h-2.5 shrink-0" style={{ backgroundColor: BUCKET_COLORS[k], borderRadius: '2px' }} />
                    {BUCKET_LABELS[k]}: {formatCurrency(bucketTotals[k])}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Grand total */}
          <div className="block-card p-4 flex items-center justify-between report-grand-total-row" style={{ borderRadius: '6px' }}>
            <span className="text-xs font-bold text-text-primary uppercase tracking-wider">Total Outstanding</span>
            <span className="text-lg font-bold font-mono text-accent-expense">{formatCurrency(grandTotal)}</span>
          </div>

          {/* Change 39: Client Drill-down Table */}
          {entries.length === 0 ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <p className="text-sm text-text-secondary font-medium">No outstanding invoices</p>
              <p className="text-xs text-text-muted mt-1">All invoices are fully paid.</p>
            </div>
          ) : (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="text-right">Total Due</th>
                    <th className="text-right">Invoices</th>
                    <th className="text-right">Oldest Days</th>
                    <th>Worst Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {clientGroups.map(group => {
                    const clientKey = group.clientId || group.clientName;
                    const isExpanded = expandedClients.has(clientKey);
                    const worstDays = Math.max(...group.entries.map(e => e.daysOutstanding));
                    const worstBucket = getBucket(worstDays);
                    const drillInvoices = drillData[clientKey] || [];

                    return (
                      <React.Fragment key={clientKey}>
                        <tr
                          className="cursor-pointer hover:bg-bg-hover/30 transition-colors"
                          onClick={() => toggleClient(clientKey, group.clientId)}
                        >
                          <td className="text-text-primary font-medium">
                            <span className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                              {group.clientId ? <EntityChip type="client" id={group.clientId} label={group.clientName} variant="inline" /> : group.clientName}
                            </span>
                          </td>
                          <td className="text-right font-mono text-accent-expense font-bold">{formatCurrency(group.total)}</td>
                          <td className="text-right font-mono text-xs">{group.entries.length}</td>
                          <td className="text-right font-mono text-xs">{worstDays}</td>
                          <td><span className={BUCKET_BADGE_CLASS[worstBucket]}>{BUCKET_LABELS[worstBucket]}</span></td>
                        </tr>
                        {isExpanded && drillInvoices.length > 0 && (
                          <tr>
                            <td colSpan={5} className="p-0">
                              <div className="bg-bg-tertiary/40 border-b border-border-primary/50">
                                <table className="w-full">
                                  <thead>
                                    <tr>
                                      <th className="text-left pl-10 pr-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Invoice</th>
                                      <th className="text-left px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Issue Date</th>
                                      <th className="text-left px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Due Date</th>
                                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total</th>
                                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Paid</th>
                                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Balance</th>
                                      <th className="text-right px-4 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Days Overdue</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {drillInvoices.map((inv, idx) => (
                                      <tr key={idx} className="border-t border-border-primary/30">
                                        <td className="pl-10 pr-4 py-1.5 text-xs text-text-primary font-mono">{inv.invoice_number || '--'}</td>
                                        <td className="px-4 py-1.5 text-xs text-text-secondary">{inv.issue_date ? formatDate(inv.issue_date) : '--'}</td>
                                        <td className="px-4 py-1.5 text-xs text-text-secondary">{inv.due_date ? formatDate(inv.due_date) : '--'}</td>
                                        <td className="px-4 py-1.5 text-xs text-text-primary font-mono text-right">{formatCurrency(inv.total)}</td>
                                        <td className="px-4 py-1.5 text-xs text-text-muted font-mono text-right">{formatCurrency(inv.amount_paid)}</td>
                                        <td className="px-4 py-1.5 text-xs text-accent-expense font-mono text-right font-bold">{formatCurrency(inv.balance)}</td>
                                        <td className={`px-4 py-1.5 text-xs font-mono text-right ${inv.days_overdue > 90 ? 'text-accent-expense font-bold' : 'text-text-secondary'}`}>{inv.days_overdue}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                        {isExpanded && drillInvoices.length === 0 && group.clientId && (
                          <tr>
                            <td colSpan={5} className="pl-10 py-2 text-xs text-text-muted">Loading invoices...</td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <PrintReportFooter />
    </div>
  );
};

export default ARAgingReport;
