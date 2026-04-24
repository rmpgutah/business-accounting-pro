import React, { useEffect, useState } from 'react';
import { ArrowLeft, FileText, Printer, Download, Ban, CreditCard } from 'lucide-react';
import api from '../../lib/api';
import { generatePayStubHTML } from '../../lib/print-templates';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface PayStub {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_name: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  hours: number;
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  net_pay: number;
  pretax_deductions?: number;
  posttax_deductions?: number;
  deduction_detail?: string;
}

interface YtdTotals {
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  net_pay: number;
}

interface PayStubViewProps {
  payStubId: string;
  onBack: () => void;
}


// ─── Component ──────────────────────────────────────────
const PayStubView: React.FC<PayStubViewProps> = ({ payStubId, onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [stub, setStub] = useState<PayStub | null>(null);
  const [ytd, setYtd] = useState<YtdTotals>({
    gross_pay: 0,
    federal_tax: 0,
    state_tax: 0,
    social_security: 0,
    medicare: 0,
    net_pay: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Feature 7: Direct deposit detection (must be before early returns)
  const [employee, setEmployee] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        // JOIN payroll_runs for period/pay_date and employees for employee_name
        // pay_stubs only has: hours_regular, hours_overtime (no `hours`, `period_start`, etc.)
        const rows = await api.rawQuery(
          `SELECT ps.*,
                  (ps.hours_regular + ps.hours_overtime) AS hours,
                  ps.hours_regular, ps.hours_overtime,
                  pr.pay_period_start AS period_start,
                  pr.pay_period_end AS period_end,
                  pr.pay_date,
                  COALESCE(e.name, e.email, 'Unknown') AS employee_name
           FROM pay_stubs ps
           LEFT JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
           LEFT JOIN employees e ON ps.employee_id = e.id
           WHERE ps.id = ?`,
          [payStubId]
        );
        const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        if (cancelled || !data) return;
        setStub(data);

        // Fetch YTD: all pay stubs for this employee in the same year
        // Must JOIN payroll_runs to access pay_date (pay_stubs doesn't have it)
        const year = data.pay_date?.slice(0, 4);
        if (data.employee_id && year) {
          try {
            const yearStubs = await api.rawQuery(
              `SELECT ps.* FROM pay_stubs ps
               JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
               WHERE ps.employee_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?`,
              [data.employee_id, `${year}-01-01`, `${year}-12-31`]
            );
            if (!cancelled && Array.isArray(yearStubs)) {
              const totals: YtdTotals = {
                gross_pay: 0,
                federal_tax: 0,
                state_tax: 0,
                social_security: 0,
                medicare: 0,
                net_pay: 0,
              };
              for (const s of yearStubs) {
                totals.gross_pay += s.gross_pay ?? 0;
                totals.federal_tax += s.federal_tax ?? 0;
                totals.state_tax += s.state_tax ?? 0;
                totals.social_security += s.social_security ?? 0;
                totals.medicare += s.medicare ?? 0;
                totals.net_pay += s.net_pay ?? 0;
              }
              setYtd(totals);
            }
          } catch {
            // YTD is non-critical, proceed with zeros
          }
        }
      } catch (err: any) {
        console.error('Failed to load pay stub:', err);
        if (!cancelled) setError(err?.message || 'Failed to load pay stub');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [payStubId]);

  // Feature 7: Load employee data for direct deposit detection / check printing
  useEffect(() => {
    if (stub?.employee_id) {
      api.get('employees', stub.employee_id).then(e => setEmployee(e)).catch(() => {});
    }
  }, [stub?.employee_id]);

  const buildStubHTML = () => {
    if (!stub) return '';
    // Format ISO dates to human-readable strings before handing off to PDF template
    const stubForPrint = {
      ...stub,
      period_start: formatDate(stub.period_start),
      period_end:   formatDate(stub.period_end),
      pay_date:     formatDate(stub.pay_date),
    };
    return generatePayStubHTML(stubForPrint, ytd, activeCompany);
  };

  const handlePrintStub = async () => {
    const html = buildStubHTML();
    if (!html) return;
    await api.print(html);
  };

  const handleSaveStubPDF = async () => {
    const html = buildStubHTML();
    if (!html) return;
    await api.saveToPDF(html, `PayStub-${stub?.employee_name || 'Employee'}-${stub?.pay_date || ''}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm font-mono">Loading pay stub...</span>
      </div>
    );
  }

  if (!stub) {
    return (
      <div className="p-6">
        <button className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="text-center py-16 text-text-muted text-sm">Pay stub not found.</div>
      </div>
    );
  }

  const totalDeductions = stub.federal_tax + stub.state_tax + stub.social_security + stub.medicare;
  const ytdTotalDeductions = ytd.federal_tax + ytd.state_tax + ytd.social_security + ytd.medicare;
  const isDirectDeposit = !!(employee?.routing_number);

  // Feature 2: Print check handler
  const handlePrintCheck = async (isVoid = false) => {
    const { generatePaycheckHTML } = await import('../../lib/payroll-check-template');
    const emp = employee || await api.get('employees', stub.employee_id);
    const run = await api.get('payroll_runs', stub.payroll_run_id);
    const html = generatePaycheckHTML(stub, emp, activeCompany, run, { isVoid });
    await api.printPreview(html, `${isVoid ? 'VOID ' : ''}Paycheck — ${emp?.name || 'Employee'}`);
  };

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {error && <ErrorBanner message={error} title="Failed to load pay stub" onDismiss={() => setError('')} />}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-text-muted" />
            <h1 className="text-lg font-bold text-text-primary">Pay Stub</h1>
          </div>
          {/* Feature 7: Direct deposit / check indicator */}
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${isDirectDeposit ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted bg-bg-tertiary'}`} style={{ borderRadius: '6px' }}>
            {isDirectDeposit ? 'Direct Deposit' : 'Check'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="block-btn flex items-center gap-2"
            onClick={handlePrintStub}
          >
            <Printer size={14} />
            Print Stub
          </button>
          <button
            className="block-btn flex items-center gap-2"
            onClick={handleSaveStubPDF}
          >
            <Download size={14} />
            Save PDF
          </button>
          {/* Feature 2: Print Check */}
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={() => handlePrintCheck(false)}
          >
            <CreditCard size={14} />
            Print Check
          </button>
          {/* Feature 19: Void Check */}
          <button
            className="block-btn flex items-center gap-2 text-xs text-accent-expense"
            onClick={() => handlePrintCheck(true)}
          >
            <Ban size={14} />
            Void Check
          </button>
        </div>
      </div>

      {/* Pay Stub Document */}
      <div className="block-card p-0 overflow-hidden max-w-2xl mx-auto" style={{ borderRadius: '6px' }}>
        {/* Document Header */}
        <div className="bg-bg-tertiary px-6 py-4 border-b border-border-primary">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Earnings Statement</h2>
              <p className="text-base font-bold text-text-primary mt-1">{stub.employee_name}</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-text-muted uppercase">Pay Date</div>
              <div className="text-sm font-mono text-text-primary">{formatDate(stub.pay_date)}</div>
            </div>
          </div>
        </div>

        {/* Pay Period */}
        <div className="px-6 py-3 border-b border-border-primary bg-bg-secondary">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-text-muted">Period Start:</span>{' '}
              <span className="font-mono text-text-primary">{formatDate(stub.period_start)}</span>
            </div>
            <div>
              <span className="text-text-muted">Period End:</span>{' '}
              <span className="font-mono text-text-primary">{formatDate(stub.period_end)}</span>
            </div>
            <div>
              <span className="text-text-muted">Pay Date:</span>{' '}
              <span className="font-mono text-text-primary">{formatDate(stub.pay_date)}</span>
            </div>
          </div>
        </div>

        {/* Earnings Section */}
        <div className="px-6 py-4 border-b border-border-primary">
          <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-3">Earnings</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-primary">
                <th className="text-left py-1 text-text-muted font-semibold">Description</th>
                <th className="text-right py-1 text-text-muted font-semibold">Hours</th>
                <th className="text-right py-1 text-text-muted font-semibold">Current</th>
                <th className="text-right py-1 text-text-muted font-semibold">YTD</th>
              </tr>
            </thead>
            <tbody>
              {/* Feature 5: Show regular and overtime hours separately */}
              <tr>
                <td className="py-1.5 text-text-primary">
                  {stub.hours > 0 ? 'Regular Hours' : 'Salary'}
                </td>
                <td className="py-1.5 text-right font-mono text-text-secondary">
                  {stub.hours > 0 ? stub.hours.toFixed(2) : '--'}
                </td>
                <td className="py-1.5 text-right font-mono text-text-primary">
                  {stub.hours > 0 && (stub as any).hours_overtime > 0
                    ? formatCurrency(stub.gross_pay - ((stub as any).hours_overtime * ((stub.gross_pay / (stub.hours + (stub as any).hours_overtime * 0.5)) * 1.5)))
                    : formatCurrency(stub.gross_pay)}
                </td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{formatCurrency(ytd.gross_pay)}</td>
              </tr>
              {(stub as any).hours_overtime > 0 && (
                <tr>
                  <td className="py-1.5 text-text-primary">Overtime (1.5x)</td>
                  <td className="py-1.5 text-right font-mono text-text-secondary">
                    {((stub as any).hours_overtime || 0).toFixed(2)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-text-primary">
                    {formatCurrency((stub as any).hours_overtime * ((stub.gross_pay / (stub.hours + (stub as any).hours_overtime * 0.5)) * 1.5))}
                  </td>
                  <td className="py-1.5 text-right font-mono text-text-secondary">--</td>
                </tr>
              )}
              <tr className="border-t border-border-primary font-semibold">
                <td className="py-1.5 text-text-primary">Gross Pay</td>
                <td />
                <td className="py-1.5 text-right font-mono text-text-primary">{formatCurrency(stub.gross_pay)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{formatCurrency(ytd.gross_pay)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Deductions Section */}
        <div className="px-6 py-4 border-b border-border-primary">
          <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-3">Deductions</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-primary">
                <th className="text-left py-1 text-text-muted font-semibold">Description</th>
                <th className="text-right py-1 text-text-muted font-semibold">Current</th>
                <th className="text-right py-1 text-text-muted font-semibold">YTD</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1.5 text-text-primary">Federal Income Tax</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{formatCurrency(stub.federal_tax)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{formatCurrency(ytd.federal_tax)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-text-primary">State Income Tax</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{formatCurrency(stub.state_tax)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{formatCurrency(ytd.state_tax)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-text-primary">Social Security (6.2%)</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{formatCurrency(stub.social_security)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{formatCurrency(ytd.social_security)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-text-primary">Medicare (1.45%)</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{formatCurrency(stub.medicare)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{formatCurrency(ytd.medicare)}</td>
              </tr>
              {/* Pre-tax / Post-tax deduction breakdown */}
              {((stub.pretax_deductions ?? 0) > 0 || (stub.posttax_deductions ?? 0) > 0) && (
                <>
                  {(stub.pretax_deductions ?? 0) > 0 && (
                    <tr>
                      <td className="py-1.5 text-text-primary">Pre-Tax Deductions</td>
                      <td className="py-1.5 text-right font-mono text-accent-expense">{formatCurrency(stub.pretax_deductions!)}</td>
                      <td className="py-1.5 text-right font-mono text-text-secondary">--</td>
                    </tr>
                  )}
                  {(stub.posttax_deductions ?? 0) > 0 && (
                    <tr>
                      <td className="py-1.5 text-text-primary">Post-Tax Deductions</td>
                      <td className="py-1.5 text-right font-mono text-accent-expense">{formatCurrency(stub.posttax_deductions!)}</td>
                      <td className="py-1.5 text-right font-mono text-text-secondary">--</td>
                    </tr>
                  )}
                </>
              )}
              <tr className="border-t border-border-primary font-semibold">
                <td className="py-1.5 text-text-primary">Total Deductions</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{formatCurrency(totalDeductions + (stub.pretax_deductions ?? 0) + (stub.posttax_deductions ?? 0))}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{formatCurrency(ytdTotalDeductions)}</td>
              </tr>
            </tbody>
          </table>

          {/* Itemized deduction detail */}
          {stub.deduction_detail && stub.deduction_detail !== '{}' && (() => {
            try {
              const detail = JSON.parse(stub.deduction_detail);
              const entries = Object.entries(detail);
              if (entries.length === 0) return null;
              return (
                <div className="mt-3 pt-3 border-t border-border-primary">
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Deduction Detail</div>
                  <div className="space-y-1">
                    {entries.map(([name, amount]) => (
                      <div key={name} className="flex justify-between text-xs">
                        <span className="text-text-muted">{name}</span>
                        <span className="font-mono text-text-primary">{formatCurrency(Number(amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            } catch {
              return null;
            }
          })()}
        </div>

        {/* Net Pay */}
        <div className="px-6 py-5 bg-bg-tertiary">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider">Net Pay</div>
              <div className="text-xl font-bold font-mono text-accent-income mt-1">
                {formatCurrency(stub.net_pay)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-text-muted uppercase tracking-wider">YTD Net Pay</div>
              <div className="text-sm font-mono text-text-secondary mt-1">
                {formatCurrency(ytd.net_pay)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayStubView;
