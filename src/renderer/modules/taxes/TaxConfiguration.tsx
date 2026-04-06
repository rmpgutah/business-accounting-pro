import React, { useState, useEffect, useCallback } from 'react';
import {
  Calculator, ChevronDown, RefreshCw, CheckCircle, Plus,
  DollarSign, Percent, AlertCircle, TrendingUp,
} from 'lucide-react';
import { formatCurrency } from '../../lib/format';

// ─── Types ───────────────────────────────────────────────
interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
  base_tax?: number;
}

interface TaxConstants {
  ss_wage_base: number;
  ss_rate: number;
  medicare_rate: number;
  additional_medicare_rate: number;
  additional_medicare_threshold_single: number;
  additional_medicare_threshold_mfj: number;
  futa_rate: number;
  futa_wage_base: number;
  standard_deduction_single: number;
  standard_deduction_mfj: number;
  standard_deduction_hoh: number;
  allowance_value: number;
}

interface TaxData {
  brackets: Record<FilingStatus, TaxBracket[]>;
  constants: TaxConstants;
}

type FilingStatus = 'single' | 'married_filing_jointly' | 'head_of_household';

interface WithholdingResult {
  federal: number;
  ss: number;
  medicare: number;
  total: number;
}

// ─── Helpers ─────────────────────────────────────────────
const CURRENT_YEAR = 2026;

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

const FILING_TABS: { key: FilingStatus; label: string }[] = [
  { key: 'single', label: 'Single' },
  { key: 'married_filing_jointly', label: 'Married Filing Jointly' },
  { key: 'head_of_household', label: 'Head of Household' },
];

// ─── Toast ───────────────────────────────────────────────
interface Toast { id: number; msg: string; ok: boolean }
let _tid = 0;

