// src/renderer/modules/reports/TaxForms.tsx
//
// Tax form generator UI. Three forms available:
//   • Form 941 (quarterly payroll federal tax return)
//   • Schedule C (sole-prop profit/loss)
//   • Form 1099-NEC (nonemployee compensation, year-end)
//
// All three: pick year (and quarter for 941), click Compute, review
// the line-numbered output, click Export PDF for the worksheet.

import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Download, AlertTriangle, ChevronLeft } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';

type FormType = '941' | 'schedule-c' | '1099-nec' | 'w2' | 'schedule-se' | 'sales-tax' | 'w3' | '940' | '1099-misc';

interface Props { onBack?: () => void }

const fmt$ = (n: number): string => {
  if (n === null || n === undefined) return '$0.00';
  const sign = n < 0 ? '-$' : '$';
  return sign + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const TaxForms: React.FC<Props> = ({ onBack }) => {
  const toast = useToast();
  const currentYear = new Date().getFullYear();
  const [activeForm, setActiveForm] = useState<FormType>('941');
  const [year, setYear] = useState(currentYear);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(1);
  const [salesPeriodStart, setSalesPeriodStart] = useState(currentYear + '-01-01');
  const [salesPeriodEnd, setSalesPeriodEnd] = useState(currentYear + '-03-31');
  const [w2OtherWages, setW2OtherWages] = useState(0);
  const [futaMultiState, setFutaMultiState] = useState(false);
  const [futaCreditReduction, setFutaCreditReduction] = useState(false);
  const [futaTotalDeposits, setFutaTotalDeposits] = useState(0);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const compute = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      let r: any;
      if (activeForm === '941') r = await api.taxForm941(year, quarter);
      else if (activeForm === 'schedule-c') r = await api.taxScheduleC(year);
      else if (activeForm === '1099-nec') r = await api.tax1099NEC(year);
      else if (activeForm === 'w2') r = await api.taxW2(year);
      else if (activeForm === 'schedule-se') r = await api.taxScheduleSE(year, w2OtherWages);
      else if (activeForm === 'sales-tax') r = await api.taxSalesTax(salesPeriodStart, salesPeriodEnd);
      else if (activeForm === 'w3') r = await api.taxW3(year);
      else if (activeForm === '940') r = await api.taxForm940(year, { multi_state: futaMultiState, credit_reduction_state: futaCreditReduction, total_deposits: futaTotalDeposits });
      else if (activeForm === '1099-misc') r = await api.tax1099MISC(year);
      setData(r);
    } finally { setLoading(false); }
  }, [activeForm, year, quarter, salesPeriodStart, salesPeriodEnd, w2OtherWages, futaMultiState, futaCreditReduction, futaTotalDeposits]);

  useEffect(() => { compute(); }, [compute]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const opts: any = {};
      if (activeForm === '941') opts.quarter = quarter;
      if (activeForm === 'sales-tax') { opts.period_start = salesPeriodStart; opts.period_end = salesPeriodEnd; }
      if (activeForm === 'schedule-se') opts.w2_ss_wages = w2OtherWages;
      if (activeForm === '940') {
        opts.multi_state = futaMultiState;
        opts.credit_reduction_state = futaCreditReduction;
        opts.total_deposits = futaTotalDeposits;
      }
      const r = await api.taxExportFormPDF(activeForm, year, opts);
      if (r?.error) toast.error('Export failed: ' + r.error);
      else if (r?.path) toast.success('PDF saved to ' + r.path);
    } finally { setExporting(false); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && (
          <button onClick={onBack} className="block-btn flex items-center gap-1.5 text-xs">
            <ChevronLeft size={12} /> Back
          </button>
        )}
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={22} /> IRS Tax Forms
        </h2>
      </div>

      {/* Form picker tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border-primary)', flexWrap: 'wrap' }}>
        {([
          { id: '941' as FormType, label: 'Form 941' },
          { id: '940' as FormType, label: 'Form 940 (FUTA)' },
          { id: 'schedule-c' as FormType, label: 'Schedule C' },
          { id: 'schedule-se' as FormType, label: 'Schedule SE' },
          { id: 'w2' as FormType, label: 'W-2' },
          { id: 'w3' as FormType, label: 'W-3' },
          { id: '1099-nec' as FormType, label: '1099-NEC' },
          { id: '1099-misc' as FormType, label: '1099-MISC' },
          { id: 'sales-tax' as FormType, label: 'Sales Tax' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveForm(tab.id)}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              border: 'none',
              borderBottom: '2px solid ' + (activeForm === tab.id ? 'var(--color-accent-blue)' : 'transparent'),
              color: activeForm === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {activeForm !== 'sales-tax' && (
          <select className="block-input" value={year} onChange={(e) => setYear(parseInt(e.target.value))} style={{ width: 100 }}>
            {[currentYear - 2, currentYear - 1, currentYear].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {activeForm === '941' && (
          <select className="block-input" value={quarter} onChange={(e) => setQuarter(parseInt(e.target.value) as any)} style={{ width: 100 }}>
            <option value={1}>Q1</option>
            <option value={2}>Q2</option>
            <option value={3}>Q3</option>
            <option value={4}>Q4</option>
          </select>
        )}
        {activeForm === 'sales-tax' && (
          <>
            <input type="date" className="block-input" value={salesPeriodStart} onChange={(e) => setSalesPeriodStart(e.target.value)} style={{ width: 150 }} />
            <span style={{ color: 'var(--color-text-muted)' }}>→</span>
            <input type="date" className="block-input" value={salesPeriodEnd} onChange={(e) => setSalesPeriodEnd(e.target.value)} style={{ width: 150 }} />
          </>
        )}
        {activeForm === 'schedule-se' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
            <span>+ W-2 wages from another job:</span>
            <input
              type="number"
              className="block-input"
              value={w2OtherWages}
              onChange={(e) => setW2OtherWages(parseFloat(e.target.value) || 0)}
              style={{ width: 110 }}
              placeholder="0"
              min={0}
              step="100"
            />
          </label>
        )}
        {activeForm === '940' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <input type="checkbox" checked={futaMultiState} onChange={(e) => setFutaMultiState(e.target.checked)} /> Multi-state
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <input type="checkbox" checked={futaCreditReduction} onChange={(e) => setFutaCreditReduction(e.target.checked)} /> Credit-reduction state
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <span>Deposits paid:</span>
              <input
                type="number"
                className="block-input"
                value={futaTotalDeposits}
                onChange={(e) => setFutaTotalDeposits(parseFloat(e.target.value) || 0)}
                style={{ width: 110 }}
                placeholder="0"
                min={0}
                step="50"
              />
            </label>
          </>
        )}
        <button onClick={compute} disabled={loading} className="block-btn flex items-center gap-1.5 text-xs">
          {loading ? 'Computing…' : 'Recompute'}
        </button>
        <button onClick={handleExport} disabled={exporting || !data} className="block-btn-primary flex items-center gap-1.5 text-xs" style={{ marginLeft: 'auto' }}>
          <Download size={12} /> {exporting ? 'Exporting…' : 'Export PDF Worksheet'}
        </button>
      </div>

      {loading && <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Computing form data…</div>}

      {!loading && data && activeForm === '941' && <Form941View data={data} />}
      {!loading && data && activeForm === 'schedule-c' && <ScheduleCView data={data} />}
      {!loading && data && activeForm === '1099-nec' && <Nec1099View forms={Array.isArray(data) ? data : []} />}
      {!loading && data && activeForm === 'w2' && <W2View forms={Array.isArray(data) ? data : []} />}
      {!loading && data && activeForm === 'schedule-se' && <ScheduleSEView data={data} />}
      {!loading && data && activeForm === 'sales-tax' && <SalesTaxView data={data} />}
      {!loading && data && activeForm === 'w3' && <W3View data={data} />}
      {!loading && data && activeForm === '940' && <Form940View data={data} />}
      {!loading && data && activeForm === '1099-misc' && <Misc1099View forms={Array.isArray(data) ? data : []} />}

      {/* Disclaimer */}
      <div style={{
        marginTop: 16,
        padding: 12,
        border: '1px dashed var(--color-border-primary)',
        background: 'rgba(217, 119, 6, 0.05)',
        borderRadius: 6,
        fontSize: 11,
        color: 'var(--color-text-muted)',
      }}>
        <strong>Worksheet, not official IRS form.</strong> Use these computations to e-file separately or transcribe to the official form. Tax forms have legal complexity beyond what auto-mapping can capture — verify with your CPA before filing.
      </div>
    </div>
  );
};

