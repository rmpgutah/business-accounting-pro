import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

/**
 * Presentational table primitives for the glass/block theme.
 * Every component renders with zero props using believable mock data.
 */

const cellBorder = '1px solid var(--color-border-primary, #2a2a2a)';

// ---------------------------------------------------------------------------
// DataTableLite — simple striped table
// ---------------------------------------------------------------------------

export interface DataTableLiteColumn {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
}

export interface DataTableLiteProps {
  columns?: DataTableLiteColumn[];
  rows?: Array<Record<string, string | number>>;
  caption?: string;
  className?: string;
}

export function DataTableLite({
  columns = [
    { key: 'date', header: 'Date' },
    { key: 'description', header: 'Description' },
    { key: 'category', header: 'Category' },
    { key: 'amount', header: 'Amount', align: 'right' },
  ],
  rows = [
    { date: '2026-05-02', description: 'Office Supplies', category: 'Operating', amount: '$248.10' },
    { date: '2026-05-08', description: 'Cloud Hosting', category: 'Software', amount: '$1,200.00' },
    { date: '2026-05-14', description: 'Client Lunch', category: 'Meals', amount: '$86.45' },
    { date: '2026-05-21', description: 'Quarterly Filing', category: 'Tax', amount: '$540.00' },
    { date: '2026-05-29', description: 'Marketing Ads', category: 'Marketing', amount: '$2,310.75' },
  ],
  caption,
  className,
}: DataTableLiteProps) {
  return (
    <div className={className}>
      {caption && (
        <div className="text-xs text-text-muted" style={{ marginBottom: 6 }}>
          {caption}
        </div>
      )}
      <table className="block-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-text-secondary text-xs uppercase tracking-wide"
                style={{
                  textAlign: c.align ?? 'left',
                  padding: '8px 12px',
                  borderBottom: cellBorder,
                  fontWeight: 600,
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              style={{
                backgroundColor:
                  i % 2 === 1 ? 'var(--color-bg-secondary, #1c1c1c)' : 'transparent',
              }}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="text-text-primary text-sm"
                  style={{
                    textAlign: c.align ?? 'left',
                    padding: '8px 12px',
                    borderBottom: cellBorder,
                    fontVariantNumeric: c.align === 'right' ? 'tabular-nums' : undefined,
                  }}
                >
                  {row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DefinitionGrid — label/value grid
// ---------------------------------------------------------------------------

export interface DefinitionGridItem {
  label: string;
  value: string | number;
}

export interface DefinitionGridProps {
  items?: DefinitionGridItem[];
  columns?: number;
  title?: string;
  className?: string;
}

export function DefinitionGrid({
  items = [
    { label: 'Legal Name', value: 'Acme Holdings LLC' },
    { label: 'EIN', value: '47-1029384' },
    { label: 'Entity Type', value: 'S-Corporation' },
    { label: 'Fiscal Year End', value: 'Dec 31' },
    { label: 'State', value: 'Utah' },
    { label: 'Status', value: 'Active' },
  ],
  columns = 2,
  title,
  className,
}: DefinitionGridProps) {
  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16, borderRadius: 6 }}>
      {title && (
        <div
          className="text-sm text-text-primary"
          style={{ fontWeight: 600, marginBottom: 12 }}
        >
          {title}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        {items.map((it, i) => (
          <div key={i}>
            <div className="text-xs text-text-muted" style={{ marginBottom: 2 }}>
              {it.label}
            </div>
            <div className="text-sm text-text-primary" style={{ fontWeight: 500 }}>
              {it.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KeyValueRow — one key/value row
// ---------------------------------------------------------------------------

export interface KeyValueRowProps {
  label?: string;
  value?: string | number;
  mono?: boolean;
  emphasize?: boolean;
  divider?: boolean;
  className?: string;
}

export function KeyValueRow({
  label = 'Subtotal',
  value = '$12,480.00',
  mono = true,
  emphasize = false,
  divider = true,
  className,
}: KeyValueRowProps) {
  return (
    <div
      className={`flex items-center justify-between ${className ?? ''}`}
      style={{
        padding: '8px 0',
        borderBottom: divider ? cellBorder : 'none',
      }}
    >
      <span
        className={emphasize ? 'text-text-primary' : 'text-text-secondary'}
        style={{ fontSize: 13, fontWeight: emphasize ? 600 : 400 }}
      >
        {label}
      </span>
      <span
        className="text-text-primary"
        style={{
          fontSize: 13,
          fontWeight: emphasize ? 700 : 500,
          fontFamily: mono ? 'var(--font-mono, ui-monospace, monospace)' : undefined,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LedgerRow — debit/credit ledger row
// ---------------------------------------------------------------------------

export interface LedgerRowProps {
  account?: string;
  memo?: string;
  debit?: number | null;
  credit?: number | null;
  date?: string;
  className?: string;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function LedgerRow({
  account = '1010 · Cash — Operating',
  memo = 'Client deposit',
  debit = 4500,
  credit = null,
  date = '2026-05-31',
  className,
}: LedgerRowProps) {
  const debitColor = 'var(--color-accent-green, #22c55e)';
  const creditColor = 'var(--color-accent-red, #ef4444)';
  return (
    <div
      className={`flex items-center ${className ?? ''}`}
      style={{
        padding: '8px 12px',
        borderBottom: cellBorder,
        gap: 12,
      }}
    >
      <span
        className="text-text-muted text-xs"
        style={{ width: 84, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
      >
        {date}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="text-text-primary text-sm truncate" style={{ fontWeight: 500 }}>
          {account}
        </div>
        {memo && <div className="text-text-muted text-xs truncate">{memo}</div>}
      </div>
      <span
        style={{
          width: 110,
          textAlign: 'right',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          color: debit != null ? debitColor : 'var(--color-text-muted, #6b7280)',
        }}
      >
        {debit != null ? fmtMoney(debit) : '—'}
      </span>
      <span
        style={{
          width: 110,
          textAlign: 'right',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          color: credit != null ? creditColor : 'var(--color-text-muted, #6b7280)',
        }}
      >
        {credit != null ? fmtMoney(credit) : '—'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComparisonTable — two-column compare table
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  label: string;
  current: string | number;
  prior: string | number;
  /** Optional trend hint; if omitted it's inferred from numeric values. */
  trend?: 'up' | 'down' | 'flat';
}

export interface ComparisonTableProps {
  currentLabel?: string;
  priorLabel?: string;
  rows?: ComparisonRow[];
  title?: string;
  className?: string;
}

function parseNum(v: string | number): number {
  if (typeof v === 'number') return v;
  const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

export function ComparisonTable({
  currentLabel = 'This Quarter',
  priorLabel = 'Last Quarter',
  rows = [
    { label: 'Revenue', current: '$184,200', prior: '$162,800' },
    { label: 'Expenses', current: '$121,440', prior: '$118,900' },
    { label: 'Net Income', current: '$62,760', prior: '$43,900' },
    { label: 'Margin', current: '34.1%', prior: '26.9%' },
    { label: 'Headcount', current: 14, prior: 14 },
  ],
  title,
  className,
}: ComparisonTableProps) {
  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16, borderRadius: 6 }}>
      {title && (
        <div
          className="text-sm text-text-primary"
          style={{ fontWeight: 600, marginBottom: 12 }}
        >
          {title}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th
              className="text-text-muted text-xs uppercase tracking-wide"
              style={{ textAlign: 'left', padding: '6px 8px', borderBottom: cellBorder, fontWeight: 600 }}
            >
              Metric
            </th>
            <th
              className="text-text-secondary text-xs uppercase tracking-wide"
              style={{ textAlign: 'right', padding: '6px 8px', borderBottom: cellBorder, fontWeight: 600 }}
            >
              {currentLabel}
            </th>
            <th
              className="text-text-muted text-xs uppercase tracking-wide"
              style={{ textAlign: 'right', padding: '6px 8px', borderBottom: cellBorder, fontWeight: 600 }}
            >
              {priorLabel}
            </th>
            <th style={{ width: 28, borderBottom: cellBorder }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const trend =
              r.trend ??
              (parseNum(r.current) > parseNum(r.prior)
                ? 'up'
                : parseNum(r.current) < parseNum(r.prior)
                ? 'down'
                : 'flat');
            const trendColor =
              trend === 'up'
                ? 'var(--color-accent-green, #22c55e)'
                : trend === 'down'
                ? 'var(--color-accent-red, #ef4444)'
                : 'var(--color-text-muted, #6b7280)';
            const TrendIcon = trend === 'up' ? ArrowUp : trend === 'down' ? ArrowDown : Minus;
            return (
              <tr key={i}>
                <td
                  className="text-text-secondary text-sm"
                  style={{ padding: '8px', borderBottom: cellBorder }}
                >
                  {r.label}
                </td>
                <td
                  className="text-text-primary text-sm"
                  style={{
                    padding: '8px',
                    textAlign: 'right',
                    borderBottom: cellBorder,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {r.current}
                </td>
                <td
                  className="text-text-muted text-sm"
                  style={{
                    padding: '8px',
                    textAlign: 'right',
                    borderBottom: cellBorder,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {r.prior}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'center', borderBottom: cellBorder }}>
                  <TrendIcon size={14} style={{ color: trendColor, display: 'inline' }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
