import React, { useEffect, useState, useMemo } from 'react';
import { Users, Plus, Search, Filter, ArrowUpDown } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface Employee {
  id: string;
  name: string;
  email: string;
  type: 'employee' | 'contractor';
  pay_type: 'salary' | 'hourly';
  pay_rate: number;
  pay_schedule: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  status: 'active' | 'inactive';
}

type SortField = 'name' | 'email' | 'type' | 'pay_type' | 'pay_rate' | 'pay_schedule' | 'status';
type SortDir = 'asc' | 'desc';
type TypeFilter = 'all' | 'employee' | 'contractor';
type StatusFilter = 'all' | 'active' | 'inactive';

interface EmployeeListProps {
  onSelectEmployee: (id: string) => void;
  onNewEmployee: () => void;
}

// ─── Formatters ─────────────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const scheduleLabels: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly',
};

// ─── Column Header (module-level to avoid re-creation) ──
const SortableHeader: React.FC<{
  field: SortField;
  label: string;
  activeSortField: SortField;
  onSort: (field: SortField) => void;
}> = ({ field, label, activeSortField, onSort }) => (
  <th
    className="cursor-pointer select-none hover:text-text-primary transition-colors"
    onClick={() => onSort(field)}
  >
    <span className="inline-flex items-center gap-1">
      {label}
      <ArrowUpDown
        size={12}
        className={activeSortField === field ? 'text-accent-blue' : 'text-text-muted'}
      />
    </span>
  </th>
);

// ─── Component ──────────────────────────────────────────
const EmployeeList: React.FC<EmployeeListProps> = ({ onSelectEmployee, onNewEmployee }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ─── Load Data ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const rows = await api.query('employees');
        if (!cancelled) {
          setEmployees(Array.isArray(rows) ? rows : []);
        }
      } catch (err) {
        console.error('Failed to load employees:', err);
        if (!cancelled) setEmployees([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

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

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Employees</h1>
        <div className="module-actions">
          <button className="block-btn-primary inline-flex items-center gap-1.5" onClick={onNewEmployee}>
            <Plus size={14} />
            Add Employee
          </button>
        </div>
      </div>

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
            <option value="all">All Types</option>
            <option value="employee">Employees</option>
            <option value="contractor">Contractors</option>
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
        <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '2px' }}>
          <table className="block-table">
            <thead>
              <tr>
                <SortableHeader field="name" label="Name" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="email" label="Email" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="type" label="Type" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="pay_type" label="Pay Type" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="pay_rate" label="Pay Rate" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="pay_schedule" label="Schedule" activeSortField={sortField} onSort={handleSort} />
                <SortableHeader field="status" label="Status" activeSortField={sortField} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr
                  key={emp.id}
                  className="cursor-pointer"
                  onClick={() => onSelectEmployee(emp.id)}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <Users size={16} className="text-text-muted shrink-0" />
                      <span className="text-text-primary font-medium">{emp.name}</span>
                    </div>
                  </td>
                  <td className="text-text-secondary">{emp.email || '--'}</td>
                  <td>
                    <span
                      className={
                        emp.type === 'employee'
                          ? 'block-badge block-badge-blue'
                          : 'block-badge block-badge-purple'
                      }
                    >
                      {emp.type}
                    </span>
                  </td>
                  <td className="text-text-secondary capitalize">{emp.pay_type}</td>
                  <td className="text-text-secondary font-mono text-xs">
                    {fmt.format(emp.pay_rate ?? 0)}
                    {emp.pay_type === 'hourly' ? '/hr' : '/yr'}
                  </td>
                  <td className="text-text-secondary text-xs">
                    {scheduleLabels[emp.pay_schedule] ?? emp.pay_schedule}
                  </td>
                  <td>
                    <span
                      className={
                        emp.status === 'active'
                          ? 'block-badge block-badge-income'
                          : 'block-badge block-badge-expense'
                      }
                    >
                      {emp.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
