import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Types ──────────────────────────────────────────────
interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_name: string;
  total: number;
  amount_paid: number;
  due_date: string;
  status: string;
}

interface AgingEntry {
  id: string;
  invoiceNumber: string;
  clientName: string;
  amountDue: number;
  daysOutstanding: number;
  bucket: string;
}

type BucketKey = 'current' | '31-60' | '61-90' | '90+';

const BUCKET_LABELS: Record<BucketKey, string> = {
  current: 'Current (0-30)',
  '31-60': '31-60 Days',
  '61-90': '61-90 Days',
  '90+': '90+ Days',
};

const BUCKET_BADGE_CLASS: Record<BucketKey, string> = {
  current: 'block-badge block-badge-income',
  '31-60': 'block-badge block-badge-blue',
  '61-90': 'block-badge block-badge-purple',
  '90+': 'block-badge block-badge-expense',
};

function getBucket(days: number): BucketKey {
  if (days <= 30) return 'current';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

// ─── Component ──────────────────────────────────────────
const ARAgingReport: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AgingEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);

      try {
        const rows: InvoiceRow[] = await api.rawQuery(
          `SELECT i.id, i.invoice_number, i.total, i.amount_paid, i.due_date, i.status,
                  c.name as client_name
           FROM invoices i
           LEFT JOIN clients c ON i.client_id = c.id
           WHERE i.company_id = ? AND i.status IN ('sent','overdue','partial')`,
          [activeCompany.id]
        );

        if (cancelled) return;

        const today = new Date();
        const mapped: AgingEntry[] = (rows ?? []).map((row) => {
          const amountDue = (Number(row.total) || 0) - (Number(row.amount_paid) || 0);
          const dueDate = row.due_date ? parseISO(row.due_date) : today;
          const daysOutstanding = Math.max(0, differenceInDays(today, dueDate));
          return {
            id: row.id,
            invoiceNumber: row.invoice_number || row.id,
            clientName: row.client_name || 'Unknown',
            amountDue,
            daysOutstanding,
            bucket: getBucket(daysOutstanding),
          };
        });

        // Sort by days outstanding descending
        mapped.sort((a, b) => b.daysOutstanding - a.daysOutstanding);
        setEntries(mapped);
      } catch (err) {
        console.error('Failed to load AR Aging:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany]);

  // ─── Bucket totals ──────────────────────────────────────
  const bucketTotals = useMemo(() => {
    const totals: Record<BucketKey, number> = {
      current: 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };
    for (const e of entries) {
      totals[e.bucket as BucketKey] += e.amountDue;
    }
    return totals;
  }, [entries]);

  const grandTotal = useMemo(
    () => entries.reduce((s, e) => s + e.amountDue, 0),
    [entries]
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div
        className="block-card p-4 flex items-center justify-between"
        style={{ borderRadius: '2px' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">
            As of {format(new Date(), 'MMM d, yyyy')}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
            title="Print"
          >
            <Printer size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
            title="Export"
          >
            <Download size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Generating report...
        </div>
      ) : (
        <>
          {/* Summary buckets */}
          <div className="grid grid-cols-4 gap-3">
            {(Object.keys(BUCKET_LABELS) as BucketKey[]).map((key) => (
              <div
                key={key}
                className="block-card p-4 text-center"
                style={{ borderRadius: '2px' }}
              >
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  {BUCKET_LABELS[key]}
                </p>
                <p className="text-lg font-bold font-mono text-text-primary">
                  {fmt.format(bucketTotals[key])}
                </p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  {entries.filter((e) => e.bucket === key).length} invoice
                  {entries.filter((e) => e.bucket === key).length !== 1 ? 's' : ''}
                </p>
              </div>
            ))}
          </div>

          {/* Grand total */}
          <div
            className="block-card p-4 flex items-center justify-between"
            style={{ borderRadius: '2px' }}
          >
            <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
              Total Outstanding
            </span>
            <span className="text-lg font-bold font-mono text-accent-expense">
              {fmt.format(grandTotal)}
            </span>
          </div>

          {/* Detail table */}
          {entries.length === 0 ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '2px' }}>
              <p className="text-sm text-text-secondary font-medium">
                No outstanding invoices
              </p>
              <p className="text-xs text-text-muted mt-1">
                All invoices are fully paid.
              </p>
            </div>
          ) : (
            <div
              className="block-card p-0 overflow-hidden"
              style={{ borderRadius: '2px' }}
            >
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Client</th>
                    <th className="text-right">Amount Due</th>
                    <th className="text-right">Days Outstanding</th>
                    <th>Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="text-text-primary font-medium font-mono">
                        #{entry.invoiceNumber}
                      </td>
                      <td className="text-text-secondary">{entry.clientName}</td>
                      <td className="text-right font-mono text-text-primary">
                        {fmt.format(entry.amountDue)}
                      </td>
                      <td className="text-right font-mono text-text-secondary">
                        {entry.daysOutstanding}
                      </td>
                      <td>
                        <span className={BUCKET_BADGE_CLASS[entry.bucket as BucketKey]}>
                          {BUCKET_LABELS[entry.bucket as BucketKey]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ARAgingReport;
