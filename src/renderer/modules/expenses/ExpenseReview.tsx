import React, { useCallback, useEffect, useState } from 'react';
import { Paperclip, FolderOpen, CheckCircle2, Tag } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import DuplicatesSection from './review/DuplicatesSection';
import StalePendingSection from './review/StalePendingSection';
import AnomaliesSection from './review/AnomaliesSection';
import SubscriptionsSection from './review/SubscriptionsSection';

interface Props {
  onViewExpense?: (id: string) => void;
  onCountsChange?: (total: number) => void;
}

interface MissingReceiptRow {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  vendor_name: string | null;
}

interface UncategorizedRow {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  vendor_id: string | null;
}

const RECEIPT_THRESHOLD = 25;

const SectionCard: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) => (
  <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
    <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{title}</div>
      <span className="text-xs font-mono font-bold text-text-primary">{count}</span>
    </div>
    {children}
  </div>
);

const EmptyRow: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center justify-center gap-2 py-5 text-xs text-text-muted">
    <CheckCircle2 size={14} className="text-accent-income" /> {label}
  </div>
);

const CHILD_KEYS = ['dups', 'anom', 'subs', 'stale'] as const;

const ExpenseReview: React.FC<Props> = ({ onViewExpense, onCountsChange }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState<MissingReceiptRow[]>([]);
  const [uncategorized, setUncategorized] = useState<UncategorizedRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [childCounts, setChildCounts] = useState<Record<string, number>>({});
  const setChildCount = useCallback((key: string, n: number) => {
    setChildCounts((c) => (c[key] === n ? c : { ...c, [key]: n }));
  }, []);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const [miss, uncat, cats] = await Promise.all([
        api.exMissingReceipts(RECEIPT_THRESHOLD).catch(() => []),
        api.exUncategorized().catch(() => []),
        api.query('categories', { company_id: activeCompany.id, type: 'expense' }).catch(() => []),
      ]);
      setMissing(Array.isArray(miss) ? miss.filter((r: any) => r.status !== 'void') : []);
      setUncategorized(Array.isArray(uncat) ? uncat : []);
      setCategories(Array.isArray(cats) ? cats : []);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => { reload(); }, [reload]);

  const childTotal = Object.values(childCounts).reduce((s, n) => s + n, 0);
  const total = missing.length + uncategorized.length + childTotal;
  const childrenReady = CHILD_KEYS.every((k) => childCounts[k] !== undefined);

  useEffect(() => {
    onCountsChange?.(total);
  }, [missing.length, uncategorized.length, childTotal, onCountsChange]);

  const attachReceipt = useCallback(async (expenseId: string) => {
    const res: any = await api.openFileDialog({
      filters: [{ name: 'Receipts', extensions: ['png', 'jpg', 'jpeg', 'pdf', 'heic', 'webp'] }],
    });
    if (!res?.path) return;
    setBusyId(expenseId);
    try {
      await api.update('expenses', expenseId, { receipt_path: res.path });
      setMissing((rows) => rows.filter((r) => r.id !== expenseId));
    } finally {
      setBusyId(null);
    }
  }, []);

  const setCategory = useCallback(async (expenseId: string, categoryId: string) => {
    if (!categoryId) return;
    setBusyId(expenseId);
    try {
      await api.update('expenses', expenseId, { category_id: categoryId });
      setUncategorized((rows) => rows.filter((r) => r.id !== expenseId));
    } finally {
      setBusyId(null);
    }
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading review queue...</div>;
  }

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Open Items</div>
          <div className={`text-xl font-mono font-bold mt-1 ${total > 0 ? 'text-accent-warning' : 'text-accent-income'}`}>{total}</div>
        </div>
        <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Missing Receipts (≥{formatCurrency(RECEIPT_THRESHOLD)})</div>
          <div className="text-xl font-mono font-bold text-text-primary mt-1">{missing.length}</div>
        </div>
        <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Uncategorized</div>
          <div className="text-xl font-mono font-bold text-text-primary mt-1">{uncategorized.length}</div>
        </div>
      </div>

      {childrenReady && !loading && total === 0 && (
        <div className="block-card p-8 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
          <CheckCircle2 size={28} className="text-accent-income mx-auto mb-2" />
          <div className="text-sm font-semibold text-text-primary">All clear</div>
          <div className="text-xs text-text-muted mt-1">No expenses need attention right now.</div>
        </div>
      )}

      {/* Missing receipts queue */}
      <SectionCard title="Missing Receipts" count={missing.length}>
        {missing.length === 0 ? (
          <EmptyRow label="Every expense over the threshold has a receipt." />
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th><th>Description</th><th>Vendor</th>
                <th className="text-right">Amount</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {missing.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(e.date)}</td>
                  <td className="text-text-primary text-xs truncate max-w-[220px]">{e.description || '(no description)'}</td>
                  <td className="text-text-secondary text-xs truncate max-w-[140px]">{e.vendor_name || '-'}</td>
                  <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(e.amount)}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="block-btn flex items-center gap-1 text-xs"
                        disabled={busyId === e.id}
                        onClick={() => attachReceipt(e.id)}
                      >
                        <Paperclip size={12} /> Attach
                      </button>
                      {onViewExpense && (
                        <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(e.id)}>
                          <FolderOpen size={12} /> Open
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Uncategorized queue */}
      <SectionCard title="Uncategorized Expenses" count={uncategorized.length}>
        {uncategorized.length === 0 ? (
          <EmptyRow label="Every expense has a category." />
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th><th>Description</th>
                <th className="text-right">Amount</th><th>Assign Category</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {uncategorized.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(e.date)}</td>
                  <td className="text-text-primary text-xs truncate max-w-[260px]">{e.description || '(no description)'}</td>
                  <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(e.amount)}</td>
                  <td>
                    <select
                      className="block-input text-xs py-1"
                      defaultValue=""
                      disabled={busyId === e.id}
                      onChange={(ev) => setCategory(e.id, ev.target.value)}
                    >
                      <option value="" disabled>Pick category…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="text-right">
                    {onViewExpense && (
                      <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(e.id)}>
                        <Tag size={12} /> Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Duplicate / anomaly / subscription / stale-pending queues */}
      <DuplicatesSection onCount={(n) => setChildCount('dups', n)} onViewExpense={onViewExpense} />
      <AnomaliesSection onCount={(n) => setChildCount('anom', n)} onViewExpense={onViewExpense} />
      <SubscriptionsSection onCount={(n) => setChildCount('subs', n)} />
      <StalePendingSection onCount={(n) => setChildCount('stale', n)} onViewExpense={onViewExpense} />
    </div>
  );
};

export default ExpenseReview;