// ── Form 941 view ──────────────────────────────────────────────

const Form941View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  const Line = ({ n, label, value, tone }: { n: string; label: string; value: any; tone?: 'red' | 'green' | 'bold' }) => (
    <tr style={tone === 'bold' ? { background: 'rgba(0,0,0,0.04)' } : undefined}>
      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 70 }}>{n}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: tone === 'bold' ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? '#dc2626' : tone === 'green' ? '#16a34a' : 'var(--color-text-primary)' }}>
        {typeof value === 'number' ? fmt$(value) : value}
      </td>
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Quarter Summary · {data.business_name} · EIN {data.ein || '__-_______'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Employees" value={String(data.line1_employees)} />
          <Stat label="Pay Stubs" value={String(data.pay_stub_count)} />
          <Stat label="Total Wages" value={fmt$(data.line2_wages_tips)} />
          <Stat label="Total Tax" value={fmt$(data.line12_total_taxes_after_credits)} highlight />
        </div>
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Part 1 — Quarterly Wages &amp; Taxes
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="2" label="Wages, tips, and other compensation" value={data.line2_wages_tips} />
            <Line n="3" label="Federal income tax withheld" value={data.line3_fed_income_tax} />
            <Line n="5a" label="Taxable SS wages × 12.4%" value={data.line5a_taxable_ss_wages} />
            <Line n="5a tax" label="  → SS tax (employer + employee)" value={data.line5a_ss_tax} />
            <Line n="5c" label="Taxable Medicare wages × 2.9%" value={data.line5c_taxable_medicare_wages} />
            <Line n="5c tax" label="  → Medicare tax" value={data.line5c_medicare_tax} />
            <Line n="5d" label="Wages over $200k subject to addtl Medicare" value={data.line5d_addtl_medicare_wages} />
            <Line n="5d tax" label="  → Additional Medicare 0.9%" value={data.line5d_addtl_medicare_tax} />
            <Line n="5e" label="Total SS + Medicare taxes" value={data.line5e_total} tone="bold" />
            <Line n="6" label="Total taxes before adjustments" value={data.line6_total_taxes_before_adj} tone="bold" />
            <Line n="10" label="Total taxes after adjustments" value={data.line10_total_taxes_after_adj} tone="bold" />
            <Line n="12" label="Total taxes after credits (file this)" value={data.line12_total_taxes_after_credits} tone="red" />
            <Line n="13a" label="Total deposits this quarter" value={data.line13a_total_deposits} />
            <Line n="14" label="Balance due" value={data.line14_balance_due} tone="red" />
            <Line n="15" label="Overpayment" value={data.line15_overpayment} tone="green" />
          </tbody>
        </table>
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#475569', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Part 2 — Liability by Month · Schedule: {data.deposit_schedule}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="Month 1" label="First month liability" value={data.month1_liability} />
            <Line n="Month 2" label="Second month liability" value={data.month2_liability} />
            <Line n="Month 3" label="Third month liability" value={data.month3_liability} />
            <Line n="Total" label="Total quarter liability" value={data.total_quarter_liability} tone="bold" />
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Schedule C view ────────────────────────────────────────────

const ScheduleCView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  const Line = ({ n, label, value, tone }: { n: string; label: string; value: any; tone?: 'red' | 'green' | 'bold' }) => (
    <tr style={tone === 'bold' ? { background: 'rgba(0,0,0,0.04)' } : undefined}>
      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 60 }}>{n}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: tone === 'bold' ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? '#dc2626' : tone === 'green' ? '#16a34a' : 'var(--color-text-primary)' }}>
        {typeof value === 'number' ? fmt$(value) : value}
      </td>
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Gross Receipts" value={fmt$(data.line1_gross_receipts)} />
          <Stat label="Total Expenses" value={fmt$(data.line28_total_expenses)} color="#dc2626" />
          <Stat label="Net Profit" value={fmt$(data.line31_net_profit)} highlight color={data.line31_net_profit >= 0 ? '#16a34a' : '#dc2626'} />
          <Stat label="Uncategorized" value={fmt$(data.uncategorized_total)} color="#d97706" />
        </div>
        {data.uncategorized_total > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-warning, #d97706)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <AlertTriangle size={12} />
            <span>{data.uncategorized_total > 0 ? fmt$(data.uncategorized_total) + ' in expenses landed in "Other" because the category name didn\'t match a Schedule C line keyword. Review before filing.' : ''}</span>
          </div>
        )}
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Part I — Income
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="1" label="Gross receipts or sales" value={data.line1_gross_receipts} />
            <Line n="2" label="Returns and allowances" value={data.line2_returns_allowances} />
            <Line n="3" label="Subtract" value={data.line3_subtract} />
            <Line n="4" label="Cost of goods sold" value={data.line4_cogs} />
            <Line n="5" label="Gross profit" value={data.line5_gross_profit} />
            <Line n="6" label="Other income" value={data.line6_other_income} />
            <Line n="7" label="Gross income" value={data.line7_gross_income} tone="bold" />
          </tbody>
        </table>
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#475569', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Part II — Expenses
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="8" label="Advertising" value={data.line8_advertising} />
            <Line n="9" label="Car and truck expenses" value={data.line9_car_truck} />
            <Line n="10" label="Commissions and fees" value={data.line10_commissions_fees} />
            <Line n="11" label="Contract labor" value={data.line11_contract_labor} />
            <Line n="13" label="Depreciation" value={data.line13_depreciation} />
            <Line n="14" label="Employee benefits" value={data.line14_employee_benefits} />
            <Line n="15" label="Insurance" value={data.line15_insurance} />
            <Line n="16b" label="Interest" value={data.line16b_other_interest} />
            <Line n="17" label="Legal &amp; professional services" value={data.line17_legal_professional} />
            <Line n="18" label="Office expense" value={data.line18_office_expense} />
            <Line n="20b" label="Rent" value={data.line20b_rent_other} />
            <Line n="21" label="Repairs &amp; maintenance" value={data.line21_repairs_maintenance} />
            <Line n="22" label="Supplies" value={data.line22_supplies} />
            <Line n="23" label="Taxes &amp; licenses" value={data.line23_taxes_licenses} />
            <Line n="24a" label="Travel" value={data.line24a_travel} />
            <Line n="24b" label="Meals (50% deductible)" value={data.line24b_meals} />
            <Line n="25" label="Utilities" value={data.line25_utilities} />
            <Line n="26" label="Wages" value={data.line26_wages} />
            <Line n="27b" label="Total other expenses (see PDF for detail)" value={data.line27b_other_total} />
            <Line n="28" label="Total expenses" value={data.line28_total_expenses} tone="red" />
            <Line n="29" label="Tentative profit" value={data.line29_tentative_profit} tone="bold" />
            <Line n="31" label="Net profit (carries to 1040)" value={data.line31_net_profit} tone={data.line31_net_profit >= 0 ? 'green' : 'red'} />
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── 1099-NEC view ──────────────────────────────────────────────

