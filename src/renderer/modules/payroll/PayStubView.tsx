import React, { useEffect, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import api from '../../lib/api';

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

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Component ──────────────────────────────────────────
const PayStubView: React.FC<PayStubViewProps> = ({ payStubId, onBack }) => {
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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const data = await api.get('pay_stubs', payStubId);
        if (cancelled || !data) return;
        setStub(data);

        // Fetch YTD: all pay stubs for this employee in the same year
        const year = data.pay_date?.slice(0, 4);
        if (data.employee_id && year) {
          try {
            const allStubs = await api.query('pay_stubs', {
              employee_id: data.employee_id,
            });
            if (!cancelled && Array.isArray(allStubs)) {
              const yearStubs = allStubs.filter(
                (s: PayStub) => s.pay_date?.startsWith(year)
              );
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
      } catch (err) {
        console.error('Failed to load pay stub:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [payStubId]);

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
        <button className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="text-center py-16 text-text-muted text-sm">Pay stub not found.</div>
      </div>
    );
  }

  const totalDeductions = stub.federal_tax + stub.state_tax + stub.social_security + stub.medicare;
  const ytdTotalDeductions = ytd.federal_tax + ytd.state_tax + ytd.social_security + ytd.medicare;

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-text-muted" />
          <h1 className="text-lg font-bold text-text-primary">Pay Stub</h1>
        </div>
      </div>

      {/* Pay Stub Document */}
      <div className="block-card p-0 overflow-hidden max-w-2xl mx-auto" style={{ borderRadius: '2px' }}>
        {/* Document Header */}
        <div className="bg-bg-tertiary px-6 py-4 border-b border-border-primary">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Earnings Statement</h2>
              <p className="text-base font-bold text-text-primary mt-1">{stub.employee_name}</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-text-muted uppercase">Pay Date</div>
              <div className="text-sm font-mono text-text-primary">{stub.pay_date}</div>
            </div>
          </div>
        </div>

        {/* Pay Period */}
        <div className="px-6 py-3 border-b border-border-primary bg-bg-secondary">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-text-muted">Period Start:</span>{' '}
              <span className="font-mono text-text-primary">{stub.period_start}</span>
            </div>
            <div>
              <span className="text-text-muted">Period End:</span>{' '}
              <span className="font-mono text-text-primary">{stub.period_end}</span>
            </div>
            <div>
              <span className="text-text-muted">Pay Date:</span>{' '}
              <span className="font-mono text-text-primary">{stub.pay_date}</span>
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
              <tr>
                <td className="py-1.5 text-text-primary">
                  {stub.hours > 0 ? 'Regular Hours' : 'Salary'}
                </td>
                <td className="py-1.5 text-right font-mono text-text-secondary">
                  {stub.hours > 0 ? stub.hours.toFixed(2) : '--'}
                </td>
                <td className="py-1.5 text-right font-mono text-text-primary">{fmt.format(stub.gross_pay)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(ytd.gross_pay)}</td>
              </tr>
              <tr className="border-t border-border-primary font-semibold">
                <td className="py-1.5 text-text-primary">Gross Pay</td>
                <td />
                <td className="py-1.5 text-right font-mono text-text-primary">{fmt.format(stub.gross_pay)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(ytd.gross_pay)}</td>
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
                <td className="py-1.5 text-right font-mono text-accent-expense">{fmt.format(stub.federal_tax)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(ytd.federal_tax)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-text-primary">State Income Tax</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{fmt.format(stub.state_tax)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(ytd.state_tax)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-text-primary">Social Security (6.2%)</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{fmt.format(stub.social_security)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(ytd.social_security)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-text-primary">Medicare (1.45%)</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{fmt.format(stub.medicare)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(ytd.medicare)}</td>
              </tr>
              <tr className="border-t border-border-primary font-semibold">
                <td className="py-1.5 text-text-primary">Total Deductions</td>
                <td className="py-1.5 text-right font-mono text-accent-expense">{fmt.format(totalDeductions)}</td>
                <td className="py-1.5 text-right font-mono text-text-secondary">{fmt.format(ytdTotalDeductions)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Net Pay */}
        <div className="px-6 py-5 bg-bg-tertiary">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider">Net Pay</div>
              <div className="text-xl font-bold font-mono text-accent-income mt-1">
                {fmt.format(stub.net_pay)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-text-muted uppercase tracking-wider">YTD Net Pay</div>
              <div className="text-sm font-mono text-text-secondary mt-1">
                {fmt.format(ytd.net_pay)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayStubView;
