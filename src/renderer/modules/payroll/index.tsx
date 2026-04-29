import React, { useEffect, useState, useCallback } from 'react';
import {
  Users, DollarSign, FileText, Calculator, Plus, Trash2, Printer,
  LayoutDashboard, ChevronDown, ChevronRight, Download, TrendingUp, Clock, ArrowRight, Eye, Edit,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import EmployeeList from './EmployeeList';
import EmployeeForm from './EmployeeForm';
import PayrollRunner from './PayrollRunner';
import PayStubView from './PayStubView';
import PtoDashboard from './PtoDashboard';
import ErrorBanner from '../../components/ErrorBanner';
import { formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
type Tab = 'summary' | 'employees' | 'run' | 'history' | 'pto';

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
  notes?: string;
  run_type?: string;
  created_at?: string;
}

interface PayStubRecord {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_name: string;
  department?: string;
  pay_type?: string;
  pay_schedule?: string;
  gross_pay: number;
  net_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  hours_regular: number;
  hours_overtime: number;
  total_hours: number;
  other_deductions: number;
  employer_ss?: number;
  employer_medicare?: number;
  employer_futa?: number;
  ytd_federal_tax?: number;
  ytd_state_tax?: number;
  ytd_social_security?: number;
  ytd_medicare?: number;
  period_start?: string;
  period_end?: string;
  pay_date?: string;
  run_type?: string;
  [key: string]: any;
}

interface SummaryData {
  ytdGross: number;
  ytdNet: number;
  ytdTaxes: number;
  uniqueEmployees: number;
  activeEmployees: number;
  lastRun: PayrollRun | null;
  recentRuns: PayrollRun[];
  monthlyTrend: { month: string; label: string; total: number }[];
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// ─── Run Type Badges ────────────────────────────────────
const runTypeBadgeClass: Record<string, string> = {
  regular: 'block-badge block-badge-blue',
  bonus: 'block-badge block-badge-purple',
  correction: 'block-badge block-badge-warning',
  'off-cycle': 'block-badge block-badge-blue',
};

const RunTypeBadge: React.FC<{ runType?: string }> = ({ runType }) => {
  if (!runType) return null;
  const cls = runTypeBadgeClass[runType] || 'block-badge block-badge-blue';
  return <span className={`${cls} text-[10px]`}>{runType.replace('-', ' ')}</span>;
};

// ─── Component ──────────────────────────────────────────
const PayrollModule: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [activeTab, setActiveTab] = useState<Tab>('summary');

  // Employee sub-views
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [employeeListKey, setEmployeeListKey] = useState(0);

  // Payroll runner
  const [showRunner, setShowRunner] = useState(false);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);

  // History
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runStubs, setRunStubs] = useState<Record<string, PayStubRecord[]>>({});
  const [stubsLoading, setStubsLoading] = useState(false);
  const [stubsError, setStubsError] = useState('');
  const [historyError, setHistoryError] = useState('');

  // Pay stub detail
  const [viewStubId, setViewStubId] = useState<string | null>(null);

  // Summary dashboard
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  // ─── Load summary data ────────────────────────────────
  const loadSummary = useCallback(async () => {
    if (!activeCompany) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const year = new Date().getFullYear();
      const ytdStart = `${year}-01-01`;

      // YTD aggregates from pay_stubs
      const [ytdRows, activeRows, lastRunRows, recentRunRows, trendRows] = await Promise.all([
        api.rawQuery(
          `SELECT
            COALESCE(SUM(ps.gross_pay), 0) as ytd_gross,
            COALESCE(SUM(ps.net_pay), 0) as ytd_net,
            COALESCE(SUM(ps.federal_tax + ps.state_tax + ps.social_security + ps.medicare), 0) as ytd_taxes,
            COUNT(DISTINCT ps.employee_id) as unique_employees
          FROM pay_stubs ps
          JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
          WHERE pr.company_id = ? AND pr.pay_date >= ?`,
          [activeCompany.id, ytdStart]
        ),
        api.rawQuery(
          `SELECT COUNT(*) as count FROM employees WHERE company_id = ? AND status = 'active'`,
          [activeCompany.id]
        ),
        api.rawQuery(
          `SELECT *, pay_period_start AS period_start, pay_period_end AS period_end
           FROM payroll_runs WHERE company_id = ? ORDER BY pay_date DESC LIMIT 1`,
          [activeCompany.id]
        ),
        api.rawQuery(
          `SELECT *, pay_period_start AS period_start, pay_period_end AS period_end
           FROM payroll_runs WHERE company_id = ? ORDER BY pay_date DESC LIMIT 5`,
          [activeCompany.id]
        ),
        // Last 6 months of payroll cost
        api.rawQuery(
          `SELECT
            strftime('%Y-%m', pr.pay_date) as month,
            COALESCE(SUM(ps.gross_pay), 0) as total
          FROM pay_stubs ps
          JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
          WHERE pr.company_id = ? AND pr.pay_date >= date('now', '-6 months')
          GROUP BY strftime('%Y-%m', pr.pay_date)
          ORDER BY month`,
          [activeCompany.id]
        ),
      ]);

      const ytd = Array.isArray(ytdRows) && ytdRows[0] ? ytdRows[0] : { ytd_gross: 0, ytd_net: 0, ytd_taxes: 0, unique_employees: 0 };
      const activeCount = Array.isArray(activeRows) && activeRows[0] ? activeRows[0].count : 0;
      const lastRun = Array.isArray(lastRunRows) && lastRunRows[0] ? lastRunRows[0] : null;
      const recentRuns = Array.isArray(recentRunRows) ? recentRunRows : [];

      // Build monthly trend with labels
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const trend = Array.isArray(trendRows)
        ? trendRows.map((r: any) => {
            const [, m] = (r.month || '').split('-');
            return {
              month: r.month,
              label: monthNames[parseInt(m, 10) - 1] || r.month,
              total: r.total ?? 0,
            };
          })
        : [];

      setSummaryData({
        ytdGross: ytd.ytd_gross ?? 0,
        ytdNet: ytd.ytd_net ?? 0,
        ytdTaxes: ytd.ytd_taxes ?? 0,
        uniqueEmployees: ytd.unique_employees ?? 0,
        activeEmployees: activeCount,
        lastRun,
        recentRuns,
        monthlyTrend: trend,
      });
    } catch (err: any) {
      console.error('Failed to load payroll summary:', err);
      setSummaryError(err?.message || 'Failed to load summary data');
    } finally {
      setSummaryLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    if (activeTab === 'summary') {
      loadSummary();
    }
  }, [activeTab, loadSummary]);

  // ─── Load history ─────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!activeCompany) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const rows = await api.rawQuery(
        'SELECT *, pay_period_start AS period_start, pay_period_end AS period_end FROM payroll_runs WHERE company_id = ? ORDER BY pay_date DESC',
        [activeCompany.id]
      );
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

  // Cross-module deep links: employee → form, pay_stub → view
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const empFocus = consumeFocusEntity('employee');
    if (empFocus) {
      setActiveTab('employees');
      setSelectedEmployeeId(empFocus.id);
      setShowEmployeeForm(true);
      return;
    }
    const stubFocus = consumeFocusEntity('pay_stub');
    if (stubFocus) {
      setViewStubId(stubFocus.id);
    }
  }, [consumeFocusEntity]);

  // ─── Expand a run to see pay stubs ────────────────────
  const toggleExpandRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    setStubsError('');

    setStubsLoading(true);
    try {
      const stubs = await api.rawQuery(
        `SELECT ps.*,
                COALESCE(e.name, e.email, 'Unknown') AS employee_name,
                e.department, e.pay_type, e.pay_schedule,
                (ps.hours_regular + ps.hours_overtime) AS total_hours,
                ps.hours_regular, ps.hours_overtime,
                (ps.other_deductions) AS deductions,
                pr.pay_period_start AS period_start,
                pr.pay_period_end AS period_end,
                pr.pay_date, pr.run_type
         FROM pay_stubs ps
         LEFT JOIN employees e ON ps.employee_id = e.id
         LEFT JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
         WHERE ps.payroll_run_id = ?
         ORDER BY e.name`,
        [runId]
      );
      setRunStubs((prev) => ({
        ...prev,
        [runId]: Array.isArray(stubs) ? stubs : [],
      }));
    } catch (err: any) {
      console.error('Failed to load pay stubs for run:', runId, err);
      setStubsError(err?.message || 'Failed to load pay stubs');
      setRunStubs((prev) => ({ ...prev, [runId]: [] }));
    } finally {
      setStubsLoading(false);
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
    setEditingRunId(null);
    setActiveTab('history');
    loadHistory();
  };

  // ─── Print Payroll Register ───────────────────────────
  const handlePrintRegister = async (run: PayrollRun, stubs: PayStubRecord[]) => {
    const companyName = activeCompany?.name || 'Company';
    const companyAddr = [
      (activeCompany as any)?.address_line1,
      (activeCompany as any)?.address_line2,
      [(activeCompany as any)?.city, (activeCompany as any)?.state, (activeCompany as any)?.zip].filter(Boolean).join(', '),
    ].filter(Boolean).join('<br>');

    const rows = stubs.map(s => `<tr>
      <td>${s.employee_name || 'Unknown'}</td>
      <td style="text-align:right">${(s.hours_regular ?? 0).toFixed(2)}</td>
      <td style="text-align:right">${(s.hours_overtime ?? 0).toFixed(2)}</td>
      <td style="text-align:right">${fmt.format(s.gross_pay ?? 0)}</td>
      <td style="text-align:right">${fmt.format(s.federal_tax ?? 0)}</td>
      <td style="text-align:right">${fmt.format(s.state_tax ?? 0)}</td>
      <td style="text-align:right">${fmt.format(s.social_security ?? 0)}</td>
      <td style="text-align:right">${fmt.format(s.medicare ?? 0)}</td>
      <td style="text-align:right">${fmt.format(s.other_deductions ?? 0)}</td>
      <td style="text-align:right;font-weight:600">${fmt.format(s.net_pay ?? 0)}</td>
    </tr>`).join('');

    const totals = stubs.reduce((acc, s) => ({
      hours_regular: acc.hours_regular + (s.hours_regular ?? 0),
      hours_overtime: acc.hours_overtime + (s.hours_overtime ?? 0),
      gross: acc.gross + (s.gross_pay ?? 0),
      federal: acc.federal + (s.federal_tax ?? 0),
      state: acc.state + (s.state_tax ?? 0),
      ss: acc.ss + (s.social_security ?? 0),
      medicare: acc.medicare + (s.medicare ?? 0),
      deductions: acc.deductions + (s.other_deductions ?? 0),
      net: acc.net + (s.net_pay ?? 0),
    }), { hours_regular: 0, hours_overtime: 0, gross: 0, federal: 0, state: 0, ss: 0, medicare: 0, deductions: 0, net: 0 });

    const totalTaxes = totals.federal + totals.state + totals.ss + totals.medicare;

    // Employer cost estimates
    const employerSS = stubs.reduce((sum, s) => sum + (s.employer_ss ?? (s.gross_pay ?? 0) * 0.062), 0);
    const employerMedicare = stubs.reduce((sum, s) => sum + (s.employer_medicare ?? (s.gross_pay ?? 0) * 0.0145), 0);
    const employerFUTA = stubs.reduce((sum, s) => sum + (s.employer_futa ?? 0), 0);
    const totalEmployerCost = employerSS + employerMedicare + employerFUTA;

    const runTypeLabel = run.run_type ? run.run_type.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Regular';

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Payroll Register</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 11px; color: #1a1a1a; padding: 32px; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; }
  .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .header .company-addr { font-size: 10px; color: #555; margin-bottom: 8px; }
  .header h2 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .run-info { display: flex; justify-content: space-between; font-size: 10px; color: #555; margin-bottom: 16px; }
  .run-info div { display: flex; gap: 4px; }
  .run-info strong { color: #1a1a1a; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f0f0f0; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; padding: 6px 8px; border-bottom: 2px solid #ccc; text-align: left; }
  th.r { text-align: right; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e5e5; font-size: 10px; }
  tr.totals td { border-top: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; font-weight: 700; background: #f8f8f8; }
  .employer-section { margin-top: 20px; padding: 12px; border: 1px solid #ccc; border-radius: 4px; }
  .employer-section h3 { font-size: 11px; font-weight: 700; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  .employer-grid { display: flex; gap: 24px; font-size: 10px; }
  .employer-grid div { display: flex; flex-direction: column; }
  .employer-grid .label { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }
  .employer-grid .value { font-weight: 600; font-size: 12px; margin-top: 2px; }
  .footer { margin-top: 24px; text-align: center; font-size: 9px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
  @media print { body { padding: 16px; } }
</style></head><body>
<div class="header">
  <h1>${companyName}</h1>
  ${companyAddr ? `<div class="company-addr">${companyAddr}</div>` : ''}
  <h2>Payroll Register</h2>
</div>
<div class="run-info">
  <div><span>Pay Period:</span> <strong>${formatDate(run.period_start)} - ${formatDate(run.period_end)}</strong></div>
  <div><span>Pay Date:</span> <strong>${formatDate(run.pay_date)}</strong></div>
  <div><span>Run Type:</span> <strong>${runTypeLabel}</strong></div>
  <div><span>Employees:</span> <strong>${stubs.length}</strong></div>
</div>
<table>
  <thead>
    <tr>
      <th>Employee</th>
      <th class="r">Reg Hrs</th>
      <th class="r">OT Hrs</th>
      <th class="r">Gross Pay</th>
      <th class="r">Fed W/H</th>
      <th class="r">State W/H</th>
      <th class="r">Social Sec</th>
      <th class="r">Medicare</th>
      <th class="r">Deductions</th>
      <th class="r">Net Pay</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    <tr class="totals">
      <td>TOTALS (${stubs.length} employees)</td>
      <td style="text-align:right">${totals.hours_regular.toFixed(2)}</td>
      <td style="text-align:right">${totals.hours_overtime.toFixed(2)}</td>
      <td style="text-align:right">${fmt.format(totals.gross)}</td>
      <td style="text-align:right">${fmt.format(totals.federal)}</td>
      <td style="text-align:right">${fmt.format(totals.state)}</td>
      <td style="text-align:right">${fmt.format(totals.ss)}</td>
      <td style="text-align:right">${fmt.format(totals.medicare)}</td>
      <td style="text-align:right">${fmt.format(totals.deductions)}</td>
      <td style="text-align:right">${fmt.format(totals.net)}</td>
    </tr>
  </tbody>
</table>
<div class="employer-section">
  <h3>Employer Cost Summary</h3>
  <div class="employer-grid">
    <div><span class="label">SS Match (6.2%)</span><span class="value">${fmt.format(employerSS)}</span></div>
    <div><span class="label">Medicare Match (1.45%)</span><span class="value">${fmt.format(employerMedicare)}</span></div>
    <div><span class="label">FUTA</span><span class="value">${fmt.format(employerFUTA)}</span></div>
    <div><span class="label">Total Employer Cost</span><span class="value">${fmt.format(totalEmployerCost)}</span></div>
    <div><span class="label">Total Employee Taxes</span><span class="value">${fmt.format(totalTaxes)}</span></div>
    <div><span class="label">Total Payroll Cost</span><span class="value">${fmt.format(totals.gross + totalEmployerCost)}</span></div>
  </div>
</div>
<div class="footer">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} &mdash; ${companyName}</div>
</body></html>`;

    await api.printPreview(html, `Payroll Register — ${run.pay_date}`);
  };

  // ─── Export CSV ───────────────────────────────────────
  const handleExportCSV = (run: PayrollRun, stubs: PayStubRecord[]) => {
    const headers = ['Employee', 'Department', 'Reg Hours', 'OT Hours', 'Gross Pay', 'Federal Tax', 'State Tax', 'Social Security', 'Medicare', 'Deductions', 'Net Pay'];
    const csvRows = [
      headers.join(','),
      ...stubs.map(s => [
        `"${(s.employee_name || '').replace(/"/g, '""')}"`,
        `"${(s.department || '').replace(/"/g, '""')}"`,
        (s.hours_regular ?? 0).toFixed(2),
        (s.hours_overtime ?? 0).toFixed(2),
        (s.gross_pay ?? 0).toFixed(2),
        (s.federal_tax ?? 0).toFixed(2),
        (s.state_tax ?? 0).toFixed(2),
        (s.social_security ?? 0).toFixed(2),
        (s.medicare ?? 0).toFixed(2),
        (s.other_deductions ?? 0).toFixed(2),
        (s.net_pay ?? 0).toFixed(2),
      ].join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-register-${run.pay_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
        editRunId={editingRunId || undefined}
        onComplete={handleRunComplete}
        onBack={() => {
          setShowRunner(false);
          setEditingRunId(null);
        }}
      />
    );
  }

  // ─── Tab definitions ──────────────────────────────────
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
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
          <h1 className="text-base font-bold text-text-primary">Payroll</h1>
        </div>
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-accent-blue text-accent-blue'
                  : 'border-transparent text-text-muted hover:text-text-secondary transition-colors'
              }`}
              onClick={() => {
                if (tab.key === 'run') {
                  setEditingRunId(null);
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

        {/* ─── Summary / Dashboard Tab ─────────────────── */}
        {activeTab === 'summary' && (
          <div className="p-6 space-y-6">
            {summaryError && <ErrorBanner message={summaryError} title="Failed to load summary" onDismiss={() => setSummaryError('')} />}

            {summaryLoading ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-sm text-text-muted font-mono">Loading dashboard...</span>
              </div>
            ) : summaryData ? (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="block-card p-4 border-l-2 border-l-accent-blue" style={{ borderRadius: '6px' }}>
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">YTD Payroll Cost</span>
                    <p className="text-2xl font-mono text-text-primary mt-1">{fmt.format(summaryData.ytdGross + summaryData.ytdTaxes)}</p>
                    <span className="text-xs text-text-muted">Gross + taxes in {new Date().getFullYear()}</span>
                  </div>
                  <div className="block-card p-4 border-l-2 border-l-accent-income" style={{ borderRadius: '6px' }}>
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Last Pay Run</span>
                    <p className="text-2xl font-mono text-text-primary mt-1">
                      {summaryData.lastRun ? fmt.format(summaryData.lastRun.total_net ?? 0) : '--'}
                    </p>
                    <span className="text-xs text-text-muted">
                      {summaryData.lastRun ? formatDate(summaryData.lastRun.pay_date) : 'No runs yet'}
                    </span>
                  </div>
                  <div className="block-card p-4 border-l-2 border-l-accent-purple" style={{ borderRadius: '6px' }}>
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active Employees</span>
                    <p className="text-2xl font-mono text-text-primary mt-1">{summaryData.activeEmployees}</p>
                    <span className="text-xs text-text-muted">{summaryData.uniqueEmployees} paid this year</span>
                  </div>
                  <div className="block-card p-4 border-l-2 border-l-accent-warning" style={{ borderRadius: '6px' }}>
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Pay / Employee</span>
                    <p className="text-2xl font-mono text-text-primary mt-1">
                      {summaryData.uniqueEmployees > 0
                        ? fmt.format(summaryData.ytdGross / summaryData.uniqueEmployees)
                        : '--'}
                    </p>
                    <span className="text-xs text-text-muted">YTD gross avg</span>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="flex items-center gap-3">
                  <button
                    className="block-btn-primary inline-flex items-center gap-1.5 text-xs"
                    style={{ borderRadius: '6px' }}
                    onClick={() => {
                      setEditingRunId(null);
                      setShowRunner(true);
                    }}
                  >
                    <Calculator size={14} />
                    Run Payroll
                  </button>
                  <button
                    className="block-btn inline-flex items-center gap-1.5 text-xs"
                    style={{ borderRadius: '6px' }}
                    onClick={() => {
                      setSelectedEmployeeId(null);
                      setShowEmployeeForm(true);
                    }}
                  >
                    <Plus size={14} />
                    Add Employee
                  </button>
                  <button
                    className="block-btn inline-flex items-center gap-1.5 text-xs"
                    style={{ borderRadius: '6px' }}
                    onClick={() => setActiveTab('history')}
                  >
                    <FileText size={14} />
                    View History
                  </button>
                </div>

                {/* Recent Payroll Runs */}
                {summaryData.recentRuns.length > 0 && (
                  <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
                    <div className="px-4 py-3 border-b border-border-primary">
                      <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Recent Payroll Runs</h3>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border-primary bg-bg-secondary/50">
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Pay Date</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Period</th>
                          <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Employees</th>
                          <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Gross</th>
                          <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Net</th>
                          <th className="text-center px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryData.recentRuns.map((r) => (
                          <tr key={r.id} className="border-b border-border-primary/50 hover:bg-bg-hover transition-colors cursor-pointer" onClick={() => { setActiveTab('history'); setTimeout(() => toggleExpandRun(r.id), 100); }}>
                            <td className="px-4 py-2.5 font-mono text-text-primary">{formatDate(r.pay_date, { style: 'short' })}</td>
                            <td className="px-4 py-2.5 text-text-secondary">{formatDate(r.period_start, { style: 'short' })} - {formatDate(r.period_end, { style: 'short' })}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{r.employee_count}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-text-primary">{fmt.format(r.total_gross ?? 0)}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-accent-income">{fmt.format(r.total_net ?? 0)}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className="block-badge block-badge-income text-[10px]">{r.status ?? 'processed'}</span>
                              {r.run_type && r.run_type !== 'regular' && (
                                <RunTypeBadge runType={r.run_type} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Payroll Cost Trend */}
                {summaryData.monthlyTrend.length > 0 && (
                  <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingUp size={14} className="text-accent-blue" />
                      <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Payroll Cost Trend (Last 6 Months)</h3>
                    </div>
                    {(() => {
                      const maxVal = Math.max(...summaryData.monthlyTrend.map(m => m.total), 1);
                      return (
                        <div className="flex items-end gap-3" style={{ height: '140px' }}>
                          {summaryData.monthlyTrend.map((m) => {
                            const pct = (m.total / maxVal) * 100;
                            return (
                              <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                                <span className="text-[9px] font-mono text-text-muted">{fmtCompact.format(m.total)}</span>
                                <div
                                  className="w-full bg-accent-blue/80 transition-all"
                                  style={{
                                    height: `${Math.max(pct, 3)}%`,
                                    borderRadius: '4px 4px 0 0',
                                    minHeight: '4px',
                                  }}
                                />
                                <span className="text-[10px] font-semibold text-text-muted uppercase">{m.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}

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

        {/* ─── History Tab ─────────────────────────────── */}
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
              <div className="space-y-3">
                {runs.map((run) => {
                  const isExpanded = expandedRunId === run.id;
                  const stubs = runStubs[run.id] ?? [];

                  // Calculate totals from stubs if expanded
                  const stubTotals = stubs.length > 0 ? stubs.reduce((acc, s) => ({
                    hours_regular: acc.hours_regular + (s.hours_regular ?? 0),
                    hours_overtime: acc.hours_overtime + (s.hours_overtime ?? 0),
                    gross: acc.gross + (s.gross_pay ?? 0),
                    federal: acc.federal + (s.federal_tax ?? 0),
                    state: acc.state + (s.state_tax ?? 0),
                    ss: acc.ss + (s.social_security ?? 0),
                    medicare: acc.medicare + (s.medicare ?? 0),
                    deductions: acc.deductions + (s.other_deductions ?? 0),
                    net: acc.net + (s.net_pay ?? 0),
                  }), { hours_regular: 0, hours_overtime: 0, gross: 0, federal: 0, state: 0, ss: 0, medicare: 0, deductions: 0, net: 0 }) : null;

                  return (
                    <div key={run.id} className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
                      {/* Run Header */}
                      <div
                        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-bg-hover transition-colors"
                        onClick={() => toggleExpandRun(run.id)}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                          <div className="flex items-center gap-4">
                            <div>
                              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Pay Date</div>
                              <div className="text-sm font-mono text-text-primary">{formatDate(run.pay_date, { style: 'short' })}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Period</div>
                              <div className="text-sm font-mono text-text-primary">
                                {formatDate(run.period_start, { style: 'short' })} - {formatDate(run.period_end, { style: 'short' })}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="block-badge block-badge-income text-[10px]">
                                {run.status ?? 'processed'}
                              </span>
                              <RunTypeBadge runType={run.run_type} />
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Employees</div>
                            <div className="text-sm font-mono text-text-primary">{run.employee_count}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Gross</div>
                            <div className="text-sm font-mono text-text-primary">{fmt.format(run.total_gross ?? 0)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Taxes</div>
                            <div className="text-sm font-mono text-accent-expense">{fmt.format(run.total_taxes ?? 0)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Net</div>
                            <div className="text-sm font-mono font-semibold text-accent-income">{fmt.format(run.total_net ?? 0)}</div>
                          </div>
                          <button
                            className="block-btn flex items-center gap-1 text-[10px] px-2 py-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingRunId(run.id);
                              setShowRunner(true);
                            }}
                            title="Edit this payroll run"
                          >
                            <Edit size={12} /> Edit
                          </button>
                          <button
                            className="block-btn text-accent-expense hover:bg-accent-expense/10 flex items-center gap-1 text-[10px] px-2 py-1"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm('Delete this payroll run and all associated pay stubs? This cannot be undone.')) return;
                              try {
                                const deleteStubs = await api.query('pay_stubs', { payroll_run_id: run.id });
                                if (Array.isArray(deleteStubs)) {
                                  for (const s of deleteStubs) await api.remove('pay_stubs', s.id);
                                }
                                await api.remove('payroll_runs', run.id);
                                loadHistory();
                              } catch (err: any) {
                                alert('Failed to delete payroll run: ' + (err?.message || 'Unknown error'));
                              }
                            }}
                            title="Delete this payroll run"
                          >
                            <Trash2 size={12} /> Void
                          </button>
                        </div>
                      </div>

                      {/* Expanded: Full Details */}
                      {isExpanded && (
                        <div className="border-t border-border-primary bg-bg-tertiary/50">
                          {stubsError && (
                            <div className="mx-4 mt-3 text-xs text-accent-expense bg-accent-expense/10 border border-accent-expense/20 px-3 py-2" style={{ borderRadius: '6px' }}>
                              {stubsError}
                            </div>
                          )}
                          {stubsLoading ? (
                            <div className="text-xs text-text-muted py-4 px-4">Loading pay stubs...</div>
                          ) : stubs.length === 0 ? (
                            <div className="text-xs text-text-muted py-4 px-4">No pay stubs found for this run.</div>
                          ) : (
                            <>
                              {/* Metric Summary Cards */}
                              {stubTotals && (
                                <div className="grid grid-cols-4 gap-3 px-4 pt-4 pb-2">
                                  <div className="bg-bg-secondary/80 px-3 py-2" style={{ borderRadius: '6px' }}>
                                    <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">Employees</span>
                                    <p className="text-lg font-mono text-text-primary">{stubs.length}</p>
                                  </div>
                                  <div className="bg-bg-secondary/80 px-3 py-2" style={{ borderRadius: '6px' }}>
                                    <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">Gross Pay</span>
                                    <p className="text-lg font-mono text-text-primary">{fmt.format(stubTotals.gross)}</p>
                                  </div>
                                  <div className="bg-bg-secondary/80 px-3 py-2" style={{ borderRadius: '6px' }}>
                                    <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">Total Taxes</span>
                                    <p className="text-lg font-mono text-accent-expense">{fmt.format(stubTotals.federal + stubTotals.state + stubTotals.ss + stubTotals.medicare)}</p>
                                  </div>
                                  <div className="bg-bg-secondary/80 px-3 py-2" style={{ borderRadius: '6px' }}>
                                    <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">Net Pay</span>
                                    <p className="text-lg font-mono font-semibold text-accent-income">{fmt.format(stubTotals.net)}</p>
                                  </div>
                                </div>
                              )}

                              {/* Tax Breakdown Row */}
                              {stubTotals && (
                                <div className="mx-4 mt-2 mb-2 bg-bg-secondary/50 px-3 py-2" style={{ borderRadius: '6px' }}>
                                  <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">Tax Breakdown</span>
                                  <div className="flex items-center gap-6 mt-1">
                                    <div>
                                      <span className="text-[9px] text-text-muted">Fed W/H</span>
                                      <span className="ml-1 text-xs font-mono text-text-primary">{fmt.format(stubTotals.federal)}</span>
                                    </div>
                                    <div>
                                      <span className="text-[9px] text-text-muted">State W/H</span>
                                      <span className="ml-1 text-xs font-mono text-text-primary">{fmt.format(stubTotals.state)}</span>
                                    </div>
                                    <div>
                                      <span className="text-[9px] text-text-muted">Social Security</span>
                                      <span className="ml-1 text-xs font-mono text-text-primary">{fmt.format(stubTotals.ss)}</span>
                                    </div>
                                    <div>
                                      <span className="text-[9px] text-text-muted">Medicare</span>
                                      <span className="ml-1 text-xs font-mono text-text-primary">{fmt.format(stubTotals.medicare)}</span>
                                    </div>
                                    <div className="ml-auto">
                                      <span className="text-[9px] text-text-muted">Total</span>
                                      <span className="ml-1 text-xs font-mono font-semibold text-accent-expense">{fmt.format(stubTotals.federal + stubTotals.state + stubTotals.ss + stubTotals.medicare)}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Employer Cost Row */}
                              {stubTotals && (
                                <div className="mx-4 mb-3 bg-bg-secondary/50 px-3 py-2" style={{ borderRadius: '6px' }}>
                                  <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">Employer Cost</span>
                                  <div className="flex items-center gap-6 mt-1">
                                    <div>
                                      <span className="text-[9px] text-text-muted">SS Match</span>
                                      <span className="ml-1 text-xs font-mono text-text-primary">
                                        {fmt.format(stubs.reduce((sum, s) => sum + (s.employer_ss ?? (s.gross_pay ?? 0) * 0.062), 0))}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-[9px] text-text-muted">Medicare Match</span>
                                      <span className="ml-1 text-xs font-mono text-text-primary">
                                        {fmt.format(stubs.reduce((sum, s) => sum + (s.employer_medicare ?? (s.gross_pay ?? 0) * 0.0145), 0))}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-[9px] text-text-muted">FUTA</span>
                                      <span className="ml-1 text-xs font-mono text-text-primary">
                                        {fmt.format(stubs.reduce((sum, s) => sum + (s.employer_futa ?? 0), 0))}
                                      </span>
                                    </div>
                                    <div className="ml-auto">
                                      <span className="text-[9px] text-text-muted">Total Employer</span>
                                      <span className="ml-1 text-xs font-mono font-semibold text-accent-expense">
                                        {fmt.format(stubs.reduce((sum, s) => sum + (s.employer_ss ?? (s.gross_pay ?? 0) * 0.062) + (s.employer_medicare ?? (s.gross_pay ?? 0) * 0.0145) + (s.employer_futa ?? 0), 0))}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Stubs Table */}
                              <div className="px-4 pb-3">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-border-primary">
                                      <th className="text-left py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Employee</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Hours</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Gross</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Fed Tax</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">State Tax</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">SS</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Medicare</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Deductions</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Net</th>
                                      <th className="text-right py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {stubs.map((s) => (
                                      <tr key={s.id} className="border-b border-border-primary/50 hover:bg-bg-hover/50 transition-colors">
                                        <td className="py-1.5 text-text-primary font-medium">
                                          {s.employee_name}
                                          {s.department && <span className="ml-1 text-[9px] text-text-muted">({s.department})</span>}
                                        </td>
                                        <td className="py-1.5 text-right font-mono text-text-secondary">
                                          {((s.hours_regular ?? 0) + (s.hours_overtime ?? 0)).toFixed(1)}
                                          {(s.hours_overtime ?? 0) > 0 && (
                                            <span className="ml-1 text-[9px] text-accent-warning">+{(s.hours_overtime ?? 0).toFixed(1)} OT</span>
                                          )}
                                        </td>
                                        <td className="py-1.5 text-right font-mono text-text-primary">{fmt.format(s.gross_pay ?? 0)}</td>
                                        <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(s.federal_tax ?? 0)}</td>
                                        <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(s.state_tax ?? 0)}</td>
                                        <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(s.social_security ?? 0)}</td>
                                        <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(s.medicare ?? 0)}</td>
                                        <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(s.other_deductions ?? 0)}</td>
                                        <td className="py-1.5 text-right font-mono font-semibold text-accent-income">{fmt.format(s.net_pay ?? 0)}</td>
                                        <td className="py-1.5 text-right">
                                          <div className="flex items-center justify-end gap-2">
                                            <button
                                              className="text-accent-blue hover:underline text-[10px] font-semibold inline-flex items-center gap-0.5"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setViewStubId(s.id);
                                              }}
                                            >
                                              <Eye size={10} />
                                              Stub
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  {/* Totals Row */}
                                  {stubTotals && (
                                    <tfoot>
                                      <tr className="border-t-2 border-border-primary font-semibold">
                                        <td className="py-2 text-text-primary text-[10px] uppercase tracking-wider">Totals</td>
                                        <td className="py-2 text-right font-mono text-text-primary">{(stubTotals.hours_regular + stubTotals.hours_overtime).toFixed(1)}</td>
                                        <td className="py-2 text-right font-mono text-text-primary">{fmt.format(stubTotals.gross)}</td>
                                        <td className="py-2 text-right font-mono text-text-secondary">{fmt.format(stubTotals.federal)}</td>
                                        <td className="py-2 text-right font-mono text-text-secondary">{fmt.format(stubTotals.state)}</td>
                                        <td className="py-2 text-right font-mono text-text-secondary">{fmt.format(stubTotals.ss)}</td>
                                        <td className="py-2 text-right font-mono text-text-secondary">{fmt.format(stubTotals.medicare)}</td>
                                        <td className="py-2 text-right font-mono text-text-secondary">{fmt.format(stubTotals.deductions)}</td>
                                        <td className="py-2 text-right font-mono font-bold text-accent-income">{fmt.format(stubTotals.net)}</td>
                                        <td />
                                      </tr>
                                    </tfoot>
                                  )}
                                </table>

                                {/* Action Buttons */}
                                <div className="flex gap-2 mt-3 pt-3 border-t border-border-primary">
                                  <button
                                    className="block-btn flex items-center gap-1.5 text-[10px] px-3 py-1.5"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const { generatePaycheckHTML, extractCheckBody, wrapBatchChecks } = await import('../../lib/payroll-check-template');
                                      const runData = await api.get('payroll_runs', run.id);
                                      const payYear = (run.pay_date || '').substring(0, 4) || new Date().getFullYear();
                                      const bodies: string[] = [];
                                      for (const s of stubs) {
                                        const emp = await api.get('employees', s.employee_id);
                                        let stubData = s;
                                        if (!s.ytd_federal_tax && s.employee_id) {
                                          try {
                                            const ytd = await api.payrollYtd(s.employee_id, Number(payYear));
                                            stubData = { ...s, ytd_federal_tax: ytd.ytd_federal_tax, ytd_state_tax: ytd.ytd_state_tax, ytd_social_security: ytd.ytd_social_security, ytd_medicare: ytd.ytd_medicare };
                                          } catch { /* use stub as-is */ }
                                        }
                                        const checkHtml = generatePaycheckHTML(stubData, emp, activeCompany, runData);
                                        bodies.push(extractCheckBody(checkHtml));
                                      }
                                      const combined = wrapBatchChecks(bodies);
                                      await api.printPreview(combined, `Payroll Checks — ${run.pay_date}`);
                                    }}
                                  >
                                    <Printer size={12} />
                                    Print All Checks
                                  </button>
                                  <button
                                    className="block-btn flex items-center gap-1.5 text-[10px] px-3 py-1.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePrintRegister(run, stubs);
                                    }}
                                  >
                                    <FileText size={12} />
                                    Print Register
                                  </button>
                                  <button
                                    className="block-btn flex items-center gap-1.5 text-[10px] px-3 py-1.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleExportCSV(run, stubs);
                                    }}
                                  >
                                    <Download size={12} />
                                    Export CSV
                                  </button>
                                </div>
                              </div>
                            </>
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
