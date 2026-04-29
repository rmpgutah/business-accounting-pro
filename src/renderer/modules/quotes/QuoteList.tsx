import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  FileCheck,
  Plus,
  Search,
  Filter,
  Trash2,
  Copy,
  ArrowRightCircle,
  Eye,
  Download,
  Printer,
  Send,
  Tag as TagIcon,
  Calendar,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { SummaryBar } from '../../components/SummaryBar';
import { formatCurrency, formatStatus, formatDate } from '../../lib/format';
import EntityChip from '../../components/EntityChip';

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
  // Enhanced fields
  probability?: number;
  expected_close_date?: string;
  sales_rep_id?: string;
  currency?: string;
  tags?: string;
  follow_up_date?: string;
  sent_date?: string;
  won_date?: string;
  updated_at?: string;
  created_at?: string;
}

interface QuoteListProps {
  onNew: () => void;
  onEdit: (id: string) => void;
  onView?: (id: string) => void;
}

type SortKey =
  | 'quote_number'
  | 'client_name'
  | 'issue_date'
  | 'total'
  | 'status'
  | 'probability'
  | 'days_since_sent';

// ─── Component ──────────────────────────────────────────
const QuoteList: React.FC<QuoteListProps> = ({ onNew, onEdit, onView }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [salesReps, setSalesReps] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [salesRepFilter, setSalesRepFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [probMin, setProbMin] = useState<string>('');
  const [probMax, setProbMax] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [followUpDue, setFollowUpDue] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('issue_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [bulkTagValue, setBulkTagValue] = useState('');
  const [loadError, setLoadError] = useState('');

  // ─── Load quotes + sales reps ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoadError('');
        const [raw, users] = await Promise.all([
          api.rawQuery(
            `SELECT q.*, c.name as client_name
             FROM quotes q
             LEFT JOIN clients c ON c.id = q.client_id
             WHERE q.company_id = ?
             ORDER BY q.created_at DESC`,
            [activeCompany.id]
          ),
          api.listUsers().catch(() => []),
        ]);
        if (cancelled) return;
        setQuotes(Array.isArray(raw) ? raw : []);
        setSalesReps(
          Array.isArray(users) ? users.map((u: any) => ({ id: u.id, name: u.name || u.email || u.id })) : []
        );
      } catch (err: any) {
        console.error('Failed to load quotes:', err);
        if (!cancelled) setLoadError(err?.message || 'Failed to load quotes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany]);

  // ─── Unique client list for filter ────────────────────
  const uniqueClients = useMemo(() => {
    const map = new Map<string, string>();
    quotes.forEach((q) => {
      if (q.client_id && q.client_name) map.set(q.client_id, q.client_name);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [quotes]);

  const uniqueCurrencies = useMemo(() => {
    const set = new Set<string>();
    quotes.forEach((q) => set.add(q.currency || 'USD'));
    return Array.from(set);
  }, [quotes]);

  const uniqueTags = useMemo(() => {
    const set = new Set<string>();
    quotes.forEach((q) => {
      try {
        const arr = q.tags ? JSON.parse(q.tags) : [];
        if (Array.isArray(arr)) arr.forEach((t: string) => set.add(String(t)));
      } catch {
        /* ignore */
      }
    });
    return Array.from(set).sort();
  }, [quotes]);

  // ─── Filter ───────────────────────────────────────────
  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
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
      if (clientFilter && q.client_id !== clientFilter) return false;
      if (salesRepFilter && q.sales_rep_id !== salesRepFilter) return false;
      if (currencyFilter && (q.currency || 'USD') !== currencyFilter) return false;
      if (tagFilter) {
        try {
          const arr = q.tags ? JSON.parse(q.tags) : [];
          if (!Array.isArray(arr) || !arr.includes(tagFilter)) return false;
        } catch {
          return false;
        }
      }
      if (probMin !== '') {
        const m = parseFloat(probMin);
        if (!isNaN(m) && (q.probability ?? 0) < m) return false;
      }
      if (probMax !== '') {
        const m = parseFloat(probMax);
        if (!isNaN(m) && (q.probability ?? 0) > m) return false;
      }
      if (dateFrom && q.issue_date < dateFrom) return false;
      if (dateTo && q.issue_date > dateTo) return false;
      if (followUpDue) {
        if (!q.follow_up_date || q.follow_up_date > today) return false;
      }
      return true;
    });
  }, [
    quotes,
    search,
    statusFilter,
    clientFilter,
    salesRepFilter,
    currencyFilter,
    tagFilter,
    probMin,
    probMax,
    dateFrom,
    dateTo,
    followUpDue,
  ]);

  // ─── Sort ─────────────────────────────────────────────
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const today = Date.now();
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'quote_number':
          cmp = (a.quote_number || '').localeCompare(b.quote_number || '');
          break;
        case 'client_name':
          cmp = (a.client_name || '').localeCompare(b.client_name || '');
          break;
        case 'issue_date':
          cmp = (a.issue_date || '').localeCompare(b.issue_date || '');
          break;
        case 'total':
          cmp = (a.total || 0) - (b.total || 0);
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
        case 'probability':
          cmp = (a.probability ?? 0) - (b.probability ?? 0);
          break;
        case 'days_since_sent': {
          const aSent = a.sent_date ? new Date(a.sent_date).getTime() : today;
          const bSent = b.sent_date ? new Date(b.sent_date).getTime() : today;
          cmp = aSent - bSent;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const total = useMemo(
    () => sorted.reduce((sum, q) => sum + (q.total || 0), 0),
    [sorted]
  );

  // ─── Inline summary stats ─────────────────────────────
  const stats = useMemo(() => {
    const pipelineValue = quotes
      .filter((q) => q.status === 'draft' || q.status === 'sent')
      .reduce((s, q) => s + (q.total || 0), 0);
    const wonCount = quotes.filter((q) => q.status === 'converted').length;
    const lostCount = quotes.filter((q) => q.status === 'rejected').length;
    const winRate =
      wonCount + lostCount === 0 ? 0 : Math.round((wonCount / (wonCount + lostCount)) * 100);
    const avgValue =
      quotes.length === 0 ? 0 : quotes.reduce((s, q) => s + (q.total || 0), 0) / quotes.length;
    const sentCount = quotes.filter((q) => q.status === 'sent').length;
    const expiredCount = quotes.filter((q) => q.status === 'expired').length;
    return {
      total: quotes.length,
      pipelineValue,
      winRate,
      avgValue,
      sentCount,
      expiredCount,
    };
  }, [quotes]);

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
  const allSelected = sorted.length > 0 && sorted.every((q) => selectedIds.has(q.id));
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
    else setSelectedIds(new Set(sorted.map((q) => q.id)));
  }, [allSelected, sorted]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    search,
    statusFilter,
    clientFilter,
    salesRepFilter,
    tagFilter,
    currencyFilter,
    probMin,
    probMax,
    dateFrom,
    dateTo,
    followUpDue,
  ]);

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

  const logActivity = useCallback(
    async (quoteId: string, type: string, description: string) => {
      try {
        await api.create('quote_activity_log', {
          quote_id: quoteId,
          activity_type: type,
          description,
        });
      } catch (err) {
        console.warn('Activity log failed:', err);
      }
    },
    []
  );

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

  const handleBulkSend = useCallback(async () => {
    setBatchLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      for (const id of Array.from(selectedIds)) {
        await api.update('quotes', id, { status: 'sent', sent_date: today });
        await logActivity(id, 'sent', 'Marked as sent (bulk)');
      }
      await reload();
    } catch (err) {
      console.error('Bulk send failed:', err);
    } finally {
      setBatchLoading(false);
    }
  }, [selectedIds, reload, logActivity]);

  const handleBulkArchive = useCallback(async () => {
    setBatchLoading(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await api.update('quotes', id, { status: 'expired' });
        await logActivity(id, 'archived', 'Archived (bulk)');
      }
      await reload();
    } catch (err) {
      console.error('Bulk archive failed:', err);
    } finally {
      setBatchLoading(false);
    }
  }, [selectedIds, reload, logActivity]);

  const handleBulkApplyTag = useCallback(async () => {
    if (!bulkTagValue.trim()) {
      setShowBulkTag(false);
      return;
    }
    setBatchLoading(true);
    try {
      for (const id of Array.from(selectedIds)) {
        const q = quotes.find((qq) => qq.id === id);
        let tagArr: string[] = [];
        try {
          tagArr = q?.tags ? JSON.parse(q.tags) : [];
        } catch {
          tagArr = [];
        }
        if (!tagArr.includes(bulkTagValue.trim())) tagArr.push(bulkTagValue.trim());
        await api.update('quotes', id, { tags: JSON.stringify(tagArr) });
        await logActivity(id, 'tagged', `Tag applied: ${bulkTagValue.trim()}`);
      }
      await reload();
    } catch (err) {
      console.error('Bulk tag failed:', err);
    } finally {
      setBatchLoading(false);
      setShowBulkTag(false);
      setBulkTagValue('');
    }
  }, [selectedIds, quotes, bulkTagValue, reload, logActivity]);

  const handleDuplicate = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const result = await api.cloneRecord('quotes', id);
      if (result?.error) {
        console.error('Duplicate quote failed:', result.error);
        return;
      }
      if (result?.id) await logActivity(result.id, 'duplicated', `Duplicated from ${id}`);
      await reload();
    },
    [reload, logActivity]
  );

  const handleConvert = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const r = await api.quotesConvertToInvoice(id);
        if (r?.invoice_id) {
          await logActivity(id, 'converted', `Converted to invoice ${r.invoice_id}`);
        }
        await reload();
      } catch (err) {
        console.error('Convert to invoice failed:', err);
      }
    },
    [reload, logActivity]
  );

  // ─── Export CSV ───────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const headers = [
      'Quote #',
      'Client',
      'Status',
      'Probability %',
      'Issue Date',
      'Valid Until',
      'Expected Close',
      'Sales Rep',
      'Currency',
      'Subtotal',
      'Tax',
      'Discount',
      'Total',
      'Tags',
    ];
    const rows = sorted.map((q) => {
      let tags = '';
      try {
        const arr = q.tags ? JSON.parse(q.tags) : [];
        if (Array.isArray(arr)) tags = arr.join(';');
      } catch {
        /* ignore */
      }
      const rep = salesReps.find((r) => r.id === q.sales_rep_id)?.name || '';
      return [
        q.quote_number,
        q.client_name || '',
        q.status,
        String(q.probability ?? ''),
        q.issue_date,
        q.valid_until || '',
        q.expected_close_date || '',
        rep,
        q.currency || 'USD',
        String(q.subtotal || 0),
        String(q.tax_amount || 0),
        String(q.discount_amount || 0),
        String(q.total || 0),
        tags,
      ];
    });
    const csv = [headers, ...rows]
      .map((r) =>
        r
          .map((v) => {
            const s = String(v ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
              ? '"' + s.replace(/"/g, '""') + '"'
              : s;
          })
          .join(',')
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quotes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [sorted, salesReps]);

  // ─── Print Quote Register ─────────────────────────────
  const handlePrintRegister = useCallback(async () => {
    const html = `
<html><head><meta charset="utf-8"><title>Quote Register</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px;color:#0f172a;font-size:12px}
h1{margin:0 0 8px 0;font-size:22px}
.meta{font-size:11px;color:#6b7280;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:6px;border-bottom:1px solid #e5e7eb}
th{background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.right{text-align:right}
.status{font-size:10px;font-weight:600;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:#e5e7eb}
tfoot td{font-weight:700;border-top:2px solid #0f172a;border-bottom:none}
</style></head><body>
<h1>Quote Register</h1>
<div class="meta">${activeCompany?.name || ''} · ${formatDate(new Date().toISOString())} · ${sorted.length} quotes</div>
<table><thead><tr>
<th>Quote #</th><th>Client</th><th>Issue Date</th><th>Valid Until</th>
<th>Status</th><th>Probability</th><th class="right">Total</th>
</tr></thead><tbody>
${sorted
  .map(
    (q) =>
      `<tr><td>${q.quote_number || ''}</td><td>${q.client_name || '-'}</td><td>${formatDate(q.issue_date)}</td><td>${q.valid_until ? formatDate(q.valid_until) : '-'}</td><td><span class="status">${q.status}</span></td><td>${q.probability ?? '-'}%</td><td class="right">${formatCurrency(q.total)}</td></tr>`
  )
  .join('')}
</tbody>
<tfoot><tr><td colspan="6" class="right">Total</td><td class="right">${formatCurrency(total)}</td></tr></tfoot>
</table>
</body></html>`;
    await api.printPreview(html, 'Quote Register');
  }, [sorted, total, activeCompany]);

  const handlePrintPipeline = useCallback(async () => {
    const grouped: Record<string, Quote[]> = {};
    sorted.forEach((q) => {
      const k = q.status || 'draft';
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(q);
    });
    const html = `
<html><head><meta charset="utf-8"><title>Pipeline Report</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px;color:#0f172a;font-size:12px}
h1{margin:0 0 8px 0;font-size:22px}
h2{font-size:14px;margin:18px 0 6px 0;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
.meta{font-size:11px;color:#6b7280;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:6px;border-bottom:1px solid #e5e7eb}
th{background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.right{text-align:right}
</style></head><body>
<h1>Pipeline Report</h1>
<div class="meta">${activeCompany?.name || ''} · ${formatDate(new Date().toISOString())}</div>
${Object.entries(grouped)
  .map(([status, items]) => {
    const stageTotal = items.reduce((s, q) => s + (q.total || 0), 0);
    return `<h2>${status.toUpperCase()} (${items.length} · ${formatCurrency(stageTotal)})</h2>
<table><thead><tr><th>Quote #</th><th>Client</th><th>Issue Date</th><th>Probability</th><th class="right">Total</th></tr></thead>
<tbody>
${items.map((q) => `<tr><td>${q.quote_number}</td><td>${q.client_name || '-'}</td><td>${formatDate(q.issue_date)}</td><td>${q.probability ?? '-'}%</td><td class="right">${formatCurrency(q.total)}</td></tr>`).join('')}
</tbody></table>`;
  })
  .join('')}
</body></html>`;
    await api.printPreview(html, 'Pipeline Report');
  }, [sorted, activeCompany]);

  // ─── Helpers for row visuals ──────────────────────────
  const daysSince = (d?: string): number | null => {
    if (!d) return null;
    const t = new Date(d).getTime();
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  };

  const isExpiringSoon = (q: Quote): boolean => {
    if (!q.valid_until) return false;
    if (q.status !== 'sent' && q.status !== 'draft') return false;
    const days = daysSince(q.valid_until);
    if (days === null) return false;
    // valid_until is in the future (negative days since)
    return days >= -7 && days <= 0;
  };

  const probColor = (p?: number): string => {
    if (p === undefined) return '#6b7280';
    if (p >= 70) return '#22c55e';
    if (p >= 30) return '#f59e0b';
    return '#ef4444';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading quotes...
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      style={{ paddingBottom: someSelected ? '80px' : undefined }}
    >
      {loadError && (
        <ErrorBanner
          message={loadError}
          title="Failed to load quotes"
          onDismiss={() => setLoadError('')}
        />
      )}

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
              {sorted.length} quote{sorted.length !== 1 ? 's' : ''} ·{' '}
              {formatCurrency(total)} total
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={handlePrintRegister}
            title="Print quote register"
          >
            <Printer size={14} /> Register
          </button>
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={handlePrintPipeline}
            title="Print pipeline report"
          >
            <Printer size={14} /> Pipeline
          </button>
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={handleExportCSV}
            title="Export to CSV"
          >
            <Download size={14} /> CSV
          </button>
          <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
            <Plus size={16} />
            New Quote
          </button>
        </div>
      </div>

      {/* Inline KPI Cards (6 stats) */}
      <div className="grid grid-cols-6 gap-2">
        {[
          { label: 'Total', value: String(stats.total) },
          { label: 'Pipeline', value: formatCurrency(stats.pipelineValue) },
          { label: 'Win Rate', value: `${stats.winRate}%` },
          { label: 'Avg Value', value: formatCurrency(stats.avgValue) },
          { label: 'Sent', value: String(stats.sentCount) },
          { label: 'Expired', value: String(stats.expiredCount) },
        ].map((s) => (
          <div
            key={s.label}
            className="block-card p-3"
            style={{ borderRadius: '6px' }}
          >
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              {s.label}
            </div>
            <div className="text-base font-bold text-text-primary font-mono mt-1">
              {s.value}
            </div>
          </div>
        ))}
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
      <div className="block-card p-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
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
              <optgroup label="Active">
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
              </optgroup>
              <optgroup label="Closed">
                <option value="accepted">Accepted</option>
                <option value="converted">Converted</option>
                <option value="expired">Expired</option>
                <option value="rejected">Rejected</option>
              </optgroup>
            </select>
          </div>
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '140px' }}
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
          >
            <option value="">All Clients</option>
            {uniqueClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={() => setShowAdvanced((v) => !v)}
            title="Advanced filters"
          >
            <Filter size={13} /> {showAdvanced ? 'Hide' : 'Advanced'}
          </button>
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '140px' }}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            title="Sort by"
          >
            <option value="issue_date">Sort: Date</option>
            <option value="quote_number">Sort: Quote #</option>
            <option value="client_name">Sort: Client</option>
            <option value="total">Sort: Total</option>
            <option value="status">Sort: Status</option>
            <option value="probability">Sort: Probability</option>
            <option value="days_since_sent">Sort: Days Since Sent</option>
          </select>
          <button
            className="block-btn flex items-center gap-1.5"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title="Toggle sort direction"
          >
            {sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border-primary">
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Date From
              </div>
              <input
                type="date"
                className="block-input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Date To
              </div>
              <input
                type="date"
                className="block-input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Sales Rep
              </div>
              <select
                className="block-select"
                value={salesRepFilter}
                onChange={(e) => setSalesRepFilter(e.target.value)}
              >
                <option value="">All reps</option>
                {salesReps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Tag
              </div>
              <select
                className="block-select"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                <option value="">All tags</option>
                {uniqueTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Currency
              </div>
              <select
                className="block-select"
                value={currencyFilter}
                onChange={(e) => setCurrencyFilter(e.target.value)}
              >
                <option value="">All</option>
                {uniqueCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Probability Min
              </div>
              <input
                type="number"
                className="block-input"
                min="0"
                max="100"
                placeholder="0"
                value={probMin}
                onChange={(e) => setProbMin(e.target.value)}
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Probability Max
              </div>
              <input
                type="number"
                className="block-input"
                min="0"
                max="100"
                placeholder="100"
                value={probMax}
                onChange={(e) => setProbMax(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={followUpDue}
                  onChange={(e) => setFollowUpDue(e.target.checked)}
                  style={{ accentColor: '#3b82f6' }}
                />
                Has Follow-Up Due
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <EmptyState
          icon={FileCheck}
          message={
            quotes.length === 0
              ? 'No quotes yet'
              : 'No quotes match your search or filter'
          }
        />
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
                <th>Expected Close</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th>Prob</th>
                <th>Days</th>
                <th style={{ width: '140px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((q) => {
                const isSelected = selectedIds.has(q.id);
                const sentDays = daysSince(q.sent_date);
                const stageDays = daysSince(q.updated_at || q.created_at);
                const expiringSoon = isExpiringSoon(q);
                const won = q.status === 'converted' || q.status === 'accepted';
                const lost = q.status === 'rejected' || q.status === 'expired';
                return (
                  <tr
                    key={q.id}
                    className={`cursor-pointer ${isSelected ? 'bg-accent-blue/5' : ''}`}
                    onClick={() => (onView ? onView(q.id) : onEdit(q.id))}
                  >
                    <td
                      className="cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(q.id)}
                        className="cursor-pointer"
                        style={{ accentColor: '#3b82f6' }}
                      />
                    </td>
                    <td className="font-mono text-text-primary text-xs font-semibold">
                      <span className="flex items-center gap-1.5">
                        {expiringSoon && (
                          <span
                            title="Expiring within 7 days"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: '#ef4444',
                              display: 'inline-block',
                            }}
                          />
                        )}
                        {q.quote_number}
                      </span>
                    </td>
                    <td
                      className="text-text-secondary truncate max-w-[180px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {q.client_id ? (
                        <EntityChip
                          type="client"
                          id={q.client_id}
                          label={q.client_name || ''}
                          variant="inline"
                        />
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="font-mono text-text-secondary text-xs">
                      {formatDate(q.issue_date)}
                    </td>
                    <td className="font-mono text-text-secondary text-xs">
                      {q.valid_until ? formatDate(q.valid_until) : '-'}
                    </td>
                    <td className="font-mono text-text-secondary text-xs">
                      {q.expected_close_date ? formatDate(q.expected_close_date) : '-'}
                    </td>
                    <td className="text-right font-mono text-text-primary font-semibold">
                      {formatCurrency(q.total)}
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5">
                        {won && (
                          <CheckCircle2 size={12} className="text-accent-income" />
                        )}
                        {lost && <XCircle size={12} className="text-accent-expense" />}
                        <span className={formatStatus(q.status).className}>
                          {formatStatus(q.status).label}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span
                        className="font-mono text-xs font-semibold"
                        style={{ color: probColor(q.probability) }}
                      >
                        {q.probability ?? '-'}%
                      </span>
                    </td>
                    <td className="font-mono text-text-muted text-[10px]">
                      {q.status === 'sent' && sentDays !== null
                        ? `${sentDays}d sent`
                        : stageDays !== null
                        ? `${stageDays}d`
                        : '-'}
                    </td>
                    <td
                      className="cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1">
                        {onView && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onView(q.id);
                            }}
                            className="flex items-center gap-1 px-2 py-1 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors"
                            title="View"
                            style={{ borderRadius: '6px' }}
                          >
                            <Eye size={12} />
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDuplicate(q.id, e)}
                          className="flex items-center gap-1 px-2 py-1 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors"
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
                  colSpan={5}
                  className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider"
                >
                  Total
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {formatCurrency(total)}
                </td>
                <td colSpan={4} />
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
            background: 'rgba(18,20,28,0.92)',
            borderRadius: '6px',
            minWidth: '320px',
          }}
        >
          <span className="text-xs font-semibold text-text-muted mr-2">
            {selectedIds.size} of {sorted.length} selected
          </span>

          {!showDeleteConfirm && !showBulkTag ? (
            <>
              <button
                className="flex items-center gap-1.5 text-xs font-semibold"
                onClick={handleBulkSend}
                disabled={batchLoading}
                style={{
                  background: 'rgba(59,130,246,0.15)',
                  border: '1px solid rgba(59,130,246,0.4)',
                  color: '#3b82f6',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                }}
              >
                <Send size={13} /> Mark Sent
              </button>
              <button
                className="flex items-center gap-1.5 text-xs font-semibold"
                onClick={handleBulkArchive}
                disabled={batchLoading}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: '#cbd5e1',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                }}
              >
                Archive
              </button>
              <button
                className="flex items-center gap-1.5 text-xs font-semibold"
                onClick={() => setShowBulkTag(true)}
                disabled={batchLoading}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: '#cbd5e1',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                }}
              >
                <TagIcon size={13} /> Tag
              </button>
              <button
                className="flex items-center gap-1.5 text-xs font-semibold"
                onClick={handleExportCSV}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: '#cbd5e1',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                }}
              >
                <Download size={13} /> Export
              </button>
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
            </>
          ) : showDeleteConfirm ? (
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
          ) : (
            <div className="flex items-center gap-2">
              <input
                className="block-input"
                style={{ width: '160px' }}
                placeholder="Tag value..."
                value={bulkTagValue}
                onChange={(e) => setBulkTagValue(e.target.value)}
              />
              <button
                className="text-xs font-semibold"
                onClick={handleBulkApplyTag}
                disabled={batchLoading || !bulkTagValue.trim()}
                style={{
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  cursor: 'pointer',
                }}
              >
                Apply
              </button>
              <button
                className="text-xs font-semibold text-text-muted"
                onClick={() => {
                  setShowBulkTag(false);
                  setBulkTagValue('');
                }}
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