const Nec1099View: React.FC<{ forms: any[] }> = ({ forms }) => {
  if (forms.length === 0) {
    return (
      <div className="block-card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        No 1099-eligible vendors with payments in this year. Mark vendors as "1099-eligible" in the Vendor settings to include them.
      </div>
    );
  }
  const filable = forms.filter((f) => f.meets_filing_threshold && f.has_tin);
  const blocked = forms.filter((f) => f.meets_filing_threshold && !f.has_tin);
  const belowThreshold = forms.filter((f) => !f.meets_filing_threshold);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Total Recipients" value={String(forms.length)} />
          <Stat label="Ready to File" value={String(filable.length)} color="#16a34a" />
          <Stat label="Blocked (no TIN)" value={String(blocked.length)} color="#dc2626" />
          <Stat label="Below $600" value={String(belowThreshold.length)} color="#94a3b8" />
        </div>
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
              {['', 'Recipient', 'TIN', 'Box 1 (NEC)', 'Payments', 'Status'].map((h, i) => (
                <th key={h + i} style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i === 3 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.map((f, idx) => {
              const ready = f.meets_filing_threshold && f.has_tin;
              const noTin = f.meets_filing_threshold && !f.has_tin;
              return (
                <tr key={f.recipient_id || idx} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <td style={{ padding: '6px 10px', width: 30 }}>
                    {ready ? '✅' : noTin ? '⛔' : '⏸️'}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>
                    {f.recipient_name}
                    {f.recipient_address && (
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                        {f.recipient_city}, {f.recipient_state} {f.recipient_zip}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: f.has_tin ? 'var(--color-text-primary)' : '#dc2626' }}>
                    {f.recipient_tin || 'MISSING'}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 12, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>
                    {fmt$(f.box1_nonemployee_comp)}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {f.payment_count} payment{f.payment_count === 1 ? '' : 's'}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 10 }}>
                    {ready && <span style={{ color: '#16a34a', fontWeight: 700 }}>READY</span>}
                    {noTin && <span style={{ color: '#dc2626', fontWeight: 700 }}>NO TIN — Request W-9</span>}
                    {!f.meets_filing_threshold && <span style={{ color: '#94a3b8' }}>Below $600 (no filing required)</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── W-2 view ───────────────────────────────────────────────────

const W2View: React.FC<{ forms: any[] }> = ({ forms }) => {
  if (forms.length === 0) {
    return (
      <div className="block-card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        No employees with pay stubs in this year.
      </div>
    );
  }
  const totals = forms.reduce((acc, f) => ({
    box1: acc.box1 + (f.box1_wages_tips || 0),
    box2: acc.box2 + (f.box2_fed_income_tax || 0),
    box3: acc.box3 + (f.box3_ss_wages || 0),
    box5: acc.box5 + (f.box5_medicare_wages || 0),
  }), { box1: 0, box2: 0, box3: 0, box5: 0 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <Stat label="Employees" value={String(forms.length)} />
          <Stat label="Box 1 Wages" value={fmt$(totals.box1)} />
          <Stat label="Box 2 Fed Tax" value={fmt$(totals.box2)} color="#dc2626" />
          <Stat label="Box 3 SS Wages" value={fmt$(totals.box3)} />
          <Stat label="Box 5 Medicare" value={fmt$(totals.box5)} />
        </div>
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
              {['Employee', 'SSN', 'Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5', 'Box 6', 'Stubs'].map((h, i) => (
                <th key={h + i} style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i >= 2 && i <= 7 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.map((f, idx) => (
              <tr key={f.employee_id || idx} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>
                  {f.employee_first_name} {f.employee_last_name}
                  {f.warnings.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--color-accent-expense)' }} title={f.warnings.join(' · ')}>
                      ⚠ {f.warnings.length} warning{f.warnings.length === 1 ? '' : 's'}
                    </div>
                  )}
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: f.employee_ssn ? 'var(--color-text-primary)' : '#dc2626' }}>
                  {f.employee_ssn ? '•••-••-' + (f.employee_ssn.slice(-4) || '????') : 'MISSING'}
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600 }}>{fmt$(f.box1_wages_tips)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(f.box2_fed_income_tax)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(f.box3_ss_wages)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(f.box4_ss_tax)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(f.box5_medicare_wages)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(f.box6_medicare_tax)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', color: 'var(--color-text-muted)' }}>{f.pay_stub_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Schedule SE view ───────────────────────────────────────────

const ScheduleSEView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  const Line = ({ n, label, value, tone }: { n: string; label: string; value: any; tone?: 'red' | 'green' | 'bold' }) => (
    <tr style={tone === 'bold' ? { background: 'rgba(0,0,0,0.04)' } : undefined}>
      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 70 }}>{n}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: tone === 'bold' ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? '#dc2626' : tone === 'green' ? '#16a34a' : 'var(--color-text-primary)' }}>
        {typeof value === 'number' ? fmt$(value) : value}
      </td>
    </tr>
  );

  const noTaxOwed = data.line2_other_se_income < 400;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Schedule C Profit" value={fmt$(data.schedule_c_net_profit)} color={data.schedule_c_net_profit >= 0 ? '#16a34a' : '#dc2626'} />
          <Stat label="SS Tax (12.4%)" value={fmt$(data.line10_ss_tax)} />
          <Stat label="Medicare Tax (2.9%)" value={fmt$(data.line11_medicare_tax)} />
          <Stat label="Total SE Tax" value={fmt$(data.line12_total_se_tax)} highlight color="#dc2626" />
        </div>
        {!noTaxOwed && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(22, 163, 74, 0.08)', border: '1px solid rgba(22, 163, 74, 0.3)', borderRadius: 6, fontSize: 11, color: 'var(--color-text-primary)' }}>
            <strong>Don't forget:</strong> Line 13 deductible half ({fmt$(data.line13_deductible_half)}) is an above-the-line deduction on Form 1040 Schedule 1 line 15. Reduces your AGI even without itemizing — one of the most-missed deductions in DIY filing.
          </div>
        )}
      </div>

      {noTaxOwed && (
        <div className="block-card" style={{ padding: 14, borderLeft: '3px solid var(--color-text-muted)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>No SE tax owed</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            Net profit from Schedule C ({fmt$(data.line2_other_se_income)}) is below the $400 threshold that triggers self-employment tax. Schedule SE is not required to be filed.
          </div>
        </div>
      )}

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Part I — Self-Employment Income
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="2" label="Net profit from Schedule C" value={data.line2_other_se_income} />
            <Line n="3" label="Combine 1a, 1b, 2" value={data.line3_total} />
            <Line n="4a" label="Line 3 × 92.35%" value={data.line4a_se_income_x_92pct} />
            <Line n="6" label="Total SE income subject to tax" value={data.line6_total_se_income} tone="bold" />
          </tbody>
        </table>
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#475569', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Part II — Self-Employment Tax
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="7" label="Maximum SS earnings (2026 wage base)" value={data.line7_max_ss_earnings} />
            <Line n="8a" label="W-2 SS wages from other employers" value={data.line8a_ss_wages_w2} />
            <Line n="9" label="Remaining SS cap (line 7 − 8d)" value={data.line9_remaining_ss_cap} />
            <Line n="10" label="SS tax: min(6, 9) × 12.4%" value={data.line10_ss_tax} />
            <Line n="11" label="Medicare tax: line 6 × 2.9%" value={data.line11_medicare_tax} />
            <Line n="12" label="Total SE tax → Schedule 2 line 4" value={data.line12_total_se_tax} tone="red" />
            <Line n="13" label="Deductible half → Schedule 1 line 15" value={data.line13_deductible_half} tone="green" />
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Sales tax view ─────────────────────────────────────────────

const SalesTaxView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Gross Sales" value={fmt$(data.total_gross_sales)} />
          <Stat label="Taxable Sales" value={fmt$(data.total_taxable_sales)} />
          <Stat label="Tax Collected" value={fmt$(data.total_tax_collected)} />
          <Stat label="Net Remittance" value={fmt$(data.net_remittance)} highlight color="#dc2626" />
        </div>
        {Math.abs(data.total_variance) > 1 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 6, fontSize: 11, color: 'var(--color-text-primary)' }}>
            <strong>⚠ Variance:</strong> Tax collected ({fmt$(data.total_tax_collected)}) differs from tax due ({fmt$(data.total_tax_due)}) by {fmt$(data.total_variance)}. Review invoices for rate or rounding issues.
          </div>
        )}
        {data.warnings.length > 0 && Math.abs(data.total_variance) <= 1 && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
            {data.warnings.map((w: string, i: number) => <div key={i}>• {w}</div>)}
          </div>
        )}
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          By Tax Rate
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
              {['Rate', 'Taxable Sales', 'Tax Due', 'Tax Collected', 'Variance', 'Invoices'].map((h, i) => (
                <th key={h + i} style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rate_lines.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
                No taxable sales in this period.
              </td></tr>
            ) : data.rate_lines.map((l: any, i: number) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>{l.rate_label}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(l.taxable_sales)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600 }}>{fmt$(l.tax_due)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(l.tax_collected)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: Math.abs(l.variance) < 0.5 ? '#16a34a' : '#d97706' }}>{fmt$(l.variance)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', color: 'var(--color-text-muted)' }}>{l.invoice_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color?: string; highlight?: boolean }> = ({ label, value, color, highlight }) => (
  <div>
    <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
    <div style={{
      fontSize: highlight ? 22 : 18,
      fontWeight: 800,
      fontFamily: 'SF Mono, Menlo, monospace',
      color: color || 'var(--color-text-primary)',
    }}>{value}</div>
  </div>
);

// ── W-3 view (transmittal) ─────────────────────────────────────

const W3View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  const w2s = data.w2_forms || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          W-3 Transmittal · {data.tax_year} · {data.employer_name} · EIN {data.employer_ein || '__-_______'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="W-2s Attached" value={String(data.number_of_w2s)} highlight />
          <Stat label="Total Box 1 Wages" value={fmt$(data.box1_total_wages_tips)} />
          <Stat label="Total Fed Tax" value={fmt$(data.box2_total_fed_income_tax)} />
          <Stat label="Total SS+Medicare" value={fmt$(data.box4_total_ss_tax + data.box6_total_medicare_tax)} />
        </div>
        {data.warnings && data.warnings.length > 0 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 6, fontSize: 11, color: 'var(--color-text-primary)' }}>
            <strong>⚠ Reconciliation:</strong>
            <ul style={{ margin: '4px 0 0 18px' }}>{data.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Box Totals (sum of all attached W-2s)
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['1', 'Wages, tips, other comp', data.box1_total_wages_tips],
              ['2', 'Federal income tax withheld', data.box2_total_fed_income_tax],
              ['3', 'Social Security wages', data.box3_total_ss_wages],
              ['4', 'Social Security tax withheld', data.box4_total_ss_tax],
              ['5', 'Medicare wages and tips', data.box5_total_medicare_wages],
              ['6', 'Medicare tax withheld', data.box6_total_medicare_tax],
              ['10', 'Dependent care benefits', data.box10_total_dependent_care],
              ['12a', 'Box 12 codes total (D, W, AA, etc.)', data.box12a_total],
              ['16', 'Total state wages', data.box16_total_state_wages],
              ['17', 'Total state income tax', data.box17_total_state_income_tax],
            ].map(([n, label, val]) => (
              <tr key={String(n)} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 70 }}>{n}</td>
                <td style={{ padding: '6px 10px', fontSize: 11 }}>{label}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600 }}>{fmt$(val as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.box12_breakdown && data.box12_breakdown.length > 0 && (
        <div className="block-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Box 12 Breakdown by Code
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {data.box12_breakdown.map((b: any) => (
                <tr key={b.code} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700, width: 70 }}>{b.code}</td>
                  <td style={{ padding: '6px 10px', fontSize: 11 }}>{b.label}</td>
                  <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600 }}>{fmt$(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Attached W-2s ({w2s.length})
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
              {['Employee', 'Box 1 Wages', 'Box 2 Fed Tax', 'Box 3 SS', 'Box 5 Medicare'].map((h, i) => (
                <th key={h} style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {w2s.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>No W-2s for {data.tax_year}.</td></tr>
            ) : w2s.map((w: any, i: number) => (
              <tr key={w.employee_id || i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>{w.employee_first_name} {w.employee_last_name}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(w.box1_wages_tips)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(w.box2_fed_income_tax)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(w.box3_ss_wages)}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(w.box5_medicare_wages)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Form 940 view (FUTA) ──────────────────────────────────────

const Form940View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  const Line = ({ n, label, value, tone }: { n: string; label: string; value: any; tone?: 'red' | 'green' | 'bold' }) => (
    <tr style={tone === 'bold' ? { background: 'rgba(0,0,0,0.04)' } : undefined}>
      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 70 }}>{n}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: tone === 'bold' ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? '#dc2626' : tone === 'green' ? '#16a34a' : 'var(--color-text-primary)' }}>
        {typeof value === 'number' ? fmt$(value) : value}
      </td>
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Form 940 Annual FUTA · {data.year} · {data.business_name} · EIN {data.ein || '__-_______'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Employees" value={String(data.employee_count)} />
          <Stat label="Taxable Wages" value={fmt$(data.line7_total_taxable)} />
          <Stat label="Total FUTA" value={fmt$(data.line12_total_futa)} highlight color="#dc2626" />
          <Stat label={data.line14_balance_due > 0 ? 'Balance Due' : 'Overpayment'} value={fmt$(data.line14_balance_due > 0 ? data.line14_balance_due : data.line15_overpayment)} color={data.line14_balance_due > 0 ? '#dc2626' : '#16a34a'} />
        </div>
        {data.warnings.length > 0 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 6, fontSize: 11, color: 'var(--color-text-primary)' }}>
            <strong>⚠ Notes:</strong>
            <ul style={{ margin: '4px 0 0 18px' }}>{data.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Part 2 — FUTA Tax Before Adjustments
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="3" label="Total payments to all employees" value={data.line3_total_payments} />
            <Line n="4" label="Payments exempt from FUTA" value={data.line4_payments_exempt} />
            <Line n="5" label="Payments > $7,000 per employee (NOT taxable)" value={data.line5_payments_excess_7k} />
            <Line n="6" label="Subtotal exempt+excess (4 + 5)" value={data.line6_subtotal} />
            <Line n="7" label="Total taxable FUTA wages (3 − 6)" value={data.line7_total_taxable} tone="bold" />
            <Line n="8" label="FUTA tax before adjustments (7 × 0.006)" value={data.line8_futa_tax} tone="red" />
          </tbody>
        </table>
      </div>

      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Parts 3 & 4 — Adjustments and Balance
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="9" label="No state UI paid: line 7 × 0.054" value={data.line9_no_credit} />
            <Line n="10" label="Some wages excluded / late" value={data.line10_some_credit} />
            <Line n="11" label="Credit reduction (Schedule A)" value={data.line11_credit_reduction} />
            <Line n="12" label="Total FUTA tax (8 + 9 + 10 + 11)" value={data.line12_total_futa} tone="red" />
            <Line n="13" label="Total deposits made for the year" value={data.line13_total_deposits} tone="green" />
            <Line n="14" label="Balance due" value={data.line14_balance_due} tone={data.line14_balance_due > 0 ? 'red' : undefined} />
            <Line n="15" label="Overpayment" value={data.line15_overpayment} tone={data.line15_overpayment > 0 ? 'green' : undefined} />
          </tbody>
        </table>
      </div>

      {data.has_quarterly_deposit_required && (
        <div className="block-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Part 5 — Quarterly Liability (FUTA &gt; $500 threshold)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <Line n="16a" label="Q1 (Jan–Mar)" value={data.q1_liability} />
              <Line n="16b" label="Q2 (Apr–Jun)" value={data.q2_liability} />
              <Line n="16c" label="Q3 (Jul–Sep)" value={data.q3_liability} />
              <Line n="16d" label="Q4 (Oct–Dec)" value={data.q4_liability} />
              <Line n="17" label="Total quarterly liability (must equal line 12)" value={data.total_quarterly_liability} tone="bold" />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── 1099-MISC view ─────────────────────────────────────────────

const Misc1099View: React.FC<{ forms: any[] }> = ({ forms }) => {
  if (!forms || forms.length === 0) {
    return <div className="block-card" style={{ padding: 18, color: 'var(--color-text-muted)', fontSize: 12 }}>
      No 1099-MISC eligible vendors. Mark vendors as 1099-MISC eligible in the Vendors module to see them here.
    </div>;
  }
  const totals = forms.reduce((acc: any, f: any) => {
    acc.box1 += f.box1_rents;
    acc.box2 += f.box2_royalties;
    acc.box3 += f.box3_other_income;
    acc.box6 += f.box6_medical_healthcare;
    acc.box10 += f.box10_gross_proceeds_attorney;
    acc.total += f.total_paid;
    return acc;
  }, { box1: 0, box2: 0, box3: 0, box6: 0, box10: 0, total: 0 });
  const ready = forms.filter((f: any) => f.meets_filing_threshold && f.has_tin).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Recipients" value={String(forms.length)} />
          <Stat label="Ready to File" value={String(ready)} color="#16a34a" />
          <Stat label="Total Paid" value={fmt$(totals.total)} highlight />
          <Stat label="Largest Box" value={(() => {
            const entries = [
              ['Rents', totals.box1],
              ['Royalties', totals.box2],
              ['Other', totals.box3],
              ['Medical', totals.box6],
              ['Attorney', totals.box10],
            ];
            entries.sort((a: any, b: any) => b[1] - a[1]);
            return entries[0][0] as string;
          })()} />
        </div>
      </div>

      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Summary by Box
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['1', 'Rents', totals.box1],
              ['2', 'Royalties (≥ $10 threshold)', totals.box2],
              ['3', 'Other income', totals.box3],
              ['6', 'Medical/healthcare', totals.box6],
              ['10', 'Gross proceeds to attorney (settlements)', totals.box10],
            ].map(([n, label, val]: any) => (
              <tr key={n} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 70 }}>{n}</td>
                <td style={{ padding: '6px 10px', fontSize: 11 }}>{label}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600, color: val > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{fmt$(val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          Recipients ({forms.length})
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
              {['Recipient', 'TIN', 'Primary Box', 'Total Paid', 'Status'].map((h, i) => (
                <th key={h} style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i === 3 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.map((f: any, i: number) => (
              <tr key={f.recipient_id || i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>{f.recipient_name || '(unnamed)'}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: f.has_tin ? 'var(--color-text-primary)' : '#dc2626' }}>
                  {f.has_tin ? '•••' + (f.recipient_tin || '').slice(-4) : '⛔ missing'}
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11 }}>
                  <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,0.06)' }}>
                    {f.primary_box.replace('box', 'Box ')}
                  </span>
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>{fmt$(f.total_paid)}</td>
                <td style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700 }}>
                  {f.meets_filing_threshold && f.has_tin ? <span style={{ color: '#16a34a' }}>✓ READY</span> :
                    !f.has_tin ? <span style={{ color: '#dc2626', display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={11} /> NO TIN</span> :
                    <span style={{ color: '#94a3b8' }}>⏸ &lt; threshold</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TaxForms;
