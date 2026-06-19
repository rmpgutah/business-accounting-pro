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

type FormType =
  | '941' | 'schedule-c' | '1099-nec' | 'w2' | 'schedule-se' | 'sales-tax'
  | 'w3' | '940' | '1099-misc'
  | '944' | '945' | 'schedule-941b' | '945-a'
  | '1099-int' | '1099-div' | '1099-r' | '1099-k'
  | '1099-b' | '1099-g' | '1099-c' | '1099-sa'
  | 'w2c' | '1096'
  | 'schedule-1' | 'schedule-2' | 'schedule-3'
  | 'schedule-a' | 'schedule-b' | 'schedule-d'
  | '1040-es'
  | '8995' | '4562' | '8829' | '4797' | '7004' | '4868'
  | '1065' | '1120' | '1120-s' | 'k-1' | '1041'
  | '1094-c' | '1095-c'
  | 'ss-4' | '2553' | '8832' | '8822-b'
  | 'tc-40' | 'tc-20' | 'tc-20s' | 'tc-65' | 'tc-62m' | 'tc-941';

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
      else if (activeForm === '944') r = await api.taxForm944(year);
      else if (activeForm === '945') r = await api.taxForm945(year);
      else if (activeForm === 'schedule-941b') r = await api.taxSchedule941B(year, quarter);
      else if (activeForm === '945-a') r = await api.taxForm945A(year, 'form-945');
      else if (activeForm === '1099-int') r = await api.tax1099INT(year);
      else if (activeForm === '1099-div') r = await api.tax1099DIV(year);
      else if (activeForm === '1099-r') r = await api.tax1099R(year);
      else if (activeForm === '1099-k') r = await api.tax1099K(year);
      else if (activeForm === '1099-b') r = await api.tax1099B(year);
      else if (activeForm === '1099-g') r = await api.tax1099G(year);
      else if (activeForm === '1099-c') r = await api.tax1099C(year);
      else if (activeForm === '1099-sa') r = await api.tax1099SA(year);
      else if (activeForm === 'w2c') r = await api.taxW2C(year, []);
      else if (activeForm === '1096') r = await api.taxForm1096(year);
      else if (activeForm === 'schedule-1') r = await api.taxSchedule1(year, { w2_other_wages: w2OtherWages });
      else if (activeForm === 'schedule-2') r = await api.taxSchedule2(year, { w2_other_wages: w2OtherWages });
      else if (activeForm === 'schedule-3') r = await api.taxSchedule3(year);
      else if (activeForm === 'schedule-a') r = await api.taxScheduleA(year);
      else if (activeForm === 'schedule-b') r = await api.taxScheduleB(year);
      else if (activeForm === 'schedule-d') r = await api.taxScheduleD(year);
      else if (activeForm === '1040-es') r = await api.taxForm1040ES(year);
      else if (activeForm === '8995') r = await api.taxForm8995(year);
      else if (activeForm === '4562') r = await api.taxForm4562(year);
      else if (activeForm === '8829') r = await api.taxForm8829(year);
      else if (activeForm === '4797') r = await api.taxForm4797(year);
      else if (activeForm === '7004') r = await api.taxForm7004({ form_code: '23', tax_year_end: year + '-12-31' });
      else if (activeForm === '4868') r = await api.taxForm4868(year, { auto_estimate: true });
      else if (activeForm === '1065') r = await api.taxForm1065(year);
      else if (activeForm === '1120') r = await api.taxForm1120(year);
      else if (activeForm === '1120-s') r = await api.taxForm1120S(year);
      else if (activeForm === '1041') r = await api.taxForm1041(year);
      else if (activeForm === '1094-c') r = await api.taxForm1094C(year);
      else if (activeForm === '1095-c') r = await api.taxForm1095C({ employee_id: '' });
      else if (activeForm === 'ss-4') r = await api.taxFormSS4();
      else if (activeForm === '2553') r = await api.taxForm2553();
      else if (activeForm === '8832') r = await api.taxForm8832();
      else if (activeForm === '8822-b') r = await api.taxForm8822B();
      else if (activeForm === 'tc-40') r = await api.taxTC40(year);
      else if (activeForm === 'tc-20') r = await api.taxTC20(year);
      else if (activeForm === 'tc-20s') r = await api.taxTC20S(year);
      else if (activeForm === 'tc-65') r = await api.taxTC65(year);
      else if (activeForm === 'tc-62m') r = await api.taxTC62M(year, year + '-01-01', year + '-12-31');
      else if (activeForm === 'tc-941') r = await api.taxTC941(year);
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
          { id: '944' as FormType, label: 'Form 944' },
          { id: '945' as FormType, label: 'Form 945' },
          { id: '940' as FormType, label: 'Form 940 (FUTA)' },
          { id: 'schedule-941b' as FormType, label: '941 Sch B' },
          { id: '945-a' as FormType, label: 'Form 945-A' },
          { id: 'schedule-c' as FormType, label: 'Schedule C' },
          { id: 'schedule-se' as FormType, label: 'Schedule SE' },
          { id: 'w2' as FormType, label: 'W-2' },
          { id: 'w3' as FormType, label: 'W-3' },
          { id: '1099-nec' as FormType, label: '1099-NEC' },
          { id: '1099-misc' as FormType, label: '1099-MISC' },
          { id: '1099-int' as FormType, label: '1099-INT' },
          { id: '1099-div' as FormType, label: '1099-DIV' },
          { id: '1099-r' as FormType, label: '1099-R' },
          { id: '1099-k' as FormType, label: '1099-K' },
          { id: '1099-b' as FormType, label: '1099-B' },
          { id: '1099-g' as FormType, label: '1099-G' },
          { id: '1099-c' as FormType, label: '1099-C' },
          { id: '1099-sa' as FormType, label: '1099-SA' },
          { id: '1096' as FormType, label: '1096' },
          { id: 'w2c' as FormType, label: 'W-2c' },
          { id: 'sales-tax' as FormType, label: 'Sales Tax' },
          { id: 'schedule-1' as FormType, label: 'Sch 1' },
          { id: 'schedule-2' as FormType, label: 'Sch 2' },
          { id: 'schedule-3' as FormType, label: 'Sch 3' },
          { id: 'schedule-a' as FormType, label: 'Sch A' },
          { id: 'schedule-b' as FormType, label: 'Sch B' },
          { id: 'schedule-d' as FormType, label: 'Sch D' },
          { id: '1040-es' as FormType, label: '1040-ES' },
          { id: '8995' as FormType, label: '8995 (QBI)' },
          { id: '4562' as FormType, label: '4562 (Depreciation)' },
          { id: '8829' as FormType, label: '8829 (Home Office)' },
          { id: '4797' as FormType, label: '4797 (Asset Sales)' },
          { id: '7004' as FormType, label: '7004 (Biz Ext)' },
          { id: '4868' as FormType, label: '4868 (Ind Ext)' },
          { id: '1065' as FormType, label: '1065 (Partnership)' },
          { id: '1120' as FormType, label: '1120 (C-Corp)' },
          { id: '1120-s' as FormType, label: '1120-S (S-Corp)' },
          { id: '1041' as FormType, label: '1041 (Trust)' },
          { id: '1094-c' as FormType, label: '1094-C (ACA)' },
          { id: '1095-c' as FormType, label: '1095-C (ACA)' },
          { id: 'ss-4' as FormType, label: 'SS-4 (EIN)' },
          { id: '2553' as FormType, label: '2553 (S-Elect)' },
          { id: '8832' as FormType, label: '8832 (Class)' },
          { id: '8822-b' as FormType, label: '8822-B (Addr)' },
          { id: 'tc-40' as FormType, label: 'UT TC-40' },
          { id: 'tc-20' as FormType, label: 'UT TC-20' },
          { id: 'tc-20s' as FormType, label: 'UT TC-20S' },
          { id: 'tc-65' as FormType, label: 'UT TC-65' },
          { id: 'tc-62m' as FormType, label: 'UT TC-62M' },
          { id: 'tc-941' as FormType, label: 'UT TC-941' },
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
          <select className="block-select" value={year} onChange={(e) => setYear(parseInt(e.target.value))} style={{ width: 100 }}>
            {[currentYear - 2, currentYear - 1, currentYear].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {(activeForm === '941' || activeForm === 'schedule-941b') && (
          <select className="block-select" value={quarter} onChange={(e) => setQuarter(parseInt(e.target.value) as any)} style={{ width: 100 }}>
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
      {!loading && data && activeForm === '944' && <Form944View data={data} />}
      {!loading && data && activeForm === '945' && <Form945View data={data} />}
      {!loading && data && activeForm === 'schedule-941b' && <Schedule941BView data={data} />}
      {!loading && data && activeForm === '945-a' && <Form945AView data={data} />}
      {!loading && data && activeForm === '1099-int' && <Generic1099View forms={Array.isArray(data) ? data : []} variant="1099-INT" amountKey="box1_interest_income" amountLabel="Interest paid" thresholdAmount={10} />}
      {!loading && data && activeForm === '1099-div' && <Generic1099View forms={Array.isArray(data) ? data : []} variant="1099-DIV" amountKey="box1a_total_ordinary_dividends" amountLabel="Ordinary dividends" thresholdAmount={10} />}
      {!loading && data && activeForm === '1099-r' && <Generic1099View forms={Array.isArray(data) ? data : []} variant="1099-R" amountKey="box1_gross_distribution" amountLabel="Gross distribution" thresholdAmount={10} />}
      {!loading && data && activeForm === '1099-k' && <Generic1099View forms={Array.isArray(data) ? data : []} variant="1099-K" amountKey="box1a_gross_amount" amountLabel="Gross amount" thresholdAmount={5000} />}
      {!loading && data && activeForm === '1099-b' && <Generic1099View forms={Array.isArray(data) ? data : []} variant="1099-B" amountKey="box1d_proceeds" amountLabel="Proceeds" thresholdAmount={0} />}
      {!loading && data && activeForm === '1099-g' && <Generic1099View forms={Array.isArray(data) ? data : []} variant="1099-G" amountKey="box1_unemployment_comp" amountLabel="Unemployment / refund" thresholdAmount={10} />}
      {!loading && data && activeForm === '1099-c' && <Generic1099View forms={Array.isArray(data) ? data : []} variant="1099-C" amountKey="box2_amount_debt_canceled" amountLabel="Debt canceled" thresholdAmount={600} />}
      {!loading && data && activeForm === '1099-sa' && <Generic1099View forms={Array.isArray(data) ? data : []} variant="1099-SA" amountKey="box1_gross_distribution" amountLabel="HSA/MSA distribution" thresholdAmount={0} />}
      {!loading && data && activeForm === 'w2c' && <W2CView corrections={Array.isArray(data) ? data : []} />}
      {!loading && data && activeForm === '1096' && <Form1096View data={data} />}
      {!loading && data && activeForm === 'schedule-1' && <Schedule1View data={data} />}
      {!loading && data && activeForm === 'schedule-2' && <Schedule2View data={data} />}
      {!loading && data && activeForm === 'schedule-3' && <Schedule3View data={data} />}
      {!loading && data && activeForm === 'schedule-a' && <ScheduleAView data={data} />}
      {!loading && data && activeForm === 'schedule-b' && <ScheduleBView data={data} />}
      {!loading && data && activeForm === 'schedule-d' && <ScheduleDView data={data} />}
      {!loading && data && activeForm === '1040-es' && <Form1040ESView data={data} />}
      {!loading && data && activeForm === '8995' && <Form8995View data={data} />}
      {!loading && data && activeForm === '4562' && <Form4562View data={data} />}
      {!loading && data && activeForm === '8829' && <Form8829View data={data} />}
      {!loading && data && activeForm === '4797' && <Form4797View data={data} />}
      {!loading && data && activeForm === '7004' && <Form7004View data={data} />}
      {!loading && data && activeForm === '4868' && <Form4868View data={data} />}
      {!loading && data && activeForm === '1065' && <Form1065View data={data} />}
      {!loading && data && activeForm === '1120' && <Form1120View data={data} />}
      {!loading && data && activeForm === '1120-s' && <Form1120SView data={data} />}
      {!loading && data && activeForm === '1041' && <Form1041View data={data} />}
      {!loading && data && (['1094-c','1095-c','ss-4','2553','8832','8822-b','tc-40','tc-20','tc-20s','tc-65','tc-62m','tc-941'] as FormType[]).includes(activeForm) && <GenericFormView data={data} formType={activeForm} />}

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
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? 'var(--color-accent-expense)' : tone === 'green' ? 'var(--color-accent-income)' : 'var(--color-text-primary)' }}>
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
        <div style={{ padding: '8px 12px', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
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
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? 'var(--color-accent-expense)' : tone === 'green' ? 'var(--color-accent-income)' : 'var(--color-text-primary)' }}>
        {typeof value === 'number' ? fmt$(value) : value}
      </td>
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Gross Receipts" value={fmt$(data.line1_gross_receipts)} />
          <Stat label="Total Expenses" value={fmt$(data.line28_total_expenses)} color="var(--color-accent-expense)" />
          <Stat label="Net Profit" value={fmt$(data.line31_net_profit)} highlight color={data.line31_net_profit >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)'} />
          <Stat label="Uncategorized" value={fmt$(data.uncategorized_total)} color="var(--color-accent-warning)" />
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
        <div style={{ padding: '8px 12px', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
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
          <Stat label="Ready to File" value={String(filable.length)} color="var(--color-accent-income)" />
          <Stat label="Blocked (no TIN)" value={String(blocked.length)} color="var(--color-accent-expense)" />
          <Stat label="Below $600" value={String(belowThreshold.length)} color="var(--color-text-muted)" />
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
                  <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: f.has_tin ? 'var(--color-text-primary)' : 'var(--color-accent-expense)' }}>
                    {f.recipient_tin || 'MISSING'}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 12, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>
                    {fmt$(f.box1_nonemployee_comp)}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {f.payment_count} payment{f.payment_count === 1 ? '' : 's'}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 10 }}>
                    {ready && <span style={{ color: 'var(--color-accent-income)', fontWeight: 700 }}>READY</span>}
                    {noTin && <span style={{ color: 'var(--color-accent-expense)', fontWeight: 700 }}>NO TIN — Request W-9</span>}
                    {!f.meets_filing_threshold && <span style={{ color: 'var(--color-text-muted)' }}>Below $600 (no filing required)</span>}
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
          <Stat label="Box 2 Fed Tax" value={fmt$(totals.box2)} color="var(--color-accent-expense)" />
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
                <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: f.employee_ssn ? 'var(--color-text-primary)' : 'var(--color-accent-expense)' }}>
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
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? 'var(--color-accent-expense)' : tone === 'green' ? 'var(--color-accent-income)' : 'var(--color-text-primary)' }}>
        {typeof value === 'number' ? fmt$(value) : value}
      </td>
    </tr>
  );

  const noTaxOwed = data.line2_other_se_income < 400;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Schedule C Profit" value={fmt$(data.schedule_c_net_profit)} color={data.schedule_c_net_profit >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)'} />
          <Stat label="SS Tax (12.4%)" value={fmt$(data.line10_ss_tax)} />
          <Stat label="Medicare Tax (2.9%)" value={fmt$(data.line11_medicare_tax)} />
          <Stat label="Total SE Tax" value={fmt$(data.line12_total_se_tax)} highlight color="var(--color-accent-expense)" />
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
        <div style={{ padding: '8px 12px', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
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
          <Stat label="Net Remittance" value={fmt$(data.net_remittance)} highlight color="var(--color-accent-expense)" />
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
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: Math.abs(l.variance) < 0.5 ? 'var(--color-accent-income)' : 'var(--color-accent-warning)' }}>{fmt$(l.variance)}</td>
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
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? 'var(--color-accent-expense)' : tone === 'green' ? 'var(--color-accent-income)' : 'var(--color-text-primary)' }}>
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
          <Stat label="Total FUTA" value={fmt$(data.line12_total_futa)} highlight color="var(--color-accent-expense)" />
          <Stat label={data.line14_balance_due > 0 ? 'Balance Due' : 'Overpayment'} value={fmt$(data.line14_balance_due > 0 ? data.line14_balance_due : data.line15_overpayment)} color={data.line14_balance_due > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'} />
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
          <Stat label="Ready to File" value={String(ready)} color="var(--color-accent-income)" />
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
                <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: f.has_tin ? 'var(--color-text-primary)' : 'var(--color-accent-expense)' }}>
                  {f.has_tin ? '•••' + (f.recipient_tin || '').slice(-4) : '⛔ missing'}
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11 }}>
                  <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,0.06)' }}>
                    {f.primary_box.replace('box', 'Box ')}
                  </span>
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>{fmt$(f.total_paid)}</td>
                <td style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700 }}>
                  {f.meets_filing_threshold && f.has_tin ? <span style={{ color: 'var(--color-accent-income)' }}>✓ READY</span> :
                    !f.has_tin ? <span style={{ color: 'var(--color-accent-expense)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={11} /> NO TIN</span> :
                    <span style={{ color: 'var(--color-text-muted)' }}>⏸ &lt; threshold</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Form 944 view ──────────────────────────────────────────────

const Form944View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  const Line = ({ n, label, value, tone }: { n: string; label: string; value: any; tone?: 'red' | 'green' | 'bold' }) => (
    <tr style={tone === 'bold' ? { background: 'rgba(0,0,0,0.04)' } : undefined}>
      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 70 }}>{n}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: tone === 'bold' ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? 'var(--color-accent-expense)' : tone === 'green' ? 'var(--color-accent-income)' : 'var(--color-text-primary)' }}>
        {typeof value === 'number' ? fmt$(value) : value}
      </td>
    </tr>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Form 944 Annual · {data.year} · {data.business_name} · EIN {data.ein || '__-_______'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Employees" value={String(data.employee_count)} />
          <Stat label="Wages (line 1)" value={fmt$(data.line1_wages_tips)} />
          <Stat label="Total Tax (line 9)" value={fmt$(data.line9_total_after_credits)} highlight color="var(--color-accent-expense)" />
          <Stat label={data.line11_balance_due > 0 ? 'Balance Due' : 'Overpayment'} value={fmt$(data.line11_balance_due > 0 ? data.line11_balance_due : data.line12a_overpayment)} color={data.line11_balance_due > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'} />
        </div>
        {data.warnings.length > 0 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 6, fontSize: 11 }}>
            <strong>⚠ Notes:</strong>
            <ul style={{ margin: '4px 0 0 18px' }}>{data.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Part 1 — Annual Wages and Taxes
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="1" label="Wages, tips, other compensation" value={data.line1_wages_tips} />
            <Line n="2" label="Federal income tax withheld" value={data.line2_fed_income_tax} />
            <Line n="4a" label={`Taxable SS wages (${fmt$(data.line4a_taxable_ss_wages)}) × 12.4%`} value={data.line4a_ss_tax} />
            <Line n="4c" label={`Taxable Medicare wages (${fmt$(data.line4c_taxable_medicare_wages)}) × 2.9%`} value={data.line4c_medicare_tax} />
            <Line n="4d" label={`Addtl Medicare > $200k (${fmt$(data.line4d_addtl_medicare_wages)}) × 0.9%`} value={data.line4d_addtl_medicare_tax} />
            <Line n="4e" label="Total SS+Medicare (4a+4b+4c+4d)" value={data.line4e_total} tone="bold" />
            <Line n="5" label="Total taxes before adjustments (2 + 4e)" value={data.line5_total_before_adj} tone="bold" />
            <Line n="9" label="Total taxes after credits" value={data.line9_total_after_credits} tone="red" />
            <Line n="10" label="Total deposits for the year" value={data.line10_total_deposits} tone="green" />
            <Line n="11" label="Balance due" value={data.line11_balance_due} tone={data.line11_balance_due > 0 ? 'red' : undefined} />
            <Line n="12a" label="Overpayment" value={data.line12a_overpayment} tone={data.line12a_overpayment > 0 ? 'green' : undefined} />
          </tbody>
        </table>
      </div>

      {data.line13_monthly_required && (
        <div className="block-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Part 2 — Monthly Tax Liability (line 9 ≥ $2,500)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['13a Jan', data.line13a_jan], ['13b Feb', data.line13b_feb], ['13c Mar', data.line13c_mar],
                ['13d Apr', data.line13d_apr], ['13e May', data.line13e_may], ['13f Jun', data.line13f_jun],
                ['13g Jul', data.line13g_jul], ['13h Aug', data.line13h_aug], ['13i Sep', data.line13i_sep],
                ['13j Oct', data.line13j_oct], ['13k Nov', data.line13k_nov], ['13l Dec', data.line13l_dec],
              ].map(([label, val]: any) => (
                <Line key={label} n={label.split(' ')[0]} label={label.split(' ').slice(1).join(' ')} value={val} />
              ))}
              <Line n="13m" label="Total — must equal line 9" value={data.line13m_total} tone="bold" />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Form 945 view ──────────────────────────────────────────────

const Form945View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  const Line = ({ n, label, value, tone }: { n: string; label: string; value: any; tone?: 'red' | 'green' | 'bold' }) => (
    <tr style={tone === 'bold' ? { background: 'rgba(0,0,0,0.04)' } : undefined}>
      <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 70 }}>{n}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: tone === 'bold' ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? 'var(--color-accent-expense)' : tone === 'green' ? 'var(--color-accent-income)' : 'var(--color-text-primary)' }}>
        {typeof value === 'number' ? fmt$(value) : value}
      </td>
    </tr>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Form 945 Annual · {data.year} · {data.business_name} · EIN {data.ein || '__-_______'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Source Rows" value={String(data.source_count)} />
          <Stat label="Backup W/H (line 2)" value={fmt$(data.line2_backup_withholding)} />
          <Stat label="Total Tax (line 3)" value={fmt$(data.line3_total_taxes)} highlight color="var(--color-accent-expense)" />
          <Stat label={data.line5_balance_due > 0 ? 'Balance Due' : 'Overpayment'} value={fmt$(data.line5_balance_due > 0 ? data.line5_balance_due : data.line6a_overpayment)} color={data.line5_balance_due > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'} />
        </div>
        {data.warnings.length > 0 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 6, fontSize: 11 }}>
            <strong>⚠ Notes:</strong>
            <ul style={{ margin: '4px 0 0 18px' }}>{data.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </div>
      <div className="block-card" style={{ padding: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Line n="1" label="Federal tax withheld from pensions/annuities/IRAs/gambling" value={data.line1_fed_withheld} />
            <Line n="2" label="Backup withholding (24% on no-TIN vendor payments)" value={data.line2_backup_withholding} />
            <Line n="3" label="Total taxes (1 + 2)" value={data.line3_total_taxes} tone="red" />
            <Line n="4" label="Total deposits for the year" value={data.line4_total_deposits} tone="green" />
            <Line n="5" label="Balance due" value={data.line5_balance_due} tone={data.line5_balance_due > 0 ? 'red' : undefined} />
            <Line n="6a" label="Overpayment" value={data.line6a_overpayment} tone={data.line6a_overpayment > 0 ? 'green' : undefined} />
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── 941 Schedule B view ────────────────────────────────────────

const Schedule941BView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  const renderMonth = (name: string, daily: any[], total: number) => (
    <div className="block-card" style={{ padding: 14 }} key={name}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {name} — Total {fmt$(total)}
      </div>
      {daily.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '6px 10px' }}>No tax liability dates this month.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {daily.map((d: any) => (
              <tr key={d.day}>
                <td style={{ padding: '4px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 60 }}>Day {d.day}</td>
                <td style={{ padding: '4px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(d.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          941 Schedule B · Q{data.quarter} {data.year} · {data.business_name}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Stat label="Pay Dates" value={String(data.pay_dates_count)} />
          <Stat label="Quarter Total" value={fmt$(data.total_quarter_liability)} highlight color="var(--color-accent-expense)" />
        </div>
      </div>
      {renderMonth(data.month1_name, data.month1_liability, data.month1_total)}
      {renderMonth(data.month2_name, data.month2_liability, data.month2_total)}
      {renderMonth(data.month3_name, data.month3_liability, data.month3_total)}
    </div>
  );
};

// ── Form 945-A view ────────────────────────────────────────────

const Form945AView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Form 945-A · {data.year} · {data.business_name} · Attached to {String(data.parent_form).replace('form-', 'Form ').toUpperCase()}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Stat label="Liability Dates" value={String(data.liability_dates_count)} />
          <Stat label="Year Total" value={fmt$(data.total_year_liability)} highlight color="var(--color-accent-expense)" />
        </div>
      </div>
      {data.months.filter((m: any) => m.daily.length > 0).map((m: any) => (
        <div className="block-card" style={{ padding: 14 }} key={m.month_number}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {m.month_name} — Total {fmt$(m.month_total)}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {m.daily.map((d: any) => (
                <tr key={d.day}>
                  <td style={{ padding: '4px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 60 }}>Day {d.day}</td>
                  <td style={{ padding: '4px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

// ── Generic 1099 view (works for INT/DIV/R/K/B/G/C/SA) ─────────

const Generic1099View: React.FC<{ forms: any[]; variant: string; amountKey: string; amountLabel: string; thresholdAmount: number }> = ({ forms, variant, amountKey, amountLabel, thresholdAmount }) => {
  if (!forms || forms.length === 0) {
    return <div className="block-card" style={{ padding: 18, color: 'var(--color-text-muted)', fontSize: 12 }}>
      No {variant} recipients. Mark eligible vendors/clients in their respective modules to see them here.
    </div>;
  }
  const grand = forms.reduce((s: number, f: any) => s + (Number(f[amountKey]) || 0), 0);
  const ready = forms.filter((f: any) => f.meets_filing_threshold && f.has_tin).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Recipients" value={String(forms.length)} />
          <Stat label="Ready to File" value={String(ready)} color="var(--color-accent-income)" />
          <Stat label={`Total ${amountLabel}`} value={fmt$(grand)} highlight />
          <Stat label="Threshold" value={thresholdAmount > 0 ? '≥ ' + fmt$(thresholdAmount) : 'Any'} />
        </div>
      </div>

      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          {variant} Recipients ({forms.length})
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
              {['Recipient', 'TIN', 'Address', amountLabel, 'Status'].map((h, i) => (
                <th key={h} style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i === 3 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.map((f: any, i: number) => (
              <tr key={f.recipient_id || i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>{f.recipient_name || '(unnamed)'}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: f.has_tin ? 'var(--color-text-primary)' : 'var(--color-accent-expense)' }}>
                  {f.has_tin ? '•••' + (f.recipient_tin || '').slice(-4) : '⛔ missing'}
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {[f.recipient_city, f.recipient_state].filter(Boolean).join(', ') || '—'}
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>
                  {fmt$(Number(f[amountKey]) || 0)}
                </td>
                <td style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700 }}>
                  {f.meets_filing_threshold && f.has_tin ? <span style={{ color: 'var(--color-accent-income)' }}>✓ READY</span> :
                    !f.has_tin ? <span style={{ color: 'var(--color-accent-expense)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={11} /> NO TIN</span> :
                    <span style={{ color: 'var(--color-text-muted)' }}>⏸ pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── W-2c view ──────────────────────────────────────────────────

const W2CView: React.FC<{ corrections: any[] }> = ({ corrections }) => {
  if (!corrections || corrections.length === 0) {
    return <div className="block-card" style={{ padding: 18, color: 'var(--color-text-muted)', fontSize: 12 }}>
      No W-2c corrections specified. To create a W-2c:
      <ol style={{ margin: '8px 0 0 18px', fontSize: 12 }}>
        <li>Identify the employee whose W-2 needs correction</li>
        <li>Note the original (incorrect) values and the new (correct) values</li>
        <li>Submit corrections via api.taxW2C(year, [{`{employee_id, box1_wages_tips, ...}`}])</li>
      </ol>
      <div style={{ marginTop: 12, padding: 10, background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 6, fontSize: 11 }}>
        <strong>Note:</strong> A dedicated W-2c correction UI is queued for a future wave. For now this is API-only access.
      </div>
    </div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {corrections.map((c: any, i: number) => (
        <div key={c.employee_id || i} className="block-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
            {c.prev?.employee_first_name} {c.prev?.employee_last_name} — Tax Year {c.tax_year}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            {c.changed_fields?.length || 0} field(s) changed
          </div>
          {c.warnings?.length > 0 && (
            <div style={{ padding: 10, background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 6, fontSize: 11, marginBottom: 8 }}>
              {c.warnings.map((w: string, j: number) => <div key={j}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ── Form 1096 view ─────────────────────────────────────────────

const Form1096View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Form 1096 Transmittal · {data.year} · {data.filer_name}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Stat label="Total Forms (Box 3)" value={String(data.total_forms)} highlight />
          <Stat label="Federal Withheld (Box 4)" value={fmt$(data.total_fed_withheld)} />
          <Stat label="Total Reported (Box 5)" value={fmt$(data.total_reported)} color="var(--color-accent-expense)" />
        </div>
        {data.warnings.length > 0 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 6, fontSize: 11 }}>
            <strong>⚠ Notes:</strong>
            <ul style={{ margin: '4px 0 0 18px' }}>{data.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </div>
      <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: '#0f172a', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4 }}>
          1099 Forms Summary
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
              {['Form', '1096 Box', 'Forms Count', 'Ready / Total', 'Total Amount'].map((h, i) => (
                <th key={h} style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>No 1099 forms found for {data.year}.</td></tr>
            ) : data.rows.map((r: any, i: number) => (
              <tr key={r.variant || i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>{r.variant}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>Box {r.irs_box}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{r.forms_count}</td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: r.ready_to_file_count === r.forms_count ? 'var(--color-accent-income)' : 'var(--color-accent-warning)' }}>
                  {r.ready_to_file_count} / {r.forms_count}
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>{fmt$(r.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Generic schedule line table ────────────────────────────────

const ScheduleLine: React.FC<{ n: string; label: string; value: any; tone?: 'red' | 'green' | 'bold' }> = ({ n, label, value, tone }) => (
  <tr style={tone === 'bold' ? { background: 'rgba(0,0,0,0.04)' } : undefined}>
    <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)', width: 70 }}>{n}</td>
    <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: tone === 'bold' ? 700 : 400 }}>{label}</td>
    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: tone === 'bold' ? 800 : 600, color: tone === 'red' ? 'var(--color-accent-expense)' : tone === 'green' ? 'var(--color-accent-income)' : 'var(--color-text-primary)' }}>
      {typeof value === 'number' ? fmt$(value) : (value || '—')}
    </td>
  </tr>
);

const ScheduleSection: React.FC<{ title: string; rows: Array<[string, string, any] | [string, string, any, 'red' | 'green' | 'bold']> }> = ({ title, rows }) => (
  <div className="block-card" style={{ padding: 14 }}>
    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{title}</div>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        {rows.map(([n, label, value, tone], i) => (
          <ScheduleLine key={n + i} n={n} label={label} value={value} tone={tone as any} />
        ))}
      </tbody>
    </table>
  </div>
);

const ScheduleWarnings: React.FC<{ warnings: string[] }> = ({ warnings }) => {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div style={{ padding: 10, background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 6, fontSize: 11 }}>
      <strong>⚠ Notes:</strong>
      <ul style={{ margin: '4px 0 0 18px' }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </div>
  );
};

// ── Schedule 1 view ────────────────────────────────────────────

const Schedule1View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Stat label="Schedule C → Line 3" value={fmt$(data.line3_business_income)} />
          <Stat label="½ SE Tax → Line 15" value={fmt$(data.line15_se_tax_deduction)} />
          <Stat label="Total Adjustments" value={fmt$(data.line26_total_adjustments)} highlight />
        </div>
      </div>
      <ScheduleSection title="Part I — Additional Income" rows={[
        ['1', 'Taxable refunds', data.line1_taxable_refunds],
        ['2a', 'Alimony received', data.line2a_alimony_received],
        ['3', 'Business income (Schedule C)', data.line3_business_income, 'bold'],
        ['5', 'Rental real estate (Schedule E)', data.line5_rental_real_estate],
        ['7', 'Unemployment compensation', data.line7_unemployment_comp],
        ['10', 'TOTAL additional income', data.line10_total_additional_income, 'bold'],
      ]} />
      <ScheduleSection title="Part II — Adjustments to Income" rows={[
        ['11', 'Educator expenses', data.line11_educator_expenses],
        ['13', 'HSA deduction', data.line13_hsa_deduction],
        ['15', 'Deductible part of SE tax', data.line15_se_tax_deduction, 'green'],
        ['16', 'Self-employed health insurance', data.line16_se_health_insurance],
        ['17', 'SE retirement contributions', data.line17_se_retirement_contributions],
        ['20', 'IRA deduction', data.line20_ira_deduction],
        ['21', 'Student loan interest', data.line21_student_loan_interest],
        ['26', 'TOTAL adjustments', data.line26_total_adjustments, 'bold'],
      ]} />
    </div>
  );
};

// ── Schedule 2 view ────────────────────────────────────────────

const Schedule2View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Stat label="SE Tax (line 4)" value={fmt$(data.line4_se_tax)} color="var(--color-accent-expense)" />
          <Stat label="TOTAL Other Taxes (line 21)" value={fmt$(data.line21_total_other_taxes)} highlight color="var(--color-accent-expense)" />
        </div>
      </div>
      <ScheduleSection title="Part I — Tax" rows={[
        ['1', 'Alternative minimum tax', data.line1_amt],
        ['2', 'Excess advance premium credit', data.line2_excess_advance_premium_credit],
        ['3', 'Total Part I', data.line3_total_part1, 'bold'],
      ]} />
      <ScheduleSection title="Part II — Other Taxes" rows={[
        ['4', 'Self-employment tax', data.line4_se_tax, 'red'],
        ['8', 'Additional tax on IRAs', data.line8_addtl_tax_iras],
        ['9', 'Household employment taxes', data.line9_household_employment_taxes],
        ['11', 'Additional Medicare Tax', data.line11_addtl_medicare_tax],
        ['12', 'Net investment income tax', data.line12_net_investment_income_tax],
        ['21', 'TOTAL other taxes', data.line21_total_other_taxes, 'bold'],
      ]} />
    </div>
  );
};

// ── Schedule 3 view ────────────────────────────────────────────

const Schedule3View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <ScheduleSection title="Part I — Nonrefundable Credits" rows={[
        ['1', 'Foreign tax credit', data.line1_foreign_tax_credit],
        ['2', 'Dependent care credit', data.line2_dependent_care_credit],
        ['3', 'Education credit', data.line3_education_credit],
        ['4', 'Retirement savings credit', data.line4_retirement_savings_credit],
        ['5a', 'Residential clean energy', data.line5a_residential_clean_energy],
        ['5b', 'Energy efficient home', data.line5b_energy_efficient_home],
        ['8', 'TOTAL Part I', data.line8_total_part1, 'bold'],
      ]} />
      <ScheduleSection title="Part II — Refundable Credits / Other Payments" rows={[
        ['9', 'Net premium tax credit', data.line9_net_premium_tax_credit],
        ['10', 'Amount paid with extension', data.line10_amount_paid_with_extension],
        ['11', 'Excess SS / Tier 1 RRTA tax', data.line11_excess_ss_tier1_rrta_tax],
        ['12', 'Credit for federal tax on fuels', data.line12_credit_fed_tax_on_fuels],
        ['15', 'TOTAL Part II', data.line15_total_part2, 'bold'],
      ]} />
    </div>
  );
};

// ── Schedule A view ────────────────────────────────────────────

const ScheduleAView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <Stat label="TOTAL Itemized Deductions (Line 17)" value={fmt$(data.line17_total_itemized)} highlight />
      </div>
      <ScheduleSection title="Medical and Dental Expenses" rows={[
        ['1', 'Medical and dental expenses', data.line1_medical_dental],
        ['2', 'AGI (from 1040 line 11)', data.line2_agi],
        ['3', 'AGI floor (line 2 × 7.5%)', data.line3_agi_floor],
        ['4', 'Medical deduction', data.line4_medical_deduction, 'bold'],
      ]} />
      <ScheduleSection title="Taxes You Paid (SALT cap $10,000)" rows={[
        ['5a', 'State / local income or sales tax', data.line5a_state_local_income_or_sales],
        ['5b', 'State / local real estate', data.line5b_state_local_real_estate],
        ['5c', 'State / local personal property', data.line5c_state_local_personal_property],
        ['5d', 'Sum of 5a + 5b + 5c', data.line5d_total_5a_5b_5c],
        ['5e', 'Smaller of 5d or $10,000', data.line5e_smaller_of_5d_or_10000, 'bold'],
        ['7', 'Total taxes', data.line7_total_taxes, 'bold'],
      ]} />
      <ScheduleSection title="Interest, Charity, Other" rows={[
        ['8e', 'Total home mortgage interest', data.line8e_total_8a_8b_8c],
        ['9', 'Investment interest', data.line9_investment_interest],
        ['10', 'Total interest', data.line10_total_interest],
        ['14', 'Total charity', data.line14_total_charity],
        ['15', 'Casualty and theft losses', data.line15_casualty_theft],
        ['17', 'TOTAL ITEMIZED', data.line17_total_itemized, 'bold'],
      ]} />
    </div>
  );
};

// ── Schedule B view ────────────────────────────────────────────

const ScheduleBView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Stat label="Total Interest" value={fmt$(data.line2_total_interest)} />
          <Stat label="Total Dividends" value={fmt$(data.line6_total_dividends)} />
        </div>
      </div>
      <ScheduleSection title="Part I — Interest" rows={[
        ...((data.line1_interest_payers || []).map((p: any, i: number) => [String(i + 1), p.name, p.amount] as [string, string, any])),
        ['2', 'Total interest', data.line2_total_interest, 'bold'],
        ['4', 'Taxable interest (→ 1040 line 2b)', data.line4_taxable_interest, 'bold'],
      ]} />
      <ScheduleSection title="Part II — Ordinary Dividends" rows={[
        ...((data.line5_dividend_payers || []).map((p: any, i: number) => [String(i + 1), p.name, p.amount] as [string, string, any])),
        ['6', 'Total dividends (→ 1040 line 3b)', data.line6_total_dividends, 'bold'],
      ]} />
      <ScheduleSection title="Part III — Foreign Accounts" rows={[
        ['7a', 'Financial interest in foreign account?', data.line7a_foreign_account_yes ? 'Yes' : 'No'],
        ['7a', 'Country (if Yes)', data.line7a_country],
        ['8', 'Distribution from foreign trust?', data.line8_foreign_trust ? 'Yes' : 'No'],
      ]} />
    </div>
  );
};

// ── Schedule D view ────────────────────────────────────────────

const ScheduleDView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Stat label="Short-Term (Line 7)" value={fmt$(data.line7_total_short_term_gain_loss)} color={data.line7_total_short_term_gain_loss < 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'} />
          <Stat label="Long-Term (Line 15)" value={fmt$(data.line15_total_long_term_gain_loss)} color={data.line15_total_long_term_gain_loss < 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'} />
          <Stat label="Combined (Line 16)" value={fmt$(data.line16_combined_total)} highlight color={data.line16_combined_total < 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'} />
        </div>
      </div>
      <ScheduleSection title="Summary" rows={[
        ['7', 'Total short-term gain/loss', data.line7_total_short_term_gain_loss, 'bold'],
        ['15', 'Total long-term gain/loss', data.line15_total_long_term_gain_loss, 'bold'],
        ['16', 'COMBINED total (→ 1040 line 7)', data.line16_combined_total, 'bold'],
        ['21', 'Capital loss limit (max −$3,000 deduction)', data.line21_capital_loss_limit],
      ]} />
    </div>
  );
};

// ── Form 1040-ES view ──────────────────────────────────────────

const Form1040ESView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Projected Total Tax" value={fmt$(data.projected_total_tax)} color="var(--color-accent-expense)" />
          <Stat label="Net Estimated Tax" value={fmt$(data.net_estimated_tax)} />
          <Stat label="Recommended Total" value={fmt$(data.recommended_total)} highlight color="var(--color-accent-expense)" />
          <Stat label="Per Quarter" value={fmt$(data.recommended_quarterly)} highlight />
        </div>
      </div>
      <ScheduleSection title="Estimated Tax Worksheet" rows={[
        ['1', 'Projected business income', data.projected_business_income],
        ['2', 'Other income', data.projected_other_income],
        ['3', 'Adjustments (½ SE tax, etc.)', data.projected_adjustments],
        ['4', 'Projected AGI', data.projected_agi],
        ['5', 'Standard deduction', data.projected_standard_deduction],
        ['6', 'QBI deduction (20%)', data.projected_qbi_deduction],
        ['7', 'Projected taxable income', data.projected_taxable_income],
        ['8', 'Projected income tax', data.projected_income_tax],
        ['9', 'Projected SE tax', data.projected_se_tax],
        ['10', 'TOTAL projected tax', data.projected_total_tax, 'bold'],
        ['11', 'Withholding credits', data.withholding_credits],
        ['12', 'Net estimated tax', data.net_estimated_tax, 'bold'],
      ]} />
      <ScheduleSection title="Safe Harbor Comparison" rows={[
        ['A', 'Prior year (× 110% if AGI > $150K)', data.safe_harbor_prior_year],
        ['B', 'Current year × 90%', data.safe_harbor_current_year],
        ['C', 'Recommended (lower of A and B)', data.recommended_total, 'bold'],
        ['D', 'Quarterly (C ÷ 4)', data.recommended_quarterly, 'bold'],
      ]} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Quarterly Vouchers
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {(data.vouchers || []).map((v: any) => (
            <div key={v.voucher_number} style={{ border: '2px solid var(--color-border-primary)', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)' }}>Voucher {v.voucher_number} of 4</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-primary)', marginTop: 2 }}>Due {v.due_date_label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)', marginTop: 6 }}>{fmt$(v.amount)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Form 8995 view (QBI Simplified) ────────────────────────────

const Form8995View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="QBI (Schedule C)" value={fmt$(data.line2_total_qbi)} />
          <Stat label="QBI Component (× 20%)" value={fmt$(data.line5_qbi_component)} color="var(--color-accent-income)" />
          <Stat label="Income Limit" value={fmt$(data.line14_income_limitation)} />
          <Stat label="QBI DEDUCTION (Line 15)" value={fmt$(data.line15_qbi_deduction)} highlight color="var(--color-accent-income)" />
        </div>
      </div>
      <ScheduleSection title="Computation" rows={[
        ['2', 'Total QBI from line 1', data.line2_total_qbi, 'bold'],
        ['3', 'QBI loss carryforward', data.line3_qbi_loss_carryforward],
        ['4', 'Total QBI after carryforward', data.line4_total_qbi_after_carryforward],
        ['5', 'QBI component (line 4 × 20%)', data.line5_qbi_component, 'bold'],
        ['6', 'REIT/PTP income', data.line6_reit_ptp_income],
        ['9', 'REIT/PTP component (line 8 × 20%)', data.line9_reit_ptp_component],
        ['10', 'Tentative deduction (5 + 9)', data.line10_qbi_before_income_limit, 'bold'],
        ['11', 'Taxable income before QBI deduction', data.line11_taxable_income_before_qbi],
        ['12', 'Net capital gain + qualified dividends', data.line12_net_capital_gain],
        ['13', 'Taxable income minus capital gain', data.line13_taxable_income_minus_cg],
        ['14', 'Income limit (line 13 × 20%)', data.line14_income_limitation, 'bold'],
        ['15', 'QBI DEDUCTION (smaller of 10 or 14)', data.line15_qbi_deduction, 'green'],
      ]} />
    </div>
  );
};

// ── Form 4562 view (Depreciation) ──────────────────────────────

const Form4562View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Assets" value={String(data.asset_count)} />
          <Stat label="Section 179" value={fmt$(data.line12_section_179_deduction)} color="var(--color-accent-income)" />
          <Stat label="Bonus Depreciation" value={fmt$(data.line15_bonus_depreciation)} color="var(--color-accent-income)" />
          <Stat label="TOTAL Depreciation (Line 22)" value={fmt$(data.line22_total_depreciation)} highlight color="var(--color-accent-income)" />
        </div>
      </div>
      <ScheduleSection title="Part I — Section 179 Election" rows={[
        ['1', 'Maximum amount allowed', data.line1_max_section_179],
        ['5', 'Dollar limit after phase-out', data.line5_dollar_limit],
        ['8', 'Total elected', data.line8_total_elected],
        ['11', 'Business income limit', data.line11_business_income_limit],
        ['12', 'SECTION 179 DEDUCTION', data.line12_section_179_deduction, 'green'],
        ['13', 'Carryover to next year', data.line13_carryover_to_next_year],
      ]} />
      <ScheduleSection title="Part II — Bonus Depreciation (40% for 2025)" rows={[
        ['14', 'Eligible basis', data.line14_bonus_property_basis],
        ['15', 'Bonus depreciation', data.line15_bonus_depreciation, 'green'],
      ]} />
      <ScheduleSection title="Part III — MACRS (placed in service this year)" rows={[
        ['19a', '3-year property', data.line19a_3yr_property],
        ['19b', '5-year property (autos, computers)', data.line19b_5yr_property],
        ['19c', '7-year property (furniture)', data.line19c_7yr_property],
        ['19h', 'Residential rental (27.5 yr)', data.line19h_residential_rental],
        ['19i', 'Nonresidential real (39 yr)', data.line19i_nonresidential_real],
        ['17', 'Pre-year MACRS property', data.line17_macrs_pre_year_property],
      ]} />
      <ScheduleSection title="Summary" rows={[
        ['21', 'Listed property amount', data.line21_listed_property_amount],
        ['22', 'TOTAL DEPRECIATION', data.line22_total_depreciation, 'bold'],
      ]} />
    </div>
  );
};

// ── Form 8829 view (Home Office) ───────────────────────────────

const Form8829View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Business sq ft" value={String(data.line1_business_sq_ft)} />
          <Stat label="Total sq ft" value={String(data.line2_total_sq_ft)} />
          <Stat label="Business %" value={data.line3_business_pct.toFixed(2) + '%'} />
          <Stat label="Home Office Deduction (Line 35)" value={fmt$(data.line35_total_home_office_deduction)} highlight color="var(--color-accent-income)" />
        </div>
      </div>
      <ScheduleSection title="Part I — Square Footage" rows={[
        ['1', 'Business sq ft', data.line1_business_sq_ft],
        ['2', 'Total sq ft', data.line2_total_sq_ft],
        ['3', 'Business %', data.line3_business_pct.toFixed(4) + '%'],
      ]} />
      <ScheduleSection title="Part II — Allowable Deduction (income-limited)" rows={[
        ['8', 'Tentative profit (Sch C income limit)', data.line8_gross_income_from_home_use],
        ['10', 'Mortgage interest (full)', data.line10_deductible_mortgage_interest],
        ['11', 'Real estate taxes (full)', data.line11_real_estate_taxes],
        ['18', 'Insurance × business %', data.line18_insurance_indirect],
        ['19', 'Rent × business %', data.line19_rent_indirect],
        ['21', 'Utilities × business %', data.line21_utilities_indirect],
        ['25', 'Total operating × business %', data.line25_multiply_line_24_by_business_pct],
        ['28', 'Allowable operating expenses', data.line28_allowable_operating_expenses, 'bold'],
        ['31', 'Depreciation of home', data.line31_depreciation_of_home],
        ['34', 'Allowable depreciation', data.line34_allowable_depreciation, 'bold'],
        ['35', 'TOTAL HOME OFFICE DEDUCTION', data.line35_total_home_office_deduction, 'green'],
      ]} />
      <ScheduleSection title="Part IV — Carryover to Next Year" rows={[
        ['42', 'Operating expenses carryover', data.line42_operating_expenses_carryover],
        ['44', 'Depreciation carryover', data.line44_depreciation_carryover],
      ]} />
    </div>
  );
};

// ── Form 4797 view (Sale of Business Property) ─────────────────

const Form4797View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Stat label="Section 1231 Net (Line 9)" value={fmt$(data.line9_subtract_line_8)} color={data.line9_subtract_line_8 >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)'} />
          <Stat label="Ordinary Net (Line 17)" value={fmt$(data.line17_combine_lines_10_16)} color={data.line17_combine_lines_10_16 >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)'} />
          <Stat label="Section 1245 Recapture (Line 22)" value={fmt$(data.line22_total_section_1245_recapture)} color="var(--color-accent-expense)" />
        </div>
      </div>
      <ScheduleSection title="Part I — Section 1231 Property" rows={[
        ['7', 'Net Section 1231 gain/loss', data.line7_combine_lines_6, 'bold'],
        ['8', 'Nonrecaptured Section 1231 losses (prior 5 yr)', data.line8_nonrecaptured_section_1231_losses],
        ['9', 'NET (gain → LTCG, loss → ordinary)', data.line9_subtract_line_8, 'bold'],
      ]} />
      <ScheduleSection title="Part II — Ordinary Gains/Losses" rows={[
        ['13', 'Section 1245 recapture (from Part III)', data.line13_gain_ordinary_2],
        ['15', 'Section 179/280F recapture', data.line15_recapture_section_179_280f],
        ['17', 'Net ordinary gain/loss', data.line17_combine_lines_10_16, 'bold'],
      ]} />
      <ScheduleSection title="Part III — Recapture (Depreciation Recapture)" rows={[
        ['22', 'Section 1245 recapture (→ Part II line 13)', data.line22_total_section_1245_recapture, 'bold'],
        ['26', 'Section 1250 gain (real property)', data.line26_total_gain_section_1250],
      ]} />
    </div>
  );
};

// ── Form 7004 view (Business Extension) ────────────────────────

const Form7004View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Form 7004 · {data.form_code_description} · {data.taxpayer_name}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Stat label="Original Due" value={data.original_due_date} color="var(--color-text-muted)" />
          <Stat label="Extended Due" value={data.extended_due_date} highlight color="var(--color-accent-income)" />
          <Stat label="Balance Due" value={fmt$(data.line8_balance_due)} color={data.line8_balance_due > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'} />
        </div>
      </div>
      <ScheduleSection title="Part II — Tax Computation" rows={[
        ['Form Code', data.form_code_description, ''],
        ['Tax Year', data.tax_year_start + ' → ' + data.tax_year_end, ''],
        ['6', 'Tentative total tax for the year (estimate)', data.line6_tentative_total_tax],
        ['7', 'Total payments and credits', data.line7_total_payments_credits],
        ['8', 'BALANCE DUE — pay with this form', data.line8_balance_due, 'red'],
      ]} />
    </div>
  );
};

// ── Form 4868 view (Individual Extension) ──────────────────────

const Form4868View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Stat label="Original Due" value={data.original_due_date} color="var(--color-text-muted)" />
          <Stat label="Extended Due" value={data.extended_due_date} highlight color="var(--color-accent-income)" />
          <Stat label="Balance Due" value={fmt$(data.line6_balance_due)} color={data.line6_balance_due > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'} />
        </div>
      </div>
      <ScheduleSection title="Tax Computation" rows={[
        ['4', 'Estimated total tax for the year', data.line4_estimated_total_tax],
        ['5', 'Total payments (withholding + estimated)', data.line5_total_payments_2024],
        ['6', 'BALANCE DUE', data.line6_balance_due, 'red'],
        ['7', 'Amount paying with extension', data.line7_amount_paying_with_extension],
      ]} />
    </div>
  );
};

// ── Form 1065 view (Partnership) ───────────────────────────────

const Form1065View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Partners" value={String(data.number_of_partners)} />
          <Stat label="Gross Receipts" value={fmt$(data.line1a_gross_receipts)} />
          <Stat label="Total Income" value={fmt$(data.line8_total_income)} />
          <Stat label="Ordinary Income (Line 23)" value={fmt$(data.line23_ordinary_business_income)} highlight color={data.line23_ordinary_business_income >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)'} />
        </div>
      </div>
      <ScheduleSection title="Income (lines 1-8)" rows={[
        ['1a', 'Gross receipts', data.line1a_gross_receipts],
        ['1c', 'Balance after returns', data.line1c_balance],
        ['2', 'Cost of goods sold', data.line2_cost_of_goods_sold],
        ['3', 'Gross profit', data.line3_gross_profit, 'bold'],
        ['8', 'TOTAL income', data.line8_total_income, 'bold'],
      ]} />
      <ScheduleSection title="Deductions (lines 9-22)" rows={[
        ['9', 'Salaries and wages', data.line9_salaries_wages],
        ['10', 'Guaranteed payments', data.line10_guaranteed_payments_partners],
        ['13', 'Rent', data.line13_rent],
        ['14', 'Taxes and licenses', data.line14_taxes_licenses],
        ['16c', 'Depreciation', data.line16c_balance_depreciation],
        ['21', 'Other deductions', data.line21_other_deductions],
        ['22', 'TOTAL deductions', data.line22_total_deductions, 'bold'],
        ['23', 'ORDINARY BUSINESS INCOME (8 − 22)', data.line23_ordinary_business_income, data.line23_ordinary_business_income >= 0 ? 'green' : 'red'],
      ]} />
      <ScheduleSection title="Schedule K — Distributive Shares" rows={[
        ['1', 'Ordinary income → K-1 box 1', data.schK_ordinary_business_income, 'bold'],
        ['4', 'Guaranteed payments → K-1 box 4', data.schK_guaranteed_payments],
        ['5', 'Interest → K-1 box 5', data.schK_interest_income],
        ['9a', 'Long-term capital gain → K-1 box 9a', data.schK_net_long_term_cap_gain],
        ['14a', 'SE earnings → K-1 box 14', data.schK_self_employment_earnings],
      ]} />
    </div>
  );
};

// ── Form 1120 view (C-Corp) ────────────────────────────────────

const Form1120View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Total Income" value={fmt$(data.line11_total_income)} />
          <Stat label="Total Deductions" value={fmt$(data.line27_total_deductions)} />
          <Stat label="Taxable Income" value={fmt$(data.line30_taxable_income)} />
          <Stat label="Total Tax (21%)" value={fmt$(data.line31_total_tax)} highlight color="var(--color-accent-expense)" />
        </div>
      </div>
      <ScheduleSection title="Income (lines 1-11)" rows={[
        ['1c', 'Gross profit balance', data.line1c_balance],
        ['3', 'Gross profit', data.line3_gross_profit],
        ['4', 'Dividends', data.line4_dividends_special_deductions],
        ['5', 'Interest', data.line5_interest],
        ['8', 'Capital gain', data.line8_capital_gain_net_income],
        ['11', 'TOTAL income', data.line11_total_income, 'bold'],
      ]} />
      <ScheduleSection title="Deductions (lines 12-27)" rows={[
        ['12', 'Officer compensation', data.line12_compensation_officers],
        ['13', 'Salaries / wages', data.line13_salaries_wages],
        ['16', 'Rents', data.line16_rents],
        ['17', 'Taxes / licenses', data.line17_taxes_licenses],
        ['19', 'Charitable contributions', data.line19_charitable_contributions],
        ['20', 'Depreciation', data.line20_depreciation],
        ['26', 'Other deductions', data.line26_other_deductions],
        ['27', 'TOTAL deductions', data.line27_total_deductions, 'bold'],
      ]} />
      <ScheduleSection title="Tax Computation" rows={[
        ['28', 'Taxable income before NOL/special', data.line28_taxable_income_before_nol_dividends_received],
        ['29c', 'NOL + special deductions', data.line29c_total_29a_29b],
        ['30', 'TAXABLE INCOME', data.line30_taxable_income, 'bold'],
        ['31', 'TOTAL TAX (line 30 × 21%)', data.line31_total_tax, 'red'],
        ['32', 'Estimated tax payments', data.line32_estimated_tax_payments],
        data.line33_balance_due > 0
          ? ['33', 'Balance due', data.line33_balance_due, 'red' as const]
          : ['33', 'Balance due', data.line33_balance_due],
        data.line34_overpayment > 0
          ? ['34', 'Overpayment', data.line34_overpayment, 'green' as const]
          : ['34', 'Overpayment', data.line34_overpayment],
      ]} />
    </div>
  );
};

// ── Form 1120-S view (S-Corp) ──────────────────────────────────

const Form1120SView: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Shareholders" value={String(data.number_of_shareholders)} />
          <Stat label="Officer Comp" value={fmt$(data.line7_compensation_officers)} />
          <Stat label="Total Income" value={fmt$(data.line6_total_income)} />
          <Stat label="Ordinary Income (Line 21)" value={fmt$(data.line21_ordinary_business_income_loss)} highlight color={data.line21_ordinary_business_income_loss >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)'} />
        </div>
      </div>
      <ScheduleSection title="Income (lines 1-6)" rows={[
        ['1c', 'Gross profit balance', data.line1c_balance],
        ['2', 'Cost of goods sold', data.line2_cost_of_goods_sold],
        ['3', 'Gross profit', data.line3_gross_profit, 'bold'],
        ['6', 'TOTAL income', data.line6_total_income, 'bold'],
      ]} />
      <ScheduleSection title="Deductions (lines 7-20)" rows={[
        ['7', 'Officer compensation (W-2 to owners)', data.line7_compensation_officers],
        ['8', 'Salaries / wages (other employees)', data.line8_salaries_wages],
        ['11', 'Rents', data.line11_rents],
        ['12', 'Taxes / licenses', data.line12_taxes_licenses],
        ['14', 'Depreciation', data.line14_depreciation],
        ['19', 'Other deductions', data.line19_other_deductions],
        ['20', 'TOTAL deductions', data.line20_total_deductions, 'bold'],
        ['21', 'ORDINARY BUSINESS INCOME', data.line21_ordinary_business_income_loss, data.line21_ordinary_business_income_loss >= 0 ? 'green' : 'red'],
      ]} />
      <ScheduleSection title="Schedule K — Distributive Shares" rows={[
        ['1', 'Ordinary income → K-1 box 1', data.schK_ordinary_business_income, 'bold'],
        ['8a', 'Long-term capital gain → K-1', data.schK_net_long_term_cap_gain],
        ['16d', 'Distributions to shareholders', data.schK_distributions],
      ]} />
    </div>
  );
};

// ── Form 1041 view (Estate / Trust) ────────────────────────────

const Form1041View: React.FC<{ data: any }> = ({ data }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Type" value={data.entity_type} />
          <Stat label="Total Income" value={fmt$(data.line9_total_income)} />
          <Stat label="Taxable Income" value={fmt$(data.line22_taxable_income)} />
          <Stat label="Total Tax" value={fmt$(data.line23_total_tax)} highlight color="var(--color-accent-expense)" />
        </div>
      </div>
      <ScheduleSection title="Income" rows={[
        ['1', 'Interest income', data.line1_interest_income],
        ['2a', 'Ordinary dividends', data.line2a_ordinary_dividends],
        ['3', 'Business income', data.line3_business_income],
        ['4', 'Capital gain', data.line4_capital_gains],
        ['5', 'Rents / royalties / partnerships', data.line5_rents_royalties_partnerships],
        ['9', 'TOTAL income', data.line9_total_income, 'bold'],
      ]} />
      <ScheduleSection title="Deductions and Tax" rows={[
        ['16', 'Total deductions', data.line16_total_deductions],
        ['17', 'Adjusted total income', data.line17_adjusted_total_income],
        ['18', 'Income distribution deduction', data.line18_income_distribution_deduction],
        ['21', 'Exemption', data.line21_exemption],
        ['22', 'TAXABLE INCOME', data.line22_taxable_income, 'bold'],
        ['23', 'TOTAL TAX (compressed brackets)', data.line23_total_tax, 'red'],
      ]} />
    </div>
  );
};

// ── Generic form view — flexible JSON-style display for any form ─

const GenericFormView: React.FC<{ data: any; formType: string }> = ({ data, formType }) => {
  if (data?.error) return <div style={{ color: 'var(--color-accent-expense)' }}>{data.error}</div>;

  // Collect keys with values (ignore arrays / nested objects for now)
  const fields = Object.entries(data || {})
    .filter(([k, v]) => k !== 'warnings' && typeof v !== 'object' && v !== null && v !== '')
    .map(([k, v]) => [k, v] as [string, any]);

  // Group keys by prefix (lineN_, boxN_, etc.)
  const lineFields = fields.filter(([k]) => /^line\d+/.test(k) || /^box\d+/.test(k) || /^schK_/.test(k) || /^line[a-z]/.test(k));
  const identityFields = fields.filter(([k]) => !lineFields.includes([k] as any) && !lineFields.find(([n]) => n === k));

  const formatValue = (v: any): string => {
    if (typeof v === 'number') return fmt$(v);
    if (typeof v === 'boolean') return v ? '☒' : '☐';
    return String(v);
  };

  const formatLabel = (k: string): string => {
    return k.replace(/_/g, ' ').replace(/^line(\d+)/, 'Line $1:').replace(/^box(\d+)/, 'Box $1:').replace(/^schK /, 'Sch K ');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScheduleWarnings warnings={data.warnings || []} />
      <div className="block-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          {formType.toUpperCase()} · {data.entity_name || data.taxpayer_name || data.employer_name || data.legal_name || data.business_name || 'Form Data'}
        </div>
      </div>

      {identityFields.length > 0 && (
        <div className="block-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Identity / Filing Info
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {identityFields.slice(0, 20).map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>{formatLabel(k)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', textAlign: 'right' }}>{formatValue(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lineFields.length > 0 && (
        <div className="block-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Line Items
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {lineFields.map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)' }}>{formatLabel(k)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', textAlign: 'right', fontWeight: 600 }}>{formatValue(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TaxForms;
