import React, { useEffect, useState, useMemo } from 'react';
import {
  Wallet,
  Plus,
  Trash2,
  Search,
  Printer,
  Download,
  Copy,
  Power,
  AlertTriangle,
  TrendingUp,
  CheckCircle,
  Target,
} from 'lucide-react';
import api from '../../lib/api';
import { formatDate, formatStatus, formatCurrency } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface Budget {
  id: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'annual';
  start_date: string;
  end_date: string;
  status: 'active' | 'closed';
}

interface BudgetLine {
  id: string;
  budget_id: string;
  account_id: string | null;
  category: string;
  amount: number;
  notes?: string;
}

interface BudgetActuals {
  budget: Budget;
  budgeted: number;
  actual: number;
  variance: number;
  variancePct: number;
  utilizationPct: number;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedEnd: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface BudgetListProps {
  onNew: () => void;
  onSelect: (id: string) => void;
}

const periodLabel: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

const RISK_COLORS = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#ef4444',
};

type StatusFilter = 'all' | 'active' | 'completed' | 'over_budget' | 'under_budget';
type PeriodFilter = 'all' | 'current' | 'past' | 'future';

// ─── Component ──────────────────────────────────────────
const BudgetList: React.FC<BudgetListProps> = ({ onNew, onSelect }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [actualsMap, setActualsMap] = useState<Map<string, BudgetActuals>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  type SortField = 'name' | 'period' | 'start_date' | 'end_date' | 'status' | 'variance_pct';
  type SortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('start_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadBudgets = async () => {
    if (!activeCompany) return;
    try {
      const data = await api.query(
        'budgets',
        { company_id: activeCompany.id },
        { field: 'start_date', dir: 'desc' }
      );
      const list: Budget[] = Array.isArray(data) ? data : [];
      setBudgets(list);

      // Compute actuals per budget for inline stats / variance / risk
      const today = new Date();
      const m = new Map<string, BudgetActuals>();
      for (const budget of list) {
        try {
          const lines: BudgetLine[] = await api.query('budget_lines', {
            budget_id: budget.id,
          });
          const budgeted = (lines || []).reduce(
            (s, l) => s + (Number(l.amount) || 0),
            0
          );
          const accountIds = (lines || [])
            .map((l) => l.account_id)
            .filter((x): x is string => !!x);
          let actual = 0;
          if (accountIds.length > 0) {
            try {
              const ph = accountIds.map(() => '?').join(',');
              const rows: any[] = await api.rawQuery(
                `SELECT SUM(jel.debit - jel.credit) AS spend
                 FROM journal_entry_lines jel
                 JOIN journal_entries je ON je.id = jel.journal_entry_id
                 WHERE je.company_id = ?
                   AND jel.account_id IN (${ph})
                   AND je.date >= ? AND je.date <= ?`,
                [
                  activeCompany.id,
                  ...accountIds,
                  budget.start_date,
                  budget.end_date,
                ]
              );
              actual = Number(rows?.[0]?.spend) || 0;
            } catch {
              /* ignore */
            }
          }
          const variance = budgeted - actual;
          const variancePct = budgeted > 0 ? (variance / budgeted) * 100 : 0;
          const utilizationPct =
            budgeted > 0 ? (actual / budgeted) * 100 : 0;
          const start = new Date(budget.start_date);
          const end = new Date(budget.end_date);
          const daysTotal = Math.max(
            1,
            Math.ceil((end.getTime() - start.getTime()) / 86400000)
          );
          const daysElapsed = Math.max(
            0,
            Math.min(
              daysTotal,
              Math.ceil((today.getTime() - start.getTime()) / 86400000)
            )
          );
          const daysRemaining = Math.max(0, daysTotal - daysElapsed);
          const projectedEnd =
            daysElapsed > 0 ? (actual / daysElapsed) * daysTotal : actual;
          let riskLevel: 'low' | 'medium' | 'high' = 'low';
          if (utilizationPct > 100 || projectedEnd > budgeted * 1.05)
            riskLevel = 'high';
          else if (utilizationPct >= 80 || projectedEnd > budgeted * 0.95)
            riskLevel = 'medium';
          m.set(budget.id, {
            budget,
            budgeted,
            actual,
            variance,
            variancePct,
            utilizationPct,
            daysTotal,
            daysElapsed,
            daysRemaining,
            projectedEnd,
            riskLevel,
          });
        } catch {
          /* skip */
        }
      }
      setActualsMap(m);
    } catch (err) {
      console.error('Failed to load budgets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBudgets();
  }, [activeCompany]);

  const handleSort = (f: SortField) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc'); } };

  const filtered = useMemo(() => {
    let list = [...budgets];
    const today = new Date().toISOString().slice(0, 10);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.name?.toLowerCase().includes(q) ||
          b.period?.toLowerCase().includes(q) ||
          b.status?.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== 'all') {
      list = list.filter((b) => {
        const a = actualsMap.get(b.id);
        if (statusFilter === 'active') return b.status === 'active';
        if (statusFilter === 'completed') return b.status === 'closed';
        if (statusFilter === 'over_budget')
          return a ? a.utilizationPct > 100 : false;
        if (statusFilter === 'under_budget')
          return a ? a.utilizationPct <= 100 : false;
        return true;
      });
    }

    if (periodFilter !== 'all') {
      list = list.filter((b) => {
        if (periodFilter === 'current')
          return b.start_date <= today && b.end_date >= today;
        if (periodFilter === 'past') return b.end_date < today;
        if (periodFilter === 'future') return b.start_date > today;
        return true;
      });
    }

    list.sort((a, b) => {
      let aVal: any;
      let bVal: any;
      if (sortField === 'variance_pct') {
        aVal = actualsMap.get(a.id)?.variancePct ?? 0;
        bVal = actualsMap.get(b.id)?.variancePct ?? 0;
      } else {
        aVal = (a as any)[sortField] ?? '';
        bVal = (b as any)[sortField] ?? '';
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [budgets, search, sortField, sortDir, statusFilter, periodFilter, actualsMap]);

  // Inline stats from filtered list
  const inlineStats = useMemo(() => {
    let totalBudgeted = 0;
    let totalActual = 0;
    let overCount = 0;
    let activeCount = 0;
    for (const b of filtered) {
      const a = actualsMap.get(b.id);
      if (a) {
        totalBudgeted += a.budgeted;
        totalActual += a.actual;
        if (a.utilizationPct > 100) overCount += 1;
      }
      if (b.status === 'active') activeCount += 1;
    }
    return { totalBudgeted, totalActual, overCount, activeCount };
  }, [filtered, actualsMap]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this budget and all its line items?')) return;
    try {
      // Delete budget lines first, then the budget
      const lines = await api.query('budget_lines', { budget_id: id });
      if (Array.isArray(lines)) {
        for (const line of lines) {
          await api.remove('budget_lines', line.id);
        }
      }
      await api.remove('budgets', id);
      await loadBudgets();
      setOpSuccess('Budget deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete budget:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(item => item.id)));
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} budget${selectedIds.size !== 1 ? 's' : ''} and all their line items?`)) return;
    setBatchDeleting(true);
    try {
      for (const id of selectedIds) {
        const lines = await api.query('budget_lines', { budget_id: id });
        if (Array.isArray(lines)) {
          for (const line of lines) {
            await api.remove('budget_lines', line.id);
          }
        }
        await api.remove('budgets', id);
      }
      setSelectedIds(new Set());
      await loadBudgets();
      setOpSuccess(`Deleted ${selectedIds.size} budget${selectedIds.size !== 1 ? 's' : ''}`);
      setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to batch delete budgets:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error'));
      setTimeout(() => setOpError(''), 5000);
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBulkToggleActive = async (
    target: 'active' | 'closed'
  ) => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      for (const id of selectedIds) {
        await api.update('budgets', id, { status: target });
      }
      setSelectedIds(new Set());
      await loadBudgets();
      setOpSuccess(
        `${target === 'active' ? 'Activated' : 'Deactivated'} ${selectedIds.size} budget${selectedIds.size !== 1 ? 's' : ''}`
      );
      setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      setOpError('Failed: ' + (err?.message || 'Unknown error'));
      setTimeout(() => setOpError(''), 5000);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleQuickCopy = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const orig = await api.get('budgets', id);
      if (!orig) return;
      // Calculate next-period dates
      const start = new Date(orig.start_date);
      const end = new Date(orig.end_date);
      const span = end.getTime() - start.getTime();
      const newStart = new Date(end.getTime() + 86400000);
      const newEnd = new Date(newStart.getTime() + span);
      const fmtISO = (d: Date) => d.toISOString().slice(0, 10);

      const cloneRes = await api.create('budgets', {
        company_id: activeCompany!.id,
        name: `${orig.name} (Copy)`,
        period: orig.period,
        start_date: fmtISO(newStart),
        end_date: fmtISO(newEnd),
        status: 'active',
      });
      const newId = cloneRes?.id ?? cloneRes;

      // Copy lines
      const oldLines = await api.query('budget_lines', { budget_id: id });
      if (Array.isArray(oldLines)) {
        for (const ln of oldLines) {
          await api.create('budget_lines', {
            budget_id: newId,
            account_id: ln.account_id,
            category: ln.category,
            amount: ln.amount,
            notes: ln.notes,
          });
        }
      }
      await loadBudgets();
      setOpSuccess('Budget duplicated to next period');
      setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      setOpError('Failed to copy: ' + (err?.message || 'Unknown error'));
      setTimeout(() => setOpError(''), 5000);
    }
  };

  const handleExportCSV = async () => {
    try {
      const rows: string[] = [
        'Budget,Period,Start,End,Status,Category,Account,Budgeted,Actual,Variance,Variance %',
      ];
      for (const b of filtered) {
        const a = actualsMap.get(b.id);
        const lines: BudgetLine[] = await api.query('budget_lines', {
          budget_id: b.id,
        });
        if (!lines || lines.length === 0) {
          rows.push(
            [
              JSON.stringify(b.name),
              b.period,
              b.start_date,
              b.end_date,
              b.status,
              '',
              '',
              a?.budgeted ?? 0,
              a?.actual ?? 0,
              a?.variance ?? 0,
              a?.variancePct?.toFixed(2) ?? '',
            ].join(',')
          );
        } else {
          for (const l of lines) {
            rows.push(
              [
                JSON.stringify(b.name),
                b.period,
                b.start_date,
                b.end_date,
                b.status,
                JSON.stringify(l.category || ''),
                l.account_id || '',
                l.amount,
                '',
                '',
                '',
              ].join(',')
            );
          }
        }
      }
      const csv = rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budgets-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setOpSuccess('Exported to CSV');
      setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      setOpError('Export failed: ' + (err?.message || 'Unknown error'));
      setTimeout(() => setOpError(''), 5000);
    }
  };

  const handlePrintSummary = async () => {
    const rows = filtered
      .map((b) => {
        const a = actualsMap.get(b.id);
        return `<tr>
          <td>${b.name}</td>
          <td>${b.period}</td>
          <td>${b.start_date}</td>
          <td>${b.end_date}</td>
          <td>${b.status}</td>
          <td style="text-align:right">${formatCurrency(a?.budgeted ?? 0)}</td>
          <td style="text-align:right">${formatCurrency(a?.actual ?? 0)}</td>
          <td style="text-align:right">${formatCurrency(a?.variance ?? 0)}</td>
          <td style="text-align:right">${a ? a.variancePct.toFixed(1) + '%' : '—'}</td>
        </tr>`;
      })
      .join('');
    const html = `
      <html><head><title>Budget Summary</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#222}
        h1{font-size:18px;margin:0 0 4px 0}
        .sub{font-size:11px;color:#666;margin-bottom:16px}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #ddd;padding:6px;text-align:left}
        th{background:#f3f4f6;text-transform:uppercase;font-size:10px}
        .totals{margin-top:18px;font-size:12px}
      </style></head>
      <body>
        <h1>Budget Summary</h1>
        <div class="sub">${activeCompany?.name ?? ''} — Generated ${new Date().toLocaleString()}</div>
        <table>
          <thead><tr>
            <th>Budget</th><th>Period</th><th>Start</th><th>End</th><th>Status</th>
            <th style="text-align:right">Budgeted</th>
            <th style="text-align:right">Actual</th>
            <th style="text-align:right">Variance</th>
            <th style="text-align:right">Var %</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="totals">
          <strong>Totals:</strong>
          Budgeted ${formatCurrency(inlineStats.totalBudgeted)} •
          Actual ${formatCurrency(inlineStats.totalActual)} •
          Over budget: ${inlineStats.overCount}
        </div>
      </body></html>`;
    try {
      await api.printPreview(html, 'Budget Summary');
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading budgets...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <Wallet size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Budgets</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {budgets.length} budget{budgets.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={handleExportCSV}
            disabled={filtered.length === 0}
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={handlePrintSummary}
            disabled={filtered.length === 0}
          >
            <Printer size={14} /> Print Summary
          </button>
          <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
            <Plus size={16} />
            New Budget
          </button>
        </div>
      </div>

      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20" style={{ borderRadius: '6px' }}>{opError}</div>}

      {/* Inline KPI row */}
      {budgets.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Active</div>
                <div className="stat-value font-mono text-accent-blue">
                  {inlineStats.activeCount}
                </div>
              </div>
              <Target size={18} className="text-accent-blue opacity-60 mt-1" />
            </div>
          </div>
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Budgeted</div>
                <div className="stat-value font-mono text-text-primary">
                  {formatCurrency(inlineStats.totalBudgeted)}
                </div>
              </div>
              <TrendingUp size={18} className="text-accent-blue opacity-60 mt-1" />
            </div>
          </div>
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Actual</div>
                <div className="stat-value font-mono text-accent-expense">
                  {formatCurrency(inlineStats.totalActual)}
                </div>
              </div>
              <TrendingUp size={18} className="text-accent-expense opacity-60 mt-1" />
            </div>
          </div>
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Over Budget</div>
                <div className="stat-value font-mono text-accent-expense">
                  {inlineStats.overCount}
                </div>
              </div>
              <AlertTriangle
                size={18}
                className="text-accent-expense opacity-60 mt-1"
              />
            </div>
          </div>
        </div>
      )}

      {/* Filters row */}
      {budgets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              className="block-input pl-8"
              placeholder="Search budgets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="block-select text-xs"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ minWidth: 140 }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="over_budget">Over Budget</option>
            <option value="under_budget">Under Budget</option>
          </select>
          <select
            className="block-select text-xs"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
            style={{ minWidth: 130 }}
          >
            <option value="all">All Periods</option>
            <option value="current">Current</option>
            <option value="past">Past</option>
            <option value="future">Future</option>
          </select>
        </div>
      )}

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="block-card p-3 flex items-center justify-between" style={{ borderRadius: '6px', borderColor: 'rgba(59,130,246,0.3)' }}>
          <span className="text-xs font-semibold text-text-primary">
            {selectedIds.size} budget{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={() => handleBulkToggleActive('active')}
              disabled={bulkBusy}
              title="Mark selected as active"
            >
              <Power size={12} /> Activate
            </button>
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={() => handleBulkToggleActive('closed')}
              disabled={bulkBusy}
              title="Mark selected as closed"
            >
              <Power size={12} /> Deactivate
            </button>
            <button
              className="block-btn-danger flex items-center gap-1.5 text-xs"
              onClick={handleBatchDelete}
              disabled={batchDeleting}
            >
              <Trash2 size={12} />
              {batchDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Wallet size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No budgets created</p>
          <p className="text-xs text-text-muted mt-1">
            Create your first budget to start tracking spending.
          </p>
          <button className="block-btn-primary mt-3 flex items-center gap-2" onClick={onNew}>
            <Plus size={14} /> Create Budget
          </button>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                    style={{ accentColor: '#3b82f6' }}
                  />
                </th>
                <th style={{ width: '32px' }}>Risk</th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('name')}><span className="inline-flex items-center gap-1">Name {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('period')}><span className="inline-flex items-center gap-1">Period {sortField === 'period' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('start_date')}><span className="inline-flex items-center gap-1">Start {sortField === 'start_date' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('end_date')}><span className="inline-flex items-center gap-1">End {sortField === 'end_date' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-right">Budgeted</th>
                <th className="text-right">Actual</th>
                <th
                  className="text-right cursor-pointer select-none"
                  onClick={() => handleSort('variance_pct')}
                >
                  <span className="inline-flex items-center gap-1">
                    Var % {sortField === 'variance_pct' && (sortDir === 'asc' ? '↑' : '↓')}
                  </span>
                </th>
                <th className="text-right">Forecast</th>
                <th className="text-center cursor-pointer select-none" onClick={() => handleSort('status')}><span className="inline-flex items-center gap-1">Status {sortField === 'status' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const a = actualsMap.get(b.id);
                const willOverrun =
                  a && a.budgeted > 0 && a.projectedEnd > a.budgeted;
                return (
                  <tr
                    key={b.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(b.id)}
                  >
                    <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(b.id)}
                        onChange={() => toggleSelect(b.id)}
                        className="cursor-pointer"
                        style={{ accentColor: '#3b82f6' }}
                      />
                    </td>
                    <td className="text-center">
                      <span
                        title={`Risk: ${a?.riskLevel ?? 'unknown'}`}
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          backgroundColor: a
                            ? RISK_COLORS[a.riskLevel]
                            : 'var(--color-text-muted)',
                        }}
                      />
                    </td>
                    <td className="text-text-primary font-medium text-sm truncate max-w-[180px]">{b.name}</td>
                    <td className="text-text-secondary text-sm">
                      {periodLabel[b.period] || b.period}
                    </td>
                    <td className="font-mono text-text-secondary text-xs">{formatDate(b.start_date)}</td>
                    <td className="font-mono text-text-secondary text-xs">{formatDate(b.end_date)}</td>
                    <td className="text-right font-mono text-text-secondary text-xs">
                      {a ? formatCurrency(a.budgeted) : '—'}
                    </td>
                    <td className="text-right font-mono text-text-secondary text-xs">
                      {a ? formatCurrency(a.actual) : '—'}
                    </td>
                    <td
                      className={`text-right font-mono text-xs ${
                        a
                          ? a.variance >= 0
                            ? 'text-accent-income'
                            : 'text-accent-expense'
                          : 'text-text-muted'
                      }`}
                    >
                      {a
                        ? `${a.variancePct >= 0 ? '+' : ''}${a.variancePct.toFixed(1)}%`
                        : '—'}
                    </td>
                    <td
                      className={`text-right font-mono text-xs ${
                        willOverrun ? 'text-accent-expense' : 'text-text-muted'
                      }`}
                      title="Linear projection: actual ÷ days elapsed × period total"
                    >
                      {a
                        ? `${formatCurrency(a.projectedEnd)}${
                            willOverrun ? ' ⚠' : ''
                          }`
                        : '—'}
                    </td>
                    <td className="text-center">
                      <span className={formatStatus(b.status).className}>
                        {formatStatus(b.status).label}
                      </span>
                    </td>
                    <td className="text-center cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1 hover:bg-accent-blue/10"
                          onClick={(e) => handleQuickCopy(e, b.id)}
                          title="Duplicate to next period"
                          aria-label="Duplicate budget"
                        >
                          <Copy size={10} />
                        </button>
                        <button
                          className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1 text-accent-expense hover:bg-accent-expense/10"
                          onClick={(e) => handleDelete(e, b.id)}
                          title="Delete budget"
                          aria-label="Delete budget"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {budgets.length} budget{budgets.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default BudgetList;
