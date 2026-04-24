import React, { useEffect, useState, useMemo } from 'react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { Printer, Download } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { downloadCSVBlob } from '../../lib/csv-export';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';


// ─── Types ──────────────────────────────────────────────
interface BillRow {
  id: string;
  bill_number: string;
  vendor_name: string;
  total: number;
  amount_paid: number;
  due_date: string;
  status: string;
}

interface AgingEntry {
  id: string;
  billNumber: string;
  vendorName: string;
  amountDue: number;
  daysOutstanding: number;
  bucket: BucketKey;
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
const APAgingReport: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AgingEntry[]>([]);
  const [bucketFilter, setBucketFilter] = useState<BucketKey | 'all'>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');

      try {
        const rows: BillRow[] = await api.rawQuery(
          `SELECT b.id, b.bill_number, b.total, b.amount_paid, b.due_date, b.status,
                  v.name AS vendor_name
           FROM bills b
           LEFT JOIN vendors v ON b.vendor_id = v.id
           WHERE b.company_id = ? AND b.status IN ('pending','approved','partial','overdue')`,
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
            billNumber: row.bill_number || row.id,
            vendorName: row.vendor_name || 'Unknown Vendor',
            amountDue,
            daysOutstanding,
            bucket: getBucket(daysOutstanding),
          };
        });

        mapped.sort((a, b) => b.daysOutstanding - a.daysOutstanding);
        setEntries(mapped);
      } catch (err: any) {
        console.error('Failed to load AP Aging:', err);
        if (!cancelled) setError(err?.message || 'Failed to load AP Aging report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ─── Bucket totals ─────────────────────────────────────
  const bucketTotals = useMemo(() => {
    const totals: Record<BucketKey, number> = { current: 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const e of entries) totals[e.bucket] += e.amountDue;
    return totals;
  }, [entries]);

  const grandTotal = useMemo(() => entries.reduce((s, e) => s + e.amountDue, 0), [entries]);

  const filtered = useMemo(() =>
    bucketFilter === 'all' ? entries : entries.filter((e) => e.bucket === bucketFilter),
    [entries, bucketFilter]
  );

  const handleExport = () => {
    downloadCSVBlob(
      entries.map((e) => ({
        bill_number: e.billNumber,
        vendor: e.vendorName,
        amount_due: e.amountDue.toFixed(2),
        days_outstanding: e.daysOutstanding,
        bucket: BUCKET_LABELS[e.bucket],
      })),
      `ap-aging-${format(new Date(), 'yyyy-MM-dd')}.csv`
    );
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load AP Aging" onDismiss={() => setError('')} />}
      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between" style={{ borderRadius: '6px' }}>
        <span className="text-xs text-text-muted font-semibold uppercase tracking-wider">
          As of {format(new Date(), 'MMM d, yyyy')}
        </span>
        <div className="flex gap-2">
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Export CSV"
            onClick={handleExport}
          >
            <Download size={15} />
          </button>
          <button
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Print"
            onClick={() => window.print()}
          >
            <Printer size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Generating report...
        </div>
      ) : (
        <>
          {/* Summary bucket cards — clickable to filter */}
          <div className="grid grid-cols-4 gap-3">
            {(Object.keys(BUCKET_LABELS) as BucketKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setBucketFilter(bucketFilter === key ? 'all' : key)}
                className={`block-card p-4 text-center transition-colors ${bucketFilter === key ? 'border-accent-blue' : ''}`}
                style={{ borderRadius: '6px' }}
              >
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  {BUCKET_LABELS[key]}
                </p>
                <p className="text-lg font-bold font-mono text-text-primary">
                  {formatCurrency(bucketTotals[key])}
                </p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  {entries.filter((e) => e.bucket === key).length} bill
                  {entries.filter((e) => e.bucket === key).length !== 1 ? 's' : ''}
                </p>
              </button>
            ))}
          </div>

          {/* Grand total */}
          <div
            className="block-card p-4 flex items-center justify-between"
            style={{ borderRadius: '6px' }}
          >
            <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
              Total Outstanding Payables
            </span>
            <span className="text-lg font-bold font-mono text-accent-expense">
              {formatCurrency(grandTotal)}
            </span>
          </div>

          {/* Detail table */}
          {filtered.length === 0 ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <p className="text-sm text-text-secondary font-medium">No outstanding bills</p>
              <p className="text-xs text-text-muted mt-1">All bills are fully paid.</p>
            </div>
          ) : (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Bill #</th>
                    <th>Vendor</th>
                    <th className="text-right">Amount Due</th>
                    <th className="text-right">Days Outstanding</th>
                    <th>Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr key={entry.id}>
                      <td className="text-text-primary font-medium font-mono">
                        {entry.billNumber}
                      </td>
                      <td className="text-text-secondary">{entry.vendorName}</td>
                      <td className="text-right font-mono text-accent-expense">
                        {formatCurrency(entry.amountDue)}
                      </td>
                      <td className="text-right font-mono text-text-secondary">
                        {entry.daysOutstanding}
                      </td>
                      <td>
                        <span className={BUCKET_BADGE_CLASS[entry.bucket]}>
                          {BUCKET_LABELS[entry.bucket]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)' }}>
                    <td colSpan={2} className="text-right py-2 text-xs font-bold text-text-primary uppercase tracking-wider">
                      {bucketFilter === 'all' ? 'Total' : `${BUCKET_LABELS[bucketFilter]} Total`}
                    </td>
                    <td className="text-right font-mono font-bold text-accent-expense">
                      {formatCurrency(filtered.reduce((s, e) => s + e.amountDue, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default APAgingReport;
