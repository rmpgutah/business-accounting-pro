import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText,
  DollarSign,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Printer,
  X,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface QuarterSummary {
  quarter: number;
  period_start: string;
  period_end: string;
  due_date: string;
  wages: number;
  federal_wh: number;
  ss_ee: number;
  ss_er: number;
  medicare_ee: number;
  medicare_er: number;
  total_liability: number;
  deposits_made: number;
  balance_due: number;
  status_941: string;
  status_tc941: string;
  state_wages: number;
  state_wh: number;
  state_deposits: number;
  state_balance_due: number;
}

interface W2Row {
  employee_id: string;
  employee_name: string;
  gross_wages: number;
  federal_wh: number;
  ss_wages: number;
  ss_tax: number;
  medicare_wages: number;
  medicare_tax: number;
  state_wages: number;
  state_wh: number;
}

interface W3Row {
  total_employees: number;
  total_wages: number;
  total_federal_wh: number;
  total_ss_wages: number;
  total_ss_tax: number;
  total_medicare_wages: number;
  total_medicare_tax: number;
  total_state_wages: number;
  total_state_wh: number;
}

// ─── Status Badge ───────────────────────────────────────
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    filed: 'bg-accent-income/10 text-accent-income border-accent-income/20',
    not_filed: 'bg-bg-tertiary text-text-muted border-border-primary',
    overdue: 'bg-accent-expense/10 text-accent-expense border-accent-expense/20',
  };
  const labels: Record<string, string> = {
    filed: 'Filed',
    not_filed: 'Not Filed',
    overdue: 'Overdue',
  };
  const icons: Record<string, React.ReactNode> = {
    filed: <CheckCircle size={12} />,
    not_filed: <Clock size={12} />,
    overdue: <AlertTriangle size={12} />,
  };
  const s = status || 'not_filed';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border ${colors[s] ?? colors.not_filed}`}
      style={{ borderRadius: '6px' }}
    >
      {icons[s] ?? icons.not_filed}
      {labels[s] ?? 'Not Filed'}
    </span>
  );
};

// ─── Quarter Label Helpers ──────────────────────────────
const QUARTER_RANGES: Record<number, string> = {
  1: 'Jan 1 - Mar 31',
  2: 'Apr 1 - Jun 30',
  3: 'Jul 1 - Sep 30',
  4: 'Oct 1 - Dec 31',
};

function quarterDueDate(q: number, year: number): string {
  const dates: Record<number, string> = {
    1: `${year}-04-30`,
    2: `${year}-07-31`,
    3: `${year}-10-31`,
    4: `${year + 1}-01-31`,
  };
  return dates[q] || '';
}

// ─── Print HTML Generators ──────────────────────────────
function generate941WorksheetHTML(
  companyName: string,
  year: number,
  quarter: number,
  qs: QuarterSummary
): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; font-size: 12px; line-height: 1.6; padding: 40px; background: #fff; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #475569; margin-bottom: 16px; }
  .disclaimer { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px 16px; margin-bottom: 24px; font-size: 11px; font-weight: 700; color: #92400e; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
  th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; background: #f8fafc; font-weight: 700; }
  .text-right { text-align: right; font-variant-numeric: tabular-nums; }
  .font-mono { font-family: 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums; }
  .total-row td { font-weight: 700; border-top: 2px solid #0f172a; }
</style></head>
<body>
  <div class="disclaimer">WORKSHEET ONLY &mdash; This is NOT an official IRS Form 941. Use this as a reference when completing your actual filing.</div>
  <h1>Form 941 Worksheet &mdash; Q${quarter} ${year}</h1>
  <h2>${companyName}</h2>
  <p style="margin-bottom:16px;font-size:11px;color:#64748b;">Period: ${QUARTER_RANGES[quarter]} &middot; Due: ${quarterDueDate(quarter, year)}</p>
  <table>
    <thead><tr><th>Line</th><th>Description</th><th class="text-right">Amount</th></tr></thead>
    <tbody>
      <tr><td>2</td><td>Wages, tips, other compensation</td><td class="text-right font-mono">${fmt(qs.wages)}</td></tr>
      <tr><td>3</td><td>Federal income tax withheld</td><td class="text-right font-mono">${fmt(qs.federal_wh)}</td></tr>
      <tr><td>5a</td><td>Taxable SS wages &times; 0.124</td><td class="text-right font-mono">${fmt(qs.ss_ee + qs.ss_er)}</td></tr>
      <tr><td>5c</td><td>Taxable Medicare wages &times; 0.029</td><td class="text-right font-mono">${fmt(qs.medicare_ee + qs.medicare_er)}</td></tr>
      <tr><td>5e</td><td>Total SS and Medicare taxes</td><td class="text-right font-mono">${fmt(qs.ss_ee + qs.ss_er + qs.medicare_ee + qs.medicare_er)}</td></tr>
      <tr><td>6</td><td>Total taxes before adjustments</td><td class="text-right font-mono">${fmt(qs.total_liability)}</td></tr>
      <tr><td>11</td><td>Total deposits for quarter</td><td class="text-right font-mono">${fmt(qs.deposits_made)}</td></tr>
      <tr class="total-row"><td>14</td><td>Balance due</td><td class="text-right font-mono">${fmt(qs.balance_due)}</td></tr>
    </tbody>
  </table>
</body></html>`;
}

