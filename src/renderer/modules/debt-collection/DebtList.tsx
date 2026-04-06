import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Scale, Plus, Search, Filter, Download, Eye, Pencil, AlertTriangle, Play } from 'lucide-react';
import api from '../../lib/api';
import { downloadCSVBlob } from '../../lib/csv-export';
import { formatCurrency } from '../../lib/format';
import { formatStatus } from '../../lib/format';
import { formatDate } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import { SummaryBar } from '../../components/SummaryBar';

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
}

interface DebtListProps {
  type: 'receivable' | 'payable';
  onNew: () => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
}

// ─── Priority Colors ────────────────────────────────────
const priorityColor: Record<string, string> = {
  low: 'text-accent-income',
  medium: 'text-blue-500',
  high: 'text-orange-500',
  critical: 'text-accent-expense',
};

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
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    total_outstanding: number;
    in_collection: number;
    legal_active: number;
    collected_this_month: number;
    writeoffs_ytd: number;
  } | null>(null);

  // Import overdue state
  const [showImportForm, setShowImportForm] = useState(false);
  const [importDays, setImportDays] = useState(30);
  const [importLoading, setImportLoading] = useState(false);

  // Escalation state
  const [escalationLoading, setEscalationLoading] = useState(false);
  const [escalationResult, setEscalationResult] = useState<{ advanced: number; flagged: number } | null>(null);

  // ─── Load Data ──────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const data = await api.rawQuery(
        `SELECT * FROM debts WHERE company_id = ? AND type = ? ORDER BY created_at DESC`,
        [activeCompany.id, type]
      );
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
        const [debtData, statsData] = await Promise.all([
          api.rawQuery(
            `SELECT * FROM debts WHERE company_id = ? AND type = ? ORDER BY created_at DESC`,
            [activeCompany.id, type]
          ),
          api.debtStats(activeCompany.id),
        ]);
        if (cancelled) return;
        setDebts(Array.isArray(debtData) ? debtData : []);
        setStats(statsData ?? null);
      } catch (err) {
        console.error('Failed to load debts:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany, type]);

  // ─── In-Memory Filters ──────────────────────────────────
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
      return true;
    });
  }, [debts, search, statusFilter, stageFilter, priorityFilter, dateFrom, dateTo]);

  const totalOutstanding = useMemo(
    () => filtered.reduce((sum, d) => sum + (d.balance_due || 0), 0),
    [filtered]
  );

  // ─── Import Overdue Invoices ────────────────────────────
  const handleImportOverdue = useCallback(async () => {
    if (!activeCompany) return;
    setImportLoading(true);
    try {
      const result = await api.debtImportOverdueInvoices(activeCompany.id, importDays);
      await reload();
      setShowImportForm(false);
      alert(`Imported ${result.imported} overdue invoice(s) as debts.`);
    } catch (err) {
      console.error('Import overdue failed:', err);
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
    } catch (err) {
      console.error('Escalation failed:', err);
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

  // ─── Age Calculation ────────────────────────────────────
  const ageDays = (delinquentDate: string): number => {
    return Math.floor((Date.now() - new Date(delinquentDate).getTime()) / 86400000);
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
        <div className="flex items-center gap-2">
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

      {/* Summary Bar */}
      {stats && (
        <SummaryBar items={[
          { label: 'Total Outstanding', value: formatCurrency(stats.total_outstanding) },
          { label: 'In Collection', value: formatCurrency(stats.in_collection), accent: 'orange' },
          { label: 'Legal Active', value: formatCurrency(stats.legal_active), accent: 'red' },
          { label: 'Collected This Month', value: formatCurrency(stats.collected_this_month), accent: 'green' },
          { label: 'Write-offs YTD', value: formatCurrency(stats.writeoffs_ytd) },
        ]} />
      )}

      {/* Filters */}
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
              <option value="active">Active</option>
              <option value="in_collection">In Collection</option>
              <option value="legal">Legal</option>
              <option value="settled">Settled</option>
              <option value="written_off">Written Off</option>
              <option value="disputed">Disputed</option>
              <option value="bankruptcy">Bankruptcy</option>
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
              <option value="reminder">Reminder</option>
              <option value="warning">Warning</option>
              <option value="final_notice">Final Notice</option>
              <option value="demand_letter">Demand Letter</option>
              <option value="collections_agency">Collections Agency</option>
              <option value="legal_action">Legal Action</option>
              <option value="judgment">Judgment</option>
              <option value="garnishment">Garnishment</option>
            </select>
          )}
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '120px' }}
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="">All Priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
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
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Scale size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">
            No {label} debts found
          </p>
          <p className="text-xs text-text-muted mt-1">
            Create one or import from overdue invoices.
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              {isReceivable ? (
                <tr>
                  <th>Debtor</th>
                  <th>Source</th>
                  <th className="text-right">Original</th>
                  <th className="text-right">Balance Due</th>
                  <th className="text-right">Age (days)</th>
                  <th>Stage</th>
                  <th>Priority</th>
                  <th style={{ width: '90px' }}>Actions</th>
                </tr>
              ) : (
                <tr>
                  <th>Creditor</th>
                  <th>Source</th>
                  <th className="text-right">Original</th>
                  <th className="text-right">Balance Due</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th style={{ width: '90px' }}>Actions</th>
                </tr>
              )}
            </thead>
            <tbody>
              {filtered.map((debt) => {
                const sourceLabel =
                  debt.source_type === 'invoice'
                    ? `INV ${(debt.source_id || '').substring(0, 8)}`
                    : 'Manual';
                const balanceClass = debt.balance_due > 0 ? 'font-bold text-accent-expense' : 'font-bold';
                const stageBadge = formatStatus(debt.current_stage);
                const statusBadge = formatStatus(debt.status);

                return isReceivable ? (
                  <tr
                    key={debt.id}
                    className="cursor-pointer"
                    onClick={() => onView(debt.id)}
                  >
                    <td className="text-text-primary font-medium">{debt.debtor_name}</td>
                    <td className="text-text-secondary text-xs font-mono">{sourceLabel}</td>
                    <td className="text-right font-mono text-text-secondary">
                      {formatCurrency(debt.original_amount)}
                    </td>
                    <td className={`text-right font-mono ${balanceClass}`}>
                      {formatCurrency(debt.balance_due)}
                    </td>
                    <td className="text-right font-mono text-text-secondary">
                      {ageDays(debt.delinquent_date)} days
                    </td>
                    <td>
                      <span className={stageBadge.className}>{stageBadge.label}</span>
                    </td>
                    <td>
                      <span className={`text-xs font-semibold uppercase ${priorityColor[debt.priority] || 'text-text-muted'}`}>
                        {debt.priority}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          className="block-btn p-1"
                          title="View"
                          onClick={() => onView(debt.id)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          className="block-btn p-1"
                          title="Edit"
                          onClick={() => onEdit(debt.id)}
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={debt.id}
                    className="cursor-pointer"
                    onClick={() => onView(debt.id)}
                  >
                    <td className="text-text-primary font-medium">{debt.debtor_name}</td>
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
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          className="block-btn p-1"
                          title="View"
                          onClick={() => onView(debt.id)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          className="block-btn p-1"
                          title="Edit"
                          onClick={() => onEdit(debt.id)}
                        >
                          <Pencil size={14} />
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
                  colSpan={isReceivable ? 3 : 3}
                  className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider"
                >
                  Total
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {formatCurrency(totalOutstanding)}
                </td>
                <td colSpan={isReceivable ? 4 : 3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default DebtList;
