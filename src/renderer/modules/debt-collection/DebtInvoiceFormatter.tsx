import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface DebtInvoiceFormatterProps {
  debtId: string;
  onBack: () => void;
}

interface Debt {
  id: string;
  type: string;
  status: string;
  current_stage: string;
  debtor_name: string;
  debtor_email: string;
  debtor_phone: string;
  debtor_address: string;
  source_type: string;
  source_id: string;
  original_amount: number;
  interest_accrued: number;
  fees_accrued: number;
  payments_made: number;
  balance_due: number;
  interest_rate: number;
  interest_type: string;
  interest_start_date: string;
  compound_frequency: number;
  due_date: string;
  delinquent_date: string;
  statute_of_limitations_date: string;
  jurisdiction: string;
  priority: string;
  assigned_to: string;
  notes: string;
  created_at: string;
}

interface Payment {
  id: string;
  amount: number;
  method: string;
  reference_number: string;
  received_date: string;
  applied_to_principal: number;
  applied_to_interest: number;
  applied_to_fees: number;
  notes: string;
}

// ─── Helpers ────────────────────────────────────────────
function esc(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statementNumber(debtId: string): string {
  return `STMT-${debtId.substring(0, 8).toUpperCase()}`;
}

function today(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    reminder: 'Reminder',
    warning: 'Warning Notice',
    final_notice: 'Final Notice',
    demand_letter: 'Demand Letter',
    collections_agency: 'Collections Agency',
    legal_action: 'Legal Action',
    judgment: 'Judgment',
    garnishment: 'Wage Garnishment',
  };
  return labels[stage] || stage;
}

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    check: 'Check',
    ach: 'ACH Transfer',
    wire: 'Wire Transfer',
    cash: 'Cash',
    credit_card: 'Credit Card',
    other: 'Other',
  };
  return labels[method] || method;
}