function generateW2PreviewHTML(
  companyName: string,
  year: number,
  rows: W2Row[]
): string {
  const tableRows = rows
    .map(
      (r) => `<tr>
      <td>${esc(r.employee_name)}</td>
      <td class="text-right font-mono">${fmt(r.gross_wages)}</td>
      <td class="text-right font-mono">${fmt(r.federal_wh)}</td>
      <td class="text-right font-mono">${fmt(r.ss_tax)}</td>
      <td class="text-right font-mono">${fmt(r.medicare_tax)}</td>
      <td class="text-right font-mono">${fmt(r.state_wh)}</td>
    </tr>`
    )
    .join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; font-size: 12px; line-height: 1.6; padding: 40px; background: #fff; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #475569; margin-bottom: 16px; }
  .disclaimer { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px 16px; margin-bottom: 24px; font-size: 11px; font-weight: 700; color: #92400e; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
  th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; background: #f8fafc; font-weight: 700; }
  .text-right { text-align: right; font-variant-numeric: tabular-nums; }
  .font-mono { font-family: 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums; }
</style></head>
<body>
  <div class="disclaimer">WORKSHEET ONLY &mdash; This is NOT an official W-2. Use this as a reference when preparing actual W-2 forms.</div>
  <h1>W-2 Summary &mdash; ${year}</h1>
  <h2>${esc(companyName)}</h2>
  <table>
    <thead><tr><th>Employee</th><th class="text-right">Gross Wages</th><th class="text-right">Fed W/H</th><th class="text-right">SS Tax</th><th class="text-right">Medicare</th><th class="text-right">State W/H</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body></html>`;
}

function generateW3PreviewHTML(
  companyName: string,
  year: number,
  w3: W3Row
): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; font-size: 12px; line-height: 1.6; padding: 40px; background: #fff; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #475569; margin-bottom: 16px; }
  .disclaimer { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px 16px; margin-bottom: 24px; font-size: 11px; font-weight: 700; color: #92400e; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
  th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; background: #f8fafc; font-weight: 700; }
  .text-right { text-align: right; font-variant-numeric: tabular-nums; }
  .font-mono { font-family: 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums; }
</style></head>
<body>
  <div class="disclaimer">WORKSHEET ONLY &mdash; This is NOT an official W-3 Transmittal. Use this as a reference when preparing actual W-3 forms.</div>
  <h1>W-3 Transmittal Summary &mdash; ${year}</h1>
  <h2>${esc(companyName)}</h2>
  <table>
    <thead><tr><th>Field</th><th class="text-right">Amount</th></tr></thead>
    <tbody>
      <tr><td>Number of W-2 Forms</td><td class="text-right font-mono">${w3.total_employees}</td></tr>
      <tr><td>Total Wages</td><td class="text-right font-mono">${fmt(w3.total_wages)}</td></tr>
      <tr><td>Federal Income Tax Withheld</td><td class="text-right font-mono">${fmt(w3.total_federal_wh)}</td></tr>
      <tr><td>Social Security Wages</td><td class="text-right font-mono">${fmt(w3.total_ss_wages)}</td></tr>
      <tr><td>Social Security Tax</td><td class="text-right font-mono">${fmt(w3.total_ss_tax)}</td></tr>
      <tr><td>Medicare Wages</td><td class="text-right font-mono">${fmt(w3.total_medicare_wages)}</td></tr>
      <tr><td>Medicare Tax</td><td class="text-right font-mono">${fmt(w3.total_medicare_tax)}</td></tr>
      <tr><td>State Wages</td><td class="text-right font-mono">${fmt(w3.total_state_wages)}</td></tr>
      <tr><td>State Income Tax Withheld</td><td class="text-right font-mono">${fmt(w3.total_state_wh)}</td></tr>
    </tbody>
  </table>
</body></html>`;
}

// ─── Inline helpers for print HTML ──────────────────────
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const _currFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});
function fmt(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? _currFmt.format(v) : '$0.00';
}

