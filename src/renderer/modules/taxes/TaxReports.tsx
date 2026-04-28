import React, { useEffect, useState, useMemo } from 'react';
import {
  PieChart,
  Users,
  Printer,
  ChevronDown,
  ChevronUp,
  Search,
  ClipboardCheck,
  Building2,
  Columns,
  Wallet,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { generateReportHTML, type ReportColumn, type ReportSummary } from '../../lib/print-templates';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
type ReportTab = 'liability' | 'employee' | 'w4compliance' | 'department' | 'quarterlyCompare' | 'deposits';

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

interface W4ComplianceRow {
  id: string;
  name: string;
  w4_filing_status: string | null;
  w4_received_date: string | null;
  start_date: string | null;
  status: string;
}

interface DepartmentRow {
  dept: string;
  emp_count: number;
  gross: number;
  federal: number;
  state: number;
  ss: number;
  medicare: number;
}

interface DepositRow {
  id: string;
  form_type: string;
  quarter: number;
  year: number;
  amount_paid: number;
  payment_date: string;
  confirmation_number: string | null;
  notes: string | null;
}

interface ContractorRow {
  id: string;
  name: string;
  type: string;
  total_paid: number;
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

// ─── Inline helpers for print HTML ──────────────────────
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const _fmtCurr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
function fmtCurrency(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? _fmtCurr.format(v) : '$0.00';
}

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

  // Feature 54: W-4 Compliance state
  const [w4Data, setW4Data] = useState<W4ComplianceRow[]>([]);
  const [w4Loading, setW4Loading] = useState(false);
  const [w4Error, setW4Error] = useState('');

  // Feature 55: Department Tax Allocation state
  const [deptYear, setDeptYear] = useState(currentYear);
  const [deptData, setDeptData] = useState<DepartmentRow[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptError, setDeptError] = useState('');

  // Feature 56: Quarterly Comparison state
  const [qcYear, setQcYear] = useState(currentYear);
  const [qcData, setQcData] = useState<Array<{ label: string; q1: number; q2: number; q3: number; q4: number; total: number }>>([]);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcError, setQcError] = useState('');

  // Feature 57: 1099 Contractor data
  const [contractorData, setContractorData] = useState<ContractorRow[]>([]);

  // Feature 58: Deposit History state
  const [depositData, setDepositData] = useState<DepositRow[]>([]);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState('');

  useEffect(() => {
    if (!activeCompany) return;
    api
      .rawQuery(
        'SELECT id, name FROM employees WHERE company_id = ? AND status = \'active\' ORDER BY name',
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
      // Feature 57: load 1099 contractor data alongside employee summary
      api.rawQuery(
        `SELECT e.id, e.name, e.type,
          COALESCE((SELECT SUM(ps.gross_pay) FROM pay_stubs ps JOIN payroll_runs pr ON ps.payroll_run_id = pr.id WHERE ps.employee_id = e.id AND pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?), 0) as total_paid
        FROM employees e WHERE e.company_id = ? AND e.type = 'contractor' ORDER BY e.name`,
        [activeCompany.id, `${empYear}-01-01`, `${empYear}-12-31`, activeCompany.id]
      )
        .then((rows: any[]) => setContractorData(Array.isArray(rows) ? rows : []))
        .catch(console.error);
    }
  }, [reportTab, activeCompany, empYear]);

  // Feature 54: W-4 Compliance loader
  const loadW4Compliance = () => {
    if (!activeCompany) return;
    setW4Loading(true);
    setW4Error('');
    api.rawQuery(
      `SELECT id, name, w4_filing_status, w4_received_date, start_date, status
      FROM employees WHERE company_id = ? AND status = 'active' ORDER BY name`,
      [activeCompany.id]
    )
      .then((rows: any[]) => setW4Data(Array.isArray(rows) ? rows : []))
      .catch((err: any) => setW4Error(err?.message || 'Failed to load W-4 data'))
      .finally(() => setW4Loading(false));
  };

  useEffect(() => {
    if (reportTab === 'w4compliance' && activeCompany) loadW4Compliance();
  }, [reportTab, activeCompany]);

  // Feature 55: Department Tax Allocation loader
  const loadDeptReport = () => {
    if (!activeCompany) return;
    setDeptLoading(true);
    setDeptError('');
    api.rawQuery(
      `SELECT COALESCE(e.department, 'Unassigned') as dept, COUNT(DISTINCT ps.employee_id) as emp_count,
        COALESCE(SUM(ps.gross_pay),0) as gross, COALESCE(SUM(ps.federal_tax),0) as federal,
        COALESCE(SUM(ps.state_tax),0) as state, COALESCE(SUM(ps.social_security),0) as ss,
        COALESCE(SUM(ps.medicare),0) as medicare
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      JOIN employees e ON ps.employee_id = e.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
      GROUP BY e.department ORDER BY gross DESC`,
      [activeCompany.id, `${deptYear}-01-01`, `${deptYear}-12-31`]
    )
      .then((rows: any[]) => setDeptData(Array.isArray(rows) ? rows : []))
      .catch((err: any) => setDeptError(err?.message || 'Failed to load department data'))
      .finally(() => setDeptLoading(false));
  };

  useEffect(() => {
    if (reportTab === 'department' && activeCompany) loadDeptReport();
  }, [reportTab, activeCompany, deptYear]);

  // Feature 56: Quarterly Comparison loader
  const loadQcReport = () => {
    if (!activeCompany) return;
    setQcLoading(true);
    setQcError('');

    const quarterRanges = [
      { q: 1, start: `${qcYear}-01-01`, end: `${qcYear}-03-31` },
      { q: 2, start: `${qcYear}-04-01`, end: `${qcYear}-06-30` },
      { q: 3, start: `${qcYear}-07-01`, end: `${qcYear}-09-30` },
      { q: 4, start: `${qcYear}-10-01`, end: `${qcYear}-12-31` },
    ];

    Promise.all(
      quarterRanges.map(({ start, end }) =>
        api.rawQuery(
          `SELECT
            COALESCE(SUM(ps.gross_pay),0) as wages,
            COALESCE(SUM(ps.federal_tax),0) as federal,
            COALESCE(SUM(ps.state_tax),0) as state_wh,
            COALESCE(SUM(ps.social_security),0) as ss,
            COALESCE(SUM(ps.medicare),0) as medicare
          FROM pay_stubs ps
          JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
          WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?`,
          [activeCompany!.id, start, end]
        )
      )
    )
      .then((results: any[]) => {
        const qd = results.map((rows) => {
          const r = Array.isArray(rows) && rows.length > 0 ? rows[0] : { wages: 0, federal: 0, state_wh: 0, ss: 0, medicare: 0 };
          return r;
        });
        const metrics = ['wages', 'federal', 'state_wh', 'ss', 'medicare'];
        const labels: Record<string, string> = {
          wages: 'Gross Wages',
          federal: 'Federal W/H',
          state_wh: 'State W/H',
          ss: 'Social Security',
          medicare: 'Medicare',
        };
        const rows = metrics.map((key) => {
          const q1 = Number(qd[0]?.[key] ?? 0);
          const q2 = Number(qd[1]?.[key] ?? 0);
          const q3 = Number(qd[2]?.[key] ?? 0);
          const q4 = Number(qd[3]?.[key] ?? 0);
          return { label: labels[key], q1, q2, q3, q4, total: q1 + q2 + q3 + q4 };
        });
        // Add a total row
        const totalRow = {
          label: 'Total',
          q1: rows.reduce((s, r) => s + r.q1, 0),
          q2: rows.reduce((s, r) => s + r.q2, 0),
          q3: rows.reduce((s, r) => s + r.q3, 0),
          q4: rows.reduce((s, r) => s + r.q4, 0),
          total: rows.reduce((s, r) => s + r.total, 0),
        };
        setQcData([...rows, totalRow]);
      })
      .catch((err: any) => setQcError(err?.message || 'Failed to load quarterly comparison'))
      .finally(() => setQcLoading(false));
  };

  useEffect(() => {
    if (reportTab === 'quarterlyCompare' && activeCompany) loadQcReport();
  }, [reportTab, activeCompany, qcYear]);

  // Feature 58: Deposit History loader
  const loadDeposits = () => {
    if (!activeCompany) return;
    setDepositLoading(true);
    setDepositError('');
    api.rawQuery(
      `SELECT id, form_type, quarter, year, amount_paid, payment_date, confirmation_number, notes
      FROM tax_filing_periods WHERE company_id = ? AND amount_paid > 0 ORDER BY payment_date DESC`,
      [activeCompany.id]
    )
      .then((rows: any[]) => setDepositData(Array.isArray(rows) ? rows : []))
      .catch((err: any) => setDepositError(err?.message || 'Failed to load deposit history'))
      .finally(() => setDepositLoading(false));
  };

  useEffect(() => {
    if (reportTab === 'deposits' && activeCompany) loadDeposits();
  }, [reportTab, activeCompany]);

  // Feature 59-60: Print handlers for new reports
  const handlePrintW4 = () => {
    if (!activeCompany || w4Data.length === 0) return;
    const companyName = activeCompany.name || 'Company';
    const today = new Date();
    const tableRows = w4Data.map((e) => {
      const received = e.w4_received_date;
      const daysSinceHire = e.start_date ? Math.ceil((today.getTime() - new Date(e.start_date).getTime()) / (1000 * 60 * 60 * 24)) : 0;
      const isOld = received && (today.getTime() - new Date(received).getTime()) > 365 * 24 * 60 * 60 * 1000;
      const status = !received ? 'MISSING' : isOld ? 'OUTDATED' : 'Current';
      return `<tr${!received || isOld ? ' style="background:#fef2f2;"' : ''}><td>${esc(e.name)}</td><td>${status}</td><td>${e.w4_filing_status || 'N/A'}</td><td>${received || 'N/A'}</td><td class="text-right">${daysSinceHire}</td></tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; font-size: 12px; padding: 40px; background: #fff; }
      h1 { font-size: 18px; margin-bottom: 4px; } h2 { font-size: 14px; color: #475569; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
      th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; background: #f8fafc; font-weight: 700; }
      .text-right { text-align: right; }
    </style></head><body>
      <h1>W-4 Compliance Report</h1><h2>${esc(companyName)}</h2>
      <table><thead><tr><th>Employee</th><th>W-4 Status</th><th>Filing Status</th><th>Received Date</th><th class="text-right">Days Since Hire</th></tr></thead>
      <tbody>${tableRows}</tbody></table>
    </body></html>`;
    api.printPreview(html, 'W-4 Compliance Report');
  };

  const handlePrintDept = () => {
    if (!activeCompany || deptData.length === 0) return;
    const companyName = activeCompany.name || 'Company';
    const columns: ReportColumn[] = [
      { key: 'dept', label: 'Department', align: 'left', format: 'text' },
      { key: 'emp_count', label: 'Employees', align: 'right', format: 'text' },
      { key: 'gross', label: 'Gross', align: 'right', format: 'currency' },
      { key: 'federal', label: 'Federal', align: 'right', format: 'currency' },
      { key: 'state', label: 'State', align: 'right', format: 'currency' },
      { key: 'ss', label: 'SS', align: 'right', format: 'currency' },
      { key: 'medicare', label: 'Medicare', align: 'right', format: 'currency' },
      { key: 'total_tax', label: 'Total Tax', align: 'right', format: 'currency' },
    ];
    const rows = deptData.map((d) => ({
      ...d,
      total_tax: d.federal + d.state + d.ss + d.medicare,
    }));
    const totalTax = rows.reduce((s, r) => s + r.total_tax, 0);
    const html = generateReportHTML('Department Tax Allocation', companyName, `${deptYear}`, columns, rows, [
      { label: 'Total Tax', value: formatCurrency(totalTax), accent: 'red' },
    ]);
    api.printPreview(html, `Department Tax Allocation ${deptYear}`);
  };

  const handlePrintQC = () => {
    if (!activeCompany || qcData.length === 0) return;
    const companyName = activeCompany.name || 'Company';
    const columns: ReportColumn[] = [
      { key: 'label', label: 'Metric', align: 'left', format: 'text' },
      { key: 'q1', label: 'Q1', align: 'right', format: 'currency' },
      { key: 'q2', label: 'Q2', align: 'right', format: 'currency' },
      { key: 'q3', label: 'Q3', align: 'right', format: 'currency' },
      { key: 'q4', label: 'Q4', align: 'right', format: 'currency' },
      { key: 'total', label: 'Total', align: 'right', format: 'currency' },
    ];
    const rows = qcData.map((r, i) => ({
      ...r,
      _bold: i === qcData.length - 1,
      _separator: i === qcData.length - 1,
    }));
    const html = generateReportHTML('Quarterly Comparison', companyName, `${qcYear}`, columns, rows, []);
    api.printPreview(html, `Quarterly Comparison ${qcYear}`);
  };

  const handlePrintDeposits = () => {
    if (!activeCompany || depositData.length === 0) return;
    const companyName = activeCompany.name || 'Company';
    const tableRows = depositData.map((d) =>
      `<tr><td>${d.payment_date || ''}</td><td>${d.form_type || ''}</td><td>Q${d.quarter} ${d.year}</td><td class="text-right font-mono">${fmtCurrency(d.amount_paid)}</td><td>${esc(d.confirmation_number || '')}</td><td>${esc(d.notes || '')}</td></tr>`
    ).join('');
    const totalPaid = depositData.reduce((s, d) => s + (d.amount_paid || 0), 0);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; font-size: 12px; padding: 40px; background: #fff; }
      h1 { font-size: 18px; margin-bottom: 4px; } h2 { font-size: 14px; color: #475569; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
      th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; background: #f8fafc; font-weight: 700; }
      .text-right { text-align: right; } .font-mono { font-family: 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums; }
      .total-row td { font-weight: 700; border-top: 2px solid #0f172a; }
    </style></head><body>
      <h1>Tax Deposit History</h1><h2>${esc(companyName)}</h2>
      <table><thead><tr><th>Date</th><th>Form</th><th>Quarter</th><th class="text-right">Amount</th><th>Confirmation #</th><th>Notes</th></tr></thead>
      <tbody>${tableRows}<tr class="total-row"><td colspan="3">Total</td><td class="text-right font-mono">${fmtCurrency(totalPaid)}</td><td colspan="2"></td></tr></tbody></table>
    </body></html>`;
    api.printPreview(html, 'Tax Deposit History');
  };

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
      <div className="flex gap-1 flex-wrap">
        {([
          { key: 'liability' as ReportTab, icon: <PieChart size={14} />, label: 'Tax Liability' },
          { key: 'employee' as ReportTab, icon: <Users size={14} />, label: 'Employee Summary' },
          { key: 'w4compliance' as ReportTab, icon: <ClipboardCheck size={14} />, label: 'W-4 Compliance' },
          { key: 'department' as ReportTab, icon: <Building2 size={14} />, label: 'By Department' },
          { key: 'quarterlyCompare' as ReportTab, icon: <Columns size={14} />, label: 'Quarter Comparison' },
          { key: 'deposits' as ReportTab, icon: <Wallet size={14} />, label: 'Deposit History' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setReportTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border ${
              reportTab === tab.key
                ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/20'
                : 'bg-bg-secondary text-text-muted border-border-primary hover:text-text-primary'
            }`}
            style={{ borderRadius: '6px' }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
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

          {/* Feature 57: 1099 Contractor Summary */}
          {contractorData.length > 0 && (
            <div className="block-card p-0 overflow-hidden mt-6" style={{ borderRadius: '6px' }}>
              <div className="px-5 py-4 border-b border-border-primary">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">1099 Contractor Summary — {empYear}</h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Contractor</th>
                    <th>Type</th>
                    <th className="text-right">Total Paid</th>
                    <th className="text-right">1099 Required</th>
                  </tr>
                </thead>
                <tbody>
                  {contractorData.map((c) => (
                    <tr key={c.id}>
                      <td className="text-sm font-medium text-text-primary">{c.name}</td>
                      <td className="text-sm text-text-secondary capitalize">{c.type}</td>
                      <td className="text-right font-mono text-sm text-text-secondary">{formatCurrency(c.total_paid)}</td>
                      <td className="text-right text-xs">
                        {c.total_paid >= 600 ? (
                          <span className="text-accent-expense font-semibold">Yes (&ge;$600)</span>
                        ) : (
                          <span className="text-text-muted">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="text-sm font-bold text-text-primary">
                      Total ({contractorData.length} contractor{contractorData.length !== 1 ? 's' : ''})
                    </td>
                    <td />
                    <td className="text-right font-mono font-bold text-text-primary">
                      {formatCurrency(contractorData.reduce((s, c) => s + c.total_paid, 0))}
                    </td>
                    <td className="text-right text-xs font-semibold text-text-muted">
                      {contractorData.filter((c) => c.total_paid >= 600).length} required
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
      {/* ─── W-4 Compliance Report (Feature 54) ──────────── */}
      {reportTab === 'w4compliance' && (
        <div className="space-y-4">
          {w4Error && (
            <ErrorBanner message={w4Error} title="W-4 Report Error" onDismiss={() => setW4Error('')} />
          )}

          <div className="flex items-end gap-3">
            <button
              onClick={loadW4Compliance}
              disabled={w4Loading}
              className="block-btn-primary text-xs px-4 py-2 flex items-center gap-1.5"
              style={{ borderRadius: '6px' }}
            >
              <Search size={13} />
              {w4Loading ? 'Loading...' : 'Refresh'}
            </button>
            {w4Data.length > 0 && (
              <button
                onClick={handlePrintW4}
                className="block-btn text-xs px-4 py-2 flex items-center gap-1.5"
                style={{ borderRadius: '6px' }}
              >
                <Printer size={13} /> Print
              </button>
            )}
          </div>

          {w4Data.length > 0 ? (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-5 py-4 border-b border-border-primary">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  W-4 Compliance — Active Employees
                </h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>W-4 Status</th>
                    <th>Filing Status</th>
                    <th>Received Date</th>
                    <th className="text-right">Days Since Hire</th>
                  </tr>
                </thead>
                <tbody>
                  {w4Data.map((emp) => {
                    const today = new Date();
                    const received = emp.w4_received_date;
                    const isOld = received && (today.getTime() - new Date(received).getTime()) > 365 * 24 * 60 * 60 * 1000;
                    const isMissing = !received;
                    const daysSinceHire = emp.start_date
                      ? Math.ceil((today.getTime() - new Date(emp.start_date).getTime()) / (1000 * 60 * 60 * 24))
                      : 0;
                    return (
                      <tr key={emp.id} className={isMissing || isOld ? 'bg-accent-expense/5' : ''}>
                        <td className="text-sm font-medium text-text-primary">{emp.name}</td>
                        <td>
                          {isMissing ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border bg-accent-expense/10 text-accent-expense border-accent-expense/20" style={{ borderRadius: '6px' }}>Missing</span>
                          ) : isOld ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border bg-accent-warning/10 text-accent-warning border-accent-warning/20" style={{ borderRadius: '6px' }}>Outdated</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border bg-accent-income/10 text-accent-income border-accent-income/20" style={{ borderRadius: '6px' }}>Current</span>
                          )}
                        </td>
                        <td className="text-sm text-text-secondary">{emp.w4_filing_status || 'N/A'}</td>
                        <td className="text-sm text-text-secondary">{received || 'N/A'}</td>
                        <td className="text-right font-mono text-sm text-text-secondary">{daysSinceHire}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : !w4Loading ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <ClipboardCheck size={32} className="text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-muted">No active employees found.</p>
            </div>
          ) : null}
        </div>
      )}

      {/* ─── Department Tax Allocation (Feature 55) ────── */}
      {reportTab === 'department' && (
        <div className="space-y-4">
          {deptError && (
            <ErrorBanner message={deptError} title="Department Report Error" onDismiss={() => setDeptError('')} />
          )}

          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Year</label>
              <div className="relative">
                <select value={deptYear} onChange={(e) => setDeptYear(Number(e.target.value))} className="block-select text-sm pr-8" style={{ borderRadius: '6px' }}>
                  {yearRange.map((y) => (<option key={y} value={y}>{y}</option>))}
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            </div>
            <button onClick={loadDeptReport} disabled={deptLoading} className="block-btn-primary text-xs px-4 py-2 flex items-center gap-1.5" style={{ borderRadius: '6px' }}>
              <Search size={13} />{deptLoading ? 'Loading...' : 'Generate'}
            </button>
            {deptData.length > 0 && (
              <button onClick={handlePrintDept} className="block-btn text-xs px-4 py-2 flex items-center gap-1.5" style={{ borderRadius: '6px' }}>
                <Printer size={13} /> Print
              </button>
            )}
          </div>

          {deptData.length > 0 ? (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-5 py-4 border-b border-border-primary">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Department Tax Allocation — {deptYear}
                </h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="text-right">Employees</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Federal</th>
                    <th className="text-right">State</th>
                    <th className="text-right">SS</th>
                    <th className="text-right">Medicare</th>
                    <th className="text-right">Total Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {deptData.map((d, i) => {
                    const totalTax = d.federal + d.state + d.ss + d.medicare;
                    return (
                      <tr key={i}>
                        <td className="text-sm font-medium text-text-primary">{d.dept}</td>
                        <td className="text-right font-mono text-sm text-text-secondary">{d.emp_count}</td>
                        <td className="text-right font-mono text-sm text-text-secondary">{formatCurrency(d.gross)}</td>
                        <td className="text-right font-mono text-sm text-text-secondary">{formatCurrency(d.federal)}</td>
                        <td className="text-right font-mono text-sm text-text-secondary">{formatCurrency(d.state)}</td>
                        <td className="text-right font-mono text-sm text-text-secondary">{formatCurrency(d.ss)}</td>
                        <td className="text-right font-mono text-sm text-text-secondary">{formatCurrency(d.medicare)}</td>
                        <td className="text-right font-mono text-sm font-semibold text-text-primary">{formatCurrency(totalTax)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="text-sm font-bold text-text-primary">Totals</td>
                    <td className="text-right font-mono font-bold text-text-primary">{deptData.reduce((s, d) => s + d.emp_count, 0)}</td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(deptData.reduce((s, d) => s + d.gross, 0))}</td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(deptData.reduce((s, d) => s + d.federal, 0))}</td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(deptData.reduce((s, d) => s + d.state, 0))}</td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(deptData.reduce((s, d) => s + d.ss, 0))}</td>
                    <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(deptData.reduce((s, d) => s + d.medicare, 0))}</td>
                    <td className="text-right font-mono font-bold text-accent-expense">{formatCurrency(deptData.reduce((s, d) => s + d.federal + d.state + d.ss + d.medicare, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : !deptLoading ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <Building2 size={32} className="text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-muted">Select a year and click Generate to view department tax allocation.</p>
            </div>
          ) : null}
        </div>
      )}

      {/* ─── Quarterly Comparison (Feature 56) ─────────── */}
      {reportTab === 'quarterlyCompare' && (
        <div className="space-y-4">
          {qcError && (
            <ErrorBanner message={qcError} title="Quarterly Comparison Error" onDismiss={() => setQcError('')} />
          )}

          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Year</label>
              <div className="relative">
                <select value={qcYear} onChange={(e) => setQcYear(Number(e.target.value))} className="block-select text-sm pr-8" style={{ borderRadius: '6px' }}>
                  {yearRange.map((y) => (<option key={y} value={y}>{y}</option>))}
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            </div>
            <button onClick={loadQcReport} disabled={qcLoading} className="block-btn-primary text-xs px-4 py-2 flex items-center gap-1.5" style={{ borderRadius: '6px' }}>
              <Search size={13} />{qcLoading ? 'Loading...' : 'Generate'}
            </button>
            {qcData.length > 0 && (
              <button onClick={handlePrintQC} className="block-btn text-xs px-4 py-2 flex items-center gap-1.5" style={{ borderRadius: '6px' }}>
                <Printer size={13} /> Print
              </button>
            )}
          </div>

          {qcData.length > 0 ? (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-5 py-4 border-b border-border-primary">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Quarterly Comparison — {qcYear}
                </h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="text-right">Q1</th>
                    <th className="text-right">Q2</th>
                    <th className="text-right">Q3</th>
                    <th className="text-right">Q4</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {qcData.map((row, i) => {
                    const isTotal = i === qcData.length - 1;
                    return (
                      <tr key={i} className={isTotal ? 'border-t-2 border-t-border-primary' : ''}>
                        <td className={`text-sm ${isTotal ? 'font-bold text-text-primary' : 'text-text-secondary'}`}>{row.label}</td>
                        <td className={`text-right font-mono text-sm ${isTotal ? 'font-bold text-accent-expense' : 'text-text-secondary'}`}>{formatCurrency(row.q1)}</td>
                        <td className={`text-right font-mono text-sm ${isTotal ? 'font-bold text-accent-expense' : 'text-text-secondary'}`}>{formatCurrency(row.q2)}</td>
                        <td className={`text-right font-mono text-sm ${isTotal ? 'font-bold text-accent-expense' : 'text-text-secondary'}`}>{formatCurrency(row.q3)}</td>
                        <td className={`text-right font-mono text-sm ${isTotal ? 'font-bold text-accent-expense' : 'text-text-secondary'}`}>{formatCurrency(row.q4)}</td>
                        <td className={`text-right font-mono text-sm ${isTotal ? 'font-bold text-accent-expense' : 'font-semibold text-text-primary'}`}>{formatCurrency(row.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : !qcLoading ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <Columns size={32} className="text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-muted">Select a year and click Generate to view the quarterly comparison.</p>
            </div>
          ) : null}
        </div>
      )}

      {/* ─── Deposit History (Feature 58) ──────────────── */}
      {reportTab === 'deposits' && (
        <div className="space-y-4">
          {depositError && (
            <ErrorBanner message={depositError} title="Deposit History Error" onDismiss={() => setDepositError('')} />
          )}

          <div className="flex items-end gap-3">
            <button onClick={loadDeposits} disabled={depositLoading} className="block-btn-primary text-xs px-4 py-2 flex items-center gap-1.5" style={{ borderRadius: '6px' }}>
              <Search size={13} />{depositLoading ? 'Loading...' : 'Refresh'}
            </button>
            {depositData.length > 0 && (
              <button onClick={handlePrintDeposits} className="block-btn text-xs px-4 py-2 flex items-center gap-1.5" style={{ borderRadius: '6px' }}>
                <Printer size={13} /> Print
              </button>
            )}
          </div>

          {depositData.length > 0 ? (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-5 py-4 border-b border-border-primary">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Tax Deposit History
                </h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Form</th>
                    <th>Quarter</th>
                    <th className="text-right">Amount</th>
                    <th>Confirmation #</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {depositData.map((d) => (
                    <tr key={d.id}>
                      <td className="text-sm text-text-secondary">{d.payment_date || ''}</td>
                      <td className="text-sm text-text-secondary">{d.form_type}</td>
                      <td className="text-sm text-text-secondary">Q{d.quarter} {d.year}</td>
                      <td className="text-right font-mono text-sm text-text-primary font-semibold">{formatCurrency(d.amount_paid)}</td>
                      <td className="text-sm text-text-secondary">{d.confirmation_number || ''}</td>
                      <td className="text-sm text-text-muted">{d.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="text-sm font-bold text-text-primary">Total Deposits</td>
                    <td className="text-right font-mono font-bold text-accent-income">{formatCurrency(depositData.reduce((s, d) => s + (d.amount_paid || 0), 0))}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : !depositLoading ? (
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <Wallet size={32} className="text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-muted">No tax deposits recorded. Deposits are created when you record payments in Tax Filing.</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default TaxReports;
