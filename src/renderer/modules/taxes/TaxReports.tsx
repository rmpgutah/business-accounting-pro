import React, { useEffect, useState, useMemo } from 'react';
import {
  PieChart,
  Users,
  Printer,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { generateReportHTML, type ReportColumn, type ReportSummary } from '../../lib/print-templates';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
type ReportTab = 'liability' | 'employee';

interface LiabilityData {
  period: {
    wages: number;
    federal_wh: number;
    ss_ee: number;
    med_ee: number;
    state_wh: number;
  };
  ytd: {
    wages: number;
    federal_wh: number;
    ss_ee: number;
    med_ee: number;
    state_wh: number;
  };
  periodStart: string;
  periodEnd: string;
}

interface EmployeeTaxRow {
  employee_id: string;
  employee_name: string;
  gross_wages: number;
  federal_wh: number;
  ss_tax: number;
  medicare_tax: number;
  state_wh: number;
  total_tax: number;
  w4_filing_status?: string;
  w4_allowances?: number;
  w4_additional_wh?: number;
}

// ─── Tax Rates ──────────────────────────────────────────
const RATES = {
  ss: 0.062,
  medicare: 0.0145,
  addl_medicare: 0.009,
  ut_wh: 0.0455,
  sui: 0.012,
  wc: 0.008,
  futa: 0.006,
};

// ─── Component ──────────────────────────────────────────
const TaxReports: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currentYear = new Date().getFullYear();

  const [reportTab, setReportTab] = useState<ReportTab>('liability');

  // Liability report state
  const [liabilityYear, setLiabilityYear] = useState(currentYear);
  const [qStart, setQStart] = useState(1);
  const [qEnd, setQEnd] = useState(4);
  const [liabilityData, setLiabilityData] = useState<LiabilityData | null>(null);
  const [liabilityLoading, setLiabilityLoading] = useState(false);
  const [liabilityError, setLiabilityError] = useState('');

  // Employee report state
  const [empYear, setEmpYear] = useState(currentYear);
  const [empFilter, setEmpFilter] = useState('');
  const [employeeData, setEmployeeData] = useState<EmployeeTaxRow[]>([]);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeError, setEmployeeError] = useState('');
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);

  // Employee list for dropdown
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!activeCompany) return;
    api
      .rawQuery(
        'SELECT id, first_name || \' \' || last_name AS name FROM employees WHERE company_id = ? AND status = \'active\' ORDER BY last_name',
        [activeCompany.id]
      )
      .then((rows: any[]) => setEmployees(Array.isArray(rows) ? rows : []))
      .catch(console.error);
  }, [activeCompany]);

  const yearRange = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(y);
    return years;
  }, [currentYear]);

  // ─── Liability Report ─────────────────────────────────
  const generateLiability = () => {
    if (!activeCompany) return;
    setLiabilityLoading(true);
    setLiabilityError('');
    api
      .taxLiabilityReport(liabilityYear, qStart, qEnd)
      .then((data) => setLiabilityData(data))
      .catch((err) => {
        console.error('Liability report error:', err);
        setLiabilityError(err?.message || 'Failed to generate liability report');
      })
      .finally(() => setLiabilityLoading(false));
  };

  // Computed liability rows
  const liabilityRows = useMemo(() => {
    if (!liabilityData) return [];
    const p = liabilityData.period;
    const y = liabilityData.ytd;

    // Employer portions mirror employee
    const pSsEr = p.ss_ee;
    const pMedEr = p.med_ee;
    const ySsEr = y.ss_ee;
    const yMedEr = y.med_ee;

    // Estimates from wages
    const pAddlMed = p.wages * RATES.addl_medicare;
    const yAddlMed = y.wages * RATES.addl_medicare;
    const pSui = p.wages * RATES.sui;
    const ySui = y.wages * RATES.sui;
    const pWc = p.wages * RATES.wc;
    const yWc = y.wages * RATES.wc;
    const pFuta = p.wages * RATES.futa;
    const yFuta = y.wages * RATES.futa;

    const rows: Array<{
      label: string;
      period: number;
      ytd: number;
      rate: string;
      isSummary?: boolean;
      isTotal?: boolean;
    }> = [
      { label: 'Federal Withholding', period: p.federal_wh, ytd: y.federal_wh, rate: 'Varies' },
      { label: 'Social Security (Employee)', period: p.ss_ee, ytd: y.ss_ee, rate: '6.20%' },
      { label: 'Social Security (Employer)', period: pSsEr, ytd: ySsEr, rate: '6.20%' },
      { label: 'Medicare (Employee)', period: p.med_ee, ytd: y.med_ee, rate: '1.45%' },
      { label: 'Medicare (Employer)', period: pMedEr, ytd: yMedEr, rate: '1.45%' },
      { label: 'Additional Medicare', period: pAddlMed, ytd: yAddlMed, rate: '0.90%' },
      { label: 'Utah Withholding', period: p.state_wh, ytd: y.state_wh, rate: '4.55%' },
      { label: 'Utah SUI', period: pSui, ytd: ySui, rate: '1.20%' },
      { label: 'Workers Comp', period: pWc, ytd: yWc, rate: '0.80%' },
      { label: 'FUTA', period: pFuta, ytd: yFuta, rate: '0.60%' },
    ];

    // Summaries
    const totalFederal =
      p.federal_wh + p.ss_ee + pSsEr + p.med_ee + pMedEr + pAddlMed + pFuta;
    const totalFederalYtd =
      y.federal_wh + y.ss_ee + ySsEr + y.med_ee + yMedEr + yAddlMed + yFuta;
    const totalState = p.state_wh + pSui + pWc;
    const totalStateYtd = y.state_wh + ySui + yWc;
    const grandTotal = totalFederal + totalState;
    const grandTotalYtd = totalFederalYtd + totalStateYtd;

    const employeePortion = p.federal_wh + p.ss_ee + p.med_ee + pAddlMed + p.state_wh;
    const employeePortionYtd = y.federal_wh + y.ss_ee + y.med_ee + yAddlMed + y.state_wh;
    const employerPortion = pSsEr + pMedEr + pFuta + pSui + pWc;
    const employerPortionYtd = ySsEr + yMedEr + yFuta + ySui + yWc;

    rows.push(
      { label: 'Total Federal', period: totalFederal, ytd: totalFederalYtd, rate: '', isSummary: true },
      { label: 'Total State', period: totalState, ytd: totalStateYtd, rate: '', isSummary: true },
      { label: 'Grand Total', period: grandTotal, ytd: grandTotalYtd, rate: '', isTotal: true },
      { label: 'Employee Portion', period: employeePortion, ytd: employeePortionYtd, rate: '', isSummary: true },
      { label: 'Employer Portion', period: employerPortion, ytd: employerPortionYtd, rate: '', isSummary: true }
    );

    return rows;
  }, [liabilityData]);

  const handlePrintLiability = () => {
    if (!liabilityData || !activeCompany) return;
    const companyName = activeCompany.name || 'Company';
    const dateRange = `Q${qStart}${qEnd !== qStart ? `-Q${qEnd}` : ''} ${liabilityYear}`;

    const columns: ReportColumn[] = [
      { key: 'label', label: 'Tax Type', align: 'left', format: 'text' },
      { key: 'period', label: 'Current Period', align: 'right', format: 'currency' },
      { key: 'ytd', label: 'YTD', align: 'right', format: 'currency' },
      { key: 'rate', label: 'Rate', align: 'right', format: 'text' },
    ];

    const rows = liabilityRows.map((r) => ({
      label: r.label,
      period: r.period,
      ytd: r.ytd,
      rate: r.rate,
      _bold: r.isSummary || r.isTotal,
      _separator: r.isTotal,
    }));

    const grandRow = liabilityRows.find((r) => r.isTotal);
    const summaryItems: ReportSummary[] = grandRow
      ? [
          { label: 'Grand Total (Period)', value: formatCurrency(grandRow.period), accent: 'red' },
          { label: 'Grand Total (YTD)', value: formatCurrency(grandRow.ytd), accent: 'red' },
        ]
      : [];

    const html = generateReportHTML(
      'Tax Liability Report',
      companyName,
      dateRange,
      columns,
      rows,
      summaryItems
    );
    api.printPreview(html, `Tax Liability Report ${dateRange}`);
  };

  // ─── Employee Tax Summary ─────────────────────────────
  const loadEmployeeSummary = () => {
    if (!activeCompany) return;
    setEmployeeLoading(true);
    setEmployeeError('');
    api
      .taxEmployeeTaxSummary(empYear, empFilter || undefined)
      .then((data) => setEmployeeData(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error('Employee tax summary error:', err);
        setEmployeeError(err?.message || 'Failed to load employee tax summary');
      })
      .finally(() => setEmployeeLoading(false));
  };

  useEffect(() => {
    if (reportTab === 'employee' && activeCompany) {
      loadEmployeeSummary();
    }
  }, [reportTab, activeCompany, empYear]);

  const handlePrintEmployee = () => {
    if (!activeCompany || employeeData.length === 0) return;
    const companyName = activeCompany.name || 'Company';

    const columns: ReportColumn[] = [
      { key: 'employee_name', label: 'Employee', align: 'left', format: 'text' },
      { key: 'gross_wages', label: 'Gross', align: 'right', format: 'currency' },
      { key: 'federal_wh', label: 'Fed W/H', align: 'right', format: 'currency' },
      { key: 'ss_tax', label: 'SS Tax', align: 'right', format: 'currency' },
      { key: 'medicare_tax', label: 'Medicare', align: 'right', format: 'currency' },
      { key: 'state_wh', label: 'UT W/H', align: 'right', format: 'currency' },
      { key: 'total_tax', label: 'Total Tax', align: 'right', format: 'currency' },
      { key: 'eff_rate', label: 'Eff. Rate', align: 'right', format: 'text' },
    ];

    const rows = employeeData.map((e) => ({
      employee_name: e.employee_name,
      gross_wages: e.gross_wages,
      federal_wh: e.federal_wh,
      ss_tax: e.ss_tax,
      medicare_tax: e.medicare_tax,
      state_wh: e.state_wh,
      total_tax: e.total_tax,
      eff_rate: e.gross_wages > 0 ? `${((e.total_tax / e.gross_wages) * 100).toFixed(1)}%` : '0.0%',
    }));

    const totalTax = employeeData.reduce((s, e) => s + e.total_tax, 0);
    const totalGross = employeeData.reduce((s, e) => s + e.gross_wages, 0);
    const summaryItems: ReportSummary[] = [
      { label: 'Total Tax', value: formatCurrency(totalTax), accent: 'red' },
      { label: 'Avg Effective Rate', value: totalGross > 0 ? `${((totalTax / totalGross) * 100).toFixed(1)}%` : '0.0%', accent: 'default' },
    ];

    const html = generateReportHTML(
      'Employee Tax Summary',
      companyName,
      `${empYear}`,
      columns,
      rows,
      summaryItems
    );
    api.printPreview(html, `Employee Tax Summary ${empYear}`);
  };

  return (
    <div className="space-y-6">
      {/* Report Tab Toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => setReportTab('liability')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border ${
            reportTab === 'liability'
              ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/20'
              : 'bg-bg-secondary text-text-muted border-border-primary hover:text-text-primary'
          }`}
          style={{ borderRadius: '6px' }}
        >
          <PieChart size={14} /> Tax Liability
        </button>
        <button
          onClick={() => setReportTab('employee')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border ${
            reportTab === 'employee'
              ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/20'
              : 'bg-bg-secondary text-text-muted border-border-primary hover:text-text-primary'
          }`}
          style={{ borderRadius: '6px' }}
        >
          <Users size={14} /> Employee Tax Summary
        </button>
      </div>

      {/* ─── Liability Report ───────────────────────────── */}
      {reportTab === 'liability' && (
        <div className="space-y-4">
          {liabilityError && (
            <ErrorBanner
              message={liabilityError}
              title="Liability Report Error"
              onDismiss={() => setLiabilityError('')}
            />
          )}

          {/* Controls */}
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Year
              </label>
              <div className="relative">
                <select
                  value={liabilityYear}
                  onChange={(e) => setLiabilityYear(Number(e.target.value))}
                  className="block-select text-sm pr-8"
                  style={{ borderRadius: '6px' }}
                >
                  {yearRange.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Quarter Start
              </label>
              <div className="relative">
                <select
                  value={qStart}
                  onChange={(e) => setQStart(Number(e.target.value))}
                  className="block-select text-sm pr-8"
                  style={{ borderRadius: '6px' }}
                >
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      Q{q}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Quarter End
              </label>
              <div className="relative">
                <select
                  value={qEnd}
                  onChange={(e) => setQEnd(Number(e.target.value))}
                  className="block-select text-sm pr-8"
                  style={{ borderRadius: '6px' }}
                >
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      Q{q}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                />
              </div>
            </div>
            <button
              onClick={generateLiability}
              disabled={liabilityLoading}
              className="block-btn-primary text-xs px-4 py-2 flex items-center gap-1.5"
              style={{ borderRadius: '6px' }}
            >
              <Search size={13} />
              {liabilityLoading ? 'Loading...' : 'Generate'}
            </button>
            {liabilityData && (
              <button
                onClick={handlePrintLiability}
                className="block-btn text-xs px-4 py-2 flex items-center gap-1.5"
                style={{ borderRadius: '6px' }}
              >
                <Printer size={13} /> Print
              </button>
            )}
          </div>

          {/* Liability Table */}
          {liabilityData && (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-5 py-4 border-b border-border-primary">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Tax Liability &mdash; Q{qStart}
                  {qEnd !== qStart ? `-Q${qEnd}` : ''} {liabilityYear}
                </h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Tax Type</th>
                    <th className="text-right">Current Period</th>
                    <th className="text-right">YTD</th>
                    <th className="text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {liabilityRows.map((row, i) => (
                    <tr
                      key={i}
                      className={row.isTotal ? 'border-t-2 border-t-border-primary' : ''}
                    >
                      <td
                        className={`text-sm ${
                          row.isSummary || row.isTotal
                            ? 'font-bold text-text-primary'
                            : 'text-text-secondary'
                        }`}
                      >
                        {row.label}
                      </td>
                      <td
                        className={`text-right font-mono text-sm ${
                          row.isTotal
                            ? 'font-bold text-accent-expense'
                            : row.isSummary
                              ? 'font-semibold text-text-primary'
                              : 'text-text-secondary'
                        }`}
                      >
                        {formatCurrency(row.period)}
                      </td>
                      <td
                        className={`text-right font-mono text-sm ${
                          row.isTotal
                            ? 'font-bold text-accent-expense'
                            : row.isSummary
                              ? 'font-semibold text-text-primary'
                              : 'text-text-secondary'
                        }`}
                      >
                        {formatCurrency(row.ytd)}
                      </td>
                      <td className="text-right text-xs text-text-muted">{row.rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!liabilityData && !liabilityLoading && (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <PieChart size={32} className="text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-muted">
                Select a period and click Generate to view the tax liability report.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ─── Employee Tax Summary ───────────────────────── */}
      {reportTab === 'employee' && (
        <div className="space-y-4">
          {employeeError && (
            <ErrorBanner
              message={employeeError}
              title="Employee Report Error"
              onDismiss={() => setEmployeeError('')}
            />
          )}

          {/* Controls */}
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Year
              </label>
              <div className="relative">
                <select
                  value={empYear}
                  onChange={(e) => setEmpYear(Number(e.target.value))}
                  className="block-select text-sm pr-8"
                  style={{ borderRadius: '6px' }}
                >
                  {yearRange.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Employee (Optional)
              </label>
              <div className="relative">
                <select
                  value={empFilter}
                  onChange={(e) => setEmpFilter(e.target.value)}
                  className="block-select text-sm pr-8"
                  style={{ borderRadius: '6px', minWidth: '200px' }}
                >
                  <option value="">All Employees</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                />
              </div>
            </div>
            <button
              onClick={loadEmployeeSummary}
              disabled={employeeLoading}
              className="block-btn-primary text-xs px-4 py-2 flex items-center gap-1.5"
              style={{ borderRadius: '6px' }}
            >
              <Search size={13} />
              {employeeLoading ? 'Loading...' : 'Generate'}
            </button>
            {employeeData.length > 0 && (
              <button
                onClick={handlePrintEmployee}
                className="block-btn text-xs px-4 py-2 flex items-center gap-1.5"
                style={{ borderRadius: '6px' }}
              >
                <Printer size={13} /> Print
              </button>
            )}
          </div>

          {/* Employee Table */}
          {employeeData.length > 0 ? (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-5 py-4 border-b border-border-primary">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Employee Tax Summary &mdash; {empYear}
                </h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Fed W/H</th>
                    <th className="text-right">SS Tax</th>
                    <th className="text-right">Medicare</th>
                    <th className="text-right">UT W/H</th>
                    <th className="text-right">Total Tax</th>
                    <th className="text-right">Eff. Rate</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {employeeData.map((emp) => {
                    const effRate =
                      emp.gross_wages > 0
                        ? ((emp.total_tax / emp.gross_wages) * 100).toFixed(1)
                        : '0.0';
                    const isExpanded = expandedEmp === emp.employee_id;
                    return (
                      <React.Fragment key={emp.employee_id}>
                        <tr>
                          <td className="text-sm font-medium text-text-primary">
                            {emp.employee_name}
                          </td>
                          <td className="text-right font-mono text-sm text-text-secondary">
                            {formatCurrency(emp.gross_wages)}
                          </td>
                          <td className="text-right font-mono text-sm text-text-secondary">
                            {formatCurrency(emp.federal_wh)}
                          </td>
                          <td className="text-right font-mono text-sm text-text-secondary">
                            {formatCurrency(emp.ss_tax)}
                          </td>
                          <td className="text-right font-mono text-sm text-text-secondary">
                            {formatCurrency(emp.medicare_tax)}
                          </td>
                          <td className="text-right font-mono text-sm text-text-secondary">
                            {formatCurrency(emp.state_wh)}
                          </td>
                          <td className="text-right font-mono text-sm font-semibold text-text-primary">
                            {formatCurrency(emp.total_tax)}
                          </td>
                          <td className="text-right text-xs text-text-muted">{effRate}%</td>
                          <td>
                            <button
                              onClick={() =>
                                setExpandedEmp(isExpanded ? null : emp.employee_id)
                              }
                              className="text-text-muted hover:text-text-primary"
                            >
                              {isExpanded ? (
                                <ChevronUp size={14} />
                              ) : (
                                <ChevronDown size={14} />
                              )}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={9} className="bg-bg-secondary px-6 py-3">
                              <div className="grid grid-cols-3 gap-4 text-xs">
                                <div>
                                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                    Filing Status
                                  </span>
                                  <p className="text-text-primary mt-0.5">
                                    {emp.w4_filing_status || 'Not set'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                    Allowances
                                  </span>
                                  <p className="text-text-primary mt-0.5">
                                    {emp.w4_allowances ?? 'N/A'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                    Additional W/H
                                  </span>
                                  <p className="text-text-primary mt-0.5">
                                    {emp.w4_additional_wh != null
                                      ? formatCurrency(emp.w4_additional_wh)
                                      : 'None'}
                                  </p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="text-sm font-bold text-text-primary">Totals</td>
                    <td className="text-right font-mono font-bold text-text-primary">
                      {formatCurrency(
                        employeeData.reduce((s, e) => s + e.gross_wages, 0)
                      )}
                    </td>
                    <td className="text-right font-mono font-bold text-text-primary">
                      {formatCurrency(
                        employeeData.reduce((s, e) => s + e.federal_wh, 0)
                      )}
                    </td>
                    <td className="text-right font-mono font-bold text-text-primary">
                      {formatCurrency(
                        employeeData.reduce((s, e) => s + e.ss_tax, 0)
                      )}
                    </td>
                    <td className="text-right font-mono font-bold text-text-primary">
                      {formatCurrency(
                        employeeData.reduce((s, e) => s + e.medicare_tax, 0)
                      )}
                    </td>
                    <td className="text-right font-mono font-bold text-text-primary">
                      {formatCurrency(
                        employeeData.reduce((s, e) => s + e.state_wh, 0)
                      )}
                    </td>
                    <td className="text-right font-mono font-bold text-accent-expense">
                      {formatCurrency(
                        employeeData.reduce((s, e) => s + e.total_tax, 0)
                      )}
                    </td>
                    <td className="text-right text-xs font-semibold text-text-muted">
                      {(() => {
                        const tg = employeeData.reduce(
                          (s, e) => s + e.gross_wages,
                          0
                        );
                        const tt = employeeData.reduce(
                          (s, e) => s + e.total_tax,
                          0
                        );
                        return tg > 0 ? `${((tt / tg) * 100).toFixed(1)}%` : '0.0%';
                      })()}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : !employeeLoading ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <Users size={32} className="text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-muted">
                {empFilter
                  ? 'No tax data found for the selected employee.'
                  : 'No employee tax data available for this year.'}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default TaxReports;
