import React, { useEffect, useState, useCallback } from 'react';
import { Users, DollarSign, FileText, Calculator, Plus } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import EmployeeList from './EmployeeList';
import EmployeeForm from './EmployeeForm';
import PayrollRunner from './PayrollRunner';
import PayStubView from './PayStubView';
import PtoDashboard from './PtoDashboard';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
type Tab = 'employees' | 'run' | 'history' | 'pto';

interface PayrollRun {
  id: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: string;
  total_gross: number;
  total_taxes: number;
  total_net: number;
  employee_count: number;
  created_at?: string;
}

interface PayStubRecord {
  id: string;
  payroll_run_id: string;
  employee_name: string;
  gross_pay: number;
  net_pay: number;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Component ──────────────────────────────────────────
const PayrollModule: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [activeTab, setActiveTab] = useState<Tab>('employees');

  // Employee sub-views
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [employeeListKey, setEmployeeListKey] = useState(0);

  // Payroll runner
  const [showRunner, setShowRunner] = useState(false);

  // History
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runStubs, setRunStubs] = useState<Record<string, PayStubRecord[]>>({});
  const [historyError, setHistoryError] = useState('');

  // Pay stub detail
  const [viewStubId, setViewStubId] = useState<string | null>(null);

  // ─── Load history ─────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!activeCompany) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const rows = await api.query('payroll_runs', { company_id: activeCompany.id }, { field: 'pay_date', dir: 'desc' });
      setRuns(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      console.error('Failed to load payroll history:', err);
      setRuns([]);
      setHistoryError(err?.message || 'Failed to load payroll history');
    } finally {
      setHistoryLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  // ─── Expand a run to see pay stubs ────────────────────
  const toggleExpandRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (!runStubs[runId]) {
      try {
        // JOIN employees so each stub row carries employee_name (pay_stubs has employee_id only)
        const stubs = await api.rawQuery(
          `SELECT ps.*, COALESCE(NULLIF(TRIM(e.first_name || ' ' || e.last_name), ''), e.email, 'Unknown') AS employee_name
           FROM pay_stubs ps
           LEFT JOIN employees e ON ps.employee_id = e.id
           WHERE ps.payroll_run_id = ?`,
          [runId]
        );
        setRunStubs((prev) => ({
          ...prev,
          [runId]: Array.isArray(stubs) ? stubs : [],
        }));
      } catch {
        setRunStubs((prev) => ({ ...prev, [runId]: [] }));
      }
    }
  };

  // ─── Employee callbacks ───────────────────────────────
  const handleSelectEmployee = (id: string) => {
    setSelectedEmployeeId(id);
    setShowEmployeeForm(true);
  };

  const handleNewEmployee = () => {
    setSelectedEmployeeId(null);
    setShowEmployeeForm(true);
  };

  const handleEmployeeSaved = () => {
    setShowEmployeeForm(false);
    setSelectedEmployeeId(null);
    setEmployeeListKey((k) => k + 1);
  };

  const handleEmployeeBack = () => {
    setShowEmployeeForm(false);
    setSelectedEmployeeId(null);
  };

  // ─── Payroll runner callbacks ─────────────────────────
  const handleRunComplete = () => {
    setShowRunner(false);
    setActiveTab('history');
    loadHistory();
  };

  // ─── Pay stub view ────────────────────────────────────
  if (viewStubId) {
    return (
      <PayStubView
        payStubId={viewStubId}
        onBack={() => setViewStubId(null)}
      />
    );
  }

  // ─── Employee form view ───────────────────────────────
  if (showEmployeeForm) {
    return (
      <EmployeeForm
        employeeId={selectedEmployeeId}
        onBack={handleEmployeeBack}
        onSaved={handleEmployeeSaved}
      />
    );
  }

  // ─── Payroll runner view ──────────────────────────────
  if (showRunner) {
    return (
      <PayrollRunner
        onComplete={handleRunComplete}
        onBack={() => setShowRunner(false)}
      />
    );
  }

  // ─── Tab definitions ──────────────────────────────────
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'employees', label: 'Employees', icon: <Users size={14} /> },
    { key: 'run', label: 'Run Payroll', icon: <Calculator size={14} /> },
    { key: 'history', label: 'History', icon: <FileText size={14} /> },
    { key: 'pto', label: 'PTO', icon: <DollarSign size={14} /> },
  ];

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <div className="flex items-center border-b border-border-primary bg-bg-secondary px-6 pt-4">
        <div className="flex items-center gap-2 mr-6">
          <Users size={20} className="text-accent-blue" />
          <h1 className="text-base font-bold text-text-primary">Employee</h1>
        </div>
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-accent-blue text-accent-blue'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => {
                if (tab.key === 'run') {
                  setShowRunner(true);
                } else {
                  setActiveTab(tab.key);
                }
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Employees Tab */}
        {activeTab === 'employees' && (
          <EmployeeList
            key={employeeListKey}
            onSelectEmployee={handleSelectEmployee}
            onNewEmployee={handleNewEmployee}
          />
        )}

        {/* PTO Tab */}
        {activeTab === 'pto' && <PtoDashboard />}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="p-6 space-y-4">
            {historyError && <ErrorBanner message={historyError} title="Failed to load payroll history" onDismiss={() => setHistoryError('')} />}
            <div className="module-header">
              <h2 className="text-sm font-bold text-text-primary">Payroll History</h2>
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-sm text-text-muted font-mono">Loading history...</span>
              </div>
            ) : runs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <FileText size={28} className="text-text-muted" />
                </div>
                <p className="text-sm font-semibold text-text-secondary mb-1">No payroll runs yet</p>
                <p className="text-xs text-text-muted mb-4">
                  Process your first payroll to see history here.
                </p>
                <button
                  className="block-btn-primary inline-flex items-center gap-1.5"
                  onClick={() => setShowRunner(true)}
                >
                  <Calculator size={14} />
                  Run Payroll
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => {
                  const isExpanded = expandedRunId === run.id;
                  const stubs = runStubs[run.id] ?? [];

                  return (
                    <div key={run.id} className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
                      {/* Run Header */}
                      <div
                        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-bg-hover transition-colors"
                        onClick={() => toggleExpandRun(run.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="text-xs text-text-muted">Pay Period</div>
                            <div className="text-sm font-mono text-text-primary">
                              {run.period_start} to {run.period_end}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-text-muted">Pay Date</div>
                            <div className="text-sm font-mono text-text-primary">{run.pay_date}</div>
                          </div>
                          <div>
                            <div className="text-xs text-text-muted">Employees</div>
                            <div className="text-sm font-mono text-text-primary">{run.employee_count}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <div className="text-xs text-text-muted">Gross</div>
                            <div className="text-sm font-mono text-text-primary">{fmt.format(run.total_gross ?? 0)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-text-muted">Taxes</div>
                            <div className="text-sm font-mono text-accent-expense">{fmt.format(run.total_taxes ?? 0)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-text-muted">Net</div>
                            <div className="text-sm font-mono font-semibold text-accent-income">{fmt.format(run.total_net ?? 0)}</div>
                          </div>
                          <span className="block-badge block-badge-income text-[10px]">
                            {run.status ?? 'processed'}
                          </span>
                        </div>
                      </div>

                      {/* Expanded: Pay Stubs */}
                      {isExpanded && (
                        <div className="border-t border-border-primary bg-bg-tertiary/50 px-4 py-3">
                          {stubs.length === 0 ? (
                            <div className="text-xs text-text-muted py-2">Loading pay stubs...</div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border-primary">
                                  <th className="text-left py-1 text-text-muted font-semibold">Employee</th>
                                  <th className="text-right py-1 text-text-muted font-semibold">Gross</th>
                                  <th className="text-right py-1 text-text-muted font-semibold">Net</th>
                                  <th className="text-right py-1 text-text-muted font-semibold" />
                                </tr>
                              </thead>
                              <tbody>
                                {stubs.map((s) => (
                                  <tr key={s.id} className="border-b border-border-primary/50">
                                    <td className="py-1.5 text-text-primary">{s.employee_name}</td>
                                    <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(s.gross_pay ?? 0)}</td>
                                    <td className="py-1.5 text-right font-mono font-semibold text-accent-income">{fmt.format(s.net_pay ?? 0)}</td>
                                    <td className="py-1.5 text-right">
                                      <button
                                        className="text-accent-blue hover:underline text-[10px] font-semibold"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setViewStubId(s.id);
                                        }}
                                      >
                                        View Stub
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PayrollModule;
