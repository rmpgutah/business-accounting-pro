import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import {
  classicStyles, docFrame, docHeader, metaStrip, boxRow, ruledTable, totalsBox, footerBar,
  esc as cesc,
} from '../../lib/classic-styles';

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
// esc is imported from classic-styles as cesc
function esc(str: string | null | undefined): string {
  return cesc(str);
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
// All user-sourced strings are passed through esc()/cesc() before interpolation.
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
  const companyAddrParts = [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean);
  const companyAddrHtml = companyAddrParts.map((p: string) => cesc(p)).join(', ');
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

  // ── Header ──
  const coContactLine = [
    companyAddrHtml,
    [companyEmail, companyPhone ? 'Tel: ' + companyPhone : ''].filter(Boolean).join(' &middot; '),
  ].filter(Boolean).join('<br>');
  const header = docHeader({
    coName: company?.name || 'Company Name',
    coDetailHtml: coContactLine,
    title: 'Statement',
    numberHtml: `No. ${stmtNum}<br><span style="font-size:11px;font-weight:normal;">${todayStr}</span>`,
  });

  // ── Meta strip: statement # / date / type / stage ──
  const meta = metaStrip([
    { label: 'Statement #',   value: statementNumber(debt.id) },
    { label: 'Issue Date',    value: todayStr },
    { label: 'Account Type',  value: debt.type === 'receivable' ? 'Receivable' : 'Payable' },
    { label: 'Stage',         value: stageLabel(debt.current_stage) },
  ]);

  // ── Party boxes: Creditor / Debtor / Account Reference ──
  const creditorHtml = `<b>${companyName}</b>${companyAddrHtml ? '<br>' + companyAddrHtml : ''}` +
    (companyPhone ? '<br>Tel: ' + companyPhone : '') +
    (companyEmail ? '<br>' + companyEmail : '');
  const debtorHtml = `<b>${debtorName}</b>` +
    (debtorAddress ? '<br>' + debtorAddress : '') +
    (debtorEmail ? '<br>Email: ' + debtorEmail : '') +
    (debtorPhone ? '<br>Tel: ' + debtorPhone : '');
  const refHtml = `<b>Ref:</b> ${sourceRef}<br>` +
    `<b>Due:</b> ${esc(formatDate(debt.due_date)) || '—'}<br>` +
    `<b>Delinquent:</b> ${esc(formatDate(debt.delinquent_date)) || '—'}` +
    (jurisdiction ? `<br><b>Jurisdiction:</b> ${jurisdiction}` : '');
  const parties = boxRow([
    { label: 'From (Creditor)',          html: creditorHtml },
    { label: 'Account Holder / Debtor',  html: debtorHtml },
    { label: 'Account Reference',        html: refHtml },
  ]);

  // ── Account summary (totals box) ──
  const summaryBox = `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:8px;">Account Summary</div>` +
    `<div style="display:flex;justify-content:flex-end;">` +
    totalsBox([
      { label: 'Original Principal',                                       value: formatCurrency(debt.original_amount) },
      { label: `Interest Accrued (${interestPct} ${interestTypeLabel})`,   value: formatCurrency(debt.interest_accrued) },
      { label: 'Collection Fees',                                          value: formatCurrency(debt.fees_accrued) },
      { label: 'Total Charges',                                            value: formatCurrency(totalCharges) },
      { label: 'Payments Received',                                        value: `− ${formatCurrency(paymentsTotal)}` },
      { label: 'BALANCE DUE',                                              value: formatCurrency(debt.balance_due), grand: true },
    ]) +
    `</div></div>`;

  // ── Charge breakdown table ──
  const chargeRows: string[][] = [];
  chargeRows.push([
    esc(formatDate(debt.delinquent_date) || formatDate(debt.due_date)),
    'Original Principal Balance',
    sourceRef,
    formatCurrency(debt.original_amount),
  ]);
  if (debt.interest_accrued > 0) {
    chargeRows.push([
      esc(formatDate(debt.interest_start_date)) || '—',
      `Interest — ${esc(interestPct)} per annum (${esc(interestTypeLabel)}${debt.interest_type === 'compound' && debt.compound_frequency ? ', ' + debt.compound_frequency + '×/yr' : ''})`,
      `Calculated to ${todayStr}`,
      formatCurrency(debt.interest_accrued),
    ]);
  }
  if (debt.fees_accrued > 0) {
    chargeRows.push(['—', 'Collection &amp; Administrative Fees', '—', formatCurrency(debt.fees_accrued)]);
  }
  chargeRows.push([`<b colspan="1">Total Charges</b>`, '', '', `<b>${formatCurrency(totalCharges)}</b>`]);

  const chargeTable = `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:8px;">Charge Breakdown</div>` +
    ruledTable(
      [
        { label: 'Date' },
        { label: 'Description' },
        { label: 'Reference' },
        { label: 'Amount', align: 'right', width: '100px' },
      ],
      chargeRows,
    ) + `</div>`;

  // ── Interest Calculation Detail (only when interest > 0) ──
  const interestDetailHTML = debt.interest_rate > 0 ? (
    `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:8px;">Interest Calculation Detail</div>` +
    ruledTable(
      [{ label: 'Parameter' }, { label: 'Value', align: 'right', width: '200px' }],
      [
        ['Principal (P)',       formatCurrency(debt.original_amount)],
        ['Annual Rate (r)',     esc(interestPct)],
        ['Interest Type',      esc(interestTypeLabel)],
        ...(debt.interest_type === 'compound'
          ? [['Compounding Frequency (n)', `${debt.compound_frequency || 12}× per year`]] as string[][]
          : []),
        ['Interest Start Date', esc(formatDate(debt.interest_start_date) || formatDate(debt.delinquent_date)) || '—'],
        ...(daysAccrued !== null ? [['Days Accrued', `${daysAccrued} days`]] as string[][] : []),
        ['Interest Accrued to Date', formatCurrency(debt.interest_accrued)],
        ['Formula', debt.interest_type === 'compound'
          ? 'A = P &times; (1 + r/n)<sup>n&times;t</sup> &minus; P'
          : 'I = P &times; r &times; t'],
      ],
    ) + `</div>`
  ) : '';

  // ── Payment history table ──
  const paymentRows: string[][] = payments.length > 0
    ? [
        ...payments.map((p) => [
          esc(formatDate(p.received_date)),
          esc(methodLabel(p.method)),
          esc(p.reference_number),
          formatCurrency(p.amount),
          p.applied_to_principal ? formatCurrency(p.applied_to_principal) : '—',
          p.applied_to_interest  ? formatCurrency(p.applied_to_interest)  : '—',
          p.applied_to_fees      ? formatCurrency(p.applied_to_fees)      : '—',
          esc(p.notes),
        ]),
        [`<b>Total Payments</b>`, '', '', `<b>${formatCurrency(paymentsTotal)}</b>`, '', '', '', ''],
      ]
    : [['<i>No payments recorded</i>', '', '', '', '', '', '', '']];

  const paymentTable = `<div style="padding:10px 16px;border-bottom:2px solid #000;">` +
    `<div class="sec-label" style="margin-bottom:8px;">Payment History</div>` +
    ruledTable(
      [
        { label: 'Date Received' },
        { label: 'Method' },
        { label: 'Reference #' },
        { label: 'Amount',       align: 'right', width: '90px' },
        { label: 'To Principal', align: 'right', width: '90px' },
        { label: 'To Interest',  align: 'right', width: '90px' },
        { label: 'To Fees',      align: 'right', width: '80px' },
        { label: 'Notes' },
      ],
      paymentRows,
    ) + `</div>`;

  // ── Legal Notice ──
  const solLine = debt.statute_of_limitations_date
    ? `The statute of limitations in <b>${jurisdiction || 'the applicable jurisdiction'}</b> expires on <b>${esc(formatDate(debt.statute_of_limitations_date))}</b>. `
    : '';
  const legalBox = boxRow([{
    label: 'Important Legal Notice',
    html: `<p style="font-size:11px;line-height:1.6;">` +
      `This statement reflects the current balance as of <b>${todayStr}</b>. ` +
      `Interest continues to accrue at <b>${esc(interestPct)} per annum (${esc(interestTypeLabel)})</b> until paid in full. ` +
      solLine +
      `Failure to remit may result in referral to a collections agency, legal proceedings, and/or credit reporting. ` +
      `To dispute this debt or arrange a payment plan, contact us at ${companyEmail || companyPhone || '[company contact]'}.` +
      `</p>`,
  }]);

  // ── Notes ──
  const notesHTML = notes
    ? boxRow([{ label: 'Account Notes', html: `<div style="white-space:pre-line;font-size:11px;">${notes}</div>` }])
    : '';

  // ── Footer ──
  const footer = footerBar(
    `Statement generated by ${companyName} · ${todayStr} · Statement # ${stmtNum} · Confidential — for named account holder only.`
  );

  // ── Assemble ──
  const inner =
    header +
    meta +
    parties +
    summaryBox +
    chargeTable +
    interestDetailHTML +
    paymentTable +
    legalBox +
    notesHTML +
    footer;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement ${stmtNum}</title>` +
    `<style>${classicStyles()}</style></head><body>` +
    docFrame(inner) +
    `</body></html>`;
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
        {/* iframe isolates the statement CSS so it can't leak into the app */}
        <iframe
          srcDoc={html}
          title="Statement Preview"
          style={{ width: '100%', minHeight: '900px', border: 'none', background: '#fff' }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
};

export default DebtInvoiceFormatter;
