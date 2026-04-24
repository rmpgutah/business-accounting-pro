import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { FileCheck, Plus, Search, Filter, Trash2, Copy, ArrowRightCircle } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { SummaryBar } from '../../components/SummaryBar';
import { formatCurrency, formatStatus, formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface Quote {
  id: string;
  quote_number: string;
  client_id?: string;
  client_name?: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
  issue_date: string;
  valid_until?: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  notes?: string;
  converted_invoice_id?: string;
}

interface QuoteListProps {
  onNew: () => void;
  onEdit: (id: string) => void;
}

// ─── Component ──────────────────────────────────────────
const QuoteList: React.FC<QuoteListProps> = ({ onNew, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const raw = await api.rawQuery(
          `SELECT q.*, c.name as client_name
           FROM quotes q
           LEFT JOIN clients c ON c.id = q.client_id
           WHERE q.company_id = ?
           ORDER BY q.created_at DESC`,
          [activeCompany.id]
        );
        if (cancelled) return;
        setQuotes(Array.isArray(raw) ? raw : []);
      } catch (err) {
        console.error('Failed to load quotes:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const filtered = useMemo(() => {
    return quotes.filter((q) => {
      if (search) {
        const s = search.toLowerCase();
        const match =
          q.quote_number?.toLowerCase().includes(s) ||
          q.client_name?.toLowerCase().includes(s) ||
          q.notes?.toLowerCase().includes(s);
        if (!match) return false;
      }
      if (statusFilter && q.status !== statusFilter) return false;
      return true;
    });
  }, [quotes, search, statusFilter]);

  const total = useMemo(
    () => filtered.reduce((sum, q) => sum + (q.total || 0), 0),
    [filtered]
  );

  // ─── Summary stats ────────────────────────────────────
  const summaryStats = useMemo(() => {
    const draftCount = quotes.filter((q) => q.status === 'draft').length;
    const sentTotal = quotes
      .filter((q) => q.status === 'sent')
      .reduce((s, q) => s + (q.total || 0), 0);
    const acceptedTotal = quotes
      .filter((q) => q.status === 'accepted')
      .reduce((s, q) => s + (q.total || 0), 0);
    const convertedCount = quotes.filter((q) => q.status === 'converted').length;
    return { draftCount, sentTotal, acceptedTotal, convertedCount };
  }, [quotes]);

  // ─── Selection ────────────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every((q) => selectedIds.has(q.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((q) => q.id)));
  }, [allSelected, filtered]);

  useEffect(() => { setSelectedIds(new Set()); }, [search, statusFilter]);

  // ─── Actions ──────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const raw = await api.rawQuery(
      `SELECT q.*, c.name as client_name
       FROM quotes q
       LEFT JOIN clients c ON c.id = q.client_id
       WHERE q.company_id = ?
       ORDER BY q.created_at DESC`,
      [activeCompany.id]
    );
    setQuotes(Array.isArray(raw) ? raw : []);
    setSelectedIds(new Set());
  }, [activeCompany]);

  const handleBatchDelete = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchDelete('quotes', Array.from(selectedIds));
      await reload();
    } catch (err) {
      console.error('Batch delete failed:', err);
    } finally {
      setBatchLoading(false);
      setShowDeleteConfirm(false);
    }
  }, [selectedIds, reload]);

  const handleDuplicate = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const result = await api.cloneRecord('quotes', id);
      if (result?.error) {
        console.error('Duplicate quote failed:', result.error);
        return;
      }
      await reload();
    },
    [reload]
  );

  const handleConvert = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await api.quotesConvertToInvoice(id);
        await reload();
      } catch (err) {
        console.error('Convert to invoice failed:', err);
      }
    },
    [reload]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading quotes...
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ paddingBottom: someSelected ? '80px' : undefined }}>
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <FileCheck size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Quotes & Estimates</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} quote{filtered.length !== 1 ? 's' : ''} &middot;{' '}
              {formatCurrency(total)} total
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
          <Plus size={16} />
          New Quote
        </button>
      </div>

      {/* Summary Bar */}
      <SummaryBar
        items={[
          { label: 'Drafts', value: String(summaryStats.draftCount) },
          {
            label: 'Awaiting Response',
            value: formatCurrency(summaryStats.sentTotal),
            accent: 'orange',
          },
          {
            label: 'Accepted',
            value: formatCurrency(summaryStats.acceptedTotal),
            accent: 'green',
          },
          { label: 'Converted', value: String(summaryStats.convertedCount) },
        ]}
      />

      {/* Filters */}
      <div className="block-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search quotes..."
              className="block-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-text-muted" />
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '140px' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
              <option value="converted">Converted</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={FileCheck} message="No quotes found" />
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                    style={{ accentColor: '#3b82f6' }}
                  />
                </th>
                <th>Quote #</th>
                <th>Client</th>
                <th>Issue Date</th>
                <th>Valid Until</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th style={{ width: '110px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => {
                const isSelected = selectedIds.has(q.id);
                return (
                  <tr
                    key={q.id}
                    className={`cursor-pointer ${isSelected ? 'bg-accent-blue/5' : ''}`}
                    onClick={() => onEdit(q.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(q.id)}
                        className="cursor-pointer"
                        style={{ accentColor: '#3b82f6' }}
                      />
                    </td>
                    <td className="font-mono text-text-primary text-xs font-semibold">
                      {q.quote_number}
                    </td>
                    <td className="text-text-secondary">{q.client_name || '-'}</td>
                    <td className="font-mono text-text-secondary text-xs">
                      {formatDate(q.issue_date)}
                    </td>
                    <td className="font-mono text-text-secondary text-xs">
                      {q.valid_until ? formatDate(q.valid_until) : '-'}
                    </td>
                    <td className="text-right font-mono text-text-primary font-semibold">
                      {formatCurrency(q.total)}
                    </td>
                    <td>
                      <span className={formatStatus(q.status).className}>
                        {formatStatus(q.status).label}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleDuplicate(q.id, e)}
                          className="flex items-center gap-1 px-2 py-1 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue"
                          title="Duplicate"
                          style={{ borderRadius: '6px' }}
                        >
                          <Copy size={12} />
                        </button>
                        {(q.status === 'accepted' || q.status === 'sent') && (
                          <button
                            onClick={(e) => handleConvert(q.id, e)}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase"
                            title="Convert to Invoice"
                            style={{
                              borderRadius: '6px',
                              background: 'rgba(59,130,246,0.12)',
                              border: '1px solid rgba(59,130,246,0.25)',
                              color: '#3b82f6',
                            }}
                          >
                            <ArrowRightCircle size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td
                  colSpan={4}
                  className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider"
                >
                  Total
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {formatCurrency(total)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ─── Floating Batch Action Bar ─────────────────────── */}
      {someSelected && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 border border-border-primary shadow-lg"
          style={{
            background: 'rgba(18,20,28,0.80)',
            borderRadius: '6px',
            minWidth: '320px',
          }}
        >
          <span className="text-xs font-semibold text-text-muted mr-2">
            {selectedIds.size} of {filtered.length} selected
          </span>

          {!showDeleteConfirm ? (
            <button
              className="flex items-center gap-1.5 text-xs font-semibold"
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                background: 'transparent',
                border: '1px solid #ef4444',
                color: '#ef4444',
                borderRadius: '6px',
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-accent-expense font-semibold">Confirm?</span>
              <button
                className="text-xs font-semibold"
                onClick={handleBatchDelete}
                disabled={batchLoading}
                style={{
                  background: 'var(--color-accent-expense)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  cursor: 'pointer',
                }}
              >
                Yes, Delete
              </button>
              <button
                className="text-xs font-semibold text-text-muted"
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuoteList;
