import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Users, Plus, Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, Download, Check, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';
import {
  EMPLOYEE_ROLE, EMPLOYEE_DEPARTMENT, EMPLOYEE_WORK_LOCATION, EMPLOYMENT_STATUS, EMPLOYEE_COST_CLASS,
  ClassificationBadge,
} from '../../lib/classifications';

// ─── Types ──────────────────────────────────────────────
interface Employee {
  id: string;
  name: string;
  email: string;
  type: 'employee' | 'contractor';
  pay_type: 'salary' | 'hourly';
  pay_rate: number;
  pay_schedule: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  status: string;
  role?: string;
  department?: string;
  work_location?: string;
  cost_class?: string;
}

type SortField = 'name' | 'email' | 'type' | 'pay_type' | 'pay_rate' | 'pay_schedule' | 'status';
type SortDir = 'asc' | 'desc';
type TypeFilter = 'all' | 'employee' | 'contractor';
type StatusFilter = 'all' | 'active' | 'inactive';

interface EmployeeListProps {
  onSelectEmployee: (id: string) => void;
  onNewEmployee: () => void;
}

const scheduleLabels: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly',
};

const COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#4f46e5', '#ca8a04'];

// ─── Column Header (module-level to avoid re-creation) ──
const SortableHeader: React.FC<{
  field: SortField;
  label: string;
  activeSortField: SortField;
  activeSortDir: SortDir;
  onSort: (field: SortField) => void;
}> = ({ field, label, activeSortField, activeSortDir, onSort }) => {
  const isActive = activeSortField === field;
  const Icon = !isActive ? ArrowUpDown : activeSortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className="cursor-pointer select-none hover:text-text-primary transition-colors"
      onClick={() => onSort(field)}
      aria-sort={isActive ? (activeSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon size={12} className={isActive ? 'text-accent-blue' : 'text-text-muted'} />
      </span>
    </th>
  );
};

// ─── Component ──────────────────────────────────────────
const EmployeeList: React.FC<EmployeeListProps> = ({ onSelectEmployee, onNewEmployee }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [error, setError] = useState('');
  const [payrollData, setPayrollData] = useState<Record<string, any>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ─── Load Data ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoading(true);
        setError('');
        const rows = await api.query('employees', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' });
        if (!cancelled) {
          setEmployees(Array.isArray(rows) ? rows : []);
        }
        // Enrich with payroll data (scoped to the active company to avoid cross-company leaks)
        api.rawQuery(
          `SELECT ps.employee_id,
            MAX(pr.pay_date) as last_pay_date,
            COALESCE(SUM(ps.gross_pay), 0) as ytd_gross
           FROM pay_stubs ps
           JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
           WHERE pr.pay_date >= ? AND pr.company_id = ?
           GROUP BY ps.employee_id`,
          [new Date().getFullYear() + '-01-01', activeCompany.id]
        ).then(payRows => {
          if (!cancelled && Array.isArray(payRows)) {
            const map: Record<string, any> = {};
            for (const r of payRows) map[r.employee_id] = r;
            setPayrollData(map);
          }
        }).catch(() => {});
      } catch (err: any) {
        console.error('Failed to load employees:', err);
        if (!cancelled) {
          setEmployees([]);
          setError(err?.message || 'Failed to load employees');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  // ─── Sort Handler ───────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // ─── Filtered & Sorted List ─────────────────────────
  const filtered = useMemo(() => {
    let list = [...employees];

    if (typeFilter !== 'all') {
      list = list.filter((e) => e.type === typeFilter);
    }

    if (statusFilter !== 'all') {
      list = list.filter((e) => e.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.name?.toLowerCase().includes(q) ||
          e.email?.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      const aVal = (a[sortField] ?? '') as string | number;
      const bVal = (b[sortField] ?? '') as string | number;
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [employees, typeFilter, statusFilter, searchQuery, sortField, sortDir]);

  // ─── Workforce Stats ────────────────────────────────
  const stats = useMemo(() => {
    const active = employees.filter(e => e.status === 'active');
    const contractors = employees.filter(e => e.type === 'contractor');
    const totalCost = active.reduce((s, e) => s + (e.pay_type === 'salary' ? e.pay_rate : e.pay_rate * 2080), 0);
    return {
      total: employees.length,
      active: active.length,
      inactive: employees.length - active.length,
      contractors: contractors.length,
      totalCost,
      avgSalary: active.length > 0 ? totalCost / active.length : 0,
    };
  }, [employees]);

  // ─── Department Distribution ────────────────────────
  const deptCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of employees) {
      const dept = e.department || '';
      map[dept] = (map[dept] || 0) + 1;
    }
    const total = employees.length;
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: total > 0 ? (count / total) * 100 : 0 }));
  }, [employees]);

  // ─── Pay Schedule Counts ────────────────────────────
  const scheduleCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of employees) {
      if (e.pay_schedule) {
        map[e.pay_schedule] = (map[e.pay_schedule] || 0) + 1;
      }
    }
    return map;
  }, [employees]);

  // ─── Selection Handlers ─────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(e => e.id)));
    }
  }, [filtered, selectedIds.size]);

  // ─── Bulk Status Update ─────────────────────────────
  const handleBulkStatus = useCallback(async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    try {
      for (const id of selectedIds) {
        await api.update('employees', id, { status: newStatus });
      }
      setEmployees(prev => prev.map(e => selectedIds.has(e.id) ? { ...e, status: newStatus } : e));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err?.message || 'Failed to update status');
    }
  }, [selectedIds]);

  // ─── Bulk Delete ────────────────────────────────────
  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} employee${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      for (const id of selectedIds) {
        await api.remove('employees', id);
      }
      setEmployees(prev => prev.filter(e => !selectedIds.has(e.id)));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err?.message || 'Failed to delete employees');
    }
  }, [selectedIds]);

  // ─── Export CSV ─────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const headers = ['Name', 'Email', 'Type', 'Pay Type', 'Pay Rate', 'Schedule', 'Status', 'Role', 'Department', 'Location', 'Cost Class'];
    const rows = filtered.map(e => [
      e.name,
      e.email || '',
      e.type,
      e.pay_type,
      String(e.pay_rate ?? 0),
      scheduleLabels[e.pay_schedule] ?? e.pay_schedule,
      e.status,
      e.role || '',
      e.department || '',
      e.work_location || '',
      e.cost_class || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {error && <ErrorBanner message={error} title="Failed to load employees" onDismiss={() => setError('')} />}
      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Employees</h1>
        <div className="module-actions flex items-center gap-2">
          <button className="block-btn inline-flex items-center gap-1.5" onClick={handleExportCSV}>
            <Download size={14} />
            Export CSV
          </button>
          <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewEmployee}>
            <Plus size={14} />
            Add Employee
          </button>
        </div>
      </div>

      {/* Workforce Summary Cards */}
      {!loading && employees.length > 0 && (
        <div className="grid grid-cols-5 gap-3">
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Headcount</div>
            <div className="text-xl font-mono font-bold text-text-primary mt-1">{stats.total}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{stats.active} active / {stats.inactive} inactive</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active Employees</div>
            <div className="text-xl font-mono font-bold text-text-primary mt-1">{stats.active}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0}% of total</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Payroll Cost</div>
            <div className="text-xl font-mono font-bold text-text-primary mt-1">{formatCurrency(stats.totalCost)}</div>
            <div className="text-[10px] text-text-muted mt-0.5">annualized</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Salary</div>
            <div className="text-xl font-mono font-bold text-text-primary mt-1">{formatCurrency(stats.avgSalary)}</div>
            <div className="text-[10px] text-text-muted mt-0.5">per active employee</div>
          </div>
          <div className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Contractors</div>
            <div className="text-xl font-mono font-bold text-text-primary mt-1">{stats.contractors}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{stats.total > 0 ? Math.round((stats.contractors / stats.total) * 100) : 0}% of total</div>
          </div>
        </div>
      )}

      {/* Department Distribution Bar */}
      {!loading && deptCounts.length > 0 && employees.length > 0 && (
        <div className="block-card p-4" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Department Distribution</div>
          <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden' }}>
            {deptCounts.map((d, i) => (
              <div key={d.name || '__unassigned'} style={{ width: `${d.pct}%`, background: COLORS[i % COLORS.length] }} title={`${d.name || 'Unassigned'}: ${d.count}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {deptCounts.map((d, i) => (
              <div key={d.name || '__unassigned'} className="flex items-center gap-1 text-[10px] text-text-muted">
                <div style={{ width: 8, height: 8, background: COLORS[i % COLORS.length], borderRadius: '6px' }} />
                {d.name || 'Unassigned'} ({d.count})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pay Schedule Breakdown */}
      {!loading && Object.keys(scheduleCounts).length > 0 && employees.length > 0 && (
        <div className="flex gap-3">
          {Object.entries(scheduleCounts).map(([schedule, count]) => (
            <div key={schedule} className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="font-mono font-semibold text-text-secondary">{count}</span>
              {scheduleLabels[schedule] || schedule}
            </div>
          ))}
        </div>
      )}

      {/* Toolbar: Search + Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="block-input pl-8"
            placeholder="Search employees..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="relative inline-flex items-center gap-1.5">
          <Filter size={14} className="text-text-muted" />
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '120px' }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          >
            {/* Placeholder first; remaining alphabetical A→Z */}
            <option value="all">All Types</option>
            <option value="contractor">Contractors</option>
            <option value="employee">Employees</option>
          </select>
        </div>
        <div className="relative inline-flex items-center gap-1.5">
          <select
            className="block-select"
            style={{ width: 'auto', minWidth: '120px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Bulk Actions Toolbar */}
      {selectedIds.size > 0 && (
        <div className="block-card p-3 flex items-center gap-3" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5">
            <Check size={14} className="text-accent-blue" />
            <span className="text-xs font-semibold text-text-primary">{selectedIds.size} selected</span>
          </div>
          <div className="h-4 w-px bg-border-secondary" />
          <select
            className="block-select text-xs"
            style={{ width: 'auto', minWidth: '140px' }}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                handleBulkStatus(e.target.value);
                e.target.value = '';
              }
            }}
          >
            <option value="" disabled>Set Status...</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            className="block-btn inline-flex items-center gap-1.5 text-xs"
            style={{ color: '#dc2626' }}
            onClick={handleBulkDelete}
          >
            <Trash2 size={12} />
            Delete Selected
          </button>
          <button
            className="block-btn text-xs ml-auto"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm text-text-muted font-mono">Loading employees...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Users size={28} className="text-text-muted" />
          </div>
          <p className="text-sm font-semibold text-text-secondary mb-1">No employees found</p>
          <p className="text-xs text-text-muted mb-4">
            {employees.length === 0
              ? 'Get started by adding your first employee.'
              : 'Try adjusting your search or filters.'}
          </p>
          {employees.length === 0 && (
            <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewEmployee}>
              <Plus size={14} />
              Add Employee
            </button>
          )}
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
          <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              <tr>
                <th style={{ width: '36px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                  />
                </th>
                <SortableHeader field="name" label="Name" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="email" label="Email" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="type" label="Type" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="pay_type" label="Pay Type" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="pay_rate" label="Pay Rate" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="pay_schedule" label="Schedule" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="status" label="Status" activeSortField={sortField} activeSortDir={sortDir} onSort={handleSort} />
                <th>Role</th>
                <th>Dept.</th>
                <th>Location</th>
                <th>Cost Class</th>
                <th>Last Paid</th>
                <th className="text-right">YTD Gross</th>
                <th style={{ width: '60px' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr
                  key={emp.id}
                  className="cursor-pointer group"
                  onClick={() => onSelectEmployee(emp.id)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(emp.id)}
                      onChange={() => toggleSelect(emp.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Users size={16} className="text-text-muted shrink-0" />
                      <span className="text-text-primary font-medium block truncate max-w-[180px]">{emp.name}</span>
                    </div>
                  </td>
                  <td className="text-text-secondary truncate max-w-[200px]">{emp.email || '--'}</td>
                  <td>
                    <span
                      className={
                        emp.type === 'employee'
                          ? 'block-badge block-badge-blue'
                          : 'block-badge block-badge-purple'
                      }
                    >
                      {emp.type === 'employee' ? 'Employee' : 'Contractor'}
                    </span>
                  </td>
                  <td className="text-text-secondary capitalize">{emp.pay_type}</td>
                  <td className="text-text-secondary font-mono text-xs">
                    {formatCurrency(emp.pay_rate ?? 0)}
                    {emp.pay_type === 'hourly' ? '/hr' : '/yr'}
                  </td>
                  <td className="text-text-secondary text-xs">
                    {scheduleLabels[emp.pay_schedule] ?? emp.pay_schedule}
                  </td>
                  <td>
                    <ClassificationBadge def={EMPLOYMENT_STATUS} value={emp.status} />
                  </td>
                  <td><ClassificationBadge def={EMPLOYEE_ROLE} value={emp.role} /></td>
                  <td><ClassificationBadge def={EMPLOYEE_DEPARTMENT} value={emp.department} /></td>
                  <td><ClassificationBadge def={EMPLOYEE_WORK_LOCATION} value={emp.work_location} /></td>
                  <td><ClassificationBadge def={EMPLOYEE_COST_CLASS} value={emp.cost_class} /></td>
                  <td className="text-xs text-text-muted font-mono">
                    {payrollData[emp.id]?.last_pay_date ? formatDate(payrollData[emp.id].last_pay_date) : '—'}
                  </td>
                  <td className="text-right text-xs font-mono text-text-secondary">
                    {payrollData[emp.id]?.ytd_gross ? formatCurrency(payrollData[emp.id].ytd_gross) : '—'}
                  </td>
                  <td className="text-right opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-accent-blue text-[10px] font-semibold">Edit &rarr;</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {employees.length} employee{employees.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default EmployeeList;
