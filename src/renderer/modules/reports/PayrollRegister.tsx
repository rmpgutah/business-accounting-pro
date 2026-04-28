import React, { useEffect, useState, useMemo } from 'react';
import { Printer, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { format, startOfYear, endOfMonth } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import { downloadCSVBlob } from '../../lib/csv-export';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// ─── Types ──────────────────────────────────────────────
interface PayStub {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_type: string;
  pay_type: string;
  department: string;
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  net_pay: number;
  hours_regular: number;
  hours_overtime: number;
  other_deductions: number;
  payroll_run_id: string;
  pay_date: string;
  run_type: string;
}

interface DeptBreakdown {
  dept: string;
  emp_count: number;
  gross: number;
  taxes: number;
  net: number;
}

interface MonthlyTrend {
  month: string;
  gross: number;
}

interface RunTypeGroup {
  run_type: string;
  count: number;
  gross: number;
  taxes: number;
  net: number;
}

// ─── Component ──────────────────────────────────────────
const PayrollRegister: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  // Change 59: Date range selector
  const [startDate, setStartDate] = useState(() => format(startOfYear(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const [stubs, setStubs] = useState<PayStub[]>([]);
  const [deptBreakdown, setDeptBreakdown] = useState<DeptBreakdown[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        // Change 61: Full employee detail table
        const stubRows: any[] = await api.rawQuery(
          `SELECT ps.*, e.name as employee_name, e.type as employee_type, e.pay_type,
                  COALESCE(e.department, 'Unassigned') as department,
                  pr.pay_date, pr.run_type
           FROM pay_stubs ps
           JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
           JOIN employees e ON ps.employee_id = e.id
           WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
           ORDER BY pr.pay_date DESC, e.name`,
          [activeCompany.id, startDate, endDate]
        );

        // Change 60: Department breakdown
        const deptRows: any[] = await api.rawQuery(
          `SELECT COALESCE(e.department, 'Unassigned') as dept,
                  COUNT(DISTINCT ps.employee_id) as emp_count,
                  COALESCE(SUM(ps.gross_pay), 0) as gross,
                  COALESCE(SUM(ps.federal_tax + ps.state_tax + ps.social_security + ps.medicare), 0) as taxes,
                  COALESCE(SUM(ps.net_pay), 0) as net
           FROM pay_stubs ps
           JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
           JOIN employees e ON ps.employee_id = e.id
           WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
           GROUP BY e.department ORDER BY gross DESC`,
          [activeCompany.id, startDate, endDate]
        );

        // Change 62: Monthly trend
        const trendRows: any[] = await api.rawQuery(
          `SELECT strftime('%Y-%m', pr.pay_date) as month,
                  COALESCE(SUM(ps.gross_pay), 0) as gross
           FROM pay_stubs ps
           JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
           WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
           GROUP BY strftime('%Y-%m', pr.pay_date)
           ORDER BY month`,
          [activeCompany.id, startDate, endDate]
        );

        if (cancelled) return;

        setStubs((stubRows ?? []).map((r: any) => ({
          id: r.id,
          employee_id: r.employee_id,
          employee_name: r.employee_name || 'Unknown',
          employee_type: r.employee_type || '',
          pay_type: r.pay_type || '',
          department: r.department || 'Unassigned',
          gross_pay: Number(r.gross_pay) || 0,
          federal_tax: Number(r.federal_tax) || 0,
          state_tax: Number(r.state_tax) || 0,
          social_security: Number(r.social_security) || 0,
          medicare: Number(r.medicare) || 0,
          net_pay: Number(r.net_pay) || 0,
          hours_regular: Number(r.hours_regular) || 0,
          hours_overtime: Number(r.hours_overtime) || 0,
          other_deductions: Number(r.other_deductions) || 0,
          payroll_run_id: r.payroll_run_id,
          pay_date: r.pay_date || '',
          run_type: r.run_type || 'Regular',
        })));

        setDeptBreakdown((deptRows ?? []).map((r: any) => ({
          dept: r.dept || 'Unassigned',
          emp_count: Number(r.emp_count) || 0,
          gross: Number(r.gross) || 0,
          taxes: Number(r.taxes) || 0,
          net: Number(r.net) || 0,
        })));

        setMonthlyTrend((trendRows ?? []).map((r: any) => ({
          month: r.month || '',
          gross: Number(r.gross) || 0,
        })));
      } catch (err) {
        console.error('Failed to load payroll register:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeCompany, startDate, endDate]);

  // ─── Computed totals (Change 56-58) ─────────────────────
  const totals = useMemo(() => {
    return stubs.reduce((acc, s) => ({
      gross: acc.gross + s.gross_pay,
      federal: acc.federal + s.federal_tax,
      state: acc.state + s.state_tax,
      ss: acc.ss + s.social_security,
      medicare: acc.medicare + s.medicare,
      net: acc.net + s.net_pay,
      hoursReg: acc.hoursReg + s.hours_regular,
      hoursOT: acc.hoursOT + s.hours_overtime,
      deductions: acc.deductions + s.other_deductions,
    }), { gross: 0, federal: 0, state: 0, ss: 0, medicare: 0, net: 0, hoursReg: 0, hoursOT: 0, deductions: 0 });
  }, [stubs]);

  const totalTaxes = totals.federal + totals.state + totals.ss + totals.medicare;
  const uniqueEmployees = useMemo(() => new Set(stubs.map(s => s.employee_id)).size, [stubs]);
  const avgGrossPerEmployee = uniqueEmployees > 0 ? totals.gross / uniqueEmployees : 0;
  // Employer cost: gross + employer-side SS + Medicare match
  const employerCost = totals.gross + totals.ss + totals.medicare;

  // ─── Change 64: Run type groups ─────────────────────────
  const runTypeGroups = useMemo((): RunTypeGroup[] => {
    const map = new Map<string, { count: number; gross: number; taxes: number; net: number }>();
    for (const s of stubs) {
      const rt = s.run_type || 'Regular';
      const existing = map.get(rt) || { count: 0, gross: 0, taxes: 0, net: 0 };
      existing.count += 1;
      existing.gross += s.gross_pay;
      existing.taxes += s.federal_tax + s.state_tax + s.social_security + s.medicare;
      existing.net += s.net_pay;
      map.set(rt, existing);
    }
    return Array.from(map.entries()).map(([run_type, data]) => ({ run_type, ...data })).sort((a, b) => b.gross - a.gross);
  }, [stubs]);

  // ─── Change 65: CSV Export ──────────────────────────────
  const handleExportCSV = () => {
    const rows = stubs.map(s => ({
      pay_date: s.pay_date,
      employee: s.employee_name,
      department: s.department,
      type: s.employee_type,
      run_type: s.run_type,
      hours_regular: s.hours_regular,
      hours_overtime: s.hours_overtime,
      gross_pay: s.gross_pay,
      federal_tax: s.federal_tax,
      state_tax: s.state_tax,
      social_security: s.social_security,
      medicare: s.medicare,
      other_deductions: s.other_deductions,
      net_pay: s.net_pay,
    }));
    downloadCSVBlob(rows, `payroll-register-${startDate}-to-${endDate}.csv`);
  };

  // ─── Change 65: Enhanced Print ──────────────────────────
  const handlePrint = async () => {
    const escHtml = (s: string | null | undefined): string => {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    const kpiHtml = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;">
        <div style="font-size:18px;font-weight:700;">${formatCurrency(totals.gross)}</div>
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;">Total Gross</div>
      </div>
      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;">
        <div style="font-size:18px;font-weight:700;">${formatCurrency(totalTaxes)}</div>
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;">Total Taxes</div>
      </div>
      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;">
        <div style="font-size:18px;font-weight:700;">${formatCurrency(totals.net)}</div>
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;">Total Net</div>
      </div>
    </div>`;

    const deptHtml = deptBreakdown.length > 0 ? `<h3 style="font-size:12px;margin:16px 0 8px;font-weight:700;text-transform:uppercase;">Department Breakdown</h3>
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;">
      <thead><tr style="background:#f8fafc;"><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Department</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Employees</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Gross</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Taxes</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Net</th></tr></thead>
      <tbody>${deptBreakdown.map(d => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escHtml(d.dept)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${d.emp_count}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(d.gross)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(d.taxes)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(d.net)}</td></tr>`).join('')}</tbody>
    </table>` : '';

    const taxHtml = `<h3 style="font-size:12px;margin:16px 0 8px;font-weight:700;text-transform:uppercase;">Tax Breakdown</h3>
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;">
      <thead><tr style="background:#f8fafc;"><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Tax Type</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Employee</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Employer Match</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid #0f172a;font-size:9px;text-transform:uppercase;">Total</th></tr></thead>
      <tbody>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Federal W/H</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.federal)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">--</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.federal)}</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">State W/H</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.state)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">--</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.state)}</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Social Security</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.ss)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.ss)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.ss * 2)}</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">Medicare</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.medicare)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.medicare)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatCurrency(totals.medicare * 2)}</td></tr>
        <tr style="font-weight:700;border-top:2px solid #0f172a;"><td style="padding:6px 10px;">Total</td><td style="padding:6px 10px;text-align:right;">${formatCurrency(totalTaxes)}</td><td style="padding:6px 10px;text-align:right;">${formatCurrency(totals.ss + totals.medicare)}</td><td style="padding:6px 10px;text-align:right;">${formatCurrency(totalTaxes + totals.ss + totals.medicare)}</td></tr>
      </tbody>
    </table>`;

    const rowsHtml = stubs.map(s => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escHtml(s.employee_name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escHtml(s.department)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${s.hours_regular || 0}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${s.hours_overtime || 0}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.gross_pay)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.federal_tax)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.state_tax)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.social_security)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.medicare)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.other_deductions)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;">${formatCurrency(s.net_pay)}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @page { size: letter landscape; margin: 0.4in 0.5in; }
      body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; padding: 30px; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      h1 { font-size: 18px; margin-bottom: 4px; } h2 { font-size: 12px; color: #475569; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th { background: #f8fafc; padding: 6px 10px; text-align: left; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #0f172a; color: #475569; }
      tr:nth-child(even) td { background: #fafafa; }
      @media print { tr { page-break-inside: avoid; } }
    </style></head><body>
      <h1>Payroll Register</h1>
      <h2>Period: ${escHtml(startDate)} to ${escHtml(endDate)} &middot; ${uniqueEmployees} Employees &middot; ${stubs.length} Pay Stubs</h2>
      ${kpiHtml}
      ${deptHtml}
      ${taxHtml}
      <h3 style="font-size:12px;margin:16px 0 8px;font-weight:700;text-transform:uppercase;">Employee Detail</h3>
      <table>
        <thead><tr><th>Employee</th><th>Dept</th><th style="text-align:right">Reg Hrs</th><th style="text-align:right">OT Hrs</th><th style="text-align:right">Gross</th><th style="text-align:right">Federal</th><th style="text-align:right">State</th><th style="text-align:right">SS</th><th style="text-align:right">Medicare</th><th style="text-align:right">Deductions</th><th style="text-align:right">Net</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body></html>`;
    await api.printPreview(html, 'Payroll Register');
  };

  const toggleDept = (dept: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Change 59: Date Range Controls */}
      <div className="block-card p-4 flex items-center justify-between flex-wrap gap-3" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">From</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">To</label>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="block-btn flex items-center gap-2 text-xs" onClick={handlePrint}><Printer size={14} /> Print</button>
          <button className="block-btn flex items-center gap-2 text-xs" onClick={handleExportCSV}><Download size={14} /> Export CSV</button>
        </div>
      </div>

      {/* Change 56-58: KPI Cards */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Gross', value: formatCurrency(totals.gross), color: 'text-text-primary' },
          { label: 'Total Taxes', value: formatCurrency(totalTaxes), color: 'text-accent-expense' },
          { label: 'Total Net', value: formatCurrency(totals.net), color: 'text-accent-income' },
          { label: 'Employer Cost', value: formatCurrency(employerCost), color: 'text-accent-blue' },
          { label: 'Avg Gross/Employee', value: formatCurrency(avgGrossPerEmployee), color: 'text-text-secondary' },
          { label: 'Total Hours', value: `${(totals.hoursReg + totals.hoursOT).toLocaleString()}`, color: 'text-accent-blue' },
        ].map(c => (
          <div key={c.label} className="block-card p-3 text-center" style={{ borderRadius: '6px' }}>
            <p className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-text-muted text-sm">Loading payroll data...</div>
      ) : stubs.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">No payroll data found for this date range.</div>
      ) : (
        <>
          {/* Change 62: Payroll Cost Trend */}
          {monthlyTrend.length > 1 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Payroll Cost Trend</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrend} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: 11 }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value: any) => [formatCurrency(Number(value) || 0), 'Gross Payroll']}
                    />
                    <Bar dataKey="gross" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Change 60: Department Breakdown */}
          {deptBreakdown.length > 0 && (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-3 border-b border-border-primary bg-bg-tertiary/30">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Department Breakdown</h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="text-right">Employees</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Taxes</th>
                    <th className="text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {deptBreakdown.map(d => {
                    const isExpanded = expandedDepts.has(d.dept);
                    const deptStubs = stubs.filter(s => s.department === d.dept);
                    return (
                      <React.Fragment key={d.dept}>
                        <tr className="cursor-pointer hover:bg-bg-hover/30 transition-colors" onClick={() => toggleDept(d.dept)}>
                          <td className="text-text-primary font-medium">
                            <span className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                              {d.dept}
                            </span>
                          </td>
                          <td className="text-right font-mono text-xs">{d.emp_count}</td>
                          <td className="text-right font-mono">{formatCurrency(d.gross)}</td>
                          <td className="text-right font-mono text-xs text-accent-expense">{formatCurrency(d.taxes)}</td>
                          <td className="text-right font-mono font-bold text-accent-income">{formatCurrency(d.net)}</td>
                        </tr>
                        {isExpanded && deptStubs.map(s => (
                          <tr key={s.id} className="bg-bg-tertiary/20">
                            <td className="pl-10 text-xs text-text-secondary">{s.employee_name}</td>
                            <td className="text-right font-mono text-xs text-text-muted">{s.hours_regular + s.hours_overtime}h</td>
                            <td className="text-right font-mono text-xs">{formatCurrency(s.gross_pay)}</td>
                            <td className="text-right font-mono text-xs text-text-muted">{formatCurrency(s.federal_tax + s.state_tax + s.social_security + s.medicare)}</td>
                            <td className="text-right font-mono text-xs text-accent-income">{formatCurrency(s.net_pay)}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Change 63: Tax Breakdown Summary */}
          <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
            <div className="px-4 py-3 border-b border-border-primary bg-bg-tertiary/30">
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Tax Breakdown</h3>
            </div>
            <table className="block-table">
              <thead>
                <tr>
                  <th>Tax Type</th>
                  <th className="text-right">Employee</th>
                  <th className="text-right">Employer Match</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-text-primary font-medium">Federal Withholding</td>
                  <td className="text-right font-mono">{formatCurrency(totals.federal)}</td>
                  <td className="text-right font-mono text-text-muted">--</td>
                  <td className="text-right font-mono font-bold">{formatCurrency(totals.federal)}</td>
                </tr>
                <tr>
                  <td className="text-text-primary font-medium">State Withholding</td>
                  <td className="text-right font-mono">{formatCurrency(totals.state)}</td>
                  <td className="text-right font-mono text-text-muted">--</td>
                  <td className="text-right font-mono font-bold">{formatCurrency(totals.state)}</td>
                </tr>
                <tr>
                  <td className="text-text-primary font-medium">Social Security (6.2%)</td>
                  <td className="text-right font-mono">{formatCurrency(totals.ss)}</td>
                  <td className="text-right font-mono text-accent-blue">{formatCurrency(totals.ss)}</td>
                  <td className="text-right font-mono font-bold">{formatCurrency(totals.ss * 2)}</td>
                </tr>
                <tr>
                  <td className="text-text-primary font-medium">Medicare (1.45%)</td>
                  <td className="text-right font-mono">{formatCurrency(totals.medicare)}</td>
                  <td className="text-right font-mono text-accent-blue">{formatCurrency(totals.medicare)}</td>
                  <td className="text-right font-mono font-bold">{formatCurrency(totals.medicare * 2)}</td>
                </tr>
                <tr className="border-t-2 border-border-primary bg-bg-tertiary/30">
                  <td className="font-bold text-text-primary">Total</td>
                  <td className="text-right font-mono font-bold text-accent-expense">{formatCurrency(totalTaxes)}</td>
                  <td className="text-right font-mono font-bold text-accent-blue">{formatCurrency(totals.ss + totals.medicare)}</td>
                  <td className="text-right font-mono font-bold">{formatCurrency(totalTaxes + totals.ss + totals.medicare)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Change 64: Run Type Breakdown */}
          {runTypeGroups.length > 1 && (
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-3 border-b border-border-primary bg-bg-tertiary/30">
                <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">By Run Type</h3>
              </div>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Run Type</th>
                    <th className="text-right">Stubs</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Taxes</th>
                    <th className="text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {runTypeGroups.map(g => (
                    <tr key={g.run_type}>
                      <td className="text-text-primary font-medium capitalize">{g.run_type}</td>
                      <td className="text-right font-mono text-xs">{g.count}</td>
                      <td className="text-right font-mono">{formatCurrency(g.gross)}</td>
                      <td className="text-right font-mono text-xs text-accent-expense">{formatCurrency(g.taxes)}</td>
                      <td className="text-right font-mono font-bold text-accent-income">{formatCurrency(g.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Change 61: Full Employee Detail Table */}
          <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
            <div className="px-4 py-3 border-b border-border-primary bg-bg-tertiary/30">
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Employee Detail</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th className="text-right">Reg Hrs</th>
                    <th className="text-right">OT Hrs</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Federal</th>
                    <th className="text-right">State</th>
                    <th className="text-right">SS</th>
                    <th className="text-right">Medicare</th>
                    <th className="text-right">Deductions</th>
                    <th className="text-right">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {stubs.map((s) => (
                    <tr key={s.id}>
                      <td className="text-text-primary font-medium truncate max-w-[160px]">{s.employee_name}</td>
                      <td className="text-xs text-text-secondary">{s.department}</td>
                      <td className="text-right font-mono text-xs">{s.hours_regular || '--'}</td>
                      <td className="text-right font-mono text-xs">{s.hours_overtime || '--'}</td>
                      <td className="text-right font-mono">{formatCurrency(s.gross_pay)}</td>
                      <td className="text-right font-mono text-xs">{formatCurrency(s.federal_tax)}</td>
                      <td className="text-right font-mono text-xs">{formatCurrency(s.state_tax)}</td>
                      <td className="text-right font-mono text-xs">{formatCurrency(s.social_security)}</td>
                      <td className="text-right font-mono text-xs">{formatCurrency(s.medicare)}</td>
                      <td className="text-right font-mono text-xs">{formatCurrency(s.other_deductions)}</td>
                      <td className="text-right font-mono font-bold text-accent-income">{formatCurrency(s.net_pay)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border-primary bg-bg-tertiary/30">
                    <td className="font-bold" colSpan={2}>Total ({uniqueEmployees} employees, {stubs.length} stubs)</td>
                    <td className="text-right font-mono font-bold text-xs">{totals.hoursReg || '--'}</td>
                    <td className="text-right font-mono font-bold text-xs">{totals.hoursOT || '--'}</td>
                    <td className="text-right font-mono font-bold">{formatCurrency(totals.gross)}</td>
                    <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.federal)}</td>
                    <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.state)}</td>
                    <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.ss)}</td>
                    <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.medicare)}</td>
                    <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.deductions)}</td>
                    <td className="text-right font-mono font-bold text-accent-income">{formatCurrency(totals.net)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PayrollRegister;
