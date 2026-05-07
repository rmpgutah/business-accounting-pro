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

type FormType = '941' | 'schedule-c' | '1099-nec';

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
      setData(r);
    } finally { setLoading(false); }
  }, [activeForm, year, quarter]);

  useEffect(() => { compute(); }, [compute]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const r = await api.taxExportFormPDF(activeForm, year, activeForm === '941' ? quarter : undefined);
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
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border-primary)' }}>
        {([
          { id: '941' as FormType, label: 'Form 941 — Quarterly Payroll' },
          { id: 'schedule-c' as FormType, label: 'Schedule C — Sole Prop P&L' },
          { id: '1099-nec' as FormType, label: '1099-NEC — Contractor Pay' },
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
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <select className="block-input" value={year} onChange={(e) => setYear(parseInt(e.target.value))} style={{ width: 100 }}>
          {[currentYear - 2, currentYear - 1, currentYear].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {activeForm === '941' && (
          <select className="block-input" value={quarter} onChange={(e) => setQuarter(parseInt(e.target.value) as any)} style={{ width: 100 }}>
            <option value={1}>Q1</option>
            <option value={2}>Q2</option>
            <option value={3}>Q3</option>
            <option value={4}>Q4</option>
          </select>
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

export default TaxForms;