// ─── Component ───────────────────────────────────────────
const TaxConfiguration: React.FC = () => {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [taxData, setTaxData] = useState<TaxData | null>(null);
  const [filingStatus, setFilingStatus] = useState<FilingStatus>('single');
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [autoSeeded, setAutoSeeded] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // Withholding calculator state
  const [calcGross, setCalcGross] = useState('');
  const [calcFiling, setCalcFiling] = useState<FilingStatus>('single');
  const [calcAllowances, setCalcAllowances] = useState('1');
  const [calcYtdGross, setCalcYtdGross] = useState('');
  const [calcResult, setCalcResult] = useState<WithholdingResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState('');

  const showToast = (msg: string, ok = true) => {
    const t = { id: ++_tid, msg, ok };
    setToast(t);
    setTimeout(() => setToast((c) => (c?.id === t.id ? null : c)), 4000);
  };

  const loadYears = useCallback(async () => {
    try {
      const years: number[] = await window.electronAPI.invoke('tax:available-years');
      setAvailableYears(years ?? []);
      return years ?? [];
    } catch {
      return [];
    }
  }, []);

  const loadTaxData = useCallback(async (year: number) => {
    setLoading(true);
    try {
      const data = await window.electronAPI.invoke('tax:get-brackets', { year });
      setTaxData(data ?? null);
    } catch {
      setTaxData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const seedYear = useCallback(async (year: number, silent = false) => {
    setSeeding(true);
    try {
      const result = await window.electronAPI.invoke('tax:seed-year', { year });
      if (result?.success) {
        if (!silent) showToast(`Tax data seeded for ${year}.`, true);
        return true;
      }
      return false;
    } catch {
      if (!silent) showToast(`Failed to seed ${year}.`, false);
      return false;
    } finally {
      setSeeding(false);
    }
  }, []);

  // On mount: load years, auto-seed current year if needed
  useEffect(() => {
    const init = async () => {
      const years = await loadYears();
      if (!years.includes(CURRENT_YEAR)) {
        const ok = await seedYear(CURRENT_YEAR, true);
        if (ok) {
          setAutoSeeded(true);
          await loadYears();
        }
      }
      await loadTaxData(CURRENT_YEAR);
    };
    init();
  }, []);

  // When year changes, load data
  useEffect(() => {
    loadTaxData(selectedYear);
  }, [selectedYear]);

  const handleSelectYear = (y: number) => {
    setSelectedYear(y);
  };

  const handleSeedSelected = async () => {
    const ok = await seedYear(selectedYear, false);
    if (ok) {
      const years = await loadYears();
      setAvailableYears(years);
      loadTaxData(selectedYear);
    }
  };

  const handleCalculate = async () => {
    const gross = parseFloat(calcGross);
    if (!calcGross.trim() || isNaN(gross) || gross <= 0) {
      setCalcError('Gross pay must be a valid number greater than 0.');
      return;
    }
    setCalcError('');
    setCalculating(true);
    try {
      const result: WithholdingResult = await window.electronAPI.invoke('tax:calculate-withholding', {
        grossPay: gross,
        filingStatus: calcFiling,
        allowances: parseInt(calcAllowances) || 0,
        year: selectedYear,
        ytdGross: parseFloat(calcYtdGross) || 0,
      });
      setCalcResult(result ?? null);
    } catch {
      showToast('Calculation failed.', false);
    } finally {
      setCalculating(false);
    }
  };

  const brackets = taxData?.brackets?.[filingStatus] ?? [];
  const constants = taxData?.constants;
  const yearNotSeeded = availableYears.length > 0 && !availableYears.includes(selectedYear);

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 text-sm font-semibold border ${
            toast.ok ? 'bg-bg-elevated border-accent-income text-accent-income' : 'bg-bg-elevated border-accent-expense text-accent-expense'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header + Year Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
            <Calculator size={15} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-primary">Tax Configuration</h2>
            <p className="text-xs text-text-muted">Federal tax brackets, payroll constants, and withholding calculator.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {autoSeeded && (
            <div className="flex items-center gap-1.5 text-xs text-accent-income px-2 py-1 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
              <CheckCircle size={12} />
              Auto-seeded {CURRENT_YEAR}
            </div>
          )}

          <div className="flex items-center border border-border-primary" style={{ borderRadius: '6px' }}>
            {availableYears.length === 0 ? (
              <span className="text-xs text-text-muted px-3 py-1.5">Loading years...</span>
            ) : (
              availableYears.sort((a, b) => b - a).map((y) => (
                <button
                  key={y}
                  onClick={() => handleSelectYear(y)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selectedYear === y
                      ? 'bg-accent-blue text-white'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                  }`}
                  style={{ borderRadius: '0px' }}
                >
                  {y}
                  {y === CURRENT_YEAR && <span className="ml-1 text-[9px] opacity-70">CUR</span>}
                </button>
              ))
            )}
          </div>

          {yearNotSeeded && (
            <button
              onClick={handleSeedSelected}
              disabled={seeding}
              className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Plus size={12} />
              {seeding ? 'Seeding...' : `Seed ${selectedYear}`}
            </button>
          )}
        </div>
      </div>

      {yearNotSeeded && (
        <div className="flex items-center gap-2 p-3 bg-bg-tertiary border border-border-primary text-xs text-text-secondary" style={{ borderRadius: '6px' }}>
          <AlertCircle size={14} className="text-accent-blue shrink-0" />
          Tax data for {selectedYear} has not been seeded. Click "Seed {selectedYear}" to initialize with default federal tax rates.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32 text-text-muted text-sm">Loading tax data...</div>
      ) : !taxData ? (
        <div className="empty-state py-16">
          <div className="empty-state-icon"><Calculator size={30} /></div>
          <p className="text-text-muted text-sm mt-2">No tax data for {selectedYear}.</p>
          <button
            onClick={handleSeedSelected}
            disabled={seeding}
            className="block-btn-primary mt-4 px-4 py-2 text-xs flex items-center gap-2 mx-auto"
          >
            <Plus size={13} />
            {seeding ? 'Seeding...' : `Seed ${selectedYear} Data`}
          </button>
        </div>
      ) : (
        <>
          {/* Filing Status Tabs + Brackets */}
          <div className="block-card overflow-hidden">
            <div className="flex border-b border-border-primary">
              {FILING_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setFilingStatus(t.key)}
                  className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                    filingStatus === t.key
                      ? 'border-accent-blue text-accent-blue'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {brackets.length === 0 ? (
              <div className="p-6 text-center text-text-muted text-sm">No bracket data for {filingStatus.replace(/_/g, ' ')}.</div>
            ) : (
              <table className="block-table w-full">
                <thead>
                  <tr>
                    <th>Income Range</th>
                    <th className="text-right">Tax Rate</th>
                    <th className="text-right">Base Tax on Bracket</th>
                  </tr>
                </thead>
                <tbody>
                  {brackets.map((b, i) => (
                    <tr key={i}>
                      <td>
                        <span className="font-semibold text-text-primary">
                          {formatCurrency(b.min)}
                          {b.max != null ? ` — ${formatCurrency(b.max)}` : ' and above'}
                        </span>
                      </td>
                      <td className="text-right">
                        <span className="block-badge block-badge-blue font-mono">{pct(b.rate)}</span>
                      </td>
                      <td className="text-right text-text-secondary">
                        {b.base_tax != null ? formatCurrency(b.base_tax) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Payroll Constants */}
          {constants && (
            <div className="block-card p-4">
              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2 mb-4">
                Payroll Constants — {selectedYear}
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'SS Wage Base', value: formatCurrency(constants.ss_wage_base), icon: <DollarSign size={13} /> },
                  { label: 'SS Rate', value: pct(constants.ss_rate), icon: <Percent size={13} /> },
                  { label: 'Medicare Rate', value: pct(constants.medicare_rate), icon: <Percent size={13} /> },
                  { label: 'Additional Medicare', value: pct(constants.additional_medicare_rate), icon: <Percent size={13} /> },
                  { label: 'Add. Medicare (Single) Threshold', value: formatCurrency(constants.additional_medicare_threshold_single), icon: <DollarSign size={13} /> },
                  { label: 'Add. Medicare (MFJ) Threshold', value: formatCurrency(constants.additional_medicare_threshold_mfj), icon: <DollarSign size={13} /> },
                  { label: 'FUTA Rate', value: pct(constants.futa_rate), icon: <Percent size={13} /> },
                  { label: 'FUTA Wage Base', value: formatCurrency(constants.futa_wage_base), icon: <DollarSign size={13} /> },
                  { label: 'Standard Deduction (Single)', value: formatCurrency(constants.standard_deduction_single), icon: <DollarSign size={13} /> },
                  { label: 'Standard Deduction (MFJ)', value: formatCurrency(constants.standard_deduction_mfj), icon: <DollarSign size={13} /> },
                  { label: 'Standard Deduction (HoH)', value: formatCurrency(constants.standard_deduction_hoh), icon: <DollarSign size={13} /> },
                  { label: 'Allowance Value', value: formatCurrency(constants.allowance_value), icon: <DollarSign size={13} /> },
                ].map((c) => (
                  <div key={c.label} className="flex items-start gap-2 p-2 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
                    <span className="text-text-muted mt-0.5">{c.icon}</span>
                    <div>
                      <p className="text-xs text-text-muted leading-tight">{c.label}</p>
                      <p className="text-sm font-semibold text-text-primary mt-0.5">{c.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Withholding Calculator */}
          <div className="block-card p-4">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border-primary">
              <TrendingUp size={15} className="text-accent-blue" />
              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">
                Tax Withholding Calculator — {selectedYear}
              </h3>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-4">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">Gross Pay ($)</label>
                <input
                  type="number"
                  className="block-input w-full"
                  value={calcGross}
                  onChange={(e) => setCalcGross(e.target.value)}
                  placeholder="5000.00"
                  min="0"
                  step="0.01"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">Filing Status</label>
                <select
                  className="block-select w-full"
                  value={calcFiling}
                  onChange={(e) => setCalcFiling(e.target.value as FilingStatus)}
                >
                  {FILING_TABS.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">Allowances</label>
                <input
                  type="number"
                  className="block-input w-full"
                  value={calcAllowances}
                  onChange={(e) => setCalcAllowances(e.target.value)}
                  min="0"
                  step="1"
                  placeholder="1"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">YTD Gross ($)</label>
                <input
                  type="number"
                  className="block-input w-full"
                  value={calcYtdGross}
                  onChange={(e) => setCalcYtdGross(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            {calcError && (
              <div
                className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mb-3"
                style={{ borderRadius: '6px' }}
              >
                {calcError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleCalculate}
                disabled={calculating || !calcGross}
                className="block-btn-primary flex items-center gap-2 px-4 py-2 text-xs"
              >
                <Calculator size={13} className={calculating ? 'animate-pulse' : ''} />
                {calculating ? 'Calculating...' : 'Calculate Withholding'}
              </button>

              {calcResult && (
                <div className="flex items-center gap-4 flex-wrap">
                  {[
                    { label: 'Federal', value: formatCurrency(calcResult.federal), color: 'text-accent-blue' },
                    { label: 'Social Security', value: formatCurrency(calcResult.ss), color: 'text-text-primary' },
                    { label: 'Medicare', value: formatCurrency(calcResult.medicare), color: 'text-text-primary' },
                    { label: 'Total', value: formatCurrency(calcResult.total), color: 'text-accent-expense' },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
                      <span className="text-xs text-text-muted">{r.label}:</span>
                      <span className={`text-sm font-bold ${r.color}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TaxConfiguration;
