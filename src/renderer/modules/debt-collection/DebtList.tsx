import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Scale, Plus, Search, Filter, Download, Eye, Pencil, Trash2, AlertTriangle, Play, FileText, RefreshCw, DollarSign, ArrowUpDown, Phone, Mail, ArrowUpRight, Printer, Clock } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';
import { downloadCSVBlob } from '../../lib/csv-export';
import { formatCurrency } from '../../lib/format';
import { formatStatus } from '../../lib/format';
import { formatDate } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import { SummaryBar } from '../../components/SummaryBar';
import { calcRiskScore, getRiskBadge } from './riskScore';
import PaymentMatchReview from './PaymentMatchReview';
import {
  DEBT_PRIORITY, DEBT_RISK, DEBT_SEGMENT, DEBT_ORIGINATION, DEBT_COLLECTABILITY,
  ClassificationBadge,
} from '../../lib/classifications';

// ─── Types ──────────────────────────────────────────────
interface Debt {
  id: string;
  type: 'receivable' | 'payable';
  debtor_name: string;
  source_type: 'invoice' | 'manual';
  source_id?: string;
  original_amount: number;
  balance_due: number;
  delinquent_date: string;
  due_date?: string;
  current_stage: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  created_at: string;
  assigned_collector_id?: string | null;
  has_plan?: number;
  has_pending_settlement?: number;
  has_active_promise?: number;
  has_broken_promise?: number;
  cease_desist_active?: number;
  do_not_call?: number;
  statute_of_limitations_date?: string;
  interest_frozen?: number;
  currency?: string;
  risk_category?: string;
  segment?: string;
  origination_type?: string;
  collectability?: string;
  amount_paid?: number;
  last_contact_date?: string;
}

interface DebtListProps {
  type: 'receivable' | 'payable';
  onNew: () => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
}

// ─── Risk Color Logic (Feature 25) ─────────────────────
const riskColor = (ageDays: number, balance: number): string => {
  if (ageDays > 90 || balance > 10000) return '#dc2626'; // red
  if (ageDays > 60 || balance > 5000) return '#f59e0b'; // orange
  if (ageDays > 30) return '#eab308'; // yellow
  return '#22c55e'; // green
};

// ─── Aging Badge ────────────────────────────────────────
const getAgingBadge = (delinquencyDate: string): { label: string; color: string; bg: string } => {
  if (!delinquencyDate) return { label: '—', color: 'var(--color-text-muted)', bg: 'transparent' };
  const days = Math.floor((Date.now() - new Date(delinquencyDate).getTime()) / 86400000);
  if (days <= 30)  return { label: `${days}d`, color: '#16a34a', bg: '#16a34a22' };
  if (days <= 90)  return { label: `${days}d`, color: '#d97706', bg: '#d9770622' };
  if (days <= 180) return { label: `${days}d`, color: '#ea580c', bg: '#ea580c22' };
  return { label: `${days}d`, color: '#dc2626', bg: '#dc262622' };
};

// ─── Priority Colors ────────────────────────────────────
const priorityColor: Record<string, string> = {
  low: 'text-accent-income',
  medium: 'text-blue-500',
  high: 'text-orange-500',
  critical: 'text-accent-expense',
};

// ─── Sort Options (Feature 22-24) ───────────────────────
type SortField = 'created_at' | 'balance_due' | 'age' | 'priority_score' | 'debtor_name' | 'original_amount' | 'last_contact';
type SortDir = 'asc' | 'desc';

const PRIORITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// ─── Component ──────────────────────────────────────────
const DebtList: React.FC<DebtListProps> = ({ type, onNew, onView, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [collectorFilter, setCollectorFilter] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stats, setStats] = useState<{
    total_outstanding: number;
    in_collection: number;
    legal_active: number;
    collected_this_month: number;
    writeoffs_ytd: number;
  } | null>(null);

  // Feature 19: Age Range Filter
  const [ageFilter, setAgeFilter] = useState('');
  // Feature 20: Amount Range Filter
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  // Feature 22-24: Sorting
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Import overdue state
  const [showImportForm, setShowImportForm] = useState(false);
  const [importDays, setImportDays] = useState(30);
  const [importLoading, setImportLoading] = useState(false);

  // Escalation state
  const [escalationLoading, setEscalationLoading] = useState(false);
  const [escalationResult, setEscalationResult] = useState<{ advanced: number; flagged: number } | null>(null);

  // Feedback state
  const [opSuccess, setOpSuccess] = useState('');
  const [showMatchReview, setShowMatchReview] = useState(false);
  const [opError, setOpError] = useState('');

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignCollector, setBulkAssignCollector] = useState('');
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Feature 26: Last Contact data
  const [lastContactMap, setLastContactMap] = useState<Record<string, string>>({});

  // ─── Load Users ─────────────────────────────────────────
  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  // ─── Load Data ──────────────────────────────────────────
  const DEBT_LIST_SQL = `
    SELECT d.*,
      (SELECT COUNT(*) FROM debt_payment_plans WHERE debt_id = d.id) as has_plan,
      (SELECT COUNT(*) FROM debt_settlements WHERE debt_id = d.id AND response = 'pending') as has_pending_settlement,
      (SELECT COUNT(*) FROM debt_promises WHERE debt_id = d.id AND kept = 0 AND promised_date >= date('now')) as has_active_promise,
      (SELECT COUNT(*) FROM debt_promises WHERE debt_id = d.id AND kept = 0 AND promised_date < date('now')) as has_broken_promise
    FROM debts d WHERE d.company_id = ? AND d.type = ? ORDER BY d.created_at DESC
  `;

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const data = await api.rawQuery(DEBT_LIST_SQL, [activeCompany.id, type]);
      setDebts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to reload debts:', err);
    }
  }, [activeCompany, type]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoadError('');
        // Critical: debt data
        const debtData = await api.rawQuery(DEBT_LIST_SQL, [activeCompany.id, type]);
        if (cancelled) return;
        setDebts(Array.isArray(debtData) ? debtData : []);

        // Non-critical — failures don't hide primary content
        api.debtStats(activeCompany.id)
          .then(r => { if (!cancelled) setStats(r ?? null); })
          .catch(() => {});

        // Feature 26: Load last contact dates
        try {
          const contactRows = await api.rawQuery(`
            SELECT dc.debt_id, MAX(dc.created_at) as last_contact
            FROM debt_communications dc
            JOIN debts d ON dc.debt_id = d.id
            WHERE d.company_id = ? AND d.type = ?
            GROUP BY dc.debt_id
          `, [activeCompany.id, type]);
          if (Array.isArray(contactRows)) {
            const map: Record<string, string> = {};
            contactRows.forEach((r: any) => { if (r.debt_id && r.last_contact) map[r.debt_id] = r.last_contact; });
            if (!cancelled) setLastContactMap(map);
          }
        } catch (e) { /* non-critical */ }

      } catch (err: any) {
        console.error('Failed to load debts:', err);
        if (!cancelled) setLoadError(err?.message || 'Failed to load debts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany, type]);

  // ─── Age Calculation ────────────────────────────────────
  const ageDays = (delinquentDate: string): number => {
    if (!delinquentDate) return 0;
    return Math.floor((Date.now() - new Date(delinquentDate).getTime()) / 86400000);
  };

  // ─── In-Memory Filters (enhanced with Features 19-21) ──
  const filtered = useMemo(() => {
    return debts.filter((d) => {
      if (search) {
        const q = search.toLowerCase();
        if (!d.debtor_name?.toLowerCase().includes(q)) return false;
      }
      if (statusFilter && d.status !== statusFilter) return false;
      if (stageFilter && d.current_stage !== stageFilter) return false;
      if (priorityFilter && d.priority !== priorityFilter) return false;
      if (dateFrom && d.delinquent_date < dateFrom) return false;
      if (dateTo && d.delinquent_date > dateTo) return false;
      if (collectorFilter && d.assigned_collector_id !== collectorFilter) return false;

      // Feature 19: Age Range Filter
      if (ageFilter) {
        const age = ageDays(d.delinquent_date || d.created_at);
        if (ageFilter === '0-30' && age > 30) return false;
        if (ageFilter === '31-60' && (age <= 30 || age > 60)) return false;
        if (ageFilter === '61-90' && (age <= 60 || age > 90)) return false;
        if (ageFilter === '90+' && age <= 90) return false;
      }

      // Feature 20: Amount Range Filter
      if (amountMin && d.balance_due < parseFloat(amountMin)) return false;
      if (amountMax && d.balance_due > parseFloat(amountMax)) return false;

      return true;
    });
  }, [debts, search, statusFilter, stageFilter, priorityFilter, dateFrom, dateTo, collectorFilter, ageFilter, amountMin, amountMax]);

  // Feature 22-24: Sorted list
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'debtor_name':
          cmp = (a.debtor_name || '').localeCompare(b.debtor_name || '');
          break;
        case 'balance_due':
          cmp = (a.balance_due || 0) - (b.balance_due || 0);
          break;
        case 'original_amount':
          cmp = (a.original_amount || 0) - (b.original_amount || 0);
          break;
        case 'age':
          cmp = ageDays(a.delinquent_date || a.created_at) - ageDays(b.delinquent_date || b.created_at);
          break;
        case 'priority_score': {
          const scoreA = (PRIORITY_WEIGHT[a.priority] || 1) * (a.balance_due || 0) * ageDays(a.delinquent_date || a.created_at);
          const scoreB = (PRIORITY_WEIGHT[b.priority] || 1) * (b.balance_due || 0) * ageDays(b.delinquent_date || b.created_at);
          cmp = scoreA - scoreB;
          break;
        }
        case 'last_contact': {
          const dateA = lastContactMap[a.id] || '0000-00-00';
          const dateB = lastContactMap[b.id] || '0000-00-00';
          cmp = dateA.localeCompare(dateB);
          break;
        }
        default: // created_at
          cmp = (a.created_at || '').localeCompare(b.created_at || '');
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir, lastContactMap]);

  const totalOutstanding = useMemo(
    () => filtered.reduce((sum, d) => sum + (d.balance_due || 0), 0),
    [filtered]
  );

  // Feature 16-18: Portfolio Summary Stats
  const portfolioStats = useMemo(() => {
    const totalCollected = filtered.reduce((sum, d) => sum + ((d.original_amount || 0) - (d.balance_due || 0)), 0);
    const totalOriginal = filtered.reduce((sum, d) => sum + (d.original_amount || 0), 0);
    const recoveryRate = totalOriginal > 0 ? ((totalCollected / totalOriginal) * 100).toFixed(1) : '0.0';
    const avgBalance = filtered.length > 0 ? totalOutstanding / filtered.length : 0;
    const largest = filtered.length > 0 ? Math.max(...filtered.map(d => d.balance_due || 0)) : 0;
    let oldestAge = 0;
    filtered.forEach(d => {
      const age = ageDays(d.delinquent_date || d.created_at);
      if (age > oldestAge) oldestAge = age;
    });
    return { totalCollected, recoveryRate, avgBalance, largest, oldestAge };
  }, [filtered, totalOutstanding]);

  // ─── Import Overdue Invoices ────────────────────────────
  const handleImportOverdue = useCallback(async () => {
    if (!activeCompany) return;
    setImportLoading(true);
    try {
      const result = await api.debtImportOverdueInvoices(activeCompany.id, importDays);
      await reload();
      setShowImportForm(false);
      setOpSuccess(`Imported ${result.imported} overdue invoice(s) as debts`); setTimeout(() => setOpSuccess(''), 4000);
    } catch (err: any) {
      console.error('Import overdue failed:', err);
      setOpError('Import failed: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setImportLoading(false);
    }
  }, [activeCompany, importDays, reload]);

  // ─── Run Escalation ─────────────────────────────────────
  const handleRunEscalation = useCallback(async () => {
    if (!activeCompany) return;
    setEscalationLoading(true);
    setEscalationResult(null);
    try {
      const result = await api.debtRunEscalation(activeCompany.id);
      setEscalationResult(result);
      await reload();
    } catch (err: any) {
      console.error('Escalation failed:', err);
      setOpError('Escalation failed: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setEscalationLoading(false);
    }
  }, [activeCompany, reload]);

  // ─── CSV Export ─────────────────────────────────────────
  const handleExport = useCallback(() => {
    const exportData = filtered.map((d) => ({
      debtor_name: d.debtor_name,
      source_type: d.source_type,
      source_id: d.source_id || '',
      original_amount: d.original_amount,
      balance_due: d.balance_due,
      delinquent_date: d.delinquent_date,
      current_stage: d.current_stage,
      status: d.status,
      priority: d.priority,
    }));
    downloadCSVBlob(exportData, `debts-${type}-export.csv`);
  }, [filtered, type]);

  // ─── Delete Debt ────────────────────────────────────────
  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete debt for "${name}"? This will also remove all related communications, payments, settlements, and compliance records.`)) return;
    try {
      await api.remove('debts', id);
      await reload();
      setOpSuccess('Debt deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete debt:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  }, [reload]);

  // ─── Bulk Actions ──────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map(d => d.id)));
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkAssignCollector || selectedIds.size === 0) return;
    setBulkProcessing(true);
    try {
      for (const id of selectedIds) {
        await api.assignCollector(id, bulkAssignCollector);
      }
      setSelectedIds(new Set());
      setBulkAssignCollector('');
      await reload();
      setOpSuccess(`Assigned ${selectedIds.size} debts`); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err) {
      setOpError('Bulk assign failed'); setTimeout(() => setOpError(''), 5000);
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkAdvance = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Advance stage for ${selectedIds.size} selected debts?`)) return;
    setBulkProcessing(true);
    try {
      let advanced = 0;
      for (const id of selectedIds) {
        await api.debtAdvanceStage(id);
        advanced++;
      }
      setSelectedIds(new Set());
      await reload();
      setOpSuccess(`Advanced ${advanced} debts`); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err) {
      setOpError('Bulk advance failed'); setTimeout(() => setOpError(''), 5000);
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkHold = async (hold: boolean) => {
    if (selectedIds.size === 0) return;
    setBulkProcessing(true);
    try {
      for (const id of selectedIds) {
        await api.debtHoldToggle(id, hold, hold ? 'Bulk hold' : '');
      }
      setSelectedIds(new Set());
      await reload();
      setOpSuccess(`${hold ? 'Held' : 'Released'} ${selectedIds.size} debts`); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err) {
      setOpError('Bulk hold failed'); setTimeout(() => setOpError(''), 5000);
    } finally {
      setBulkProcessing(false);
    }
  };

  // Feature 28: Batch Escalate
  const handleBulkEscalate = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Escalate ${selectedIds.size} selected debts to next stage?`)) return;
    setBulkProcessing(true);
    try {
      let escalated = 0;
      for (const id of selectedIds) {
        try {
          await api.debtAdvanceStage(id);
          escalated++;
        } catch { /* skip individual failures */ }
      }
      setSelectedIds(new Set());
      await reload();
      setOpSuccess(`Escalated ${escalated} debts to next stage`); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err) {
      setOpError('Bulk escalate failed'); setTimeout(() => setOpError(''), 5000);
    } finally {
      setBulkProcessing(false);
    }
  };

  // Feature 30: Print Debt Register
  const handlePrintRegister = useCallback(async () => {
    if (!activeCompany) return;
    const isRec = type === 'receivable';
    const totalOrig = sorted.reduce((s, d) => s + (d.original_amount || 0), 0);
    const totalBal = sorted.reduce((s, d) => s + (d.balance_due || 0), 0);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Debt Register - ${activeCompany.name}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 30px; color: #1a1a2e; font-size: 11px; }
          h1 { font-size: 18px; margin-bottom: 2px; }
          .sub { font-size: 11px; color: #666; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #eee; }
          th { background: #f8f8fa; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
          .text-right { text-align: right; }
          .mono { font-family: monospace; }
          .bold { font-weight: 700; }
          tfoot td { border-top: 2px solid #333; font-weight: 700; }
          .stats { display: flex; gap: 24px; margin-bottom: 16px; }
          .stat-item { }
          .stat-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; }
          .stat-value { font-size: 14px; font-weight: 700; font-family: monospace; }
        </style>
      </head>
      <body>
        <h1>${isRec ? 'Receivables' : 'Payables'} Register</h1>
        <div class="sub">${activeCompany.name} &mdash; ${new Date().toLocaleDateString()} &mdash; ${sorted.length} records</div>
        <div class="stats">
          <div class="stat-item"><div class="stat-label">Total Original</div><div class="stat-value">${formatCurrency(totalOrig)}</div></div>
          <div class="stat-item"><div class="stat-label">Total Outstanding</div><div class="stat-value" style="color:#dc2626;">${formatCurrency(totalBal)}</div></div>
          <div class="stat-item"><div class="stat-label">Recovery Rate</div><div class="stat-value">${portfolioStats.recoveryRate}%</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>${isRec ? 'Debtor' : 'Creditor'}</th>
              <th>Source</th>
              <th class="text-right">Original</th>
              <th class="text-right">Balance Due</th>
              <th>Age</th>
              <th>Stage</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((d, i) => {
              const age = ageDays(d.delinquent_date || d.created_at);
              const src = d.source_type === 'invoice' ? `INV ${(d.source_id || '').substring(0, 8)}` : 'Manual';
              return `<tr>
                <td class="mono">${i + 1}</td>
                <td class="bold">${d.debtor_name}</td>
                <td class="mono">${src}</td>
                <td class="text-right mono">${formatCurrency(d.original_amount)}</td>
                <td class="text-right mono bold" style="color:${d.balance_due > 0 ? '#dc2626' : '#16a34a'}">${formatCurrency(d.balance_due)}</td>
                <td class="mono">${age}d</td>
                <td>${d.current_stage || '—'}</td>
                <td>${d.priority || '—'}</td>
                <td>${d.status || '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" class="text-right">Totals</td>
              <td class="text-right mono">${formatCurrency(totalOrig)}</td>
              <td class="text-right mono" style="color:#dc2626;">${formatCurrency(totalBal)}</td>
              <td colspan="4"></td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;
    await api.printPreview(html, `${isRec ? 'Receivables' : 'Payables'} Register`);
  }, [activeCompany, sorted, type, portfolioStats]);

  // ─── Sort Toggle Helper ─────────────────────────────────
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIndicator: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) return null;
    return <span className="ml-0.5 text-[9px]">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading {type === 'receivable' ? 'receivables' : 'payables'}...
      </div>
    );
  }

  const isReceivable = type === 'receivable';
  const label = isReceivable ? 'receivable' : 'payable';

  return (
    <div className="space-y-4">
      {loadError && <ErrorBanner message={loadError} title="Failed to load debts" onDismiss={() => setLoadError('')} />}
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <Scale size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">
              {isReceivable ? 'Receivables' : 'Payables'}
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} debt{filtered.length !== 1 ? 's' : ''} &middot; {formatCurrency(totalOutstanding)} outstanding
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isReceivable && (
            <>
              <button
                className="block-btn flex items-center gap-2"
                onClick={() => setShowImportForm(!showImportForm)}
              >
                <AlertTriangle size={14} />
                Import Overdue Invoices
              </button>
              <button
                className="block-btn flex items-center gap-2"
                onClick={handleRunEscalation}
                disabled={escalationLoading}
              >
                <Play size={14} />
                {escalationLoading ? 'Running...' : 'Run Escalation'}
              </button>
            </>
          )}
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={async () => {
              if (!activeCompany) return;
              const data = await api.getDebtPortfolioReportData(activeCompany.id);
              if (data?.error) return;
              const { generateDebtPortfolioReportHTML } = await import('../../lib/print-templates');
              const html = generateDebtPortfolioReportHTML(data.debts, data.collectedYtd, activeCompany);
              await api.printPreview(html, 'Debt Portfolio Report');
            }}
          >
            <FileText size={13} />
            Portfolio Report
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={async () => {
              const result = await api.batchRecalcInterest();
              if (result?.updated > 0) {
                setOpSuccess(`Recalculated interest on ${result.updated} debts`);
                setTimeout(() => setOpSuccess(''), 4000);
                await reload();
              } else if (result?.error) {
                setOpError(result.error);
                setTimeout(() => setOpError(''), 5000);
              } else {
                setOpSuccess('No debts needed interest recalculation');
                setTimeout(() => setOpSuccess(''), 3000);
              }
            }}
          >
            <RefreshCw size={14} />
            Recalc Interest
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={async () => {
              const result = await api.matchBankPayments();
              if (result?.auto_matched > 0) {
                setOpSuccess(`Auto-matched ${result.auto_matched} payments`);
                setTimeout(() => setOpSuccess(''), 4000);
                await reload();
              }
              if (result?.suggested > 0) {
                setShowMatchReview(true);
              } else if (result?.auto_matched === 0) {
                setOpSuccess('No bank transactions to match');
                setTimeout(() => setOpSuccess(''), 3000);
              }
            }}
          >
            <DollarSign size={14} />
            Match Payments
          </button>
          {/* Auto-Assign */}
          <button className="block-btn flex items-center gap-2 text-xs" onClick={async () => {
            if (!activeCompany) return;
            try {
              const result = await api.autoAssignDebts(activeCompany.id);
              if (result?.assigned > 0) {
                setOpSuccess(`Auto-assigned ${result.assigned} debts`); setTimeout(() => setOpSuccess(''), 4000);
                await reload();
              } else {
                setOpSuccess('No unassigned debts to distribute'); setTimeout(() => setOpSuccess(''), 3000);
              }
            } catch (err: any) {
              setOpError('Auto-assign failed: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
            }
          }}>
            <RefreshCw size={14} />
            Auto-Assign
          </button>
          {/* Auto Priority */}
          <button className="block-btn flex items-center gap-2 text-xs" onClick={async () => {
            if (!activeCompany) return;
            try {
              const result = await api.autoPriorityScore(activeCompany.id);
              if (result?.updated > 0) {
                setOpSuccess(`Updated priority on ${result.updated} debts`); setTimeout(() => setOpSuccess(''), 4000);
                await reload();
              }
            } catch (err: any) {
              setOpError('Auto-priority failed: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
            }
          }}>
            <AlertTriangle size={14} />
            Auto-Priority
          </button>
          {/* Consolidate Selected */}
          {selectedIds.size >= 2 && (
            <button className="block-btn flex items-center gap-2 text-xs text-accent-blue" onClick={async () => {
              if (!activeCompany) return;
              if (!window.confirm(`Consolidate ${selectedIds.size} selected debts into one?`)) return;
              try {
                const result = await api.consolidateDebts(Array.from(selectedIds), activeCompany.id);
                if (result?.error) {
                  setOpError(result.error); setTimeout(() => setOpError(''), 5000);
                } else if (result?.newDebtId) {
                  setSelectedIds(new Set());
                  setOpSuccess(`Consolidated ${result.consolidated} debts`); setTimeout(() => setOpSuccess(''), 4000);
                  await reload();
                }
              } catch (err: any) {
                setOpError('Consolidation failed: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
              }
            }}>
              <Scale size={14} />
              Consolidate Selected
            </button>
          )}
          {/* Feature 30: Print Register */}
          <button className="block-btn flex items-center gap-2 text-xs" onClick={handlePrintRegister}>
            <Printer size={14} />
            Print Register
          </button>
          <button className="block-btn flex items-center gap-2" onClick={handleExport}>
            <Download size={14} />
            Export CSV
          </button>
          <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
            <Plus size={16} />
            New Debt
          </button>
        </div>
      </div>

      {/* Feedback Messages */}
      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20" style={{ borderRadius: '6px' }}>{opError}</div>}

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 border border-accent-blue/30 bg-accent-blue/5" style={{ borderRadius: '6px' }}>
          <span className="text-xs font-bold text-accent-blue">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-2">
            {/* Feature 29: Batch Assign Collector */}
            <select className="block-select text-xs" style={{ width: 'auto', minWidth: 140 }} value={bulkAssignCollector} onChange={(e) => setBulkAssignCollector(e.target.value)}>
              <option value="">Assign Collector...</option>
              {[...users].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {bulkAssignCollector && (
              <button className="block-btn-primary text-xs py-1 px-3" onClick={handleBulkAssign} disabled={bulkProcessing}>Assign</button>
            )}
          </div>
          {isReceivable && (
            <>
              <button className="block-btn text-xs py-1 px-3" onClick={handleBulkAdvance} disabled={bulkProcessing}>Advance Stage</button>
              {/* Feature 28: Batch Escalate */}
              <button className="block-btn text-xs py-1 px-3 text-accent-expense" onClick={handleBulkEscalate} disabled={bulkProcessing}>
                <span className="flex items-center gap-1"><ArrowUpRight size={12} /> Escalate</span>
              </button>
            </>
          )}
          <button className="block-btn text-xs py-1 px-3" onClick={() => handleBulkHold(true)} disabled={bulkProcessing}>Hold</button>
          <button className="block-btn text-xs py-1 px-3" onClick={() => handleBulkHold(false)} disabled={bulkProcessing}>Release</button>
          <button className="text-xs text-text-muted ml-auto hover:text-text-primary transition-colors" onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}

      {/* Escalation Result */}
      {escalationResult && (
        <div
          className="flex items-center gap-3 px-4 py-2 border border-border-primary text-xs text-text-secondary"
          style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.80)' }}
        >
          Escalation complete: {escalationResult.advanced} advanced, {escalationResult.flagged} flagged.
          <button className="text-text-muted underline" onClick={() => setEscalationResult(null)}>Dismiss</button>
        </div>
      )}

      {/* Import Overdue Inline Form */}
      {showImportForm && (
        <div
          className="flex items-center gap-3 px-4 py-3 border border-border-primary"
          style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.80)' }}
        >
          <span className="text-xs text-text-secondary font-semibold">Days overdue threshold:</span>
          <input
            type="number"
            className="block-input"
            style={{ width: '80px' }}
            value={importDays}
            min={1}
            onChange={(e) => setImportDays(Number(e.target.value))}
          />
          <button
            className="block-btn-primary text-xs"
            onClick={handleImportOverdue}
            disabled={importLoading}
          >
            {importLoading ? 'Importing...' : 'Import'}
          </button>
          <button
            className="block-btn text-xs"
            onClick={() => setShowImportForm(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Summary Bar (original) */}
      {stats && (
        <SummaryBar items={[
          { label: 'Total Outstanding', value: formatCurrency(stats.total_outstanding) },
          { label: 'In Collection', value: formatCurrency(stats.in_collection), accent: 'orange' },
          { label: 'Legal Active', value: formatCurrency(stats.legal_active), accent: 'red' },
          { label: 'Collected This Month', value: formatCurrency(stats.collected_this_month), accent: 'green' },
          { label: 'Write-offs YTD', value: formatCurrency(stats.writeoffs_ytd) },
        ]} />
      )}

      {/* Feature 16-18: Portfolio Summary Cards */}
      <div className="grid grid-cols-6 gap-3">
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-lg font-bold font-mono text-accent-expense">{formatCurrency(totalOutstanding)}</p>
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1">Total Outstanding</p>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-lg font-bold font-mono text-accent-income">{formatCurrency(portfolioStats.totalCollected)}</p>
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1">Total Collected</p>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-lg font-bold font-mono" style={{ color: '#8b5cf6' }}>{portfolioStats.recoveryRate}%</p>
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1">Recovery Rate</p>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-lg font-bold font-mono text-text-primary">{formatCurrency(portfolioStats.avgBalance)}</p>
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1">Avg Balance</p>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-lg font-bold font-mono" style={{ color: '#dc2626' }}>{formatCurrency(portfolioStats.largest)}</p>
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1">Largest Debt</p>
        </div>
        <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
          <p className="text-lg font-bold font-mono" style={{ color: '#f59e0b' }}>{portfolioStats.oldestAge}d</p>
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1">Oldest Account</p>
        </div>
      </div>

      {/* Filters (enhanced with Features 19-21) */}
      <div className="block-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder={`Search ${isReceivable ? 'debtors' : 'creditors'}...`}
              className="block-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-text-muted" />
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '130px' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <optgroup label="Active">
                <option value="active">Active</option>
                <option value="disputed">Disputed</option>
                <option value="in_collection">In Collection</option>
                <option value="legal">Legal</option>
              </optgroup>
              <optgroup label="Closed">
                <option value="bankruptcy">Bankruptcy</option>
                <option value="settled">Settled</option>
                <option value="written_off">Written Off</option>
              </optgroup>
            </select>
          </div>
          {isReceivable && (
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '140px' }}
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="">All Stages</option>
              <option value="collections_agency">Collections Agency</option>
              <option value="demand_letter">Demand Letter</option>
              <option value="final_notice">Final Notice</option>
              <option value="garnishment">Garnishment</option>
              <option value="judgment">Judgment</option>
              <option value="legal_action">Legal Action</option>
              <option value="reminder">Reminder</option>
              <option value="warning">Warning</option>
            </select>
          )}
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '120px' }}
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
          </select>
          {/* Feature 19: Age Range Filter */}
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '110px' }}
            value={ageFilter}
            onChange={(e) => setAgeFilter(e.target.value)}
          >
            <option value="">All Ages</option>
            <option value="0-30">0-30 days</option>
            <option value="31-60">31-60 days</option>
            <option value="61-90">61-90 days</option>
            <option value="90+">90+ days</option>
          </select>
          {/* Feature 20: Amount Range Filter */}
          <input
            type="number"
            className="block-input"
            style={{ width: '100px' }}
            placeholder="Min $"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
          />
          <input
            type="number"
            className="block-input"
            style={{ width: '100px' }}
            placeholder="Max $"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
          />
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
          />
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
          />
          {/* Feature 21: Collector Filter */}
          <select
            className="block-select"
            style={{ fontSize: 12 }}
            value={collectorFilter}
            onChange={e => setCollectorFilter(e.target.value)}
          >
            <option value="">All Collectors</option>
            {[...users]
              .sort((a, b) => (a.display_name || a.email || '').localeCompare(b.display_name || b.email || '', undefined, { sensitivity: 'base' }))
              .map(u => (
              <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
            ))}
          </select>
        </div>

        {/* Feature 22-24: Sort Dropdown */}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border-primary">
          <ArrowUpDown size={12} className="text-text-muted" />
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Sort by:</span>
          <select
            className="block-select text-xs"
            style={{ width: 'auto', minWidth: '160px' }}
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
          >
            <option value="created_at">Date Created</option>
            <option value="debtor_name">Name</option>
            <option value="balance_due">Balance Due</option>
            <option value="original_amount">Original Amount</option>
            <option value="age">Age (Days)</option>
            <option value="priority_score">Priority Score</option>
            <option value="last_contact">Last Contact</option>
          </select>
          <button
            className="block-btn text-xs py-1 px-2"
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDir === 'asc' ? '▲ Asc' : '▼ Desc'}
          </button>
          {(ageFilter || amountMin || amountMax || statusFilter || stageFilter || priorityFilter || collectorFilter || dateFrom || dateTo || search) && (
            <button
              className="block-btn text-xs py-1 px-2 ml-2 text-accent-expense"
              onClick={() => {
                setSearch(''); setStatusFilter(''); setStageFilter(''); setPriorityFilter('');
                setDateFrom(''); setDateTo(''); setCollectorFilter('');
                setAgeFilter(''); setAmountMin(''); setAmountMax('');
              }}
            >
              Clear All Filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Scale size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">
            {debts.length === 0 ? `No ${label} debts yet` : `No ${label} debts match your filter`}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {debts.length === 0
              ? 'Create one or import from overdue invoices.'
              : 'Try clearing search or filters.'}
          </p>
          {debts.length === 0 && (
            <button className="block-btn-primary flex items-center gap-2 mx-auto mt-3" onClick={onNew}>
              <Plus size={14} /> Create New Debt
            </button>
          )}
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              {isReceivable ? (
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selectedIds.size === sorted.length && sorted.length > 0} onChange={toggleSelectAll} />
                  </th>
                  {/* Feature 25: Risk Indicator column */}
                  <th style={{ width: 28 }}></th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('debtor_name')}>
                    Debtor <SortIndicator field="debtor_name" />
                  </th>
                  <th>Source</th>
                  <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('original_amount')}>
                    Original <SortIndicator field="original_amount" />
                  </th>
                  <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('balance_due')}>
                    Balance Due <SortIndicator field="balance_due" />
                  </th>
                  <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('age')}>
                    Age <SortIndicator field="age" />
                  </th>
                  <th>Stage</th>
                  <th>Priority</th>
                  <th>Risk</th>
                  {/* Feature 26: Last Contact column */}
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('last_contact')}>
                    Last Contact <SortIndicator field="last_contact" />
                  </th>
                  {/* Feature 27: Quick Actions */}
                  <th style={{ width: '120px' }}>Actions</th>
                </tr>
              ) : (
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selectedIds.size === sorted.length && sorted.length > 0} onChange={toggleSelectAll} />
                  </th>
                  <th style={{ width: 28 }}></th>
                  <th>Creditor</th>
                  <th>Source</th>
                  <th className="text-right">Original</th>
                  <th className="text-right">Balance Due</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Last Contact</th>
                  <th style={{ width: '120px' }}>Actions</th>
                </tr>
              )}
            </thead>
            <tbody>
              {sorted.map((debt) => {
                const sourceLabel =
                  debt.source_type === 'invoice'
                    ? `INV ${(debt.source_id || '').substring(0, 8)}`
                    : 'Manual';
                const balanceClass = debt.balance_due > 0 ? 'font-bold text-accent-expense' : 'font-bold';
                const stageBadge = formatStatus(debt.current_stage);
                const statusBadge = formatStatus(debt.status);
                const age = ageDays(debt.delinquent_date || debt.created_at);
                const rColor = riskColor(age, debt.balance_due || 0);
                const lastContact = lastContactMap[debt.id];
                const daysSinceContact = lastContact
                  ? Math.floor((Date.now() - new Date(lastContact).getTime()) / 86400000)
                  : null;

                return isReceivable ? (
                  <tr
                    key={debt.id}
                    className="cursor-pointer group"
                    onClick={() => onView(debt.id)}
                  >
                    <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(debt.id)} onChange={() => toggleSelect(debt.id)} />
                    </td>
                    {/* Feature 25: Risk Indicator Dot */}
                    <td>
                      <div
                        style={{
                          width: 10, height: 10, borderRadius: '50%', background: rColor,
                          boxShadow: `0 0 4px ${rColor}66`,
                        }}
                        title={`Risk: ${age}d old, ${formatCurrency(debt.balance_due)} balance`}
                      />
                    </td>
                    <td className="text-text-primary font-medium">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="block truncate max-w-[160px]">{debt.debtor_name}</span>
                        {!!debt.has_plan && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#2563eb22', color: '#60a5fa' }}>PLAN</span>
                        )}
                        {!!debt.has_pending_settlement && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#0891b222', color: '#06b6d4' }}>OFFER</span>
                        )}
                        {!!debt.has_active_promise && !debt.has_broken_promise && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#d9770622', color: '#f59e0b' }}>PROMISE</span>
                        )}
                        {!!debt.has_broken_promise && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#dc262622', color: '#f87171' }}>BROKEN</span>
                        )}
                        {debt.status === 'disputed' && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#a855f722', color: '#c084fc' }}>DISPUTED</span>
                        )}
                        {!!debt.cease_desist_active && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#dc262622', color: '#f87171' }}>C&D</span>
                        )}
                        {!!debt.do_not_call && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#d9770622', color: '#f59e0b' }}>DNC</span>
                        )}
                        {!!debt.interest_frozen && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#3b82f622', color: '#60a5fa' }}>FROZEN</span>
                        )}
                        {debt.statute_of_limitations_date && (() => {
                          const dLeft = Math.ceil((new Date(debt.statute_of_limitations_date).getTime() - Date.now()) / 86400000);
                          if (dLeft > 0 && dLeft <= 90) {
                            const sColor = dLeft < 30 ? '#ef4444' : dLeft < 90 ? '#f97316' : '#d97706';
                            return <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: sColor + '22', color: sColor }}>{dLeft}d SOL</span>;
                          }
                          return null;
                        })()}
                        {debt.currency && debt.currency !== 'USD' && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#6366f122', color: '#a78bfa' }}>{debt.currency}</span>
                        )}
                      </div>
                    </td>
                    <td className="text-text-secondary text-xs font-mono">{sourceLabel}</td>
                    <td className="text-right font-mono text-text-secondary">
                      {formatCurrency(debt.original_amount)}
                    </td>
                    <td className={`text-right font-mono ${balanceClass}`}>
                      {formatCurrency(debt.balance_due)}
                    </td>
                    <td className="text-right">
                      {(() => {
                        const badge = getAgingBadge(debt.delinquent_date);
                        return (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                            background: badge.bg, color: badge.color,
                            letterSpacing: '0.5px', textTransform: 'uppercase'
                          }}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      <span className={stageBadge.className}>{stageBadge.label}</span>
                    </td>
                    <td>
                      <ClassificationBadge def={DEBT_PRIORITY} value={debt.priority} />
                    </td>
                    <td>
                      {(() => {
                        const score = calcRiskScore(debt);
                        const risk = getRiskBadge(score);
                        return (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                            background: risk.color + '20', color: risk.color,
                          }}>
                            {risk.label}
                          </span>
                        );
                      })()}
                    </td>
                    {/* Feature 26: Last Contact */}
                    <td>
                      {daysSinceContact != null ? (
                        <span className="text-xs font-mono" style={{ color: daysSinceContact > 14 ? '#dc2626' : daysSinceContact > 7 ? '#f59e0b' : '#16a34a' }}>
                          {daysSinceContact}d ago
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted">Never</span>
                      )}
                    </td>
                    {/* Feature 27: Quick Action Buttons */}
                    <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          className="block-btn p-1"
                          title="View"
                          aria-label="View debt"
                          onClick={() => onView(debt.id)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          className="block-btn p-1"
                          title="Edit"
                          aria-label="Edit debt"
                          onClick={() => onEdit(debt.id)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="block-btn p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Log Call"
                          aria-label="Log call"
                          onClick={() => onView(debt.id)}
                        >
                          <Phone size={13} />
                        </button>
                        <button
                          className="block-btn p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Send Email"
                          aria-label="Send email"
                          onClick={() => onView(debt.id)}
                        >
                          <Mail size={13} />
                        </button>
                        <button
                          className="block-btn p-1 text-accent-expense hover:bg-accent-expense/10 transition-colors"
                          title="Delete"
                          aria-label="Delete debt"
                          onClick={() => handleDelete(debt.id, debt.debtor_name)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={debt.id}
                    className="cursor-pointer group"
                    onClick={() => onView(debt.id)}
                  >
                    <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(debt.id)} onChange={() => toggleSelect(debt.id)} />
                    </td>
                    {/* Risk Indicator */}
                    <td>
                      <div
                        style={{
                          width: 10, height: 10, borderRadius: '50%', background: rColor,
                          boxShadow: `0 0 4px ${rColor}66`,
                        }}
                        title={`${age}d old, ${formatCurrency(debt.balance_due)} balance`}
                      />
                    </td>
                    <td className="text-text-primary font-medium">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="block truncate max-w-[160px]">{debt.debtor_name}</span>
                        {!!debt.has_plan && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#2563eb22', color: '#60a5fa' }}>PLAN</span>
                        )}
                        {!!debt.has_pending_settlement && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#0891b222', color: '#06b6d4' }}>OFFER</span>
                        )}
                        {!!debt.has_active_promise && !debt.has_broken_promise && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#d9770622', color: '#f59e0b' }}>PROMISE</span>
                        )}
                        {!!debt.has_broken_promise && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#dc262622', color: '#f87171' }}>BROKEN</span>
                        )}
                        {debt.status === 'disputed' && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#a855f722', color: '#c084fc' }}>DISPUTED</span>
                        )}
                        {!!debt.cease_desist_active && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#dc262622', color: '#f87171' }}>C&D</span>
                        )}
                        {!!debt.do_not_call && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#d9770622', color: '#f59e0b' }}>DNC</span>
                        )}
                        {!!debt.interest_frozen && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#3b82f622', color: '#60a5fa' }}>FROZEN</span>
                        )}
                        {debt.statute_of_limitations_date && (() => {
                          const dLeft = Math.ceil((new Date(debt.statute_of_limitations_date).getTime() - Date.now()) / 86400000);
                          if (dLeft > 0 && dLeft <= 90) {
                            const sColor = dLeft < 30 ? '#ef4444' : dLeft < 90 ? '#f97316' : '#d97706';
                            return <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: sColor + '22', color: sColor }}>{dLeft}d SOL</span>;
                          }
                          return null;
                        })()}
                        {debt.currency && debt.currency !== 'USD' && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#6366f122', color: '#a78bfa' }}>{debt.currency}</span>
                        )}
                      </div>
                    </td>
                    <td className="text-text-secondary text-xs font-mono">{sourceLabel}</td>
                    <td className="text-right font-mono text-text-secondary">
                      {formatCurrency(debt.original_amount)}
                    </td>
                    <td className={`text-right font-mono ${balanceClass}`}>
                      {formatCurrency(debt.balance_due)}
                    </td>
                    <td className="font-mono text-text-secondary text-xs">
                      {formatDate(debt.due_date || debt.delinquent_date)}
                    </td>
                    <td>
                      <span className={statusBadge.className}>{statusBadge.label}</span>
                    </td>
                    {/* Last Contact for payables */}
                    <td>
                      {daysSinceContact != null ? (
                        <span className="text-xs font-mono" style={{ color: daysSinceContact > 14 ? '#dc2626' : daysSinceContact > 7 ? '#f59e0b' : '#16a34a' }}>
                          {daysSinceContact}d ago
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted">Never</span>
                      )}
                    </td>
                    <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          className="block-btn p-1"
                          title="View"
                          aria-label="View debt"
                          onClick={() => onView(debt.id)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          className="block-btn p-1"
                          title="Edit"
                          aria-label="Edit debt"
                          onClick={() => onEdit(debt.id)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="block-btn p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Log Call"
                          aria-label="Log call"
                          onClick={() => onView(debt.id)}
                        >
                          <Phone size={13} />
                        </button>
                        <button
                          className="block-btn p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Send Email"
                          aria-label="Send email"
                          onClick={() => onView(debt.id)}
                        >
                          <Mail size={13} />
                        </button>
                        <button
                          className="block-btn p-1 text-accent-expense hover:bg-accent-expense/10 transition-colors"
                          title="Delete"
                          aria-label="Delete debt"
                          onClick={() => handleDelete(debt.id, debt.debtor_name)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={isReceivable ? 4 : 4}
                  className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider"
                >
                  Total
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {formatCurrency(sorted.reduce((s, d) => s + (d.original_amount || 0), 0))}
                </td>
                <td className="text-right font-mono font-bold text-accent-expense">
                  {formatCurrency(totalOutstanding)}
                </td>
                <td colSpan={isReceivable ? 6 : 4} />
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {sorted.length} of {debts.length} debt{debts.length !== 1 ? 's' : ''}
          {sortField !== 'created_at' && <span> &middot; Sorted by {sortField.replace('_', ' ')}</span>}
        </div>
      )}

      {showMatchReview && (
        <PaymentMatchReview
          onClose={() => setShowMatchReview(false)}
          onDone={() => reload()}
        />
      )}
    </div>
  );
};

export default DebtList;