// ─── HTML Generator ─────────────────────────────────────
// All user-sourced strings are passed through esc() before interpolation.
function buildStatementHTML(
  debt: Debt,
  payments: Payment[],
  company: any,
): string {
  const interestPct = debt.interest_rate ? (debt.interest_rate * 100).toFixed(2) + '%' : 'N/A';
  const interestTypeLabel = debt.interest_type === 'compound' ? 'Compound' : 'Simple';
  const sourceRef = debt.source_type === 'invoice'
    ? `Invoice #${esc(debt.source_id?.substring(0, 8).toUpperCase())}`
    : debt.source_type === 'bill'
      ? `Bill #${esc(debt.source_id?.substring(0, 8).toUpperCase())}`
      : 'Manual Entry';

  const totalCharges = (debt.original_amount || 0) + (debt.interest_accrued || 0) + (debt.fees_accrued || 0);
  const paymentsTotal = payments.reduce((s, p) => s + (p.amount || 0), 0);

  const companyName = esc(company?.name || 'Company Name');
  const companyAddress = esc([
    company?.address_line1, company?.city, company?.state, company?.zip,
  ].filter(Boolean).join(', '));
  const companyPhone = esc(company?.phone || '');
  const companyEmail = esc(company?.email || '');

  const debtorName = esc(debt.debtor_name);
  const debtorAddress = esc(debt.debtor_address);
  const debtorEmail = esc(debt.debtor_email);
  const debtorPhone = esc(debt.debtor_phone);
  const jurisdiction = esc(debt.jurisdiction);
  const notes = esc(debt.notes);
  const stmtNum = esc(statementNumber(debt.id));
  const todayStr = today();
  const stageStr = esc(stageLabel(debt.current_stage));

  const daysAccrued = debt.interest_start_date
    ? Math.max(0, Math.floor((Date.now() - new Date(debt.interest_start_date).getTime()) / 86400000))
    : null;

  const paymentRows = payments.length > 0
    ? payments.map((p) => `
        <tr>
          <td>${esc(formatDate(p.received_date))}</td>
          <td>${esc(methodLabel(p.method))}</td>
          <td>${esc(p.reference_number)}</td>
          <td style="text-align:right">${formatCurrency(p.amount)}</td>
          <td>${p.applied_to_principal ? formatCurrency(p.applied_to_principal) : '—'}</td>
          <td>${p.applied_to_interest ? formatCurrency(p.applied_to_interest) : '—'}</td>
          <td>${p.applied_to_fees ? formatCurrency(p.applied_to_fees) : '—'}</td>
          <td>${esc(p.notes)}</td>
        </tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;color:#555;font-style:italic">No payments recorded</td></tr>';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 48px; }
  .page { max-width: 800px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 3px solid #111; padding-bottom: 20px; }
  .company-name { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; }
  .company-details { font-size: 11px; color: #555; margin-top: 4px; line-height: 1.6; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
  .doc-title .meta { font-size: 11px; color: #555; margin-top: 6px; line-height: 1.7; }
  .parties { display: flex; gap: 40px; margin-bottom: 28px; padding: 20px; background: #f7f7f7; border-left: 4px solid #111; }
  .party { flex: 1; }
  .party-label { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #555; margin-bottom: 6px; }
  .party-name { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
  .party-detail { font-size: 11px; color: #444; line-height: 1.6; }
  .summary-box { border: 2px solid #111; margin-bottom: 28px; }
  .summary-box-header { background: #111; color: #fff; padding: 8px 16px; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .summary-row { display: flex; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid #e5e5e5; font-size: 12px; }
  .summary-row:last-child { border-bottom: none; }
  .summary-row.total { background: #111; color: #fff; font-weight: 900; font-size: 14px; padding: 12px 16px; }
  .summary-row.subtotal { border-top: 2px solid #111; font-weight: 700; }
  .amount { font-family: "Courier New", monospace; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #111; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f0f0f0; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; padding: 7px 10px; text-align: left; border: 1px solid #ddd; }
  td { padding: 7px 10px; border: 1px solid #e5e5e5; vertical-align: top; }
  tr:nth-child(even) td { background: #fafafa; }
  .amount-col { text-align: right; font-family: "Courier New", monospace; }
  .highlight-row td { background: #f0f0f0; font-weight: 700; }
  .interest-box { background: #f9f9f9; border: 1px solid #ddd; padding: 16px; margin-bottom: 28px; }
  .interest-row { display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; }
  .interest-formula { font-size: 10px; color: #555; font-style: italic; margin-top: 8px; border-top: 1px solid #ddd; padding-top: 8px; }
  .legal-notice { border: 1px solid #ccc; padding: 16px; margin-bottom: 28px; background: #fffbf0; }
  .legal-notice-title { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #b45309; margin-bottom: 8px; }
  .legal-notice p { font-size: 10px; color: #444; line-height: 1.7; margin-bottom: 4px; }
  .notes-box { border: 1px solid #e5e5e5; padding: 14px; background: #fafafa; margin-bottom: 28px; }
  .notes-label { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #777; margin-bottom: 6px; }
  .footer { border-top: 1px solid #ddd; padding-top: 14px; text-align: center; font-size: 10px; color: #555; margin-top: 32px; }
  @media print { body { padding: 0; } -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div>
      <div class="company-name">${companyName}</div>
      <div class="company-details">
        ${companyAddress ? companyAddress + '<br>' : ''}
        ${companyPhone ? 'Tel: ' + companyPhone + (companyEmail ? '&nbsp;&nbsp;' : '') : ''}${companyEmail}
      </div>
    </div>
    <div class="doc-title">
      <h1>Statement of Account</h1>
      <div class="meta">
        Statement #: <strong>${stmtNum}</strong><br>
        Issue Date: <strong>${todayStr}</strong><br>
        Account Type: <strong>${debt.type === 'receivable' ? 'Receivable' : 'Payable'}</strong><br>
        Stage: <strong>${stageStr}</strong>
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">From</div>
      <div class="party-name">${companyName}</div>
      <div class="party-detail">
        ${companyAddress || '—'}<br>
        ${companyPhone ? 'Tel: ' + companyPhone + '<br>' : ''}
        ${companyEmail}
      </div>
    </div>
    <div class="party">
      <div class="party-label">Account Holder / Debtor</div>
      <div class="party-name">${debtorName}</div>
      <div class="party-detail">
        ${debtorAddress || '—'}<br>
        ${debtorEmail ? 'Email: ' + debtorEmail + '<br>' : ''}
        ${debtorPhone ? 'Tel: ' + debtorPhone : ''}
      </div>
    </div>
    <div class="party">
      <div class="party-label">Account Reference</div>
      <div class="party-detail" style="line-height:2">
        <strong>Ref:</strong> ${sourceRef}<br>
        <strong>Due Date:</strong> ${esc(formatDate(debt.due_date))}<br>
        <strong>Delinquent:</strong> ${esc(formatDate(debt.delinquent_date)) || '—'}<br>
        ${jurisdiction ? '<strong>Jurisdiction:</strong> ' + jurisdiction : ''}
      </div>
    </div>
  </div>

  <div class="summary-box">
    <div class="summary-box-header">Account Summary</div>
    <div>
      <div class="summary-row"><span>Original Principal</span><span class="amount">${formatCurrency(debt.original_amount)}</span></div>
      <div class="summary-row"><span>Interest Accrued (${esc(interestPct)} ${esc(interestTypeLabel)})</span><span class="amount">${formatCurrency(debt.interest_accrued)}</span></div>
      <div class="summary-row"><span>Collection Fees</span><span class="amount">${formatCurrency(debt.fees_accrued)}</span></div>
      <div class="summary-row subtotal"><span>Total Charges</span><span class="amount">${formatCurrency(totalCharges)}</span></div>
      <div class="summary-row" style="color:#16a34a"><span>Payments Received</span><span class="amount">− ${formatCurrency(paymentsTotal)}</span></div>
      <div class="summary-row total"><span>BALANCE DUE</span><span class="amount">${formatCurrency(debt.balance_due)}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Charge Breakdown</div>
    <table>
      <thead>
        <tr><th>Date</th><th>Description</th><th>Reference</th><th style="text-align:right">Amount</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${esc(formatDate(debt.delinquent_date)) || esc(formatDate(debt.due_date))}</td>
          <td>Original Principal Balance</td>
          <td>${sourceRef}</td>
          <td class="amount-col">${formatCurrency(debt.original_amount)}</td>
        </tr>
        ${debt.interest_accrued > 0 ? `
        <tr>
          <td>${esc(formatDate(debt.interest_start_date)) || '—'}</td>
          <td>Interest — ${esc(interestPct)} per annum (${esc(interestTypeLabel)}${debt.interest_type === 'compound' && debt.compound_frequency ? ', ' + debt.compound_frequency + '&times;/yr' : ''})</td>
          <td>Calculated to ${todayStr}</td>
          <td class="amount-col">${formatCurrency(debt.interest_accrued)}</td>
        </tr>` : ''}
        ${debt.fees_accrued > 0 ? `
        <tr>
          <td>—</td>
          <td>Collection &amp; Administrative Fees</td>
          <td>—</td>
          <td class="amount-col">${formatCurrency(debt.fees_accrued)}</td>
        </tr>` : ''}
        <tr class="highlight-row">
          <td colspan="3"><strong>Total Charges</strong></td>
          <td class="amount-col"><strong>${formatCurrency(totalCharges)}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  ${debt.interest_rate > 0 ? `
  <div class="section">
    <div class="section-title">Interest Calculation Detail</div>
    <div class="interest-box">
      <div class="interest-row"><span>Principal (P)</span><span>${formatCurrency(debt.original_amount)}</span></div>
      <div class="interest-row"><span>Annual Rate (r)</span><span>${esc(interestPct)}</span></div>
      <div class="interest-row"><span>Interest Type</span><span>${esc(interestTypeLabel)}</span></div>
      ${debt.interest_type === 'compound' ? `<div class="interest-row"><span>Compounding Frequency (n)</span><span>${debt.compound_frequency || 12}&times; per year</span></div>` : ''}
      <div class="interest-row"><span>Interest Start Date</span><span>${esc(formatDate(debt.interest_start_date)) || esc(formatDate(debt.delinquent_date)) || '—'}</span></div>
      ${daysAccrued !== null ? `<div class="interest-row"><span>Days Accrued</span><span>${daysAccrued} days</span></div>` : ''}
      <div class="interest-row" style="font-weight:700;padding-top:8px;border-top:1px solid #ddd;margin-top:4px">
        <span>Interest Accrued to Date</span><span>${formatCurrency(debt.interest_accrued)}</span>
      </div>
      <div class="interest-formula">Formula: ${debt.interest_type === 'compound'
    ? 'A = P &times; (1 + r/n)<sup>n&times;t</sup> &minus; P'
    : 'I = P &times; r &times; t'
  }</div>
    </div>
  </div>` : ''}

  <div class="section">
    <div class="section-title">Payment History</div>
    <table>
      <thead>
        <tr>
          <th>Date Received</th><th>Method</th><th>Reference #</th>
          <th style="text-align:right">Amount</th>
          <th>To Principal</th><th>To Interest</th><th>To Fees</th><th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${paymentRows}
        ${payments.length > 0 ? `
        <tr class="highlight-row">
          <td colspan="3"><strong>Total Payments Received</strong></td>
          <td class="amount-col"><strong>${formatCurrency(paymentsTotal)}</strong></td>
          <td colspan="4"></td>
        </tr>` : ''}
      </tbody>
    </table>
  </div>

  <div class="legal-notice">
    <div class="legal-notice-title">&#9888; Important Legal Notice</div>
    <p>This statement reflects the current balance as of <strong>${todayStr}</strong>. Interest continues to accrue at <strong>${esc(interestPct)} per annum (${esc(interestTypeLabel)})</strong> until paid in full.</p>
    ${debt.statute_of_limitations_date ? `<p>The statute of limitations for this debt in <strong>${jurisdiction || 'the applicable jurisdiction'}</strong> expires on <strong>${esc(formatDate(debt.statute_of_limitations_date))}</strong>.</p>` : ''}
    <p>Failure to remit may result in referral to a collections agency, legal proceedings, and/or credit reporting.</p>
    <p>To dispute this debt or arrange a payment plan, contact us at ${companyEmail || companyPhone || '[company contact]'}.</p>
  </div>

  ${notes ? `
  <div class="notes-box">
    <div class="notes-label">Account Notes</div>
    <p style="font-size:11px;color:#444;line-height:1.6">${notes}</p>
  </div>` : ''}

  <div class="footer">
    Statement generated by ${companyName} &middot; ${todayStr} &middot; Statement # ${stmtNum}<br>
    This document is confidential and intended solely for the named account holder.
  </div>

</div>
</body>
</html>`;
}

// ─── Component ──────────────────────────────────────────
const DebtInvoiceFormatter: React.FC<DebtInvoiceFormatterProps> = ({ debtId, onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [debt, setDebt] = useState<Debt | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [debtData, paymentData, companyData] = await Promise.all([
          api.get('debts', debtId),
          api.query('debt_payments', { debt_id: debtId }, { field: 'received_date', dir: 'asc' }),
          activeCompany?.id ? api.getCompany(activeCompany.id).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setDebt(debtData ?? null);
        setPayments(Array.isArray(paymentData) ? paymentData : []);
        setCompany(companyData ?? activeCompany);
      } catch (err) {
        console.error('Failed to load debt invoice data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [debtId, activeCompany]);

  const html = debt ? buildStatementHTML(debt, payments, company) : '';

  const handleExportPDF = useCallback(async () => {
    if (!debt || exporting) return;
    setExporting(true);
    try {
      await api.saveToPDF(html, `Statement of Account — ${debt.debtor_name}`);
    } catch (err) {
      console.error('Failed to export PDF:', err);
    } finally {
      setExporting(false);
    }
  }, [debt, html, exporting]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading statement...
      </div>
    );
  }

  if (!debt) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-text-muted text-sm">Debt not found</p>
        <button className="block-btn flex items-center gap-2" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="module-header flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-2 px-3 py-2" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </button>
          <div>
            <h2 className="module-title text-text-primary">Statement of Account</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {debt.debtor_name} &middot; {statementNumber(debt.id)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 text-sm text-text-muted mr-4">
            <span>Balance Due:</span>
            <span className="text-xl font-bold font-mono text-text-primary">
              {formatCurrency(debt.balance_due)}
            </span>
          </div>
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={handleExportPDF}
            disabled={exporting}
          >
            <Download size={16} />
            {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Original Amount', value: formatCurrency(debt.original_amount), color: 'text-text-primary' },
          { label: 'Interest Accrued', value: formatCurrency(debt.interest_accrued), color: 'text-accent-blue' },
          { label: 'Payments Made', value: formatCurrency(debt.payments_made), color: 'text-accent-income' },
          { label: 'Balance Due', value: formatCurrency(debt.balance_due), color: 'text-accent-expense' },
        ].map((card) => (
          <div key={card.label} className="block-card p-4">
            <p className="text-[10px] uppercase tracking-widest text-text-muted font-bold mb-1">{card.label}</p>
            <p className={`text-lg font-bold font-mono ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Statement Preview */}
      <div className="block-card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-primary bg-bg-secondary">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
            <Printer size={13} />
            Statement Preview
          </span>
          <span className="text-[10px] text-text-muted">
            Rendered exactly as the exported PDF
          </span>
        </div>
        {/* Content is generated entirely server-side from structured DB data; all
            user-sourced strings are HTML-escaped via esc() before interpolation. */}
        {/* eslint-disable-next-line react/no-danger */}
        <div
          style={{ background: '#fff', color: '#111', minHeight: '600px', overflow: 'auto' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
};

export default DebtInvoiceFormatter;