// ─── Component ──────────────────────────────────────────
const TaxFiling: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [summary, setSummary] = useState<QuarterSummary[]>([]);
  const [w2Data, setW2Data] = useState<W2Row[]>([]);
  const [w3Data, setW3Data] = useState<W3Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedQ, setExpandedQ] = useState<number | null>(null);

  // Record Payment form state
  const [paymentForm, setPaymentForm] = useState<{
    open: boolean;
    formType: string;
    quarter: number;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentConfirm, setPaymentConfirm] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [listKey, setListKey] = useState(0);

  const yearRange = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(y);
    return years;
  }, [currentYear]);

  useEffect(() => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    Promise.all([
      api.taxGetFilingSummary(year),
      api.taxGetW2Data(year),
      api.taxGetW3Data(year),
    ])
      .then(([filingSummary, w2, w3]) => {
        setSummary(Array.isArray(filingSummary) ? filingSummary : []);
        setW2Data(Array.isArray(w2) ? w2 : []);
        setW3Data(w3 || null);
      })
      .catch((err) => {
        console.error('Failed to load filing data:', err);
        setError(err?.message || 'Failed to load filing data');
      })
      .finally(() => setLoading(false));
  }, [activeCompany, year, listKey]);

  const handleMarkFiled = async (formType: string, quarter: number) => {
    try {
      await api.taxRecordFiling({
        form_type: formType,
        year,
        quarter,
        filed_date: new Date().toISOString().slice(0, 10),
      });
      setListKey((k) => k + 1);
    } catch (err: any) {
      setError(err?.message || 'Failed to mark as filed');
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentForm || !paymentAmount) return;
    setSaving(true);
    try {
      await api.taxRecordFiling({
        form_type: paymentForm.formType,
        year,
        quarter: paymentForm.quarter,
        amount_paid: parseFloat(paymentAmount),
        payment_date: paymentDate || new Date().toISOString().slice(0, 10),
        confirmation_number: paymentConfirm || undefined,
        notes: paymentNotes || undefined,
      });
      setPaymentForm(null);
      setPaymentAmount('');
      setPaymentDate('');
      setPaymentConfirm('');
      setPaymentNotes('');
      setListKey((k) => k + 1);
    } catch (err: any) {
      setError(err?.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  const openPaymentForm = (formType: string, quarter: number) => {
    setPaymentForm({ open: true, formType, quarter });
    setPaymentAmount('');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentConfirm('');
    setPaymentNotes('');
  };

  const handlePrint941 = (qs: QuarterSummary) => {
    const companyName = activeCompany?.name || 'Company';
    const html = generate941WorksheetHTML(companyName, year, qs.quarter, qs);
    api.printPreview(html, `941 Worksheet Q${qs.quarter} ${year}`);
  };

  const handlePrintW2 = () => {
    const companyName = activeCompany?.name || 'Company';
    const html = generateW2PreviewHTML(companyName, year, w2Data);
    api.printPreview(html, `W-2 Summary ${year}`);
  };

  const handlePrintW3 = () => {
    if (!w3Data) return;
    const companyName = activeCompany?.name || 'Company';
    const html = generateW3PreviewHTML(companyName, year, w3Data);
    api.printPreview(html, `W-3 Transmittal ${year}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading filing data...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <ErrorBanner message={error} title="Filing Error" onDismiss={() => setError('')} />
      )}

      {/* Year Selector */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Tax Year
        </span>
        <div className="relative">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
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

      {/* Per-Quarter Sections */}
      {[1, 2, 3, 4].map((q) => {
        const qs = summary.find((s) => s.quarter === q);
        const isExpanded = expandedQ === q;
        const dueDate = quarterDueDate(q, year);

        return (
          <div key={q} className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
            {/* Quarter Header */}
            <button
              onClick={() => setExpandedQ(isExpanded ? null : q)}
              className="w-full flex items-center justify-between px-5 py-4 border-b border-border-primary hover:bg-bg-secondary transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-text-primary">
                  Q{q} &mdash; {QUARTER_RANGES[q]}
                </span>
                <span className="text-xs text-text-muted">
                  Due: {formatDate(dueDate)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {qs && (
                  <span className="text-sm font-mono text-text-secondary">
                    Total: {formatCurrency(qs.total_liability)}
                  </span>
                )}
                {isExpanded ? (
                  <ChevronUp size={16} className="text-text-muted" />
                ) : (
                  <ChevronDown size={16} className="text-text-muted" />
                )}
              </div>
            </button>

            {/* Expanded Content */}
            {isExpanded && qs && (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Federal 941 Card */}
                  <div
                    className="block-card-elevated p-4 border-l-2 border-l-accent-expense"
                    style={{ borderRadius: '6px' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                        Federal 941
                      </h4>
                      <StatusBadge status={qs.status_941} />
                    </div>
                    <div className="space-y-2 text-xs">
                      <Row label="Wages" value={formatCurrency(qs.wages)} />
                      <Row label="Federal W/H" value={formatCurrency(qs.federal_wh)} />
                      <Row label="SS (Employee)" value={formatCurrency(qs.ss_ee)} />
                      <Row label="SS (Employer)" value={formatCurrency(qs.ss_er)} />
                      <Row label="Medicare (Employee)" value={formatCurrency(qs.medicare_ee)} />
                      <Row label="Medicare (Employer)" value={formatCurrency(qs.medicare_er)} />
                      <div className="border-t border-border-primary pt-2">
                        <Row label="Total Liability" value={formatCurrency(qs.total_liability)} bold />
                      </div>
                      <Row label="Deposits Made" value={formatCurrency(qs.deposits_made)} accent="income" />
                      <Row label="Balance Due" value={formatCurrency(qs.balance_due)} accent={qs.balance_due > 0 ? 'expense' : 'income'} bold />
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => openPaymentForm('941', q)}
                        className="block-btn text-[10px] px-3 py-1.5 flex items-center gap-1"
                        style={{ borderRadius: '6px' }}
                      >
                        <DollarSign size={11} /> Record Payment
                      </button>
                      {qs.status_941 !== 'filed' && (
                        <button
                          onClick={() => handleMarkFiled('941', q)}
                          className="block-btn text-[10px] px-3 py-1.5 flex items-center gap-1"
                          style={{ borderRadius: '6px' }}
                        >
                          <CheckCircle size={11} /> Mark Filed
                        </button>
                      )}
                      <button
                        onClick={() => handlePrint941(qs)}
                        className="block-btn text-[10px] px-3 py-1.5 flex items-center gap-1"
                        style={{ borderRadius: '6px' }}
                      >
                        <Printer size={11} /> Print Worksheet
                      </button>
                    </div>
                  </div>

                  {/* Utah TC-941 Card */}
                  <div
                    className="block-card-elevated p-4 border-l-2 border-l-accent-warning"
                    style={{ borderRadius: '6px' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                        Utah TC-941
                      </h4>
                      <StatusBadge status={qs.status_tc941} />
                    </div>
                    <div className="space-y-2 text-xs">
                      <Row label="UT Wages" value={formatCurrency(qs.state_wages)} />
                      <Row label="UT Withholding" value={formatCurrency(qs.state_wh)} />
                      <Row label="Deposits" value={formatCurrency(qs.state_deposits)} accent="income" />
                      <div className="border-t border-border-primary pt-2">
                        <Row label="Balance Due" value={formatCurrency(qs.state_balance_due)} accent={qs.state_balance_due > 0 ? 'expense' : 'income'} bold />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => openPaymentForm('TC-941', q)}
                        className="block-btn text-[10px] px-3 py-1.5 flex items-center gap-1"
                        style={{ borderRadius: '6px' }}
                      >
                        <DollarSign size={11} /> Record Payment
                      </button>
                      {qs.status_tc941 !== 'filed' && (
                        <button
                          onClick={() => handleMarkFiled('TC-941', q)}
                          className="block-btn text-[10px] px-3 py-1.5 flex items-center gap-1"
                          style={{ borderRadius: '6px' }}
                        >
                          <CheckCircle size={11} /> Mark Filed
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inline Payment Form */}
                {paymentForm && paymentForm.quarter === q && (
                  <div
                    className="block-card-elevated p-4 border-l-2 border-l-accent-blue"
                    style={{ borderRadius: '6px' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                        Record Payment &mdash; {paymentForm.formType} Q{q}
                      </h4>
                      <button
                        onClick={() => setPaymentForm(null)}
                        className="text-text-muted hover:text-text-primary"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                          Amount
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          className="block-input text-sm w-full"
                          style={{ borderRadius: '6px' }}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                          Date
                        </label>
                        <input
                          type="date"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          className="block-input text-sm w-full"
                          style={{ borderRadius: '6px' }}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                          Confirmation #
                        </label>
                        <input
                          type="text"
                          value={paymentConfirm}
                          onChange={(e) => setPaymentConfirm(e.target.value)}
                          className="block-input text-sm w-full"
                          style={{ borderRadius: '6px' }}
                          placeholder="Optional"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                          Notes
                        </label>
                        <input
                          type="text"
                          value={paymentNotes}
                          onChange={(e) => setPaymentNotes(e.target.value)}
                          className="block-input text-sm w-full"
                          style={{ borderRadius: '6px' }}
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={handleRecordPayment}
                        disabled={saving || !paymentAmount}
                        className="block-btn-primary text-[10px] px-4 py-1.5"
                        style={{ borderRadius: '6px' }}
                      >
                        {saving ? 'Saving...' : 'Save Payment'}
                      </button>
                      <button
                        onClick={() => setPaymentForm(null)}
                        className="block-btn text-[10px] px-4 py-1.5"
                        style={{ borderRadius: '6px' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Collapsed - no qs data */}
            {isExpanded && !qs && (
              <div className="p-5 text-sm text-text-muted">
                No payroll data for Q{q} {year}.
              </div>
            )}
          </div>
        );
      })}

      {/* W-2 / W-3 Annual Section */}
      <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
        <div className="px-5 py-4 border-b border-border-primary flex items-center justify-between">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            W-2 / W-3 Annual Summary &mdash; {year}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handlePrintW2}
              disabled={w2Data.length === 0}
              className="block-btn text-[10px] px-3 py-1.5 flex items-center gap-1"
              style={{ borderRadius: '6px' }}
            >
              <Printer size={11} /> Preview W-2
            </button>
            <button
              onClick={handlePrintW3}
              disabled={!w3Data}
              className="block-btn text-[10px] px-3 py-1.5 flex items-center gap-1"
              style={{ borderRadius: '6px' }}
            >
              <Printer size={11} /> Preview W-3
            </button>
          </div>
        </div>

        {w2Data.length > 0 ? (
          <table className="block-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="text-right">Gross Wages</th>
                <th className="text-right">Fed W/H</th>
                <th className="text-right">SS Tax</th>
                <th className="text-right">Medicare</th>
                <th className="text-right">State W/H</th>
              </tr>
            </thead>
            <tbody>
              {w2Data.map((row) => (
                <tr key={row.employee_id}>
                  <td className="text-sm font-medium text-text-primary">
                    {row.employee_name}
                  </td>
                  <td className="text-right font-mono text-sm text-text-secondary">
                    {formatCurrency(row.gross_wages)}
                  </td>
                  <td className="text-right font-mono text-sm text-text-secondary">
                    {formatCurrency(row.federal_wh)}
                  </td>
                  <td className="text-right font-mono text-sm text-text-secondary">
                    {formatCurrency(row.ss_tax)}
                  </td>
                  <td className="text-right font-mono text-sm text-text-secondary">
                    {formatCurrency(row.medicare_tax)}
                  </td>
                  <td className="text-right font-mono text-sm text-text-secondary">
                    {formatCurrency(row.state_wh)}
                  </td>
                </tr>
              ))}
            </tbody>
            {w3Data && (
              <tfoot>
                <tr>
                  <td className="text-sm font-bold text-text-primary">
                    W-3 Totals ({w3Data.total_employees} employees)
                  </td>
                  <td className="text-right font-mono font-bold text-text-primary">
                    {formatCurrency(w3Data.total_wages)}
                  </td>
                  <td className="text-right font-mono font-bold text-text-primary">
                    {formatCurrency(w3Data.total_federal_wh)}
                  </td>
                  <td className="text-right font-mono font-bold text-text-primary">
                    {formatCurrency(w3Data.total_ss_tax)}
                  </td>
                  <td className="text-right font-mono font-bold text-text-primary">
                    {formatCurrency(w3Data.total_medicare_tax)}
                  </td>
                  <td className="text-right font-mono font-bold text-text-primary">
                    {formatCurrency(w3Data.total_state_wh)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        ) : (
          <div className="p-5 text-sm text-text-muted">
            No W-2 data available for {year}.
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Row Helper ─────────────────────────────────────────
const Row: React.FC<{
  label: string;
  value: string;
  bold?: boolean;
  accent?: 'income' | 'expense';
}> = ({ label, value, bold, accent }) => (
  <div className="flex items-center justify-between">
    <span className={`text-text-secondary ${bold ? 'font-semibold' : ''}`}>{label}</span>
    <span
      className={`font-mono ${
        bold ? 'font-semibold' : ''
      } ${
        accent === 'income'
          ? 'text-accent-income'
          : accent === 'expense'
            ? 'text-accent-expense'
            : 'text-text-primary'
      }`}
    >
      {value}
    </span>
  </div>
);

export default TaxFiling;
